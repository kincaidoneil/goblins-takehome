import { defineConfig, devices } from "@playwright/test";

// E2E runs against a deployed URL: the Vercel preview in CI, or whatever
// E2E_BASE_URL points at locally (for example `pnpm --filter web dev`).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Vercel previews sit behind Deployment Protection. This header lets the test
// browser through, and the second header sets a cookie so later navigations and
// sync requests from the page are let through too.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders: Record<string, string> =
  bypassSecret === undefined
    ? {}
    : {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "samesitenone",
      };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL,
    extraHTTPHeaders,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
