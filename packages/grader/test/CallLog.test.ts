import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, TestClock } from "effect"
import * as CallLog from "../src/CallLog.ts"
import { type CompletionRequest, ModelClient, RateLimited } from "../src/index.ts"

const request = (model: string): CompletionRequest => ({
  model,
  messages: [{ role: "user", content: "1+1" }],
  tag: { purpose: "grade", subjectId: "grade_1", loadTestRunId: "run_1" },
})

/** Takes 1.5 s, then answers for "good" and rate-limits everything else. */
const fakeClient = Layer.succeed(ModelClient, {
  complete: (req) =>
    Effect.sleep("1500 millis").pipe(
      Effect.zipRight(
        req.model === "good"
          ? Effect.succeed({
              id: "gen-1",
              model: "good-v2",
              text: "2",
              usage: { promptTokens: 10, completionTokens: 2, costUsd: 0.0001 },
            })
          : Effect.fail(new RateLimited({ retryAfterMs: 1000 })),
      ),
    ),
})

describe("withCallLog", () => {
  it.effect("records latency, status, tokens and cost for successes and failures", () =>
    Effect.gen(function* () {
      const log = yield* CallLog.inMemory
      const layer = CallLog.withCallLog.pipe(
        Layer.provide(fakeClient),
        Layer.provide(Layer.succeed(CallLog.CallLog, log.service)),
      )
      yield* Effect.gen(function* () {
        const client = yield* ModelClient
        for (const model of ["good", "bad"]) {
          const fiber = yield* Effect.fork(Effect.either(client.complete(request(model))))
          yield* TestClock.adjust("1500 millis")
          yield* fiber.await
        }
      }).pipe(Effect.provide(layer))

      const rows = yield* log.rows
      expect(rows).toMatchObject([
        {
          purpose: "grade",
          subjectId: "grade_1",
          loadTestRunId: "run_1",
          modelRequested: "good",
          model: "good-v2",
          status: "ok",
          latencyMs: 1500,
          promptTokens: 10,
          completionTokens: 2,
          costUsd: 0.0001,
          providerId: "gen-1",
        },
        { modelRequested: "bad", status: "rate_limited", statusCode: 429, latencyMs: 1500, costUsd: 0 },
      ])
    }),
  )
})
