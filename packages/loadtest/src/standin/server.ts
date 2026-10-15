/**
 * A local stand-in for the app's HTTP contract (see `@goblins/simulator`'s `api.ts`), on the real
 * domain package, local Postgres and local Electric, with the mock model. It exists so the
 * simulator and load test can be built and dry-run before the app's routes land, and so the
 * harness can be checked against a stack whose behavior we control. Development only: it has no
 * Clerk and accepts only load-test traffic. Never deploy it.
 *
 *   DATABASE_URL=… ELECTRIC_URL=… LOAD_TEST_TOKEN=… pnpm --filter @goblins/loadtest standin
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join as joinPath } from "node:path";
import {
  Db,
  databaseLayer,
  deleteLoadTestRun,
  joinSession,
  parseJoinCodeInput,
  randomJoinCode,
  SqlClient,
  schema,
  submitWork,
} from "@goblins/domain";
import { authorizeLoadTest, type LoadTestRun } from "@goblins/mock-model";
import { getTemplate } from "@goblins/templates";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Either, ManagedRuntime, Option, Schema } from "effect";
import { makeGrader } from "./grader.ts";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return value;
};

const PORT = Number(env("PORT", "3190"));
const BASE_URL = `http://localhost:${PORT}`;
const ELECTRIC_URL = env("ELECTRIC_URL", "http://localhost:30002");
const COOKIE_SECRET = env("STUDENT_COOKIE_SECRET", "standin-only");
const WHITEBOARD_DIR = env("WHITEBOARD_DIR", joinPath(process.cwd(), ".standin-whiteboards"));
mkdirSync(WHITEBOARD_DIR, { recursive: true });
env("LOAD_TEST_TOKEN");

const runtime = ManagedRuntime.make(
  databaseLayer({
    url: env("DATABASE_URL", "postgres://postgres:postgres@localhost:55433/goblins"),
    maxConnections: Number(env("DB_POOL", "20")),
  }),
);

/** The mock spec each run asked for. The real app would store it with the session. */
const runs = new Map<string, LoadTestRun>();
const grader = await runtime.runPromise(
  makeGrader({ concurrency: Number(env("GRADER_CONCURRENCY", "10")), runs }),
);

// ---------------------------------------------------------------------------
// Helpers

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (status: number, body: string) => new Response(body, { status });

const authorize = (request: Request) => {
  const result = authorizeLoadTest({
    env: process.env,
    loadTestHeader: request.headers.get("x-goblins-load-test") ?? undefined,
    mockSpecHeader: request.headers.get("x-goblins-mock-model") ?? undefined,
  });
  if (Either.isLeft(result) || result.right === undefined) return undefined;
  runs.set(result.right.runId, result.right);
  return result.right;
};

const sign = (sessionId: string, studentId: string) =>
  createHmac("sha256", COOKIE_SECRET).update(`${sessionId}.${studentId}`).digest("base64url");

const studentFrom = (request: Request, sessionId: string): string | undefined => {
  const name = `gb_student_${sessionId}=`;
  const raw = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  const [studentId, signature] = raw?.split(".") ?? [];
  if (studentId === undefined || signature === undefined) return undefined;
  const expected = Buffer.from(sign(sessionId, studentId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? studentId
    : undefined;
};

/** The load-test teacher for this request, created on first use. */
const teacherFor = (run: LoadTestRun, request: Request) =>
  Effect.gen(function* () {
    const n = request.headers.get("x-goblins-load-test-teacher") ?? "0";
    const db = yield* Db;
    const clerkUserId = `loadtest:${run.runId}:${n}`;
    yield* db
      .insert(schema.teachers)
      .values({ clerkUserId, name: `Load test teacher ${n}`, loadTestRunId: run.runId })
      .onConflictDoNothing();
    const [teacher] = yield* db
      .select({ id: schema.teachers.id })
      .from(schema.teachers)
      .where(eq(schema.teachers.clerkUserId, clerkUserId));
    if (teacher === undefined) return yield* Effect.die("teacher vanished");
    return teacher.id;
  });

const ownsSession = (teacherId: string, sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db
      .select({ id: schema.classSessions.id })
      .from(schema.classSessions)
      .where(
        and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.teacherId, teacherId)),
      );
    return row !== undefined;
  });

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

const readJson = <A, I>(request: Request, s: Schema.Schema<A, I>) =>
  Effect.tryPromise(() => request.json()).pipe(
    Effect.flatMap(Schema.decodeUnknown(s)),
    Effect.option,
  );

// ---------------------------------------------------------------------------
// Routes

const isUuid = Schema.is(Schema.UUID);

const createAssignment = (run: LoadTestRun, request: Request) =>
  Effect.gen(function* () {
    const body = yield* readJson(request, Schema.Struct({ templateId: Schema.String }));
    const template = Option.flatMap(body, (b) => getTemplate(b.templateId));
    if (Option.isNone(template)) return text(400, "unknown template");
    const teacherId = yield* teacherFor(run, request);
    const db = yield* Db;
    const sqlClient = yield* SqlClient;
    return yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        const [assignment] = yield* db
          .insert(schema.assignments)
          .values({
            teacherId,
            title: template.value.title,
            templateId: template.value.id,
            extractionStatus: "ready",
            loadTestRunId: run.runId,
          })
          .returning({ id: schema.assignments.id });
        if (assignment === undefined) return yield* Effect.die("no assignment");
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
              answerKey: "(see template)",
              pageNumbers: [...row.pages],
            })
            .returning({ id: schema.problems.id });
          if (problem === undefined) return yield* Effect.die("no problem");
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
  });

const createSession = (run: LoadTestRun, request: Request) =>
  Effect.gen(function* () {
    const body = yield* readJson(request, Schema.Struct({ assignmentId: Schema.UUID }));
    if (Option.isNone(body)) return text(400, "bad body");
    const teacherId = yield* teacherFor(run, request);
    const db = yield* Db;
    // Codes collide rarely; retry on the unique index.
    const insert = Effect.suspend(() =>
      db
        .insert(schema.classSessions)
        .values({
          assignmentId: body.value.assignmentId,
          teacherId,
          joinCode: randomJoinCode(),
          loadTestRunId: run.runId,
        })
        .returning({ id: schema.classSessions.id, joinCode: schema.classSessions.joinCode }),
    );
    const [session] = yield* insert.pipe(Effect.retry({ times: 5 }));
    if (session === undefined) return yield* Effect.die("no session");
    return json(200, { sessionId: session.id, joinCode: session.joinCode });
  });

const setStatus = (run: LoadTestRun, request: Request, sessionId: string, action: string) =>
  Effect.gen(function* () {
    const teacherId = yield* teacherFor(run, request);
    if (!(yield* ownsSession(teacherId, sessionId))) return text(403, "not your session");
    const db = yield* Db;
    const now = new Date();
    if (action === "start") {
      yield* db
        .update(schema.classSessions)
        .set({ status: "live", startedAt: now })
        .where(
          and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.status, "lobby")),
        );
    } else {
      yield* db
        .update(schema.classSessions)
        .set({ status: "ended", endedAt: now })
        .where(eq(schema.classSessions.id, sessionId));
    }
    return json(200, {});
  });

const join = (request: Request) =>
  Effect.gen(function* () {
    const body = yield* readJson(
      request,
      Schema.Struct({ joinCode: Schema.String, name: Schema.String }),
    );
    if (Option.isNone(body)) return text(400, "bad body");
    const code = parseJoinCodeInput(body.value.joinCode);
    if (Option.isNone(code)) return json(404, { _tag: "SessionNotFound" });
    const joined = yield* joinSession({
      joinCode: code.value,
      name: body.value.name,
      pickAvatar: () => Math.floor(Math.random() * 48),
    }).pipe(Effect.either);
    if (Either.isLeft(joined)) {
      return joined.left._tag === "SessionNotFound"
        ? json(404, { _tag: "SessionNotFound" })
        : json(400, { _tag: "InvalidName" });
    }
    const { student, resumed } = joined.right;
    const db = yield* Db;
    const [session] = yield* db
      .select({ assignmentId: schema.classSessions.assignmentId })
      .from(schema.classSessions)
      .where(eq(schema.classSessions.id, student.sessionId));
    if (session === undefined) return yield* Effect.die("session vanished");
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
      `gb_student_${student.sessionId}=${student.id}.${sign(student.sessionId, student.id)}; Path=/; HttpOnly; SameSite=Lax`,
    );
    return response;
  });

const submit = (request: Request) =>
  Effect.gen(function* () {
    const form = yield* Effect.tryPromise(() => request.formData()).pipe(Effect.option);
    if (Option.isNone(form)) return text(400, "expected multipart form data");
    const sessionId = form.value.get("sessionId");
    const problemId = form.value.get("problemId");
    const submittedAt = form.value.get("submittedAt");
    const whiteboard = form.value.get("whiteboard");
    if (
      typeof sessionId !== "string" ||
      typeof problemId !== "string" ||
      typeof submittedAt !== "string" ||
      !(whiteboard instanceof Blob) ||
      !isUuid(sessionId) ||
      !isUuid(problemId)
    ) {
      return text(400, "bad form");
    }
    const studentId = studentFrom(request, sessionId);
    if (studentId === undefined) return json(409, { reason: "unknown_student" });
    // Content-addressed, like a Blob store keyed by hash: identical whiteboards share one file.
    const bytes = new Uint8Array(yield* Effect.promise(() => whiteboard.arrayBuffer()));
    const hash = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(joinPath(WHITEBOARD_DIR, `${hash}.png`), bytes);
    const result = yield* submitWork({
      sessionId,
      studentId,
      problemId,
      whiteboardUrl: `${BASE_URL}/whiteboards/${hash}.png`,
      submittedAt: new Date(submittedAt),
    }).pipe(
      Effect.map(Either.right),
      Effect.catchTag("SubmissionRejected", (rejected) => Effect.succeed(Either.left(rejected))),
    );
    if (Either.isLeft(result)) return json(409, { reason: result.left.reason });
    if (Option.isSome(result.right.job)) yield* grader.enqueue(result.right.job.value);
    return json(200, { submissionId: result.right.submissionId, isNew: result.right.isNew });
  });

const teacherColumns =
  "submission_id,session_id,student_id,problem_id,state,attempt,max_points,points,failure_reason,updated_at";
const shapeFor = (view: string, sessionId: string, studentId: string | undefined) => {
  switch (view) {
    case "session":
    case "my-session":
      return {
        table: "class_sessions",
        where: "id = $1",
        params: [sessionId],
        columns: "id,status,started_at,ended_at",
      };
    case "students":
      return {
        table: "students",
        where: "session_id = $1",
        params: [sessionId],
        columns: "id,session_id,display_name,avatar_id",
      };
    case "grades":
      return {
        table: "grades",
        where: "session_id = $1",
        params: [sessionId],
        columns: teacherColumns,
      };
    case "my-grades":
      return studentId === undefined
        ? undefined
        : {
            table: "grades",
            where: "student_id = $1",
            params: [studentId],
            columns: "submission_id,student_id,problem_id,state,points,max_points",
          };
    default:
      return undefined;
  }
};

const PROTOCOL_PARAMS = ["offset", "handle", "live", "cursor", "live_sse", "log", "expired_handle"];

const shape = (run: LoadTestRun, request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "";
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!isUuid(sessionId)) return text(400, "bad session");
    const isStudentView = view.startsWith("my-");
    const studentId = isStudentView ? studentFrom(request, sessionId) : undefined;
    if (isStudentView && studentId === undefined) return text(403, "Forbidden");
    if (!isStudentView && !(yield* ownsSession(yield* teacherFor(run, request), sessionId))) {
      return text(403, "Forbidden");
    }
    const definition = shapeFor(view, sessionId, studentId);
    if (definition === undefined) return text(400, "Unknown view");
    const upstream = new URL("/v1/shape", ELECTRIC_URL);
    for (const [key, value] of url.searchParams) {
      if (PROTOCOL_PARAMS.includes(key)) upstream.searchParams.set(key, value);
    }
    upstream.searchParams.set("table", definition.table);
    upstream.searchParams.set("where", definition.where);
    for (const [i, value] of definition.params.entries()) {
      upstream.searchParams.set(`params[${i + 1}]`, value);
    }
    upstream.searchParams.set("columns", definition.columns);
    const response = yield* Effect.tryPromise((signal) => fetch(upstream, { signal })).pipe(
      Effect.catchAll(() => Effect.succeed(text(502, "Electric unreachable"))),
    );
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(response.body, { status: response.status, headers });
  });

const timings = (runId: string) =>
  Effect.gen(function* () {
    const sqlClient = yield* SqlClient;
    const rows = yield* sqlClient<{
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
       where c.load_test_run_id = ${runId}`;
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
  });

const dbStats = Effect.gen(function* () {
  const sqlClient = yield* SqlClient;
  const [activity] = yield* sqlClient<{
    connections: number;
    active: number;
    idle_in_transaction: number;
    waiting_on_lock: number;
  }>`select count(*)::int as connections,
       count(*) filter (where state = 'active')::int as active,
       count(*) filter (where state = 'idle in transaction')::int as idle_in_transaction,
       count(*) filter (where wait_event_type = 'Lock')::int as waiting_on_lock
     from pg_stat_activity where datname = current_database()`;
  const [database] = yield* sqlClient<{
    xact_commit: string;
    xact_rollback: string;
    deadlocks: string;
    max_connections: number;
  }>`select xact_commit, xact_rollback, deadlocks,
       current_setting('max_connections')::int as max_connections
     from pg_stat_database where datname = current_database()`;
  if (activity === undefined || database === undefined) return text(500, "no stats");
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
});

const route = (request: Request): Effect.Effect<Response, unknown, Db | SqlClient> =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const whiteboard = /^\/whiteboards\/([0-9a-f]{64})\.png$/.exec(path);
    if (method === "GET" && whiteboard !== null) {
      const file = Effect.try(() => readFileSync(joinPath(WHITEBOARD_DIR, `${whiteboard[1]}.png`)));
      return yield* file.pipe(
        Effect.map((bytes) => new Response(bytes, { headers: { "content-type": "image/png" } })),
        Effect.catchAll(() => Effect.succeed(text(404, "not found"))),
      );
    }
    if (method === "GET" && path === "/api/health") return json(200, { ok: true });

    const run = authorize(request);
    if (run === undefined) return text(401, "the stand-in serves load-test traffic only");

    if (method === "POST" && path === "/api/join") return yield* join(request);
    if (method === "POST" && path === "/api/submit") return yield* submit(request);
    if (method === "GET" && path === "/api/shape") return yield* shape(run, request);
    if (method === "POST" && path === "/api/teacher/assignments") {
      return yield* createAssignment(run, request);
    }
    if (method === "POST" && path === "/api/teacher/sessions") {
      return yield* createSession(run, request);
    }
    const status = /^\/api\/teacher\/sessions\/([^/]+)\/(start|end)$/.exec(path);
    if (method === "POST" && status !== null && isUuid(status[1])) {
      return yield* setStatus(run, request, status[1], status[2] ?? "");
    }
    const runRoute = /^\/api\/load-test\/runs\/([A-Za-z0-9_-]{1,64})\/(timings|cleanup)$/.exec(
      path,
    );
    if (runRoute !== null && runRoute[1] === run.runId) {
      if (method === "GET" && runRoute[2] === "timings") return yield* timings(run.runId);
      if (method === "POST" && runRoute[2] === "cleanup") {
        const deleted = yield* deleteLoadTestRun(run.runId);
        return json(200, { deleted });
      }
    }
    if (method === "GET" && path === "/api/load-test/db") return yield* dbStats;
    return text(404, "not found");
  });

// ---------------------------------------------------------------------------
// Node adapter

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Array<Buffer> = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
};

const toRequest = async (req: IncomingMessage): Promise<Request> => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  return new Request(new URL(req.url ?? "/", BASE_URL), {
    method: req.method ?? "GET",
    headers,
    signal: controller.signal,
    ...(hasBody ? { body: await readBody(req) } : {}),
  });
};

const send = async (response: Response, res: ServerResponse) => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  if (response.body === null) return void res.end();
  for await (const chunk of response.body) res.write(chunk);
  res.end();
};

const server = createServer((req, res) => {
  toRequest(req)
    .then((request) =>
      runtime.runPromise(
        route(request).pipe(
          Effect.catchAllCause((cause) =>
            Effect.logError("request failed", cause).pipe(Effect.as(text(500, "internal error"))),
          ),
        ),
      ),
    )
    .then((response) => send(response, res))
    .catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
});
server.keepAliveTimeout = 65_000;
server.listen(PORT, () => console.log(`stand-in listening on ${BASE_URL}`));
