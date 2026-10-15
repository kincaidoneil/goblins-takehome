import { describe, expect, it } from "vitest";
import {
  type EmpiricalProfile,
  type LoggedCall,
  sampleFate,
  sampleLogNormal,
  seededRng,
  seedProfile,
} from "../src/index.ts";

const quantile = (sorted: ReadonlyArray<number>, q: number) =>
  sorted[Math.floor(q * (sorted.length - 1))] ?? NaN;

describe("sampling", () => {
  it("log-normal latency hits the requested median and p95", () => {
    const rng = seededRng(1);
    const xs = Array.from({ length: 50_000 }, () => sampleLogNormal(rng, 3500, 9000)).sort(
      (a, b) => a - b,
    );
    expect(quantile(xs, 0.5) / 3500).toBeCloseTo(1, 1);
    expect(quantile(xs, 0.95) / 9000).toBeCloseTo(1, 1);
    expect(xs[0]).toBeGreaterThan(0);
  });

  it("parametric error mix matches the profile's rates", () => {
    const rng = seededRng(2);
    const n = 200_000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const fate = sampleFate(seedProfile, rng);
      const tag = fate._tag === "Succeed" ? "Ok" : fate.failure._tag;
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
    for (const [tag, rate] of Object.entries(seedProfile.errorRates)) {
      expect((counts[tag] ?? 0) / n).toBeCloseTo(rate, 3);
    }
  });

  it("empirical profile resamples logged calls with latency and outcome paired", () => {
    const call = (latencyMs: number, outcome: LoggedCall["outcome"]): LoggedCall => ({
      startedAt: 0,
      latencyMs,
      outcome,
      status: outcome === "ProviderError" ? 500 : undefined,
      retryAfterMs: undefined,
      promptTokens: 1,
      completionTokens: 1,
    });
    const profile: EmpiricalProfile = {
      _tag: "Empirical",
      source: "test",
      calls: [call(1000, "Ok"), call(1000, "Ok"), call(1000, "Ok"), call(50, "ProviderError")],
    };
    const rng = seededRng(3);
    let errors = 0;
    for (let i = 0; i < 40_000; i++) {
      const fate = sampleFate(profile, rng);
      if (fate._tag === "Fail") {
        errors++;
        expect(fate).toEqual({
          _tag: "Fail",
          latencyMs: 50,
          failure: { _tag: "ProviderError", status: 500 },
        });
      } else {
        expect(fate.latencyMs).toBe(1000);
      }
    }
    expect(errors / 40_000).toBeCloseTo(0.25, 2);
  });
});
