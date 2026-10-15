import { createClerkClient } from "@clerk/backend";
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
    await client.users.createUser({
      emailAddress: [clerkUserEmail],
      firstName: "E2E",
      lastName: "Teacher",
    });
  }
}
