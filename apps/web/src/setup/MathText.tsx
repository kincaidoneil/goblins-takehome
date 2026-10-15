/**
 * Worksheet text with LaTeX between \( \) (inline) or \[ \] (display), as templates and extraction
 * write it. Paragraphs split on blank lines; lines written as `| a | b |` form a table whose first
 * row is the header.
 */
import katex from "katex";
import { Fragment, useMemo } from "react";

type Piece =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "math"; readonly html: string };

type Block =
  | { readonly kind: "lines"; readonly lines: ReadonlyArray<ReadonlyArray<Piece>> }
  | { readonly kind: "table"; readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<Piece>>> };

const MATH = /\\\((.+?)\\\)|\\\[(.+?)\\\]/gs;

const render = (tex: string, displayMode: boolean) =>
  katex.renderToString(tex, { displayMode, throwOnError: false, output: "html" });

const pieces = (text: string): ReadonlyArray<Piece> => {
  const out: Array<Piece> = [];
  let last = 0;
  for (const match of text.matchAll(MATH)) {
    if (match.index > last) out.push({ kind: "text", value: text.slice(last, match.index) });
    const inline = match[1];
    out.push({
      kind: "math",
      html: inline !== undefined ? render(inline, false) : render(match[2] ?? "", true),
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
};

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

const blocks = (paragraph: string): ReadonlyArray<Block> => {
  const out: Array<Block> = [];
  for (const line of paragraph.split("\n")) {
    const last = out.at(-1);
    if (isTableRow(line)) {
      if (isDivider(line)) continue;
      const cells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => pieces(cell.trim()));
      if (last?.kind === "table")
        out[out.length - 1] = { kind: "table", rows: [...last.rows, cells] };
      else out.push({ kind: "table", rows: [cells] });
    } else if (last?.kind === "lines") {
      out[out.length - 1] = { kind: "lines", lines: [...last.lines, pieces(line)] };
    } else {
      out.push({ kind: "lines", lines: [pieces(line)] });
    }
  }
  return out;
};

function Pieces({ pieces }: { readonly pieces: ReadonlyArray<Piece> }) {
  return pieces.map((piece, index) =>
    piece.kind === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: pieces have no identity beyond order
      <Fragment key={index}>{piece.value}</Fragment>
    ) : (
      // KaTeX output is generated markup with `trust` off, not user HTML.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: see above
      // biome-ignore lint/suspicious/noArrayIndexKey: as above
      <span key={index} dangerouslySetInnerHTML={{ __html: piece.html }} />
    ),
  );
}

export function MathText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  const paragraphs = useMemo(
    () =>
      text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== "")
        .flatMap(blocks),
    [text],
  );
  return (
    <div className={className}>
      {paragraphs.map((block, index) =>
        block.kind === "lines" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond order
          <p key={index} className="setup-paragraph">
            {block.lines.map((line, lineIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <Pieces pieces={line} />
              </Fragment>
            ))}
          </p>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <table key={index} className="setup-table">
            <thead>
              <tr>
                {block.rows[0]?.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above
                  <th key={cellIndex}>
                    <Pieces pieces={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: as above
                    <td key={cellIndex}>
                      <Pieces pieces={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      )}
    </div>
  );
}
