import type { CompletionRequest } from "@goblins/grader";
import { Clock, Duration, Effect, Either } from "effect";
import { type MockConfig, makeMockModelClient } from "../src/index.ts";

export const request = (text = "Grade this."): CompletionRequest => ({
  model: "test/model",
  tag: { purpose: "grade" },
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text },
        { type: "image", url: "data:," },
      ],
    },
  ],
});

/** Count of calls per outcome: "Ok" or the error's tag. */
export type Tally = Record<string, number>;

/**
 * A clock frozen at `nowMs` whose `sleep` records the duration and returns at
 * once. Effect's TestClock wakes sleepers one at a time, which takes seconds
 * for a few thousand concurrent calls; this checks the same thing instantly.
 */
const frozenClock = (nowMs: number, slept: Array<number>): Clock.Clock => ({
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => nowMs,
  currentTimeMillis: Effect.succeed(nowMs),
  unsafeCurrentTimeNanos: () => BigInt(nowMs) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(nowMs) * 1_000_000n),
  sleep: (duration) => Effect.sync(() => void slept.push(Duration.toMillis(duration))),
});

/**
 * Makes `n` calls at `atMs` after the run anchor (the configs used here anchor
 * at 0) and tallies their outcomes and the latency each one slept for.
 */
export const callsAt = (config: MockConfig, atMs: number, n: number, text?: string) => {
  const latencies: Array<number> = [];
  return Effect.gen(function* () {
    const client = yield* makeMockModelClient(config, { seed: 42 });
    const results = yield* Effect.all(
      Array.from({ length: n }, () => Effect.either(client.complete(request(text)))),
    );
    const tally: Tally = {};
    const texts: Array<string> = [];
    for (const result of results) {
      const tag = Either.isRight(result) ? "Ok" : result.left._tag;
      tally[tag] = (tally[tag] ?? 0) + 1;
      if (Either.isRight(result)) texts.push(result.right.text);
    }
    return { tally, texts, latencies };
  }).pipe(Effect.withClock(frozenClock(atMs, latencies)));
};

export const share = (tally: Tally, tag: string, n: number): number => (tally[tag] ?? 0) / n;

export const mean = (xs: ReadonlyArray<number>): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
