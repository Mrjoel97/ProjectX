# Phase 02 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed by the plan that found them.

## Pre-existing `tsc --noEmit` failures in backend test files (found during 02-01, Task 1)

`pnpm --filter @pikar/backend typecheck` (i.e. `tsc --noEmit` over the whole
`convex/**` tree, test files included) reports the following errors. They are
**identical at HEAD before any 02-01 change** (verified by stashing all 02-01 edits,
regenerating `_generated`, and diffing the error set — byte-identical). None are in
files 02-01 created or modified.

- `convex/audit.test.ts`, `convex/tenant.test.ts`, `convex/worm.test.ts`,
  `convex/importGuard.test.ts` — `Property 'glob' does not exist on type 'ImportMeta'`
  (TS2339). `import.meta.glob` is a Vite/vitest runtime feature; `tsc` needs a
  `/// <reference types="vite/client" />` or `vite/client` in `compilerOptions.types`
  to know it. Tests still RUN fine (vitest uses esbuild/vite, which understands glob).
- `convex/audit.test.ts`, `convex/tenant.test.ts` — strict-null `possibly 'undefined'`
  (TS18048 / TS2532) on query results in assertions.
- `convex/worm.test.ts(74)` — implicit `any` on a callback param (TS7006).
- `convex/smoke.ts(35,39,91,95 etc.)` — self-referential workflow definitions lack
  explicit return-type annotations (TS7022 / TS7023). Known Convex Workflow typing
  pattern; touching it risks the DLQ / review-gate smoke scripts.

**Why deferred:** scope boundary — 02-01 only auto-fixes issues its own changes cause,
and it caused none of these. A follow-up cleanup plan should add the `vite/client`
reference and annotate `smoke.ts`, then this whole gate goes green.
