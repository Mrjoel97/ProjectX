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
| 30-01-01 | 01 | 1 | VERT-01, VERT-03, VERT-04 | unit/structural | `pnpm --filter @pikar/core test -- verticalPacks` | ❌ W1 | ⬜ pending |
| 30-01-02 | 01 | 1 | VERT-01, VERT-04 | structural/playbook | `pnpm --filter @pikar/core typecheck && node scripts/check-playbooks.mjs` | ❌ W1 | ⬜ pending |
| 30-02-01 | 02 | 2 | VERT-01, VERT-02 | backend/isolation | `pnpm --filter @pikar/backend test -- verticalPacks` | ❌ W2 | ⬜ pending |
| 30-02-02 | 02 | 2 | VERT-01, VERT-02 | telemetry/rollback | `pnpm --filter @pikar/backend test -- verticalPacks` | ❌ W2 | ⬜ pending |
| 30-03-01 | 03 | 3 | VERT-02, VERT-03 | deterministic unit | `pnpm --filter @pikar/core test -- dataProfile` | ❌ W3 | ⬜ pending |
| 30-03-02 | 03 | 3 | VERT-02, VERT-03 | integration/eval fixture | `pnpm --filter @pikar/backend test -- verticalData` | ❌ W3 | ⬜ pending |
| 30-04-01 | 04 | 3 | VERT-02, VERT-03 | contract/eval fixture | `pnpm --filter @pikar/backend test -- verticalProductDesign` | ❌ W3 | ⬜ pending |
| 30-04-02 | 04 | 3 | VERT-02, VERT-03 | capability/injection | `pnpm --filter @pikar/backend test -- verticalProductDesign` | ❌ W3 | ⬜ pending |
| 30-05-01 | 05 | 3 | VERT-02, VERT-03 | high-stakes contract | `pnpm --filter @pikar/backend test -- verticalLegal` | ❌ W3 | ⬜ pending |
| 30-05-02 | 05 | 3 | VERT-02, VERT-03 | adversarial/refusal | `pnpm --filter @pikar/backend test -- verticalLegal` | ❌ W3 | ⬜ pending |
| 30-06-01 | 06 | 3 | VERT-02, VERT-03 | high-stakes contract | `pnpm --filter @pikar/backend test -- verticalHr` | ❌ W3 | ⬜ pending |
| 30-06-02 | 06 | 3 | VERT-02, VERT-03 | adversarial/refusal | `pnpm --filter @pikar/backend test -- verticalHr` | ❌ W3 | ⬜ pending |
| 30-07-01 | 07 | 3 | VERT-02, VERT-03 | contract/eval fixture | `pnpm --filter @pikar/backend test -- verticalEngineering` | ❌ W3 | ⬜ pending |
| 30-07-02 | 07 | 3 | VERT-02, VERT-03 | capability/injection | `pnpm --filter @pikar/backend test -- verticalEngineering` | ❌ W3 | ⬜ pending |
| 30-08-01 | 08 | 4 | VERT-02, VERT-03, VERT-04 | registry/provenance | `pnpm --filter @pikar/contracts test -- skillBodies && pnpm --filter @pikar/backend test -- verticalPackRegistry` | ❌ W4 | ⬜ pending |
| 30-08-02 | 08 | 4 | VERT-02, VERT-03 | pinned live eval | `pnpm eval:vertical -- --all-candidates --no-activate` | ❌ W4 | ⬜ pending |
| 30-09-01 | 09 | 5 | VERT-01, VERT-02 | component/browser | `pnpm --filter @pikar/web test -- verticalPackRecommendations && pnpm --filter @pikar/web test:e2e -- e2e/vertical-packs.spec.ts` | ❌ W5 | ⬜ pending |
| 30-09-02 | 09 | 5 | VERT-01, VERT-02, VERT-04 | exposure decision | `pnpm --filter @pikar/backend test -- verticalPackSelection` | ❌ W5 | ⬜ pending |
| 30-10-01 | 10 | 6 | VERT-01, VERT-02, VERT-03, VERT-04 | two-version eval/activation/rollback/isolation | `pnpm --filter @pikar/backend test -- verticalPackRollback && pnpm smoke:vertical-packs` | ❌ W6 | ⬜ pending |
| 30-10-02 | 10 | 6 | VERT-01, VERT-02, VERT-03, VERT-04 | repository gate | `pnpm test && pnpm typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/verticalPacks.test.ts` — total manifest, relevance/tool-authority parity, reason-state and Bio-absence assertions.
- [ ] Phase 27-29 native pack candidate/eval/exposure contracts must exist and be referenced directly; Phase 30 must stop rather than create substitutes.
- [ ] `packages/backend/convex/verticalPacks.test.ts` — two-tenant discovery, per-pack disable and artifact-retention fixtures.
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
