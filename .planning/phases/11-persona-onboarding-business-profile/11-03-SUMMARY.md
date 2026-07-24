---
phase: 11-persona-onboarding-business-profile
plan: 03
subsystem: ui
tags: [onboarding, react, convex, next, persona, vault, first-run-gate]

# Dependency graph
requires:
  - phase: 11-persona-onboarding-business-profile (plan 02)
    provides: api.onboarding.status / extractProfile / commitProfile thin adapter
  - phase: 11-persona-onboarding-business-profile (plan 01)
    provides: UNGATED business-profile skill (persona confirm SC#1, structured Lean-core fields)
  - phase: 10-vault-grounding
    provides: vault Dropzone/vaultUpload + startIngest embedding path reused for file intake
provides:
  - Forced-but-resumable first-run onboarding gate in the client AppShell (<Authenticated>, not middleware)
  - Conversational onboarding page — three intake modalities (paste/file/voice), editable pre-filled review card, one-tap persona confirm, commit that embeds + releases the cockpit
  - Sparse-start commit gate — idea-stage users onboard with only oneLineDescription + confirmed persona
affects: [12-evaluation-engine, 13-proactive-review, 25-private-beta-productionization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-run gate as a client useQuery(api.onboarding.status) redirect inside <Authenticated> — never middleware.ts (avoids the documented eternal-spinner)"
    - "Onboarding reuses the cockpit chat SURFACE but routes extraction through the UNGATED business-profile skill (keeps onboarding tweaks out of the EVAL_GATE cycle)"
    - "Async file intake: poll vaultDocuments until text is populated before calling extractProfile"

key-files:
  created:
    - apps/web/app/(app)/dashboard/onboarding/page.tsx
  modified:
    - apps/web/app/(app)/layout.tsx
    - packages/core/src/businessProfile.ts
    - packages/core/src/businessProfile.test.ts
    - packages/backend/convex/onboarding.test.ts
    - docs/playbooks/onboarding.md

key-decisions:
  - "Gate lives in the client <Authenticated> shell (layout.tsx), not middleware.ts — middleware has no DB access (RESEARCH Pitfall 4)"
  - "Onboarding reuses the conversational chat surface but runs extraction through the separate UNGATED business-profile skill, not the gated cockpit-agent — teaching cockpit-agent onboarding would publish an unactivatable EVAL_GATE candidate and endanger the ~25 golden fixtures"
  - "Sparse-start: an idea-stage user (vague idea, no business yet) commits with only oneLineDescription + a confirmed persona; name/stage/offering/targetCustomer are optional and enriched later"

patterns-established:
  - "Resumability signal = existence of the committed business_profile vault doc (the gate reads the same status query)"
  - "Persona is always surfaced for one-tap confirm/correct — never silently assumed (SC#1)"

requirements-completed: [ONBD-01, ONBD-02]

# Metrics
duration: 76min
completed: 2026-07-24
---

# Phase 11 Plan 03: Conversational Onboarding & First-Run Gate Summary

**Forced-but-resumable first-run onboarding — a client AppShell gate plus a conversational page (paste/file/voice intake → editable pre-filled review card + one-tap persona confirm → commit that embeds the profile and releases the cockpit), shipped with a sparse-start commit gate that admits idea-stage users.**

## Performance

- **Duration:** ~76 min
- **Started:** 2026-07-24T19:05:13+03:00
- **Completed:** 2026-07-24T20:21:48+03:00
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint, approved)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- First-run gate in the client `<Authenticated>` AppShell: `useQuery(api.onboarding.status)` redirects `needsOnboarding` tenants to `/dashboard/onboarding` and blocks the cockpit until a profile is committed — no middleware, no eternal-spinner.
- Conversational onboarding page with all three ONBD-02 intake modalities (pasted text, async file upload via vault Dropzone/vaultUpload with a waiting state until `text` is populated, and the Phase 6 spoken brief), an editable pre-filled Lean-core review card (not blank re-entry), and the "Looks like you're a [persona] — confirm or change" one-tap control (SC#1).
- Commit path embeds the profile as a vault doc and releases the gate; resumability restores mid-onboarding progress across a reload.
- End-to-end flow human-verified (Task 3 approved).

## Task Commits

1. **Task 1: First-run gate in the client AppShell** — `c11f6d2` (feat)
2. **Task 2: Conversational onboarding page — intake, review card, commit** — `9f11082` (feat)
3. **Task 3: Human-verify the forced-but-resumable onboarding flow** — checkpoint, approved by human (no code commit)

**Post-task enhancement:** `46a86c3` (fix) — sparse-start onboarding (see Deviations).

## Files Created/Modified
- `apps/web/app/(app)/dashboard/onboarding/page.tsx` - Conversational onboarding: three intake modalities → extractProfile → editable review card + persona confirm → commitProfile
- `apps/web/app/(app)/layout.tsx` - First-run gate: `useQuery(api.onboarding.status)` redirect inside `<Authenticated>`
- `packages/core/src/businessProfile.ts` - REQUIRED_STRINGS relaxed to `[oneLineDescription]`; serializeProfile empty-name fallback (sparse-start)
- `packages/core/src/businessProfile.test.ts` - sparse idea-stage profile valid; empty oneLineDescription rejected
- `packages/backend/convex/onboarding.test.ts` - backend mirror of the sparse-start rule
- `docs/playbooks/onboarding.md` - UI flow documented; sparse-start invariant added; `Last verified` bumped

## Decisions Made
- Gate in the client `<Authenticated>` shell, not middleware.ts (no DB access there — RESEARCH Pitfall 4).
- Onboarding reuses the conversational chat surface but runs extraction through the UNGATED `business-profile` skill rather than the gated `cockpit-agent` tool-loop — keeps every onboarding tweak out of the EVAL_GATE cycle and off the ~25 golden fixtures (11-RESEARCH Pitfall 1, Open Q1).
- Sparse-start commit gate (see Deviations) — a deliberate domain-correctness relaxation surfaced during human verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sparse-start onboarding — idea-stage users trapped on the gate**
- **Found during:** Task 3 (human-verify)
- **Issue:** An idea-stage user (a vague idea, no business yet) had no name/offering/targetCustomer, so `validateProfile`'s 5-field `REQUIRED_STRINGS` plus the UI `requiredFilled` mirror rejected the commit — `commitProfile` threw `INVALID_PROFILE` and the forced gate never released. ONBD-02 explicitly scopes "business/idea", so the strict 5-field gate contradicted the requirement.
- **Fix:** `REQUIRED_STRINGS` reduced to `[oneLineDescription]` (persona still validated separately); name/stage/offering/targetCustomer made optional (empty is valid, enriched later); `serializeProfile` falls back to a "Business profile" heading when name is empty; onboarding page `requiredFilled` mirror + `(optional)` field labels + hint aligned to the domain rule.
- **Files modified:** packages/core/src/businessProfile.ts, packages/core/src/businessProfile.test.ts, packages/backend/convex/onboarding.test.ts, apps/web/app/(app)/dashboard/onboarding/page.tsx, docs/playbooks/onboarding.md
- **Verification:** core 165 tests green; backend onboarding + redaction 14 green; web typecheck clean; playbook check passes. The onboarding flow was human-verified WITH this change in place.
- **Committed in:** `46a86c3` (separate follow-up commit on top of Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug — requirement/gate mismatch).
**Impact on plan:** Necessary for ONBD-02 correctness (idea-stage users must be able to onboard). No scope creep — same gate, relaxed to honor the documented domain scope. The plan's three success criteria all hold, now including idea-stage users.

## Issues Encountered
None beyond the sparse-start gate mismatch documented above (found and closed during human verification).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- A committed business_profile now exists in the vault for every onboarded tenant — the grounding substrate Phase 12 (evaluation engine) and Phase 13 (proactive review) build on.
- Sparse idea-stage profiles are intentionally thin; later capabilities enrich name/offering/targetCustomer rather than block on them.
- Open S1/S4 concern still stands: grounded business-profile prose must stay out of exportable/WORM tables until the names-in-prose PII ceiling is resolved.

## Self-Check: PASSED

- FOUND: apps/web/app/(app)/dashboard/onboarding/page.tsx
- FOUND: 11-03-SUMMARY.md
- FOUND commits: c11f6d2, 9f11082, 46a86c3

---
*Phase: 11-persona-onboarding-business-profile*
*Completed: 2026-07-24*
