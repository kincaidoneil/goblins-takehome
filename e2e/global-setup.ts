import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { clerkSetup } from "@clerk/testing/playwright";
import { authMode, clerkUserEmail } from "./auth";

/**
 * In Clerk mode: fetches a Clerk testing token and makes sure the `+clerk_test` teacher exists on
 * the development instance. Reuses the user across runs. Needs CLERK_SECRET_KEY and the
 * publishable key, both in .env.local.
 */
export default async function globalSetup() {
  if (authMode === "local") return;
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (secretKey === undefined || publishableKey === undefined) {
    throw new Error("E2E_AUTH=clerk needs CLERK_SECRET_KEY and VITE_CLERK_PUBLISHABLE_KEY");
  }
  if (!publishableKey.startsWith("pk_test_")) {
    throw new Error("E2E_AUTH=clerk only runs against a Clerk development instance (pk_test_)");
  }
  process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
  await clerkSetup({ publishableKey, secretKey });

  const client = createClerkClient({ secretKey });
  const existing = await client.users.getUserList({ emailAddress: [clerkUserEmail] });
  if (existing.data.length === 0) {
    try {
      await client.users.createUser({
        emailAddress: [clerkUserEmail],
        firstName: "E2E",
        lastName: "Teacher",
        // The test signs in with a sign-in token, so the user needs no password or consent.
        skipPasswordRequirement: true,
        skipLegalChecks: true,
      });
    } catch (error) {
      if (!isClerkAPIResponseError(error)) throw error;
      // Clerk's codes name the instance setting that blocked creation.
      const reasons = error.errors.map((e) => `${e.code}: ${e.longMessage ?? e.message}`);
      throw new Error(`Clerk refused to create ${clerkUserEmail}:\n${reasons.join("\n")}`);
    }
  }
}
