import { Button, Dialog, DialogClose } from "@goblins/ui";
import { useEffect, useState } from "react";
import { MathText } from "../MathText";
import { exportWhiteboardPng, hasInk, type Tool, Whiteboard } from "../Whiteboard";
import { WhiteboardToolbar } from "../WhiteboardToolbar";
import { useStrokeHistory } from "./useStrokeHistory";

export interface WorkspaceProblem {
  id: string;
  label: string;
  text: string;
  diagramDescription: string | null;
  pageNumbers: ReadonlyArray<number>;
}

export interface WorksheetPage {
  pageNumber: number;
  imageUrl: string;
}

/**
 * One problem: the question on the left, the whiteboard on the right; stacked on a phone. Mount
 * it with `key={problem.id}` so each problem gets its own board.
 */
export function Workspace({
  sessionId,
  studentId,
  problem,
  pages,
  onSubmit,
}: {
  sessionId: string;
  studentId: string;
  problem: WorkspaceProblem;
  pages: ReadonlyArray<WorksheetPage>;
  onSubmit: (png: string) => void;
}) {
  const board = useStrokeHistory({ sessionId, studentId }, problem.id);
  const [tool, setTool] = useState<Tool>("pen");
  const inked = hasInk(board.strokes);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 md:flex-row md:gap-5 md:px-5 md:pb-5">
      <section
        aria-labelledby="problem-heading"
        className="flex max-h-[34dvh] shrink-0 flex-col gap-3 overflow-y-auto rounded-xl bg-surface p-4 shadow-md md:max-h-none md:w-[38%] md:p-6"
      >
        <h1 id="problem-heading" className="text-sm uppercase tracking-wider text-text-muted">
          Problem {problem.label}
        </h1>
        <MathText text={problem.text} className="text-lg leading-snug md:text-xl" />
        {pages.length > 0 && (
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            <WorksheetButton problem={problem} pages={pages} />
            {problem.diagramDescription !== null && (
              <span className="text-sm text-text-muted">This one has a diagram.</span>
            )}
          </div>
        )}
      </section>

      <section
        aria-label="Your work"
        className="flex min-h-[300px] flex-1 flex-col gap-2 rounded-xl bg-surface p-2 shadow-md md:p-3"
      >
        <WhiteboardToolbar
          tool={tool}
          onToolChange={setTool}
          canUndo={board.canUndo}
          onUndo={board.undo}
          canClear={board.strokes.length > 0}
          onClear={board.clear}
        >
          <Button
            size="md"
            disabled={!inked}
            onClick={() => onSubmit(exportWhiteboardPng(board.strokes))}
          >
            Submit
          </Button>
        </WhiteboardToolbar>
        <div className="relative min-h-0 flex-1 rounded-lg shadow-[inset_0_0_0_1px_var(--gb-color-border)]">
          <Whiteboard
            strokes={board.strokes}
            tool={tool}
            onStroke={board.add}
            label={`Whiteboard for problem ${problem.label}`}
          />
          {board.strokes.length === 0 && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-text-subtle">
              Show your work here
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function WorksheetButton({
  problem,
  pages,
}: {
  problem: WorkspaceProblem;
  pages: ReadonlyArray<WorksheetPage>;
}) {
  const own = pages.filter((page) => problem.pageNumbers.includes(page.pageNumber));
  const shown = own.length > 0 ? own : pages;
  return (
    <Dialog
      size="lg"
      trigger={
        <Button variant="secondary" size="sm">
          See worksheet
        </Button>
      }
      title={`Problem ${problem.label} on the worksheet`}
      actions={
        <DialogClose>
          <Button variant="brand">Back to my work</Button>
        </DialogClose>
      }
    >
      {/* Scrolls on its own so focusing the close button doesn't scroll past the top of the page. */}
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto">
        {shown.map((page) => (
          <img
            key={page.pageNumber}
            src={page.imageUrl}
            alt={`Worksheet page ${page.pageNumber}`}
            className="w-full rounded-md shadow-[0_0_0_1px_var(--gb-color-border)]"
          />
        ))}
      </div>
    </Dialog>
  );
}

/** Minutes left on the session's time limit, refreshed every 15 s. Calm: no seconds, no red. */
export function TimeLeft({ startedAt, limitMinutes }: { startedAt: string; limitMinutes: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const endsAt = Date.parse(startedAt) + limitMinutes * 60_000;
  const minutes = Math.ceil((endsAt - now) / 60_000);
  const text =
    minutes <= 0 ? "Time's up soon" : minutes === 1 ? "About 1 min left" : `${minutes} min left`;
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-sm font-bold text-text-muted shadow-xs">
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 4.8V8l2 1.6" strokeLinecap="round" />
      </svg>
      {text}
    </span>
  );
}
