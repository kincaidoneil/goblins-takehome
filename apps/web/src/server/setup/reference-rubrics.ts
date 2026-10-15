/**
 * Hand-written rubrics for every template item, from the grading eval dataset
 * (`packages/evals/datasets/grading/rubrics`). The grader's accuracy is measured against these, so
 * a template draft starts from them. Imported at build time: the dataset's own loader reads files
 * from disk, which a Vercel function doesn't have.
 */
import { Option, Schema } from "effect";

const ReferenceRubric = Schema.Struct({
  itemId: Schema.String,
  lines: Schema.NonEmptyArray(
    Schema.Struct({
      points: Schema.Int.pipe(Schema.positive()),
      description: Schema.NonEmptyString,
    }),
  ),
  notes: Schema.optional(Schema.String),
});
export type ReferenceRubric = typeof ReferenceRubric.Type;

const files = import.meta.glob<unknown>(
  "../../../../../packages/evals/datasets/grading/rubrics/*.json",
  { eager: true, import: "default" },
);

const byTemplate = new Map(
  Object.entries(files).flatMap(([path, json]) => {
    const templateId = /rubrics\/([a-z0-9-]+)\.json$/.exec(path)?.[1];
    const decoded = Schema.decodeUnknownOption(Schema.Array(ReferenceRubric))(json);
    return templateId === undefined || Option.isNone(decoded)
      ? []
      : [[templateId, decoded.value] as const];
  }),
);

/** The reference rubric for one template item ("3b"), if the dataset has one. */
export const referenceRubric = (templateId: string, itemId: string) =>
  Option.fromNullable(byTemplate.get(templateId)?.find((rubric) => rubric.itemId === itemId));
