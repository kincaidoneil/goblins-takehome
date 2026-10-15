/**
 * A realistic class for the sample report at /report/demo and the share page at /share/demo:
 * 28 Grade 8 students on the Solving Linear Equations template (Illustrative Mathematics,
 * CC BY 4.0), with a mix of full credit, partial credit, flags and unfinished work. The
 * grader reasons read like the grader's, and the mistake groups are what the grouping call
 * returns for this class.
 */
import type { ProblemMistakes } from "./mistakes";
import type { GradeState, ReportGrade, ReportInput, ReportProblem } from "./model";

export const DEMO_ASSIGNMENT = {
  title: "Solving Linear Equations",
  course: "Grade 8",
  topic: "Linear equations",
  teacherName: "Ms. Rivera",
  endedAt: "2026-10-15T14:41:00-04:00",
  attribution:
    "Adapted from IM 6–8 Math by Open Up Resources and Illustrative Mathematics, CC BY 4.0.",
} as const;

type LineSpec = readonly [description: string, points: number];

const problem = (n: number, text: string, lines: ReadonlyArray<LineSpec>): ReportProblem => ({
  id: `p${n}`,
  label: String(n),
  text,
  maxPoints: lines.reduce((sum, [, points]) => sum + points, 0),
  rubricLines: lines.map(([description, points], i) => ({
    id: `p${n}-l${i + 1}`,
    description,
    points,
  })),
});

const problems: ReadonlyArray<ReportProblem> = [
  problem(1, "Solve \\(3(x-4)=12x\\)", [
    ["Distributes correctly: 3x − 12 = 12x", 1],
    ["x = −4/3 or equivalent", 1],
  ]),
  problem(
    2,
    "Solve each of these equations. Explain or show your reasoning.\n\\(2(x+5)=3x+1\\)\n\\(3y-4=6-2y\\)\n\\(3(n+2)=9(6-n)\\)",
    [
      ["x = 9", 1],
      ["y = 2", 1],
      ["n = 4", 1],
    ],
  ),
  problem(
    3,
    "Solve each equation, and check your solution.\n\\(\\frac19(2m-16) = \\frac13(2m+4)\\)\n\\(-4(r+2)=4(2-2r)\\)\n\\(12(5+2y)=4y-(6-9y)\\)",
    [
      ["m = −7", 1],
      ["r = 4", 1],
      ["y = −6", 1],
    ],
  ),
  problem(
    4,
    "Solve each of these equations. Explain or show your reasoning.\n\\(2b+8-5b+3=-13+8b-5\\)\n\\(2x+7-5x+8=3(5+6x)-12x\\)\n\\(2c-3=2(6-c)+7c\\)",
    [
      ["b = 29/11", 1],
      ["x = 0", 1],
      ["c = −5", 1],
    ],
  ),
  problem(
    5,
    "Solve each equation and check your solution.\n\\(-3w-4=w+3\\)\n\\(3(3-3x)=2(x+3)-30\\)\n\\(\\frac13(z+4)-6=\\frac23(5-z)\\)",
    [
      ["w = −7/4", 1],
      ["x = 3", 1],
      ["z = 8", 1],
    ],
  ),
  problem(
    6,
    "Andre solved an equation, but when he checked his answer he saw his solution was incorrect. Where is Andre’s mistake and what is the solution to the equation?\n\\(-2(3x-5) = 4(x+3)+8\\)",
    [
      ["Names the step from −6x + 10 = 4x + 20 to 10 = −2x + 20", 1],
      ["x = −1", 1],
    ],
  ),
  problem(
    7,
    "Clare was solving an equation, but when she checked her answer she saw her solution was incorrect. Where is Clare’s mistake and what is the solution to the equation?\n\\(12(5+2y) = 4y-(5-9y)\\)",
    [
      ["Names an error in the second line (12 · 5 or the sign of 9y)", 1],
      ["y = −65/11", 1],
    ],
  ),
  problem(
    8,
    "Elena said the equation \\(9x+15=3x+15\\) has no solutions because \\(9x\\) is greater than \\(3x\\). Do you agree with Elena? Explain your reasoning.",
    [
      ["Disagrees with Elena", 1],
      ["Shows that x = 0 is a solution", 1],
    ],
  ),
];

/** A scripted mistake: which rubric lines it loses, and how the grader worded it. */
interface Mistake {
  readonly problem: number;
  /** 1-based rubric lines that get zero points. */
  readonly lost: ReadonlyArray<number>;
  readonly reasons: ReadonlyArray<string>;
}

const MISTAKES = {
  "1a": {
    problem: 1,
    lost: [2],
    reasons: ["Distributed correctly, then divided 9x = −12 upside down and wrote x = −3/4."],
  },
  "2a": {
    problem: 2,
    lost: [3],
    reasons: ["x and y correct; on the third equation distributed 9 to the 6 only, got n = 12."],
  },
  "3a": {
    problem: 3,
    lost: [1],
    reasons: ["Multiplied only the left side by 9 when clearing fractions, so m is wrong."],
  },
  "4a": {
    problem: 4,
    lost: [1],
    reasons: ["Combined −13 and −5 as −8, so got b = 19/11 instead of 29/11."],
  },
  "4b": {
    problem: 4,
    lost: [2],
    reasons: ["Reached −9x = 0 and wrote “no solution” instead of x = 0."],
  },
  "4c": {
    problem: 4,
    lost: [1, 2],
    reasons: ["Sign errors collecting like terms in the first two equations; c = −5 is right."],
  },
  "5a": {
    problem: 5,
    lost: [3],
    reasons: ["Multiplied the fractions by 3 but not the −6, so got z = 4."],
  },
  "6a": {
    problem: 6,
    lost: [1, 2],
    reasons: [
      "Says the mistake is distributing the −2 in the first line, which is correct; kept x = 5.",
      "Points to the first step as the error (it is right) and does not give a solution.",
      "Re-checks the distribution step only and agrees with x = 5.",
    ],
  },
  "6b": {
    problem: 6,
    lost: [2],
    reasons: [
      "Found the right step, then solved 10 = 10x + 20 as x = 1 instead of −1.",
      "Correct step identified; dropped the negative at the end and wrote x = 1.",
    ],
  },
  "7a": {
    problem: 7,
    lost: [2],
    reasons: [
      "Fixed 12 · 5 = 60 but still wrote −(5 − 9y) as −5 − 9y, so got y = −65/29.",
      "Caught the 72 error; distributed the minus to the 5 only and got −65/29.",
      "Names the 60 vs 72 error. Kept −9y on the right side, answer y = −65/29.",
    ],
  },
  "7b": {
    problem: 7,
    lost: [1, 2],
    reasons: [
      "Re-solved from the start without saying where Clare went wrong; made the same sign error.",
      "No step named. Own solution repeats −5 − 9y and gets y = −65/29.",
      "Copied Clare's lines and stopped; no error or solution given.",
    ],
  },
  "7c": {
    problem: 7,
    lost: [1],
    reasons: [
      "Correct solution y = −65/11 but doesn't say which of Clare's steps is wrong.",
      "Right answer; explanation says only “she did the math wrong”.",
    ],
  },
  "8a": {
    problem: 8,
    lost: [2],
    reasons: ["Disagrees with Elena but doesn't show that x = 0 works."],
  },
} as const satisfies Record<string, Mistake>;

type MistakeKey = keyof typeof MISTAKES;

/**
 * F: full credit. N: not submitted. G: still grading. T: needs the teacher. X: couldn't grade.
 * Anything else is a scripted mistake.
 */
type Code = "F" | "N" | "G" | "T" | "X" | MistakeKey;

const ROWS: ReadonlyArray<readonly [name: string, avatar: number, codes: ReadonlyArray<Code>]> = [
  ["Maya R.", 0, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Jordan T.", 9, ["F", "F", "F", "4a", "F", "6b", "7a", "F"]],
  ["Aiden K.", 18, ["F", "2a", "F", "F", "F", "F", "F", "F"]],
  ["Sofia M.", 27, ["F", "F", "F", "F", "F", "F", "7c", "F"]],
  ["Liam P.", 36, ["1a", "F", "3a", "4c", "5a", "6a", "7b", "8a"]],
  ["Zoe W.", 45, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Ethan C.", 6, ["F", "F", "F", "4a", "F", "6a", "7a", "F"]],
  ["Ava L.", 15, ["F", "F", "F", "F", "F", "F", "T", "F"]],
  ["Noah B.", 24, ["F", "F", "3a", "4b", "F", "6a", "7b", "F"]],
  ["Isabella G.", 33, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Mason H.", 42, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Mia D.", 3, ["F", "F", "F", "F", "5a", "F", "7c", "F"]],
  ["Lucas F.", 12, ["1a", "2a", "F", "4c", "F", "6a", "7a", "F"]],
  ["Harper S.", 21, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Elijah V.", 30, ["F", "F", "F", "4b", "F", "6b", "7a", "F"]],
  ["Amelia J.", 39, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["James O.", 1, ["F", "F", "F", "F", "F", "F", "X", "F"]],
  ["Evelyn N.", 10, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Benjamin Q.", 19, ["F", "F", "3a", "4a", "F", "6a", "7b", "N"]],
  ["Abigail Y.", 28, ["F", "F", "F", "F", "F", "T", "F", "F"]],
  ["Daniel E.", 37, ["F", "F", "F", "4b", "F", "6b", "7a", "F"]],
  ["Emily U.", 46, ["F", "F", "F", "F", "F", "F", "F", "8a"]],
  ["Henry Z.", 7, ["1a", "F", "F", "4a", "5a", "6a", "7b", "F"]],
  ["Camila A.", 16, ["F", "F", "F", "4b", "F", "F", "F", "F"]],
  ["Sebastian I.", 25, ["F", "F", "F", "4c", "F", "6a", "7b", "G"]],
  ["Aria X.", 34, ["F", "F", "F", "F", "F", "F", "F", "F"]],
  ["Mateo R.", 43, ["F", "F", "F", "4a", "F", "6b", "7a", "F"]],
  ["Chloe B.", 4, ["F", "F", "F", "F", "F", "F", "F", "N"]],
];

const studentId = (i: number) => `s${i + 1}`;

function grade(student: number, p: ReportProblem, code: Exclude<Code, "N">): ReportGrade {
  const base = {
    submissionId: `${studentId(student)}-${p.id}`,
    studentId: studentId(student),
    problemId: p.id,
    maxPoints: p.maxPoints,
  };
  const pending = (state: GradeState): ReportGrade => ({
    ...base,
    state,
    points: null,
    graderReason: null,
    linePoints: null,
  });
  switch (code) {
    case "G":
      return pending("grading");
    case "T":
      return pending("needs_teacher");
    case "X":
      return pending("couldnt_grade");
    case "F":
      return {
        ...base,
        state: "graded",
        points: p.maxPoints,
        graderReason: "Correct work and answer.",
        linePoints: p.rubricLines.map((l) => ({ rubricLineId: l.id, points: l.points })),
      };
    default: {
      const mistake: Mistake = MISTAKES[code];
      const linePoints = p.rubricLines.map((l, i) => ({
        rubricLineId: l.id,
        points: mistake.lost.includes(i + 1) ? 0 : l.points,
      }));
      return {
        ...base,
        state: "graded",
        points: linePoints.reduce((sum, l) => sum + l.points, 0),
        graderReason: mistake.reasons[student % mistake.reasons.length] ?? null,
        linePoints,
      };
    }
  }
}

/**
 * `struggled`: the class as it ended, with two weak problems and four grades not final yet.
 * `did-well`: the same class without the mistakes on problems 6 and 7, for the extension CTA.
 */
export type DemoCase = "struggled" | "did-well";

export function demoClass(demoCase: DemoCase): ReportInput {
  const students = ROWS.map(([displayName, avatarId], i) => ({
    id: studentId(i),
    displayName,
    avatarId,
  }));
  const grades = ROWS.flatMap(([, , codes], s) =>
    problems.flatMap((p, i) => {
      const code = codes[i] ?? "N";
      if (code === "N") return [];
      const fixed: Exclude<Code, "N"> =
        demoCase === "did-well" && code !== "F" && code.length === 2 && "67".includes(code[0] ?? "")
          ? "F"
          : code;
      return [grade(s, p, fixed)];
    }),
  );
  return { problems, students, grades };
}

const idsWith = (key: MistakeKey) =>
  ROWS.flatMap(([, , codes], i) => (codes.includes(key) ? [studentId(i)] : []));

/** What the grouping call returns for the weak problems in this class. */
export const DEMO_MISTAKES: ReadonlyArray<ProblemMistakes> = [
  {
    problemId: "p7",
    skill: "Distributing a negative sign",
    source: "model",
    groups: [
      {
        description:
          "Fixed 12 · 5 = 60, but still turned −(5 − 9y) into −5 − 9y, so got y = −65/29.",
        studentIds: idsWith("7a"),
      },
      {
        description:
          "Re-solved from scratch without naming Clare’s mistake, and most repeated her sign error.",
        studentIds: idsWith("7b"),
      },
      {
        description: "Got y = −65/11 but didn’t say which of Clare’s steps went wrong.",
        studentIds: idsWith("7c"),
      },
    ],
  },
  {
    problemId: "p6",
    skill: "Finding the error in a worked solution",
    source: "model",
    groups: [
      {
        description:
          "Blamed the first step (distributing the −2), which is correct, and kept Andre’s x = 5.",
        studentIds: idsWith("6a"),
      },
      {
        description: "Found the wrong step, then solved 10 = 10x + 20 as x = 1 instead of −1.",
        studentIds: idsWith("6b"),
      },
    ],
  },
  {
    problemId: "p4",
    skill: "Combining like terms",
    source: "model",
    groups: [
      { description: "Combined −13 and −5 as −8, so got b = 19/11.", studentIds: idsWith("4a") },
      {
        description: "Reached −9x = 0 and called it “no solution” instead of x = 0.",
        studentIds: idsWith("4b"),
      },
      {
        description: "Dropped signs while collecting the b and x terms.",
        studentIds: idsWith("4c"),
      },
    ],
  },
];
