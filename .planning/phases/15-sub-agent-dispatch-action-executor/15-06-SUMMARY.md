---
phase: 15-sub-agent-dispatch-action-executor
plan: 06
subsystem: skill-registry
tags: [skills, eval-gate, specialists, golden-fixtures, dispatch, playbooks, unpaid-gate]
status: complete
completed: 2026-07-25
requirements-completed: [DISP-01, ACTN-01]

# Dependency graph
requires:
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 02
    provides: "SPECIALISTS + the ['searchVault'] tool grant + ADR-007 — the ONE tool each rewritten body is allowed to name"
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 03
    provides: "governedDispatch + internal.dispatch.runSpecialist — what the fixtures' tap actually runs"
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 04
    provides: "actOnGap's two terminals + landSpecialistResult — the collecting→proposed flip the fixtures assert on"
  - phase: 12-business-evaluation-engine
    provides: "the 12-02 specialist rubric bodies, the 27/28 fixture precedent, and the 12-06 vacuous-pass lesson"
provides:
  - "Three RUNNABLE specialist bodies — each names searchVault, states the read-only posture, and makes not-enough-data an affirmative answer"
  - "SKILL_NAMES derived from GATED_SKILLS (read off skill.ts) — every gated skill is pinnable the day it is gated"
  - "--skill is MULTI-pin: one run, one cost, one evidence row PER pin"
  - "planKind / attributionRoute / citesVaultDoc + the actOnGap fixture field — the dispatch observables, each structurally paired"
  - "internal.evaluations.actOnGapInternal — the identity-less twin of actOnGap over a shared applyActOnGap"
  - "Three end-to-end fixtures (29/30/31) covering all three specialist routes"
affects: [15.1, 16, 17, 18, 19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derive a runner's list from the source of truth off disk rather than re-listing it (the specialists.test.ts scan precedent)"
    - "A closed-vocabulary expect key that could pass vacuously gets a STRUCTURAL pairing rule in validateFixture, not a comment"
    - "One implementation + an explicit-tenantId twin whenever an identity-less caller needs a tenant-scoped path"
    - "An unpayable gate is recorded as unpaid — never faked, never stubbed, never claimed"

key-files:
  created:
    - packages/backend/scripts/eval-cases/29-gap-dispatch-offer-architect.json
    - packages/backend/scripts/eval-cases/30-gap-dispatch-money-model.json
    - packages/backend/scripts/eval-cases/31-gap-dispatch-lead-engine.json
  modified:
    - packages/contracts/skills/offer-architect.md
    - packages/contracts/skills/money-model-designer.md
    - packages/contracts/skills/lead-engine.md
    - packages/contracts/src/skills/offerArchitect.ts
    - packages/contracts/src/skills/moneyModelDesigner.ts
    - packages/contracts/src/skills/leadEngine.ts
    - packages/backend/scripts/run-eval-golden.mjs
    - packages/backend/convex/evaluations.ts
    - docs/playbooks/skill-registry.md
    - docs/playbooks/agent-runtime.md
    - docs/playbooks/business-evaluation.md

key-decisions:
  - "citesVaultDoc probes the SEEDED CORPUS NEEDLE (`evalgrd`), not a vault title root — a title root would be echoed straight out of the fixture's own turns and pass vacuously; validateFixture forbids any turn from containing the needle"
  - "attributionRoute is validated against SPECIALIST_ROUTES (@pikar/core), not GATED_SKILLS — gated ⊃ dispatchable, and `swot` is a gated skill no gap can ever dispatch to"
  - "actOnGapInternal is a twin over a SHARED applyActOnGap, not a smoke-only re-implementation — a fixture must drive the real path or it proves nothing"
  - "The runner POLLS plans:getById out of `collecting` rather than sleeping a fixed interval: landSpecialistResult lands in a `finally` on every outcome, so leaving `collecting` is the unconditional signal"
  - "The gate was NOT run and NOT faked — this worktree has no CONVEX_DEPLOYMENT. Ship dark per CONTEXT; the candidates park, the active v1 bodies stay live"

patterns-established:
  - "Pair every zero-count/absence assertion with a structural validator rule (actOnGap requires gapCount > actOnGap; every dispatch observable requires actOnGap)"
  - "Mutation-check a new offline self-check before claiming it — three mutations were injected and reverted"

requirements-completed: [DISP-01]

# Metrics
duration: ~45min
completed: 2026-07-26
---

# Phase 15 Plan 06: Runnable Specialist Bodies + a Multi-Pin Eval Gate Summary

**The three specialists now instruct their own grounding through the one tool they have, and one
eval run can certify all three at once — but the gate itself is UNPAID, because this worktree has
no Convex deployment, so the candidates park and the phase ships dark exactly as CONTEXT
pre-decided.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 of 3 complete; Task 3 SPLIT — its offline half (both playbooks) done, its live half
  (seed → read back versions → run the gate → activate) returned as a CHECKPOINT
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments

- **The bodies stopped promising and started instructing.** All three carried the 12-02 placeholder
  *"Registered now; a full build runs later. For now you produce the method and the next step…"* —
  honest when written, false the moment 15-03 shipped dispatch. Each body now drops it and gains a
  **`## How to ground this`** section naming `searchVault` explicitly. That is the material change:
  every body already ended with *"Cite the user's own material for every claim"*, and until this
  phase the specialist had **no retrieval tool at all**, so that instruction was literally
  unsatisfiable.
- **Three properties survive in every body, deliberately.** (a) The tool is NAMED, not implied.
  (b) The read-only posture is stated in prose — *"You cannot send anything, save anything, or
  change the plan"* — reinforcing at the PROMPT layer what `SPECIALIST_TOOLS` already enforces
  structurally (ADR-007). (c) The not-enough-data state is an affirmative answer: *"say what is
  missing and what to gather; do not fill the gap from general knowledge"*. Each body's grounding
  section is tuned to its own failure mode — money-model's says invention does the most damage on
  NUMBERS, lead-engine's says channel advice is worthless when guessed.
- **The method is untouched and the financial-spine deferral got stronger.** The value equation,
  the four offer types, the thirty-day payback test, the four channels, the gate ordering — all
  byte-identical in substance. Each body's "financial link" section now says explicitly that it
  *never restates a figure the evaluation did not ground*, closing the one way a rewritten body
  could have made the memo assert an unGROUNDED number.
- **Eight of eleven gated skills were unpinnable, and are not any more.** `SKILL_NAMES` was a
  hardcoded `["cockpit-agent","document-drafter","inbox-digest"]`, so `--skill offer-architect@N`
  THREW at the pin parser — this plan could not have run its own gate under the old runner. It is
  now DERIVED from `GATED_SKILLS`, read off `packages/contracts/src/skill.ts` at startup (the runner
  is plain `.mjs` and cannot import the TS workspace package — the `specialists.test.ts`
  scan-the-source precedent). A newly gated skill is pinnable the day it is gated; there is no
  second list to drift.
- **`--skill` is MULTI-pin, so one sitting certifies the family.** Every occurrence is collected,
  the merged record is threaded on EVERY turn, and evidence is recorded **one row per pin off the
  SAME run**, each row carrying the FULL merged `skillVersions` because that is what the run
  actually carried. A repeated NAME is rejected outright — two versions of one skill is a bug, not
  a request.
- **A fixture can now drive the whole user path.** `actOnGap: <gapIndex>` taps the gap after the
  turns and then POLLS `plans:getById` out of `collecting`. Polling (not a fixed sleep) is the right
  signal because `landSpecialistResult` lands in a `finally` on every outcome — success, overrun,
  the four governed refusals and a throw — so leaving `collecting` is unconditional, and a timeout
  there means the deployment never ran the job (an environment problem, not a case failure).
- **`attributionRoute` is the assertion that actually discriminates, and the self-check proves it.**
  `status: "proposed"` + `planKind: "memo"` describes the FALLBACK memo just as well as a specialist
  run. So `--self-check` first asserts that status+kind alone PASSES on a fallback body, and then
  asserts the same fallback FAILS `attributionRoute` and `citesVaultDoc`. The weak assertion's
  weakness is itself a test.
- **`citesVaultDoc` cannot pass vacuously.** It probes the seeded corpus needle `evalgrd`, and
  `validateFixture` **forbids any fixture turn from containing it**. A vault-title root like
  "Northwind" would have been echoed straight out of the fixture's own conversation; `evalgrd` can
  only reach a specialist's memo through a live `searchVault` result.
- **The 12-06 pair-every-zero-count lesson is now enforced STRUCTURALLY, not by discipline.**
  `actOnGap` REQUIRES `expect.gapCount > actOnGap` (tapping a gap the evaluation never surfaced
  measures the tap's `gap_not_found` refusal, not the specialist), and each of the three dispatch
  observables REQUIRES `actOnGap` (nothing dispatches without the tap). Both are `--self-check`
  negatives.
- **Three fixtures, one per route, aimed at three different `diagnose()` gates** — 29 at gate 1 (no
  offer on file), 30 at gate 2 (only one thing to sell), 31 at gate 3 (no channel running) — all
  describing the eval vault corpus's OWN business, so `searchVault` has real material to cite. Using
  three different routes is also what stops `attributionRoute` from being satisfiable by one
  hardcoded string.
- **Three self-check assertions were mutation-checked** (re-hardcoding `SKILL_NAMES` → red; forcing
  `citesVaultDoc` true → red; dropping the duplicate-pin guard → red), then reverted. A structural
  scan that has never been driven red is a comment.

## Task Commits

1. **Task 1** — `9809460` (feat): the three bodies rewritten + the 6-file mirror re-synced
2. **Task 2** — `b937ddc` (feat): derived `SKILL_NAMES`, multi-pin, the three observables,
   `actOnGapInternal`, three fixtures, floor 27 → 30
3. **Task 3 (offline half)** — `7b0baee` (docs): all three playbooks + the unpaid-gate deferral

## Files Created/Modified

- `packages/contracts/skills/{offer-architect,money-model-designer,lead-engine}.md` — canonical
  bodies: placeholder framing dropped, `## How to ground this` added, `## What you produce now`
  retitled, financial-spine deferral tightened
- `packages/contracts/src/skills/{offerArchitect,moneyModelDesigner,leadEngine}.ts` — regenerated
  byte-identically (`skillBodies.test.ts` green)
- `packages/backend/scripts/run-eval-golden.mjs` — `gatedSkillNames()` / `specialistRoutes()`
  source derivations, `parseSkillPins` + `skillVersionsOf`, the `actOnGap` validator pairing rules,
  `waitForDispatch`, the three new `evaluateExpect` cases, per-pin evidence, and ~120 lines of new
  `--self-check`
- `packages/backend/convex/evaluations.ts` — `ActOnGapResult` + `applyActOnGap` extracted; `actOnGap`
  is now a 2-line wrapper; `actOnGapInternal` added
- `packages/backend/scripts/eval-cases/29|30|31-gap-dispatch-*.json` — the three end-to-end fixtures
- `docs/playbooks/skill-registry.md` — the runnable bodies, ADR-007's registry/code split, the
  seeding rules (version collision + the bootstrap lie + Lane-A-only + `convex dev` does not seed),
  and the explicit **GATE OUTCOME: NOT RUN** with the recipe that closes it
- `docs/playbooks/agent-runtime.md` — the derived `SKILL_NAMES`, multi-pin + per-pin evidence, the
  three observables and why each one exists, the structural pairing rules, floor 27 → 30, and the
  `COST_CAP_USD` caveat (it counts only `runCockpitAgent` turns)
- `docs/playbooks/business-evaluation.md` — `applyActOnGap` behind two surfaces; add guards to the
  helper, never to a wrapper
- `.planning/.../deferred-items.md` — the unpaid gate: what was and was not done, what closes it,
  what evidence proves it

## Decisions Made

- **`citesVaultDoc` probes the corpus NEEDLE, not a title root.** The plan said "cites at least one
  vault document title". A title root ("Northwind") is exactly what the fixture's own turns say, so
  the model would emit it with or without a search. `evalgrd` is stamped into every seeded brief's
  title and body by `vaultSmoke:seedCorpus` and appears nowhere a fixture may write — the assertion
  is non-vacuous by construction, enforced by a validator rule rather than by care.
- **`attributionRoute` validates against `SPECIALIST_ROUTES`, not `SKILL_NAMES`.** `swot` is a real
  GATED skill that no gap can ever dispatch to; a fixture naming it would fail live for a reason
  that has nothing to do with the model. Gated ⊃ dispatchable, and the fixture contract is about
  what is dispatchable.
- **`actOnGapInternal` shares `applyActOnGap` rather than re-implementing the tap.** A smoke-only
  imitation of the two-terminal choice, the plan recycle and the scheduled dispatch would let the
  fixture pass while production diverged — the exact failure mode 15-03's "one governance function,
  two thin entry points" exists to prevent.
- **`COST_CAP_USD` stays at $1.00 and is honestly scoped.** It sums `runCockpitAgent` turns only;
  the dispatched specialist is a SECOND model call governed by the dispatcher's tree envelope. Both
  playbooks say so rather than implying the cap covers everything.
- **The gate was not run, and that is recorded rather than worked around.** No fixture weakened, no
  hand-activation, no stub. The ACTIVE v1 bodies stay live.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan's three fixtures were unbuildable — nothing could tap a gap from `convex run`**
- **Found during:** Task 2
- **Issue:** The plan requires fixtures that run "gap → 'Act on this' → dispatch → the staged plan
  body", but `actOnGap` is a `tenantMutation` and `npx convex run` carries no auth identity (the
  wall `vaultSmoke`/`smoke` already document). There was no callable surface at all, so the fixtures
  could not have been written, let alone run.
- **Fix:** extracted `actOnGap`'s handler verbatim into `applyActOnGap(ctx, tenantId, threadId,
  gapIndex)` and added `internal.evaluations.actOnGapInternal` over it — the 12-04
  `applyScorecardAnswer` / `recordScorecardAnswerInternal` precedent, named as such in the source.
  Zero behaviour change: the returned union is unchanged (now the named `ActOnGapResult`, explicit
  per Convex guidelines §96 so the generated API does not collapse), and the whole 18 + 5 + 31 test
  set across `evaluations.test.ts` / `gapAction.test.ts` / `dispatch.test.ts` is green unchanged.
  `evaluations.ts` is outside the plan's `files_modified`; it is recorded in
  `business-evaluation.md` in the same phase, per §9.
- **Files modified:** `packages/backend/convex/evaluations.ts`, `docs/playbooks/business-evaluation.md`
- **Commits:** `b937ddc`, `7b0baee`

**2. [Rule 1 - Bug] `citesVaultDoc` as literally specified would have passed vacuously**
- **Found during:** Task 2
- **Issue:** The plan's assertion is "the body cites at least one vault document title". The eval
  corpus's titles all begin "Northwind", and any fixture whose business is the corpus's business
  says "Northwind" in its own turns — so the model satisfies the assertion by echo, with or without
  a `searchVault` call. That is precisely the 12-06 vacuous-pass shape the plan itself warns about.
- **Fix:** the probe is the corpus NEEDLE (`evalgrd`), which `vaultSmoke:seedCorpus` stamps into
  every brief's title and body, plus a `validateFixture` rule refusing any fixture whose turns
  contain it. `--self-check` covers both the rejection and the "fails closed with no needle" case.
- **Files modified:** `packages/backend/scripts/run-eval-golden.mjs`
- **Commit:** `b937ddc`

**3. [Rule 1 - Bug] `attributionRoute` validated against the wrong list**
- **Found during:** Task 2 (`--self-check`, first run — the "must reject `swot`" assertion did not
  fire)
- **Issue:** the first implementation checked `attributionRoute` against `SKILL_NAMES`. `swot` IS a
  gated skill, so a fixture asserting `attributionRoute: "swot"` was accepted offline and would
  have failed live for a reason unrelated to the model.
- **Fix:** a second small source derivation, `specialistRoutes()`, reading `SPECIALIST_ROUTES` off
  `packages/core/src/specialists.ts`; `--self-check` asserts the derived trio AND that every
  dispatchable route is also gated (a body edit must ride the gate).
- **Files modified:** `packages/backend/scripts/run-eval-golden.mjs`
- **Commit:** `b937ddc`

### Out-of-scope churn reverted

`biome check --write` on the fixtures directory reflowed two UNRELATED fixtures
(`09-resolve-degradation`, `26-vault-empty`). Reverted — Lane A does not own them and a formatting
diff in a golden fixture is noise in a gate's history.

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs in plan-supplied assertion premises). No
scope creep, no architectural change.

## Deferred / Unpaid Gate

**The eval gate (Task 3, steps 1-3) was NOT run.** This worktree has no `CONVEX_DEPLOYMENT` — 15-01
bootstrapped it with a COPIED `packages/backend/convex/_generated`, because `convex codegen` refuses
to run without one. Anything needing a live backend or a real model call is impossible here:
`pnpm eval:golden`, `skills:seedSkills`, `getActiveSkill`, `activateSkill`.

Nothing was faked. No fixture was weakened. Nothing was hand-activated. Consequence, pre-decided by
15-CONTEXT: **SHIP DARK.** The rewritten bodies are parked as source; on the production deployment
the ACTIVE rows are still the v1 bodies with the "runs later" framing, so a dispatched specialist
today runs the OLD body. Phase 15's five success criteria are proven by 15-01..15-05 and none
requires a rewritten body — this blocks nothing that shipped.

Full recipe, risks and closing evidence are in
`.planning/phases/15-sub-agent-dispatch-action-executor/deferred-items.md` and in
`docs/playbooks/skill-registry.md`'s `GATE OUTCOME` paragraph.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/contracts exec vitest run` | 13/13 green (incl. all 7 `skillBodies.test.ts` md↔ts rows) |
| `node packages/backend/scripts/run-eval-golden.mjs --self-check` | exit 0 — 30 fixtures valid, 11 gated skills derived |
| Self-check mutation checks | re-hardcoded `SKILL_NAMES` → RED; `citesVaultDoc` forced true → RED; duplicate-pin guard removed → RED; all reverted |
| `pnpm --filter @pikar/backend exec vitest run` | **544/545** — sole red is the documented pre-existing `audit.test.ts` `auditCounts` row |
| `vitest run evaluations + gapAction + dispatch` | 54/54 green (18 + 5 + 31), every assertion byte-unchanged — the proof `applyActOnGap` is a pure extraction |
| `pnpm --filter @pikar/core exec vitest run` | 223/223 green (this plan touched no core file) |
| backend `tsc --noEmit` | 55 errors — the exact pre-existing baseline (measured by stashing this plan's diff), ZERO in any non-test file |
| `apps/web` `tsc --noEmit` (Pitfall 4 tripwire) | exit 0 — `actOnGapInternal`'s explicit `Promise<ActOnGapResult>` held the generated API |
| `npx turbo run typecheck --continue` | 8 successful / 10 — the documented baseline |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `git diff --exit-code -- cockpit.ts deliverApprovedPlan.ts actionType.ts apps/` | exit 0 — no Lane-B file, no web file |
| `pnpm eval:golden --skill …` (the gate) | **NOT RUN — no deployment.** Recorded as unpaid, not claimed |

## Issues Encountered

- `biome check --write` on `eval-cases/` reformats every fixture it touches. Scope the invocation or
  revert the collateral — a golden fixture's diff history is evidence.
- The plan's `<done>` for Task 2 asks that `--skill a@N --skill b@N --skill c@N` "parses without
  throwing". That is asserted in `--self-check` (`parseSkillPins` over exactly that argv shape)
  rather than by invoking the runner, because the real entry point proceeds straight into `runLive`
  and would fail on the absent deployment for an unrelated reason.

## User Setup Required

**Yes — the eval gate needs an owner with a live deployment.** See the CHECKPOINT below / the
deferred-items entry. Summary: `pnpm dev` to seed → read back each specialist's live version → one
`pnpm eval:golden` run with all three pinned (~$0.19 + three dispatched specialist turns) →
`activateSkill` each on green and verify with `getActiveSkill`; on red, leave them parked.

## Next Phase Readiness

**FOR 15.1 / 16-19 (each adds a capability):**
- A newly GATED skill is now pinnable the moment it is added to `GATED_SKILLS` — no runner edit.
- A new golden fixture that needs a non-conversational action (a tap, a click, an approval) follows
  `actOnGap`'s shape: an identity-less twin over the SHARED implementation, a fixture field, and a
  poll on the observable the production `finally` guarantees.
- Any new `expect` key that CAN pass vacuously must ship with a `validateFixture` pairing rule and a
  `--self-check` negative. `citesVaultDoc` is the worked example: the probe token is one no fixture
  is allowed to write.

**FOR ANYONE EDITING A SPECIALIST BODY:** it is a GATED skill, so the edit publishes a candidate and
`activateSkillVersion` refuses it without recorded passing evidence. Read back the LIVE version
before pinning — `seedSkills` writes `maxVersion + 1` and optimizer dry-runs occupy versions. And a
fresh deployment will LIE to you: the first seed lands v1 ACTIVE via the `rows.length === 0`
bootstrap path.

**FOR ALL:** `apps/web` remains FROZEN — untouched for the whole phase after Wave 0.

---
*Phase: 15-sub-agent-dispatch-action-executor*
*Completed: 2026-07-26*

## Self-Check: PASSED

All 14 claimed files exist on disk and all 3 task commits (`9809460`, `b937ddc`, `7b0baee`) resolve
in git history. Every `must_haves` artifact assertion verified: `offer-architect.md` contains
`searchVault`; `run-eval-golden.mjs` contains `GATED_SKILLS` (10 occurrences, incl. the derivation
key link); `eval-cases/` holds 30 fixtures (27 + the 3 new). Both `key_links` hold — the `.md`↔`.ts`
byte-identity is asserted by a green `skillBodies.test.ts`, and `SKILL_NAMES` is produced by
`gatedSkillNames()` reading `packages/contracts/src/skill.ts`, not by a literal array.
