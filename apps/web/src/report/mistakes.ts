/**
 * Common mistakes on a weak problem, grouped from the graders' one-line reasons.
 *
 * The server asks a model once per weak problem to group the reasons into a few mistakes in a
 * teacher's words, and caches the answer. When that call fails, or before it returns, the
 * report groups students by which rubric lines they lost points on, which needs no model.
 */
import { Schema } from "effect";
import type { Miss, ProblemStats, ReportStudent, RubricLine } from "./model";

/** Students who made the same mistake. */
export interface MistakeGroup {
  /** One plain sentence: "Distributed the minus sign to the 5 but not the 9y." */
  readonly description: string;
  readonly studentIds: ReadonlyArray<string>;
}

/** What the report shows under one weak problem. */
export interface ProblemMistakes {
  readonly problemId: string;
  /** The skill the problem practices, in a few words, for the Goblins practice assignment. */
  readonly skill: string;
  readonly groups: ReadonlyArray<MistakeGroup>;
  /** `model` when a model grouped the reasons; `rubric` for the fallback by rubric line. */
  readonly source: "model" | "rubric";
}

/** The model's answer, validated before use. */
export const ModelGrouping = Schema.Struct({
  skill: Schema.NonEmptyTrimmedString,
  groups: Schema.Array(
    Schema.Struct({
      description: Schema.NonEmptyTrimmedString,
      studentIds: Schema.NonEmptyArray(Schema.String),
    }),
  ),
});
export type ModelGrouping = typeof ModelGrouping.Type;

const quote = (line: RubricLine) => `“${line.description}”`;

/** The fallback: students who lost points on the same rubric lines made the same kind of mistake. */
export function groupByRubricLine(stats: ProblemStats): ProblemMistakes {
  const groups = new Map<string, { lines: ReadonlyArray<RubricLine>; students: Array<string> }>();
  for (const miss of stats.misses) {
    const key = miss.lostLines.map((l) => l.id).join(",");
    const group = groups.get(key) ?? { lines: miss.lostLines, students: [] };
    group.students.push(miss.student.id);
    groups.set(key, group);
  }
  return {
    problemId: stats.problem.id,
    skill: `Problem ${stats.problem.label}`,
    source: "rubric",
    groups: [...groups.values()]
      .sort((a, b) => b.students.length - a.students.length)
      .map(({ lines, students }) => ({
        description:
          lines.length === 0
            ? "Lost points (see each grade for the reason)"
            : `Lost points on ${lines.map(quote).join(" and ")}`,
        studentIds: students,
      })),
  };
}

/**
 * Keeps only groups and students the model could have meant: ids it invented are dropped, a
 * student is listed once, and anyone it left out lands in the fallback groups.
 */
export function fromModel(stats: ProblemStats, grouping: ModelGrouping): ProblemMistakes {
  const missed = new Set(stats.misses.map((m) => m.student.id));
  const seen = new Set<string>();
  const groups: Array<MistakeGroup> = [];
  for (const group of grouping.groups) {
    const studentIds = group.studentIds.filter((id) => missed.has(id) && !seen.has(id));
    for (const id of studentIds) seen.add(id);
    if (studentIds.length > 0) groups.push({ description: group.description, studentIds });
  }
  const leftOut = stats.misses.filter((m) => !seen.has(m.student.id));
  const rest = groupByRubricLine({ ...stats, misses: leftOut }).groups;
  return {
    problemId: stats.problem.id,
    skill: grouping.skill,
    source: "model",
    groups: [...groups.sort((a, b) => b.studentIds.length - a.studentIds.length), ...rest],
  };
}

/** The prompt for one weak problem. Student names never leave the server; ids stand in. */
export function groupingPrompt(stats: ProblemStats): string {
  const lines = stats.misses.map(
    (m: Miss) =>
      `- ${m.student.id}: ${m.points}/${m.maxPoints}. ${m.reason ?? "No reason recorded."}`,
  );
  return [
    "A math teacher is reading a report on a worksheet their class just finished.",
    `Problem ${stats.problem.label}: ${stats.problem.text}`,
    "",
    "Each line below is one student who lost points, with the grader's reason:",
    ...lines,
    "",
    "Group the students by the mistake they made. Use at most 4 groups, largest first.",
    "Describe each mistake in one short, specific sentence a teacher would say to a colleague,",
    "naming the math (for example: “Distributed the minus sign to the 5 but not the 9y.”).",
    "Put each student in exactly one group. Also name the skill the problem practices in at",
    "most six words (for example: “Distributing a negative sign”).",
  ].join("\n");
}

/** A mistake group with its students looked up, for display. */
export interface ShownGroup {
  readonly description: string;
  readonly students: ReadonlyArray<ReportStudent>;
}

/**
 * Matches groups to the students currently in the report. A grade resolved after the grouping
 * was made has no group yet, so it is shown under "Other mistakes" until the next grouping.
 */
export function showGroups(
  stats: ProblemStats,
  mistakes: ProblemMistakes,
): ReadonlyArray<ShownGroup> {
  const missesById = new Map(stats.misses.map((m) => [m.student.id, m.student]));
  const placed = new Set<string>();
  const shown: Array<ShownGroup> = [];
  for (const group of mistakes.groups) {
    const students = group.studentIds.flatMap((id) => {
      const student = missesById.get(id);
      if (student === undefined || placed.has(id)) return [];
      placed.add(id);
      return [student];
    });
    if (students.length > 0) shown.push({ description: group.description, students });
  }
  const others = stats.misses.filter((m) => !placed.has(m.student.id)).map((m) => m.student);
  if (others.length > 0) shown.push({ description: "Other mistakes", students: others });
  return shown;
}
