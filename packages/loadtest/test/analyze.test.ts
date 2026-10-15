import type { SimEvent } from "@goblins/simulator";
import { describe, expect, it } from "vitest";
import { analyzeStep, type StepInput } from "../src/analyze.ts";
import { attribute, evaluate, verdictOf } from "../src/criteria.ts";

const T0 = 1_000_000;

/** A class where every submission is acknowledged after `ackMs` and graded `gradeMs` later. */
const scenario = (options: {
  submissions: number;
  ackMs: number;
  gradeMs: number;
  /** Submissions with these indexes never reach the dashboard. */
  missing?: ReadonlyArray<number>;
  failed?: ReadonlyArray<number>;
}): Array<SimEvent> =>
  Array.from({ length: options.submissions }, (_, i): Array<SimEvent> => {
    const sent = T0 + i * 1000;
    const id = `sub-${i}`;
    const events: Array<SimEvent> = [
      {
        type: "request",
        at: sent,
        op: "submit",
        ms: options.ackMs,
        outcome: { _tag: "Status", status: 200 },
      },
      {
        type: "submitted",
        at: sent + options.ackMs,
        classId: "c0",
        submissionId: id,
        studentId: `st-${i}`,
        problemId: "p",
        firstSentAt: sent,
        attempts: 1,
        whiteboard: "correct.png",
        expected: "graded",
      },
    ];
    if (options.missing?.includes(i)) return events;
    const state = options.failed?.includes(i) ? "couldnt_grade" : "graded";
    events.push(
      {
        type: "dashboard-grade",
        at: sent + options.ackMs + options.gradeMs,
        classId: "c0",
        submissionId: id,
        state,
        points: state === "graded" ? 2 : null,
        failureReason: state === "graded" ? null : "Timeout after 5 deliveries",
      },
      {
        type: "student-saw-grade",
        at: sent + options.ackMs + options.gradeMs,
        submissionId: id,
        state,
      },
    );
    return events;
  }).flat();

const input = (events: Array<SimEvent>, overrides: Partial<StepInput> = {}): StepInput => ({
  events,
  timings: undefined,
  db: [],
  plannedStudents: 100,
  plannedSubmissions: 100,
  startedAt: T0,
  endedAt: T0 + 200_000,
  ...overrides,
});

describe("analyzeStep and the criteria", () => {
  it("passes a healthy step", () => {
    const metrics = analyzeStep(input(scenario({ submissions: 100, ackMs: 200, gradeMs: 4000 })));
    const criteria = evaluate(metrics, "normal");
    expect(criteria.every((c) => c.pass)).toBe(true);
    expect(verdictOf(metrics, criteria)._tag).toBe("Pass");
    expect(metrics.submitToDashboardMs.p95).toBe(4200);
    expect(metrics.transitionShare).toBe(0);
  });

  it("counts a grade that never reaches the dashboard as lost and infinitely late", () => {
    const metrics = analyzeStep(
      input(scenario({ submissions: 100, ackMs: 200, gradeMs: 1000, missing: [3] }), {
        timings: [
          {
            submissionId: "sub-3",
            state: "submitted",
            attempt: 1,
            createdAt: new Date(T0).toISOString(),
            claimedAt: null,
            outcomeAt: null,
          },
        ],
      }),
    );
    expect(metrics.lost.count).toBe(1);
    expect(metrics.submitToDashboardMs.max).toBe(Number.POSITIVE_INFINITY);
    expect(metrics.transitionShare).toBeCloseTo(0.99);
    const criteria = evaluate(metrics, "normal");
    expect(criteria.find((c) => c.id === "lost")?.pass).toBe(false);
    expect(attribute(metrics, "lost")).toMatch(/^Queue/);
  });

  it("fails the submit bar on p99, not on the median", () => {
    const fast = scenario({ submissions: 98, ackMs: 300, gradeMs: 1000 });
    const slow = scenario({ submissions: 2, ackMs: 2500, gradeMs: 1000 }).map((e) =>
      "submissionId" in e ? { ...e, submissionId: `slow-${e.submissionId}` } : e,
    );
    const metrics = analyzeStep(input([...fast, ...slow]));
    expect(metrics.submitAckMs.p50).toBe(300);
    expect(evaluate(metrics, "normal").find((c) => c.id === "submit-p99")?.pass).toBe(false);
  });

  it("allows 0.1% failures normally but none during a provider outage", () => {
    const events = scenario({ submissions: 2000, ackMs: 100, gradeMs: 1000, failed: [5] });
    const metrics = analyzeStep(input(events));
    expect(evaluate(metrics, "normal").find((c) => c.id === "failures")?.pass).toBe(true);
    expect(evaluate(metrics, "provider-outage").find((c) => c.id === "failures")?.pass).toBe(false);
  });

  it("marks a step invalid when the load generator was the bottleneck", () => {
    const busy = (at: number): SimEvent => ({
      type: "generator",
      at,
      eventLoopDelayP99Ms: 450,
      cpuPercent: 99,
      openRequests: 3000,
      heapMb: 400,
    });
    const metrics = analyzeStep(
      input([
        ...scenario({ submissions: 10, ackMs: 100, gradeMs: 100 }),
        busy(T0),
        busy(T0 + 2000),
      ]),
    );
    expect(verdictOf(metrics, evaluate(metrics, "normal"))._tag).toBe("ClientLimited");
  });

  it("sums queued and in-flight counts across classes", () => {
    const counts: Array<SimEvent> = [
      { type: "dashboard-counts", at: T0 + 1000, classId: "a", submitted: 5, grading: 2, final: 0 },
      { type: "dashboard-counts", at: T0 + 2000, classId: "b", submitted: 3, grading: 4, final: 0 },
      { type: "dashboard-counts", at: T0 + 3000, classId: "a", submitted: 0, grading: 1, final: 6 },
    ];
    const metrics = analyzeStep(input(counts));
    expect(metrics.pipeline.peakQueued).toBe(8);
    expect(metrics.pipeline.peakInFlight).toBe(6);
  });
});
