/**
 * A draft assignment as the setup screens see it: the pages, the problems with rubrics and links,
 * and the chat. Read in one go; setup has one writer (the teacher), so the screen reloads it after
 * each change instead of syncing it live.
 */
import { Db, SqlClient, schema } from "@goblins/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { Extracted } from "./extracted";
import { owns, type Viewer } from "./viewer";

export interface DraftRubricLine {
  readonly id: string;
  readonly points: number;
  readonly description: string;
}

export interface DraftProblem {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly answerKey: string;
  readonly diagramDescription: string | null;
  readonly gradeWithPageImage: boolean;
  readonly pageNumbers: ReadonlyArray<number>;
  readonly gradingNotes: string;
  readonly rubric: ReadonlyArray<DraftRubricLine>;
  /** Ids of earlier problems this one uses. */
  readonly dependsOn: ReadonlyArray<string>;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "teacher" | "assistant";
  readonly content: string;
}

export type DraftStatus =
  | { readonly _tag: "Extracting"; readonly startedAt: string }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Failed"; readonly reason: string };

export interface Draft {
  readonly id: string;
  readonly title: string;
  readonly templateId: string | null;
  readonly status: DraftStatus;
  readonly pages: ReadonlyArray<{ readonly pageNumber: number; readonly imageUrl: string }>;
  readonly problems: ReadonlyArray<DraftProblem>;
  readonly chat: ReadonlyArray<ChatMessage>;
  /** The class session it was launched as. A launched assignment's rubric is locked. */
  readonly launchedSessionId: string | null;
}

/** No draft with this id, or not this viewer's. The same answer for both, so ids don't leak. */
export class DraftNotFound extends Data.TaggedError("DraftNotFound") {}

/** The draft was launched; its rubric can no longer change. */
export class DraftLocked extends Data.TaggedError("DraftLocked")<{ readonly sessionId: string }> {}

/** The assignment row, if the viewer owns it. */
export const ownedAssignment = (viewer: Viewer, draftId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, draftId));
    if (row === undefined || !owns(viewer, row)) return yield* Effect.fail(new DraftNotFound());
    return row;
  });

const launchedSession = (draftId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [session] = yield* db
      .select({ id: schema.classSessions.id })
      .from(schema.classSessions)
      .where(eq(schema.classSessions.assignmentId, draftId))
      .orderBy(asc(schema.classSessions.createdAt))
      .limit(1);
    return session?.id ?? null;
  });

/** Fails with `DraftLocked` once the draft has a class session. */
export const ensureEditable = (draftId: string) =>
  Effect.gen(function* () {
    const sessionId = yield* launchedSession(draftId);
    if (sessionId !== null) return yield* Effect.fail(new DraftLocked({ sessionId }));
  });

export const loadDraft = (viewer: Viewer, draftId: string) =>
  Effect.gen(function* () {
    const assignment = yield* ownedAssignment(viewer, draftId);
    const db = yield* Db;
    const pages = yield* db
      .select({
        pageNumber: schema.worksheetPages.pageNumber,
        imageUrl: schema.worksheetPages.imageUrl,
      })
      .from(schema.worksheetPages)
      .where(eq(schema.worksheetPages.assignmentId, draftId))
      .orderBy(asc(schema.worksheetPages.pageNumber));
    const problems = yield* db
      .select()
      .from(schema.problems)
      .where(eq(schema.problems.assignmentId, draftId))
      .orderBy(asc(schema.problems.position));
    const problemIds = problems.map((problem) => problem.id);
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
    const chat = yield* db
      .select({
        id: schema.assignmentChatMessages.id,
        role: schema.assignmentChatMessages.role,
        content: schema.assignmentChatMessages.content,
      })
      .from(schema.assignmentChatMessages)
      .where(eq(schema.assignmentChatMessages.assignmentId, draftId))
      .orderBy(asc(schema.assignmentChatMessages.createdAt));

    const status: DraftStatus =
      assignment.extractionStatus === "extracting"
        ? { _tag: "Extracting", startedAt: assignment.createdAt.toISOString() }
        : assignment.extractionStatus === "ready"
          ? { _tag: "Ready" }
          : { _tag: "Failed", reason: assignment.extractionFailureReason ?? "" };

    return {
      id: assignment.id,
      title: assignment.title,
      templateId: assignment.templateId,
      status,
      pages,
      problems: problems.map((problem) => ({
        id: problem.id,
        label: problem.label,
        text: problem.text,
        answerKey: problem.answerKey,
        diagramDescription: problem.diagramDescription,
        gradeWithPageImage: problem.gradeWithPageImage,
        pageNumbers: problem.pageNumbers,
        gradingNotes: problem.gradingNotes,
        rubric: lines
          .filter((line) => line.problemId === problem.id)
          .map((line) => ({ id: line.id, points: line.points, description: line.description })),
        dependsOn: dependencies
          .filter((dependency) => dependency.problemId === problem.id)
          .map((dependency) => dependency.dependsOnProblemId),
      })),
      chat,
      launchedSessionId: yield* launchedSession(draftId),
    } satisfies Draft;
  });

/**
 * Writes extracted problems into a draft and marks it ready. Dependency labels that name no
 * earlier problem are dropped: a link can only point back.
 */
export const saveExtracted = (draftId: string, extracted: Extracted) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const sql = yield* SqlClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const ids = new Map<string, string>();
        for (const [position, problem] of extracted.problems.entries()) {
          const [row] = yield* db
            .insert(schema.problems)
            .values({
              assignmentId: draftId,
              position,
              label: problem.label,
              text: problem.text,
              answerKey: problem.answerKey,
              diagramDescription: problem.diagramDescription,
              pageNumbers: [...problem.pageNumbers],
              gradingNotes: problem.gradingNotes,
            })
            .returning({ id: schema.problems.id });
          if (row === undefined) return yield* Effect.die("problem insert returned no row");
          yield* db.insert(schema.rubricLines).values(
            problem.rubric.map((line, linePosition) => ({
              problemId: row.id,
              position: linePosition,
              points: line.points,
              description: line.description,
            })),
          );
          const links = problem.dependsOn.flatMap((label) => {
            const earlier = ids.get(label);
            return earlier === undefined ? [] : [earlier];
          });
          if (links.length > 0) {
            yield* db
              .insert(schema.problemDependencies)
              .values(
                links.map((dependsOnProblemId) => ({ problemId: row.id, dependsOnProblemId })),
              );
          }
          ids.set(problem.label, row.id);
        }
        yield* db
          .update(schema.assignments)
          .set({
            extractionStatus: "ready",
            extractionFailureReason: null,
            ...(extracted.title === "" ? {} : { title: extracted.title }),
          })
          .where(
            and(
              eq(schema.assignments.id, draftId),
              eq(schema.assignments.extractionStatus, "extracting"),
            ),
          );
      }),
    );
  });

export const markExtractionFailed = (draftId: string, reason: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db
      .update(schema.assignments)
      .set({ extractionStatus: "failed", extractionFailureReason: reason })
      .where(eq(schema.assignments.id, draftId));
  });
