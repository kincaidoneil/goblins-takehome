/**
 * Work kept in this browser so a reload, a closed tab or a dropped connection loses nothing:
 * the strokes on each problem's whiteboard, and submissions waiting to be sent. Everything read
 * back is validated, since another version of the app (or the student) may have written it.
 */
import { Option, Schema } from "effect";

export const Stroke = Schema.Struct({
  tool: Schema.Literal("pen", "eraser"),
  /** Line width as a fraction of the board's width, so a stroke scales with the board. */
  size: Schema.Number,
  /** Points as fractions of the board's width (both axes, so shapes keep their proportions). */
  points: Schema.Array(Schema.Tuple(Schema.Number, Schema.Number)),
});
export type Stroke = typeof Stroke.Type;

export const OutboxItem = Schema.Struct({
  problemId: Schema.String,
  /** Base64 PNG without the `data:` prefix. */
  png: Schema.String,
  submittedAt: Schema.String,
});
export type OutboxItem = typeof OutboxItem.Type;

const Strokes = Schema.parseJson(Schema.Array(Stroke));
const Outbox = Schema.parseJson(Schema.Array(OutboxItem));

const strokesKey = (sessionId: string, problemId: string) =>
  `goblins:strokes:${sessionId}:${problemId}`;
const outboxKey = (sessionId: string) => `goblins:outbox:${sessionId}`;

// Storage can be unavailable (private mode, full quota). Work then lives in memory only.
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Quota or privacy settings; nothing to do but keep the work in memory.
  }
};

export const loadStrokes = (sessionId: string, problemId: string): ReadonlyArray<Stroke> =>
  Option.getOrElse(
    Schema.decodeUnknownOption(Strokes)(read(strokesKey(sessionId, problemId))),
    () => [],
  );

export const saveStrokes = (sessionId: string, problemId: string, strokes: ReadonlyArray<Stroke>) =>
  write(
    strokesKey(sessionId, problemId),
    strokes.length === 0 ? null : Schema.encodeSync(Strokes)(strokes),
  );

export const loadOutbox = (sessionId: string): ReadonlyArray<OutboxItem> =>
  Option.getOrElse(Schema.decodeUnknownOption(Outbox)(read(outboxKey(sessionId))), () => []);

export const saveOutbox = (sessionId: string, items: ReadonlyArray<OutboxItem>) =>
  write(outboxKey(sessionId), items.length === 0 ? null : Schema.encodeSync(Outbox)(items));
