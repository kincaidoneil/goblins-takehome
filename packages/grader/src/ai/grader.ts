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
        return graded.verdict._tag === "Sure"
          ? { _tag: "Sure" as const, result }
          : { _tag: "Unsure" as const, result, flagReason: graded.verdict.flagReason };
      }),
    ),
};
