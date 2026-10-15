import { createFileRoute } from "@tanstack/react-router";
import { sessionStatusRoute } from "../../../../../server/loadtest/routes";

/** `start` or `end` a class session, for simulated teachers. */
export const Route = createFileRoute("/api/teacher/sessions/$sessionId/$action")({
  server: {
    handlers: {
      POST: ({ request, params }) => sessionStatusRoute(request, params.sessionId, params.action),
    },
  },
});
