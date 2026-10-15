/**
 * Extraction eval: compares what a model pulls out of a worksheet's page images with the
 * template's hand-checked answer key. Every score here is computed from text; no model judges.
 */
import { readFileSync } from "node:fs";
import type { Extract } from "@goblins/grader";
import { type Template, templateFileUrl } from "@goblins/templates";

/** One gradable item as the answer key has it. */
export interface GoldItem {
  readonly label: string;
  readonly pages: ReadonlyArray<number>;
  /** Shared stem plus the part's text, which is what a self-contained extracted item should say. */
  readonly text: string;
  readonly hasDiagram: boolean;
  readonly diagramDescription: string;
  readonly dependsOn: ReadonlyArray<string>;
  /** The key's answer, for checking the model's answer key. */
  readonly answer: string;
}

export const goldItems = (template: Template): ReadonlyArray<GoldItem> =>
  template.problems.flatMap((problem): ReadonlyArray<GoldItem> => {
    const diagramDescription = problem.diagrams.map((d) => d.description).join(" ");
    if (problem._tag === "Whole") {
      return [
        {
          label: String(problem.number),
          pages: problem.pages,
          text: problem.text,
          hasDiagram: problem.diagrams.length > 0,
          diagramDescription,
          dependsOn: problem.dependsOn,
          answer: problem.answer._tag === "Exact" ? problem.answer.value : problem.answer.sample,
        },
      ];
    }
    return problem.parts.map((part) => ({
      label: `${problem.number}${part.label}`,
      pages: problem.pages,
      text: problem.stem.trim() === "" ? part.text : `${problem.stem}\n${part.text}`,
      hasDiagram: problem.diagrams.length > 0,
      diagramDescription,
      dependsOn: part.dependsOn,
      answer: part.answer._tag === "Exact" ? part.answer.value : part.answer.sample,
    }));
  });

export const pageDataUrls = (template: Template): ReadonlyArray<string> =>
  template.files.pages.map(
    (page) =>
      `data:image/png;base64,${readFileSync(templateFileUrl(template, page.image)).toString("base64")}`,
  );

/** Lowercase, LaTeX delimiters and commands stripped, whitespace collapsed. */
export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\\[()[\]]/g, " ")
    .replace(/\\(frac|dfrac|text|mathrm|left|right|cdot|times|circ|degree)/g, " ")
    .replace(/[{}\\$|*_]/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** 1 − (edit distance / longer length), on normalized text. */
export const similarity = (a: string, b: string): number => {
  const x = normalize(a);
  const y = normalize(b);
  if (x.length === 0 && y.length === 0) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = cur;
  }
  return 1 - (prev[y.length] ?? 0) / Math.max(x.length, y.length);
};

/**
 * The numeric values in a string, in any notation a key or a model writes: "1,500" and
 * "1{,}500", "−3", "\\frac{1}{2}", "\\frac12", "1/2", and mixed numbers like "7 1/2" or "7\\frac12".
 */
export const numbers = (text: string): ReadonlyArray<number> => {
  const plain = text
    // A space keeps "7\\frac12" a mixed number; none after a sign keeps "-\\frac43" negative.
    .replace(
      /(\d?)\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g,
      (_, d: string, a: string, b: string) => `${d}${d === "" ? "" : " "}${a}/${b}`,
    )
    .replace(
      /(\d?)\\d?frac(\d)(\d)/g,
      (_, d: string, a: string, b: string) => `${d}${d === "" ? "" : " "}${a}/${b}`,
    )
    .replace(/\{,\}/g, ",")
    .replace(/[−–]/g, "-")
    .replace(/(\d),(\d{3})/g, "$1$2");
  const values: Array<number> = [];
  for (const m of plain.matchAll(/(-?)(?:(\d+)\s+)?(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    const whole = m[2] === undefined ? 0 : Number(m[2]);
    const num = Number(m[3]);
    const value = m[4] === undefined ? num : num / Number(m[4]);
    // "7 1/2" is a mixed number; "2 3" without a fraction is two numbers.
    if (m[2] !== undefined && m[4] === undefined) values.push(sign * whole, num);
    else values.push(sign * (whole + value));
  }
  return values;
};

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a));

/** Share of `gold`'s numbers whose value also appears in `got`. 1 when gold has none. */
export const numberRecall = (gold: string, got: string): number => {
  const want = numbers(gold).filter((v, i, all) => all.findIndex((w) => close(v, w)) === i);
  if (want.length === 0) return 1;
  const have = numbers(got);
  return want.filter((v) => have.some((h) => close(v, h))).length / want.length;
};

export interface ItemScore {
  readonly label: string;
  readonly found: boolean;
  readonly textSimilarity: number;
  /** Share of the key answer's numbers present in the extracted answer key. */
  readonly answerNumberRecall: number;
  readonly rubricLines: number;
  readonly rubricPoints: number;
  /** For a dependent item: the drafted rubric mentions follow-through. */
  readonly followThroughInRubric?: boolean;
}

/**
 * Scored per printed problem, because the key attaches figures and pages to the problem, not to
 * each part: a figure for part b only, or a part that sits on page 2 of a two-page problem, is
 * still right.
 */
export interface ProblemScore {
  readonly number: string;
  /** Every page the key lists is covered by the extracted parts. Absent for one-page problems. */
  readonly crossPageOk?: boolean;
  /** A figure was described if and only if the key has one. */
  readonly diagramOk: boolean;
  /** Share of the key's figure numbers present in the extracted descriptions. */
  readonly diagramNumberRecall?: number;
}

export interface TemplateScore {
  readonly templateId: string;
  readonly goldCount: number;
  readonly extractedCount: number;
  readonly items: ReadonlyArray<ItemScore>;
  readonly problems: ReadonlyArray<ProblemScore>;
  /** Extracted labels the answer key doesn't have. */
  readonly extraLabels: ReadonlyArray<string>;
  readonly dependencies: {
    readonly gold: number;
    readonly found: number;
    readonly correct: number;
  };
}

const edges = (items: ReadonlyArray<{ label: string; dependsOn: ReadonlyArray<string> }>) =>
  new Set(items.flatMap((item) => item.dependsOn.map((d) => `${item.label}->${d}`)));

export const scoreExtraction = (
  template: Template,
  problems: ReadonlyArray<Extract.ExtractedProblem>,
): TemplateScore => {
  const gold = goldItems(template);
  const byLabel = new Map(problems.map((p) => [p.label, p]));
  const items = gold.map((g): ItemScore => {
    const got = byLabel.get(g.label);
    if (got === undefined) {
      return {
        label: g.label,
        found: false,
        textSimilarity: 0,
        answerNumberRecall: 0,
        rubricLines: 0,
        rubricPoints: 0,
      };
    }
    return {
      label: g.label,
      found: true,
      textSimilarity: similarity(g.text, got.text),
      answerNumberRecall: numberRecall(g.answer, got.answerKey),
      rubricLines: got.rubric.length,
      rubricPoints: got.rubric.reduce((sum, l) => sum + l.points, 0),
      ...(g.dependsOn.length > 0
        ? {
            followThroughInRubric:
              /follow|own (answer|value|result)|their (answer|value|result)|from (part )?\d+[a-z]/i.test(
                got.rubric.map((l) => l.description).join(" "),
              ),
          }
        : {}),
    };
  });
  const numberOf = (label: string) => label.replace(/[a-z]$/, "");
  const problemScores = [...new Set(gold.map((g) => numberOf(g.label)))].map(
    (number): ProblemScore => {
      const key = gold.find((g) => numberOf(g.label) === number);
      const parts = problems.filter((p) => numberOf(p.label) === number);
      const pages = new Set(parts.flatMap((p) => p.pageNumbers));
      const descriptions = parts.flatMap((p) =>
        p.diagramDescription === null ? [] : [p.diagramDescription],
      );
      const keyPages = key?.pages ?? [];
      return {
        number,
        ...(keyPages.length > 1 ? { crossPageOk: keyPages.every((p) => pages.has(p)) } : {}),
        diagramOk: (key?.hasDiagram ?? false) === descriptions.length > 0,
        ...(key?.hasDiagram
          ? { diagramNumberRecall: numberRecall(key.diagramDescription, descriptions.join(" ")) }
          : {}),
      };
    },
  );
  const goldEdges = edges(gold);
  const foundEdges = edges(problems);
  return {
    templateId: template.id,
    goldCount: gold.length,
    extractedCount: problems.length,
    items,
    problems: problemScores,
    extraLabels: problems.map((p) => p.label).filter((l) => !gold.some((g) => g.label === l)),
    dependencies: {
      gold: goldEdges.size,
      found: foundEdges.size,
      correct: [...foundEdges].filter((e) => goldEdges.has(e)).length,
    },
  };
};
