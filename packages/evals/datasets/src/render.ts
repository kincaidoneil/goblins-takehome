/**
 * Renders a case's whiteboard as a 1024 × 768 PNG that looks hand-written: handwriting fonts
 * drawn glyph by glyph with jitter, wobbly pen strokes, slanted lines and uneven ink. Everything
 * random is seeded from the case id, so a case renders the same way every time on one machine.
 */
import { createRequire } from "node:module";
import { type Canvas, createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { type Node, parse, type Sym } from "./markup.ts";
import type { Case, Element, Font, Ink, Pt, Style } from "./schema.ts";

export const WIDTH = 1024;
export const HEIGHT = 768;

const fonts: ReadonlyArray<Font> = [
  "caveat",
  "patrick-hand",
  "indie-flower",
  "shadows-into-light",
  "gochi-hand",
  "kalam",
  "nanum-pen-script",
  "reenie-beanie",
];

/** Brings each font to a similar letter height at the same nominal size. */
const fontScale: Record<Font, number> = {
  caveat: 1.12,
  "patrick-hand": 1.0,
  "indie-flower": 0.92,
  "shadows-into-light": 0.98,
  "gochi-hand": 1.0,
  kalam: 0.88,
  "nanum-pen-script": 1.3,
  "reenie-beanie": 1.28,
};

/** The whiteboard's pen colors, as the student whiteboard in packages/ui exports them. */
const inkColor: Record<Ink, string> = {
  black: "#1e2b24",
  blue: "#2f5bd3",
  purple: "#7c3aed",
};

let fontsRegistered = false;
const registerFonts = () => {
  if (fontsRegistered) return;
  const require = createRequire(import.meta.url);
  for (const f of fonts) {
    GlobalFonts.registerFromPath(
      require.resolve(`@fontsource/${f}/files/${f}-latin-400-normal.woff2`),
      f,
    );
  }
  fontsRegistered = true;
};

// Seeded randomness -----------------------------------------------------------------------------

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** mulberry32 */
const rng = (seed: number) => {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Uniform in [-1, 1] times `amp`. */
    jit: (amp: number) => (next() * 2 - 1) * amp,
    pick: <A>(xs: ReadonlyArray<A>): A => xs[Math.floor(next() * xs.length) % xs.length] as A,
  };
};
type Rng = ReturnType<typeof rng>;

/** The style a case renders with: what it sets, and stable picks from its id for the rest. */
export const resolveStyle = (id: string, style: Style) => {
  const r = rng(hash(`style:${id}`));
  const inks: ReadonlyArray<Ink> = ["black", "black", "black", "blue", "blue", "purple"];
  return {
    font: style.font ?? r.pick(fonts),
    ink: style.ink ?? r.pick(inks),
    size: style.size ?? 40,
    mess: style.mess ?? 1,
    pen: style.pen ?? 4,
    /** Extra outline on glyphs, so some students write heavier than others. */
    weight: 0.4 + r.next() * 1.2,
  };
};
type Resolved = ReturnType<typeof resolveStyle>;

// Drawing ---------------------------------------------------------------------------------------

interface Ctx {
  readonly g: SKRSContext2D;
  readonly r: Rng;
  readonly s: Resolved;
  readonly color: string;
  /** Opacity for glyphs; lowered to draw erased work. */
  alpha: number;
}

/** A pen stroke through `pts`, with a slow sideways wobble and slight overshoot at the ends. */
const stroke = (
  c: Ctx,
  pts: ReadonlyArray<Pt>,
  opts: { closed?: boolean; width?: number } = {},
) => {
  const { g, r, s } = c;
  const amp = 0.5 + s.mess * 0.6;
  const all = opts.closed && pts[0] ? [...pts, pts[0]] : [...pts];
  const out: Array<Pt> = [];
  all.forEach((b, k) => {
    const a = all[k - 1];
    if (!a) {
      out.push([b[0] + r.jit(amp), b[1] + r.jit(amp)]);
      return;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const n = Math.max(2, Math.ceil(len / 12));
    const ph = r.next() * Math.PI * 2;
    const bow = r.jit(amp * Math.min(3, len / 90));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const env = Math.sin(t * Math.PI);
      const off = env * (bow * 1.5 + amp * 0.4 * Math.sin(t * 7 + ph));
      out.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
    }
  });
  if (!opts.closed && out.length >= 2) {
    // Overshoot or stop short at each end, as a hand does.
    const extend = (p: Pt, q: Pt): Pt => {
      const e = r.jit(1 + s.mess * 1.5);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      return [p[0] + ((p[0] - q[0]) / d) * e, p[1] + ((p[1] - q[1]) / d) * e];
    };
    const first = out[0];
    const second = out[1];
    const last = out[out.length - 1];
    const beforeLast = out[out.length - 2];
    if (first && second) out[0] = extend(first, second);
    if (last && beforeLast) out[out.length - 1] = extend(last, beforeLast);
  }
  g.lineWidth = (opts.width ?? s.pen) * (0.85 + c.r.next() * 0.3);
  g.beginPath();
  for (const [i, [x, y]] of out.entries()) {
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
};

const ellipsePoints = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: Rng,
  turns = 1,
): Array<Pt> => {
  const start = r.next() * Math.PI * 2;
  const n = Math.ceil(28 * turns);
  const pts: Array<Pt> = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * Math.PI * 2 * turns;
    const grow = 1 + (i / n) * 0.06;
    pts.push([cx + Math.cos(t) * rx * grow, cy + Math.sin(t) * ry * grow]);
  }
  return pts;
};

// Text layout -----------------------------------------------------------------------------------

interface Box {
  readonly w: number;
  readonly up: number;
  readonly down: number;
}

const setFont = (c: Ctx, size: number) => {
  c.g.font = `${size * fontScale[c.s.font]}px "${c.s.font}"`;
};

const symWidth = (sym: Sym, size: number): number => {
  switch (sym) {
    case "°":
      return size * 0.36;
    case "ℓ":
      return size * 0.4;
    case "·":
      return size * 0.3;
    case "→":
      return size * 0.95;
    default:
      return size * 0.62;
  }
};

const measure = (c: Ctx, nodes: ReadonlyArray<Node>, size: number): Box => {
  let w = 0;
  let up = size * 0.75;
  let down = size * 0.25;
  for (const n of nodes) {
    switch (n._tag) {
      case "Chars":
        setFont(c, size);
        w += c.g.measureText(n.text).width;
        break;
      case "Sym":
        w += symWidth(n.sym, size);
        break;
      case "Sup": {
        const b = measure(c, n.body, size * 0.6);
        w += b.w + size * 0.05;
        up = Math.max(up, size * 0.42 + b.up);
        break;
      }
      case "Sub": {
        const b = measure(c, n.body, size * 0.6);
        w += b.w + size * 0.05;
        down = Math.max(down, size * 0.18 + b.down);
        break;
      }
      case "Frac": {
        const num = measure(c, n.num, size * 0.8);
        const den = measure(c, n.den, size * 0.8);
        w += Math.max(num.w, den.w) + size * 0.42;
        up = Math.max(up, size * 0.3 + size * 0.12 + num.up + num.down);
        down = Math.max(down, -size * 0.3 + size * 0.1 + den.up + den.down);
        break;
      }
      case "Sqrt": {
        const b = measure(c, n.body, size);
        w += b.w + size * 0.6;
        up = Math.max(up, b.up + size * 0.18);
        break;
      }
      case "Strike":
      case "Box": {
        const b = measure(c, n.body, size);
        w += b.w + (n._tag === "Box" ? size * 0.4 : 0);
        up = Math.max(up, b.up + (n._tag === "Box" ? size * 0.12 : 0));
        down = Math.max(down, b.down + (n._tag === "Box" ? size * 0.12 : 0));
        break;
      }
    }
  }
  return { w, up, down };
};

const drawChars = (c: Ctx, text: string, x0: number, base: number, size: number): number => {
  const { g, r, s } = c;
  setFont(c, size);
  let x = x0;
  for (const ch of text) {
    const cw = g.measureText(ch).width;
    if (ch !== " ") {
      g.save();
      g.translate(x + r.jit(s.mess * 0.8), base + r.jit(0.6 + s.mess * 1.2));
      g.rotate((r.jit(1.5 + s.mess * 2.5) * Math.PI) / 180);
      const k = 1 + r.jit(0.02 + s.mess * 0.035);
      g.scale(k, k);
      g.globalAlpha = c.alpha * (0.9 + r.next() * 0.1);
      g.fillText(ch, 0, 0);
      if (s.weight > 0.15) {
        g.lineWidth = s.weight;
        g.strokeText(ch, 0, 0);
      }
      g.restore();
    }
    x +=
      (ch === " " ? Math.max(cw * 0.7, size * 0.28) : cw) * (1 + r.jit(0.03 + s.mess * 0.05)) +
      r.jit(s.mess * 0.8);
  }
  return x - x0;
};

const drawSym = (c: Ctx, sym: Sym, x: number, base: number, size: number) => {
  const w = Math.max(1.6, size * 0.075);
  const s = size;
  const line = (pts: ReadonlyArray<Pt>) => stroke(c, pts, { width: w });
  switch (sym) {
    case "°":
      stroke(c, ellipsePoints(x + s * 0.2, base - s * 0.66, s * 0.08, s * 0.08, c.r), {
        width: w * 0.8,
      });
      break;
    case "·":
      c.g.beginPath();
      c.g.arc(x + s * 0.15, base - s * 0.3, w * 0.9, 0, Math.PI * 2);
      c.g.fill();
      break;
    case "≈":
      for (const dy of [0.22, 0.42]) {
        const y = base - s * dy;
        line([
          [x + s * 0.05, y + s * 0.04],
          [x + s * 0.2, y - s * 0.06],
          [x + s * 0.38, y + s * 0.05],
          [x + s * 0.55, y - s * 0.05],
        ]);
      }
      break;
    case "→":
      line([
        [x + s * 0.05, base - s * 0.32],
        [x + s * 0.8, base - s * 0.32],
      ]);
      line([
        [x + s * 0.62, base - s * 0.45],
        [x + s * 0.82, base - s * 0.32],
        [x + s * 0.62, base - s * 0.19],
      ]);
      break;
    case "∠":
      line([
        [x + s * 0.5, base - s * 0.62],
        [x + s * 0.05, base],
        [x + s * 0.58, base],
      ]);
      break;
    case "×":
      line([
        [x + s * 0.12, base - s * 0.5],
        [x + s * 0.48, base - s * 0.12],
      ]);
      line([
        [x + s * 0.48, base - s * 0.5],
        [x + s * 0.12, base - s * 0.12],
      ]);
      break;
    case "÷":
      line([
        [x + s * 0.08, base - s * 0.32],
        [x + s * 0.52, base - s * 0.32],
      ]);
      for (const dy of [0.52, 0.12]) {
        c.g.beginPath();
        c.g.arc(x + s * 0.3, base - s * dy, w * 0.9, 0, Math.PI * 2);
        c.g.fill();
      }
      break;
    case "π":
      line([
        [x + s * 0.04, base - s * 0.5],
        [x + s * 0.58, base - s * 0.54],
      ]);
      line([
        [x + s * 0.18, base - s * 0.5],
        [x + s * 0.14, base],
      ]);
      line([
        [x + s * 0.42, base - s * 0.52],
        [x + s * 0.42, base - s * 0.1],
        [x + s * 0.54, base],
      ]);
      break;
    case "θ":
      stroke(c, ellipsePoints(x + s * 0.28, base - s * 0.36, s * 0.2, s * 0.36, c.r), { width: w });
      line([
        [x + s * 0.1, base - s * 0.36],
        [x + s * 0.46, base - s * 0.36],
      ]);
      break;
    case "≠":
      line([
        [x + s * 0.06, base - s * 0.22],
        [x + s * 0.52, base - s * 0.22],
      ]);
      line([
        [x + s * 0.06, base - s * 0.42],
        [x + s * 0.52, base - s * 0.42],
      ]);
      line([
        [x + s * 0.4, base - s * 0.62],
        [x + s * 0.18, base - s * 0.02],
      ]);
      break;
    case "≤":
    case "≥": {
      const flip = sym === "≥";
      const l = x + s * 0.1;
      const rr = x + s * 0.5;
      line([
        [flip ? l : rr, base - s * 0.62],
        [flip ? rr : l, base - s * 0.42],
        [flip ? l : rr, base - s * 0.22],
      ]);
      line([
        [l, base - s * 0.08],
        [rr, base - s * 0.08],
      ]);
      break;
    }
    case "✓":
      line([
        [x + s * 0.06, base - s * 0.3],
        [x + s * 0.22, base - s * 0.04],
        [x + s * 0.58, base - s * 0.7],
      ]);
      break;
    case "ℓ":
      line([
        [x + s * 0.06, base - s * 0.12],
        [x + s * 0.3, base - s * 0.62],
        [x + s * 0.26, base - s * 0.76],
        [x + s * 0.16, base - s * 0.6],
        [x + s * 0.14, base - s * 0.08],
        [x + s * 0.36, base - s * 0.04],
      ]);
      break;
    case "⊥":
      line([
        [x + s * 0.3, base - s * 0.62],
        [x + s * 0.3, base],
      ]);
      line([
        [x + s * 0.04, base],
        [x + s * 0.56, base],
      ]);
      break;
    case "△":
      stroke(
        c,
        [
          [x + s * 0.3, base - s * 0.62],
          [x + s * 0.56, base],
          [x + s * 0.04, base],
        ],
        { closed: true, width: w },
      );
      break;
  }
};

/** Draws parsed markup with its baseline at `base`; returns the width used. */
const drawNodes = (
  c: Ctx,
  nodes: ReadonlyArray<Node>,
  x0: number,
  base: number,
  size: number,
): number => {
  let x = x0;
  const penW = Math.max(1.6, size * 0.075);
  for (const n of nodes) {
    switch (n._tag) {
      case "Chars":
        x += drawChars(c, n.text, x, base, size);
        break;
      case "Sym":
        drawSym(c, n.sym, x, base, size);
        x += symWidth(n.sym, size);
        break;
      case "Sup":
        x += drawNodes(c, n.body, x + size * 0.03, base - size * 0.42, size * 0.6) + size * 0.05;
        break;
      case "Sub":
        x += drawNodes(c, n.body, x + size * 0.03, base + size * 0.18, size * 0.6) + size * 0.05;
        break;
      case "Frac": {
        const fs = size * 0.8;
        const num = measure(c, n.num, fs);
        const den = measure(c, n.den, fs);
        x += size * 0.22;
        const w = Math.max(num.w, den.w) + size * 0.2;
        const bar = base - size * 0.3;
        drawNodes(
          c,
          n.num,
          x + size * 0.1 + (w - size * 0.2 - num.w) / 2,
          bar - size * 0.12 - num.down,
          fs,
        );
        drawNodes(
          c,
          n.den,
          x + size * 0.1 + (w - size * 0.2 - den.w) / 2,
          bar + size * 0.1 + den.up,
          fs,
        );
        stroke(
          c,
          [
            [x + size * 0.02, bar],
            [x + w, bar + c.r.jit(2)],
          ],
          { width: penW },
        );
        x += w + size * 0.1;
        break;
      }
      case "Sqrt": {
        const b = measure(c, n.body, size);
        const top = base - b.up - size * 0.12;
        const bodyX = x + size * 0.48;
        stroke(
          c,
          [
            [x + size * 0.02, base - size * 0.32],
            [x + size * 0.14, base - size * 0.4],
            [x + size * 0.28, base + size * 0.02],
            [x + size * 0.42, top],
            [bodyX + b.w + size * 0.08, top + c.r.jit(2)],
          ],
          { width: penW },
        );
        drawNodes(c, n.body, bodyX, base, size);
        x += b.w + size * 0.6;
        break;
      }
      case "Strike": {
        const w = drawNodes(c, n.body, x, base, size);
        const mid = base - size * 0.32;
        const style = c.r.next();
        if (style < 0.5) {
          stroke(
            c,
            [
              [x - 4, mid + c.r.jit(3)],
              [x + w + 4, mid + c.r.jit(3)],
            ],
            { width: penW * 1.1 },
          );
        } else if (style < 0.8) {
          stroke(
            c,
            [
              [x - 4, mid - 4],
              [x + w + 4, mid - 6],
            ],
            { width: penW },
          );
          stroke(
            c,
            [
              [x - 2, mid + 5],
              [x + w + 6, mid + 3],
            ],
            { width: penW },
          );
        } else {
          // A zigzag scratched through the work.
          const pts: Array<Pt> = [];
          for (let px = x - 4, up = true; px <= x + w + 4; px += size * 0.22, up = !up) {
            pts.push([px, mid + (up ? -size * 0.25 : size * 0.2)]);
          }
          if (pts.length >= 2) stroke(c, pts, { width: penW });
        }
        x += w;
        break;
      }
      case "Box": {
        const pad = size * 0.2;
        const b = measure(c, n.body, size);
        drawNodes(c, n.body, x + pad, base, size);
        const left = x + 2;
        const right = x + pad * 2 + b.w;
        const topY = base - b.up - size * 0.08;
        const botY = base + b.down + size * 0.06;
        if (c.r.next() < 0.6) {
          stroke(
            c,
            [
              [left, topY],
              [right, topY],
              [right, botY],
              [left, botY],
            ],
            {
              closed: true,
              width: penW,
            },
          );
        } else {
          stroke(
            c,
            ellipsePoints(
              (left + right) / 2,
              (topY + botY) / 2,
              (right - left) / 2 + 6,
              (botY - topY) / 2 + 6,
              c.r,
              1.1,
            ),
            { width: penW },
          );
        }
        x += pad * 2 + b.w;
        break;
      }
    }
  }
  return x - x0;
};

// Elements --------------------------------------------------------------------------------------

const MARGIN = 40;

const drawGraph = (c: Ctx, el: Extract<Element, { _tag: "Graph" }>) => {
  const [gx, gy] = el.at;
  const [w, h] = el.size;
  const px = (p: Pt): Pt => [
    gx + ((p[0] - el.x.min) / (el.x.max - el.x.min)) * w,
    gy + h - ((p[1] - el.y.min) / (el.y.max - el.y.min)) * h,
  ];
  const label = Math.max(14, c.s.size * 0.5);
  if (el.grid) {
    c.g.save();
    c.g.globalAlpha = 0.22;
    for (let v = el.x.min + el.x.step; v <= el.x.max + 1e-9; v += el.x.step) {
      const [x] = px([v, 0]);
      stroke(
        c,
        [
          [x, gy],
          [x, gy + h],
        ],
        { width: 1.2 },
      );
    }
    for (let v = el.y.min + el.y.step; v <= el.y.max + 1e-9; v += el.y.step) {
      const [, y] = px([0, v]);
      stroke(
        c,
        [
          [gx, y],
          [gx + w, y],
        ],
        { width: 1.2 },
      );
    }
    c.g.restore();
  }
  stroke(c, [
    [gx, gy - 10],
    [gx, gy + h],
    [gx + w + 10, gy + h],
  ]);
  for (let v = el.x.min; v <= el.x.max + 1e-9; v += el.x.step) {
    const [x, y] = px([v, el.y.min]);
    stroke(
      c,
      [
        [x, y - 5],
        [x, y + 5],
      ],
      { width: 2 },
    );
    drawNodes(c, parse(fmt(v)), x - label * 0.3, y + label * 1.2, label);
  }
  for (let v = el.y.min + el.y.step; v <= el.y.max + 1e-9; v += el.y.step) {
    const [x, y] = px([el.x.min, v]);
    stroke(
      c,
      [
        [x - 5, y],
        [x + 5, y],
      ],
      { width: 2 },
    );
    const text = parse(fmt(v));
    drawNodes(c, text, x - measure(c, text, label).w - 9, y + label * 0.35, label);
  }
  if (el.x.label) drawNodes(c, parse(el.x.label), gx + w - 20, gy + h + label * 2.6, label);
  if (el.y.label) drawNodes(c, parse(el.y.label), gx - 6, gy - 18, label);
  for (const l of el.lines ?? []) stroke(c, l.map(px), { width: c.s.pen });
  for (const p of el.points ?? []) {
    const [x, y] = px(p.at);
    c.g.beginPath();
    c.g.arc(x + c.r.jit(1), y + c.r.jit(1), c.s.pen * 1.6, 0, Math.PI * 2);
    c.g.fill();
    if (p.label) drawNodes(c, parse(p.label), x + 10, y - 10, label * 1.15);
  }
};

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** The landscape whiteboard, and the 3:4 portrait page a phone shows at the same width. */
const LANDSCAPE = { width: WIDTH, height: HEIGHT };
const PORTRAIT = { width: WIDTH, height: Math.round((WIDTH * 4) / 3) };

export const renderBoard = (
  id: string,
  style: Style,
  board: ReadonlyArray<Element>,
  page: { readonly width: number; readonly height: number } = LANDSCAPE,
): Canvas => {
  registerFonts();
  const canvas = createCanvas(page.width, page.height);
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, page.width, page.height);
  const s = resolveStyle(id, style);
  const color = inkColor[s.ink];
  const r = rng(hash(`draw:${id}`));
  const c: Ctx = { g, r, s, color, alpha: 1 };
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";

  // The whole board drifts a little: students rarely write level.
  const drift = r.jit(0.4 + s.mess * 0.5);
  let flowX = MARGIN;
  let flowY = 28;

  for (const el of board) {
    g.save();
    g.setLineDash([]);
    switch (el._tag) {
      case "Text": {
        const size = (el.size ?? s.size) * (1 + r.jit(0.02 + s.mess * 0.03));
        const nodes = parse(el.text);
        const box = measure(c, nodes, size);
        if (el.at) {
          flowX = el.at[0];
          flowY = el.at[1];
        }
        flowY += el.gap ?? 0;
        const x = flowX + (el.indent ?? 0) + (el.at ? 0 : r.jit(2 + s.mess * 5));
        const base = flowY + box.up;
        g.translate(x, base);
        g.rotate((((el.rotate ?? 0) + drift + r.jit(0.3 + s.mess * 0.7)) * Math.PI) / 180);
        drawNodes(c, nodes, 0, 0, size);
        flowY = base + box.down + size * (0.32 + s.mess * 0.06) + r.jit(3);
        break;
      }
      case "Path":
        if (el.dashed) g.setLineDash([10, 9]);
        stroke(c, el.points, el.closed ? { closed: true } : {});
        break;
      case "Circle":
        stroke(c, ellipsePoints(el.center[0], el.center[1], el.r, el.r, r, 1.03), {});
        break;
      case "Arc": {
        const pts: Array<Pt> = [];
        const n = Math.max(6, Math.ceil(Math.abs(el.to - el.from) / 8));
        for (let i = 0; i <= n; i++) {
          const t = ((el.from + ((el.to - el.from) * i) / n) * Math.PI) / 180;
          pts.push([el.center[0] + Math.cos(t) * el.r, el.center[1] - Math.sin(t) * el.r]);
        }
        stroke(c, pts, { width: s.pen * 0.8 });
        break;
      }
      case "RightAngle": {
        const k = el.size ?? 16;
        const unit = (p: Pt): Pt => {
          const dx = p[0] - el.vertex[0];
          const dy = p[1] - el.vertex[1];
          const d = Math.hypot(dx, dy) || 1;
          return [(dx / d) * k, (dy / d) * k];
        };
        const [ax, ay] = unit(el.a);
        const [bx, by] = unit(el.b);
        const [vx, vy] = el.vertex;
        stroke(
          c,
          [
            [vx + ax, vy + ay],
            [vx + ax + bx, vy + ay + by],
            [vx + bx, vy + by],
          ],
          {
            width: s.pen * 0.8,
          },
        );
        break;
      }
      case "Arrow": {
        stroke(c, [el.from, el.to]);
        const ang = Math.atan2(el.to[1] - el.from[1], el.to[0] - el.from[0]);
        const head = (d: number): Pt => [
          el.to[0] - Math.cos(ang + d) * 16,
          el.to[1] - Math.sin(ang + d) * 16,
        ];
        stroke(c, [head(0.45), el.to, head(-0.45)]);
        break;
      }
      case "Graph":
        drawGraph(c, el);
        break;
      case "Scribble": {
        const [x, y] = el.at;
        const [w, h] = el.size;
        const pts: Array<Pt> = [];
        for (let yy = y, left = true; yy <= y + h; yy += 5 + r.next() * 4, left = !left) {
          pts.push([left ? x + r.jit(6) : x + w + r.jit(6), yy]);
        }
        if (pts.length >= 2) stroke(c, pts, { width: s.pen * 0.9 });
        break;
      }
      case "Erased": {
        g.translate(el.at[0], el.at[1] + s.size * 0.75);
        c.alpha = 0.13;
        drawNodes(c, parse(el.text), 0, 0, s.size);
        g.translate(r.jit(3), 2);
        c.alpha = 0.07;
        drawNodes(c, parse(el.text), 0, 0, s.size);
        c.alpha = 1;
        break;
      }
      case "Ring": {
        const [x, y] = el.at;
        const [w, h] = el.size;
        stroke(c, ellipsePoints(x + w / 2, y + h / 2, w / 2, h / 2, r, 1.12), {});
        break;
      }
    }
    g.restore();
  }
  return canvas;
};

export const renderCase = (c: Pick<Case, "id" | "style" | "board">): Buffer =>
  renderBoard(c.id, c.style, c.board).toBuffer("image/png");

/**
 * The same work written on a phone: the whiteboard there is a 3:4 portrait page, and its export
 * scales the page to fit 1024 × 768 and centers it, so the work sits in a 576 px column between
 * white bands with handwriting at about 0.56 times the size.
 */
export const renderCasePhone = (c: Pick<Case, "id" | "style" | "board">): Buffer => {
  const portrait = renderBoard(c.id, c.style, c.board, PORTRAIT);
  const out = createCanvas(WIDTH, HEIGHT);
  const g = out.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const scale = HEIGHT / PORTRAIT.height;
  const w = PORTRAIT.width * scale;
  g.drawImage(portrait, (WIDTH - w) / 2, 0, w, HEIGHT);
  return out.toBuffer("image/png");
};
