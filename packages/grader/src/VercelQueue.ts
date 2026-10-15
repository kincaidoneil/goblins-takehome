/**
 * The Vercel Queues adapter: sends grade jobs and turns push deliveries into
 * `handleGradeJob` calls.
 *
 * The concurrency cap is not set here. It is `maxConcurrency` on the function's
 * `queue/v2beta` trigger in vercel.json (see this package's README); Vercel
 * holds back deliveries while that many are in flight.
 */
import { QueueClient } from "@vercel/queue";
import { Duration, Effect, type ManagedRuntime, Schema } from "effect";
import {
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

export const TOPIC = "grade";

/**
 * Seven days, the maximum. A job only needs minutes, but if the consumer is broken
 * by a bad deploy, the messages wait for a fix instead of expiring overnight.
 */
const RETENTION_SECONDS = 7 * 24 * 60 * 60;

export const makeQueue = (client: QueueClient = new QueueClient()): GradeQueue["Type"] => ({
  enqueue: (job, key = idempotencyKey(job)) =>
    Effect.tryPromise({
      try: () =>
        client.send(TOPIC, job, { idempotencyKey: key, retentionSeconds: RETENTION_SECONDS }),
      catch: (cause) => new EnqueueFailed({ message: String(cause) }),
    }).pipe(Effect.asVoid),
});

/** The SDK's only way to ask for redelivery is a thrown error, so the adapter throws this one. */
class RetryLater extends Error {
  constructor(
    readonly afterSeconds: number,
    reason: string,
  ) {
    super(`retry in ${afterSeconds}s: ${reason}`);
  }
}

/** Redelivery delay after an unexpected crash (a defect, not a modeled failure). */
const CRASH_RETRY_SECONDS = 10;

const decodeJob = Schema.decodeUnknownOption(GradeJob);

/**
 * The push-mode route handler: `export const POST = VercelQueue.makeHandler(runtime)`.
 * A message that is not a valid job is acknowledged and logged, since redelivering it cannot help.
 */
export const makeHandler = (
  runtime: ManagedRuntime.ManagedRuntime<GradeStore | Grader | ModelRouter, never>,
  client: QueueClient = new QueueClient(),
) =>
  client.handleCallback(
    async (message, metadata) => {
      const job = decodeJob(message);
      if (job._tag === "None") {
        console.error("grade queue: dropping malformed message", metadata.messageId);
        return;
      }
      const disposition: Disposition = await runtime.runPromise(
        handleGradeJob(job.value, {
          deliveryCount: metadata.deliveryCount,
          enqueuedAt: metadata.createdAt,
        }).pipe(
          Effect.withSpan("grade-job", {
            attributes: {
              submissionId: job.value.submissionId,
              attempt: job.value.attempt,
              deliveryCount: metadata.deliveryCount,
            },
          }),
        ),
      );
      if (disposition._tag === "RetryLater") {
        throw new RetryLater(Math.ceil(Duration.toSeconds(disposition.after)), disposition.reason);
      }
    },
    {
      // Long enough for one delivery's worst case: three model calls at the 45 s timeout, plus writes.
      visibilityTimeoutSeconds: 300,
      retry: (error) =>
        error instanceof RetryLater
          ? { afterSeconds: error.afterSeconds }
          : { afterSeconds: CRASH_RETRY_SECONDS },
    },
  );
