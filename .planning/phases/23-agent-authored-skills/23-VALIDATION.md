---
phase: 23
slug: agent-authored-skills
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-12
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for agent-authored candidates, exact held-out evidence, independent
> owner approval, tenant runtime attribution, and immutable rollback.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + convex-test; runner `--self-check`; Playwright Chromium; Node artifact assertions |
| **Config files** | Existing package Vitest configs, `apps/web/playwright.config.ts`, workspace scripts |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts --maxWorkers=1` |
| **Full suite command** | `pnpm test && pnpm typecheck && pnpm --filter @pikar/backend eval:golden -- --self-check && pnpm --filter web build && node scripts/check-playbooks.mjs && git diff --check` |
| **Estimated runtime** | Quick ~90 s; focused phase gate ~6 min; full free gate environment-dependent |

---

## Sampling Rate

- **After every task commit:** Run the task's focused command; never defer a red to the next plan.
- **After every plan wave:** Run that plan's complete `<verification>` block and playbook/diff gates.
- **Before Plan 23-06 handoff:** Focused + full free + browser + every mutation row must be green/restored.
- **Before any paid call:** Re-run offline self-check and byte-compare live state to the immutable handoff.
- **Before `$gsd-verify-work`:** Full suite, post-live artifact checks, and requirement mapping must be green.
- **Max feedback latency:** 90 s for backend contract/transition edits; runner self-check stays $0.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 23-01-01 | 01 | 1 | SKILL-02 | contract | `pnpm --filter @pikar/contracts exec vitest run src/skillAuthoring.test.ts` | ✅ | ⬜ pending |
| 23-01-02 | 01 | 1 | SKILL-02 | schema/behavior | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts --maxWorkers=1` | ✅ | ⬜ pending |
| 23-01-03 | 01 | 1 | SKILL-02 | docs/mutation | focused tests + `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 23-02-01 | 02 | 2 | SKILL-02 | regression | backend `skills.test.ts` | ✅ | ⬜ pending |
| 23-02-02 | 02 | 2 | SKILL-02 | integration | backend `skills.test.ts` | ✅ | ⬜ pending |
| 23-02-03 | 02 | 2 | SKILL-02 | privacy/structure | `skills.test.ts llmRedaction.test.ts` | ✅ | ⬜ pending |
| 23-03-01 | 03 | 3 | SKILL-02 | tool structure | backend `cockpitTools.test.ts` | ✅ | ⬜ pending |
| 23-03-02 | 03 | 3 | SKILL-02 | real-loop/trace | backend `runCockpitAgent.test.ts` + backend `traceParity.test.ts` | ✅ | ⬜ pending |
| 23-03-03 | 03 | 3 | SKILL-02 | redaction/mutation | backend focused trio + playbook gate | ✅ | ⬜ pending |
| 23-04-01 | 04 | 4 | SKILL-02 | manifest/contract | contracts authoring + runner `--self-check` | ✅/❌ W0 | ⬜ pending |
| 23-04-02 | 04 | 4 | SKILL-02 | runner oracle | backend skills + runner `--self-check` | ✅/❌ W0 | ⬜ pending |
| 23-04-03 | 04 | 4 | SKILL-02 | held-out parser | runner `--self-check` | ❌ W0 | ⬜ pending |
| 23-04-04 | 04 | 4 | SKILL-02 | mutation/privacy | contracts + runner self-check + playbooks | ✅/❌ W0 | ⬜ pending |
| 23-05-01 | 05 | 5 | SKILL-02 | owner/eval transition | backend `skills.test.ts` | ✅ | ⬜ pending |
| 23-05-02 | 05 | 5 | SKILL-02 | truth table/rollback | backend `skills.test.ts` | ✅ | ⬜ pending |
| 23-05-03 | 05 | 5 | SKILL-02 | tenant/owner UI | web `skillAuthoring.test.ts` + `tenantSkillReview.test.ts` + web typecheck | ✅ | ⬜ pending |
| 23-05-04 | 05 | 5 | SKILL-02 | separation/mutation | backend + web focused + playbooks | ✅ | ⬜ pending |
| 23-06-01 | 06 | 6 | SKILL-02 | two-auth/artifact/free gate | native exact A/B identity witnesses + validator controls + full exact-source CI39430449721 | ✅ | ✅ green2026-10-20 |
| 23-06-02 | 06 | 6 | SKILL-02 | browser-spend authorization | verbatim “Approve staging alternative”;100cent/two-turn envelope closed with actual budget receipt | manual | ✅ green2026-10-20 |
| 23-06-03 | 06 | 6 | SKILL-02 | authenticated browser | actual native A/B + measured1440x900/390x900 signed-in iframes, keyboard review and candidate-only turns; manual-native proof | ✅/manual | ✅ green2026-10-20 |
| 23-06-04 | 06 | 6 | SKILL-02 | artifact schema | existing immutable writer/private-needle validation; exact23-LIVE-HANDOFF SHA112ce264…dc45 | ✅ | ✅ green2026-10-20 |
| 23-07-01 | 07 | 7 | SKILL-02 | zero-spend recheck | native readiness/exact handoff preflight and free gates passed for original source06060d2/CI39432731681; not future changed source | ✅ | ✅ green, original attempt |
| 23-07-02 | 07 | 7 | SKILL-02 | spend authorization | exact candidate/full 46-case suite/$2 one-attempt approval bbe9dea3…d2e64; no extra attribution turn | manual | ✅ green 2026-10-20 |
| 23-07-03 | 07 | 7 | SKILL-02 | paid held-out gate | run 0b8d825d interrupted:7 reported passes/0 fails, case 08 no verdict; normally closed budget/no passing evidence or result artifact | ✅ | ⚠️ partial 2026-10-20 |
| 23-07-04 | 07 | 7 | SKILL-02 | public non-owner refusal | fresh native authenticated B app/client public mutation without token extraction + exact eval-result validation | ✅/manual | ⬜ pending |
| 23-08-01 | 08 | 8 | SKILL-02 | immutable recheck | handoff+eval validators, state/auth/cap comparison | ✅/❌ W0 | ⬜ pending |
| 23-08-02 | 08 | 8 | SKILL-02 | owner UI activation | blocking owner human-action + exact readback | manual | ⬜ pending |
| 23-08-03 | 08 | 8 | SKILL-02 | paid runtime/isolation | exactly one A + one B turn under remaining cap | ✅ | ⬜ pending |
| 23-08-04 | 08 | 8 | SKILL-02 | rollback/final artifact | exact owner rollback + live-result validator | ❌ W0 | ⬜ pending |
| 23-09-01 | 09 | 9 | SKILL-02 | closure | evidence hash chain + full repository gate + playbooks/requirements/roadmap | mixed | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ partial/flaky*

---

## Wave 0 Requirements

- [ ] `packages/backend/scripts/eval-suite-manifest.json` — exact current suite revision/id/hash/count identity (23-04).
- [ ] `packages/backend/scripts/eval-cases/40-agent-author-happy.json` through `44-agent-author-retry.json` — held-out authoring corpus (23-04; use next stable ids if prerequisite numbering differs).
- [x] `apps/web/e2e/agent-skill-authoring.spec.ts` — freely qualified harness; actual23-06 used recorded native sessions/two turns/manual responsive proof, not an invented Playwright run.
- [x] Closed native-origin authRefs alternative — actual distinct A127.0.0.1:3111/Blocalhost:3111 witnesses; legacy storage-file refs remain supported only with actual exports. No export was invented for23-06.
- [x] `.planning/phases/23-agent-authored-skills/validate-live-artifact.mjs` + self-test — exact closed schemas/value/privacy scan qualified; root validated actual handoff with private needle.
- [x] `.planning/phases/23-agent-authored-skills/23-LIVE-HANDOFF.json` — written once after actual browser/full free gates; SHA112ce264…dc45.
- [ ] `.planning/phases/23-agent-authored-skills/23-EVAL-RESULT.json` — generated only after the exact full eval and B refusal (23-07).
- [ ] `.planning/phases/23-agent-authored-skills/23-LIVE-RESULT.json` — generated only after owner activation/runtime/rollback (23-08).

Existing Vitest, convex-test, Playwright, runner, inspector, and playbook infrastructure covers all
other tasks. Wave-0 artifacts are created by the first plan that consumes them, before their gate.

---

## Requirement-to-Proof Map

| Risk / required truth | Fast proof | Integration proof | Live proof |
|-----------------------|------------|-------------------|------------|
| Candidate-only agent tool | source/key-set test | scripted real loop inserts candidate, active unchanged | explicit browser request produces parked candidate |
| Server-owned provenance | contract/schema tests | exact row has agent + trusted source refs; spoof args rejected | owner review + handoff readback |
| Tenant isolation | index/source tests | A/B same name/version/id collision | author vs foreign runtime/readback |
| Exact full-suite eval | strict predicate + manifest self-check | stale/id/tenant/version/suite mutations red | one authorized unfiltered run on handoff id |
| Owner/eval conjunction | four-cell backend truth table | non-owner with valid evidence leaves state unchanged | non-owner refusal then separate owner UI activation |
| No capability escalation | tool snapshot/source scan | adversarial fixture leaves tool/request state unchanged | self-activation/escalation browser turn |
| Fixture state isolation | deterministic subtenant derivation self-check | each authoring fixture positively witnesses only its own source row; no cleanup path | full run includes every authoring case without pending-row interference |
| Immutable rollback | eligibility tests | exact prior-active/baseline transition and snapshot comparison | owner rollback restores handoff id/hash |
| Holdout/log privacy | no exposure path scan | needles absent from audit/DLQ/telemetry/returns | artifacts/UI contain refs/counts only |

---

## Required Mutation Ledger

Every mutation is temporary: save pristine bytes, apply one defect, run the named narrow witness,
record the red, restore byte-identically, rerun green.

| # | Mutation | Required red witness |
|---|----------|----------------------|
| 1 | Widen agent-authorable set to ungated/unreachable skill | contract subset/reachability test |
| 2 | Insert agent row as `active` | candidate-only backend test |
| 3 | Accept caller `tenantId`, `author`, status, evidence, approval, or rollback flag | validator/source key-set test |
| 4 | Remove tenant predicate/source identity from retry/read | A/B collision or source-conflict test |
| 5 | Archive/supersede a never-active pending agent draft | pending/rollback-eligibility test |
| 6 | Construct authoring tool unconditionally or grant from requested tool name | specialist structural-absence snapshot |
| 7 | Add activation/evidence/owner call to author tool region | source separation test |
| 8 | Stop threading grant/source through real runAgentLoop | scripted real-loop lineage test |
| 9 | Validate evidence without candidate id/registry tenant/name/version | exact tenant collision test |
| 10 | Accept stale/missing suite revision/hash/count | strict agent evidence contract test |
| 11 | Record evidence after `--only`, zero-case, failed, or over-cap run | runner self-check suppression tests |
| 12 | Skip suite self-check before first live call | runner source-order test |
| 13 | Downgrade `activateAgentCandidate` from ownerMutation | non-owner-with-valid-evidence test |
| 14 | Remove eval condition or write approval before the gate | owner-without-evidence snapshot test |
| 15 | Route agent row through Phase 21 user activation | author-path separation test |
| 16 | Treat archived status alone as rollback proof | never-active rollback refusal test |
| 17 | Move owner review component outside exact isOwner mount | web mount-guard test |
| 18 | Put adaptation/fixture/raw evidence into audit/tool/UI/artifact | high-entropy privacy scan |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real model selects authoring tool from explicit user intent | SKILL-02 | Tool selection/wording is model behavior, not proven by scripted mocks and incurs ordinary cockpit spend | Plan 23-06 Tasks 2-3; obtain fresh bounded-turn authorization, then block rather than secretly edit the gated cockpit skill if it fails |
| Owner vs non-owner review presentation | SKILL-02 | Source mounting is not pixel/focus/live-session evidence | Plan 23-06 two controlled identities, desktop+narrow+keyboard |
| Paid full held-out gate | SKILL-02 | Incurs real model/search spend | Plan 23-07 Task 2 obtains fresh exact-run authorization first |
| Owner understands exact diff and separately activates | SKILL-02 | Approval is a human governance act that must not auto-approve | Plan 23-08 Task 2 owner personally reviews refs/diff/eval and clicks exact row |

---

## Paid/Live Stop Conditions

- No fresh explicit authorization for the exact handoff id/model/cap.
- Handoff deployment/suite/candidate/source/hash/state differs on re-read.
- Any free gate, mutation restore, manifest self-check, or browser prerequisite is red/skipped.
- `--only` present, zero matching fixtures, stale manifest, or evidence already unexpectedly present.
- Owner/non-owner controlled identities or intended deployment cannot be proven.
- Candidate resolution yields zero/multiple rows or requires newest/name/version guessing.

---

## Validation Sign-Off

- [x] All tasks have automated verification or an explicit blocking human checkpoint.
- [x] Sampling continuity: no three consecutive tasks lack automated feedback.
- [x] Wave 0 covers every not-yet-existing test/artifact.
- [x] No watch-mode flags.
- [x] Fast feedback path is under 90 s in the focused backend lane under normal resources.
- [x] Paid work is isolated behind fresh authorization after immutable handoff revalidation.
- [x] `nyquist_compliant: true` set in frontmatter.

**Current disposition2026-10-20:** Phase21 remains accepted and Phase22/GOVN-01 closed.
23-06rows are green: fullCI39430449721 and immutable handoff
`112ce2643ae15d4b2c39961b09506223bf0d6fe9978993dfe9536cee2dcbdc45` bind the actual
native pair, two bounded turns, measured responsive/keyboard proof and closed budget observation.
See23-06-SUMMARY and Phase48's23-06completion receipt. Desktop-browser responsive evidence
is not touch/mobile-device testing; snapshots are not actual prompt-load attribution.
23-07 preflight and its separate $2 authorization passed for the original attempt only;
run 0b8d825d is interrupted/partial. The separately reproduced routing defect has a narrow
offline fix with 39 routing and four diagnostic tests passing. The later emailOnly oracle
correction passes 25 scoped-query tests and the 57-fixture/12-skill self-check; its new corpus
hash and evaluator revision are recorded separately in 23-07-SUMMARY. These are offline
checks, not a live semantic pass. Changed evaluator inputs require fresh source qualification, handoff disposition and
new paid approval. That defect does not certify the generic exception's exact branch. Its
historical open 14:38:57.281Z budget observation is preserved; later timing reconciliation and
one normal guarded close at 14:48:43.529Z establish 89 settled/0 holds/closed/no breach, not a
complete evaluation. The generic error's exact guard-time cause remains unproven. No eval-result/
Bmutation/activation/cleanup/rerun followed.23-07/08/09 and SKILL-02/Phase23/48 remain open;
Phase49 has not started.23-07 follows the
October19native-session reconciliation: fresh exact-row full unfiltered eval authorization,
no extra runtime-attribution probe, then real native B public OWNER_REQUIRED refusal without JWT
extraction/replay. No evaluation, activation or final closure is certified by23-06 completion.

Later PR79 staging-only release run 39460078883/job 118756953910 passed for source
b10740d6466db155c48519aba6323d5b0c27c406/CI39446162910. Current read-only readiness at
16:48:53.219Z and native A/B identity matches preserve the candidate and closed old budget;
fresh responsive proof/versioned handoff subsequently completed at 17:01:27.296Z. See 23-07-SUMMARY and the separate
Phase48 PR79 release observation. This staging approval authorizes no paid evaluation,
activation or production deployment and does not relabel historical proof or close 23-07.

Current next input is `handoffs/2026-10-20-pr79/23-LIVE-HANDOFF.json`, SHA256
`ce31e352302bab168ba81bc564fbec90e76b2ab3eeafac402bbfa65792857d61`, with companion
`23-HANDOFF-REFRESH.json`, SHA256 `6b86ddbe2ad61dc4f331024a0e08b3fdb3420c0771bdbb28a5a38c3161cc31c8`.
Immutable writer/scanner/live matching passed after six stable reads. Actual 1440x900/390x900
iframe proof and direct native keyboard draft/diff review are recorded; embedded controls,
touch/device testing and fresh authoring/refusal replay are not claimed. Existing A owner/B
non-owner remain verified. Old handoff/partial bytes stay unchanged. This refresh does not
mark new-source paid preflight or evaluation green: paidReady/paidAuthorized false, no new
eval-result/public B mutation/activation/production release. Phase 23 remains 6/9, 48 partial,
49 not started.
