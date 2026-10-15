/**
 * Pre-drawn whiteboards the simulated students submit, with the grade each one should get.
 *
 * They are the mock model's fixtures: the mock recognizes each file by the SHA-256 of its bytes,
 * so every grade in a simulation is predictable and the simulator can check that the dashboard
 * shows the grade the mock gave. The eval dataset's simulator subset will be added here when it
 * lands (see README).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixtures } from "@goblins/mock-model";

/** The dashboard state a whiteboard should end in when the model call succeeds. */
export type ExpectedState = "graded" | "needs_teacher";

export interface Whiteboard {
  readonly name: string;
  readonly png: Uint8Array;
  readonly expected: ExpectedState;
  /** For a graded fixture, the share of the problem's points it should get (2/2 → 1, 1/2 → 0.5). */
  readonly expectedFraction: number | null;
  /** How often a simulated student draws this one. */
  readonly weight: number;
}

/**
 * The mix a class produces. Only fixtures whose grade does not depend on failures: a fixture
 * scripted to fail would count against the load test's failure criterion by design.
 */
const MIX: ReadonlyArray<{ file: string; weight: number }> = [
  { file: "correct.png", weight: 50 },
  { file: "partial.png", weight: 20 },
  { file: "wrong.png", weight: 15 },
  { file: "blank.png", weight: 5 },
  { file: "illegible.png", weight: 10 },
];

const fixturesDir = new URL("../fixtures/", import.meta.resolve("@goblins/mock-model"));

export const loadWhiteboards = (): readonly [Whiteboard, ...Array<Whiteboard>] => {
  const loaded = MIX.map(({ file, weight }): Whiteboard => {
    const fixture = fixtures.find((f) => f.file === file);
    if (fixture === undefined) throw new Error(`mock-model has no fixture ${file}`);
    const outcome = fixture.outcome;
    const expected: ExpectedState = outcome._tag === "NeedsTeacher" ? "needs_teacher" : "graded";
    const expectedFraction =
      outcome._tag === "Graded" && outcome.maxScore > 0 ? outcome.score / outcome.maxScore : null;
    return {
      name: file,
      expectedFraction,
      png: new Uint8Array(readFileSync(fileURLToPath(new URL(file, fixturesDir)))),
      expected,
      weight,
    };
  });
  const [first, ...rest] = loaded;
  if (first === undefined) throw new Error("no whiteboards");
  return [first, ...rest];
};
