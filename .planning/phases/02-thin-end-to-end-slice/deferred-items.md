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

**Re-confirmed in 02-04:** stashed 02-04's review.ts/smoke.ts/smoke-script edits and
re-ran typecheck — identical error set (only `smoke.ts` line numbers shifted by the
added comments). 02-04 introduced zero new type errors. Its behavioral check is the
`run-smoke-reviewgate.mjs` dev-deployment smoke (both gates PASS).

**Re-confirmed in 02-03:** stashed 02-03's new `requests.ts`/`notifications.ts` and
re-ran typecheck — identical (superset) error set. 02-03 introduced zero new type
errors. The real function typecheck is green: `npx convex codegen` runs the Convex
TypeScript pass (via `convex/tsconfig.json`, which resolves the vite/`import.meta.glob`
types) and exits 0. `pnpm --filter @pikar/backend test importGuard` is also green and
now scans both new modules (no raw-builder imports).

**Re-confirmed in 02-02:** stashed 02-02 Task-3's new `llm.ts` (+ contracts
`drafting.ts`) and re-ran typecheck — identical 18-error set with or without them.
`llm.ts`/`drafting.ts` introduce zero new type errors.

**Re-confirmed in 02-05:** net-zero — the whole-tree gate is back to the same 18-error
baseline after 02-05. Two notes:
- 02-05's new `gmail.ts` (a second `"use node"` action module reaching `internal.gmailAuth`)
  pushed `llm.ts`'s `route`/`draft` actions past TS's circular-inference limit (12 new
  TS7022/7023). This was **FIXED in-plan** (commit `5d567e7`), not deferred: explicit
  return-type annotations on `gmail.send` + `llm.ts` handlers/`runQuery` results per
  Convex guidelines §96. This is the documented remedy for the exact `smoke.ts` pattern below.
- `smoke.ts` (35/37/39/93/95/97) still carries the identical self-referential workflow
  circular pattern — **still deferred** (pre-existing, out of 02-05's scope). The proven
  fix is now in-repo (see `llm.ts`): annotate the workflow handler return types. A cleanup
  plan can apply it plus the `vite/client` reference and the whole gate goes green.
