import { defineConfig } from "vitest/config";

// Pure-TS package: default node env, run-only (NO watch) — same shape as @pikar/core.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
