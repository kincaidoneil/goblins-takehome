/**
 * Latency and error profiles for realistic mode.
 *
 * A profile is either parametric (a log-normal latency fit plus error rates,
 * used until real calls exist) or empirical (a list of logged real calls,
 * resampled uniformly so latency and outcome stay paired as they were observed).
 */
import type { Failure, FailureKind, Fate, Rng } from "./fate.ts";

export interface ParametricProfile {
  readonly _tag: "Parametric";
  /** Where the numbers came from, shown in load-test reports. */
  readonly source: string;
  readonly latency: { readonly medianMs: number; readonly p95Ms: number };
  /** Probability per call of each failure that is not a timeout. Must sum to less than 1. */
  readonly errorRates: {
    readonly RateLimited: number;
    readonly ProviderError: number;
    readonly BadResponse: number;
  };
  readonly tokens: { readonly prompt: number; readonly completion: number };
}

/** One logged model call, reduced to the fields the mock needs. */
export interface LoggedCall {
  /** Epoch milliseconds when the call started. Used by replay. */
  readonly startedAt: number;
  readonly latencyMs: number;
  readonly outcome: "Ok" | FailureKind;
  /** HTTP status for `ProviderError`. */
  readonly status: number | undefined;
  /** Retry-After for `RateLimited`, when the provider sent one. */
  readonly retryAfterMs: number | undefined;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface EmpiricalProfile {
  readonly _tag: "Empirical";
  readonly source: string;
  readonly calls: readonly [LoggedCall, ...Array<LoggedCall>];
}

export type Profile = ParametricProfile | EmpiricalProfile;

/** z-score of the 95th percentile of a standard normal. */
const Z95 = 1.6448536269514722;

/** Standard normal sample by Box-Muller. */
const normal = (rng: Rng): number => {
  // 1 - rng() is in (0, 1], so the log is finite.
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** Log-normal latency with the given median and 95th percentile. */
export const sampleLogNormal = (rng: Rng, medianMs: number, p95Ms: number): number => {
  const sigma = Math.log(p95Ms / medianMs) / Z95;
  return Math.round(medianMs * Math.exp(sigma * normal(rng)));
};

export const failureOfCall = (call: LoggedCall): Failure | undefined => {
  switch (call.outcome) {
    case "Ok":
      return undefined;
    case "RateLimited":
      return { _tag: "RateLimited", retryAfterMs: call.retryAfterMs };
    case "Timeout":
      return { _tag: "Timeout" };
    case "ProviderError":
      return { _tag: "ProviderError", status: call.status ?? 502 };
    case "BadResponse":
      return { _tag: "BadResponse" };
  }
};

export const fateOfCall = (call: LoggedCall): Fate => {
  const failure = failureOfCall(call);
  return failure === undefined
    ? { _tag: "Succeed", latencyMs: call.latencyMs }
    : { _tag: "Fail", latencyMs: call.latencyMs, failure };
};

const sampleParametric = (profile: ParametricProfile, rng: Rng): Fate => {
  // Timeouts are not sampled here: the mock turns any latency past its timeout into one.
  const latencyMs = sampleLogNormal(rng, profile.latency.medianMs, profile.latency.p95Ms);
  const { RateLimited, ProviderError } = profile.errorRates;
  const u = rng();
  // Rate limits and provider errors come back fast; the provider rejects before generating.
  const fastMs = Math.min(latencyMs, 300 + Math.round(rng() * 700));
  if (u < RateLimited) {
    return {
      _tag: "Fail",
      latencyMs: fastMs,
      failure: { _tag: "RateLimited", retryAfterMs: 1000 + Math.round(rng() * 4000) },
    };
  }
  if (u < RateLimited + ProviderError) {
    return {
      _tag: "Fail",
      latencyMs: fastMs,
      failure: { _tag: "ProviderError", status: rng() < 0.5 ? 502 : 503 },
    };
  }
  if (u < RateLimited + ProviderError + profile.errorRates.BadResponse) {
    return { _tag: "Fail", latencyMs, failure: { _tag: "BadResponse" } };
  }
  return { _tag: "Succeed", latencyMs };
};

export const sampleFate = (profile: Profile, rng: Rng): Fate => {
  switch (profile._tag) {
    case "Parametric":
      return sampleParametric(profile, rng);
    case "Empirical":
      return fateOfCall(pick(profile.calls, rng));
  }
};

export const sampleUsage = (
  profile: Profile,
  rng: Rng,
): { promptTokens: number; completionTokens: number } => {
  switch (profile._tag) {
    case "Parametric":
      return { promptTokens: profile.tokens.prompt, completionTokens: profile.tokens.completion };
    case "Empirical": {
      const call = pick(profile.calls, rng);
      return { promptTokens: call.promptTokens, completionTokens: call.completionTokens };
    }
  }
};

export const pick = <A>(items: readonly [A, ...Array<A>], rng: Rng): A =>
  items[Math.floor(rng() * items.length)] ?? items[0];
