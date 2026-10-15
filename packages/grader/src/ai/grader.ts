/**
 * The evaluated grader behind the pipeline's `Grader` seam: the domain's `GradingInput` in, the
 * domain's `ModelResult` out, as Sure or Unsure. The app provides this in place of
 * `Grader.placeholder`.
 */
import type { GradingInput } from "@goblins/domain";
import { Effect, Option } from "effect";
import type { Grader } from "../Grader.ts";
import { type GradeRequest, gradeSubmission } from "./grade.ts";

export const toGradeRequest = (input: GradingInput): GradeRequest => ({
  problem: {
    label: input.problem.label,
    text: input.problem.text,
    ...(input.problem.diagramDescription === null
      ? {}
      : { diagramDescription: input.problem.diagramDescription }),
    answerKey: input.problem.answerKey,
    gradingNotes: input.problem.gradingNotes,
    rubric: input.rubricLines.map((l) => ({ id: l.id, points: l.points, text: l.description })),
  },
  whiteboardUrl: input.whiteboardUrl,
  // The whiteboard is what the evals measured; the earlier grade's transcription is the fallback.
  earlierWork: input.dependencies.map((d) => ({
    label: d.label,
    text: d.text,
    work: Option.match(d.whiteboardUrl, {
      onSome: (url) => ({ _tag: "Whiteboard" as const, url }),
      onNone: () =>
        Option.match(d.graderRead, {
          onSome: (read) => ({ _tag: "Read" as const, read }),
          onNone: () => ({ _tag: "Missing" as const }),
        }),
    }),
  })),
  pageImageUrls: input.problem.pageImageUrls,
});

export const grader: Grader["Type"] = {
  grade: (input, tag) =>
    gradeSubmission(toGradeRequest(input), tag).pipe(
      Effect.map((graded) => {
        const result = {
          read: graded.read,
          linePoints: graded.lines.map((l) => ({ rubricLineId: l.lineId, points: l.points })),
          reason: graded.reason,
        };
        const reasons = [
          ...(graded.verdict._tag === "NeedsTeacher" ? [graded.verdict.flagReason] : []),
          ...missingFollowThrough(input, result.linePoints),
        ];
        return reasons.length === 0
          ? { _tag: "Sure" as const, result }
          : { _tag: "Unsure" as const, result, flagReason: reasons.join(" ") };
      }),
    ),
};

/**
 * A student can submit a dependent problem before the one it uses. Without that earlier work the
 * grader can't give follow-through credit, so a grade that lost points goes to the teacher
 * instead of standing as final.
 */
const missingFollowThrough = (
  input: GradingInput,
  linePoints: ReadonlyArray<{ readonly points: number }>,
): ReadonlyArray<string> => {
  const missing = input.dependencies.filter(
    (d) => Option.isNone(d.whiteboardUrl) && Option.isNone(d.graderRead),
  );
  const max = input.rubricLines.reduce((sum, l) => sum + l.points, 0);
  const got = linePoints.reduce((sum, l) => sum + l.points, 0);
  if (missing.length === 0 || got === max) return [];
  return [
    `Graded before the student answered ${missing.map((d) => d.label).join(" and ")}, so follow-through credit couldn't be checked.`,
  ];
};
