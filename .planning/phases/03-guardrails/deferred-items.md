# Deferred Items — Phase 03 Guardrails

## Pre-existing backend test-file typecheck errors (out of scope for 03-02)

`pnpm --filter @pikar/backend typecheck` (`tsc --noEmit`) reports 14 errors, ALL in
test files, none in production code. Pre-existing before Phase 3 (unrelated to
action-cache / schema work):

- `import.meta.glob` not typed (`Property 'glob' does not exist on type 'ImportMeta'`)
  in audit.test.ts, deadLetters.test.ts, importGuard.test.ts, tenant.test.ts,
  worm.test.ts — these static-scan tests use Vite/Vitest's `import.meta.glob`, but the
  backend tsconfig has `types: ["node"]` only (no `vite/client`), and it `include`s
  `convex/**/*.ts` (test files included).
- `'row'/'Object' is possibly 'undefined'` in audit.test.ts, tenant.test.ts —
  convex-test `.first()` / query results not null-guarded in test assertions.

Root cause: backend tsconfig type-checks test files with node-only types. Fix options
(a follow-up, likely a tsconfig/vitest-types change — arguably repo-wide, not this plan):
add `vite/client` to backend test typing or exclude `*.test.ts` from the tsc include.
Vitest itself runs green (it provides the glob at runtime); only tsc is red.

Production convex code type-checks clean.

## Pre-existing audit.test.ts failure (out of scope for 03-02)

`convex/audit.test.ts` fails with `Component "auditCounts" is not registered. Call
"t.registerComponent"`. Confirmed pre-existing: reproduces against the pre-execution
`convex.config.ts` (no action-cache) and with 03-02's schema/pipeline edits stashed.
Root cause: `audit.ts` calls `auditCounts.insert` (Phase-2 aggregate, OPSG-01), but the
convex-test harness in this test builds `convexTest(schema, modules)` without
`t.registerComponent("auditCounts", ...)`. Fix belongs with the aggregate test setup
(a Phase-2 test-harness gap), not this schema/rails plan. Backend suite: 40 passing,
this 1 pre-existing failure.

## `pnpm -r typecheck` turbo runner quirk on @pikar/audit (out of scope for 03-01)

`pnpm -r typecheck` (which runs `turbo run typecheck`) fails: the `@pikar/audit` task
prints tsc help text and exits 1. `pnpm --filter @pikar/audit typecheck` passes clean in
isolation, as do @pikar/pii, @pikar/cost, and @pikar/core. The failure only surfaces under
`turbo run typecheck` (TypeScript 7.0.2 / tsgo) — a turbo→tsc argument-passing quirk, not a
type error. `@pikar/audit` was untouched by 03-01. Investigate the turbo `typecheck` task
wiring when convenient.
