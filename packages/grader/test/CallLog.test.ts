import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, TestClock } from "effect";
import * as CallLog from "../src/CallLog.ts";
import {
  type Completion,
  type CompletionRequest,
  ModelClient,
  type ModelError,
  ProviderError,
  RateLimited,
  Timeout,
} from "../src/index.ts";

const request = (model: string): CompletionRequest => ({
  model,
  messages: [{ role: "user", content: "1+1" }],
  tag: { purpose: "grade", subjectId: "sub_1", attempt: 2, loadTestRunId: "run_1" },
});

/** Answers for "good" and fails in a way picked by the model name. */
const outcome = (model: string): Effect.Effect<Completion, ModelError> => {
  switch (model) {
    case "good":
      return Effect.succeed({
        id: "gen-1",
        model: "good-v2",
        text: "2",
        usage: { promptTokens: 10, completionTokens: 2, costUsd: 0.0001 },
      });
    case "slow":
      return Effect.fail(new Timeout({ afterMs: 1500 }));
    case "embedded":
      return Effect.fail(
        new ProviderError({ status: 503, message: "upstream died", mayBeBilled: true }),
      );
    case "unsent":
      return Effect.fail(
        new ProviderError({ status: 0, message: "spend check failed", notSent: true }),
      );
    case "reset":
      return Effect.fail(new ProviderError({ status: 0, message: "connection reset" }));
    default:
      return Effect.fail(new RateLimited({ retryAfterMs: 1000 }));
  }
};

/** Takes 1.5 s per call. */
const fakeClient = Layer.succeed(ModelClient, {
  complete: (req) => Effect.zipRight(Effect.sleep("1500 millis"), outcome(req.model)),
});

const withLog = Effect.gen(function* () {
  const log = yield* CallLog.inMemory;
  const layer = CallLog.withCallLog("openrouter").pipe(
    Layer.provide(fakeClient),
    Layer.provide(Layer.succeed(CallLog.CallLog, log.service)),
  );
  return { log, layer };
});

describe("withCallLog", () => {
  it.effect("records latency, status, tokens and cost for successes and failures", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* withLog;
      yield* Effect.gen(function* () {
        const client = yield* ModelClient;
        for (const model of ["good", "limited", "slow", "reset", "embedded", "unsent"]) {
          const fiber = yield* Effect.fork(Effect.either(client.complete(request(model))));
          yield* TestClock.adjust("1500 millis");
          yield* fiber.await;
        }
      }).pipe(Effect.provide(layer));

      expect(yield* log.rows).toMatchObject([
        {
          purpose: "grade",
          subjectId: "sub_1",
          attempt: 2,
          loadTestRunId: "run_1",
          modelRequested: "good",
          model: "good-v2",
          status: "ok",
          latencyMs: 1500,
          cost: { promptTokens: 10, completionTokens: 2, costUsd: 0.0001 },
          providerId: "gen-1",
        },
        {
          modelRequested: "limited",
          status: "rate_limited",
          statusCode: 429,
          cost: { costUsd: 0 },
        },
        // These may have been billed after we stopped listening, so the cost is unknown, not zero.
        { modelRequested: "slow", status: "timeout", cost: null },
        { modelRequested: "reset", status: "provider_error", cost: null },
        { modelRequested: "embedded", status: "provider_error", statusCode: 503, cost: null },
      ]);
    }),
  );

  it.effect("records a call the caller abandons", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* withLog;
      yield* Effect.gen(function* () {
        const client = yield* ModelClient;
        const fiber = yield* Effect.fork(client.complete(request("good")));
        yield* TestClock.adjust("700 millis");
        yield* Fiber.interrupt(fiber);
      }).pipe(Effect.provide(layer));

      expect(yield* log.rows).toMatchObject([
        { modelRequested: "good", status: "interrupted", latencyMs: 700, cost: null },
      ]);
    }),
  );
});
