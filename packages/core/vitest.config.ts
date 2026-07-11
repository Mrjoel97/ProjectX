import { defineConfig } from "vitest/config";

// Pure-TS package: default node env, run-only (NO watch). Wave-2 TDD tasks
// land tests here; convex-test / edge-runtime are not needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
