import { createFileRoute } from "@tanstack/react-router";

/** Whether live updates (Electric) are available in this environment. Previews have none. */
export const Route = createFileRoute("/api/live")({
  server: {
    handlers: {
      GET: () => Response.json({ live: (process.env.ELECTRIC_URL ?? "") !== "" }),
    },
  },
});
