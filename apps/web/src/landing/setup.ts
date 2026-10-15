/**
 * The landing page's entry points into assignment setup (`src/setup/upload.ts`). No sign-in: the
 * draft is anonymous until launch.
 */
import { err, ok, type Result } from "../server/result";
import { type StartResult, startFromTemplate, startFromUpload } from "../setup/upload";

export type StartDraftError =
  | { readonly _tag: "Unsupported" }
  | { readonly _tag: "TooLarge" }
  | { readonly _tag: "TooMany" }
  | { readonly _tag: "MixedPdf" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "UploadFailed" };

const ERRORS = {
  unsupported: { _tag: "Unsupported" },
  "too-large": { _tag: "TooLarge" },
  "too-many": { _tag: "TooMany" },
  "mixed-pdf": { _tag: "MixedPdf" },
  unreadable: { _tag: "Unreadable" },
  "upload-failed": { _tag: "UploadFailed" },
} as const satisfies Record<string, StartDraftError>;

const toResult = (result: StartResult): Result<{ readonly draftId: string }, StartDraftError> =>
  result._tag === "Started" ? ok({ draftId: result.draftId }) : err(ERRORS[result.reason]);

/** Uploads one PDF or up to 10 page photos and starts an anonymous draft. */
export async function startDraftFromUpload(files: ReadonlyArray<File>) {
  return toResult(await startFromUpload(files));
}

/** Starts an anonymous draft from one of the templates in @goblins/templates. */
export async function startDraftFromTemplate(templateId: string) {
  return toResult(await startFromTemplate(templateId));
}
