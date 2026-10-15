/**
 * Grading notes are rules the grader follows and text the teacher reads, so they must be plain
 * guidance that matches the rubric as it stands.
 */

const splitSentences = (notes: string): ReadonlyArray<string> =>
  notes
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

/** Review remarks from building the answer key: who checked what, and what the source got wrong. */
const REVIEW_REMARK = /\b(Kincaid|confirmed|alt text|the dataset|ground truth)\b|\bIM's\b/i;

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

const lineName = (n: string) => `the ${ORDINALS[Number(n) - 1] ?? `#${n}`} point line`;

/**
 * Turns the eval dataset's reference notes into teacher-facing guidance: drops review remarks,
 * and names point lines in words ("the second point line") instead of dataset ids ("L2").
 */
export const teacherNotes = (notes: string): string =>
  splitSentences(notes)
    .filter((sentence) => !REVIEW_REMARK.test(sentence))
    .map((sentence) =>
      sentence
        // "L2 and L3" → "the second and third point lines"
        .replace(/\bL(\d)\s+and\s+L(\d)\b/g, (_, a: string, b: string) => {
          const first = ORDINALS[Number(a) - 1] ?? `#${a}`;
          const second = ORDINALS[Number(b) - 1] ?? `#${b}`;
          return `the ${first} and ${second} point lines`;
        })
        .replace(/\bL(\d)\b/g, (_, n: string) => lineName(n))
        .replace(/^the /, "The "),
    )
    .join(" ");

/** Sentences that speak about specific points or point lines, which a rubric change can falsify. */
const ABOUT_POINTS =
  /\b(point lines?|both points|all (?:the )?points|\d+\s*(?:pts?|points?)|earns?|L\d|lines? \d)\b/i;

/**
 * Drops the note sentences that speak about specific points or lines. Called when the rubric's
 * points or number of lines change, so a note like "a bare answer earns both points" can't
 * contradict the new rubric. Other guidance ("accept unsimplified fractions") stays.
 */
export const dropPointSentences = (notes: string): string =>
  splitSentences(notes)
    .filter((sentence) => !ABOUT_POINTS.test(sentence))
    .join(" ");

/** Whether a rubric change alters points or the number of lines (not just wording). */
export const changesScoring = (
  before: ReadonlyArray<{ readonly points: number }>,
  after: ReadonlyArray<{ readonly points: number }>,
): boolean =>
  before.length !== after.length || before.some((line, i) => line.points !== after[i]?.points);
