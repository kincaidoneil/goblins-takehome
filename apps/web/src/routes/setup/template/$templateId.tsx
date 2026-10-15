import { createFileRoute } from "@tanstack/react-router";
import { run } from "../../../server/runtime";
import { startTemplateDraft } from "../../../server/setup/start";

/**
 * A plain link that starts a draft from a template and opens it, e.g. from the landing page or a
 * shared link. A server redirect, so it works before any JavaScript loads and runs once per click.
 */
export const Route = createFileRoute("/setup/template/$templateId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const result = await run(startTemplateDraft(params.templateId));
        const location = result._tag === "Ok" ? `/setup/${result.value.draftId}` : "/#templates";
        return new Response(null, { status: 303, headers: { location } });
      },
    },
  },
});
