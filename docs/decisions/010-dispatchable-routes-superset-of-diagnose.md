# ADR-010: `SPECIALIST_ROUTES` is a SUPERSET of what `diagnose()` emits

- **Status**: Accepted (2026-07-27 — Phase 16, DISP-02; owner-locked as decision D3)
- **Recorded**: 2026-07-27 (`packages/core/src/specialists.ts`, with 16-03)
- **Relates to**: [ADR-007](007-sub-agent-capability-is-code-owned.md) (a tool-set is a code-owned
  capability grant), [ADR-009](009-tier-shapes-the-specialist-prompt-not-the-offer-set.md)
  (widening `diagnose()` is its own decision)

## Context

Since Phase 15, `packages/core/src/specialists.ts:10` asserted:

> The closed set of dispatchable specialist routes — **exactly the routes `diagnose()` emits**.

That equality was true and load-bearing when every specialist existed to *remedy a diagnosed
business constraint*. All three — `offer-architect`, `money-model-designer`, `lead-engine` — are
gap remedies: the diagnostic finds the binding constraint, and the route is the move that resolves
it.

Phase 16 adds `research`, and it breaks the equality in one direction. Research is reachable by
**dispatch** — the executive agent asks for it when a question needs the outside world — but
`diagnose()` must never prescribe it as a gap remedy.

## Decision

**`SPECIALIST_ROUTES` is the set of routes the SYSTEM can dispatch. The routes `diagnose()` emits
are a strict SUBSET of it.**

The invariant that survives is the one that was actually protecting anything:

> every route `diagnose()` can emit is a key of `SPECIALISTS`

That is a **one-directional coverage** bind — a diagnosis can never name a route the dispatcher
cannot resolve. It is asserted in `specialists.test.ts`, alongside a companion assertion that
`diagnose()` emits **no** `"research"` under any input. Both directions of the old equality are
therefore still checked; they are simply checked as two different, more precise claims.

## Why research is not a gap remedy

Research is not a fix for a business constraint — it is how you find out what the constraint *is*.
Emitting it from `diagnose()` would mean the diagnostic answering "what should I do about my weak
offer?" with "go read about it", which is a non-answer dressed as a recommendation. The diagnostic's
job is to name the move; research's job is to inform a human's question.

## Consequences

- The stale sentence at `specialists.ts:10` is **corrected in place, not deleted in silence** — a
  reader who found it removed would have no way to know the invariant had been deliberately
  relaxed rather than accidentally lost.
- **Widening `diagnose()` to emit `research` is a separate decision and needs its own ADR.** It is
  ADR-009 territory (what the diagnostic recommends is a product decision about advice, not a
  registry mechanic). Do not do it as a side effect of adding a route here.
- Any future route that is dispatch-reachable but not diagnosis-emitted follows this precedent and
  needs no new ADR — this one covers the shape.
- The capability split is untouched: `research` gets its own least-privilege grant
  (`["searchVault", "webResearch"]`), code-owned per ADR-007. Being in `SPECIALIST_ROUTES` grants
  nothing by itself.

## Alternatives rejected

**Widen `diagnose()` so the equality holds.** Rejected: it changes what the product recommends in
order to preserve a code comment, which is the tail wagging the dog — and it would put "go do
research" in front of users as a diagnosed next step.

**A second registry for non-diagnostic routes.** Rejected: two registries means two lookup paths,
two capability tables and two places to forget a `stepTool`. The fail-closed `resolveSpecialist`
already handles an unknown route correctly, and one closed union with a corrected comment is
strictly less machinery.
