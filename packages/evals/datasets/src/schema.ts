import { ItemId, Review } from "@goblins/templates";
import { Schema } from "effect";

export { ItemId, Review };

// Rubrics ---------------------------------------------------------------------------------------

export const LineId = Schema.String.pipe(Schema.pattern(/^L[1-9]$/));

/** One AP-style point line: "1 pt: correct setup." */
export const RubricLine = Schema.Struct({
  id: LineId,
  points: Schema.Int.pipe(Schema.positive()),
  description: Schema.NonEmptyString,
});
export type RubricLine = typeof RubricLine.Type;

/**
 * The reference rubric for one gradable item (a whole problem, or one lettered part). Written by
 * hand from the answer key, so grading evals measure the grader against a fixed rubric.
 */
export const Rubric = Schema.Struct({
  itemId: ItemId,
  lines: Schema.NonEmptyArray(RubricLine),
  /** Rubric-wide guidance that is not a point line, e.g. which forms to accept. */
  notes: Schema.String,
});
export type Rubric = typeof Rubric.Type;

// Whiteboards -----------------------------------------------------------------------------------

/** A point on the 1024 × 768 whiteboard, in pixels from the top left. */
export const Pt = Schema.Tuple(Schema.Number, Schema.Number);
export type Pt = typeof Pt.Type;

/**
 * A line of handwriting. Without `at` it goes below the previous line. The text takes a small
 * markup: `x^2`, `x^{-1}`, `a_1`, `\frac{a}{b}`, `\sqrt{48}` or `√48`, `~~crossed out~~` and
 * `[[boxed answer]]`.
 */
export const Text = Schema.TaggedStruct("Text", {
  text: Schema.String,
  at: Schema.optional(Pt),
  /** Letter height in pixels; defaults to the case's style size. */
  size: Schema.optional(Schema.Number),
  /** Extra space above this line, in pixels. */
  gap: Schema.optional(Schema.Number),
  /** Extra left indent, in pixels. */
  indent: Schema.optional(Schema.Number),
  /** Rotation in degrees, clockwise. */
  rotate: Schema.optional(Schema.Number),
});

/** A hand-drawn polyline, closed into a polygon when `closed`. */
export const Path = Schema.TaggedStruct("Path", {
  points: Schema.Array(Pt).pipe(Schema.minItems(2)),
  closed: Schema.optional(Schema.Boolean),
  dashed: Schema.optional(Schema.Boolean),
});

export const Circle = Schema.TaggedStruct("Circle", {
  center: Pt,
  r: Schema.Number,
});

/** An angle mark. Angles in degrees, counterclockwise from the positive x direction. */
export const Arc = Schema.TaggedStruct("Arc", {
  center: Pt,
  r: Schema.Number,
  from: Schema.Number,
  to: Schema.Number,
});

/** A right-angle square at `vertex`, between the directions to `a` and `b`. */
export const RightAngle = Schema.TaggedStruct("RightAngle", {
  vertex: Pt,
  a: Pt,
  b: Pt,
  size: Schema.optional(Schema.Number),
});

export const Arrow = Schema.TaggedStruct("Arrow", { from: Pt, to: Pt });

export const Axis = Schema.Struct({
  min: Schema.Number,
  max: Schema.Number,
  /** Distance between labeled ticks, in data units. */
  step: Schema.Number,
  label: Schema.optional(Schema.String),
});

/** A sketched graph: axes with ticks, optional grid, lines and labeled points in data units. */
export const Graph = Schema.TaggedStruct("Graph", {
  /** Top-left corner of the plotting area. */
  at: Pt,
  size: Pt,
  x: Axis,
  y: Axis,
  grid: Schema.optional(Schema.Boolean),
  lines: Schema.optional(Schema.Array(Schema.Array(Pt).pipe(Schema.minItems(2)))),
  points: Schema.optional(
    Schema.Array(Schema.Struct({ at: Pt, label: Schema.optional(Schema.String) })),
  ),
});

/** Work scribbled over until unreadable. */
export const Scribble = Schema.TaggedStruct("Scribble", { at: Pt, size: Pt });

/** Faint marks left after erasing. */
export const Erased = Schema.TaggedStruct("Erased", { text: Schema.String, at: Pt });

/** A loop drawn around something, e.g. a final answer. */
export const Ring = Schema.TaggedStruct("Ring", { at: Pt, size: Pt });

export const Element = Schema.Union(
  Text,
  Path,
  Circle,
  Arc,
  RightAngle,
  Arrow,
  Graph,
  Scribble,
  Erased,
  Ring,
);
export type Element = typeof Element.Type;

export const Font = Schema.Literal(
  "caveat",
  "patrick-hand",
  "indie-flower",
  "shadows-into-light",
  "gochi-hand",
  "kalam",
  "nanum-pen-script",
  "reenie-beanie",
);
export type Font = typeof Font.Type;

/** The student whiteboard's three pen colors (packages/ui Whiteboard). */
export const Ink = Schema.Literal("black", "blue", "purple");
export type Ink = typeof Ink.Type;

/** How the student writes. Anything left out is picked from the case id, so it stays stable. */
export const Style = Schema.Struct({
  font: Schema.optional(Font),
  ink: Schema.optional(Ink),
  /** Letter height in pixels. Defaults to 40. */
  size: Schema.optional(Schema.Number),
  /** 0 is neat; 3 is hard to read. Drives jitter, slant and wobble. */
  mess: Schema.optional(Schema.Literal(0, 1, 2, 3)),
  /** Pen width for drawings, in pixels. Defaults to 4, the whiteboard pen. */
  pen: Schema.optional(Schema.Number),
});
export type Style = typeof Style.Type;

// Cases -----------------------------------------------------------------------------------------

export const Tag = Schema.Literal(
  "correct",
  "partial",
  "incorrect",
  "common-mistake",
  "follow-through",
  "alternate-method",
  "answer-only",
  "messy",
  "crossed-out",
  "blank",
  "near-blank",
  "diagram",
  "off-rubric",
);
export type Tag = typeof Tag.Type;

/**
 * Whether a careful grader should flag this submission for the teacher. `Either` covers cases a
 * teacher would accept both ways, such as slightly messy but readable work.
 */
export const Flag = Schema.Literal("ShouldFlag", "Either", "ShouldNotFlag");
export type Flag = typeof Flag.Type;

export const CaseId = Schema.String.pipe(Schema.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/));

export const Case = Schema.Struct({
  id: CaseId,
  itemId: ItemId,
  tags: Schema.NonEmptyArray(Tag),
  /** What the student did, in one sentence, for people reading eval reports. */
  summary: Schema.NonEmptyString,
  style: Style,
  board: Schema.Array(Element),
  /**
   * For a dependent item: the student's own whiteboard for each earlier item it uses, which the
   * grader receives alongside this one.
   */
  earlier: Schema.Array(Schema.Struct({ itemId: ItemId, caseId: CaseId })),
  expected: Schema.Struct({
    /** Correct points per rubric line, one entry per line of the item's rubric. */
    lines: Schema.NonEmptyArray(
      Schema.Struct({ id: LineId, points: Schema.Int.pipe(Schema.nonNegative()) }),
    ),
    flag: Flag,
    /** Why these points: the reasoning a careful teacher would give. */
    reason: Schema.NonEmptyString,
  }),
  review: Review,
});
export type Case = typeof Case.Type;

/**
 * Where a case's image came from: rendered on the landscape whiteboard, or the same work rendered
 * on a phone's portrait page (smaller and centered).
 */
export const Slice = Schema.Literal("generated", "phone");
export type Slice = typeof Slice.Type;
