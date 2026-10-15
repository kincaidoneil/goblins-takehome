/**
 * Test data the app cannot make yet through its own screens. Until assignment setup lands, this
 * creates the launched session directly through the domain package against `DATABASE_URL`.
 * Submissions go in the same way, carrying the mock model's fixture whiteboards; the app's own
 * grading queue then grades them (see `sweep` in the spec).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Db, databaseLayer, type SqlClient, schema, submitWork } from "@goblins/domain";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

const databaseUrl = process.env.DATABASE_URL;

/** Whether this run can reach the database (local runs). Previews need the setup flow instead. */
export const canSeed = databaseUrl !== undefined;

const run = <A, E>(effect: Effect.Effect<A, E, Db | SqlClient>): Promise<A> => {
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is not set");
  return Effect.runPromise(
    effect.pipe(Effect.provide(databaseLayer({ url: databaseUrl, maxConnections: 2 }))),
  );
};

/** The teacher every request is in `AUTH_MODE=local` (apps/web/src/server/teacher.ts). */
const LOCAL_TEACHER = "local_teacher";

export interface SeededSession {
  readonly sessionId: string;
  readonly joinCode: string;
  readonly problems: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

/** A launched session in the lobby: three problems worth 2 points each. */
export const seedSession = () =>
  run(
    Effect.gen(function* () {
      const db = yield* Db;
      const [teacher] = yield* db
        .insert(schema.teachers)
        .values({ clerkUserId: LOCAL_TEACHER, name: "Ms. Rivera" })
        .onConflictDoUpdate({
          target: schema.teachers.clerkUserId,
          set: { hideNamesAndScores: false },
        })
        .returning();
      if (teacher === undefined) return yield* Effect.die("no teacher");
      const [assignment] = yield* db
        .insert(schema.assignments)
        .values({ teacherId: teacher.id, title: "Linear equations", extractionStatus: "ready" })
        .returning();
      if (assignment === undefined) return yield* Effect.die("no assignment");
      const worksheet = [
        { label: "1", text: "Solve \\(2x + 3 = 11\\).", answerKey: "\\(x = 4\\)" },
        { label: "2", text: "Solve \\(5x - 7 = 3x + 9\\).", answerKey: "\\(x = 8\\)" },
        { label: "3", text: "Solve \\(3(x - 4) = 12\\).", answerKey: "\\(x = 8\\)" },
      ];
      const problems: Array<SeededSession["problems"][number]> = [];
      for (const [position, { label, text, answerKey }] of worksheet.entries()) {
        const [problem] = yield* db
          .insert(schema.problems)
          .values({ assignmentId: assignment.id, position, label, text, answerKey })
          .returning();
        if (problem === undefined) return yield* Effect.die("no problem");
        yield* db.insert(schema.rubricLines).values([
          { problemId: problem.id, position: 0, points: 1, description: "Correct setup" },
          { problemId: problem.id, position: 1, points: 1, description: "Correct answer" },
        ]);
        problems.push({ id: problem.id, label });
      }
      // Six digits that are unlikely to collide with another open session.
      const joinCode = String(100000 + Math.floor(Math.random() * 900000));
      const [session] = yield* db
        .insert(schema.classSessions)
        .values({
          assignmentId: assignment.id,
          teacherId: teacher.id,
          joinCode,
          timeLimitMinutes: 20,
        })
        .returning();
      if (session === undefined) return yield* Effect.die("no session");
      return { sessionId: session.id, joinCode, problems } satisfies SeededSession;
    }),
  );

/** A whiteboard from `packages/mock-model/fixtures`, as a data URL the mock recognizes by hash. */
export type Fixture = "correct" | "partial" | "wrong" | "illegible" | "fails-once";

const fixtureUrl = async (fixture: Fixture) => {
  const path = fileURLToPath(
    new URL(`../../packages/mock-model/fixtures/${fixture}.png`, import.meta.url),
  );
  return `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
};

/** A student who joined through the app submits a problem. The app's queue grades it. */
export const submit = async (
  session: SeededSession,
  student: string,
  problemLabel: string,
  fixture: Fixture,
) => {
  const whiteboardUrl = await fixtureUrl(fixture);
  return run(
    Effect.gen(function* () {
      const db = yield* Db;
      const problem = session.problems.find((p) => p.label === problemLabel);
      if (problem === undefined) return yield* Effect.die(`no problem ${problemLabel}`);
      const rows = yield* db
        .select({ id: schema.students.id, name: schema.students.displayName })
        .from(schema.students)
        .where(eq(schema.students.sessionId, session.sessionId));
      const row = rows.find((r) => r.name === student);
      if (row === undefined) return yield* Effect.die(`no student ${student}`);
      yield* submitWork({
        sessionId: session.sessionId,
        studentId: row.id,
        problemId: problem.id,
        whiteboardUrl,
        submittedAt: new Date(),
      });
    }),
  );
};
