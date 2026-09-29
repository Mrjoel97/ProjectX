---
phase: 30
slug: optional-vertical-workflow-packs
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-05
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest through existing pnpm package scripts; Playwright for authenticated UAT |
| **Config file** | Existing package configs; Phase 27-29 pack-eval harness is a hard prerequisite |
| **Quick run command** | `pnpm --filter @pikar/core test -- verticalPacks` |
| **Full suite command** | `pnpm test && pnpm typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` |
| **Estimated runtime** | ~180 seconds offline; live candidate eval/UAT runs separately under cost/auth gates |

---

## Sampling Rate

- **After every task commit:** Run the task's focused package/unit command.
- **After every plan wave:** Run `pnpm test && pnpm typecheck && node scripts/check-playbooks.mjs`.
- **Before `$gsd-verify-work`:** Full offline suite, two pinned passing versions per pack (12 eval evidence records), authenticated responsive UAT, six controlled activation/real-rollback drills with public exposure off, per-pack disable checks, and the Bio structural-absence scan must be green.
- **Max feedback latency:** 60 seconds for focused offline tests; long build/live gates occur only at plan boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 1 | VERT-01, VERT-03, VERT-04 | unit/structural | `pnpm --filter @pikar/core test -- src/verticalPacks.test.ts` | ✅ current | ✅ 5/5 structural; no activation claim |
| 30-01-02 | 01 | 1 | VERT-01, VERT-04 | structural/playbook | `pnpm --filter @pikar/core typecheck && node scripts/check-playbooks.mjs check --exit-code` | ✅ current | ✅ source/playbook gate; semantic eval separate |
| 30-02-01 | 02 | 2 | VERT-01, VERT-02 | backend/isolation | `pnpm --filter @pikar/backend test -- convex/verticalPacks.test.ts` | ✅ current | ✅ 8/8 local discovery/isolation |
| 30-02-02 | 02 | 2 | VERT-01, VERT-02 | telemetry/rollback | `pnpm --filter @pikar/backend test -- convex/verticalPacks.test.ts convex/verticalPackBinding.test.ts` | ✅ current | ✅ local controls only; real rollback pending |
| 30-03-01 | 03 | 3 | VERT-02, VERT-03 | deterministic unit | `pnpm --filter @pikar/core test -- src/dataProfile.test.ts` | ✅ current | ✅ 12/12 deterministic profile |
| 30-03-02 | 03 | 3 | VERT-02, VERT-03 | integration/eval fixture | `pnpm --filter @pikar/backend test -- convex/verticalData.test.ts` | ✅ current | ✅ 6/6 owned-file integration; model eval pending |
| 30-04-01 | 04 | 3 | VERT-02, VERT-03 | contract/eval fixture | `pnpm --filter @pikar/backend test -- convex/verticalProductDesign.test.ts` | ✅ current | ✅ 6/6 source/authority fixtures; model eval pending |
| 30-04-02 | 04 | 3 | VERT-02, VERT-03 | capability/injection | `pnpm --filter @pikar/backend test -- convex/verticalProductDesign.test.ts` | ✅ current | ✅ denied-tool declaration; injection eval unrun |
| 30-05-01 | 05 | 3 | VERT-02, VERT-03 | high-stakes contract | `pnpm --filter @pikar/backend test -- convex/verticalLegal.test.ts` | ✅ current | ✅ 3/3 source/authority fixtures; legal eval pending |
| 30-05-02 | 05 | 3 | VERT-02, VERT-03 | adversarial/refusal | `pnpm --filter @pikar/backend test -- convex/verticalLegal.test.ts` | ✅ current | ✅ forbidden-tool declaration; adversarial eval unrun |
| 30-06-01 | 06 | 3 | VERT-02, VERT-03 | high-stakes contract | `pnpm --filter @pikar/backend test -- convex/verticalHr.test.ts` | ✅ current | ✅ 3/3 source/authority fixtures; HR eval pending |
| 30-06-02 | 06 | 3 | VERT-02, VERT-03 | adversarial/refusal | `pnpm --filter @pikar/backend test -- convex/verticalHr.test.ts` | ✅ current | ✅ forbidden-tool declaration; adversarial eval unrun |
| 30-07-01 | 07 | 3 | VERT-02, VERT-03 | contract/eval fixture | `pnpm --filter @pikar/backend test -- convex/verticalEngineering.test.ts` | ✅ current | ✅ 3/3 source/authority fixtures; model eval pending |
| 30-07-02 | 07 | 3 | VERT-02, VERT-03 | capability/injection | `pnpm --filter @pikar/backend test -- convex/verticalEngineering.test.ts` | ✅ current | ✅ denied-tool declaration; injection eval unrun |
| 30-08-01 | 08 | 4 | VERT-02, VERT-03, VERT-04 | registry/provenance | `pnpm --filter @pikar/backend test -- convex/verticalPackRegistry.test.ts convex/verticalPackBinding.test.ts convex/verticalEvalEvidence.test.ts`; `node packages/backend/scripts/run-eval-vertical.mjs --fixtures-only` | ✅ current | ✅ 41/41 current local registry/binding/evidence; six prepared/40 cases, no model pass |
| 30-08-02 | 08 | 4 | VERT-02, VERT-03 | pinned live eval | `pnpm eval:vertical -- --all-candidates --no-activate` | ❌ W4 | ⬜ pending |
| 30-09-01 | 09 | 5 | VERT-01, VERT-02 | component/browser | `pnpm --filter @pikar/web test -- verticalPackRecommendations && pnpm --filter @pikar/web test:e2e -- e2e/vertical-packs.spec.ts` | ❌ W5 | ⬜ pending |
| 30-09-02 | 09 | 5 | VERT-01, VERT-02, VERT-04 | exposure decision | `pnpm --filter @pikar/backend test -- verticalPackSelection` | ❌ W5 | ⬜ pending |
| 30-10-01 | 10 | 6 | VERT-01, VERT-02, VERT-03, VERT-04 | two-version eval/activation/rollback/isolation | `pnpm --filter @pikar/backend test -- verticalPackRollback && pnpm smoke:vertical-packs` | ❌ W6 | ⬜ pending |
| 30-10-02 | 10 | 6 | VERT-01, VERT-02, VERT-03, VERT-04 | repository gate | `pnpm test && pnpm typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/verticalPacks.test.ts` — total manifest, relevance/tool-authority parity, reason-state and Bio-absence assertions; current 5/5 offline structural tests.
- [ ] Phase 27-29 native pack candidate/eval/exposure contracts must exist and be referenced directly; Phase 30 must stop rather than create substitutes.
- [x] `packages/backend/convex/verticalPacks.test.ts` — two-tenant discovery, per-pack disable and artifact-retention fixtures; current 8/8 local controls.
- [ ] Vertical eval runner supports exact candidate pins and zero activation/send/write during evaluation; the recovery gate requires two passing versions for every pack before controlled activation.

No new test framework is required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legal/HR/Data assistive and review-required presentation | VERT-02, VERT-03 | High-stakes copy, hierarchy and user interpretation need human judgment | In an authenticated desktop and mobile session, inspect successful, partial and refused cards; confirm review copy is unavoidable and no decisive/autonomous action is offered. |
| Relevance without catalogue behavior | VERT-01 | Contextual recommendation quality and explanation clarity are product judgments | Use controlled tenants for solopreneur/startup/SME and connected/missing capabilities; confirm at most two recommendations and understandable available/blocked reasons. |
| All six responsive workflow gates | VERT-02 | Authenticated artifact navigation and real responsive behavior require a browser | Run one positive and one missing/adversarial case per pack; verify cited artifact, version/provenance, failure state and no external effect. |
| Independent disable/rollback usability | VERT-02 | Operational recovery and retained-artifact usability need live confirmation | For each pack, inspect two passing evaluated versions and its public-exposure-off A→B activation/B→A rollback trace; then disable independently and confirm new starts stop, old artifacts remain and unrelated packs work. |

## 2026-09-14 focused validation delta

The current working tree closes an implementation gap in 30-08: the native evidence layer now
binds exact UTF-8 output bytes and stable criterion IDs, resolves only mechanical receipt facts,
detects stale pins, and exposes an owner-only review console. Legal/HR finalization remains blocked
pending a separately qualified external attestation mechanism, and finalization cannot activate a
candidate.

The focused checks passed: **23** backend `verticalEvalEvidence` tests, **12** web admin
presentation/console tests, and backend/web typechecks. The cross-cutting Stage 3 research
deliverable change also passed **6** focused backend tests, **19** workspace-control tests and one
dispatch integration test. These counts qualify the local implementation boundary only.

Task 30-08-02 and every manual-only row remain pending. No paid full-corpus evaluation,
authenticated semantic review, qualified Legal/HR attestation, all-six responsive workflow UAT,
two-version evidence, candidate activation or rollback drill was performed.

## 2026-09-25 candidate-only requalification

The original `verticalPackRegistry.test.ts` command in row 30-08-01 no longer names a file in the
current tree. The current equivalent is `verticalPackBinding.test.ts`, backed by
`verticalEvalEvidence.test.ts`; no passing result is attributed to the nonexistent filename.
Direct current-tree Vitest runs passed **56/56** contracts body/provenance tests and **36/36**
backend binding/evidence tests (13 binding, 23 evidence), both with process exit 0. The binding
suite checks six exact LF body/hash mirrors, idempotent candidate publication, independent version
allocation, refusal of activation without the pack gate, and dormant ordinary starts.
`run-eval-vertical.mjs --fixtures-only` exited 0 and returned six prepared version-1 candidates;
it explicitly reported `modelEvaluated:false`, `evidenceRecorded:false`, and
`runtimeEnabled:false`. This is current repository/local Task 30-08-01 evidence only. It is **not**
the paid all-candidate outcome/adversarial run of Task 30-08-02, owner acceptance, two-version
qualification, or permission to activate Legal, HR, Data, or any other pack.

The separate [production candidate read-back](30-08-PRODUCTION-CANDIDATE-READBACK-2026-09-25.md)
found six exact v1 candidate rows, each body SHA-256 matching its local canonical adaptation,
with no active row for any of them and no `vertical-bio` row. This is a current-status and
source-identity checkpoint, not evaluation evidence or proof of every runtime exposure path.
Task 30-08-02, owner review and all subsequent activation/rollback gates remain open.

## 2026-09-29 current-source offline validation inventory

The Wave 1–3 `❌ W1/W2/W3` file-existence cells above were stale: the named
core and backend test files are tracked in the current tree. A direct run of
`verticalPacks.test.ts` and `dataProfile.test.ts` passed **17/17** core tests;
nine backend vertical test files passed **70/70**. The exact selection included
discovery, binding, Data, Product/Design, Legal, HR, Engineering, registry and
native evidence. Those tests establish structural provenance, tenant/isolation,
deterministic profile, denied-tool declarations and candidate fixture behavior.
The registry test file now exists; the 2026-09-25 note above that it did not
is historical. The current registry/binding/evidence selection contributes
**41/41** of the backend tests. `--fixtures-only` exited 0 with six prepared
version-1 candidates and 40 cases, explicitly `modelEvaluated:false`,
`evidenceRecorded:false` and `runtimeEnabled:false`.
They **do not execute** the unrun model/adversarial corpus for Plans 03–07,
provide Legal/HR attestation, show authenticated responsive UAT, or prove
two-version activation/rollback. The table records the offline subclaim in
each status cell; Phase 30 remains partial and `wave_0_complete` remains false.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags.
- [ ] Focused offline feedback latency is below 60 seconds.
- [ ] Twelve candidate eval runs (two exact passing versions for each of six packs) are pinned and cannot actuate tools.
- [ ] Six controlled activation/real-rollback drills run with public exposure off; candidate disable/re-enable is not accepted as rollback.
- [ ] Two-tenant isolation, per-pack disable, retained artifacts and Bio absence are proven.
- [ ] `nyquist_compliant: true` remains correct.

**Approval:** pending
