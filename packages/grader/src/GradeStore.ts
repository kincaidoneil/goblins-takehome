/**
 * What the pipeline reads and writes about a grade. The Postgres implementation
 * lives next to the domain schema; the in-memory one backs tests and local runs.
 *
 * Every write is conditional on the grade's state and attempt, so a redelivered
 * or stale queue message can never overwrite newer work.
 */
import { Context, Data, Effect, Option, Ref } from "effect"
import type { GradeInput, GradeOutcome } from "./Grader.ts"

/** The PRD's five grade states. Queued versus in flight is not a product state. */
export type GradeState = "submitted" | "grading" | "graded" | "needs_teacher" | "couldnt_grade"

export interface GradeRecord {
  readonly gradeId: string
  readonly state: GradeState
  /** Starts at 1; a teacher's "retry" increments it and enqueues a new job. */
  readonly attempt: number
  readonly input: GradeInput
  readonly updatedAt: Date
}

/** The database could not be reached or the write failed. The job is retried. */
export class StoreUnavailable extends Data.TaggedError("StoreUnavailable")<{ readonly cause: unknown }> {}

export class GradeStore extends Context.Tag("@goblins/grader/GradeStore")<
  GradeStore,
  {
    readonly load: (gradeId: string) => Effect.Effect<Option.Option<GradeRecord>, StoreUnavailable>
    /** submitted → grading. Returns false if the grade is no longer waiting on this attempt. */
    readonly markGrading: (gradeId: string, attempt: number) => Effect.Effect<boolean, StoreUnavailable>
    /** grading → graded or needs_teacher. Returns false if this attempt no longer owns the grade. */
    readonly complete: (
      gradeId: string,
      attempt: number,
      outcome: GradeOutcome,
    ) => Effect.Effect<boolean, StoreUnavailable>
    /** grading → couldnt_grade, after retries ran out. */
    readonly fail: (gradeId: string, attempt: number, reason: string) => Effect.Effect<boolean, StoreUnavailable>
    /** Grades still submitted or grading whose last update is older than the cutoff. */
    readonly findStuck: (
      olderThan: Date,
    ) => Effect.Effect<ReadonlyArray<{ readonly gradeId: string; readonly attempt: number }>, StoreUnavailable>
  }
>() {}

/** A grade row as the in-memory store keeps it, with the result fields the app would show. */
export interface StoredGrade extends GradeRecord {
  readonly outcome?: GradeOutcome
  readonly failure?: string
}

const isOpen = (g: StoredGrade, attempt: number) =>
  g.attempt === attempt && (g.state === "submitted" || g.state === "grading")

export const inMemory = Effect.gen(function* () {
  const grades = yield* Ref.make(new Map<string, StoredGrade>())

  const transition = (gradeId: string, attempt: number, next: (g: StoredGrade, now: Date) => StoredGrade) =>
    Effect.flatMap(Effect.clockWith((c) => c.currentTimeMillis), (ms) =>
      Ref.modify(grades, (all) => {
        const g = all.get(gradeId)
        if (g === undefined || !isOpen(g, attempt)) return [false, all] as const
        return [true, new Map(all).set(gradeId, next(g, new Date(ms)))] as const
      }),
    )

  const service: GradeStore["Type"] = {
    load: (gradeId) => Effect.map(Ref.get(grades), (all) => Option.fromNullable(all.get(gradeId))),
    markGrading: (gradeId, attempt) =>
      transition(gradeId, attempt, (g, now) => ({ ...g, state: "grading", updatedAt: now })),
    complete: (gradeId, attempt, outcome) =>
      transition(gradeId, attempt, (g, now) => ({
        ...g,
        state: outcome._tag === "Graded" ? "graded" : "needs_teacher",
        outcome,
        updatedAt: now,
      })),
    fail: (gradeId, attempt, reason) =>
      transition(gradeId, attempt, (g, now) => ({ ...g, state: "couldnt_grade", failure: reason, updatedAt: now })),
    findStuck: (olderThan) =>
      Effect.map(Ref.get(grades), (all) =>
        [...all.values()]
          .filter((g) => (g.state === "submitted" || g.state === "grading") && g.updatedAt < olderThan)
          .map((g) => ({ gradeId: g.gradeId, attempt: g.attempt })),
      ),
  }

  /** What the app's submit path does: insert a grade in `submitted`. */
  const insert = (input: GradeInput) =>
    Effect.flatMap(Effect.clockWith((c) => c.currentTimeMillis), (ms) =>
      Ref.update(grades, (all) =>
        new Map(all).set(input.gradeId, {
          gradeId: input.gradeId,
          state: "submitted",
          attempt: 1,
          input,
          updatedAt: new Date(ms),
        }),
      ),
    )

  /** What the teacher's "retry" does on a couldn't-grade grade. Returns the new attempt. */
  const teacherRetry = (gradeId: string) =>
    Effect.flatMap(Effect.clockWith((c) => c.currentTimeMillis), (ms) =>
      Ref.modify(grades, (all) => {
        const g = all.get(gradeId)
        if (g === undefined) return [Option.none<number>(), all] as const
        const attempt = g.attempt + 1
        const { failure: _failure, outcome: _outcome, ...rest } = g
        return [
          Option.some(attempt),
          new Map(all).set(gradeId, { ...rest, state: "submitted", attempt, updatedAt: new Date(ms) }),
        ] as const
      }),
    )

  return { service, insert, teacherRetry, all: Effect.map(Ref.get(grades), (m) => [...m.values()]) }
})
