import type { GradeStatus } from "../components/grade";
import type { GridProblem, GridStudent } from "./ClassGrid";

const NAMES = [
  "Maya R.",
  "Jordan T.",
  "Ava P.",
  "Liam K.",
  "Sofia M.",
  "Noah B.",
  "Emma W.",
  "Ethan L.",
  "Zoe H.",
  "Lucas G.",
  "Mia C.",
  "Owen D.",
  "Chloe S.",
  "Mateo V.",
  "Lily N.",
  "Elijah F.",
];

/** A mid-session class for stories: 16 students, 8 problems, grades in every state. */
export const STUDENTS: ReadonlyArray<GridStudent> = NAMES.map((name, i) => ({
  id: `s${i}`,
  name,
  creatureId: (i * 7) % 48,
}));

export const PROBLEMS: ReadonlyArray<GridProblem> = ["1", "2", "3a", "3b", "4", "5", "6", "7"].map(
  (label, i) => ({ id: `p${i}`, label, maxPoints: i === 4 ? 4 : 2 }),
);

/** Deterministic: earlier problems are further along, a few cells need the teacher. */
export function fixtureStatus(studentId: string, problemId: string): GradeStatus {
  const s = Number(studentId.slice(1));
  const p = Number(problemId.slice(1));
  const max = p === 4 ? 4 : 2;
  const progress = 8 - (s % 5);
  if (p >= progress) return { state: "not-started" };
  if (p === progress - 1) return { state: "grading" };
  if ((s * 3 + p) % 17 === 0) return { state: "needs-teacher" };
  if (s === 3 && p === 1) return { state: "couldnt-grade" };
  const points = (s + p) % 4 === 0 ? Math.floor(max / 2) : (s * p) % 7 === 3 ? 0 : max;
  return { state: "graded", points, maxPoints: max };
}
