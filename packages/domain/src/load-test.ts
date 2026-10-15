/**
 * Load-test data. Requests from a load test carry a run id; the app stamps it on the teacher,
 * assignment and class session it creates, and everything under them inherits it by ownership.
 * Real views filter `load_test_run_id is null`; after a run, `deleteLoadTestRun` removes it all.
 */
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Db, SqlClient } from "./db"
import { assignments, classSessions, modelCalls, teachers } from "./schema"

/** Deletes every row the run created. Students, submissions and grades go by cascade. */
export const deleteLoadTestRun = (runId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const sqlClient = yield* SqlClient
    return yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        const sessions = yield* db
          .delete(classSessions)
          .where(eq(classSessions.loadTestRunId, runId))
          .returning({ id: classSessions.id })
        const assignmentRows = yield* db
          .delete(assignments)
          .where(eq(assignments.loadTestRunId, runId))
          .returning({ id: assignments.id })
        const teacherRows = yield* db
          .delete(teachers)
          .where(eq(teachers.loadTestRunId, runId))
          .returning({ id: teachers.id })
        const calls = yield* db
          .delete(modelCalls)
          .where(eq(modelCalls.loadTestRunId, runId))
          .returning({ id: modelCalls.id })
        return {
          classSessions: sessions.length,
          assignments: assignmentRows.length,
          teachers: teacherRows.length,
          modelCalls: calls.length
        }
      })
    )
  })
