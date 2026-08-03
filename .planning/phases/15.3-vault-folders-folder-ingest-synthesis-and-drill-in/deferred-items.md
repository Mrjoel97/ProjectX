# Deferred items — phase 15.3

## Pre-existing `pnpm typecheck` failures (out of scope, 15.3-04)

`pnpm typecheck` is RED at the phase baseline (`c888acb`), in test files this plan does not touch.
Verified by `git diff --name-only c888acb..HEAD` — none of these files changed since the baseline
except the two owned by the concurrent media lane.

| File | Error |
|---|---|
| `convex/blueprint.test.ts:834,965` | `Property 'docId' does not exist on type 'ConfirmBlueprintResult'` (unnarrowed union) |
| `convex/dispatch.test.ts:1118-1120` | `Argument of type '[never]' is not assignable to parameter of type 'never'` |
| `convex/evaluations.test.ts:911` | `Spread types may only be created from object types` |
| `convex/optimizerConfig.test.ts:54` | `Property 'lastRunAt' does not exist` |
| `convex/runCockpitAgent.test.ts:643-648` | four missing properties on the cockpit result type |
| `convex/llmRedaction.test.ts:145,378` | `'payload' is possibly 'undefined'` — **media lane (20-09/20-17)** |
| `convex/media.test.ts:3256` | `RequestInit` cast + empty-tuple index — **media lane (20-09/20-17)** |

Every file 15.3-04 touched typechecks clean, and `pnpm test` is 1131/1131 green across 58 files.

## Named for later phases

- `vaultFolders.spentCents` has zero writers. `recordSpend` moves rate-limiter windows only and has
  no `folderId` to write with. Plan 07/08 must either thread a `folderId` into `recordSpend` or
  render nothing for per-folder spend.
- The digest slot in `vaultFolders.tryComplete` is a comment, not a call — plan 06 owns it, together
  with the 17.1 Stage-2 `internalAction` sibling of `blueprint.buildBlueprintDraft`.
- `ingestDoc` still runs on the shared `WorkflowManager` at 25. The extraction ACTION is throttled
  by `vaultIngestPool`; workflow retries and the pre-existing backlog are not.
- Enqueued-but-never-dispatched extraction (deployment restart, dropped job) has no automatic
  backstop since the watchdog moved to work-start. Recovery is `vaultSweep:runSweep`; a cron over it
  is the upgrade path.
