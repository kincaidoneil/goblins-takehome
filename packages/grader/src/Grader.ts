/**
 * The grading seam: problem, rubric, whiteboard and dependency work in, a grade out.
 *
 * The AI-quality stream owns the real prompt and model choice and replaces
 * `placeholder`. The pipeline only depends on the `Grader` interface.
 */
import { Context, Effect, Schema } from "effect"
import { BadResponse, ModelClient, type ModelError } from "./ModelClient.ts"

export interface RubricLine {
  readonly id: string
  /** Plain-language point line, such as "1 pt: correct setup". */
  readonly text: string
  readonly points: number
}

export interface ProblemWork {
  readonly problemText: string
  /** Text description of any diagram the problem relies on. */
  readonly diagramDescription?: string
  /** URL of the student's whiteboard image (Vercel Blob, or a data URL in tests). */
  readonly whiteboardUrl: string
}

export interface GradeInput {
  readonly gradeId: string
  readonly problem: ProblemWork
  readonly rubric: ReadonlyArray<RubricLine>
  /** The student's own work on earlier problems this one depends on, for follow-through credit. */
  readonly dependencies: ReadonlyArray<ProblemWork>
  readonly loadTestRunId?: string
}

export interface LineScore {
  readonly lineId: string
  readonly awarded: number
}

export interface Assessment {
  /** What the grader read from the whiteboard, shown to the teacher. */
  readonly read: string
  readonly lines: ReadonlyArray<LineScore>
  /** One-line reason for the score. */
  readonly reason: string
}

/**
 * The grader is either sure, or gives a best guess and says why the teacher should check.
 * Failing to produce either is a `ModelError`.
 */
export type GradeOutcome =
  | { readonly _tag: "Graded"; readonly assessment: Assessment }
  | { readonly _tag: "NeedsTeacher"; readonly assessment: Assessment; readonly flag: string }

export class Grader extends Context.Tag("@goblins/grader/Grader")<
  Grader,
  {
    readonly grade: (input: GradeInput) => Effect.Effect<GradeOutcome, ModelError, ModelClient>
  }
>() {}

const PlaceholderReply = Schema.parseJson(
  Schema.Struct({
    read: Schema.String,
    lines: Schema.Array(Schema.Struct({ lineId: Schema.String, awarded: Schema.Number })),
    reason: Schema.String,
    unsure: Schema.NullOr(Schema.String),
  }),
)

const placeholderSchema = {
  type: "object",
  additionalProperties: false,
  required: ["read", "lines", "reason", "unsure"],
  properties: {
    read: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lineId", "awarded"],
        properties: { lineId: { type: "string" }, awarded: { type: "number" } },
      },
    },
    reason: { type: "string" },
    unsure: { type: ["string", "null"] },
  },
}

const describeWork = (label: string, work: ProblemWork) =>
  [
    `${label}: ${work.problemText}`,
    ...(work.diagramDescription === undefined ? [] : [`Diagram: ${work.diagramDescription}`]),
  ].join("\n")

/**
 * A minimal single-call grader so the pipeline runs end to end before the
 * AI-quality stream's prompt lands. Not tuned and not evaluated.
 */
export const placeholder: Grader["Type"] = {
  grade: (input) =>
    Effect.gen(function* () {
      const client = yield* ModelClient
      const completion = yield* client.complete({
        model: "google/gemini-2.5-flash",
        maxTokens: 800,
        temperature: 0,
        jsonSchema: { name: "grade", schema: placeholderSchema },
        tag: {
          purpose: "grade",
          subjectId: input.gradeId,
          ...(input.loadTestRunId === undefined ? {} : { loadTestRunId: input.loadTestRunId }),
        },
        messages: [
          {
            role: "system",
            content:
              "You grade a student's handwritten math work against a rubric. Award points per rubric line. " +
              "Give follow-through credit when the method is right but uses the student's own earlier wrong answer. " +
              "If the rubric does not cover the work or the handwriting is unclear, still score it and explain in `unsure`; otherwise set `unsure` to null.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: describeWork("Problem", input.problem) },
              {
                type: "text",
                text: `Rubric:\n${input.rubric.map((l) => `[${l.id}] ${l.points} pt: ${l.text}`).join("\n")}`,
              },
              ...input.dependencies.flatMap((dep, i) => [
                { type: "text" as const, text: describeWork(`Earlier problem ${i + 1} this depends on`, dep) },
                { type: "image" as const, url: dep.whiteboardUrl },
              ]),
              { type: "text", text: "The student's whiteboard:" },
              { type: "image", url: input.problem.whiteboardUrl },
            ],
          },
        ],
      })
      const reply = yield* Schema.decodeUnknown(PlaceholderReply)(completion.text).pipe(
        Effect.mapError(
          () => new BadResponse({ message: "Grade reply did not match the schema", usage: completion.usage }),
        ),
      )
      const known = new Map(input.rubric.map((l) => [l.id, l.points]))
      const valid = reply.lines.every((l) => {
        const max = known.get(l.lineId)
        return max !== undefined && l.awarded >= 0 && l.awarded <= max
      })
      if (!valid || new Set(reply.lines.map((l) => l.lineId)).size !== input.rubric.length) {
        return yield* new BadResponse({ message: "Grade reply scored unknown lines or out of range", usage: completion.usage })
      }
      const assessment = { read: reply.read, lines: reply.lines, reason: reply.reason }
      return reply.unsure === null
        ? { _tag: "Graded" as const, assessment }
        : { _tag: "NeedsTeacher" as const, assessment, flag: reply.unsure }
    }),
}
