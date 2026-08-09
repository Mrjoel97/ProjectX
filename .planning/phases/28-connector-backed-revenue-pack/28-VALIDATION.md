---
phase: 28
slug: connector-backed-revenue-pack
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
revised: 2026-08-05
---

# Phase 28 — Validation Strategy

> Provider lanes finish independently as passed or parked. A passed subset may release, but REVN-01,
> REVN-02, REVN-03 and Phase 28 remain incomplete until every named production/live gate passes.

## Hard Preconditions

Plan 28-17 verifies landed Phase 19 ACTN-05/PIPE-01, Phase 25 production secret/OAuth posture, and
Phase 27 manifest/grant/eval/discovery/event contracts. All dependent work stops when this gate is red.

## Test Infrastructure

| Property | Value |
|---|---|
| Unit/integration | Vitest + convex-test |
| Browser | Authenticated Playwright, desktop/tablet/mobile |
| Provider evidence | Conditional smoke normal-run, --self-test and --verify-evidence |
| Candidate evidence | Golden --diagnostic and --activation-evidence modes |
| Strict completion | check-phase28-completion --self-test/--report/--verify-current/--strict |
| Full suite | pnpm revenue/backend/web tests, typechecks, web build and check-playbooks |

## Gate Rules

- 28-05..08 branch on approved_beta. Approved lanes build parser/adapter/smoke; parked lanes create
  decision/absence tests only and prove no route, capability or UI visibility.
- 28-22..25 contain pure owner judgment followed by automated server-gate sealing.
- 28-26 owns the server provider-gate state machine. Connections, finance, discovery and final close
  consume passed-only projections; refreshed failure disables availability immediately.
- 28-09 waits for all engineering and sealing lanes, which complete normally as passed or parked.
- Human checkpoints run no commands, capture no evidence and edit no state.
- 28-19 explicitly implements both diagnostic and activation-evidence eval modes before 28-20 uses them.
- 28-16 implements and self-tests strict phase completion before 28-27 final judgment/sealing.
- 28-21 and 28-29 drive telemetry from provider/workflow and plan-decision/recovery terminals.

## Exact Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Gate | Verification | Artifact | Status |
|---|---:|---:|---|---|---|---|---|
| 28-01-01 | 01 | 2 | REVN-01, REVN-02, REVN-03 | automated | node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-01-02 | 01 | 2 | REVN-01, REVN-02, REVN-03 | manual judgment | The owner states one decision per provider; no blanket approval is accepted. | external | ⬜ pending |
| 28-01-03 | 01 | 2 | REVN-01, REVN-02, REVN-03 | automated | node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-02-01 | 02 | 2 | REVN-05 | automated | pnpm --filter @pikar/revenue test -- contracts &amp;&amp; pnpm --filter @pikar/revenue typecheck | planned | ⬜ pending |
| 28-02-02 | 02 | 2 | REVN-05 | automated | pnpm --filter @pikar/revenue test | planned | ⬜ pending |
| 28-03-01 | 03 | 3 | REVN-01, REVN-02, REVN-03 | automated | pnpm --filter @pikar/revenue test -- credential | planned | ⬜ pending |
| 28-03-02 | 03 | 3 | REVN-01, REVN-02, REVN-03 | automated | pnpm --filter @pikar/backend test -- connectorCredentials schema &amp;&amp; pnpm --filter @pikar/backend typecheck | planned | ⬜ pending |
| 28-03-03 | 03 | 3 | REVN-01, REVN-02, REVN-03 | automated | node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-04-01 | 04 | 4 | REVN-01, REVN-02, REVN-03 | automated | pnpm --filter @pikar/backend test -- connectorOAuth | planned | ⬜ pending |
| 28-04-02 | 04 | 4 | REVN-01, REVN-02, REVN-03 | automated | pnpm --filter @pikar/backend test -- connectorFetch | planned | ⬜ pending |
| 28-04-03 | 04 | 4 | REVN-01, REVN-02, REVN-03 | automated | node scripts/check-playbooks.mjs &amp;&amp; pnpm --filter @pikar/backend typecheck | planned | ⬜ pending |
| 28-05-01 | 05 | 6 | REVN-01 | automated | pnpm --filter @pikar/backend test -- hubspot connectorOAuth connectorCredentials | planned | ⬜ pending |
| 28-05-02 | 05 | 6 | REVN-01 | automated | pnpm --filter @pikar/revenue test -- hubspot &amp;&amp; pnpm --filter @pikar/backend test -- hubspot | planned | ⬜ pending |
| 28-05-03 | 05 | 6 | REVN-01 | automated | node scripts/check-provider-lane.mjs --provider hubspot --stage engineering | planned | ⬜ pending |
| 28-06-01 | 06 | 6 | REVN-02, REVN-05 | automated | pnpm --filter @pikar/backend test -- quickbooks connectorCredentials | planned | ⬜ pending |
| 28-06-02 | 06 | 6 | REVN-02, REVN-05 | automated | pnpm --filter @pikar/revenue test -- quickbooks &amp;&amp; pnpm --filter @pikar/backend test -- quickbooks | planned | ⬜ pending |
| 28-06-03 | 06 | 6 | REVN-02, REVN-05 | automated | node scripts/check-provider-lane.mjs --provider quickbooks --stage engineering | planned | ⬜ pending |
| 28-07-01 | 07 | 6 | REVN-03 | automated | pnpm --filter @pikar/backend test -- stripeConnector connectorOAuth connectorCredentials | planned | ⬜ pending |
| 28-07-02 | 07 | 6 | REVN-03 | automated | pnpm --filter @pikar/revenue test -- stripe &amp;&amp; pnpm --filter @pikar/backend test -- stripeConnector | planned | ⬜ pending |
| 28-07-03 | 07 | 6 | REVN-03 | automated | node scripts/check-provider-lane.mjs --provider stripe --stage engineering | planned | ⬜ pending |
| 28-08-01 | 08 | 6 | REVN-03 | automated | pnpm --filter @pikar/backend test -- paypalConnector connectorOAuth connectorCredentials | planned | ⬜ pending |
| 28-08-02 | 08 | 6 | REVN-03 | automated | pnpm --filter @pikar/revenue test -- paypal &amp;&amp; pnpm --filter @pikar/backend test -- paypalConnector | planned | ⬜ pending |
| 28-08-03 | 08 | 6 | REVN-03 | automated | node scripts/check-provider-lane.mjs --provider paypal --stage engineering | planned | ⬜ pending |
| 28-09-01 | 09 | 8 | REVN-01, REVN-02, REVN-03 | automated | pnpm --filter @pikar/backend test -- connectorConnections connectorOAuth http | planned | ⬜ pending |
| 28-09-02 | 09 | 8 | REVN-01, REVN-02, REVN-03 | automated | pnpm --filter @pikar/web test -- connections &amp;&amp; pnpm --filter @pikar/web typecheck | planned | ⬜ pending |
| 28-09-03 | 09 | 8 | REVN-01, REVN-02, REVN-03 | automated | node scripts/check-playbooks.mjs &amp;&amp; pnpm --filter @pikar/backend typecheck | planned | ⬜ pending |
| 28-10-01 | 10 | 9 | REVN-04 | automated | pnpm --filter @pikar/revenue test -- crm | planned | ⬜ pending |
| 28-10-02 | 10 | 9 | REVN-04 | automated | pnpm --filter @pikar/backend test -- revenueCrm contacts pipeline | planned | ⬜ pending |
| 28-10-03 | 10 | 9 | REVN-04 | automated | node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-11-01 | 11 | 9 | REVN-05 | automated | pnpm --filter @pikar/backend test -- revenueFinance &amp;&amp; pnpm --filter @pikar/revenue test | planned | ⬜ pending |
| 28-11-02 | 11 | 9 | REVN-05 | automated | pnpm --filter @pikar/backend test -- revenueFinance | planned | ⬜ pending |
| 28-11-03 | 11 | 9 | REVN-05 | automated | node scripts/check-playbooks.mjs &amp;&amp; pnpm --filter @pikar/backend typecheck | planned | ⬜ pending |
| 28-12-01 | 12 | 10 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/core test -- specialists &amp;&amp; pnpm --filter @pikar/contracts test | planned | ⬜ pending |
| 28-12-02 | 12 | 10 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- revenueTools cockpitTools dispatch | planned | ⬜ pending |
| 28-12-03 | 12 | 10 | REVN-04, REVN-05, REVN-06 | automated | node scripts/check-playbooks.mjs &amp;&amp; pnpm --filter @pikar/backend typecheck | planned | ⬜ pending |
| 28-13-01 | 13 | 11 | REVN-06 | automated | pnpm --filter @pikar/revenue test -- reminders | planned | ⬜ pending |
| 28-13-02 | 13 | 11 | REVN-06 | automated | pnpm --filter @pikar/backend test -- invoiceReminders cockpit plans | planned | ⬜ pending |
| 28-13-03 | 13 | 11 | REVN-06 | automated | pnpm --filter @pikar/backend test -- contacts cockpit gmail invoiceReminders &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-14-01 | 14 | 12 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/contracts test -- skillBodies | planned | ⬜ pending |
| 28-15-01 | 15 | 16 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- revenueTelemetry telemetry | planned | ⬜ pending |
| 28-15-02 | 15 | 16 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- revenueTelemetry opsSignals | planned | ⬜ pending |
| 28-15-03 | 15 | 16 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- revenueTelemetry telemetry opsSignals &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-16-01 | 16 | 19 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/web test -- RevenuePackPanel | planned | ⬜ pending |
| 28-16-02 | 16 | 19 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | node scripts/check-provider-lane.mjs --all --stage final &amp;&amp; pnpm --filter @pikar/web test:e2e -- e2e/revenue-pack.spec.ts | planned | ⬜ pending |
| 28-16-03 | 16 | 19 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | node scripts/check-phase28-completion.mjs --self-test &amp;&amp; pnpm --filter @pikar/revenue test &amp;&amp; pnpm --filter @pikar/backend test &amp;&amp; pnpm --filter @pikar/web test &amp;&amp; pnpm --filter @pikar/backend typecheck &amp;&amp; pnpm --filter @pikar/web typecheck &amp;&amp; pnpm --filter @pikar/web build &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-17-01 | 17 | 1 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | node scripts/check-phase28-readiness.mjs | planned | ⬜ pending |
| 28-17-02 | 17 | 1 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | manual judgment | The owner states pass only when production secret source, redirect ownership and fail-closed behavior are evidenced. | external | ⬜ pending |
| 28-17-03 | 17 | 1 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | node scripts/check-phase28-readiness.mjs &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-18-01 | 18 | 2 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-19-01 | 19 | 14 | REVN-04, REVN-05, REVN-06 | automated | pnpm eval:golden --self-check | planned | ⬜ pending |
| 28-19-02 | 19 | 14 | REVN-04, REVN-05, REVN-06 | automated | pnpm eval:golden --all-candidates --diagnostic &amp;&amp; pnpm eval:golden --all-candidates --activation-evidence | planned | ⬜ pending |
| 28-20-01 | 20 | 15 | REVN-04, REVN-05, REVN-06 | automated | pnpm eval:golden --all-candidates --activation-evidence &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-20-02 | 20 | 15 | REVN-04, REVN-05, REVN-06 | manual judgment | The owner names an approve/park decision for each exact eligible name@version pin. | external | ⬜ pending |
| 28-20-03 | 20 | 15 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- skills &amp;&amp; pnpm --filter @pikar/contracts test -- skillBodies &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-21-01 | 21 | 17 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- revenueTelemetry.integration connectorConnections revenueCrm revenueFinance invoiceReminders | planned | ⬜ pending |
| 28-22-01 | 22 | 7 | REVN-01 | automated | Pass requires current production suitability and controlled live read/revoke evidence. | planned | ⬜ pending |
| 28-22-02 | 22 | 7 | REVN-01 | automated | node scripts/check-provider-lane.mjs --provider hubspot --seal-decision from-owner &amp;&amp; node scripts/check-provider-lane.mjs --provider hubspot --verify-gate | planned | ⬜ pending |
| 28-23-01 | 23 | 7 | REVN-02, REVN-05 | automated | Pass requires production credentials/self-assessment and controlled live report/revoke evidence. | planned | ⬜ pending |
| 28-23-02 | 23 | 7 | REVN-02, REVN-05 | automated | node scripts/check-provider-lane.mjs --provider quickbooks --seal-decision from-owner &amp;&amp; node scripts/check-provider-lane.mjs --provider quickbooks --verify-gate | planned | ⬜ pending |
| 28-24-01 | 24 | 7 | REVN-03 | automated | Pass requires current Extension read_only production/live evidence. | planned | ⬜ pending |
| 28-24-02 | 24 | 7 | REVN-03 | automated | node scripts/check-provider-lane.mjs --provider stripe --seal-decision from-owner &amp;&amp; node scripts/check-provider-lane.mjs --provider stripe --verify-gate | planned | ⬜ pending |
| 28-25-01 | 25 | 7 | REVN-03 | automated | Pass requires delegated merchant production/live read/revoke evidence. | planned | ⬜ pending |
| 28-25-02 | 25 | 7 | REVN-03 | automated | node scripts/check-provider-lane.mjs --provider paypal --seal-decision from-owner &amp;&amp; node scripts/check-provider-lane.mjs --provider paypal --verify-gate | planned | ⬜ pending |
| 28-26-01 | 26 | 5 | REVN-01, REVN-02, REVN-03, REVN-05 | automated | pnpm --filter @pikar/backend test -- providerGates | planned | ⬜ pending |
| 28-26-02 | 26 | 5 | REVN-01, REVN-02, REVN-03, REVN-05 | automated | node scripts/check-provider-lane.mjs --self-test &amp;&amp; pnpm --filter @pikar/backend test -- providerGates | planned | ⬜ pending |
| 28-27-01 | 27 | 20 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | Each eligible workflow receives one judgment and the owner acknowledges strict phase status. | planned | ⬜ pending |
| 28-27-02 | 27 | 20 | REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06 | automated | node scripts/check-phase28-completion.mjs --verify-current &amp;&amp; pnpm --filter @pikar/web test -- RevenuePackPanel &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-28-01 | 28 | 13 | REVN-04, REVN-05, REVN-06 | automated | pnpm --filter @pikar/contracts test -- skillBodies &amp;&amp; pnpm --filter @pikar/backend test -- skills &amp;&amp; node scripts/check-playbooks.mjs | planned | ⬜ pending |
| 28-29-01 | 29 | 18 | REVN-05, REVN-06 | automated | pnpm --filter @pikar/backend test -- revenueTelemetry.integration cockpit plans quickbooks stripeConnector paypalConnector | planned | ⬜ pending |

*Parked is a valid lane completion state, but not requirement or phase completion.*

## Non-Vacuity Checks

- Remove one prerequisite artifact and observe plan 17 fail.
- Park each provider in turn and prove only its routes/UI/workflows disappear.
- Fail a previously passed live refresh and prove server gate, Connections, finance and discovery disable it.
- Run every approved provider smoke in self-test and verify-evidence modes; reject stale/wrong-mode/sensitive evidence.
- Run no-rail and every available-rail finance combination without double-counting or fabricated zero.
- Assert reminder staging produces zero sends and suppression prevents partial group delivery.
- Run golden diagnostic and activation-evidence modes; a partial/red/over-cap pin cannot activate.
- Drive telemetry at actual terminals; direct helper invocation alone cannot satisfy coverage.
- Run all 16 provider pass/park combinations through strict completion:
  HubSpot controls REVN-01, QuickBooks REVN-02, Stripe plus PayPal control REVN-03, and any non-passed
  named gate keeps Phase 28 incomplete.

## Completion Contract

A passed workflow subset may ship. Strict completion requires current passed production/live gates for
HubSpot, QuickBooks, Stripe and PayPal. Parked, expired or failed keeps the mapped requirement and
Phase 28 incomplete, regardless of other released value.

## Sign-Off

- [x] Every task has an exact validation row.
- [x] No engineering plan has more than four tasks.
- [x] Human judgment and automated evidence/state mutation are separated.
- [x] Server-owned provider gates are consumed by every availability surface.
- [x] Evidence and strict-completion CLI modes are explicitly implemented and self-tested.
