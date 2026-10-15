import { useEffect, useRef } from "react";
import { cx } from "../cx";
import { type GradeStatus, scoreBand } from "./grade";

export interface StripProblem {
  id: string;
  /** Shown in the tile before a score arrives, e.g. "1" or "2b". */
  label: string;
  status: GradeStatus;
}

export interface ProgressStripProps {
  problems: ReadonlyArray<StripProblem>;
  currentId: string;
  /** Called with an unsubmitted problem's id. Submitted problems are locked. */
  onSelect?: (id: string) => void;
  className?: string;
}

function tone(status: GradeStatus): string {
  switch (status.state) {
    case "not-started":
      return "open";
    case "grading":
      return "grading";
    case "graded":
      return scoreBand(status.points, status.maxPoints);
    case "needs-teacher":
    case "couldnt-grade":
      return "check";
  }
}

function describe(problem: StripProblem): string {
  const name = `Problem ${problem.label}`;
  switch (problem.status.state) {
    case "not-started":
      return name;
    case "grading":
      // "sent", not "submitted": the screen's one button named Submit must stay unambiguous.
      return `${name}, sent, score coming`;
    case "graded":
      return `${name}, ${problem.status.points} out of ${problem.status.maxPoints}`;
    case "needs-teacher":
    case "couldnt-grade":
      return `${name}, your teacher will check this one`;
  }
}

/**
 * The student's row of problems. Doubles as navigation: unsubmitted problems
 * are buttons, submitted ones show their score as it arrives.
 */
export function ProgressStrip({ problems, currentId, onSelect, className }: ProgressStripProps) {
  const navRef = useRef<HTMLElement>(null);
  // On a narrow screen the strip scrolls; keep the current problem in view.
  useEffect(() => {
    navRef.current
      ?.querySelector(`[data-problem-id="${CSS.escape(currentId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentId]);
  return (
    <nav ref={navRef} className={cx("gb-strip", className)} aria-label="Problems">
      <ol className="gb-strip-list">
        {problems.map((problem) => {
          const open = problem.status.state === "not-started";
          const current = problem.id === currentId;
          return (
            <li key={problem.id} className="gb-strip-item">
              <button
                type="button"
                className="gb-strip-tile"
                data-problem-id={problem.id}
                data-tone={tone(problem.status)}
                data-current={current || undefined}
                disabled={!open}
                aria-current={current ? "step" : undefined}
                aria-label={describe(problem)}
                onClick={open && onSelect ? () => onSelect(problem.id) : undefined}
              >
                {!open && <span className="gb-strip-label">{problem.label}</span>}
                <TileContent problem={problem} />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function TileContent({ problem }: { problem: StripProblem }) {
  switch (problem.status.state) {
    case "graded":
      return (
        <span className="gb-strip-score">
          {problem.status.points}
          <span className="gb-strip-max">/{problem.status.maxPoints}</span>
        </span>
      );
    case "grading":
      return <span className="gb-strip-dots" aria-hidden="true" />;
    case "needs-teacher":
    case "couldnt-grade":
      return (
        <svg className="gb-strip-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      );
    case "not-started":
      return <span>{problem.label}</span>;
  }
}
