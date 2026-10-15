/**
 * The server's Effect runtime. Server functions and routes run their effects through `run`,
 * which first resolves the request's sign-in and cookies (see request-context.ts).
 */
import { auth } from "@clerk/tanstack-react-start/server";
import { DatabaseLive } from "@goblins/domain";
import { getCookies } from "@tanstack/react-start/server";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { QStashGradeQueue, qstashConfig } from "./grader";
import { InlineMockGradeQueue } from "./grading";
import { RequestContext } from "./request-context";
import { LOCAL_TEACHER_COOKIE, LOCAL_TEACHER_ID, localTeacherMode } from "./teacher-mode";
import { WhiteboardStoreLive } from "./whiteboards";

/** QStash and the real grading pipeline in production; the inline scripted mock elsewhere. */
const GradeQueueLive = Option.match(qstashConfig, {
  onNone: () => InlineMockGradeQueue,
  onSome: QStashGradeQueue,
});

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(GradeQueueLive, WhiteboardStoreLive).pipe(Layer.provideMerge(DatabaseLive)),
);

export type AppServices = ManagedRuntime.ManagedRuntime.Context<typeof runtime> | RequestContext;

/** Reads the request's sign-in and cookies here, in the handler's own async context. */
const requestContext = async (): Promise<RequestContext["Type"]> => {
  const cookies = getCookies();
  if (localTeacherMode) {
    return { clerkUserId: cookies[LOCAL_TEACHER_COOKIE] ?? LOCAL_TEACHER_ID, cookies };
  }
  const { userId } = await auth();
  return { clerkUserId: userId, cookies };
};

export const run = async <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> => {
  const context = await requestContext();
  return runtime.runPromise(Effect.provideService(effect, RequestContext, context));
};
