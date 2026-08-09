---
phase: 29
slug: unified-knowledge-and-routines
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
---

# Phase 29 — Validation Strategy

> Native search, workflow customization, and routines remain invisible until their automated and authenticated gates pass. Recurrence may honestly finish as deferred.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.7 + convex-test; Playwright 1.61.1; Next 16 production build |
| **Config files** | Package Vitest configs; `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @pikar/backend test -- knowledgeSearch workflowPacks pinnedWorkflows` |
| **Full suite command** | `pnpm --filter @pikar/core test && pnpm --filter @pikar/backend test && pnpm --filter @pikar/web test && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` |
| **Estimated runtime** | ~15 minutes plus connected Playwright and owner checkpoints |

## Sampling Rate

- **After every task commit:** Run the task's focused test command.
- **After every plan wave:** Run affected package tests and typechecks.
- **After each browser-gate plan:** Run the named Playwright spec, web typecheck, and production build.
- **Before phase verification:** Run the full suite and watcher.
- **Max focused feedback latency:** 180 seconds; connected E2E/full build are wave/final gates.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Verification Command / Gate | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | KNOW-01/ROUT-01/ROUT-02 | dependency/static | `pnpm --filter @pikar/backend test -- skills schema` | ✅ | ⬜ pending |
| 29-01-02 | 01 | 1 | KNOW-01/ROUT-01/ROUT-02 | unit/schema | `pnpm --filter @pikar/core test -- knowledgeSearch workflowCustomization && pnpm --filter @pikar/core typecheck` | ❌ W0/TDD | ⬜ pending |
| 29-01-03 | 01 | 1 | KNOW-01 | watcher | `pnpm --filter @pikar/backend test -- schema && pnpm --filter @pikar/backend typecheck && node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 29-02-01 | 02 | 2 | KNOW-01 | adapter | `pnpm --filter @pikar/backend test -- knowledgeVaultDrive vaultGround` | ❌ W0/TDD | ⬜ pending |
| 29-02-02 | 02 | 2 | KNOW-01 | isolation/bounds | `pnpm --filter @pikar/backend test -- knowledgeVaultDrive vaultDrive dispatchGuard && node scripts/check-playbooks.mjs` | ❌ W0/TDD | ⬜ pending |
| 29-03-01 | 03 | 2 | KNOW-01 | adapter | `pnpm --filter @pikar/backend test -- gmail knowledgeExternalSources` | ❌ W0/TDD | ⬜ pending |
| 29-03-02 | 03 | 2 | KNOW-01 | injection/isolation | `pnpm --filter @pikar/backend test -- knowledgeExternalSources gmail llmRedaction && node scripts/check-playbooks.mjs` | ❌ W0/TDD | ⬜ pending |
| 29-04-01 | 04 | 2 | KNOW-01 | structured LLM | `pnpm --filter @pikar/contracts test -- skillBodies && pnpm --filter @pikar/backend test -- skills` | ❌ W0/TDD | ⬜ pending |
| 29-04-02 | 04 | 2 | KNOW-01 | static containment | `pnpm --filter @pikar/backend test -- knowledgeLlm llmRedaction skills` | ❌ W0/TDD | ⬜ pending |
| 29-05-01 | 05 | 3 | ROUT-01 | unit | `pnpm --filter @pikar/core test -- workflowCustomization` | ❌ W0/TDD | ⬜ pending |
| 29-05-02 | 05 | 3 | ROUT-01 | candidate/eval | `pnpm --filter @pikar/backend test -- workflowPacks skills evaluations && node scripts/check-playbooks.mjs` | ❌ W0/TDD | ⬜ pending |
| 29-06-01 | 06 | 3 | KNOW-01 | coordinator | `pnpm --filter @pikar/backend test -- knowledgeSearch knowledgeVaultDrive knowledgeExternalSources knowledgeLlm` | ❌ W0/TDD | ⬜ pending |
| 29-06-02 | 06 | 3 | KNOW-01 | citations/telemetry | `pnpm --filter @pikar/backend test -- knowledgeSearch audit telemetry llmRedaction && node scripts/check-playbooks.mjs` | ❌ W0/TDD | ⬜ pending |
| 29-07-01 | 07 | 4 | ROUT-01 | UI/API | `pnpm --filter @pikar/web test -- workflow-packs && pnpm --filter @pikar/web typecheck` | ❌ W0/TDD | ⬜ pending |
| 29-07-02 | 07 | 4 | ROUT-01 | held-out eval | `pnpm --filter @pikar/backend test -- workflowPackEvals evaluations skills && node scripts/check-playbooks.mjs` | ❌ W0/TDD | ⬜ pending |
| 29-08-01 | 08 | 5 | ROUT-02 | pin/rerun | `pnpm --filter @pikar/backend test -- pinnedWorkflows cockpit audit telemetry` | ❌ W0/TDD | ⬜ pending |
| 29-08-02 | 08 | 5 | ROUT-02 | mounted UI/API | `pnpm --filter @pikar/web test -- pinned-workflows && pnpm --filter @pikar/web typecheck` | ❌ W0/TDD | ⬜ pending |
| 29-09-01 | 09 | 4 | KNOW-01 | cited UI/build | `pnpm --filter @pikar/web test -- knowledge-search && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build` | ❌ W0/TDD | ⬜ pending |
| 29-09-02 | 09 | 4 | KNOW-01 | adversarial/authenticated E2E | `pnpm --filter @pikar/backend test -- knowledgeSearch knowledgeLlm llmRedaction && pnpm --filter @pikar/web test:e2e -- e2e/knowledge-search.spec.ts` | ❌ W0/TDD | ⬜ pending |
| 29-09-03 | 09 | 4 | KNOW-01 | evidence record | `pnpm --filter @pikar/backend test -- knowledgeSearch knowledgeLlm llmRedaction && pnpm --filter @pikar/web test:e2e -- e2e/knowledge-search.spec.ts && rg -n "command\|run\|connected\|unavailable" .planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md` | ❌ execution artifact | ⬜ pending |
| 29-10-01 | 10 | 6 | ROUT-01/ROUT-02 | authenticated E2E | `pnpm --filter @pikar/backend test -- workflowPacks workflowPackEvals pinnedWorkflows && pnpm --filter @pikar/web test:e2e -- e2e/workflow-packs.spec.ts && pnpm --filter @pikar/web build` | ❌ W0/TDD | ⬜ pending |
| 29-10-02 | 10 | 6 | ROUT-01/ROUT-02 | automated release gate | `pnpm --filter @pikar/web test -- workflow-packs pinned-workflows && pnpm --filter @pikar/web test:e2e -- e2e/workflow-packs.spec.ts && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | ✅ route / ❌ tests | ⬜ pending |
| 29-11-01 | 11 | 7 | ROUT-02 | parser/decision spike | `pnpm --filter @pikar/core test -- routineSchedule && pnpm --filter @pikar/backend test -- routineDecision gmailAuth cockpit && node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --matrix` | ❌ W0/TDD | ⬜ pending |
| 29-11-02 | 11 | 7 | ROUT-02 | live-evidence checkpoint | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --matrix`; then manually resolve and inspect OAuth expiry/reauth, DST-boundary and provider-read live refs | ❌ live evidence | ⬜ pending |
| 29-11-03 | 11 | 7 | ROUT-02 | decision checkpoint | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --matrix`; immediately run `--eligibility`, expose enable-safe only on exit 0, then select a permitted option | ❌ decision | ⬜ pending |
| 29-11-04 | 11 | 7 | ROUT-02 | fail-closed decision record | `pnpm --filter @pikar/backend test -- routineDecision && node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision` | ❌ execution artifact | ⬜ pending |
| 29-12-01 | 12 | 8 | ROUT-02 | conditional state machine/absence | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision && pnpm --filter @pikar/core test -- routineSchedule && pnpm --filter @pikar/backend test -- routines schema guardrails` | ❌ conditional W0/TDD | ⬜ pending |
| 29-12-02 | 12 | 8 | ROUT-02 | scheduler races/absence | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision && pnpm --filter @pikar/backend test -- routines routineDecision gmailAuth guardrails` | ❌ conditional W0/TDD | ⬜ pending |
| 29-13-01 | 13 | 9 | ROUT-02 | conditional structural UI/E2E | `pnpm --filter @pikar/web test -- routineBranch && pnpm --filter @pikar/web test:e2e -- e2e/routines.spec.ts && pnpm --filter @pikar/web build` | ❌ conditional W0/TDD | ⬜ pending |
| 29-13-02 | 13 | 9 | KNOW-01/ROUT-01/ROUT-02 | full Nyquist/repository | `pnpm --filter @pikar/core test && pnpm --filter @pikar/backend test && pnpm --filter @pikar/web test && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | ✅ infrastructure | ⬜ pending |
| 29-13-03 | 13 | 9 | KNOW-01/ROUT-01/ROUT-02 | final owner checkpoint | `pnpm --filter @pikar/web test:e2e -- e2e/knowledge-search.spec.ts e2e/workflow-packs.spec.ts e2e/routines.spec.ts && pnpm --filter @pikar/web build`; then review the single final app start | ❌ owner evidence | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

Existing Vitest, convex-test, authenticated Playwright, and production-build infrastructure is sufficient. Each plan creates its named focused test before implementation. `@js-temporal/polyfill` is added only if Plan 11's recurrence gate selects enable and its Convex-runtime spike passes; the safe deferred branch installs nothing.

## Required Non-Vacuity and Mutation Checks

- Remove one tenant/source bound and observe the two-tenant source test fail.
- Convert `unavailable` to an empty successful source and observe the partial-state test fail.
- Let the synthesizer invent an evidence ID or excerpt and observe citation validation fail.
- Return Gmail/Drive/CRM prose to the tool-bearing loop and observe the containment scan fail.
- Add a tool/URL/MCP field to customization input and observe schema validation fail.
- Reuse an old plan from a pinned rerun and observe the fresh-correlation assertion fail.
- If recurrence is enabled, replay a due callback and observe one run; remove the run-key uniqueness/claim CAS and observe failure.
- If recurrence is deferred, add a `routines` table, recurring control, or dynamic scheduler call and observe the no-recurrence scan fail.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Connected cross-source search | KNOW-01 | real provider data, consent and citation drill-in | Search Vault plus connected Drive/Gmail; inspect citations, conflict, freshness, and one unavailable-source banner |
| Workflow customization activation | ROUT-01 | authenticated owner/user roles and rendered diff | Customize an approved pack, observe candidate/eval gate, activate, run, and roll back |
| Manual pinned rerun | ROUT-02 | fresh conversation/plan UX | Pin an approved workflow, run twice, and confirm a fresh request/readiness/approval path each time |
| Recurrence decision gate | ROUT-02 | product governance decision | Review approval, OAuth, DST, missed-run, idempotency, pause/revoke and audit evidence; select defer or enable-safe |
| Recurrence live gate, enabled branch only | ROUT-02 | real OAuth and wall-clock/provider behavior | Prove reauth auto-pause, explicit resume without catch-up, pause race, next local time, and per-run approval for external writes |

## Validation Sign-Off

- [x] All tasks have focused automated verification or conditional Wave 0 creation.
- [x] Sampling continuity: no 3 consecutive tasks without automated verification.
- [x] Existing test infrastructure covers all unconditional references.
- [x] No watch-mode flags.
- [x] Feedback latency is under 180 seconds for focused checks.
- [x] Deferred recurrence has an affirmative absence test, not merely missing code.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** planning complete; execution pending
