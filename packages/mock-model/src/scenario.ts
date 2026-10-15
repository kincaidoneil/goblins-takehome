/**
 * Named failure scenarios layered over a profile's sampled fates.
 *
 * Scenarios are functions of the time elapsed since the run's anchor, not of
 * per-instance state, so every serverless instance grading for the same run
 * sees the outage at the same moment.
 */
import type { Fate, Rng } from "./fate.ts";

export type ScenarioName = "rate-limit-storm" | "provider-down" | "latency-doubling";

export const scenarioNames = [
  "rate-limit-storm",
  "provider-down",
  "latency-doubling",
] as const satisfies ReadonlyArray<ScenarioName>;

export interface Scenario {
  readonly name: ScenarioName;
  /** Milliseconds after the anchor when the scenario starts. */
  readonly startMs: number;
  /** How long it lasts. `Infinity` means until the run ends. */
  readonly durationMs: number;
}

const MINUTE = 60_000;

export const scenarioDefaults: Record<ScenarioName, Omit<Scenario, "name">> = {
  // Starts after two minutes so the run has a clean baseline to compare against.
  "rate-limit-storm": { startMs: 2 * MINUTE, durationMs: 3 * MINUTE },
  "provider-down": { startMs: 2 * MINUTE, durationMs: 5 * MINUTE },
  "latency-doubling": { startMs: 0, durationMs: Infinity },
};

/** Share of calls rejected during a rate-limit storm. */
export const STORM_REJECT_RATE = 0.7;

export const isActive = (scenario: Scenario, elapsedMs: number): boolean =>
  elapsedMs >= scenario.startMs && elapsedMs < scenario.startMs + scenario.durationMs;

export const applyScenario = (
  scenario: Scenario,
  elapsedMs: number,
  base: Fate,
  rng: Rng,
): Fate => {
  if (!isActive(scenario, elapsedMs)) return base;
  switch (scenario.name) {
    case "rate-limit-storm":
      return rng() < STORM_REJECT_RATE
        ? {
            _tag: "Fail",
            latencyMs: 150 + Math.round(rng() * 350),
            failure: { _tag: "RateLimited", retryAfterMs: 2000 + Math.round(rng() * 8000) },
          }
        : base;
    case "provider-down":
      return {
        _tag: "Fail",
        latencyMs: 100 + Math.round(rng() * 300),
        failure: { _tag: "ProviderError", status: 503 },
      };
    case "latency-doubling":
      return { ...base, latencyMs: base.latencyMs * 2 };
  }
};
