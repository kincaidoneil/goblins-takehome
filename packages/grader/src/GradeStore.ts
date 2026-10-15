/**
 * What the pipeline reads and writes about a grade: the domain package's pipeline
 * operations (`startGrading`, `recordOutcome`, `releaseClaim`, `stuckJobs`) behind
 * one service, so the consumer can be tested against an in-memory twin as well as
 * real Postgres.
 *
 * The domain makes every write conditional on the attempt and a claim id, so a
 * redelivered or stale message can never overwrite newer work, and holds a 120 s
 * lease so two deliveries of one attempt never both call the model.
 */
import {
  Attempt,
  CLAIM_LEASE_SECONDS,
  type Claim,
  Db,
  type GradeJob,
  type GraderOutcome,
  type GradingInput,
  type Lease,
  LinePointsMismatch,
  recordOutcome,
  releaseClaim,
  type SqlError,
  type SubmissionId,
  startGrading,
  stuckJobs,
} from "@goblins/domain";
import { Clock, Context, Data, Effect, Layer, Option, Ref } from "effect";

/** `Claimed { input }` (grade it), `Stale` (acknowledge and drop) or `InProgress` (another delivery holds the lease). */
export type { Claim };
export { LinePointsMismatch };

/** The database could not be reached or the query failed. The job is retried. */
export class StoreUnavailable extends Data.TaggedError("StoreUnavailable")<{
  readonly cause: unknown;
}> {}

export class GradeStore extends Context.Tag("@goblins/grader/GradeStore")<
  GradeStore,
  {
    /** submitted → grading, taking the lease. */
    readonly startGrading: (job: GradeJob) => Effect.Effect<Claim, StoreUnavailable>;
    /** grading → graded, needs_teacher or couldnt_grade, if the lease still holds. */
    readonly recordOutcome: (
      lease: Lease,
      outcome: GraderOutcome,
    ) => Effect.Effect<"recorded" | "stale", StoreUnavailable | LinePointsMismatch>;
    /** grading → submitted, so the next delivery can claim at once instead of waiting out the lease. */
    readonly releaseClaim: (lease: Lease) => Effect.Effect<void, StoreUnavailable>;
    /** Jobs queued too long, or claimed by a delivery whose lease ran out. */
    readonly stuckJobs: (options: {
      readonly queuedSeconds: number;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<GradeJob>, StoreUnavailable>;
  }
>() {}

const toUnavailable = (cause: SqlError) => Effect.fail(new StoreUnavailable({ cause }));

/** The domain's pipeline operations on Postgres. */
export const postgres = Layer.effect(
  GradeStore,
  Effect.gen(function* () {
    const db = yield* Db;
    const provideDb = Effect.provideService(Db, db);

    return {
      startGrading: (job) =>
        startGrading(job).pipe(provideDb, Effect.catchTag("SqlError", toUnavailable)),
      recordOutcome: (lease, outcome) =>
        recordOutcome(lease, outcome).pipe(provideDb, Effect.catchTag("SqlError", toUnavailable)),
      releaseClaim: (lease) =>
        releaseClaim(lease).pipe(
          provideDb,
          Effect.asVoid,
          Effect.catchTag("SqlError", toUnavailable),
        ),
      stuckJobs: (options) =>
        stuckJobs(options).pipe(provideDb, Effect.catchTag("SqlError", toUnavailable)),
    };
  }),
);

// ---------------------------------------------------------------------------
// In-memory twin, for fast tests on virtual time. It follows the same rules as
// the Postgres functions above; the Postgres-backed tests check that they agree.

type MemoryState = "submitted" | "grading" | "graded" | "needs_teacher" | "couldnt_grade";

export interface MemoryGrade {
  readonly submissionId: SubmissionId;
  readonly attempt: Attempt;
  readonly state: MemoryState;
  readonly claim: Option.Option<{ readonly id: string; readonly atMs: number }>;
  readonly updatedAtMs: number;
  readonly material: Omit<GradingInput, "lease">;
  readonly outcome: Option.Option<GraderOutcome>;
}

export const inMemory = Effect.gen(function* () {
  const grades = yield* Ref.make(new Map<string, MemoryGrade>());
  const now = Clock.currentTimeMillis;
  let claims = 0;

  const update = <A>(
    f: (all: Map<string, MemoryGrade>, nowMs: number) => readonly [A, Map<string, MemoryGrade>],
  ) => Effect.flatMap(now, (nowMs) => Ref.modify(grades, (all) => f(all, nowMs)));

  const leaseExpired = (g: MemoryGrade, nowMs: number) =>
    Option.match(g.claim, {
      onNone: () => true,
      onSome: (c) => nowMs - c.atMs >= CLAIM_LEASE_SECONDS * 1000,
    });

  const holds = (g: MemoryGrade | undefined, lease: Lease): g is MemoryGrade =>
    g !== undefined &&
    g.state === "grading" &&
    Option.exists(g.claim, (c) => c.id === lease.claimId);

  const service: GradeStore["Type"] = {
    startGrading: (job) =>
      update((all, nowMs): readonly [Claim, Map<string, MemoryGrade>] => {
        const g = all.get(job.submissionId);
        if (g === undefined || g.attempt !== job.attempt) return [{ _tag: "Stale" }, all];
        const claimable =
          g.state === "submitted" || (g.state === "grading" && leaseExpired(g, nowMs));
        if (!claimable)
          return [g.state === "grading" ? { _tag: "InProgress" } : { _tag: "Stale" }, all];
        const claimId = `claim-${++claims}`;
        const input: GradingInput = {
          ...g.material,
          lease: { submissionId: g.submissionId, attempt: g.attempt, claimId },
        };
        return [
          { _tag: "Claimed", input },
          new Map(all).set(job.submissionId, {
            ...g,
            state: "grading",
            claim: Option.some({ id: claimId, atMs: nowMs }),
            updatedAtMs: nowMs,
          }),
        ];
      }),
    recordOutcome: (lease, outcome) =>
      Effect.gen(function* () {
        const current = (yield* Ref.get(grades)).get(lease.submissionId);
        if (!holds(current, lease)) return "stale" as const;
        if (outcome._tag !== "Failed") {
          const max = new Map(current.material.rubricLines.map((l) => [l.id, l.points]));
          const lines = outcome.result.linePoints;
          const fits =
            lines.length === max.size &&
            new Set(lines.map((l) => l.rubricLineId)).size === max.size &&
            lines.every((l) => l.points <= (max.get(l.rubricLineId) ?? -1));
          if (!fits)
            return yield* new LinePointsMismatch({
              submissionId: lease.submissionId,
              problem: "does not fit the rubric",
            });
        }
        return yield* update((all, nowMs) => {
          const g = all.get(lease.submissionId);
          if (!holds(g, lease)) return ["stale" as const, all];
          const state: MemoryState =
            outcome._tag === "Sure"
              ? "graded"
              : outcome._tag === "Unsure"
                ? "needs_teacher"
                : "couldnt_grade";
          return [
            "recorded" as const,
            new Map(all).set(lease.submissionId, {
              ...g,
              state,
              claim: Option.none(),
              outcome: Option.some(outcome),
              updatedAtMs: nowMs,
            }),
          ];
        });
      }),
    releaseClaim: (lease) =>
      update((all, nowMs) => {
        const g = all.get(lease.submissionId);
        if (!holds(g, lease)) return [undefined, all];
        return [
          undefined,
          new Map(all).set(lease.submissionId, {
            ...g,
            state: "submitted",
            claim: Option.none(),
            updatedAtMs: nowMs,
          }),
        ];
      }),
    stuckJobs: ({ queuedSeconds, limit }) =>
      Effect.map(Effect.zip(now, Ref.get(grades)), ([nowMs, all]) =>
        [...all.values()]
          .filter(
            (g) =>
              (g.state === "submitted" && nowMs - g.updatedAtMs > queuedSeconds * 1000) ||
              (g.state === "grading" && leaseExpired(g, nowMs)),
          )
          .slice(0, limit)
          .map((g): GradeJob => ({ submissionId: g.submissionId, attempt: g.attempt })),
      ),
  };

  /** What the app's submit path does: insert a grade in `submitted` and return its first job. */
  const insert = (submissionId: SubmissionId, material: Omit<GradingInput, "lease">) =>
    Effect.flatMap(now, (nowMs) =>
      Ref.update(grades, (all) =>
        new Map(all).set(submissionId, {
          submissionId,
          attempt: Attempt.make(1),
          state: "submitted",
          claim: Option.none(),
          updatedAtMs: nowMs,
          material,
          outcome: Option.none(),
        }),
      ).pipe(Effect.as<GradeJob>({ submissionId, attempt: Attempt.make(1) })),
    );

  /** What the teacher's "retry" does: a new attempt in `submitted`. Returns the job to enqueue, if the grade exists. */
  const teacherRetry = (submissionId: SubmissionId) =>
    update((all, nowMs): readonly [Option.Option<GradeJob>, Map<string, MemoryGrade>] => {
      const g = all.get(submissionId);
      if (g === undefined) return [Option.none(), all];
      const attempt = Attempt.make(g.attempt + 1);
      return [
        Option.some({ submissionId, attempt }),
        new Map(all).set(submissionId, {
          ...g,
          attempt,
          state: "submitted",
          claim: Option.none(),
          outcome: Option.none(),
          updatedAtMs: nowMs,
        }),
      ];
    });

  return {
    service,
    insert,
    teacherRetry,
    get: (submissionId: string) => Effect.map(Ref.get(grades), (all) => all.get(submissionId)),
    all: Effect.map(Ref.get(grades), (all) => [...all.values()]),
  };
});
