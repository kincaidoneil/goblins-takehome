import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { type MockConfig, makeReplayer, recordingFromCallLog, seedWindow } from "../src/index.ts";
import { callsAt, modelCallRow, share } from "./helpers.ts";

const replay: MockConfig = { _tag: "Replay", recording: "seed-window", anchorMs: 0 };
const MINUTE = 60_000;

describe("replay", () => {
  it.effect("reproduces the recording's 429 burst at minute 4 and calm elsewhere", () =>
    Effect.gen(function* () {
      const calm = yield* callsAt(replay, 2 * MINUTE, 1000);
      const burst = yield* callsAt(replay, 4 * MINUTE + 10_000, 1000);
      expect(share(calm.tally, "RateLimited", 1000)).toBeLessThan(0.05);
      expect(share(burst.tally, "RateLimited", 1000)).toBeGreaterThan(0.6);
    }),
  );

  it("the 10-minute recording loops every 10 minutes, with no empty tail", () => {
    expect(makeReplayer(seedWindow).lengthMs).toBe(10 * MINUTE);
  });

  it.effect("loops when the run outlasts the recording", () =>
    Effect.gen(function* () {
      const { lengthMs } = makeReplayer(seedWindow);
      const burst = yield* callsAt(replay, lengthMs + 4 * MINUTE + 10_000, 1000);
      expect(share(burst.tally, "RateLimited", 1000)).toBeGreaterThan(0.6);
    }),
  );

  it("uses the nearest call when a time bucket is empty", () => {
    const call = (offsetMs: number, status: "ok" | "provider_error") =>
      modelCallRow({ createdAt: new Date(Date.UTC(2026, 9, 15) + offsetMs), status });
    const recording = recordingFromCallLog([call(0, "ok"), call(95_000, "provider_error")], {
      source: "test",
    });
    if (Either.isLeft(recording)) throw new Error("expected a recording");
    const replayer = makeReplayer(recording.right);
    expect(replayer.callAt(30_000, Math.random).outcome).toBe("Ok");
    expect(replayer.callAt(80_000, Math.random).outcome).toBe("ProviderError");
  });
});
