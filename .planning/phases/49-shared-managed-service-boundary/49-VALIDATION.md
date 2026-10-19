---
phase: 49
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 49 validation strategy

This is a planned verification strategy, not an execution receipt.

| Plan | Requirement coverage | Required proof | Current state |
|---|---|---|---|
| 49-01 | MSVC-03 | Pure tests cover lifecycle transitions, unknown operations, material changes, disallowed writes and terminal unknown states. ADR does not override existing approval or recurrence gates. | Not executed |
| 49-02 | MSVC-03, MSVC-05 | Two-identity, stale-edit, missing-source, disabled-candidate, export/erasure and audit-projection tests pass. No query accepts a client-selected tenant. | Not executed |
| 49-03 | MSVC-05 | Duplicate start, pause/start race, stale callback, deployment interruption and ambiguous provider outcomes cannot duplicate work or bypass policy; normal existing starts still pass. | Not executed |
| 49-04 | MSVC-04 | Adversarial composition and tool snapshots prove no dispatch escalation, publishing/activation authority, foreign access or arbitrary HTTP/MCP execution. | Not executed |
| 49-05 | MSVC-06 | A first-time user configures and starts an attended service without assembling prompts or dispatching agents. Required current-source eval and authenticated browser gates pass before release. | Not executed |

## Release discipline

- Run meaningful focused contract/adapter/UI tests for changed behavior, typecheck and required repository free gates; full CI qualifies the exact committed release.
- Capture authenticated desktop/mobile and two-identity behavior where specified. Use isolated lifecycle state; preserve shared-production destructive-drill refusal.
- Paid calls, actual owner activation, real external content publication and timed probes use their concrete existing checkpoints. Missing evidence stays missing.
- A changed skill/body/model/grant/evaluator/source invalidates relevant exact-version evidence. Preserve historical receipts and qualify the changed surface.
- Phase verification records every applicable requirement as observed, failed, pending or explicitly excluded; never use a whole-phase green to conceal partial journeys.
- Check planning with an explicit repository root so Git safe-directory failure cannot silently skip the checker.
