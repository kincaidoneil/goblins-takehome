import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Clerk keys for E2E_AUTH=clerk live in the repo-root .env.local. Variables already set win.
const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// The app under test: the local server by default (CI and the local Docker stack), or a deploy
// through BASE_URL (or E2E_BASE_URL). See e2e/README.md.
const baseURL = process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
