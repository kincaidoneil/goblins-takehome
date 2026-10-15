/**
 * The grade lifecycle against real Postgres: join and resume, submit, at-least-once delivery,
 * teacher actions, and load-test cleanup.
 */
import { expect, layer } from "@effect/vitest"
import { eq, sql } from "drizzle-orm"
import { Effect, Either, Option } from "effect"
import {
  acceptGrade,
  CLAIM_LEASE_SECONDS,
  type GradeJob,
  type GraderOutcome,
  Db,
  deleteLoadTestRun,
  getGrade,
  JoinCode,
  joinSession,
  recordOutcome,
  releaseClaim,
  retryGrade,
  scoreGrade,
  startGrading,
  stuckJobs,
  submitWork
} from "../src/index"
import { classSessions, grades, submissions, problemDependencies, problems, rubricLines, students, teachers, assignments } from "../src/schema"
import { TestDatabase } from "./test-database"

/** The first row, or a test failure. */
const first = <A>(rows: ReadonlyArray<A>): Effect.Effect<A> =>
  rows[0] === undefined ? Effect.die("expected a row") : Effect.succeed(rows[0])

let codeCounter = 100000
const nextCode = () => JoinCode.make(String(codeCounter++))

/** A teacher, a two-problem assignment where 1b depends on 1a, and a live session. */
const seed = (options: { readonly loadTestRunId?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const loadTestRunId = options.loadTestRunId ?? null
    const teacher = yield* first(
      yield* db
        .insert(teachers)
        .values({ clerkUserId: `user_${crypto.randomUUID()}`, name: "Ms. Rivera", loadTestRunId })
        .returning()
    )
    const assignment = yield* first(
      yield* db
        .insert(assignments)
        .values({ teacherId: teacher.id, title: "Linear equations", extractionStatus: "ready", loadTestRunId })
        .returning()
    )
    const problemRows = yield* db
      .insert(problems)
      .values([
        { assignmentId: assignment.id, position: 0, label: "1a", text: "Solve 2x + 3 = 11", answerKey: "x = 4" },
        { assignmentId: assignment.id, position: 1, label: "1b", text: "Find 3x using your x", answerKey: "12" }
      ])
      .returning()
    const p1 = yield* first(problemRows)
    const p2 = yield* first(problemRows.slice(1))
    yield* db.insert(problemDependencies).values({ problemId: p2.id, dependsOnProblemId: p1.id })
    const lines = yield* db
      .insert(rubricLines)
      .values([
        { problemId: p1.id, position: 0, points: 1, description: "Correct setup" },
        { problemId: p1.id, position: 1, points: 1, description: "Correct answer" },
        { problemId: p2.id, position: 0, points: 2, description: "Correct method" }
      ])
      .returning()
    const joinCode = nextCode()
    const sessionRows = yield* db
      .insert(classSessions)
      .values({
        assignmentId: assignment.id,
        teacherId: teacher.id,
        joinCode,
        status: "live",
        startedAt: new Date(),
        loadTestRunId
      })
      .returning()
    return {
      session: yield* first(sessionRows),
      joinCode,
      p1,
      p2,
      p1Lines: lines.filter((l) => l.problemId === p1.id),
      p2Lines: lines.filter((l) => l.problemId === p2.id)
    }
  })

const join = (joinCode: JoinCode, name: string) =>
  joinSession({ joinCode, name, pickAvatar: () => "owl" })

const submit = (sessionId: string, studentId: string, problemId: string) =>
  submitWork({
    sessionId,
    studentId,
    problemId,
    whiteboardUrl: `https://blob.example/${studentId}/${problemId}.png`,
    submittedAt: new Date()
  })

/** Claims the job's attempt, as a queue consumer would, and returns the lease. */
const claim = (job: GradeJob) =>
  Effect.flatMap(startGrading(job), (result) =>
    result._tag === "Claimed" ? Effect.succeed(result.input.lease) : Effect.die(`expected a claim, got ${result._tag}`)
  )

const jobOf = (result: { readonly job: Option.Option<GradeJob> }): GradeJob =>
  Option.getOrThrow(result.job)

layer(TestDatabase, { timeout: 60_000 })("grade lifecycle", (it) => {
  it.effect("resumes a student who enters the same name in another form", () =>
    Effect.gen(function* () {
      const { joinCode } = yield* seed()
      const first = yield* join(joinCode, "Maya R.")
      const again = yield* join(joinCode, "  maya r ")
      expect(first.resumed).toBe(false)
      expect(again.resumed).toBe(true)
      expect(again.student.id).toBe(first.student.id)
      expect(again.student.displayName).toBe("Maya R.")

      const empty = yield* Effect.either(join(joinCode, " .. "))
      expect(Either.isLeft(empty) && empty.left._tag).toBe("InvalidName")
    }))

  it.effect("refuses joins and submissions once the session ends", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1 } = yield* seed()
      const { student } = yield* join(joinCode, "Ana")
      const db = yield* Db
      yield* db
        .update(classSessions)
        .set({ status: "ended", endedAt: new Date() })
        .where(eq(classSessions.id, session.id))

      const joinAfter = yield* Effect.either(join(joinCode, "Ben"))
      expect(Either.isLeft(joinAfter) && joinAfter.left._tag).toBe("SessionNotFound")
      const submitAfter = yield* Effect.either(submit(session.id, student.id, p1.id))
      expect(Either.isLeft(submitAfter) && submitAfter.left._tag === "SubmissionRejected" && submitAfter.left.reason).toBe("session_not_live")
    }))

  it.effect("grades once under duplicate submits and redelivered messages", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1, p1Lines } = yield* seed()
      const { student } = yield* join(joinCode, "Maya R.")

      const first = yield* submit(session.id, student.id, p1.id)
      const retried = yield* submit(session.id, student.id, p1.id)
      expect(first.isNew).toBe(true)
      expect(retried.isNew).toBe(false)
      expect(retried.submissionId).toBe(first.submissionId)
      // Still waiting on the pipeline, so the retry hands back the job to re-enqueue.
      expect(jobOf(retried)).toEqual(jobOf(first))

      const job = jobOf(first)
      const expired = yield* claim(job)
      // A redelivery while the first consumer holds the attempt does not grade it again.
      expect((yield* startGrading(job))._tag).toBe("InProgress")
      // Once the lease runs out (the consumer hung), a redelivery takes the attempt over.
      const db = yield* Db
      yield* db
        .update(grades)
        .set({ claimedAt: new Date(Date.now() - (CLAIM_LEASE_SECONDS + 1) * 1000) })
        .where(eq(grades.submissionId, job.submissionId))
      const lease = yield* claim(job)
      // The expired holder finishing late cannot overwrite the new holder.
      expect(yield* recordOutcome(expired, { _tag: "Failed", failureReason: "late" })).toBe("stale")

      const outcome: GraderOutcome = {
        _tag: "Sure",
        result: {
          read: "2x + 3 = 11, 2x = 8, x = 4",
          linePoints: p1Lines.map((line) => ({ rubricLineId: line.id, points: line.points })),
          reason: "Correct setup and answer."
        }
      }
      expect(yield* recordOutcome(lease, outcome)).toBe("recorded")
      expect(yield* recordOutcome(lease, outcome)).toBe("stale")
      expect((yield* startGrading(job))._tag).toBe("Stale")

      const grade = Option.getOrThrow(yield* getGrade(first.submissionId))
      expect(grade.status._tag).toBe("Graded")
      if (grade.status._tag === "Graded") {
        expect(grade.status.points).toBe(2)
        expect(grade.status.source).toBe("model")
      }

      // After grading, a retried submit has nothing to enqueue.
      expect(Option.isNone((yield* submit(session.id, student.id, p1.id)).job)).toBe(true)
    }))

  it.effect("gives the grader the student's earlier work for a dependent problem", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1, p2, p1Lines } = yield* seed()
      const { student } = yield* join(joinCode, "Sam")
      const s1 = yield* submit(session.id, student.id, p1.id)
      yield* recordOutcome(yield* claim(jobOf(s1)), {
        _tag: "Sure",
        result: {
          read: "x = 5",
          linePoints: p1Lines.map((line, i) => ({ rubricLineId: line.id, points: i === 0 ? 1 : 0 })),
          reason: "Setup right, arithmetic slip."
        }
      })
      const s2 = yield* submit(session.id, student.id, p2.id)
      const claimed = yield* startGrading(jobOf(s2))
      if (claimed._tag !== "Claimed") return yield* Effect.die("expected a claim")
      const input = claimed.input
      expect(input.problem.label).toBe("1b")
      expect(input.loadTestRunId).toEqual(Option.none())
      expect(input.rubricLines).toHaveLength(1)
      expect(input.dependencies).toHaveLength(1)
      expect(input.dependencies[0]?.label).toBe("1a")
      expect(input.dependencies[0]?.graderRead).toEqual(Option.some("x = 5"))
    }))

  it.effect("lets the teacher accept a flagged grade, then override it", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1, p1Lines } = yield* seed()
      const { student } = yield* join(joinCode, "Lee")
      const s = yield* submit(session.id, student.id, p1.id)
      yield* recordOutcome(yield* claim(jobOf(s)), {
        _tag: "Unsure",
        result: {
          read: "x = 8/2",
          linePoints: p1Lines.map((line) => ({ rubricLineId: line.id, points: line.points })),
          reason: "Answer left unsimplified."
        },
        flagReason: "The rubric doesn't say whether 8/2 is full credit."
      })
      const flagged = Option.getOrThrow(yield* getGrade(s.submissionId))
      expect(flagged.status._tag).toBe("NeedsTeacher")

      yield* acceptGrade(s.submissionId)
      const accepted = Option.getOrThrow(yield* getGrade(s.submissionId))
      expect(accepted.status._tag === "Graded" && accepted.status.source).toBe("teacher_accepted")
      expect(accepted.status._tag === "Graded" && accepted.status.points).toBe(2)

      const again = yield* Effect.either(acceptGrade(s.submissionId))
      expect(Either.isLeft(again) && again.left._tag).toBe("GradeStateChanged")

      yield* scoreGrade(
        s.submissionId,
        p1Lines.map((line) => ({ rubricLineId: line.id, points: 0 }))
      )
      const overridden = Option.getOrThrow(yield* getGrade(s.submissionId))
      expect(overridden.status._tag === "Graded" && overridden.status.source).toBe("teacher_override")
      expect(overridden.status._tag === "Graded" && overridden.status.points).toBe(0)
    }))

  it.effect("retries a failed grade and drops the stale attempt's late result", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1, p1Lines } = yield* seed()
      const { student } = yield* join(joinCode, "Kai")
      const s = yield* submit(session.id, student.id, p1.id)
      const attempt1 = jobOf(s)
      const lease1 = yield* claim(attempt1)
      yield* recordOutcome(lease1, { _tag: "Failed", failureReason: "Provider timed out 3 times" })
      expect(Option.getOrThrow(yield* getGrade(s.submissionId)).status._tag).toBe("CouldntGrade")

      const attempt2 = yield* retryGrade(s.submissionId)
      expect(attempt2.attempt).toBe(2)
      const sure: GraderOutcome = {
        _tag: "Sure",
        result: {
          read: "x = 4",
          linePoints: p1Lines.map((line) => ({ rubricLineId: line.id, points: line.points })),
          reason: "Correct."
        }
      }
      expect((yield* startGrading(attempt1))._tag).toBe("Stale")
      expect(yield* recordOutcome(lease1, sure)).toBe("stale")
      expect(yield* recordOutcome(yield* claim(attempt2), sure)).toBe("recorded")
      const grade = Option.getOrThrow(yield* getGrade(s.submissionId))
      expect(grade.status._tag === "Graded" && grade.status.attempt).toBe(2)
    }))

  it.effect("rejects line points that do not fit the rubric", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1, p1Lines } = yield* seed()
      const { student } = yield* join(joinCode, "Ivy")
      const s = yield* submit(session.id, student.id, p1.id)
      const lease = yield* claim(jobOf(s))
      const over = yield* Effect.either(
        recordOutcome(lease, {
          _tag: "Sure",
          result: {
            read: "x = 4",
            linePoints: p1Lines.map((line) => ({ rubricLineId: line.id, points: line.points + 1 })),
            reason: "Correct."
          }
        })
      )
      expect(Either.isLeft(over) && over.left._tag).toBe("LinePointsMismatch")
      const missing = yield* Effect.either(
        scoreGrade(s.submissionId, [{ rubricLineId: (yield* first(p1Lines)).id, points: 1 }])
      )
      expect(Either.isLeft(missing) && missing.left._tag).toBe("LinePointsMismatch")
    }))

  it.effect("rejects an impossible grade row at the database", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1 } = yield* seed()
      const { student } = yield* join(joinCode, "Noor")
      const s = yield* submit(session.id, student.id, p1.id)
      const db = yield* Db
      const result = yield* Effect.either(
        db.execute(sql`update grades set state = 'graded' where submission_id = ${s.submissionId}`)
      )
      expect(Either.isLeft(result)).toBe(true)
    }))

  it.effect("releases a claim for backoff and finds jobs whose message was lost", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1 } = yield* seed()
      const { student } = yield* join(joinCode, "Rae")
      const s = yield* submit(session.id, student.id, p1.id)
      const lease = yield* claim(jobOf(s))
      expect(yield* releaseClaim(lease)).toBe("released")
      // The redelivery after the backoff claims it at once.
      const again = yield* claim(jobOf(s))
      expect(yield* releaseClaim(lease)).toBe("stale")

      const isStuck = (jobs: ReadonlyArray<GradeJob>) => jobs.some((j) => j.submissionId === s.submissionId)
      expect(isStuck(yield* stuckJobs({ queuedSeconds: 60, limit: 1000 }))).toBe(false)
      const db = yield* Db
      yield* db
        .update(grades)
        .set({ claimedAt: new Date(Date.now() - (CLAIM_LEASE_SECONDS + 1) * 1000) })
        .where(eq(grades.submissionId, again.submissionId))
      expect(isStuck(yield* stuckJobs({ queuedSeconds: 60, limit: 1000 }))).toBe(true)
    }))

  it.effect("moves a grade with its submission when the teacher splits a student", () =>
    Effect.gen(function* () {
      const { session, joinCode, p1 } = yield* seed()
      const { student: merged } = yield* join(joinCode, "Alex")
      const { student: split } = yield* join(joinCode, "Alex M")
      const s = yield* submit(session.id, merged.id, p1.id)
      const db = yield* Db
      yield* db.update(submissions).set({ studentId: split.id }).where(eq(submissions.id, s.submissionId))
      const grade = Option.getOrThrow(yield* getGrade(s.submissionId))
      expect(grade.studentId).toBe(split.id)
    }))

  it.effect("deletes everything a load-test run created and nothing else", () =>
    Effect.gen(function* () {
      const runId = `run_${crypto.randomUUID()}`
      const real = yield* seed()
      const load = yield* seed({ loadTestRunId: runId })
      const { student } = yield* join(load.joinCode, "Bot 1")
      yield* submit(load.session.id, student.id, load.p1.id)

      const deleted = yield* deleteLoadTestRun(runId)
      expect(deleted).toMatchObject({ classSessions: 1, assignments: 1, teachers: 1 })

      const db = yield* Db
      const left = yield* db.select().from(students).where(eq(students.sessionId, load.session.id))
      expect(left).toHaveLength(0)
      const kept = yield* db.select().from(classSessions).where(eq(classSessions.id, real.session.id))
      expect(kept).toHaveLength(1)
    }))
})
