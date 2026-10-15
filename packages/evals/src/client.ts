/**
 * The ModelClient the evals use: every response is cached on disk by a hash of the request, and
 * every real call is appended to a spend log. A cached run costs nothing, so anyone can rebuild
 * the report from the checked-in cache. Real calls stop before the eval budget is exceeded.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Completion,
  type CompletionRequest,
  ModelClient,
  type ModelError,
  OpenRouter,
  ProviderError,
} from "@goblins/grader";
import { Config, Effect, Layer, Option, Schema } from "effect";

export const cacheDir = new URL("../cache/", import.meta.url);
const spendLog = new URL("spend.jsonl", cacheDir);

/** A cached response, with the latency and cost of the call that produced it. */
const CacheEntry = Schema.Struct({
  model: Schema.String,
  purpose: Schema.String,
  completion: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    text: Schema.String,
    usage: Schema.Struct({
      promptTokens: Schema.Number,
      completionTokens: Schema.Number,
      costUsd: Schema.Number,
    }),
  }),
  latencyMs: Schema.Number,
  at: Schema.String,
});
type CacheEntry = typeof CacheEntry.Type;

const SpendRow = Schema.Struct({
  at: Schema.String,
  purpose: Schema.String,
  model: Schema.String,
  costUsd: Schema.Number,
  ok: Schema.Boolean,
});

/**
 * The tag is call-log metadata, not part of what the model sees, so it is not in the key.
 * `EVAL_REPEAT=2` (3, ...) keys a second copy of every call, to measure run-to-run variation.
 */
export const cacheKey = (request: CompletionRequest): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        ...(process.env.EVAL_REPEAT === undefined ? {} : { repeat: process.env.EVAL_REPEAT }),
        model: request.model,
        messages: request.messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        jsonSchema: request.jsonSchema,
        reasoning: request.reasoning,
      }),
    )
    .digest("hex");

/** Responses live in one JSONL file per model, one `{ key, ...entry }` line per call. */
const responsesDir = new URL("responses/", cacheDir);
const shardPath = (model: string) =>
  new URL(`${model.replace(/[^a-z0-9.-]/gi, "_")}.jsonl`, responsesDir);
const Line = Schema.extend(CacheEntry, Schema.Struct({ key: Schema.String }));

let loaded: Map<string, CacheEntry> | undefined;
const entries = (): Map<string, CacheEntry> => {
  if (loaded !== undefined) return loaded;
  const map = new Map<string, CacheEntry>();
  if (existsSync(responsesDir)) {
    for (const file of readdirSync(responsesDir).filter((f) => f.endsWith(".jsonl"))) {
      for (const text of readFileSync(new URL(file, responsesDir), "utf8").split("\n")) {
        if (text.trim() === "") continue;
        const { key, ...entry } = Schema.decodeUnknownSync(Line)(JSON.parse(text));
        map.set(key, entry);
      }
    }
  }
  loaded = map;
  return map;
};

/** Every cached response, for exports. */
export const allCached = (): ReadonlyArray<CacheEntry> => [...entries().values()];

export const readCached = (request: CompletionRequest): Option.Option<CacheEntry> =>
  Option.fromNullable(entries().get(cacheKey(request)));

const writeCached = (key: string, entry: CacheEntry) => {
  mkdirSync(responsesDir, { recursive: true });
  appendFileSync(shardPath(entry.model), `${JSON.stringify({ key, ...entry })}\n`);
  entries().set(key, entry);
};

/** Total spend recorded by eval runs so far. */
export const spentUsd = (): number => {
  if (!existsSync(spendLog)) return 0;
  return readFileSync(spendLog, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => Schema.decodeUnknownSync(SpendRow)(JSON.parse(line)).costUsd)
    .reduce((a, b) => a + b, 0);
};

const recordSpend = (row: typeof SpendRow.Type) => {
  mkdirSync(cacheDir, { recursive: true });
  appendFileSync(spendLog, `${JSON.stringify(row)}\n`);
};

/**
 * The measured latency of each call, keyed by model, purpose and subject id, so reports use the
 * original call's latency even on a cached run. Runners give every call a unique subject id.
 */
const latencies = new Map<string, number>();
const latencyKey = (model: string, tag: CompletionRequest["tag"]) =>
  `${model}|${tag.purpose}|${tag.subjectId ?? ""}`;
export const latencyOf = (model: string, tag: CompletionRequest["tag"]): number | undefined =>
  latencies.get(latencyKey(model, tag));

/**
 * Serves from the cache. On a miss, calls OpenRouter only when `MODEL_CLIENT=openrouter`;
 * otherwise the miss fails, so a cached run can never spend by accident.
 */
export const EvalClientLive = Layer.effect(
  ModelClient,
  Effect.gen(function* () {
    const budgetUsd = yield* Config.number("EVAL_BUDGET_USD").pipe(Config.withDefault(6));
    const live = yield* Config.literal(
      "mock",
      "openrouter",
    )("MODEL_CLIENT").pipe(Config.withDefault("mock"));
    const real =
      live === "openrouter"
        ? Option.some(
            OpenRouter.make(
              {
                apiKey: yield* Config.redacted("OPENROUTER_API_KEY"),
                timeoutMs: 120_000,
                baseUrl: "https://openrouter.ai/api/v1",
                appName: "Goblins auto-grader evals",
              },
              // This client stops at its own eval budget (below), checked against the spend log.
              { check: Effect.void, add: () => Effect.void },
            ),
          )
        : Option.none();
    return {
      complete: (request: CompletionRequest) =>
        Effect.gen(function* () {
          const cached = readCached(request);
          if (Option.isSome(cached)) {
            const completion: Completion = cached.value.completion;
            latencies.set(latencyKey(request.model, request.tag), cached.value.latencyMs);
            return completion;
          }
          if (Option.isNone(real)) {
            return yield* new ProviderError({
              status: 0,
              message: "Not in the eval cache, and MODEL_CLIENT is not openrouter",
            });
          }
          const spent = spentUsd();
          if (spent >= budgetUsd) {
            return yield* new ProviderError({
              status: 402,
              message: `Eval budget reached: $${spent.toFixed(4)} of $${budgetUsd}`,
            });
          }
          const started = Date.now();
          const completion = yield* real.value.complete(request).pipe(
            Effect.tapError((error) =>
              Effect.sync(() =>
                recordSpend({
                  at: new Date().toISOString(),
                  purpose: request.tag.purpose,
                  model: request.model,
                  costUsd: error._tag === "BadResponse" ? (error.usage?.costUsd ?? 0) : 0,
                  ok: false,
                }),
              ),
            ),
          );
          const latencyMs = Date.now() - started;
          const entry: CacheEntry = {
            model: request.model,
            purpose: request.tag.purpose,
            completion,
            latencyMs,
            at: new Date().toISOString(),
          };
          writeCached(cacheKey(request), entry);
          recordSpend({
            at: entry.at,
            purpose: request.tag.purpose,
            model: request.model,
            costUsd: completion.usage.costUsd,
            ok: true,
          });
          latencies.set(latencyKey(request.model, request.tag), latencyMs);
          return completion;
        }),
    };
  }),
);

export const spendLogPath = fileURLToPath(spendLog);

export const describeError = (error: ModelError): string => {
  switch (error._tag) {
    case "RateLimited":
      return "rate limited";
    case "Timeout":
      return `timed out after ${error.afterMs} ms`;
    case "ProviderError":
      return `provider error ${error.status}: ${error.message}`;
    case "BadResponse":
      return `bad response: ${error.message}`;
    case "BudgetExceeded":
      return `spend cap reached: $${error.spentUsd.toFixed(2)} of $${error.capUsd}`;
  }
};
