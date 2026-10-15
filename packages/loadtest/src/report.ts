/**
 * Writes a run's report as JSON (everything) and Markdown (what a reader needs to make the
 * ship / no-ship call). Rewritten after every step, so an interrupted run still leaves a report.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StepMetrics } from "./analyze.ts";
import type { Criterion, Verdict } from "./criteria.ts";
import type { Distribution } from "./stats.ts";

export interface RunHeader {
  readonly runId: string;
  readonly startedAt: string;
  readonly target: string;
  readonly commit: string;
  readonly scenario: string;
  readonly mock: string;
  readonly mockSpecExample: string;
  readonly queue: string;
  readonly template: string;
  readonly submissionsPerStudent: number;
  readonly timeScale: number;
  readonly generator: string;
}

export interface StepReport {
  readonly step: number;
  readonly runId: string;
  readonly classes: number;
  readonly students: number;
  readonly metrics: StepMetrics;
  readonly criteria: ReadonlyArray<Criterion>;
  readonly verdict: Verdict;
  /** Per failed criterion, the component that most likely failed first. */
  readonly attribution: Partial<Record<Criterion["id"], string>>;
  readonly cleanup: Record<string, number> | string;
}

export interface Summary {
  /** Highest student count where every criterion held. Null when no step passed. */
  readonly capacityStudents: number | null;
  readonly firstFailures: ReadonlyArray<{
    readonly criterion: string;
    readonly step: number;
    readonly students: number;
    readonly component: string;
  }>;
  readonly stoppedBecause: string;
}

export const summarize = (steps: ReadonlyArray<StepReport>, stoppedBecause: string): Summary => {
  let capacityStudents: number | null = null;
  for (const step of steps) {
    if (step.verdict._tag !== "Pass") break;
    capacityStudents = step.students;
  }
  const firstFailures: Array<Summary["firstFailures"][number]> = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const criterion of step.criteria) {
      if (criterion.pass || seen.has(criterion.id)) continue;
      seen.add(criterion.id);
      firstFailures.push({
        criterion: criterion.label,
        step: step.step,
        students: step.students,
        component: step.attribution[criterion.id] ?? "unknown",
      });
    }
  }
  return { capacityStudents, firstFailures, stoppedBecause };
};

const s = (ms: number | null) =>
  ms === null ? "–" : Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "never";
const dist = (d: Distribution) =>
  `${s(d.p50)} / ${s(d.p95)} / ${s(d.p99)} / ${s(d.max)} (n=${d.count})`;
const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(1)}%`);
const verdictText = (v: Verdict) =>
  v._tag === "Pass" ? "PASS" : v._tag === "Fail" ? "FAIL" : "INVALID (load generator limited)";
const records = (r: Record<string, number>) => {
  const entries = Object.entries(r).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? "none" : entries.map(([k, n]) => `${k}: ${n}`).join("; ");
};

export const toMarkdown = (
  header: RunHeader,
  steps: ReadonlyArray<StepReport>,
  summary: Summary,
): string => {
  const lines: Array<string> = [];
  lines.push(`# Load test ${header.runId}`, "");
  lines.push(
    `| | |`,
    `|---|---|`,
    `| Target | ${header.target} |`,
    `| Started | ${header.startedAt} |`,
    `| Commit | \`${header.commit}\` |`,
    `| Scenario | ${header.scenario} |`,
    `| Mock model | ${header.mock} |`,
    `| Mock spec | \`${header.mockSpecExample}\` |`,
    `| Queue | ${header.queue} |`,
    `| Assignment | ${header.template}, ${header.submissionsPerStudent} submissions per student |`,
    `| Time scale | ${header.timeScale}${header.timeScale === 1 ? " (real testing-day pace)" : ` (each student's 20–40 min working window × ${header.timeScale}; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ ${(1 / header.timeScale).toFixed(1)}× a real testing day with the same head count)`} |`,
    `| Load generator | ${header.generator} |`,
    "",
  );

  lines.push("## Result", "");
  lines.push(
    summary.capacityStudents === null
      ? "No step met every criterion."
      : `Every criterion held up to **${summary.capacityStudents.toLocaleString("en-US")} students**.`,
    "",
    `Stopped because: ${summary.stoppedBecause}.`,
    "",
  );
  if (summary.firstFailures.length > 0) {
    lines.push("| Criterion | First failed at | Component that failed first |", "|---|---|---|");
    for (const f of summary.firstFailures) {
      lines.push(`| ${f.criterion} | step ${f.step} (${f.students} students) | ${f.component} |`);
    }
    lines.push(
      "",
      "The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.",
      "",
    );
  }

  lines.push("## Steps", "");
  const criteriaHeader = steps[0]?.criteria.map((c) => `${c.label} (${c.bar})`) ?? [];
  lines.push(
    `| Step | Students | Peak submits/s | ${criteriaHeader.join(" | ")} | Verdict |`,
    `|---|---|---|${criteriaHeader.map(() => "---").join("|")}|---|`,
  );
  for (const step of steps) {
    const cells = step.criteria.map((c) => `${c.pass ? "✅" : "❌"} ${c.measured}`);
    lines.push(
      `| ${step.step} | ${step.students} | ${step.metrics.load.peakSubmitsPerSecond.toFixed(1)} | ${cells.join(" | ")} | ${verdictText(step.verdict)} |`,
    );
  }
  lines.push("");

  for (const step of steps) {
    const m = step.metrics;
    lines.push(`### Step ${step.step}: ${step.classes} classes, ${step.students} students`, "");
    lines.push(
      `Run id \`${step.runId}\`, ${m.window.minutes.toFixed(1)} minutes. ${verdictText(step.verdict)}.`,
      "",
      "| Metric | Value |",
      "|---|---|",
      `| Students joined / planned | ${m.load.studentsJoined} / ${m.load.plannedStudents} |`,
      `| Submissions acknowledged / planned | ${m.load.submissionsAcked} / ${m.load.plannedSubmissions} |`,
      `| Submit rate, mean / peak (10 s) | ${m.load.meanSubmitsPerSecond.toFixed(1)} / ${m.load.peakSubmitsPerSecond.toFixed(1)} per s |`,
      `| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | ${dist(m.submitAckMs)} |`,
      `| Submit, single successful request | ${dist(m.submitRequestMs)} |`,
      `| Submit retries | ${m.submitRetries} |`,
      `| Submit to grade on dashboard | ${dist(m.submitToDashboardMs)} |`,
      ...(m.breakdown === null
        ? ["| Breakdown | no server timings |"]
        : [
            `| … waiting in queue | ${dist(m.breakdown.queueWaitMs)} |`,
            `| … grading (model calls, retries, write) | ${dist(m.breakdown.gradingMs)} |`,
            `| … outcome to dashboard (sync; crosses clocks) | ${dist(m.breakdown.syncLagMs)} |`,
            `| Grades needing more than one attempt | ${m.breakdown.attemptsOverOne} |`,
          ]),
      `| Peak queued / in flight | ${m.pipeline.peakQueued} / ${m.pipeline.peakInFlight} |`,
      `| Grades: graded / needs teacher / couldn't grade | ${m.grades.byState.graded} / ${m.grades.byState.needs_teacher} / ${m.grades.byState.couldnt_grade} |`,
      `| Failure reasons | ${records(m.grades.failureReasons)} |`,
      `| Grades in a state the fixture does not predict | ${m.grades.unexpectedStates} |`,
      `| Lost submissions | ${m.lost.count}${m.lost.count > 0 ? ` (${records(m.lost.byKind)})` : ""} |`,
      `| Grades seen during the 1.5 s transition | ${pct(m.transitionShare)} |`,
      `| Resumed by name on a new device (failed) | ${m.correctness.resumes} (${m.correctness.resumeFailures}) |`,
      `| Classes whose dashboard student count was wrong | ${m.correctness.dashboardStudentMismatches} |`,
      `| Request errors | ${records(m.errors.requests)} |`,
      `| Class setup failures | ${records(m.errors.classFailures)} |`,
      `| Student join failures | ${records(m.errors.studentFailures)} |`,
      `| Sync: shape requests (live), per s | ${m.sync.requests} (${m.sync.liveRequests}), ${m.sync.requestsPerSecond.toFixed(1)} per s |`,
      `| Sync: requests by view | ${records(m.sync.byView)} |`,
      `| Sync: catch-up request latency | ${dist(m.sync.catchUpMs)} |`,
      `| Sync errors | ${m.errors.shapeErrors} |`,
      m.database.samples === 0
        ? "| Database | no samples |"
        : `| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | ${m.database.peakConnections} / ${m.database.maxConnections}, ${m.database.peakActive}, ${m.database.peakWaitingOnLock}, ${m.database.peakCommitsPerSecond ?? "–"}, ${m.database.deadlocks ?? "–"} |`,
      `| Load generator: peak event-loop delay p99, CPU, open requests, heap | ${m.generator.peakEventLoopDelayP99Ms} ms, ${m.generator.peakCpuPercent}%, ${m.generator.peakOpenRequests}, ${m.generator.peakHeapMb} MB |`,
      `| Data deleted after the step | ${typeof step.cleanup === "string" ? step.cleanup : records(step.cleanup)} |`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
};

export const writeReport = (
  dir: string,
  header: RunHeader,
  steps: ReadonlyArray<StepReport>,
  summary: Summary,
) => {
  writeFileSync(
    join(dir, "report.json"),
    `${JSON.stringify({ header, summary, steps }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "report.md"), toMarkdown(header, steps, summary));
};
