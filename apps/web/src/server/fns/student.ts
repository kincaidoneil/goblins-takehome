/**
 * The student's reads and writes for one session: what to work on, and submitting a whiteboard.
 * Both check the signed student cookie set by `join`; neither sends the answer key or rubric.
 */
import { randomUUID } from "node:crypto";
import { Db, schema, submitWork } from "@goblins/domain";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { GradeQueue } from "../grading";
import { err, ok } from "../result";
import { run } from "../runtime";
import { studentFromCookies } from "../student-identity";
import { WhiteboardStore } from "../whiteboards";

/** No valid student cookie for this session. `joinCode` is set while the session is open. */
export type NotJoined = { readonly _tag: "NotJoined"; readonly joinCode: string | null };

const notJoined = (joinCode: string | null) => err<NotJoined>({ _tag: "NotJoined", joinCode });

const cookieStudent = (sessionId: string) =>
  studentFromCookies(getRequest().headers.get("cookie"), sessionId);

// ---------------------------------------------------------------------------
// Read

const WorkInput = Schema.Struct({ sessionId: Schema.UUID });

/** The signed-in student, the session's problems in order, worksheet pages, and what they sent. */
export const getStudentWork = createServerFn({ method: "GET" })
  .validator(Schema.standardSchemaV1(WorkInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const db = yield* Db;
        const [session] = yield* db
          .select({
            assignmentId: schema.classSessions.assignmentId,
            joinCode: schema.classSessions.joinCode,
            status: schema.classSessions.status,
            startedAt: schema.classSessions.startedAt,
            timeLimitMinutes: schema.classSessions.timeLimitMinutes,
          })
          .from(schema.classSessions)
          .where(eq(schema.classSessions.id, data.sessionId));
        if (session === undefined) return notJoined(null);
        const openCode = session.status === "ended" ? null : session.joinCode;

        const studentId = yield* cookieStudent(data.sessionId);
        if (Option.isNone(studentId)) return notJoined(openCode);
        const [student] = yield* db
          .select({
            id: schema.students.id,
            displayName: schema.students.displayName,
            avatarId: schema.students.avatarId,
          })
          .from(schema.students)
          .where(
            and(
              eq(schema.students.id, studentId.value),
              eq(schema.students.sessionId, data.sessionId),
            ),
          );
        // The teacher may have split or removed this student.
        if (student === undefined) return notJoined(openCode);

        const problems = yield* db
          .select({
            id: schema.problems.id,
            label: schema.problems.label,
            text: schema.problems.text,
            diagramDescription: schema.problems.diagramDescription,
            pageNumbers: schema.problems.pageNumbers,
          })
          .from(schema.problems)
          .where(eq(schema.problems.assignmentId, session.assignmentId))
          .orderBy(asc(schema.problems.position));
        const pages = yield* db
          .select({
            pageNumber: schema.worksheetPages.pageNumber,
            imageUrl: schema.worksheetPages.imageUrl,
          })
          .from(schema.worksheetPages)
          .where(eq(schema.worksheetPages.assignmentId, session.assignmentId))
          .orderBy(asc(schema.worksheetPages.pageNumber));
        const submitted = yield* db
          .select({ problemId: schema.submissions.problemId })
          .from(schema.submissions)
          .where(eq(schema.submissions.studentId, student.id));

        return ok({
          student,
          session: {
            status: session.status,
            startedAt: session.startedAt?.toISOString() ?? null,
            timeLimitMinutes: session.timeLimitMinutes,
          },
          problems,
          pages,
          submittedProblemIds: submitted.map((row) => row.problemId),
        });
      }),
    ),
  );

export type StudentWork = Extract<Awaited<ReturnType<typeof getStudentWork>>, { _tag: "Ok" }>["value"];

// ---------------------------------------------------------------------------
// Submit

/** A whiteboard PNG is well under this; the cap keeps a request within Vercel's body limit. */
const MAX_PNG_BASE64_LENGTH = 4_000_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const SubmitInput = Schema.Struct({
  sessionId: Schema.UUID,
  problemId: Schema.UUID,
  /** The whiteboard as base64 PNG, without a `data:` prefix. */
  png: Schema.String.pipe(Schema.maxLength(MAX_PNG_BASE64_LENGTH)),
  /** When the student pressed Submit. Later than now only if the device clock is off. */
  submittedAt: Schema.DateFromString,
});

export type SubmitError =
  | NotJoined
  /** The teacher ended the session (or has not started it). */
  | { readonly _tag: "SessionNotLive" }
  /** The problem is not in this session's assignment. */
  | { readonly _tag: "UnknownProblem" }
  | { readonly _tag: "InvalidImage" };

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);

/**
 * Stores the whiteboard and records the submission. Safe to retry: `submitWork` is idempotent per
 * student and problem, and a retry re-enqueues a job that may have been lost. A retry stores the
 * PNG again; the first one stays on the submission.
 */
export const submit = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(SubmitInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const studentId = yield* cookieStudent(data.sessionId);
        if (Option.isNone(studentId)) return err<SubmitError>({ _tag: "NotJoined", joinCode: null });

        const png = new Uint8Array(Buffer.from(data.png, "base64"));
        if (!isPng(png)) return err<SubmitError>({ _tag: "InvalidImage" });

        const store = yield* WhiteboardStore;
        const whiteboardUrl = yield* store.put(
          `${data.sessionId}-${data.problemId}-${randomUUID()}.png`,
          png,
        );
        const now = new Date();
        const result = yield* submitWork({
          sessionId: data.sessionId,
          studentId: studentId.value,
          problemId: data.problemId,
          whiteboardUrl,
          submittedAt: data.submittedAt > now ? now : data.submittedAt,
        });
        if (Option.isSome(result.job)) {
          const queue = yield* GradeQueue;
          yield* queue.enqueue(result.job.value);
        }
        return ok({ submissionId: result.submissionId, problemId: data.problemId });
      }).pipe(
        Effect.catchTag("SubmissionRejected", (rejected) =>
          Effect.succeed(
            err<SubmitError>(
              rejected.reason === "session_not_live"
                ? { _tag: "SessionNotLive" }
                : rejected.reason === "unknown_student"
                  ? { _tag: "NotJoined", joinCode: null }
                  : { _tag: "UnknownProblem" },
            ),
          ),
        ),
      ),
    ),
  );
