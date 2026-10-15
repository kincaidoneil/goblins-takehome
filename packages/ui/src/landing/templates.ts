import { type Template, templates } from "@goblins/templates";
import angleRelationships from "./thumbnails/angle-relationships.webp";
import linearRelationships from "./thumbnails/linear-relationships.webp";
import rightTriangleTrigonometry from "./thumbnails/right-triangle-trigonometry.webp";
import solvingLinearEquations from "./thumbnails/solving-linear-equations.webp";

/**
 * Page-1 thumbnails, 560 px wide WebP made from packages/templates' page PNGs:
 *   cwebp -q 78 -resize 560 0 packages/templates/templates/<id>/page-1.png -o thumbnails/<id>.webp
 * Regenerate when a template's first page changes.
 */
const THUMBNAILS: Record<string, string> = {
  "angle-relationships": angleRelationships,
  "linear-relationships": linearRelationships,
  "right-triangle-trigonometry": rightTriangleTrigonometry,
  "solving-linear-equations": solvingLinearEquations,
};

/** What a template card shows. */
export interface TemplateSummary {
  id: string;
  title: string;
  /** One sentence on what the worksheet covers. */
  description: string;
  course: string;
  problemCount: number;
  /** Plain-language tags, such as "Diagrams". */
  tags: ReadonlyArray<string>;
  /** The attribution CC BY requires wherever the worksheet is shown. */
  attribution: string;
  licenseUrl: string;
  /** What we changed from the source, as CC BY requires. */
  changes: string;
  /** The publisher's page for the first lesson the problems come from. */
  sourceUrl: string | undefined;
  /** Undefined when a template has no thumbnail yet; the card shows a blank page. */
  thumbnailUrl: string | undefined;
}

const TAGS: Record<Template["features"][number], string> = {
  diagrams: "Diagrams",
  "dependent-parts": "Multi-step",
  "multi-page-problem": "Multi-page",
  "skills-practice": "Skills practice",
};

export function toSummary(template: Template): TemplateSummary {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    course: template.course,
    problemCount: template.problems.length,
    tags: template.features.map((feature) => TAGS[feature]),
    attribution: template.source.attribution,
    licenseUrl: template.source.licenseUrl,
    changes: template.source.changes,
    sourceUrl: template.source.lessons[0]?.url,
    thumbnailUrl: THUMBNAILS[template.id],
  };
}

export const TEMPLATE_SUMMARIES: ReadonlyArray<TemplateSummary> = templates.map(toSummary);
