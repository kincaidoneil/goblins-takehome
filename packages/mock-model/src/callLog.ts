/**
 * Turns call-log rows into profiles and recordings.
 *
 * PROVISIONAL: the call-log table lives in `packages/domain` and does not
 * exist yet. `CallLogRow` is the shape this package expects; adjust the field
 * mapping here when the real table lands. Rows are validated, never cast.
 */
import { Either, Schema } from "effect";
import { failureKinds } from "./fate.ts";
import type { EmpiricalProfile, LoggedCall } from "./profile.ts";
import type { Recording } from "./replay.ts";

const NonNegative = Schema.NonNegative;

export const CallLogRow = Schema.Struct({
  model: Schema.String,
  startedAt: Schema.Union(Schema.Number, Schema.String, Schema.DateFromSelf),
  latencyMs: NonNegative,
  outcome: Schema.Literal("Ok", ...failureKinds),
  httpStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  retryAfterMs: Schema.optional(Schema.NullOr(NonNegative)),
  promptTokens: NonNegative,
  completionTokens: NonNegative,
});
export type CallLogRow = typeof CallLogRow.Type;

export type CallLogError =
  | { readonly _tag: "InvalidRow"; readonly index: number; readonly message: string }
  | { readonly _tag: "NoCalls" };

const toEpochMs = (value: number | string | Date): number =>
  typeof value === "number" ? value : new Date(value).getTime();

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
    const startedAt = toEpochMs(row.startedAt);
    if (!Number.isFinite(startedAt)) {
      return Either.left({
        _tag: "InvalidRow",
        index,
        message: `unparseable startedAt: ${String(row.startedAt)}`,
      });
    }
    if (model !== undefined && row.model !== model) continue;
    calls.push({
      startedAt,
      latencyMs: row.latencyMs,
      outcome: row.outcome,
      status: row.httpStatus ?? undefined,
      retryAfterMs: row.retryAfterMs ?? undefined,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
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
