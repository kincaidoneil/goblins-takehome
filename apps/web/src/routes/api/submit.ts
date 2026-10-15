import { createFileRoute } from "@tanstack/react-router";
import { submitRoute } from "../../server/loadtest/routes";

/** Plain-HTTP submit (multipart) for the class simulator. Same Effect as the student app's submit. */
export const Route = createFileRoute("/api/submit")({
  server: { handlers: { POST: ({ request }) => submitRoute(request) } },
});
