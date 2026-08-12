---
phase: 19-contacts-crm-follow-ups
plan: 03
subsystem: ui
tags: [can-spam, postal-address, tenant-profile, onboarding, profile-page, convex, react]
requires:
  - phase: 19-01
    provides: "tenantProfiles.postalAddress on the schema + renderFooter's blank-address refusal"
  - phase: 15.1
    provides: "tenantProfile.saveFacts / get and the ShapePanel enrichment surface"
provides:
  - "postalAddress on the tenantProfile write boundary (trimmed, 500-char ceiling, blank-after-trim refused)"
  - "postalAddress readable from both tenantProfile.get (UI) and tenantProfile.forTenant (identity-less send path)"
  - "a 'Postal address' textarea on /dashboard/profile with the write boundary's refusals rendered inline"
  - "the pinned proof that the field is NOT an onboarding slot (byte-identical completeness with and without it)"
affects:
  - "19-05 (send-path refusal on a missing postal address — this is the surface it points at)"
  - "19-02 (contacts.footerFor reads profile.postalAddress)"
tech-stack:
  added: []
  patterns:
    - "validate-at-the-write-boundary: one validator in the owning Convex module, nowhere else"
    - "enrichment field ≠ onboarding slot, pinned by a byte-identical-completeness assertion"
    - "ConvexError code → user-language string map, rendered through the panel's existing inline error affordance"
key-files:
  created: []
  modified:
    - packages/backend/convex/tenantProfile.ts
    - packages/backend/convex/tenantProfile.test.ts
    - apps/web/app/(app)/dashboard/profile/ShapePanel.tsx
    - docs/playbooks/onboarding.md
decisions:
  - "postalAddress is free text, not a parsed/structured address — CAN-SPAM wants a valid physical address, not a country/state enum"
  - "blank-after-trim is REFUSED rather than stored: a footer rendering an empty address looks compliant and is not"
  - "the ceiling (500) is a ceiling, not a truncation — a silently-cut address is also a wrong one"
  - "the UI SENDS a blanked address rather than swallowing it to undefined, so the refusal is the honest answer; there is deliberately no delete-my-address path"
  - "no page.tsx change: ShapePanel is already mounted on the profile tab shell, so the plan's second listed file was not needed"
  - "the field lives in ShapePanel (the panel that already owns saveFacts) — no new panel file for one field"
patterns-established:
  - "Enrichment vs gate: a field can be required by the SEND path while provably absent from onboarding completeness"
requirements-completed: []  # PIPE-01 deliberately NOT ticked — this plan is 1 of 10 contributing to it,
# and the lane's standing rule is that PIPE-01/ACTN-05 stay Pending until the phase closes (the
# 17.1-01 early-flip trap). `requirements mark-complete PIPE-01` was NOT run.
requirements-contributed: [PIPE-01]
metrics:
  duration: ~20 min
  tasks: 2
  files: 4
  completed: 2026-08-09
---

# Phase 19 Plan 03: The CAN-SPAM postal address Summary

**`postalAddress` on the `tenantProfile` write boundary (trimmed, 500-char ceiling, blank-after-trim refused) plus the "Postal address" textarea on `/dashboard/profile` that gives 19-05's send refusal something to point at — provably without becoming an onboarding gate.**

## Performance

- **Duration:** ~20 min (task 1 pre-committed earlier in the phase, task 2 this run)
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `saveFacts` accepts `postalAddress`, stores it trimmed, and refuses blank-after-trim (`EMPTY_POSTAL_ADDRESS`) and over-ceiling (`POSTAL_ADDRESS_TOO_LONG`) **before any DB work**, so a refusal takes the whole write with it rather than half-applying the facts.
- Both readers already surface it: `get` (the profile page) and `forTenant` (the identity-less send-path read `contacts.footerFor` uses). One reader per plane, no third one added.
- 7 tests in `tenantProfile.test.ts`, including the load-bearing one: with identical partial facts, tenant A (no address) and tenant B (address set) produce a **byte-identical** `missingSlots` and the same `canComplete` — with a non-vacuity assertion on both sides so "identical" can never mean "both empty".
- `/dashboard/profile` → Business shape now ends with a **Postal address** textarea (3 rows, `maxLength=500`, `aria-describedby` on its helper line) reading *"Required by law in the footer of every email you send. Sending is blocked until this is set."*
- Refusals render **inline** through the panel's existing `factsError` paragraph — no `window.alert`, no `window.confirm` anywhere in this tree (a browser modal blocks the Playwright specs).
- `docs/playbooks/onboarding.md` gained an invariant bullet naming the pinning test and pointing at the SEND path as the real enforcement point.

## Task Commits

1. **Task 1: postalAddress on the tenantProfile write boundary** — `5a72ac4` (feat) — **pre-committed before this executor run**; verified in place, not redone.
2. **Task 2: The profile field, and the onboarding playbook bump** — `bcf825e` (feat)

_Task 1 was authored TDD (tests + implementation landed in one commit rather than a RED/GREEN pair)._

## Files Created/Modified

- `packages/backend/convex/tenantProfile.ts` — `POSTAL_ADDRESS_MAX = 500`, `validPostalAddress()`, `saveFacts` arg widened from the schema validator, the "never an onboarding slot" comment and the `ponytail:` free-text-not-parsed note.
- `packages/backend/convex/tenantProfile.test.ts` — 7 tests: verbatim round-trip through `get` **and** `forTenant`, whitespace trim, blank refusal + fail-closed on the sibling facts, ceiling refusal + exactly-at-limit accepted, absent-arg doesn't clear, byte-identical completeness, cross-tenant isolation with both partitions non-empty.
- `apps/web/app/(app)/dashboard/profile/ShapePanel.tsx` — the textarea, its seed from `tierRow.postalAddress`, `readCode()`, the `POSTAL_REFUSAL` code→copy map, and the send rule for a blanked address.
- `docs/playbooks/onboarding.md` — invariant bullet + extended `Last verified` note (CRLF preserved; anchors asserted unique before writing).

## Decisions Made

- **Blanking a stored address is SENT, not swallowed.** The UI sends `undefined` only when the box is empty *and* nothing is stored (the user simply hasn't filled it in). If an address exists and the user clears the box, the string goes to the server and comes back refused inline. The alternative — silently keeping the old value — tells the user they deleted something they didn't. There is deliberately no delete-my-address path.
- **`page.tsx` untouched.** The plan listed it, but `ShapePanel` is already mounted by the tab shell and owns `saveFacts`; adding the field there needed no page change. Plan's own escape hatch ("place it in whichever panel already owns free-text business facts") applied.
- **Client cap is a courtesy, not the boundary.** `maxLength={500}` mirrors `POSTAL_ADDRESS_MAX` with a comment saying so; the real refusal is server-side and tested. Exporting the constant across the package boundary for one number was not worth the coupling.

## Deviations from Plan

None requiring a deviation rule. Two planned-file adjustments, both anticipated by the plan text:

- `apps/web/app/(app)/dashboard/profile/page.tsx` was **not** modified (see Decisions).
- The `Last verified` line of `docs/playbooks/onboarding.md` had already been bumped for this change by a concurrent lane (`f370be0`); this plan extended that note and added the invariant bullet rather than re-bumping the date.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** none — fewer files than planned, same guarantees.

## Issues Encountered

- `node scripts/check-playbooks.mjs` exits 0 but reports a `block` decision for `docs/playbooks/contacts-crm.md` against `packages/backend/convex/contacts.ts` — an **untracked file belonging to the concurrently-executing 19-02 lane**, not this plan. Out of scope by the executor's scope boundary; that lane owns the bump.

## Verification

- `pnpm --filter @pikar/web typecheck` — green
- `pnpm --filter @pikar/web build` — green (all 22 routes, `/dashboard/profile` included)
- `pnpm --filter @pikar/core test` — 686 passed / 32 files, including the `describe("no tier control")` source scan that reads the whole profile route folder (so it reads the edited `ShapePanel.tsx`) and the `BEHAVIOR_PRESETS` positive row
- `grep -rn "postalAddress" packages/backend/convex/onboarding.ts` — **no hit**, as required
- `packages/backend/convex/tenantProfile.test.ts` — 7 postalAddress tests, green at task-1 commit time

## Success Criteria

- [x] A postal address can be typed on `/dashboard/profile` and read back verbatim
- [x] An empty-after-trim address is refused at the write boundary
- [x] No onboarding gate changed — completeness provably identical with and without it
- [x] `onboarding.md` states the field is enrichment-only and names the send-path enforcement point

## User Setup Required

None.

## Next Phase Readiness

19-05 can now refuse an approve/send on a missing postal address and point the user at
`/dashboard/profile?tab=shape`. 19-02's `contacts.footerFor` already reads
`profile.postalAddress` through `forTenant` and returns `null` when it is blank — the two halves
of SC#6 meet with no further wiring.

## Self-Check: PASSED

- `packages/backend/convex/tenantProfile.ts` — FOUND
- `packages/backend/convex/tenantProfile.test.ts` — FOUND
- `apps/web/app/(app)/dashboard/profile/ShapePanel.tsx` — FOUND
- `docs/playbooks/onboarding.md` — FOUND
- commit `5a72ac4` — FOUND
- commit `bcf825e` — FOUND

---
*Phase: 19-contacts-crm-follow-ups*
*Completed: 2026-08-09*
</content>
</invoke>
