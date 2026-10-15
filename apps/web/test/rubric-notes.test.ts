import { describe, expect, it } from "vitest";
import { notesAfterRubricChange, teacherNotes } from "../src/server/setup/rubric-notes";

describe("teacherNotes", () => {
  it("removes review asides but keeps the rule they sit in", () => {
    expect(
      teacherNotes("Naming either error earns L1 (Kincaid confirmed). Accept y ≈ −5.91."),
    ).toBe("Naming either error earns the first point line. Accept y ≈ −5.91.");
    expect(
      teacherNotes(
        "The difference is read from a graph, so accept any reasoned estimate (Kincaid confirmed): about 0.02 or 0.03 miles, or 2/85 mile.",
      ),
    ).toBe(
      "The difference is read from a graph, so accept any reasoned estimate: about 0.02 or 0.03 miles, or 2/85 mile.",
    );
    expect(
      teacherNotes(
        "Follow-through on 1a applies (the worksheet does not state the link; Kincaid confirmed it). Units are not required.",
      ),
    ).toBe("Follow-through on 1a applies. Units are not required.");
    expect(
      teacherNotes(
        "A wrong w carried correctly into 19 + x + w = 90 earns L2 and L3. The key follows the diagram (138°), not IM's alt text (128°); Kincaid confirmed this.",
      ),
    ).toBe(
      "A wrong w carried correctly into 19 + x + w = 90 earns the second and third point lines. The key follows the diagram (138°).",
    );
  });

  it("names point lines in words, not dataset ids", () => {
    expect(teacherNotes("L1 can be shown by writing x and x.")).toBe(
      "The first point line can be shown by writing x and x.",
    );
  });

  it("leaves plain guidance alone", () => {
    const notes = "Accept 106 with or without the degree sign. Units are not required.";
    expect(teacherNotes(notes)).toBe(notes);
  });
});

const line = (points: number, description: string) => ({ points, description });

describe("notesAfterRubricChange", () => {
  const notes =
    "Accept 106. A correct answer with no work earns both points. Stating it is a triple without the arithmetic earns nothing. A pair given only by measures earns the first point line.";

  it("drops statements about totals when the total changes, and keeps other rules", () => {
    expect(
      notesAfterRubricChange(
        notes,
        [line(1, "Setup."), line(1, "Answer.")],
        [line(1, "Setup."), line(2, "Answer.")],
      ),
    ).toBe(
      "Accept 106. Stating it is a triple without the arithmetic earns nothing. A pair given only by measures earns the first point line.",
    );
  });

  it("drops line references when lines are reworded, added or removed", () => {
    expect(
      notesAfterRubricChange(
        notes,
        [line(1, "Setup."), line(1, "Answer.")],
        [line(1, "Names a pair."), line(1, "Answer.")],
      ),
    ).toBe(
      "Accept 106. A correct answer with no work earns both points. Stating it is a triple without the arithmetic earns nothing.",
    );
  });

  it("leaves notes alone when nothing about scoring changes", () => {
    const same = [line(1, "Setup."), line(1, "Answer.")];
    expect(notesAfterRubricChange(notes, same, same)).toBe(notes);
  });
});
