import type { DiagramCrop } from "@goblins/domain";
import {
  Button,
  Dialog,
  DialogClose,
  isDocEmpty,
  type PageRegion,
  type ProblemFigure,
  ProblemPanel,
  renderWhiteboardPng,
  StudentWorkLayout,
  SubmitButton,
  type SubmitState,
  Whiteboard,
  type WhiteboardDoc,
  WorksheetViewer,
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
  /** Where its figures are on the worksheet; empty for uploads, which don't have crops yet. */
  diagramCrops: ReadonlyArray<DiagramCrop>;
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

  // The worksheet sheet: from See worksheet at the problem's page, or from the figure zoomed to it.
  const [worksheet, setWorksheet] = useState<
    { _tag: "Closed" } | { _tag: "Open"; focus: PageRegion | undefined }
  >({ _tag: "Closed" });
  const crop = problem.diagramCrops[0];
  const cropPage = crop === undefined ? undefined : pages.find((p) => p.pageNumber === crop.page);
  const figure: ProblemFigure | undefined =
    crop === undefined || cropPage === undefined
      ? undefined
      : {
          src: cropPage.imageUrl,
          alt: problem.diagramDescription ?? `The diagram for problem ${problem.label}`,
          crop,
          onOpen: () => setWorksheet({ _tag: "Open", focus: { pageNumber: crop.page, ...crop } }),
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
          {...(pages.length > 0
            ? {
                action: (
                  <WorksheetSheet
                    problem={problem}
                    pages={pages}
                    focus={worksheet._tag === "Open" ? worksheet.focus : undefined}
                    open={worksheet._tag === "Open"}
                    onOpenChange={(open) =>
                      setWorksheet(open ? { _tag: "Open", focus: undefined } : { _tag: "Closed" })
                    }
                  />
                ),
              }
            : {})}
          {...(figure === undefined ? {} : { figure })}
        >
          <MathText text={problem.text} />
          {/* Without a crop (uploads, for now), point to the worksheet rather than show a whole
              page that may hold another problem's figure. */}
          {figure === undefined && problem.diagramDescription !== null && pages.length > 0 && (
            <p className="mt-2 text-sm text-text-muted">
              This one has a diagram. Tap See worksheet to look at it.
            </p>
          )}
        </ProblemPanel>
      }
      board={
        <Whiteboard
          initialDoc={doc}
          onChange={setDoc}
          label={`Whiteboard for problem ${problem.label}`}
          disabled={exporting}
        />
      }
      submit={<SubmitButton state={state} onSubmit={() => void submit()} />}
    />
  );
}

function WorksheetSheet({
  problem,
  pages,
  focus,
  open,
  onOpenChange,
}: {
  problem: WorkspaceProblem;
  pages: ReadonlyArray<WorksheetPage>;
  /** Opens zoomed to this region, when opened from the figure. */
  focus: PageRegion | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const page = focus?.pageNumber ?? problem.pageNumbers[0];
  return (
    <Dialog
      size="lg"
      open={open}
      onOpenChange={onOpenChange}
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
      {/* Every page, opening on the problem's first (or the figure's) and marking its pages. */}
      <div className="h-[62dvh]">
        <WorksheetViewer
          pages={pages}
          highlightPages={problem.pageNumbers}
          {...(page === undefined ? {} : { page })}
          {...(focus === undefined ? {} : { focus })}
        />
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
