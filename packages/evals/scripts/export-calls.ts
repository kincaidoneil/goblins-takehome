/**
 * Writes results/calls-<model>.jsonl: every real grading call the evals made with one model, one
 * object per call in the `model_calls` row shape, for the mock model's latency profile and replay.
 *
 *   pnpm eval:export-calls <model>
 *
 * Successful calls come from the response cache, with their measured latency. Failed calls are in
 * the spend log without a latency, so they are left out and counted on stdout.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Schema } from "effect";
import { allCached, cacheDir } from "../src/client.ts";

const model = process.argv[2];
if (model === undefined) {
  console.error("Usage: pnpm eval:export-calls <model>");
  process.exit(1);
}

const rows = allCached()
  .filter((e) => e.model === model && e.purpose === "eval")
  .sort((a, b) => a.at.localeCompare(b.at))
  .map((e) =>
    JSON.stringify({
      purpose: "eval",
      provider: "openrouter",
      model: e.model,
      modelAnswered: e.completion.model,
      status: "ok",
      statusCode: 200,
      providerId: e.completion.id,
      latencyMs: e.latencyMs,
      inputTokens: e.completion.usage.promptTokens,
      outputTokens: e.completion.usage.completionTokens,
      costUsd: e.completion.usage.costUsd,
      loadTestRunId: null,
      createdAt: e.at,
    }),
  );

const SpendRow = Schema.Struct({
  model: Schema.String,
  purpose: Schema.String,
  ok: Schema.Boolean,
});
const spendLog = new URL("spend.jsonl", cacheDir);
const dropped = existsSync(spendLog)
  ? readFileSync(spendLog, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => Schema.decodeUnknownSync(SpendRow)(JSON.parse(line)))
      .filter((r) => r.model === model && r.purpose === "eval" && !r.ok).length
  : 0;

const out = new URL(`../results/calls-${model.replace(/\//g, "_")}.jsonl`, import.meta.url);
writeFileSync(out, `${rows.join("\n")}\n`);
console.log(
  `Wrote ${rows.length} calls to ${out.pathname}; left out ${dropped} failed calls with no recorded latency`,
);
