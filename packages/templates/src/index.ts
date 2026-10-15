import { Array as Arr, type Option, Schema } from "effect";
import angleRelationships from "../templates/angle-relationships/template.json" with {
  type: "json",
};
import linearRelationships from "../templates/linear-relationships/template.json" with {
  type: "json",
};
import rightTriangleTrigonometry from "../templates/right-triangle-trigonometry/template.json" with {
  type: "json",
};
import solvingLinearEquations from "../templates/solving-linear-equations/template.json" with {
  type: "json",
};
import { Template } from "./schema.ts";

export * from "./schema.ts";

/**
 * Every template, in the order the template picker shows them. The JSON files are checked into
 * this package and covered by its tests, so a decode failure here is a bug, not a runtime case.
 */
export const templates: Arr.NonEmptyReadonlyArray<Template> = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(Template),
)([angleRelationships, solvingLinearEquations, linearRelationships, rightTriangleTrigonometry]);

export const getTemplate = (id: string): Option.Option<Template> =>
  Arr.findFirst(templates, (t) => t.id === id);

export type TemplateFile = Template["files"]["pdf"] | Template["files"]["pages"][number]["image"];

/** The file URL of a template's worksheet PDF or page image, for reading it from Node. */
export const templateFileUrl = (template: Template, file: TemplateFile): URL =>
  new URL(`../templates/${template.id}/${file}`, import.meta.url);
