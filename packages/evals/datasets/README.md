# Grading eval dataset

Student whiteboards for every gradable item of the four templates in `packages/templates`, each with the points a careful teacher would give per line of a fixed rubric. The grading evals run the grader on these whiteboards and compare its points with ours; that comparison is the answer to "how accurate is the auto-grader with cheaper models?"

**230 cases** over all 41 gradable items (4 to 9 per item), plus 12 phone-layout copies.

| | Cases |
|---|---|
| By template | angles 48, equations 46, linear relationships 73, trigonometry 63 |
| By expected score | full credit 110, partial 62, zero 58 |
| By expected flag | should not flag 170, either 35, should flag 25 |
| By what the student did (a case can have several) | correct 97, common mistake 69, partial 66, diagram 54, messy handwriting 43, incorrect 35, alternate method 22, answer only 15, follow-through 13, crossed-out work 12, off-rubric 12, near-blank 11, blank 8 |
| Review | All 230 Checked; 33 of them were uncertain and settled with Kincaid ([REVIEW.md](REVIEW.md)); 11 are scored on the flag only |

## What is here

| Path | Contents |
|---|---|
| `grading/rubrics/<template>.json` | The reference rubric for each item: AP-style point lines and notes on what to accept. Written by hand from the answer key. |
| `grading/cases/<template>.json` | The cases: what the student wrote (as drawing instructions), tags, the expected points per rubric line, whether the grade should be flagged, and a review status. |
| `grading/images/<case>.png` | Each case rendered as a 1024 × 768 whiteboard PNG. Checked in, so evals need no rendering step. |
| `grading/phone/` | Twelve cases redrawn as a phone submits them (the "phone" slice): the work on a 3:4 portrait page, scaled into a 576 px column in the middle of the 1024 × 768 export. |
| `src/` | Schema, loader and checks (`@goblins/evals/datasets`), the renderer, and the simulator subset (`@goblins/evals/datasets/simulator`). |
| `scripts/` | `render` and `check`. |

```ts
import { loadGradingDataset } from "@goblins/evals/datasets";

const { cases } = loadGradingDataset();
for (const c of cases) {
  // c.image: PNG URL. c.rubric: lines L1..Ln. c.earlier: the student's whiteboards for items this
  // one depends on. c.expected.lines: correct points per line. c.expected.flag: should the grader
  // ask the teacher? c.slice: "generated" or "phone".
}
```

## How a case is graded here

The unit is one gradable item, matching the app: a whole problem (`4`) or one lettered part (`3b`), each on its own whiteboard. A dependent item (`3b` uses `3a`) carries `earlier`, the student's own whiteboard for the earlier item, because the grader receives that too and gives follow-through credit.

The rubric is fixed per item, so grading accuracy is measured apart from rubric drafting. The eval can still test rubric drafting separately by comparing a drafted rubric's totals against these.

Ground truth is the points per rubric line, built in three passes:

1. Agents wrote each case from the answer key and the rubric: the student's work first, with every number recomputed, then the points line by line.
2. The dataset stream reviewed every case against the rubric. Where the rubric left a call open, the rubric got a note (for example, what a bare answer earns) rather than the case getting a guess.
3. Separate agents regraded every case blind, from the image and rubric only, with opaque case ids and without our points. They agreed line by line on 223 of 230 cases. All seven disagreements were already marked Unsure.

The 33 cases where a careful teacher could reasonably score differently were marked `Unsure` and settled on 2026-10-15 ([REVIEW.md](REVIEW.md)). Eleven of them hinge on a digit that cannot be read for sure; they carry `expected.scoreOn: "flag"`, so the eval scores whether the grader asks the teacher, not its points. No score rests on one model's judgment alone, and none came from the grader under test.

`expected.flag` says whether a careful grader should ask the teacher: `ShouldFlag` (a deciding part is unreadable, two conflicting answers, or work the rubric does not cover), `ShouldNotFlag` (readable and clearly decided by the rubric, including blank work), or `Either`. The eval reports how often the grader flags and whether it flags the right ones.

## Whiteboards

The images are drawn by [src/render.ts](src/render.ts) with `@napi-rs/canvas`: eight open-licensed handwriting fonts (Fontsource, OFL) drawn glyph by glyph with jitter in position, rotation, size and spacing; slanted, drifting lines; pen strokes with wobble and overshoot for diagrams, fractions, roots and crossings-out; varied ink colors and stroke weight. A `mess` level from 0 to 3 per case controls how sloppy it gets. Randomness is seeded from the case id, so re-rendering gives the same image on the same machine. No image model is used and rendering costs nothing.

The format matches the student whiteboard export from `packages/ui`: 1024 × 768 PNG on white, in the whiteboard's three ink colors with its 4 px pen. The phone slice covers the portrait layout phones export.

Generated handwriting is cleaner and more uniform than a real student's, and the dataset has no real handwriting to measure that gap: the hand-drawn slice the PRD planned was dropped for lack of time. Accuracy on these whiteboards is therefore an upper bound for messy real work. Other known limits: graphs are drawn with straight lines and neat dots, an overwritten digit is two glyphs placed on top of each other, and one item's cases can share a layout.

## Commands

```bash
pnpm --filter @goblins/evals dataset:check
```

```bash
pnpm --filter @goblins/evals dataset:render
```

`dataset:check` validates every file and prints counts and the Unsure list. `dataset:render` re-renders all images, including the phone slice (or `--template <id>`, or case ids). Re-rendering on another OS can shift glyphs by a pixel, so the PNGs are checked in and CI does not compare them. `pnpm --filter @goblins/evals test` runs the same checks in CI.

To add cases, follow [AUTHORING.md](AUTHORING.md).

## For the class simulator

`simulatorWhiteboards(templateId)` from `@goblins/evals/datasets/simulator` returns, for each item, up to three Checked whiteboards with a spread of scores (full, partial, zero) and their expected points per line. A simulated student can submit these, and a mock model can look up the expected grade by case id.

