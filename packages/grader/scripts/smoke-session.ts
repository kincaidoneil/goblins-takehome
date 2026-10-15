/**
 * Seeds one live class session for a production smoke test of real grading: a
 * teacher, a one-problem assignment with a two-line rubric, and a join code. Not
 * tagged as a load test, so its grades go to the configured (real) model.
 * Prints the join code. With `--report <joinCode>`, prints that session's grades
 * and their model calls instead.
 *
 *   DATABASE_URL=... pnpm --filter @goblins/grader exec tsx scripts/smoke-session.ts
 */
import { DatabaseLive, Db, randomJoinCode, schema } from "@goblins/domain";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

const seed = Effect.gen(function* () {
  const db = yield* Db;
  const [teacher] = yield* db
    .insert(schema.teachers)
    .values({ clerkUserId: `smoke:${crypto.randomUUID()}`, name: "Grader smoke test" })
    .returning();
  if (teacher === undefined) return yield* Effect.dieMessage("no teacher row");
  const [assignment] = yield* db
    .insert(schema.assignments)
    .values({ teacherId: teacher.id, title: "Grader smoke test", extractionStatus: "ready" })
    .returning();
  if (assignment === undefined) return yield* Effect.dieMessage("no assignment row");
  const [problem] = yield* db
    .insert(schema.problems)
    .values({
      assignmentId: assignment.id,
      position: 0,
      label: "1",
      text: "Solve for x: 2x + 3 = 11",
      answerKey: "x = 4",
    })
    .returning();
  if (problem === undefined) return yield* Effect.dieMessage("no problem row");
  yield* db.insert(schema.rubricLines).values([
    {
      problemId: problem.id,
      position: 0,
      points: 1,
      description: "Subtracts 3 from both sides: 2x = 8",
    },
    { problemId: problem.id, position: 1, points: 1, description: "Correct answer: x = 4" },
  ]);
  const joinCode = randomJoinCode();
  yield* db.insert(schema.classSessions).values({
    assignmentId: assignment.id,
    teacherId: teacher.id,
    joinCode,
    status: "live",
    startedAt: new Date(),
  });
  console.log(JSON.stringify({ joinCode, assignmentId: assignment.id }));
});

const report = (joinCode: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const sessions = yield* db
      .select({ id: schema.classSessions.id })
      .from(schema.classSessions)
      .where(eq(schema.classSessions.joinCode, joinCode));
    const grades = yield* db
      .select()
      .from(schema.grades)
      .where(
        inArray(
          schema.grades.sessionId,
          sessions.map((s) => s.id),
        ),
      );
    const calls =
      grades.length === 0
        ? []
        : yield* db
            .select()
            .from(schema.modelCalls)
            .where(
              inArray(
                schema.modelCalls.submissionId,
                grades.map((g) => g.submissionId),
              ),
            );
    console.log(JSON.stringify({ grades, calls }, null, 2));
  });

const [flag, code] = process.argv.slice(2);
await Effect.runPromise(
  (flag === "--report" && code !== undefined ? report(code) : seed).pipe(
    Effect.provide(DatabaseLive),
    Effect.orDie,
  ),
);
process.exit(0);
