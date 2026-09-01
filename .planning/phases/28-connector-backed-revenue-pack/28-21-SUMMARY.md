---
phase: 28-connector-backed-revenue-pack
plan: 21
subsystem: revenue-telemetry
tags: [revenue, telemetry, convex, privacy, integration-testing, idempotency]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: Closed privacy-safe shared revenue event adapter from plan 28-15
  - phase: 28-connector-backed-revenue-pack
    provides: Provider, CRM, finance, and invoice-reminder production terminals from plans 28-09 through 28-13
provides:
  - Real connector lifecycle and bounded-read terminal emissions on the shared event plane
  - Real CRM, deterministic-finance, and reminder-staging terminal emissions
  - Integration proof for reachability, idempotency, isolation, partial results, and content-free rows
affects: [28-29, revenue-operations, connector-playbooks]
tech-stack:
  added: []
  patterns: [terminal-local emission, projection-to-count reduction, stable lifecycle idempotency keys]
key-files:
  created:
    - packages/backend/convex/revenueTelemetry.integration.test.ts
  modified:
    - packages/backend/convex/revenueTelemetry.ts
    - packages/backend/convex/connectorCredentials.ts
    - packages/backend/convex/revenueTools.ts
    - packages/backend/convex/invoiceReminders.ts
key-decisions:
  - "Lifecycle telemetry is emitted where credential state actually commits, not from the dispatch-only connector facade."
  - "CRM and finance telemetry is emitted after specialist tool completion so their underlying data adapters remain read-only."
  - "Duplicate revocation mutations are inert and cannot downgrade a previously confirmed terminal state."
patterns-established:
  - "Provider projections are reduced to closed state labels, booleans, and bounded counts before the shared emitter sees them."
  - "Stable plan/operation and connection/transition run ids collapse retries without conflating distinct operations."
requirements-completed: []
requirements-blocked: [REVN-04, REVN-05, REVN-06]
duration: 14min
completed: 2026-09-01
---

# Phase 28 Plan 21: Real Revenue Terminal Telemetry Summary

**Every scoped provider, specialist, finance, and reminder terminal now reaches the existing privacy-safe shared event plane with closed labels and bounded counts only.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-01T11:35:00Z
- **Completed:** 2026-09-01T11:49:28Z
- **Tasks:** 1 TDD task
- **Files modified:** 13

## Accomplishments

- Wired connected, reauthentication-required, revoked/partial-revoke, and bounded provider-read outcomes from the real credential and public-read terminals.
- Wired CRM attention/customer-pulse completion, deterministic cash/payroll computation, and first-success invoice-reminder staging without making read-only adapters writable.
- Proved real terminal reachability with 7 integration cases covering all four providers, partial results, tenant isolation, duplicate and reordered calls, exact reminder retries, an unused-helper negative source guard, and the shared privacy allow-list.
- Kept plan decisions and later provider-observed recovery unwired here for plan 28-29; no drafting, approval, or send action is treated as recovery.

## Terminal Event Allow-List

| Real terminal | Event | Stored facts only |
|---|---|---|
| Credential consent commit | `connector_lifecycle` | provider, `connected` |
| Credential read failure commit | `connector_lifecycle` | provider, `reauth_required` |
| Credential revocation commit | `connector_lifecycle` | provider, `revoked\|revoke_partial` |
| Public HubSpot/QuickBooks/Stripe/PayPal bounded read | `connector_read` | provider, `ready\|partial\|unavailable`, bounded item/source counts, capped/partial flags |
| CRM specialist tool completion | `workflow_completed` | closed workflow/outcome, bounded item count, capped/partial flags |
| Deterministic finance specialist completion | `finance_computed` | cash/payroll workflow, closed coverage/confidence, bounded result/missing counts and gap flags |
| First successful invoice reminder staging | `reminder_staged` | reminder workflow, opaque plan ref, item count `1` |

`plan_decided` and `recovery_observed` remain reserved in the shared contract and are deliberately
not emitted by this plan. Plan 28-29 owns those terminals and must require a later normalized
provider observation before recovery can be recorded.

## Privacy Scan

- Provider projections are reduced before emission; no normalized row or vendor payload crosses into the event call.
- Integration rows reject key names associated with names, emails, messages, bodies, subjects, descriptions, amounts, currencies, tokens, credentials, payloads, raw data, cost, latency, or duration.
- A sentinel deal name and sentinel access token pass through the real partial HubSpot read fixture and are absent from every stored event row.
- Reminder tests store the draft on the governed plan but prove the subject, body, and recipient never enter telemetry.
- Cost and latency remain absent from event rows and continue to come only from canonical `spendEvents` and `agentSteps` owners.

## Metric and Idempotency Semantics

- Each public provider read represents one bounded observation and gets one fresh read run id; a parked lane records `unavailable` rather than silently disappearing.
- Consent lifecycle ids bind to connection id and revision. Reauthentication ids bind to the current revision, so retry storms collapse to one transition.
- Revocation ids bind to connection and terminal status. An already-revoked mutation is inert, preserving the original upstream truth and preventing a later `not_attempted` retry from downgrading it.
- CRM and finance ids bind to plan plus operation, allowing distinct operations in one plan while collapsing exact tool retries.
- Reminder staging binds to the plan id, and the existing exact-retry guard returns before emission.
- Missing finance sources map to `coverage: unknown` and `confidence: unknown`; no unavailable input is translated into zero or an invented amount.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @pikar/backend test -- revenueTelemetry.integration connectorConnections revenueCrm revenueFinance invoiceReminders` | **64/64 passed** across 5 files |
| `pnpm --filter @pikar/backend test -- revenueTelemetry.integration connectorCredentials` | **37/37 passed** across 2 files |
| `pnpm --filter @pikar/backend typecheck` | **passed** |
| `node scripts/check-playbooks.mjs` | **passed** (silent) |
| `git diff --check` | **passed** for the task slice; warnings concern unrelated pre-existing CRLF files |

No deployment, provider operation, paid evaluation, or external mutation ran.

## Task Commits

1. **Task 1 RED: failing real-terminal integration contract** — `2883ec4`
2. **Task 1 GREEN: production terminal telemetry and provider playbooks** — `83c67c0`

## Files Created/Modified

- `packages/backend/convex/revenueTelemetry.integration.test.ts` — drives real actions/mutations and proves reachability, privacy, isolation, partial results, and retry behavior.
- `packages/backend/convex/revenueTelemetry.ts` — reduces provider projections to content-free bounded read events.
- `packages/backend/convex/connectorCredentials.ts` — emits lifecycle transitions at the credential commit seam and makes duplicate revocation inert.
- `packages/backend/convex/hubspot.ts` — emits after the tenant-facing bounded HubSpot read.
- `packages/backend/convex/quickbooks.ts` — emits after the tenant-facing bounded QuickBooks read.
- `packages/backend/convex/stripeConnector.ts` — emits after the tenant-facing bounded Stripe read.
- `packages/backend/convex/paypalConnector.ts` — emits after the tenant-facing bounded PayPal read.
- `packages/backend/convex/revenueTools.ts` — emits CRM and deterministic-finance completion outcomes after audit.
- `packages/backend/convex/invoiceReminders.ts` — emits once after first successful reminder staging.
- `docs/playbooks/connector-{hubspot,quickbooks,stripe,paypal}.md` — records the shared-plane terminal telemetry behavior.

## Decisions Made

- Used `connectorCredentials` as the lifecycle terminal because callback, read-outcome, and revocation actions all commit their durable state there; `connectorConnections` only dispatches provider actions.
- Used the specialist tool execution boundary for CRM and finance because `revenueCrm` must remain a query-only local projection and deterministic finance must remain a read-only calculation adapter.
- Kept all provider integrations on one shared helper and all rows on the 28-15 plane; no provider SDK/runtime dependency or second telemetry store was introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved confirmed revocation across duplicate disconnects**
- **Found during:** Task 1 duplicate/reordered terminal proof
- **Issue:** A second disconnect after local credential clearing could overwrite a confirmed revocation with `not_attempted` and increment the credential revision.
- **Fix:** Made `recordRevocation` return inertly for an already-revoked row; the original lifecycle truth and its one event remain intact.
- **Files modified:** `packages/backend/convex/connectorCredentials.ts`, `packages/backend/convex/revenueTelemetry.integration.test.ts`
- **Verification:** Duplicate disconnect plus post-disconnect read integration case passes; lifecycle remains exactly connected, reauth-required, revoked.
- **Committed in:** `83c67c0`

**2. [Rule 3 - Blocking] Corrected the convex-test action bridge types**
- **Found during:** Task 1 GREEN typecheck
- **Issue:** The runtime-valid test bridge used `never` parameters, which Vitest transpiled but `tsc --noEmit` rejected.
- **Fix:** Narrowly cast convex-test methods to an unknown-reference/argument bridge at the test boundary.
- **Files modified:** `packages/backend/convex/revenueTelemetry.integration.test.ts`
- **Verification:** Backend typecheck passes cleanly and the integration suite remains 7/7.
- **Committed in:** `83c67c0`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking test-infrastructure issue).
**Impact on plan:** Both fixes strengthen required idempotency and verification without broadening the shared event contract.

## Issues Encountered

- The sandbox initially refused the Git index write with `Unable to create .git/index.lock: Permission denied`. One reviewed escalated retry staged the exact 13-file allow-list successfully.
- Unrelated dirty runtime/revenue-connectors playbooks, schema/generated API, and graphify artifacts were left unstaged and untouched by the task commit.

## User Setup Required

None. Provider lanes remain parked according to their existing owner decisions.

## Next Phase Readiness

- Plan 28-29 can attach `plan_decided` to the governed plan terminal and `recovery_observed` only to a later normalized provider status.
- The shared operational projection can now observe real provider availability/read and scoped workflow outcomes.
- REVN-04, REVN-05, and REVN-06 remain pending because terminal telemetry does not activate parked capabilities.

## Self-Check: PASSED

- Summary file and all plan-owned production/test/playbook files exist.
- RED commit `2883ec4` and GREEN commit `83c67c0` exist.
- Event allow-list, privacy scan, metric/idempotency semantics, terminal coverage, verification results, and deferred plan-29 boundaries are recorded above.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
