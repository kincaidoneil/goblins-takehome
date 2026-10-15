import { SqlClient } from "@goblins/domain";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { run } from "../../server/runtime";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        run(
          Effect.gen(function* () {
            const sql = yield* SqlClient;
            yield* sql`select 1`;
            return Response.json({ ok: true });
          }).pipe(
            Effect.catchAll(() => Effect.succeed(Response.json({ ok: false }, { status: 503 }))),
          ),
        ),
    },
  },
});
