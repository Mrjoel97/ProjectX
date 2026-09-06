# ADR-037: A thread holds many plan rows — a row with no parent is an artifact and an approval, a row with a parent is neither

- **Status**: **Accepted** — 2026-09-07. Phase 41 (the plan-row decision), merged-audit gaps **G6**
  (durable specialist runs + governed fan-out) and **G10** (batch content + the content queue).
- **Supersedes**: **ADR-033 Decision 3** and the clause *"the same `plans` row"* in its Decision 2;
  **ADR-014**'s Consequences bullet capping a conversation at one image attempt. Both are quoted and
  replaced below.
- **Does NOT supersede**: **ADR-008**. Its premise changes and its decision stands — see below, and
  do not read the premise change as the decision dying. Also untouched: **ADR-007** (a granted
  capability is TAUGHT in the registry, so the refusals the agent believes are a skill version, not
  a code edit), **ADR-012** (see the correction of record), and CLAUDE.md §3–§4.
- **Evidence**: `.planning/phases/41-plan-row-adr/41-RESEARCH.md` — measured 2026-09-06 at tree
  `b82c345` by ten agents (eight parallel measurements, one synthesizer, one adversary), then a
  second seven-agent pass over the consequences of the owner's answers, then a final adversarial
  citation audit whose corrections are carried here. The four owner answers of 2026-09-06 are
  recorded in that note's §8. Every `file:line` below was opened at `b82c345`.

## Context

One plan row per thread has been the shape since 12-05, and it is not a schema constraint — it is a
**read**. `plans.byThread` (`plans.ts:1102-1109`) is `.unique()` over `by_thread`
(`["tenantId","threadId"]`, `schema.ts:1247`), and `.unique()` **throws** on a second match rather
than returning the wrong row (`convex@1.42.1/dist/cjs/server/impl/query_impl.js:260-267`).
`plans.insertPlan` (`plans.ts:102-117`) inserts unconditionally with no existence read, so a second
row is physically insertable today and fails on every subsequent read. Nine sites read the thread
that way: `plans.ts:185, 277, 554, 621, 1107`; `cockpit.ts:203, 486, 604`; `evaluations.ts:936`.

**What the invariant costs today, measured.** `stageImagePlan` refuses on **any terminal image job
ever** (`plans.ts:568`, `image_already_started`), so a thread that has produced one image can never
propose another — while `media.generateImage` had already dropped `succeeded` from its own in-flight
set for exactly that reason (`media.ts:3325-3331`). `cockpit.ts:604` runs `.unique()` as a pure
authorization predicate inside a live React subscription (`const owns = …`, read only by
`if (!owns)` at `:606`), so the second a thread holds two rows the chat pane throws rather than
degrades. And the weekly review — a pinned, non-closable tab (`workspace/page.tsx:64`) whose composer
says *"Start a new chat to act on anything here"* (`:766-768`) — is the one thread on which the
standard escape hatch does not exist.

G6 needs up to five worker rows for one question; G10 needs 2–10 deliverable rows under one
approval. Neither can be built on a read that throws. Four things had to be decided together, because
each is only defensible in light of the others, and the owner answered all four on 2026-09-06:
which kinds may have siblings (**all six**), how many approvals a fan-out costs (**one**), whether
the review thread may insert (**yes**), and how a fan-out is budgeted (**divide at the fan-out**).

### The correction of record

ADR-014 justified its one-image ceiling as *"matching ADR-012's one-reel-per-conversation ceiling"*.
**ADR-012 contains no such ceiling and does not use the word "conversation" once** —
`grep -ic conversation docs/decisions/012-media-route-and-the-reel.md` → `0`, verified at `b82c345`.
The ceiling only ever existed as a consequence of `plans.byThread` being `.unique()`, and as prose at
`plans.ts:256`. This ADR therefore supersedes ADR-014's bullet **on its own terms** and does not
inherit the citation. ADR-012 needs no supersession: a claim *about* it is being retired, not a
decision *in* it.

## Options

| Option | Rejected because |
|---|---|
| **A `batchId` string, rows grouped but all equal** | A group id cannot answer the only question that matters — *does this row get its own approval card*. `paginatePlans` (`approvals.ts:120-135`) pages `by_tenant_status_createdAt` with **no predicate but status**, so a grouped row at `proposed` is in the inbox regardless of its group; the exclusion has to be a status rule anyway, and once it is, the group id carries nothing. With no designated head row, nothing answers "what does this thread's card show" either, and a tie-breaker chosen per-reader is how two readers drift onto different rows. |
| **An array field of children on the one row** | A child needs a document **id**. `mediaJobs.planId` (`schema.ts:2558`, required, `by_plan`), `calendarEvents.sourcePlanId` (`schema.ts:1806`, required), `vaultDocuments.reelMeta.planId` (`schema.ts:2019`, required), `requests.by_plan`, the three run columns with three dedicated indexes (`schema.ts:1253/1259/1264` — three columns *because* one cannot carry two lifecycles), and `sendAt` + `scheduledFunctionId` arming one timer per row (`cockpit.ts:1329-1337`) would each need an item discriminator invented and threaded. `schema.ts:2634-2639` already records this failure one level down: `mediaJobs.vaultDocId` is per job *"because a per-plan pointer would make the second one unsaveable"*. And `schema.ts:1091-1096` refuses precisely this shape by name — *"NO `decks[]` array with a `pickedIndex` the money path reads"*. |
| **A separate `planChildren` table** | Every consumer of a plan is typed `Doc<"plans">` and every actor is already `planId`-addressed; a second table doubles the read surface and buys nothing a nullable self-reference does not. `mediaJobs` is a separate table because its rows are *jobs*, not plans. |
| **Keep the invariant; one artifact per thread** | This is today, and it is what the owner overruled. It also leaves the weekly review — the one thread with no "start a new chat" — able to propose exactly once (ADR-033's own Context fact 3). |
| **Keep `.unique()` and add a `by_thread_root` index queried with `.eq("parentPlanId", undefined)`** | Whether a Convex index matches an absent optional field is **NOT MEASURED**: zero precedent in non-test backend source, and the bundled `convex@1.42.1` types say nothing. A green `convex-test` run would prove the harness, not the deployment. Decision 2's scan needs no such guarantee. |

## Decision

1. **The shape is parent/child rows on the one `plans` table.** Add
   `parentPlanId: v.optional(v.id("plans"))` and one index
   **`by_parent: ["tenantId", "parentPlanId"]`**. **A row with NO `parentPlanId` is a ROOT — its own
   artifact, its own approval. A row WITH one is a FAN-OUT CHILD — no approval of its own.** That
   single discriminator answers both of the owner's structural questions, and no second field is
   added to express either. The field is optional, so every existing row is a root: **no backfill**,
   the `requests.planId` / `vaultDocuments.folderId` precedent verbatim. The index leads with
   `tenantId` so `isolation.test.ts:162-247` needs no new exception (it already lists
   `plans.by_calendar_run`, `by_media_run`, `by_render_run` at `:170-176`). `schema.test.ts` pins the
   header's table count and names, not indexes, and `parentPlanId` is on none of its **20**
   `BANNED_FIELDS` (`schema.test.ts:118-139`), so neither schema tripwire is touched.

2. **"The plan for this thread" means the NEWEST ROOT, read by a bounded descending scan.**
   `plans.byThread` becomes `withIndex("by_thread", …).order("desc").take(ROOT_SCAN)` then the first
   row with no `parentPlanId`. No new index: Convex appends `_creationTime, _id` as the implicit tail
   of every index, so `by_thread` already *is* a descending-by-creation scan within a thread. This is
   a **shipped idiom in this repo**, not an invention — `smoke.ts:893-898` is
   `.order("desc").take(20).then(rows => rows.find(r => r.role === "created") ?? null)`, the same
   three moves. `ROOT_SCAN = 20` matches it.
   **The bound, and why exceeding it is safe.** Decision 6 requires a fan-out's children to be minted
   in one mutation after their root, so a descending scan meets a root after at most `C_max` rows —
   6 for a G6 fan-out (≤5 workers), 11 for a G10 batch (2–10). A window of 20 carries headroom. If
   the window ever contained no root, the read returns `null` and `cockpit.ts:204` throws
   `"cockpit: plan row missing for thread"` — **loudly, not silently**, which is the property being
   deliberately preserved (see Decision 8). `_creationTime` ordering within a single transaction is
   **NOT MEASURED**; the tie would break on `_id`, which is not creation-ordered, so "the newest of
   two same-transaction roots" is arbitrary. Root-finding survives either way, and Decision 3 makes
   two same-transaction roots unreachable.
   **The nine sites, each to what it actually needs.** Newest root: `plans.ts:185, 277, 554`
   (the three stagers), `plans.ts:621` (`refusalForThread`, `plans.ts:613-624`, whose `.unique()` at
   `:622` feeds the media brief's refusal clause and would otherwise throw the moment a thread holds
   two rows), `plans.ts:1107` (`byThread` itself), `cockpit.ts:203` (`ensureThreadAndPlan`),
   `cockpit.ts:486` (`resolveRecipients`), `evaluations.ts:936` (`applyActOnGap`). Existence only:
   `cockpit.ts:604`, which becomes `.first()` — an authorization predicate has no business throwing
   inside a live subscription.
   **`plans.byThread` stops being the way to address a KNOWN row.** A new public `plans.byId`
   `tenantQuery` carries that traffic; `plans.getById` (`plans.ts:1073-1076`) is an `internalQuery`
   with no tenant check and cannot be promoted as written.

3. **All six kinds may have sibling ROOTS — and this removes LIFETIME ceilings, not CONCURRENCY
   interlocks.** This is the distinction the whole decision turns on, and conflating the two is how
   an early draft of this ADR produced a design that could strand a user's work.
   - **What dies — a ceiling counting artifacts over the thread's lifetime.**
     `image_already_started` (`plans.ts:568`), which refuses on any terminal image job that has ever
     existed; the prose at `plans.ts:256` (*"A user who wants a second reel starts a new chat"*);
     `cards.tsx:2860` (*"This chat already has a plan in flight — start a new chat to act on this"*);
     and the corresponding bullets in the agent's registry body.
   - **What SURVIVES — an interlock serialising concurrent work.** `draft_in_progress`
     (`plans.ts:193`, `:335-336`, `:339-344`, `:570`, `:572`), `research_in_flight`
     (`plans.ts:190-192`), `dispatch_in_flight` (`plans.ts:301-302`), `reel_in_flight`
     (`:306-311`), `render_in_flight` (`:312-314`), `image_in_flight` (`:566`),
     `image_proposal_pending` (`:326-332`), and the *"do not ask again on this conversation"* clauses
     inside `MEDIA_UNDERWAY_REPLY` (`llm.ts:1623`) and `RESEARCH_UNDERWAY_REPLY` (`:1600-1602`).
     These govern what happens while a run is genuinely in flight. The owner widened arity; nothing
     in that answer reaches in-flight concurrency.
   - **THE INVARIANT THAT REPLACES `.unique()`: at most ONE root per thread is `collecting`.** A
     stager INSERTS a new root when no root is open, and REFUSES when one is — with the existing
     reason code, which now explains *why* the open root is open rather than asserting the thread is
     full. This is what makes Decision 2 correct rather than merely bounded: "the newest root" and
     "the draft the user is typing into" cannot diverge, because a second draft cannot be opened
     beside the first. Without it, staging a reel beside a half-composed email moves every
     subsequent tool write onto the media row and strands the email where no query can reach it.
   - **The registry half is a VERSION BUMP, not a code edit** (ADR-007). `cockpit-agent` is in
     `GATED_SKILLS` (`packages/contracts/src/skill.ts:353-354`), so editing the body publishes a
     candidate and `activateSkillVersion` throws `EVAL_GATE: … has no recorded passing eval run`
     without pinned evidence (`skills.ts:235-247`). **Read the live version back from
     `internal.skills.getActiveSkill` before the cycle** — the labels in source conflict
     (`cockpit-agent.md:1` says v3, `packages/contracts/src/skills/cockpitAgent.ts:7` says v2) and
     `skill-registry.md:1129-1132` states outright that a source label is not the registry version.
   - **`CRM_REFUSAL_REPLY.add_only` (`llm.ts:1760-1762`) is NOT in scope** and must not be deleted
     with its neighbour `draft_in_progress` (`:1756-1759`). It refuses *marking a follow-up done*,
     which has nothing to do with thread arity. Likewise `invalid_prompt` (`llm.ts:1729-1730`,
     `plans.ts:551`) is input validation at a trust boundary.

4. **One approval per fan-out: a CHILD never reaches `proposed`.** `proposed` is the inbox —
   `paginatePlans` (`approvals.ts:120-135`) pages every row at that status with no other predicate.
   A landed child takes **`approved`**, which is already a member of the pinned lifecycle enum
   (`schema.ts:768-776`, mirrored `plans.ts:22-30`), so **no literal is added** and `planKind`
   (`approvals.ts:38-51`) and the cards are untouched. Exactly two of the seven statuses are invisible
   to every approvals query — `collecting` and `approved` — and `collecting` is unavailable, because
   `reliabilitySweep`'s `collectingPlane` (`reliabilitySweep.ts:277-284`) and `stageResearchPlan`'s
   interlock (`plans.ts:190-192`) both read `collecting` + `kind: "memo"` as *"a dispatch still owns
   this row"*; parking a landed child there re-arms the watchdog against it. The cost is semantic
   drift from `schema.ts:772`'s comment (*"executePlan CAS passed"*), which widens in the same commit.
   `landSpecialistResult` (`evaluations.ts:1065-1101`, CAS at `:1101` after the tenant check at
   `:1100`) branches on `parentPlanId`: a child is patched to `approved`, then `by_parent` is queried
   for siblings and the **parent** flips `collecting → proposed` when none remains at `collecting`.
   That is the only place a fan-out becomes approvable: one card, one Approve. `sweepStuckPlans`
   (`reliabilitySweep.ts:312-317`), which today patches a stalled `collecting` memo straight to
   `proposed`, must take the same child terminal and trigger the same sibling check, or it re-opens
   the hole one dead worker at a time.

5. **The weekly review inserts ROOTS, not children, and gains the interlock it never had.**
   `REVIEW_THREAD_ID = "proactive-review"` (`packages/core/src/notificationTemplates.ts:49`) is a
   fixed string, so the review has one plan row for the tenant's entire lifetime. It now inserts.
   **Roots, deliberately**: a staged gap is a proposal the owner approves on the ordinary approvals
   surface (ADR-033 Decision 2 — *"the same approvals surface, the same Approve gate"*), and under
   Decision 4 a child is by definition unapprovable. An agenda row therefore records a **root**
   `planId`, which is also what keeps `lib/agenda.ts`'s demotion loop (`:112-121`) correct — two
   agenda rows pointing at two live roots never collide, and its justification at `:95-97` (*"The
   review thread has ONE plan row that `applyActOnGap` recycles"*) is rewritten in the same commit.
   `applyActOnGap` (`evaluations.ts:910-957`) acquires the check `stageResearchPlan` has and it
   lacks: a `collecting` + `kind: "memo"` row is dispatch-owned and is never reset. Its own header
   already flagged the divergence — *"Change one and decide CONSCIOUSLY whether the other moves"*
   (`evaluations.ts:908`) — and this is that decision. `plan_busy` survives as the refusal for a
   mid-flight root; the `(plan.status === "done" && plan.kind === "memo")` clause
   (`evaluations.ts:945`) is deleted, because it existed only to make recycling possible.

6. **A fan-out's budget is the root envelope divided by the worker count, at the fan-out site.**
   Stated as a contract so G6 cannot get it wrong:
   - **`governedDispatch` is not edited.** `dispatch.ts:474-481` stays byte-identical. Its
     carry-through branch (`args.envelopeCents > 0 ? args.envelopeCents : derive`) is already the
     divide-friendly shape, and it has never run in production — all three root sites pass
     `envelopeCents: 0` (`evaluations.ts:1002`, `llm.ts:2020`, `llm.ts:2077`). Any G6 diff touching
     that ternary re-opens the per-hop-allowance hole the branch exists to close.
   - **The division happens exactly once, at the mint site, before any child is scheduled.** `N` is
     the length of the child array actually inserted — read once, never model-supplied, never
     re-derived downstream.
   - **Every child is scheduled with `envelopeCents: Math.floor(root / N)` and `spentCents: 0`,
     never `envelopeCents: 0`.** A child passing `0` silently re-derives the full 25 % rail
     (`ENVELOPE_FRACTION`, `dispatch.ts:67`) and the division is gone with no test failing, because
     `dispatch.ts:475` cannot tell "no envelope yet" from "a divided envelope of zero".
   - **A floor of 0 is correct and stays.** On a nearly drained rail every child is refused
     `budget_exhausted` at `dispatch.ts:481` (`0 >= 0`). That is the intended fail-closed outcome and
     is not to be repaired with `Math.max(1, …)`.
   - **`spentCents` does not aggregate across siblings.** It is a per-branch call-arg accumulator
     (`dispatch.ts:526`); the divided envelope is the whole sibling-isolation mechanism. A shared
     counter would need DB state and would contradict ADR-008.
   - **Per-child attribution rides a field that already exists.** `recordSpend` already accepts
     `planId: v.optional(v.id("plans"))` (`guardrails.ts:403`), forwards it (`:432`) and lands it on
     the `spendEvents` row (`spendLedger.ts:80`, inserted `:132`) — and **zero of its twelve callers
     pass it**. The change is one trailing optional argument on `recordModelSpend`
     (`llm.ts:4633-4651`) threaded from `runAgentLoop`'s required `planId`. Caution:
     `recordMovement` is keyed `(tenantId, correlationId, phase)` and a replay **returns the stored
     id and ignores the replayed args** (`spendLedger.ts:121-129`), so a child reusing a parent's
     correlation string silently inherits the parent's `planId`.
   - **No running-total column unless code patches it.** `vaultFolders.spentCents` is declared
     required (`schema.ts:2267`), written `0` at four sites (`vaultFolders.ts:104, 128`,
     `vaultDrive.ts:895, 965`), **incremented nowhere and read by nobody**; `settleFolder` refunds
     `reservedCents` whole (`guardrails.ts:780`) without consulting it. It shipped green and stayed
     wrong because every reader saw a well-formed `0`. If G6 adds a per-child accounting field, a
     reader ships in the same commit or the field is not added.

7. **The Approvals plane moves to `planId`, in this phase.** The four
   `useQuery(api.plans.byThread, { threadId: item.threadId })` calls (`ApprovalsView.tsx:746, 856,
   975, 1333`) and the `Plan` alias at `:26` move to `plans.byId` with the `item.planId` the list
   already emits (`approvals.ts:72-83`). The thread-addressed `answer` mutation (`:1055`) moves with
   them. **It cannot be deferred**: today a card that mutates by `planId` while displaying by
   `threadId` is safe only because `.unique()` throws; the moment it does not, the card shows one
   plan's recipients and body while Approve fires `executePlan` on another's `planId` — a silent
   wrong-row approve on the money surface. `approvals.answerDecision` (`approvals.ts:356-400`) stays
   thread-addressed and is untouched: it reads and writes `evaluations` by `by_tenant_thread`, never
   a plan row, and its `DecisionItem` carries no `planId` to move to.

8. **Losing the throw is a cost, and it is paid deliberately.** `.unique()` is today both the
   invariant and the **only structural duplicate detector** on this table.
   `gapAction.test.ts:343-344` argues exactly that in its own words — a duplicate *"would make every
   later read of the thread THROW, not merely show the wrong thing"*. After this ADR a duplicate
   root shows the wrong thing. Three things are what make that acceptable, and all three ship
   together or none of it does: Decision 3's one-open-root invariant (a second root cannot be opened
   beside an unfinished one), Decision 7 (the money surface stops resolving rows by thread), and
   Decision 2's fail-closed window (a scan that finds no root throws rather than guessing).

## Consequences

- **Playbooks that move in the same commit** (CLAUDE.md §9), resolved from `watch.json` by path and
  not by topic: **cockpit.md** (`plans.ts`, `llm.ts`, `dispatch.ts`, `cockpit.ts`,
  `apps/web/app/(app)/dashboard/workspace/`, `apps/web/e2e/`), **dashboard-pages.md** (`approvals.ts`,
  `apps/web/app/(app)/dashboard/approvals/`), **business-evaluation.md** (`evaluations.ts`,
  `agenda.ts`, `lib/agenda.ts` — its `:532-535` states the invariant outright), **media.md**
  (`reliabilitySweep.ts`), **skill-registry.md** (`packages/contracts/skills/` and its `.ts` mirror,
  which Decision 3 edits), and **audit-dead-letter.md** (`packages/contracts/src/auditProjection.ts`,
  required by the open item below). `schema.ts` is under `"_unassigned"` and stays there.
- **Tests that go red and must be rewritten, not deleted.** Cardinality: `gapAction.test.ts:347`
  (`expect(plans).toHaveLength(1)`), `:348`, `:350-351`; `agenda.test.ts:110, 128`;
  `proactiveReview.test.ts:180-184` and the two-`runCron` test at `:187`. Reason codes:
  `dispatch.test.ts:1815, 1833, 1841, 2386, 2400, 2436, 2455, 2463, 2532` and the fixture premise at
  `:2515-2516`; `evaluations.test.ts:1073-1092` and `gapAction.test.ts:371` (`plan_busy`, re-scoped
  to a mid-flight root); `cockpitTools.test.ts:3073, 3098, 3116` and the rationale comment at
  `:3039`. **Eleven e2e reads** of `api.plans.byThread` (`pipeline-uat.spec.ts:719, 788, 839, 846,
  989, 1025, 1213, 1219`; `approvals.spec.ts:16, 243, 293`; `skill-authoring.spec.ts:286, 323`) plus
  ~20 backend test consumers of the single-document contract. **Two traps**: the skill body is pinned
  byte-identically twice (`skills.test.ts:1137, 1150-1151` and `skillBodies.test.ts:291`), so the
  `.md` and its hand-derived `.ts` mirror move together; and `skills.test.ts:1191-1251` caps **each
  string literal** at 200 chars (`MAX_INLINE_STRING`, `:1193`, measuring literals rather than
  concatenations), with `IMAGE_REFUSAL_REPLY.image_already_started` (`llm.ts:1720`) measuring **143**
  by that rule — 57 chars of headroom. `runCockpitAgent.test.ts:184-196` pins that every driver reply
  has a non-leaking user-facing translation, so the map and the constants are one edit.
- **There is no cascade in this repository, so orphaned children are a stated decision.**
  `ctx.db.delete` appears at 30 non-test sites and not one targets `plans`; `resetPlan`
  (`plans.ts:951`) touches one row; `tenantDelete.ts:308-315` walks `by_tenant` and collects children
  incidentally. A child therefore outlives an abandoned parent. It is invisible rather than wrong —
  `approved` is paged by no approvals query and counted in no `blueprint.ts:639` bucket — which is
  why `approved` is the child status and why no deletion path is added here.
- **`sweepStuckPlans` will status-sweep children.** Its `collectingPlane` predicate
  (`reliabilitySweep.ts:277-284`, `COLLECTING_STALL_MS` at `:50`) matches a stalled fan-out child
  exactly. Per Decision 4 it resolves a dead worker to the child terminal and re-runs the sibling
  check, so a fan-out with one dead worker still resolves to exactly one parent card.
- **A running fan-out has no in-chat progress surface.** `cards.tsx:3219` renders the newest root;
  children are invisible until the parent flips. `agentSteps.latestTurn` (`agentSteps.ts:138-158`)
  remains the only in-chat signal, and `agentSteps` has no worker index —
  `stepKey = \`dispatch:${rootRequestId}\`` (`dispatch.ts:492`), so five same-route workers collide
  on it. G6 owns that surface; this ADR does not invent it.
- **No per-thread media ceiling exists anywhere, so the daily rail is the only bound.** There is no
  plan-count guard, no conversation-length cap and no roots-per-thread limit; the `.unique()` refusal
  *was* the limit. What remains is `MEDIA_DAILY_BUDGET_CENTS = 1_000` — **$10/day per tenant**
  (`guardrails.ts:62`, enforced as the `mediaSpendCents` window at `:108`) — plus the per-tenant and
  deployment LLM rails behind `remainingDailyCents` (`guardrails.ts:453-463`, `Math.min(tenant,
  deployment)` after clamping each at 0). A tenant can queue reels on one thread until that rail says
  no. Accepted: it is the same money bound that always governed the second conversation.
- **Open items named rather than claimed away.** (a) Whether the production backend matches an absent
  optional in an index equality is **not measured**; nothing may depend on it until a live one-row
  probe says otherwise. (b) `groundMediaBrief` (`dispatch.ts:1354-1412`, invoked `:1423`) runs a paid
  specialist turn with **no envelope check and no `spentCents` accounting** — its only cost control
  is the reuse query at `:1372-1377`. G6 must state whether it runs once per media root or once per
  child before any media fan-out ships; unstated, N child briefs are N full-price passes outside
  every ceiling. (c) Any new fan-out audit payload key (`workerCount`, `parentPlanId`) needs an entry
  in the read-time allowlist (`packages/contracts/src/auditProjection.ts:382-393`) in the same
  commit, or the fan-out is unauditable — `webSearchCalls` and `declaredUnsupported`
  (`dispatch.ts:558, 560`) are already written and already invisible for exactly this reason.
- **What would supersede this**: a batch whose deliverables genuinely need separate approvals (accept
  item 3, reject item 5), which would make one discriminator answer only one of the two questions and
  force a second field; a fan-out depth greater than 1 (`MAX_DEPTH`, `dispatch.ts:58`), which would
  make "divide by N at the fan-out site" a per-level rule and reopen the envelope arithmetic; or a
  product decision to allow two concurrent open drafts on one thread, which would retire Decision 3's
  one-open-root invariant and require every cockpit tool to name the `planId` it writes to.
