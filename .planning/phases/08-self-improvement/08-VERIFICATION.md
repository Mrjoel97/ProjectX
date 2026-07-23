---
phase: 08-self-improvement
verified: 2026-07-24T01:40:00Z
status: passed
score: 8/8 must-haves verified (all 08-01..08-08 plans)
human_verification: []
notes:
  documented_residuals:
    - "SkillOpt Python OPTIMIZE step (train.py -> best_skill.md) and the exact SkillOpt v0.2.0 YAML split-keys are unverified on this Windows box (unusable local Python); designed for CI/clean Python 3.11. Owner-accepted, same class as Phase 7's real-S3/real-email deferrals. A hand-edited candidate exercised the Convex seam in the live dry-run instead."
    - "Three Phase-9 owner-authorization blockers (setOptimizerEnabled/activateCandidate/candidatesForReview are tenant-callable, not owner-role-gated) — documented in docs/playbooks/skill-registry.md Phase-9 blockers section, owner-approved deferral for single-owner beta."
    - "PII export scrub (packages/pii scanText) is structured-PII-only; names-in-prose are not scrubbed — documented HARD BLOCKER before Phase-9 multi-user, not a Phase-8 gap."
---

# Phase 8: Self-Improvement Verification Report

**Phase Goal:** The system learns from real feedback and improves its own skills (versioned agent
skill documents, optimized via the SkillOpt held-out-validation loop) under automated evaluation
guardrails with instant rollback.

**Verified:** 2026-07-24
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A feedback row can be stored keyed to requestId + skillName + skillVersion | ✓ VERIFIED | `schema.ts:574-588` `feedback` table with `by_tenant_request`/`by_skill` indexes; `feedback.ts` `submitFeedback` inserts/edits it |
| 2 | A plan/request carries the skill version that produced it (attribution) | ✓ VERIFIED | `schema.ts:140,244` `requests.skillVersion` / `plans.skillVersion` (optional, no-migration); `cockpit.ts:398,426,430,585` sets at propose, copies at executePlan; `cockpit.test.ts` asserts both |
| 3 | The optimizer ships DORMANT (missing/false optimizerConfig reads enabled=false) | ✓ VERIFIED | `optimizerConfig.ts:16-21` `DEFAULT_OPTIMIZER_CONFIG.enabled=false`; `getConfig` default-on-read; `optimizerConfig.test.ts` 7/7 pass |
| 4 | Kill switch is a single-row toggle the ops page can flip and CI can read | ✓ VERIFIED | `setOptimizerEnabled` (tenantMutation, ops toggle) + `getOptimizerConfig` (internalQuery, CI `convex run`) both route through one `writeConfig` upsert; `.github/workflows/skillopt.yml` step "Kill-switch gate" reads it as the FIRST step |
| 5 | Thumbs up/down + optional comment creates ONE tenant-scoped, editable/undoable feedback row | ✓ VERIFIED | `feedback.ts` `submitFeedback` upserts by `by_tenant_request`; `undoFeedback` deletes; `feedback.test.ts` 5/5 pass (insert, edit-same-row, undo, unattributable-reject, cross-tenant-reject) |
| 6 | The loop is eligible ONLY when negativeRate ≥ threshold AND sampleCount ≥ floor AND cooldown elapsed | ✓ VERIFIED | `packages/core/src/optimizerBreach.ts` pure `classifyBreach` (floor→threshold→cooldown order, inclusive boundaries, no divide-by-zero); `optimizerBreach.test.ts` 7/7 pass; `optimizerEligibility.ts` thin adapter, `optimizerEligibility.test.ts` 6/6 pass |
| 7 | Export carries only PII-scrubbed text; a scan Err drops the trajectory (fail-closed) | ✓ VERIFIED | `skilloptExport.ts` `buildTrajectoryExport` scrubs goal/body/comment via `@pikar/pii scanText`, `continue`s (drops) on any Err; `skilloptExport.test.ts` 5/5 pass |
| 8 | A SkillOpt body POSTed back becomes a NEW candidate; priors immutable; gated+idempotent | ✓ VERIFIED | `skills.ts:317-357` `insertCandidate` — non-gated rejected, identical body idempotent (`inserted:false`), else inserts `version:maxVersion+1, status:"candidate"`, never patches/activates; `skills.test.ts` 41/41 pass (includes insertCandidate cases) |
| 9 | Every optimization writes ONE insert-only, refs/counts-only audit row + owner notification | ✓ VERIFIED | `http.ts:143-158` `/skillopt/writeback` — `audit.log` with `{skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}` (no body/content), then `notifications.notify` kind `"optimizer.candidate"`; only fires on a genuinely new candidate (`inserted && ownerTenant`) — no churn on idempotent repost |
| 10 | Owner-gated one-click activate routes through the SAME EVAL_GATE as the CI path; rollback works | ✓ VERIFIED | `skills.ts:80-121` shared `activateSkillVersion` helper used by BOTH `activateSkill` (internal) and `activateCandidate` (tenantMutation, ops UI); EVAL_GATE only applies to never-before-active `status:"candidate"` rows — archived/rolled-back rows are exempt by status, so rollback always works |
| 11 | UI surfaces: feedback control on delivered rows; ops kill switch + candidate diff/evidence/activate | ✓ VERIFIED | `cards.tsx:554-` `FeedbackControl` wired to `myFeedback`/`submitFeedback`/`undoFeedback`, rendered on `status==="sent"` rows (line 715), `aria-pressed` a11y; `ops/page.tsx:135-` `OptimizerPanel` wired to `getOptimizerStatus`/`setOptimizerEnabled`/`candidatesForReview`/`activateCandidate`, before/after diff + evidence + inline EVAL_GATE error surfacing |
| 12 | Full loop proven end-to-end (owner dry-run) | ✓ VERIFIED (owner-run, documented) | `08-08-SUMMARY.md`: export 401/401/200 scrubbed; write-back v12→13 (idempotent repost `inserted:false`); candidate-only (active stayed v12); `eval:golden cockpit-agent@13` 23/23 evidence recorded; activate 12→13 (EVAL_GATE passed) then rollback 13→12 (status-exempt); dormancy confirmed (`enabled=false`) |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/backend/convex/schema.ts` | feedback table, plans/requests.skillVersion, optimizerConfig table | ✓ VERIFIED | All four present exactly as specified, correct indexes |
| `packages/backend/convex/optimizerConfig.ts` | default-OFF read + owner toggle | ✓ VERIFIED | `getOptimizerConfig`/`setOptimizerConfig` (internal) + `getOptimizerStatus`/`setOptimizerEnabled` (tenant, ops UI); single shared `writeConfig` upsert |
| `packages/backend/convex/optimizerConfig.test.ts` | default-off-on-read + upsert proof | ✓ VERIFIED | 7/7 tests pass |
| `packages/backend/convex/feedback.ts` | submit/edit/undo feedback mutation | ✓ VERIFIED | `submitFeedback`, `undoFeedback`, `myFeedback` exported and correct |
| `packages/backend/convex/cockpit.ts` | skillVersion attribution set/copy | ✓ VERIFIED | Lines 398/426/430 (propose) + 585 (executePlan copy) |
| `packages/core/src/optimizerBreach.ts` | pure classifyBreach | ✓ VERIFIED | Pure function, no Date.now, all branches tested |
| `packages/backend/convex/optimizerEligibility.ts` | rolls negative-rate, calls classifyBreach | ✓ VERIFIED | Thin adapter over feedback `by_skill` index |
| `packages/backend/convex/skilloptExport.ts` | buildTrajectoryExport | ✓ VERIFIED | Scrub/score/split, fail-closed |
| `packages/backend/convex/http.ts` | GET /skillopt/export, POST /skillopt/writeback | ✓ VERIFIED | Both routes present, Bearer-token 401 fail-closed, IDOR-safe (tenant from server env, not request body — commit `d67802d`) |
| `packages/backend/convex/skills.ts` | insertCandidate, activateCandidate, candidatesForReview | ✓ VERIFIED | Shared EVAL_GATE helper, idempotent insertCandidate, ops review query |
| `packages/core/src/notificationTemplates.ts` | optimizer.candidate kind | ✓ VERIFIED | Added to closed union, NOTIFICATION_KINDS, MESSAGES; static label (no interpolation) |
| `apps/web/.../cards.tsx` | feedback control on delivered rows | ✓ VERIFIED | `FeedbackControl`, gated to `status==="sent"` |
| `apps/web/.../ops/page.tsx` | kill switch + candidate review/activate panel | ✓ VERIFIED | `OptimizerPanel`, diff view, inline gate-error surfacing |
| `skillopt/envs/pikar_cockpit/*` | Python env package | ✓ VERIFIED | Parses cleanly (`ast.parse` all files OK) |
| `.github/workflows/skillopt.yml` | cron + workflow_dispatch, dormant + eligibility gated | ✓ VERIFIED | Valid YAML; kill-switch gate is step 1; eligibility gate is step 2 (cron breach-only, dispatch bypasses) |
| `docs/playbooks/skill-registry.md` | write-back/candidate/kill-switch/Phase-9-blocker documentation | ✓ VERIFIED | Section present per SUMMARY; `check-playbooks.mjs` passed at commit time |
| `docs/playbooks/watch.json` | new Phase-8 paths registered | ✓ VERIFIED | `feedback.ts`, `optimizerConfig.ts`, `optimizerEligibility.ts`, `skilloptExport.ts`, `optimizerBreach.ts`, `skillopt/`, `skillopt.yml` all present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `optimizerConfig.getOptimizerConfig` | `optimizerConfig` table | `.first() ?? DEFAULT` | ✓ WIRED | Confirmed in source and test |
| `feedback.submitFeedback` | `requests.skillVersion` | reads request row for attribution | ✓ WIRED | Rejects when `request.skillVersion === undefined` |
| `cockpit.executePlan` | `requests.skillVersion` | copies `plan.skillVersion` per recipient | ✓ WIRED | `cockpit.ts:585` |
| `optimizerEligibility.ts` | `feedback` `by_skill` | counts up/down over window | ✓ WIRED | Confirmed |
| `optimizerEligibility.ts` | `optimizerConfig` | reads thresholds/cooldown | ✓ WIRED | Confirmed |
| `skilloptExport.ts` | `packages/pii scanText` | scrubs, fail-closed drop | ✓ WIRED | Confirmed, tested |
| `http.ts /skillopt/export` | `buildTrajectoryExport` | auth then runQuery | ✓ WIRED | 401/401/200 owner-verified live |
| `http.ts /skillopt/writeback` | `skills.insertCandidate` | auth then runMutation | ✓ WIRED | Owner-verified live, IDOR fix applied |
| writeback handler | audit (insert-only) | refs/counts-only payload | ✓ WIRED | No body/content in payload |
| `.github/workflows/skillopt.yml` | `optimizerConfig.enabled` | reads via convex run, exits on false | ✓ WIRED | First step, before any pip/python cost |
| `.github/workflows/skillopt.yml` | `optimizerEligibility` | cron gates on breach; dispatch bypasses | ✓ WIRED | Second step |
| `rollout.py` | `convex run llm:runCockpitAgent` | node subprocess (never shell) | ✓ WIRED (design-level) | Present in source; NOT live-exercised (documented residual — CI/clean-Python-3.11 task) |
| `cards.tsx` feedback control | `feedback.submitFeedback`/`myFeedback` | useMutation/useQuery on requestId | ✓ WIRED | Confirmed, owner dry-run walkthrough referenced in 08-08 |
| `ops/page.tsx` activate button | `skills.activateCandidate` → EVAL_GATE | owner-gated mutation | ✓ WIRED | Same shared gate as CI path; inline error surfacing on refusal |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| IMPR-01 | 08-01, 08-02, 08-06, 08-08 | User feedback (rating/comment) captured on delivered responses, attributed to skill version | ✓ SATISFIED | `feedback.ts` + `cockpit.ts` attribution + `cards.tsx` UI, all tested and owner-verified live |
| IMPR-02 | 08-01, 08-03, 08-04, 08-05, 08-06, 08-07, 08-08 | Feedback-threshold breach triggers autonomous prompt-optimization loop, gated by automated eval checks (held-out set), with one-click rollback + kill switch | ✓ SATISFIED | `optimizerBreach.ts`/`optimizerEligibility.ts` (trigger), `skilloptExport.ts` (held-out export — golden eval-cases/*.json never exported), `insertCandidate`/EVAL_GATE (gated activation), `activateSkill` rollback (status-exempt), `optimizerConfig.enabled` kill switch (dormant by design, CI-gated) |
| IMPR-03 | 08-05, 08-06, 08-08 | Prompts versioned; every optimization records before/after versions + triggering evidence | ✓ SATISFIED | `insertCandidate` returns `{fromVersion, toVersion}`; audit row `{skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}`; `candidatesForReview` surfaces before/after diff + evidence on ops page |

REQUIREMENTS.md cross-check: all three IDs map to Phase 8 and are marked Complete (`.planning/REQUIREMENTS.md:178-180`); no orphaned Phase-8 requirement IDs found.

### Anti-Patterns Found

None blocking. No TODO/FIXME/placeholder markers in the Phase-8 source files; no empty handlers; no stubbed returns. All `ponytail:` comments found are deliberate, labeled simplifications with a stated ceiling and upgrade path (e.g., full-index scan on `optimizerEligibility`, no diff library on the ops panel, structured-PII-only scrub) — consistent with CLAUDE.md §8 discipline, not gaps.

One incidental, out-of-scope observation: the working tree currently has an uncommitted whitespace/formatting-only diff on `apps/web/.../cards.tsx` (429 insertions / 104 deletions, no logical change) and a line-ending-only diff on `packages/backend/convex/plans.ts`. Verified the last COMMITTED version of `cards.tsx` (`git show HEAD`) already contains `FeedbackControl` fully wired — this diff is pre-existing formatter drift unrelated to Phase-8 content and does not affect verification. Not counted as a Phase-8 gap; flagged for the owner's awareness only.

### Human Verification Required

None outstanding — the phase's single human-gated checkpoint (08-08 Task 2, the manual cockpit-agent dry-run) was already executed and PASSED per `08-08-SUMMARY.md`, with evidence for every step (export 401/401/200, write-back v12→13 + idempotent repost, eval:golden 23/23, activate 12→13, rollback 13→12, dormancy confirmed).

### Gaps Summary

No gaps. All 8 plans' must-haves (truths, artifacts, key_links) are present, substantive, and wired in the actual codebase — not just claimed in SUMMARYs. All backend/core test suites for Phase-8 files are green (64 backend + 11 core + 97 cockpit-adjacent = 172 relevant tests passing), both `tsc --noEmit` checks (backend, web) are clean, the Python env package parses, the GitHub Actions workflow is valid YAML with the kill-switch gate as step 1 and the eligibility gate as step 2, and `check-playbooks.mjs` passed at the phase-close commit.

Three items are deliberately NOT fixed and NOT counted as gaps — they are owner-approved, explicitly documented residuals matching the pattern of prior-phase deferrals (Phase 7's real-S3/real-email):
1. The SkillOpt Python OPTIMIZE step (`train.py`) and the exact v0.2.0 YAML split-key names are unverified on this Windows dev box (no usable local Python 3.11) — designed and gated for CI; the Convex seam around it was proven with a hand-edited candidate in the live dry-run.
2. Three ops-surface mutations/queries (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable rather than owner-role-gated, because no owner-role primitive exists yet — inert in single-owner beta, documented as a Phase-9 blocker in the playbook.
3. The PII export scrub is structured-PII-only (no NER on names-in-prose) — documented as a hard blocker before Phase-9 multi-user, not attempted this phase per RESEARCH's explicit scope.

The phase goal is achieved: feedback capture + attribution works end-to-end, the optimization loop's full mechanics (breach trigger → held-out-safe export → SkillOpt → gated candidate write-back → owner one-click activate → rollback → kill switch) are implemented, tested, and owner-verified live, and it ships DORMANT as the locked design decision requires.

---

_Verified: 2026-07-24_
_Verifier: Claude (gsd-verifier)_
