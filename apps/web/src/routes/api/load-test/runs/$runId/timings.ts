import { createFileRoute } from "@tanstack/react-router";
import { timingsRoute } from "../../../../../server/loadtest/routes";

/** Per-submission pipeline timestamps for one load-test run. Load-test token required. */
export const Route = createFileRoute("/api/load-test/runs/$runId/timings")({
  server: { handlers: { GET: ({ request, params }) => timingsRoute(request, params.runId) } },
});
