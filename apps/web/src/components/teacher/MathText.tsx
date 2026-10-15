import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Worksheet text: paragraphs, pipe tables (`| a | b |` lines, the first row a header) and inline
 * LaTeX between `\(` and `\)`, rendered with KaTeX.
 */
type Block =
  | { readonly _tag: "Paragraph"; readonly key: string; readonly text: string }
  | {
      readonly _tag: "Table";
      readonly key: string;
      readonly rows: ReadonlyArray<Row>;
    };

interface Row {
  readonly key: string;
  readonly header: boolean;
  readonly cells: ReadonlyArray<{ readonly key: string; readonly text: string }>;
}

const isTableLine = (line: string) => line.trim().startsWith("|");
const isSeparatorRow = (cells: ReadonlyArray<string>) =>
  cells.every((cell) => /^:?-+:?$/.test(cell));

const blocks = (text: string): ReadonlyArray<Block> => {
  const result: Array<Block> = [];
  const lines = text.split("\n");
  let paragraph: Array<string> = [];
  let table: Array<Row> = [];
  const flush = (index: number) => {
    if (paragraph.length > 0) {
      result.push({ _tag: "Paragraph", key: `p${index}`, text: paragraph.join("\n") });
      paragraph = [];
    }
    if (table.length > 0) {
      result.push({ _tag: "Table", key: `t${index}`, rows: table });
      table = [];
    }
  };
  lines.forEach((line, index) => {
    if (isTableLine(line)) {
      if (paragraph.length > 0) flush(index);
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim());
      if (!isSeparatorRow(cells)) {
        table.push({
          key: `r${index}`,
          header: table.length === 0,
          cells: cells.map((text, c) => ({ key: `r${index}c${c}`, text })),
        });
      }
    } else if (line.trim() === "") {
      flush(index);
    } else {
      if (table.length > 0) flush(index);
      paragraph.push(line);
    }
  });
  flush(lines.length);
  return result;
};

/** Splits on `\( … \)`, keyed by character offset. */
const inline = (text: string) => {
  let offset = 0;
  return text
    .split(/(\\\(.*?\\\))/gs)
    .filter((part) => part !== "")
    .map((part) => {
      const key = String(offset);
      offset += part.length;
      return part.startsWith("\\(") && part.endsWith("\\)") ? (
        <span
          key={key}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, rendered with throwOnError off
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(part.slice(2, -2), { throwOnError: false }),
          }}
        />
      ) : (
        <span key={key}>{part}</span>
      );
    });
};

export function MathText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      {blocks(text).map((block) =>
        block._tag === "Paragraph" ? (
          <p key={block.key} className="whitespace-pre-line [&:not(:first-child)]:mt-2">
            {inline(block.text)}
          </p>
        ) : (
          <table
            key={block.key}
            className="my-2 border-collapse text-sm [&:not(:first-child)]:mt-2"
          >
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.key}>
                  {row.cells.map((cell) =>
                    row.header ? (
                      <th
                        key={cell.key}
                        className="border border-border bg-surface-sunken px-3 py-1 text-center font-bold"
                      >
                        {inline(cell.text)}
                      </th>
                    ) : (
                      <td key={cell.key} className="border border-border px-3 py-1 text-center">
                        {inline(cell.text)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      )}
    </div>
  );
}
