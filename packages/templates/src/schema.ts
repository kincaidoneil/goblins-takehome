import { Schema } from "effect";

/** A problem or part number as printed on the worksheet: "3", or "3b" for a lettered part. */
export const ItemId = Schema.String.pipe(
  Schema.pattern(/^[1-9][0-9]?[a-z]?$/),
  Schema.brand("ItemId"),
);
export type ItemId = typeof ItemId.Type;

/**
 * Whether a person has confirmed this answer. `Unsure` items need Kincaid's review before the
 * AI-quality stream treats them as ground truth.
 */
export const Review = Schema.Union(
  Schema.TaggedStruct("Checked", {}),
  Schema.TaggedStruct("Unsure", { note: Schema.NonEmptyString }),
);
export type Review = typeof Review.Type;

/**
 * `Exact`: one correct result, written canonically in `value`, with equivalent forms a grader
 * should also accept. `Open`: an explanation, drawing or choice among many valid answers, judged
 * against `criteria`; `sample` is one full-credit response.
 */
export const Answer = Schema.Union(
  Schema.TaggedStruct("Exact", {
    value: Schema.NonEmptyString,
    accept: Schema.Array(Schema.NonEmptyString),
  }),
  Schema.TaggedStruct("Open", {
    sample: Schema.NonEmptyString,
    criteria: Schema.NonEmptyArray(Schema.NonEmptyString),
  }),
);
export type Answer = typeof Answer.Type;

const keyFields = {
  answer: Answer,
  /** Worked solution a careful teacher would accept. */
  solution: Schema.NonEmptyString,
  /** Earlier items whose answers this one uses. Follow-through credit applies to these. */
  dependsOn: Schema.Array(ItemId),
  review: Review,
};

export const Part = Schema.Struct({
  label: Schema.String.pipe(Schema.pattern(/^[a-z]$/)),
  text: Schema.NonEmptyString,
  ...keyFields,
});
export type Part = typeof Part.Type;

/** A figure the grader needs, described in enough detail to solve the problem without the image. */
export const Diagram = Schema.Struct({ description: Schema.NonEmptyString });
export type Diagram = typeof Diagram.Type;

export const Source = Schema.Struct({
  /** The lesson's practice page on the publisher's site. */
  url: Schema.String.pipe(Schema.startsWith("https://im.kendallhunt.com/")),
  /** The problem number on that page. */
  problem: Schema.Int.pipe(Schema.positive()),
});

const problemFields = {
  number: Schema.Int.pipe(Schema.positive()),
  /** 1-based worksheet pages the problem appears on. Two entries when it runs across a break. */
  pages: Schema.NonEmptyArray(Schema.Int.pipe(Schema.positive())),
  source: Source,
  diagrams: Schema.Array(Diagram),
};

/**
 * A problem is either answered as a whole, or has lettered parts (a, b, c) that are each
 * answered and graded on their own. Math is written in LaTeX between \( and \).
 */
export const Problem = Schema.Union(
  Schema.TaggedStruct("Whole", { ...problemFields, text: Schema.NonEmptyString, ...keyFields }),
  Schema.TaggedStruct("WithParts", {
    ...problemFields,
    /** Text before the first part. Empty when the parts start right away. */
    stem: Schema.String,
    parts: Schema.NonEmptyArray(Part),
  }),
);
export type Problem = typeof Problem.Type;

export const Feature = Schema.Literal(
  "diagrams",
  "dependent-parts",
  "multi-page-problem",
  "skills-practice",
);
export type Feature = typeof Feature.Type;

export const Template = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^[a-z0-9-]+$/)),
  title: Schema.NonEmptyString,
  /** One sentence for the template picker. */
  description: Schema.NonEmptyString,
  course: Schema.NonEmptyString,
  band: Schema.Literal("middle-school", "high-school"),
  topic: Schema.NonEmptyString,
  features: Schema.NonEmptyArray(Feature),
  source: Schema.Struct({
    name: Schema.NonEmptyString,
    lessons: Schema.NonEmptyArray(
      Schema.Struct({ title: Schema.NonEmptyString, url: Schema.String }),
    ),
    /** The copyright notice the source supplies, which CC BY requires keeping. */
    copyright: Schema.NonEmptyString,
    license: Schema.Literal("CC BY 4.0"),
    licenseUrl: Schema.Literal("https://creativecommons.org/licenses/by/4.0/"),
    /** Attribution to show wherever the worksheet is shown. */
    attribution: Schema.NonEmptyString,
    /** What we changed from the source, as CC BY requires. */
    changes: Schema.NonEmptyString,
  }),
  files: Schema.Struct({
    pdf: Schema.Literal("worksheet.pdf"),
    pages: Schema.NonEmptyArray(
      Schema.Struct({
        image: Schema.String.pipe(Schema.pattern(/^page-[1-9]\.png$/)),
        width: Schema.Int,
        height: Schema.Int,
      }),
    ),
  }),
  problems: Schema.NonEmptyArray(Problem),
});
export type Template = typeof Template.Type;
