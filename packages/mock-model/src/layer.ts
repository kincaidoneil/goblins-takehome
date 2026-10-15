import {
  type Completion,
  type CompletionRequest,
  ModelClient,
  type ModelError,
  type Usage,
} from "@goblins/grader";
import { Clock, Effect, Layer, Random } from "effect";
import { DEFAULT_TIMEOUT_MS, type MockConfig } from "./config.ts";
import {
  type Failure,
  type FailureKind,
  type Fate,
  type Rng,
  seededRng,
  toModelError,
} from "./fate.ts";
import { pick, sampleFate, sampleUsage } from "./profile.ts";
import { profiles, recordings } from "./registry.ts";
import { makeReplayer } from "./replay.ts";
import { applyScenario } from "./scenario.ts";
import { type Render, renderJson, scriptedAt, scriptedFor } from "./script.ts";

export interface MockOptions {
  /** Completion text for scripted grades. Defaults to `renderJson`. */
  readonly render?: Render;
  readonly timeoutMs?: number;
  /** Seed for the mock's random draws. Defaults to a draw from Effect's `Random`. */
  readonly seed?: number;
}

/** Picks the timing and failure source for a config. */
const timingFor = (config: MockConfig): ((elapsedMs: number, rng: Rng) => Fate) => {
  switch (config._tag) {
    case "Fixed":
      return () => ({ _tag: "Succeed", latencyMs: config.latencyMs });
    case "Sampled": {
      const profile = profiles[config.profile];
      const scenario = config.scenario;
      return (elapsedMs, rng) => {
        const base = sampleFate(profile, rng);
        return scenario === undefined ? base : applyScenario(scenario, elapsedMs, base, rng);
      };
    }
    case "Replay": {
      const replayer = makeReplayer(recordings[config.recording]);
      return (elapsedMs, rng) => replayer.fateAt(elapsedMs, rng);
    }
  }
};

/** Mock calls cost nothing; token counts follow the profile so usage reports have a realistic shape. */
const usageFor = (config: MockConfig, rng: Rng): Usage => {
  switch (config._tag) {
    case "Fixed":
      return { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    case "Sampled":
      return { ...sampleUsage(profiles[config.profile], rng), costUsd: 0 };
    case "Replay": {
      const call = pick(recordings[config.recording].calls, rng);
      return {
        promptTokens: call.promptTokens,
        completionTokens: call.completionTokens,
        costUsd: 0,
      };
    }
  }
};

const capAtTimeout = (fate: Fate, timeoutMs: number): Fate =>
  fate.latencyMs > timeoutMs
    ? { _tag: "Fail", latencyMs: timeoutMs, failure: { _tag: "Timeout" } }
    : fate;

const failureOf = (kind: FailureKind): Failure => {
  switch (kind) {
    case "RateLimited":
      return { _tag: "RateLimited", retryAfterMs: 1000 };
    case "Timeout":
      return { _tag: "Timeout" };
    case "ProviderError":
      return { _tag: "ProviderError", status: 503 };
    case "BadResponse":
      return { _tag: "BadResponse" };
  }
};

/**
 * Builds a mock `ModelClient`.
 *
 * Each call: read the scripted answer from the request, draw a fate (latency
 * and failure) from the configured timing source at the time elapsed since the
 * run anchor, sleep for the latency, then fail or answer. A sampled failure
 * wins over a scripted answer; a scripted failure wins over a sampled success.
 */
export const makeMockModelClient = (config: MockConfig, options: MockOptions = {}) =>
  Effect.gen(function* () {
    const render = options.render ?? renderJson;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const anchorMs =
      config._tag === "Fixed" ? 0 : (config.anchorMs ?? (yield* Clock.currentTimeMillis));
    const rng = seededRng(options.seed ?? (yield* Random.nextInt));
    const timing = timingFor(config);
    let calls = 0;

    const complete = (request: CompletionRequest): Effect.Effect<Completion, ModelError> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const id = `mock-${anchorMs}-${++calls}`;
        const fate = capAtTimeout(timing(now - anchorMs, rng), timeoutMs);
        yield* Effect.sleep(fate.latencyMs);
        if (fate._tag === "Fail")
          return yield* Effect.fail(toModelError(fate.failure, fate.latencyMs));
        const scripted = scriptedAt(scriptedFor(request), now);
        if (scripted._tag === "Fails") {
          return yield* Effect.fail(toModelError(failureOf(scripted.error), fate.latencyMs));
        }
        return {
          id,
          model: request.model,
          text: render(scripted),
          usage: usageFor(config, rng),
        };
      });

    return ModelClient.of({ complete });
  });

/** A Layer providing the mock `ModelClient` for one config. */
export const layer = (config: MockConfig, options?: MockOptions): Layer.Layer<ModelClient> =>
  Layer.effect(ModelClient, makeMockModelClient(config, options));
