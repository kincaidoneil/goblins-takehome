import type { GradeStatus } from "@goblins/ui";
import type { StudentRow, TeacherGradeRow } from "../../../lib/sync";

export interface DashboardProblem {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly answerKey: string;
  readonly rubricLines: ReadonlyArray<{
    readonly id: string;
    readonly points: number;
    readonly description: string;
  }>;
}

/** How a grade row shows in the grid. Queued and in flight both read as grading. */
export const gradeStatus = (grade: TeacherGradeRow | undefined): GradeStatus => {
  if (grade === undefined) return { state: "not-started" };
  switch (grade.state) {
    case "submitted":
    case "grading":
      return { state: "grading" };
    case "needs_teacher":
      return { state: "needs-teacher" };
    case "couldnt_grade":
      return { state: "couldnt-grade" };
    case "graded":
      return { state: "graded", points: grade.points ?? 0, maxPoints: grade.maxPoints };
  }
};

/** With names hidden, students are numbered in the order they joined. */
export const studentLabel = (student: StudentRow, index: number, hideNames: boolean): string =>
  hideNames ? `Student ${index + 1}` : student.displayName;

export const gradeKey = (studentId: string, problemId: string) => `${studentId}:${problemId}`;
