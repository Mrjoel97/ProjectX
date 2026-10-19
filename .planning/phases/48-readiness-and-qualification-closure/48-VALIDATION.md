---
phase: 48
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 48 validation strategy

This is a planned verification strategy, not an execution receipt.

| Plan | Requirement coverage | Required proof | Current state |
|---|---|---|---|
| 48-01 | MSVC-01 | Planning consistency checker succeeds with an explicit repository root. Every inventory claim has a source, evidence scope and next action. No new live or paid qualification is claimed. | Inventory executed; see 48-01-SUMMARY.md |
| 48-02 | MSVC-02 | Existing operator validators accept 23-LIVE-HANDOFF.json → 23-EVAL-RESULT.json → 23-LIVE-RESULT.json with matching hashes/current source and deployment. Required owner acts are observed; current free gates pass. | Not executed |
| 48-03 | MSVC-02 | Each applicable matrix cell references an observed result or an explicit exclusion reason. Responsive and two-identity paths pass; privacy/audit receipts contain refs/counts only. Uncertain writes are not retried. | Not executed |
| 48-04 | MSVC-02 | Requirement-to-plan-to-evidence mapping is complete, baseline restored, planning checker passes and unresolved blockers are explicit. | Not executed |

## Release discipline

- Run meaningful focused contract/adapter/UI tests for changed behavior, typecheck and required repository free gates; full CI qualifies the exact committed release.
- Capture authenticated desktop/mobile and two-identity behavior where specified. Use isolated lifecycle state; preserve shared-production destructive-drill refusal.
- Paid calls, actual owner activation, real external content publication and timed probes use their concrete existing checkpoints. Missing evidence stays missing.
- A changed skill/body/model/grant/evaluator/source invalidates relevant exact-version evidence. Preserve historical receipts and qualify the changed surface.
- Phase verification records every applicable requirement as observed, failed, pending or explicitly excluded; never use a whole-phase green to conceal partial journeys.
- Check planning with an explicit repository root so Git safe-directory failure cannot silently skip the checker.
