# @goblins/templates

Four real math worksheets a teacher can pick instead of uploading their own. Each comes with the printed pages and a hand-checked answer key. The AI-quality stream uses the keys as ground truth for extraction and grading evals.

| Template | Course | Problems | What it exercises |
|---|---|---|---|
| `angle-relationships` | Grade 7 | 8 | Unknown angles read from diagrams |
| `solving-linear-equations` | Grade 8 | 8 | Plain skills practice: 13 equations and two find-the-mistake problems |
| `linear-relationships` | Grade 8 | 7 | Parts that use earlier answers (3b uses 3a, 5c uses 5b, 7b uses 7a); problem 3 runs from page 1 to page 2; graphs and a table |
| `right-triangle-trigonometry` | High school Geometry | 9 | Diagrams on almost every problem; problem 2 depends on problem 1 without saying so |

All problems come from Illustrative Mathematics practice pages under CC BY 4.0. See [Licensing](#licensing).

## Using it

```ts
import { templates, getTemplate, templateFileUrl } from "@goblins/templates";

for (const t of templates) console.log(t.title, t.problems.length);
const pdf = templateFileUrl(templates[0], "worksheet.pdf");
```

`templates` is decoded with the Effect Schema in [src/schema.ts](src/schema.ts). Each template folder holds:

- `worksheet.pdf`: the worksheet as a teacher would print it (US Letter).
- `page-N.png`: each page at 150 dpi (1275 × 1650).
- `template.json`: metadata and the answer key.

## The answer key

Each problem is either `Whole` (one answer) or `WithParts` (lettered parts a, b, c, each answered and graded on its own). Each answer item carries:

- `answer`: `Exact` (a canonical value plus equivalent forms to accept) or `Open` (a sample full-credit response and the criteria a grader checks).
- `solution`: a worked solution.
- `dependsOn`: earlier items whose answers this one uses, such as `["3a"]`. A correct method that uses the student's own wrong earlier answer earns follow-through credit.
- `review`: `Checked`, or `Unsure` with a note for Kincaid.

Each problem also records the pages it appears on (two pages when it runs across a page break), its source lesson and problem number, and a text description of each diagram detailed enough to solve the problem without the image. Problem text keeps the worksheet's wording, with math in LaTeX between `\(` and `\)`.

"Solve each" problems with several unlettered equations are one `Whole` problem whose answer lists every solution, because that is how the page prints them.

### Items marked Unsure

- `angle-relationships` 8: the diagram shows 138°, but IM's alt text for the image says 128°. The key follows the diagram.
- `solving-linear-equations` 7: Clare's work has two errors in one step. The key accepts either one; Kincaid may want both required.
- `linear-relationships` 5a: Tyler ran only about 0.02 miles farther, a difference read from a graph. A teacher may accept any reasoned estimate.
- `right-triangle-trigonometry` 2: we linked it to 1a (same triangle), so a wrong height from 1a earns method credit.

## Rebuilding the worksheets

The PDFs and PNGs are checked in. To regenerate them:

```bash
brew install poppler
```

```bash
pnpm --filter @goblins/templates exec playwright install chromium
```

```bash
pnpm --filter @goblins/templates build:worksheets
```

[scripts/build-worksheets.ts](scripts/build-worksheets.ts) fetches the practice pages listed in each `template.json` from im.kendallhunt.com, copies the chosen problems' HTML (text and diagram images, no scripts), lays them out with a header, answer space and attribution footer, prints with Chromium and rasterizes with pdftoppm. It then checks the rendered PDF against the answer key: every problem must sit on the pages the key lists, and `files.pages` must match the images. It prints a warning for any mismatch.

To add a template, create `templates/<id>/template.json` with its problems' sources, run the build, then write the key from the rendered pages and add the import to [src/index.ts](src/index.ts).

## Licensing

- IM 6–8 Math was originally developed by Open Up Resources and authored by Illustrative Mathematics, © 2017–2019 Open Up Resources, with adaptations © 2019 Illustrative Mathematics. IM 9–12 Math is © 2019 Illustrative Mathematics. Both are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- CC BY allows commercial reuse and adaptation with attribution. Each `template.json` carries the attribution line (also printed in every page footer), the lessons used, and what we changed.
- The Illustrative Mathematics name and logo are not under the Creative Commons license. We name IM only in attribution and never use the logo.
- The answer keys are our own work, not IM's teacher materials.
