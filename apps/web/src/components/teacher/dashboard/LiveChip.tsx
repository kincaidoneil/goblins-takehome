import { type GradeStatus, ScoreChip } from "@goblins/ui";
import { useEffect, useRef } from "react";

/** A short key for a status, so a cell can tell when its grade changed. */
const signature = (status: GradeStatus) =>
  status.state === "graded" ? `graded:${status.points}` : status.state;

/**
 * A grid cell's score chip. When the grade changes while the teacher watches, it pops, so new
 * results catch the eye. The first render does not animate.
 */
export function LiveChip({ status }: { readonly status: GradeStatus }) {
  const ref = useRef<HTMLSpanElement>(null);
  const sig = signature(status);
  const previous = useRef(sig);
  useEffect(() => {
    if (previous.current === sig) return;
    previous.current = sig;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ref.current?.animate(
      [
        { transform: "scale(0.55)", opacity: 0.3 },
        { transform: "scale(1.15)", opacity: 1, offset: 0.6 },
        { transform: "scale(1)" },
      ],
      { duration: 480, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    );
  }, [sig]);
  return (
    <span ref={ref} className="inline-flex">
      <ScoreChip status={status} size="sm" />
    </span>
  );
}
