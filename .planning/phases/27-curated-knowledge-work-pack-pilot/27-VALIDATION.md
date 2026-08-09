---
phase: 27
slug: curated-knowledge-work-pack-pilot
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
---

# Phase 27 Validation Strategy

## Test architecture

Phase 27 is proven at five layers: pure registry/provenance contracts, backend candidate and activation tests, outcome-state evals, authenticated responsive browser UAT, and repository-wide regression gates. Model prose is never the oracle; fixtures assert structured outcome, evidence, plan/artifact state, missing-source honesty, and forbidden-tool absence.

## Per-plan verification map

| Plan | Focused automated evidence | Blocking evidence |
|---|---|---|
| 27-01 | `pnpm vitest run scripts/knowledge-work-provenance.test.ts` and `--check-source` | Exact commit, committed selected-source snapshot/hashes, Apache-2.0 notices, reviewed-diff-only update path |
| 27-02 | Core/backend candidate tests and fixture-runner self-test | Total operation matrix; code-owned exact tool sets; first publication seam remains candidate; fixture validation exists before adaptation lanes |
| 27-03 | `pnpm --filter @pikar/backend test -- workflowPackTelemetry` | Refs/counts/enums-only events and exact metric semantics |
| 27-04 | `node scripts/run-workflow-pack-evals.mjs --packs business-pulse,campaign-plan --fixtures-only` | Positive, missing-source, partial, injection, and forbidden-write cases |
| 27-05 | `node scripts/run-workflow-pack-evals.mjs --packs customer-complaint,sales-call-prep --fixtures-only` | Raw inbox/web content cannot choose tools; zero send/calendar/CRM mutation |
| 27-06 | `node scripts/run-workflow-pack-evals.mjs --packs process-sop,brand-review --fixtures-only` | Cited artifacts, honest absent guidance, zero external publishing |
| 27-07 | Backend runtime, event-terminal and metric-projection integration tests | Real-loop exact tools; governed outputs; non-vacuous real events/read model |
| 27-08 | Complete provenance, final parity, publication and exact-candidate eval commands | Final body hashes; exhaustive matrix parity; six immutable dark candidates; held-out thresholds |
| 27-09 | Fast web component tests, focused candidate E2E, rollback tests, then complete Playwright/repository gate after owner checkpoint | Authenticated responsive preview, dark-before-pass, first rollback-to-dark, later prior-version rollback, owner-before-activation |

## Sampling cadence

- Each task runs its focused command before commit.
- Each wave reruns the affected package tests and provenance verifier.
- Wave 3 proves the real runtime and event path.
- Wave 4 finalizes adapted hashes, publishes all six candidates, and runs the complete held-out/adversarial corpus.
- Wave 5 runs authenticated desktop/mobile UAT, then repository typechecks, build, playbook watcher, and the complete pack suite.

## Release gate

No pack is discoverable unless its exact immutable version has valid provenance, passing outcome/adversarial eval evidence, authenticated browser evidence, reviewed operation/tool parity, and a rollback target. Failure blocks only that pack. External content remains untrusted, missing connectors produce named partial states, and every write remains an existing governed-plan operation.

## Manual checks

- Owner reviews attribution/modification notice and the upstream-to-Pikar diff.
- Owner confirms each quick start explains available and missing sources before run.
- Owner executes approve, edit, reject, disable, and rollback journeys without raw content appearing in telemetry/audit.
