/**
 * Drizzle schema for the whole app. Every stream reads and writes through these tables.
 *
 * Conventions:
 * - Ids are UUIDs. The database fills them in, but callers may supply their own so the
 *   client can insert optimistically through TanStack DB.
 * - Tables that Electric syncs to a screen carry `session_id` directly, because an Electric
 *   shape is one table filtered by a `where` clause and cannot join.
 * - Rows created by a load test carry `load_test_run_id` at the top of their ownership tree
 *   (teacher, assignment, class session). Everything below is deleted by cascade.
 * - State columns are enums, and check constraints tie each state to the columns it needs,
 *   so an impossible combination is rejected by Postgres, not just by the app.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DiagramCrop } from "./diagram";
import type { LinePoints } from "./grade";

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Set on rows a load test created, so they can be excluded from real views and deleted. */
const loadTestRunId = () => text();

// ---------------------------------------------------------------------------
// Teachers

export const teachers = pgTable(
  "teachers",
  {
    id: id(),
    /** Clerk user id. Load-test teachers use `loadtest:<run id>:<n>`. */
    clerkUserId: text().notNull().unique(),
    name: text().notNull(),
    email: text(),
    /** The dashboard's "hide names and scores" toggle. It stays on until the teacher turns it off. */
    hideNamesAndScores: boolean().notNull().default(false),
    loadTestRunId: loadTestRunId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.loadTestRunId)],
);

// ---------------------------------------------------------------------------
// Assignments and problems

export const extractionStatus = pgEnum("extraction_status", ["extracting", "ready", "failed"]);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    /** Null until the teacher signs in at launch. Before that the draft belongs to `draftOwnerId`. */
    teacherId: uuid().references(() => teachers.id, { onDelete: "cascade" }),
    /**
     * Random id stored in an anonymous visitor's cookie, so setup works before sign-in.
     * Cleared when the teacher signs in and claims the draft.
     */
    draftOwnerId: uuid(),
    title: text().notNull().default(""),
    /** Set when the assignment was started from a template in `packages/templates`. */
    templateId: text(),
    extractionStatus: extractionStatus().notNull().default("extracting"),
    /** Shown to the teacher when extraction fails, e.g. the worksheet is not math or the photo is unreadable. */
    extractionFailureReason: text(),
    loadTestRunId: loadTestRunId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.teacherId),
    index().on(t.draftOwnerId),
    index().on(t.loadTestRunId),
    check(
      "assignments_has_one_owner",
      sql`(${t.teacherId} is null) <> (${t.draftOwnerId} is null)`,
    ),
    check(
      "assignments_failure_reason_iff_failed",
      sql`(${t.extractionStatus} = 'failed') = (${t.extractionFailureReason} is not null)`,
    ),
  ],
);

/** The original worksheet pages, shown beside the review screen and behind "See worksheet". */
export const worksheetPages = pgTable(
  "worksheet_pages",
  {
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    /** 1-based. */
    pageNumber: integer().notNull(),
    /** Vercel Blob URL of the page image. */
    imageUrl: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.pageNumber] }),
    check("worksheet_pages_page_number_positive", sql`${t.pageNumber} >= 1`),
  ],
);

export const problems = pgTable(
  "problems",
  {
    id: id(),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    /** Order on the worksheet, 0-based. Unique per assignment. */
    position: integer().notNull(),
    /** The label printed on the worksheet, e.g. "3" or "2b". */
    label: text().notNull(),
    text: text().notNull(),
    answerKey: text().notNull(),
    /** Plain-language description of any diagram, for the grader and the teacher. */
    diagramDescription: text(),
    /**
     * Where each of the problem's figures sits on the page images, so a screen can show the figure
     * alone. Empty when there is no diagram or its position is unknown (extraction gives none).
     */
    diagramCrops: jsonb().$type<ReadonlyArray<DiagramCrop>>().notNull().default(sql`'[]'::jsonb`),
    /** The teacher marked this problem as needing the page image to grade. */
    gradeWithPageImage: boolean().notNull().default(false),
    /** Pages the problem appears on. A problem that runs across two pages lists both. */
    pageNumbers: integer().array().notNull().default(sql`'{}'::integer[]`),
    /** Rubric-wide guidance that is not a point line, e.g. "Accept equivalent forms." */
    gradingNotes: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.assignmentId, t.position),
    check("problems_position_nonnegative", sql`${t.position} >= 0`),
  ],
);

/**
 * "2b uses your answer to 2a": `problemId` depends on `dependsOnProblemId`. The grader gets the
 * student's work on the earlier problem and gives follow-through credit.
 */
export const problemDependencies = pgTable(
  "problem_dependencies",
  {
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    dependsOnProblemId: uuid()
      .notNull()
      .references((): AnyPgColumn => problems.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.problemId, t.dependsOnProblemId] }),
    index().on(t.dependsOnProblemId),
    check("problem_dependencies_not_self", sql`${t.problemId} <> ${t.dependsOnProblemId}`),
  ],
);

/** One line of an AP-style scoring guide: "1 pt: correct setup." */
export const rubricLines = pgTable(
  "rubric_lines",
  {
    id: id(),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    /** Order within the problem, 0-based. */
    position: integer().notNull(),
    points: integer().notNull(),
    description: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.problemId, t.position),
    check("rubric_lines_points_positive", sql`${t.points} > 0`),
    check("rubric_lines_position_nonnegative", sql`${t.position} >= 0`),
  ],
);

export const chatRole = pgEnum("chat_role", ["teacher", "assistant"]);

/** The setup chat panel: "make problem 3 worth 4 points." */
export const assignmentChatMessages = pgTable(
  "assignment_chat_messages",
  {
    id: id(),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    role: chatRole().notNull(),
    content: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.assignmentId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Class sessions, students, submissions and grades

export const classSessionStatus = pgEnum("class_session_status", ["lobby", "live", "ended"]);

/** One launch of an assignment to one class. Named to avoid confusion with auth sessions. */
export const classSessions = pgTable(
  "class_sessions",
  {
    id: id(),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    /** Denormalized from the assignment so access checks and shapes need no join. */
    teacherId: uuid()
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    /** Six digits, unique among sessions that have not ended. */
    joinCode: text().notNull(),
    status: classSessionStatus().notNull().default("lobby"),
    /** Null means no time limit. The projector counts down from `startedAt`. */
    timeLimitMinutes: integer(),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    /** Random token for the view-only report link. Null until the teacher shares it. */
    reportShareToken: text().unique(),
    loadTestRunId: loadTestRunId(),
    /**
     * The mock model spec a load test asked for (`x-goblins-mock-model`), e.g.
     * `mode=sampled; profile=seed; scenario=provider-down; start=…`. The grading consumer reads it
     * at claim time, since it never sees the load test's HTTP requests. Null outside load tests.
     */
    loadTestMockSpec: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("class_sessions_open_join_code").on(t.joinCode).where(sql`${t.status} <> 'ended'`),
    index().on(t.teacherId),
    index().on(t.assignmentId),
    index().on(t.loadTestRunId),
    check("class_sessions_join_code_format", sql`${t.joinCode} ~ '^[0-9]{6}$'`),
    check(
      "class_sessions_time_limit_positive",
      sql`${t.timeLimitMinutes} is null or ${t.timeLimitMinutes} > 0`,
    ),
    check(
      "class_sessions_status_timestamps",
      sql`case ${t.status}
        when 'lobby' then ${t.startedAt} is null and ${t.endedAt} is null
        when 'live' then ${t.startedAt} is not null and ${t.endedAt} is null
        when 'ended' then ${t.endedAt} is not null
      end`,
    ),
  ],
);

export const students = pgTable(
  "students",
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    /** As the student typed it, trimmed: "Maya R." */
    displayName: text().notNull(),
    /** `normalizeName(displayName)`. Entering a name with the same key resumes this student. */
    nameKey: text().notNull(),
    /** Creature avatar id from `packages/ui` (0 to `CREATURE_COUNT - 1`). */
    avatarId: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.sessionId, t.nameKey),
    check("students_name_key_not_empty", sql`${t.nameKey} <> ''`),
    check("students_avatar_id_nonnegative", sql`${t.avatarId} >= 0`),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    studentId: uuid()
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    /** Vercel Blob URL of the whiteboard PNG. */
    whiteboardUrl: text().notNull(),
    /** When the student pressed Submit, from the client. Differs from `createdAt` after an offline retry. */
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // A submitted problem is locked, so a student has at most one submission per problem.
    // This also makes an offline retry of the same submit a no-op.
    uniqueIndex().on(t.studentId, t.problemId),
    // Target of the composite foreign key from `grades`, which keeps a grade's copies in step.
    unique("submissions_grade_link").on(t.id, t.sessionId, t.studentId, t.problemId),
    index().on(t.sessionId),
    index().on(t.problemId),
  ],
);

export const gradeState = pgEnum("grade_state", [
  "submitted",
  "grading",
  "graded",
  "needs_teacher",
  "couldnt_grade",
]);

/** Who decided the final score of a graded grade. */
export const gradeSource = pgEnum("grade_source", [
  "model",
  "teacher_accepted",
  "teacher_scored",
  "teacher_override",
]);

/**
 * One grade per submission. See `grade.ts` for the state machine and the tagged union that
 * this row decodes into; the check constraints below mirror it.
 *
 * Idempotency: every grading attempt has a number. A queue message carries the attempt it was
 * sent for, and every pipeline write matches on it, so a redelivered or stale message changes
 * nothing.
 */
export const grades = pgTable(
  "grades",
  {
    // The submission's id, session, student and problem, copied so Electric can filter grades
    // without a join. A composite foreign key keeps them equal to the submission's: moving a
    // submission to another student (a split) cascades here.
    submissionId: uuid().primaryKey(),
    sessionId: uuid().notNull(),
    studentId: uuid().notNull(),
    problemId: uuid().notNull(),
    state: gradeState().notNull().default("submitted"),
    /** Starts at 1. A teacher retry starts the next attempt. */
    attempt: integer().notNull().default(1),
    /** Sum of the problem's rubric line points when the submission was made. */
    maxPoints: integer().notNull(),

    // What the model returned. Present in `graded` (when the model graded it) and `needs_teacher`.
    /** What the grader read from the whiteboard. */
    graderRead: text(),
    /** Points per rubric line, as the model scored them. */
    modelLinePoints: jsonb().$type<LinePoints>(),
    /** The one-line reason for the score. */
    graderReason: text(),
    /** Why the model is unsure. Present only in `needs_teacher`, or after the teacher resolved one. */
    flagReason: text(),

    /** Why the last attempt failed after retries. Present only in `couldnt_grade`. */
    failureReason: text(),

    // The final result. Present only in `graded`.
    source: gradeSource(),
    /** Final points per rubric line. Equals `modelLinePoints` unless a teacher scored it. */
    linePoints: jsonb().$type<LinePoints>(),
    points: integer(),
    gradedAt: timestamp({ withTimezone: true }),

    // Pipeline timing, for the load test and usage reports. Teacher actions leave them alone.
    /** When a consumer claimed the current attempt. A claim older than the lease can be taken over. */
    claimedAt: timestamp({ withTimezone: true }),
    /**
     * Fencing token for the current claim. `recordOutcome` must present it, so a consumer whose
     * lease expired and was taken over cannot overwrite the new holder's result.
     */
    claimId: uuid(),
    /** When the pipeline recorded the current attempt's outcome. */
    outcomeAt: timestamp({ withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "grades_submission_fk",
      columns: [t.submissionId, t.sessionId, t.studentId, t.problemId],
      foreignColumns: [
        submissions.id,
        submissions.sessionId,
        submissions.studentId,
        submissions.problemId,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index().on(t.sessionId),
    index().on(t.studentId),
    index().on(t.problemId),
    // For the sweeper: the few grades still waiting on the pipeline.
    index("grades_open_by_updated_at")
      .on(t.updatedAt)
      .where(sql`${t.state} in ('submitted', 'grading')`),
    check("grades_attempt_positive", sql`${t.attempt} >= 1`),
    check("grades_max_points_positive", sql`${t.maxPoints} > 0`),
    check(
      "grades_points_in_range",
      sql`${t.points} is null or (${t.points} >= 0 and ${t.points} <= ${t.maxPoints})`,
    ),
    check(
      "grades_final_fields_iff_graded",
      sql`(${t.state} = 'graded') = (
        ${t.source} is not null and ${t.linePoints} is not null
        and ${t.points} is not null and ${t.gradedAt} is not null
      )`,
    ),
    check(
      "grades_failure_iff_couldnt_grade",
      sql`(${t.state} = 'couldnt_grade') = (${t.failureReason} is not null)`,
    ),
    check(
      "grades_model_result_complete",
      sql`(${t.graderRead} is null) = (${t.modelLinePoints} is null)
        and (${t.graderRead} is null) = (${t.graderReason} is null)`,
    ),
    check(
      "grades_needs_teacher_has_model_result",
      sql`${t.state} <> 'needs_teacher' or (${t.graderRead} is not null and ${t.flagReason} is not null)`,
    ),
    check(
      "grades_model_source_has_model_result",
      sql`${t.source} is distinct from 'model' or ${t.graderRead} is not null`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Report

/**
 * The report's common mistakes for one weak problem, as a model grouped them from the graders'
 * reasons. Cached so a report or a shared link opened many times pays for one call. The key
 * includes a hash of the grades it was made from, so a resolved or rescored grade makes a new
 * row instead of serving a stale grouping.
 */
export const reportMistakeGroups = pgTable(
  "report_mistake_groups",
  {
    sessionId: uuid()
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    /** Hash of the missed grades the grouping was made from (ids, points and reasons). */
    inputHash: text().notNull(),
    /** The skill the problem practices, in a few words. */
    skill: text().notNull(),
    /** `[{ description, studentIds }]`, validated by the report before use. */
    groups: jsonb()
      .$type<ReadonlyArray<{ description: string; studentIds: ReadonlyArray<string> }>>()
      .notNull(),
    model: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.problemId, t.inputHash] })],
);

// ---------------------------------------------------------------------------
// Model call log

export const modelCallStatus = pgEnum("model_call_status", [
  "ok",
  "rate_limited",
  "timeout",
  "provider_error",
  "bad_response",
  /** The caller stopped waiting, e.g. the function shut down mid-call. */
  "interrupted",
]);

/**
 * Every model call, real or mock, with latency, status, tokens and cost. Feeds the usage report,
 * cost projections and the mock model's replay. The grading pipeline stream owns how it is written.
 */
export const modelCalls = pgTable(
  "model_calls",
  {
    id: id(),
    /** What the call was for, e.g. "grade", "extract", "chat". */
    purpose: text().notNull(),
    /** "openrouter" or "mock". */
    provider: text().notNull(),
    /** The model requested. */
    model: text().notNull(),
    /** The model that answered, when it differs or is known (OpenRouter may route). */
    modelAnswered: text(),
    status: modelCallStatus().notNull(),
    /** HTTP status, or the code in an OpenRouter error body. Null when there was no response. */
    statusCode: integer(),
    /** The provider's id for the generation, for reconciling cost with OpenRouter. */
    providerId: text(),
    latencyMs: integer().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    /** Reasoning tokens, when the model reports them separately. */
    reasoningTokens: integer(),
    costUsd: numeric({ precision: 12, scale: 8, mode: "number" }),
    /** Set for grading calls. Not a foreign key: the log outlives deleted submissions. */
    submissionId: uuid(),
    /** What the call was about when it is not a submission, e.g. an assignment for extraction. */
    subjectId: text(),
    attempt: integer(),
    errorMessage: text(),
    loadTestRunId: loadTestRunId(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.createdAt), index().on(t.loadTestRunId), index().on(t.submissionId)],
);

// ---------------------------------------------------------------------------
// Abuse limits

/**
 * Fixed-window request counters for the join, submit and grading limits (see rate-limit.ts).
 * One row per key and window; windows older than a day are deleted as new ones open.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index().on(t.windowStart)],
);
