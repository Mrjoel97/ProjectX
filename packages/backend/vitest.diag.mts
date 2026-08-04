// TEMPORARY DIAGNOSTIC CONFIG — delete after the flake audit. Mirrors vitest.config.mts
// exactly and only adds the setup file, so the timing profile stays representative.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
    setupFiles: ["./vitest.diag.setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
