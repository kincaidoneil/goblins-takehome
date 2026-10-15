import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { localTeacherMode } from "./server/teacher-mode";

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  // Local teacher mode signs in without Clerk, so it needs no Clerk keys (CI E2E has none).
  requestMiddleware: localTeacherMode ? [csrfMiddleware] : [csrfMiddleware, clerkMiddleware()],
}));
