/**
 * One HTTP call to the app, timed and recorded. Callers get the status and parsed body, or a
 * typed transport failure; they decide what a status means for their step.
 */
import { Data, Effect, Schema } from "effect";
import { type Operation, Recorder, type RequestOutcome } from "./events.ts";

/** The request got no HTTP response: connection refused or reset, DNS, or our own timeout. */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly op: Operation;
  readonly outcome: Exclude<RequestOutcome, { _tag: "Status" }>;
}> {}

/** A response whose body was not what the contract says. The app or the contract is wrong. */
export class ContractError extends Data.TaggedError("ContractError")<{
  readonly op: Operation;
  readonly status: number;
  readonly message: string;
}> {}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** Requests in flight across the whole process, for the generator health sampler. */
export const inFlight = { count: 0 };

const DEFAULT_TIMEOUT_MS = 30_000;

export const request = (
  op: Operation,
  url: string,
  init: RequestInit & { readonly timeoutMs?: number },
) =>
  Effect.gen(function* () {
    const recorder = yield* Recorder;
    const startedAt = Date.now();
    const started = performance.now();
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    inFlight.count++;
    const result = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
        return { status: response.status, headers: response.headers, text: await response.text() };
      },
      catch: (cause): Exclude<RequestOutcome, { _tag: "Status" }> =>
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? { _tag: "Timeout" }
          : { _tag: "NetworkError", message: messageOf(cause) },
    }).pipe(Effect.either, Effect.ensuring(Effect.sync(() => inFlight.count--)));
    const ms = Math.round(performance.now() - started);
    if (result._tag === "Left") {
      recorder.record({ type: "request", at: startedAt, op, ms, outcome: result.left });
      return yield* Effect.fail(new TransportError({ op, outcome: result.left }));
    }
    recorder.record({
      type: "request",
      at: startedAt,
      op,
      ms,
      outcome: { _tag: "Status", status: result.right.status },
      bytes: result.right.text.length,
    });
    return result.right satisfies HttpResponse;
  });

/** Decodes a JSON body against `schema`, or fails with a `ContractError`. */
export const decodeJson = <A, I>(
  op: Operation,
  response: HttpResponse,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, ContractError> =>
  Effect.try({
    try: () => JSON.parse(response.text) as unknown,
    catch: () =>
      new ContractError({
        op,
        status: response.status,
        message: `not JSON: ${response.text.slice(0, 200)}`,
      }),
  }).pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknown(schema)(json).pipe(
        Effect.mapError(
          (error) => new ContractError({ op, status: response.status, message: error.message }),
        ),
      ),
    ),
  );

export const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) {
    const inner = cause.cause instanceof Error ? `: ${cause.cause.message}` : "";
    return `${cause.message}${inner}`;
  }
  return String(cause);
};
