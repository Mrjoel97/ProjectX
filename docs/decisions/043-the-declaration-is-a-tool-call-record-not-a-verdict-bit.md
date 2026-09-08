# ADR-043 — The refusal-to-confabulate proof reads a TOOL-CALL RECORD, not a verdict bit

- **Status:** Accepted
- **Date:** 2026-09-08
- **Owner decision, 2026-09-08:** Option B of
  `.planning/phases/43-batch-content-and-the-content-queue/43-FIXTURE-33-FINDING.md` — split the
  reading from the verdict, change no production behaviour.
- **Supersedes:** nothing. It does NOT supersede ADR-041 (which is still a DRAFT); it answers two
  of the three questions ADR-041 named as blocking, and it does so analytically rather than by
  buying the run.
- **Related:** ADR-035 (fixture selection is an operator fact); 22.1b (the declaration channel);
  ACTN-03 (the scoped enum and the conjunction); the 42.1 commit (`6cf2f62`), which shipped the
  instrument this decision promotes.

## Context

`33-research-insufficient-evidence` failed two full pinned gate runs (45/46, twice, ~$1.67) and was
recorded for a phase as *"research-lane behaviour … stochastic on live search results."* It is not
stochastic and it is not the research lane. It is a defect with a proof that needs no model turn.

Three facts, each read from shipped source:

1. `packages/core/src/specialists.ts`, `evidenceVerdict`:
   `webSearchCalls === 0 ? not_researched : (sourceCount === 0 || declaredUnsupported) ? insufficient_evidence : sourced`
2. `packages/backend/convex/llm.ts`, what every production caller passes:
   `declaredUnsupported = declaredQuestionScope && sources.length === 0`
3. `packages/backend/convex/research.ts`, the counter, off the SAME array
   (`dispatch.ts` maps `res.sources` into the arg): `sourceCount: a.sources.length`

Substituting (2) and (3) into (1):

```
sourceCount === 0  ||  (declaredQuestionScope && sourceCount === 0)   ≡   sourceCount === 0
```

**The model's declaration cannot change the verdict under any input.** Verified exhaustively over
`webSearchCalls ∈ {1,3,8} × sourceCount ∈ {0,1,5,10} × declaredQuestionScope ∈ {true,false}`:
0 of 24 inputs where it makes a difference.

Fixture 33 asserted `declaredUnsupported: true` while its own description says *"a diligent search
of a nonexistent entity DOES surface near-miss sources, **which is why no counter-based rule could
express this**."* It asserted a value the code computes with exactly the counter-based rule the
description says cannot express it. It passed alone and failed in full runs because live search
results decided whether an impossible assertion happened to hold.

### How two correct intents cancelled

- **22.1b** built the channel so the label could fire with `sourceCount > 0`. `specialists.ts` still
  says so, and reworded the label for that case because *"a label that lies to the reader is worse
  than no label."*
- **ACTN-03** then added the AND to defeat the specialist's declaration **reflex** — measured at v7
  passing `scope: "question"` on 5 of 5 dispatches while holding 6, 10, 0, 9 and 8 sources. The
  reflex is real and the guard was a reasonable response to it.

The AND's own justification names the fixture it broke: *"which is what fixture 33 is"* — asserting
33 is a zero-source case. Fixture 33's description says the opposite. Two documents describing one
object disagreed, and the code followed the wrong one.

## Decision

**D1. The refusal proof reads the TOOL-CALL RECORD.** Fixture 33 asserts `declaredQuestionScope` —
`questionScope` off the `subagent.completed` row, promoted from diagnostic to an asserted runner
key. This is what fixture 33's description always claimed it read (*"reads that tool-call record off
the audit plane, never document prose"*) and what `declaredUnsupported` demonstrably is not. No
source counter can suppress it, and a page quoting the label sentence cannot reach it — fixture 34's
premise is preserved intact.

**D2. `evidenceVerdict` is NOT changed.** No production honesty label moves in this ADR. Trusting
the bare declaration would let the v7 reflex label genuinely-sourced research
`insufficient_evidence`; that is a large user-visible regression and it is not required to unjam the
gate.

**D3. Fixture 33 no longer asserts `insufficientEvidence`, and that is a narrowing, not a
quarantine.** With near-miss sources the stored verdict is `sourced`. ADR-041's draft names this
exactly — *"a fabricated entity reads `sourced`"* — and insists it be *"fixed on its own merits,
never by quarantining it."* This ADR agrees and does not close it. It separates a claim the fixture
CAN prove (the model refused to confabulate) from one it cannot (that the refusal reached the
verdict), so one open defect stops jamming every gated activation in the system.

**D4. The label defect stays OPEN and named.** *Should a run holding only near-miss sources be
labelled `sourced`?* is recorded in `43-FIXTURE-33-FINDING.md` and is not answered here. Answering
it means either defeating the reflex with a signal outside the model or accepting the reflex's cost,
and that decision deserves the measurement ADR-041 asks for.

**D5. The suite identity is re-manifested in the same commit.** Editing a fixture moves its sha256
and therefore `casesHash`; `AGENT_EVAL_SUITE.revision` is bumped to
`2026-09-08.fixture-33-declaration-scope`, retiring every older evidence row. This is free right now
precisely because no passing evidence exists — the gate has been jammed since Phase 40. Doing it at
any other time would be expensive.

## What this answers for ADR-041

ADR-041 (DRAFT) is blocked on one paid run answering three questions. Two are now answered from
source, at no cost:

- *"Does 33 show `questionScope=true` with the conjunction beating it?"* — the conjunction does not
  merely beat it; it **absorbs** it. The declaration is unreachable in the verdict for every input.
- *"Is the `&& sources.length === 0` conjunction load-bearing?"* — **no.** It cannot be, because the
  verdict ORs the same counter back in. Whether it can "simply be dropped" is now a question about
  the reflex's cost, not about the conjunction's contribution, which is zero.

Question 3 (does 33's in-suite reading differ from its `--only` reading?) is unaffected and still
needs the run. ADR-041 remains a DRAFT.

## Rejected

- **Drop the AND (Option A).** The channel would live and fixture 33 would pass for the right
  reason, but on the v7 numbers most genuinely-sourced runs would be labelled uncertain. A
  user-visible quality regression traded for a test result.
- **Quarantine fixture 33 (Option C).** Loses the D11 refusal-to-confabulate proof entirely, and is
  the "green tests over broken capability" failure this repo has already paid for once.
- **Assert `insufficientEvidence: false` instead.** Pins the defect as correct. A fixture that
  certifies the broken behaviour is worse than one that is silent about it.
- **Delete the now-unused `declaredUnsupported` key.** It is still asserted by nothing, but it is
  also still WRITTEN to the audit trail, where it explains an `insufficient_evidence` verdict to
  whoever reads the trail. Removing the key is a separate cleanup and would enlarge this diff for no
  behaviour change.
