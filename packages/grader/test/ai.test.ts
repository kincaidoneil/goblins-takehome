import { describe, expect, it } from "@effect/vitest";
import { Attempt, type GradingInput, SubmissionId } from "@goblins/domain";
import { Effect, Either, Layer, Option } from "effect";
import { applyEdits, parseChatReply, type SetupProblem } from "../src/ai/chat.ts";
import { parseExtractReply } from "../src/ai/extract.ts";
import { buildGradeMessages, mockRender, parseGradeReply } from "../src/ai/grade.ts";
import { grader, toGradeRequest } from "../src/ai/grader.ts";
import { cleanGroups } from "../src/ai/mistakes.ts";
import { ModelClient } from "../src/ModelClient.ts";

const rubric = [
  { id: "7f3c-uuid-a", points: 1, text: "Setup" },
  { id: "7f3c-uuid-b", points: 2, text: "Answer" },
];

const reply = (lines: ReadonlyArray<{ lineId: string; points: number }>, needsTeacher = false) =>
  JSON.stringify({
    read: "x = 7",
    unclearMarks: "",
    conflictingAnswers: "",
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

  it("flags conflicting answers even when the model says it is sure", () => {
    const text = JSON.stringify({
      ...JSON.parse(
        reply([
          { lineId: "L1", points: 1 },
          { lineId: "L2", points: 2 },
        ]),
      ),
      conflictingAnswers: "c = 138 or c = 48",
    });
    expect(Either.getOrThrow(parseGradeReply(text, rubric)).verdict).toEqual({
      _tag: "NeedsTeacher",
      flagReason: "More than one answer: c = 138 or c = 48",
    });
  });

  it("treats a flag reason without the flag as a flag", () => {
    const text = JSON.stringify({
      ...JSON.parse(
        reply([
          { lineId: "L1", points: 1 },
          { lineId: "L2", points: 2 },
        ]),
      ),
      flagReason: "Might be a 1.",
    });
    expect(Either.getOrThrow(parseGradeReply(text, rubric)).verdict._tag).toBe("NeedsTeacher");
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

  it("rejects removing a problem others use unless the same edits update them", () => {
    expect(Either.isLeft(applyEdits(problems, [{ _tag: "RemoveProblem", label: "2a" }]))).toBe(
      true,
    );
    const fixed = applyEdits(problems, [
      { _tag: "RemoveProblem", label: "2a" },
      { _tag: "SetDependsOn", label: "2b", dependsOn: [] },
    ]);
    expect(Either.getOrThrow(fixed).map((p) => p.label)).toEqual(["1", "2b"]);
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

  it("turns blank diagrams into null and keeps links to earlier problems", () => {
    const text = JSON.stringify({
      status: "ok",
      message: "",
      problems: [extracted("1", []), extracted("2", ["1", "1"])],
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

  it("rejects links to missing or later problems, so the call is retried", () => {
    for (const problems of [
      [extracted("1", ["2"]), extracted("2", [])],
      [extracted("1", []), extracted("2", ["9"])],
    ]) {
      const text = JSON.stringify({ status: "ok", message: "", problems });
      expect(Either.isLeft(parseExtractReply(text))).toBe(true);
    }
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

  it.effect(
    "sends a grade that lost points to the teacher when the earlier problem is missing",
    () =>
      Effect.gen(function* () {
        const missing = {
          ...input,
          dependencies: [
            { label: "3a", text: "Cost?", whiteboardUrl: Option.none(), graderRead: Option.none() },
          ],
        };
        const out = yield* grader.grade(missing, { purpose: "grade" });
        expect(out._tag === "Unsure" && out.flagReason).toContain("before the student answered 3a");
      }).pipe(
        Effect.provide(
          replying(
            reply([
              { lineId: "L1", points: 0 },
              { lineId: "L2", points: 2 },
            ]),
          ),
        ),
      ),
  );

  it("sends an earlier problem's transcription when there is no earlier whiteboard", () => {
    const request = toGradeRequest(input);
    expect(request.earlierWork[0]?.work).toEqual({ _tag: "Read", read: "$1,500" });
  });
});

describe("Mistakes.cleanGroups", () => {
  it("doesn't let a blank group take a student from a real one", () => {
    const groups = [
      { mistake: "  ", studentIds: ["a"] },
      { mistake: "Subtracted wrong.", studentIds: ["a"] },
    ];
    expect(cleanGroups(groups, new Set(["a"]))).toEqual([
      { mistake: "Subtracted wrong.", studentIds: ["a"] },
    ]);
  });

  it("drops unknown and repeated students and empty groups, largest group first", () => {
    const groups = [
      { mistake: "Used 90 instead of 180.", studentIds: ["a", "ghost"] },
      { mistake: "Subtracted wrong.", studentIds: ["b", "c", "a"] },
      { mistake: "Nothing.", studentIds: ["ghost"] },
    ];
    expect(cleanGroups(groups, new Set(["a", "b", "c"]))).toEqual([
      { mistake: "Subtracted wrong.", studentIds: ["b", "c"] },
      { mistake: "Used 90 instead of 180.", studentIds: ["a"] },
    ]);
  });
});

describe("Grade.mockRender", () => {
  const request = {
    model: "mock",
    tag: { purpose: "grade" as const },
    messages: buildGradeMessages({
      problem: { label: "1", text: "Solve.", answerKey: "x = 7", gradingNotes: "", rubric },
      whiteboardUrl: "data:image/png;base64,THIS",
      earlierWork: [],
      pageImageUrls: [],
    }),
  };

  it("writes a reply the grader parses, with the score spread over the lines", () => {
    const text = mockRender({ _tag: "Graded", score: 2, maxScore: 3, feedback: "Close." }, request);
    const parsed = Either.getOrThrow(parseGradeReply(text, rubric));
    expect(parsed.lines.map((l) => l.points)).toEqual([1, 1]);
    expect(parsed.verdict._tag).toBe("Sure");
  });

  it("flags a NeedsTeacher answer with its reason", () => {
    const text = mockRender({ _tag: "NeedsTeacher", reason: "Can't read it." }, request);
    expect(Either.getOrThrow(parseGradeReply(text, rubric)).verdict).toEqual({
      _tag: "NeedsTeacher",
      flagReason: "Can't read it.",
    });
  });
});
