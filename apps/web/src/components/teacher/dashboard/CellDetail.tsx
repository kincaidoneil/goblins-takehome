import { Avatar, Button, CroppedFigure, ScoreChip, useToast } from "@goblins/ui";
import { useEffect, useState } from "react";
import type { StudentRow, TeacherGradeRow } from "../../../lib/sync";
import { accept, getWhiteboard, retry, score } from "../../../server/fns/grading";
import { MathText } from "../MathText";
import { type DashboardProblem, gradeStatus } from "./model";
import { SidePanel } from "./SidePanel";

type Whiteboard =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Loaded"; readonly url: string }
  | { readonly _tag: "Missing" };

/**
 * One student's work on one problem: the whiteboard, what the grader read, the points per rubric
 * line and the reason, with the controls to accept, rescore or retry (PRD, "Live dashboard").
 */
export function CellDetail(props: {
  readonly onClose: () => void;
  /** After an action resolves the grade: move to the next grade that needs the teacher. */
  readonly onResolved: () => void;
  /** The next grade waiting on the teacher, if any. */
  readonly onNext: (() => void) | undefined;
  readonly student: StudentRow;
  readonly studentLabel: string;
  readonly problem: DashboardProblem;
  readonly grade: TeacherGradeRow;
}) {
  const { grade, problem } = props;
  const toast = useToast();
  const [whiteboard, setWhiteboard] = useState<Whiteboard>({ _tag: "Loading" });
  const [busy, setBusy] = useState(false);

  const startingPoints = () =>
    new Map(
      problem.rubricLines.map((line) => [
        line.id,
        (grade.linePoints ?? grade.modelLinePoints ?? []).find((p) => p.rubricLineId === line.id)
          ?.points ?? 0,
      ]),
    );
  const [points, setPoints] = useState(startingPoints);
  // Reset the editor when the grade changes underneath it (another tab, or the grader).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the grade's last update
  useEffect(() => setPoints(startingPoints()), [grade.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    getWhiteboard({ data: { submissionId: grade.submissionId } }).then((result) => {
      if (cancelled) return;
      setWhiteboard(
        result._tag === "Ok"
          ? { _tag: "Loaded", url: result.value.whiteboardUrl }
          : { _tag: "Missing" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [grade.submissionId]);

  const total = [...points.values()].reduce((sum, p) => sum + p, 0);
  const current = grade.linePoints ?? grade.modelLinePoints;
  const changed = problem.rubricLines.some(
    (line) =>
      (current?.find((p) => p.rubricLineId === line.id)?.points ?? -1) !== points.get(line.id),
  );

  const act = async (
    action: () => Promise<{ _tag: "Ok" } | { _tag: "Err"; error: { _tag: string } }>,
    done: string,
  ) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result._tag === "Ok") {
      toast({ title: done, tone: "success" });
      props.onResolved();
    } else {
      toast({
        title:
          result.error._tag === "AlreadyResolved"
            ? "This grade was already resolved"
            : "That didn't save. Try again.",
        tone: "neutral",
      });
    }
  };

  const saveScore = () =>
    act(
      () =>
        score({
          data: {
            submissionId: grade.submissionId,
            linePoints: problem.rubricLines.map((line) => ({
              rubricLineId: line.id,
              points: points.get(line.id) ?? 0,
            })),
          },
        }),
      "Score saved. The student sees it now.",
    );

  const actions = (() => {
    switch (grade.state) {
      case "needs_teacher":
        return (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                act(
                  () => retry({ data: { submissionId: grade.submissionId } }),
                  "Sent back to the grader",
                )
              }
            >
              Grade again
            </Button>
            {changed ? (
              <Button disabled={busy} onClick={saveScore}>
                Save {total}/{grade.maxPoints}
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  act(() => accept({ data: { submissionId: grade.submissionId } }), "Accepted")
                }
              >
                Accept {total}/{grade.maxPoints}
              </Button>
            )}
          </>
        );
      case "couldnt_grade":
        return (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                act(
                  () => retry({ data: { submissionId: grade.submissionId } }),
                  "Sent back to the grader",
                )
              }
            >
              Try grading again
            </Button>
            <Button disabled={busy} onClick={saveScore}>
              Score {total}/{grade.maxPoints}
            </Button>
          </>
        );
      case "graded":
        return changed ? (
          <Button disabled={busy} onClick={saveScore}>
            Change score to {total}/{grade.maxPoints}
          </Button>
        ) : null;
      case "submitted":
      case "grading":
        return changed ? (
          <Button disabled={busy} onClick={saveScore}>
            Score it myself: {total}/{grade.maxPoints}
          </Button>
        ) : null;
    }
  })();

  return (
    <SidePanel
      label={`${props.studentLabel}, problem ${problem.label}`}
      onClose={props.onClose}
      header={
        <span className="flex items-center gap-3">
          <Avatar kind="creature" creatureId={props.student.avatarId} size="sm" />
          <span className="truncate font-extrabold text-brand">
            {props.studentLabel} · Problem {problem.label}
          </span>
          <ScoreChip status={gradeStatus(grade)} size="sm" />
          {props.onNext !== undefined && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={props.onNext}>
              Next →
            </Button>
          )}
        </span>
      }
      footer={actions}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <MathText text={problem.text} className="text-sm text-text-muted" />
          {problem.figure !== null && (
            <div className="max-w-sm">
              <CroppedFigure figure={problem.figure} />
            </div>
          )}
          <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg border border-border bg-white">
            {whiteboard._tag === "Loaded" ? (
              <img
                src={whiteboard.url}
                alt={`${props.studentLabel}'s whiteboard`}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-sm text-text-muted">
                {whiteboard._tag === "Loading"
                  ? "Loading the whiteboard…"
                  : "The whiteboard couldn't be loaded."}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {grade.flagReason !== null && grade.state === "needs_teacher" && (
            <Notice tone="lilac" title="Why the grader wants you">
              {grade.flagReason}
            </Notice>
          )}
          {grade.failureReason !== null && (
            <Notice tone="grey" title="Why it couldn't grade">
              {grade.failureReason}
            </Notice>
          )}
          {grade.graderRead !== null && (
            <section>
              <h3 className="mb-1 font-bold text-sm text-text-muted">What the grader read</h3>
              <p className="whitespace-pre-line rounded-md bg-surface-sunken p-3 font-mono text-sm">
                {grade.graderRead}
              </p>
            </section>
          )}
          {grade.graderReason !== null && (
            <section>
              <h3 className="mb-1 font-bold text-sm text-text-muted">Reason</h3>
              <p>{grade.graderReason}</p>
            </section>
          )}
          <section>
            <h3 className="mb-2 font-bold text-sm text-text-muted">Points</h3>
            <ul className="flex flex-col gap-2">
              {problem.rubricLines.map((line) => {
                const value = points.get(line.id) ?? 0;
                const set = (next: number) =>
                  setPoints((prev) =>
                    new Map(prev).set(line.id, Math.max(0, Math.min(line.points, next))),
                  );
                return (
                  <li
                    key={line.id}
                    className="flex items-center gap-3 rounded-md bg-surface-sunken p-2"
                  >
                    <div className="flex shrink-0 items-center rounded-md bg-surface text-sm">
                      <button
                        type="button"
                        aria-label="One point fewer"
                        className="px-2 py-1 disabled:opacity-30"
                        disabled={value <= 0}
                        onClick={() => set(value - 1)}
                      >
                        −
                      </button>
                      <span className="w-14 text-center font-bold tabular-nums">
                        {value}/{line.points}
                      </span>
                      <button
                        type="button"
                        aria-label="One point more"
                        className="px-2 py-1 disabled:opacity-30"
                        disabled={value >= line.points}
                        onClick={() => set(value + 1)}
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm">{line.description}</span>
                  </li>
                );
              })}
            </ul>
            {grade.source !== null && grade.source !== "model" && grade.state === "graded" && (
              <p className="mt-2 text-xs text-text-muted">
                {grade.source === "teacher_accepted"
                  ? "You accepted the grader's score."
                  : "You set this score."}
              </p>
            )}
          </section>
        </div>
      </div>
    </SidePanel>
  );
}

function Notice(props: {
  readonly tone: "lilac" | "grey";
  readonly title: string;
  readonly children: string;
}) {
  return (
    <div
      className={
        props.tone === "lilac"
          ? "rounded-md bg-lilac-100 p-3 text-lilac-700"
          : "rounded-md border border-dashed border-border-strong bg-surface-sunken p-3"
      }
    >
      <p className="font-bold text-sm">{props.title}</p>
      <p className="text-sm">{props.children}</p>
    </div>
  );
}
