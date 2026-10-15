import { useEffect, useState } from "react";
import { loadStrokes, type Stroke, saveStrokes } from "./storage";

type History = {
  readonly present: ReadonlyArray<Stroke>;
  /** Earlier boards, most recent last. Clearing is one step, so it can be undone. */
  readonly past: ReadonlyArray<ReadonlyArray<Stroke>>;
};

const MAX_UNDO = 100;

/** One problem's whiteboard strokes with undo, kept in localStorage as they change. */
export function useStrokeHistory(sessionId: string, problemId: string) {
  const [history, setHistory] = useState<History>(() => ({
    present: loadStrokes(sessionId, problemId),
    past: [],
  }));

  useEffect(
    () => saveStrokes(sessionId, problemId, history.present),
    [sessionId, problemId, history.present],
  );

  const push = (next: (present: ReadonlyArray<Stroke>) => ReadonlyArray<Stroke>) =>
    setHistory((h) => ({
      present: next(h.present),
      past: [...h.past, h.present].slice(-MAX_UNDO),
    }));

  return {
    strokes: history.present,
    canUndo: history.past.length > 0,
    add: (stroke: Stroke) => push((present) => [...present, stroke]),
    clear: () => push(() => []),
    undo: () =>
      setHistory((h) => {
        const previous = h.past[h.past.length - 1];
        return previous === undefined ? h : { present: previous, past: h.past.slice(0, -1) };
      }),
  };
}
