/**
 * The call log: one row per model call with latency, status, tokens and cost.
 * It feeds the usage report, cost-per-grade numbers and the mock model's replay.
 */
import { Clock, Context, Effect, Layer, Ref } from "effect"
import { type CallPurpose, ModelClient, type ModelError } from "./ModelClient.ts"

export type CallStatus = "ok" | "rate_limited" | "timeout" | "provider_error" | "bad_response"

export interface CallLogEntry {
  readonly startedAt: Date
  readonly purpose: CallPurpose
  readonly modelRequested: string
  /** The model that answered; absent when the call failed before an answer. */
  readonly model?: string
  readonly subjectId?: string
  readonly loadTestRunId?: string
  readonly status: CallStatus
  /**
   * The code the provider reported: the HTTP status, or for OpenRouter's errors
   * inside a 200 body, the code in that body. Absent for timeouts.
   */
  readonly statusCode?: number
  readonly latencyMs: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly costUsd: number
  readonly providerId?: string
  readonly error?: string
}

export class CallLog extends Context.Tag("@goblins/grader/CallLog")<
  CallLog,
  {
    /** Must not fail: a broken log should cost us a row, not a grade. */
    readonly record: (entry: CallLogEntry) => Effect.Effect<void>
  }
>() {}

const statusOf: Record<ModelError["_tag"], CallStatus> = {
  RateLimited: "rate_limited",
  Timeout: "timeout",
  ProviderError: "provider_error",
  BadResponse: "bad_response",
}

const failureFields = (error: ModelError) => {
  switch (error._tag) {
    case "RateLimited":
      return { statusCode: 429, error: "rate limited" }
    case "Timeout":
      return { error: `no response after ${error.afterMs} ms` }
    case "ProviderError":
      return { statusCode: error.status, error: error.message }
    case "BadResponse":
      return {
        statusCode: 200,
        error: error.message,
        ...(error.usage === undefined ? {} : error.usage),
      }
  }
}

/**
 * Wraps a ModelClient so every call is timed and logged. Latency is measured
 * here, not reported by the client, so the mock and the real client are
 * measured the same way.
 */
export const wrap = (inner: ModelClient["Type"], log: CallLog["Type"]): ModelClient["Type"] => ({
  complete: (request) =>
    Effect.gen(function* () {
      const startedMs = yield* Clock.currentTimeMillis
      const result = yield* Effect.either(inner.complete(request))
      const latencyMs = (yield* Clock.currentTimeMillis) - startedMs
      const base = {
        startedAt: new Date(startedMs),
        purpose: request.tag.purpose,
        modelRequested: request.model,
        latencyMs,
        ...(request.tag.subjectId === undefined ? {} : { subjectId: request.tag.subjectId }),
        ...(request.tag.loadTestRunId === undefined ? {} : { loadTestRunId: request.tag.loadTestRunId }),
      }
      yield* log.record(
        result._tag === "Right"
          ? {
              ...base,
              status: "ok",
              statusCode: 200,
              model: result.right.model,
              providerId: result.right.id,
              ...result.right.usage,
            }
          : {
              ...base,
              status: statusOf[result.left._tag],
              promptTokens: 0,
              completionTokens: 0,
              costUsd: 0,
              ...failureFields(result.left),
            },
      )
      return yield* result
    }),
})

/** Replaces the provided ModelClient with one that logs every call. */
export const withCallLog = Layer.effect(
  ModelClient,
  Effect.gen(function* () {
    return wrap(yield* ModelClient, yield* CallLog)
  }),
)

/** Keeps rows in memory. For tests and for local runs without a database. */
export const inMemory = Effect.gen(function* () {
  const rows = yield* Ref.make<ReadonlyArray<CallLogEntry>>([])
  const service: CallLog["Type"] = {
    record: (entry) => Ref.update(rows, (all) => [...all, entry]),
  }
  return { service, rows: Ref.get(rows) }
})
