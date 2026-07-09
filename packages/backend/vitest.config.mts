import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in-memory. It requires the edge-runtime
// environment (needs @edge-runtime/vm). NO watch mode anywhere — `vitest run` only.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
  },
});
