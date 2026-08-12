---
phase: 16
slug: research-sub-agent-web-research
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-27
revised: 2026-08-10
---

# Phase 16 — Validation Strategy

> **Closure reconciliation (2026-08-10):** Phase 16 closed on 2026-08-08. Plans 16-01 through
> 16-08 record the deterministic suite, containment, isolation, lineage, freshness, and §4 rows
> below green. The final unfiltered gate `14feb4b7` passed 34/34 for $0.3456; `d17039a8`
> re-confirmed 34/34 after the corpus correction. All five pinned skill rows received evidence and
> were activated/read back, including `research-specialist@8`. The final production search path is
> the local Tavily-backed `webResearch` tool; hosted OpenAI/Gemini probe language below is retained
> only where it explains historical model/tool decisions.

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
| **Historical live probe (OQ-2)** | `node packages/backend/scripts/run-probe-websearch.mjs` proved the original hosted-search shape; the final production path is the locally executed, Tavily-backed `webResearch` tool |
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
| DISP-02 / SC#1 | `resolveSpecialist("research")` resolves; `SPECIALISTS.research.tools` is exactly the granted set; `stepTool` unique across routes | unit | core quick run | ✅ | ✅ green |
| DISP-02 / SC#1 | the `research` route runs in THE governed loop under its ACTIVE §5 skill row | integration + live gate | `… dispatch.test.ts -t "research"` + unfiltered golden gate | ✅ | ✅ green; `research-specialist@8` active |
| **SC#1 containment** | a scripted **injected write-tool call** (`setSubject`/`proposePlan`/`replyToMessage`) during a research turn does NOT move the plan row and emits no step | integration | `… dispatch.test.ts -t "withheld"` | ✅ | ✅ mutation-verified |
| SC#1 non-vacuity | the GRANTED tools DO run — `searchVault` via the `SMOKE::` seam, `webResearch` via its local Tavily execution seam | integration + live gate | same file + fixtures 32/33/34 | ✅ | ✅ green; `research.persisted` x3 |
| SC#1 (R1) | the **executive** agent has no `webResearch` — a scripted call throws / does nothing | integration | `… runCockpitAgent.test.ts -t "webResearch"` | ✅ | ✅ green |
| **ACTN-03 / SC#2 SSRF** | `webResearch` accepts only a query, always calls the single fixed `https://api.tavily.com/search` endpoint, and exposes no caller-supplied URL/host/path control; outbound query text is scanned before egress | static + unit | `… cockpitTools.test.ts` / `… research.test.ts` | ✅ | ✅ green |
| SC#2 one loop | `llm.ts` still has EXACTLY ONE tool-bearing `generateText` call site after adding the local tool | static scan | `… dispatchGuard.test.ts` | ✅ | ✅ green |
| SC#2 fence | the labelled `<research_findings …>` fence wraps the findings **in the STORED vault document** (16-07), the one boundary that survives D9-REVISED: a memo plan's body never reaches the model (`buildAgentContext` emits only `Body drafted: yes/no`), so the surviving re-entry is a later `searchVault` retrieval and the label must ride the text through chunking | unit + integration | core quick run (pure fence builder) + `… research.test.ts` | ✅ | ✅ mutation-verified |
| ACTN-03 / SC#2 vault | a completed run writes ONE `vaultDocuments` row, `kind:"web_research"`, and starts ingest | integration + live gate | `… research.test.ts` + fixtures 32/33/34 | ✅ | ✅ green |
| SC#2 / D7 freshness | the stamp is a stored, queryable number and the title carries `retrieved YYYY-MM-DD` | integration | same file | ✅ | ✅ green |
| SC#3 / D6 (§4) | no audit payload value contains the question, any source URL, `http`, or any specialist prose; the query appears only as a hash | integration | `… dispatch.test.ts -t "§4"` | ✅ | ✅ green |
| SC#3 lineage | `audit.by_correlation(rootRequestId)` reconstructs dispatched→completed with `parentAgentId`/`depth`; costs sum to the root | integration | `… dispatch.test.ts -t "call tree"` | ✅ | ✅ green |
| **SC#3 isolation** | same `rootRequestId` under two tenants partitions cleanly, **and tenant B cannot read tenant A's stored findings doc** | integration | `… research.test.ts -t "isolation"` | ✅ | ✅ mutation-verified |
| SC#4 | a seeded `kind:"web_research"` doc is grounded by `runEvaluation` into a finding whose `citationTitle` contains `retrieved ` | integration | `… evaluations.test.ts -t "web research"` | ✅ | ✅ green |
| R2/R3 cost | `priceUsage(RESEARCH_MODEL, …).ok === true`; N scripted searches add `N × WEB_SEARCH_CALL_USD` | unit + integration | cost pkg / `… -t "envelope"` | ✅ | ✅ green |
| R4 envelope | **REVISED 2026-07-27 (D9-REVISED).** Research is now SCHEDULED, so a tool that never awaits a result cannot thread `{envelopeCents, spentCents}` to a next hop. The guarantee is stronger and persisted instead: a second research dispatch is REFUSED while one is in flight (`plans.by_thread` is `.unique()`; `stageResearchPlan` will not recycle a `collecting` row), so one run per thread ⇒ one root envelope. Cost-exhaustion still refuses with `BUDGET_EXHAUSTED_REPLY` on the NEXT run | integration | `… dispatch.test.ts -t "stage"` + `-t "envelope"` | ✅ | ✅ green |
| D12 wall clock | `callTimeoutMsFor` returns `RESEARCH_CALL_TIMEOUT_MS` for the research skill and a LITERAL `45_000` for every other; `llm.ts` has zero `AbortSignal.timeout(RESEARCH_CALL_TIMEOUT_MS)` sites; **and a scripted NON-research turn with four tool steps runs all four with `truncated === false`** (the soft clock stop is installed ONLY when a caller passes its own `timeoutMs`, or `45_000 - 60_000` truncates every cockpit turn at step 1) | unit + static scan | `… runCockpitAgent.test.ts` / `… dispatchGuard.test.ts` | ✅ | ✅ green |
| D11 wall clock | a run out of clock returns partial findings MARKED `incomplete` with reason `"clock"` — never a throw; the three reasons are pairwise distinct | integration | `… dispatch.test.ts -t "wall clock"` | ✅ | ✅ mutation-verified |
| Pitfall 1 | `agentSteps` accepts the `dispatchResearch` literal against the REAL schema | integration | `… dispatch.test.ts -t "agentSteps accepts"` | ✅ | ✅ green |
| §5 | the seeded `research-specialist` body matches its `.md` mirror; never a hardcoded prompt | unit + live gate | `… skillBodies.test.ts` + unfiltered golden gate | ✅ | ✅ evidence recorded; v8 active |
| §9 | playbooks touched alongside their watched paths | hook | `node scripts/check-playbooks.mjs` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] **The `vaultDocuments.retrievedAt` decision** (reuse `createdAt` vs a new optional field). Cheap now, expensive later — `schema.ts` is FROZEN after the Stage-1 freeze commit per the 16∥17 contract
- [x] `convex/schema.ts`: `agentSteps.tool += v.literal("dispatchResearch")` — the later local-Tavily change also correctly added `webResearch`, because a locally executed tool emits a step
- [x] `packages/backend/convex/research.test.ts` — vault write, freshness stamp, cross-tenant isolation
- [x] `packages/backend/scripts/run-probe-websearch.mjs` — the historical OQ-2 hosted-search probe; final local-Tavily behavior is covered at the tool/network seam and by the live gate
- [x] `apps/web/.../workspace/cards.tsx`: `VERB.dispatchResearch`
- [x] `docs/playbooks/watch.json`: register `convex/research.ts`, `convex/research.test.ts`, the probe script
- [x] `llm.ts` signature widening (`buildCockpitTools` opt-in arg; `runAgentLoop`/`runSpecialistTurn` returns + model override) — **land in the freeze so Lane K's calendar tool does not collide**
- [x] New cases in existing files: `dispatch.test.ts`, `dispatchGuard.test.ts`, `specialists.test.ts`, `runCockpitAgent.test.ts`, `evaluations.test.ts`, `skillBodies.test.ts`
- [x] Framework install: **none** — vitest, convex-test and `ai/test` all present

---

## Manual-Only Verifications

| Behavior | Req | Why Manual | Test Instructions |
|----------|-----|------------|-------------------|
| Historical hosted-tool compatibility | OQ-2 | The original OpenAI tool needed a real call | Completed in 16-02; superseded in production by the local Tavily-backed tool |
| Real search returns usable source URLs | SC#2 | Provider/network-side | Completed by fixtures 32/33/34 and the `research.persisted` rows in gate `14feb4b7` |
| Search-call fee + token accounting | R2/R3 | Live-model accounting | Recorded by the unfiltered gate and the `subagent.completed` audit rows |
| Skill-body quality — the untrusted-data instruction actually steers the model | §5 | Requires real model turns | ✅ Gate `14feb4b7` 34/34; re-confirmed by `d17039a8` |
| End-to-end dispatch/persist outcome | DISP-02 / ACTN-03 | Requires deployment + real model/tool calls | ✅ `research.persisted` x3 and `subagent.completed` x7 in the closing gate audit trail; browser presentation was not separately captured as closure evidence |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 40s for the planned quick checks; live gates are separately recorded long-running checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** plan-set 16-01..16-09 written 2026-07-27. Every task carries an <automated> verify or an explicit Wave-0 (16-01) dependency; Wave-0 gaps are owned by 16-01 (unions/signatures/watch.json), 16-02 (probe), 16-07 (research.test.ts) and 16-09 (harness observables).
