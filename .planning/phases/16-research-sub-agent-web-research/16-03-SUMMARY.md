# 16-03 — SUMMARY

**Plan:** 16-03 (wave 3) — the `research` route, its capability grant, the provenance fence, ADR-010
**Completed:** 2026-07-27
**Requirements:** DISP-02

## What landed

**The route + the grant (SC#1's containment in its entirety).** `research` joins
`SPECIALIST_ROUTES`; `RESEARCH_TOOLS = ["searchVault", "webResearch"]` and nothing else. The
research specialist's whole action surface is *search the vault* and *search the web* — an
instruction injected into a fetched page reaches an agent structurally incapable of sending,
writing, or moving a plan row, so at most it influences a proposal that still stops at the human
Approve gate.

**The D3 comment correction.** `specialists.ts:10` asserted *"exactly the routes `diagnose()`
emits"* — an invariant this phase deliberately relaxes. Corrected **in place, not deleted in
silence**: a reader who found it simply removed could not tell whether it was relaxed on purpose or
lost by accident.

**ADR-010** records the shape: `SPECIALIST_ROUTES` is what the SYSTEM can dispatch; what
`diagnose()` emits is a strict SUBSET. Research is not a gap remedy — it is how you find out what
the constraint *is*. Widening `diagnose()` is a separate decision needing its own ADR.

**`researchFindingsFence`** in the same file (no new module — it is specialist output shaping, and
a new file would need its own `watch.json` registration for one function). **`specialistMemoBody`**
gains a closed `reason?: "cost" | "steps" | "clock"` union with three distinct sentences.

## The three shipped assertions this plan had to update — none is a weakening

| Assertion | Change |
|---|---|
| `SPECIALIST_ROUTES` equality + its title claiming "three" | Added `"research"`; renamed the test. The sibling `Object.keys(SPECIALISTS).sort()` line then holds for free. |
| the hand-maintained `constFor` map | Added `"research-specialist": "RESEARCH_SPECIALIST_SKILL"`. This is the live cross-package bind that makes 16-04 a wave-2 prerequisite — the test reads `packages/contracts/src/skill.ts` **off disk**. |
| whole-registry tool-set equality | Added the `["research", ["searchVault","webResearch"]]` row. **Kept as whole-registry EQUALITY, not relaxed to a per-route `toContain`** — that equality is precisely why a write tool added to ANY specialist fails here (ADR-007), and the property survives this phase intact. |

Added on top: an explicit **deny-list** assertion (11 forbidden tools) so SC#1's intent survives a
refactor of the equality, plus a non-vacuity line pinning the grant, plus a `research` resolution
test.

## Mutation-checks — all four run, RED observed, restored GREEN

| # | Mutation | Result |
|---|---|---|
| 1 | add `"proposePlan"` to `RESEARCH_TOOLS` | **RED** (equality *and* deny-list) |
| 2 | remove the `sourceCount === 0` branch | **RED** (insufficient-evidence assertion) |
| 3 | collapse `clock` onto the `steps` sentence | **RED** (three-way distinctness) |
| 4 | remove the `replaceAll` breakout guard | **RED** (exactly-one-closing-tag) |

Baseline GREEN before, GREEN after restore.

## D5-CORRECTED — what the fence deliberately does NOT claim

The **retrieved page text cannot be fenced.** `openai.tools.webSearch` is provider-executed:
OpenAI reads the pages server-side and that text never traverses our process. There is no string
for us to wrap, and **a test asserting "retrieved text is fenced" would PASS because the text is
ABSENT, not because it is contained** — so no such test exists, by design.

What the fence covers is the specialist's **output** as it lands in the stored vault document.
After D9-REVISED research runs on the async memo terminal, so the prose never re-enters the
executive loop inline (`buildAgentContext` renders a memo plan as `Body drafted: yes/no`). The one
place web-derived text *does* re-enter a model context is a later `searchVault` retrieval of the
stored doc — which is exactly why the fence belongs **in the stored text**, where it survives
chunking, rather than at a loop boundary that no longer exists. Called by 16-07's `persistFindings`.

## Verification

- `@pikar/core` full suite: **307/307 across 17 files** (`specialists.test.ts` 42/42, up from 36)
- `@pikar/core` `tsc`: exit 0
- Backend full suite: **669/669 across 47 files**
- Backend `tsc`: **zero errors in production `convex/*.ts`** — the documented 52-error test-file
  baseline unchanged
- `node scripts/check-playbooks.mjs`: exit 0

## Deviations from the plan

None material.

**Tooling note for the next executor, not a plan defect:** patching these files via a heredoc'd
inline script silently corrupts `\n` escapes — the harness collapses `\\` to `\`, so a Python
string meant to contain a literal backslash-n gets a real newline and the match fails. Write the
patch script to a file and run it, or use the editor. Cost a debugging cycle here.

## What this unblocks / still owes

- **16-05** can now pin a research-only model and step budget from `args.skillName`.
- **16-06** reads `sources`/`webSearchCalls` off `DispatchResult`; the route and `stepTool`
  (`dispatchResearch`) now exist, and 16-01 already put the literal in the schema union, so
  `dispatch.ts`'s `_stepTools` compile-bind accepts it.
- **16-07** is the caller of `researchFindingsFence` — it is exported and tested but has **no
  caller yet**, which is expected at this wave.
