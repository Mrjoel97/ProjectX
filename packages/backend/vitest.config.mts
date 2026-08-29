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
    // THE OFFLINE-FIXTURE CONSENT, FOR THE WHOLE SUITE. This line turns the operator flag ON for
    // every backend test file: a test run IS an operator consenting to fixtures. It is what the
    // `offlineSeamAvailable()` gates in `lib/models.ts` read, and stating it here rather than in
    // ~14 `beforeEach` blocks is what let the gate close on `vaultGround.ts`. A test that needs
    // the consent ABSENT stubs it off (`vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "")`), which is what
    // `knowledgeLlm.test.ts`, `lib/models.test.ts` and `vaultGround.test.ts` already do.
    //
    // WHICH `SMOKE::` seams are gated on that predicate and which are still selected by CONTENT is
    // tracked in `.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md` — read
    // the register, not this comment. Several are still ungated, and the register carries them as
    // OPEN DEBT rather than as a design choice, so this flag restrains only the converted ones.
    env: { PIKAR_OFFLINE_FIXTURES: "1" },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
