/**
 * One simulated class: a teacher who creates the assignment, opens the session, starts it at the
 * bell and keeps the dashboard subscribed, and the students who join by code and name, work
 * through every problem and keep their progress strips subscribed until the class ends.
 */
import { Deferred, Effect, Either, Fiber, Schedule } from "effect";
import * as api from "./api.ts";
import { type FinalState, type GradeState, isFinal, Recorder } from "./events.ts";
import { retypedName, studentNames } from "./names.ts";
import type { ClassPlan, StudentPlan } from "./pacing.ts";
import { forkRng, type Rng, weighted } from "./rng.ts";
import { SessionRow, StudentGradeRow, StudentRow, subscribe, TeacherGradeRow } from "./shapes.ts";
import { loadTestHeaders, type Target } from "./target.ts";
import type { Whiteboard } from "./whiteboards.ts";

export interface ClassOptions {
  readonly target: Target;
  readonly classId: string;
  /** Load-test teacher number; the app maps it to teacher `loadtest:<runId>:<n>`. */
  readonly teacher: number;
  readonly templateId: string;
  readonly plan: ClassPlan;
  readonly whiteboards: readonly [Whiteboard, ...Array<Whiteboard>];
  readonly seed: number;
  /** Epoch ms that every plan offset counts from. */
  readonly runStartMs: number;
  /** After the last submission, how long to wait for every grade to reach the dashboard. */
  readonly drainMs: number;
  /** A submit that has not been acknowledged after this long is abandoned. */
  readonly submitGiveUpMs: number;
}

/** What the class's own dashboard shows, kept current by the teacher's subscriptions. */
interface Dashboard {
  readonly students: Set<string>;
  readonly grades: Map<
    string,
    { state: GradeState; points: number | null; maxPoints: number | null }
  >;
}

/** What the simulated students did, for checking the dashboard against it. */
interface Truth {
  readonly joined: Set<string>;
  readonly acked: Map<string, { readonly state: FinalState; readonly fraction: number | null }>;
}

const sleepUntil = (epochMs: number) =>
  Effect.suspend(() => Effect.sleep(Math.max(0, epochMs - Date.now())));

export const runClass = (options: ClassOptions) =>
  Effect.gen(function* () {
    const recorder = yield* Recorder;
    const { target, classId, plan, runStartMs } = options;
    const setupFailed = (stage: string) => (error: { readonly _tag: string }) =>
      Effect.sync(() =>
        recorder.record({
          type: "class-failed",
          at: Date.now(),
          classId,
          stage,
          students: plan.students.length,
          message: describe(error),
        }),
      );

    const setup = yield* Effect.gen(function* () {
      const assignment = yield* api
        .createAssignment(target, options.teacher, options.templateId)
        .pipe(Effect.tapError(setupFailed("create-assignment")));
      const session = yield* api
        .createSession(target, options.teacher, assignment.assignmentId)
        .pipe(Effect.tapError(setupFailed("create-session")));
      return { assignment, session };
    }).pipe(Effect.either);
    if (Either.isLeft(setup)) return;
    const { session } = setup.right;

    const dashboard: Dashboard = { students: new Set(), grades: new Map() };
    const truth: Truth = { joined: new Set(), acked: new Map() };
    const classDone = yield* Deferred.make<void>();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const headers = api.teacherHeaders(target, options.teacher);
        yield* subscribe(target.baseUrl, {
          view: "students",
          sessionId: session.sessionId,
          headers,
          schema: StudentRow,
          onRows: (rows) => {
            dashboard.students.clear();
            for (const row of rows) dashboard.students.add(row.id);
          },
        });
        let lastCounts = "";
        yield* subscribe(target.baseUrl, {
          view: "grades",
          sessionId: session.sessionId,
          headers,
          schema: TeacherGradeRow,
          onRows: (rows) => {
            const at = Date.now();
            let submitted = 0;
            let grading = 0;
            let final = 0;
            for (const row of rows) {
              const previous = dashboard.grades.get(row.submission_id);
              if (isFinal(row.state) && (previous === undefined || !isFinal(previous.state))) {
                recorder.record({
                  type: "dashboard-grade",
                  at,
                  classId,
                  submissionId: row.submission_id,
                  state: row.state,
                  points: row.points,
                  failureReason: row.failure_reason,
                });
              }
              dashboard.grades.set(row.submission_id, {
                state: row.state,
                points: row.points,
                maxPoints: row.max_points,
              });
              if (row.state === "submitted") submitted++;
              else if (row.state === "grading") grading++;
              else final++;
            }
            const counts = `${submitted}/${grading}/${final}`;
            if (counts !== lastCounts) {
              lastCounts = counts;
              recorder.record({ type: "dashboard-counts", at, classId, submitted, grading, final });
            }
          },
        });
        // The teacher's own view of the session status, as the dashboard header shows it.
        yield* subscribe(target.baseUrl, {
          view: "session",
          sessionId: session.sessionId,
          headers,
          schema: SessionRow,
          onRows: () => {},
        });

        const doneSubmitting = yield* Effect.forEach(plan.students, () => Deferred.make<void>());
        const names = studentNames(forkRng(options.seed, `${classId}:names`), plan.students.length);
        const students = yield* Effect.forEach(
          plan.students,
          (studentPlan, i) => {
            const done = doneSubmitting[i];
            if (done === undefined) return Effect.die("no deferred for student");
            return Effect.fork(
              runStudent({
                ...options,
                joinCode: session.joinCode,
                name: names[i] ?? `Student ${i}`,
                studentPlan,
                rng: forkRng(options.seed, `${classId}:student:${i}`),
                truth,
                classDone,
                doneSubmitting: done,
              }).pipe(Effect.ensuring(Deferred.succeed(done, undefined))),
            );
          },
          { concurrency: "unbounded" },
        );

        yield* sleepUntil(runStartMs + plan.startAtMs);
        const started = yield* api
          .setSessionStatus(target, options.teacher, session.sessionId, "start")
          .pipe(
            Effect.retry({ times: 4, schedule: Schedule.exponential("1 second") }),
            Effect.tapError(setupFailed("start-session")),
            Effect.either,
          );
        if (Either.isLeft(started)) {
          // The students would wait for a session that never goes live. Stop them; the class
          // counts as failed and its planned submissions as never attempted.
          yield* Effect.forEach(students, Fiber.interrupt, { discard: true });
          return;
        }

        // Every student has made their last submission (or given up).
        yield* Effect.forEach(doneSubmitting, Deferred.await, { discard: true });

        // Wait for the dashboard to show a final grade for everything the server accepted.
        const drainDeadline = Date.now() + options.drainMs;
        const allFinal = () =>
          [...truth.acked.keys()].every((id) => {
            const grade = dashboard.grades.get(id);
            return grade !== undefined && isFinal(grade.state);
          });
        while (!allFinal() && Date.now() < drainDeadline) yield* Effect.sleep(1000);

        // A grade the fixture does not predict: the wrong state, or (for a graded fixture) the
        // wrong share of the points, e.g. partial.png graded 2/2.
        let unexpected = 0;
        for (const [id, expected] of truth.acked) {
          const grade = dashboard.grades.get(id);
          if (grade === undefined || grade.state === "couldnt_grade" || !isFinal(grade.state)) {
            continue;
          }
          if (grade.state !== expected.state) {
            unexpected++;
          } else if (
            grade.state === "graded" &&
            expected.fraction !== null &&
            grade.points !== null &&
            grade.maxPoints !== null &&
            grade.points !== Math.round(expected.fraction * grade.maxPoints)
          ) {
            unexpected++;
          }
        }
        recorder.record({
          type: "class-check",
          at: Date.now(),
          classId,
          studentsJoined: truth.joined.size,
          studentsOnDashboard: dashboard.students.size,
          submissionsAcked: truth.acked.size,
          gradesOnDashboard: dashboard.grades.size,
          unexpectedStates: unexpected,
        });

        yield* Deferred.succeed(classDone, undefined);
        yield* Effect.forEach(students, Fiber.join, { discard: true });
      }),
    );

    yield* api
      .setSessionStatus(target, options.teacher, session.sessionId, "end")
      .pipe(Effect.tapError(setupFailed("end-session")), Effect.ignore);
  });

// ---------------------------------------------------------------------------
// Students only, for the recorded demo: a real teacher launches a session in the app and the
// simulated class joins it by code, so the teacher's own dashboard and projector fill up live.

export interface StudentsOnlyOptions
  extends Omit<ClassOptions, "teacher" | "templateId" | "drainMs"> {
  readonly joinCode: string;
  /** How long students stay on their summary screen after the last of them submits. */
  readonly lingerMs: number;
}

export const runStudentsOnly = (options: StudentsOnlyOptions) =>
  Effect.gen(function* () {
    const truth: Truth = { joined: new Set(), acked: new Map() };
    const classDone = yield* Deferred.make<void>();
    const names = studentNames(
      forkRng(options.seed, `${options.classId}:names`),
      options.plan.students.length,
    );
    const students = yield* Effect.forEach(
      options.plan.students,
      (studentPlan, i) =>
        Effect.gen(function* () {
          const done = yield* Deferred.make<void>();
          const fiber = yield* Effect.fork(
            runStudent({
              ...options,
              teacher: -1,
              templateId: "",
              drainMs: 0,
              name: names[i] ?? `Student ${i}`,
              studentPlan,
              rng: forkRng(options.seed, `${options.classId}:student:${i}`),
              truth,
              classDone,
              doneSubmitting: done,
            }).pipe(Effect.ensuring(Deferred.succeed(done, undefined))),
          );
          return { fiber, done };
        }),
      { concurrency: "unbounded" },
    );
    yield* Effect.forEach(students, ({ done }) => Deferred.await(done), { discard: true });
    yield* Effect.sleep(options.lingerMs);
    yield* Deferred.succeed(classDone, undefined);
    yield* Effect.forEach(students, ({ fiber }) => Fiber.join(fiber), { discard: true });
    return { joined: truth.joined.size, submitted: truth.acked.size };
  });

// ---------------------------------------------------------------------------
// Students

interface StudentOptions extends ClassOptions {
  readonly joinCode: string;
  readonly name: string;
  readonly studentPlan: StudentPlan;
  readonly rng: Rng;
  readonly truth: Truth;
  readonly classDone: Deferred.Deferred<void>;
  /** Completed after the student's last submission; the student then stays subscribed. */
  readonly doneSubmitting: Deferred.Deferred<void>;
}

const runStudent = (options: StudentOptions) =>
  Effect.gen(function* () {
    const recorder = yield* Recorder;
    const { target, classId, studentPlan } = options;
    const failed = (stage: "join" | "resume") => (error: { readonly _tag: string }) =>
      Effect.sync(() =>
        recorder.record({
          type: "student-failed",
          at: Date.now(),
          classId,
          stage,
          message: describe(error),
        }),
      );

    yield* sleepUntil(options.runStartMs + studentPlan.joinAtMs);
    const first = yield* joinWithRetry(target, options.joinCode, options.name).pipe(
      Effect.tapError(failed("join")),
      Effect.either,
    );
    if (Either.isLeft(first)) return;
    let student = first.right;
    const problems = [...student.problems].sort((a, b) => a.position - b.position);
    options.truth.joined.add(student.studentId);
    recorder.record({
      type: "joined",
      at: Date.now(),
      classId,
      studentId: student.studentId,
      resumed: student.resumed,
    });

    // One segment per device: a resuming student closes the tab before `resumeBefore`.
    const cut = studentPlan.resumeBefore;
    const segments =
      cut === undefined
        ? [problems.map((_, i) => i)]
        : [problems.slice(0, cut).map((_, i) => i), problems.slice(cut).map((_, i) => i + cut)];

    const seen = new Set<string>();
    let workStartMs: number | undefined;

    for (const [segmentIndex, segment] of segments.entries()) {
      if (segmentIndex > 0) {
        // A new device: no cookie, the name typed differently.
        const again = yield* joinWithRetry(
          target,
          options.joinCode,
          retypedName(options.name),
        ).pipe(Effect.tapError(failed("resume")), Effect.either);
        if (Either.isLeft(again)) return;
        recorder.record({
          type: "resumed",
          at: Date.now(),
          classId,
          sameStudent: again.right.studentId === student.studentId && again.right.resumed,
        });
        student = again.right;
      }
      const isLast = segmentIndex === segments.length - 1;
      const current = student;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const headers = { ...loadTestHeaders(target), cookie: current.cookie };
          const live = yield* Deferred.make<void>();
          yield* subscribe(target.baseUrl, {
            view: "my-session",
            sessionId: current.sessionId,
            headers,
            schema: SessionRow,
            onRows: (rows) => {
              if (rows.some((row) => row.status === "live")) Deferred.unsafeDone(live, Effect.void);
            },
          });
          yield* subscribe(target.baseUrl, {
            view: "my-grades",
            sessionId: current.sessionId,
            headers,
            schema: StudentGradeRow,
            onRows: (rows) => {
              const at = Date.now();
              for (const row of rows) {
                if (isFinal(row.state) && !seen.has(row.submission_id)) {
                  seen.add(row.submission_id);
                  recorder.record({
                    type: "student-saw-grade",
                    at,
                    submissionId: row.submission_id,
                    state: row.state,
                  });
                }
              }
            },
          });

          yield* Deferred.await(live);
          workStartMs ??= Date.now();
          const start = workStartMs;

          for (const index of segment) {
            const problem = problems[index];
            const offset = studentPlan.submitOffsetsMs[index];
            if (problem === undefined || offset === undefined) continue;
            yield* sleepUntil(start + offset);
            const whiteboard = weighted(options.rng, options.whiteboards, (w) => w.weight);
            const outcome = yield* submitWithRetry(options, current, problem.id, whiteboard);
            if (outcome === "stop") return;
          }

          if (isLast) {
            yield* Deferred.succeed(options.doneSubmitting, undefined);
            yield* Deferred.await(options.classDone);
          }
        }),
      );
    }
  });

const joinWithRetry = (target: Target, joinCode: string, name: string) =>
  api.join(target, joinCode, name).pipe(
    Effect.retry({
      times: 4,
      while: (error) =>
        error._tag === "TransportError" ||
        (error._tag === "UnexpectedStatus" && (error.status === 429 || error.status >= 500)),
      schedule: Schedule.exponential("500 millis"),
    }),
  );

/**
 * Submits until the server acknowledges the work, as the app's whiteboard does: it keeps the
 * work and retries when the connection or the server comes back. Returns "stop" when the session
 * no longer takes submissions.
 */
const submitWithRetry = (
  options: StudentOptions,
  student: api.Joined,
  problemId: string,
  whiteboard: Whiteboard,
) =>
  Effect.gen(function* () {
    const recorder = yield* Recorder;
    const firstSentAt = Date.now();
    const submittedAt = new Date(firstSentAt);
    const abandoned = (attempts: number, reason: string) =>
      recorder.record({
        type: "submit-abandoned",
        at: Date.now(),
        classId: options.classId,
        studentId: student.studentId,
        problemId,
        firstSentAt,
        attempts,
        reason,
      });

    for (let attempt = 1; ; attempt++) {
      const result = yield* api
        .submit(options.target, student, { problemId, submittedAt, png: whiteboard.png })
        .pipe(Effect.either);
      if (Either.isRight(result)) {
        const response = result.right;
        switch (response._tag) {
          case "Accepted":
            options.truth.acked.set(response.submissionId, {
              state: whiteboard.expected,
              fraction: whiteboard.expectedFraction,
            });
            recorder.record({
              type: "submitted",
              at: Date.now(),
              classId: options.classId,
              submissionId: response.submissionId,
              studentId: student.studentId,
              problemId,
              firstSentAt,
              attempts: attempt,
              whiteboard: whiteboard.name,
              expected: whiteboard.expected,
            });
            return "continue" as const;
          case "Rejected":
            abandoned(attempt, `rejected: ${response.reason}`);
            return response.reason === "session_not_live"
              ? ("stop" as const)
              : ("continue" as const);
          case "Unavailable":
            break;
        }
      } else if (result.left._tag !== "TransportError") {
        // The app answered outside the contract. Retrying would repeat it.
        abandoned(attempt, describe(result.left));
        return "continue" as const;
      }
      if (Date.now() - firstSentAt > options.submitGiveUpMs) {
        abandoned(attempt, "gave up retrying");
        return "continue" as const;
      }
      const backoff = Math.min(15_000, 500 * 2 ** (attempt - 1));
      yield* Effect.sleep(backoff * (0.5 + options.rng.next()));
    }
  });

const describe = (error: { readonly _tag: string }): string => {
  // Check the specific fields first: every tagged error also has an (often empty) `message`.
  if ("outcome" in error) return `${error._tag}: ${JSON.stringify(error.outcome)}`;
  if ("status" in error && "body" in error) {
    return `${error._tag} ${String(error.status)}: ${String(error.body)}`;
  }
  if ("message" in error && error.message !== "") return `${error._tag}: ${String(error.message)}`;
  return error._tag;
};
