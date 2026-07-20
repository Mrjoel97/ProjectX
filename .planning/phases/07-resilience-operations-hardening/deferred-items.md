# Phase 7 — Deferred / Out-of-Scope Items

Discoveries logged during execution that are NOT caused by the current task's changes.
Do not fix inline (scope boundary); triage in a dedicated plan or when the owning file is touched.

## Pre-existing backend typecheck failures (found during 07-01, verified on baseline)

`pnpm --filter @pikar/backend typecheck` fails on baseline (before 07-01's schema/dep edits),
with identical errors after — 07-01 introduced ZERO new typecheck errors. Both are test-file
issues, not product code:

- `convex/voiceToken.test.ts(55,77,91)` — `Property 'mintClientSecret' does not exist` on the
  generated `internal.voiceToken` API. Stale `convex/_generated/api` — `mintClientSecret` exists
  in `voiceToken.ts` but codegen has not re-run since (needs a live `convex dev`/`convex codegen`).
- `convex/worm.test.ts(8,16)` — `Property 'glob' does not exist on type 'ImportMeta'`. `import.meta.glob`
  is a Vite/vitest feature `tsc --noEmit` does not know about (runs fine under vitest).

Resolve: re-run `convex codegen` against the deployment for the api staleness; add a vitest/vite
`ImportMeta` type augmentation (or `// @ts-expect-error`) for the `worm.test.ts` glob if a clean
`tsc` is wanted. Neither blocks 07-01's additive schema/index/dep changes.
