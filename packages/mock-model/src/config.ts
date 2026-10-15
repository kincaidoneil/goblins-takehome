/**
 * Choosing between the real model and the mock, and configuring the mock.
 *
 * A mock spec uses one compact syntax, from the `MOCK_MODEL` env var or, for
 * an authorized load test, the `x-goblins-mock-model` header:
 *
 *   mode=fixed; latency=500
 *   mode=sampled; profile=seed; scenario=provider-down; at=60; for=300; start=1760000000000
 *   mode=replay; recording=seed-window; start=1760000000000
 *
 * `latency` is milliseconds. `at` and `for` are seconds after `start` (epoch
 * milliseconds), and override the scenario's default window. Without `start`,
 * the run is anchored when the mock is built. The load test should always send
 * `start` so every serverless instance shares one timeline.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { Either, Schema } from "effect";
import type { ProfileName, RecordingName } from "./registry.ts";
import { DEFAULT_PROFILE, DEFAULT_RECORDING, profileNames, recordingNames } from "./registry.ts";
import { type Scenario, scenarioDefaults, scenarioNames } from "./scenario.ts";

/** `<LOAD_TEST_TOKEN>:<runId>`. Marks a request as load-test traffic. */
export const LOAD_TEST_HEADER = "x-goblins-load-test";

/** Mock spec for an authorized load-test request. Ignored without a valid token. */
export const MOCK_SPEC_HEADER = "x-goblins-mock-model";

/** Mock spec for load-test requests that send no `x-goblins-mock-model` header. */
export const DEFAULT_LOAD_TEST_SPEC = `mode=sampled; profile=${DEFAULT_PROFILE}`;

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
      /** Load-test run id, for tagging data. Undefined when the mock was chosen by env. */
      readonly runId: string | undefined;
    };

export interface ConfigError {
  readonly _tag: "ConfigError";
  readonly source: "header" | "env";
  readonly message: string;
}

/** An authorized load-test request: what the web app stores with the submission for the grader. */
export interface LoadTestRun {
  readonly runId: string;
  /** Mock spec, validated by `authorizeLoadTest`. */
  readonly spec: string;
}

const NonNegative = Schema.compose(Schema.NumberFromString, Schema.NonNegative);
const optional = Schema.optional;

const Spec = Schema.Union(
  Schema.Struct({
    mode: Schema.Literal("fixed"),
    latency: optional(NonNegative),
  }),
  Schema.Struct({
    mode: Schema.Literal("sampled"),
    profile: optional(Schema.Literal(...profileNames)),
    scenario: optional(Schema.Literal(...scenarioNames)),
    at: optional(NonNegative),
    for: optional(NonNegative),
    start: optional(NonNegative),
  }),
  Schema.Struct({
    mode: Schema.Literal("replay"),
    recording: optional(Schema.Literal(...recordingNames)),
    start: optional(NonNegative),
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

const toConfig = (spec: Spec): MockConfig => {
  switch (spec.mode) {
    case "fixed":
      return { _tag: "Fixed", latencyMs: spec.latency ?? 0 };
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
        _tag: "Sampled",
        profile: spec.profile ?? DEFAULT_PROFILE,
        scenario,
        anchorMs: spec.start,
      };
    }
    case "replay":
      return {
        _tag: "Replay",
        recording: spec.recording ?? DEFAULT_RECORDING,
        anchorMs: spec.start,
      };
  }
};

export const parseMockSpec = (
  raw: string,
  source: ConfigError["source"],
): Either.Either<MockConfig, ConfigError> => {
  const pairs = splitPairs(raw);
  if (Either.isLeft(pairs)) {
    return Either.left({ _tag: "ConfigError", source, message: pairs.left });
  }
  const spec = decodeSpec(pairs.right);
  if (Either.isLeft(spec)) {
    return Either.left({ _tag: "ConfigError", source, message: spec.left.message });
  }
  const decoded = spec.right;
  if (
    decoded.mode === "sampled" &&
    decoded.scenario === undefined &&
    (decoded.at !== undefined || decoded.for !== undefined)
  ) {
    // A window without a scenario would be dropped, and the run would look configured when it isn't.
    return Either.left({
      _tag: "ConfigError",
      source,
      message: "`at` and `for` need a `scenario`",
    });
  }
  const timed =
    (decoded.mode === "sampled" && decoded.scenario !== undefined) || decoded.mode === "replay";
  if (source === "header" && timed && decoded.start === undefined) {
    // Each serverless instance would otherwise start its own timeline when it is built.
    return Either.left({
      _tag: "ConfigError",
      source,
      message: "a load test with a scenario or replay needs `start`, shared by every instance",
    });
  }
  return Either.right(toConfig(decoded));
};

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Compares secrets in constant time, whatever their lengths. */
const sameSecret = (a: string, b: string): boolean =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/**
 * Checks a request's load-test headers. Call it in the request handler.
 *
 * Returns the run when `x-goblins-load-test` is `<LOAD_TEST_TOKEN>:<runId>`.
 * A missing or wrong token, or an unset `LOAD_TEST_TOKEN`, returns undefined:
 * the request is ordinary traffic and takes the normal model path. A valid
 * token with an invalid mock spec is an error, so the load test fails loudly.
 */
export const authorizeLoadTest = (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly loadTestHeader: string | undefined;
  readonly mockSpecHeader: string | undefined;
}): Either.Either<LoadTestRun | undefined, ConfigError> => {
  const expected = input.env.LOAD_TEST_TOKEN;
  const header = input.loadTestHeader;
  if (expected === undefined || expected === "" || header === undefined) {
    return Either.right(undefined);
  }
  const colon = header.lastIndexOf(":");
  const token = header.slice(0, Math.max(colon, 0));
  const runId = header.slice(colon + 1);
  if (colon <= 0 || !sameSecret(token, expected) || !RUN_ID.test(runId)) {
    return Either.right(undefined);
  }
  const spec = input.mockSpecHeader ?? DEFAULT_LOAD_TEST_SPEC;
  return Either.map(parseMockSpec(spec, "header"), () => ({ runId, spec }));
};

/**
 * Decides which model client serves a call. Call it where grading runs.
 *
 * 1. An authorized load-test run (from `authorizeLoadTest`, stored with the
 *    submission) always gets the mock it asked for, so tagged traffic never
 *    reaches the paid model.
 * 2. Otherwise `MODEL_CLIENT=openrouter` selects the real model. This is the
 *    only way to spend money; development, tests and CI never set it.
 * 3. Otherwise the mock, configured by `MOCK_MODEL` (default `mode=fixed`).
 */
export const selectModel = (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly loadTest: LoadTestRun | undefined;
}): Either.Either<ModelSelection, ConfigError> => {
  const run = input.loadTest;
  if (run !== undefined) {
    return Either.map(parseMockSpec(run.spec, "header"), (config) => ({
      _tag: "Mock",
      config,
      runId: run.runId,
    }));
  }
  const client = input.env.MODEL_CLIENT ?? "mock";
  if (client === "openrouter") return Either.right({ _tag: "Real" });
  if (client !== "mock") {
    return Either.left({
      _tag: "ConfigError",
      source: "env",
      message: `MODEL_CLIENT must be "openrouter" or "mock", got "${client}"`,
    });
  }
  return Either.map(parseMockSpec(input.env.MOCK_MODEL ?? "mode=fixed", "env"), (config) => ({
    _tag: "Mock",
    config,
    runId: undefined,
  }));
};
