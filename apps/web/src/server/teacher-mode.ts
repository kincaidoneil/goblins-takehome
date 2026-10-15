/**
 * Local teacher mode: with `AUTH_MODE=local` (set in `local.env` for development and local E2E),
 * requests sign in without Clerk. The teacher is `local_teacher`, or the Clerk id named by the
 * `gb_local_teacher` cookie, so tests can run several teachers at once. Ignored whenever `VERCEL`
 * is set, so no deployed environment can turn it on.
 */
export const localTeacherMode =
  process.env.AUTH_MODE === "local" && process.env.VERCEL === undefined;

export const LOCAL_TEACHER_ID = "local_teacher";
export const LOCAL_TEACHER_COOKIE = "gb_local_teacher";
