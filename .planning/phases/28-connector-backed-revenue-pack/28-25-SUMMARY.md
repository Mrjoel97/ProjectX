---
phase: 28-connector-backed-revenue-pack
plan: 25
subsystem: revenue-connectors
tags: [paypal, provider-gate, parked, read-only, offline-verification]

requires:
  - phase: 28-08
    provides: PayPal authorization model, bounded reads, and offline evidence validator
  - phase: 28-26
    provides: passed-only provider gate and owner seal resolver
provides:
  - Owner's wave-7 PayPal PARK judgment recorded durably in the suitability record and playbook
  - Offline parked-seal payload with no cleared conditions and no fabricated live evidence
  - Verified absence behavior for parked lanes and pre-fetch refusal for parked PayPal reads
affects: [phase-28-release, connections-ui, revenue-provider-discovery]

tech-stack:
  added: []
  patterns:
    - Admission permits engineering but never converts owner testimony into a passed lane
    - A parked provider remains absent from passed-only discovery while its implementation stays reversible

key-files:
  created:
    - .planning/phases/28-connector-backed-revenue-pack/28-25-SUMMARY.md
  modified:
    - docs/connectors/paypal-suitability.md
    - docs/playbooks/connector-paypal.md

key-decisions:
  - "Owner decision: PARK PayPal and continue the code-only remainder of Phase 28."
  - "Keep no-documented-revoke-endpoint unresolved; no live read, revoke, or delegated-merchant proof exists."
  - "Under the local-proof-only constraint, resolve and verify the parked payload offline without applying a Convex deployment mutation."

patterns-established:
  - "A dry-run seal is documented as a payload resolution, never as an observed deployment revision."
  - "Parked means invisible: only passed rows enter availableProviders, and tenant reads refuse before fetch."

requirements-completed: []

duration: 17min
completed: 2026-08-31
---

# Phase 28 Plan 25: PayPal Provider Judgment Summary

**PayPal is owner-judged PARKED, remains invisible, and carries forward its delegated-merchant and revocation gaps without any provider or deployment mutation.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-31T19:58:00Z
- **Completed:** 2026-08-31T20:15:34Z
- **Tasks:** 2/2 (Task 1 owner decision checkpoint; Task 2 offline seal and documentation)
- **Files modified:** 3

## Accomplishments

- Recorded the owner's explicit wave-7 **PARK** decision in both PayPal operating documents.
- Resolved `--seal-decision from-owner` to `lane: parked`, `clearedConditions: []`, and the existing 2026-11-27 review date without applying it to a deployment.
- Proved offline that parked lanes stay outside the passed-only projection and that the PayPal connector refuses a parked tenant read before any outbound request.
- Preserved `no-documented-revoke-endpoint` as unresolved and made no live PayPal, sandbox, smoke, read, or revoke call.

## Task Commits

Each executable task was committed atomically:

1. **Task 1: Judge PayPal** — owner checkpoint decision: `park` (decision only; no commit)
2. **Task 2: Seal PayPal gate** — `ca629d0` (`docs`)

## Files Created/Modified

- `docs/connectors/paypal-suitability.md` — durable owner judgment, offline seal payload, remaining evidence gaps, and re-open criteria.
- `docs/playbooks/connector-paypal.md` — current parked operating posture, offline verification commands, and the no-deployment-claim constraint.
- `.planning/phases/28-connector-backed-revenue-pack/28-25-SUMMARY.md` — execution evidence and handoff.

## Decisions Made

- Park PayPal rather than treating structural consistency or owner attestation as live provider proof.
- Clear no open conditions. A production delegated-merchant read and evidence-backed revocation story are both still required before reconsidering a pass.
- Keep the provider invisible while allowing the remaining code-only Phase 28 plans to continue.

## Verification

| Check | Result |
|---|---|
| `node scripts/check-provider-lane.mjs --provider paypal --seal-decision from-owner` | Exit 0; resolved **park**; printed `lane: parked`, `clearedConditions: []`; explicitly **Not applied** |
| `node scripts/check-provider-lane.mjs --provider paypal --verify-gate` | Exit 0; `providerGates.test.ts` **25/25**; failed refresh and expired review each empty the passed projection |
| `node scripts/check-provider-lane.mjs --provider paypal --stage engineering` | Exit 0; structurally consistent; the revocation condition remains **PEND**; consistent is not passed |
| `cd packages/backend && npx vitest run convex/paypalConnector.test.ts` | Exit 0; **43/43**, including parked gate refusal before fetch |
| `'{}' \| node scripts/check-playbooks.mjs check` | Exit 0; no block output |
| `git diff --check` on both PayPal docs | Exit 0 |

## Deviations from Plan

The plan's action text says to apply the seal. The execution constraint for this continuation was
stricter: **local park/absence proof only; no Convex deployment call**. Accordingly, the seal
resolver was run without `--apply`, and both documents state that no deployment revision was
created or observed. This prevents a dry-run payload from being misreported as external evidence.

No Rules 1-3 code deviations were needed.

## Issues Encountered

- A read-only attempt to inspect the configured Convex gate was blocked by the sandbox with
  `connect EACCES` before any response. The pending retry was terminated when the local-only
  constraint was confirmed. No deployment mutation and no provider call occurred.
- `.planning/ROADMAP.md` already contained concurrent Phase 28 edits from another lane. This plan
  did not overwrite or stage that shared file; the parent orchestrator can consolidate the plan
  count after all wave-7 summaries land.
- `STATE.md` was intentionally untouched. Its explicit repository warning forbids every
  `gsd-tools state *` command because those commands have repeatedly corrupted the stacked state
  blocks.

## User Setup Required

None. The lane is deliberately parked.

## Next Phase Readiness

- The remaining code-only Phase 28 plans may continue with PayPal absent from provider discovery.
- Re-open PayPal only after a controlled production delegated-merchant read and a documented,
  evidence-backed revocation story agreed with PayPal.
- REVN-03 remains Pending; this parked lane does not complete it.

## Self-Check: PASSED

All three plan files exist, task commit `ca629d0` is present in git history, and the summary passes
`git diff --check`.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-31*
