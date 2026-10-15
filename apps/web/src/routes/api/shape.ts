/**
 * Proxy between the browser's Electric clients and Electric. `resolveShape` decides what the
 * caller may read; this route adds Electric's credentials and passes the sync protocol through.
 */

import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";
import { createFileRoute } from "@tanstack/react-router";
import { Config, Effect, Option, Redacted } from "effect";
import { run } from "../../server/runtime";
import { resolveShape } from "../../server/shapes";

/** Self-hosted Electric: a URL and an optional secret. Previews have no Electric. */
const electric = Config.all({
  url: Config.option(Config.string("ELECTRIC_URL")),
  secret: Config.option(Config.redacted("ELECTRIC_SECRET")),
});

/**
 * Keeps control messages and the student's own rows from an Electric response. Offsets and
 * handles live in headers, so dropping rows doesn't disturb the client's position in the log.
 */
const onlyStudentRows = (body: unknown, studentId: string): ReadonlyArray<unknown> =>
  Array.isArray(body)
    ? body.filter((message: unknown) => {
        if (typeof message !== "object" || message === null || !("value" in message)) return true;
        const value: unknown = message.value;
        return (
          typeof value === "object" &&
          value !== null &&
          "student_id" in value &&
          value.student_id === studentId
        );
      })
    : [];

const proxy = (request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "";
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const shape = yield* resolveShape(request, view, sessionId);
    const config = yield* electric;
    if (Option.isNone(config.url)) {
      return new Response("Live updates are off in this environment", { status: 503 });
    }

    const upstream = new URL("/v1/shape", config.url.value);
    for (const [key, value] of url.searchParams) {
      if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) upstream.searchParams.set(key, value);
    }
    upstream.searchParams.set("table", shape.table);
    upstream.searchParams.set("where", shape.where);
    for (const [i, value] of shape.params.entries()) {
      upstream.searchParams.set(`params[${i + 1}]`, value);
    }
    upstream.searchParams.set("columns", shape.columns.join(","));
    // Full rows on every change, so each message carries student_id for the filter below.
    if (shape.rows._tag === "OfStudent") upstream.searchParams.set("replica", "full");
    if (Option.isSome(config.secret)) {
      upstream.searchParams.set("secret", Redacted.value(config.secret.value));
    }

    const response = yield* Effect.promise(() => fetch(upstream, { signal: request.signal }));
    // fetch already decompressed the body, so the encoding headers no longer apply.
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("vary", "cookie");
    // Electric marks snapshots as publicly cacheable for an hour. Behind this proxy every
    // response depends on who is asking, and a CDN keyed by URL would serve a stale snapshot
    // (whose shape Electric may have since replaced, sending the client into a refetch loop),
    // or one teacher's rows to another browser. Never cache.
    headers.set("cache-control", "private, no-store");
    if (shape.rows._tag === "OfStudent" && response.status === 200) {
      const body: unknown = yield* Effect.promise(() => response.json());
      return Response.json(onlyStudentRows(body, shape.rows.studentId), {
        status: 200,
        headers,
      });
    }
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
