/**
 * Every change to a draft is one of these edits, whether the teacher typed it inline or asked in
 * the chat panel. The chat turns a message into edits; the inline editor sends them directly.
 * `applyEdits` runs a batch in one transaction.
 */
import { Db, SqlClient, schema } from "@goblins/domain";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import { RubricLineInput } from "./extracted";
import { changesScoring, dropPointSentences } from "./rubric-notes";

const ProblemId = Schema.UUID;

export const TextField = Schema.Literal(
  "label",
  "text",
  "answerKey",
  "diagramDescription",
  "gradingNotes",
);
export type TextField = typeof TextField.Type;

export const NewProblem = Schema.Struct({
  label: Schema.NonEmptyString,
  text: Schema.String,
  answerKey: Schema.String,
  diagramDescription: Schema.NullOr(Schema.String),
  pageNumbers: Schema.Array(Schema.Int.pipe(Schema.positive())),
  gradingNotes: Schema.String,
  rubric: Schema.NonEmptyArray(RubricLineInput),
});
export type NewProblem = typeof NewProblem.Type;

export const Edit = Schema.Union(
  Schema.TaggedStruct("SetTitle", { title: Schema.String.pipe(Schema.maxLength(120)) }),
  Schema.TaggedStruct("SetField", {
    problemId: ProblemId,
    field: TextField,
    value: Schema.String.pipe(Schema.maxLength(10_000)),
  }),
  Schema.TaggedStruct("SetGradeWithPageImage", { problemId: ProblemId, value: Schema.Boolean }),
  Schema.TaggedStruct("SetRubric", {
    problemId: ProblemId,
    lines: Schema.NonEmptyArray(RubricLineInput).pipe(Schema.maxItems(12)),
  }),
  Schema.TaggedStruct("AddProblem", {
    /** Null puts it first. */
    afterProblemId: Schema.NullOr(ProblemId),
    problem: NewProblem,
  }),
  Schema.TaggedStruct("RemoveProblem", { problemId: ProblemId }),
  Schema.TaggedStruct("SetDependencies", {
    problemId: ProblemId,
    dependsOn: Schema.Array(ProblemId),
  }),
);
export type Edit = typeof Edit.Type;

/** An edit named a problem that is not in this draft, or would remove its last problem. */
export class EditRejected extends Data.TaggedError("EditRejected")<{
  readonly reason: "unknown_problem" | "last_problem" | "empty_label";
}> {}

// Positions are unique per assignment and the constraint is not deferrable, so shifting a range
// moves it out of the way first and then back to its new place.
const SHIFT = 1_000_000;

const shiftFrom = (draftId: string, position: number, by: 1 | -1) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const inRange = and(
      eq(schema.problems.assignmentId, draftId),
      gte(schema.problems.position, position),
    );
    yield* db
      .update(schema.problems)
      .set({ position: sql`${schema.problems.position} + ${SHIFT}` })
      .where(inRange);
    yield* db
      .update(schema.problems)
      .set({ position: sql`${schema.problems.position} - ${SHIFT} + ${by}` })
      .where(and(eq(schema.problems.assignmentId, draftId), gte(schema.problems.position, SHIFT)));
  });

const applyOne = (draftId: string, edit: Edit) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const problemIn = (problemId: string) =>
      and(eq(schema.problems.id, problemId), eq(schema.problems.assignmentId, draftId));
    const findProblem = (problemId: string) =>
      Effect.gen(function* () {
        const [row] = yield* db.select().from(schema.problems).where(problemIn(problemId));
        if (row === undefined) {
          return yield* Effect.fail(new EditRejected({ reason: "unknown_problem" }));
        }
        return row;
      });

    switch (edit._tag) {
      case "SetTitle":
        yield* db
          .update(schema.assignments)
          .set({ title: edit.title.trim() })
          .where(eq(schema.assignments.id, draftId));
        return;
      case "SetField": {
        yield* findProblem(edit.problemId);
        const value =
          edit.field === "diagramDescription" && edit.value.trim() === "" ? null : edit.value;
        if (edit.field === "label" && edit.value.trim() === "") {
          return yield* Effect.fail(new EditRejected({ reason: "empty_label" }));
        }
        yield* db
          .update(schema.problems)
          .set({ [edit.field]: edit.field === "label" ? edit.value.trim() : value })
          .where(problemIn(edit.problemId));
        return;
      }
      case "SetGradeWithPageImage":
        yield* findProblem(edit.problemId);
        yield* db
          .update(schema.problems)
          .set({ gradeWithPageImage: edit.value })
          .where(problemIn(edit.problemId));
        return;
      case "SetRubric": {
        const problem = yield* findProblem(edit.problemId);
        const before = yield* db
          .select({ points: schema.rubricLines.points })
          .from(schema.rubricLines)
          .where(eq(schema.rubricLines.problemId, edit.problemId))
          .orderBy(asc(schema.rubricLines.position));
        // A note like "a bare answer earns both points" can't be allowed to contradict new points.
        if (changesScoring(before, edit.lines)) {
          const gradingNotes = dropPointSentences(problem.gradingNotes);
          if (gradingNotes !== problem.gradingNotes) {
            yield* db
              .update(schema.problems)
              .set({ gradingNotes })
              .where(problemIn(edit.problemId));
          }
        }
        yield* db
          .delete(schema.rubricLines)
          .where(eq(schema.rubricLines.problemId, edit.problemId));
        yield* db.insert(schema.rubricLines).values(
          edit.lines.map((line, position) => ({
            problemId: edit.problemId,
            position,
            points: line.points,
            description: line.description.trim(),
          })),
        );
        return;
      }
      case "AddProblem": {
        const position =
          edit.afterProblemId === null ? 0 : (yield* findProblem(edit.afterProblemId)).position + 1;
        yield* shiftFrom(draftId, position, 1);
        const [row] = yield* db
          .insert(schema.problems)
          .values({
            assignmentId: draftId,
            position,
            label: edit.problem.label.trim(),
            text: edit.problem.text,
            answerKey: edit.problem.answerKey,
            diagramDescription: edit.problem.diagramDescription,
            pageNumbers: [...edit.problem.pageNumbers],
            gradingNotes: edit.problem.gradingNotes,
          })
          .returning({ id: schema.problems.id });
        if (row === undefined) return yield* Effect.die("problem insert returned no row");
        yield* db.insert(schema.rubricLines).values(
          edit.problem.rubric.map((line, linePosition) => ({
            problemId: row.id,
            position: linePosition,
            points: line.points,
            description: line.description,
          })),
        );
        return;
      }
      case "RemoveProblem": {
        const problem = yield* findProblem(edit.problemId);
        const [count] = yield* db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.problems)
          .where(eq(schema.problems.assignmentId, draftId));
        if ((count?.n ?? 0) <= 1) {
          return yield* Effect.fail(new EditRejected({ reason: "last_problem" }));
        }
        yield* db.delete(schema.problems).where(problemIn(edit.problemId));
        yield* shiftFrom(draftId, problem.position + 1, -1);
        return;
      }
      case "SetDependencies": {
        const problem = yield* findProblem(edit.problemId);
        // Only earlier problems in the same draft: a problem builds on what came before it.
        const earlier =
          edit.dependsOn.length === 0
            ? []
            : yield* db
                .select({ id: schema.problems.id, position: schema.problems.position })
                .from(schema.problems)
                .where(
                  and(
                    eq(schema.problems.assignmentId, draftId),
                    inArray(schema.problems.id, [...edit.dependsOn]),
                  ),
                );
        const valid = earlier.filter((row) => row.position < problem.position);
        yield* db
          .delete(schema.problemDependencies)
          .where(eq(schema.problemDependencies.problemId, edit.problemId));
        if (valid.length > 0) {
          yield* db
            .insert(schema.problemDependencies)
            .values(
              valid.map((row) => ({ problemId: edit.problemId, dependsOnProblemId: row.id })),
            );
        }
        return;
      }
    }
  });

/** Applies the edits in order, all or nothing. */
export const applyEdits = (draftId: string, edits: ReadonlyArray<Edit>) =>
  Effect.gen(function* () {
    const sqlClient = yield* SqlClient;
    yield* sqlClient.withTransaction(
      Effect.forEach(edits, (edit) => applyOne(draftId, edit), { discard: true }),
    );
  });
