# Writing grading cases

How to add student submissions to `grading/cases/<template-id>.json`. Read [README.md](README.md) first for what the dataset is for.

A case is one student's whiteboard for one gradable item (a whole problem such as `4`, or a part such as `3b`), plus the points a careful teacher would give for each line of the item's reference rubric in `grading/rubrics/<template-id>.json`.

## Steps

1. Read the item in `packages/templates/templates/<template-id>/template.json` (text, diagram description, answer key, worked solution, `dependsOn`) and its rubric.
2. Decide what the student did: correct, a specific mistake, a different method, and so on. Write the work first, then work out the points from the rubric, line by line. Recompute every number the student writes: a mistake must be the intended one and every step after it must follow from it.
3. Add the case to the JSON array.
4. Render and look at it: `pnpm --filter @goblins/evals dataset:render --template <template-id> <case-id> ...`, then open `grading/images/<case-id>.png`. Fix anything that overlaps, runs off the board, or reads differently from what you intended.
5. Run `pnpm --filter @goblins/evals dataset:check --template <template-id>` until it reports no problems.

## Fields

```jsonc
{
  "id": "lr-3b-follow-through",      // <prefix>-<item>-<slug>; prefixes: ar, sle, lr, rt
  "itemId": "3b",
  "tags": ["follow-through", "diagram"],
  "summary": "One sentence: what the student did.",
  "style": { "font": "kalam", "ink": "blue", "size": 40, "mess": 1, "pen": 3 },
  "board": [ /* elements, below */ ],
  "earlier": [{ "itemId": "3a", "caseId": "lr-3a-forgot-flat-rate" }],
  "expected": {
    "lines": [{ "id": "L1", "points": 1 }, { "id": "L2", "points": 1 }, { "id": "L3", "points": 1 }],
    "flag": "ShouldNotFlag",
    "reason": "Plots and labels its own part-a points (20, 1000) and (50, 2500); follow-through earns every line."
  },
  "review": { "_tag": "Checked" }
}
```

- `tags`: any of `correct`, `partial`, `incorrect`, `common-mistake`, `follow-through`, `alternate-method`, `answer-only`, `messy`, `crossed-out`, `blank`, `near-blank`, `diagram`, `off-rubric`.
- `style`: every field is optional; anything left out is picked from the id. Fonts: `caveat`, `patrick-hand`, `indie-flower`, `shadows-into-light`, `gochi-hand`, `kalam`, `nanum-pen-script`, `reenie-beanie`. Inks: `black`, `blue`, `purple` (the whiteboard's three pens). `size` is letter height in pixels (default 40; use 30 to 50). `mess` is 0 (neat) to 3 (hard to read). `pen` is the drawing stroke width (default 4, the whiteboard pen).
- `earlier`: required, and only allowed, for items with `dependsOn`. Point it at another case in the same file for the earlier item: the student's own earlier whiteboard, which the grader also sees. Every dependent case needs one, including correct ones. A follow-through case points at an earlier case with the wrong answer it carries forward.
- `expected.lines`: one entry per rubric line, in order, with the points earned (0 up to the line's maximum).
- `expected.flag`: whether a careful grader should mark the grade as needing the teacher.
  - `ShouldNotFlag`: the work is readable and the rubric clearly decides every line. Blank work is this too: it clearly earns 0.
  - `Either`: readable but sloppy, or a small judgment call a teacher would accept either way.
  - `ShouldFlag`: a part that decides points is unreadable, the student leaves two different final answers with neither crossed out, or the student does something the rubric does not cover.
- `expected.scoreOn`: optional. Set it to `"flag"` when the points hinge on a digit or sign that cannot be read for sure; the eval then scores only whether the grader flags the case. Leave it out otherwise (it defaults to `"points"`).
- `expected.reason`: one line a teacher would write, naming what earned or lost each point.
- `review`: `{ "_tag": "Checked" }` when the rubric decides every line without doubt. `{ "_tag": "Unsure", "note": "..." }` when a careful teacher could reasonably score it differently; the note says what the doubt is and which score you chose. Kincaid reviews every Unsure case.

## The board

The whiteboard is 1024 × 768 pixels, origin at the top left. Elements draw in order.

| Element | Fields | Notes |
|---|---|---|
| `Text` | `text`, optional `at` [x, y], `size`, `gap`, `indent`, `rotate` | Without `at`, the line goes below the previous line. `at` is the top-left of the line and moves the flow there, so later lines without `at` continue below it. |
| `Path` | `points` [[x, y], ...], optional `closed`, `dashed` | Segments, rays, triangles. |
| `Circle` | `center`, `r` | |
| `Arc` | `center`, `r`, `from`, `to` | Angle mark. Degrees counterclockwise from pointing right; screen y points down, so 90 is straight up. |
| `RightAngle` | `vertex`, `a`, `b`, optional `size` | Small square in the corner at `vertex` between the directions to `a` and `b`. |
| `Arrow` | `from`, `to` | |
| `Graph` | `at` (top-left of plot area), `size` [w, h], `x` and `y` axes `{ min, max, step, label }`, optional `grid`, `lines` (lists of data points), `points` `[{ at, label }]` | Data coordinates, mapped onto the plot area. Leave about 60 px left of and below the plot for tick labels. |
| `Scribble` | `at`, `size` | Work scribbled over until unreadable. |
| `Erased` | `text`, `at` | Faint marks left by the eraser. |
| `Ring` | `at`, `size` | A loop around something. |

Text markup: `x^2`, `x^{-1}`, `a_1`, `\frac{a}{b}` (stacked; write `\\frac` inside JSON), `\sqrt{48}` or `√48`, `~~crossed out~~`, `[[boxed answer]]`. These symbols are drawn as pen strokes: `≈ → ∠ × ÷ · π θ ≠ ≤ ≥ ° ⊥ △ ✓ ℓ`. Write minus as `-`.

Space: a line at size 40 is about 55 px tall and holds about 45 characters across the full width. Keep everything inside the board with a margin of about 30 px. A fraction line is taller, about 75 px. Put a diagram on the right half (x 560 to 990) when the work is on the left.

## What to cover

Write about five cases per item. Across a template, cover:

- **Correct work**, clean, for every item. At least one correct case with a different valid method or form where the item allows one (`alternate-method`), and some correct cases that are messy or have crossed-out first attempts.
- **Partial credit** that splits the rubric lines: the setup right and the arithmetic wrong, one of two answers right.
- **Common mistakes** a real student at that grade makes on that problem. Examples: using 90 instead of 180 for supplementary angles; distributing a negative to only the first term; dropping the flat fee; swapping rise and run; using cos instead of sin; reading the graph's axes backwards. Pick mistakes that fit the problem; avoid random wrong numbers.
- **Follow-through** for every dependent item: at least one case carrying a wrong earlier answer correctly (earns the method points) and one carrying it incorrectly.
- **Answer only**: a bare correct answer, where the rubric's notes decide (full credit on some items, none where the problem asks for work).
- **Blank and near-blank**: an empty board, a stray mark, a question mark, "idk", just copying the problem. About one per two items, across the template.
- **Messy handwriting**: about one in five cases at `mess` 2 or 3. A few at `mess` 3 where a deciding digit is genuinely ambiguous should be `ShouldFlag`.
- **Diagrams**: on geometry items, students often redraw and label the figure, mark angles, or draw the triangle they used.
- **Off-rubric**: a few cases the rubric does not clearly cover (a valid but unexpected method, an answer in a strange form), flagged and usually Unsure.

Make the work look like a student's: shorthand, missing units, inconsistent spacing, an occasional restated problem, scratch arithmetic in a corner, answers boxed or circled. Vary fonts, inks and sizes across cases; the same student style can repeat across a dependent pair.
