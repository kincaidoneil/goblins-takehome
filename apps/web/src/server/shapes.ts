/**
 * Which live data each viewer may read. The browser asks the shape proxy for a named view; the
 * server checks who is asking and picks the table, filter and columns. The browser never sends a
 * `where` clause.
 */
import { Db, schema } from "@goblins/domain";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Option, Schema } from "effect";
import { loadTestAuth } from "./loadtest/identity";
import { studentFromCookies } from "./student-identity";
import { teacherFor } from "./teacher";

/** An Electric shape: one table, a parameterized filter, and the columns to send. */
export interface ShapeDefinition {
  readonly table: string;
  readonly where: string;
  readonly params: ReadonlyArray<string>;
  readonly columns: ReadonlyArray<string>;
  /**
   * Which of the shape's rows the caller receives. `OfStudent` reads the class's shared shape
   * and the proxy keeps only that student's rows, so Electric serves one shape per class
   * instead of one per student (see docs/decisions.md, "shared grade shape").
   */
  readonly rows:
    | { readonly _tag: "All" }
    | { readonly _tag: "OfStudent"; readonly studentId: string };
}

export class Forbidden extends Data.TaggedError("Forbidden") {}
/** The view name or session id is not one this proxy serves. */
export class UnknownView extends Data.TaggedError("UnknownView") {}

const isUuid = Schema.is(Schema.UUID);

const sessionColumns = [
  "id",
  "assignment_id",
  "join_code",
  "status",
  "time_limit_minutes",
  "started_at",
  "ended_at",
];
const studentColumns = ["id", "session_id", "display_name", "avatar_id", "created_at"];
const gradeColumnsForTeacher = [
  "submission_id",
  "session_id",
  "student_id",
  "problem_id",
  "state",
  "attempt",
  "max_points",
  "grader_read",
  "model_line_points",
  "grader_reason",
  "flag_reason",
  "failure_reason",
  "source",
  "line_points",
  "points",
  "graded_at",
  "updated_at",
];
/** Students see only their own final scores: `points` is null until a grade is final. */
const gradeColumnsForStudent = [
  "submission_id",
  "student_id",
  "problem_id",
  "state",
  "points",
  "max_points",
];

const bySession = (
  table: string,
  sessionId: string,
  columns: ReadonlyArray<string>,
): ShapeDefinition => ({
  table,
  where: table === "class_sessions" ? "id = $1" : "session_id = $1",
  params: [sessionId],
  columns,
  rows: { _tag: "All" },
});

const teacherOwnsSession = (request: Request, sessionId: string) =>
  Effect.gen(function* () {
    const teacher = yield* teacherFor(loadTestAuth(request));
    const db = yield* Db;
    const [row] = yield* db
      .select({ id: schema.classSessions.id })
      .from(schema.classSessions)
      .where(
        and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.teacherId, teacher.id)),
      );
    if (row === undefined) return yield* Effect.fail(new Forbidden());
  });

/**
 * Views:
 * - `session`, `students`, `grades`: the teacher's dashboard and projector for one session.
 * - `my-session`, `my-grades`: a student's own session status and scores.
 */
export const resolveShape = (request: Request, view: string, sessionId: string) =>
  Effect.gen(function* () {
    if (!isUuid(sessionId)) return yield* Effect.fail(new UnknownView());
    switch (view) {
      case "session":
        yield* teacherOwnsSession(request, sessionId);
        return bySession("class_sessions", sessionId, sessionColumns);
      case "students":
        yield* teacherOwnsSession(request, sessionId);
        return bySession("students", sessionId, studentColumns);
      case "grades":
        yield* teacherOwnsSession(request, sessionId);
        return bySession("grades", sessionId, gradeColumnsForTeacher);
      case "my-session": {
        yield* requireStudent(request, sessionId);
        return bySession(
          "class_sessions",
          sessionId,
          sessionColumns.filter((c) => c !== "join_code"),
        );
      }
      case "my-grades": {
        const studentId = yield* requireStudent(request, sessionId);
        return {
          ...bySession("grades", sessionId, gradeColumnsForStudent),
          rows: { _tag: "OfStudent", studentId },
        } satisfies ShapeDefinition;
      }
      default:
        return yield* Effect.fail(new UnknownView());
    }
  });

const requireStudent = (request: Request, sessionId: string) =>
  Effect.flatMap(studentFromCookies(request.headers.get("cookie"), sessionId), (studentId) =>
    Option.match(studentId, {
      onNone: () => Effect.fail(new Forbidden()),
      onSome: Effect.succeed,
    }),
  );
