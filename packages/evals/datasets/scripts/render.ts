/**
 * Renders whiteboard PNGs for generated cases into grading/images/, and the phone-layout
 * copies listed in grading/phone/cases.json into grading/phone/.
 *
 *   pnpm --filter @goblins/evals dataset:render                  every case
 *   pnpm --filter @goblins/evals dataset:render ar-1-correct ... only these cases
 *   pnpm --filter @goblins/evals dataset:render --template angle-relationships
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadGradingDataset } from "../src/index.ts";
import { renderCase, renderCasePhone } from "../src/render.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { template: { type: "string" } },
});

const cases = loadGradingDataset(values.template ? [values.template] : undefined).cases.filter(
  (c) =>
    c.slice !== "human" &&
    (positionals.length === 0 || positionals.includes(c.id.replace(/-phone$/, ""))),
);
for (const c of cases) {
  writeFileSync(c.image, c.slice === "phone" ? renderCasePhone(c) : renderCase(c));
}
console.log(`rendered ${cases.length} whiteboards`);
