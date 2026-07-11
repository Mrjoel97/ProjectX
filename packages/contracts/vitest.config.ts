import { defineConfig } from "vitest/config";

// Pure-TS package: default node env, run-only (NO watch). The routing Zod
// schema (plan 02-02) is tested here; convex-test / edge-runtime are not needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
