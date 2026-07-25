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
