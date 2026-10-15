/**
 * Who a load-test request speaks for. A request is load-test traffic only when
 * `x-goblins-load-test` carries `<LOAD_TEST_TOKEN>:<runId>` (see `@goblins/mock-model`'s
 * `authorizeLoadTest`). Such a request may act as teacher `loadtest:<runId>:<n>` by sending
 * `x-goblins-load-test-teacher: <n>`, in place of Clerk sign-in. Without the token nothing here
 * applies, so no ordinary request can reach a load-test identity.
 */
import { Db, schema } from "@goblins/domain";
import { authorizeLoadTest, type LoadTestRun } from "@goblins/mock-model";
import { eq } from "drizzle-orm";
import { Effect, Either } from "effect";

export const LOAD_TEST_TEACHER_HEADER = "x-goblins-load-test-teacher";

export type LoadTestAuth =
  | { readonly _tag: "NotLoadTest" }
  /** Valid token, but the mock spec header does not parse. The load test should fail loudly. */
  | { readonly _tag: "BadSpec"; readonly message: string }
  | { readonly _tag: "LoadTest"; readonly run: LoadTestRun; readonly teacher: string | null };

/** Read in the route handler, before any Effect runs (request context is AsyncLocalStorage). */
export const loadTestAuth = (request: Request): LoadTestAuth => {
  const result = authorizeLoadTest({
    env: process.env,
    loadTestHeader: request.headers.get("x-goblins-load-test") ?? undefined,
    mockSpecHeader: request.headers.get("x-goblins-mock-model") ?? undefined,
  });
  if (Either.isLeft(result)) return { _tag: "BadSpec", message: result.left.message };
  if (result.right === undefined) return { _tag: "NotLoadTest" };
  const teacher = request.headers.get(LOAD_TEST_TEACHER_HEADER);
  return {
    _tag: "LoadTest",
    run: result.right,
    teacher: teacher !== null && /^\d{1,6}$/.test(teacher) ? teacher : null,
  };
};

/** The load-test teacher for this run and number, created and stamped on first use. */
export const loadTestTeacher = (run: LoadTestRun, n: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const clerkUserId = `loadtest:${run.runId}:${n}`;
    yield* db
      .insert(schema.teachers)
      .values({ clerkUserId, name: `Load test teacher ${n}`, loadTestRunId: run.runId })
      .onConflictDoNothing();
    const [teacher] = yield* db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.clerkUserId, clerkUserId));
    if (teacher === undefined) return yield* Effect.die("load-test teacher upsert returned no row");
    return teacher;
  });
