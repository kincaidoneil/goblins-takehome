import { useEffect, useRef, useState } from "react";
import { CreatureArt } from "../components/creatures";
import type { GradeStatus } from "../components/grade";
import { ScoreChip } from "../components/ScoreChip";

/** How long the transition stays up before the next problem opens. */
export const TRANSITION_MS = 1500;
/** A score that arrives late stays up at least this long, so it can be read. */
const SCORE_READ_MS = 1200;
/** Never longer than this, however late the score. */
const TRANSITION_MAX_MS = 3000;

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
  /** The submission is saved on the device and waiting for the network. */
  offline?: boolean;
  onDone: () => void;
}

/**
 * The ~1.5 s moment between problems: a cheer about the effort first, the
 * score only if it is already in, then on to the next problem. Keep Submit
 * disabled while it is up; the overlay blocks pointers but not the keyboard.
 */
export function SubmitTransition({
  creatureId,
  problemIndex,
  nextLabel,
  grade,
  offline = false,
  onDone,
}: SubmitTransitionProps) {
  const graded =
    grade.state === "graded" || grade.state === "needs-teacher" || grade.state === "couldnt-grade";

  // The deadline is measured from mount. A new onDone (e.g. an inline arrow on a
  // re-render) must not restart it; a score arriving late extends it, up to a cap.
  const startedAt = useRef(performance.now());
  const [deadline, setDeadline] = useState(TRANSITION_MS);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!graded) return;
    const elapsed = performance.now() - startedAt.current;
    setDeadline((d) => Math.min(TRANSITION_MAX_MS, Math.max(d, elapsed + SCORE_READ_MS)));
  }, [graded]);
  useEffect(() => {
    const remaining = deadline - (performance.now() - startedAt.current);
    const timer = window.setTimeout(() => onDoneRef.current(), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [deadline]);

  const cheer = offline ? "Saved!" : CHEERS[problemIndex % CHEERS.length];

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
          {offline ? (
            <p className="gb-transition-note">It sends as soon as you're back online.</p>
          ) : (
            graded && <ScoreChip status={grade} audience="student" />
          )}
        </div>
        <p className="gb-transition-next">
          {nextLabel === undefined ? "That was the last one." : `Up next: problem ${nextLabel}`}
        </p>
      </div>
    </div>
  );
}
