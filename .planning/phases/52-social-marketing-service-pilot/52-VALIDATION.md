---
phase: 52
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 52 validation strategy

This is a planned verification strategy, not an execution receipt.

| Plan | Requirement coverage | Required proof | Current state |
|---|---|---|---|
| 52-01 | MSVC-12 | A new user can understand and complete supported setup; missing media, unsupported platform, stale account and absent analytics are accurately explained. Report opt-ins require explicit consent. | Not executed |
| 52-02 | MSVC-13 | Injected/model instructions cannot publish. Approved content reaches the supported provider path only once; negative/uncertain paths preserve evidence. Real publication needs explicit approval of actual content and destination. | Not executed |
| 52-03 | MSVC-14 | A real controlled user receives useful repeated service results, sees truthful evidence and can stop future Pikar work. Source/skill/version qualification remains current; reporting exceptions and workspace inputs regressions pass. | Not executed |

## Release discipline

- Run meaningful focused contract/adapter/UI tests for changed behavior, typecheck and required repository free gates; full CI qualifies the exact committed release.
- Capture authenticated desktop/mobile and two-identity behavior where specified. Use isolated lifecycle state; preserve shared-production destructive-drill refusal.
- Paid calls, actual owner activation, real external content publication and timed probes use their concrete existing checkpoints. Missing evidence stays missing.
- A changed skill/body/model/grant/evaluator/source invalidates relevant exact-version evidence. Preserve historical receipts and qualify the changed surface.
- Phase verification records every applicable requirement as observed, failed, pending or explicitly excluded; never use a whole-phase green to conceal partial journeys.
- Check planning with an explicit repository root so Git safe-directory failure cannot silently skip the checker.
