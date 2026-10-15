/**
 * Re-sends grade jobs whose queue message may have been lost: grades queued for more than a
 * minute, or claimed by a consumer whose lease ran out. Sending a duplicate is harmless, since
 * every grade write checks the attempt and the claim.
 *
 * Called by a cron in production (with `Authorization: Bearer $CRON_SECRET`). In local mode it
 * is open, and `?now=1` re-sends every waiting job at once, which development and E2E use.
 */
import { stuckJobs } from "@goblins/domain";
import { createFileRoute } from "@tanstack/react-router";
import { Config, Effect, Option, Redacted } from "effect";
import { GradeQueue } from "../../../server/grading";
import { run } from "../../../server/runtime";
import { localTeacherMode } from "../../../server/teacher";

const authorized = (request: Request) =>
  Effect.gen(function* () {
    if (localTeacherMode) return true;
    const secret = yield* Config.option(Config.redacted("CRON_SECRET"));
    return (
      Option.isSome(secret) &&
      request.headers.get("authorization") === `Bearer ${Redacted.value(secret.value)}`
    );
  });

const sweep = (request: Request) =>
  Effect.gen(function* () {
    if (!(yield* authorized(request))) return new Response("Unauthorized", { status: 401 });
    const now = localTeacherMode && new URL(request.url).searchParams.get("now") === "1";
    const jobs = yield* stuckJobs({ queuedSeconds: now ? 0 : 60, limit: 500 });
    const queue = yield* GradeQueue;
    yield* Effect.forEach(jobs, (job) => queue.enqueue(job), { discard: true });
    return Response.json({ resent: jobs.length });
  });

export const Route = createFileRoute("/api/grading/sweep")({
  server: { handlers: { GET: ({ request }) => run(sweep(request)) } },
});
