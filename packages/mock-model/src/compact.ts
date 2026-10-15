/**
 * Compact form for logged calls bundled with the package. A generated module
 * under `src/data/` holds one tuple per call, and `expandCalls` turns them
 * back into `LoggedCall`s. Typecheck validates the generated data.
 */
import type { LoggedCall } from "./profile.ts";

/** [ms after the first call, latency ms, outcome, HTTP status or null, prompt tokens, completion tokens] */
export type CompactCall = readonly [
  offsetMs: number,
  latencyMs: number,
  outcome: LoggedCall["outcome"],
  statusCode: number | null,
  promptTokens: number,
  completionTokens: number,
];

const expand = (t0: number, call: CompactCall): LoggedCall => ({
  startedAt: t0 + call[0],
  latencyMs: call[1],
  outcome: call[2],
  status: call[3] ?? undefined,
  retryAfterMs: undefined,
  promptTokens: call[4],
  completionTokens: call[5],
});

export const expandCalls = (
  t0: number,
  [head, ...tail]: readonly [CompactCall, ...Array<CompactCall>],
): readonly [LoggedCall, ...Array<LoggedCall>] => [
  expand(t0, head),
  ...tail.map((call) => expand(t0, call)),
];

export const compactCall = (t0: number, call: LoggedCall): CompactCall => [
  call.startedAt - t0,
  call.latencyMs,
  call.outcome,
  call.status ?? null,
  call.promptTokens,
  call.completionTokens,
];
