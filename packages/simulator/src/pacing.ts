/**
 * When each simulated person acts, as offsets from the start of the run. Pure, so the schedule
 * is reproducible from a seed and testable.
 *
 * The PRD's testing day: classes of about 30 start within 2 minutes of the bell; each student
 * makes about 10 submissions over 20–40 minutes. `timeScale` compresses every interval for tests
 * and the demo (0.1 turns 30 minutes into 3). Compressing raises the submission rate, so a
 * compressed run with N students is a heavier load than a real testing day with N students;
 * reports state the rate as well as the head count.
 */
import { chance, type Rng, uniform } from "./rng.ts";

const MINUTE = 60_000;

export interface Pace {
  readonly timeScale: number;
  /** Classes start within this window after the first bell. PRD: 2 minutes. */
  readonly bellSpreadMs: number;
  /** Each student works for between these durations. PRD: 20–40 minutes. */
  readonly workMinMs: number;
  readonly workMaxMs: number;
  /** Students join over this long before their class starts. */
  readonly lobbyMs: number;
  /** Share of students who join after the teacher starts, and how late at most. */
  readonly lateShare: number;
  readonly lateMaxMs: number;
  /** Share of students who close the tab partway and come back by name on a new device. */
  readonly resumeShare: number;
}

export const testingDay: Pace = {
  timeScale: 1,
  bellSpreadMs: 2 * MINUTE,
  workMinMs: 20 * MINUTE,
  workMaxMs: 40 * MINUTE,
  lobbyMs: 1 * MINUTE,
  lateShare: 0.1,
  lateMaxMs: 5 * MINUTE,
  resumeShare: 0.05,
};

export const scaled = (pace: Pace, timeScale: number): Pace => ({ ...pace, timeScale });

export interface StudentPlan {
  /** Offset from run start. */
  readonly joinAtMs: number;
  /**
   * Offsets from the moment the student starts working (the later of the class start and their
   * join) for each submission, in problem order.
   */
  readonly submitOffsetsMs: ReadonlyArray<number>;
  /** Close the tab and resume by name just before this submission index, if set. */
  readonly resumeBefore: number | undefined;
}

export interface ClassPlan {
  /** When the teacher starts the session, from run start. */
  readonly startAtMs: number;
  readonly students: ReadonlyArray<StudentPlan>;
}

export const planClass = (
  rng: Rng,
  pace: Pace,
  options: { readonly students: number; readonly problems: number },
): ClassPlan => {
  const s = pace.timeScale;
  // Everyone needs time to join before the earliest bell.
  const startAtMs = Math.round((pace.lobbyMs + uniform(rng, 0, pace.bellSpreadMs)) * s);
  const students = Array.from({ length: options.students }, (): StudentPlan => {
    const late = chance(rng, pace.lateShare);
    const joinAtMs = Math.round(
      late
        ? startAtMs + uniform(rng, 0, pace.lateMaxMs) * s
        : startAtMs - uniform(rng, 0, pace.lobbyMs) * s,
    );
    const workMs = uniform(rng, pace.workMinMs, pace.workMaxMs) * s;
    // Uneven gaps: some problems take longer than others.
    const weights = Array.from({ length: options.problems }, () => uniform(rng, 0.5, 1.5));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let elapsed = 0;
    const submitOffsetsMs = weights.map((w) => {
      elapsed += (w / total) * workMs;
      return Math.round(elapsed);
    });
    const resumeBefore =
      options.problems > 1 && chance(rng, pace.resumeShare)
        ? 1 + Math.floor(rng.next() * (options.problems - 1))
        : undefined;
    return { joinAtMs, submitOffsetsMs, resumeBefore };
  });
  return { startAtMs, students };
};

/** The last moment anything in the class is scheduled to happen, from run start. */
export const classEndMs = (plan: ClassPlan): number =>
  plan.students.reduce(
    (latest, student) =>
      Math.max(
        latest,
        Math.max(student.joinAtMs, plan.startAtMs) + (student.submitOffsetsMs.at(-1) ?? 0),
      ),
    plan.startAtMs,
  );
