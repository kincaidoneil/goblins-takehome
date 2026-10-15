/**
 * The grading seam: problem, rubric, whiteboard and dependency work in, a grade out.
 *
 * The AI-quality stream owns the real prompt and model choice and replaces
 * `placeholder`. The pipeline only depends on the `Grader` interface.
 */
import type { GradingInput, ModelResult } from "@goblins/domain";
import { Context, Effect, Option, Schema } from "effect";
import {
  BadResponse,
  type CallTag,
  type CompletionRequest,
  ModelClient,
  type ModelError,
} from "./ModelClient.ts";

/**
 * The grader is either sure, or gives a best guess and says why the teacher should check.
 * Failing to produce either is a `ModelError`. These are the domain's `GraderOutcome`
 * variants other than `Failed`, which only the pipeline decides.
 */
export type GradeResult =
  | { readonly _tag: "Sure"; readonly result: ModelResult }
  | { readonly _tag: "Unsure"; readonly result: ModelResult; readonly flagReason: string };

export class Grader extends Context.Tag("@goblins/grader/Grader")<
  Grader,
  {
    /** `tag` goes on every model call the grader makes, so the call log can join calls to the grade. */
    readonly grade: (
      input: GradingInput,
      tag: CallTag,
    ) => Effect.Effect<GradeResult, ModelError, ModelClient>;
  }
>() {}

const PlaceholderReply = Schema.parseJson(
  Schema.Struct({
    read: Schema.String,
    lines: Schema.Array(
      Schema.Struct({ rubricLineId: Schema.String, points: Schema.Int.pipe(Schema.nonNegative()) }),
    ),
    reason: Schema.String,
    unsure: Schema.NullOr(Schema.String),
  }),
);

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
        required: ["rubricLineId", "points"],
        properties: { rubricLineId: { type: "string" }, points: { type: "integer" } },
      },
    },
    reason: { type: "string" },
    unsure: { type: ["string", "null"] },
  },
};

const problemText = (input: GradingInput) =>
  [
    `Problem ${input.problem.label}: ${input.problem.text}`,
    ...(input.problem.diagramDescription === null
      ? []
      : [`Diagram: ${input.problem.diagramDescription}`]),
    `Answer key: ${input.problem.answerKey}`,
    ...(input.problem.gradingNotes === "" ? [] : [`Grading notes: ${input.problem.gradingNotes}`]),
    "Rubric:",
    ...input.rubricLines.map((l) => `[${l.id}] ${l.points} pt: ${l.description}`),
  ].join("\n");

/**
 * A minimal single-call grader so the pipeline runs end to end before the
 * AI-quality stream's prompt lands. Not tuned and not evaluated.
 */
export const placeholder: Grader["Type"] = {
  grade: (input, tag) =>
    Effect.gen(function* () {
      const client = yield* ModelClient;
      const completion = yield* client.complete({
        model: "google/gemini-2.5-flash",
        maxTokens: 800,
        temperature: 0,
        jsonSchema: { name: "grade", schema: placeholderSchema },
        tag,
        messages: [
          {
            role: "system",
            content:
              "You grade a student's handwritten math work against a rubric. Award whole points per rubric line, once per line. " +
              "Give follow-through credit when the method is right but uses the student's own earlier wrong answer. " +
              "If the rubric does not cover the work or the handwriting is unclear, still score it and explain in `unsure`; otherwise set `unsure` to null.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: problemText(input) },
              ...input.problem.pageImageUrls.map((url) => ({ type: "image" as const, url })),
              ...input.dependencies.flatMap((dep) => [
                {
                  type: "text" as const,
                  text: `This problem uses the student's work on problem ${dep.label}: ${dep.text}${Option.match(
                    dep.graderRead,
                    {
                      onNone: () => "",
                      onSome: (read) => `\nThe grader read: ${read}`,
                    },
                  )}`,
                },
                ...Option.match(dep.whiteboardUrl, {
                  onNone: () => [],
                  onSome: (url) => [{ type: "image" as const, url }],
                }),
              ]),
              { type: "text", text: "The student's whiteboard:" },
              { type: "image", url: input.whiteboardUrl },
            ],
          },
        ],
      });
      const unusable = (message: string) => new BadResponse({ message, usage: completion.usage });
      const reply = yield* Schema.decodeUnknown(PlaceholderReply)(completion.text).pipe(
        Effect.mapError(() => unusable("Grade reply did not match the schema")),
      );
      // Exactly one score per rubric line, within its points. The domain checks this again on write.
      const max = new Map(input.rubricLines.map((l) => [l.id, l.points]));
      const oneEach =
        reply.lines.length === input.rubricLines.length &&
        new Set(reply.lines.map((l) => l.rubricLineId)).size === input.rubricLines.length;
      const inRange = reply.lines.every((l) => {
        const lineMax = max.get(l.rubricLineId);
        return lineMax !== undefined && l.points <= lineMax;
      });
      if (!oneEach || !inRange)
        return yield* unusable(
          "Grade reply did not score each rubric line once, within its points",
        );
      const result: ModelResult = {
        read: reply.read,
        linePoints: reply.lines,
        reason: reply.reason,
      };
      return reply.unsure === null
        ? { _tag: "Sure" as const, result }
        : { _tag: "Unsure" as const, result, flagReason: reply.unsure };
    }),
};

/**
 * What a scripted mock answer says, matching `Answer` in `packages/mock-model`
 * (declared here so the grader does not depend on the mock).
 */
export type MockAnswer =
  | {
      readonly _tag: "Graded";
      readonly score: number;
      readonly maxScore: number;
      readonly feedback: string;
    }
  | { readonly _tag: "NeedsTeacher"; readonly reason: string }
  | { readonly _tag: "Text"; readonly text: string };

/** Rubric lines as `placeholder` writes them into its prompt: `[<id>] <points> pt: ...`. */
const rubricLinesIn = (request: CompletionRequest) =>
  request.messages
    .flatMap((m) =>
      typeof m.content === "string"
        ? [m.content]
        : m.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    )
    .flatMap((text) =>
      [...text.matchAll(/^\[([0-9a-f-]{36})\] (\d+) pt:/gm)].map((m) => ({
        id: m[1] ?? "",
        points: Number(m[2]),
      })),
    );

/**
 * Renders a mock answer as the reply `placeholder` expects, for the rubric lines in
 * the request. A Graded score is spread over the lines in order; a NeedsTeacher
 * answer scores nothing and gives its reason as `unsure`. Pass it to the mock as
 * `MockModel.layer(config, { render: Grader.placeholderRender })`.
 */
export const placeholderRender = (answer: MockAnswer, request: CompletionRequest): string => {
  if (answer._tag === "Text") return answer.text;
  const lines = rubricLinesIn(request);
  const total = lines.reduce((sum, l) => sum + l.points, 0);
  let remaining =
    answer._tag === "Graded" && answer.maxScore > 0
      ? Math.round((total * answer.score) / answer.maxScore)
      : 0;
  const scored = lines.map((l) => {
    const points = Math.min(l.points, remaining);
    remaining -= points;
    return { rubricLineId: l.id, points };
  });
  return JSON.stringify({
    read: answer._tag === "Graded" ? answer.feedback : "",
    lines: scored,
    reason: answer._tag === "Graded" ? answer.feedback : answer.reason,
    unsure: answer._tag === "NeedsTeacher" ? answer.reason : null,
  });
};
