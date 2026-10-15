/**
 * The class report as a pure function of the session's problems, students and grades. The
 * teacher's page feeds it live collections, so it recomputes as pending grades resolve; the
 * share page feeds it a server snapshot with names removed.
 */
import { type ScoreBand, scoreBand } from "@goblins/ui";

export interface ReportProblem {
  readonly id: string;
  /** As printed on the worksheet: "3" or "2b". */
  readonly label: string;
  /** The problem text, with math in LaTeX between \( and \). */
  readonly text: string;
  readonly maxPoints: number;
  readonly rubricLines: ReadonlyArray<RubricLine>;
}

/** One line of the scoring guide: "1 pt: correct setup." */
export interface RubricLine {
  readonly id: string;
  readonly description: string;
  readonly points: number;
}

export interface LinePoints {
  readonly rubricLineId: string;
  readonly points: number;
}

export interface ReportStudent {
  readonly id: string;
  readonly displayName: string;
  readonly avatarId: number;
}

export type GradeState = "submitted" | "grading" | "graded" | "needs_teacher" | "couldnt_grade";

export interface ReportGrade {
  readonly submissionId: string;
  readonly studentId: string;
  readonly problemId: string;
  readonly state: GradeState;
  /** Present only when `state` is `graded`. */
  readonly points: number | null;
  readonly maxPoints: number;
  /** The grader's one-line reason. Null when a teacher scored it without a model result. */
  readonly graderReason: string | null;
  /** Final points per rubric line. Present only when `state` is `graded`. */
  readonly linePoints: ReadonlyArray<LinePoints> | null;
}

export interface ReportInput {
  readonly problems: ReadonlyArray<ReportProblem>;
  readonly students: ReadonlyArray<ReportStudent>;
  readonly grades: ReadonlyArray<ReportGrade>;
}

/** One student's work on one problem, as the report sees it. */
export type Cell =
  | { readonly _tag: "NotSubmitted" }
  /** Queued or with the grader. Resolves without the teacher. */
  | { readonly _tag: "Grading" }
  /** Needs the teacher, or the grader gave up. Resolves when the teacher scores it. */
  | { readonly _tag: "WaitingOnTeacher" }
  | {
      readonly _tag: "Scored";
      readonly points: number;
      readonly maxPoints: number;
      readonly reason: string | null;
      readonly linePoints: ReadonlyArray<LinePoints>;
    };

export const cellOf = (grade: ReportGrade | undefined): Cell => {
  if (grade === undefined) return { _tag: "NotSubmitted" };
  switch (grade.state) {
    case "submitted":
    case "grading":
      return { _tag: "Grading" };
    case "needs_teacher":
    case "couldnt_grade":
      return { _tag: "WaitingOnTeacher" };
    case "graded":
      // The domain's check constraint guarantees points on a graded row.
      return grade.points === null
        ? { _tag: "WaitingOnTeacher" }
        : {
            _tag: "Scored",
            points: grade.points,
            maxPoints: grade.maxPoints,
            reason: grade.graderReason,
            linePoints: grade.linePoints ?? [],
          };
  }
};

/** A student who lost points on a problem, with the grader's reason. */
export interface Miss {
  readonly student: ReportStudent;
  readonly points: number;
  readonly maxPoints: number;
  readonly reason: string | null;
  /** Rubric lines that did not get full points, in rubric order. */
  readonly lostLines: ReadonlyArray<RubricLine>;
}

export interface ProblemStats {
  readonly problem: ReportProblem;
  /** Share of possible points earned on scored work, 0 to 1. Null when nothing is scored yet. */
  readonly average: number | null;
  readonly full: number;
  readonly partial: number;
  readonly low: number;
  readonly grading: number;
  readonly waitingOnTeacher: number;
  readonly notSubmitted: number;
  readonly misses: ReadonlyArray<Miss>;
  /** Students whose grade on this problem is not final yet. */
  readonly pendingStudents: ReadonlyArray<ReportStudent>;
}

export interface StudentResult {
  readonly student: ReportStudent;
  /** Share of possible points on scored work, 0 to 1. Null when nothing is scored yet. */
  readonly score: number | null;
  readonly submitted: number;
  readonly pending: number;
}

export interface Bucket {
  /** e.g. "90–100%" */
  readonly label: string;
  readonly band: ScoreBand;
  readonly students: ReadonlyArray<StudentResult>;
}

export interface ClassReport {
  readonly studentCount: number;
  readonly problemCount: number;
  /** Students who submitted every problem. */
  readonly finished: number;
  readonly submissions: number;
  /** Share of possible points on all scored work, 0 to 1. */
  readonly classAverage: number | null;
  readonly grading: number;
  readonly waitingOnTeacher: number;
  readonly problems: ReadonlyArray<ProblemStats>;
  readonly students: ReadonlyArray<StudentResult>;
  /** Highest scores first. */
  readonly distribution: ReadonlyArray<Bucket>;
  /** Problems where the class struggled, weakest first. Empty when the class did well. */
  readonly weak: ReadonlyArray<ProblemStats>;
}

/** A problem is weak when the class earned less than this share of its points. */
export const WEAK_AVERAGE = 0.75;
/** At most this many weak problems get their own section, so the report stays short. */
export const MAX_WEAK = 3;
/** A problem needs this many scored submissions before its average means anything. */
const MIN_SCORED = 3;

const BUCKETS: ReadonlyArray<{ label: string; min: number; band: ScoreBand }> = [
  { label: "90–100%", min: 0.9, band: "full" },
  { label: "80–89%", min: 0.8, band: "partial" },
  { label: "70–79%", min: 0.7, band: "partial" },
  { label: "60–69%", min: 0.6, band: "low" },
  { label: "Below 60%", min: 0, band: "low" },
];

const lostLines = (
  problem: ReportProblem,
  linePoints: ReadonlyArray<LinePoints>,
): ReadonlyArray<RubricLine> => {
  const got = new Map(linePoints.map((l) => [l.rubricLineId, l.points]));
  return problem.rubricLines.filter((line) => (got.get(line.id) ?? 0) < line.points);
};

const ratio = (earned: number, possible: number): number | null =>
  possible === 0 ? null : earned / possible;

export function buildReport(input: ReportInput): ClassReport {
  const byKey = new Map(input.grades.map((g) => [`${g.studentId}:${g.problemId}`, g]));
  const cell = (studentId: string, problemId: string) =>
    cellOf(byKey.get(`${studentId}:${problemId}`));

  const problems = input.problems.map((problem): ProblemStats => {
    let earned = 0;
    let possible = 0;
    const counts = {
      full: 0,
      partial: 0,
      low: 0,
      grading: 0,
      waitingOnTeacher: 0,
      notSubmitted: 0,
    };
    const misses: Array<Miss> = [];
    const pendingStudents: Array<ReportStudent> = [];
    for (const student of input.students) {
      const c = cell(student.id, problem.id);
      switch (c._tag) {
        case "NotSubmitted":
          counts.notSubmitted++;
          break;
        case "Grading":
          counts.grading++;
          pendingStudents.push(student);
          break;
        case "WaitingOnTeacher":
          counts.waitingOnTeacher++;
          pendingStudents.push(student);
          break;
        case "Scored": {
          earned += c.points;
          possible += c.maxPoints;
          counts[scoreBand(c.points, c.maxPoints)]++;
          if (c.points < c.maxPoints) {
            misses.push({
              student,
              points: c.points,
              maxPoints: c.maxPoints,
              reason: c.reason,
              lostLines: lostLines(problem, c.linePoints),
            });
          }
        }
      }
    }
    misses.sort((a, b) => a.points / a.maxPoints - b.points / b.maxPoints);
    return { problem, average: ratio(earned, possible), ...counts, misses, pendingStudents };
  });

  const students = input.students.map((student): StudentResult => {
    let earned = 0;
    let possible = 0;
    let submitted = 0;
    let pending = 0;
    for (const problem of input.problems) {
      const c = cell(student.id, problem.id);
      if (c._tag !== "NotSubmitted") submitted++;
      if (c._tag === "Grading" || c._tag === "WaitingOnTeacher") pending++;
      if (c._tag === "Scored") {
        earned += c.points;
        possible += c.maxPoints;
      }
    }
    return { student, score: ratio(earned, possible), submitted, pending };
  });

  const scored = students.filter((s) => s.score !== null);
  const distribution = BUCKETS.map((bucket, i): Bucket => {
    const ceiling = BUCKETS[i - 1]?.min ?? Number.POSITIVE_INFINITY;
    return {
      label: bucket.label,
      band: bucket.band,
      students: scored
        .filter((s) => s.score !== null && s.score >= bucket.min && s.score < ceiling)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    };
  });

  const totals = problems.reduce(
    (acc, p) => ({
      grading: acc.grading + p.grading,
      waitingOnTeacher: acc.waitingOnTeacher + p.waitingOnTeacher,
    }),
    { grading: 0, waitingOnTeacher: 0 },
  );

  let earned = 0;
  let possible = 0;
  for (const grade of input.grades) {
    const c = cellOf(grade);
    if (c._tag === "Scored") {
      earned += c.points;
      possible += c.maxPoints;
    }
  }

  const weak = problems
    .filter(
      (p) =>
        p.average !== null &&
        p.average < WEAK_AVERAGE &&
        p.full + p.partial + p.low >= MIN_SCORED &&
        p.misses.length > 0,
    )
    .sort((a, b) => (a.average ?? 0) - (b.average ?? 0))
    .slice(0, MAX_WEAK);

  return {
    studentCount: input.students.length,
    problemCount: input.problems.length,
    finished: students.filter((s) => s.submitted === input.problems.length).length,
    submissions: input.grades.length,
    classAverage: ratio(earned, possible),
    ...totals,
    problems,
    students,
    distribution,
    weak,
  };
}

/**
 * Removes everything that could name a student, for the shared page: names become "Student n",
 * avatars a single one, and the grader's reasons go (the shared page shows only grouped
 * mistakes). The share route runs this on the server, so names never reach the viewer.
 */
export function anonymize(input: ReportInput): ReportInput {
  return {
    problems: input.problems,
    students: input.students.map((s, i) => ({
      id: s.id,
      displayName: `Student ${i + 1}`,
      avatarId: 0,
    })),
    grades: input.grades.map((g) => ({ ...g, graderReason: null })),
  };
}

/** "47%". Rounds to whole percents, which is all a teacher reads. */
export const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Minutes a teacher would spend grading by hand, at about 30 seconds a problem. */
export const SECONDS_PER_PROBLEM = 30;
export const minutesSaved = (report: ClassReport): number => {
  const graded = report.problems.reduce((sum, p) => sum + p.full + p.partial + p.low, 0);
  return Math.round((graded * SECONDS_PER_PROBLEM) / 60);
};
