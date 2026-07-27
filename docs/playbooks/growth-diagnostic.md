# Playbook: Growth Diagnostic (pure-TS math)

> Last verified: 2026-07-27 (16-07) — `INCOMPLETE_MARKER` is now EXPORTED so the stored research document reuses the SAME three stop-cause sentences the memo card carries (one phrasing per cause). No math, gate order, route literal or `SPECIALISTS` entry changed. PREVIOUSLY: 2026-07-27 (16-03) — the research route joins SPECIALIST_ROUTES with its own least-privilege grant; SPECIALIST_ROUTES is now a SUPERSET of what diagnose() emits (ADR-010). Adds researchFindingsFence and the three-reason incomplete marker. PREVIOUSLY: 2026-07-26 against 15.1-05 — `specialists.ts` gained the per-tenant PROMPT BLOCK:
> `tierBriefing({tier?, agentName?, styleDirective?})` and `PRESET_SKILL`. **No diagnostic math, gate
> order, route literal, or `SPECIALISTS` entry changed** — this is additive and lives beside the
> registry, not inside it. The CODE-owned / REGISTRY-owned split is the thing to preserve: the FACT
> lines (the tenant's tier and the structural consequence of it, e.g. solopreneur ⇒ *"nobody to
> delegate to"*) are code-owned data in `TIER_FACT`, exactly the class `TASK_LINE` already occupies in
> `dispatch.ts` (*"driver-plane synthetic string, not a skill"*); the VOICE — the behaviour-preset
> style directive — is a VERSIONED REGISTRY ROW resolved through `PRESET_SKILL`. Same split and same
> reasoning as ADR-007 (bodies registry-owned, structure code-owned): what the agent is TOLD is
> DB-editable and eval-reviewable, what is structurally TRUE about the tenant is not. `TIER_FACT` is a
> `satisfies Record<Tier, string>` TABLE, never a switch/ternary — a ternary is total by construction,
> so a new tier would silently inherit the else-branch and the distinctness test would be vacuous
> forever (the `armFor` lesson). An ABSENT tier produces NO tier claim, never an invented
> `solopreneur` — a missing profile row must not become a silent classification. `agentName` is passed
> through `sanitizeAgentName` INSIDE `tierBriefing`, so there is exactly ONE place a user-authored
> string can reach a model prompt. **Testing note worth keeping:** the SC#5b distinctness assertion
> MASKS the tier literal before comparing blocks — the block interpolates the tier name, so comparing
> raw blocks passes even when two tiers share a clause word-for-word (observed: 34/34 GREEN under that
> mutation). Masking the name is what makes the assertion about substance; the corrected form goes RED.
> Previously verified: 2026-07-25 against 15-02 (Phase 15 Wave 1) — the three specialists are REGISTERED
> and `Prescription.route` is now closed to `SpecialistRoute | ""`. No diagnostic math, gate order,
> or route literal changed. See "Consumer side — specialist dispatch" below.
> Previously verified: 2026-07-25 against 15-01 (Phase 15 Wave-0 freeze) — `packages/core/src/specialists.ts`
> (+ its test) registered under this playbook as a STUB: the fail-closed route lookup with ZERO
> specialists registered.
> Previously verified: 2026-07-24 against 12-01 (Python→TS port of the Growth OS diagnostic spine)
> Build history: `.planning/phases/12-business-evaluation-engine/`,
> `.planning/phases/15-sub-agent-dispatch-action-executor/` · Related ADRs: ADR-007 (sub-agent
> capability is code-owned; the sub-agent prompt is registry-owned),
> [ADR-009](../decisions/009-tier-shapes-the-specialist-prompt-not-the-offer-set.md) — `diagnose()`
> emits exactly ONE prescription, so business tier shapes the specialist PROMPT and **does not filter
> an offer set**. Widening `diagnose()` to emit secondary candidates is DEFERRED and would supersede
> that ADR; until then, do not read the tier design doc's §8.2 as unimplemented here.

## Purpose

The deterministic core of the Business Evaluation Engine (BEVL-01). Given a Business Scorecard it
routes to the single highest-leverage constraint — top-down Market → Offer → Money Model → Leads —
by porting the Growth OS Python scripts (`diagnose.py`, `ltgp_cac.py`, `cfa.py`) to framework-agnostic
TypeScript. It is pure and Convex-free (CLAUDE.md §1) so the engine (plan 03) merely orchestrates it,
and it is conservative by construction: an unknown financial input makes it ASK, never fabricate a
metric or a route (§4 / RESEARCH Pitfall 4).

## Key files

Pure package (`packages/core/src/growth/`):
- `scorecard.ts` — the `Scorecard` type (an all-nullable mirror of
  `Skills/growth-os/assets/business-scorecard.template.json`) + `emptyScorecard` (the all-null default).
  Every leaf is `T | null`; a null means "not enough data", never a fabricated value.
- `financialSpine.ts` — `ltgpCac()` (LTGP:CAC ratio + `business_model | advertising` master switch) and
  `cfa()` (30-day self-funding test). `FLOOR_RATIO = 3.0`, `INDUSTRY_MULTIPLE = 3.0`. Every divisor is
  guarded → a bad input returns `null`/`false`, never `NaN`.
- `diagnose.ts` — `diagnose(sc): Prescription` (top-down gates, stop at first failure, one prescription;
  `gate: 0|1|2|3|"scale"`) + `leverageRank()` (orders a gap list by gate). Imports `ltgpCac`/`cfa`
  constants for the Gate 2/3 numeric checks.
- `index.ts` — re-exports the three modules.
- `financialSpine.test.ts`, `diagnose.test.ts` — the runnable checks (vitest; ponytail — no fixtures).

Consumer side — specialist dispatch (`packages/core/src/specialists.ts`, + `specialists.test.ts`):
- `SPECIALIST_ROUTES` / `SpecialistRoute` / `SPECIALISTS` / `resolveSpecialist(route)` — the DISP-01
  lookup that turns a `Prescription.route` string into a dispatchable specialist. **15-02 registered
  the three:** `offer-architect`, `money-model-designer`, `lead-engine`, each a
  `(skillName, tools, stepTool)` triple. Nothing else resolves.
- **`Prescription.route` is now `SpecialistRoute | ""`** (15-02). The `""` member is DELIBERATE — it
  is what `diagnose.ts`'s not-enough-data ask branch emits, and `resolveSpecialist("")` refuses it at
  runtime rather than routing on a guess. The union lives in `../specialists`; the dependency
  direction is **`growth/ → specialists`, never the reverse** (a back-edge would be a cycle).
- **INVARIANT a future change must keep: every non-empty route `diagnose()` can emit must resolve.**
  A new gate with a new route literal is only half a change; the specialist must be registered in
  the same commit. Asserted at runtime in `specialists.test.ts` (it reads the route literals off
  `diagnose.ts`'s source and feeds each through `resolveSpecialist`) and at compile time by the
  closed `route` type.
- `wouldCycle(ancestry, route)` lives here rather than in `convex/dispatch.ts` because it must
  already be CORRECT the day `MAX_DEPTH` rises — at depth 1 a depth cap hides every cycle.
- `specialistMemoBody({route, body, incomplete})` composes the memo a specialist run produces. §5
  does NOT apply (a document the user reads, not an agent prompt — the `buildMemo` precedent). The
  "incomplete — cost ceiling reached" marker lives in the BODY, never on the plan row: a new
  `plans.status` literal would touch the PINNED status enum with `apps/web` blast radius, and the
  body is visible at the Approve gate where the human decides.
- **`INCOMPLETE_MARKER` is EXPORTED (16-07)**, not just used by `specialistMemoBody`. A research run
  produces TWO artifacts — the memo plan card and a `web_research` vault document — and the document
  is not a memo body (no `> Produced by the … specialist.` line), so it needs the three stop-cause
  sentences without the wrapper. Exporting the map keeps ONE phrasing per cause: a second copy in
  `convex/research.ts` is exactly how the card and the document start disagreeing about why the same
  run stopped. `cost` stays BYTE-IDENTICAL to the pre-Phase-16 string (eval fixtures + `dispatch.test.ts`).
- The three `skillName` values are INLINED copies of `OFFER_ARCHITECT_SKILL` /
  `MONEY_MODEL_DESIGNER_SKILL` / `LEAD_ENGINE_SKILL` (`packages/contracts/src/skill.ts`) because
  `@pikar/contracts` is not a dependency of `@pikar/core`. `specialists.test.ts` reads that file off
  disk and asserts the copies match, so a rename on either side fails a test.
- **`tierBriefing({tier?, agentName?, styleDirective?}) → string`** (15.1-05, ADR-009) — the per-tenant
  block `convex/dispatch.ts` PREPENDS to a dispatched specialist's prompt. Pure, deterministic, no I/O.
  Shape, each line omitted when its input is absent (all absent ⇒ `""`, and the caller skips it):

  ```
  Agent name: <sanitized>
  Business tier: <tier> — <structural consequence>

  <styleDirective body>
  ```

  Three properties a future change must keep: (a) `TIER_FACT` is a `satisfies Record<Tier, string>`
  TABLE so a new tier is a COMPILE error, not a silent else-branch; (b) an absent tier yields NO tier
  claim rather than an invented `solopreneur`; (c) `agentName` is sanitized INSIDE the function, so
  there is exactly ONE place a user-authored string reaches a prompt — do not add a second at a call
  site, and do not remove this one on the assumption a call site did it.
- **`PRESET_SKILL`** (15.1-05) — `satisfies Record<BehaviorPreset, string>`, mapping each behaviour
  preset to its registry row name (`style-direct` / `style-coaching` / `style-concise`). INLINED for
  the same reason the `skillName` values are, and guarded by the SAME on-disk scan against the
  `STYLE_*_SKILL` constants. The directive BODY is registry-owned (§5); only the NAME is code-owned.
- **ADR-009 fence:** `tierBriefing` is prompt-shaping. It is NOT an offer-set filter and NOT a change
  to the rubric pick — `diagnose()` still emits exactly ONE prescription, `SPECIALISTS` gained no
  filter layer and no per-tier grant, and `financialsPresent` still overrides the framework pick (Q3).
  A verifier must not read SC#5 as "the offer set is filtered".
- It mirrors `parseRouting` (`packages/contracts/src/routing.ts`) exactly: a discriminated result,
  NEVER a throw, and deliberately **no default specialist** — "a route the system cannot validate is
  a route it must not take". This is the same guarantee as the diagnostic's own conservatism, one
  layer out: `diagnose()` refuses to fabricate a route, and this refuses to invent one downstream.
- The runtime branch is load-bearing even though `route` will become a union type in 15-02:
  `gap.route` persists as `v.string()`, including the deliberate `route: ""` this file's `diagnose.ts`
  emits on the not-enough-data ask branch, so rows predating the union reach the lookup un-narrowed.
- The lookup uses `Object.prototype.hasOwnProperty.call(...)`, not `SPECIALISTS[route]`: a bare index
  read resolves `"__proto__"`/`"constructor"` to `Object.prototype` members, which are TRUTHY, so a
  truthiness guard would happily "route" on them. Asserted in `specialists.test.ts`.
- `SpecialistSpec.tools` is a CAPABILITY grant and is therefore code-owned, never DB-writable — only
  the skill BODY is a registry row (CLAUDE.md §5). A row that could widen its own tool set would be
  a privilege-escalation path. **ADR-007** records the split. Every spec's `tools` is
  `["searchVault"]`, asserted as an equality over the WHOLE registry so a write tool cannot be added
  to any one specialist quietly. `evaluateBusiness` is deliberately NOT granted — it persists an
  `evaluations` row + an audit row per call and re-enters this engine mid-dispatch; the snapshot
  reaches the specialist through its prompt instead.

## Dependencies & blast radius

Run `graphify query "growth diagnostic"` for the live subgraph. Couplings graphify cannot see:

- **Source of truth is the Python** — behaviour is a verbatim port of `Skills/growth-os/scripts/diagnose.py`
  + `ltgp_cac.py` + `cfa.py`. Change the diagnostic logic there first (or in lockstep); the TS must stay
  behaviour-identical to the worked examples in those files.
- **Plan 03 (the Convex engine) is the consumer** — it parses grounded vault text into a `Scorecard` and
  calls `diagnose()`. Renaming a `Scorecard` field or a `Prescription` field is a breaking contract change
  for that engine — anchor the names.
- **Not yet exported from the package root** — consumers import via `@pikar/core/growth/index`
  (the `./*` wildcard export). `packages/core/src/index.ts` deliberately does NOT re-export growth (ponytail —
  add it only when a root import is actually needed).

## Data flow

1. **Parse** — the engine (plan 03) turns grounded findings into a `Scorecard` (nulls where unknown).
2. **Spine math** — `ltgpCac`/`cfa` compute the health ratios from GROSS PROFIT (never revenue).
3. **Diagnose** — `diagnose()` walks the gates top-down and stops at the first that fails, emitting ONE
   `Prescription` (constraint, gate, route specialist, playbook, reason, proofMetric, roadmapLevel).
4. **Ask instead of guess** — if the money-model gate's financial inputs are all null, the prescription
   carries `ask` (naming the missing figure) with an empty route/proofMetric — no fabricated diagnosis.
5. **Rank** — `leverageRank()` orders multiple prescriptions by gate for the ≤5 gap list (plan 04/05).

## Invariants — what must never break

- **Gross profit, never revenue** — `ltgpCac` LTGP is `grossProfitPerPurchase × purchases`. Enforced by the
  worked-example assertion in `financialSpine.test.ts` (LTGP 4500 / CAC 150 / ratio 30).
- **Conservative: unknown → ask, never fabricate** — a null decisive financial input at the money-model
  gate returns a prescription with `ask` set and an EMPTY `route`/`proofMetric`; it never routes or invents
  a number, and an all-null scorecard never falsely reaches `scale`. Enforced by the null→ask case in
  `diagnose.test.ts`.
- **Every divisor is guarded** — `customers <= 0` → null CAC/ratio; `cac + serviceCost <= 0` → not achieved;
  never `NaN`. Enforced by the guard cases in `financialSpine.test.ts`.
- **`FLOOR_RATIO` and `INDUSTRY_MULTIPLE` are both 3.0** — the scalability floor and the "3× industry CAC"
  master switch. Changing either changes every routing boundary; keep them in step with the Python.
- **All-nullable Scorecard** — every leaf is `T | null` (booleans in presence-checklists default `false` =
  known-absent). A null is a nudge to ask, not a zero. Enforced by the type + `emptyScorecard`.
- **Top-down, stop at first failing gate** — Market < Offer < Money < Leads; the first failure wins and the
  rest are not evaluated. `leverageRank` preserves this order (`scale` last). Enforced by `diagnose.test.ts`.
- **Pure / Convex-free (CLAUDE.md §1)** — no Convex, no network, no I/O in `packages/core/src/growth/`.

## How to change safely

- **Change a routing boundary or a gate** — edit the Python script first (or decide the port diverges and
  document why), then mirror it in `diagnose.ts` and add/adjust the matching gate case in `diagnose.test.ts`.
  Most likely to violate the top-down/stop-at-first-gate and unknown→ask invariants — re-run both test files.
- **Add/rename a Scorecard field** — edit `scorecard.ts` type + `emptyScorecard` together, then check plan
  03's parser and every `diagnose.ts` reader; a rename is a breaking contract change for the engine.
- **Change a spine formula** — keep gross-profit semantics and the divisor guards; update the worked-example
  assertions in `financialSpine.test.ts` so they still pin the Growth OS numbers.

## How to verify

- `pnpm --filter @pikar/core test -- financialSpine` — worked example + CFA boundaries (ratio 1 and 2) +
  divisor guards. ~6s, no deployment.
- `pnpm --filter @pikar/core test -- diagnose` — one case per gate regime + healthy→scale + null→ask +
  `leverageRank` order. ~6s, no deployment.
- `pnpm --filter @pikar/core typecheck` — the module is pure and type-clean.
- `node scripts/check-playbooks.mjs` — this playbook covers `packages/core/src/growth/`.

## Operational notes

- No env vars, no seeds, no deployment — the module is pure math. The Python scripts in `Skills/growth-os/`
  are the reference, NOT a runtime dependency (do not shell out to Python).

## Known gaps & deferred work

- **CFA is not yet wired into `diagnose`** — the Gate 2 checks read the raw financial fields directly (as the
  Python does); `cfa()` is exported for the engine/UI to surface the 30-day self-funding verdict. `ponytail:`
  upgrade path = route Gate 2 through `cfa()` if the payback/tdc fields are ever derived rather than supplied.
- **Market-fact grounding is out of scope** — Phase 12 diagnoses from vault-grounded findings only; external
  market facts wait on web research (Phase 16). Until then `marketViable` is a supplied signal, not verified.

## Phase 16 — the research route

> Append-only container: each Phase-16 plan writes ONLY inside its own subsection.
> On merge conflict, **keep both**.

### Phase 16 — 16-03

**`SPECIALIST_ROUTES` is no longer "exactly what `diagnose()` emits" — see
[ADR-010](../decisions/010-dispatchable-routes-superset-of-diagnose.md).** It is now the set of
routes the SYSTEM can dispatch, and the routes `diagnose()` emits are a strict **subset**.

`research` is dispatch-reachable (the executive agent asks for it) but is **never prescribed as a
gap remedy**. Research is not a fix for a business constraint — it is how you find out what the
constraint is. **Widening `diagnose()` to emit it is a separate decision and needs its own ADR.**

Two assertions in `specialists.test.ts` keep that honest, and together they cover both directions
of the old equality more precisely than the equality did:

1. every route `diagnose()` can emit is a key of `SPECIALISTS` (one-directional coverage — a
   diagnosis can never name a route the dispatcher cannot resolve);
2. `diagnose()` emits **no** `"research"` under any input.

**The research capability grant is `["searchVault", "webResearch"]` and nothing else — this IS
SC#1's containment.** An instruction injected into a fetched page reaches an agent structurally
incapable of sending, writing, or moving a plan row, so at most it can influence a proposal that
still stops at the human Approve gate. Asserted two ways: whole-registry exact equality (a write
tool added to ANY specialist fails), plus an explicit deny-list so the intent survives a refactor.
Mutation-verified — adding `proposePlan` to `RESEARCH_TOOLS` turns both RED.

> **ACCEPTED RESIDUAL:** an injected page CAN steer this specialist's `searchVault` calls. Blast
> radius is a read of the tenant's OWN corpus whose output never leaves the tenant. Upgrade path if
> that ever matters: withhold `searchVault` from research.

**`researchFindingsFence` — and what it deliberately does NOT claim (D5-CORRECTED).** The retrieved
page text **cannot be fenced**: `openai.tools.webSearch` is provider-executed, OpenAI reads pages
server-side, and that text never traverses our process. A test asserting "retrieved text is fenced"
would PASS because the text is **absent**, not because it is contained — which is why no such test
exists. What the fence covers is the specialist's **output** as it lands in the stored vault
document, where it survives chunking and is re-read by a later `searchVault`. Mutation-verified for
breakout (a body carrying a literal `</research_findings>` cannot end the fence early) and for the
zero-source branch.

**`sourceCount === 0` forces the insufficient-evidence label regardless of what the body says** —
D11's zero-results contract, and the verdict is not the model's to decide. The label is placed
BEFORE the fence so it survives truncation of the tail.

**Three incomplete causes, three distinct sentences** (`cost` / `steps` / `clock`), as a CLOSED
union so a fourth cause is a compile error rather than a silent reuse of the wrong wording. `cost`
is byte-identical to the pre-Phase-16 string because the eval harness matches the first line and
`dispatch.test.ts` pins the marker. D12 raises the research budget but does **not** make this
redundant: raising a limit and defining behaviour AT the limit are different fixes.
