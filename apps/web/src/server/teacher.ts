/**
 * The signed-in teacher. Clerk owns sign-in; the first request after sign-in creates the
 * teacher's row.
 *
 * The Clerk user comes from `RequestContext`, never from `auth()` inside an effect (see
 * request-context.ts). Local mode is described in teacher-mode.ts.
 */
import { clerkClient } from "@clerk/tanstack-react-start/server";
import { Db, schema } from "@goblins/domain";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { RequestContext } from "./request-context";
import { localTeacherMode } from "./teacher-mode";

export class NotSignedIn extends Data.TaggedError("NotSignedIn") {}

export type Teacher = typeof schema.teachers.$inferSelect;

export { localTeacherMode } from "./teacher-mode";

/** The signed-in Clerk user id, resolved at the handler boundary by `run`. */
export const signedInUserId = Effect.map(RequestContext, (request) => request.clerkUserId);

const profile = (userId: string) =>
  localTeacherMode
    ? Effect.succeed({ clerkUserId: userId, name: "Ms. Rivera", email: null })
    : Effect.map(
        Effect.promise(() => clerkClient().users.getUser(userId)),
        (user) => {
          const name = [user.firstName, user.lastName].filter((part) => part !== null).join(" ");
          return {
            clerkUserId: userId,
            name: name === "" ? "Teacher" : name,
            email: user.primaryEmailAddress?.emailAddress ?? null,
          };
        },
      );

export const currentTeacher = Effect.gen(function* () {
  const userId = yield* signedInUserId;
  if (userId === null) return yield* Effect.fail(new NotSignedIn());
  const db = yield* Db;
  const [existing] = yield* db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.clerkUserId, userId));
  if (existing !== undefined) return existing;

  const [created] = yield* db
    .insert(schema.teachers)
    .values(yield* profile(userId))
    .onConflictDoUpdate({ target: schema.teachers.clerkUserId, set: { updatedAt: new Date() } })
    .returning();
  if (created === undefined) return yield* Effect.die("teacher upsert returned no row");
  return created;
});
