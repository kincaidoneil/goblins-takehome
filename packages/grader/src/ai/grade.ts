/**
 * Grading one submission: the problem, its rubric and the student's whiteboard in; points per
 * rubric line, what the grader read, a one-line reason and a needs-teacher flag out.
 *
 * One model call per submission, scoring every rubric line in that call. The evals compared
 * this with one call per line; see packages/evals/REPORT.md.
 */
import { Effect, Either, Schema } from "effect";
import {
  BadResponse,
  type CallTag,
  type ContentPart,
  type Message,
  ModelClient,
  type ModelError,
  type Usage,
} from "../ModelClient.ts";
import { stripFence } from "./json.ts";
import { type ModelChoice, models } from "./models.ts";

export interface RubricLine {
  readonly id: string;
  readonly points: number;
  /** Plain-language point line: "Correct setup: 11n + 3 = 80 or equivalent." */
  readonly text: string;
}

export interface GradeProblem {
  /** As printed on the worksheet: "4", "3b". */
  readonly label: string;
  readonly text: string;
  readonly diagramDescription?: string;
  /** Answer, accepted forms and a worked solution, as the teacher approved them. */
  readonly answerKey: string;
  /** Rubric-wide guidance: "Accept unsimplified fractions." */
  readonly gradingNotes: string;
  readonly rubric: ReadonlyArray<RubricLine>;
}

/** The student's own work on an earlier problem this one uses, for follow-through credit. */
export interface EarlierWork {
  readonly label: string;
  readonly text: string;
  readonly work:
    | { readonly _tag: "Whiteboard"; readonly url: string }
    /** No image to send, but the earlier grade recorded what the grader read. */
    | { readonly _tag: "Read"; readonly read: string }
    /** The student hasn't submitted the earlier problem. */
    | { readonly _tag: "Missing" };
}

export interface GradeRequest {
  readonly problem: GradeProblem;
  /** The student's whiteboard: an https URL or a `data:` URL. */
  readonly whiteboardUrl: string;
  readonly earlierWork: ReadonlyArray<EarlierWork>;
  /** Worksheet page images, only when the teacher marked the problem as needing them. */
  readonly pageImageUrls: ReadonlyArray<string>;
}

export interface LineScore {
  readonly lineId: string;
  readonly points: number;
  /** The work that earned or missed the line, in the grader's words. */
  readonly evidence: string;
}

export type Verdict =
  | { readonly _tag: "Sure" }
  | { readonly _tag: "NeedsTeacher"; readonly flagReason: string };

export interface GradeResult {
  /** What the grader read from the whiteboard, shown to the teacher. */
  readonly read: string;
  readonly lines: ReadonlyArray<LineScore>;
  /** One line for the teacher. */
  readonly reason: string;
  readonly verdict: Verdict;
  readonly usage: Usage;
  /** The model that answered. */
  readonly model: string;
}

export const gradeSystemPrompt = `You grade one student's handwritten work on one math problem, from an image of their whiteboard, using the teacher's rubric.

Work in this order:
1. read: transcribe what is written on the student's whiteboard image, line by line, exactly as written. Copy only marks you can see on that image, never text from the problem or answer key; if the board is empty or has no real attempt, read is what little is there, or "(no work)". Keep the student's mistakes. Mark crossed-out work as [crossed out]. Describe drawings briefly (labels, marked angles, plotted points). If a character could be read two ways, write both: "2(?)8 (2 or 3)".
2. unclearMarks: look again at every digit, sign, decimal point and symbol in the student's answers. If any is written over another, smudged, or could reasonably be read two ways, and the two readings would score differently, name it and both readings: "final answer: 28 or 38 (tens digit written over)". Otherwise "".
3. conflictingAnswers: if the student leaves two or more different answers to the same question and none is crossed out ("c = 138 or c = 48", two boxed answers), list them. Answers to different parts or different equations are not conflicting. Otherwise "".
4. lines: for each rubric line, in order, write the evidence (the work that earns or misses it), then award whole points from 0 to that line's maximum. Score your best reading.
5. reason: one sentence for the teacher, under 25 words, saying what was right and what was wrong.
6. needsTeacher: true when the student did something the rubric and grading notes don't decide, such as an unusual method, form or drawing, and false otherwise. Unclear marks and conflicting answers already go to the teacher, so they don't need it. A wrong answer, a missing step, or messy but readable writing is not a reason. When true, say in flagReason what the teacher should check, in under 20 words. When false, flagReason is "".

Rules:
- The teacher's grading notes are rules. Apply them exactly, even when they are more generous than the rubric lines read on their own ("a correct answer with no work earns both points").
- Grade what the student wrote, not what they probably meant. Crossed-out work earns nothing.
- Accept equivalent forms (1/2 = 2/4 = 0.5) and correct methods that differ from the answer key, unless the rubric or notes say otherwise. Units are not required unless the rubric says so.
- Follow-through: when this problem uses an earlier answer, judge it against the student's own earlier answer, shown in their earlier whiteboard. A correct method applied to their wrong earlier value earns every point except a line that requires the exact key value.
- A whiteboard with no real attempt ("?", "idk", a stray mark) gets 0 on every line and needsTeacher false.`;

/**
 * The model sees rubric lines as L1, L2, ... in order, whatever their real ids (UUIDs in the
 * app), so it never has to copy an id it could mangle.
 */
const promptId = (index: number) => `L${index + 1}`;

/** The reply schema, with line ids limited to this rubric's so the model can't invent one. */
export const replyJsonSchema = (rubric: ReadonlyArray<RubricLine>) => ({
  type: "object",
  additionalProperties: false,
  required: [
    "read",
    "unclearMarks",
    "conflictingAnswers",
    "lines",
    "reason",
    "needsTeacher",
    "flagReason",
  ],
  properties: {
    read: { type: "string" },
    unclearMarks: { type: "string" },
    conflictingAnswers: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lineId", "evidence", "points"],
        properties: {
          lineId: { type: "string", enum: rubric.map((_, i) => promptId(i)) },
          evidence: { type: "string" },
          points: { type: "integer" },
        },
      },
    },
    reason: { type: "string" },
    needsTeacher: { type: "boolean" },
    flagReason: { type: "string" },
  },
});

const Reply = Schema.parseJson(
  Schema.Struct({
    read: Schema.String,
    unclearMarks: Schema.String,
    conflictingAnswers: Schema.String,
    lines: Schema.Array(
      Schema.Struct({ lineId: Schema.String, evidence: Schema.String, points: Schema.Int }),
    ),
    reason: Schema.String,
    needsTeacher: Schema.Boolean,
    flagReason: Schema.String,
  }),
);

const problemText = (problem: GradeProblem) =>
  [
    `Problem ${problem.label}: ${problem.text}`,
    ...(problem.diagramDescription === undefined
      ? []
      : [
          `Diagram (as described for you; the student sees the drawing): ${problem.diagramDescription}`,
        ]),
    `Answer key (the student never saw this): ${problem.answerKey}`,
    `Rubric (${problem.rubric.reduce((sum, l) => sum + l.points, 0)} points):`,
    ...problem.rubric.map(
      (l, i) =>
        `- ${promptId(i)} (up to ${l.points} ${l.points === 1 ? "point" : "points"}): ${l.text}`,
    ),
    ...(problem.gradingNotes.trim() === ""
      ? []
      : [`Teacher's grading notes (rules): ${problem.gradingNotes}`]),
  ].join("\n");

export const buildGradeMessages = (request: GradeRequest): ReadonlyArray<Message> => {
  const content: Array<ContentPart> = [{ type: "text", text: problemText(request.problem) }];
  for (const url of request.pageImageUrls) {
    content.push(
      { type: "text", text: "Worksheet page the problem is on:" },
      { type: "image", url },
    );
  }
  for (const earlier of request.earlierWork) {
    const intro = `This problem uses the student's answer to ${earlier.label}, which asked: ${earlier.text}`;
    switch (earlier.work._tag) {
      case "Whiteboard":
        content.push(
          { type: "text", text: `${intro}\nThe student's whiteboard for ${earlier.label}:` },
          { type: "image", url: earlier.work.url },
        );
        break;
      case "Read":
        content.push({
          type: "text",
          text: `${intro}\nWhat the student wrote for ${earlier.label}, as transcribed: ${earlier.work.read}`,
        });
        break;
      case "Missing":
        content.push({
          type: "text",
          text: `${intro}\nThe student has not answered ${earlier.label}, so judge this problem on its own.`,
        });
        break;
    }
  }
  content.push(
    { type: "text", text: `The student's whiteboard for ${request.problem.label}:` },
    { type: "image", url: request.whiteboardUrl },
  );
  return [
    { role: "system", content: gradeSystemPrompt },
    { role: "user", content },
  ];
};

/** Why a reply could not be used. Each is retried as a `BadResponse`. */
export type ReplyProblem =
  | { readonly _tag: "NotJson" }
  | { readonly _tag: "WrongLines"; readonly detail: string };

/** Decodes the model's reply and checks it scores every rubric line exactly once, within range. */
export const parseGradeReply = (
  text: string,
  rubric: ReadonlyArray<RubricLine>,
): Either.Either<Omit<GradeResult, "usage" | "model">, ReplyProblem> => {
  const decoded = Schema.decodeUnknownEither(Reply)(stripFence(text));
  if (Either.isLeft(decoded)) return Either.left({ _tag: "NotJson" });
  const reply = decoded.right;
  // Match a scored line to its prompt id, also when the model wraps it ("[L1] max 1" is L1).
  const ids = rubric.map((_, i) => promptId(i));
  const idOf = (raw: string) =>
    ids.find((id) => raw.trim() === id) ??
    ids.find((id) => new RegExp(`(^|[^A-Za-z0-9])${id}([^A-Za-z0-9]|$)`).test(raw)) ??
    raw.trim();
  const byId = new Map(reply.lines.map((l) => [idOf(l.lineId), l]));
  if (byId.size !== reply.lines.length) {
    return Either.left({ _tag: "WrongLines", detail: "a rubric line was scored twice" });
  }
  const lines: Array<LineScore> = [];
  for (const [index, line] of rubric.entries()) {
    const scored = byId.get(promptId(index));
    if (scored === undefined) {
      return Either.left({ _tag: "WrongLines", detail: `line ${line.id} was not scored` });
    }
    if (scored.points < 0 || scored.points > line.points) {
      return Either.left({
        _tag: "WrongLines",
        detail: `line ${line.id} got ${scored.points} of ${line.points}`,
      });
    }
    lines.push({ lineId: line.id, points: scored.points, evidence: scored.evidence });
  }
  if (byId.size !== rubric.length) {
    return Either.left({ _tag: "WrongLines", detail: "scored a line that is not in the rubric" });
  }
  // The flag is decided here from what the model reported, not left to one yes/no from it.
  const reasons = [
    ...(reply.unclearMarks.trim() === "" ? [] : [`Hard to read: ${reply.unclearMarks.trim()}`]),
    ...(reply.conflictingAnswers.trim() === ""
      ? []
      : [`More than one answer: ${reply.conflictingAnswers.trim()}`]),
    // A reason without the flag is still a doubt, and a doubt goes to the teacher.
    ...(reply.needsTeacher || reply.flagReason.trim() !== ""
      ? [
          reply.flagReason.trim() === ""
            ? "The rubric doesn't decide this work."
            : reply.flagReason.trim(),
        ]
      : []),
  ];
  return Either.right({
    read: reply.read,
    lines,
    reason: reply.reason,
    verdict:
      reasons.length === 0
        ? { _tag: "Sure" }
        : { _tag: "NeedsTeacher", flagReason: reasons.join(" ") },
  });
};

export const gradeSubmission = (
  request: GradeRequest,
  tag: CallTag,
  choice: ModelChoice = models.grade,
): Effect.Effect<GradeResult, ModelError, ModelClient> =>
  Effect.gen(function* () {
    const client = yield* ModelClient;
    const completion = yield* client.complete({
      model: choice.model,
      messages: buildGradeMessages(request),
      tag,
      temperature: 0,
      maxTokens: choice.maxTokens,
      jsonSchema: { name: "grade", schema: replyJsonSchema(request.problem.rubric) },
      ...(choice.reasoning === undefined ? {} : { reasoning: choice.reasoning }),
    });
    const parsed = parseGradeReply(completion.text, request.problem.rubric);
    if (Either.isLeft(parsed)) {
      const problem = parsed.left;
      return yield* new BadResponse({
        message:
          problem._tag === "NotJson"
            ? "Grade reply was not the expected JSON"
            : `Grade reply did not fit the rubric: ${problem.detail}`,
        usage: completion.usage,
      });
    }
    return { ...parsed.right, usage: completion.usage, model: completion.model };
  });
