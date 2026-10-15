/**
 * Checks a teacher's dropped files before anything is uploaded, so a wrong
 * file gets an answer in the browser instead of after a round trip.
 */

export const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/webp",
] as const;

/** For the file input's `accept` attribute. HEIC often arrives with no MIME type, so list extensions too. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_TYPES,
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".webp",
].join(",");

export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 10;

/** Why the landing page could not take the files. "unreadable" and "upload-failed" come from the server. */
export type UploadProblem =
  | "unsupported"
  | "too-large"
  | "too-many"
  | "mixed-pdf"
  | "unreadable"
  | "upload-failed";

export type FileCheck =
  | { readonly _tag: "Ok"; readonly files: ReadonlyArray<File> }
  | { readonly _tag: "Problem"; readonly problem: UploadProblem };

const EXTENSIONS = /\.(pdf|png|jpe?g|heic|heif|webp)$/i;

function isAccepted(file: File): boolean {
  const known: ReadonlyArray<string> = ACCEPTED_TYPES;
  return known.includes(file.type) || (file.type === "" && EXTENSIONS.test(file.name));
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** One PDF, or up to MAX_FILES photos of pages. */
export function checkFiles(files: ReadonlyArray<File>): FileCheck {
  if (files.length === 0 || !files.every(isAccepted))
    return { _tag: "Problem", problem: "unsupported" };
  if (files.some(isPdf) && files.length > 1) return { _tag: "Problem", problem: "mixed-pdf" };
  if (files.length > MAX_FILES) return { _tag: "Problem", problem: "too-many" };
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) return { _tag: "Problem", problem: "too-large" };
  return { _tag: "Ok", files };
}

/** What the setup flow's entry point returns. Agreed with the web app lead. */
export type UploadResult =
  | { readonly _tag: "Started"; readonly draftId: string }
  | { readonly _tag: "Rejected"; readonly reason: UploadProblem };
