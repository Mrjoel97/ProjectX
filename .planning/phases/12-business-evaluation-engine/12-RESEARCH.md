# Phase 12: Business Evaluation Engine - Research

**Researched:** 2026-07-24
**Domain:** Grounded on-demand business assessment (read-only tool) + gap→governed-action wiring, over the existing Pikar cockpit/plan/skill-registry spine
**Confidence:** HIGH (every claim below is grounded in a current source file; pointers inline. Almost nothing here is training-data — it is this codebase.)

## Summary

Phase 12 is **assembly, not invention**. Every mechanism it needs already exists and is battle-tested in this repo: a read-only cockpit tool shape (`searchVault`, `llm.ts:1300`), tenant-scoped grounding (`vaultGround.ts` + the `SMOKE::` seam), an eval-gated skill registry (`skills.ts` + `contracts/src/skill.ts`), the plan lifecycle (`plans.ts`, `collecting→proposed→…`), append-only activity steps (`agentSteps`), the EVALUATION card's siblings in `cards.tsx`, and the `pnpm eval:golden` gate with a closed fixture vocabulary. The net-new work is: (1) port the Growth OS diagnostic math from Python to pure-TS (`packages/*`, §1); (2) mint rubric/framework skill bodies through the eval gate (§5); (3) register one `evaluateBusiness` read-tool mirroring `searchVault`; (4) decide a storage shape for the durable Business Scorecard; (5) render an EVALUATION card; and (6) wire a tapped gap → `proposed` PLAN whose approved terminal writes a **next-step memo** (NOT email — the one genuinely new small piece, since `deliverApprovedPlan` is gmail-only).

The two hardest planner decisions are **storage shape** (`evaluations` table vs. `vaultDocuments` doc-kind — §Storage) and **the memo terminal** (`deliverApprovedPlan` fans out `gmail.send` only; a memo is not an email — §Gap→Action). Both are Claude's-discretion per CONTEXT and are laid out with trade-offs below, not decided.

**Primary recommendation:** Mirror `searchVault` (`llm.ts:1300`) verbatim for the `evaluateBusiness` read-tool; port `diagnose.py`/`ltgp_cac.py`/`cfa.py` into `packages/core` (or a new `packages/growth`) as pure functions with one assert-based self-check each; mint framework rubrics as **gated** skills through the existing `seedSkills`→`pnpm eval:golden`→`activateSkill` flow; store the scorecard as a **`business_scorecard` `vaultDocuments` doc-kind** (zero migration, free tenant isolation) unless the planner needs structured indexed queries, in which case add an `evaluations` table.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Invocation & result surface**
- **Cockpit command only** — user asks in chat ("evaluate my business", "run a SWOT", "run a growth diagnosis"); the agent recognizes intent and runs a tool. No button/page. Framework hints ride the command inline.
- **Result = a new EVALUATION card** in the workspace, following the PLAN / BRIEFING / RESOLUTION idiom (`workspace/cards.tsx`). Structured, scannable — framework sections/quadrants, findings, gap list.
- **Per-finding citations** — every finding (each SWOT item, each Lean block, each growth-os line) carries its OWN source citation + confidence label inline (satisfies SC #1's "every finding carries a source citation").
- **Keep history, show latest** — each run persists a row (evaluations/scorecard trail); cockpit surfaces the newest card. No history-list UI (that's BEVL-03).

**Framework selection**
- **Auto-pick, user can override.** Agent auto-selects a default; user can name one to override.
- **Data-driven routing:** financial inputs present (revenue/price/CAC-ish) → **growth-os diagnostic** (richest, most action-connected). Thin/idea-stage (no financials) → persona map: **solopreneur→Lean Canvas, startup→Business Model Canvas, SME→SWOT.** Never force growth-os onto empty financial data.
- Frameworks in scope: **SWOT / Lean / BMC + growth-os diagnostic** (growth-os is first-class here).

**Gap → action triage (BEVL-02 core)**
- **Gap list → user picks → propose.** EVALUATION card lists gaps; user taps a gap ("Act on this") to turn THAT gap into a **proposed PLAN card** through the existing Approve→execute spine. No auto-flood.
- **Ranked by leverage, cap ~5.** Ordered by impact/leverage (growth-os constraint logic gives "biggest bottleneck first"); show up to ~5, rest collapsed under "more".
- **Approved gap-action = a concrete next-step memo.** On Approve, produce a short, concrete written next-step plan for that gap (e.g. "Draft a Grand Slam Offer: steps 1–5…"), grounded and citing the relevant playbook, saved so the user can act. Reuses the plan spine; **NO specialist execution** (deferred).

**Confidence & thin-data honesty**
- **High / Medium / Low confidence label** per finding (direct profile/doc statement = High; inferred = Medium; sparse/assumed = Low). **No numeric % scores** (fabricated-metric risk SC #1 bars).
- **Explicit "not enough data to assess" state** for any framework section the vault can't ground — rendered distinct from a real business gap: "Not enough data to assess — add X to your vault/profile to unlock this." Never silently omit; never fill with a low-confidence guess.
- **Healthy = affirmative "no gaps" card.** SC #2 first-class: "No gaps found on [framework] — your business is solid here," showing assessed strengths + citations, no empty action list. Eval-tested with a healthy-business fixture.

**Growth OS Integration**
- **Diagnostic layer IN Phase 12; specialists deferred.** Adopt the `growth-os` DIAGNOSTIC layer (Business Scorecard + financial spine LTGP:CAC, CFA, 30-day cash + constraint routing) as a first-class framework. Its prescriptions become the gap→action proposals.
- **Numbers: vault-first, then ask, then store.** Extract financials from vault/profile first; for any still-missing figure the diagnosis needs, ask the user in-conversation and **store the answer** (profile/scorecard) so it doesn't re-ask. User-supplied numbers cited as "user-provided", not fabricated.
- **Durable Business Scorecard, updated each run.** Persists per tenant (financials, position/roadmap-level, offer/model/lead cards, `history[]` of prescriptions+outcomes), re-read + updated each evaluation. Refs-only in audit (§4). BEVL-03's recurring review consumes it.
- **Method knowledge in skill bodies; user data grounds findings.** Framework METHODS (playbooks, diagnostic tree, financial-spine defs — original wording, non-book-text) become the minted gated rubric-skill bodies (§5). Findings/citations grounded in the USER's vault, NOT the books. No copyrighted book text enters the vault. (Do NOT ingest the 3 Hormozi PDFs.)
- **The 3 specialist skills (offer-architect / money-model-designer / lead-engine) are REGISTERED as gated skills** (minted through the eval gate, SC #4) and named as the *target* of approved actions, but their **execution wiring is deferred to acting phases (15+).**

**Governance invariants (locked — carried forward)**
- Rubrics mint as gated skills through the Phase-3.6 eval gate (SC #4). New rubric/framework skills join `GATED_SKILLS` (`packages/contracts/src/skill.ts`); candidate versions activate only through a recorded passing `pnpm eval:golden` (seed candidate → eval → activate). Prompts load from the DB `skills` registry (§5) — never hardcoded.
- Refs-only audit (§4) — evaluation findings write refs/citations/counts ONLY to audit/telemetry; no grounded prose leaks. An `evaluations`-table two-tenant isolation assertion ships (SC #5), mirroring the BETA-05 pattern.
- Grounding via `searchVault` (Phase 10) over the tenant-scoped vault + `business_profile` doc (Phase 11). Reuse; do not build new retrieval.

### Claude's Discretion
- Exact `evaluations` table shape / how the scorecard is stored (own table vs. `business_profile`-adjacent doc vs. rows) — anchored to "durable, updated each run, refs-only audit, tenant-isolated".
- EVALUATION card visual layout, microcopy, empty/loading/error states (follow `docs/design/BRAND.md` + existing card patterns).
- Which framework skill(s) mint first vs. whether all four land this phase (scope against eval-gate cost).
- Exact confidence-tiering heuristic and the leverage-ranking function.
- Whether the TS financial-spine re-implementation lives in `packages/core` or a new `packages/growth` package.
- The "act on this gap" → proposed-PLAN mechanics (reuse `plans.ts` collecting→proposed spine).

### Deferred Ideas (OUT OF SCOPE)
- **Growth OS specialist EXECUTION** (offer-architect / money-model-designer / lead-engine actually building the offer/money-model/lead-campaign) → acting phases (15+, DISP-01/ACTN). The "next-step memo" is Phase 12's stand-in.
- **Recurring/proactive business review** (weekly briefing consuming the scorecard trail) → BEVL-03 / Phase 13.
- **Web / market-fact claims** (competitor data, market sizing) → Phase 16; until then vault-grounded-only and says so.
- **Evaluation history-list UI** → BEVL-03 / Phase 13.
- **Ingesting the 3 Hormozi source PDFs** — explicitly NOT done (attribution-not-reproduction).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **BEVL-01** | On-demand business assessment using persona-appropriate frameworks (SWOT / Lean / BMC), grounded in the user's own vault data, with honest data-gap flags and **no fabricated metrics or viability scores** | `evaluateBusiness` read-tool mirrors `searchVault` (§evaluateBusiness Tool Shape); grounding via `vaultGroundHydrated` (§Grounding); framework method = minted rubric skill bodies (§Skill Minting); per-finding citation + H/M/L confidence + explicit "not enough data" state satisfy the no-fabrication bar; growth-os auto-pick routing ported from `diagnose.py` (§Growth OS Port) |
| **BEVL-02** | Assessment surfaces gaps → governed action proposals through approve→execute; **healthy business honestly returns zero gaps** | Tapped gap → `plans.ts` `insertPlan`/`proposeEmailPlan` `proposed` card → Approve→execute (§Gap→Action Wiring); leverage-ranking from growth-os constraint logic; healthy = affirmative no-gaps card, eval-tested with a healthy fixture (§Validation Architecture); the approved terminal writes a next-step **memo** (§Gap→Action — the one net-new terminal, since `deliverApprovedPlan` is gmail-only) |
</phase_requirements>

---

## Standard Stack

**No new dependencies.** Every capability rides an installed/in-repo primitive (ponytail rung 2/5). This is the "stack" for Phase 12:

| Primitive | Location | Purpose | Reuse rule |
|-----------|----------|---------|------------|
| `buildCockpitTools` | `packages/backend/convex/llm.ts:607` | The governed tool set handed to `generateText`. Register `evaluateBusiness` here. | Add one tool key; mirror `searchVault`. |
| `searchVault` tool | `llm.ts:1300` | The exact read-only tool template: validated args → `internal.*` action → refs-only audit → content-plane card → capped, fenced string into the loop. | **Copy this shape.** |
| `vaultGroundHydrated` | `packages/backend/convex/vaultGround.ts:106` | Tenant-scoped grounding engine; returns `{docIds, titles, chunks}` (parallel arrays). Text into loop only, never audit. `SMOKE::<docId,…>` offline seam at `vaultGround.ts:43`. | Call verbatim with explicit `tenantId`. |
| Skill registry | `packages/backend/convex/skills.ts` + `packages/contracts/src/skill.ts` | Versioned prompts, gated candidate→active flip through EVAL_GATE. | Rubric bodies live here, never hardcoded (§5). |
| `plans` lifecycle | `packages/backend/convex/plans.ts` (`insertPlan:60`, `patchPlan:76`, `setPlanStatus:121`, `byThread:268`) + `cockpit.proposeEmailPlan` (called `llm.ts:1124`) | `collecting→proposed→approved→…`. Gap-action rides this. | Reuse; a memo plan is a plan with a non-email terminal. |
| `agentSteps` | `packages/backend/convex/schema.ts:313` + `agentSteps.ts` | Append-only activity trace; UI subscribes via `api.agentSteps.latestTurn`. | Add `"evaluateBusiness"` to the **closed** `tool` union (schema.ts:318). |
| EVALUATION card | `apps/web/app/(app)/dashboard/workspace/cards.tsx` (PlanCard:221, etc.) | Renders alongside PLAN/BRIEFING/RESOLUTION, fed by `useQuery`. | New card component; reuse `box`/`label` inline styles. |
| Eval gate | `packages/backend/scripts/run-eval-golden.mjs` + `eval-cases/*.json` | `pnpm eval:golden` — golden fixtures assert plan STATE, records evidence, gates activation. | Add fixtures; extend the closed expect vocabulary. |
| `audit.log` | `packages/backend/convex/audit.ts` | Insert-only, refs/hashes/counts only (§3/§4). | `evaluation.ran` event: `{queryHash, findingCount, gapCount}` — no prose. |

### Growth OS source (to PORT, not run)
| File | Computes | TS port target |
|------|----------|----------------|
| `Skills/growth-os/scripts/diagnose.py` | Top-down gate router → single prescription | pure TS `diagnose(scorecard)` |
| `Skills/growth-os/scripts/ltgp_cac.py` | LTGP, CAC, ratio, industry master-switch | pure TS `ltgpCac(...)` |
| `Skills/growth-os/scripts/cfa.py` | 30-day CFA "get paid to acquire" test | pure TS `cfa(...)` |
| `Skills/growth-os/scripts/scorecard.py` | init/get/set/log over template JSON | replaced by Convex storage (§Storage) — do NOT port the CLI |
| `Skills/growth-os/assets/business-scorecard.template.json` | Durable scorecard schema | TS type + default value |
| `Skills/growth-os/references/*.md` | Method reasoning | rubric skill bodies (§Skill Minting) |

**Installation:** none. If a new `packages/growth` package is chosen (Claude's discretion), it is a workspace package mirroring `packages/core`'s `package.json` — no external deps.

---

## Architecture Patterns

### The two-shapes rule (STATE.md decision, locked)
> "Every v2.0 capability is one of two shapes — a read-only tool returning content in-loop, or a write staged into the plan for the human Approve mutation. No third mechanism."

- **`evaluateBusiness` = read-only tool** (shape 1). It grounds, diagnoses, writes an evaluation row + an EVALUATION card, emits a refs-only audit, and returns a capped summary into the loop. It NEVER proposes or sends.
- **"Act on this gap" = write staged into a plan** (shape 2). It crosses the Approve gate exactly like every other action.

### Pattern 1: The read-only tool (mirror `searchVault` verbatim)
**What:** validated args → `readPlan()` cross-tenant guard → `internal.*` action (grounding + pure diagnosis) → refs-only `audit.log` → content-plane card insert (labels/citations to UI) → capped, fenced string into the loop.
**When:** the `evaluateBusiness` tool body.
**Example (the template to copy):**
```typescript
// Source: packages/backend/convex/llm.ts:1300 (searchVault) — the exact shape to mirror
searchVault: tool({
  description: "Search the user's knowledge vault …", // split literal <200 chars (§5 scan ceiling)
  inputSchema: jsonSchema<{ query: string }>({ /* … */ }),
  execute: async ({ query }): Promise<string> => {
    const plan = await readPlan();                 // threadId + cross-tenant guard
    let docIds, titles, chunks;
    try { ({ docIds, titles, chunks } =
      await ctx.runAction(internal.vaultGround.vaultGroundHydrated, { tenantId, query })); }
    catch { return noMatch; }                       // FAIL OPEN (SC1) — never throw out of the loop
    await ctx.runMutation(internal.audit.log, {     // ONE refs-only audit (§4)
      tenantId, correlationId: planId, eventType: "vault.searched", actor: "system",
      payload: { queryHash: await contentHash(query), resultCount: docIds.length } });
    // … content-plane card insert (titles=labels-to-UI, never audited) …
    return fenceOpen + `\n${chunks.join("\n\n")}\n</vault_context>\n` + "…"; // fenced, capped
  },
}),
```
`evaluateBusiness` differs only in: args carry an optional framework hint; the body additionally runs the **pure diagnosis** (`diagnose(scorecard)`) and writes an `evaluations`/scorecard row + EVALUATION-card content-plane row; the audit payload is `{ framework, findingCount, gapCount }` (all counts/enums, §4-safe).

### Pattern 2: Skill body = canonical `.md` → derived `.ts` constant → sync-asserted
**What:** every skill has a human-editable `packages/contracts/skills/<name>.md` (the canonical source) auto-derived into `packages/contracts/src/skills/<name>.ts` (a bundler-safe string constant — the Convex runtime cannot `fs.read`), with a vitest sync assertion keeping them byte-identical. This is "registry-bound generated data, NOT a hardcoded prompt" (§5).
**When:** minting each framework rubric (SWOT/Lean/BMC/growth-os) + the 3 specialist skills.
**Example:** `packages/contracts/src/skills/businessProfile.ts:1` header + the `export const businessProfileSkillBody = "…"` pattern.

### Pattern 3: Pure package function + Convex thin adapter (§1)
**What:** the framework scoring, financial-spine math, and diagnose routing are pure functions in `packages/*` (testable without Convex, one assert-based self-check each — ponytail). `convex/` orchestrates: grounds → calls the pure fn → persists → audits.
**When:** the Growth OS port and any framework-rubric scoring logic.

### Recommended structure
```
packages/
├── core/ (or new packages/growth/)
│   └── src/growth/
│       ├── financialSpine.ts   # ltgpCac(), cfa()  ← port of ltgp_cac.py / cfa.py
│       ├── diagnose.ts         # diagnose(scorecard) ← port of diagnose.py
│       ├── scorecard.ts        # Scorecard type + default (from template.json)
│       └── *.test.ts           # one assert-based self-check per fn (ponytail)
├── contracts/
│   ├── skills/growth-os-diagnostic.md, swot.md, lean-canvas.md, bmc.md,
│   │          offer-architect.md, money-model-designer.md, lead-engine.md   # canonical
│   └── src/skills/*.ts + src/skill.ts (add name consts + GATED_SKILLS entries)
└── backend/convex/
    ├── evaluations.ts          # the evaluateBusiness engine (internalAction) + storage mutations
    ├── llm.ts                  # register evaluateBusiness in buildCockpitTools
    └── schema.ts               # evaluations table OR reuse vaultDocuments doc-kind
apps/web/app/(app)/dashboard/workspace/cards.tsx   # EVALUATION card
```

### Anti-Patterns to Avoid
- **Building new retrieval.** `vaultGroundHydrated` already grounds tenant-scoped. Reuse it.
- **Hardcoding rubric prompts in source.** §5 — they are `skills` rows. The `check-playbooks` Stop hook + the §5 scan will bite.
- **Widening the `agentSteps.tool` union with free text.** It is a CLOSED union (schema.ts:318) — add the literal `"evaluateBusiness"` or the step insert throws and is silently swallowed (no activity step in prod while tests pass — Phase-10 Pitfall 4, schema.ts:341-343).
- **Auto-flooding gap proposals.** Locked: gaps are listed; the user taps one. The tool does NOT call `proposePlan`.
- **Numeric % viability scores.** SC #1 bars them; use H/M/L labels only.
- **Routing growth-os onto empty financials.** `diagnose.py` is conservative-by-design: unknown → don't guess, ask. Preserve that in the port.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grounding over vault + profile | New vector/graph retrieval | `internal.vaultGround.vaultGroundHydrated` (`vaultGround.ts:106`) | Tenant scope, hop-cap, char-cap, SMOKE seam all done; a second retriever is a second isolation surface to audit. |
| Deterministic offline tests | Network mocks | The `SMOKE::<docId,…>` seam (`vaultGround.ts:43`) | Resolves seed docs tenant-scoped, no embedding call; the whole eval/test suite already rides it. |
| Skill activation gating | A new approval flow | `activateSkillVersion` EVAL_GATE (`skills.ts:82`, gate at :101) | One choke point; rollback structurally exempt; can't be bypassed from UI or runner. |
| Candidate seeding + idempotence | Ad-hoc inserts | `seedSkills` gated branch (`skills.ts:281`) | Idempotent vs the NEWEST row — avoids the version-collision pitfall (§Pitfalls). |
| Refs-only audit | A custom logger | `internal.audit.log` (insert-only, §3/§4) | Append-only, redaction-safe; adding mutating audit fns is banned (§3). |
| Plan lifecycle / Approve gate | A new proposal store | `plans.ts` + `cockpit.proposeEmailPlan` | The whole `collecting→proposed→approved` state machine + REVW-02 revise cap already exist. |
| Activity streaming | Polling / new transport | `agentSteps` + `api.agentSteps.latestTurn` (Convex reactivity) | CKPT-05 done; just add the tool literal. |
| Cross-tenant isolation proof | New harness | `convex-test` + a two-tenant assertion mirroring existing `*.test.ts` (e.g. `plans.test.ts:44`) | BETA-05 pattern; SC #5. |

**Key insight:** the ONLY genuinely net-new code in the whole phase is (a) the pure-TS port of ~200 lines of Python math, (b) the rubric skill bodies (prose), (c) the EVALUATION card (UI), and (d) a small **memo terminal** for the approved gap-action (because `deliverApprovedPlan` is gmail-only — §Gap→Action). Everything else is wiring existing parts.

---

## evaluateBusiness Tool Shape (research priority #2)

Register in `buildCockpitTools` (`llm.ts:607`), alongside `searchVault`. Precise contract:

- **Args (validated `jsonSchema`):** `{ framework?: "swot" | "lean" | "bmc" | "growth-os" }` — optional; absent = auto-pick. Keep it a closed enum so a model can't inject prose (the `setMode` precedent, `llm.ts:886`).
- **Body:**
  1. `const plan = await readPlan();` — threadId + cross-tenant guard (`llm.ts:628`).
  2. Ground: `ctx.runAction(internal.vaultGround.vaultGroundHydrated, { tenantId, query })` where `query` targets the profile + relevant docs (e.g. the business-profile doc + financial/offer material). **Fail open** (SC1) — a hiccup returns an honest "I couldn't assess" string, never a throw.
  3. Load the framework rubric body via `internal.skills.getActiveSkill` (or the pinned version under the eval runner — `getSkillVersion`, `skills.ts:210`).
  4. Run the **pure** diagnosis/scoring (`packages/*`) over the grounded chunks + parsed scorecard financials.
  5. Persist: an `evaluations` row / scorecard doc (§Storage) + an EVALUATION content-plane card row (findings, citations, gaps, confidence labels).
  6. **ONE refs-only audit:** `internal.audit.log` with `payload: { framework, findingCount, gapCount, groundedDocCount }` — counts/enums only (§4). Cite `hash.ts:5` `contentHash` for any fingerprint.
  7. Emit the `agentSteps` "Assessing your business…" step (add `"evaluateBusiness"` to the union, schema.ts:318).
  8. Return a **capped** string into the loop: a short synopsis ("Assessed on [framework]: N findings, M gaps — shown as an evaluation card"), NOT the full findings prose (the card carries that). Wrap grounded reference text in the same `<vault_context>` untrusted-reference fence `searchVault` uses (`llm.ts:1362`) if any is echoed.

**labels-to-loop / refs-to-audit split:** findings + citations + confidence labels reach the loop/UI (content plane); only counts/hashes reach the audit payload. This is the `listInbox`/`searchVault` invariant — enforce it structurally (the audit payload has no place to put prose).

---

## Grounding (research priority #3)

- **`vaultGroundHydrated(ctx, { tenantId, query })`** (`vaultGround.ts:106`) returns three **parallel arrays** `{ docIds, titles, chunks }`. `chunks` are capped (`PER_DOC_CHAR_CAP=1500`, `TOTAL_CHAR_CAP=8000`, `vaultGround.ts:29-30`) and go **into the loop only** — never into any audit/DLQ payload (§4). Tenant isolation is `namespace = tenantId` on the vector search + tenantId-filtered graph expand (`vaultGround.ts:9-15`).
- **The `SMOKE::` seam** (`vaultGround.ts:43`): a `SMOKE::<docId,docId,…>` query bypasses embeddings and resolves the seed docs through tenant-scoped `ownedDocsMeta` — a cross-tenant seed drops out exactly as namespace scoping would exclude it. This is how deterministic no-network tests + eval fixtures ground. **Reuse it** for the healthy-business + grounded-assessment fixtures.
- **The `business_profile` doc shape (Phase 11):** the profile is "just another vault doc" — a committed markdown doc in `vaultDocuments` (kind free `v.string()`, schema.ts:504) that `deserializeProfile` round-trips. Fields (from the `business-profile` skill body, `contracts/src/skills/businessProfile.ts`): `name, oneLineDescription, persona (solopreneur|startup|sme), stage, offering, targetCustomer, primaryGoals[], knownConstraints[]`. **Sparse-start (memory + STATE.md 11-03):** only `oneLineDescription` + persona are guaranteed; `name/stage/offering/targetCustomer` may be empty for idea-stage users. **The evaluation engine MUST treat these as optional** — an empty field is a "not enough data to assess" nudge, never a fabricated finding.
- **Per-finding citation + confidence:** ground each finding against a specific `docId`/`title` from the parallel arrays. Confidence heuristic (Claude's discretion): direct profile/doc statement = High; inferred from adjacent text = Medium; sparse/assumed = Low. A section with **no** grounding doc → the explicit "not enough data to assess — add X" state, visually distinct from a real gap.

---

## Storage Decision Inputs (research priority #4 — planner decides)

Both options give tenant isolation and refs-only audit. Trade-offs surfaced; **not decided.**

### Option A — `vaultDocuments` doc-kind (`kind: "business_scorecard"`)
- **Zero migration.** `vaultDocuments.kind` is free `v.string()` (schema.ts:504); a new kind slots in. `by_tenant` index (schema.ts:524) gives SC #5 isolation for free.
- The scorecard becomes groundable/retrievable by construction (it's a vault doc) — BEVL-03's recurring review can `searchVault` it.
- **Trade-off:** it's a text/markdown blob (`text` field, schema.ts:511). Structured queries (e.g. "latest scorecard's LTGP:CAC") mean parse-on-read (the profile's `deserializeProfile` precedent, STATE.md 11-04). `history[]` append = re-serialize the doc. No first-class "latest evaluation per tenant per framework" index.

### Option B — dedicated `evaluations` table
- First-class structured rows: `tenantId, threadId, framework, findings[], gaps[], scorecard, createdAt`, indexed `by_tenant` / `by_tenant_framework`. Clean "show latest" query; clean `history[]`.
- **Trade-off:** a schema change (append-only new table = no migration, prior-phase discipline, schema.ts:251) + a new table to cover in the SC #5 isolation assertion and any WORM/export considerations. More surface than a doc-kind.

**Recommendation lean:** the CONTEXT locks "durable, updated each run, refs-only audit, tenant-isolated" and "keep history, show latest." If the planner wants a clean latest-row query and a structured `history[]` trail that BEVL-03 consumes, **Option B (an `evaluations` table)** is the smaller cognitive load despite the schema line; if minimizing surface is paramount and parse-on-read is acceptable, **Option A** wins on zero-migration. Either way: **findings/gaps/citations are content-plane** (the row/doc) and **only counts/hashes** hit audit (§4).

---

## Gap→Action Wiring (research priority #5)

- **The tapped gap → `proposed` PLAN:** the "Act on this" control (in the EVALUATION card) drives a cockpit message / mutation that creates a plan via `insertPlan` (`plans.ts:60`), fills its slots (a memo has no recipients — see below), and moves it to `proposed`. The existing `cockpit.proposeEmailPlan` (called from the `proposePlan` tool, `llm.ts:1124`) is the propose mutation; the lifecycle enum is PINNED at `schema.ts:155` (`collecting→proposed→approved→scheduled|delivering→done|canceled`).
- **The Approve→execute terminal — THE ONE NET-NEW PIECE.** `deliverApprovedPlan` (`deliverApprovedPlan.ts:23`) is a workflow that fans out **`gmail.send` per recipient** — it is email-only. A **next-step memo is NOT an email.** The generalized action executor (ACTN-01) that would make the spine action-agnostic is **Phase 15** — not built yet. So Phase 12 needs a **minimal memo terminal**: on Approve of a gap-action plan, produce the short grounded next-step memo (citing the relevant `Skills/<specialist>/` playbook) and **save it** (most naturally as a `vaultDocuments` doc-kind `next_step_memo`, or a field on the plan/evaluation row). This is small and reuses `plans.ts` + the skill registry, but it is genuinely new wiring — **the planner must scope it explicitly** and should NOT assume `deliverApprovedPlan` covers it.
  - **Ponytail framing:** the laziest correct version is a plan whose `body` IS the memo (drafted at propose time via a memo-writer skill), and whose Approve simply marks it accepted + persists the memo as a vault doc — no fan-out workflow at all. Add the ACTN-01 generalized executor later (Phase 15), not now.
- **NO specialist execution.** The memo NAMES the target specialist skill (offer-architect / money-model-designer / lead-engine, registered as gated skills) but does not run it. That's deferred (15+).
- **Leverage ranking:** growth-os `diagnose.py` already emits a single highest-leverage constraint (top-down first-failing-gate). For the ~5-gap list, rank by the same gate order (Market→Offer→MoneyModel→Leads→Scale) — the "fix the ONE bottleneck first" principle. This is a pure function (Claude's discretion on exact scoring).

---

## Skill Minting + Eval Gate (research priority #1 — the exact current flow)

The flow to add a NEW gated skill name, seed a candidate, eval, and activate:

1. **Add the name + gate it** in `packages/contracts/src/skill.ts`:
   - `export const GROWTH_OS_DIAGNOSTIC_SKILL = "growth-os-diagnostic" as const;` (etc. for swot/lean/bmc + the 3 specialists).
   - Add each to `GATED_SKILLS` (`skill.ts:79`) so `isGatedSkill` returns true — activation now requires eval evidence.
2. **Write the canonical body** `packages/contracts/skills/<name>.md` (original wording from `references/*.md` — NON-book-text) and its derived `packages/contracts/src/skills/<name>.ts` constant + the vitest sync assertion (the `businessProfile.ts:1` pattern). Add the import + a `seeds` entry in `seedSkills` (`skills.ts:240`).
3. **Bootstrap vs. edit (the version-collision pitfall — READ THIS):**
   - On a **fresh** registry (`rows.length === 0`, `skills.ts:263`) `seedSkills` inserts v1 **active** — gating costs nothing until the first edit (the bootstrap exemption, `skill.ts:76-84` comment). So a brand-new gated skill's v1 **activates ungated** on first seed.
   - On an **edited** body, `seedSkills` publishes `maxVersion+1` as **candidate** (`skills.ts:281-292`), leaving the active row active. Idempotence is vs the **NEWEST** row (`skills.ts:277`), so repeated dev boots after one edit do NOT mint N+1, N+2.
   - **The gotcha (memory: skill-version-collision):** the optimizer's dry-run candidates and any prior candidate ALSO occupy versions. The live-DB version carrying your body may NOT be the version your PLAN pinned. **Always verify which version carries your body before eval/activate** (`getSkillVersion`, `skills.ts:210`). Phase 10 shipped grounding at `cockpit-agent@14` not the planned `@13` for exactly this reason.
4. **Run the eval gate:** `pnpm eval:golden --skill <name>@<version>` pins the candidate version into the agent loop (`parseSkillPin`, `run-eval-golden.mjs:103`; the pin threads via `skillVersions` — `buildCockpitTools`'s 5th arg, `llm.ts:618`). A green run calls `recordEvalEvidence` (`skills.ts:189`) writing refs/counts-only `EvalEvidence` (`skill.ts:96`) onto the exact row.
5. **Activate:** `activateSkill` / owner's `activateCandidate` (`skills.ts:129`/:141) both route through `activateSkillVersion` (`skills.ts:82`); the EVAL_GATE (`skills.ts:101`) refuses a gated candidate lacking `hasPassingEvidence(evidence, name, version)` (`skill.ts:122`). Rollback (archived/rolled_back targets) is structurally exempt.

**Which skills mint first (Claude's discretion):** each gated skill edit that changes agent behavior = new golden fixtures + a full `pnpm eval:golden` cycle (cost). Teaching the `cockpit-agent` skill WHEN to call `evaluateBusiness` is a `cockpit-agent` body change → **rides the gate** (mints a new `cockpit-agent` candidate, like Phase 10's `@14`). The planner should scope how many of the four frameworks land this phase against that eval-gate cost (memory: full EVAL_GATE cycle ~25 fixtures, ~$0.12).

### How golden fixtures get added (grounded-assessment + healthy no-gaps)
- Fixtures are JSON in `packages/backend/scripts/eval-cases/*.json` (`loadFixtures`, `run-eval-golden.mjs:94`). Shape (from `10-attach-document.json`): `{ id, description, turns[], expect{}, needles[] }`.
- `expect` is a **CLOSED vocabulary** validated by `validateFixture`/`evaluateExpect` (`run-eval-golden.mjs:119`): `status, statusAtMost, recipients, recipientCount, mode, subjectPresent, bodyPresent, attachmentCount, attachmentError, candidatesPending, briefingPresent, ledePresent`. **An unknown expect key is rejected** (`selfCheck`, :198) and `SMOKE::`-prefixed turns are rejected (:201) — fixtures drive the REAL model.
- **For Phase 12** the assertions want a new observable: e.g. `evaluationPresent: true` / `gapCount: 0` (healthy). This means **extend the closed vocabulary** in `evaluateExpect` + `validateFixture` + a matching `smoke:` read (mirroring `briefingPresent`'s `smoke:briefingCountForThread` — `run-eval-golden.mjs:115`). Two new fixtures: (a) a grounded-assessment turn that expects an evaluation row + ≥1 finding; (b) a **healthy-business** fixture that expects `gapCount: 0` (SC #2). Both ground via the `SMOKE::` seam against seeded fixture docs. Also bump `selfCheck`'s `>= 18` fixture-count floor (:189).

---

## Growth OS Port (research priority #6 — what to scope)

### `diagnose.py` → `diagnose(scorecard)`
Top-down gates, stop at first failure, emit ONE prescription `{ constraint, gate, route, playbook, reason, proof_metric, roadmap_level }`. Constants `FLOOR_RATIO = 3.0`, `INDUSTRY_MULTIPLE = 3.0`. **Conservative by design:** a value that is unknown → do NOT guess/route; ask for it (preserve this — it's the "no fabricated metrics" guarantee in code form). Gate order:
- **Gate 0 Market:** `identity.market_viable === false` → change market first (offer-architect `01-select-market`).
- **Gate 1 Offer:** no offer, or value-equation min score ≤ 3, or commodity → offer-architect.
- **Gate 2 Money Model:** 30-day payback fails / `thirty_day_cash < cac` / only one offer type / `LTGP:CAC < 3` with CAC within industry norms → money-model-designer.
- **Gate 3 Leads:** `CAC > 3× industry avg` OR no active channel → lead-engine.
- **Else Scale:** healthy → compound working channels (this is the **"no gaps / healthy"** branch, SC #2).

### `ltgp_cac.py` → `ltgpCac(...)`
`LTGP = gross_profit_per_purchase × purchases` (gross profit, never revenue). `CAC = acq_spend / customers` (customers > 0). `ratio = LTGP/CAC`; `scalable = ratio ≥ 3`. Master switch vs `industry_avg_cac × 3`: CAC below → ceiling is business model (raise LTGP → offer/money-model); CAC above → ceiling is advertising (lower CAC → lead-engine).

### `cfa.py` → `cfa(...)`
`ratio = thirty_day_cash / (cac + service_cost)` (total_cost > 0). `≥ 1` CFA achieved; `≥ 2` funds ≥1 more customer; `< 1` cash trapped → money-model-designer. `additional_customers_funded = int(ratio) - 1`.

### Scorecard template → TS type + default
`business-scorecard.template.json` fields: `identity{market, eternal_market, niche, avatar, current_offers[], headline_price}`, `financials{ltgp, cac, ltgp_cac_ratio, industry_avg_cac, thirty_day_cash_per_customer, cost_to_service_per_customer, gross_margin_pct, refund_pct, churn_by_cadence{}}`, `position{roadmap_level, current_constraint, funnel[]}`, `offer_card{value_equation{}, enhancers{}, guarantee, offer_name}`, `model_card{offer_types_present{}, thirty_day_payback, continuity_take_pct}`, `lead_card{core_four_active{}, rule_of_100_active, lead_getters_active{}, primary_constraint_step}`, `history[]`. **All fields nullable** — the "vault-first, then ask, then store" flow fills them incrementally; a null is a "not enough data" nudge, never a fabricated value. `scorecard.py`'s CLI (init/get/set/log) is **replaced by Convex storage** — do NOT port it.

### References → rubric skill bodies (original wording)
| Reference file | → Rubric skill body |
|----------------|---------------------|
| `references/diagnostic-tree.md` | `growth-os-diagnostic` skill (the routing method/reasoning) |
| `references/financial-spine.md` | financial-spine definitions folded into the growth-os-diagnostic body (shared metric defs) |
| `references/roadmap-7-levels.md` | roadmap-positioning content (level → primary action) within the growth-os-diagnostic body |
Specialist method files under `Skills/{offer-architect,money-model-designer,lead-engine}/` → the 3 specialist gated skill bodies (registered now, execution deferred; the memo cites the relevant playbook). **Non-book-text, original wording** (attribution-not-reproduction, §5 no-hardcoded).

---

## Common Pitfalls

### Pitfall 1: Skill version collision (HIGH — from memory + `skills.ts`)
**What goes wrong:** you PLAN to ship the rubric at `@N`, but the live DB row carrying your body is `@N+1` because an optimizer dry-run candidate or a prior candidate occupied `@N`.
**Why:** `seedSkills` mints `maxVersion+1`; candidates from multiple sources share the version space.
**Avoid:** before eval/activate, verify which version carries your body (`getSkillVersion`, `skills.ts:210`); pin THAT version in `pnpm eval:golden --skill <name>@<version>`. (Phase 10 shipped at `cockpit-agent@14`, not the planned `@13`.)

### Pitfall 2: Closed union / closed expect-vocab silently drops the new capability (HIGH)
**What goes wrong:** the `agentSteps.tool` union (schema.ts:318) or the eval `expect` vocabulary (`run-eval-golden.mjs:119`) doesn't know `"evaluateBusiness"` / `evaluationPresent` → the step insert throws and is swallowed (no activity step in prod while tests pass), or the fixture is rejected.
**Avoid:** add `"evaluateBusiness"` to the `agentSteps.tool` union AND to `SMOKE_OP_TOOL` (`llm.ts:1767`); extend `evaluateExpect`/`validateFixture` for any new expect key + its `smoke:` read (the `briefingPresent` precedent). (This is Phase-10 RESEARCH Pitfall 4, cited at schema.ts:341.)

### Pitfall 3: Assuming `deliverApprovedPlan` covers the memo (HIGH — see §Gap→Action)
**What goes wrong:** the approved gap-action needs a written memo, but `deliverApprovedPlan` (`deliverApprovedPlan.ts:23`) only fans out `gmail.send`. Wiring the memo through it would try to email the memo.
**Avoid:** scope a minimal memo terminal (persist a `next_step_memo` vault doc / plan field on Approve). Don't pull ACTN-01 (Phase 15) forward.

### Pitfall 4: Fabricated metrics leaking through thin-data (HIGH — SC #1)
**What goes wrong:** growth-os diagnosis runs on an idea-stage profile with null financials and invents an LTGP:CAC.
**Avoid:** preserve `diagnose.py`'s conservative "unknown → ask, don't guess" in the port; render null-grounded sections as the explicit "not enough data to assess" state; label user-supplied numbers "user-provided". No numeric % scores anywhere.

### Pitfall 5: PII-in-prose in audit/export (MEDIUM — §4 + STATE.md open blocker)
**What goes wrong:** grounded business-profile prose (which `packages/pii` does NOT scrub — it's structured-PII only) leaks into an audit/telemetry/WORM payload.
**Avoid:** findings/citations stay content-plane (the evaluation row/card); audit carries counts/hashes/enums ONLY. This is the `searchVault` `vault.searched` payload discipline (`llm.ts:1336`). Note the STATE.md "names-in-prose PII ceiling" open blocker — keep grounded prose out of exportable tables.

### Pitfall 6: §5 no-hardcoded-prompt scan ceiling (MEDIUM)
**What goes wrong:** a tool `description` or inline instruction string > ~200 chars trips the §5 scan (a hardcoded prompt).
**Avoid:** split long tool descriptions across concatenated literals (the `searchVault`/`resolveContacts` precedent, `llm.ts:1301`). Rubric prose lives in `skills` rows, not source.

---

## Validation Architecture

> nyquist_validation is `true` in `.planning/config.json` — this section is REQUIRED and gates VALIDATION.md creation.

### Test Framework
| Property | Value |
|----------|-------|
| Unit/integration | **Vitest** (`convex-test` for Convex fns; pure package fns test without Convex) |
| Config file | per-package `vitest.config.ts` (existing) |
| Quick run command | `pnpm --filter @pikar/core test` (pure ports) / `pnpm --filter @pikar/backend test` (convex) |
| Full suite command | `pnpm test` (workspace) + `pnpm eval:golden` (live agent gate) |
| Offline seam | `SMOKE::<docId,…>` grounding seam (`vaultGround.ts:43`) — zero network |

### Phase Requirements → Test Map
| Req | Behavior (observable signal) | Test type | Automated command | Seam / File exists? |
|-----|------------------------------|-----------|-------------------|---------------------|
| BEVL-01 | `diagnose(scorecard)` returns the correct gate/route for each financial regime; unknown → asks, never guesses | unit | `pnpm --filter @pikar/core test` | ❌ Wave 0: `packages/*/src/growth/diagnose.test.ts` |
| BEVL-01 | `ltgpCac`/`cfa` math matches the Python worked examples (LTGP `$4,500`; CFA ratio boundaries at 1 and 2) | unit | `pnpm --filter @pikar/core test` | ❌ Wave 0: `financialSpine.test.ts` |
| BEVL-01 | Thin/idea-stage profile (null financials) → "not enough data" state, NO fabricated metric | unit | core test | ❌ Wave 0 (assert `diagnose` returns ask-not-route) |
| BEVL-01 | `evaluateBusiness` grounds tenant-scoped, writes evaluation row + refs-only `evaluation.ran` audit (no prose) | integration | `pnpm --filter @pikar/backend test` | ❌ Wave 0: `evaluations.test.ts` (convex-test) |
| BEVL-01 | Grounded assessment produces ≥1 finding, each with a citation (live model) | eval | `pnpm eval:golden` | ❌ Wave 0: `eval-cases/NN-grounded-assessment.json` |
| BEVL-02 | Tapped gap → `proposed` plan through the existing spine | integration | backend test | ❌ Wave 0 (assert plan status transition) |
| BEVL-02 | **Healthy business → zero gaps** affirmative card (live model) | eval | `pnpm eval:golden` | ❌ Wave 0: `eval-cases/NN-healthy-no-gaps.json` (new `gapCount: 0` expect key) |
| BEVL-02 | Approved gap-action → persisted next-step memo (not an email) | integration | backend test | ❌ Wave 0: memo-terminal test |
| SC #5 | **Two-tenant isolation** — tenant B never sees tenant A's evaluation row/scorecard | integration | backend test | ⚠️ pattern exists (`plans.test.ts:44`); ❌ new assertion for the new table/doc-kind |
| §4 | Audit/telemetry payloads for evaluation carry counts/hashes/enums only | static/unit | backend test | ⚠️ mirror `llmRedaction.test.ts` structural assertion |

### Sampling Rate
- **Per task commit:** the pure-port unit tests + the relevant convex-test file (`pnpm --filter … test`) — seconds, no network.
- **Per wave merge:** full workspace `pnpm test` + the isolation assertion.
- **Phase gate:** `pnpm eval:golden` green (records evidence, activates the gated rubric/cockpit-agent candidates) BEFORE `/gsd:verify-work`. Mind the eval env fragility (memory: kill-all-convex → one clean `convex dev` → verify stable before eval).

### Wave 0 Gaps
- [ ] `packages/*/src/growth/diagnose.test.ts` + `financialSpine.test.ts` — one assert-based self-check per pure fn (ponytail; covers BEVL-01 math + conservative-unknown behavior)
- [ ] `packages/backend/convex/evaluations.test.ts` — convex-test: grounding, refs-only audit, storage, **two-tenant isolation** (SC #5, mirror `plans.test.ts:44`)
- [ ] `eval-cases/NN-grounded-assessment.json` + `NN-healthy-no-gaps.json` — new golden fixtures riding the `SMOKE::` seam
- [ ] Extend `evaluateExpect`/`validateFixture` (`run-eval-golden.mjs:119`) with the new expect key(s) (`evaluationPresent`/`gapCount`) + matching `smoke:` read; bump the `>= 18` fixture floor (:189)
- [ ] Add `"evaluateBusiness"` to `agentSteps.tool` union (schema.ts:318) + `SMOKE_OP_TOOL` (llm.ts:1767)

---

## Card + Activity-Step UI (research priority #8)

- **Render seam:** `apps/web/app/(app)/dashboard/workspace/cards.tsx` (1286 lines). Cards are plain inline-styled `<div>`s (the `box` style mirrors `review/[id]`; `label` style), fed by Convex `useQuery` reactivity (cards.tsx:17-18). Existing siblings: `PlanCard` (:221), `ScheduledCard` (:315), `CanceledCard` (:352), `DraftCard` (:416), plus the briefing/source cards. The EVALUATION card is a **new component** subscribing to a new `api.evaluations.byThread` query (mirror `api.plans.byThread` / `api.briefings.byThread` — cards.tsx:37/41).
- **Structure (locked):** framework sections/quadrants, per-line findings each with a small H/M/L confidence chip + inline citation (link to the source doc, the `vaultSources`/SourceCard doc-link precedent, STATE.md 10-03), a leverage-ranked gap list (≤5, rest under "more") with an "Act on this" control per gap, and the affirmative healthy state. The "not enough data to assess" state is visually distinct from a gap.
- **Activity step:** emit an "Assessing your business…" step from the tool — the CKPT-05 idiom. The `agentSteps` row carries `tool` (closed union) + `phase` + optional `count` ONLY — no free text (schema.ts:350). UI verb label is a code-owned map keyed off `tool`. Terminal on success/failure (never spins forever).
- **BRAND.md constraints (§10):** read `docs/design/BRAND.md` before building. Use `apps/web/app/globals.css` CSS variables — never hardcode a hex a token covers. Match existing card patterns; the app has NO component library — do not add one. Match the committed screenshots before inventing patterns.

---

## State of the Art

| Old / naive approach | This-repo current approach | Why |
|----------------------|----------------------------|-----|
| Run the Growth OS Python scripts | Port to pure-TS `packages/*` (§1) | Convex runtime can't run Python; domain logic must be portable/testable without Convex |
| Ingest the Hormozi PDFs into the vault for grounding | Method → rubric skill bodies (original wording); user data grounds findings | Attribution-not-reproduction; copyright + retrieval-bloat; "grounded in the USER's data" stays literal |
| Hardcode framework prompts | `skills` registry rows, eval-gated (§5) | Rollback, versioning, no source edits for prompt changes |
| Build a new proposal/approval flow | Reuse `plans.ts` + Approve gate | The whole state machine already exists |
| A generic action executor for the memo | A minimal memo terminal now; ACTN-01 in Phase 15 | Don't pull a later phase forward (ponytail YAGNI) |

**Deprecated/outdated:** `scorecard.py`'s file-based CLI (init/get/set/log) — superseded by Convex storage; do NOT port it.

---

## Open Questions

1. **Storage shape — `evaluations` table vs. `vaultDocuments` doc-kind.**
   - Known: both give tenant isolation + refs-only audit; doc-kind = zero migration + groundable; table = clean latest-row + structured `history[]`.
   - Unclear: does BEVL-03's recurring review want to `searchVault` the scorecard (favors doc-kind) or query structured latest-per-framework (favors table)?
   - Recommendation: planner decides; lean table if history[]/latest queries matter, doc-kind if minimizing surface. (§Storage)

2. **The memo terminal shape.**
   - Known: `deliverApprovedPlan` is gmail-only; ACTN-01 is Phase 15; the memo must be saved, not emailed.
   - Unclear: memo as a plan `body` persisted-to-vault-doc on Approve (laziest) vs. a small dedicated `next_step_memo` writer action.
   - Recommendation: the plan-body-→-vault-doc route (ponytail); scope explicitly. (§Gap→Action, Pitfall 3)

3. **How many frameworks land in Phase 12 vs. later.**
   - Known: each gated-skill edit = new fixtures + a full `pnpm eval:golden` cycle (~$0.12, ~25 fixtures).
   - Unclear: growth-os + one persona framework this phase, or all four?
   - Recommendation: growth-os (the action-connected core) + the persona-map fallbacks are the SC-satisfying minimum; planner scopes against eval cost. (§Skill Minting)

4. **Confidence heuristic + leverage-ranking function** — Claude's discretion; propose the direct/inferred/sparse → H/M/L mapping and the gate-order leverage rank; validate in unit tests.

---

## Sources

### Primary (HIGH confidence — this repo, read directly)
- `packages/backend/convex/llm.ts` — `buildCockpitTools` (:607), `searchVault` (:1300), `proposePlan` (:1083), `SMOKE_OP_TOOL` (:1767)
- `packages/backend/convex/vaultGround.ts` — `vaultGroundHydrated` (:106), `SMOKE::` seam (:43), caps (:29)
- `packages/backend/convex/skills.ts` — `loadSkill` (:53), `activateSkillVersion`/EVAL_GATE (:82/:101), `seedSkills` gated branch (:281), `recordEvalEvidence` (:189), `getSkillVersion` (:210), `insertCandidate` (:321)
- `packages/contracts/src/skill.ts` — `GATED_SKILLS` (:79), `isGatedSkill` (:87), `EvalEvidence` (:96), `hasPassingEvidence` (:122), name consts (:31-65)
- `packages/contracts/src/skills/businessProfile.ts` — the canonical-md→derived-ts skill-body pattern + profile field contract
- `packages/backend/convex/schema.ts` — `plans` (:152, status enum :155), `vaultDocuments` (:501, kind :504, by_tenant :524), `agentSteps` (:313, closed tool union :318), `skills` (:47), `vaultSources` (:293), `audit` (:15)
- `packages/backend/convex/plans.ts` — `insertPlan` (:60), `patchPlan` (:76), `setPlanStatus` (:121), `byThread` (:268)
- `packages/backend/convex/deliverApprovedPlan.ts` — gmail-only fan-out terminal (:23)
- `packages/backend/scripts/run-eval-golden.mjs` — `loadFixtures` (:94), `parseSkillPin` (:103), `evaluateExpect` closed vocab (:119), `selfCheck` (:186) + `eval-cases/*.json`
- `packages/backend/convex/importGuard.test.ts`, `plans.test.ts:44` — isolation/tenant-guard test precedent
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — card render seam
- `Skills/growth-os/{SKILL.md, scripts/*.py, assets/business-scorecard.template.json, references/*.md}` — the Growth OS method to port + mint
- `.planning/phases/12-business-evaluation-engine/12-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `CLAUDE.md` §1-10

### Secondary (MEDIUM — cross-referenced memory/state)
- MEMORY: skill-version-collision gotcha; growth-os-skill-suite; phase11-sparse-start-onboarding; eval-env-recovery

### Tertiary (LOW / to validate)
- None. Every claim is grounded in a current source file.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive read directly in-repo.
- Architecture: HIGH — the two-shapes rule + read-tool + skill-gate patterns are established and cited.
- Growth OS port: HIGH — the Python is short and fully read; the math is deterministic.
- Storage + memo terminal: MEDIUM (by design — these are Claude's-discretion decisions with trade-offs surfaced, not resolved).
- Pitfalls: HIGH — drawn from cited code + prior-phase memory.

**Research date:** 2026-07-24
**Valid until:** ~2026-08-24 (stable in-repo patterns; re-verify skill versions live before eval — they drift with optimizer/candidate activity).
