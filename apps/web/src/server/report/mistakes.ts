/**
 * Common mistakes for each weak problem: one model call per problem, cached in
 * `report_mistake_groups` under a hash of the missed grades it was made from. A report opened
 * again, or a share link opened by many people, reuses the row; a grade that resolves or is
 * rescored changes the hash, and the next view makes one new call.
 *
 * Any failure (the call, the answer's shape, the cache) leaves that problem out, and the page
 * falls back to grouping by rubric line.
 */
import { createHash } from "node:crypto";
import { Db, schema } from "@goblins/domain";
import { ModelClient } from "@goblins/grader";
import { and, eq } from "drizzle-orm";
import { Config, Duration, Effect, JSONSchema, Option, Schema } from "effect";
import {
  fromModel,
  groupingPrompt,
  ModelGrouping,
  type ProblemMistakes,
} from "../../report/mistakes";
import type { ClassReport, ProblemStats } from "../../report/model";

/** A small, cheap model: the task is sorting a dozen one-line reasons into a few groups. */
const ReportModel = Config.string("REPORT_MODEL").pipe(
  Config.withDefault("google/gemini-2.5-flash-lite"),
);

const inputHash = (stats: ProblemStats): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        stats.misses
          .map((m) => [m.student.id, m.points, m.reason] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest("base64url");

const decodeAnswer = Schema.decodeUnknown(Schema.parseJson(ModelGrouping));
const decodeCached = Schema.decodeUnknown(ModelGrouping);

const askModel = (stats: ProblemStats) =>
  Effect.gen(function* () {
    const client = yield* ModelClient;
    const model = yield* ReportModel;
    const completion = yield* client.complete({
      model,
      messages: [
        {
          role: "system",
          content: "You help math teachers read class results. Answer only with JSON.",
        },
        { role: "user", content: groupingPrompt(stats) },
      ],
      tag: { purpose: "report", subjectId: stats.problem.id },
      maxTokens: 800,
      temperature: 0,
      jsonSchema: { name: "mistake_groups", schema: JSONSchema.make(ModelGrouping) },
    });
    return { grouping: yield* decodeAnswer(completion.text), model: completion.model };
  }).pipe(Effect.timeout(Duration.seconds(20)));

const groupProblem = (sessionId: string, stats: ProblemStats) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const hash = inputHash(stats);
    const key = and(
      eq(schema.reportMistakeGroups.sessionId, sessionId),
      eq(schema.reportMistakeGroups.problemId, stats.problem.id),
      eq(schema.reportMistakeGroups.inputHash, hash),
    );
    const [cached] = yield* db
      .select({
        skill: schema.reportMistakeGroups.skill,
        groups: schema.reportMistakeGroups.groups,
      })
      .from(schema.reportMistakeGroups)
      .where(key);
    if (cached !== undefined) return fromModel(stats, yield* decodeCached(cached));

    const { grouping, model } = yield* askModel(stats);
    yield* db
      .insert(schema.reportMistakeGroups)
      .values({
        sessionId,
        problemId: stats.problem.id,
        inputHash: hash,
        skill: grouping.skill,
        groups: grouping.groups,
        model,
      })
      .onConflictDoNothing();
    return fromModel(stats, grouping);
  }).pipe(
    Effect.map(Option.some),
    Effect.catchAll((error) =>
      Effect.logWarning("report: mistake grouping failed; using the rubric fallback", error).pipe(
        Effect.as(Option.none<ProblemMistakes>()),
      ),
    ),
  );

/** Groupings for the report's weak problems. Problems whose grouping failed are left out. */
export const mistakesFor = (sessionId: string, report: ClassReport) =>
  Effect.forEach(report.weak, (stats) => groupProblem(sessionId, stats), {
    concurrency: "unbounded",
  }).pipe(Effect.map((results) => results.flatMap(Option.toArray)));
