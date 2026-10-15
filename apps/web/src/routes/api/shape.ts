/**
 * Proxy between the browser's Electric clients and Electric. `resolveShape` decides what the
 * caller may read; this route adds Electric's credentials and passes the sync protocol through.
 */

import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";
import { createFileRoute } from "@tanstack/react-router";
import { Config, Effect, Option, Redacted } from "effect";
import { run } from "../../server/runtime";
import { resolveShape } from "../../server/shapes";

const electric = Config.all({
  url: Config.string("ELECTRIC_URL").pipe(Config.withDefault("https://api.electric-sql.cloud")),
  sourceId: Config.option(Config.string("ELECTRIC_SOURCE_ID")),
  secret: Config.option(Config.redacted("ELECTRIC_SECRET")),
});

const proxy = (request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "";
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const shape = yield* resolveShape(request, view, sessionId);
    const config = yield* electric;

    const upstream = new URL("/v1/shape", config.url);
    for (const [key, value] of url.searchParams) {
      if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) upstream.searchParams.set(key, value);
    }
    upstream.searchParams.set("table", shape.table);
    upstream.searchParams.set("where", shape.where);
    for (const [i, value] of shape.params.entries()) {
      upstream.searchParams.set(`params[${i + 1}]`, value);
    }
    upstream.searchParams.set("columns", shape.columns.join(","));
    if (Option.isSome(config.sourceId))
      upstream.searchParams.set("source_id", config.sourceId.value);
    if (Option.isSome(config.secret)) {
      upstream.searchParams.set("secret", Redacted.value(config.secret.value));
    }

    const response = yield* Effect.promise(() => fetch(upstream, { signal: request.signal }));
    // fetch already decompressed the body, so the encoding headers no longer apply.
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("vary", "cookie");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }).pipe(
    Effect.catchTags({
      Forbidden: () => Effect.succeed(new Response("Forbidden", { status: 403 })),
      NotSignedIn: () => Effect.succeed(new Response("Sign in required", { status: 401 })),
      UnknownView: () => Effect.succeed(new Response("Unknown view", { status: 400 })),
    }),
  );

export const Route = createFileRoute("/api/shape")({
  server: { handlers: { GET: ({ request }) => run(proxy(request)) } },
});
