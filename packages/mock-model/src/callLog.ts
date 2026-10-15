/**
 * Turns rows of the domain `model_calls` table into profiles and recordings.
 *
 * `CallLogRow` validates the columns this package reads, as Drizzle returns
 * them (camelCase; `createdAt` a Date, or an ISO string from a JSON export).
 * `test/callLog.test.ts` checks at compile time that a `model_calls` row still
 * fits it. The table has no HTTP status or Retry-After column, so a
 * `provider_error` replays as a 502 and a 429 carries no retry hint.
 */
import { Either, Schema } from "effect";
import type { FailureKind } from "./fate.ts";
import type { EmpiricalProfile, LoggedCall } from "./profile.ts";
import type { Recording } from "./replay.ts";

const Count = Schema.NullOr(Schema.NonNegative);

const statusToOutcome = {
  ok: "Ok",
  rate_limited: "RateLimited",
  timeout: "Timeout",
  provider_error: "ProviderError",
  bad_response: "BadResponse",
} as const satisfies Record<string, "Ok" | FailureKind>;

export const CallLogRow = Schema.Struct({
  purpose: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  status: Schema.Literal("ok", "rate_limited", "timeout", "provider_error", "bad_response"),
  latencyMs: Schema.NonNegative,
  inputTokens: Count,
  outputTokens: Count,
  loadTestRunId: Schema.NullOr(Schema.String),
  createdAt: Schema.Union(Schema.DateFromSelf, Schema.String),
});
export type CallLogRow = typeof CallLogRow.Type;

export type CallLogError =
  | { readonly _tag: "InvalidRow"; readonly index: number; readonly message: string }
  | { readonly _tag: "NoCalls" };

const toEpochMs = (value: string | Date): number =>
  typeof value === "string" ? new Date(value).getTime() : value.getTime();

/**
 * Only real grading calls describe the provider: app grades and eval runs
 * (the same grading prompt, run offline), not the mock's own rows, other
 * purposes or load-test traffic.
 */
const isRealGradeCall = (row: CallLogRow): boolean =>
  row.provider === "openrouter" &&
  (row.purpose === "grade" || row.purpose === "eval") &&
  row.loadTestRunId === null;

const decodeRow = Schema.decodeUnknownEither(CallLogRow);

const toLoggedCalls = (
  rows: ReadonlyArray<unknown>,
  model: string | undefined,
): Either.Either<readonly [LoggedCall, ...Array<LoggedCall>], CallLogError> => {
  const calls: Array<LoggedCall> = [];
  for (const [index, raw] of rows.entries()) {
    const decoded = decodeRow(raw);
    if (Either.isLeft(decoded)) {
      return Either.left({ _tag: "InvalidRow", index, message: decoded.left.message });
    }
    const row = decoded.right;
    // `createdAt` is when the row was written, about `latencyMs` after the call
    // started. Replay only uses offsets between calls, so the shift cancels out.
    const startedAt = toEpochMs(row.createdAt) - row.latencyMs;
    if (!Number.isFinite(startedAt)) {
      return Either.left({
        _tag: "InvalidRow",
        index,
        message: `unparseable createdAt: ${String(row.createdAt)}`,
      });
    }
    if (!isRealGradeCall(row) || (model !== undefined && row.model !== model)) continue;
    calls.push({
      startedAt,
      latencyMs: row.latencyMs,
      outcome: statusToOutcome[row.status],
      status: undefined,
      retryAfterMs: undefined,
      promptTokens: row.inputTokens ?? 0,
      completionTokens: row.outputTokens ?? 0,
    });
  }
  calls.sort((a, b) => a.startedAt - b.startedAt);
  const [head, ...tail] = calls;
  return head === undefined ? Either.left({ _tag: "NoCalls" }) : Either.right([head, ...tail]);
};

/** An empirical profile from logged calls, optionally limited to one model. */
export const profileFromCallLog = (
  rows: ReadonlyArray<unknown>,
  options: { readonly source: string; readonly model?: string },
): Either.Either<EmpiricalProfile, CallLogError> =>
  Either.map(toLoggedCalls(rows, options.model), (calls) => ({
    _tag: "Empirical",
    source: options.source,
    calls,
  }));

/** A replayable recording from the logged calls in a window, optionally limited to one model. */
export const recordingFromCallLog = (
  rows: ReadonlyArray<unknown>,
  options: { readonly source: string; readonly model?: string },
): Either.Either<Recording, CallLogError> =>
  Either.map(toLoggedCalls(rows, options.model), (calls) => ({ source: options.source, calls }));
