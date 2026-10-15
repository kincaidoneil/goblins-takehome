import { createFileRoute } from "@tanstack/react-router";
import { cleanupRoute } from "../../../../../server/loadtest/routes";

/** Deletes every row a load-test run created (`deleteLoadTestRun`). Load-test token required. */
export const Route = createFileRoute("/api/load-test/runs/$runId/cleanup")({
  server: { handlers: { POST: ({ request, params }) => cleanupRoute(request, params.runId) } },
});
