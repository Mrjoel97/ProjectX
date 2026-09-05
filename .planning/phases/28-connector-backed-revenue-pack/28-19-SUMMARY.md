---
phase: 28-connector-backed-revenue-pack
plan: 19
subsystem: revenue-candidate-eval
tags: [revenue, eval, golden, state-oracle, candidate, fail-closed]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: Eight exact byte-pinned dark revenue candidates from plan 28-28
provides:
  - Eleven state-based revenue fixtures mapped directly to all eight exact candidate pins
  - Dry diagnostic and activation-evidence modes with candidate-specific refs
  - A complete live diagnostic that keeps all failing candidates dark
affects: [28-20]
key-files:
  modified:
    - packages/backend/scripts/run-eval-golden.mjs
  evidence:
    - C:/Users/expert/AppData/Local/Temp/pikar-revenue-eval-28-19/revenue-candidate-diagnostic.v1.json
    - C:/Users/expert/AppData/Local/Temp/pikar-revenue-eval-28-19/revenue-activation-evidence.v1.json
key-decisions:
  - "A failed live result is evidence and must retain the complete per-pin fixture refs."
  - "Candidate failures stop activation; they do not get normalized into a passing aggregate."
  - "The activation-evidence artifact records verdicts only and performs no registry mutation."
requirements-completed: []
requirements-blocked: [REVN-04, REVN-05, REVN-06]
completed: 2026-09-01
---

# Phase 28 Plan 19: State-Based Revenue Candidate Evaluation Summary

**All eight exact v1 candidates were exercised against eleven state-based fixtures; three passed,
five failed, and every row remains a dark candidate.**

## Accomplishments

- Added eleven direct revenue fixtures covering lead ranking, call lists, pipeline review, partial
  CRM coverage, injected CRM text, exact cash flow, mixed-currency refusal, unknown payroll,
  reminder proposal, suppression refusal, and the specialist router.
- Extended the golden runner with exact lock-pin discovery, deterministic state observation,
  fail-closed paid qualification, dry diagnostic, and refs-only activation-evidence modes.
- Proved all 57 fixtures are capable of failing through the offline self-check; both dry modes
  covered 8/8 exact pins with candidate-specific refs at $0.
- Ran the complete live suite once after explicit owner approval. It attempted 11/11 fixtures and
  produced a schema-versioned red diagnostic rather than activating or editing registry state.
- Fixed a live-discovered evaluator contradiction: the first implementation stopped at the first
  failed fixture but required the full per-pin fixture refs when serializing. Commit `8b1945a`
  now runs the complete candidate fixture set and preserves honest red evidence.

## Live Candidate Results

Run timestamp: `2026-09-01T02:17:19.740Z`.

| Exact pin | Result | Fixtures | Model-reported cost | Finding |
|---|---|---:|---:|---|
| `revenue-call-list@1` | PASS | 1/1 | $0.00031800 | Exact call-list state matched. |
| `revenue-cash-flow@1` | FAIL | 0/2 | $0.00047490 | Cash window drifted by one day and returned two points rather than three; mixed-currency case produced no finance result. |
| `revenue-customer-pulse@1` | FAIL | 0/2 | $0.00071385 | Partial case reread CRM instead of declaring the missing authority; injection case returned the attention projection rather than customer pulse. |
| `revenue-invoice-reminder@1` | FAIL | 0/2 | $0.00044700 | Proposal returned non-JSON; suppression invoked the staging tool twice. No send occurred. |
| `revenue-lead-triage@1` | PASS | 1/1 | $0.00032445 | Exact ranked lead state matched. |
| `revenue-payroll-confidence@1` | FAIL | 0/1 | $0.00034980 | Returned current-day/medium confidence and omitted `declareUnsupported`; expected pinned-day/low confidence. |
| `revenue-pipeline-review@1` | FAIL | 0/1 | $0.00029205 | Returned the attention projection and omitted the required missing-authority declaration. |
| `revenue-specialist@1` | PASS | 1/1 | $0.00030240 | Exact specialist routing state matched. |

Totals: **3/8 pins passed, 3/11 fixtures passed, exact model-reported cost $0.00322245**.
The local guardrail ledger rounds each model spend event up to one cent, so this repaired run debited
11 cents. The earlier artifact-discovery run attempted eight model turns and debited 8 cents before
the serializer defect discarded its exact-cost total; cumulative guarded ledger debit for both paid
runs is therefore **19 cents**. All earlier deployment/preflight attempts stopped before spend.

## Evidence Artifacts

| Artifact | SHA-256 | Meaning |
|---|---|---|
| `revenue-candidate-diagnostic.v1.json` | `73c15e0ac9463e77713b202975441a463c0d9bcb743fd3250e0eb05cbcf3f236` | Complete live pin, outcome, cost, latency, refs, and failure evidence. |
| `revenue-activation-evidence.v1.json` | `16681ff2ff13b897ee40cac057c24c5e2fc958d5ceebf46131dd690a28857bec` | Refs-only 8/8 exact-pin handoff; registry state unchanged. |

Both artifacts are schema version 1 and bind the 46-case golden suite hash
`1cbf5d5b389173c64490f3932734d445375cfd42a2460a86509bc35308a4e913` plus the 11-case
revenue state-suite hash `bcd09b89ba6af2a6b43e9103beab026c058f8db2a0f58ca686fae23432211da4`.

## Verification

| Gate | Result |
|---|---|
| Backend focused tests | **48/48 passed** |
| `pnpm eval:golden --self-check` | **57 fixtures valid** |
| Dry `--all-candidates --diagnostic` | **8/8 pins, $0** |
| Dry `--all-candidates --activation-evidence` | **8/8 pins, $0** |
| Live repaired diagnostic | **11/11 attempted; 3/8 pins passed; exit 1 fail-closed** |
| Live activation-evidence generation | **8/8 exact pins recorded; registry unchanged; exit 1 because five verdicts are red** |
| Post-run candidate read-back | **8/8 remain `candidate`, v1, exact hash, valid provenance** |
| `git diff --check` for serializer repair | **exit 0** |
| Biome | Unavailable in this checkout (`biome` not recognized), same recorded local tooling limitation as plan 28-28. |

## Commits

- `6cdb5c6` — failing revenue golden fixtures
- `5489abd` — exact revenue state oracle
- `b44bdfc` — guarded candidate diagnostic modes
- `cf8cff5` — missing direct candidate fixtures
- `4e744f4` — exact candidate execution seam
- `8b1945a` — preserve complete failed live diagnostics

## Next Phase Readiness

Plan 28-20 has a complete, version-specific judgment artifact, but **must not activate the five red
pins**. The three green pins are eligible for owner judgment only; a passing pin is not automatic
authorization. Cash-flow and payroll also expose a fixture/runtime anchor mismatch that should be
resolved before either finance candidate is evaluated again. No rerun is implied by this summary.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
