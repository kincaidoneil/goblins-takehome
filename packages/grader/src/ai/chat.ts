/**
 * Chat editing during setup: "make problem 3 worth 4 points", "accept unsimplified fractions",
 * "you missed problem 6". The model turns the teacher's message into structured edits; the app
 * applies them with `applyEdits`, which checks every edit, and shows the teacher the reply.
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
import { type ExtractedProblem, fromWire, rubricGuide, toWire } from "./extract.ts";
import { stripFence } from "./json.ts";
import { type ModelChoice, models } from "./models.ts";

/** A problem as the setup screen holds it. Same shape extraction produces. */
export type SetupProblem = ExtractedProblem;

export type Edit =
  | { readonly _tag: "SetRubric"; readonly label: string; readonly rubric: SetupProblem["rubric"] }
  | { readonly _tag: "SetGradingNotes"; readonly label: string; readonly gradingNotes: string }
  | { readonly _tag: "SetText"; readonly label: string; readonly text: string }
  | { readonly _tag: "SetAnswerKey"; readonly label: string; readonly answerKey: string }
  | {
      readonly _tag: "SetDiagram";
      readonly label: string;
      readonly diagramDescription: string | null;
    }
  | {
      readonly _tag: "SetDependsOn";
      readonly label: string;
      readonly dependsOn: ReadonlyArray<string>;
    }
  /** Inserted after `after`, or first when `after` is null. */
  | { readonly _tag: "AddProblem"; readonly after: string | null; readonly problem: SetupProblem }
  | { readonly _tag: "RemoveProblem"; readonly label: string };

export interface ChatTurn {
  readonly role: "teacher" | "assistant";
  readonly content: string;
}

export interface ChatResult {
  readonly edits: ReadonlyArray<Edit>;
  /** Shown to the teacher: what changed, or a question when the request was unclear. */
  readonly reply: string;
  readonly usage: Usage;
  readonly model: string;
}

export const chatSystemPrompt = `You help a teacher set up an assignment for an auto-grader. You see the worksheet pages and the problems as they stand: each with its label, text, diagram description, answer key, rubric point lines, grading notes, and the earlier problems it depends on. The teacher asks for a change in plain words. Answer with the edits that make exactly that change, and a short reply.

Edits (op, then the fields it uses; set every other field to null):
- set_rubric (label, rubric): replace a problem's point lines. To change what a problem is worth, redistribute points across sensible lines; keep the lines' meaning.
- set_grading_notes (label, gradingNotes): replace a problem's grading notes. To add guidance, keep the existing notes and append. For a request about the whole assignment ("accept unsimplified fractions"), edit every problem it could apply to.
- set_answer_key (label, answerKey). Then reread that problem's rubric lines and grading notes as they stand above: any that state the old answer must be rewritten with set_rubric or set_grading_notes in the same reply.
- set_text (label, text), set_diagram (label, diagramDescription; null removes it), set_depends_on (label, dependsOn: labels of earlier problems).
- add_problem (after, problem): a problem the worksheet has but the list is missing. Read it from the pages and fill in every field as extraction would: full text, diagram description, a solved answer key, a rubric and notes. after is the label it follows, or null to put it first.
- remove_problem (label). If other problems depend on it, also update their dependencies, text and rubric in the same reply.

Keep each problem consistent: when you change an answer key, also rewrite every rubric line and grading note that states the old answer; when a problem gains a dependency, give its rubric follow-through credit. Change nothing the teacher didn't ask about. If the request is unclear or you can't do it, make no edits and ask one short question in reply. Otherwise reply in one or two sentences saying what you changed, in plain words, without labels like "set_rubric".

${rubricGuide}`;

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

const rubricJson = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["points", "text"],
    properties: { points: { type: "integer" }, text: { type: "string" } },
  },
};

const problemJson = {
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
    diagramDescription: nullable({ type: "string" }),
    answerKey: { type: "string" },
    rubric: rubricJson,
    gradingNotes: { type: "string" },
    dependsOn: { type: "array", items: { type: "string" } },
  },
};

const replyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["edits", "reply"],
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "op",
          "label",
          "after",
          "text",
          "answerKey",
          "diagramDescription",
          "gradingNotes",
          "rubric",
          "dependsOn",
          "problem",
        ],
        properties: {
          op: {
            type: "string",
            enum: [
              "set_rubric",
              "set_grading_notes",
              "set_text",
              "set_answer_key",
              "set_diagram",
              "set_depends_on",
              "add_problem",
              "remove_problem",
            ],
          },
          label: nullable({ type: "string" }),
          after: nullable({ type: "string" }),
          text: nullable({ type: "string" }),
          answerKey: nullable({ type: "string" }),
          diagramDescription: nullable({ type: "string" }),
          gradingNotes: nullable({ type: "string" }),
          rubric: nullable(rubricJson),
          dependsOn: nullable({ type: "array", items: { type: "string" } }),
          problem: nullable(problemJson),
        },
      },
    },
    reply: { type: "string" },
  },
};

/** As printed: "4", "3b", "A2", "IV". Short and without spaces, since it names a whiteboard. */
const Label = Schema.String.pipe(Schema.pattern(/^\S{1,12}$/));
const Rubric = Schema.NonEmptyArray(
  Schema.Struct({ points: Schema.Int.pipe(Schema.positive()), text: Schema.NonEmptyString }),
);
const Problem = Schema.Struct({
  label: Label,
  pages: Schema.Array(Schema.Int.pipe(Schema.positive())),
  text: Schema.NonEmptyString,
  diagramDescription: Schema.NullOr(Schema.String),
  answerKey: Schema.String,
  rubric: Rubric,
  gradingNotes: Schema.String,
  dependsOn: Schema.Array(Schema.String),
});

const WireEdit = Schema.Struct({
  op: Schema.Literal(
    "set_rubric",
    "set_grading_notes",
    "set_text",
    "set_answer_key",
    "set_diagram",
    "set_depends_on",
    "add_problem",
    "remove_problem",
  ),
  label: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  answerKey: Schema.NullOr(Schema.String),
  diagramDescription: Schema.NullOr(Schema.String),
  gradingNotes: Schema.NullOr(Schema.String),
  rubric: Schema.NullOr(Rubric),
  dependsOn: Schema.NullOr(Schema.Array(Schema.String)),
  problem: Schema.NullOr(Problem),
});

const Reply = Schema.parseJson(
  Schema.Struct({ edits: Schema.Array(WireEdit), reply: Schema.String }),
);

/** Turns one wire edit into an `Edit`, or says which field it is missing. */
const toEdit = (wire: typeof WireEdit.Type): Either.Either<Edit, string> => {
  const need = <A>(value: A | null, field: string): Either.Either<A, string> =>
    value === null ? Either.left(`${wire.op} without ${field}`) : Either.right(value);
  const label = need(wire.label, "label");
  switch (wire.op) {
    case "set_rubric":
      return Either.all([label, need(wire.rubric, "rubric")]).pipe(
        Either.map(([l, rubric]) => ({
          _tag: "SetRubric" as const,
          label: l,
          rubric: rubric.map((line) => ({ points: line.points, description: line.text })),
        })),
      );
    case "set_grading_notes":
      return Either.all([label, need(wire.gradingNotes, "gradingNotes")]).pipe(
        Either.map(([l, gradingNotes]) => ({
          _tag: "SetGradingNotes" as const,
          label: l,
          gradingNotes,
        })),
      );
    case "set_text":
      return Either.all([label, need(wire.text, "text")]).pipe(
        Either.map(([l, text]) => ({ _tag: "SetText" as const, label: l, text })),
      );
    case "set_answer_key":
      return Either.all([label, need(wire.answerKey, "answerKey")]).pipe(
        Either.map(([l, answerKey]) => ({ _tag: "SetAnswerKey" as const, label: l, answerKey })),
      );
    case "set_diagram":
      return Either.map(label, (l) => ({
        _tag: "SetDiagram" as const,
        label: l,
        diagramDescription: wire.diagramDescription,
      }));
    case "set_depends_on":
      return Either.all([label, need(wire.dependsOn, "dependsOn")]).pipe(
        Either.map(([l, dependsOn]) => ({ _tag: "SetDependsOn" as const, label: l, dependsOn })),
      );
    case "add_problem":
      return Either.map(need(wire.problem, "problem"), (problem) => ({
        _tag: "AddProblem" as const,
        after: wire.after,
        problem: fromWire(problem),
      }));
    case "remove_problem":
      return Either.map(label, (l) => ({ _tag: "RemoveProblem" as const, label: l }));
  }
};

export const parseChatReply = (
  text: string,
): Either.Either<{ readonly edits: ReadonlyArray<Edit>; readonly reply: string }, string> => {
  const decoded = Schema.decodeUnknownEither(Reply)(stripFence(text));
  if (Either.isLeft(decoded)) return Either.left("Chat reply was not the expected JSON");
  return Either.all(decoded.right.edits.map(toEdit)).pipe(
    Either.map((edits) => ({ edits, reply: decoded.right.reply })),
  );
};

/** Why a set of edits can't be applied. The app keeps the problems as they were. */
export type EditProblem =
  | { readonly _tag: "UnknownLabel"; readonly label: string }
  | { readonly _tag: "DuplicateLabel"; readonly label: string }
  | { readonly _tag: "BadDependency"; readonly label: string; readonly dependsOn: string };

const ok = (
  problems: ReadonlyArray<SetupProblem>,
): Either.Either<ReadonlyArray<SetupProblem>, EditProblem> => Either.right(problems);

const update = (
  problems: ReadonlyArray<SetupProblem>,
  label: string,
  change: (p: SetupProblem) => SetupProblem,
): Either.Either<ReadonlyArray<SetupProblem>, EditProblem> =>
  problems.some((p) => p.label === label)
    ? ok(problems.map((p) => (p.label === label ? change(p) : p)))
    : Either.left({ _tag: "UnknownLabel", label });

const applyOne = (
  problems: ReadonlyArray<SetupProblem>,
  edit: Edit,
): Either.Either<ReadonlyArray<SetupProblem>, EditProblem> => {
  switch (edit._tag) {
    case "SetRubric":
      return update(problems, edit.label, (p) => ({ ...p, rubric: edit.rubric }));
    case "SetGradingNotes":
      return update(problems, edit.label, (p) => ({ ...p, gradingNotes: edit.gradingNotes }));
    case "SetText":
      return update(problems, edit.label, (p) => ({ ...p, text: edit.text }));
    case "SetAnswerKey":
      return update(problems, edit.label, (p) => ({ ...p, answerKey: edit.answerKey }));
    case "SetDiagram":
      return update(problems, edit.label, (p) => ({
        ...p,
        diagramDescription: edit.diagramDescription,
      }));
    case "SetDependsOn":
      return update(problems, edit.label, (p) => ({ ...p, dependsOn: edit.dependsOn }));
    // Links to the removed problem stay, so the final check rejects the batch unless it also
    // updates every problem that used it.
    case "RemoveProblem":
      return problems.some((p) => p.label === edit.label)
        ? ok(problems.filter((p) => p.label !== edit.label))
        : Either.left({ _tag: "UnknownLabel", label: edit.label });
    case "AddProblem": {
      if (problems.some((p) => p.label === edit.problem.label)) {
        return Either.left({ _tag: "DuplicateLabel", label: edit.problem.label });
      }
      if (edit.after === null) return ok([edit.problem, ...problems]);
      const index = problems.findIndex((p) => p.label === edit.after);
      if (index === -1) return Either.left({ _tag: "UnknownLabel", label: edit.after });
      return ok([...problems.slice(0, index + 1), edit.problem, ...problems.slice(index + 1)]);
    }
  }
};

/** Applies edits in order. All or nothing: any bad edit leaves the problems unchanged. */
export const applyEdits = (
  problems: ReadonlyArray<SetupProblem>,
  edits: ReadonlyArray<Edit>,
): Either.Either<ReadonlyArray<SetupProblem>, EditProblem> => {
  let current = problems;
  for (const edit of edits) {
    const next = applyOne(current, edit);
    if (Either.isLeft(next)) return next;
    current = next.right;
  }
  // Dependencies must point at problems that come earlier.
  for (const [index, problem] of current.entries()) {
    const earlier = new Set(current.slice(0, index).map((p) => p.label));
    const bad = problem.dependsOn.find((d) => !earlier.has(d));
    if (bad !== undefined)
      return Either.left({ _tag: "BadDependency", label: problem.label, dependsOn: bad });
  }
  return Either.right(current);
};

export const chatEdit = (
  input: {
    readonly problems: ReadonlyArray<SetupProblem>;
    readonly pageImageUrls: ReadonlyArray<string>;
    readonly history: ReadonlyArray<ChatTurn>;
    readonly message: string;
  },
  tag: CallTag,
  choice: ModelChoice = models.chat,
): Effect.Effect<ChatResult, ModelError, ModelClient> =>
  Effect.gen(function* () {
    const client = yield* ModelClient;
    const content: Array<ContentPart> = [
      ...input.pageImageUrls.flatMap(
        (url, i): Array<ContentPart> => [
          { type: "text", text: `Worksheet page ${i + 1}:` },
          { type: "image", url },
        ],
      ),
      {
        type: "text",
        text: `Problems as they stand:\n${JSON.stringify(input.problems.map(toWire), null, 1)}`,
      },
      ...(input.history.length === 0
        ? []
        : [
            {
              type: "text" as const,
              text: `Earlier in this chat:\n${input.history.map((t) => `${t.role}: ${t.content}`).join("\n")}`,
            },
          ]),
      { type: "text", text: `Teacher: ${input.message}` },
    ];
    const completion = yield* client.complete({
      model: choice.model,
      messages: [
        { role: "system", content: chatSystemPrompt },
        { role: "user", content },
      ],
      tag,
      temperature: 0,
      maxTokens: choice.maxTokens,
      jsonSchema: { name: "setup_edits", schema: replyJsonSchema },
      ...(choice.reasoning === undefined ? {} : { reasoning: choice.reasoning }),
    });
    const parsed = parseChatReply(completion.text);
    if (Either.isLeft(parsed))
      return yield* new BadResponse({ message: parsed.left, usage: completion.usage });
    return { ...parsed.right, usage: completion.usage, model: completion.model };
  });
