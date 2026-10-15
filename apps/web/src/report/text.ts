/**
 * Problem text for the report. Worksheets store math as LaTeX between \( and \); the report
 * shows short excerpts, so it rewrites the few constructs worksheets use into plain text
 * instead of loading a math renderer.
 */

const MATH = /\\\((.+?)\\\)/g;

function plainLatex(math: string): string {
  return math
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1/$2")
    .replace(/\\frac(\d)(\d)/g, "$1/$2")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/(\S)([=+])(\S)/g, "$1 $2 $3")
    .replace(/(\w|\))-(\w|\()/g, "$1 − $2")
    .replace(/-/g, "−");
}

/** Lines of the problem with math in plain text. */
export const problemLines = (text: string): ReadonlyArray<string> =>
  text
    .split("\n")
    .map((line) => line.replace(MATH, (_, math: string) => plainLatex(math)).trim())
    .filter((line) => line !== "");

/** The first line, cut to about `max` characters at a word break. */
export function problemExcerpt(text: string, max = 90): string {
  const first = problemLines(text)[0] ?? "";
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
