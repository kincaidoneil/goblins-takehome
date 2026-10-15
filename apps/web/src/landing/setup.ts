/**
 * The landing page's entry points into assignment setup. These are stubs with
 * the agreed shape: they answer "not ready" until the setup stream replaces
 * them with server functions that create a draft and return its id.
 */
import { err, type Result } from "../server/result";

export type StartDraftError =
  | { readonly _tag: "Unsupported" }
  | { readonly _tag: "TooLarge" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "NotReady" };

/** Uploads one PDF or up to 10 page photos and starts an anonymous draft. No sign-in. */
export async function startDraftFromUpload(
  _files: ReadonlyArray<File>,
): Promise<Result<{ readonly draftId: string }, StartDraftError>> {
  return err({ _tag: "NotReady" } as const);
}

/** Starts an anonymous draft from one of the templates in @goblins/templates. */
export async function startDraftFromTemplate(
  _templateId: string,
): Promise<
  Result<
    { readonly draftId: string },
    { readonly _tag: "TemplateNotFound" } | { readonly _tag: "NotReady" }
  >
> {
  return err({ _tag: "NotReady" } as const);
}
