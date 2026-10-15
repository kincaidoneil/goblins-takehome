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

/**
 * Whose work it is. Keys include the student, so a second student on a shared device never sees,
 * or sends, the first student's strokes or queued submissions.
 */
export interface Owner {
  readonly sessionId: string;
  readonly studentId: string;
}

// "board" rather than the old "strokes" key: work saved by the previous whiteboard is a different
// shape, and starting that problem's board fresh is better than misreading it.
const boardKey = (owner: Owner, problemId: string) =>
  `goblins:board:${owner.sessionId}:${owner.studentId}:${problemId}`;
const outboxKey = (owner: Owner) => `goblins:outbox:${owner.sessionId}:${owner.studentId}`;

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

export const loadBoard = (owner: Owner, problemId: string): WhiteboardDoc => {
  const saved = read(boardKey(owner, problemId));
  return saved === null ? EMPTY_DOC : Either.getOrElse(parseDoc(saved), () => EMPTY_DOC);
};

export const saveBoard = (owner: Owner, problemId: string, doc: WhiteboardDoc) =>
  write(boardKey(owner, problemId), doc.strokes.length === 0 ? null : serializeDoc(doc));

export const clearBoard = (owner: Owner, problemId: string) =>
  write(boardKey(owner, problemId), null);

export const loadOutbox = (owner: Owner): ReadonlyArray<OutboxItem> =>
  Option.getOrElse(Schema.decodeUnknownOption(Outbox)(read(outboxKey(owner))), () => []);

export const saveOutbox = (owner: Owner, items: ReadonlyArray<OutboxItem>) =>
  write(outboxKey(owner), items.length === 0 ? null : Schema.encodeSync(Outbox)(items));
