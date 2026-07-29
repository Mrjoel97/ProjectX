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

## UNPAID GATE — the 15-06 specialist-body eval run was never executed (BLOCKING for activation)

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

   ```powershell
   $names = @("offer-architect", "money-model-designer", "lead-engine")
   $canonical = @{
     "offer-architect" = Get-Content -Raw ..\contracts\skills\offer-architect.md
     "money-model-designer" = Get-Content -Raw ..\contracts\skills\money-model-designer.md
     "lead-engine" = Get-Content -Raw ..\contracts\skills\lead-engine.md
   }
   $rows = npx convex data skills --format json --limit 200 | ConvertFrom-Json
   $matches = @($rows | Where-Object {
     $names -contains $_.name -and $_.body -ceq $canonical[$_.name]
   })
   $matches | Sort-Object name | Format-Table name, version, status
   if ($matches.Count -ne 3) { throw "Expected one exact deployed body match per specialist" }
   ```

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

