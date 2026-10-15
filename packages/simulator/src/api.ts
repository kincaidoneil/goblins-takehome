/**
 * The app's HTTP contract, as the simulator uses it. Agreed with the web app stream; the local
 * stand-in in `@goblins/loadtest` implements the same routes.
 *
 * Student routes authenticate with the signed `gb_student_<sessionId>` cookie that join sets.
 * Teacher routes authenticate with Clerk, or, for a load test, with the load-test token and
 * `x-goblins-load-test-teacher: <n>`, which the app maps to teacher `loadtest:<runId>:<n>`.
 */
import { Data, Effect, Schema } from "effect";
import { ContractError, decodeJson, request } from "./http.ts";
import { LOAD_TEST_TEACHER_HEADER, loadTestHeaders, type Target } from "./target.ts";

/** A status the contract does not define for this route. */
export class UnexpectedStatus extends Data.TaggedError("UnexpectedStatus")<{
  readonly op: string;
  readonly status: number;
  readonly body: string;
}> {}

const unexpected = (op: string, response: { status: number; text: string }) =>
  new UnexpectedStatus({ op, status: response.status, body: response.text.slice(0, 300) });

// ---------------------------------------------------------------------------
// Teacher

export const Problem = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  position: Schema.Number,
});
export type Problem = typeof Problem.Type;

const CreatedAssignment = Schema.Struct({
  assignmentId: Schema.String,
  problems: Schema.Array(Problem),
});

const CreatedSession = Schema.Struct({ sessionId: Schema.String, joinCode: Schema.String });

export const teacherHeaders = (target: Target, teacher: number): Record<string, string> => ({
  ...loadTestHeaders(target),
  [LOAD_TEST_TEACHER_HEADER]: String(teacher),
});

const postJson = (
  op: Parameters<typeof request>[0],
  url: string,
  headers: Record<string, string>,
  body: unknown,
) =>
  request(op, url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const createAssignment = (target: Target, teacher: number, templateId: string) =>
  Effect.gen(function* () {
    const response = yield* postJson(
      "create-assignment",
      `${target.baseUrl}/api/teacher/assignments`,
      teacherHeaders(target, teacher),
      { templateId },
    );
    if (response.status !== 200)
      return yield* Effect.fail(unexpected("create-assignment", response));
    return yield* decodeJson("create-assignment", response, CreatedAssignment);
  });

export const createSession = (target: Target, teacher: number, assignmentId: string) =>
  Effect.gen(function* () {
    const response = yield* postJson(
      "create-session",
      `${target.baseUrl}/api/teacher/sessions`,
      teacherHeaders(target, teacher),
      { assignmentId },
    );
    if (response.status !== 200) return yield* Effect.fail(unexpected("create-session", response));
    return yield* decodeJson("create-session", response, CreatedSession);
  });

export const setSessionStatus = (
  target: Target,
  teacher: number,
  sessionId: string,
  action: "start" | "end",
) =>
  Effect.gen(function* () {
    const op = action === "start" ? "start-session" : "end-session";
    const response = yield* postJson(
      op,
      `${target.baseUrl}/api/teacher/sessions/${sessionId}/${action}`,
      teacherHeaders(target, teacher),
      {},
    );
    if (response.status !== 200) return yield* Effect.fail(unexpected(op, response));
  });

// ---------------------------------------------------------------------------
// Student

const Joined = Schema.Struct({
  sessionId: Schema.String,
  studentId: Schema.String,
  displayName: Schema.String,
  avatarId: Schema.Number,
  resumed: Schema.Boolean,
  /** The session's problems in worksheet order, for the progress strip. */
  problems: Schema.Array(Problem),
});
export type Joined = typeof Joined.Type & { readonly cookie: string };

export const join = (target: Target, joinCode: string, name: string) =>
  Effect.gen(function* () {
    const response = yield* postJson(
      "join",
      `${target.baseUrl}/api/join`,
      loadTestHeaders(target),
      { joinCode, name },
    );
    if (response.status !== 200) return yield* Effect.fail(unexpected("join", response));
    const joined = yield* decodeJson("join", response, Joined);
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0] ?? "")
      .find((pair) => pair.startsWith(`gb_student_${joined.sessionId}=`));
    if (cookie === undefined) {
      return yield* Effect.fail(
        new ContractError({ op: "join", status: 200, message: "no student cookie" }),
      );
    }
    return { ...joined, cookie } satisfies Joined;
  });

const Submitted = Schema.Struct({ submissionId: Schema.String, isNew: Schema.Boolean });

const SubmitRejected = Schema.Struct({
  reason: Schema.Literal("session_not_live", "unknown_student", "unknown_problem"),
});

/** What one submit attempt got back. Transport failures come through the error channel. */
export type SubmitResponse =
  | { readonly _tag: "Accepted"; readonly submissionId: string; readonly isNew: boolean }
  | { readonly _tag: "Rejected"; readonly reason: typeof SubmitRejected.Type.reason }
  /** 5xx or 429: the server could not take it now; the client keeps the work and retries. */
  | { readonly _tag: "Unavailable"; readonly status: number };

export const submit = (
  target: Target,
  student: { readonly sessionId: string; readonly cookie: string },
  input: { readonly problemId: string; readonly submittedAt: Date; readonly png: Uint8Array },
) =>
  Effect.gen(function* () {
    const form = new FormData();
    form.set("sessionId", student.sessionId);
    form.set("problemId", input.problemId);
    form.set("submittedAt", input.submittedAt.toISOString());
    form.set("whiteboard", new Blob([input.png], { type: "image/png" }), "whiteboard.png");
    const response = yield* request("submit", `${target.baseUrl}/api/submit`, {
      method: "POST",
      headers: { ...loadTestHeaders(target), cookie: student.cookie },
      body: form,
    });
    if (response.status === 200) {
      const body = yield* decodeJson("submit", response, Submitted);
      return { _tag: "Accepted", ...body } satisfies SubmitResponse;
    }
    if (response.status === 409) {
      const body = yield* decodeJson("submit", response, SubmitRejected);
      return { _tag: "Rejected", reason: body.reason } satisfies SubmitResponse;
    }
    if (response.status === 429 || response.status >= 500) {
      return { _tag: "Unavailable", status: response.status } satisfies SubmitResponse;
    }
    return yield* Effect.fail(unexpected("submit", response));
  });
