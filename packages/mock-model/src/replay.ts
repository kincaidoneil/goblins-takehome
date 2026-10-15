/**
 * Replay of a recorded window of model calls.
 *
 * A call made `t` ms into the run takes its latency and outcome from a recorded
 * call made at about `t` ms into the recording: one picked at random from the
 * recorded calls in the same time bucket, or the nearest recorded call when the
 * bucket is empty. This keeps the recording's shape over time (a burst of 429s
 * at minute 3 shows up at minute 3) at whatever call rate the load test drives.
 * Runs longer than the recording loop over it.
 */

import type { Fate, Rng } from "./fate.ts";
import { fateOfCall, type LoggedCall, pick } from "./profile.ts";

export interface Recording {
  readonly source: string;
  /** Sorted by `startedAt`. */
  readonly calls: readonly [LoggedCall, ...Array<LoggedCall>];
}

export const BUCKET_MS = 10_000;

/** Index of the first call whose offset is at least `offset`, or `offsets.length`. */
const lowerBound = (offsets: ReadonlyArray<number>, offset: number): number => {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((offsets[mid] ?? Infinity) < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export interface Replayer {
  readonly lengthMs: number;
  readonly fateAt: (elapsedMs: number, rng: Rng) => Fate;
  readonly callAt: (elapsedMs: number, rng: Rng) => LoggedCall;
}

export const makeReplayer = (recording: Recording): Replayer => {
  const calls = [...recording.calls].sort((a, b) => a.startedAt - b.startedAt);
  const first = recording.calls[0];
  const t0 = calls[0]?.startedAt ?? first.startedAt;
  const offsets = calls.map((call) => call.startedAt - t0);
  const lengthMs = (offsets[offsets.length - 1] ?? 0) + BUCKET_MS;

  const callAt = (elapsedMs: number, rng: Rng): LoggedCall => {
    const t = ((elapsedMs % lengthMs) + lengthMs) % lengthMs;
    const bucketStart = t - (t % BUCKET_MS);
    const from = lowerBound(offsets, bucketStart);
    const to = lowerBound(offsets, bucketStart + BUCKET_MS);
    const inBucket = calls.slice(from, to);
    const [head, ...tail] = inBucket;
    if (head !== undefined) return pick([head, ...tail], rng);
    // Empty bucket: take the nearer neighbour.
    const after = calls[from];
    const before = calls[from - 1];
    if (after === undefined) return before ?? first;
    if (before === undefined) return after;
    return t - (before.startedAt - t0) <= after.startedAt - t0 - t ? before : after;
  };

  return { lengthMs, callAt, fateAt: (elapsedMs, rng) => fateOfCall(callAt(elapsedMs, rng)) };
};
