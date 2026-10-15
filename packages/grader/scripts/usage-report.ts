/**
 * Prints model spend against the PRD budget.
 *
 *   pnpm --filter @goblins/grader usage-report
 *
 * Reads OPENROUTER_API_KEY and DATABASE_URL from the environment (the repo's
 * .env.local is loaded if present). Either source may be missing; the report says so.
 * Neither read costs money: GET /api/v1/key is free.
 */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Option, Redacted, Schema } from "effect"
import type { CallPurpose } from "../src/ModelClient.ts"
import { type KeyUsage, type PurposeTotals, render } from "../src/UsageReport.ts"

/** Secrets live in .env.local at the root of the main checkout; worktrees don't have their own copy. */
const loadEnvLocal = () => {
  const mainCheckout = dirname(
    execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(),
  )
  const file = join(mainCheckout, ".env.local")
  if (existsSync(file)) process.loadEnvFile(file)
}
loadEnvLocal()

const KeyResponse = Schema.Struct({
  data: Schema.Struct({
    usage: Schema.Number,
    limit: Schema.NullOr(Schema.Number),
    limit_remaining: Schema.NullOr(Schema.Number),
  }),
})

const readKey = Effect.gen(function* () {
  const apiKey = yield* Config.redacted("OPENROUTER_API_KEY")
  const response = yield* Effect.tryPromise(() =>
    fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${Redacted.value(apiKey)}` } }),
  )
  if (!response.ok) return yield* Effect.fail(`OpenRouter answered ${response.status}`)
  const body = yield* Schema.decodeUnknown(KeyResponse)(yield* Effect.tryPromise(() => response.json()))
  return {
    usageUsd: body.data.usage,
    limitUsd: body.data.limit,
    remainingUsd: body.data.limit_remaining,
  } satisfies KeyUsage
})

const Row = Schema.Struct({
  purpose: Schema.Literal("grade", "extract", "rubric-chat", "eval", "calibration"),
  calls: Schema.NumberFromString,
  failed: Schema.NumberFromString,
  cost_usd: Schema.NumberFromString,
  mean_ok_cost_usd: Schema.NullOr(Schema.NumberFromString),
  p50_latency_ms: Schema.NullOr(Schema.Number),
  p95_latency_ms: Schema.NullOr(Schema.Number),
})

const readLog = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const raw = yield* sql`
    select purpose,
           count(*)::text as calls,
           count(*) filter (where status <> 'ok')::text as failed,
           coalesce(sum(cost_usd), 0)::text as cost_usd,
           (avg(cost_usd) filter (where status = 'ok'))::text as mean_ok_cost_usd,
           percentile_cont(0.5) within group (order by latency_ms) as p50_latency_ms,
           percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from model_call
    where load_test_run_id is null
    group by purpose
    order by purpose`
  const rows = yield* Schema.decodeUnknown(Schema.Array(Row))(raw)
  return rows.map(
    (r): PurposeTotals => ({
      purpose: r.purpose satisfies CallPurpose,
      calls: r.calls,
      failed: r.failed,
      costUsd: r.cost_usd,
      meanOkCostUsd: r.mean_ok_cost_usd,
      p50LatencyMs: r.p50_latency_ms,
      p95LatencyMs: r.p95_latency_ms,
    }),
  )
}).pipe(
  Effect.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
)

const reason = (error: unknown) =>
  typeof error === "string" ? error : error instanceof Error ? error.message : String(error)

const main = Effect.gen(function* () {
  const [log, key] = yield* Effect.all([Effect.either(readLog), Effect.either(readKey)], { concurrency: 2 })
  console.log(
    render({
      generatedAt: new Date(),
      log: Option.getRight(log),
      key: Option.getRight(key),
      ...(log._tag === "Left" ? { logError: reason(log.left) } : {}),
      ...(key._tag === "Left" ? { keyError: reason(key.left) } : {}),
    }),
  )
})

Effect.runPromise(main)
