/**
 * pnpm loadtest [ramp | scenario <name>] [options]
 *
 * See packages/loadtest/README.md. The load-test token comes from LOAD_TEST_TOKEN, never a flag,
 * so it stays out of shell history and process lists.
 */
import { parseArgs } from "node:util";
import {
  DEFAULT_TEMPLATE,
  RUN_ID,
  recorderLayer,
  scaled,
  submissionsPerStudent,
  testingDay,
} from "@goblins/simulator";
import { Cause, Effect, Exit, Fiber, Logger, LogLevel } from "effect";
import { type RampPlan, type ScenarioName, scenarios, stepClasses } from "./plan.ts";
import { runLoadTest } from "./run.ts";
import { cleanup } from "./server.ts";

const usage = `Usage:
  pnpm loadtest ramp [options]              ramp from --start-classes, adding --step-classes per step
  pnpm loadtest scenario <name> [options]   one step at --start-classes under a mock scenario
                                            (${scenarios.join(", ")})
  pnpm loadtest cleanup <run-id>            delete an interrupted run's data (all its steps)

Options:
  --url <origin>            app to test (default: $GOBLINS_URL, else http://localhost:3190)
  --time-scale <x>          compress every interval; 1 = real testing day (default 1)
  --students-per-class <n>  default 30
  --start-classes <n>       classes in the first step (default 33, i.e. 990 students)
  --step-classes <n>        classes added per step (default 17, about 500 students)
  --max-steps <n>           default 6
  --template <id>           default ${DEFAULT_TEMPLATE}
  --drain-minutes <n>       wait for grades after the last submit (default 10)
  --queue <text>            queue and concurrency cap under test, for the report
  --seed <n>                default 1
  --run-id <id>             default lt-<UTC timestamp>
  --out <dir>               default packages/loadtest/reports
  --keep-data               do not delete the run's data afterward
Environment: LOAD_TEST_TOKEN (required), GOBLINS_URL`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    "time-scale": { type: "string", default: "1" },
    "students-per-class": { type: "string", default: "30" },
    "start-classes": { type: "string", default: "33" },
    "step-classes": { type: "string", default: "17" },
    "max-steps": { type: "string", default: "6" },
    template: { type: "string", default: DEFAULT_TEMPLATE },
    "drain-minutes": { type: "string", default: "10" },
    queue: { type: "string", default: "not stated (pass --queue)" },
    seed: { type: "string", default: "1" },
    "run-id": { type: "string" },
    out: { type: "string", default: new URL("../reports", import.meta.url).pathname },
    "keep-data": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const fail = (message: string): never => {
  console.error(`${message}\n\n${usage}`);
  process.exit(2);
};

const positive = (name: string, raw: string): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fail(`--${name} must be a positive number`);
};

if (values.help) {
  console.log(usage);
  process.exit(0);
}

const [command = "ramp", argument] = positionals;
const token = process.env.LOAD_TEST_TOKEN ?? fail("LOAD_TEST_TOKEN is not set");
const baseUrl = (values.url ?? process.env.GOBLINS_URL ?? "http://localhost:3190").replace(
  /\/$/,
  "",
);

const run = <A, E>(program: Effect.Effect<A, E>) => {
  const fiber = Effect.runFork(program.pipe(Logger.withMinimumLogLevel(LogLevel.Info)));
  // Ctrl-C stops the run; the step in progress keeps its data until `cleanup <run-id>`.
  process.once("SIGINT", () => Effect.runFork(Fiber.interrupt(fiber)));
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit)) {
      console.error(Cause.pretty(exit.cause));
      process.exitCode = 1;
    }
  });
};

if (command === "cleanup") {
  const runId = argument ?? fail("cleanup needs the run id");
  // One run id per step (`<run-id>-s<n>`); `simulate --classes` uses the run id itself.
  run(
    Effect.forEach(
      [runId, ...Array.from({ length: 20 }, (_, i) => `${runId}-s${i + 1}`)],
      (stepRunId) =>
        cleanup({ baseUrl, token, runId: stepRunId, mockSpec: "" }).pipe(
          Effect.tap((deleted) => Effect.logInfo(`${stepRunId}: ${JSON.stringify(deleted)}`)),
        ),
      { discard: true },
    ).pipe(Effect.provide(recorderLayer())),
  );
} else {
  const scenario: ScenarioName =
    command === "ramp"
      ? "normal"
      : command === "scenario"
        ? (scenarios.find((s) => s === argument) ?? fail(`unknown scenario "${argument ?? ""}"`))
        : fail(`unknown command "${command}"`);
  const runId =
    values["run-id"] ?? `lt-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}`;
  if (!RUN_ID.test(`${runId}-s99`))
    fail("--run-id must be letters, digits, - or _, at most 60 long");
  const templateId = values.template;
  const perStudent = submissionsPerStudent(templateId) ?? fail(`unknown template "${templateId}"`);

  const ramp: RampPlan = {
    studentsPerClass: positive("students-per-class", values["students-per-class"]),
    startClasses: positive("start-classes", values["start-classes"]),
    stepClasses: positive("step-classes", values["step-classes"]),
    maxSteps: command === "ramp" ? positive("max-steps", values["max-steps"]) : 1,
  };

  const program = runLoadTest({
    baseUrl,
    token,
    runId,
    scenario,
    classesPerStep: stepClasses(ramp),
    studentsPerClass: ramp.studentsPerClass,
    templateId,
    submissionsPerStudent: perStudent,
    pace: scaled(testingDay, positive("time-scale", values["time-scale"])),
    seed: positive("seed", values.seed),
    drainMs: positive("drain-minutes", values["drain-minutes"]) * 60_000,
    submitGiveUpMs: 5 * 60_000,
    queue: values.queue,
    outDir: values.out,
    keepData: values["keep-data"],
  }).pipe(
    Effect.tap(({ dir, summary }) =>
      Effect.logInfo(
        `done: ${summary.capacityStudents === null ? "no step passed" : `capacity ${summary.capacityStudents} students`}; ${summary.stoppedBecause}. Report: ${dir}/report.md`,
      ),
    ),
  );
  run(program);
}
