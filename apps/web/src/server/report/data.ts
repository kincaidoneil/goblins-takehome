/**
 * What the report reads from the database: the session (checked against the signed-in teacher,
 * or found by its share token), the assignment's problems and rubric, and the class's work.
 */
import { Db, schema } from "@goblins/domain";
import { asc, eq, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { ReportInput, ReportProblem } from "../../report/model";

/** No such session for this teacher, or no such share link. The two look the same on purpose. */
export class ReportNotFound extends Data.TaggedError("ReportNotFound") {}

export type SessionRow = typeof schema.classSessions.$inferSelect;

/** The session behind a share link. */
export const sharedSession = (token: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [session] = yield* db
      .select()
      .from(schema.classSessions)
      .where(eq(schema.classSessions.reportShareToken, token));
    if (session === undefined) return yield* Effect.fail(new ReportNotFound());
    return session;
  });

export interface ReportHeader {
  readonly title: string;
  readonly teacherName: string;
  readonly status: SessionRow["status"];
  readonly endedAt: string | null;
}

export const reportHeader = (session: SessionRow) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db
      .select({ title: schema.assignments.title, teacherName: schema.teachers.name })
      .from(schema.assignments)
      .innerJoin(schema.teachers, eq(schema.teachers.id, session.teacherId))
      .where(eq(schema.assignments.id, session.assignmentId));
    return {
      title: row === undefined || row.title === "" ? "Untitled assignment" : row.title,
      teacherName: row?.teacherName ?? "A teacher",
      status: session.status,
      endedAt: session.endedAt?.toISOString() ?? null,
    } satisfies ReportHeader;
  });

/** The assignment's problems in worksheet order, each with its rubric. */
export const reportProblems = (assignmentId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const problems = yield* db
      .select({
        id: schema.problems.id,
        label: schema.problems.label,
        text: schema.problems.text,
      })
      .from(schema.problems)
      .where(eq(schema.problems.assignmentId, assignmentId))
      .orderBy(asc(schema.problems.position));
    const lines =
      problems.length === 0
        ? []
        : yield* db
            .select({
              id: schema.rubricLines.id,
              problemId: schema.rubricLines.problemId,
              description: schema.rubricLines.description,
              points: schema.rubricLines.points,
            })
            .from(schema.rubricLines)
            .where(
              inArray(
                schema.rubricLines.problemId,
                problems.map((p) => p.id),
              ),
            )
            .orderBy(asc(schema.rubricLines.position));
    return problems.map((p): ReportProblem => {
      const rubricLines = lines
        .filter((l) => l.problemId === p.id)
        .map(({ id, description, points }) => ({ id, description, points }));
      return {
        ...p,
        rubricLines,
        maxPoints: rubricLines.reduce((sum, l) => sum + l.points, 0),
      };
    });
  });

/** Everything the report computes from, read once. The teacher's page reads it live instead. */
export const reportInput = (sessionId: string, problems: ReadonlyArray<ReportProblem>) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const students = yield* db
      .select({
        id: schema.students.id,
        displayName: schema.students.displayName,
        avatarId: schema.students.avatarId,
      })
      .from(schema.students)
      .where(eq(schema.students.sessionId, sessionId))
      .orderBy(asc(schema.students.createdAt));
    const grades = yield* db
      .select({
        submissionId: schema.grades.submissionId,
        studentId: schema.grades.studentId,
        problemId: schema.grades.problemId,
        state: schema.grades.state,
        points: schema.grades.points,
        maxPoints: schema.grades.maxPoints,
        graderReason: schema.grades.graderReason,
        linePoints: schema.grades.linePoints,
      })
      .from(schema.grades)
      .where(eq(schema.grades.sessionId, sessionId));
    return { problems, students, grades } satisfies ReportInput;
  });
