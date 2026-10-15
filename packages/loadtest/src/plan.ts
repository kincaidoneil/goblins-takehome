/**
 * What a load-test run does: which mock behavior, how many classes per step, and how fast.
 */
import type { Conditions } from "./criteria.ts";

export const scenarios = [
  "normal",
  "rate-limit-storm",
  "provider-down",
  "latency-doubling",
  "replay",
] as const;
export type ScenarioName = (typeof scenarios)[number];

/** Seconds into a step when the 5-minute provider outage starts, before time scaling. */
export const OUTAGE_AT_S = 180;
/** The PRD's outage criterion is about 5 real minutes, so the outage is never time-scaled. */
export const OUTAGE_FOR_S = 300;

export const mockSpecFor = (
  scenario: ScenarioName,
  options: { readonly startMs: number; readonly timeScale: number },
): string => {
  const start = `start=${options.startMs}`;
  switch (scenario) {
    case "normal":
      return `mode=sampled; profile=seed; ${start}`;
    case "rate-limit-storm":
    case "latency-doubling":
      return `mode=sampled; profile=seed; scenario=${scenario}; ${start}`;
    case "provider-down":
      return `mode=sampled; profile=seed; scenario=provider-down; at=${Math.round(
        OUTAGE_AT_S * options.timeScale,
      )}; for=${OUTAGE_FOR_S}; ${start}`;
    case "replay":
      return `mode=replay; recording=seed-window; ${start}`;
  }
};

export const conditionsFor = (scenario: ScenarioName): Conditions =>
  scenario === "provider-down" ? "provider-outage" : "normal";

/**
 * What the mock's timing comes from. Every report names it, because every latency in the report
 * depends on it. Until real calls are logged, the seed profile is a guess (see mock-model).
 */
export const describeMock = (scenario: ScenarioName): string => {
  const seed =
    "`seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; 0.5% rate limits, 0.5% provider errors, 0.2% bad responses)";
  switch (scenario) {
    case "normal":
      return seed;
    case "rate-limit-storm":
      return `${seed}, plus a rate-limit storm (70% of calls get a 429 with Retry-After 2–10 s) in minutes 2–5`;
    case "provider-down":
      return `${seed}, plus the provider down for ${OUTAGE_FOR_S / 60} minutes (every call fails with no response)`;
    case "latency-doubling":
      return `${seed}, with every latency doubled`;
    case "replay":
      return "`seed-window` recording: synthetic, 10 minutes drawn from the seed profile with a 45-second burst of 429s at minute 4";
  }
};

export interface RampPlan {
  readonly studentsPerClass: number;
  /** Classes in the first step. 33 × 30 = 990, the PRD's "about 1,000". */
  readonly startClasses: number;
  /** Classes added per step. */
  readonly stepClasses: number;
  readonly maxSteps: number;
}

export const stepClasses = (plan: RampPlan): ReadonlyArray<number> =>
  Array.from({ length: plan.maxSteps }, (_, i) => plan.startClasses + i * plan.stepClasses);
