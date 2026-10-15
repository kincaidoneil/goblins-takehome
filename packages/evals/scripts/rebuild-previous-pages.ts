/**
 * Rebuilds results/extraction-previous-pages.json from the cache: the extraction runs, including
 * the reasoning-effort sweep, made against the worksheets as first rendered (commit a418f15),
 * before #14 re-rendered each template's last page. Reads the old pages and keys from git.
 *
 *   tsx scripts/rebuild-previous-pages.ts
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Extract } from "@goblins/grader";
import { Template, templates } from "@goblins/templates";
import { Effect, Either, Schema } from "effect";
import { describeError, EvalClientLive } from "../src/client.ts";
import { scoreExtraction } from "../src/extraction.ts";

const revision = "a418f15";
const show = (path: string) =>
  execFileSync("git", ["show", `${revision}:packages/templates/templates/${path}`], {
    maxBuffer: 1 << 26,
  });

const specs = [
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.8-flash",
  "openai/gpt-5.4-mini",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6-luna",
  "google/gemini-3.1-flash-lite",
  "anthropic/claude-haiku-5.5@low",
  "anthropic/claude-haiku-5.5@high",
  "openai/gpt-6-luna@low",
  "openai/gpt-6-luna@medium",
  "openai/gpt-6-luna@high",
  "google/gemini-3.8-flash@low",
  "google/gemini-3.8-flash@high",
  "google/gemini-3.5-flash-lite@high",
];
const Effort = Schema.Literal("none", "minimal", "low", "medium", "high");
const maxTokensFor: Record<string, number> = { "anthropic/claude-haiku-5.5": 32000 };

/** The old keys predate the `copyright` field, which scoring doesn't use. */
const withCopyright = (raw: unknown): unknown =>
  typeof raw === "object" && raw !== null && "source" in raw && typeof raw.source === "object"
    ? { ...raw, source: { copyright: "Not recorded at this revision", ...raw.source } }
    : raw;

const old = templates.map((t) => {
  const template = Schema.decodeUnknownSync(Template)(
    withCopyright(JSON.parse(show(`${t.id}/template.json`).toString("utf8"))),
  );
  const pages = template.files.pages.map(
    (p) => `data:image/png;base64,${show(`${t.id}/${p.image}`).toString("base64")}`,
  );
  return { template, pages };
});

const runs = specs.flatMap((spec) => old.map((o) => ({ spec, ...o })));
const results = await Effect.runPromise(
  Effect.forEach(runs, ({ spec, template, pages }) => {
    const [model = spec, effortText] = spec.split("@");
    const effort =
      effortText === undefined ? undefined : Schema.decodeUnknownSync(Effort)(effortText);
    return Extract.extractWorksheet(
      pages,
      { purpose: "extract", subjectId: `${template.id}@${effort ?? "default"}` },
      {
        model,
        maxTokens: effort === undefined ? (maxTokensFor[model] ?? 16000) : 32000,
        ...(effort === undefined ? {} : { reasoning: { effort } }),
      },
    ).pipe(
      Effect.either,
      Effect.map((r) =>
        Either.isLeft(r)
          ? {
              model: spec,
              templateId: template.id,
              ok: false as const,
              error: describeError(r.left),
            }
          : {
              model: spec,
              templateId: template.id,
              ok: true as const,
              costUsd: r.right.usage.costUsd,
              completionTokens: r.right.usage.completionTokens,
              extraction: r.right.extraction,
              score:
                r.right.extraction._tag === "Worksheet"
                  ? scoreExtraction(template, r.right.extraction.problems)
                  : null,
            },
      ),
    );
  }).pipe(Effect.provide(EvalClientLive)),
);
writeFileSync(
  new URL("../results/extraction-previous-pages.json", import.meta.url),
  `${JSON.stringify(results, null, 1)}\n`,
);
for (const r of results) if (!r.ok) console.log(`${r.model} ${r.templateId}: ${r.error}`);
console.log(
  `${results.filter((r) => r.ok).length} of ${results.length} runs rebuilt from the cache`,
);
