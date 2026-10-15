import { createFileRoute } from "@tanstack/react-router";
import { run } from "../../../server/runtime";
import { startTemplateDraft } from "../../../server/setup/start";
import { draftOwnerForRequest, saveDraftOwner } from "../../../server/setup/viewer";

/**
 * A plain link that starts a draft from a template and opens it, e.g. from the landing page or a
 * shared link. A server redirect, so it works before any JavaScript loads and runs once per click.
 */
export const Route = createFileRoute("/setup/template/$templateId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const owner = draftOwnerForRequest();
        const result = await run(
          startTemplateDraft(params.templateId, owner.id, new URL(request.url).origin),
        );
        if (result._tag === "Ok") saveDraftOwner(owner);
        const location = result._tag === "Ok" ? `/setup/${result.value.draftId}` : "/#templates";
        return new Response(null, { status: 303, headers: { location } });
      },
    },
  },
});
