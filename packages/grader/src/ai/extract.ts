/**
 * Extraction: worksheet page images in; the problems the grader needs out, each with its text,
 * a description of any diagram, an answer key, a drafted AP-style rubric and links to the
 * earlier problems it uses. One model call sees every page, so a problem that runs across a
 * page break comes back as one problem.
 */
import { Effect, Either, Schema } from "effect";
import {
  BadResponse,
  type CallTag,
  type ContentPart,
  ModelClient,
  type ModelError,
  type Usage,
} from "../ModelClient.ts";
import { type ModelChoice, models } from "./models.ts";

/** Named as in the domain's `rubric_lines` table. */
export interface DraftRubricLine {
  readonly points: number;
  readonly description: string;
}

export interface ExtractedProblem {
  /** As printed: "4", or "3b" for a lettered part. Parts become separate problems. */
  readonly label: string;
  /** 1-based pages the problem appears on. */
  readonly pageNumbers: ReadonlyArray<number>;
  /** Self-contained: a part's text starts with the shared stem it needs. */
  readonly text: string;
  readonly diagramDescription: string | null;
  readonly answerKey: string;
  readonly gradingNotes: string;
  readonly rubric: ReadonlyArray<DraftRubricLine>;
  /** Labels of earlier problems whose answers this one uses. */
  readonly dependsOn: ReadonlyArray<string>;
}

export type Extraction =
  | { readonly _tag: "Worksheet"; readonly problems: ReadonlyArray<ExtractedProblem> }
  /** The app says so rather than guessing (PRD, Assignment setup). */
  | { readonly _tag: "NotMath"; readonly message: string }
  | { readonly _tag: "Unreadable"; readonly message: string };

export interface ExtractResult {
  readonly extraction: Extraction;
  readonly usage: Usage;
  readonly model: string;
}

export const rubricGuide = `Rubrics read like an AP scoring guide, in the teacher's plain language:
- One to four point lines per problem, whole points, usually 1 point each. A line is one thing a teacher can see in the work: a correct setup or method, a correct intermediate result, the final answer, a correct explanation or label.
- Most problems with a method and an answer get two lines: the method, then the answer. A one-step problem can have one line.
- Each line names what earns it concretely: "1 pt: sets up 11n + 3 = 80 or an equivalent method", "1 pt: answer: 7 pizzas". Never "correct work".
- A problem that uses an earlier answer must give follow-through credit: every line that depends on the earlier result says so, e.g. "1 pt: correct slope of the student's own line from 3b, correct or not".
- gradingNotes holds guidance that is not a point line: equivalent forms to accept, rounding tolerance, whether units matter (by default they don't).`;

export const extractSystemPrompt = `You turn a teacher's math worksheet into the problems an auto-grader will grade. Students answer each problem on its own whiteboard, and the grader sees only what you write here, so each problem must stand on its own and its answer key must be right.

For every problem on the worksheet, in order:
- label: the number as printed. Only when the worksheet prints letters (a, b, c) for parts, output each part as its own problem labeled "3a", "3b". Never invent letters: a problem that lists several equations or questions without letters is one problem, and its text includes all of them.
- pages: the 1-based pages this problem or part appears on. A problem that continues onto the next page is still one problem.
- text: the problem text exactly as printed, without the leading number or letter, with math in LaTeX between \\( and \\). For a part, start with the problem's shared introduction and any table it gives, then the part's own text. Tables become Markdown rows.
- diagramDescription: if this problem or part needs a figure, graph or picture, describe it so completely that someone could solve the problem without seeing it: every label, given measure, marked right angle and tick mark; for a graph, the axis labels, ranges and scale, and the coordinates of every plotted or marked point, read carefully against the gridlines. Write the full description for every part that needs it; never "same as above". Otherwise null.
- answerKey: solve the problem yourself, carefully. Take every value from the figure as drawn and labeled, and check your answer (substitute it back, or check that angles sum correctly). Give the answer, other forms a teacher would accept, and a short worked solution. For an explanation or drawing, give a sample full-credit answer and what it must include. If a value in the figure is hard to read, say so.
- rubric and gradingNotes: draft them as described below.
- dependsOn: labels of earlier problems whose answers this one uses ("use your answer to 2a", "the line you drew", or plainly building on an earlier result). Empty when independent.

${rubricGuide}

If the pages are not a math worksheet, set status "not_math". If you cannot read them, set status "unreadable". Either way, say why in message and return no problems. Otherwise status is "ok" and message is "".`;

const replyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "message", "problems"],
  properties: {
    status: { type: "string", enum: ["ok", "not_math", "unreadable"] },
    message: { type: "string" },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "pages",
          "text",
          "diagramDescription",
          "answerKey",
          "rubric",
          "gradingNotes",
          "dependsOn",
        ],
        properties: {
          label: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
          text: { type: "string" },
          diagramDescription: { type: ["string", "null"] },
          answerKey: { type: "string" },
          rubric: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["points", "text"],
              properties: { points: { type: "integer" }, text: { type: "string" } },
            },
          },
          gradingNotes: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

/** As printed: "4", "3b", "A2", "IV". Short and without spaces, since it names a whiteboard. */
const Label = Schema.String.pipe(Schema.pattern(/^\S{1,12}$/));

const Reply = Schema.parseJson(
  Schema.Struct({
    status: Schema.Literal("ok", "not_math", "unreadable"),
    message: Schema.String,
    problems: Schema.Array(
      Schema.Struct({
        label: Label,
        pages: Schema.Array(Schema.Int.pipe(Schema.positive())),
        text: Schema.NonEmptyString,
        diagramDescription: Schema.NullOr(Schema.String),
        answerKey: Schema.String,
        rubric: Schema.NonEmptyArray(
          Schema.Struct({
            points: Schema.Int.pipe(Schema.positive()),
            text: Schema.NonEmptyString,
          }),
        ),
        gradingNotes: Schema.String,
        dependsOn: Schema.Array(Schema.String),
      }),
    ),
  }),
);

/**
 * The problem as the model reads and writes it: `pages`, and rubric lines with `text`. Kept apart
 * from the domain names so the prompt, and with it the eval cache, doesn't change with them.
 */
export interface WireProblem {
  readonly label: string;
  readonly pages: ReadonlyArray<number>;
  readonly text: string;
  readonly diagramDescription: string | null;
  readonly answerKey: string;
  readonly rubric: ReadonlyArray<{ readonly points: number; readonly text: string }>;
  readonly gradingNotes: string;
  readonly dependsOn: ReadonlyArray<string>;
}

export const fromWire = (p: WireProblem): ExtractedProblem => ({
  label: p.label,
  pageNumbers: p.pages,
  text: p.text,
  diagramDescription: p.diagramDescription,
  answerKey: p.answerKey,
  gradingNotes: p.gradingNotes,
  rubric: p.rubric.map((l) => ({ points: l.points, description: l.text })),
  dependsOn: p.dependsOn,
});

export const toWire = (p: ExtractedProblem): WireProblem => ({
  label: p.label,
  pages: p.pageNumbers,
  text: p.text,
  diagramDescription: p.diagramDescription,
  answerKey: p.answerKey,
  rubric: p.rubric.map((l) => ({ points: l.points, text: l.description })),
  gradingNotes: p.gradingNotes,
  dependsOn: p.dependsOn,
});

const stripFence = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

/**
 * Decodes the reply and repairs what is safe to repair: blank diagram descriptions become null,
 * and dependency links to labels that don't exist or come later are dropped.
 */
export const parseExtractReply = (text: string): Either.Either<Extraction, string> => {
  const decoded = Schema.decodeUnknownEither(Reply)(stripFence(text));
  if (Either.isLeft(decoded)) return Either.left("Extraction reply was not the expected JSON");
  const reply = decoded.right;
  if (reply.status === "not_math") return Either.right({ _tag: "NotMath", message: reply.message });
  if (reply.status === "unreadable")
    return Either.right({ _tag: "Unreadable", message: reply.message });
  if (reply.problems.length === 0) return Either.left("Extraction found no problems");
  const labels = reply.problems.map((p) => p.label);
  if (new Set(labels).size !== labels.length) return Either.left("Extraction repeated a label");
  const problems = reply.problems.map((p, index) => {
    const earlier = new Set(labels.slice(0, index));
    const description = p.diagramDescription?.trim() ?? "";
    return fromWire({
      ...p,
      diagramDescription: description === "" ? null : description,
      dependsOn: [...new Set(p.dependsOn)].filter((d) => earlier.has(d)),
    });
  });
  return Either.right({ _tag: "Worksheet", problems });
};

export const extractWorksheet = (
  pageImageUrls: ReadonlyArray<string>,
  tag: CallTag,
  choice: ModelChoice = models.extract,
): Effect.Effect<ExtractResult, ModelError, ModelClient> =>
  Effect.gen(function* () {
    const client = yield* ModelClient;
    const content: Array<ContentPart> = pageImageUrls.flatMap(
      (url, i): Array<ContentPart> => [
        { type: "text", text: `Page ${i + 1}:` },
        { type: "image", url },
      ],
    );
    const completion = yield* client.complete({
      model: choice.model,
      messages: [
        { role: "system", content: extractSystemPrompt },
        { role: "user", content },
      ],
      tag,
      temperature: 0,
      maxTokens: choice.maxTokens,
      // One call reads every page and writes every problem: 30–70 s in the evals.
      timeoutMs: 120_000,
      jsonSchema: { name: "worksheet", schema: replyJsonSchema },
      ...(choice.reasoning === undefined ? {} : { reasoning: choice.reasoning }),
    });
    const parsed = parseExtractReply(completion.text);
    if (Either.isLeft(parsed)) {
      return yield* new BadResponse({ message: parsed.left, usage: completion.usage });
    }
    return { extraction: parsed.right, usage: completion.usage, model: completion.model };
  });
