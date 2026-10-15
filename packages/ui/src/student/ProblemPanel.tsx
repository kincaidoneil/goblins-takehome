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
  /** Omitted when the app doesn't show point values to students. */
  points?: number;
  /** The problem text. */
  children: ReactNode;
  /** Shown under the text when the problem has a diagram, so students don't need "See worksheet". */
  figure?: ProblemFigure;
  /** A small control at the right of the header, e.g. the app's "See worksheet" button. */
  action?: ReactNode;
}

/** The problem beside the whiteboard. Text first, then its diagram if it has one. */
export function ProblemPanel({
  label,
  total,
  points,
  children,
  figure,
  action,
}: ProblemPanelProps) {
  return (
    <div className="gb-problem" data-has-figure={figure !== undefined || undefined}>
      <div className="gb-problem-head">
        <h2 className="gb-problem-label">
          Problem {label} of {total}
        </h2>
        {points !== undefined && (
          <span>
            {points} {points === 1 ? "point" : "points"}
          </span>
        )}
        {action}
      </div>
      <div className="gb-problem-text">{children}</div>
      {figure !== undefined && (
        <img className="gb-problem-figure" src={figure.src} alt={figure.alt} />
      )}
    </div>
  );
}
