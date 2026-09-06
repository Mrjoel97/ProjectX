# Phase 41 — the plan-row ADR (G6 + G10 prerequisite) — RESEARCH

- **Measured**: 2026-09-06, tree `b82c345` (main, Phase 40 closed and deployed). Ten-agent pass: eight
  parallel measurement dimensions, one synthesizer that re-verified its own load-bearing claims, one
  adversary whose only job was to refute the result. The adversary refuted **seven** claims and found
  **six** things the synthesis missed; every one of those is folded in below and the four that change
  the recommendation were re-opened by hand (§0).
- **Trigger**: merged rev-5 audit §5 Track C step 11 — "durable runs + fan-out and batches under one
  plan-row ADR (G6, G10)". 39-RESEARCH §4: *"G10's `deliverables[]` and G6's fan-out children both need
  the parent/child (or batch-grouped rows) decision — **one ADR, written once, before either phase's
  code**, exactly as the 08-21 register said."*
- **Status**: research only — no code, no schema change. The deliverable of Phase 41 is **ADR-037**
  plus the owner answers it needs. G6 and G10 are separate multi-week phases that consume it.

---

## 0. What the adversary corrected

The synthesis was wrong or incomplete on these. They are listed first because three of them change the
shape of the decision, not merely its citations.

1. **A test pins the invariant, and the synthesis named no test at all.**
   `gapAction.test.ts:327` — `test("a second tap REUSES the one plan row, never inserts a second")`,
   asserting `expect(plans).toHaveLength(1)` at `:346`. Its comment (`:342-345`, read by hand) is the
   sharpest argument in the corpus *against* this ADR's direction: a duplicate row *"would make every
   later read of the thread THROW, **not merely show the wrong thing**."* A second rationale copy sits
   at `cockpitTools.test.ts:3039`. **`.unique()` is doing double duty — it enforces the invariant and it
   is the only structural detector this codebase has for a duplicate.**
2. **There is a NINTH constraint site the synthesis missed: `cockpit.resolveRecipients`.**
   Verified by hand at `cockpit.ts:474-500`: `const plan = await ctx.runQuery(api.plans.byThread, {threadId}); if (!plan) throw new Error("cockpit: plan row missing for thread");` then
   `patchPlan({ planId: plan._id, … })`. Same failure shape as `ensureThreadAndPlan`.
3. **"Everything that acts is already `planId`-addressed" is false — there is a counterexample on the
   very surface the recommendation says must be repaired.** Verified by hand at
   `ApprovalsView.tsx:1055`: `await answer({ threadId: item.threadId, answer: payload });`.
4. **A fan-out's children would surface as N independently approvable cards, and the synthesis
   presented that as a free benefit.** Verified by hand: `paginatePlans` (`approvals.ts:120-134`) pages
   **every** row at a given status off `by_tenant_status_createdAt` with no thread grouping, and
   `landSpecialistResult` flips `collecting → proposed` (`evaluations.ts:1099`), which is precisely what
   makes a row appear there. Five workers answering one question would produce five approval cards.
   **This is the product decision the ADR exists to make — see Q2.**
5. **Seven live frontend subscriptions, not nine.** `useQuery(api.plans.byThread, …)` at
   `ApprovalsView.tsx:746, 856, 975, 1333`, `cards.tsx:3219`, `ChatPane.tsx:128`, `MediaCanvas.tsx:2450`.
   The other two of the claimed nine were the *type aliases* (`ApprovalsView.tsx:26`, `cards.tsx:56`),
   double-counted. Add ~25 more consumers of the single-document contract in tests and e2e
   (`e2e/approvals.spec.ts:16, 243, 293`, `e2e/pipeline-uat.spec.ts:719, 788`, `gapAction.test.ts` ×10,
   `evaluations.test.ts` ×7, `calendar.test.ts:1055-1064`, `dispatch.test.ts:774-777`, `agenda.test.ts:85`,
   `proactiveReview.test.ts:182`).
6. **The `WorkflowManager`'s real parallelism was filed as unmeasurable and is not.**
   `@convex-dev/workflow@0.4.4/src/component/pool.ts:36` — `DEFAULT_MAX_PARALLELISM = 25`; `index.ts:8-13`
   constructs the shared manager with no `maxParallelism` override, so it runs at 25.
7. **`recordSpend` already accepts an optional `planId`** (`guardrails.ts:403`, spread as `...ref` at
   `:406`); `recordModelSpend` (`llm.ts:4633-4650`) simply never passes it, and zero call sites do.
   Per-child cost attribution is therefore **one argument threaded through one function**, not a schema
   change — which materially cheapens the money option in Q4.

Stale-comment corrections carried from the measurement pass, all re-verified:

- **The daily LLM rail is per-TENANT and the envelope is 25 % of `min(tenant, deployment)`.**
  `guardrails.ts:97-99` and `:453-463` (`Math.min` after clamping each at 0). The contradicting
  `ponytail:` note at `dispatch.ts:63-66` ("this is the DEPLOYMENT's remaining budget, not the
  tenant's") is **stale**, and its own cross-reference to `guardrails.ts:23-28` points at nothing.
  Do not repeat it in the ADR.
- **`ADR-014:59-60` cites a "one-reel-per-conversation ceiling in ADR-012" that does not exist** —
  `grep -ci conversation docs/decisions/012-*.md` → 0. A fabricated back-reference; do not chain to it.
- `pipeline.ts:31` says `requests.status` is a "13-member" union; it has **14** literals
  (`schema.ts:702-717`).
- Line drift in the first synthesis: the stale dispatch note is `63-66` not `62-66`; ADR-008's
  `planId` bullet is `49-52` not `50-53`; the tenant filter is `plans.ts:1127` not `1128`;
  `reschedulePlan` deletes orphan requests at `cockpit.ts:1512-1517`.

---

## 1. Scope

**Phase 41 decides** how a thread comes to hold more than one plan-shaped artifact — parent/child
`plans` rows, batch-grouped rows sharing a `batchId`, or an array field on the single row — and as
consequences: what `plans.byThread` returns, which of the nine one-row assumptions survive, where a
fan-out's money ceiling lives, and how a fan-out surfaces for approval.

**Phase 41 does not decide** the fan-out width or depth (G6 fixes ≤5 / depth 1; `MAX_DEPTH = 1` at
`dispatch.ts:58` today), the `deliverables[]` element shape or `publishAt` semantics (both greenfield —
`grep -rn -E "publishAt|deliverables"` over `packages/` + `apps/` returns **zero source files**),
whether dispatch becomes parallel or durable, or any change to the Approve gate itself
(`cockpit.ts:1005-1009` CAS).

---

## 2. Measured state

### 2a. The constraint surface — every site that assumes one plan row

`.unique()` **throws** on ≥2 matches (`convex@1.42.1/dist/cjs/server/impl/query_impl.js:260-267`).
Uniqueness is **convention, not constraint**: `by_thread` is an ordinary index (`schema.ts:1247`) and
`plans.insertPlan` (`plans.ts:102-117`) inserts unconditionally with no existence read. A second row is
physically insertable today; it fails on every subsequent **read**.

| # | site | what it is | at N ≥ 2 |
|---|---|---|---|
| C1 | `plans.ts:185` | `stageResearchPlan` `.unique()` | throws before it can recycle or refuse |
| C2 | `plans.ts:277` | `stageMediaPlan` `.unique()` | same |
| C3 | `plans.ts:554` | `stageImagePlan` `.unique()` | same |
| C4 | `plans.ts:621` | `refusalForThread` internalQuery | media retry prompt assembly throws |
| C5 | `plans.ts:1107` | `plans.byThread` public `tenantQuery` | **every workspace / canvas / approvals card throws** |
| C6 | `cockpit.ts:604` | `listThreadMessages` — the `.unique()` result **is** the tenant-ownership gate (`if (!owns) return {page: [], …}`, `:606`) | chat transcript outage |
| C7 | `evaluations.ts:936` | `applyActOnGap` | Act-on-gap + Monday review throw |
| C8 | `cockpit.ts:189-206` | `ensureThreadAndPlan` — inserts only when `threadId` is undefined, reads back via `byThread`, throws `"cockpit: plan row missing for thread"` | the writer that must learn which row is the root |
| C9 | `cockpit.ts:486-500` | `resolveRecipients` — same read-then-`patchPlan` shape (**adversary find**) | recipient picks throw |

Seven `.unique()` reads on `plans.by_thread` exactly: `plans.ts:185, 277, 554, 621, 1107`,
`cockpit.ts:604`, `evaluations.ts:936`. (The other ten `withIndex("by_thread")` hits in backend source
are on `briefings`, `calendarViews`, `vaultSources`, `knowledgeSearches`, `intakeArtifacts` — not
`plans`.)

### 2b. The readers

**Frontend — seven live subscriptions**, all typed as a single document: `ApprovalsView.tsx:746, 856,
975, 1333`; `cards.tsx:3219`; `ChatPane.tsx:128`; `MediaCanvas.tsx:2450`; plus the aliases
`ApprovalsView.tsx:26` and `cards.tsx:56`, both `NonNullable<FunctionReturnType<typeof api.plans.byThread>>`.

**The Approvals split is already latent-wrong.** The list emits `planId` per item
(`approvals.ts:72-82` `planRef`), the action mutations use `item.planId`
(`ApprovalsView.tsx:773, 801-802, 821, 867, 885`), but the **detail body is re-fetched by
`item.threadId`** at the four sites above — and one mutation, `answer`, is itself thread-addressed
(`ApprovalsView.tsx:1055`). Today `.unique()` converts the disagreement into a throw. Loosen it to
`.first()` and it becomes a **silent wrong-row approve on the money surface**.

**Already row-wise and N-safe:** `approvals.summary` (`approvals.ts:100-115`), `paginatePlans`
(`approvals.ts:120-134`), `blueprint.pulse` (`blueprint.ts:632-646`), `reliabilitySweep.sweepStuckPlans`
(`reliabilitySweep.ts:267`), `tenantDelete`/`tenantExport` (generic `by_tenant` walk,
`tenantDelete.ts:308-315`).

**Everything that *acts* is `planId`-addressed** — `plans.getById` (`plans.ts:1073`), the agent's
`readPlan` (`llm.ts:663-667`) with `planId` mandatory in `ToolContext` (`llm.ts:1876-1885`), 22
registered `media.ts` functions taking `planId: v.id("plans")`, `cockpit.executePlan` /
`discardPlan` / `cancelScheduledPlan` / `reschedulePlan`, `evaluations.landSpecialistResult`
(`evaluations.ts:1065-1101`) — **with the `answer` counterexample above.**

### 2c. The fan-out machinery today

- Three dispatch entry points, all `internalAction` in `dispatch.ts`: `runSpecialist:698`,
  `runResearch:1257`, `runMedia:1414`. All three roots schedule with `envelopeCents: 0, spentCents: 0`
  and a fresh `rootRequestId` (`evaluations.ts:991-1003`, `llm.ts:2003-2027`, `llm.ts:2069-2085`).
- **Workers per dispatch = 1.** `grep -c "Promise.all" dispatch.ts` → **0**. There is no fan-out on the
  specialist path today.
- `governedDispatch` gates in order (`dispatch.ts:457-481`): route resolve → `depth > MAX_DEPTH`
  (`MAX_DEPTH = 1`, `:58`) → `wouldCycle` → envelope → run.
- **Budget enforcement is a compare against a call argument, never shared state**: `dispatch.ts:481`
  `if (args.spentCents >= envelopeCents) return refuse("budget_exhausted", …)`, where `spentCents` is a
  validator arg (`:282`) and `envelopeCents` is derived only when zero (`:474-480`,
  `ENVELOPE_FRACTION = 0.25` at `:67`). **Five siblings handed the same `spentCents` all pass the same
  compare.** It is not racy in the read-modify-write sense — it is simply blind to siblings.
- **Liveness for a `collecting` row is `_scheduled_functions` matched on `args[0].planId`**
  (`reliabilitySweep.ts:250-257`) — it can answer "is ≥1 dispatch alive for this plan", never "how many".
- `agentSteps` is the only per-worker trace: `stepKey = \`dispatch:${rootRequestId}\`` (`dispatch.ts:497`)
  — **no worker index** — and `agentSteps.tool` is a closed literal union (`schema.ts:1548-1719`).
  Five same-route workers on one turn collide on both.
- The shared `WorkflowManager` runs at `DEFAULT_MAX_PARALLELISM = 25`
  (`@convex-dev/workflow@0.4.4/src/component/pool.ts:36`; `index.ts:8-13` overrides nothing).
- Action clocks: 45 s default, 90 s media, 180 s research. `deliverApprovedPlan.ts:31-40` is a bare
  sequential `for`.

### 2d. Money and provenance

- Daily rails: `DAILY_BUDGET_CENTS = 500` per tenant (`guardrails.ts:42`),
  `DEPLOYMENT_BUDGET_CENTS` default 5 000 (`:52`); `remainingDailyCents` returns
  `Math.min(tenant, deployment)` (`:453-463`). Media rails are separate ($10 tenant / $100 deployment,
  `guardrails.ts:62, 66-69`) and **there is no per-thread media ceiling anywhere**.
- `spendEvents.planId` exists (`schema.ts:2518`) but there is **no `by_plan` index** (`:2526-2529`), and
  `recordModelSpend` never passes it (see §0.7).
- The one concurrency-safe money pattern in the repo is **check-and-consume inside a single
  serializable mutation**: `reserveProviderLinesInner` (`media.ts:150-197`) and `reserveFolderInner`
  (`guardrails.ts:657-688`). `vaultFolders` has a refund path (`guardrails.ts:731-789`); media
  deliberately has none (`media.ts:162-163`).
- **Warning for the ADR:** `vaultFolders.spentCents` is declared (`schema.ts:2267`), inserted as `0` at
  four sites (`vaultFolders.ts:104, 128`, `vaultDrive.ts:895, 965`) and **patched nowhere**. A running
  total nobody updates reads green in every test. Do not declare a `spentCents` on a parent plan row
  unless code writes it.

---

## 3. Prior art in this codebase

**Parent/child chosen.** `mediaJobs` — `planId: v.id("plans")` **required**, `batchId: v.string()`,
`blockIndex: v.number()` ordering column, indexes `by_plan ["tenantId","planId"]` and
`by_batch ["tenantId","batchId"]` (`schema.ts:2556-2560, 2644-2646`). It is parent/child **and**
batch-grouped at once — the closest structural match in the tree. Its recorded reason
(`schema.ts:2634-2639`) is this ADR's argument in miniature: *"Deliberately PER JOB rather than per
plan — after D8 one plan can hold several successful images, and a per-plan pointer would make the
second one unsaveable."* Other child-row choices with recorded reasons: `contactProviderRefs` (*"an
array field on `contacts` cannot be indexed for it"*, `schema.ts:3188-3195`); `agenda` (lifecycle cannot
live on a weekly-rewritten row, ADR-033:24-28); `vaultDocuments.folderId` under `vaultFolders` with
counters (`schema.ts:2276-2286`).

**Array-on-row chosen.** `plans.shots`/`altShots`, justified at `schema.ts:1086-1090` by **two** clauses:
*"`plans.by_thread` is `.unique()`, so there is exactly one plan row per thread, **and** the canvas
editor's reorder / delete / edit is then ONE array patch instead of N row writes plus an ordering
column."* The first clause is the premise this ADR may delete; **the second survives intact**, and it
names exactly the cost a reorderable content queue would pay. `mediaJobs` pays it today with
`blockIndex`, and `media.ts:3716-3722` already records that join as fragile (*"the job's OWN blockIndex
is authoritative, never the array position… Upgrade path: a stable per-block id"*). The same block
records the refused anti-pattern (`schema.ts:1091-1096`): *"NO `decks[]` array with a `pickedIndex` the
money path reads."* `proposals.items[]` with `acceptedIndices` (`proposals.ts:57-64`) is the shipped
array-with-per-item-accept — **N units, one approval** — and it has no per-item status and no per-item
schedule.

**The repo's accumulated judgment, in one line:** an array is right for inert content edited as a unit;
a row is right the moment an item needs its own status, its own money, its own timer, or its own
foreign key.

**Migration mechanics.** 53 sites in `schema.ts` alone assert "no migration"; the move is always
*optional field, or new table, whose absence means today's behaviour*. A backfill has run twice — dev
(`02-01-SUMMARY.md:76`) and one named local deployment (`deferred-items.md:50-68`) — and **never against
`--prod`**. The one re-key precedent was resolved by owner-approved **discard**, not migration
(`c79e479`). All three candidate shapes below are additive-optional and need no backfill.

**Governance.** Next free ADR number is **037**. Structure to match ADR-034/035/036: `Status` /
`Supersedes` / `Does NOT supersede` / `Evidence`, then `## Context`, `## Options` (a
`| Option | Rejected because |` table), `## Decision` (numbered), `## Consequences` ending in
`- **What would supersede this**:`. Playbook owners from `watch.json`: `plans.ts`, `cockpit.ts`,
`dispatch.ts`, `workspace/` → **cockpit.md**; `approvals.ts` + `approvals/` → **dashboard-pages.md**;
`evaluations.ts` → **business-evaluation.md**; `MediaCanvas.tsx` → **media.md**; **`schema.ts` is
`_unassigned`** — a schema change alone trips no playbook obligation. Index constraint is
`isolation.test.ts:162-247`, not `schema.test.ts` (which pins the header's table count and names, not
indexes): any index on a `tenantId`-bearing table whose `fields[0] !== "tenantId"` must be registered
with a reason, so a `by_parent = ["tenantId","parentPlanId"]` passes untouched.

**ADRs that constrain this.** `grep` over `docs/decisions/` for the invariant returns only ADR-008.
The complete list: **ADR-008:49-52** (`planId` is not a per-run identity — the premise dies under child
rows), **ADR-033:62-64** (a `done` memo is recyclable — superseded only if the weekly review gains
children, Q3), **ADR-014:59-60** (one image per conversation — superseded only if media gains siblings,
Q1). No fourth ADR is implicated.

---

## 4. The three candidate shapes

### (a) Parent/child rows — `parentPlanId: v.optional(v.id("plans"))`

- **C1-C4, C7, C9:** each read must resolve *the root*. Recommended mechanism is `.collect()` over
  `by_thread` + `find(p => p.parentPlanId === undefined)` — no new index, deterministic, bounded. (The
  alternative, a `by_thread_root` index read with `.eq("parentPlanId", undefined)`, keeps `.unique()`
  verbatim but depends on how Convex indexes an absent optional field, for which the tree has **zero
  precedent** — see §6.)
- **C5 `plans.byThread`: the return type does not change.** The root is still one document. All seven
  subscriptions, both type aliases and ~25 test/e2e consumers compile untouched.
- **C6:** becomes existence-not-uniqueness (`.first()`). A child must never take the transcript down.
- **C8:** mints the root; unchanged otherwise.
- **This is where (a) wins outright.** A child is a real row with a real `_id`, so `mediaJobs.planId`,
  `calendarEvents.sourcePlanId` (required, `schema.ts:1806`), `vaultDocuments.reelMeta.planId`
  (required, `schema.ts:2019`), `requests.planId`, `workflowPackEvents.planId`, the three run columns
  and their three indexes (`schema.ts:1253-1264`), the three retrier terminals,
  `scheduledFunctionId` + `sendAt`, `renderStatus`/`renderStorageId`/`reelVaultDocId`, the delivery
  counters, `approvals.exactProgress` and the `_scheduled_functions` liveness probe **all work
  unchanged, per child, with no code change at all.**
- **Indexes:** +1 (`by_parent = ["tenantId","parentPlanId"]`). **Backfill:** none.
- **Failure modes:** (i) N children produce N approval cards unless something groups them — **the
  decision in Q2**; (ii) the `.unique()` throw stops being a duplicate detector (`gapAction.test.ts:342-345`),
  so the ApprovalsView `threadId`→`planId` repair must land in the same commit or a duplicate root
  becomes a silent wrong-row approve; (iii) no cascade exists anywhere in the repo (`resetPlan`,
  `plans.ts:951`, touches one row) — orphaned children are a decision, not a footnote; (iv)
  `sweepStuckPlans` (`reliabilitySweep.ts:267-285`, a `migrations.define` full-table walker) will
  *status*-sweep child rows without ever deleting them, and its `collectingPlane` predicate is exactly
  the shape a G6 worker row has.

### (b) Batch-grouped rows — `batchId: v.optional(v.string())`

- All nine constraint sites change, because there is no designated head row; `.unique()` disappears
  from the thread plane entirely.
- **C5 becomes a breaking public-contract change**: `byThread` returns an array — 7 subscriptions,
  2 aliases and ~25 test/e2e consumers change shape, `cards.tsx:3252`'s single `<PlanCards>` becomes a
  map, and `MediaCanvas.tsx:2462-2472`'s branch chain needs an item selector.
- With no head row, *nothing* answers "what does this thread's card show" — the workspace, the chat
  milestone chip, the canvas and the transcript auth gate each need a tie-breaker the schema does not
  supply, and a per-reader tie-breaker is how two readers drift onto different rows.
- **Not really an alternative to (a):** `mediaJobs` is (a)+(b) together one level down. Nothing stops
  (a) from gaining `batchId` later, when something actually asks "were these approved together".

### (c) Array field on the one row — `deliverables: v.optional(v.array({…}))`

- **C1-C9: nothing changes.** Zero read-plane diff, zero new indexes, and it is the repo's
  most-travelled move — `plans` already carries six optional arrays added exactly this way. Every
  user-facing refusal string survives verbatim.
- **The cost is that every per-row singleton needs an item discriminator**: `mediaJobs.planId` would
  need a `deliverableIndex` (the fragile `blockIndex`-into-array join `media.ts:3716-3722` already
  flags); `calendarEvents.sourcePlanId` and `vaultDocuments.reelMeta.planId` are **required**
  `v.id("plans")`, so two deliverables rendering into two vault docs both read the plan's single
  `reelVaultDocId` and one is reported `superseded` (`content.ts:160`) — `schema.ts:2634-2640`'s
  recorded failure repeated one level up; the three run columns exist *because* one column cannot carry
  two lifecycles; **G10's per-deliverable `publishAt` cannot reuse the shipped arming path at all**
  (`cockpit.ts:1329-1337` arms one timer per row) and needs N handles in the array with N cancels, or a
  new cron sweep; `landSpecialistResult` CASes on the row's `status`, so per-element status makes the
  row's own `status` meaningless to `approvals.ts:104/127/177`, `blueprint.ts:633-641` and
  `reliabilitySweep.ts:276-284`.
- **Cap enforcement:** `schema.ts:522-530` records the ceiling in the repo's own words — *"a Convex
  validator has no array-length bound and claiming one in a comment is the defect above."*
- **Where (c) genuinely wins:** one approval for N units is its native shape (`proposals.items[]` +
  `acceptedIndices`), reorder is one array patch rather than N row writes plus an ordering column, and
  it keeps every product ceiling intact.

---

## 5. Recommendation

**Parent/child rows in `plans` — one optional `parentPlanId`, one `by_parent` index — for G10, and for
G6 only if the owner wants per-worker approval (Q2).** The argument is not elegance; it is that (a) is
the only shape whose diff is confined to the plane it changes. Everything that *acts* on a plan is
already `planId`-addressed, so under (a) each of those keeps working on a child row with **no code
change**, while under (c) each needs an item discriminator invented, threaded and tested, and under (b)
the entire read plane changes for no capability (a) lacks. (a) is also the shape the repo has already
reached for twice under identical pressure and written down why (`schema.ts:2634-2639`, ADR-033:24-28).

**Keep `plans.byThread` returning the root**, resolved by `.collect()` + `find(root)` rather than by an
index on an absent field. That preserves the single-document public contract, all seven subscriptions,
both type aliases, ~25 test consumers and the chat-transcript auth gate, at the cost of a small
deterministic edit at nine sites.

**Three things must land in the same ADR or the shape is a liability:**

1. **The Approvals plane moves off `threadId`.** The list already emits `planId`
   (`approvals.ts:73`); the four detail reads (`ApprovalsView.tsx:746, 856, 975, 1333`) and the
   thread-addressed `answer` mutation (`:1055`) must take it. A list that mutates by `planId` and
   displays by `threadId` is a silent wrong-row approve the moment `.unique()` stops throwing — and
   `gapAction.test.ts:342-345` says in its own words that the throw is what makes duplicates loud. The
   honest version is a public `plans.byId` for the approvals plane, reserving `byThread` for the
   workspace, which makes the wrong-row class *unrepresentable* rather than merely unlikely. Note this
   spans two playbooks (`dashboard-pages.md` and `cockpit.md`) in one commit; say so out loud.
2. **A fan-out's money is settled at the fan-out site, not per worker.** Today's compare
   (`dispatch.ts:481`) is blind to siblings, so five children handed the same `spentCents` all pass.
3. **No `spentCents` column on the parent unless code patches it** — `vaultFolders.spentCents` is the
   cautionary precedent (§2d).

**One shape serves both consumers if Q2 says so:** a G6 worker is a `kind:"memo"` child in `collecting`
that `landSpecialistResult` flips to `proposed`; a G10 deliverable is a child with its own `sendAt`,
`scheduledFunctionId` and `canceled`/`cancelKind`, reusing the arming, cancelling and rescheduling code
that already exists per row (`cockpit.ts:1329-1337, 1362-1377, 1500-1517`) instead of writing a second
scheduler for array elements.

**A decision I am making rather than asking:** `rootRequestId` survives and is re-justified, not
superseded. ADR-008 minted it because `planId` collides on a recycled row (`ADR-008:49-52`,
`evaluations.ts:986-991`); child rows remove that specific reason, but `rootRequestId` identifies a
*run* while `planId` identifies an *artifact*, and a child row can be re-dispatched. ADR-037 should
record that ADR-008's premise changed and its decision stands. If the owner disagrees this becomes a
second ADR.

---

## 6. Owner questions

Recorded here; the answers are appended to this file before ADR-037 is written.

**Q1 — which plan kinds may have siblings?** All six, or only `memo` (specialist results) plus whatever
kind G10's deliverables take? The wide answer deletes ~7 user-facing refusal strings
(`llm.ts:1694-1706` "a second reel needs a new conversation", `llm.ts:1719-1720`, `cards.tsx:2860`) and
supersedes ADR-014:59-61; media exposure is then bounded only by the $10/tenant + $100/deployment daily
rails, because **no per-thread media ceiling exists anywhere**. The narrow answer keeps every media
refusal true, leaves ADR-014 untouched, keeps `stageMediaPlan`'s five-code interlock working verbatim,
and widening later is a one-predicate change.

**Q2 — does a five-worker fan-out produce five approval cards or one?** `paginatePlans`
(`approvals.ts:120-134`) pages every `proposed` row with no thread grouping, so under (a) five children
become five independently approvable cards by default. One approval for N units is exactly what
`proposals.items[]` + `acceptedIndices` already does with an array. This is the question that decides
whether G6 uses child rows at all.

**Q3 — does the weekly review stop recycling its one row?** `REVIEW_THREAD_ID = "proactive-review"`
(`packages/core/src/notificationTemplates.ts:49`) is a fixed string, so the review has **one plan row
for the tenant's entire lifetime**, and ADR-033 Decision 3 exists solely to stop that row being
`plan_busy` forever. Letting it insert children costs an **ADR-033 supersession**, a **rewrite of
`gapAction.test.ts:327-351`** (whose comment argues the invariant is what makes duplicate bugs loud),
and fixing `applyActOnGap`'s missing in-flight interlock (`evaluations.ts:941-945`, where
`stageResearchPlan:191-193` already has the equivalent).

**Q4 — how is a fan-out's budget bounded?** Divide the root envelope by the worker count at the fan-out
site (`dispatch.ts:474-476` already carries a non-zero incoming `envelopeCents` through unchanged, so
this needs **no change to `governedDispatch` at all**); or reserve up front in the minting mutation (the
`reserveProviderLinesInner` / `reserveFolderInner` shape — the only concurrency-safe pattern in the
repo, but it needs a refund-path decision); or leave it per-worker as today, where five siblings can
each spend 25 % of the remaining tenant rail. Per-child cost attribution is cheap either way:
`recordSpend` already takes an optional `planId` (`guardrails.ts:403`) and nothing passes it.

---

## 7. What was not measured

- **Whether a Convex index can be queried on an absent optional field (`.eq("parentPlanId", undefined)`).**
  Zero precedent in non-test backend source; the bundled `convex@1.42.1` types say nothing. Load-bearing
  only for the index variant of (a), which is why §5 recommends the `.collect()` + `find` mechanism.
  **Verify before writing the ADR if the index variant is preferred.**
- **Whether the production Convex backend throws the same `unique()` message** as the bundled JS
  implementation (`query_impl.js:260-267` read; production not exercised).
- **Runtime behaviour of a `useQuery` whose server query throws** — error boundary vs blank card.
  Source read; app not run (read-only research).
- **Production row counts for `plans`.** ADR-019:79 records 257 rows as of that phase; no `convex data`
  was run. Matters only for a *required* new field, which none of the options need.
- **Whether `calendarEvents.ts:451`'s cursor-paged `plans` walker needs a root filter.** Identified by
  the adversary as a second full-table walker; not opened.

---

## 8. Owner answers — 2026-09-06

**A1 = WIDE.** All six plan kinds may have more than one live plan row per thread, media and image
included. Chosen against this note's recommendation (§6 Q1 recommended the narrow version); the owner's
call stands and ADR-037 is written to it. Two consequences the narrow answer would not have carried:

- **ADR-014's one-image-per-conversation consequence is superseded** and ADR-037 must supersede it
  explicitly (CLAUDE.md §9 — ADRs are never edited).
- **A thread may now hold several ROOTS**, not merely a root plus children — a second reel is a new
  root. So `find(p => p.parentPlanId === undefined)` is ambiguous, and `plans.byThread` must mean **the
  newest root**. This is a mechanism change from §5, measured separately before the ADR was written.
- The daily $10/tenant + $100/deployment media rails (`guardrails.ts:62, 66-69`) become the ONLY bound
  on reels per thread; no per-thread media ceiling exists anywhere.

**A2 = ONE APPROVAL PER FAN-OUT.** N specialist workers are approved once, as a unit. Children must
therefore never reach `proposed`, which is the status `paginatePlans` (`approvals.ts:120-134`) renders.
`parentPlanId` present/absent is the discriminator for both A1 and A2: **no parent = a root, its own
artifact, its own approval; a parent = a fan-out child, no approval of its own.**

**A3 = YES.** The weekly review may insert children instead of recycling its one row. Costs, all
accepted: supersedes ADR-033 Decision 3, rewrites `gapAction.test.ts:327-351`, and requires fixing
`applyActOnGap`'s missing in-flight interlock (`evaluations.ts:941-945`, where `stageResearchPlan`
already has the equivalent at `plans.ts:191-193`).

**A4 = DIVIDE AT FAN-OUT.** The root envelope divided by the worker count, passed per child at the
fan-out site. `dispatch.ts:474-476` already carries a non-zero incoming `envelopeCents` through
unchanged, so `governedDispatch` needs no change; the ADR states it as a contract G6 cannot get wrong.
