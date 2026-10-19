---
phase: 50
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 50 validation strategy

This is a planned verification strategy, not an execution receipt.

| Plan | Requirement coverage | Required proof | Current state |
|---|---|---|---|
| 50-01 | MSVC-07 | Every matrix row cites evidence of the specified class and exact source/environment. Real elapsed-time requirements remain open until observed; no table or generic scheduler is added. | Not executed |
| 50-02 | MSVC-08, MSVC-09 | Tests cover duplicate claims, DST ambiguity, stale approvals, overlap, terminal/refundable/unknown cost distinctions and pause fences. Genuine collector evidence from 50-01 remains separate. | Not executed |
| 50-03 | MSVC-07, MSVC-08, MSVC-09 | New decision passes exact validator; two-tenant due/skip/pause/auth/budget/recovery tests pass. Buffer/Zernio opt-in report and weekly review regressions pass. | Not executed |
| 50-04 | MSVC-08, MSVC-09 | Multiple observed unattended cycles and required failure paths have bounded receipts; every run has an honest terminal and reconciled budget. Offline tests alone cannot close the phase. | Not executed |

## Release discipline

- Run meaningful focused contract/adapter/UI tests for changed behavior, typecheck and required repository free gates; full CI qualifies the exact committed release.
- Capture authenticated desktop/mobile and two-identity behavior where specified. Use isolated lifecycle state; preserve shared-production destructive-drill refusal.
- Paid calls, actual owner activation, real external content publication and timed probes use their concrete existing checkpoints. Missing evidence stays missing.
- A changed skill/body/model/grant/evaluator/source invalidates relevant exact-version evidence. Preserve historical receipts and qualify the changed surface.
- Phase verification records every applicable requirement as observed, failed, pending or explicitly excluded; never use a whole-phase green to conceal partial journeys.
- Check planning with an explicit repository root so Git safe-directory failure cannot silently skip the checker.
