---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 15.1
current_plan: 1
status: in_progress
stopped_at: Completed 15.1-01-PLAN.md (Wave 0 freeze — tier rule + tenantProfiles + ADR-009)
last_updated: "2026-07-26T12:05:22.305Z"
progress:
  total_phases: 38
  completed_phases: 22
  total_plans: 163
  completed_plans: 153
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** Phase 15.1 — Fact-Derived Tier & Conversational Onboarding (IN PROGRESS, 1/7 plans; Wave 0 frozen)

## Current Position

Phase: 15.1 (Fact-Derived Tier & Conversational Onboarding) — **1 of 7 PLANS COMPLETE** (6 waves)
Current Plan: 1
Total Plans in Phase: 7
Plan: 15.1-01 COMPLETE (Wave 0 — the shared-seam freeze).
Done: 15.1-01. Next: 15.1-02.

**EXECUTION MODE: Phase 15.1 runs SERIALLY on branch `lane-a/dispatch-core` in
`.worktrees/lane-a-dispatch`.** No branch creation, no merges, no second session. There is NO live
`CONVEX_DEPLOYMENT` here: `npx convex dev|codegen`, `pnpm eval:golden` and Playwright all fail.
Offline gates only — `vitest`, `tsc --noEmit`, `check-playbooks.mjs`.

Status (15.1-01): **The tier stopped being a model-temperature guess, and D6 became a compiler
error rather than a review note.** Four shared seams landed in ONE commit-set so plans 02-07 FILL
them rather than reshape them (the Phase-15 15-01 precedent). (1) THE RULE: `deriveTier` in
`packages/core/src/businessProfile.ts` — `paidStaff === 0 && headcount <= 2` ⇒ solopreneur; else
not(`steady-revenue` AND `bootstrapped`) ⇒ startup; else sme. Total by construction over CLOSED
unions (`REVENUE_STAGES`/`FUNDING_STATES`, owner Q7 — a free string here reintroduces the
string-matching defect class the phase exists to close), proven at runtime by a 135-case
cross-product sweep that is NON-VACUOUS because it enumerates from the exported unions. Branch ORDER
is load-bearing (solo test FIRST, so a pre-revenue one-person business is a solopreneur, not a
startup) and has its own boundary row. `yearsOperating` is CAPTURED but deliberately unused, pinned
by a test so nobody "fixes" the omission. Thresholds are a PRODUCT call retuned via the test's
boundary table, NEVER a config row — a DB-tunable threshold makes the tier DB-writable by proxy,
which D2 forbids. (2) **D6 IS A TYPE**: `DerivedTier` (= `Persona`, 3 members) vs `TIERS` (4,
`enterprise` included); the `@ts-expect-error` bind was MUTATION-CHECKED (marker removed ⇒
`TS2322: Type '"enterprise"' is not assignable to '"sme"|"solopreneur"|"startup"'`; restored ⇒ exit
0), and so was the boundary (`<= 2` → `< 2` ⇒ 2 rows RED, restored ⇒ 254/254). (3) THE SLOT GATE:
`REQUIRED_SLOTS`/`missingSlots`/`canComplete` test numbers for FINITENESS, never truthiness — `0` is
an ANSWER, and a `!value` check would make the design §6 conversation uncompletable for exactly the
solo founder the phase is about; an off-union enum value is MISSING, never admitted.
`sanitizeAgentName` (40-cap, `\p{C}` strip incl. Cf bidi/zero-width, collapse, trim AFTER the slice)
is the trust boundary for a name that rides into a model prompt in 15.1-05. (4) THE TABLE:
`tenantProfiles` + `by_tenant` in `schema.ts` — facts ALL optional and NEVER narrowed (a `legacy`
backfill row has none and design §10 forbids forced re-onboarding, so the "narrow" half of
widen-migrate-narrow is deliberately never taken; completeness lives at the WRITE boundary), while
`tier`/`tierSource`/`derivedAt` are REQUIRED so a half-written row cannot become a silent
"solopreneur". `Doc<"tenantProfiles">` resolves with NO codegen (non-vacuity confirmed by a rename
probe ⇒ TS2344). `watch.json` pre-registers `convex/tenantProfile.ts` + its test BEFORE plan 02
creates them, so the Stop hook cannot block that plan. **ADR-009** pins the Q2 deferral: `diagnose()`
returns at the first failing gate and emits ONE prescription (`diagnose.ts:32-179`), so
`leverageRank([prescription])` (`evaluations.ts:324-325`) sorts a single-element array — a tier
filter over a set of one can only REJECT, and a rejected route lands on the deterministic `buildMemo`
fallback (`evaluations.ts:685-692`), a downgrade wearing tailoring's clothes. **A verifier must NOT
read SC#5 as "the offer set is filtered" or "the rubric pick changes"**; Q3 stands
(`financialsPresent`, `evaluations.ts:286-295`, correctly keeps overriding the framework pick).
Deviations: 1 auto-fixed (Rule 2 — `businessProfile.test.ts` added to `watch.json`, since it now
carries the D6 bind and the boundary table and was otherwise unprotected). Gates: @pikar/core
**254/254** + `tsc` exit 0 with the `@ts-expect-error` in place, `convex/tenant.test.ts` 4/4, backend
`tsc` at the EXACT **55**-error test-file baseline with ZERO in `schema.ts`, `check-playbooks` exit 0,
turbo **8/10** baseline, and `git diff` proves `onboarding.ts` / `evaluations.ts` / `llm.ts` /
`dispatch.ts` / `apps/web` are ALL untouched — this plan is a freeze, not an edit. **NEW CARRY-
FORWARD:** the backend FULL suite is FLAKY here (6-7 failures, a different set each run, all
`Component "<rateLimiter|auditCounts>" is not registered`); every file passes in ISOLATION and the
sole genuine red remains the documented `audit.test.ts` `auditCounts` row. Logged to
`.planning/phases/15.1-.../deferred-items.md` — do not read a noisy full-suite number as a regression.

PRIOR — **EXECUTION MODE (owner decision, 2026-07-25): Phase 15 ran SERIALLY**, all 6 plans, in
`.worktrees/lane-a-dispatch` on branch `lane-a/dispatch-core`. No Lane B session, no concurrent
Phase-15 lane, no merges to `main` mid-phase. `PARALLELIZATION.md`'s Phase-15 lane table was
finalized anyway and is retained as the FILE-OWNERSHIP CONTRACT (which plan may touch which file)
— that still holds, and is what keeps 15-05's executor work from colliding with 15-02/03/04's
dispatch work even with one agent doing both.

Status (15-06): **The three specialists now instruct their own grounding through the one tool they
have — and the gate they must ride is UNPAID, so the phase ships dark.** All three bodies
(`offer-architect` / `money-model-designer` / `lead-engine`) carried 12-02's placeholder framing
*"Registered now; a full build runs later"* — honest when written, FALSE the moment 15-03 shipped
dispatch. Each `.md` (+ its byte-identical derived `.ts`; `skillBodies.test.ts` green) now drops it
and gains a **`## How to ground this`** section naming `searchVault`. That is the material change:
every body already ended with *"Cite the user's own material for every claim"* and the specialist
had NO retrieval tool until this phase, so the instruction was literally unsatisfiable. Three
properties are deliberate — the tool is NAMED not implied; the READ-ONLY posture is stated in prose
(*"You cannot send anything, save anything, or change the plan"*), reinforcing at the PROMPT layer
what `SPECIALIST_TOOLS` enforces STRUCTURALLY (ADR-007); and not-enough-data is an AFFIRMATIVE
answer, tuned per body (money-model: invention does the most damage on NUMBERS; lead-engine:
channel advice is worthless when guessed). METHOD content untouched, and each body's financial-spine
deferral now says it never restates a figure the evaluation did not ground. THE RUNNER: `SKILL_NAMES`
was a hardcoded three that excluded `reply-drafter` AND all seven Phase-12 skills — **eight of eleven
gated skills were unpinnable and `--skill offer-architect@N` THREW**, i.e. this plan could not have
run its own gate under the old runner. It is now DERIVED from `GATED_SKILLS`, read off
`packages/contracts/src/skill.ts` (the runner is plain `.mjs`; the `specialists.test.ts`
scan-the-source precedent), so a newly gated skill is pinnable the day it is gated with no second
list to drift. `--skill` is now MULTI-pin: every occurrence collected, the merged record threaded on
EVERY turn, evidence recorded ONE ROW PER PIN off the SAME run (each carrying the full merged
`skillVersions`), a repeated NAME rejected outright. THE FIXTURES: a new `actOnGap: <gapIndex>` field
taps the gap after the turns through `evaluations:actOnGapInternal` — an identity-less twin over a
SHARED `applyActOnGap` (the 12-04 `recordScorecardAnswerInternal` precedent; `npx convex run` carries
no auth identity), so the fixture drives the REAL path and not an imitation — then POLLS
`plans:getById` out of `collecting`, which is the right signal precisely because
`landSpecialistResult` lands in a `finally` on every outcome. Three new closed-vocabulary keys:
`planKind` (+ `status: proposed` = the collecting→proposed flip), **`attributionRoute`** (the one
that DISCRIMINATES — the fallback memo reaches `proposed` with `kind: "memo"` too, and `--self-check`
asserts exactly that before asserting the fallback FAILS attribution), and **`citesVaultDoc`**, which
probes the seeded corpus NEEDLE `evalgrd` rather than a vault title root: a title root ("Northwind")
is echoed straight out of the fixture's own turns, so it would pass with or without a search —
`validateFixture` now FORBIDS any turn from containing the needle. 12-06's pair-every-zero-count
lesson is enforced STRUCTURALLY, not by discipline: `actOnGap` requires `expect.gapCount > actOnGap`
and every dispatch observable requires `actOnGap`. Three fixtures added (29 gate-1 no offer, 30
gate-2 one offer type, 31 gate-3 no channel — three DIFFERENT routes, so `attributionRoute` cannot be
satisfied by one hardcoded string), floor 27 → 30. Three self-check assertions mutation-checked
(re-hardcode `SKILL_NAMES`, force `citesVaultDoc` true, drop the duplicate-pin guard → all RED),
reverted. Deviations: 3 auto-fixed — the plan's fixtures were UNBUILDABLE without a callable tap
(Rule 3 → `actOnGapInternal` over a shared helper, zero behaviour change, 54/54 dispatch-side tests
green unchanged); `citesVaultDoc` as literally specified would have passed VACUOUSLY (Rule 1 →
needle probe + validator rule); and `attributionRoute` was first validated against `GATED_SKILLS`,
which accepts `swot` — a gated skill no gap can ever dispatch to (Rule 1 → a second source
derivation of `SPECIALIST_ROUTES`; gated ⊃ dispatchable). **UNPAID GATE (carry-forward):**
`pnpm eval:golden` was NOT run — this worktree has no `CONVEX_DEPLOYMENT` (15-01 bootstrapped it with
a COPIED `_generated`). Nothing faked, no fixture weakened, nothing hand-activated. SHIP DARK per
CONTEXT: the candidates park, the ACTIVE v1 bodies stay live (so a dispatched specialist today still
runs the OLD body), and Phase 15's five success criteria are proven by 15-01..15-05 — none of them
requires a rewritten body. Gates: contracts 13/13, backend **544/545** (sole red the documented
`audit.test.ts` `auditCounts` row), @pikar/core 223/223, `--self-check` exit 0 (30 fixtures, 11
derived gated skills), backend `tsc` at the exact pre-existing baseline with ZERO in any non-test
file, `apps/web` typecheck exit 0 (Pitfall-4 tripwire held — explicit `Promise<ActOnGapResult>`),
turbo 8/10 baseline, `check-playbooks` exit 0, and `git diff` proves `cockpit.ts`,
`deliverApprovedPlan.ts`, `actionType.ts` and `apps/` all untouched.

PRIOR (15-04): **"Act on this" RUNS the specialist, and the phase's user-visible claim is one
test.** `actOnGap` stays a `tenantMutation` (a Convex mutation cannot call an action, and converting
to a `tenantAction` would make the `resetPlan`+`patchPlan` recycle interruptible while STILL leaving
the card blank for 30s) and now has TWO terminals chosen by a RUNTIME `resolveSpecialist(gap.route)`
at the entry point: a REGISTERED specialist stages `status: "collecting"`, `kind: "memo"`, subject
set, **`body: ""`** and schedules `internal.dispatch.runSpecialist`; `""` (diagnose()'s ask branch)
and `"scale"` (its healthy branch) keep the 12-05 memo at `proposed` with NOTHING scheduled — the
honest terminal when there is nothing to run, and the fail-closed guarantee now sits in front of the
scheduler as well as inside the dispatcher. **The Approve race is closed BY CONSTRUCTION, not by a
new guard:** `executePlan` has always returned `alreadyStarted` for any non-`proposed` row
(cockpit.ts:530), so a `collecting` plan is un-approvable — proven (executePlan on the staged row
persists ZERO vault docs, ZERO requests rows, no CAS flip), with NO new status literal and **zero
`apps/web` edits** (`PlanCard` renders only at `proposed`, cards.tsx:1624, so a `collecting` plan
already shows nothing and the CKPT-05 trace step is the progress indicator). `rootRequestId` is
minted fresh per call and the test proves it cannot be `planId`: two `actOnGap` calls on one thread
queue two jobs with an IDENTICAL `planId` (the row is RECYCLED, 12-05) and DIFFERENT roots — exactly
what ADR-008 forbids collapsing. `internal.evaluations.landSpecialistResult` (an explicit-tenantId
`internalMutation`, the 12-04 `recordScorecardAnswerInternal` precedent) is the ONLY writer of a
dispatched body and CASes three ways — wrong tenant, not `collecting`, not `kind: "memo"` ⇒ no-op
(mutation-checked: deleting the status check lets a finished run clobber a CANCELED plan's own
draft). `dispatchAndLand` wraps `governedDispatch` and lands in a **`finally`**, the same construct
that terminalizes the `agentSteps` row, so "the plan always leaves `collecting`" is unconditional
across success, an overrun, all four governed refusals AND a throw — a row stuck at `collecting`
renders no card at all, i.e. the user's tap would silently have done nothing. Both entry points call
it, so the landing cannot be true in tests and absent in prod. Success ⇒ the body STARTS with
`> Produced by the **<route>** specialist.`; an overrun ⇒ the cost-ceiling marker sits ABOVE the KEPT
partial output (asserted by string INDEX, not presence) — both in the BODY, never a `plans.status`
literal (the enum is PINNED). **The fallback stopped lying:** 12-05's *"That specialist does not
execute yet"* became false the moment dispatch shipped, so `buildMemo` gained an optional
`fallbackReason` and branches through a code-owned `FALLBACK_SENTENCE` map — the reason CODE never
reaches the user (asserted). A THROWN turn audits `subagent.refused` with `reason: "error"` (the code
only — `err.message` can carry prompt/grounded prose, §4), writes NO deadLetters row, lands the
fallback, and RETHROWS: `DispatchResult`'s refusal union is the four-member GOVERNED-stop contract and
an exception is not one of them, the `finally` already returned the user to an approvable row, and
15-03 ships a test asserting that a thrown turn rejects. The end-to-end test is the phase's claim:
tap → `collecting` + not approvable → the queued job really IS `runSpecialist` → replay its EXACT args
through the scripted twin → `proposed` + attribution → Approve → exactly ONE `next_step_memo` vault
doc → **ZERO `requests` rows on the whole path** (12-05's structural property SURVIVES dispatch) →
the lineage reconstructs from `audit.by_correlation` within one tenant. Four auto-fixed deviations:
`gapAction.test.ts`'s fixture routes at a REGISTERED specialist so 4 of its 5 tests asserted exactly
what this plan changes (re-pointed at `"scale"` so it keeps characterizing the memo TERMINAL, every
other assertion byte-identical); its untyped convex-test instance then broke the typecheck (52→56,
the SystemIndexes wall — fixed with `TestConvex<typeof schema>`); the e2e test RACED a real gateway
call and lost, because **convex-test flushes due scheduled work in the background** — the production
`runSpecialist` fired, threw `AI_LoadAPIKeyError`, landed the error fallback, and the twin's landing
correctly no-op'd (the CAS working); every dispatching test now CANCELS what it queued, so the suite
has no hidden `OPENAI_API_KEY` dependency; and the 15-03 §4 source scan fired on the new 4th audit
payload (the guard working — pin raised to 4, shared-refs scan follows the new `lineageRefs` helper,
mutation-checked with `body: String(err)`). Gates: backend **544/545** (sole red the documented
`audit.test.ts` `auditCounts` row), @pikar/core 223/223, `apps/web` typecheck exit 0 (Pitfall-4
tripwire held), backend `tsc` at the exact 52-error test-file baseline with ZERO in any non-test
file, `check-playbooks` exit 0, turbo 8/10 baseline, and `git diff` proves `apps/`, `schema.ts`,
`guardrails.ts`, `cockpit.ts`, `deliverApprovedPlan.ts` and `actionType.ts` are all untouched.

PRIOR (15-03): **The governed dispatcher is real: a named specialist runs in THE loop behind four
CONVERSATIONAL refusals, one tree-local cost envelope, and a call tree that reconstructs from an
index that already existed — no new table, no new index, no schema change.** `convex/dispatch.ts` is
ONE `governedDispatch` plus two thin entry points (`runSpecialist` production /
`__runSpecialistWithScript` offline twin), so a guard cannot be true in tests and absent in prod —
the whole 22-test suite drives the REAL loop through the REAL guards at zero model spend. The guard
ORDER is load-bearing and now documented as such: **resolve → depth → cycle → envelope → run**.
`resolveSpecialist` is FIRST because `gaps[].route` persists as `v.string()` (schema.ts:350), so
rows written before 15-02 closed the union — including `diagnose()`'s deliberate `""` — reach it
un-narrowed; the envelope check is LAST so a refusal that costs nothing is never charged against the
tree. All four refusals (`unknown_route` / `depth_exceeded` / `cycle_refused` / `budget_exhausted`)
RETURN a calm sentence that never names its reason code, write **ZERO deadLetters rows**, spend ZERO
model budget (asserted on the untouched daily rail, not inferred) and paint ZERO `agentSteps` rows —
a refused dispatch never started; the step is finished in a `finally`, the only construct that
terminalizes on success, on a thrown turn, AND on a governed stop that returns as data. `MAX_DEPTH =
1` makes cycles structurally impossible, but `wouldCycle` (the SHARED @pikar/core predicate, never a
re-derived inline `includes`) runs and is tested in both shapes, so the guarantee is tested the day
the cap rises rather than written that day. THE ENVELOPE: `floor(remainingDailyCents × 0.25)`,
derived at the ROOT only; a non-zero incoming value is carried through UNCHANGED, which is what makes
it ONE tree ceiling instead of a fresh allowance per hop — the drawdown is asserted on the
`subagent.completed` rows' `spentCents` so it is OBSERVABLE, not inferred. It is a TREE-LOCAL SECOND
ceiling over the deployment-wide (keyless) rail, not a replacement, and deliberately NOT
`guardrails.preCall` (which checks `{count: 1}` — "is there ANY budget left", not "enough for this
call"). A rail driven negative by `recordSpend(reserve: true)` clamps to a ZERO envelope and refuses,
never a negative ceiling (driven with a real 2000-cent overspend against a 500-cent rail). An
OVERRUNNING hop KEEPS its output and is labelled `incomplete: true` — stop AFTER the call that
overran, never discard work already paid for — with a non-vacuity companion proving a hop inside its
envelope is NOT so labelled. SC#3: three `internal.audit.log` inserts per hop, all with
`correlationId := rootRequestId`, so a two-hop run reconstructs as four ordered rows, `parentAgentId`
rebuilds the EDGES (executive → offer-architect → lead-engine) and the tree's cost is a SUM matching
the hops' returned `costUsd`. Three deliberate NON-decisions pinned as source comments: no
`subAgentRuns` table (a second log plane beside an insert-only audit is the anti-pattern), no
telemetry mirror (`telemetry.requestId` is `v.id("requests")` and a specialist run seeds ZERO
requests rows by design — 12-05), nothing on `agentSteps` (its own header forbids a shadow log). §4
is asserted TWICE and both mutation-checked: at runtime every payload VALUE of every audit row is
scanned against the scripted reply and its distinctive words, and statically `llmRedaction.test.ts`
pins `dispatch.ts` to exactly three `payload:` expressions and scans them PLUS the shared `refs`
object they spread. SC#5 is asserted under a deliberate COLLISION — tenant B dispatches with tenant
A's `rootRequestId` verbatim on the same `threadId`, both hops really write, and the lineage
partitions cleanly with NON-EMPTY partitions on both sides (a zero-size partition would pass a naive
no-leakage check vacuously); the audit table is read DIRECTLY because it has no public tenant-scoped
reader, so the `plans.byThread` form (also shipped) would prove isolation of the PLAN, not of the
lineage rows SC#5 names. **ADR-008** records why six pieces of state travel as validator-checked
`internalAction` args rather than DB state, and that `rootRequestId` is minted fresh — it is neither
`planId` (RECYCLED per thread, 12-05, so two dispatches would merge into one unreconstructable tree)
nor `plans.correlationId` (only written at `executePlan`, i.e. after Approve). Zero auto-fix
deviations: the plan's premises held. Gates: backend 528/529 (sole red the documented `audit.test.ts`
`auditCounts` row), @pikar/core 223/223, apps/web typecheck exit 0 (Pitfall-4 tripwire held — explicit
`Promise<DispatchResult>`), backend `tsc` at the exact 52-error test-file baseline with ZERO in any
non-test file, `check-playbooks` exit 0, and `git diff --name-only 4065571^..HEAD` shows exactly the
5 authorized files — `schema.ts`, `guardrails.ts`, `apps/`, `cockpit.ts`, `deliverApprovedPlan.ts`
and `actionType.ts` all absent.

PRIOR (15-05): **The approve→execute spine is action-agnostic, and "adding an action type without
an arm is a compile error" is a VERIFIED `tsc` failure rather than a comment.** `executePlan` no
longer branches on an ad-hoc `if (plan.kind === "memo")`; it is the DISPATCHER, selecting an arm via
`armFor(actionTypeOf(plan.kind))` in an exhaustive switch with an `assertNever` backstop. The memo
arm and the email arm are two entries in one table, and the arms are the EXISTING code paths — the
24-test `cockpit.test.ts` is unchanged and green, which is the refactor's proof. `armFor` is a
`satisfies Record<ActionType, Arm>` TABLE in `@pikar/core`, deliberately NOT the plan's ternary: a
ternary is total by construction, so widening `ACTION_TYPES` would compile fine and silently
classify a new type as `inline`, voiding the plan's own headline guarantee and making its totality
test (`armFor(t) !== undefined`) vacuous forever. `cockpit.ts` keeps its OWN `_ARM_TABLE` bind on
top of that, because the `workflow` case falls through to the GMAIL FAN-OUT (seed `requests` →
`startFanout` → `deliverApprovedPlan`): a new action type that merely *classified* as `workflow`
would inherit the email terminal without anyone deciding to. The switch's `assertNever` covers a new
ARM; `_ARM_TABLE` covers a new TYPE; both are compiler-forced, so they cannot drift — mutation-
checked by adding `"calendar"` to `ACTION_TYPES` and watching TS2741 fire in `actionType.ts`,
`actionType.test.ts` AND `cockpit.ts`. Honest qualification: "zero spine edits" means the spine's
STRUCTURE never changes again — a new type still adds one compiler-demanded line to `_ARM_TABLE`.
The branch ORDER is unchanged and now pinned on BOTH sides in `gapAction.test.ts`: a memo approves
with ZERO `gmailTokens` rows (selection is BEFORE the mailbox pre-check — 12-05 left that as a
comment, it is now an assertion) and an ESCALATED memo refuses with `review_escalated` running
NEITHER arm (selection is AFTER the fail-closed guard). `deliverApprovedPlan.ts` is BYTE-UNCHANGED
(a gate, not a claim): two-level dispatch — `executePlan` picks the arm, `deliverApprovedPlan` is the
workflow-backed EMAIL arm's entry point, not the universal dispatcher. And the human Approve gate is
statically fenced off from the model by three new `dispatchGuard.test.ts` scans: `cockpit.ts` must
declare `export const executePlan = tenantMutation({`; `executePlan`/`approvePlan`/
`deliverApprovedPlan` must be absent from `buildCockpitTools`' 20 `name: tool({` keys (floor ≥20, so
Phases 16-19 can add tools without breaking it); and `llm.ts` must contain no
`internal.cockpit.executePlan` / `api.cockpit.executePlan` / `deliverApprovedPlan` reference AT ALL,
so a tool cannot reach Approve under some other key. Both scans mutation-checked. Gates: `@pikar/core`
223/223, backend 508/509 (sole red the documented `audit.test.ts` `auditCounts` row), gapAction +
cockpit 29/29, `apps/web` typecheck exit 0, backend `tsc` at the exact 52-error test-file baseline,
`check-playbooks` exit 0, and `git diff` proves Lane B touched none of `llm.ts` / `dispatch.ts` /
`evaluations.ts` / `specialists.ts` / `apps/`.

PRIOR (15-02): **A named specialist is now a resolvable `(skill body, tool-set)` pair, and THE
governed loop can run one without being forked.** Two halves. (1) The REGISTRY: the three growth
specialists (`offer-architect` / `money-model-designer` / `lead-engine`) are registered as
`(skillName, tools, stepTool)` triples in `packages/core/src/specialists.ts`; `SpecialistSpec.tools`
is `["searchVault"]` for all three, asserted as an EQUALITY over the WHOLE registry so a write tool
added to any one of them fails a test instead of shipping quietly. `evaluateBusiness` is
deliberately NOT granted — its read-shaped name hides an `internal.evaluations.runEvaluation` call
that PERSISTS an evaluations row + an audit row per call and re-enters the diagnostic engine
mid-dispatch; the snapshot rides the PROMPT (`internal.evaluations.lastForThread`) in 15-03 instead,
and the reasoning is pinned as a comment so a later phase does not "fix" it. `Prescription.route` is
now closed to `SpecialistRoute | ""` with `""` deliberately representable (the not-enough-data ask
branch emits it; `resolveSpecialist("")` refuses it at runtime), direction `growth/ → specialists`.
The COVERAGE BIND is a real runtime assertion: `specialists.test.ts` reads `diagnose.ts` off disk,
balanced-paren slices every `rx(...)` call plus the object-literal `route:` branch (skipping quoted
spans whole — a depth-only walker mis-read `" money model"` out of the `"scale"` branch's prose) and
feeds all 11 literals through the real lookup, so a new gate with a new route fails until its
specialist is registered. Also shipped: `wouldCycle` (the A→B→A predicate, in core so it is correct
BEFORE `MAX_DEPTH` rises) and `specialistMemoBody` (the incomplete/cost-ceiling marker lives in the
BODY — a `plans.status` literal would touch the PINNED enum with `apps/web` blast radius).
(2) The LOOP SEAM: `runAgentLoop` gained ONE append-only optional `toolNames?: readonly string[]`.
ABSENT ⇒ the full 20-key record (the entire unchanged 79-test `runCockpitAgent`/`cockpitTools` suite
is the proof, not a claim); `[]` ⇒ an EMPTY record, because the filter tests `=== undefined` and a
truthiness test would hand a zero-tool specialist all 20 keys. Withholding is STRUCTURAL ABSENCE
from the record — NOT ai@7's `activeTools`, which leaves the withheld tool's `execute` closure in
the record and reachable via `invokeTool` — the `omitRecipientEdits` precedent generalized.
`runSpecialistTurn` is the ONLY exported specialist entry into the loop (`runAgentLoop` stays
module-private, which is what keeps "no agent spawns an agent" checkable by reading one file); it
loads its body through the §5 loaders fail-closed and returns `skillVersion` for the lineage audit
row. **ADR-007** records why the BODY is registry-owned and the TOOL-SET is code-owned. Deviations
(3, all auto-fixed): closing the route type broke `diagnose.test.ts`'s TYPECHECK (an un-annotated
fixture helper widened `""` to `string`) — invisible to the plan's own vitest verify command, fixed
with one `as const`; the plan's `proposePlan` withholding fixture could not discriminate (it refuses
an incomplete plan, so the control case failed too) — switched to `setSubject` + `addRecipients`;
and the source-scan walker bug above. Gates: `@pikar/core` 219/219, backend 504/505 (sole red the
documented `audit.test.ts` `auditCounts` row), `apps/web` typecheck exit 0 (Pitfall-4 tripwire held
— `runSpecialistTurn` has an explicit return type), backend `tsc` +0 new errors over the 52
pre-existing test-file ones, `check-playbooks` exit 0, and `git diff` proves Lane A touched none of
`deliverApprovedPlan.ts` / `cockpit.ts` / `actionType.ts` / `apps/`.

PRIOR (15-01): **Wave 0 is FROZEN.** Every shared seam Phase 15 needs landed in one plan, and
three of them would have failed SILENTLY if skipped. (1) Three literals — `dispatchOfferArchitect`
/ `dispatchMoneyModelDesigner` / `dispatchLeadEngine` — now sit on the CLOSED `agentSteps.tool`
union. N literals, deliberately NOT a `specialist: v.string()` field: §4 on the trace plane is
enforced by the ABSENCE of anywhere to put text, and a string field would re-open the hole the
closed union closed. Without them the dispatch step's insert throws inside an SDK tool callback,
which the SDK SWALLOWS — prod shows a blank activity card while every test stays green.
`dispatch.test.ts` inserts each literal against the REAL schema; that is the guard. (2) All four
matching `VERB` entries landed in `cards.tsx`, INCLUDING the pre-existing Phase-12
`evaluateBusiness` gap that had rendered the `["Working…","Done"]` FALLBACK since 12-04. This was
the ONLY `apps/web` edit in Phase 15 — attribution rides the plan BODY (15-04) and `PlanCard`
renders only at `status === "proposed"`, so a `collecting` plan needs no pending state; **`apps/web`
is now FROZEN for the phase.** (3) `internal.guardrails.remainingDailyCents` gives the daily-spend
rail a READER (`rateLimiter.getValue` — utilization without consuming tokens), clamped
`Math.max(0, …)` because `recordSpend`'s `reserve: true` drives the window negative on purpose,
with an explicit `Promise<number>` return type (an inferred one collapses the generated API to
`any` — how 13-01 shipped 90 `apps/web` errors). It reads the DEPLOYMENT's budget, not the
tenant's: `dailySpendCents` is a KEYLESS window; per-tenant keying is the upgrade path.
Two pure-TS stubs shipped tested: `packages/core/src/specialists.ts` (`resolveSpecialist` fails
closed to `unknown_route` with ZERO registrations and NO default, mirroring `parseRouting`;
`hasOwnProperty` lookup because `"__proto__"`/`"constructor"` resolve to TRUTHY `Object.prototype`
members through a bare index read) and `packages/core/src/actionType.ts` (`ACTION_TYPES =
["email","memo"]` + `actionTypeOf` — an absent `plans.kind` means the email plan every prior phase
built, so ACTN-01 needs no migration). `convex/dispatch.ts` is an empty lane-owned stub, registered
NOW so the Stop hook can protect it from day one. `dispatchGuard.test.ts` holds the SC#2
no-nested-loop scan. **Zero lineage schema change was needed** (RESEARCH Q5 held: `AuditPayload`
already permits `rootRequestId`/`parentAgentId`, `audit.by_correlation` exists, and `telemetry`
structurally cannot carry them). Gates: `@pikar/core` 208/208, backend 500/501 (sole red the
documented `audit.test.ts` `auditCounts` row), `dispatch`+`dispatchGuard` 5/5, `apps/web` typecheck
exit 0 (Pitfall-4 tripwire), backend `tsc` +0 new errors over the 52 pre-existing test-file ones,
`check-playbooks` exit 0, and `git diff` proves Wave 0 touched NONE of `llm.ts` / `cockpit.ts` /
`deliverApprovedPlan.ts`.

PRIOR (13-03): Wave 3 done. BEVL-03 is now visible end to end — the cron's rows have a surface. `/dashboard/workspace` always shows a PINNED, non-closable "Weekly review" tab: `REVIEW_TAB` is seeded straight into `useState<Tab[]>([REVIEW_TAB])`, which is also what makes the `?thread=proactive-review` notification deep-link dedupe for free (`openThread` already skips ids it is showing). The tab drops both its `×` and the `has-close` class, and `closeTab` refuses the id. Selecting it renders a one-line explainer INSTEAD of `ChatPane` — the review thread is synthetic (no `plans` row), so `sendCockpitMessage` would throw `cockpit: plan row missing for thread` (cockpit.ts:93); the composer is suppressed and that backend guard was deliberately NOT loosened (it protects every real thread). The review branch precedes the gmail-status branch on purpose, so a user who never connected Gmail still sees it (SC#2 at the surface). `EvaluationCard` gained four review-ONLY branches and is still one dumb read of one `byThread` row: a pre-first-run empty state gated on the query RESOLVING to `null` (`undefined` is loading — no flash), a dated `Weekly review · MMM D ·` header prefix (the date IS the freshness signal, so no unread dot/badge), a `deltaLine()` "what changed" line off the PERSISTED `evaluation.delta` with zero terms omitted (nothing renders on an all-zero delta or an on-demand row), and a `/dashboard/profile` CTA inside the thin-data box — the one action that unblocks the one dead-end state, at `--teal-900` because BRAND §6 forbids `--teal-600` as small text. `NotificationsBanner` gained `KIND_HREF`, an OPT-IN kind→href map (absent kind ⇒ today's plain text; hrefs are code-owned constants, never row data), routing `weekly_review` over the existing VOIC-04 `?thread=` deep-link — no new route, no new component, no component library. Gates: web typecheck + `check-playbooks` exit 0, backend 494/495 unchanged (this plan touched zero backend files). PRIOR (13-02): the spine. `crons.weekly("proactive-review", monday 06:00 UTC)` → `internal.proactiveReview.runWeekly` enumerates onboarded tenants over `vaultDocuments.by_kind` (deduped — one review per tenant per week) and fans out `scheduler.runAfter(0, reviewOne, { tenantId })` so one tenant's failure cannot touch another's. `reviewOne` runs the Phase-12 engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, carrying last week's `framework` forward, and notifies ONLY on change (first review ever, moved verdict, or a non-empty delta); the evaluation row is written every week regardless, so the card is always current and the bell stays quiet. A thrown review still tells the user (`weekly_review_failed`), with the REASON never reaching the notification plane (§4). `insertReviewNotification` writes `notifications` DIRECTLY — never `notifications.notify`, which schedules `notifyExternal.dispatch` → `freshAccessToken` unconditionally — so proactivity cannot break on the Google 7-day testing token (SC#2). Both kinds stay OUT of `NOTIFICATION_KINDS` as the second, independent barrier. No new audit eventType: the run rides the existing refs-only `evaluation.ran`. SC#2/SC#3 are enforced by comment-stripped static source guards (a cron has no `ctx.auth`, so `tenantQuery`/`tenantMutation` cannot enforce scoping — the guard replaces them, pinning the ONE `by_kind` cross-tenant read to exactly one occurrence). `proactiveReview.test.ts` 8/8, backend 494/495 (sole red the pre-existing `audit.test.ts` auditCounts row), `@pikar/core` 195/195, web typecheck + `check-playbooks` exit 0, backend `tsc --noEmit` +0 new errors over the 52 pre-existing test-file ones.

**CARRY-FORWARD RESOLVED (13-02):** the repeat-run provenance collapse is **CLOSED** — option (b), not a fresh weekly thread. A date-derived thread id was rejected because `lastForThread` is indexed on `(tenantId, threadId)`: rotating it resets the Scorecard weekly, re-asks answered figures (breaking Phase-12's LOCKED store half), makes `delta` permanently `undefined`, and leaves 13-03 with no stable "the review thread" to render. Root cause instead: `provenance` is rebuilt from the corpus every run and never persisted, but `fillVault` returned EARLY when the slot was already carried — skipping the CITATION, not just the write. Now the VALUE is first-write-wins and the CITATION is re-recorded on every restatement (`!provenance.has(path)` keeps a `user-provided` cite from being downgraded); the two upstream short-circuits (`currentOffers.length === 0`, the `FINANCIAL_PATTERNS` `continue`) are gone. Regression-guarded by `proactiveReview.test.ts > notifies only on change` (run 2 must have the SAME finding count and an empty delta) — confirmed RED before the fix.

PRIOR (13-01): Wave 1. `evaluations.delta` (`{ newFindings, gapsClosed, gapsOpened }`, gap identity = `route/playbook`) is computed IN-ENGINE inside `runEvaluation({ withDelta: true })` and written through `insertEvaluation` — the append-only table gained no patch surface. `vaultDocuments.by_kind` is the ONE deliberately cross-tenant index (0 callers until 13-02's fan-out; yields tenant ids only, never content). `REVIEW_THREAD_ID`/`REVIEW_READY_MESSAGE`/`REVIEW_FAILED_MESSAGE` export from `@pikar/core` and are DELIBERATELY absent from `NOTIFICATION_KINDS` — that absence is the security property (`notifyExternal.dispatch` returns before `freshAccessToken`, so the review can never reach a Gmail token). Deviation: (Rule 1) returning the delta collapsed the whole generated Convex API to `any`/`{}` (Pitfall 9, 90 errors in `apps/web`) — fixed with a named `EvaluationDelta` type + explicit handler return annotation. Backend 485/486 (sole red is the documented pre-existing `audit.test.ts` auditCounts row).

**FOR 13-04:** the review surface is reachable three ways — the always-present pinned tab, `/dashboard/workspace?thread=proactive-review`, and the `weekly_review` notification (now a link). `EvaluationCard` must stay ONE dumb read of ONE `byThread` row: a new review affordance is another branch inside it, not a second query and not a second card ("no new card idiom" held and is worth holding). `KIND_HREF` in `NotificationsBanner` is the extension point for any future notification click-through (one line per kind; a kind with no entry keeps plain text). The composer is suppressed on the review thread ONLY — if 13-04 wants the user to ACT from the review, route them to a new chat (what the explainer already says) or extend the existing `Act on this` gap control; do NOT make the review thread sendable. `apps/web` has NO unit-test runner (only Playwright), so a real assertion on the card needs a spec plus a running `convex dev` and a seeded review row. Also: `/dashboard/profile` is rewritten by the tier/conversational-onboarding design doc scheduled AFTER Phase 13 — the thin-data CTA only needs that route to keep existing, so do not pre-emptively change the page.

**CONSUMED (was FOR 13-03):** read `api.evaluations.byThread({ threadId: REVIEW_THREAD_ID })` — one stable thread per tenant, latest row first. `delta` is populated from the SECOND review onward and `undefined` on the first (and on every on-demand cockpit evaluation), so render "what changed" conditionally; `newFindings` is meaningful only when `> 0`. The finding count no longer shrinks week over week — do not build UI that compensates for it. `NotificationsBanner` already renders `weekly_review` / `weekly_review_failed` (it shows every unread row except `gmail_reconnect`); a dedicated review surface must exclude them the way `ReconnectBanner` does or they double-surface. Do NOT add the review kinds to `NOTIFICATION_KINDS` and do NOT route the review through `notifications.notify` — both are asserted, both arm the mailbox.

Last activity (Phase 12): 2026-07-25 — Phase 12 plan 06 COMPLETE; PHASE 12 CLOSED. `pnpm eval:golden --skill cockpit-agent@15` → **27/27 PASSED, $0.1686, run `ed251c29`**; both new fixtures (27-grounded-assessment, 28-healthy-no-gaps) passed first try, one retry on the pre-existing flaky 18-briefing-then-action. **cockpit-agent@15 is ACTIVE** on that recorded evidence (verified live via `getActiveSkill`), teaching WHEN to call `evaluateBusiness` + the `recordScorecardAnswer` store half. The 7 Phase-12 rubrics needed no `activateSkill` — they had never been seeded, so their FIRST seed took the `rows.length === 0` bootstrap path and each landed **v1 ACTIVE** (SC #4 intact; only cockpit-agent rode the gate). Deviations: (Rule 2) `findingsPresent` added as a third expect key — `gapCount: 0` alone passes VACUOUSLY on the not-enough-data verdict because the engine force-clears gaps at zero findings; (Rule 3) the fixture-floor bump 18→27 moved from Task 1's commit to Task 2's. Five defects found and fixed during live verification (see PRIOR-FIXES below).

PRIOR-FIXES (2026-07-25, outside the plan's tasks, all committed): `d5814ae` shared `resolveMimeType` (Windows reports `File.type` `""` for `.md`); `f971613` literal extensions in `accept` (Chrome resolves accept MIME via the OS registry, which has no `text/markdown`); `b5e0f7f`+`7efa4f9` cockpit attachments now persist to the Knowledge Vault; `f5c279e` TWO grounding defects in the 12-03 engine — a large reference PDF monopolised the corpus (`rag.search` top-K is per CHUNK → grounding returned one 300-page book → "not enough data"), fixed by prepending the tenant's own profile-shaped docs via `internal.vault.profileSeedDocs`; and `fillVault` could never fill `identity.currentOffers` (empty-array default is not null), so `diagnose()` returned Gate 1 on EVERY vault-grounded run. Verified live after: growth-os, 8 cited findings, gap "Customer doesn't pay for themselves in 30 days" → `money-model-designer`.

PRIOR — Phase 12 plan 05 COMPLETE: the ACTING side of BEVL-02. `actOnGap` stages a gap as a proposed memo-plan through the pinned spine; `executePlan` branches on `plans.kind === "memo"` (before the mailbox pre-check) into a PERSIST terminal — a `next_step_memo` vault doc via `startIngest`, zero `requests` rows, `deliverApprovedPlan.ts` byte-unchanged. `buildMemo` is a deterministic grounded template naming the specialist (`gap.route`) + citing its playbook, never running it. "Act on this" is live and carries the ORIGINAL gap index through the `leverageRank` sort; `PlanCard` renders a NEXT-STEP MEMO variant on the SAME single Approve gate. Rule-3 deviation: `actOnGap` recycles the thread's one `plans` row (`byThread` is `.unique()`) and refuses `plan_busy` on an in-flight/delivered plan. gapAction 4/4, backend 474/475 (sole failure pre-existing), web typecheck + check-playbooks exit 0.

PRIOR — Phase 12 plan 04 CLOSED. evaluateBusiness read-tool + quiet recordScorecardAnswer write-tool in buildCockpitTools; EVALUATION card (findings + H/M/L chips + citations, ≤5 ranked gaps + more, healthy banner, distinct not-enough-data). Rule-3 deviation: recordScorecardAnswerInternal explicit-tenantId twin over a shared applyScorecardAnswer helper (the tool loop carries no live identity). Backend 470/471 (sole failure pre-existing), cockpitTools 57/57, web typecheck + check-playbooks exit 0. Task 3 visual check DEFERRED — the agent is never taught the tool (cockpit-agent.md: 0 mentions → 12-06 Task 2) and all 7 rubrics are gated-but-unactivated (EVAL_GATE → 12-06 Task 3), so the flow is not yet verifiable end-to-end. *(CORRECTED at 12-06: the rubrics were never SEEDED at all, not seeded-but-gated — `convex dev` alone does not seed. Task 3's debt is now PAID.)*

PRIOR — plan 03 COMPLETE: Business Evaluation Engine shipped. Dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward → ground via vaultGroundHydrated → pure diagnose()/leverageRank() → persist ONE cited row → refs-only evaluation.ran audit → evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (a user figure persists forward, cited user-provided, never re-asked); byThread feeds the card (plan 04). v1 findings deterministic (profile-parse + labeled-number scan); rich LLM narrative deferred to the plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over the SMOKE:: seam; check-playbooks exit 0.

Progress (v2.0): [███░░░░░░░] 25%  (4/16 phases complete; Phases 10 + 11 shipped 4/4 each, Phase 12 shipped 6/6, Phase 13 shipped 4/4, Phase 15 shipped 6/6 — 01, 02, 03, 04, 05, 06)

*v1.0 milestone (Phases 1-9, less the superseded Phase 9) shipped: governed email cockpit + guardrails + vault/GraphRAG + live voice + resilience/ops + self-improvement. That is the spine v2.0 builds on.*

## Milestone v2.0 Phase Map

| Stage | Phases |
|-------|--------|
| S1 Foundation & Intelligence | 10 Vault grounding · 11 Onboarding+profile · 12 Evaluation engine · 13 Proactive review · 14 Flagship voice-doc |
| S2 Breadth of Action | 15 Dispatch+executor · 16 Research+web · 17 Calendar · 18 Doc/content · 19 Contacts/CRM |
| S3 Creation & Self-Extension | 20 Media canvas · 21 User skills · 22 requireOwner · 23 Agent skills |
| S4 Governance & Open the Beta | 24 ISO 9001 map · 25 Private Beta Productionization (LAST) |

## Performance Metrics

**Velocity:** (v2.0)
- Total plans completed: 2
- Average duration: ~12 min
- Total execution time: ~25 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 10 | 01 | 5 min | 2 | 3 |
| 10 | 02 | 20 min | 3 | 7 |
| 10 | 03 | 12 min | 2 | 2 |
| 15.1 | 01 | 31 min | 3 | 7 |

**Recent Trend:** 10-03 landed clean (web typecheck + playbook check green; SourceCard reused the existing briefingSheet style — no new card idiom).

*Updated after each plan completion.*
| Phase 10 P04 | 15 | 3 tasks | 8 files |
| Phase 11 P01 | 10 min | 3 tasks | 11 files |
| Phase 11 P02 | 11min | 3 tasks | 4 files |
| Phase 11 P03 | 76 min | 3 tasks | 6 files |
| Phase 11 P04 | 40 min | 2 tasks | 5 files |
| Phase 12 P01 | 8 min | 3 tasks | 8 files |
| Phase 12 P02 | 17 min | 3 tasks | 19 files |
| Phase 12 P03 | 17 min | 3 tasks | 5 files |
| Phase 12 P04 | ~35 min | 2 of 3 tasks (Task 3 deferred) | 6 files |
| Phase 12 P05 | ~25 min | 3 tasks | 8 files |
| Phase 12 P06 | ~120 min (incl. human eval gate) | 3 tasks | 8 files |
| Phase 13 P02 | ~40 min | 3 tasks | 6 files |
| Phase 13 P03 | ~25 min | 3 tasks | 5 files |
| Phase 15 P01 | 35 min | 3 tasks | 15 files |
| Phase 15 P02 | 25 min | 3 tasks | 9 files |
| Phase 15 P05 | 13 min | 3 tasks | 6 files |
| Phase 15 P03 | 35 min | 3 tasks | 5 files |
| Phase 15 P04 | 35 min | 3 tasks | 8 files |
| Phase 15 P06 | 45 min | 3 tasks | 14 files |
| Phase 15.1 P01 | 31 min | 3 tasks | 7 files |

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions. Recent decisions affecting v2.0:

- [v2.0 open]: Build platform breadth BEFORE opening the beta — former Phase 9 productionization moves to the milestone's END (now Phase 25).
- [Roadmap]: `requireOwner` (GOVN-01) pulled EARLY to Phase 22 — it must exist before agent-authored skills (Phase 23) activate and before multi-user (Phase 25).
- [Roadmap]: BEVL market-fact grounding depends on web research (Phase 16); Phase 12 evaluation scopes to vault-grounded findings until then.
- [Architecture]: Every v2.0 capability is one of two shapes — a read-only tool returning content in-loop, or a write staged into the plan for the human Approve mutation. No third mechanism.
- [Phase 10]: ADR-006: vault chunks are trusted-as-own — enter the agent loop directly (SC2-fenced), not through the toolless-ingestion firewall; fence + human Approve gate are the backstops
- [Phase 10]: 10-04: vault-grounding teaching is candidate cockpit-agent@13 (versioned skill, §5), gate-activated only; the 'not on compose turns' clause guards the 23 existing golden fixtures
- [Phase 10]: 10-03: the SourceCard reuses the existing briefingSheet opaque --card style (no new card idiom); titles link to /dashboard/vault (doc-level, no new query) — inline PreviewModal click-through deferred behind a getVaultDoc(byId) query
- [Phase 11]: 11-01: business-profile skill is UNGATED (mirrors voice-brief) — output is a human-confirmed vault doc, not tool-state; not in GATED_SKILLS
- [Phase 11]: 11-01: SC#1 encoded as pure decideConfirm returning literal { needsConfirm: true } — persona auto-commit impossible at the type level; enterprise not an emittable Persona
- [Phase 11]: 11-02: onboarding is a thin adapter — the profile is 'just another vault doc', so embed/tenant-scope/retrieval come free from startIngest/vaultGroundHydrated; new work is only the extraction call + §4-safe audit
- [Phase 11]: 11-02: extractProfile writes nothing (no doc, no audit) — SC#1 confirm-not-assume is structural; the sole write path is the separate human-confirmed commitProfile
- [Phase 11]: 11-03: first-run gate lives in the client <Authenticated> AppShell (useQuery(api.onboarding.status) redirect), NOT middleware.ts — middleware has no DB access (RESEARCH Pitfall 4, eternal-spinner class)
- [Phase 11]: 11-03: onboarding reuses the conversational chat SURFACE but routes extraction through the UNGATED business-profile skill, not the gated cockpit-agent — keeps onboarding tweaks out of the EVAL_GATE cycle / off the ~25 golden fixtures (RESEARCH Pitfall 1)
- [Phase 11]: 11-03: sparse-start — REQUIRED_STRINGS relaxed to [oneLineDescription] + confirmed persona; name/stage/offering/targetCustomer optional so idea-stage users (ONBD-02 'business/idea') can commit and are enriched later (46a86c3)
- [Phase 11]: 11-04: profile page is the post-onboarding editability/enrichment surface — save re-embeds via updateProfile so grounding stays current; the committed vault-doc markdown is the single record, getProfile parses it back with deserializeProfile (round-trip test binds the two)
- [Phase 12]: 12-01: Growth diagnostic math ported to pure-TS packages/core/src/growth (ltgpCac/cfa/diagnose); Convex-free (CLAUDE.md §1)
- [Phase 12]: 12-01: unknown financial input → diagnose emits ask (empty route/proofMetric) at the money-model gate — an all-null Scorecard never falsely reaches 'scale' (BEVL-01 no-fabricated-metrics guarantee in the type system)
- [Phase 12]: 12-02: 7 evaluation/specialist skills registered as GATED (4 framework rubrics + 3 specialist targets); bootstrap seeds v1 active, edits publish eval-gated candidates activated only via plan-06 (SC #4). growth-os-diagnostic folds diagnose() gate order + financial spine + 7-level positioning into ONE body; the 3 persona-fallback bodies (swot=SME, lean-canvas=solopreneur, bmc=startup) carry the shared grounding rubric (per-finding vault cite, H/M/L confidence, explicit not-enough-data state, no numeric %, affirmative healthy state). Original wording, NO Hormozi book text; contracts-side skillBodies.test.ts enforces md↔ts byte-identity.
- [Phase 12]: 12-03: evaluation engine SHIPPED — dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward→ground via vaultGroundHydrated→pure diagnose()→persist cited row→refs-only evaluation.ran audit→evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (user figure persists forward, cited user-provided). v1 findings deterministic (profile-parse + labeled-number scan); LLM narrative deferred to plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over SMOKE:: seam.

- [Phase 12]: 12-04: cockpit surface shipped — evaluateBusiness (read, CLOSED framework enum so the model can't inject prose, readPlan cross-tenant guard, fail-open SC1, CAPPED synopsis into the loop, SMOKE_OP_TOOL entry) + recordScorecardAnswer (write, {field,value}, cited user-provided, NOT plan-gated — a self-reported fact isn't an outbound action — refs-only audit, QUIET so no agentStep/tool-union entry). EVALUATION card is a dumb renderer over byThread: H/M/L ConfChip on globals.css color-mix tokens, ≤5 leverage-ranked gaps + a "more" disclosure, DISABLED "Act on this" (handler = plan 05), affirmative healthy banner on --released, and an insufficientBox never styled as a gap. No numeric % anywhere.
- [Phase 12]: 12-04: recordScorecardAnswerInternal (explicit-tenantId internalMutation twin) added because the cockpit tool loop carries NO live identity — a tenantMutation is uncallable from a tool. Both it and the public mutation delegate to ONE applyScorecardAnswer helper so the tenant-scoping/carry-forward write path can't drift.
- [Phase 12]: 12-05: MEMO TERMINAL — a plan now carries an optional closed `kind: "memo"` discriminator and `executePlan` branches on it AFTER the CAS read and BEFORE the mailbox pre-check: the body persists as a `next_step_memo` vault doc (startIngest, the persistBrief precedent) and the plan goes done with ZERO requests rows seeded. deliverApprovedPlan.ts is byte-unchanged (verified by diff) — the gmail fan-out is structurally unreachable from a memo, not merely unused. One Approve gate, two promises; the generalized executor (ACTN-01) generalizes THIS branch in Phase 15, it does not widen the gmail one.
- [Phase 12]: 12-05: actOnGap RECYCLES the thread's single plans row (resetPlan→patchPlan) rather than inserting a second — `plans.byThread` is a `.unique()` read, so a second row per thread throws for every workspace reader. resetPlan (not patchPlan) because patchPlan drops undefined and could never clear a half-composed email's slots onto the memo; resetPlan now also clears `kind` (a reset must drop the memo SHAPE or the next fresh compose silently saves instead of sends). A mid-flight/delivered plan refuses with `plan_busy`.
- [Phase 12]: 12-05: the memo NAMES the specialist (gap.route) and cites its playbook — it does not run it (Phase 15+). buildMemo is a deterministic template over the persisted row (gaps[] gained optional reason/proofMetric at diagnose time so the memo is a pure READ, never a second drift-prone derivation); it is a document the user reads, NOT an agent prompt, so §5 does not apply — but it may assert no figure the evaluation did not ground.
- [Phase 12]: 12-05: PlanCard branches on kind === "memo" — the email chrome (recipients, mode, send-time picker, "Send to N recipients") would every word be a lie on a memo, at the exact surface where the human gives irreversible consent. Same approve() handler reused, so there is still exactly ONE Approve gate.
- [Phase 12]: 12-06: `findingsPresent` is a THIRD expect key beyond the plan's two — the engine force-clears gaps at zero grounded findings (SC #1), so `gapCount: 0` alone passes VACUOUSLY on the honest not-enough-data verdict. Pairing the two is what makes 28-healthy-no-gaps assert HEALTH rather than emptiness.
- [Phase 12]: 12-06: a GATED skill's FIRST seed lands v1 ACTIVE (the `rows.length === 0` bootstrap path) — gating costs nothing until a skill's first body EDIT. The 7 Phase-12 rubrics were never seeded on this deployment (`convex dev` alone does not seed; only `pnpm dev` / `npm run seed` runs `skills:seedSkills`), so they self-activated at v1 and only `cockpit-agent` rode the gate (→ **@15**, on 27/27 passing evidence, $0.1686, run `ed251c29`). This CORRECTS 12-04's "seeded but gated-not-activated" inference.
- [Phase 12]: 12-06 (verification-driven, `f5c279e`): grounding must PREPEND the tenant's own profile-shaped docs (`internal.vault.profileSeedDocs`) — `rag.search` top-K is per CHUNK, so one large reference PDF monopolises the corpus and the engine honestly reports "not enough data" while the user's own profile sits unread. Paired defect: `fillVault` could never fill `identity.currentOffers` (an empty-array default is not `null`), pinning `diagnose()` to Gate 1 on every vault-grounded run.
- [Phase 12]: 12-04: Task 3 human-verify DEFERRED to 12-06 (owner decision) — **PAID at 12-06; owner ran all three accumulated visual checks and approved 2026-07-25** — the plan's checkpoint asked for end-to-end verification of a flow whose two enabling halves land in 12-06 (agent teaching = Task 2, EVAL_GATE rubric activation = Task 3). Verified-not-litigated: cockpit-agent.md has 0 evaluate/scorecard/swot/diagnose mentions; all 7 Phase-12 rubrics are in GATED_SKILLS. Workarounds refused: no gated skill activated, no teaching hardcoded (§5), no throwaway seeding.
- [Phase 13]: 13-02: PINNED THREAD + close the provenance gap (option b), NOT a fresh weekly thread id. `lastForThread` is indexed on (tenantId, threadId), so rotating the id resets the Scorecard weekly, re-asks answered figures (breaks Phase-12's LOCKED store half), makes `delta` permanently undefined, and leaves 13-03 with no stable review thread. Fixed the engine instead: `fillVault` records a CITATION on every restatement while the VALUE stays first-write-wins.
- [Phase 13]: 13-03: the pinned review tab is a REAL Tab seeded into useState<Tab[]>([REVIEW_TAB]), not an element rendered beside the strip — that is what makes the ?thread=proactive-review notification deep-link dedupe for free (openThread already skips ids it is showing). No persistence needed: the thread id is deterministic, so 'tabs are session-only view state' still holds.
- [Phase 13]: 13-03: the COMPOSER is suppressed on the review thread; the cockpit.ts:93 'plan row missing for thread' guard was NOT loosened. Reading the synthetic thread already degrades gracefully (empty message page, null plan/briefing, absent from listThreads), so the send path is the only broken one — and that guard protects every real cockpit thread from a plan-less send. Recorded in cockpit.md as an explicit anti-fix.
- [Phase 13]: 13-03: the review branch is checked BEFORE the gmail-status branch — the review has nothing to do with a mailbox, so a never-connected user must still see it (SC#2 at the surface). And the empty state branches on evaluation === null specifically, not falsiness: undefined is still loading, so a falsiness gate would flash 'first review runs Monday' on every load of a thread that HAS a review.
- [Phase 13]: 13-03: deltaLine stayed INLINE in cards.tsx rather than moving to @pikar/core for a unit test — apps/web has no unit runner (only Playwright) and CLAUDE.md §8 forbids standing up frameworks for a check; the failure mode is a cosmetic plural, and the cross-package move (new file + test + watch.json + playbook) is a bigger diff than the 8 lines it would guard. Also: the profile CTA uses --teal-900 not --teal-600 (BRAND §6 — teal-600 is ~2.9:1, a button FILL color, not small text).
- [Phase 13]: 13-03: KIND_HREF is an OPT-IN kind->href map, so absence is the default and no existing notification kind changed behaviour. The hrefs are code-owned constants built from @pikar/core, never derived from row data (no row can steer a user), and message is a static §4 label so using it as link TEXT carries no PII. Routed over the existing VOIC-04 ?thread= deep-link — no new route.
- [Phase 15]: 15-01: the no-nested-loop scan counts TOOL-BEARING generateText call sites, not total ones — llm.ts legitimately holds 3, two being the TOOLLESS ingestion firewall (digestInbox/draftReply) already pinned by llmRedaction.test.ts. Counting raw sites would break whenever that firewall grew a legitimate member while still missing a second loop hidden inside a tool. Also: runAgentLoop passes tools by SHORTHAND (tools,), so the scan matches tools\s*[,:] — a colon-only regex silently counted 0.
- [Phase 15]: 15-01: ZERO lineage schema change was needed for SC#3 (RESEARCH Q5 held) — AuditPayload already permits rootRequestId/parentAgentId, audit.by_correlation already exists, and telemetry structurally cannot carry them (requestId: v.id("requests"), and a specialist run seeds zero requests rows by design). PARALLELIZATION Stage-1 item (1)'s 'lineage fields' was a no-op; what Wave 0 actually needed were the three agentSteps.tool literals.
- [Phase 15]: 15-01: dispatch literals are N LITERALS on the closed agentSteps.tool union, never a specialist: v.string() field — §4 on the trace plane is enforced by the ABSENCE of anywhere to put text, and a string field would re-open the hole the closed union closed. Guarded by dispatch.test.ts inserting each literal against the REAL schema (a missing literal throws inside an SDK callback, which the SDK SWALLOWS).
- [Phase 15]: 15-01: resolveSpecialist uses Object.prototype.hasOwnProperty.call, not a bare SPECIALISTS[route] index read — "__proto__"/"constructor"/"toString" resolve to TRUTHY Object.prototype members, so a truthiness guard would happily route on them. Mirrors parseRouting: discriminated result, never a throw, NO default specialist. The runtime branch stays load-bearing after 15-02 narrows the type, because gap.route persists as v.string() including diagnose.ts's deliberate "".
- [Phase 15]: 15-01 (owner): Phase 15 executes SERIALLY on lane-a/dispatch-core, not in 2 parallel lanes. The Wave-0 freeze still ran in FULL (the seams are real architecture), only its 'land on main to unblock lanes' framing is moot. PARALLELIZATION.md's Phase-15 table was finalized anyway and is retained as the FILE-OWNERSHIP CONTRACT. apps/web is FROZEN after Wave 0 (the VERB map was Phase 15's only web edit); watch.json is a Wave-0 singleton; cockpit.md is append-only per-plan subsections.
- [Phase 15]: 15-02: the sub-agent BODY is registry-owned (§5) but the TOOL-SET is CODE-owned (ADR-007) — a tool-set is a CAPABILITY GRANT, not a prompt, and §5's eval gate stands in front of words, not capabilities. A DB-writable tool list would let a row edit widen what a sub-agent can do with nothing in front of it. SPECIALISTS stays a pure readonly data record in @pikar/core, which is also the seam 15.1 plugs its tier filter into.
- [Phase 15]: 15-02: withholding a tool from a specialist is STRUCTURAL ABSENCE from the tool record, never ai@7's activeTools and never skill wording — activeTools leaves the withheld tool's execute closure in the record and reachable via invokeTool (llm.ts:1602). The omitRecipientEdits precedent generalized. runAgentLoop's toolNames tests === undefined, not truthiness: [] must yield an EMPTY record, and a truthiness test would hand a zero-tool specialist all 20 keys.
- [Phase 15]: 15-02: evaluateBusiness is deliberately NOT in any specialist's grant despite its read-shaped name — it calls internal.evaluations.runEvaluation, which persists an evaluations row + an audit row per call and re-enters the engine mid-dispatch. The evaluation snapshot reaches the specialist through its PROMPT (internal.evaluations.lastForThread) instead. Reasoning pinned as a comment on the registry so a later phase does not 'fix' it.
- [Phase 15]: 15-05: armFor is a `satisfies Record<ActionType, Arm>` TABLE in @pikar/core, never the ternary the plan specified — a ternary is TOTAL by construction, so widening ACTION_TYPES would compile fine and silently classify a new type as `inline`, voiding the plan's own "adding an action type without an arm is a COMPILE error" guarantee and making its `armFor(t) !== undefined` totality test vacuous forever. Verified by mutation: adding "calendar" fires TS2741 in actionType.ts, actionType.test.ts and cockpit.ts.
- [Phase 15]: 15-05: cockpit.ts keeps its OWN `_ARM_TABLE` bind on top of core's table because the `workflow` case in executePlan's switch falls through to the GMAIL FAN-OUT — a new ActionType that merely classified as `workflow` would inherit the email terminal without anyone deciding to, undoing what 12-05 bought by leaving deliverApprovedPlan.ts untouched. assertNever covers a new ARM; _ARM_TABLE covers a new TYPE. So "zero spine edits" means the spine's STRUCTURE never changes — a new type still adds one compiler-demanded line.
- [Phase 15]: 15-05: two-level dispatch — executePlan picks the arm, deliverApprovedPlan.ts is the workflow-backed EMAIL arm's entry point and NOT the universal dispatcher (byte-unchanged, enforced by `git diff --exit-code` in the plan gate). A future inline arm executes inline; a future durable arm starts its OWN workflow. Arm selection stays exactly where 12-05's memo `if` sat — after the CAS read + escalated guard, before the mailbox pre-check — and gapAction.test.ts now asserts BOTH sides of that position.
- [Phase 15]: 15-02: the 'incomplete — cost ceiling reached' marker lives in the memo BODY, never on the plan row — a new plans.status literal would touch the PINNED status enum (schema.ts:155-164) with apps/web blast radius, and the body is visible at the Approve gate where the human actually decides. runAgentLoop stays module-private; runSpecialistTurn is the ONLY exported specialist entry, which is what keeps 'no agent spawns an agent' checkable by reading one file.
- [Phase 15]: 15-03: the guard ORDER is load-bearing — resolve -> depth -> cycle -> envelope -> run. resolveSpecialist is FIRST because gaps[].route persists as v.string() (schema.ts:350) including diagnose()'s deliberate "", so rows written before 15-02 closed the union reach it un-narrowed; the envelope check is LAST so a refusal that costs nothing is never charged against the tree. All four refusals RETURN a conversational reply with ZERO deadLetters, ZERO model spend and ZERO agentSteps rows — a refused dispatch never started.
- [Phase 15]: 15-03: the cost envelope is a TREE-LOCAL SECOND ceiling over the deployment-wide dailySpendCents rail, never a replacement — floor(remaining x 0.25) derived at the ROOT only, with a non-zero incoming value carried through UNCHANGED (that is what makes it ONE tree ceiling instead of a fresh allowance per hop). NOT guardrails.preCall, which checks {count:1} = 'is there ANY budget left', not 'enough for this call'. An overrunning hop KEEPS its output and is labelled incomplete: true — stop AFTER the call that overran.
- [Phase 15]: 15-03: SC#3 lineage is audit-ONLY with correlationId := rootRequestId — by_correlation already existed, so the call tree reconstructs and its cost sums to the root with NO new table, NO new index and NO schema change. Three deliberate NON-decisions pinned as source comments: no subAgentRuns table, no telemetry mirror (telemetry.requestId is v.id("requests") and a specialist run seeds zero requests rows by design), nothing on agentSteps (a shadow log there would be a section-4 regression).
- [Phase 15]: 15-03: ADR-008 — depth/ancestry/envelope/spend travel as validator-checked internalAction args, never DB state. A Convex action has no ambient ctx and a ctx cannot be extended across runAction, so the only alternative was a row: a lost-update race on the one field whose job is to be a ceiling, for zero benefit at depth 1. rootRequestId is minted fresh and is NEITHER planId (recycled per thread, 12-05) NOR plans.correlationId (only set at executePlan, i.e. after Approve).
- [Phase 15]: 15-03: a cross-tenant isolation test must assert NON-EMPTY partitions on BOTH sides — a zero-size partition passes a naive no-leakage check vacuously. And it must read the audit table DIRECTLY: audit has no public tenant-scoped reader, so the plans.byThread form alone would prove isolation of the PLAN, not of the lineage rows SC#5 names. Driven under a deliberate rootRequestId + threadId collision, not two unrelated runs.
- [Phase 15]: 15-04: actOnGap STAYS a tenantMutation and SCHEDULES the specialist — a Convex mutation cannot call an action, and a tenantAction would make the resetPlan+patchPlan recycle interruptible while still leaving the card blank for the same 30s. It stages status: "collecting" with an EMPTY body, and THAT is the Approve-race mitigation: executePlan already refuses any non-proposed row (cockpit.ts:530), so the race closes BY CONSTRUCTION — no new guard, no new status literal, and zero apps/web edits (PlanCard renders only at proposed, cards.tsx:1624). Do not "simplify" it back to proposed: the failure it prevents is a user approving a TEMPLATE under a specialist attribution header, at the exact surface where consent is irreversible.
- [Phase 15]: 15-04: the terminal is chosen by a RUNTIME resolveSpecialist(gap.route) at the ENTRY point, not only inside the dispatcher — a gap with no registered specialist ("" from diagnose()'s ask branch, "scale" from its healthy branch) keeps the 12-05 memo at proposed with NOTHING scheduled. landSpecialistResult is the ONLY writer of a dispatched body and no-ops unless the row is still collecting, still kind: "memo", and under the SAME tenantId (an explicit-tenantId internal twin carries no live identity, so that check is manual — mutation-checked: removing it lets a finished run clobber a canceled plan's own draft).
- [Phase 15]: 15-04: dispatchAndLand lands in a `finally`, so "the plan always leaves collecting" is as unconditional as "a started step always ends" — success, overrun, all four refusals, and a throw. A THROWN turn is NOT a fifth refusal: it audits subagent.refused with the CODE only (never err.message, §4), DLQs nothing, lands the fallback, and RETHROWS — DispatchResult's union is the GOVERNED-stop contract, and swallowing an exception would hide a real bug (the §5 loader fails closed by throwing) from the scheduled function's own failure state.
- [Phase 15]: 15-04: buildMemo is now the FALLBACK and its wording BRANCHES — 12-05's "That specialist does not execute yet" became FALSE the moment dispatch shipped, and an approved memo may not tell the user something untrue. The reason is a CODE mapped through a code-owned FALLBACK_SENTENCE map and never surfaces. The attribution line and the cost-ceiling marker ride the plan BODY (specialistMemoBody), never a plans.status literal — the enum is PINNED with apps/web blast radius.
- [Phase 15]: 15-04 (test infrastructure, generalizes): convex-test FLUSHES due scheduled work in the background, so any test that schedules a PRODUCTION action and does not cancel it has a hidden dependency on whether OPENAI_API_KEY is set — the e2e test lost that race to a real gateway call. Assert the queued job through ctx.db.system (_scheduled_functions: name + args), CANCEL it, then replay its EXACT args through the offline twin.
- [Phase 15]: 15-06: citesVaultDoc probes the seeded corpus NEEDLE (evalgrd), not a vault title root — a title root is echoed straight out of the fixture's own turns, so the assertion would pass without searchVault ever running; validateFixture forbids any turn from containing the needle
- [Phase 15]: 15-06: SKILL_NAMES is DERIVED from GATED_SKILLS (read off skill.ts) and --skill is MULTI-pin with one evidence row per pin — a newly gated skill is pinnable the day it is gated, and one run certifies a whole family
- [Phase 15]: 15-06: the specialist-body EVAL GATE is UNPAID (no CONVEX_DEPLOYMENT in this worktree) — SHIP DARK per CONTEXT: candidates park, active v1 bodies stay live, nothing faked or hand-activated
- [Phase 15.1]: Tier thresholds LOCKED (paidStaff===0 && headcount<=2 => solopreneur; else not(steady-revenue AND bootstrapped) => startup; else sme) — retuned via the test boundary table, NEVER a config row (D2)
- [Phase 15.1]: D6 is expressed as a TYPE: deriveTier returns DerivedTier (3 members), enterprise lives only on the table — mutation-checked @ts-expect-error bind
- [Phase 15.1]: tenantProfiles facts are ALL optional and never narrowed (the design §10 legacy backfill row must stay representable); tier/tierSource/derivedAt REQUIRED
- [Phase 15.1]: ADR-009: tier shapes the specialist PROMPT, not the offer set — diagnose() emits ONE prescription, so SC#5 must not be read as offer-set filtering or a rubric change

### Pending Todos

- **UNPAID EVAL GATE (15-06) — the three rewritten specialist bodies are PARKED.** `offer-architect`,
  `money-model-designer` and `lead-engine` now name `searchVault`, state the read-only posture and give an
  honest not-enough-data answer — but all three are in `GATED_SKILLS`, and `pnpm eval:golden` was NEVER RUN
  because `.worktrees/lane-a-dispatch` has no `CONVEX_DEPLOYMENT`. Nothing was faked, no fixture weakened,
  nothing hand-activated. **On the deployment the ACTIVE rows are still the v1 bodies with the "runs later"
  framing, so a dispatched specialist today runs the OLD body.** To close it, on a checkout with a live
  deployment: `pnpm dev` (seeds — `npx convex dev` ALONE does not) -> READ BACK the live version carrying
  each body (`seedSkills` writes `maxVersion + 1` and optimizer dry-runs occupy versions; a fresh deployment
  also LIES via the `rows.length === 0` bootstrap path) -> ONE run:
  `pnpm eval:golden --skill offer-architect@N --skill money-model-designer@N --skill lead-engine@N`
  (multi-pin ships in 15-06; one evidence row per pin; budget ~$0.19 + three dispatched specialist turns)
  -> GREEN: `activateSkill` each and VERIFY LIVE with `getActiveSkill`; RED/flaky/over-cap: leave them
  parked, do NOT weaken a fixture and do NOT hand-activate. Full recipe + first-run risks in
  `.planning/phases/15-sub-agent-dispatch-action-executor/deferred-items.md` and
  `docs/playbooks/skill-registry.md`'s GATE OUTCOME paragraph. The three new fixtures
  (29/30/31-gap-dispatch-*) have also never run live.
- ~~**12-04 AND 12-05 visual verification is UNPAID debt**~~ — **PAID 2026-07-25.** The owner ran all three checks (12-04 card states, 12-05 tap → NEXT-STEP MEMO → "Approve & save" → memo at `/dashboard/vault` with no email sent, 12-06 teaching) and reported "Everything worked. I approve."
- ~~**Repeat-evaluation provenance gap (logged, not fixed)**~~ — **CLOSED 2026-07-25 at 13-02.** Re-running an evaluation in the SAME thread used to collapse `findingCount` (8 → 1): carry-forward preserved the scorecard VALUES but not their PROVENANCE, so only freshly-filled paths were re-cited. `fillVault` now separates the two rules — the VALUE is first-write-wins, the CITATION is re-recorded whenever a grounded document restates the field — and the two upstream short-circuits are gone. No fresh-thread workaround is needed any more. Regression guard: `proactiveReview.test.ts > notifies only on change`. The historical detail stays in `.planning/phases/12-business-evaluation-engine/deferred-items.md`.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-07-26T12:05:22.263Z
Stopped at: Completed 15.1-01-PLAN.md
Resume file: None
