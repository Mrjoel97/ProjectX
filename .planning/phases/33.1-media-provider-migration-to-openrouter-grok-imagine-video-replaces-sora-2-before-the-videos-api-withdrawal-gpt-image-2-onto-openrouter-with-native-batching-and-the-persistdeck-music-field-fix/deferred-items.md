# Phase 33.1 — deferred items

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary
(only auto-fix what the current task's changes directly caused).

## 1. `packages/backend/convex/dispatch.test.ts` is lint-RED before this phase touched it

Found during 33.1-01 Task 3, while biome-checking my own two files.

Two findings, **both pre-existing** — verified by piping `git show HEAD~2:packages/backend/convex/dispatch.test.ts`
(i.e. the lane base, `4aa26f2`, before any 33.1 commit) through `biome check --stdin-file-path`
and getting the identical pair:

| Finding | Location (post-33.1-01 line numbers) | Rule |
| --- | --- | --- |
| `runTolerant` is declared and never used | `dispatch.test.ts:242` | `lint/correctness/noUnusedVariables` (warning, FIXABLE) |
| A two-line arrow the formatter wants joined (`const vaultDocs = (t: T) => …`) | `dispatch.test.ts:~3326` | `format` (error) |

**Why this matters more than a normal lint nit.** `ci.yml` runs Typecheck → Lint → Test → Build,
so a Lint red disables every gate below it. The `format` finding is an ERROR, not a warning, so
`biome check` exits 1 on this file today. Whoever merges this lane into a branch that CI actually
runs on (ci.yml triggers only on push-to-main and pull_request) should expect Lint to fail and
Test/Build never to run.

Both fixes are mechanical (`_runTolerant`; join the two lines). Left alone here deliberately: they
predate this phase and this plan's rule is "the shortest diff that fixes the named defect".

**Not deferred, for the record:** the one biome error 33.1-01 *did* introduce
(`noUnsafeOptionalChaining` on the new A2 audit assertion) was fixed in the same task.

## 2. `packages/backend/convex/media.test.ts` — the caption BURN test is FLAKY, not a standing red

Baseline for 33.1-01, measured before any change on this branch: `1 failed | 2534 passed (2535)`.
The single failure is

```
FAIL convex/media.test.ts > the caption BURN terminal: a failure degrades the reel, it never
  unpublishes it > a transcript with no usable words never buys a sandbox
AssertionError: expected "spy" to be called +0 times, but got 1 times
  at convex/media.test.ts:4480:23
```

Untouched by 33.1-01 (which changed only `plans.ts` and `dispatch.test.ts`) — and the post-fix
full-suite run came back `0 failed | 2537 passed (2537)`, i.e. **the same test passed** with the
fix in and nothing near it changed.

So it is a LOAD-FLAKY test, not a standing red: a fetch spy asserted `toHaveBeenCalledTimes(0)`
that saw 1 call under full-suite load. Do not "fix" it by re-running until green, and do not
treat a single green run as proof it is healthy. It is in the media plane, so plans 33.1-02..06
will be working right next to it — expect it to reappear, and judge those waves by FAILURE COUNT
against a freshly measured baseline, not by exit code and not by this number.

Also present in every full-suite run on this branch, before and after:

```
Vitest caught 1 unhandled error during the test run.
ReferenceError: process is not defined
  ❯ ForksBaseWorker.executeTests .../vitest/dist/workers/forks.js:31:4
```

Known Windows-only vitest artifact; it is why the backend suite exits 1 while thousands pass.
