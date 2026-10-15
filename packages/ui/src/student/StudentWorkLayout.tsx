import type { ReactNode } from "react";

export interface StudentWorkLayoutProps {
  /** The progress strip. */
  progress: ReactNode;
  /** The problem panel, supplied by the app. */
  problem: ReactNode;
  /** The whiteboard. */
  board: ReactNode;
  /** The Submit button. */
  submit: ReactNode;
}

/** Problem on the left and whiteboard on the right; stacked on narrow screens. */
export function StudentWorkLayout({ progress, problem, board, submit }: StudentWorkLayoutProps) {
  return (
    <div className="gb-work">
      <div className="gb-work-progress">{progress}</div>
      <section className="gb-work-problem" aria-label="Problem">
        {problem}
      </section>
      <section className="gb-work-board" aria-label="Your work">
        {board}
        <div className="gb-work-submit">{submit}</div>
      </section>
    </div>
  );
}
