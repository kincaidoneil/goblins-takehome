/**
 * The queue consumer: one grade job in, the grade written, and a disposition
 * telling the queue whether to acknowledge the message or deliver it again later.
 *
 * It never throws. Every path ends in `Done` or `RetryLater`, and the queue
 * adapter (Vercel Queues on deploy, in-process locally) maps those onto its own
 * acknowledge and retry calls.
 */
import { GradeJob, type Lease } from "@goblins/domain";
import { Clock, Context, Duration, Effect, Layer, Option, Random, Schema } from "effect";
import * as CallLog from "./CallLog.ts";
import { Grader } from "./Grader.ts";
import { GradeStore, type StoreUnavailable } from "./GradeStore.ts";
import { BadResponse, ModelClient, Timeout } from "./ModelClient.ts";
import * as RetryPolicy from "./RetryPolicy.ts";

/** The queue message, owned by the domain package: `{ submissionId, attempt }`. */
export { GradeJob };

/** Dedupe key for the queue: one message per grade attempt, however often the producer retries the send. */
export const idempotencyKey = (job: GradeJob) => `grade:${job.submissionId}:${job.attempt}`;

/**
 * The sweeper's resends get a key that changes every 10 minutes. With the submit
 * path's key, a resend for a message the queue dropped (at `maxDeliveries`, or
 * expired) would itself be dropped for the 24-hour dedupe window.
 */
export const SWEEP_KEY_WINDOW = Duration.minutes(10);
export const sweepIdempotencyKey = (job: GradeJob, nowMs: number) =>
  `${idempotencyKey(job)}:sweep:${Math.floor(nowMs / Duration.toMillis(SWEEP_KEY_WINDOW))}`;

export interface Delivery {
  /** 1 on the first delivery. */
  readonly deliveryCount: number;
  /** When the message was first enqueued, so the retry budget spans redeliveries. */
  readonly enqueuedAt: Date;
}

export type Disposition =
  | {
      readonly _tag: "Done";
      readonly result: "graded" | "needs_teacher" | "couldnt_grade" | "skipped";
    }
  | { readonly _tag: "RetryLater"; readonly after: Duration.Duration; readonly reason: string };

/**
 * How long one delivery may spend grading, all inline tries included. Shorter than
 * the domain's 120 s claim lease, so a delivery never outlives its lease.
 */
export const DELIVERY_BUDGET = Duration.seconds(100);

/**
 * Picks the model for a grade. Load-test grades always go to the mock, whatever
 * the deploy is configured with, so a load test can never spend model budget.
 */
export class ModelRouter extends Context.Tag("@goblins/grader/ModelRouter")<
  ModelRouter,
  {
    readonly forGrade: (loadTestRunId: Option.Option<string>) => ModelClient["Type"];
  }
>() {}

const done = (result: Extract<Disposition, { _tag: "Done" }>["result"]): Disposition => ({
  _tag: "Done",
  result,
});

const retryLater = (delivery: Delivery, reason: string, after?: Duration.Duration) =>
  Effect.map(
    Random.next,
    (random): Disposition => ({
      _tag: "RetryLater",
      after: after ?? RetryPolicy.backoff(delivery.deliveryCount, random),
      reason,
    }),
  );

/** The database blipped. Retry on the normal backoff; the job is not lost. */
const retryOnStoreError = (delivery: Delivery) => (error: StoreUnavailable) =>
  retryLater(delivery, `database unavailable: ${String(error.cause)}`);

/** Records a final outcome. A stale lease means someone else (a teacher, a newer attempt) owns the grade now. */
const record = (lease: Lease, outcome: Parameters<GradeStore["Type"]["recordOutcome"]>[1]) =>
  Effect.flatMap(GradeStore, (store) => store.recordOutcome(lease, outcome));

export const handleGradeJob = (job: GradeJob, delivery: Delivery) =>
  Effect.gen(function* () {
    const store = yield* GradeStore;
    const grader = yield* Grader;
    const router = yield* ModelRouter;

    const claim = yield* store.startGrading(job);
    if (claim._tag === "Stale") return done("skipped");
    // Another delivery holds the lease. If it finishes, the next delivery sees Stale;
    // if it crashed, the lease runs out and the next delivery takes over.
    if (claim._tag === "InProgress")
      return yield* retryLater(delivery, "another delivery holds the claim");

    const { input } = claim;
    const { loadTestRunId } = input;
    const tag = {
      purpose: "grade" as const,
      subjectId: input.lease.submissionId,
      attempt: input.lease.attempt,
      ...Option.match(loadTestRunId, {
        onNone: () => ({}),
        onSome: (id) => ({ loadTestRunId: id }),
      }),
    };

    // One try: grade, then record. A reply the rubric check rejects counts as an unusable answer.
    const oneTry = grader.grade(input, tag).pipe(
      Effect.flatMap((result) =>
        record(input.lease, result).pipe(
          Effect.map((written) => ({ written, result })),
          Effect.catchTag("LinePointsMismatch", (e) =>
            Effect.fail(
              new BadResponse({ message: `line points do not fit the rubric: ${e.problem}` }),
            ),
          ),
        ),
      ),
    );
    const outcome = yield* oneTry.pipe(
      Effect.retry({
        times: RetryPolicy.policy.badResponseAttempts - 1,
        while: (e) => e._tag === "BadResponse",
      }),
      Effect.timeoutFail({
        duration: DELIVERY_BUDGET,
        onTimeout: () => new Timeout({ afterMs: Duration.toMillis(DELIVERY_BUDGET) }),
      }),
      Effect.provideService(ModelClient, router.forGrade(loadTestRunId)),
      Effect.either,
    );

    if (outcome._tag === "Right") {
      const { written, result } = outcome.right;
      if (written === "stale") return done("skipped"); // a teacher acted on it while we were grading
      return done(result._tag === "Sure" ? "graded" : "needs_teacher");
    }
    if (outcome.left._tag === "StoreUnavailable")
      return yield* retryOnStoreError(delivery)(outcome.left);

    const error = outcome.left;
    const decision = RetryPolicy.decide({
      error,
      deliveryCount: delivery.deliveryCount,
      age: Duration.millis((yield* Clock.currentTimeMillis) - delivery.enqueuedAt.getTime()),
      random: yield* Random.next,
    });
    if (decision._tag === "Retry") {
      // Hand the attempt back so the redelivery claims it at once.
      yield* store.releaseClaim(input.lease);
      return yield* retryLater(delivery, error._tag, decision.after);
    }
    const written = yield* store
      .recordOutcome(input.lease, { _tag: "Failed", failureReason: decision.reason })
      .pipe(Effect.catchTag("LinePointsMismatch", () => Effect.succeed("stale" as const)));
    return done(written === "recorded" ? "couldnt_grade" : "skipped");
  }).pipe(Effect.catchTag("StoreUnavailable", retryOnStoreError(delivery)));

/** Sends a grade job. Implemented by each queue adapter. */
export class GradeQueue extends Context.Tag("@goblins/grader/GradeQueue")<
  GradeQueue,
  {
    /** `key` overrides the default idempotency key. */
    readonly enqueue: (job: GradeJob, key?: string) => Effect.Effect<void, EnqueueFailed>;
  }
>() {}

export class EnqueueFailed extends Schema.TaggedError<EnqueueFailed>()("EnqueueFailed", {
  message: Schema.String,
}) {}

/**
 * The safety net for "no lost submissions". The submit path commits the grade row
 * before it sends the job, so a crash or queue error between the two leaves a
 * grade in `submitted` with no message. A cron calls this every minute and
 * re-enqueues anything queued for longer than any normal wait, or claimed by a
 * delivery whose lease ran out. A resend that duplicates a live message is
 * harmless: the lease and the attempt-conditional writes make it a no-op.
 */
export const sweepStuckGrades = (options: {
  readonly queuedFor: Duration.Duration;
  readonly limit: number;
}) =>
  Effect.gen(function* () {
    const store = yield* GradeStore;
    const queue = yield* GradeQueue;
    const stuck = yield* store.stuckJobs({
      queuedSeconds: Duration.toSeconds(options.queuedFor),
      limit: options.limit,
    });
    const nowMs = yield* Clock.currentTimeMillis;
    const results = yield* Effect.forEach(
      stuck,
      (job) => Effect.either(queue.enqueue(job, sweepIdempotencyKey(job, nowMs))),
      { concurrency: 10 },
    );
    return { found: stuck.length, failed: results.filter((r) => r._tag === "Left").length };
  });

/** The mock model that load-test grades use, whatever `ModelClient` the deploy is configured with. */
export class LoadTestModelClient extends Context.Tag("@goblins/grader/LoadTestModelClient")<
  LoadTestModelClient,
  ModelClient["Type"]
>() {}

/** Routes load-test grades to the mock and logs every call, real or mock. */
export const ModelRouterLive = Layer.effect(
  ModelRouter,
  Effect.gen(function* () {
    const configured = yield* ModelClient;
    const loadTest = yield* LoadTestModelClient;
    const log = yield* CallLog.CallLog;
    const configuredLogged = CallLog.wrap(configured, log);
    const loadTestLogged = CallLog.wrap(loadTest, log);
    return {
      forGrade: (loadTestRunId) =>
        Option.isNone(loadTestRunId) ? configuredLogged : loadTestLogged,
    };
  }),
);
