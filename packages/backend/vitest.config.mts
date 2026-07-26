import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in-memory. It requires the edge-runtime
// environment (needs @edge-runtime/vm). NO watch mode anywhere — `vitest run` only.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
    // Vitest's default is 5_000ms, which is too tight for THIS suite and produced a recurring
    // load-dependent flake: `runCockpitAgent.test.ts > mock loop` and `voice.test.ts > storeBrief`
    // both take ~3.4s ISOLATED (each convex-test instance boots an in-memory backend, registers
    // components, and drives a real multi-step loop), so under full-suite parallel load they cross
    // 5s and fail — then pass alone, which is what made it read as a bad test rather than a bad
    // budget. Raised ONCE here instead of sprinkling per-test `{ timeout }` overrides: the
    // constraint is the harness's fixed cost, not any single test's logic.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
