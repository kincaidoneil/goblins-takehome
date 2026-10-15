import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import {
  type MockConfig,
  makeReplayer,
  profileFromCallLog,
  recordingFromCallLog,
  seedWindow,
} from "../src/index.ts";
import { callsAt, share } from "./helpers.ts";

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

  it.effect("loops when the run outlasts the recording", () =>
    Effect.gen(function* () {
      const { lengthMs } = makeReplayer(seedWindow);
      const burst = yield* callsAt(replay, lengthMs + 4 * MINUTE + 10_000, 1000);
      expect(share(burst.tally, "RateLimited", 1000)).toBeGreaterThan(0.6);
    }),
  );

  it("uses the nearest call when a time bucket is empty", () => {
    const call = (startedAt: number, outcome: "Ok" | "ProviderError") => ({
      model: "m",
      startedAt,
      latencyMs: 100,
      outcome,
      promptTokens: 1,
      completionTokens: 1,
    });
    const recording = recordingFromCallLog([call(0, "Ok"), call(95_000, "ProviderError")], {
      source: "test",
    });
    if (Either.isLeft(recording)) throw new Error("expected a recording");
    const replayer = makeReplayer(recording.right);
    expect(replayer.callAt(30_000, Math.random).outcome).toBe("Ok");
    expect(replayer.callAt(80_000, Math.random).outcome).toBe("ProviderError");
  });
});

describe("call log import", () => {
  it("builds an empirical profile and rejects invalid rows with their index", () => {
    const ok = profileFromCallLog(
      [
        {
          model: "a",
          startedAt: "2026-10-15T09:00:00Z",
          latencyMs: 4000,
          outcome: "Ok",
          promptTokens: 1800,
          completionTokens: 200,
        },
        {
          model: "b",
          startedAt: 1,
          latencyMs: 1,
          outcome: "Ok",
          promptTokens: 1,
          completionTokens: 1,
        },
      ],
      { source: "test", model: "a" },
    );
    expect(Either.isRight(ok) && ok.right.calls.length).toBe(1);
    const bad = profileFromCallLog([{ model: "a", latencyMs: -1 }], { source: "test" });
    expect(Either.isLeft(bad) && bad.left._tag).toBe("InvalidRow");
    expect(profileFromCallLog([], { source: "test" })).toMatchObject({ left: { _tag: "NoCalls" } });
  });
});
