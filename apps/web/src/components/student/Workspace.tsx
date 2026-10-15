import {
  Button,
  Dialog,
  DialogClose,
  isDocEmpty,
  ProblemPanel,
  renderWhiteboardPng,
  StudentWorkLayout,
  SubmitButton,
  type SubmitState,
  Whiteboard,
  type WhiteboardDoc,
} from "@goblins/ui";
import { Either } from "effect";
import { useEffect, useState } from "react";
import { MathText } from "../MathText";
import { loadBoard, saveBoard } from "./storage";

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

/** Base64 without the `data:` prefix, as the outbox stores it. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * One problem: the question beside the whiteboard, stacked on a phone. The board, its export and
 * the Submit states come from @goblins/ui. Mount it with `key={problem.id}` so each problem gets
 * its own board.
 */
export function Workspace({
  sessionId,
  studentId,
  problem,
  total,
  pages,
  onSubmit,
}: {
  sessionId: string;
  studentId: string;
  problem: WorkspaceProblem;
  /** How many problems the assignment has, for "Problem 3 of 8". */
  total: number;
  pages: ReadonlyArray<WorksheetPage>;
  onSubmit: (png: string) => void;
}) {
  const [doc, setDoc] = useState<WhiteboardDoc>(() =>
    loadBoard({ sessionId, studentId }, problem.id),
  );
  const [exporting, setExporting] = useState(false);
  useEffect(
    () => saveBoard({ sessionId, studentId }, problem.id, doc),
    [sessionId, studentId, problem.id, doc],
  );

  const own = pages.filter((page) => problem.pageNumbers.includes(page.pageNumber));
  // A problem with a diagram shows its page beside the text, so the student needn't open the worksheet.
  const figurePage = problem.diagramDescription === null ? undefined : (own[0] ?? pages[0]);

  const submit = async () => {
    setExporting(true);
    const png = await renderWhiteboardPng(doc);
    if (Either.isLeft(png)) {
      // Canvas export failed (very old browser). Keep the work and let them try again.
      setExporting(false);
      return;
    }
    onSubmit(await toBase64(png.right));
  };

  const state: SubmitState = exporting
    ? { _tag: "Submitting" }
    : isDocEmpty(doc)
      ? { _tag: "Empty" }
      : { _tag: "Ready" };

  return (
    <StudentWorkLayout
      progress={null}
      problem={
        <ProblemPanel
          label={problem.label}
          total={total}
          {...(figurePage === undefined || problem.diagramDescription === null
            ? {}
            : { figure: { src: figurePage.imageUrl, alt: problem.diagramDescription } })}
        >
          <MathText text={problem.text} />
        </ProblemPanel>
      }
      board={
        <Whiteboard
          initialDoc={doc}
          onChange={setDoc}
          disabled={exporting}
          {...(pages.length > 0
            ? {
                accessory: (
                  <WorksheetButton problem={problem} pages={own.length > 0 ? own : pages} />
                ),
              }
            : {})}
        />
      }
      submit={<SubmitButton state={state} onSubmit={() => void submit()} />}
    />
  );
}

function WorksheetButton({
  problem,
  pages,
}: {
  problem: WorkspaceProblem;
  pages: ReadonlyArray<WorksheetPage>;
}) {
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
        {pages.map((page) => (
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
