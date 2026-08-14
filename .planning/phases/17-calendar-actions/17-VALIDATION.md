---
phase: 17
slug: calendar-actions
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-27
updated: 2026-08-10
---

# Phase 17 — Gap-Closure Validation Strategy

> Validation for Plans 17-05 through 17-11. The shipped Google create-only slice remains a positive
> regression anchor while Microsoft parity and governed event management close ACTN-02.

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest + convex-test, package typechecks, Playwright authenticated project |
| Wall-clock gate | `scripts/run-calendar-test-gate.mjs`; killable child, JSON reporter, exit 0, total > 0, passed = total |
| Focused limit | 45 seconds for the original Calendar file; 90 seconds for the integrated backend matrix; 20-second tests and 10-second hooks |
| Live readback | bounded `smoke.calendarLifecycleReadback` exact provider/plan/run/registry/audit refs |
| Live artifact | `17-LIVE-EVIDENCE.json`, schema `phase17-calendar-live-evidence.v1`, refs/codes/counts/hashes only |
| Full free gate | focused core/backend/web tests, typechecks, web build, playbooks, `git diff --check` |

## Sampling and Wave Gates

- After every auto task, run every `<automated>` command and record exact counts/duration.
- Every deliberate mutation must show the named positive-witness test RED, then be restored and
  rerun GREEN. Never reset or absorb unrelated work.
- Wave 1 establishes the executable timeout gate and frozen contracts/schema/UI parity.
- Wave 2 proves OAuth/state/token secrecy plus H3's offline stored-scope negative.
- Wave 3 cannot complete until the disposable event-specific Graph stale PATCH/DELETE probe is
  supported; unsupported means Microsoft create-only fallback and replanning, never unconditional writes.
- Wave 4 completes the explicit bounded legacy migration before Wave 5's strictly read-only listing.
- Wave 6 runs the 90-second count-asserting matrix before any live provider gate.
- Wave 7 completion metadata is forbidden until all machine readbacks and three blocking checkpoints pass.

## Per-Task Verification Map — 24/24

| Task ID | Wave | Requirement proof | Automated/manual gate |
|---|---:|---|---|
| 17-05-01 | 1 | Original Calendar behavior exits, positive test count, no hung worker | 45-second `run-calendar-test-gate.mjs` |
| 17-05-02 | 1 | Closed provider/operation/action contracts, registry schema, reset parity, inert target | core contracts + plans/calendar/cockpit tests + typecheck |
| 17-05-03 | 1 | Trace/card/watch parity and five mutation reds | traceParity/plans tests + web typecheck + playbooks |
| 17-06-01 | 2 | Microsoft common-v2 state/token boundary and exact delegated scope | Microsoft auth + core tests |
| 17-06-02 | 2 | Callback exchange is server-only, provider-bound and redaction-safe | httpAuth + auth + Calendar tests |
| 17-06-03 | 2 | Connect/disconnect/reconnect UI, onboarding ownership, H3 offline negative | notification/Calendar tests + web typecheck/Playwright + playbooks |
| 17-07-01 | 3 | Refresh/availability privacy plus event-specific Graph stale PATCH/DELETE 412 capability | Microsoft tests + exact-key `17-GRAPH-CONCURRENCY-PROBE.json` validator |
| 17-07-02 | 3 | Idempotent Microsoft create and provider-less Google default | Calendar/Microsoft/dispatch-guard tests |
| 17-07-03 | 3 | Provider-aware tools/card preserve stage→Approve | cockpit tools + provider/guard tests + web typecheck/playbooks |
| 17-08-01 | 4 | Durable create landing and explicit cursor/limit≤100 legacy migration | calendarEvents + Calendar tests; dry-run/apply completion counts |
| 17-08-02 | 4 | Exact inspection, attendee refusal, idempotent conditional update/delete | Google/Microsoft/registry tests; probe mismatch refusal |
| 17-08-03 | 4 | Approve-only terminal, audit/DLQ keys and bounded lifecycle readback | Calendar/Microsoft/registry/cockpit/guard tests + seven mutations |
| 17-09-01 | 5 | Managed-event discovery is bounded, tenant-safe and strictly read-only | registry/cockpitTools/trace tests; no migration call source assertion |
| 17-09-02 | 5 | Inspect-then-stage copies a fresh etag and refuses stale/foreign/attendee rows | cockpitTools/registry/guard tests + seven mutations |
| 17-09-03 | 5 | Truthful management card and offline observable lifecycle | web typecheck + focused Playwright + playbooks |
| 17-10-01 | 6 | Complete two-provider matrix, exact live-readback schema and bounded runtime | core tests + 90-second backend count gate + Playwright |
| 17-10-02 | 6 | Mutation/type/build/playbook gate and JSON UAT protocol | three typechecks + build + playbooks + runbook marker contract |
| 17-11-01 | 7 | Zero-write preflight, real H3, completed migration and matching Graph probe | exact-root JSON preflight validator |
| 17-11-02 | 7 | Owner consents to both disposable provider accounts | blocking human-action; safe status/account-hash readback |
| 17-11-03 | 7 | Availability plus exactly one approved create per provider | JSON ids/etags/plan/registry/audit/count/leak validator |
| 17-11-04 | 7 | Owner makes both staged etags stale out of band | blocking human-action; machine etag inequality |
| 17-11-05 | 7 | Conflict refusal, fresh update, delete replay and cleanup | JSON conflict/update/delete/duplicate/cleanup validator |
| 17-11-06 | 7 | Native providers visibly match evidence and have no residue | blocking human-verify |
| 17-11-07 | 7 | Final exact readback and truthful requirement/roadmap/verification closure | recursive JSON privacy/identity gate + planning/playbook checks |

## Required Mutation Ledger

The owning plan must record RED then restored GREEN for: action-arm misrouting; missing tenant
predicate; incomplete reset; trace/card parity; OAuth state/provider tamper; token/scope exposure;
H3 stored-scope bypass; refresh rotation; provider-default removal; missing transaction id;
Graph-probe mismatch bypass; migration `.collect()`/limit removal; attendee refusal removal;
If-Match removal; 412-as-retry; desired-state reconciliation removal; `/cancel` use; approval bypass;
terminal tenant/status guard removal; read-only listing migration call; stale-etag staging; and
audit/content/token leakage. Every absence assertion needs a positive row/fetch/audit/plan witness.

## Live Evidence Contract

`17-LIVE-EVIDENCE.json` has exact root keys:

```text
schema, deploymentUrlHash, capturedAt, preflight, creates, conflicts,
updates, deletes, cleanup, reconciliation
```

For both providers, machine readbacks bind external event id/etag to exact managed-event, registry,
plan, run/correlation and audit refs. They assert pre/post existence, exact audit names/payload key
sets/counts, duplicate absence, conflict/no-overwrite, update etag equality, delete replay,
zero cleanup residue, and recursive content/token-key absence. `rg` markers or screenshots alone
cannot satisfy a live row.

## Manual-Only Gates

| Gate | Human action | Machine assertions surrounding it |
|---|---|---|
| Consent | Click prepared Google/Microsoft consent pages | safe connected/account hashes; no token values |
| Concurrency | Move both exact events by five minutes | provider etag differs from staged etag before approval |
| Final verification | Confirm native calendars contain no disposable residue | final provider/registry/plan/audit JSON reconciliation |

H3 is not replaceable by a human recollection: the actual pre-widening stored-scope row must produce
machine reconnect/zero-fetch evidence before reconnect. If unavailable, Phase 17 remains pending.

## Validation Sign-Off

- [x] All 24 tasks across seven waves are represented.
- [x] Every auto task has an executable automated command.
- [x] Checkpoints use blocking checkpoint XML sections with action/files/what/how/verify/done/resume.
- [x] Both backend behavior gates have executable wall-clock, exit and positive test-count assertions.
- [x] Graph management has an early event-specific capability dependency and safe fallback.
- [x] Legacy migration is explicit and precedes read-only listing.
- [x] Live evidence is machine-readable and refs-only.
- [x] Completion reconciliation occurs only after every PASS.

**Approval:** revised for checker iteration 1/3 on 2026-08-10; execution and live consent remain pending.
