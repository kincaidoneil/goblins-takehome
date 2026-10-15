/**
 * The teacher's controls for a class session: read it, start it, end it.
 */
import { Db, schema } from "@goblins/domain";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { ownedSession } from "../access";
import { err, ok } from "../result";
import { run } from "../runtime";
import { currentTeacher } from "../teacher";

const failures = {
  SessionNotFound: () => Effect.succeed(err({ _tag: "SessionNotFound" } as const)),
  NotSignedIn: () => Effect.succeed(err({ _tag: "NotSignedIn" } as const)),
};

const SessionInput = Schema.standardSchemaV1(Schema.Struct({ sessionId: Schema.String }));

/** What the projector and dashboard need besides the live data: the assignment and its problems. */
export const getSession = createServerFn({ method: "GET" })
  .validator(SessionInput)
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const { session, teacher } = yield* ownedSession(data.sessionId);
        const db = yield* Db;
        const [assignment] = yield* db
          .select({ id: schema.assignments.id, title: schema.assignments.title })
          .from(schema.assignments)
          .where(eq(schema.assignments.id, session.assignmentId));
        const problems = yield* db
          .select({
            id: schema.problems.id,
            label: schema.problems.label,
            text: schema.problems.text,
            answerKey: schema.problems.answerKey,
            diagramDescription: schema.problems.diagramDescription,
            diagramCrops: schema.problems.diagramCrops,
          })
          .from(schema.problems)
          .where(eq(schema.problems.assignmentId, session.assignmentId))
          .orderBy(asc(schema.problems.position));
        const lines =
          problems.length === 0
            ? []
            : yield* db
                .select({
                  id: schema.rubricLines.id,
                  problemId: schema.rubricLines.problemId,
                  points: schema.rubricLines.points,
                  description: schema.rubricLines.description,
                })
                .from(schema.rubricLines)
                .where(
                  inArray(
                    schema.rubricLines.problemId,
                    problems.map((p) => p.id),
                  ),
                )
                .orderBy(asc(schema.rubricLines.position));
        const pages = yield* db
          .select({
            pageNumber: schema.worksheetPages.pageNumber,
            imageUrl: schema.worksheetPages.imageUrl,
          })
          .from(schema.worksheetPages)
          .where(eq(schema.worksheetPages.assignmentId, session.assignmentId));
        /** The problem's first diagram, cut from its worksheet page, for the cell detail. */
        const figureOf = (problem: (typeof problems)[number]) => {
          const crop = problem.diagramCrops[0];
          const page = pages.find((p) => p.pageNumber === crop?.page);
          return crop === undefined || page === undefined
            ? null
            : {
                src: page.imageUrl,
                alt: problem.diagramDescription ?? `The diagram for problem ${problem.label}`,
                crop: { x: crop.x, y: crop.y, w: crop.w, h: crop.h },
              };
        };
        return ok({
          id: session.id,
          joinCode: session.joinCode,
          assignmentTitle: assignment?.title ?? "",
          teacher: { name: teacher.name, hideNamesAndScores: teacher.hideNamesAndScores },
          problems: problems.map((problem) => ({
            id: problem.id,
            label: problem.label,
            text: problem.text,
            answerKey: problem.answerKey,
            figure: figureOf(problem),
            rubricLines: lines.filter((line) => line.problemId === problem.id),
          })),
        });
      }).pipe(Effect.catchTags(failures)),
    ),
  );

export const startSession = createServerFn({ method: "POST" })
  .validator(SessionInput)
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        yield* ownedSession(data.sessionId);
        const db = yield* Db;
        yield* db
          .update(schema.classSessions)
          .set({ status: "live", startedAt: new Date() })
          .where(
            and(
              eq(schema.classSessions.id, data.sessionId),
              eq(schema.classSessions.status, "lobby"),
            ),
          );
        return ok(null);
      }).pipe(Effect.catchTags(failures)),
    ),
  );

/** Ends the session. Joins and submissions stop; grading already in progress still finishes. */
export const endSession = createServerFn({ method: "POST" })
  .validator(SessionInput)
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const { session } = yield* ownedSession(data.sessionId);
        if (session.status === "ended") return ok(null);
        const db = yield* Db;
        yield* db
          .update(schema.classSessions)
          .set({ status: "ended", endedAt: new Date() })
          .where(eq(schema.classSessions.id, data.sessionId));
        return ok(null);
      }).pipe(Effect.catchTags(failures)),
    ),
  );

/** The "hide names and scores" toggle. It stays as set until the teacher changes it. */
export const setHideNames = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ hide: Schema.Boolean })))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const teacher = yield* currentTeacher;
        const db = yield* Db;
        yield* db
          .update(schema.teachers)
          .set({ hideNamesAndScores: data.hide })
          .where(eq(schema.teachers.id, teacher.id));
        return ok(null);
      }).pipe(Effect.catchTag("NotSignedIn", failures.NotSignedIn)),
    ),
  );
