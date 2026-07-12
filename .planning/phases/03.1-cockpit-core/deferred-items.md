# Deferred Items — Phase 03.1 Cockpit Core

Out-of-scope discoveries logged during execution (NOT fixed — pre-existing, unrelated to the current task's changes).

## Pre-existing `tsc --noEmit` errors in `*.test.ts` (found 03.1-01)

`pnpm --filter @pikar/backend typecheck` reports 15 errors in test files, all pre-existing (confirmed by `git stash` — identical output without any 03.1-01 change):

- `import.meta.glob` (TS2339 "Property 'glob' does not exist on type 'ImportMeta'") in audit/deadLetters/guardrails/importGuard/tenant/worm `.test.ts` — Vitest bundler global that plain `tsc` doesn't type.
- Test-assertion narrowing (`row`/object "possibly undefined") in audit.test.ts and tenant.test.ts.

Cause: the `typecheck` script (`tsc --noEmit`) sweeps test files that rely on Vitest's `import.meta.glob` typing. Not caused by cockpit work; the tests themselves run green under Vitest.

Fix when touched: add `vite/client` (or `import.meta.glob` typing) to the backend tsconfig `types`, or exclude `*.test.ts` from the `typecheck` tsconfig.

## Untracked `@pikar/core` WIP fails typecheck (found 03.1-01)

`packages/core/src/emailIntent.ts` (and `emailIntent.test.ts`) are **untracked** (`git status ??`), plus `packages/core/src/index.ts` is modified — unrelated in-progress work sitting in the working tree, NOT part of plan 03.1-01. `tsc --noEmit` reports `emailIntent.ts(61,39): TS2322 Type 'string | undefined' is not assignable to type 'string'`. Out of scope for this plan (03.1-01 touches only schema.ts, lib/functions.ts, biome.json). Owner of the emailIntent work should resolve before committing it.

## Pre-existing biome config warnings (found 03.1-01)

`biome check` emits 3 warnings + 2 infos on `biome.json` itself (schema version 2.0.0 vs CLI 2.5.3, deprecated `recommended` field, `useBiomeIgnoreFolder` trailing `/**`). Not errors (biome exits clean); pre-existing, unrelated to the `noRestrictedImports` action-ban change. Fix with `biome migrate` when convenient.
