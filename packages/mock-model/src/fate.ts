/**
 * A fate is what one mocked call does to the caller: how long it takes and
 * whether it fails. Content (what a successful call says) is decided separately
 * by the script, so every timing source can be combined with every script.
 */
import { BadResponse, type ModelError, ProviderError, RateLimited, Timeout } from "@goblins/grader";

export type Failure =
  | { readonly _tag: "RateLimited"; readonly retryAfterMs: number | undefined }
  | { readonly _tag: "Timeout" }
  | { readonly _tag: "ProviderError"; readonly status: number }
  | { readonly _tag: "BadResponse" };

export type FailureKind = Failure["_tag"];

export const failureKinds = [
  "RateLimited",
  "Timeout",
  "ProviderError",
  "BadResponse",
] as const satisfies ReadonlyArray<FailureKind>;

export type Fate =
  | { readonly _tag: "Succeed"; readonly latencyMs: number }
  | { readonly _tag: "Fail"; readonly latencyMs: number; readonly failure: Failure };

/** Uniform random number in [0, 1). Pure sampling code takes this so tests can seed it. */
export type Rng = () => number;

export const toModelError = (failure: Failure, latencyMs: number): ModelError => {
  switch (failure._tag) {
    case "RateLimited":
      return failure.retryAfterMs === undefined
        ? new RateLimited({})
        : new RateLimited({ retryAfterMs: failure.retryAfterMs });
    case "Timeout":
      return new Timeout({ afterMs: latencyMs });
    case "ProviderError":
      return new ProviderError({
        status: failure.status,
        message: `mock: provider returned ${failure.status}`,
      });
    case "BadResponse":
      return new BadResponse({ message: "mock: unparseable provider response" });
  }
};

/**
 * Small deterministic PRNG (mulberry32). The mock seeds one per client from
 * Effect's `Random`, so tests can fix the seed and production gets a fresh one.
 */
export const seededRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
