/**
 * Limits that keep one person from running up the grading bill or guessing join codes. Counters
 * live in Postgres (`@goblins/domain`'s `consume`). Load-test requests skip the request limits,
 * and load-test sessions skip the student cap and the grading cap.
 *
 * Per-address limits are generous because a school puts a whole class behind one address.
 */
import { consume, Db, type Limit, schema, usedUp } from "@goblins/domain";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { GradeQueue } from "./grading";

/**
 * The client's address as Vercel reports it (Vercel sets both headers and drops any the client
 * sent). Null off Vercel, as in local development and E2E, unless a test sets the header.
 */
export const clientIp = (headers: Headers): string | null =>
  headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

const perMinute = (key: string, max: number): Limit => ({ key, max, windowSeconds: 60 });

export const limits = {
  /** Every join attempt from one address. A class of 60 joining at the bell fits. */
  join: (ip: string) => perMinute(`join:ip:${ip}`, 120),
  /** Join attempts with a code no open class has: what guessing codes looks like. */
  joinMiss: (ip: string) => perMinute(`join-miss:ip:${ip}`, 20),
  /** One student sends one board per problem; retries and a fast student fit. */
  submitStudent: (studentId: string) => perMinute(`submit:student:${studentId}`, 30),
  submitIp: (ip: string) => perMinute(`submit:ip:${ip}`, 600),
  /** Grade jobs sent per teacher per hour, across all their classes. */
  gradesTeacher: (teacherId: string): Limit => ({
    key: `grades:teacher:${teacherId}`,
    max: 1000,
    windowSeconds: 3600,
  }),
  /** Marks a grade attempt as charged to its teacher, so resends of it aren't charged again. */
  gradeAttempt: (submissionId: string, attempt: number): Limit => ({
    key: `grade-attempt:${submissionId}:${attempt}`,
    max: 1,
    windowSeconds: 86_400,
  }),
} as const;

/** Whether a join from this address may go ahead. Counts the attempt. */
export const joinAllowed = (ip: string | null) =>
  ip === null
    ? Effect.succeed(true)
    : Effect.gen(function* () {
        if (yield* usedUp(limits.joinMiss(ip))) return false;
        return yield* consume(limits.join(ip));
      });

/** Records a join with a code that matched no open class. */
export const joinMissed = (ip: string | null) =>
  ip === null ? Effect.void : Effect.asVoid(consume(limits.joinMiss(ip)));

/** Whether a submission may go ahead. Counts it against the student and the address. */
export const submitAllowed = (studentId: string, ip: string | null) =>
  Effect.gen(function* () {
    if (!(yield* consume(limits.submitStudent(studentId)))) return false;
    return ip === null ? true : yield* consume(limits.submitIp(ip));
  });

/**
 * Wraps the grade queue so a teacher's classes start at most `limits.gradesTeacher` grade
 * attempts an hour.
 * A job over the cap isn't sent; its grade stays queued and the sweeper resends it once the
 * hour rolls over.
 */
export const cappedGradeQueue = Layer.effect(
  GradeQueue,
  Effect.gen(function* () {
    const queue = yield* GradeQueue;
    const db = yield* Db;
    return {
      enqueue: (job, dedupeKey) =>
        Effect.gen(function* () {
          const [owner] = yield* db
            .select({
              teacherId: schema.classSessions.teacherId,
              loadTestRunId: schema.classSessions.loadTestRunId,
            })
            .from(schema.submissions)
            .innerJoin(
              schema.classSessions,
              eq(schema.classSessions.id, schema.submissions.sessionId),
            )
            .where(eq(schema.submissions.id, job.submissionId));
          // Each grade attempt is charged once; the sweeper's resends of it are free.
          const attempt = limits.gradeAttempt(job.submissionId, job.attempt);
          if (owner !== undefined && owner.loadTestRunId === null && !(yield* usedUp(attempt))) {
            if (!(yield* consume(limits.gradesTeacher(owner.teacherId)))) {
              return yield* Effect.logWarning(
                "Grade job held: the teacher's hourly cap is used up",
                { teacherId: owner.teacherId, submissionId: job.submissionId },
              );
            }
            yield* consume(attempt);
          }
          yield* queue.enqueue(job, dedupeKey);
        }).pipe(
          // A failed cap check sends the job anyway: grading matters more than the cap.
          Effect.catchAllCause((cause) =>
            Effect.logError("Grade cap check failed", cause).pipe(
              Effect.zipRight(queue.enqueue(job, dedupeKey)),
            ),
          ),
          Effect.provideService(Db, db),
        ),
    };
  }),
);
