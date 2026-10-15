/**
 * Live data the way the browser gets it: Electric shapes through the app's `/api/shape` proxy,
 * with the same client library the app uses. Each subscription keeps a long-poll open for its
 * whole lifetime, so a simulated class puts the same sync load on the app and Electric as a real
 * one.
 */
import { isChangeMessage, isControlMessage, type Row, ShapeStream } from "@electric-sql/client";
import { Effect, Schema } from "effect";
import { Recorder } from "./events.ts";
import { inFlight, messageOf } from "./http.ts";

export type View = "session" | "students" | "grades" | "my-session" | "my-grades";

export interface Subscription<A, I> {
  readonly view: View;
  readonly sessionId: string;
  readonly headers: Record<string, string>;
  readonly schema: Schema.Schema<A, I>;
  /** Called with the full current rows of the shape after every batch of changes. */
  readonly onRows: (rows: ReadonlyArray<A>) => void;
}

/**
 * Subscribes until the surrounding scope closes. Partial updates are merged by row key, as
 * TanStack DB does in the app, and each merged row is decoded against `schema`.
 */
export const subscribe = <A, I>(baseUrl: string, subscription: Subscription<A, I>) =>
  Effect.gen(function* () {
    const recorder = yield* Recorder;
    const decode = Schema.decodeUnknownEither(subscription.schema);
    const record = (message: string) =>
      recorder.record({ type: "shape-error", at: Date.now(), view: subscription.view, message });

    const fetchClient: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const live = url.searchParams.get("live") === "true";
      const at = Date.now();
      const started = performance.now();
      inFlight.count++;
      try {
        const response = await fetch(input, init);
        // Long-polls hold the response open until data arrives; time to headers is what we
        // measure, which for a live request is how long the server held it.
        recorder.record({
          type: "request",
          at,
          op: "shape",
          ms: Math.round(performance.now() - started),
          outcome: { _tag: "Status", status: response.status },
          live,
          view: subscription.view,
        });
        return response;
      } catch (cause) {
        const aborted = init?.signal?.aborted === true;
        if (!aborted) {
          recorder.record({
            type: "request",
            at,
            op: "shape",
            ms: Math.round(performance.now() - started),
            outcome: { _tag: "NetworkError", message: messageOf(cause) },
            live,
            view: subscription.view,
          });
        }
        throw cause;
      } finally {
        inFlight.count--;
      }
    };

    const rows = new Map<string, Row>();
    const controller = new AbortController();
    const stream = new ShapeStream({
      url: `${baseUrl}/api/shape`,
      params: { view: subscription.view, sessionId: subscription.sessionId },
      headers: subscription.headers,
      fetchClient,
      signal: controller.signal,
      onError: (error) => {
        record(messageOf(error));
        // Keep syncing, as the app does: a dashboard that stops updating is worse than a retry.
        return {};
      },
    });

    const unsubscribe = stream.subscribe(
      (messages) => {
        let changed = false;
        for (const message of messages) {
          if (isChangeMessage(message)) {
            changed = true;
            switch (message.headers.operation) {
              case "insert":
                rows.set(message.key, message.value);
                break;
              case "update":
                rows.set(message.key, { ...rows.get(message.key), ...message.value });
                break;
              case "delete":
                rows.delete(message.key);
                break;
            }
          } else if (isControlMessage(message) && message.headers.control === "must-refetch") {
            rows.clear();
            changed = true;
          }
        }
        if (!changed) return;
        const decoded: Array<A> = [];
        for (const row of rows.values()) {
          const result = decode(row);
          if (result._tag === "Right") decoded.push(result.right);
          else record(`row does not match the schema: ${result.left.message}`);
        }
        subscription.onRows(decoded);
      },
      (error) => record(messageOf(error)),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe();
        controller.abort();
      }),
    );
  });

// ---------------------------------------------------------------------------
// Row schemas: the columns `apps/web/src/server/shapes.ts` sends for each view, in snake_case.

const State = Schema.Literal("submitted", "grading", "graded", "needs_teacher", "couldnt_grade");

export const SessionRow = Schema.Struct({
  id: Schema.String,
  status: Schema.Literal("lobby", "live", "ended"),
});

export const StudentRow = Schema.Struct({ id: Schema.String, display_name: Schema.String });

export const TeacherGradeRow = Schema.Struct({
  submission_id: Schema.String,
  state: State,
  points: Schema.NullOr(Schema.Number),
  failure_reason: Schema.NullOr(Schema.String),
});

export const StudentGradeRow = Schema.Struct({
  submission_id: Schema.String,
  state: State,
});
