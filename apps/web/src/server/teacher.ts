/**
 * The signed-in teacher. Clerk owns sign-in; the first request after sign-in creates the
 * teacher's row.
 */
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { Db, schema } from "@goblins/domain";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";

export class NotSignedIn extends Data.TaggedError("NotSignedIn") {}

export type Teacher = typeof schema.teachers.$inferSelect;

export const currentTeacher = Effect.gen(function* () {
  const { userId } = yield* Effect.promise(() => auth());
  if (userId === null) return yield* Effect.fail(new NotSignedIn());
  const db = yield* Db;
  const [existing] = yield* db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.clerkUserId, userId));
  if (existing !== undefined) return existing;

  const user = yield* Effect.promise(() => clerkClient().users.getUser(userId));
  const name = [user.firstName, user.lastName].filter((part) => part !== null).join(" ");
  const [created] = yield* db
    .insert(schema.teachers)
    .values({
      clerkUserId: userId,
      name: name === "" ? "Teacher" : name,
      email: user.primaryEmailAddress?.emailAddress ?? null,
    })
    .onConflictDoUpdate({ target: schema.teachers.clerkUserId, set: { updatedAt: new Date() } })
    .returning();
  if (created === undefined) return yield* Effect.die("teacher upsert returned no row");
  return created;
});
