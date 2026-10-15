import type { modelCalls } from "@goblins/domain/schema";
import { Either, type Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type CallLogRow,
  closeIdleGaps,
  profileFromCallLog,
  recordingFromCallLog,
  rowFromExport,
  sampleUsage,
  seededRng,
} from "../src/index.ts";
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
      modelCallRow({ status: "interrupted" }),
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

  it("keeps the provider's status code when a row has one, so a 400 replays as a 400", () => {
    const profile = profileFromCallLog(
      [
        { ...modelCallRow({ status: "provider_error" }), statusCode: 400 },
        modelCallRow({ status: "provider_error" }),
      ],
      { source: "test" },
    );
    if (Either.isLeft(profile)) throw new Error("expected a profile");
    expect(profile.right.calls.map((c) => c.status).sort()).toEqual([400, undefined]);
  });

  it("samples token usage from successful calls only", () => {
    const profile = profileFromCallLog(
      [
        modelCallRow({ inputTokens: 1800, outputTokens: 200 }),
        modelCallRow({ status: "timeout", inputTokens: null, outputTokens: null }),
      ],
      { source: "test" },
    );
    if (Either.isLeft(profile)) throw new Error("expected a profile");
    const rng = seededRng(3);
    for (let i = 0; i < 50; i++) {
      expect(sampleUsage(profile.right, rng)).toEqual({
        promptTokens: 1800,
        completionTokens: 200,
      });
    }
  });

  it("imports grader CallLogEntry exports, keeping only real OpenRouter calls", () => {
    const entry = {
      startedAt: "2026-10-15T09:00:00Z",
      purpose: "grade",
      modelRequested: "google/gemini-2.5-flash",
      status: "ok",
      statusCode: 200,
      latencyMs: 4000,
      promptTokens: 1800,
      completionTokens: 200,
    };
    const rows = [
      { ...entry, providerId: "gen-123" },
      { ...entry, providerId: "mock-0-1" },
      { ...entry },
      { ...entry, providerId: "gen-456", loadTestRunId: "lt-42" },
    ].map(rowFromExport);
    const recording = recordingFromCallLog(rows, { source: "test" });
    if (Either.isLeft(recording)) throw new Error("expected a recording");
    expect(recording.right.calls).toEqual([
      expect.objectContaining({
        startedAt: Date.parse(entry.startedAt),
        latencyMs: 4000,
        status: 200,
      }),
    ]);
  });

  it("closes idle gaps over 30 s to 10 s and keeps dense stretches as they are", () => {
    const recording = recordingFromCallLog(
      [0, 2_000, 1_400_000, 1_401_000].map((t) =>
        modelCallRow({ createdAt: new Date(t + 100), latencyMs: 100 }),
      ),
      { source: "test" },
    );
    if (Either.isLeft(recording)) throw new Error("expected a recording");
    expect(closeIdleGaps(recording.right.calls).map((c) => c.startedAt)).toEqual([
      0, 2_000, 12_000, 13_000,
    ]);
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
