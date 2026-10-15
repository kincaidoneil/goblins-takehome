/**
 * What the simulator observed, as a flat list of timestamped events. The load test computes every
 * metric from these after a step, so the analysis is a pure function and the raw log can be kept
 * next to the report. Times are epoch milliseconds from this machine's clock.
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { Context, Effect, Layer } from "effect";

/** An HTTP call the app serves. `shape` requests are Electric sync through the app's proxy. */
export type Operation =
  | "join"
  | "submit"
  | "create-assignment"
  | "create-session"
  | "start-session"
  | "end-session"
  | "shape"
  | "stats"
  | "cleanup";

/** How a request ended: an HTTP status, or no response. */
export type RequestOutcome =
  | { readonly _tag: "Status"; readonly status: number }
  | { readonly _tag: "NetworkError"; readonly message: string }
  | { readonly _tag: "Timeout" };

export type GradeState = "submitted" | "grading" | "graded" | "needs_teacher" | "couldnt_grade";
export type FinalState = "graded" | "needs_teacher" | "couldnt_grade";

export const isFinal = (state: GradeState): state is FinalState =>
  state === "graded" || state === "needs_teacher" || state === "couldnt_grade";

export type SimEvent =
  | {
      readonly type: "request";
      readonly at: number;
      readonly op: Operation;
      readonly ms: number;
      readonly outcome: RequestOutcome;
      /** For `shape`: a live long-poll, which is expected to take up to ~20 s. */
      readonly live?: boolean;
      /** For `shape`: which view. */
      readonly view?: string;
      readonly bytes?: number;
    }
  | {
      readonly type: "joined";
      readonly at: number;
      readonly classId: string;
      readonly studentId: string;
      readonly resumed: boolean;
    }
  | {
      /** A submit the server acknowledged. `firstSentAt` is the first attempt, before any retries. */
      readonly type: "submitted";
      readonly at: number;
      readonly classId: string;
      readonly submissionId: string;
      readonly studentId: string;
      readonly problemId: string;
      readonly firstSentAt: number;
      readonly attempts: number;
      readonly whiteboard: string;
      readonly expected: FinalState;
    }
  | {
      /** A submit that never got acknowledged: the student's work did not reach the server. */
      readonly type: "submit-abandoned";
      readonly at: number;
      readonly classId: string;
      readonly studentId: string;
      readonly problemId: string;
      readonly firstSentAt: number;
      readonly attempts: number;
      readonly reason: string;
    }
  | {
      /** The student's progress strip got a final grade. */
      readonly type: "student-saw-grade";
      readonly at: number;
      readonly submissionId: string;
      readonly state: FinalState;
    }
  | {
      /** The teacher's dashboard showed this submission's grade in a final state for the first time. */
      readonly type: "dashboard-grade";
      readonly at: number;
      readonly classId: string;
      readonly submissionId: string;
      readonly state: FinalState;
      readonly points: number | null;
      readonly failureReason: string | null;
    }
  | {
      /** Grade states on one class's dashboard, after a change. Queued is `submitted`, in flight is `grading`. */
      readonly type: "dashboard-counts";
      readonly at: number;
      readonly classId: string;
      readonly submitted: number;
      readonly grading: number;
      readonly final: number;
    }
  | {
      readonly type: "resumed";
      readonly at: number;
      readonly classId: string;
      /** The app returned the same student for the retyped name. */
      readonly sameStudent: boolean;
    }
  | {
      /** End-of-class check of the dashboard against what the simulator did. */
      readonly type: "class-check";
      readonly at: number;
      readonly classId: string;
      readonly studentsJoined: number;
      readonly studentsOnDashboard: number;
      readonly submissionsAcked: number;
      readonly gradesOnDashboard: number;
      readonly unexpectedStates: number;
    }
  | {
      /** A student who could not join, or rejoin, and so made no further submissions. */
      readonly type: "student-failed";
      readonly at: number;
      readonly classId: string;
      readonly stage: "join" | "resume";
      readonly message: string;
    }
  | {
      /** The teacher could not set the class up; none of its students ran. */
      readonly type: "class-failed";
      readonly at: number;
      readonly classId: string;
      readonly stage: string;
      readonly students: number;
      readonly message: string;
    }
  | {
      readonly type: "shape-error";
      readonly at: number;
      readonly view: string;
      readonly message: string;
    }
  | {
      /** This machine's own load, so a client bottleneck is not reported as a server limit. */
      readonly type: "generator";
      readonly at: number;
      readonly eventLoopDelayP99Ms: number;
      readonly cpuPercent: number;
      readonly openRequests: number;
      readonly heapMb: number;
    };

export class Recorder extends Context.Tag("@goblins/simulator/Recorder")<
  Recorder,
  {
    readonly record: (event: SimEvent) => void;
    readonly events: () => ReadonlyArray<SimEvent>;
  }
>() {}

/** Keeps every event in memory and, when `ndjsonPath` is set, appends each to that file. */
export const recorderLayer = (options: { readonly ndjsonPath?: string } = {}) =>
  Layer.scoped(
    Recorder,
    Effect.gen(function* () {
      const events: Array<SimEvent> = [];
      const path = options.ndjsonPath;
      const file: WriteStream | undefined = yield* path === undefined
        ? Effect.succeed(undefined)
        : Effect.acquireRelease(
            Effect.sync(() => createWriteStream(path, { flags: "a" })),
            (stream) =>
              Effect.async<void>((resume) => {
                stream.end(() => resume(Effect.void));
              }),
          );
      return Recorder.of({
        record: (event) => {
          events.push(event);
          file?.write(`${JSON.stringify(event)}\n`);
        },
        events: () => events,
      });
    }),
  );
