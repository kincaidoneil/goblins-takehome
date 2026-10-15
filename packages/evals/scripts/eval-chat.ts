/**
 * Runs every chat-editing case with each model and writes results/chat/<spec>.json.
 *
 *   node scripts/eval-chat.ts <model>[@<effort>] ...
 *
 * Served from the cache unless MODEL_CLIENT=openrouter; see src/client.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Chat } from "@goblins/grader";
import { getTemplate } from "@goblins/templates";
import { Effect, Either, Option } from "effect";
import { chatCases, startingSetup } from "../src/chat.ts";
import { describeError, EvalClientLive, spentUsd } from "../src/client.ts";
import { pageDataUrls } from "../src/extraction.ts";

const Effort = ["none", "minimal", "low", "medium", "high"] as const;
type Effort = (typeof Effort)[number];
const isEffort = (s: string): s is Effort => (Effort as ReadonlyArray<string>).includes(s);

const specs = process.argv.slice(2).map((spec) => {
  const [model = spec, effort] = spec.split("@");
  if (effort !== undefined && !isEffort(effort)) {
    console.error(`Unknown effort ${effort}`);
    process.exit(1);
  }
  return { spec, model, effort };
});

const runs = specs.flatMap((s) => chatCases.map((c) => ({ ...s, c })));

const results = await Effect.runPromise(
  Effect.forEach(
    runs,
    ({ spec, model, effort, c }) => {
      const template = Option.getOrThrow(getTemplate(c.templateId));
      const before = (c.prepare ?? ((p) => p))(startingSetup(c.templateId));
      return Chat.chatEdit(
        {
          problems: before,
          pageImageUrls: pageDataUrls(template),
          history: [],
          message: c.message,
        },
        { purpose: "rubric-chat", subjectId: `${spec}|${c.id}` },
        { model, maxTokens: 16000, ...(effort === undefined ? {} : { reasoning: { effort } }) },
      ).pipe(
        Effect.either,
        Effect.map((result) => {
          if (Either.isLeft(result)) {
            return {
              spec,
              caseId: c.id,
              ok: false,
              problems: [describeError(result.left)],
              costUsd: 0,
            };
          }
          const { edits, reply, usage } = result.right;
          const applied = Chat.applyEdits(before, edits);
          const problems = Either.isLeft(applied)
            ? [`edits did not apply: ${JSON.stringify(applied.left)}`]
            : c.check(before, applied.right, edits);
          return {
            spec,
            caseId: c.id,
            ok: problems.length === 0,
            problems,
            reply,
            edits,
            costUsd: usage.costUsd,
          };
        }),
      );
    },
    { concurrency: 6 },
  ).pipe(Effect.provide(EvalClientLive)),
);

const repeat = process.env.EVAL_REPEAT;
mkdirSync(new URL("../results/chat/", import.meta.url), { recursive: true });
for (const { spec } of specs) {
  const name = `${spec.replace(/[/@+]/g, "_")}${repeat === undefined ? "" : `.repeat-${repeat}`}`;
  writeFileSync(
    new URL(`../results/chat/${name}.json`, import.meta.url),
    `${JSON.stringify(
      results.filter((r) => r.spec === spec),
      null,
      1,
    )}
`,
  );
}
for (const { spec } of specs) {
  const mine = results.filter((r) => r.spec === spec);
  const cost = mine.reduce((sum, r) => sum + r.costUsd, 0) / mine.length;
  console.log(
    `${spec}: ${mine.filter((r) => r.ok).length}/${mine.length} passed, $${cost.toFixed(4)} per message`,
  );
  for (const r of mine.filter((x) => !x.ok)) console.log(`  ${r.caseId}: ${r.problems.join("; ")}`);
}
console.log(`Eval spend so far: $${spentUsd().toFixed(4)}`);
