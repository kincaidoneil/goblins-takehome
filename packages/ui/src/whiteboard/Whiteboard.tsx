import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Button } from "../components/Button";
import { Dialog, DialogClose } from "../components/Dialog";
import { cx } from "../cx";
import {
  EMPTY_DOC,
  ERASER_SIZE,
  INK_COLORS,
  type InkColor,
  PEN_SIZE,
  pageSize,
  type Stroke,
  type WhiteboardDoc,
} from "./doc";
import { historyReducer, startHistory } from "./history";
import { drawDoc, drawStroke } from "./render";

export type Tool = { readonly _tag: "Pen"; readonly color: InkColor } | { readonly _tag: "Eraser" };

const INK_NAMES: Record<InkColor, string> = {
  "#1e2b24": "Pencil",
  "#2f5bd3": "Blue",
  "#7c3aed": "Purple",
};

export interface WhiteboardProps {
  /** Work to restore, e.g. from localStorage after a reload. Read once on mount. */
  initialDoc?: WhiteboardDoc;
  /** Called after every finished stroke, undo, redo and clear. */
  onChange?: (doc: WhiteboardDoc) => void;
  /** While true (e.g. submitting), drawing and tools are off. */
  disabled?: boolean;
  /** Shown at the end of the toolbar, e.g. the app's "See worksheet" button. */
  accessory?: ReactNode;
  className?: string;
}

/**
 * The student's whiteboard. Finger, stylus and mouse draw through pointer
 * events; a stylus sets the line width by pressure and, once used, palms
 * resting on the screen are ignored.
 */
export function Whiteboard({
  initialDoc = EMPTY_DOC,
  onChange,
  disabled = false,
  accessory,
  className,
}: WhiteboardProps) {
  const [history, dispatch] = useReducer(historyReducer, initialDoc, startHistory);
  const [tool, setTool] = useState<Tool>({ _tag: "Pen", color: INK_COLORS[0] });
  const [confirmClear, setConfirmClear] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const live = useRef<{ pointerId: number; stroke: Stroke; points: number[] } | null>(null);
  const penSeen = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const doc = history.present;
  const page = pageSize(doc.shape);

  // A blank board on a narrow screen becomes a portrait page, so a phone gets room to write.
  // Re-checked whenever the board is blank again, e.g. after Clear.
  const blank = doc.strokes.length === 0;
  useEffect(() => {
    if (!blank) return;
    const narrow = window.matchMedia("(max-width: 600px)");
    const pick = () =>
      dispatch({ _tag: "SetShape", shape: narrow.matches ? "portrait" : "landscape" });
    pick();
    narrow.addEventListener("change", pick);
    return () => narrow.removeEventListener("change", pick);
  }, [blank]);

  const redraw = useCallback(() => {
    const ctx = ctxRef.current;
    const el = canvasRef.current;
    if (ctx === null || el === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    const size = pageSize(doc.shape);
    ctx.setTransform(el.width / size.width, 0, 0, el.height / size.height, 0, 0);
    drawDoc(ctx, doc);
  }, [doc]);

  // Match the backing store to the element's size on screen, so ink stays sharp.
  useEffect(() => {
    const el = canvasRef.current;
    if (el === null) return;
    ctxRef.current = el.getContext("2d", { desynchronized: true });
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(rect.width * ratio));
      el.height = Math.max(1, Math.round(rect.height * ratio));
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [redraw]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    redraw();
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onChangeRef.current?.(doc);
  }, [doc, redraw]);

  // Undo and redo from the keyboard, for Chromebooks.
  useEffect(() => {
    if (disabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      dispatch({ _tag: event.shiftKey ? "Redo" : "Undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);

  function toBoard(
    event: { clientX: number; clientY: number; pressure: number; pointerType: string },
    rect: DOMRect,
  ) {
    const x = ((event.clientX - rect.left) / rect.width) * page.width;
    const y = ((event.clientY - rect.top) / rect.height) * page.height;
    const pressure = event.pointerType === "pen" ? event.pressure : 0.5;
    return [
      Math.round(x * 10) / 10,
      Math.round(y * 10) / 10,
      Math.round(pressure * 100) / 100,
    ] as const;
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || live.current !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType === "pen") penSeen.current = true;
    // Palm rejection: once a stylus has drawn, touches are hands resting on the screen.
    if (event.pointerType === "touch" && penSeen.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = [...toBoard(event, event.currentTarget.getBoundingClientRect())];
    const stroke: Stroke =
      tool._tag === "Pen"
        ? { _tag: "Pen", color: tool.color, size: PEN_SIZE, points }
        : { _tag: "Eraser", size: ERASER_SIZE, points };
    live.current = { pointerId: event.pointerId, stroke, points };
    const ctx = ctxRef.current;
    if (ctx !== null) drawStroke(ctx, stroke);
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = live.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const before = current.points.length / 3;
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const sample of samples.length > 0 ? samples : [event.nativeEvent]) {
      const [x, y, p] = toBoard(sample, rect);
      const lastX = current.points.at(-3) ?? x;
      const lastY = current.points.at(-2) ?? y;
      if (Math.hypot(x - lastX, y - lastY) < 1) continue;
      current.points.push(x, y, p);
    }
    const stroke: Stroke = { ...current.stroke, points: current.points };
    current.stroke = stroke;
    const ctx = ctxRef.current;
    if (ctx !== null && current.points.length / 3 > before)
      drawStroke(ctx, stroke, Math.max(1, before - 1));
  }

  function onPointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    const current = live.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    live.current = null;
    dispatch({ _tag: "AddStroke", stroke: { ...current.stroke, points: [...current.points] } });
  }

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <div className={cx("gb-board", className)} data-disabled={disabled || undefined}>
      <div className="gb-board-toolbar" role="toolbar" aria-label="Whiteboard tools">
        <div className="gb-board-group">
          {INK_COLORS.map((color) => {
            const active = tool._tag === "Pen" && tool.color === color;
            return (
              <button
                key={color}
                type="button"
                className="gb-board-tool"
                aria-pressed={active}
                aria-label={`${INK_NAMES[color]} pen`}
                disabled={disabled}
                onClick={() => setTool({ _tag: "Pen", color })}
              >
                <span className="gb-board-swatch" style={{ background: color }} />
              </button>
            );
          })}
          <button
            type="button"
            className="gb-board-tool"
            aria-pressed={tool._tag === "Eraser"}
            aria-label="Eraser"
            disabled={disabled}
            onClick={() => setTool({ _tag: "Eraser" })}
          >
            <EraserIcon />
          </button>
        </div>
        <div className="gb-board-group">
          <button
            type="button"
            className="gb-board-tool"
            aria-label="Undo"
            disabled={disabled || !canUndo}
            onClick={() => dispatch({ _tag: "Undo" })}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="gb-board-tool"
            aria-label="Redo"
            disabled={disabled || !canRedo}
            onClick={() => dispatch({ _tag: "Redo" })}
          >
            <UndoIcon flip />
          </button>
          <button
            type="button"
            className="gb-board-tool"
            aria-label="Clear the board"
            disabled={disabled || doc.strokes.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <TrashIcon />
          </button>
        </div>
        {accessory !== undefined && <div className="gb-board-accessory">{accessory}</div>}
      </div>
      <div className="gb-board-surface" data-shape={doc.shape}>
        <canvas
          ref={canvasRef}
          className="gb-board-canvas"
          data-tool={tool._tag}
          role="img"
          aria-label="Your whiteboard. Draw your work here."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      </div>
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        size="sm"
        title="Start this problem over?"
        description="This wipes the whole board. You can still undo it."
        actions={
          <>
            <DialogClose>
              <Button variant="ghost">Keep my work</Button>
            </DialogClose>
            <Button
              variant="brand"
              onClick={() => {
                dispatch({ _tag: "Clear" });
                setConfirmClear(false);
              }}
            >
              Clear the board
            </Button>
          </>
        }
      />
    </div>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function EraserIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M7 21h10M4.6 14.6l8.5-8.5a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 18.8a2 2 0 0 1-1.4.6H8.4a2 2 0 0 1-1.4-.6l-2.4-2.4a2 2 0 0 1 0-2.8Z" />
      <path d="m9 10 6 6" />
    </svg>
  );
}

function UndoIcon({ flip = false }: { flip?: boolean }) {
  return (
    <svg {...iconProps} aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
