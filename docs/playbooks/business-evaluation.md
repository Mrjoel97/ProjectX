# Playbook: Business Evaluation Engine

> Last verified: 2026-07-25 against 12-04 (the cockpit-tool store surface + the EVALUATION card)
> Build history: `.planning/phases/12-business-evaluation-engine/` · Related ADRs: none

## Purpose

The one place that turns a user's grounded vault data + carried-forward answers + a framework
method into a durable, tenant-isolated business assessment (BEVL-01). On demand it grounds over the
vault + business profile, runs the pure `diagnose()` from `@pikar/core/growth`, and persists ONE
`evaluations` row with per-finding citations, H/M/L confidence, honest not-enough-data sections, and
a leverage-ranked gap list. It is READ-ONLY (the two-shapes rule): it never proposes or sends —
acting on a gap crosses the Approve gate separately. It audits counts/enums only (§4).

## Key files

Backend (`packages/backend/convex/`):
- `evaluations.ts` — the engine. `runEvaluation` (internalAction: carry-forward → ground → load
  rubric → fill scorecard → `diagnose()`/`leverageRank()` → persist → refs-only audit → activity
  step), `recordScorecardAnswer` (tenantMutation — the client "store" half) + its identity-free twin
  `recordScorecardAnswerInternal` (internalMutation — same `applyScorecardAnswer` core, called by the
  cockpit tool which carries an explicit tenantId, no live identity), `insertEvaluation`
  (internalMutation), `lastForThread` (internalQuery — carry-forward read), `byThread` (tenantQuery
  — the card's latest-row read).
- `schema.ts` — the append-only `evaluations` table (`by_tenant` / `by_tenant_thread`) + the
  `"evaluateBusiness"` literal in the closed `agentSteps.tool` union.
- `evaluations.test.ts` — convex-test over the `SMOKE::` seam: grounded cited row, refs-only audit,
  carry-forward/anti-re-ask, two-tenant isolation (SC #5), thin-data honesty.

Pure package (`packages/core/src/growth/`, see `growth-diagnostic.md`):
- `diagnose.ts` / `financialSpine.ts` / `scorecard.ts` — the Convex-free diagnosis the engine calls.

Reused verbatim (do NOT rebuild): `vaultGround.ts` `vaultGroundHydrated` (grounding), `audit.ts`
`log` (refs-only audit), `agentSteps.ts` `record`/`finish` (activity step), `skills.ts`
`getActiveSkill` (rubric body).

## Dependencies & blast radius

Run `graphify query "business evaluation"` for the live subgraph. Couplings graphify cannot see:

- **Grounding is the existing engine** — `internal.vaultGround.vaultGroundHydrated({ tenantId,
  query })` with an EXPLICIT tenantId (never auth-derived — the tool loop/eval harness carry no
  identity). Its `SMOKE::<docId,…>` seam is how the tests ground with zero network.
- **The rubric method is a gated skill row** (12-02): framework → skill name is `FRAMEWORK_SKILL`
  (growth-os→`growth-os-diagnostic`, swot→`swot`, lean→`lean-canvas`, bmc→`bmc`). Missing/inactive
  method → fail-open "insufficient", never a throw.
- **`agentSteps.tool` is a CLOSED union** — the `"evaluateBusiness"` literal MUST exist in schema.ts
  or the step insert throws and is silently swallowed in prod (Pitfall 2).
- **The Scorecard shape is the @pikar/core contract** — a renamed field there breaks the engine's
  fill/diagnose. Anchor the dot-path keys in `TRACKED` / `FINANCIAL_PATTERNS`.
- **auditCounts aggregate** — `evaluation.ran` rides the audit insert → the aggregate; convex-test
  must `registerComponent("auditCounts", …)` (the cockpitTools.test.ts idiom).

## Data flow

1. **Carry forward** — `lastForThread` reads the tenant's latest row; its `scorecard` +
   `userProvided[]` seed this run (a previously-answered figure is never re-asked).
2. **Ground** — `vaultGroundHydrated` returns `{ docIds, titles, chunks }` (parallel arrays). Fail
   open on any error (the carried values still stand).
3. **Fill** — parse a grounded business-profile chunk (`deserializeProfile`) into identity fields
   and scan for direct labeled figures (`CAC: $150`) into financials; each fill records its source
   doc as provenance. A user-provided carried field is provenance "user-provided". A field still
   null → stays null (not-enough-data), never guessed.
4. **Auto-pick framework** — financials present → `growth-os`; else persona map
   (solopreneur→lean, startup→bmc, sme→swot); an explicit `framework` arg overrides.
5. **Diagnose** — `diagnose()` + `leverageRank()` over the filled scorecard → gaps (route/playbook),
   with a `diagnose` `ask` becoming a not-enough-data section, never a gap.
6. **Persist** — `insertEvaluation` writes ONE content-plane row (findings source-tagged
   vault|user-provided, each cited).
7. **Audit + step** — ONE `internal.audit.log` `evaluation.ran` (counts + framework/verdict enums
   ONLY) + an `"evaluateBusiness"` activity step (running→done/error).

## Invariants — what must never break

- **Refs-only audit (§4)** — `evaluation.ran` payload is `{ framework, verdict, findingCount,
  gapCount, groundedDocCount, userProvidedCount }` — counts + closed enums ONLY. Findings/citations
  are content-plane (the row), NEVER audited. Enforced by the structural assertion in
  `evaluations.test.ts` ("audit payload carries counts/enums ONLY").
- **Two-tenant isolation (SC #5)** — `byThread`/`recordScorecardAnswer` are tenant-scoped
  (`ctx.tenantId` via the wrappers); `runEvaluation`/`lastForThread` filter by explicit `tenantId`
  on `by_tenant_thread`. Tenant B never reads tenant A's row. Enforced by the isolation test.
- **Vault-first, then ask, then store (LOCKED)** — the durable scorecard is UPDATED each run
  (carry-forward), not rebuilt from null; a user-provided figure survives forward and is cited
  "user-provided". Enforced by the carry-forward/anti-re-ask test.
- **No fabricated metrics (SC #1)** — a financial field fills ONLY from a direct labeled statement;
  no grounding → the field stays null → not-enough-data. With zero grounded findings the engine
  suppresses gaps (no basis for a prescription) and returns "insufficient". Enforced by the
  thin-data test + `diagnose`'s conservative unknown→ask (see `growth-diagnostic.md`).
- **Read-only tool (two-shapes rule)** — `evaluations.ts` never proposes/sends; it only grounds,
  diagnoses, persists, audits. Acting on a gap is a separate Approve-gated write (later plan).
- **Fail open (SC1)** — any grounding/skill error yields an "insufficient" verdict, never a throw
  out of the governed loop. Enforced by the outer try/catch + the fail-open grounding branch.
- **Closed `agentSteps.tool` union** — `"evaluateBusiness"` must stay in the union (Pitfall 2).

## How to change safely

- **Add a grounded scorecard field / finding** — add the dot-path to `TRACKED` (label + section) and,
  for a financial, a `FINANCIAL_PATTERNS` entry; keep the extraction DIRECT-statement-only (no
  inference that could fabricate). Re-run `evaluations.test.ts`.
- **Change the audit payload** — it must stay counts/enums-only; update the structural assertion's
  key set in lockstep. A prose field here is a §4 regression.
- **Add a framework** — add the literal to the schema `framework` union + `FRAMEWORK_SKILL` +
  (if a persona default) `PERSONA_FRAMEWORK`; ensure the rubric skill is seeded/gated (12-02).
- **Schema change on `evaluations`** — append-only (no migration); update the derived `evalFields`
  consumers only if you add a field. Never make the row mutable except via the two write surfaces.

## How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts` — all six cases
  (grounded cited row, store path, refs-only audit, carry-forward, isolation, thin-data). ~8s, no
  deployment.
- `pnpm --filter @pikar/backend typecheck` — the engine source is type-clean (pre-existing
  test-file typecheck failures are tracked in the phase `deferred-items.md`).
- `node scripts/check-playbooks.mjs` — this playbook covers `packages/backend/convex/evaluations.ts`.

## Operational notes

- No new env vars/seeds. The framework rubric skills must be seeded (`seedSkills`) for a real run;
  a missing/inactive method fails open to "insufficient".
- The grounding `query` is an EXPLICIT arg — the cockpit `evaluateBusiness` tool (llm.ts, 12-04)
  calls `runEvaluation` with an explicit tenantId; tests pass a `SMOKE::<docId>` sentinel to ground
  offline. Absent → the `DEFAULT_QUERY` (hits `rag.search`).
- The cockpit `recordScorecardAnswer` tool routes through `recordScorecardAnswerInternal` (explicit
  tenantId) and emits its OWN refs-only `evaluation.answered` audit (field name + value fingerprint)
  from llm.ts — the internal mutation itself stays audit-silent (one audit per tool call, in the tool).

## Known gaps & deferred work

- **Deterministic extraction only** — v1 fills the scorecard by profile-parse + direct labeled-number
  scan; the rich per-quadrant LLM-narrated findings ride the live model, taught via a `cockpit-agent`
  body change through the eval gate (later plan). `ponytail:` upgrade path = thread the rubric body
  into an LLM parse when the card needs prose findings.
- **The EVALUATION card** (plan 04) and the **gap → proposed-PLAN memo terminal** (BEVL-02) sit on
  top of this row; they are separate plans.
- **Market-fact grounding is out of scope** — vault-grounded findings only until web research
  (Phase 16); `marketViable` is a supplied signal, not verified.
- **Specialist EXECUTION deferred (15+)** — a gap's `route` names the target specialist skill; it is
  not run here.
