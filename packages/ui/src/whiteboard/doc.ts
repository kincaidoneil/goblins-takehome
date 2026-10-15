import { Either, ParseResult, Schema } from "effect";

/**
 * A whiteboard is a list of strokes in a fixed 1024 × 768 space, so the
 * saved work and the exported PNG do not depend on the screen it was drawn on.
 */
export const BOARD_WIDTH = 1024;
export const BOARD_HEIGHT = 768;

export const INK_COLORS = ["#1e2b24", "#2f5bd3", "#7c3aed"] as const;
export const InkColor = Schema.Literal(...INK_COLORS);
export type InkColor = typeof InkColor.Type;

export const PEN_SIZE = 4;
export const ERASER_SIZE = 28;

/** x, y, pressure triples, flattened. Pressure is 0–1; mouse and finger use 0.5. */
const Points = Schema.Array(Schema.Number).pipe(
  Schema.filter((points) => points.length > 0 && points.length % 3 === 0, {
    message: () => "points must be non-empty x, y, pressure triples",
  }),
);

export const PenStroke = Schema.TaggedStruct("Pen", {
  color: InkColor,
  size: Schema.Number.pipe(Schema.positive()),
  points: Points,
});
export type PenStroke = typeof PenStroke.Type;

export const EraserStroke = Schema.TaggedStruct("Eraser", {
  size: Schema.Number.pipe(Schema.positive()),
  points: Points,
});
export type EraserStroke = typeof EraserStroke.Type;

export const Stroke = Schema.Union(PenStroke, EraserStroke);
export type Stroke = typeof Stroke.Type;

export const WhiteboardDoc = Schema.Struct({
  version: Schema.Literal(1),
  strokes: Schema.Array(Stroke),
});
export type WhiteboardDoc = typeof WhiteboardDoc.Type;

export const EMPTY_DOC: WhiteboardDoc = { version: 1, strokes: [] };

/** True when nothing was drawn with the pen, so the app can block an empty Submit. */
export function isDocEmpty(doc: WhiteboardDoc): boolean {
  return !doc.strokes.some((stroke) => stroke._tag === "Pen");
}

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
