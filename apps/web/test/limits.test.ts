import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Edit } from "../src/server/setup/edits";
import { callerKeys } from "../src/server/setup/limits";

const decode = Schema.decodeUnknownEither(Edit);
const id = "00000000-0000-4000-8000-000000000001";
const problem = (text: string) => ({
  label: "9",
  text,
  answerKey: "x",
  diagramDescription: null,
  pageNumbers: [1],
  gradingNotes: "",
  rubric: [{ points: 1, description: "Correct answer." }],
});

describe("edit limits", () => {
  it("accepts a normal added problem and rejects an oversized one", () => {
    expect(
      Either.isRight(
        decode({ _tag: "AddProblem", afterProblemId: null, problem: problem("Solve 2x = 6.") }),
      ),
    ).toBe(true);
    expect(
      Either.isRight(
        decode({ _tag: "AddProblem", afterProblemId: null, problem: problem("x".repeat(2001)) }),
      ),
    ).toBe(false);
  });

  it("caps field edits and rubric size", () => {
    expect(
      Either.isRight(
        decode({ _tag: "SetField", problemId: id, field: "text", value: "x".repeat(4001) }),
      ),
    ).toBe(false);
    const lines = Array.from({ length: 13 }, () => ({ points: 1, description: "A point." }));
    expect(Either.isRight(decode({ _tag: "SetRubric", problemId: id, lines }))).toBe(false);
    expect(
      Either.isRight(
        decode({ _tag: "SetRubric", problemId: id, lines: [{ points: 500, description: "A." }] }),
      ),
    ).toBe(false);
  });
});

describe("callerKeys", () => {
  it("limits by IP and by owner, or by owner alone when the IP is unknown", () => {
    expect(callerKeys("1.2.3.4", "o")).toEqual(["ip:1.2.3.4", "owner:o"]);
    expect(callerKeys(undefined, "o")).toEqual(["owner:o"]);
  });
});
