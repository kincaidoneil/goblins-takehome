import { describe, expect, it } from "vitest";
import { selectModel } from "../src/index.ts";

describe("selectModel", () => {
  it("defaults to the fixed mock, so nothing spends money unless asked", () => {
    expect(selectModel({ env: {}, loadTestHeader: undefined })).toMatchObject({
      right: { _tag: "Mock", config: { _tag: "Fixed", latencyMs: 0 } },
    });
  });

  it("uses the real model only when MODEL_CLIENT=real and no load-test header", () => {
    expect(selectModel({ env: { MODEL_CLIENT: "real" }, loadTestHeader: undefined })).toMatchObject(
      {
        right: { _tag: "Real" },
      },
    );
  });

  it("routes a load-test header to the mock even in production", () => {
    const selection = selectModel({
      env: { MODEL_CLIENT: "real" },
      loadTestHeader:
        "mode=sampled; scenario=provider-down; at=60; for=300; start=1760000000000; run=lt-42",
    });
    expect(selection).toMatchObject({
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
    expect(
      selectModel({ env: { MOCK_MODEL: "mode=replay" }, loadTestHeader: undefined }),
    ).toMatchObject({
      right: {
        _tag: "Mock",
        config: { _tag: "Replay", recording: "seed-window", anchorMs: undefined },
      },
    });
  });

  it.each([
    ["mode=sampled; scenario=meteor"],
    ["mode=fixed; latency=-5"],
    ["mode=fixed; colour=blue"],
    ["mode=fixed; mode=fixed"],
    ["garbage"],
    [""],
  ])("rejects an invalid header: %s", (header) => {
    expect(selectModel({ env: {}, loadTestHeader: header })).toMatchObject({
      left: { _tag: "ConfigError", source: "header" },
    });
  });

  it("rejects an unknown MODEL_CLIENT", () => {
    expect(
      selectModel({ env: { MODEL_CLIENT: "openai" }, loadTestHeader: undefined }),
    ).toMatchObject({
      left: { _tag: "ConfigError", source: "env" },
    });
  });
});
