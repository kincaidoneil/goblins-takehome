/**
 * Builds each template's worksheet.pdf and page PNGs from Illustrative Mathematics practice pages.
 *
 * For every templates/<id>/template.json it fetches the listed practice pages from
 * im.kendallhunt.com, copies the chosen problems verbatim (text and diagrams), lays them out as a
 * printable worksheet, prints it with Chromium, and rasterizes each page with pdftoppm. Then it
 * checks that every problem lands on the pages the answer key says it does, exiting with status 1
 * if not.
 *
 * Downloaded pages are parsed with JavaScript off and their scripts are dropped; the only script on
 * the printed page is MathJax from this package's node_modules.
 *
 * Needs: Playwright's Chromium (`pnpm exec playwright install chromium`) and poppler
 * (`brew install poppler`). Run: `pnpm --filter @goblins/templates build:worksheets [id...]`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { type Browser, chromium } from "playwright";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const templatesDir = join(packageDir, "templates");
const cacheDir = join(tmpdir(), "goblins-templates-downloads");
const mathjax = join(packageDir, "node_modules/mathjax/es5/tex-svg.js");

// The parts of template.json the build reads. The full schema lives in src/schema.ts.
const BuildSpec = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  course: Schema.String,
  topic: Schema.String,
  source: Schema.Struct({ attribution: Schema.String }),
  files: Schema.Struct({
    pages: Schema.Array(
      Schema.Struct({ image: Schema.String, width: Schema.Number, height: Schema.Number }),
    ),
  }),
  problems: Schema.NonEmptyArray(
    Schema.Struct({
      number: Schema.Number,
      pages: Schema.Array(Schema.Number),
      source: Schema.Struct({ url: Schema.String, problem: Schema.Number }),
    }),
  ),
});
type BuildSpec = typeof BuildSpec.Type;

/** Fetches a practice page once, each into its own folder under the OS temp directory. */
async function fetchPage(url: string): Promise<string> {
  const folder = join(cacheDir, new URL(url).pathname.replaceAll("/", "_"));
  const file = join(folder, "page.html");
  try {
    return readFileSync(file, "utf8");
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const html = await response.text();
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, html);
    return html;
  }
}

/** Returns the inner HTML of one numbered problem on an IM practice page, without scripts. */
async function extractProblem(browser: Browser, html: string, problem: number): Promise<string> {
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const body = await page.evaluate((n) => {
    const row = [...document.querySelectorAll(".im-c-row")].find(
      (r) => r.querySelector("h3")?.textContent?.trim() === `Problem ${n}`,
    );
    const content = row?.querySelector(".im-c-row__body .im-c-content");
    if (!content) return null;
    const copy = content.cloneNode(true);
    if (!(copy instanceof Element)) return null;
    copy
      .querySelectorAll("script, style, .embedded-modal-dialog, .c-figure__label")
      .forEach((e) => {
        e.remove();
      });
    return copy.innerHTML;
  }, problem);
  await page.close();
  if (body === null) throw new Error(`Problem ${problem} not found`);
  return body;
}

const css = `
  @page { size: letter; margin: 0.6in 0.7in 0.75in; }
  body { font: 11.5pt/1.45 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 18px; }
  header .line { display: flex; justify-content: space-between; gap: 24px; font-size: 11pt; }
  header .field { display: flex; flex: 1; }
  header .blank { flex: 1; border-bottom: 1px solid #111; margin-left: 6px; }
  header h1 { font-size: 18pt; margin: 14px 0 2px; }
  header .sub { color: #444; }
  .problem { position: relative; padding-left: 28px; break-inside: avoid; margin-bottom: 8px; }
  .problem.split { break-inside: auto; }
  .problem > .n { position: absolute; left: 0; top: 0; font-weight: 700; font-size: 12.5pt; }
  .problem .work { height: 0.75in; }
  .problem p { margin: 0 0 6px; }
  ol { list-style: lower-alpha; margin: 4px 0 6px; padding-left: 24px; }
  ol > li { margin-bottom: 0.45in; break-inside: avoid; }
  img { display: block; margin: 6px 0; width: auto; height: auto; min-width: 2.4in; max-width: 70%; max-height: 2in; object-fit: contain; object-position: left; }
  table { border-collapse: collapse; margin: 6px 0; }
  td, th { border: 1px solid #333; padding: 4px 10px; text-align: center; min-width: 40px; }
  .g--row { display: flex; gap: 16px; align-items: flex-start; }
  .g--column { flex: 1; }
  .pp-aligned-lesson-address { display: none; }
`;

function worksheetHtml(spec: BuildSpec, bodies: ReadonlyArray<string>): string {
  const problems = spec.problems
    .map(
      (p, i) =>
        `<section class="problem${p.pages.length > 1 ? " split" : ""}" data-n="${p.number}">` +
        `<div class="n">${p.number}.</div><div>${bodies[i]}<div class="work"></div></div></section>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<script>window.MathJax = {
  tex: { macros: { boldcdot: "\\\\mathbin{\\\\boldsymbol{\\\\cdot}}" } },
  svg: { fontCache: "global" },
  startup: {
    pageReady: () => MathJax.startup.defaultPageReady().then(() => { document.body.dataset.typeset = "done"; })
  }
};</script>
<script src="file://${mathjax}"></script></head><body>
<header>
  <div class="line"><span class="field" style="flex: 2">Name<span class="blank"></span></span><span class="field">Date<span class="blank"></span></span><span class="field" style="flex: 0.6">Period<span class="blank"></span></span></div>
  <h1>${spec.title}</h1>
  <div class="sub">${spec.course} · ${spec.topic}</div>
</header>
${problems}
</body></html>`;
}

/** The text of each PDF page, from pdftotext. */
function pageTexts(pdf: string, pages: number): ReadonlyArray<string> {
  return Array.from({ length: pages }, (_, i) =>
    execFileSync("pdftotext", ["-layout", "-f", `${i + 1}`, "-l", `${i + 1}`, pdf, "-"], {
      encoding: "utf8",
    }),
  );
}

async function build(browser: Browser, id: string): Promise<void> {
  const dir = join(templatesDir, id);
  const spec = Schema.decodeUnknownSync(BuildSpec)(
    JSON.parse(readFileSync(join(dir, "template.json"), "utf8")),
  );
  const bodies: Array<string> = [];
  for (const p of spec.problems) {
    bodies.push(await extractProblem(browser, await fetchPage(p.source.url), p.source.problem));
  }

  const htmlFile = join(cacheDir, `${id}.html`);
  writeFileSync(htmlFile, worksheetHtml(spec, bodies));
  const page = await browser.newPage();
  await page.goto(`file://${htmlFile}`, { waitUntil: "networkidle" });
  await page.waitForSelector("body[data-typeset=done]");
  const pdf = join(dir, "worksheet.pdf");
  await page.pdf({
    path: pdf,
    format: "letter",
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font: 7.5pt Helvetica, Arial, sans-serif; color: #555; width: 100%; padding: 0 0.7in; display: flex; justify-content: space-between; gap: 16px;"><span>${spec.source.attribution}</span><span style="white-space: nowrap">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  await page.close();

  for (const f of readdirSync(dir)) if (/^page-\d+\.png$/.test(f)) rmSync(join(dir, f));
  execFileSync("pdftoppm", ["-r", "150", "-png", pdf, join(dir, "page")]);
  // pdftoppm zero-pads page numbers when there are 10 or more pages; worksheets stay under 10.
  const images = readdirSync(dir)
    .filter((f) => /^page-\d+\.png$/.test(f))
    .sort();

  const actualImages = images.map((image) => ({ image, ...pngSize(join(dir, image)) }));
  if (JSON.stringify(actualImages) !== JSON.stringify(spec.files.pages)) {
    mismatch(`${id}: files.pages should be ${JSON.stringify(actualImages)}`);
  }

  // Each problem's number starts a line in the layout text; find which pages carry its content.
  const texts = pageTexts(pdf, images.length);
  for (const [i, p] of spec.problems.entries()) {
    const start = texts.findIndex((t) => new RegExp(`^\\s*${p.number}\\.\\s`, "m").test(t));
    const next = spec.problems[i + 1];
    const end = next
      ? texts.findIndex((t) => new RegExp(`^\\s*${next.number}\\.\\s`, "m").test(t))
      : images.length - 1;
    const pages = Array.from({ length: end - start + 1 }, (_, k) => start + k + 1);
    // A problem that starts a page shares no page with the one before it.
    const actual =
      next && end > start && startsPage(texts[end], next.number) ? pages.slice(0, -1) : pages;
    if (JSON.stringify(actual) !== JSON.stringify(p.pages)) {
      mismatch(`${id}: problem ${p.number} is on pages ${actual}, template.json says ${p.pages}`);
    }
  }
  console.log(`${id}: ${images.length} pages`);
}

/** Reports a difference between the rendered worksheet and its answer key, and fails the run. */
function mismatch(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

function startsPage(text: string | undefined, n: number): boolean {
  return new RegExp(`^\\s*${n}\\.\\s`).test(text ?? "");
}

const ids = process.argv.slice(2);
const browser = await chromium.launch();
for (const id of ids.length > 0 ? ids : readdirSync(templatesDir)) await build(browser, id);
await browser.close();
