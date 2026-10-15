/**
 * Access checks shared by server functions. Kept out of `fns/` so that files declaring server
 * functions export nothing that would pull server code into the browser bundle.
 */
import { Db, schema } from "@goblins/domain";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import { currentTeacher } from "./teacher";

export class SessionNotFound extends Data.TaggedError("SessionNotFound") {}

const isUuid = Schema.is(Schema.UUID);

/** The session, if the signed-in teacher owns it. */
export const ownedSession = (sessionId: string) =>
  Effect.gen(function* () {
    if (!isUuid(sessionId)) return yield* Effect.fail(new SessionNotFound());
    const teacher = yield* currentTeacher;
    const db = yield* Db;
    const [session] = yield* db
      .select()
      .from(schema.classSessions)
      .where(
        and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.teacherId, teacher.id)),
      );
    if (session === undefined) return yield* Effect.fail(new SessionNotFound());
    return { session, teacher };
  });
