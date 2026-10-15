/**
 * Translating between the chat model's view of a draft (problems keyed by label, as
 * `@goblins/grader`'s `Chat` uses) and the app's (problems keyed by id).
 */
import type { Chat } from "@goblins/grader";
import { Option } from "effect";
import type { Draft } from "./draft";
import type { Edit } from "./edits";

/**
 * The model sometimes repeats the points in a line's text ("1 pt: correct setup"). The points
 * column already shows them, so the prefix is dropped.
 */
const POINTS_PREFIX = /^\s*\d+\s*(?:pts?|points?)\s*[:.\-–—]\s*/i;

export const cleanRubric = <L extends { readonly points: number; readonly description: string }>(
  lines: readonly [L, ...ReadonlyArray<L>],
): readonly [L, ...Array<L>] => {
  const clean = (line: L): L => {
    const stripped = line.description.replace(POINTS_PREFIX, "");
    if (stripped === line.description || stripped === "") return line;
    return { ...line, description: `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}` };
  };
  const [first, ...rest] = lines;
  return [clean(first), ...rest.map(clean)];
};

/** The draft as the chat model sees it: problems keyed by label, links as labels. */
export const toSetupProblems = (draft: Draft): ReadonlyArray<Chat.SetupProblem> => {
  const labelOf = new Map(draft.problems.map((p) => [p.id, p.label]));
  return draft.problems.map((p) => ({
    label: p.label,
    pageNumbers: p.pageNumbers,
    text: p.text,
    diagramDescription: p.diagramDescription,
    answerKey: p.answerKey,
    gradingNotes: p.gradingNotes,
    rubric: p.rubric.map((line) => ({ points: line.points, description: line.description })),
    dependsOn: p.dependsOn.flatMap((id) => {
      const label = labelOf.get(id);
      return label === undefined ? [] : [label];
    }),
  }));
};

/**
 * Maps the model's label-based edits onto the app's id-based ones. A link to, or a placement after,
 * a problem added in the same reply has no id yet: the link is dropped and the new problem goes
 * after the last existing one it can find. Returns none if an edit names an unknown problem.
 */
export const toAppEdits = (
  draft: Draft,
  edits: ReadonlyArray<Chat.Edit>,
): Option.Option<ReadonlyArray<Edit>> => {
  const idOf = new Map(draft.problems.map((p) => [p.label, p.id]));
  const ids = (labels: ReadonlyArray<string>) =>
    labels.flatMap((label) => {
      const id = idOf.get(label);
      return id === undefined ? [] : [id];
    });
  const out: Array<Edit> = [];
  let lastPlaced: string | null = null;
  for (const edit of edits) {
    if (edit._tag === "AddProblem") {
      const [first, ...rest] = edit.problem.rubric;
      if (first === undefined) return Option.none();
      const after = edit.after === null ? null : (idOf.get(edit.after) ?? lastPlaced);
      out.push({
        _tag: "AddProblem",
        afterProblemId: after,
        problem: {
          label: edit.problem.label,
          text: edit.problem.text,
          answerKey: edit.problem.answerKey,
          diagramDescription: edit.problem.diagramDescription,
          pageNumbers: [...edit.problem.pageNumbers],
          gradingNotes: edit.problem.gradingNotes,
          rubric: cleanRubric([first, ...rest]),
        },
      });
      continue;
    }
    const problemId = idOf.get(edit.label);
    if (problemId === undefined) return Option.none();
    lastPlaced = problemId;
    switch (edit._tag) {
      case "SetRubric": {
        const [first, ...rest] = edit.rubric;
        if (first === undefined) return Option.none();
        out.push({ _tag: "SetRubric", problemId, lines: cleanRubric([first, ...rest]) });
        break;
      }
      case "SetGradingNotes":
        out.push({ _tag: "SetField", problemId, field: "gradingNotes", value: edit.gradingNotes });
        break;
      case "SetText":
        out.push({ _tag: "SetField", problemId, field: "text", value: edit.text });
        break;
      case "SetAnswerKey":
        out.push({ _tag: "SetField", problemId, field: "answerKey", value: edit.answerKey });
        break;
      case "SetDiagram":
        out.push({
          _tag: "SetField",
          problemId,
          field: "diagramDescription",
          value: edit.diagramDescription ?? "",
        });
        break;
      case "SetDependsOn":
        out.push({ _tag: "SetDependencies", problemId, dependsOn: ids(edit.dependsOn) });
        break;
      case "RemoveProblem":
        out.push({ _tag: "RemoveProblem", problemId });
        break;
    }
  }
  return Option.some(out);
};
