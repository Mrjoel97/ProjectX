# Phase 12: Business Evaluation Engine - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

On demand (via the cockpit), the Executive Agent produces a **persona-appropriate business
assessment** grounded in the user's own vault + business profile, surfaces real gaps as
**governed, approvable next actions**, and honestly reports "no gaps" when the business is
healthy. Requirements: **BEVL-01** (grounded assessment, honest data-gap flags, no fabricated
metrics/scores), **BEVL-02** (gaps → governed action proposals via Approve→execute; healthy =
zero gaps).

**The review is READ-ONLY. Acting is gated** behind the existing plan→human-Approve→execute
spine. Building the actual fix (the Grand Slam Offer, the lead campaign) is the *acting* side and
is **out of scope** for Phase 12.

**Out of scope (own phases):**
- Recurring/proactive review (weekly briefing) → BEVL-03 / Phase 13.
- Web / market-fact claims → Phase 16. Until then the engine scopes itself to vault-grounded
  findings only and says so.
- The Growth OS **specialist execution** skills (offer-architect, money-model-designer,
  lead-engine) that BUILD the fix → later "growing"/acting phases (15+). See Deferred Ideas.

</domain>

<decisions>
## Implementation Decisions

### Invocation & result surface
- **Cockpit command only** — the user asks in chat ("evaluate my business", "run a SWOT",
  "run a growth diagnosis"). The agent recognizes intent and runs it via a tool. No button/page
  (matches Phase 11's conversational identity; zero new entry surface). Framework hints ride the
  command inline.
- **Result = a new EVALUATION card** in the workspace, following the existing PLAN / BRIEFING /
  RESOLUTION card idiom (`workspace/cards.tsx`). Structured, scannable — framework
  sections/quadrants, findings, gap list.
- **Per-finding citations** — every finding (each SWOT item, each Lean block, each growth-os
  diagnosis line) carries its OWN source citation + confidence label inline. Directly satisfies
  SC #1's "every finding carries a source citation" and makes fabrication visually impossible.
- **Keep history, show latest** — each run persists a row (the evaluations table / scorecard
  trail); the cockpit surfaces the newest card. No history-list UI yet (that's BEVL-03's home).

### Framework selection
- **Auto-pick, user can override.** The agent auto-selects a default framework; the user can name
  one in the command to override. Honors "persona-appropriate" by default, stays conversational.
- **Data-driven routing (the auto-pick rule):**
  - If the vault/profile has the **financial inputs** (revenue/price/CAC-ish signals) →
    **growth-os diagnostic** (richest, most action-connected).
  - If thin / idea-stage (no financials) → fall back to persona map: **solopreneur→Lean Canvas,
    startup→Business Model Canvas, SME→SWOT.**
  - This honors "no fabricated metrics" by never forcing growth-os onto empty financial data.
- The frameworks in scope: **SWOT / Lean / BMC + growth-os diagnostic.** (growth-os is a
  first-class framework here — see Growth OS Integration.)

### Gap → action triage (BEVL-02 core)
- **Gap list → user picks → propose.** The EVALUATION card lists the gaps; the user taps a gap
  ("Act on this") to turn THAT gap into a **proposed PLAN card** routed through the existing
  Approve→execute spine. No auto-flood of proposals — keeps the review read-only and the user in
  control of what becomes an action.
- **Ranked by leverage, cap ~5.** Gaps ordered by impact/leverage (growth-os's constraint logic
  gives a natural "biggest bottleneck first"); show up to ~5, rest collapsed under "more". Focus
  without hiding; avoids quota-padding (tension with "no forced gaps").
- **Approved gap-action = a concrete next-step memo.** On Approve, the action produces a short,
  concrete written next-step plan for that gap (e.g. "Draft a Grand Slam Offer: steps 1–5…"),
  grounded and citing the relevant playbook, saved so the user can act on it. Reuses the plan
  spine; **NO specialist execution** (that's deferred). This is the honest, meaningful "concrete
  next action" SC #3 requires without pulling the acting phases forward.

### Confidence & thin-data honesty
- **High / Medium / Low confidence label** per finding, driven by how directly vault data
  supports it (direct profile/doc statement = High; inferred = Medium; sparse/assumed = Low).
  Honest, scannable, **no numeric % scores** (those are the fabricated-metric risk SC #1 bars).
- **Explicit "not enough data to assess" state** for any framework section the vault can't ground
  (e.g. a Lean "Revenue" block, or growth-os financials on an idea-stage profile). Rendered as a
  distinct state — "Not enough data to assess — add X to your vault/profile to unlock this" —
  **visually separate from a real business gap**. Turns thin-data into an honest, actionable
  nudge (ties to Phase 10's upload nudge + Phase 11 enrichment). Never silently omit; never
  fill with a low-confidence guess.
- **Healthy = affirmative "no gaps" card.** SC #2's first-class outcome: "No gaps found on
  [framework] — your business is solid here", showing assessed strengths with their citations,
  no empty action list. Reads as a genuine green light, distinct from an errored/empty run.
  Eval-tested with a healthy-business fixture.

### Growth OS Integration (role in Phase 12)
- **Diagnostic layer IN Phase 12; specialists deferred.** Phase 12 adopts the `growth-os`
  DIAGNOSTIC layer — Business Scorecard + financial spine (LTGP:CAC, CFA, 30-day cash) +
  constraint routing — as a first-class evaluation framework alongside SWOT/Lean/BMC. Its
  **prescriptions become the gap→action proposals**.
- **Numbers: vault-first, then ask, then store.** Extract financial figures from vault/profile
  first; for any still-missing figure the diagnosis needs, the agent asks the user in-conversation
  and **stores the answer** (into the profile/scorecard) so it doesn't re-ask. User-supplied
  numbers are cited as "user-provided", not fabricated.
- **Durable Business Scorecard, updated each run.** The scorecard persists per tenant
  (financials, position/roadmap-level, offer/model/lead cards, and a `history[]` of
  prescriptions+outcomes — the self-improvement trail) and is re-read + updated on each
  evaluation. Refs-only in audit (§4). This is what BEVL-03's recurring review will consume.
- **Method knowledge in skill bodies; user data grounds findings.** The framework METHODS
  (playbooks, diagnostic tree, financial-spine definitions — original wording, non-book-text)
  become the **minted gated rubric-skill bodies** (§5). Findings/citations are grounded in the
  USER's vault (their profile/docs), NOT the books. No copyrighted book text enters the vault;
  keeps "grounded in the user's data" literal. (Do NOT ingest the 3 Hormozi PDFs.)
- **The 3 specialist skills (offer-architect / money-model-designer / lead-engine) are
  REGISTERED as gated skills** (minted through the eval gate, SC #4) and named as the *target*
  of approved actions, but their **execution wiring is deferred to the acting phases (15+).**

### Governance invariants (locked — carried forward, not decisions to revisit)
- **Rubrics mint as gated skills through the Phase-3.6 eval gate** (SC #4). New rubric/framework
  skills join `GATED_SKILLS` (`packages/contracts/src/skill.ts`); candidate versions activate
  only through a recorded passing `pnpm eval:golden` run (seed candidate → eval → activate).
  Prompts load from the DB `skills` registry (§5) — never hardcoded in source.
- **Refs-only audit (§4)** — evaluation findings write refs/citations/counts ONLY to
  audit/telemetry; no grounded prose leaks. A `evaluations`-table **two-tenant isolation
  assertion** ships (SC #5), mirroring the BETA-05 pattern.
- **Grounding via `searchVault`** (Phase 10) over the tenant-scoped vault + `business_profile`
  doc (Phase 11). Reuse; do not build new retrieval.

### Claude's Discretion
- Exact `evaluations` table shape / how the scorecard is stored (its own table vs. a
  `business_profile`-adjacent doc vs. rows) — anchored to "durable, updated each run, refs-only
  audit, tenant-isolated".
- EVALUATION card visual layout, microcopy, empty/loading/error states (follow
  `docs/design/BRAND.md` + existing card patterns).
- Which framework skill(s) mint first vs. whether all four land in this phase (planner scopes
  against the eval-gate cost).
- Exact confidence-tiering heuristic and the leverage-ranking function.
- Whether the TS re-implementation of the financial spine lives in `packages/core` or a new
  `packages/growth` package.
- The "act on this gap" → proposed-PLAN mechanics (reuse `plans.ts` collecting→proposed spine).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/backend/convex/vaultGround.ts` / `searchVault`** — tenant-scoped grounding
  (`namespace = ctx.tenantId`), `SMOKE::` offline seam. The engine grounds assessments here over
  the `business_profile` + vault docs. Reuse, don't rebuild.
- **`packages/backend/convex/plans.ts`** — the plan lifecycle
  (`collecting → proposed → approved → scheduled|delivering → done`); `insertPlan`, `patchPlan`,
  `setPlanStatus`, `byThread`. A tapped gap → `proposed` PLAN card routes here.
- **`packages/backend/convex/deliverApprovedPlan.ts`** — the Approve→execute terminal (currently
  email delivery). The gap-action's next-step-memo output plugs into this spine (the memo is the
  executed artifact; specialist execution is later).
- **`apps/web/app/(app)/dashboard/workspace/cards.tsx`** — where PLAN / BRIEFING / RESOLUTION
  cards render; the new EVALUATION card renders alongside them.
- **`packages/backend/convex/llm.ts`** `buildCockpitTools` (~L607) — register an `evaluateBusiness`
  tool following the `searchVault` / `listInbox` read-tool shape (validated args → `internal.*`
  action → refs-only audit → capped return into the loop).
- **`packages/backend/convex/agentSteps.ts`** — append-only step rows for a "Assessing your
  business…" activity step (CKPT-05 idiom).
- **`packages/contracts/src/skill.ts`** — `GATED_SKILLS`, `isGatedSkill`, `EvalEvidence`,
  skill-name consts. New rubric/framework + specialist skills register here.
- **`packages/backend/scripts/run-eval-golden.mjs`** — the eval-gate runner
  (`pnpm eval:golden`); new golden fixtures for a grounded assessment turn + a healthy "no-gaps"
  fixture (SC #2) ride this.
- **`packages/backend/convex/audit.ts` `log`** — insert-only, refs-only (§4).
- **`packages/backend/convex/schema.ts`** — `vaultDocuments.kind` is free `v.string()` (a
  `business_scorecard` / evaluation doc-kind slots in with zero migration if that storage shape
  is chosen); tenant-scoped `by_tenant` index gives SC #5 isolation for free.
- **`Skills/growth-os/**`** — the source of truth for the diagnostic METHOD: `diagnose.py`
  (routing logic → port to TS), `ltgp_cac.py` / `cfa.py` (financial-spine math → port to
  pure-TS `packages/*`, §1), `references/{financial-spine,diagnostic-tree,roadmap-7-levels}.md`
  (→ rubric skill-body content), `assets/business-scorecard.template.json` (scorecard schema).
- **`Skills/{offer-architect,money-model-designer,lead-engine}/**`** — specialist METHODS
  (playbooks/references) → skill bodies for the deferred acting phases; the "next-step memo"
  cites the relevant playbook.

### Established Patterns
- **Read-only tool shape (two-shapes rule):** validated args → `internal.*` action → refs-only
  audit → capped string return. The `evaluateBusiness` tool is a read; only "act on this gap"
  crosses into the plan/Approve gate.
- **labels-to-loop / refs-to-audit split** (`listInbox`, `searchVault`): user-facing
  findings/citations/titles reach the loop/UI; only refs/hashes/counts reach the audit payload.
- **§1 thin adapter:** the framework scoring + financial-spine math + diagnose routing are pure
  package functions (`packages/*`), testable without Convex; `convex/` orchestrates.
- **§5 skills registry:** rubric/framework prompts are versioned `skills` rows, gated + eval-gated,
  not hardcoded.
- **`SMOKE::` offline seam** — deterministic no-network tests ride `vaultGround`'s existing seam.

### Integration Points
- `evaluateBusiness` tool registered in `buildCockpitTools` (`llm.ts`); teaching the agent WHEN
  to call it + the rubric bodies = a `cockpit-agent` / rubric-skill change → **rides the Phase-3.6
  eval gate** (new golden fixtures). Confirm exact gating during planning.
- EVALUATION card wired into `workspace/cards.tsx`; `agentSteps` step emitted from the tool.
- "Act on this gap" → `plans.ts` `proposed` PLAN card → existing Approve→execute.
- New `evaluations` table (or scorecard doc-kind) + two-tenant isolation assertion (SC #5).

</code_context>

<specifics>
## Specific Ideas

- The EVALUATION card should feel like the PLAN/BRIEFING cards — structured, per-line citations
  with a small High/Med/Low chip, not a wall of prose.
- growth-os's "fix the ONE bottleneck" principle informs the leverage-ranking of gaps.
- Healthy verdict reads affirmatively: "No gaps found on [framework] — your business is solid
  here," with the cited strengths shown.
- Thin-data nudge mirrors Phase 10's upload nudge: "add X to your vault/profile to unlock this."
- User-provided numbers are labeled "user-provided" in citations — honest, not fabricated.

</specifics>

<deferred>
## Deferred Ideas

- **Growth OS specialist EXECUTION** (offer-architect / money-model-designer / lead-engine
  actually building the offer / money model / lead campaign when a gap-action is approved) —
  the "acting / business-growing" side. Registered as gated skills in Phase 12; execution wiring
  → acting phases (15+, DISP-01/ACTN). The "next-step memo" is Phase 12's stand-in.
- **Recurring/proactive business review** (weekly-style briefing consuming the scorecard trail) —
  BEVL-03 / Phase 13.
- **Web / market-fact claims** (competitor data, market sizing) — Phase 16; until then the engine
  is vault-grounded-only and says so.
- **Evaluation history-list UI** (scroll past evaluations) — natural home is BEVL-03 / Phase 13.
- **Ingesting the 3 Hormozi source PDFs** — explicitly NOT done (attribution-not-reproduction;
  copyright + retrieval-bloat risk).

</deferred>

---

*Phase: 12-business-evaluation-engine*
*Context gathered: 2026-07-24*
