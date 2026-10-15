/**
 * Choosing between the real model and the mock, and configuring the mock.
 *
 * The same compact syntax configures the mock from the `MOCK_MODEL` env var
 * and from the load-test request header:
 *
 *   mode=fixed; latency=500
 *   mode=sampled; profile=seed; scenario=provider-down; at=60; for=300; start=1760000000000; run=lt-42
 *   mode=replay; recording=seed-window; start=1760000000000; run=lt-42
 *
 * `latency` is milliseconds. `at` and `for` are seconds after `start` (epoch
 * milliseconds), and override the scenario's default window. Without `start`,
 * the run is anchored when the mock is built. The load test should always send
 * `start` so every serverless instance shares one timeline.
 */
import { Either, Schema } from "effect";
import type { ProfileName, RecordingName } from "./registry.ts";
import { profileNames, recordingNames } from "./registry.ts";
import { type Scenario, scenarioDefaults, scenarioNames } from "./scenario.ts";

/** Header that routes a request to the mock model and tags its data as load-test data. */
export const LOAD_TEST_HEADER = "x-goblins-load-test";

/** Calls whose latency would exceed this fail with `Timeout` instead. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export type MockConfig =
  | { readonly _tag: "Fixed"; readonly latencyMs: number }
  | {
      readonly _tag: "Sampled";
      readonly profile: ProfileName;
      readonly scenario: Scenario | undefined;
      readonly anchorMs: number | undefined;
    }
  | {
      readonly _tag: "Replay";
      readonly recording: RecordingName;
      readonly anchorMs: number | undefined;
    };

export type ModelSelection =
  | { readonly _tag: "Real" }
  | {
      readonly _tag: "Mock";
      readonly config: MockConfig;
      /** Load-test run id from the header, for tagging data. Undefined when the mock was chosen by env. */
      readonly runId: string | undefined;
    };

export interface ConfigError {
  readonly _tag: "ConfigError";
  readonly source: "header" | "env";
  readonly message: string;
}

const NonNegative = Schema.compose(Schema.NumberFromString, Schema.NonNegative);
const optional = Schema.optional;

const Spec = Schema.Union(
  Schema.Struct({
    mode: Schema.Literal("fixed"),
    latency: optional(NonNegative),
    run: optional(Schema.String),
  }),
  Schema.Struct({
    mode: Schema.Literal("sampled"),
    profile: optional(Schema.Literal(...profileNames)),
    scenario: optional(Schema.Literal(...scenarioNames)),
    at: optional(NonNegative),
    for: optional(NonNegative),
    start: optional(NonNegative),
    run: optional(Schema.String),
  }),
  Schema.Struct({
    mode: Schema.Literal("replay"),
    recording: optional(Schema.Literal(...recordingNames)),
    start: optional(NonNegative),
    run: optional(Schema.String),
  }),
);
type Spec = typeof Spec.Type;

const decodeSpec = Schema.decodeUnknownEither(Spec, { onExcessProperty: "error" });

const splitPairs = (raw: string): Either.Either<Record<string, string>, string> => {
  const pairs: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return Either.left(`expected key=value, got "${trimmed}"`);
    const key = trimmed.slice(0, eq).trim();
    if (key in pairs) return Either.left(`duplicate key "${key}"`);
    pairs[key] = trimmed.slice(eq + 1).trim();
  }
  return Either.right(pairs);
};

const toSelection = (spec: Spec): { config: MockConfig; runId: string | undefined } => {
  switch (spec.mode) {
    case "fixed":
      return { config: { _tag: "Fixed", latencyMs: spec.latency ?? 0 }, runId: spec.run };
    case "sampled": {
      const name = spec.scenario;
      const scenario: Scenario | undefined =
        name === undefined
          ? undefined
          : {
              name,
              startMs: spec.at === undefined ? scenarioDefaults[name].startMs : spec.at * 1000,
              durationMs:
                spec.for === undefined ? scenarioDefaults[name].durationMs : spec.for * 1000,
            };
      return {
        config: {
          _tag: "Sampled",
          profile: spec.profile ?? "seed",
          scenario,
          anchorMs: spec.start,
        },
        runId: spec.run,
      };
    }
    case "replay":
      return {
        config: {
          _tag: "Replay",
          recording: spec.recording ?? "seed-window",
          anchorMs: spec.start,
        },
        runId: spec.run,
      };
  }
};

export const parseMockSpec = (
  raw: string,
  source: ConfigError["source"],
): Either.Either<{ config: MockConfig; runId: string | undefined }, ConfigError> => {
  const pairs = splitPairs(raw);
  if (Either.isLeft(pairs))
    return Either.left({ _tag: "ConfigError", source, message: pairs.left });
  const spec = decodeSpec(pairs.right);
  if (Either.isLeft(spec)) {
    return Either.left({ _tag: "ConfigError", source, message: spec.left.message });
  }
  return Either.right(toSelection(spec.right));
};

/**
 * Decides which model client serves a call.
 *
 * 1. A load-test header always selects the mock it describes, so tagged
 *    traffic never reaches the paid model, even in production.
 * 2. Otherwise `MODEL_CLIENT=real` selects the real model. This is the only
 *    way to spend money; development, tests and CI never set it.
 * 3. Otherwise the mock, configured by `MOCK_MODEL` (default `mode=fixed`).
 *
 * The grading consumer runs outside the request, so the web app stores the
 * header value with the submission and passes it here when grading.
 */
export const selectModel = (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly loadTestHeader: string | undefined;
}): Either.Either<ModelSelection, ConfigError> => {
  if (input.loadTestHeader !== undefined) {
    return Either.map(parseMockSpec(input.loadTestHeader, "header"), ({ config, runId }) => ({
      _tag: "Mock",
      config,
      runId,
    }));
  }
  const client = input.env.MODEL_CLIENT ?? "mock";
  if (client === "real") return Either.right({ _tag: "Real" });
  if (client !== "mock") {
    return Either.left({
      _tag: "ConfigError",
      source: "env",
      message: `MODEL_CLIENT must be "real" or "mock", got "${client}"`,
    });
  }
  return Either.map(parseMockSpec(input.env.MOCK_MODEL ?? "mode=fixed", "env"), ({ config }) => ({
    _tag: "Mock",
    config,
    runId: undefined,
  }));
};
