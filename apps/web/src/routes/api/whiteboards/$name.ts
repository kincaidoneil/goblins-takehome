import { createFileRoute } from "@tanstack/react-router";
import { Effect, Option } from "effect";
import { readLocalWhiteboard } from "../../../server/whiteboards";

/** Serves whiteboards stored on local disk when Vercel Blob is not configured. */
export const Route = createFileRoute("/api/whiteboards/$name")({
  server: {
    handlers: {
      GET: ({ params }) =>
        Effect.runPromise(
          Effect.map(readLocalWhiteboard(params.name), (png) =>
            Option.match(png, {
              onNone: () => new Response("Not found", { status: 404 }),
              onSome: (bytes) =>
                new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } }),
            }),
          ),
        ),
    },
  },
});
