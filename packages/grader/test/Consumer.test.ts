/**
 * Integration tests for the grading pipeline: the in-process queue, the consumer,
 * the placeholder grader, the call log and the in-memory grade store, with a
 * scripted model. Time is virtual (TestClock), so a 5-minute outage runs in milliseconds.
 */
import { describe, expect, it } from "@effect/vitest"
import { Clock, Duration, Effect, Fiber, Layer, Option, Ref, TestClock } from "effect"
import * as CallLog from "../src/CallLog.ts"
import {
  type Completion,
  type CompletionRequest,
  type ModelError,
  BadResponse,
  ProviderError,
  RateLimited,
  Timeout,
} from "../src/ModelClient.ts"
import { handleGradeJob, ModelRouter, sweepStuckGrades, GradeQueue } from "../src/Consumer.ts"
import * as Grader from "../src/Grader.ts"
import * as GradeStore from "../src/GradeStore.ts"
import * as InProcessQueue from "../src/InProcessQueue.ts"

const LATENCY = Duration.seconds(2)

const input = (gradeId: string, loadTestRunId?: string): Grader.GradeInput => ({
  gradeId,
  problem: { problemText: "Solve 2x + 3 = 11", whiteboardUrl: "data:image/png;base64,AA" },
  rubric: [
    { id: "setup", text: "correct setup", points: 1 },
    { id: "answer", text: "x = 4", points: 1 },
  ],
  dependencies: [],
  ...(loadTestRunId === undefined ? {} : { loadTestRunId }),
})

const reply = (unsure: string | null = null): Completion => ({
  id: "gen",
  model: "fake/model",
  text: JSON.stringify({
    read: "2x = 8, x = 4",
    lines: [
      { lineId: "setup", awarded: 1 },
      { lineId: "answer", awarded: 1 },
    ],
    reason: "Correct setup and answer.",
    unsure,
  }),
  usage: { promptTokens: 900, completionTokens: 60, costUsd: 0.0004 },
})

/**
 * What the scripted model does for a call: told the time since the test started
 * and how many calls it has already seen for this grade.
 */
type Script = (call: { readonly nowMs: number; readonly priorCalls: number; readonly request: CompletionRequest }) => Effect.Effect<Completion, ModelError>

const fakeModel = (script: Script) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(new Map<string, number>())
    const inFlight = yield* Ref.make(0)
    const maxInFlight = yield* Ref.make(0)
    const client = {
      complete: (request: CompletionRequest) =>
        Effect.gen(function* () {
          const key = request.tag.subjectId ?? ""
          const priorCalls = yield* Ref.modify(calls, (m) => [m.get(key) ?? 0, new Map(m).set(key, (m.get(key) ?? 0) + 1)])
          const n = yield* Ref.updateAndGet(inFlight, (x) => x + 1)
          yield* Ref.update(maxInFlight, (m) => Math.max(m, n))
          yield* Effect.sleep(LATENCY)
          const nowMs = yield* Clock.currentTimeMillis
          return yield* script({ nowMs, priorCalls, request })
        }).pipe(Effect.ensuring(Ref.update(inFlight, (x) => x - 1))),
    }
    const totalCalls = Effect.map(Ref.get(calls), (m) => [...m.values()].reduce((a, b) => a + b, 0))
    return { client, totalCalls, maxInFlight: Ref.get(maxInFlight) }
  })

const always = (completion: Completion): Script => () => Effect.succeed(completion)

const setup = (options: { readonly script: Script; readonly concurrency?: number; readonly loadTestScript?: Script }) =>
  Effect.gen(function* () {
    const store = yield* GradeStore.inMemory
    const log = yield* CallLog.inMemory
    const model = yield* fakeModel(options.script)
    const loadTestModel = yield* fakeModel(options.loadTestScript ?? always(reply()))
    const router: ModelRouter["Type"] = {
      forGrade: (runId) => CallLog.wrap(runId === undefined ? model.client : loadTestModel.client, log.service),
    }
    const services = Layer.mergeAll(
      Layer.succeed(GradeStore.GradeStore, store.service),
      Layer.succeed(Grader.Grader, Grader.placeholder),
      Layer.succeed(ModelRouter, router),
    )
    const queue = yield* InProcessQueue.make({
      concurrency: options.concurrency ?? 4,
      handle: (job, delivery) => handleGradeJob(job, delivery).pipe(Effect.provide(services)),
    })
    /** What the app's submit path does: write the grade, then send the job. */
    const submit = (i: Grader.GradeInput) =>
      Effect.zipRight(store.insert(i), queue.queue.enqueue({ gradeId: i.gradeId, attempt: 1 }))
    const grade = (id: string) =>
      Effect.map(store.all, (all) => all.find((g) => g.gradeId === id))
    return { store, log, model, loadTestModel, queue, submit, grade, services }
  })

/** Advances virtual time in 1 s steps until the effect finishes. Returns the virtual time it took. */
const runUntilDone = <A, E>(effect: Effect.Effect<A, E>, limit = Duration.hours(2)) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis
    const fiber = yield* Effect.fork(effect)
    while (Option.isNone(yield* Fiber.poll(fiber))) {
      if ((yield* Clock.currentTimeMillis) - start > Duration.toMillis(limit)) {
        return yield* Effect.dieMessage("did not finish within the time limit")
      }
      yield* TestClock.adjust("1 second")
    }
    const value = yield* Fiber.join(fiber)
    return { value, elapsed: Duration.millis((yield* Clock.currentTimeMillis) - start) }
  })

const states = (all: ReadonlyArray<GradeStore.StoredGrade>) =>
  all.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.state]: (acc[g.state] ?? 0) + 1 }), {})

describe("grading pipeline", () => {
  it.effect("grades every submission and never exceeds the concurrency cap", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()), concurrency: 4 })
      yield* Effect.forEach(Array.from({ length: 40 }, (_, i) => input(`g${i}`)), t.submit)
      yield* runUntilDone(t.queue.drained)

      expect(states(yield* t.store.all)).toEqual({ graded: 40 })
      expect(yield* t.model.maxInFlight).toBe(4)
      expect((yield* t.queue.stats).maxInFlight).toBe(4)
      const rows = yield* t.log.rows
      expect(rows).toHaveLength(40)
      expect(rows.every((r) => r.status === "ok" && r.latencyMs === 2000 && r.costUsd === 0.0004)).toBe(true)
    }),
  )

  it.effect("stores the grader's best guess and reason when it is unsure", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply("Handwriting on line 2 is unclear")) })
      yield* t.submit(input("g1"))
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({
        state: "needs_teacher",
        outcome: { _tag: "NeedsTeacher", flag: "Handwriting on line 2 is unclear", assessment: { read: "2x = 8, x = 4" } },
      })
    }),
  )

  it.effect("retries rate limits, timeouts and 5xx with backoff, then grades", () =>
    Effect.gen(function* () {
      const failures: ReadonlyArray<ModelError> = [
        new RateLimited({ retryAfterMs: 5_000 }),
        new Timeout({ afterMs: 45_000 }),
        new ProviderError({ status: 503, message: "overloaded" }),
      ]
      const t = yield* setup({
        script: ({ priorCalls }) => {
          const failure = failures[priorCalls]
          return failure === undefined ? Effect.succeed(reply()) : Effect.fail(failure)
        },
      })
      yield* Effect.forEach(["a", "b", "c"].map((id) => input(id)), t.submit)
      const { elapsed } = yield* runUntilDone(t.queue.drained)

      expect(states(yield* t.store.all)).toEqual({ graded: 3 })
      expect(yield* t.model.totalCalls).toBe(12)
      expect((yield* t.queue.stats).deliveries).toBe(12)
      const rows = yield* t.log.rows
      expect(rows.filter((r) => r.subjectId === "a").map((r) => r.status)).toEqual([
        "rate_limited",
        "timeout",
        "provider_error",
        "ok",
      ])
      // 2 s latency per call, plus waits of at least 5 s (Retry-After), ~4 s and ~8 s.
      expect(Duration.toSeconds(elapsed)).toBeLessThan(40)
    }),
  )

  it.effect("a 5-minute provider outage delays grades but fails none", () =>
    Effect.gen(function* () {
      const outageEndsMs = Duration.toMillis(Duration.minutes(5))
      const t = yield* setup({
        script: ({ nowMs }) =>
          nowMs < outageEndsMs
            ? Effect.fail(new ProviderError({ status: 503, message: "provider down" }))
            : Effect.succeed(reply()),
        concurrency: 8,
      })
      // A class of 30 submits over the first two minutes of the outage.
      const submissions = Effect.forEach(
        Array.from({ length: 30 }, (_, i) => i),
        (i) => Effect.zipRight(Effect.sleep(Duration.seconds(4)), t.submit(input(`s${i}`))),
      )
      yield* runUntilDone(Effect.zipRight(submissions, t.queue.drained))

      const all = yield* t.store.all
      expect(states(all)).toEqual({ graded: 30 })
      // Backoff is capped at 60 s (plus 20% jitter), so every grade lands within
      // about a minute of the provider coming back.
      const lastGradedMs = Math.max(...all.map((g) => g.updatedAt.getTime()))
      expect(lastGradedMs - outageEndsMs).toBeLessThan(Duration.toMillis(Duration.seconds(80)))
      const failedCalls = (yield* t.log.rows).filter((r) => r.status === "provider_error")
      expect(failedCalls.length).toBeGreaterThan(30)
    }),
  )

  it.effect("marks a grade couldn't-grade once the provider has been down for 15 minutes", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: () => Effect.fail(new ProviderError({ status: 502, message: "bad gateway" })) })
      yield* t.submit(input("g1"))
      const { elapsed } = yield* runUntilDone(t.queue.drained)

      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade", failure: expect.stringContaining("bad gateway") })
      expect(Duration.toMinutes(elapsed)).toBeGreaterThanOrEqual(15)
      expect(Duration.toMinutes(elapsed)).toBeLessThan(17)
    }),
  )

  it.effect("gives up at once on an error that retrying cannot fix", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: () => Effect.fail(new ProviderError({ status: 402, message: "Insufficient credits" })) })
      yield* t.submit(input("g1"))
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade" })
      expect(yield* t.model.totalCalls).toBe(1)
    }),
  )

  it.effect("retries an unusable answer twice in the same delivery, then gives up", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always({ ...reply(), text: "not json" }) })
      yield* t.submit(input("g1"))
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade" })
      expect(yield* t.model.totalCalls).toBe(3)
      expect((yield* t.queue.stats).deliveries).toBe(1)
      // The bad answers were still billed, and the log shows it.
      expect((yield* t.log.rows).map((r) => r.status)).toEqual(["ok", "ok", "ok"])
    }),
  )

  it.effect("recovers from a single unusable answer", () =>
    Effect.gen(function* () {
      const t = yield* setup({
        script: ({ priorCalls }) =>
          priorCalls === 0 ? Effect.fail(new BadResponse({ message: "cut off" })) : Effect.succeed(reply()),
      })
      yield* t.submit(input("g1"))
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded" })
    }),
  )
})

describe("idempotency under at-least-once delivery", () => {
  it.effect("a duplicate send is dropped, and a redelivery after grading changes nothing", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) })
      yield* t.submit(input("g1"))
      yield* t.queue.queue.enqueue({ gradeId: "g1", attempt: 1 })
      yield* runUntilDone(t.queue.drained)
      expect((yield* t.queue.stats).deliveries).toBe(1)

      const before = yield* t.grade("g1")
      const redelivered = yield* handleGradeJob(
        { gradeId: "g1", attempt: 1 },
        { deliveryCount: 2, enqueuedAt: new Date(0) },
      ).pipe(Effect.provide(t.services))
      expect(redelivered).toEqual({ _tag: "Done", result: "skipped" })
      expect(yield* t.grade("g1")).toEqual(before)
      expect(yield* t.model.totalCalls).toBe(1)
    }),
  )

  it.effect("two deliveries of the same job at once write one grade", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) })
      yield* t.store.insert(input("g1"))
      const job = { gradeId: "g1", attempt: 1 }
      const both = Effect.all(
        [
          handleGradeJob(job, { deliveryCount: 1, enqueuedAt: new Date(0) }),
          handleGradeJob(job, { deliveryCount: 2, enqueuedAt: new Date(0) }),
        ],
        { concurrency: 2 },
      ).pipe(Effect.provide(t.services))
      const { value } = yield* runUntilDone(both)
      expect(value.map((d) => (d._tag === "Done" ? d.result : d._tag)).sort()).toEqual(["graded", "skipped"])
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded" })
    }),
  )

  it.effect("a stale job from before a teacher's retry is ignored, and the retry grades", () =>
    Effect.gen(function* () {
      let down = true
      const t = yield* setup({
        script: () =>
          down ? Effect.fail(new ProviderError({ status: 400, message: "bad request" })) : Effect.succeed(reply()),
      })
      yield* t.submit(input("g1"))
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade", attempt: 1 })

      down = false
      const attempt = yield* t.store.teacherRetry("g1")
      expect(attempt).toEqual(Option.some(2))
      const stale = yield* handleGradeJob(
        { gradeId: "g1", attempt: 1 },
        { deliveryCount: 3, enqueuedAt: new Date(0) },
      ).pipe(Effect.provide(t.services))
      expect(stale).toEqual({ _tag: "Done", result: "skipped" })

      yield* t.queue.queue.enqueue({ gradeId: "g1", attempt: 2 })
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded", attempt: 2 })
    }),
  )

  it.effect("a teacher's score made while the model is grading is not overwritten", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) })
      yield* t.store.insert(input("g1"))
      const fiber = yield* Effect.fork(
        handleGradeJob({ gradeId: "g1", attempt: 1 }, { deliveryCount: 1, enqueuedAt: new Date(0) }).pipe(
          Effect.provide(t.services),
        ),
      )
      yield* TestClock.adjust("500 millis")
      // The teacher retries (bumping the attempt) while the model call is in flight.
      yield* t.store.teacherRetry("g1")
      yield* TestClock.adjust(LATENCY)
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Done", result: "skipped" })
      expect(yield* t.grade("g1")).toMatchObject({ state: "submitted", attempt: 2 })
    }),
  )
})

describe("load-test routing", () => {
  it.effect("load-test grades use the load-test model and are tagged in the call log", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) })
      yield* t.submit(input("real"))
      yield* t.submit(input("lt", "run_42"))
      yield* runUntilDone(t.queue.drained)

      expect(yield* t.model.totalCalls).toBe(1)
      expect(yield* t.loadTestModel.totalCalls).toBe(1)
      expect((yield* t.log.rows).map((r) => [r.subjectId, r.loadTestRunId])).toEqual(
        expect.arrayContaining([
          ["real", undefined],
          ["lt", "run_42"],
        ]),
      )
    }),
  )
})

describe("no lost submissions", () => {
  it.effect("the sweeper re-sends a grade whose job never reached the queue", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) })
      // The submit path committed the grade, then crashed before sending the job.
      yield* t.store.insert(input("orphan"))
      yield* t.submit(input("normal"))
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("orphan")).toMatchObject({ state: "submitted" })

      yield* TestClock.adjust("5 minutes")
      const swept = yield* sweepStuckGrades(Duration.minutes(3)).pipe(
        Effect.provide(Layer.merge(t.services, Layer.succeed(GradeQueue, t.queue.queue))),
      )
      expect(swept).toEqual({ found: 1, failed: 0 })
      yield* runUntilDone(t.queue.drained)
      expect(yield* t.grade("orphan")).toMatchObject({ state: "graded" })
    }),
  )

  it.effect("a database outage while writing the grade is retried, not dropped", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) })
      const failures = yield* Ref.make(2)
      const flaky: GradeStore.GradeStore["Type"] = {
        ...t.store.service,
        complete: (...args) =>
          Effect.flatMap(Ref.getAndUpdate(failures, (n) => n - 1), (n) =>
            n > 0 ? Effect.fail(new GradeStore.StoreUnavailable({ cause: "connection refused" })) : t.store.service.complete(...args),
          ),
      }
      const queue = yield* InProcessQueue.make({
        concurrency: 1,
        handle: (job, delivery) =>
          handleGradeJob(job, delivery).pipe(
            Effect.provide(Layer.merge(t.services, Layer.succeed(GradeStore.GradeStore, flaky))),
          ),
      })
      yield* t.store.insert(input("g1"))
      yield* queue.queue.enqueue({ gradeId: "g1", attempt: 1 })
      yield* runUntilDone(queue.drained)
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded" })
      expect((yield* queue.stats).deliveries).toBe(3)
    }),
  )
})
