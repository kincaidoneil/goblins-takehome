/**
 * Seed data used until real calls exist in the call log.
 *
 * THESE NUMBERS ARE GUESSES, NOT MEASUREMENTS. They are a plausible shape for
 * a vision model grading one whiteboard image through OpenRouter. Replace them
 * with a profile and recording exported from the call log once the latency
 * calibration budget has been spent (see README).
 */

import { seededRng } from "./fate.ts";
import type { LoggedCall, ParametricProfile } from "./profile.ts";
import { sampleFate, sampleUsage } from "./profile.ts";
import type { Recording } from "./replay.ts";

export const seedProfile: ParametricProfile = {
  _tag: "Parametric",
  source: "seed: guessed, not measured (no real calls logged yet)",
  latency: { medianMs: 3500, p95Ms: 9000 },
  errorRates: { RateLimited: 0.005, ProviderError: 0.005, BadResponse: 0.002 },
  tokens: { prompt: 1800, completion: 250 },
};

const T0 = Date.UTC(2026, 9, 15, 9, 0, 0);

/**
 * A synthetic 10-minute window at about 5 calls per second, drawn from the
 * seed profile, with a 45-second burst of 429s starting at minute 4.
 */
const buildSeedWindow = (): Recording => {
  const rng = seededRng(20261015);
  const callAt = (t: number): LoggedCall => {
    const inBurst = t >= 4 * 60_000 && t < 4 * 60_000 + 45_000;
    const fate = sampleFate(seedProfile, rng);
    const usage = sampleUsage(seedProfile, rng);
    const base = { startedAt: T0 + t, ...usage, status: undefined, retryAfterMs: undefined };
    if (inBurst && rng() < 0.8) {
      return { ...base, latencyMs: 250, outcome: "RateLimited", retryAfterMs: 5000 };
    }
    if (fate._tag === "Succeed") return { ...base, latencyMs: fate.latencyMs, outcome: "Ok" };
    const failure = fate.failure;
    return {
      ...base,
      latencyMs: fate.latencyMs,
      outcome: failure._tag,
      status: failure._tag === "ProviderError" ? failure.status : undefined,
      retryAfterMs: failure._tag === "RateLimited" ? failure.retryAfterMs : undefined,
    };
  };
  const head = callAt(0);
  const tail: Array<LoggedCall> = [];
  for (let t = 200; t < 10 * 60_000; t += 200) tail.push(callAt(t));
  return { source: "seed-window: synthetic, drawn from the seed profile", calls: [head, ...tail] };
};

export const seedWindow: Recording = buildSeedWindow();
