/**
 * Whiteboards for the class simulator: for every item of a template, a few generated cases with
 * a spread of scores, so a simulated class looks like a real one on the dashboard. Each comes
 * with its expected points, so the mock model can return the grade a careful teacher would give.
 */
import { type GradingCase, loadGradingDataset } from "./index.ts";

export interface SimulatorWhiteboard {
  readonly caseId: string;
  readonly itemId: string;
  /** 1024 × 768 PNG. */
  readonly image: URL;
  readonly expectedPoints: number;
  readonly maxPoints: number;
  /** Expected points per rubric line, in rubric order. */
  readonly lines: GradingCase["expected"]["lines"];
  readonly flag: GradingCase["expected"]["flag"];
}

const band = (c: GradingCase) =>
  c.expectedPoints === c.maxPoints ? 0 : c.expectedPoints === 0 ? 2 : 1;

/**
 * Up to `perItem` whiteboards for each item of the template, in worksheet order: full credit
 * first, then partial, then zero. Only Checked cases, so the simulator never relies on ground
 * truth still waiting for review, and none whose points hinge on an unreadable digit.
 */
export const simulatorWhiteboards = (
  templateId: string,
  perItem = 3,
): ReadonlyMap<string, ReadonlyArray<SimulatorWhiteboard>> => {
  const cases = loadGradingDataset([templateId]).cases.filter(
    (c) =>
      c.slice === "generated" && c.review._tag === "Checked" && c.expected.scoreOn === "points",
  );
  const byItem = new Map<string, Array<SimulatorWhiteboard>>();
  for (const itemId of [...new Set(cases.map((c) => c.itemId))]) {
    const forItem = cases.filter((c) => c.itemId === itemId);
    // One per score band first, then fill up in id order.
    const picked: Array<GradingCase> = [];
    for (const b of [0, 1, 2]) {
      const first = forItem.find((c) => band(c) === b);
      if (first) picked.push(first);
    }
    for (const c of forItem) if (!picked.includes(c)) picked.push(c);
    byItem.set(
      itemId,
      picked.slice(0, perItem).map((c) => ({
        caseId: c.id,
        itemId: c.itemId,
        image: c.image,
        expectedPoints: c.expectedPoints,
        maxPoints: c.maxPoints,
        lines: c.expected.lines,
        flag: c.expected.flag,
      })),
    );
  }
  return byItem;
};
