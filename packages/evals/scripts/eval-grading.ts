/**
 * Grades every dataset case with each spec and writes results/grading/<spec>.json.
 *
 *   node scripts/eval-grading.ts [--limit N] <spec> [<spec> ...]
 *
 * A spec is `<model>[@<effort>][+with-page|+no-key][/per-line]`:
 * - `@low` etc. sets the reasoning effort; without it the model's default applies.
 * - `+with-page` also sends the worksheet page for problems with a figure; `+no-key` sends no answer key.
 * - `/per-line` makes one call per rubric line instead of one per submission.
 *
 * `--limit N` grades only the first N cases of each template, for a cheap first look.
 * Served from the cache unless MODEL_CLIENT=openrouter; see src/client.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { ModelClient } from "@goblins/grader";
import { Grade } from "@goblins/grader";
import { Effect, Either } from "effect";
import { type GradingCase, loadGradingDataset } from "../datasets/src/index.ts";
import { describeError, EvalClientLive, latencyOf, spentUsd } from "../src/client.ts";
import { type CaseOutcome, gradeRequest, type Inputs, summarize } from "../src/grading.ts";

const Effort = ["none", "minimal", "low", "medium", "high"] as const;
type Effort = (typeof Effort)[number];
const isEffort = (s: string): s is Effort => (Effort as ReadonlyArray<string>).includes(s);

interface Spec {
  readonly name: string;
  readonly model: string;
  readonly effort: Effort | undefined;
  readonly inputs: Inputs;
  readonly perLine: boolean;
}

const parseSpec = (name: string): Spec => {
  const match = /^(.+?)(?:@([a-z]+))?(?:\+(with-page|no-key))?(\/per-line)?$/.exec(name);
  const effort = match?.[2];
  if (match === null || match[1] === undefined || (effort !== undefined && !isEffort(effort))) {
    console.error(`Bad spec ${name}`);
    process.exit(1);
  }
  const inputs = match[3];
  return {
    name,
    model: match[1],
    effort,
    inputs: inputs === "with-page" || inputs === "no-key" ? inputs : "standard",
    perLine: match[4] !== undefined,
  };
};

const args = process.argv.slice(2);
const limitAt = args.indexOf("--limit");
const limit = limitAt === -1 ? Number.POSITIVE_INFINITY : Number(args[limitAt + 1]);
const specs = args
  .filter((_, i) => limitAt === -1 || (i !== limitAt && i !== limitAt + 1))
  .map(parseSpec);
if (specs.length === 0) {
  console.error("Usage: node scripts/eval-grading.ts [--limit N] <spec> [<spec> ...]");
  process.exit(1);
}

const dataset = loadGradingDataset();
const byId = new Map(dataset.cases.map((c) => [c.id, c]));
const perTemplate = new Map<string, number>();
// Every slice is graded unless --limit is set; phone and human copies are reported apart.
const cases = dataset.cases.filter((c) => {
  if (c.slice !== "generated") return !Number.isFinite(limit);
  const n = perTemplate.get(c.templateId) ?? 0;
  perTemplate.set(c.templateId, n + 1);
  return n < limit;
});

/** The pipeline retries an unusable reply up to three tries in all. */
const maxAttempts = 3;

const gradeOnce = (spec: Spec, c: GradingCase, request: Grade.GradeRequest, attempt: number) => {
  const tag = { purpose: "eval" as const, subjectId: `${spec.name}|${c.id}|${attempt}` };
  return Grade.gradeSubmission(request, tag, {
    model: spec.model,
    maxTokens: spec.effort === undefined || spec.effort === "none" ? 3000 : 12000,
    ...(spec.effort === undefined ? {} : { reasoning: { effort: spec.effort } }),
  }).pipe(Effect.map((result) => ({ result, latencyMs: latencyOf(spec.model, tag) ?? null })));
};

/** Grades with retries; returns the result or the last error, with what every try cost. */
const gradeWithRetries = (spec: Spec, c: GradingCase, request: Grade.GradeRequest) =>
  Effect.gen(function* () {
    let spent = 0;
    for (let attempt = 1; ; attempt++) {
      const outcome = yield* Effect.either(gradeOnce(spec, c, request, attempt));
      if (Either.isRight(outcome)) {
        return {
          ok: true as const,
          ...outcome.right,
          attempts: attempt,
          spent: spent + outcome.right.result.usage.costUsd,
        };
      }
      const error = outcome.left;
      if (error._tag === "BadResponse") spent += error.usage?.costUsd ?? 0;
      const retry =
        error._tag === "BadResponse" || error._tag === "RateLimited" || error._tag === "Timeout";
      if (!retry || attempt >= maxAttempts) {
        return { ok: false as const, error: describeError(error), attempts: attempt, spent };
      }
    }
  });

const gradeCase = (spec: Spec, c: GradingCase): Effect.Effect<CaseOutcome, never, ModelClient> =>
  Effect.gen(function* () {
    const request = gradeRequest(c, byId, spec.inputs);
    const parts = spec.perLine
      ? request.problem.rubric.map((line) => ({
          ...request,
          problem: { ...request.problem, rubric: [line] },
        }))
      : [request];
    const results = yield* Effect.forEach(parts, (r) => gradeWithRetries(spec, c, r), {
      concurrency: "unbounded",
    });
    const costUsd = results.reduce((sum, r) => sum + r.spent, 0);
    const attempts = results.reduce((sum, r) => sum + r.attempts, 0);
    const failed = results.find((r) => !r.ok);
    if (failed !== undefined && !failed.ok) {
      return { _tag: "Failed" as const, caseId: c.id, error: failed.error, costUsd, attempts };
    }
    const graded = results.flatMap((r) => (r.ok ? [r] : []));
    const lines = graded.flatMap((r) =>
      r.result.lines.map((l) => ({ id: l.lineId, points: l.points })),
    );
    const flags = graded.flatMap((r) =>
      r.result.verdict._tag === "NeedsTeacher" ? [r.result.verdict.flagReason] : [],
    );
    const latencies = graded.map((r) => r.latencyMs).filter((l): l is number => l !== null);
    return {
      _tag: "Graded" as const,
      caseId: c.id,
      points: lines.reduce((sum, l) => sum + l.points, 0),
      lines,
      flagged: flags.length > 0,
      flagReason: flags.join(" "),
      read: graded[0]?.result.read ?? "",
      reason: graded.map((r) => r.result.reason).join(" "),
      costUsd,
      // Per-line calls run in parallel, so the submission waits for the slowest one.
      latencyMs: latencies.length === 0 ? null : Math.max(...latencies),
      attempts,
      promptTokens: graded.reduce((sum, r) => sum + r.result.usage.promptTokens, 0),
      completionTokens: graded.reduce((sum, r) => sum + r.result.usage.completionTokens, 0),
    };
  });

const repeat = process.env.EVAL_REPEAT;
const fileName = (spec: Spec) =>
  `${spec.name.replace(/[/@+]/g, "_")}${repeat === undefined ? "" : `.repeat-${repeat}`}`;

mkdirSync(new URL("../results/grading/", import.meta.url), { recursive: true });
for (const spec of specs) {
  const outcomes = await Effect.runPromise(
    Effect.forEach(cases, (c) => gradeCase(spec, c), { concurrency: 8 }).pipe(
      Effect.provide(EvalClientLive),
    ),
  );
  const summary = summarize(
    cases.filter((c) => c.slice === "generated"),
    outcomes,
  );
  writeFileSync(
    new URL(`../results/grading/${fileName(spec)}.json`, import.meta.url),
    `${JSON.stringify({ spec: spec.name, limit: Number.isFinite(limit) ? limit : null, summary, outcomes }, null, 1)}\n`,
  );
  const pct = (n: number) => `${((100 * n) / Math.max(1, summary.cases)).toFixed(0)}%`;
  console.log(
    `${spec.name}: n=${summary.cases} exact ${((100 * summary.exact) / Math.max(1, summary.scored)).toFixed(0)}% lines ${(100 * summary.lineAgreement).toFixed(0)}% flagged ${pct(summary.flagged)} auto-right ${((100 * summary.autoCorrect) / Math.max(1, summary.scored)).toFixed(0)}% auto-under ${summary.autoUnder} auto-over ${summary.autoOver} flag-recall ${summary.flagRecall.did}/${summary.flagRecall.should} false-flags ${summary.falseFlags.did}/${summary.falseFlags.shouldNot} failed ${summary.failed} $/grade ${summary.meanCostUsd.toFixed(5)} p50 ${summary.p50LatencyMs}ms p95 ${summary.p95LatencyMs}ms out-tokens ${summary.meanCompletionTokens.toFixed(0)}`,
  );
}
console.log(`Eval spend so far: $${spentUsd().toFixed(4)}`);
