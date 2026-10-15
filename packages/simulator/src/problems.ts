import { getTemplate } from "@goblins/templates";
import { Option } from "effect";

/**
 * How many problems a student submits for a template: one per lettered part, since the app grades
 * each part as its own problem, and one per unlettered problem. Undefined for an unknown template.
 */
export const submissionsPerStudent = (templateId: string): number | undefined =>
  Option.match(getTemplate(templateId), {
    onNone: () => undefined,
    onSome: (template) =>
      template.problems.reduce(
        (sum, problem) => sum + (problem._tag === "WithParts" ? problem.parts.length : 1),
        0,
      ),
  });

/** 9 submissions per student, the closest of the four templates to the PRD's "about 10". */
export const DEFAULT_TEMPLATE = "angle-relationships";
