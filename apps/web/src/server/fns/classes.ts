/**
 * The teacher's home: every assignment they own, newest first, with its class sessions. This is
 * how a teacher picks up on another device.
 */
import { Db, schema } from "@goblins/domain";
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { err, ok } from "../result";
import { run } from "../runtime";
import { currentTeacher } from "../teacher";

export interface ClassSessionSummary {
  readonly id: string;
  readonly status: "lobby" | "live" | "ended";
  readonly joinCode: string;
  readonly createdAt: string;
  readonly studentCount: number;
}

export interface AssignmentSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  /** Newest first. Empty means the assignment is still a draft in setup. */
  readonly sessions: ReadonlyArray<ClassSessionSummary>;
}

export const listClasses = createServerFn({ method: "GET" }).handler(() =>
  run(
    Effect.gen(function* () {
      const teacher = yield* currentTeacher;
      const db = yield* Db;
      const assignments = yield* db
        .select({
          id: schema.assignments.id,
          title: schema.assignments.title,
          createdAt: schema.assignments.createdAt,
        })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.teacherId, teacher.id),
            isNull(schema.assignments.loadTestRunId),
          ),
        )
        .orderBy(desc(schema.assignments.createdAt));
      const sessions =
        assignments.length === 0
          ? []
          : yield* db
              .select({
                id: schema.classSessions.id,
                assignmentId: schema.classSessions.assignmentId,
                status: schema.classSessions.status,
                joinCode: schema.classSessions.joinCode,
                createdAt: schema.classSessions.createdAt,
                studentCount: count(schema.students.id),
              })
              .from(schema.classSessions)
              .leftJoin(schema.students, eq(schema.students.sessionId, schema.classSessions.id))
              .where(
                inArray(
                  schema.classSessions.assignmentId,
                  assignments.map((a) => a.id),
                ),
              )
              .groupBy(schema.classSessions.id)
              .orderBy(desc(schema.classSessions.createdAt));
      return ok(
        assignments.map(
          (a): AssignmentSummary => ({
            id: a.id,
            title: a.title,
            createdAt: a.createdAt.toISOString(),
            sessions: sessions
              .filter((s) => s.assignmentId === a.id)
              .map((s) => ({
                id: s.id,
                status: s.status,
                joinCode: s.joinCode,
                createdAt: s.createdAt.toISOString(),
                studentCount: s.studentCount,
              })),
          }),
        ),
      );
    }).pipe(
      Effect.catchTag("NotSignedIn", () => Effect.succeed(err({ _tag: "NotSignedIn" } as const))),
    ),
  ),
);
