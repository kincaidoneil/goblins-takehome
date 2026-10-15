/**
 * The PRD's ship / no-ship criteria, checked at every step. Kincaid confirms them before the first
 * run against a deploy (PRD, "Quality bar").
 */
import type { StepMetrics } from "./analyze.ts";

export type Conditions = "normal" | "provider-outage";

export interface Criterion {
  readonly id: "lost" | "submit-p99" | "dashboard-p95" | "failures";
  readonly label: string;
  readonly bar: string;
  readonly measured: string;
  readonly pass: boolean;
}

const seconds = (ms: number | null) =>
  ms === null ? "n/a" : Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "never";

export const evaluate = (
  metrics: StepMetrics,
  conditions: Conditions,
): ReadonlyArray<Criterion> => {
  const submitP99 = metrics.submitAckMs.p99;
  const dashboardP95 = metrics.submitToDashboardMs.p95;
  const failureBar = conditions === "normal" ? 0.001 : 0;
  return [
    {
      id: "lost",
      label: "Lost submissions",
      bar: "0",
      measured: String(metrics.lost.count),
      pass: metrics.lost.count === 0,
    },
    {
      id: "submit-p99",
      label: "Submit latency p99",
      bar: "< 1 s",
      measured: seconds(submitP99),
      // No submissions at all is not a pass.
      pass: submitP99 !== null && submitP99 < 1000,
    },
    {
      id: "dashboard-p95",
      label: "Submit to grade on dashboard p95",
      bar: "< 30 s",
      measured: seconds(dashboardP95),
      pass: dashboardP95 !== null && dashboardP95 < 30_000,
    },
    {
      id: "failures",
      label: conditions === "normal" ? "Grades that fail" : "Grades that fail, provider down 5 min",
      bar: conditions === "normal" ? "< 0.1%" : "0%",
      measured: `${(metrics.grades.failureRate * 100).toFixed(2)}% (${metrics.grades.byState.couldnt_grade})`,
      pass:
        conditions === "normal"
          ? metrics.grades.failureRate < failureBar
          : metrics.grades.byState.couldnt_grade === 0,
    },
  ];
};

export type Verdict =
  | { readonly _tag: "Pass" }
  | { readonly _tag: "Fail"; readonly failed: ReadonlyArray<Criterion["id"]> }
  /** The load generator was the bottleneck, so the step says nothing about the app. */
  | { readonly _tag: "ClientLimited" };

export const verdictOf = (metrics: StepMetrics, criteria: ReadonlyArray<Criterion>): Verdict => {
  if (metrics.generator.limited) return { _tag: "ClientLimited" };
  const failed = criteria.filter((c) => !c.pass).map((c) => c.id);
  return failed.length === 0 ? { _tag: "Pass" } : { _tag: "Fail", failed };
};

/**
 * Which component most likely failed first, from the evidence in the metrics. A heuristic, and
 * the report says so: it points at where to look, it does not prove a root cause.
 */
export const attribute = (metrics: StepMetrics, failed: Criterion["id"]): string => {
  const submitServerErrors = Object.entries(metrics.errors.requests)
    .filter(([key]) => key.startsWith("submit:"))
    .reduce((sum, [, n]) => sum + n, 0);
  const db = metrics.database;
  const dbSaturated =
    db.peakConnections !== null &&
    db.maxConnections !== null &&
    db.peakConnections >= 0.9 * db.maxConnections;
  switch (failed) {
    case "lost": {
      const kinds = Object.keys(metrics.lost.byKind);
      if (kinds.some((k) => k.startsWith("never attempted"))) {
        const setup =
          Object.keys(metrics.errors.classFailures)[0] ??
          Object.keys(metrics.errors.studentFailures)[0] ??
          "classes or joins failed";
        return `Setup: ${setup}`;
      }
      if (kinds.some((k) => k.startsWith("never acknowledged"))) {
        return dbSaturated
          ? "Database: connections saturated, submits failed"
          : "Submit function: submits failed after the client's retries";
      }
      if (kinds.some((k) => k.includes("server: submitted"))) {
        return "Queue: grades never claimed by a consumer (lost message, sweeper not catching it)";
      }
      if (kinds.some((k) => k.includes("server: grading"))) {
        return "Grading consumer: grades claimed but never finished";
      }
      if (kinds.some((k) => /server: (graded|needs_teacher|couldnt_grade)/.test(k))) {
        return "Sync (Electric): final grades on the server never reached the dashboard";
      }
      return "Unknown: no server timings to tell queue, consumer and sync apart";
    }
    case "submit-p99":
      if (dbSaturated || (db.peakWaitingOnLock ?? 0) > 0)
        return "Database: submit transactions waiting";
      if (submitServerErrors > 0) return "Submit function: errors and retries";
      return "Submit function: slow responses (upload, DB write or cold starts)";
    case "dashboard-p95": {
      const b = metrics.breakdown;
      if (b === null) {
        return metrics.pipeline.peakQueued > metrics.pipeline.peakInFlight
          ? "Queue: grades waiting for a consumer (no server timings to confirm)"
          : "Grading or sync (no server timings to tell them apart)";
      }
      const parts: ReadonlyArray<readonly [string, number]> = [
        ["Queue: grades waiting for a consumer slot (concurrency cap)", b.queueWaitMs.p95 ?? 0],
        ["Grading: model calls and retries", b.gradingMs.p95 ?? 0],
        ["Sync (Electric): outcome to dashboard", b.syncLagMs.p95 ?? 0],
      ];
      return [...parts].sort((a, b2) => b2[1] - a[1])[0]?.[0] ?? "unknown";
    }
    case "failures": {
      const top = Object.entries(metrics.grades.failureReasons).sort((a, b) => b[1] - a[1])[0];
      return `Grading: retries ran out${top === undefined ? "" : ` (most common: ${top[0]})`}`;
    }
  }
};
