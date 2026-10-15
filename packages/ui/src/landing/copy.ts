import type { UploadProblem } from "./upload";

/** Shared with the setup screen, which shows "unreadable" after extraction. */
export const UPLOAD_PROBLEM_COPY: Record<UploadProblem, { title: string; body: string }> = {
  unsupported: {
    title: "We can't open that kind of file",
    body: "Try a PDF, or photos of the pages (JPG, PNG or HEIC).",
  },
  "too-large": {
    title: "That file is too big",
    body: "Keep it under 20 MB. A PDF export of the worksheet is usually much smaller than photos.",
  },
  "too-many": {
    title: "That's a lot of pages",
    body: "Up to 10 photos at a time. For a longer packet, upload just this week's pages.",
  },
  "mixed-pdf": {
    title: "One PDF at a time",
    body: "Drop a single PDF, or photos of the pages, but not both.",
  },
  "upload-failed": {
    title: "That didn't upload",
    body: "Check your connection and try again. Nothing was lost.",
  },
  unreadable: {
    title: "We couldn't read that worksheet",
    body: "The photo may be blurry or cut off. Try a straight-on photo in good light.",
  },
};
