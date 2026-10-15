/**
 * Which live data each viewer may read. The browser asks the shape proxy for a named view; the
 * server checks who is asking and picks the table, filter and columns. The browser never sends a
 * `where` clause.
 */
import { Db, schema } from "@goblins/domain"
import { and, eq } from "drizzle-orm"
import { Data, Effect, Option } from "effect"
import { studentFromCookies } from "./student-identity"
import { currentTeacher } from "./teacher"

/** An Electric shape: one table, a parameterized filter, and the columns to send. */
export interface ShapeDefinition {
  readonly table: string
  readonly where: string
  readonly params: ReadonlyArray<string>
  readonly columns: ReadonlyArray<string>
}

export class Forbidden extends Data.TaggedError("Forbidden") {}
export class UnknownView extends Data.TaggedError("UnknownView") {}

const sessionColumns = ["id", "assignment_id", "join_code", "status", "time_limit_minutes", "started_at", "ended_at"]
const studentColumns = ["id", "session_id", "display_name", "avatar", "created_at"]
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
  "updated_at"
]
/** Students see only their own final scores: `points` is null until a grade is final. */
const gradeColumnsForStudent = ["submission_id", "student_id", "problem_id", "state", "points", "max_points"]

const bySession = (table: string, sessionId: string, columns: ReadonlyArray<string>): ShapeDefinition => ({
  table,
  where: table === "class_sessions" ? "id = $1" : "session_id = $1",
  params: [sessionId],
  columns
})

const teacherOwnsSession = (sessionId: string) =>
  Effect.gen(function* () {
    const teacher = yield* currentTeacher
    const db = yield* Db
    const [row] = yield* db
      .select({ id: schema.classSessions.id })
      .from(schema.classSessions)
      .where(and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.teacherId, teacher.id)))
    if (row === undefined) return yield* Effect.fail(new Forbidden())
  })

/**
 * Views:
 * - `session`, `students`, `grades`: the teacher's dashboard and projector for one session.
 * - `my-session`, `my-grades`: a student's own session status and scores.
 */
export const resolveShape = (request: Request, view: string, sessionId: string) =>
  Effect.gen(function* () {
    switch (view) {
      case "session":
        yield* teacherOwnsSession(sessionId)
        return bySession("class_sessions", sessionId, sessionColumns)
      case "students":
        yield* teacherOwnsSession(sessionId)
        return bySession("students", sessionId, studentColumns)
      case "grades":
        yield* teacherOwnsSession(sessionId)
        return bySession("grades", sessionId, gradeColumnsForTeacher)
      case "my-session": {
        yield* requireStudent(request, sessionId)
        return bySession("class_sessions", sessionId, sessionColumns.filter((c) => c !== "join_code"))
      }
      case "my-grades": {
        const studentId = yield* requireStudent(request, sessionId)
        return {
          table: "grades",
          where: "student_id = $1",
          params: [studentId],
          columns: gradeColumnsForStudent
        } satisfies ShapeDefinition
      }
      default:
        return yield* Effect.fail(new UnknownView())
    }
  })

const requireStudent = (request: Request, sessionId: string) =>
  Effect.flatMap(studentFromCookies(request.headers.get("cookie"), sessionId), (studentId) =>
    Option.match(studentId, {
      onNone: () => Effect.fail(new Forbidden()),
      onSome: Effect.succeed
    })
  )
