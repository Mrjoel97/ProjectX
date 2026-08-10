---
phase: 19-contacts-crm-follow-ups
plan: 13
subsystem: contacts-crm
tags: [convex, consent, tenant-isolation, compliance, gap-closure]

requires:
  - phase: 19-02
    provides: tenant-scoped contacts and durable consent fields
  - phase: 19-verification
    provides: SC#4 write-only consent-record gap finding
provides:
  - bounded public consentRecord query over one tenant-owned contact
  - exact consent wording/context reproduction tests through the public API
  - Phase 19 re-verification at 8/8 code truths with human sign-off still explicit
affects: [contacts-crm, phase-19-verification, owner-uat]

tech-stack:
  added: []
  patterns:
    - one-id tenantQuery for content-plane compliance records
    - indistinguishable missing/foreign refusal with explicit null absence semantics
    - verification evidence separated from owner judgement

key-files:
  created:
    - .planning/phases/19-contacts-crm-follow-ups/19-13-PLAN.md
    - .planning/phases/19-contacts-crm-follow-ups/19-13-SUMMARY.md
    - .planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md
  modified:
    - packages/backend/convex/contacts.ts
    - packages/backend/convex/contacts.test.ts
    - docs/playbooks/contacts-crm.md

key-decisions:
  - "Consent reproduction is id-at-a-time through ctx.db.get; a bulk export remains an explicit future product surface."
  - "No consent returns null, while unrecorded wording/context fields return explicit nulls rather than invented prose."
  - "8/8 code truths do not self-approve the separate owner browser UAT or requirement checkboxes."

patterns-established:
  - "Content-plane compliance reads stay out of the refs-only audit plane."
  - "A real foreign id proves tenant isolation at the handler rather than vacuously at validation."

requirements-completed: []

duration: 30 min
completed: 2026-08-10
---

# Phase 19 Plan 13: Consent Record Gap Closure Summary

**A one-contact `tenantQuery` now reproduces the exact stored consent wording, timestamp, source,
and capture context without widening the CRM into a bulk export or leaking content into audit.**

## Performance

- **Duration:** 30 min
- **Completed:** 2026-08-10
- **Tasks:** 2
- **Files changed:** 6

## Accomplishments

- Added `api.contacts.consentRecord`, bounded to one `ctx.db.get` and followed by an authenticated
  tenant comparison using one indistinguishable `CONTACT_NOT_FOUND` refusal.
- Proved exact wording/context reproduction, timestamp/source fidelity, no-consent and absent-field
  null semantics, foreign-tenant and anonymous refusal, audit absence, and public-surface coverage.
- Updated the contacts CRM playbook with the request-path invariant, point-read ceiling, and
  whole-book export upgrade path.
- Re-verified Phase 19 at 8/8 code truths while preserving owner UAT/sign-off and real Gmail inbox
  delivery as human evidence still owed. REQUIREMENTS.md was deliberately untouched.

## Task Commits

1. **Task 1: Bounded tenant-scoped consent record request path** — `6a2d23e`
2. **Task 2: Document the request path and re-verify the phase gap** — `306bc82`

## Files Created/Modified

- `packages/backend/convex/contacts.ts` — exports the typed, one-contact `consentRecord` query.
- `packages/backend/convex/contacts.test.ts` — exercises the public query across exact reproduction,
  auth, isolation, absence, audit-safety, and export-set cases.
- `docs/playbooks/contacts-crm.md` — records the shipped reader, enforcement, ceiling, and upgrade
  path.
- `.planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md` — closes the SC#4 code gap and
  retains the human gates.
- `.planning/phases/19-contacts-crm-follow-ups/19-13-PLAN.md` — executable gap-closure plan, checked
  with zero plan-checker issues.

## Decisions Made

- Used a point lookup instead of adding a bulk export. A regulator request is per person, and the
  wider surface can compose existing pagination with this projection if it is actually required.
- Returned `null` for no consent and explicit null content fields for unrecorded details; neither
  case is an error or an invitation to synthesize display prose.
- Kept the query audit-free because wording/context are content plane; the existing audit key-set
  remains refs/ids/counts only.

## Verification

- `pnpm --filter @pikar/backend test contacts` — **PASS**, 1 file / 64 tests.
- `.\\node_modules\\.bin\\biome.CMD check packages/backend/convex/contacts.ts packages/backend/convex/contacts.test.ts`
  — **PASS**, 2 files clean.
- `git diff --check` over all Phase 19-owned plan paths — **PASS**.
- Plan checker — **PASS**, zero issues.
- `pnpm --filter @pikar/backend typecheck` — **qualified shared-tree failure**: the consent change
  emitted no diagnostic; the command exits 2 only on the existing Finance-lane
  `convex/cash.ts:132,150` TS2739 errors (missing `origin`, `actor`, `basis`).
- `node scripts/check-playbooks.mjs` — **qualified shared-tree block**: `contacts-crm.md` is updated,
  but the gate also demands `dashboard-pages.md`/`cockpit.md` for the unrelated staged deletion of
  `apps/web/e2e/pipeline.spec.ts` and the pre-existing `gmail.ts` edit. Those lanes were not
  absorbed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided Node heap contention during verification**
- **Found during:** Task 1 verification
- **Issue:** Running the focused Vitest command and backend `tsc` concurrently exhausted Node's
  default heap (exit 134).
- **Fix:** Re-ran them sequentially and gave only `tsc` a 4 GB heap.
- **Result:** The focused suite passed 64/64; `tsc` reached stable diagnostics and reported only the
  unrelated Cash-lane errors above.

### Out-of-Scope Findings

- `packages/backend/convex/cash.ts` remains the sole backend typecheck blocker and belongs to the
  concurrent Finance lane.
- The repository-wide playbook gate remains blocked by the unrelated Pipeline spec deletion and
  Gmail comment edit; this plan changed neither file nor their owning playbooks.

## Authentication Gates

None.

## Remaining Human Verification

- Owner sign-off on the seven UAT screenshots: Pipeline and unsubscribe BRAND conformance,
  withheld-recipient information tone, and the three send-refusal messages.
- After that sign-off, the owner may tick ACTN-05 and PIPE-01 in REQUIREMENTS.md.
- A real Gmail delivery must still demonstrate that the CAN-SPAM footer and working unsubscribe
  link arrive in an inbox.

## Next Phase Readiness

The SC#4 code gap is closed. Phase 19 remains at `human_needed` until owner UAT/sign-off; no further
code work is required for this verification finding.

## Self-Check: PASSED

- All six claimed plan artifacts exist.
- Task commits `6a2d23e` and `306bc82` exist in git history.
- The unrelated staged Pipeline spec deletion remains staged and was not included.
- A concurrent post-commit edit to `contacts-crm.md` remains in the working tree; it was not
  reverted or folded into this plan's metadata commit.
