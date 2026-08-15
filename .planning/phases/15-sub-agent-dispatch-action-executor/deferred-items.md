# Phase 15 — deferred items

Out-of-scope discoveries logged during execution. NOT fixed (SCOPE BOUNDARY: only issues directly
caused by the current task's changes get auto-fixed).

## `@pikar/audit` has no `tsconfig.json` (pre-existing since Phase 1)

Found during: 15-01 plan-level verification (`pnpm typecheck`).

`packages/audit/` contains only `package.json` + `src/` — no `tsconfig.json` — so its
`typecheck` script (`tsc --noEmit`) invokes `tsc` with no project, which prints the compiler's
HELP TEXT and exits 1. `turbo run typecheck` therefore fails at `@pikar/audit#typecheck` and,
without `--continue`, STOPS before running any other package's typecheck.

- Pre-existing since `1782ab3` (`feat(01-03): insert-only audit module + taxonomy`) and identical
  in the main checkout — nothing in Phase 15 caused or touched it.
- Impact beyond the noise: `pnpm typecheck` is not a usable green/red gate today. Use
  `npx turbo run typecheck --continue`, which reports 8 successful / 10 total, the two reds being
  this and `@pikar/backend`'s 52 documented pre-existing test-file errors.
- Fix when someone owns it: add `packages/audit/tsconfig.json` mirroring `packages/cost/`'s.

## Two full-suite timeout flakes on the `"use node"` llm.ts import (pre-existing, load-induced)

Found during: 15-03 plan-level verification (`pnpm --filter @pikar/backend exec vitest run`).

On a busy machine, two tests cross vitest's 5s default `testTimeout` during the PARALLEL full run:

- `convex/cockpitDraft.test.ts > draftCockpit loads the email-drafter body from the registry` (5.4s)
- `convex/voice.test.ts > storeBrief drafts via the SMOKE transcript and ingests a kind:brief vault doc` (9.0s)

Both pass in isolation (11/11 when the two files are run together) and both passed on the
immediately-following full run (528/529, the sole red being the documented `audit.test.ts`
`auditCounts` row). The cost is the first `ai` + `@ai-sdk/openai` import through the `"use node"`
`llm.ts` inside convex-test's lazy module loader — the SAME wall `runCockpitAgent.test.ts` (15-01)
and `dispatch.test.ts` (15-03) already side-step with an explicit
`vi.setConfig({ testTimeout: 30_000 })` at the top of the file.

- Nothing in 15-03 caused it: this plan touched no source file either test loads, and both files
  predate Phase 15. Adding more mock-model tests to the parallel run makes it surface more often,
  which is how it was noticed.
- Fix when someone owns those files: one `vi.setConfig({ testTimeout: 30_000 })` line each. Lane A
  does not own `cockpitDraft.test.ts` or `voice.test.ts` this phase, so it is logged, not fixed.

## `replyToMessage` has no `VERB` entry (pre-existing since Phase 3.11)

Found during: 15-01 Task 1 (adding the dispatch `VERB` entries).

`v.literal("replyToMessage")` is on the closed `agentSteps.tool` union in `schema.ts` but has no
entry in the `VERB` map in `apps/web/app/(app)/dashboard/workspace/cards.tsx`, so a reply turn
renders the `FALLBACK` `["Working…", "Done"]`. This is the SAME class of gap 15-01 fixed for
`evaluateBusiness`, but 15-01's plan named only `evaluateBusiness` and `apps/web` is FROZEN for
Phase 15 after Wave 0 — so this is deliberately left alone rather than smuggled into the freeze
commit. One line to fix whenever `apps/web` next opens.

## RESOLVED — the 15-06 specialist-body eval/activation gate

> **Closure update 2026-08-08:** Phase 16's unfiltered gate `14feb4b7` passed 34/34 for $0.3456,
> recorded evidence on offer-architect@4, money-model-designer@4, and lead-engine@4, activated all
> three, and read them back. Gate `d17039a8` re-confirmed 34/34. The historical record below is
> retained because its earlier failures and ship-dark decision were real; its instructions and
> active-v1 consequence are superseded.

> **RUN 2026-07-31 — GATE RED, NOTHING ACTIVATED. Diagnosis below; the three bodies stay dark.**
> Run `9dde13e8`, 27/33, $0.2148, pins `offer-architect@2 money-model-designer@2 lead-engine@2
> research-specialist@1` (all four resolved by exact body equality — the three specialists are v2
> CANDIDATES, `research-specialist` has no v2 and its v1 is active via seedSkills' bootstrap path).
>
> **Fixtures 29/30/31 all failed, and the cause is NOT the specialist bodies** — the dispatch never
> got far enough to exercise them:
>
> | Fixture | Attempt frameworks | Latest `gaps` | Reported failure |
> |---|---|---|---|
> | 29 | growth-os, growth-os | 1, 1 | `citesVaultDoc: expected true, got false` |
> | 30 | **lean, swot** | 0, 0 | `actOnGap: gap_not_found` |
> | 31 | **swot, swot** | 0, 0 | `actOnGap: gap_not_found` |
>
> `applyActOnGap` reads the NEWEST `evaluations` row and returns `gap_not_found` for an empty
> `gaps` array, so 30/31 tapped a real evaluation that legitimately had nothing to act on.
> **A timing race was considered and REFUTED:** 29's taps succeeded (it failed later, on
> `citesVaultDoc`), and 28's two attempts show gaps 1 → 0 exactly matching its observed
> fail-then-`PASS (retried)`.
>
> **THE FIXTURE→THREAD ATTRIBUTION IS CONTENT-CONFIRMED, not just order-inferred.** The runner
> logged no correlation key at the time (that is what this run's runner fix adds), so the mapping was
> first reconstructed from creation order — nine threads = 27×1 + 28×2 + 29×2 + 30×2 + 31×2, matching
> exactly which cases retried. It was then **independently verified against row CONTENT**: each
> evaluating fixture states a UNIQUE money figure — 27 `180`, 28 `2400`, 29 `240`, 30/31 `3200` — and
> every thread's recorded scorecard/findings carried the figure the order-mapping predicted, with
> zero misplacements. Beware the substring trap that briefly muddied this: a naive `240` match also
> hits 28's `2400`; use word boundaries. **Known limit: 30 and 31 BOTH state `3200`, so content
> cannot separate them from each other** — it does not need to, because all four of their threads
> carry `gaps=0`, so the finding holds whichever pair is which.
>
> **Root cause: the scorecard was not populated, so the gates had nothing to fire on.**
> `diagnose()` runs unconditionally (`evaluations.ts:394`) — it is NOT gated on framework — so the
> lean/swot split is a SYMPTOM, not the cause: `financialsPresent` is derived from the same unfilled
> scorecard and line 365 then falls back to `TIER_FRAMEWORK[tier]`. Do not "fix" this by forcing the
> framework; `evaluations.ts:317` already warns against reading a framework difference as the rubric
> being wrong.
>
> **It is NOT a missing-teaching problem.** The ACTIVE `cockpit-agent` is **v15** and its body
> contains `recordScorecardAnswer`, `modelCard`, `offerTypesPresent`, `leadCard` and
> `coreFourActive`. Note v15 was **NOT pinned** in this run — a future run of these fixtures should
> pin it, or the body under test is uncontrolled.
>
> **The real finding — recording an ABSENCE is the hard case.** 29 states a POSITIVE scalar
> ("our CAC is 240 dollars per new customer") and recorded reliably, twice. 30 and 31 state
> NEGATIVES ("no upsell, no downsell, no recurring plan"; "we run no outreach at all") and recorded
> unreliably — fixture 30 even derived a DIFFERENT TIER on each attempt (lean vs swot), i.e. the
> two runs disagreed about the same business. That is model-behaviour variance on negative-fact
> extraction, not an engine fault.
>
> **What must NOT be done:** lower 30/31's expectations. The legitimate moves are (a) make the
> negative facts as explicit to record as 29's positive scalar, (b) strengthen the cockpit-agent
> body's negative-fact guidance and re-gate it, and/or (c) pin `cockpit-agent@N` in the run. All
> three change the INPUT or the BODY, never the assertion.
>
> Fixtures 32/33/34 returned NO valid signal — the deployment's bundler was broken mid-run by an
> unrelated concurrent operation, so they failed on `Unexpected end of JSON input` at $0 recorded
> (note `caseCost: 0` is hardcoded in the runner's catch, so that figure is not proof of no spend).
> They must be re-run before any claim about the research body.

Found during: 15-06 Task 3.

15-06 rewrote all three specialist bodies (`offer-architect`, `money-model-designer`, `lead-engine`)
so they name `searchVault`, state the read-only posture and give an honest not-enough-data answer.
All three are in `GATED_SKILLS`, so a body EDIT publishes a CANDIDATE that
`activateSkillVersion` refuses to activate without recorded passing eval evidence (the Phase-3.6
`EVAL_GATE`).

**The gate was not run and was not faked.** This worktree (`.worktrees/lane-a-dispatch`) has no
`CONVEX_DEPLOYMENT` — 15-01 bootstrapped it with a COPIED `packages/backend/convex/_generated`,
because `convex codegen` refuses to run without one. Everything offline was completed and is green:
the six-file body mirror + `skillBodies.test.ts`, the multi-pin runner, the three end-to-end
fixtures, `--self-check` (30 fixtures, 11 derived gated skills), the full backend suite and both
playbooks. Nothing that needs a LIVE backend or a real model call was run:
`pnpm eval:golden`, `seedSkills`, `getActiveSkill`, `activateSkill`.

**Consequence (pre-decided by 15-CONTEXT — SHIP DARK):** the rewritten bodies are parked as source
only. On the production deployment the ACTIVE rows are still the v1 bodies carrying the
*"Registered now; a full build runs later"* framing, so a dispatched specialist today runs the OLD
body. Phase 15's five success criteria are proven by 15-01..15-05 and none of them requires a
rewritten body, so this blocks nothing that shipped.

**What closes it** (owner, from `packages/backend` on the configured live deployment):

1. Seed exactly once with `pnpm seed` — plain `npx convex dev` does not run
   `skills:seedSkills`.
2. Read the versions back by **exact body equality**, never by `active + 1`. In PowerShell:

   > **CORRECTED 2026-07-31 — the version below replaces an earlier one that could NEVER match on
   > Windows.** The stored `body` is **LF**; it originates from the generated `.ts` string literal,
   > not from the `.md` on disk. A Windows working tree checks the `.md` out as **CRLF**, so a raw
   > `Get-Content -Raw` comparison fails for EVERY skill. Measured on the live deployment:
   > `research-specialist.md` reads **6441** chars from disk against **6314** stored — exactly one
   > extra char per line break, content otherwise identical. The old script therefore printed zero
   > matches and threw, and its own instruction on that outcome ("do NOT guess a version") sent the
   > reader to a dead end. **The `-replace` below is the whole fix — do not remove it.**

   ```powershell
   $names = @("offer-architect", "money-model-designer", "lead-engine")

   # LF-normalize: stored bodies are LF, a Windows checkout is CRLF. Without this, zero matches.
   $canonical = @{}
   foreach ($n in $names) {
     $canonical[$n] = (Get-Content -Raw "..\contracts\skills\$n.md") -replace "`r`n", "`n"
   }

   $rows = npx convex data skills --format json --limit 500 | ConvertFrom-Json
   # NOT $matches — that is a PowerShell automatic variable clobbered by any -match operator.
   $bodyMatches = @($rows | Where-Object {
     $names -contains $_.name -and $_.body -ceq $canonical[$_.name]
   })
   $bodyMatches | Sort-Object name | Format-Table name, version, status
   if ($bodyMatches.Count -ne $names.Count) {
     throw "Expected one exact deployed body match per specialist, got $($bodyMatches.Count)"
   }
   ```

   If a skill still shows no match after this, the deployed body genuinely differs from the repo —
   re-run the seed and re-read. Do not fall back to guessing a version number.

   Record the three printed versions as `N_offer`, `N_money`, and `N_lead`. This survives optimizer
   candidates and `seedSkills`'s `maxVersion + 1` rule; a guessed version does not.
3. Run ONE paid gate with those exact numbers:
   `pnpm eval:golden --skill offer-architect@N_offer --skill money-model-designer@N_money --skill lead-engine@N_lead`.
   Budget remains ≈ $0.19 extrapolated from the last recorded run (27 cases / $0.1686 / run
   `ed251c29`) plus three dispatched specialist turns.
4. Only if the whole gate is GREEN, activate the exact rows:

   ```powershell
   npx convex run skills:activateSkill '{"name":"offer-architect","version":N_offer}'
   npx convex run skills:activateSkill '{"name":"money-model-designer","version":N_money}'
   npx convex run skills:activateSkill '{"name":"lead-engine","version":N_lead}'
   ```

5. Read each active row back:

   ```powershell
   npx convex run skills:getActiveSkill '{"name":"offer-architect"}'
   npx convex run skills:getActiveSkill '{"name":"money-model-designer"}'
   npx convex run skills:getActiveSkill '{"name":"lead-engine"}'
   ```

   Each result must report its pinned version and the exact canonical body above. RED, flaky,
   over-cap, a missing exact-body match, or any mismatched readback means leave all candidates
   parked; do not weaken a fixture, increase retries, or hand-activate.

**Evidence that would close it:** the run id, case count and cost, plus a `getActiveSkill` readback
showing each of the three at the pinned version.

**Also unverified because of the same constraint:** the three new fixtures
(`29-gap-dispatch-offer-architect`, `30-gap-dispatch-money-model`, `31-gap-dispatch-lead-engine`)
have never run against a live model. Their turns were authored against `diagnose()`'s gate order
(gate 1 no offer / gate 2 one offer type / gate 3 no channel) and the 27/28 precedent, so a
`gapCount` mismatch on the first live run is most likely the model recording no scorecard path or a
wrong one — the 12-06 lesson — not an engine fault. `citesVaultDoc` is the other first-run risk: it
requires the specialist to actually quote a seeded vault title.

