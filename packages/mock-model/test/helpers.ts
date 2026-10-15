import { readFileSync } from "node:fs";
import type { CompletionRequest, ModelError } from "@goblins/grader";
import { Clock, Duration, Effect, Either } from "effect";
import { type CallLogRow, type MockConfig, makeMockModelClient } from "../src/index.ts";

export const fixtureBytes = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));

/** A grading request carrying `image` as a data URL, or no image at all. */
export const request = (
  image: Uint8Array | undefined,
  subjectId = "grade-1",
  attempt?: number,
): CompletionRequest => ({
  model: "test/model",
  tag: { purpose: "grade", subjectId, ...(attempt === undefined ? {} : { attempt }) },
  messages: [
    { role: "system", content: "Grade the student's work." },
    {
      role: "user",
      content: [
        { type: "text", text: "Problem 1: Solve 2x + 3 = 11" },
        ...(image === undefined
          ? []
          : [
              {
                type: "image" as const,
                url: `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
              },
            ]),
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
export const callsAt = (config: MockConfig, atMs: number, n: number, image?: Uint8Array) => {
  const latencies: Array<number> = [];
  return Effect.gen(function* () {
    const client = yield* makeMockModelClient(config, { seed: 42 });
    const results = yield* Effect.all(
      Array.from({ length: n }, () => Effect.either(client.complete(request(image)))),
    );
    const tally: Tally = {};
    const texts: Array<string> = [];
    const errors: Array<ModelError> = [];
    for (const result of results) {
      const tag = Either.isRight(result) ? "Ok" : result.left._tag;
      tally[tag] = (tally[tag] ?? 0) + 1;
      if (Either.isRight(result)) texts.push(result.right.text);
      else errors.push(result.left);
    }
    return { tally, texts, errors, latencies };
  }).pipe(Effect.withClock(frozenClock(atMs, latencies)));
};

export const share = (tally: Tally, tag: string, n: number): number => (tally[tag] ?? 0) / n;

export const mean = (xs: ReadonlyArray<number>): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** A `model_calls` row for a real grading call, as Drizzle returns it. */
export const modelCallRow = (overrides: Partial<CallLogRow> = {}): CallLogRow => ({
  purpose: "grade",
  provider: "openrouter",
  model: "google/gemini-2.5-flash",
  status: "ok",
  latencyMs: 100,
  inputTokens: 1800,
  outputTokens: 200,
  loadTestRunId: null,
  createdAt: new Date(Date.UTC(2026, 9, 15)),
  ...overrides,
});
