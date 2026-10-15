/**
 * The landing page's entry points into setup. Uploads become page images in the browser first:
 * a PDF is rendered page by page, and photos are scaled down. The model reads images either way,
 * and smaller JPEGs keep the request under Vercel's body limit.
 */
import { startDraftFromTemplate, startDraftFromUpload } from "../server/setup/fns";

export type UploadProblem =
  | "unsupported"
  | "too-large"
  | "too-many"
  | "mixed-pdf"
  | "unreadable"
  | "upload-failed";

export type StartResult =
  | { readonly _tag: "Started"; readonly draftId: string }
  | { readonly _tag: "Rejected"; readonly reason: UploadProblem };

/** Long edge of a page image. Enough for handwriting-size print at about 150 dpi. */
const LONG_EDGE = 1650;
const MAX_PAGES = 10;
const QUALITY = 0.82;

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));

const drawScaled = (source: CanvasImageSource, width: number, height: number) => {
  const scale = Math.min(1, LONG_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

type Pages =
  | { readonly _tag: "Pages"; readonly pages: ReadonlyArray<Blob> }
  | { readonly _tag: "Problem"; readonly problem: UploadProblem };

const renderPdf = async (file: File): Promise<Pages> => {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise.catch(() => null);
  if (pdf === null) return { _tag: "Problem", problem: "unreadable" };
  if (pdf.numPages > MAX_PAGES) return { _tag: "Problem", problem: "too-many" };
  const pages: Array<Blob> = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: LONG_EDGE / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    const blob = await toJpeg(canvas);
    if (blob === null) return { _tag: "Problem", problem: "unreadable" };
    pages.push(blob);
  }
  return { _tag: "Pages", pages };
};

const scalePhoto = async (file: File): Promise<Blob | null> => {
  // Browsers other than Safari can't decode HEIC; that comes back as unreadable.
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap === null) return null;
  const canvas = drawScaled(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return canvas === null ? null : toJpeg(canvas);
};

const toPages = async (files: ReadonlyArray<File>): Promise<Pages> => {
  const [first] = files;
  if (first !== undefined && files.length === 1 && isPdf(first)) return renderPdf(first);
  if (files.some(isPdf)) return { _tag: "Problem", problem: "mixed-pdf" };
  if (files.length > MAX_PAGES) return { _tag: "Problem", problem: "too-many" };
  const pages: Array<Blob> = [];
  for (const file of files) {
    const page = await scalePhoto(file);
    if (page === null) return { _tag: "Problem", problem: "unreadable" };
    pages.push(page);
  }
  return { _tag: "Pages", pages };
};

export async function startFromUpload(files: ReadonlyArray<File>): Promise<StartResult> {
  const pages = await toPages(files);
  if (pages._tag === "Problem") return { _tag: "Rejected", reason: pages.problem };
  const form = new FormData();
  for (const [index, page] of pages.pages.entries()) {
    form.append("page", page, `page-${index + 1}.jpg`);
  }
  const result = await startDraftFromUpload({ data: form }).catch(() => null);
  if (result === null) return { _tag: "Rejected", reason: "upload-failed" };
  return result._tag === "Ok" ? result.value : result.error;
}

export async function startFromTemplate(templateId: string): Promise<StartResult> {
  const result = await startDraftFromTemplate({ data: { templateId } }).catch(() => null);
  if (result === null || result._tag !== "Ok") return { _tag: "Rejected", reason: "upload-failed" };
  return result.value;
}
