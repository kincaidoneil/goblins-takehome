import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  BadResponse,
  type CompletionRequest,
  isRetryable,
  ModelClient,
  ProviderError,
  RateLimited,
  Timeout,
} from "../src/index.ts";

const request: CompletionRequest = {
  model: "test/model",
  messages: [
    { role: "system", content: "Grade the work." },
    {
      role: "user",
      content: [
        { type: "text", text: "Problem 1" },
        { type: "image", url: "data:image/png;base64,AAAA" },
      ],
    },
  ],
  tag: { purpose: "grade", subjectId: "grade_1" },
};

describe("ModelClient", () => {
  it.effect("a Layer can provide the service", () =>
    Effect.gen(function* () {
      const client = yield* ModelClient;
      const completion = yield* client.complete(request);
      expect(completion.text).toBe("ok");
    }).pipe(
      Effect.provide(
        Layer.succeed(ModelClient, {
          complete: (req) =>
            Effect.succeed({
              id: "gen_1",
              model: req.model,
              text: "ok",
              usage: { promptTokens: 10, completionTokens: 1, costUsd: 0 },
            }),
        }),
      ),
    ),
  );

  it("classifies retryable errors", () => {
    expect(isRetryable(new RateLimited({}))).toBe(true);
    expect(isRetryable(new Timeout({ afterMs: 30_000 }))).toBe(true);
    expect(isRetryable(new BadResponse({ message: "empty" }))).toBe(true);
    expect(isRetryable(new ProviderError({ status: 502, message: "bad gateway" }))).toBe(true);
    expect(isRetryable(new ProviderError({ status: 0, message: "connection reset" }))).toBe(true);
    expect(isRetryable(new ProviderError({ status: 402, message: "out of credits" }))).toBe(false);
    expect(isRetryable(new ProviderError({ status: 400, message: "bad model" }))).toBe(false);
  });
});
