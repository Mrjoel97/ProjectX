# Fixture 33 root cause — the declaration channel is dead code

**Found 2026-09-08 (Phase 43 close). Not a flake. Needs one owner decision.**

`33-research-insufficient-evidence` has failed both full pinned gate runs (45/46, twice, ~$1.67)
and has been recorded since Phase 40 as *"research-lane behaviour … stochastic on live search
results"*. It is not. It is a defect with a proof.

## The proof

Three facts, each read from the shipped source:

1. `packages/core/src/specialists.ts` — `evidenceVerdict`:
   `webSearchCalls === 0 ? not_researched : (sourceCount === 0 || declaredUnsupported) ? insufficient_evidence : sourced`
2. `packages/backend/convex/llm.ts:5324` — what every production caller passes:
   `const declaredUnsupported = declaredQuestionScope && sources.length === 0;`
3. `packages/backend/convex/research.ts:175` — the counter, off the SAME array
   (`dispatch.ts:1216` maps `res.sources` into the arg): `sourceCount: a.sources.length`

Substituting (2) and (3) into (1):

```
sourceCount === 0  ||  (declaredQuestionScope && sourceCount === 0)
≡  sourceCount === 0                                    [absorption]
```

**The model's declaration cannot change the verdict under any input.** Verified exhaustively over
`webSearchCalls ∈ {1,3,8} × sourceCount ∈ {0,1,5,10} × declaredQuestionScope ∈ {true,false}`:
**0 of 24 inputs** where it makes a difference.

## Why the fixture cannot pass

Fixture 33's own description says:

> *"a diligent search of a nonexistent entity DOES surface near-miss sources, **which is why no
> counter-based rule could express this** and why 22.1 had to drop the key."*

The fixture asserts `declaredUnsupported: true` and `insufficientEvidence: true`. Both, after the
absorption, require `sourceCount === 0`. So the fixture asserts a property the code computes with
exactly the counter-based rule the fixture says cannot express it. It passes only when the live
search happens to return zero sources — which is precisely the observed pattern: **passes alone,
fails in full runs**, with the recorded trace `{"declareUnsupported":1, "webResearch":8, "readPage":1}`
— the tool WAS called, and the verdict still read false.

## How it got here — two intents that cancel

- **22.1b** built the channel so the label could fire with `sourceCount > 0`. `specialists.ts`
  still says so verbatim: *"the label can now fire with `sourceCount > 0` (the specialist searched,
  retrieved near-misses, and declared that none of them SUPPORT the claim)"*, and the label was
  reworded because *"a label that lies to the reader is worse than no label"*.
- **ACTN-03 / the v7 measurement** then added the AND, because the specialist declares as a
  **reflex**: it passed `scope: "question"` on 5 of 5 dispatches while holding 6, 10, 0, 9 and 8
  sources. `llm.ts` justifies the AND as *"which is what fixture 33 is"* — asserting fixture 33 is a
  zero-source case. **Fixture 33's own description says the opposite.** The AND was introduced on a
  false premise about the very fixture it names.

The tell is the one this repo has recorded before (`an-accepted-adr-can-be-wrong`): two documents
describing the same object contradict each other, and the code follows the wrong one.

## The decision — and why I did not make it

Repairing this changes an **honesty label** on every research run in production (`sourced` vs
`insufficient_evidence`). Both directions have a real cost and the repo already built a diagnostic
to inform the choice — `smoke.researchDeclarationPairForThread` (42.1), explicitly
*"DIAGNOSTIC ONLY … so ONE live gate run can measure whether the declaration reflex still exists at
specialist v10"* — **which has never been run.** Choosing without that measurement would be
guessing with the owner's money and their users' trust labels.

Note the asymmetry that should inform it: the declaration is monotone DOWNWARD by construction —
there is no value of it that produces `sourced`. A false declaration is a **denial of utility**
(good research labelled uncertain), never a safety failure. The reflex therefore fails safe; the
AND fails *closed on the channel itself*.

### Option A — trust the scoped declaration (drop the AND)
`declaredUnsupported = declaredQuestionScope`. The channel lives, fixture 33 passes for the reason
it was written. Cost: the reflex labels genuinely-sourced research `insufficient_evidence` — on the
v7 numbers, most runs. That is a large, user-visible quality regression.

### Option B — split the reading from the verdict (RECOMMENDED, zero behaviour change)
Leave `evidenceVerdict` exactly as it is, so no production label moves. Record the SEMANTIC act
(`declaredQuestionScope`) on the audit plane beside the derived bit, and point fixture 33's
`declaredUnsupported` assertion at it — which is what the fixture's own description already claims
it reads (*"reads that tool-call record off the audit plane, never document prose"*). The fixture
then proves what it exists to prove: **the model refused to confabulate.** The separate question —
*should a run with only near-miss sources be labelled `sourced`?* — becomes its own defect with its
own decision, no longer blocking the gate.
Open sub-question under B: fixture 33 also asserts `insufficientEvidence: true`, which stays false
while sources are found. Either relax that key on this fixture or accept it as the second half of
the same decision.

### Option C — quarantine the fixture
Cheapest, and it loses the D11 refusal-to-confabulate proof entirely. Recorded for completeness;
not recommended.

## Why this was not fixed in Phase 43

Two reasons, both binding. It is a production behaviour change on a trust label, which is outside
what "close Phase 43" authorises; and verifying any repair needs a full unfiltered gate run
(`shouldRecordEvidence` refuses `filters.length !== 0`), which needs a `CONVEX_DEPLOY_KEY` this
environment does not have — `grep -rl CONVEX_DEPLOY_KEY --include=".env*"` returns nothing.

**What unblocks everything else:** pick A, B or C. On B, the fix is a smoke query, an assertion key
and a fixture edit — no production behaviour change — and the gate can then go green.
