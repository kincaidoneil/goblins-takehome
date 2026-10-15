import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

/**
 * How the teacher signs in, chosen by env:
 * - `E2E_AUTH=local` (default): the app runs with AUTH_MODE=local and every request is the local
 *   teacher. Local Docker stack and CI.
 * - `E2E_AUTH=clerk`: a real Clerk sign-in as the `+clerk_test` user that global-setup.ts
 *   creates on the Clerk development instance. Works locally and against a deploy.
 */
export const authMode: "local" | "clerk" = process.env.E2E_AUTH === "clerk" ? "clerk" : "local";

/** The Clerk test user. `+clerk_test` addresses never receive mail; the code is always 424242. */
export const clerkUserEmail = process.env.E2E_CLERK_USER_EMAIL ?? "e2e+clerk_test@example.com";

/** Signs the teacher's page in. A no-op in local mode, where the server signs everyone in. */
export const signInTeacher = async (page: Page) => {
  if (authMode === "local") return;
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: clerkUserEmail });
};
