import { INK_COLORS, type PenStroke, type WhiteboardDoc } from "./doc";

/**
 * Sample handwriting for stories: each glyph is a few polylines in a unit box,
 * sampled with seeded wobble so it looks hand-drawn and renders the same every time.
 */
const GLYPHS: Record<string, ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = {
  "0": [
    [
      [0.5, 0],
      [0.15, 0.2],
      [0.1, 0.6],
      [0.4, 1],
      [0.8, 0.8],
      [0.9, 0.3],
      [0.5, 0],
    ],
  ],
  "1": [
    [
      [0.3, 0.2],
      [0.55, 0],
      [0.55, 1],
    ],
  ],
  "2": [
    [
      [0.1, 0.25],
      [0.35, 0],
      [0.75, 0.05],
      [0.8, 0.35],
      [0.1, 1],
      [0.9, 1],
    ],
  ],
  "3": [
    [
      [0.15, 0.1],
      [0.6, 0],
      [0.8, 0.25],
      [0.4, 0.5],
      [0.85, 0.7],
      [0.6, 1],
      [0.1, 0.9],
    ],
  ],
  "4": [
    [
      [0.7, 1],
      [0.7, 0],
      [0.05, 0.7],
      [0.95, 0.7],
    ],
  ],
  "5": [
    [
      [0.85, 0],
      [0.2, 0],
      [0.15, 0.45],
      [0.7, 0.45],
      [0.85, 0.75],
      [0.55, 1],
      [0.1, 0.9],
    ],
  ],
  "8": [
    [
      [0.5, 0.5],
      [0.2, 0.25],
      [0.5, 0],
      [0.8, 0.25],
      [0.5, 0.5],
      [0.15, 0.75],
      [0.5, 1],
      [0.85, 0.75],
      [0.5, 0.5],
    ],
  ],
  x: [
    [
      [0.1, 0.35],
      [0.9, 1],
    ],
    [
      [0.9, 0.35],
      [0.1, 1],
    ],
  ],
  "+": [
    [
      [0.5, 0.25],
      [0.5, 0.85],
    ],
    [
      [0.2, 0.55],
      [0.8, 0.55],
    ],
  ],
  "-": [
    [
      [0.2, 0.55],
      [0.8, 0.55],
    ],
  ],
  "=": [
    [
      [0.15, 0.42],
      [0.85, 0.42],
    ],
    [
      [0.15, 0.7],
      [0.85, 0.7],
    ],
  ],
  "÷": [
    [
      [0.15, 0.55],
      [0.85, 0.55],
    ],
    [
      [0.5, 0.3],
      [0.52, 0.32],
    ],
    [
      [0.5, 0.78],
      [0.52, 0.8],
    ],
  ],
};

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Writes `text` starting at (x, y) with glyphs `size` units tall. */
export function handwrite(text: string, x: number, y: number, size: number, seed = 1): PenStroke[] {
  const random = seeded(seed);
  const strokes: PenStroke[] = [];
  let cursor = x;
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (glyph === undefined) {
      cursor += size * 0.5;
      continue;
    }
    const tilt = (random() - 0.5) * 0.08;
    for (const line of glyph) {
      const points: number[] = [];
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i] ?? [0, 0];
        const [bx, by] = line[i + 1] ?? [0, 0];
        for (let t = 0; t < 1; t += 0.2) {
          const gx = ax + (bx - ax) * t;
          const gy = ay + (by - ay) * t;
          const wobble = (random() - 0.5) * 0.04;
          points.push(
            Math.round((cursor + (gx + gy * tilt + wobble) * size * 0.62) * 10) / 10,
            Math.round((y + (gy + wobble) * size) * 10) / 10,
            0.5,
          );
        }
      }
      const [lx, ly] = line.at(-1) ?? [0, 0];
      points.push(
        Math.round((cursor + (lx + ly * tilt) * size * 0.62) * 10) / 10,
        Math.round((y + ly * size) * 10) / 10,
        0.5,
      );
      strokes.push({ _tag: "Pen", color: INK_COLORS[0], size: 4, points });
    }
    cursor += size * 0.75;
  }
  return strokes;
}

/** A student solving 2x + 3 = 11, with a circled answer. */
export const SOLVED_EQUATION: WhiteboardDoc = {
  version: 1,
  shape: "landscape",
  strokes: [
    ...handwrite("2x+3=11", 80, 80, 90, 3),
    ...handwrite("2x=8", 80, 230, 90, 7),
    ...handwrite("x=4", 80, 380, 90, 11),
    {
      _tag: "Pen",
      color: INK_COLORS[1],
      size: 4,
      points: Array.from({ length: 41 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2.15 - 0.4;
        return [
          Math.round((215 + Math.cos(a) * 170) * 10) / 10,
          Math.round((425 + Math.sin(a) * 85) * 10) / 10,
          0.5,
        ];
      }).flat(),
    },
  ],
};

/** The same work on a phone's portrait page, with room left below it. */
export const SOLVED_EQUATION_PORTRAIT: WhiteboardDoc = { ...SOLVED_EQUATION, shape: "portrait" };
