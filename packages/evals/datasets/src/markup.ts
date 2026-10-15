/**
 * The small markup used in whiteboard text: `x^2`, `x^{-1}`, `a_1`, `\frac{a}{b}`, `\sqrt{48}`,
 * `√48`, `~~crossed out~~` and `[[boxed]]`. Symbols that handwriting fonts lack (√ ≈ → ∠ ° ✓ ℓ and a
 * few more) become `Sym` nodes, which the renderer draws as pen strokes.
 */

export type Node =
  | { readonly _tag: "Chars"; readonly text: string }
  | { readonly _tag: "Sym"; readonly sym: Sym }
  | { readonly _tag: "Sup"; readonly body: ReadonlyArray<Node> }
  | { readonly _tag: "Sub"; readonly body: ReadonlyArray<Node> }
  | { readonly _tag: "Frac"; readonly num: ReadonlyArray<Node>; readonly den: ReadonlyArray<Node> }
  | { readonly _tag: "Sqrt"; readonly body: ReadonlyArray<Node> }
  | { readonly _tag: "Strike"; readonly body: ReadonlyArray<Node> }
  | { readonly _tag: "Box"; readonly body: ReadonlyArray<Node> };

export const symbols = [
  "≈",
  "→",
  "∠",
  "×",
  "÷",
  "·",
  "π",
  "θ",
  "≠",
  "≤",
  "≥",
  "°",
  "⊥",
  "△",
  "✓",
  "ℓ",
] as const;
export type Sym = (typeof symbols)[number];
const isSym = (c: string): c is Sym => (symbols as ReadonlyArray<string>).includes(c);

/** Characters that end a bare `√48` or `x^2` operand. */
const operand = /[A-Za-z0-9.]/;

export const parse = (input: string): ReadonlyArray<Node> => {
  const text = input.replace(/[−–]/g, "-");
  let i = 0;

  const group = (): ReadonlyArray<Node> => {
    // After `^`, `_`, `\sqrt` or `√`: a braced group, or a bare run of letters and digits.
    if (text[i] === "{") {
      i++;
      return until("}");
    }
    let run = "";
    if (text[i] === "-") run += text[i++];
    while (i < text.length && operand.test(text[i] ?? "")) run += text[i++];
    return run === "" ? [] : [{ _tag: "Chars", text: run }];
  };

  const until = (close: string): ReadonlyArray<Node> => {
    const out: Array<Node> = [];
    let chars = "";
    const flush = () => {
      if (chars !== "") out.push({ _tag: "Chars", text: chars });
      chars = "";
    };
    while (i < text.length) {
      if (text.startsWith(close, i)) {
        i += close.length;
        break;
      }
      const c = text[i] ?? "";
      if (text.startsWith("~~", i)) {
        flush();
        i += 2;
        out.push({ _tag: "Strike", body: until("~~") });
      } else if (text.startsWith("[[", i)) {
        flush();
        i += 2;
        out.push({ _tag: "Box", body: until("]]") });
      } else if (text.startsWith("\\frac{", i)) {
        flush();
        i += 6;
        const num = until("}");
        i++; // the "{" opening the denominator
        out.push({ _tag: "Frac", num, den: until("}") });
      } else if (text.startsWith("\\sqrt", i)) {
        flush();
        i += 5;
        out.push({ _tag: "Sqrt", body: group() });
      } else if (c === "√") {
        flush();
        i++;
        out.push({ _tag: "Sqrt", body: group() });
      } else if (c === "^" || c === "_") {
        flush();
        i++;
        const body = group();
        out.push(c === "^" ? { _tag: "Sup", body } : { _tag: "Sub", body });
      } else if (isSym(c)) {
        flush();
        i++;
        out.push({ _tag: "Sym", sym: c });
      } else {
        chars += c;
        i++;
      }
    }
    flush();
    return out;
  };

  return until("\u0000");
};

/** Plain text of parsed markup, for transcripts: what a careful reader would type out. */
export const plain = (nodes: ReadonlyArray<Node>): string => nodes.map(plainNode).join("");

function plainNode(n: Node): string {
  switch (n._tag) {
    case "Chars":
      return n.text;
    case "Sym":
      return n.sym;
    case "Sup":
      return `^${wrap(plain(n.body))}`;
    case "Sub":
      return `_${wrap(plain(n.body))}`;
    case "Frac":
      return `${wrap(plain(n.num))}/${wrap(plain(n.den))}`;
    case "Sqrt":
      return `√${wrap(plain(n.body))}`;
    case "Strike":
      return `[crossed out: ${plain(n.body)}]`;
    case "Box":
      return `[boxed: ${plain(n.body)}]`;
  }
}

const wrap = (s: string) => (/^[A-Za-z0-9.]+$/.test(s) ? s : `(${s})`);
