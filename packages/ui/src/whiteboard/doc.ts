import { Either, ParseResult, Schema } from "effect";

/**
 * A whiteboard is a list of strokes on a page of fixed size, so the saved work
 * and the exported PNG do not depend on the screen it was drawn on. The export
 * is always 1024 × 768.
 */
export const BOARD_WIDTH = 1024;
export const BOARD_HEIGHT = 768;

/**
 * Landscape pages are 4:3 and export 1:1. Portrait pages (3:4) are for phones,
 * where a 4:3 board would be too short to write in; they export scaled to fit
 * 1024 × 768, centered on white.
 */
export const PageShape = Schema.Literal("landscape", "portrait");
export type PageShape = typeof PageShape.Type;

export function pageSize(shape: PageShape): { readonly width: number; readonly height: number } {
  return shape === "landscape" ? { width: 1024, height: 768 } : { width: 1024, height: 1365 };
}

export const INK_COLORS = ["#1e2b24", "#2f5bd3", "#7c3aed"] as const;
export const InkColor = Schema.Literal(...INK_COLORS);
export type InkColor = typeof InkColor.Type;

export const PEN_SIZE = 4;
export const ERASER_SIZE = 28;

/** Generous bounds: strokes may run a little off the page, but nothing far outside it. */
const MARGIN = 512;

function validPoints(points: ReadonlyArray<number>): boolean {
  if (points.length === 0 || points.length % 3 !== 0) return false;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i] ?? Number.NaN;
    const y = points[i + 1] ?? Number.NaN;
    const p = points[i + 2] ?? Number.NaN;
    if (!(x >= -MARGIN && x <= BOARD_WIDTH + MARGIN)) return false;
    if (!(y >= -MARGIN && y <= pageSize("portrait").height + MARGIN)) return false;
    if (!(p >= 0 && p <= 1)) return false;
  }
  return true;
}

/** x, y, pressure triples, flattened. Pressure is 0–1; mouse and finger use 0.5. */
const Points = Schema.Array(Schema.Number).pipe(
  Schema.filter(validPoints, {
    message: () =>
      "points must be non-empty x, y, pressure triples on or near the board, pressure 0–1",
  }),
);

/** Line widths in board units. */
const Size = Schema.Number.pipe(Schema.between(0.5, 200));

export const PenStroke = Schema.TaggedStruct("Pen", {
  color: InkColor,
  size: Size,
  points: Points,
});
export type PenStroke = typeof PenStroke.Type;

export const EraserStroke = Schema.TaggedStruct("Eraser", {
  size: Size,
  points: Points,
});
export type EraserStroke = typeof EraserStroke.Type;

export const Stroke = Schema.Union(PenStroke, EraserStroke);
export type Stroke = typeof Stroke.Type;

export const WhiteboardDoc = Schema.Struct({
  version: Schema.Literal(1),
  /** Missing in work saved before portrait pages existed, which was all landscape. */
  shape: Schema.optionalWith(PageShape, { default: () => "landscape" }),
  strokes: Schema.Array(Stroke),
});
export type WhiteboardDoc = typeof WhiteboardDoc.Type;

export const EMPTY_DOC: WhiteboardDoc = { version: 1, shape: "landscape", strokes: [] };

/** Saved work, for localStorage or a server draft. */
export function serializeDoc(doc: WhiteboardDoc): string {
  return JSON.stringify(Schema.encodeSync(WhiteboardDoc)(doc));
}

export type DecodeDocError =
  | { readonly _tag: "InvalidJson" }
  | { readonly _tag: "InvalidDoc"; readonly message: string };

/** Reads saved work back. Saved data is foreign: it may be stale, truncated or from another version. */
export function parseDoc(json: string): Either.Either<WhiteboardDoc, DecodeDocError> {
  return Either.try({
    try: (): unknown => JSON.parse(json),
    catch: () => ({ _tag: "InvalidJson" as const }),
  }).pipe(
    Either.flatMap((value) =>
      Schema.decodeUnknownEither(WhiteboardDoc)(value).pipe(
        Either.mapLeft((error) => ({
          _tag: "InvalidDoc" as const,
          message: ParseResult.TreeFormatter.formatErrorSync(error),
        })),
      ),
    ),
  );
}
