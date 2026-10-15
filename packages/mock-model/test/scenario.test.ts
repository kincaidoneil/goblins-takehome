import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  applyScenario,
  type MockConfig,
  type ScenarioName,
  STORM_REJECT_RATE,
  sampleFate,
  scenarioDefaults,
  seededRng,
  seedProfile,
} from "../src/index.ts";
import { callsAt, mean, share } from "./helpers.ts";

const N = 2000;
const MINUTE = 60_000;
const sampled = (name: ScenarioName | undefined): MockConfig => ({
  _tag: "Sampled",
  profile: "seed",
  scenario: name === undefined ? undefined : { name, ...scenarioDefaults[name] },
  anchorMs: 0,
});

const baseRates = seedProfile.errorRates;

describe("scenarios produce the expected error mix", () => {
  it.effect("no scenario: errors match the seed profile's rates", () =>
    Effect.gen(function* () {
      const { tally } = yield* callsAt(sampled(undefined), 3 * MINUTE, N);
      expect(share(tally, "Ok", N)).toBeGreaterThan(0.97);
      expect(share(tally, "RateLimited", N)).toBeLessThan(baseRates.RateLimited * 3);
      expect(share(tally, "ProviderError", N)).toBeLessThan(baseRates.ProviderError * 3);
    }),
  );

  it.effect(
    "provider down: every call fails with 503 inside the 5-minute window, none outside",
    () =>
      Effect.gen(function* () {
        const before = yield* callsAt(sampled("provider-down"), 1 * MINUTE, N);
        const during = yield* callsAt(sampled("provider-down"), 4 * MINUTE, N);
        const lastMs = yield* callsAt(sampled("provider-down"), 7 * MINUTE - 1, N);
        const after = yield* callsAt(sampled("provider-down"), 7 * MINUTE, N);
        expect(share(before.tally, "ProviderError", N)).toBeLessThan(0.02);
        expect(during.tally).toEqual({ ProviderError: N });
        expect(lastMs.tally).toEqual({ ProviderError: N });
        expect(share(after.tally, "ProviderError", N)).toBeLessThan(0.02);
      }),
  );

  it.effect("rate-limit storm: about 70% of calls get 429 during the storm", () =>
    Effect.gen(function* () {
      const during = yield* callsAt(sampled("rate-limit-storm"), 3 * MINUTE, N);
      const after = yield* callsAt(sampled("rate-limit-storm"), 6 * MINUTE, N);
      expect(share(during.tally, "RateLimited", N)).toBeCloseTo(STORM_REJECT_RATE, 1);
      expect(share(after.tally, "RateLimited", N)).toBeLessThan(0.02);
    }),
  );

  it("latency doubling: every sampled latency doubles and the error mix is unchanged", () => {
    const scenario = { name: "latency-doubling", ...scenarioDefaults["latency-doubling"] } as const;
    const rng = seededRng(7);
    for (let i = 0; i < 20_000; i++) {
      const base = sampleFate(seedProfile, rng);
      expect(applyScenario(scenario, 10 * MINUTE, base, rng)).toEqual({
        ...base,
        latencyMs: base.latencyMs * 2,
      });
    }
  });

  it.effect("latency doubling: calls through the client take twice as long", () =>
    Effect.gen(function* () {
      const normal = yield* callsAt(sampled(undefined), MINUTE, N);
      const doubled = yield* callsAt(sampled("latency-doubling"), MINUTE, N);
      // Same seed, same draws, so each call sleeps exactly twice as long, except
      // calls that doubling pushed past the timeout.
      expect(mean(normal.latencies)).toBeGreaterThan(3000);
      expect(mean(doubled.latencies) / mean(normal.latencies)).toBeCloseTo(2, 1);
    }),
  );
});
