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
    // ~14 `beforeEach` blocks is what let the gate close on `vaultGround.ts`. A test that needs the
    // consent ABSENT stubs it off: `vaultGround.test.ts` with `""`, `vaultDigest.test.ts` with
    // `undefined`, `lib/models.test.ts` with both. `knowledgeLlm.test.ts` reaches the same state
    // from the OTHER half of `offlineSeamAvailable()` instead — it plants a model credential.
    //
    // WHICH `SMOKE::` seams are gated on that predicate and which are still selected by CONTENT is
    // tracked in `.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md` — read
    // the register, not this comment. Several are still ungated, and the register carries them as
    // OPEN DEBT rather than as a design choice, so this flag restrains only the converted ones. Its
    // worked example is `vault.ts`'s `vaultSearch`, whose bare `query.startsWith("SMOKE::")` is
    // E2E-coupled: `apps/web/e2e/vault-redesign.spec.ts` types those sentinels against a REAL KEYED
    // deployment, where `offlineSeamAvailable()` is false.
    env: { PIKAR_OFFLINE_FIXTURES: "1" },
    // RAISED AGAIN 2026-08-30, 20_000 -> 60_000, for the SAME reason and by the same argument as
    // the 5_000 -> 20_000 above. The file that outgrew 20s is `vaultDigest.test.ts`: it recorded 16
    // of its 17 tests failing in a full-suite run while passing 17/17 alone, which is the flake's
    // signature, and MEASURED IDLE its first test costs **7.29s** on its own (the whole file 16.1s
    // of test time). A test that needs 7.3s with the machine to itself does not have 12.7s of
    // headroom under ~10 parallel workers, so crossing 20s under load is arithmetic rather than
    // bad luck — and a single blown budget in a file with shared per-test setup takes the file
    // with it, which is where 16-from-one comes from.
    //
    // Raising a timeout is only safe because NOTHING in this suite asserts on duration: no test
    // here treats elapsed time as an oracle, so this budget can never be the thing that makes a
    // wrong result read as right. It buys latency on a genuine hang (60s instead of 20s to fail)
    // and nothing else. If a file ever does assert a deadline, it must own its own `{ timeout }`
    // rather than inherit this one.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
