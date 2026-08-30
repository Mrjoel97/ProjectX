import { defineConfig } from "vitest/config";

// WHY THIS FILE EXISTS: until 2026-08-04 `apps/web` had NO test runner at all — no `test` script,
// no vitest dependency, no config here or at the repo root. `pnpm test` is `turbo run test`, which
// skips a workspace that declares no `test` script, so **anything asserted inside `apps/web` was
// asserted by nobody**. 15.3-07 shipped a `preflightCopy.test.ts` next to its module that executed
// nowhere while reading as coverage in the diff and in review; the adversarial pass caught it, and
// two waves' worth of UI guarantees had to be smuggled into `packages/core` instead.
//
// SCOPE IS DELIBERATELY `.ts`, NOT `.tsx`, and the DEFAULT environment is node: this runs the PURE
// modules that sit beside the components — copy builders, formatters, pure derivations — plus the
// SSR renders (`react-dom/server` needs no DOM).
//
// THE UPGRADE PATH WAS TAKEN, ONCE, AND IT IS PER-FILE. 29-07-FIX2 added `jsdom` (one devDependency,
// no testing-library) because four mutations that made `/dashboard/workflows` functionally inert
// passed the whole customizer suite: SSR renders a component from props and fires no event, so it
// can say nothing about whether a container is wired to its view. A file that needs a DOM opts in
// with a `// @vitest-environment jsdom` docblock and drives React itself (`createRoot` + `act`);
// `WorkflowPackCustomizer.container.test.ts` is the one that does. Everything else still runs in
// node, which is faster and keeps a missing-DOM failure loud instead of accidental.
//
// Component-level guarantees that cannot move into a pure module still belong in
// `packages/core/src/vaultSurface.test.ts`, which reads the surface as SOURCE TEXT.
export default defineConfig({
  // Match Next's JSX transform. esbuild defaults to the CLASSIC runtime, so a `.tsx` imported by a
  // test compiled to `React.createElement` and died with `React is not defined` unless the
  // component file carried a default `React` import it never used — a dead import that biome then
  // flags, added to every component forever. Next builds with the automatic runtime
  // (`"jsx": "preserve"` + SWC), so this makes the runner agree with the app rather than making
  // each source file carry a workaround.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // `.ts` only — a `.tsx` file here would silently need the JSX transform to reach it through a
    // different path; `createElement` is what the two rendering suites use instead.
    include: ["app/**/*.test.ts", "lib/**/*.test.ts"],
    // FALSE ON PURPOSE. If this workspace ever has no test files, that is the exact condition this
    // config was created to make visible — a silent green run is how the last gap survived.
    passWithNoTests: false,
  },
});
