---
phase: 11-persona-onboarding-business-profile
plan: 04
subsystem: ui
tags: [onboarding, profile, react, convex, next, persona, vault, re-embed, grounding]

# Dependency graph
requires:
  - phase: 11-persona-onboarding-business-profile (plan 02)
    provides: api.onboarding.updateProfile (delete/replace old rag entry → re-startIngest) thin adapter
  - phase: 11-persona-onboarding-business-profile (plan 03)
    provides: conversational onboarding + committed business_profile vault doc; sparse-start commit gate
  - phase: 11-persona-onboarding-business-profile (plan 01)
    provides: serializeProfile + Lean-core BusinessProfile shape / Persona type
provides:
  - Dedicated editable business-profile page (/dashboard/profile) — loads the committed Lean-core fields, edits, and re-embeds on save so grounding stays current
  - api.onboarding.getProfile — the edit-form loader (committed vault doc parsed back to a structured BusinessProfile)
  - deserializeProfile — pure inverse of serializeProfile (the vault-doc markdown IS the record; parse is the read boundary)
  - Business Profile nav link in the rail foot (page reachability)
affects: [12-evaluation-engine, 13-proactive-review, 14-flagship-voice-doc, 25-private-beta-productionization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Round-trip persistence: no separate structured copy — the vault doc `text` is the record; getProfile parses it back via deserializeProfile (serializeProfile inverse), enforced by a round-trip test"
    - "Editable profile form reuses the Plan-03 review-card idiom + BRAND globals.css tokens — no new component library"
    - "Save routes through the existing api.onboarding.updateProfile (re-embed), not a bespoke rag write — old entry replaced, not duplicated"

key-files:
  created:
    - apps/web/app/(app)/dashboard/profile/page.tsx
  modified:
    - packages/backend/convex/onboarding.ts
    - packages/core/src/businessProfile.ts
    - packages/core/src/businessProfile.test.ts
    - apps/web/app/(app)/layout.tsx
    - docs/playbooks/onboarding.md

key-decisions:
  - "No separately-persisted structured profile — the committed vault-doc markdown is the single record; getProfile parses it back with deserializeProfile so the edit form pre-fills from what was actually stored (incl. docs committed by earlier plans)"
  - "deserializeProfile parses by the serializer's fixed markers (heading + `- **Label:**` bullets + `## Section` lists), not brittle line offsets; a round-trip test binds the two functions to change together"
  - "Sparse-start honored: only oneLineDescription is required; name/stage/offering/targetCustomer edit as optional enrichment fields — the profile page IS the enrichment surface idea-stage users fill in over time"

patterns-established:
  - "The profile page is the post-onboarding editability surface — the profile stays correctable/enrichable without re-onboarding (locked decision)"
  - "deserializeProfile ceiling (ponytail-marked): an empty name serializes to the literal 'Business profile' heading, so a business genuinely named that round-trips to an empty name — harmless on an enrichment form; upgrade path is structured JSON on the vault row"

requirements-completed: [ONBD-02]

# Metrics
duration: 40min
completed: 2026-07-24
---

# Phase 11 Plan 04: Editable Business-Profile Page Summary

**A dedicated /dashboard/profile page that loads the committed Lean-core fields (via `api.onboarding.getProfile` + the pure `deserializeProfile`), edits them as an enrichment form, and re-embeds through Plan 02's `updateProfile` on save so downstream grounding always reads the current profile — plus the rail nav link that made the page reachable.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-24
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint, approved) + 1 nav-wiring fix found during verify
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- **Editable profile page** (`apps/web/app/(app)/dashboard/profile/page.tsx`): loads the tenant's committed Lean-core fields, renders them as an editable form reusing the Plan-03 review-card idiom + BRAND `globals.css` tokens (no new component library), with saving/success/error states. Persona stays one of solopreneur|startup|sme.
- **`api.onboarding.getProfile`** — the edit-form loader `tenantQuery`: returns the committed profile as a STRUCTURED object parsed back from the vault doc's markdown, or `null` if none is committed. `currentProfileDoc` widened to accept `QueryCtx | MutationCtx`. Content-plane (§4): the returned object is the owning tenant's own profile content, tenant-scoped by `ctx.tenantId`, never logged.
- **`deserializeProfile`** (packages/core) — the pure inverse of `serializeProfile`, parsing by the serializer's fixed markers; a round-trip test enforces the two stay in lockstep. The vault-doc markdown is the single record, so this parse is the read boundary (works for profiles committed by earlier plans too).
- **Save re-embeds through `api.onboarding.updateProfile`** (Plan 02) — delete/replace the old rag entry and re-`startIngest`, so `searchVault`/vault browse returns the UPDATED text, not a duplicate.
- **Sparse-start honored:** only `oneLineDescription` is required; name/stage/offering/targetCustomer are optional enrichment fields — this page is exactly the surface where idea-stage users fill fields in over time.
- **Nav-wiring fix (found during human-verify):** the page shipped with no rail entry and was only reachable by typing the URL — added a rail-foot "Business Profile" link (UserIcon) with correct `isActive` handling (exact match so it doesn't double-highlight Command Center).

## Task Commits

1. **Task 1: Editable profile page with re-embed on save (getProfile + deserializeProfile)** — `0f4476f` (feat)
2. **Task 1 follow-up: Business Profile nav link in the rail** — `c3aef1c` (fix) — reachability gap found during human-verify
3. **Task 2: Human-verify profile edit re-embeds grounding** — checkpoint, **approved by human** (no code commit)

## Files Created/Modified
- `apps/web/app/(app)/dashboard/profile/page.tsx` - Editable Lean-core profile form; loads getProfile → edit → Save calls api.onboarding.updateProfile (re-embed); sparse-start (only oneLineDescription required)
- `packages/backend/convex/onboarding.ts` - `getProfile` tenantQuery (committed doc parsed back to structured fields via deserializeProfile); `currentProfileDoc` widened to `QueryCtx | MutationCtx`
- `packages/core/src/businessProfile.ts` - `deserializeProfile` — serializeProfile inverse, marker-based parse
- `packages/core/src/businessProfile.test.ts` - serialize/deserialize round-trip tests
- `apps/web/app/(app)/layout.tsx` - rail-foot "Business Profile" link (nav-reachability fix)
- `docs/playbooks/onboarding.md` - profile page LIVE; getProfile/deserialize edit-form loader documented; `Last verified` bumped

## Decisions Made
- The committed vault-doc markdown is the single profile record — no separately-persisted structured copy — so `getProfile` parses it back with `deserializeProfile`; the edit form pre-fills from what was actually stored (including earlier-plan docs).
- `deserializeProfile` parses by the serializer's fixed markers (heading, `- **Label:**` bullets, `## Section` lists), not brittle line offsets; a round-trip test binds the two functions so they change together.
- Save re-embeds via the existing `api.onboarding.updateProfile` (Plan 02), not a bespoke rag write — the old entry is replaced, keeping grounding single-copy and current.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Profile page had no nav entry (unreachable)**
- **Found during:** Task 2 (human-verify)
- **Issue:** Plan 11-04 shipped `/dashboard/profile` with no link anywhere in the rail, so users could only reach the editable profile by typing the URL — the delivered feature was effectively invisible.
- **Fix:** Added a rail-foot "Business Profile" link (UserIcon) next to Connect Gmail; `isActive("/dashboard/profile")` lights it without double-highlighting Command Center (exact match).
- **Files modified:** apps/web/app/(app)/layout.tsx
- **Verification:** web typecheck clean; link resolves to the profile page; human-verified the page WITH the link in place.
- **Committed in:** `c3aef1c` (separate follow-up commit on top of Task 1)

---

**Total deviations:** 1 auto-fixed (1 nav-reachability gap).
**Impact on plan:** Necessary — an unreachable page fails the plan's intent (an editable, correctable profile). No scope creep. All plan success criteria hold: the profile is editable post-onboarding and saving re-embeds so grounding reflects the edit.

## Deferred Issues
- Pre-existing, out-of-scope flake logged to `deferred-items.md`: `convex/audit.test.ts` "auditCounts is not registered" — unrelated to this plan's changes; not fixed here.

## Issues Encountered
None beyond the nav-reachability gap documented above (found and closed during human verification).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Every onboarded tenant now has an editable, correctable business profile that re-embeds on save — the grounding substrate Phase 12 (evaluation engine), Phase 13 (proactive review), and Phase 14 (flagship voice-doc) read stays current.
- Sparse idea-stage profiles remain intentionally thin; this page is where they get enriched over time rather than blocked up front.
- Open S1/S4 concern still stands: grounded business-profile prose must stay out of exportable/WORM tables until the names-in-prose PII ceiling is resolved.
- Phase 11 (all 4 plans) is complete — phase-goal verification and `phase complete` are the orchestrator's step.

## Self-Check: PASSED

- FOUND: apps/web/app/(app)/dashboard/profile/page.tsx
- FOUND: .planning/phases/11-persona-onboarding-business-profile/11-04-SUMMARY.md
- FOUND commits: 0f4476f, c3aef1c

---
*Phase: 11-persona-onboarding-business-profile*
*Completed: 2026-07-24*
