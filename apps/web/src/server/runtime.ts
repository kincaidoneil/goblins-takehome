/**
 * The server's Effect runtime. Server functions and routes run their effects through `run`.
 */
import { DatabaseLive } from "@goblins/domain";
import { type Effect, Layer, ManagedRuntime } from "effect";
import { InlineMockGradeQueue } from "./grading";
import { WhiteboardStoreLive } from "./whiteboards";

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(InlineMockGradeQueue, WhiteboardStoreLive).pipe(Layer.provideMerge(DatabaseLive)),
);

export type AppServices = ManagedRuntime.ManagedRuntime.Context<typeof runtime>;

export const run = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
  runtime.runPromise(effect);
