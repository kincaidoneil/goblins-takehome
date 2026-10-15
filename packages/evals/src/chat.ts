/**
 * Chat-editing eval: teacher requests against a fixed starting setup (one model's extraction of
 * each template, saved in fixtures/setup), each checked by code against the edited problems.
 */
import { readFileSync } from "node:fs";
import { type Chat, Extract } from "@goblins/grader";
import { getTemplate } from "@goblins/templates";
import { Option, Schema } from "effect";
import { goldItems, similarity } from "./extraction.ts";

type Problems = ReadonlyArray<Chat.SetupProblem>;

const SetupProblem = Schema.Struct({
  label: Schema.String,
  pages: Schema.Array(Schema.Number),
  text: Schema.String,
  diagramDescription: Schema.NullOr(Schema.String),
  answerKey: Schema.String,
  gradingNotes: Schema.String,
  rubric: Schema.Array(Schema.Struct({ points: Schema.Number, text: Schema.String })),
  dependsOn: Schema.Array(Schema.String),
});

/** The fixtures are extraction replies as the model wrote them, so in the model's field names. */
export const startingSetup = (templateId: string): Problems =>
  Schema.decodeUnknownSync(Schema.Array(SetupProblem))(
    JSON.parse(
      readFileSync(new URL(`../fixtures/setup/${templateId}.json`, import.meta.url), "utf8"),
    ),
  ).map(Extract.fromWire);

export interface ChatCase {
  readonly id: string;
  readonly templateId: string;
  readonly message: string;
  /** Changes the starting setup first, e.g. to remove a problem the teacher then says is missing. */
  readonly prepare?: (problems: Problems) => Problems;
  /** Returns what is wrong with the result; empty when the request was handled. */
  readonly check: (
    before: Problems,
    after: Problems,
    edits: ReadonlyArray<Chat.Edit>,
  ) => ReadonlyArray<string>;
}

const find = (problems: Problems, label: string) => problems.find((p) => p.label === label);
const total = (p: Chat.SetupProblem | undefined) =>
  p?.rubric.reduce((sum, l) => sum + l.points, 0) ?? 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every problem other than `labels` is exactly as it was. */
const othersUnchanged = (before: Problems, after: Problems, labels: ReadonlyArray<string>) =>
  before
    .filter((p) => !labels.includes(p.label))
    .filter((p) => !same(p, find(after, p.label)))
    .map((p) => `changed ${p.label}, which the teacher didn't mention`);

const expect = (ok: boolean, message: string) => (ok ? [] : [message]);

const goldText = (templateId: string, label: string) =>
  Option.match(getTemplate(templateId), {
    onNone: () => "",
    onSome: (t) => goldItems(t).find((i) => i.label === label)?.text ?? "",
  });

const goldAnswer = (templateId: string, label: string) =>
  Option.match(getTemplate(templateId), {
    onNone: () => "",
    onSome: (t) => goldItems(t).find((i) => i.label === label)?.answer ?? "",
  });

export const chatCases: ReadonlyArray<ChatCase> = [
  {
    id: "points-problem",
    templateId: "solving-linear-equations",
    message: "Make problem 3 worth 4 points.",
    check: (before, after) => [
      ...expect(total(find(after, "3")) === 4, `problem 3 is worth ${total(find(after, "3"))}`),
      ...othersUnchanged(before, after, ["3"]),
    ],
  },
  {
    id: "points-per-equation",
    templateId: "solving-linear-equations",
    message: "Problem 2 should be worth 1 point per equation.",
    check: (before, after) => [
      ...expect(total(find(after, "2")) === 3, `problem 2 is worth ${total(find(after, "2"))}`),
      ...othersUnchanged(before, after, ["2"]),
    ],
  },
  {
    id: "points-two-problems",
    templateId: "right-triangle-trigonometry",
    message: "Problems 4 and 5 should each be worth 3 points.",
    check: (before, after) => [
      ...expect(total(find(after, "4")) === 3, `problem 4 is worth ${total(find(after, "4"))}`),
      ...expect(total(find(after, "5")) === 3, `problem 5 is worth ${total(find(after, "5"))}`),
      ...othersUnchanged(before, after, ["4", "5"]),
    ],
  },
  {
    id: "rubric-lines",
    templateId: "solving-linear-equations",
    message:
      "For problem 1, give 1 point for distributing, 1 for getting the x terms on one side, and 1 for the answer.",
    check: (before, after) => {
      const p = find(after, "1");
      return [
        ...expect(
          p !== undefined && p.rubric.length === 3 && p.rubric.every((l) => l.points === 1),
          `problem 1 rubric is ${JSON.stringify(p?.rubric.map((l) => l.points))}`,
        ),
        ...expect(
          /distribut/i.test(p?.rubric[0]?.description ?? ""),
          "first line is not about distributing",
        ),
        ...othersUnchanged(before, after, ["1"]),
      ];
    },
  },
  {
    id: "accept-everywhere",
    templateId: "solving-linear-equations",
    message: "Accept unsimplified fractions.",
    // Only problems whose key answer is a fraction need the note; adding it elsewhere is harmless.
    check: (before, after) => [
      ...after
        .filter((p) => /\d\s*\/\s*\d|\\frac/.test(goldAnswer("solving-linear-equations", p.label)))
        .filter((p) => !/simplif/i.test(p.gradingNotes))
        .map((p) => `${p.label} has a fractional answer but no note`),
      ...before
        .filter((p) => total(p) !== total(find(after, p.label)))
        .map((p) => `changed the points on ${p.label}`),
    ],
  },
  {
    id: "accept-one",
    templateId: "linear-relationships",
    message: "Don't take points off on 2a if they leave out the word cups.",
    check: (before, after) => [
      ...expect(
        /unit|cups/i.test(find(after, "2a")?.gradingNotes ?? ""),
        "2a notes don't mention units",
      ),
      ...expect(total(find(after, "2a")) === total(find(before, "2a")), "changed 2a's points"),
      ...othersUnchanged(before, after, ["2a"]),
    ],
  },
  {
    id: "require-units",
    templateId: "linear-relationships",
    message: "On 3a, students need to include dollar signs or say dollars to get the answer point.",
    // The starting notes say "Dollar signs are optional", so the edit has to reverse that.
    check: (before, after) => [
      ...expect(
        !/optional/i.test(find(after, "3a")?.gradingNotes ?? ""),
        "3a notes still say units are optional",
      ),
      ...expect(
        /(require|must|need)[^.]*(dollar|\$|unit)|(dollar|\$|unit)[^.]*(require|must|need)/i.test(
          `${find(after, "3a")?.gradingNotes} ${find(after, "3a")
            ?.rubric.map((l) => l.description)
            .join(" ")}`,
        ),
        "3a doesn't require units",
      ),
      ...othersUnchanged(before, after, ["3a"]),
    ],
  },
  {
    id: "missed-problem",
    templateId: "solving-linear-equations",
    message: "You missed problem 6.",
    prepare: (problems) => problems.filter((p) => p.label !== "6"),
    check: (before, after) => {
      const index = after.findIndex((p) => p.label === "6");
      const p = after[index];
      const sim = similarity(goldText("solving-linear-equations", "6"), p?.text ?? "");
      return [
        ...expect(p !== undefined, "problem 6 was not added"),
        ...expect(index > 0 && after[index - 1]?.label === "5", "problem 6 is not right after 5"),
        ...expect(sim >= 0.8, `problem 6 text similarity ${sim.toFixed(2)}`),
        ...expect(total(p) > 0, "problem 6 has no rubric"),
        ...othersUnchanged(before, after, ["6"]),
      ];
    },
  },
  {
    id: "link-dependency",
    templateId: "right-triangle-trigonometry",
    message: "Problem 2 uses the answer from 1a.",
    check: (before, after) => {
      const p = find(after, "2");
      return [
        ...expect(
          same(p?.dependsOn, ["1a"]),
          `problem 2 depends on ${JSON.stringify(p?.dependsOn)}`,
        ),
        ...expect(
          /follow|own|their|from 1a/i.test(
            `${p?.rubric.map((l) => l.description).join(" ")} ${p?.gradingNotes}`,
          ),
          "problem 2 rubric gives no follow-through credit",
        ),
        ...othersUnchanged(before, after, ["2"]),
      ];
    },
  },
  {
    id: "fix-answer-key",
    templateId: "linear-relationships",
    message: "The answer key for 7b is wrong. It's 18 months, not 21.",
    prepare: (problems) =>
      problems.map((p) =>
        p.label === "7b"
          ? {
              ...p,
              answerKey: "Set 66 = (8/3)t + 10, so (8/3)t = 56 and t = 21. Answer: 21 months.",
              rubric: p.rubric.map((l) => ({
                ...l,
                description: l.description.replace(/18/g, "21"),
              })),
            }
          : p,
      ),
    check: (before, after) => {
      const p = find(after, "7b");
      const text = `${p?.answerKey} ${p?.rubric.map((l) => l.description).join(" ")}`;
      return [
        ...expect(/18/.test(p?.answerKey ?? ""), "7b answer key doesn't say 18"),
        ...expect(!/\b21\b/.test(text), "7b still says 21"),
        ...othersUnchanged(before, after, ["7b"]),
      ];
    },
  },
  {
    id: "remove-problem",
    templateId: "angle-relationships",
    message: "Delete problem 5, we didn't cover that.",
    check: (before, after) => [
      ...expect(find(after, "5") === undefined, "problem 5 is still there"),
      ...expect(after.length === before.length - 1, `${after.length} problems left`),
    ],
  },
  {
    id: "unclear",
    templateId: "angle-relationships",
    message: "Make it harder.",
    check: (_before, _after, edits) =>
      expect(edits.length === 0, `made ${edits.length} edits instead of asking`),
  },
];
