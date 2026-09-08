# Phase 43 — Batch content and the content queue (G10)

**Closed 2026-09-08.** Head `1b20a00`, deployed to production.

**Record shape, stated up front:** this phase has ONE summary rather than one per plan, because it
was executed commit-by-commit from `.planning/design/system-audit-2026-09-03-merged.md` §5 and
never had `43-0N-PLAN.md` files. Writing seven per-plan SUMMARYs would misrepresent how the work
actually happened. Each commit below carries its own full reasoning in its message; this file is
the index and the phase-level judgement.

## What shipped

| Commit | Plan | What |
|---|---|---|
| `67dd736` | 43-01 | a fan-out is ONE plan in flight, and its card is not titled by a random worker |
| `30151df` | 43-01b | a refused reel is not a memo to approve; an abandoned chat is not a plan in motion |
| `a8001e8` | 43-02 | `draftDocument` on the money rail — gated and metered before a batch multiplies it by 15 |
| `690dfcd` | 43-03 | a channel is a TERMINAL the row can reach, not a default it inherits — **ADR-042** |
| `002e938` | 43-04 | mint a content batch; stop a produced-nothing worker landing someone else's business gap |
| `484272d` | 43-06 | the vault arm — an unscheduled variant means publish NOW, never publish never |
| `89b6a4e` | 43-05 | the batch door (`createVariants`) + the body that teaches it |
| `831738e` | — | correct a false claim in the durable record (see "What this phase disproved") |
| `1b20a00` | — | re-arm the promotion gate a docs commit de-armed |

43-06 shipped BEFORE 43-05 deliberately: ADR-042 D3 requires the `schedulable` flip and the arm
that honours it in one commit, and the tool that mints work for that arm is safest landing last.

## The shape G10 now has

A content batch is a ROOT plan on `channel: "vault"` with up to `MAX_FAN_OUT` variant CHILDREN,
one approval card for the whole batch. Approve arms the children that carry a `sendAt` and
PUBLISHES the ones that do not; cancel walks `by_parent` and disarms every live child. The root
takes `scheduled` while any child is armed, and files no document of its own — its body is already
the assembly of its children.

## What this phase disproved — the finding worth carrying forward

**A gated skill withholds INSTRUCTIONS, never REACHABILITY.** `42-03-SUMMARY.md` and `STATE.md`
both said a tool behind the `cockpit-agent` eval gate is "registered, tested and INVISIBLE to the
model until the per-deployment eval gate runs". That is FALSE. `grantsFor` sets
`dispatch: executive` where `executive = toolNames === undefined`, and an executive turn receives
the UNFILTERED tool record — so a registered dispatch tool carries its NAME, DESCRIPTION and JSON
SCHEMA into every executive turn whatever the active body says. The proof is a SHIPPED test, not a
reading: `toolRegistrySnapshot.test.ts`'s "executive via runAgentLoop" array builds that key set
with no skill body anywhere in the call.

`dispatchTeam` has therefore been present-but-untaught in PRODUCTION since 42-03. Both records were
corrected in `831738e`, struck through rather than silently rewritten. **The rule this yields:**
anything the model must not get wrong belongs in the tool's own `description`; the body carries the
routing judgement. `createVariants` was built that way.

It mattered because it was the premise 43-05 was being designed under — which is exactly how a
wrong durable fact does damage: a later session inherits it and builds on it.

## Defects found in this phase's own earlier commits

- **43-04's drafter routing** (fixed in 43-05). `runVariant` shipped a two-way ternary
  (`sheet` or long-form) while `createDocument` used the three-way, so `form: "short"` — the
  PRIMARY case, since versions of a post or an ad headline are short-form — would have drafted
  every variant with the long-form body, and the `skillVersions` lookup repeated the ternary so an
  eval pin on `content-drafter` could never reach a variant. Nothing was red: `document-drafter` is
  a legal member of the closed union it feeds. `runVariant` had NO behaviour coverage, which is why
  it shipped. Now one predicate (`drafterSkillFor`) with a source tripwire refusing a second copy.
- **A money predicate answering a pipeline question**, third instance recorded in this repo.
  `startContentBatch` returns `requested: a.variants.length` — the RAW list length — while
  `legalVariants` drops blanks and dedupes, so `workerCount < requested` is equally true when the
  MODEL listed a duplicate. Copying dispatchTeam's budget clause would have been a money claim the
  return value cannot support.
- **A duplicated playbook block** shipped in `002e938` (a script re-run after a partial failure),
  removed in `484272d`.

## Owner-side, and the first item BLOCKS the rest

1. **Eval fixture 33 cannot pass as written — root-caused this phase, see
   `43-FIXTURE-33-FINDING.md`.** It is not a stochastic research-lane flake. The
   `declaredUnsupported` leg of `evidenceVerdict` is provably dead code, and fixture 33 asserts a
   value the code computes with exactly the counter-based rule the fixture's own description says
   cannot express it. **This needs an owner decision before any activation is possible.**
2. The full pinned gate run, dev then prod: `pnpm eval:golden -- --skill cockpit-agent@N`. `N` is
   readable only at `/ops` in a signed-in browser (`candidatesForReview` is an `ownerQuery`).
   Candidates STACK: one Activate flips the Phase 40 canvas edits, the ADR-040 `dispatchTeam`
   section AND `createVariants` together, and the 46-case suite exercises none of them.
3. `npx convex env set --prod RELIABILITY_SWEEP_ARMED 1`; the G19 activations; the QuickBooks
   runbook (28.2); the pack gate run for `pack-offer-and-lead-plan`.

## Named debt, carried deliberately

No eval fixture and no assertion key exists for `dispatchTeam` or `createVariants`, against
`run-eval-golden.mjs`'s own rule that a tool with no assertion key is a tool the set certifies
nothing about. Not fixed here because a 47th case changes `casesHash`/`caseCount` and RETIRES every
`AGENT_EVAL_SUITE` evidence row — including the evidence the jammed gate is trying to earn — and an
assertion key with no fixture using it is unfalsifiable. The two must land together, sequenced
AFTER fixture 33.

## Verification at close

backend 4096 (2111 + 1985, 0 FAIL — shard 1 exits 1 while green on Windows, baselined by failure
count), core 1533, contracts 123, web 904 + 2 skipped (the two unrun files are the pre-existing
absent `jsdom` package). `tsc` exit 0 in backend, contracts, core and web, each read directly and
never through a pipe; biome clean over 899 files, exit read the same way. Across the phase, 20+
mutations verified RED and restored.
