/**
 * The recorded demo's class: simulated students join a session a real teacher launched in
 * production and work through every problem in two or three minutes, so the teacher's dashboard
 * fills up on camera and the report has something to say.
 *
 *   pnpm demo:class --target https://<app> --code 123456 --template solving-linear-equations
 *
 * The whiteboards are eval-dataset cases for the template that the real grader (Haiku) graded
 * correctly in every recorded eval run, so the grades on camera are the right ones:
 * - most students submit correct work;
 * - on two "struggle" problems most students make a common mistake, so those problems land under
 *   the report's 75% line and get a "where students struggled" section and the Goblins CTA;
 * - a few students submit messy or ambiguous work the grader flagged in the evals, so "Needs you"
 *   has items to review.
 * The class is not a load test: no load-test header, so it shows on the teacher's real dashboard
 * and the app grades it with its configured model (about $0.001 per grade with Haiku).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type GradingCase, loadGradingDataset } from "@goblins/evals/datasets";
import { Cause, Effect, Exit, Logger, LogLevel, Schema } from "effect";
import type { Problem } from "./api.ts";
import { runStudentsOnly } from "./class.ts";
import { Recorder, recorderLayer } from "./events.ts";
import { planClass, testingDay } from "./pacing.ts";
import { submissionsPerStudent } from "./problems.ts";
import { forkRng } from "./rng.ts";
import type { Whiteboard } from "./whiteboards.ts";

const usage = `Usage:
  pnpm demo:class --target <app origin> --code <join code> [options]

Options:
  --template <id>      the template the teacher launched (default solving-linear-equations)
  --students <n>       default 27
  --pace <fast|class>  fast: everyone done in about 2–3 minutes (default); class: 20–40 minutes
  --struggle <a,b>     the two problems most students get wrong (default: chosen from the data)
  --seed <n>           same seed, same names and whiteboards (default 1)`;

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    code: { type: "string" },
    template: { type: "string", default: "solving-linear-equations" },
    students: { type: "string", default: "27" },
    pace: { type: "string", default: "fast" },
    struggle: { type: "string" },
    seed: { type: "string", default: "1" },
    help: { type: "boolean", default: false },
  },
});

const fail = (message: string): never => {
  console.error(`${message}\n\n${usage}`);
  process.exit(2);
};
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const target = (values.target ?? fail("--target is required")).replace(/\/$/, "");
const joinCode = values.code ?? fail("--code is required");
const students = Number(values.students);
if (!Number.isInteger(students) || students < 1) fail("--students must be a positive integer");
const seed = Number(values.seed);
const templateId = values.template;

// ---------------------------------------------------------------------------
// Which eval cases the real grader gets right

const Outcomes = Schema.Struct({
  outcomes: Schema.Array(
    Schema.Struct({
      _tag: Schema.String,
      caseId: Schema.String,
      points: Schema.optional(Schema.Number),
      flagged: Schema.optional(Schema.Boolean),
    }),
  ),
});

const evalsRoot = new URL("../../", import.meta.resolve("@goblins/evals/datasets"));
/** Every recorded Haiku grading run with the production prompt. A case must be right in all. */
const runs = [
  "results/grading/anthropic_claude-haiku-5.5.json",
  "results/grading/anthropic_claude-haiku-5.5.repeat-2.json",
].map(
  (path) =>
    Schema.decodeUnknownSync(Outcomes)(JSON.parse(readFileSync(new URL(path, evalsRoot), "utf8")))
      .outcomes,
);

const shouldFlag = (c: GradingCase) => c.expected.flag === "ShouldFlag";

/** The grader gave the expected points (or flagged it, for a case scored on the flag) in every run. */
const reliable = (c: GradingCase): boolean =>
  runs.every((outcomes) => {
    const o = outcomes.find((x) => x.caseId === c.id);
    if (o === undefined || o._tag !== "Graded") return false;
    if (c.expected.flag === "ShouldFlag" && o.flagged !== true) return false;
    if (c.expected.flag === "ShouldNotFlag" && o.flagged === true) return false;
    return c.expected.scoreOn === "flag" || o.points === c.expectedPoints;
  });

const cases = loadGradingDataset([templateId]).cases.filter(
  (c) => c.slice === "generated" && c.review._tag === "Checked" && reliable(c),
);
if (cases.length === 0) fail(`no reliable eval cases for template "${templateId}"`);

const whiteboardOf = (c: GradingCase): Whiteboard => ({
  name: c.id,
  png: new Uint8Array(readFileSync(c.image)),
  expected: shouldFlag(c) ? "needs_teacher" : "graded",
  expectedFraction: shouldFlag(c) ? null : c.expectedPoints / c.maxPoints,
  weight: 1,
});

interface Pools {
  readonly correct: ReadonlyArray<Whiteboard>;
  readonly mistake: ReadonlyArray<Whiteboard>;
  readonly flagged: ReadonlyArray<Whiteboard>;
}

const pools = new Map<string, Pools>();
for (const itemId of new Set(cases.map((c) => c.itemId))) {
  const forItem = cases.filter((c) => c.itemId === itemId);
  pools.set(itemId, {
    correct: forItem
      .filter((c) => !shouldFlag(c) && c.expectedPoints === c.maxPoints)
      .map(whiteboardOf),
    mistake: forItem
      .filter(
        (c) =>
          !shouldFlag(c) &&
          c.tags.includes("common-mistake") &&
          c.expectedPoints <= c.maxPoints / 2,
      )
      .map(whiteboardOf),
    flagged: forItem.filter(shouldFlag).map(whiteboardOf),
  });
}

const items = [...pools.keys()];
const struggle =
  values.struggle?.split(",").map((s) => s.trim()) ??
  items
    .filter(
      (id) => (pools.get(id)?.mistake.length ?? 0) > 0 && (pools.get(id)?.correct.length ?? 0) > 0,
    )
    .slice(-2);
const flagItems = items.filter(
  (id) => !struggle.includes(id) && (pools.get(id)?.flagged.length ?? 0) > 0,
);
/** Four students, spread through the class, each submit one ambiguous whiteboard. */
const flaggedStudents = new Map(
  [3, 10, 17, 24]
    .filter((i) => i < students)
    .map((student, n) => [student, flagItems[n % Math.max(1, flagItems.length)]]),
);

const at = <A>(list: ReadonlyArray<A>, i: number): A | undefined =>
  list[i % Math.max(1, list.length)];

/** Everyone gets a whiteboard for every problem the eval set covers; others are skipped. */
const pick = (problem: Problem, student: number): Whiteboard | undefined => {
  const itemId = problem.label.trim().toLowerCase();
  const pool = pools.get(itemId);
  if (pool === undefined) return undefined;
  if (struggle.includes(itemId) && student % 10 < 7) {
    return at(pool.mistake, student) ?? at(pool.correct, student);
  }
  if (flaggedStudents.get(student) === itemId) return at(pool.flagged, student);
  return at(pool.correct, student) ?? at(pool.mistake, student);
};

// ---------------------------------------------------------------------------
// Run

const pace =
  values.pace === "class"
    ? { ...testingDay, lobbyMs: 20_000, bellSpreadMs: 0, lateShare: 0, resumeShare: 0 }
    : values.pace === "fast"
      ? {
          ...testingDay,
          lobbyMs: 20_000,
          bellSpreadMs: 0,
          workMinMs: 90_000,
          workMaxMs: 150_000,
          lateShare: 0,
          resumeShare: 0,
        }
      : fail(`--pace must be fast or class`);

const program = Effect.gen(function* () {
  const recorder = yield* Recorder;
  const plan = planClass(forkRng(seed, "demo"), pace, {
    students,
    problems: submissionsPerStudent(templateId) ?? fail(`unknown template "${templateId}"`),
  });
  yield* Effect.logInfo(
    `${students} students joining ${joinCode} at ${target} (template ${templateId}; struggle problems ${struggle.join(", ")}; ${flaggedStudents.size} ambiguous whiteboards). Start the session when they're in the lobby.`,
  );
  const result = yield* runStudentsOnly({
    target: { baseUrl: target, token: undefined, runId: "demo", mockSpec: "" },
    classId: "demo",
    joinCode,
    // Students join over the lobby; each starts working when the teacher starts the session.
    plan,
    whiteboards: [
      { name: "unused", png: new Uint8Array(), expected: "graded", expectedFraction: 1, weight: 1 },
    ],
    pick,
    seed,
    runStartMs: Date.now(),
    submitGiveUpMs: 5 * 60_000,
    lingerMs: 60_000,
  });
  const events = recorder.events();
  const seen = events.filter((e) => e.type === "student-saw-grade");
  const flagged = seen.filter((e) => e.state !== "graded").length;
  const failures = events.filter(
    (e) => e.type === "student-failed" || e.type === "submit-abandoned",
  );
  yield* Effect.logInfo(
    `Done: ${result.joined} students, ${result.submitted} submissions, ${seen.length} grades back, ${flagged} for you to check.${failures.length > 0 ? ` ${failures.length} problems: ${JSON.stringify(failures.slice(0, 3))}` : ""} You can end the session.`,
  );
}).pipe(Effect.provide(recorderLayer()), Logger.withMinimumLogLevel(LogLevel.Info));

Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isFailure(exit)) {
    console.error(Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
});
