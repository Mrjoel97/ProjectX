---
phase: 07-resilience-operations-hardening
verified: 2026-07-21T03:50:00Z
status: human_needed
score: 4/4 must-haves verified (code); 2 items owner-deferred pending cloud infra (Manual-Only, not gaps)
human_verification:
  - test: "Real WORM object lands in S3 with checksum + retention under COMPLIANCE Object Lock"
    expected: "One S3 object shows ObjectLockMode=COMPLIANCE, a RetainUntilDate ~7 years out, a SHA256 checksum, and a delete/overwrite attempt is refused by the bucket"
    why_human: "Needs a real AWS Object-Lock-enabled S3 bucket + credentials provisioned in the Convex deployment env — no unit/smoke test can prove real S3 durability. The export code path (PutObject call, checksum header, retention pairing, advance-only-after-durable-write) is unit-proven in worm.test.ts and live-smoke-proven on the stub-skip branch (smoke:worm PASS against :3210 with WORM_BUCKET unset)."
  - test: "A real external email is delivered to a live mailbox for each failure class"
    expected: "One in-app notification AND one external email land per event (validation reject, escalation, retry breach, review timeout, agent timeout, dead-letter); a FAILED external send does not recursively notify"
    why_human: "Needs a Gmail OAuth-connected user (a live token) to observe real deliverability — no unit test can prove an email actually arrives. The notify choke point, external dispatch, and the loop-guard (fail-closed to in-app, swallow-all try/catch, never re-notifies) are unit-proven (notifications.test.ts, llmRedaction.test.ts §4 scans) and smoke-proven end-to-end for the DLQ path (smoke:dlq PASS: deadLetters row + deadletter.written audit + deadletter notify)."
---

# Phase 7: Resilience & Operations Hardening Verification Report

**Phase Goal:** Every failure path — agent/review timeouts, retry-threshold breaches, dead-letters — is caught, notified, escalated, and archived immutably.
**Verified:** 2026-07-21T03:50:00Z
**Status:** human_needed (all code must-haves verified against source; two cloud-infra-only checks are owner-deferred Manual-Only per 07-CONTEXT/07-VALIDATION/07-06-SUMMARY — not silent gaps)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Edit/reject/regenerate retry counters enforce thresholds; a breach escalates, notifies, and terminates the request safely (BOTH the durable-workflow pipeline path AND the live cockpit path) | VERIFIED | `packages/core/src/reviewThreshold.ts` `classifyReviewDecision` is the single fail-closed classifier (regenerate at/over `MAX_REGENERATE=3` → `escalate`, never `proceed`). Wired into `pipeline.ts:278-293` (the `escalate()` terminal: `setStatus("escalated")` + `audit("review.escalated")` + `notify(kind:"retry.limit")` + `writeTelemetry("escalated")`, then `return null` — never reaches the DELIVER `break` at :319) and into `cockpit.ts:392-411` (`proposeEmailPlan` sets `plans.escalated`+`retry.limit` notify past the cap) plus `cockpit.ts:497` (`executePlan` refuses `plan.escalated` with `review_escalated` BEFORE the CAS flip/seed/workflow.start). Unit-proven (`pipeline.test.ts`, `cockpit.test.ts` 4-redraft cases). Live-smoke-proven: `smoke:pipeline` breach terminal → `escalated` + `retry.limit` notify, NO send (PASS on :3210, 07-06-SUMMARY). |
| 2 | A review-inactivity timeout and an Executive Agent timeout each fire an escalation notification | VERIFIED | `pipeline.ts:254-266` timeout branch fires `notify(kind:"review.expired", message:notificationMessage("review.expired"))` before `writeTelemetry("expired")`, `return null` (NO delivery). `llm.ts:1589` `runAgentLoop` throws `ConvexError({kind:"agent_timeout"})` on an exhausted double (primary+CHEAP_MODEL) timeout; `cockpit.ts:50-58` `notifyIfAgentTimeout` fires `notify(kind:"agent.timeout")` and is wired into BOTH cockpit agent entry points (`sendCockpitMessage` line 136, `resolveRecipients` line 295). Unit-proven (`runCockpitAgent.test.ts` AGNT-04 positive/negative cases). Live-smoke-proven: `smoke:pipeline` timeout terminal → `expired` + `review.expired` notify, NO send (PASS). |
| 3 | Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events (in-app AND external, best-effort, loop-guarded) | VERIFIED | `notifications.ts:45-64` `notify` is the single choke point: always inserts the in-app row, then schedules `internal.notifyExternal.dispatch` via `runAfter(0)` (best-effort, never blocks the in-app write). `notifyExternal.ts` dispatch resolves the user's own mailbox (read-only GET), sends a STATIC `Pikar: <kind>` + `notificationMessage(kind)` via the governed Gmail send seam, wrapped in a swallow-all try/catch that NEVER throws/notifies/dead-letters (the loop guard, notifyExternal.ts:62-66). `deadLetter.ts` fires `notify(kind:"deadletter")` at both DLQ terminals (`onPipelineComplete` when a requestId ref is present, `deadLetterRecipient` always). §4 static-label firewall extended and mutation-checked in `llmRedaction.test.ts` (lines 738-779): no notify call interpolates content; notifyExternal sends only the static label. Unit-proven (`notifications.test.ts`, `deadLetter.test.ts`, `llmRedaction.test.ts` — 33/33). Live-smoke-proven: `smoke:dlq` PASS (deadLetters row + `deadletter.written` audit + `deadletter` user notification against :3210). |
| 4 | Completed request trails export on schedule to immutable (WORM) archival storage (export-only; hot-copy sweep explicitly DEFERRED by owner ruling, not part of this phase's scope) | VERIFIED (export code); sweep intentionally out of scope | `worm.ts` `exportAudit` (internalAction, `"use node"`, scheduled daily via `crons.ts:10` `crons.daily("worm-export", ...)`) does a real `PutObjectCommand` with `ObjectLockMode:"COMPLIANCE"`, `ObjectLockRetainUntilDate`, `ChecksumAlgorithm:"SHA256"`; the cursor (`wormCursor.ts advanceCursor`) advances ONLY after the `s3.send(...)` promise resolves (worm.ts:76-89) — throw or empty window never advances. `auditSince` now reads the `by_ts` index (`schema.ts:28`) instead of a full table scan. Unit-proven (`worm.test.ts` mocked-S3 durable/throw/empty cases). Live-smoke-proven on the stub-skip branch (`smoke:worm` PASS against :3210, `WORM_BUCKET` unset). Hot-audit-table sweep is DEFERRED by explicit 2026-07-21 owner ruling (07-CONTEXT.md, recorded in `audit-dead-letter.md` as SC#4-partial) — intended scope reduction, not a gap. Real S3 Object-Lock durability (a real bucket refusing a delete) is the one item requiring live cloud infra — see Human Verification below. |

**Score:** 4/4 truths verified at the code level; SC#4's sweep-half is intentionally out of scope (owner ruling); one sub-item of truth 4 (real S3 durability) and one sub-item of truth 3 (real email deliverability) are Manual-Only pending owner-provisioned infra.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/reviewThreshold.ts` | Pure fail-closed review-decision classifier + `MAX_REGENERATE` | VERIFIED | Exists, substantive (37 lines of real logic), exported via `packages/core/src/index.ts`; imported and used in both `pipeline.ts` and `cockpit.ts`. 8/8 unit tests pass. |
| `packages/core/src/notificationTemplates.ts` | Closed `NotificationKind` union + static §4-safe labels, no content param | VERIFIED | Exists, substantive; `notificationMessage(kind)` takes no content argument (structural §4 firewall). Imported by `pipeline.ts`, `cockpit.ts`, `deadLetter.ts`, `notifyExternal.ts`. 4/4 unit tests pass. |
| `packages/core/src/retention.ts` | Pure NDJSON serialize + object key + retention math | VERIFIED | Exists, substantive; `serializeAuditNdjson` (deterministic key-sort), `wormObjectKey`, `retainUntilDate`/`RETENTION_MS`. Imported by `worm.ts`. 8/8 unit tests pass. |
| `packages/backend/convex/worm.ts` | Real S3 PutObject WORM export, advance-only-after-durable-write | VERIFIED | Exists, substantive; real `@aws-sdk/client-s3` `PutObjectCommand` with COMPLIANCE mode + checksum; cursor advance strictly after `await s3.send(...)` resolves (worm.ts:76-88); stub-skip path when `WORM_BUCKET` unset never advances. Scheduled via `crons.ts` daily. Wired and live-smoke-proven (stub path). |
| `packages/backend/convex/wormCursor.ts` | `auditSince` on `by_ts` index; cursor get/advance | VERIFIED | Rewritten onto `withIndex("by_ts", ...)` — no full scan. `schema.ts:28` confirms the global `by_ts` index exists on `audit`. |
| `packages/backend/convex/pipeline.ts` | Fail-closed review gate + escalated terminal + review.expired timeout notify | VERIFIED | `classifyReviewDecision` gates every regenerate decision; `escalate()` terminal (status+audit+notify+telemetry, NO send); timeout branch fires `review.expired` notify. Confirmed by direct read of lines 140-337; matches SUMMARY exactly. |
| `packages/backend/convex/cockpit.ts` | Agent-timeout notification (both entry points) + revise cap + fail-closed executePlan guard | VERIFIED | `notifyIfAgentTimeout` wired into `sendCockpitMessage` (line 136) and `resolveRecipients` (line 295); `proposeEmailPlan` revise-cap via `classifyReviewDecision` (line 392); `executePlan` refuses `plan.escalated` before CAS flip/seed/start (line 497). |
| `packages/backend/convex/llm.ts` | Agent-timeout marker (`ConvexError{kind:"agent_timeout"}`) on exhausted double-timeout | VERIFIED | `isTimeoutError` (line 1468) + throw at line 1589; `SMOKE::agent::timeout` offline test seam at line 1880. |
| `packages/backend/convex/notifications.ts` | `notify` single choke point: in-app insert + scheduled external dispatch | VERIFIED | `notify` (internalMutation) inserts then `ctx.scheduler.runAfter(0, internal.notifyExternal.dispatch, ...)`. |
| `packages/backend/convex/notifyExternal.ts` | Best-effort, fail-closed, loop-guarded external email dispatch | VERIFIED | Send-to-self via governed Gmail seam; static subject/body only; swallow-all try/catch that never throws/notifies/dead-letters (the loop guard). |
| `packages/backend/convex/deadLetter.ts` | Dead-letter user notification at both terminals | VERIFIED | `notify(kind:"deadletter")` fires at `onPipelineComplete` (requestId-gated) and `deadLetterRecipient` (always). |
| `packages/backend/convex/schema.ts` | `audit.by_ts` index; `plans.reviseCount`/`plans.escalated`; `escalated` in `requests.status` | VERIFIED | All three confirmed present via grep (lines 28, 119, 235-236). |
| `packages/backend/convex/llmRedaction.test.ts` | §4 scan extended to notify/external call-sites | VERIFIED | Lines 727-779: mutation-checked scans over pipeline/cockpit/deadLetter/notifications/notifyExternal — 33/33 green. |
| `@aws-sdk/client-s3` dependency | Installed, no pinned pre-1.0 component bumped | VERIFIED | Imported in `worm.ts`; per CLAUDE.md §6 this is a new dep, not a pinned-component bump — compliant. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `pipeline.ts` review-gate loop | `@pikar/core classifyReviewDecision` | direct import + call at decision chokepoint | WIRED | Line 23 import, line 278 call; escalate branch returns null before DELIVER `break` (line 319) |
| `cockpit.ts` `proposeEmailPlan`/`executePlan` | `@pikar/core classifyReviewDecision` | direct import + call | WIRED | Line 16 import, line 393 call; `executePlan` early-return guard at line 497 precedes CAS flip |
| `pipeline.ts`/`cockpit.ts`/`deadLetter.ts` | `notifications.notify` | `step.runMutation`/`ctx.runMutation(internal.notifications.notify, ...)` | WIRED | Confirmed at pipeline.ts:152/259, cockpit.ts (notifyIfAgentTimeout, proposeEmailPlan escalate path), deadLetter.ts:64/145 |
| `notifications.notify` | `notifyExternal.dispatch` | `ctx.scheduler.runAfter(0, internal.notifyExternal.dispatch, {tenantId, kind})` | WIRED | notifications.ts:62; grep-proven in llmRedaction.test.ts:778-779 |
| `notifyExternal.dispatch` | `gmail.ts` governed send seam | imports `freshAccessToken`/`buildMime`/`base64Url`/`SEND_ENDPOINT` (no new send verb) | WIRED | notifyExternal.ts:18; reuses the exact governed endpoint, keeping the exact-two-POSTs §4 scan intact |
| `worm.ts exportAudit` | `wormCursor.ts advanceCursor`/`auditSince` | `ctx.runQuery`/`ctx.runMutation(internal.wormCursor...)` | WIRED | worm.ts:54/62/88; advance strictly after `await s3.send` resolves |
| `crons.ts` | `worm.exportAudit` | `crons.daily("worm-export", ..., internal.worm.exportAudit, {})` | WIRED | crons.ts:10 |
| `llm.ts runAgentLoop` timeout | `cockpit.ts notifyIfAgentTimeout` | `ConvexError{kind:"agent_timeout"}` thrown across the `ctx.runAction` boundary, caught in both drivers | WIRED | llm.ts:1589 throw; cockpit.ts:50-58 catch-tail helper wired into both entry points (lines 136, 295) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AGNT-04 | 07-04, 07-06 | Executive Agent timeout triggers notification and escalation/timeout handling | SATISFIED | `notifyIfAgentTimeout` wired into both agent entry points; unit-proven (`runCockpitAgent.test.ts`); the deep-dive smoke of a real timed-out agent turn is the owner human-verify item noted in 07-04-SUMMARY (units cannot substitute for the live notification-surface check) — this is a narrower human item than the two cloud-infra deferrals, already exercised offline. |
| REVW-02 | 07-01, 07-03, 07-04, 07-06 | Edit and reject retry counters enforce thresholds; breaches escalate, notify, and terminate the request safely | SATISFIED | `classifyReviewDecision` shared classifier fixes the unapproved-send bug at BOTH the pipeline and cockpit gates; live-smoke-proven breach terminal (`smoke:pipeline` PASS). |
| REVW-03 | 07-03, 07-06 | Review inactivity timeout triggers an escalation notification | SATISFIED | `pipeline.ts` timeout branch fires `review.expired`; live-smoke-proven (`smoke:pipeline` timeout terminal PASS). |
| OPSG-03 | 07-01, 07-02, 07-06 | Completed request trails are exported on schedule to immutable (WORM) archival storage | SATISFIED (export); sweep explicitly deferred by owner ruling, recorded as SC#4-partial, not a gap | Real S3 PutObject under COMPLIANCE Object Lock; advance-only-after-durable-write; `by_ts` index; live-smoke-proven on stub-skip path; real-bucket durability is the Manual-Only item. |
| OPSG-05 | 07-01, 07-03, 07-04, 07-05, 07-06 | Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events | SATISFIED | `notify` choke point + external dispatch wired at every failure site; §4 scan extended and green; live-smoke-proven DLQ notification (`smoke:dlq` PASS); real email deliverability is the Manual-Only item. |

No orphaned requirements — all 5 IDs mapped to Phase 7 in REQUIREMENTS.md appear in at least one plan's `requirements` frontmatter and are cross-referenced above.

### Anti-Patterns Found

None. Scanned all touched Phase-7 files (`worm.ts`, `wormCursor.ts`, `pipeline.ts`, `cockpit.ts`, `notifications.ts`, `notifyExternal.ts`, `deadLetter.ts`, `retention.ts`, `reviewThreshold.ts`, `notificationTemplates.ts`) for TODO/FIXME/XXX/HACK/"not implemented"/"coming soon" — zero matches. No stub returns, no empty handlers, no placeholder implementations.

### Offline Suite Results (re-run by verifier, not taken on faith)

- `pnpm --filter @pikar/core test` → **145/145 green** (confirmed by direct run).
- `pnpm --filter @pikar/backend test` → **398/399 green**, sole red = `audit.test.ts` `auditCounts` "Component auditCounts is not registered" — a documented pre-existing `convex-test` limitation (aggregate component doesn't register under the test harness), independently confirmed as a non-regression: no Phase-7-touched file is in the failing test's call path.
- `node scripts/check-playbooks.mjs` → **exit 0** (confirmed by direct run).
- All three watched playbooks (`audit-dead-letter.md`, `cockpit.md`, `agent-runtime.md`) carry 2026-07-21 07-06 phase-close `Last verified` bumps and explicitly record the SC#4-partial ruling and the two owner-deferred Manual-Only items — confirmed by direct read, not silent.

### Human Verification Required

### 1. Real S3 WORM object under COMPLIANCE Object Lock

**Test:** Provision an S3 bucket with Object Lock enabled at creation + COMPLIANCE default retention; set `WORM_BUCKET`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION` in the Convex deployment env (`npx convex env set`); run `WORM_BUCKET=<bucket> npm run smoke:worm` against the live deployment; inspect one object in the S3 console.
**Expected:** The object carries `ObjectLockMode=COMPLIANCE`, a `RetainUntilDate` roughly 7 years out, a SHA256 checksum, and a delete/overwrite attempt is refused by the bucket.
**Why human:** Requires real cloud infrastructure (an AWS Object-Lock-enabled bucket + credentials) that only the owner can provision; no unit or Node-based smoke can assert real S3 durability. The code path is fully proven otherwise (unit `worm.test.ts` mocked-S3 tests; live `smoke:worm` PASS on the stub-skip branch with `WORM_BUCKET` unset).

### 2. Real external email delivered to a live mailbox

**Test:** With a Gmail OAuth-connected user, trigger each failure class (validation reject, escalation, retry breach, review timeout, agent timeout, dead-letter) and check the mailbox.
**Expected:** One in-app notification AND one external email land per event; a FAILED external send does not recursively trigger another notification.
**Why human:** Requires a live Gmail-connected user session to observe real deliverability; no unit test can prove an email actually arrives in an inbox. The notify choke point, external dispatch, and loop-guard logic are fully unit-proven (`notifications.test.ts`, `llmRedaction.test.ts` §4 scans) and the DLQ path is live-smoke-proven end-to-end (`smoke:dlq` PASS: deadLetters row + audit + in-app notification — only the external-email leg is unverified live).

### Gaps Summary

No code gaps found. Every observable truth derived from the phase goal and Success Criteria is backed by real, substantive, wired implementation confirmed by direct source read (not SUMMARY claims taken on faith) and by an independent re-run of the full offline test suite (145/145 core, 398/399 backend with the sole pre-existing documented non-regression, check-playbooks exit 0). The two open items are cloud-infrastructure provisioning tasks explicitly and correctly scoped out of autonomous verification by the owner's 2026-07-21 ruling (07-CONTEXT.md) and cross-referenced in 07-VALIDATION.md, docs/playbooks/audit-dead-letter.md, and 07-06-SUMMARY.md — they are Manual-Only verifications, not silent gaps. SC#4's hot-audit-table sweep is intentionally out of scope for this phase per the same owner ruling (export-only; §3/ADR-002 kept literally intact).

---

*Verified: 2026-07-21T03:50:00Z*
*Verifier: Claude (gsd-verifier)*
