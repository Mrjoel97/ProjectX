# 16-06 — SUMMARY

**Plan:** 16-06 (wave 4) — dispatch wiring: the async research seam
**Completed:** 2026-07-27
**Requirements:** DISP-02

## Two things the owner should CONFIRM rather than discover

### 1. SC#1 is satisfied VIA THE PLAN CARD, not inline

SC#1 says the research specialist "returns findings to the executive agent". It does — as an
**approvable memo plan card**, not as a value inside the conversational turn. The executive never
sees the prose at all: `buildAgentContext` renders a memo plan as `Body drafted: yes/no`.

**D9-REVISED accepts this cost in writing**, so it is a recorded decision, not a defect. A verifier
must not read SC#1 as requiring an in-conversation return. The alternative — a `generateText`
running inside the executive's tool `execute` — was rejected because a research loop that overruns
its clock THROWS, which would kill the whole executive turn and discard every partial finding. It
would also have contradicted `dispatchGuard.test.ts:16-24`, the comment that predicted this
architecture.

### 2. `stageResearchPlan` REFUSES to start research while the user's own draft is on the plan card

`plans.by_thread` is `.unique()` — one plan row per thread — so staging research means RECYCLING
that row, and recycling it destroys whatever is in it. When the row carries the user's composition
work (recipients / subject / body / bodyIntent / attachments), research is refused with a
conversational `draft_in_progress` and the model is told to offer again once the draft is sent or
discarded.

**This is a limitation, not a final answer.** The upgrade path is more than one plan row per thread
— a `schema.ts` change, and the schema is frozen after 16-01. Marked with a `ponytail:` comment
naming exactly that.

## What landed

- **`buildSpecialistPrompt` gained an optional `question`.** Present ⇒ the question IS the task and
  the evaluation snapshot is never read (a research dispatch may run on a thread with no
  evaluation); the tier briefing still rides it (ADR-009). §5 intact: the question is the PROMPT,
  the skill body is the SYSTEM prompt. Capped at 500 chars through the generalized `cap` helper —
  a trust boundary, since the string originates from the model.
- **`internal.dispatch.runResearch`** — an `internalAction` on `dispatchArgs` that calls the SAME
  `dispatchAndLand`. Not a second spine: 16-07 bolts the vault persist onto it.
- **The honest fallback body**, fixed once at the shared seam. `landSpecialistResult` takes an
  optional `fallbackBody` used ONLY where `LOST_CONTEXT_MEMO` was; `dispatchAndLand` takes an
  optional 4th param and forwards a governed refusal's own `reply` when the caller supplied one.
  The gap path passes nothing and is byte-identical.
- **D11's three-way marker on `DispatchResult`** — `incompleteReason`, with the loop's own stop
  reason winning over the cost condition. `incomplete` stays a boolean, so no consumer changed.
  `sources` + `retrievedAt` ride it as CONTENT-PLANE fields for 16-07; the audit payload gets
  `webSearchCalls`, a COUNT.
- **`plans.stageResearchPlan`** — the `collecting` memo row, with the persisted interlock that
  replaces the superseded per-turn envelope closure.
- **The `dispatchResearch` cockpit tool** — stage, schedule, return. Built only under
  `grantDispatch` + a real turn identity; `grantDispatch` derived in `runAgentLoop` from
  `toolNames === undefined`, beside 16-05's `grantWebResearch`. One mechanism, two flags, pointed in
  opposite directions.
- **`__runSpecialistWithScript` gained `softCutoffMs`** — SOFT stop only, the only way D11's
  wall-clock row is assertable offline.
- **`dispatchGuard.test.ts` is UNMODIFIED**, which is a deliverable of this plan. `git diff
  --name-only` does not list it.

## The correction the plan needed — the recycle rule as written would have refused EVERYTHING

The plan specified the interlock as:

```
recyclable = no row || status === "canceled" || (kind === "memo" && status === "proposed")
```

**`cockpit.ts:95` inserts EVERY thread's plan row at `status: "collecting"` on the first turn, and
it stays there for the whole composition.** Under that rule `dispatchResearch` would have returned
`research_in_flight` on essentially every live conversation — the primary use case — while never
once protecting anything, because no dispatch was in flight.

The plan's own justification names the right discriminator: *"a collecting row means a dispatch
already owns this thread"* — true only when a dispatch STAGED it, which is recorded by
`kind: "memo"`. The shipped rule:

| row | outcome |
|---|---|
| `collecting` + `kind: "memo"` | `research_in_flight` (a dispatch owns it) |
| `collecting`, empty composing row | **recycles** — the fresh-thread path the plan would have blocked |
| any actable row carrying user draft content | `draft_in_progress` |
| `proposed` + memo, `canceled` | recycles |
| `approved` → `done` | `draft_in_progress` (mid-flight or delivered) |

Both refusals the plan asked for are intact and mutation-verified; the fresh-thread case is added.
The `draft_in_progress` guard was also widened from "a `proposed` EMAIL plan" to "any actable row
with content", since a `collecting` row with recipients and a subject is even more clearly the
user's work in progress than a `proposed` one.

## Verification

- Backend full suite: **710/710 across 47 files** (`audit.test.ts` GREEN 1/1 — the 16-VALIDATION
  regression tripwire).
- `dispatch.test.ts`: **52/52** (was 32; +20 for this plan).
- Backend `tsc`: **zero errors in production `convex/*.ts`**; the test-file baseline is unchanged at
  56 as committed (16-05's summary recorded 52; the extra 4 are 16-05's own
  `runCockpitAgent.test.ts:647-652`, in the committed file and untouched here).
- `node scripts/check-playbooks.mjs` → exit 0.
- `dispatch.ts` has ZERO `generateText` CALL SITES (`dispatchGuard.test.ts` green). Note the plan's
  literal `grep -c "generateText" … is 0` gate is unsatisfiable and always was: line 5 of the file
  is the comment *"there is no `generateText` in this file, ever"*. `git show HEAD` returns the same
  count of 1. The real guard strips comments.
- `llm.ts` still has EXACTLY ONE tool-bearing `generateText` call site and ZERO inside any tool's
  `execute` (`dispatchGuard.test.ts` green, unmodified).

**Mutation-checks, all RED then restored GREEN:**

| # | Mutation | Result |
|---|---|---|
| 1 | delete the `collecting`+memo interlock | **RED** — *THE INTERLOCK* (two runs scheduled) |
| 2 | delete the `draft_in_progress` refusal | **RED** — both draft cases |
| 3 | remove the `grantDispatch` gate | **RED** — the specialist constructs a dispatch |
| 4 | collapse 16-05's research model ternary | **RED** — on the FALLBACK pair, as predicted |

Mutation 4 is the one worth reading. `RESEARCH_MODEL` currently EQUALS `DEFAULT_MODEL`
(`openai/gpt-4o-mini`), so the primaries coincide and a primary-only assertion would have stayed
green through the mutation. It failed on `gpt-4.1-nano` vs `gpt-4.1-mini` — the fallback pair, which
can never coincide because the 16-02 probe ladder deliberately excludes `gpt-4.1-nano` and that IS
`CHEAP_MODEL`. Asserting BOTH pairs is what makes the relocated pin non-vacuous.

## Deviations

1. **The recycle rule was corrected** — see the section above. The largest deviation in the plan and
   the reason the feature works at all.
2. **`runSpecialistTurn`'s declared return type was missing `truncatedReason`.** The value already
   travelled at runtime (the `...res` spread), but the type omitted it, so `governedDispatch` could
   not see D11's marker and this plan would not compile. Widened at the declaration — a 16-05 gap,
   fixed where it belongs rather than cast around here.
3. **`DispatchResult` carries `modelId`/`fallbackModelId`.** Task 3 requires the relocated model pin
   to assert on "a real returned observable", and `governedDispatch`'s result is the only thing a
   dispatch returns. `SpecialistRunner`'s return type is now derived
   (`Awaited<ReturnType<typeof runSpecialistTurn>>`) rather than re-listed, so it cannot drift.
4. **`runResearch`'s HAPPY PATH is asserted through `__runSpecialistWithScript`, not through
   `runResearch` itself.** A `LanguageModel` is not Convex-serializable, so no mock can ride
   `runResearch`'s args — the scripted twin drives the identical `dispatchAndLand`. `runResearch`
   ITSELF is driven directly for the two model-free behaviours (the inherited cycle refusal and the
   honest fallback memo), which is what proves the entry point exists and is wired.
5. **`dispatch.test.ts` stubs `OPENAI_API_KEY` to `""`.** Not hygiene — a COST guard. `convex-test`
   RUNS scheduled functions rather than queueing them, so the executive-turn tests genuinely execute
   `internal.dispatch.runResearch`; on any box with the key exported (every box that runs the live
   evals) a unit test would have fired a real, billed, hosted-web-search research run.
6. **`docs/playbooks/business-evaluation.md` was already written by the 15.2 lane**, off this plan's
   uncommitted diff in the shared working tree, complete with a provenance caveat asking 16-06's
   author to verify. It was read against the shipped code, found ACCURATE (including the
   `kind === "memo"` correction), and the caveat was resolved rather than the section rewritten.
7. **`incompleteReason` is NOT threaded into the memo body.** `specialistMemoBody` accepts a
   `reason`, but wiring it through `landSpecialistResult` would change the gap path's landing text —
   which Task 1's done-criteria explicitly forbid. The three-way marker is observable on
   `DispatchResult` today; putting it on the card belongs to whichever plan owns that text.

## Still owed by this plan's siblings

- **16-07** persists the findings to the vault off `runResearch` (the `sources` + `retrievedAt`
  fields exist on `DispatchResult` for exactly that) and wraps the STORED body in
  `researchFindingsFence`. There is deliberately no fence call in `llm.ts` — a memo BODY never
  reaches the model, so there is no re-entry boundary at that seam to fence.
- **16-08** drives `softCutoffMs: 0` for D11's wall-clock row and owns the cost-ceiling row that
  governs a SECOND sequential research dispatch (legitimate once the first run's row flips to
  `proposed`, since the interlock is scoped to the in-flight window by design).
- **16-09**'s `webSearchCallsForThread` join discriminates on `stepKey.startsWith("dispatch:")`,
  written on this path exactly as on the gap path.
