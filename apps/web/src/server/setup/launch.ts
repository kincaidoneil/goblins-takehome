/**
 * Launch: the signed-in teacher claims the draft and opens a class session with a join code.
 */
import { Db, randomJoinCode, SqlClient, schema } from "@goblins/domain";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { ensureEditable, ownedAssignment } from "./draft";
import type { Viewer } from "./viewer";

/** The draft is not ready to launch. */
export class NotLaunchable extends Data.TaggedError("NotLaunchable")<{
  readonly reason: "still_extracting" | "extraction_failed" | "no_title" | "empty_problem";
  /** For `empty_problem`, the label of a problem with no text or no answer key. */
  readonly label?: string;
}> {}

/** Moves every draft this browser started before sign-in to the teacher. */
export const claimDrafts = (draftOwnerId: string, teacherId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db
      .update(schema.assignments)
      .set({ teacherId, draftOwnerId: null })
      .where(eq(schema.assignments.draftOwnerId, draftOwnerId));
  });

const MAX_CODE_TRIES = 10;

const openSession = (input: {
  readonly assignmentId: string;
  readonly teacherId: string;
  readonly timeLimitMinutes: number | null;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt++) {
      const [row] = yield* db
        .insert(schema.classSessions)
        .values({ ...input, joinCode: randomJoinCode() })
        // A code is unique among sessions that have not ended; on a clash, draw another.
        .onConflictDoNothing({
          target: schema.classSessions.joinCode,
          where: sql`${schema.classSessions.status} <> 'ended'`,
        })
        .returning({ id: schema.classSessions.id, joinCode: schema.classSessions.joinCode });
      if (row !== undefined) return row;
    }
    return yield* Effect.die("no free join code after 10 tries");
  });

export const launchDraft = (input: {
  readonly viewer: Viewer;
  readonly teacherId: string;
  readonly draftId: string;
  readonly timeLimitMinutes: number | null;
}) =>
  Effect.gen(function* () {
    const sqlClient = yield* SqlClient;
    const db = yield* Db;
    return yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        // Serializes a double-clicked Launch, so one draft opens one session.
        yield* db
          .select({ id: schema.assignments.id })
          .from(schema.assignments)
          .where(eq(schema.assignments.id, input.draftId))
          .for("update");
        const assignment = yield* ownedAssignment(input.viewer, input.draftId);
        yield* ensureEditable(input.draftId);
        if (assignment.extractionStatus === "extracting") {
          return yield* Effect.fail(new NotLaunchable({ reason: "still_extracting" }));
        }
        if (assignment.extractionStatus === "failed") {
          return yield* Effect.fail(new NotLaunchable({ reason: "extraction_failed" }));
        }
        if (assignment.title.trim() === "") {
          return yield* Effect.fail(new NotLaunchable({ reason: "no_title" }));
        }
        const empty = yield* db
          .select({ label: schema.problems.label })
          .from(schema.problems)
          .where(
            and(
              eq(schema.problems.assignmentId, input.draftId),
              // The grader needs both: a blank answer key would grade against nothing.
              sql`(btrim(${schema.problems.text}) = '' or btrim(${schema.problems.answerKey}) = '')`,
            ),
          )
          .limit(1);
        const [firstEmpty] = empty;
        if (firstEmpty !== undefined) {
          return yield* Effect.fail(
            new NotLaunchable({ reason: "empty_problem", label: firstEmpty.label }),
          );
        }

        if (assignment.teacherId === null) {
          yield* db
            .update(schema.assignments)
            .set({ teacherId: input.teacherId, draftOwnerId: null })
            .where(eq(schema.assignments.id, input.draftId));
        }
        return yield* openSession({
          assignmentId: input.draftId,
          teacherId: input.teacherId,
          timeLimitMinutes: input.timeLimitMinutes,
        });
      }),
    );
  });
