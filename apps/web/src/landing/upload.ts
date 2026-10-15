import type { UploadProblem, UploadResult } from "@goblins/ui/landing";
import type { Result } from "../server/result";

const PROBLEM: Record<string, UploadProblem> = {
  Unsupported: "unsupported",
  TooLarge: "too-large",
  TooMany: "too-many",
  MixedPdf: "mixed-pdf",
  Unreadable: "unreadable",
  UploadFailed: "upload-failed",
};

/** Maps a setup entry point's result onto what the landing page shows. */
export function toUploadResult(
  result: Result<{ readonly draftId: string }, { readonly _tag: string }>,
): UploadResult {
  return result._tag === "Ok"
    ? { _tag: "Started", draftId: result.value.draftId }
    : { _tag: "Rejected", reason: PROBLEM[result.error._tag] ?? "upload-failed" };
}
