import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The pipeline tests step virtual time second by second through 15-minute
    // scenarios, which takes a few seconds of real time.
    testTimeout: 30_000,
  },
})
