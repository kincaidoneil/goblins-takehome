/**
 * Validates the dataset and prints counts by template, item and tag, plus every Unsure case.
 *
 *   pnpm --filter @goblins/evals dataset:check
 */

import { parseArgs } from "node:util";
import { templates } from "@goblins/templates";
import { checkDataset, loadGradingDataset, templateItems } from "../src/index.ts";

const { values } = parseArgs({ options: { template: { type: "string" } } });
const dataset = loadGradingDataset(values.template ? [values.template] : undefined);
const problems = checkDataset(dataset);
const generated = dataset.cases.filter((c) => c.slice === "generated");

const count = <K extends string>(keys: ReadonlyArray<K>) => {
  const m = new Map<K, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(
  count(dataset.cases.map((c) => c.slice))
    .map(([slice, n]) => `${n} ${slice}`)
    .join(", "),
);
for (const t of templates.filter((t) => !values.template || t.id === values.template)) {
  const items = templateItems(t).map((item) => {
    const n = generated.filter((c) => c.templateId === t.id && c.itemId === item).length;
    return `${item}:${n}`;
  });
  console.log(`  ${t.id}: ${items.join(" ")}`);
}
console.log("by tag:");
for (const [tag, n] of count(generated.flatMap((c) => c.tags))) console.log(`  ${tag}: ${n}`);
console.log("by flag:");
for (const [flag, n] of count(generated.map((c) => c.expected.flag)))
  console.log(`  ${flag}: ${n}`);
const scoreBands = generated.map((c) =>
  c.expectedPoints === c.maxPoints ? "full" : c.expectedPoints === 0 ? "zero" : "partial",
);
console.log("by score:");
for (const [band, n] of count(scoreBands)) console.log(`  ${band}: ${n}`);

const unsure = generated.filter((c) => c.review._tag === "Unsure");
console.log(`\n${unsure.length} Unsure:`);
for (const c of unsure) {
  if (c.review._tag === "Unsure") console.log(`  ${c.id}: ${c.review.note}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problems:\n${problems.join("\n")}`);
  process.exit(1);
}
