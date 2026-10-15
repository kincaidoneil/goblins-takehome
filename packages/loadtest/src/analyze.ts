/**
 * Turns one step's raw events into the metrics the PRD asks for. Pure: the same events always
 * give the same report, and the tests feed it synthetic events.
 */
import type { FinalState, SimEvent } from "@goblins/simulator";
import type { DbSample, GradeTiming } from "./server.ts";
import { type Distribution, distribution, groupCount } from "./stats.ts";

/** The between-problem transition on the student's screen (PRD, "Student work"). */
export const TRANSITION_MS = 1500;

/** A generator over these limits measured itself, not the app. */
export const GENERATOR_LIMITS = { eventLoopDelayP99Ms: 200, cpuPercent: 90 } as const;

export interface StepInput {
  readonly events: ReadonlyArray<SimEvent>;
  /** From the server, when the timings route answered. */
  readonly timings: ReadonlyArray<GradeTiming> | undefined;
  readonly db: ReadonlyArray<DbSample>;
  readonly plannedStudents: number;
  readonly plannedSubmissions: number;
  readonly startedAt: number;
  readonly endedAt: number;
}

type Lost =
  | { readonly kind: "never-acknowledged"; readonly reason: string }
  /** Planned but never sent: the class failed setup or the student could not join. */
  | { readonly kind: "never-attempted" }
  | {
      readonly kind: "no-final-grade";
      /** Where the server says the grade is, when timings are available. */
      readonly serverState: string;
    };

export interface StepMetrics {
  readonly window: {
    readonly startedAt: number;
    readonly endedAt: number;
    readonly minutes: number;
  };
  readonly load: {
    readonly plannedStudents: number;
    readonly studentsJoined: number;
    readonly classesFailed: number;
    readonly studentsFailed: number;
    readonly plannedSubmissions: number;
    readonly submissionsAcked: number;
    /** Highest rate of acknowledged submissions over any 10-second window. */
    readonly peakSubmitsPerSecond: number;
    readonly meanSubmitsPerSecond: number;
  };
  /** Single submit requests that got a 200, in ms. */
  readonly submitRequestMs: Distribution;
  /** From the first submit attempt to the acknowledgment, including retries, in ms. */
  readonly submitAckMs: Distribution;
  readonly submitRetries: number;
  /** From the first submit attempt to the grade appearing on the teacher's dashboard. Missing grades count as infinite. */
  readonly submitToDashboardMs: Distribution;
  /** Where the time went, from server timestamps. Null without timings. */
  readonly breakdown: {
    readonly queueWaitMs: Distribution;
    readonly gradingMs: Distribution;
    /** Outcome recorded on the server to the row arriving on the dashboard. Crosses two clocks. */
    readonly syncLagMs: Distribution;
    readonly attemptsOverOne: number;
  } | null;
  readonly grades: {
    readonly byState: Record<FinalState, number>;
    readonly failureRate: number;
    readonly failureReasons: Record<string, number>;
    /** A final state other than the one the whiteboard's mock outcome predicts. */
    readonly unexpectedStates: number;
  };
  readonly lost: { readonly count: number; readonly byKind: Record<string, number> };
  readonly pipeline: {
    readonly peakQueued: number;
    readonly peakInFlight: number;
    /** Sum over classes, sampled every 5 s: [secondsFromStart, queued, inFlight]. */
    readonly series: ReadonlyArray<readonly [number, number, number]>;
  };
  /** Share of grades the student saw within the 1.5 s transition after their submit was acknowledged. */
  readonly transitionShare: number | null;
  readonly correctness: {
    readonly resumes: number;
    readonly resumeFailures: number;
    readonly dashboardStudentMismatches: number;
  };
  readonly errors: {
    /** Non-2xx responses and transport failures, by operation and outcome. */
    readonly requests: Record<string, number>;
    readonly shapeErrors: number;
    readonly classFailures: Record<string, number>;
    readonly studentFailures: Record<string, number>;
  };
  readonly sync: {
    readonly requests: number;
    readonly requestsPerSecond: number;
    readonly liveRequests: number;
    /** Requests per view, e.g. the teacher's `grades` or a student's `my-grades`. */
    readonly byView: Record<string, number>;
    /** Non-live shape requests (initial sync and catch-up), in ms. */
    readonly catchUpMs: Distribution;
  };
  readonly database: {
    readonly samples: number;
    readonly peakConnections: number | null;
    readonly maxConnections: number | null;
    readonly peakActive: number | null;
    readonly peakWaitingOnLock: number | null;
    readonly peakCommitsPerSecond: number | null;
    readonly deadlocks: number | null;
  };
  readonly generator: {
    readonly peakEventLoopDelayP99Ms: number;
    readonly peakCpuPercent: number;
    readonly peakOpenRequests: number;
    readonly peakHeapMb: number;
    /** Two samples in a row over a limit: the client, not the server, set the pace. */
    readonly limited: boolean;
  };
}

const ofType = <T extends SimEvent["type"]>(events: ReadonlyArray<SimEvent>, type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const outcomeKey = (outcome: Extract<SimEvent, { type: "request" }>["outcome"]): string => {
  switch (outcome._tag) {
    case "Status":
      return `HTTP ${outcome.status}`;
    case "NetworkError":
      return "network error";
    case "Timeout":
      return "client timeout";
  }
};

export const analyzeStep = (input: StepInput): StepMetrics => {
  const { events } = input;
  const minutes = (input.endedAt - input.startedAt) / 60_000;

  const submitted = ofType(events, "submitted");
  const abandoned = ofType(events, "submit-abandoned");
  const dashboard = new Map(ofType(events, "dashboard-grade").map((e) => [e.submissionId, e]));
  const studentSaw = new Map(ofType(events, "student-saw-grade").map((e) => [e.submissionId, e]));
  const timings =
    input.timings === undefined
      ? undefined
      : new Map(input.timings.map((t) => [t.submissionId, t]));
  const requests = ofType(events, "request");

  // Load
  const ackTimes = submitted.map((e) => e.at);
  const buckets = groupCount(ackTimes, (t) => String(Math.floor((t - input.startedAt) / 10_000)));
  const peakSubmitsPerSecond = Math.max(0, ...Object.values(buckets)) / 10;

  // Submit latency
  const submitRequests = requests.filter((r) => r.op === "submit");
  const submitRequestMs = distribution(
    submitRequests
      .filter((r) => r.outcome._tag === "Status" && r.outcome.status === 200)
      .map((r) => r.ms),
  );
  const submitAckMs = distribution(submitted.map((e) => e.at - e.firstSentAt));

  // Submit to dashboard, and lost submissions
  const lost: Array<Lost> = abandoned.map((e) => ({
    kind: "never-acknowledged",
    reason: e.reason,
  }));
  // Planned work never attempted: a class whose setup failed, a student who could not join.
  // Without this a step could pass on the classes that worked.
  const shortfall = Math.max(0, input.plannedSubmissions - submitted.length - abandoned.length);
  for (let i = 0; i < shortfall; i++) lost.push({ kind: "never-attempted" });
  const toDashboard: Array<number> = [];
  for (const s of submitted) {
    const shown = dashboard.get(s.submissionId);
    if (shown === undefined) {
      toDashboard.push(Number.POSITIVE_INFINITY);
      lost.push({
        kind: "no-final-grade",
        serverState: timings?.get(s.submissionId)?.state ?? "unknown",
      });
    } else {
      toDashboard.push(shown.at - s.firstSentAt);
    }
  }

  // Breakdown from server timestamps
  const breakdown =
    timings === undefined
      ? null
      : (() => {
          const queue: Array<number> = [];
          const grading: Array<number> = [];
          const sync: Array<number> = [];
          let attemptsOverOne = 0;
          for (const s of submitted) {
            const t = timings.get(s.submissionId);
            if (t === undefined) continue;
            if (t.attempt > 1) attemptsOverOne++;
            const created = Date.parse(t.createdAt);
            const claimed = t.claimedAt === null ? undefined : Date.parse(t.claimedAt);
            const outcome = t.outcomeAt === null ? undefined : Date.parse(t.outcomeAt);
            if (claimed !== undefined) queue.push(claimed - created);
            if (claimed !== undefined && outcome !== undefined) grading.push(outcome - claimed);
            const shown = dashboard.get(s.submissionId);
            if (outcome !== undefined && shown !== undefined) sync.push(shown.at - outcome);
          }
          return {
            queueWaitMs: distribution(queue),
            gradingMs: distribution(grading),
            syncLagMs: distribution(sync),
            attemptsOverOne,
          };
        })();

  // Final grades
  const byState: Record<FinalState, number> = { graded: 0, needs_teacher: 0, couldnt_grade: 0 };
  for (const s of submitted) {
    const shown = dashboard.get(s.submissionId);
    if (shown !== undefined) byState[shown.state]++;
  }
  const failureReasons = groupCount(
    submitted.flatMap((s) => {
      const shown = dashboard.get(s.submissionId);
      return shown?.state === "couldnt_grade" ? [shown.failureReason ?? "no reason given"] : [];
    }),
    (reason) => reason,
  );
  const checks = ofType(events, "class-check");

  // Queued and in flight: each class's latest dashboard counts, summed. Peaks use every change;
  // the series samples every 5 s.
  const counts = ofType(events, "dashboard-counts").sort((a, b) => a.at - b.at);
  const latest = new Map<string, { submitted: number; grading: number }>();
  const totals = () => {
    let queued = 0;
    let inFlight = 0;
    for (const c of latest.values()) {
      queued += c.submitted;
      inFlight += c.grading;
    }
    return { queued, inFlight };
  };
  const series: Array<readonly [number, number, number]> = [];
  let peakQueued = 0;
  let peakInFlight = 0;
  let nextSample = input.startedAt;
  for (const c of counts) {
    while (nextSample < c.at) {
      const { queued, inFlight } = totals();
      series.push([Math.round((nextSample - input.startedAt) / 1000), queued, inFlight]);
      nextSample += 5000;
    }
    latest.set(c.classId, { submitted: c.submitted, grading: c.grading });
    const { queued, inFlight } = totals();
    peakQueued = Math.max(peakQueued, queued);
    peakInFlight = Math.max(peakInFlight, inFlight);
  }
  while (nextSample <= input.endedAt) {
    const { queued, inFlight } = totals();
    series.push([Math.round((nextSample - input.startedAt) / 1000), queued, inFlight]);
    nextSample += 5000;
  }

  // Transition
  const inTransition = submitted.filter((s) => {
    const saw = studentSaw.get(s.submissionId);
    return saw !== undefined && saw.at - s.at <= TRANSITION_MS;
  }).length;

  // Errors
  const failedRequests = requests.filter(
    (r) => r.outcome._tag !== "Status" || r.outcome.status >= 400,
  );

  // Sync
  const shapes = requests.filter((r) => r.op === "shape");

  // Database
  const db = [...input.db].sort((a, b) => a.at - b.at);
  let peakCommitsPerSecond: number | null = null;
  for (let i = 1; i < db.length; i++) {
    const a = db[i - 1];
    const b = db[i];
    if (a === undefined || b === undefined || b.at <= a.at) continue;
    const rate = (b.xactCommit - a.xactCommit) / ((b.at - a.at) / 1000);
    peakCommitsPerSecond = Math.max(peakCommitsPerSecond ?? 0, Math.round(rate));
  }
  const peak = (f: (s: DbSample) => number) => (db.length === 0 ? null : Math.max(...db.map(f)));
  const first = db[0];
  const last = db.at(-1);

  // Generator
  const generator = ofType(events, "generator");
  const over = generator.map(
    (g) =>
      g.eventLoopDelayP99Ms > GENERATOR_LIMITS.eventLoopDelayP99Ms ||
      g.cpuPercent > GENERATOR_LIMITS.cpuPercent,
  );
  const limited = over.some((o, i) => o && over[i + 1] === true);

  const resumes = ofType(events, "resumed");
  const studentsFailed = ofType(events, "student-failed");
  const classesFailed = ofType(events, "class-failed");

  return {
    window: { startedAt: input.startedAt, endedAt: input.endedAt, minutes },
    load: {
      plannedStudents: input.plannedStudents,
      studentsJoined: new Set(ofType(events, "joined").map((e) => `${e.classId}:${e.studentId}`))
        .size,
      classesFailed: classesFailed.length,
      studentsFailed: studentsFailed.length,
      plannedSubmissions: input.plannedSubmissions,
      submissionsAcked: submitted.length,
      peakSubmitsPerSecond,
      meanSubmitsPerSecond: minutes > 0 ? submitted.length / (minutes * 60) : 0,
    },
    submitRequestMs,
    submitAckMs,
    submitRetries: submitted.reduce((sum, s) => sum + s.attempts - 1, 0),
    submitToDashboardMs: distribution(toDashboard),
    breakdown,
    grades: {
      byState,
      failureRate: submitted.length === 0 ? 0 : byState.couldnt_grade / submitted.length,
      failureReasons,
      unexpectedStates: checks.reduce((sum, c) => sum + c.unexpectedStates, 0),
    },
    lost: {
      count: lost.length,
      byKind: groupCount(lost, (l) => {
        switch (l.kind) {
          case "never-acknowledged":
            return `never acknowledged: ${l.reason}`;
          case "never-attempted":
            return "never attempted (class setup or join failed)";
          case "no-final-grade":
            return `acknowledged, no final grade (server: ${l.serverState})`;
        }
      }),
    },
    pipeline: { peakQueued, peakInFlight, series },
    transitionShare: submitted.length === 0 ? null : inTransition / submitted.length,
    correctness: {
      resumes: resumes.length,
      resumeFailures: resumes.filter((r) => !r.sameStudent).length,
      dashboardStudentMismatches: checks.filter((c) => c.studentsJoined !== c.studentsOnDashboard)
        .length,
    },
    errors: {
      requests: groupCount(failedRequests, (r) => `${r.op}: ${outcomeKey(r.outcome)}`),
      shapeErrors: ofType(events, "shape-error").length,
      classFailures: groupCount(classesFailed, (e) => `${e.stage}: ${e.message}`),
      studentFailures: groupCount(studentsFailed, (e) => `${e.stage}: ${e.message}`),
    },
    sync: {
      requests: shapes.length,
      requestsPerSecond: minutes > 0 ? shapes.length / (minutes * 60) : 0,
      liveRequests: shapes.filter((r) => r.live === true).length,
      byView: groupCount(shapes, (r) => r.view ?? "unknown"),
      catchUpMs: distribution(
        shapes
          .filter((r) => r.live !== true && r.outcome._tag === "Status" && r.outcome.status < 400)
          .map((r) => r.ms),
      ),
    },
    database: {
      samples: db.length,
      peakConnections: peak((s) => s.connections),
      maxConnections: last?.maxConnections ?? null,
      peakActive: peak((s) => s.active),
      peakWaitingOnLock: peak((s) => s.waitingOnLock),
      peakCommitsPerSecond,
      deadlocks:
        first === undefined || last === undefined ? null : last.deadlocks - first.deadlocks,
    },
    generator: {
      peakEventLoopDelayP99Ms: Math.max(0, ...generator.map((g) => g.eventLoopDelayP99Ms)),
      peakCpuPercent: Math.max(0, ...generator.map((g) => g.cpuPercent)),
      peakOpenRequests: Math.max(0, ...generator.map((g) => g.openRequests)),
      peakHeapMb: Math.max(0, ...generator.map((g) => g.heapMb)),
      limited,
    },
  };
};
