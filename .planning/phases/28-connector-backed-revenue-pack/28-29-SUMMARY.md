---
phase: 28-connector-backed-revenue-pack
plan: 29
subsystem: revenue-telemetry
tags: [revenue, telemetry, convex, plan-decisions, recovery, idempotency]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: Shared privacy-safe revenue event plane and real provider/workflow terminals from plans 28-15 and 28-21
provides:
  - Real approve, edit and reject decision emissions for staged revenue reminder plans
  - Provider-scoped one-way reminder references and later normalized provider-observed recovery
  - Integration proof for terminal ordering, dedupe, tenant isolation and provider isolation
affects: [28-16, 28-27, revenue-operations, connector-playbooks]
tech-stack:
  added: []
  patterns: [terminal-local decision emission, provider-scoped hashed subject refs, later-observation recovery matching]
key-files:
  created: []
  modified:
    - packages/backend/convex/revenueTelemetry.integration.test.ts
    - packages/backend/convex/revenueTelemetry.ts
    - packages/backend/convex/invoiceReminders.ts
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/quickbooks.ts
    - packages/backend/convex/stripeConnector.ts
    - packages/backend/convex/paypalConnector.ts
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/connector-quickbooks.md
    - docs/playbooks/connector-stripe.md
    - docs/playbooks/connector-paypal.md
key-decisions:
  - "A revenue plan decision is emitted only after the durable approve/edit/reject transition, never from draft, refusal, duplicate approval or delivery."
  - "Recovery requires a later normalized observation from a passed provider matching the same tenant and a provider-scoped one-way reminder ref."
  - "Stable tenant-plus-provider-plus-subject recovery run ids deduplicate repeated reads without conflating tenants or providers."
patterns-established:
  - "Reminder staging stores a content-free provider-scoped subjectRef that later provider reads can corroborate without persisting the raw invoice id."
  - "Provider actions reduce normalized paid observations before querying bounded tenant-owned reminder history."
requirements-completed: []
requirements-blocked: [REVN-05, REVN-06]
duration: 16min
completed: 2026-09-01
---

# Phase 28 Plan 29: Grounded Decision and Recovery Telemetry Summary

**Revenue plan decisions now emit only at real durable terminals, while recovery requires a later passed-provider observation matched to a tenant-owned provider-scoped reminder ref.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-01T15:24:40Z
- **Completed:** 2026-09-01T15:40:43Z
- **Tasks:** 1 TDD task
- **Files modified:** 13

## Accomplishments

- Attached `plan_decided` to the successful re-propose, post-CAS approve and proposed-to-canceled discard terminals, leaving drafting, refused approvals, duplicate approvals and delivery writes inert.
- Added a provider-scoped SHA-256 reminder reference and matched later normalized QuickBooks, Stripe or PayPal paid observations against a bounded tenant-owned reminder history.
- Proved one-time recovery across repeated reads, two-tenant isolation, cross-provider raw-id isolation, unavailable-read refusal and content-free event rows.

## Terminal Semantics

| Terminal | Event | Grounding rule |
|---|---|---|
| Successful re-propose | `plan_decided: edited` | Emits after the plan patch succeeds. |
| Successful approve | `plan_decided: approved` | Emits after every governed refusal and after the proposed-to-approved CAS. |
| Successful discard | `plan_decided: rejected` | Emits after the proposed-to-canceled transition and audit write. |
| Passed normalized provider read | `recovery_observed: paid|resolved` | Emits only when the observation is later than, and matches, the same tenant's provider-scoped reminder ref. |

Drafting, approval attempts that refuse, delivery/send terminals, unavailable provider reads, another tenant's reminder and another provider's equal raw invoice id do not emit recovery.

## Idempotency and Privacy

- Reminder refs are `rev:<provider>:invoice:<truncated-sha256>` values produced with the repository's shared `contentHash`; raw provider invoice ids never enter telemetry.
- Recovery run ids bind provider and hashed subject ref, while the event writer's `by_tenant_run` lookup supplies tenant isolation. Exact repeated observations collapse to one immutable row.
- Decision rows carry only tenant/run/plan refs and the closed `edited|approved|rejected` status. Recovery rows carry only provider, hashed subject ref, closed status and provider observation time.
- The integration privacy scan still refuses key names associated with names, emails, messages, subjects, descriptions, amounts, currencies, tokens, credentials, payloads, raw data, cost, latency or duration.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @pikar/backend test -- revenueTelemetry.integration cockpit plans quickbooks stripeConnector paypalConnector` | **558/558 passed** across 14 files |
| `pnpm --filter @pikar/backend test -- revenueTelemetry.integration` | **10/10 passed** after final formatting |
| `pnpm --filter @pikar/backend typecheck` | **passed** |
| `node_modules/.bin/biome.cmd check <8 scoped files>` | **passed with no errors**; three unrelated pre-existing cockpit warnings remain |
| `'{}' \| node scripts/check-playbooks.mjs check` | **passed** (silent) |
| `git diff --check -- <plan slice>` | **passed**; only the pre-existing CRLF warning for `revenue-connectors.md` was printed |

No deployment, provider call, paid evaluation or external mutation ran.

## Task Commits

1. **Task 1 RED: failing decision and recovery integration contract** — `82c321b`
2. **Task 1 GREEN: production decision and provider-observed recovery terminals** — `6124a2f`

## Files Created/Modified

- `packages/backend/convex/revenueTelemetry.integration.test.ts` — proves real decision terminals, later-source recovery, dedupe, tenant/provider isolation and privacy.
- `packages/backend/convex/revenueTelemetry.ts` — derives provider-scoped one-way refs and emits matched recovery observations.
- `packages/backend/convex/invoiceReminders.ts` — records the scoped ref when the first reminder proposal is staged.
- `packages/backend/convex/cockpit.ts` — emits refs/status-only plan decisions after real edit, approve and reject transitions.
- `packages/backend/convex/plans.ts` — matches bounded later observations against tenant-owned staged reminder refs.
- `packages/backend/convex/quickbooks.ts` — derives paid invoice/payment observations after a passed normalized read.
- `packages/backend/convex/stripeConnector.ts` — derives paid invoice/charge observations after a passed normalized read.
- `packages/backend/convex/paypalConnector.ts` — derives linked successful-payment observations after a passed normalized read.
- `docs/playbooks/{revenue-connectors,cockpit,connector-quickbooks,connector-stripe,connector-paypal}.md` — records terminal, privacy, recovery and rollback semantics for every watched subsystem.

## Decisions Made

- Reused the existing append-only `workflowPackEvents` plane and its stable `(tenantId, runId, event)` dedupe; no second telemetry table or mutable recovery record was introduced.
- Used the reminder event as the revenue-plan marker, so ordinary cockpit plans remain inert without adding a schema field or changing the plan model.
- Kept requirements pending: telemetry makes REVN-05/06 measurable but does not activate the parked provider lanes or prove a live connector-backed user capability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reused the repository's shared SHA-256 helper**
- **Found during:** Task 1 GREEN review
- **Issue:** The partial implementation duplicated the `crypto.subtle.digest` hex routine despite `lib/hash.ts` being the repository's one content-hash implementation.
- **Fix:** Replaced the duplicate routine with `contentHash` while preserving the exact provider-scoped ref shape.
- **Files modified:** `packages/backend/convex/revenueTelemetry.ts`
- **Verification:** Integration 10/10, targeted 558/558 and backend typecheck pass.
- **Committed in:** `6124a2f`

**2. [Rule 3 - Blocking] Updated every watched subsystem playbook**
- **Found during:** Task 1 definition-of-done gate
- **Issue:** The plan listed the shared playbook only, but cockpit and each provider file are independently watched and the playbook gate correctly blocked completion.
- **Fix:** Added narrow terminal/recovery notes to cockpit, QuickBooks, Stripe and PayPal playbooks and updated only the 28-29 hunk in the concurrently edited shared playbook.
- **Files modified:** `docs/playbooks/cockpit.md`, `docs/playbooks/connector-{quickbooks,stripe,paypal}.md`, `docs/playbooks/revenue-connectors.md`
- **Verification:** The playbook gate passes silently.
- **Committed in:** `6124a2f`

---

**Total deviations:** 2 auto-fixed blocking issues.
**Impact on plan:** Both changes enforce existing repository conventions without broadening the telemetry contract or runtime architecture.

## Issues Encountered

- The first scoped Biome invocation used a pnpm resolution path that did not expose the binary in this shell. Running the repository's checked-in `node_modules/.bin/biome.cmd` resolved it; the final scoped check has no errors.
- `graphify update .` completed AST extraction for 1434/1434 files but stopped producing output during finalization and was interrupted after more than one minute. The required Convex fixup then completed (`+80` Convex edges, `+90` table edges); all Graphify artifacts remain unstaged and outside this plan.
- `docs/playbooks/revenue-connectors.md` also contains concurrent 28-09 edits. Interactive hunk staging committed only the 28-29 telemetry header and preserved every concurrent hunk unstaged.

## User Setup Required

None. Provider lanes remain parked according to their existing owner decisions.

## Next Phase Readiness

- Plan 28-16 can now test the complete live/browser/repository exposure surface with decision and recovery terminals present.
- Plan 28-27 remains responsible for the final owner subset judgment and strict named-provider phase seal.
- REVN-05 and REVN-06 remain pending until the required live provider and exposure gates are truthfully satisfied.

## Self-Check: PASSED

- Summary and all plan-owned production/test files exist.
- RED commit `82c321b` and GREEN commit `6124a2f` exist.
- STATE and ROADMAP record 27/29 executed, next 28-16, and keep REVN-05/06 pending.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
