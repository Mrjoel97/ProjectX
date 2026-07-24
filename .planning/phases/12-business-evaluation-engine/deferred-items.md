# Phase 12 — Deferred / Out-of-Scope Items

## Pre-existing failures observed during 12-02 execution (NOT caused by 12-02)

- **`convex/audit.test.ts > "audit.log inserts exactly one row that round-trips"` fails**
  (mutation error around `auditCounts.insert`). Reproduced with 12-02's `skills.ts` change
  stashed out — pre-dates this plan. 12-02 touches only skill-registry files. Root-cause and
  fix belong to whoever owns the audit subsystem / the plan that introduced it (likely 12-01 or
  earlier). Not fixed here (scope boundary — unrelated to the current task's changes).

- **`pnpm --filter @pikar/backend typecheck` is red (~52 errors)** — all in `*.test.ts` files
  (`import.meta.glob` type gap — a documented shared gap across `convex/*.test.ts`; `WorkflowId`
  string assignments in `vault.test.ts`; `mintClientSecret` drift in `voiceToken.test.ts`).
  Production `skills.ts` compiles clean (0 errors). Reproduced with 12-02 stashed — pre-existing.
