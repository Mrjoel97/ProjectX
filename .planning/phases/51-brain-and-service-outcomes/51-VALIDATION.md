---
phase: 51
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 51 validation strategy

This is a planned verification strategy, not an execution receipt.

| Plan | Requirement coverage | Required proof | Current state |
|---|---|---|---|
| 51-01 | MSVC-10 | Outcome joins are tenant-safe and bounded; absent/stale/conflicting data stays explicit. Repeated snapshot ingestion cannot duplicate observations or fabricate campaign/ROI attribution. | Not executed |
| 51-02 | MSVC-11 | Agent-derived values remain labeled, old data never becomes fresh by rereading, removed evidence invalidates affected conclusions, and cross-tenant source refs fail. | Not executed |
| 51-03 | MSVC-10, MSVC-11 | Failed jobs do not imply goal regression, successful delivery does not imply goal achievement, and stale data cannot produce a confident success claim. Existing one-proposal/approval rules hold. | Not executed |
| 51-04 | MSVC-10, MSVC-11 | Operational completion, usefulness and business movement remain separately visible throughout the full journey; privacy and bounded history checks pass. | Not executed |

## Release discipline

- Run meaningful focused contract/adapter/UI tests for changed behavior, typecheck and required repository free gates; full CI qualifies the exact committed release.
- Capture authenticated desktop/mobile and two-identity behavior where specified. Use isolated lifecycle state; preserve shared-production destructive-drill refusal.
- Paid calls, actual owner activation, real external content publication and timed probes use their concrete existing checkpoints. Missing evidence stays missing.
- A changed skill/body/model/grant/evaluator/source invalidates relevant exact-version evidence. Preserve historical receipts and qualify the changed surface.
- Phase verification records every applicable requirement as observed, failed, pending or explicitly excluded; never use a whole-phase green to conceal partial journeys.
- Check planning with an explicit repository root so Git safe-directory failure cannot silently skip the checker.
