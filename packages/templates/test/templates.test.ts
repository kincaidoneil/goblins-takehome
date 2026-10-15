import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Problem, type Template, templateFileUrl, templates } from "../src/index.ts";

const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

interface Item {
  readonly id: string;
  readonly dependsOn: ReadonlyArray<string>;
}

/** Every gradable item: a whole problem by its number, a part by number and letter ("3b"). */
const problemItems = (problem: Problem): ReadonlyArray<Item> =>
  problem._tag === "Whole"
    ? [{ id: `${problem.number}`, dependsOn: problem.dependsOn }]
    : problem.parts.map((part) => ({
        id: `${problem.number}${part.label}`,
        dependsOn: part.dependsOn,
      }));

const items = (template: Template): ReadonlyArray<Item> => template.problems.flatMap(problemItems);

describe("templates", () => {
  it("has one entry per folder, with unique ids matching the folder name", () => {
    expect(templates.map((t) => t.id).sort()).toEqual(readdirSync(templatesDir).sort());
  });

  it("covers what the PRD asks for across the set", () => {
    const features = new Set(templates.flatMap((t) => t.features));
    expect([...features].sort()).toEqual([
      "dependent-parts",
      "diagrams",
      "multi-page-problem",
      "skills-practice",
    ]);
    expect(new Set(templates.map((t) => t.band))).toEqual(
      new Set(["middle-school", "high-school"]),
    );
  });

  describe.each(templates)("$id", (template) => {
    it("numbers problems 1..n and letters parts a, b, c", () => {
      expect(template.problems.map((p) => p.number)).toEqual(
        template.problems.map((_, i) => i + 1),
      );
      for (const problem of template.problems) {
        if (problem._tag === "WithParts") {
          expect(problem.parts.map((p) => p.label).join("")).toBe(
            "abcdefgh".slice(0, problem.parts.length),
          );
        }
      }
      expect(template.problems.length).toBeGreaterThanOrEqual(6);
      expect(template.problems.length).toBeLessThanOrEqual(10);
    });

    it("only depends on earlier items", () => {
      const seen = new Set<string>();
      for (const item of items(template)) {
        for (const dependency of item.dependsOn)
          expect(seen, `${item.id} -> ${dependency}`).toContain(dependency);
        seen.add(item.id);
      }
    });

    it("declares its features honestly", () => {
      const has = (f: Template["features"][number]) => template.features.includes(f);
      expect(has("dependent-parts")).toBe(items(template).some((i) => i.dependsOn.length > 0));
      expect(has("multi-page-problem")).toBe(template.problems.some((p) => p.pages.length > 1));
      expect(has("diagrams")).toBe(template.problems.some((p) => p.diagrams.length > 0));
    });

    it("places every problem on pages that exist, in order", () => {
      const pageCount = template.files.pages.length;
      let last = 1;
      for (const problem of template.problems) {
        expect(problem.pages[0]).toBeGreaterThanOrEqual(last);
        problem.pages.forEach((page, i) => {
          expect(page).toBeLessThanOrEqual(pageCount);
          if (i > 0) expect(page).toBe(problem.pages[0] + i);
        });
        last = problem.pages[problem.pages.length - 1] ?? last;
      }
      expect(last).toBe(pageCount);
    });

    it("crops every diagram to a box inside one of its problem's pages", () => {
      for (const problem of template.problems) {
        for (const { crop } of problem.diagrams) {
          expect(crop, `problem ${problem.number}`).toBeDefined();
          if (!crop) continue;
          expect(problem.pages).toContain(crop.page);
          expect(crop.x + crop.w).toBeLessThanOrEqual(1);
          expect(crop.y + crop.h).toBeLessThanOrEqual(1);
        }
      }
    });

    it("takes every problem from one of its listed lessons", () => {
      const lessons = new Set(template.source.lessons.map((l) => l.url));
      for (const problem of template.problems) expect(lessons).toContain(problem.source.url);
    });

    it("ships the PDF and page images it lists", () => {
      expect(existsSync(templateFileUrl(template, "worksheet.pdf"))).toBe(true);
      for (const page of template.files.pages) {
        const header = readFileSync(templateFileUrl(template, page.image)).subarray(16, 24);
        expect({ width: header.readUInt32BE(0), height: header.readUInt32BE(4) }).toEqual({
          width: page.width,
          height: page.height,
        });
      }
      const pngs = readdirSync(
        fileURLToPath(templateFileUrl(template, "worksheet.pdf")).replace(/worksheet\.pdf$/, ""),
      ).filter((f) => f.endsWith(".png"));
      expect(pngs.length).toBe(template.files.pages.length);
    });

    it("lists each item once", () => {
      const ids = items(template).map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
