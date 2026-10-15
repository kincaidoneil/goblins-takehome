import { createFileRoute } from "@tanstack/react-router";
import { joinRoute } from "../../server/loadtest/routes";

/** Plain-HTTP join for the class simulator. Same Effect as the student app's join. */
export const Route = createFileRoute("/api/join")({
  server: { handlers: { POST: ({ request }) => joinRoute(request) } },
});
