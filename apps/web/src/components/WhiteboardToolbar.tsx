import type { ReactNode } from "react";
import type { Tool } from "./Whiteboard";

export interface WhiteboardToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  canUndo: boolean;
  onUndo: () => void;
  canClear: boolean;
  onClear: () => void;
  /** The submit button, on the right. */
  children?: ReactNode;
}

/** Pen, eraser, undo and clear, sized for fingers (44px targets). */
export function WhiteboardToolbar({
  tool,
  onToolChange,
  canUndo,
  onUndo,
  canClear,
  onClear,
  children,
}: WhiteboardToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      <fieldset className="flex gap-1 rounded-md bg-surface-sunken p-1">
        <legend className="sr-only">Tool</legend>
        <ToolButton label="Pen" pressed={tool === "pen"} onClick={() => onToolChange("pen")}>
          <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />
          <path d="M14.5 6.5l3 3" />
        </ToolButton>
        <ToolButton
          label="Eraser"
          pressed={tool === "eraser"}
          onClick={() => onToolChange("eraser")}
        >
          <path d="M8.5 20H20" />
          <path d="M5.4 16.6a2 2 0 010-2.8l8.4-8.4a2 2 0 012.8 0l2 2a2 2 0 010 2.8L11 18.8a2 2 0 01-1.4.6H8.2a2 2 0 01-1.4-.6z" />
          <path d="M10 9.2l5 5" />
        </ToolButton>
      </fieldset>
      <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}>
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
      </ToolButton>
      <ToolButton label="Clear the board" disabled={!canClear} onClick={onClear}>
        <path d="M4 7h16" />
        <path d="M10 11v6M14 11v6" />
        <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
        <path d="M9 7V4h6v3" />
      </ToolButton>
      <div className="ml-auto">{children}</div>
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-md text-text-brand transition-colors hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-surface aria-pressed:shadow-sm aria-pressed:hover:bg-surface"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
