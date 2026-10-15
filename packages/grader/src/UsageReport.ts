/**
 * Spend against the PRD's model budget, from two sources: our call log and
 * OpenRouter's own count for the key. The gap between them is spend we did not
 * log, which should be zero.
 */
import { Option } from "effect";
import type { CallPurpose } from "./ModelClient.ts";

export interface BudgetLine {
  readonly name: string;
  readonly budgetUsd: number;
  readonly purposes: ReadonlyArray<CallPurpose>;
}

/** The PRD's budget table. Purposes do not say which environment a call came from, so production extraction counts under extraction. */
export const budget: ReadonlyArray<BudgetLine> = [
  { name: "Evals", budgetUsd: 8, purposes: ["eval"] },
  { name: "Extraction and prompt development", budgetUsd: 4, purposes: ["extract", "rubric-chat"] },
  { name: "Production and demo", budgetUsd: 4, purposes: ["grade"] },
  { name: "Latency calibration", budgetUsd: 2, purposes: ["calibration"] },
  { name: "Reserve", budgetUsd: 2, purposes: [] },
];

export const TOTAL_BUDGET_USD = budget.reduce((sum, line) => sum + line.budgetUsd, 0);

/** Call-log totals per purpose, excluding load-test rows. */
export interface PurposeTotals {
  readonly purpose: CallPurpose;
  readonly calls: number;
  readonly failed: number;
  readonly costUsd: number;
  /** All spend, failed calls included, divided by all calls. */
  readonly costPerCallUsd: number | null;
  /**
   * For `grade`: all spend divided by the number of distinct submissions graded,
   * so retries and failed attempts count toward the grade they were for.
   */
  readonly costPerGradeUsd: number | null;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
}

export interface KeyUsage {
  readonly usageUsd: number;
  readonly limitUsd: number | null;
  readonly remainingUsd: number | null;
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const pct = (part: number, whole: number) =>
  whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
const ms = (n: number | null) => (n === null ? "–" : `${Math.round(n)} ms`);

export const render = (input: {
  readonly generatedAt: Date;
  readonly log: Option.Option<ReadonlyArray<PurposeTotals>>;
  readonly key: Option.Option<KeyUsage>;
  /** Why a source is missing, shown in its place. */
  readonly logError?: string;
  readonly keyError?: string;
}): string => {
  const out: Array<string> = [`# Model spend, ${input.generatedAt.toISOString()}`, ""];

  if (Option.isSome(input.log)) {
    const rows = input.log.value;
    const spentFor = (line: BudgetLine) =>
      rows.filter((r) => line.purposes.includes(r.purpose)).reduce((sum, r) => sum + r.costUsd, 0);
    out.push(
      "| Budget line | Budget | Spent (call log) | Used | Status |",
      "|---|---|---|---|---|",
    );
    for (const line of budget) {
      const spent = spentFor(line);
      const status =
        spent > line.budgetUsd ? "OVER" : spent > 0.8 * line.budgetUsd ? "near limit" : "ok";
      out.push(
        `| ${line.name} | ${usd(line.budgetUsd)} | ${usd(spent)} | ${pct(spent, line.budgetUsd)} | ${status} |`,
      );
    }
    const logTotal = rows.reduce((sum, r) => sum + r.costUsd, 0);
    out.push(
      `| **Total** | ${usd(TOTAL_BUDGET_USD)} | ${usd(logTotal)} | ${pct(logTotal, TOTAL_BUDGET_USD)} | |`,
      "",
    );

    out.push(
      "| Purpose | Calls | Failed | Cost | Cost per call | Cost per grade | p50 latency | p95 latency |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const r of rows) {
      out.push(
        `| ${r.purpose} | ${r.calls} | ${r.failed} (${pct(r.failed, r.calls)}) | ${usd(r.costUsd)} | ${r.costPerCallUsd === null ? "–" : usd(r.costPerCallUsd)} | ${r.costPerGradeUsd === null ? "–" : usd(r.costPerGradeUsd)} | ${ms(r.p50LatencyMs)} | ${ms(r.p95LatencyMs)} |`,
      );
    }
    if (rows.length === 0) out.push("| (no calls logged) | | | | | | | |");
    out.push("");
  } else {
    out.push(`Call log: not available: ${input.logError ?? "unknown reason"}`, "");
  }

  if (Option.isSome(input.key)) {
    const key = input.key.value;
    out.push(
      `OpenRouter key: ${usd(key.usageUsd)} used` +
        (key.limitUsd === null ? ", no limit set" : ` of ${usd(key.limitUsd)} limit`) +
        (key.remainingUsd === null ? "." : `, ${usd(key.remainingUsd)} remaining.`),
    );
    if (key.limitUsd === null || key.limitUsd > TOTAL_BUDGET_USD) {
      out.push(
        `Warning: the key's limit (${key.limitUsd === null ? "none" : usd(key.limitUsd)}) is above the project budget of ${usd(TOTAL_BUDGET_USD)}. Lower it in OpenRouter so a runaway loop stops at the budget.`,
      );
    }
    if (Option.isSome(input.log)) {
      const logTotal = input.log.value.reduce((sum, r) => sum + r.costUsd, 0);
      const gap = key.usageUsd - logTotal;
      // A cent of tolerance for rounding and calls still in flight.
      out.push(
        Math.abs(gap) <= 0.01
          ? "The call log accounts for all of it."
          : gap > 0
            ? `Spend not in this call log: ${usd(gap)}. Calls were made outside the logged pipeline, or logged to another database.`
            : `This call log records ${usd(-gap)} more than OpenRouter reports. It may hold calls made with another key, or OpenRouter's count may lag.`,
      );
    }
  } else {
    out.push(`OpenRouter key: not available: ${input.keyError ?? "unknown reason"}`);
  }
  return out.join("\n");
};
