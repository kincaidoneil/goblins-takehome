/**
 * The grading pipeline's QStash consumer: QStash delivers each grade job here, and
 * `packages/grader` claims the grade, calls the model and records the outcome.
 * Only live in production; elsewhere the inline mock grades in-process.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Option } from "effect";
import { consumeGradeJob } from "../../../server/grader";

export const Route = createFileRoute("/api/queue/grade")({
  server: {
    handlers: {
      POST: ({ request }) =>
        Option.match(consumeGradeJob, {
          onNone: () => Promise.resolve(new Response("Not found", { status: 404 })),
          onSome: (handle) => handle(request),
        }),
    },
  },
});
