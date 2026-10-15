/**
 * Runs extraction on every template with each model and writes results/extraction.json.
 *
 *   node scripts/eval-extraction.ts <model>[@<effort>] ...
 *
 * `@low` etc. sets the reasoning effort; without it the model's default applies.
 *
 * Served from the cache unless MODEL_CLIENT=openrouter; see src/client.ts.
 */
import { writeFileSync } from "node:fs";
import { Extract } from "@goblins/grader";
import { templates } from "@goblins/templates";
import { Effect, Either } from "effect";
import { describeError, EvalClientLive, latencyOf, spentUsd } from "../src/client.ts";
import { pageDataUrls, scoreExtraction } from "../src/extraction.ts";

const modelIds = process.argv.slice(2);
if (modelIds.length === 0) {
  console.error("Usage: node scripts/eval-extraction.ts <model> [<model> ...]");
  process.exit(1);
}

/** Models that write long answer keys and need more room than the default. */
const maxTokensFor: Record<string, number> = { "anthropic/claude-haiku-5.5": 32000 };

const Effort = ["none", "minimal", "low", "medium", "high"] as const;
type Effort = (typeof Effort)[number];
const isEffort = (s: string): s is Effort => (Effort as ReadonlyArray<string>).includes(s);

const specs = modelIds.map((spec) => {
  const [model = spec, effort] = spec.split("@");
  if (effort !== undefined && !isEffort(effort)) {
    console.error(`Unknown effort ${effort}`);
    process.exit(1);
  }
  return { spec, model, effort };
});

const runs = specs.flatMap((s) => templates.map((template) => ({ ...s, template })));

const program = Effect.forEach(
  runs,
  ({ spec, model, effort, template }) =>
    Extract.extractWorksheet(
      pageDataUrls(template),
      { purpose: "extract", subjectId: `${template.id}@${effort ?? "default"}` },
      {
        model,
        maxTokens: effort === undefined ? (maxTokensFor[model] ?? 16000) : 32000,
        ...(effort === undefined ? {} : { reasoning: { effort } }),
      },
    ).pipe(
      Effect.either,
      Effect.map((result) => {
        if (Either.isLeft(result)) {
          return {
            model: spec,
            templateId: template.id,
            ok: false as const,
            error: describeError(result.left),
          };
        }
        const { extraction, usage } = result.right;
        return {
          model: spec,
          templateId: template.id,
          ok: true as const,
          costUsd: usage.costUsd,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          latencyMs:
            latencyOf(model, {
              purpose: "extract",
              subjectId: `${template.id}@${effort ?? "default"}`,
            }) ?? null,
          extraction,
          score:
            extraction._tag === "Worksheet" ? scoreExtraction(template, extraction.problems) : null,
        };
      }),
    ),
  { concurrency: 4 },
);

const results = await Effect.runPromise(program.pipe(Effect.provide(EvalClientLive)));
writeFileSync(
  new URL("../results/extraction.json", import.meta.url),
  `${JSON.stringify(results, null, 1)}\n`,
);
for (const r of results) {
  if (!r.ok) {
    console.log(`${r.model} ${r.templateId} FAILED ${r.error}`);
    continue;
  }
  const s = r.score;
  const found = s === null ? 0 : s.items.filter((i) => i.found).length;
  const sim = s === null ? 0 : s.items.reduce((a, i) => a + i.textSimilarity, 0) / s.items.length;
  console.log(
    `${r.model} ${r.templateId} found ${found}/${s?.goldCount ?? "?"} extra ${s?.extraLabels.join(",") || "-"} text ${sim.toFixed(3)} deps ${s?.dependencies.correct}/${s?.dependencies.gold} (found ${s?.dependencies.found}) $${r.costUsd.toFixed(4)}`,
  );
}
console.log(`Eval spend so far: $${spentUsd().toFixed(4)}`);
