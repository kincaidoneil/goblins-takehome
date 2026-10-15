import { createFileRoute } from "@tanstack/react-router";
import { createAssignmentRoute } from "../../../server/loadtest/routes";

/** Creates an assignment from a template, for simulated teachers. */
export const Route = createFileRoute("/api/teacher/assignments")({
  server: { handlers: { POST: ({ request }) => createAssignmentRoute(request) } },
});
