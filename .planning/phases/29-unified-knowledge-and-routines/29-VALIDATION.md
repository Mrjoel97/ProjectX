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
| **Quick run command** | `cd packages/backend && pnpm vitest run knowledgeSearch workflowPacks pinnedWorkflows` |
| **Full suite command** | `pnpm --filter @pikar/core test && pnpm --filter @pikar/backend test && pnpm --filter @pikar/web test && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && echo '{}' | node scripts/check-playbooks.mjs check` |
| **Estimated runtime** | ~15 minutes plus connected Playwright and owner checkpoints |

## Sampling Rate

- **After every task commit:** Run the task's focused test command.
- **After every plan wave:** Run affected package tests and typechecks.
- **After each browser-gate plan:** Run the named Playwright spec, web typecheck, and production build.
- **Before phase verification:** Run the full suite and watcher.
- **Max focused feedback latency:** 180 seconds; connected E2E/full build are wave/final gates.

## EXECUTION RESULTS — measured 2026-08-29/30, not projected

Every number below was produced by running the command in this worktree
(`C:/Users/expert/AppData/Local/Temp/pikar29`, branch `feat/29-unified-knowledge`) against a live
local deployment. **Where a gate is not met, this document says so rather than rounding up.**

### Suites

| Package | Result |
|---|---|
| `packages/core` | **46 files / 1476 passed** |
| `packages/contracts` | **6 files / 99 passed** |
| `apps/web` (unit) | **40 files / 800 passed**, 2 skipped |
| `packages/backend` | 116 files / 3297 tests — **3280 passed, 17 failed**, both files FOREIGN (below) |
| `packages/backend` typecheck | exit 0 |
| `apps/web` typecheck | exit 0 |
| `pnpm --filter @pikar/web build` | exit 0, `ƒ /dashboard/workflows` in the route table |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | empty stdout (pass) |

**THE 17 BACKEND FAILURES ARE NOT THIS PHASE'S, and that was checked rather than assumed:**
- `vaultDigest.test.ts` — 16 failures in the full suite, **17/17 PASS in isolation**. The documented
  load-flake; a full-suite failure in this file is not evidence until it is re-run alone.
- `env.test.ts` — 1 failure, in isolation too. The unclassified names are
  `QUICKBOOKS_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI`, introduced by **28-06**
  (`git log -S QUICKBOOKS`). A Phase 28 lane obligation.
**Baseline by FAILURE COUNT, not pass count** — a standing red gate is exactly how a new failure
hides.

### Browser gates — ALL RUN

| Spec | Modes | Result |
|---|---|---|
| `e2e/knowledge-search.spec.ts` | offline (\$0) | **7 passed**, PW_EXIT=0 |
| | two identities | **8 passed**, PW_EXIT=0 |
| | live (real model) | **3 passed**, PW_EXIT=0 |
| `e2e/routines.spec.ts` | deferred branch | **5 passed**, PW_EXIT=0 (incl. tenant B) |
| `e2e/workflow-packs.spec.ts` + `-isolation` | free | **5 passed**, PW_EXIT=0 |
| `e2e/workflow-packs.spec.ts` | `@run` (real spend) | **2 passed**, PW_EXIT=0 |

**Every one was proven falsifiable** by planting the forbidden thing and watching it go red:
a fifth control in the customizer (`Expected: 4, Received: 5`); a `Pause schedule` button
(scan named it); a `RoutineControls.tsx` (3 tests red); a disguised self-arming scheduler
(both allowlists red); a fabricated `enable-safe` (refused in all three gate modes).

### Real spend, from the governed ledger

| correlationId | kind | model | amount |
|---|---|---|---|
| `knowledge:plan:ef4e56aa-…` | `knowledge.plan` | `or/openai/gpt-4o-mini` | 1¢ |
| `agentloop:5931cd51-…` | `agent_loop` | `or/openai/gpt-5.6-luna` | 1¢ |
| `agentloop:54bc7133-…` | `agent_loop` | `or/openai/gpt-5.6-luna` | 1¢ |
| `agentloop:744991a5-…` | `agent_loop` | `or/openai/gpt-5.6-luna` | 1¢ |
| `agentloop:36d7f515-…` | `agent_loop` | `or/openai/gpt-5.6-luna` | 1¢ |

All `phase: "actual"`. The four distinct `agentloop` correlations are ROUT-02's freshness promise
shown rather than asserted — and the first live evidence that 29-08's `state: "ran"` arm is reachable
at all, an arm three verifiers proved unreachable in the test suite.

### A RELEASE PRECONDITION THIS PHASE DISCOVERED THE HARD WAY

**KNOW-01 is INERT on any deployment where `skills:seedSkills` has not been run since Phase 29
landed.** The browser gate's FIRST execution failed with
`NO_ACTIVE_SKILL: knowledge-query-planner`; both Phase 29 skill names ARE in `SEEDS`, but the rows
must be seeded by an operator, and `convex-test` seeds the registry INSIDE each test so every unit
test passed throughout. One `npx convex run skills:seedSkills '{}'` turned the same spec green with
no code change. **Add the seed to the deploy runbook.**

### NOT MET, stated plainly

| Criterion | Status |
|---|---|
| Exact-version **activation** of a tenant pack candidate | **NOT MET.** `planTenantActivation` refuses every `pack-*` with `PACK_GATE`, fail-closed; activation and rollback are `ownerMutation`. |
| **Rollback** of a tenant pack candidate | **NOT MET**, same reason. |
| A published customization taking effect | **NOT MET.** `cockpit.ts` passes no `tenantSkillIds`, so it is inert; a run uses the approved template. |
| **Synthesizer** against a real model | **MET 2026-08-30.** A document ingested through the real `vault.vaultIngestText` pipeline and embedded by `vaultRag:embedDoc` produced a cited claim and a `knowledge.synthesize` ledger row (`knowledge:synth:4dd6bdf6…`, `phase: "actual"`, 1¢). Driven through `knowledgeSearch:search` with an identity — the browser half was blocked by a transient `auth:store` 1s-timeout under embedding load, not by the feature. |
| Planner plans the VAULT for an ordinary pricing question | **MET 2026-08-30**, after being found NOT MET the same day. `knowledge-query-planner@2` rebalances the include/omit guidance; on the failing question the vault went from **1 of 3 runs to 3 of 3**, with `crm-facts` still planned (and honestly reported `not_connected`) rather than displaced. Non-vacuity control: a public-fact question still leaves all four tenant sources `unplanned`. |
| `oauth-expiry-reauth` / `dst-boundary` / `provider-read` **live** evidence | **ABSENT.** This is the basis of `decision: defer` and must NOT be marked green. |
| Save **completion signal** on the customizer | **MET 2026-08-30**, after being found MISSING. The `saved` outcome state already existed and only the render branch was absent; it is now a `role="status"` line naming the version, with the container test asserting the line is ABSENT before the save and a refused save rendering no success line. It deliberately does not repeat `ACTIVATION_NOTE` — "no workflow you start uses them yet" is already on screen above the form. |
| 29-13 Task 3 **owner review** | **APPROVED 2026-08-30** by the owner, after checking the running app. It covers the surfaces reviewed and closes nothing else on this list. |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Verification Command / Gate | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | KNOW-01/ROUT-01/ROUT-02 | dependency/static | `cd packages/backend && pnpm vitest run skills schema` | ✅ | ✅ green |
| 29-01-02 | 01 | 1 | KNOW-01/ROUT-01/ROUT-02 | unit/schema | `cd packages/core && pnpm vitest run knowledgeSearch workflowCustomization && pnpm --filter @pikar/core typecheck` | ❌ W0/TDD | ✅ green |
| 29-01-03 | 01 | 1 | KNOW-01 | watcher | `cd packages/backend && pnpm vitest run schema && pnpm --filter @pikar/backend typecheck && echo '{}' | node scripts/check-playbooks.mjs check` | ✅ | ✅ green |
| 29-02-01 | 02 | 2 | KNOW-01 | adapter | `cd packages/backend && pnpm vitest run knowledgeVaultDrive vaultGround` | ❌ W0/TDD | ✅ green |
| 29-02-02 | 02 | 2 | KNOW-01 | isolation/bounds | `cd packages/backend && pnpm vitest run knowledgeVaultDrive vaultDrive dispatchGuard && echo '{}' | node scripts/check-playbooks.mjs check` | ❌ W0/TDD | ✅ green |
| 29-03-01 | 03 | 2 | KNOW-01 | adapter | `cd packages/backend && pnpm vitest run gmail knowledgeExternalSources` | ❌ W0/TDD | ✅ green |
| 29-03-02 | 03 | 2 | KNOW-01 | injection/isolation | `cd packages/backend && pnpm vitest run knowledgeExternalSources gmail llmRedaction && echo '{}' | node scripts/check-playbooks.mjs check` | ❌ W0/TDD | ✅ green |
| 29-04-01 | 04 | 2 | KNOW-01 | structured LLM | `cd packages/contracts && pnpm vitest run skillBodies && cd packages/backend && pnpm vitest run skills` | ❌ W0/TDD | ✅ green |
| 29-04-02 | 04 | 2 | KNOW-01 | static containment | `cd packages/backend && pnpm vitest run knowledgeLlm llmRedaction skills` | ❌ W0/TDD | ✅ green |
| 29-05-01 | 05 | 3 | ROUT-01 | unit | `cd packages/core && pnpm vitest run workflowCustomization` | ❌ W0/TDD | ✅ green |
| 29-05-02 | 05 | 3 | ROUT-01 | candidate/eval | `cd packages/backend && pnpm vitest run workflowPacks skills evaluations && echo '{}' | node scripts/check-playbooks.mjs check` | ❌ W0/TDD | ✅ green |
| 29-06-01 | 06 | 3 | KNOW-01 | coordinator | `cd packages/backend && pnpm vitest run knowledgeSearch knowledgeVaultDrive knowledgeExternalSources knowledgeLlm` | ❌ W0/TDD | ✅ green |
| 29-06-02 | 06 | 3 | KNOW-01 | citations/telemetry | `cd packages/backend && pnpm vitest run knowledgeSearch audit telemetry llmRedaction && echo '{}' | node scripts/check-playbooks.mjs check` | ❌ W0/TDD | ✅ green |
| 29-07-01 | 07 | 4 | ROUT-01 | UI/API | `cd apps/web && pnpm vitest run workflow-packs && pnpm --filter @pikar/web typecheck` | ❌ W0/TDD | ✅ green |
| 29-07-02 | 07 | 4 | ROUT-01 | held-out eval | `cd packages/backend && pnpm vitest run workflowPackEvals evaluations skills && echo '{}' | node scripts/check-playbooks.mjs check` | ❌ W0/TDD | ✅ green |
| 29-08-01 | 08 | 5 | ROUT-02 | pin/rerun | `cd packages/backend && pnpm vitest run pinnedWorkflows cockpit audit telemetry` | ❌ W0/TDD | ✅ green |
| 29-08-02 | 08 | 5 | ROUT-02 | mounted UI/API | `cd apps/web && pnpm vitest run pinned-workflows && pnpm --filter @pikar/web typecheck` | ❌ W0/TDD | ✅ green |
| 29-09-01 | 09 | 4 | KNOW-01 | cited UI/build | `cd apps/web && pnpm vitest run knowledge-search && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build` | ❌ W0/TDD | ✅ green |
| 29-09-02 | 09 | 4 | KNOW-01 | adversarial/authenticated E2E | `cd packages/backend && pnpm vitest run knowledgeSearch knowledgeLlm llmRedaction && cd apps/web && npx playwright test e2e/knowledge-search.spec.ts` | ❌ W0/TDD | ✅ green |
| 29-09-03 | 09 | 4 | KNOW-01 | evidence record | `cd packages/backend && pnpm vitest run knowledgeSearch knowledgeLlm llmRedaction && cd apps/web && npx playwright test e2e/knowledge-search.spec.ts && rg -n "command\|run\|connected\|unavailable" .planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md` | ❌ execution artifact | ✅ green |
| 29-10-01 | 10 | 6 | ROUT-01/ROUT-02 | authenticated E2E | `cd packages/backend && pnpm vitest run workflowPacks workflowPackEvals pinnedWorkflows && cd apps/web && npx playwright test e2e/workflow-packs.spec.ts && pnpm --filter @pikar/web build` | ❌ W0/TDD | ✅ green |
| 29-10-02 | 10 | 6 | ROUT-01/ROUT-02 | automated release gate | `cd apps/web && pnpm vitest run workflow-packs pinned-workflows && cd apps/web && npx playwright test e2e/workflow-packs.spec.ts && pnpm --filter @pikar/web build && echo '{}' | node scripts/check-playbooks.mjs check` | ✅ route / ❌ tests | ✅ green |
| 29-11-01 | 11 | 7 | ROUT-02 | parser/decision spike | `cd packages/core && pnpm vitest run routineSchedule && cd packages/backend && pnpm vitest run routineDecision gmailAuth cockpit && node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --matrix` | ❌ W0/TDD | ✅ green |
| 29-11-02 | 11 | 7 | ROUT-02 | live-evidence checkpoint | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --matrix`; then manually resolve and inspect OAuth expiry/reauth, DST-boundary and provider-read live refs | ❌ live evidence | ⚠️ **live evidence ABSENT — and that is the finding** |
| 29-11-03 | 11 | 7 | ROUT-02 | decision checkpoint | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --matrix`; immediately run `--eligibility`, expose enable-safe only on exit 0, then select a permitted option | ❌ decision | ✅ green |
| 29-11-04 | 11 | 7 | ROUT-02 | fail-closed decision record | `cd packages/backend && pnpm vitest run routineDecision && node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision` | ❌ execution artifact | ✅ green |
| 29-12-01 | 12 | 8 | ROUT-02 | conditional state machine/absence | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision && cd packages/core && pnpm vitest run routineSchedule && cd packages/backend && pnpm vitest run routines schema guardrails` | ❌ conditional W0/TDD | ✅ green |
| 29-12-02 | 12 | 8 | ROUT-02 | scheduler races/absence | `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision && cd packages/backend && pnpm vitest run routines routineDecision gmailAuth guardrails` | ❌ conditional W0/TDD | ✅ green |
| 29-13-01 | 13 | 9 | ROUT-02 | conditional structural UI/E2E | `cd apps/web && pnpm vitest run routineBranch && cd apps/web && npx playwright test e2e/routines.spec.ts && pnpm --filter @pikar/web build` | ❌ conditional W0/TDD | ✅ green |
| 29-13-02 | 13 | 9 | KNOW-01/ROUT-01/ROUT-02 | full Nyquist/repository | `pnpm --filter @pikar/core test && pnpm --filter @pikar/backend test && pnpm --filter @pikar/web test && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && echo '{}' | node scripts/check-playbooks.mjs check` | ✅ infrastructure | ✅ green |
| 29-13-03 | 13 | 9 | KNOW-01/ROUT-01/ROUT-02 | final owner checkpoint | `cd apps/web && npx playwright test e2e/knowledge-search.spec.ts e2e/workflow-packs.spec.ts e2e/routines.spec.ts && pnpm --filter @pikar/web build`; then review the single final app start | ❌ owner evidence | ✅ **owner approved 2026-08-30** (reviewed surfaces only; see 29-13-SUMMARY §6) |

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

**Approval:** execution complete for plans 01–13, and **29-13 Task 3 was approved by the owner on
2026-08-30** after reviewing the running app. Every automated gate has been run and its real output
is recorded above.

**The owner's approval does not close the "NOT MET" rows.** Those remain open work, not oversights:
activation and rollback are structurally unreachable this release, and the three required recurrence
rows have no live trace (which is what `decision: defer` rests on).

**Two of the rows in that sentence have since been closed** (2026-08-30, after the approval and
outside its scope): the customizer save now renders a completion line, and the planner now plans the
vault for an ordinary business question. Both are recorded in their rows above with the measurement
that closed them. The approval covered the surfaces the owner reviewed; it never covered these, and
they were fixed rather than argued away.
