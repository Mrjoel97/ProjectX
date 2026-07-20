---
phase: 07-resilience-operations-hardening
plan: 01
subsystem: infra
tags: [worm, s3, audit, notifications, review-gate, convex-schema, pure-core]

# Dependency graph
requires:
  - phase: 01-foundation-governance-substrate
    provides: insert-only audit table + WORM export stub (worm.ts) + exportCursors
  - phase: 03-guardrails
    provides: buildTelemetry ReviewOutcome union + review gate + telemetry plane
provides:
  - "@pikar/core retention.ts — serializeAuditNdjson (sorted-key NDJSON, idempotent re-export), wormObjectKey, retainUntilDate, RETENTION_MS"
  - "@pikar/core notificationTemplates.ts — closed NotificationKind union + static §4-safe labels (notificationMessage, NOTIFICATION_KINDS)"
  - "@pikar/core reviewThreshold.ts — classifyReviewDecision fail-closed classifier + MAX_REGENERATE"
  - "buildTelemetry ReviewOutcome += 'escalated'"
  - "audit.by_ts global index (cross-tenant WORM window; backs auditSince)"
  - "plans.reviseCount / plans.escalated optional fields (cockpit review gate)"
  - "@aws-sdk/client-s3 installed in @pikar/backend"
affects: [07-02 worm-export, 07-03 pipeline-review-gate, 07-04 cockpit-review-gate, 07-05 notifications-matrix]

# Tech tracking
tech-stack:
  added: ["@aws-sdk/client-s3@^3"]
  patterns:
    - "Non-trivial hardening logic pushed into pure @pikar/core (unit-testable; workflows do not run under convex-test)"
    - "Deterministic (sorted-key) serialization → byte-identical re-export → idempotent PutObject under Object Lock"
    - "Static-label notification firewall: notificationMessage(kind) takes no content arg (§4)"
    - "Single fail-closed classifier shared by both review gates (root-cause fix, not per-caller guard)"

key-files:
  created:
    - packages/core/src/retention.ts
    - packages/core/src/retention.test.ts
    - packages/core/src/notificationTemplates.ts
    - packages/core/src/notificationTemplates.test.ts
    - packages/core/src/reviewThreshold.ts
    - packages/core/src/reviewThreshold.test.ts
  modified:
    - packages/core/src/buildTelemetry.ts
    - packages/core/src/index.ts
    - packages/backend/convex/schema.ts
    - packages/backend/package.json
    - docs/playbooks/watch.json
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "RETENTION_MS default = 7 years (compliance floor); ponytail knob, lift to per-tenant/regulatory policy if rules diverge"
  - "NDJSON keys sorted recursively so a re-exported window is byte-identical (idempotent PutObject under Object Lock)"
  - "notificationMessage has NO content parameter — the §4 firewall is structural, not a convention"
  - "classifyReviewDecision is the single source of truth for pipeline (07-03) + cockpit (07-04) gates"

patterns-established:
  - "Pure-core-first for Phase-7 hardening logic (retention/notifications/review-threshold), Convex adapters stay thin"
  - "Additive-only schema (global index + optional fields) → no migration, OPSG-06 moot"

requirements-completed: [OPSG-03, REVW-02, OPSG-05]

# Metrics
duration: 8min
completed: 2026-07-21
---

# Phase 7 Plan 01: Wave-0 Foundation Summary

**Three pure @pikar/core modules (WORM NDJSON serialization + static §4 notification labels + fail-closed review-threshold classifier), the @aws-sdk/client-s3 dep, and additive schema (audit by_ts index + plans reviseCount/escalated) that the OPSG-03/REVW/OPSG-05 feature plans build on.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-20T22:57:32Z
- **Completed:** 2026-07-20T23:05:29Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments
- `retention.ts` — `serializeAuditNdjson` (recursive key-sort → byte-identical re-export → idempotent PutObject), `wormObjectKey` (UTC-day-of-maxTs key), `retainUntilDate`/`RETENTION_MS`.
- `notificationTemplates.ts` — closed 8-member `NotificationKind` union + `notificationMessage` returning a fixed label per kind, structurally unable to interpolate content (§4 firewall); `NOTIFICATION_KINDS` runtime list for exhaustive iteration.
- `reviewThreshold.ts` — `classifyReviewDecision` fail-closed classifier: a regenerate at/over `MAX_REGENERATE` (=3) escalates, never proceeds to delivery; the single source of truth both 07-03 and 07-04 gates call.
- `buildTelemetry.ts` ReviewOutcome += `"escalated"` (REVW-02 terminal reuses the telemetry builder).
- Schema: global `audit.by_ts` index (cross-tenant WORM window; backs `auditSince`) + `plans.reviseCount`/`plans.escalated` optional fields (cockpit gate counter/terminal).
- `@aws-sdk/client-s3` installed; no pinned pre-1.0 component bumped (§6).
- `watch.json` registers the new Phase-7 paths; `audit-dead-letter.md` updated + re-verified.

## Task Commits

1. **Task 1: Pure retention + notification-template modules** — `d3278e2` (test, RED) → `bdd7db5` (feat, GREEN)
2. **Task 2: Pure review-threshold classifier** — `41afd27` (test, RED) → `b9e3473` (feat, GREEN)
3. **Task 3: Install dep + schema index/fields + watch.json + playbook** — `19e6be4` (chore)

## Files Created/Modified
- `packages/core/src/retention.ts` (+test) — WORM NDJSON serialize + object-key + retain-until math (pure)
- `packages/core/src/notificationTemplates.ts` (+test) — closed NotificationKind union + static labels
- `packages/core/src/reviewThreshold.ts` (+test) — fail-closed review-decision classifier
- `packages/core/src/buildTelemetry.ts` — ReviewOutcome += "escalated"
- `packages/core/src/index.ts` — barrel re-export of the three new modules
- `packages/backend/convex/schema.ts` — audit.by_ts index + plans.reviseCount/escalated
- `packages/backend/package.json` — @aws-sdk/client-s3 dependency
- `docs/playbooks/watch.json` — Phase-7 watched paths under audit-dead-letter.md + cockpit.md
- `docs/playbooks/audit-dead-letter.md` — by_ts + installed-dep notes, Last verified bump

## Decisions Made
- RETENTION_MS = 7 years (compliance floor) as a ponytail default knob.
- NDJSON is recursively key-sorted so a retried export of the same window is byte-identical — idempotent PutObject under Object Lock.
- `notificationMessage(kind)` accepts no content argument: the §4 firewall is a type-level constraint, not a runtime convention.
- One classifier (`classifyReviewDecision`) fixes the "regenerate past the cap = unapproved send" bug once at the shared decision point.

## Deviations from Plan

None that alter intent. Plan executed as written (all four artifacts + key-links delivered, verification commands run).

Note: the plan named `NotificationKind` + `notificationMessage` exports; I additionally exported a `NOTIFICATION_KINDS` runtime array so the union can be iterated exhaustively in tests and by downstream callers (a closed union has no runtime form otherwise). Minor additive helper, in the spirit of the plan's "defined for EVERY NotificationKind member" test requirement.

## Issues Encountered

**Pre-existing backend typecheck failures (out of scope, baseline-verified).** `pnpm --filter @pikar/backend typecheck` fails on `convex/voiceToken.test.ts` (stale `_generated/api` missing `mintClientSecret`) and `convex/worm.test.ts` (`import.meta.glob` unknown to tsc). Verified identical on baseline via `git stash` of this plan's edits — 07-01 introduced ZERO new typecheck errors; the additive schema/dep changes typecheck clean. Logged to `deferred-items.md`; not fixed (scope boundary — neither is product code nor caused by this task). `node scripts/check-playbooks.mjs` exits 0.

## Verification
- `pnpm --filter @pikar/core test` — 145/145 green (incl. retention 8, notificationTemplates 4, reviewThreshold 8).
- `pnpm --filter @pikar/backend typecheck` — no NEW errors from this plan (2 pre-existing test-file failures, baseline-identical).
- `node scripts/check-playbooks.mjs` — exit 0.

## User Setup Required
None for this plan. (OPSG-03's live WORM export in 07-02 will require `WORM_BUCKET` + AWS creds in the Convex deployment env — unset ⇒ export stays a clean no-op.)

## Next Phase Readiness
- 07-02 (WORM export) can import `serializeAuditNdjson`/`wormObjectKey`/`retainUntilDate`/`RETENTION_MS` and `@aws-sdk/client-s3`; audit is `by_ts`-indexed.
- 07-03/07-04 (review gates) can import `classifyReviewDecision`/`MAX_REGENERATE`; `plans` carries `reviseCount`/`escalated`; ReviewOutcome has `escalated`.
- 07-05 (notifications matrix) can import `NotificationKind`/`notificationMessage`/`NOTIFICATION_KINDS`.

## Self-Check: PASSED

All 6 created source/test files exist; all 5 task commits (d3278e2, bdd7db5, 41afd27, b9e3473, 19e6be4) are in history; audit `by_ts` index, `plans.reviseCount`, and `@aws-sdk/client-s3` confirmed present.

---
*Phase: 07-resilience-operations-hardening*
*Completed: 2026-07-21*
