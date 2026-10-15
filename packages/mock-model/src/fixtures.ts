/**
 * Fixture whiteboards and the outcome the mock gives each one.
 *
 * The images live in `fixtures/` (rendered from `fixtures/whiteboards.html`).
 * E2E tests and the class simulator submit these exact files; the mock
 * recognises them by the SHA-256 of their bytes. `test/fixtures.test.ts`
 * checks every hash against its file and prints the right one on mismatch.
 *
 * To add a fixture: add the PNG, add an entry here, run the tests.
 */
import type { Scripted } from "./script.ts";

export interface Fixture {
  /** File name under `packages/mock-model/fixtures/`. */
  readonly file: string;
  readonly sha256: string;
  readonly outcome: Scripted;
}

export const fixtures: ReadonlyArray<Fixture> = [
  {
    file: "correct.png",
    sha256: "a4433a3277d4d4824564d0e3ee466c59ad7967a3c6c8a801ef083b3adb70f600",
    outcome: { _tag: "Graded", score: 2, maxScore: 2, feedback: "Correct: x = 4." },
  },
  {
    file: "partial.png",
    sha256: "908b5d16db77f31a6d8bfa0fc17a080ab2f402bd2a3e0e2df60c41e0059631c7",
    outcome: {
      _tag: "Graded",
      score: 1,
      maxScore: 2,
      feedback: "Set up correctly, but 8 ÷ 2 is 4, not 6.",
    },
  },
  {
    file: "wrong.png",
    sha256: "b514735596c71dada93382d70c1ffa9562ea2dcee76b9981683607ec8d25c7c8",
    outcome: {
      _tag: "Graded",
      score: 0,
      maxScore: 2,
      feedback: "Subtract 3 from both sides: 2x = 8, not 14.",
    },
  },
  {
    file: "blank.png",
    sha256: "9d3734f059ea9ac10858fc23cefe5e7c7171d77344168e32cd39056dcce318ea",
    outcome: { _tag: "Graded", score: 0, maxScore: 2, feedback: "No work shown." },
  },
  {
    file: "illegible.png",
    sha256: "e878d1e4cb51e8fa9557c884de972e560ec3aafb893258315ee05d66a95eafae",
    outcome: { _tag: "NeedsTeacher", reason: "The final answer is illegible: it could be 4 or 1." },
  },
  {
    // A request error the grader does not retry, so the grade fails at once;
    // the teacher's retry then succeeds.
    file: "fails-once.png",
    sha256: "d79d2aa87b5fb4d68856052c403201ac0008ca68c6c5482af50c4440d6d55fe6",
    outcome: {
      _tag: "FailsFirst",
      failure: { _tag: "ProviderError", status: 400 },
      attempts: 1,
      afterwards: { _tag: "Graded", score: 2, maxScore: 2, feedback: "Correct: x = 4." },
    },
  },
  {
    // Times out on every attempt, so the grade fails after the grader's retries.
    file: "fails-always.png",
    sha256: "bea446695e1506a7a816303ea43222c6c670e799d113e96f22653d86e65bfd9e",
    outcome: { _tag: "FailsAlways", failure: { _tag: "Timeout" } },
  },
  {
    file: "malformed.png",
    sha256: "26a05e70a710bf83a77d8d2c5fd78a1db50c22c56cbe6af0c325516489841cff",
    outcome: { _tag: "Text", text: "I think the answer is x = 4." },
  },
];

export const fixtureByHash: ReadonlyMap<string, Fixture> = new Map(
  fixtures.map((fixture) => [fixture.sha256, fixture]),
);
