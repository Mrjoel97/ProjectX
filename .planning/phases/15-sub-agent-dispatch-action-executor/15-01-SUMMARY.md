---
phase: 15-sub-agent-dispatch-action-executor
plan: 01
subsystem: infra
tags: [convex, schema, rate-limiter, static-scan, convex-test, vitest, typescript, playbooks]

# Dependency graph
requires:
  - phase: 12-business-evaluation-engine
    provides: "diagnose()'s Prescription.route (the string specialists.ts consumes), the plans.kind memo discriminator actionTypeOf reads, and the evaluateBusiness agentSteps literal whose missing VERB entry this plan fixed"
  - phase: 03-cockpit
    provides: "the CLOSED agentSteps.tool union + the code-owned VERB map, runAgentLoop as THE one tool-bearing generateText, and the guardrails dailySpendCents keyless window"
provides:
  - "3 dispatch literals on the closed agentSteps.tool union (dispatchOfferArchitect / dispatchMoneyModelDesigner / dispatchLeadEngine) + their VERB entries"
  - "internal.guardrails.remainingDailyCents — the READABLE half of the daily-spend rail, clamped >= 0, explicit Promise<number>"
  - "packages/core/src/specialists.ts — SPECIALIST_ROUTES / SpecialistSpec / resolveSpecialist failing closed to unknown_route with ZERO registrations and no default"
  - "packages/core/src/actionType.ts — the closed ACTION_TYPES = [email, memo] union + actionTypeOf (absent plans.kind => email, no migration)"
  - "packages/backend/convex/dispatch.ts — the empty lane-owned dispatcher stub"
  - "dispatchGuard.test.ts — the no-nested-loop static scan (regression guard from day one)"
  - "watch.json registration of all 5 new source files + a finalized, non-provisional Phase-15 lane-ownership table"
affects: [15-02, 15-03, 15-04, 15-05, 15-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 freeze: every shared seam lands in ONE commit before any dependent plan starts"
    - "Register a new source path in watch.json in the SAME commit that creates the file"
    - "A static scan written BEFORE the code it guards is a regression guard, not a post-mortem"

key-files:
  created:
    - packages/core/src/specialists.ts
    - packages/core/src/specialists.test.ts
    - packages/core/src/actionType.ts
    - packages/core/src/actionType.test.ts
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/dispatch.test.ts
    - packages/backend/convex/dispatchGuard.test.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/guardrails.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - packages/core/src/index.ts
    - docs/playbooks/watch.json
    - docs/playbooks/cockpit.md
    - docs/playbooks/growth-diagnostic.md
    - .planning/PARALLELIZATION.md

key-decisions:
  - "The no-nested-loop scan counts TOOL-BEARING generateText call sites, not total ones — llm.ts legitimately holds 3, two being the toolless ingestion firewall"
  - "Zero lineage schema change was needed — AuditPayload already permits rootRequestId/parentAgentId and telemetry structurally cannot carry them"
  - "Phase 15 executes SERIALLY on lane-a/dispatch-core; the lane table is retained as a file-ownership CONTRACT, not a concurrency plan"
  - "resolveSpecialist uses hasOwnProperty, not a bare index read — __proto__/constructor resolve to truthy Object.prototype members"

patterns-established:
  - "Closed-union + VERB parity: every agentSteps.tool literal gets a VERB entry in the commit that adds it"
  - "Tool-bearing vs toolless generateText is the meaningful distinction for loop-count invariants"
  - "Append-only shared playbook section (## Phase 15) with per-plan ### subsections; keep both on merge conflict"

requirements-completed: [DISP-01, ACTN-01]

# Metrics
duration: 35min
completed: 2026-07-25
---

# Phase 15 Plan 01: Wave-0 Freeze Summary

**Closed the three silent-failure seams (schema literals + VERB entries + a readable daily-budget rail), shipped the fail-closed specialist lookup and the closed action-type union as tested stubs, and finalized the Phase-15 file-ownership contract.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-25T22:20:00Z
- **Completed:** 2026-07-25T22:55:00Z
- **Tasks:** 3 of 3
- **Files modified:** 15 (7 created, 8 modified)

## Accomplishments

- **The silent-failure trap is closed BEFORE any lane emits.** Three dispatch literals now sit on
  the closed `agentSteps.tool` union, and `dispatch.test.ts` inserts each one against the REAL
  schema. Without them the dispatch step's insert throws inside an SDK tool callback — which the
  SDK swallows — so prod would show a blank activity card while every test stayed green.
- **Every `agentSteps.tool` literal a lane will emit now has a `VERB` entry**, including the
  Phase-12 `evaluateBusiness` gap that had been rendering the `["Working…","Done"]` FALLBACK since
  12-04. This was the plan's only `apps/web` edit; `apps/web` is now frozen for Phase 15.
- **The daily-spend rail is readable.** `internal.guardrails.remainingDailyCents` uses
  `rateLimiter.getValue` (reads utilization without consuming tokens), clamped with `Math.max(0, …)`
  because `recordSpend`'s `reserve: true` drives the window negative on purpose.
- **`resolveSpecialist` fails closed with zero registrations and no default**, mirroring
  `parseRouting`: a discriminated result, never a throw, and no default route. 10 assertions
  including `""`, `"../../etc/passwd"`, `"__proto__"` and `"constructor"`.
- **`dispatchGuard.test.ts` is a regression guard from day one** — written before the code it
  guards, so it can never be a post-mortem.
- **The Stop hook does not block a lane touching the three new files** — `check-playbooks.mjs check`
  exits 0 with all five new source paths registered and both playbooks bumped in the same commit.

## Task Commits

1. **Task 1: The three silent-failure seams** — `dd15af6` (feat)
2. **Task 2: The two pure-TS stubs (TDD)** — `7d13e0e` (feat; RED confirmed before GREEN)
3. **Task 3: Convex stub, backend tests, watch.json + playbooks, lane table** — `05fa67c` (feat)

**Plan metadata:** see final `docs(15-01)` commit.

## Files Created/Modified

- `packages/backend/convex/schema.ts` — 3 dispatch literals appended to the closed `agentSteps.tool` union
- `packages/backend/convex/guardrails.ts` — `remainingDailyCents` internalQuery (explicit `Promise<number>`, clamped)
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — 4 new `VERB` entries (3 dispatch + `evaluateBusiness`)
- `packages/core/src/specialists.ts` — `SPECIALIST_ROUTES` / `SpecialistSpec` / `SPECIALISTS` / `resolveSpecialist`
- `packages/core/src/specialists.test.ts` — 10 fail-closed assertions incl. prototype-key cases
- `packages/core/src/actionType.ts` — `ACTION_TYPES` + `actionTypeOf`
- `packages/core/src/actionType.test.ts` — 3 assertions incl. the no-migration `undefined → "email"` case
- `packages/core/src/index.ts` — barrel exports both new modules (alphabetical)
- `packages/backend/convex/dispatch.ts` — the empty lane-owned stub with the DISP-01 contract in its header
- `packages/backend/convex/dispatch.test.ts` — inserts each dispatch literal against the real schema
- `packages/backend/convex/dispatchGuard.test.ts` — the no-nested-loop scan + a `// 15-05 adds:` marker
- `docs/playbooks/watch.json` — 5 new source paths registered under 2 existing playbooks
- `docs/playbooks/cockpit.md` — new append-only `## Phase 15` section + `### Wave 0 (freeze)` subsection, `Last verified` bumped
- `docs/playbooks/growth-diagnostic.md` — "Consumer side — specialist dispatch" key-files block, `Last verified` bumped
- `.planning/PARALLELIZATION.md` — Stage-2 table finalized (no longer provisional) + 6 contract amendments

## Decisions Made

- **The loop-count invariant counts TOOL-BEARING `generateText` call sites, not total ones.** The
  plan asserted `llm.ts` has exactly one `generateText(`; it actually has three. The other two are
  `digestInbox` / `draftReply` — the deliberately TOOLLESS untrusted-content ingestion firewall
  (agent-runtime.md invariant 10), each already pinned as toolless by `llmRedaction.test.ts`.
  Counting raw call sites would break every time that firewall grew a legitimate member while
  still missing a second loop hidden inside a tool. The scan now slices each call's arguments with
  a balanced-paren walk and counts the ones carrying `tools` — currently exactly 1.
- **The scan matches `tools\s*[,:]`, not `tools\s*:`.** `runAgentLoop` passes its tool set by
  ES shorthand (`tools,`). A colon-only regex made the assertion silently count 0 — a scan that
  would have passed vacuously forever if the expected count had been 0 instead of 1.
- **Zero lineage schema change.** RESEARCH Q5 held: `AuditPayload` already permits
  `rootRequestId`/`parentAgentId`, `audit.by_correlation` already exists, and `telemetry`
  structurally cannot carry them (`requestId: v.id("requests")`, and a specialist run seeds zero
  `requests` rows by design). PARALLELIZATION Stage-1 item (1)'s "lineage fields" was a no-op;
  what it actually needed were the three `agentSteps.tool` literals.
- **Phase 15 runs SERIALLY** (owner decision this session). The lane table was finalized anyway and
  is retained as the file-ownership CONTRACT — it is what keeps 15-05's executor work from
  colliding with 15-02/03/04's dispatch work even with one agent doing both.
- **`SpecialistSpec.tools` is code-owned, never DB-writable.** Only the skill BODY is a registry
  row (§5); a row that could widen its own tool set would be a privilege-escalation path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's `generateText` count assertion was false against the real source**
- **Found during:** Task 3 (dispatchGuard.test.ts)
- **Issue:** The plan specified "`convex/llm.ts` contains exactly ONE `generateText(` call site …
  assert the count as an equality". `llm.ts` has THREE. Two are the toolless ingestion calls, which
  are a different species entirely — an equality on the raw count would fail on day one and, once
  "fixed" to 3, would silently permit a fourth nested tool-bearing loop.
- **Fix:** Rewrote the assertion to count TOOL-BEARING call sites (balanced-paren slice of each
  call's arguments, filtered on `\btools\s*[,:]`), preserving the plan's stated INTENT (equality,
  so a second loop fails the day it appears) while making the premise true. Added a non-vacuity
  guard so a rename fails loudly instead of passing with 0.
- **Files modified:** `packages/backend/convex/dispatchGuard.test.ts`
- **Verification:** `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts` — 2/2 green; mutation-checked implicitly (the colon-only version returned 0 and failed RED).
- **Committed in:** `05fa67c`

**2. [Rule 3 - Blocking] The worktree had no `node_modules` and no `convex/_generated`**
- **Found during:** Task 1 verification
- **Issue:** `.worktrees/lane-a-dispatch` was created for planning only. Both `node_modules/` and
  `convex/_generated/` are git-ignored, so a worktree starts without them — no typecheck, no tests.
  `convex codegen` refuses to run without a `CONVEX_DEPLOYMENT`, and this worktree has no `.env.local`.
- **Fix:** `pnpm install --prefer-offline` (42s, all from the store), then copied `convex/_generated`
  from the main checkout. This is safe and not a stale-codegen hazard: `dataModel.d.ts` is fully
  DERIVED (`DataModelFromSchemaDefinition<typeof schema>` over a relative `../schema.js` import), so
  it picked up the three new literals automatically. `api.d.ts` only enumerates modules, and
  `dispatch.ts` exports nothing, so nothing references it. Both paths stay git-ignored — zero
  committed footprint.
- **Files modified:** none committed
- **Verification:** backend `tsc --noEmit` reproduces exactly the 52 documented pre-existing errors; `apps/web` typecheck exits 0.
- **Committed in:** n/a (git-ignored infrastructure)

---

**Total deviations:** 2 auto-fixed (1 bug in a plan-supplied assertion, 1 blocking environment gap)
**Impact on plan:** No scope creep. Deviation 1 preserves the plan's intent while making its premise
true — the plan's version would have shipped a failing (or, once "corrected" to 3, a weaker) guard.
Deviation 2 touched no committed file.

## Out-of-scope discoveries (logged, NOT fixed)

Recorded in `.planning/phases/15-sub-agent-dispatch-action-executor/deferred-items.md`:
- `@pikar/audit` has no `tsconfig.json` (pre-existing since `1782ab3`, identical on `main`), so
  `pnpm typecheck` halts there. Use `npx turbo run typecheck --continue` — 8 successful / 10 total.
- `replyToMessage` has no `VERB` entry (same class as the `evaluateBusiness` gap, but the plan named
  only `evaluateBusiness` and `apps/web` is frozen after Wave 0).

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/core exec vitest run` | 208/208 green (16 files; +13 new) |
| `pnpm --filter @pikar/backend exec vitest run` | 500/501 — sole red is the documented `audit.test.ts` `auditCounts` row |
| `convex/dispatch.test.ts` + `convex/dispatchGuard.test.ts` | 5/5 green |
| `apps/web` `tsc --noEmit` (Pitfall 4 tripwire) | exit 0, clean |
| backend `tsc --noEmit` | 52 errors — the exact pre-existing baseline, ZERO in any file this plan touched |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `git diff` on `deliverApprovedPlan.ts` / `llm.ts` / `cockpit.ts` | exit 0 — Wave 0 touched none of the three lane-owned hot files |

`runCockpitAgent.test.ts` timed out once (5000ms) in the full-suite run and passes in isolation at
3657ms — a cold-start artifact of this worktree's first-ever vitest run (106s collect time, no vite
cache), not a regression. It is green on re-run.

## Issues Encountered

- The full backend suite's first run in a fresh worktree pays the entire transform cost inside the
  per-test 5s timeout budget, which flaked `runCockpitAgent.test.ts`. Resolved by re-running in
  isolation (green). Worth knowing for 15-02..15-06: the first suite run after a cold checkout is
  not a trustworthy red.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Wave 0 is frozen. Every Phase-15 plan can now start without a shared-seam blocker.**

- **FOR 15-02 (specialist registry):** `SPECIALIST_ROUTES` is `[] as const satisfies readonly string[]`
  and `SPECIALISTS` is `{}`. Registering the three routes narrows `SpecialistRoute` automatically and
  makes `resolveSpecialist` start succeeding — but the RUNTIME `hasOwnProperty` branch must stay:
  `gap.route` persists as `v.string()` including diagnose.ts's deliberate `""`, so rows predating the
  union reach the lookup un-narrowed. `SpecialistSpec.stepTool` is already typed to exactly the three
  new schema literals, so a registration that names a non-existent step tool is a compile error.
  `specialists.test.ts`'s "unregistered route" case names `offer-architect` and WILL need updating —
  that is the intended signal, not a break.
- **FOR 15-03 (dispatch suite):** `dispatch.test.ts` currently holds only the literal-insert guard;
  append the real suite (depth cap, cycle refusal, envelope, lineage) beneath it. **SC #5 (two-tenant
  isolation) moved to this file** — the lineage rows keyed on `rootRequestId` are written by
  `dispatch.ts`. No schema change is needed for lineage.
- **FOR 15-05 (executor):** append to `dispatchGuard.test.ts` below the `// 15-05 adds:` marker so
  the two lanes' additions do not collide. `actionTypeOf` and `ACTION_TYPES` are exported from
  `@pikar/core`; adding a member without an arm should be made a COMPILE error at the arm table.
- **FOR ALL:** `apps/web` is FROZEN. `docs/playbooks/watch.json` is a Wave-0 singleton — do not edit
  it again this phase. `docs/playbooks/cockpit.md` is append-only: write inside your own
  `### Phase 15 — …` subsection under the `## Phase 15` container, bump `Last verified`, keep both
  sides on conflict.
- **Concern:** `internal.guardrails.remainingDailyCents` reads the DEPLOYMENT's budget, not the
  tenant's (`dailySpendCents` is a keyless window). No Phase-15 success criterion needs per-tenant
  budget, but any plan that phrases a user-facing message as "your remaining budget" would be lying.

---
*Phase: 15-sub-agent-dispatch-action-executor*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 7 created source files exist on disk, all 3 task commits resolve in git history, and every
must_haves `contains`/`exports` artifact assertion verified: `dispatchOfferArchitect` in
`schema.ts`, `remainingDailyCents` in `guardrails.ts`, `evaluateBusiness:` in `cards.tsx`,
`dispatch.ts` in `watch.json`, and the `export * from "./specialists"` barrel link.
