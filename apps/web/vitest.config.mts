import { defineConfig } from "vitest/config";

// WHY THIS FILE EXISTS: until 2026-08-04 `apps/web` had NO test runner at all — no `test` script,
// no vitest dependency, no config here or at the repo root. `pnpm test` is `turbo run test`, which
// skips a workspace that declares no `test` script, so **anything asserted inside `apps/web` was
// asserted by nobody**. 15.3-07 shipped a `preflightCopy.test.ts` next to its module that executed
// nowhere while reading as coverage in the diff and in review; the adversarial pass caught it, and
// two waves' worth of UI guarantees had to be smuggled into `packages/core` instead.
//
// SCOPE IS DELIBERATELY `.ts`, NOT `.tsx`. This runs the PURE modules that sit beside the
// components — copy builders, formatters, pure derivations — in a plain node environment. There is
// no jsdom and no testing-library, so React components still cannot be rendered here.
// ponytail: the smallest thing that closes the "a test file here is decoration" gap. Adding jsdom +
// @testing-library/react is the upgrade path when a component guarantee actually needs rendering;
// it is two more dependencies and should be a deliberate choice, not a side effect of this one.
//
// Component-level guarantees that cannot move into a pure module still belong in
// `packages/core/src/vaultSurface.test.ts`, which reads the surface as SOURCE TEXT.
export default defineConfig({
  test: {
    environment: "node",
    // `.ts` only — a `.tsx` file here would silently need a DOM and fail confusingly.
    include: ["app/**/*.test.ts", "lib/**/*.test.ts"],
    // FALSE ON PURPOSE. If this workspace ever has no test files, that is the exact condition this
    // config was created to make visible — a silent green run is how the last gap survived.
    passWithNoTests: false,
  },
});
