import { useEffect } from "react";
import { CreatureArt } from "../components/creatures";
import type { GradeStatus } from "../components/grade";
import { ScoreChip } from "../components/ScoreChip";

/** How long the transition stays up before the next problem opens. */
export const TRANSITION_MS = 1500;

const CHEERS = [
  "Nice work!",
  "Got it!",
  "Sent!",
  "Way to show your work!",
  "Done and dusted!",
] as const;

export interface SubmitTransitionProps {
  /** The student's own creature, so the cheer comes from their avatar. */
  creatureId: number;
  /** Picks the cheer, so it varies by problem but renders the same on server and client. */
  problemIndex: number;
  /** Label of the next problem, or undefined after the last one. */
  nextLabel: string | undefined;
  /** The grade, if it arrives during the transition. Students never see "needs you" or "couldn't grade". */
  grade: GradeStatus;
  onDone: () => void;
}

/**
 * The ~1.5 s moment between problems: a cheer about the effort first, the
 * score only if it is already in, then on to the next problem.
 */
export function SubmitTransition({
  creatureId,
  problemIndex,
  nextLabel,
  grade,
  onDone,
}: SubmitTransitionProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  const cheer = CHEERS[problemIndex % CHEERS.length];
  const graded =
    grade.state === "graded" || grade.state === "needs-teacher" || grade.state === "couldnt-grade";

  return (
    <div className="gb-transition" role="status" aria-live="polite">
      <div className="gb-transition-card">
        <div className="gb-transition-sparkles" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative, fixed count
            <span key={i} style={{ rotate: `${i * 45}deg` }} />
          ))}
        </div>
        <div className="gb-transition-creature">
          <CreatureArt id={creatureId} size={96} title="" />
        </div>
        <h2 className="gb-transition-title">{cheer}</h2>
        <div className="gb-transition-score" data-shown={graded || undefined}>
          {graded && <ScoreChip status={grade} audience="student" />}
        </div>
        <p className="gb-transition-next">
          {nextLabel === undefined ? "That was the last one." : `Up next: problem ${nextLabel}`}
        </p>
      </div>
    </div>
  );
}
