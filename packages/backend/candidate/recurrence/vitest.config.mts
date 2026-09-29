import { defineConfig } from "vitest/config";

// Explicit opt-in. The backend's default runner never discovers candidate tests.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["candidate/recurrence/model.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
