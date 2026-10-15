/**
 * The call log: one row per model call with latency, status, tokens and cost.
 * It feeds the usage report, cost-per-grade numbers and the mock model's replay.
 */
import { Clock, Context, Effect, Layer, Ref } from "effect";
import {
  type CallPurpose,
  type CompletionRequest,
  ModelClient,
  type ModelError,
} from "./ModelClient.ts";

export type CallStatus =
  | "ok"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "bad_response"
  /** The caller stopped waiting, e.g. the function shut down mid-call. */
  | "interrupted";

/** Tokens and cost, or `null` when the call may have been billed but we never saw the bill. */
export interface CallCost {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
}

export interface CallLogEntry {
  readonly startedAt: Date;
  readonly purpose: CallPurpose;
  readonly modelRequested: string;
  /** The model that answered; absent when the call failed before an answer. */
  readonly model?: string;
  readonly subjectId?: string;
  readonly attempt?: number;
  readonly loadTestRunId?: string;
  readonly status: CallStatus;
  /**
   * The code the provider reported: the HTTP status, or for OpenRouter's errors
   * inside a 200 body, the code in that body. Absent when there was no response.
   */
  readonly statusCode?: number;
  readonly latencyMs: number;
  /**
   * `null` for calls that reached the provider but never reported usage (timeouts,
   * dropped connections, interruptions). The usage report counts them separately
   * and reconciles total spend against OpenRouter's own count.
   */
  readonly cost: CallCost | null;
  readonly providerId?: string;
  readonly error?: string;
}

export class CallLog extends Context.Tag("@goblins/grader/CallLog")<
  CallLog,
  {
    /** Must not fail: a broken log should cost us a row, not a grade. */
    readonly record: (entry: CallLogEntry) => Effect.Effect<void>;
  }
>() {}

const NOT_BILLED: CallCost = { promptTokens: 0, completionTokens: 0, costUsd: 0 };

const failureFields = (
  error: ModelError,
): Pick<CallLogEntry, "status" | "statusCode" | "cost" | "error"> => {
  switch (error._tag) {
    case "RateLimited":
      return { status: "rate_limited", statusCode: 429, cost: NOT_BILLED, error: "rate limited" };
    case "Timeout":
      // The provider may have finished and billed the call after we stopped waiting.
      return { status: "timeout", cost: null, error: `no response after ${error.afterMs} ms` };
    case "ProviderError":
      return error.status === 0
        ? // The request may have reached the provider before the connection dropped.
          { status: "provider_error", cost: null, error: error.message }
        : {
            status: "provider_error",
            statusCode: error.status,
            cost: NOT_BILLED,
            error: error.message,
          };
    case "BadResponse":
      return {
        status: "bad_response",
        statusCode: 200,
        cost: error.usage ?? null,
        error: error.message,
      };
  }
};

const baseFields = (request: CompletionRequest, startedMs: number, endedMs: number) => ({
  startedAt: new Date(startedMs),
  purpose: request.tag.purpose,
  modelRequested: request.model,
  latencyMs: endedMs - startedMs,
  ...(request.tag.subjectId === undefined ? {} : { subjectId: request.tag.subjectId }),
  ...(request.tag.attempt === undefined ? {} : { attempt: request.tag.attempt }),
  ...(request.tag.loadTestRunId === undefined ? {} : { loadTestRunId: request.tag.loadTestRunId }),
});

/**
 * Wraps a ModelClient so every call is timed and logged, including calls the
 * caller abandons. Latency is measured here, not reported by the client, so the
 * mock and the real client are measured the same way.
 */
export const wrap = (inner: ModelClient["Type"], log: CallLog["Type"]): ModelClient["Type"] => ({
  complete: (request) =>
    Effect.gen(function* () {
      const startedMs = yield* Clock.currentTimeMillis;
      const result = yield* Effect.either(inner.complete(request)).pipe(
        Effect.onInterrupt(() =>
          Effect.flatMap(Clock.currentTimeMillis, (endedMs) =>
            log.record({
              ...baseFields(request, startedMs, endedMs),
              status: "interrupted",
              cost: null,
              error: "the caller stopped waiting",
            }),
          ),
        ),
      );
      const base = baseFields(request, startedMs, yield* Clock.currentTimeMillis);
      yield* log.record(
        result._tag === "Right"
          ? {
              ...base,
              status: "ok",
              statusCode: 200,
              model: result.right.model,
              providerId: result.right.id,
              cost: result.right.usage,
            }
          : { ...base, ...failureFields(result.left) },
      );
      return yield* result;
    }),
});

/** Replaces the provided ModelClient with one that logs every call. */
export const withCallLog = Layer.effect(
  ModelClient,
  Effect.gen(function* () {
    return wrap(yield* ModelClient, yield* CallLog);
  }),
);

/** Keeps rows in memory. For tests and for local runs without a database. */
export const inMemory = Effect.gen(function* () {
  const rows = yield* Ref.make<ReadonlyArray<CallLogEntry>>([]);
  const service: CallLog["Type"] = {
    record: (entry) => Ref.update(rows, (all) => [...all, entry]),
  };
  return { service, rows: Ref.get(rows) };
});
