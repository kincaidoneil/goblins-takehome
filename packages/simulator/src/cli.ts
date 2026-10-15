/**
 * pnpm --filter @goblins/simulator simulate [options]
 *
 * Two uses:
 * - The recorded demo: `--join-code <code>` sends a simulated class into a session a real teacher
 *   launched, so that teacher's dashboard and projector fill up live. The app grades these like
 *   any class (see README for what that costs).
 * - Many classes at scale: without `--join-code`, it creates its own load-test teachers and
 *   sessions (needs LOAD_TEST_TOKEN) and checks every dashboard against what the students did.
 *   For pass/fail reports, use `pnpm loadtest` instead.
 */
import { parseArgs } from "node:util";
import { Cause, Effect, Exit, Logger, LogLevel } from "effect";
import { runStudentsOnly } from "./class.ts";
import { Recorder, recorderLayer, type SimEvent } from "./events.ts";
import { planClass, scaled, testingDay } from "./pacing.ts";
import { DEFAULT_TEMPLATE, submissionsPerStudent } from "./problems.ts";
import { forkRng } from "./rng.ts";
import { runSimulation } from "./simulation.ts";
import { RUN_ID } from "./target.ts";
import { loadWhiteboards } from "./whiteboards.ts";

const usage = `Usage:
  simulate --join-code <code> [--students 30]        join a real teacher's session (demo)
  simulate --classes <n> [--students 30]             create load-test classes (needs LOAD_TEST_TOKEN)

Options:
  --url <origin>       app (default: $GOBLINS_URL, else http://localhost:3190)
  --time-scale <x>     1 = real pace (20–40 min per student); 0.1 = 2–4 min (default 0.1)
  --template <id>      for --classes (default ${DEFAULT_TEMPLATE})
  --seed <n>           same seed, same names, schedule and whiteboards (default 1)
  --events <file>      also write every event as NDJSON`;

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    "join-code": { type: "string" },
    classes: { type: "string" },
    students: { type: "string", default: "30" },
    "time-scale": { type: "string", default: "0.1" },
    template: { type: "string", default: DEFAULT_TEMPLATE },
    seed: { type: "string", default: "1" },
    events: { type: "string" },
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

const baseUrl = (values.url ?? process.env.GOBLINS_URL ?? "http://localhost:3190").replace(
  /\/$/,
  "",
);
const token = process.env.LOAD_TEST_TOKEN;
const students = positive("students", values.students);
const pace = scaled(testingDay, positive("time-scale", values["time-scale"]));
const seed = positive("seed", values.seed);
const runId = `sim-${Date.now().toString(36)}`;
if (!RUN_ID.test(runId)) fail("bad run id");
const target = {
  baseUrl,
  token,
  runId,
  mockSpec: `mode=sampled; profile=seed; start=${Date.now()}`,
};

const summarize = (events: ReadonlyArray<SimEvent>) => {
  const count = (type: SimEvent["type"]) => events.filter((e) => e.type === type).length;
  const states: Record<string, number> = {};
  for (const e of events)
    if (e.type === "dashboard-grade") states[e.state] = (states[e.state] ?? 0) + 1;
  return {
    joined: count("joined"),
    submitted: count("submitted"),
    abandoned: count("submit-abandoned"),
    gradesSeenByStudents: count("student-saw-grade"),
    gradesOnDashboards: states,
    classChecks: events.filter((e) => e.type === "class-check"),
    failures: events.filter((e) => e.type === "class-failed" || e.type === "student-failed"),
  };
};

const joinCode = values["join-code"];
const program = Effect.gen(function* () {
  const recorder = yield* Recorder;
  if (joinCode !== undefined) {
    // The real session's problem count is only known after joining; plan for the default
    // template's and let each student stop at the session's last problem.
    const plan = planClass(
      forkRng(seed, "demo"),
      { ...pace, lobbyMs: 0, lateShare: 0 },
      {
        students,
        problems: submissionsPerStudent(DEFAULT_TEMPLATE) ?? 10,
      },
    );
    yield* Effect.logInfo(`${students} students joining ${joinCode} at ${baseUrl}`);
    yield* runStudentsOnly({
      target,
      classId: "demo",
      joinCode,
      plan: { ...plan, startAtMs: 0 },
      whiteboards: loadWhiteboards(),
      seed,
      runStartMs: Date.now(),
      submitGiveUpMs: 5 * 60_000,
      lingerMs: 30_000,
    });
  } else {
    if (token === undefined) return yield* Effect.fail("LOAD_TEST_TOKEN is not set");
    const classes = positive("classes", values.classes ?? fail("pass --join-code or --classes"));
    const templateId = values.template;
    const problems = submissionsPerStudent(templateId) ?? fail(`unknown template "${templateId}"`);
    yield* Effect.logInfo(`${classes} classes of ${students} at ${baseUrl}, run id ${runId}`);
    yield* runSimulation({
      target,
      classes,
      studentsPerClass: students,
      problems,
      templateId,
      pace,
      seed,
      drainMs: 5 * 60_000,
      submitGiveUpMs: 5 * 60_000,
    });
    yield* Effect.logInfo(
      `data kept under run id ${runId}; delete it with: pnpm --filter @goblins/loadtest loadtest cleanup ${runId}`,
    );
  }
  yield* Effect.logInfo(JSON.stringify(summarize(recorder.events()), null, 2));
}).pipe(
  Effect.provide(recorderLayer(values.events === undefined ? {} : { ndjsonPath: values.events })),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isFailure(exit)) {
    console.error(Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
});
