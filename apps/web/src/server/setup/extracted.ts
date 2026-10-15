/**
 * What extraction produces from worksheet pages: the problems a grader needs, before they have
 * database ids. Templates, the extraction stub and the AI-quality stream's extractor all return it.
 */
import { DiagramCrop } from "@goblins/domain";
import { Schema } from "effect";

export const RubricLineInput = Schema.Struct({
  points: Schema.Int.pipe(Schema.between(1, 20)),
  description: Schema.NonEmptyString.pipe(Schema.maxLength(500)),
});
export type RubricLineInput = typeof RubricLineInput.Type;

export const ExtractedProblem = Schema.Struct({
  /** As printed: "3" or "2b". */
  label: Schema.NonEmptyString,
  text: Schema.String,
  answerKey: Schema.String,
  diagramDescription: Schema.NullOr(Schema.String),
  /** Where each figure sits on the pages. Templates know; extraction gives none. */
  diagramCrops: Schema.Array(DiagramCrop),
  pageNumbers: Schema.Array(Schema.Int.pipe(Schema.positive())),
  gradingNotes: Schema.String,
  rubric: Schema.NonEmptyArray(RubricLineInput),
  /** Labels of earlier problems this one uses ("3a"). */
  dependsOn: Schema.Array(Schema.String),
});
export type ExtractedProblem = typeof ExtractedProblem.Type;

export const Extracted = Schema.Struct({
  /** A suggested assignment name, e.g. the worksheet's heading. */
  title: Schema.String,
  problems: Schema.NonEmptyArray(ExtractedProblem),
});
export type Extracted = typeof Extracted.Type;
