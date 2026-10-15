/**
 * Writes results/calls-<model>.jsonl: every real grading call the evals made with one model, in
 * the call log's shape, for the mock model's latency profile and replay.
 *
 *   tsx scripts/export-calls.ts <model>
 */
import { writeFileSync } from "node:fs";
import { allCached } from "../src/client.ts";

const model = process.argv[2];
if (model === undefined) {
  console.error("Usage: tsx scripts/export-calls.ts <model>");
  process.exit(1);
}

const rows = allCached()
  .filter((e) => e.model === model && e.purpose === "eval")
  .sort((a, b) => a.at.localeCompare(b.at))
  .map((e) =>
    JSON.stringify({
      startedAt: new Date(Date.parse(e.at) - e.latencyMs).toISOString(),
      purpose: "grade",
      modelRequested: e.model,
      model: e.completion.model,
      status: "ok",
      statusCode: 200,
      latencyMs: e.latencyMs,
      promptTokens: e.completion.usage.promptTokens,
      completionTokens: e.completion.usage.completionTokens,
      costUsd: e.completion.usage.costUsd,
      providerId: e.completion.id,
    }),
  );

const out = new URL(`../results/calls-${model.replace(/\//g, "_")}.jsonl`, import.meta.url);
writeFileSync(out, `${rows.join("\n")}\n`);
console.log(`Wrote ${rows.length} calls to ${out.pathname}`);
