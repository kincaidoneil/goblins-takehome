/**
 * The queue consumer: one grade job in, the grade written, and a disposition
 * telling the queue whether to acknowledge the message or deliver it again later.
 *
 * It never throws. Every path ends in `Done` or `RetryLater`, and the queue
 * adapter (Vercel Queues on deploy, in-process locally) maps those onto its own
 * acknowledge and retry calls.
 */
import { Clock, Context, Duration, Effect, Layer, Option, Random, Schema } from "effect"
import * as CallLog from "./CallLog.ts"
import { Grader } from "./Grader.ts"
import { GradeStore, type StoreUnavailable } from "./GradeStore.ts"
import { ModelClient } from "./ModelClient.ts"
import * as RetryPolicy from "./RetryPolicy.ts"

/** The queue message. Small on purpose: everything else is read from the database. */
export const GradeJob = Schema.Struct({
  gradeId: Schema.String,
  attempt: Schema.Int.pipe(Schema.positive()),
})
export type GradeJob = typeof GradeJob.Type

/** Dedupe key for the queue: one message per grade attempt, however often the producer retries the send. */
export const idempotencyKey = (job: GradeJob) => `grade:${job.gradeId}:${job.attempt}`

export interface Delivery {
  /** 1 on the first delivery. */
  readonly deliveryCount: number
  /** When the message was first enqueued, so the retry budget spans redeliveries. */
  readonly enqueuedAt: Date
}

export type Disposition =
  | { readonly _tag: "Done"; readonly result: "graded" | "needs_teacher" | "couldnt_grade" | "skipped" }
  | { readonly _tag: "RetryLater"; readonly after: Duration.Duration; readonly reason: string }

/**
 * Picks the model for a grade. Load-test grades always go to the mock, whatever
 * the deploy is configured with, so a load test can never spend model budget.
 */
export class ModelRouter extends Context.Tag("@goblins/grader/ModelRouter")<
  ModelRouter,
  {
    readonly forGrade: (loadTestRunId: string | undefined) => ModelClient["Type"]
  }
>() {}

const done = (result: Extract<Disposition, { _tag: "Done" }>["result"]): Disposition => ({ _tag: "Done", result })

/** The database blipped. Retry on the normal backoff; the job is not lost. */
const retryOnStoreError = (delivery: Delivery) => (error: StoreUnavailable) =>
  Effect.map(Random.next, (random): Disposition => ({
    _tag: "RetryLater",
    after: RetryPolicy.backoff(delivery.deliveryCount, random),
    reason: `database unavailable: ${String(error.cause)}`,
  }))

export const handleGradeJob = (job: GradeJob, delivery: Delivery) =>
  Effect.gen(function* () {
    const store = yield* GradeStore
    const grader = yield* Grader
    const router = yield* ModelRouter

    const record = yield* store.load(job.gradeId)
    if (Option.isNone(record)) return done("skipped") // deleted, such as load-test cleanup
    const grade = record.value
    const open = grade.state === "submitted" || grade.state === "grading"
    if (grade.attempt !== job.attempt || !open) return done("skipped") // duplicate or stale delivery

    if (!(yield* store.markGrading(job.gradeId, job.attempt))) return done("skipped")

    const outcome = yield* grader.grade(grade.input).pipe(
      Effect.retry({
        times: RetryPolicy.policy.badResponseAttempts - 1,
        while: (error) => error._tag === "BadResponse",
      }),
      Effect.provideService(ModelClient, router.forGrade(grade.input.loadTestRunId)),
      Effect.either,
    )

    if (outcome._tag === "Right") {
      const written = yield* store.complete(job.gradeId, job.attempt, outcome.right)
      if (!written) return done("skipped") // a teacher acted on it while we were grading
      return done(outcome.right._tag === "Graded" ? "graded" : "needs_teacher")
    }

    const now = yield* Clock.currentTimeMillis
    const decision = RetryPolicy.decide({
      error: outcome.left,
      deliveryCount: delivery.deliveryCount,
      age: Duration.millis(now - delivery.enqueuedAt.getTime()),
      random: yield* Random.next,
    })
    if (decision._tag === "Retry") {
      return { _tag: "RetryLater", after: decision.after, reason: outcome.left._tag } satisfies Disposition
    }
    yield* store.fail(job.gradeId, job.attempt, decision.reason)
    return done("couldnt_grade")
  }).pipe(Effect.catchTag("StoreUnavailable", retryOnStoreError(delivery)))

/** Sends a grade job. Implemented by each queue adapter. */
export class GradeQueue extends Context.Tag("@goblins/grader/GradeQueue")<
  GradeQueue,
  {
    readonly enqueue: (job: GradeJob) => Effect.Effect<void, EnqueueFailed>
  }
>() {}

export class EnqueueFailed extends Schema.TaggedError<EnqueueFailed>()("EnqueueFailed", {
  message: Schema.String,
}) {}

/**
 * The safety net for "no lost submissions". The submit path commits the grade row
 * before it sends the job, so a crash or queue error between the two leaves a
 * grade in `submitted` with no message. A cron calls this every minute and
 * re-enqueues anything that has sat untouched for longer than any normal wait.
 * The queue's idempotency key drops the resend if the original message exists.
 */
export const sweepStuckGrades = (olderThan: Duration.Duration) =>
  Effect.gen(function* () {
    const store = yield* GradeStore
    const queue = yield* GradeQueue
    const now = yield* Clock.currentTimeMillis
    const stuck = yield* store.findStuck(new Date(now - Duration.toMillis(olderThan)))
    const results = yield* Effect.forEach(stuck, (job) => Effect.either(queue.enqueue(job)), {
      concurrency: 10,
    })
    return { found: stuck.length, failed: results.filter((r) => r._tag === "Left").length }
  })

/** The mock model that load-test grades use, whatever `ModelClient` the deploy is configured with. */
export class LoadTestModelClient extends Context.Tag("@goblins/grader/LoadTestModelClient")<
  LoadTestModelClient,
  ModelClient["Type"]
>() {}

/** Routes load-test grades to the mock and logs every call, real or mock. */
export const ModelRouterLive = Layer.effect(
  ModelRouter,
  Effect.gen(function* () {
    const configured = yield* ModelClient
    const loadTest = yield* LoadTestModelClient
    const log = yield* CallLog.CallLog
    const configuredLogged = CallLog.wrap(configured, log)
    const loadTestLogged = CallLog.wrap(loadTest, log)
    return {
      forGrade: (loadTestRunId) => (loadTestRunId === undefined ? configuredLogged : loadTestLogged),
    }
  }),
)
