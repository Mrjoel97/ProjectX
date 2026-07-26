# Deferred items — Phase 15.1

Out-of-scope discoveries logged during execution. These are NOT caused by this phase's changes and
were deliberately NOT fixed (SCOPE BOUNDARY).

## 1. Backend full-suite run is FLAKY on this worktree (found during 15.1-01)

**Symptom:** `pnpm --filter @pikar/backend exec vitest run` reports 6-7 failures, but the failing SET
changes between runs (run 1: `audit`, `cockpitDraft`, `onboarding`, `runCockpitAgent`, `voice`,
`voiceBriefDraft`×2 — run 2: swapped `voiceBriefDraft`'s second test for `optimizerEligibility`).
Every affected file **passes in isolation**:

| File | In isolation |
|---|---|
| `convex/cockpitDraft.test.ts` | 3/3 pass |
| `convex/onboarding.test.ts` | 12/12 pass |
| `convex/optimizerEligibility.test.ts` | 6/6 pass |
| `convex/runCockpitAgent.test.ts` | 22/22 pass |
| `convex/voice.test.ts` | 8/8 pass |
| `convex/voiceBriefDraft.test.ts` | 2/2 pass |
| `convex/audit.test.ts` | 1/1 **FAIL** — the DOCUMENTED `auditCounts` baseline red |

**Cause (not investigated further):** all failures are the same class —
`Error: Component "<name>" is not registered. Call "t.registerComponent"` (`rateLimiter`,
`auditCounts`) — surfacing under vitest's parallel file execution, i.e. a convex-test component
registration / resource artifact of running 44 convex-test files concurrently on this machine.

**Why not fixed:** 15.1-01 touched exactly one backend file (`schema.ts`) and only ADDED a table. No
runtime backend code changed (see `git diff --stat e4dce47..HEAD`). This is pre-existing and
unrelated to the plan's changes.

**Consequence for later plans:** the documented "backend 544/545, sole red = `audit.test.ts`
`auditCounts`" baseline holds only for ISOLATED runs. Do not read a noisy full-suite number as a
regression — re-run the specific failing file on its own before concluding anything.
