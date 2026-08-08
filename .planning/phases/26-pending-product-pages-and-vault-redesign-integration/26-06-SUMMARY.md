---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 06
subsystem: backend
tags: [finance, spend-ledger, append-only, idempotence, coverage, reconciliation]

requires:
  - phase: 26-02
    provides: frozen additive spendEvents/spendCoverage schema and indexes
provides:
  - Append-only, correlation-idempotent spend movement writer (internal.spendLedger.record)
  - Durable per-tenant coverage start that makes a zero honest
  - Bounded tenant-scoped window/rail reads for Finance projections
  - Pure movement validation and window aggregation with an explicit Unknown branch
affects: [26-07, 26-08, 26-09, finance, guardrails, media]

tech-stack:
  added: []
  patterns:
    - insert-if-absent correlation guard with a composite identity
    - insert-only module protected by a source scan (the audit-log idiom)

key-files:
  created:
    - packages/core/src/spend.ts
    - packages/core/src/spend.test.ts
    - packages/backend/convex/spendLedger.ts
    - packages/backend/convex/spendLedger.test.ts
    - .planning/phases/26-pending-product-pages-and-vault-redesign-integration/26-06-SUMMARY.md
  modified:
    - packages/core/src/index.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/dashboard-pages.md
    - docs/playbooks/watch.json
    - packages/core/src/vaultSurface.test.ts
    - docs/playbooks/vault.md

key-decisions:
  - "Replay identity is (tenantId, correlationId, phase), NOT correlationId alone. A reservation and its later actual charge deliberately share one correlation — that shared key is what makes them reconcilable — so a correlation-only guard would swallow the actual as a duplicate of the reserve and lose the money. `by_correlation` is not tenant-scoped, so the tenant comparison is part of the identity check rather than an assumption."
  - "First write wins: a replay returns the stored id and IGNORES the replayed amount. A retry reporting a different number is an upstream bug, and letting it through would rewrite recorded money. Drift is corrected by appending an `adjustment` or `refunded` movement."
  - "Direction lives in the phase, never in the sign. Every amountCents is a positive safe integer; `adjustment` means we owe more and `refunded` means money came back, so no consumer has to guess whether a negative is a credit or a bug."
  - "Validation runs BEFORE ensureCoverage, so a rejected movement leaves nothing behind — not even a coverage row it did not earn. A coverage row written by a failed insert would flip a tenant from honest Unknown to a false 'we were watching, and it was zero'."
  - "Aggregation returns Unknown (not-started / window-precedes-coverage) rather than 0 for an uninstrumented window. A zero that means 'we were not watching' is indistinguishable on a Finance page from a zero that means 'nothing was spent', and the gap can never be backfilled."
  - "An adjustment folds into the `actual` total so landed cost is always the true charged amount; unlanded is clamped at zero because a landing larger than its reservation is a reconciliation signal, not a negative balance to display."
  - "model/kind/correlationId must match a ref-safe token with no whitespace. This is a structural CLAUDE.md §4 guard at the trust boundary: prose cannot enter a table that has no edit path."

patterns-established:
  - "An idempotence key is composed from everything that must be able to coexist. Dropping either component here is a silent data bug caught by a DIFFERENT test — that divergence is the evidence the tests are not vacuous."
  - "A source scan for db.patch/db.replace/db.delete makes 'insert-only' a build-time property, paired with a length assertion so an empty glob cannot pass the negative check vacuously."
  - "When a UI change moves a guarded spelling, gate it with the package that OWNS the scan — a scan living in another package is invisible to that package's own gate."

requirements-completed: [FIN-01]

duration: 55 min
completed: 2026-08-08
---

# Phase 26 Plan 06: Spend Ledger Core Summary

Built the durable accounting seam FIN-01 needs before any rail is instrumented: an append-only,
correlation-idempotent `spendEvents` writer with a durable per-tenant coverage start, plus the pure
movement arithmetic that returns **Unknown rather than a fabricated `$0`** for a window that
precedes coverage.

- **Tasks:** 2 of 2 complete.
- **Files:** 4 created, 6 modified.
- **Commits:** `9c9555b` (Task 1), `bda09e0` (Task 2), `8dd911b` (deviation).

## What was built

`packages/core/src/spend.ts` owns the closed rail/phase vocabulary, trust-boundary validation
(positive safe-integer cents, ref-safe tokens with no whitespace) and `aggregateSpend`, whose
`unknown` branch is the whole point of the module. `packages/backend/convex/spendLedger.ts` is the
thin adapter (CLAUDE.md §1): `record` (insert-if-absent on `(tenantId, correlationId, phase)`),
`startCoverage` (insert-if-absent, never moves forward), `coverage` and a capped, half-open,
tenant-scoped `listEvents`.

The limiter remains **enforcement** truth; this table is **reporting/reconciliation** truth. The
non-negotiable consequence, now recorded in `dashboard-pages.md`: Finance may hide its route and
owner controls, but it may never stop the instrumentation — an append-only history has no backfill,
so a dark window is a permanent hole.

## Verification

| Gate | Result |
|------|--------|
| `@pikar/core` spend tests | 12/12 |
| `@pikar/backend` spendLedger tests | 9/9 |
| `@pikar/backend` full suite | 1242/1242 |
| `@pikar/core` full suite | 640/640 (was 638/640 before the deviation below) |
| `@pikar/core` typecheck | clean |
| `@pikar/backend` typecheck | clean (the former 15-error baseline is now zero) |
| `node scripts/check-playbooks.mjs` | exit 0 |

**Mutation checks (non-vacuity).** Dropping `phase` from the correlation identity fails the
distinct-phases test; dropping `tenantId` fails the distinct-tenants test. Each mutation is caught
by a different test, and both were restored green.

## Deviations from Plan

**[Rule 1 - Bug] Two vault surface-scan assertions were red on the branch before this plan.**

- Found during: the full `@pikar/core` suite run for Task 1's verification.
- Issue: `packages/core/src/vaultSurface.test.ts` failed 2/14. The 15.4 Nord Edge redesign renamed
  the download anchor local `a` → `anchor`, and split the stale-digest affordance across two files
  (derivation in `FolderBreadcrumb`, the emphasis flip in `DigestRebuildControl`). Both product
  guarantees are intact — only the assertions were stale. It went unnoticed because the 15.4 gates
  ran `pnpm --filter @pikar/web test`, which never executes a scan that lives in `@pikar/core`.
- Fix: bound the download guard to the assignment target and value rather than the variable name;
  retargeted the stale-digest guard to what only a whole-surface scan can prove (staleness is
  derived; exactly one definition, mount and label; no dismissible banner), leaving the rendered
  flip to the behavioural `apps/web/.../VaultBrowseControls.test.ts` that already covers it — the
  same migration `preflightCopy.test.ts` made once `apps/web` had a runner. The banner assertion
  now strips comments first, because the only `localStorage` on the surface is inside the comment
  banning it.
- Files modified: `packages/core/src/vaultSurface.test.ts`, `docs/playbooks/vault.md`.
- Verification: 14/14, mutation-checked (constant-folding the derived flag and adding a second
  control each turn it red); full core suite 640/640.
- Commit: `8dd911b`.

**Total deviations:** 1 auto-fixed (1 × Rule 1). **Impact:** the `@pikar/core` gate is honest again,
which Phase 26's own phase-close command list depends on. No product behavior changed.

## Issues Encountered

None blocking. Two notes for the next session:

1. **This working tree is shared with other lanes.** A foreign commit (`edac4aa`, blueprint anatomy)
   and uncommitted foreign work (`BlueprintPanel.tsx`, `SegmentAnatomy.tsx`, `segmentCopy.ts`) landed
   mid-session. Nothing foreign was staged; never `git add -A` here.
2. **Nothing in this plan is live-verified, and that is by design.** No rail writes to the ledger
   yet — 26-07 (reasoning + ingest) and 26-08 (media) are the instrumentation plans, and no money
   has moved through this table.

## Next Phase Readiness

Ready for **26-07** and **26-08** (wave 5), which instrument the reasoning/ingest and media rails
against this writer. They own separate source and playbook files and can run in parallel. Both must
mint a **stable** `correlationId` per logical movement — a random per-attempt id silently defeats
replay suppression — and must call `startCoverage` (or `record`) before the rail's first paid call.
