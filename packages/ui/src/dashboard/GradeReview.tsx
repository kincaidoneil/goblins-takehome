import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import type { GradeStatus } from "../components/grade";
import { ScoreChip } from "../components/ScoreChip";

export interface ReviewLine {
  id: string;
  /** The rubric line, e.g. "Correct setup". */
  text: string;
  maxPoints: number;
  /** Points the grader (or teacher) gave for this line. */
  awarded: number;
}

/** What the teacher is looking at. Mirrors the domain's grade states. */
export type ReviewState =
  | { readonly _tag: "Pending" }
  | {
      readonly _tag: "NeedsTeacher";
      /** What the grader read from the whiteboard. */
      readonly read: string;
      readonly reason: string;
      /** Why the grader wasn't sure. */
      readonly flagReason: string;
    }
  | {
      readonly _tag: "Graded";
      readonly read: string | undefined;
      readonly reason: string | undefined;
      readonly byTeacher: boolean;
    }
  | { readonly _tag: "CouldntGrade"; readonly failureReason: string };

export interface GradeReviewProps {
  studentName: string;
  creatureId: number;
  problemLabel: string;
  problemText: string;
  /** The submitted whiteboard PNG. */
  whiteboardUrl: string;
  /** The rubric lines with the points currently awarded. */
  lines: ReadonlyArray<ReviewLine>;
  state: ReviewState;
  /** Accept the grader's best guess as is. Shown for "needs you". */
  onAccept?: () => void;
  /** Save the teacher's own points per rubric line. */
  onSave: (points: Readonly<Record<string, number>>) => void;
  /** Ask the grader again. Shown for "couldn't grade". */
  onRetry?: () => void;
  /** While a save, accept or retry is in flight. */
  busy?: boolean;
}

/**
 * One student's answer to one problem: their whiteboard, what the grader
 * read, the points per rubric line and why. The teacher can accept the
 * grader's score, change any line, or retry a grade that failed.
 */
export function GradeReview({
  studentName,
  creatureId,
  problemLabel,
  problemText,
  whiteboardUrl,
  lines,
  state,
  onAccept,
  onSave,
  onRetry,
  busy = false,
}: GradeReviewProps) {
  const [points, setPoints] = useState<Readonly<Record<string, number>>>({});
  const pointsFor = (line: ReviewLine) => points[line.id] ?? line.awarded;
  const edited = lines.some((line) => pointsFor(line) !== line.awarded);
  const maxPoints = lines.reduce((total, line) => total + line.maxPoints, 0);
  const total = lines.reduce((sum, line) => sum + pointsFor(line), 0);
  const locked = busy || state._tag === "Pending";

  const chip: GradeStatus =
    state._tag === "Pending"
      ? { state: "grading" }
      : state._tag === "NeedsTeacher"
        ? { state: "needs-teacher" }
        : state._tag === "CouldntGrade"
          ? { state: "couldnt-grade" }
          : { state: "graded", points: total, maxPoints };

  const setLine = (line: ReviewLine, value: number) =>
    setPoints((current) => ({
      ...current,
      [line.id]: Math.max(0, Math.min(line.maxPoints, value)),
    }));

  return (
    <article className="gb-review" aria-label={`${studentName}, problem ${problemLabel}`}>
      <figure className="gb-review-board">
        <img src={whiteboardUrl} alt={`${studentName}'s work on problem ${problemLabel}`} />
      </figure>

      <div className="gb-review-side">
        <header className="gb-review-head">
          <Avatar kind="creature" creatureId={creatureId} size="md" name={studentName} />
          <div className="gb-review-who">
            <strong>{studentName}</strong>
            <span>Problem {problemLabel}</span>
          </div>
          <ScoreChip status={chip} />
        </header>

        <p className="gb-review-problem">{problemText}</p>

        {state._tag === "NeedsTeacher" && (
          <p className="gb-review-flag">
            <strong>Why it needs you:</strong> {state.flagReason}
          </p>
        )}
        {state._tag === "CouldntGrade" && (
          <p className="gb-review-failed">
            <strong>Couldn't grade:</strong> {state.failureReason} Retry, or score it yourself
            below.
          </p>
        )}
        {state._tag === "Pending" && (
          <p className="gb-review-failed">The grader is still working on this one.</p>
        )}

        {(state._tag === "NeedsTeacher" || state._tag === "Graded") && state.read !== undefined && (
          <section className="gb-review-read">
            <h3>What the grader read</h3>
            <p>{state.read}</p>
          </section>
        )}

        <section className="gb-review-lines" aria-label="Points per rubric line">
          <h3>
            Rubric
            <span>
              {total}/{maxPoints}
            </span>
          </h3>
          <ul>
            {lines.map((line) => {
              const value = pointsFor(line);
              return (
                <li key={line.id}>
                  <span className="gb-review-line-text">{line.text}</span>
                  <span className="gb-review-stepper">
                    <button
                      type="button"
                      aria-label={`One less point for ${line.text}`}
                      disabled={locked || value <= 0}
                      onClick={() => setLine(line, value - 1)}
                    >
                      −
                    </button>
                    <output aria-label={`${line.text}: ${value} of ${line.maxPoints}`}>
                      {value}/{line.maxPoints}
                    </output>
                    <button
                      type="button"
                      aria-label={`One more point for ${line.text}`}
                      disabled={locked || value >= line.maxPoints}
                      onClick={() => setLine(line, value + 1)}
                    >
                      +
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {(state._tag === "NeedsTeacher" || state._tag === "Graded") &&
            state.reason !== undefined && <p className="gb-review-reason">{state.reason}</p>}
          {state._tag === "Graded" && state.byTeacher && (
            <p className="gb-review-reason">Scored by you.</p>
          )}
        </section>

        <footer className="gb-review-actions">
          {state._tag === "NeedsTeacher" && !edited && onAccept !== undefined && (
            <Button onClick={onAccept} disabled={busy}>
              Accept {total}/{maxPoints}
            </Button>
          )}
          {state._tag === "CouldntGrade" && onRetry !== undefined && (
            <Button variant="secondary" onClick={onRetry} disabled={busy}>
              Retry grading
            </Button>
          )}
          {(edited || state._tag === "CouldntGrade") && (
            <Button
              variant={state._tag === "CouldntGrade" ? "primary" : "brand"}
              disabled={locked}
              onClick={() =>
                onSave(Object.fromEntries(lines.map((line) => [line.id, pointsFor(line)])))
              }
            >
              Save {total}/{maxPoints}
            </Button>
          )}
          {edited && (
            <Button variant="ghost" onClick={() => setPoints({})} disabled={busy}>
              Undo changes
            </Button>
          )}
        </footer>
      </div>
    </article>
  );
}
