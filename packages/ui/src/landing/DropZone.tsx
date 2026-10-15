import { type DragEvent, useId, useRef, useState } from "react";
import { Button } from "../components/Button";
import { CreatureArt } from "../components/creatures";
import { UPLOAD_PROBLEM_COPY } from "./copy";
import { ACCEPT_ATTRIBUTE, checkFiles, type UploadProblem, type UploadResult } from "./upload";

export type DropZoneState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Dragging" }
  | { readonly _tag: "Uploading"; readonly fileName: string }
  | { readonly _tag: "Problem"; readonly problem: UploadProblem };

export interface DropZoneProps {
  /** Sends the checked files to the setup flow. */
  onFiles: (files: ReadonlyArray<File>) => Promise<UploadResult>;
  /** Called once the setup flow has a draft; the page navigates to it. */
  onStarted: (draftId: string) => void;
  /** Takes the teacher to the templates. */
  onShowTemplates: () => void;
  /** For stories: the state to start in. */
  initialState?: DropZoneState;
}

function describeFiles(files: ReadonlyArray<File>): string {
  const first = files[0];
  if (first === undefined) return "";
  return files.length === 1 ? first.name : `${files.length} pages`;
}

export function DropZone({
  onFiles,
  onStarted,
  onShowTemplates,
  initialState = { _tag: "Idle" },
}: DropZoneProps) {
  const [state, setState] = useState<DropZoneState>(initialState);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  async function take(files: ReadonlyArray<File>) {
    const check = checkFiles(files);
    if (check._tag === "Problem") {
      setState({ _tag: "Problem", problem: check.problem });
      return;
    }
    setState({ _tag: "Uploading", fileName: describeFiles(check.files) });
    const result = await onFiles(check.files).catch(
      (): UploadResult => ({ _tag: "Rejected", reason: "upload-failed" }),
    );
    if (result._tag === "Started") onStarted(result.draftId);
    else setState({ _tag: "Problem", problem: result.reason });
  }

  const busy = state._tag === "Uploading";

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (!busy && state._tag !== "Dragging") setState({ _tag: "Dragging" });
  }

  function onDragLeave(event: DragEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (state._tag === "Dragging") setState({ _tag: "Idle" });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    if (busy) return;
    void take([...event.dataTransfer.files]);
  }

  return (
    <section
      className="lp-drop"
      data-state={state._tag}
      aria-labelledby={titleId}
      aria-busy={busy}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        className="lp-drop-input"
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) void take(files);
        }}
      />
      <DropZoneBody
        state={state}
        titleId={titleId}
        onChoose={() => inputRef.current?.click()}
        onShowTemplates={onShowTemplates}
      />
    </section>
  );
}

function DropZoneBody({
  state,
  titleId,
  onChoose,
  onShowTemplates,
}: {
  state: DropZoneState;
  titleId: string;
  onChoose: () => void;
  onShowTemplates: () => void;
}) {
  switch (state._tag) {
    case "Idle":
    case "Dragging":
      return (
        <>
          <PagesIcon />
          <h2 id={titleId} className="lp-drop-title">
            {state._tag === "Dragging" ? "Let go to start" : "Drop your worksheet here"}
          </h2>
          <p className="lp-drop-hint">A PDF, or photos of the pages. No account needed.</p>
          <div className="lp-drop-actions">
            <Button size="lg" onClick={onChoose}>
              Choose a file
            </Button>
            <Button size="lg" variant="ghost" onClick={onShowTemplates}>
              Use a template
            </Button>
          </div>
        </>
      );
    case "Uploading":
      return (
        <>
          <div className="lp-drop-creature">
            <CreatureArt id={0} size={72} title="" />
          </div>
          <h2 id={titleId} className="lp-drop-title" aria-live="polite">
            Reading your worksheet…
          </h2>
          <p className="lp-drop-hint">{state.fileName}</p>
          <div className="lp-drop-bar" role="progressbar" aria-label="Uploading" />
        </>
      );
    case "Problem": {
      const copy = UPLOAD_PROBLEM_COPY[state.problem];
      return (
        <>
          <div className="lp-drop-creature">
            <CreatureArt id={27} size={72} title="" />
          </div>
          <h2 id={titleId} className="lp-drop-title" role="alert">
            {copy.title}
          </h2>
          <p className="lp-drop-hint">{copy.body}</p>
          <div className="lp-drop-actions">
            <Button size="lg" onClick={onChoose}>
              Try another file
            </Button>
            <Button size="lg" variant="secondary" onClick={onShowTemplates}>
              Start from a template
            </Button>
          </div>
        </>
      );
    }
  }
}

function PagesIcon() {
  return (
    <svg className="lp-drop-icon" viewBox="0 0 96 80" aria-hidden="true">
      <rect
        x="30"
        y="8"
        width="44"
        height="58"
        rx="6"
        fill="#fff"
        stroke="currentColor"
        strokeWidth="2.5"
        transform="rotate(8 52 37)"
      />
      <rect
        x="22"
        y="12"
        width="44"
        height="58"
        rx="6"
        fill="#fff"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M31 28h26M31 37h26M31 46h16"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.35"
      />
      <circle cx="66" cy="60" r="14" fill="var(--gb-lime-400)" />
      <path
        d="M66 67V53m-6 6 6-6 6 6"
        fill="none"
        stroke="var(--gb-green-800)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
