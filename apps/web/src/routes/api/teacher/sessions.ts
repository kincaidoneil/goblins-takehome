import { createFileRoute } from "@tanstack/react-router";
import { createSessionRoute } from "../../../server/loadtest/routes";

/** Opens a class session in the lobby, for simulated teachers. */
export const Route = createFileRoute("/api/teacher/sessions")({
  server: { handlers: { POST: ({ request }) => createSessionRoute(request) } },
});
