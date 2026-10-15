/**
 * The teacher's grade and roster actions on the dashboard. Every action checks that the signed-in
 * teacher owns the session the grade or student belongs to.
 */
import {
  acceptGrade,
  cleanDisplayName,
  Db,
  normalizeName,
  retryGrade,
  SqlClient,
  SubmissionId,
  schema,
  scoreGrade,
} from "@goblins/domain";
import { LinePoint } from "@goblins/domain/grade";
import { MAX_NAME_LENGTH } from "@goblins/domain/names";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import { ownedSession } from "../access";
import { GradeQueue } from "../grading";
import { err, ok } from "../result";
import { run } from "../runtime";

class NotFound extends Data.TaggedError("NotFound") {}

/** The grade's submission, if it belongs to a session the teacher owns. */
const ownedSubmission = (submissionId: string) =>
  Effect.gen(function* () {
    if (!Schema.is(Schema.UUID)(submissionId)) return yield* Effect.fail(new NotFound());
    const db = yield* Db;
    const [submission] = yield* db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, submissionId));
    if (submission === undefined) return yield* Effect.fail(new NotFound());
    yield* ownedSession(submission.sessionId);
    return { ...submission, id: SubmissionId.make(submission.id) };
  });

/** The failures the dashboard reacts to, and what the client sees for each. */
const publicErrors = {
  NotFound: "NotFound",
  SessionNotFound: "NotFound",
  GradeNotFound: "NotFound",
  NotSignedIn: "NotSignedIn",
  GradeStateChanged: "AlreadyResolved",
  LinePointsMismatch: "InvalidPoints",
} as const;
type Expected = { readonly _tag: keyof typeof publicErrors };
const isExpected = (error: unknown): error is Expected =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string" &&
  error._tag in publicErrors;

/** Turns expected failures into `Err` results; anything else still fails the request. */
const expected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error: E): error is E & Expected => isExpected(error),
      (error) => Effect.succeed(err({ _tag: publicErrors[error._tag] })),
    ),
  );

const SubmissionInput = Schema.standardSchemaV1(Schema.Struct({ submissionId: Schema.String }));

/** The whiteboard for the cell detail; the rest of the grade is already synced live. */
export const getWhiteboard = createServerFn({ method: "GET" })
  .validator(SubmissionInput)
  .handler(({ data }) =>
    run(
      ownedSubmission(data.submissionId).pipe(
        Effect.map((submission) =>
          ok({
            whiteboardUrl: submission.whiteboardUrl,
            submittedAt: submission.submittedAt.toISOString(),
          }),
        ),
        expected,
      ),
    ),
  );

/** Accepts the grader's best guess on a grade that needs the teacher. */
export const accept = createServerFn({ method: "POST" })
  .validator(SubmissionInput)
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const submission = yield* ownedSubmission(data.submissionId);
        yield* acceptGrade(submission.id);
        return ok(null);
      }).pipe(expected),
    ),
  );

/** The teacher's own points per rubric line: a rescore, a score for a failed grade, or an override. */
export const score = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({ submissionId: Schema.String, linePoints: Schema.Array(LinePoint) }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const submission = yield* ownedSubmission(data.submissionId);
        yield* scoreGrade(submission.id, data.linePoints);
        return ok(null);
      }).pipe(expected),
    ),
  );

/** Sends a flagged or failed grade back to the grader. */
export const retry = createServerFn({ method: "POST" })
  .validator(SubmissionInput)
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const submission = yield* ownedSubmission(data.submissionId);
        const job = yield* retryGrade(submission.id);
        const queue = yield* GradeQueue;
        yield* queue.enqueue(job);
        return ok(null);
      }).pipe(expected),
    ),
  );

const NameInput = Schema.String.pipe(Schema.maxLength(MAX_NAME_LENGTH));

const checkedName = (name: string) => {
  const displayName = cleanDisplayName(name);
  const nameKey = normalizeName(displayName);
  return nameKey === "" ? null : { displayName, nameKey };
};

/** Renames a student. The new name is what resumes them from now on. */
export const renameStudent = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({ sessionId: Schema.String, studentId: Schema.UUID, name: NameInput }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        yield* ownedSession(data.sessionId);
        const name = checkedName(data.name);
        if (name === null) return err({ _tag: "InvalidName" } as const);
        const db = yield* Db;
        const [taken] = yield* db
          .select({ id: schema.students.id })
          .from(schema.students)
          .where(
            and(
              eq(schema.students.sessionId, data.sessionId),
              eq(schema.students.nameKey, name.nameKey),
            ),
          );
        if (taken !== undefined && taken.id !== data.studentId) {
          return err({ _tag: "NameTaken" } as const);
        }
        yield* db
          .update(schema.students)
          .set(name)
          .where(
            and(
              eq(schema.students.id, data.studentId),
              eq(schema.students.sessionId, data.sessionId),
            ),
          );
        return ok(null);
      }).pipe(expected),
    ),
  );

/**
 * Splits a student who turned out to be two people under one name: the chosen submissions move,
 * with their grades, to a new student. The second student then joins with the new name.
 */
export const splitStudent = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        sessionId: Schema.String,
        studentId: Schema.UUID,
        newName: NameInput,
        submissionIds: Schema.Array(Schema.UUID),
      }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        yield* ownedSession(data.sessionId);
        const name = checkedName(data.newName);
        if (name === null) return err({ _tag: "InvalidName" } as const);
        const db = yield* Db;
        const sql = yield* SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const [original] = yield* db
              .select({ avatarId: schema.students.avatarId })
              .from(schema.students)
              .where(
                and(
                  eq(schema.students.id, data.studentId),
                  eq(schema.students.sessionId, data.sessionId),
                ),
              );
            if (original === undefined) return err({ _tag: "NotFound" } as const);
            const [created] = yield* db
              .insert(schema.students)
              .values({
                sessionId: data.sessionId,
                ...name,
                avatarId: original.avatarId + 1,
              })
              .onConflictDoNothing()
              .returning({ id: schema.students.id });
            if (created === undefined) return err({ _tag: "NameTaken" } as const);
            if (data.submissionIds.length > 0) {
              // The grades follow by the composite foreign key's ON UPDATE CASCADE.
              yield* db
                .update(schema.submissions)
                .set({ studentId: created.id })
                .where(
                  and(
                    eq(schema.submissions.studentId, data.studentId),
                    inArray(schema.submissions.id, [...data.submissionIds]),
                  ),
                );
            }
            return ok({ studentId: created.id });
          }),
        );
      }).pipe(expected),
    ),
  );
