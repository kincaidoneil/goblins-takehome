import { Schema } from "effect";

const Fraction = Schema.Number.pipe(Schema.between(0, 1));

/**
 * Where a figure sits on the worksheet: a 1-based page and a box given as fractions of that page
 * image's width and height, from the top left. Screens show the figure alone by cropping the page.
 */
export const DiagramCrop = Schema.Struct({
  page: Schema.Int.pipe(Schema.positive()),
  x: Fraction,
  y: Fraction,
  w: Fraction,
  h: Fraction,
});
export type DiagramCrop = typeof DiagramCrop.Type;
