/**
 * What a load test costs. The grading queue is Upstash QStash, pay as you go: $1 per 100,000
 * messages, and every delivery attempt counts. Kincaid capped load tests at $25 across all runs,
 * so the runner estimates each step before sending it, stops before the ledger would cross the
 * cap, and records every charged step in `reports/ledger.json` (committed).
 *
 * The other vendors do not bill this project (see README, "What it costs").
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Schema } from "effect";
import type { ScenarioName } from "./plan.ts";

export const BUDGET_USD = 25;
export const USD_PER_MESSAGE = 1 / 100_000;

/**
 * Deliveries per submission, rounded up on purpose. Normal traffic retries about 1.2% of calls;
 * a rate-limit storm makes 70% of calls in its window retry with backoff; a 5-minute outage
 * retries every grade in the window with 2–60 s backoff, about 9 deliveries each.
 */
const DELIVERIES_PER_SUBMISSION: Record<ScenarioName, number> = {
  normal: 1.25,
  "latency-doubling": 1.25,
  replay: 1.5,
  "rate-limit-storm": 4,
  "provider-down": 6,
};

/** Re-enqueues by the sweeper, and the occasional redelivery, on top of the scenario's retries. */
const SAFETY_MARGIN = 1.2;

export const estimateMessages = (scenario: ScenarioName, submissions: number): number =>
  Math.ceil(submissions * DELIVERIES_PER_SUBMISSION[scenario] * SAFETY_MARGIN);

export const usd = (messages: number): number => messages * USD_PER_MESSAGE;

export const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`;

/** Whether the target's queue bills per message. The local stand-in's in-memory queue does not. */
export type Pricing = "qstash" | "none";

const Entry = Schema.Struct({
  runId: Schema.String,
  step: Schema.Number,
  date: Schema.String,
  target: Schema.String,
  scenario: Schema.String,
  students: Schema.Number,
  /** Submissions the server acknowledged. */
  submissions: Schema.Number,
  /** Upper estimate of QStash messages, from acknowledged submissions. */
  estimatedMessages: Schema.Number,
  estimatedUsd: Schema.Number,
});
export type LedgerEntry = typeof Entry.Type;

const Ledger = Schema.Struct({ budgetUsd: Schema.Number, entries: Schema.Array(Entry) });

export const readLedger = (path: string): ReadonlyArray<LedgerEntry> =>
  existsSync(path)
    ? Schema.decodeUnknownSync(Ledger)(JSON.parse(readFileSync(path, "utf8"))).entries
    : [];

export const spentUsd = (entries: ReadonlyArray<LedgerEntry>): number =>
  entries.reduce((sum, entry) => sum + entry.estimatedUsd, 0);

export const appendLedger = (path: string, entry: LedgerEntry) => {
  const entries = [...readLedger(path), entry];
  writeFileSync(path, `${JSON.stringify({ budgetUsd: BUDGET_USD, entries }, null, 2)}\n`);
};
