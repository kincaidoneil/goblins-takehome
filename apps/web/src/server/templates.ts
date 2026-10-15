/**
 * Starting an assignment from a template in `packages/templates`.
 *
 * Templates come with answer keys but not rubrics. Until the AI-quality stream's rubric drafting
 * lands, the rubric is drafted mechanically from the key: an exact answer gets a method point and
 * an answer point; an open answer gets one point per criterion. The teacher reviews and edits it
 * either way.
 */
import { Db, SqlClient, schema } from "@goblins/domain";
import { type Answer, getTemplate, type Problem, type Template } from "@goblins/templates";
import { Effect, Option } from "effect";
import type { Owner } from "./owner";

/** Page images, bundled by Vite so they are served as static assets in every environment. */
const pageImages = import.meta.glob<string>(
  "../../../../packages/templates/templates/*/page-*.png",
  { query: "?url", import: "default", eager: true },
);

const pageImageUrl = (templateId: string, image: string) => {
  const key = `../../../../packages/templates/templates/${templateId}/${image}`;
  const url = pageImages[key];
  return url === undefined
    ? Effect.die(`Template page image missing from the bundle: ${key}`)
    : Effect.succeed(url);
};

interface DraftProblem {
  readonly label: string;
  readonly text: string;
  readonly answer: Answer;
  readonly solution: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly pages: ReadonlyArray<number>;
  readonly diagramDescription: string | null;
}

const flatten = (problem: Problem): ReadonlyArray<DraftProblem> => {
  const diagramDescription =
    problem.diagrams.length === 0 ? null : problem.diagrams.map((d) => d.description).join("\n\n");
  if (problem._tag === "Whole") {
    return [
      {
        label: String(problem.number),
        text: problem.text,
        answer: problem.answer,
        solution: problem.solution,
        dependsOn: problem.dependsOn,
        pages: problem.pages,
        diagramDescription,
      },
    ];
  }
  // Each part is graded on its own, so it becomes its own problem, carrying the stem with it.
  return problem.parts.map((part) => ({
    label: `${problem.number}${part.label}`,
    text: problem.stem === "" ? part.text : `${problem.stem}\n\n${part.text}`,
    answer: part.answer,
    solution: part.solution,
    dependsOn: part.dependsOn,
    pages: problem.pages,
    diagramDescription,
  }));
};

const answerKey = (answer: Answer) => (answer._tag === "Exact" ? answer.value : answer.sample);

const gradingNotes = (draft: DraftProblem) =>
  [
    draft.answer._tag === "Exact" && draft.answer.accept.length > 0
      ? `Also accept: ${draft.answer.accept.join("; ")}.`
      : "Accept equivalent forms.",
    `Worked solution: ${draft.solution}`,
  ].join("\n");

const draftRubric = (draft: DraftProblem) =>
  draft.answer._tag === "Exact"
    ? [
        { points: 1, description: "Correct method or setup." },
        { points: 1, description: `Correct answer: ${draft.answer.value}.` },
      ]
    : draft.answer.criteria.map((criterion) => ({ points: 1, description: criterion }));

const insertTemplate = (template: Template, owner: Owner) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [assignment] = yield* db
      .insert(schema.assignments)
      .values({
        title: template.title,
        templateId: template.id,
        extractionStatus: "ready",
        ...(owner._tag === "Teacher"
          ? { teacherId: owner.teacher.id }
          : { draftOwnerId: owner.draftOwnerId }),
      })
      .returning({ id: schema.assignments.id });
    if (assignment === undefined) return yield* Effect.die("assignment insert returned no row");

    const pages = yield* Effect.forEach(template.files.pages, (page, i) =>
      Effect.map(pageImageUrl(template.id, page.image), (imageUrl) => ({
        assignmentId: assignment.id,
        pageNumber: i + 1,
        imageUrl,
      })),
    );
    yield* db.insert(schema.worksheetPages).values(pages);

    const drafts = template.problems.flatMap(flatten);
    const inserted = yield* db
      .insert(schema.problems)
      .values(
        drafts.map((draft, position) => ({
          assignmentId: assignment.id,
          position,
          label: draft.label,
          text: draft.text,
          answerKey: answerKey(draft.answer),
          diagramDescription: draft.diagramDescription,
          pageNumbers: [...draft.pages],
          gradingNotes: gradingNotes(draft),
        })),
      )
      .returning({ id: schema.problems.id, label: schema.problems.label });
    const idByLabel = new Map(inserted.map((row) => [row.label, row.id]));
    const withIds = yield* Effect.forEach(drafts, (draft) => {
      const problemId = idByLabel.get(draft.label);
      return problemId === undefined
        ? Effect.die(`problem ${draft.label} was not inserted`)
        : Effect.succeed({ draft, problemId });
    });

    yield* db
      .insert(schema.rubricLines)
      .values(
        withIds.flatMap(({ draft, problemId }) =>
          draftRubric(draft).map((line, position) => ({ problemId, position, ...line })),
        ),
      );

    const dependencies = drafts.flatMap((draft) =>
      draft.dependsOn.flatMap((earlier) => {
        const problemId = idByLabel.get(draft.label);
        const dependsOnProblemId = idByLabel.get(earlier);
        return problemId !== undefined && dependsOnProblemId !== undefined
          ? [{ problemId, dependsOnProblemId }]
          : [];
      }),
    );
    if (dependencies.length > 0) {
      yield* db.insert(schema.problemDependencies).values(dependencies);
    }
    return assignment.id;
  });

/** Creates an assignment from a template, or None if there is no such template. */
export const createFromTemplate = (templateId: string, owner: Owner) =>
  Effect.gen(function* () {
    const template = getTemplate(templateId);
    if (Option.isNone(template)) return Option.none<string>();
    const sql = yield* SqlClient;
    return Option.some(yield* sql.withTransaction(insertTemplate(template.value, owner)));
  });
