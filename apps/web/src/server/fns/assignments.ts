/**
 * Assignment setup: start from a template, read for the review screen, edit, and launch.
 * Problems and rubrics are locked once the assignment has been launched (decision log).
 */
import { Db, randomJoinCode, SqlClient, schema } from "@goblins/domain";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { Data, Effect, Option, Schema } from "effect";
import { currentOwner, ownedAssignment } from "../owner";
import { err, ok } from "../result";
import { run } from "../runtime";
import { createFromTemplate } from "../templates";

const notFound = () => Effect.succeed(err({ _tag: "AssignmentNotFound" } as const));

export const startFromTemplate = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ templateId: Schema.String })))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const owner = yield* currentOwner;
        const created = yield* createFromTemplate(data.templateId, owner);
        return Option.match(created, {
          onNone: () => err({ _tag: "UnknownTemplate" } as const),
          onSome: (assignmentId) => ok({ assignmentId }),
        });
      }),
    ),
  );

const loadAssignment = (assignmentId: string) =>
  Effect.gen(function* () {
    const { assignment, owner } = yield* ownedAssignment(assignmentId);
    const db = yield* Db;
    const problems = yield* db
      .select()
      .from(schema.problems)
      .where(eq(schema.problems.assignmentId, assignmentId))
      .orderBy(asc(schema.problems.position));
    const problemIds = problems.map((p) => p.id);
    const lines =
      problemIds.length === 0
        ? []
        : yield* db
            .select()
            .from(schema.rubricLines)
            .where(inArray(schema.rubricLines.problemId, problemIds))
            .orderBy(asc(schema.rubricLines.position));
    const dependencies =
      problemIds.length === 0
        ? []
        : yield* db
            .select()
            .from(schema.problemDependencies)
            .where(inArray(schema.problemDependencies.problemId, problemIds));
    const pages = yield* db
      .select({
        pageNumber: schema.worksheetPages.pageNumber,
        imageUrl: schema.worksheetPages.imageUrl,
      })
      .from(schema.worksheetPages)
      .where(eq(schema.worksheetPages.assignmentId, assignmentId))
      .orderBy(asc(schema.worksheetPages.pageNumber));
    const [launches] = yield* db
      .select({ n: count() })
      .from(schema.classSessions)
      .where(eq(schema.classSessions.assignmentId, assignmentId));
    const labelById = new Map(problems.map((p) => [p.id, p.label]));
    return {
      id: assignment.id,
      title: assignment.title,
      templateId: assignment.templateId,
      locked: (launches?.n ?? 0) > 0,
      signedIn: owner._tag === "Teacher",
      pages,
      problems: problems.map((problem) => ({
        id: problem.id,
        label: problem.label,
        text: problem.text,
        answerKey: problem.answerKey,
        diagramDescription: problem.diagramDescription,
        gradingNotes: problem.gradingNotes,
        pageNumbers: problem.pageNumbers,
        dependsOn: dependencies
          .filter((d) => d.problemId === problem.id)
          .map((d) => labelById.get(d.dependsOnProblemId) ?? ""),
        rubricLines: lines
          .filter((line) => line.problemId === problem.id)
          .map((line) => ({ id: line.id, points: line.points, description: line.description })),
      })),
    };
  });

export type AssignmentForReview = Effect.Effect.Success<ReturnType<typeof loadAssignment>>;

export const getAssignment = createServerFn({ method: "GET" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ assignmentId: Schema.String })))
  .handler(({ data }) =>
    run(
      loadAssignment(data.assignmentId).pipe(
        Effect.map(ok),
        Effect.catchTag("AssignmentNotFound", notFound),
      ),
    ),
  );

class Locked extends Data.TaggedError("Locked") {}

/** The assignment, if it is owned by the caller and not yet launched. */
const editableAssignment = (assignmentId: string) =>
  Effect.gen(function* () {
    const found = yield* ownedAssignment(assignmentId);
    const db = yield* Db;
    const [launches] = yield* db
      .select({ n: count() })
      .from(schema.classSessions)
      .where(eq(schema.classSessions.assignmentId, assignmentId));
    if ((launches?.n ?? 0) > 0) return yield* Effect.fail(new Locked());
    return found;
  });

const editErrors = {
  AssignmentNotFound: notFound,
  Locked: () => Effect.succeed(err({ _tag: "Locked" } as const)),
};

const Edit = Schema.Union(
  Schema.TaggedStruct("Rename", { title: Schema.String.pipe(Schema.maxLength(120)) }),
  Schema.TaggedStruct("EditProblem", {
    problemId: Schema.UUID,
    field: Schema.Literal("text", "answerKey", "diagramDescription", "gradingNotes"),
    value: Schema.String.pipe(Schema.maxLength(5000)),
  }),
  Schema.TaggedStruct("EditRubricLine", {
    rubricLineId: Schema.UUID,
    points: Schema.Int.pipe(Schema.between(1, 20)),
    description: Schema.String.pipe(Schema.maxLength(500)),
  }),
  Schema.TaggedStruct("AddRubricLine", { problemId: Schema.UUID }),
  Schema.TaggedStruct("RemoveRubricLine", { rubricLineId: Schema.UUID }),
);
export type Edit = typeof Edit.Type;

/** Applies one edit from the review screen. */
export const editAssignment = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ assignmentId: Schema.String, edit: Edit })))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        yield* editableAssignment(data.assignmentId);
        const db = yield* Db;
        const inAssignment = (problemId: string) =>
          and(
            eq(schema.problems.id, problemId),
            eq(schema.problems.assignmentId, data.assignmentId),
          );
        const lineInAssignment = (rubricLineId: string) =>
          Effect.gen(function* () {
            const [line] = yield* db
              .select({ id: schema.rubricLines.id, problemId: schema.rubricLines.problemId })
              .from(schema.rubricLines)
              .innerJoin(schema.problems, eq(schema.problems.id, schema.rubricLines.problemId))
              .where(
                and(
                  eq(schema.rubricLines.id, rubricLineId),
                  eq(schema.problems.assignmentId, data.assignmentId),
                ),
              );
            return Option.fromNullable(line);
          });
        const edit = data.edit;
        switch (edit._tag) {
          case "Rename":
            yield* db
              .update(schema.assignments)
              .set({ title: edit.title })
              .where(eq(schema.assignments.id, data.assignmentId));
            break;
          case "EditProblem":
            yield* db
              .update(schema.problems)
              .set({
                [edit.field]:
                  edit.field === "diagramDescription" && edit.value === "" ? null : edit.value,
              })
              .where(inAssignment(edit.problemId));
            break;
          case "EditRubricLine": {
            if (Option.isNone(yield* lineInAssignment(edit.rubricLineId))) break;
            yield* db
              .update(schema.rubricLines)
              .set({ points: edit.points, description: edit.description })
              .where(eq(schema.rubricLines.id, edit.rubricLineId));
            break;
          }
          case "AddRubricLine": {
            const [problem] = yield* db
              .select({ id: schema.problems.id })
              .from(schema.problems)
              .where(inAssignment(edit.problemId));
            if (problem === undefined) break;
            const [last] = yield* db
              .select({ position: max(schema.rubricLines.position) })
              .from(schema.rubricLines)
              .where(eq(schema.rubricLines.problemId, problem.id));
            yield* db.insert(schema.rubricLines).values({
              problemId: problem.id,
              position: (last?.position ?? -1) + 1,
              points: 1,
              description: "",
            });
            break;
          }
          case "RemoveRubricLine": {
            const line = yield* lineInAssignment(edit.rubricLineId);
            if (Option.isNone(line)) break;
            const [remaining] = yield* db
              .select({ n: count() })
              .from(schema.rubricLines)
              .where(eq(schema.rubricLines.problemId, line.value.problemId));
            // A problem keeps at least one line, so it always has points to award.
            if ((remaining?.n ?? 0) <= 1) return err({ _tag: "LastRubricLine" } as const);
            yield* db
              .delete(schema.rubricLines)
              .where(eq(schema.rubricLines.id, edit.rubricLineId));
            break;
          }
        }
        return ok(null);
      }).pipe(Effect.catchTags(editErrors)),
    ),
  );

/** Launches a class session. Requires a signed-in teacher; the client signs in first. */
export const launch = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        assignmentId: Schema.String,
        timeLimitMinutes: Schema.NullOr(Schema.Int.pipe(Schema.between(1, 240))),
      }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const { assignment, owner } = yield* ownedAssignment(data.assignmentId);
        if (owner._tag !== "Teacher") return err({ _tag: "SignInRequired" } as const);
        const db = yield* Db;
        const sql = yield* SqlClient;
        // A six-digit code collides with an open session rarely; try a few.
        const insert = Effect.suspend(() =>
          db
            .insert(schema.classSessions)
            .values({
              assignmentId: assignment.id,
              teacherId: owner.teacher.id,
              joinCode: randomJoinCode(),
              timeLimitMinutes: data.timeLimitMinutes,
            })
            .returning({ id: schema.classSessions.id }),
        );
        const [session] = yield* sql.withTransaction(insert).pipe(Effect.retry({ times: 4 }));
        if (session === undefined) return yield* Effect.die("session insert returned no row");
        return ok({ sessionId: session.id });
      }).pipe(Effect.catchTag("AssignmentNotFound", notFound)),
    ),
  );
