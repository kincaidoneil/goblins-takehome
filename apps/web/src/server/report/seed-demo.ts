/**
 * Puts the sample class (`report/fixture.ts`) into a database as a real, ended session with a
 * share link, so the live report and share routes can be tried and tested without running a
 * class. Idempotent: it replaces the session each run.
 *
 *   DATABASE_URL=… pnpm --filter @goblins/web exec tsx src/server/report/seed-demo.ts [clerkUserId]
 *
 * Pass your Clerk user id to own the session and open /sessions/<session id>/report signed in.
 */
import { DatabaseLive, Db, schema } from "@goblins/domain";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { DEMO_ASSIGNMENT, demoClass } from "../../report/fixture";

export const DEMO_SESSION_ID = "5eed0000-0000-4000-8000-000000000001";
export const DEMO_SHARE_TOKEN = "sample-class-report-share-link";
const ASSIGNMENT_ID = "5eed0000-0000-4000-8000-000000000003";

/** Fixture ids ("s1", "p7", "p7-l1") as stable UUIDs. */
const uuid = (key: string): string => {
  const hex = Buffer.from(key).toString("hex").padEnd(12, "0").slice(0, 12);
  return `5eed0000-0000-4000-9000-${hex}`;
};

export const seedDemoReport = (clerkUserId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const input = demoClass("struggled");
    const ended = new Date(DEMO_ASSIGNMENT.endedAt);
    const started = new Date(ended.getTime() - 40 * 60_000);

    yield* db.delete(schema.assignments).where(eq(schema.assignments.id, ASSIGNMENT_ID));
    // The Clerk user may already have a teacher row from signing in; seed under that one.
    const [teacher] = yield* db
      .insert(schema.teachers)
      .values({ clerkUserId, name: DEMO_ASSIGNMENT.teacherName })
      .onConflictDoUpdate({ target: schema.teachers.clerkUserId, set: { updatedAt: new Date() } })
      .returning({ id: schema.teachers.id });
    if (teacher === undefined) return yield* Effect.die("teacher upsert returned no row");
    yield* db.insert(schema.assignments).values({
      id: ASSIGNMENT_ID,
      teacherId: teacher.id,
      title: DEMO_ASSIGNMENT.title,
      templateId: "solving-linear-equations",
      extractionStatus: "ready",
    });
    yield* db.insert(schema.problems).values(
      input.problems.map((p, position) => ({
        id: uuid(p.id),
        assignmentId: ASSIGNMENT_ID,
        position,
        label: p.label,
        text: p.text,
        answerKey: "See the template's answer key.",
      })),
    );
    yield* db.insert(schema.rubricLines).values(
      input.problems.flatMap((p) =>
        p.rubricLines.map((line, position) => ({
          id: uuid(line.id),
          problemId: uuid(p.id),
          position,
          points: line.points,
          description: line.description,
        })),
      ),
    );
    yield* db.insert(schema.classSessions).values({
      id: DEMO_SESSION_ID,
      assignmentId: ASSIGNMENT_ID,
      teacherId: teacher.id,
      joinCode: "000000",
      status: "ended",
      startedAt: started,
      endedAt: ended,
      reportShareToken: DEMO_SHARE_TOKEN,
    });
    yield* db.insert(schema.students).values(
      input.students.map((s, i) => ({
        id: uuid(s.id),
        sessionId: DEMO_SESSION_ID,
        displayName: s.displayName,
        nameKey: s.displayName.toLowerCase().replace(/[^a-z]/g, ""),
        avatarId: s.avatarId,
        createdAt: new Date(started.getTime() + i * 5_000),
      })),
    );
    yield* db.insert(schema.submissions).values(
      input.grades.map((g) => ({
        id: uuid(g.submissionId),
        sessionId: DEMO_SESSION_ID,
        studentId: uuid(g.studentId),
        problemId: uuid(g.problemId),
        whiteboardUrl: "https://example.invalid/whiteboard.png",
        submittedAt: started,
      })),
    );
    yield* db.insert(schema.grades).values(
      input.grades.map((g) => {
        const linePoints =
          g.linePoints?.map((l) => ({ rubricLineId: uuid(l.rubricLineId), points: l.points })) ??
          null;
        const modelResult = {
          graderRead: "(sample class: no whiteboard)",
          modelLinePoints: linePoints ?? [],
          graderReason: g.graderReason ?? "Best guess: partly correct.",
        };
        const base = {
          submissionId: uuid(g.submissionId),
          sessionId: DEMO_SESSION_ID,
          studentId: uuid(g.studentId),
          problemId: uuid(g.problemId),
          maxPoints: g.maxPoints,
        };
        switch (g.state) {
          case "graded":
            return {
              ...base,
              ...modelResult,
              state: "graded" as const,
              source: "model" as const,
              linePoints,
              points: g.points,
              gradedAt: ended,
            };
          case "needs_teacher":
            return {
              ...base,
              ...modelResult,
              state: "needs_teacher" as const,
              flagReason: "The last line is hard to read.",
            };
          case "couldnt_grade":
            return {
              ...base,
              state: "couldnt_grade" as const,
              failureReason: "The model timed out three times.",
            };
          default:
            // Still with the grader: queued again.
            return { ...base, state: "submitted" as const };
        }
      }),
    );
    return DEMO_SESSION_ID;
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const owner = process.argv[2] ?? "seed:sample-class";
  Effect.runPromise(seedDemoReport(owner).pipe(Effect.provide(DatabaseLive))).then(
    (id) => console.log(`Seeded session ${id}. Share link: /share/${DEMO_SHARE_TOKEN}`),
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
