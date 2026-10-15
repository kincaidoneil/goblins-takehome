import type { modelCalls } from "@goblins/domain/schema";
import { Either, type Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type CallLogRow, profileFromCallLog, recordingFromCallLog } from "../src/index.ts";
import { modelCallRow } from "./helpers.ts";

describe("call log import", () => {
  it("decodes every column it reads from a model_calls row (checked by typecheck)", () => {
    expectTypeOf<typeof modelCalls.$inferSelect>().toExtend<
      Schema.Schema.Encoded<typeof CallLogRow>
    >();
  });

  it("maps statuses and tokens, and dates calls by when they started", () => {
    const created = new Date("2026-10-15T09:00:04Z");
    const profile = profileFromCallLog(
      [
        modelCallRow({ createdAt: created, latencyMs: 4000 }),
        modelCallRow({ status: "rate_limited", inputTokens: null, outputTokens: null }),
        modelCallRow({ status: "timeout" }),
        modelCallRow({ status: "provider_error" }),
        modelCallRow({ status: "bad_response" }),
      ],
      { source: "test" },
    );
    if (Either.isLeft(profile)) throw new Error("expected a profile");
    const calls = profile.right.calls;
    expect(calls.map((c) => c.outcome).sort()).toEqual(
      ["BadResponse", "Ok", "ProviderError", "RateLimited", "Timeout"].sort(),
    );
    expect(calls.find((c) => c.latencyMs === 4000)?.startedAt).toBe(
      Date.parse("2026-10-15T09:00:00Z"),
    );
    expect(calls.find((c) => c.outcome === "RateLimited")).toMatchObject({
      promptTokens: 0,
      completionTokens: 0,
    });
  });

  it("uses only real grading calls: not mock rows, other purposes, load tests or other models", () => {
    const rows = [
      modelCallRow(),
      modelCallRow({ purpose: "eval" }),
      modelCallRow({ provider: "mock" }),
      modelCallRow({ purpose: "extract" }),
      modelCallRow({ loadTestRunId: "lt-42" }),
      modelCallRow({ model: "openai/gpt-5-mini" }),
    ];
    const recording = recordingFromCallLog(rows, {
      source: "test",
      model: "google/gemini-2.5-flash",
    });
    expect(Either.isRight(recording) && recording.right.calls.length).toBe(2);
  });

  it("accepts createdAt as an ISO string from a JSON export", () => {
    const row: Record<string, unknown> = { ...modelCallRow(), createdAt: "2026-10-15T09:00:00Z" };
    expect(Either.isRight(profileFromCallLog([row], { source: "test" }))).toBe(true);
  });

  it("rejects invalid rows with their index, and reports when nothing is left", () => {
    const bad = profileFromCallLog([modelCallRow(), { model: "a", latencyMs: -1 }], {
      source: "test",
    });
    expect(Either.isLeft(bad) && bad.left).toMatchObject({ _tag: "InvalidRow", index: 1 });
    expect(
      profileFromCallLog([modelCallRow({ provider: "mock" })], { source: "test" }),
    ).toMatchObject({
      left: { _tag: "NoCalls" },
    });
  });
});
