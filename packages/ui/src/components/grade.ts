/**
 * What a grade looks like to the UI. Mirrors the PRD's grade states plus
 * "not started"; whether a grade is queued or in flight is not shown.
 */
export type GradeStatus =
  | { readonly state: "not-started" }
  | { readonly state: "grading" }
  | { readonly state: "graded"; readonly points: number; readonly maxPoints: number }
  | { readonly state: "needs-teacher" }
  | { readonly state: "couldnt-grade" };

/** Who is looking. Students never see "needs you" or "couldn't grade". */
export type Audience = "teacher" | "student";

export type ScoreBand = "full" | "partial" | "low";

/** Full credit is its own band; below half is low. */
export function scoreBand(points: number, maxPoints: number): ScoreBand {
  if (maxPoints <= 0 || points >= maxPoints) return "full";
  return points / maxPoints < 0.5 ? "low" : "partial";
}
