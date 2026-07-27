# 16-01 — SUMMARY

**Plan:** 16-01 (wave 1) — the Lane-R half of the Stage-1 shared-union freeze
**Completed:** 2026-07-27
**Requirements:** DISP-02, ACTN-03

## The two questions this plan's `<output>` block requires answering

**1. Did a Stage-1 freeze commit already exist on `main`? — NO, and none will.**
The joint freeze was formally RESOLVED away on 2026-07-27 (`22c7bb0` on `main`, recorded in
`.planning/PARALLELIZATION.md`). The freeze is **absorbed into the lanes and serialized through
`main`** — `16-01 <freeze_contract>` bullet 2, the Phase-15 precedent. The property that matters
is **serialization, not single-commit-ness**: no two lanes may edit a shared union concurrently.
A later reader must **not** go hunting for a missing Stage-1 commit; there is none to restore.

Hand-writing a joint commit was rejected because it would re-derive ~2/3 of two checker-verified
plans with no plan doc, no tests and no SUMMARY, after which both plans still have to be
re-verified as "already present" — more work and more risk for the same end state.

**2. Was this merged to `main`? — YES, immediately, and announced to Lane K.**
Lane K must merge `main` down BEFORE `17-01` touches `schema.ts` / `cards.tsx` / `watch.json` /
`llm.ts`. Lane R went first deliberately: its `llm.ts` change is the three **signature**
widenings, and `17-03` later adds a tool key *inside* that widened shape — landing the shape
first makes the second edit additive instead of a re-derivation.

## What landed

| File | Change |
|---|---|
| `convex/schema.ts` | `agentSteps.tool` += `v.literal("dispatchResearch")` (ONE literal); `vaultDocuments.retrievedAt: v.optional(v.number())` |
| `apps/web/.../workspace/cards.tsx` | `VERB.dispatchResearch = ["Researching…", "Research finished"]` |
| `docs/playbooks/watch.json` | `convex/research.ts`, `convex/research.test.ts` → `cockpit.md`; `scripts/run-probe-websearch.mjs` → `agent-runtime.md` |
| `convex/dispatch.test.ts` | `DISPATCH_STEP_TOOLS` += `"dispatchResearch"` (the only edit to this file this plan makes) |
| `convex/llm.ts` | 3 append-only signature widenings + the amended CKPT-05 comment |
| `docs/playbooks/cockpit.md`, `vault.md` | Phase-16 sections opened, `Last verified` bumped |

`core/src/actionType.ts`, `convex/cockpit.ts`, `convex/skills.ts` — **untouched, as the freeze
manifest predicted.** Research produces findings + a memo, not a new action type.

## Verification — all run, all passing

- `vitest run convex/dispatch.test.ts -t "agentSteps accepts"` → **4 cases** (was 3); the
  `dispatchResearch` literal round-trips against the REAL schema.
- The 5 named suites (`dispatchGuard`, `runCockpitAgent`, `dispatch`, `cockpitTools`,
  `llmRedaction`) → **164/164**. The "EXACTLY ONE TOOL-BEARING generateText call site" guard and
  the §4 redaction scans both still hold.
- **Full backend suite: 646/646 across 46 files.** `audit.test.ts` GREEN (1/1) — the corrected
  claim confirmed by running it, not by assuming it.
- Both anti-smuggling assertions pass: no `openai.tools.webSearch(`, no
  `internal.dispatch.runResearch`, and no `webResearch|dispatchResearch` used as a record KEY in
  non-comment code. (The plan is explicit that a bare substring scan would fail on this plan's own
  correct output, because `grantWebResearch` contains `webResearch`.)
- `node scripts/check-playbooks.mjs` → exit 0.

### ⚠ Typecheck: measured as a DELTA, because "clean" was never achievable

`52` errors before this plan, `52` after, **zero in production `convex/*.ts`** — every one is in a
`*.test.ts` and every one is Phase-1 vintage. Full root-cause analysis is in
`.planning/PARALLELIZATION.md` (commit `0d85975`); the short version is that
`packages/backend/tsconfig.json` sets `"types": ["node"]`, starving the test files of the ambient
types they use, while `include: convex/**/*.ts` sweeps them in anyway.

**`pnpm typecheck` reports GREEN and is lying** — turbo's `typecheck` task declares no `inputs`,
so its cache restores a stale pass without running `tsc`. **Always pass `--force`.** Every
remaining plan in Phases 16 and 17 must check the delta, not an absolute-clean gate.

## Environment notes for the next plan in this lane

- This worktree now has `node_modules` (`pnpm install`, done) and a seeded `convex/_generated/`
  **copied from `main`**. It has **no Convex deployment** and `CONVEX_DEPLOYMENT` is unset.
- That is sufficient through the freeze: `dataModel.d.ts` derives schema types generically from
  `../schema.js`, so **field and table changes need no codegen**. `api.d.ts` is a static module
  list, so the first plan that adds a NEW `convex/` module — **16-07 (`research.ts`)** — is the
  first that genuinely needs `npx convex dev`. 16-02's probe and 16-09's `eval:golden` need one too.
- The project runs a **local** backend (`CONVEX_DEPLOYMENT=local:…`, `127.0.0.1:3210`), so three
  lanes cannot each run one concurrently without a port collision. Sequence it.

## Deviations from the plan

None material. The plan's Task-2 verify command (`cd packages/backend && pnpm exec tsc --noEmit`)
was run as specified; its output is the 52-error baseline described above rather than the "clean"
the `<done>` line anticipated, which is a defect in the plan's premise, not in the change.
