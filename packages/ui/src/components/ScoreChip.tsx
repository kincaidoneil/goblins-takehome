import { cx } from "../cx";
import { type Audience, type GradeStatus, scoreBand } from "./grade";

export interface ScoreChipProps {
  status: GradeStatus;
  audience?: Audience;
  size?: "sm" | "md";
  className?: string;
}

type Look = { tone: string; label: string; title: string };

function look(status: GradeStatus, audience: Audience): Look {
  switch (status.state) {
    case "not-started":
      return { tone: "empty", label: "–", title: "Not started" };
    case "grading":
      return { tone: "pending", label: "…", title: "Grading" };
    case "graded": {
      const score = `${status.points}/${status.maxPoints}`;
      return { tone: scoreBand(status.points, status.maxPoints), label: score, title: score };
    }
    case "needs-teacher":
      return audience === "teacher"
        ? { tone: "needs", label: "Needs you", title: "The grader wants you to check this" }
        : { tone: "check", label: "Teacher will check", title: "Your teacher will check this one" };
    case "couldnt-grade":
      return audience === "teacher"
        ? { tone: "failed", label: "Couldn't grade", title: "Grading failed. Retry or score it" }
        : { tone: "check", label: "Teacher will check", title: "Your teacher will check this one" };
  }
}

/** A grade at a glance: score colored by band, or the state that needs a person. */
export function ScoreChip({
  status,
  audience = "teacher",
  size = "md",
  className,
}: ScoreChipProps) {
  const { tone, label, title } = look(status, audience);
  return (
    <span
      className={cx("gb-score-chip", className)}
      data-tone={tone}
      data-size={size}
      role="img"
      title={title}
      aria-label={title}
    >
      {tone === "needs" && <HandIcon />}
      {tone === "check" && <EyeIcon />}
      {tone === "pending" ? <span className="gb-score-chip-dots" aria-hidden="true" /> : label}
    </span>
  );
}

function HandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.5 8V3.5a1 1 0 0 1 2 0V7m0-.5V2.5a1 1 0 0 1 2 0V7m0-.5V3.5a1 1 0 0 1 2 0V9c0 2.8-1.8 5-4.5 5-1.8 0-2.9-1-3.8-2.6L2.8 9.3a1 1 0 0 1 1.7-1L5.5 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
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
}
