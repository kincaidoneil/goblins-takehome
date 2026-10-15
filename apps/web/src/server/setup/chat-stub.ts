/**
 * The chat panel's stand-in editor until the AI-quality stream's model-backed one lands: it
 * understands the requests the PRD names, phrased a few common ways, and turns them into edits.
 * It makes no model call, so E2E and local development cost nothing.
 */
import type { Draft, DraftProblem, DraftRubricLine } from "./draft";
import type { Edit } from "./edits";
import type { ChatReply } from "./setup-ai";

const PROBLEM = String.raw`(?:problem|question|number|#|no\.?)?\s*(\d{1,2}\s?[a-z]?)\b`;

const normalizeLabel = (raw: string) => raw.replace(/\s+/g, "").toLowerCase();

type Target =
  | { readonly _tag: "One"; readonly problem: DraftProblem }
  | { readonly _tag: "Parts"; readonly number: string; readonly parts: ReadonlyArray<DraftProblem> }
  | { readonly _tag: "Missing"; readonly label: string };

const findTarget = (draft: Draft, raw: string): Target => {
  const label = normalizeLabel(raw);
  const exact = draft.problems.find((problem) => problem.label.toLowerCase() === label);
  if (exact !== undefined) return { _tag: "One", problem: exact };
  const parts = draft.problems.filter((problem) =>
    new RegExp(`^${label}[a-z]$`).test(problem.label.toLowerCase()),
  );
  return parts.length > 0 ? { _tag: "Parts", number: label, parts } : { _tag: "Missing", label };
};

const partList = (parts: ReadonlyArray<DraftProblem>) => parts.map((part) => part.label).join(", ");

/**
 * Spreads `total` points over the lines in proportion to their current points, each line keeping at
 * least 1. Returns none when there are more lines than points.
 */
export const scaleRubric = (
  lines: ReadonlyArray<DraftRubricLine>,
  total: number,
): ReadonlyArray<{ points: number; description: string }> | undefined => {
  if (total < lines.length) return undefined;
  const current = lines.reduce((sum, line) => sum + line.points, 0);
  const spare = total - lines.length;
  const shares = lines.map((line) => (line.points / current) * spare);
  const points = shares.map((share) => 1 + Math.floor(share));
  let left = total - points.reduce((sum, p) => sum + p, 0);
  // Largest remainder first, ties to the later line (usually "correct answer").
  const order = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || b.index - a.index);
  for (const { index } of order) {
    if (left === 0) break;
    points[index] = (points[index] ?? 0) + 1;
    left--;
  }
  return lines.map((line, index) => ({
    points: points[index] ?? 1,
    description: line.description,
  }));
};

const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

const appendNote = (notes: string, note: string) =>
  notes.trim() === "" ? note : `${notes.trim()} ${note}`;

const sentence = (text: string) => {
  const trimmed = text.trim().replace(/[.!]+$/, "");
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
};

/** The label that sorts just before `label` among the draft's problems, for placing a new one. */
const insertAfter = (draft: Draft, label: string): DraftProblem | undefined => {
  const key = (l: string) => {
    const match = /^(\d+)([a-z]?)$/i.exec(l);
    return match === null
      ? Number.NaN
      : Number(match[1]) * 100 +
          (match[2] === "" ? 0 : (match[2]?.toLowerCase().charCodeAt(0) ?? 96) - 96);
  };
  const target = key(label);
  return [...draft.problems].reverse().find((problem) => key(problem.label) < target);
};

const HELP =
  "I can change how many points a problem is worth, add what to accept, add or remove a problem, and link parts that build on each other. For example: “make problem 3 worth 4 points” or “accept unsimplified fractions.”";

export const stubChat = (draft: Draft, message: string): ChatReply => {
  const text = message.trim();

  const worth = new RegExp(
    String.raw`(?:make|set|change)\s+${PROBLEM}\s+(?:worth|to|be worth|out of)\s+(\d{1,2})\s*(?:points?|pts?)?`,
    "i",
  ).exec(text);
  if (worth !== null) {
    const target = findTarget(draft, worth[1] ?? "");
    const total = Number(worth[2]);
    switch (target._tag) {
      case "Missing":
        return { reply: `I couldn't find problem ${target.label} on this worksheet.`, edits: [] };
      case "Parts":
        return {
          reply: `Problem ${target.number} has parts ${partList(target.parts)}, and each is scored on its own. Which part should be worth ${pts(total)}?`,
          edits: [],
        };
      case "One": {
        if (total < 1) return { reply: "A problem needs at least 1 point.", edits: [] };
        const lines = scaleRubric(target.problem.rubric, total);
        if (lines === undefined) {
          return {
            reply: `Problem ${target.problem.label} has ${target.problem.rubric.length} rubric lines, so it needs at least ${pts(target.problem.rubric.length)}. Remove a line first, or pick a bigger number.`,
            edits: [],
          };
        }
        const [first, ...rest] = lines;
        if (first === undefined) return { reply: HELP, edits: [] };
        return {
          reply: `Problem ${target.problem.label} is now worth ${pts(total)}: ${lines.map((line) => `${line.points} for “${line.description.replace(/\.$/, "")}”`).join(", ")}.`,
          edits: [{ _tag: "SetRubric", problemId: target.problem.id, lines: [first, ...rest] }],
        };
      }
    }
  }

  const accept =
    /^(?:please\s+)?(?:also\s+)?(?:accept|allow|give (?:full )?credit for)\s+(.+?)(?:\s+(?:on|for|in)\s+(?:problem|question|#)\s*(\d{1,2}\s?[a-z]?))?\.?$/i.exec(
      text,
    );
  if (accept !== null) {
    const what = accept[1] ?? "";
    const note = sentence(`Accept ${what}`);
    const scoped = accept[2];
    if (scoped !== undefined) {
      const target = findTarget(draft, scoped);
      const problems =
        target._tag === "One" ? [target.problem] : target._tag === "Parts" ? target.parts : [];
      if (problems.length === 0) {
        return {
          reply: `I couldn't find problem ${normalizeLabel(scoped)} on this worksheet.`,
          edits: [],
        };
      }
      return {
        reply: `Added to problem ${problems.map((p) => p.label).join(", ")}: “${note}”`,
        edits: problems.map((problem) => ({
          _tag: "SetField",
          problemId: problem.id,
          field: "gradingNotes",
          value: appendNote(problem.gradingNotes, note),
        })),
      };
    }
    return {
      reply: `Added to every problem's grading notes: “${note}”`,
      edits: draft.problems.map((problem) => ({
        _tag: "SetField",
        problemId: problem.id,
        field: "gradingNotes",
        value: appendNote(problem.gradingNotes, note),
      })),
    };
  }

  const missed = new RegExp(
    String.raw`(?:missed|skipped|forgot|left out|add|there'?s(?: also)?|is missing)\s+${PROBLEM}`,
    "i",
  ).exec(text);
  if (missed !== null) {
    const label = normalizeLabel(missed[1] ?? "");
    const target = findTarget(draft, label);
    if (target._tag === "One") {
      return {
        reply: `Problem ${label} is already here. If it's wrong, edit it in its card, or tell me what to change.`,
        edits: [],
      };
    }
    const after = insertAfter(draft, label);
    const edit: Edit = {
      _tag: "AddProblem",
      afterProblemId: after?.id ?? null,
      problem: {
        label,
        text: "",
        answerKey: "",
        diagramDescription: null,
        pageNumbers: after === undefined ? [] : [...after.pageNumbers],
        gradingNotes: "",
        rubric: [
          { points: 1, description: "Shows a correct method." },
          { points: 1, description: "Correct answer." },
        ],
      },
    };
    return {
      reply: `I added problem ${label}${after === undefined ? " at the start" : ` after ${after.label}`}. Type its text and answer key in the new card, and I'll grade it like the others.`,
      edits: [edit],
    };
  }

  const remove = new RegExp(
    String.raw`(?:remove|delete|drop|skip|take out)\s+${PROBLEM}`,
    "i",
  ).exec(text);
  if (remove !== null) {
    const target = findTarget(draft, remove[1] ?? "");
    switch (target._tag) {
      case "Missing":
        return { reply: `I couldn't find problem ${target.label} on this worksheet.`, edits: [] };
      case "Parts":
        return {
          reply: `Removed problem ${target.number} (parts ${partList(target.parts)}).`,
          edits: target.parts.map((part) => ({ _tag: "RemoveProblem", problemId: part.id })),
        };
      case "One":
        return {
          reply: `Removed problem ${target.problem.label}.`,
          edits: [{ _tag: "RemoveProblem", problemId: target.problem.id }],
        };
    }
  }

  const uses = new RegExp(
    String.raw`${PROBLEM}\s+(?:uses|depends on|builds on|needs)\s+(?:the answer (?:to|from)\s+)?${PROBLEM}`,
    "i",
  ).exec(text);
  if (uses !== null) {
    const later = findTarget(draft, uses[1] ?? "");
    const earlier = findTarget(draft, uses[2] ?? "");
    if (later._tag !== "One" || earlier._tag !== "One") {
      return { reply: "Name the exact parts, like “3b uses 3a.”", edits: [] };
    }
    const laterIndex = draft.problems.indexOf(later.problem);
    const earlierIndex = draft.problems.indexOf(earlier.problem);
    if (earlierIndex >= laterIndex) {
      return {
        reply: `Problem ${earlier.problem.label} comes after ${later.problem.label}, so ${later.problem.label} can't use its answer.`,
        edits: [],
      };
    }
    return {
      reply: `Linked: ${later.problem.label} uses the answer to ${earlier.problem.label}. A student who got ${earlier.problem.label} wrong still gets method credit on ${later.problem.label} for correct work built on their answer.`,
      edits: [
        {
          _tag: "SetDependencies",
          problemId: later.problem.id,
          dependsOn: [...new Set([...later.problem.dependsOn, earlier.problem.id])],
        },
      ],
    };
  }

  return { reply: HELP, edits: [] };
};
