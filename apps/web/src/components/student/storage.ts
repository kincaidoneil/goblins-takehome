/**
 * Work kept in this browser so a reload, a closed tab or a dropped connection loses nothing:
 * each problem's whiteboard, and submissions waiting to be sent. Everything read
 * back is validated, since another version of the app (or the student) may have written it.
 */
import { EMPTY_DOC, parseDoc, serializeDoc, type WhiteboardDoc } from "@goblins/ui";
import { Either, Option, Schema } from "effect";

export const OutboxItem = Schema.Struct({
  problemId: Schema.String,
  /** Base64 PNG without the `data:` prefix. */
  png: Schema.String,
  submittedAt: Schema.String,
});
export type OutboxItem = typeof OutboxItem.Type;

const Outbox = Schema.parseJson(Schema.Array(OutboxItem));

// "board" rather than the old "strokes" key: work saved by the previous whiteboard is a different
// shape, and starting that problem's board fresh is better than misreading it.
const boardKey = (sessionId: string, problemId: string) =>
  `goblins:board:${sessionId}:${problemId}`;
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

export const loadBoard = (sessionId: string, problemId: string): WhiteboardDoc => {
  const saved = read(boardKey(sessionId, problemId));
  return saved === null ? EMPTY_DOC : Either.getOrElse(parseDoc(saved), () => EMPTY_DOC);
};

export const saveBoard = (sessionId: string, problemId: string, doc: WhiteboardDoc) =>
  write(boardKey(sessionId, problemId), doc.strokes.length === 0 ? null : serializeDoc(doc));

export const clearBoard = (sessionId: string, problemId: string) =>
  write(boardKey(sessionId, problemId), null);

export const loadOutbox = (sessionId: string): ReadonlyArray<OutboxItem> =>
  Option.getOrElse(Schema.decodeUnknownOption(Outbox)(read(outboxKey(sessionId))), () => []);

export const saveOutbox = (sessionId: string, items: ReadonlyArray<OutboxItem>) =>
  write(outboxKey(sessionId), items.length === 0 ? null : Schema.encodeSync(Outbox)(items));
