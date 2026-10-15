/**
 * Grading eval: runs the production grader on every dataset case and compares its points and
 * flag with the dataset's expected ones, which were fixed when each case was written.
 */
import { readFileSync } from "node:fs";
import type { Grade } from "@goblins/grader";
import { type Template, templateFileUrl, templates } from "@goblins/templates";
import { Schema } from "effect";
import type { GradingCase } from "../datasets/src/index.ts";
import { goldItems } from "./extraction.ts";

/** What the grader receives besides the problem, rubric and whiteboard. */
export type Inputs =
  /** Text, diagram description, answer key, grading notes. The default. */
  | "standard"
  /** Also the worksheet page image, for problems with a figure. */
  | "with-page"
  /** No answer key: the grader solves the problem itself. */
  | "no-key";

const dataUrl = (url: URL) => `data:image/png;base64,${readFileSync(url).toString("base64")}`;

const templateOf = (id: string): Template => {
  const t = templates.find((x) => x.id === id);
  if (t === undefined) throw new Error(`Unknown template ${id}`);
  return t;
};

/** The answer key as a teacher-approved assignment holds it: answer, accepted forms, solution. */
export const answerKeyText = (template: Template, itemId: string): string => {
  for (const p of template.problems) {
    const key =
      p._tag === "Whole"
        ? String(p.number) === itemId
          ? p
          : undefined
        : p.parts.find((part) => `${p.number}${part.label}` === itemId);
    if (key === undefined) continue;
    const answer =
      key.answer._tag === "Exact"
        ? `${key.answer.value}${key.answer.accept.length > 0 ? ` (also accept: ${key.answer.accept.join("; ")})` : ""}`
        : `Sample answer: ${key.answer.sample} Must include: ${key.answer.criteria.join("; ")}`;
    return `${answer}. Worked solution: ${key.solution}`;
  }
  throw new Error(`${template.id} has no item ${itemId}`);
};

export const gradeRequest = (
  c: GradingCase,
  byId: ReadonlyMap<string, GradingCase>,
  inputs: Inputs,
): Grade.GradeRequest => {
  const template = templateOf(c.templateId);
  const items = goldItems(template);
  const item = items.find((i) => i.label === c.itemId);
  if (item === undefined) throw new Error(`${c.id}: no item ${c.itemId}`);
  const pages =
    inputs === "with-page" && item.hasDiagram
      ? item.pages.map((n) => {
          const page = template.files.pages[n - 1];
          if (page === undefined) throw new Error(`${template.id} has no page ${n}`);
          return dataUrl(templateFileUrl(template, page.image));
        })
      : [];
  return {
    problem: {
      label: c.itemId,
      text: item.text,
      ...(item.hasDiagram ? { diagramDescription: item.diagramDescription } : {}),
      answerKey:
        inputs === "no-key"
          ? "Not given. Solve the problem yourself first."
          : answerKeyText(template, c.itemId),
      gradingNotes: c.rubric.notes,
      rubric: c.rubric.lines.map((l) => ({ id: l.id, points: l.points, text: l.description })),
    },
    whiteboardUrl: dataUrl(c.image),
    earlierWork: c.earlier.map((e) => {
      const earlier = byId.get(e.caseId);
      const earlierItem = items.find((i) => i.label === e.itemId);
      if (earlier === undefined || earlierItem === undefined)
        throw new Error(`${c.id}: no earlier ${e.caseId}`);
      return {
        label: e.itemId,
        text: earlierItem.text,
        work: { _tag: "Whiteboard" as const, url: dataUrl(earlier.image) },
      };
    }),
    pageImageUrls: pages,
  };
};

/** One case's outcome. `Failed` is a grade that stayed unusable after the pipeline's retries. */
export const CaseOutcome = Schema.Union(
  Schema.TaggedStruct("Graded", {
    caseId: Schema.String,
    points: Schema.Number,
    lines: Schema.Array(Schema.Struct({ id: Schema.String, points: Schema.Number })),
    flagged: Schema.Boolean,
    flagReason: Schema.String,
    read: Schema.String,
    reason: Schema.String,
    costUsd: Schema.Number,
    latencyMs: Schema.NullOr(Schema.Number),
    attempts: Schema.Number,
    promptTokens: Schema.Number,
    completionTokens: Schema.Number,
  }),
  Schema.TaggedStruct("Failed", {
    caseId: Schema.String,
    error: Schema.String,
    costUsd: Schema.Number,
    attempts: Schema.Number,
  }),
);
export type CaseOutcome = typeof CaseOutcome.Type;

export interface Summary {
  readonly cases: number;
  /**
   * Graded cases scored on points. The rest are scored on the flag only (`expected.scoreOn`):
   * their points hinge on a digit nobody can read for sure.
   */
  readonly scored: number;
  /** Total points equal to the expected total. */
  readonly exact: number;
  /** Rubric lines scored as expected, over all lines. */
  readonly lineAgreement: number;
  readonly meanAbsError: number;
  readonly flagged: number;
  /** Not flagged and exactly right: grades the teacher never has to look at, and can trust. */
  readonly autoCorrect: number;
  /** Not flagged and below the expected score: a student loses points nobody checks. */
  readonly autoUnder: number;
  /** Not flagged and above the expected score. */
  readonly autoOver: number;
  /** Of cases that should be flagged, how many were. */
  readonly flagRecall: { readonly should: number; readonly did: number };
  /** Of cases that should not be flagged, how many were anyway. */
  readonly falseFlags: { readonly shouldNot: number; readonly did: number };
  readonly failed: number;
  readonly meanCostUsd: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly meanCompletionTokens: number;
}

const quantile = (values: ReadonlyArray<number>, q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

export const summarize = (
  cases: ReadonlyArray<GradingCase>,
  outcomes: ReadonlyArray<CaseOutcome>,
): Summary => {
  const byId = new Map(outcomes.map((o) => [o.caseId, o]));
  let exact = 0;
  let linesRight = 0;
  let linesTotal = 0;
  let absError = 0;
  let flagged = 0;
  let autoCorrect = 0;
  let autoUnder = 0;
  let autoOver = 0;
  let should = 0;
  let did = 0;
  let shouldNot = 0;
  let falseFlag = 0;
  let failed = 0;
  let scored = 0;
  const costs: Array<number> = [];
  const latencies: Array<number> = [];
  const tokens: Array<number> = [];
  for (const c of cases) {
    const o = byId.get(c.id);
    if (o === undefined) continue;
    costs.push(o.costUsd);
    if (o._tag === "Failed") {
      failed++;
      continue;
    }
    if (o.latencyMs !== null) latencies.push(o.latencyMs);
    tokens.push(o.completionTokens);
    if (o.flagged) flagged++;
    if (c.expected.flag === "ShouldFlag") {
      should++;
      if (o.flagged) did++;
    }
    if (c.expected.flag === "ShouldNotFlag") {
      shouldNot++;
      if (o.flagged) falseFlag++;
    }
    if (c.expected.scoreOn === "flag") continue;
    scored++;
    const right = o.points === c.expectedPoints;
    if (right) exact++;
    absError += Math.abs(o.points - c.expectedPoints);
    for (const line of c.expected.lines) {
      linesTotal++;
      if (o.lines.find((l) => l.id === line.id)?.points === line.points) linesRight++;
    }
    if (o.flagged) continue;
    if (right) autoCorrect++;
    else if (o.points < c.expectedPoints) autoUnder++;
    else autoOver++;
  }
  return {
    cases: cases.filter((c) => byId.has(c.id)).length,
    scored,
    exact,
    lineAgreement: linesTotal === 0 ? 0 : linesRight / linesTotal,
    meanAbsError: scored === 0 ? 0 : absError / scored,
    flagged,
    autoCorrect,
    autoUnder,
    autoOver,
    flagRecall: { should, did },
    falseFlags: { shouldNot, did: falseFlag },
    failed,
    meanCostUsd: costs.length === 0 ? 0 : costs.reduce((a, b) => a + b, 0) / costs.length,
    p50LatencyMs: quantile(latencies, 0.5),
    p95LatencyMs: quantile(latencies, 0.95),
    meanCompletionTokens:
      tokens.length === 0 ? 0 : tokens.reduce((a, b) => a + b, 0) / tokens.length,
  };
};
