/**
 * The grading eval dataset: student whiteboards for every item of the four templates, each with
 * the correct points per line of a fixed reference rubric. See ../README.md.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Template, templates } from "@goblins/templates";
import { Schema } from "effect";
import { parse, plain } from "./markup.ts";
import { Case, type Element, Rubric, type Slice } from "./schema.ts";

export * from "./schema.ts";

export const gradingDir = new URL("../grading/", import.meta.url);

export interface GradingCase extends Case {
  readonly templateId: Template["id"];
  readonly slice: Slice;
  /** The whiteboard PNG. */
  readonly image: URL;
  readonly rubric: Rubric;
  readonly maxPoints: number;
  readonly expectedPoints: number;
  /** The handwriting as plain text, with crossed-out work marked. Not given to the grader. */
  readonly transcript: string;
}

export interface GradingDataset {
  readonly rubrics: ReadonlyArray<{ readonly templateId: string; readonly rubric: Rubric }>;
  readonly cases: ReadonlyArray<GradingCase>;
}

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));

export const transcript = (board: ReadonlyArray<Element>): string =>
  board
    .flatMap((el) => {
      switch (el._tag) {
        case "Text":
          return [plain(parse(el.text))];
        case "Graph":
          return [
            `[graph: ${el.x.label ?? "x"} ${el.x.min}–${el.x.max}, ${el.y.label ?? "y"} ${el.y.min}–${el.y.max}${(el.points ?? []).map((p) => `; point (${p.at.join(", ")})${p.label ? ` labeled ${p.label}` : ""}`).join("")}${(el.lines ?? []).map((l) => `; line through ${l.map((p) => `(${p.join(", ")})`).join(" ")}`).join("")}]`,
          ];
        case "Scribble":
          return ["[scribbled out]"];
        case "Erased":
          return [];
        default:
          return [];
      }
    })
    .join("\n");

/**
 * Reads and decodes every rubric and case, plus the phone-layout copies. The files are checked in and
 * covered by this package's tests, so a decode failure is a bug in the data, not a runtime case.
 */
export const loadGradingDataset = (only?: ReadonlyArray<string>): GradingDataset => {
  const rubrics: Array<{ templateId: string; rubric: Rubric }> = [];
  const cases: Array<GradingCase> = [];
  for (const template of templates) {
    if (only && !only.includes(template.id)) continue;
    const rubricUrl = new URL(`rubrics/${template.id}.json`, gradingDir);
    const casesUrl = new URL(`cases/${template.id}.json`, gradingDir);
    const its = Schema.decodeUnknownSync(Schema.Array(Rubric))(readJson(rubricUrl));
    for (const rubric of its) rubrics.push({ templateId: template.id, rubric });
    if (!existsSync(casesUrl)) continue;
    for (const c of Schema.decodeUnknownSync(Schema.Array(Case))(readJson(casesUrl))) {
      const rubric = its.find((r) => r.itemId === c.itemId);
      if (!rubric) throw new Error(`${c.id}: no rubric for item ${c.itemId}`);
      cases.push({
        ...c,
        templateId: template.id,
        slice: "generated",
        image: new URL(`images/${c.id}.png`, gradingDir),
        rubric,
        maxPoints: rubric.lines.reduce((sum, l) => sum + l.points, 0),
        expectedPoints: c.expected.lines.reduce((sum, l) => sum + l.points, 0),
        transcript: transcript(c.board),
      });
    }
  }
  const phoneUrl = new URL("phone/cases.json", gradingDir);
  for (const caseId of Schema.decodeUnknownSync(Schema.Array(Schema.String))(readJson(phoneUrl))) {
    const source = cases.find((c) => c.id === caseId && c.slice === "generated");
    // Skipped when the source case's template was filtered out by `only`.
    if (!source) continue;
    cases.push({
      ...source,
      id: `${source.id}-phone`,
      slice: "phone",
      image: new URL(`phone/${source.id}.png`, gradingDir),
    });
  }
  return { rubrics, cases };
};

/** Cross-file checks the schema cannot express. Returns one message per problem found. */
export const checkDataset = (dataset: GradingDataset): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const ids = new Set<string>();
  const byId = new Map(dataset.cases.map((c) => [c.id, c]));
  for (const c of dataset.cases) {
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    const lineIds = c.rubric.lines.map((l) => l.id);
    const got = c.expected.lines.map((l) => l.id);
    if (got.join() !== lineIds.join()) {
      problems.push(`${c.id}: expected lines ${got.join()} but the rubric has ${lineIds.join()}`);
    }
    for (const l of c.expected.lines) {
      const max = c.rubric.lines.find((r) => r.id === l.id)?.points ?? 0;
      if (l.points > max) problems.push(`${c.id}: ${l.id} has ${l.points} points, max ${max}`);
    }
    const template = templates.find((t) => t.id === c.templateId);
    const dependsOn = template ? itemDependsOn(template, c.itemId) : undefined;
    if (dependsOn === undefined) {
      problems.push(`${c.id}: item ${c.itemId} is not in ${c.templateId}`);
      continue;
    }
    const earlierItems = c.earlier.map((e) => e.itemId);
    if ([...earlierItems].sort().join() !== [...dependsOn].sort().join()) {
      problems.push(
        `${c.id}: earlier work for ${earlierItems.join() || "nothing"}, but the item depends on ${dependsOn.join() || "nothing"}`,
      );
    }
    for (const e of c.earlier) {
      const ref = byId.get(e.caseId);
      if (!ref) problems.push(`${c.id}: earlier case ${e.caseId} does not exist`);
      else if (ref.itemId !== e.itemId || ref.templateId !== c.templateId) {
        problems.push(
          `${c.id}: earlier case ${e.caseId} is for ${ref.templateId} ${ref.itemId}, not ${e.itemId}`,
        );
      }
    }
    if (c.tags.includes("follow-through") && c.earlier.length === 0) {
      problems.push(`${c.id}: tagged follow-through but has no earlier work`);
    }
    if (!existsSync(c.image)) problems.push(`${c.id}: missing image ${fileURLToPath(c.image)}`);
  }
  return problems;
};

/** The items an item depends on, or undefined when the template has no such item. */
export const itemDependsOn = (
  template: Template,
  itemId: string,
): ReadonlyArray<string> | undefined => {
  for (const p of template.problems) {
    if (p._tag === "Whole" && String(p.number) === itemId) return p.dependsOn;
    if (p._tag === "WithParts") {
      const part = p.parts.find((x) => `${p.number}${x.label}` === itemId);
      if (part) return part.dependsOn;
    }
  }
  return undefined;
};

/** Every gradable item of a template, in worksheet order. */
export const templateItems = (template: Template): ReadonlyArray<string> =>
  template.problems.flatMap((p) =>
    p._tag === "Whole" ? [String(p.number)] : p.parts.map((x) => `${p.number}${x.label}`),
  );

export const listCaseFiles = (): ReadonlyArray<string> =>
  readdirSync(new URL("cases/", gradingDir)).filter((f) => f.endsWith(".json"));

/** The reference rubrics for one template, in worksheet order. */
export const rubrics = (templateId: string): ReadonlyArray<Rubric> =>
  loadGradingDataset([templateId]).rubrics.map((r) => r.rubric);

/** Every case for one template, including its phone-layout copies. */
export const cases = (templateId: string): ReadonlyArray<GradingCase> =>
  loadGradingDataset([templateId]).cases;

/** Absolute path of a case's image: the landscape PNG, or the phone copy for a `-phone` id. */
export const imagePath = (caseId: string): string =>
  fileURLToPath(
    caseId.endsWith("-phone")
      ? new URL(`phone/${caseId.slice(0, -"-phone".length)}.png`, gradingDir)
      : new URL(`images/${caseId}.png`, gradingDir),
  );
