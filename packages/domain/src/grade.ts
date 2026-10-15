/**
 * The grade state machine (PRD, "Grading"):
 *
 *   Submitted -> Grading -> Graded         grader is sure
 *                        -> NeedsTeacher   unsure, with reason
 *                        -> CouldntGrade   retries ran out
 *   NeedsTeacher -> Graded                 teacher accepts or rescores
 *   CouldntGrade -> Graded                 teacher scores it
 *   NeedsTeacher | CouldntGrade -> Grading teacher retries
 *   Graded -> Graded                       teacher overrides
 *
 * A `grades` row decodes into the `Grade` union here. Only `Graded` shows a score to the student.
 */
import { Schema } from "effect"

export const SubmissionId = Schema.UUID.pipe(Schema.brand("SubmissionId"))
export type SubmissionId = typeof SubmissionId.Type

export const RubricLineId = Schema.UUID.pipe(Schema.brand("RubricLineId"))
export type RubricLineId = typeof RubricLineId.Type

export const Attempt = Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.brand("Attempt"))
export type Attempt = typeof Attempt.Type

const Points = Schema.Int.pipe(Schema.nonNegative())

/** Points awarded for one rubric line. */
export const LinePoint = Schema.Struct({
  rubricLineId: Schema.UUID,
  points: Points
})
export type LinePoint = typeof LinePoint.Type

export const LinePoints = Schema.Array(LinePoint)
export type LinePoints = typeof LinePoints.Type

/** What the model returned, kept so the teacher can always see what the grader read and why. */
export const ModelResult = Schema.Struct({
  /** What the grader read from the whiteboard. */
  read: Schema.String,
  linePoints: LinePoints,
  /** One-line reason for the score. */
  reason: Schema.String
})
export type ModelResult = typeof ModelResult.Type

export const GradeSource = Schema.Literal(
  "model",
  "teacher_accepted",
  "teacher_scored",
  "teacher_override"
)
export type GradeSource = typeof GradeSource.Type

export class Submitted extends Schema.TaggedClass<Submitted>()("Submitted", {
  attempt: Attempt
}) {}

export class Grading extends Schema.TaggedClass<Grading>()("Grading", {
  attempt: Attempt
}) {}

export class Graded extends Schema.TaggedClass<Graded>()("Graded", {
  attempt: Attempt,
  source: GradeSource,
  linePoints: LinePoints,
  points: Points,
  gradedAt: Schema.DateFromSelf,
  /** Absent when the teacher scored a grade the model could not. */
  model: Schema.OptionFromSelf(ModelResult),
  /** Present when the grade went through `NeedsTeacher` first. */
  flagReason: Schema.OptionFromSelf(Schema.String)
}) {}

export class NeedsTeacher extends Schema.TaggedClass<NeedsTeacher>()("NeedsTeacher", {
  attempt: Attempt,
  /** The model's best guess, which the teacher can accept. */
  model: ModelResult,
  flagReason: Schema.String
}) {}

export class CouldntGrade extends Schema.TaggedClass<CouldntGrade>()("CouldntGrade", {
  attempt: Attempt,
  failureReason: Schema.String
}) {}

export const GradeStatus = Schema.Union(Submitted, Grading, Graded, NeedsTeacher, CouldntGrade)
export type GradeStatus = typeof GradeStatus.Type

/** A grade with its identity and the student-facing max score. */
export const Grade = Schema.Struct({
  submissionId: SubmissionId,
  sessionId: Schema.UUID,
  studentId: Schema.UUID,
  problemId: Schema.UUID,
  maxPoints: Schema.Int.pipe(Schema.positive()),
  status: GradeStatus,
  updatedAt: Schema.DateFromSelf
})
export type Grade = typeof Grade.Type

/** What a student sees for one problem. Anything not final reads "your teacher will check this one". */
export type StudentView =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "TeacherWillCheck" }
  | { readonly _tag: "Scored"; readonly points: number; readonly maxPoints: number }

export const studentView = (grade: Grade): StudentView => {
  switch (grade.status._tag) {
    case "Submitted":
    case "Grading":
      return { _tag: "Pending" }
    case "NeedsTeacher":
    case "CouldntGrade":
      return { _tag: "TeacherWillCheck" }
    case "Graded":
      return { _tag: "Scored", points: grade.status.points, maxPoints: grade.maxPoints }
  }
}

// ---------------------------------------------------------------------------
// Messages between the app and the grading pipeline

/** The queue message for one grading attempt. Delivery is at-least-once. */
export const GradeJob = Schema.Struct({
  submissionId: SubmissionId,
  attempt: Attempt
})
export type GradeJob = typeof GradeJob.Type

/** What the grading pipeline reports for one attempt. */
export const GraderOutcome = Schema.Union(
  Schema.TaggedStruct("Sure", { result: ModelResult }),
  Schema.TaggedStruct("Unsure", { result: ModelResult, flagReason: Schema.String }),
  Schema.TaggedStruct("Failed", { failureReason: Schema.String })
)
export type GraderOutcome = typeof GraderOutcome.Type

/** Sum of line points. */
export const totalPoints = (linePoints: LinePoints): number =>
  linePoints.reduce((sum, line) => sum + line.points, 0)
