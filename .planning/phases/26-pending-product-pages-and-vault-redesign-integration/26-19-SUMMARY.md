---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 19
subsystem: dashboard-pages
tags: [home-01, command-center, priority-order, health-lattice, briefings]
requirements-completed: [HOME-01 backend]
completed: 2026-08-23
---

# Plan 26-19: the deterministic Command Center backend

`packages/core/src/home.ts` owns the ONE definition of "what should I do next" and "is anything
broken". `convex/home.ts` and `briefings.latestForTenant` are thin adapters that gather narrow
facts and delegate every decision to it (CLAUDE.md §1).

## What was built

- **`packages/core/src/home.ts`** (pure): `HOME_PRIORITY_ORDER` (connection-failure >
  unresolved-dead-letters > stale-approval > scheduled-risk > diagnostic-blocker >
  binding-constraint > workspace), `HOME_PRIORITY_COPY`, `HOME_SIGNAL_LABEL`, `SIGNAL_STATE_WORD`,
  `HOME_UNCERTAIN_COPY`, `recommendNextMove`, `rollUpHealth`. Re-exported from `index.ts`.
- **`convex/home.ts`**: `home.summary` and `home.health` as TWO independent `tenantQuery`
  subscriptions, so one failing source cannot erase the others. Composes the EXISTING
  `approvals.summary`, `content.summary`, `deadLetters.newCount`, `gmailAuth.gmailStatus`,
  `contacts.pipelineTiles` and the evaluations/blueprint reads — no new source query was written.
- **`convex/briefings.ts`**: `latestForTenant`, on the existing `by_tenant_createdAt` index. No
  schema change. Bounded to 5 items, workspace links only.

## The invariants, and the defects that produced them

Four adversarial reviewers ran against this plan and raised 19 defects. The three that changed the
design:

1. **`scheduled-risk` failed OPEN.** It read one ~50-row page of `approvals.listScheduled`,
   discarded the page's own `nextCursor`, and reported `ok` — a positive health claim — for a
   TRUNCATED read, so a risky send past the cap sat under a "healthy" badge. Now a capped page
   with no risk found returns `unknown`, and drops count/at so a floor cannot render as evidence.
   **The general rule: a bounded read may report `triggered`, but may only report `ok` when it can
   see the whole set.**
2. **`recommendNextMove` produced a false all-clear.** `rollUpHealth` was correctly fail-closed,
   but the recommendation scanned only for `triggered` and otherwise fell through to the
   `workspace` fallback, whose copy is an all-clear. A tenant whose sources FAILED saw health
   "Unknown" and "Nothing needs your decision right now" simultaneously. Two fail-closed rules had
   drifted because only one was written down. `HomeRecommendation` now carries a REQUIRED
   `certain: boolean` (required, not `?:` — an optional field can never be mutation-checked),
   false exactly when `rollUpHealth` says unknown.
3. **Model prose rode into a projection unlabelled.** `latestForTenant` shipped `synopsis` with
   nothing distinguishing it from the code-owned facts beside it — this repo's documented
   provenance-laundering class. It now carries a code-owned `synopsisOrigin: "model"` literal and
   renders under an explicit "Pikar summary" attribution.

Six more were VACUOUS TESTS: branches (`connection-failure` triggered, stale-approval's threshold,
the whole `scheduled-risk` gatherer, `diagnostic-blocker`'s `gaps` verdict, `binding-constraint`
triggered, the approvals cap bit) that could be deleted with the suite still green. Real fixtures
now execute each one, verified by mutation.

## Copy correction

`connection-failure` reads **"Connect your mailbox"**, not "Reconnect". Its only evidence is
`gmailStatus.connected`, which is `!!row`, so a tenant who NEVER connected is indistinguishable
from one whose connection broke — "reconnect"/"restored" asserted a connection that may never have
existed. Splitting the code needs a "was connected, now broken" probe `gmailAuth` does not have.

## Verification

- `packages/core`: 41 files, **1123/1123**.
- `packages/backend`: 96 files, **2369/2369**.
- `pnpm --filter @pikar/core typecheck`, `--filter @pikar/backend typecheck`: both clean.
- Live: all three functions confirmed on the deployment via `npx convex function-spec | grep home`,
  and exercised by the 8/8 browser gate in 26-20.

## Known gap, carried to 26-20

`connection-failure` ranks FIRST, which sits against the shipped cockpit invariant that the
dashboard never leads with the email channel. Implemented as the plan locks it; recorded for an
owner ruling.
