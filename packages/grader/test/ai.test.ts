import { describe, expect, it } from "@effect/vitest";
import { Attempt, type GradingInput, SubmissionId } from "@goblins/domain";
import { Effect, Either, Layer, Option } from "effect";
import { applyEdits, parseChatReply, type SetupProblem } from "../src/ai/chat.ts";
import { parseExtractReply } from "../src/ai/extract.ts";
import { buildGradeMessages, parseGradeReply } from "../src/ai/grade.ts";
import { grader, toGradeRequest } from "../src/ai/grader.ts";
import { ModelClient } from "../src/ModelClient.ts";

const rubric = [
  { id: "7f3c-uuid-a", points: 1, text: "Setup" },
  { id: "7f3c-uuid-b", points: 2, text: "Answer" },
];

const reply = (lines: ReadonlyArray<{ lineId: string; points: number }>, needsTeacher = false) =>
  JSON.stringify({
    read: "x = 7",
    lines: lines.map((l) => ({ ...l, evidence: "..." })),
    reason: "Right.",
    needsTeacher,
    flagReason: needsTeacher ? "Is it a 7 or a 1?" : "",
  });

describe("parseGradeReply", () => {
  it("maps prompt ids back to the rubric's own ids", () => {
    const parsed = parseGradeReply(
      reply([
        { lineId: "L1", points: 1 },
        { lineId: "L2", points: 2 },
      ]),
      rubric,
    );
    expect(Either.getOrThrow(parsed).lines.map((l) => [l.lineId, l.points])).toEqual([
      ["7f3c-uuid-a", 1],
      ["7f3c-uuid-b", 2],
    ]);
  });

  it("accepts an id the model wrapped in the rubric's formatting", () => {
    const parsed = parseGradeReply(
      reply([
        { lineId: "[L1] max 1", points: 0 },
        { lineId: "L2:", points: 0 },
      ]),
      rubric,
    );
    expect(Either.isRight(parsed)).toBe(true);
  });

  it("turns needsTeacher into a NeedsTeacher verdict with its reason", () => {
    const parsed = parseGradeReply(
      reply(
        [
          { lineId: "L1", points: 1 },
          { lineId: "L2", points: 2 },
        ],
        true,
      ),
      rubric,
    );
    expect(Either.getOrThrow(parsed).verdict).toEqual({
      _tag: "NeedsTeacher",
      flagReason: "Is it a 7 or a 1?",
    });
  });

  it("rejects missing, duplicate and out-of-range lines", () => {
    expect(Either.isLeft(parseGradeReply(reply([{ lineId: "L1", points: 1 }]), rubric))).toBe(true);
    expect(
      Either.isLeft(
        parseGradeReply(
          reply([
            { lineId: "L1", points: 1 },
            { lineId: "L1", points: 1 },
          ]),
          rubric,
        ),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        parseGradeReply(
          reply([
            { lineId: "L1", points: 1 },
            { lineId: "L2", points: 3 },
          ]),
          rubric,
        ),
      ),
    ).toBe(true);
  });

  it("accepts JSON wrapped in a Markdown fence", () => {
    const text = `\`\`\`json\n${reply([
      { lineId: "L1", points: 1 },
      { lineId: "L2", points: 2 },
    ])}\n\`\`\``;
    expect(Either.isRight(parseGradeReply(text, rubric))).toBe(true);
  });
});

describe("buildGradeMessages", () => {
  it("sends earlier work before the whiteboard being graded, and no real ids", () => {
    const messages = buildGradeMessages({
      problem: { label: "3b", text: "Plot it.", answerKey: "(20, 1500)", gradingNotes: "", rubric },
      whiteboardUrl: "data:image/png;base64,THIS",
      earlierWork: [
        {
          label: "3a",
          text: "Cost?",
          work: { _tag: "Whiteboard", url: "data:image/png;base64,EARLIER" },
        },
      ],
      pageImageUrls: [],
    });
    const user = messages[1];
    const parts = user?.role === "user" && typeof user.content !== "string" ? user.content : [];
    const images = parts.flatMap((p) => (p.type === "image" ? [p.url] : []));
    expect(images).toEqual(["data:image/png;base64,EARLIER", "data:image/png;base64,THIS"]);
    expect(JSON.stringify(messages)).not.toContain("uuid");
  });
});

const problem = (label: string, dependsOn: ReadonlyArray<string> = []): SetupProblem => ({
  label,
  pageNumbers: [1],
  text: `Problem ${label}`,
  diagramDescription: null,
  answerKey: "",
  gradingNotes: "",
  rubric: [{ points: 1, description: "Answer" }],
  dependsOn,
});

describe("applyEdits", () => {
  const problems = [problem("1"), problem("2a"), problem("2b", ["2a"])];

  it("inserts an added problem after the one named", () => {
    const after = applyEdits(problems, [
      { _tag: "AddProblem", after: "1", problem: problem("1b") },
    ]);
    expect(Either.getOrThrow(after).map((p) => p.label)).toEqual(["1", "1b", "2a", "2b"]);
  });

  it("drops links to a removed problem", () => {
    const after = applyEdits(problems, [{ _tag: "RemoveProblem", label: "2a" }]);
    expect(Either.getOrThrow(after).find((p) => p.label === "2b")?.dependsOn).toEqual([]);
  });

  it("rejects unknown labels and links to later problems, changing nothing", () => {
    expect(Either.isLeft(applyEdits(problems, [{ _tag: "RemoveProblem", label: "9" }]))).toBe(true);
    expect(
      Either.isLeft(
        applyEdits(problems, [{ _tag: "SetDependsOn", label: "1", dependsOn: ["2b"] }]),
      ),
    ).toBe(true);
  });
});

describe("parseChatReply", () => {
  it("rejects an edit missing a field its op needs", () => {
    const edit = {
      op: "set_rubric",
      label: "1",
      after: null,
      text: null,
      answerKey: null,
      diagramDescription: null,
      gradingNotes: null,
      rubric: null,
      dependsOn: null,
      problem: null,
    };
    expect(Either.isLeft(parseChatReply(JSON.stringify({ edits: [edit], reply: "Done." })))).toBe(
      true,
    );
  });
});

describe("parseExtractReply", () => {
  const extracted = (label: string, dependsOn: ReadonlyArray<string>) => ({
    label,
    pages: [1],
    text: "Solve.",
    diagramDescription: "  ",
    answerKey: "x = 1",
    rubric: [{ points: 1, text: "1 pt: x = 1" }],
    gradingNotes: "",
    dependsOn,
  });

  it("drops links to missing or later problems and blank diagrams", () => {
    const text = JSON.stringify({
      status: "ok",
      message: "",
      problems: [extracted("1", ["2"]), extracted("2", ["1", "9"])],
    });
    const result = Either.getOrThrow(parseExtractReply(text));
    expect(
      result._tag === "Worksheet" &&
        result.problems.map((p) => [p.dependsOn, p.diagramDescription]),
    ).toEqual([
      [[], null],
      [["1"], null],
    ]);
  });

  it("reports a non-math worksheet instead of problems", () => {
    const text = JSON.stringify({
      status: "not_math",
      message: "This is a history quiz.",
      problems: [],
    });
    expect(Either.getOrThrow(parseExtractReply(text))).toEqual({
      _tag: "NotMath",
      message: "This is a history quiz.",
    });
  });
});

describe("AiGrader.grader", () => {
  const input: GradingInput = {
    lease: {
      submissionId: SubmissionId.make("6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d"),
      attempt: Attempt.make(1),
      claimId: "claim",
    },
    loadTestRunId: Option.none(),
    whiteboardUrl: "data:image/png;base64,THIS",
    problem: {
      label: "3b",
      text: "Plot it.",
      answerKey: "(20, 1500)",
      diagramDescription: null,
      gradingNotes: "",
      pageImageUrls: [],
    },
    rubricLines: rubric.map((l) => ({ id: l.id, points: l.points, description: l.text })),
    dependencies: [
      {
        label: "3a",
        text: "Cost?",
        whiteboardUrl: Option.none(),
        graderRead: Option.some("$1,500"),
      },
    ],
  };

  const replying = (text: string) =>
    Layer.succeed(ModelClient, {
      complete: (request) =>
        Effect.succeed({
          id: "gen",
          model: request.model,
          text,
          usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 },
        }),
    });

  it.effect("returns the domain's ModelResult keyed by rubric line id", () =>
    Effect.gen(function* () {
      const out = yield* grader.grade(input, { purpose: "grade" });
      expect(out).toEqual({
        _tag: "Unsure",
        result: {
          read: "x = 7",
          linePoints: [
            { rubricLineId: "7f3c-uuid-a", points: 1 },
            { rubricLineId: "7f3c-uuid-b", points: 2 },
          ],
          reason: "Right.",
        },
        flagReason: "Is it a 7 or a 1?",
      });
    }).pipe(
      Effect.provide(
        replying(
          reply(
            [
              { lineId: "L1", points: 1 },
              { lineId: "L2", points: 2 },
            ],
            true,
          ),
        ),
      ),
    ),
  );

  it("sends an earlier problem's transcription when there is no earlier whiteboard", () => {
    const request = toGradeRequest(input);
    expect(request.earlierWork[0]?.work).toEqual({ _tag: "Read", read: "$1,500" });
  });
});
