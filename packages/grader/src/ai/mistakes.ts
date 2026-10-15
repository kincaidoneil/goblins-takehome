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
  /** What the problem practices, in at most six words: "Distributing a negative sign". */
  readonly skill: string;
  /** Most common first. A student appears in at most one group. */
  readonly mistakes: ReadonlyArray<Mistake>;
  readonly usage: Usage;
}

/** The report shows at most this many mistakes per problem. */
export const maxGroups = 5;

export const mistakesSystemPrompt = `A teacher is reading the report for a graded assignment. For one problem, you get the rubric and, for each student who lost points, the grader's one-line reason and the rubric lines they lost. Name the skill the problem practices, and group the students by the mistake they made.

- skill: what the problem practices, at most six words, as a teacher would title it: "Distributing a negative sign", "Supplementary angles". Not "Problem 7".
- Each group's mistake is one plain sentence a teacher would write about the math, under 15 words: "Used 90° instead of 180° for supplementary angles." Not about grading, points or the rubric.
- Put a student in the group whose mistake matches their reason. A student goes in at most one group. Leave out only students whose reason doesn't say what went wrong; any reason that names a missing step or an error belongs in a group.
- Group by what the student did wrong, not by what they got right. Some problems ask students to find someone else's error: a reason like "Fixed 12 · 5 = 60 but still wrote −(5 − 9y) as −5 − 9y" means the student's mistake is the sign, not the multiplication.
- Merge groups that are the same mistake in different words. Order groups by size, largest first. At most five groups.
- Refer to students only by the ids given.`;

const replyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["skill", "groups"],
  properties: {
    skill: { type: "string" },
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
    skill: Schema.String,
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
  return (
    groups
      .map((g) => ({ mistake: g.mistake.trim(), studentIds: g.studentIds }))
      // Drop blank groups before any id is claimed, so they can't take a student from a real group.
      .filter((g) => g.mistake !== "")
      .map((g) => ({
        mistake: g.mistake,
        studentIds: g.studentIds.filter((id) => {
          if (!knownIds.has(id) || seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      }))
      .filter((g) => g.studentIds.length > 0)
      .sort((a, b) => b.studentIds.length - a.studentIds.length)
      .slice(0, maxGroups)
  );
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
    const skill = decoded.right.skill.trim().split(/\s+/).slice(0, 6).join(" ");
    return {
      skill: skill === "" ? `Problem ${input.problem.label}` : skill,
      mistakes: cleanGroups(decoded.right.groups, new Set(input.grades.map((g) => g.studentId))),
      usage: completion.usage,
    };
  });
