import { describe, expect, it } from "@effect/vitest"
import { Duration } from "effect"
import { BadResponse, ProviderError, RateLimited, Timeout } from "../src/ModelClient.ts"
import { backoff, decide } from "../src/RetryPolicy.ts"

const seconds = (d: Duration.Duration) => Duration.toSeconds(d)

describe("RetryPolicy", () => {
  it("backs off 2 s, 4 s, 8 s ... up to 60 s, with jitter within ±20%", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => seconds(backoff(n, 0.5)))).toEqual([2, 4, 8, 16, 32, 60, 60, 60])
    expect(seconds(backoff(1, 0))).toBe(1.6)
    expect(seconds(backoff(6, 0.999))).toBeCloseTo(72, 0)
  })

  it("retries transient errors until the grade has waited 15 minutes", () => {
    const at = (minutes: number) =>
      decide({ error: new Timeout({ afterMs: 45_000 }), deliveryCount: 9, age: Duration.minutes(minutes), random: 0.5 })
    expect(at(14.9)._tag).toBe("Retry")
    expect(at(15)._tag).toBe("GiveUp")
  })

  it("waits at least as long as the provider's Retry-After", () => {
    const decision = decide({
      error: new RateLimited({ retryAfterMs: 30_000 }),
      deliveryCount: 1,
      age: Duration.zero,
      random: 0.5,
    })
    expect(decision).toEqual({ _tag: "Retry", after: Duration.millis(30_000) })
  })

  it("gives up at once on errors retrying cannot fix", () => {
    const giveUp = (error: ProviderError | BadResponse) =>
      decide({ error, deliveryCount: 1, age: Duration.zero, random: 0.5 })._tag
    expect(giveUp(new ProviderError({ status: 400, message: "bad request" }))).toBe("GiveUp")
    expect(giveUp(new ProviderError({ status: 402, message: "no credits" }))).toBe("GiveUp")
    expect(giveUp(new BadResponse({ message: "cut off" }))).toBe("GiveUp")
    expect(giveUp(new ProviderError({ status: 503, message: "down" }))).toBe("Retry")
  })
})
