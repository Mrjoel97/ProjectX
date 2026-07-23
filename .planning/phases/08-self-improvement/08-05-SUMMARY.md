---
phase: 08-self-improvement
plan: 05
subsystem: backend
tags: [convex, skills, http, skillopt, writeback, audit, notification, IMPR-02, IMPR-03]

# Dependency graph
requires:
  - phase: 08-self-improvement
    provides: skills.ts registry (activateSkill/EVAL_GATE, isGatedSkill/GATED_SKILLS) — Plan 01/prior phases
  - phase: 08-self-improvement
    provides: http.ts /skillopt/export + SKILLOPT_TOKEN bearer auth pattern (Plan 04)
provides:
  - skills.insertCandidate — external optimized body → gated candidate row (maxVer+1, never active, idempotent)
  - http.ts POST /skillopt/writeback — authenticated write-back seam the CI SkillOpt job posts to
  - notificationTemplates optimizer.candidate kind — the owner "candidate ready" static §4 label
affects: [08-06 ops panel (owner activateSkill click flips the candidate live), 08-07 Python writeback poster, 08-08 dry-run + playbook §9 sweep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write-back routes through the registry gate (insertCandidate → candidate row), NEVER a raw registry patch and NEVER status:active — activation is the owner's separate activateSkill/EVAL_GATE click (CLAUDE.md §5, the human-in-the-loop seam)"
    - "Idempotent vs the NEWEST row body (Pitfall 1): a byte-identical repost mints no row AND writes no audit/notify (inserted flag gates the side-effects — no churn)"
    - "IMPR-03 audit row is insert-only + refs/counts ONLY (§3/§4): {skillName, fromVersion, toVersion, runId, negativeRate, sampleCount} — no skill body, no user content"
    - "Owner notification via the existing notify choke point + a static optimizer.candidate label (§4 — no refs/content in the message)"

key-files:
  created: []
  modified:
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/http.ts
    - packages/core/src/notificationTemplates.ts
    - packages/core/src/notificationTemplates.test.ts
    - packages/backend/convex/llmRedaction.test.ts

key-decisions:
  - "insertCandidate returns { name, fromVersion (the LIVE/active version), toVersion, inserted } — fromVersion is the ACTIVE version (the before), not maxVersion, so the audit's before→after reflects what was live vs the new candidate"
  - "the writeback endpoint gates audit+notify on inserted===true — an idempotent repost is not an optimization, so it writes no audit row and fires no notification (full 'no churn')"
  - "a non-gated skill name throws NOT_GATED in insertCandidate → the httpAction surfaces it as an error (rejected) — only eval-gated skills route through the gate"
  - "extended the §4 llmRedaction notify-site scan to include http.ts — the new notify site is now firewall-covered (a future content leak there trips the scan RED)"

requirements-completed: [IMPR-02, IMPR-03]
requirements-contributed: []

# Metrics
duration: ~15min
completed: 2026-07-24
---

# Phase 8 Plan 05: SkillOpt Write-Back (candidate + evidence) Summary

**The human-in-the-loop write-back seam: `skills.insertCandidate` accepts a SkillOpt-authored optimized body as a NEW candidate version (maxVer+1) through the registry gate — never active, never patching a prior row, idempotent vs the newest body — and the authenticated `POST /skillopt/writeback` routes a CI post through it, writes ONE insert-only refs/counts-only audit row {skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}, and notifies the owner "candidate ready" via the notify choke point. The candidate awaits the owner's separate activateSkill/EVAL_GATE click.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments

- **`skills.insertCandidate` (Task 1, TDD)** — internalMutation `{ name, body }` mirroring seedSkills' gated-candidate branch but taking an EXTERNAL body. Rejects a non-gated name (`NOT_GATED`), throws `NO_ACTIVE_SKILL` for an unseeded skill, is idempotent vs the NEWEST row body (byte-identical → no insert), else inserts `{ name, version: maxVer+1, body, status: "candidate", createdAt }`. Returns `{ name, fromVersion (the ACTIVE version), toVersion, inserted }`. NEVER sets `status:"active"` and NEVER patches a prior row (immutable-per-version, §5).
- **`optimizer.candidate` notification kind (Task 2)** — added to the closed `NotificationKind` union, `NOTIFICATION_KINDS` runtime list, and the `MESSAGES` Record (static label "A new optimized skill candidate is ready for your review.", no interpolation, §4). The `Record<NotificationKind, …>` makes a missing key a compile error; the exhaustive-kinds test updated.
- **`POST /skillopt/writeback` (Task 2)** — httpAction on the existing router. Same `SKILLOPT_TOKEN` bearer auth as `/export` (fail-closed 401). On auth OK: `insertCandidate` → when `inserted`, ONE insert-only audit row via `internal.audit.log` (`eventType: "skill.optimized"`, payload refs/counts ONLY) + `internal.notifications.notify` with `kind:"optimizer.candidate"`. Returns `{ ok:true, fromVersion, toVersion, inserted }`. An idempotent repost writes no audit/notify (no churn).
- **§4 firewall extended** — `http.ts` added to the llmRedaction notify-site scan so the new notify message is guarded against a future content interpolation.

## Task Commits

1. **Task 1: skills.insertCandidate (external body → gated candidate)** — `d2f0f24` (feat) — TDD RED (3 failing, export missing) → GREEN (37/37), no refactor.
2. **Task 2: POST /skillopt/writeback + audit + notify + optimizer.candidate kind** — `e28fd59` (feat) — code-first (a thin httpAction over insertCandidate + audit.log + notify).

## Files Created/Modified

- `packages/backend/convex/skills.ts` — `insertCandidate` internalMutation (gated + idempotent + immutable-priors).
- `packages/backend/convex/skills.test.ts` — 3 cases: new candidate + immutable/active priors, non-gated reject, idempotent no-op.
- `packages/backend/convex/http.ts` — `POST /skillopt/writeback` route + `notificationMessage` import.
- `packages/core/src/notificationTemplates.ts` — `optimizer.candidate` in union + list + MESSAGES.
- `packages/core/src/notificationTemplates.test.ts` — extended the exhaustive-kinds `expected` list.
- `packages/backend/convex/llmRedaction.test.ts` — added `http.ts` to the §4 notify-site scan.

## Decisions Made

- **`fromVersion` = the LIVE/active version, not `maxVersion`** — so the audit's before→after reflects what was live vs the new candidate (with a `?? maxVersion` fallback for a degenerate no-active registry).
- **audit+notify gated on `inserted===true`** — an idempotent repost is not an optimization, so it writes nothing (full "no churn", beyond the plan's registry-only idempotence).
- **non-gated name → throw `NOT_GATED`** — the endpoint surfaces it as an error (rejected); only eval-gated skills route through the gate.
- **extended the §4 notify-site scan to `http.ts`** (a small Rule-2 §4 hardening beyond the plan's listed files) so the new notify site can never leak content.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] gated audit+notify on `inserted` + extended §4 scan to http.ts**
- **Found during:** Task 2
- **Issue:** The plan's write-back wrote the audit row + notify unconditionally; an idempotent repost would then churn a duplicate audit row and a duplicate owner notification. The new notify site in http.ts was also outside the §4 static-label scan.
- **Fix:** `insertCandidate` returns an `inserted` flag; the endpoint writes audit+notify ONLY when a genuinely new candidate was minted. Added `http.ts` to the llmRedaction notify-site scan list.
- **Files modified:** packages/backend/convex/skills.ts, packages/backend/convex/http.ts, packages/backend/convex/llmRedaction.test.ts
- **Commit:** d2f0f24, e28fd59

## Authentication Gates

None — `SKILLOPT_TOKEN` is already the documented Plan 04 setup step (the same bearer secret guards `/export` and `/writeback`). No new secret introduced.

## Issues Encountered

- **Pre-existing non-regression** (untouched here): the `convex/lib/functions.ts:25` TS2322 (documented 08-01/08-04) is the sole backend source tsc error. My four source-touching files add ZERO new errors. Test-file `import.meta.glob` tsc noise is likewise pre-existing.

## Verification

- `pnpm --filter @pikar/backend test skills` → **37/37 green** (3 new insertCandidate cases).
- `pnpm --filter @pikar/core test notificationTemplates` → **4/4 green** (exhaustive-kinds includes optimizer.candidate).
- `pnpm --filter @pikar/backend test llmRedaction` → **33/33 green** (§4 firewall now covers http.ts).
- Backend source `tsc --noEmit` → only the pre-existing `lib/functions.ts:25` error; my files add none.
- Write-back inserts a CANDIDATE (never active); prior rows immutable; idempotent on identical body; non-gated name rejected; the audit row carries refs/counts ONLY.

## User Setup Required

- **`SKILLOPT_TOKEN`** (already required by Plan 04's `/export`) also gates `/writeback` — no new secret. The Plan 08 dry-run exercises both endpoints end-to-end with a real token.

## Next Phase Readiness

- The candidate-insert + audit + notify seam is fully unit-testable independent of the Python side. Plan 06's ops panel wires the owner's `activateSkill` click over these candidate rows (the live flip through EVAL_GATE). Plan 07's Python poster hits `POST /skillopt/writeback`. Plan 08's dry-run runs export → SkillOpt → held-out eval → candidate write-back → owner activate end-to-end.
- **Playbook/watch.json for all of Phase 8 stay centralized in Plan 08-08** (deliberately untouched here — the check-playbooks hook self-clears on the second stop).

## Self-Check: PASSED

Both task commits (d2f0f24, e28fd59) are present in git history; all six modified files carry the changes (verified by the green test runs that import them).

---
*Phase: 08-self-improvement*
*Completed: 2026-07-24*
