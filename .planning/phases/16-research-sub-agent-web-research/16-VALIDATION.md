---
phase: 16
slug: research-sub-agent-web-research
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-27
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `16-RESEARCH.md` § Validation Architecture — read that section for the reasoning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.2.7 (workspace-wide via `turbo run test`) |
| **Config files** | `packages/backend/vitest.config.mts`, `packages/core/vitest.config.ts` |
| **Convex harness** | `convex-test@0.0.54` + `MockLanguageModelV4` from `ai/test` — **offline, no deployment, no network** |
| **Quick run (pure TS)** | `pnpm --filter @pikar/core exec vitest run src/specialists.test.ts` |
| **Quick run (dispatch)** | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts convex/dispatchGuard.test.ts convex/research.test.ts` |
| **Full suite** | `pnpm test` + `pnpm typecheck` + `node scripts/check-playbooks.mjs` |
| **Live probe (OQ-2)** | `node packages/backend/scripts/run-probe-websearch.mjs` — needs a deployment + `OPENAI_API_KEY`, ≈ $0.01, ONE call |
| **Eval gate** | `pnpm eval:golden` — mandatory for the new §5 skill body (Phase-3.6 `EVAL_GATE`) |
| **Known pre-existing red** | **NONE — CORRECTED 2026-07-27.** `16-RESEARCH.md` and several PLANs still call `convex/audit.test.ts` a documented pre-existing red. **It is GREEN** — verified by running it this session (1/1 pass); the 2026-07-26 handoff already recorded the backend suite at 643/643 with `auditCounts` fixed. **Treat ANY red in `audit.test.ts` as a REAL regression.** This stale claim is the dangerous kind — it instructs an executor to ignore exactly the failure they would be causing. |

---

## Sampling Rate

- **After every task commit:** the two quick runs above
- **After every plan wave:** `pnpm test` + `pnpm typecheck` + `node scripts/check-playbooks.mjs`
- **Before `/gsd:verify-work`:** full suite green **+** `pnpm eval:golden` **+** the OQ-2 probe result recorded
- **Max feedback latency:** ~40 seconds

---

## Per-Task Verification Map

Task IDs are assigned by the planner; this is the criterion→test contract the tasks must satisfy.

| Req / SC | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| DISP-02 / SC#1 | `resolveSpecialist("research")` resolves; `SPECIALISTS.research.tools` is exactly the granted set; `stepTool` unique across routes | unit | core quick run | ✅ extend `specialists.test.ts` L20/L59/L67 | ⬜ |
| DISP-02 / SC#1 | the `research` route runs in THE governed loop under its ACTIVE §5 skill row | integration | `… dispatch.test.ts -t "research"` | ✅ extend (`:165` shape) | ⬜ |
| **SC#1 containment** | a scripted **injected write-tool call** (`setSubject`/`proposePlan`/`replyToMessage`) during a research turn does NOT move the plan row and emits no step | integration | `… dispatch.test.ts -t "withheld"` | ✅ re-point `:188` | ⬜ |
| SC#1 non-vacuity | the GRANTED tools DO run — `searchVault` via the `SMOKE::` seam, `webResearch` via a scripted provider tool-result | integration | same file | ❌ W0 | ⬜ |
| SC#1 (R1) | the **executive** agent has no `webResearch` — a scripted call throws / does nothing | integration | `… runCockpitAgent.test.ts -t "webResearch"` | ❌ W0 | ⬜ |
| **ACTN-03 / SC#2 SSRF** | zero `fetch(` / `node:http` / `undici` / `axios` / `.request(` in research code paths, AND exactly one `openai.tools.webSearch(` declaration (non-vacuity) | static scan | `… dispatchGuard.test.ts` | ✅ append below the marker | ⬜ |
| SC#2 one loop | `llm.ts` still has EXACTLY ONE tool-bearing `generateText` call site after adding the hosted tool | static scan | same file | ✅ `dispatchGuard.test.ts:64` | ⬜ |
| SC#2 fence | the labelled `<research_findings …>` fence wraps the findings **in the STORED vault document** (16-07), the one boundary that survives D9-REVISED: a memo plan's body never reaches the model (`buildAgentContext` emits only `Body drafted: yes/no`), so the surviving re-entry is a later `searchVault` retrieval and the label must ride the text through chunking | unit + integration | core quick run (pure fence builder) + `… research.test.ts` | ❌ W0 | ⬜ |
| ACTN-03 / SC#2 vault | a completed run writes ONE `vaultDocuments` row, `kind:"web_research"`, and starts ingest | integration | `… research.test.ts` | ❌ W0 | ⬜ |
| SC#2 / D7 freshness | the stamp is a stored, queryable number and the title carries `retrieved YYYY-MM-DD` | integration | same file | ❌ W0 | ⬜ |
| SC#3 / D6 (§4) | no audit payload value contains the question, any source URL, `http`, or any specialist prose; the query appears only as a hash | integration | `… dispatch.test.ts -t "§4"` | ✅ extend `:488` | ⬜ |
| SC#3 lineage | `audit.by_correlation(rootRequestId)` reconstructs dispatched→completed with `parentAgentId`/`depth`; costs sum to the root | integration | `… dispatch.test.ts -t "call tree"` | ✅ extend `:433` | ⬜ |
| **SC#3 isolation** | same `rootRequestId` under two tenants partitions cleanly, **and tenant B cannot read tenant A's stored findings doc** | integration | `… research.test.ts -t "isolation"` | ❌ W0 (`dispatch.test.ts:520` pattern re-pointed at `vaultDocuments`) | ⬜ |
| SC#4 | a seeded `kind:"web_research"` doc is grounded by `runEvaluation` into a finding whose `citationTitle` contains `retrieved ` | integration | `… evaluations.test.ts -t "web research"` | ❌ W0 | ⬜ |
| R2/R3 cost | `priceUsage(RESEARCH_MODEL, …).ok === true`; N scripted searches add `N × WEB_SEARCH_CALL_USD` | unit + integration | cost pkg / `… -t "envelope"` | ✅ / ❌ W0 | ⬜ |
| R4 envelope | **REVISED 2026-07-27 (D9-REVISED).** Research is now SCHEDULED, so a tool that never awaits a result cannot thread `{envelopeCents, spentCents}` to a next hop. The guarantee is stronger and persisted instead: a second research dispatch is REFUSED while one is in flight (`plans.by_thread` is `.unique()`; `stageResearchPlan` will not recycle a `collecting` row), so one run per thread ⇒ one root envelope. Cost-exhaustion still refuses with `BUDGET_EXHAUSTED_REPLY` on the NEXT run | integration | `… dispatch.test.ts -t "stage"` + `-t "envelope"` | ✅ extend `:339`; new in 16-06 Task 2 | ⬜ |
| D12 wall clock | `callTimeoutMsFor` returns `RESEARCH_CALL_TIMEOUT_MS` for the research skill and a LITERAL `45_000` for every other; `llm.ts` has zero `AbortSignal.timeout(RESEARCH_CALL_TIMEOUT_MS)` sites | unit + static scan | `… runCockpitAgent.test.ts` / `… dispatchGuard.test.ts` | ❌ W0 (16-05 Task 2/3) | ⬜ |
| D11 wall clock | a run out of clock returns partial findings MARKED `incomplete` with reason `"clock"` — never a throw; the three reasons are pairwise distinct | integration | `… dispatch.test.ts -t "wall clock"` | ❌ W0 (16-08 Task 2, via `__runSpecialistWithScript`'s `timeoutMs`) | ⬜ |
| Pitfall 1 | `agentSteps` accepts the `dispatchResearch` literal against the REAL schema | integration | `… dispatch.test.ts -t "agentSteps accepts"` | ✅ add to `DISPATCH_STEP_TOOLS` `:49` | ⬜ |
| §5 | the seeded `research-specialist` body matches its `.md` mirror; never a hardcoded prompt | unit | `… skillBodies.test.ts` | ✅ extend | ⬜ |
| §9 | playbooks touched alongside their watched paths | hook | `node scripts/check-playbooks.mjs` | ✅ | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] **The `vaultDocuments.retrievedAt` decision** (reuse `createdAt` vs a new optional field). Cheap now, expensive later — `schema.ts` is FROZEN after the Stage-1 freeze commit per the 16∥17 contract
- [ ] `convex/schema.ts`: `agentSteps.tool += v.literal("dispatchResearch")` — **ONE literal, not two** (a provider-executed tool emits no step; see below)
- [ ] `packages/backend/convex/research.test.ts` — vault write, freshness stamp, cross-tenant isolation
- [ ] `packages/backend/scripts/run-probe-websearch.mjs` — the OQ-2 live probe, **blocking on the model constant**
- [ ] `apps/web/.../workspace/cards.tsx`: `VERB.dispatchResearch`
- [ ] `docs/playbooks/watch.json`: register `convex/research.ts`, `convex/research.test.ts`, the probe script
- [ ] `llm.ts` signature widening (`buildCockpitTools` opt-in arg; `runAgentLoop`/`runSpecialistTurn` returns + model override) — **land in the freeze so Lane K's calendar tool does not collide**
- [ ] New cases in existing files: `dispatch.test.ts`, `dispatchGuard.test.ts`, `specialists.test.ts`, `runCockpitAgent.test.ts`, `evaluations.test.ts`, `skillBodies.test.ts`
- [ ] Framework install: **none** — vitest, convex-test and `ai/test` all present

---

## Manual-Only Verifications

| Behavior | Req | Why Manual | Test Instructions |
|----------|-----|------------|-------------------|
| The model accepts `openai.tools.webSearch` | OQ-2 | Requires a real OpenAI call; OpenAI's own guide and pricing page contradict each other on `gpt-4o-mini`, and `gpt-4.1-nano` appears in neither | `run-probe-websearch.mjs` — ONE call, ≈$0.01. **Gate: run BEFORE writing the model constant** |
| Real search returns usable `sources` with real URLs | SC#2 | Provider-side | Same probe; assert `sources.length > 0` and every `sourceType:"url"` has a parseable `url` |
| Actual per-call fee + search-context token volume | R2/R3 | Billing | Same probe reports `usage`; reconcile once against the OpenAI dashboard |
| Skill-body quality — the untrusted-data instruction actually steers the model | §5 | Requires real model turns | `pnpm eval:golden` (Phase-3.6 `EVAL_GATE`), mandatory for any skill-body change |
| End-to-end UX (the `Researching…` verb appears, the memo renders) | — | Browser + deployment | Owner live-verify on integrated `main` (PARALLELIZATION Stage 3) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 40s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** plan-set 16-01..16-09 written 2026-07-27. Every task carries an <automated> verify or an explicit Wave-0 (16-01) dependency; Wave-0 gaps are owned by 16-01 (unions/signatures/watch.json), 16-02 (probe), 16-07 (research.test.ts) and 16-09 (harness observables).
