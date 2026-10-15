/**
 * Joining a session and submitting work: the two writes students make.
 */
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { Db, SqlClient } from "./db";
import { Attempt, type GradeJob, SubmissionId } from "./grade";
import type { JoinCode } from "./join-code";
import { cleanDisplayName, MAX_NAME_LENGTH, normalizeName } from "./names";
import { classSessions, grades, problems, rubricLines, students, submissions } from "./schema";

export type Student = typeof students.$inferSelect;

// ---------------------------------------------------------------------------
// Join and resume

/** No open session has this code. */
export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  readonly joinCode: string;
}> {}

export class InvalidName extends Data.TaggedError("InvalidName")<{
  readonly reason: "empty" | "too_long";
}> {}

/**
 * Joins the open session with this code, or resumes the student with the same name (PRD, "Names").
 * Late joins are normal. `pickAvatar` runs only for a new student and gets the creature ids
 * already taken in the session, so the caller can avoid repeats.
 */
export const joinSession = (input: {
  readonly joinCode: JoinCode;
  readonly name: string;
  readonly pickAvatar: (taken: ReadonlyArray<number>) => number;
}) =>
  Effect.gen(function* () {
    const displayName = cleanDisplayName(input.name);
    const nameKey = normalizeName(displayName);
    if (nameKey === "") return yield* Effect.fail(new InvalidName({ reason: "empty" }));
    if (displayName.length > MAX_NAME_LENGTH) {
      return yield* Effect.fail(new InvalidName({ reason: "too_long" }));
    }

    const db = yield* Db;
    const sqlClient = yield* SqlClient;
    return yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        const [session] = yield* db
          .select({ id: classSessions.id })
          .from(classSessions)
          .where(
            and(
              eq(classSessions.joinCode, input.joinCode),
              sql`${classSessions.status} <> 'ended'`,
            ),
          )
          // Holds off a concurrent "end session" until the join commits.
          .for("share");
        if (session === undefined) {
          return yield* Effect.fail(new SessionNotFound({ joinCode: input.joinCode }));
        }

        const taken = yield* db
          .select({ avatarId: students.avatarId })
          .from(students)
          .where(eq(students.sessionId, session.id));
        const [created] = yield* db
          .insert(students)
          .values({
            sessionId: session.id,
            displayName,
            nameKey,
            avatarId: input.pickAvatar(taken.map((row) => row.avatarId)),
          })
          .onConflictDoNothing({ target: [students.sessionId, students.nameKey] })
          .returning();
        if (created !== undefined) return { student: created, resumed: false };

        const [existing] = yield* db
          .select()
          .from(students)
          .where(and(eq(students.sessionId, session.id), eq(students.nameKey, nameKey)));
        // The conflict that skipped the insert guarantees the row.
        if (existing === undefined)
          return yield* Effect.die("student vanished between insert and select");
        return { student: existing, resumed: true };
      }),
    );
  });

// ---------------------------------------------------------------------------
// Submit

/** Why a submission was refused. The student's client keeps the work and shows the reason. */
export class SubmissionRejected extends Data.TaggedError("SubmissionRejected")<{
  readonly reason: /** The teacher has not started the session, or has ended it. */
    | "session_not_live"
    /** The student is not in this session, e.g. the teacher split or removed them. */
    | "unknown_student"
    /** The problem is not part of this session's assignment. */
    | "unknown_problem";
}> {}

/**
 * Records a student's submission and creates its grade in `submitted`. Idempotent per student and
 * problem: a retry of the same submit returns the existing submission (a submitted problem is
 * locked, so the first whiteboard wins).
 *
 * Returns the job to enqueue while the grade is still waiting on the pipeline, so a client retry
 * also re-enqueues a message that was lost after the first write.
 */
export const submitWork = (input: {
  readonly sessionId: string;
  readonly studentId: string;
  readonly problemId: string;
  readonly whiteboardUrl: string;
  readonly submittedAt: Date;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const sqlClient = yield* SqlClient;

    const reject = (reason: SubmissionRejected["reason"]) =>
      Effect.fail(new SubmissionRejected({ reason }));

    return yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        const [session] = yield* db
          .select({ status: classSessions.status, assignmentId: classSessions.assignmentId })
          .from(classSessions)
          .where(eq(classSessions.id, input.sessionId))
          // Holds off a concurrent "end session" until this submission commits, so ending a
          // session reliably stops new submissions.
          .for("share");
        if (session === undefined || session.status !== "live")
          return yield* reject("session_not_live");

        const [student] = yield* db
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.id, input.studentId), eq(students.sessionId, input.sessionId)));
        if (student === undefined) return yield* reject("unknown_student");

        const [problem] = yield* db
          .select({ maxPoints: sql<number>`coalesce(sum(${rubricLines.points}), 0)::int` })
          .from(problems)
          .leftJoin(rubricLines, eq(rubricLines.problemId, problems.id))
          .where(
            and(eq(problems.id, input.problemId), eq(problems.assignmentId, session.assignmentId)),
          )
          .groupBy(problems.id);
        if (problem === undefined || problem.maxPoints <= 0)
          return yield* reject("unknown_problem");

        const [inserted] = yield* db
          .insert(submissions)
          .values({
            sessionId: input.sessionId,
            studentId: input.studentId,
            problemId: input.problemId,
            whiteboardUrl: input.whiteboardUrl,
            submittedAt: input.submittedAt,
          })
          .onConflictDoNothing({ target: [submissions.studentId, submissions.problemId] })
          .returning({ id: submissions.id });

        if (inserted !== undefined) {
          yield* db.insert(grades).values({
            submissionId: inserted.id,
            sessionId: input.sessionId,
            studentId: input.studentId,
            problemId: input.problemId,
            maxPoints: problem.maxPoints,
          });
          const submissionId = SubmissionId.make(inserted.id);
          return {
            submissionId,
            isNew: true,
            job: Option.some<GradeJob>({ submissionId, attempt: Attempt.make(1) }),
          };
        }

        const [existing] = yield* db
          .select({
            submissionId: grades.submissionId,
            state: grades.state,
            attempt: grades.attempt,
          })
          .from(grades)
          .innerJoin(submissions, eq(submissions.id, grades.submissionId))
          .where(
            and(
              eq(submissions.studentId, input.studentId),
              eq(submissions.problemId, input.problemId),
            ),
          );
        if (existing === undefined) return yield* Effect.die("submission without a grade");
        const submissionId = SubmissionId.make(existing.submissionId);
        return {
          submissionId,
          isNew: false,
          job:
            existing.state === "submitted"
              ? Option.some<GradeJob>({ submissionId, attempt: Attempt.make(existing.attempt) })
              : Option.none<GradeJob>(),
        };
      }),
    );
  });
