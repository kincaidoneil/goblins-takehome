import { Avatar } from "../components/Avatar";
import type { GradeStatus } from "../components/grade";
import { ScoreChip } from "../components/ScoreChip";

interface Row {
  prompt: string;
  work: string;
  status: GradeStatus;
}

const ROWS: ReadonlyArray<Row> = [
  {
    prompt: "Find the circumference of a circle with radius 4 cm. Use 3.14 for π.",
    work: "C = 2πr = 2(3.14)(4) = 25.12 cm",
    status: { state: "graded", points: 2, maxPoints: 2 },
  },
  {
    prompt: "A circle has a diameter of 10 in. Find its area.",
    work: "r = 5,  A = πr² = 3.14 × 25 = 78.5 in²",
    status: { state: "graded", points: 2, maxPoints: 2 },
  },
  {
    prompt: "A garden is a circle with radius 6 ft. Find its area.",
    work: "A = 3.14 × 6 × 2 = 37.68",
    status: { state: "graded", points: 1, maxPoints: 2 },
  },
  {
    prompt: "A wheel travels 50.24 ft in one full turn. Find its diameter.",
    work: "d = 50.24 ÷ 3.14 = 1b ft",
    status: { state: "needs-teacher" },
  },
];

const CLASS = [2, 9, 19, 28, 35, 44];

/**
 * The landing page's picture of the product: a student's worksheet, graded,
 * with the class beside it. Chips pop in one after another.
 */
export function GradedWorksheet() {
  return (
    <figure
      className="lp-sheet"
      aria-label="A graded worksheet: three problems scored, one flagged for the teacher"
    >
      <div className="lp-sheet-paper">
        <div className="lp-sheet-head">
          <div>
            <div className="lp-sheet-kicker">Unit 3 quiz · Circles</div>
            <div className="lp-sheet-student">
              <Avatar kind="creature" creatureId={11} size="xs" />
              Maya R.
            </div>
          </div>
          <div className="lp-sheet-total">
            <div>
              <span>5</span>/6
            </div>
            <small>points so far</small>
          </div>
        </div>
        <ol className="lp-sheet-rows">
          {ROWS.map((row, i) => (
            <li
              key={row.prompt}
              className="lp-sheet-row"
              style={{ animationDelay: `${300 + i * 350}ms` }}
            >
              <div className="lp-sheet-text">
                <p className="lp-sheet-prompt">{row.prompt}</p>
                <p className="lp-sheet-work">{row.work}</p>
              </div>
              <ScoreChip status={row.status} className="lp-sheet-chip" />
            </li>
          ))}
        </ol>
        <p className="lp-sheet-reason">
          <strong>Why 4 needs you:</strong> the grader can't tell if the last digit is a 6 or a b.
        </p>
      </div>
      <div className="lp-sheet-class" aria-hidden="true">
        <div className="lp-sheet-avatars">
          {CLASS.map((id) => (
            <Avatar key={id} kind="creature" creatureId={id} size="sm" />
          ))}
        </div>
        <div className="lp-sheet-class-text">
          <strong>28 of 30 graded</strong>
          <span>2 flagged for you to check</span>
        </div>
      </div>
    </figure>
  );
}
