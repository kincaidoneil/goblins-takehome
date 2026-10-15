import type { GradeStatus } from "@goblins/ui";
import type { StudentGradeRow } from "../../lib/sync";

/** What a student sees for a grade. A score shows only once it is final. */
export function gradeStatus(row: StudentGradeRow): GradeStatus {
  switch (row.state) {
    case "submitted":
    case "grading":
      return { state: "grading" };
    case "graded":
      return row.points === null
        ? { state: "grading" }
        : { state: "graded", points: row.points, maxPoints: row.maxPoints };
    case "needs_teacher":
      return { state: "needs-teacher" };
    case "couldnt_grade":
      return { state: "couldnt-grade" };
  }
}

/** The next problem without a submission after `afterId`, wrapping around to skipped ones. */
export function nextOpenProblem<P extends { id: string }>(
  problems: ReadonlyArray<P>,
  isOpen: (id: string) => boolean,
  afterId: string | null,
): P | null {
  const start = afterId === null ? 0 : problems.findIndex((p) => p.id === afterId) + 1;
  const ordered = [...problems.slice(start), ...problems.slice(0, start)];
  return ordered.find((p) => isOpen(p.id)) ?? null;
}
