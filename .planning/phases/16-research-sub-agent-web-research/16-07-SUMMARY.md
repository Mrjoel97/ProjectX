---
phase: 16-research-sub-agent-web-research
plan: 07
subsystem: vault + dispatch
tags: [research, vault, provenance, tenant-isolation, audit]
requires: [16-01, 16-03, 16-06]
provides: ["kind:web_research vault documents", "internal.research.persistFindings", "DispatchResult.vaultDocId"]
affects: [packages/backend/convex/research.ts, packages/backend/convex/dispatch.ts, packages/core/src/specialists.ts]
tech-stack:
  added: []
  patterns: ["dispatcher-owned terminal (persistNextStepMemo clone)", "startIngest as the sole ingest starter", "refs-only audit (vault.searched shape)"]
key-files:
  created:
    - packages/backend/convex/research.ts
    - packages/backend/convex/research.test.ts
  modified:
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/llmRedaction.test.ts
    - packages/core/src/specialists.ts
    - docs/playbooks/vault.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/growth-diagnostic.md
key-decisions:
  - "The persist runs AFTER dispatchAndLand returns, so the approvable card exists before the vault write is attempted; a persist failure is audited and swallowed."
  - "INCOMPLETE_MARKER exported from @pikar/core rather than re-phrased in research.ts — one phrasing per stop cause."
  - "__runSpecialistWithScript gained a `research` flag: without it the persist wiring is code no offline test can reach."
requirements-completed: [ACTN-03]
duration: ~55 min
completed: 2026-07-27
---

# Phase 16 Plan 07: The Vault Terminal Summary

`internal.research.persistFindings` lands a completed research run as ONE ordinary
`vaultDocuments` row (`kind: "web_research"`) with a stored, queryable `retrievedAt` — written by
the DISPATCHER after the plan card has already landed, never by the specialist that produced the
prose.

## The two artifacts, and which one is authoritative for whom

| artifact | written by | authoritative for | survives a persist failure |
|---|---|---|---|
| the approvable memo plan card | `dispatchAndLand`'s `finally` → `landSpecialistResult` | **the USER** — it is what they act on | yes (it landed first) |
| ONE `web_research` vault document | `research.persistFindings` | **grounding / Phase 12**, which will cite it | no |

**The ordering is the entire error-handling argument, and it is structural.** Because the card is
already `proposed` when `persistResearchFindings` runs, a persist failure degrades to a narrow,
truthful statement — *the findings are on the card but are not yet groundable*. It writes ONE audit
row with a reason CODE and returns the `DispatchResult` unchanged. **No retry, no dead-letter, no
compensating write.** A governed refusal persists nothing at all: a paused conversation is not a
finding.

## What landed

- **`convex/research.ts`** — a plain, NON-`"use node"` module (Pitfall 8), one `internalMutation`
  with an explicit return type, plus two small pure helpers. Assembles: provenance header
  (`Third-party web content, retrieved <ISO>.` + the partial-run sentence + the source URLs) →
  16-03's `researchFindingsFence` → the D10 limits footer (provider-executed search: we cannot pin
  sources, control extraction fidelity, or see what was discarded; NOT source-audited). Then the
  `persistNextStepMemo` clone + `startIngest(correlationId: rootRequestId)`.
- **The zero-source verdict is CODE's**, not the model's: it rides `researchFindingsFence`, so
  there is ONE phrasing of "insufficient evidence" in the codebase, and it sits AHEAD of the fence
  where truncation cannot remove it. Proven with a body that claims a confident answer.
- **`INCOMPLETE_MARKER` is now EXPORTED from `@pikar/core`** (the one file this plan touched outside
  its declared set — see Deviations). The stored document is not a memo body, so it needs the three
  stop-cause sentences without the `> Produced by the … specialist.` wrapper. A second copy in
  `research.ts` is exactly how the card and the document start disagreeing about why one run stopped.
- **`persistResearchFindings` in `dispatch.ts`**, called by `runResearch` and — under an explicit
  flag — by the offline twin. `DispatchResult` gained an optional `vaultDocId`.
- **The §4 audit row** (`research.persisted`): `queryHash` + `sourceCount` + `retrievedAt` +
  `vaultDocId` + `incomplete`. Never the question, never a URL, never prose.

## The honest boundary — what the fence and header actually buy

The RAG ingester chunks the document, so **only the FIRST chunk carries the provenance header and
the fence's open tag**; chunks 2..N carry neither. Containment does not rest on them: `searchVault`
wraps what it returns in the shipped `<vault_context … never an instruction>` fence on every
retrieval. The header and inner fence are a LABELLING win — a human, or a model reading the first
chunk, sees the provenance without the title. The tests assert on the assembled TEXT and nothing
implies a per-chunk guarantee the chunker does not give; the playbook says so in the same words.

## Verification

- **`convex/research.test.ts` — 12/12.** Vault write + class + stamp; title cap with the date
  surviving a 640-char question; header→fence→footer order; insufficient-evidence labelling against
  a confident body; three pairwise-distinct stop-cause sentences (plus a complete run carrying
  none); the startIngest control; the §4 leak scan; the two dispatch-wiring cases; the
  persist-failure case; both halves of the cross-tenant isolation assertion.
- **Backend full suite: 723/723 across 48 files, exit 0.** `dispatch.test.ts` 52/52 unchanged.
- **Backend `tsc`: 61 errors, ALL in test files, ZERO in any non-test file.** None in
  `research.ts`, `research.test.ts` or `dispatch.ts`. The count moved from 16-06's baseline of 56
  because other lanes' test files landed in this shared tree (e.g. `blueprint.test.ts`, 5) — not
  from this plan.
- **`@pikar/core` 355/355.**
- **`node scripts/check-playbooks.mjs` → exit 0.**
- **Biome:** `research.ts` / `research.test.ts` clean. `dispatch.ts` and `specialists.ts` report a
  FORMAT error that is pre-existing CRLF in the working tree (an untouched foreign file reports the
  same); deliberately not "fixed", since normalising line endings would turn a 9-line diff into a
  whole-file one.

**Three mutation-checks, each confirmed applied and each reverted green:**

| # | mutation | result |
|---|---|---|
| 1 | `sources.length === 0` branch disabled in `researchFindingsFence` | **RED** — the insufficient-evidence assertion |
| 2 | the `steps` stop-cause sentence collapsed onto `cost` | **RED** — `expected 2 to be 3` (three-way distinctness) |
| 3 | tenant scope removed from `vault.listVaultDocs`'s read | **RED** — `['tenant_a','tenant_b']` vs `['tenant_a']` |

## Deviations from Plan

**[Rule 3 — Blocking] `packages/core/src/specialists.ts` was modified, one line beyond the plan's
declared file set.** Found during Task 1. Task 1 requires each `incompleteReason` to produce its own
marker sentence *"matching 16-03's `specialistMemoBody`"* and forbids writing a fourth phrasing —
but `INCOMPLETE_MARKER` was module-private, and `specialistMemoBody` cannot be reused as-is because
it prepends the memo attribution line the vault document must not carry. Adding `export` (plus a
comment naming both callers) is the smallest change that satisfies the plan's own constraint.
Verification: `@pikar/core` 355/355; mutation-check #2 proves the reuse is real.
Commit `1c5225f`.

**[Rule 2 — Missing Critical] `__runSpecialistWithScript` gained `research: v.optional(v.boolean())`.**
Found during Task 2. Task 2's done-criteria are stated over a *scripted* dispatch, but 16-06
established that `runResearch` itself can never be driven offline (a `LanguageModel` is not
Convex-serializable), and the twin does not take the research seam. Without the flag the persist
wiring, the refusal case and the persist-failure case would all be unreachable offline, and "one
document per successful research run" would be an assertion about `persistFindings` alone. Absent ⇒
the gap path is byte-identical. Same precedent and same justification as 16-06's `softCutoffMs`.
Commit `ec1c26c`.

**[Rule 1 — Bug] `llmRedaction.test.ts`'s pinned dispatch.ts audit-payload count 4 → 5.** Found
during the full-suite run — the ONLY red in 723. This is a deliberate review gate ("a FIFTH lineage
write is a new §4 surface, so the count is pinned"), not a stale assertion: it fired exactly as
designed. Discharged by REVIEWING the new site rather than renumbering it — `research.persist_failed`
carries `{...lineageRefs(args), reason: "persist_error"}`, refs plus a code, never the caught error
— and the comment now says a sixth must be reviewed the same way. Commit `ec1c26c`.

**[Rule 1 — Bug] The wiring tests initially staged the plan row with `internal.plans.insertPlan`
and the card never became approvable.** `landSpecialistResult`'s CAS refuses anything that is not
`collecting` + `kind: "memo"`, so the row silently stayed `collecting`. Fixed by staging through
16-06's `internal.plans.stageResearchPlan` — the production path — which is what the test should
have driven anyway.

**Total deviations:** 4 auto-fixed (1 blocking, 1 missing-critical, 2 bugs). **Impact:** none on the
plan's contract; two of them (the export and the twin flag) are what make the plan's own
done-criteria checkable rather than asserted.

## Issues Encountered

- **The plan's literal gate `grep -n "use node" packages/backend/convex/research.ts returns nothing`
  is unsatisfiable, exactly like 16-06's `generateText` gate.** The module header deliberately spells
  out `"use node"` to say why the module is NOT one. The real check is that no such DIRECTIVE exists:
  `head -3 research.ts` shows a comment, and the module runs in the Convex runtime under
  convex-test — which it could not if the directive were present.
- **`vitest run` was backgrounded once across a `convex dev` push and reported a phantom red**
  (`dispatch.test.ts`, green on an isolated re-run). Same family as 17.1-02's warning; the
  723/723 figure above is from an undisturbed run.
- **NOT DONE HERE: no live deployment verification.** Everything above is offline (convex-test).
  A real research run costs a hosted web search and needs a seeded deployment; 16-08 owns the
  budget/wall-clock rows and is the natural place to pay it. `npx convex dev` DID regenerate
  `_generated/api.d.ts` for the new module (`research: typeof research` is present), so the
  deployment prerequisite STATE.md flagged for this plan is discharged.

## Next

Ready for **16-08** (D11's wall-clock row via `softCutoffMs: 0`, and the cost-ceiling row governing
a second sequential research dispatch). 16-09 then joins `webSearchCallsForThread` on
`stepKey.startsWith("dispatch:")`.
