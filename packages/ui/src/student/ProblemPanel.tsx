import type { ReactNode } from "react";

export interface ProblemFigure {
  /** The problem's region of the worksheet page, or the whole page as a fallback. */
  src: string;
  /** What the figure shows, e.g. the grader's diagram description. */
  alt: string;
}

export interface ProblemPanelProps {
  /** As printed, e.g. "3" or "2b". */
  label: string;
  total: number;
  points: number;
  /** The problem text. */
  children: ReactNode;
  /** Shown under the text when the problem has a diagram, so students don't need "See worksheet". */
  figure?: ProblemFigure;
}

/** The problem beside the whiteboard. Text first, then its diagram if it has one. */
export function ProblemPanel({ label, total, points, children, figure }: ProblemPanelProps) {
  return (
    <div className="gb-problem" data-has-figure={figure !== undefined || undefined}>
      <div className="gb-problem-head">
        <span>
          Problem {label} of {total}
        </span>
        <span>
          {points} {points === 1 ? "point" : "points"}
        </span>
      </div>
      <div className="gb-problem-text">{children}</div>
      {figure !== undefined && (
        <img className="gb-problem-figure" src={figure.src} alt={figure.alt} />
      )}
    </div>
  );
}
