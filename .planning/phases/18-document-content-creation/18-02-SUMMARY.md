---
phase: 18-document-content-creation
plan: 02
subsystem: schema-registration
tags: [schema, trace-parity, provenance, vault, workspace-cards]
requires: []
provides:
  - "agentSteps.tool literal `createDocument` (the trace-registration half that lives in schema.ts)"
  - "cards.tsx VERB entry `createDocument` (the human-copy half)"
  - "vaultDocuments.origin — the agent/agent_promoted provenance + deferred-promotion discriminator"
  - "vaultSources.role/snippet/form — the Output card's three optional fields on the existing grounding table"
affects:
  - "18-04 (isolation + retrieval-exclusion assertions can now be written against `origin`)"
  - "18-05/18-06 (the createDocument tool's step insert can no longer throw)"
  - "18-07 (the Output card reads role/snippet/form — ZERO new Convex queries)"
  - "18-10 (blueprint drift filter reads `origin`)"
tech-stack:
  added: []
  patterns:
    - "Additive-optional schema evolution: four v.optional fields, zero tables, zero indexes, zero migrations, zero backfill"
    - "Closed-union trace registration landed as ONE commit with its VERB counterpart"
key-files:
  created: []
  modified:
    - packages/backend/convex/schema.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
decisions:
  - "resetPlan and recordScorecardAnswer left deliberately trace-less; recorded in a ponytail note, deferred to 18-09's gate"
  - "The ponytail note names both tools as BARE identifiers — the file's own v.literal idiom would inject phantom literals into traceParity's regex"
metrics:
  duration: ~50 min
  completed: 2026-08-01
---

# Phase 18 Plan 02: Schema & Trace Registration Surfaces Summary

Landed the four additive-optional schema surfaces (`agentSteps.tool += createDocument`,
`vaultDocuments.origin`, `vaultSources.role/snippet/form`) plus the matching workspace VERB entry —
Registration Checklist rows 1, 2, 13, 14 — with zero tables, zero indexes and zero migrations.

## What Shipped

**Task 1 — the trace-registration pair (`476d4c5`).** `v.literal("createDocument")` appended to the
closed `agentSteps.tool` union and `createDocument: ["Writing it up…", "Saved it to your vault"]`
added to `cards.tsx`'s VERB map, in ONE commit. Either half alone is RED.

**Task 2 — provenance + Output-card fields (`efc8a82`).**
`origin: v.optional(v.union(v.literal("agent"), v.literal("agent_promoted")))` on `vaultDocuments`,
and `role` / `snippet` / `form` on `vaultSources`. All four optional ⇒ every row that exists today
stays valid untouched.

## Verification

| Gate | Result |
| --- | --- |
| `vitest run convex/traceParity.test.ts` | **2/2 green** |
| `vitest run convex/traceParity.test.ts convex/vault.test.ts` | **30/30 green** |
| `turbo run typecheck --filter=@pikar/backend --force` | **150 errors, ALL in `convex/*.test.ts`, ZERO in production convex source — DELTA 0** |
| `convex/onboarding.test.ts` (isolated) | 24/24 green |
| `git diff --stat` for this plan | exactly 2 files |

### THE TYPECHECK BASELINE EVERY LATER PHASE-18 PLAN GATES AGAINST: **150**

Re-measured at execution start (2026-08-01, before any edit) and re-measured after both tasks:
**150 both times, zero non-test errors both times.** Gate on the DELTA, never on absolute clean.
⚠ Never use bare `pnpm typecheck` — turbo's `typecheck` task declares no `inputs`, so its cache
restores a stale pass without running `tsc`.

### traceParity non-vacuity, checked explicitly

Set equality passing is *also* consistent with both halves being absent, so the extractors were run
directly against both files:

```
literals 27  hasCreateDocument true
verbs    27  hasCreateDocument true
phantom resetPlan in literals? false   recordScorecardAnswer? false
```

26 → 27 on both sides. The `>= 22` floor at `traceParity.test.ts:57-58` was **not** bumped and
`traceParity.test.ts` has **zero diff**.

## Fresh symbol → line map (taken at `cc05d21`, 2026-08-01)

Line numbers in all Phase-18 plans were planning-time. These are current. **Anchor on the symbol,
not the number** — `llm.ts`, `skills.ts` and `blueprint.ts` are all live foreign-lane files.

| File | Symbol | Line |
| --- | --- | --- |
| `packages/backend/convex/skills.ts` | `export const seedSkills` | 278 |
| `packages/backend/convex/skills.ts` | `const seeds = [` | 281 |
| `packages/backend/convex/llm.ts` | `type AgentSmokeOp` | 2449 |
| `packages/backend/convex/llm.ts` | `const SMOKE_OP_TOOL` | 2535 |
| `packages/backend/convex/llm.ts` | `export const draftDocument` | 3030 |
| `packages/backend/convex/llm.ts` | `DOCUMENT_DRAFTER_SKILL` (getSkillVersion branch) | 3049 |
| `packages/backend/convex/llm.ts` | `DOCUMENT_DRAFTER_SKILL` (getActiveSkill branch) | 3052 |
| `packages/backend/convex/blueprint.ts` | `const BLUEPRINT_KIND` | 81 |
| `packages/backend/convex/blueprint.ts` | `async function unincorporatedFor` | 553 |
| `apps/web/.../workspace/cards.tsx` | `const VERB` | 1139 |
| `apps/web/.../workspace/cards.tsx` | `function SourceCard` | 1265 |
| `packages/backend/convex/schema.ts` | `vaultSources: defineTable` | 345 |
| `packages/backend/convex/schema.ts` | `vaultSources.role` (new) | 356 |
| `packages/backend/convex/schema.ts` | `tool: v.union(` | 477 |
| `packages/backend/convex/schema.ts` | `v.literal("createDocument")` (new) | 544 |
| `packages/backend/convex/schema.ts` | `vaultDocuments: defineTable` | 711 |
| `packages/backend/convex/schema.ts` | `vaultDocuments.origin` (new) | 748 |

⚠ `schema.ts`'s numbers moved ~15 lines from the plan's anchors *before* this plan touched it —
foreign lanes were editing it. Confirmation that anchoring on symbols was the right call.

## `resetPlan` / `recordScorecardAnswer`: deliberately left trace-less

Both are live tools with no literal in `agentSteps.tool`, so they are silently trace-less in
production today (18-RESEARCH.md Pitfall 2 / Open Question 2). **Phase 18 did NOT fix them**, per the
planner's recorded decision — 2 foreign literals plus 2 VERB copy strings Phase 18 did not design,
inside a freeze-sensitive block, and CLAUDE.md §8 forbids unrequested scope. The fix is recorded for
the owner in 18-09's gate.

The required `// ponytail:` note is in place next to the new literal, and **both tool names are
written as bare identifiers**. This is load-bearing, not stylistic: `traceParity.test.ts`'s
`schemaToolLiterals()` runs `/v\.literal\("([^"]+)"\)/g` over the whole union slice *including
comment lines* (`traceParity.test.ts:38-41`), so writing the note in the file's own idiom would have
injected two phantom literals with no VERB entry and turned RED the exact test this task gates on —
for a comment. The comment says so, so the next editor does not "tidy" it into the idiom. Verified
above: neither name appears in the extracted literal set.

## Deviations from Plan

**None.** Both tasks executed exactly as written. No auto-fixes were needed.

Two things worth recording that are *not* deviations:

1. **A transient typecheck reading of 152.** One measurement mid-run returned 152 (delta +2, both in
   test files). Two consecutive re-runs immediately after returned 150 / 150, and two foreign
   commits (`18-01`, `18-03`) landed in this tree during that window. It was cross-lane interference,
   not this plan. Delta 0 stands.
2. **The full backend suite is unreliable as a gate in this tree right now.** `pnpm --filter
   @pikar/backend test` (~5 min) returned 11 failed / 859 passed on one run and 1 failed / 868 passed
   on the next, with a `convex-test` storage-hash unhandled error in the first. The single remaining
   failure (`onboarding.test.ts > §4.2 tier`) passes **24/24 in isolation**. Four lanes commit into
   this one working tree, and a 5-minute vitest run transforms a module graph that changes underneath
   it — the exact hazard STATE.md's shared-tree discipline section warns about. The two files this
   plan touches are gated by their own suites, both green.

**Out of scope, not fixed:** `pnpm exec biome check` reports errors on both edited files, but an
untouched control (`convex/vault.ts`) reports the same class of error — whole-file CRLF formatter
noise plus two pre-existing `cards.tsx` lint findings (`useHookAtTopLevel`, `noArrayIndexKey`) far
from the edits. Pre-existing and repo-wide; per the scope boundary, not touched.

## Notes for the Next Plan

- **`vaultSources` is now DUAL-PURPOSE.** A grounding row has no `role`; a created row carries
  `role: "created"`. Any read that wants the Output card must FILTER on `role === "created"` — the
  table is append-only per thread and `by_thread` is latest-wins, so a bare `.first()` will return
  whatever the last turn wrote. 18-RESEARCH.md Pattern 2b marks this filter load-bearing.
- **`vaultDocuments.kind` stayed `v.string()`** (not narrowed to a union), as instructed.
- **No `text`/`label`/`detail` field was added to `agentSteps`, and `agentSteps.count` remains
  declared-and-unwritten** — the CLAUDE.md §4 hole the closed union closed stays closed.
- `schema.ts` is watched by **no** playbook. It went unprompted by the Stop hook and was tracked
  manually; there is no playbook to bump for this plan.

## Self-Check: PASSED

- `packages/backend/convex/schema.ts` — FOUND, contains `createDocument`, `origin`, `role`,
  `snippet`, `form`
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — FOUND, contains `createDocument:`
- Commit `476d4c5` — FOUND
- Commit `efc8a82` — FOUND
