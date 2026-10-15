/**
 * Adds Kincaid's hand-drawn copies of the HANDDRAW.md cases to the dataset as the "human" slice.
 *
 *   pnpm --filter @goblins/evals dataset:add-human ~/Desktop/handdrawn
 *
 * Name each photo or export by its number on the sheet (`1.jpg`, `h1.png`, `H10.heic`). Each is
 * scaled to at most 1600 px on its longer side, saved as PNG in grading/human/, and listed in
 * grading/human/manifest.json against the generated case it copies, so it gets that case's
 * rubric and expected points. Re-running replaces earlier copies.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Schema } from "effect";
import { gradingDir, HumanManifest } from "../src/index.ts";

const MAX_SIDE = 1600;

const HanddrawList = Schema.Array(Schema.Struct({ n: Schema.Int, caseId: Schema.String }));
const handdraw = Schema.decodeUnknownSync(HanddrawList)(
  JSON.parse(readFileSync(new URL("human/handdraw.json", gradingDir), "utf8")),
);

const dir = process.argv[2];
if (!dir) {
  console.error("usage: dataset:add-human <folder of photos>");
  process.exit(1);
}
if (!existsSync(dir)) {
  console.error(
    `No folder at ${dir}. Put the photos (1.jpg … 10.jpg) in a folder and pass its path.`,
  );
  process.exit(1);
}

const manifestUrl = new URL("human/manifest.json", gradingDir);
const manifest = new Map(
  Schema.decodeUnknownSync(HumanManifest)(JSON.parse(readFileSync(manifestUrl, "utf8"))).map(
    (e) => [e.caseId, e],
  ),
);

/** HEIC from an iPhone or iPad: convert with macOS `sips`, which canvas cannot decode. */
const readable = (path: string): string => {
  if (extname(path).toLowerCase() !== ".heic") return path;
  const out = join(mkdtempSync(join(tmpdir(), "handdrawn-")), "photo.jpg");
  execFileSync("sips", ["-s", "format", "jpeg", path, "--out", out], { stdio: "ignore" });
  return out;
};

let added = 0;
for (const file of readdirSync(dir)) {
  const match = /^h?(\d+)\.(jpe?g|png|heic)$/i.exec(file);
  const entry = match ? handdraw.find((h) => h.n === Number(match[1])) : undefined;
  if (!entry) {
    console.warn(`skipped ${file}: name it by its number on the sheet, like 3.jpg`);
    continue;
  }
  const image = await loadImage(readFileSync(readable(join(dir, file))));
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const name = `${entry.caseId}.png`;
  writeFileSync(new URL(`human/${name}`, gradingDir), canvas.toBuffer("image/png"));
  manifest.set(entry.caseId, { caseId: entry.caseId, image: name });
  console.log(`H${entry.n} ${file} -> human/${name}`);
  added++;
}

const sorted = [...manifest.values()].sort(
  (a, b) =>
    handdraw.findIndex((h) => h.caseId === a.caseId) -
    handdraw.findIndex((h) => h.caseId === b.caseId),
);
writeFileSync(manifestUrl, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(
  `added ${added} photos; ${manifest.size} of ${handdraw.length} hand-drawn cases are in`,
);
