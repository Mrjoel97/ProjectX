# 29-12 — SUMMARY

# recurrence: deferred

The branch was selected by the parser, not by me, and it was run **before** anything was edited:

```
$ node packages/backend/scripts/check-routine-gate.mjs \
    .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision
OK --validate-decision (decision: defer)
EXIT=0
```

(Exit code read directly from the process, never through a pipe.)

So 29-12 Task 1's `defer` branch applies: **add a static absence proof and make no implementation
edit.** That is exactly what happened.

## What was NOT done, and is verifiable

`git diff --stat HEAD` over `package.json`, `packages/backend/package.json`,
`packages/core/package.json`, `apps/web/package.json`, `pnpm-lock.yaml` and
`packages/backend/convex/schema.ts` is **empty**. Nothing was installed. No table, no module, no
route, no scheduler code. `schema.ts:442` still carries, verbatim, "There is deliberately NO
`routines` table, cron, trigger, recurrence, next-run timestamp, execution-history table, canvas
or DSL."

The whole diff for this plan is **one new file** (`packages/backend/convex/routines.test.ts`), its
registration in `docs/playbooks/watch.json`, and the playbook section CLAUDE.md §9 requires.

## The absence proof — and why it is not vacuous

`packages/backend/convex/routines.test.ts`, **8 tests**.

This repo has already shipped a vacuous absence test: `apps/web/e2e/workflow-pack-pilot.spec.ts`
had a `toHaveCount(0)` that **passed with all six packs active**, because it succeeded on its
first poll before the Convex query resolved. A grep that finds nothing because the path was
misspelled is indistinguishable from a grep that finds nothing because the feature is absent. So
every claim below sits next to a **positive control** in the same test, and every claim was
**observed RED** by temporarily creating the forbidden thing.

| # | Claim | Positive control (same scan, same corpus) | Observed RED by |
|---|---|---|---|
| 1 | No table name matches `routine\|cron\|recurr\|schedul` — read from the **parsed schema object**, not source text | the object holds >30 tables and contains `savedPrompts`, `audit`, `contacts`, `tenantSkills` | planting `routines: defineTable({ tenantId, nextRunAt })` in `schema.ts` → **1 failed** (and the machinery test caught the `nextRunAt` too) |
| 2 | `schema.ts` still carries the deferral sentence verbatim (line-wrap normalised, words compared) | — | (covered by 1; the sentence is the thing being guarded) |
| 3 | No convex module is named for routines/scheduling; `crons.ts` is the single **named** exception | the recursive listing has >50 files and contains `schema.ts`, `crons.ts`, `savedPrompts.ts`, `lib/functions.ts`, `render/renderReel.ts` | creating `convex/routines.ts` → **1 failed** |
| 4 | `crons.ts` registers exactly five global system jobs, none named for a routine, and contains no `tenantId` | the five job names are asserted **literally** | — (the literal list is itself the control: adding or renaming a job fails it) |
| 5 | No UI route or component is recurrence-shaped | the walk has >20 files and contains `dashboard/workflows/page.tsx` and `dashboard/workspace/page.tsx` | creating `dashboard/routines/page.tsx` → **1 failed** |
| 6 | No identifier computes or stores a next occurrence (`nextRunAt`, `nextRun`, `nextOccurrence`, `occurrenceKey`, `cronExpression`, `rrule`, `recurrenceRule`, `routineId`, `routineRun`, `standingApproval`) — **comments stripped first** | after stripping, the corpus still contains `ctx.scheduler` in >5 files and `cronJobs` in `crons.ts` | appending `export const nextRunAt = 0;` to `convex/lib/hash.ts` → **1 failed** |
| 7 | No manifest names `temporal` — reusing the gate's own `deferAbsenceChecks` rather than re-implementing it | `DEPENDENCY_MANIFESTS` contains `pnpm-lock.yaml` and `apps/web/package.json`, and every manifest reads non-empty | adding `@js-temporal/polyfill` to `packages/backend/package.json` → **1 failed** |
| 8 | The recorded decision is still `defer` — the branch guard for this entire file | the record parses under the closed schema | flipping the frontmatter to `enable-safe` → **1 failed** |

All seven mutations reverted; the tree was re-verified after each.

### Two extra vacuity proofs, because the controls themselves could be decorative

- Pointing a scan at a misspelled root (`packages/backend/convexTYPO`) **throws `ENOENT`** — the
  file fails loudly rather than silently scanning an empty list. `readdirSync` is the right
  primitive here precisely because it cannot return "nothing" for a wrong path.
- Forcing every scan to return an empty list (the exact shape of the pack-pilot defect) turns
  **three positive controls RED** while every absence assertion would still have "passed". That is
  the measurement that separates a real absence from a broken search.

### On not duplicating an existing guard (ponytail rung 2)

`schema.test.ts` already owns the exhaustive storage guard — an 11-name banned-table list, a
substring scan over every table name, and a field-name scan over the schema source. Round 1 of
`routineDecision.test.ts` rebuilt a weaker version of it (two hardcoded regexes) that was blind to
a `standingRoutines` table. `routines.test.ts` does **not** repeat that: the table half is one
assertion against the parsed schema object, `schema.test.ts` is cited by name in the header, and
the other four claims (module, cron registry, route, next-occurrence identifiers) are things
`schema.test.ts` does not look at. The dependency claim reuses the gate's `deferAbsenceChecks`
outright rather than re-greping manifests. Round 1's `deferral means the absence is still in the
tree` describe block was removed from `routineDecision.test.ts` in the same phase, so there is one
absence proof, not three.

## Task 2

Task 2's `defer` instruction is "run the absence proof and document manual baseline as final."
Done: the absence proof is the file above, and the manual baseline is final — ROUT-02 completes on
the **pinned manual rerun** (`savedPrompts` + pinned workflows), not a scheduler. None of Task 2's
enabled-branch work (fake timers, concurrent claims, reauth auto-pause, reserve/settle replay,
two-tenant isolation) applies, because there is no state machine to race. Nothing was stubbed or
scaffolded toward one.

## Gates

| Gate | Result |
|---|---|
| `check-routine-gate.mjs <artifact> --validate-decision` | **exit 0** · `OK --validate-decision (decision: defer)` |
| `check-routine-gate.mjs <artifact> --matrix` | exit 0 |
| `check-routine-gate.mjs <artifact> --eligibility` | exit 1 (13 problems) — `enable-safe` remains unreachable |
| `cd packages/backend && pnpm vitest run routines routineDecision` | **82 passed** (8 + 74) |
| `cd packages/core && pnpm vitest run routineSchedule` | 19 passed |
| `cd packages/backend && pnpm typecheck` | clean |
| `cd packages/core && pnpm typecheck` | clean |
| `npx biome check` (new file) | clean |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | silent (passed) |

## What a later plan must know

- `routines.test.ts`'s last test fails **first** if the decision record is ever flipped to
  `enable-safe`. That is deliberate: the absence proof must be revisited by a human decision, not
  quietly deleted, and certainly not left green over a shipped scheduler.
- The ADR number for standing-routine governance is **027**. `013` is taken by
  `013-the-render-worker.md`; the 29-11 plan text naming 013 is wrong. Never edit an accepted ADR.
- §7 of the decision record names the three live traces that would have to exist, and now says
  outright that **two of them cannot be machine-enforced** — the gate can see `evidenceType: live`
  and a resolving citation, and nothing else. Whoever runs that checkpoint reads the traces.
