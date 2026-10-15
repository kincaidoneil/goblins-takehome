/**
 * The server's Effect runtime. Server functions and routes run their effects through `run`.
 */
import { DatabaseLive } from "@goblins/domain";
import { type Effect, Layer, ManagedRuntime, Option } from "effect";
import { QStashGradeQueue, qstashConfig } from "./grader";
import { InlineMockGradeQueue } from "./grading";
import { WhiteboardStoreLive } from "./whiteboards";

/** QStash and the real grading pipeline in production; the inline scripted mock elsewhere. */
const GradeQueueLive = Option.match(qstashConfig, {
  onNone: () => InlineMockGradeQueue,
  onSome: QStashGradeQueue,
});

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(GradeQueueLive, WhiteboardStoreLive).pipe(Layer.provideMerge(DatabaseLive)),
);

export type AppServices = ManagedRuntime.ManagedRuntime.Context<typeof runtime>;

export const run = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
  runtime.runPromise(effect);
