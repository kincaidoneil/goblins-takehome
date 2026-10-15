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
import { Mistakes, Models } from "@goblins/grader";
import { and, eq } from "drizzle-orm";
import { Duration, Effect, Option, Schema } from "effect";
import { fromModel, ModelGrouping, type ProblemMistakes } from "../../report/mistakes";
import type { ClassReport, ProblemStats } from "../../report/model";

const inputHash = (stats: ProblemStats): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        stats.misses
          .map((m) => [m.student.id, m.points, m.reason, m.lostLines.map((l) => l.id)] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest("base64url");

const decodeGrouping = Schema.decodeUnknown(ModelGrouping);

/**
 * AI quality's grouping call (`Mistakes.groupMistakes`, Claude Haiku): the mistakes and the skill
 * the problem practices, which titles the problem and names the Goblins practice.
 */
const askModel = (sessionId: string, stats: ProblemStats) =>
  Effect.gen(function* () {
    const result = yield* Mistakes.groupMistakes(
      {
        problem: {
          label: stats.problem.label,
          text: stats.problem.text,
          rubric: stats.problem.rubricLines,
        },
        grades: stats.misses.map((m) => ({
          studentId: m.student.id,
          points: m.points,
          maxPoints: m.maxPoints,
          reason: m.reason ?? "No reason recorded.",
          lostLineIds: m.lostLines.map((l) => l.id),
        })),
      },
      { purpose: "report", subjectId: sessionId },
    );
    const grouping = yield* decodeGrouping({
      skill: result.skill,
      groups: result.mistakes.map((m) => ({ description: m.mistake, studentIds: m.studentIds })),
    });
    return { grouping, model: Models.models.mistakes.model };
  }).pipe(Effect.timeout(Duration.seconds(45)));

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
    if (cached !== undefined) return fromModel(stats, yield* decodeGrouping(cached));

    const { grouping, model } = yield* askModel(sessionId, stats);
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
