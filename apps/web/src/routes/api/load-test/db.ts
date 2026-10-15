import { createFileRoute } from "@tanstack/react-router";
import { dbStatsRoute } from "../../../server/loadtest/routes";

/** Database load for the load-test report. Load-test token required. */
export const Route = createFileRoute("/api/load-test/db")({
  server: { handlers: { GET: ({ request }) => dbStatsRoute(request) } },
});
