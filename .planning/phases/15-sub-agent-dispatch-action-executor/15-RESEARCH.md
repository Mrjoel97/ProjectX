# Phase 15: Sub-Agent Dispatch & Generalized Action Executor - Research

**Researched:** 2026-07-25
**Domain:** Convex action orchestration + `ai@7` tool-loop parameterization + governed action dispatch
**Confidence:** HIGH (codebase findings are first-hand file:line reads; library findings verified against installed source)

## Summary

This phase has almost no external unknowns. Every mechanism it needs already exists in the repo and
was verified by reading it: the ONE governed loop (`runAgentLoop`) already takes the skill body as a
parameter, the skill registry already holds all three specialist bodies as GATED rows, the approve
gate already has a two-arm branch that just isn't a table yet, and the audit payload contract already
permits the lineage ids without a schema change. The work is **structural refactoring under existing
invariants**, not integration of anything new. The single genuinely new external fact needed —
"how do I read the remaining daily budget out of the rate-limiter?" — resolves to a one-line
`rateLimiter.getValue(ctx, "dailySpendCents").value`, verified in the installed `@convex-dev/rate-limiter@0.3.2`
source.

Three findings materially change the plan versus what CONTEXT.md assumed. **(1)** `gap.route` is
**not** a closed enum today — `Prescription.route` is typed `string` (`packages/core/src/growth/diagnose.ts:16`)
and persists as `v.string()` (`schema.ts:350`), so SC #1's "type-level guarantee" has to be *built*
(close the union in `packages/core`) *and* backed by a runtime fail-closed lookup, because persisted
rows predate any union. **(2)** `actOnGap` is a `tenantMutation` and a Convex mutation cannot call an
action — dispatch must be scheduled (`ctx.scheduler.runAfter(0, …)`) or `actOnGap` must become a
`tenantAction`; either way there is a real race where the user could Approve a template body before
the specialist returns. **(3)** the `dailySpendCents` window is **keyless/global**, not per-tenant
(`guardrails.ts:27`), so "the tenant's remaining daily budget" is really "the deployment's" —
acceptable for the single-owner beta, but the plan should say so honestly rather than claim per-tenant
scoping it doesn't have.

**Primary recommendation:** Add ONE append-only optional `toolNames?: readonly string[]` arg to
`runAgentLoop` (filter the built record — the `omitRecipientEdits` precedent), keep the specialist
**skill body in the `skills` table** and the **tool-set allow-list in pure TS** (`packages/core`), thread
depth/cycle/budget as **validator-checked call args** on an `internalAction` (never a DB row, never an
ambient context), carry lineage as **`correlationId := rootRequestId` + refs-only audit payload**
(zero `audit` schema change), and generalize `executePlan` into an **exhaustive `satisfies Record<ActionType, Arm>`
switch** that leaves `deliverApprovedPlan.ts` byte-unchanged.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Which specialists go live**

- **All three growth specialists become dispatchable**: `offer-architect`,
  `money-model-designer`, `lead-engine`. All three already exist as skill bodies in
  `packages/contracts/skills/`, are already in `GATED_SKILLS`, and `diagnose()` already emits
  them as `gap.route` values — so every gap the user can tap resolves to a runnable specialist.
  No gap is left on the old memo behaviour.
- **The ONLY dispatch trigger this phase is the existing "Act on this" gap control.** The
  executive router's free-text `sub_agent` route stays hollow until Phase 16's Research
  specialist. Rationale: `gap.route` comes from a CLOSED enum computed by `diagnose()`, so
  "an unknown specialist fails closed to `unknown_route`" (SC #1) is a type-level guarantee
  rather than a runtime validation of model-supplied text.
- **Specialist tool-set is read-only, least privilege**: vault grounding + evaluation reads.
  NO send, NO plan-write, NO scorecard write. The specialist returns findings; the executive
  agent stages any write. This is the posture Phase 16 explicitly depends on ("it has NO
  send/write capability, so an injected instruction can at most propose, never execute").
- **The three specialist bodies get rewritten to run.** Drop the "Registered now; a full build
  runs later" placeholder framing; write them as working specialists producing grounded output.

**Eval gate (consequence of rewriting the bodies)**

- All three are in `GATED_SKILLS`, so each edit publishes a CANDIDATE that activates only
  through a recorded passing eval run (EVAL-01 / Phase 3.6).
- **One eval run, all three pinned.** Extend `run-eval-golden.mjs`'s `--skill` handling to
  accept multiple pins (or derive valid targets from `GATED_SKILLS` — its `SKILL_NAMES`
  allow-list is currently a hardcoded three that excludes every Phase 12 skill). One run,
  one cost, one sitting; the runner already records evidence per `(name, version)`.
- **Three new golden fixtures, one per specialist, end-to-end**: a gap routing to that
  specialist, tapped, dispatched, output staged. Mirrors the `27-grounded-assessment` /
  `28-healthy-no-gaps` precedent, and exercises depth cap + lineage on the real path.
- **If the gate does not go green inside Phase 15, ship dark.** The framework (dispatch,
  depth cap, cycle refusal, envelope, lineage, executor) still lands and is still tested;
  specialists stay on their active v1 bodies with candidates parked. Phase 15's success
  criteria do not require a rewritten body.
- **Automated green is sufficient to merge** — no owner sign-off gate inside the phase.
  This matches `PARALLELIZATION.md` Stage 3: the merge gate is automated only, and the
  owner's live human-verify happens ONCE on integrated `main` after all lanes land,
  covering Phases 14 and 15 in one pass.

**What the user sees**

- **Same plan card, real body, plus a specialist attribution header.** The NEXT-STEP MEMO
  card keeps its shape and its single Approve gate; the body changes from `buildMemo`'s
  deterministic template to the specialist's grounded output, and a visible attribution line
  names which specialist produced it.
- **Dispatch appears in the live activity trace (CKPT-05) as a step that NAMES the
  specialist.** The running step row IS the progress indicator — no separate card pending
  state, no spinner to build. `agentSteps.tool` is a CLOSED literal union in `schema.ts` and
  the UI renders it through a code-owned label map, so carrying "which specialist" means
  either N literals or a second field. **That schema change belongs to the Wave-0 freeze
  commit** (`PARALLELIZATION.md` Stage 1), not to a lane.
- **The user does NOT choose the specialist.** `diagnose()` computes `gap.route`
  deterministically from the binding constraint and "Act on this" honours it. No confirm
  step in front of the Approve gate — Approve is already the consent point. The route is
  never user-supplied.

**Limits and refusal behavior**

- **Depth cap = 1** (executive → specialist). A specialist can never dispatch anything.
  Satisfies "no agents spawning agents" literally and makes cycles structurally impossible.
  Phase 16's Research specialist is dispatched BY the executive, so 1 is sufficient for every
  known downstream need.
- **Cycle refusal still ships and is asserted explicitly** (A→B→A rejected), even though
  depth 1 already prevents it. SC #2 names it as its own criterion; defense in depth means
  the guarantee is already there and already tested the day the cap rises.
- **The shared root-request cost envelope is DERIVED from the tenant's remaining daily
  budget** — not a fixed constant. Consequence: `guardrails.ts`'s daily-spend window, today a
  write-only global rail (`recordSpend`), must expose a readable "remaining". **That read
  lands in the Wave-0 freeze commit**, after which `guardrails.ts` is frozen like `llm.ts` and
  `schema.ts`. The envelope is drawn down by every priced call across the whole sub-agent tree.
- **On mid-tree exhaustion: stop, keep the partial output, label it incomplete.** Return what
  the specialist produced with an explicit "incomplete — cost ceiling reached" marker and let
  the human decide at the Approve gate. Matches the codebase's honesty posture (Phase 12's
  not-enough-data verdict is never dressed up as a finding).
- **Every refusal — unknown specialist, depth-cap breach, cycle, drained envelope — is a
  conversational reply, NEVER a dead-letter.** This is the precedent `runAgentLoop` already
  sets with `PAUSED_REPLY` for `kill_switch` / `daily_budget_exhausted`: a governed stop is a
  paused conversation, not a system failure. The cockpit has never DLQ'd a user-facing turn.
- **SC #1 and SC #2 are proven in `convex-test`, offline, with no LLM spend.** Depth cap,
  cycle refusal, unknown specialist, and envelope exhaustion all assert there — the backend
  suite's dominant pattern (~495 offline tests). Paid golden fixtures stay on the happy path.

**The generalized action executor (ACTN-01)**

- **Refactor only — a table of two arms** (`email`, `memo`). No third arm and no test-only
  arm is invented: every in-scope candidate action belongs to a later phase. The deliverable
  is the seam plus a test proving that adding an arm requires ZERO spine edits.
  Note that `executePlan` already executes a non-email action type today
  (`plan.kind === "memo"`, shipped 12-05), so SC #4 is about generalizing that branch into a
  dispatch table — not about widening the gmail fan-out.
- **Closed action-type union and the "which arm" decision are pure TS in `packages/core`**
  (Convex-free, unit-testable — CLAUDE.md §1); the arms themselves stay in `convex/` because
  they do DB writes. Mirrors the existing `routing.ts` / `diagnose()` split.
- **Two-level dispatch.** `executePlan` is the dispatcher and picks the arm. Arms that need
  durable multi-step orchestration start a workflow (email today, calendar later); arms that
  do not (memo) execute inline. `deliverApprovedPlan` is generalized as the **workflow-backed
  arm's entry point** rather than as the universal dispatcher.
  *Why not "everything through `deliverApprovedPlan`":* a memo plan starts no workflow at all
  today, so routing it through the workflow would add orchestration, workflow rows, and
  latency for one DB write — and would re-expose the gmail fan-out as reachable-in-principle
  from every action type, a structural safety property 12-05 bought by keeping that file
  byte-unchanged.
- **An unknown action type is impossible by type**: closed union + exhaustive switch means an
  unhandled arm is a COMPILE error, with a runtime throw only as the unreachable backstop.
  Same technique as `routing.ts` ("a route the system cannot validate is a route it must not
  take").
- **The human Approve gate stays a `tenantMutation`, never a tool** (SC #4, and the standing
  v2.0 architecture rule).

### Claude's Discretion

- Exact shape of the lineage rows (SC #3) — which tables carry `rootRequestId` /
  `parentAgentId`, and whether telemetry mirrors audit. Constraint: refs/ids/counts ONLY
  (CLAUDE.md §4), and the call tree must be reconstructable from the insert-only audit with
  cost attributed to the root request.
- Form of the cross-tenant isolation assertion (SC #5) — follow the existing precedent for
  isolation tests on tenant-scoped rows; a sub-agent run keyed on `rootRequestId` must still
  be tenant-scoped.
- Naming: the action-type union members, the dispatch step's literal(s), the specialist
  attribution copy.
- Whether "which specialist" rides `agentSteps` as N literals or a second field.
- The precise fraction/derivation of remaining daily budget that forms the envelope.
- Where the "incomplete — cost ceiling reached" marker lives on the plan row vs in the body.

### Deferred Ideas (OUT OF SCOPE)

- **User-overridable specialist route** — letting the user pick a different specialist than
  `diagnose()` chose. Deliberately out: it opens the route to user-supplied values, the exact
  surface SC #1's fail-closed requirement defends.
- **Depth cap > 1 / specialist-dispatches-specialist composition** — cycle refusal ships now
  so this is cheap later, but the cap stays 1 this phase.
- **A third action arm** — research (Phase 16), calendar (17), documents (18), contacts/CRM
  (19) each add exactly one arm to the table Phase 15 builds.
- **Free-text `sub_agent` routing from the executive router** — arrives with Phase 16's
  Research specialist, which is the first specialist a user can reach by asking.
- **Card pending state during dispatch** — the trace step is the indicator this phase; a
  dedicated card pending state is polish for whenever a web lane exists.
- **Adversarial golden fixtures** (unknown specialist / depth breach / cycle against a real
  model) — refusals are asserted in `convex-test` this phase; paid adversarial fixtures are a
  later hardening pass.
- **Specialist output quality beyond the first rewrite** — the bodies get one honest rewrite;
  deeper method work is its own pass.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **DISP-01** | Real sub-agent dispatch — specialized sub-agents are swappable (skill body, tool-set) pairs run by the single governed loop, with a depth cap, a shared root cost budget, cycle refusal, and recorded lineage (no nested loops, no agents-spawning-agents) | §"The ONE governed loop and its injection seam" (the `system` param already exists; `toolNames` is the ONE new arg at `llm.ts:1642-1677`) · §"Where dispatch state lives" (call args, not DB rows) · §"The cost envelope" (`rateLimiter.getValue` verified) · §"Lineage without a schema change" (`AuditPayload` already permits ids) |
| **ACTN-01** | A generalized governed action executor lets an approved plan execute actions beyond `gmail.send` (the approve→execute spine becomes action-agnostic) | §"The approve→execute spine today" (`cockpit.ts:496-625` full branch order) · §"Pattern 4: exhaustive arm table" (`satisfies Record<ActionType, Arm>`) · §"Don't Hand-Roll" (`deliverApprovedPlan.ts` stays byte-unchanged — a security property, not a style choice) |
</phase_requirements>

## Standard Stack

Nothing is added. Every dependency this phase needs is already installed and pinned. **CLAUDE.md §6
forbids bumping any of these**; treat the version column as a hard constraint, not a suggestion.

### Core (already installed — do not add, do not bump)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` | `7.0.20` (exact) | `generateText` + `tool()` + `stepCountIs` — the whole governed loop | Already THE loop (`llm.ts:1685`); `onToolExecutionStart/End` are the CKPT-05 emitter |
| `convex` | `1.42.1` (exact) | actions/mutations/queries, `ctx.scheduler`, validators | The runtime |
| `@convex-dev/rate-limiter` | `0.3.2` (exact) | the daily-spend window the envelope reads and draws down | `guardrails.ts:23-28`; `getValue` is the readable-remaining API |
| `@convex-dev/workflow` | `0.4.4` (exact) | the workflow-backed (email) arm of the executor | `deliverApprovedPlan.ts:23` |
| `convex-test` | `0.0.54` (dev) | offline in-memory Convex — where SC #1/#2/#5 are proven | ~495 offline backend tests; the dominant pattern |
| `vitest` | `^3.2.7` (dev) | test runner, `edge-runtime` env | `packages/backend/vitest.config.mts` |

### Supporting (workspace packages)

| Package | Purpose | When to Use |
|---------|---------|-------------|
| `@pikar/core` | pure-TS domain logic, Convex-free | The closed `ActionType` union, the arm-selection function, the specialist registry, the closed `SpecialistRoute` union (CLAUDE.md §1) |
| `@pikar/contracts` | skill name constants, `GATED_SKILLS`, `AuditPayload`, `parseRouting` | Specialist skill-name constants; the lineage payload type |
| `@pikar/cost` | `priceUsage(model, usage) → Result<number>` | Already called inside `recordModelSpend` (`llm.ts:1623`) — the envelope reads its output, it does not re-price |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Filtering the tool record for the specialist tool-set | `activeTools` (native `ai@7.0.20` option, `ai/dist/index.d.ts:4868`, `type ActiveTools<TOOLS> = ReadonlyArray<keyof TOOLS & string>`) | `activeTools` is one line and needs no record surgery, BUT the write tool's `execute` closure still exists in the record — and `invokeTool` (`llm.ts:1602`) can reach it by name. The repo already faced this exact fork at `omitRecipientEdits` and chose structural absence: *"the recipient-mutating tools are ABSENT from the returned record — a fabricated overwrite is impossible by construction, not skill wording"* (`llm.ts:619-626`). **Use the filtered record.** Note `activeTools` in a `ponytail:` comment as the cheaper-but-weaker alternative. |
| `internalAction` + `ctx.scheduler.runAfter(0, …)` from `actOnGap` | Convert `actOnGap` to a `tenantAction` (the `sendCockpitMessage` shape, `cockpit.ts:72`) | The action version can await the specialist and stage the finished body in one call — no intermediate approvable state. But it makes the plan-row transitions non-transactional and the card shows nothing for 10-30s unless the trace carries it. Scheduling keeps the mutation atomic and lets the CKPT-05 trace be the progress indicator (which is what CONTEXT locked). **Recommend scheduling; see Pitfall 2 for the race it creates and the mitigation.** |
| `correlationId := rootRequestId` on the existing `audit` table | A new `subAgentRuns` table with indexed `rootRequestId` / `parentAgentId` | A new table is queryable and indexable, but it is a second log plane next to an insert-only audit that already has `by_correlation`. PARALLELIZATION's singleton rule prefers new tables to new fields — but here the *cheapest correct* answer needs neither. **Only add a table if a plan genuinely needs to LIST sub-agent runs; SC #3 only requires reconstructing the tree, which `by_correlation` already does.** |

**Installation:** none. `pnpm install` in the worktree, then `npx convex dev` for codegen (CLAUDE.md §7).

## Architecture Patterns

### Where the code lives

```
packages/core/src/
├── growth/diagnose.ts        # CLOSE Prescription.route to a union here (currently `string`)
├── specialists.ts   (NEW)    # route → { skillName, tools[] } registry + fail-closed lookup
└── actionType.ts    (NEW)    # closed ActionType union + arm-selection ("workflow" | "inline")

packages/backend/convex/
├── llm.ts                    # runAgentLoop gains ONE optional `toolNames` arg   [Lane A]
├── dispatch.ts      (NEW)    # the internalAction: depth/cycle/envelope + lineage [Lane A]
├── cockpit.ts                # executePlan → exhaustive arm switch                [Lane B]
├── deliverApprovedPlan.ts    # BYTE-UNCHANGED (the email arm's entry point)       [Lane B]
├── evaluations.ts            # actOnGap schedules dispatch instead of buildMemo
├── guardrails.ts             # + remainingDailyCents internalQuery              [Wave 0]
└── schema.ts                 # + agentSteps.tool dispatch literal(s)            [Wave 0]
```

**Every new `.ts` file under `packages/` or `apps/` must be registered in `docs/playbooks/watch.json`
in the same commit** or the Stop hook blocks the turn (`scripts/check-playbooks.mjs:127-134`).
`watch.json` is a Wave-0 singleton (PARALLELIZATION Phase-3.8 rule #5).

---

### Question 1: Where the router lives, and what `sub_agent` does today

**There are two routers, and only one of them has a `sub_agent` route.**

**(a) The v1 request-pipeline router — where `sub_agent` is literally hollow.**
`packages/contracts/src/routing.ts` defines `routingSchema` with `z.enum(["direct_llm","direct_tool","sub_agent"])`
and `parseRouting(value) → { ok:false, reason:"unknown_route" }` on any failure. Its own comment says
*"`sub_agent` is a valid enum member but unimplemented downstream in Phase 2"* and *"a route the system
cannot validate is a route it must not take"*. It is consumed by `convex/llm.ts:159 routeUncached`
(`:215` `if (!parsed.ok) throw new Error(parsed.reason)` → DLQ) and by `convex/pipeline.ts:215`:

> `const draftsViaLLM = routing.route === "direct_llm" || routing.route === "sub_agent";`

That single line **is** the hollowness — a `sub_agent` route drafts through the ordinary email drafter,
identically to `direct_llm`.

**(b) The LIVE cockpit surface has no route enum at all.** `cockpit.sendCockpitMessage`
(`cockpit.ts:72`, a `tenantAction`) → `internal.llm.runCockpitAgent` (`llm.ts:1925`) → `runAgentLoop`
(`llm.ts:1642`). The model picks *tools*, not routes. This is where users actually are.

**Consequence for the plan:** CONTEXT locks the only trigger to the "Act on this" gap control
(`evaluations.actOnGap`, `evaluations.ts:582`) using `gap.route`. **Phase 15 therefore does not need to
touch `pipeline.ts:215` at all** — the v1 hollow branch stays hollow and Phase 16 owns it. Say this
explicitly in the plan so a reader doesn't assume `pipeline.ts` is in scope.

**⚠️ The route is NOT a closed enum today.** `Prescription.route` is `route: string`
(`packages/core/src/growth/diagnose.ts:16`), the constructor takes `route: string` (`:30`), and it
persists as `route: v.string()` (`schema.ts:350`, commented *"the target specialist skill (execution
deferred to 15+)"*). The three literals `"offer-architect"` / `"money-model-designer"` / `"lead-engine"`
appear as bare strings at `diagnose.ts:41,58,68,101,111,121,131,143,154,165` — plus one deliberately
**empty** `route: ""` on the not-enough-data ask branch (`diagnose.ts:84-85`). CONTEXT's claim that
SC #1 is "a type-level guarantee" is therefore only half true today: it must be *built*, and it must
still be backed by a **runtime** fail-closed lookup because rows written before the union carry
un-narrowed strings (including `""`).

---

### Question 2: The ONE governed loop and its (skill body, tool-set) injection seam

`runAgentLoop(ctx, args)` — `packages/backend/convex/llm.ts:1642-1757`. Signature (`:1644-1663`):

| Arg | Status | Notes |
|-----|--------|-------|
| `tenantId`, `planId` | required | explicit — the loop carries NO live identity |
| **`system`** | required | **already the skill-body seam** — `runCockpitAgent` passes `skill.body` (`llm.ts:2066`) |
| `prompt` | required | history block + plan context + `"The user says: …"` |
| `primary` / `fallback` | required | `PricedModel = { model, id }` — the id is what `priceUsage` keys on |
| `skillVersions?`, `turnId?`, `threadId?`, `omitRecipientEdits?` | optional | the **append-only optional-arg convention**, explicitly documented at `:1653-1657` |

**The tool-set is NOT a parameter.** `llm.ts:1677`:

> `const tools = buildCockpitTools(ctx, tenantId, planId, undefined, skillVersions, omitRecipientEdits);`

**Minimum change to make it parameterizable without forking:** add ONE more append-only optional arg
following the documented convention — `toolNames?: readonly string[]` — and filter the built record:

```ts
const built = buildCockpitTools(ctx, tenantId, planId, undefined, skillVersions, omitRecipientEdits);
// Absent ⇒ the full set, byte-identical to today (every existing caller unchanged).
const tools = toolNames
  ? Object.fromEntries(Object.entries(built).filter(([n]) => toolNames.includes(n)))
  : built;
```

This is a ~3-line diff to a 2,985-line file. **Everything the loop already gives a specialist for free:**
`stopWhen: stepCountIs(8)` (`:1690`), `AbortSignal.timeout(CALL_TIMEOUT_MS)` where `CALL_TIMEOUT_MS = 45_000`
(`:83`, `:1691`), `recordModelSpend` → `internal.guardrails.recordSpend` (`:1738`, `:1618-1627`),
one fallback retry on `isFallbackEligible` (`:1744-1746`), `ConvexError({kind:"agent_timeout"})` on
exhausted timeout (`:1753`), and the CKPT-05 emitters (`:1709-1736`).

**The emitters are guarded on identity:** `if (turnId === undefined || threadId === undefined) return;`
(`:1711`). A dispatch that wants a visible trace step MUST pass both. `runEvaluation` already shows the
precedent for an action that mints its own `turnId` (`evaluations.ts:174` `const turnId = crypto.randomUUID()`).

**No nested loops:** dispatch is a **sequential second call** to `runAgentLoop` from the dispatching
action — same function, different `system` + different tool subset. There is no `generateText` inside a
tool `execute`, and there must not be.

**Available tool names** (keys of `buildCockpitTools`, `llm.ts:731-1575`):
`addRecipients` · `setRecipients` · `removeRecipient` · `resolveContacts` · `setSubject` · `setSendTime` ·
`setMode` · `resetPlan` · `draftBody` · `personalizeRecipient` · `generateAttachment` ·
`regenerateAttachment` · `removeAttachment` · `proposePlan` · `listInbox` · `briefInbox` ·
**`searchVault`** · **`evaluateBusiness`** · `recordScorecardAnswer` · `replyToMessage`.

CONTEXT's least-privilege specialist set = `["searchVault"]` plus whatever "evaluation reads" resolves
to. **Note:** `evaluateBusiness` (`llm.ts:1380`) is not a read — it calls `internal.evaluations.runEvaluation`,
which **persists a new `evaluations` row** and writes an audit row. A truly read-only specialist should get
a thin read over `internal.evaluations.lastForThread` (`evaluations.ts:124`) instead, or nothing at all
(the dispatcher can inject the evaluation snapshot into the `prompt`, which is cheaper and strictly
read-only). **Recommend: specialist tool-set = `["searchVault"]` only, with the evaluation row's
findings/gaps injected into the prompt by the dispatcher.** That is the strongest possible reading of
"NO plan-write, NO scorecard write" and it removes a whole class of re-entrancy.

---

### Question 3: The specialist registry, and where depth/cycle/budget state lives

**Skill bodies — already done, do not rebuild.** `skills` table (`schema.ts:47-61`): `{name, version, body, status, evidence, createdAt}`, indexes `by_name_status` / `by_name_version`. Loader `loadSkill(ctx, name)`
(`skills.ts:67`) reads the single `status==="active"` row and **throws** when none exists (fail-closed);
the action-facing wrapper is `internal.skills.getActiveSkill` (`skills.ts:83`) and the pinned-version
variant is `internal.skills.getSkillVersion`. All three specialist names are already constants in
`packages/contracts/src/skill.ts` and already in `GATED_SKILLS` (`OFFER_ARCHITECT_SKILL`,
`MONEY_MODEL_DESIGNER_SKILL`, `LEAD_ENGINE_SKILL`). Bodies live as the **5-file mirror**:
`packages/contracts/skills/offer-architect.md` (canonical) ↔ `packages/contracts/src/skills/offerArchitect.ts`
(bundler-safe constant) ↔ name const ↔ `seedSkills` row ↔ drift row, with byte-identity enforced by
`packages/contracts/src/skills/skillBodies.test.ts`.

**Tool-set allow-list — does not exist; build it in pure TS, not in the DB.** A tool-set is a *capability
grant*, not a prompt. §5 requires prompts to be registry rows; it does not require capabilities to be,
and putting an allow-list in a DB row would make capability DB-writable. Recommended shape
(`packages/core/src/specialists.ts`, Convex-free per §1):

```ts
export const SPECIALIST_ROUTES = ["offer-architect", "money-model-designer", "lead-engine"] as const;
export type SpecialistRoute = (typeof SPECIALIST_ROUTES)[number];

export type SpecialistSpec = { readonly skillName: string; readonly tools: readonly string[] };

export const SPECIALISTS: Readonly<Record<SpecialistRoute, SpecialistSpec>> = { /* … */ };

/** Fail-closed lookup — mirrors parseRouting: an unvalidatable route is one we must not take. */
export function resolveSpecialist(route: string):
  | { ok: true; route: SpecialistRoute; spec: SpecialistSpec }
  | { ok: false; reason: "unknown_route" } { /* … */ }
```

This is also **exactly the seam Phase 15.1 plugs its tier filter into** — PARALLELIZATION explicitly
forbids Lane A from reading the tier in `llm.ts`, so keeping the registry as a pure data record in
`@pikar/core` is what makes 15.1 a filter layer instead of a router edit.

**Depth / cycle / budget state → CALL ARGS on an `internalAction`. Not a DB row. Not a context object.**

| Option | Verdict |
|--------|---------|
| **Call args** (recommended) | Convex actions have no ambient context; every hop is an explicit `ctx.runAction` with a validator, so the state is *checked at the boundary* and — because the entry point is an `internalAction` — structurally non-suppliable by the model (the `runCockpitAgent.skillVersions` precedent, `llm.ts:1935-1938`). At depth cap 1 the whole state is 5 scalars. |
| DB row | Introduces a read-modify-write race across a non-transactional action, plus a row to clean up. No benefit at depth 1. |
| Context object | Not expressible — a Convex action ctx cannot be extended across `runAction`. |

Recommended arg shape on the dispatch `internalAction`:

```ts
args: {
  tenantId: v.string(),
  threadId: v.string(),
  planId: v.id("plans"),
  route: v.string(),                 // validated by resolveSpecialist → unknown_route
  rootRequestId: v.string(),         // the lineage root (== correlationId)
  parentAgentId: v.string(),         // "executive" | a specialist route
  depth: v.number(),                 // refuse when > MAX_DEPTH (=1)
  ancestry: v.array(v.string()),     // cycle refusal: ancestry.includes(route) ⇒ refuse
  envelopeCents: v.number(),         // the shared root-request budget, clamped >= 0
  spentCents: v.number(),            // drawn down across the tree
}
```

Cycle refusal is then `ancestry.includes(route)` — one line, and it is *already correct* the day the cap
rises, which is precisely why CONTEXT wants it shipped now.

---

### Question 4: The approve→execute spine today, and the smallest generalizing change

**`executePlan` — `packages/backend/convex/cockpit.ts:496`, a `tenantMutation`.** Exact branch order
(this ordering is load-bearing and must be preserved):

| Line | Step |
|------|------|
| `505-506` | `ctx.db.get(planId)` + `plan.tenantId !== ctx.tenantId` → throw (no cross-tenant approve) |
| `509` | Idempotent CAS: `if (plan.status !== "proposed") return { ok:true, alreadyStarted:true }` |
| `514` | REVW-02 fail-closed: `if (plan.escalated) return { ok:false, reason:"review_escalated" }` |
| **`521-525`** | **MEMO TERMINAL** — `if (plan.kind === "memo") { patch status:"done"; persistNextStepMemo(ctx, plan); return }`. Deliberately BEFORE the mailbox pre-check so a memo needs no Gmail. **This is the branch ACTN-01 generalizes.** |
| `529-530` | Gmail token pre-check → `{ ok:false, reason:"gmail_not_connected" }` |
| `538-539` | SCHD-01 far-future cap → `send_time_too_far` |
| `542` | CAS flip → `"approved"` |
| `556-604` | Materialize attachments; seed ONE `requests` row per recipient with a server-minted `correlationId` |
| `612-620` | Deferred send: `ctx.scheduler.runAt(plan.sendAt, internal.cockpit.startScheduledDelivery, args)` → status `"scheduled"` |
| `622` | `startFanout(ctx, args)` → `workflow.start(internal.deliverApprovedPlan.deliverApprovedPlan, …)` (`cockpit.ts:452-462`) |

**`deliverApprovedPlan.ts` is 69 lines** and is email-only: it loops `requestIds`, calls
`internal.gmail.send`, writes telemetry, dead-letters per recipient, then `markPlanDone`. Its sole
production starter is `startFanout` (`cockpit.ts:452`, commented *"the SOLE `workflow.start(deliverApprovedPlan)`
call site"*); `smoke.ts:314` is the test starter.

**The action type already exists as a discriminator:** `plans.kind: v.optional(v.literal("memo"))`
(`schema.ts:241-246`) — *"ABSENT = the email plan every prior phase built … Closed literal so a widening
is a deliberate schema edit, never a runtime surprise."*

**Smallest change that makes it dispatch by action type:**

1. `packages/core/src/actionType.ts`: `export type ActionType = "email" | "memo";` +
   `export function actionTypeOf(kind: "memo" | undefined): ActionType` (absent ⇒ `"email"`, so no
   migration) + `export function armFor(t: ActionType): "workflow" | "inline"`.
2. In `cockpit.ts`, replace the `if (plan.kind === "memo")` branch with an exhaustive switch over
   `actionTypeOf(plan.kind)` whose arms are the *existing* code paths — `memo` → `persistNextStepMemo`
   (inline), `email` → the existing pre-check/seed/`startFanout` block (workflow).
3. `deliverApprovedPlan.ts` stays **byte-unchanged**. It is now named "the workflow-backed email arm's
   entry point" rather than "the delivery workflow" — a doc change, not a code change.

**"Adding an arm requires ZERO spine edits" is provable at COMPILE time**, which is stronger than a test:
declare the arm table as `satisfies Record<ActionType, Arm>` (or end the switch with
`const _exhaustive: never = t`). Adding a union member without an arm becomes a `tsc` error. Pair it with
the runtime backstop throw CONTEXT calls for, and with a `deliverApprovedPlan.ts` byte-unchanged assertion
(the 12-05 precedent, `gapAction.test.ts:157`: *"zero `requests` rows seeded ⇒ deliverApprovedPlan/gmail.send unreachable"*).

**SC #4's "Approve stays a mutation, never a tool"** is already true and is cheap to *assert*: `executePlan`
is a `tenantMutation` and does not appear among the 20 keys of `buildCockpitTools`. A static source scan
(the `llmRedaction.test.ts` / `auditImmutability.test.ts` idiom) pinning that absence is ~10 lines.

---

### Question 5: Audit/telemetry shape, and how lineage fits §4

**`audit` table (`schema.ts:15-28`):** `{ tenantId, correlationId, eventType, actor, payload: v.any(), ts }`.
Indexes: `by_tenant_ts`, **`by_correlation`**, `by_ts`. Sole write surface `internal.audit.log`
(`audit.ts:16-42`) — insert-only, no patch/replace/delete, enforced by `auditImmutability.test.ts`.

**`AuditPayload` (`packages/contracts/src/audit.ts`)** permits a *flat* map of
`string | number | boolean | null | readonly string[]`. Nested objects are deliberately not representable.

**⇒ `rootRequestId` and `parentAgentId` are legal payload values TODAY. No `audit` schema change is
needed for SC #3.** The cheapest correct shape:

```ts
await ctx.runMutation(internal.audit.log, {
  tenantId,
  correlationId: rootRequestId,          // ⇐ by_correlation already reconstructs the tree
  eventType: "subagent.dispatched",      // + "subagent.completed" / "subagent.refused"
  actor: "system",
  payload: {                             // refs / ids / counts ONLY (§4)
    rootRequestId, parentAgentId, specialist: route,
    depth, planId: String(planId), skillVersion, costUsd, stepCount,
  },
});
```

Reconstruction = `audit.by_correlation(rootRequestId)` ordered by `ts`; cost attribution = summing the
`costUsd` numbers on those rows. Both SC #3 clauses satisfied with zero new tables and zero new indexes.
`skillVersion` on the payload also closes the §5/IMPR-03 loop (*"callers must record `{name, version}` …
for every use"*, `skills.ts:64-65`).

**Telemetry does NOT fit and should not be forced.** `telemetry` (`schema.ts:493-509`) requires
`requestId: v.id("requests")`. A memo/specialist run seeds **zero** `requests` rows by design (12-05).
Inventing a `requests` row to obtain a telemetry row would re-enter the delivery spine — exactly the
structural property 12-05 bought. **Recommend: audit-only lineage; state that explicitly so a reviewer
doesn't read the absence as an oversight.**

**`agentSteps` is not an audit trail.** Its own header says so: *"this module writes NO log-plane row.
The trace is UI state, not an audit trail … A second, less-governed shadow log here would be a §4
regression."* Lineage must not go there. What `agentSteps` DOES need is the closed-union literal for the
dispatch step (`schema.ts:399-430`).

**"Which specialist" on the trace — recommend N literals, not a second field.** The union's comment is
explicit that §4 here is *enforced by the schema's absence of a text field*: *"a `count: v.number()`
literally cannot hold a subject line"* (`schema.ts:389-393`). Adding `specialist: v.string()` re-opens the
hole that design deliberately closed. Three literals (e.g. `dispatchOfferArchitect`,
`dispatchMoneyModelDesigner`, `dispatchLeadEngine`) cost three lines in `schema.ts` and three in the UI
VERB map, and keep the model structurally unable to inject a label.

**Pre-existing UI gap worth fixing in the same pass:** `evaluateBusiness` is **missing** from the VERB map
(`apps/web/app/(app)/dashboard/workspace/cards.tsx:1104-1122`) — it currently renders the `FALLBACK`
`"Working…"`. Any dispatch literal added without a VERB entry does the same.

---

### Question 6: The cost envelope — what exists, and how to read "remaining"

**Today (`packages/backend/convex/guardrails.ts`):**

- `DAILY_BUDGET_CENTS = 500` (`:21`) — *"≈ $5/day — the ONE daily-budget knob"*.
- `dailySpendCents: { kind: "fixed window", rate: 500, period: 24*HOUR }` (`:27`) — **keyless**,
  i.e. *"one bucket for the whole deployment"*, **not per tenant**. The `submitRequest` limit above it
  IS keyed by tenantId; this one is not.
- `prepare` (`:62`) checks *before*: `rateLimiter.check(ctx, "dailySpendCents", { count: estCents })`.
- `preCall` (`:149`) mid-flight checks `{ count: 1 }` — i.e. "is there ANY budget left", **not**
  "is there enough for this call".
- `recordSpend` (`:166`) consumes *after*: `Math.ceil(costUsd*100)`, skipping `cents <= 0`, with
  `reserve: true` so the window **goes negative** rather than under-counting.
- There is **no reader** — CONTEXT is correct that this is a write-only rail.

**The readable "remaining" (Wave-0 one-liner).** Verified against the installed source
(`node_modules/.pnpm/@convex-dev+rate-limiter@0.3.2/…/src/client/index.ts:179-209` and
`src/shared.ts:124-131`): `RateLimiter.getValue(ctx, name, options?)` takes a `RunQueryCtx` and returns
`GetValueReturns = { value: number; ts: number; shard: number; config }`, documented as *"the current
token utilization data without consuming any tokens"*. `value` is the **currently available tokens** —
for this fixed window, remaining cents.

```ts
/** Wave-0: the readable half of the daily-spend rail. Clamped — recordSpend's `reserve: true`
 *  drives `value` NEGATIVE on an overdraw, and a negative envelope is not an envelope. */
export const remainingDailyCents = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> =>
    Math.max(0, (await rateLimiter.getValue(ctx, "dailySpendCents")).value),
});
```

**Envelope derivation + drawdown.** Read once at dispatch → `envelopeCents = clamp(fraction × remaining)`
→ pass as a call arg → after each `runAgentLoop` return, `spentCents += Math.ceil(costUsd * 100)`
(`runAgentLoop` already returns `{ reply, costUsd }`, `llm.ts:1664`, and its accumulator explicitly spans
both the primary attempt and the fallback, `:1678-1680`) → refuse the next hop when `spentCents >= envelopeCents`.
The *global* window is still drawn down independently by `recordSpend` inside the loop; the envelope is a
**tree-local second ceiling**, not a replacement.

**⚠️ Honesty note for the plan:** CONTEXT says "the tenant's remaining daily budget". As built it is the
**deployment's**. `guardrails.ts:19-20` already carries the ponytail comment *"fixed constants for the
single-owner beta; per-tenant policy is the upgrade path"*. Either accept and word it accurately, or key
the limit by tenant — but keying it is a behaviour change to a frozen Wave-0 file and is not required by
any Phase-15 success criterion. **Recommend: accept, word it accurately, leave a `ponytail:` marker.**

---

### Question 7: How cross-tenant isolation assertions are written here — copy this

**The canonical example — `packages/backend/convex/evaluations.test.ts:205-226`:**

```ts
describe("two-tenant isolation (SC #5)", () => {
  test("tenant B never reads tenant A's evaluation row", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT, threadId: THREAD, query: `SMOKE::${docId}`,
    });

    // tenant_a sees its row; tenant_b sees null through the SAME tenant-scoped query.
    expect(await t.withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD })).not.toBeNull();
    expect(await t.withIdentity({ subject: "tenant_b" })
      .query(api.evaluations.byThread, { threadId: THREAD })).toBeNull();
  });
});
```

The shape: **write through the internal path with an EXPLICIT `tenantId`, read back through the PUBLIC
`tenantQuery` under two different `withIdentity({ subject })` values, assert row-vs-null.**
`stableTenant(subject)` (`lib/functions.ts:24`) maps the subject to the tenantId, so `subject: "tenant_b"`
is a genuinely different tenant.

**For Phase 15's dispatch/lineage rows:** the row keyed on `rootRequestId` is an `audit` row, and `audit`
has no public tenant-scoped reader. Two viable forms — pick one and say why:
- **(a)** assert directly on the table inside `t.run(async ctx => …)`: dispatch as `tenant_a`, then confirm
  every `audit` row with `correlationId === rootRequestId` carries `tenantId === "tenant_a"`, and that a
  `tenant_b` dispatch on the *same* `rootRequestId` string produces rows only under `tenant_b`. This
  directly encodes "a sub-agent run keyed on `rootRequestId` is still tenant-scoped".
- **(b)** assert on the *observable* surface: the specialist's output lands on the `plans` row, read back
  through `api.plans.byThread` under both identities (row vs null / throw).
  **Recommend shipping (a) — it names `rootRequestId`, which is what SC #5 actually says — and (b) as a
  cheap second assertion.**

**Component registration boilerplate (copy verbatim, it is fiddly):**

| Need | Register | Precedent |
|------|----------|-----------|
| any `internal.audit.log` write | `auditCounts` ← `@convex-dev/aggregate` | `evaluations.test.ts:26-31` |
| `recordSpend` / `preCall` / `getValue` | `rateLimiter` ← `@convex-dev/rate-limiter` | `runCockpitAgent.test.ts:19,38-44` |
| `persistNextStepMemo` → `startIngest` | `workflow` + `workflow/workpool` | `gapAction.test.ts:14-16,39-45` |

**The mock-model harness for the loop — this is how SC #1/#2 get proven offline with zero spend.**
`internal.llm.__runCockpitAgentWithScript` (`llm.ts:2116-2166`) builds a `MockLanguageModelV4` from a
serializable array of scripted `doGenerate` results and hands it to the **real** `runAgentLoop`
(a `LanguageModel` is not Convex-serializable, hence the shim). Helper builders live at
`runCockpitAgent.test.ts:49-64` (`provUsage` / `toolStep` / `textStep`). Phase 15 needs a sibling shim
for the dispatch entry point, or an optional script arg on the existing one.

**Known pre-existing red:** `convex/audit.test.ts` (`auditCounts` unregistered) — documented since Phase 2,
**not** a regression. Backend green is ~494/495. Don't chase it.

---

### Question 8: Which playbooks must be updated in-phase

Read from `docs/playbooks/watch.json`. The Stop hook blocks the turn on any of these.

| Playbook | Watched paths this phase touches | Owner |
|----------|----------------------------------|-------|
| **`cockpit.md`** | `convex/llm.ts`, `convex/cockpit.ts`, `convex/deliverApprovedPlan.ts`, `convex/plans.ts`, `convex/agentSteps.ts`, `apps/web/app/(app)/dashboard/workspace/`, `convex/cockpitTools.test.ts` | **Both lanes + web.** Append-only, region-scoped subsections; on merge conflict keep both (the `vault.md` Phase-3.8 rule). Bump `Last verified`. |
| **`business-evaluation.md`** | `convex/evaluations.ts`, `convex/evaluations.test.ts` | `actOnGap` → dispatch handoff |
| **`skill-registry.md`** | `convex/skills.ts`, `packages/contracts/src/skill.ts`, `packages/contracts/skills/`, `packages/contracts/src/skills/` | the three rewritten specialist bodies (5-file mirror each) |
| **`agent-runtime.md`** | `packages/backend/scripts/run-eval-golden.mjs`, `packages/backend/scripts/eval-cases/` | multi-pin `--skill` + 3 new fixtures |
| **`growth-diagnostic.md`** | `packages/core/src/growth/` | closing `Prescription.route` to a union |
| **`audit-dead-letter.md`** | `convex/audit.ts`, `packages/contracts/src/audit.ts` | **only if** either file changes. If lineage rides the existing `AuditPayload` unchanged (recommended), it does NOT. |

**Watched by nothing:** `convex/schema.ts`, `convex/guardrails.ts`, `packages/cost/`. Editing them triggers
no block — but a **NEW** `.ts`/`.tsx`/`.mjs` file under `packages/` or `apps/` that no playbook covers DOES
(`check-playbooks.mjs:127-134`; `.test.`/`.spec.` files are excluded). So `packages/core/src/specialists.ts`,
`packages/core/src/actionType.ts` and `convex/dispatch.ts` must be registered in `watch.json` **in the same
commit** — and `watch.json` is a Wave-0 singleton.

**ADR candidates** (`docs/decisions/`, next number **007**; ADRs are immutable — supersede, never edit):
1. *Sub-agent capability is code-owned; the sub-agent prompt is registry-owned.* (Why the tool-set
   allow-list is a `@pikar/core` constant and not a `skills` row — §5 governs prompts, not capabilities.)
2. *Dispatch lineage/limit state travels as validator-checked call args, never as DB state.*

---

### Pattern 1: Append-only optional args on a shared function

**What:** every capability added to `runAgentLoop` / `buildCockpitTools` has been an *optional* arg
appended to the end, with a comment naming the caller that supplies it.
**When to use:** any change to `runAgentLoop`, `buildCockpitTools`, `runCockpitAgent`, `patchPlan`.
**Why:** every existing caller keeps working byte-identically, so the diff is provably additive.

```ts
// Source: packages/backend/convex/llm.ts:1653-1657
// "Append-only optional args — the codebase's signature-evolution convention
//  (buildCockpitTools' 4th `clientContext` / 5th `skillVersions`): every existing
//  caller keeps working. A caller that supplies neither simply emits nothing."
```

### Pattern 2: Structural absence over instruction (the least-privilege tool-set)

**What:** withhold a capability by omitting the tool from the returned record, not by telling the model
not to use it.
**Why:** *"a fabricated overwrite is impossible by construction, not skill wording."*

```ts
// Source: packages/backend/convex/llm.ts:619-626 (the omitRecipientEdits arg)
// "…the recipient-mutating tools (addRecipients/setRecipients/removeRecipient) are ABSENT
//  from the returned record — a fabricated overwrite is impossible by construction."
```

### Pattern 3: Governed stop = conversational reply, never a DLQ

**What:** an expected refusal RETURNS a discriminated result and a calm sentence; only bugs throw.
**When:** all four Phase-15 refusals (unknown specialist, depth breach, cycle, drained envelope).

```ts
// Source: packages/backend/convex/llm.ts:1588-1589 / 1980-1983
const PAUSED_REPLY =
  "I've paused for a moment — I'm briefly unavailable. Please send that again shortly.";
// 1. Governed gate BEFORE any reasoning call — a governed stop is a paused reply, never a DLQ.
const pre = await ctx.runMutation(internal.guardrails.preCall, {});
if (!pre.ok) return { reply: PAUSED_REPLY, blocked: pre.reason };
```

Corollary from `guardrails.ts:1-5`: *"Governed stops RETURN a discriminated result — they NEVER throw …
Only bugs (a missing row) throw."*

### Pattern 4: Closed union + exhaustive switch as the fail-closed mechanism

**What:** the union is the guarantee; the runtime throw is only an unreachable backstop.
**Where it already lives:** `parseRouting` → `unknown_route` (`packages/contracts/src/routing.ts`),
`plans.status`, `plans.kind`, `agentSteps.tool`, `evaluations.framework`, the `evaluateBusiness`
`framework` enum (`llm.ts:1386-1396`, chosen *"so the model can't inject prose here"*).

```ts
// The ACTN-01 arm table — adding a member without an arm is a COMPILE error.
const ARMS = {
  email: startEmailArm,
  memo:  runMemoArm,
} satisfies Record<ActionType, Arm>;
```

### Pattern 5: An action that mints its own turnId so the trace works off the loop's caller

```ts
// Source: packages/backend/convex/evaluations.ts:174-183
const turnId = crypto.randomUUID();
await ctx.runMutation(internal.agentSteps.record, {
  tenantId, threadId, turnId, stepKey: "evaluateBusiness",
  tool: "evaluateBusiness", startedAt,
});
// … and a matching agentSteps.finish in a `finally` — a started step must always end.
```

The `finally` is not optional. `cockpit.ts:140-152` spells out why: it is the only construct that
terminalizes on success, on a caught throw, AND on a governed stop that returns as data.

### Anti-Patterns to Avoid

- **Nesting `generateText` inside a tool `execute`.** SC #2 forbids it, and it would double-bill the
  window while making `stepCountIs(8)` meaningless. Dispatch is a *sequential* second `runAgentLoop` call.
- **Forking `runAgentLoop`.** A `runSpecialistLoop` copy loses timeouts, fallback, spend recording and
  the trace emitters — and immediately drifts.
- **Giving the specialist any write tool.** `proposePlan`, `patchPlan`-backed tools, `recordScorecardAnswer`,
  `replyToMessage` are all out. The specialist returns findings; the executive stages the write.
- **Widening `agentSteps` with a text-bearing field.** §4 on that path is enforced by the schema's
  *absence* of anywhere to put text.
- **Routing memo (or any future inline arm) through `deliverApprovedPlan`.** 12-05 bought structural
  unreachability of the gmail fan-out by leaving that file byte-unchanged; re-exposing it is a
  security regression dressed as a refactor.
- **Dead-lettering a refusal.** *"The cockpit has never DLQ'd a user-facing turn."*
- **A second log plane.** No `subAgentLog` table alongside the insert-only audit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bounding the specialist's loop | a step counter / while-loop | `stopWhen: stepCountIs(8)` already inside `runAgentLoop` | free, tested, and `ai@7`'s renamed `maxSteps` — chasing the old name would violate §6 |
| Timing out a specialist | a `Promise.race` timeout | `AbortSignal.timeout(CALL_TIMEOUT_MS)` (`llm.ts:1691`) | already wired to `isTimeoutError` → `ConvexError({kind:"agent_timeout"})` → the AGNT-04 notification |
| Retrying a failed specialist call | bespoke retry | the loop's `isFallbackEligible` → CHEAP_MODEL retry (`llm.ts:1741-1756`) | one accumulator already spans both attempts |
| Reading remaining daily budget | scanning `audit`/`telemetry` and summing | `rateLimiter.getValue(ctx, "dailySpendCents").value` | O(1), reads the *actual* rail the kill switch uses; a sum would drift from it |
| Pricing a specialist's tokens | new pricing table | `priceUsage` inside `recordModelSpend` (`llm.ts:1618-1627`) | already returns the priced USD for the caller |
| Restricting the tool-set | a permission system | filter the record `buildCockpitTools` returns (or `activeTools`) | the tool record IS the capability grant |
| Loading a specialist prompt | a constant in source | `internal.skills.getActiveSkill` / `getSkillVersion` | §5, and it fails closed on an unseeded skill |
| Progress indication during dispatch | a spinner / polling / a card pending state | one `agentSteps` row + the existing `latestTurn` subscription | `ctx.runMutation` commits mid-action and pushes to live subscribers — *"that non-transactionality is the entire feature"* (`llm.ts:1699-1702`) |
| Reconstructing the call tree | a new lineage table | `audit.by_correlation(rootRequestId)` | index exists; payload already permits ids |
| Proving "adding an arm needs no spine edit" | an elaborate integration test | `satisfies Record<ActionType, Arm>` | a compile error is a stronger guarantee than a test |
| Driving the loop offline in tests | a fake `generateText` | `__runCockpitAgentWithScript` + `MockLanguageModelV4` | drives the REAL `runAgentLoop`, so the test can actually catch a regression in it |

**Key insight:** this phase's whole value is that it *doesn't* build a second mechanism. Every hand-rolled
alternative above is a second governance seam, and a second seam is precisely what DISP-01/ACTN-01 exist to
prevent ("all breadth of action rides a single governed seam instead of re-forking the loop or the executor").

## Common Pitfalls

### Pitfall 1: `gap.route` is a `string`, so the "closed enum" SC #1 relies on does not exist yet
**What goes wrong:** the plan assumes `resolveSpecialist` can be compile-time-only, ships without a runtime
fail-closed branch, and a persisted `evaluations` row — including the deliberate `route: ""` on the
not-enough-data ask (`diagnose.ts:84-85`) — silently reaches dispatch.
**Why:** `Prescription.route: string` (`diagnose.ts:16`), `gaps[].route: v.string()` (`schema.ts:350`).
**Avoid:** close the union in `@pikar/core` **and** keep the runtime lookup returning
`{ ok:false, reason:"unknown_route" }` for anything not in `SPECIALIST_ROUTES`, including `""`.
**Warning sign:** a plan task that says "narrow the type" with no companion runtime test asserting an
unknown/empty route refuses conversationally.

### Pitfall 2: A Convex mutation cannot call an action — and the Approve race it creates
**What goes wrong:** `actOnGap` is a `tenantMutation` (`evaluations.ts:582`) and today it stages a
`status: "proposed"` memo synchronously (`:618-625`). Dispatch is an action. If the plan is staged
`proposed` **before** the specialist returns, the user can hit Approve on the template body and get the
old 12-05 behaviour with a specialist attribution header lying above it — at the exact surface where the
human gives irreversible consent.
**Why:** actions can't run in a mutation; the specialist takes 10-30s.
**Avoid:** stage as `"collecting"` (not approvable — `executePlan:509` refuses anything but `"proposed"`),
`ctx.scheduler.runAfter(0, internal.dispatch.runSpecialist, {...})`, and flip to `"proposed"` **only** when
the specialist body lands. Failure/refusal path falls back to `buildMemo(row, gap)` (`evaluations.ts:547`)
so the control never dead-ends. Remember `plans.byThread` is `.unique()` — recycle the row, never insert a
second (12-05).
**Warning sign:** any task that keeps `status: "proposed"` in `actOnGap` while adding dispatch.

### Pitfall 3: A missing `agentSteps.tool` literal fails SILENTLY in production
**What goes wrong:** the dispatch step is emitted before the schema literal exists → the insert throws →
**the SDK swallows callback exceptions** → no trace in prod while every test passes.
**Why:** documented twice, at `schema.ts:422-429` and `agentSteps.ts` header.
**Avoid:** land the literal(s) in the **Wave-0 freeze commit**, before any lane emits. Add the matching
`VERB` entries in `cards.tsx:1104` in the same pass (and fix the missing `evaluateBusiness` entry).
**Warning sign:** a green test suite with a blank activity card.

### Pitfall 4: Convex generated-API circular type inference collapses `apps/web` to `any`
**What goes wrong:** a new action/mutation with an inferred return type collapses the whole generated API
to `any`/`{}`. STATE.md 13-01 records the exact damage: **90 errors in `apps/web`**.
**Avoid:** an **explicit return type annotation on every new handler**, and a *named* exported type for any
non-trivial return (`EvaluationDelta` is the precedent). `llm.ts:1641` and `agentSteps.ts` both carry the
"Explicit return type keeps this out of the `internal`-graph circular inference (§96)" comment.
**Warning sign:** `pnpm --filter @pikar/web typecheck` explodes after a backend-only change.

### Pitfall 5: `seedSkills` version collisions across lanes / deployments
**What goes wrong:** `seedSkills` writes `maxVersion + 1`, and optimizer dry-run candidates already occupy
versions, so a plan's pinned version number can be wrong against the live DB — and two lanes seeding
concurrently cross versions **silently**.
**Avoid:** `convex/skills.ts` seeding is **Lane A only** this phase (PARALLELIZATION singleton #8).
**Verify which version carries your body before any eval pin or activate.**

### Pitfall 6: The GATED-skill bootstrap makes a fresh lane deployment lie to you
**What goes wrong:** a gated skill's **first** seed lands v1 **ACTIVE** via the `rows.length === 0`
bootstrap path (STATE.md 12-06). On a fresh lane deployment the three specialists bootstrap active and the
gate appears not to apply; on the owner's deployment they are already v1-active, so a body rewrite publishes
a **CANDIDATE** needing recorded eval evidence.
**Avoid:** never conclude gate behaviour from a lane deployment. `activateSkillVersion` (`skills.ts:~95-120`)
throws unless `hasPassingEvidence(target.evidence, name, version)`.
**Warning sign:** "the eval gate didn't fire, so we're fine."

### Pitfall 7: `run-eval-golden.mjs` cannot pin these skills at all today
**What goes wrong:** `--skill` is validated against a hardcoded `SKILL_NAMES = ["cockpit-agent","document-drafter","inbox-digest"]`
(`run-eval-golden.mjs:39`, thrown at `:119-120`) — which excludes `reply-drafter` **and all seven Phase-12
skills**, including the three specialists. It is also **single-pin**: `argv.indexOf("--skill")` → one
`parseSkillPin` (`:537-538`), threaded as `skillVersions: { [pin.name]: pin.version }` at `:376` and `:519`.
**Avoid:** treat "extend `--skill` to multi-pin" as real work at `:113-120`, `:376`, `:519`, `:537-538`, with
`SKILL_NAMES` derived from `GATED_SKILLS` rather than re-listed. Keep the `--self-check` assertions at
`:335-343` passing.

### Pitfall 8: `getValue().value` goes negative, and `preCall` doesn't mean "enough"
**What goes wrong:** `recordSpend` uses `reserve: true` *"so the window goes negative rather than
under-counting"* (`guardrails.ts:162-165`) — an unclamped envelope becomes negative and refuses everything.
Separately, `preCall` checks `{ count: 1 }` (`:156`): it answers "is there any budget left", not "is there
enough for this call".
**Avoid:** `Math.max(0, value)`; enforce the envelope in the dispatcher, not by leaning on `preCall`.

### Pitfall 9: `patchPlan` cannot clear a slot
**What goes wrong:** `patchPlan` explicitly drops `undefined` keys (`plans.ts:~103`), so it can never clear a
filled slot — a half-composed email's recipients/attachments survive onto a memo.
**Avoid:** `internal.plans.resetPlan` to clear (it also clears `kind`), `patchPlan` to fill. This is already
encoded at `evaluations.ts:609-611`.

### Pitfall 10: `evaluateBusiness` is a WRITE, despite the "read-only" framing
**What goes wrong:** handing the specialist `evaluateBusiness` as an "evaluation read" makes a supposedly
read-only sub-agent insert a new `evaluations` row and an audit row per call, and re-enters `runEvaluation`
mid-dispatch.
**Avoid:** give the specialist `["searchVault"]` only; inject the already-persisted evaluation snapshot
(via `internal.evaluations.lastForThread`, `evaluations.ts:124`) into the dispatch `prompt`.

### Pitfall 11: The `dailySpendCents` window is global, not per tenant
**What goes wrong:** the plan claims a per-tenant envelope that the rail cannot provide (`guardrails.ts:27`
is keyless).
**Avoid:** word it as the deployment's remaining budget with a `ponytail:` marker naming the per-tenant
upgrade path — the file already carries exactly that comment at `:19-20`.

### Pitfall 12: Synthetic driver text vs. §5
**What goes wrong:** someone reads §5 as forbidding the dispatch instruction string and tries to put it in
the `skills` table, or hardcodes it and trips the §5 scan.
**Avoid:** the sanctioned precedent is `RESOLUTION_CONTINUE` (`cockpit.ts:169-172`) — *"Driver-plane
synthetic string, not a skill (no §5 issue)"*. The same applies to `buildMemo` (*"a document the user reads,
NOT an agent prompt"*, `evaluations.ts:541-546`). The SPECIALIST BODY must come from the registry; the
scaffolding around it need not.

## Code Examples

### Reading the remaining daily budget (the Wave-0 addition)
```ts
// Source: verified against @convex-dev/rate-limiter@0.3.2 installed source —
//   src/client/index.ts:179-209  (getValue takes a RunQueryCtx, consumes nothing)
//   src/shared.ts:124-131        (getValueReturns = { value, ts, shard, config })
// packages/backend/convex/guardrails.ts  [Wave 0 — the file is FROZEN afterwards]
export const remainingDailyCents = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> =>
    Math.max(0, (await rateLimiter.getValue(ctx, "dailySpendCents")).value),
});
```

### Parameterizing the tool-set (the ONE `llm.ts` seam change)
```ts
// packages/backend/convex/llm.ts:1677 — append-only optional arg, absent ⇒ today's behaviour.
const built = buildCockpitTools(ctx, tenantId, planId, undefined, skillVersions, omitRecipientEdits);
const tools = toolNames
  ? Object.fromEntries(Object.entries(built).filter(([name]) => toolNames.includes(name)))
  : built;
// ponytail: ceiling is a filtered record; ai@7 also has `activeTools` (one line), but the tool's
// `execute` closure would still exist in the record and stay reachable via invokeTool. Structural
// absence is the omitRecipientEdits precedent (llm.ts:619-626).
```

### Fail-closed specialist resolution (the SC #1 shape, mirroring `parseRouting`)
```ts
// packages/core/src/specialists.ts — pure TS, Convex-free (CLAUDE.md §1)
export function resolveSpecialist(route: string):
  | { ok: true; route: SpecialistRoute; spec: SpecialistSpec }
  | { ok: false; reason: "unknown_route" } {
  const spec = (SPECIALISTS as Record<string, SpecialistSpec | undefined>)[route];
  return spec ? { ok: true, route: route as SpecialistRoute, spec } : { ok: false, reason: "unknown_route" };
}
// There is deliberately NO default specialist — "a route the system cannot validate is a route it
// must not take" (packages/contracts/src/routing.ts).
```

### Refs-only lineage audit (no schema change needed)
```ts
// Source pattern: packages/backend/convex/llm.ts:1336-1342 (searchVault's refs-only audit)
await ctx.runMutation(internal.audit.log, {
  tenantId,
  correlationId: rootRequestId,       // audit.by_correlation reconstructs the call tree
  eventType: "subagent.dispatched",
  actor: "system",
  payload: { rootRequestId, parentAgentId, specialist: route, depth,
             planId: String(planId), skillVersion, costUsd },  // ids + counts ONLY (§4)
});
```

### The exhaustive arm table (SC #4)
```ts
// packages/core/src/actionType.ts
export type ActionType = "email" | "memo";
export const actionTypeOf = (kind: "memo" | undefined): ActionType => kind ?? "email";
export const armFor = (t: ActionType): "workflow" | "inline" => (t === "email" ? "workflow" : "inline");

// packages/backend/convex/cockpit.ts — replaces the `if (plan.kind === "memo")` branch at :521
switch (actionTypeOf(plan.kind)) {
  case "memo":  { await ctx.db.patch(planId, { status: "done" });
                  await persistNextStepMemo(ctx, plan); return { ok: true }; }
  case "email": break;  // falls through to the existing pre-check → seed → startFanout block
  default:      { const _never: never = actionTypeOf(plan.kind); throw new Error(`unreachable: ${_never}`); }
}
```

### Two-tenant isolation (copy this shape)
```ts
// Source: packages/backend/convex/evaluations.test.ts:205-226
expect(await t.withIdentity({ subject: "tenant_a" })
  .query(api.plans.byThread, { threadId: THREAD })).not.toBeNull();
expect(await t.withIdentity({ subject: "tenant_b" })
  .query(api.plans.byThread, { threadId: THREAD })).toBeNull();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `maxSteps` on `generateText` | `stopWhen: stepCountIs(n)` | `ai` v5+ | Already correct at `llm.ts:1690`; `llm.ts:1585-1586` warns explicitly not to bump the pinned component chasing the old name (§6) |
| Manual per-tool step emission | native `onToolExecutionStart` / `onToolExecutionEnd` | `ai@7` | *"not one of the 14 tool wrappers is edited"* (`llm.ts:1693-1697`); both callbacks are **awaited** by the SDK, so the `running` row commits before the slow tool starts |
| `plans.kind === "memo"` `if`-branch | closed `ActionType` union + exhaustive arm table | **this phase** | Adding an arm becomes a compile error, not a code-review hope |
| `gap.route: string` | closed `SpecialistRoute` union + fail-closed lookup | **this phase** | SC #1 becomes structural |
| write-only `dailySpendCents` rail | `getValue`-backed readable remaining | **this phase (Wave 0)** | Enables a derived envelope instead of a magic constant |

**Deprecated/outdated:**
- `pipeline.ts:215`'s `sub_agent` branch — the v1 request pipeline's hollow route. **Out of scope**
  (CONTEXT defers free-text `sub_agent` to Phase 16). Do not "fix" it here.
- `buildMemo`'s "That specialist does not execute yet — approving this memo SAVES it" copy
  (`evaluations.ts:563-565`) becomes **false** for dispatched gaps. It must stay as the refusal/fallback
  body but its wording needs branching, or an approved fallback memo tells the user something untrue.

## Open Questions

1. **Does `actOnGap` become a `tenantAction`, or stay a mutation + `scheduler.runAfter`?**
   - Known: mutations cannot call actions; the specialist takes 10-30s; `executePlan` only approves
     `status === "proposed"`; CKPT-05 gives live progress for free from a scheduled action.
   - Unclear: whether the "collecting → proposed on completion" flip reads well in the UI, since
     `PlanCard`'s memo variant currently renders on a `proposed` row.
   - Recommendation: **scheduled action + `collecting` staging**, with the plan's Dimension-8 verification
     explicitly asserting *"a dispatched gap's plan row is NOT approvable until the specialist body lands"*.
     Falling back to `buildMemo` on refusal/failure keeps the control from dead-ending.

2. **Where does the "incomplete — cost ceiling reached" marker live?** (CONTEXT: Claude's discretion.)
   - Known: `plans` has no status for it, and adding one touches the PINNED status enum (`schema.ts:155-164`)
     — a Wave-0 schema change with UI blast radius.
   - Recommendation: **in the body**, as a leading line the memo template owns. It is a document the user
     reads (§5 doesn't apply), it needs zero schema change, and it is visible at the Approve gate — which is
     exactly where CONTEXT wants the human to decide.

3. **Do the three specialist bodies need a `searchVault`-shaped grounding instruction to produce grounded
   output, and does that push them past the eval gate's cost?**
   - Known: the bodies today end with *"Cite the user's own material for every claim"* but the specialist
     has never had a retrieval tool. Three new golden fixtures at roughly the 27-case run's per-case cost
     (the last full run was **$0.1686 for 27 cases**, run `ed251c29`).
   - Recommendation: budget the gate as one run; if it doesn't go green in-phase, **ship dark** per CONTEXT.

4. **Is a `rootRequestId` needed at all when `planId` already correlates a dispatch?**
   - Known: SC #3 names `rootRequestId` explicitly; `plans.correlationId` is only set at `executePlan`
     (`schema.ts:251`), i.e. *after* Approve — so it does not exist at dispatch time.
   - Recommendation: mint `rootRequestId = crypto.randomUUID()` at the dispatch entry point and use it as
     the audit `correlationId`. Do not overload `planId` — a plan row is recycled per thread (12-05), so it
     is not a stable per-run identity.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^3.2.7` + `convex-test@0.0.54`, `edge-runtime` environment |
| Config file | `packages/backend/vitest.config.mts` (include `convex/**/*.test.ts`); `packages/core/vitest.config.ts` for pure-TS |
| Quick run (backend, one file) | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` |
| Quick run (core, one file) | `pnpm --filter @pikar/core exec vitest run src/actionType.test.ts` |
| Full suite | `pnpm test` (turbo: core + contracts + backend + web typecheck) |
| Types | `pnpm typecheck` — **must also pass for `apps/web`** (Pitfall 4) |
| Playbook gate | `node scripts/check-playbooks.mjs check` — exit 0 |
| Known pre-existing red | `convex/audit.test.ts` (`auditCounts` unregistered) — documented since Phase 2, **not** a regression |

### Phase Requirements → Test Map

| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|--------------|
| SC #1 / DISP-01 | A named specialist runs in the SAME loop with a swapped `(system, tools)` — the specialist's skill body is the system prompt and only its allow-listed tools are present | integration (convex-test, mock model) | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ Wave 0 |
| SC #1 | An unknown / empty specialist route fails closed to `unknown_route` and returns a conversational refusal — **no** `deadLetters` row | unit (core) + integration | `pnpm --filter @pikar/core exec vitest run src/specialists.test.ts` · `… vitest run convex/dispatch.test.ts` | ❌ Wave 0 |
| SC #2 | Hard depth cap: a specialist attempting to dispatch is refused at `depth > 1` | integration | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ Wave 0 |
| SC #2 | Cycle refusal: `ancestry` containing the target route is rejected (A→B→A) | unit (pure predicate) + integration | `pnpm --filter @pikar/core exec vitest run src/specialists.test.ts` | ❌ Wave 0 |
| SC #2 | Shared envelope: mid-tree exhaustion stops, keeps partial output, labels it incomplete; the envelope is drawn down across hops | integration (mock model with scripted `usage`, `rateLimiter` component registered) | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ Wave 0 |
| SC #2 | **No nested `generateText`** | static source scan (the `llmRedaction.test.ts` / `auditImmutability.test.ts` idiom) | `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts` | ❌ Wave 0 |
| SC #3 | Every sub-agent audit row carries `rootRequestId` + `parentAgentId`; the call tree reconstructs from `by_correlation`; cost sums to the root | integration | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ Wave 0 |
| SC #3 | Lineage payload is refs/ids/counts ONLY — no specialist output text in any audit/step row | static scan + assertion over written rows | `pnpm --filter @pikar/backend exec vitest run convex/llmRedaction.test.ts` | ✅ extend |
| SC #4 / ACTN-01 | `executePlan` dispatches by action type; the memo arm persists a vault doc and seeds **zero** `requests` rows | integration | `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` | ✅ extend (`:157` already asserts zero-requests) |
| SC #4 | Adding an arm needs ZERO spine edits | **compile-time** (`satisfies Record<ActionType, Arm>`) + unit on `armFor` | `pnpm typecheck` · `pnpm --filter @pikar/core exec vitest run src/actionType.test.ts` | ❌ Wave 0 |
| SC #4 | The Approve gate stays a `tenantMutation`, never a tool | static source scan (`executePlan` absent from `buildCockpitTools` keys) | `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts` | ❌ Wave 0 |
| SC #4 | `deliverApprovedPlan.ts` byte-unchanged (gmail fan-out structurally unreachable from a non-email arm) | integration (zero `requests` rows) + `git diff --exit-code` in the plan's verification | `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` | ✅ extend |
| SC #5 / BETA-05 | A sub-agent run keyed on `rootRequestId` is still tenant-scoped (two-tenant assertion) | isolation assertion | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ Wave 0 |
| DISP-01 (live) | Three golden fixtures: gap → tap → dispatch → staged specialist output | **manual/paid** — `EVAL_GATE`, one run, all three pinned | `pnpm eval:golden --skill offer-architect@N --skill money-model-designer@N --skill lead-engine@N` | ❌ requires multi-pin work |
| §9 | Playbooks updated in-phase | hook | `node scripts/check-playbooks.mjs check` | ✅ |

**Manual-only justification:** the golden fixtures are the ONLY paid, model-behaviour-dependent signal, and
CONTEXT explicitly reserves them for the happy path. Every refusal (unknown specialist, depth breach, cycle,
drained envelope) is asserted offline with `MockLanguageModelV4` at zero cost. Adversarial paid fixtures are
deferred.

### Sampling Rate

- **Per task commit:** the touched file's suite — e.g.
  `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` (< 30s) — plus
  `pnpm --filter @pikar/backend exec tsc --noEmit`.
- **Per wave merge:** `pnpm test` + `pnpm typecheck` (**including `apps/web`** — Pitfall 4) +
  `node scripts/check-playbooks.mjs check`. This is exactly PARALLELIZATION Stage 3's automated merge gate.
- **Phase gate:** full suite green (≈495 backend, sole red the documented `audit.test.ts` row) +
  `pnpm eval:golden` all-green with the three specialist pins, before `/gsd:verify-work`.
  If the eval gate does not go green in-phase: **ship dark** (CONTEXT) — the framework still lands and is
  still fully tested; candidates park.
- **Owner live human-verify:** ONCE, on integrated `main`, covering Phases 14 + 15 together (PARALLELIZATION
  Stage 3). Not a per-lane gate.

### Wave 0 Gaps

- [ ] `convex/schema.ts` — dispatch literal(s) on the closed `agentSteps.tool` union (Pitfall 3 makes this
      **mandatory before any lane emits a step**)
- [ ] `convex/guardrails.ts` — `remainingDailyCents` internalQuery, then the file is FROZEN
- [ ] `docs/playbooks/watch.json` — register `packages/core/src/specialists.ts`,
      `packages/core/src/actionType.ts`, `packages/backend/convex/dispatch.ts` (+ their test files' dir),
      or the Stop hook blocks every lane
- [ ] `packages/backend/convex/dispatch.ts` — empty stub file (lane-owned afterwards)
- [ ] `packages/core/src/specialists.ts` — stub with `SPECIALIST_ROUTES` + `resolveSpecialist` failing
      closed with **no specialists registered yet** (PARALLELIZATION Stage 1 explicitly asks for this)
- [ ] `packages/core/src/actionType.ts` — stub with the two-arm union and a no-op passthrough switch
- [ ] `apps/web/.../workspace/cards.tsx` VERB map — dispatch entries + the missing `evaluateBusiness` entry.
      **PARALLELIZATION Stage 2's Phase-15 lane table has no web column — Stage 1 must assign one.**
- [ ] `convex/dispatch.test.ts`, `convex/dispatchGuard.test.ts`, `packages/core/src/specialists.test.ts`,
      `packages/core/src/actionType.test.ts` — new files (test files are exempt from the coverage hook but
      not from the `stale` check if under a watched prefix)
- [ ] No framework install needed — vitest + convex-test are present.

## Sources

### Primary (HIGH confidence — first-hand reads at the paths/line numbers cited)
- `packages/backend/convex/llm.ts` — `runAgentLoop` :1642-1757, `buildCockpitTools` :607-1577,
  `runCockpitAgent` :1925-2078, `__runCockpitAgentWithScript` :2116-2166, `PAUSED_REPLY` :1588,
  `recordModelSpend` :1618, `invokeTool` :1602, tool keys :731-1575
- `packages/backend/convex/cockpit.ts` — `executePlan` :496-625, `startFanout` :452-462,
  `sendCockpitMessage` :72-162, `RESOLUTION_CONTINUE` :169
- `packages/backend/convex/deliverApprovedPlan.ts` — full file (69 lines)
- `packages/backend/convex/guardrails.ts` — full file (`DAILY_BUDGET_CENTS` :21, limiter :23-28,
  `prepare` :62, `preCall` :149, `recordSpend` :166)
- `packages/backend/convex/schema.ts` — `audit` :15-28, `skills` :47-61, `plans` :152-254,
  `evaluations` :324-381, `agentSteps` :394-451, `telemetry` :493-509
- `packages/backend/convex/evaluations.ts` — `lastForThread` :124, `runEvaluation` :157,
  `buildMemo` :547, `actOnGap` :582-628, `persistNextStepMemo` :639-663
- `packages/backend/convex/audit.ts` :1-48 · `agentSteps.ts` (full) · `plans.ts` :76-114 ·
  `skills.ts` :67-120 · `pipeline.ts` :198-236 · `lib/functions.ts` (full)
- `packages/contracts/src/routing.ts` (full) · `packages/contracts/src/audit.ts` (full) ·
  `packages/contracts/src/skill.ts` `GATED_SKILLS` · `packages/contracts/skills/offer-architect.md`
- `packages/core/src/growth/diagnose.ts` :1-50, route literals :41-165 · `packages/cost/src/cost.ts` :39-44
- `packages/backend/convex/evaluations.test.ts` :205-226 (the isolation precedent) ·
  `gapAction.test.ts` :1-80,:157 · `runCockpitAgent.test.ts` :1-70
- `packages/backend/scripts/run-eval-golden.mjs` :11,:38-39,:113-120,:335-343,:376,:507-519,:531-538
- `docs/playbooks/watch.json` (full) · `scripts/check-playbooks.mjs` (full) · `docs/playbooks/cockpit.md` (header)
- `packages/backend/vitest.config.mts` · `packages/backend/package.json` (pinned versions) · root `package.json`
- `.planning/PARALLELIZATION.md` (Phases 14+15 contract, singletons #8/#9/#10) · `.planning/STATE.md` ·
  `.planning/ROADMAP.md` :537-571 · `.planning/REQUIREMENTS.md` (DISP-01, ACTN-01, BETA-05)

### Primary (HIGH confidence — installed library source, exact pinned versions)
- `@convex-dev/rate-limiter@0.3.2` — `src/client/index.ts:150-209` (`reset`, `getValue`),
  `src/shared.ts:124-131` (`getValueReturns = { value, ts, shard, config }`),
  `src/shared.ts:137-151` (`calculateRateLimit`: `max = config.capacity ?? config.rate`)
- `ai@7.0.20` — `dist/index.d.ts:903` (`type ActiveTools<TOOLS> = ReadonlyArray<keyof TOOLS & string> | undefined`),
  `:4823` (`generateText` signature), `:4864-4868` (`activeTools` doc comment), `:4902` (`prepareStep`)

### Secondary (MEDIUM confidence)
- `.planning/phases/15-.../15-CONTEXT.md` code-context claims — all spot-verified against source; **one
  correction found** (the `gap.route` "closed enum" claim, see Pitfall 1) and **one refinement** (the daily
  budget is deployment-global, not per-tenant, see Pitfall 11).

### Tertiary (LOW confidence)
- None. No WebSearch was required — every question resolved against repo source or installed package source.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — nothing new; versions read from `packages/backend/package.json` and treated as
  §6-frozen.
- Architecture / seams: **HIGH** — every seam quoted with file:line from a direct read.
- Pitfalls: **HIGH** for 1-5, 7-10, 12 (all traceable to source or to a recorded STATE.md incident);
  **MEDIUM** for 6 and 11 (inferred from documented bootstrap behaviour + a keyless limiter config rather
  than observed on the live deployment).
- Validation architecture: **HIGH** for framework/commands; **MEDIUM** for the eval-gate cost estimate
  (extrapolated from the last recorded run: 27 cases / $0.1686 / run `ed251c29`).

**Research date:** 2026-07-25
**Valid until:** 2026-08-24 (30 days — the stack is version-pinned and internal; re-verify only if
`ai`, `convex`, or `@convex-dev/rate-limiter` are bumped, which §6 forbids without a changelog read)
