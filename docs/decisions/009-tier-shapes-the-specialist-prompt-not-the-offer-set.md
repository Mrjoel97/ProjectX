# ADR-009: Tier shapes the specialist PROMPT, not the offer set

- **Status**: Accepted (2026-07-26 — Phase 15.1, ONBD-01; owner-locked as research open question Q2)
- **Recorded**: 2026-07-26 (`packages/core/src/businessProfile.ts` `deriveTier`, ahead of the plan-05
  `runSpecialistTurn` prompt change this decision authorizes)

## Context

The design doc for the fact-derived tier
(`.planning/design/tier-and-conversational-onboarding.md` §8.2) lists as one of two tailoring
mechanisms: *"tier filters and orders which Growth OS specialists (`offer-architect`,
`money-model-designer`, `lead-engine`) are offered off a given diagnosis. Same diagnosis, genuinely
different recommended next steps."*

**That candidate set does not exist.** Read the engine:

- `diagnose()` (`packages/core/src/growth/diagnose.ts:32-179`) is a top-down gate cascade —
  Market → Offer → Money Model → Leads — that **RETURNS at the first failing gate** and emits ONE
  `Prescription`. Its own header says so: *"STOP at the first failing gate, emit ONE prescription."*
- `runEvaluation` consumes it as `const prescription = diagnose(scorecard); const ranked =
  leverageRank([prescription]);` (`packages/backend/convex/evaluations.ts:324-325`). So
  `leverageRank` (`diagnose.ts:184-186`, a `sort` by gate order) sorts a **single-element array**,
  and the persisted `evaluations.gaps` holds **at most one** route.

A tier filter over a set of one can only ever REJECT. And a rejected route does not degrade
gracefully: `actOnGap`'s runtime terminal chooser lands an unroutable gap on the deterministic
`buildMemo` template (`evaluations.ts:685-692`, `buildMemo` at `:569`). So "filter the offers by
tier" cashes out as *"solopreneurs get a template instead of a specialist"* — a downgrade wearing
tailoring's clothes, and the opposite of design §2's "perceivable".

The tier must therefore change something the user can actually perceive, without inventing a
candidate set the diagnosis cannot produce.

## Decision

**Tier (plus the agent name and the behavior preset) rides into the specialist's PROMPT. The offer
SET is unchanged and the dispatch router is not forked.**

- `runSpecialistTurn` receives the tier, the sanitized agent name and the behavior-preset style
  directive as prompt context (plan 15.1-05), so a solopreneur's `money-model-designer` never
  proposes hiring its way out of a constraint. This delivers design §8.1 directly — *"a solopreneur
  does not receive advice premised on delegation"* — for the specialist that actually runs.
- `SPECIALISTS` stays a pure `readonly` record with no filter layer and no per-tier grant; the
  capability split of [ADR-007](007-sub-agent-capability-is-code-owned.md) is untouched.
- The dispatch router is NOT forked. `PARALLELIZATION.md` scoped Lane A to dispatch and Phase 15
  shipped it deliberately tier-agnostic; tier plugs in as a layer over it, never as a second path
  through it.

## Alternatives rejected

- **Filter/order a candidate set now.** Requires widening `diagnose()` first (see Deferred). Doing
  the filter without the widening filters a set of one.
- **Have the tier change the rubric pick instead.** That is Q3, and the answer is no: see
  Consequences.
- **Have the tier pick a different specialist than the diagnosis routed to.** The diagnosis names the
  binding constraint. Routing a solopreneur away from `money-model-designer` because the tier
  "prefers" `offer-architect` overrides a grounded finding with a demographic guess — the exact
  failure mode `deriveTier` exists to end on the tier itself.

## Consequences

- **SC#5 is satisfied by prompt-shaping.** **A verifier must NOT read SC#5 as "the offer set is
  filtered" or "the rubric pick changes."** The observable is: two tenants with the same diagnosis
  and different tiers receive differently-framed specialist output. Nothing about
  `evaluations.gaps.length`, `Prescription.route`, or `PERSONA_FRAMEWORK` should be expected to move.
- **Q3 stands: `financialsPresent` keeps overriding the framework pick, and that is correct.**
  `evaluations.ts:286-295` gives any financially-grounded tenant `growth-os` regardless of tier —
  financials mean a growth-os diagnosis is actually *possible*, which is a stronger signal than
  business shape. The tier's effect lands on voice, framing and the specialist prompt instead, which
  is **unconditional** and therefore reaches every tenant including the financially-grounded ones.
- **The body/capability split of ADR-007 is why this shape is available at all.** The per-tier FACT
  line ("this tenant is a solopreneur; do not propose delegation") is CODE-owned, assembled at
  dispatch time from the `tenantProfiles` row; the behavior-preset DIRECTIVE is a versioned
  registry row (CLAUDE.md §5 / ADR-003). Same split, same reasons: what the agent is TOLD is
  DB-editable and eval-reviewable, what is structurally TRUE about the tenant is not.
- **The perceivable half ships; the structural half does not.** Design §8.2's sentence remains
  unimplemented on purpose. This ADR is what stops a later verifier or planner reading that
  sentence as a regression or an oversight.
- **Implementation note (2026-07-26, plan 15.1-05 — shipped as described).** Recorded per CLAUDE.md
  §9: an ADR may be EXTENDED with an implementation note; the decision above is not being
  re-decided. `convex/dispatch.ts` `buildSpecialistPrompt` reads `internal.tenantProfile.forTenant`
  and prepends `tierBriefing({tier, agentName, styleDirective})` (pure, in
  `packages/core/src/specialists.ts`) on BOTH return paths. The FACT lines are code-owned; the
  behaviour-preset style directive is a versioned registry row resolved through `PRESET_SKILL`
  (`style-direct` / `style-coaching` / `style-concise`, all UNGATED) and read FAIL-OPEN — an
  unseeded overlay costs voice, never a dispatch, while the specialist BODY loader in
  `runSpecialistTurn` still fails CLOSED. As this decision requires: `SPECIALISTS` gained no filter
  layer and no per-tier grant, the router was not forked, `diagnose()` was not widened, and
  `llm.ts` is byte-unchanged (enforced by `git diff --exit-code` in the plan's verification).

## Deferred — and the supersession path

Widening `diagnose()` to emit **secondary candidates** so `leverageRank` finally sorts a real array,
and only then filtering/ordering that array by tier. That is a second phase's blast radius:

- it changes the diagnosis CONTRACT (`Prescription` → some `Prescription[]`, and "the single
  highest-leverage constraint" stops being a guarantee of the function),
- it changes the persisted `evaluations.gaps` array shape and every reader of it,
- it changes `apps/web` `cards.tsx` gap rendering and the `actOnGap` index-carrying contract,
- and it needs its own answer to "what does a *secondary* constraint mean when the primary gate is
  still failing", which is a growth-methodology question, not a typing one.

When that lands, **supersede this ADR with a new one**. ADRs are never edited after acceptance
(CLAUDE.md §9).
