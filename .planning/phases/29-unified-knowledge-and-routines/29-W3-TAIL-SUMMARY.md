---
phase: 29-unified-knowledge-and-routines
plan: W3-TAIL
subsystem: docs-and-test-hygiene
tags: [false-absolutes, stale-citations, test-env-leak, offline-fixture-seam, playbooks]

# Dependency graph
requires:
  - plan: 29-FIN-05
    provides: "the pin-door section in skill-registry.md, and the commit body listing eleven deleted claims — two of which had not actually been deleted"
  - plan: 29-FIN-06
    provides: "the vaultGround offline gate, the suite-wide consent in vitest.config.mts, and the docstring deletions whose text survived in two playbooks"
provides:
  - "packages/backend/vitest.config.mts — the suite-consent comment describes what the line does instead of asserting a repo-wide gate"
  - "docs/playbooks/skill-registry.md — the pin-door bound is the validator plus a stated gap, not an 'internalAction only' claim"
  - "packages/backend/convex/vaultGround.test.ts — afterEach-scoped env restore plus a behavioural leak guard"
  - "docs/playbooks/knowledge-search-routines.md — every citation in the BODY is a symbol; five remain inside the changelog entry, quoted there as the rotted originals"
  - "docs/playbooks/vault.md — the folder-digest cap and docType citations are symbols"
affects: [any later plan reading these playbooks as the record of what is enforced]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env stubs are restored in `afterEach`, never as a test's last statement — an aborted body skips the cleanup"
    - "A leak guard asserts the BEHAVIOUR a leak would break (the fixture path still resolves), not `process.env`"
    - "Playbook and code cross-references name SYMBOLS; this phase produced stale line numbers in four separate rounds"

key-files:
  created:
    - .planning/phases/29-unified-knowledge-and-routines/29-W3-TAIL-SUMMARY.md
  modified:
    - packages/backend/vitest.config.mts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/workflowPackBinding.ts
    - packages/backend/convex/vaultGround.test.ts
    - packages/backend/scripts/run-eval-golden.mjs
    - docs/playbooks/skill-registry.md
    - docs/playbooks/workflow-packs.md
    - docs/playbooks/agent-runtime.md
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/vault.md

key-decisions:
  - "Every flagged absolute was DELETED, not narrowed. A narrower false absolute is the failure mode this task exists to stop recurring."
  - "The `internalAction`-only property of the `tenantSkillIds` pin rail is recorded as a GAP rather than enforced. A source scan would prove spelling, and this repo has five worked examples of scans that were defeated (29-SMOKE-SEAM-DEBT.md, second entry)."
  - "The env-leak fix is scoped `afterEach` in one file, not vitest's global `unstubEnvs: true`. The global switch would change restore semantics for every backend test file, which is a much larger blast radius than the defect."

# Metrics
duration: ~95min
completed: 2026-08-29
---

# Phase 29 W3-TAIL: The Last Three Wave-3 Items Summary

**Four false absolutes deleted (one of them written by the pass sent to delete false absolutes), a
test-env stub moved out of a body that can abort before it runs, and eleven rotted line-number
citations replaced by symbols across two playbooks.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 4 of 4 (the guidance's four items)
- **Commits:** 4
- **Files modified:** 10 (5 source/config, 5 playbooks). 144 insertions, 35 deletions.

## Task Commits

| # | Item | Commit | Files |
|---|---|---|---|
| 1 | The suite-consent absolute | `1a7a5e3` | `packages/backend/vitest.config.mts` |
| 2 | Four surviving/narrowed absolutes | `00c2ecb` | `skill-registry.md`, `skills.test.ts`, `workflowPackBinding.ts`, `workflow-packs.md`, `run-eval-golden.mjs`, `agent-runtime.md` |
| 3 | The test-env leak | `487e5d2` | `packages/backend/convex/vaultGround.test.ts` |
| 4 | Stale citations | `6f1377b` | `docs/playbooks/vault.md`, `docs/playbooks/knowledge-search-routines.md` |

---

## Item 1 — the suite-consent absolute (`vitest.config.mts`)

**What it said:** *"Every `SMOKE::` seam under `convex/` is gated on `lib/models.ts`'s
`offlineSeamAvailable()` — the operator flag AND no model credential — so that tenant-supplied text
can never select a fabrication path on a keyed deployment."*

**Verified false against HEAD**, and the same commit's own debt register says so:

| Check | Command | Result |
|---|---|---|
| `vault.ts` keeps an ungated content sentinel | `grep -n 'startsWith("SMOKE::")' packages/backend/convex/vault.ts` | `729:    if (query.startsWith("SMOKE::")) {` |
| ...and knows nothing of the predicate | `grep -n "offlineSeamAvailable\|PIKAR_OFFLINE_FIXTURES" packages/backend/convex/vault.ts` | **zero matches** |
| ...and a landed E2E drives it against a KEYED deployment | `grep -n "SMOKE::" apps/web/e2e/vault-redesign.spec.ts` | 7 hits, of which 4 are `search.fill("SMOKE::<docId>")` at `:179`, `:182`, `:194`, `:200` |

`29-SMOKE-SEAM-DEBT.md` also lists instances #1-#4 (`vaultLlm.extractGraph`, `vaultLlm.identifyDoc`,
`vaultRag.embedDoc`, `gmail.search`) as **live and completely ungated on a fully keyed production
deployment today**.

**Deleted, not narrowed.** The comment now states what the line does — it turns the operator flag on
for the whole backend suite, and a test run IS an operator consenting — and points at
`29-SMOKE-SEAM-DEBT.md` as the source of truth for which seams the flag actually restrains, rather
than making a claim of its own. It names `vault.ts`/`vault-redesign.spec.ts` as the concrete
counter-example so the absolute cannot be re-derived by the next reader.

---

## Item 2 — the same pattern, four more times

### 2a. `skill-registry.md`, "The pin door IS open" — a narrower replacement that is also wrong

**What it said:** *"**Internal only.** Every entry point declaring the arg is an `internalAction`
(`runWorkflowPack`, `__runWorkflowPackWithScript`, `dispatchArgs`' four, `runCockpitAgent`). No
client-callable surface and no model output can name a row."*

Enumerated against HEAD — there are **eight** declaring sites, not those five, and one is not an
action:

| Site | File | Wrapper |
|---|---|---|
| `runWorkflowPack` | `workflowPackBinding.ts:415` | `internalAction` |
| `__runWorkflowPackWithScript` | `workflowPackBinding.ts:424` | `internalAction` |
| `runSpecialist` | `dispatch.ts` (`args: dispatchArgs`) | `internalAction` |
| `runResearch` | `dispatch.ts` (`args: dispatchArgs`) | `internalAction` |
| `runMedia` | `dispatch.ts` (`args: dispatchArgs`) | `internalAction` |
| `__runSpecialistWithScript` | `dispatch.ts` (`...dispatchArgs`) | `internalAction` |
| `runCockpitAgent` | `llm.ts:5336` | `internalAction` |
| **`actOnGapInternal`** | **`evaluations.ts:1018`** | **`internalMutation`** |

So the claim was wrong in KIND (an `internalMutation` declares it) as well as incomplete.

**Replaced by two bullets: one thing that is checked, and one gap.** What is checked is the
validator — every site takes `v.optional(v.record(v.string(), v.id("tenantSkills")))`, so the only
thing a caller may name is WHICH ROW, and a non-row value is refused before any handler runs. What
is stated as a gap: every site is internal *today* and **no test fails when a client-callable
surface declares the arg**. I did not write that scan. A source scan over wrapper spellings proves
spelling, and `29-SMOKE-SEAM-DEBT.md`'s second entry holds five worked examples of exactly that kind
of guard being defeated. An acknowledged gap beats a tripwire that reads as protection.

### 2b. `skills.test.ts` — two absolutes 29-FIN-05's commit body lists as DELETED, surviving verbatim

Both re-verified present at HEAD before touching them:

- `:4987` `// Still dark, and the tenant still runs the GLOBAL body.` — "dark" is the word
  `skill-registry.md` itself says is wrong ("*'Dark' is the wrong word for it, and this playbook and
  three comments in the code used it until the wave-3 sweep*"), because a `pack-*` candidate is
  still runnable through the `tenantSkillIds` pin door.
- `:4995` `// Rollback is refused too, and for the same reason: nothing pack-named can ever have been
  live, so there is no incident-time recovery this blocks.` — the deleted claim, verbatim, listed in
  `290647b`'s body as *"replaced by the mechanism that makes it so"*.

Now: the first says the row stays a **candidate** and cross-references the pin door; the second names
the mechanism — the `isWorkflowPackSkill` throw sits ahead of `planTenantActivation`'s mode switch
(verified at `skills.ts:322`, before the `if (mode === "activate-user")` at `:330`), so activate-user,
activate-agent and rollback all take it, and the assertion below is the rollback arm of the mutation
already named at the head of that test.

### 2c. `workflowPackBinding.ts:205-209` — a justification with nothing behind it

**What it said:** *"Throws rather than returning a governed refusal because there is no user-facing
state here to render — both entry points that declare `tenantSkillIds` here (`runWorkflowPack`,
`__runWorkflowPackWithScript`, below) are `internalAction`s, so a foreign id is a BUG, not an
outcome."*

Scoped to this file the fact is true; nothing enforces it, and it was being used to argue for a
`throw` over a governed refusal. **Justification dropped** (the guidance's "either enforce it or drop
the justification", taking the deletion branch). The comment now states the consequence honestly — a
caller reaching it with a foreign id gets an unhandled error and not a rendered outcome — and points
at the playbook's gap entry. `runPackTurn`'s tenant comparison before `preCall` is untouched.

### 2d. `run-eval-golden.mjs:977` — two different refusals described as one

**What it said:** *"`planTenantActivation` now refuses every `pack-*` name outright."*

It does not. `planTenantActivation` calls `isWorkflowPackSkill` (`skills.ts:322`), which is
membership in `WORKFLOW_PACK_SKILL_NAMES` (`packages/core/src/workflowPacks.ts:709`, over the list
derived at `:696`). The runner really does prefix-match, because it is a standalone node script with
no bundler and cannot import the list. **The two sets differ**: a `pack-`-named row that is not one
of the six registered packs is refused HERE and accepted THERE. The comment now says what each one
does and names the asymmetry as the safe direction — over-matching fails CLOSED at $0.

---

## Item 3 — the test-env leak (`vaultGround.test.ts`)

`vi.unstubAllEnvs()` was the last statement of the "WITHOUT the operator's consent" test body, after
an `await expect(...).rejects`. An aborted body skips it, and `PIKAR_OFFLINE_FIXTURES=""` then leaks
into every later test in the file.

Moved to a **file-level `afterEach`**, with the reasoning on it. Pinned by one new test placed
immediately after the stubbing one, which drives the fixture path and expects `docA` back — it
asserts the behaviour a leak would break, not `process.env`.

**MUTATION OBSERVED RED** — delete `afterEach(() => vi.unstubAllEnvs())`:

```
× vaultGround > the operator consent is RESTORED for the tests that follow
  → vault: OPENROUTER_API_KEY unset for embeddings
× vaultGroundHydrated > hydrates titles + per-doc-capped chunk text parallel to docIds
× vaultGroundHydrated > blueprint presence does not consume any of TOTAL_CHAR_CAP
× vaultGroundHydrated > cross-tenant: an explicit foreign tenantId yields no arrays or foreign spine
× vaultGroundHydrated citation metadata (29-02) > (4 tests)
× vaultGroundHydrated spine (BLPR-02) > returns a live spine without changing any retrieval array
  Tests  9 failed | 13 passed (22)   — every failure "unset for embeddings"
```

**CORRECTED 2026-08-29 (29-W3-TAIL-FIX).** This block first read "13 failures in total" and "that
13-test blast radius": 13 is vitest's PASSED count, misread as the failed count. The real figure is
**9 failed / 13 passed of 22**, re-measured by re-applying the same mutation — 1 new guard plus 8
pre-existing tests, which also means the added test contributes naming rather than detection. The
enumeration above (1 + 3 + 4 + 1) now sums to 9. Reverted (`cp` from a pre-mutation
copy; `grep -c "MUTATION: afterEach removed"` → `0`, `afterEach(() => {` present at `:26`).

`vaultGround.test.ts`: 21 → 22 tests.

---

## Item 4 — stale citations, round four of this phase

### `vault.md`

29-FIN-06 inserted a nine-line header into `vaultGround.ts` and edited `vault.md` in the SAME commit
without moving what it cites.

| Citation | Verified at HEAD | Drift |
|---|---|---|
| `vaultGround.ts:29-30` (the two caps) | `PER_DOC_CHAR_CAP` `:39`, `TOTAL_CHAR_CAP` `:40` | 10 lines |
| `schema.ts:900` (the `docType` union) | the `v.literal("unclassified")` member at `:2018` | 1118 lines |

Both now name the SYMBOL. The "mirroring" wording went with them: `vaultDigest.ts`'s
`DIGEST_PER_DOC_CHARS` / `DIGEST_TOTAL_CHARS` (`:57`/`:58`) hold the same two numbers (1500 / 8000)
as `vaultGround.ts`'s caps, and nothing couples the pairs — which is what the sentence says now,
following the 29-01 precedent for exactly this claim one package over.

**INCOMPLETE, CORRECTED 2026-08-29 (29-W3-TAIL-FIX).** This pass converted only the two citations it
had cited itself. `vault.md`'s provenance block still carried `evaluations.ts:1150`, `voice.ts:349`
and `onboarding.ts:492` — the same three this commit proved stale and fixed in
`knowledge-search-routines.md`, in a file the same commit edited — plus `schema.ts:1971` (real
line `:1966`). All six citations in that block are now symbols. Other blocks of `vault.md` still
carry line numbers and were not swept. The "mirroring" sentence is also now labelled DEBT with the
probe that shows nothing pins the pair.

### `knowledge-search-routines.md`

The 29-FIN-06 summary claims its five remaining `*.ts:<line>` citations were checked and correct.
Every citation in the file was re-verified against HEAD:

| Citation | Verified at HEAD | Drift |
|---|---|---|
| `cards.tsx:2413 GroundedSources` | `:2367` | **46** |
| `cards.tsx:2373 VaultDocButton` | `:2292` | **81** |
| `cards.tsx:2317 VaultDocModal` | `:2279` | **38** |
| `dispatch.ts:234/:256` | `:234` / `:257` | 1 |
| `blueprint.ts:271` (`deriveCandidates`) | `:265` | 6 |
| `evaluations.ts:1150` (`persistNextStepMemo`) | `:1145` | 5 |
| `voice.ts:349` (`persistBrief`) | `:342` | 7 |
| `onboarding.ts:492` | inside `writeProfileDoc`, `:462` | 30 |

The three-part `cards.tsx` chain the verifier reported (46 / 81 / 38) is confirmed exactly. All of
them are now symbols in the BODY of the file. **CORRECTED 2026-08-29 (29-W3-TAIL-FIX):** this line
read "`grep -cE ...` over the file returns **0**", which a grep falsifies — the five rotted originals
are quoted verbatim inside the changelog entry this plan added, so the count is 2 lines / 5 matches.
The changelog sentence now says so.

**And the deleted claim that survived in the same file.** The "Corrected claims" list still read
*"`renderSourceGap` and `groundedSourceProps` were described as wired. Both have ZERO callers
repo-wide"* — the exact sentence 29-FIN-06 removed from the two `@pikar/core` docstrings for being
false, surviving in the playbook that commit edited, four lines below its own header entry announcing
the deletion. `packages/core/src/workflowPacks.test.ts:216-222` calls `renderSourceGap`;
`knowledgeSearch.test.ts` calls both. Corrected to what is true: neither has a PRODUCTION caller, the
unit tests are what exercise them, 29-09's panel is the intended one — with a note saying where the
false version had survived, so it is not "re-corrected" back.
**SUPERSEDED 2026-08-29 (29-W3-TAIL-FIX):** "neither has a PRODUCTION caller" stopped being true
three commits later — 29-09's `KnowledgeSearchPanel.tsx` imports and calls both. True when written,
wrong at branch HEAD; both the playbook bullet and the changelog sentence are corrected.

---

## Verification — the CORRECTED commands, with real output

The plan's two gate commands were NOT run as written (`pnpm --filter <pkg> test -- <filter>` swallows
the `--`; `node scripts/check-playbooks.mjs` run bare hangs on stdin and signals by PRINTING).

| Command | Output |
|---|---|
| `cd packages/backend && pnpm typecheck` | clean (`tsc --noEmit`, no output) |
| `cd packages/backend && pnpm vitest run vaultGround skills workflowPackBinding` | **3 files / 231 tests passed** (= 29-FIN-05's recorded `workflowPackBinding + skills 209/209`, plus vaultGround 22) |
| `cd packages/backend && pnpm vitest run vaultGround` | **1 file / 22 tests passed** (was 21) |
| `cd packages/backend && pnpm vitest run` (full) | **112 files, 3118 tests: 111 files / 3117 passed, 1 failed** |
| `npx biome check` on the 5 changed source files | **64 warnings — byte-identical to the same five files at HEAD~4** (compared by extracting the HEAD versions to a temp dir and running biome on both). Zero new findings. |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | run on the **DIRTY** tree — **empty stdout, PASSED** (exit code not read) |
| `git diff --stat HEAD -- "*.ts" "*.mts" "*.mjs" "*.md"` after committing | only `graphify-out/GRAPH_REPORT.md` (hook-regenerated, deliberately unstaged). No source file differs from HEAD. |

**The one failure is the KNOWN RED and is not mine:** `convex/env.test.ts > every consumed name is
classified` — `QUICKBOOKS_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` consumed but absent from
`ENV_MANIFEST`. That is Phase 28's `28-06`, named as pre-existing in the wave-4 briefing. I did not
touch `env.test.ts` or `lib/env.ts`, and per the "never fix a red you did not cause" rule I left it.

Baseline reconciliation: briefing says backend **112 files / ~3117**. This run is 112 files / 3118
tests = the 3117 baseline plus my one new leak-guard test, with the known env red taking one of them
into the failed column.

### CLAUDE.md §9

Three of my source edits sit under watched prefixes, and each playbook was bumped **in the same
commit**:

| Source file | Watching playbook | Bumped in |
|---|---|---|
| `packages/backend/convex/skills.test.ts` | `skill-registry.md` | `00c2ecb` |
| `packages/backend/convex/workflowPackBinding.ts` | `workflow-packs.md` | `00c2ecb` |
| `packages/backend/scripts/run-eval-golden.mjs` | `agent-runtime.md` | `00c2ecb` |
| `packages/backend/vitest.config.mts` | *(none — not in `watch.json`, not a new file)* | — |
| `packages/backend/convex/vaultGround.test.ts` | *(none — `vault.md` watches `vaultGround.ts`, not the test)* | — |

`vault.md` and `knowledge-search-routines.md` were bumped in `6f1377b` for their own corrections.
The gate was run on the dirty tree and printed nothing.

---

## Deviations from the guidance

1. **I edited two playbooks the guidance did not name: `workflow-packs.md` and `agent-runtime.md`.**
   Not optional — they watch `workflowPackBinding.ts` and `run-eval-golden.mjs`, both of which the
   guidance explicitly assigned me, and §9's Stop hook blocks a turn that changes a watched path
   without bumping its playbook. Neither file is in any wave-4 agent's ownership list. Each got a
   single "Last verified" block and nothing else.
2. **I fixed a second stale citation in `vault.md` (`schema.ts:900`) that the guidance did not
   name.** It sits in the paragraph adjacent to the one I was sent to fix, I had already verified it
   (the `unclassified` literal is at `:2018`), and leaving a verified-stale citation in a block I was
   editing would have been the exact failure this task exists to stop.
3. **I did NOT run `graphify update .` / `node scripts/extract-convex-edges.mjs`.** `graphify-out/`
   is a shared artifact, it was already dirty when I started, and two sibling agents are building UI
   in this same worktree right now — regenerating it would have handed them a 260k-line diff to
   collide on. A SessionStart hook and the post-commit hook both re-run it. Recorded rather than
   done.
4. **I did not enforce the `internalAction`-only property** I deleted the claim about (2a/2c). The
   guidance offered "either enforce it or drop the justification" and I took the drop. Reasoning is
   in the key-decisions above and in the playbook text itself.

## What another plan owns and I left undone

- **`packages/backend/convex/onboarding.ts:449`** carries `// The SHARED persistBrief clone
  (voice.ts:299)`. `persistBrief` is at `voice.ts:342` — the same rot class, in a file
  `onboarding.md` watches and I do not own.
- **`.planning/phases/29-unified-knowledge-and-routines/29-DEPENDENCY-EVIDENCE.md` §3.1** cites
  `PER_DOC_CHAR_CAP = 1500 (L29)`, `TOTAL_CHAR_CAP = 8000 (L30)` and `vaultGroundHydrated (L172)`.
  Verified at HEAD: `:39`, `:40`, `:197`. All three have drifted by the same 29-FIN-06 header
  insertion. That file is in no wave-4 ownership list, so I did not edit it; a later plan should
  convert it to symbols the way this one converted the two playbooks.
- **`29-SMOKE-SEAM-DEBT.md`'s own line numbers** (e.g. `vaultGround.ts:48` for the closed instance
  #5, `vaultLlm.ts:135/:265`, `vaultRag.ts:390`, `gmail.ts:370`) were not re-verified in this pass —
  only `vaultRag.ts:390` and `vault.ts:729` were, because I cited them. The register is unowned in
  wave 4.
- **`convex/env.test.ts`** stays red. Phase 28's.
- **`docs/playbooks/production-beta.md`** still owes a bump for Phase 28's `lib/env.ts` change, as
  the briefing states. Not mine.

## What I could not complete

Nothing in the four assigned items was left undone. Two honest limits on what the work proves:

- **The deletions carry no mutation witness, by construction.** Removing a false sentence cannot be
  proven by a failing test; what is recorded instead is the command that showed each claim false at
  HEAD, in the tables above. Only item 3 changes behaviour, and it has its RED.
- **Nothing here was run against a live deployment.** No `convex dev`, no `convex run`, no eval
  runner, no model call, $0 spent. The `apps/web/e2e/vault-redesign.spec.ts` evidence I cite for
  item 1 is a READ of the spec's `search.fill("SMOKE::…")` calls, not a browser run.

## Self-Check: PASSED

- All 10 modified files present on disk and in `git show --stat` for the four commits; the created
  SUMMARY is this file.
- All four commit hashes (`1a7a5e3`, `00c2ecb`, `487e5d2`, `6f1377b`) verified in `git log`.
- `git diff --stat HEAD -- "*.ts" "*.mts" "*.mjs" "*.md"` after the last commit lists only
  `graphify-out/GRAPH_REPORT.md` — no source file differs from HEAD, so the tree every gate above ran
  against is the tree that was committed.
- `git status --short` shows only `graphify-out/*` unstaged. Never `git add -A`; every path was
  staged explicitly.
- No file outside my ownership list was modified, except the two §9-mandated playbook bumps recorded
  as deviation 1.
- The one mutation applied (`afterEach` deleted) was reverted and the revert verified by grep before
  committing.
