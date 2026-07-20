# Phase 7: Resilience & Operations Hardening - Research

**Researched:** 2026-07-21
**Domain:** Failure-path hardening across an existing Convex governed pipeline — timeouts, retry-threshold escalation, user-facing notification matrix, dead-letter completeness, WORM (S3 Object Lock) audit export + retention
**Confidence:** HIGH (the substrate is all in-repo and was read directly; the one external library detail — S3 Object Lock PutObject — is verified against AWS docs)

> **This is a HARDENING phase, not greenfield.** Every requirement completes or extends a seam that already exists from Phases 1–3. The research below cites the exact file + line of each seam. The ponytail default (CLAUDE.md §8) is *complete the stub*, never *invent a subsystem*. Almost nothing new should be built; the work is finishing five deliberately-deferred stubs and wiring five notification sites.

---

<user_constraints>
## User Constraints

**No CONTEXT.md exists for Phase 7** (the phase is unplanned — STATE.md top block: "NEXT: /gsd:plan-phase 7"). No `/gsd:discuss-phase` has run. The constraints below are the **binding project conventions** (CLAUDE.md) that gate every plan in this phase, plus the phase framing supplied by the orchestrator. Treat them as locked.

### Locked Decisions (from CLAUDE.md — binding, not discretionary)
- **§1 — Domain logic in pure-TS `packages/*`; `convex/` is a thin adapter.** New pure logic (retention-window math, retry-threshold policy, NDJSON serialization, notification-message templating) goes in `@pikar/core` (or a new pure package) *first*, with unit tests; the Convex function stays thin.
- **§2 — Raw `query`/`mutation`/`action` imports are BANNED outside `convex/lib/functions.ts`.** Use `tenantQuery`/`tenantMutation`; `internalMutation`/`internalAction` are allowed for system paths (workflow/cron callers carry no client identity). The allow-list in `lib/allowlist.ts` is the only exception.
- **§3 — The audit module is insert-only.** `audit.ts` exposes ONLY inserts — no `patch`/`replace`/`delete`. **This directly constrains OPSG-03's "sweep the hot audit copy"** — see Open Question 1. A retention delete, if approved, may NOT live in `audit.ts` and needs its own decision record.
- **§4 — Audit + dead-letter + telemetry + notification payloads carry refs/hashes/ids/counts ONLY** — never raw user content or PII. **Notification `message` strings must be static/templated labels, never interpolated user content** (Pitfall 2). Redact-then-write ordering is a step contract.
- **§5 — No hardcoded agent prompts** (skills registry). Phase 7 touches no prompt; if any escalation copy is model-authored (it should not be), it loads from the registry. Prefer code-owned static strings.
- **§6 — Pinned pre-1.0 component versions must NOT be bumped casually.** `@convex-dev/workflow@0.4.4`, `workpool@0.4.7`, `action-retrier@0.3.1`, `rate-limiter@0.3.2`, `aggregate@0.2.2`, `migrations@0.3.5` (+ `agent@0.6.4`, auth, rag) are EXACT-pinned. **Do NOT bump any of them** — the hardening needs no new component-API surface (verified below). `@aws-sdk/client-s3` is the ONE new dependency (added only now, for OPSG-03, per ponytail).
- **§8 — Ponytail: the laziest solution that works.** Complete the stub over inventing a subsystem. WORM export, the review-timeout notification, the DLQ notification, and the retry-threshold enforcement are all *finish-the-seam*, not *new-build*.
- **§9 — Playbooks + ADRs are definition-of-done.** `docs/playbooks/audit-dead-letter.md` (WORM, DLQ), `agent-runtime.md` (AGNT-04 agent timeout), `cockpit.md` (review/approval path) MUST be updated in the same phase; a retention-delete decision needs a NEW ADR (never edit ADR-002).

### Claude's Discretion (recommend in plans; no user has ruled)
- Whether OPSG-05 ships **channel dispatch (email/push)** or only completes the **in-app** notification matrix (recommend: in-app only — see Open Question 3).
- The **review-inactivity timeout duration** (currently `SEVEN_DAYS` in `pipeline.ts:46`) and the **edit/reject/regenerate thresholds** (currently only `MAX_REGENERATE=3`).
- The **Object Lock retention period** (playbook explicitly defers this to Phase 7).
- Whether to **pin the notification `kind` enum** (currently `v.string()`, open) to a closed union.

### Deferred / Out of Scope
- **DLQ replay** — the `replayed` deadLetters status is reserved but deliberately unwritten until idempotency is specified (audit-dead-letter.md "Known gaps"). Do NOT build replay in Phase 7 unless a requirement demands it (none does).
- **External notification providers beyond in-app** unless discretion resolves toward them.
- Anything touching the retired `/submit` + `/review` UX beyond the backend spine it shares with the cockpit.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (from REQUIREMENTS.md) | Research Support — the seam that already exists |
|----|-----------------------------------|--------------------------------------------------|
| **AGNT-04** | Executive Agent timeout triggers notification and escalation/timeout handling | `runCockpitAgent` (`llm.ts`) already bounds every model call with `AbortSignal.timeout(CALL_TIMEOUT_MS = 45_000)` (`llm.ts:82,1513`) + `stopWhen: stepCountIs(8)` (`llm.ts:1512`). On abort it throws → `isFallbackEligible` → one `CHEAP_MODEL` retry → else a non-dead-ending conversational error turn (agent-runtime.md data-flow step 5). **What's missing:** no `notify`, no escalation on the exhausted-timeout path. The seam is the driver's `catch`/`finally` in `cockpit.ts sendCockpitMessage` (agent-runtime.md invariant 11 — the `finally` already exists for the activity-trace terminalization). |
| **REVW-02** | Edit and reject retry counters enforce thresholds; breach escalates, notifies, terminates safely | `pipeline.ts` review-gate loop already accumulates `decisionCounts[evt.decision]` (`pipeline.ts:240`) and enforces `MAX_REGENERATE = 3` (`pipeline.ts:50`). **The `MAX_REGENERATE` ponytail comment (`pipeline.ts:47-49`) names REVW-02 as its upgrade path** and flags a latent bug: past the cap a `regenerate` decision falls through to delivery (an unapproved send) — the UI stops offering it but the backend does not fail closed. **What's missing:** edit/reject thresholds, backend enforcement (fail closed), and the escalate→notify→terminate-safely path. |
| **REVW-03** | Review inactivity timeout → escalation notification (scheduled-event race on the review gate) | The awaitEvent-timeout race is fully built: `review.ts` (`armTimeout`→`ctx.scheduler.runAfter`→`fireTimeout`→`workflow.sendEvent`) + the `pipeline.ts` timeout branch (`pipeline.ts:233-238`: `expired` status + `review.expired` audit + `expired` telemetry). **What's missing:** the branch fires NO `notify`. This is a ~3-line addition. |
| **OPSG-03** | Completed request trails export on schedule to immutable (WORM) archival storage | `worm.ts` (stub action, daily-cron-wired), `wormCursor.ts` (`getCursor`/`auditSince`/`advanceCursor`), `crons.ts:10` (daily 03:00 UTC). The stub already documents the exact real-export recipe inline (`worm.ts:41-56`). **What's missing:** the real `@aws-sdk/client-s3` PutObject with COMPLIANCE Object Lock + checksum, cursor-advance-only-after-durable-write, and the retention sweep of the hot copy. |
| **OPSG-05** | Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events | `notifications.ts notify` (in-app insert) exists; the table is the OPSG-05 seam (`notifications.ts:4-6`). **Already firing:** validation rejection + rate-limit (`requests.ts:66,90`), guardrail.blocked (`pipeline.ts:131`), awaiting_reauth (`llm.ts:637,792`, `gmailAuth.ts`). **Missing sites:** escalations (REVW-02/AGNT-04), retry-limit breaches (REVW-02), review timeout (REVW-03), and dead-letter events (`deadLetter.onPipelineComplete` + `deadLetterRecipient` write the badge/audit but no user `notify`). |
</phase_requirements>

## Summary

Phase 7 is a *completion* phase. Five deliberately-deferred stubs, each already carrying its own upgrade-path comment, become real: (1) the WORM S3 export in `worm.ts`; (2) the review-inactivity-timeout notification in `pipeline.ts`; (3) the edit/reject retry-threshold enforcement + escalation, extending the existing `decisionCounts`/`MAX_REGENERATE` machinery; (4) the Executive-Agent-timeout notification in the cockpit driver's existing `finally`; and (5) the full user-facing notification matrix, adding `notify` calls at the escalation/timeout/dead-letter sites that today only write audit/badge rows. The awaitEvent-timeout race pattern (`review.ts`), the DLQ `onComplete` handler (`deadLetter.ts`), the insert-only audit + aggregate, the in-app `notifications` table, and the review-gate decision union all already exist and are tested — the work is wiring, not architecture.

Two findings materially shape planning. **First, a scope/ownership fork:** the awaitEvent-timeout review gate with `decisionCounts` + `MAX_REGENERATE` lives in the durable-workflow spine (`pipeline.ts`, the retired `/submit` path), while the *live* user path is the cockpit's PLAN-card `executePlan` approval, which has no timeout or retry counters. REVW-02/03's language ("scheduled-event race on the review gate", "the awaitEvent-timeout pattern already demonstrated in Phase 1") targets the `pipeline.ts` substrate — so the ponytail-correct move is to harden that substrate, but the planner must consciously decide whether that satisfies the requirement given the live UX, or whether the concepts must also be ported to the cockpit (Open Question 2). **Second, a real tension in success-criterion #4:** "the hot audit copy is swept per the retention policy" implies *deleting* exported audit rows from Convex, which collides head-on with CLAUDE.md §3 (audit is insert-only) and ADR-002. This is the single most important decision to resolve before planning OPSG-03 (Open Question 1) — it likely needs a new ADR and a delete path that is surgically isolated from the audit module.

**Primary recommendation:** Plan five thin vertical slices, one per requirement, each completing a named stub; push all non-trivial logic (retention/serialization/threshold policy) into pure `@pikar/core` with unit tests; add exactly one new dependency (`@aws-sdk/client-s3`); resolve Open Questions 1–3 with the owner *before* writing the OPSG-03 and REVW-02 plans.

## Standard Stack

### Core (all already installed and EXACT-pinned — do NOT bump, §6)
| Library | Version | Purpose in this phase | Why standard |
|---------|---------|-----------------------|--------------|
| `@convex-dev/workflow` | 0.4.4 | Durable review-gate loop, `awaitEvent`/`sendEvent`, `onComplete` DLQ hook | Already the pipeline spine; the timeout race + DLQ are built on it |
| `@convex-dev/workpool` | 0.4.7 | Delivery retry budget (workpool default) | Already wired; REVW-02 "retry counters" are NOT this (see Don't-Hand-Roll) |
| `@convex-dev/action-retrier` | 0.3.1 | Transient action retry | Installed; NOT the mechanism for human edit/reject retries |
| `@convex-dev/rate-limiter` | 0.3.2 | Submit rate limit (exists); optional escalation-notification throttle | Prevents notification spam if a loop escalates repeatedly |
| `@convex-dev/aggregate` | 0.2.2 | `auditCounts` — the unbounded-audit count without `.collect()` | Already the reason audit counts don't hard-fail; relevant if OPSG-03 counts export volume |
| `@convex-dev/migrations` | 0.3.5 | OPSG-06 tracked migrations | Only needed if a NON-optional field/backfill is added (optional fields need none) |
| Convex built-in scheduler | (in `convex@1.42.1`) | `ctx.scheduler.runAfter` (timeout arm), `cronJobs()` daily (WORM), retention-sweep cron | Native — no component needed (the review-timeout and WORM cron already use it) |

### Supporting (the ONE new dependency)
| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `@aws-sdk/client-s3` | latest v3 (add now) | Real WORM PutObject with COMPLIANCE Object Lock + checksum | OPSG-03 only. Added ONLY now (ponytail: no dep until used — `worm.ts:52-54` says exactly this). `worm.ts` already carries `"use node"` so the node-only SDK can import cleanly. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@aws-sdk/client-s3` PutObject | S3 REST via `fetch` (SigV4 by hand) | Rejected — SigV4 signing + Object-Lock checksum headers by hand is exactly the "don't hand-roll" trap; the SDK is node-only which is why `worm.ts` is `"use node"` |
| `action-retrier` for review retries | — | Category error: action-retrier retries *transient action failures*, not *human edit/reject decisions*. REVW-02 counters are `decisionCounts` in the workflow loop, not retrier attempts |
| A new S3-compatible provider (R2/MinIO) | — | Out of scope; the whole WORM design (playbook + `worm.ts`) is S3 Object Lock COMPLIANCE mode. Do not re-open the provider decision |

**Installation (OPSG-03 plan only):**
```bash
pnpm --filter @pikar/backend add @aws-sdk/client-s3
```

## Architecture Patterns

### The reuse map (every requirement → its existing seam)
```
packages/backend/convex/
├── worm.ts              # OPSG-03: STUB action → real PutObject (lines 41-56 are the recipe)
├── wormCursor.ts        # OPSG-03: getCursor / auditSince (full-scan; needs by_ts index) / advanceCursor
├── crons.ts             # OPSG-03: daily 03:00 UTC worm-export (add retention-sweep cron here)
├── review.ts            # REVW-03: armTimeout → fireTimeout (scheduled-event race, issue #177 workaround)
├── pipeline.ts          # REVW-02/03: review-gate loop, decisionCounts, MAX_REGENERATE, timeout branch, stopBlocked
├── deadLetter.ts        # OPSG-05: onPipelineComplete + deadLetterRecipient (add notify)
├── deadLetters.ts       # (operator read/resolve — unchanged)
├── notifications.ts     # OPSG-05: notify(tenantId, kind, message, requestId?) — the insert seam
├── cockpit.ts           # AGNT-04: sendCockpitMessage driver (finally already exists for trace)
├── llm.ts               # AGNT-04: runCockpitAgent CALL_TIMEOUT_MS abort + fallback
├── telemetry.ts         # writeTerminal — reuse for any new terminal (escalated)
└── schema.ts            # add: optional counter fields / new terminal status / (maybe) audit by_ts index
packages/core/           # NEW pure logic goes here first (§1): retention window, NDJSON serialize,
                         # retry-threshold policy, notification-message templates
```

### Pattern 1: Complete the WORM stub (OPSG-03)
**What:** Replace the `throw` in `worm.ts` real-export branch with an NDJSON serialize + PutObject under COMPLIANCE Object Lock, advancing the cursor ONLY after a confirmed durable write.
**When to use:** OPSG-03 plan.
**Anchor (already in the file):**
```typescript
// worm.ts:41-56 — the stub documents the exact recipe:
// const rows = await ctx.runQuery(internal.wormCursor.auditSince, { since });
// serialize rows → NDJSON, PutObject with COMPLIANCE Object Lock + checksum,
// then ONLY after a confirmed durable write:
//   const maxTs = rows.reduce((m, r) => Math.max(m, r.ts), since);
//   await ctx.runMutation(internal.wormCursor.advanceCursor, { ts: maxTs });
```
```typescript
// The verified PutObject shape (AWS docs — see Sources):
new PutObjectCommand({
  Bucket: process.env.WORM_BUCKET,
  Key: `audit/${datePrefix}/${since}-${maxTs}.ndjson`,
  Body: ndjson,
  ChecksumAlgorithm: "SHA256",            // REQUIRED with Object Lock retention (see Pitfall 4)
  ObjectLockMode: "COMPLIANCE",           // must be paired with a retain-until date
  ObjectLockRetainUntilDate: new Date(Date.now() + RETENTION_MS),
});
```

### Pattern 2: Add a notification at an existing terminal (OPSG-05, REVW-03)
**What:** At each failure terminal that today writes only audit/telemetry, add one `internal.notifications.notify` call — mirroring `pipeline.ts stopBlocked` (`pipeline.ts:131-136`) which already pairs a `guardrail.blocked` audit with a `notify`.
**Example (the review-timeout branch, REVW-03):**
```typescript
// pipeline.ts:233 — the timeout branch today:
if (evt.kind === "timeout") {
  await setStatusStep("expired");
  await audit("review.expired");
  // ADD (REVW-03): the escalation notification the branch omits today
  await step.runMutation(internal.notifications.notify, {
    tenantId, kind: "review.expired", requestId,
    message: "Review timed out — the request expired without a decision",
  });
  await writeTelemetry("expired");
  return null;
}
```

### Pattern 3: Retry-threshold enforcement that fails closed (REVW-02)
**What:** Extend the review-gate loop to enforce edit/reject/regenerate thresholds and, on breach, escalate→notify→terminate safely (NO send). Push the threshold *policy* into `@pikar/core` (pure, testable); the workflow just calls it.
**Fixes a latent bug:** today, past `MAX_REGENERATE` a `regenerate` decision falls through the loop to delivery (`pipeline.ts:250` — the `attempt < MAX_REGENERATE` guard fails, control breaks out to `DELIVER`, an unapproved send). Backend enforcement must fail closed, not rely on the UI hiding the button.
**Shape:** a new safe terminal (reuse `failed`, or add `escalated` to the status union — additive, optional-on-read, no migration) + `review.escalated` audit + `retry.limit` notify + terminal telemetry (reuse `telemetry.writeTerminal`, whose `reviewOutcome` union may need an `escalated` member).

### Anti-Patterns to Avoid
- **Advancing the WORM cursor before a confirmed durable PutObject** — marks unexported rows as exported = permanent compliance hole (`worm.test.ts` enforces the stub never advances; the real path must advance only after success).
- **Deleting audit rows through `audit.ts`** — violates §3/ADR-002. Any retention delete is a separate, loudly-commented system function gated on `ts <= cursor` (Open Question 1).
- **Interpolating user content into a notification `message`** — §4. Notification strings are static labels/templates over refs/counts (Pitfall 2).
- **Using `action-retrier` for the REVW-02 "retry counters"** — wrong layer (human decisions ≠ transient action retries).
- **A second `"use node"` module** — agent-runtime.md invariant 7: re-trips the TS circular-inference cliff. WORM already lives in the sole-plus-`worm.ts` node boundary; keep DB-touching cursor logic in the non-node `wormCursor.ts` (the existing split).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| S3 upload + SigV4 + Object-Lock checksum | Manual `fetch` + signing | `@aws-sdk/client-s3` PutObjectCommand | Object Lock requires a content checksum header (Content-MD5 or `x-amz-sdk-checksum-algorithm`); the SDK computes/sends it. Hand-signing is the classic trap. |
| Scheduled review timeout | A polling loop / setInterval | `ctx.scheduler.runAfter` + `workflow.sendEvent` (already `review.ts`) | Workflows can't touch `ctx.scheduler`; the arm-from-inside-a-step + attempt-namespaced-event race (issue #177 workaround) is already built and tested. |
| Daily export / retention schedule | Custom timer | `cronJobs().daily(...)` (already `crons.ts`) | Native Convex cron; WORM cron exists, add the sweep cron beside it. |
| Unbounded audit counting for export sizing | `.collect()` + `.length` | `@convex-dev/aggregate` auditCounts | `.collect()` on the unbounded audit table eventually exceeds Convex read limits and hard-fails (the exact reason aggregate exists — Phase 2 note). |
| Terminal telemetry row | Ad-hoc insert | `telemetry.writeTerminal` (idempotent by correlationId) | Write-once, idempotent-by-cid already handled; a new terminal reuses it. |

**Key insight:** in this phase almost every "don't hand-roll" resolves to *"the seam is already in the repo — call it."* The only genuinely new external capability is the S3 PutObject.

## Common Pitfalls

### Pitfall 1: The review-gate substrate is in the RETIRED path, not the live cockpit
**What goes wrong:** A plan hardens `pipeline.ts`/`review.ts` (where `decisionCounts`, `MAX_REGENERATE`, and the awaitEvent-timeout race live) and declares REVW-02/03 done — but the live user approves at the cockpit PLAN card via `executePlan` (a human mutation), which has no timeout, no retry counter, and never enters that workflow gate.
**Why it happens:** Phases 3.1+ retired `/submit` + `/review` and moved approval to the cockpit; the durable review gate stayed in the codebase serving the retired path.
**How to avoid:** Resolve Open Question 2 first. The requirement language ("scheduled-event race on the review gate", "awaitEvent-timeout pattern already demonstrated in Phase 1") points at the `pipeline.ts` substrate, and ponytail says harden what exists — but the planner must state explicitly which path each success criterion is validated against, and whether the cockpit needs a parallel guard.
**Warning sign:** A plan that touches `pipeline.ts` but never mentions `cockpit.ts executePlan`, or vice-versa, without a documented decision.

### Pitfall 2: A notification message becomes a PII leak
**What goes wrong:** An escalation/timeout notification interpolates the email subject, recipient, or draft into `message` to be "helpful" → raw user content lands in a queryable notifications row (and any future channel dispatch emails it out).
**Why it happens:** `notifications.notify` takes a free `message: v.string()`; nothing structurally stops a caller passing content.
**How to avoid:** Keep `message` a static label or a template over refs/counts only (the existing sites all do — "Request Rejected — Validation Failed", "Request stopped — {LABEL}"). Consider a `llmRedaction.test.ts`-style static scan asserting no notify call-site interpolates a content field. Recommend pinning `kind` to a closed union so the UI maps icons and typos fail at compile.
**Warning sign:** Any `notify({ message: \`...${plan.subject}...\` })`.

### Pitfall 3: Advancing the WORM cursor on a partial/failed export
**What goes wrong:** The cursor advances after a PutObject that 5xx'd or wrote a truncated body → those audit rows are marked exported, never re-tried, and are eventually swept from the hot copy = unrecoverable compliance gap.
**Why it happens:** Optimistic cursor advance; the stub deliberately never advances (`worm.test.ts` locks this) so it's easy to get wrong when adding the real path.
**How to avoid:** Advance the cursor ONLY after the PutObject promise resolves successfully (and, ideally, after a HeadObject/checksum confirmation). Serialize + PutObject one bounded window per run (`auditSince` already slices `limit ?? 10_000`); on any throw, do not advance — the next cron retries the same window (PutObject of the same key is idempotent).
**Warning sign:** `advanceCursor` reachable on a code path where the PutObject result wasn't awaited/checked.

### Pitfall 4: Object Lock silently rejects a PutObject without a checksum
**What goes wrong:** PutObject with `ObjectLockMode`/`ObjectLockRetainUntilDate` but no checksum header fails (or the object isn't retained), and the bucket must have had Object Lock enabled *at creation* — it cannot be turned on afterward.
**Why it happens:** These are AWS preconditions, not obvious from the SDK types. `worm.ts:47-51` already warns about both.
**How to avoid:** (a) Bucket created with Object Lock ENABLED (infra/ops step, not code — document it in the playbook + a runbook). (b) Always send `ChecksumAlgorithm: "SHA256"` (or Content-MD5) on the PutObject — **required** for a retention-configured upload (verified, AWS docs). (c) `ObjectLockMode` and `ObjectLockRetainUntilDate` must be paired.
**Warning sign:** A smoke that "succeeds" but the object has no retention when inspected in the console.

### Pitfall 5: The retention sweep deletes rows that never reached S3
**What goes wrong:** A retention cron deletes audit rows by age alone, catching rows past the WORM cursor (not yet exported) → data loss with no immutable copy.
**Why it happens:** Age and export-status are different axes; a naive `createdAt < cutoff` sweep ignores the cursor.
**How to avoid:** The sweep deletes ONLY rows with `ts <= lastExportedTs` AND older than the retention window — export-confirmed first, then aged. And this delete path is NOT in `audit.ts` (§3). Resolve Open Question 1 before building it.
**Warning sign:** A sweep query that filters on `createdAt`/`ts` but not on the export cursor.

### Pitfall 6: `auditSince` full-scans the unbounded audit table
**What goes wrong:** `wormCursor.auditSince` (`wormCursor.ts:35`) does `ctx.db.query("audit").collect()` then filters — fine at stub volume, but the audit table is unbounded and this will eventually exceed Convex read limits and hard-fail the export.
**Why it happens:** The Phase-1 stub explicitly deferred the index (`wormCursor.ts:31-34` ponytail comment; audit-dead-letter.md "Known gaps" — "No `by_ts` index on audit; add when Phase 7 export volume demands it").
**How to avoid:** Add a `by_ts` index to the `audit` table and rewrite `auditSince` to `withIndex("by_ts", q => q.gt("ts", since)).take(limit)`. Adding an index is not a write path (Convex backfills automatically) — no migration needed. Do this in the OPSG-03 plan.
**Warning sign:** Export works in a fresh dev deployment, times out in a long-lived one.

## Code Examples

### The scheduled-event timeout race (REVW-03 substrate — already built, extend the branch)
```typescript
// review.ts:53 — armTimeout (called from inside a workflow step; workflows can't touch scheduler)
export const armTimeout = internalMutation({
  args: { workflowId: vWorkflowId, correlationId: v.string(), timeoutMs: v.number(), attempt: v.number() },
  handler: async (ctx, { workflowId, correlationId, timeoutMs, attempt }) => {
    const scheduledId = await ctx.scheduler.runAfter(timeoutMs, internal.review.fireTimeout,
      { workflowId, correlationId, attempt });
    await ctx.db.insert("pendingTimeouts", { workflowId, correlationId, scheduledId, attempt });
  },
});
// The three defensive rules (review.ts:8-16): cancel on real decision, attempt-namespace the event
// (`review:${cid}:${attempt}`), typed decision union — all already handled. REVW-03 only adds notify.
```

### The DLQ onComplete handler (OPSG-05 — add notify beside the existing audit)
```typescript
// deadLetter.ts:43 — already writes the audit + failed status + telemetry:
await ctx.runMutation(internal.audit.log, { tenantId, correlationId,
  eventType: "deadletter.written", actor: "system",
  payload: { workflowId: String(workflowId), kind: result.kind, status: "new" } });
// OPSG-05 ADD: the user-facing notification this handler omits today
// (OPSG-07 gave the OPERATOR a badge; OPSG-05 gives the USER a notification):
// await ctx.runMutation(internal.notifications.notify, {
//   tenantId, kind: "deadletter", requestId,     // requestId is in context.payload
//   message: "A request failed and was archived for review" });
```

### The existing notify contract (OPSG-05 — the insert seam, unchanged)
```typescript
// notifications.ts:38 — internal so trusted callers pass a resolved tenantId
export const notify = internalMutation({
  args: { tenantId: v.string(), kind: v.string(), message: v.string(),
          requestId: v.optional(v.id("requests")) },
  handler: async (ctx, { tenantId, kind, message, requestId }) => {
    await ctx.db.insert("notifications", { tenantId, kind, requestId, message, read: false, createdAt: Date.now() });
  },
});
// ponytail (notifications.ts:6): "in-app only until OPSG-05 — add channel dispatch in notify then."
// Recommend: keep in-app; channel dispatch stays the ceiling (Open Question 3).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Convex `crons.interval` old API | `cronJobs().daily(...)` | current (`convex@1.42.1`) | Already used in `crons.ts`; no change |
| S3 Object Lock via Content-MD5 only | `x-amz-sdk-checksum-algorithm` (SHA256) accepted + preferred | AWS SDK v3 flexible checksums | Use `ChecksumAlgorithm: "SHA256"` on PutObject; still valid 2026 (AWS docs) |
| ai-sdk `maxSteps` | `stopWhen: stepCountIs(n)` | `ai@7` | Already handled (`llm.ts:1416` ponytail note — do NOT bump) |

**Deprecated/outdated:**
- Nothing in the phase's substrate is deprecated. The pinned pre-1.0 components are current-latest for the repo's `ai@7` pin (e.g. `@convex-dev/agent@0.6.4` is latest and peer-blocked from bumping — §6 moot).

## Open Questions

1. **Does "sweep the hot audit copy" (OPSG-03 SC #4) mean DELETING exported audit rows — and how does that reconcile with §3 / ADR-002 (insert-only audit, "nothing is ever deleted in Convex")?** — HIGHEST PRIORITY.
   - What we know: audit-dead-letter.md states "Retention: nothing is ever deleted in Convex; the immutable copy is the (future) S3 export" and "Object Lock retention *period* is not yet specified — decide it in Phase 7." §3 bans mutating functions in the audit module.
   - What's unclear: whether Phase 7 introduces a post-export GC that deletes `ts <= cursor` rows from the hot table, and whether that's compatible with the insert-only contract.
   - Recommendation: Treat this as an owner decision *before* planning OPSG-03. If the sweep deletes: it must be a NEW, loudly-commented system function OUTSIDE `audit.ts`, gated on `ts <= lastExportedTs` AND age > retention window, and it needs a **new ADR** (never edit ADR-002) recording that immutability has moved to S3 so hot-copy GC of already-archived rows is permitted. If the sweep does NOT delete audit (keeps §3 pure), then "sweep" must mean something narrower (e.g. mark/index, or sweep DLQ/notifications) — confirm the intent. **Do not guess.**

2. **REVW-02/03 + AGNT-04: harden the durable-workflow review gate (`pipeline.ts`, retired `/submit` path), the live cockpit `executePlan` path, or both?**
   - What we know: the awaitEvent-timeout race + `decisionCounts` + `MAX_REGENERATE` are in `pipeline.ts`/`review.ts`; the live approval is the cockpit PLAN card (`executePlan`, no timeout/counters). The success-criteria language names the awaitEvent-timeout pattern.
   - What's unclear: whether hardening the substrate satisfies the requirement given the cockpit is the shipped UX.
   - Recommendation: Harden the `pipeline.ts`/`review.ts` substrate (ponytail: complete what exists; the requirement language targets it), and explicitly document in each plan which path its success criterion is validated against. Flag to the owner that the cockpit approval path has no equivalent timeout/retry guard today, and get a ruling on whether AGNT-04's agent-timeout notification (which IS on the live cockpit driver) plus the substrate hardening is sufficient, or the cockpit also needs a review-inactivity/retry guard.

3. **OPSG-05: in-app only, or add channel dispatch (email/push)?**
   - What we know: `notifications.ts:6` + `gmailAuth.ts:165-167` both mark channel dispatch as the OPSG-05 growth point; a gmailAuth↔internal type cycle is deliberately left unbroken "until OPSG-05 adds channel dispatch."
   - What's unclear: whether the requirement ("notifications fire") is satisfied by in-app rows.
   - Recommendation: Complete the **in-app** matrix (satisfies "notifications fire"; the live UI already renders `notifications.list`). Keep channel dispatch a ponytail ceiling for a later phase — sending notification emails is fragile under Gmail Testing-mode 7-day tokens and adds a delivery-failure surface. If the owner wants email/push, it's an additive `notify` channel-dispatch branch + breaking the gmailAuth cycle. Flag, don't assume.

4. **Thresholds + durations:** the review-inactivity timeout (`SEVEN_DAYS` today) and the edit/reject/regenerate thresholds (`MAX_REGENERATE=3` today) — keep, or change, and per-tenant or global?
   - Recommendation: Keep global constants in `@pikar/core` (the `MAX_REGENERATE` ponytail comment already names "per-tenant policy" as the upgrade path); do not build per-tenant policy unless asked. Confirm the numeric values with the owner.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is REQUIRED and the orchestrator builds VALIDATION.md from it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + `convex-test@0.0.54` (backend), Playwright (web E2E), plain-node smoke scripts (live deployment) |
| Config file | `packages/backend/vitest.config.*` (existing); pure-package tests under `packages/core`, `packages/pii` |
| Quick run command | `pnpm --filter @pikar/backend test` (deterministic, free, mocks the model) |
| Full suite command | `pnpm --filter @pikar/backend test && pnpm --filter @pikar/core test` + live smokes |

**Load-bearing constraint (agent-runtime.md + audit-dead-letter.md):** **workflows do NOT run under `convex-test`.** The review-gate loop, the DLQ `onComplete`, and the WORM cron are workflow/scheduler-driven, so their end-to-end behavior is proven by **live smoke scripts** (`smoke:dlq`, `smoke:pipeline`, `smoke:worm`, `smoke:fanout` in `packages/backend/package.json`), not unit tests. Push every piece of *logic* into pure `@pikar/core` so it IS unit-testable; the workflow just orchestrates.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPSG-03 | Stub never advances cursor; real path advances only after durable PutObject | unit | `pnpm --filter @pikar/backend test worm` | ✅ `worm.test.ts` (extend for real path) |
| OPSG-03 | audit rows → NDJSON serialization (pure) | unit | `pnpm --filter @pikar/core test` | ❌ Wave 0 (new `@pikar/core` serialize + test) |
| OPSG-03 | `auditSince` by_ts index (no full scan) | unit | `pnpm --filter @pikar/backend test worm` | ✅ extend `worm.test.ts` |
| OPSG-03 | Real PutObject under COMPLIANCE Object Lock, checksum sent | live smoke | `npm run smoke:worm` (needs Object-Lock bucket + AWS creds in Convex env) | ✅ `smoke:worm` exists (stub-era; extend) |
| OPSG-03 | Retention sweep deletes only `ts <= cursor` + aged | unit + live smoke | `pnpm --filter @pikar/core test` (window math) + smoke | ❌ Wave 0 (blocked on Open Question 1) |
| REVW-02 | Edit/reject/regenerate threshold policy (pure) | unit | `pnpm --filter @pikar/core test` | ❌ Wave 0 (new threshold module + test) |
| REVW-02 | Breach → escalate + notify + terminate (no send), fail closed | live smoke | `npm run smoke:pipeline` (workflow path) | ✅ `smoke:pipeline` exists (extend for breach) |
| REVW-03 | `fireTimeout` delivers timeout event; timeout branch fires notify | unit | `pnpm --filter @pikar/backend test review` | ✅ `review.ts` testable; add notify assertion (`fireTimeout` is an internalMutation) |
| REVW-03 | End-to-end review-expiry → expired + notification | live smoke | `npm run smoke:pipeline` | ✅ extend |
| AGNT-04 | Agent timeout (abort exhausted) → notification, non-dead-ending | unit (mock-model timeout) | `pnpm --filter @pikar/backend test runCockpitAgent` | ✅ `runCockpitAgent.test.ts` (add timeout→notify case) |
| OPSG-05 | notify fires at each site (validation/escalation/retry/timeout/DLQ) | unit | `pnpm --filter @pikar/backend test` (deadLetter, review, requests) | ✅ per-site (extend `deadLetters.test.ts` / add assertions) |
| OPSG-05 | Notification `message`/payload carries no raw content (§4) | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ `llmRedaction.test.ts` (extend scan scope to notify sites) |

### Sampling Rate
- **Per task commit:** `pnpm --filter @pikar/backend test <touched-file>` + `pnpm --filter @pikar/core test`
- **Per wave merge:** full `pnpm --filter @pikar/backend test && pnpm --filter @pikar/core test` + `check-playbooks`
- **Phase gate:** full suite green + the live smokes that only a running deployment can prove (`smoke:worm` with a real Object-Lock bucket, `smoke:pipeline` review-expiry/breach, `smoke:dlq` notification) + owner human-verify of the notification matrix + one real WORM object inspected in the S3 console (checksum + retention present).

### Wave 0 Gaps
- [ ] `@pikar/core` retention/serialization module — NDJSON serialize of audit rows + retention-window predicate + `by_ts` window helper — covers OPSG-03
- [ ] `@pikar/core` review-threshold policy module — edit/reject/regenerate threshold + breach classifier — covers REVW-02
- [ ] `@pikar/core` (or extend existing) notification-message templates — static, refs/counts-only — covers OPSG-05 §4
- [ ] `@aws-sdk/client-s3` install (OPSG-03 plan) — the ONE new dependency
- [ ] `audit` table `by_ts` index (schema) + `auditSince` rewrite — covers OPSG-03 Pitfall 6
- [ ] Decision record (new ADR) for the audit retention sweep IF it deletes — blocked on Open Question 1
- [ ] Extend `llmRedaction.test.ts` scan scope to notify call-sites (§4) and to `deadLetter.ts`/`worm.ts` payloads (audit-dead-letter.md "Known gaps" — not every audit caller is scanned yet)

## Sources

### Primary (HIGH confidence — read directly in-repo)
- `packages/backend/convex/worm.ts`, `wormCursor.ts`, `crons.ts` — WORM stub + cursor + schedule (OPSG-03)
- `packages/backend/convex/review.ts`, `pipeline.ts` — awaitEvent-timeout race, `decisionCounts`, `MAX_REGENERATE`, timeout/blocked branches (REVW-02/03)
- `packages/backend/convex/deadLetter.ts`, `deadLetters.ts`, `notifications.ts`, `telemetry.ts`, `requests.ts` — DLQ handlers, notify seam, terminal telemetry, existing notify sites (OPSG-05)
- `packages/backend/convex/llm.ts` (CALL_TIMEOUT_MS/abort/fallback), `cockpit.ts` driver — Executive Agent timeout (AGNT-04)
- `packages/backend/convex/schema.ts` — audit/deadLetters/notifications/telemetry/pendingTimeouts/exportCursors/requests/plans tables + indexes
- `docs/playbooks/audit-dead-letter.md`, `agent-runtime.md`, `cockpit.md` — invariants, known gaps, the WORM/DLQ/retention notes and the Phase-7 hooks
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `CLAUDE.md`, `.planning/config.json` — requirements, phase framing, binding conventions
- `packages/backend/package.json` — exact pinned component versions (§6)

### Secondary (MEDIUM–HIGH confidence — verified against AWS official docs, 2026)
- S3 Object Lock PutObject: `ObjectLockMode`/`ObjectLockRetainUntilDate` must be paired; a checksum (Content-MD5 or `x-amz-sdk-checksum-algorithm`) is REQUIRED for a retention-configured upload; COMPLIANCE mode cannot be shortened/overwritten; bucket must have Object Lock enabled at creation — [AWS S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), [PutObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html), [Object Lock considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html)

### Tertiary (LOW confidence — none load-bearing)
- (none — all claims are grounded in repo files or AWS primary docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions read from package.json; all seams read directly
- Architecture / reuse map: HIGH — every seam cited by file+line; playbooks corroborate the Phase-7 hooks
- Pitfalls: HIGH — most are transcribed from the stubs' own inline warnings + playbook "known gaps"
- S3 Object Lock mechanics: MEDIUM-HIGH — verified against AWS docs; the actual PutObject + bucket setup is unproven until the live smoke against a real Object-Lock bucket
- Scope forks (Open Questions 1–2): flagged, NOT resolved — require owner decisions before planning OPSG-03 and REVW-02

**Research date:** 2026-07-21
**Valid until:** ~2026-08-20 (stable substrate; the only fast-moving external is AWS SDK, and the pinned Convex components are frozen by §6)
