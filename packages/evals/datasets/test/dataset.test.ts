import { templates } from "@goblins/templates";
import { describe, expect, it } from "vitest";
import { checkDataset, itemDependsOn, loadGradingDataset, templateItems } from "../src/index.ts";
import { parse, plain } from "../src/markup.ts";
import { HEIGHT, renderCase, WIDTH } from "../src/render.ts";
import { simulatorWhiteboards } from "../src/simulator.ts";

const dataset = loadGradingDataset();
const generated = dataset.cases.filter((c) => c.slice === "generated");

describe("grading dataset", () => {
  it("passes every cross-file check", () => {
    expect(checkDataset(dataset)).toEqual([]);
  });

  it("has a rubric for every item of every template", () => {
    for (const t of templates) {
      const rubricItems = dataset.rubrics
        .filter((r) => r.templateId === t.id)
        .map((r) => r.rubric.itemId);
      expect(rubricItems).toEqual(templateItems(t));
    }
  });

  it("covers every item with at least three cases, and every dependent item with follow-through", () => {
    for (const t of templates) {
      for (const item of templateItems(t)) {
        const cases = generated.filter((c) => c.templateId === t.id && c.itemId === item);
        expect(cases.length, `${t.id} ${item}`).toBeGreaterThanOrEqual(3);
        if ((itemDependsOn(t, item) ?? []).length > 0) {
          expect(
            cases.some((c) => c.tags.includes("follow-through")),
            `${t.id} ${item}`,
          ).toBe(true);
        }
      }
    }
  });

  it("renders a 1024 × 768 PNG", async () => {
    const first = generated[0];
    if (!first) throw new Error("no cases");
    const png = renderCase(first);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(WIDTH);
    expect(png.readUInt32BE(20)).toBe(HEIGHT);
  });
});

describe("markup", () => {
  it("reads fractions, roots, powers, crossings-out and boxes", () => {
    expect(plain(parse("~~x = 32~~ [[x = \\frac{32}{2}]] √48 ≈ 6.93 x^2 + 4^{2}"))).toBe(
      "[crossed out: x = 32] [boxed: x = 32/2] √48 ≈ 6.93 x^2 + 4^2",
    );
  });
});

describe("simulator whiteboards", () => {
  it("gives every item of a template Checked whiteboards with a spread of scores", () => {
    for (const t of templates) {
      const byItem = simulatorWhiteboards(t.id);
      expect([...byItem.keys()].sort()).toEqual([...templateItems(t)].sort());
      const all = [...byItem.values()].flat();
      expect(all.some((w) => w.expectedPoints === w.maxPoints)).toBe(true);
      expect(all.some((w) => w.expectedPoints === 0)).toBe(true);
    }
  });
});
