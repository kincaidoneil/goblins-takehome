import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts: unit tests need none of the app's server plugins.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
