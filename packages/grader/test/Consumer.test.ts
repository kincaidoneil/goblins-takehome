/**
 * Integration tests for the grading pipeline: the in-process queue, the consumer,
 * the placeholder grader, the call log and the in-memory grade store, with a
 * scripted model. Time is virtual (TestClock), so a 5-minute outage runs in
 * seconds. `Consumer.pg.test.ts` runs the key scenarios against real Postgres.
 */

import { describe, expect, it } from "@effect/vitest";
import { Attempt } from "@goblins/domain";
import { Duration, Effect, Fiber, Layer, Option, Ref, TestClock } from "effect";
import * as CallLog from "../src/CallLog.ts";
import {
  GradeQueue,
  handleGradeJob,
  idempotencyKey,
  ModelRouter,
  sweepIdempotencyKey,
  sweepStuckGrades,
} from "../src/Consumer.ts";
import * as Grader from "../src/Grader.ts";
import * as GradeStore from "../src/GradeStore.ts";
import * as InProcessQueue from "../src/InProcessQueue.ts";
import {
  BadResponse,
  type ModelError,
  ProviderError,
  RateLimited,
  Timeout,
} from "../src/ModelClient.ts";
import {
  ANSWER,
  always,
  fakeModel,
  LATENCY,
  material,
  fullMarks as reply,
  reply as replyFor,
  runUntilDone,
  type Script,
  SETUP,
  sub,
} from "./fixtures.ts";

const setup = (options: { readonly script: Script; readonly concurrency?: number }) =>
  Effect.gen(function* () {
    const store = yield* GradeStore.inMemory;
    const log = yield* CallLog.inMemory;
    const model = yield* fakeModel(options.script);
    const loadTestModel = yield* fakeModel(always(reply()));
    const router: ModelRouter["Type"] = {
      forGrade: (runId) =>
        CallLog.wrap(
          Option.isNone(runId) ? model.client : loadTestModel.client,
          log.service,
          "mock",
        ),
    };
    const services = Layer.mergeAll(
      Layer.succeed(GradeStore.GradeStore, store.service),
      Layer.succeed(Grader.Grader, Grader.placeholder),
      Layer.succeed(ModelRouter, router),
    );
    const queue = yield* InProcessQueue.make({
      concurrency: options.concurrency ?? 4,
      handle: (job, delivery) => handleGradeJob(job, delivery).pipe(Effect.provide(services)),
    });
    /** What the app's submit path does: write the grade, then send the job. */
    const submit = (name: string, loadTestRunId?: string) =>
      Effect.flatMap(store.insert(sub(name), material(loadTestRunId)), (job) =>
        queue.queue.enqueue(job),
      );
    const grade = (name: string) => store.get(sub(name));
    const handle = (name: string, attempt: number, deliveryCount: number) =>
      handleGradeJob(
        { submissionId: sub(name), attempt: Attempt.make(attempt) },
        { deliveryCount, enqueuedAt: new Date(0) },
      ).pipe(Effect.provide(services));
    return { store, log, model, loadTestModel, queue, submit, grade, handle, services };
  });

const states = (all: ReadonlyArray<GradeStore.MemoryGrade>) => {
  const counts: Record<string, number> = {};
  for (const g of all) counts[g.state] = (counts[g.state] ?? 0) + 1;
  return counts;
};

const names = (n: number, prefix = "s") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("grading pipeline", () => {
  it.effect("grades every submission and never exceeds the concurrency cap", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()), concurrency: 4 });
      yield* Effect.forEach(names(40), (n) => t.submit(n));
      yield* runUntilDone(t.queue.drained);

      expect(states(yield* t.store.all)).toEqual({ graded: 40 });
      expect(yield* t.model.maxInFlight).toBe(4);
      expect((yield* t.queue.stats).maxInFlight).toBe(4);
      const rows = yield* t.log.rows;
      expect(rows).toHaveLength(40);
      expect(
        rows.every(
          (r) =>
            r.status === "ok" &&
            r.latencyMs === 2000 &&
            r.cost?.costUsd === 0.0004 &&
            r.attempt === 1,
        ),
      ).toBe(true);
    }),
  );

  it.effect("stores the grader's best guess and reason when it is unsure", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply("Handwriting on line 2 is unclear")) });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({
        state: "needs_teacher",
        outcome: Option.some({
          _tag: "Unsure",
          flagReason: "Handwriting on line 2 is unclear",
          result: { read: "2x = 8, x = 4" },
        }),
      });
    }),
  );

  it.effect("retries rate limits, timeouts and 5xx with backoff, then grades", () =>
    Effect.gen(function* () {
      const failures: ReadonlyArray<ModelError> = [
        new RateLimited({ retryAfterMs: 5_000 }),
        new Timeout({ afterMs: 45_000 }),
        new ProviderError({ status: 503, message: "overloaded" }),
      ];
      const t = yield* setup({
        script: ({ priorCalls }) => {
          const failure = failures[priorCalls];
          return failure === undefined ? Effect.succeed(reply()) : Effect.fail(failure);
        },
      });
      yield* Effect.forEach(["a", "b", "c"], (n) => t.submit(n));
      const { elapsed } = yield* runUntilDone(t.queue.drained);

      expect(states(yield* t.store.all)).toEqual({ graded: 3 });
      expect(yield* t.model.totalCalls).toBe(12);
      expect((yield* t.queue.stats).deliveries).toBe(12);
      const rows = yield* t.log.rows;
      expect(rows.filter((r) => r.subjectId === sub("a")).map((r) => r.status)).toEqual([
        "rate_limited",
        "timeout",
        "provider_error",
        "ok",
      ]);
      // 2 s latency per call, plus waits of at least 5 s (Retry-After), ~4 s and ~8 s.
      expect(Duration.toSeconds(elapsed)).toBeLessThan(40);
    }),
  );

  it.effect("a 5-minute provider outage delays grades but fails none", () =>
    Effect.gen(function* () {
      const outageEndsMs = Duration.toMillis(Duration.minutes(5));
      const t = yield* setup({
        script: ({ nowMs }) =>
          nowMs < outageEndsMs
            ? Effect.fail(new ProviderError({ status: 503, message: "provider down" }))
            : Effect.succeed(reply()),
        concurrency: 8,
      });
      // A class of 30 submits over the first two minutes of the outage.
      const submissions = Effect.forEach(names(30), (n) =>
        Effect.zipRight(Effect.sleep(Duration.seconds(4)), t.submit(n)),
      );
      yield* runUntilDone(Effect.zipRight(submissions, t.queue.drained));

      const all = yield* t.store.all;
      expect(states(all)).toEqual({ graded: 30 });
      // Backoff is capped at 60 s (plus 20% jitter), so every grade lands within
      // about a minute of the provider coming back.
      const lastGradedMs = Math.max(...all.map((g) => g.updatedAtMs));
      expect(lastGradedMs - outageEndsMs).toBeLessThan(Duration.toMillis(Duration.seconds(80)));
      expect(
        (yield* t.log.rows).filter((r) => r.status === "provider_error").length,
      ).toBeGreaterThan(30);
    }),
  );

  it.effect("marks a grade couldn't-grade once the provider has been down for 15 minutes", () =>
    Effect.gen(function* () {
      const t = yield* setup({
        script: () => Effect.fail(new ProviderError({ status: 502, message: "bad gateway" })),
      });
      yield* t.submit("g1");
      const { elapsed } = yield* runUntilDone(t.queue.drained);

      expect(yield* t.grade("g1")).toMatchObject({
        state: "couldnt_grade",
        outcome: Option.some({
          _tag: "Failed",
          failureReason: expect.stringContaining("bad gateway"),
        }),
      });
      expect(Duration.toMinutes(elapsed)).toBeGreaterThanOrEqual(15);
      expect(Duration.toMinutes(elapsed)).toBeLessThan(17);
    }),
  );

  it.effect("gives up at once on an error that retrying cannot fix", () =>
    Effect.gen(function* () {
      const t = yield* setup({
        script: () =>
          Effect.fail(new ProviderError({ status: 402, message: "Insufficient credits" })),
      });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade" });
      expect(yield* t.model.totalCalls).toBe(1);
    }),
  );

  it.effect("retries an unusable answer twice in the same delivery, then gives up", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always({ ...reply(), text: "not json" }) });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade" });
      expect(yield* t.model.totalCalls).toBe(3);
      expect((yield* t.queue.stats).deliveries).toBe(1);
      // The bad answers were still billed, and the log shows it.
      expect((yield* t.log.rows).map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    }),
  );

  it.effect("treats a reply that scores a rubric line twice as unusable", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(replyFor([SETUP, SETUP, ANSWER])) });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade" });
      expect(yield* t.model.totalCalls).toBe(3);
    }),
  );

  it.effect("does not pay twice for an answer cut off at max tokens", () =>
    Effect.gen(function* () {
      const t = yield* setup({
        script: () => Effect.fail(new BadResponse({ message: "cut off", truncated: true })),
      });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade" });
      expect(yield* t.model.totalCalls).toBe(1);
    }),
  );

  it.effect("recovers from a single unusable answer", () =>
    Effect.gen(function* () {
      const t = yield* setup({
        script: ({ priorCalls }) =>
          priorCalls === 0
            ? Effect.fail(new BadResponse({ message: "cut off" }))
            : Effect.succeed(reply()),
      });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded" });
    }),
  );

  it.effect("caps one delivery's grading time, then retries on a later delivery", () =>
    Effect.gen(function* () {
      // Each call hangs for 80 s, then answers unusably, so two tries overrun the 100 s budget.
      const t = yield* setup({
        script: ({ priorCalls }) =>
          priorCalls < 2
            ? Effect.zipRight(
                Effect.sleep("78 seconds"),
                Effect.fail(new BadResponse({ message: "cut off" })),
              )
            : Effect.succeed(reply()),
      });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded" });
      expect((yield* t.queue.stats).deliveries).toBe(2);
    }),
  );
});

describe("idempotency under at-least-once delivery", () => {
  it.effect("a duplicate send is dropped, and a redelivery after grading changes nothing", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      yield* t.submit("g1");
      yield* t.queue.queue.enqueue({ submissionId: sub("g1"), attempt: Attempt.make(1) });
      yield* runUntilDone(t.queue.drained);
      expect((yield* t.queue.stats).deliveries).toBe(1);

      const before = yield* t.grade("g1");
      expect(yield* t.handle("g1", 1, 2)).toEqual({ _tag: "Done", result: "skipped" });
      expect(yield* t.grade("g1")).toEqual(before);
      expect(yield* t.model.totalCalls).toBe(1);
    }),
  );

  it.effect("two deliveries of the same job at once make one model call and write one grade", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      yield* t.store.insert(sub("g1"), material());
      const { value } = yield* runUntilDone(
        Effect.all([t.handle("g1", 1, 1), t.handle("g1", 1, 2)], { concurrency: 2 }),
      );
      // The second delivery finds the lease held and asks to come back later.
      expect(value.map((d) => (d._tag === "Done" ? d.result : d._tag)).sort()).toEqual([
        "RetryLater",
        "graded",
      ]);
      expect(yield* t.model.totalCalls).toBe(1);
      expect(yield* t.handle("g1", 1, 3)).toEqual({ _tag: "Done", result: "skipped" });
    }),
  );

  it.effect("a delivery whose consumer crashed is taken over once the lease runs out", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      yield* t.store.insert(sub("g1"), material());
      // The first delivery claims the grade, then its function dies mid-call.
      const crashed = yield* Effect.fork(t.handle("g1", 1, 1));
      yield* TestClock.adjust("1 second");
      yield* Fiber.interrupt(crashed);
      expect(yield* t.grade("g1")).toMatchObject({ state: "grading" });

      const early = yield* t.handle("g1", 1, 2);
      expect(early._tag).toBe("RetryLater");
      yield* TestClock.adjust("2 minutes");
      const { value } = yield* runUntilDone(t.handle("g1", 1, 3));
      expect(value).toEqual({ _tag: "Done", result: "graded" });
    }),
  );

  it.effect("a stale job from before a teacher's retry is ignored, and the retry grades", () =>
    Effect.gen(function* () {
      const broken = yield* Ref.make(true);
      const t = yield* setup({
        script: () =>
          Effect.flatMap(Ref.get(broken), (b) =>
            b
              ? Effect.fail(new ProviderError({ status: 400, message: "bad request" }))
              : Effect.succeed(reply()),
          ),
      });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "couldnt_grade", attempt: 1 });

      yield* Ref.set(broken, false);
      const retry = yield* t.store.teacherRetry(sub("g1"));
      expect(retry).toEqual(Option.some({ submissionId: sub("g1"), attempt: 2 }));
      expect(yield* t.handle("g1", 1, 3)).toEqual({ _tag: "Done", result: "skipped" });

      yield* t.queue.queue.enqueue({ submissionId: sub("g1"), attempt: Attempt.make(2) });
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded", attempt: 2 });
    }),
  );

  it.effect("a teacher's retry while the model is grading wins over the in-flight result", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      yield* t.store.insert(sub("g1"), material());
      const fiber = yield* Effect.fork(t.handle("g1", 1, 1));
      yield* TestClock.adjust("500 millis");
      yield* t.store.teacherRetry(sub("g1"));
      yield* TestClock.adjust(LATENCY);
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Done", result: "skipped" });
      expect(yield* t.grade("g1")).toMatchObject({ state: "submitted", attempt: 2 });
    }),
  );
});

describe("load-test routing", () => {
  it.effect("load-test grades use the load-test model and are tagged in the call log", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      yield* t.submit("real");
      yield* t.submit("lt", "run_42");
      yield* runUntilDone(t.queue.drained);

      expect(yield* t.model.totalCalls).toBe(1);
      expect(yield* t.loadTestModel.totalCalls).toBe(1);
      expect((yield* t.log.rows).map((r) => [r.subjectId, r.loadTestRunId])).toEqual(
        expect.arrayContaining([
          [sub("real"), undefined],
          [sub("lt"), "run_42"],
        ]),
      );
    }),
  );
});

describe("no lost submissions", () => {
  it.effect("the sweeper re-sends a grade whose job never reached the queue", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      // The submit path committed the grade, then crashed before sending the job.
      yield* t.store.insert(sub("orphan"), material());
      yield* t.submit("normal");
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("orphan")).toMatchObject({ state: "submitted" });

      yield* TestClock.adjust("5 minutes");
      const swept = yield* sweepStuckGrades({ queuedFor: Duration.minutes(3), limit: 100 }).pipe(
        Effect.provide(Layer.merge(t.services, Layer.succeed(GradeQueue, t.queue.queue))),
      );
      expect(swept).toEqual({ found: 1, failed: 0 });
      yield* runUntilDone(t.queue.drained);
      expect(yield* t.grade("orphan")).toMatchObject({ state: "graded" });
    }),
  );

  it("sweeper resends are not swallowed by the dedupe of the message they replace", () => {
    const job = { submissionId: sub("g1"), attempt: Attempt.make(1) };
    const tenMinutes = Duration.toMillis(Duration.minutes(10));
    expect(sweepIdempotencyKey(job, 0)).not.toBe(idempotencyKey(job));
    expect(sweepIdempotencyKey(job, 0)).toBe(sweepIdempotencyKey(job, tenMinutes - 1));
    expect(sweepIdempotencyKey(job, 0)).not.toBe(sweepIdempotencyKey(job, tenMinutes));
  });

  it.effect("a database outage while writing the grade is retried, not dropped", () =>
    Effect.gen(function* () {
      const t = yield* setup({ script: always(reply()) });
      const failures = yield* Ref.make(2);
      const flaky: GradeStore.GradeStore["Type"] = {
        ...t.store.service,
        recordOutcome: (lease, outcome) =>
          Effect.flatMap(
            Ref.getAndUpdate(failures, (n) => n - 1),
            (n) =>
              n > 0
                ? Effect.fail(new GradeStore.StoreUnavailable({ cause: "connection refused" }))
                : t.store.service.recordOutcome(lease, outcome),
          ),
      };
      const queue = yield* InProcessQueue.make({
        concurrency: 1,
        handle: (job, delivery) =>
          handleGradeJob(job, delivery).pipe(
            Effect.provide(Layer.merge(t.services, Layer.succeed(GradeStore.GradeStore, flaky))),
          ),
      });
      yield* Effect.flatMap(t.store.insert(sub("g1"), material()), (job) =>
        queue.queue.enqueue(job),
      );
      yield* runUntilDone(queue.drained);
      expect(yield* t.grade("g1")).toMatchObject({ state: "graded" });
    }),
  );
});

describe("placeholderRender (mock answers in the placeholder's format)", () => {
  const graded = (answer: Grader.MockAnswer) =>
    Effect.gen(function* () {
      const t = yield* setup({
        script: ({ request }) =>
          Effect.succeed({ ...reply(), text: Grader.placeholderRender(answer, request) }),
      });
      yield* t.submit("g1");
      yield* runUntilDone(t.queue.drained);
      return yield* t.grade("g1");
    });

  it.effect("a full-marks mock answer grades every rubric line in full", () =>
    Effect.gen(function* () {
      const g = yield* graded({ _tag: "Graded", score: 2, maxScore: 2, feedback: "Correct" });
      expect(g).toMatchObject({
        state: "graded",
        outcome: Option.some({
          _tag: "Sure",
          result: {
            linePoints: [
              { rubricLineId: SETUP, points: 1 },
              { rubricLineId: ANSWER, points: 1 },
            ],
          },
        }),
      });
    }),
  );

  it.effect("a half-marks answer fills lines in order, and a flagged one needs the teacher", () =>
    Effect.gen(function* () {
      const half = yield* graded({ _tag: "Graded", score: 1, maxScore: 2, feedback: "Setup only" });
      expect(half).toMatchObject({
        outcome: Option.some({
          result: {
            linePoints: [
              { rubricLineId: SETUP, points: 1 },
              { rubricLineId: ANSWER, points: 0 },
            ],
          },
        }),
      });
      const flagged = yield* graded({ _tag: "NeedsTeacher", reason: "Illegible" });
      expect(flagged).toMatchObject({
        state: "needs_teacher",
        outcome: Option.some({ _tag: "Unsure", flagReason: "Illegible" }),
      });
    }),
  );
});
