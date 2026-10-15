/**
 * Lettered parts of one problem (2a, 2b, 2c) are separate problems to the grader, each carrying
 * the shared stem. The review screen shows them as one group with the stem once.
 */
import type { DraftProblem } from "../server/setup/draft";

export interface ProblemGroup {
  /** "2" for parts 2a–2c; the label itself for a lone problem. */
  readonly number: string;
  /** The text every part starts with, shown once above the parts. Null for a lone problem. */
  readonly stem: string | null;
  readonly problems: ReadonlyArray<DraftProblem>;
}

const numberOf = (label: string) => /^(\d+)[a-z]$/i.exec(label)?.[1] ?? null;

/** The leading paragraphs that every text shares. */
const sharedParagraphs = (texts: ReadonlyArray<string>): string => {
  const split = texts.map((text) => text.split("\n\n"));
  const first = split[0] ?? [];
  const shared: Array<string> = [];
  for (const [index, paragraph] of first.entries()) {
    // Keep at least one paragraph of each part's own text.
    if (
      split.some((paragraphs) => paragraphs.length <= index + 1 || paragraphs[index] !== paragraph)
    )
      break;
    shared.push(paragraph);
  }
  return shared.join("\n\n");
};

export const groupProblems = (
  problems: ReadonlyArray<DraftProblem>,
): ReadonlyArray<ProblemGroup> => {
  const groups: Array<{ number: string; problems: Array<DraftProblem> }> = [];
  for (const problem of problems) {
    const number = numberOf(problem.label);
    const last = groups.at(-1);
    if (number !== null && last?.number === number) last.problems.push(problem);
    else groups.push({ number: number ?? problem.label, problems: [problem] });
  }
  return groups.map((group) => {
    const first = group.problems[0];
    const isParts = first !== undefined && numberOf(first.label) !== null;
    const stem = isParts ? sharedParagraphs(group.problems.map((p) => p.text)) : "";
    return { number: group.number, stem: isParts ? stem : null, problems: group.problems };
  });
};

export const totalPoints = (problem: DraftProblem) =>
  problem.rubric.reduce((sum, line) => sum + line.points, 0);

export const pointsLabel = (points: number) => `${points} ${points === 1 ? "pt" : "pts"}`;
