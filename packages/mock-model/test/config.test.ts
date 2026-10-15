import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { authorizeLoadTest, selectModel } from "../src/index.ts";

const env = { LOAD_TEST_TOKEN: "s3cret", MODEL_CLIENT: "openrouter" };

describe("authorizeLoadTest", () => {
  it("accepts <token>:<runId> and defaults to sampled mode", () => {
    expect(
      authorizeLoadTest({ env, loadTestHeader: "s3cret:lt-42", mockSpecHeader: undefined }),
    ).toEqual(Either.right({ runId: "lt-42", spec: "mode=sampled; profile=seed" }));
  });

  it.each([
    ["wrong token", "nope:lt-42"],
    ["no token", "lt-42"],
    ["empty token", ":lt-42"],
    ["bad run id", "s3cret:lt 42!"],
  ])("treats a %s as ordinary traffic", (_, header) => {
    expect(authorizeLoadTest({ env, loadTestHeader: header, mockSpecHeader: undefined })).toEqual(
      Either.right(undefined),
    );
  });

  it("treats every header as ordinary traffic when LOAD_TEST_TOKEN is unset", () => {
    expect(
      authorizeLoadTest({ env: {}, loadTestHeader: ":lt-42", mockSpecHeader: undefined }),
    ).toEqual(Either.right(undefined));
  });

  it("ignores the mock spec header without a valid token", () => {
    expect(
      authorizeLoadTest({ env, loadTestHeader: undefined, mockSpecHeader: "mode=fixed" }),
    ).toEqual(Either.right(undefined));
  });

  it("rejects an invalid mock spec when the token is valid", () => {
    expect(
      authorizeLoadTest({ env, loadTestHeader: "s3cret:lt-42", mockSpecHeader: "mode=chaos" }),
    ).toMatchObject({ left: { _tag: "ConfigError", source: "header" } });
  });
});

describe("selectModel", () => {
  it("defaults to the fixed mock, so nothing spends money unless asked", () => {
    expect(selectModel({ env: {}, loadTest: undefined })).toMatchObject({
      right: { _tag: "Mock", config: { _tag: "Fixed", latencyMs: 0 } },
    });
  });

  it("uses the real model only with MODEL_CLIENT=openrouter and no load-test run", () => {
    expect(selectModel({ env, loadTest: undefined })).toMatchObject({ right: { _tag: "Real" } });
  });

  it("routes an authorized load-test run to its mock even in production", () => {
    const run = authorizeLoadTest({
      env,
      loadTestHeader: "s3cret:lt-42",
      mockSpecHeader: "mode=sampled; scenario=provider-down; at=60; for=300; start=1760000000000",
    });
    if (Either.isLeft(run)) throw new Error("expected an authorized run");
    expect(selectModel({ env, loadTest: run.right })).toMatchObject({
      right: {
        _tag: "Mock",
        runId: "lt-42",
        config: {
          _tag: "Sampled",
          profile: "seed",
          anchorMs: 1_760_000_000_000,
          scenario: { name: "provider-down", startMs: 60_000, durationMs: 300_000 },
        },
      },
    });
  });

  it("reads MOCK_MODEL from env", () => {
    expect(selectModel({ env: { MOCK_MODEL: "mode=replay" }, loadTest: undefined })).toMatchObject({
      right: { _tag: "Mock", config: { _tag: "Replay", recording: "seed-window" } },
    });
  });

  it.each([
    ["mode=sampled; scenario=meteor"],
    ["mode=sampled; at=60; for=300"],
    ["mode=fixed; latency=-5"],
    ["mode=fixed; colour=blue"],
    ["mode=fixed; mode=fixed"],
    ["garbage"],
    [""],
  ])("rejects an invalid MOCK_MODEL: %s", (spec) => {
    expect(selectModel({ env: { MOCK_MODEL: spec }, loadTest: undefined })).toMatchObject({
      left: { _tag: "ConfigError", source: "env" },
    });
  });

  it("rejects an unknown MODEL_CLIENT", () => {
    expect(selectModel({ env: { MODEL_CLIENT: "openai" }, loadTest: undefined })).toMatchObject({
      left: { _tag: "ConfigError", source: "env" },
    });
  });
});
