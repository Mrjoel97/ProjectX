---
phase: 08-self-improvement
plan: 02
subsystem: backend
tags: [convex, feedback, attribution, cockpit, tenant-scoped, IMPR-01]

# Dependency graph
requires:
  - phase: 08-self-improvement
    provides: feedback table + plans/requests.skillVersion optional fields (Plan 01 schema substrate)
  - phase: 03.1-cockpit
    provides: proposeEmailPlan / executePlan (the propose→approve→seed spine attribution rides on)
provides:
  - feedback.ts — tenant-scoped submitFeedback / undoFeedback / myFeedback (submit + edit + undo, skill-version attributed)
  - plans.skillVersion set at propose from the active cockpit-agent version (re-attributed on redraft)
  - requests.skillVersion copied from the plan at executePlan (feedback resolves to the exact version)
affects: [08-03 eligibility (rolls the negative-rate over feedback+skillVersion), 08-04 trajectory export (scrubs feedback.comment)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Upsert-by-unique-index (by_tenant_request): first tap inserts, re-tap patches the SAME row (editable/undoable, createdAt frozen)"
    - "Attribution copy-forward: plan.skillVersion set at propose → copied to every requests row at executePlan (the threadId/inReplyTo copy precedent)"

key-files:
  created:
    - packages/backend/convex/feedback.ts
    - packages/backend/convex/feedback.test.ts
  modified:
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpit.test.ts

key-decisions:
  - "submitFeedback REJECTS an unattributable request (request.skillVersion undefined) — an unattributable rating is not training signal (RESEARCH Pitfall 1), so no row is stored"
  - "propose degrades gracefully with NO active cockpit-agent row: skillVersion stays undefined, the propose still succeeds (never throws — the plan's explicit degrade-not-fail rule)"
  - "A re-propose (redraft) re-attributes to the THEN-active cockpit-agent version, not the original — a redrafted response is credited to the skill that actually produced it"

patterns-established:
  - "Content-plane comment: feedback.comment is raw at rest on the tenant-owned row (like requests.goal), PII-scrubbed at the export boundary in Plan 04, NEVER written to audit/DLQ (CLAUDE.md §4)"

requirements-completed: [IMPR-01]

# Metrics
duration: ~9min
completed: 2026-07-21
---

# Phase 8 Plan 02: Feedback Capture + Skill-Version Attribution Summary

**A tenant-scoped thumbs up/down (+ optional comment) on a delivered response that upserts ONE editable/undoable feedback row, keyed through requestId → the exact cockpit-agent version that produced it (set at propose, copied to requests at executePlan).**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `feedback.ts` — three tenant-scoped functions (CLAUDE.md §2, `tenantMutation`/`tenantQuery`, never raw): `submitFeedback` upserts the single `by_tenant_request` row (first tap inserts attributed to the request's skillVersion + `COCKPIT_AGENT_SKILL`; a re-tap patches rating/comment/updatedAt on the SAME row, `createdAt` frozen — a mis-tap fix, not a new signal), `undoFeedback` deletes it (idempotent — fully reversible), `myFeedback` returns the row or null for UI render.
- Fail-closed guards: a cross-tenant `requestId` reads as `"request not found"` (the tenant guard, never leaks another tenant's row); an unattributable request (no `skillVersion`) is rejected and nothing is stored (Pitfall-1 warning sign).
- `cockpit.ts` attribution wiring: `proposeEmailPlan` reads the active cockpit-agent version (`by_name_status` active, direct db read — never throws, degrades to undefined) and stamps `plan.skillVersion` on BOTH the first-propose and re-propose patches; `executePlan` copies `plan.skillVersion` onto every seeded `requests` row (beside the existing threadId/inReplyTo copy).

## Task Commits

1. **Task 1 RED: failing feedback capture test** — `b76a25f` (test)
2. **Task 1 GREEN: feedback.ts (submit/edit/undo, attributed)** — `42688d2` (feat)
3. **Task 2: skill-version attribution (propose stamps, executePlan copies)** — `a79eb48` (feat)

_TDD: Task 1 was RED (5 failing — module missing) → GREEN (5/5). No refactor. Task 2 was code-first (extends an existing spine)._

## Files Created/Modified
- `packages/backend/convex/feedback.ts` — submitFeedback / undoFeedback / myFeedback; upsert on `by_tenant_request`, cross-tenant + unattributable rejection, content-plane comment note (§4).
- `packages/backend/convex/feedback.test.ts` — 5 cases: submit-inserts + re-tap-edits-same-row, undo-deletes-idempotent, myFeedback-row-or-null, unattributable-rejected, cross-tenant-not-found.
- `packages/backend/convex/cockpit.ts` — `proposeEmailPlan` reads active cockpit-agent version + stamps `plan.skillVersion` (both patches); `executePlan` copies `skillVersion` to each request row.
- `packages/backend/convex/cockpit.test.ts` — 3 new attribution cases (propose stamps + executePlan copies to every row; re-propose re-attributes; no-active-row degrades to undefined without throwing).

## Decisions Made
- **Unattributable feedback is refused, not stored** — a request with no resolvable `skillVersion` throws `"unattributable: request has no skillVersion"`; a rating with no version is not training signal (RESEARCH Pitfall 1). Verified by test (no row stored).
- **Propose degrades, never fails** — with no active cockpit-agent row (shouldn't happen post-seed), `skillVersion` stays undefined and the propose still succeeds. Read the active row directly (this is a mutation) rather than `loadSkill` (which fails closed/throws).
- **Redraft re-attributes to the then-active version** — a re-propose stamps the currently-active version, so a redrafted response is credited to the skill that actually produced it, not the original.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wrong import specifier for `COCKPIT_AGENT_SKILL`**
- **Found during:** Task 1 GREEN (first test run — insert threw `Missing required field skillName`)
- **Issue:** imported from `@pikar/contracts` (package root); the constant is exported from the `@pikar/contracts/skill` subpath (the specifier skills.ts/llm.ts use), so the root import resolved to `undefined`.
- **Fix:** import from `@pikar/contracts/skill` in both feedback.ts and feedback.test.ts.
- **Files modified:** feedback.ts, feedback.test.ts
- **Commit:** `42688d2`

**2. [Rule 3 - Blocking] Over-narrow helper ctx type broke source typecheck**
- **Found during:** Task 2 (source `tsc` after wiring)
- **Issue:** a `requireAttributableRequest(ctx, requestId)` helper typed ctx as `{ db: { get: (id: unknown) => Promise<unknown> } }`, incompatible (contravariant `get` signature) with the real tenantMutation ctx → `TS2345`.
- **Fix:** the helper had a single caller — inlined the guard into `submitFeedback` (ponytail: fewer files, no structural-typing gymnastics). Source tsc clean (sole remaining error is the pre-existing `lib/functions.ts:25` from 08-01).
- **Files modified:** feedback.ts
- **Commit:** `a79eb48`

## Issues Encountered
- **Pre-existing tsc error** `convex/lib/functions.ts(25,3): TS2322` — present since before Phase 8 (documented in 08-01, logged to deferred-items.md). Not introduced here; my changed source compiles clean.
- **Pre-existing test flake** `runCockpitAgent.test.ts` "scripted edit sequence" 5000ms machine-load timeout — reproduces on base, independent of touched files; passes 18/18 in isolation with `--testTimeout=30000`. My `cockpit.test.ts` passes 24/24.

## Verification
- `pnpm --filter @pikar/backend test feedback` → 5/5 green.
- `pnpm exec vitest run convex/cockpit.test.ts` → 24/24 green (incl. 3 new attribution cases).
- Backend source `tsc --noEmit` → clean except the pre-existing `lib/functions.ts:25` error.
- A feedback row ALWAYS resolves to a concrete skill version (no unattributable rows stored — asserted by test).

## User Setup Required
None — no external service configuration.

## Next Phase Readiness
- Feedback capture + attribution live: a rating on a delivered response is stored, editable/undoable, and maps to the exact cockpit-agent version. Plan 03 eligibility can roll the negative-rate over `feedback` joined on `skillVersion`; Plan 04 export scrubs `feedback.comment` at the boundary.
- **Playbook/watch.json for all of Phase 8 remain centralized in Plan 08-08** (deliberately untouched here — the check-playbooks hook self-clears on the second stop, per the plan's environment note).

## Self-Check: PASSED

All created files exist (feedback.ts, feedback.test.ts) and all three task commits (b76a25f, 42688d2, a79eb48) are present in git history.

---
*Phase: 08-self-improvement*
*Completed: 2026-07-21*
