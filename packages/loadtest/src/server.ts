/**
 * Load-test-only server routes: per-submission pipeline timestamps, database load, and deleting a
 * run's data. Every route requires the load-test token. They let anyone with the token measure
 * and clean up a deploy without database credentials.
 *
 *   GET  /api/load-test/runs/:runId/timings  -> { grades: GradeTiming[] }
 *   GET  /api/load-test/db                   -> DbSample (without `at`)
 *   POST /api/load-test/runs/:runId/cleanup  -> { deleted: Record<string, number> }
 */

import { loadTestHeaders, type Target } from "@goblins/simulator";
import { decodeJson, request } from "@goblins/simulator/http";
import { Effect, Schema } from "effect";

export const GradeTiming = Schema.Struct({
  submissionId: Schema.String,
  state: Schema.String,
  attempt: Schema.Number,
  /** When the server stored the submission. */
  createdAt: Schema.String,
  /** When a consumer claimed the current attempt. Null while queued. */
  claimedAt: Schema.NullOr(Schema.String),
  /** When the pipeline recorded the current attempt's outcome. */
  outcomeAt: Schema.NullOr(Schema.String),
});
export type GradeTiming = typeof GradeTiming.Type;

const Timings = Schema.Struct({ grades: Schema.Array(GradeTiming) });

export const DbStats = Schema.Struct({
  connections: Schema.Number,
  active: Schema.Number,
  idleInTransaction: Schema.Number,
  waitingOnLock: Schema.Number,
  maxConnections: Schema.Number,
  xactCommit: Schema.Number,
  xactRollback: Schema.Number,
  deadlocks: Schema.Number,
});
export type DbSample = typeof DbStats.Type & { readonly at: number };

const Cleanup = Schema.Struct({
  deleted: Schema.Record({ key: Schema.String, value: Schema.Number }),
});

export const fetchTimings = (target: Target) =>
  Effect.gen(function* () {
    const response = yield* request(
      "stats",
      `${target.baseUrl}/api/load-test/runs/${target.runId}/timings`,
      { headers: loadTestHeaders(target), timeoutMs: 120_000 },
    );
    if (response.status !== 200) return yield* Effect.fail(`timings: HTTP ${response.status}`);
    return (yield* decodeJson("stats", response, Timings)).grades;
  });

export const fetchDbStats = (target: Target) =>
  Effect.gen(function* () {
    const at = Date.now();
    const response = yield* request("stats", `${target.baseUrl}/api/load-test/db`, {
      headers: loadTestHeaders(target),
      timeoutMs: 10_000,
    });
    if (response.status !== 200) return yield* Effect.fail(`db stats: HTTP ${response.status}`);
    const stats = yield* decodeJson("stats", response, DbStats);
    return { ...stats, at } satisfies DbSample;
  });

export const cleanup = (target: Target) =>
  Effect.gen(function* () {
    const response = yield* request(
      "cleanup",
      `${target.baseUrl}/api/load-test/runs/${target.runId}/cleanup`,
      { method: "POST", headers: loadTestHeaders(target), timeoutMs: 120_000 },
    );
    if (response.status !== 200) return yield* Effect.fail(`cleanup: HTTP ${response.status}`);
    return (yield* decodeJson("cleanup", response, Cleanup)).deleted;
  });
