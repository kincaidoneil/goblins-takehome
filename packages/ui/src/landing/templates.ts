/**
 * What the landing page shows for each template. Placeholder data until
 * packages/templates lands; the Templates stream owns the real list.
 */
export interface TemplateSummary {
  id: string;
  title: string;
  grade: string;
  problemCount: number;
  /** Who published the worksheet and under what license. */
  source: string;
  /** Picks the placeholder thumbnail art. */
  topic: "circles" | "equations" | "triangles" | "fractions";
}

export const PLACEHOLDER_TEMPLATES: ReadonlyArray<TemplateSummary> = [
  {
    id: "placeholder-circles",
    title: "Circumference and area of circles",
    grade: "Grade 7",
    problemCount: 8,
    source: "Illustrative Mathematics · CC BY 4.0",
    topic: "circles",
  },
  {
    id: "placeholder-equations",
    title: "Solving two-step equations",
    grade: "Grade 7",
    problemCount: 10,
    source: "Illustrative Mathematics · CC BY 4.0",
    topic: "equations",
  },
  {
    id: "placeholder-pythagorean",
    title: "The Pythagorean theorem",
    grade: "Grade 8",
    problemCount: 6,
    source: "Illustrative Mathematics · CC BY 4.0",
    topic: "triangles",
  },
  {
    id: "placeholder-fractions",
    title: "Adding fractions with unlike denominators",
    grade: "Grade 5",
    problemCount: 12,
    source: "EngageNY · CC BY-NC-SA 3.0",
    topic: "fractions",
  },
];
