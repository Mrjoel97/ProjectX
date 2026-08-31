---
phase: 28-connector-backed-revenue-pack
plan: 10
subsystem: revenue-crm
tags: [phase-19, crm, suppression, attention-ranking, customer-pulse, tenant-isolation]
requires:
  - phase: 19-contacts-crm-follow-ups
    provides: canonical tenant-scoped people, follow-ups, consent and suppression substrate
  - phase: 28-09
    provides: passed-only connector capability and truthful parked-lane behavior
provides:
  - Deterministic CRM attention ranking over bounded typed facts
  - Phase 19-native local-only attention and customer-pulse projections
  - Terminal suppression, stable ordering and explicit partial/unavailable pulse semantics
  - A read-only adapter that creates no second person, opportunity, stage or value store
affects: [28-12, 28-15, 28-19, 28-21, revenue-specialist]
tech-stack:
  added: []
  patterns:
    - Provider references remain opaque joins while Phase 19 owns people and suppression
    - Missing source facts remain missing and never imply an opportunity or healthy pulse
key-files:
  created:
    - packages/revenue/src/crm.ts
    - packages/revenue/src/crm.test.ts
    - packages/backend/convex/revenueCrm.ts
    - packages/backend/convex/revenueCrm.test.ts
  modified:
    - packages/revenue/src/index.ts
    - docs/playbooks/revenue-crm.md
key-decisions:
  - Suppression is terminal exclusion rather than a low-priority rank
  - Local-only coverage is the honest result while HubSpot remains parked
  - REVN-04 remains pending until a passed HubSpot lane can contribute connector projections
patterns-established:
  - Rank only bounded typed facts and break ties by the code-owned contact id
  - Require explicit pulse coverage so unavailable or partial reads cannot produce a false healthy result
requirements-completed: []
duration: recovery 15min; implementation landed 2026-08-31
completed: 2026-09-01
---

# Phase 28 Plan 10: Phase 19-Native CRM Outcome Projections Summary

**Deterministic attention and customer-pulse projections over Phase 19's canonical people and suppression substrate, with local-only honesty while HubSpot remains parked.**

## Performance

- **Recovery duration:** 15 min
- **Completed:** 2026-09-01
- **Tasks:** 3/3
- **Plan implementation files:** 5, plus the revenue export

## Accomplishments

- Added reproducible attention ranking from overdue/upcoming follow-ups, known activity, source-provided deal timing and typed payment flags; absent facts never become opportunity state.
- Joined Phase 19 contacts, follow-ups, suppressions and narrow provider references without copying people, stages or values into a revenue-owned store.
- Made suppression a terminal exclusion, kept local/provider provenance separate, bounded reads at 500 rows and returned `scanned`/`capped` alongside the result.
- Made customer pulse fail honestly to `unknown` on unavailable or incomplete reads, except when a known dispute already proves `at_risk`.
- Reconciled the playbook's stale `[PLANNED]` labels with the landed local-only surface while retaining passed-lane HubSpot enrichment as future work.

## Task Commits

The implementation was already present when this recovery pass began:

1. **Task 1: Define deterministic CRM attention and pulse rules** — `70b6cd7`
2. **Task 2: Compose Phase 19 and HubSpot without a second CRM** — `70b6cd7`
3. **Task 3: Record Phase 19 ownership and failure semantics** — `70b6cd7`, reconciled by `fd885b5`

`70b6cd7` bundled the three tasks before this recovery and is an ancestor of HEAD. The history was recorded as found rather than duplicated or retroactively split.

## Files Created/Modified

- `packages/revenue/src/crm.ts` — pure attention ordering and bounded customer-pulse classification.
- `packages/revenue/src/crm.test.ts` — 30 behavior tests for suppression, absent facts, stable ordering, provenance and coverage.
- `packages/backend/convex/revenueCrm.ts` — tenant-scoped Phase 19 projection with a 500-row cap and no write surface.
- `packages/backend/convex/revenueCrm.test.ts` — 17 adapter tests for address suppression, closed output, non-fabrication, tenant isolation and read-only structure.
- `docs/playbooks/revenue-crm.md` — Phase 19 ownership, local-only fallback, source-fact and future HubSpot-enrichment semantics.

## Decisions Made

- A suppressed contact is removed from attention results; ranking it last would still make it reachable by a short call list.
- `_creationTime` is not activity, a missing stage is not open, and an absent amount is not zero.
- The adapter reports `coverage: "local"` while all provider lanes are parked. It does not fabricate a degraded provider result or call owner-only/live actions.
- `REVN-04` remains pending because its connector-backed half cannot be claimed until HubSpot passes and contributes a bounded projection.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Documentation bug] Reconciled contradictory playbook status**
- **Found during:** Task 3 recovery verification
- **Issue:** The playbook opening correctly said the local-only adapter and tests were built, while later sections still labeled those same files and gates `[PLANNED]` and claimed their invariants were unenforced.
- **Fix:** Marked the landed files and focused gates as built, retained passed-lane enrichment and unmatched-provider resolution as planned, and refreshed the verification date.
- **Files modified:** `docs/playbooks/revenue-crm.md`
- **Verification:** `node scripts/check-playbooks.mjs` passed silently; `git diff --check` was clean.
- **Committed in:** `fd885b5`

---

**Total deviations:** 1 auto-fixed documentation bug.
**Impact on plan:** No production behavior or provider capability changed.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @pikar/revenue test -- crm` | **30/30**, exit 0 |
| `pnpm --filter @pikar/backend test -- revenueCrm contacts pipeline` | **109/109**, exit 0 |
| Full `@pikar/revenue` unit suite | **337/337**, 10 files, exit 0 |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| Biome on the four CRM source/test files | clean, no fixes applied |
| `node scripts/check-playbooks.mjs` | silent, exit 0 |
| Plan-file `git diff --check` | clean |

The current full `@pikar/revenue` typecheck is not green because `src/reminders.test.ts:110` has a pre-existing Plan 28-13 `Projection<ReminderInvoice>` fixture error. The failure is outside 28-10, whose implementation commit recorded both package typechecks green when it landed; no foreign reminder file was edited during this recovery.

## Issues Encountered

- The implementation and all plan-owned files had already landed in `70b6cd7`, but no `28-10-SUMMARY.md` or roadmap completion existed.
- All HubSpot capability remains parked. No live provider call, owner-only action or `npx convex run` was performed.
- Concurrent edits in `docs/playbooks/revenue-connectors.md`, `packages/backend/convex/schema.ts` and `graphify-out/` were not staged, overwritten or claimed.

## User Setup Required

None for the local-only code path. HubSpot live-read and revoke evidence remains owner-controlled and must pass its independent gate before connector enrichment can be enabled or REVN-04 completed.

## Next Phase Readiness

- The Phase 19-native local fallback is ready for provider-neutral revenue tooling and telemetry work.
- Passed-lane HubSpot enrichment and unmatched provider-row resolution remain deferred until the HubSpot lane is no longer parked.
- The unrelated Plan 28-13 revenue typecheck error at `src/reminders.test.ts:110` remains a repository breadth blocker.

## Self-Check: PASSED

- `28-10-SUMMARY.md` exists.
- Implementation commit `70b6cd7` and playbook reconciliation commit `fd885b5` exist.
- The Phase 28 checklist marks 28-10 complete and the milestone table reads **21/29**.
- `.planning/STATE.md` and `.planning/REQUIREMENTS.md` were not modified.
- Known concurrent dirty paths were not staged or overwritten.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
