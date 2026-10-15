import { Either } from "effect";
import { BOARD_HEIGHT, BOARD_WIDTH, type Stroke, type WhiteboardDoc } from "./doc";

/** Line width at a point: stylus pressure thickens or thins the line; mouse and finger (0.5) give `size`. */
export function widthAt(size: number, pressure: number): number {
  return size * (0.4 + 1.2 * pressure);
}

function point(points: ReadonlyArray<number>, i: number): { x: number; y: number; w: number } {
  return { x: points[i * 3] ?? 0, y: points[i * 3 + 1] ?? 0, w: points[i * 3 + 2] ?? 0.5 };
}

function setStyle(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke._tag === "Pen") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  } else {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#000";
  }
}

/**
 * Draws the part of a stroke from point `from` on. Each segment runs between
 * the midpoints around a point, curving through the point itself, so a stroke
 * drawn piece by piece while the pointer moves matches the same stroke drawn whole.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, from = 0) {
  const n = stroke.points.length / 3;
  setStyle(ctx, stroke);
  if (n === 1) {
    if (from > 0) return;
    const p = point(stroke.points, 0);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0, widthAt(stroke.size, p.w) / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = Math.max(1, from); i < n; i++) {
    const prev = point(stroke.points, i - 1);
    const cur = point(stroke.points, i);
    const start =
      i === 1
        ? prev
        : {
            x: (prev.x + point(stroke.points, i - 2).x) / 2,
            y: (prev.y + point(stroke.points, i - 2).y) / 2,
          };
    const end = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
    ctx.beginPath();
    ctx.lineWidth = widthAt(stroke.size, (prev.w + cur.w) / 2);
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(prev.x, prev.y, end.x, end.y);
    ctx.stroke();
  }
  // Close the gap from the last midpoint to the final point.
  const last = point(stroke.points, n - 1);
  const before = point(stroke.points, n - 2);
  ctx.beginPath();
  ctx.lineWidth = widthAt(stroke.size, last.w);
  ctx.moveTo((before.x + last.x) / 2, (before.y + last.y) / 2);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** Draws every stroke onto a transparent layer already scaled to board units. */
export function drawDoc(ctx: CanvasRenderingContext2D, doc: WhiteboardDoc) {
  for (const stroke of doc.strokes) drawStroke(ctx, stroke);
  ctx.globalCompositeOperation = "source-over";
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return el;
}

/** Coarse grid for the blank check: a 4 px pen at 1024 wide still covers whole cells here. */
const CHECK_WIDTH = 256;
const CHECK_HEIGHT = 192;

/**
 * True when no ink is visible, so the app can block an empty Submit. A board
 * with no pen strokes is empty without drawing anything; a board with eraser
 * strokes is rendered small and checked for any remaining ink, since a student
 * can erase everything back to blank.
 */
export function isDocEmpty(doc: WhiteboardDoc): boolean {
  if (!doc.strokes.some((stroke) => stroke._tag === "Pen")) return true;
  if (!doc.strokes.some((stroke) => stroke._tag === "Eraser")) return false;
  if (typeof document === "undefined") return false;
  const ctx = canvas(CHECK_WIDTH, CHECK_HEIGHT).getContext("2d", { willReadFrequently: true });
  if (ctx === null) return false;
  ctx.scale(CHECK_WIDTH / BOARD_WIDTH, CHECK_HEIGHT / BOARD_HEIGHT);
  drawDoc(ctx, doc);
  const alpha = ctx.getImageData(0, 0, CHECK_WIDTH, CHECK_HEIGHT).data;
  for (let i = 3; i < alpha.length; i += 4) {
    // Ignore faint antialiasing left at the edge of an erased stroke.
    if ((alpha[i] ?? 0) > 48) return false;
  }
  return true;
}

export type RenderError = "CanvasUnavailable" | "EncodingFailed";

/**
 * The student's work as a 1024 × 768 PNG on white. Same strokes, same browser
 * engine, same bytes: no timestamps, no device pixel ratio, no grid.
 */
export function renderWhiteboardPng(doc: WhiteboardDoc): Promise<Either.Either<Blob, RenderError>> {
  // Erasing must only remove ink, so strokes go on their own layer before the white page.
  const ink = canvas(BOARD_WIDTH, BOARD_HEIGHT);
  const inkCtx = ink.getContext("2d");
  const page = canvas(BOARD_WIDTH, BOARD_HEIGHT);
  const pageCtx = page.getContext("2d");
  if (inkCtx === null || pageCtx === null) return Promise.resolve(Either.left("CanvasUnavailable"));
  drawDoc(inkCtx, doc);
  pageCtx.fillStyle = "#ffffff";
  pageCtx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  pageCtx.drawImage(ink, 0, 0);
  return new Promise((resolve) =>
    page.toBlob(
      (blob) => resolve(blob === null ? Either.left("EncodingFailed") : Either.right(blob)),
      "image/png",
    ),
  );
}
