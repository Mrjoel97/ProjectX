# 23-03 SUMMARY — the model can now draft a skill, and still cannot activate one

**Status:** complete. **Cost:** $0.00 (scripted model seam, no paid call). **Date:** 2026-08-18.
**Gate deviation:** inherited from `23-00-GATE-2026-08-18.md`.

## What landed

One tool, `authorSkillCandidate`, in `buildCockpitTools`. One grant, `grantSkillAuthoring`. One
trace literal in two places. Nothing else.

### The grant

Derived in `runAgentLoop` from **`toolNames === undefined`**, never from
`toolNames.includes("authorSkillCandidate")`. An allow-list is a REQUEST from the caller; reading
one would let a specialist ask for the capability by name and be given it.

**Kept SEPARATE from `grantDispatch`** even though both derive from the same expression today.
Dispatching a specialist spends money; authoring a skill changes what every future turn is told to
be. One flag would mean the next context that legitimately needs one silently receives both. Tested
in both directions: dispatch-without-authoring and authoring-without-dispatch each yield exactly one
of the two key sets.

### Structural absence, not a filter

The closure is built only inside the granted branch (`grantSkillAuthoring && threadId &&
rootRequestId`), in the same conditional-spread / one-type-both-branches idiom as
`dispatchResearch`. A withheld-but-CONSTRUCTED closure stays reachable through `invokeTool`; a
never-constructed one does not exist to reach. **No lineage ⇒ no tool** — asserted for a missing
`threadId` and a missing `rootRequestId` independently.

### The model's surface

`{name, authoredBody}`, asserted by **key-set equality** on the JSON schema, `required` both,
`additionalProperties: false`, and `name`'s enum **sourced from `AGENT_AUTHORABLE_SKILLS`** rather
than re-listed (a second copy is how the model-visible set and the server check drift apart).
tenant/thread/turn are injected from the trusted envelope.

The RETURN is inert: ids, version, status, awaiting-review copy. Refusals come back
conversationally (`AGENT_CANDIDATE_PENDING`, `AGENT_SOURCE_TURN_CONFLICT`, `NOT_AGENT_AUTHORABLE`,
the adaptation-size errors), never as a throw — the dispatch-refusal precedent.

### Trace

`v.literal("authorSkillCandidate")` on `agentSteps.tool` **and** the `VERB` entry in `cards.tsx`, in
the same commit, because `traceParity.test.ts` asserts set equality both ways and because a missing
literal makes `agentSteps:record` throw inside an AI-SDK callback the SDK silently swallows.

Verb: **"Drafting a skill update… / Skill update ready for review"** — never "Learned" or "Updated
how I work". BRAND §1 forbids claiming an action that did not happen, and activation needs a passing
eval plus the owner's click.

## Real-loop evidence, not shim evidence

The candidate test drives `__runCockpitAgentWithScript → runAgentLoop → buildCockpitTools` — the
production path — **not** `__invokeCockpitTool`, which bypasses the loop and is exactly how a
disconnected tool plane once looked healthy for a whole phase
(`clock-plane-dead-in-production`). The persisted row's `sourceThreadId`/`sourceTurnId` are asserted
against the ids the LOOP was given, so a tool that failed to thread lineage produces a visibly wrong
row rather than a passing test.

The specialist test asserts **the absence of a row**, not a rejection: ai@7 does not necessarily
throw out of the loop on an unknown tool name, and asserting on the error would make the test pass
for a reason unrelated to the capability boundary. Non-vacuity comes from the sibling test, where
the identical script under the Executive grant DOES write a row.

## Mutation evidence (all executed and restored)

| Mutation | Result |
|---|---|
| Spread the tool unconditionally | **3 red** — both grant-absence tests + the specialist real-loop test |
| Derive the grant from `toolNames.includes("authorSkillCandidate")` | **1 red** — the specialist obtains it by asking |
| Add an `activateTenantCandidate` call inside the tool | **1 red** — `the authoring tool region reaches activateTenantCandidate` |

## Two things worth not re-learning

1. **The forbidden-word region scan matched my own comment.** The scan bans `fixture` inside the
   tool region; a comment saying "never a fixture" tripped it. The scan is worth more than the
   phrasing, so the comment was reworded rather than the check weakened.
2. **`setup()` in `runCockpitAgent.test.ts` registers only the rate-limiter.**
   `publishAgentCandidate` writes an audit row, and `audit.log` mirrors into the `auditCounts`
   aggregate — without the component the mutation throws INSIDE the tool, the SDK records an error
   step, and the loop carries on with no row and no visible failure. A local `authoringSetup()`
   registers both. This is the same swallow class the trace literals exist to prevent, one layer up.

## Deliberately NOT done

- **No needle-scan added to `llmRedaction.test.ts`.** The plan named it, but the equivalent scan
  already runs in `runCockpitAgent.test.ts` against the REAL loop over `agentSteps` + `audit` +
  `deadLetters`, which is strictly stronger than a shim-level scan. A second copy would be duplicate
  coverage, not more coverage. `llmRedaction.test.ts` is green and unmodified (61 passed); none of
  its structural pins touch the new tool.
- **No cockpit skill body changed, no candidate seeded.** The usage guidance lives in the tool
  description; the hard boundary lives in code.

## Ceiling

**No live selection behaviour is claimed.** Nothing proves a real model reaches for this tool only
when explicitly asked — that rule lives in the tool description, which is guidance, not a guarantee.
The guarantee is that the tool cannot activate anything. Plan 23-06's browser gate owns the
selection question and what the user actually sees in the trace.

## Measured

| Check | Result |
|---|---|
| `cockpitTools` + `runCockpitAgent` + `traceParity` + `llmRedaction` + `skills` | **344 passed** / 5 files |
| `tsc --noEmit` backend | **0 errors** |
| `tsc --noEmit` web | **0 errors** |
| `biome check` on all five touched files | 0 errors (96 warnings, all pre-existing) |
| `node scripts/check-playbooks.mjs` | exit 0, no block |
| `git diff --check` | exit 0 |

## Shared-tree note

`schema.ts` was again staged with ONLY the Phase-23 literal; the 17-08 lane's uncommitted
`cancelKind: "refused"` hunk was kept out and restored to the working tree.

**`agent-runtime.md` and `cockpit.md` COULD NOT be separated the same way.** Both carry uncommitted
17-08 prose, and this plan's own "Last verified" edits anchor ON that prose. Leaving them out would
break CLAUDE.md §9 for this commit, so they are committed WITH the 17-08 lane's playbook text — that
text is the calendar lane's work, not Phase 23's, and the commit message says so.

## Next

`23-04` — the eval fixtures: the adversarial held-out cases (self-activation, capability escalation,
embedded instruction, retry) that the authoring agent never sees, plus the runner wiring.
