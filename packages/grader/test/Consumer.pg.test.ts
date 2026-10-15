/**
 * The pipeline against real Postgres: PGlite (Postgres compiled to WASM) migrated
 * with the domain package's checked-in migrations, through the same
 * @effect/sql-pg client as production, and the domain's own pipeline functions.
 * Checks that the in-memory store's rules match the real ones on the cases that matter.
 */

import { fileURLToPath } from "node:url";
import { expect, layer } from "@effect/vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  Db,
  databaseLayer,
  getGrade,
  JoinCode,
  joinSession,
  retryGrade,
  type SubmissionId,
  schema,
  submitWork,
} from "@goblins/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Duration, Effect, Layer, Option } from "effect";
import * as CallLog from "../src/CallLog.ts";
import { GradeQueue, handleGradeJob, ModelRouter, sweepStuckGrades } from "../src/Consumer.ts";
import * as Grader from "../src/Grader.ts";
import * as GradeStore from "../src/GradeStore.ts";
import * as InProcessQueue from "../src/InProcessQueue.ts";
import { ProviderError } from "../src/ModelClient.ts";
import { always, fakeModel, reply, runUntilDone, type Script } from "./fixtures.ts";

const migrationsFolder = fileURLToPath(new URL("../../domain/migrations", import.meta.url));

const TestDatabase = Layer.unwrapScoped(
  Effect.gen(function* () {
    const pglite = yield* Effect.acquireRelease(
      Effect.promise(() => PGlite.create()),
      (db) => Effect.promise(() => db.close()),
    );
    yield* Effect.promise(() => migrate(drizzle(pglite), { migrationsFolder }));
    const server = new PGLiteSocketServer({ db: pglite, port: 0, host: "127.0.0.1" });
    yield* Effect.acquireRelease(
      Effect.promise(() => server.start()),
      () => Effect.promise(() => server.stop()),
    );
    return databaseLayer({
      url: `postgres://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`,
      maxConnections: 1,
    });
  }),
);

const first = <A>(rows: ReadonlyArray<A>): Effect.Effect<A> =>
  rows[0] === undefined ? Effect.dieMessage("expected a row") : Effect.succeed(rows[0]);

let codes = 200000;

/** A teacher, a one-problem assignment with two rubric lines, and a live session. */
const seed = (options: { readonly loadTestRunId?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const loadTestRunId = options.loadTestRunId ?? null;
    const teacher = yield* first(
      yield* db
        .insert(schema.teachers)
        .values({ clerkUserId: `user_${crypto.randomUUID()}`, name: "Ms. Rivera", loadTestRunId })
        .returning(),
    );
    const assignment = yield* first(
      yield* db
        .insert(schema.assignments)
        .values({
          teacherId: teacher.id,
          title: "Linear equations",
          extractionStatus: "ready",
          loadTestRunId,
        })
        .returning(),
    );
    const problem = yield* first(
      yield* db
        .insert(schema.problems)
        .values({
          assignmentId: assignment.id,
          position: 0,
          label: "1",
          text: "Solve 2x + 3 = 11",
          answerKey: "x = 4",
        })
        .returning(),
    );
    const lines = yield* db
      .insert(schema.rubricLines)
      .values([
        { problemId: problem.id, position: 0, points: 1, description: "Correct setup" },
        { problemId: problem.id, position: 1, points: 1, description: "Correct answer" },
      ])
      .returning();
    const joinCode = JoinCode.make(String(codes++));
    const session = yield* first(
      yield* db
        .insert(schema.classSessions)
        .values({
          assignmentId: assignment.id,
          teacherId: teacher.id,
          joinCode,
          status: "live",
          startedAt: new Date(),
          loadTestRunId,
        })
        .returning(),
    );
    /** A student joins and submits; returns the job the app would enqueue. */
    const studentSubmits = (name: string) =>
      Effect.gen(function* () {
        const student = yield* joinSession({ joinCode, name, pickAvatar: () => 1 });
        const submitted = yield* submitWork({
          sessionId: session.id,
          studentId: student.student.id,
          problemId: problem.id,
          whiteboardUrl: `https://blob.example/${name}.png`,
          submittedAt: new Date(),
        });
        return Option.getOrThrow(submitted.job);
      });
    return { studentSubmits, lineIds: lines.map((l) => l.id) };
  });

const pipeline = (options: {
  readonly script: (lineIds: ReadonlyArray<string>) => Script;
  readonly lineIds: ReadonlyArray<string>;
  readonly concurrency?: number;
}) =>
  Effect.gen(function* () {
    const store = yield* Effect.provide(GradeStore.GradeStore, GradeStore.postgres);
    const log = yield* CallLog.inMemory;
    const model = yield* fakeModel(options.script(options.lineIds));
    const loadTestModel = yield* fakeModel(always(reply(options.lineIds)));
    const services = Layer.mergeAll(
      Layer.succeed(GradeStore.GradeStore, store),
      Layer.succeed(Grader.Grader, Grader.placeholder),
      Layer.succeed(ModelRouter, {
        forGrade: (runId) =>
          CallLog.wrap(
            Option.isNone(runId) ? model.client : loadTestModel.client,
            log.service,
            "mock",
          ),
      }),
    );
    const queue = yield* InProcessQueue.make({
      concurrency: options.concurrency ?? 4,
      handle: (job, delivery) => handleGradeJob(job, delivery).pipe(Effect.provide(services)),
    });
    return { model, loadTestModel, log, queue, services };
  });

const stateOf = (submissionId: SubmissionId) =>
  Effect.map(getGrade(submissionId), (g) => Option.map(g, (grade) => grade.status._tag));

layer(TestDatabase, { timeout: 120_000 })("pipeline on Postgres", (it) => {
  it.effect("grades a class through the queue with the cap held, and writes every grade", () =>
    Effect.gen(function* () {
      const { studentSubmits, lineIds } = yield* seed();
      const p = yield* pipeline({ script: (ids) => always(reply(ids)), lineIds, concurrency: 3 });
      const jobs = yield* Effect.forEach(
        Array.from({ length: 12 }, (_, i) => `Student ${i}`),
        studentSubmits,
      );
      yield* Effect.forEach(jobs, (job) => p.queue.queue.enqueue(job));
      yield* runUntilDone(p.queue.drained);

      const states = yield* Effect.forEach(jobs, (job) => stateOf(job.submissionId));
      expect(states.every((s) => Option.getOrNull(s) === "Graded")).toBe(true);
      // Real database latency staggers claims, so the peak may fall short of the cap; it must never exceed it.
      expect(yield* p.model.maxInFlight).toBeLessThanOrEqual(3);
      expect(yield* p.model.totalCalls).toBe(12);
    }),
  );

  it.effect("two deliveries of one attempt make one model call", () =>
    Effect.gen(function* () {
      const { studentSubmits, lineIds } = yield* seed();
      const p = yield* pipeline({ script: (ids) => always(reply(ids)), lineIds });
      const job = yield* studentSubmits("Maya R.");
      const delivery = (n: number) =>
        handleGradeJob(job, { deliveryCount: n, enqueuedAt: new Date() }).pipe(
          Effect.provide(p.services),
        );
      const { value } = yield* runUntilDone(
        Effect.all([delivery(1), delivery(2)], { concurrency: 2 }),
      );
      expect(value.map((d) => (d._tag === "Done" ? d.result : d._tag)).sort()).toEqual([
        "RetryLater",
        "graded",
      ]);
      expect(yield* p.model.totalCalls).toBe(1);
      expect(yield* delivery(3)).toEqual({ _tag: "Done", result: "skipped" });
    }),
  );

  it.effect("a 5-minute outage delays grades and fails none", () =>
    Effect.gen(function* () {
      const { studentSubmits, lineIds } = yield* seed();
      const outageEndsMs = Duration.toMillis(Duration.minutes(5));
      const p = yield* pipeline({
        script:
          (ids) =>
          ({ nowMs }) =>
            nowMs < outageEndsMs
              ? Effect.fail(new ProviderError({ status: 503, message: "down" }))
              : Effect.succeed(reply(ids)),
        lineIds,
      });
      const jobs = yield* Effect.forEach(["A", "B", "C", "D", "E"], studentSubmits);
      yield* Effect.forEach(jobs, (job) => p.queue.queue.enqueue(job));
      yield* runUntilDone(p.queue.drained, { step: "5 seconds" });
      const states = yield* Effect.forEach(jobs, (job) => stateOf(job.submissionId));
      expect(states.map(Option.getOrNull)).toEqual([
        "Graded",
        "Graded",
        "Graded",
        "Graded",
        "Graded",
      ]);
    }),
  );

  it.effect(
    "a teacher's retry makes the old attempt's message stale, and the new attempt grades",
    () =>
      Effect.gen(function* () {
        const { studentSubmits, lineIds } = yield* seed();
        const p = yield* pipeline({
          script:
            (ids) =>
            ({ request }) =>
              request.tag.attempt === 1
                ? Effect.fail(new ProviderError({ status: 400, message: "bad request" }))
                : Effect.succeed(reply(ids)),
          lineIds,
        });
        const job = yield* studentSubmits("Sam K.");
        yield* p.queue.queue.enqueue(job);
        yield* runUntilDone(p.queue.drained);
        expect(yield* stateOf(job.submissionId)).toEqual(Option.some("CouldntGrade"));

        const next = yield* retryGrade(job.submissionId);
        const stale = yield* handleGradeJob(job, { deliveryCount: 2, enqueuedAt: new Date() }).pipe(
          Effect.provide(p.services),
        );
        expect(stale).toEqual({ _tag: "Done", result: "skipped" });
        yield* p.queue.queue.enqueue(next);
        yield* runUntilDone(p.queue.drained);
        expect(yield* stateOf(job.submissionId)).toEqual(Option.some("Graded"));
      }),
  );

  it.effect("load-test grades go to the mock, tagged with the run id", () =>
    Effect.gen(function* () {
      const { studentSubmits, lineIds } = yield* seed({ loadTestRunId: "run_7" });
      const p = yield* pipeline({ script: (ids) => always(reply(ids)), lineIds });
      const job = yield* studentSubmits("Load Test 1");
      yield* p.queue.queue.enqueue(job);
      yield* runUntilDone(p.queue.drained);
      expect(yield* p.model.totalCalls).toBe(0);
      expect(yield* p.loadTestModel.totalCalls).toBe(1);
      expect((yield* p.log.rows)[0]).toMatchObject({
        loadTestRunId: "run_7",
        subjectId: job.submissionId,
        attempt: 1,
      });
    }),
  );

  it.effect("the sweeper re-sends a submission whose job never reached the queue", () =>
    Effect.gen(function* () {
      const { studentSubmits, lineIds } = yield* seed();
      const p = yield* pipeline({ script: (ids) => always(reply(ids)), lineIds });
      const orphan = yield* studentSubmits("Orphan O.");
      // The real sweeper waits minutes; Postgres time is not virtual, so sweep at once.
      const swept = yield* sweepStuckGrades({ queuedFor: Duration.zero, limit: 100 }).pipe(
        Effect.provide(Layer.merge(p.services, Layer.succeed(GradeQueue, p.queue.queue))),
      );
      expect(swept.found).toBeGreaterThanOrEqual(1);
      yield* runUntilDone(p.queue.drained);
      expect(yield* stateOf(orphan.submissionId)).toEqual(Option.some("Graded"));
    }),
  );

  it.effect("CallLog.postgres writes calls to model_calls, unknown cost as null", () =>
    Effect.gen(function* () {
      const log = yield* Effect.provide(CallLog.CallLog, CallLog.postgres);
      const submissionId = crypto.randomUUID();
      const base = {
        startedAt: new Date(),
        provider: "openrouter" as const,
        purpose: "grade" as const,
        modelRequested: "google/gemini-2.5-flash",
        subjectId: submissionId,
        attempt: 1,
        latencyMs: 2100,
      };
      yield* log.record({
        ...base,
        status: "ok",
        statusCode: 200,
        model: "google/gemini-2.5-flash-001",
        providerId: "gen-1",
        cost: { promptTokens: 900, completionTokens: 60, costUsd: 0.0004, reasoningTokens: 10 },
      });
      yield* log.record({ ...base, status: "interrupted", cost: null, error: "stopped" });
      const db = yield* Db;
      const rows = yield* db
        .select()
        .from(schema.modelCalls)
        .where(eq(schema.modelCalls.submissionId, submissionId));
      expect(rows.map((r) => [r.status, r.costUsd, r.inputTokens, r.reasoningTokens])).toEqual(
        expect.arrayContaining([
          ["ok", 0.0004, 900, 10],
          ["interrupted", null, null, null],
        ]),
      );
      expect(rows.find((r) => r.status === "ok")).toMatchObject({
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        modelAnswered: "google/gemini-2.5-flash-001",
        providerId: "gen-1",
        attempt: 1,
        subjectId: null,
      });
    }),
  );
});
