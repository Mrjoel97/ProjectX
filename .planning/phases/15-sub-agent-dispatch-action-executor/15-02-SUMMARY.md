---
phase: 15-sub-agent-dispatch-action-executor
plan: 02
subsystem: agent-runtime
tags: [specialists, dispatch, agent-loop, capability-grant, adr, convex, vitest, typescript]

# Dependency graph
requires:
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 01
    provides: "the empty SPECIALISTS registry + fail-closed resolveSpecialist, the three dispatch* agentSteps.tool literals SpecialistSpec.stepTool is typed against, and the finalized lane file-ownership contract"
  - phase: 03-cockpit
    provides: "runAgentLoop as THE one tool-bearing generateText, buildCockpitTools' 20-key record, the omitRecipientEdits structural-absence precedent, and the __runCockpitAgentWithScript mock-model harness"
  - phase: 12-business-evaluation-engine
    provides: "diagnose()'s Prescription.route literals (now closed to the union) and the buildMemo document-not-a-prompt precedent"
provides:
  - "SPECIALISTS — three registered (skillName, tools, stepTool) triples; tools is [searchVault] ONLY, asserted as an equality over the whole registry"
  - "Prescription.route closed to SpecialistRoute | \"\" (the ask branch's \"\" stays representable on purpose)"
  - "wouldCycle(ancestry, route) — the A→B→A refusal predicate, unit-testable with no Convex harness"
  - "specialistMemoBody({route, body, incomplete}) — the deterministic memo composer; the cost-ceiling marker lives in the BODY, never on plans.status"
  - "runAgentLoop toolNames?: readonly string[] — ABSENT ⇒ the full record, [] ⇒ empty; structural absence, not activeTools"
  - "runSpecialistTurn — the ONE exported specialist entry into the governed loop; returns skillVersion for the lineage audit row"
  - "ADR-007 — sub-agent capability is code-owned, the sub-agent prompt is registry-owned"
affects: [15-03, 15-04, 15-05, 15-06, 15.1]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capability = code-owned readonly data; prompt = registry row (§5). ADR-007."
    - "Withholding a tool means REMOVING its key from the record, never activeTools and never skill wording"
    - "`=== undefined`, not truthiness, for any append-only optional that can legitimately be empty"
    - "Coverage bind: a source-text scan that feeds diagnose.ts's own route literals through the real lookup"

key-files:
  created:
    - docs/decisions/007-sub-agent-capability-is-code-owned.md
  modified:
    - packages/core/src/specialists.ts
    - packages/core/src/specialists.test.ts
    - packages/core/src/growth/diagnose.ts
    - packages/core/src/growth/diagnose.test.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/runCockpitAgent.test.ts
    - docs/playbooks/growth-diagnostic.md
    - docs/playbooks/cockpit.md

key-decisions:
  - "evaluateBusiness is deliberately NOT granted to any specialist — it persists an evaluations row + an audit row per call and re-enters the engine mid-dispatch; the snapshot rides the PROMPT instead"
  - "The incomplete/cost-ceiling marker lives in the memo BODY, not a new plans.status literal (the status enum is PINNED with apps/web blast radius)"
  - "The three skillName strings are INLINED copies of the @pikar/contracts constants (contracts is not a core dependency); a source-text test binds the copies"
  - "The rx() helper's route param is typed SpecialistRoute (stricter than Prescription's SpecialistRoute | \"\") — only the ask branch emits \"\""
  - "runAgentLoop stays module-private; runSpecialistTurn is the only exported specialist entry point"

patterns-established:
  - "Tool-set equality asserted over the WHOLE registry so a widening edit fails a test instead of passing quietly"
  - "Behavioural withholding assertions on the SIDE EFFECT (plan row + activity steps), never on an error string"
  - "A non-vacuity companion test (a NAMED tool still runs) beside every absence assertion"

requirements-completed: [DISP-01]

# Metrics
duration: 25min
completed: 2026-07-25
---

# Phase 15 Plan 02: Specialist Registry + The ONE Loop Seam Summary

**A named specialist is now a resolvable `(skill body, tool-set)` pair that runs in THE governed loop through one append-only optional arg — the capability grant is code-owned and withheld by structural absence, the prompt stays a §5 registry row.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 of 3 (2 TDD, RED confirmed before GREEN on both)
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments

- **Three specialists resolve; nothing else does.** `offer-architect` /
  `money-model-designer` / `lead-engine` each carry a `(skillName, tools, stepTool)` triple. The
  Wave-0 fail-closed half is intact and now has more surface to protect: `""`, wrong case
  (`Offer-Architect`), trailing whitespace, traversal shapes and the four prototype keys all still
  return `unknown_route` with no default and no throw.
- **The tool-set is asserted as an EQUALITY over the whole registry.** `["searchVault"]` for all
  three. Adding a write tool to any one specialist fails a test rather than shipping quietly —
  which is the entire enforcement mechanism behind ADR-007's "capability is code-owned".
- **`evaluateBusiness` is withheld on purpose and the reasoning is pinned in the source.** Its
  read-shaped name hides an `internal.evaluations.runEvaluation` call that persists a row, writes
  an audit row, and re-enters the diagnostic engine mid-dispatch (RESEARCH Pitfall 10). 15-03
  injects the snapshot through the PROMPT instead.
- **`Prescription.route` is closed to `SpecialistRoute | ""`** with the `""` member deliberately
  representable — it is what the not-enough-data ask branch emits, and `resolveSpecialist("")`
  refuses it at runtime. Dependency direction is `growth/ → specialists`, never the reverse.
- **The coverage bind is a real runtime assertion, not a comment.** `specialists.test.ts` reads
  `diagnose.ts` off disk, balanced-paren slices every `rx(...)` call plus the object-literal
  `route:` branch, and feeds all 11 literals through `resolveSpecialist`. If `diagnose()` grows a
  gate with a new route, the test fails until the specialist is registered. It carries a
  non-vacuity floor and fails loudly if the scan ever stops seeing the literals.
- **`runAgentLoop` gained ONE append-only optional arg and every pre-existing caller is
  byte-identical.** The whole 22-test `runCockpitAgent.test.ts` + 57-test `cockpitTools.test.ts`
  suite is green unchanged; that is the proof, not a claim.
- **`[]` is not `undefined`.** The filter tests `toolNames === undefined`, and a dedicated test
  asserts an empty allow-list yields an EMPTY record — the `[] ?? full` falsy-vs-absent bug fails
  loudly instead of silently granting a zero-tool specialist all 20 keys.
- **Withholding is structural.** A withheld tool leaves no plan-row side effect AND no activity
  step row — the key is gone from the record, so `ai@7` never reaches `execute`. Asserted
  behaviourally (never on an error string), with a non-vacuity companion proving a NAMED tool
  still runs.
- **`runSpecialistTurn` is the only exported specialist entry into the loop**; `runAgentLoop`
  stays module-private, which is what keeps "no agent spawns an agent" checkable by reading one
  file. It loads its body through the §5 loaders (fail-closed on both branches) and returns
  `skillVersion` so 15-03 can put `{name, version}` on the lineage audit row.

## Task Commits

1. **Task 1 RED** — `de0e51e` (test): failing registry/coverage-bind/wouldCycle/memo assertions
2. **Task 1 GREEN** — `e7b70d6` (feat): three specialists registered; `Prescription.route` closed
3. **Task 2 RED** — `79905a7` (test): failing `toolNames` seam assertions
4. **Task 2 GREEN** — `a604a9b` (feat): `toolNames` filter + `runSpecialistTurn`
5. **Task 3** — `42020e8` (docs): ADR-007 + both playbooks

## Files Created/Modified

- `packages/core/src/specialists.ts` — `SPECIALIST_ROUTES` (3), `SPECIALISTS`, `SPECIALIST_TOOLS`
  (the grant, with the `evaluateBusiness` refusal reasoning), `wouldCycle`, `specialistMemoBody`
- `packages/core/src/specialists.test.ts` — 21 assertions: registry shape, tool-set equality,
  distinct `dispatch*` step literals, contracts-name binding, the fail-closed set, the
  diagnose.ts coverage bind, `wouldCycle`, `specialistMemoBody`
- `packages/core/src/growth/diagnose.ts` — `Prescription.route: SpecialistRoute | ""`; `rx()`'s
  route param typed `SpecialistRoute`. No logic, gate order, or literal changed.
- `packages/core/src/growth/diagnose.test.ts` — one `as const` on the `leverageRank` fixture (see
  deviations)
- `packages/backend/convex/llm.ts` — `runAgentLoop` `toolNames?` + the `=== undefined` filter;
  exported `runSpecialistTurn`; `__runCockpitAgentWithScript` gained a `toolNames` arg
- `packages/backend/convex/runCockpitAgent.test.ts` — 4 new tests + a `runTolerant` helper
- `docs/decisions/007-sub-agent-capability-is-code-owned.md` — new ADR
- `docs/playbooks/growth-diagnostic.md` — route union, the `""` rationale, the
  every-emitted-route-must-resolve invariant, ADR-007 link, `Last verified` bumped
- `docs/playbooks/cockpit.md` — new append-only `### Phase 15 — Lane A (dispatch core)`
  subsection, `Last verified` bumped

## Decisions Made

- **`evaluateBusiness` stays out of the grant.** Documented as a comment on the registry itself so
  a future phase reading only the code does not "fix" the omission.
- **The cost-ceiling marker lives in the memo body.** A `plans.status` literal would touch the
  PINNED status enum (`schema.ts:155-164`) with `apps/web` blast radius, and the body is visible at
  exactly the surface (the Approve gate) where the human decides. Marked with a `ponytail:` comment
  naming the status-literal upgrade path.
- **Skill names are inlined, not imported.** `@pikar/contracts` is not a dependency of
  `@pikar/core` (`package.json`), and adding one to carry three strings inverts nothing but the
  dependency graph. `specialists.test.ts` reads `packages/contracts/src/skill.ts` off disk and
  asserts the exact `export const NAME = "value" as const;` line, so a rename on either side fails.
- **`rx()`'s route param is `SpecialistRoute`, stricter than `Prescription["route"]`.** All ten
  `rx()` call sites pass a non-empty literal; only the ask branch (which builds its object literal
  directly) emits `""`. Tightening it costs nothing and documents the split.
- **The coverage bind scan skips quoted/templated spans whole.** A depth-only walker mis-split the
  final `rx("scale", "No failing gate — offer, money model, and leads are healthy.", …)` call on
  the commas *inside* the prose argument, silently reading `" money model"` as the route. Caught
  during implementation.
- **The withheld-tool assertions are on the side effect, never on an error string**, and each is
  paired with a non-vacuity companion (`toolNames: ["setSubject"]` must still write the subject) —
  otherwise a filter that returned `{}` unconditionally would pass every absence test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Closing `Prescription.route` broke `diagnose.test.ts`'s typecheck**
- **Found during:** Task 1 (`pnpm --filter @pikar/core exec tsc --noEmit`)
- **Issue:** The plan's `<done>` required `diagnose.test.ts` to stay unchanged, but its
  `leverageRank` fixture helper `mk` is un-annotated, so its `route: ""` widens to `string` — no
  longer assignable to `Prescription`. Four TS2322 errors. The tests still PASSED (vitest does not
  typecheck), so this would have shipped a red `pnpm typecheck` invisible to the plan's own vitest
  verify command.
- **Fix:** one token — `route: "" as const` — plus a comment naming the cause. No behaviour, no
  assertion, and no fixture value changed; the file's 13 tests are green.
- **Files modified:** `packages/core/src/growth/diagnose.test.ts`
- **Commit:** `e7b70d6`

**2. [Rule 1 - Bug] The plan-specified `proposePlan` withholding fixture could not work**
- **Found during:** Task 2 RED
- **Issue:** `<behavior>` named `proposePlan` as the withheld tool to assert against ("the plan row
  shows no proposal"). `proposePlan` refuses a plan with no recipients and no body, so the control
  case (`toolNames` ABSENT) also failed to reach `proposed` — the assertion could never
  discriminate the filter from the tool's own precondition.
- **Fix:** switched the script to `setSubject` + `addRecipients` — two write tools with two
  independently observable slots and no preconditions. Same invariant, now actually testable in
  both directions.
- **Files modified:** `packages/backend/convex/runCockpitAgent.test.ts`
- **Commit:** `a604a9b`

**3. [Rule 1 - Bug] The coverage-bind source scan mis-parsed prose arguments**
- **Found during:** Task 1 GREEN
- **Issue:** A balanced-paren/bracket walker that is blind to string literals split the `"scale"`
  branch's constraint prose on its internal commas and read `" money model"` as the route.
- **Fix:** the walker now skips quoted and templated spans whole (with backslash-escape handling).
  All 11 literals extract correctly; the non-vacuity floor guards the scan itself.
- **Files modified:** `packages/core/src/specialists.test.ts`
- **Commit:** `e7b70d6`

---

**Total deviations:** 3 auto-fixed (1 blocking typecheck break the plan's own verify command could
not see, 2 bugs in plan-supplied test premises).
**Impact on plan:** No scope creep, no architectural change. Every deviation preserves the plan's
stated intent while making its premise true.

## Out-of-scope discoveries (logged, NOT fixed)

None new this plan. The two pre-existing items in
`.planning/phases/15-sub-agent-dispatch-action-executor/deferred-items.md` (`@pikar/audit` has no
`tsconfig.json`; `replyToMessage` has no `VERB` entry) are unchanged.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/core exec vitest run` | 219/219 green (16 files; +11 new) |
| `pnpm --filter @pikar/backend exec vitest run` | 504/505 — sole red is the documented pre-existing `audit.test.ts` `auditCounts` row |
| `runCockpitAgent.test.ts` + `cockpitTools.test.ts` | 79/79 green (22 + 57; every pre-existing assertion untouched — the proof `toolNames` is additive) |
| `@pikar/core` `tsc --noEmit` | exit 0, clean |
| backend `tsc --noEmit` | 52 errors — the exact pre-existing baseline, ZERO in any non-test file |
| `apps/web` `tsc --noEmit` (Pitfall 4 tripwire) | exit 0 — `runSpecialistTurn`'s explicit return type held the generated API |
| `npx turbo run typecheck --continue` | 8 successful / 10 — the documented baseline (`@pikar/audit` has no tsconfig; `@pikar/backend`'s 52 test-file errors) |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `git diff --exit-code` on `deliverApprovedPlan.ts` / `cockpit.ts` / `actionType.ts` | exit 0 — Lane A touched no Lane-B file |
| `git diff --exit-code -- apps/` | exit 0 — `apps/web` still frozen after Wave 0 |

## Issues Encountered

- Two of the four new `toolNames` tests pass VACUOUSLY at RED (the Convex arg validator rejects the
  unknown arg, `runTolerant` swallows it, and "nothing happened" satisfies an absence assertion).
  That is inherent to testing absence. The `toolNames: ["setSubject"]` non-vacuity test is what
  makes the set meaningful, and it failed correctly at RED.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**FOR 15-03 (the dispatcher):**
- Call `runSpecialistTurn(ctx, {tenantId, planId, skillName: spec.skillName, toolNames: spec.tools,
  prompt, turnId, threadId})`. Do NOT import `runAgentLoop` — it is module-private, and
  `dispatchGuard.test.ts` pins exactly one tool-bearing `generateText` call site.
- The returned `skillVersion` is there for the lineage audit row's `{name, version}` — use it;
  closing that loop is the §5/IMPR-03 obligation.
- `wouldCycle(ancestry, route)` already exists and is tested. Call it; do not re-derive it inline.
- The specialist's evaluation context must ride the PROMPT (`internal.evaluations.lastForThread`),
  because `evaluateBusiness` is not in the grant and must not be added.
- `spec.stepTool` is already typed to exactly the three closed `agentSteps.tool` literals, so a
  trace step naming a non-existent tool is a compile error.

**FOR 15-04 (the memo surface):** `specialistMemoBody({route, body, incomplete})` is the composer —
`@pikar/core` exports it via the barrel. The incomplete marker is a BODY string; do not add a
`plans.status` literal for it.

**FOR 15.1 (tier filtering):** `SPECIALISTS` is a pure data record in `@pikar/core`. A tier filter
is a filter over that record at dispatch time — still code-owned, still an allow-list. ADR-007
forbids making the tool-set DB-writable.

**FOR ALL:** `apps/web` remains FROZEN. `docs/playbooks/watch.json` is a Wave-0 singleton.
`docs/playbooks/cockpit.md` is append-only per-plan `### Phase 15 — …` subsections under the
`## Phase 15` container.

---
*Phase: 15-sub-agent-dispatch-action-executor*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 8 claimed files exist on disk and all 5 task commits resolve in git history. Every `must_haves`
artifact assertion verified: `specialists.ts` is 125 lines (min 60) and exports all five named
symbols (`SPECIALIST_ROUTES`, `SPECIALISTS`, `resolveSpecialist`, `wouldCycle`,
`specialistMemoBody`); `diagnose.ts` contains `SpecialistRoute` (3 occurrences, incl. the
`from "../specialists"` key link); `llm.ts` contains `toolNames` (11 occurrences, incl. the
`runSpecialistTurn` key link); `007-sub-agent-capability-is-code-owned.md` exists.
