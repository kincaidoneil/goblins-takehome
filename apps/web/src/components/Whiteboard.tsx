import { type PointerEvent, useCallback, useEffect, useRef } from "react";
import type { Stroke } from "./student/storage";

export type Tool = Stroke["tool"];

/** Line widths in CSS pixels at the moment of drawing. */
const WIDTH: Record<Tool, number> = { pen: 3.5, eraser: 28 };
const INK = "#1e2b24"; // --gb-ink-900

/** Draws one stroke. `scale` maps board-width fractions to the context's units. */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, scale: number) {
  const [first, ...rest] = stroke.points;
  if (first === undefined) return;
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = stroke.size * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (rest.length === 0) {
    ctx.beginPath();
    ctx.arc(first[0] * scale, first[1] * scale, (stroke.size * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Quadratic curves through the midpoints smooth out the polyline.
  ctx.beginPath();
  ctx.moveTo(first[0] * scale, first[1] * scale);
  let previous = first;
  for (const point of rest) {
    const midX = ((previous[0] + point[0]) / 2) * scale;
    const midY = ((previous[1] + point[1]) / 2) * scale;
    ctx.quadraticCurveTo(previous[0] * scale, previous[1] * scale, midX, midY);
    previous = point;
  }
  ctx.lineTo(previous[0] * scale, previous[1] * scale);
  ctx.stroke();
}

export const hasInk = (strokes: ReadonlyArray<Stroke>) =>
  strokes.some((stroke) => stroke.tool === "pen");

/** Pixels per board width in the exported image. */
const EXPORT_WIDTH = 1000;
const EXPORT_PADDING = 0.04;
const MAX_EXPORT_HEIGHT = 4000;

/**
 * The whiteboard as a base64 PNG, cropped to the ink with a margin, on white. The grader sees the
 * work at a consistent scale no matter which device drew it.
 */
export function exportWhiteboardPng(strokes: ReadonlyArray<Stroke>): string {
  const inked = strokes.filter((stroke) => stroke.tool === "pen").flatMap((s) => s.points);
  const ys = inked.map((point) => point[1]);
  const top = Math.max(0, Math.min(...ys) - EXPORT_PADDING);
  const bottom = Math.max(...ys) + EXPORT_PADDING;
  const width = EXPORT_WIDTH;
  const height = Math.min(MAX_EXPORT_HEIGHT, Math.max(200, Math.ceil((bottom - top) * width)));

  // Erasing cuts holes in the ink layer, which then sits on white.
  const ink = document.createElement("canvas");
  ink.width = width;
  ink.height = height;
  const inkCtx = ink.getContext("2d");
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const outCtx = out.getContext("2d");
  if (inkCtx === null || outCtx === null) return "";
  inkCtx.translate(0, -top * width);
  for (const stroke of strokes) drawStroke(inkCtx, stroke, width);
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, width, height);
  outCtx.drawImage(ink, 0, 0);
  return out.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

export interface WhiteboardProps {
  strokes: ReadonlyArray<Stroke>;
  tool: Tool;
  onStroke: (stroke: Stroke) => void;
  /** Accessible description of what the board holds. */
  label: string;
}

/**
 * A drawing surface for finger, stylus or mouse. One pointer draws at a time; once a stylus has
 * touched the board, finger touches are ignored so a resting palm leaves no marks.
 */
export function Whiteboard({ strokes, tool, onStroke, label }: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const sawPen = useRef(false);
  const widthRef = useRef(1);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  // Reads only refs, so it never changes identity.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined) return;
    const dpr = canvas.width / widthRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, widthRef.current);
  }, []);

  // Size the backing store to the element and the screen's pixel density.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container === null || canvas === null) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      widthRef.current = Math.max(1, width);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      redraw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [redraw]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw reads the latest strokes from a ref
  useEffect(redraw, [strokes, redraw]);

  const pointFor = (event: { clientX: number; clientY: number }): readonly [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const w = widthRef.current;
    return rect === undefined
      ? [0, 0]
      : [(event.clientX - rect.left) / w, (event.clientY - rect.top) / w];
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "pen") sawPen.current = true;
    if (event.pointerType === "touch" && sawPen.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (drawing.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = {
      tool,
      size: WIDTH[tool] / widthRef.current,
      points: [pointFor(event)],
    };
    drawing.current = { pointerId: event.pointerId, stroke };
    const ctx = event.currentTarget.getContext("2d");
    if (ctx !== null) drawStroke(ctx, stroke, widthRef.current);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = drawing.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const added = (coalesced.length > 0 ? coalesced : [event.nativeEvent]).map(pointFor);
    const last = current.stroke.points[current.stroke.points.length - 1];
    current.stroke = { ...current.stroke, points: [...current.stroke.points, ...added] };
    const ctx = event.currentTarget.getContext("2d");
    if (ctx === null || last === undefined) return;
    // Draw just the new segment; the full redraw after the stroke smooths it.
    drawStroke(ctx, { ...current.stroke, points: [last, ...added] }, widthRef.current);
  };

  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = drawing.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drawing.current = null;
    onStroke(current.stroke);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-lg bg-surface"
      style={{
        backgroundImage: "radial-gradient(circle, var(--gb-paper-300) 1px, transparent 1.5px)",
        backgroundSize: "24px 24px",
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </div>
  );
}
