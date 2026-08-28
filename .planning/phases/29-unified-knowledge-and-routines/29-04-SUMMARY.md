---
phase: 29-unified-knowledge-and-routines
plan: 04
subsystem: knowledge-search
tags: [toolless-llm, skill-registry, eval-gate, citations, prompt-injection, mutation-testing]

# Dependency graph
requires:
  - phase: 29-01
    provides: "@pikar/core/knowledgeSearch — clampSearchPlan, validateSynthesis, SEARCH_CAPS, KNOWLEDGE_SOURCES/NOT_LANDED_SOURCES, authorityFor/freshnessFor. Every honesty rule this plan enforces is decided there."
  - phase: 21-user-skill-authoring
    provides: "skills.getSkillVersion + activateSkill's EVAL_GATE — the version-pin and gating rails both knowledge bodies ride"
  - phase: 17.1-business-blueprint
    provides: "blueprint.ts deriveCandidates — the toolless call shape copied verbatim (runId, fail-closed load, preCall-as-data, scanText, SMOKE, generateObject, priceUsage, recordSpend)"
provides:
  - "packages/contracts/skills/knowledge-query-planner.md + knowledge-synthesizer.md — provider-neutral registry bodies, GATED, with derived .ts constants under a drift guard"
  - "packages/backend/convex/knowledgeLlm.ts — planKnowledgeSearch + synthesizeKnowledge: toolless, schema-bounded, pin-capable, post-validated"
  - "packages/backend/convex/knowledgeLlm.test.ts — 29 behavioural + structural tests, all $0"
  - "llmRedaction.test.ts — the STRICT-mode scan extended to knowledgeLlm.ts, a whole-file tools: ban, and a guard that fails when the strict-mode scan matches nothing"
  - "skills.test.ts — EVERY gated skill is proved to seed (the repo had no such test)"
affects: [29-06 coordinator, 29-07 UI, 29-05 customization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Absent-by-grammar over ignored-by-convention: authority/confidence/freshness/limit have NO schema property and additionalProperties:false forbids one"
    - "The RAW model object never leaves the module — every path (live, fixture) converges on the pure validator"
    - "ONE fallback site inside the try, with the offline sentinel driving the REAL catch, so the degradation branch is a tested branch"
    - "The reason for a not-landed source is decided from the ADAPTER REGISTRY, not from what the model happened to name"
    - "A source scan is order-dependent and can be silently vacuous — assert it matched something"

key-files:
  created:
    - packages/contracts/skills/knowledge-query-planner.md
    - packages/contracts/skills/knowledge-synthesizer.md
    - packages/contracts/src/skills/knowledgeQueryPlanner.ts
    - packages/contracts/src/skills/knowledgeSynthesizer.ts
    - packages/backend/convex/knowledgeLlm.ts
    - packages/backend/convex/knowledgeLlm.test.ts
  modified:
    - packages/contracts/src/skill.ts
    - packages/contracts/src/skills/skillBodies.test.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/llmRedaction.test.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/skill-registry.md
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/watch.json

key-decisions:
  - "The calls live in a NEW convex/knowledgeLlm.ts, not llm.ts. The plan text's premise was false and was checked."
  - "Both bodies are GATED, and the fact that the gate is NOT YET CLEARABLE is recorded in five places rather than worked around."
  - "A not-landed source is `not_landed` whether or not the planner named it — a real defect the tests caught."
  - "The planner fallback was restructured to one site so the offline directive drives the real catch, because a mutation over the old shape stayed green."
  - "SUMMARY_CHAR_CAP lives in knowledgeLlm.ts, not SEARCH_CAPS, because @pikar/core's cap scan demands an enforcement site in that package and there is none for a summary."
  - "packages/core was NOT touched: 29-03 owns knowledgeSearch.ts and workflowPacks.ts this wave."

requirements-completed: []

# Metrics
duration: ~145min
completed: 2026-08-28
---

# Phase 29 Plan 04: Toolless Knowledge Planning and Cited Synthesis Summary

**Two registry-owned model calls that cannot choose a source, a limit, a tenant, an authority or a tool — because the grammar has no field for any of them and the pure validators re-check everything the model wrote.**

## Performance

- **Duration:** ~145 min
- **Tasks:** 2 of 2
- **Files:** 15 (6 created, 9 modified) — 1,633 insertions, 6 deletions across two commits

## Task commits

1. **Task 1 — registry-owned, gated bodies** — `9d4b819` (feat, 9 files)
2. **Task 2 — the two toolless calls** — `eaa78b1` (feat, 6 files)

`git diff --stat HEAD -- "*.ts"` after each commit: **empty**. The HEAD tree is the tree every gate below ran against — no partial `git add`.

## THE TWO GATE COMMANDS IN THE PLAN ARE NO-OPS AND WERE NOT RUN AS WRITTEN

`pnpm --filter @pikar/<pkg> test -- <filters>` swallows the `--`, so the filter never reaches vitest.
`node scripts/check-playbooks.mjs` run bare hangs on stdin and signals by PRINTING, never by exit code.
Corrected forms and real output below.

| Command (corrected) | Real output |
|---|---|
| `cd packages/contracts && pnpm vitest run` | **6 files / 99 tests passed** (baseline 6 / 93 — +6 is exactly this plan: 2 drift rows, 2 gating, 2 no-grant) |
| `cd packages/contracts && pnpm vitest run skillBodies` | **34 passed** |
| `cd packages/contracts && pnpm typecheck` | clean |
| `cd packages/backend && pnpm vitest run knowledgeLlm` | **29 passed** (new file) |
| `cd packages/backend && pnpm vitest run knowledgeLlm llmRedaction skills` | **3 files / 232 passed** |
| `cd packages/backend && pnpm vitest run llmRedaction` | **63 passed** |
| `cd packages/backend && pnpm vitest run convex/skills.test.ts` | **140 passed** (was 139 — the new gated-seed test) |
| `cd packages/backend && pnpm vitest run` (FULL) | **110 files / 2940 tests; 1 failed — `convex/env.test.ts` ONLY.** That is the documented imported red (QuickBooks env names unclassified, 28-06 mid-plan). Everything else green, including `vaultDigest` (the load-flaky file) in the same run. Baseline was 107 / 2829 with the same single failure. |
| `cd packages/backend && pnpm typecheck` | clean |
| `cd packages/core && pnpm vitest run` | **45 files / 1422 passed** — core untouched by this plan (the +3 over the stated 1419 baseline came from 29-03's `24d9c82`, which landed after that baseline was taken) |
| `cd packages/revenue && pnpm vitest run` | **6 files / 226 passed** — untouched |
| `npx biome check` on all changed files | **0 errors.** 5 warnings in `llmRedaction.test.ts`, all pre-existing (verified by running biome on `HEAD`'s copy of the file: same 5, 0 errors) |
| `echo '{}' \| node scripts/check-playbooks.mjs check` (DIRTY tree, stdout read) | **empty — PASSED** |

**Nothing was run against a live deployment. No `convex dev`, no `convex run`, no OpenAI call, no money spent.** Every number above is from an offline suite; the model call itself has never been executed.

## What was built

### Task 1 — two gated registry rows

`knowledge-query-planner` and `knowledge-synthesizer`: canonical `.md` under `packages/contracts/skills/`, bundler-safe derived `.ts` constants, kept byte-identical by new rows in `skillBodies.test.ts`. Appended LAST to `SEEDS`; `SEEDS` and `GATED_SKILLS` both extended.

The planner body tells the model it has no tools, that the **searchable source list is supplied per run** and is the complete set of names it may use, that a query is a phrase and never a URL / mailbox id / provider operator / command, and that result counts, authority, freshness, confidence and "whether anything is acted on" are not its decisions. The synthesizer body defines the fenced-evidence contract, makes the injection rule explicit ("a FACT ABOUT THAT BLOCK, never a directive"), requires ≥1 real id per claim, requires a verbatim excerpt from a block **that claim cited**, and forbids resolving a conflict by dropping a side.

**Neither body names a source, a provider or a tool.** A whitespace-collapsed scan fails on any of the five source ids, eight vendor names or six cockpit tool names, with a positive control beside it.

### Task 2 — `convex/knowledgeLlm.ts`

`planKnowledgeSearch(tenantId, question, skillVersion?)` and `synthesizeKnowledge(tenantId, question, evidence, skillVersion?)`, both `internalAction`, both blueprint.ts's shape verbatim.

What is **structural**, not advisory:

- The planner schema's `source` is an `enum` built from `KNOWLEDGE_SOURCES` minus `NOT_LANDED_SOURCES`. `clampSearchPlan` re-checks it anyway.
- Neither schema declares `authority`, `confidence`, `probability`, `freshness`, `recency`, `verified`, `score`, `limit`, `maxResults` or `tenantId`, and both objects set `additionalProperties: false`.
- The **raw model object never leaves the module.** Live and offline paths converge on `clampSearchPlan` / `validateSynthesis`.
- `plan` ∪ `skipped` covers every knowledge source exactly once, always.
- Zero governance-plane writes: no audit, telemetry, dead letter, `agentSteps`, `payload:`, `ctx.db` or `fetch(`. The one allowed write is `guardrails.recordSpend`.
- Both `skillVersion` pins load the EXACT version; a version that does not exist throws rather than falling back to active.

## The defect the tests caught

**A not-landed source was reported `unplanned` on every ordinary run.** `clampSearchPlan` can only mint `{status:"unavailable", reason:"not_landed"}` for a source the *model proposed*. My first `settlePlan` filled in every other source as `unplanned`, so `support-desk` — the one source with no adapter at all — came back saying "we chose not to look there" instead of "this product cannot look there yet, and here is the unlock". Those are materially different sentences, and the softer one silently erases the exact honest-gap the phase's owner ruling exists to preserve.

Fixed: the reason is decided from the adapter registry, not from what the model said. **Mutation observed RED:** hardcode `reason: "unplanned"` → 2 tests fail.

## The structure changed because a mutation stayed GREEN

The planner originally had **two** fallback sites, and the `SMOKE::knowledge-plan::FAIL` directive short-circuited *past* the real `catch`. Emptying the catch's fallback left **29/29 green** — the degradation branch was a line nobody had executed.

Restructured to one fallback site, with the offline seam **inside** the `try`, so `FAIL` throws and the real `catch` runs. **Re-applied: 1 test RED.** This is recorded rather than quietly fixed because the first shape is precisely the "green tests over broken capability" pattern this repo has paid for.

## Mutations observed RED

Every one was applied, the suite was run, the failure was observed, and the file was restored. The baseline was re-confirmed green after each batch (`git diff --stat` clean).

### Task 1 — 5/5 RED

| ID | Mutation | Result |
|---|---|---|
| T1-M1 | one word case-changed in `knowledge-synthesizer.md` (drift row) | 1 failed / 33 |
| T1-M2 | `KNOWLEDGE_SYNTHESIZER_SKILL` removed from `GATED_SKILLS` | 1 failed / 33 |
| T1-M3 | `Gmail` inserted into the planner body | 2 failed / 32 |
| T1-M4 | the whitespace collapse removed from the no-grant scan (positive control) | 1 failed / 33 |
| T1-M5 | the `knowledge-synthesizer` SEEDS row deleted | 1 failed / 139 |

### Task 2 — 17/17 RED (after two corrections, both recorded)

| ID | Mutation | Result |
|---|---|---|
| T2-M1 | a not-landed source degraded to `unplanned` | 2 failed / 27 |
| T2-M2 | unread sources omitted entirely (no gap at all) | 3 failed / 26 |
| T2-M3 | `clampSearchPlan` bypassed for the plan itself | 6 failed / 23 |
| T2-M4b | the planner fallback emptied — **via the real `catch`** | 1 failed / 28 |
| T2-M5 | `validateSynthesis` replaced by a pass-through | 4 failed / 25 |
| T2-M6 | the summary cap removed | 1 failed / 28 |
| T2-M7 | `confidence: { type: "number" }` added to the synthesis schema | 2 failed / 90 |
| T2-M8 | the planner `source` enum opened to any string | 1 failed / 28 |
| T2-M9 | planner redaction (`scanText`) removed | 1 failed / 91 |
| T2-M10b | the planner budget gate removed | 2 failed / 27 |
| T2-M10c | the synthesizer budget gate removed | 2 failed / 27 |
| T2-M11 | the planner PIN silently falls back to the ACTIVE version | 2 failed / 27 |
| T2-M12 | the evidence `authority` validator opened to `v.string()` | 1 failed / 28 |
| T2-M13b | inner `required` deleted from the plan schema | 1 failed / 62 |
| T2-M13c | **both `required` moved ABOVE `properties`** (blueprint's ordering — the exact shape that makes the strict-mode scan match nothing) | 1 failed / 62 |
| T2-M14 | synthesizer redaction removed | 1 failed / 91 |

**Two mutations were initially wrong and are reported as such rather than dropped:**

- **T2-M4 was GREEN** at 29/29 on the first attempt. That was not a bad mutation — it was a real coverage hole, and it caused the restructure above. Re-run as T2-M4b against the fixed shape: RED.
- **T2-M13 (`checked + 1`) was GREEN** at 63/63 and proved nothing: `checked` is already > 0, so incrementing it cannot falsify `toBeGreaterThan(0)`. Replaced by T2-M13c, which reproduces the actual failure mode the guard exists for.
- **T2-M10 was SKIPPED** on the first run (its anchor matched twice — both actions share the gate text). Split into M10b/M10c with per-action anchors; both RED.

## An existing scan was found to be silently vacuous under one ordering

`llmRedaction.test.ts`'s "every generateObject schema is STRICT-mode legal" walks each `properties: {…}` object and then looks for `required: […]` **after** it. `blueprint.ts`'s schemas put `required` **before** `properties` — under that ordering the scan matches zero pairs and passes without examining anything.

The scan is now `test.each(["llm.ts", "knowledgeLlm.ts"])` and asserts it matched at least one pair per schema, with a message naming the cause. **T2-M13c proves the guard fires.** `llm.ts`'s three module-level schemas already use the safe ordering, so nothing there changed.

`blueprint.ts`, `vaultDigest.ts` and `vaultExtract.ts` are **not** covered by this scan — out of this plan's blast radius, named here so it is a known gap rather than an assumption.

## New coverage the repo did not have

**`skills.test.ts`: every `GATED_SKILLS` name is proved to seed.** A gated name with no `SEEDS` row is a *worse* deadlock than an ungated skill — the row never reaches the registry, `getActiveSkill` throws `NO_ACTIVE_SKILL` forever, and no eval run can be recorded against a version that does not exist. Every prior seed assertion was pinned to ONE name. The test LOADS each body rather than comparing two arrays, because an array comparison passes on a `SEEDS` row whose body is `""`. **Mutation RED:** delete the synthesizer seed row.

## THE GATE ON BOTH BODIES IS NOT YET CLEARABLE — say it plainly

Both skills are in `GATED_SKILLS`, which is the substantively right call (the synthesizer ingests untrusted third-party content from several planes at once — the `inbox-digest` criterion exactly). **But this plan did NOT deliver a runnable eval fixture, and could not have.**

`run-eval-golden.mjs` drives exactly one Convex function — `llm:runCockpitAgent` (verified: it is the only `internal.`/`api.` target in 4,099 lines). A toolless knowledge call is unreachable from a cockpit text fixture until a cockpit-side knowledge **tool** exists. That tool, and the coordinator behind it, are **plan 29-06**. Writing a fixture now would have produced a fixture that fails.

What is true today, and why nothing is blocked *yet*:

- `seedSkills`' `rows.length === 0` branch lands both at **v1 `active`** — no eval cycle, no paid run.
- The deadlock bites only on the **first body edit**, which mints a candidate `activateSkill`'s EVAL_GATE will hold.

What this plan DID build so the other half is a small change rather than a redesign:

- Both actions take a `skillVersion` pin and load that EXACT version via `getSkillVersion`.
- `knowledgeLlm.test.ts` proves **behaviourally** that the pinned body is what answers (v1 unpinned, v2 pinned) and that a non-existent pin throws instead of falling back. **Mutation RED.**

**29-06 OWES:** a cockpit-side knowledge tool, `skillVersions` threaded into `knowledgeLlm`, and at least one golden fixture that drives a knowledge search. Until then: **do not edit either body.** This is recorded on both constants in `skill.ts`, on the `SEEDS` rows, in `skill-registry.md`, in `knowledge-search-routines.md`'s Known gaps, and here.

## Deviations from the plan text

**1. The calls are in a NEW module, not `llm.ts`.** The plan said "the existing sole Node LLM module"; the addendum flagged the premise as false and it was re-verified. `llm.ts` is the tool-bearing loop and the whole safety argument is that untrusted content never enters it. `llm.ts` was **not modified** — the plan's `files_modified` names it, and that entry is now wrong. `llmRedaction.test.ts` (also named) WAS modified.

**2. Files touched that the plan did not name**, each because the repo's own conventions require it:

| File | Why |
|---|---|
| `packages/contracts/skills/*.md` (2) | Every skill body in this repo is a canonical `.md` plus a derived `.ts` under a drift guard. A `.ts`-only body would be the "silently stale prompt" the drift rows exist to prevent. |
| `packages/backend/convex/skills.test.ts` | The gated-seed hole above. Dropping either `SEEDS` row was invisible to the whole suite. |
| `packages/backend/convex/knowledgeLlm.test.ts` | Named by the plan. |
| `packages/backend/convex/_generated/api.d.ts` | `_generated` is tracked and codegen needs a live deployment, which is forbidden here. Two lines added by hand (`import type * as knowledgeLlm` + the `knowledgeLlm:` field), mirroring the two 29-02/29-03 entries beside them. **Without this, `pnpm typecheck` fails on `internal.knowledgeLlm`** — the tests pass either way, because convex-test resolves modules through `import.meta.glob`, which is exactly the kind of divergence worth naming. |
| `docs/playbooks/skill-registry.md` | CLAUDE.md §9 — it watches `skill.ts`, `skills.ts`, `src/skills/` and `skills/`. |
| `docs/playbooks/knowledge-search-routines.md`, `watch.json` | §9 — `knowledgeLlm` had no watched prefix; it is now registered under the phase playbook, with invariants 27–31 and six Known-gaps rows. |

**3. `SUMMARY_CHAR_CAP` is local, not a `SEARCH_CAPS` entry.** `@pikar/core`'s "NO CAP IS DEAD" scan requires an enforcement site in that package and there is none for a model summary — and this wave I am not permitted to edit `knowledgeSearch.ts` (29-03 owns it). Enforced at the only place a summary is produced, and covered behaviourally: the offline fixture echoes the question, so a 5,000-character input drives the cap. `1_200` is a literal. **Mutation RED.**

**4. `settlePlan` files a REJECTED source as `unplanned`.** There is no closer member of the closed reason set, `rejected` carries the detail, and minting a new reason belongs in `@pikar/core` — another plan's file this wave. Recorded in a comment and covered by a test.

## Changes another plan owns, left undone

- **`packages/core/src/knowledgeSearch.ts` — NOT touched.** 29-03 owns it this wave. Two things belong there eventually: (a) a reason distinguishing "the planner named this source unusably" from "the planner never named it"; (b) `SUMMARY_CHAR_CAP` once core has a function to enforce it. Neither is urgent.
- **`packages/backend/convex/schema.ts` — NOT touched.** `knowledgeSearches.runId`'s comment ("the run correlation the toolless planner/synthesizer calls spent against") overstates what exists: each action **mints its own** per execution, following `blueprint.ts:271`'s reasoning that a stable correlation puts the ledger *below* the limiter on a retry. So there are two spend correlations per search — `knowledge:plan:<runId>` and `knowledge:synth:<runId>` — and neither is the coordinator's row id. Both actions **return** their `runId`. **29-06 must decide what `knowledgeSearches.runId` holds**, and 29-01's owner should correct that comment.
- **`llm.ts` — NOT touched**, per deviation 1.
- **`packages/revenue`, `apps/web` — NOT touched.**

## What is NOT built

- **Nothing calls `knowledgeLlm`.** No coordinator, no `knowledgeSearches` write, no UI, no cockpit tool. Plan 29-06.
- **The model call has never actually run.** Every test uses the `SMOKE::` seam. The live JSON-schema round trip, the real strict-mode acceptance and the actual prompt quality are unverified, and the strict-mode scan exists precisely because no mocked test can see that class of failure.
- **No eval fixture, no eval evidence, no activation.** See the gate section above.
- **The planner's `source` enum has no behavioural test** — the model is never called offline, so only a source scan asserts it is derived. `clampSearchPlan` is the enforcement that *is* behaviourally covered.

## Observation worth recording

On one run, `check-playbooks.mjs check` printed a block naming **`docs/playbooks/vault.md`** for `knowledgeVaultDrive.ts` / `vaultDrive.ts` — 29-02's files, already committed at `a2d39ef`/`ec26089`, and never in my `git diff --name-only HEAD`. Re-run on the same dirty tree it is **empty**. I could not reproduce it and did **not** bump `vault.md`: bumping a "Last verified" line certifies a diff I did not read. Verified afterwards that the ack file contains **no** `vault.md` entry, so nothing was falsely blessed. The pre-existing `production-beta.md` block named in my brief did not appear on any run.

## Requirements

`KNOW-01` — **the two model calls only.** Not user-visible; stays open until 29-06 wires the coordinator and 29-07 renders the card.

## Self-Check: PASSED

All 6 created files verified present on disk. Both task commits verified in `git log`. `git diff --stat HEAD -- "*.ts"` after each commit is **empty**. `git show --stat` lists exactly the 9 and 6 files each commit was meant to touch — no `git add -A`, no other plan's file staged. `STATE.md` and `ROADMAP.md` were deliberately **not** updated (isolated worktree, another lane owns `.planning/STATE.md` — the same call 29-01 recorded).
