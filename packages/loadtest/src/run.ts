/**
 * Runs a load test: one step per class count, each a full simulated testing window with its own
 * run id, measured, cleaned up and judged before the next. Stops at the first step that fails a
 * criterion or where the load generator itself was the limit.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { cpus, hostname, totalmem } from "node:os";
import { join } from "node:path";
import {
  type Pace,
  plannedDurationMs,
  Recorder,
  recorderLayer,
  runSimulation,
  type Target,
} from "@goblins/simulator";
import { Duration, Effect, Fiber, Schedule } from "effect";
import { analyzeStep } from "./analyze.ts";
import { attribute, evaluate, verdictOf } from "./criteria.ts";
import { conditionsFor, describeMock, mockSpecFor, type ScenarioName } from "./plan.ts";
import { type RunHeader, type StepReport, summarize, writeReport } from "./report.ts";
import { cleanup, type DbSample, fetchDbStats, fetchTimings } from "./server.ts";

export interface RunOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly runId: string;
  readonly scenario: ScenarioName;
  readonly classesPerStep: ReadonlyArray<number>;
  readonly studentsPerClass: number;
  readonly templateId: string;
  readonly submissionsPerStudent: number;
  readonly pace: Pace;
  readonly seed: number;
  readonly drainMs: number;
  readonly submitGiveUpMs: number;
  readonly queue: string;
  readonly outDir: string;
  readonly keepData: boolean;
}

const commit = () => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

export const runLoadTest = (options: RunOptions) =>
  Effect.gen(function* () {
    const dir = join(options.outDir, options.runId);
    mkdirSync(dir, { recursive: true });
    const header: RunHeader = {
      runId: options.runId,
      startedAt: new Date().toISOString(),
      target: options.baseUrl,
      commit: commit(),
      scenario: options.scenario,
      mock: describeMock(options.scenario),
      mockSpecExample: mockSpecFor(options.scenario, {
        startMs: 0,
        timeScale: options.pace.timeScale,
      }).replace("start=0", "start=<step start>"),
      queue: options.queue,
      template: options.templateId,
      submissionsPerStudent: options.submissionsPerStudent,
      timeScale: options.pace.timeScale,
      generator: `one Node ${process.version} process on ${hostname()} (${cpus().length} CPUs, ${Math.round(totalmem() / 2 ** 30)} GB)`,
    };
    const steps: Array<StepReport> = [];
    let stoppedBecause = "every planned step ran";
    let firstTeacher = 0;

    for (const [index, classes] of options.classesPerStep.entries()) {
      const step = index + 1;
      const runId = `${options.runId}-s${step}`;
      const startMs = Date.now();
      const target: Target = {
        baseUrl: options.baseUrl,
        token: options.token,
        runId,
        mockSpec: mockSpecFor(options.scenario, { startMs, timeScale: options.pace.timeScale }),
      };
      const simulation = {
        target,
        classes,
        studentsPerClass: options.studentsPerClass,
        problems: options.submissionsPerStudent,
        templateId: options.templateId,
        pace: options.pace,
        seed: options.seed + step,
        drainMs: options.drainMs,
        submitGiveUpMs: options.submitGiveUpMs,
        firstTeacher,
      };
      firstTeacher += classes;
      const students = classes * options.studentsPerClass;
      yield* Effect.logInfo(
        `step ${step}: ${classes} classes, ${students} students, about ${Math.round(plannedDurationMs(simulation) / 60_000)} min of submissions plus drain`,
      );

      const report = yield* Effect.gen(function* () {
        const recorder = yield* Recorder;
        const db: Array<DbSample> = [];
        const poller = yield* fetchDbStats(target).pipe(
          Effect.tap((sample) => Effect.sync(() => db.push(sample))),
          Effect.ignore,
          Effect.repeat(Schedule.spaced(Duration.seconds(5))),
          Effect.fork,
        );
        const window = yield* runSimulation(simulation);
        yield* Fiber.interrupt(poller);

        const timings = yield* fetchTimings(target).pipe(
          Effect.tapError((error) => Effect.logWarning(`no server timings: ${error}`)),
          Effect.option,
        );
        const deleted = options.keepData
          ? "kept (--keep-data)"
          : yield* cleanup(target).pipe(
              Effect.catchAll((error) => Effect.succeed(`cleanup failed: ${String(error)}`)),
            );

        const metrics = analyzeStep({
          events: recorder.events(),
          timings: timings._tag === "Some" ? timings.value : undefined,
          db,
          plannedStudents: students,
          plannedSubmissions: students * options.submissionsPerStudent,
          startedAt: window.runStartMs,
          endedAt: window.runEndMs,
        });
        const criteria = evaluate(metrics, conditionsFor(options.scenario));
        const verdict = verdictOf(metrics, criteria);
        const attribution: StepReport["attribution"] = {};
        for (const c of criteria) if (!c.pass) attribution[c.id] = attribute(metrics, c.id);
        return {
          step,
          runId,
          classes,
          students,
          metrics,
          criteria,
          verdict,
          attribution,
          cleanup: deleted,
        } satisfies StepReport;
      }).pipe(Effect.provide(recorderLayer({ ndjsonPath: join(dir, `${runId}.ndjson`) })));

      steps.push(report);
      writeReport(dir, header, steps, summarize(steps, "the run is still in progress"));
      yield* Effect.logInfo(
        `step ${step}: ${report.verdict._tag}${report.criteria
          .map((c) => `\n  ${c.pass ? "pass" : "FAIL"} ${c.label}: ${c.measured} (bar ${c.bar})`)
          .join("")}`,
      );
      if (report.verdict._tag === "Fail") {
        stoppedBecause = `step ${step} failed ${report.verdict.failed.join(", ")}`;
        break;
      }
      if (report.verdict._tag === "ClientLimited") {
        stoppedBecause = `step ${step} hit the load generator's own limit; shard the load across machines to go higher`;
        break;
      }
    }

    const summary = summarize(steps, stoppedBecause);
    writeReport(dir, header, steps, summary);
    return { dir, summary };
  });
