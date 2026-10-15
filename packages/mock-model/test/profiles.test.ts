import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { type MockConfig, profiles, recordings, sampleFate, seededRng } from "../src/index.ts";
import { callsAt, share } from "./helpers.ts";

const quantile = (sorted: ReadonlyArray<number>, q: number) =>
  sorted[Math.floor(q * (sorted.length - 1))] ?? Number.NaN;

describe("claude-haiku-5.5 profile (measured)", () => {
  const profile = profiles["claude-haiku-5.5"];

  it("holds the 1,839 imported calls, all successes", () => {
    expect(profile._tag === "Empirical" && profile.calls.length).toBe(1839);
    expect(recordings["claude-haiku-5.5"].calls.length).toBe(1839);
  });

  it("samples latencies with the measured median and p95 (3.9 s, 8.0 s)", () => {
    const rng = seededRng(5);
    const latencies = Array.from({ length: 20_000 }, () => sampleFate(profile, rng).latencyMs).sort(
      (a, b) => a - b,
    );
    expect(quantile(latencies, 0.5) / 3913).toBeCloseTo(1, 1);
    expect(quantile(latencies, 0.95) / 7967).toBeCloseTo(1, 1);
  });

  it.effect("is the default for sampled and replay modes, with no errors outside scenarios", () =>
    Effect.gen(function* () {
      const sampled: MockConfig = {
        _tag: "Sampled",
        profile: "claude-haiku-5.5",
        scenario: undefined,
        anchorMs: 0,
      };
      const { tally } = yield* callsAt(sampled, 60_000, 500);
      expect(share(tally, "Ok", 500)).toBe(1);
      const replay: MockConfig = { _tag: "Replay", recording: "claude-haiku-5.5", anchorMs: 0 };
      expect((yield* callsAt(replay, 30 * 60_000, 200)).tally).toEqual({ Ok: 200 });
    }),
  );
});
