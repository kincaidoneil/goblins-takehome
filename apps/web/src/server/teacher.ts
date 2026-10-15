/**
 * The signed-in teacher. Clerk owns sign-in; the first request after sign-in creates the
 * teacher's row.
 *
 * Local mode: with `AUTH_MODE=local` (set in `local.env` for development and local E2E runs),
 * every request is the same local teacher and Clerk is not consulted. It is ignored on Vercel,
 * so no deployed environment can turn it on.
 */
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { Db, schema } from "@goblins/domain";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";

export class NotSignedIn extends Data.TaggedError("NotSignedIn") {}

export type Teacher = typeof schema.teachers.$inferSelect;

export const localTeacherMode =
  process.env.AUTH_MODE === "local" && process.env.VERCEL === undefined;

const LOCAL_TEACHER = { clerkUserId: "local_teacher", name: "Ms. Rivera", email: null };

/** The Clerk user id of the request, or null when signed out. */
export const signedInUserId = localTeacherMode
  ? Effect.succeed<string | null>(LOCAL_TEACHER.clerkUserId)
  : Effect.map(
      Effect.promise(() => auth()),
      ({ userId }) => userId,
    );

const profile = (userId: string) =>
  localTeacherMode
    ? Effect.succeed(LOCAL_TEACHER)
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
