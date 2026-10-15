/**
 * Where grade jobs go. Until the grading pipeline (`packages/grader`) and the mock model
 * (`packages/mock-model`) are merged and wired to Vercel Queues, jobs run in-process against a
 * scripted mock so every flow and E2E test can exercise all five grade states.
 *
 * The mock reads the student's name:
 * - a name containing "flag" gets a best guess that needs the teacher;
 * - a name containing "fail" gets "couldn't grade" on the first attempt (a retry succeeds);
 * - anyone else gets full marks.
 */
import {
  Db,
  type GradeJob,
  type GraderOutcome,
  type GradingInput,
  recordOutcome,
  schema,
  startGrading,
} from "@goblins/domain";
import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { Context, Duration, Effect, Layer, Runtime } from "effect";

export class GradeQueue extends Context.Tag("@goblins/web/GradeQueue")<
  GradeQueue,
  { readonly enqueue: (job: GradeJob) => Effect.Effect<void> }
>() {}

const scriptedOutcome = (input: GradingInput, studentName: string): GraderOutcome => {
  const name = studentName.toLowerCase();
  const full = input.rubricLines.map((line) => ({ rubricLineId: line.id, points: line.points }));
  const read = `Work for problem ${input.problem.label}, ending in ${input.problem.answerKey}`;
  if (name.includes("fail") && input.lease.attempt === 1) {
    return { _tag: "Failed", failureReason: "The model provider timed out three times." };
  }
  if (name.includes("flag")) {
    return {
      _tag: "Unsure",
      result: {
        read,
        linePoints: full,
        reason: "Correct answer, but the last step is hard to read.",
      },
      flagReason: "Handwriting on the final line is unclear.",
    };
  }
  return { _tag: "Sure", result: { read, linePoints: full, reason: "Correct setup and answer." } };
};

const gradeWithMock = (job: GradeJob) =>
  Effect.gen(function* () {
    // Roughly the latency of a real call, so the student's between-problem transition is exercised.
    yield* Effect.sleep(Duration.millis(800 + Math.random() * 1500));
    const claim = yield* startGrading(job);
    if (claim._tag !== "Claimed") return;
    const db = yield* Db;
    const [student] = yield* db
      .select({ name: schema.students.displayName })
      .from(schema.grades)
      .innerJoin(schema.students, eq(schema.students.id, schema.grades.studentId))
      .where(eq(schema.grades.submissionId, job.submissionId));
    yield* recordOutcome(claim.input.lease, scriptedOutcome(claim.input, student?.name ?? ""));
  });

/** Runs each job in the background of the current request. */
export const InlineMockGradeQueue = Layer.effect(
  GradeQueue,
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<Db>();
    return {
      enqueue: (job) =>
        Effect.sync(() => {
          const work = Runtime.runPromise(runtime)(
            gradeWithMock(job).pipe(
              Effect.catchAllCause((cause) => Effect.logError("Mock grading failed", cause)),
            ),
          );
          // On Vercel, keep the function alive until the grade is written.
          waitUntil(work);
        }),
    };
  }),
);
