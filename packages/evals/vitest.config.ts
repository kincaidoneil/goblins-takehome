import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["datasets/test/**/*.test.ts"] } });
