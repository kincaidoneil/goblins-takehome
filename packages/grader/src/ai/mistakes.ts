/**
 * Common mistakes for the report: the grader's one-line reasons for one weak problem in, the
 * mistakes students shared out, in plain language, each with the students who made it. Runs when
 * the report opens, once per weak problem.
 */
import { Effect, Either, Schema } from "effect";
import {
  BadResponse,
  type CallTag,
  ModelClient,
  type ModelError,
  type Usage,
} from "../ModelClient.ts";
import { stripFence } from "./json.ts";
import { type ModelChoice, models } from "./models.ts";

export interface MistakeInput {
  readonly problem: {
    readonly label: string;
    readonly text: string;
    readonly rubric: ReadonlyArray<{
      readonly id: string;
      readonly points: number;
      readonly description: string;
    }>;
  };
  /** Grades that lost points. */
  readonly grades: ReadonlyArray<{
    readonly studentId: string;
    readonly points: number;
    readonly maxPoints: number;
    /** The grader's one-line reason. */
    readonly reason: string;
    /** Rubric lines the student lost points on. */
    readonly lostLineIds: ReadonlyArray<string>;
  }>;
}

export interface Mistake {
  /** One plain sentence a teacher would write: "Used 90° instead of 180° for supplementary angles." */
  readonly mistake: string;
  readonly studentIds: ReadonlyArray<string>;
}

export interface MistakesResult {
  /** Most common first. A student appears in at most one group. */
  readonly mistakes: ReadonlyArray<Mistake>;
  readonly usage: Usage;
}

/** The report shows at most this many mistakes per problem. */
export const maxGroups = 5;

export const mistakesSystemPrompt = `A teacher is reading the report for a graded assignment. For one problem, you get the rubric and, for each student who lost points, the grader's one-line reason and the rubric lines they lost. Group the students by the mistake they made.

- Each group's mistake is one plain sentence a teacher would write about the math, under 15 words: "Used 90° instead of 180° for supplementary angles." Not about grading, points or the rubric.
- Put a student in the group whose mistake matches their reason. A student goes in at most one group. Leave out students whose reason doesn't say what went wrong.
- Merge groups that are the same mistake in different words. Order groups by size, largest first. At most five groups.
- Refer to students only by the ids given.`;

const replyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      maxItems: maxGroups,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mistake", "studentIds"],
        properties: {
          mistake: { type: "string" },
          studentIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const Reply = Schema.parseJson(
  Schema.Struct({
    groups: Schema.Array(
      Schema.Struct({ mistake: Schema.String, studentIds: Schema.Array(Schema.String) }),
    ),
  }),
);

/**
 * Keeps only ids that were in the input, each in its first group, and drops groups left empty.
 * A model that invents or repeats an id can't put the wrong name on the report.
 */
export const cleanGroups = (
  groups: ReadonlyArray<Mistake>,
  knownIds: ReadonlySet<string>,
): ReadonlyArray<Mistake> => {
  const seen = new Set<string>();
  return groups
    .map((g) => ({
      mistake: g.mistake.trim(),
      studentIds: g.studentIds.filter((id) => {
        if (!knownIds.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      }),
    }))
    .filter((g) => g.mistake !== "" && g.studentIds.length > 0)
    .sort((a, b) => b.studentIds.length - a.studentIds.length)
    .slice(0, maxGroups);
};

export const groupMistakes = (
  input: MistakeInput,
  tag: CallTag,
  choice: ModelChoice = models.mistakes,
): Effect.Effect<MistakesResult, ModelError, ModelClient> =>
  Effect.gen(function* () {
    const client = yield* ModelClient;
    const lineLabel = new Map(input.problem.rubric.map((l, i) => [l.id, `L${i + 1}`]));
    const text = [
      `Problem ${input.problem.label}: ${input.problem.text}`,
      "Rubric:",
      ...input.problem.rubric.map((l, i) => `- L${i + 1} (${l.points} pt): ${l.description}`),
      "Students who lost points:",
      ...input.grades.map(
        (g) =>
          `- ${g.studentId}: ${g.points}/${g.maxPoints}, lost ${g.lostLineIds.map((id) => lineLabel.get(id) ?? id).join(", ") || "none"}. Grader: ${g.reason}`,
      ),
    ].join("\n");
    const completion = yield* client.complete({
      model: choice.model,
      messages: [
        { role: "system", content: mistakesSystemPrompt },
        { role: "user", content: text },
      ],
      tag,
      temperature: 0,
      maxTokens: choice.maxTokens,
      jsonSchema: { name: "mistakes", schema: replyJsonSchema },
    });
    const decoded = Schema.decodeUnknownEither(Reply)(stripFence(completion.text));
    if (Either.isLeft(decoded)) {
      return yield* new BadResponse({
        message: "Mistakes reply was not the expected JSON",
        usage: completion.usage,
      });
    }
    return {
      mistakes: cleanGroups(decoded.right.groups, new Set(input.grades.map((g) => g.studentId))),
      usage: completion.usage,
    };
  });
