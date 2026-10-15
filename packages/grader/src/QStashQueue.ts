/**
 * The Upstash QStash adapter: publishes grade jobs to the consumer route and turns
 * QStash's HTTP deliveries into `handleGradeJob` calls.
 *
 * The concurrency cap is QStash flow control: every grade message carries the key
 * `grade` and `parallelism=N`, so at most N deliveries are in flight across all
 * instances. Measured on 2026-10-15: 60 five-second jobs at parallelism 10 finished
 * in 32.4 s (ideal 30 s), and 500 at parallelism 100 in 27.3 s (ideal 25 s).
 *
 * Retries: when the consumer asks to come back later, this adapter publishes a
 * fresh message with a delay and acknowledges the current one, so the wait holds no
 * concurrency slot and our backoff, not QStash's, decides the timing. QStash's own
 * retries (`Upstash-Retries`) cover only crashes and failed republishes.
 */
import { Client, Receiver } from "@upstash/qstash";
import { Duration, Effect, type ManagedRuntime, Redacted, Schema } from "effect";
import {
  type Delivery,
  type Disposition,
  EnqueueFailed,
  GradeJob,
  type GradeQueue,
  handleGradeJob,
  idempotencyKey,
  type ModelRouter,
} from "./Consumer.ts";
import type { Grader } from "./Grader.ts";
import type { GradeStore } from "./GradeStore.ts";

/** Every grade shares one flow-control key, so the cap is global. */
export const FLOW_CONTROL_KEY = "grade";

/** QStash's own redeliveries, for crashes and failed republishes only. */
const QSTASH_RETRIES = 3;

/**
 * The message body. `deliveryCount` and `enqueuedAt` travel with the job because a
 * retry is a new message: the retry budget must span all of them.
 */
export const Envelope = Schema.Struct({
  job: GradeJob,
  deliveryCount: Schema.Int.pipe(Schema.positive()),
  /** Epoch ms of the first enqueue. */
  enqueuedAt: Schema.Number,
});
export type Envelope = typeof Envelope.Type;

export interface QStashConfig {
  readonly token: Redacted.Redacted;
  /** Regional QStash API, from `QSTASH_URL`. */
  readonly baseUrl: string;
  readonly currentSigningKey: Redacted.Redacted;
  readonly nextSigningKey: Redacted.Redacted;
  /** Absolute URL of the consumer route. */
  readonly consumerUrl: string;
  /** Model calls in flight, at most. Pay-as-you-go allows up to 100. */
  readonly parallelism: number;
}

/** Publishes one envelope. Separate from the SDK so the handler can be tested without QStash. */
export type Publish = (
  envelope: Envelope,
  options: { readonly deduplicationId: string; readonly delaySeconds: number },
) => Promise<void>;

export const makePublish = (config: QStashConfig): Publish => {
  const client = new Client({ token: Redacted.value(config.token), baseUrl: config.baseUrl });
  return async (envelope, options) => {
    await client.publishJSON({
      url: config.consumerUrl,
      body: envelope,
      deduplicationId: options.deduplicationId,
      delay: options.delaySeconds,
      retries: QSTASH_RETRIES,
      flowControl: { key: FLOW_CONTROL_KEY, parallelism: config.parallelism },
    });
  };
};

export const makeQueue = (publish: Publish): GradeQueue["Type"] => ({
  enqueue: (job, key = idempotencyKey(job)) =>
    Effect.flatMap(
      Effect.clockWith((clock) => clock.currentTimeMillis),
      (now) =>
        Effect.tryPromise({
          try: () =>
            publish(
              { job, deliveryCount: 1, enqueuedAt: now },
              { deduplicationId: key, delaySeconds: 0 },
            ),
          catch: (cause) => new EnqueueFailed({ message: String(cause) }),
        }),
    ),
});

/** Checks a request's `Upstash-Signature` against its body. */
export type Verify = (signature: string, body: string) => Promise<boolean>;

export const makeVerify = (config: QStashConfig): Verify => {
  const receiver = new Receiver({
    currentSigningKey: Redacted.value(config.currentSigningKey),
    nextSigningKey: Redacted.value(config.nextSigningKey),
  });
  return (signature, body) =>
    receiver.verify({ signature, body }).then(
      (valid) => valid,
      () => false,
    );
};

const decodeEnvelope = Schema.decodeUnknownOption(Schema.parseJson(Envelope));

/** What QStash should do with this delivery. 200 acknowledges; 5xx makes QStash redeliver it. */
const respond = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/**
 * The consumer route: `export const POST = QStashQueue.makeHandler({ runtime, verify, publish })`.
 */
export const makeHandler =
  (deps: {
    readonly runtime: ManagedRuntime.ManagedRuntime<GradeStore | Grader | ModelRouter, never>;
    readonly verify: Verify;
    readonly publish: Publish;
  }) =>
  async (request: Request): Promise<Response> => {
    const body = await request.text();
    const signature = request.headers.get("upstash-signature");
    if (signature === null || !(await deps.verify(signature, body))) {
      return respond(401, { error: "invalid QStash signature" });
    }
    const envelope = decodeEnvelope(body);
    if (envelope._tag === "None") {
      // Redelivering a malformed message cannot help.
      console.error("grade queue: dropping malformed message");
      return respond(200, { result: "dropped" });
    }
    const { job, enqueuedAt } = envelope.value;
    // QStash's own redeliveries of this message (after a crash) count too.
    const retried = Number(request.headers.get("upstash-retried") ?? "0");
    const delivery: Delivery = {
      deliveryCount: envelope.value.deliveryCount + (Number.isFinite(retried) ? retried : 0),
      enqueuedAt: new Date(enqueuedAt),
    };

    const disposition: Disposition = await deps.runtime.runPromise(
      handleGradeJob(job, delivery).pipe(
        Effect.withSpan("grade-job", {
          attributes: {
            submissionId: job.submissionId,
            attempt: job.attempt,
            deliveryCount: delivery.deliveryCount,
          },
        }),
      ),
    );
    if (disposition._tag === "Done") return respond(200, { result: disposition.result });

    // Come back later: a fresh, delayed message, then acknowledge this one. If the
    // publish fails, a 500 makes QStash redeliver this message instead.
    const next = delivery.deliveryCount + 1;
    try {
      await deps.publish(
        { job, deliveryCount: next, enqueuedAt },
        {
          deduplicationId: `${idempotencyKey(job)}:delivery:${next}`,
          delaySeconds: Math.ceil(Duration.toSeconds(disposition.after)),
        },
      );
    } catch (cause) {
      console.error("grade queue: could not schedule a retry", cause);
      return respond(500, { error: "could not schedule a retry" });
    }
    return respond(200, { result: "retry_scheduled", reason: disposition.reason });
  };

/**
 * Creates or updates the QStash schedule that calls the sweeper route every minute.
 * QStash schedules replace Vercel cron, which runs at most once a day on Hobby.
 * Idempotent: the fixed schedule id makes repeat calls an update.
 */
export const ensureSweepSchedule = (config: QStashConfig, sweepUrl: string) =>
  Effect.tryPromise(() =>
    new Client({ token: Redacted.value(config.token), baseUrl: config.baseUrl }).schedules.create({
      scheduleId: "grade-sweeper",
      destination: sweepUrl,
      cron: "* * * * *",
      retries: 0,
    }),
  );
