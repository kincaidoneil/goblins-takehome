/**
 * The plain HTTP routes the class simulator and load test drive (`packages/simulator`'s
 * `api.ts` is the contract). Student routes wrap the same Effects as the student app's server
 * functions; teacher routes serve Clerk-signed-in teachers and load-test teachers alike; the
 * `/api/load-test/*` routes require the load-test token.
 *
 * Every handler reads the request (headers, cookies, body) before its Effect runs and builds the
 * Response after, because TanStack Start's request context is AsyncLocalStorage and a fiber can
 * resume in another request's context.
 */
import { createHash } from "node:crypto";
import {
  Db,
  deleteLoadTestRun,
  joinSession,
  parseJoinCodeInput,
  randomJoinCode,
  SqlClient,
  schema,
  submitWork,
} from "@goblins/domain";
import { getTemplate } from "@goblins/templates";
import { randomCreatureId } from "@goblins/ui";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { clientIp, joinAllowed, joinMissed, submitAllowed } from "../abuse";
import { GradeQueue } from "../grading";
import { type AppServices, run } from "../runtime";
import { studentCookie, studentFromCookies } from "../student-identity";
import { teacherFor } from "../teacher";
import { WhiteboardStore } from "../whiteboards";
import { type LoadTestAuth, loadTestAuth } from "./identity";

const json = (status: number, body: unknown) => Response.json(body, { status });
const isUuid = Schema.is(Schema.UUID);

/** Runs a route's Effect; expected failures are in the Response, anything else is a 500. */
const respond = <E>(effect: Effect.Effect<Response, E, AppServices>) =>
  run(
    effect.pipe(
      Effect.catchAllCause((cause) =>
        Effect.logError("load-test route failed", cause).pipe(
          Effect.as(json(500, { error: "internal" })),
        ),
      ),
    ),
  );

const readJson = async <A, I>(request: Request, s: Schema.Schema<A, I>) => {
  const body: unknown = await request.json().catch(() => undefined);
  return Schema.decodeUnknownOption(s)(body);
};

const problemsOf = (assignmentId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db
      .select({
        id: schema.problems.id,
        label: schema.problems.label,
        position: schema.problems.position,
      })
      .from(schema.problems)
      .where(eq(schema.problems.assignmentId, assignmentId))
      .orderBy(asc(schema.problems.position));
  });

const badSpec = (auth: LoadTestAuth) =>
  auth._tag === "BadSpec"
    ? json(400, { error: `bad x-goblins-mock-model: ${auth.message}` })
    : null;

// ---------------------------------------------------------------------------
// Students

export const joinRoute = async (request: Request) => {
  const auth = loadTestAuth(request);
  const bad = badSpec(auth);
  if (bad !== null) return bad;
  // Load-test traffic comes from a few machines; only other requests count against limits.
  const ip = auth._tag === "LoadTest" ? null : clientIp(request.headers);
  const body = await readJson(
    request,
    Schema.Struct({ joinCode: Schema.String, name: Schema.String }),
  );
  if (Option.isNone(body)) return json(400, { error: "expected {joinCode, name}" });
  return respond(
    Effect.gen(function* () {
      if (!(yield* joinAllowed(ip))) return json(429, { _tag: "RateLimited" });
      const code = parseJoinCodeInput(body.value.joinCode);
      if (Option.isNone(code)) {
        yield* joinMissed(ip);
        return json(404, { _tag: "SessionNotFound" });
      }
      const joined = yield* joinSession({
        joinCode: code.value,
        name: body.value.name,
        pickAvatar: (taken) => randomCreatureId(taken),
      }).pipe(
        Effect.map((value) => ({ _tag: "Joined", value }) as const),
        Effect.catchTags({
          SessionFull: () => Effect.succeed(json(409, { _tag: "SessionFull" })),
          InvalidName: () => Effect.succeed(json(400, { _tag: "InvalidName" })),
          SessionNotFound: () => Effect.as(joinMissed(ip), json(404, { _tag: "SessionNotFound" })),
        }),
      );
      if (joined instanceof Response) return joined;
      const { student, resumed } = joined.value;
      const db = yield* Db;
      const [session] = yield* db
        .select({ assignmentId: schema.classSessions.assignmentId })
        .from(schema.classSessions)
        .where(eq(schema.classSessions.id, student.sessionId));
      if (session === undefined) return yield* Effect.die("session vanished after join");
      const cookie = yield* studentCookie(student.sessionId, student.id);
      const response = json(200, {
        sessionId: student.sessionId,
        studentId: student.id,
        displayName: student.displayName,
        avatarId: student.avatarId,
        resumed,
        problems: yield* problemsOf(session.assignmentId),
      });
      response.headers.append(
        "set-cookie",
        `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${cookie.options.maxAge}`,
      );
      return response;
    }),
  );
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PNG_BYTES = 3_000_000;

/**
 * Load-test whiteboards are a handful of fixture PNGs. Keyed by content, each function instance
 * stores each fixture once, so a run makes a few Blob writes instead of one per submission.
 */
const storedByHash = new Map<string, string>();

export const submitRoute = async (request: Request) => {
  const auth = loadTestAuth(request);
  const bad = badSpec(auth);
  if (bad !== null) return bad;
  const cookies = request.headers.get("cookie");
  const form = await request.formData().catch(() => undefined);
  const sessionId = form?.get("sessionId");
  const problemId = form?.get("problemId");
  const submittedAt = form?.get("submittedAt");
  const whiteboard = form?.get("whiteboard");
  if (
    typeof sessionId !== "string" ||
    typeof problemId !== "string" ||
    typeof submittedAt !== "string" ||
    !(whiteboard instanceof Blob) ||
    !isUuid(sessionId) ||
    !isUuid(problemId) ||
    Number.isNaN(Date.parse(submittedAt)) ||
    whiteboard.size > MAX_PNG_BYTES
  ) {
    return json(400, { error: "expected multipart sessionId, problemId, submittedAt, whiteboard" });
  }
  const png = new Uint8Array(await whiteboard.arrayBuffer());
  if (!PNG_SIGNATURE.every((byte, i) => png[i] === byte)) return json(400, { error: "not a PNG" });

  return respond(
    Effect.gen(function* () {
      const studentId = yield* studentFromCookies(cookies, sessionId);
      if (Option.isNone(studentId)) return json(409, { reason: "unknown_student" });
      if (
        auth._tag !== "LoadTest" &&
        !(yield* submitAllowed(studentId.value, clientIp(request.headers)))
      ) {
        return json(429, { reason: "rate_limited" });
      }
      const store = yield* WhiteboardStore;
      const hash = createHash("sha256").update(png).digest("hex");
      const cached = auth._tag === "LoadTest" ? storedByHash.get(hash) : undefined;
      const whiteboardUrl =
        cached ?? (yield* store.put(`${sessionId}-${problemId}-${hash.slice(0, 16)}.png`, png));
      if (auth._tag === "LoadTest") storedByHash.set(hash, whiteboardUrl);
      const now = new Date();
      const at = new Date(submittedAt);
      const result = yield* submitWork({
        sessionId,
        studentId: studentId.value,
        problemId,
        whiteboardUrl,
        submittedAt: at > now ? now : at,
      });
      if (Option.isSome(result.job)) {
        const queue = yield* GradeQueue;
        yield* queue.enqueue(result.job.value);
      }
      return json(200, { submissionId: result.submissionId, isNew: result.isNew });
    }).pipe(
      Effect.catchTag("SubmissionRejected", (rejected) =>
        Effect.succeed(json(409, { reason: rejected.reason })),
      ),
    ),
  );
};

// ---------------------------------------------------------------------------
// Teachers

export const createAssignmentRoute = async (request: Request) => {
  const auth = loadTestAuth(request);
  const bad = badSpec(auth);
  if (bad !== null) return bad;
  const body = await readJson(request, Schema.Struct({ templateId: Schema.String }));
  const template = Option.flatMap(body, (b) => getTemplate(b.templateId));
  if (Option.isNone(template)) return json(400, { error: "unknown template" });
  const runId = auth._tag === "LoadTest" ? auth.run.runId : null;
  return respond(
    Effect.gen(function* () {
      const teacher = yield* teacherFor(auth);
      const db = yield* Db;
      const sql = yield* SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [assignment] = yield* db
            .insert(schema.assignments)
            .values({
              teacherId: teacher.id,
              title: template.value.title,
              templateId: template.value.id,
              extractionStatus: "ready",
              loadTestRunId: runId,
            })
            .returning({ id: schema.assignments.id });
          if (assignment === undefined) return yield* Effect.die("no assignment row");
          // One problem per part, as the app grades them. Rubrics are a fixed two lines: the load
          // test measures the pipeline, not rubric drafting.
          const rows = template.value.problems.flatMap((problem) =>
            problem._tag === "Whole"
              ? [{ label: String(problem.number), text: problem.text, pages: problem.pages }]
              : problem.parts.map((part) => ({
                  label: `${problem.number}${part.label}`,
                  text: `${problem.stem}\n${part.text}`,
                  pages: problem.pages,
                })),
          );
          for (const [position, row] of rows.entries()) {
            const [problem] = yield* db
              .insert(schema.problems)
              .values({
                assignmentId: assignment.id,
                position,
                label: row.label,
                text: row.text,
                answerKey: "(from the template)",
                pageNumbers: [...row.pages],
              })
              .returning({ id: schema.problems.id });
            if (problem === undefined) return yield* Effect.die("no problem row");
            yield* db.insert(schema.rubricLines).values([
              { problemId: problem.id, position: 0, points: 1, description: "Correct method" },
              { problemId: problem.id, position: 1, points: 1, description: "Correct answer" },
            ]);
          }
          return json(200, {
            assignmentId: assignment.id,
            problems: yield* problemsOf(assignment.id),
          });
        }),
      );
    }).pipe(Effect.catchTag("NotSignedIn", () => Effect.succeed(json(401, { error: "sign in" })))),
  );
};

export const createSessionRoute = async (request: Request) => {
  const auth = loadTestAuth(request);
  const bad = badSpec(auth);
  if (bad !== null) return bad;
  const body = await readJson(request, Schema.Struct({ assignmentId: Schema.UUID }));
  if (Option.isNone(body)) return json(400, { error: "expected {assignmentId}" });
  return respond(
    Effect.gen(function* () {
      const teacher = yield* teacherFor(auth);
      const db = yield* Db;
      const [assignment] = yield* db
        .select({ id: schema.assignments.id })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.id, body.value.assignmentId),
            eq(schema.assignments.teacherId, teacher.id),
          ),
        );
      if (assignment === undefined) return json(404, { error: "no such assignment" });
      // Join codes collide rarely; retry on the unique index.
      const [session] = yield* Effect.suspend(() =>
        db
          .insert(schema.classSessions)
          .values({
            assignmentId: assignment.id,
            teacherId: teacher.id,
            joinCode: randomJoinCode(),
            loadTestRunId: auth._tag === "LoadTest" ? auth.run.runId : null,
            loadTestMockSpec: auth._tag === "LoadTest" ? auth.run.spec : null,
          })
          .returning({ id: schema.classSessions.id, joinCode: schema.classSessions.joinCode }),
      ).pipe(Effect.retry({ times: 5 }));
      if (session === undefined) return yield* Effect.die("no session row");
      return json(200, { sessionId: session.id, joinCode: session.joinCode });
    }).pipe(Effect.catchTag("NotSignedIn", () => Effect.succeed(json(401, { error: "sign in" })))),
  );
};

export const sessionStatusRoute = (request: Request, sessionId: string, action: string) => {
  const auth = loadTestAuth(request);
  const bad = badSpec(auth);
  if (bad !== null) return Promise.resolve(bad);
  if (!isUuid(sessionId) || (action !== "start" && action !== "end")) {
    return Promise.resolve(json(404, { error: "not found" }));
  }
  return respond(
    Effect.gen(function* () {
      const teacher = yield* teacherFor(auth);
      const db = yield* Db;
      const owned = and(
        eq(schema.classSessions.id, sessionId),
        eq(schema.classSessions.teacherId, teacher.id),
      );
      const [session] = yield* db
        .select({ status: schema.classSessions.status })
        .from(schema.classSessions)
        .where(owned);
      if (session === undefined) return json(404, { error: "no such session" });
      if (action === "start" && session.status === "lobby") {
        yield* db
          .update(schema.classSessions)
          .set({ status: "live", startedAt: new Date() })
          .where(and(owned, eq(schema.classSessions.status, "lobby")));
      }
      if (action === "end" && session.status !== "ended") {
        yield* db
          .update(schema.classSessions)
          .set({ status: "ended", endedAt: new Date() })
          .where(owned);
      }
      return json(200, {});
    }).pipe(Effect.catchTag("NotSignedIn", () => Effect.succeed(json(401, { error: "sign in" })))),
  );
};

// ---------------------------------------------------------------------------
// Load-test measurement and cleanup. Token required; the run id in the path must be the header's.

const requireRun = (request: Request, runId?: string) => {
  const auth = loadTestAuth(request);
  if (auth._tag !== "LoadTest") return null;
  if (runId !== undefined && auth.run.runId !== runId) return null;
  return auth.run;
};

export const timingsRoute = (request: Request, runId: string) => {
  const loadTest = requireRun(request, runId);
  if (loadTest === null) return Promise.resolve(json(403, { error: "load-test token required" }));
  return respond(
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const rows = yield* sql<{
        submission_id: string;
        state: string;
        attempt: number;
        created_at: Date;
        claimed_at: Date | null;
        outcome_at: Date | null;
      }>`select g.submission_id, g.state, g.attempt, s.created_at, g.claimed_at, g.outcome_at
         from grades g
         join submissions s on s.id = g.submission_id
         join class_sessions c on c.id = g.session_id
         where c.load_test_run_id = ${loadTest.runId}`;
      return json(200, {
        grades: rows.map((r) => ({
          submissionId: r.submission_id,
          state: r.state,
          attempt: r.attempt,
          createdAt: r.created_at.toISOString(),
          claimedAt: r.claimed_at?.toISOString() ?? null,
          outcomeAt: r.outcome_at?.toISOString() ?? null,
        })),
      });
    }),
  );
};

export const dbStatsRoute = (request: Request) => {
  if (requireRun(request) === null) {
    return Promise.resolve(json(403, { error: "load-test token required" }));
  }
  return respond(
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const [activity] = yield* sql<{
        connections: number;
        active: number;
        idle_in_transaction: number;
        waiting_on_lock: number;
      }>`select count(*)::int as connections,
           count(*) filter (where state = 'active')::int as active,
           count(*) filter (where state = 'idle in transaction')::int as idle_in_transaction,
           count(*) filter (where wait_event_type = 'Lock')::int as waiting_on_lock
         from pg_stat_activity where datname = current_database()`;
      const [database] = yield* sql<{
        xact_commit: string;
        xact_rollback: string;
        deadlocks: string;
        max_connections: number;
      }>`select xact_commit, xact_rollback, deadlocks,
           current_setting('max_connections')::int as max_connections
         from pg_stat_database where datname = current_database()`;
      if (activity === undefined || database === undefined) return json(500, { error: "no stats" });
      return json(200, {
        connections: activity.connections,
        active: activity.active,
        idleInTransaction: activity.idle_in_transaction,
        waitingOnLock: activity.waiting_on_lock,
        maxConnections: database.max_connections,
        xactCommit: Number(database.xact_commit),
        xactRollback: Number(database.xact_rollback),
        deadlocks: Number(database.deadlocks),
      });
    }),
  );
};

export const cleanupRoute = (request: Request, runId: string) => {
  const loadTest = requireRun(request, runId);
  if (loadTest === null) return Promise.resolve(json(403, { error: "load-test token required" }));
  return respond(
    Effect.map(deleteLoadTestRun(loadTest.runId), (deleted) => json(200, { deleted })),
  );
};
