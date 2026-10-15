import { describe, expect, it } from "vitest";
import { changesScoring, dropPointSentences, teacherNotes } from "../src/server/setup/rubric-notes";

describe("teacherNotes", () => {
  it("drops review remarks", () => {
    expect(
      teacherNotes(
        "Follow-through inside the problem: a wrong w carried correctly into 19 + x + w = 90 earns L2 and L3. The key follows the diagram (138°), not IM's alt text (128°); Kincaid confirmed this.",
      ),
    ).toBe(
      "Follow-through inside the problem: a wrong w carried correctly into 19 + x + w = 90 earns the second and third point lines.",
    );
    expect(
      teacherNotes("Naming either error earns L1 (Kincaid confirmed). Accept y ≈ −5.91."),
    ).toBe("Accept y ≈ −5.91.");
  });

  it("names point lines in words, not dataset ids", () => {
    expect(teacherNotes("L1 can be shown by writing x and x.")).toBe(
      "The first point line can be shown by writing x and x.",
    );
    expect(teacherNotes("Accept −12/9. An unsimplified −12/9 earns L2.")).toBe(
      "Accept −12/9. An unsimplified −12/9 earns the second point line.",
    );
  });

  it("leaves plain guidance alone", () => {
    const notes = "Accept 106 with or without the degree sign. Units are not required.";
    expect(teacherNotes(notes)).toBe(notes);
  });
});

describe("dropPointSentences", () => {
  it("drops sentences about specific points and keeps the rest", () => {
    expect(
      dropPointSentences(
        "Accept 106 with or without the degree sign. A correct answer with no work earns both points: the problem does not ask for reasoning. Accept unsimplified fractions.",
      ),
    ).toBe("Accept 106 with or without the degree sign. Accept unsimplified fractions.");
    expect(dropPointSentences("A pair given only by measures earns the first point line.")).toBe(
      "",
    );
  });
});

describe("changesScoring", () => {
  it("is true when points or the number of lines change", () => {
    expect(changesScoring([{ points: 1 }, { points: 1 }], [{ points: 1 }, { points: 2 }])).toBe(
      true,
    );
    expect(changesScoring([{ points: 1 }], [{ points: 1 }, { points: 1 }])).toBe(true);
    expect(changesScoring([{ points: 1 }, { points: 1 }], [{ points: 1 }, { points: 1 }])).toBe(
      false,
    );
  });
});
