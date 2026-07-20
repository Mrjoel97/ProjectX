---
phase: 7
slug: resilience-operations-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Built from 07-RESEARCH.md
> "## Validation Architecture", adjusted for the owner rulings in 07-CONTEXT.md (audit sweep DEFERRED →
> export-only, so no delete-path test + no new ADR; OPSG-05 adds EXTERNAL email/push channel tests;
> REVW-02/03 + AGNT-04 harden BOTH the live cockpit path and the retired workflow path).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + `convex-test@0.0.54` (backend); pure-package Vitest (`@pikar/core`); Playwright (web E2E); plain-node smoke scripts (live deployment) |
| **Config file** | `packages/backend/vitest.config.*` (existing); pure tests under `packages/core` |
| **Quick run command** | `pnpm --filter @pikar/backend test <touched>` + `pnpm --filter @pikar/core test` |
| **Full suite command** | `pnpm --filter @pikar/backend test && pnpm --filter @pikar/core test` + live smokes |
| **Estimated runtime** | ~30–60s unit; live smokes separate |

**Load-bearing constraint:** **workflows do NOT run under `convex-test`.** The review-gate loop, the DLQ
`onComplete`, and the WORM cron are workflow/scheduler-driven — their end-to-end behavior is proven by
**live smoke scripts** (`smoke:dlq`, `smoke:pipeline`, `smoke:worm`, `smoke:fanout`), not unit tests.
Push every piece of *logic* into pure `@pikar/core` so it IS unit-testable; the workflow just orchestrates.

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @pikar/backend test <touched>` + `pnpm --filter @pikar/core test`
- **After every plan wave:** full `pnpm --filter @pikar/backend test && pnpm --filter @pikar/core test` + `node scripts/check-playbooks.mjs`
- **Before `/gsd:verify-work`:** full suite green + the live smokes + owner human-verify of the notification matrix
- **Max feedback latency:** ~60 seconds (unit)

---

## Per-Requirement Verification Map

> Requirement-granularity scaffold (the planner assigns task IDs as plans are written; the 06 precedent).

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| OPSG-03 | audit rows → NDJSON serialization (pure) | unit | `pnpm --filter @pikar/core test` | ❌ W0 (new serialize + test) | ⬜ pending |
| OPSG-03 | Stub never advances cursor; real path advances only after durable PutObject | unit | `pnpm --filter @pikar/backend test worm` | ✅ `worm.test.ts` (extend) | ⬜ pending |
| OPSG-03 | `auditSince` uses `by_ts` index (no full scan) | unit | `pnpm --filter @pikar/backend test worm` | ❌ W0 (schema index + rewrite) | ⬜ pending |
| OPSG-03 | Real PutObject under COMPLIANCE Object Lock, checksum sent | live smoke | `npm run smoke:worm` (Object-Lock bucket + AWS creds) | ✅ `smoke:worm` (extend from stub) | ⬜ pending |
| REVW-02 | Edit/reject/regenerate threshold + breach classifier (pure) | unit | `pnpm --filter @pikar/core test` | ❌ W0 (new threshold module) | ⬜ pending |
| REVW-02 | Breach → escalate + notify + terminate, NO send (fail closed) — BOTH paths | unit + live smoke | `pnpm --filter @pikar/backend test` + `npm run smoke:pipeline` | ✅ extend (pipeline + cockpit) | ⬜ pending |
| REVW-02 | Latent bug fixed: regenerate past MAX_REGENERATE cannot deliver (unapproved-send guard) | unit | `pnpm --filter @pikar/backend test pipeline` + cockpit | ✅ add fail-closed case | ⬜ pending |
| REVW-03 | `fireTimeout` delivers timeout event; timeout branch fires notify | unit | `pnpm --filter @pikar/backend test review` | ✅ `review.ts` (+ notify assertion) | ⬜ pending |
| REVW-03 | End-to-end review-expiry → expired + notification | live smoke | `npm run smoke:pipeline` | ✅ extend | ⬜ pending |
| AGNT-04 | Agent timeout (abort exhausted) → notification, non-dead-ending | unit (mock-model timeout) | `pnpm --filter @pikar/backend test runCockpitAgent` | ✅ add timeout→notify case | ⬜ pending |
| OPSG-05 | in-app notify fires at each site (validation/escalation/retry/timeout/DLQ) | unit | `pnpm --filter @pikar/backend test` | ✅ per-site (extend) | ⬜ pending |
| OPSG-05 | EXTERNAL email/push dispatch fires, best-effort, fails closed to in-app, no notify-loop | unit + live smoke | `pnpm --filter @pikar/backend test` + `npm run smoke:dlq` | ❌ W0 (external adapter) | ⬜ pending |
| OPSG-05 | Notification `message`/payload carries no raw content (§4) | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend scan scope to notify sites | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `@pikar/core` retention/serialization module — NDJSON serialize of audit rows + `by_ts` window helper (OPSG-03)
- [ ] `@pikar/core` review-threshold policy module — edit/reject/regenerate threshold + breach classifier (REVW-02)
- [ ] `@pikar/core` notification-message templates — static, refs/counts-only (OPSG-05 §4)
- [ ] External-notification adapter seam (email via the governed Gmail send; push optional) — best-effort, fail-closed-to-in-app, loop-guarded (OPSG-05)
- [ ] `@aws-sdk/client-s3` install (OPSG-03 plan) — the ONE new dependency (`worm.ts` already `"use node"`)
- [ ] `audit` table `by_ts` index (schema) + `auditSince` rewrite — no full scan of the unbounded table
- [ ] Extend `llmRedaction.test.ts` scan scope to notify call-sites + `deadLetter.ts`/`worm.ts` payloads (§4)

*NOT in Wave 0 (deferred by owner ruling): the audit hot-copy SWEEP/DELETE path + its new ADR — export-only this phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real WORM object lands in S3 with checksum + retention | OPSG-03 | Needs a real Object-Lock bucket + AWS creds; no unit can prove PutObject durability | Run `smoke:worm` against an Object-Lock-enabled bucket; inspect ONE object in the S3 console — confirm `ObjectLockMode`/`RetainUntilDate` + checksum present, and a delete/overwrite attempt is refused |
| The full notification matrix (in-app + email/push) | OPSG-05 | Deliverability + no-loop behavior is observable only live | Trigger each failure class (validation reject, escalation, retry breach, review timeout, agent timeout, dead-letter); confirm one in-app notification AND one external message per event, and that a FAILED send does not recursively notify |
| Review-expiry / breach end-to-end | REVW-02, REVW-03 | Scheduler + workflow timing not unit-testable | `smoke:pipeline` drives expiry + breach; confirm expired/terminated status, notification fired, and NO send occurred |

---

## Nyquist Notes

- SC#4 is **partially in scope**: the WORM export (OPSG-03) is implemented and verified; the hot-audit-copy
  **sweep/delete is DEFERRED** per owner ruling (export-only). The verifier MUST record SC#4 as
  "export met, sweep deferred" — not a silent gap.
- Every workflow/scheduler behavior escapes its pure logic to `@pikar/core` for unit coverage; the
  irreducible orchestration is proven by live smoke + the owner human-verify (RPLY-01/VOIC precedent).

---

*Phase: 07-resilience-operations-hardening*
*Validation strategy drafted: 2026-07-21*
