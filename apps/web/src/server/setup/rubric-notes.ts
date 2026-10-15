/**
 * Grading notes are rules the grader follows and text the teacher reads, so they must be plain
 * guidance that matches the rubric as it stands.
 */

const splitSentences = (notes: string): ReadonlyArray<string> =>
  notes
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

/**
 * Review asides from building the answer key, removed without touching the rule around them:
 * "(Kincaid confirmed)", "; Kincaid confirmed this", "(the worksheet does not state the link;
 * Kincaid confirmed it)", ", not IM's alt text (128°)".
 */
const REVIEW_ASIDES: ReadonlyArray<RegExp> = [
  /\s*\([^()]*\bKincaid\b[^()]*\)/g,
  /\s*[;,]\s*Kincaid confirmed(?: (?:this|it))?/g,
  /,?\s*not IM's alt text(?:\s*\([^()]*\))?/g,
];

/** A sentence that is only a review remark, with no rule left once the asides are gone. */
const REVIEW_ONLY = /\b(Kincaid|confirmed by|alt text|the dataset|ground truth)\b/i;

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

const ordinal = (n: string) => ORDINALS[Number(n) - 1] ?? `#${n}`;

const tidy = (sentence: string) =>
  sentence
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Turns the eval dataset's reference notes into teacher-facing guidance: removes review asides
 * while keeping the rule they sit in, and names point lines in words ("the second point line")
 * instead of dataset ids ("L2").
 */
export const teacherNotes = (notes: string): string =>
  splitSentences(notes)
    .map((sentence) => tidy(REVIEW_ASIDES.reduce((s, aside) => s.replace(aside, ""), sentence)))
    .filter((sentence) => sentence !== "" && !REVIEW_ONLY.test(sentence))
    .map((sentence) =>
      sentence
        // "L2 and L3" → "the second and third point lines"
        .replace(
          /\bL(\d)\s+and\s+L(\d)\b/g,
          (_, a: string, b: string) => `the ${ordinal(a)} and ${ordinal(b)} point lines`,
        )
        .replace(/\bL(\d)\b/g, (_, n: string) => `the ${ordinal(n)} point line`)
        .replace(/^the /, "The "),
    )
    .join(" ");

/** Sentences that point at a line by its place in the rubric. */
const REFERS_TO_LINE = /\b(point lines?|L\d|lines? \d)\b/i;
/** Sentences that state a total or a count of points. */
const REFERS_TO_TOTAL = /\b(both points|all (?:the )?points|full credit|\d+\s*(?:pts?|points?))\b/i;

interface Line {
  readonly points: number;
  readonly description: string;
}

/**
 * Drops the note sentences a rubric change makes false, and only those. A sentence naming a line
 * by position goes when lines are added, removed or reworded; a sentence about totals ("earns
 * both points") goes when the number of lines or the total changes. Every other rule stays, so a
 * routine edit never relaxes grading.
 */
export const notesAfterRubricChange = (
  notes: string,
  before: ReadonlyArray<Line>,
  after: ReadonlyArray<Line>,
): string => {
  const total = (lines: ReadonlyArray<Line>) => lines.reduce((sum, line) => sum + line.points, 0);
  const countChanged = before.length !== after.length;
  const linesChanged =
    countChanged ||
    before.some((line, i) => line.description.trim() !== after[i]?.description.trim());
  const totalChanged = countChanged || total(before) !== total(after);
  if (!linesChanged && !totalChanged) return notes;
  return splitSentences(notes)
    .filter(
      (sentence) =>
        !(linesChanged && REFERS_TO_LINE.test(sentence)) &&
        !(totalChanged && REFERS_TO_TOTAL.test(sentence)),
    )
    .join(" ");
};
