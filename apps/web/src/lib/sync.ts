/**
 * Live data in the browser: TanStack DB collections synced from Electric through `/api/shape`.
 * The server decides what each view contains (see `server/shapes.ts`); rows are validated here
 * against the schemas below before the UI sees them.
 */
import { snakeCamelMapper } from "@electric-sql/client"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { createCollection } from "@tanstack/react-db"
import { Schema } from "effect"

export const SessionRow = Schema.Struct({
  id: Schema.String,
  assignmentId: Schema.String,
  joinCode: Schema.optional(Schema.String),
  status: Schema.Literal("lobby", "live", "ended"),
  timeLimitMinutes: Schema.NullOr(Schema.Number),
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String)
})
export type SessionRow = typeof SessionRow.Type

export const StudentRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  displayName: Schema.String,
  avatarId: Schema.Number,
  createdAt: Schema.String
})
export type StudentRow = typeof StudentRow.Type

const GradeState = Schema.Literal("submitted", "grading", "graded", "needs_teacher", "couldnt_grade")
const LinePoints = Schema.Array(Schema.Struct({ rubricLineId: Schema.String, points: Schema.Number }))

/** What the teacher's dashboard sees for each grade. */
export const TeacherGradeRow = Schema.Struct({
  submissionId: Schema.String,
  sessionId: Schema.String,
  studentId: Schema.String,
  problemId: Schema.String,
  state: GradeState,
  attempt: Schema.Number,
  maxPoints: Schema.Number,
  graderRead: Schema.NullOr(Schema.String),
  modelLinePoints: Schema.NullOr(LinePoints),
  graderReason: Schema.NullOr(Schema.String),
  flagReason: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  source: Schema.NullOr(Schema.Literal("model", "teacher_accepted", "teacher_scored", "teacher_override")),
  linePoints: Schema.NullOr(LinePoints),
  points: Schema.NullOr(Schema.Number),
  gradedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.String
})
export type TeacherGradeRow = typeof TeacherGradeRow.Type

/** What a student sees of their own grades: a score only once it is final. */
export const StudentGradeRow = Schema.Struct({
  submissionId: Schema.String,
  studentId: Schema.String,
  problemId: Schema.String,
  state: GradeState,
  points: Schema.NullOr(Schema.Number),
  maxPoints: Schema.Number
})
export type StudentGradeRow = typeof StudentGradeRow.Type

type View = "session" | "students" | "grades" | "my-session" | "my-grades"

const shapeOptions = (view: View, sessionId: string) => ({
  url: new URL("/api/shape", window.location.origin).toString(),
  params: { view, sessionId },
  columnMapper: snakeCamelMapper()
})

/** One collection per view and session, shared by every component that asks for it. */
const perSession = <C>(make: (sessionId: string) => C) => {
  const cache = new Map<string, C>()
  return (sessionId: string): C => {
    const existing = cache.get(sessionId)
    if (existing !== undefined) return existing
    const created = make(sessionId)
    cache.set(sessionId, created)
    return created
  }
}

export const teacherSession = perSession((sessionId) =>
  createCollection(
    electricCollectionOptions({
      id: `session:${sessionId}`,
      schema: Schema.standardSchemaV1(SessionRow),
      getKey: (row) => row.id,
      shapeOptions: shapeOptions("session", sessionId)
    })
  )
)

export const teacherStudents = perSession((sessionId) =>
  createCollection(
    electricCollectionOptions({
      id: `students:${sessionId}`,
      schema: Schema.standardSchemaV1(StudentRow),
      getKey: (row) => row.id,
      shapeOptions: shapeOptions("students", sessionId)
    })
  )
)

export const teacherGrades = perSession((sessionId) =>
  createCollection(
    electricCollectionOptions({
      id: `grades:${sessionId}`,
      schema: Schema.standardSchemaV1(TeacherGradeRow),
      getKey: (row) => row.submissionId,
      shapeOptions: shapeOptions("grades", sessionId)
    })
  )
)

export const studentSession = perSession((sessionId) =>
  createCollection(
    electricCollectionOptions({
      id: `my-session:${sessionId}`,
      schema: Schema.standardSchemaV1(SessionRow),
      getKey: (row) => row.id,
      shapeOptions: shapeOptions("my-session", sessionId)
    })
  )
)

export const studentGrades = perSession((sessionId) =>
  createCollection(
    electricCollectionOptions({
      id: `my-grades:${sessionId}`,
      schema: Schema.standardSchemaV1(StudentGradeRow),
      getKey: (row) => row.submissionId,
      shapeOptions: shapeOptions("my-grades", sessionId)
    })
  )
)
