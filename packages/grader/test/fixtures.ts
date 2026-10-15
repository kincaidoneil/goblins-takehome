/** Shared helpers for the pipeline tests: a scripted model and a virtual-time runner. */
import { Clock, Duration, Effect, Fiber, Option, Ref, TestClock } from "effect";
import type { Completion, CompletionRequest, ModelError } from "../src/ModelClient.ts";

export const LATENCY = Duration.seconds(2);

/** The placeholder grader's reply format, scoring every given line in full. */
export const reply = (
  lineIds: ReadonlyArray<string>,
  unsure: string | null = null,
): Completion => ({
  id: "gen",
  model: "fake/model",
  text: JSON.stringify({
    read: "2x = 8, x = 4",
    lines: lineIds.map((rubricLineId) => ({ rubricLineId, points: 1 })),
    reason: "Correct setup and answer.",
    unsure,
  }),
  usage: { promptTokens: 900, completionTokens: 60, costUsd: 0.0004 },
});

/**
 * What the scripted model does for a call: told the virtual time and how many
 * calls it has already seen for this submission.
 */
export type Script = (call: {
  readonly nowMs: number;
  readonly priorCalls: number;
  readonly request: CompletionRequest;
}) => Effect.Effect<Completion, ModelError>;

export const always =
  (completion: Completion): Script =>
  () =>
    Effect.succeed(completion);

/** A model that sleeps `LATENCY`, then follows the script. Counts calls and peak concurrency. */
export const fakeModel = (script: Script) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(new Map<string, number>());
    const inFlight = yield* Ref.make(0);
    const maxInFlight = yield* Ref.make(0);
    const client = {
      complete: (request: CompletionRequest) =>
        Effect.gen(function* () {
          const key = request.tag.subjectId ?? "";
          const priorCalls = yield* Ref.modify(calls, (m) => [
            m.get(key) ?? 0,
            new Map(m).set(key, (m.get(key) ?? 0) + 1),
          ]);
          const n = yield* Ref.updateAndGet(inFlight, (x) => x + 1);
          yield* Ref.update(maxInFlight, (m) => Math.max(m, n));
          yield* Effect.sleep(LATENCY);
          const nowMs = yield* Clock.currentTimeMillis;
          return yield* script({ nowMs, priorCalls, request });
        }).pipe(Effect.ensuring(Ref.update(inFlight, (x) => x - 1))),
    };
    const totalCalls = Effect.map(Ref.get(calls), (m) =>
      [...m.values()].reduce((a, b) => a + b, 0),
    );
    return { client, totalCalls, maxInFlight: Ref.get(maxInFlight) };
  });

/** Advances virtual time in steps until the effect finishes. Returns the virtual time it took. */
export const runUntilDone = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: { readonly step?: Duration.DurationInput } = {},
) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    const fiber = yield* Effect.fork(effect);
    while (Option.isNone(yield* Fiber.poll(fiber))) {
      if ((yield* Clock.currentTimeMillis) - start > Duration.toMillis(Duration.hours(2))) {
        return yield* Effect.dieMessage("did not finish within 2 virtual hours");
      }
      yield* TestClock.adjust(options.step ?? "1 second");
    }
    const value = yield* Fiber.join(fiber);
    return { value, elapsed: Duration.millis((yield* Clock.currentTimeMillis) - start) };
  });
