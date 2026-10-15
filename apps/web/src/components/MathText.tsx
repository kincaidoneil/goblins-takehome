import "katex/dist/katex.min.css";
import katex from "katex";
import { useMemo } from "react";

type Piece =
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "Math"; readonly tex: string; readonly display: boolean };

/** Splits worksheet text on `\( … \)` (inline) and `\[ … \]` (display) delimiters. */
export function splitMath(source: string): ReadonlyArray<Piece> {
  const pieces: Array<Piece> = [];
  const pattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) pieces.push({ _tag: "Text", text: source.slice(last, match.index) });
    const inline = match[1];
    pieces.push(
      inline === undefined
        ? { _tag: "Math", tex: match[2] ?? "", display: true }
        : { _tag: "Math", tex: inline, display: false },
    );
    last = match.index + match[0].length;
  }
  if (last < source.length) pieces.push({ _tag: "Text", text: source.slice(last) });
  return pieces;
}

/** Problem text with its LaTeX rendered by KaTeX. Bad TeX shows as the source, never an error. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const pieces = useMemo(() => splitMath(text), [text]);
  return (
    <span className={className}>
      {pieces.map((piece, i) =>
        piece._tag === "Text" ? (
          // Pieces never reorder, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <span key={i} className="whitespace-pre-line">
            {piece.text}
          </span>
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            // KaTeX escapes its input; with `trust: false` it emits no links or raw HTML.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(piece.tex, {
                displayMode: piece.display,
                throwOnError: false,
                trust: false,
              }),
            }}
          />
        ),
      )}
    </span>
  );
}
