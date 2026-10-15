/**
 * Every write to `grades`. The grading pipeline and the teacher's dashboard both go through here.
 *
 * Idempotency: queue delivery is at-least-once, so each pipeline write is a conditional UPDATE
 * that matches the attempt number and the state it expects. A redelivered message, or a message
 * for an attempt the teacher has since retried or scored, matches no row and changes nothing.
 * Teacher writes are conditional on the state too, so two tabs cannot race a grade into an
 * impossible state.
 */
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { Data, Effect, Option } from "effect"
import { Db } from "./db"
import {
  Attempt,
  CouldntGrade,
  Grade,
  Graded,
  type GradeJob,
  type GraderOutcome,
  Grading,
  type LinePoints,
  NeedsTeacher,
  Submitted,
  SubmissionId,
  totalPoints
} from "./grade"
import {
  grades,
  problemDependencies,
  problems,
  rubricLines,
  submissions,
  worksheetPages
} from "./schema"

type GradeRow = typeof grades.$inferSelect

// ---------------------------------------------------------------------------
// Decoding

/** A row that breaks the state machine. The check constraints make this unreachable. */
export class CorruptGradeRow extends Data.TaggedError("CorruptGradeRow")<{
  readonly submissionId: string
  readonly problem: string
}> {}

const required = <A>(row: GradeRow, value: A | null, field: string) =>
  value === null
    ? Effect.fail(new CorruptGradeRow({ submissionId: row.submissionId, problem: `${field} is null` }))
    : Effect.succeed(value)

const modelResultOf = (row: GradeRow) =>
  row.graderRead !== null && row.modelLinePoints !== null && row.graderReason !== null
    ? Option.some({ read: row.graderRead, linePoints: row.modelLinePoints, reason: row.graderReason })
    : Option.none()

/** Decodes a `grades` row into the `Grade` tagged union. */
export const decodeGrade = (row: GradeRow): Effect.Effect<Grade, CorruptGradeRow> =>
  Effect.gen(function* () {
    const attempt = Attempt.make(row.attempt)
    const status = yield* (() => {
      switch (row.state) {
        case "submitted":
          return Effect.succeed(new Submitted({ attempt }))
        case "grading":
          return Effect.succeed(new Grading({ attempt }))
        case "needs_teacher":
          return Effect.gen(function* () {
            const model = yield* required(row, Option.getOrNull(modelResultOf(row)), "model result")
            const flagReason = yield* required(row, row.flagReason, "flag_reason")
            return new NeedsTeacher({ attempt, model, flagReason })
          })
        case "couldnt_grade":
          return Effect.map(
            required(row, row.failureReason, "failure_reason"),
            (failureReason) => new CouldntGrade({ attempt, failureReason })
          )
        case "graded":
          return Effect.gen(function* () {
            return new Graded({
              attempt,
              source: yield* required(row, row.source, "source"),
              linePoints: yield* required(row, row.linePoints, "line_points"),
              points: yield* required(row, row.points, "points"),
              gradedAt: yield* required(row, row.gradedAt, "graded_at"),
              model: modelResultOf(row),
              flagReason: Option.fromNullable(row.flagReason)
            })
          })
      }
    })()
    return {
      submissionId: SubmissionId.make(row.submissionId),
      sessionId: row.sessionId,
      studentId: row.studentId,
      problemId: row.problemId,
      maxPoints: row.maxPoints,
      status,
      updatedAt: row.updatedAt
    }
  })

export const getGrade = (submissionId: SubmissionId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db.select().from(grades).where(eq(grades.submissionId, submissionId))
    return row === undefined ? Option.none() : Option.some(yield* decodeGrade(row))
  })

// ---------------------------------------------------------------------------
// Rubric checks

/** Line points that do not match the problem's rubric: a line is missing, unknown or over its maximum. */
export class LinePointsMismatch extends Data.TaggedError("LinePointsMismatch")<{
  readonly submissionId: string
  readonly problem: string
}> {}

const checkLinePoints = (submissionId: SubmissionId, linePoints: LinePoints) =>
  Effect.gen(function* () {
    const db = yield* Db
    const lines = yield* db
      .select({ id: rubricLines.id, points: rubricLines.points, maxPoints: grades.maxPoints })
      .from(rubricLines)
      .innerJoin(grades, eq(grades.problemId, rubricLines.problemId))
      .where(eq(grades.submissionId, submissionId))
    const max = new Map(lines.map((line) => [line.id, line.points]))
    const fail = (problem: string) => Effect.fail(new LinePointsMismatch({ submissionId, problem }))
    // The rubric is locked once an assignment launches, so this only trips on a bug; it turns
    // the `grades_points_in_range` check into a typed error.
    const maxPoints = lines[0]?.maxPoints ?? 0
    if (totalPoints(linePoints) > maxPoints) return yield* fail(`total over ${maxPoints}`)
    if (linePoints.length !== lines.length) {
      return yield* fail(`expected ${lines.length} rubric lines, got ${linePoints.length}`)
    }
    const seen = new Set<string>()
    for (const line of linePoints) {
      const lineMax = max.get(line.rubricLineId)
      if (lineMax === undefined) return yield* fail(`unknown rubric line ${line.rubricLineId}`)
      if (seen.has(line.rubricLineId)) return yield* fail(`rubric line ${line.rubricLineId} repeated`)
      if (line.points > lineMax) return yield* fail(`rubric line ${line.rubricLineId} over ${lineMax}`)
      seen.add(line.rubricLineId)
    }
  })

// ---------------------------------------------------------------------------
// Grading pipeline

/** Everything the grader needs for one attempt. */
export interface GradingInput {
  readonly job: GradeJob
  readonly whiteboardUrl: string
  readonly problem: {
    readonly label: string
    readonly text: string
    readonly answerKey: string
    readonly diagramDescription: string | null
    readonly gradingNotes: string
    /** Empty unless the teacher marked the problem as needing the page image. */
    readonly pageImageUrls: ReadonlyArray<string>
  }
  readonly rubricLines: ReadonlyArray<{
    readonly id: string
    readonly points: number
    readonly description: string
  }>
  /** Earlier problems this one depends on, with the student's work on each, for follow-through credit. */
  readonly dependencies: ReadonlyArray<{
    readonly label: string
    readonly text: string
    /** None if the student has not submitted the earlier problem. */
    readonly whiteboardUrl: Option.Option<string>
    /** What the grader read from the earlier whiteboard, if it has been graded. */
    readonly graderRead: Option.Option<string>
  }>
}

/**
 * How long a consumer owns a claimed attempt. A redelivery within the lease is told the attempt is
 * in progress, so one message never pays for two model calls. After the lease, a redelivery takes
 * the attempt over, which recovers from a consumer that crashed mid-call.
 */
export const CLAIM_LEASE_SECONDS = 120

/**
 * What the queue consumer does with a message:
 * - `Claimed`: grade it.
 * - `Stale`: the attempt is finished or superseded. Acknowledge the message and do nothing.
 * - `InProgress`: another consumer holds the attempt. Leave the message for redelivery after the lease.
 */
export type Claim =
  | { readonly _tag: "Claimed"; readonly input: GradingInput }
  | { readonly _tag: "Stale" }
  | { readonly _tag: "InProgress" }

const stale: Claim = { _tag: "Stale" }

/** Called by the queue consumer when a message arrives. Moves the grade to `grading`. */
export const startGrading = (job: GradeJob) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [claimed] = yield* db
      .update(grades)
      .set({ state: "grading", claimedAt: new Date(), outcomeAt: null })
      .where(
        and(
          eq(grades.submissionId, job.submissionId),
          eq(grades.attempt, job.attempt),
          or(
            eq(grades.state, "submitted"),
            and(
              eq(grades.state, "grading"),
              or(
                isNull(grades.claimedAt),
                lt(grades.claimedAt, sql`now() - make_interval(secs => ${CLAIM_LEASE_SECONDS})`)
              )
            )
          )
        )
      )
      .returning({ problemId: grades.problemId, studentId: grades.studentId })
    if (claimed === undefined) {
      const [current] = yield* db
        .select({ state: grades.state, attempt: grades.attempt })
        .from(grades)
        .where(eq(grades.submissionId, job.submissionId))
      return current?.state === "grading" && current.attempt === job.attempt
        ? ({ _tag: "InProgress" } satisfies Claim)
        : stale
    }

    const [submission] = yield* db
      .select({ whiteboardUrl: submissions.whiteboardUrl })
      .from(submissions)
      .where(eq(submissions.id, job.submissionId))
    const [problem] = yield* db.select().from(problems).where(eq(problems.id, claimed.problemId))
    if (submission === undefined || problem === undefined) return stale

    const lines = yield* db
      .select({ id: rubricLines.id, points: rubricLines.points, description: rubricLines.description })
      .from(rubricLines)
      .where(eq(rubricLines.problemId, problem.id))
      .orderBy(asc(rubricLines.position))

    const pages = problem.gradeWithPageImage
      ? yield* db
          .select({ imageUrl: worksheetPages.imageUrl, pageNumber: worksheetPages.pageNumber })
          .from(worksheetPages)
          .where(
            and(
              eq(worksheetPages.assignmentId, problem.assignmentId),
              inArray(worksheetPages.pageNumber, problem.pageNumbers)
            )
          )
          .orderBy(asc(worksheetPages.pageNumber))
      : []

    const dependencies = yield* db
      .select({
        label: problems.label,
        text: problems.text,
        position: problems.position,
        whiteboardUrl: submissions.whiteboardUrl,
        graderRead: grades.graderRead
      })
      .from(problemDependencies)
      .innerJoin(problems, eq(problems.id, problemDependencies.dependsOnProblemId))
      .leftJoin(
        submissions,
        and(eq(submissions.problemId, problems.id), eq(submissions.studentId, claimed.studentId))
      )
      .leftJoin(grades, eq(grades.submissionId, submissions.id))
      .where(eq(problemDependencies.problemId, problem.id))
      .orderBy(asc(problems.position))

    const input: GradingInput = {
      job,
      whiteboardUrl: submission.whiteboardUrl,
      problem: {
        label: problem.label,
        text: problem.text,
        answerKey: problem.answerKey,
        diagramDescription: problem.diagramDescription,
        gradingNotes: problem.gradingNotes,
        pageImageUrls: pages.map((page) => page.imageUrl)
      },
      rubricLines: lines,
      dependencies: dependencies.map((dep) => ({
        label: dep.label,
        text: dep.text,
        whiteboardUrl: Option.fromNullable(dep.whiteboardUrl),
        graderRead: Option.fromNullable(dep.graderRead)
      }))
    }
    return { _tag: "Claimed", input } satisfies Claim
  })

/**
 * Records the outcome of one attempt. Returns "stale" when the attempt was already recorded or
 * superseded; the consumer acknowledges the message either way.
 *
 * Fails with `LinePointsMismatch` when the model's line points do not fit the rubric. The
 * pipeline treats that as a bad response: retry, and record `Failed` when retries run out.
 */
export const recordOutcome = (job: GradeJob, outcome: GraderOutcome) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = new Date()
    // Check staleness first, so a superseded attempt is acknowledged rather than retried.
    const [current] = yield* db
      .select({ state: grades.state, attempt: grades.attempt })
      .from(grades)
      .where(eq(grades.submissionId, job.submissionId))
    if (current?.state !== "grading" || current.attempt !== job.attempt) return "stale" as const

    const values = yield* (() => {
      switch (outcome._tag) {
        case "Sure":
          return Effect.as(checkLinePoints(job.submissionId, outcome.result.linePoints), {
            state: "graded" as const,
            outcomeAt: now,
            graderRead: outcome.result.read,
            modelLinePoints: outcome.result.linePoints,
            graderReason: outcome.result.reason,
            source: "model" as const,
            linePoints: outcome.result.linePoints,
            points: totalPoints(outcome.result.linePoints),
            gradedAt: now
          })
        case "Unsure":
          return Effect.as(checkLinePoints(job.submissionId, outcome.result.linePoints), {
            state: "needs_teacher" as const,
            outcomeAt: now,
            graderRead: outcome.result.read,
            modelLinePoints: outcome.result.linePoints,
            graderReason: outcome.result.reason,
            flagReason: outcome.flagReason
          })
        case "Failed":
          return Effect.succeed({
            state: "couldnt_grade" as const,
            outcomeAt: now,
            failureReason: outcome.failureReason
          })
      }
    })()
    const updated = yield* db
      .update(grades)
      .set(values)
      .where(
        and(
          eq(grades.submissionId, job.submissionId),
          eq(grades.attempt, job.attempt),
          eq(grades.state, "grading")
        )
      )
      .returning({ submissionId: grades.submissionId })
    return updated.length === 1 ? ("recorded" as const) : ("stale" as const)
  })

// ---------------------------------------------------------------------------
// Teacher actions. The caller checks that the teacher owns the session.

export class GradeNotFound extends Data.TaggedError("GradeNotFound")<{
  readonly submissionId: string
}> {}

/** The grade is no longer in a state that allows the action, e.g. another tab resolved it first. */
export class GradeStateChanged extends Data.TaggedError("GradeStateChanged")<{
  readonly submissionId: string
  readonly current: GradeRow["state"]
}> {}

const stateChanged = (submissionId: SubmissionId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ state: grades.state })
      .from(grades)
      .where(eq(grades.submissionId, submissionId))
    return yield* row === undefined
      ? Effect.fail(new GradeNotFound({ submissionId }))
      : Effect.fail(new GradeStateChanged({ submissionId, current: row.state }))
  })

/** Accepts the model's best guess on a grade that needs the teacher. */
export const acceptGrade = (submissionId: SubmissionId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const updated = yield* db
      .update(grades)
      .set({
        state: "graded",
        source: "teacher_accepted",
        linePoints: sql`${grades.modelLinePoints}`,
        points: sql`(select coalesce(sum((line->>'points')::int), 0) from jsonb_array_elements(${grades.modelLinePoints}) as line)`,
        gradedAt: new Date()
      })
      .where(and(eq(grades.submissionId, submissionId), eq(grades.state, "needs_teacher")))
      .returning({ submissionId: grades.submissionId })
    if (updated.length === 0) return yield* stateChanged(submissionId)
  })

/**
 * The teacher's own score, per rubric line. Works from any state: rescoring a flagged grade,
 * scoring one that couldn't be graded, or overriding a final score. A grading attempt still in
 * flight is superseded, and its result is dropped as stale.
 */
export const scoreGrade = (submissionId: SubmissionId, linePoints: LinePoints) =>
  Effect.gen(function* () {
    yield* checkLinePoints(submissionId, linePoints)
    const db = yield* Db
    const updated = yield* db
      .update(grades)
      .set({
        state: "graded",
        source: sql`case when ${grades.state} = 'graded' then 'teacher_override'::grade_source else 'teacher_scored'::grade_source end`,
        linePoints,
        points: totalPoints(linePoints),
        failureReason: null,
        gradedAt: new Date()
      })
      .where(eq(grades.submissionId, submissionId))
      .returning({ submissionId: grades.submissionId })
    if (updated.length === 0) return yield* Effect.fail(new GradeNotFound({ submissionId }))
  })

/**
 * Queues a new attempt for a grade that needs the teacher or couldn't be graded. Returns the job
 * to enqueue. Messages for earlier attempts become stale.
 */
export const retryGrade = (submissionId: SubmissionId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [updated] = yield* db
      .update(grades)
      .set({
        state: "submitted",
        attempt: sql`${grades.attempt} + 1`,
        claimedAt: null,
        outcomeAt: null,
        graderRead: null,
        modelLinePoints: null,
        graderReason: null,
        flagReason: null,
        failureReason: null
      })
      .where(
        and(
          eq(grades.submissionId, submissionId),
          inArray(grades.state, ["needs_teacher", "couldnt_grade"])
        )
      )
      .returning({ attempt: grades.attempt })
    if (updated === undefined) return yield* stateChanged(submissionId)
    return { submissionId, attempt: Attempt.make(updated.attempt) } satisfies GradeJob
  })

/** Grades in a session that are still waiting on the pipeline. Used to re-enqueue after a lost message. */
export const pendingJobs = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ submissionId: grades.submissionId, attempt: grades.attempt })
      .from(grades)
      .where(and(eq(grades.sessionId, sessionId), inArray(grades.state, ["submitted", "grading"])))
    return rows.map(
      (row): GradeJob => ({
        submissionId: SubmissionId.make(row.submissionId),
        attempt: Attempt.make(row.attempt)
      })
    )
  })
