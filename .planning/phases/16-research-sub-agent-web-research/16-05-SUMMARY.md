# 16-05 — SUMMARY

**Plan:** 16-05 (wave 3) — the hosted web-search capability in the ONE governed loop
**Completed:** 2026-07-27
**Requirements:** ACTN-03

## What landed

- **`webResearch` as ONE more key of the ONE tool record** — never a second `generateText`. A
  separate search-only loop would carry `tools:` and fail `dispatchGuard`'s "exactly one
  tool-bearing call site".
- **Built only when granted** (`agentContext.grantWebResearch`, set from
  `toolNames?.includes("webResearch")`) — structural absence, not post-hoc filtering.
- **`invokeTool` guard** — a provider-executed tool has no `execute`; without the guard a raw
  TypeError escaped from a line that reads like an ordinary tool call.
- **Per-call search billing**, counted on `providerExecuted` rather than a tool-name literal.
- **`sources` mapped off the shipped result**, with the §4 boundary stated in code.
- **The research model pin, step budget and wall clock**, all derived from `skillName` at the
  `runSpecialistTurn` seam where the models are already resolved.
- **`truncatedReason: "steps" | "clock"`**, feeding `specialistMemoBody`'s closed reason union.

## The integration detail the plan could not have known

Adding a **provider-executed** tool to the record widened the inferred `TOOLS` into an index
signature, which degraded `ai@7`'s `onToolExecution*` event types to a variant with **no
`toolCall`** — and the CKPT-05 callbacks stopped compiling.

I first tried annotating the callback params; that fails, because the callback must satisfy
`OnToolExecutionStartCallback<TOOLS>`. The correct fix is the one the codebase already uses two
lines above: **make both spread branches the same type** —
`...(grant ? webResearchTool : ({} as typeof webResearchTool))`, the shipped `omitRecipientEdits`
trick. The CKPT-05 callbacks are therefore **byte-unchanged**, which also keeps
`llmRedaction.test.ts`'s §4 scan looking at exactly what it was written against.

## Verification

- Backend full suite: **675/675 across 47 files**
- Backend `tsc`: **zero errors in production `convex/*.ts`** (52-error test-file baseline unchanged)
- `grep -c "openai.tools.webSearch(" convex/llm.ts` → **1**
- `dispatchGuard` / `cockpitTools` / `llmRedaction` / `runCockpitAgent` / `dispatch`: **164/164**
- `node scripts/check-playbooks.mjs` → exit 0

**Mutation-checks, both RED then restored GREEN:**

| # | Mutation | Result |
|---|---|---|
| 1 | derive the soft cutoff UNCONDITIONALLY from the budget | **RED** |
| 2 | `callTimeoutMsFor` collapses to the 45s default | **RED** |

Mutation 1 is the important one. Unconditional derivation makes `45_000 − 60_000` NEGATIVE, and
`elapsed >= negative` is true on the FIRST evaluation — truncating **every** executive turn, every
Growth OS specialist turn and the scripted shim at step 1. A cost floor cannot catch it (a one-step
turn still prices correctly), which is exactly why the plan specified a separate STEP floor.

## Deviations

1. **`packages/cost/src/index.ts` is an explicit re-export allow-list, not `export *`.** The three
   16-02 constants had to be added there too — the typechecker caught it.
2. The plan's `sources` snippet needed a type predicate to narrow `sourceType === "url"` under the
   shipped union.

## Still owed by this plan's siblings

- The research **model-pin assertion** lives in **16-06 Task 3**, not here — `governedDispatch`
  resolves the route through `SPECIALISTS` before the loop runs, so no harness hands
  `runSpecialistTurn` a `skillName` literally. The CODE is here; the ASSERTION is there.
- The `softCutoffMs` clock-truncation row and the N-search cost row need a scripted **specialist**
  turn (`__runSpecialistWithScript`), which is 16-06's harness.
