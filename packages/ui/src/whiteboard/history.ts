import type { PageShape, Stroke, WhiteboardDoc } from "./doc";

/** Undo and redo over whole docs. Clear is a step too, so it can be undone. */
export interface History {
  readonly past: ReadonlyArray<WhiteboardDoc>;
  readonly present: WhiteboardDoc;
  readonly future: ReadonlyArray<WhiteboardDoc>;
}

export type HistoryAction =
  | { readonly _tag: "AddStroke"; readonly stroke: Stroke }
  | { readonly _tag: "Undo" }
  | { readonly _tag: "Redo" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "SetShape"; readonly shape: PageShape };

export function startHistory(doc: WhiteboardDoc): History {
  return { past: [], present: doc, future: [] };
}

function push(history: History, next: WhiteboardDoc): History {
  return { past: [...history.past, history.present], present: next, future: [] };
}

export function historyReducer(history: History, action: HistoryAction): History {
  switch (action._tag) {
    case "AddStroke":
      return push(history, {
        ...history.present,
        strokes: [...history.present.strokes, action.stroke],
      });
    case "Clear":
      return history.present.strokes.length === 0
        ? history
        : push(history, { ...history.present, strokes: [] });
    case "SetShape":
      // Only a blank page changes shape, and not as an undo step: strokes are never rescaled.
      return history.present.strokes.length > 0 || history.present.shape === action.shape
        ? history
        : { ...history, present: { ...history.present, shape: action.shape } };
    case "Undo": {
      const previous = history.past.at(-1);
      return previous === undefined
        ? history
        : {
            past: history.past.slice(0, -1),
            present: previous,
            future: [history.present, ...history.future],
          };
    }
    case "Redo": {
      const [next, ...rest] = history.future;
      return next === undefined
        ? history
        : { past: [...history.past, history.present], present: next, future: rest };
    }
  }
}
