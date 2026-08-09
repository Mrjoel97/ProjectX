---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 05
subsystem: web
tags: [approvals, nav-badge, owner-uat, brand-type-scale, cockpit-degrade]

requires:
  - phase: 26-03
    provides: guarded approvals transitions
  - phase: 26-04
    provides: bounded summary + lane projections shared by page and badge
provides:
  - Owner-approved connected Approvals route at /dashboard/approvals
  - Rail badge sharing the page's single approvals.summary subscription
  - Mockup-pinned type scale for inline-styled dashboard surfaces
affects: [26-18, 26-19, approvals, command-center, cockpit]

tech-stack:
  added: []
  patterns: [one subscription for page and badge, DeadLetterBadge loading/zero idiom]

key-files:
  created:
    - .planning/phases/26-pending-product-pages-and-vault-redesign-integration/26-05-SUMMARY.md
  modified:
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/(app)/dashboard/approvals/ApprovalsView.tsx
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpitThreadDegrade.test.ts
    - docs/playbooks/dashboard-pages.md
    - docs/playbooks/cockpit.md

key-decisions:
  - "Owner UAT was run against SEEDED plan rows. The approval covers UI states and guarded terminals ONLY — no Gmail send, Calendar insert or media generation was executed, so nothing here is external-provider evidence."
  - "ApprovalsBadge subscribes to the same approvals.summary as the page, so the rail count cannot disagree with the page it links to; undefined and 0 both render nothing, and a capped count renders N+ rather than an exact-looking number."
  - "ApprovalsView styles inline, so its type scale is pinned to docs/design/mockups/pending-pages.html and to the shipped .vault-header h1 clamp; an inline `font: inherit` must always be followed by an explicit fontSize."
  - "listThreadMessages degrades for an owned-but-nonexistent thread exactly as for an unowned one; the catch is narrow and matches BOTH the convex-test and live-runtime wordings of the same rejection."

patterns-established:
  - "A guard that answers authorization must not then assume existence; both 'nothing to show' cases return the identical empty page."
  - "When behaviour keys off an error message crossing a component boundary, pin the REAL message from a live capture — a harness-generated string proves the harness, not the product."
  - "Inline-styled surfaces quote the mockup's value or reuse a globals.css class; they never invent one."

requirements-completed: [APRV-01]
---

# 26-05: Connected Approvals route, owner-verified

## What shipped

The connected Approvals route was owner-verified on **2026-08-08** and its rail badge activated.

**Task 1** had already landed (`65b1159`, `d36ad42`). **Task 2** (blocking owner UAT) was run this
session against seeded plan rows in the owner's tenant — the tenant held 6 `collecting` plans and
**zero `proposed`**, so the page rendered empty and nothing on the checklist was exercisable until
`smoke:seedCockpitPlan` + `plans:patchPlan` seeded 7 proposed rows plus one each of
`delivering`/`done`/`canceled`. **Task 3** wired `ApprovalsBadge` to the same `approvals.summary`
the page uses.

## Defects found by the UAT (both fixed)

1. **Type scale.** Every axis of `ApprovalsView` had drifted off its own mockup: the headline at
   `clamp(2rem, 5vw, 3.6rem)` against the Vault's `clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)`; buttons
   inheriting the 1rem body size through `font: inherit` where `.btn` is a `0.86rem` pill; five bare
   `<h3>` falling through to the browser's `1.17em` because `globals.css` has no heading reset; a
   text stat at `1.65rem` instead of `.stat-value.is-text`. Touch targets stayed at `2.5rem`
   `minHeight` (BRAND §6) — the type shrank, the hit area did not.
2. **Cockpit crash on `?thread=`** — see `cockpit.md`. `listThreadMessages` guarded authorization
   then handed a non-agent threadId to a component validating `v.id("threads")`, so an OWNED
   thread threw where an unowned one degraded. Uncaught in the browser, it killed the whole cockpit
   page, reachable from a URL parameter. Triggered here by seeded threads; the gap was real.

**The first fix for (2) shipped green and did not work.** It matched only `convex-test`'s wording
of the rejection; the live runtime words it differently, so the real error hit the rethrow. Both
messages are now pinned verbatim in `cockpitThreadDegrade.test.ts`, with negative cases.

## Evidence

- `pnpm --filter @pikar/web test` — 59/59 across 6 files. Web typecheck 0 errors. Production build
  exit 0.
- Backend cockpit suites 174/174; `cockpitThreadDegrade.test.ts` 4/4 (fails against the pre-fix
  code with the exact browser error). Backend typecheck 0 errors.
- `node scripts/check-playbooks.mjs` exit 0.
- Owner UAT: approved 2026-08-08. Vault media preview separately live-verified by the owner.

## Owed, NOT closed by this plan

- **The authenticated Playwright spec (`e2e/approvals.spec.ts`) has never run.** `auth.setup.ts`
  only drives the password form and needs `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`; the owner's account
  is Google-only, and the spec's origin (`127.0.0.1:3111`) differs from the OAuth origin
  (`localhost:3000`), where the per-origin Convex Auth JWT lives. Owner UAT is human evidence, not
  the automated browser evidence the plan also asks for.
- **No live-provider result.** See the seeded-evidence boundary above.
- **Seeded UAT rows remain in the owner's tenant**, all carrying `uat-msjopxz0`.
