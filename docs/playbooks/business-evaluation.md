# Playbook: Business Evaluation Engine

> Last verified: 2026-07-25 against 12-05 (the gap-action + memo terminal — the ACTING side, BEVL-02)
> Prior: 2026-07-25 against 12-04 (the cockpit-tool store surface + the EVALUATION card)
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
  — the card's latest-row read). **12-05 (the ACTING half):** `actOnGap` (tenantMutation — a gap →
  a proposed memo-plan), `buildMemo` (the deterministic memo template), `persistNextStepMemo`
  (a plain exported helper — the MEMO TERMINAL, called by `cockpit.executePlan`).
- `schema.ts` — the append-only `evaluations` table (`by_tenant` / `by_tenant_thread`) + the
  `"evaluateBusiness"` literal in the closed `agentSteps.tool` union + (12-05) the optional
  `plans.kind: "memo"` discriminator and the optional `gaps[].reason`/`gaps[].proofMetric`.
- `evaluations.test.ts` — convex-test over the `SMOKE::` seam: grounded cited row, refs-only audit,
  carry-forward/anti-re-ask, two-tenant isolation (SC #5), thin-data honesty.
- `gapAction.test.ts` — convex-test for BEVL-02: gap → proposed memo-plan (no recipients), a
  healthy/thin evaluation exposes no gap, approve persists a `next_step_memo` vault doc and seeds
  ZERO `requests` rows (the terminal is a persist, NOT gmail), double-approve idempotence.

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
- **Read-only REVIEW (two-shapes rule)** — the evaluate path (`runEvaluation`/`byThread`) never
  proposes or sends. `actOnGap` (12-05) is the ONE control that crosses into the plan gate, and it
  only STAGES: it writes a `proposed` plan and nothing else. Zero sends before the human Approve
  still holds — `executePlan` is still the sole gate and still the sole `workflow.start` site.
- **A memo is NEVER an email (12-05)** — a memo-plan carries `kind: "memo"` and no recipients, and
  `executePlan` branches to the persist terminal BEFORE the mailbox pre-check, so `startFanout` /
  `deliverApprovedPlan` / `gmail.send` are structurally unreachable from it (no `requests` row is
  ever seeded). Enforced by `gapAction.test.ts` (approve with NO `gmailTokens` row succeeds and
  leaves `requests` empty — an email plan would have refused `gmail_not_connected`).
- **One plans row per thread** — `plans.byThread` is a `.unique()` read, so `actOnGap` RECYCLES the
  thread's existing row (resetPlan → patchPlan) instead of inserting a second one. A row that is
  mid-flight or delivered (`approved`/`scheduled`/`delivering`/`done`) is refused (`plan_busy`) —
  staging a memo must never clobber an in-flight send.
- **The memo NAMES the specialist, it does not RUN it** — `gap.route` is written into the memo body
  as an instruction plus its `gap.playbook` citation. Specialist execution is Phase 15+; nothing
  here may invoke a specialist skill.
- **No fabricated content in the memo** — `buildMemo` is a deterministic template over the persisted
  row only (cited findings + the prescription's own `reason`/`proofMetric`). It is a document the
  user reads, NOT an agent prompt, so §5 does not apply — but it must never assert a figure the
  evaluation did not ground.
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
- **Change what a memo says** — edit `buildMemo` only. It reads the persisted row; if you need a
  new fact in the body, persist it on the gap (optional field) at diagnose time rather than
  re-deriving it at act time (two derivations drift).
- **Change what Approve does for a memo** — edit `persistNextStepMemo` + the `plan.kind === "memo"`
  branch in `cockpit.executePlan`. Do NOT route a memo through `deliverApprovedPlan`: that workflow
  fans out `gmail.send` per recipient and a memo has none. A future non-email terminal (ACTN-01,
  Phase 15) generalizes this branch — it does not widen the gmail one.

## How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts` — all six cases
  (grounded cited row, store path, refs-only audit, carry-forward, isolation, thin-data). ~8s, no
  deployment.
- `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` — the four BEVL-02 cases
  (proposed memo transition, nothing-to-act-on, memo-persisted-not-emailed, double-approve
  idempotence). Needs the `workflow` + `workflow/workpool` components registered (the memo terminal
  ingests through `startIngest`) alongside `auditCounts`.
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
- **The memo is the stand-in for the fix, not the fix** (12-05) — approving it saves a next-step
  memo; it does not build the offer or run the campaign. Specialist EXECUTION is Phase 15+.
- **Acting on a gap recycles the thread's plan row** — so a thread that already delivered an email
  (`status: "done"`) refuses `actOnGap` with `plan_busy`; the user starts a new chat. `ponytail:`
  upgrade path = a plan row per artifact (drop the one-row-per-thread `.unique()`) if threads ever
  need to hold an email AND a memo at once.
- **The vault doc is the whole terminal** — there is no memo index/list surface; a `next_step_memo`
  is browsable at `/dashboard/vault` like any other doc and groundable via `startIngest`.
- **Market-fact grounding is out of scope** — vault-grounded findings only until web research
  (Phase 16); `marketViable` is a supplied signal, not verified.
- **Specialist EXECUTION deferred (15+)** — a gap's `route` names the target specialist skill; it is
  not run here.
