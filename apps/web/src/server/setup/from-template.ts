/**
 * Turns a template from `@goblins/templates` into extracted problems with rubrics, with no model
 * call. Templates carry hand-checked answer keys but no rubrics, so the rubric is drafted here
 * from the answer: an exact answer gets a method point and an answer point; an open answer gets a
 * point per criterion.
 */
import type { Answer, Template } from "@goblins/templates";
import { Array as Arr } from "effect";
import type { Extracted, ExtractedProblem, RubricLineInput } from "./extracted";

/**
 * Template answers are LaTeX without delimiters ("x = 4\sqrt{3}", "16\sqrt{3} square units").
 * Wraps the math runs in \( \) and leaves plain words as text, so it renders like the problem text.
 */
export const answerToMarkup = (value: string): string => {
  if (!/[\\^_]/.test(value)) return value;
  const out: Array<string> = [];
  let math: Array<string> = [];
  const flush = () => {
    if (math.length > 0) out.push(`\\(${math.join(" ")}\\)`);
    math = [];
  };
  for (const token of value.split(" ")) {
    if (/^[A-Za-z]{3,}[,.;]?$/.test(token)) {
      flush();
      out.push(token);
    } else {
      math.push(token);
    }
  }
  flush();
  return out.join(" ");
};

const listJoin = (items: ReadonlyArray<string>) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} or ${items.at(-1)}`;

const rubricFor = (answer: Answer): Arr.NonEmptyReadonlyArray<RubricLineInput> => {
  switch (answer._tag) {
    case "Exact":
      return [
        { points: 1, description: "Shows a correct method." },
        { points: 1, description: `Correct answer: ${answerToMarkup(answer.value)}.` },
      ];
    case "Open":
      return Arr.map(answer.criteria, (criterion) => ({ points: 1, description: criterion }));
  }
};

const notesFor = (answer: Answer, dependsOn: ReadonlyArray<string>): string => {
  const notes: Array<string> = [];
  if (answer._tag === "Exact" && answer.accept.length > 0) {
    notes.push(`Accept equivalent forms, such as ${listJoin(answer.accept.map(answerToMarkup))}.`);
  }
  if (dependsOn.length > 0) {
    notes.push(
      `Follow-through: this uses the student's answer to ${listJoin(dependsOn)}. If that answer was wrong, give the method point for correct work built on it.`,
    );
  }
  return notes.join(" ");
};

const answerKeyFor = (answer: Answer, solution: string): string =>
  answer._tag === "Exact"
    ? `${answerToMarkup(answer.value)}\n\n${solution}`
    : `${answer.sample}\n\n${solution}`;

export const extractedFromTemplate = (template: Template): Extracted => {
  const problems = Arr.flatMap(
    template.problems,
    (problem): Arr.NonEmptyReadonlyArray<ExtractedProblem> => {
      const diagramDescription =
        problem.diagrams.length === 0
          ? null
          : problem.diagrams.map((diagram) => diagram.description).join("\n\n");
      const pageNumbers = [...problem.pages];
      switch (problem._tag) {
        case "Whole":
          return [
            {
              label: String(problem.number),
              text: problem.text,
              answerKey: answerKeyFor(problem.answer, problem.solution),
              diagramDescription,
              pageNumbers,
              gradingNotes: notesFor(problem.answer, problem.dependsOn),
              rubric: rubricFor(problem.answer),
              dependsOn: [...problem.dependsOn],
            },
          ];
        case "WithParts":
          // Each part is graded on its own, so it carries the shared stem: the grader sees one
          // problem at a time. The review screen shows the stem once per group.
          return Arr.map(problem.parts, (part) => ({
            label: `${problem.number}${part.label}`,
            text: problem.stem === "" ? part.text : `${problem.stem}\n\n${part.text}`,
            answerKey: answerKeyFor(part.answer, part.solution),
            diagramDescription,
            pageNumbers,
            gradingNotes: notesFor(part.answer, part.dependsOn),
            rubric: rubricFor(part.answer),
            dependsOn: [...part.dependsOn],
          }));
      }
    },
  );
  return { title: template.title, problems };
};
