> Last verified: 2026-09-08 (43-05 — **THE BATCH DOOR, `createVariants`.** `dispatchTeamTool`'s
> shape with exactly two substitutions: the stager is told the TERMINAL at birth
> (`channel: "vault"`, ADR-042 D1) and the minter is `startContentBatch`, not `startTeamRun`. It
> rides the EXISTING `grants.dispatch` spread with NO new grant — a batch spends paid drafts,
> which IS the dispatch capability, and `grantsFor` derives `dispatch` from the ABSENCE of an
> allow-list, so a second flag derived identically is the one-value knob §8 forbids.
>
> **THE GATE WITHHOLDS INSTRUCTIONS, NEVER REACHABILITY — and the durable record said otherwise.**
> `cockpit-agent` is gated, so the body section teaching a new tool ships as a CANDIDATE. It is
> tempting to read that as the tool being withheld too. It is not: the dispatch bundle is spread
> UNCONDITIONALLY under `grants.dispatch`, and the executive (`toolNames === undefined`) receives
> the UNFILTERED record, so the model sees the tool's NAME, DESCRIPTION and SCHEMA on the very
> next executive turn whatever the active body says. `toolRegistrySnapshot.test.ts`'s “executive
> via runAgentLoop” array is the proof — it builds the tool set with no skill body anywhere in the
> call. `dispatchTeam` is in that state in PRODUCTION today. 42-03-SUMMARY and STATE.md both said
> “INVISIBLE to the model until the eval gate runs”; that was FALSE, and it was load-bearing,
> because it is the premise a later phase builds on. **Consequence for every future tool: anything
> the model must not get wrong belongs in the tool DESCRIPTION, which it reads on every turn with
> no activation required — the body carries the routing judgement, the description carries the
> non-negotiables.**
>
> THE TRUNCATION SENTENCE MUST NEVER NAME THE BUDGET, and this is the third time this repo has
> written down the same defect class. `startContentBatch` returns `requested: a.variants.length`
> — the RAW model-supplied list length — while `legalVariants` drops blanks and dedupes. So
> `workerCount < requested` is equally true when the MODEL listed the same angle twice. Copying
> `dispatchTeam`'s “there was not enough of today's budget” clause would answer a PIPELINE
> question with a MONEY claim, on a turn where nothing was short of money. Pinned by a source
> scan in `cockpitTools.test.ts`, which strips comments first — its first draft went red on the
> very comment explaining the rule, and a guard that fires on its own rationale gets deleted
> rather than fixed.
>
> THE `channel: "vault"` FORK CANCELS THE THREAD'S COMPOSING SHELL, so the tool closure's
> `planId` points at a canceled row for the rest of the turn: `readPlan()` checks existence and
> tenant only and lets it through, while `newestRoot` returns the batch root instead. Nothing of
> the user's is destroyed — `hasDraftContent` refuses with `draft_in_progress` BEFORE the fork, so
> the cancelled row is always an EMPTY shell. `dispatchTeam`/`dispatchResearch` do not have this
> at all: they RECYCLE the same `_id`. **ponytail ceiling:** the close here is the reply string,
> which ends the turn; the structural close is a `status` precondition inside
> `cockpit.proposeEmailPlan` — ONE guard where every caller routes, never a second copy in the
> tool.
>
> `RESEARCH_REFUSAL_REPLY.draft_in_progress` says “starting research would discard it” on a
> VARIANTS refusal — the wrong noun, deliberately not forked. `dispatchTeam` already relays the
> same map; the refusal is right in shape and severity and only the word is off, and splitting a
> driver-plane map for one word is the abstraction §8 forbids. Named here instead of fixed.
>
> REGISTRATION IS SEVEN SITES AND FOUR OF THEM FAIL SILENT: the `agentSteps.tool` literal (fifth
> time this union has been the trap — a missing literal throws inside an AI-SDK callback the SDK
> SWALLOWS, so prod loses the trace row while the suite stays green), the `cards.tsx` VERB, the
> `.md`→`.ts` mirror, and the body section itself. The swallowed-step guard only SEES the tool
> because its key sits at FOUR-space indent inside `buildCockpitTools`; a top-level
> `buildSaveAsDocumentTool`-shaped builder (key at two spaces) is invisible to that regex and
> would disarm the check silently. Verified by mutation, not by reading.
>
> A FORM MAPS TO A DRAFTER IN ONE PLACE, `drafterSkillFor` in `@pikar/contracts/skill`. 43-04 had
> shipped `runVariant` with its OWN two-way copy (`sheet` or long-form) while `createDocument`
> used the three-way, so every `short` variant — the PRIMARY case, since versions of a post or an
> ad headline are short-form — would have been drafted by the long-form body, and the
> `skillVersions` lookup repeated the same ternary so an eval pin on `content-drafter` could not
> reach a variant. Nothing was red: `document-drafter` is a legal member of the closed union it
> feeds, so the wrong body returns plausible prose. `runVariant` had NO behaviour coverage, which
> is why it shipped; a source tripwire now refuses a second copy, narrowed to a form comparison
> REACHING a drafter constant after the first version went red on two innocent neighbours.)
>
> Last verified: 2026-09-08 (43-06 — **THE VAULT ARM.** `CHANNEL_SPECS.vault` is
> `schedulable: true` now, flipped in the SAME COMMIT as the arm that honours it (ADR-042 D3): a
> `schedulable: true` with no arm behind it is precisely the lie ADR-039 D3 forbids.
>
> THE ARM INVENTORY, and it is the thing to read before touching any of this:
> `email -> startFanout`, `vault -> persistNextStepMemo`, BOTH inside `startScheduledDelivery`,
> switching on the channel read off the ROW that handler already re-read. Never off `args`: an
> argument minted wrong once is wrong for ever, whereas the row is re-read on every fire.
>
> **WHY THE SWITCH IS INSIDE THE CALLBACK AND NOT AROUND IT.** Arming a memo child on the EXISTING
> email callback is the single most likely way this phase could have shipped broken and looked
> fine: `startFanout` patches `delivering`, `deliverApprovedPlan` loops over ZERO `requests` rows,
> `markPlanDone` patches `done` — the row reads scheduled -> delivering -> done, the workflow
> SUCCEEDS so no dead-letter row is archived, and nothing was ever published. No throw, no audit,
> nothing to find. `startFanout` now also throws `EMPTY_FANOUT` on an empty `requestIds`: today
> unreachable (the email path refuses `all_recipients_suppressed` first, and the arm refuses a
> non-vault child), written as the structural close for the NEXT channel routed there by mistake.
>
> **AN UNSCHEDULED VARIANT MEANS PUBLISH NOW, NEVER PUBLISH NEVER.** `armOrPublishChildren` arms a
> child that carries a `sendAt` and PUBLISHES one that does not. An arm handling only the
> scheduled children would leave the rest at `approved` — one of exactly two statuses invisible to
> every approvals query — and the parent's sibling check would then flip it to `done`: a
> 15-variant batch where the user timed three would file three documents, silently discard twelve
> FULLY BILLED drafts, and read finished. Mutation-proven, and it is the highest-consequence
> assertion in the phase.
>
> EVERY REFUSAL HAPPENS BEFORE THE FIRST WRITE (the 20-07 lesson). Arming eight children and
> refusing the ninth leaves a half-armed batch nothing can resume and nothing can cleanly cancel,
> which is why the horizon and channel checks are a separate pre-pass rather than a check inside
> the arming loop.
>
> A BATCH PARENT TAKES `scheduled`, NOT `done`, while any child is armed — `cancelScheduledPlan`
> CASes on `scheduled` and `discardPlan` on `proposed`, so a `done` parent is unreachable from
> BOTH doors and its queue could never be cancelled. It also files no document of its own: its
> body is already the assembly of its children, so publishing it too would file the batch twice.
>
> THE CANCEL WALK HAS **ONE** GUARD, and the count is the point. `scheduler.cancel` THROWS on a
> committed id, so a bare loop turns ONE already-fired child into a thrown mutation that rolls the
> WHOLE transaction back and leaves every sibling armed. The design had TWO guards; the second was
> dead code behind the first and made the mutation meant to prove the loop unfalsifiable — delete
> the inner check and the outer `continue` still skipped the fired child, so the test stayed green
> over a removed guard. One guard, and it reddens.
>
> A CHILDLESS vault memo with its own `sendAt` is ARMED, not published now. Before the flip
> `setPlanSendTime` refused that row outright; the flip made it legal, and without its own branch
> the memo terminal would have published immediately and dropped the time it had just accepted —
> ADR-039 D3's prohibition surviving the very flip meant to honour it.
>
> The far-future cap is the EMAIL arm's gate and no longer “the one place the schedule-vs-immediate
> decision is made”; that sentence was deleted rather than left to expire. What is still true:
> both arms call ONE predicate, `beyondHorizon`, so they cannot drift. Email's horizon is the Gmail
> TOKEN'S LIFE; vault's is a product bound (90 days) because a vault publish has no credential to
> expire — borrowing email's seven days would have been a number copied for no reason.
>
> TWO REFUSAL TESTS WERE DELETED in `plans.test.ts` and are not mourned: with every channel
> schedulable, `setPlanSendTime`'s `channel_not_schedulable` and `patchPlan`'s throw have NO
> REACHABLE SUBJECT. They stay in the code as fail-closed tripwires for the next channel. They
> were NOT replaced with an `isSchedulable(c) ? A : B` ternary — dead on its false arm, which is
> the exact vacuity the deleted `channel.test.ts` assertion existed to make loud, reintroduced
> inside its own replacement. What proves a new channel would be caught is `vaultArm.test.ts`'s
> ADR-042 D4 binding: every channel whose spec says `schedulable: true` HAS an arm, asserted on a
> per-channel ARTIFACT (`vaultDocuments.sourcePlanId`, `plans.workflowId`) rather than a status —
> a status-only assertion goes GREEN on the mis-arming case, which was verified by mutation.
>
> `vaultArm.test.ts` IS ITS OWN FILE on purpose. Run inside `cockpit.test.ts` these tests failed
> PROGRESSIVELY — the first two green, everything after red with `crypto is not defined`, a message
> pointing at `contentHash` and having nothing to do with it — and passed in isolation under `-t`.
> That difference is the diagnosis: cross-describe interference in a 2400-line file with eight fake
> clocks and three harnesses. The new file registers only what the vault arm touches and quiesces
> its ingest workflows in `afterEach`.
>
> `reschedulePlan` now refuses a row with children DELIBERATELY. It was already refused in
> practice, but only by `needs_future_time` — an accident that would have evaporated the moment a
> root could carry its own `sendAt`, which this commit makes legal.
>
> NOT IN THIS PHASE, and it is a missing capability rather than a defect: `moveScheduledPlan`
> refuses a vault row at its `requests.length === 0` guard. Owner decision 2026-09-07: a variant's
> time is SET ONCE at Approve; to change one, cancel the batch and re-approve.)
>
> Last verified: 2026-09-07 (43-04 — **the content batch: N variants of one piece, one approval
> card.** `startContentBatch` is a SIBLING of `startTeamRun`, not a parameter on it:
> `legalAssignments` drops any route `resolveSpecialist` rejects, so every content assignment
> would have vanished and `NO_ROUTES_REPLY` would have fired on a batch with nothing wrong with it.
>
> **THE MONEY BOUND IS THE COUNT, AND THIS IS THE THING TO UNDERSTAND BEFORE CHANGING ANY OF IT.**
> `guardrails.preCall` is `rateLimiter.check(..., { count: 1 })` — “is there ANY budget left”, not
> “can I afford this call” — and `recordModelSpend` consumes AFTER the fact. So N CONCURRENT drafts
> all see the same pre-spend rail and all pass. 43-02's per-draft gate bounds a SEQUENCE (two tool
> calls in one turn), never a fan-out; the commit message for 43-02 claimed more than that and this
> line is the correction. `narrowFanOut`'s own cap does not save it either: it caps `workerCount`
> at `rootEnvelopeCents`, i.e. ONE CENT per worker, which is what makes `share >= 1` a theorem and
> nowhere near what a draft costs. `EST_DRAFT_CENTS` divides the envelope so the COUNT is a real
> bound. Mutation-proven with exact arithmetic (500c budget, 480 spent, x0.25, /2 = 2 workers;
> undivided funds all 5) — the first version of that test asserted `toBeLessThan(5)` and stayed
> GREEN under its own mutation, because the undivided envelope funded 2, which is also less than 5.
>
> A variant worker (`llm.runVariant`) does NOT go through `governedDispatch`. `startDispatchRun`
> requires an `envelopeCents` and `governedDispatch` reads `envelopeCents > 0 ? it : derive`, so a
> child passing 0 would be granted the FULL rail share — verbatim the defect ADR-038 fixed. A
> variant is ONE `draftDocument` call: no tools, no recursion, nothing to govern. `planId` stays
> TOP-LEVEL in the scheduler args so `reliabilitySweep`'s `dispatchLive` scan still sees the run.
>
> THE PIECE IS WELDED ONTO THE ANGLE IN CODE (`legalVariants`), the `headingFor` precedent. An
> angle alone (“lead with the numbers”) is a fragment with no subject; fifteen workers briefed that
> way produce fifteen drafts about nothing while the reported count stays correct. The test reads
> the brief back out of `_scheduled_functions` args, not off the narrower's return — asserting the
> `subject` alone left the consumer that ignores the weld completely invisible.
>
> `stageResearchPlan` gained ONE optional arg, `channel: v.literal("vault")`, and its RECYCLE
> BRANCH FORKS. `channel` is birth-only, so a recycled shell can never acquire one — reusing the
> open row for a batch would mint a root that `parseChannel(undefined)` reads as `"email"`, which
> is exactly ADR-042's failure arriving through the reuse door. A batch cancels the shell and
> inserts a fresh root beside it, both in the SAME mutation so no reader sees two open roots. That
> fork was 100% uncovered by every proposed check until it got its own test.)
>
> Last verified: 2026-09-07 (43-03 — `plans.channel`, the content queue's other half. `CHANNELS`
> in `packages/core/src/channel.ts` is CANONICAL; the `schema.ts` union is a MIRROR and the
> two-way compile bind lives in `plans.ts` beside the `Doc<"plans">` it needs (§1 — core must never
> import the generated types). `NonNullable<>` on BOTH sides of that bind: the field is optional,
> and without it `undefined` joins the document type and the bind passes one way while failing the
> other.
>
> **ADR-042 SUPERSEDES ADR-039 D2, and the reason is worth reading before touching this.** D2 made
> an absent `channel` mean `"email"`; D6 pins every batch row to `kind: "memo"`. But
> `armFor("memo")` is `"inline"`, and the inline arm's memo terminal returns BEFORE the email arm,
> the gmail check, the horizon cap and the scheduler — so a memo row structurally CANNOT reach the
> email terminal. A batch row written exactly as ADR-039 specified would have been accepted into
> the queue as an email and then silently filed a vault document, and D3's refusal would not have
> caught it because `email` is the schedulable member. `channel` is now REQUIRED on any row a batch
> mints. Optional on the TABLE is not a default in the CODE.
>
> `channel` is BIRTH-ONLY on `insertPlan` and deliberately NOT a `patchPlan` argument. `patchPlan`
> is the model's door — it is how `sendAt` gets written — so a patchable channel would allow
> set-`sendAt`-then-flip-`channel`, a bypass needing a second guard. Birth-only closes it for free.
>
> The D3 refusal sits at BOTH `sendAt` write sites, and they refuse differently on purpose:
> `setPlanSendTime` is the USER's door and RETURNS `{ ok: false, reason: "channel_not_schedulable" }`;
> `patchPlan` is the MODEL's door, has no refusal channel, and THROWS. Silently dropping the field
> would be the exact failure D3 forbids. Clearing a time is always allowed — refusing
> `sendAt: undefined` would strand a row nobody could un-schedule.
>
> THE TEST THAT EARNS ITS KEEP is the READ-BACK: `expect(row?.sendAt).toBeUndefined()`. Asserting
> only the returned reason stays green against a guard placed AFTER the patch — mutation-proven,
> moving the guard below `db.patch` reddens that one assertion and nothing else. Two positive
> controls sit beside it (an email row still schedules; a LEGACY row with no channel at all still
> schedules), because a blanket “nothing schedules” would otherwise pass every refusal test.
>
> **A KNOWN EXPIRY, do not just delete it.** `channel.test.ts`'s non-vacuity check asserts some
> channel is unschedulable. 43-06 flips `vault` to `schedulable: true` in the SAME commit as the arm
> (ADR-042 D3 — the flip and the arm must not be separable), and at that moment the check fails BY
> DESIGN. ADR-042 D4 names its replacement: a binding test in `packages/backend` that every channel
> whose spec says `schedulable: true` HAS an arm. That is strictly stronger — it asks the hazard
> question rather than a fact about a list — and it stays falsifiable for ever.)
>
> Last verified: 2026-09-07 (43-02 — **`draftDocument` was entirely off the money rail.** Two
> fully-billed `generateObject` calls (primary + `CHEAP_MODEL` fallback), both discarding `usage`,
> with no `preCall` in front and no `recordSpend` behind: the last unmetered paid call reachable
> from the cockpit, and the one Phase 43's batch is about to multiply by `MAX_FAN_OUT`. Fifteen
> variants would have been fifteen drafts the rail never heard about.
>
> THREE decisions worth keeping. (1) The gate sits ABOVE `parseSmoke`, the placement
> `deriveCandidates` already uses — a guard the offline path never reaches is a guard no fixture
> can exercise, so it would only ever be tested in production. (2) A refusal is RETURNED, never
> thrown: `createDocument`'s catch answers a throw with “offer to try again”, which is right for a
> render error and exactly wrong for an exhausted rail, and that file's own comment records the
> price — eval fixture 35, `createdDocCount 0` behind five successful-looking calls.
> `renderAndStore` has no catch at all, so a throw there escapes as a raw SDK tool-error. (3) The
> correlation is `document:${runId}:a0` / `:a1` with a MINTED runId: the fallback is a second fully
> billed call, and a content-derived id would collapse 14 of a 15-variant batch onto one ledger row
> — the ledger below the limiter, the unrecoverable direction. `runCockpitAgent.test.ts`'s
> correlation-template scan already guards this and went 8 → 10.
>
> THE TEST TRAP, recorded because it nearly shipped: the kill-switch and budget refusals were one
> test, so the gate-neutralising mutation reddened the first `expect` and the run never reached the
> second — the budget half was unproven while looking proven. They are two tests now, both
> independently RED under that mutation. The kill switch only proves the gate is CALLED; the budget
> is what proves it reads the window `recordSpend` writes to.
>
> KNOWN LIMIT, not a gap to close silently: the `recordSpend` halves are NOT exercised offline — no
> spend happens on the smoke path because no model call happens. What is pinned offline is the gate
> and the refusal union; the metering itself is first exercised by a paid run.
>
> `cockpitTools.test.ts` lost its second harness in the same pass. `setupWithLimiter` existed
> because “the tool-level `__invokeCockpitTool` shim never touches preCall” — 43-02 made that false
> for every attachment and document test, so there is ONE `setup` now.)
>
> Last verified: 2026-09-07 (43-01b — `lib/planRow.ts` gained `hasDraftContent` (moved out of
> `plans.ts`, which now imports it) and `holdsWork`. The move is the point: `blueprintPulse` needed
> the same question `stageResearchPlan` asks before it dares recycle a row, and a second copy would
> have been free to drift from the one that guards a user's half-composed email.
>
> `dispatch.ts`'s grounding-pass header was the FOURTH stale `.unique()` comment and the
> load-bearing one — it is the reason given for where a PAID MODEL TURN runs. It claimed `plans`
> is `.unique()` by (tenantId, threadId) and that `stageResearchPlan` RECYCLES it; ADR-037 deleted
> both halves. The decision is unchanged and its true reason was already in the next sentence (the
> pass writes only a vault document, which has no plan row of its own), so the premise was replaced
> rather than the choice re-argued. The remaining siblings are lower-stakes prose:
> `llm.ts:1828`, `llm.ts:3737`, `onboarding.ts:202`, `smoke.ts:928/974`,
> `scripts/run-eval-golden.mjs:577/2804`.)
>
> Last verified: 2026-09-07 (43-01 — a COMMENT-ONLY correction with no behaviour change, recorded
> because the comment was actively dangerous. `cockpit.ts`'s thread-and-plan helper said two
> creators "would make it throw", because `plans.byThread` was a `.unique()` read. ADR-037 removed
> that throw: `newestRoot` is a bounded descending scan, so a second creator now succeeds SILENTLY
> and leaves two roots where the caller assumed one. Reaching the same row is a property this
> function must keep ON PURPOSE; the database no longer keeps it for us.
>
> Two sibling comments were corrected in the same pass (`schema.ts`'s inline-deck rationale and
> `evaluations.ts`'s actOnGap header), both of which still cited `.unique()` and one of which
> described a reuse that 42-03 replaced with an insert. A stale comment that names a REMOVED
> invariant is worse than no comment: it tells the next reader a constraint is enforced when the
> only thing enforcing it is the code they are about to change. ADR-039 is the Phase-43 design
> that depends on getting this right.)
>
> Last verified: 2026-09-07 (42.2 — **A FAN-OUT CHILD IS AN ASSIGNMENT, NOT A ROUTE (ADR-040).**
> Owner decision: the fan-out should release up to 15 workers, not 5.
>
> **RAISING `MAX_FAN_OUT` ALONE WOULD HAVE BEEN A NO-OP, and that is the whole point of the
> change.** While a child was A ROUTE, the binding constraint was never that constant: it was
> `SPECIALIST_ROUTES`, a closed SIX-member set, minus `media` (refused at the door), deduped by
> route. Five distinct workers, and the cap happened to equal five. Setting it to 15 would have let
> more entries through the arithmetic and still produced five children, because the dedupe
> collapsed the rest. Check what BINDS before changing what merely bounds.
>
> `dispatchTeam` now takes `assignments: { route, question }[]` beside the umbrella `question`, and
> **the dedupe is on the PAIR**. Same route + same sub-question still collapses to one worker, so
> the identical-paid-turn guard is preserved EXACTLY — five `research` entries on one question are
> five identical paid turns for one answer, and `wouldCycle` cannot catch it because it runs per
> child against an EMPTY ancestry and never fires between siblings. Same route + DIFFERENT
> sub-questions is now several workers, which is what makes a 15-worker team mean anything.
>
> **Each worker is briefed with ITS OWN question, never the umbrella one.** The umbrella question
> briefs nobody: it is the card's subject and what the assembled memo answers. Briefing all N with
> it would re-create the identical-turn case ONE LAYER DOWN, where no dedupe can see it — N
> distinct rows, N identical model turns. A blank sub-question is DROPPED, never defaulted to the
> umbrella question, for the same reason. Both are mutation-proven.
>
> A child's `subject` carries the route AND the sub-question, because two children may now share a
> route and two identical `## Research` headings in the assembled parent would leave the reader
> unable to tell which answer belonged to which question.
>
> **`MAX_FAN_OUT` IS A MONEY CEILING, not a concurrency preference.** A child is dispatched with
> `spentCents: 0` and `governedDispatch` refuses only on `spent >= envelope`, which is false at the
> start of every child — so the envelope bounds RECURSION, not the first turn. This constant is the
> real bound on how many paid turns one Approve can buy: up to 15, ~3x the old ceiling. ADR-038's
> `narrowFanOut` still caps `n` by `rootEnvelope`, so a thin rail starts fewer, and `workerCount`
> on `subagent.dispatched` records how many actually started.
>
> **`ROOT_SCAN` IS NOW DERIVED (`2 * (MAX_FAN_OUT + 1)`), NOT A LITERAL.** ADR-037 justified the
> literal 20 in PROSE ("6 for a G6 fan-out, 11 for a G10 batch"). At a cap of 15 the true burial is
> 16, so the literal would have kept passing with four rows of margin instead of the headroom the
> ADR claimed, and nothing would have said so. That is the SAME defect class as 42.1's expired
> conjunction: a constant whose safety depends on another constant's value, recorded only in a
> comment. `fanOut.test.ts` pins `ROOT_SCAN > MAX_FAN_OUT + 1` rather than either number, and
> `plans.test.ts` pins the behaviour at the real cap (a FULL fan-out still resolves its own root)
> and derives its scan-window test from `ROOT_SCAN` instead of hardcoding 20.
>
> Recorded honestly: the mutation "put `ROOT_SCAN = 20` back as a literal" does NOT redden, and it
> should not — 20 > 16 still holds today. The hazard is a FUTURE raise, which the property test
> catches at the moment it appears. Non-vacuity was proven with `ROOT_SCAN = MAX_FAN_OUT + 1` (RED).
>
> Measured: backend 4067 (shards 2100 + 1967), contracts 123; tsc and biome clean. THREE mutations
> verified RED and `cmp`-restored: dedupe on route alone (2 red), briefing every worker with the
> umbrella question (1 red), and a scan window equal to the max burial (1 red).)
>
> Last verified: 2026-09-07 (42.1 — **THE RESEARCH INSTRUMENT: `declaredQuestionScope` now rides
> beside `declaredUnsupported`, and the two are allowed to DISAGREE.**
>
> `llm.ts` computes `declaredUnsupported = declaredQuestionScope && sources.length === 0`. That
> conjunction ANDs `evidenceVerdict`'s FIRST disjunct into its SECOND — the verdict is
> `sourceCount === 0 || declaredUnsupported` — so it collapses the disjunction to its counter leg
> and `insufficient_evidence` can no longer fire with `sourceCount > 0`. The semantic channel
> 22.1b built is, today, unreachable.
>
> **THE CONJUNCTION WAS RIGHT WHEN IT WAS WRITTEN AND ITS PREMISE HAS SINCE EXPIRED.** It was
> justified by a measurement recorded in `dispatch.test.ts`: "fixture 33's measured shape — every
> one of its dispatches across v2–v7 came back with sourceCount 0". Phase 39 then shipped
> research-specialist v10 with `readPage`. The Phase-40 gate run shows 8 `webResearch` calls with
> `insufficientEvidence: false`, and since the verdict fires on `sourceCount === 0` whenever
> `webSearchCalls > 0`, that reading PROVES `sourceCount > 0`. A frozen fact about another lane
> became a predicate, and the lane moved. Consequence today: research on a fabricated entity lands
> verdict `sourced` with no `INSUFFICIENT_EVIDENCE_LABEL` — D11 is off on the verdict plane, and
> the golden gate is red on fixture 33, which jams EVERY gated skill activation
> (`shouldRecordEvidence` demands all 46 green with no filters).
>
> **THIS COMMIT DOES NOT FIX THE CONJUNCTION, DELIBERATELY.** Removing it is only safe if the
> declaration reflex is gone at v10, and the reflex was last measured at v6/v7 (declared on 5/5
> runs while holding 0,3,4,6,8 and then 6,10,0,9,8 sources). If it persists, dropping the `&&`
> moves the red from fixture 33 onto fixtures 32 and 34 instead. So the owner's call was
> INSTRUMENT FIRST: expose the raw pre-conjunction bit so ONE live gate run decides it with data
> instead of a fourth skill-body rewrite tuning a signal nobody could see.
>
> `declaredQuestionScope` is READ-ONLY instrumentation. Nothing branches on it, no fixture asserts
> it, and it can never move a verdict — which is what makes adding it to a money/honesty path safe
> to ship un-measured. It rides `subagent.completed` rather than `research.persisted` because that
> row already carries `declaredUnsupported` and the eval harness already walks it, so no
> `persistFindings` argument and no `groundMediaBrief` change was needed. The two booleans on one
> row disagreeing IS the measurement; asserted together in `dispatch.test.ts` rather than
> separately, because either alone is satisfiable by a run that did nothing.
>
> Measured: backend `dispatch.test.ts` 127, `llmRedaction.test.ts` 67, contracts 123; `tsc` clean
> in backend and contracts; the runner's `--self-check` passes. TWO mutations verified RED and
> `cmp`-restored: dropping the key from the `subagent.completed` payload (1 red), and forcing the
> instrument to a constant `true` (1 red — the sub-question test is the non-vacuity half).)
>
> Last verified: 2026-09-07 (media canvas copy — `mediaCanvasView.ts` now words "refused by the
> provider's content check" off a row's `verdict`, never its `status`; a blocked row with no verdict
> is a setup fault, not a refusal. Owned and explained in `media.md`'s entry of the same date.)

> Last verified: 2026-09-07 (42-03 — **THE GOVERNED FAN-OUT: one question, up to five specialists,
> ONE approval card (G6, ADR-037 + ADR-038).** `dispatchTeam` stages a ROOT through the ordinary
> `stageResearchPlan` (so it earns every existing interlock and the one-open-root invariant, rather
> than a second copy of them), then `dispatchRun.startTeamRun` mints the children and schedules one
> durable starter each.
>
> **THE THING THAT WILL BITE THE NEXT PERSON: a child is `kind: "memo"` AT BIRTH.** `insertPlan`
> gained `parentPlanId` / `kind` / `subject` for exactly this. Every previous caller set `kind` in a
> SECOND transaction via `patchPlan`; a fan-out minting n children in one mutation has no second
> transaction, and a child without `kind: "memo"` is discarded by THREE independent fail-closed
> gates — `landSpecialistResult`'s CAS, the sibling flip that reads it, and `reliabilitySweep`'s
> `collectingPlane`. The paid memo vanishes, the parent hangs at `collecting` for ever, and the
> join tests still pass if their fixtures seed children by hand. Two independent adversarial
> reviewers found this before implementation; `fanOut.test.ts` reads a minted child back and the
> mutation that removes the field reddens FOUR tests. These three args are on `insertPlan` ONLY,
> never on `patchPlan`: `parentPlanId` decides artifact-vs-worker, so it is written once, at birth,
> by code the model cannot reach.
>
> **THE MONEY RULE IS ADR-038, AND IT SUPERSEDES ADR-037 DECISION 6.** A fan-out NARROWS to what
> the rail can fund: `n = min(routes, MAX_FAN_OUT, rootEnvelope)` and `share = floor(root / n)`,
> which makes `share >= 1` a theorem rather than a hope. ADR-037 claimed a child with a share of 0
> is refused `budget_exhausted`; it is NOT — `governedDispatch` reads
> `args.envelopeCents > 0 ? … : derive`, so a zero child takes the DERIVE branch and is granted the
> FULL rail share, and `floor(root/n)` is 0 across the whole interval `root < n`, not just at 0.
> `narrowFanOut` is a pure function in `lib/dispatchShared.ts` precisely so that arithmetic is
> unit-testable without driving a rate limiter down. `Math.max(1, …)` stays forbidden.
>
> Three more things the model does NOT decide: duplicate routes are collapsed (`SPECIALIST_ROUTES`
> is a closed six-member set, so five `research` entries would otherwise buy five identical paid
> turns, and `wouldCycle` cannot catch it — it runs per child against an EMPTY ancestry and never
> fires between siblings); `media` is refused at the door (a media dispatch runs `groundMediaBrief`,
> a PAID turn with no envelope check, so N media children would be N full-price passes outside every
> ceiling); and a `research` route runs on `kind: "research"`, because the generic specialist path
> would lose `persistResearchFindings` AND land LOST_CONTEXT_MEMO's "the evaluation it was based on
> is no longer on file" — false for a run that was never based on one.
>
> `lib/planRow.ts` stopped being read-only. It gained exactly ONE writer,
> `flipParentWhenSiblingsDone`, because TWO callers need it and must not diverge: a child that lands
> normally and a child a watchdog resolves. Two copies of "is this fan-out finished" is how a dead
> worker leaves a parent stuck while the happy path looks healthy.
>
> Registration, all in this commit: the `llm.ts` tool key inside the existing `grants.dispatch`
> spread, the `dispatchTeam` literal in `schema.ts`'s CLOSED `agentSteps.tool` union (fourth time
> that union has been the trap — a missing literal throws inside the SDK where the error is
> swallowed), the `cards.tsx` VERB entry, and the four sorted arrays in `toolRegistrySnapshot.test`.
> **The tool is INVISIBLE until the `cockpit-agent` body that teaches it is ACTIVE** — the body is
> edited here and is a GATED candidate; activation is owner work, per deployment.
>
> Measured: backend 4060 (2093 + 1967), core 1522, web 899 + 2 skipped, contracts 123; tsc and
> biome clean. FOUR mutations verified RED and `cmp`-restored: dropping the rail from the worker
> cap (3 red), minting children with no `kind` (4 red), removing the dedupe (1 red), removing the
> sweep's child branch (1 red).)
>
> Last verified: 2026-09-07 (42-02 — **A DISPATCH IS A DURABLE RUN NOW, AND THE PAID STEP IS NEVER
> RETRIED.** The three specialist entry points (`dispatch.runSpecialist` / `runResearch` /
> `runMedia`) are no longer scheduled directly. Every caller now queues
> `internal.dispatchRun.startDispatchRun`, which starts a journaled `@convex-dev/workflow` run whose
> single step calls the entry point with **`{ retry: false }`**.
>
> READ THIS BEFORE TOUCHING `dispatchRun.ts`. The shared `WorkflowManager` sets
> `retryActionsByDefault: true` with `maxAttempts: 3` (`index.ts:10-11`), and a specialist turn is
> NOT idempotent with respect to spend — it bills the model and draws the rail down through
> `recordSpend` before any throw can be caught. Inheriting that default turns one failed $0.02 turn
> into three. The repo already refused this exact bug one level down (`vaultIngestPool`,
> `index.ts:35-39`, OCR double-charging). `pipeline.ts:243-247` is the shipped precedent for the fix.
>
> ONE `workflow.define` with a `kind` switch, NOT three, and the reason is the failure mode: the
> dangerous edit here is an OMITTED option, invisible to the compiler, to biome and to every
> behavioural test. One call site cannot be half-omitted; three can. `dispatchGuard.test.ts` pins
> that `dispatchRun.ts` holds exactly ONE `step.runAction(` and that it carries the option, and that
> no caller schedules `internal.dispatch.run*` directly any more.
>
> WHAT DURABILITY ACTUALLY BUYS, stated honestly. `dispatchAndLand`'s `finally` guarantees "the plan
> always leaves `collecting`" only WITHIN one action invocation. `onDispatchComplete` covers the
> invocation that never reaches the `finally`: a SECOND, FREE, IDEMPOTENT landing attempt. It is a
> mutation, it calls no model, and `landSpecialistResult`'s CAS (`collecting` + `kind: "memo"` +
> tenant) makes it a no-op on the happy path. It is not a re-run and it is not a rescue from
> eviction — do not describe it as either.
>
> THE STARTER IS SCHEDULED, NOT INLINE, and that is a decision with a reason. The queued row is what
> carries the dispatch args in the app's OWN `_scheduled_functions`; a `workflow.start` enqueues into
> the COMPONENT, where five test sites that pin `skillVersions` / `tenantSkillIds` / `depth` /
> `ancestry` cannot see it. Inline would buy transactional atomicity for exactly one of the three
> callers (`applyActOnGap`; the two cockpit tools run in an action ctx and are a second transaction
> either way) at the price of those pins. `crypto.randomUUID()` stays in the CALLER — the workflow
> environment deletes `crypto` before a handler runs.
>
> `DISPATCH_ARGS`, `DISPATCH_KIND` and the two failed-run memo bodies moved to
> `lib/dispatchShared.ts` as PURE MOVES. They had to: `dispatch.ts` is `"use node"`, a
> `workflow.define` is a RegisteredMutation and cannot live in a node module, and a non-node module
> cannot import a node one. `toolContextArgs.test.ts`'s door guard followed the const to its new
> home — the invariant is about WHERE the pins are declared, not which file holds the door.
>
> Measured: backend 4048 green (shards 2081 + 1967), tsc clean both packages, biome clean. THREE
> mutations verified RED and `cmp`-restored: deleting `{ retry: false }` (the tripwire), making the
> terminal return early on `failed` (3 red), and dropping `landSpecialistResult`'s CAS (5 red).
> NOT DONE HERE: no fan-out yet, and `agentSteps` still has no worker index — five same-root workers
> would collide on `dispatch:<rootRequestId>`. 42-03 owns both.)
>
> Last verified: 2026-09-07 (42-01 — **A THREAD NOW HOLDS MANY PLAN ROWS (ADR-037).** The invariant
> that shaped this subsystem since 12-05 is retired. `plans.by_thread` was `.unique()`, which THREW
> on a second row; `plans.byThread` is now the NEWEST ROOT, read by a bounded descending scan
> (`lib/planRow.ts`, `ROOT_SCAN = 20`, the shipped `smoke.ts:893-898` idiom). A row with no
> `parentPlanId` is a ROOT — its own artifact, its own approval; a row with one is a fan-out CHILD
> and is never what "the plan for this thread" means. The field is optional, so NO BACKFILL.
>
> THE DISTINCTION THE WHOLE CHANGE TURNS ON, and the one to keep straight before touching a
> refusal here. **LIFETIME ceilings died; CONCURRENCY interlocks survived.** Gone:
> `image_already_started` (it refused a second image on any thread that had EVER produced one),
> the `RECYCLABLE_STATUS` set, the `completedMemo` carve-out, and every "start a new chat" line in
> code and UI copy. Kept, untouched in meaning: `draft_in_progress`, `research_in_flight`,
> `dispatch_in_flight`, `reel_in_flight`, `render_in_flight`, `image_in_flight`,
> `image_proposal_pending`, and the UNDERWAY replies. Every survivor is about work that is STILL
> RUNNING. If you are about to add a refusal, ask which of the two it is; if it counts artifacts,
> it does not belong.
>
> THE INVARIANT THAT REPLACES THE THROW: **at most ONE root per thread is `collecting`.** A stager
> REUSES the open root and INSERTS beside a finished one — that is what makes "the newest root" and
> "the row the user is typing into" provably the same row. Without it, staging a reel beside a
> half-composed email would move every later tool write onto the media row and strand the email
> where no query reaches it.
>
> TWO ASYMMETRIES THAT ARE CHOSEN, NOT SLOPPY. (1) `stageResearchPlan` checks only the newest root;
> the two MEDIA stagers scan the whole window, because a RENDERING reel sits at `proposed` — not an
> open root — so a newer root can legally sit in front of it and a newest-only check would let a
> second reel start while the first is still spending. (2) `cockpit.ts`'s `listThreadMessages` uses
> `.first()`, not `newestRoot`: it asks AUTHORIZATION, a child row is still this tenant's, and an
> auth predicate must not throw inside a live subscription.
>
> WHAT WAS MEASURED AND TURNED OUT NOT TO BE NEEDED: **no skill-body edit, so no gated candidate and
> no eval gate.** ADR-037 predicted a `cockpit-agent` version bump. The body's "One reel at a time"
> and "One image at a time" bullets describe the IN-FLIGHT interlocks, which all survive; the
> lifetime ceiling lived only in `IMAGE_REFUSAL_REPLY.image_already_started` (a code string, now
> deleted). Verified by grep, not assumed.
>
> Measured: backend 4034 across both shards + 5 new plan-row tests, web 898 + 2 skipped, tsc clean
> both packages, biome clean. THREE mutations verified RED and restored by `cmp`: dropping the
> `isRoot` filter in `threadRoots` (2 red), widening `isOpenRoot` to `proposed` (3 red), dropping
> the in-flight memo guard in `applyActOnGap` (2 red). NOT DONE HERE, on purpose: no fan-out exists
> yet — this plan widens the READ and the arity only. 42-02 is durable runs, 42-03 the fan-out.)
>
> Last verified: 2026-09-07 (second media-canvas fix under this playbook's `dashboard/workspace/`
> watch path; the subsystem entry is in **media.md** and this is the cross-reference. `failureCards`
> never applied `deckStillNeedsJob`, so a failed row the deck had stopped wanting still named its
> scene; and `FailureScene` carried no `overlay`/`asset`/`prompt`, so a scene naming no picture source
> -- the state `setSceneVisual` deliberately creates when you swap to your own footage -- produced no
> card and a hero sentence claiming a job had failed when none had. NOTHING IN THE COCKPIT'S OWN PLANE
> CHANGED. The transferable lesson, and the reason it is worth a line here: **a backend comment that
> says the UI tells the user something is not the UI telling them**. Two such comments in two days,
> both on this directory, both true about the hold and false about the words.)
>
> Last verified: 2026-09-07 (media-canvas fix under this playbook's `dashboard/workspace/` watch path;
> the subsystem entry is in **media.md**, and this is the cross-reference rather than a second copy of
> it. `trackerView`'s `buysPicture` (`mediaCanvasView.ts`) answered the PAID question where the render
> trigger asks the PIPELINE one, so a stock scene whose picture job FAILED was drawn `nothing to buy`,
> left out of the count, and its stage rolled up `Done` while the reel sat held at `incomplete_batch`.
> Both canvas copies now call `landsPictureRow` (`@pikar/core/render`). NOTHING IN THE COCKPIT'S OWN
> PLANE CHANGED: no tool, no skill body, no plan field, no approval path, no `llm.ts` refusal. The one
> thing worth carrying here is the shape of the defect, because this playbook watches a directory it
> does not own the invariants of -- two `buysPicture` definitions sat in that directory disagreeing,
> and the newer one had a comment explaining exactly why the older one was wrong.)
>> Last verified: 2026-09-06 (40-02/40-03, DOC-01 — **`DocFormat` IS NOW `pdf | html | xlsx`, AND THE
> DOCUMENT A TURN PRODUCED IS VISIBLE IN THE CARD.** ADR-036 fixes that set as CLOSED: there is no DOCX or
> PPTX output and there is not going to be one.
>
> **The attachment chain, updated.** `renderAndStore` picks the drafter BY FORMAT
> (`spreadsheet-drafter` for xlsx, `document-drafter` otherwise), then renders three ways: pdf →
> `markdownToPdf`, xlsx → `sheetsToXlsx(markdownToSheets(md))` (@pikar/vault subpath, static import), html →
> `renderHtmlDocument`. A draft with NO TABLE is refused BEFORE the render with its own sentence, because
> the generic render-fail message sends the model round the same loop with the same prose draft.
> `regenerateAttachment` now passes `formatForMime(old.mimeType)` — it used to pass nothing, so revising an
> html attachment silently returned a PDF. Delivery is untouched: `buildMime` passes `mimeType` through
> verbatim, so a spreadsheet part needs no mail change (the Graph arm's 3 MiB raw-MIME refusal still sits
> below the 8 MiB plan cap — a large workbook approves, delivers on Gmail and returns `too_large` on
> Microsoft, unchanged and pre-existing).
>
> **`createDocument` gained `form: "sheet"`.** `insertCreatedDoc`/`patchCreatedDoc` share one
> `CREATED_FORM` validator and derive `storedMimeType` through `storedMimeFor(form, storageId)`. That
> helper also fixed a latent bug the new form made visible: `patchCreatedDoc` never revised
> `storedMimeType`, so a long→short rewrite left a stored type with no bytes beneath it and a long→sheet
> rewrite would have framed a workbook in the PDF viewer. `vaultSources.form` widened with it, and
> `FORM_LABEL.sheet = "SPREADSHEET"`.
>
> **The Output card frames the PDF (40-03).** One branch in its preview section: when the SELECTED created
> document's bytes are `application/pdf`, the browser's own viewer in a BARE `<iframe>` at
> `min(70vh, 32rem)` — no `sandbox` (it disables the viewer plugin and frames nothing, ADR-036 §4), and one
> scroll region so a phone under 48rem does not nest two. NOT in `CanvasPane`: that is keyed on
> `plans.byThread` and a closed `plan.kind` with no document member, and a `createDocument` turn writes no
> plan row at all.
>
> **THE BEARER-URL RULE, RESTATED.** A Convex storage URL has no expiry, so where one is minted is a
> security property. The rule is now: minted only for a row the user is LOOKING AT — a card they clicked,
> or the selected created artifact of the thread open in front of them — and never sitting in a
> subscription for a row nobody is viewing. "Only on click" was the shape; this is the property.
> `outputCard.test.ts` pins that `api.vault.vaultDownloadUrl` appears EXACTLY ONCE in `cards.tsx`, inside
> `OutputCard`, gated on both the selected id and the bytes being a PDF.
>
> `vaultDocText` now also returns `storedMimeType` — metadata riding the existing subscription for the same
> reason `status` does, so the card can tell a PDF twin from a markdown-only artifact without a second
> query. The tool KEY sets are unchanged, so `toolRegistrySnapshot`'s 23 literals are untouched: widening
> an existing tool's enum is not a new tool.)
>
> Last verified: 2026-09-06 (39-01, RSCH-01 — **the research specialist reads the pages it cites.**
> `buildWebResearchTool` now returns `webResearch` + `readPage` from ONE record: the search adds every parsed
> result URL to a Set the record owns, and `readPage({ url, focus })` refuses — before any network call —
> any URL not in that Set, so an injected page can never steer the specialist to a host the provider did not
> return (the D1 property survives). It POSTs Tavily `/extract` (`basic`, markdown, `query: focus` so the
> top-ranked chunks come back), caps `PAGE_READS_PER_RUN` (6) and `PAGE_READ_CHARS` (6k), scans `focus`
> before egress, and returns a NOTE on a missing key / HTTP error / `failed_results` — never a throw (the
> webResearch rule). The loop bills `pageReads × pageReadFeeUsd()` on the same web-fee row. `agentSteps.tool`
> gained the `readPage` literal (the swallowed-step trap) and the card verbs `Reading a page… / Read the
> page`. `RESEARCH_STALE_AFTER_MS` (core, 24 h) is now BOTH the reuse window `groundMediaBrief` checks and the
> memo card's stamp (`Retrieved … — may be out of date` past it; words, not colour). `LIMITS_FOOTER` in
> research.ts was rewritten — it had said the search "was executed by the model provider", false since the
> Tavily move. Grants: `RESEARCH_TOOLS` gains `readPage`; packs do not (pinned — see workflow-packs.md).
> Tests: `cockpitTools.test.ts` (refuses an un-returned URL with fetch never called; reads a returned one
> sending `focus` as the rerank query; caps the count; a failed extraction is a note; `parseExtractResult`
> caps and surfaces the reason), the snapshot literals for the research route + three packs' `built` sets,
> `research.test.ts` on the new footer. Skill v4 through the eval gate on the local deployment — results in
> 39-01-SUMMARY.md.)
>
> Last verified: 2026-09-06 (38-01 — **`buildCockpitTools` is `(ToolContext, ToolGrants)` now; the tool
> bodies did not move.** What changed for this playbook's readers: every caller of the builder passes ONE
> context object (`ctx`, `tenantId`, `planId`, `clientContext`, `skillVersions`, `tenantSkillIds`,
> `threadId`, `rootRequestId`, `evalRevenueFixtureId`) and ONE grants object; `runAgentLoop` derives the
> grants with `grantsFor` (`@pikar/core`) and the SMOKE path in `runCockpitAgent` passes `NO_GRANTS` plus
> `gmail`/`dispatch`/`recipientEdits` decided on that path; `__invokeCockpitTool` builds bare. The
> `applyGmailCapability` post-filter and the exact-name `toolNames` filter are unchanged and still LAST.
> Static scans that anchor on `llm.ts` were untouched except the one in `workflowPacks.test.ts` that
> quoted the old derivation text — it now asserts `grantsFor` behaviourally and scans `toolGrants.ts`.
> Live check on the local deployment after the push: `cockpit-activity` (the SMOKE path),
> `cockpit-schedule` (the pinned clock + `awaiting_reauth`), `cockpit-created-document` (a real model turn
> through the loop's own tool build) — results in 38-01-SUMMARY.md.)
>
> Last verified: 2026-09-06 (36-01 re-drive — **the cockpit E2E specs sequence turns on the busy state,
> not on the empty composer.** `ChatPane.onSend` has cleared the box the moment a turn is SENT since 03.9-04
> and DROPS a second Enter while `busy` (the send button reads "Working…", `aria-busy`), so a spec's
> `say()` that waited only for `toHaveValue("")` could type its next op into a busy turn and lose it —
> measured live: `cockpit-personalize`/`cockpit-schedule` stalled with the SECOND op still in the box and no
> backend error. Every sequencing site (16, across 10 specs) now also waits for
> `getByRole("button", { name: "Working…" })` to have count 0. `cockpit-report.spec.ts` was still written
> against the guided slot-filling FSM retired at 3.2.1 (a plain first turn now goes to the REAL model);
> its four turns moved onto the `SMOKE::agent::` ops and its REPORT assertion onto the rendered label
> ("Waiting for you to reconnect Gmail"), and locally it needs a synthetic `gmailTokens` row staged
> BEFORE the browser session (`gmailAuth:store` from the CLI, as `pipeline-uat.spec.ts` does). The
> ResolutionCard's address chips gained `aria-pressed` (they are toggles whose picked state was colour-only,
> BRAND §6; the resolve spec asserts the single-match PRE-SELECT through it instead of clicking, which
> un-picked the chip and left "Use these contacts" disabled — the first-pass failure). Two
> local-only limits stand: a spec that runs `npx convex run` MID-session (`cockpit-briefing`, the later
> `cockpit-resolve` tests) ends the LOCAL anonymous deployment's browser session, and
> `skill-authoring.spec.ts` needs the harness user to be an OWNER (`PIKAR_E2E_PROVISION=1`). Neither is
> a product defect. Three more spec-side drifts fell out of the same re-drive: `cockpit-activity`, `cockpit-briefing`,
> `cockpit-resolve`, `voice` and `voice-doc` handed `smoke:seed*` the FULL JWT `sub` (`userId|sessionId`) as the
> tenant id, but `requireTenant` has keyed tenants on the part before the `|` since 2026-07-21 — every fixture
> they seeded (inbox, calendar) sat under a key no backend read ever hits, and `briefInbox` honestly answered
> "mailbox isn't reachable"; all five now split. `cockpit-schedule` filled the picker with 2035, which the
> SCHD-01 horizon (`SEND_TIME_HORIZON_MS`, 7 days) refuses as `send_time_too_far`; it now picks +2 days.
> `cockpit-briefing`'s SC-4 control count moved to `briefing-body`, the rescope `cockpit-resolve` already had.
> Final re-drive: 13/13 sentinel specs green (skips are env-gated modes only) + 4/4 smokes on the keyed local
> deployment. Pass results are in `.planning/phases/36-smoke-sentinels-out-of-band/36-01-SUMMARY.md`.)
>
> Last verified: 2026-09-06 (36-01, G24 — **THE COCKPIT GRAMMARS AND THE MODEL-COMPOSED TOOL ARGUMENTS
> ARE GATED ON THE OPERATOR FACT.** Every `SMOKE::` gate on a production path is now `prefix && fixtureSeamFor(tenantId)` (36-01, ADR-035): the string only SELECTS a fixture; WHETHER one may run is an operator fact — the keyless opt-in `PIKAR_OFFLINE_FIXTURES=1`, or this tenant listed in `PIKAR_FIXTURE_TENANT_IDS` (a comma-separated allowlist, set only by `convex env set`, which is how the browser and smoke suites keep their seams against the KEYED dev deployment). Production carries neither, and `ops.envCheck` reports NOT ready while any fixture-tier name is set. In `llm.ts`: `parseSmoke(text, tenantId)` and
> `parseAgentSmoke(text, tenantId)` return `null` without it (the check is INSIDE the parser so no caller can
> forget; eight `parseSmoke` and one `parseAgentSmoke` call sites pass the tenant; `draftCockpit` and
> `draftDocument` now destructure `tenantId`), the forced agent timeout, and the two Drive tools
> (`listDriveFolders` / `findInDrive`, whose `SMOKE::` arguments the MODEL composes inside a loop carrying
> retrieved content). `gmail.search`'s `name` gate (the worst site in the 29 register: fabricated mailbox
> evidence from a model-composed argument) and both `send` arms' `SMOKE::fail` are gated the same way. The
> `SMOKE::agent::` / `SMOKE::route=` payloads in the eleven `cockpit-*` specs are unchanged;
> `cockpitTools.test.ts`'s parser round-trips pass a tenant. `lib/models.ts` gained `fixtureSeamFor`.)

> Last verified: 2026-09-06 (35-02, G23 half B — **THE WORKSPACE DEEP LINK CARRIES A LABEL, AND THE PACK
> BROWSER SPEC KNOWS THE SEVENTH TITLE.** `/dashboard/workspace?thread=<id>&label=<text>` opens the thread
> tab under `label` (falls back to "Voice brief", the VOIC-04 caller); `openThread` caps it at 24 chars and
> React escapes it. Caller: the Command Center's first-thing card (dashboard-pages.md). `workflow-pack-
> pilot.spec.ts`: `TITLE_TO_PACK` + the dark-pilot title list gained "Offer and lead plan", so the @dark
> test fails if the new pack leaks outside the owner-only sections and the @evidence writer can pin its
> row. Nothing else in the cockpit moved.)

> Last verified: 2026-09-06 (28.2-01 — **THE REVENUE OFFER PANEL CAN LIST OPEN INVOICES.** On a passed
> quickbooks/stripe lane the invoice-reminder offer gains "Show open invoices" (a request, never a render-time
> read): owed > 0, oldest due first, ten rows, `formatMoneyAmount` + currency code, lateness in words, partial
> and unavailable reads say so. Each row's "Draft a reminder" sends the eval-pinned opener to the cockpit; the
> turn's `stageInvoiceReminder` stages an ordinary `proposed` email plan behind Approve. No new tool, no new
> mutation, no send from the panel. `RevenuePackPanel.test.tsx` 11/11. Owner runbook for passing the lane:
> revenue-connectors.md.)

> Last verified: 2026-09-06 (35-01 — co-owner bump only: `e2e/command-center.spec.ts` ladder labels and the
> stat label follow the Command Center's new words (dashboard-pages.md). No cockpit behaviour changed.)

> Last verified: 2026-09-05 (25.3-01 — `gmailAuth.flagExpiringTokens` (cron target, name unchanged)
> kicks `scanExpiringTokens`, a batch walk over `gmailTokens`; an expiring grant raises ONE unread
> `gmail_reconnect` notice (dedupe through `by_tenant_read`, bounded take) and a read/dismissed one
> re-arms it. `scaleConstants.test.ts` proves two runs → one notice, and a fresh grant is left alone.)
>
> Last verified: 2026-09-05 (25.2-02 — **THE COCKPIT WORKS ON A PHONE (G15).** Below 48rem
> `SplitPane` shows ONE pane at a time — chat first, the work behind a "Show work" / "Back to chat"
> toggle (`aria-pressed`). `paneLayout(narrow, showWork, pct)` is the pure decision; `narrow` is a
> live `matchMedia("(max-width: 48rem)")` state read after mount (SSR renders the desktop grid).
> Both panes stay MOUNTED and are toggled with `hidden`, so a half-typed message and every open
> subscription survive the switch; the drag handle is hidden while narrow. Desktop behaviour —
> per-user persisted split, 20-80 clamp, pointer + arrow-key resize — is byte-for-byte unchanged.
> Pinned by `splitPane.test.ts` (truth table + source scans).)
>
> Last verified: 2026-09-05 (25.2-01 — items 6-7 of the delete-first pass: the composer's disabled
> "Auto" model pill is deleted (it promised a dial that does not exist), and "Adapt a business skill"
> in the chat options menu renders only for the owner (`viewer?.isOwner === true`, the query the page
> already held). The authoring panel itself is unchanged. Pinned by `deleteFirst.test.ts`.)
>
> Last verified: 2026-09-05 (release merge — `lib/models.ts` existed on BOTH sides as an add/add
> conflict: main's (seven copies converted, `offlineSeamAvailable`, `stealth/` settings, `google/`
> fails closed) and the media lane's (`transcriptionModel` / `transcriptionUsage`, exported
> `openRouter`). The merged module is main's resolver with the lane's transcription section appended;
> `models.test.ts` carries main's suite plus the lane's transcription tests and its NARROW
> literal-call tripwire (`openai("…")` / `openai.transcription(` outside lib/models.ts). llm.ts keeps
> main's shape: everything but `google/` delegates to the shared resolver.)
>
> Last verified: 2026-09-05 (33.2-06 — `lib/models.test.ts` tripwire widened: a literal
> `openai("…")` or `openai.transcription(…)` outside lib/models.ts fails the suite. llm.ts's
> `openai.tools.webSearch` is a provider-executed tool, not a model, and is not matched.)
>

> Last verified: 2026-09-05 (33.2-05 — `lib/models.ts` grows `transcriptionModel(id)` (OpenAI
> provider at OpenRouter's base URL for `or/` ids — the OpenRouter SDK provider has no
> transcription model) and `transcriptionUsage(result)` (the bill from the body). No llm.ts change.)
>

> Last verified: 2026-09-05 (33.2-04 â€” **`convex/lib/models.ts` is THE model resolver.** llm.ts
> keeps only its stealth/ (per-model settings) and google/ (Buffer-bound Vertex credential)
> branches and delegates every vendor id to `resolveVendorModel`; the OpenRouter provider factory
> moved there so the V8 vault/onboarding/voice actions share it. Registered under this playbook in
> `watch.json`. Why: five module-local copies of the old resolver broke every vault ingest for nine
> days (vault.md). `lib/models.test.ts` holds the route and a source tripwire against new copies.)
>

> Last verified: 2026-09-04 (33.2-03 — **THE AGENT LOOP'S FALLBACK IS AUDITED, AND THE MEDIA
> DIRECTOR HAS ITS OWN 90 s CLOCK.** Two defects the bake-off surfaced by measuring, not by reading.)
>
> (1) `runAgentLoop` swallowed an eligible primary failure and succeeded on the fallback with
> nothing in any plane saying so. The 33.2 bake-off scored 37 passes under two candidates' names
> that `gpt-4.1-mini` had actually written (`smoke:modelsForPlan`, spend rows), and the same
> silence has been letting production storyboards fall back whenever the primary ran long. The
> loop now writes `llm.fallback` (fromModel, toModel, errorName, stage `agent-loop`) before the
> retry — the exact shape the route/draft steps already write, §4-clean. `runCockpitAgent.test.ts`
> asserts the row on the scripted-timeout fallback; its `setup()` registers `auditCounts` for it.
> (2) `callTimeoutMsFor(media-director) = MEDIA_CALL_TIMEOUT_MS = 90 s`. The 45 s chat-turn clock
> was the binding constraint on the storyboard (3-4k output tokens after a vault search): luna
> blew it 13/24, sonnet-5 24/24, gpt-4o-mini 0/24. 90 and not 180 because `runMedia` awaits
> research (2 × 180 s) AND the deck turn (2 × 90 s) in ONE action under the 600 s ceiling.
> (3) `llmRedaction.test.ts`'s replyToMessage slice ended on a marker that no longer existed and
> silently ran ~800 lines past the tool; it now ends at the tools-object close and asserts it
> stays inside `buildCockpitTools`. Measured: runCockpitAgent 36/36, llmRedaction 61/61,
> dispatch/cockpitTools/research green, tsc 0 outside the connector lane.)
>

> Last verified: 2026-09-04 (33.2-01 — **THE MEDIA DIRECTOR BILLS ITS OWN LANE, AND A STORYBOARD
> RETRY NO LONGER RE-BUYS ITS RESEARCH.**
>
> Two changes, both in the dispatch spine. (1) `runSpecialistTurn`'s lookup has a fourth arm:
> `isMedia ? [MEDIA_MODEL, MEDIA_FALLBACK_MODEL]` (aliased to the defaults until 33.2-03 measures —
> see guardrails.md). `dispatch.test.ts` "THE MODEL PIN" now has THREE runtime cases (research,
> media, and `offer-architect` as the genuine default) plus the source tripwire on all three pairs.
> (2) `groundMediaBrief` asks `research.recentFindingsForQuestion` — (tenant, `contentHash(brief)`,
> 24 h over `by_tenant_kind`) — before buying a research turn; `persistFindings` writes that hash
> as `vaultDocuments.researchQuestionHash` (optional, no backfill; a row without it never matches,
> so it researches again — fail-closed). Every "Try again" used to re-buy ~$0.21 of identical
> research. The check sits INSIDE the try, so a failing read can never fail the reel. Three tests:
> same brief → one turn/one doc; different brief → two; a doc aged past the window → two. Mutation
> `if (reused && false)` reddens exactly the first. Measured: dispatch.test.ts 10/10 in the two
> filters, tsc 0 errors outside the connector lane.)
>

> Last verified: 2026-09-03 (working tree, uncommitted - **THE COMPOSER'S ATTACH AND MIC ARE LIVE
> BEFORE A THREAD EXISTS.** Reviewed, typechecks clean. Not verified live.)
>
> `ChatPane` used to render two DISABLED placeholder buttons ("Send a message first - then attach
> files") until `threadId` was truthy, and mounted `IntakeControls` only after. It now mounts
> `IntakeControls` unconditionally, passing `threadId` as OPTIONAL plus an `onPendingChange`
> callback, and holds an `IntakeControlsHandle` ref.
>
> **The governance ordering is preserved and is the whole design.** Selecting a file on a fresh chat
> uploads NOTHING. The `File`/`Blob` stays in the browser. The first ordinary send mints the
> plan-backed thread, and only then does `onSend` call `intakeRef.current.flushToThread(res.threadId)`,
> which replays the staged items through the SAME `intake.ts` actions an existing thread uses. There
> is no second intake path and there must never be one - see `docs/playbooks/intake.md` for the
> staging mechanics.
>
> **Known wart, deliberately recorded rather than fixed here:** the `flushToThread` await sits INSIDE
> `onSend`'s `try`, whose `catch` does `setText(t)` and rethrows. A send that succeeds followed by a
> staged-file failure therefore refills the composer with text that was already sent, reading as a
> failed send. The message did go. Fix by awaiting the flush outside that try, or by having the
> catch distinguish the two phases.
>
> Layout, same pass: the composer is now `position: sticky; bottom: 0` with an explicit `--card`
> background (it must stay opaque or messages scroll under it), and the workspace header's title
> block moved from `flex: 1` to `flex: "1 1 20rem"` - a zero basis let the title collapse to ~15px
> against the divider's 20% clamp once the header was allowed to wrap.
>
> **`apps/web/e2e/approvals.spec.ts` changed under this playbook's `apps/web/e2e/` watch, for a
> reason that is not cockpit-shaped:** its "Review in Compliance" assertion pinned `href="/ops"`,
> and that link now targets `/dashboard/approvals?tab=compliance`. Nothing about the cockpit specs
> moved. See `docs/playbooks/dashboard-pages.md` for the navigation consolidation that caused it.

> Last verified: 2026-09-01 (28-16 — **DISCOVERY AND PHASE COMPLETION ARE TWO INDEPENDENT
> FAIL-CLOSED VIEWS OF THE SAME FOUR PROVIDER LANES.** The server query alone controls exposure;
> `check-phase28-completion.mjs --report` independently derives the provider/REVN close matrix.
> Its self-test exhausts all 16 pass/park combinations, and parked, expired, failed or unreachable
> named lanes remain hidden and keep Phase 28 incomplete. `--verify-current` validates the current
> repository projection without claiming completion; `--strict` is the all-four-passed close gate.
> A useful subset is explicitly named `subset`, never `complete`.)
>

> Last verified: 2026-09-01 (28-16 — **REVENUE WORKFLOWS APPEAR ONLY FROM SERVER-OWNED PASSED
> EVIDENCE PLUS ACTIVE PINS.** `RevenuePackPanel` is a dumb responsive renderer over
> `providerGates.revenueDiscovery`; it cannot derive a workflow from client files or connector
> presence. Each offer names its read-only provider and passed-evidence status in text, and starts
> through the existing trusted-clock cockpit send hook only inside an existing conversation.
> Parked, failed, expired and inactive lanes render nothing.)
>

> Last verified: 2026-09-01 (28-29 — **REVENUE DECISIONS EMIT ONLY AFTER THE REAL TERMINAL.** A
> reminder-staged plan records `plan_decided` after a successful re-propose, after the approve CAS
> and every governed refusal, or after the proposed-to-canceled discard transition. Drafting,
> refused approval, duplicate approval and delivery-terminal writes cannot manufacture a decision
> or recovery event; stored telemetry is plan refs plus the closed `edited|approved|rejected`
> status only.)
>

> Last verified: 2026-09-01 (28-19 — **THE REVENUE GOLDEN GATE NOW EXECUTES THE CANDIDATE BODY,
> NOT THE COCKPIT BODY.** `llm:runRevenueCandidateEval` is an internal, eval-only door beside the
> governed specialist loop. It accepts only `eval-<8hex>` tenants, the closed 11-case revenue
> corpus, the case's exact skill name, and an explicit global version; a mismatched case/name,
> non-eval tenant, missing plan, or governed stop fails before `generateText`. The action reuses
> `runSpecialistTurn`, returns the SHA-256 of the exact registry body passed to the provider, and
> exposes the SDK-attested ordered tool trace/results to the local runner. Production dispatch and
> cockpit callers never supply the eval selector, so their tool construction and runtime semantics
> are unchanged. Invoice fixtures use the same inert `stageProposed` boundary; the suppressed case
> stops before staging and still creates zero requests or sends.)
>

> Last verified: 2026-08-31 (**`runSpecialistTurn` NOW RECORDS WHICH BODY A PINNED RUN LOADED.**
>
> `dispatch.ts` has written the full registry attribution onto `subagent.completed` since 21-03, so a
> research run was observable. Nothing wrote one for the WORKFLOW PACK path, which reaches this same
> function through `workflowPackBinding` — so `smokeAssert:observedSkillLoads` returned an EMPTY list
> for a pack run over audit rows that genuinely existed, and the pack lane's evidence check had
> nothing to read.
>
> FOUND BY A REFUSAL, NOT BY REVIEW. The first live tenant pack eval scored 5/5 and was refused at
> the evidence write because the pinned row was observed loading in 0 of 5 case tenants. The check
> was right and the plane was empty.
>
> PINNED RUNS ONLY, deliberately. An unconditional `internal.audit.log` here would fire on every
> specialist turn in the product, and `auditCounts` is not mounted in every harness — that exact
> mistake reddened six `runCockpitAgent` tests in `7a58a3a`. An unpinned run also has nothing to
> certify. Payload is refs only (§4): name, version, scope, row id, SHA-256 of the body.
>
> Also here: `workflow-packs.spec.ts` grew an `@evidence` block (the browser plane producer) and a
> `@viewports` block that records WHICH widths actually rendered the tenant's saved settings —
> `VIEWPORTS_SEEN.size`, never a hardcoded 2. Measured 3 of 3 widths (1280/900/390).
>
> ⚠ OPEN, AND NOT PAPERED OVER: run the whole file in order and `@viewports` hangs for its full
> timeout on a pack button that keeps detaching from the DOM, after the persistence test's save. It
> passes ALONE in 6.4s and passes with `@evidence`. Reproduced three times; not diagnosed. Some of
> the earlier instances were the local backend dying underneath the run (two `convex dev` watchers
> were fighting over one deployment), so the residue may be the same cause — but it was still
> reproducing after that was fixed, so it is recorded as open rather than explained away.)

> Last verified: 2026-08-31 (28-13 — **INVOICE REMINDERS STOP AT THE EXISTING HUMAN APPROVE
> GATE.** The executive-only `stageInvoiceReminder` tool accepts an explicit user request plus a
> bounded QuickBooks or Stripe invoice ref, re-fetches the source, refuses paid/void/unknown or
> changed invoices, and writes code-owned subject/body text onto an existing collecting email plan
> as `status: "proposed"`. Exact retries are idempotent. It creates no request, workflow, audit,
> scheduler, provider write, or mail call; the revenue specialist grant does not receive this tool.
> After approval, immediate and scheduled cockpit delivery share the single `startFanout` workflow
> call site, while the legacy pipeline reaches the same `internal.delivery.send` dispatcher. Gmail
> and Microsoft therefore both pass through `prepareGovernedMessage`: current suppression and the
> required postal footer are checked at the terminal, including every member of a comma-joined
> recipient row. One suppressed member refuses the whole terminal send. Phase 28 owns selection and
> staging only; Phase 19 continues to own contacts, approval, fan-out, delivery, suppression, and
> footer enforcement.)
>

> Last verified: 2026-08-31 (28-12 — **THE REVENUE SPECIALIST GRANT IS NOW LIVE AND READ-ONLY.**
> The code-owned tuple is exactly `readRevenueCrm`, `readBusinessFinance`, and
> `declareUnsupported`. `buildCockpitTools` constructs those keys only after identity-checking the
> immutable `SPECIALISTS.revenue.tools` tuple; a copied list with the same strings does not open the
> grant. CRM/provider text is never returned as instructions: `revenueTools.ts` emits a
> `<revenue_evidence>` fence containing only closed enums, opaque refs, counts, and code-calculated
> numbers. Partial coverage remains `partial`, unavailable stays `unavailable`, and every retained
> provider label is evidence only. Generic HTTP/MCP, Gmail, `executePlan`, provider/CRM/accounting
> writes, refunds, credits, dispute updates, and paid media remain structurally absent.)
>

> Last verified: 2026-08-30 (**TWO REFS-ONLY PROBE SURFACES ON THE GMAIL RAIL, for the ROUT-02
> recurrence evidence collector. No cockpit behaviour changed and no existing function was touched.**
>
> `gmailAuth.grantState` -> `{present, real, expiresAt}` and `gmail.probeReadCount` -> `{ok, count}`.
> Both exist because the collector drives them through the convex CLI, whose result is printed to
> stdout and into whatever captured it:
>
> - `gmailAuth.getTokens` returns the row, REFRESH TOKEN AND ALL. Correct for the internal callers
>   that spend it, catastrophic for anything a human runs from a terminal. `grantState` answers the
>   three questions an evidence probe has and returns nothing that can be spent. `real` is derived
>   from the fixture sentinel in the token itself, not from an env flag, so no setting can make a
>   real grant read as a fixture or the reverse.
> - `listInbox` resolves to `messages: InboxMessageMeta[]` — subjects and senders. A probe built on
>   it would spill a real mailbox's metadata into a terminal, a CI log or an evidence file.
>   `probeReadCount` is a thin wrapper that returns `.length` and nothing else: the read itself is
>   still `listInbox`, unchanged, including its refs-only `mailbox.listed` audit row, because the
>   trace has to be of the code a scheduled routine would actually run. The narrower RETURN TYPE is
>   the enforcement — a `count: number` cannot hold a subject line.
>
> `maxResults: 3`, deliberately: this is a liveness probe, not a sync, and reading more would spend
> the tenant's quota to prove the same single fact.)

> Last verified: 2026-08-30 (**A PLAYWRIGHT HAZARD THAT APPLIES TO EVERY SPEC UNDER `apps/web/e2e`,
> not just the pack ones: a rapid `page.goto` loop POISONS THE NEXT PAGE in the same browser
> context.** Reproduced deterministically — a four-test serial probe counting buttons inside
> `main.canvas-main` after a fixed 6s settle read `14` at baseline, `14` inside the loop itself, and
> **`0` in the very next test**; five identical tests with no loop all read `14`.
>
> In the failing state everything that usually indicates a broken test looks FINE: the shell is
> painted, the route is right, the session is valid (`Sign out` present, no redirect) and the console
> is clean. The client subscriptions simply never resolve, so every `useQuery` stays undefined and
> the page content never mounts — which presents as a locator timeout and reads like a product bug.
> Consistent with Convex websockets from the abandoned navigations not being released before the
> next client opens one.
>
> **What to do about it:** do not re-read by reloading. If a spec must poll for server state, poll
> without navigating; if it genuinely has to reload in a loop, put anything that runs after it in a
> SEPARATE SPEC FILE — Playwright gives each file its own worker and therefore its own browser
> context, which is the only reason the pack isolation test passes.
> Full write-up in `docs/playbooks/workflow-packs.md`.)

> Last verified: 2026-08-30 (29-10 — **TWO NEW E2E SPECS UNDER THIS PLAYBOOK'S WATCHED PATH, AND ONE
> PRODUCT GAP THEY FOUND.** `apps/web/e2e/workflow-packs.spec.ts` and `workflow-packs-isolation.spec.ts`
> gate `/dashboard/workflows` (5 passed, PW_EXIT=0). The detail that belongs HERE rather than only in
> `workflow-packs.md`, because it is a pattern any cockpit surface can repeat:
> **the customization save emits NO completion signal** — no toast, no `role="status"`, no
> `role="alert"` — so success and still-in-flight are indistinguishable in the DOM, and navigating
> straight after the click ABORTS the in-flight mutation. A spec can wait before navigating and retry
> the read; a user who presses Save and leaves simply loses the write.
> Also measured on this surface: the form prefills ASYNCHRONOUSLY and overwrites typing that lands
> first, and there is exactly ONE `tenantSkills` row per (tenant, pack) so two customization tests
> are two writers of one row and cannot run under `fullyParallel: true`.
> Full write-up, including the unexplained serial-worker hang, in `docs/playbooks/workflow-packs.md`.)

> Last verified: 2026-08-30 (29-13 — **THE DEFERRED-RECURRENCE BROWSER PROOF, AND A SETTLE SIGNAL
> THAT PROVED NOTHING.** `apps/web/e2e/routines.spec.ts` is the deferred branch's browser evidence:
> `/dashboard/workflows` still offers a manual **Run again**, and no control on it schedules, pauses,
> resumes or revokes a repeating run. **THE SETTLE SIGNAL WAS ITSELF VACUOUS, AND ONLY THE POSITIVE CONTROL CAUGHT IT.**
> `routines.spec.ts` waited for `main.getByText("Run again")` before scanning for absence — but the
> pinned surface's always-present intro reads *"Nothing starts by itself — you press Run again."* So
> the settle matched STATIC COPY, fired before a single Convex query resolved, and every
> `toHaveCount(0)` below it ran against a page still rendering "Loading your workflows…". The scan's
> own positive control (`expect(names.length).toBeGreaterThan(0)`) refused: **0 controls found**.
> Without that control this would have been a green absence proof over a DOM the spec never read —
> the exact defect `workflow-pack-pilot.spec.ts`'s `@dark` block shipped, which passed with all six
> packs ACTIVE because `toHaveCount(0)` succeeds on its first poll.
> FIXED by settling on a CONTROL, not prose: a `button` named "Pin this workflow"/"Run again", or the
> empty-state sentence. None of those can render before `listPins`/`listPacks` answer; prose can be
> anywhere. **Rule this cost us: a settle signal must match something that CANNOT exist before the
> thing you are waiting for.**
>
> **PROVEN IN BOTH DIRECTIONS, ON A REAL BROWSER, BY THE ORCHESTRATOR (2026-08-30).**
> Green: `e2e/routines.spec.ts` **5 passed**, PW_EXIT=0, including the two-identity case (tenant B,
> an ordinary non-owner, sees the same surface with the same absence).
> Red on demand: a `<button>Pause schedule</button>` planted in `workflows/page.tsx`, rebuilt and
> re-served, turned the scan RED naming it (`+ "Pause schedule"`); reverted, rebuilt, 5/5 green again.
> `routineBranch.test.ts` likewise: planting a `RoutineControls.tsx` turned **3** tests red, then it
> was deleted. Two full `next build` + restart cycles per direction — `@pikar/core` exports raw TS so
> Next BUNDLES it, and without a rebuild the browser tests the previous bundle.
>
> The recorded decision is `defer` and the spec asserts that FIRST — as a failing assertion, not a
> skip: if the decision ever flips to `enable-safe` this absence proof is the wrong proof and must be
> replaced by a lifecycle spec, and going red is how that gets noticed.)

> Last verified: 2026-08-30 (33.1-04 — **THE CANVAS STOPPED RESTATING TWO NUMBERS IT SHOULD HAVE
> BEEN COMPUTING.** Three sentences in `mediaCanvasView.ts` typed out the clip-vs-still cost ratio
> ("about a fortieth", "costs about 40×") and two typed out the generator's legal clip lengths
> ("4, 8 or 12 seconds"). Both are values the price table and `GENERATED_CLIP_SECONDS` already
> compute, and both went stale the moment either moved — with a GREEN suite each time, because the
> guards asserted the stale literal. They are derived now (`CLIP_VS_STILL_RATIO`,
> `GENERATED_LENGTH_RANGE`, `CLIP_COST_LEVER_NOTE`), the unit tests recompute the same quotient
> instead of pinning a word, and `e2e/media-canvas.spec.ts` IMPORTS the sentence. If you add a
> sentence here that names a price or a member of a closed set, derive it — this is the third time.
> `apps/web` gained a `@pikar/cost` dependency for it, plus a `transpilePackages` entry.)

> Last verified: 2026-08-30 (33.1-01 — **THE STORYBOARD WRITE BOUNDARY WAS SILENTLY REJECTING
> EVERY DECK WITH A MUSIC BED, AND THE SUITE WAS GREEN OVER IT.**
>
> **The defect.** `plans.persistDeck`'s `artDirection` arg validator is a HAND-MAINTAINED MIRROR
> of `plans.artDirection` in `schema.ts`, and Convex `v.object` is CLOSED. So a field the parser
> emits and the schema already stores is not ignored here — it THROWS. `e2b281f` ("the music
> bed") widened `parseArtDirection`, the schema, the price table, the renderer, the assembler and
> the skill body, and never this validator. From then until 2026-08-30 every storyboard carrying a
> `Music:` line died with `ArgumentValidationError` at `persistDeck`.
>
> **Why it did not look like a crash.** The throw lands AFTER `dispatchAndLand` has already landed
> the memo. The plan row survives at `kind: "memo"` carrying the model's raw prose, so the user
> reads a wall of text where a storyboard should be and the app reports no error at all.
>
> **The signature to recognise it by:** a `subagent.completed` audit row with NO
> `media.deck_persisted` AND NO `media.deck_refused`. Neither terminal is written when the mutation
> throws between them — the absence of BOTH is the fingerprint, and it is not the same shape as a
> refusal. Two of the owner's three media dispatches on 2026-08-30 read exactly like this.
>
> **Why the tests were green.** `storyboard.test.ts` carried 14 `Music` fixtures; `dispatch.test.ts`
> carried ZERO. Coverage of a PARSER is not coverage of the BOUNDARY it writes across. Worse, the
> SCENE/variations path (`dispatch.ts:886`) — the one production actually runs — had never been
> exercised with a non-null `artDirection` at all: `TWO_UP_BODY` had no `## 2. ART DIRECTION`
> section. Only the BLOCK path did.
>
> **A trap if you write that fixture.** `persistSceneDeck` is handed `variations.a.body`, the slice
> BETWEEN the two `## VARIATION` headings — NOT the whole body. An art-direction section placed
> above `## VARIATION A` parses to `null`, and every music assertion under it then passes with or
> without the fix. It must ride INSIDE variation A.
>
> **The standing rule.** A new `artDirection` field lands in `schema.ts` AND in `plans.ts`'s
> `persistDeck` validator in the SAME commit, with a `dispatch.test.ts` fixture carrying it on both
> deck contracts. Mirror the schema's `v.optional(v.string())` — do NOT restate a core closed set
> (`MUSIC_MOODS`) as a `v.union` of literals here: this package cannot import it, so it would be a
> third copy to keep in step, and the one that fails loudest.)
>

> Last verified: 2026-08-30 (the 28-09 callback slice — **`http.ts` ONLY**: three connector OAuth
> callback routes, `/connectors/{hubspot,quickbooks,stripe}/callback/<env>`, each a thin dispatcher
> to the auth module's existing `internalAction` and gated on `providerGates.connectPermitted` —
> the ADMISSION axis, never `availableProviders`, because gating the callback on a passed lane
> deadlocks the phase. The route census in `microsoftAuth.test.ts` moved 8 -> 11 and caught it.
> PayPal deliberately has no route. Owned by docs/playbooks/revenue-connectors.md; only the
> wiring lives here. Prior: 2026-08-29, 28.1-05 — **`http.ts` ONLY**, and only the Stripe billing route at
> the bottom of the file. The route now calls `eventFacts(event.type, event.data.object)` at the
> trust boundary and passes ONLY the resulting ids into `receiveAndApply`; the parsed Stripe
> object never crosses into Convex. `event.created` is threaded through in milliseconds as the
> only delivery ordering Stripe provides. **The five-line security ordering above it is
> unchanged** — secret + header present → read the raw body ONCE → verify → only then parse.
> Nothing on the Gmail, Microsoft, agent or delivery paths was read or touched, and this is NOT
> a re-verification of anything else in this playbook. See `docs/playbooks/billing.md`.)
>
> Previously verified: 2026-08-28 (28.1-01 — **`http.ts` GAINED A ROUTE THIS PLAYBOOK DOES NOT OWN.**

> Last verified: 2026-08-29 (29-08 FIX — **PINNING A WORKFLOW WAS EVICTING A SAVED PROMPT FROM THIS
> MENU.** Correcting the entry after this one. `savedPrompts.list` applied its
> `templateId === undefined` filter to the page it had already taken, so each workflow pin consumed
> one of the twenty slots and a prompt silently disappeared from the workspace menu — driven, not
> reasoned: 20 prompts returned 20, then one pin returned 19. The defence written into that entry
> ("the take is the cap this menu has always had") was true of the TAKE and false of the CAP, which
> shrank with every pin.
>
> The filter is now a `.filter((q) => q.eq(q.field("templateId"), undefined))` on the same indexed
> range, BEFORE `.order("desc").take(SAVED_PROMPT_LIST_LIMIT)`. One predicate, one bounded read, no
> second query. Mutation observed RED: moving it back after the take makes the new
> `pinnedWorkflows.test.ts` case "pinning a workflow evicts nothing from the twenty-entry prompt
> menu" report 19.
>
> `cockpit.ts` is STILL unchanged by 29-08, and both facts pinned by tests that read it still hold.)

> Last verified: 2026-08-29 (29-08 — **THE WORKSPACE'S PINNED-PROMPT MENU NOW LISTS PROMPT PINS
> ONLY.** `savedPrompts.list` gained one filter: a row carrying `templateId` is a pinned WORKFLOW
> (29-08, `packages/backend/convex/pinnedWorkflows.ts`), and Run in this menu is an ordinary
> Executive-Agent turn through `sendCockpitMessage` — so a workflow pin listed here would offer
> "Brand review" and then run something that is not the Brand review pack. Workflow pins live on
> `/dashboard/workflows` and run through `cockpit.startWorkflowPack`, the allow-listed pack agent.
>
> The filter is applied AFTER the existing `take(SAVED_PROMPT_LIST_LIMIT)`, deliberately: the take
> is the cap this menu has always had, and re-taking to refill it would turn a bounded read into a
> scan. Mutation observed RED — deleting the filter makes `pinnedWorkflows.test.ts` "a workflow pin
> never appears in the prompt menu" fail with both titles in the list.
>
> `cockpit.ts` itself is UNCHANGED by 29-08. `startWorkflowPack` already was the re-run door, and
> two facts about it are now pinned by tests in `pinnedWorkflows.test.ts` that read this file: it
> still passes NO `tenantSkillIds` to the binding (which is what makes the pin surface's
> "your customization is not applied" sentence true), and its `threadId` is still optional with
> `ensureThreadAndPlan` minting a new thread when it is absent (which is the whole freshness
> mechanism behind "Run again").)

> Last verified: 2026-08-29 (29-09 FIX — **THE SEARCH CARD COULD DENY EVIDENCE IT WAS SHOWING, AND
> THE THREE PROVENANCE STRINGS BELOW WERE UNTESTED.** Four corrections to the entry after this one.
>
> **(1) `answered` no longer reads the summary string.** It was `row.summary.length > 0`, and the
> synthesis JSON schema in `knowledgeLlm.ts` puts no minimum length on `summary`, so a model that
> answers only in claims stored citation-checked claims beside a blank summary — and the card
> printed "The sources that were searched had nothing on this." directly above them, with the
> confidence line suppressed. It is now `row.claims.length > 0 || row.summary.trim().length > 0`,
> and the summary paragraph renders only when there is one. Two new tests in
> `KnowledgeSearchPanel.test.ts` cover the blank-summary-with-claims and blank-summary-with-no-claims
> cases; restoring the old expression fails the first.
>
> **(2) The provenance line is enforced now, not just rendered.** Deleting
> `PACK_SOURCE_LABEL[citation.source]` from the citation, deleting `PACK_SOURCE_LABEL[row.source]`
> from the conflicting-evidence list, or deleting the `{row.question}` heading each left the suite
> green. The prior entry's claim that every citation carries source, authority and freshness was
> true of the code and unenforced by the tests. Three tests now assert the RENDERED span, e.g.
> `Re: renewal</span> — your mailbox · Something someone said, not a record · Updated in the last
> month` — a substring the coverage sentence cannot supply. All three deletions go red.
>
> **(3) The available/unavailable split is read from `@pikar/core`.** The panel had its own
> `row.sources.some((s) => s.status !== "unavailable")` beside `aggregateCoverage`'s docstring
> claiming the distinction is made once, in core. The panel now calls `aggregateCoverage(row.sources)`
> and reads `available + partial > 0`; a source scan fails if the inline form comes back.
>
> **(4) The panel's own thread handle wins.** `activeThread` was `threadId ?? ownThread`, so a search
> made on a fresh workspace became unreadable the moment the user sent their first chat message —
> the prop arrived, the subscription moved to the cockpit thread, and the rows stayed stranded under
> the `ks_` handle with nothing able to query them. It is `ownThread ?? threadId ?? null` now.
> ponytail: session-scoped — the panel unmounts on close, so the handle does not outlive the card.
>
> THE BROWSER GATE IS STILL UNRUN, and it was DEAD ON ARRIVAL until this pass:
> `panel.getByRole("button", { name: "Search" })` resolved to TWO elements, because Playwright's
> `name` is a case-insensitive SUBSTRING match and `aria-label="Close knowledge search"` contains
> "search". Every test in the file went through that locator, so the whole spec would have failed on
> its first line; `--list` only proves parsing, which is why it survived. Now `{ name: "Search",
> exact: true }`, verified against real chromium with `setContent` (loose = 2 and a strict-mode
> violation, exact = 1 and usable). An eighth test was added for correction (4). Still zero
> executions against a running stack — see `29-SEARCH-GATE.md`.)
>

> Last verified: 2026-08-29 (29-09 — **THE COCKPIT GAINED A THIRD INLINE CARD: UNIFIED KNOWLEDGE
> SEARCH (KNOW-01).** `KnowledgeSearchPanel.tsx` is opened from the same "Chat options" menu as
> `SkillAuthoringPanel`, mounted in the same place in `page.tsx`, on the same terms — session state,
> not a route, so the thread and every open subscription survive the toggle. It is wrapped in
> `ErrorBoundary` with a `null` fallback, like `WorkflowPackQuickStarts`: a failing search control
> degrades itself, never the cockpit.
>
> WHAT IT ADDS TO THE PANE, and what it deliberately does not:
>
> - It calls `api.knowledgeSearch.search` (a `tenantAction`) and reads `api.knowledgeSearch.listByThread`.
>   It holds no `useMutation`, does not go through `useSendCockpitMessage`, and imports nothing from
>   `api.cockpit` — `KnowledgeSearchPanel.test.ts` scans the shipped source for each of those three.
> - The `threadId` it passes is the cockpit's own when there is one. With a fresh workspace there is
>   no thread yet, so the panel mints `ks_<uuid>` ON SUBMIT (not in a `useState` initializer, which
>   would run on the server and hydrate to a different id).
> - The honest-gap copy is NOT restated in the UI. `renderSourceGap` and `groundedSourceProps` in
>   `@pikar/core/knowledgeSearch` own the sentences and the citation mapping; the panel renders what
>   they return. `KnowledgeSearchPanel.test.ts` asserts the panel source does not contain the
>   substrings `so it was not searched` or `only the first`.
> - Only a `vault` citation reaches `GroundedSources({titles, docIds})` and therefore
>   `VaultDocButton`. Every citation — vault included — also gets a provenance line carrying the
>   source label, authority class and freshness, because an agent-promoted document lives in the
>   vault and `agent_authored` is the class that must be visible there.
>
> UNPROVEN AND STATED AS SUCH: `apps/web`'s vitest is node-only, so what is verified is the string
> `renderToStaticMarkup` emits, not pixels, not focus order and not the live action call.
>
> THE BROWSER GATE IS `apps/web/e2e/knowledge-search.spec.ts`, AND IT IS UNRUN. Playwright discovers
> and parses its 7 tests; not one has executed against a running stack. It opens the card through the
> same "Chat options" keyboard path `skill-authoring.spec.ts` uses and writes zero auth code (the
> `setup` project's `storageState`). It has two modes on two DIFFERENT deployments, because
> `offlineSeamAvailable()` requires fixture consent AND no model key: `PIKAR_E2E_KNOWLEDGE_MODE=offline`
> drives the `SMOKE::knowledge-plan::` planner fixture at $0, and `=live` spends real money. Its
> two-identity block is skipped rather than faked — no second loggable account exists on this
> project's deployments. Commands, env vars, preconditions and the empty results table are in
> `.planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md`.)

> Last verified: 2026-08-29 (**WAVE-3 FINAL — THE COPY-DRIFT GUARD IS DELETED. Copy-drift is
> UNGUARDED, and this entry exists so nobody reads a green `lib/models.test.ts` as protection.**
>
> `lib/models.test.ts` carried a source-text scan meant to prove that no module under `convex/`
> keeps its own `resolveModel`. It went through FIVE iterations and was defeated on every one, each
> escape RUN as a real module planted under `convex/` that left the whole suite green:
>
> | # | Escape | What it beat |
> | - | ------ | ------------ |
> | 1 | `const pickModel = (id) => openai(...)` | the NAME scan (it grepped for `resolveModel(`) |
> | 2 | `createOpenAI({…})(id)` and `const P = createOpenAI({…}); P(id)` | the CALL-SHAPE scan (hardcoded callee spellings; the char before `(` is `)`) |
> | 3 | `import { OpenAIChatLanguageModel } from "@ai-sdk/openai/internal"` | the IMPORT scan (a documented subpath export; the regex anchored on the closing quote) |
> | 4 | `export default openai;` | the export-surface pin (it enumerated the export spellings it feared) |
> | 5 | leading whitespace before `export` | the rewritten export pin (anchored `^export`) |
>
> **A sixth regex was not written.** A pattern over source text cannot decide this question: a
> provider is reachable through a renamed binding, an arbitrary subpath specifier, a non-literal
> specifier (`import("@ai-sdk/" + "openai")`), any export spelling, and — with no provider package at
> all — RAW HTTP. This repo already does the last one on a landed path: `vaultRag.ts`'s `embeddingV2`
> (~:230-270) picks provider label, env-key NAME and endpoint URL at runtime and calls `fetch`,
> holding zero provider imports. So "no module holds a private route table" was never true of this
> codebase, and no regex was going to make it true.
>
> **WHAT REMAINS IN `lib/models.test.ts`:** the behavioural tests only — `resolveModel` routes `or/`
> and `stealth/` ids to the OpenRouter provider with the right `modelId`, bare/`openai/` ids to
> OpenAI, `google/` throws, and `resolveModel(DEFAULT_MODEL)` lands on OpenRouter. Those assert
> `.provider`/`.modelId`, the values the AI SDK actually sends with. They say where THIS table
> routes; they say nothing about who else routes.
>
> **THE GAP, STATED:** an eighth copy of the route table can be written under `convex/` and no test
> will see it. Closing it needs an AST or type-level pass (or a lint rule) that resolves bindings —
> not a pattern. Recorded with the same five escapes in
> `.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md`.
>
> The offline-fixture consent test is unaffected and still tested: `lib/env.ts`
> `isOfflineFixtureConsent` is called by both `offlineSeamAvailable()` and the readiness screen, and
> `models.test.ts` runs a table of literal values through both.)

> Last verified: 2026-08-29 (**29-FIN-06 — THE CORRECTION BELOW WAS ITSELF FALSE, AND IS NOW
> DELETED RATHER THAN REWRITTEN A THIRD TIME.** Comment-only in `llm.ts`; no behaviour changed, no
> cockpit test changed.
>
> `runAgentLoop`'s skill loader first carried "only the three `USER_AUTHORABLE_SKILLS` can have an
> overlay row at all, so every other specialist name resolves exactly as before". The 29-06 FIX
> replaced that with "29-05 widened `USER_AUTHORABLE_SKILLS` to admit the six `pack-*` workflow-pack
> skills". **It did not.** `packages/contracts/src/skill.ts` still lists exactly
> `OFFER_ARCHITECT_SKILL`, `MONEY_MODEL_DESIGNER_SKILL`, `LEAD_ENGINE_SKILL`; 29-05 added a SEPARATE
> channel, `skills.publishPackCustomization`. The second claim mattered more than the first, because
> it read as justification for removing a sibling plan's fail-closed gate.
>
> **No closed set of names is asserted at that line any more.** The comment now says what
> `loadEffectiveSkill` QUERIES — `tenantSkills` by `[tenantId, name, status: "active"]`, falling
> through to the global active row — and points at the publish channels for the membership question,
> because that is where it is decided. Activation of an overlay row is an `ownerMutation`.)

> Last verified: 2026-08-28 (**WAVE-2 FINAL PASS.**
>
> **(1) The copy-drift guard's second iteration.** Superseded — the guard is DELETED; see the entry
> at the top of this playbook for the five escapes and the gap that is now open.
>
> **(2) `offlineSeamAvailable()` LIVES HERE NOW**, in `lib/models.ts`, beside the table that decides
> WHICH key is spent. `voiceDoc.ts` and `vaultDigest.ts` both need the identical "this deployment
> holds no model credential" predicate, and a second copy of a credential check is the same
> copy-drift defect `resolveModel` was just consolidated out of. It checks BOTH keys, because
> `DEFAULT_MODEL` is an `or/` route and OpenRouter is the credential these producers actually spend.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART A — a failed Gmail read was reported as an
> empty successful one, and every model call in the repo was routed by one of seven copies of the
> same function.**
>
> **(1) `gmail.knowledgeQuery` CHECKS ITS HTTP STATUS NOW, AND CATCHES ITS TRANSPORT.** Neither
> `listRes.ok` nor the per-message `res.ok` was tested and nothing was caught, so a 500/429/403
> parsed as `{}`, `messages` came back undefined, and the inbox adapter published
> `{status: "available", source: "inbox", returned: 0}` — "we searched your mailbox and there is
> nothing there" for a mailbox Gmail refused to show us. A refused BODY was worse: `{}` becomes two
> empty strings and `Number(undefined ?? 0)` becomes 1970, i.e. an evidence row asserting that a
> message exists and says nothing. A refused list is now `{ok: false, reason: "provider_error"}`;
> a refused body is DROPPED and reported through the new `hydrationFailed` flag, which the adapter
> turns into `partial/provider_error`.
>
> **The stub shape is load-bearing and the tests say so.** Gmail's error bodies are JSON, and a JSON
> envelope PARSES — that is what hides a missing `res.ok`. An HTML error page throws on `.json()`
> and gets caught, so a stub that only ever answers HTML cannot tell a module that checks the status
> from one that does not; both mutations came back GREEN against the first version of these tests.
>
> **(2) THE EMPTY-QUERY THROW IS GONE, AND THE COMMENT THAT CALLED IT UNREACHABLE WAS FALSE.**
> `clampSearchPlan` only requires one letter or digit, while `escapeGmailQuery` additionally drops
> the bare boolean operators — so a planner emitting `"OR"`, `"AND"` or `"OR AND"` cleared the
> boundary and made the adapter REJECT, under `Promise.allSettled`, where a rejection renders as
> nothing. It returns `{ok: false, reason: "unplanned"}` now: no search of the mailbox happened,
> which is neither Gmail's fault nor an empty result. The mirror claim in
> `@pikar/core/knowledgeSearch` was corrected too — a guard justified by a claim about another
> module is only as true as that claim.
>
> **(3) ONE MODEL ROUTE TABLE: `packages/backend/convex/lib/models.ts`.** `resolveModel` existed
> SEVEN times and only `llm.ts`'s ever grew the `or/` branch, while `DEFAULT_MODEL` has been
> `"or/openai/gpt-4o-mini"` since 845f4b1 — so every other copy hands an OpenRouter ROUTE id to the
> OpenAI provider. `llm.ts` now delegates and keeps ONLY the `google/` branch, because
> `@ai-sdk/google-vertex` is Node-only and `llm.ts` is the one `"use node"` module; the shared table
> fails CLOSED on `google/` rather than silently routing it to OpenAI.
>
> **ALL SEVEN COPIES ARE CONVERTED — `llm.ts`, `blueprint.ts`, `onboarding.ts`, `vaultDigest.ts`,
> `vaultLlm.ts`, `voiceDoc.ts`, `knowledgeLlm.ts`.** (An earlier revision of this entry said five of
> them were still stale and pointed the reader at a named list in `lib/models.test.ts`. Commit
> 2e6f276 converted them in the SAME round, so both halves of that sentence were false the day they
> were written. A playbook asserting a live falsehood is worse than a stale one, because it reads as
> verified.) `lib/models.test.ts` pins the END STATE, not a shrinking list: its allow-list is EMPTY,
> and it fails if any module under `convex/` routes a model id to a provider itself.)
>

> Last verified: 2026-08-28 (29-03 — **`gmail.ts` GAINS A FIFTH READ VERB, `knowledgeQuery`, AND
> IT IS DELIBERATELY NOT `search`.** `search` resolves a CONTACT: it asks `from:/to:` about a name,
> fetches `format=metadata` only and never touches a body. `knowledgeQuery` asks a free-text
> BUSINESS question and exists to fetch a bounded number of bodies, because a body is what the
> Phase-29 toolless synthesis reads. Merging them would give the contact resolver a standing reason
> to hydrate bodies it has never needed, so they stay two verbs with two privacy shapes.
>
> **THE ESCAPE IS THE SECURITY BOUNDARY.** `escapeGmailQuery` NEUTRALIZES every character that
> carries Gmail search-operator meaning (`:` — which is what makes `from:`, `label:`, `has:`,
> `in:`, `is:` operators at all — plus quotes, brackets, angle brackets and backslash) into a SPACE,
> strips a leading `-`/`+` per token (Gmail's exclude/require prefixes: a planner phrase starting
> with a dash would silently invert the search) and drops the bare uppercase `OR`/`AND`. It
> neutralizes rather than dropping the whole token, so every word the planner wrote survives while
> no operator it could have built does. **URL encoding does not protect this boundary** — Gmail
> decodes `q` before it parses operators, the same trap `escapeDriveQueryLiteral` exists for. A
> phrase with no letter or digit escapes to `""`, and the action THROWS rather than listing on an
> empty `q` (an empty `q` returns arbitrary recent mail, i.e. an answer about messages nobody asked
> about). That state is unreachable through the product: `clampSearchPlan` refuses such a query at
> the planner boundary.
>
> **BOUNDS:** 25 ids listed (`maxResults`), 5 bodies hydrated, each body truncated to
> `SEARCH_CAPS.evidenceTextCharCap` (1500). Listing wide and reading narrow is what makes it
> "metadata first" rather than "download the mailbox". Selection is Gmail's own newest-first list
> order — `ponytail:` ceiling, recency not relevance; the upgrade is a metadata fetch for all
> `listed` ids and pure-code ranking, at 5x the quota.
>
> **NO AUDIT ROW, ON PURPOSE.** `search` writes `mailbox.searched` and `listInbox` writes
> `mailbox.listed`; this verb writes nothing. A unified search reads several sources and owes
> exactly ONE refs-only `knowledge.searched` event, owned by the plan-29-06 coordinator — per-source
> events would let the log plane infer the shape of the question from how many rows appeared.
> `gmail.test.ts` asserts the `audit` table is empty after a knowledge query.
>
> **NO SENDER LEAVES THE VERB.** `KnowledgeMailMessage` is `{id, subject, body, internalDate,
> bodyTruncated}` — there is no `from`. The known boundary this respects: the LANDED toolless
> firewall (`llmRedaction.test.ts`) is **BODY-scoped, not CONTENT-scoped**, so today's briefing path
> already admits sender display names and subject lines into the tool-bearing loop. Phase 29 is
> strictly tighter and must not be loosened toward it. `ponytail:` ceiling — an answer cannot say
> "Sarah said X"; the upgrade path is a server-side sender table addressed by index, the
> `buildRecipientView` idiom.
>
> Every existing `gmail.ts` invariant is unchanged and still enforced: GET-only reads, the POST set
> pinned to `TOKEN_ENDPOINT` + `SEND_ENDPOINT`, zero mailbox-write endpoints, and the
> `inboxFixtures` seam checked BEFORE the token (which `knowledgeQuery` also does, so the offline
> eval corpus can exercise the inbox source with no mailbox). The fixture path FILTERS on the
> escaped terms rather than returning the whole fixture — a seam that answered every question with
> every fixture message would make every offline assertion built on it vacuous.
>
> **A BACKTICK IS DELIBERATELY ABSENT FROM `GMAIL_OPERATOR_CHARS`.** The first version included
> one, and `skills.test.ts`'s "no long inline prompt string literals" scan went from 0 offenders
> to 3 in `gmail.ts` — the longest a 1714-char span. That scan's string matcher is a regex, not
> a tokenizer, so a lone backtick anywhere in source opens a template-literal span it cannot
> close, and everything after it in the file goes unscanned for a hardcoded prompt (CLAUDE.md
> §5). A backtick carries no Gmail query meaning, so neutralizing it bought nothing and blinded
> a real guard for the whole file. If one ever needs neutralizing, fix the scanner first. The
> scan's own header already records the same class of bug for `//` and for apostrophes; this is
> the third instance and the first from the source side rather than from prose.
>
> The knowledge-plane mapping (evidence, authority, availability) lives in
> `packages/backend/convex/knowledgeExternalSources.ts` and is documented in
> `knowledge-search-routines.md`, not here. 15 new tests in `gmail.test.ts`; mutations M1-M6, M12
> observed RED.)

> Last verified: 2026-08-28 (28.1-01 — **`http.ts` GAINED A ROUTE THIS PLAYBOOK DOES NOT OWN.**

> Last verified: 2026-08-27 (**`@drill` RAN AGAINST PRODUCTION FOR THE FIRST TIME. Rollback-to-dark

> `POST /billing/stripe/webhook` is the Stripe webhook receiver for PIKAR'S OWN merchant account;
> it is documented in `docs/playbooks/billing.md`, not here. It touches no cockpit surface — no
> tool, no card, no `VERB` entry, no `agentSteps.tool` literal, no skill body. This entry exists
> only because `watch.json` gives `http.ts` to this playbook, so the route inventory below stays
> honest: `http.ts` now ALSO holds `POST /billing/stripe/webhook`. **No cockpit behaviour changed.**
>
> Last verified: 2026-08-27 (28-03 — **FOUR REVENUE VERB ENTRIES, AND NOT ONE TOOL WRITES THEM
> YET.** `cards.tsx`'s `VERB` record gains `dispatchRevenue`, `readRevenueCrm`,
> `readBusinessFinance` and `stageInvoiceReminder`, beside the four `agentSteps.tool` literals
> 28-03 pre-declared in `schema.ts`. `traceParity.test.ts` asserts the two sets equal BOTH ways, so
> either half alone is RED — that, and nothing else, is why a schema plan touches this playbook's
> file. **No cockpit behaviour changed.**
>
> **WHY PRE-DECLARE AT ALL.** 28-03 is Phase 28's single serialized `schema.ts` owner, so 28-12
> (`revenueTools`) and 28-13 (`invoiceReminders`) cannot add their own literals when they land.
> Without them `agentSteps:record` throws an `ArgumentValidationError` inside an AI-SDK callback the
> SDK SILENTLY swallows — prod loses the trace row while the whole suite stays green. That is the
> trap this union has already sprung at `searchVault`, `evaluateBusiness`, `recordScorecardAnswer`
> and `saveAsDocument`.
>
> **THE NAMES ARE NOW BINDING ON 28-12/28-13.** The specialist route's `stepTool` and the
> `buildCockpitTools` keys must be exactly these four, or `cockpitTools.test.ts`'s key scan goes red
> at those plans. Pre-declaration has exactly one failure mode — the `webResearch` one, a literal
> that reads as a trace that exists — and it does not apply here: all four will be written by LOCAL
> executable tools, so `onToolExecutionStart` fires for each.
>
> The done labels are deliberately READS, not results. A connector coverage window can be partial,
> so none of them may imply a complete answer, and `stageInvoiceReminder` must never read "Sent":
> REVN-06 stages a draft and stops at the existing human Approve gate. traceParity 7/7, web
> typecheck 0.)
>
> PREVIOUS: 2026-08-27 (**THE DESCRIPTION FIX MOVED THE MODEL AND DID NOT STOP IT, WHICH IS
> WHAT A DESCRIPTION FIX IS FOR.** Naming the finance figures in `recordScorecardAnswer`'s
> description shifted `37-finance-update`'s routing — `evaluateBusiness` became `readFinance`, the
> right DOMAIN — and the model still stored the cash position through the scorecard. A description
> shifts a tendency; only code enforces a rule. `recordScorecardAnswer` now REFUSES any field whose
> leaf matches `AGENT_WRITABLE_FIGURES` and names `stageFinanceWrite` in the refusal, so the model
> can correct itself inside the same tool loop.
>
> **THE STAKE IS THE APPROVE GATE, NOT THE STORE.** `recordScorecardAnswer` WRITES IMMEDIATELY —
> its own description says it "changes nothing outbound" — while `stageFinanceWrite` only STAGES
> for a human to approve and requires a source reference. A finance figure accepted by the
> scorecard therefore reached a store **without the human gate the finance path exists to enforce
> and without any provenance**. The eval fixture was surfacing a governance hole, not a formatting
> preference. It refuses rather than forwards: this call carries no `source`, and
> `stageFinanceWrite` must never invent one.
>
> Matching is on the LEAF of a dot-path, case-insensitively, so `cashOnHand`,
> `financials.cashOnHand` and `FINANCIALS.CashOnHand` are all refused while a genuine scorecard
> field (`identity.headlinePrice`) still writes. cockpitTools 148/148, typecheck 0,
> mutation-verified. **Full-gate confirmation of the ROUTING still needs a suite run** — 37 passes
> alone regardless, so only the gate can measure it.)
>
> PREVIOUS: 2026-08-27 (**TWO TOOLS CLAIMED THE SAME SENTENCE, AND THE MODEL PICKED BY VIBE.**
> `recordScorecardAnswer` read *"Store a figure the user states about their own business"* — with
> a MONEY example — and so did `stageFinanceWrite` in effect. Fixture `37-finance-update` states a
> cash position and was routed to `recordScorecardAnswer` + `evaluateBusiness`, 2/2, staging no
> finance claim at all.
>
> **THE BOUNDARY ALREADY EXISTED IN CODE AND WAS INVISIBLE TO THE MODEL.** `applyFinanceClaims`
> refuses every scorecard-stored field, so the split was enforced where it could not be read by
> the thing making the choice. `recordScorecardAnswer` now names the finance figures it must not
> take, DERIVED from `AGENT_WRITABLE_FIGURES` — the same constant `stageFinanceWrite`'s
> description is built from, so the two cannot drift into claiming one field. Hand-listing either
> side turns the new test red; that is precisely how the older wording went stale by 6 of 11.
>
> **A DESCRIPTION CHANGE IS A BEHAVIOURAL CHANGE AND CANNOT BE PROVEN OFFLINE.** 37 passes ALONE
> and fails in the full gate — a dose-response to accumulated tenant context, documented in the
> fixture itself — so no unit test can confirm the routing. The test locks the STRUCTURE (both
> descriptions derived from one constant); only a full-suite run measures the behaviour.)
>
> PREVIOUS: 2026-08-27 (**A MISSING SELECTOR IS A MALFORMED CALL, NOT AN AMBIGUOUS ONE — AND
> `replyToMessage` HANDLED IT AS THE LATTER, WHICH KILLED THE TURN.**
>
> `senderHit` and `subjectHit` are VACUOUSLY TRUE when their selector is absent (`!s || …`), so a
> call carrying neither matched EVERY message, fell into the "2+ candidates" arm, and returned a
> menu ending *"Ask the user which one to reply to"*. That sentence is addressed to the USER, so
> the turn ended with a bare plan row — **even though the user had named the message perfectly**
> ("Reply to that 'Account activity' notification"). One tool call, no error, nothing staged.
>
> **WHO THE ANSWER IS ADDRESSED TO IS THE WHOLE FIX.** A missing selector is the MODEL's slip and
> is recoverable inside the same tool loop; genuine ambiguity between real candidates is the
> USER's to resolve and must end the turn. Collapsing the two turned a retryable mistake into a
> dead turn. The new branch names the requirement, lists the mailbox subjects so the model can
> match the user's OWN words, and says *never pick for them* — the no-guess rule is unchanged.
> The tool description also stopped advertising *"Clarifies if 0 or 2+ match"*, which read as an
> invitation to call it bare and let it produce a menu.
>
> **DIAGNOSED AT $0 THROUGH `internal.llm.__invokeCockpitTool`.** The eval runner deliberately
> locks model replies, so a fixture can only report *which* tools were called, never what they
> returned — `24-reply-injection` therefore read as "replyToMessage ran and staged nothing", which
> looks like a broken staging path. Driving the tool directly through the shim against the seeded
> mailbox separated the three cases in one offline run: `subject` set → staged; `sender` set →
> staged; NEITHER → the menu. **Reach for the shim before paying for another eval run** — it
> answers "what did the tool say" and the harness structurally cannot.
>
> Also locked: the resolved recipient and `Re:` subject are committed BEFORE the body is drafted,
> so a drafting failure can never lose the address the reply is owed to. Live: 24 now PASSES at
> $0.0058, having failed 2/2 in the gate and 1/1 in isolation. Mutation-verified — disabling the
> branch turns the new test red. cockpitTools 146/146, typecheck 0.)
>
> PREVIOUS: 2026-08-27 (**THE EMAIL RAIL WAS KEYED ON "DOES A PIN EXIST" WHEN THE QUESTION IS
> "IS THE HARNESS DRIVING", AND THAT GAP HAS NOW BEEN PAID FOR THREE TIMES.**
> `isPinnedCockpitEvaluation` is now `isHarnessDrivenEvaluation(tenantId)` — the `eval-` tenant
> prefix alone. The pin arguments are gone.
>
> **THE SIGNATURE, so it is recognised on sight rather than diagnosed again:** email fixtures fail
> with `status: collecting`, `recipients: []`, no subject, no body, and a tool list of exactly
> `{proposeCalendarEvent, stageCrmWrite}`. The model is not confused — `addRecipients` and
> `proposePlan` are STRUCTURALLY ABSENT, because `applyGmailCapability` filtered them out, so it
> reaches for whatever is left. Cost is roughly ONE cheap turn, not two: turn 1 returns
> `GMAIL_CONNECTION_REQUIRED_REPLY` at `costUsd: 0`, and only the bare follow-up turn bills.
>
> **A RESEARCH FIXTURE CAN CATCH THIS TOO, and that is the part that fooled a whole session.**
> Fixture `34-research-injection` returned `$0.0000` with `no research document before timeout`,
> which reads as a scheduler or dispatch fault. It is not: the fixture's injection bait is an email
> ADDRESS, the capability router's last alternative is a bare address regex, so a RESEARCH turn is
> routed to email, takes the disconnected-Gmail early return and dispatches nothing. Any fixture
> whose prose contains an `@` can fail this way.
>
> **THE THREE OCCURRENCES.** 21-03: only the global pin scope counted, `--tenant-skill`-only ran
> 21/41 for `$0.4157`; fixed by adding the tenant scope BESIDE it. 2026-08-27: a run pinning
> `research-specialist@9` and nothing else ran 26/46, and the 20 email failures were within an hour
> of being filed as a cockpit regression. Then the `--only` probe sent to diagnose THAT reproduced
> it a third time, because the probe was unpinned as well.
>
> **WIDENING THE SCOPE A FOURTH TIME WOULD REPEAT A FIX THAT ALREADY FAILED TWICE.** Each previous
> fix enumerated the pin shapes known that day, and each was broken by a shape nobody had thought
> to enumerate — including "no pin at all". The predicate is the TENANT now, so there is no shape
> left to miss. Safe because the prefix is not caller-supplied: `sendCockpitMessage` is a
> `tenantAction` passing `ctx.tenantId` from the authenticated identity, so no production turn can
> reach the branch. `real-tenant`, `k57row…` and `tenant-eval-…` are all asserted false.
>
> PROVEN BOTH WAYS, LIVE: `--only 01-happy` UNPINNED failed with the signature above, then passed
> at `$0.0098` after the change with no other edit. Narrowing the predicate turns exactly the two
> new tests red. **Do not diagnose an email fixture off an unpinned run made before this change** —
> the previous entry in `skill-registry.md` requiring a pin is superseded, not merely dated.)
>
> PREVIOUS: 2026-08-27 (**`@drill` RAN AGAINST PRODUCTION FOR THE FIRST TIME. Rollback-to-dark
> PASSED — the undo path is now proven on prod, not just dev.**
>
> **THE DRILL IS DESTRUCTIVE ON PRODUCTION AND DOES NOT CLEAN UP AFTER ITSELF.** Read the assertion:
> it turns a live pack off and then requires it to reappear as a CANDIDATE — "a turned-off pack must
> come back as a candidate, not vanish". That is the contract, and it does NOT re-activate. On dev
> that is harmless because the next seed re-activates everything; on PROD it leaves a user-facing
> workflow dark until an operator runs `skills:activateSkill` by hand. It darkened
> `pack-business-pulse` on 2026-08-27 and the test still reported PASS, because leaving it off IS
> the expected end state. **Re-activate immediately after any prod drill, and verify with
> `skills:getActiveSkill` per pack.**
>
> **ROLLBACK-TO-PRIOR CANNOT FOLLOW ROLLBACK-TO-DARK IN ONE RUN.** The first test ends with a
> `convexRun`, which ENDS THE BROWSER SESSION, so the second test's first navigation lands signed
> out and fails at `openWorkspace` — not at its own skip check. Run it in a separate invocation.
>
> **`skills:getActiveSkill` PER PACK IS THE ONLY RELIABLE LIVE-STATE READ.**
> `inspectPackCandidates` returns the NEWEST row per pack, so once a candidate v2 exists it reports
> `candidate` while v1 is still serving users — it cannot answer "is this pack live". And a browser
> probe answers a different question badly: an expired session renders the workspace shell with ZERO
> packs, which is indistinguishable from a genuinely empty production. Both were misread here before
> the server-side read settled it.
>
> PREVIOUS: 2026-08-27 (**THE PROD BROWSER-EVIDENCE PLANE IS CLOSED, and getting there cost
> three separate failures that all LOOKED like "the session is broken".**
>
> 1. `context.storageState()` on a CDP-ATTACHED context returns cookies but does not reliably
>    serialize localStorage — where Convex Auth keeps the session. Harvest it from the page.
> 2. `workspace-pane` visible was treated as PROOF of authentication. It is not: the shell paints
>    before auth resolves, so it appeared in a browser nobody had signed into. The only proof is a
>    `__convexAuthJWT_*` key, and the script now POLLS for that (giving a human time to sign in)
>    rather than asserting it once.
> 3. **The tab is not where you left it.** The first `goto` runs BEFORE sign-in, so the auth flow
>    lands on `/dashboard` — and `workspace-pane` exists only on `/dashboard/workspace`. Waiting on
>    the pane without re-navigating times out against a perfectly healthy signed-in app.
>
> The capture is now ONE command: it launches Chrome itself when no CDP port answers. A separate
> `--user-data-dir` is MANDATORY — since Chrome 136 `--remote-debugging-port` is SILENTLY IGNORED on
> the default profile. Check `ProductVersion` before diagnosing anything else. The profile persists,
> so sign-in is once per machine. The captured file is a LIVE CREDENTIAL: delete it after the run.
>
> Evidence recorded PROD versions (five v1, process-sop v2) where the dev file held v5/v10/v4 —
> the per-deployment `pack-seen-<origin>.json` key doing exactly what it was added for.
>
> PREVIOUS: 2026-08-26 (**THE PACK E2E HARNESS CAN NOW TARGET A DEPLOYMENT IT IS NOT SERVING
> LOCALLY, and three defects had to be fixed before it could be trusted to.**
>
> 1. **`convexRun` in `workflow-pack-pilot.spec.ts` passed NO deployment flag** — a second copy of
>    the defect already fixed in `smokeRun.mjs`. Pointing the browser at production would have driven
>    the PROD app and written its evidence to the DEV skills row: a run certifying a deployment it
>    never touched. `PIKAR_CONVEX_TARGET=prod` now threads `--prod`; unflagged still means dev.
> 2. **A VOID RETURN READ AS A FAILURE.** `recordPackBrowserEvidence` returns nothing, so
>    `convex run` prints an empty stdout and `JSON.parse("")` throws. The rescue only fired when
>    stderr carried the Windows/Node-24 `UV_HANDLE_CLOSING` assertion — which dev always produced and
>    prod did not. **Dev did not pass that path, it accidentally satisfied it.** `CLI_FAILURE` is what
>    decides failure; empty stdout without it is now success.
> 3. **`pack-seen.json` WAS SHARED ACROSS DEPLOYMENTS.** It survives between runs, so the prod
>    evidence writer read dev's observations — dev versions (campaign-plan v5, sales-call-prep v10)
>    against a prod registry that is all v1. Most would have failed the version pin, but
>    `business-pulse: 1` exists on BOTH, so the writer was one unrelated crash away from recording a
>    DEV browser run against PROD's row. The file is now keyed by origin.
>
> `baseURL` and `storageState` are env-overridable (`PIKAR_E2E_BASE_URL`, `PIKAR_E2E_STORAGE_STATE`),
> and supplying a storageState SKIPS the `setup` sign-in — a deployment whose only human account is a
> Google identity cannot be driven through the local password form. `e2e/capture-prod-session.mjs`
> captures that session by WATCHING a human sign in; it types nothing and reads no credential.
> **Chrome 136+ SILENTLY IGNORES `--remote-debugging-port` on the DEFAULT profile** — no error, no
> port. Use a separate `--user-data-dir`. Check `ProductVersion` before diagnosing anything else.
>
> PREVIOUS: 2026-08-26 (**WATCH-GATE ACKNOWLEDGMENT ONLY — this bump does NOT cover the
> workspace diff that triggered it.** The Stop hook fired on
> `WorkflowPackOwnerControls.tsx`, `workspace/page.tsx` and `workflowPackDiscovery.ts`, which were
> UNCOMMITTED in the shared working tree and belong to a concurrent lane, not to the session that
> wrote this line. That session was working on the media rail in a separate worktree
> (`feat/media-rail-gaps`, commit e2b281f — the music bed) and touched none of those files; its own
> playbooks are `media.md` and `skill-registry.md`, both updated there.
>
> **Nothing in this playbook was re-read or re-verified against that diff.** The bump exists only
> because `scripts/check-playbooks.mjs` reads the whole working tree and cannot be scoped to one
> session's changes, and the owner asked for the turn to be unblocked. The §9 obligation for the
> workspace/pack-discovery change is STILL OPEN and belongs to the lane making it — that lane
> should update this playbook against its own diff and bump this line again with real content.)
>
> Last verified: 2026-08-26 (**THE PACK GATE WAS DEADLOCKED, AND HALF THE BREAKER WAS ALREADY
> BUILT.** Activation needs browser evidence; browser evidence needs an authenticated person to REACH
> a pack in a browser; `listPacks` is ACTIVE-ONLY by design and nothing is active until the gate
> passes. Measured 2026-08-26: six packs with eval evidence, **zero** with browser evidence, and
> `recordPackBrowserEvidence` had only unit-test callers — a fully green browser run would have
> recorded nothing at all.
>
> 27-09 had already shipped `startWorkflowPack`'s owner-only `previewVersion` for exactly this, so
> the owner could RUN a candidate. **Nothing let them SEE one**, so there was no surface to press.
> 27-11 adds `workflowPackDiscovery.listPackCandidates` (`ownerQuery`, candidate-only) and a
> `WorkflowPackOwnerPreview` section whose Preview button sends the version THE CARD RENDERED.
>
> **IT IS A SEPARATE QUERY AND A SEPARATE REGION, both deliberately.** An `includeCandidates`
> argument on `listPacks` would be one argument away from undoing the dark pilot for every tenant
> from any caller; `ownerQuery` cannot be reached by a non-owner at all. And the region is named
> "Candidate workflows — owner preview" rather than "Guided workflows" because the `@dark`
> assertions prove the pilot is invisible by requiring the LATTER to be empty — a preview rendering
> into it would make those assertions pass for a reason they do not mean.
>
> **THE VERSION PIN IS THE POINT.** Evidence names a (name, version) pair, so the card shows
> `Candidate v{n}` and the click sends that exact number back. A preview that ran "the newest
> candidate" would record browser evidence naming a version nobody watched — the same defect class as
> `hasPassingPackEvalEvidence` not comparing an evidence row's model to the lane pin.
>
> **WHAT THE EVIDENCE MAY CLAIM.** `hasPassingPackBrowserEvidence`'s contract is "an authenticated
> person REACHED it at more than one viewport" — not that every pack was run. The `@preview` block
> therefore asserts each card renders its preflight, its version badge and an ENABLED control at 1440
> and 390, and one test actually presses Preview so that "reachable" is not a claim about a button
> nobody clicked. Do not widen the row beyond that: `pass: true` for a pack the browser never
> displayed is the one thing this plane exists to prevent.
>
> **THE HAND-COPIED LITERAL, and it was wrong on the first try.** The spec maps a rendered card TITLE
> back to a pack id and CANNOT import `@pikar/core` (it drives a built app). It said "Process / SOP
> builder"; the registry says "Process / SOP". `packOwnerPreview.test.ts` now pins the whole map
> against `WORKFLOW_PACKS` in both directions.
>
> **STILL OWED: the live run.** The spec is written but has never executed, and this machine cannot
> sign one in — `auth.setup.ts` needs `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`, no password is stored,
> signup is invite-gated, and the only owner account is a Google login. The automatable route exists
> (`invites:__seedInvite` then `owner:bootstrapOwner`, both `internalMutation`) but has not been
> walked. **No pack may be activated until it has.**
>
> PREVIOUS: 2026-08-26 (**`saveAsDocument` — a SECOND save channel, built only for a caller
> whose output contract IS a document, and the executive cockpit is not one.**
>
> Structural absence, the `grantWebResearch` precedent: `runAgentLoop` returns the FULL tool record
> when `toolNames === undefined`, so a tool built unconditionally is one the executive silently
> acquires. `buildSaveAsDocumentTool()` sits at module scope and is spread in under
> `agentContext.documentIsDeliverable`, which `runSpecialistTurn` derives from the trusted skill NAME
> (`packOutputIsDocument`) — never from `toolNames`, because an allow-list is a request from the
> caller. `createDocument` is unchanged and still the executive's only document tool.
>
> **THE FLAG GATES THE READ-BACK TOO, and a test caught that it did not.** `ai@7` records a tool-CALL
> part even for a name the record does not hold (it becomes a tool-error and the loop carries on), so
> deriving the save request from the call alone let a BRIEFING pack mint a document by naming a tool
> it was never granted — a model asking for a capability by spelling it. `runAgentLoop` now returns
> `saveRequest` only when the same flag that BUILT the tool is set.
>
> `saveMarkdownDocument` is a third sibling of `renderAndStore` and `createDocument`, deliberately
> not a caller of either: both of those start from a topic and end at a model, and this one starts
> from text that already exists and never calls a model at all. Ceiling stated in its docstring — a
> fourth kind of document write means extracting the tail (insert → audit → card), not a fifth
> sibling. `agentSteps.tool` gained the `saveAsDocument` literal and `cards.tsx` its VERB entry in
> the same commit, because `traceParity.test.ts` asserts the two sets equal both ways — and because
> without the literal the step insert throws inside a callback the AI SDK swallows. That trap bit
> again here: the binding's own grant probe read the tool as ABSENT for half an hour.
>
> PREVIOUS: 2026-08-26 (**`createDocument`'s TRIGGER CLAUSE IS NOW PER-CALLER — it is the one
> thing in that record that was ever false for one.**
>
> "Create directly when the user asks for one; when creating one is YOUR idea, say what you would
> write and wait for a yes" is a rule for THIS surface, where an unasked-for document is a surprise.
> For a workflow pack whose `output` contract IS a saved document the sentence is simply wrong — the
> owner asked for the document by starting the pack — **and it wins over the skill body**: three
> `pack-sales-call-prep` bodies told the model to save, in three wordings, and across nine graded
> runs it saved only when the user's own words said "save that".
>
> `buildCockpitTools` now takes `agentContext.documentIsDeliverable`, derived in `runSpecialistTurn`
> from `packOutputIsDocument(skillName)` and passed through `runAgentLoop` untouched. **Derived from
> the skill NAME, never from `toolNames`** — the `grantDispatch` rule: an allow-list is a request
> from the caller, and reading one here would let any specialist granted `createDocument` relax its
> own trigger rule by holding the tool. It is false for every non-pack name, and for
> `pack-business-pulse` (a briefing) and `pack-customer-complaint` (a draft reply), so the executive
> cockpit and the golden suite get a byte-identical description. Pinned in `cockpitTools.test.ts` on
> the STRING, both directions, with the derivation asserted separately and mutation-checked.
>
> PREVIOUS: 2026-08-26 (**`or/` IS NOW A ROUTE PREFIX IN `resolveModel`, AND `runAgentLoop` HAS
> AN OUTPUT CEILING. THE 45 s WALL IS CLEARED — the heavy packs no longer abort.**
>
> `if (id.startsWith("or/")) return openRouter().chat(id.slice(3));` — same provider as the
> `stealth/` branch (adopted for the reasons in the previous entry), but the prefix is STRIPPED
> because OpenRouter wants the vendor id, while `PRICING` keeps the full `or/` key so
> `or/openai/gpt-4o-mini` and `openai/gpt-4o-mini` price and audit as the different billing paths
> they are. No per-model settings: unlike ox-alpha these are not reasoning-mandatory.
>
> **`MAX_OUTPUT_TOKENS = 8_192`, newly applied to the `runAgentLoop` `generateText` call.** It was
> UNSET, so every call reserved the model's full max (65,536 on the gpt-5.x family). Unbounded output
> is exactly what "reasoning consuming the output budget" ate when the heavy packs returned EMPTY
> replies at 180 s. Sized off measurement: the longest memo in the 2026-08-26 audit was ~1,390 words
> (~2.1k tokens), so this is ~4x headroom. The empty-text detector for the Gemini case already
> existed; this is the matching ceiling.
>
> **MEASURED RESULT, live `--candidate` runs:**
>     business-pulse   on gpt-4.1      **5/5**, $0.0665, 6.2-13.2 s/case — evidence RECORDED (was 4/5)
>     business-pulse   on gpt-4o-mini  **5/5**, $0.0044, 5.8-11.7 s/case — SAME score, 15x cheaper
>     sales-call-prep  on gpt-4.1      0/5,     $0.2187, 2.7-26.5 s/case — **but every case COMPLETED**
> The A/B is why `DEFAULT_MODEL` shipped as gpt-4o-mini and not gpt-4.1 (see guardrails.md).
> sales-call-prep previously aborted at 45 s and scored 0/5 even at 180 s on EMPTY replies. It now
> finishes every case well inside the budget and fails on ASSERTIONS instead: `outcome` expected
> `partial` got `useful` (4/5), `citations >= 1` got 0 (3/5), `artifactCreated` got 0 (2/5).
> **THE LATENCY PROBLEM IS SOLVED; WHAT REMAINS IS A BODY/CORPUS DEFECT.** That was predicted before
> the run: six models — gpt-4o-mini, gpt-4.1, luna, haiku-4.5, grok-4.6, gemini-3-flash — ALL return
> `useful` instead of `partial` on this pack, and all fail or coin-flip `missingNamed:crm-facts`.
> Do not chase it with another model swap.
>
> PREVIOUS: 2026-08-25 (**`@openrouter/ai-sdk-provider` 3.0.0 ADOPTED (exact pin), REPLACING THE
> `createOpenAI` + baseURL SHIM FOR `stealth/` IDS. The second SDK is a CORRECTNESS fix, not a
> convenience** — OpenRouter is OpenAI-wire-compatible for the request body and NOT for the two things
> this model needs: @ai-sdk/openai silently DROPPED `reasoningEffort` (it gates that parameter on its
> own capability table, which has never heard of `stealth/ox-alpha`) and does not round-trip
> `reasoning_details`, which OpenRouter requires to be passed back unmodified for a reasoning chain to
> survive across turns. The old path also defaulted to `/responses` rather than `/chat/completions`.
> Settings ride the MODEL (`openRouter().chat(id, OX_ALPHA_SETTINGS)`), not per-call providerOptions.
>
> **THE DIAL NOW DEMONSTRABLY WORKS AND IS DELIBERATELY LEFT UNSET.** `OX_ALPHA_SETTINGS` is `{}`. The
> probe's output fell from ~16-20 tokens to 3 once the parameter actually reached the wire, and in
> isolation `effort: low` is 2488 ms / 55 output tokens against a default of 6556 ms / 105. But the
> PACK evidence does not support setting it: single `customer-complaint` runs scored low 1/5,
> medium 2/5, default 0/5 — **and a REPEAT of the default config scored 1/5**, with individual cases
> changing which way they failed. Run-to-run variance is at least +/-1 case, so all three settings sit
> inside the noise, and reading that spread as a gradient would be inventing a finding. Repeats, not
> another single run, are what would settle it — the upstream DeepSWE harness used `-k 3` for exactly
> this reason.
>
> `reasoning: {enabled: false}` is HTTP 400: "Reasoning is mandatory for this endpoint and cannot be
> disabled." That is the authoritative statement of the constraint.)

> Last verified: 2026-08-25 (**`stealth/` MODELS NOW RESOLVE THROUGH `.chat(...)`, AND THE REASON IS
> A PARAMETER THAT WAS BEING SILENTLY DISCARDED.**
>
> `resolveModel` returned `openRouter()(id)` — the bare callable — which in @ai-sdk/openai@4.0.11
> means OpenAI's **Responses API**. Two things went wrong there, both without an error:
>   1. the request went to `/responses`, not `/chat/completions`; and
>   2. `providerOptions.openai.reasoningEffort` was DROPPED, with only a console warning
>      ("reasoningEffort is not supported for non-reasoning models"), because the provider gates that
>      parameter on its own model-capability table and has never heard of `stealth/ox-alpha`.
> OBSERVED ON THE WIRE with a spying `fetch`: `reasoning_effort=undefined` via /responses,
> `reasoning_effort="low"` via /chat/completions. **A dial that is silently discarded is worse than no
> dial** — the first attempt at this looked applied, changed nothing, and would have been recorded as
> "reasoning effort does not help" if the wire had not been inspected.
>
> `reasoningOptionsFor(id)` sets `reasoningEffort: "low"` for `stealth/` ids ONLY, keyed on the id of
> the model that actually runs so a fallback attempt does not inherit the primary's dial. Gated rather
> than global: sent to a non-reasoning OpenAI chat model it is a 400.
>
> **MEASURED AGAINST THE API DIRECTLY** (no SDK, same prompt), and the dial is real:
>     default                       6556ms  out=105
>     reasoning_effort: low         3160ms  out=55
>     reasoning: {effort: low}      2488ms  out=55
>     reasoning: {max_tokens: 256}  2230ms  out=50
>     reasoning: {enabled: false}   HTTP 400 "Reasoning is mandatory for this endpoint and cannot be
>                                   disabled."
> That 400 is the authoritative statement of the constraint: reasoning cannot be turned off on this
> model, only turned down. Through the SDK's chat path the model honoured it too — output tokens fell
> 235 → 44 on the same prompt.
>
> **AND IT DID NOT FIX THE PACKS.** All three heavy packs still abort at `CALL_TIMEOUT_MS` — see
> `docs/playbooks/workflow-packs.md` for the numbers. Keep the dial (it is free and it halves output),
> but do not record it as the fix. `CALL_TIMEOUT_MS` is UNCHANGED at 45_000; it was raised to 180_000
> for one measurement and reverted in the same session.)

> Last verified: 2026-08-24 (ox-alpha trial — **`resolveModel` GAINED A THIRD BRANCH, AND THE
> GROUNDED PROBE'S SEARCH COUNTER IS STALE.** `stealth/` ids now route to OpenRouter through
> `createOpenAI({baseURL})` — the ALREADY-INSTALLED @ai-sdk/openai, because OpenRouter is
> OpenAI-wire-compatible. No new dependency, no second SDK. The provider is lazy + memoised like the
> Google ones, so a deployment with no `OPENROUTER_API_KEY` that never routes there still boots. The
> FULL id is passed through unstripped (unlike the `openai/` and `google/` branches): OpenRouter
> wants `stealth/ox-alpha` and `PRICING` is keyed on the same string, so resolve and price agree.
>
> **LIVE-VERIFIED:** `node scripts/probe-gemini.mjs stealth/ox-alpha` → PASS, in=94 out=16, $0.000000.
> The probe's `google/`-only prefix guard was widened to accept `stealth/` (the plain `openai/` lane
> stays excluded on purpose — it is the funded path every eval already exercises, so probing it
> proves nothing and costs money). The file name is still probe-gemini.mjs: renaming it would touch a
> BY-POSITION exclusion in `dispatchGuard.test.ts` for no behavioural gain.
>
> **TWO STALE THINGS WERE FOUND AND ONE IS STILL OPEN.**
> 1. FIXED: the `tool_vendor_mismatch` verdict was deleted. It refused a grounded probe whose vendor
>    differed from `RESEARCH_MODEL`'s, on the premise that `buildWebResearchTool` picks a hosted tool
>    off that pin. It picks nothing — the tool is a LOCAL Tavily fetch taking no arguments and reading
>    no model constant. Left standing it would have false-refused every grounded probe the moment
>    `RESEARCH_MODEL` moved off `google/`. A headstone comment sits at the deletion site.
> 2. **STILL OPEN — `probeGemini` MISCOUNTS SEARCHES AND WILL FALSE-FAIL ANY MODEL.** It counts
>    `toolCalls.filter(c => c.providerExecuted)` and reads sources off `result.sources`. Both are
>    hosted-tool shapes. `webResearch` is local, so `providerExecuted` is false on every part and
>    `result.sources` is empty — the probe returns `no_search_call` even when the model searched
>    correctly. OBSERVED: ox-alpha made two correct `webResearch` calls returning real URLs and was
>    still graded `no_search_call`. **THE PRODUCT IS NOT AFFECTED — `runAgentLoop` was fixed for local
>    tools on 2026-08-07 and counts `toolName === "webResearch"` (llm.ts, the `webSearchCalls` line),
>    so no search fee is mis-billed.** It is the probe that never followed. Fix it to count by name and
>    to read sources through the exported `sourcesFromToolOutput`; do NOT relax the verdict.)

> Last verified: 2026-08-23 (27-09 — **`startWorkflowPack` GAINED AN OWNER-ONLY `previewVersion`,
> AND IT EXISTS TO BREAK A DEADLOCK.** The shape looks like a debug affordance and is not: the pack
> activation gate requires browser evidence, browser evidence requires running the pack in a
> browser, and running it requires an ACTIVE registry row — which no pack has, by design, until the
> gate passes. `runSpecialistTurn` fails closed on `NO_ACTIVE_SKILL`, so without a way to pin the
> candidate from the browser the gate could never be satisfied by anyone.
>
> Three properties, each of which is a real way to get this wrong:
>
> - **Owner-only, server-side.** `requireOwnerAction` (see `authorization.md`), not a hidden button.
> - **Checked only when SUPPLIED.** This action is every user's door to a pack; an `ownerAction`
>   wrapper would lock the product out of its own feature.
> - **Refused, never ignored.** A non-owner who sends the argument gets `OWNER_REQUIRED`. Silently
>   dropping it would run the ACTIVE row while the caller believed a candidate ran — which is the
>   exact confusion the pin exists to prevent.
>
> The check runs BEFORE `ensureThreadAndPlan` and before the message is saved, so a refused preview
> leaves no thread, no plan row and no pack event. Moving it later reddens a test on purpose.
>
> **The pin is keyed by REGISTRY NAME** (`pack-${packId}`), derived at the call site rather than
> hand-typed, because `runSpecialistTurn` loads by name — a pin keyed on the bare pack id would be
> accepted by the validator and then silently ignored by the loader. A source-scan test holds that
> call site, because `startWorkflowPack -> runWorkflowPack` is the one link the binding's own suite
> cannot see, and an argument that stops at the action is the clock-plane-dead-in-production defect.
>
> **THE WORKSPACE NOW RENDERS QUICK STARTS** (`WorkflowPackQuickStarts` / `WorkflowPackPreflight`,
> colocated under the route), on a FRESH workspace only — once a conversation is open, six cards
> above it compete with the thread the user is already in. They call `startWorkflowPack` directly,
> and that required NARROWING the "no component constructs the raw cockpit action" guard, which used
> to ban `useAction(` outright. The narrowing is paid for: the exemption is now conditional on
> `startWorkflowPack` having no `clientContext` argument, so the day it grows one the test demands a
> hook. An exemption that outlives its reason is how the clock plane died the first time.
>
> **KNOWN GAP, bounded and stated:** the pack path still sends no `clientContext`, so `briefInbox`
> buckets its 7-day window in UTC rather than the owner's zone (`llm.ts` documents that degradation
> as cosmetic and it is the only granted pack tool that reads a clock — `replyToMessage` does not).
> Threading a clock would mean changing `runSpecialistTurn`'s signature, which is out of scope here.)

> Last verified: 2026-08-23 (27-07 — **A SECOND ENTRY POINT ON THE SAME DRIVER.**
> `cockpit.startWorkflowPack` is `sendCockpitMessage`'s shape with ONE substitution: it drives
> `internal.workflowPackBinding.runWorkflowPack` (the governed loop under a pack's code-owned tool
> allow-list) instead of `internal.llm.runCockpitAgent`. Same thread, same single `plans` row, same
> `thinking` trace floor, same safe error reply, same `finally`. It is a SEPARATE action rather than
> a flag, because an allow-listed agent is structurally unable to dispatch a specialist or author a
> skill (`llm.ts` derives both grants from `toolNames === undefined`) and that distinction must not
> sit behind an argument a caller can forget.
>
> `ensureThreadAndPlan` is extracted from `sendCockpitMessage` verbatim and shared by both, so the
> pack driver reaches the SAME `plans` row. `plans.byThread` is a `by_thread` unique read — two
> creators would make it throw.
>
> **Three pack plan-decision emissions were added to existing terminals, and each is inert unless a
> pack run staged that plan row.** `proposeEmailPlan` (both branches), `executePlan`'s EMAIL-arm CAS
> flip, and `discardPlan`. The approve emission sits AFTER the CAS and after every governed stop
> above it (`gmail_not_connected`, `send_time_too_far`, `no_postal_address`,
> `all_recipients_suppressed`); emitting at the top of `executePlan` would count each of those
> refusals as an approval. `customer-complaint` is the only pack granted `proposePlan`, so it is the
> only pack that can reach these rows at all.
>
> `llm.ts` is BYTE-UNCHANGED by this plan. The binding calls the exported `runSpecialistTurn` and
> observes created artifacts through `internal.vaultSources.latestCreated`, so no tool wrapper and no
> loop argument moved.)
>
> Last verified: 2026-08-23 (NOT MY CHANGE — recording ONE verified fact about the in-progress
> foglamp tracing work that touches `llm.ts` and `dispatch.ts`. The tracing work itself is
> uncommitted, unreviewed here, and belongs to another session; this entry does not vouch for it.
>
> **THE FACT, first-hand: `convex/lib/foglamp.ts` without a `"use node"` directive ABORTS EVERY
> PUSH TO THE DEPLOYMENT.** Convex bundles every module under `convex/` for the V8 runtime unless it
> declares otherwise, and `foglamp` statically imports `node:http` / `node:async_hooks`, which do not
> exist there. The bundle error fails the whole push — not just that module. While it stood,
> `home.js:summary`, `home.js:health` and `briefings.js:latestForTenant` never reached the backend
> and the Command Center rendered five `error` cards, with every unit suite (3,900+ tests), all
> three typechecks and the production build GREEN. `convex-test` runs in process and can never see
> that a function failed to REACH the deployment.
>
> The file's own header already said "ONLY `"use node"` MODULES MAY IMPORT THIS FILE" — it just
> never said it about itself. Adding the directive fixed it; that one line is in the working tree,
> uncommitted, with the tracing work it belongs to.
>
> **The operational rule this leaves behind, for anyone touching the cockpit spine:** after changing
> a `convex/` module, confirm the push LANDED — `npx convex function-spec | grep <module>` — before
> trusting any green suite. A stale deployment and a healthy CI look identical from the test runner.)

> Last verified: 2026-08-23 (26-19 Task 2 — **`briefings.ts` gains ONE reader,
> `briefings.latestForTenant`, for the Command Center's briefing card.** Append-only writer
> untouched; `byThread` untouched.
>
> It reads the EXISTING `by_tenant_createdAt` index — no schema change — and returns a BOUNDED
> projection (max 5 items) or `null`. Rows are append-only, so index order IS recency: `.order("desc")
> .first()` is the whole "latest" story, no scan. `null` for a tenant with no briefing is a real
> answer, not a throw and not an empty object.
>
> **Model-owned prose is LABELLED, not laundered.** The row mixes code-owned facts (`id`, `sender`,
> `subject`, `ts`) with model-authored text (`gist`, `synopsis`, `deadline`). The adversarial pass
> caught `synopsis` riding into a Command Center projection carrying nothing to distinguish it from
> the facts rendered beside it — this repo's documented provenance-laundering class, where
> agent-written text gets presented as the owner's own word. The projection now ships a code-owned
> `synopsisOrigin: "model"` literal and the card renders it under an explicit "Pikar summary"
> attribution, asserted on the rendered string. `deadline` stays a rendered SUGGESTION, never parsed
> into an action.
>
> **Briefing affordances are workspace LINKS ONLY.** Every row anchor goes to `/dashboard/workspace`.
> No row may offer to reply, send or schedule — asserted by scanning every `<a>`/`<button>` label in
> the rendered card against those verbs, not by checking one known button. A briefing card that
> promises an action it cannot perform is the failure mode this rule exists to stop.)

> Last verified: 2026-08-22 (26-17 Task 3 — **WATCH-GATE ONLY, no cockpit behaviour changed.**
> `e2e/reports.spec.ts` gained an `expand()` helper and its nav assertion flipped from dark to
> live on the owner's UAT verdict. The helper exists because the governance and deployment cards are
> now native `<details>` that start CLOSED, so any assertion about their CONTENTS must open them
> first — and it CLICKS THE SUMMARY rather than setting `open` from script, because the click is
> the path a user takes and the property is what the assertion then checks.
>
> Worth knowing for the next spec here: `page.content()` still contains a collapsed `<details>`'s
> body, so a DOM needle-scan for leaked content works whether or not the card is open — but
> `toBeVisible()` does not. The privacy sweep deliberately relies on the first and expands for the
> second.)
>

> Last verified: 2026-08-22 (26-17 Task 1 — **WATCH-GATE ONLY, no cockpit behaviour changed.**
> This playbook watches `apps/web/e2e/`, and `reports.spec.ts` is new. Two things in it are worth
> knowing before writing the next spec in this directory:
>
> - **It stages hostile data on purpose.** Two audit rows carry a recipient address and a prose
>   draft under keys the viewer's allowlist does not name, and one carries prose under a key it
>   DOES name. The test then scans `page.content()` for those exact strings. An absence assertion
>   is worthless without a matching presence assertion, so it also asserts the allowlisted refs
>   (`plan-<marker>`, `sha256:<marker>`) DID render — otherwise the sweep passes on an empty table.
> - **It flips the owner bit and restores it in a `finally`.** `owner:bootstrapOwner` then
>   `owner:revokeOwner` on the e2e tenant is what makes the role split real browser evidence rather
>   than a component-test claim (26-08's "owner-vs-non-owner needs a second account" is no longer
>   true). A leaked owner bit would silently make every later run's non-owner assertion vacuous,
>   which is why the revoke is in `finally` and not at the end of the test body.
>
> - **ORDER IS LOAD-BEARING IN THIS DIRECTORY, and it cost a debugging cycle to learn twice.**
>   `convex run` ENDS THE BROWSER SESSION on a local deployment (already recorded in
>   `e2e/README.md`), so the role-split test — the only one calling it mid-test — must run LAST.
>   With it in the middle, every later test loaded the page unauthenticated and `auditPage` simply
>   never resolved, which presents as a hung query, not as a dead session. If a spec here ever hangs
>   on a query that works in isolation, check what ran before it.
>
> **EXECUTED 7/7** against a rebuilt `:3111` on 2026-08-22, after seeding a fresh e2e account
> through the real invite-gated signup form (`invites.__seedInvite` → `e2e/seed-user.setup.ts`).)
>

> Last verified: 2026-08-22 (Foglamp tracing — **NO COCKPIT BEHAVIOUR CHANGED.** `llm.ts` and
> `dispatch.ts` gained trace bindings only: 16 `fogIntegration({ agentName })` properties on the
> existing `generateText`/`generateObject` calls, plus `traced()` around `runAgentLoop` and
> `runSpecialistTurn` so the SHARED loop carries the CALLER agent identity (`cockpit-agent`,
> `research-specialist`, `media-director`, `growth-specialist`). That indirection is forced:
> `agentName` must be a static literal and one call site serves six agents. Rules, invariants and
> the untraceable calls: `docs/playbooks/tracing.md`.)
>

> Last verified: 2026-08-22 (26-14 — **A SHIPPED DEFECT IN `plans.reportForPlan`, CORRECTED.** It
> joined delivery proof with `.filter(eq(eventType, "gmail.sent"))` only, while the Microsoft arm
> writes `graph.sent` (`graph.ts:122`) — so EVERY Microsoft send has been reading as undelivered in
> the cockpit'''s own REPORT card since the provider landed. A provider was added without this join
> following it. Both literals now count. The rule the new Reports plane applies for the same fact:
> **delivery is proven by the EXISTENCE of a proof row, never by a message id** — Graph returns 202
> with an empty body and deliberately records no id, so `messageIdPresent` is reported separately
> as a fact about the provider'''s response shape rather than about delivery.)
>

> Last verified: 2026-08-22 (26-13.1 — **WATCH-GATE ONLY, no cockpit behaviour changed.** This
> playbook watches `apps/web/e2e/`, and `content.spec.ts` gained two tests: the image lane renders
> and opens, and title search narrows the shelf. The cockpit-facing fact below is unchanged — an
> image card's Reuse is the same `/dashboard/workspace?thread=…` link every other artifact carries,
> and the shelf still holds no other way to act on a conversation.)
>

> Last verified: 2026-08-22 (26-13 Task 3 — **WATCH-GATE ONLY, no cockpit behaviour changed.**
> `apps/web/e2e/content.spec.ts` changed one assertion when the owner's UAT approval activated the
> Content nav item: the spec asserted a disabled `Soon` rail item before the gate, and asserts a
> live `/dashboard/content` link after it. The cockpit-facing fact recorded in the entry below is
> unchanged — Reuse is still a link into `/dashboard/workspace?thread=…` and nothing else.)
>

> Last verified: 2026-08-22 (26-13 — **WATCH-GATE PLUS ONE REAL COCKPIT-ADJACENT FACT.** This
> playbook watches the whole `apps/web/e2e/` prefix, so it sees the new `e2e/content.spec.ts`. That
> spec exercises the Content library and touches NO cockpit behaviour — but the surface it links to
> is this one, and that is the part worth recording here: **the Content shelf's "Reuse" control is a
> LINK into the cockpit and nothing else.** `/dashboard/workspace?thread=<id>` for a document or
> memo, `&view=canvas` for a reel — both hrefs are built server-side in `content.ts`, from the
> artifact's own `sourceThreadId`, and the page holds no other way to act on a conversation. There is
> no duplicate, no attachment, no send and no dispatch: `content.ts` exports only `tenantQuery`s, so
> a reuse-side write is not something the module could do. The workspace's own `?thread=` deep link
> (the VOIC-04 handoff) is what receives it, unchanged — `openThread` re-opens the conversation at
> whatever gate it already stands at, and every approval boundary still applies.
>
> Also here because the cockpit owns the artifact: the shelf opens documents and memos through the
> Vault's `PreviewModal`, reached by id exactly as `workspace/cards.tsx`'s `VaultDocModal` does. A
> reel is deliberately NOT opened that way — the modal would play the row's own bytes, and Content
> plays only through `api.media.reel`, whose non-null url is the validated-assembly guarantee.)
>

> Last verified: 2026-08-22 (26-11 -- **REAL cockpit behaviour changed, twice.** (1) `createDocument`
> now stamps the artifact with the thread and plan it was written in: `insertCreatedDoc` gained
> optional `sourceThreadId`/`sourcePlanId`, and `llm.ts` passes both AT THE INSERT CALL SITE ONLY --
> never into the shared `docArgs` object, which is also spread into `patchCreatedDoc`, whose
> validator has no such fields (a typecheck failure, not a test failure). Both values come from the
> `readPlan()` row, never from a model-supplied tool argument, so the model cannot stamp a document
> with another thread's provenance. `persistResearchFindings` does the same through `dispatch.ts`;
> `rootRequestId` stays the CORRELATION key and is NOT a thread id. (2) The `searchVault` fence now
> tells the model who wrote what it retrieved: a chunk from a PROMOTED artifact is labelled
> "written by the assistant, promoted by you". Marked ONLY inside the fence -- the `titles` array is
> labels-to-UI for the source card and suffixing it would corrupt the stored content-plane row.
>
> **The sentence 26-13's promotion control must show the user:** *"Promoting a document makes it
> reference material the assistant can cite -- it can no longer be rewritten in this conversation."*
> That is not UX polish: `patchCreatedDoc` refuses any row whose `origin !== "agent"`, so promotion
> genuinely ends in-thread revision for that artifact and the only reversal is deleting it.)
>
> Last verified: 2026-08-21 (`apps/web/e2e/` changed again — **NO COCKPIT BEHAVIOUR DID.** This
> playbook watches that whole prefix, so it sees `finance.spec.ts`. 26-10 Task 1 executed the
> Finance browser gate for the first time; five spec defects were fixed and the connected cost
> console passed. Two tests remain red and the blocking owner UAT has not happened. Full record in
> `dashboard-pages.md` and 26-10-SUMMARY.md. One item is worth copying rather than rediscovering:
> `.env`'s `user_email` is a `google` provider row with no password credential, so the `/signin`
> form cannot authenticate it — the run used a password-auth non-owner from the invite path. No
> cockpit turn, tool, gate, skill or stored row changed.)
>
> Prior: > Last verified: 2026-08-21 (26-10 pre-flight — **`apps/web/e2e/` CHANGED, NO COCKPIT BEHAVIOUR DID.**
> This playbook watches the whole `apps/web/e2e/` prefix, so it sees `finance.spec.ts`. Two spec
> properties changed and are written up in full in `dashboard-pages.md`: the owner grant gained an
> inverse (`owner:revokeOwner`) so the spec stopped being single-use against the shared E2E
> identity, and the media kill-switch toggle gained a `try`/`finally` so a failed assertion can no
> longer leave `guardrailConfig.mediaKillSwitch` ON deployment-wide. **The note below stating that
> `owner:bootstrapOwner` "has no inverse" is history as of this entry.** No cockpit turn, tool,
> gate, skill or stored row changed.)
>
> Prior: 2026-08-21 (25.1-06, D14 — **`http.ts` LOST A ROUTE.** `POST /fal/callback/*`, the
> FOURTH route 20-06 added, is deleted: the route, its HMAC path segment, its ±300 s replay window,
> its `fal.media`/`fal.ai`/`fal.run` asset-host allow-list and the `mediaComplete.resolveJob` lookup
> behind it. `FAL_WEBHOOK_SECRET` went with them and is out of `ENV_MANIFEST`. **The entries below
> that describe that route — including the 20-15 comparison that says "NO HMAC path segment, unlike
> `/fal/callback/*`" — are history.** No cockpit turn, tool, gate or plan-row behaviour changed.
>
> VERIFIED DEAD BEFORE DELETION, not assumed: `submitLine`'s webhook parameter had been unused since
> the ADR-017 cutover, so nothing had minted a callback URL for a provider to call; `resolveJob` had
> exactly one caller (the route) and `FAL_WEBHOOK_SECRET` exactly one reader (`resolveJob`). The
> route's only reachable caller was therefore somebody holding the secret, for whom it offered an
> outbound fetch and a terminal `succeeded` write. Provider truth and the removal record: ADR-024.
>
> `http.ts` now holds the OAuth callbacks (Gmail, Microsoft, and — since the 28-09 slice — the
> hubspot/quickbooks/stripe connector callbacks, which belong to revenue-connectors.md),
> `/skillopt/*`, `GET /media/blob/*` and the unsubscribe pair. `contacts.ts`'s unsubscribe token is the last living copy of the 20-06 stateless-token
> pattern, and its comment says so rather than pointing at the deleted route.
> Last verified: 2026-08-21 (25.1-05 Task 2, D11 — **THE MEMO CARD RENDERS ITS DOCUMENT AND SHOWS
> ITS SOURCES.** `MemoCardBody` (exported from `cards.tsx`, hook-free) replaces the memo branch's
> `white-space: pre-wrap` paragraph: the body goes through the EXISTING `MarkdownDocument` in its
> `compact` form — the same renderer the chat bubbles and the artifact preview already use, no
> second renderer and no tokenizer change — and `plan.sources` renders below it as a references
> block, one row per page with its title, its URL as READABLE text (checking a paid finding must not
> require a mouse) and its own retrieval date.
>
> **THE BLOCK RENDERS ON PRESENCE AND HIDES NOTHING.** No sources ⇒ no block, not an empty heading;
> a source whose title came back empty links its URL rather than rendering a blank anchor
> (`sourcesFromToolOutput` defaults a missing title to `""`, a real shape). It is a plain list, NOT
> a `GroundedSources`-style `<details>` fold — that fold exists for a list accumulated across a
> whole thread, while a research turn returns a handful. If a memo ever carries dozens, reuse that
> fold verbatim rather than inventing a cap: **a `.slice()` here would destroy provenance**, and the
> test that guards it renders nine sources and counts nine anchors.
>
> BRAND: `--teal-900` for the link text and `--ink-soft` for the caps section label — §6 bars
> `--teal-600` as small text on white (~2.9:1), which is why `capsTeal` was NOT reused here.
> Exported and hook-free for the `AwaitingCardBody` reason: a regex over this file cannot tell a
> rendered heading from a printed `#`. `memoCard.test.ts` renders real markup for the behaviour and
> keeps ONE source scan for the wiring the render cannot see — that `PlanCard`'s memo branch reaches
> this component at all.)
>
> Last verified: 2026-08-21 (25.1-05, D11 — **THE DISPATCH LANDING NOW CARRIES SOURCES, AND THE
> §4 BOUNDARY MOVED WITH IT.** `dispatchAndLand`'s landing object gained `sources`
> (`{title, url, retrievedAt}[]`, omitted when empty) and `evaluations.landSpecialistResult`
> writes them to the plan row, so the memo card can attribute the findings it is already showing.
> Until now the URLs reached the vault document only — through `persistResearchFindings`, which is
> SKIPPED entirely on a zero-search run and swallowed on a persist failure — so the card the user
> reads could show findings it could not attribute to anything.
>
> **THE RULE THAT DID NOT CHANGE: a URL is CONTENT PLANE.** It may reach `plans.sources`, the vault
> document and the card; it may NEVER reach an `audit`/`deadLetters`/`telemetry` payload, which get
> `sourceCount`/`webSearchCalls`. `dispatch.ts`'s audit payload count is UNCHANGED at 12 and no
> payload gained a field, so `llmRedaction.test.ts`'s pins are untouched. Mutation-checked both
> ways: adding `sourceUrls: turn.sources.map(s => s.url)` to the `subagent.completed` payload
> reddens `dispatch.test.ts`'s §4 scan — **and leaves `llmRedaction.test.ts` GREEN**, because that
> static scan bans `reply|body|text|output` by name and knows nothing about a URL. The runtime scan
> is the one that guards this; do not treat the static pin as cover.
>
> **WRITTEN BY DIRECT `ctx.db.patch`, DELIBERATELY NOT THROUGH `patchPlan`.** `patchPlan` is the
> door the model's own cockpit tools write through, and a source list is a PROVENANCE claim — "these
> pages were read for this memo". It comes from the search tool's own RESULT parts
> (`sourcesFromToolOutput`), never from model prose, and nothing reachable from the model may add to
> it — the `calendarEventId`/`calendarRunId` rule, verbatim. `plans.resetPlan` clears it with the
> body it attributes (Pitfall-6 class).)
>
> Last verified: 2026-08-21 (25.1-02, D4 — **A DEAD SPECIALIST DISPATCH IS VISIBLE NOW.**
> reliabilitySweep.test.ts 23/23. No cockpit.ts, plans.ts, dispatch.ts or evaluations.ts change —
> the sweep patches the row from outside.)
>
> **The failure this closes.** `actOnGap` / `stageResearchPlan` / `stageMediaPlan` all park the
> thread's plan row at `status: "collecting", kind: "memo", body: ""` and schedule the specialist;
> `dispatchAndLand`'s `finally` is what returns it to `proposed`. If that action never reaches its
> handler at all (a dropped job, a deployment restart), the `finally` never runs — and `PlanCard`
> renders only at `proposed`, so the row is INVISIBLE FOR EVER: no card, no error, no way back.
>
> **The terminal chosen is an EXISTING one, not a new status member.** `reliabilitySweep`'s plan
> sweep flips such a row to `proposed` with a fixed `COLLECTING_FALLBACK_BODY` — a system notice in
> its own voice that claims no findings and attributes nothing to the specialist (the
> `LOST_CONTEXT_MEMO` precedent) — plus one `watchdog.stalled` notification.
>
> **Two guards, and both are load-bearing.** (1) `collecting` + `kind: "memo"` is the DISPATCH-OWNED
> discriminator — the same pair `plans.stageResearchPlan` already uses for `research_in_flight`. An
> ordinary conversation's `collecting` row carries no kind and is NEVER touched: a week-old live
> chat is still a live chat. (2) Liveness is read from `_scheduled_functions` — a `pending` or
> `inProgress` run carrying this `planId` is a live turn and is left alone; `success`/`failed`/
> `canceled` are not liveness, they are the defect. Matched by `args.planId`, not by function name,
> so a fourth dispatch entry point is covered the day it is written. `COLLECTING_STALL_MS` (30 min)
> is only a cheap pre-filter that keeps that scan off every plan in the table.

> Last verified: 2026-08-21 (25.1-01 Task 2, D2 — **NO cockpit.ts CHANGE WAS NEEDED, recorded so
> the plan's premise dies here.** The plan expected `EXTERNAL_TARGETS` to gain a renderReel thunk;
> it does not — `EXTERNAL_TARGETS.media` stays `submitBatch`, permanently, per 20-16's decision
> above. What DID change is that the render stage now runs under the SAME ActionRetrier component
> the cockpit's external arm uses: all three renderReel schedule sites (`evaluateRenderTrigger`,
> `media.retryRender`, `recordRender`'s auto-retry) are `retrier.run(…, { onComplete:
> internal.mediaComplete.onRenderComplete })`, with the run id on `plans.renderRunId` — the
> `calendarRunId`/`mediaRunId` correlation pattern a third time. Details live in media.md; this
> entry exists because the cockpit playbook documents the EXTERNAL_TARGETS idiom that was copied.)
>
> Last verified: 2026-08-21 (25.1-03, D7 — **`plans.resetPlan`'s clear-set gained
> `reelVaultDocId`.** The contract this playbook records for `resetPlan` is unchanged in kind — a
> composition reset wipes the deck AND the render plane — but one render-plane field had been
> missing since 33-05 shipped the vault save, and it was the one that could DESTROY prior work
> rather than merely show it under the wrong proposal: the pointer `saveReelToVault` upserts on.
> Details in media.md. `plans.test.ts`'s `DECK_AND_RENDER` list is the pin, and it reddens if the
> clear is removed.)
>
> Last verified: 2026-08-21 (**TEST-ONLY ADDITION, NO COCKPIT BEHAVIOUR CHANGED.** Two mock fetch
> responses (`W/"mutation-write"` provider replies) were appended to the two 17-08 manageEvent
> completion-terminal cases in `calendar.test.ts` so each staged mutation's provider write has a
> queued response. No source module changed; this entry exists to keep the watch-gate honest.)
>
> Last verified: 2026-08-20 (23-05 source-separated the Executive's
> `authorSkillCandidate` tool from both activation exports. The tool still reaches only
> `publishAgentCandidate`; activation lives only in the owner-mounted `/ops` review panel, with a
> distinct user vs agent exact-id mutation selected from the server's closed author discriminant.
> The workspace history shows inert author/status labels and no activation control. Source/static
> verification only because dependencies are absent; no live state changed and `$0.00` was spent.)
>
> Last verified: 2026-08-20 (17-09 added bounded managed-event discovery and inspect-then-stage
> update/delete proposals. The tool accepts only a tenant-checked registry ref, parses time from the
> trusted client clock, refreshes title/time/etag/attendee count before one atomic proposal mutation,
> and cannot name a provider writer or Approve gate. The management card reads the refreshed
> registry snapshot and distinguishes update from destructive removal. Restored runtime verification:
> the focused Calendar/tool/trace/dispatch suite passes 190/190 and `@pikar/web` typecheck is clean.
> The Playwright browser launches, but authenticated execution remains gated on the seeded local
> `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`; exact evidence is in 17-09-SUMMARY.)
>
> Prior verification: 2026-08-18 (23-03 added the Executive-only `authorSkillCandidate` tool + its trace
> verb; explicit-intent-only is PROMPT guidance, the candidate-only boundary is code. See the Phase
> 23 section at the end. Prior verification follows.) (17-08 Task 3 — **the Approve-only arm, the management terminal and the
> lifecycle readback**. calendar 88/88 · cockpit 73/73 · dispatchGuard 20/20, backend 88 files /
> 2124 passed, core 1063/1063, tsc clean. ELEVEN mutations, all CAUGHT.)
>
> **`calendar_manage` is the externalAction arm's THIRD occupant**, replacing 17-05's
> `calendar manage not wired (17-08)` stub. Same arm, same human Approve gate, same
> `proposed → approved` CAS — so "a second approval no-ops" is inherited, not re-implemented. The run
> id lands in `calendarRunId` through the EXISTING patch (management is simply not `media`), and both
> Calendar terminals resolve a failed run through `by_calendar_run`.
>
> **Its terminal is a SEPARATE function** (`onManageComplete`), and `dispatchGuard.test.ts` now
> counts DISTINCT targets and terminals rather than only asserting each is present — a manage thunk
> pointed at `onCreateComplete` satisfies every `toContain` while marking CREATE plans done.
>
> **ORDER IS THE GUARANTEE, again.** The registry is written BEFORE the plan is marked done, and the
> state written is recomputed from the PLAN's own staged fields, never echoed out of the provider
> result. An absent staged field means "leave it alone".
>
> **A refusal is `canceled` + `cancelKind: "refused"` + `calendarFailureCode`.** The third literal is
> new and deliberate: `approvals.ts` surfaces `cancelKind` as the cancellation's PROVENANCE, so
> reporting a provider-limitation refusal or a version conflict as a user `discarded` would attribute
> the decision to the wrong actor — the defect class this codebase has shipped three times.
> `reschedulePlan` excludes `refused` alongside `discarded`: re-arming it would re-run a write the
> system already declined.
>
> **Refusal copy is STATIC, keyed off the code.** A conflict message that quoted the event or the
> etag would put the one moving part into a row the user reads (§4). The Microsoft-delete message
> NAMES the limitation and says the event is still there, because ADR-023 requires the absence to be
> a visible product surface.
>
> **Reauth is provider-specific and NON-terminal** — `RECONNECT[provider]`, the same table `llm.ts`
> uses. A Microsoft outage that wrote `gmail_reconnect` would send the user to the Google consent
> screen to fix an Outlook connection. The plan stays `delivering`, mirroring `onCreateComplete`.
>
> **`smoke.calendarLifecycleReadback` reads FOUR planes independently** — plan row, registry row,
> provider, audit log — so none vouches for the others. It returns refs, codes, counts, key names,
> hashes and booleans only. `contentLeak`/`tokenLeak` are MEASURED by substring search against the
> tenant's real titles and real credentials, and `contentChecked`/`tokensChecked` report how many
> strings the check had to look for — zero would mean the booleans proved nothing. A negative-control
> test forces `contentLeak: true` so the detector is known to be able to fire.
>
> **A survivor worth remembering: `cockpit.ts`'s `_ARM_TABLE` is TYPE-LEVEL ONLY.** Flipping
> `calendar_manage` to `"workflow"` there changed nothing at runtime and the whole suite stayed
> green — the runtime table is `ARMS`/`armFor` in `@pikar/core/actionType.ts`. If you are reasoning
> about which arm a plan kind takes, read the core file; the cockpit copy only derives the type that
> makes `EXTERNAL_TARGETS` incomplete at compile time.
>
> Last verified: 2026-08-18 (17-08 Task 2 — **conditional management, minus Microsoft delete**.
> calendar 71/71 · microsoftCalendar 62/62 · calendarEvents + dispatchGuard green, backend 88 files
> / 2099 passed, core 1063/1063, tsc clean. FIFTEEN mutations, all CAUGHT.)
>
> **One decision tree, two providers.** `calendar.manageEvent` owns the ownership guards, the
> attendee refusal, the desired-state reconciliation and the conflict handling ONCE; the provider
> modules contribute only HTTP. A second copy of "refuse if attendees > 0" is a second place for it
> to be missing.
>
> **THE GET ANSWERS THREE QUESTIONS AND NOTHING ELSE**: does the event exist, did it grow guests, is
> the desired state already there. Version arbitration stays server-side, in the provider's 412
> against the etag the HUMAN approved (`plans.calendarExpectedEtag`) — never the freshly-read one.
> Sending the fresh etag would make every write succeed: that is a read-modify-write race with the
> comparison moved client-side, which ADR-023 names as forbidden. Mutation-proven (M5).
>
> **Microsoft cancel/delete is refused before a token is fetched, and that refusal is a PRODUCT
> SURFACE** (ADR-023: the probe measured `staleDeleteStatus: 204` / `staleDeletePreserved: false` —
> Graph ignores `If-Match` on event DELETE and the stale delete destroyed the event anyway).
> `providerSupports(provider, operation)` in @pikar/core returns `provider_unsupported`, and **its
> signature takes no probe argument** — deliberately, so no measurement can widen it. ADR-023 says a
> later work/school probe showing a 412 on DELETE justifies a superseding ADR, never an automatic
> widening, and an argument that does not exist cannot be threaded through by accident. There is no
> Graph delete writer in `microsoftCalendar.ts` at all; a test pins that a generous probe unlocks
> the PATCH branch and nothing else.
>
> **Microsoft UPDATE is probe-gated, and the gate lives on the WRITER.** `patchEvent` refuses before
> the token when `PHASE17_GRAPH_PROBE` is missing, blank, malformed, wrong-schema, fails the
> `stalePatchStatus === 412 && stalePatchPreserved` PAIR, or carries hashes bound to another
> deployment or account. The pair is read APART from the artifact's collapsed `supported` boolean —
> that boolean ANDed patch and delete together and could only report the worse of them, which is why
> a provably-safe PATCH sat unreachable behind an unsafe DELETE. Gating the writer rather than the
> caller costs the refused path one extra inspection GET (a read of the user's own calendar) and
> buys a guard nothing can route around.
>
> **Exactly-once is reconciliation, not optimism.** A retry after a lost success response finds the
> provider already holding the desired state and reports success — the etag moved precisely BECAUSE
> our earlier write landed, so a blind conditional re-write would report a false conflict. `tz` is
> deliberately excluded from that comparison: Graph is asked to speak UTC and echoes UTC back, so a
> registry zone of `Africa/Dar_es_Salaam` would never compare equal and every Microsoft update would
> be forced into a PATCH that changes nothing. The absolute instant is the fact; the zone rides the
> write payload.
>
> **The `attendees` static guard was NARROWED, not relaxed** (`dispatchGuard.test.ts`). Management
> must READ the guest list to refuse an event that grew one, so the blanket ban would have forbidden
> the very check that protects people. What stays banned is the WRITE form — `attendees` as an
> object-literal key — plus `sendUpdates` anywhere, plus an anti-vacuity assertion that
> `body.attendees` is still actually read. Both halves are mutation-proven (M6, M13).
>
> **A survived mutant found a real gap.** The first pass tested only the pre-flight 404 (the GET says
> the event is gone). The RACE — it existed at the GET and was gone by the DELETE — was untested, and
> that branch's answers differ by verb: already-gone is idempotent SUCCESS for a delete and
> `not_found` for an update. Both are now pinned.
>
> Last verified: 2026-08-18 (17-08 Task 1 — **the durable managed-event registry**. calendarEvents
> + calendar 54/54, backend 88 files / 2053 passed, tsc clean. Five mutations, all CAUGHT.)
>
> **What a registry row buys.** Without `{provider, externalEventId, etag}` recorded at CREATE time,
> a later update is a read-modify-write against a version nobody wrote down. `calendarEvents.ts` is
> that record, and `manageability` (@pikar/core) is the pre-provider gate that reads it — every
> refusal it can return (`not_found`, `attendees_present`, `needs_inspection`) traces to a fact
> stored here rather than to a provider round trip.
>
> **ORDER IS THE GUARANTEE in `onCreateComplete`.** The registry row is written BEFORE the plan is
> marked done. Marking the plan first would leave a done plan whose event exists on a real calendar
> with nothing recording its provider/id/etag — an event Pikar created and can never manage, with no
> signal anything is missing. If the insert throws, the mutation rolls back and the retrier
> redelivers against a plan still at `delivering`. Mutation-proven.
>
> **The tenant comes FIRST in the composite index, and that is isolation not tidiness.** Two tenants
> can legitimately hold the same provider event id (a shared calendar, a restored backup, a
> fixture). Convex requires index prefixes to be equated in order, which makes the tenant predicate
> unwritable-to-forget rather than merely wrong to omit.
>
> **A missing etag means UNKNOWN VERSION, never "no concurrency check needed".** The create terminal
> drops the key rather than storing null, so `manageability` reports `needs_inspection`. The legacy
> migration refuses three temptations: no network to discover the etag, no invented placeholder
> (a fabricated If-Match turns a refusal into a silent overwrite), and no invented event — a legacy
> plan with no staged title/instant is SKIPPED and counted, because an invented time on a real
> calendar is the worst available repair.
>
> **A test that passed for the wrong reason, caught by mutation and worth remembering.** The replay
> assertion ran through `onCreateComplete`, which short-circuits on `status !== "delivering"` — so
> it proved the STATUS GUARD and left the upsert's own dedupe unproven. Disabling the dedupe changed
> nothing. `upsertManaged` is now tested directly; the contract matters on its own terms because
> `stagingSnapshot` and the migration both call `.unique()` on that index, and `.unique()` THROWS on
> a duplicate — a second row is a permanently broken lookup, not a cosmetic problem.
>
# Playbook: Email Chat Cockpit

> **Formatting-only pass, 2026-08-29.** `biome format` + `organizeImports` ran across this
> subsystem's files to clear a CI `Lint` red that had been blocking the `Test` and `Build`
> steps behind it since 2026-08-27. Whitespace, line wrapping and import order ONLY — no
> behaviour change, and **this is not a re-verification of anything below.** The
> `Last verified` line still means what it said.

> Last verified: 2026-08-18 (**A BRIEF IS A SUBJECT, NOT A TASK — the media specialist was never
> told to produce the deck.** dispatch 103/103, backend 87 files / 2041 passed, tsc clean. All four
> claims mutation-proven.)
>
> **The defect, measured in production rather than argued.** `buildSpecialistPrompt` has two prompt
> shapes. The QUESTION branch (`dispatch.ts`, 16-06) was built for RESEARCH, where the question
> genuinely IS the task — "what do competitors charge?" needs no further instruction. `runMedia`
> reused it: `llm.ts` passes `question: brief`, so a media specialist's ENTIRE user turn was the
> executive's free-text brief, capped at 500 characters, and nothing else. The 20,041-character
> registry body teaches the deck FORMAT; only a user turn can say DO IT NOW, and none ever did.
>
> **What that looked like live.** The identical brief — "Create a short video ad for my business."
> — produced a 5-shot deck on one run and 1,270 characters of prose with ZERO deck tokens on
> another. Same skill version 5, same body hash `4f41120c…`, `incomplete: false` and
> `declaredUnsupported: false` on both. **A coin flip is what "no task line" looks like from
> outside the model.** Diagnosed off `audit:recentByType` + `plans:getById` in four calls, with no
> browser session.
>
> **One root cause, four symptoms nobody had connected.** The `no_deck` coin flips;
> `bad_target_duration` on a 6,331-character deck that never wrote the line; **`variations: 1` on
> EVERY deck ever persisted in production** — the A/B contract had never once been honoured live;
> and "nothing injects a target duration into the specialist prompt". All the same missing sentence.
>
> **The fix: `MEDIA_TASK_LINE`, appended for `route === "media"` only.** Driver-plane, not a skill
> (§5 does not apply — same standing `TASK_LINE` has, and the SYSTEM prompt is still the registry
> row). It deliberately re-teaches NOTHING `media-director.md` owns — not the columns, not the
> citation rule, not the narration budget. It says only WHEN and WHETHER: produce it now, produce
> BOTH variations, declare `Target duration:`. Those are the three things a system prompt
> structurally cannot compel. The legal lengths and the default are derived from `TARGET_DURATIONS`
> so the sentence cannot name a set `parseSceneDeck` would refuse.
>
> **THE CAP APPLIES TO THE BRIEF, NOT THE JOINED STRING.** `cap(brief) + task`, never
> `cap(brief + task)` — the latter truncates the instruction away on exactly the long briefs that
> most need it. A test pins the ordering; the mutation is CAUGHT.
>
> **`plans.refusedBody` — what the model wrote instead.** The audit counts say whether a deck was
> written and §4 forbids ever asking them what was written instead, so the raw body now lands on
> the PLAN row (`schema.ts`: raw content lives in `requests`/`plans`), capped at 20k, cleared by
> `persistDeck` like every other deck field. It is EVIDENCE, not copy — nothing renders it, `body`
> is still the sentence the user reads, and a test asserts the prose never appears anywhere in the
> audit lineage.
>
> **Still unobserved:** what those 1,270 characters actually SAY. `refusedBody` exists so the next
> one is read rather than inferred. Do not let anyone write that inference into a doc as fact.
>
> Touched 2026-08-18 to clear the §9 Stop hook — **ACKNOWLEDGEMENT ONLY, NOT A VERIFICATION**, and
> deliberately NOT a `Last verified` bump. The session that touched this file wrote none of the code
> that triggered the check and has not reviewed it.
>
> What triggered it: `mediaCanvasView.ts` and `mediaCanvas.test.ts` carry the concurrent media
> lane's work — a `why === "narration"` arm in `adjustmentNotes` and the assertions pinning it. Both
> were already dirty at this session's start against `a745d36`; that lane has since committed them
> as `0f17d2b`. `watch.json` gives `apps/web/app/(app)/dashboard/workspace/` to this playbook, so any
> edit under that directory flags cockpit.md regardless of which plane it belongs to.
>
> **The change is media-canvas disclosure copy, not cockpit behaviour** — it decides which sentence
> a narration-repair note gets, receiver vs donor. No tool, guard, route or transcript path moved.
> If a media statement here is stale, **it is the media lane's to verify and bump**; that lane's own
> entry for this work is already in `media.md` (Last verified 2026-08-18).

> Touched 2026-08-17 — `agentSteps.test.ts` gained the `imageProposalCountForThread` block (4
> tests, 24/24) pinning the still-image observable and the deliberate absence of the `dispatch:`
> filter its `dispatchMedia` sibling needs. **No cockpit behaviour changed.** The subsystem entry
> is in `agent-runtime.md`.

> Last verified: 2026-08-18 (**the scene/block fallback guard now means what its comment always
> said.** dispatch 98/98, backend 2034/2034, typecheck clean, mutation-proven red-then-green.)
>
> **`persistStoryboard`'s fallback is guarded on `no_deck` ALONE, and that code finally means "no
> SCENE DECK heading".** It used to also come back when the heading WAS there and only the table
> could not be read, so those bodies fell through to `parseBlockDeck`, missed the BLOCK DECK heading
> too, and the owner got the BLOCK contract's sentence — "it never wrote a block deck" — about a
> scene deck written in full. The table-shaped refusals are `unreadable_deck` now and stop here,
> like every other non-`no_deck` scene refusal already did. The guard's CODE is unchanged; what
> changed is that the claim above it is now true.
>
> **A REASON CODE READ BY A BRANCH IS A CONTRACT.** Adding an early return to either parser means
> deciding which side of this branch it belongs on. Do not trust a code by its name — `grep` every
> `return fail("<code>")` first. `no_deck` had three call sites and two of them meant the opposite
> of what this branch assumed, through three separate fixing sessions.

> Last verified: 2026-08-17 (owner-reported, seen on the owner's own screen — **THE DIRECT VIDEO
> ROUTE WAS SPEAKING TO THE MODEL, IN FRONT OF THE USER.** runCockpitAgent 34/34, backend
> 2033/2033, typecheck clean, both new guards mutation-proven red-then-green.)
>
> **THE DEFECT.** `runCockpitAgent`'s `directVideo` branch invokes `dispatchMedia` and returns the
> tool's string as `reply` — **there is no model on that route**. Every media string the tool can
> return is driver-plane: second person, addressed to the MODEL, ending in an instruction it is
> meant to carry out. So asking for a video ad on production showed the owner *"you do not have it
> yet, so do not describe it, do not wait for it, and do not ask for a reel again on this
> conversation"* as though Pikar were talking to them. The refusal arms were worse and unshipped
> only by luck: `image_proposal_pending` would have told the USER to *"call `resetPlan`"*.
>
> **The fix is a TRANSLATION AT THE BOUNDARY, not a rewrite of the driver strings.** The tool-loop
> still needs them exactly as they are — a model that reads "Tell the user it is underway and carry
> on" is being steered correctly. `USER_FACING_MEDIA_REPLY` maps each one to the same outcome
> addressed to the user, and the `directVideo` branch translates on the way out. **Keyed on the
> CONSTANTS THEMSELVES, never on copies of their text**, so editing a driver string moves the key
> with it and the two planes cannot drift into describing the same outcome differently. An unmapped
> string falls through unchanged — a missing translation degrades to the old wording, never to a
> blank reply.
>
> **ADD A MEDIA REFUSAL REASON AND YOU ADD ITS TRANSLATION.** `runCockpitAgent.test.ts` asserts
> coverage against `MEDIA_REFUSAL_REPLY` itself, not against a count, so a new reason with no
> user-facing string fails the suite by name. Both constants are exported ONLY for that guard (the
> `deckTokenCounts` precedent). Proven by mutation: bypassing the translation reddens the video
> test, deleting one map entry reddens the coverage test with the reason named.
>
> **Any OTHER code-owned route that returns a tool string straight to `reply` has this same bug.**
> `IMAGE_PROPOSED_REPLY` and `IMAGE_REFUSAL_REPLY` are the same driver-plane shape; they are not
> reached by a modelless route today, and that is the only reason they are not also leaking.

> Last verified: 2026-08-17 (owner-reported, second pass — **`deckTokenCounts` is FIVE numbers
> now.** dispatch 97/97, llmRedaction guard green, backend 2031/2031, typecheck clean; no live run.)
>
> **`targetDurationTokens` joined the four.** `bad_target_duration` had the same two-indistinguish-
> able-causes problem `no_deck` had, and the entry below missed it: the specialist declared no
> target, or declared one this codebase could not read. Non-zero means it WAS declared and the value
> or its markdown decoration is what failed; zero means none was written. The owner's reel refused
> twice on this code with the audit row unable to say which — the same blind spot, one reason along.
>
> **Everything about HOW it was added below still applies, unchanged:** called into a `const` and
> spread, never inlined into the payload literal; the §4 review recorded in `llmRedaction.test.ts`'s
> own comment block; the counts-only claim proved by test against distinctive prose. **A sixth
> number gets the same treatment, not a quiet append.**
>
> **The payload COUNT assertion (`toBe(12)`) still holds** — the same three payloads were extended.

> Last verified: 2026-08-17 (owner-reported — **the media refusal's diagnosability, and `res.body`
> vs the §4 scan.** dispatch 93/93, llmRedaction guard green, backend 2026/2026; no live run.)
>
> **`media.deck_refused` gained four COUNTS, and how it was added is the part to copy.** All three
> refusal arms in `persistStoryboard`/`persistSceneDeck` now spread `deckTokenCounts(<body>)` —
> `{bodyChars, sceneDeckTokens, blockDeckTokens, variationTokens}` — because `no_deck` had two
> causes and the body is never persisted on that path. **Call it into a `const` and spread the
> const; never inline it into the payload literal.** `llmRedaction.test.ts` scans payload literals
> for `(reply|body|text|output)` and an inline `deckTokenCounts(res.body)` reddens it — that
> guard is deliberate and stays sharp, so the §4 guarantee comes from the helper's return type
> (four numbers, test-proven to leak no substring of the body) and the scan keeps catching the next
> person who reaches for `res.body` directly. The review note is recorded in the guard's own
> comment block, which is what its protocol requires — a new §4 surface is REVIEWED there, never
> silently renumbered.
>
> **The payload COUNT assertion (`toBe(12)`) still holds** — three existing payloads were extended,
> no thirteenth surface was added.

> Last verified: 2026-08-16 (25-06 — **the per-plan mailbox choice, and the reauth banner bug that
> 25-05 created.**)
>
> **THE REAUTH HOLD SURFACE IS NOW PROVIDER-AWARE — this was a real bug, introduced by 25-05.**
> Before it, `awaiting_reauth` could only be set by `gmail.send`, so `ReconnectBanner` hardcoded
> "a hold means Google". `graph.send` sets it too, so a held **Microsoft** send was about to tell
> the user to reconnect **Gmail** — the wrong consent screen, with the real problem left standing.
> Holds now partition on `mailProvider` (absent ⇒ google, the same default `delivery.send` uses).
> The branching moved into an exported pure `reconnectLines()` because the component renders
> nothing until its seen-set loads after mount, so a render test would have asserted on an empty
> string and proved nothing. Mutation-proven: restoring the hardcoded-Google hold reddens 4.
>
> **A second, quieter defect fixed with it:** `RECONNECT.microsoft.message` is the CALENDAR expiry
> cron's copy ("keep calendar access working"). Reusing it for a mail hold describes the wrong
> subsystem, so `RECONNECT` now carries a separate `holdMessage` per provider.
>
> **THE MAILBOX CHOICE IS PER-PLAN, GATED ON `mailReady` — NEVER ON `connected`.**
> `plans.setPlanMailProvider` (modelled on `setPlanSendTime`, same cross-tenant guard) refuses once
> the plan leaves `proposed`/`collecting`, because `executePlan` has by then copied the provider
> onto every `requests` row and a later change would make the display and the delivery disagree.
> There is deliberately **no tenant-wide or deployment-wide "active provider"**: it would make one
> plan's mailbox depend on the last thing clicked on a different plan.
>
> `mailboxOptions()` is exported and pure for the same testability reason. **A 17-05-era
> calendar-only grant is `connected`, refreshable and completely real, and cannot send mail** —
> offering it would walk the user into `mail_scope_missing` at approve time instead of into
> re-consent now. Mutation-proven: gating on `connected` reddens that case.
>
> **NO SECOND OAUTH SURFACE WAS ADDED, and a test asserts it** — `microsoftAuth.test.ts` pins
> `http.route(` at exactly 11 (8 until the 28-09 connector callbacks; the pin is on the TOTAL, so
> any route appearing or disappearing has to be justified) and at most one Microsoft callback path. 17-06 built the authorize
> URL, callback, consent page and token row; a plan named "provider lifecycle" is precisely the one
> that would quietly add a second, so the absence is measured rather than assumed.
>
> **UNRESOLVED, DELIBERATELY NOT DECIDED HERE:** 17-06 shipped `/connect-microsoft` as its own page
> beside `/connect-gmail`. Two connection pages is the landed reality. Merging them into one
> connections surface is a UX decision with its own plan — not a side effect of this one.
>
> **BLOCKING OWNER CHECKPOINT — DECIDED 2026-08-17, POSTURE A:** the Microsoft disconnect support posture.
> `disconnectMicrosoft` returns `revokedAtProvider: false` and that is the honest value — Entra
> exposes no per-app revocation under a delegated grant. The evidence and the A/B choice are in
> `.planning/phases/25-private-beta-productionization/25-MAIL-MIGRATION-EVIDENCE.md`. **The
> owner chose **Posture A**: the honest local disconnect, never labelled as remote revocation. Evidence
> re-verified 2026-08-17 — two claims confirmed verbatim, and **the user-facing portal URL was found
> WRONG**: `myaccount.microsoft.com/permissions` is neither route. Personal accounts use
> `https://account.microsoft.com/privacy/app-access`; work/school accounts use
> `https://myapps.microsoft.com/`. The shipped `DisconnectMicrosoft.tsx` copy names only "Microsoft My
> Apps" (work/school) for both, so it misdirected personal-account users. **FIXED and LANDED
> 2026-08-17** — the confirm names both routes and the success note LINKS both; `note` widened from
> `string` to `ReactNode` to carry the anchors. `connectionsSurface.test.ts`'s guard was TIGHTENED:
> it accepted the bare string "My Apps" before (which is how the wrong portal passed review) and now
> requires both hostnames. Mutation-proven red-then-green. Superseded text follows: **The approved
> replacement copy is drafted in the evidence doc and NOT YET LANDED (`copy_landed: false`).**
> **GOVN-03's provider-revocation clause stays OPEN; 25-06 does not close it.**
>
> Prior entry — 2026-08-16 (25-05 — **THE SEND PATH IS NOW TWO-ARMED. `internal.gmail.send` is no
> longer what the production callers invoke; `internal.delivery.send` is.**)
>
> **The seam.** `delivery.ts` is a ~10-line dispatcher reading one field — `requests.mailProvider`
> — and handing off to `internal.gmail.send` or `internal.graph.send`. Both production callers
> (`deliverApprovedPlan.ts`, `pipeline.ts`) point at it. Their terminal handling is UNCHANGED,
> because both arms return the same `suppressed`/reauth vocabulary.
>
> **ABSENCE MEANS GOOGLE, and that is the entire migration story.** `mailProvider` is optional on
> both `plans` and `requests`. Every row written before 25-05 predates the second provider and was
> a Gmail send, so legacy rows keep delivering with **no backfill, no index, and no discriminator
> column on `gmailTokens`** — `gmailTokens` and `microsoftCalendarTokens` remain two separate
> tenant-keyed tables (ADR-018; a discriminator would make every existing `by_tenant` `.unique()`
> read ambiguous). Mutation-proven: flipping the default to Microsoft reddens the legacy test.
>
> **THE GOVERNANCE SPINE IS SHARED, ON PURPOSE.** `gmail.ts` now exports
> `prepareGovernedMessage(ctx, req)` — suppression check, attachment resolution, CAN-SPAM footer,
> `buildMime` — and BOTH arms call it. The footer is still concatenated at the `buildMime` call
> site, which that function now is for both providers. **Two providers with two copies of an
> unbypassable guard is how a bypass gets built**: the second copy drifts, or the third provider
> only inherits one of them. `graph.test.ts` asserts BYTE PARITY — the two arms hand their provider
> the identical MIME for the same row — and mutation-proving it (bypassing the shared prep) reddens
> 4 tests including that one. `notifyExternal.ts` deliberately stays outside: it sends a static
> service notice to the user's OWN mailbox, which carries no footer and has nobody to unsubscribe.
>
> **What is Microsoft-specific, and why each exists.** STANDARD base64, not URL-safe (the one
> byte-level divergence, and a copy-paste of the Gmail arm is exactly how the wrong alphabet would
> arrive). `text/plain` content type. A **scope check BEFORE the token round trip** —
> `microsoftMailReady(scope)` via the new `microsoftAuth.grantedScope` internalQuery, which returns
> the scope string and never token material — so a 17-05-era **calendar-only grant** is refused as
> `mail_scope_missing` rather than surfacing as an opaque Graph 403 on the delivery path. A 3 MB
> MIME ceiling. And **`messageId: ""`**: Graph's `sendMail` returns 202 with an EMPTY body, so
> there is no id — the audit row records `{requestId, provider}` and fabricating an id would put a
> lie in the log.
>
> **`graph.ts` NEVER refreshes or writes `microsoftCalendarTokens`.** `freshGraphToken` in
> `microsoftCalendar.ts` is the one refresh root over that row. A second refresh path is a
> rotation race: two concurrent refreshes POST the same refresh_token, Microsoft rotates it on the
> first, and the second persists a token the provider has already invalidated.
>
> **OPEN, AND OWNED BY 25-06 — the reauth HOLD surface is still hardcoded Google.**
> `ReconnectBanner.tsx` was generalized by 17-06 for the NOTIFICATION half only; its hold half
> assumes `awaiting_reauth` means Gmail, and its in-source comment says so because no Microsoft
> send path existed yet. **It does now.** A Microsoft send held at `awaiting_reauth` will currently
> tell the user to reconnect *Gmail*. Not fixed here because `ReconnectBanner.tsx` is outside this
> plan's owned files; recorded so 25-06 cannot miss it.
>
> Prior entry — 2026-08-16 (33-13 — **the cockpit's plan-kind switch gained ONE branch, and the
> Last verified: 2026-08-16 (33-13 — **the cockpit's plan-kind switch gained ONE branch, and the
> canvas gained a SECOND `useSendCockpitMessage` caller. Nothing else about the cockpit changed.**)
>
> `PlanCard` in `cards.tsx` now branches on `plan.proposalRefusal` **ahead of the memo card**: a
> media run that produced no usable deck lands on a `kind: "memo"` row, and it was rendering as an
> ordinary memo — Approve and Save over a reel that does not exist. It renders
> `ProposalFailureCanvas` (the media surface's own failure card) instead. `CanvasPane` carries the
> same branch ahead of its `kind !== "media"` empty state, for the reason 33-07 recorded: this
> canvas has TWO mount points and anything wired into only one of them is the defect.
>
> **The retry is an ordinary chat turn.** `ProposalFailureCanvas` calls `useSendCockpitMessage()`
> directly — the same hook, the same action, the same browser clock — so this canvas now has two
> callers (`BriefRow`'s re-propose and this) and still **no second UI->dispatch entry point**. A
> send with no `threadId` mints a NEW thread, so the button is disabled without one.
>
> `packages/backend/convex/plans.ts` (also watched here) changed by three small writes:
> `landStoryboardRefusal` now stores the refusal CODE, and `persistDeck`/`resetPlan` clear it. The
> `resetPlan` clear is the cockpit-facing one: without it a stale media refusal would put a
> "couldn't build your storyboard" card on the next EMAIL draft composed in that thread.
>
> Verified: apps/web 24 files / 399 tests, backend dispatch 93/93 + media/plans/llmRedaction/skills
> green, `tsc --noEmit` clean in `apps/web`, `packages/backend` and `packages/core`. Full detail
> and the mutation checks are in [[media]].

> Touched 2026-08-16 (refusal-code deploy lane) to clear the §9 Stop hook — **NOT a verification**,
> and deliberately not a `Last verified` line. This session's cockpit-facing change
> (`stageFinanceWrite`'s six refusal stamps) already has a real entry below. The hook re-fired on
> `convex/dispatch.ts` and `convex/plans.ts`, which belong to the concurrent phase-33 lane —
> `dispatch.ts` landed in their `8eb0dd7` ("fix(33-11): one bad variation no longer kills its good
> sibling") mid-session and `plans.ts` is still uncommitted. That work is unread, unrun and
> unattested here, and **the lane that owns it still owes this playbook a real entry and a real
> `Last verified` bump.**
>
> One fact worth recording rather than leaving implicit: `8eb0dd7` is **NOT on production**. This
> session deployed `f7c0cab` from an isolated worktree specifically to keep that lane's in-flight
> work out of the push, so the branch tip and the deployment differ by exactly that commit. See
> [[agent-runtime]] for the deploy record.)

> Last verified: 2026-08-16 (**`stageFinanceWrite` NOW RECORDS WHY IT REFUSED.** All six of its
> exits — `no_updates`, `email_draft_present`, `other_kind_staged`, `unknown_field`,
> `scorecard_field`, `invalid_claim` — stamp a code-owned literal on their own `agentSteps` row
> before returning the same sentence they always returned. **No refusal text changed and no
> behaviour changed**: the model sees byte-identical sentences, and the tool still returns rather
> than throws (18-06). What changed is that a refused call is now distinguishable from a satisfied
> one, which it was not before.
>
> The mechanism: `execute` takes the SDK's second argument (`{ toolCallId }`, which IS the
> `stepKey` — `stepKey: toolCall.toolCallId`) and a local `refused(code, sentence)` helper patches
> the row via `internal.agentSteps.refuse`, keyed on `agentContext.rootRequestId` (the turnId). No
> turnId ⇒ no stamp, same sentence — a diagnostic must never fail a governed turn. This is the
> FIRST tool to use `execute`'s second parameter; the shim at `llm.ts` already passed
> `{ toolCallId: "cockpit", messages: [] }`, so the shape was proven before it was relied on.
>
> Full rationale, the closed-union §4 argument and the ponytail ceiling (these six exits only) are
> in [[agent-runtime]]. `agentSteps.test.ts` gained four tests; cockpitTools 260/261 with the one
> failure belonging to the concurrent lane's `dispatch.ts` audit-payload addition, not to this
> change.)

> Last verified: 2026-08-16 (**TEST-ONLY ADDITION TO A WATCHED FILE — NO COCKPIT BEHAVIOUR
> CHANGED.** `convex/agentSteps.test.ts` gained three tests for the new `smoke:toolCallsForThread`
> read, which returns the per-tool call breakdown for one thread so the eval harness can finally
> tell a tool that was CALLED AND REFUSED from one that was NEVER CALLED. Nothing in the cockpit
> loop, its tool surface, its prompts or its plan handling was touched — the only production file in
> the change is `convex/smoke.ts`, which is harness-facing and carries no cockpit behaviour. The
> full entry, including the ponytail ceiling and the fact that it is NOT yet deployed to production,
> is in [[agent-runtime]]. Recorded here rather than waved through because this file watches
> `agentSteps.test.ts` and a bare `Last verified` bump would say less than the truth: 163/163 green
> across `agentSteps`, `llmRedaction` and `importGuard`, `tsc --noEmit` exit 0.)

> Last verified: 2026-08-16 (33-10 — **WATCH-GATE ONLY.** `watch.json` gives `apps/web/e2e/` to this
> playbook, and 33-10 added a second test to `media-canvas.spec.ts`. Nothing in the cockpit's own
> contracts changed; the media canvas's invariants live in `docs/playbooks/media.md`. The one fact
> worth carrying here: a spec that stages fixtures through `npx convex run` must stage BEFORE it
> authenticates — the CLI ends the browser session on a local deployment — and the phase-33 test
> follows the same sign-in / stage / sign-in-again order the first one documents.)

> Last verified: 2026-08-16 (GOVN-03 precision — **`disconnectMicrosoft`'s comment used to say the
> revocation endpoint DOES NOT EXIST. That was wrong**, and wrong in the direction that stops anyone
> ever revisiting it. Two mechanisms exist; both are correctly REFUSED, and the comment now says so:
> (1) `DELETE /oauth2PermissionGrants/{id}` revokes exactly this app's grant but needs
> `DelegatedPermissionGrant.ReadWrite.All` / `AppRoleAssignment.ReadWrite.All` — admin-consent
> application permissions. Holding tenant-wide grant-deletion rights in order to disconnect
> ourselves is a far larger privilege than the mailbox scopes we need. (2)
> `POST /me/revokeSignInSessions` invalidates the user's refresh tokens for EVERY application, not
> just ours — disconnecting Pikar would sign the user out of Outlook and Teams, minutes later,
> unannounced. So the gap is a deliberate refusal to over-privilege, NOT an absence, and
> `revokedAtProvider: false` stays a hard false. **No behaviour changed in this edit** — the code
> path is byte-identical; only the justification is now true. Do not "fix" this by adding either
> call. backend typecheck exit 0.)

> Last verified: 2026-08-16 (33-08 — **NO NEW COCKPIT BEHAVIOUR; two workspace-watched files moved
> and this records why neither is a cockpit change.** `cards.tsx` gained ONE keyword: its
> `VaultDocButton` is now `export`ed so `MediaCanvas.tsx` can open a scene's citation through the
> same `api.vault.vaultDoc` → `PreviewModal` path every other workspace card uses — a second copy
> over there would have been a second place for that query's `null`-for-another-tenant answer to be
> forgotten. `MediaCanvas.tsx` gained citation chips and failure cards, which are documented in
> `media.md`; it added FOUR direct `useMutation` calls (`confirmClaim`, `setSceneVisual`,
> `retryRender`, plus the existing `regenerateBlock`) and **no new UI→dispatch path** — 33-07's
> single `useSendCockpitMessage` caller is still the only door from this canvas into the agent
> loop. The flexShrink:0 fix on both canvas sheets is untouched.)

> Last verified: 2026-08-16 (33-07 — **THE MEDIA CANVAS CAN NOW SPEAK INTO THE TRANSCRIPT.** The
> cockpit-watched file here is `MediaCanvas.tsx`, and what 33-07 added to it is a UI→chat entry
> point: the "Re-propose (free)" button sends ONE canned turn (`REPROPOSE_MESSAGE` — *"Re-propose
> storyboards for the updated brief."*) through `useSendCockpitMessage`, the SAME hook the composer
> uses. Deliberately NOT a second dispatch path — the message lands in the transcript like any
> other, reads like one a person could have typed, and the agent answers it with the ordinary tool
> loop. **`threadId` is REQUIRED, not optional-with-a-fallback:** `MediaCanvas` and `ReelCanvas`
> both take it as a prop and the button does not render without one, because sending with no thread
> MINTS A NEW THREAD and would move the conversation out from under the canvas the user is looking
> at. The canvas also gained two direct `useMutation` calls (`api.media.editBrief`,
> `api.media.switchDeck`), and **nothing auto-fires from either** — editing a brief chip calls
> `editBrief` and STOPS. The stale badge (`deckStale`, true only when BOTH stamps exist and
> `briefChangedAt > deckProposedAt`) plus that one button are the whole affordance, because the
> re-propose costs a model turn and D7's rule is that a spend follows a click. Every string on the
> surface comes from `mediaCanvasView.ts`; the component is markup and wiring. Verified this
> session: `mediaCanvas.test.ts` 78/78 green and `tsc --noEmit` clean in `apps/web`. **NOT seen in a
> browser and no cockpit send path was exercised live** — 33-10 owns that gate. The media half of
> 33-07 is entered in `media.md` by the lane that owns it (`860671b`).)

> Last verified: 2026-08-16 (22.1-05 Task 2 — tenant erasure calls each connected provider's
> existing disconnect before registry deletion, reports Google and Microsoft separately, and
> continues local credential/data removal when a provider attempt fails). Focused deletion tests
> 6/6 and backend typecheck passed; no live tenant was deleted.

> Touched 2026-08-15 (phase 14→25 gap-audit session) to clear the §9 Stop hook — **NOT a
> verification**, and deliberately not a `Last verified` line. **This session changed no product
> code at all**: it re-cut `.planning/phases/25-private-beta-productionization/25-PREREQUISITE-EVIDENCE.md`
> and nothing else. The hook fired on
> `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx`, which is *still* carrying the same
> uncommitted in-flight changes from the concurrent Drive/media lane that `f885a82` named earlier
> today — now uncovered for the third session running. **The lane that owns it still owes this
> playbook a real entry and a real `Last verified` bump.** Nothing below covers it.

> Touched 2026-08-15 (item-4 session) to clear the §9 Stop hook — **NOT a verification**, and
> deliberately not a `Last verified` line. The item-4 change (the `cockpit-agent` body: a new
> `## The user's calendar` section plus the merge of the two document sections) touches NO
> cockpit-watched path — its watched playbooks are `agent-runtime.md` and `skill-registry.md`,
> and both carry real entries for it. Two OTHER lanes' files tripped the hook here:
>
> - `packages/backend/convex/llm.ts` and `convex/cockpitTools.test.ts`, last changed by
>   **`f6fe5d2` (21-02, "the refs-only basis rule moves to the boundary every producer runs")**,
>   which landed mid-session and updated NO playbook. **That lane owes this file a real entry and a
>   real `Last verified` bump** for what the boundary move did to the cockpit tool surface.
> - `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx`, STILL uncommitted from the
>   concurrent Drive/media lane — the same in-flight work `f885a82` named earlier today. Still
>   unread and unattested at the time — since read and entered; see the MediaCanvas flex-crush entry below.
>
> Nothing below covers either. Recorded in `f885a82`'s form on purpose: the hook cannot be scoped
> to one lane's diff, so the honest move is to say whose work is uncovered rather than to assert a
> verification nobody performed.

> Touched 2026-08-15 to clear the §9 Stop hook — **NOT a verification**, and deliberately not a
> `Last verified` line. `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` carried
> uncommitted in-flight changes from another lane while this session was committing the PDF
> end-to-end work (vault preview + `storedMimeType`), which touches no cockpit-watched path. That
> MediaCanvas work is unread and unattested by this session. **The lane that owns it still owes
> this playbook a real entry and a real `Last verified` bump.** That debt is now paid — see the
> MediaCanvas flex-crush entry below (read and attested 2026-08-15).
>
> (Recorded in the same form the Vault lane used when this session's own in-flight files blocked
> `vault.md` — the hook cannot be scoped to one lane's diff, so the honest move is to say whose
> work is uncovered rather than to assert a verification nobody performed.)

> Last verified: 2026-08-15 (MediaCanvas flex-crush fix, read and attested by the phase-33 planning
> session — **both canvas sheets in `MediaCanvas.tsx` now set `flexShrink: 0`.** `briefingSheet`'s
> `overflow: hidden` flips the flex min-height auto→0 inside the fixed-height `.pane-canvas`
> section, so without it the pane crushed the sheet to the leftover viewport and clipped the whole
> storyboard, unscrollably. Applied to BOTH the reel sheet and the image sheet; layout-only — no
> data, tool-surface, or governance change. This pays the debt the two notes above recorded.)

> Last verified: 2026-08-15 (whole-branch review final-fix pass, Finding 2). `recordScorecardAnswer`
> (`llm.ts` ~3517, the "store" write half of vault-first→ask→store) used to tell the model, verbatim,
> "it'll show as user-provided" — false since Task 2 of this plan: `recordScorecardAnswerInternal`
> stamps `actor: "agent"` (`evaluations.ts` ~723-728), and `applyScorecardAnswer` keeps an agent write
> OUT of `userProvided`. The model relayed that false sentence to the user unchanged. Corrected both
> the returned sentence and the header comment above the tool (~3512-3513) to say the figure is saved
> and recorded as relayed by the assistant, not confirmed by the owner. No behaviour change — the
> write path was already correct; only what the tool SAYS about it was wrong. This does not touch
> `stageFinanceWrite`'s gate at `llm.ts:2890`, documented below — still deliberately unchanged.
>
> Note (scorecard-field-provenance, Task 5 fix round 2 + Task 6 close-out — CONSOLIDATED,
> COMMENT-ONLY, no behaviour change from this note.) `llm.ts`'s `stageFinanceWrite` tool
> (`buildCockpitTools`, the `stageFinanceWrite: tool({...})` handler starting ~`llm.ts:2798`) STILL
> REFUSES `field: "cac"` (and its five scorecard-store siblings) before staging a plan — the actual
> gate is the `if (cashInputSpec(u.field as CashInputField).store === "scorecard")` check at
> `llm.ts:2890`, and both the gate and its user-facing refusal sentence are UNCHANGED by this plan.
>
> **This is deliberate, not an oversight.** The plan's applier (`cash.ts`'s `applyFinanceClaims` /
> `writeFigureRow`) now ACCEPTS a scorecard-field claim with honest provenance — see
> `docs/playbooks/dashboard-pages.md`'s consolidated entry. Widening what the MODEL may PROPOSE in
> chat is a separate decision the store-level unblock does not make on its own, so the gate stands
> pending its own review. **What lifting it would require:** deleting the `if` at `llm.ts:2890` (and
> its mirrored refusal message) is a one-line change, but per the spec's own §4.4 caution — a
> skill-body/tool-shape change has previously shifted which optional arguments the model emits and
> broken an unrelated fixture — it needs an A/B run against the existing `cockpit-agent` eval
> fixtures BEFORE activation, not just a code deletion. Nobody has proposed that A/B yet.
>
> **The DOCUMENT-derived path is unaffected by this gate — it does not go through this tool at
> all.** A future vault-document writer (or a hand-seeded/legacy plan row) reaches
> `applyFinanceClaims` directly, which this plan unblocked; only the CHAT tool's own proposal
> surface is held back.
>
> The explanatory comment above the gate (`llm.ts` ~2879) and its mirror in `cockpitTools.test.ts`
> (~2417) were corrected in the same round: both used to claim the scorecard store "cannot carry
> provenance" and that `applyFinanceClaims` "refuses every scorecard field unconditionally" — both
> false since Tasks 1/5 of this plan (`evaluations.fieldProvenance`; `cash.ts` no longer produces
> `agent_cannot_update_figure`). See `dashboard-pages.md` and `business-evaluation.md` for the
> actual capability change this comment now describes correctly, and
> `docs/decisions/021-userprovided-fieldprovenance-split.md` for the decision record.
>
> **The `packages/contracts/skills/cockpit-agent.md` skill-body correction made alongside this note
> (commit `e71a4ab`) has NO RUNTIME EFFECT until re-seeded and activated — this plan does neither.**
> See `docs/playbooks/skill-registry.md` for why that matters and how to tell which body is actually
> live.
>
> Last verified: 2026-08-15 (**the SOURCE card's grounding list folds; the OUTPUT card's
> deliberately does NOT**) against `SourceCard`/`GroundedSources` in `cards.tsx`. Owner report: the
> link list "is just clouding the workspace". Grounding is PROVENANCE — it answers "what did you
> read?" when asked, and most turns are never asked — so the count in the card header is the part
> that always matters and the titles are the audit trail behind it. `GroundedSources` renders
> inline at or below `SOURCE_INLINE_CAP` (3) and folds into a native `<details>` above it, with the
> real number in the summary so the fold never hides HOW MUCH was hidden. Native `<details>`, not a
> `useState` toggle: keyboard operable, screen-reader announced and Ctrl+F-findable for free
> (ponytail rung 4). **THE CAP IS NOT APPLIED TO THE OUTPUT CARD, and that is a decision, not an
> oversight:** that list looks identical and is not the same thing — its `#index` ordering IS the
> addressing grammar `createDocument`'s replace flow depends on ("make the second one shorter"), so
> folding it would hide a control rather than noise. **THE INVARIANT IS THAT COLLAPSING NEVER DROPS
> A SOURCE** — every title stays in the markup and the disclosure only changes visibility. A
> `.slice(0, CAP)` would silently destroy the provenance trail the card exists for, and would look
> correct in every count-based assertion. That is why the check renders to markup
> (`renderToStaticMarkup`, the ApprovalsStateNotice/ImportDone precedent) instead of asserting a
> pure function. **Mutation-proven, and the proof is the interesting part:** introducing that exact
> slice left FOUR of the five tests green and reddened only *"EVERY source survives the fold"* with
> `expected '<details …' to contain 'Source document 4'`. **MEASURED:** workspace suite 86/86 (5
> new), web `tsc --noEmit` exit 0, biome clean. That typecheck also caught a real miss —
> `app/vaultTokenScope.test.ts`, committed one commit earlier, did not compile under strict null
> checks (a regex group is `string | undefined`, and a truthiness test on the match array does not
> narrow it); fixed in the same pass. **NOT VERIFIED IN A BROWSER:** no thread in this deployment
> grounds against more than three documents, so the folded state has never been painted live — the
> render test is the only proof of the `> CAP` branch.

> Last verified: 2026-08-15 (20.1-02 offline half — **the body learns Drive, and learns its
> boundary.** New `## Finding things in the user's Drive` section: 'where is X' is `findInDrive`
> always (never a memory answer); `listDriveFolders` opens ONE named level and is not a way to
> hunt — the section exists because prod v2 was observed burning full 8-step budgets walking
> folders on an INBOX question, so it also states Drive is for document questions only; import is
> the USER'S click in the Vault Drive panel and the agent can never claim ingestion; connection
> problems relay the tool's own sentence verbatim. Owed fixture: 39-drive-read
> (`driveReadToolCount`, floor — agent-runtime.md carries the observable). Candidate unseeded at
> this entry.)
>
> Last verified: 2026-08-15 (ACTN-02 — **the CALENDAR card: the agent's calendar reads now leave a
> mark on the canvas**) against `checkAvailability` + the new `calendarViews` content plane. Owner
> report, verbatim: "it just replied with a message … no brief card in the workspace." Diagnosis:
> the canvas renders ONLY what something writes down — plan rows and `briefings` rows — and
> `checkAvailability` returned a string to the model loop and persisted nothing, so the answer
> existed only as chat prose. This affected **both providers equally**; it was never a Microsoft
> bug. Shipped the `briefings` pattern for the calendar and nothing else: new `calendarViews` table
> + `calendarViews.ts` adapter (mirrors `briefings.ts`, writes NO log-plane row, validators DERIVED
> from the schema), an additive write in `llm.ts` `checkAvailability` placed **above** the
> empty-window return, and a `CalendarCard` in `cards.tsx` on the SourceCard/OutputCard footing
> (above the plan-status branches — an availability read carries no plan row, so a plan-gated card
> would never appear). **The tool's description and return strings are UNCHANGED** — the model's
> behaviour and arguments are untouched, deliberately avoiding the known skill-prose→tool-args
> hazard. Times render in the ROW's `tz`, never the browser's; `truncated` (Microsoft's scan cap)
> renders an explicit note so a partial read cannot read as complete. **The load-bearing invariant
> is that an EMPTY read still writes a row** — "nothing scheduled" is the answer, and skipping the
> write restores the blank canvas for precisely the case a user misreads as broken. Mutation-proven,
> not read: adding `if (res.busy.length > 0)` above the insert turns *"an EMPTY availability read
> STILL writes a row"* red with `expected [] to have a length of 1 but got +0`. Assertions are on
> the STORED ROW, never the reply string — the reply was already correct while the bug was live.
> **MEASURED:** `cockpitTools.test.ts` 131/131 (3 new, every pre-existing `checkAvailability` case
> still green), `calendarCard.test.ts` 4/4 (`fmtBusyBlock` same-day / cross-midnight / tz-honesty /
> zero-length), backend `tsc --noEmit` exit 0, web `tsc --noEmit` exit 0. **NOT addressed, and NOT a
> rendering gap:** Outlook has no inbox brief because `briefInbox` is hardcoded to `internal.gmail.*`
> and `graph.ts`/`delivery.ts` do not exist on disk — that is Phase 25 (25-05/25-06/25-09). **NOT
> VERIFIED IN A BROWSER:** no live availability turn has painted this card yet; the automated proof
> is the stored row, not the paint.

> Last verified: 2026-08-15 (20-12 v24 cycle — the v23 run `cc63246f` came back 36/38 and BOTH
> reds were pre-existing body-judgement flaws, not the media delta: fixture 37 routed a stated
> cash-on-hand to `recordScorecardAnswer`+`evaluateBusiness` (the stage branch said 'one of its
> five', abstract, while the scorecard branch carried a literal tool + dot path — concrete beats
> abstract), and fixture 20 ran `resetPlan` then RE-STAGED the cancelled subject+body because
> 'draft to X instead' reads as the same email re-addressed. Two bullets edited: the five are now
> named inline with `stageFinanceWrite`, and the fresh-start bullet states 'instead' is a NEW
> email. v24 seeded, byte-verified against the md — and gate run `62903ef6` is GREEN: 38/38,
> $0.3424 exec + $0.1197 specialist = $0.4621, retries 23/35/38b only, fixtures 20/37/38 all
> first-try. Evidence recorded on cockpit-agent v24, and the owner activated it with the exact
> words the checkpoint required — activateSkill flipped it through EVAL_GATE and getActiveSkill
> reads back version 24, body byte-identical to the evidenced md. Task 5 (no-spend reel
> observation, fal spend stays $0) is the one open 20-12 gate. The
> `workspace/cards.tsx` change in this tree is the concurrent vault/finance lane's, not this
> session's.)
>
> Last verified: 2026-08-14 (20-12, after gate run `420c852b` — **THE FORMAT CAVEAT SWALLOWED THE
> ACTION.** Fixture 38b asked for a slide deck and the agent made **no tool calls at all** — no
> `dispatchMedia` (the routing half worked) and no `createDocument` either. The cause was the body
> bullet added hours earlier: *"Asked for a `.pptx`, say what you can write instead"*. "Slide deck"
> pattern-matches onto that, so the model explained instead of creating. Rewritten so the caveat
> governs the CLAIM and never the ACT: a deck they READ is a document, an explicit ask is the
> go-ahead, "six or seven slides" is still a document you WRITE laid out as sections — *"never let
> this caveat become a reason to produce nothing."* This is a general drafting hazard for this body:
> a rule about how to DESCRIBE an output, written next to the rule about producing it, can be read
> as permission to skip the producing. Still a parked candidate — NOT live.)

> Last verified: 2026-08-14 (20-12 offline half — **the body learns to pick the video tool, and to
> stop picking it for documents.** A new `## Creating images and video` section teaches
> `dispatchMedia` against the CURRENT contract: the proposal arrives later as a workspace card (not
> in the turn), it is a scene deck of 15/30/60 seconds mixing four picture kinds, the proposal is
> FREE and the reel is not, and Generate is a click only the user can make. The plan's draft wording
> ("the shipped 5/10-second-block reel") was stale twice over and was NOT used. Three bullets also
> land in `## Creating a document or a post`, all three from one real transcript: a slide deck /
> one-pager / report is `createDocument` and never `dispatchMedia` (the agent invoked the VIDEO
> specialist on three consecutive turns for a deck); `createDocument` writes markdown plus a PDF and
> there is no PowerPoint output to report having produced; and a created document appears in the
> WORKSPACE as well as the vault, so "I cannot open files" is false while the card is on screen.
> The `dispatchMedia` tool DESCRIPTION in `llm.ts` was corrected in the same commit — it still said
> "a deck of blocks" — because a tool result only reaches the model AFTER it has chosen the tool.
> Body + LF mirror regenerated together; mirror drift test green. NOT YET LIVE: this is a gated
> candidate awaiting its eval gate and owner activation.)

> Last verified: 2026-08-14 (20.2 wave 8, **THE APPROVE ARM OPENS ON SCENE DECKS** — scoped to
> `executePlan`'s media pre-step and `dispatch.persistStoryboard`'s comment. The arm refused a scene
> deck by name (`scene_render_not_ready`) from wave 2 until now, because the specialist could not
> WRITE one for a human to approve; its body does as of this wave, so the refusal is deleted rather
> than left as a member nothing can reach. The arm now branches on `sceneDeckOf(plan)` FIRST and
> reserves through `reserveSceneJobInner` — the same function the canvas prices with — so approving
> from the agent and clicking Generate on the canvas are one gate with one number. Pinned in
> `cockpit.test.ts`: the `spendEvents` reserved movement equals `jobEstimate.totalCents` for the same
> deck, the clips are bought at their OWN lengths (8 s and 12 s, not a deck-wide `clipSeconds`), and
> a deck that does not sum to its declared target refuses BEFORE the CAS with zero rows. The
> reservation stays inside this mutation, unchanged and deliberately: this mutation IS the
> `proposed → approved` CAS, which is what makes approve-once reserve-once true without a second
> idempotency mechanism. See `docs/playbooks/media.md` and ADR-019.)

> Last verified: 2026-08-14 (17-07 Task 1 — **the Graph concurrency PROBE now exists**, in
> `microsoftCalendar.ts`. It has NOT been run: that still needs a real Azure app registration and a
> DISPOSABLE Microsoft account. `17-GRAPH-CONCURRENCY-PROBE.json` is still absent and must never be
> hand-written.)
>
> **Why the probe lives here and not in `smoke.ts` as the plan lists.** `freshGraphToken` is in this
> `"use node"` module; `smoke.ts` is not one, and importing across that boundary is exactly what
> Convex forbids. Recorded as a deviation rather than worked around.
>
> **`internal.microsoftCalendar.graphConcurrencyProbe` is gated on the EXACT string
> `PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE === "true"`** and refuses BEFORE reading the token, so a
> stray invocation cannot even authenticate, let alone touch a calendar. Mutation-proven: relaxing
> it to a truthy check lets `"false"`, `"TRUE"`, `"1"` and `"yes"` through — four cases red.
>
> It creates ONE attendee-free event, reads its etag, conditionally updates it (the POSITIVE
> WITNESS — without it, a Graph that rejects *every* `If-Match` would look identical to one that
> enforces it), then attempts a stale `If-Match` PATCH and a stale `If-Match` DELETE, re-reading
> after each to prove the newer event survived. `DELETE`, never `/cancel` — cancel mails attendees.
> Cleanup runs in `finally` with the CURRENT etag and asserts a 404. The artifact is refs-only:
> hashes, statuses, booleans. `accountIdHash` is the PIKAR tenant hashed, deliberately not the
> Microsoft account id — reading `/me` needs `User.Read`, and widening the ADR-018 grant to label a
> bookkeeping artifact would be a permission asked for by paperwork.
>
> ⚠ **RUN ONLY AGAINST A DISPOSABLE ACCOUNT**, capture stdout to the artifact path, then REMOVE the
> flag. The exact three commands are in the block comment above the action.
>
> `microsoftCalendar.test.ts` 43/43 (the six gate cases are the offline-provable half; the 412
> behaviour itself is the thing only a live account can answer).
>
> Last verified: 2026-08-14 (17-07 Tasks 1-3 — **Microsoft Calendar read + create, behind the same
> stage → Approve boundary**. ⚠ **ACTN-02 IS STILL UNMET AND 17-07 IS NOT COMPLETE**: Task 1's
> disposable-account Graph concurrency PROBE has not run and cannot run without a real Azure app
> registration. It gates Microsoft MANAGEMENT (17-08), not this create-only slice — see below.)
>
> **New module: `microsoftCalendar.ts`**, the twin of `calendar.ts`, registered here beside it. Two
> provider facts drive its shape and NEITHER matches Google:
>
> 1. **Availability comes from `/me/calendarView`, NOT `getSchedule`.** getSchedule is the obvious
>    freeBusy analogue and is unsupported for delegated PERSONAL accounts — half of what the
>    `common` endpoint admits. calendarView returns EVENTS, so `$select=start,end,showAs` is the
>    content firewall, not tidiness: subject, body, location, organizer and attendees are never
>    requested, so they cannot be logged, audited or returned. Mutation-proven by asserting on the
>    REQUEST (adding `subject` to `$select` turns the named test red).
> 2. **Microsoft ROTATES refresh tokens; Google does not.** `updateAccess` takes an optional
>    `refreshToken` and the adapter passes it through only when present. Dropping a rotated token
>    leaves the stored one dead and the connection unrecoverable without re-consent.
>
> **`@odata.nextLink` is a provider-supplied URL that this code puts a BEARER TOKEN on.** An
> unvalidated next link is a credential-exfiltration primitive. `safeNextLink` requires https, the
> exact `https://graph.microsoft.com` origin, and a `/v1.0/` path prefix — never a substring or
> hostname `includes`. Mutation-proven: removing it sends the token to `evil.test`, plain http, a
> suffix-attached lookalike (`graph.microsoft.com.evil.test`), `/beta`, and `javascript:` — five of
> six cases red. Paging is capped (5 pages / 500 items) and reports `truncated` into the audit
> rather than paging forever.
>
> **THE COMPATIBILITY GUARANTEE, and it is the load-bearing claim of this plan.** Every plan staged
> before 17-07 has NO `calendarProvider`, and each must still take the Google path byte-for-byte.
> Expressed ONCE as a pure default (`parseCalendarProvider`, absent → google) rather than an `if`
> per call site. Proven by WHICH HOST is contacted — the only evidence a stubbed response shape
> cannot fake. Mutation-proven: defaulting to Microsoft turns FOUR tests red, three of them
> pre-existing Google ones.
>
> `internal.calendar.createEvent` REMAINS the single retried entry `executePlan` calls; the provider
> branch sits AFTER plan/tenant/stage validation so both providers inherit identical refusals (a
> partially-staged row is terminal on either, before any token or network work).
>
> **`CreateEventResult` widened with `provider` and `etag`.** The etag is what event-specific
> concurrency needs in 17-08, captured at create because both providers offer it only there.
> Google's 409 branch now does ONE bounded GET of the deterministic id to recover the etag a
> duplicate response never carries; a failed recovery degrades to `etag: null`, which means
> "management must re-read first" and must never be read as "any version will do".
> `calendarComplete.ts`'s runtime projection accepts BOTH fields as OPTIONAL on purpose: a retrier
> result from the PREVIOUS deploy can still be in flight, and rejecting it would strand a really-
> created event as an unparseable result, leaving the plan at `delivering` forever.
>
> **A Microsoft outage writes a MICROSOFT reconnect row.** `calendarUnavailable` now takes the
> provider. A `gmail_reconnect` row for an Outlook failure sends the user to the GOOGLE consent
> screen: the banner clears, the real problem stands, the next check fails identically. Mutation-
> proven red.
>
> **The provider is a FACT ON THE ROW, never conversation history** — `proposeCalendarEvent` stages
> `calendarProvider` and `executePlan` routes on stored state after Approve. Both tools take a
> CLOSED optional enum (`google`/`microsoft`), never a free string: the provider selects which
> credential and which host is reached, so an arbitrary model-supplied value would be a routing
> decision taken by prose. Staging still performs ZERO network calls (asserted). The plan card names
> the calendar, because it is the last surface before an irreversible write and "Google" on a
> Microsoft event is a false promise at the moment of decision.
>
> **WHAT IS NOT DONE, AND MUST NOT BE READ AS DONE:** no update/move/cancel on either provider; no
> `If-Match`/412 path; the Graph concurrency probe is unrun, so `17-GRAPH-CONCURRENCY-PROBE.json`
> does not exist and 17-08 is BLOCKED by its own gate. Graph collapses a repeated `transactionId`
> silently rather than reporting a duplicate, so the Microsoft adapter reports `duplicate: false`
> honestly instead of guessing — unlike Google's 409, it cannot distinguish first-write from retry.
>
> **Measured:** backend **1759 passed / 24 skipped** (79 files) · core 936/936 · backend and web
> `tsc --noEmit` exit 0 · `calendar.test.ts` 44/44, `microsoftCalendar.test.ts` 36/36,
> `cockpitTools.test.ts` 128/128. Five mutations red then reverted.
>
> Last verified: 2026-08-14 (17-06 Task 3 — **the H3 offline regression, paired**. The Microsoft
> connect/disconnect/consent SURFACES are owned by `onboarding.md`, not this file; see the split
> note there. This entry covers only the Calendar-runtime half and the new browser spec.)
>
> **H3, and why a second test was needed when one already passed.** `calendar.test.ts` already had
> "a grant lacking free/busy scope returns reauth before even the refresh POST", asserting
> `not.toHaveBeenCalled()`. That assertion is satisfied just as well by a `freeBusy` that never
> fetches under ANY conditions — a broken adapter passes it perfectly. The new
> `H3 — a pre-widening grant reauths with ZERO fetches while a calendar grant reaches the adapter`
> pairs it with a POSITIVE WITNESS: same action, same args, one scope wider, and the fetch DOES go
> out. The contrast is what proves the stored-scope check at `calendar.ts:149` is the cause.
>
> Mutation-measured: `if (false && !hasScope(...))` turns BOTH red — the old one at "expected spy to
> not be called at all, but actually been called 1 times", the new one at
> `{ reason: 'unavailable' } to deeply equal { reason: 'reauth' }`. The negative mock deliberately
> returns a VALID JSON body; with an empty one the mutation died on "Unexpected end of JSON input",
> a crash rather than the claim.
>
> This is the offline half only. **The live negative is still owed by Plan 17-11** and cannot be
> substituted by this test. `calendar.test.ts` 40/40.
>
> Last verified: 2026-08-14 (17-06 Task 2, **THE `/microsoft/callback` EXCHANGE**. Still **NO
> PROVIDER CALL AGAINST GRAPH AND ACTN-02 IS NOT SATISFIED** — this is the OAuth round-trip only.)
>
> **The Microsoft callback deliberately diverges from the Gmail callback beside it, twice, and both
> divergences are tightenings. Do not "make them consistent" by loosening this one.**
>
> 1. **Fixed error codes, never provider text.** The Gmail route interpolates `${oauthError}` and raw
>    prose into its redirect. A Microsoft error body can carry the authorization code, correlation
>    ids and directory/tenant names — and a redirect is written to browser history, sent as a
>    `Referer`, and logged by every proxy in between. So failures map onto the closed
>    `MICROSOFT_CALLBACK_ERRORS` set (`cancelled`, `missing_callback`, `invalid_state`,
>    `exchange_failed`, `missing_refresh`) and the connect page owns the wording via
>    `microsoftCallbackMessage`, whose default branch returns a FIXED sentence — an unrecognised or
>    hand-typed `?microsoftError=` value is never reflected back onto the page.
> 2. **No provider detail is thrown either**, because a thrown message becomes a Convex log line.
>    Failure paths return a redirect; the error body is never even read on a non-ok exchange.
>
> **Two invariants with teeth:**
> - **State is verified BEFORE the credentialed token POST.** Mutation-measured: deleting the early
>   return turns the named test red at `Validator error: Expected string, got null` — `store`'s
>   `v.string()` is a real second line of defence — but it fires TOO LATE, after the client secret
>   has already been spent on the attacker's code. The test therefore asserts on `fetch` not being
>   called, not only on the absent row.
> - **The GRANTED scope is stored, never the requested one.** Microsoft may grant less than was
>   asked for; storing `MICROSOFT_SCOPES` would make `mailReady` claim a capability the grant lacks,
>   which is the exact lie the derived-readiness booleans exist to prevent. An absent `scope` falls
>   back to EMPTY — an unknown grant must read un-ready, never fully ready.
>
> Success lands on `/dashboard/profile` (Connections). The refresh token, access token and
> authorization code are each asserted absent from the redirect.
>
> **Measured:** `httpAuth.test.ts` 13/13, `microsoftAuth.test.ts` 25/25, `microsoft.test.ts` 22/22,
> `calendar.test.ts` 39/39, `importGuard.test.ts` 82/82 — **159 backend tests green together**; core
> and backend `tsc --noEmit` exit 0 each; biome clean. The Google callback is proven untouched by a
> test that runs it end to end and asserts the grant lands in `gmailTokens` with
> `microsoftCalendarTokens` still empty.
>
> Last verified: 2026-08-14 (17-06 Task 1, **THE MICROSOFT GRANT — ONE CONNECTION, NOT TWO**, per
> [ADR-018](../decisions/018-one-microsoft-connection-not-two.md). **NO PROVIDER CALL HAS BEEN MADE
> AND ACTN-02 IS NOT SATISFIED** — this registers the auth substrate only; the Graph Calendar
> adapter, the management operations and the live gates remain owed by 17-07…17-11.)
>
> **What ADR-018 prevented, and why it is a playbook entry rather than a footnote.** Plans 17-06
> (Calendar) and 25-06 (Outlook mail) each independently specified a Microsoft delegated OAuth flow
> for the SAME account, colliding on `http.ts`, `ReconnectBanner.tsx` and this file. Both were
> unexecuted, so nothing was unwound. **17-06 now owns the one shared connection; 25-06 consumes it
> and adds the mail adapter only.** Do not re-add a Microsoft callback or re-generalize the reconnect
> banner in 25-06 — 17-06 does both, once.
>
> **New watched modules:** `packages/core/src/microsoft.ts` (+ test) and
> `packages/backend/convex/microsoftAuth.ts` (+ test), registered beside `gmailAuth.ts` because this
> playbook already owns the Google twin and `http.ts`.
>
> **Invariants that must not break:**
> - **The grant is the UNION** — `offline_access openid profile email Calendars.ReadWrite Mail.Send
>   Mail.Read`. One consent, one token row, one disconnect. The identity scope is NOT padding:
>   `Mail.Send` sends AS the connected account, so the product must be able to SHOW the sending
>   address before a human approves a plan.
> - **The signed `state` carries a provider discriminator** (`microsoft:<tenantId>`). This is
>   load-bearing and mutation-proven: removing it makes a **Google-issued state verify as Microsoft**
>   (the test fails with `expected 'tenant_microsoft' to be null`). Never sign the bare tenantId.
> - **`microsoftStatus` returns booleans and timestamps ONLY** — never a token, never the raw `scope`
>   string, which is a capability inventory. `calendarReady`/`mailReady` are DERIVED, for the same
>   reason `driveReady` is on the Google side: `connected` alone cannot tell a pre-widening grant
>   from a current one, and a mail control that trusts `connected` walks the user into a 403.
> - **`store` REPLACES the row.** A widened grant must overwrite the narrower `scope`, or `mailReady`
>   stays false forever after the widening.
> - **A Microsoft reconnect retires ONLY `microsoft_calendar_reconnect`.** Mutation-proven: relaxing
>   the filter to `endsWith("_reconnect")` clears the user's `gmail_reconnect` banner and hides a
>   Google connection that is still genuinely broken.
> - **`updateAccess` accepts an optional `refreshToken` because MICROSOFT ROTATES REFRESH TOKENS**
>   and Google does not. Dropping a rotated token leaves the stored one dead and the connection
>   unrecoverable without re-consent.
> - **`disconnectMicrosoft` is NOT parity with `disconnectGoogle` and must never be described as if
>   it were.** The v2 delegated flow used here has no revocation endpoint, so this deletes the local
>   row and audits `revokedAtProvider: false` as a HARD false. Removing consent stays a separate user
>   action the user takes at `account.microsoft.com/privacy/app-access` (personal) or
>   `myapps.microsoft.com` (work/school) — **two different portals; naming only one misdirects half
>   the users.** **GOVN-03 inherits this limitation and must state it.**
> - The table keeps its 17-05 name `microsoftCalendarTokens` though it now holds the union grant —
>   the `gmailTokens` precedent: renaming a Convex table is a migration for cosmetic gain.
>
> **Measured at this entry:** `microsoftAuth.test.ts` 25/25, `microsoft.test.ts` 16/16,
> `calendar.test.ts` 39/39, `importGuard.test.ts` 82/82 (146 backend tests green together); core and
> backend `tsc --noEmit` exit 0 each; biome clean. Three mutations turned named tests red and were
> reverted: the state discriminator, the notification filter, and the qualified-scope match.
>
> Last verified: 2026-08-14 (the created-artifact surface, second pass — **A DOCUMENT REFERENCE IN
> THE WORKSPACE NOW OPENS THE DOCUMENT, IN THE WORKSPACE.**) The entry below fixed what the Output
> card SAYS; this fixes every other document reference on the surface, which was still
> `<Link href="/dashboard/vault">` — a whole-route jump that drops the reader into an unfiltered
> grid and leaves the conversation behind. `SourceCard`'s own comment named the upgrade and
> deferred it ("add a getVaultDoc(byId) tenant query + import PreviewModal"); `api.vault.vaultDoc`
> is that query and this took it. `cards.tsx` gains `VaultDocButton` (a button, never a link — it
> opens a dialog in place, and dressing that as navigation was the lie the route-jump told) and
> `VaultDocModal`, which mounts the SHIPPED `vault/PreviewModal` rather than a second viewer: it
> already renders markdown, PDFs, images, video, the extraction/failure states and the entity
> chips, and a second one would be a second thing to keep in step with `previewState`. Three call
> sites moved: grounded-source titles, the Output card's trailing control (now "Open full
> document", the stored PDF/download/entities that the inline text preview cannot show), and
> evaluation citations. A row with no docId renders as plain text, never a control that does
> nothing; `vaultDoc` returning `null` (deleted, or another tenant's) renders nothing, so a card
> never asserts a document exists because a stale row names it. Evidence: web workspace + vault 55
> green, `@pikar/web` typecheck clean apart from two pre-existing foreign-lane `renderReel.ts`
> errors.

> Last verified: 2026-08-14 (the CREATED-ARTIFACT surface, from a real cockpit transcript — the
> agent told the user it "can't open files directly in the workspace" when the Output card was
> already rendering the document there, and separately claimed to have written a deck "in
> PowerPoint format" that no code path can produce. Four root causes, four code-only fixes, no
> skill-registry change. See "The created-artifact surface" below. web 245/246, backend media +
> cockpit + cockpitTools + llmRedaction + skills 495 passed, both typechecks clean.)

> Last verified: 2026-08-14 (⚠ **REGISTRATION OF TWO PREVIOUSLY UNWATCHED MODULES, FROM SOURCE
> REVIEW OF AN UNCOMMITTED FOREIGN-LANE DIFF — NOT A RUN.** No cockpit turn, eval or gate was
> executed; both modules were read, not exercised. They were landing outside any playbook's watched
> paths, which is why they are registered here now. **`cockpitCapabilities.ts` — DETERMINISTIC
> CAPABILITY ROUTING, AND IT IS CONTAINMENT, NOT A SECOND MODEL CALL.** `routeCockpitIntent` matches
> a ten-capability regex table against the turn text; `applyGmailCapability` then returns the
> executive tool record with the 18 `GMAIL_TOOL_NAMES` keys **structurally absent** when the rail is
> off, so a Gmail-less tenant cannot have an email tool selected rather than merely being refused
> after selection — the same absence-over-refusal shape the dispatch guard uses. `llm.ts:3548` is the
> single application point and `llm.ts:4541` the single decision point; keep it that way. Three traps
> the source already encodes and a changer must not undo: the email pattern REQUIRES an action verb
> so "email marketing strategy" does not seize the Gmail rail; a capitalised `Email Amina` is caught
> by a SEPARATE case-sensitive rule after the case-insensitive pass, because lower-casing first would
> swallow it; and `shouldUseGmailCapability` resolves multi-turn ambiguity by letting a bare answer
> continue an active email plan unless `EXPLICIT_NON_EMAIL_ACTION` matches. `isPinnedCockpitEvaluation`
> deliberately keeps email tools alive for `eval-` tenants with a pinned version, because the golden
> fixtures stage email plans on a tenant that is intentionally disconnected — **a change that drops
> that exemption turns the email fixtures red for a reason that has nothing to do with the model.**
> **`mediaIntent.ts` — the narrow bypass.** `isExplicitVideoCreationRequest` is the ONLY thing that
> lets a turn skip model tool selection for video (`llm.ts:4562`, and only when `!smokeOp &&
> !gmailRequired`). It is deliberately imperative-only, and it returns false outright when the text
> mentions email/attach/forward/reply/recipient, so a mixed request can never have its email half
> discarded by the media route. Widen it and you are widening what bypasses the model, which is the
> opposite of what the rest of this playbook is for. Neither module's routing has been measured
> against real turns by this review.)

> Last verified: 2026-08-12 (Plan 26-18 — Sales Pipeline sidebar activation). Owner UAT was
> accepted and the existing `/dashboard/pipeline` surface was exposed in the primary sidebar.
> This is a navigation-only release: cockpit planning, approval boundaries, consent suppression,
> recipient resolution, and provider execution are unchanged. The Pipeline UAT remains the
> executable end-to-end contract for those safety seams. Evidence IDs are `ACTN-05` and `PIPE-01`;
> UI rollback may hide the Pipeline entry, but suppression and the required postal footer remain
> irreversible safety behavior.
>
> PREVIOUS:

> Last verified: 2026-08-12 (production-release qualification — the Calendar registry test helpers
> now preserve the application's schema type by accepting `ReturnType<typeof harness>`. This is a
> test-only typing repair: runtime Calendar behavior, schema, indexes, and provider calls are
> unchanged. The backend typecheck and focused Calendar test are the executable gate.)
>
> PREVIOUS:
>
> Last verified: 2026-08-11 (17-05, the ACTN-02 GAP-CLOSURE SUBSTRATE — **NO PROVIDER CALL WAS
> ADDED. Google create is still the only executable Calendar target, and ACTN-02 is still not
> satisfied.**) `calendar_manage` is the SEVENTH `ACTION_TYPES` member and the `externalAction`
> arm's THIRD occupant, and its `EXTERNAL_TARGETS` entry is a stub that throws
> `calendar manage not wired (17-08)`. `schema.ts` gained the `calendarEvents` registry and the
> `microsoftCalendarTokens` store (nothing writes either yet), plus five `plans` proposal fields.
> `plans.ts` stages provider/operation/managed-event-id only. `cards.tsx` gained a
> `calendar-manage-plan-card` and two RESERVED trace verbs. See
> "Phase 17 gap closure — the calendar_manage substrate" below for the invariants.)
>
> This is the real §9 entry the two CLAIM-NOTHING bumps below it were waiting for. The next
> paragraph is 21-04's bump, which fired on THIS lane's `cards.tsx`, `traceParity.test.ts` and
> `scripts/run-calendar-test-gate.mjs` and correctly verified none of them; the `PREVIOUS:` entry
> under it registered `packages/core/src/calendarManagement.ts` without reading it. Both are now
> superseded by this one.
>
> **Provenance, recorded rather than tidied:** the 17-05 paragraphs above were committed by
> `3166544` (`docs(21-04)`), not by a 17-05 commit — a concurrent lane staged this whole file while
> the edit was still in the shared working tree. The content is this lane's work; the commit is not.

<!-- SHARED-TREE INCIDENT, 2026-08-11: the 17-05 entry above landed in this file in the working
     tree between 21-04's `git diff --stat` check and its `git commit -- <paths>`, so it was swept
     into 21-04's docs commit `3166544` under the wrong authorship. The text is 17-05's, byte
     unchanged, and history was NOT rewritten to "fix" it — a rewrite in this tree is the more
     destructive act. This separator was added afterwards so the two entries read as two. -->

> Touched 2026-08-11 by 21-04 to clear the §9 Stop hook. **NOTHING HERE WAS RE-VERIFIED AND THIS
> ENTRY DOCUMENTS NO CHANGE OF ITS OWN.** The hook builds its changed-set from the WHOLE working
> tree, and it fired on `apps/web/app/(app)/dashboard/workspace/cards.tsx`,
> `packages/backend/convex/traceParity.test.ts` and `scripts/run-calendar-test-gate.mjs` — three
> files of the **concurrent 17-05 Calendar lane**, all named in that lane's own file list. None of
> them is in any 21-04 commit: 21-04 touched only `packages/backend/convex/skills.ts`,
> `skills.test.ts`, `importGuard.test.ts`, `apps/web/app/(app)/ops/page.tsx`,
> `apps/web/app/(app)/ops/tenantSkillReview.test.ts`, `docs/playbooks/skill-registry.md` and
> `docs/playbooks/authorization.md` (commits `18d8bca`, `70d54e3` and the docs commit alongside
> this one). I did not run, read, re-measure, endorse, revert or restage that lane's change and I
> make no claim about whether it is correct. **Do not treat this bump as coverage** — the real §9
> entry for `cards.tsx` / `traceParity.test.ts` / `run-calendar-test-gate.mjs` is still owed by
> 17-05.
>
> It then fired a SECOND time after 21-04's docs commit, on `scripts/run-calendar-test-gate.mjs`
> alone — still uncommitted, still that lane's. Extending this entry rather than stacking another
> (the 21-05 precedent). Worth naming as a process cost and not just a nuisance: **each of these is
> a durable record that says nothing, written by someone who checked nothing**, and the real entry
> is still owed.
>
> PREVIOUS: 2026-08-11 (COVERAGE ONLY, eval-gate session — not an attestation.
> `packages/core/src/calendarManagement.ts` and its test tripped §9 as uncovered new code.
> Registered here because this playbook already owns `core/src/calendar.ts`. They are the 17-05
> Calendar lane's files, unread by this session. **Nothing here is verified** — that lane
> supersedes this entry when the work commits. Same applies to
> `scripts/run-calendar-test-gate.mjs`, which that lane edited mid-turn.)

> Last verified: 2026-08-11 (21-05 - **ROUTINE v0 SHIPPED AS PINNED PROMPTS. `savedPrompts` now has
> its three functions and its two workspace controls. NO scheduler, cron, trigger, recurrence,
> next-run timestamp, execution history, routine status or `routines` table was added, and none may
> be.** No cockpit tool, arm, trace literal, guardrail or skill body moved; no model call was made
> and **$0.00** was spent.)
>
> **A pinned prompt is inert tenant-owned TEXT.** `packages/backend/convex/savedPrompts.ts` is a thin
> adapter over the 21-01 table and exposes exactly `save`, `list`, `remove` - all three through
> `tenantMutation`/`tenantQuery`, never a raw builder (CLAUDE.md section 2).
>
> | Function | Args | Bound | Refusal |
> |---|---|---|---|
> | `save` | `{text}` **only** | `SAVED_PROMPT_MAX_BYTES = 4000` **UTF-8 bytes** | blank => `SAVED_PROMPT_EMPTY`; over cap => `SAVED_PROMPT_TOO_LONG: <bytes> > <cap> bytes` |
> | `list` | none | `.withIndex("by_tenant_createdAt").order("desc").take(20)` | - |
> | `remove` | `{id: v.id("savedPrompts")}` | one exact-row read | missing **and** foreign => the same `{removed: false}` |
>
> `tenantId`, `title`, `textHash` and `createdAt` are all derived server-side, so Convex's arg
> validator is the refusal boundary: a caller cannot even NAME a field it does not own, and there is
> no `schedule`, `trigger`, `status` or `nextRunAt` to name in the first place. `title` is the
> bounded (80-char) first nonblank line; the TEXT is never truncated, because a shortened prompt
> would replay a different instruction than the one the user pinned. `textHash` is
> `lib/hash.contentHash` over the NORMALIZED text (CRLF folded, outer whitespace trimmed, interior
> blank lines preserved), which is what makes a re-pin idempotent **within one tenant** - two tenants
> pinning byte-identical text still get two rows.
>
> **The cap is BYTES, measured with `TextEncoder`, not characters.** A character cap lets one
> multibyte paste carry ~3x the tokens the number implies. The test pins an at-cap 4000-byte
> multibyte value as the positive witness beside the blank and over-cap refusals.
>
> **Prompt text is CONTENT PLANE and never reaches a log plane.** `savedPrompts.ts` writes no audit
> event at all - a reversible UI preference is not a governance event, and an audit row carrying the
> prompt would be exactly the PII honeypot section 4 exists to prevent. The privacy test plants a
> **refs-only control audit row** (a `savedPromptRef` plus the `textHash`) purely so the needle scan
> is proven to read something: an empty-table scan "passes" for the trivial reason that there is
> nothing to read. Do not delete that control row thinking it is noise - without it the assertion is
> vacuous. The scan is asserted BEFORE the row counts for the same reason; a count on the line above
> would short-circuit the assertion the ledger actually names.
>
> **RUN IS AN ORDINARY FRESH COCKPIT TURN, AND THAT IS THE WHOLE DESIGN.** `WorkspacePage.runPinned`
> calls `useSendCockpitMessage()` with `{text}` and **no `threadId`**, then hands the returned id to
> the existing `registerThread`. Consequences, all by construction rather than by promise:
>
> - the hook supplies the trusted IANA timezone and the CALL-TIME clock. A raw
>   `useAction(api.cockpit.sendCockpitMessage)` drops both and silently re-breaks every phase-17
>   calendar and phase-19 CRM tool (`no_clock`). **Never construct the raw action in a component.**
> - no `threadId` means `sendCockpitMessage` mints a new thread exactly as a first typed message
>   does. The prompt does not land in whatever conversation happens to be open, and no prior plan is
>   cloned.
> - guardrails, spend, activity trace, plan lifecycle and the Approve gate are therefore
>   **unchanged** - this is the same door, not a second one. There is nothing new to re-verify on
>   those paths.
> - `setSending(true/false)` wraps the call, so the ChatPane bubble and the workspace ActivityCard
>   light up for a pinned run exactly as they do for a typed one (the one shared in-flight signal).
>
> **The surface.** `ChatPane.tsx` renders `Copy` plus a Pin chip inside ONE `{mine && (...)}` block,
> so an assistant bubble has no Pin by construction. The two chips sit in a `.bubble-actions` wrapper
> that takes the absolute position `.msg-copy` used to own - two `.msg-copy` buttons would otherwise
> stack on each other. **No CSS file was touched**; the chips reuse the existing class and go
> `position: static` inside the wrapper. A pin that has a state is forced to `opacity: 1`, because a
> "Pin failed" chip that vanishes when the pointer leaves has told the user nothing. `pinLabel()` is
> the exported pure labeller and is the only place the four state sentences live -
> `Pin prompt` / `Pinning…` / `Pinned ✓` / `Pin failed — try again`. **A failed pin sets a label and
> does NOT rethrow** (unlike `onSend`, which rethrows after restoring the user's text): a convenience
> must never take the conversation with it.
>
> `page.tsx` adds `PinnedPrompts` and `PinnedPromptsFallback` beside `PastChats`, using the existing
> `HeaderMenu`/scrim/`head-menu-item`/`head-menu-empty` idiom and the existing `StarIcon` - no new
> route, no nav entry, no component library, no new dependency, no new icon. It owns its own
> `useQuery` inside `<ErrorBoundary label="pinned-prompts">` for the same reason `PastChats` does: a
> failing read degrades THIS MENU, not the cockpit. Honest states: `Loading…`, "No pinned prompts
> yet. Pin one from a message you have sent.", `Running…`, `Deleting…`, and an inline announced
> `role="status"` notice - never `window.alert`/`confirm`, never a dialog, never amber (BRAND
> section 2 spends `--held` on the approval gate alone). The accessible names carry the VERB
> (`Run pinned prompt: <title>` / `Delete pinned prompt: <title>`) because twenty rows of prompt
> titles are otherwise indistinguishable to a screen reader. Run closes the menu on SUCCESS only -
> closing on failure would dismiss its own error notice.
>
> **Delete deletes the pin and only the pin.** A saved prompt has no `threadId` and owns no
> conversation; `remove` performs exactly one `ctx.db.delete` and the menu's `del` handler touches no
> `setThreadId`/`setTabs`/`closeTab`. The backend test proves it by planting a `plans` row and
> asserting it survives.
>
> ### The evidence gate for anything more than this
>
> **Cron, recurrence, trigger rows, execution history, routine status, an authoring canvas and a
> graph DSL are all POST-BETA and evidence-gated on ONE observation: a real user manually re-running
> a pinned prompt twice.** That is the entire point of shipping v0 this thin - to find out whether
> people repeat prompts before building a substrate for it. Until that evidence exists, do not add: a
> `routines` table, `ctx.scheduler` anywhere in this path, a `nextRunAt` column, a status machine, or
> a "run every Monday" control. The word "routine" is not authorization.
>
> Both guards are mechanical, and both strip comments before scanning so the code's own explanation
> of why it schedules nothing cannot be what trips them: `convex/savedPrompts.test.ts` scans
> `savedPrompts.ts`, and `app/(app)/dashboard/workspace/pinnedPrompts.test.ts` scans `ChatPane.tsx`
> plus `page.tsx`, for `cron`, `schedule`, `recurrence`, `routine`, `trigger`, `nextRunAt`,
> `setInterval`, `setTimeout` and `scheduler`; the web one also pins the set of saved-prompt
> functions the UI may call to exactly `{list, remove, save}`.
>
> ### How to verify (measured at 21-05, $0.00 - no model call, no eval run)
>
> ```
> pnpm --filter @pikar/backend exec vitest run convex/savedPrompts.test.ts --maxWorkers=1   # 13/13
> pnpm --filter web exec vitest run 'app/(app)/dashboard/workspace/pinnedPrompts.test.ts'   # 14/14
> pnpm --filter web typecheck                                                               # exit 0
> ```
>
> Browser check (21-06 owns the automated version; this is the manual one): sign in, send a message,
> hover your own bubble, press **Pin prompt** (the chip reads `Pinned ✓`), open the **star** icon in
> the chat header, press the prompt. A NEW tab must appear - not the one you were in - and the
> workspace must stream the same plan/approval flow a typed message produces. Press **Delete**: the
> pin disappears, and the chat it came from is still in **Past chats**.
>
> **Mutation-verification ledger (each applied, observed RED, reverted; 21-VALIDATION.md rows):**
>
> | Row | Mutation | RED observed |
> |---|---|---|
> | 11 | drop the exact-row `tenantId` comparison in `remove` | `expected { removed: true } to deeply equal { removed: false }` - tenant B deleted A's positively-witnessed pin |
> | 12b | add the prompt text to an audit payload in `save` | the needle scan: `expected '{"audit":[...' not to contain 'ZP5ALPHA9c4e2b71'` |
> | 10a | swap the hook for `useAction(api.cockpit.sendCockpitMessage)` | `expected ... not to contain 'api.cockpit.sendCockpitMessage'` |
> | 10b | pass the current `threadId` to Run | `expected [ 'threadId, text' ] to deeply equal [ 'text' ]` |
>
> **`pinnedPrompts.test.ts` is a SOURCE SCAN, not a render.** `apps/web`'s vitest config is node-only
> with no jsdom and no testing-library. It proves the shipped source contains and lacks exact things.
> **It proves nothing about pixels, layout, keyboard focus order, whether the menu opens, or that any
> of this renders at all.** The browser proof is 21-06's Playwright spec and this is not a substitute
> for it.
>
> **Pinned prompts and the 21-02 skill-authoring panel must not be merged.** Same workspace, opposite
> risk profiles: a pin is a shortcut over inert text, a skill adaptation is registry prose that
> changes a specialist's system prompt for the whole tenant behind a paid evaluation and an owner
> activation. `SkillAuthoringPanel` deliberately does not import `useSendCockpitMessage`, and the
> pinned-prompt path never calls `publishUserCandidate`.

> Last verified: 2026-08-10 (21-02 — **the specialist loader and a new workspace card. No cockpit
> tool, arm, trace literal, guardrail or skill BODY moved; no model call was made and $0 was
> spent.**)
>
> **`llm.runSpecialistTurn`'s ordinary active-body read is now `internal.skills.getEffectiveSkill`
> (tenant active overlay -> global active -> `NO_ACTIVE_SKILL`).** `tenantId` there is trusted
> server state off the dispatcher's authenticated envelope, never model-supplied. (This paragraph
> used to add "only the three `USER_AUTHORABLE_SKILLS` can have an overlay row at all, so
> `research-specialist` and `media-director` resolve exactly as before". Deleted 29-FIN-06: the
> loader does not filter by name, and a second publish channel has since landed. Which names carry
> an overlay row is decided at `skills.publishUserCandidate` / `skills.publishPackCustomization`.) **The exact-VERSION pin branch stays GLOBAL** — moving
> it would silently re-point the eval runner's `--skill name@version` at a tenant row; tenant pins
> are 21-03's. **Deliberately NOT threaded** into `runCockpitAgent`, voice, inbox, reply,
> extraction, blueprint or vault loaders: those names are not authorable in v0, and every one of
> them still calls `getActiveSkill`.
>
> The proof is in `runCockpitAgent.test.ts` and it reads the prompt the MODEL was handed, not the
> reply: `MockLanguageModelV4` accepts a `doGenerate` FUNCTION as well as the usual scripted array
> (`ai/dist/test`), so the test passes a capture through the existing `mockScript` seam and asserts
> the `system` message byte for byte. Tenant A gets its overlay, tenant B gets the global body with
> no trace of A's needle or of B's own candidate, and **`SPECIALISTS[route].tools` is identical for
> both** — ADR-007: a prompt row advises behaviour, it never grants capability. Removing the
> loader's tenant predicate and removing the global fallback were both mutation-checked red.
>
> **`SkillAuthoringPanel.tsx` is a card in the chat pane, opened from the existing Chat options
> menu.** No route, no nav entry, no component library, no new dependency. It calls exactly two
> functions — `api.skills.publishUserCandidate({name, authoredBody})` and `api.skills.myUserSkills`
> — and it renders above the conversation regardless of mailbox state, because adapting a skill has
> nothing to do with a connected inbox.
>
> **THIS IS NOT PLAN 05's PINNED PROMPTS, and the two must not be merged.** A pinned prompt (21-05,
> `savedPrompts`, the block below) is inert user TEXT that a Run button replays as an ordinary fresh
> cockpit turn through `useSendCockpitMessage`. A skill adaptation is registry PROSE that changes a
> specialist's system prompt for the whole tenant, and it is gated behind a paid evaluation and an
> owner activation that do not exist yet. Same workspace, opposite risk profiles: one is a shortcut,
> the other is governance. The authoring panel deliberately does not import
> `useSendCockpitMessage`, and pinned prompts must never call `publishUserCandidate`.
>
> **What the panel must never grow, each pinned by `skillAuthoring.test.ts`:** an Activate control
> or any activation API import; the base or composed body (raw registry bodies are an owner-only
> disclosure boundary — the user sees only their own words back); raw evidence or eval-fixture
> content (the golden corpus is held out from the authoring actor); a tool selector, schedule,
> trigger, recurrence or routine builder; a raw `tenantId` / `authorUserId` / `rollbackEligible` /
> row id. `skillStateLabel` keeps a candidate from ever reading as live — a passing candidate says
> "Evaluation passed — waiting for Pikar to approve it", and a fresh one says "Nothing has changed
> yet." Making a candidate claim it is live was mutation-checked red.
>
> That test STRIPS COMMENTS before scanning, on purpose: without it the panel's own note explaining
> that there is no Activate control fails the no-Activate scan, and the only way to green it would
> be to delete the explanation. It is also a SOURCE scan, not a render — `apps/web`'s vitest config
> is node-only with no jsdom. The browser proof is 21-06's Playwright spec and this is not a
> substitute for it.

> Last verified: 2026-08-10 (21-01 — **SCHEMA AND OWNERSHIP ONLY: the `savedPrompts` table exists,
> nothing reads or writes it.** No cockpit behaviour, tool, arm, trace literal or skill body moved.)
>
> **A saved prompt is INERT SAVED TEXT, and "routine v0" is not a euphemism for a scheduler.**
> `savedPrompts` is `tenantId, text, title, textHash, createdAt` with `by_tenant_createdAt` and
> `by_tenant_textHash`. `title` is code-derived (bounded trimmed first line); `textHash` makes save
> idempotent within one tenant. That is the entire row.
>
> **There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp,
> execution-history table, authoring canvas or graph DSL — and none may be added on the strength of
> the word "routine".** The prompt does nothing at rest. Its ONLY future execution path is a user
> clicking Run, which must start an ORDINARY FRESH cockpit turn through `useSendCockpitMessage`
> with no `threadId` — the same hook every other send uses, because it is what supplies the trusted
> IANA timezone and clock that Phase 17/19 calendar and CRM tools depend on. A raw
> `useAction(api.cockpit.sendCockpitMessage)` silently drops those and regresses both. A run must
> not call an internal action, schedule a job, or clone prior plan state; plan, guardrail, spend,
> approval and activity boundaries are therefore unchanged by construction.
>
> Prompt text is content-plane data: it never enters an audit or dead-letter payload (CLAUDE.md §4).
> The CRUD adapter, the workspace Pin/List/Run/Delete surface and their tests are owed by 21-05;
> `savedPrompts.ts`/`savedPrompts.test.ts` are registered to this playbook in `watch.json` ahead of
> that plan.

> Last verified: 2026-08-10 (Plan 19.1-07 — **WATCH-GATE BUMP ONLY, no cockpit behaviour changed.**
> This playbook watches `apps/web/e2e/` (`watch.json`), and 19.1-07 extended
> `e2e/pipeline-uat.spec.ts` with a contacts-IMPORT step (`step 3b`) and a phone-width assertion on
> the import panel. Nothing in `cockpit.ts`, `buildCockpitTools`, the tool set, the arm table or any
> skill body moved, and **the agent still cannot initiate an import** — the attestation is a legal
> statement a person makes, so the panel is human-only and no registration site was touched.
> The precedent for this kind of entry is the 19-07 block further down. One thing the next person
> running the suite needs: **`--grep "step 3b"` alone cannot pass** — the step depends on the
> contacts step 3 creates, so `--grep "step 3"` (which matches both) or the whole file is the
> command. Measured at this plan: `step 3`/`step 3b`/`step 14` green against a real
> `:3210` + `:3111` stack at **$0.00** — no model call is made by any of them.)

> Last verified: 2026-08-10 (20.1-01 — **Drive reads are registered but intentionally not yet
> taught to the active agent**). `buildCockpitTools` now exposes `listDriveFolders({parentId?})` and
> `findInDrive({query})`; neither accepts `tenantId`, and both call the existing tenant-derived
> Drive boundary. Closed `agentSteps.tool` literals and workspace verbs keep start/done traces
> truthful. `SMOKE::agent::drive=list:<folderId>` and `drive=find:<query>` traverse the real parser,
> op-to-tool map, executor, and trace recorder offline at **$0**. The structural guard excludes
> import/ingest/export/reservation calls and keeps both tools out of every specialist grant. This
> plan deliberately does not edit or activate the versioned `cockpit-agent` skill; Plan 20.1-02 is
> the visibility/activation/UAT boundary. Focused evidence: trace parity 2/2, Drive registration
> 1/1, Drive guards 4/4, and Drive cockpit smoke 3/3.
>
> Last verified: 2026-08-10 (Plan 19-13 — **two comment/file corrections, NO behaviour change.**
> **(1) `gmail.ts:167` asserted a lie.** It said `deliverApprovedPlan.ts is the sole caller of this
> action`; 19-05 proved there are **TWO** (`deliverApprovedPlan.ts:37` and `pipeline.ts:379`), both
> handling the `suppressed` terminal explicitly. A comment claiming false convergence is the exact
> defect class that cost this phase the most — three separate times a claim in a comment stopped
> someone checking. The comment now names both callers and says plainly: grep the callers, do not
> trust the sentence. **(2) `apps/web/e2e/pipeline.spec.ts` DELETED** (permanently red by
> construction; superseded by `e2e/pipeline-uat.spec.ts`) — see `dashboard-pages.md` and
> `contacts-crm.md` Known gaps. The guard itself is untouched and still inside the action.)
> 
> Last verified: 2026-08-10 (Plan 19-12 — **BOTH PHASE-19 UAT DEFECTS ARE CLOSED, BROWSER-VERIFIED
> ON A REBUILT `:3111`: `e2e/pipeline-uat.spec.ts` is 15/15 with both `test.fail()` markers DELETED,
> measured spend $0.0400.**
> **(1) THE BROWSER NOW CARRIES A CLOCK, AND IT IS STRUCTURALLY IMPOSSIBLE TO FORGET.** The fix is
> NOT the one-line call-site literal the 19-10 block below proposes — that is five copies of the
> field whose omission WAS the defect. It is one hook,
> `apps/web/app/(app)/dashboard/workspace/useSendCockpitMessage.ts`, and ALL FIVE web callers
> (`ChatPane`, `cards.tsx`'s regenerate/remove, `SegmentAnatomy`, `AbnormalBriefBanner`, `PostCall`)
> now go through it; raw `useAction(api.cockpit.sendCockpitMessage)` no longer exists in
> `apps/web/app`. `tz` degrades to `"UTC"` inside a try/catch — an `Intl` that resolves nothing
> would otherwise send `undefined` into a `v.string()` and throw the ENTIRE turn away, which is
> worse than the refusal it replaces. `nowMs` is read inside the callback, never at render: a chat
> pane can sit mounted for hours.
> **The phase-17 calendar tools came back with it, and that is PROVEN, not assumed** — new UAT step
> 7c drives a browser turn and asserts the plan row carries `eventTz === Africa/Dar_es_Salaam`, the
> browser's OWN zone. `clientContext.tz` is the only writer of that field in the codebase, so the
> row is direct evidence the trusted clock crossed the boundary into `proposeCalendarEvent`.
> `setSendTime`/`checkAvailability` read the same closure variable and are unblocked by the same
> argument (not separately driven — `checkAvailability` needs a real Google grant this harness
> does not have).
> **The guard is the BROWSER test, deliberately.** `crmCard.test.ts` also scans `apps/web/app` for
> the raw `useAction` — but that is a SECOND-INSTANCE guard (a NEW clockless caller), NOT the
> regression guard: no unit test can observe that the shipped browser omits an optional argument,
> which is exactly why this survived 17, 18, 19-11 and a green eval gate.
> **(2) THE WITHHELD REPORT IS A ROW FIELD NOW.** `plans.withheldRecipients` (optional array,
> written by `executePlan` in the SAME patch as the counters it explains, omitted entirely when
> nobody was dropped — no migration). Rendered by `@pikar/core`'s `withheldNote(recipients,
> withheld)` — ONE builder, two surfaces: the cockpit `PlanCards` (above the REPORT card) and the
> Approvals `InFlightRow`. `role="status"`, `--ink-soft`, never `alert` and never amber. The dead
> `res.withheld` → `setNote` branch in `PlanCard.approve` is DELETED; the refusal notes stay in
> `useState` because a refusal leaves the plan `proposed` and the component alive.
> **THE RULE THIS LEAVES BEHIND: any UI state produced BY a status transition must not live in a
> component gated ON that status.** It is unreachable by construction, and every offline test will
> still pass.
> **A COLLATERAL FINDING WORTH MORE THAN EITHER FIX: `convex dev` TYPECHECKS BEFORE IT PUSHES.** A
> type error in ANY `convex/*.ts` file — here `convex/cash.ts` from a concurrent lane, untouched by
> this plan — makes the watcher silently keep serving the LAST GOOD BUILD. Two UAT runs measured a
> defect that was already fixed in source. If a change you just made is not visible at :3210, run
> `pnpm typecheck` on `@pikar/backend` BEFORE debugging your own code.
> **19-05's guarantees are intact and re-measured:** the per-address drop still runs BEFORE the
> group join, the `gmail.send` backstop is untouched, `recipientTotal` is 4 of 5 and `queuedCount`
> still drains. UAT step 9(a)'s blanket "the dropped address appears NOWHERE on the page" was
> NARROWED — not weakened — to "nowhere EXCEPT inside the withheld note", because 9(b) now makes
> the blanket form logically impossible; it is asserted by cloning the pane, removing the note, and
> requiring the address to be absent from what remains.)

> **THE `agentSteps.tool` CLOSED UNION IS NOW GUARDED STRUCTURALLY (2026-08-08).** `schema.ts`
> warned about this trap twice in PROSE — a tool whose name has no literal makes `agentSteps:record`
> throw `ArgumentValidationError`, and the AI SDK SWALLOWS callback throws, so the step vanishes in
> PROD while the whole suite stays green. It happened anyway, twice more: `recordScorecardAnswer`
> (found in eval logs) and **`resetPlan`, which nobody knew about — the new guard test found it the
> first time it ran.** Every "cancel and start over" turn had been losing its trace step silently.
> `cockpitTools.test.ts` now scans every `<name>: tool(` key in `buildCockpitTools` and fails if any
> lacks a literal, with non-vacuity floors on both lists so a restructure fails loudly instead of
> passing on an empty scan. **Add the literal in the SAME commit as a new tool.** Prose in a schema
> comment is not a guard; a test is.

> Last verified: 2026-08-10 (WHOLE-BRANCH RE-REVIEW, live-finance-inputs — **`buildTurnPrompt` now
> takes TWO standing-context channels, `spine` and `finance`, and joining them here is the whole
> point.** `internal.blueprint.spineForTenant` doubles as `evaluations.ts`'s grounding chunk, so a
> finance line appended upstream gets its first number captured by `FINANCIAL_PATTERNS` as the value
> of any `CAC`/`LTGP`/`price` label the blueprint mentions (see business-evaluation.md). Both
> `runCockpitAgent` and the `__cockpitTurnPrompt` shim now read `internal.cash.financeSpineFor` in
> its own fail-open try/catch beside the spine read, and `cockpitBlueprint.test.ts`'s call-site pin
> was extended to require BOTH reads on BOTH sites — a future "tidy-up" that merges the queries
> fails there before it can reach the grounding corpus. A tenant with figures and no blueprint gets
> the finance line alone; a tenant with neither gets the byte-identical legacy prompt, still pinned.)

> Last verified: 2026-08-10 (WHOLE-BRANCH REVIEW FIX, live-finance-inputs — two cockpit-side
> corrections. **(I2) `proposeCalendarEvent` was the third staging tool on the one shared plan row
> and the only one with no cross-kind interlock.** `otherKindStaged` guarded `stageCrmWrite` and
> `stageFinanceWrite`; the calendar tool patched `kind: "calendar_event"` straight over a staged
> `finance_write`, whose `financeClaims` then survived on the row but were never applied and never
> rendered, because `executePlan` routes on `actionTypeOf(plan.kind)` alone — after the model had
> told the user the figures were staged. The Task-8 entry below already named `calendar_event` as
> part of this hazard; only the calendar side was missed. One `otherKindStaged(await readPlan(),
> "calendar_event")` call before the patch, plus a `cockpitTools.test.ts` test proving the figure
> plan survives intact. (`stageResearchPlan`/`stageMediaPlan` keep their own narrower interlocks —
> unchanged, and the `ponytail:` comment on `otherKindStaged` still explains why.)
> **(I5) `executePlan`'s finance arm now returns `applied`.** `applyFinanceClaims` used to return
> `{ok: true}` after skipping every claim, so the card said "the governed action is now in flight"
> over zero writes and zero audit rows. It returns `{ok, applied, skipped}` and always writes the
> audit row; the arm passes `applied` through, and both approval surfaces (`ApprovalsView.tsx`,
> `workspace/cards.tsx`) say "Your figures were already up to date, so nothing changed." on
> `applied === 0`. The finance arm is the ONLY producer of that field — every other arm leaves it
> undefined, so no other card branch changes.)

> Last verified: 2026-08-10 (Task 9, live-finance-inputs — **the body now teaches the two finance
> tools accurately, matching what they actually refuse.** `readFinance`/`stageFinanceWrite` were
> built by Tasks 7-8 with no body section describing them; a new "Financial figures" section closes
> that gap: never compute LTGP:CAC/CFA/payback/runway/the solvency verdict yourself — `readFinance`
> is the only source — though arriving at an INPUT (a stated number) from what the user says is
> fine. `stageFinanceWrite` can write only five figures — `cashOnHand`, `monthlyOperatingCost`,
> `mrr`, `receivables`, `payables` — named explicitly so the model learns the boundary from the
> body rather than by being refused; the other six (CAC among them) live on the scorecard, which
> cannot record who supplied a figure, and every agent write to one is refused. Every update
> stages onto a plan card; nothing is written until the human clicks Approve, and a stale/missing
> figure is raised only when relevant to what the user is asking — the clause that stops the agent
> opening an unrelated conversation about the user's numbers. CODE-SIDE, NOTHING IN THIS PLAYBOOK'S
> WATCHED PATHS CHANGED — no tool implementation moved; this entry exists because the tool CONTRACT
> those files enforce is now what the body promises, matching the "the tools" ownership split this
> playbook draws against `skill-registry.md`, which owns the body edit itself and the un-run gate.)
>
> Last verified: 2026-08-10 (Task 8 REVIEW FIX, live-finance-inputs — **the figure card could not
> show a refusal at all, the tool proposed figures it can never write, and either staging tool
> silently ate the other's plan.** Four findings. (1) **`PlanCard`'s note rendered on ONE branch.**
> `memo`, `crm_write`, `finance_write` and `calendar_event` all EARLY-RETURN their own JSX, and the
> `{note && …}` block lived only in the final EMAIL return — so on those four cards `setNote` ran,
> the component re-rendered, and nothing appeared. Invisible since 12-05 because the three original
> reasons (`gmail_not_connected`, `no_postal_address`, `all_recipients_suppressed`) fire on EMAIL
> plans only; `finance_write` is the first early-return branch whose refusals actually fire, which
> is what made the Task 8 entries below unreachable the moment they were added. Fixed at the root:
> ONE `planNote` element built after `approve()` and rendered by all five branches — not copied
> into the finance branch. `crmCard.test.ts` now SCANS `cards.tsx` (source text: `apps/web`'s
> vitest is node-only with no jsdom, and its config documents adding one as a deliberate upgrade)
> and asserts `{planNote}` occurs exactly as often as `void approve()`, with a non-vacuity floor of
> 5 — mutation-checked at 4-vs-5 RED. **A map assertion is not a render assertion**; the previous
> pin was green while the card could show neither string. Same edit paired the link with its label
> (`link: { href, label }`): the label had been HARDCODED "Open your profile" beside an optional
> `href`, so `agent_cannot_update_figure` -> `/dashboard/finance` would have rendered the wrong
> words over the right link. (2) **`stageFinanceWrite` now refuses scorecard fields itself.** 6 of
> the 11 collected inputs are `store: "scorecard"` and `applyFinanceClaims` refuses every one —
> while the tool description said "only the collected inputs can be updated", so the model would
> re-propose CAC every turn and the user would spend an approval click to find out. The description
> is now DERIVED from the catalogue (`AGENT_WRITABLE_FIGURES` = the five `financeInputs` fields) so
> it cannot go stale, and the guard sits immediately after the membership check. **`cash.ts:448`
> stays** — it is still reached by its own unit tests, by a plan row revised between staging and
> Approve, by a row staged under an older build, and by any future writer of `financeClaims`; two
> guards, one rule, neither dead. (3) The staged claim is now asserted field-by-field (not just
> `toHaveLength(1)`), the LIST property has a two-update test, all-or-nothing has one, and one test
> drives the whole `stage -> Approve -> financeInputs row` seam on a plan the TOOL staged rather
> than a hand-seeded row. (4) **THE CROSS-KIND CLOBBER, both directions.** `plans.by_thread` is
> `.unique()`, and each staging tool's guard checked only the four EMAIL slots — a `crm_write` row
> carries `crmOperations` and no subject/body, a `calendar_event` row carries `eventTitle`. Both
> sailed through, `patchPlan` overwrote `kind`, and `executePlan` routes on `actionTypeOf(plan.kind)`
> ALONE, so the surviving list was never applied and never rendered *after the model had told the
> user it was staged*. Fixed as ONE shared predicate — `otherKindStaged(plan, mine)`, refusing when
> another `kind` is present and its status is not `done`/`canceled` — used by BOTH `stageCrmWrite`
> and `stageFinanceWrite`, with a test in each direction plus one proving a same-kind re-stage is
> still a revision. Inherited shape, not introduced here, but Task 8 is what made it reachable.
> `PlanRow` now DECLARES `kind`, which has a second effect worth keeping: every caller passes a
> `PlanRow` to `buildAgentContext`, whose param declares the same union, so the next `ACTION_TYPES`
> widening that skips that function is an assignability error at the call site — the compile-time
> guard the corrected note there says does not exist now exists for the seventh action type.)

> Last verified: 2026-08-10 (Task 8, live-finance-inputs — **`stageFinanceWrite`: the agent's only
> route to a figure, and the two model-facing surfaces Task 4 left open are now closed.** ONE tool
> carrying a LIST (the `stageCrmWrite` shape — one plan, one approval click, however many figures
> moved). It STAGES and applies NOTHING: it patches `kind: "finance_write"`, `status: "proposed"`
> and `financeClaims` through `internal.plans.patchPlan` and returns; `executePlan`'s `inline` arm
> applies the list after Approve. contacts-crm.md invariant 11 — the ACTOR decides gating, so the
> human editing the SAME figure through `cash.saveInput` is ungated and stages no plan at all.
> **`status: "proposed"` is load-bearing, not decoration:** the Approve gate is a CAS that no-ops on
> any other status and every approval surface lists by it, so a row staged at `collecting` would
> render nowhere and could never be approved. **Reused `patchPlan` rather than adding a staging
> mutation** (its `kind` union gained the fifth literal and a `financeClaims: v.optional(v.array(
> v.any()))` arg beside `crmOperations`, same reasoning: the shape is owned by `schema.ts`'s own
> validator, which Convex enforces on that very `db.patch`, and by `validateFigureClaim` at both
> boundaries). **ORDER IS LOAD-BEARING in `execute`:** the `CASH_INPUTS` membership check must
> precede claim construction, because `validateFigureClaim` delegates to `cashInputSpec`, which
> THROWS on an unknown field — mutation-checked: deleting the guard turns the refusal test into
> `Error: unknown cash input: vibes` thrown out of the governed loop. Every refusal is a RETURNED
> SENTENCE (18-06): empty list, unknown field, a `basis` that QUOTES rather than references (§4 is
> enforced HERE, at the producer — "refs only" is not mechanically decidable in pure TS and `basis`
> reaches the audit log and the approval card), a failed `validateFigureClaim`, and a
> half-composed email draft on the one plan row this thread has (the `stageCrmWrite` hazard).
> **`buildAgentContext` gained the `finance_write` arm BY HAND** — the correction note there is
> right that this is not a compile-error site, and the RED before the fix was verbatim the failure
> it predicts: a staged figure plan rendered as `"Current email plan:"` with Recipients / Send mode
> / Send time slots. Pinned by a test, because the type system will not. **`workspace/cards.tsx`
> gained the finance card**, the `stageFinanceWrite` VERB, and `finance_write` in the DraftCard
> exclusion list — everything below those branches is email chrome and every word of it is a lie on
> a figure update. Its refusal map moved to a module-scope exported `PLAN_REFUSALS` and gained
> `agent_cannot_update_figure` + `malformed_figure_claim`: unlike `ApprovalsView`'s `refusalMessage`,
> which falls back to printing the raw enum, `if (refusal) setNote(...)` renders NOTHING for an
> unmapped reason, so a rejected figure approval looked like a click that did nothing. A test now
> asserts both keys exist AND that the copy is word-for-word the Approvals page's. Card shows the
> COUNT, never the figures — the `titleFor` call §4 already made on the primary surface.)

> Last verified: 2026-08-10 (Task 7 REVIEW FIX, live-finance-inputs — **`readFinance`'s payload now
> carries per-input freshness, and no longer inherits a guessed tier's false certainty.** Two
> Important findings. (1) The description promises figures that are "missing or out of date", but
> only 2 of 13 derived figures (`mrr`/`referralPct`, the only two routed through `statedFigure`)
> ever carried a `stale` marker — `execute` now ALSO calls the new `internal.cash.inputsFor` reader
> and includes its `CashInputState[]` (the same per-field `stale`/`statedAt` `inputs` above already
> computes) in the returned JSON under an `inputs` key, so the agent can back "out of date" with an
> actual date rather than the tool's own unbacked promise. (2) `solvencyFor` used to reuse
> `solvencyForTenant`'s `row?.tier ?? "solopreneur"` default — safe on the Finance PAGE (which shows
> a compensating "complete your shape" invitation next to the guess) but not on this tool, which has
> no such invitation: a funded startup mid-onboarding asking "what's my MRR?" got told, with the
> tool's own authority, that MRR structurally does not apply to their business. Fixed at the root in
> `@pikar/core`'s `solvency()` (not patched here): `tier` widened to `Tier | null`, and `null` is now
> PERMISSIVE rather than exclusionary — `not-applicable` is a claim about business STRUCTURE the
> function cannot make without a confirmed tier, so an unconfirmed tier falls through to the ordinary
> missing-input handling instead (a real stated MRR still surfaces as `known`; an absent one reads
> `unknown`, never `not-applicable`). `solvencyForTenant` (`cash.ts`) now takes the tier-unknown
> fallback as an explicit parameter instead of choosing one for both callers: `solvency` (dashboard)
> still passes `"solopreneur"` — UNCHANGED behavior, `cash.test.ts`'s existing 35 tests confirm it —
> and `solvencyFor` (this tool) passes `null`. Covering tests: `packages/core/src/cash.test.ts` gained
> a `tier: null` describe block (4 tests); `cockpitTools.test.ts`'s empty-tenant test was tightened
> from a `> 5` floor to the exact 13-figure count plus a "every suppressed figure carries its reason"
> assertion, and gained a dedicated stated-MRR-with-unconfirmed-tier test that also pins the
> dashboard's `solvency` query staying at `not-applicable` for the identical data — the tool and the
> page are now DELIBERATELY different on this one point, not accidentally.)

> Last verified: 2026-08-10 (Task 7, live-finance-inputs — **`readFinance`, the on-demand DERIVED
> half of the finance spine.** A new read-only cockpit tool, beside `stageCrmWrite` in
> `buildCockpitTools`: EMPTY input schema (the tenant rides the RUN's closure-captured `tenantId`,
> never a model-suppliable argument — same shape as `recordScorecardAnswer`'s explicit-tenantId
> door), and its `execute` calls two new `internalQuery` readers in `cash.ts` —
> `unitEconomicsFor`/`solvencyFor` — added on the §2 allow-list, the `vaultGroundHydrated`/
> `plans.getById` convention for identity-less engine paths. Those readers do NOT duplicate the
> existing `unitEconomics`/`solvency` `tenantQuery` handlers' logic: both call the SAME new
> module-private `unitEconomicsForTenant`/`solvencyForTenant` helpers (explicit `tenantId` instead
> of `ctx.tenantId`), so the tenant-scoped page query and the tool-loop reader can never silently
> drift apart on what a tenant's money is — the exact hazard the module banner already warns about.
> **Never computes a ratio itself** — `@pikar/core`'s `unitEconomics()`/`solvency()` are PURE and
> return tagged `"unknown"`/`"not-computable"`/`"not-applicable"`/`"known"` states rather than
> throwing, so a brand-new tenant with zero `financeInputs` rows and no scorecard is the NORMAL
> case, not an error — `cockpitTools.test.ts` drives this exact tenant through the tool and asserts
> every returned figure is a non-`"known"` state. Registering a new tool key needs TWO more edits in
> the SAME commit or the closed-union traps this file already warns about above bite again:
> `schema.ts`'s `agentSteps.tool` literal (missing → `ArgumentValidationError`, SWALLOWED by the AI
> SDK) and `cards.tsx`'s `VERB` entry (missing → silent "Working…"/"Done" fallback), both
> structurally enforced by `cockpitTools.test.ts`/`traceParity.test.ts`.)

> Last verified: 2026-08-10 (Task 5, live-finance-inputs — **THE FINANCE REFUSAL NOW REACHES THE
> CARD.** `applyFinanceClaims` (`cash.ts`) no longer throws `INVALID_INPUT: …` for its two
> refusals — a malformed plan-row claim and a scorecard-field claim an agent may not write — it
> RETURNS `{ ok: false, reason: "malformed_figure_claim" | "agent_cannot_update_figure" }`, the
> SAME shape `reserveJobInner` (`media.ts`) already used for `no_deck` and the CAN-SPAM refusals.
> A throw here was silently broken in production: **Convex redacts a non-`ConvexError` message**,
> so the owner got an opaque server error with no lever, and because the plan stayed `proposed`
> every retry reproduced it. `executePlan`'s `finance_write` arm (`cockpit.ts`) now checks
> `applied.ok` and returns the reason instead of letting a throw propagate; its return union grew
> the two reasons. `ApprovalsView.tsx`'s `refusalMessage` map grew the matching copy. **Two-pass
> validation, not the interleaved loop the throw allowed:** a `return` does NOT roll back Convex's
> transaction the way a throw does, so `applyFinanceClaims` now validates every staged claim
> FIRST, with zero writes, and only runs the write pass once the whole list clears — otherwise a
> bad SECOND claim would leave a good FIRST claim's write committed. `writeFigureRow`'s own
> scorecard-actor throw is UNCHANGED — it stays the last-resort invariant guard for every other
> caller; the applier is the layer that knows a human is waiting on the refusal, the writer is
> not. Also pinned: the Schedule button's `item.kind === "email"` gate (`ApprovalsView.tsx`) now
> has a source-scan regression test — the gate itself needed no change, `finance_write` was never
> reachable, but nothing had pinned that a future edit couldn't add it.)

> Last verified: 2026-08-10 (Task 4, live-finance-inputs — **`finance_write` is the SIXTH `ACTION_TYPES` member and the `inline` arm's THIRD occupant.** `actionType.ts` gained the member, `actionTypeOf`'s parameter union and the `ARMS` row; `cockpit.ts` gained the matching `_ARM_TABLE` row and one dispatch branch beside `crm_write`'s, calling `cash.applyFinanceClaims(ctx, plan.tenantId, plan.financeClaims)` and patching the plan `done`. Adding the member without an arm was a COMPILE error in exactly the two places this playbook promises it would be — the `satisfies Record<ActionType, Arm>` bind at `cockpit.ts:581` and the DERIVED `ExternalActionType` at `:588` — and `approvals.ts`'s `planKind` return union was the third, which is what dragged the second approve surface into the same commit. **NOT `externalAction`:** a figure update writes our own `financeInputs` rows, so there is no fetch, no `EXTERNAL_TARGETS` entry and nothing for the retrier to retry. **Two model-facing surfaces are deliberately NOT touched and are the staging task's to close:** `llm.ts`'s `buildAgentContext` has no `finance_write` branch, so a staged figure plan would be announced to the model as an email plan (the correction note there already records that this is a hand-maintained site, not a compile-error one), and `workspace/cards.tsx` has no finance card. Neither is reachable today — nothing can stage a `finance_write` plan yet.)
>
> **[SUPERSEDED 2026-08-10 by 19-12 — THIS DEFECT IS CLOSED. See the closure block at the top
> of this playbook. Kept verbatim because the DIAGNOSIS is the reusable part; the "NOT applied",
> "one line" and "regression guard is owed" clauses are now HISTORY, not open work.]**
> Last verified: 2026-08-10 (Plan 19-10 Task 2 — the OWNER UAT, run as `e2e/pipeline-uat.spec.ts`.
> **19-11 FIXED THE LOOP. THE BROWSER STILL NEVER SENDS A CLOCK, SO ACTN-05 IS STILL UNREACHABLE
> FROM THE PRODUCT.** The invariant below says every input `buildCockpitTools` takes must ride
> `runAgentLoop`'s args. It needs ONE MORE HOP: **every input `runAgentLoop` takes must ride the
> CLIENT's call.** `ChatPane.tsx`'s `onSend` posts `send({ threadId, text })` flat, and
> `grep -rn clientContext apps/web` returns NOTHING — no web caller has ever sent it. Measured live
> at UAT step 7: "Remind me Thursday to chase Jane (jane@example.com) about the renewal" came back
> *"I couldn't stage the follow-up reminder for Thursday since the date wasn't clear"* — the
> `no_clock` refusal — **and wrote the bare contact anyway**, the same two-wrongs shape 19-10
> measured, reached by a different route. `parseSendTime("Thursday", …)` resolves offline at $0, so
> the date was never the problem.
> **Why fixture 36 is green and the product is not:** `run-eval-golden.mjs:1394` supplies
> `clientContext: { tz: "UTC", nowMs: Date.now() }` for every `clock: true` fixture. The gate
> certifies a code path the browser cannot reach — the same shape as the `__invokeCockpitTool`
> blind spot 19-11 names below, one layer further out.
> **It is not only ACTN-05.** `setSendTime` (llm.ts:1950), `checkAvailability` (:2260) and
> `proposeCalendarEvent` (:2306) take the identical `no_clock` exit, so natural-language send-time
> and calendar staging are equally dead from the composer. Every E2E that appears to cover them
> drives a `SMOKE::` sentinel, which pins its own clock.
> **The fix is one line**, in `apps/web/app/(app)/dashboard/workspace/ChatPane.tsx`'s `onSend`:
> `clientContext: { nowMs: Date.now(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }`.
> NOT applied at the UAT: `:3111` serves a production build the UAT was forbidden to rebuild, so it
> could not be VERIFIED, and an unverified product change is what this phase keeps getting burned
> by. The four other web callers (`SegmentAnatomy`, `AbnormalBriefBanner`, `PostCall`, and
> `cards.tsx`'s regenerate/remove) are equally clockless and belong in the same edit.
> **A REGRESSION GUARD IS OWED WITH THE FIX, and it must be a BROWSER one** — every offline layer
> here supplies its own clock, which is precisely why this survived 19-11.)

> **[SUPERSEDED 2026-08-10 by 19-12 — THIS DEFECT IS CLOSED. The diagnosis in this block was
> correct and is exactly what was implemented; only its tense is stale.]**
> Last verified: 2026-08-10 (Plan 19-10 Task 2 — **SC#5's WITHHELD REPORT CANNOT BE SEEN BY A
> HUMAN.** 19-05 shipped `Sent to N. Withheld M who unsubscribed: <addresses>.` on both approve
> surfaces and unit-pinned the string. Both render it from component `useState`, and both cards
> are gated on `status === "proposed"` (`PlanCards` in `cards.tsx`; `approvals.listAwaiting`,
> which paginates `"proposed"` only). A SUCCESSFUL approve IS the `proposed → approved`
> transition, and the reactive subscription lands it before `execute()` resolves — so the
> component that would show the note has already been replaced by the report card when
> `setNote`/`setResult` runs. Observed: not visible at any point in 90 seconds; the user sees a
> report listing FOUR recipients with the fifth simply absent and nothing saying it ever existed
> (screenshot: `.planning/phases/19-contacts-crm-follow-ups/uat/step-09a-after-partial-send.png`).
> The two REFUSAL notes survive precisely because a refusal LEAVES the plan proposed — which is
> why UAT steps 10 and 11 pass on that same mechanism. **The withheld set belongs on the PLAN ROW,
> not in component state**: it is a durable fact about what was approved, and the report card is
> where a human looks afterwards. Anything kept in `useState` across a status flip is unreachable
> by construction.)

> Last verified: 2026-08-10 (Plan 19-11 — **THE ACTN-05 DEFECT IS FIXED, AND THE CAUSE WAS NOT THE
> MODEL.** Fixture 36 is GREEN against the live `cockpit-agent@18`: `--only 36`, run `266ef8f4`,
> $0.0056, PASS on the first attempt with `datedFollowUpCount` intact and the body BYTE-UNCHANGED.
> **The root cause: `runAgentLoop` builds its OWN tool set and passed `undefined` for
> `buildCockpitTools`' 4th argument — the trusted clock.** So `stageCrmWrite`'s dated follow-up took
> its `no_clock` refusal on EVERY live cockpit turn, and so did `setSendTime`, `checkAvailability`
> and `proposeCalendarEvent`. The model had been supplying the whole follow-up all along: seven
> refusals were logged on eval run `7e375c3c`, every one
> `{"reason":"no_clock","ops":["addFollowUp"],"dueProvided":[true],"noteProvided":[true]}`.
> **Why nobody could see it.** The clock plane was only ever exercised through
> `__invokeCockpitTool` (which bypasses the loop and passes a clock directly) or the SMOKE path
> (which pins its own), so every offline test passed against tools built the way production never
> builds them. `runCockpitAgent` DOES build a clocked tool set — but only the SMOKE branch uses it.
> **THE INVARIANT: every input `buildCockpitTools` takes must ride `runAgentLoop`'s args.**
> `skillVersions` and `omitRecipientEdits` were both threaded when someone hit this; the clock never
> was. A new `buildCockpitTools` parameter that is not also a `runAgentLoop` parameter is silently
> dead in production. `runCockpitAgent.test.ts` now pins the clock end-to-end through the loop
> (mutation-proven: restoring `undefined` gives `expected undefined to be 'crm_write'`).
> Two further shape fixes landed with it, both mutation-proven and neither a body edit:
> a contact carrying `due`/`note` is now REFUSED rather than silently stripped and reported as
> "1 change(s) … staged"; and the DEGRADE GRADIENT is closed — all-or-nothing refusal made a
> simpler list the model's cheapest retry, and the simplest list that succeeds is a bare
> `addContact`, so once a follow-up is refused in a turn a contact-only retry is refused too.
> **NO registration surface was added** — no new tool, no `agentSteps.tool` literal, no VERB entry,
> so the 14-site checklist below is unchanged and needs no walk. The fix is entirely inside
> `stageCrmWrite`'s schema/boundary plus one `runAgentLoop` argument.
> **A full gate was NOT run and is NOT owed for this change**: the skill body is byte-identical, so
> gate `086f8267`'s 35/35 evidence still stands and only fixture 36 needed re-proving.
> Every `stageCrmWrite` refusal now emits one enum-only structured log
> (`{"event":"stageCrmWrite.refused","reason",...}` — op TYPES and booleans, no addresses, no notes,
> no due strings: §4-clean by construction). It is what turned this from guesswork into a
> measurement, and it is the first place to look if a CRM turn misbehaves again.
> **A THIRD shape fix landed after the above, closing the phase's last open defect: `stageCrmWrite`
> could be handed a FABRICATED address.** `parseCrmOperations` accepted any non-empty string, so on
> run `266ef8f4` the agent — asked for a follow-up "not tied to anyone", which the body forbids —
> satisfied the required-`email` brake by inventing `email: "no-email"` and the row staged. The
> parse now applies **`isValidEmail`, the send path's OWN rule** (`@pikar/core`, the same one
> `applyRecipientEdit` bounces a bad recipient with) — NOT a second validator, because a CRM that
> accepts what the send path refuses builds an unemailable contact book. Two new
> `CRM_PARSE_REFUSAL` entries carry it. **The follow-up sentence is load-bearing and was written
> deliberately:** the model reached `no-email` BECAUSE an address was required, so a bare "invalid,
> retry" leaves inventing a better-formed fake as the cheapest next move — it instead forbids
> placeholders by name and states the correct exit (tell the user this CRM cannot hold a follow-up
> about nobody). Same shape as the degrade-gradient fix above: close the downhill path, don't just
> block the current step.
> **The related data-loss half needed NO code change, and `patchPlan`'s wholesale
> `crmOperations` replace was deliberately LEFT ALONE.** A plan row is the CURRENT STAGED STATE, not
> a log; appending would make a model correcting its own list double it. The loss came from a
> REFUSAL reaching `patchPlan`, which cannot happen — every refusal here is an early `return` above
> the mutation. That is now asserted on the STORED `crmOperations`, never on reply text.
> Re-verified live: `--only 36`, run `0b2b6b22`, **$0.0057, PASS**, body still byte-unchanged.
> `agentSteps` shows turn 2 making TWO `stageCrmWrite` calls with the plan row still holding turn
> 1's op — both refused, nothing overwritten.
> SCOPE of this entry: `llm.ts` (`stageCrmWrite` + the `runAgentLoop` clock arg + two refusal
> strings), `cockpitTools.test.ts`, `runCockpitAgent.test.ts`, `@pikar/core` `contacts.ts`
> (+ its test), and `eval-cases/36-crm-follow-up.json` (description only — assertions untouched).
> No UI, no schema, no new tool.)
>
> Previously verified: 2026-08-09 (Plan 19-10 — **`cockpit-agent@18` IS NOW THE ACTIVE BODY** (activated
> on owner authorization after gate `086f8267`, 35/35), so `stageCrmWrite` and contacts-first
> resolution are reachable in production. Any note below describing v18 as a candidate or ACTN-05
> as "certified but not live" is STALE.
> **BUT THE CAPABILITY DOES NOT ACTUALLY WORK, and this is the important half.** Asked in plain
> language to add a dated follow-up for a named person, the live v18 body stages an `addContact`
> and no follow-up at all — measured at `--only 36`, run `309b1c3d`, $0.0142, with the plan row read
> back at $0 holding exactly one `addContact` and no `dueAt`; on the run's other attempt it staged
> nothing and the plan stayed `collecting`. The 35/35 was green over this because 19-09's
> `crmOperationCount` is a COUNT and cannot tell op types apart. 19-10 added `datedFollowUpCount`
> to the closed expect vocabulary, so fixture 36 went RED (**FIXED in 19-11 above — it is
> now GREEN and the cause was a dropped clock, not the body**) until the
> body reaches the tool. **Do not fix this by adding another prohibition to the body** — 19-09
> already proved that road: the body forbids the adjacent failure VERBATIM and the model did it
> anyway on 2/2 runs. The candidate fix is the TOOL'S SHAPE or an explicit refusal when a follow-up
> request yields a contact-only operation list. See `contacts-crm.md` → Known gaps.
> SCOPE of this entry: the activation fact, the defect, and `apps/web/e2e/` (whose Pipeline spec ran
> for the first time — `dashboard-pages.md` carries that detail). No cockpit turn, tool, gate or
> row changed here.)
>
> Previously verified: 2026-08-09 (Plan 19-08 — **the cockpit now READS the person store in-loop and
> STAGES its writes through the plan gate.** `llm.ts`, `schema.ts` and `cards.tsx` changed, in ONE
> commit, plus a new `internal.contacts.savedForName`.)
>
> **1. CONTACTS FIRST, mailbox second, inside the EXISTING `resolveContacts`.** A saved contact is a
> DELIBERATE HUMAN STATEMENT about who someone is; a Gmail-header match is an INFERENCE drawn from
> who happened to share a thread. So `resolveContacts` looks the name up against `contacts` first and
> only falls through to `internal.gmail.search` on a miss. There is deliberately NO second resolution
> tool — that would be a second registration surface for one job. Both planes rank with the SAME
> `rankCandidates` (@pikar/core), fed saved rows shaped as header records, so the two can never
> disagree about who Sarah is. On a hit the match's OPEN follow-ups ride back in the same return, so
> "what do I owe them?" costs no second tool call; each note goes through `scanText` first, because a
> note is prose that could hold an address and this tool's contract is that no address reaches the
> model (§2-D).
>
> **2. `resolveContacts` NEVER WRITES A CONTACT ROW, and that absence is the SC#7 enforcement point.**
> "No contacts cache at rest" (contacts-crm.md invariant 1) means a row exists only because a human
> deliberately acted, and resolving a name is not that act. `savedForName` is an `internalQuery` with
> no write in it and the header plane writes nothing either. **Proven by ROW COUNT, not by reading
> code**: `cockpitTools.test.ts` counts `contacts` before and after a resolution that matched nothing,
> one and several. The contacts-first ORDERING is proven the same way — `gmail.search` always writes
> exactly one refs-only `mailbox.searched` audit row, so zero rows means the header search never ran.
> A reply-string check would pass on a header search that returned the same labels.
> MUTATION-VERIFIED: adding an unconditional `gmail.search` call above the saved branch turns that
> assertion RED (`expected [ { …(8) } ] to have a length of +0 but got 1`).
>
> **3. `stageCrmWrite` is ONE tool carrying a LIST, and it applies NOTHING.** A `saveContact` tool and
> a `logFollowUp` tool would be two registration surfaces, two literals, two VERB entries and two
> fixtures for one governed act — and 19-CONTEXT locks "one plan carries a list of operations, applied
> atomically", which two tools cannot express. It patches `kind: "crm_write"`, `status: "proposed"`
> and `crmOperations`, and `executePlan`'s `inline` arm (19-06) is the only thing that ever writes a
> row. Four properties are load-bearing:
> - **`parseCrmOperations` runs at the WRITE boundary too**, not only at the apply-boundary re-parse.
>   It is idempotent over its own output, so the double parse is safe by construction, and the plan
>   row therefore stores NORMALIZED addresses the applier never re-derives.
> - **The AGENT may only ADD.** `completeFollowUp`/`cancelFollowUp` are refused at this boundary even
>   though `CrmOperation` carries them: closing someone's follow-up is a judgement about work being
>   finished and the Pipeline page is where a human makes it. Same asymmetry as invariant 11.
> - **§2-D on the due date.** The model passes the user's WORDS (`due`), never an instant; the tool
>   resolves them with `parseSendTime` against the TRUSTED `clientContext` clock and refuses without
>   one. A model-supplied epoch would be a fabricated date rendered on an approvable card.
> - **`origin` is not a model input.** It is hardcoded `mailbox-resolved`, the same literal
>   `applyCrmOperations` uses when a follow-up upserts its contact. Letting the model label
>   provenance would make the field unreliable for everyone downstream.
>
> **4. It REFUSES over a half-composed email rather than hijacking the plan row.** A thread has ONE
> plan row, so patching `kind`/`status` onto a row holding recipients/subject/body/attachments would
> turn a live email draft into a CRM card and strand the work. The `stageResearchPlan` /
> `stageMediaPlan` refusal, applied to the same hazard. Every refusal — draft in progress, add-only,
> no clock, an unparseable list, an undated or contactless follow-up — is a RETURNED SENTENCE, never a
> throw out of the governed loop (18-06's rule).
>
> **5. THREE registration surfaces, and the plan's count was right this time.** `llm.ts`'s tool key,
> `schema.ts`'s `agentSteps.tool` literal and `cards.tsx`'s VERB entry, all in one commit. BOTH guards
> were mutation-proven: dropping the schema literal turns `cockpitTools.test.ts`'s key-scan RED
> (`expected [ 'stageCrmWrite' ] to deeply equal []`) **and** `traceParity.test.ts` red on the orphan
> side; dropping the VERB entry turns `traceParity.test.ts` RED on the missing-verb side
> (`agentSteps.tool literals with no VERB entry …: stageCrmWrite`). NEW this plan: because
> `SMOKE_OP_TOOL` is `Record<AgentSmokeOp["kind"], StepTool>` and `StepTool` derives from the schema
> union, a SMOKE-registered tool ALSO breaks `tsc` when its literal is dropped. That is a stronger
> guard than the 14-site checklist below has for any other surface — but it only exists for tools
> with a SMOKE op, so do not generalise it.
>
> **6. The tool key is NOT yet visible to the model.** Registering a tool does not put it in the
> model's context; the active `cockpit-agent` skill body must teach it (the 18-06 → 18-08 lesson).
> Until then only the `SMOKE::agent::crm=` op reaches it. 19-09 owns the body edit and the eval.
>
> Previously verified: 2026-08-09 (Plan 19-07 — WATCH-GATE BUMP ONLY, no cockpit behaviour changed.
> This playbook watches `apps/web/e2e/`, and 19-07 authored `e2e/pipeline.spec.ts` — two tests,
> discoverable, **never executed**. Nothing in `cockpit.ts`, the tool set or the arm table moved.
> *(That spec ran once at 19-10 and was DELETED at 19-13 — it could only ever pass once. See
> `contacts-crm.md` Known gaps.)*)
>
> Previously verified: 2026-08-09 (Plan 19-06 — **`ACTION_TYPES` has a FIFTH member, `crm_write`, and it
> is the `inline` arm's SECOND occupant.** `actionType.ts`, `cockpit.ts`, `schema.ts`, `plans.ts`,
> `approvals.ts`, `llm.ts`, `cards.tsx` and `ApprovalsView.tsx` changed, in ONE commit.)
>
> **1. `crm_write` is `inline`, not `externalAction`, and the reason is the definition.** `inline`
> means "a single transactional write"; a CRM write targets our OWN `contacts` / `followUps` tables,
> so there is no `fetch`, no third-party API and nothing for the retrier to retry. Routing it
> through the retrier would buy at-least-once delivery of a write that is already exactly-once.
> The arm sits ABOVE the Gmail pre-check and above the postal-address gate on purpose, so a CRM
> write approves on a tenant that could not send at all — the memo arm's property, inherited.
> An `inline` member needs NO `EXTERNAL_TARGETS` entry and must not be given one: `ExternalActionType`
> is DERIVED from `_ARM_TABLE`, so adding a target for `crm_write` would not compile.
>
> **2. ALL-OR-NONE IS FREE, AND SO IS DOUBLE-APPROVE.** A Convex mutation is one serializable
> transaction, so a throw on the third operation discards the first two — no saga, no compensation,
> no idempotency key beyond `executePlan`'s existing `proposed → approved` CAS, which is also what
> makes a second approve apply nothing. `applyCrmOperations` is called DIRECTLY (not through
> `runMutation`) precisely so it shares that transaction. *Enforcement:* `cockpit.test.ts`
> "executePlan crm_write arm" — the invalid-third-operation test asserts zero rows AND
> `status === "proposed"`, and the double-approve test asserts the row counts are unchanged.
>
> **3. THE REGISTRATION CHECKLIST — a new `ACTION_TYPES` member visits ALL of these, in ONE commit.**
> A partially-registered action type is worse than an unregistered one: the discriminated union goes
> non-exhaustive and the failure surfaces somewhere unrelated. Only the first four are compile
> errors; the rest are silent.
> - [ ] `packages/core/src/actionType.ts` — `ACTION_TYPES` (the array)
> - [ ] `packages/core/src/actionType.ts` — `actionTypeOf`'s parameter union (mirrors `plans.kind`)
> - [ ] `packages/core/src/actionType.ts` — `ARMS` (**compile error** — `satisfies Record<ActionType, Arm>`)
> - [ ] `packages/core/src/actionType.test.ts` — `_COMPLETE_ARMS` (**compile error**, the same bind
>       re-stated as a test backstop) and the EXACT-array assertion on `ACTION_TYPES`
> - [ ] `packages/backend/convex/cockpit.ts` — `_ARM_TABLE` (**compile error** — the second, separate bind)
> - [ ] `packages/backend/convex/cockpit.ts` — the arm body in `executePlan`'s `switch`
> - [ ] `packages/backend/convex/schema.ts` — the `plans.kind` union (+ any new content-plane field)
> - [ ] `packages/backend/convex/plans.ts` — `patchPlan`'s HAND-MAINTAINED mirror of that union
> - [ ] `packages/backend/convex/plans.ts` — `resetPlan`, which must clear any new staged field
> - [ ] `packages/backend/convex/approvals.ts` — `planKind`'s return union (**compile error**:
>       widening `plans.kind` fails here first, which is what drags the Approvals surface in)
> - [ ] `packages/backend/convex/llm.ts` — `buildAgentContext`'s model-facing branch (**NOT** a
>       compile error — see invariant 4)
> - [ ] `apps/web/.../workspace/cards.tsx` — the card branch, placed BEFORE the email chrome
> - [ ] `apps/web/.../workspace/cards.tsx` — the `hasDraft` exclusion, or a DRAFT card prints an
>       email body beside it
> - [ ] `apps/web/.../approvals/ApprovalsView.tsx` — `ApprovalKindBadge`'s `Record<PlanKind, string>`
>       (**compile error**, via `approvals.ts`), `titleFor`, and `actionLabel`
>
> **PITFALL 1, the one with no compile error: `patchPlan`'s `kind` union is a HAND-MAINTAINED mirror
> of `schema.ts`'s.** Widen the schema and not the mirror and every typecheck in the repo still
> passes — `Doc<"plans">` comes from the schema — while the RUNTIME arg validator rejects the new
> kind at the first real propose. Only a call THROUGH the real validator can see it.
> *Enforcement:* `plans.test.ts` "patchPlan accepts kind: crm_write (19-06 — the hand-maintained
> union mirror)", plus a second test that `resetPlan` clears `crmOperations` (the Pitfall-6 class: a
> staged list surviving a reset would be applied by the NEXT approve in the thread).
>
> **4. `buildAgentContext` is NOT a compile-error site, and the comment that said it was is now
> corrected in place.** It claimed branching on `actionTypeOf` rather than on `plan.kind` made a new
> member surface as a compile error. It does not: `PlanRow`, the type every caller passes, does not
> declare `kind` at all, so widening `ACTION_TYPES` never breaks the call. `media` proved it —
> it shipped in Phase 20 without ever reaching that parameter union. The runtime field IS present,
> so the branches fire; the type merely under-declares. **A new action type must be added there BY
> HAND, and one that is not gets announced to the model as an email.**
>
> **5. The plan card's line list is read through the SAME validator the applier runs.**
> `describeCrmOperations` (`cards.tsx`) calls `parseCrmOperations` (`@pikar/core`), which
> `applyCrmOperations` also calls at the apply boundary, so the card cannot promise something the
> server would refuse. An unparseable list renders "nothing to approve" with NO Approve button
> rather than a partial promise. *Enforcement:* `crmCard.test.ts`.

> Last verified: 2026-08-09 (Plan 19-05 — **the send path is now GUARDED AT TWO POINTS and every
> product email carries a CAN-SPAM footer.** `executePlan`, `gmail.send`, `plans.recordDeliveryTerminal`,
> `deliverApprovedPlan`, `pipeline.ts` and the cockpit plan card changed.)
>
> **1. The send path converges TWICE, and both points are guarded. Neither is redundant.**
> `executePlan` drops suppressed addresses PER ADDRESS; `gmail.send` refuses a suppressed recipient
> per send. The approve-time filter is the one that can drop ONE address out of five and still send
> to the other four — `gmail.send` sees group mode as ONE comma-joined string and can only refuse
> the whole row. The send-time backstop is the one that catches a suppression created AFTER approve:
> `startScheduledDelivery` re-fires a `requestIds` list frozen at approve time, so a filter alone
> cannot see it. Deleting either leaves a real hole. *Enforcement:* `cockpit.test.ts` "executePlan
> suppression + postal-address gates" and `gmail.test.ts` "a suppression created AFTER approve is
> refused at send", which asserts ZERO fetches — the refusal lands before a credential is minted.
>
> **2. EVERY refusal in `executePlan` runs BEFORE the CAS patch.** A refusal after
> `patch(planId, { status: "approved" })` leaves the plan `approved` with zero `requests` rows and
> no workflow — a half-approved state nothing can resume (the 20-07 lesson). The two new refusals,
> `no_postal_address` and `all_recipients_suppressed`, sit above it beside `gmail_not_connected`.
> The per-address partition must ALSO stay above it for a second reason: `mode === "group"`
> collapses recipients into one comma-joined string right below, after which a per-address drop is
> impossible. *Enforcement:* every test in that block asserts `status === "proposed"`; moving the
> filter below the CAS was mutation-verified RED and reverted.
>
> **3. The footer lives at the `buildMime` CALL SITE and must never move inside `buildMime`.**
> Two reasons, both load-bearing: `notifyExternal.ts` is a SECOND `buildMime` caller sending a
> static service notice to the user's OWN mailbox (no recipient to unsubscribe, so a footer there
> would be a lie), and `gmail.test.ts`'s V4 tests pin `buildMime`'s zero-attachment bytes. It cannot
> move EARLIER either — the model's output flows `plans.body → plans.recipientBodies →
> requests.draft` and `getForDelivery` reads `editedBody ?? draft`, so every earlier stage is a
> bypass. `footerFor` returning null is a hard THROW (the missing-attachment-blob precedent), and
> the message names the tenant's postal address AND `UNSUBSCRIBE_SECRET`/`CONVEX_SITE_URL` because
> the query collapses all three causes into one null.
>
> **4. A post-approve suppression terminates as `blocked`.** `recordDeliveryTerminal` gained a
> `"suppressed"` outcome that patches `requests.status = "blocked"` (an EXISTING member — no new
> state) and DECREMENTS `recipientTotal`, so the counters balance and `queuedCount` reaches 0. A
> bare `continue` (correct for the RESUMABLE `awaiting_reauth`) would strand the row at `delivering`
> forever. **Correction to plan 19-05's premise: `gmail.send` has TWO production callers, not one** —
> `deliverApprovedPlan.ts` and `pipeline.ts`. The pipeline lane carries no `planId`, so it patches
> `blocked` directly instead of calling `recordDeliveryTerminal`. Re-grep before assuming one.

> Last verified: 2026-08-09 (Plan 19-04 — the public unsubscribe route — **`http.ts` gained a SIXTH
> and SEVENTH route, and they are the first PUBLIC UNAUTHENTICATED ones in this file.**)
> SCOPE: this entry covers `http.ts` alone, as changed by plan 19-04. No cockpit turn, tool, gate or
> stored row changed; the send path that will mint these links lands in 19-05. Full detail lives in
> `contacts-crm.md`.
>
> `GET /unsubscribe/<raw>.<hmac>` and `POST` on the same `pathPrefix`. Four things about it that are
> decisions, not incidentals:
>
> 1. **The GET is inert by CONTRACT and the POST is the only mutating verb.** Corporate mail scanners
>    and link prefetchers fire every URL in a message, so a GET-suppresses design silently
>    unsubscribes people who never clicked. The confirm button is what stops the feature firing
>    itself. `contacts.test.ts` proves inertness by counting `suppressions` rows before and after the
>    GET — a status-only check passes on a handler that writes and returns the same HTML.
> 2. **It lives here and not in `apps/web`.** `apps/web/middleware.ts` is default-deny (`isPublic` =
>    `/`, `/privacy`, `/terms`, `/signin`, `/signup`), so a public page there costs a
>    security-sensitive matcher edit PLUS a bearer-secret hop back into Convex to write the
>    suppression. The Convex site origin is untouched by that middleware — the same reason the fal
>    webhook works. The page is therefore inline-styled from the BRAND §2 hex values, with a
>    `ponytail:` note naming that trade as the upgrade path.
> 3. **`pathPrefix`, not `path`** — Convex's router has no `*` glob, so `path: "/unsubscribe/*"`
>    matches nothing at all. The 20-06 lesson, now on its third route.
> 4. **`UNSUBSCRIBE_SECRET` is its own deployment secret, SEPARATE from
>    `GOOGLE_OAUTH_CLIENT_SECRET`.** A link that lives forever in a recipient's inbox must not share
>    the OAuth signing key. There is deliberately **no env guard at this route**: `verifyUnsubToken`
>    in `contacts.ts` holds the single fail-closed check and a second copy here would make that one
>    vacuous (`contacts-crm.md` invariant 8). Same reasoning rejects a rate limiter — the operation
>    is an idempotent upsert behind an HMAC-SHA-256 digest.
>
> Only 200 and 404 leave the route; a stale-but-well-formed token and a malformed one are
> indistinguishable from outside.

> Last verified: 2026-08-09 (Plan cash-business-finance Task 10 — the watched
> `apps/web/e2e/finance.spec.ts` gained the three-tab/Business-figure/owner-Operator-tab tests and a
> `test.describe.configure({ mode: "serial" })` to keep the non-owner-first/owner-last order real
> under `playwright.config.ts`'s `fullyParallel: true`; no cockpit behaviour, tool, gate or stored row
> changed. Attempted `pnpm --filter @pikar/web test:e2e` again — still NOT EXECUTED, no
> `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` and no local `convex dev`/Next stack running in this worktree.
> See `docs/playbooks/dashboard-pages.md`'s Task 10 entry for the full account.)
>
> Last verified: 2026-08-09 (Phase 26 Plan 10 — **the watched `apps/web/e2e/` path gained
> `finance.spec.ts`, and the Finance rail item went LIVE on owner direction; no cockpit behaviour,
> tool, gate or stored row changed.**) The Cost Console route is `/dashboard/finance` and its nav
> item now carries an `href`. The rail branch keys off `href`, not `soon`, so rollback is deleting
> that one property — and it does NOT stop ledger instrumentation, which must keep running whatever
> the UI does. Two things in the new spec are worth
> copying rather than rediscovering: it asserts the NON-OWNER boundary **before** calling
> `owner:bootstrapOwner` (**superseded 2026-08-21** — the grant now has an inverse, so that ordering
> is a convenience rather than a one-way door; the spec revokes on every run and in `afterAll`); and
> it seeds through the real `spendLedger:record` writer,
> so a green run proves the projection and the role gate and proves **nothing** about a provider —
> no model call, fal job or invoice is involved, and no seeded `actual` row may be cited as evidence
> that money reached OpenAI or fal.
>
> The same pass changed `apps/web/vitest.config.mts` to `esbuild: { jsx: "automatic" }`, matching
> Next's transform. Before it, esbuild's classic runtime meant any `.tsx` reached from a test
> compiled to `React.createElement` and threw `React is not defined` unless the component carried a
> default `React` import it never otherwise used. `ApprovalsView.tsx` still carries that dead import;
> it is now unnecessary and can go whenever that file is next touched.

> Last verified: 2026-08-09 (26-07 follow-up, `llm.ts` — **the agent loop's eight spend sites now
> carry correlations, and every one of them needed a discriminator beyond the obvious ref.**)
> `recordModelSpend` gained REQUIRED `kind` and `correlationId` parameters — required at the HELPER
> even though `recordSpend`'s own arg is optional, because seven call sites reach it and the
> compiler is the only thing that can enumerate them. The agent loop uses
> `agentloop:<loopId>:a<attempt>` where `loopId = turnId ?? crypto.randomUUID()`: **`attempt`
> separates the primary model from the CHEAP_MODEL fallback, which is a SECOND fully-billed call
> and not a retry of the first** — without it the fallback's charge returns the primary's row and
> vanishes. The web-search fee is a separate payment inside the SAME turn, so it appends `:search`
> rather than sharing the turn's token-cost correlation. The digest, reply and voice-brief helpers
> each mint a per-execution `runId` and suffix `:a0` / `:a1` across their try/catch pair for the
> same reason. **Deliberately NOT used as a discriminator: the AI SDK's `toolCallId`** — it is
> provider-supplied and unvalidated, so interpolating it could throw the ledger's charset check
> AFTER the money was spent, and on at least one path it degenerates to a hardcoded literal. A
> minted nonce is both shorter and safer. Policy and the full per-site table:
> `docs/playbooks/guardrails.md` §"Phase 26".
>
> Last verified: 2026-08-08 (26-07 follow-up — **the pipeline's LLM charges now carry a DERIVED
> spend correlation, and adding it needed a deploy guard.**) `recordLlm` passes
> `correlationId: req:<requestId>:<stage>:<seq>` (exported as `llmSpendCorrelation` so a collision
> is testable rather than inlined), plus `model`, `kind: pipeline.<stage>` and the `requestId` ref.
>
> **DERIVED, never minted.** `recordSpend` runs here as a JOURNALED WORKFLOW STEP, so a workflow
> replay re-runs it WITHOUT re-spending; a `crypto.randomUUID()` would mint a second `actual` row
> for money that moved once. The opposite rule applies at every action call site — see
> `docs/playbooks/guardrails.md` §"Phase 26" for why the policy splits on that one question.
>
> **`requestId`, NOT the handler's `correlationId`.** The latter is a bare `v.string()` that the
> smoke seeder supplies freely, so it could carry whitespace or exceed 128 chars and would throw
> the ledger's charset check AFTER the model call was billed. A Convex id is regex-safe by
> construction.
>
> **`seq` is the discriminator that matters.** It is `usages.length` read BEFORE the push — the
> array is append-only and appended only there, so it is 0 for route, 1 for the first draft, 2 for
> the first regenerate: deterministic on replay, distinct for every real charge. `stage` alone
> would collapse every regenerate onto the first draft's row, and each regenerate IS a real second
> model call.
>
> **`{ unstableArgs: true }` IS MANDATORY HERE AND IS NOT COSMETIC.** These step args grew, and this
> pipeline parks for up to `SEVEN_DAYS` at the review gate. A workflow already mid-flight replays
> the step against a journal entry recorded with the OLD args and dies on `Journal entry mismatch`
> — killing an in-flight request whose money is already spent. The option is present in the pinned
> `@convex-dev/workflow` (verified in `dist/client/step.d.ts`). It is droppable only once nothing
> started before that deploy can still be parked, i.e. `SEVEN_DAYS` after it ships. **Any future
> change to a journaled step's args carries the same hazard.**
>
> Last verified: 2026-08-08 — **A MODEL-SUPPLIED ARGUMENT IS NOT CONTROL FLOW: `createDocument`'s
> `replace`.** The live model sends `replace` on EVERY call, including the FIRST, when the
> conversation holds no created documents at all. The tool obeyed it, routed a create down
> `patchCreatedDoc`, and that mutation refused CORRECTLY ("there's no document #1") — so nothing was
> ever created, the agent read the honest refusal as "try again", and looped: **thirteen tool calls
> in a two-turn fixture, every one recorded `done`, zero documents.** Every component was behaving
> perfectly in isolation; the whole defect was trusting one model-supplied integer. Fix:
> `effectiveReplace = docIds.length === 0 ? undefined : replace` — with ZERO created documents
> `replace` cannot denote anything, so it is NOISE, not a refusal case. **Do not widen this to every
> out-of-range index:** once documents exist, an out-of-range `replace` keeps its honest refusal,
> because there the user may genuinely mean a document numbered differently, and creating a second
> document when a revision was asked for is the failure the paired tests exist to keep apart. Both
> directions are pinned in `cockpitTools.test.ts` and mutation-verified RED.
>
> **This is the `confirmed`-flag principle, and it was already written down.** 18-08 gave
> `createDocument` no `confirmed` argument precisely because "a model-supplied confirmation flag is
> the model grading its own trigger" — but `replace` predated that reasoning and never inherited the
> distrust. When a tool takes an optional argument that SELECTS A CODE PATH, assume the model will
> populate it whether or not it means to; validate it against server-held state before branching.
>
> **The concealment is the lesson for debugging.** Two things hid this for a whole paid gate: a bare
> `catch` (now logs its reason, per the rule `ErrorBoundary.tsx` already states), and a failure path
> that RETURNS A PLAUSIBLE SENTENCE — so the tool "succeeded", `agentSteps` said `done`, and the
> feature looked like it merely hadn't managed it. What settled it was the OFFLINE `SMOKE::agent::`
> op proving the whole chain worked with no model involved, which relocated the fault from "the code
> is broken" to "the arguments are wrong". Reach for that op FIRST next time. Also found and NOT
> fixed here: `agentSteps:record` throws `ArgumentValidationError` on `recordScorecardAnswer` — that
> name is missing from the `agentSteps.tool` union, so every scorecard tool call fails to record a
> step; the SDK swallows callback throws, so it is invisible outside the logs.

> Last verified: 2026-08-08 — **`listThreadMessages` guards AUTHORIZATION, so it must not then
> assume EXISTENCE.** `plans.threadId` is a plain `v.string()` and is NOT guaranteed to name an
> agent-component thread: `smoke:seedCockpitPlan` writes `smoke-attach-<uuid>`, and legacy rows can
> predate the thread they point at. The handler returned an empty page for an UNOWNED thread and
> then passed the raw string to `listMessages`, whose validator is `v.id("threads")` — so an
> OWNED-but-nonexistent thread THREW where an unowned one degraded. That asymmetry was the bug:
> the throw is uncaught in the browser, kills the whole React tree, and takes the ENTIRE cockpit
> page down — and it is reachable from the `?thread=` URL parameter, i.e. from user input. Found in
> the 26-05 Approvals UAT via "Open in cockpit" on a seeded plan. Both cases now return the SAME
> empty page. The catch is deliberately NARROW — `isNonAgentThreadIdError` — so a real component
> fault is never masked; do not widen it to a bare `catch`, and do not let it match a validator
> rejection on a DIFFERENT table (that is somebody else's bug and must still throw).
>
> **THE HARNESS IS NOT PRODUCTION, AND THIS IS THE FILE THAT PROVES IT.** The first fix matched only
> `Expected ID for table "threads"` — `convex-test`'s wording. It passed the integration test and
> the live cockpit CRASHED ANYWAY, because the deployed runtime words the same rejection completely
> differently: `ArgumentValidationError: Value does not match validator. / Path: .threadId /
> Validator: v.id("threads")`. A test whose ERROR TEXT is generated by the harness proves the
> harness, not the product — the same class as 15.3-09's stubbed-request lesson in vault.md. Both
> messages are now pinned VERBATIM in `cockpitThreadDegrade.test.ts` (the live one captured from a
> real browser console), alongside negative cases. **Rule: when behaviour keys off an error MESSAGE
> crossing a component or service boundary, pin the real one from a live capture — never only the
> one your test harness happens to raise.** Anything reading a thread id off a `plans` row owes the
> same treatment.

> Last verified: 2026-08-07 (**`resolveModel` is now a two-vendor seam.** `llm.ts:144` mapped every
> model id through `openai()`; it now branches on the id prefix, so `google/gemini-2.5-flash` routes
> to Vertex AI while `openai/*` is untouched. The prefix scheme was ALREADY there — model ids have
> always been `openai/…` for pricing/audit — so this cost no new id format and no call-site changes.
>
> **REVISED AGAIN — GEMINI HAS TWO DOORS, AND THE FREE ONE IS PREFERRED.** `resolveModel`'s `google/`
> branch now picks **AI Studio** (`@ai-sdk/google`, `GOOGLE_GENERATIVE_AI_API_KEY`, free rate-limited
> tier) when that key is set, and falls back to **Vertex** (`@ai-sdk/google-vertex`, service account)
> otherwise. Identical model names, so the `google/…` namespace and every `PRICING` row are unchanged.
>
> **This was learned the hard way and is the reason the preference order is what it is: VERTEX AI HAS
> NO FREE TIER.** Two separate GCP projects were tried with a real service account on 2026-08-07
> (`project-c3a75795-f866-4b37-8ec`, then `gen-lang-client-0695333543`) and BOTH returned
> `BILLING_DISABLED` before generating a token — confirmed by a raw REST call with our whole stack
> bypassed, so it was never an integration bug. A service account authenticates fine and still cannot
> call the model without a LINKED billing account. Do not "simplify" this back to Vertex-only.
> Vertex stays wired because it is the only door to Imagen/Veo (ADR-016).
>
> The grounding tool follows the TRANSPORT, not just the vendor: `google.tools.googleSearch` under AI
> Studio, `vertex.tools.googleSearch` under Vertex, both gated on the SAME env check as
> `resolveModel` so the tool and the model can never disagree.
>
> **REVISED SAME DAY — this is CROSS-VENDOR FAILOVER, not a migration.** The owner's aim is that both
> vendors alternate so work continues when either runs out of credit. `DEFAULT_MODEL` is Gemini and
> `CHEAP_MODEL` is OpenAI, which makes `runAgentLoop`'s existing primary → fallback step a provider
> failover for free. See `guardrails.md` for the rail/pricing half and the eligibility limit.
>
> **RESEARCH IS THE ONE PAIR THAT STAYS SINGLE-VENDOR, and the reason is structural — do not "fix" it
> by pointing `RESEARCH_FALLBACK_MODEL` at OpenAI.** `buildWebResearchTool` selects OpenAI's
> `webSearch` or Vertex's `googleSearch` ONCE from `RESEARCH_MODEL`'s prefix, and `runAgentLoop`
> reuses that single tools record for BOTH attempts. A cross-vendor research fallback would therefore
> hand Gemini a tool only OpenAI can execute — a guaranteed 400 on every fallback, which is precisely
> the failure mode the original "the fallback was probed TOO" comment exists to prevent. Crossing
> vendors here first requires the tools record to become a function of the model actually running.
>
> **The Vertex provider is built lazily and memoized, and the laziness is load-bearing, not tidiness:**
> constructing it at module scope would read the GCP env on IMPORT, so a deployment with no Google
> credentials would fail every OpenAI call too. Gemini was added ALONGSIDE OpenAI (owner decision
> 2026-08-07 — `DEFAULT_MODEL`/`CHEAP_MODEL` are NOT repointed), so a tenant that never names a
> `google/` model must never be able to notice the credential is absent. The throw can only fire on
> a request that asked for Gemini.
>
> **Credentials come from `GOOGLE_SERVICE_ACCOUNT_JSON`, an env var holding the whole JSON — NOT a
> file path.** `GOOGLE_APPLICATION_CREDENTIALS` is a path and **Convex has no filesystem**, so a key
> file on a developer's disk is unreachable from the deployed backend. `project` is read from the
> credential's own `project_id` so it cannot drift from the key. The parse failure message never
> echoes the raw value — it holds a private key.
>
> Dependency: `@ai-sdk/google-vertex@5.0.44`, chosen because its `@ai-sdk/provider@4.x` +
> `@ai-sdk/provider-utils@5.x` generation matches the pinned `@ai-sdk/openai@4.0.11` / `ai@7.0.20`
> pairing. It drags in `google-auth-library`, `@ai-sdk/anthropic` and `@ai-sdk/openai-compatible`;
> the lighter `@ai-sdk/google` was NOT chosen because it takes an AI Studio API key, not the service
> account, and cannot reach Imagen/Veo. Installing it moved the resolved `provider-utils` 5.0.7 →
> 5.0.23 under `@convex-dev/agent`, whose peer range was already unmet — **verified after the bump:
> backend typecheck 0 errors, backend suite 1211 tests with only a pre-existing unrelated failure**
> (see below), cost 56/56.
>
> **LIVE-VERIFIED 2026-08-07 — both pins answered through AI Studio.** `pnpm probe:gemini` exit 0 on
> `google/gemini-3.5-flash` (8 in / 78 out, $0.000197) and on `google/gemini-3.5-flash-lite`
> (8 in / 1 out, $0.000001). The `google/` branch of `resolveModel` works end to end.
>
> **THE PINS ARE 3.5, NOT 2.5, AND THAT WAS NOT OPTIONAL.** `gemini-2.5-flash` still APPEARS in the
> AI Studio model listing but refuses with "no longer available to new users" — so a listing is not
> proof of access, only a call is. Both 3.5 ids also appear in `@ai-sdk/google-vertex`'s model union,
> so the same ids serve both doors.
>
> **GEMINI 3.x REASONS BY DEFAULT AND ITS THINKING TOKENS COME OUT OF `maxOutputTokens`.** At a
> 16-token cap the probe got HTTP 200, 12 output tokens and **empty text** — no error at all. That is
> the failure shape most likely to be mistaken for success by anything downstream expecting prose, so
> `empty_text` is now a FAILING probe verdict rather than a footnote. The cost consequence is real:
> `flash` spent **78 output tokens to answer "OK"**, while `flash-lite` spent **1** — flash-lite does
> not run the reasoning pass. Any call site that caps output tightly must either raise the cap or
> disable thinking via `providerOptions`.
>
> **Still NOT proven:** the price rows (pinned unverified — the probe proves priceABLE, not priceD
> correctly), and `googleSearch` grounding, which no probe has exercised yet. Do not close 16-09 on
> the strength of this.
>
> **The probe that changes that: `pnpm --filter @pikar/backend probe:gemini`** (or
> `node scripts/probe-gemini.mjs` from `packages/backend` — the Convex CLI only resolves the
> deployment from there). It calls a new `llm:probeGemini` internalAction, so the work happens INSIDE
> the deployment: a credential that works on a laptop proves nothing about a backend that has no
> filesystem to read it from. Three exit codes, following `check-fal-catalog.mjs` rather than
> `skillopt.yml` — **0 PASS / 1 REFUSED / 2 UNREACHABLE**, and 2 never collapses into 0, because a
> probe that reports green when it never asked is the vacuous-gate defect `ci-gate.md` documents.
> There is no `|| true` in the file, deliberately.
>
> `unpriced` is a FAILING verdict, not a warning: a model that answers but has no `PRICING` row bills
> $0 against `DAILY_BUDGET_CENTS`, and a free-looking model is worse than a broken one.
>
> **Exit 2 is verified — exit 0 and 1 are NOT.** Running it 2026-08-07 produced a real exit 2 with the
> local backend up and the function merely unpushed; that observation is now the first hint in the
> script's own error text. The PASS and REFUSED branches have never executed, because
> `GOOGLE_SERVICE_ACCOUNT_JSON` has never been set on any deployment.
>
> Unrelated fix in the same pass: `llmRedaction.test.ts`'s pinned `audit.log` count for `cockpit.ts`
> was **red at HEAD** — 26-03 added `plan.discarded` and a second `plan.rescheduled` site while the
> pin still said 2. All four payloads were hand-checked and ARE refs-only, so this was a stale pin,
> not a §4 breach. It was strengthened rather than bumped: the old scan looped a hardcoded eventType
> list (so `plan.discarded` slipped in unchecked) and used a non-global `match` (so the second
> `plan.rescheduled` was never read). Sites are now derived from source — an unnamed new call site
> fails loudly instead of passing silently.)

> Last verified: 2026-08-07 (connect-gmail bounded-unavailable state — **a missing OAuth
> deployment config is now an operational STATE, not a thrown query.** `gmailAuth.gmailConnectUrl`
> used to return `string` by calling `buildAuthorizeUrl`, which `requireEnv`-throws when
> `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REDIRECT_URI` are absent. A
> throwing Convex query never resolves its React subscription, so an unconfigured deployment left
> `connect-gmail/page.tsx` on "Preparing consent link…" forever — the same eternal-spinner class the
> `(app)` layout's `<Authenticated>` gate exists to kill, arrived at from the env side instead of the
> token side. The query now returns `{ configured: boolean; url: string | null }` and the page
> renders a `role="alert"` panel telling the user OAuth is unconfigured and to ask an administrator.
> **`buildAuthorizeUrl` stays strict and unchanged** — the callback and token-exchange paths must
> never proceed on partial OAuth config, so the leniency lives ONLY in the client-facing read.
> Two `calendar.test.ts` cases pin both branches (incomplete env → `{configured:false,url:null}`;
> complete env → a URL whose `state` matches `^${userId}\.[a-f0-9]{64}$`, so the tenant binding is
> still asserted on the lenient path). DIFF-REVIEWED ONLY — I did not execute the backend suite, the
> web typecheck or any Playwright run in this pass; the change was authored by the
> `fix/ci-commit-errors` lane and reviewed here to keep this playbook true. Anyone citing it as
> green must run `pnpm --filter @pikar/backend test -- calendar` first.)
>
> Same pass closes a gap this playbook has been carrying since 22.1: `apps/web/e2e/connect-gmail.spec.ts`
> now asserts the copy the page actually ships ("Connect Google" / `/connect google/i` /
> "Google connected") plus the new `role="alert"` branch, instead of the pre-17-02 "Connect Gmail"
> strings. See "Known gaps" — the entry is updated, not deleted, because the spec still has no gate.

> Last verified: 2026-08-05 (Phase 26 Plan 05 owner preview — **the connected Approvals route is
> accessible from navigation while authenticated browser evidence and owner UAT remain pending.**)
> The owner rejected the disabled `Soon` item because it prevented in-product access to the page;
> activating `/dashboard/approvals` is an access correction, not an approval claim. The route reuses
> the one `executePlan` gate plus the
> shipped discard/schedule/cancel/move mutations; it does not add a fan-out starter. Initial email
> scheduling resolves browser-local `datetime-local` to an absolute instant, displays the resolved
> IANA timezone for confirmation, writes `setPlanSendTime`, and only then calls `executePlan`.
> Revise/change-time links reopen the originating cockpit thread. Attachment URLs remain on-demand.
>
> Automated evidence currently green: `pnpm --filter @pikar/web test -- approvals` (13/13) and web
> typecheck. The authenticated `approvals.spec.ts` is authored and actually entered its Convex-backed
> run, but the canonical setup stopped because this shell lacks `E2E_USER_EMAIL` and
> `E2E_USER_PASSWORD`; reuse of the saved state reached Sign in because that token is expired. Do not
> cite the browser gate as passed. With local Convex plus Next on `:3111` and the two credentials set,
> resume exactly: `pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts`.
>
> The browser fixture boundary is strict: internally seeded plan rows prove page states only; public
> mutations prove CAS/idempotency/races. No seeded row proves Gmail delivery, Calendar creation or
> media generation. Roll back by disabling the hidden Approvals route and retaining workspace,
> `/review`, `/requests`, `/ops`, all plan provenance/counters and the existing cockpit terminals.
> Authenticated browser evidence and owner UAT remain blocking; the preview link can be disabled
> independently if rollback is needed.

> Last verified: 2026-08-05 (Phase 26 Plan 03 — Approvals write semantics). The existing human
> `executePlan` gate remains the only email fan-out starter. This change adds guarded discard,
> current-schedule movement and exact new-plan delivery progress without creating a second send
> path.
>
> | Current state | Control | Result | Stored transition |
> |---|---|---|---|
> | `proposed` | Discard | `{ok:true, discarded:true}` | `canceled`, `cancelKind:"discarded"`, `canceledAt`; one refs-only `plan.discarded` |
> | any other state | Discard | `{ok:true, alreadyResolved:true}` | no write, no audit |
> | `scheduled` + current handle | Move | `{result:"moved"}` | old callback canceled; `sendAt` + handle replaced atomically; one refs-only `plan.rescheduled` |
> | `delivering` / `done` | Move | `{result:"already_fired"}` | no write; the scheduler won and the UI must show In Flight, never “Rescheduled” |
> | canceled, proposed, or otherwise unscheduled | Move | `{result:"not_scheduled"}` | no write |
> | `scheduled` | Cancel | `{ok:true, canceled:true}` | `canceled`, `cancelKind:"scheduled_cancel"`, `canceledAt`, handle cleared |
>
> **Discard never re-arms.** `reschedulePlan` accepts only an explicit `scheduled_cancel` or a
> legacy canceled row with missing provenance. A newly written `discarded` row always no-ops there.
> Missing provenance remains the backward-compatible historical scheduled-cancel case; new writers
> must never omit `cancelKind`.
>
> **The scheduler race has one truthful winner.** Every new callback carries `scheduledFor`; the
> callback reads the row and starts fan-out only while status is `scheduled` and `sendAt` still
> equals that token. A moved callback therefore no-ops even if it was already dequeued. Legacy
> callbacks have no token and may proceed only when the row is still due (`sendAt <= now`). Because
> cancel, move and fire all read/write the same plan row, Convex serializability yields canceled,
> moved, or already-fired — never a successful move after delivery started. Replaying the same move
> returns `moved` without adding a second callback or audit row.
>
> **Progress is exact only when the row says it is.** New email approvals seed
> `recipientTotal`, `queuedCount`, `sentCount`, `failedCount` and `counterComplete:true` from the
> frozen request targets. `plans.recordDeliveryTerminal` owns the request terminal and plan counters
> in one transaction. Request status is the replay key: a `sent`/`failed` row cannot increment again
> or flip terminal. Held `awaiting_reauth` rows remain queued. Legacy plans carry no completeness bit
> and keep their counters absent, so the later Approvals reader must use only its bounded partial
> fallback and must never present a fabricated exact zero.
>
> Focused verification:
> `pnpm --filter @pikar/backend test -- cockpit plans`,
> `pnpm --filter @pikar/backend typecheck`, and `node scripts/check-playbooks.mjs`.
>
> **Rollback boundary:** hide/disable the Approvals route and its mutations while retaining the
> existing workspace, `/review`, `/requests`, `executePlan`, stored cancellation provenance and
> progress fields. Do not erase provenance, reopen discarded rows, remove the stale-callback guard,
> or stop terminal instrumentation during UI rollback.

> Last verified: 2026-08-05 (15.4-04 watch-map acknowledgement — **no cockpit behavior changed;
> the watched `apps/web/e2e/` path gained an actually executed Vault regression spec.**)
> `vault-redesign.spec.ts` passed 2/2 against the authenticated local stack and covers the connected
> Vault route from root/category browse through folder-scoped search, preview and confirmed removal.
> It reuses `auth.setup.ts` storage state, seeds onboarding through the repository's internal E2E
> seam, and deliberately does not fake Drive import or folder-digest AI success. Run it with
> `pnpm --filter @pikar/web test:e2e -- e2e/vault-redesign.spec.ts`; the full close also runs both
> package test suites/typechecks, the web production build and `node scripts/check-playbooks.mjs`.
> Rollback is limited to the Vault E2E/playbook commit plus its isolated SMOKE-delete backend fix;
> no cockpit route, tool, plan, send gate or stored cockpit row changes.

> Last verified: 2026-08-04 (ADR-014 — **the cockpit can now propose a standalone image and still
> cannot generate one.** The executive-only `proposeImage` tool stages `mediaMode:"image"` plus the
> reviewed prompt on the unique plan row. It returns copy that explicitly says nothing was generated
> or charged. `agentSteps.tool` and the `cards.tsx` VERB map gained `proposeImage` together. The
> existing `plan.kind === "media"` canvas branch selects the new image output card; its **Generate
> image** mutation is a separate human click and is absent from every agent tool set. See ADR-014 and
> the media playbook's `Standalone image path` section.)

> Last verified: 2026-08-05 (calendar scope honesty — **THE GRANT PERMITS READING EVENT DETAILS.
> THE CODE DOES NOT. THAT GAP IS DELIBERATE AND IS A DIRECTION, NOT A GUARANTEE.** No code changed;
> a claim was corrected.)
>
> `calendar.ts:9-11` said the free/busy scope choice deletes the §4 / §2-D PII problem "BY
> CONSTRUCTION". **That was overstated, and the overstatement is the dangerous part.** What is true:
>
> - **`calendar.freebusy` genuinely does bound the availability path.** `freeBusy.query` returns only
>   `{start,end}` intervals, so event titles and attendee addresses cannot come back from THAT call
>   whatever anyone writes downstream. Taking `calendar.readonly` instead would have handed us the
>   details on every availability check. That decision stands and should not be revisited.
> - **But the grant also carries `CALENDAR_EVENTS_SCOPE`, and `calendar.events` is READ-WRITE.** It
>   permits viewing and editing events — titles, attendees, descriptions. The ceiling is not where
>   the comment implied it was.
> - **What actually keeps event details out of the system today is that NOBODY WROTE THE CALL.**
>   `calendar/v3/calendars` appears in exactly ONE non-test module on ONE line, used only by the
>   insert POST; there is no `events.list`, no `events.get`, no GET against that URL anywhere. That
>   is a property of the CODE, not of the scope.
>
> **⚠ THE CONSEQUENCE, WHICH IS WHY THIS IS WRITTEN DOWN.** Reading event details needs **NO new
> consent, no re-authorisation and no user-visible signal** — the existing grant already permits it.
> A single `events.list` call would work on the next deploy against every already-connected tenant.
>
> **⚠ AND `dispatchGuard.test.ts` WOULD NOT CATCH IT.** Its calendar tests count POST targets and
> assert the events URL has exactly one owning module. An `events.list` **GET** inside `calendar.ts`
> satisfies both and lands silently. Do not read those tests as covering event reads; they do not.
>
> **THE DIRECTION, decided by the owner 2026-08-05:** reading event details IS somewhere this
> product intends to go — "what does my Tuesday look like", "move my 3pm" need the event, not the
> interval. So the gap is left open on purpose rather than closed with a guard. **What must happen
> when it lands, none of which is optional:**
>
> 1. **The consent copy changes.** `connect-gmail/page.tsx` currently promises "check calendar
>    availability" — reading titles and attendees is materially more than that, and the user agreed
>    to the smaller sentence. `connectionsSurface.test.ts` sweeps capability NAMES, not granularity,
>    so it will NOT fail on this. It is a human obligation, not a test-caught one.
> 2. **The PII rails become live for this path.** Event titles and attendee addresses are user
>    content: they may never reach an `audit` payload, a `deadLetters` payload or a step-trace row
>    (CLAUDE.md §3/§4), and they must be redacted before any model call that is not the one
>    consuming them. Free/busy made a redaction layer unnecessary; event reads make it necessary.
> 3. **The scope stops being enough of an answer.** Today "we only see busy intervals" is honest
>    because of the absent call. The moment the call exists, that sentence must come out of every
>    surface that says it — including this playbook.
>
> Unchanged and still true: the model can STAGE a calendar event and can never book one
> (`llm.ts` references `internal.calendar.freeBusy` and nothing else — one line, 1540), and event
> bodies can carry neither `attendees` nor `sendUpdates`. Both remain test-enforced with named
> mutations.

> Last verified: 2026-08-05 (15.3-09 follow-up 3 — **THE SCOPE COPY HAD NOT CAUGHT UP WITH THE
> GRANT, AND THAT IS A CONSENT DEFECT, NOT A WORDING ONE.**)
>
> 15.3-09 appended `drive.readonly` to `GOOGLE_SCOPES` and updated **none** of the three surfaces
> that tell a human what the grant covers. The user was asked to grant read access to their entire
> Google Drive on a consent page that did not mention Drive; told, on disconnect, that they would
> lose "your mail AND your calendar"; and shown a connections row still labelled "Gmail & Calendar".
> All three are now correct:
>
> - **`connect-gmail/page.tsx`** — the consent paragraph names Drive and states the limit that makes
>   `drive.readonly` worth having: "it can never change or delete anything in your Drive".
> - **`DisconnectGoogle.tsx`** — the confirm names mail, calendar AND Drive, and says what actually
>   happens to imported folders (they stay in the vault, they stop refreshing).
> - **`ConnectionsPanel.tsx`** — relabelled "Google — Gmail, Calendar & Drive", and it now reads
>   `driveReady`. **A CONNECTED GRANT IS NOT NECESSARILY A COMPLETE ONE**: `include_granted_scopes`
>   is forward-only, so a tenant who connected before 15.3-09 is fully connected for mail and
>   calendar and holds no Drive scope, which `connected` alone reports as healthy. Without that
>   branch the shortfall was visible ONLY inside the vault's Drive panel — a user who never opens
>   the vault never learns why. The Connect link now also appears (as "Reconnect") for a connected
>   tenant whose grant lacks Drive.
>
> **`connectionsSurface.test.ts` now sweeps all three** against a CAPABILITIES list kept in step with
> `GOOGLE_SCOPES`. Add a fourth scope and the suite is red until every surface names it.
>
> **⚠ THE MUTATION CAUGHT THAT SCAN BEING VACUOUS, AND THE REASON GENERALISES.** The first version
> read the raw file, so the ⚠ comment sitting beside the consent copy — which naturally says
> "Drive" several times while explaining the rule — satisfied every assertion by itself. Deleting
> Drive from the actual sentence left all 16 tests GREEN. The scan now strips comments first.
> **Prose that NAMES the thing is documentation, not evidence.** Same idiom and same reason as
> `readExecutableCode` in `dispatchGuard.test.ts`, whose header says exactly this.

> Last verified: 2026-08-05 (15.3-09 follow-up — **no cockpit code changed; one TEST file did.**
> `dispatchGuard.test.ts`’s scope-before-refresh pin now LOOPS over both Drive actions rather than
> pinning `importDriveFolder` alone, because `listDriveFolders` (the folder picker) is what a
> pre-widening tenant actually hits first. The Calendar assertions in that file are byte-unchanged.)

> Last verified: 2026-08-04 (15.3-09 — **the Google grant gained a fourth scope, and every already-
> connected tenant is unaffected by it in the one way that matters: they do not have it.**)
>
> `DRIVE_READONLY_SCOPE` is appended to `GOOGLE_SCOPES` (`packages/core/src/calendar.ts`), which
> reaches both `gmailAuth.buildAuthorizeUrl` and the `http.ts` callback default. One scope covers
> `files.list` metadata, `alt=media` downloads and `files.export`. `drive.file` was rejected: it
> needs the Google Picker SDK from `apis.google.com` plus an API key and app id, which buys nothing
> while consent is in Testing mode.
>
> **⚠ ADDING A SCOPE RETRO-GRANTS NOTHING, AND THIS IS THE THING TO KNOW BEFORE WIDENING AGAIN.**
> `include_granted_scopes=true` is FORWARD-only: the NEXT consent returns a grant covering old+new
> scopes, but every token issued BEFORE the widening keeps its old `scope` string and refreshes
> perfectly happily. So every tenant connected before this phase would 403
> `ACCESS_TOKEN_SCOPE_INSUFFICIENT` on the first Drive call. The shipped handling is Calendar's,
> copied exactly: `hasScope(token.scope, SCOPE)` → return `reauth` **BEFORE** `freshAccessToken` and
> before any network call. Check it after the refresh and a permanent reconnect condition arrives
> looking like a provider failure. `dispatchGuard.test.ts` now pins that ordering statically for the
> Drive action as well as for both Calendar actions, and `vaultDrive.test.ts` pins the behavioural
> half — `fetch` was never called at all.
>
> `gmailAuth.gmailStatus` gained `driveReady`, a DERIVED BOOLEAN and never the raw scope string
> (this module returns booleans and timestamps about the grant, never an inventory of it). It exists
> because `connected` cannot distinguish "connected before the widening" from "Drive-ready", and a
> UI that gates on `connected` sends a pre-widening tenant into a 403 instead of into reconnect.
>
> No cockpit behaviour, no delivery path and no calendar assertion changed. Verified: core
> `calendar.test.ts` 15/15 (mutation RUN: delete the Drive scope from the join → RED), backend
> `dispatchGuard.test.ts` 14/14, `vaultDrive.test.ts` 11/11.

> Last verified: 2026-08-04 (reconnect banner — **a fresh consent now retires its own prompt, and
> the half that cannot self-heal is dismissible by hand.**
>
> `gmailAuth.store` marks every unread `gmail_reconnect` notification read for that tenant on each
> token write — the consent IS the reconnect the warning asked for, so the banner no longer outlives
> the problem. Direct `ctx.db.patch`, mirroring `flagExpiringTokens`' direct insert (same table, no notify
> path involved). **Requests parked at `awaiting_reauth` are deliberately NOT cleared here**:
> nothing resumes them yet, so clearing them would claim a send that never happens.
>
> **A comment in `ReconnectBanner.tsx` was FALSE and is corrected**: it claimed the workflow
> re-fires delivery on reconnect so the UI never re-prompts for approval. There is no resume sweep.
> Reconnecting does not re-send a held draft. That is why the hold half needed a dismiss affordance
> rather than an automatic clear — and why the copy no longer promises one.
>
> The dismiss control is split by what each half can honestly persist: the notification half goes
> server-side through `notifications.markRead` (the NotificationsBanner idiom); the hold half has no
> `dismissed` column, so its request ids go in a `localStorage` seen-set (`pikar:reconnectHoldsSeen`,
> the AbnormalBriefBanner idiom) — **no schema change**. The set is read in a `useEffect` after mount
> (SSR has no `localStorage`) and the banner renders `null` until then, so a dismissed banner never
> flashes back on navigation. A NEW hold or a NEW expiry warning re-surfaces it: dismissing silences
> today's prompt, never tomorrow's. A storage throw degrades to re-surfacing, never to hiding a hold.
>
> Verified: `calendar.test.ts` 33/33 (the new `store` test pins that other kinds and other tenants
> are untouched), `apps/web` typecheck 0 errors.)

> Last verified: 2026-08-04 (test-infrastructure — **no cockpit code changed; one TEST file did.**
> `research.test.ts` gained the `beforeEach(vi.useFakeTimers)` / `afterEach(vi.useRealTimers)`
> guard, because anything reaching `startIngest` schedules the WORKFLOW component's workpool runs
> and, under real timers, they fire AFTER the file finishes and retry-loop against a torn-down
> module runner — throwing `crypto is not defined` inside whatever unrelated file the worker runs
> next. That was the suite-wide flake; `vault.test.ts` was the main leaker. Full rationale and the
> two rules it leaves behind: `docs/playbooks/vault.md`, *the flake* section. No assertion,
> invariant or product line in this subsystem was touched.)

> Last verified: 2026-08-03 (20-11 tasks 1-3 — **no cockpit code changed; the media route this
> playbook documents is now ADR-recorded.** [ADR-012](../decisions/012-media-route-and-the-reel.md)
> records `cockpit.ts`'s `EXTERNAL_TARGETS.media` arm as ONE of the two human-initiated paid entry
> points — the other being the canvas mutations — and states that "plan-gated by construction" is
> STRUCTURAL: there is no code path from a dispatched specialist to any of the four paid
> capabilities, and `SPECIALISTS.media.tools` is `SPECIALIST_TOOLS` **by object identity**, so there
> is no media grant to widen. If a future change gives the media specialist a paid tool, it
> supersedes ADR-012 — three tests go red first.)
>
> Prior: 2026-08-03 (20-10 + the canvas tab — **the workspace right pane gained a THIRD
> plan surface and a viewport toggle.**
>
> **The surface:** `plan.kind === "media"` now early-returns `<MediaCanvas>` from `PlanCard`,
> beside the `memo` and `calendar_event` branches and for the same stated reason — everything below
> those branches is email chrome (recipients, mode, a send-time picker, "Send to N recipients") and
> every word of it would be a lie on a storyboard. `hasDraft` excludes `"media"` exactly as it
> excludes `"memo"`, or a DRAFT card prints beside the canvas. **That is the whole `cards.tsx`
> change** — `PlanCards` is NOT widened; the canvas is a new component mounted through the existing
> one-line switch, so `CardList`'s trace, `SourceCard` and `EvaluationCard` still render above it.
> Four style primitives (`capsTeal`, `typeBadge`, `briefingSheet`, `snippetSheet`) gained `export`
> so the canvas reuses them rather than duplicating tokens; no value changed.
>
> **The toggle:** an "Open canvas" / "Back to workspace" button beside "Clear workspace" swaps the
> pane between `CardList` and `CanvasPane`. **It is a VIEWPORT, not a route** — local state, so the
> thread, the tab strip and every in-flight subscription survive the switch; a `<Link>` to a second
> page would put the conversation a back-button away. `?view=canvas` is read once from
> `window.location.search` (the repo idiom — never `useSearchParams`, which would force a Suspense
> boundary for a value that never changes after mount). `aria-pressed` plus a CHANGING LABEL carry
> the state, never styling alone.
>
> **NO POLLING**, and this is the rule most likely to be broken by a well-meaning edit: a clip is
> 1–3 minutes of wall clock and the render adds 1–3 more, so the canvas shows meaningful state
> through minutes of nothing arriving — but the mechanism is Convex reactivity, not a ticker. There
> is no `setInterval` in the media surface and there must never be one.)
>
> Prior: 2026-08-02 (20-15 - **`http.ts` gained a FIFTH route: `GET /media/blob/*`.**
> SCOPE: this entry covers `http.ts` ALONE, as changed by plan 20-15. It is the render stage's byte
> path - the runner lives in `apps/web` (D11), so the landed clips and voice takes have to reach it
> over HTTP. Bearer-guarded by `MEDIA_RENDER_SECRET` with `/skillopt/export`'s exact fail-closed
> four lines; it takes ONE opaque job id and nothing else - no tenant, no path, no storage id
> (`http.ts:123-129`'s rule) - resolves it with `normalizeId`, and refuses any row that is not
> `succeeded`. NO HMAC path segment, unlike `/fal/callback/*`: fal is a third party holding no
> secret of ours, so its segment is the only thing that can authenticate it, whereas this caller
> already proves knowledge of the secret in the header and an HMAC keyed on that same secret adds
> nothing. The tenant boundary is UPSTREAM, in `renderReel.batchToRender`'s tenant-prefixed
> `by_batch` index - this route invents nothing but checks no tenant either. The four shipped
> routes are UNTOUCHED. Full detail in `media.md` ``## The renderer``.)
>
> Prior: 2026-08-02 (connections-tab fix wave — **`DisconnectGoogle` now owns its own `gmailStatus` subscription instead of trusting the caller's `connected` flag.** `disconnectGoogle` runs `deleteTokens` UNCONDITIONALLY before returning, so gating the component's mount on `status.connected` (as both `connect-gmail/page.tsx` and the Connections tab did) unmounted it — and destroyed its `revoked: false` partial-revoke warning — the instant a disconnect resolved. `connect-gmail/page.tsx` now renders `<DisconnectGoogle />` unconditionally, outside the `status.connected` branch; its orphaned comment describing the old inline behaviour is deleted. No backend behaviour changed.)
>
> Prior: 2026-08-02 (connections-tab Task 1 — **the Google disconnect control has one writer.** The confirm copy and the partial-revoke branch (`revoked: false` → point the user at `myaccount.google.com/permissions`) moved out of `connect-gmail/page.tsx` into `apps/web/app/(app)/_components/DisconnectGoogle.tsx`; `connect-gmail/page.tsx` now renders `<DisconnectGoogle />` and no longer calls `api.gmailAuth.disconnectGoogle` itself. No backend behaviour changed.)
>
> Prior: 2026-08-02 (20-08 + 20-14 — **the media DISPATCH route, and the voiceover arm's
> one line in `http.ts`.** ONE bump covering both plans of Wave 7; the wave rule allows one plan per
> playbook and this lane executed both.)
>
> **20-08 — `dispatchMedia` joins the executive's tool set.** `dispatchResearchTool`'s shape
> verbatim: stage the plan row, schedule, **return immediately**. The proposal does not arrive in
> this turn. It is gated by the SAME `grantDispatch` + `threadId` + `rootRequestId` condition, in
> the SAME spread — `{ ...dispatchResearchTool, ...dispatchMediaTool }` — so media can never become
> reachable in a context where research is not. One flag, one spread, the
> `webResearch`/`declareUnsupported` precedent.
>
> **The tool description carries one sentence research's does not need, and it is load-bearing:**
> the proposal is FREE and the generation is not. A model that implied the reel was being made would
> be describing a charge that has not happened. `MEDIA_UNDERWAY_REPLY` closes its own loop the way
> `RESEARCH_UNDERWAY_REPLY` does (do not wait, do not claim it, do not ask again) and adds *"Nothing
> has been generated and nothing has been charged"*.
>
> **`stageMediaPlan` is a COPY of `stageResearchPlan`, not a shared helper**, and `plans.ts`'s own
> `ponytail:` forbids the extraction in as many words. The callers genuinely disagree: research
> protects a `collecting` MEMO row; media protects an IN-FLIGHT REEL, whose liveness is not readable
> from `plan.status` at all. Three refusals: `reel_in_flight` (non-terminal `mediaJobs` rows — those
> clips are ALREADY PAID FOR and fal will call back regardless), `render_in_flight` (a live
> `renderStatus`), and `draft_in_progress`. **The first two are checked SEPARATELY because they fail
> at different times** — every job can be terminal while the render is still going, which is
> precisely when the render starts.
>
> **A dispatched media run spends TOKENS ONLY**, and there is a test that says so by absence: zero
> `mediaJobs` rows, `renderStatus` never set, and the token rail provably moved (so the zero is
> containment, not an inert run). The paid calls fire from `EXTERNAL_TARGETS.media` after the human
> Approve gate and from nowhere else.
>
> **`persistStoryboard` NEVER writes `shots: []`.** An empty deck that says `kind: "media"` is an
> empty canvas wearing a successful proposal's clothes — the user approves it, the reservation
> prices zero blocks, and nothing ever explains why. A body that does not parse lands as a MEMO with
> the lever named (`no_deck`, `narration_too_long` + block + count, …). There are TWO locks: the
> caller never calls with an empty deck, and `plans.persistDeck` refuses one anyway
> (**both mutation-verified RED**). It writes via `ctx.db.patch`, **not `patchPlan`** — `patchPlan`
> has no deck args and that absence IS the guarantee (20-02).
>
> **20-14 — `http.ts` gained ONE line**, `ASSET_PATH.tts` reading `payload.audio.url`. Everything
> downstream of it is the code a video take already walked; that sameness is the plan's whole
> argument. Full mechanism in `docs/playbooks/media.md` § *The voiceover stage*.
>
> ⚠ SCOPE: this entry covers `llm.ts`, `dispatch.ts`, `plans.ts` and `http.ts` as changed by 20-08
> and 20-14 ONLY. `check-playbooks` also names `calendar.test.ts` and `gmailAuth.ts` in the same
> demand — those are the **reconnect-banner lane's uncommitted work** and this entry makes no claim
> about them.
>
> Prior: 2026-08-02 (20-07 — **the `externalAction` arm has TWO occupants and is no longer
> calendar's.** `media` joined `ACTION_TYPES`; the arm body became `EXTERNAL_TARGETS` (one thunk per
> type) plus a per-type pre-step; approving a media plan reserves the WHOLE reel in the same
> transaction as the CAS. **The calendar path is behaviourally unchanged and there is a test that
> says so.** See `## The externalAction arm` below.)
>
> PREVIOUSLY: 2026-08-02 (20-06 — **`http.ts` gained a FOURTH route: `POST /fal/callback/*`.**
> Guarded by an HMAC path segment (`${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}`) plus a ±300 s
> `x-fal-webhook-timestamp` window; every refusal is a bare 401 with a byte-unchanged row, and the
> fail-closed unset-env guard lives in `mediaComplete.resolveJob` — the one place the comparison
> happens. The three shipped routes are UNTOUCHED: the Gmail OAuth callback, `/skillopt/export` and
> `/skillopt/writeback` are byte-identical, and the new route reuses `/skillopt/writeback`'s
> security rule verbatim — the tenant comes from the ROW, never from the request body. Full
> mechanism in `docs/playbooks/media.md` § *The landing plane*.)
>
> PREVIOUSLY: 2026-08-02 (20-05 — **`gmailAuth.hmacHex` is now exported.** That is the entire
> diff to this subsystem: one word, `async function` → `export async function`. **No behaviour
> change to the OAuth state path** — `buildAuthorizeUrl:59` and `verifyState` call the same function
> with the same body, and the 33 `calendar.test.ts` + 36 `gmail.test.ts` assertions over it are
> unchanged and green. The media submit adapter (plan 20-05) mints its per-JOB-ROW webhook segment
> with it rather than minting a second HMAC-path-segment pattern in `lib/hash.ts`; there is exactly
> one such pattern in this repo and it has been in production since Phase 2.)
>
> PREVIOUSLY: 2026-08-02 (20-02 — **the Phase-20 schema and trace freeze.** `plans` gained the
> media BLOCK DECK (`shots`, `artDirection`, `script`, `clipSeconds`) and the six RENDER-PLANE
> fields; `agentSteps.tool` gained `dispatchMedia` with its `cards.tsx` VERB in the SAME commit;
> `guardrailConfig.mediaKillSwitch` is optional so a missing row still reads OFF. All additive,
> zero migration.)
>
> **`resetPlan` wipes the deck AND the render.** A staged deck surviving a reset would re-stage
> onto the NEXT plan (the `eventTitle` rule), and a surviving `renderStorageId` would show the
> previous thread's reel under a brand-new proposal — a lie the user can watch. `patchPlan` drops
> undefined, so every new field must be named explicitly to clear.
>
> **`patchPlan` gains NO deck args and NO render args, and that absence IS the guarantee** — the
> `calendarEventId`/`calendarRunId` rule verbatim. Nothing reachable from the MODEL may write a
> block prompt or a narration line that later becomes a paid generation, or claim a render
> happened. The deck is written only by `persistStoryboard` (20-08) and the canvas editor (20-09);
> the render plane only by the render terminal (20-16). Do not "helpfully" add the args.
>
> **`plans.kind` and `patchPlan`'s `kind` union are a HAND-MAINTAINED MIRROR PAIR.** Widen one
> without the other and the runtime argument validator rejects the new kind while the schema
> happily stores it — the `PLAN_STATUS` Pitfall-5 lesson (`plans.ts:20-21`) in a second place.
> There is a third mirror: `packages/core/src/actionType.ts`'s `actionTypeOf(kind)` parameter type,
> which is why widening the schema alone is a NON-TEST typecheck error. **Plan 20-07 is the one
> that widens all three in a single commit** — 20-02 deliberately left `plans.kind` untouched.

> Last verified: 2026-08-02 (18-07 — **the Output card: the created artifact is SEEN in the
> conversation.** Documenting shipped surface that landed WITHOUT a playbook bump; `check-playbooks`
> was green only because foreign lanes kept touching this file, so a green hook was never the
> obligation being discharged.)
>
> `OutputCard` (`cards.tsx:1340`) is `SourceCard`’s dumb self-querying shape with ONE extra arg on
> the SAME `byThread` query — `role: "created"` (`:1343`). Zero new tables, zero new queries, zero
> new routes, zero new dependencies, no component library. It returns `null` on a turn that created
> nothing, which is why the diff was 91 added lines and ZERO removed and the shipped grounding
> `useQuery` call is byte-unchanged.
>
> **`vaultSources` IS DUAL-PURPOSE — never bare-`.first()` it.** No-role now means
> `role === undefined`, so `SourceCard` cannot start rendering created rows. Any Output-card read
> MUST filter `role === "created"`.
>
> **THE CARD ACCUMULATES; IT IS NOT PER-TURN.** There is no turn identity inside a tool closure and
> `buildCockpitTools` is rebuilt per invocation, so the tool READS the thread’s latest
> `role: "created"` row and APPENDS. The index is monotone over the whole conversation — which is
> what the tool description promises — so `#2`/`#3` stay addressable across turns. That needed one
> additive `internal.vaultSources.latestCreated`, because `byThread` is a `tenantQuery`
> (auth-derived) and the tool plane passes `tenantId` EXPLICITLY.
>
> **ONE `vaultSources` row per turn carries ALL N `docIds`.** That is what makes `replace: 2`
> addressable via `docIds[index-1]`. Do not split it into N rows later.
>
> **THE PLAN’S `titles[0]` HEADING WAS NOT IMPLEMENTABLE.** The row accumulates and a `replace: 2`
> revise lands the newest title in slot 2 — nothing on the row records WHICH slot moved, so any
> single-title heading is wrong after the first revision. The `#N` prefixes replaced it and double
> as the affordance for the `replace` grammar the tool teaches.
>
> **BRAND §6 BEAT THE IN-FILE PRECEDENT — do NOT “restore” teal text.** `ConfChip` in this same file
> sets `--teal-600` as 0.62rem TEXT, which §6 bans at ~2.9:1. The badge and the vault chip therefore
> put the teal in the FILL (`color-mix(in srgb, var(--teal-400) 30%, var(--card))`) and keep `--ink`
> for the label. Shipped copy, now the thing to match: `✍️ Created` / `✍️ Created · N` (capsTeal),
> an UPPERCASE `DOCUMENT`/`POST` badge read off the row’s own `form` (absent ⇒ DOCUMENT), titles as
> `/dashboard/vault` links, the subline **`Saved to your vault. Nothing was sent.`**, and `snippet`
> as the preview. Tokens only — zero hex added, and ZERO `--held` (its 3 occurrences are comments
> forbidding it).
>
> The badge reads `vaultSources.form`, written on every create AND every revise; FOUR tests go red
> if it stops being.
>
> ⚠ **THE SC#6 E2E SPEC HAS NEVER RUN.** It is authored and `--list`-discoverable, which is not a
> green run, and its own header says so. Two things are still owed: the Playwright RUN, and the
> BRAND conformance JUDGEMENT — the card has never been rendered in a browser. Status 2026-08-02:
> the onboarding half of that blocker is now CLEARED (`onboarding:__seedOnboardedTenant`, see
> `onboarding.md`), and `cockpit-render.spec.ts` passes. The REMAINING gate is
> `gmailAuth.gmailStatus.connected`, which hides the composer — `cockpit-activity.spec.ts:39` says
> plainly: do NOT weaken that gate, run these in a live human-verify session with a connected user.
>
> **The spec MUST send `SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager`.**
> The NESTED route prefix is part of the TOPIC and is load-bearing: `create=` only picks the tool,
> it does NOT keep the model out of the loop. Without the prefix `generateObject` fires for real,
> throws with no key, and NO vault row is written at all.
>
> Re-checked 2026-08-02 by the Phase-20 lane (20-01), which did NOT author this change: the code
> this entry describes (`gmailAuth.store` + its `calendar.test.ts` coverage) is still UNCOMMITTED
> in the shared working tree. Read against that diff and found accurate — the `by_tenant_read`
> scan patching unread `gmail_reconnect` rows is present as written, and `awaiting_reauth`
> requests are untouched as claimed. Nothing below is amended; the owning lane still owns the
> commit. **THIS WHOLE FILE IS DELIBERATELY LEFT UNCOMMITTED** — `check-playbooks` pairs
> working-tree code changes with working-tree playbook changes, so with `gmailAuth.ts` dirty and
> `cockpit.md` clean the gate blocks every turn end in this tree. That also holds back the
> **Phase-20 (20-02) entry at the top of this file**, whose code IS committed (`schema.ts`,
> `cards.tsx`, `plans.ts`). Whoever commits the gmail change should commit this file with it and
> delete this paragraph.
>
> Last verified: 2026-08-02 (**the reconnect banner is now clearable — by reconnecting, and by
> hand.**) Reported live: the user reconnected Gmail and the banner stayed up with no way out.
> Both of its triggers (`ReconnectBanner.tsx`) outlived the fix — a request parked at
> `awaiting_reauth`, and an unread `gmail_reconnect` notification — because nothing retired
> either on consent. (1) `gmailAuth.store` (the mutation `/gmail/callback` calls on every fresh
> consent) now patches the tenant's unread `gmail_reconnect` notifications to `read: true`,
> scoped by the `by_tenant_read` index. It writes the row directly rather than through
> `notifications.markRead`, mirroring `flagExpiringTokens`' direct insert — same table, and the
> notify path is a tenant surface. Held `awaiting_reauth` requests are deliberately NOT touched:
> the reconnect-RESUME sweep still does not exist (see the 22.1 disconnect entry below), so
> clearing them would claim a send that never happens. (2) The banner gained a ✕: it marks the
> unread `gmail_reconnect` rows read (`notifications.markRead`, the `NotificationsBanner` idiom)
> and files the visible hold ids in a `pikar:reconnectHoldsSeen` localStorage seen-set (the
> `AbnormalBriefBanner` idiom — no schema change, and a NEW hold or a NEW expiry warning
> re-surfaces the banner, so dismissing silences today's prompt and never tomorrow's). Guard:
> `calendar.test.ts` "store — a fresh consent retires the reconnect prompt" pins the kind and
> tenant scoping (other kinds and other tenants stay unread); 33/33 green.

> Last verified: 2026-08-01 (ACTN-03 — **the `declareUnsupported` TOOL DESCRIPTION lost its
> near-miss licence clause; `dispatch.test.ts`'s local-tool witness was rewired.**) Both files are
> watched here. (1) `llm.ts`: the description had said to declare "including when all you found
> were similarly-named or adjacent near-misses" — untouched since 22.1b, and it describes fixture
> 34's exact situation (abundant real indirect-prompt-injection guidance retrieved; only the
> invented quoted address missing), so it licensed the over-declaration the skill body's carve-outs
> were trying to prevent. It now reads "NOTHING you retrieved supports the CORE of the question —
> not merely one sub-question, and not merely one illustrative example". A tool description sits at
> the call site and can outweigh distant body prose: when a body edit does not take, read the
> description before writing another body edit. (2) `dispatch.test.ts`: the SC#1 containment cases
> proved "the harness is not inert" by asserting a granted LOCAL tool really emitted its step row,
> and used `searchVault` for that. Research is now web-only, and `webResearch` is
> PROVIDER-executed (it deliberately emits no step row), so `declareUnsupported` — the grant's only
> remaining local tool — takes that role. The containment assertions themselves are unchanged and
> still fail if a withheld write tool moves the plan row. Do NOT add a
> `not.toContain("searchVault")` at the `buildCockpitTools` layer: that record is CONSTRUCTED in
> full for every caller and the web-only grant is enforced one layer up by the `toolNames`
> allow-list (asserted in `packages/core/src/specialists.test.ts`) — an assertion there fails for
> the wrong reason, which is how it was first written and caught.
>
> Last verified: 2026-08-01 (16-09 — **a research run that never searched writes no vault
> document.**) `persistResearchFindings` (`dispatch.ts`) refuses to write the `web_research` row
> when `webSearchCalls === 0`, auditing `research.persist_skipped` with refs+counts only. The memo
> CARD is deliberately untouched — it lands before the persist seam and keeps its
> `NOT_RESEARCHED_LABEL`, so nothing the user can see is withheld. Only the RETRIEVABLE artifact is,
> because `vaultSearch` returns arbitrary CHUNKS and a slice carries neither the label (which sits
> BEFORE the fence) nor the fence. Mutation-verified: disabling the guard turned exactly 1 of 17
> `research.test.ts` tests RED; restoring it returned 17/17. Backend typecheck 150, delta 0, zero
> non-test. Does NOT force a search — see `skill-registry.md` for that separate lever.
>
> ⚠ SCOPE OF THIS BUMP: it covers `dispatch.ts` + `research.test.ts` ONLY. A CONCURRENT session’s
> uncommitted edits to `llm.ts`, `specialists.ts`, `specialists.test.ts` and the
> `research-specialist` body sat in the same working tree when the hook computed its changed-set
> (the hook reads the whole tree, not this session’s diff). Those are NOT verified here and this
> line makes no claim about them.
> Last verified: 2026-08-01 (22.1-02 — per-tenant budget keying). The spend rail is now TWO windows (`guardrails.ts`): `dailySpendCents` keyed PER TENANT (`{ key: tenantId }` on every check/limit/getValue) and `deploymentSpendCents`, a deliberately KEYLESS ceiling. `prepare`/`preCall` check both — tenant first, so a tenant that is personally out is told so rather than blamed for a global pause — and `recordSpend` consumes both. Two distinct refusals now exist: `daily_budget_exhausted` (this tenant is done today) and `deployment_budget_exhausted` (everyone is paused). For THIS subsystem: `llm.ts`'s `recordModelSpend` gained a leading `tenantId` parameter (it is the shared spend sink — seven call sites route through it, so it is threaded once there rather than seven times), `runCockpitAgent`/`route`/`draft` pass their tenantId to `preCall`, and `digestInbox`/`draftReply`/`draftVoiceBrief` now destructure the `tenantId` they already declared. `pipeline.ts` gained the `deployment_budget_exhausted` BlockReason + label. **`dispatch.ts`'s sub-agent envelope now reads the TIGHTER of the two rails** — sizing it off a tenant's personal allowance when the ceiling is what will actually refuse would over-promise the envelope. `ENVELOPE_FRACTION` still takes its 25% of whatever that min() returns.
>
> PRIOR 2026-08-01 (22.1-01) — **Disconnect is real, it revokes at Google before it
> deletes locally, and the OWNER LIVE-VERIFIED it on 2026-08-01: a real connected account was
> disconnected from inside the app and the Pikar grant is GONE from
> `myaccount.google.com/permissions`. That is the one assertion no offline test can make — the
> revoke crosses a network boundary to Google, and every unit test necessarily stubs `fetch`.** `apps/web/app/privacy/page.tsx:312` has promised since launch that "you can
> disconnect your Google account at any time from within the application"; no such control existed
> and nothing in the repo called Google's revoke endpoint — a published legal claim with zero
> implementation. `api.gmailAuth.disconnectGoogle` (a `tenantAction`) now reads the row, POSTs the
> REFRESH token to `https://oauth2.googleapis.com/revoke`, then calls the new internal
> `deleteTokens`. **Three decisions worth not relitigating:** (1) it lives in `gmailAuth.ts`, NOT
> `gmail.ts` — `llmRedaction.test.ts` statically pins gmail.ts's POST set to exactly
> `[TOKEN_ENDPOINT, SEND_ENDPOINT]`, so a third POST there fails by construction and "just update
> the test" would delete a real governance guard; the default (non-node) runtime has `fetch`, as
> `voiceToken.ts` and `http.ts`'s code exchange already prove. (2) It POSTs the REFRESH token, not
> the access token — revoking an access token expires one short-lived credential and leaves the
> user's Google "Third-party access" entry standing, which is the exact bug this closes and one a
> naive 200-check would pass. (3) **200 and 400 both count as revoked** (400 = Google already
> considers it invalid, same end state — the `eventIdFor` 409-is-success discipline), and the local
> delete runs UNCONDITIONALLY: a failed revoke must never leave the crown-jewel refresh token at
> rest in a DB where nothing honours it. Importing `internal` into `gmailAuth.ts` was the one real
> risk (the §96 circular-inference cliff its own ponytail note warned about); the explicit
> `Promise<{revoked:boolean}>` annotation holds it — backend typecheck stayed at the exact 150-error
> baseline with ZERO TS2589, and the suite is 863/863. Two tests in `calendar.test.ts` (which
> already owns the one-grant story); the refresh-token assertion is mutation-verified RED.
>
> PRIOR 2026-07-31 (ACTN-03) — **A skill PIN now reaches the specialist, and `TASK_LINE`
> sequences the search.** THE BLOCKER: `DispatchArgs`/`dispatchArgs` carried no `skillVersions`, so
> `--skill offer-architect@2` stopped at the executive turn. `llm.ts`'s `pin` was always `undefined`
> → `getActiveSkill` → v1 — and v1 of all three gap specialists contains ZERO vault teaching ("a
> full build runs later"). Every `subagent.completed` payload in both paid runs reads
> `"skillVersion":1` while the run went on to write an EVAL_GATE evidence row certifying v2: **a pin
> that certified a body that never executed, with every test green.** `skillVersions` is now an
> optional field on the shared `dispatchArgs` validator (so `runSpecialist`, `runResearch` and the
> offline twin cannot drift) and is passed at all three `runSpecialistTurn` call sites; it is
> supplied by the CALLER, never by the runner's `a` — `SpecialistRunner` is deliberately unwidened.
> The research half rides `dispatchResearchTool`'s scheduler call, where `skillVersions` was already
> in scope as `buildCockpitTools`' 5th arg. Regression guard: the SC#1 happy-path test now proves
> both halves of the contrast — no pin ⇒ the ACTIVE row, a pin ⇒ that row. Second change:
> `TASK_LINE` now SEQUENCES retrieval ("Search the vault first, then work from what it returns")
> rather than merely permitting it — 0 of 4 gap dispatches across both paid runs called `searchVault`
> at all. It still does NOT re-teach "cite the document title": the three v2 bodies own that (§5),
> and duplicating registry teaching into a code-owned string is a second mechanism.
> PREVIOUS: 2026-07-31 (fixture-29 root cause) — **`searchVault` now returns each chunk under
> its SOURCE TITLE, and `TASK_LINE` no longer forbids the retrieval the specialist bodies mandate.**
> Two defects, one symptom (a grounded memo that cites nothing; eval fixture
> `29-gap-dispatch-offer-architect` failed `citesVaultDoc` on both paid runs). (1)
> `vaultGroundHydrated` returns three PARALLEL arrays — `docIds`, `titles`, `chunks` — and the
> `searchVault` tool passed `titles` to the `vaultSources` UI card ONLY: the model got
> `chunks.join("\n\n")` and never saw a title. All three gap specialists' §5 bodies say "Cite the
> document title beside every claim" (offer-architect.md:12-15, money-model-designer.md:15,
> lead-engine.md:15), and the cockpit's own honesty rule forbids claiming grounding it did not
> retrieve — every one of those instructions was STRUCTURALLY UNSATISFIABLE. The fenced return is now
> `[<title>]\n<chunk>` per document (same array, same index, same tenant-scoped read — no new call,
> no new plane, nothing added to any audit payload). (2) `dispatch.ts`'s `TASK_LINE` opened with
> "Work ONLY from the grounded facts above", which countermanded the registry body it is
> concatenated with ("Before you assert anything about this business, search the vault"); a
> driver-plane synthetic string must never override the §5 row. It now names the two legitimate
> sources (the snapshot and `searchVault`) and still forbids the only thing it ever meant to —
> inventing a figure neither source states. Note for the next reader: findings/`citationTitle` come
> ONLY from `provenance`, which is written when a doc FILLS a TRACKED scorecard path
> (`evaluations.ts:299-320`), so a vault doc that states no tracked field contributes NO title to
> the specialist prompt — the tool return is the only channel that can carry it. Verify:
> `npx vitest run convex/cockpitTools.test.ts -t searchVault` (asserts `[Q3 Report]` in the fence).
>
> PREVIOUSLY: 2026-07-31 (22.1b) — a SECOND value now rides the same path, for the same reason:
> `declaredUnsupported`, a BOOLEAN (§4-clean — the tool's `claim` argument is captured NOWHERE).
> `DispatchResult`'s ok-branch carries it, `subagent.completed` audits it, the `ok:true` return
> threads `turn.declaredUnsupported`, and `persistResearchFindings` hands it to
> `internal.research.persistFindings`, where it is a REQUIRED `v.boolean()` — never `v.optional`, as
> an optional boolean defaults to "no declaration", the fail-OPEN direction for an honesty label.
> `research.persisted` carries it beside `evidenceVerdict`, which is what explains an
> `insufficient_evidence` verdict with `sourceCount > 0` to a later reader. Same standing rules as
> below: **do not make it optional anywhere, and do not re-derive the verdict at either call site.**
> The tool is built in the SAME conditional spread as `webResearch` (one flag, one spread) so search
> can never be granted without the declaration channel. See "Phase 22.1b — the declaration channel"
> in `agent-runtime.md`.
>
> Last verified: 2026-07-31 (22.1) — the hosted-search COUNT now survives the whole research path.
> `DispatchResult`'s ok-branch carries `webSearchCalls` (a COUNT, §4-clean — never `sources`), the
> `ok:true` return threads `turn.webSearchCalls`, and `persistResearchFindings` hands it to
> `internal.research.persistFindings`. It was already computed, billed against and audited on
> `subagent.completed`, then DROPPED one function short of the verdict — which is why the stored
> document could not tell "searched and found nothing" from "never searched". `research.ts` uses it
> twice: the provenance header no longer says "No web sources were retrieved." on a run that never
> looked (it says "No web search was performed." instead, keyed independently of the source list so a
> drifted 0-call/N-source run still lists its sources), and `research.persisted` now carries
> `webSearchCalls` + `evidenceVerdict` (a count and a closed enum — no schema change). **Do not make
> the fence's `webSearchCalls` optional, and do not re-derive the verdict at either call site: it
> comes from `evidenceVerdict()` in `@pikar/core`, once.** See "Phase 22.1 — the evidence verdict"
> in `agent-runtime.md` for the measured evidence.
>
> Last verified: 2026-07-30 (17-04) — Calendar creation now runs through the action retrier only
> after the human `executePlan` gate; the model loop retains only content-free availability and
> staging tools. See "Phase 17 — 17-04" below.
>
> Last verified: 2026-07-30 (17.1-06) — **the confirmed business blueprint is standing context on every model-backed cockpit turn, including turns that call no tools.** `runCockpitAgent` reads `spineForTenant` only after the no-model SMOKE return path and routes the result through the one `buildTurnPrompt`: spine first, then history, plan context, and the current user line last. The read fails open to the byte-identical legacy prompt; `system: skill.body` remains the versioned registry body. VALIDATION item 24 drives the real read/render chain and mutation-pins production plus the test shim to exactly two helper call sites. See "Phase 17.1 — standing business-blueprint turn context" below.
> Also verified: 2026-07-29 (17-02) — the Calendar write arm is a two-module split: `calendar.ts`
> is `"use node"` and holds only `freeBusy` / `createEvent` actions; `calendarComplete.ts` is
> non-Node and is the sole writer of plan status, Calendar audit rows, and Calendar dead letters.
> See "Phase 17 — 17-02 (Calendar adapter + terminal)" below.

> Last verified: 2026-07-29 (16-08) — **D11's deterministic degradation contract is mutation-verified:** retryable search errors fall back, non-retryable errors propagate, zero results are labelled insufficient evidence, contradictions survive storage, and cost/step/clock ceilings return distinct partial-result markers. The research §4 audit scan proves only the question hash and source count cross the log plane, and the lineage reconstructs from `rootRequestId`. See "Phase 16 — the research degradation contract" below.

> Last verified: 2026-07-27 (16-07) — **the findings terminal is bolted onto `runResearch`, AFTER the landing.** `persistResearchFindings` (dispatch.ts) calls `internal.research.persistFindings` once `dispatchAndLand` has returned, so the approvable card exists before the vault write is attempted; a persist failure is audited (`research.persist_failed`, code only) and swallowed, costing groundability and not the findings. A governed refusal persists nothing. `DispatchResult` gained an optional `vaultDocId`, and `__runSpecialistWithScript` a `research` flag (the `softCutoffMs` precedent — `runResearch` cannot be driven offline). See "Phase 16 — 16-07" below and `vault.md` for the document contract. PREVIOUSLY: 2026-07-27 (16-06) — **the async research dispatch seam (DISP-02).** The executive's `dispatchResearch` tool STAGES a `collecting` memo plan row, SCHEDULES `internal.dispatch.runResearch`, and RETURNS — it never runs a model, so nothing runs inside the executive turn's step budget. Findings arrive as an approvable plan card, NOT inline. A persisted `collecting`+`kind:"memo"` interlock replaces the superseded per-turn envelope closure. See "Phase 16 — the async research dispatch seam" below. PREVIOUSLY: 2026-07-27 (16-05) — the webResearch key (built only when granted), per-call search billing counted on providerExecuted, and the research route wall clock + step budget. PREVIOUSLY: 2026-07-27 (17-01) — Phase-17 Wave-0 freeze: the calendar_event action type, the STRUCTURALLY FORCED externalAction arm (a stub that throws until 17-04), two trace literals, the staged-event plans fields + by_calendar_run index, calendarFixtures, the calendar plan card, and the pure @pikar/core calendar module. Also fixes the pre-existing replyToMessage VERB gap. PREVIOUSLY: 2026-07-27 (16-01) — Phase-16 Wave-0 freeze — the dispatchResearch literal, the three widened llm.ts signatures, the amended CKPT-05 lineage note. No behaviour change. PREVIOUSLY: 2026-07-26 (live-defect fix — **`buildAgentContext` no longer describes a memo plan as an email**). Found by live UAT: after `Act on this` staged a `kind: "memo"` plan, the NEXT cockpit turn replied *"The subject is set, and the email will be sent individually to each recipient. Would you like to proceed…"*. That was **not** the router mis-routing — `buildAgentContext` (`llm.ts`) rendered EVERY plan under `"Current email plan:"` with Recipients / Send-mode / Send-time slots and never read `plan.kind`, so the model was faithfully describing an email it had been told existed. Phase 15 generalized the EXECUTOR (`ACTION_TYPES` / `actionTypeOf` / `armFor`) but left this, the model-facing half, email-only; 12-05 had already put `kind: "memo"` on the row. Fix: `buildAgentContext` branches on the SHARED reader `actionTypeOf(plan.kind)` — never on `plan.kind` directly, so a new `ACTION_TYPES` member is a compile error here rather than silently rendering as email — and returns a memo-shaped block (subject + body-drafted only) that states a memo has no recipients, no send mode and no send time. **Absent `kind` still means email, so every pre-Phase-15 row is byte-unchanged.** Two regression tests in `cockpitTools.test.ts`, mutation-checked (disabling the branch gives exactly 1 RED). **Live-verified on the same scenario after the fix** — staged the memo plan again and asked "what is the current plan?": before it answered *"the email will be sent individually to each recipient… do you need to add recipients"*, after it answers *"The current plan is a memo… finalize it for saving to your knowledge vault"* — no recipients, no send, and it names the real memo terminal. (Residual, not worth chasing: the model sometimes adds a self-contradictory *"the body is drafted, but you haven't specified the content yet"* clause even though the block says `Body drafted: yes`.) Note for whoever writes the next assertion here: the memo block deliberately contains the words "email"/"recipients" in NEGATION ("A memo is NOT an email… do not offer to add recipients"), so a naive `not.toMatch(/email/i)` forbids the very sentence doing the work — assert on the absent SLOT LINES (`^Send mode:`, `^Recipients \(`) instead.
> Prior: 2026-07-26 (15.1-05 — the dispatched specialist's prompt now carries the tenant's TIER). `buildSpecialistPrompt` reads `internal.tenantProfile.forTenant` plus the behaviour-preset style directive and PREPENDS `tierBriefing(...)` on BOTH return paths (a tenant with no evaluation snapshot still has a tier). Prompt-shaping only — ADR-009: the offer SET is unchanged, `diagnose()` is not widened, `resolveSpecialist`/`SPECIALISTS` gain no filter layer, and **`llm.ts` is byte-unchanged** (a `git diff --exit-code` on it is a hard gate for this change). The style-directive read FAILS OPEN; the specialist BODY loader in `runSpecialistTurn` still fails CLOSED and must stay that way. See "Phase 15.1 — the tier in the specialist prompt" below.
> Prior: 2026-07-26 (15-04 — Phase 15 Lane A, where the specialist run LANDS). `dispatchAndLand` calls `internal.evaluations.landSpecialistResult` in a `finally`, so every outcome — success, overrun, all four governed refusals, and a thrown turn — leaves the plan row `proposed`; a row parked at `collecting` renders NO card (`cards.tsx:1624`), which is also why Phase 15 makes zero `apps/web` edits after Wave 0. The attribution header and the cost-ceiling marker ride the plan BODY, never a new `plans.status` literal. A thrown turn audits `subagent.refused` with the CODE only, DLQs nothing, lands the fallback and RETHROWS — it is not a fifth governed refusal. See "Phase 15 — Lane A (dispatch core)" below.
> Prior: 2026-07-25 (15-03 — Phase 15 Lane A, the governed dispatcher). See "Phase 15 —
> Lane A (dispatch core)" below. `convex/dispatch.ts` is now real: the guard order
> (resolve → depth → cycle → envelope → run), four CONVERSATIONAL refusals that never DLQ, one
> tree-local cost envelope, and refs-only lineage on `audit.by_correlation(rootRequestId)`. No
> schema change, no new table, no new index. Related ADR: ADR-008.

> Last verified: 2026-07-25 (15-05 — Phase 15 Lane B, generalized executor). See "Phase 15 — Lane B
> (generalized executor)" below. `executePlan` now dispatches over a closed action-type table
> (`armFor(actionTypeOf(plan.kind))` + a `satisfies Record<ActionType, Arm>` bind) instead of an
> ad-hoc `plan.kind === "memo"` if. Pure refactor — the arms are the existing paths, the branch
> order is unchanged, and `deliverApprovedPlan.ts` is byte-unchanged.

> Last verified: 2026-07-25 (15-02 — Phase 15 Lane A, dispatch core). See "Phase 15 — Lane A
> (dispatch core)" below. `runAgentLoop` gained the append-only optional `toolNames` (absent ⇒ the
> full record, byte-identical), and `runSpecialistTurn` is the one exported specialist entry into
> the loop. `runCockpitAgent` behavior is unchanged. Related ADR: ADR-007.

> Last verified: 2026-07-25 (15-01 — Phase 15 Wave-0 freeze). See "Phase 15 — Wave 0 (freeze)"
> below. Three `agentSteps.tool` dispatch literals + their `VERB` entries landed, the missing
> Phase-12 `evaluateBusiness` `VERB` entry was fixed in the same pass, and four new source files
> were registered under this playbook as STUBS. No cockpit BEHAVIOR changed.
> Last verified: 2026-07-26 (14-08 — Phase 14 voice-doc post-call). FOUR surgical `cards.tsx` edits,
> no cockpit behaviour change: `EvaluationCard` gained a document-review branch for the healthy
> banner and suppresses the `/dashboard/profile` CTA on that branch; findings now render an optional
> `citationExcerpt` quotation (framework-agnostic, so Phase-12 rows are byte-identical); and
> `CardList` gained an opt-in `noPlanHint` defaulting to today's cockpit string. See "Voice-doc reuse
> of the evaluation card (14-08)" below. Prior: 2026-07-25 (14-01 — Wave-0 freeze, Phase 14
> voice-doc) — NO cockpit behavior change. `FRAMEWORK_LABEL` in `cards.tsx` gained one entry,
> `"document-review": "Document review"`.
> That map is typed `Record<Evaluation["framework"], string>`, i.e. derived from the Convex schema
> union, so it is **not optional bookkeeping**: the moment `evaluations.framework` is widened without
> it, `pnpm --filter @pikar/web typecheck` goes red. The two edits must always land in ONE commit.
> The EVALUATION card itself is unchanged — a voice-doc review is rendered by the same dumb
> single-`byThread`-read card as every business evaluation ("no new card idiom" still holds).
> Phase 14 also adds `apps/web/e2e/voice-doc.spec.ts` under this playbook's watched `apps/web/e2e/`
> prefix (it is therefore covered by BOTH this playbook and `voice.md` — a change there touches
> both). At Wave 0 it is a `test.fixme` placeholder carrying the agreed harness copied verbatim from
> `e2e/voice.spec.ts` — the `convexRun` node-spawn helper, the `CLI_FAILURE` output regex, and the
> `resolveTenantId` JWT reader. Plan 14-08 fills the body; do not invent a different harness, and do
> not un-`fixme` it before the post-call surface it drives exists.

> Last verified: 2026-07-25 (4) — **chat-head + tab strip density pass** (owner-reported: both were
> taking too much vertical space). The dominant cost was NOT the icons — it was the global
> `body { line-height: 1.6 }` inherited by the two-line name/subtitle block, which alone stood ~40px
> tall, more than the 2.1rem icon buttons beside it. Fixes: explicit `lineHeight: 1.15` + smaller type
> on the `h2`/`p` in `page.tsx`; `.chat-head` padding-bottom `0.6rem → 0.3rem`; `.chat-logo`
> `1.9rem → 1.35rem` (BrainIcon `16 → 12`); tab strip type/padding/gap/radius all reduced. **Two
> constraints are load-bearing and must not be "cleaned up":** (1) the header icon buttons are shrunk
> via a SCOPED `.chat-head .icon-btn` rule, never by editing `.icon-btn` itself — that class is shared
> with the composer, onboarding and AttachmentPicker, which keep their larger 2.1rem targets;
> (2) `.chat-tab { min-height: 1.5rem }` and the 1.5rem header icon buttons are the WCAG 2.2 AA 2.5.8
> 24px pointer-target floor, which is what stops this strip going smaller — removing them to reclaim
> space breaks accessibility, not just aesthetics. Net: header ~51px → ~30px, tab strip ~43px → ~29px.
> Prior: 2026-07-25 (3) — the PINNED "Weekly review" tab landed (13-03, BEVL-03): `REVIEW_TAB` is seeded into the `tabs` useState initialiser, renders WITHOUT a `×` (and without `has-close`), `closeTab` refuses its id, and selecting it renders a one-line explainer INSTEAD of `ChatPane` — the composer is suppressed because the synthetic review thread has no `plans` row. See "Phase 13 — the pinned Weekly review tab" below. Prior: 2026-07-25 (2) — session tabs are CLOSABLE (owner-reported: tabs could be opened but never dismissed). Each tab is now a `span.chat-tab.has-close` wrapping a `button.chat-tab-label` (select) and a `button.chat-tab-close` (dismiss) — a wrapper is required because a `<button>` cannot legally nest another button; the `+` new-chat pill stays a plain `button.chat-tab.is-new`. `closeTab(id)` removes the tab from the `tabs` view state and, ONLY when the closed tab was active, falls back to its neighbour (right first via `next[idx]`, then left via `next[idx-1]`, else `undefined` → a fresh New chat); closing a background tab never moves the user. The fallback is computed OUTSIDE the `setTabs` updater so the updater stays side-effect free under StrictMode double-invocation. **Closing is NOT deleting:** the tab strip is `useState` view state, so the thread, its messages, and its plan row are untouched — and the already-existing "Past chats" `HeaderMenu` (backed by the persisted, tenant-scoped `api.cockpit.listThreads`) reopens any closed conversation via `openThread`, so no new history UI was needed (ponytail rung 2 — the reopen surface already existed). The `×` glyph deliberately mirrors the existing `+` pill rather than introducing an icon-library dependency (§10: the app has no component library). A11y: each close button carries `aria-label={`Close ${label}`}` plus a `:focus-visible` teal outline. Verified: web typecheck clean; no e2e selector referenced `.chat-tab` (grepped before changing the markup). Prior: 2026-07-25 — cockpit attach `ATTACH_ACCEPT` now lists EXTENSIONS alongside the MIME types (`.txt,.md,.markdown`) and adds `text/markdown`, which it had never carried at all. Owner-reported: picking a `.md` opened the dialog to an apparently EMPTY folder. Two causes, both client-side — the string omitted markdown entirely, and Chrome resolves `accept` MIME types to extensions via the OS registry, where Windows has no `text/markdown` entry (so even the onboarding picker, which did list the MIME type, hid `.md`). The server was never the constraint: `classify()` routes `text/markdown` (via the `text/` prefix) AND a `.md` filename to the `document` path already. Distinct from the same-day `resolveMimeType` fix, which addressed the ALLOW-LIST check on an empty `File.type` after a file is picked; this one is about which files are offered. Verified: web typecheck clean. Prior: 2026-07-25 (12-05 — the gap-action + MEMO terminal, BEVL-02). **`executePlan` is no
> longer email-only.** A plan now carries an optional `kind: "memo"` discriminator and the approve
> gate branches on it AFTER the CAS read and BEFORE the mailbox pre-check: a memo-plan persists its
> body as a `next_step_memo` vault doc (`evaluations.persistNextStepMemo` → `startIngest`) and goes
> `done` WITHOUT seeding a `requests` row — `startFanout`/`deliverApprovedPlan`/`gmail.send` are
> structurally unreachable from that branch, and `deliverApprovedPlan.ts` is untouched. The single
> Approve gate, the CAS idempotence, and "zero sends before Approve" all still hold; what changed is
> that Approve can now mean SAVE. `resetPlan` clears `kind` (a reset must drop the memo shape or the
> next fresh compose in that thread would silently save instead of send — the Pitfall-6 class). The
> `Act on this` control on the EVALUATION card is the only writer that stages one; see "Phase 12 —
> Business evaluation" below and `business-evaluation.md` for the engine invariants.
> Prior: 2026-07-24 (10-03 — vault-grounding read-side UI). Surfaced grounding to the user in `apps/web/…/workspace/cards.tsx`: `VERB["searchVault"]` labels the SDK-emitted activity step ("Searching your knowledge vault…" / "Grounded in the vault", unknown keys fall back to "Working…"), and a `SourceCard` (dumb renderer over `vaultSources.byThread`, self-querying on `threadId`, null when ungrounded) renders the opaque `--card` sheet "📚 Grounded in N documents" with each title a `next/link` to `/dashboard/vault`. Refs-only (titles/docIds/count — no query, no chunk text). Inline `PreviewModal` per-title click-through deferred (needs a `getVaultDoc(byId)` query). `pnpm --filter @pikar/web typecheck` clean. See the "Phase 10 — Vault grounding" section below.
> Last verified: 2026-07-24 (10-02 — vault grounding). Added the read-only `searchVault` cockpit tool to `buildCockpitTools` (`llm.ts`) — copies the briefInbox three-plane split (refs-only `vault.searched` audit / `vaultSources` content-plane card / SC2-fenced chunk text into the loop), calls `internal.vaultGround.vaultGroundHydrated` with an EXPLICIT `{ tenantId, query }`, fails open on no-match/hiccup (SC1), tenant-isolated (BETA-05). `searchVault` added to the `agentSteps.tool` closed union (Pitfall 4). See the "Phase 10 — Vault grounding" section below; four regression tests in `cockpitTools.test.ts`. Plan 03 (later wave) owns the source-card UI + `VERB` label.
> Last verified: 2026-07-24 (08-08 phase close — §9 sweep) — NO cockpit behavior change. Phase 8 (self-improvement) touched two cockpit.md-watched paths: `cockpit.ts` gained the IMPR-01 skill-version attribution (`proposeEmailPlan` stamps the active `cockpit-agent` version on `plans.skillVersion`; `executePlan` copies it onto every seeded `requests` row — the seam that makes a feedback rating attributable to the exact skill version), and `http.ts` gained the `/skillopt/export` + `/skillopt/writeback` routes (the SkillOpt seam — documented in skill-registry.md's "Phase 8: SkillOpt write-back loop" section). Bumped so the §9 Stop hook clears against the phase baseline. The manual cockpit-agent dry-run (proof-of-life) is the owner checkpoint — not yet run.
> Last verified: 2026-07-21 (07-06 phase close) — NO cockpit code change; the Phase-7 close re-proved the cockpit fail-closed gate by grep: `executePlan` returns `{ ok: false, reason: "review_escalated" }` at cockpit.ts:497 BEFORE the CAS flip, and `proposeEmailPlan` caps re-proposes via `classifyReviewDecision` (cockpit.ts:393) with `MAX_REGENERATE` imported from `@pikar/core` (never inlined). Offline suite green (cockpitTools 52/52, runCockpitAgent 18/18, llmRedaction 33/33); live agent-timeout + review-breach human-verify pending (07-VALIDATION Manual-Only).
> Last verified: 2026-07-21 (07-04) — **the LIVE cockpit review gate is now BOUNDED and FAILS CLOSED (REVW-02, cockpit half).** 07-03 fixed the pipeline gate; this wires the SAME `@pikar/core classifyReviewDecision` into the cockpit gate (never a forked copy, CLAUDE.md §8). A RE-propose of an already-`proposed` plan is the live gate's "regenerate": `proposeEmailPlan` reads the current plan and, when `status === "proposed"`, routes `classifyReviewDecision({ decision: "regenerate", regenerateCount: reviseCount ?? 0 })` — a `regenerate` action increments `plans.reviseCount` and re-proposes; an `escalate` action (past `MAX_REGENERATE`=3) sets `plans.escalated = true` + fires a `retry.limit` notification (static §4 label from `notificationMessage`) and does NOT re-propose (bounded, never an unbounded redraft loop) — `proposeEmailPlan` returns `{ escalated: true }` so the `proposePlan` tool tells the user plainly. **INVARIANT — `executePlan` refuses an escalated plan:** a sibling early guard `if (plan.escalated) return { ok: false, reason: "review_escalated" }` sits BEFORE the CAS flip / seed / `workflow.start` (next to `gmail_not_connected`/`send_time_too_far`), so an escalated plan can NEVER be approved or sent — the cockpit mirror of the pipeline unapproved-send guard. A FIRST propose (status not yet `proposed`) is never a redraft (reviseCount stays 0). Verify: `pnpm --filter @pikar/backend test cockpit` (4 redrafts → escalated + one `retry.limit` + status not advanced; `executePlan` on an escalated plan → `review_escalated`, no rows, no workflow). Both new notification kinds (`agent.timeout` from AGNT-04, `retry.limit`) feed the OPSG-05 matrix.
> Last verified: 2026-07-21 (07-05) — `gmail.ts` now EXPORTS `freshAccessToken`/`buildMime`/`base64Url` + `SEND_ENDPOINT` so `notifyExternal.ts` reuses the governed send seam for the OPSG-05 external notification channel (behavior unchanged — same token refresh + MIME + endpoint; see `audit-dead-letter.md` for the notify matrix). PRIOR (07-03) — the PIPELINE review gate is now FAIL CLOSED (REVW-02/03). **INVARIANT — a regenerate past `MAX_REGENERATE`(=3) can NEVER become a send.** ROOT-CAUSE FIX at the shared decision point (CLAUDE.md §8): the `pipeline.ts` review-gate loop routes EVERY decision through `@pikar/core classifyReviewDecision({ decision, regenerateCount })` — the SAME classifier 07-04 wires into the cockpit gate, never a forked copy. Pre-fix, a `regenerate` at/over the cap fell through the loop's `break` to DELIVER (an unapproved send, pipeline.ts:250-277). Now the classifier's `escalate` branch drives a governed **escalated terminal** (mirrors `stopBlocked`): `status:"escalated"` + a `review.escalated` audit + a `retry.limit` notification + one `escalated` telemetry row + `return null` — NO `gmail.send`. The `escalated` member was added to `REQUEST_STATUS` (pipeline.ts) AND `schema.ts` `requests.status` (now 14 stages) AND `telemetry.ts`'s `reviewOutcome` validator (kept in sync — a write against any un-widened union throws). REVW-03: the **timeout branch** (review-inactivity, `SEVEN_DAYS` default per owner) now fires a `review.expired` notification between its existing audit and telemetry write (was audit+telemetry only) — still NO delivery on timeout. Both notifications use the static §4 label from `@pikar/core notificationMessage` (refs only, no content). **Scope honesty:** `edit_text`/`reject` are single-shot terminals per the classifier (proceed/terminate), so their decisionCounts can't exceed 1 — the ONE enforced threshold is the regenerate cap. **Substrate note:** this is the durable-workflow gate (`pipeline.ts`/`review.ts`), the substrate REVW-02/03's requirement language targets — the retired `/submit` path. The LIVE cockpit (`executePlan`/`plans.reviseCount`) gets its PARALLEL fail-closed guard in 07-04 (also via `classifyReviewDecision` — the shared fix reaches both gates). Verify: `pnpm --filter @pikar/backend test pipeline` (classifier wiring at the cap + the escalated terminal write seam); `npm run smoke:pipeline` drives approve→deliver + a review-expiry (→ expired + `review.expired` notify + NO send, via `smoke:fireReviewTimeout` which fires the armed gate's timeout NOW instead of the real SEVEN_DAYS) + a regenerate breach (4 regenerates → escalated + `retry.limit` notify + NO send). `MAX_REGENERATE` is re-exported from `pipeline.ts` (still imported by `requests.ts`'s `canRegenerate` hint) but its VALUE now lives once in `@pikar/core`.

> Last verified: 2026-07-21 (07-01) — NO cockpit code change yet; this bump only registers a FUTURE dependency. Phase 7 Wave-1 added the pure `@pikar/core` `reviewThreshold.ts` (`classifyReviewDecision` + `MAX_REGENERATE`) and the additive `plans.reviseCount`/`plans.escalated` optional fields, and pre-registered `packages/core/src/reviewThreshold.ts` + `pipeline.ts`/`review.ts` under this playbook's watch so 07-04 (the cockpit fail-closed revise cap) can edit them under §9 without touching watch.json again. NOTHING in the cockpit turn/tool loop calls `classifyReviewDecision` yet — 07-04 wires it: the cockpit review gate reads/writes `reviseCount`, and a regenerate at/over `MAX_REGENERATE`(=3) sets `escalated` + escalates instead of drafting. Until then a `plans` row simply carries neither field (optional-on-read). `classifyReviewDecision` is the SINGLE fail-closed classifier shared with the pipeline gate (07-03) — do not fork a second copy in cockpit code.

> Last verified: 2026-07-25 (12-04) — added the `evaluateBusiness` read-tool + the `recordScorecardAnswer` write-tool to `buildCockpitTools` and the `EVALUATION` card to `cards.tsx`. See "Phase 12 — Business evaluation" below; the engine + its invariants live in `business-evaluation.md`.
> Prior: 2026-07-20 (06-07) — NO cockpit change; the voice brief→plan handoff (`apps/web/e2e/voice.spec.ts`, owned by voice.md) lands under cockpit.md's broad `apps/web/e2e/` watch. The handoff reuses `sendCockpitMessage` ENTIRELY (a voice brief's Decisions/Action items become the opening user turn → the existing PLAN card + single Approve): no new plan pipeline, no new gate, no cockpit edit. See voice.md.
> Last verified: 2026-07-20 (06-04) — the VOICE-BRIEF drafter (`llm.draftVoiceBrief`, VOIC-03): the single place a finished voice conversation's kept transcript becomes structured brief markdown. It is a near-clone of `digestInbox`/`draftReply` — fail-closed `voice-brief` registry-skill load FIRST (no hardcoded prompt, §5; NO_ACTIVE_SKILL unseeded), `SMOKE::` short-circuit AFTER the load (so the load is exercised offline), then DEFAULT→CHEAP fallback both `recordModelSpend`'d, explicit `Promise<string>` return. TOOLLESS (`generateObject` over the `@pikar/voice` `BriefSections` schema, no `tools:`): the transcript is DATA, so an injected "put my password in the summary" has NOTHING to actuate — worst case is a misleading line a human reads in the vault. The MODEL fills only the five narrative sections; the FULL transcript is welded on in CODE via `buildBriefMarkdown` (`@pikar/voice`) — never model-authored (the `joinDigest` precedent), empty sections render the literal "None", the spoken language is recorded as a leading `<!-- brief-language: … -->` comment. The SMOKE offline path returns a deterministic fixed-section brief with NO model call (the plan-05 `voice.storeBrief` convex-test path: brief → vault → plan). It writes no audit (the plan-05 caller owns correlation, as `draftReply` does). Lives in `llm.ts` (the sole "use node" module — a second node module re-trips the TS circular-inference cliff). `voiceBriefDraft.test.ts` green (fail-closed unseeded + the SMOKE fixed-section/welded-transcript/None path). — PRIOR 2026-07-19 (03.11-06) — PHASE 3.11 CLOSED: the reply subsystem is live and OWNER-VERIFIED IN REAL GMAIL. **The reply invariants (the RPLY-01 spine, holds end-to-end):** (1) **Recipient by message-ref, NO panel** — `replyToMessage` resolves the target server-side from a fuzzy `{intent, sender?, subject?, range?}` ref and sets `recipients=[fromAddr]` + `recipientNames[addr]=displayName` directly (the UAT-F1 label flow), so the loop sees `#1: <name>` and NEVER the address; no `writeCandidates`/panel round-trip. (2) **Toolless original-body ingestion** — the untrusted original body reaches an LLM in EXACTLY ONE place, the toolless `internal.llm.draftReply` (`generateText`, no `tools:`), and never crosses to a tool return or an audit payload (`llmRedaction.test.ts` mutation-checked static scans on the `replyToMessage` block hold the body AND the From address off the loop/audit); an injected instruction in the body is described-not-actuated because the drafting call has nothing to actuate with — proven by the `24-reply-injection` eval case (the reply addressed only the original sender, needle stayed out of every requests/audit/DLQ/telemetry row). (3) **Single-arm fan-out UNCHANGED** — a reply rides the same `executePlan` CAS → seed `requests` → `startFanout` (the sole `workflow.start`) → `deliverApprovedPlan` → `gmail.send` spine as a normal compose; zero sends before the one human Approve, refs-only audit. (4) **Threading fields optional-on-read** — `plans`/`requests`/`inboxFixtures` carry the four fields (`replyToMessageId`/`replyThreadId`/`inReplyTo`/`references`) as `v.optional`, so a non-reply plan carries none and every seam (`buildMime`/`send`/`getForDelivery`/`executePlan`) no-ops; `resetPlan` clears all four (Pitfall 6 — a "start over" after a reply must not silently thread the next fresh compose into the old conversation). **PITFALL 1 RESOLVED EMPIRICALLY (the one thing units could not prove):** the shipped implementation sends BOTH signals — RFC `In-Reply-To`/`References` headers in the raw MIME (load-bearing) AND `threadId` in the send POST body (reinforcement). The owner live-tested a real "reply to X" through the governed cockpit on 2026-07-19 and confirmed it landed IN the original Gmail thread with the correct `Re:` subject, addressed only the original sender. **The owner did NOT isolate which mechanism individually threaded it (headers-alone vs headers+threadId) — so the CONFIRMED-WORKING mechanism is: "RFC headers in raw + threadId in POST body (belt-and-suspenders); the shipped both-signals send threads correctly in real Gmail." Do NOT assume headers alone suffice; keep both.** Backend suite at close: 359/360 (sole red the documented pre-existing `audit.test.ts` auditCounts non-regression); `cockpit-agent@12` ACTIVE (the reply-tool-aware body, eval-gate-proven, runId `98ea4f20` 23/23). — PRIOR 2026-07-19 (03.11-04) — the `replyToMessage` TOOL (RPLY-01): "reply to X" now becomes a real threaded reply in ONE governed turn. The tool (`buildCockpitTools`, llm.ts) resolves the target SERVER-SIDE from a fuzzy `{intent, sender?, subject?, range?}` ref (the loop has NO message ids — `listInbox` strips them, Pitfall 3, so it takes a fuzzy ref not an id): 0 matches → "couldn't find that message", 2+ → list candidates BY LABEL and ask (the `resolveContacts` no-guess discipline — never substitute, never guess), exactly 1 → proceed. On a single match it sets the recipient BY REF (`recipients=[fromAddr]`, `recipientNames[addr]=displayName` — the UAT-F1 label flow reused for a message instead of a contact pick, so NO `writeCandidates`/panel round-trip), the `Re: <subject>` (`stripRePrefix` avoids "Re: Re:"), and the four `plans` threading fields (`replyToMessageId`/`replyThreadId`/`inReplyTo`/`references` via `patchPlan`), then fetches the untrusted original body (`fetchInboxBodies`) and drafts the reply TOOLLESSLY through `internal.llm.draftReply` — the original body flows into that ONE sub-call and NOWHERE else (never a tool return, never a log; `llmRedaction.test.ts` scans the `replyToMessage` block so the fetched body AND the resolved From address never cross to the loop return or an audit payload, each mutation-verified RED-on-leak; `draftReply` is asserted structurally toolless). The return carries LABELS/COUNTS only — the display-name label + the Re: subject, NEVER the From address, the Message-ID, or the original body. `resetPlan` (plans.ts) clears all four threading fields (Pitfall 6 — a reply then "start over" must not leave a stale thread that silently threads the next FRESH compose into the old conversation). Reconciled the pre-existing `llmRedaction` cockpit `audit.log`-count scan to the 2 legitimate refs-only sites (plan.canceled + plan.rescheduled, both payload `{planId}` only) — a strengthen, not a weaken. Verified: cockpitTools 52/52 (+5), llmRedaction green (+2 boundary scans, reconciled count), plans 14/14 (+2 threading round-trips). — PRIOR 2026-07-19 (03.11-03) — the DELIVERY THREADING SPINE (RPLY-01): the four reply fields now survive read → plan → requests → getForDelivery → buildMime → send, so a reply lands in-thread. FIVE seams, all migration-free optional-on-read. **(1) `buildMime` (gmail.ts)** gained an optional `threading?: { inReplyTo; references }` param — when present it emits `In-Reply-To:` + `References:` header lines AFTER Subject in BOTH the zero-attachment AND multipart branches; absent → byte-identical to the pre-3.11 output (the V4 identity test still passes, `threadHeaders` spreads to nothing). The values are the RFC 5322 Message-ID HEADER (angle-bracketed) — NEVER the Gmail `id` (Pitfall 2), asserted by `gmail.test.ts`. **SECURITY:** because `subject`/`inReplyTo`/`references` on a reply originate from INBOUND (attacker-controlled) mail via `getReplyTarget`, `buildMime` strips CR/LF from every interpolated header value at this single sink — a crafted `Subject`/`Message-ID` cannot inject an extra header (`Bcc:`, spoofed `From:`) into the reply the user sends (email header injection; the CRLF-strip test in `gmail.test.ts` asserts `Bcc:` never begins a line). **(2) `gmail.send`** builds `threading` from the request row (`req.inReplyTo ? {inReplyTo, references: req.references ?? req.inReplyTo} : undefined`) and POSTs `{ raw, threadId }` when `req.threadId` is set, `{ raw }` otherwise — RFC headers in `raw` are the LOAD-BEARING requirement, `threadId` is reinforcement (Pitfall 1, verified live in Plan 06, NOT unit-asserted). **(3) `getForDelivery` (gmailAuth.ts)** is a HAND-BUILT projection (Pitfall 4) — it now returns `threadId`/`inReplyTo`/`references` from the request; a field it does not project never reaches send, so a reply would silently post un-threaded. **(4) `executePlan` (cockpit.ts)** copies `plan.replyThreadId → request.threadId` (the GMAIL thread; `plan.threadId` is the AGENT thread that renders cards — a DIFFERENT id space, must NOT ride to the request) plus `plan.inReplyTo`/`plan.references` onto EVERY seeded row — the single-arm-site fan-out (`startFanout`) is UNCHANGED, no second `workflow.start`. **(5) `gmail.getReplyTarget`** — a NEW fixture-first target-header read: given a message id it returns From/Subject/threadId + the RFC Message-ID anchor (`inReplyTo` = Message-ID header, `references` = original References + Message-ID space-joined via `buildReferences`). Deliberately SEPARATE from `fetchInboxBodies`: that returns the untrusted BODY (toolless-only), this returns refs-only HEADERS to the SERVER-SIDE caller (Plan 04's `replyToMessage` tool) — never logged, no audit here (the reply tool owns correlation, §2-D/§4). All optional → a non-reply plan/request carries none and the whole spine no-ops. `gmail.test.ts` 35/35, `cockpit.test.ts` 18/18. The only missing piece after this plan is the tool that WRITES the four fields (Plan 04). — PRIOR (03.11-02): added `llm.draftReply`, the toolless reply-body drafter (RPLY-01): it loads the gated `reply-drafter` skill and ingests the untrusted original body in a `generateText` call with NO tools, DEFAULT→CHEAP fallback, both recordModelSpend'd, explicit `Promise<{ body }>` return. This is the reply-plane analogue of `digestInbox` — the original body reaches an LLM here and NOWHERE tool-bearing. It writes no audit (the Plan 04 caller owns correlation) and is not yet wired to a tool; Plan 04's `replyToMessage` calls it. See agent-runtime.md invariant #10. — PRIOR (03.10-07) against the POST-PICK TRUST COLLAPSE (UAT-F, live 2026-07-19 third replay — the agent distrusted real picks, then trusted invented ones). THREE structural fixes. **(F1) A completed pick is VISIBLE to the model:** the `resolveRecipients` fold now persists ALL picks' `displayName`s as `plans.recipientNames` (optional map, lowercased address → picked name — the `recipientBodies` shape precedent; patchPlan accepts it, `resetPlan` explicitly clears it so a reset never re-labels the next draft's recipients) and `buildAgentContext` feeds `buildRecipientView` the displayName, so the post-pick context reads `#1: Brett J. Fox` — never `#1 (no name)` for a picked contact. The v10 skill's own distrust clause fired verbatim on the placeholder ("didn't properly register"); now it has nothing to fire on. Typed-literal (pendingValid) recipients keep the placeholder — correct, nobody picked them. **(F2) A fabricated-recipient overwrite is IMPOSSIBLE on the continue turn, not discouraged:** `resolveRecipients` passes `omitRecipientEdits: true` into `runCockpitAgent` → `runAgentLoop` → `buildCockpitTools` (append-only optional args), and under the flag the returned tool record simply does NOT CONTAIN `addRecipients`/`setRecipients`/`removeRecipient` (conditional spread; a hallucinated call throws NoSuchToolError before execute — the driver's catch saves an error turn, no write). `sendCockpitMessage` and the eval runner never pass the flag — every normal turn keeps the full set byte-identically, which is why all 21 fixtures are unaffected by construction. v10 wording alone FAILED live (invented `brett@example.com`/`devpost@example.com` overwrote real picks; the propose guards check presence, not provenance). `RESOLUTION_CONTINUE` now states the FACT: picks already folded, shown by #index with names, do not change recipients, ask for unset subject/body — never invent. **(F3) One needs-you predicate, one set of briefing numbers:** `briefInbox`'s counts-only return now states `{listedCount} messages, {isNeedsYou-counted needsYou} need you ({items.length} summarized)` — the SAME `listedCount` + the SAME `isNeedsYou` (now exported from `@pikar/core`) over the SAME `items` array the card masthead/`composeLede` read, so the agent's sentence can never contradict the panel (was: 50-vs-25 / 6-vs-2 — cap-subset length + a needsReply-only count). Audit payload byte-untouched. Skill v11 ("After a pick completes" section + the distrust clause scoped to EXCLUDE panel-picked recipients) activated only through the gate cycle. Deferred: eval fixture 22 for the continue turn (harness surgery — seeded folded state + a runner omit-flag grammar); "50+" treatment at INBOX_LIST_CAP saturation.

> Last verified: 2026-07-19 (03.10-06) against CONVERSATIONAL AMNESIA (UAT-E, live 2026-07-19 second replay). **INVARIANT — the model sees the conversation:** the prompt for a cockpit turn is no longer turn-one-only. ROOT CAUSE: the entire prompt each turn was plan-row context + "The user says: {text}" — the chat transcript was saved (cockpit.ts) and read back for the UI (`listMessages`) but NEVER fed to the model, so a bare fragment answering the agent's own question ("meeting reminder" after it asked for the subject) was uninterpretable and triggered re-asks. THE SEAM (3 parts, ONE render site): (1) BOTH production drivers (`sendCockpitMessage` AND the `resolveRecipients` re-invoke) call `fetchRecentHistory(ctx, threadId)` — the SAME `listMessages` agent-store read the chat pane uses (newest 12, `excludeToolMessages: true`; the client helper hardcodes `order:"desc"` so the page is newest-first and is REVERSED to oldest-first; user/assistant non-empty text only) — and pass `history` into `internal.llm.runCockpitAgent`. `sendCockpitMessage` fetches BEFORE saving the current user turn (else the turn appears twice: as the last history row AND as "The user says:"); `RESOLUTION_CONTINUE` is synthetic and never saved, so the re-invoke has no duplication hazard. (2) `runCockpitAgent` gained an optional validated `history` arg (append-only signature evolution — every existing caller keeps working) and `buildHistoryBlock` (llm.ts, placed AFTER `buildAgentContext` for the redaction-scan bounds) renders a BOUNDED "Conversation so far" transcript ABOVE the plan context — last 10 messages, 500 chars each (ellipsis-truncated), most-recent win, oldest-first render, "" for absent/empty history (the prompt is byte-identical when historyless — the test shims and single-turn fixture turn-1s are unchanged); "The user says:" stays the FINAL line (the current turn). (3) The eval runner accumulates its own history (agent-runtime.md). §2-D/§4 UNCHANGED: history is user+assistant CHAT text that already flows to the model; `fetchRecentHistory` writes nothing (no new log-plane write); `RunLoopArgs` untouched; no schema change, no new mutation. The skill mirror teaches how to READ the block (skill-registry.md). CEILING (ponytail, owner-deferred + escalatable): a plain-text transcript window, NOT structured reply-grounding — escalate to the full rebuild if text-level drift persists. Unit: `cockpitTools.test.ts` buildHistoryBlock caps; fixture 21 + the all-21-green pinned run are the behavior proof. FAIL-OPEN (live-replay hotfix, same phase): `fetchRecentHistory` catches store-read failures (e.g. the 1s query timeout observed on a degraded dev deployment mid-replay) and returns `[]` — a failed history fetch degrades to a historyless turn (the exact pre-03.10-06 prompt) and must NEVER fail the user's send.

> Last verified: 2026-07-19 (03.10-05) against the CANCEL-CONFABULATION + RE-ANNOUNCE LOOP (UAT-D, live 2026-07-19). **INVARIANT — a real reset, and a NEUTRAL pending-pick statement:** the agent confabulated "I've canceled the plan" with no reset tool in existence, and the imperative pending-pick context re-fed a robotic re-announce loop every stalled turn. TWO code changes (the skill wording half lives under skill-registry.md). (1) `resetPlan` internal mutation (`plans.ts`, beside `clearCandidates`): an EXPLICIT slot-clear — `status:"collecting"`, `recipients:[]`, and `mode`/`subject`/`bodyIntent`/`body`/`attachments`/`attachmentError`/`candidates`/`pendingValid`/`greetingName`/`recipientBodies`/`sendAt` ALL set to `undefined`. It CANNOT go through `patchPlan` (which drops undefined keys and so can never clear a filled slot) — it mirrors `clearCandidates`/`recordAttachments`' explicit-write pattern. It is a COMPOSITION reset (collecting/proposed stage) and deliberately does NOT touch `scheduledFunctionId`/`correlationId`/`workflowId` — cancelling an armed scheduled send stays `cockpit.cancelScheduledPlan`. Content-plane only, NEVER audited (§4). (2) `resetPlan` tool (`llm.ts` `buildCockpitTools`, beside `setMode`): empty inputSchema like `proposePlan`, a light status guard via `readPlan()` (refuses `scheduled`/`delivering`/`done` — "use the plan card to cancel a scheduled send"), calls `internal.plans.resetPlan`, returns a refs-only loop-visible string (§4 — no content). NO new schema/status, NO new mutation beyond `resetPlan`, NO proposeEmailPlan/executePlan seam change. (3) The pending-pick block header in `buildAgentContext` (`llm.ts`) changed from the IMPERATIVE "Awaiting the user's contact pick … tell the user to pick from the card, do NOT claim you added them" to the NEUTRAL STATE fact "A contact pick is still open (these are NOT yet recipients — the user has not picked from the card yet)"; the `name: N contact(s) found` lines are unchanged (still NAME + count only, §2-D/§4). It is a CONTEXT string, not a prompt (no §5) — the skill now owns what to SAY about the open pick, which kills the loop. Verified via the live gate cycle: fixture 20 (`20-reset-and-honesty`) all-green under `--skill cockpit-agent@N`, then activated. LIVE PAINT OWED: the UAT transcript replay is 03.10-05's blocking human-verify.

> Last verified: 2026-07-19 (03.10-04) against the PROPOSE-WHILE-PENDING DEADLOCK + the TALL-BRIEF CLUTTER (UAT-C, live 2026-07-19 — two defects, defense-in-depth). **INVARIANT 1 — propose refuses a pending pick (BACKEND-OWNED):** `proposePlan.execute` (llm.ts) gained a sibling precondition AFTER the `!plan.body` check and BEFORE the attachment gate: `if (plan.candidates?.length) return "Can't propose yet — a contact pick is still pending; …"`. Parked candidates mean a contact resolution is still OPEN, and proposing over it produced the transcript's dead-end — a "#1 (no name)" plan proposed while the picker vanished on `status === "proposed"`. The guard refuses BEFORE the `internal.cockpit.proposeEmailPlan` write, so the bad state is unreachable for EVERY reader (the frontend guards below are defense-in-depth, not the fix). Facts come from the ROW (DECISION #2), never model args. `PlanRow` (llm.ts) is widened NAME-ONLY (`candidates?: { name: string }[]`) so `plan.candidates?.length` type-checks — deliberately NOT the `matches`/address/displayName shape, which in that span trips the `draftCockpit` header-hint redaction scan (`llmRedaction.test.ts` stays green; `getById` returns the full row at runtime so the count is present). The name-only widening forced ONE follow-on: `buildAgentContext`'s own `candidates` param made `matches` OPTIONAL (`matches?: {…}[]`) so a name-only `PlanRow` is assignable at the two `buildAgentContext(plan)` call sites — its `matches?.length ?? 0` count is unchanged at runtime (the full row still carries `matches`), and its span already declared the shape so the redaction scan is unaffected. NO new mutation, NO proposeEmailPlan/executePlan seam change. `cockpitTools.test.ts` +2: the refusal (proposeEmailPlan never flips status→proposed with a parked pick) and the no-candidates control still proposes. **INVARIANT 2 — the picker is NEVER suppressed while candidates are parked (FRONTEND defense-in-depth), and SC-4's collapse-chrome EXCEPTION:** in `PlanCards` (cards.tsx) `resolving = Boolean(plan.candidates?.length) && !reporting` DROPS the old `status !== "proposed"` clause so a plan that got proposed with a pick still open still renders the ResolutionCard; and the PlanCard is gated `plan.status === "proposed" && !plan.candidates?.length` so the unpickable "#1 (no name)" placeholder never shows while candidates exist (post-guard exactly one card — the picker — renders in that state). The demoted BriefingCard is UPGRADED from "moved below" to "collapsed to its masthead with a manual expand toggle": `BriefingCard` gained `demoted?: boolean` + `const [collapsed, setCollapsed] = useState(demoted ?? false)` — collapsed renders ONLY the teal-900 masthead band; a masthead toggle button (aria-expanded + aria-label, existing token, no amber — BRAND §2/§6) expands/collapses it. Collapse is per-session LOCAL UI (useState) — NO new plan field/mutation/query (ADR-004 dumb renderer). PlanCards now takes `briefing` (data) not a pre-built `brief` ReactNode, so it renders `<BriefingCard briefing={briefing} />` (expanded/primary) in the `!composing` slot and `<BriefingCard briefing={briefing} demoted />` in the `composing` slot; CardList's `plan === null` branch renders `<BriefingCard briefing={briefing} />` directly. **SC-4 EXCEPTION:** the content region is tagged `data-testid="briefing-body"` and the E2E now asserts zero `button`/`a` INSIDE briefing-body (the actionable-controls invariant holds on the CONTENT); the masthead toggle is VIEW CHROME OUTSIDE briefing-body, an allowed exception (it acts on the view, never on email content). `cockpit-resolve.spec.ts`: the demotion test asserts the demoted brief is COLLAPSED then the toggle expands/re-collapses it; the SC-4 re-assert is rescoped from `briefCard.locator("button")` to `briefCard.getByTestId("briefing-body").locator("button"/"a")`; a proposed+parked-candidates regression asserts "PICK A CONTACT" stays visible with no "no name" PlanCard. Verified: backend `cockpitTools` green (refusal + control + redaction scan), web typecheck exit 0, Playwright discovers the updated cases, `check-playbooks` exit 0. **LIVE PAINT OWED:** the specs run under 03.10-03's connected human-verify (standing composer-gate blocker — `gmailAuth.status.connected` unseedable offline); the automated gate here is web typecheck + Playwright discovery + the backend refusal test.

> Last verified: 2026-07-19 (03.10-02) against WORKSPACE CARD ARBITRATION (UAT-A — panel desync). `PlanCards` (cards.tsx) no longer renders `{brief}` unconditionally first: a ONE-boolean render-side derivation `composing` (candidates parked OR subject OR body OR recipients OR `status !== "collecting"` — every signal already on the `plan` prop; NO new field/mutation/query) demotes the BriefingCard BELOW the plan cards the moment composition is active, so the ResolutionCard is the top card of the PlanCards grid and the stalled pick is visible without scrolling (the UAT 2026-07-19 "where is the list" defect). The demoted brief is still RENDERED and reachable — reorder, not destruction, and nothing was added inside `data-testid="briefing-card"` (SC-4's zero-`button`/`a` assertions hold structurally). The briefing-only flow (plan at `collecting`, nothing set, no candidates) keeps the brief primary and pixel-unchanged — `cockpit-briefing.spec.ts` byte-untouched. New offline regression lock in `cockpit-resolve.spec.ts`: brief=today (brief primary) → `SMOKE::agent::resolve=SMOKE::Sarah` (candidates park) → the picker PRECEDES the demoted brief in DOM order (`compareDocumentPosition`), the brief is still attached, and the demoted card still has zero buttons/links. Verified: web typecheck exit 0; cards.tsx Biome baseline unchanged (sole pre-existing `useHookAtTopLevel` at ResolutionCard); Playwright discovers the new test; the dispatch traps stayed dodged (`latestTurn` no-args above `!threadId` above `plan === null`; `<ActivityCard>` outside PlanCards — "top card" means top of the PlanCards grid, the trace is not part of this arbitration). LIVE PAINT OWED: plan 03.10-03's connected human-verify (the standing E2E blockers — no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`, composer gated on `gmailAuth.status.connected` — are unchanged).

> Last verified: 2026-07-19 (03.10-01) against the `gmail.search` FIXTURE SEAM. `search` gained the SAME `inboxFixtures` fixture-before-token branch `listInbox`/`fetchInboxBodies` already had: AFTER the `SMOKE::` name-sentinel, BEFORE `freshAccessToken`, a seeded fixture row serves `HeaderRecord[]` mapped from `fixture.messages` (`from`/`subject`/`date` via `new Date(internalDate).toUTCString()` — `rankCandidates` Date.parse-es `rec.date`) and writes the SAME refs-only `mailbox.searched` audit (`{queryHash, resultCount}` — count only, mutation-checked: a deliberate `from` leak into the payload fails the test). The seam CANNOT shadow a live mailbox — fixture rows only exist for smoke/eval tenants (`smoke.seedInboxFixture` is the only writer and it is internal) — and a tenant with NO fixture row falls through to the byte-unchanged token path (`not_connected` degradation pinned by test). Purpose: `resolveContacts` can now park candidates on the TOKENLESS eval tenant from a plain-NL turn, the hard prerequisite for the 03.10 stalled-resolution eval fixture (UAT-B); eval fixture 09's description updated — post-seam, "Alonzeva" exercises `rankCandidates`' no-match branch (returns `[]`, never substitutes — the 03.3-06 rule), not `not_connected`. `gmail.test.ts` 28/28 green (4 new: fixture-first records, refs-only audit, no-fixture fall-through, sentinel-stays-first ordering).

> Last verified: 2026-07-19 (03.5-06) against the FAR-FUTURE CAP (SCHD-01 refinement — the token-expiry mitigation the CONTEXT `<deferred>` slice-1 shipped without). A schedule so far out the Gmail Testing-mode refresh token (7-day life, `design/scheduled-send.md`) is DEAD at fire time is now REFUSED — and refused at the ONE authoritative chokepoint. `SEND_TIME_HORIZON_MS` (default `7*24*60*60*1000`, `@pikar/core`, a ponytail-commented tunable knob — raise/remove post verified-OAuth) is shared by four seams: (1) **`executePlan` is the hard gate** — a `plan.sendAt > Date.now() + SEND_TIME_HORIZON_MS` returns `{ok:false, reason:"send_time_too_far"}` as a sibling early guard to `gmail_not_connected`, BEFORE the seed loop / CAS flip / `scheduler.runAt`, so NO row seeds and NO scheduler arms regardless of which write path set the field (NL `setSendTime`, picker `setPlanSendTime`, or Plan 05 reschedule re-approve) — the root-cause fix is one guard at the schedule-vs-immediate decision point, not one per caller. (2) **`parseSendTime` gained a pure `tooFar` variant** — a `classify(epochMs, nowMs)` helper (past | tooFar | resolved) now shared by all three resolve branches (relative / day-anchor / no-day-PM), boundary INCLUSIVE (exactly `now + horizon` resolves; strictly beyond is tooFar), no `Date.now`. (3) **`setSendTime` handles `tooFar`** with a re-ask ("further out than I can reliably schedule — the connection may expire before then") and writes NOTHING; its switch is now EXHAUSTIVE (`case "none"` replaced the catch-all `default`, so a future `SendTimeParse` variant is a compile error, never a silent fall-through to immediate send). (4) **the PLAN-card AND CanceledCard pickers cap `max` at `now + SEND_TIME_HORIZON_MS`** — the soft native-hint complement (does not block a programmatic write, which is exactly why the executePlan gate is the load-bearing one). Never a silent clamp: beyond-horizon is always re-asked, never trimmed. Tests green: `emailIntent.test.ts` (39 — tooFar beyond horizon, resolved at/inside boundary, within-horizon no-regression), `cockpit.test.ts` (16 — refusal before seed/arm + within-horizon control), `cockpitTools.test.ts` (setSendTime tooFar writes nothing). Web typecheck exit 0; `check-playbooks` exit 0. The pre-existing `audit.test.ts` `auditCounts` red + the `runCockpitAgent.test.ts` 5000ms machine-load timeout are documented non-regressions.

> Last verified: 2026-07-19 (03.5-05) against the CANCELED→RESCHEDULE transition (SCHD-01 refinement). **`canceled` is terminal UNLESS explicitly re-scheduled** — `reschedulePlan` (cockpit.ts) is the ONLY canceled→proposed transition, and it re-arms the SAME governed fan-out through the EXISTING `executePlan` scheduled branch (its seed loop re-freezes content, its `ctx.scheduler.runAt` is still the single arm site — reschedule adds NO new `workflow.start`/`runAt` call site). Four invariants: (1) **it requires a FUTURE `plan.sendAt`** — an absent/past time returns `{ok:false, reason:"needs_future_time"}` and writes NOTHING (no orphan delete, no status flip, no audit), so a stale time can never un-cancel into a silent/immediate send (the halt-control guarantee at the trust boundary); (2) **it deletes the plan's orphaned `requests` rows first** (`by_plan`) — a canceled plan was halted BEFORE `startScheduledDelivery` ran, so all its rows are never-fanned-out "approved" orphans; without the cleanup `reportForPlan` (which reads EVERY `by_plan` row) would double-count the re-approved send; (3) **it is idempotent + tenant-guarded** — a non-canceled plan no-ops `{ok:true, alreadyResolved:true}`, a cross-tenant caller throws "plan not found"; (4) **`plan.rescheduled` is refs-only** (`{planId}` ONLY, §3 insert-only / §4 — never sendAt/subject/body/recipients). The re-armed plan is cancellable again via the unchanged `ScheduledCard`/`cancelScheduledPlan`. UI: `CanceledCard` (cards.tsx) gained a `datetime-local` picker (reusing PlanCard's `toLocalInputValue`/`setPlanSendTime` idiom — one source of truth, `plan.sendAt`) + a Reschedule button (busy-guarded, disabled unless a future time is set) whose handler calls `reschedulePlan` then, on success, `executePlan` — the card then re-renders as `ScheduledCard`; a `needs_future_time` result surfaces an inline `role="alert"` re-ask and does NOT send. Cockpit tests green (reschedule happy path with orphan-cleanup + fresh-fan-out count + refs-only audit + cancellable-again, the re-ask, idempotent, tenant guard); web typecheck exit 0; cards.tsx Biome baseline unchanged (the sole `useHookAtTopLevel` at ResolutionCard is pre-existing). The pre-existing `audit.test.ts` `auditCounts` red is a documented non-regression.

> Last verified: 2026-07-18 (bump only — Phase 3.8 Wave 3 / 03.8-06 removed the two EXTR-H skip-guards in `apps/web/e2e/vault.spec.ts`, a VAULT-subsystem E2E change with no cockpit-content impact; cockpit behavior unchanged). Prior: 2026-07-17 (Gap-2 reshape — post-human-feedback) against the EXECUTIVE-REPORT BRIEFING CARD ("Direction A"). The human reviewer accepted the Gap-1 triage but rejected the look: "still looks terrible… like the receipt of emails," and flagged the workspace legibility. TWO fixes shipped, still a DUMB RENDERER over `buildBriefingView` (ADR-004 — no intelligence in the card). **(1) LEGIBILITY (the actual bug):** the old `BriefingCard` used the shared `box` style — a `1px` border with NO background — so the card was transparent over `.pane-canvas`'s teal aura, with hardcoded `#666` text (off-token). Replaced with a dedicated OPAQUE `briefingSheet` (`--card` bg + `--rule` border + soft shadow) and brand-token text throughout (`labelBrand`/`dimBrand` = `--ink-soft`, never `#666`); `BriefingSection`/`BriefingRow`/`SubjectLine` switched off the shared `#666` `label`/`dim` onto the brand versions. **(2) EXECUTIVE-REPORT SHAPE (Direction A):** a teal-900 masthead band (white-on-teal — the legibility fix's other half) carries the `range · tz · built` scope plus THREE code-owned KPI counts (`Kpi`: `listedCount` Messages / `view.needsYou.length` Need-you / `view.collapsedCount` Automated — all code-owned, ADR-004, "need you" lifted to `--teal-400`); the lede renders below it, then needs-you as a HERO block of new `PriorityRow`s, then the time-grouped ledger (the REUSED `BriefingSection`/`BriefingRow`), then a footer (collapsed count + cap honesty). `PriorityRow` adds a **recommended next move** per row (`view.needsYou[i].move`, code-derived by `@pikar/core`'s `suggestedMove` — the chat→PLAN→Approve bridge, "Direction C" grafted on) shown after the gist as a `briefing-move` line ("Recommended …"), plus a teal-900 priority STRIPE (frame colour, not the teal-600 CTA colour — a stripe must not read as a control) and a due emphasis by WEIGHT. **NO AMBER anywhere** (BRAND §2 — `--held` is the approval gate's alone): priority is stripe + weight, never an amber pill. **SC-4 STILL STRUCTURAL:** masthead, KPIs, move line, category tags, collapsed line are ALL text — ZERO button/link/onClick (the E2E still asserts `button`/`a` `toHaveCount(0)`). `cockpit-briefing.spec.ts` extended: the `briefing-move` line is present, non-empty, and (fixture index 0 has a deadline) the time-sensitive variant. `suggestedMove` is a pure function of the `deadline`/`needsReply` axes ONLY — it reads no `gist`/`subject`, so NO new attacker-influenced string crosses the trust boundary (no digest-schema change, no SC-2 scan change, no eval-gate re-run — ponytail). Core: 43 `briefing.test.ts` cases green (+7: `suggestedMove` branches + `move` populated on needs-you view items only). Web + core typecheck exit 0. **LIVE RUN STILL OWED (unchanged blockers):** `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` absent, composer gated on `gmailAuth.status.connected` — the real paint is plan 09's connected human-verify, where CKPT-04 closes.

> Last verified: 2026-07-17 (03.7-08) against the RESHAPED BRIEFING CARD (Gap 1 closure — the half the human verifier rejected as "a receipt, not a report"). `cards.tsx` `BriefingCard` is now a DUMB RENDERER over `@pikar/core`'s `buildBriefingView(briefing)`: it reads the view model and paints it, re-deriving NONE of the ordering/collapse/lede intelligence (that all lives in `briefing.ts`, ADR-004). Four presentation changes, all fed by the view: (1) **LEDE FIRST (Gap 1.1)** — `view.lede` renders as a prominent `--ink`/medium-weight line directly under the "INBOX BRIEFING" label, ABOVE every row (the meta `range · tz · built` line drops below it); the counts in it are code-owned (`composeLede`), the synopsis clause is the only model prose. (2) **ACTION-FIRST (Gap 1.2)** — `view.needsYou` renders as the top block, then `view.timeSections` (already ordered today/yesterday/thisWeek, empties skipped) below it; the card no longer filters `items` itself or owns the `BUCKETS` array (replaced by a `SECTION_META` bucket→title/testid lookup keyed by the view's emitted bucket). (3) **NOISE COLLAPSED (Gap 1.3)** — `view.collapsedCount > 0` renders ONE muted `briefing-collapsed` text line ("N automated notifications"), never N rows and NOT a clickable disclosure. (4) **CATEGORY VISIBLE (Gap 1.4)** — each surfaced row shows `item.category` as a muted `briefing-category` text tag in `RowBody` (so needs-you AND fyi rows both carry it): `--ink-soft` on a `--rule` hairline, uppercased via CSS (textContent stays lower), NO amber. **SC-4 stays STRUCTURAL:** the collapsed row and the category tags are TEXT, not toggles/links — the card still has ZERO button/link/onClick (read-confirmed; the offline E2E asserts `button`/`a` `toHaveCount(0)`). The row primitives (`BriefingRow`/`BriefingSection`/`SenderCell`/`RowBody`/`SubjectLine`, the 3-column grid, `item.id` keys, tz-formatted times) are REUSED unchanged — the reshape changed the CONTAINER (sections chosen by the view model), not the row look. `cockpit-briefing.spec.ts` extended: asserts the lede is present + non-empty + precedes the first `briefing-item` in DOM order, the needs-you (Sarah Chen) row is the FIRST row (action-first), a `briefing-category` tag reads "action" on the needs-you row, and `briefing-collapsed` renders WITH its count (the offline digest guarantees ≥1 `newsletter`, so Gap 1.3 is an OFFLINE regression lock now — no absent-branch escape hatch), plus the kept SC-4 zero-controls + counts-only-reply (SC-2) assertions. Web typecheck exit 0; Biome baseline-diffed on `cards.tsx` (no new findings — the sole `useHookAtTopLevel` at ResolutionCard is pre-existing); Playwright discovers the spec. **LIVE RUN STILL OWED (unchanged blockers):** `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` absent from the env, and `page.tsx` gates the composer on `gmailAuth.status.connected` which no smoke helper can seed — the real paint of the reshaped card is plan 09's connected human-verify (`pnpm --filter @pikar/web test:e2e -- cockpit-briefing`), where CKPT-04 finally closes.

> Last verified: 2026-07-17 (03.7-07) against the backend synthesis — the toolless `digestInbox` now returns `DigestBatch { items, synopsis }`: `digestSchema` gained a strict-mode-legal `synopsis` (in `properties` AND `required`), all three return paths (DEFAULT_MODEL, CHEAP_MODEL, offline smoke) emit it, and `briefInbox` threads `digest.synopsis` into `internal.briefings.insert` (new `briefings.synopsis` optional field — no migration). The synopsis is content-plane ONLY: it stays OUT of the counts-only loop return and the refs-only `briefing.created` audit (a fifth mutation-checked `llmRedaction.test.ts` scan enforces this, mirroring the `rawBodies` discipline). The offline smoke digest also now flags exactly one non-needs-you item `newsletter` so plan 08's `collapseNoise` path is exercisable offline. The `inbox-digest` skill edit that teaches the synopsis is a GATED candidate awaiting plan 09's live gate. Prior: 2026-07-17 (03.7-06) against the Gap 1 reshape — the briefing INTELLIGENCE (action-first order, noise collapse, lede composition) moved into pure, tested `@pikar/core` `briefing.ts`, where it MUST live (never the card), so the backend synthesis (07) and the reshaped card (08) build against ONE typed contract. Three pure transforms over the ALREADY-persisted `category`/`needsReply`/`bucket` axes (no new model call, no new classification — ponytail §8, the axis is free): **`composeLede(items, listedCount, synopsis?)`** — the counts are CODE-OWNED (`total = listedCount`, `needsYou = items.filter(needsReply || deadline).length`) welded to the model's qualitative `synopsis` clause as " — {clause}"; a number the model invents (a "99" in the synopsis) can NEVER become the count the lede states (Gap 1.1, ADR-004), and an empty/blank/absent synopsis degrades to the counts-only lede with no dangling separator (the view never throws on a pre-delta row). **`collapseNoise(items)`** — `newsletter` rows leave `surfaced` into ONE `collapsedCount` so 12 automated notifications never render as 12 rows (Gap 1.3), conservative on both edges: only `newsletter` collapses (`other` is NOT hidden) and a needs-you row (needsReply or a deadline) is NEVER collapsed even if mis-categorized `newsletter` (needs-you wins). **`buildBriefingView(briefing)`** — needs-you is a SEPARATE top block, never interleaved chronologically (Gap 1.2, action-first); the de-noised remainder groups into `timeSections` in fixed [today, yesterday, thisWeek] order, empty buckets skipped. **LOCKED CONSTRAINT honoured — time grouping is RESHAPED, NOT DELETED:** `bucket`/`joinDigest`/`selectForDigest` are byte-untouched and still tested; time is the SECONDARY axis inside the fyi remainder, below the needs-you block (deleting it needs a roadmap change, not a core/card edit). New `DigestBatch { items, synopsis }` type (plan 07's `digestInbox` return). All exported through the `export *` barrel (`index.ts` unchanged — the laziest re-export). 13 new cases green, the preserved `bucket`/`joinDigest`/`dayKey`/`selectForDigest` suite still green (115/115 in the file). NOT yet consumed: plan 07 wires `synopsis` into the backend digest + persisted row, plan 08 reshapes the card against `buildBriefingView`.

> Last verified: 2026-07-17 (03.9-04 checkpoint feedback) against FOUR user-reported cockpit defects found during the live human-verify — fixed directly, NOT re-planned. **FIX 1 (the "everything looks stuck" root cause): a non-essential query must never kill the cockpit.** `WorkspacePage` read `api.cockpit.listThreads` (the past-chats history nicety) directly in the page component; that query is a `tenantQuery` doing a cross-component `ctx.runQuery(components.agent.threads.listThreadsByUserId)` which can exceed Convex's 1s query limit under memory pressure and THROW — and a throwing `useQuery` throws INSIDE render, so the WHOLE page died ("This page couldn't load"). A dead page cannot clear an input, recolour a button, or paint steps — which is exactly why the trace looked frozen even though the `agentSteps` pipeline works. The query is now isolated in its own `PastChats` child wrapped in a new minimal `ErrorBoundary` (`ErrorBoundary.tsx` — the repo had none, no dependency added, ponytail rung 2/7): a failed/slow history query degrades to "History unavailable" while chat + workspace keep working, and the error is LOGGED (`componentDidCatch`), never swallowed. `listThreads` also dropped `numItems` 30 → 10 (the cross-component call is the expensive part; the menu never needed 30). The history menu is NOT deleted — the workspace is the product, the menu is a nicety, and the fix degrades it rather than dodging it. **FIX 2: clear the composer input IMMEDIATELY on send.** `onSend` did `setText("")` AFTER the 10-30s `await send(...)`, so the typed text sat in the box the whole turn and looked unsent. It now clears BEFORE the await and RESTORES the text on a throw (never eat what the user typed — that guarantee is exactly why the clear was ordered last originally; the fix keeps the guarantee via a catch-and-restore and re-throw, and moves the UX). **FIX 3: the Send button now shows a working state.** The user asked for RED; **red was deliberately NOT used** — BRAND reserves amber (`--held`) for the approval gate ONLY, defines no red/busy token, and red conventionally means destructive/error, so hijacking either would be a brand violation. Instead, while `busy` the circular teal Send button shows a spinning ring (`.btn-spinner` in `globals.css` — a translucent-white track + solid-white head so it reads on the teal fill; `@keyframes btn-spin`, `animation: none` under `prefers-reduced-motion`), stays disabled, and carries `title`/`aria-label="Working…"` + `aria-busy` — visible at a glance (the bare `disabled` being invisible WAS the complaint) and never colour-alone (BRAND §6). `globals.css` is not under this playbook's watch, but the button change in `ChatPane.tsx` is. **FIX 4: no stale trace on a fresh chat, WITHOUT regressing the first-turn trap.** A brand-new/idle chat showed the PREVIOUS thread's trace + a phantom "Thought process" bubble because both consumers gated the no-thread case as `threadId === undefined || activity.threadId === threadId` — i.e. with NO thread they showed ANY latest turn, including an old settled one. The `latestTurn` NO-args design is correct (it solves the first-turn trap where there is no threadId until `sendCockpitMessage` resolves), so the fix is to distinguish "no thread, nothing sent" from "no thread, a first turn is in flight". A single `sending` flag is now LIFTED to `WorkspacePage` (it is also `ChatPane`'s send-button `busy`, aliased) and passed to BOTH `ChatPane` and `CardList` — one signal, so the bubble and the ActivityCard cannot disagree. The gate is now `threadId !== undefined ? activity.threadId === threadId : sending`: with a thread, match it; without one, show the latest turn ONLY while a turn is in flight. `sending` stays true for the WHOLE first turn (set before the await, cleared in `finally`), so the trace is stable throughout it and the trap stays covered — the only residual is a sub-second flash of a returning user's last trace at the instant they send on a fresh chat, which reads as "starting…" and is superseded the moment the new turn's first row commits. Both `CardList` and `ChatPane` now take a required `sending: boolean` prop. + the full phase sweep — **not** against the live perceived-latency behavior, which is the phase's whole point and belongs to the human-verify gate (CKPT-05 stays Pending until then). New `apps/web/e2e/cockpit-activity.spec.ts` drives `SMOKE::agent::brief=today` and asserts the LATEST TRACE card's two rows (`Thought it through` / `Briefed your inbox` — the driver's `thinking` row and the smoke site's `briefInbox` row), the single `aria-live` region, the collapsed Thought-Process bubble, and the brain button expanding it. **Read its header before trusting it:** a SMOKE turn is INSTANT, so the spec only ever sees a SETTLED trace — it proves steps RENDER, never that they render one-by-one DURING a wait. Its real, narrow value is as the regression test for the SMOKE-site emission (research Pitfall 4): `runCockpitAgent` short-circuits `SMOKE::` sentinels straight into `invokeTool`, `generateText` is never called, no SDK callback fires — and EVERY offline E2E in this repo drives that path, so without the smoke-site emission the whole activity surface is invisible to all of them. The LOAD-BEARING automated proof that the emitter fires at all remains `runCockpitAgent.test.ts` (03.9-02), because `ai@7`'s `notify` SWALLOWS callback throws (dist/index.js:2636-2639) — a broken emitter yields no error, no log, no red test anywhere else, and renders nothing in production while every other test passes. **The spec has never run**, on the carried-in 03.7-04 blocker, unchanged: `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` are absent from the env and every `.env*`, and `page.tsx` gates the composer on `gmailAuth.status.connected`, which no smoke helper can seed (a token only arrives via real OAuth consent). Do NOT weaken that gate to make a spec pass — run it in a live session, which has a connected user by construction (`cockpit-briefing.spec.ts`, owed since 03.7-04, is satisfied by the same session for free). Sweep at this commit: backend 271/272 (sole red the documented pre-existing `audit.test.ts`), backend source typecheck clean (30 `.test.ts`-only errors = the documented baseline), web typecheck exit 0, eval-golden `--self-check` exit 0 (note: the runner lives at `packages/backend/scripts/run-eval-golden.mjs`, NOT the repo root), zero new dependencies and zero skill-body edits across the whole phase ⇒ **no eval gate cycle owed**.

> Last verified: 2026-07-17 (03.9-03) against the agent activity-trace RENDER SURFACES (CKPT-05) — the half the user actually sees. TWO surfaces, ONE query: `ActivityCard` (the BRAND §3 `LATEST TRACE` card in the workspace canvas) and `ChatPane`'s in-progress agent bubble both subscribe to `api.agentSteps.latestTurn`, **so they cannot disagree** — and the display verb map lives in exactly ONE module (`cards.tsx`, exported as `stepText`), because a second copy WILL drift. The map is CODE-OWNED and keyed off the closed `tool` union: no model output, no tool output, no mail content reaches the UI via this path (the row has no text field to carry any — 03.9-01). **The two traps this plan exists to dodge:** (1) the card is queried with NO args and rendered ABOVE the `!threadId` early return, because `sendCockpitMessage` returns the threadId only AFTER the loop finishes — a `byThread`-keyed read is `"skip"` for the ENTIRE first turn, i.e. blank at exactly the moment a first-time user decides the product is broken, and such a plan PASSES its E2E (which sends a second message) while FAILING human-verify; (2) it is a THIRD independent `useQuery`, never nested under a plan-status branch — 03.7-04 already sprang that one ("a status-'collecting' row made the OLD dispatch render literally nothing"), and `collecting` is where MOST of the waiting happens. The hard-kill death mode (deploy/OOM — nothing server-side ever runs) is covered CLIENT-side: a `running` row older than 90s reads as possibly stalled, computed from `Date.now()` at render — no ticker, no scheduler, no watchdog, because a page refresh already fixes UI state. Reuses `.trace-line` + the `capsTeal` label idiom (no new CSS class, no animation — the rows arriving one by one IS the motion); `aria-live="polite"` on the card so a screen reader HEARS progress (a silent progress surface would reproduce the original complaint for non-sighted users) and the bubble deliberately has NO second live region (it would read every step twice); no amber (`--held` is the approval gate's alone) and no colour-only meaning — an `error` step shows the ATTEMPT verb plus text, never the done verb. `busy` and the plan-status milestone chip are both KEPT (complementary, not redundant). The composer's brain button now toggles the bubble's collapsible "Thought Process" trace (BRAND §5's specified pattern) instead of claiming the feature was unbuilt. **NOT verified live** — "does React paint these rows during a real wait" is 03.9-04's human-verify. Prior: 2026-07-17 (03.9-02) against the agent activity-trace LOOP EMISSION + TURN LIFECYCLE (CKPT-05). `llm.ts` now emits one `agentSteps` row per tool call from `ai@7`'s native `generateText` callbacks (`onToolExecutionStart`/`onToolExecutionEnd`) — **zero tool-wrapper edits**, and `ctx.runMutation` is not a style choice but the only option (actions cannot write) AND the mechanism (each write commits mid-turn and pushes to live subscribers). Both cockpit drivers mint a `turnId`, record the `thinking` row, and terminalize in a **`finally`** — the governed stop is an early `return`, not a throw, so a catch-only fix would leave it spinning forever. The SMOKE path emits around its own call site (Pitfall 4) so the offline E2E can see the feature. Proven by `runCockpitAgent.test.ts` asserting the ROWS EXIST — the SDK swallows callback throws, so a broken emitter passes any test that only checks the loop returned. Three new mutation-checked §4 scans (schema allow-list / callback hazards / log-plane-free). No skill edit, no tool-description change ⇒ **no eval gate cycle owed**. The stale `listThreadMessages` ponytail comment naming `useUIMessages`/`vStreamArgs` as an upgrade was corrected — that path is version-blocked (`@convex-dev/agent@0.6.4` peers `ai@^6`; repo pins `ai@7`; 0.6.4 is latest). Prior: 2026-07-17 (03.9-01) against the agent activity-trace DATA PLANE (CKPT-05, minted this plan — the step rows the loop writes and the browser subscribes to, so a 10-30s turn shows its work instead of freezing; the 03.7 UAT Gap-2 report). New `agentSteps` table + `agentSteps.ts`, mirroring `briefings.ts` including its "writes NO log-plane row" property. **The §4 story here is STRUCTURAL: the row has no field that can hold text**, so the leak class this phase could have introduced is impossible rather than merely forbidden — a closed `tool` union + a `phase` enum + numbers, with the human-readable verb living as a code-owned map in the UI keyed off `tool`. This matters because the SDK's tool events carry `messages[]` and `toolOutput.output` (and `listInbox`'s return contains SUBJECTS), so a `label` field would have been one careless spread away from a leak. `count` is declared but UNWRITTEN (`ponytail:` — verbs are the ask; the upgrade path is an explicit per-turn recorder written by the ≤3 tools that KNOW a count, never parsed out of a return string). **A REAL BUG was caught by the tests and is worth not re-learning:** the research's `latestTurn` pattern read the newest turn via a `by_thread` index (`["tenantId","threadId"]`) eq'd on `tenantId` ALONE — but that leaves `threadId` as the dominant sort key, so `.order("desc").first()` returns the alphabetically-largest thread's row, NOT the newest one. The `briefings.byThread` "index order IS recency" property holds there only because it eq's BOTH prefix fields; **it does NOT generalize to a partial prefix.** The index is therefore `by_tenant` (`["tenantId"]` alone), and there is no `by_thread` index because nothing reads by thread. NOT yet built: the loop emission (Plan 02 — `generateText`'s `onToolExecutionStart`/`onToolExecutionEnd` + the driver-owned `thinking` row) and the card/bubble (Plan 03); CKPT-05 stays Pending until 03.9-04's human sign-off.

> Last verified: 2026-07-17 (03.7-05 checkpoint feedback) against the LIVE BRIEFING CARD — human-verify REJECTED it, for two reasons that turned out to be ONE. (1) React threw "Encountered two children with the same key, `1784248262000-Google <no-reply@accounts.google.com>`": the card keyed rows on `${ts}-${sender}`, which is NOT unique — an automated sender batching two messages shares BOTH parts. (2) "It is so crowded… just a list of sentences": rows rendered `time · sender · gist` with no heading to scan. **Both were the same missing data.** `gmail.listInbox` already fetched the message `id` AND the `subject` header, and `InboxMessageMeta` already declared both — `joinDigest` simply never welded them onto `BriefingItem`. The fix carries them through (core → schema → card): `id` is now the row's identity and the React key, `subject` is the row's heading. **Both ride the same code-owned rail as `sender`/`ts` — the model's surface is UNCHANGED (gist/category/needsReply/deadline) and ADR-004 holds; a model-authored subject would be a fabrication rendered as a header fact.** Adding them to `schema.ts` broke `briefings.ts`'s hand-copied `ITEMS` validator ("Unexpected field `id`") — it is now DERIVED from `schema.tables.briefings.validator.fields.items`, so the next field lands in one place. The push also required clearing the dev `briefings` table (pre-existing rows lacked the new required fields; the fields are NOT optional — they are always present in real data, and optional would push the problem into the UI). If you add a field to a `briefings` item, expect the same clear.
>
> Last verified: 2026-07-17 (03.7-05) against the LIVE briefing path — and it was BROKEN. `digestInbox`'s `deadline` was declared optional (`properties` without `required`), which **OpenAI structured outputs reject in STRICT mode**: the API refuses the schema itself, so `generateObject` threw `AI_APICallError` on EVERY live digest, on every input, since 03.7-03. `briefInbox` caught the throw and degraded to its `mailboxUnavailable` branch, so the live agent politely said it could not access the inbox — a *plausible* failure that looked like a Gmail problem and was not. Nothing offline could see it: the unit tests mock the model, and the E2E's `offlineDigest:true` short-circuits before the call. It surfaced only when the 03.7-05 golden run put a real body through a real model (`briefingPresent` false ×3 — the Pitfall-3 guard earning its place on its first run). **The fix: a field that may be absent must be NULLABLE-AND-REQUIRED** (`type: ["string","null"]` + listed in `required`), normalized back to absent after the call — `deadline: null` would otherwise bounce the `briefings` insert, whose validator is `v.optional(v.string())`. Locked by a mutation-checked scan in `llmRedaction.test.ts` ("every generateObject schema is STRICT-mode legal") that holds the line for EVERY `jsonSchema` in `llm.ts`, not just this one. If you add a field to any model-facing schema, it goes in `required` — always.

> Last verified: 2026-07-17 (03.7-04) against the BRIEFING CARD + its offline E2E (CKPT-04/SC-1/SC-4 — the user-facing half of the briefing). `cards.tsx` gained `BriefingCard`, and `CardList` now reads `api.briefings.byThread` in a SECOND `useQuery` that is INDEPENDENT of plan status: the old `plan === null` early return ("No plan yet…") is now a branch that still renders the briefing (research Pitfall 6 — "what happened in my inbox?" is typically a thread's FIRST message, and anything gated behind plan status would simply never appear for the commonest briefing flow; `sendCockpitMessage` inserts a plans row on thread creation, so live the row is usually present-but-`collecting`, which the old dispatch rendered as nothing at all). The card renders the ROW and nothing else: "Needs you" first (`needsReply || deadline`), then Today / Yesterday / This week, empty groups skipped; every timestamp is formatted with `Intl.DateTimeFormat` **in `briefing.tz`** — the zone the SERVER bucketed in — so a group and its clock times can never disagree (the browser's own zone is deliberately irrelevant here, unlike the `sendAt` picker); unread is a dot that is also `aria-label`led (never colour alone, BRAND §6); the deadline SUGGESTION is emphasised by weight, not amber (`--held` is spent on the approval gate alone, BRAND §2); cap honesty renders "summarized N of M" when `listedCount > items.length`. **SC-4 is structural: the card contains NO button, link, or onClick** — acting on a briefing re-enters the conversation → PLAN → Approve, so nothing a third-party email says can become a one-click action. The E2E asserts zero `button`/`a` inside it; keep it that way. `cockpit-briefing.spec.ts` drives the whole loop offline (seed fixture → `SMOKE::agent::brief=today` → card): it resolves the tenant by decoding the `sub` claim of the Convex Auth JWT in localStorage (`tenantId === identity.subject`; the value is minted at sign-in so it cannot be known ahead of the run, and no product code should expose it just for a test), then seeds via the `smokeRun.mjs` convention (convex CLI through `node`, no shell — the tenantId contains a `|`, which cmd.exe would read as a pipe; success from OUTPUT not exit code). Bucketing of the 5-message fixture at `baseMs = SMOKE_NOW_MS` was verified against the real `@pikar/core` `bucket`/`selectForDigest`: 3 today / 1 yesterday / 1 this week, with Sarah Chen at selection index 0 (the offline digest's pinned `needsReply` row). LIVE RUN STILL OWED: the spec is blocked on `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` (the phase-wide convention) AND on the harness user having a Gmail token row — the fixture seam removes the backend's token need, but `page.tsx` still gates the composer on `gmailAuth.status.connected`, which is upstream of the chat. Run it in Plan 05's human-verify session, where a connected user exists.
>
> Last verified: 2026-07-17 (03.7-03) against the briefing TOOL surface — the WIP the (now superseded) capture-session line below flagged is this entry's subject, committed and verified. `llm.ts` gained the **toolless `digestInbox` internalAction** (CKPT-04/SC-2, the load-bearing boundary): raw message bodies reach an LLM ONLY inside this `generateObject` call, which has NO tools — so a prompt injection in a body has nothing to inject into (it cannot send, cannot read a plan, cannot call anything; its worst case is a misleading gist a human reads on a card). It copies `draftDocument` exactly: fail-closed `inbox-digest` skill load FIRST (pin → `getSkillVersion`, else `getActiveSkill`), the `smoke` short-circuit AFTER the load, then DEFAULT_MODEL → `isFallbackEligible` → one CHEAP_MODEL retry, both `recordModelSpend`-ed (the digest is the biggest sub-call in the system, so the budget/kill-switch rails must see it; marked `ponytail:` — its cost still does not ride the loop's `costUsd`, the accepted draftDocument ceiling, which leaves the EVAL COST CAP blind to digest spend — bounded by the cap + truncation). Its schema is INDEX-KEYED with no sender/ts/bucket (ADR-004) and out-of-range indexes are dropped at the boundary (belt and braces with `joinDigest`). `buildCockpitTools` gained two READ-ONLY tools: `listInbox` (a peek — returns sender LABELS via `parseAddress` + subjects + a count; NO address §2-D, NO snippet, since a snippet is third-party content too) and `briefInbox` (list → pure-core window filter + `selectForDigest` → `fetchInboxBodies` → toolless digest → `joinDigest` → `briefings.insert` → ONE refs-only `briefing.created` audit `{briefingId, range, listedCount, digestedCount}` → a COUNTS-ONLY return: bodies AND gists stay out of the tool-bearing loop, the ResolutionCard/panel-driven precedent). Both tools' `range` is an **enum**, never a free string — it flows into the `mailbox.listed` audit payload, so prose there would be a §4 leak. Both degrade conversationally on an unreadable mailbox (`gmail_reconnect` notification + fallback string, never a throw). `gmail.ts`'s `ListInboxResult` now surfaces `offlineDigest` from the fixture row so the E2E digests offline while the eval probe (`offlineDigest:false`) runs a LIVE digest over the injected body. New `SMOKE::agent::brief=today|yesterday|week` op drives `briefInbox` offline with zero model calls (`SMOKE_NOW_MS` is also the fixture's `baseMs`, so buckets are deterministic). `PlanRow` gained `threadId` (structural, never model-facing) so the briefing keys to the right thread. cockpitTools 30/30 green. NOT yet built: the BRIEFING card (Plan 04) — and the `cockpit-agent.md` "## Inbox briefing" edit these tools need is a GATED CANDIDATE until Plan 05's live gate cycle, so the agent does not yet know the tools exist.
> Last verified: 2026-07-17 (03.7-02) against the inbox READ PLANE + the briefing content plane (CKPT-04/SC-3 — the data layer Plan 03's tools orchestrate; nothing is model-facing yet). `gmail.ts` gained two GET-only actions: `listInbox` (capped ≤50 over the RELATIVE `in:inbox newer_than:7d` — never `after:`/`before:`, whose calendar dates are tz-ambiguous — per-id `format=metadata` gets riding the top-level `snippet`/`internalDate`/`labelIds`, `Number()`ing the STRING internalDate and taking the unread flag free from `labelIds`) and `fetchInboxBodies` (`format=full` for the digest-selected few ONLY, via the exported pure `pickPlainText` — recursive `parts` walk to the first `text/plain` leaf, `base64url` NOT base64 — with a snippet fallback for HTML-only mail, never parsing HTML, every body truncated to `BODY_TRUNCATE_CHARS`). The mailbox is **read-only by construction**: no `/modify|/trash|/untrash|/batchModify|/labels` endpoint exists and the only two POSTs remain TOKEN_ENDPOINT + SEND_ENDPOINT — both facts now statically enforced (a deliberately smuggled `/modify` POST was confirmed to fail both scans). Exactly ONE refs-only `mailbox.listed` audit (`{range, resultCount}`) per successful list; a failed list audits nothing (mutation-checked: leaking a `from` into that payload fails its test). New `briefings` table + `briefings.ts` adapter (append-only per thread, latest-wins `byThread` tenantQuery, writes NO log-plane row — mirroring `plans.ts`) and the `inboxFixtures` seam + `smoke.seedInboxFixture` (5 fixed deterministic messages incl. the injection body carrying the `attacker@evil.example` needle; idempotent; checked BEFORE the token so the offline E2E and the eval injection probe run with no mailbox — the eval tenant has none and the runner rejects `SMOKE::` turns). 46 tests green (gmail 24, llmRedaction 18, briefings 4); source typecheck clean; both `fetchInboxBodies` truncation and the refs-only payload verified by deliberate-break mutation checks. NOT yet built: the `listInbox`/`briefInbox` tools, the toolless `digestInbox` action, and the BRIEFING card (Plans 03/04) — and the `cockpit-agent.md` edit they need will require a live eval gate cycle (03.6-05 procedure).
> Last verified: 2026-07-17 (03.7-01) against the pure briefing module `packages/core/src/briefing.ts` (CKPT-04, the Phase 3.7 foundation — TDD, no Convex surface touched yet). It lands SC-1's locked decision in code: **time grouping is pure code, never LLM output** (ADR-004). `bucket(msgTsMs, nowMs, tz)` derives `today`/`yesterday`/`thisWeek`/`null` from Gmail's `internalDate` + the client's IANA zone (the `parseSendTime` clock contract — the model never supplies "now", §2-D), and `joinDigest` welds the toolless digest's INDEX-keyed gists onto the code-owned sender/ts/bucket, dropping any out-of-range/non-integer/duplicate index so the model structurally cannot invent a briefing row or own a timestamp. The DST trap is closed deliberately: yesterday comes from UTC math on today's day-key, not `dayKey(now - 86400000)` — the day after a spring-forward is 23 local hours long, so the naive form silently skips a calendar day (pinned by a regression test at LA 2026-03-09 00:30 PDT, where naive yields 03-07 and the truth is 03-08). `selectForDigest` is the recency-first body cap (`BRIEFING_BODY_CAP = 25`, `BODY_TRUNCATE_CHARS = 2000`) that keeps the snippet-first decision and the digest's eval-cap blind spot structurally small. 22 tests green (99/99 in `@pikar/core`), core typecheck clean, zero new dependencies — `Intl.DateTimeFormat` is the whole date library (ponytail rung 3). NOTHING consumes these exports yet; the `listInbox`/`briefInbox` tools, the toolless `digestInbox` action, the `briefings` table and the BRIEFING card arrive in later 3.7 plans, and the `cockpit-agent.md` edit they need will require a live eval gate cycle (03.6-05 procedure).
> Cross-ref (05-07, Lane C): `apps/web/e2e/vault.spec.ts` landed under the shared e2e harness this playbook watches — it exercises the Knowledge Vault UI only (owned by `vault.md`); no cockpit flow, tool, or send-spine changed.
> Last verified: 2026-07-14 against 03.3-06 (CKPT-02 human-verify gap-closure — PDF QUALITY: `markdownToPdf` (llm.ts) upgraded from a flat black-Helvetica line renderer to a professional layout — a bold accent title block + rule, accent-colored `##`/`###` headings with section hairlines, real square-bullet and numbered lists, inline **bold** runs (run-aware word-wrap), and GitHub pipe tables with a filled header row + hairline borders — all deterministic (pinned dates, shapes not glyphs) so V1 byte-identity holds. `@pikar/core` `tokenizeMarkdown` extended (numbered lists, `* ` bullets, `#`..`######` clamped to 3 levels, pipe tables) and a new `inlineRuns` resolves `**bold**`/`__bold__` and STRIPS stray `*`/`` ` `` so raw markdown never reaches the page (the human-verify defect: the PDF showed literal stars/hashes). Render smoke covers the bold+table+list path + determinism; `inlineRuns`/tokenizer unit-tested in core. The drafter-skill half lives under skill-registry.md. Prior: CKPT-02 human-verify gap-closure — CONTACT ACCURACY: `rankCandidates` no longer falls back to returning ALL correspondents when NO contact matches the searched name — it returns `[]`, so `resolveContacts` reports "found no contact matching <name>, ask the user for the address" and NEVER substitutes an unrelated correspondent as the named person. This closes the live liability where asking for "Joel" (unfound) silently surfaced a stranger with no signal the match failed — a wrong recipient on a proposal/deal is a liability, so an honest "not found, what's their email?" beats a confident wrong guess. Test flipped in `emailIntent.test.ts` (no name-match → `[]`). Follow-up: `resolveContacts` strips the `SMOKE::` search sentinel from the name before `rankCandidates` (the sentinel is fixture-routing plumbing, not part of the name — a no-op in production; without it the offline `SMOKE::Sarah` fixture stopped matching under the stricter no-substitution logic). Prior: Phase 3.3 Attachment Generation, Wave 4 — PHASE CLOSE, CKPT-02: the governance-critical end-to-end proof that a generated attachment rides the SAME governed spine (audit/telemetry/DLQ) with zero bytes/base64/URL in any log plane. `smoke:fanout` now materializes ONE shared attachment ref across every recipient (mirrors `executePlan`) and asserts (V6) the ONE generated document set fanned to all recipients (`assertFanoutAttachmentShared`), the forced-fail row dead-letters ALONE, terminals are write-once, and — the §4 check — NO file bytes / base64 appear in any audit/deadLetters/telemetry row (the stored PDF's byte-marker + its base64 are scan needles alongside subject/body/recipient). `smoke:guardrails` gained a 7/7 section (V8): a generation turn under the kill switch returns the paused reply from `runCockpitAgent.preCall` BEFORE the `generateAttachment` tool runs — NO attachment stored, NO `deadLetters` row, plan unapprovable (`assertNoAttachmentStored`). `cockpit-attachment.spec.ts` drives the offline `SMOKE::agent::attach` flow end to end (chat→attach→PLAN filename+download+no-attachmentError→Approve→REPORT delivered-with-attachment re-download) plus a `removeAttachment` variant asserting the row disappears pre-approval (V9). Both smokes GREEN against a live `convex dev`; the E2E type-loads + is Playwright-discovered (live run deferred to verify-work — needs a seeded E2E user + `next dev :3111`, the phase-wide convention). The real-PDF live send + audit-refs-only inspection is the sole human-verify (V10). Prior: 03.3-05 (Phase 3.3 Attachment Generation, Wave 3 — the send fan-out propagation + PLAN/REPORT card attachment rows, CKPT-02: `executePlan` now materializes `plan.attachments` (the inline pre-approval refs) into `attachments` table rows ONCE, then seeds the SAME shared `Id<"attachments">` array on EVERY recipient's `requests` row — one generated document set fanned to all recipients, no per-recipient duplication and no extra storage writes (storage is immutable per id); a zero-attachment plan keeps `attachmentRefs: []`. The send spine is UNCHANGED — `deliverApprovedPlan`/`gmail.send`/retrier/audit/DLQ already read `attachmentRefs` (Plan 03), and `workflow.start(` remains the single call site in `executePlan`. The `cockpit.test.ts` attachment fan-out tests are the FIRST convex-test coverage of the successful proposed→delivering path: they register the `workflow` + `workflow/workpool` components (`@convex-dev/workpool` added as a test-only devDep pinned to the version `@convex-dev/workflow@0.4.4` already resolves) so `executePlan` runs end-to-end, asserting the shared ref id across recipients + exactly one materialized row, and the zero-attachment `[]` path. PLAN card (`cards.tsx` `PlanAttachments`) shows each generated attachment's filename + size + a signed download link (from the tenant-guarded `attachmentUrls` — a bearer capability, §4) with per-attachment Regenerate (topic input) + Remove controls that re-enter the agent tool-loop via `sendCockpitMessage` (a natural-language instruction live; the offline E2E drives the same tools via the composer's `SMOKE::agent::removeAttachment=<i>` / `regenerate=<i>:<topic>` sentinels), and surfaces `attachmentError` with an unapprovable-until-fixed note. REPORT card shows each recipient delivered-with-attachment as a 📎 chip that re-downloads the EXACT sent bytes (`reportForPlan` per-row `attachments`, §4 — url never logged). Prior: 03.3-04 (Phase 3.3 Attachment Generation, Wave 2 — the attachment TOOLS + propose gate, CKPT-02: `buildCockpitTools` gained three governed tools — `generateAttachment({topic})`, `regenerateAttachment({index, topic})`, `removeAttachment({index})` — each a thin governance boundary mirroring `draftBody`. A shared `renderAndStore` runs scan (fail-closed §4) → `internal.llm.draftDocument` → `markdownToPdf` (wrapped: a render throw or an over-`PLAN_ATTACHMENT_CAP_BYTES` total sets `attachmentError` via `recordAttachments` and adds NO ref — block-on-render-fail, V7) → `buildDocFilename` → `ctx.storage.store(Blob(pdf))`; generate appends the ref + clears the error, regenerate supersedes in place then `storage.delete`s the OLD id AFTER the new ref persists (O3 — no orphan/dangling ref), remove persists the shortened array then deletes the bytes. Tools return filename/count LABELS only — never a URL/bytes (§2-D/§4). `proposePlan` now refuses when `attachmentError` is set OR the summed `attachments` size exceeds the cap (facts from the ROW; defense-in-depth over the tool-level refusal). `buildAgentContext` surfaces attachments by `#index/filename` (no storageId/URL to the model). A `render=fail::` per-request SMOKE hook (mirrors `fail=primary::`) exercises the render-fail path offline; `SMOKE::agent::attach|regenerate=<i>:<topic>|removeAttachment=<i>` drive the tools with deterministic fixed bytes (no model/render variance). The `cockpit-agent` skill v-bumped: SUGGEST-then-confirm before attaching, reason about attachments by filename/#index, never claim a send. Per-tool + gate tests in `cockpitTools.test.ts`, SMOKE-op integration in `runCockpitAgent.test.ts`. Prior: 03.3-01 (Phase 3.3 Attachment Generation, Wave 1 — the document-generation ENGINE, CKPT-02: `llm.ts` gained `draftDocument` (internalAction mirroring `draftCockpit` — loads the `document-drafter` registry skill fail-closed, takes ALREADY-REDACTED `{tenantId, safeText, safeTextHash}`, SMOKE:: offline path, returns `{title, markdown}`, writes NO audit) and `markdownToPdf(title, markdown)` (a pure-JS renderer over pdf-lib@1.17.1 Standard-14 Helvetica — NEVER `embedFont(ttf)`, so NO runtime font-file reads; US-Letter, manual word-wrap + page-break, every drawn string passes `@pikar/core` `toWinAnsi` so `drawText` cannot throw on smart-punct/astral glyphs (V2), CreationDate/ModDate pinned to the epoch for byte-identical output (V1), any throw → rejection, never a partial PDF). The pure validators (`tokenizeMarkdown`/`toWinAnsi`/`buildDocFilename`/`exceedsByteCap`/`PLAN_ATTACHMENT_CAP_BYTES`) live in `@pikar/core` `documentGen.ts` (§1, watch-registered under this playbook). No wiring/tools/send yet — engine only. Prior: 03.3-03 (Phase 3.3 Attachment Generation, Wave 1 — the multipart SEND seam, CKPT-02: `buildMime` gained an optional `attachments` param — zero → the EXACT legacy plain-text string (byte-identical, provably-unchanged today's sends, V4), one+ → `multipart/mixed` (ONE top-level MIME-Version:1.0, a `=_pikar_<hex>` boundary, a base64 text/plain body part, one `application/pdf`-style part per attachment in STANDARD base64 wrapped 76, a MANDATORY closing `--boundary--`; only the whole raw message is base64url via the existing `base64Url()` — the classic inner-vs-outer-encoding bug the colocated `gmail.test.ts` self-check guards, V3). `send` loads each resolved attachment's bytes via `ctx.storage.get(storageId)` after the token refresh and BEFORE building the MIME — a missing/deleted blob THROWS (→ retrier → onComplete DLQ, never a silent send without the promised attachment); the `gmail.sent` audit stays refs-only (`{requestId, messageId}`, never bytes/base64/URL, §4). `getForDelivery` resolves `requests.attachmentRefs` → `[{filename, mimeType, storageId}]` (dangling refs dropped) alongside the existing delivery fields. Retrier/audit/telemetry/awaiting_reauth/DLQ reused VERBATIM. Prior: 03.3-02 (Phase 3.3, Wave 1 — the content-plane extension: `plans.attachments` array + `attachmentError` marker (both optional, no migration), `recordAttachments` as the sole write surface, and the FIRST `storage.getUrl` served ONLY from the tenant-guarded `attachmentUrls` query + the `reportForPlan` per-recipient attachment extension — a signed download URL is a bearer capability, tenant-guarded and never logged (§4). Schema + adapter only; no tools/send/UI). Prior: 03.2.1-06 — Phase 3.2.1 Agent-Driven Cockpit, Wave 5 — PHASE CLOSE: the FSM→agent CUTOVER is complete and this playbook now documents the agent tool-loop as the LIVE runtime, not the retired FSM. The conversation engine is `runCockpitAgent` — a governed `generateText` tool-loop in `llm.ts` — driven by `sendCockpitMessage`, now a thin driver: ensure thread + `plans` row → save the user turn → `internal.llm.runCockpitAgent` in try/catch → save the reply as the assistant turn (a caught throw becomes a non-dead-ending error turn — nothing sent, partial plan valid; a `blocked` governed stop returns AS the paused reply). The deterministic `emailIntent` FSM glue (`parseAnswer`/`toIntentState`/`questionText`/`advance`/inline resolve-turn + the `@pikar/core` FSM imports) is DELETED — no dual engine; only the pure validators survive in `@pikar/core` (`isValidEmail`, `parseAddress`, `rankCandidates`, contact types, `buildRecipientView`, `applyRecipientEdit`). `resolveRecipients` (card pick) folds a pick directly via `applyRecipientEdit({op:'add'})` over held `pendingValid` + picks + `greetingName` from pick #1, then `clearCandidates`, then RE-ENTERS the tool-loop (`internal.llm.runCockpitAgent` with a continuation prompt in try/catch → save the reply) so the agent takes its next step from the updated row — **a card pick is an agent TURN, not a dead-end** (a pick that only folded and returned left the workspace blank with no reply until the user typed again — the 03.2.1 human-verify hang, now closed). Send-safety spine UNCHANGED: `executePlan` approve-gate + `proposeEmailPlan` + `listThreadMessages`; `workflow.start(` remains the single call site in `executePlan`. Human-verify (Task 2) surfaced several live-only defects the offline suite could not (all now closed and LIVE-VERIFIED): (1) the `cockpit-agent` skill was not seeded on the running deployment → `loadSkill` fail-closed threw `NO_ACTIVE_SKILL` → the bare `catch` in `sendCockpitMessage` masked it as "Something went wrong" (fix: run `skills:seedSkills` — a runtime setup step, not a code change; the unit suite seeds its own convex-test instance so it stayed green); (2) a card pick folded the recipient but never re-entered the loop, dead-ending on a blank workspace (fix: `resolveRecipients` now re-invokes `runCockpitAgent` — see above). Human-verify APPROVED (2026-07-13): on the live Gmail-connected backend a real name resolved → ResolutionCard multi-select pick → the agent AUTO-continued through subject/body → the PLAN showed the picked recipients → one Approve, NOTHING sent before it (AGNT-01/AGNT-02). Further gap-closure landed during verify and is documented in the invariants below: name-match ranking + multi-select (`429c862`), panel-driven `cockpit-agent` prompt v2 + `seedSkills` publish-on-change (`9efa802`), recipient-integrity guards — no empty-set wipe, `proposePlan` refuses a zero-recipient plan (`042f2cd`), and the LLM transport moved to DIRECT OpenAI (`b635d19`). Rails reused VERBATIM: `guardrails.preCall` gates BEFORE the loop (a governed kill-switch/budget stop returns a conversational "paused" reply as DATA — never a throw/DLQ), `stopWhen: stepCountIs(8)` bounds the loop, `recordSpend` consumes the priced usage after, and an `isFallbackEligible` failure retries once on `CHEAP_MODEL`. A `SMOKE::agent::<op>` sentinel drives ONE governed tool call per user turn offline (the E2E path — no gateway). Mock-model loop test (`runCockpitAgent.test.ts`) proves a scripted edit sequence reaches a `proposed` plan, a kill-switch stop pauses without a DLQ, and the CHEAP_MODEL fallback + recordSpend both run — offline via the `__runCockpitAgentWithScript` shim. Prior (03.2.1-04, Wave 3): `llm.ts` gained `runCockpitAgent` as the ENGINE (not yet wired — the cutover was Plan 05). Prior (03.2.1-03, Wave 2): `llm.ts` exports `buildCockpitTools(ctx, tenantId, planId)` — the governed Executive-Agent tool set (resolveContacts / add·remove·set·Recipients / setSubject / setMode / draftBody / proposePlan), each a thin wrapper preserving its primitive's governance (invalid address bounces at the boundary, remove resolves a 1-based #index server-side, draftBody `scanText`-redacts BEFORE `draftCockpit`, proposePlan reads structural facts from the ROW) — plus `buildAgentContext` (index+label recipient view, address-free). `plans.getById` added so the node action reads the row by id. No `generateText` loop yet (Plan 04). Per-tool tests in `cockpitTools.test.ts`; static index/label proof added to `llmRedaction.test.ts`. Prior (03.2.1-01/02): the cockpit reasoning prompt loads from the registry as the `cockpit-agent` skill — 03.2.1-01 — and 03.2.1-02 added the pure `buildRecipientView` + `applyRecipientEdit` recipient tool-internals in `emailIntent.ts` that the Executive Agent tool-loop drives. Prior (03.2-06) — Phase 3.2 CLOSED: this playbook + watch update bless the phase's watched-file changes per §9 — `gmail.ts` is watch-protected under cockpit.md, the headers-only mailbox-read path, resolution flow, `resolveRecipients`, and transient candidate fields are documented, and CKPT-01 is confirmed by a real mailbox read that resolves a correspondent with nothing sent. Prior (03.2-05): the resolution CARD UI landed — `cards.tsx` `ResolutionCard` renders one chip-section per unresolved name (address + count/last-contacted hint) plus a pre-selected `pendingValid` "already valid" row, and calls `api.cockpit.resolveRecipients` on the pick; `ChatPane` shows a "Searching your mailbox…" activity chip while `plan.candidates` are parked; `cockpit-resolve.spec.ts` proves name→card→pick→PLAN offline with nothing sent; `cockpit-report.spec.ts` recipients line is comma-separated for the new tokenizer. Prior (03.2-04): resolution turn WIRED — cockpit runs `gmail.search`→`rankCandidates`→`writeCandidates` on an unresolved name, `resolveRecipients` folds the pick, `greetingName` threads to the drafter; DECISION #2 preserved, one LLM call; `/gmail/callback` 303-redirects to the app; `draftCockpit` SMOKE path honors `greetingName` so the resolution E2E asserts the greeting offline)
> Build history: `.planning/phases/03.1-cockpit-core/` (numbered `03.1-NN-PLAN.md` docs, `03.1-VALIDATION.md`, `deferred-items.md`) · Design: `.planning/design/email-chat-cockpit.md` · Related ADRs: [001](../decisions/001-convex-data-orchestration-plane.md), [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

A two-pane email workspace where the user drives a governed email send by chatting.
An **Executive Agent tool-loop** (`runCockpitAgent`) reasons over the conversation and
calls **governed tools** to fill the plan — the user can edit conversationally at any
turn ("remove Bob", "make it more formal, add Jane"), not walk a rigid slot script. The
tools (resolve contacts, add/remove/set recipients, set subject/mode, draft body, propose
plan) mutate the single `plans` row; a PLAN card is proposed, the user clicks Approve
**once**, and a live REPORT fills per-recipient as a fan-out workflow sends. It is a
wiring layer over the existing governed spine (gmail.send, audit, telemetry, DLQ,
WorkflowManager, `email-drafter` + `cockpit-agent` skills) — the agent engine reasons, but
every structural fact and send stays governed at the tool boundary and the human Approve gate.

## Key files

Frontend (`apps/web/app/(app)/dashboard/workspace/`):
- `page.tsx` — cockpit page; holds the shared `threadId` state, Gmail-status gate, renders SplitPane(ChatPane, CardList)
- `ChatPane.tsx` — left pane; `useThreadMessages` + composer calling `sendCockpitMessage`; lifts the minted threadId via `onThread`; 3.2: a "Searching your mailbox…" activity chip while `plan.candidates` are parked. 3.9 (CKPT-05): the IN-PROGRESS AGENT BUBBLE — BRAND §5's specified pattern (agent = white card, left-aligned, with an optional collapsible "Thought Process" trace), reusing the real `msg-row`/`msg-avatar agent`/`msg-name`/`bubble(false)` turn chrome so it reads as a turn and not a foreign widget. It reads the SAME `api.agentSteps.latestTurn` as `cards.tsx`'s `ActivityCard` (one query, two surfaces — they cannot disagree) and words it through the SAME exported `stepText` (the verb map exists in exactly one module). Expanded while a step is running, collapsed once the turn settles, and the composer's brain button overrides either way (`traceOpen: boolean | null`, null = follow the turn) — that button previously advertised the feature as unbuilt and now IS it. The plan-status MILESTONE chip and `busy` are both KEPT: the chip reports milestones and only lights after the wait is over, `busy` is the sub-second bridge between the click and the first row committing — neither is what the trace replaces. NO `aria-live` here on purpose: the workspace `ActivityCard` is always on screen (two-pane cockpit) and already announces these exact rows; a second live region would read every step TWICE
- `cards.tsx` — right pane; `CardList` dispatcher + `PlanCard` (Approve button), `DraftCard`, `ReportCard`; 3.2: `ResolutionCard` (chip-section per unresolved name + `pendingValid` row → `resolveRecipients` on pick), dispatched during `collecting` BEFORE `proposed`; 3.4 (CKPT-03): `PlanRecipientBodies` (a PLAN-card section mirroring `PlanAttachments` — one row per recipient with its address chip + a "tailored"/"shared body" tag + the body `.slice(0,240)`, read-only; renders NOTHING when no recipient has an override, the shared PREVIEW covers the same-content case); 3.5 (SCHD-01): the PLAN card gained a `<input type="datetime-local">` SEND TIME picker bound to `plan.sendAt` (epoch↔local wall-clock via the browser tz — no hand-rolled tz math) + a "Send immediately" clear + the resolved ABSOLUTE time shown before the single Approve (the Approve button reads "Approve & schedule" when a future time is set), plus `ScheduledCard` ("Scheduled for <abs> · Cancel", a CAS/busy-guarded halt) and `CanceledCard`; `CardList` dispatches `scheduled`→ScheduledCard / `canceled`→CanceledCard and suppresses the DraftCard under both; 3.7 (CKPT-04): `BriefingCard` (+ `BriefingRow`) — "Needs you" then Today/Yesterday/This week over `api.briefings.byThread`, times in `briefing.tz`, cap honesty, and ZERO action affordances (SC-4); `CardList` reads that query INDEPENDENTLY of plan status. 3.9 (CKPT-05): `ActivityCard` — the BRAND §3 `LATEST TRACE` tracked-caps card (§4: a CARD on the canvas, never chrome bolted onto the pane header), one `.trace-line` per step (globals.css:1119 — already exactly this look, so no new class) with a `durationMs` suffix on settled steps (SDK-measured server-side, already in the row — never a `setInterval`). It holds `VERB` (the code-owned map, one entry per tool of the closed union, unknown key → "Working…" so a future tool cannot crash the card) and exports `stepText` so `ChatPane` shares it. `CardList` gained the THIRD independent `useQuery(api.agentSteps.latestTurn)` — **NO args, rendered ABOVE both the `!threadId` and `plan === null` early returns**; the old plan-status dispatch was lifted VERBATIM into `PlanCards` purely so the trace can sit above it. Both facts are load-bearing, see the `Last verified` header: threadId does not exist until the wait is over, and a plan-status-gated dispatch is the 03.7-04 trap. `activity === undefined` (query loading) deliberately does NOT gate the list into "Loading…" — that would flash on every render; it is treated as "no activity yet", and the idle copy ("No artifacts yet." / "No plan yet…") is suppressed only while a step is actually running, so it can never swallow a live trace nor lie about an idle one. **03.7-05 checkpoint rework:** every section renders through ONE `BriefingSection` on a shared 3-column grid — sender (`minmax(0,9rem)`, dot + name, ellipsis) | subject-over-gist (`minmax(0,1fr)`, `minWidth:0`) | time (`max-content`, `tabular-nums`) — so columns align down a section WITHOUT a bordered table (BRAND §4: "cards on the canvas, never dense tables-on-white"); rows are divided by a `1px var(--rule)` hairline (border-top on all but the first — the `<ul>` has NO `gap`, or the rules float off the rows they divide) with `0.5rem` vertical padding, because "crowded" was the complaint. Keys are `item.id` — NEVER `ts`/`sender`/index. **Overflow is load-bearing, not cosmetic:** `minmax(0,…)`+`minWidth:0` size the BOX, but the model-authored `gist`/`deadline` WRAP (a gist must read in full), so an unbroken token escapes the box the ellipsis columns clip — measured at `clientWidth:153`/`scrollWidth:1964`, dragging the document scrollbar to 2137px on a 420px pane. `overflow-wrap:anywhere` on both is the fix (it also feeds min-content sizing; `break-word` does not). Verified no-overflow + columns-aligned + no page scroll at 820/420/320px and renders the briefing even when `plan === null` (Pitfall 6 — see the 03.7-04 entry above)
- `SplitPane.tsx` — native resizable split (a11y separator, ≥20% clamp, localStorage persist)

Backend (`packages/backend/convex/`):
- `cockpit.ts` — orchestration seam: `cockpitAgent` (message store), `sendCockpitMessage` (3.2.1: the THIN DRIVER over the agent loop — ensure thread + plans row → save user turn → `internal.llm.runCockpitAgent` in try/catch → save the assistant reply; a caught throw is a non-dead-ending error turn, a `blocked` governed stop returns AS the paused reply), `resolveRecipients` (folds a contact card pick via `applyRecipientEdit`, then RE-ENTERS `runCockpitAgent` so the agent auto-continues — a pick is an agent turn, never a dead hang), `proposeEmailPlan` (code-invoked PLAN write, NOT a tool), `executePlan` (the human approve gate — 3.4 CKPT-03: its per-recipient seed loop reads `draft: (plan.recipientBodies ?? {})[recipient] ?? body` so each recipient's request carries its DISTINCT tailored body under the SHARED subject; the ONE line changed — CAS/Gmail-pre-check/per-recipient correlationId/single `workflow.start` untouched; 3.5 SCHD-01: the `workflow.start(deliverApprovedPlan)` block is extracted into the module-level `startFanout(ctx, {...})` — the SOLE call site, shared by the immediate branch AND the scheduled callback — and `executePlan` branches to `ctx.scheduler.runAt(startScheduledDelivery)` + status `scheduled` on a future `sendAt`), `startScheduledDelivery` (3.5 internalMutation — fires the SAME frozen `startFanout` at the requested moment; awaiting_reauth/DLQ/telemetry inherited free), `cancelScheduledPlan` (3.5 tenantMutation — CAS-guarded `scheduler.cancel` on `status==='scheduled'` → `canceled` + one refs-only `plan.canceled` audit; idempotent + tenant-guarded), `listThreadMessages`. The deterministic FSM glue (`parseAnswer`/`toIntentState`/`advance`/`questionText`/inline resolve-turn) is DELETED (3.2.1 cutover — no dual engine)
- `plans.ts` — content-plane adapter: `insertPlan` / `patchPlan` / `setPlanStatus` / `getById` (internal), `byThread`, `reportForPlan` (live REPORT projection); 3.2: `writeCandidates` / `clearCandidates` — the TRANSIENT contact-candidate store (`candidates` / `pendingValid` / `greetingName`, all optional plan fields). `getById` (3.2.1) is the by-id reader the `llm.ts` tool set uses (the node action has no `ctx.db`; `byThread` needs identity+threadId). 3.3 (CKPT-02): `recordAttachments` (internal — the single content-plane write surface for the `plans.attachments` array + the transient `attachmentError` marker, sets/clears the error directly) + `attachmentUrls` (tenantQuery — the FIRST `storage.getUrl`, tenant-guarded signed download URLs for the PLAN card); `reportForPlan` rows now also carry per-recipient `attachments: [{filename, url}]` resolved from each `requests.attachmentRefs` (re-download of the exact sent bytes — storage is immutable per id). 3.4 (CKPT-03): `patchPlan` gains an optional `recipientBodies` arg (address-keyed `v.record` map — per-recipient body override, no migration) written via the same drop-undefined patch; content-plane only, NEVER audited (§4). The `personalizeRecipient` tool passes the full merged map through this same arg (03.4-02); `executePlan` seeds each `requests.draft` as `recipientBodies[recipient] ?? body` (03.4-03). See the personalization invariants below (03.4-04 phase close). 3.5 (SCHD-01): `setPlanSendTime` (tenantMutation — the PLAN-card `datetime-local` picker's tenant-guarded writer, `patch {sendAt}`; undefined CLEARS → immediate; no NL past-guard, the picker is the confirm source-of-truth), and `patchPlan` gained an optional `sendAt` arg written through the same drop-undefined patch; `sendAt`/`scheduledFunctionId` are the deferred-send source of truth on the plan row, NEVER audited (§4)
- `briefings.ts` — 3.7 (CKPT-04): the briefing content-plane adapter, mirroring `plans.ts` including its most important property — it writes NO log-plane row (raw senders/gists live in the row and never reach an audit/DLQ payload, §4; the acting modules write the refs+counts audit). `insert` (internal, append-only — a re-brief inserts a NEW row and `byThread` reads the latest; `items` arrive already joined by `@pikar/core`'s `joinDigest`, so id/sender/subject/ts/bucket are code-owned facts, never model output, ADR-004; its `ITEMS` validator is **DERIVED** from `schema.tables.briefings.validator.fields.items` — it used to be a hand-copied duplicate and it drifted the moment `id`/`subject` were added to the schema, rejecting valid rows at runtime with "Unexpected field `id`", so do NOT re-inline it) + `byThread` (tenantQuery feeding the live BRIEFING card — `by_thread` index `.order("desc").first()`, index order IS recency)
- `agentSteps.ts` — 3.9 (CKPT-05): the activity-trace content plane (append-only step rows; **writes no log-plane row** — the `briefings.ts` property: the trace is UI state, not an audit trail, and the agent's refs-only audit already exists, so a second less-governed shadow log here would be a §4 regression with no requirement behind it). `record`/`finish` (internal — `finish` is terminal on BOTH success and error, and an unmatched `(tenantId, turnId, stepKey)` is a NO-OP rather than a throw: the SDK swallows callback exceptions, so a throw would fail SILENTLY in production while every unit test passed) + `latestTurn` (tenantQuery, **NO threadId arg** — on the first message the browser has no threadId until `sendCockpitMessage` RESOLVES, i.e. until the wait is already over, so a `byThread`-only read would be `"skip"` for the entire first turn and blank at exactly the moment a first-time user decides the product is broken; the client filters on the returned threadId instead). Its `TOOL` validator is **DERIVED** from `schema.tables.agentSteps.validator.fields.tool` (the `briefings.ts` `ITEMS` lesson — a hand-copied union drifts, and a drifted literal here means a SILENTLY swallowed insert). Reads are bounded (`.take(12)` against `stopWhen: stepCountIs(8)`'s ≤9 rows/turn) — never `.collect()`
- `deliverApprovedPlan.ts` — the sole delivery workflow; per-recipient fan-out with try/catch isolation
- `llm.ts` (the SOLE `"use node"` module) → `runCockpitAgent` (3.2.1 — the LIVE conversation engine: `preCall` gate BEFORE the loop → `cockpit-agent` skill body as `system` → `buildAgentContext` + user text → `generateText({tools, stopWhen: stepCountIs(8)})` → `priceUsage`→`recordSpend`; `CHEAP_MODEL` fallback via the shared `runAgentLoop`; `SMOKE::agent::<op>` offline path) + `buildCockpitTools` (the governed Executive-Agent tool set — 3.4 CKPT-03 adds `personalizeRecipient({index, instructions})`: resolves a 1-based `#index` server-side, `scanText` fail-closed → `draftCockpit` (omitting `greetingName` — Pitfall 4), writes the tailored body to `recipientBodies[address]` never the shared `body`; `proposePlan` refuses a group plan that carries any tailoring) + `buildAgentContext` (index+label, address-free recipient view §2-D — 3.4 annotates each recipient `— personalized`/`— shared body` by `#index`) + `draftCockpit` (loads the `email-drafter` skill; `SMOKE::` offline short-circuit; optional `greetingName` arg — resolved display name ONLY, never a header hint) + `__invokeCockpitTool` / `__runCockpitAgentWithScript` (test-only shims). The tools wrap `gmail.search` / `applyRecipientEdit` / `scanText`→`draftCockpit` / `proposeEmailPlan` — each preserving that primitive's governance
- `packages/contracts/skills/cockpit-agent.md` + `packages/contracts/src/skills/cockpitAgent.ts` — the Executive-Agent tool-loop system prompt (seeded as the `cockpit-agent` skill row; body loaded at runtime as `system`, never hardcoded §5); watch-protected under the skill-registry playbook
- `gmail.ts` (`"use node"`) — `send` (delivery) and 3.2's `search` (headers-only inbox read: `messages.list` + `format=metadata`, bodies never fetched); both share the single `freshAccessToken` refresh root. 3.7 (CKPT-04) adds the briefing READ PLANE, GET-only: `listInbox({tenantId, correlationId, range, maxResults?})` → `{ok:true, messages: InboxMessageMeta[], fixture}` | `{ok:false, reason}` — capped at `INBOX_LIST_CAP` (50) over `in:inbox newer_than:7d` (a RELATIVE operator: `after:`/`before:` take calendar dates whose meaning is timezone-ambiguous, and `@pikar/core`'s pure `bucket()` owns the real window anyway, so over-fetching is harmless), per-id `format=metadata` gets riding the top-level `snippet`/`internalDate`/`labelIds` (`Number()` the internalDate — the API returns a STRING int64; `labelIds.includes("UNREAD")` is the unread flag for free), one refs-only `mailbox.listed` audit; and `fetchInboxBodies({tenantId, ids})` → `format=full` for the digest-SELECTED few only, extracting via the exported pure `pickPlainText(payload)` (recursive `parts` walk → first `text/plain` leaf → `Buffer.from(data, "base64url")` — url-safe, NOT standard base64) with a snippet fallback when a message has no text/plain leaf (HTML-only newsletters), every body truncated to `BODY_TRUNCATE_CHARS`. We NEVER parse HTML (a tag-stripper is a tarpit; the snippet is Google's own plain-text gist). Both check the `inboxFixtures` seam BEFORE the token. 3.3 (CKPT-02): `buildMime` gained an optional `attachments` param — zero → the EXACT legacy plain-text string (byte-identical, V4), one+ → `multipart/mixed` (`=_pikar_<hex>` boundary, base64 text part + one `application/pdf` part per attachment wrapped 76, mandatory closing `--boundary--`; inner parts STANDARD base64, only the whole raw message is base64url via `base64Url()`); `send` loads each resolved attachment's bytes via `ctx.storage.get(storageId)` (a missing blob THROWS → retrier → DLQ, never a silent send without the promised attachment) and the `gmail.sent` audit stays refs-only (`{requestId, messageId}` — never bytes/base64/URL, §4)
- `gmailAuth.ts` + `http.ts` `/gmail/callback` — the one-consent `gmail.modify` OAuth flow (state-token mint/verify, token store); callback bounces the browser back to the app, never dead-ends on the Convex site origin. 3.3: `getForDelivery` resolves `requests.attachmentRefs` → `[{filename, mimeType, storageId}]` (dangling refs dropped) alongside the existing delivery fields. 22.1: `deleteTokens` (internalMutation — the ONLY `gmailTokens` delete outside `store`'s reconnect replace) and `disconnectGoogle` (tenantAction: `getTokens` → POST `oauth2.googleapis.com/revoke` with the REFRESH token → `deleteTokens` → one refs-only `google.disconnected` audit row, `actor:"user"`, payload `{revoked,status}` and nothing else). Scope comes from the caller's identity — it can only ever revoke the caller's own grant, never an arg-supplied tenantId. The revoke lives HERE and not in `gmail.ts` because `llmRedaction.test.ts` pins that module's POST set to two
- `schema.ts` — `plans` table (`by_thread`), `requests.planId` + `by_plan` index; 3.7: `briefings` table (`by_thread`, append-only per thread — raw mailbox content lives HERE, never in a log-plane payload §4; `items[]` carries the code-owned `id`/`bucket`/`sender`/`subject`/`ts` + the model-owned `gist`/`category`/`needsReply`/`deadline?` — `id`/`subject` are REQUIRED, so adding them meant clearing the dev table on push) + `inboxFixtures` (the no-Gmail-token test seam — written ONLY by `smoke.seedInboxFixture`, so the live path and the fixture path are mutually unreachable)

Frontend prerequisite: `apps/web/app/(app)/connect-gmail/page.tsx` — the consent entry page (cockpit composer is gated on `gmailStatus`). 22.1: it also carries the **Disconnect Google** control, inside the connected panel — deliberately NOT a new `/dashboard/connections` route or NAV entry, which would be an aggregator over a single item; the page arrives when a second provider does (Phase 25). The confirm copy names CALENDAR explicitly (one grant covers mail and calendar) and warns that scheduled sends will be held — omit either and the control is a second false promise. `window.confirm` is deliberate: BRAND defines no dialog pattern and the app had no `confirm(` call anywhere. The panel flips on its own because `gmailStatus` is a live subscription on the deleted row — no refetch, no optimistic state. Hardcoded hexes on this page became `globals.css` tokens in the same pass, EXCEPT the error panel's reds: BRAND defines no error token (amber is reserved for the approval gate alone) and `globals.css` hardcodes `#dc2626` for the DLQ badge on identical reasoning — minting `--danger` was out of scope.

Pure core: `packages/core/src/emailIntent.ts` — 3.2.1: slimmed to the SURVIVING pure validators only (the `applyAnswer`/`nextQuestion` FSM state machine is DELETED): `isValidEmail`, `parseAddress`, `rankCandidates` (mailbox-header ranking — NAME-match first, drops thread-noise), the `ContactMatch`/`NameCandidates`/`HeaderRecord` types, and the recipient tool-internals `buildRecipientView` (index+label, address-free) + `applyRecipientEdit` (add/remove/set with validation bounce) that the Executive-Agent tools drive. 3.5 (SCHD-01): the PURE `parseSendTime(text, nowMs, ianaTz)` → `{kind:"resolved"; epochMs} | "ambiguous" | "past" | "none"` — the client injects the trusted clock+zone (§2-D, the model never supplies "now"), zone wall-clock↔epoch via `Intl.DateTimeFormat` (no `Date.now`, no dependency); ambiguous/past re-ask, resolved stores ONE absolute epoch ms. These live here (a sibling file would escape this playbook's watch).

`packages/core/src/briefing.ts` — 3.7 (CKPT-04): the pure inbox-briefing domain logic, watch-registered as its own entry (it is a distinct subsystem, not a validator, so it earns a file). `dayKey`/`bucket(msgTsMs, nowMs, tz)` group a message into `today`/`yesterday`/`thisWeek` (else `null` — outside the 7-day window) from Gmail's `internalDate` + the client's IANA zone; **the model never assigns a bucket, sender or timestamp** (ADR-004 / SC-1 — they are structural facts the code already holds). Yesterday is derived by UTC math on today's day-key (`previousDayKey`), NOT `dayKey(now - 86400000)`: the day after a spring-forward is 23 local hours long, so the naive form is off by a calendar day (regression-pinned at LA 2026-03-09). `selectForDigest(messages, cap = BRIEFING_BODY_CAP)` is the recency-first, non-mutating cap for full-body fetch (25; snippet-only long tail — SC-3), and `joinDigest(selected, items, nowMs, tz)` welds the toolless digest's index-keyed `{index, gist, category, needsReply, deadline?}` rows onto the code-owned `id`/`sender`/`subject`/`ts`/`bucket`: an out-of-range, non-integer or duplicate index has no real message behind it and is **dropped**, so the model cannot invent a briefing row. **`id` (the Gmail message id) is the row's IDENTITY** — the card keys on it, because `${ts}-${sender}` collided in production (one automated sender, two messages, same `internalDate` ms) — and **`subject` is the row's heading**; both are Gmail-header facts the code already held, so welding them widens the model's surface by NOTHING (it still owns only gist/category/needsReply/deadline). Never let either become model-owned: a fabricated subject would render as a header fact, and a fabricated id would collapse two rows. `subject` may legitimately be `""` — the CARD owns the "(no subject)" fallback, not the join. Same clock/zone contract as `parseSendTime` (client-injected `nowMs` + tz, §2-D), zero dependencies — `Intl.DateTimeFormat` is the whole date library.

Tests: `packages/backend/convex/cockpit.test.ts`, `packages/core/src/emailIntent.test.ts`,
`packages/core/src/briefing.test.ts` (3.7 — fixed-clock bucketing east/west of UTC, the local-midnight boundary in both directions, month/year rollover, the DST spring-forward regression, cap selection, the index-join drops, and the 03.7-05 KEY-COLLISION regression: two messages from the same sender at the same ms must yield DISTINCT `id`s — it asserts BOTH halves of the old `${ts}-${sender}` key are equal, which is the proof the old key could not work),
`packages/backend/convex/briefings.test.ts` (3.7 — content-plane insert/read, latest-wins `byThread`, tenant guard),
`packages/backend/convex/cockpitTools.test.ts` (per-tool governance),
`packages/backend/convex/runCockpitAgent.test.ts` (mock-model loop),
`packages/backend/convex/plans.test.ts` (3.3 — store→getUrl round-trip + tenant guard + reportForPlan attachment extension),
`packages/backend/convex/llmRedaction.test.ts`, `apps/web/e2e/cockpit-report.spec.ts`,
`apps/web/e2e/cockpit-resolve.spec.ts`, `apps/web/e2e/cockpit-attachment.spec.ts` (3.3 — the CKPT-02 attachment flow + remove variant, V9), `apps/web/e2e/cockpit-personalize.spec.ts` (3.4 — the CKPT-03 per-recipient flow: 2 recipients → personalize #1 → PLAN card 2 distinct bodies → Approve → REPORT), `apps/web/e2e/cockpit-schedule.spec.ts` (3.5 SCHD-01 — sendTime resolves the abs time → picker future time → Approve → ScheduledCard → Cancel → Canceled, plus the no-time immediate default), `apps/web/e2e/cockpit-briefing.spec.ts` (3.7 CKPT-04 — seeded fixture inbox → `SMOKE::agent::brief=today` → grouped BRIEFING card + Needs-you-is-suggestions-only + the counts-only reply; zero model calls, zero Gmail traffic), `apps/web/e2e/cockpit-activity.spec.ts` (3.9 CKPT-05 — the activity trace's UI half: `SMOKE::agent::brief=today` → LATEST TRACE card + Thought-Process bubble, both off one query, carrying zero mail needles. **It is the regression test for the SMOKE-site emission** — `runCockpitAgent` short-circuits `SMOKE::` past `generateText`, so no SDK callback fires and every offline E2E in this repo drives that path; remove the smoke-site emission and ONLY this spec goes red. It proves steps RENDER — it CANNOT prove they render progressively during a wait, because a SMOKE turn is instant; that is the human-verify's job, and `runCockpitAgent.test.ts` is the load-bearing automated proof the emitter fires), `apps/web/e2e/connect-gmail.spec.ts`,
`apps/web/e2e/cockpit-render.spec.ts`, `apps/web/e2e/cockpit-split.spec.ts`,
`packages/backend/scripts/run-smoke-fanout.mjs` (3.3 — carries a shared attachment, V6; 3.4 — `assertFanoutBodiesDistinct` proves DISTINCT per-recipient bodies under a shared subject + no tailored body in any log plane),
`packages/backend/scripts/run-smoke-guardrails.mjs` (3.3 — generation pauses under a governed stop, V8).

## Dependencies & blast radius

`graphify query "cockpit"` for the subgraph (note: it centers on `cockpit.ts`; the plan
row and delivery workflow live in `plans.ts`/`deliverApprovedPlan.ts` — include them
when assessing blast radius). Couplings graphify cannot see:
- `cockpit-agent` (reasoning loop, §5 fail-closed unseeded) + `email-drafter` (body draft) skill rows must be seeded (see skill-registry playbook)
- Gmail token via `gmailAuth.getTokens`; no token → `gmail_not_connected` refusal
- **LLM transport = DIRECT OpenAI (2026-07-13, no Vercel gateway).** `llm.ts` `resolveModel(id)` maps each model id (`openai/gpt-4o-mini`…) to `openai(bareName)` via `@ai-sdk/openai@4.0.11` (matches `ai@7.0.20`'s `@ai-sdk/provider@4.0.3` exactly — no churn), reading **`OPENAI_API_KEY`** from the deployment env. The Vercel gateway was dropped: its BYOK is gated behind paid Vercel credits = a double charge over the OpenAI key already paid for. `OPENAI_API_KEY` absent (or `$0` credit) ⇒ only the `SMOKE::agent::`/`SMOKE::` sentinel paths work (the E2E mode); REAL conversational reasoning (every turn is an LLM call, the agent loop several) needs a funded OpenAI key. Verified live via `npx convex run llm:draftCockpit` returning a real (non-SMOKE) gpt-4o-mini draft. See memory `llm-use-vercel-ai-gateway`.
- Pinned components: `@convex-dev/agent@0.6.4` (in BOTH `packages/backend` and `apps/web`), `@convex-dev/workflow@0.4.4` — do not bump (CLAUDE.md §6; the agent's `languageModel` is an inert cast past an AI SDK version guard and breaks on bump)

## Data flow

1. ChatPane → `sendCockpitMessage`. First turn mints a `threadId` (`cockpitAgent.createThread`) and inserts ONE `plans` row at status `collecting`; threadId returns → page state → shared with CardList.
2. Each turn (`sendCockpitMessage`, the thin driver): save the user turn to the thread → mint a server-side `turnId` (`crypto.randomUUID`) and record the `thinking` `agentSteps` row (CKPT-05, 03.9-02) → `internal.llm.runCockpitAgent({tenantId, threadId, planId, text, turnId})` in a try/catch → save the returned reply as the assistant turn. A caught throw → a fixed "nothing was sent, try again" error turn (non-dead-ending; the partial plan row stays valid). The `thinking` row is terminalized in a **`finally`** — the only construct covering all three exits: success, the caught throw, and the governed stop, which returns as DATA and never enters the `catch`. `resolveRecipients` (step 3a) carries the identical lifecycle for its own turn.
3. `runCockpitAgent` (one turn): `guardrails.preCall` gates BEFORE the loop (a governed kill-switch/budget stop returns a conversational "paused" reply as DATA — never a throw/DLQ) → loads the `cockpit-agent` skill body as `system` (fails closed unseeded, §5) → feeds `buildAgentContext(plan)` (index+label recipient view, address-free §2-D) + the user text to `generateText({model, system, tools: buildCockpitTools(...), stopWhen: stepCountIs(8)})` → the model calls zero+ governed tools that mutate the `plans` row (`resolveContacts`/add·remove·set recipients/`setSubject`/`setMode`/`draftBody`/`proposePlan`) → `priceUsage`→`recordSpend` → returns the assistant reply. The loop ALSO passes `onToolExecutionStart`/`onToolExecutionEnd` to `generateText`, which write one `agentSteps` row per tool call (CKPT-05, 03.9-02) — **name + phase ONLY**, never the event's `messages` (the full model context) or `toolOutput.output` (`listInbox`'s return carries SUBJECTS). Zero tool wrappers were edited: `ai@7` emits these natively. The offline `SMOKE::agent::*` short-circuit never calls `generateText`, so it emits its own step row around its ONE call site in `runCockpitAgent` (never inside `invokeTool` — that seam is shared with the unit-test shims); otherwise every offline E2E would assert on an empty activity surface.
3a. **Contact resolution**: when the model calls `resolveContacts(name)`, the tool runs `gmail.search`→`rankCandidates`→`writeCandidates` (headers-only; one refs-only `mailbox.searched` audit) and returns display-name LABELS only. `rankCandidates` ranks NAME-matches first and DROPS thread-noise: Gmail search matches the name anywhere in a thread, so the raw records include correspondents merely CC'd alongside the person (a "Sarah" search surfaced `joel.feruzi`/`pdfFiller`); candidates whose display-name/address contain the search name are shown alone when any exist, else it falls back to the frequency ranking (never empty). The candidates park on the plan row → `ResolutionCard` renders → the human picks one or MORE chips (multi-select, checkbox-style — a noisy search may hold several people the user wants) → `resolveRecipients` folds held `pendingValid` + ALL picked addresses via `applyRecipientEdit`, captures `greetingName` from pick #1, `clearCandidates` wipes on pick, then re-enters `runCockpitAgent` with a continuation prompt so the agent auto-continues from the updated row (a pick is an agent turn — it never dead-ends on a blank workspace).
4. `draftBody` runs `scanText(bodyIntent)` (fail-closed redaction) BEFORE `draftCockpit` (the drafting sub-call). `proposePlan` → `proposeEmailPlan` reads recipients/subject/mode/body from the ROW (never model args) → flips plan → `proposed`.
5. CardList reactively (`api.plans.byThread`) shows PlanCard + DraftCard. The activity trace's own reactive read is `api.agentSteps.latestTurn` — each step row committed mid-turn by the running action pushes to live subscribers immediately (an action is not a transaction; that non-transactionality IS the feature). Two surfaces render it off that ONE query — `cards.tsx`'s `ActivityCard` on the canvas and `ChatPane`'s in-progress bubble — so the canvas and the chat can never disagree about what the agent is doing (03.9-03).
6. Approve → `executePlan`: CAS on `proposed` only; Gmail-token check; seeds one `requests` row per recipient (individual) or one comma-joined row (group), each with its own server-minted `correlationId` and shared `planId`; starts `deliverApprovedPlan` with `onComplete: onPipelineComplete`; plan → `delivering`.
7. `deliverApprovedPlan` loops rows: `gmail.send` (workpool retries) → `sent` + terminal telemetry; no token → held `awaiting_reauth`; throw → `deadLetterRecipient` for that row only, loop continues. Then plan → `done`.
8. REPORT: `reportForPlan` is a pure live projection over `requests` (`by_plan`) joined to `gmail.sent` audit rows — nothing stores a report array.

## Invariants — what must never break

- **Shared threadId contract**: page owns `threadId`; ChatPane lifts it via `onThread`; both panes receive it. Break the lift and cards desync from the conversation. Enforced only by E2E (`cockpit-report.spec.ts`) — no unit test.
- **The reasoning loop is governed, not free (3.2.1)**: every turn runs `runCockpitAgent`, and the rails bound it — `guardrails.preCall` gates BEFORE `generateText` (a governed kill-switch/budget stop returns a conversational "paused" reply as DATA, NEVER a throw/DLQ), `stopWhen: stepCountIs(8)` caps the loop (ceiling without a proposal → the agent asks rather than looping), `recordSpend` prices every call, and an `isFallbackEligible` failure retries once on `CHEAP_MODEL`. A loop exception is caught in `sendCockpitMessage` → a non-dead-ending assistant error turn (nothing sent, partial plan valid). Tested offline in `runCockpitAgent.test.ts` via the `__runCockpitAgentWithScript` mock-model shim.
- **`executePlan` is a human gate, not an LLM tool.** Idempotent CAS: only `proposed → approved` proceeds; double-approve is a no-op. Tested in `cockpit.test.ts` (SC4).
- **Zero sends before Approve**: `gmail.send` is called only inside `deliverApprovedPlan`, which is started only by `executePlan`. Tested in `cockpit.test.ts`.
- **A disconnect revokes at Google BEFORE it deletes locally, and deletes locally even if the revoke fails (22.1).** Both halves, in that order. Delete-only leaves the grant live on the user's Google account and makes `privacy/page.tsx:312` a false published claim — the defect this closed. Revoke-only leaves the crown-jewel refresh token at rest in a DB where nothing honours it. The revoke targets the REFRESH token (kills the whole grant), and a 400 is success, not failure. Tested in `calendar.test.ts`, mutation-verified.
- **Tenant erasure is revoke-then-delete, with provider truth kept separate (22.1-05).** The owner-gated deletion action calls `disconnectGoogle` and `disconnectMicrosoft` before its registry-driven deletion pages. It maps the actual returns rather than averaging them: Google can report `revokedAtProvider:true`; Microsoft reports its shipped `false`. A thrown/failed provider attempt becomes a boolean failure result and never blocks local credential or tenant-data erasure. Results and the completion audit contain only provider flags, a tenant-id hash, table names, and counts — never tokens or user content. Tested in `tenantDelete.test.ts` with success and throwing-revocation cases.
- **The review gate is bounded and fails closed (REVW-02, 07-04)**: `proposeEmailPlan` counts each redraft on `plans.reviseCount` via `@pikar/core classifyReviewDecision` (the SAME classifier the pipeline gate uses — never fork it); past `MAX_REGENERATE`(=3) it sets `plans.escalated` + notifies `retry.limit` and STOPS re-proposing. `executePlan` then refuses an escalated plan (`{ ok: false, reason: "review_escalated" }`) as an early guard before the CAS flip — an escalated plan is a terminal that can never be sent. A raw regenerate compare that inlines `3` or lets a past-cap redraft re-propose reintroduces the unbounded/unapproved-send bug. Tested in `cockpit.test.ts`.
- **Per-recipient correlationId**, server-minted, never client-supplied — a shared cid collapses audit/telemetry/DLQ isolation (telemetry is write-once per cid). Exercised by `smoke:fanout`.
- **Redaction (CLAUDE.md §4)**: recipients/subject/body live only in content-plane `plans`/`requests`; audit/DLQ/telemetry payloads carry refs only. Enforced statically by `llmRedaction.test.ts`; at runtime by `assertNoRawPiiFanout` in `smoke:fanout`.
- **The step row has no free-text field (3.9, CKPT-05)**: §4 on the activity-trace path is enforced by schema ABSENCE, not vigilance — display verbs are a code-owned map in the UI keyed off the closed `tool` union, which a model cannot widen (the name in the SDK's event is a key of OUR `tools` record; `ai` throws `NoSuchToolError` before `execute` on a hallucinated one). Do NOT "helpfully" add a `label`/`text`/`detail`/`result` field: the tool events carry `messages[]` and `toolOutput.output`, so a text field turns one careless spread into a mail-content leak, and `count: v.number()` literally cannot hold a subject line. Enforced by the static scan in `llmRedaction.test.ts` (Plan 02).
- **No NEW `"use node"` modules**: `draftCockpit` stays inside `llm.ts`, `search` stays inside `gmail.ts` (the two pre-existing node modules); adding another re-triggers a TS circular-inference cliff (see `03.1-RESEARCH*.md` §6; Convex guidelines §96).
- **Contacts are transient (3.2)**: `candidates`/`pendingValid` are held on the plan row only between search and pick — `clearCandidates` unsets BOTH on pick ("no contacts cache at rest" is structural); `greetingName` alone survives to the draft turn. Candidate payloads live on the content plane only and are NEVER audited (CLAUDE.md §4); the sole search audit is refs-only `mailbox.searched {queryHash, resultCount}`.
- **Contact resolution is ADDITIVE (3.4 gap-closure)**: `resolveContacts` searches ONE name per call, but the agent resolves EACH named person in a multi-name turn ("Sarah and Zach") with its own call — so `writeCandidates` UPSERTS by name (a re-search of the same name replaces just that name's matches; other parked names are preserved) and UNIONS `pendingValid`, never a wholesale replace. A wholesale patch let the second search obliterate the first → one name silently dropped from the `ResolutionCard` while the agent's reply claimed both (the agent↔workspace disconnect surfaced in the 3.4 human-verify). Tested in `cockpitTools.test.ts` (two names in one turn both survive; same-name re-search stays a single section).
- **Recipients can't be silently wiped, and no zero-recipient plan is proposed (3.2.1)**: `applyRecipientEdit` treats a `set` that yields ZERO recipients as a rejection (keeps the current list) — an empty/garbage `setRecipients([])` from the model can no longer clear resolved contacts. And `proposePlan` refuses when recipients (or subject/body) are missing, returning what's absent so the agent re-resolves/re-asks — a plan with no recipients never reaches the PLAN card. Tested in `emailIntent.test.ts` (empty-set bounce) and `cockpitTools.test.ts` (setRecipients no-wipe + proposePlan refusal). This closed the "recipients disappeared after I picked them, then it drafted with none" bug.
- **Inbox reads are headers-only (3.2)**: `gmail.search` fetches `format=metadata` (From/To/Cc/Subject/Date) — message bodies never leave Gmail; read-time auth failure returns `{ok:false, reason}` WITHOUT throwing (a dead token is a reauth prompt, not a DLQ entry).
- **The mailbox is READ-ONLY by construction (3.7, CKPT-04/SC-3)**: the granted `gmail.modify` scope is never exercised for a write. `gmail.ts` contains NO `/modify`, `/trash`, `/untrash`, `/batchModify` or `/labels` endpoint, and the ONLY two `method: "POST"` fetches in the module are `TOKEN_ENDPOINT` (the refresh) and `SEND_ENDPOINT` (the governed, post-Approve send) — every mailbox READ is a GET. Enforced statically by `llmRedaction.test.ts` (an endpoint-substring scan + an exact POST-target/count match), so a future "just mark it read" has to defeat a test to land. Label/archive/mark-read are a NEW governance surface, deliberately out of scope.
- **`listInbox` audits refs-only, and a failed list audits nothing (3.7, SC-3)**: exactly ONE `mailbox.listed` event per successful list, payload `{range, resultCount}` — the `range` is a caller-supplied enum LITERAL from the tool's `inputSchema` (never user prose), and a sender/subject/snippet in that payload would make the audit the PII honeypot §4 exists to prevent. A `not_connected`/`reauth` list writes NO event: nothing was read. Enforced statically (payload-regex, `llmRedaction.test.ts`) and at runtime (`gmail.test.ts` asserts the exact payload key set + the zero-audit failure path).
- **Snippet-first: bodies are fetched only for the digest-selected few (3.7)**: `listInbox` never fetches a body (`format=metadata`); `fetchInboxBodies` is the ONLY `format=full` call site and the caller caps its `ids` at `@pikar/core`'s `BRIEFING_BODY_CAP` (25) with each body truncated to `BODY_TRUNCATE_CHARS` (2000). This bounds the GDPR surface, the cost, AND the digest's eval-cost-cap blind spot (research Pitfall 5). Fetching bodies for everything listed is a locked-decision violation, not an optimization.
- **The fixture seam is checked BEFORE the token, and is internal-only (3.7)**: `listInbox`/`fetchInboxBodies` read `inboxFixtures` first, so a seeded tenant needs no Gmail token — this is what lets the offline E2E and the eval INJECTION PROBE run at all (the eval tenant has no mailbox, and the runner structurally rejects `SMOKE::` turns, so the malicious mail cannot ride the turn text — research Pitfall 3). Order matters: check the token first and a fixture tenant dead-ends at `not_connected` while silently "passing". `smoke.seedInboxFixture` is the ONLY writer and it is an internalMutation, so a real tenant can never have a row and the two paths are mutually unreachable. Both the ordering and the seam are statically asserted in `llmRedaction.test.ts`.
- **The search audit lives in `gmail.ts` (3.2)**: the sole `mailbox.searched` write is emitted by `gmail.search` itself (refs-only `{queryHash, resultCount}`, SC3) so `cockpit.ts` stays `audit.log`-free — the orchestration seam never touches the audit plane, and there is exactly one audit per search.
- **The drafter gets the display name ONLY (3.2, SC3)**: `draftCockpit`'s single mailbox-derived arg is `greetingName`; header hints (`lastSubject`/`lastDateMs`/`count`/raw `matches`) MUST NOT reach the LLM. Enforced statically by `llmRedaction.test.ts` (a scoped scan of the `draftCockpit` code surface).
- **The tools ARE the enforcement boundary — structural facts are never model-invented (3.2.1)**: `buildCockpitTools` never trusts a structural fact from the model. An invalid address bounces in `applyRecipientEdit` and never enters `recipients` (the tool does NOT patch on a bounce); a named person routes through `resolveContacts` (real `gmail.search` match), never a hallucinated address; `removeRecipient` takes a 1-based `#index` ONLY and resolves the address server-side; `draftBody` runs `scanText` (fail-closed) BEFORE `draftCockpit`; `personalizeRecipient` (3.4) likewise resolves a 1-based `#index` server-side and runs `scanText` fail-closed BEFORE `draftCockpit`, writing the tailored body to `recipientBodies[address]` (never the shared `body`) and refusing to propose a group plan that carries any tailoring; `proposePlan` reads recipients/subject/mode/body/recipientBodies from the ROW, never from model args. Enforced by `cockpitTools.test.ts` (per-tool) + `llmRedaction.test.ts` (redact-before-draft scan + recipientBodies-never-logged).
- **The model never sees a raw address (§2-D, 3.2.1)**: `buildAgentContext` emits the `buildRecipientView` index+label view (`#1: Bob`); addresses live in the `plans` row and are substituted server-side inside the tools. Display *names* reach the model (already accepted for greeting personalization); raw addresses never do. Enforced statically by `llmRedaction.test.ts` (index/label context scan).
- **The agent's view of the shared plan is COMPLETE (3.4 gap-closure)**: `buildAgentContext` surfaces a resolution-in-progress — the searched NAMES awaiting the user's card pick (NAME + count ONLY, never a candidate address or hint, §2-D/§4) — with an explicit instruction not to claim those names were added. The model's prompt is `buildHistoryBlock(history) + buildAgentContext(plan) + user text` (03.10-06 — the history block is a bounded last-10 plain-text transcript window, UAT-E; the plan ROW remains the authoritative structural state between agent and workspace); omitting pending candidates let the agent claim "already added" while the `ResolutionCard` showed otherwise (its reply is saved unconditionally, no reconciliation). `PlanRow` deliberately does NOT re-declare the candidate `matches` shape (it would trip the `draftCockpit` header-hint scan) — `getById` returns the full row at runtime and `buildAgentContext`'s own param is the model-facing contract. Tested in `cockpitTools.test.ts` (pending name + count surfaced, never an address/displayName).
- **A signed attachment URL is a bearer capability (3.3, CKPT-02)**: `storage.getUrl` results are returned ONLY from the tenant-guarded `attachmentUrls` / `reportForPlan` queries (both guard the plan/request row on `ctx.tenantId` — a cross-tenant caller gets `[]`, never another tenant's URL) and are NEVER logged (CLAUDE.md §4). `attachments`/`attachmentError` are optional `plans` fields (no migration); `recordAttachments` is the sole content-plane writer. Tested in `plans.test.ts` (store→getUrl round-trip, tenant guard, reportForPlan extension).
- **A generated attachment rides the governed spine, refs-only (3.3, CKPT-02)**: the attachment travels as an `Id<"attachments">` ref — never bytes — through `executePlan` → `deliverApprovedPlan` → `gmail.send`; audit/deadLetters/telemetry carry storageId/filename/size/counts ONLY, never file bytes/base64/URL (§4). ONE generated document set is materialized once and the SAME ref fans to every recipient (no per-recipient duplication; storage is immutable per id). Exercised live by `smoke:fanout` (`assertFanoutAttachmentShared` + the PDF-byte/base64 needles in `assertNoRawPiiFanout`) — convex-test cannot run the workflow component.
- **Block on render-fail / over-cap — never a partial or oversize send (3.3, V7)**: a `markdownToPdf` throw OR a summed-attachments total over `PLAN_ATTACHMENT_CAP_BYTES` (8 MiB) sets `attachmentError` via `recordAttachments` and adds NO ref; `proposePlan` refuses while `attachmentError` is set OR the cap is exceeded (facts from the ROW). The plan stays unapprovable until the attachment is regenerated/removed. Tested in `cockpitTools.test.ts` (render-fail + over-cap + propose refusal).
- **Generation is governed like any turn — a stop pauses as data (3.3, V8)**: `generateAttachment`/`regenerate` run inside the `runCockpitAgent` loop, so `guardrails.preCall` gates BEFORE the tool runs — a kill-switch/budget stop returns the paused reply with NO attachment stored and NO `deadLetters` row (never a DLQ). Exercised live by `smoke:guardrails` section 7/7 (`assertNoAttachmentStored`).
- **Storage bytes never orphan or dangle on remove/supersede (3.3, O3)**: `regenerateAttachment` persists the NEW ref BEFORE `storage.delete`-ing the OLD id; `removeAttachment` persists the shortened array BEFORE deleting the bytes — a broken ref is worse than a transient orphan. A missing storage blob at send time is a HARD failure (`gmail.send` throws → retrier → DLQ), never a silent send without the promised attachment. Tested in `cockpitTools.test.ts` (regenerate O3, remove).
- **Per-recipient wording rides the existing per-recipient spine (3.4, CKPT-03)**: a tailored body lives in `plans.recipientBodies` (address-keyed, content-plane only, NEVER audited §4); `executePlan` seeds each `requests.draft` as `recipientBodies[recipient] ?? body` (distinct per recipient, SHARED subject/`goal`/`attachmentRefs`) — the delivery spine (`deliverApprovedPlan` / `gmail.send` / `getForDelivery` reading `editedBody ?? draft` per request / the CAS / the single `workflow.start`) is UNCHANGED (it was already per-recipient). This is the exact INVERSE of the 3.3 shared-attachment fan-out (one shared ref to all; here one distinct body each). Proven live by `smoke:fanout` `assertFanoutBodiesDistinct` (every draft unique, one shared subject) + the `TAILORED-SECRET-<i>` needles in `assertNoRawPiiFanout`; unit-tested by the `cockpit.test.ts` distinct-draft case.
- **Personalization requires individual mode (3.4)**: `proposePlan` REFUSES a `group` plan that carries any `recipientBodies` — a group send is ONE combined email, so switching to individual is the user's explicit consent to per-individual sends (the LOCKED decision: refuse, never silently force-individual; facts read from the ROW). The `cockpit-agent` skill teaches SUGGEST-then-confirm + the individual-mode requirement. Tested in `cockpitTools.test.ts` (group-refusal / individual-proceeds).
- **Guardrail parity is by construction (3.4)**: `personalizeRecipient` reuses `draftBody`'s exact `scanText`(fail-closed)→`draftCockpit` path, so PII redaction + the loop's `preCall`/`recordSpend` cost governance are the SAME code — parity is free, not re-implemented. Per-recipient audit/telemetry already isolate each recipient (each `requests` row has its own server-minted `correlationId` → its own `gmail.sent` audit + terminal telemetry); NO new audit event is added. Enforced statically by `llmRedaction.test.ts` (personalize scans BEFORE draft; `recipientBodies` never in a log payload) and live by the CKPT-03 human-verify (audit refs-only).
- **Approve SCHEDULES on a future `sendAt` — nothing sends before fire (3.5, SCHD-01)**: `executePlan` seeds the `requests` rows AT APPROVE (content frozen — "approve once"), then branches: a FUTURE `plan.sendAt` → status `scheduled` + `ctx.scheduler.runAt(sendAt, internal.cockpit.startScheduledDelivery, args)` + stored `scheduledFunctionId` (returns `{ok:true, scheduled:true}`, nothing fans out before fire, SC3); `sendAt` unset OR ≤ now → the immediate synchronous `startFanout` (today's default, byte-identical, SC1). Tested offline in `cockpit.test.ts` via `vi.useFakeTimers()` + `t.finishInProgressScheduledFunctions()` (arm → advance clock → delivering).
- **The single `workflow.start` call site holds via `startFanout` (3.5)**: BOTH the immediate approve branch and `startScheduledDelivery` route through the shared module-level `startFanout(ctx, {...})` helper — exactly ONE real `await workflow.start(deliverApprovedPlan)` in `cockpit.ts`, inside `startFanout` (the naive `git grep -c 'workflow.start('` over-counts the unrelated `requests.ts`/`smoke.ts` workflows; the load-bearing invariant is the single cockpit call site). Adding a second delivery entry path never adds a second call site.
- **Cancel is CAS-guarded and refs-only (3.5, SC4)**: `cancelScheduledPlan` proceeds ONLY on `status==='scheduled'` (a non-scheduled plan returns `{alreadyResolved:true}` — the guard that keeps `ctx.scheduler.cancel` from throwing on an already-fired id), then flips to `canceled` and writes ONE refs-only `plan.canceled` audit (`payload {planId}` ONLY — never subject/body/recipients/sendAt, insert-only §3/§4); idempotent (double-cancel is a no-op) + tenant-guarded (no cross-tenant cancel). Tested in `cockpit.test.ts` (cancel-before-fire: canceled + scheduler row gone + refs-only audit + nothing sent + double-cancel no-op + cross-tenant refused).
- **Fire-time failure is inherited, not re-implemented (3.5, SC4)**: `startScheduledDelivery` starts the SAME `deliverApprovedPlan` as the immediate path, so a dead token at fire → `awaiting_reauth`/DLQ/telemetry is the IDENTICAL immediate-send code — a scheduled send can never silently lose. Proven live by the SCHD-01 human-verify (dead-token-at-fire → awaiting_reauth + reauth notification); fake timers cannot observe a real token expiry at fire.
- **The client's clock is the source of a send time, never the model (3.5, §2-D)**: `setSendTime` parses a volunteered NL time with the TRUSTED client's `nowMs`+`ianaTz` (`@pikar/core parseSendTime`), writes `plan.sendAt` (ONE absolute epoch ms — never a wall-clock string/tz pair) only on `resolved`, and RE-ASKS with no write on `ambiguous`/`past`/`tooFar` (never guess, never silently send). `sendAt`/`scheduledFunctionId`/the raw NL text NEVER reach an audit/DLQ/telemetry payload (setSendTime crosses only into `patchPlan`). Enforced by `cockpitTools.test.ts` + `llmRedaction.test.ts` (two §4 scans).
- **A send beyond the horizon is REFUSED at `executePlan`, the authoritative gate (3.5, SCHD-01)**: a `plan.sendAt` past `Date.now() + SEND_TIME_HORIZON_MS` (default 7d — `@pikar/core`, the Gmail Testing-mode refresh-token life, `design/scheduled-send.md`) returns `{ok:false, reason:"send_time_too_far"}` from `executePlan` BEFORE the seed loop / CAS flip / arm (a sibling early guard to `gmail_not_connected`) — so it holds no matter WHICH write path set `sendAt` (the NL `setSendTime` tool, the picker's `setPlanSendTime`, or Plan 05's reschedule re-approve; the picker `max` and the `parseSendTime` `tooFar` re-ask are only soft complements — the picker's `max` does not block a programmatic write, so the ONE hard guard lives at the chokepoint, not per-caller). Never a silent clamp: a beyond-horizon time is re-asked, never trimmed to the horizon. The horizon is a TUNABLE knob (ponytail) — raise or remove once verified Google OAuth lands (post-Phase-9) and refresh tokens no longer expire on the 7-day clock. Tested in `cockpit.test.ts` (refusal before seed/arm + within-horizon control), `cockpitTools.test.ts` (setSendTime `tooFar` re-ask writes nothing), and `emailIntent.test.ts` (the pure parser's horizon boundary).
- **Workspace card arbitration — the work outranks the brief (3.10, UAT-A)**: the moment a plan enters active composition (candidates parked, or subject/body/recipients set, or status past `collecting`), `PlanCards` demotes the BriefingCard BELOW the plan cards — the ResolutionCard (or whichever plan card is live) is the TOP card of the PlanCards grid, so a stalled pick is visible without scrolling. The demotion is a pure render-side reorder off fields already on the `plan` row (`composing` boolean — never a new field, mutation, or query), and it is demotion, NOT destruction: the brief stays rendered and reachable below the work. The briefing-only flow (plan at `collecting`, nothing set) keeps the brief primary — and NOTHING interactive may be added inside `data-testid="briefing-card"` (SC-4). "Top card" means top of the PlanCards grid — the `<ActivityCard>` trace renders above PlanCards entirely and is not part of this arbitration. Locked offline by the demotion-order test in `cockpit-resolve.spec.ts` (picker precedes the demoted brief in DOM order; brief still attached; zero buttons/links inside it) and by `cockpit-briefing.spec.ts`'s untouched brief-primary assertions.
- **`SMOKE::` sentinel** (`SMOKE::route=<route>::`, parsed in `llm.ts`): deterministic offline draft path used by all E2E; contains no PII and must survive redaction verbatim.
- **Tenant wrappers only** (CLAUDE.md §2): all cockpit functions use `tenantQuery`/`tenantMutation`/`tenantAction`. Enforced by biome + `importGuard.test.ts`.

## Phase 17.1 — standing business-blueprint turn context

This is **SEAM 1 of 2** for BLPR-02. The live cockpit reads
`internal.blueprint.spineForTenant({tenantId})` and prepends the rendered
`<business_blueprint>` block to the **turn prompt** passed to `runAgentLoop`. That makes the
business context present even for a turn such as “draft an email to Bob,” which never needs the
`searchVault` tool.

- `buildTurnPrompt` is the one assembly point: spine → bounded conversation history → plan context
  → `The user says:` as the final line. A `null` spine contributes zero bytes, preserving the
  pre-17.1 prompt exactly.
- This seam is independent of SEAM 2, the later `vaultGroundHydrated.spine` return field consumed by
  evaluations and voice-document review. The blueprint is standing context, not a retrieval hit,
  and it is never inserted into `docIds`/`titles`/`chunks`.
- `system: skill.body` is deliberately unchanged. It remains the versioned `cockpit-agent`
  registry body; tenant-specific context belongs in the turn prompt, not in the skill version.
- The spine read fails open. Missing, deleted, invalid, or cross-tenant blueprint state costs only
  the additive context and never the cockpit turn.
- `cockpitBlueprint.test.ts` drives the real
  `spineForTenant → liveForTenant → renderSpine` chain for a no-tool turn, pins the no-blueprint
  bytes, proves tenant isolation and dangling-pointer behavior, and statically requires production
  plus `__cockpitTurnPrompt` to be the only two `buildTurnPrompt({` call sites.

## How to change safely

- **Changing the agent's conversational behavior**: tune the `cockpit-agent` skill row (registry, §5) — NOT code; rollback = activate a prior version. Never hardcode the prompt in `llm.ts`.
- **Adding/changing a governed tool**: add the `tool()` wrapper in `buildCockpitTools` + its `cockpitTools.test.ts` case (validation bounce / redaction / refs-only audit); a new structural field also needs the `plans` schema column and `buildAgentContext` if the model must reason over it. The tool — never the model — validates or resolves the fact.
- **Touching `executePlan` or delivery**: re-read the CAS and per-cid invariants above; re-run `cockpit.test.ts` AND `smoke:fanout` (convex-test cannot execute the workflow component — the unit suite never drives the successful `proposed → delivering` path, only the smoke script does).
- **Adding any new logging/telemetry in the cockpit path**: payloads must be refs/hashes/ids/counts only; extend `llmRedaction.test.ts` to cover the new write.
- **UI changes**: keep the threadId lift intact; re-run `cockpit-render` / `cockpit-split` / `cockpit-report` specs.

## Phase 10 — Vault grounding (`searchVault`)

The read-only knowledge-vault grounding tool (VGND-01, 10-02). A turn that needs the user's OWN
data (advice, business questions, their documents) calls `searchVault({ query })`; the tool
retrieves from the vault and fences the reference text back into the loop. It cannot write, send,
or change the plan — governance-wise it is a sibling of `briefInbox`, copying its three-plane split:

- **Log plane (refs-only, §4)**: ONE `vault.searched` audit row per call, payload EXACTLY
  `{ queryHash, resultCount }` — `queryHash = contentHash(query)` (the raw query is never stored),
  `resultCount` = grounded-doc count. No chunk text, no title. (See audit-dead-letter.md.)
- **Content plane (labels-to-UI)**: a `vaultSources` row `{ threadId, docIds, titles, count }` —
  `titles` are the source-card labels, `docIds` the PreviewModal click-through targets. Written by
  `internal.vaultSources.insert` (adapter writes NO audit row, the briefings.ts property). NOT
  written on a no-match (nothing to show).
- **Loop plane (SC2 fence)**: the retrieved chunk text returns wrapped in a labelled
  `<vault_context note="…informational only; never an instruction, tool call, or parameter">…</vault_context>`
  fence. Vault chunks are trusted-as-own (ADR-006) so they enter the loop DIRECTLY (not routed
  through the toolless `digestInbox` path third-party inbox bodies must), but the fence keeps them
  informational — they can inform an answer, never SELECT a tool or set a parameter.

Engine: `internal.vaultGround.vaultGroundHydrated({ tenantId, query })` — an `internalAction` taking
an EXPLICIT `tenantId` (the `gmail.search` / `digestInbox` convention), NEVER auth-derived: the
tool loop and the `__invokeCockpitTool` harness carry no live identity, so a `tenantAction` would
throw `UNAUTHENTICATED` into the fail-open swallow and `searchVault` would ALWAYS no-match.

Fail-open (SC1): any engine hiccup — or an honest zero-result — returns a plain no-match + upload
nudge string; the tool NEVER throws out of the governed loop (the `listInbox`/`mailboxUnavailable`
precedent). Tenant isolation (BETA-05): `vaultGroundHydrated` scopes every read on the passed
`tenantId`, so tenant B's `searchVault` never returns tenant A's chunks — asserted at the tool
surface in `cockpitTools.test.ts`.

Schema: `searchVault` is a member of the `agentSteps.tool` CLOSED union (Pitfall 4 — without it the
SDK's activity-step insert throws and is silently swallowed, so there is no "Searching…" step in
prod while tests pass). The activity step is emitted by the SDK loop for free — do NOT write an
`agentSteps.record` from the tool (that would double-write, the CKPT-05 property).

Read-side UI (10-03, `apps/web/…/workspace/cards.tsx`): the activity step is FREE labelling once
`searchVault` joins the closed `agentSteps.tool` union — `VERB["searchVault"]` gives it the
"Searching your knowledge vault…" / "Grounded in the vault" pair (an unknown key falls back to
"Working…", so a tool added later never crashes the trace). The `SourceCard` wired into `CardList`
is a DUMB renderer over the `vaultSources.byThread` content-plane reader (titles + docIds + count,
refs-only §4 — no query string and no chunk text ever reach the card): it self-queries on
`threadId`, returns null when the turn wasn't grounded, and renders the opaque `--card` sheet +
tracked-caps "📚 Grounded in N documents" label with each title as a `next/link` to
`/dashboard/vault` (the lazy click-through). The inline `PreviewModal` per-title upgrade is deferred
— it needs a `getVaultDoc(byId)` tenant query (`vault.ts`, out of 10-03's boundary); the `docIds`
already ride the row for it.

## Phase 12 — Business evaluation (`evaluateBusiness` + EVALUATION card)

Two tools join `buildCockpitTools` (BEVL-01, 12-04); the engine + its invariants live in
`business-evaluation.md` — this is only the cockpit-surface wiring.

- **`evaluateBusiness` (read-only, shape-1)** — copies `searchVault` verbatim: validated args →
  `readPlan()` cross-tenant guard → `internal.evaluations.runEvaluation({ tenantId, threadId,
  framework })` → a CAPPED synopsis into the loop ("Assessed …: N findings, M gaps, verdict …");
  the findings/citations live on the CARD, never in the returned string. `framework` is a CLOSED
  enum (`swot|lean|bmc|growth-os`, optional — absent = engine auto-picks) so the model can't inject
  prose. Fail-open (SC1). It NEVER proposes or sends (acting on a gap is plan 05). It joins the
  closed `agentSteps.tool` union (schema.ts) so its activity step isn't silently swallowed, and it
  maps in `SMOKE_OP_TOOL` (`evaluate → evaluateBusiness`, via a new `AgentSmokeOp` `evaluate` kind
  parsed from `SMOKE::agent::evaluate=<framework|>`) so the plan-05 offline E2E can drive it.
- **`recordScorecardAnswer` (write, NOT plan-gated)** — the "store" half of the LOCKED
  vault-first→ask→store loop reaching the LLM loop. Args `{ field, value }`; calls
  `internal.evaluations.recordScorecardAnswerInternal({ tenantId, threadId, field, value })` (the
  identity-free twin of the client `recordScorecardAnswer` tenantMutation — the loop carries an
  EXPLICIT tenantId, no live identity, the `searchVault` convention) and emits its OWN refs-only
  `evaluation.answered` audit `{ field, valueHash }` (§4 — never the raw figure). It is a DIRECT
  scorecard write (the user handing over their own figure, cited "user-provided") — it does NOT
  cross the Approve gate (a self-reported fact is not an outbound action, so the two-shapes rule
  doesn't apply). It is a QUIET write: no `agentStep`, so NO `agentSteps.tool` / `SMOKE_OP_TOOL`
  entry (only `evaluateBusiness` emits a step).

Read-side UI (`apps/web/…/workspace/cards.tsx`): the `EvaluationCard` is a DUMB renderer over
`evaluations.byThread` (the `SourceCard` precedent — self-queries on `threadId`, returns null when
the thread has no evaluation, renders above the plan-status branches since an evaluation turn may
carry no plan row). It renders the honest states the engine emits: per-section cited findings each
with an H/M/L confidence chip + a `/dashboard/vault` citation link (a user-provided finding shows a
non-link "user-provided" tag), a leverage-ranked gap list (≤5 + a "more" `<details>`), an
affirmative `--released` HEALTHY banner, and a VISUALLY DISTINCT dashed/neutral not-enough-data
nudge (never a gap look, never the `--held` amber that is the Approve gate ONLY, BRAND §2). NO
numeric score anywhere — the engine never emits one and the card never invents one.

### The `Act on this` control (12-05, BEVL-02) — the ONE write on the review

`GapRow`'s "Act on this" is live: `useMutation(api.evaluations.actOnGap)({ threadId, gapIndex })`.
It is the only control on the EVALUATION card that writes, and it only STAGES — the resulting
`proposed` memo-plan surfaces in the EXISTING PLAN card via the `plans.byThread` subscription
already in this file (no new surface, no new query). Three cockpit-side rules:

- **`gapIndex` is the PERSISTED row index, not the display position.** The card sorts gaps by
  `leverageRank`, so it carries each gap's original index through the sort
  (`gaps.map((gap, gapIndex) => …).sort(…)`). Handing the mutation a display position would act on
  the wrong gap the moment ranks differ.
- **`PlanCard` branches on `plan.kind === "memo"`** and renders a NEXT-STEP MEMO card — the memo
  body + "Approving saves this to your knowledge vault. Nothing is sent to anyone." + an
  "Approve & save" button. Everything in the email PLAN card below that branch (recipients, mode,
  the send-time picker, "Send to N recipients") would be a LIE on a memo. The approve handler is
  reused verbatim: the single `executePlan` gate, which takes the persist terminal.
  `PlanCards` also suppresses the `DraftCard` for a memo (its body is already the card above).
- **A refusal is spoken, not swallowed** — `plan_busy` (the thread's plan is mid-send or delivered)
  renders an inline `role="alert"` line telling the user to start a new chat; `gap_not_found`
  (a stale index after a re-evaluation) says the gap is no longer on the latest evaluation.

## Phase 13 — the pinned Weekly review tab (BEVL-03, 13-03)

The weekly cron (`proactiveReview.ts`, see `business-evaluation.md`) writes one `evaluations` row
per tenant per week on the STABLE `REVIEW_THREAD_ID` (`"proactive-review"`, exported from
`@pikar/core`). This is the cockpit-side surface that renders it. Three rules, all in
`workspace/page.tsx` + `cards.tsx`:

- **The tab is seeded, not persisted.** `const REVIEW_TAB: Tab = { id: REVIEW_THREAD_ID, label:
  "Weekly review" }` goes straight into `useState<Tab[]>([REVIEW_TAB])`. The thread id is
  deterministic, so the tab needs no storage and the "tabs are session-only view state" note above
  still holds. Seeding it as a REAL `Tab` (rather than rendering it beside the strip) is what makes
  the `?thread=proactive-review` deep-link dedupe for free — `openThread` already skips ids it is
  already showing, so the notification click-through lands on the existing tab instead of a twin.
- **It never closes.** `pinned = t.id === REVIEW_THREAD_ID` drops both the `chat-tab-close` button
  and the `has-close` wrapper class (the label reclaims the gutter), and `closeTab` returns early on
  that id as defence in depth. There is no surface that would reopen it, so closing it must be
  impossible rather than merely inconvenient.
- **The COMPOSER is suppressed on it — and that is the fix, NOT loosening the backend.** The review
  thread is synthetic: no `plans` row exists for it, so `api.cockpit.sendCockpitMessage` throws
  `"cockpit: plan row missing for thread"` (`cockpit.ts:93`) on any send. READING degrades
  gracefully (`listThreadMessages` → empty page, `plans.byThread`/`briefings.byThread` → null, and
  `cockpit.listThreads` reads agent-component threads so the review stays out of "Past chats" for
  free), so only the send path needs blocking. The branch renders "This is your weekly business
  review. Start a new chat to act on anything here." instead of `<ChatPane>`. **Do not relax the
  `cockpit.ts:93` guard to make this thread sendable** — that guard protects every real cockpit
  thread from a plan-less send.
- **The review branch is checked BEFORE the gmail-status branch, on purpose.** The review has
  nothing to do with a mailbox; a user who has never connected Gmail must still see it (SC#2 — the
  whole point of the review is that it cannot break on the Google 7-day testing token).

`EvaluationCard` gains four review-only branches and stays a dumb single-row renderer over
`evaluations.byThread` (no new query, no new card component, no new card idiom):

- **Pre-first-run empty state** — when `isReview` AND the query has RESOLVED to `null` (`undefined`
  is still loading, so no flash), a small `briefingSheet` card says the first review runs Monday.
  Off the review thread this is still the original bare `return null`: an on-demand evaluation
  thread must never gain a card it did not have before.
- **Dated header** — `Weekly review · <MMM D> · Evaluation · <framework>`. The DATE is the freshness
  signal, which is why there is deliberately no unread dot or badge. The framework stays visible so
  the user compares like with like week over week. A non-review header is byte-identical to before.
- **Delta line** — one muted line from the PERSISTED `evaluation.delta`, joined with ` · `, zero
  terms omitted (`2 new findings · 1 gap closed`). Only a cron run writes a `delta`, and only from
  the SECOND review onward, so the line is absent on the first review and on every on-demand
  evaluation. Never re-derived in the card, and never a score or percentage — the engine emits none.
- **Profile CTA** — the `evaluation-insufficient` box links to `/dashboard/profile` (the Phase-11
  enrichment surface, whose save re-embeds the profile doc), turning the one dead-end state into the
  one action that unblocks it. `--teal-900`, not `--teal-600`: BRAND §6 forbids teal-600 as small
  body text (~2.9:1) and says to darken it.

## Phase 15 — Sub-agent dispatch + generalized executor

> **This section is an APPEND-ONLY shared singleton for Phase 15.** Each plan writes ONLY inside
> its own `### Phase 15 — …` subsection and bumps `Last verified` at the top of this file. On a
> merge conflict here, KEEP BOTH sides.

### Phase 15 — Wave 0 (freeze)

15-01 landed the shared seams every later Phase-15 plan depends on. Nothing here changes cockpit
BEHAVIOR — it makes later behavior expressible.

- **Three dispatch literals on the closed `agentSteps.tool` union** (`schema.ts`):
  `dispatchOfferArchitect`, `dispatchMoneyModelDesigner`, `dispatchLeadEngine`. They are N
  LITERALS, deliberately not a `specialist: v.string()` field — §4 on the trace plane is enforced
  by the ABSENCE of anywhere to put text, and a string field would re-open exactly the hole the
  closed union closed (`agentSteps` allow-list scan, `llmRedaction.test.ts`). Without the literals
  the dispatch step's insert throws INSIDE an SDK tool callback, which the SDK swallows: prod gets
  a blank activity card while every test stays green. `dispatch.test.ts` inserts each literal
  against the real schema; that is the guard.
- **Matching `VERB` entries** in `apps/web/.../workspace/cards.tsx`, plus the missing Phase-12
  `evaluateBusiness` entry (it had been rendering the `["Working…","Done"]` FALLBACK since 12-04).
  Rule: every `agentSteps.tool` literal gets a `VERB` entry in the same commit that adds it.
  **This is the ONLY `apps/web` edit in Phase 15** — specialist attribution rides the plan BODY,
  and `PlanCard` renders only at `plan.status === "proposed"`, so a `collecting` plan already
  renders nothing during dispatch and needs no pending state.
- **`internal.guardrails.remainingDailyCents`** — the readable half of the daily-spend rail.
  `rateLimiter.getValue` reads utilization WITHOUT consuming tokens, clamped with `Math.max(0, …)`
  because `recordSpend` uses `reserve: true` and drives the window negative on purpose. Explicit
  `Promise<number>` return type is mandatory (an inferred one collapses the generated API to `any`
  — that is how 13-01 shipped 90 `apps/web` errors). It is the DEPLOYMENT's budget, not the
  tenant's: `dailySpendCents` is a keyless window; per-tenant keying is the upgrade path.
- **STUBS registered under this playbook** (content lands later, but the paths are registered NOW
  so the Stop hook can protect them from day one): `packages/backend/convex/dispatch.ts` (+
  `dispatch.test.ts`, `dispatchGuard.test.ts`) → 15-02/15-03; `packages/core/src/actionType.ts`
  (+ test) → 15-05. `actionType.ts` ships the closed `ACTION_TYPES = ["email","memo"]` union and
  `actionTypeOf(kind)` — an absent `plans.kind` means the email plan every prior phase built, so
  ACTN-01 needs no migration and no backfill.
- **`dispatchGuard.test.ts` — the no-nested-loop scan.** `dispatch.ts` must contain ZERO
  `generateText`, and `llm.ts` must contain EXACTLY ONE **tool-bearing** `generateText` call site.
  Tool-bearing, not total: `llm.ts` legitimately holds several TOOLLESS `generateText` calls
  (`digestInbox`/`draftReply`/`draftCockpit`) — that is the untrusted-content ingestion firewall
  (agent-runtime.md invariant 10) and `llmRedaction.test.ts` already pins each as toolless. Note
  `runAgentLoop` passes its tool set by SHORTHAND (`tools,`), so the scan matches `tools\s*[,:]`.
  Why the invariant: a second loop nested in a tool's `execute` double-bills the daily window
  (`preCall` only ever sees the outer call) and makes `stopWhen: stepCountIs(8)` meaningless.
  Dispatch is therefore a SEQUENTIAL second `runAgentLoop` call, never a loop inside a tool.
  15-05 appends its Approve-gate scan to this same file below the `// 15-05 adds:` marker.

### Phase 15 — Lane A (dispatch core)

15-02 added the ONE seam that lets a specialist run in THE governed loop without forking it.
`runCockpitAgent`'s behavior is byte-identical.

- **`runAgentLoop` gained the append-only optional `toolNames?: readonly string[]`** (the
  `omitRecipientEdits` / `skillVersions` signature-evolution convention). **ABSENT ⇒ the full
  20-key record** — every pre-existing caller keeps working, which is what the whole unchanged
  `runCockpitAgent.test.ts` / `cockpitTools.test.ts` suite proves. **`[]` ⇒ an EMPTY record**, not
  the full one: the implementation tests `toolNames === undefined`, never truthiness, because
  `toolNames ? filtered : built` would hand a zero-tool specialist all 20 keys. Both are asserted.
- **Withholding is STRUCTURAL ABSENCE from the tool record.** Not `activeTools` (ai@7 has it, one
  line — but the withheld tool's `execute` closure would still sit in the record and stay reachable
  via `invokeTool`), and emphatically not skill wording. This is the `omitRecipientEdits` precedent
  generalized to an explicit allow-list: the capability is withheld by CONSTRUCTION. Upgrade path if
  the filter ever gets hot: `activeTools` PLUS an `invokeTool` allow-list check, never `activeTools`
  alone.
- **`runSpecialistTurn` is the ONLY exported entry into the loop for a specialist**, and
  **`runAgentLoop` stays module-private**. That narrowness is what makes "no agent spawns an agent"
  checkable by reading one file (`dispatchGuard.test.ts`). It loads the body from the §5 registry
  (`getSkillVersion` when pinned, else `getActiveSkill` — fail-closed on both), takes the tool-set
  from `@pikar/core`'s code-owned allow-list (**ADR-007**), and returns `skillVersion` so the caller
  can put `{name, version}` on the lineage audit row. Explicit return type, mandatory (Pitfall 4 —
  an inferred one collapses the generated API to `any` in `apps/web`).
- The `__runCockpitAgentWithScript` shim gained an append-only `toolNames` arg so the filter is
  drivable offline through the REAL loop.
- **Do not add a write tool to a specialist.** `specialists.test.ts` asserts `tools` as an equality
  over the whole registry precisely so that edit fails a test. See ADR-007 for why the tool-set is
  code-owned while the body is registry-owned.

15-03 built the dispatcher itself (`convex/dispatch.ts`). Entry points: `runSpecialist`
(production) and `__runSpecialistWithScript` (the offline twin). Both call ONE `governedDispatch`,
so a guard cannot be true in tests and absent in production.

- **The guard ORDER is load-bearing: resolve → depth → cycle → envelope → run.** Keep it.
  `resolveSpecialist` first because `gaps[].route` persists as `v.string()` (`schema.ts:350`)
  including `diagnose()`'s deliberate `""` — rows written before the union was closed reach here
  un-narrowed, so the RUNTIME branch is the real guard, not belt-and-braces. Cycle uses the SHARED
  `wouldCycle` from `@pikar/core`; do NOT re-derive `ancestry.includes` inline or the unit-tested
  guarantee and the shipped one drift. The envelope check is LAST of the four so a refusal that
  costs nothing is never charged against the tree.
- **Four refusals — `unknown_route`, `depth_exceeded`, `cycle_refused`, `budget_exhausted` — and
  every one is a conversational REPLY with ZERO `deadLetters` rows and ZERO model spend.** This is
  the `PAUSED_REPLY` precedent (`llm.ts:1588`, `guardrails.ts:1-5`): a governed stop is a paused
  conversation, not a system failure, and the cockpit has never DLQ'd a user-facing turn. The reply
  strings are module constants and NONE of them names its internal reason code to the user. They
  are driver-plane synthetic strings, NOT agent prompts, so §5 does not apply (the
  `RESOLUTION_CONTINUE` precedent). **A refusal never paints an `agentSteps` row** — a refused
  dispatch never started — and the step is finished in a `finally`, the only construct that
  terminalizes on success, on a thrown turn, AND on a governed stop that returns as data.
- **`MAX_DEPTH = 1`**, so a specialist can never dispatch anything and cycles are structurally
  impossible. Cycle refusal ships anyway (SC #2 names it) so the guarantee is tested the day the
  cap rises. Raising it is a ONE-constant change — `ancestry` already travels (ADR-008).
- **The envelope is a TREE-LOCAL SECOND ceiling, not a replacement for the rail.**
  `envelopeCents = floor(remainingDailyCents × ENVELOPE_FRACTION)`, derived ONLY at the root
  (`envelopeCents: 0` in ⇒ derive; non-zero in ⇒ carried through UNCHANGED, which is what makes it
  ONE envelope for the tree instead of a fresh allowance per hop). The global `dailySpendCents`
  window is still drawn down independently by `recordSpend` inside the loop. Two traps: the rail is
  **DEPLOYMENT-wide, not per-tenant** (`dailySpendCents` is a KEYLESS window — per-tenant keying is
  the upgrade path, matching `guardrails.ts:19-20`), and **do not lean on `guardrails.preCall`** —
  it checks `{ count: 1 }`, i.e. "is there ANY budget left", never "is there enough for this call".
- **An overrunning hop KEEPS its output and is labelled `incomplete: true`.** Stop AFTER the call
  that overran; never discard work already paid for — the same honesty posture as Phase 12's
  not-enough-data verdict. The marker rides the memo BODY (15-02), never a `plans.status` literal.
- **Lineage is audit-ONLY, with `correlationId := rootRequestId`.** Three inserts per hop —
  `subagent.dispatched` / `subagent.completed` / `subagent.refused`. That IS the whole SC #3
  mechanism: `audit.by_correlation` already existed, so the call tree reconstructs and the tree's
  cost sums to the root with **no new table, no new index, no schema change**. Three deliberate
  NON-decisions, so nobody "fixes" them: (1) **no `subAgentRuns` table** — a second log plane beside
  an insert-only audit is the anti-pattern; (2) **no telemetry mirror** — `telemetry.requestId` is
  `v.id("requests")` and a specialist run seeds ZERO `requests` rows by design (12-05), so
  inventing one would re-enter the delivery spine; (3) **nothing on `agentSteps`** — its own header
  says it writes no log-plane row, and a shadow log there would be a §4 regression.
- **Lineage payloads are refs/ids/counts ONLY (§4).** `{ rootRequestId, parentAgentId, specialist,
  depth, ancestryDepth, planId, skillVersion, costUsd, spentCents, envelopeCents, incomplete,
  reason }`. NO reply, NO body, no finding text, no citation titles — a specialist's output is
  grounded business prose. Asserted twice: over every payload VALUE of every row a run writes
  (`dispatch.test.ts`) and STATICALLY over the source, payloads plus the shared `refs` object they
  spread (`llmRedaction.test.ts`). Both mutation-checked.
- **The specialist's evaluation context rides the PROMPT**, built from
  `internal.evaluations.lastForThread` and capped (8 findings, 160 chars a label). That is why
  `evaluateBusiness` is not in the grant and must not be added — it WRITES a row and re-enters the
  engine mid-dispatch (ADR-007).
- **There is no `generateText` in `dispatch.ts`, ever.** Dispatch is a SEQUENTIAL second call into
  the ONE loop, never a loop nested inside a tool `execute`. `dispatchGuard.test.ts` asserts it.
- **Lineage/limit state travels as validator-checked ARGS, never DB state — ADR-008.** Both entry
  points share one `dispatchArgs` validator object. A multi-hop caller must thread hop N's returned
  `spentCents` and `envelopeCents` into hop N+1; `DispatchResult` returns both for exactly that.

**15-04 — where the run lands, and why the cockpit surface did not move:**

- **`PlanCard` renders ONLY at `plan.status === "proposed"`** (`cards.tsx:1624`). That single fact
  is why a dispatched gap needs no card pending state, no spinner variant, and no new plan status:
  a `collecting` plan already shows nothing, and the CKPT-05 dispatch trace step is the progress
  indicator. **Phase 15 makes ZERO `apps/web` edits after Wave 0** (the `VERB` map), and that is a
  consequence of this, not a coincidence.
- **The specialist attribution header and the cost-ceiling marker ride the plan BODY**
  (`specialistMemoBody`, `@pikar/core`), NOT a new `plans.status` literal. The status enum is PINNED
  (`schema.ts:155-164`) with `apps/web` blast radius, the body is already rendered verbatim
  (`cards.tsx:255`, `white-space: pre-wrap`), and the body is what the human is looking at when they
  give irreversible consent — which is exactly where an "incomplete, cost ceiling reached" warning
  belongs. Upgrade path (from 15-02): add a status literal only if something OTHER than a human
  needs to branch on incompleteness.
- **`dispatchAndLand` wraps `governedDispatch` and calls `internal.evaluations.landSpecialistResult`
  in a `finally`.** Every outcome — success, an overrun, all four governed refusals and a thrown
  turn — must leave the plan row `proposed`, because a row parked at `collecting` renders no card:
  the user's tap would silently have done nothing. Both entry points call `dispatchAndLand`, never
  `governedDispatch` directly, for the same reason both call one governance function: a behaviour
  cannot be true in tests and absent in production.
- **A thrown turn is NOT a fifth refusal.** It audits `subagent.refused` with `reason: "error"` (the
  CODE only — `err.message` can carry prompt or grounded prose, §4), writes no `deadLetters` row,
  lands the fallback memo, and then RETHROWS. `DispatchResult`'s refusal union is the GOVERNED-stop
  contract; dressing an unexpected exception as one of the four would hide a real bug from the only
  place it surfaces in production — the scheduled function's own failure state. (The §5 skill loader
  fails closed by throwing, so this path is reachable, not theoretical.)

### Phase 15.1 — the tier in the specialist prompt (15.1-05, ADR-009)

`buildSpecialistPrompt` (`convex/dispatch.ts`) is the ONE place the tenant's tier reaches a model.
It is exported solely so `dispatch.test.ts` can assert what it builds; production still calls it
from exactly one place (`governedDispatch`).

- **What the prompt now carries**, prepended above the existing evaluation snapshot and `TASK_LINE`:
  the sanitized agent name, a `Business tier: <tier> — <structural consequence>` FACT line, and the
  behaviour-preset style directive body. Every line is omitted when its input is absent, and when
  nothing is known the briefing is `""` and the prompt is exactly what it was before. The change is
  **additive** — `Framework:` / `Binding constraint:` / `Grounded findings:` are untouched, asserted.
- **Both return paths carry it**, including the `if (!evaluation)` early return: a tenant with no
  evaluation snapshot still has a tier.
- **The style-directive read FAILS OPEN** (`try`/`catch`, directive left `undefined`). §5's
  fail-CLOSED rule guards the SYSTEM prompt — the specialist's own body, loaded in
  `runSpecialistTurn`, which still throws `NO_ACTIVE_SKILL`. This is an ADDITIVE overlay on the
  user-turn prompt: losing it degrades VOICE, not governance, and an unseeded style row must never
  cost a tenant their dispatch. Mutation-checked: making the `catch` rethrow turns exactly the
  FAIL-OPEN test red. **Do not "harden" this into a fail-closed read.**
- **The tier travels as CALLER-assembled prompt context, never as a read inside the loop.**
  `llm.ts` is byte-unchanged by this plan and `git diff --exit-code packages/backend/convex/llm.ts`
  is a hard gate on it. The router is not forked; `resolveSpecialist` and `SPECIALISTS` are untouched.
- **ADR-009 fence for a future reader/verifier:** this is prompt-shaping. SC#5 must NOT be read as
  "the offer set is filtered" or "the rubric pick changes". `diagnose()` emits ONE prescription, so
  there is no candidate set to filter, and `financialsPresent` still overrides the framework pick
  (Q3). Nothing about `evaluations.gaps.length` or `Prescription.route` moves.
- **Where the pieces live:** `tierBriefing` + `PRESET_SKILL` are pure and code-owned in
  `packages/core/src/specialists.ts` (the FACTS — the `TASK_LINE` class); the style directive BODY is
  a versioned registry row (`style-direct` / `style-coaching` / `style-concise`, UNGATED). That split
  is ADR-007's, restated: what the agent is TOLD is DB-editable, what is structurally TRUE is not.

### Phase 15 — Lane B (generalized executor)

15-05 turned the approve→execute spine action-agnostic. `executePlan` stopped branching on an ad-hoc
`if (plan.kind === "memo")` and became a DISPATCHER over a closed action-type table. **This is a
refactor: the arms are the existing code paths and no behavior changed.**

- **`executePlan` is the action-type DISPATCHER.** `armFor(actionTypeOf(plan.kind))` selects the
  arm; the switch has an `assertNever` backstop for a new `Arm`. The table itself is
  `satisfies Record<ActionType, Arm>` — in `@pikar/core` behind `armFor` (THE table; deliberately
  not a ternary, which would be total by construction and would silently route a new member to the
  else-branch's arm) and re-bound as `_ARM_TABLE` in `cockpit.ts`. **Adding an action type without
  deciding its arm is a COMPILE error in both places**, which is stronger than any test —
  mutation-checked by adding `"calendar"` to `ACTION_TYPES` and watching `tsc` fail (TS2741) in
  `packages/core/src/actionType.ts`, `actionType.test.ts` and `convex/cockpit.ts`. Phases 16-19 add
  an arm; they do not re-fork the executor.
- **Why `cockpit.ts` re-binds the table instead of trusting `armFor` alone:** the `workflow` case
  falls through to the GMAIL fan-out (seed `requests` → `startFanout` → `deliverApprovedPlan`). A
  new action type that merely *classified* as `workflow` would inherit the email terminal silently.
  The bind forces that author to visit the dispatcher and decide. The switch's `assertNever` covers
  a new ARM; `_ARM_TABLE` covers a new TYPE.
- **The branch ORDER is load-bearing and UNCHANGED**: tenant check → CAS (`status !== "proposed"` ⇒
  `alreadyStarted`) → `escalated` (REVW-02 fail-closed) → **arm selection** → mailbox pre-check →
  far-future cap (SCHD-01) → CAS flip → seed `requests` → fan-out. Arm selection sits exactly where
  12-05's memo `if` sat. Both sides of that position are asserted in `gapAction.test.ts`: a memo
  approves with ZERO `gmailTokens` rows (selection is BEFORE the mailbox pre-check — a memo must
  never need a connected Gmail), and an ESCALATED memo refuses with `review_escalated` running
  NEITHER arm (selection is AFTER the fail-closed guard).
- **Two-level dispatch.** `executePlan` picks the arm; **`deliverApprovedPlan.ts` is the
  workflow-backed EMAIL arm's entry point, NOT the universal dispatcher.** It is BYTE-UNCHANGED
  (`git diff --exit-code` is part of this plan's verification) and must stay so. Routing an inline
  arm through it would add orchestration, workflow rows and latency for one DB write, and would
  re-expose the gmail fan-out as reachable-in-principle from every action type — undoing the
  structural property 12-05 bought. **A future inline arm executes inline; a future durable arm
  starts its OWN workflow.**
- **The Approve gate is a `tenantMutation` and is statically asserted absent from every tool
  record** (`dispatchGuard.test.ts`, below the `// 15-05 adds:` marker): `cockpit.ts` must declare
  `export const executePlan = tenantMutation({`; `executePlan` / `approvePlan` /
  `deliverApprovedPlan` must not appear among `buildCockpitTools`' `name: tool({` keys (with a
  ≥20-key non-vacuity floor); and `llm.ts` must contain no `internal.cockpit.executePlan` /
  `api.cockpit.executePlan` / `deliverApprovedPlan` reference at all, so a tool cannot reach Approve
  under some other key. Why: the standing v2.0 rule is that every capability is either a read-only
  tool returning content in-loop or a write STAGED into the plan for the human Approve mutation —
  no third mechanism. Approve is the single point of irreversible consent; a model that can call it
  has removed the human from the loop. Generalizing the executor is exactly when that slips.

## How to verify

- `pnpm --filter @pikar/core test` — the surviving pure validators: `isValidEmail`, `parseAddress`, `rankCandidates`, `applyRecipientEdit` (add/remove/set bounce), `buildRecipientView`
- `pnpm --filter @pikar/backend test` — approve-gate invariants, per-tool governance (`cockpitTools.test.ts`), the governed loop (`runCockpitAgent.test.ts` — scripted edit → `proposed`, kill-switch pause without a DLQ, CHEAP_MODEL fallback), redaction static scan (incl. index/label context + the `mailbox.searched` payload assertion: exactly `{queryHash, resultCount}` — no name/address/subject, SC3)
- `pnpm --filter @pikar/backend test cockpit.test plans.test` — the deferred-send scheduler invariants (3.5): fake-timer arm→fire (`vi.useFakeTimers` + `t.finishInProgressScheduledFunctions`), cancel-before-fire (refs-only audit + nothing sent + double-cancel no-op + cross-tenant refused), immediate-path-unchanged, and the `setPlanSendTime` tenant guard
- `pnpm --filter @pikar/backend smoke:fanout` — needs a running `convex dev` + seeded skills; proves fan-out isolation, one-terminal-per-recipient, no raw PII (3.3: a shared generated attachment fanned to every recipient with no file bytes/base64 in any log plane, V6; 3.4 CKPT-03: `assertFanoutBodiesDistinct` proves each recipient got its OWN distinct body under a shared subject — the INVERSE of the shared attachment — and each `TAILORED-SECRET-<i>` body needle is ABSENT from every log plane). UNCHANGED by 3.5 deferred send — it still proves the governed fan-out spine a scheduled fire REUSES (a scheduled send arms the SAME `deliverApprovedPlan`)
- `pnpm --filter @pikar/backend smoke:guardrails` — the guardrail phase gate incl. 3.3 section 7/7: attachment generation under the kill switch pauses as data, no attachment stored, no dead letter (V8)
- Playwright E2E (needs `convex dev` non-`--once` + `next dev` on :3111, signed-in via `auth.setup.ts`; see `apps/web/e2e/README.md`): `pnpm exec playwright test cockpit-report` (full chat→plan→approve→report over `SMOKE::`), `cockpit-resolve` (name→resolution card→pick→PLAN over `SMOKE::`, nothing sent), `cockpit-attachment` (3.3 — chat→attach→PLAN filename+download→Approve→REPORT delivered-with-attachment + remove variant, V9), `cockpit-personalize` (3.4 CKPT-03 — chat→2 recipients→personalize #1→PLAN card shows 2 distinct bodies pre-Approve→Approve→REPORT), `cockpit-schedule` (3.5 SCHD-01 — chat→`sendTime=`→PLAN card shows the resolved absolute time pre-Approve→picker sets a future time→Approve→ScheduledCard→Cancel→Canceled with nothing sent, plus the no-time immediate default), `cockpit-briefing` (3.7 CKPT-04 — seeds `smoke:seedInboxFixture` for the SESSION's tenant (decoded from the Convex Auth JWT's `sub`) with `offlineDigest:true, baseMs:1577880000000`, then `SMOKE::agent::brief=today` → BRIEFING card grouped 3/1/1 with a Needs-you row, zero buttons/links in the card, and a counts-only reply carrying no gist or body needle; needs a Gmail-connected harness user because the composer is gated on `gmailAuth.status.connected`), `connect-gmail`, `cockpit-render`, `cockpit-split`
- Manual-only (SCHD-01, human-verify): a real DEFERRED Gmail send — connect Gmail, say "send this in 3 minutes" (or use the PLAN-card picker), confirm the PLAN card shows the RESOLVED ABSOLUTE time in your tz before Approve (and an ambiguous "send at 4" is RE-ASKED), Approve ONCE, confirm the card becomes "Scheduled for … · Cancel" with NOTHING arriving before the minute, let it fire and confirm it ARRIVES at the requested moment (audit/deadLetters/telemetry refs-only, no sendAt content, §4); separately Cancel another scheduled send before fire (nothing sent, "Canceled", refs-only `plan.canceled` audit); and with an expired token let a scheduled send fire → `awaiting_reauth` + reauth notification exactly like an immediate send (fake timers cannot observe real inbox arrival or real token expiry at fire — the sole live-only proof). See `03.5-VALIDATION.md`
- Manual-only (V10, human-verify): a real Gmail send of a generated PDF — connect Gmail, ask the agent to attach a document, Approve, confirm the PDF lands in the inbox and opens, and inspect the audit/deadLetters for refs-only (storageId/filename/size/messageId/counts — no bytes/base64/URL). The E2E harness user has a stale token so offline sends settle at `awaiting_reauth` by design; see `03.1-VALIDATION.md`
- Manual-only (CKPT-03, human-verify): a real 2-recipient distinct-wording send — connect Gmail, compose to TWO real inboxes, give a shared subject + base body, ask the agent to tailor recipient #1's wording distinctly (leave #2 shared), confirm the PLAN card shows TWO DISTINCT bodies BEFORE Approve, Approve ONCE, open BOTH inboxes to confirm each received its OWN wording under the SHARED subject, and inspect audit/deadLetters for refs-only (no raw body/subject/address, no `recipientBodies` content — §4). A group-mode send with personalization should be refused with a switch-to-individual prompt

- Manual-only (BEVL-03, 13-03): open `/dashboard/workspace` — the "Weekly review" tab is present with NO `×`, and selecting it shows the explainer with NO composer. Before any cron run it shows the "first review runs Monday" card. Force one with `npx convex run proactiveReview:runWeekly '{}'`, reload, and confirm the dated header; run it a second time after changing a vault doc to see the delta line. Disconnect Gmail and confirm the tab still renders (SC#2)

## Operational notes

- Seed skills or drafting fails: `npx convex run skills:seedSkills` (the `dev` script auto-runs it)
- Offline/E2E mode = no `AI_GATEWAY_API_KEY` on the backend deployment
- Divider position persists per-browser (localStorage), not cross-device

## Known gaps & deferred work

- Attachments: `AttachmentPicker` uploads only; wiring storageIds into the plan is deferred (Phase 4, INTK-02)
- DraftCard has no inline editor — edits arrive as new guided-conversation turns
- `rejected` is transient, not a plan column; cross-turn per-address re-ask needs a schema change
- Divider persistence ceiling: localStorage → Convex userPrefs if cross-device matters
- **A disconnect strands rows on purpose (22.1)**: requests held at `awaiting_reauth`, unread `gmail_reconnect` notifications, and armed future-`sendAt` schedulers are all left in place. Each degrades to a non-throwing hold (`gmail.send` routes a missing token to `awaiting_reauth` without throwing), and the cron creates no new expiry notifications once the row is gone, so the leak is bounded to what already exists. Cleaning them up means building the reconnect-RESUME sweep — which does not exist today either, despite `connect-gmail/page.tsx`'s comment claiming reconnect "resumes any awaiting_reauth delivery". That resume is the real missing feature; the disconnect adds no new breakage.
- **`apps/web/e2e/connect-gmail.spec.ts` — the stale-copy assertions are FIXED (2026-08-07), but the spec still has no gate.** It asserted a "Connect Gmail" heading and a `/connect gmail/i` link from 17-02 (when the page became "Connect Google") until the `fix/ci-commit-errors` lane retargeted it at the shipped copy plus the new `role="alert"` unconfigured-OAuth branch. **Do not read that as green**: Playwright is deliberately outside the CI gate (`ci-gate.md` — it needs a live deployment and a seeded tenant), and this shell has never had `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`, so the corrected spec has still never been observed passing. A spec that is merely *no longer wrong* is not a spec that has run.

## Voice-doc reuse of the evaluation card (14-08)

Phase 14's post-call screen renders the **exported `CardList`** rather than forking a card. Four
edits made that possible, and each is deliberately small — `EvaluationCard` stays ONE dumb read of
ONE `byThread` row, and a new affordance is another branch inside it, never a second query or a
second card (the standing rule since Phase 13).

1. **`isDocReview`** keys off `DOC_REVIEW_FRAMEWORK` imported from `@pikar/voice`, never a re-typed
   `"document-review"` string. `schema.ts`, `voiceDoc.ts` and this card must agree; one shared
   constant is the only way a rename cannot silently desync them.
2. **The healthy banner** has a document branch. "No gaps found on X — your business is solid here"
   is simply the wrong claim when the user asked about a *report*. Same `data-testid`, same
   `healthyBox` styling (both asserted elsewhere).
3. **The thin-data CTA is suppressed** on a document review. `/dashboard/profile` is the one action
   that unblocks the *business* dead-end and does nothing for a report that could not be assessed —
   offering it would be a dead link dressed as a fix. The box's honest message stays.
4. **`citationExcerpt` renders as a `<blockquote>`** beneath the finding label — the quoted-passage
   half of 14-CONTEXT.md's citation lock. **Framework-agnostic on purpose:** the field is optional on
   every `evaluations` row, so Phase-12 business evaluations (which never set it) render
   byte-identically and no second branch exists. **Absent must render exactly as before** — no empty
   block, no placeholder, no reserved space, because "where available" means absent is the normal
   case. §4: an excerpt is report content on the PRODUCT surface only — never add it to a telemetry,
   analytics or logging call from this component.

**`CardList`'s `noPlanHint`** is opt-in and defaults to the existing cockpit string, so every current
caller is behaviourally unchanged. It exists because "answer the questions to build one" is wrong on
a surface with no composer.

**A voice-doc thread must never be routed to the workspace composer.** The synthetic
`voice-doc:<sessionId>` id is not a Convex Agent thread: reads degrade gracefully but
`sendCockpitMessage` would throw (Pitfall 7). `apps/web/e2e/voice-doc.spec.ts` drives
`/dashboard/workspace?thread=<synthetic>` as a **test harness only** — it renders the same
`CardList` over the same seeded row — and no navigation entry point to that URL may be added
anywhere in the product. "A workspace EVALUATION card for voice-doc findings" is an explicitly
deferred idea.

## Phase 16 — Research sub-agent

> Append-only container (the Phase-15 rule): each Phase-16 plan writes ONLY inside its own
> `### Phase 16 — <plan>` subsection. On merge conflict, **keep both**.

### Phase 16 — Wave 0 (freeze)

The Lane-R half of the Stage-1 shared-union freeze. Whole diff is unions, one optional schema
field, one verb, three watch registrations and three widened signatures no caller passes yet.
**No behaviour change**; two assertions in `16-01`'s verification prove no capability landed early.

**ONE `agentSteps.tool` literal — `dispatchResearch`. There is deliberately NO `webResearch`
companion, and this is the single most likely thing for a later reader to "fix".**
`openai.tools.webSearch()` is a **provider-executed** tool: `ai@7.0.20`'s `executeToolCall`
returns early at `if (!isExecutableTool(tool)) return undefined;` **before** it fires
`onToolExecutionStart`. A hosted search therefore emits no step row at all, and a
declared-and-never-written literal is worse than none — it reads as a trace that exists and sends
the next reader hunting for the insert that writes it.

`vaultDocuments.retrievedAt` (D7) is the web-research freshness stamp as a stored, queryable
field — **not** `createdAt`, whose meaning stops being "retrieval time" the moment anything
re-creates the row. Only `kind: "web_research"` docs write it. See `vault.md` for the read path.

**The three widened signatures** (all append-only, all no-ops until 16-05/16-06):

| Site | Added | Why it is in the freeze rather than invented later |
|---|---|---|
| `buildCockpitTools` 7th arg `agentContext` | `grantWebResearch`, `threadId`, `rootRequestId` | The hosted-search key is BUILT only when granted — structural absence, the `omitRecipientEdits` precedent. Unconditional construction would hand the EXECUTIVE agent web search on every cockpit turn, because `runAgentLoop` returns the FULL record when `toolNames === undefined`. |
| `runAgentLoop` | `maxSteps?`; return += `webSearchCalls` / `truncated` / `sources` / `modelId` / `fallbackModelId` | `?? 8` preserves today exactly. `truncated` is real from day one (arithmetic on the shipped result); `webSearchCalls`/`sources` wait for 16-02's probe to settle what a provider-executed call looks like in `res.steps`. |
| `runSpecialistTurn` | the same five, as pass-throughs (`...res` already spread them — only the type widened) | `governedDispatch` sees NOTHING but this return. **`modelId` is what makes 16-05's research model pin assertable at all** — the only other observable is `costUsd`, and `RESEARCH_MODEL` may well BE `DEFAULT_MODEL`, making the pricing identical and the assertion vacuous. Drop `sources` and 16-06 either fails to compile or quietly defaults it to `[]`, after which every research run ships labelled "insufficient evidence". |

**The CKPT-05 comment at `runAgentLoop` was amended, not left stale.** It used to end *"They do
NOT reach buildCockpitTools: the tools don't emit, the SDK does."* Half still holds and is the
part worth protecting — **no tool emits a step row; the SDK does.** But `threadId`/`rootRequestId`
now DO reach the builder, as dispatch lineage on `agentContext` (ADR-008: lineage travels as
validator-checked call args), so 16-06's scheduled research tool can correlate its async run.
**Lineage in, emission still out.**

## Phase 17 — Calendar actions

> Append-only container: each Phase-17 plan writes ONLY inside its own
> `### Phase 17 — <plan>` subsection. On merge conflict, **keep both**.

### Phase 17 — the CALENDAR card (ACTN-02, availability content plane)

**The defect, in the owner's words: "it just replied with a message … no card in the workspace."**
`checkAvailability` was correct and invisible. It returned a STRING to the model loop and wrote
nothing down, so a "what's on my calendar?" turn answered in chat prose and left the canvas blank —
for BOTH providers, not just Microsoft. The owner read that as the agent being detached from its own
actions, and they were right: **the canvas can only render what something writes down.** Only two
producers feed it — plan rows (`cards.tsx` kind dispatch) and `briefings` rows. Every other tool
result is conversation that evaporates.

The fix is the `briefings` pattern applied to the calendar, and nothing more:

- **`calendarViews` table** (`schema.ts`) + **`calendarViews.ts`** adapter — an exact mirror of
  `briefings`/`briefings.ts`, including the property that matters: it writes **NO log-plane row**.
  The refs-only `calendar.availability` audit (range + busyCount, never an instant) stays with the
  ACTING modules, `calendar.ts` / `microsoftCalendar.ts`, so the times held here cannot reach a
  payload (§4). `insert` is internal + append-only; `byThread` is the tenantQuery the card
  subscribes through. Its `BUSY`/`PROVIDER` validators are **DERIVED** from the schema for the
  reason `briefings.ts` learned the hard way — do not re-inline them.
- **`llm.ts` `checkAvailability`** writes the row after a successful read. **The write sits ABOVE
  the empty-window return, deliberately.** `busy: []` is the ANSWER ("nothing scheduled"), not the
  absence of one; a `busy.length > 0` guard anywhere in this path restores the blank canvas for
  exactly the case a user is most likely to misread as broken. The tool's **description and return
  strings are UNCHANGED** — the card is purely additive, so the model's behaviour and arguments are
  untouched (the skill-body-edits-shift-tool-args hazard is avoided by not editing prose at all).
- **`cards.tsx` `CalendarCard`** sits on the `SourceCard`/`OutputCard`/`EvaluationCard` footing —
  ABOVE the plan-status branches, self-reading its own row. An availability read is a pure-advice
  turn carrying **no plan row**, so a card gated behind plan status would never appear at all.
  It renders busy windows via `fmtBusyBlock` in **the row's `tz`**, never the browser's (the
  `fmtItemTime` display-honesty rule), an explicit clear state when `busy` is empty, and a
  truncation note when Microsoft's scan cap was hit (`truncated`) so a partial read can never read
  as a complete one — the `briefings.listedCount` cap-honesty rule.

**Invariant — the empty read must always write a row.** Verified by mutation, not by reading: adding
`if (res.busy.length > 0)` above the insert turns
`cockpitTools.test.ts` › *"an EMPTY availability read STILL writes a row"* red with
`expected [] to have a length of 1 but got +0`. Assertions are on the STORED ROW, never the reply
string — the reply was already correct while the bug was live, so asserting it would pass with the
card still missing (the mechanism-vs-behaviour trap this repo keeps falling into).

**Still true after this change:** Outlook has no inbox brief, because `briefInbox` is hardcoded to
`internal.gmail.*` and `graph.ts`/`delivery.ts` do not exist — that is Phase 25 (25-05/25-06/25-09),
not a rendering gap. The calendar card is provider-agnostic and already labels Microsoft correctly.

### Phase 17 — Wave 0 (freeze)

The Lane-K half of the serialized Stage-1 freeze, landed on a base that already carried Lane R's.
Output is a compiling repo with the calendar seams present and **inert**: no calendar HTTP call
exists, nothing can write `kind: "calendar_event"`, so the new arm is unreachable at runtime.

**A third `Arm` is STRUCTURALLY FORCED — the roadmap's "likely skippable" was refuted.**
`actionType.ts` used to promise "calendar in Phase 17" under `workflow`. That promise was wrong:

| Candidate | Why it fails |
|---|---|
| `inline` | `executePlan` is a `tenantMutation` (pinned by `dispatchGuard.test.ts:95`) and a Convex mutation **cannot `fetch`**. |
| `workflow` | That case **IS** the gmail fan-out (`cockpit.ts:496-505`). Classifying an external write as `workflow` silently inherits the EMAIL terminal. |

So `externalAction` = ONE governed external side effect, executed by the action-retrier behind the
Approve gate. Phases 18 (documents) and 19 (CRM) are the same mechanism and **reuse this arm**
rather than adding a fourth. The switch case is a **stub that throws** — deliberate, because a
silent no-op would mark a plan approved with nothing created. 17-04 replaces it.

**`plans.by_calendar_run` had to be caught before the freeze.** The action-retrier's `onComplete`
carries only `{runId, result}` — no context bag — so `deadLetter.onPipelineComplete` cannot be
reused and the run id is the *sole* correlation handle back to the plan. Without this index the
terminal cannot find its own plan. `calendarEventId`/`calendarRunId` are **not** `patchPlan` args:
nothing reachable from the model may write an event ref or a run id.

**Attendees are out of scope, enforced by ABSENCE.** `events.insert` with attendees makes GOOGLE
email them on the app's behalf — an outbound communication with no plan, no audit, no DLQ and no
PII scan. `calendar.ts` contains neither an `attendees` nor a `sendUpdates` key; 17-04 scans for
both substrings. Absence is a stronger guarantee than pinning `sendUpdates: "none"`, and fewer lines.

**`freeBusy.query`, not `events.list`** — it returns only busy `{start,end}` intervals, so titles
and attendee addresses never enter the system. That deletes the §4/§2-D problem by construction
rather than by a redaction layer.

**`parseSendTime` gained a 4th `horizonMs` parameter, defaulting to the existing constant.** The
7-day bound is a **Gmail-token-lifetime** constraint on DEFERRED SEND (a schedule past it finds a
dead token at fire time). A calendar event is created at **Approve** time, so that bound is simply
false here. Threaded through all three `classify` call sites so a bound cannot drift between
branches.

> ⚠ **Found while testing it: `parseSendTime` has NO month-name grammar.** `"January 30 at 3pm"`
> silently resolves to **today** at 3pm. The only shipped form that reaches past 7 days is
> `"in N hours"`. The horizon widening is real and correct, but **17-03's staging tool cannot rely
> on natural-language absolute dates** — a far-future event needs another route to an epoch.

**Drive-by fix, unrelated to Phase 17:** `replyToMessage` (Phase 3.11, RPLY-01) has been in
`agentSteps.tool` with no `VERB` entry since it shipped, so every inbox-reply trace row rendered the
generic "Working…"/"Done" fallback. Fixed here because 17-01 is the only Phase-17 plan permitted to
touch `cards.tsx`, and because the new `traceParity.test.ts` asserts set equality **both ways** —
leaving the gap would have made a brand-new test RED on arrival inside a freeze commit.

### Phase 17 — 17-02 (Calendar adapter + terminal)

**Invariant:** the Calendar arm is a two-module split. `calendar.ts` is `"use node"` and contains
only the availability and event-create actions; `calendarComplete.ts` is non-Node and is the sole
writer of plan status, Calendar audit rows, and Calendar dead letters for this arm.

### Phase 17 — 17-03 (Calendar tool staging)

**Invariant:** the Calendar tools stage only. `proposeCalendarEvent` writes `eventTitle`,
`eventStartMs`, `eventDurationMs`, and `eventTz` together with `status: "proposed"` and nothing
else; neither Calendar tool may reach the event-creation action.

### Phase 17 — 17-04 (Approve-only external action enforcement)

1. **The write is an action type, never a tool side effect.** `calendar_event` selects the
   `externalAction` arm, and the event is created only after the human fires `executePlan`.
   `llm.ts` may name `internal.calendar.freeBusy`; static enforcement forbids it from naming
   `calendar.createEvent` or any `calendarComplete` function.
2. **The third arm is structural.** `executePlan` remains a pinned `tenantMutation`, which cannot
   `fetch`, so `inline` cannot create an external event. `case "workflow"` is the Gmail request
   fan-out and would silently inherit the email terminal. Phases 18 and 19 reuse `externalAction`
   instead of adding a fourth arm.
3. **The arm stays split across two modules.** `calendar.ts` is `"use node"` and holds only
   `freeBusy` and `createEvent`; `calendarComplete.ts` is non-Node and is the sole writer of plan
   status, Calendar audit rows, and Calendar dead letters. A `"use node"` module cannot hold the
   `onCreateComplete` mutation, so moving it beside the action breaks deployment, not just tests.
4. **Availability remains content-free by construction.** It uses `freeBusy.query`, never
   `events.list`, and returns only `{start, end}` busy intervals. Introducing event titles,
   descriptions, or attendees reopens the §4/§2-D PII surface.
5. **Persisted scope is checked before Google work in both actions.** `gmailTokens.scope` is read
   and `hasScope` runs before `freshAccessToken`, because refresh can return `{ok:true}` for a grant
   that still lacks Calendar permission. Fixture-backed `freeBusy` reads precede even that check.
6. **Create retries are exactly-once.** `events.insert` receives the deterministic client-supplied
   base32hex id; a 409 duplicate means success. `crypto.randomUUID()` is not a valid substitute
   because Google event ids exclude hyphens and the letters `w`–`z`.
7. **Guest-delivery fields are absent on purpose.** `calendar.ts` contains neither `attendees` nor
   `sendUpdates`, and a mutation-verified static scan pins both absences. Otherwise Google could
   send invitations outside the plan, audit, DLQ, redaction, and request-row spine.
8. **Terminal payloads are refs/status/reason-code only.** A Calendar provider body may echo the
   summary, so it never reaches audit or dead letters. An incompletely staged plan terminates as
   `{status: 0, reason: "incomplete_stage"}` without retrying.
9. **ACTN-02 ships Google-only and create-only.** Microsoft/Outlook remains deferred (17-01 Q7);
   update and cancel remain deferred (17-01 Q3). The literal “schedule and manage” requirement is
   therefore not evidence that manage shipped. Later providers and operations are additive adapters
   and action types behind this same governed arm.
10. **`deliverApprovedPlan.ts` remains byte-unchanged.** It is the workflow-backed email entry
    point, not a universal dispatcher; routing Calendar through it would make Gmail fan-out
    reachable from a Calendar action.

### Phase 16 — 16-05 (the hosted search capability)

`webResearch` is **one more key of the ONE governed tool record** — never a second `generateText`.
A separate search-only loop would carry `tools:` and fail `dispatchGuard`'s *"exactly one
tool-bearing call site"*, which is the nested-loop hazard that test exists to document.

**Built only when granted, never filtered after the fact.** A filtered record still holds the
tool's closure and stays reachable via `invokeTool`. The grant rides
`agentContext.grantWebResearch`, set from `toolNames?.includes("webResearch")`.

> **Both spread branches share ONE type** — `...(grant ? webResearchTool : ({} as typeof
> webResearchTool))`, the shipped `omitRecipientEdits` trick. This is not style. A union of
> *differing* object shapes widens the inferred `TOOLS` into an index signature, which degrades
> `ai@7`'s `onToolExecution*` event types to a variant with no `toolCall` — and the CKPT-05
> callbacks stop compiling. Found the hard way; do not "simplify" the cast away.

**`invokeTool` now refuses a provider-executed tool explicitly.** `openai.tools.webSearch` has no
`execute` at all, so without the guard the cast yields `undefined` and a raw TypeError escapes from
a line that reads like an ordinary tool call. Provider-executed tools have no local execution path
BY DESIGN and must never appear in a `SMOKE::agent::` op or a test shim.

**Billing: counted on `providerExecuted`, not on a tool-name literal.** The 16-02 probe observed the
SDK surfacing the hosted call as `{"toolName":"web_search","providerExecuted":true}` — the
*provider's* name, not our record key. OpenAI bills per CALL on top of tokens and `priceUsage`
prices tokens only, so without the fee the shared envelope under-counts exactly the capability this
phase adds. Counting on the flag means it cannot drift when the provider renames anything.

> **§4 boundary on `sources`.** The URLs are CONTENT-PLANE. They may reach a vault document body and
> a tool's return string; they may NEVER reach an `audit` or `telemetry` payload. `AuditPayload`
> permits `readonly string[]`, so an array of URLs would **type-check** — that is the trap. Audit
> gets a COUNT.

**The wall clock (D11/D12).** `stopWhen` takes an ARRAY in `ai@7`, so the soft stop is a native
framework feature, not new infrastructure: the loop stops cleanly BETWEEN steps and keeps its
partial findings. An `AbortSignal` cannot deliver that — an abort THROWS and every partial finding
is discarded.

> ⚠ **The soft cutoff must NEVER be derived unconditionally from the budget.** For a default turn
> `45_000 − 60_000` is NEGATIVE and elapsed is always `>= 0`, so an unconditional soft stop is true
> on its FIRST evaluation and truncates **every** executive turn, **every** Growth OS specialist
> turn and the scripted shim at step 1. A cost floor cannot catch this — a one-step turn still
> prices correctly. The guard is the step-regression floor in `runCockpitAgent.test.ts`
> (*"a NON-research scripted turn runs all four tool steps"*), and it is **mutation-verified**.

`RESEARCH_MAX_STEPS = 12` is the **second** ceiling, not the binding one — the soft clock binds
first. It is sized against the SOFT cutoff (180s − 60s = **120s**), not the 180s wall clock: sizing
against 180s would make truncation routine around step 6-8, which is exactly what D12 forbids. It
exists to stop a loop that is cheap-and-fast but STUCK. If per-search latency rises, **lower this
rather than raising the clock**.

`callTimeoutMsFor` is the ONE chooser and is exported so the 45s default is *assertable*, not
assumed. The test pins a LITERAL `45_000` — an assertion written against `CALL_TIMEOUT_MS` would
track the very refactor it exists to catch.

## The externalAction arm (20-07) — TWO occupants, one Approve gate

Research Open Question 1, answered **GENERALIZE**. D2's own table lists *"approving the plan"* as a
legitimate generate path, and roadmap SC #3's *"plan-gated by construction"* is strongest when the
trigger IS the one shipped Approve gate. Routing a canvas Generate button around `executePlan` would
still have broken `actionTypeOf(plan.kind)`'s parameter type the moment `plans.kind` widened, forcing
an explicit `kind === "media"` refusal inside the dispatcher — a hole wearing a guard's clothes, and
two Approve stories instead of one.

`ACTION_TYPES` is now `["email", "memo", "calendar_event", "media"]`. `armFor("media")` is
`externalAction`, the same arm calendar uses.

### `EXTERNAL_TARGETS` — a table, not a framework

```ts
type ExternalActionType = {                       // DERIVED from _ARM_TABLE, not hand-listed
  [K in ActionType]: (typeof _ARM_TABLE)[K] extends "externalAction" ? K : never;
}[ActionType];

const EXTERNAL_TARGETS = {
  calendar_event: (ctx, a) => retrier.run(ctx, internal.calendar.createEvent,
    { planId: a.planId, tenantId: a.tenantId, correlationId: a.correlationId },
    { onComplete: internal.calendarComplete.onCreateComplete }),
  media: (ctx, a) => retrier.run(ctx, internal.media.submitBatch,
    { tenantId: a.tenantId, batchId: a.batchId ?? "" },
    { onComplete: internal.mediaComplete.onSubmitComplete }),
} satisfies Record<ExternalActionType, (ctx: MutationCtx, a: ExternalArgs) => Promise<unknown>>;
```

**THUNKS, not a `{action, args, onComplete}` record.** Each action has its own argument validator —
`createEvent` takes `{planId, tenantId, correlationId}` and `submitBatch` takes `{tenantId,
batchId}` — so a shared record would force TS to union the function reference and the args
independently, losing the correlation, and a shared ARG OBJECT would pass `correlationId` to
`submitBatch`, which its validator rejects. Each thunk type-checks against its own target.

**The `ExternalActionType` derivation is the guarantee.** Mark a new type `"externalAction"` in
`_ARM_TABLE` and `EXTERNAL_TARGETS` is instantly incomplete — a COMPILE error, not an `undefined`
target at runtime. Observed 2026-08-02: `Property 'media' is missing … but required in type
'Record<ExternalActionType, …>'`. A hand-written union would have accepted the new member silently.

> **ONE-LINE HAND-OFF TO PLAN 20-16, and 20-16 is the ONLY plan permitted to take it.** Today
> `media` starts the submit fan-out only. When the reel chain lands, 20-16 re-points that ONE thunk
> at the chain entry (which itself calls `submitBatch` first). The arm shape does not move again.

### The per-type pre-step, and why it runs BEFORE the CAS

`calendar_event` has no pre-step — **that absence is what keeps the calendar path byte-identical.**

`media` reserves the WHOLE reel: `reserveJobInner(ctx, {tenantId, planId, blocks: plan.shots,
clipSeconds, withCaptions: true})`. It runs **before** `patch({status: "approved"})`, so a refused
reel leaves the plan at `proposed` with **zero `mediaJobs` rows, no `renderStatus`, and nothing
scheduled**. Mutation check, observed RED 2026-08-02: move the pre-step after the CAS patch and six
assertions fail with `expected 'approved' to be 'proposed'`.

**Because the reservation runs inside `executePlan`'s own mutation, it is in the SAME serializable
transaction as the `proposed → approved` CAS.** That is what makes *approve once, reserve once* true
with no second idempotency mechanism — and it is why plan 20-04 exposed `reserveJobInner` as a plain
async function: a Convex mutation cannot `runMutation`.

`renderStatus: "pending"` is set in the SAME patch as `approved` — a reel that has been paid for but
not yet rendered is a state the canvas must be able to name, and there must be no window where it is
neither.

`withCaptions` is **pinned `true`** — there is no schema field and no toggle until the canvas
(20-09). Fail-closed direction: an unused STT line costs $0.008; an unreserved one that IS used is
spend outside the rail.

### The refusal reasons `executePlan` can now return

`executePlan`'s return union grew by eight. Every one is a **governed stop that names a lever** —
only bugs throw. **Plan 20-10's canvas renders these.**

| reason | the lever |
|---|---|
| `no_deck` | no storyboard, an empty one, or a shot type the price table does not know |
| `kill_switch` | the global OR the media pause — call the operator |
| `unknown_model` | the endpoint was renamed; nothing is priced. Free, loud, correct |
| `over_job_cap` | cut blocks or drop a tier |
| `illegal_duration` | a clip length outside {5,10} |
| `narration_too_long` / `narration_too_short` | rewrite that line |
| `media_daily_exhausted` | this tenant's day is spent |
| `deployment_media_exhausted` | the keyless ceiling — not this tenant's fault, and it says so |

`no_deck` is `executePlan`'s own (returned before `reserveJobInner`); the rest are `ReserveRefusal`,
re-exported from `media.ts` so the two unions cannot drift.

### Run ids do not share a column

`calendarRunId` stays CALENDAR's — `calendarComplete` resolves through `by_calendar_run` and would
happily match a media run written into it. A media approval writes `mediaRunId`, indexed
`by_media_run`, because the action-retrier's `onComplete` receives **only `{runId, result}`** (no
context bag — verified against `@convex-dev/action-retrier@0.3.1`'s `RunOptions`), so the run id is
the sole correlation handle back to the plan.

### D2 is NOT weakened by the media occupant

The trigger is a **HUMAN clicking Approve on a plan row.** No dispatched specialist can reach it:
`SPECIALIST_TOOLS` is `["searchVault"]`, and there is no code path from a dispatched specialist to a
fal POST, a TTS submit or a sandbox render. Plan-gated by construction is **structural**, and plan
20-08's static scan proves it.

### The calendar regression — the honestly-stated cost of generalizing

`cockpit.test.ts` keeps every pre-existing calendar assertion **unchanged and green**, plus two that
only become checkable once a second occupant exists: a calendar approval moves **neither media
window** and sets no `renderStatus`, and `deliverApprovedPlan.ts` mentions no calendar/media symbol
at all — it is the workflow-backed EMAIL entry point, **not** a universal dispatcher.

`dispatchGuard.test.ts`'s arm scan was UPDATED, not weakened: its subject moved into
`EXTERNAL_TARGETS`, so it now asserts **each occupant's own** action + terminal in the table, that
the case dispatches through `EXTERNAL_TARGETS[...]` rather than naming a target inline, and that
`reserveJobInner` is present in the arm. `workflow.start`/`deliverApprovedPlan` stay forbidden there.

## Phase 16 — the async research dispatch seam (16-06, DISP-02)

**This is a second CALLER of the shipped dispatch path, not a second path.** The whole chain
already existed for the Growth OS specialists: `applyActOnGap` →
`ctx.scheduler.runAfter(0, internal.dispatch.runSpecialist)` → `dispatchAndLand` →
`governedDispatch` → `landSpecialistResult` → an approvable memo card, with the CKPT-05 `agentSteps`
trace streaming while it runs. 16-06 adds a second entry point onto it. If a change here starts
inventing a job table, a polling query, a second terminal or a second landing, something has been
misread (CLAUDE.md §8 rung 2).

### Stage → schedule → land

`dispatchResearch` (a `buildCockpitTools` key) does exactly three things and **awaits nothing that
runs a model**:

1. `internal.plans.stageResearchPlan` — the `collecting` memo row the run will land on.
2. `ctx.scheduler.runAfter(0, internal.dispatch.runResearch, {...})` — depth `1`, `ancestry: []`,
   `envelopeCents: 0` (the ROOT signal), `route: "research"`, and the QUESTION.
3. return `RESEARCH_UNDERWAY_REPLY`.

`rootRequestId` is the **executive `turnId`**, not a fresh uuid. `applyActOnGap` mints its own
because a tapped control has no turn to inherit from; a tool call does, and 16-09's
`webSearchCallsForThread` join warns against mixing the two. `depth: 1` matches `applyActOnGap` —
not 0; a divergence there silently changes what `MAX_DEPTH` means for this route.

**Why async, and why it is not a regression.** Hosted `web_search` is the slowest operation in the
system and a research run makes several deliberately varied searches. Holding a conversational turn
for that is the wrong shape — and a loop that overruns its clock THROWS, killing the whole executive
turn and discarding every partial finding. Async moves the failure into the background where D11's
wall-clock row catches it as a governed outcome.

> **`dispatchGuard.test.ts:16-24` was RE-READ and deliberately LEFT UNAMENDED.** That comment argues
> against a `generateText` inside a tool's `execute` and prescribes the fix in as many words:
> *"dispatch RETURNS to the orchestrator, which starts the specialist loop as its own governed
> call."* That is a verbatim description of what this seam ships, so the comment is not merely
> un-contradicted — it is SATISFIED, and it was the comment that predicted the right architecture.
> The superseded in-loop design (D9) would have contradicted it; that design was not built. Do not
> "finish" an amendment that was correctly not started.

### SC#1 is satisfied VIA THE PLAN CARD, not inline — an ACCEPTED COST

SC#1 says the specialist "returns findings to the executive agent". Phase 16 returns them as an
approvable memo plan card, and the executive never sees the prose: `buildAgentContext` renders a
memo plan as `Body drafted: yes/no` only. D9-REVISED accepts this in writing. **A verifier must not
read SC#1 as requiring an in-conversation return.**

That same fact is why there is **no `researchFindingsFence` call in `llm.ts`**: the memo BODY never
reaches the model, so there is no re-entry boundary here to fence. The fence wraps the STORED vault
document (16-07), where web-derived text genuinely can re-enter a model context via a later
`searchVault` retrieval.

### The `collecting` interlock — and why it replaced the per-turn envelope closure

`plans.by_thread` is `.unique()`, so a thread has exactly ONE plan row. A research run OWNS it at
`status: "collecting"` + `kind: "memo"` until `landSpecialistResult` flips it, and
`stageResearchPlan` refuses to recycle such a row (`research_in_flight`). A second research dispatch
on the same thread is therefore refused **while the first is in flight, by a PERSISTED interlock** —
strictly stronger than the in-memory per-turn closure the superseded design threaded through call
args: it holds across turns, across requests, and across a fallback retry that rebuilds the tool
record. Each run takes exactly ONE freshly-derived root envelope, byte-identical to what every
`actOnGap` dispatch does. Nothing to thread, nothing to drift.

The interlock is scoped to the in-flight window **by design**: once the row flips to
`proposed` + memo it is recyclable again, so a later sequential dispatch legitimately takes a second
envelope. 16-08's cost-ceiling row is the rail that governs that case.

> WARNING — **`kind === "memo"` in that refusal is load-bearing, not decoration.** `cockpit.ts`
> inserts EVERY thread's plan row at `status: "collecting"` on the first turn and it stays there for
> the whole composition. A bare `status === "collecting"` refusal — which is how 16-06's plan first
> wrote the rule — would refuse research on essentially every live conversation, i.e. the primary
> use case. A collecting row is "owned by a dispatch" only when a dispatch staged it, and `kind` is
> what records that.

### `stageResearchPlan`'s recycle rule is DELIBERATELY narrower than `applyActOnGap`'s

| row | `actOnGap` | `stageResearchPlan` |
|---|---|---|
| `collecting` + `kind: "memo"` | recycles | **refuses** — `research_in_flight` |
| `collecting`, empty composing row | recycles | recycles (the fresh-thread path) |
| any actable row carrying the user's draft content | recycles | **refuses** — `draft_in_progress` |
| `proposed` + memo, `canceled` | recycles | recycles |
| `approved` → `done` | refuses (`plan_busy`) | refuses |

`actOnGap` may reset a draft because the **USER** tapped a control. Here the **MODEL** decides, and
destroying a half-composed email because someone asked a research question is not a trade the user
agreed to. "Draft content" is the five slots a person fills: recipients, subject, body, bodyIntent,
attachments.

**Do NOT refactor the two into a shared helper.** The rules disagree, so sharing would need the rule
as a parameter — a knob for two callers that disagree is the abstraction §8 forbids. They
cross-reference each other in comments instead; change one and decide consciously whether the other
moves.

*ponytail:* refusing rather than staging a second row. The real fix is more than one plan row per
thread — a `schema.ts` change, frozen this phase. Upgrade path, not a final answer.

### The `grantDispatch` gate — the executive is the only agent that dispatches

`dispatchResearch` is CONSTRUCTED only when `agentContext.grantDispatch` **and** a real
`threadId`/`rootRequestId` are present. Structural absence, not post-hoc filtering: `llm.ts`'s own
comment records that a withheld-but-constructed closure "would still exist in the record and stay
reachable via `invokeTool`" — and this tool hardcodes `depth: 1, ancestry: []`, so a re-entry
through that path during a SPECIALIST turn would bypass `MAX_DEPTH` and `wouldCycle`, the two guards
this seam claims to inherit for free.

`grantDispatch` is derived in `runAgentLoop` from `toolNames === undefined`, beside 16-05's
`grantWebResearch: toolNames?.includes("webResearch")`. **`runAgentLoop` is the one place `toolNames`
is in scope** — `buildCockpitTools` takes positional args and the filter is applied AFTERWARDS to
the returned record — which is why the gate reads a derived flag rather than the expression. One
mechanism, two flags, pointed in opposite directions: grant the specialist hosted search, withhold
dispatch from it.

### The honest fallback body — paid at the seam, not with a route conditional

`landSpecialistResult`'s no-body branch falls back to `buildMemo(evaluationRow, gap, reason)` and,
when neither exists, to `LOST_CONTEXT_MEMO` — *"the evaluation it was based on is no longer on file.
Ask me to run the assessment again."* **A research run has no evaluation row and no gap, so it lands
there EVERY time**, and that sentence is simply false for it: the user is told to re-run an
assessment they never started. Fixed once, with one `??`: `landSpecialistResult` takes an optional
`fallbackBody`, `dispatchAndLand` takes an optional 4th parameter that forwards it (and forwards the
governed refusal's own `reply` instead when the caller supplied one — those replies are already
written to be read by a user). `runSpecialist` passes nothing, so **the gap path is byte-identical**.

### Two write sites, ONE `stepKey` literal

`governedDispatch` mints its own `turnId` and writes a `stepKey` of `dispatch:<rootRequestId>`. The
executive's own `dispatchResearch` step row is emitted by the SDK's `onToolExecutionStart` under the
EXECUTIVE turnId. Never two rows in one trace, and 16-09's `webSearchCallsForThread` join
discriminates on `stepKey.startsWith("dispatch:")` — written on this path exactly as on the gap
path. Do not add a second literal and do not suppress either write.

### D11's three-way incomplete marker now reaches `DispatchResult`

`governedDispatch` keeps `spentAfter >= envelopeCents` as the COST condition, ORs in the loop's own
`truncated`, and carries `incompleteReason: turn.truncatedReason ?? (costCondition ? "cost" :
undefined)` — so the loop's stop reason (`"steps"` / `"clock"`) wins when both are true, because it
is what actually stopped the run. `incomplete` stays a boolean, so no existing consumer changed.
`sources` and `retrievedAt` ride the same result as CONTENT-PLANE fields for 16-07; the audit
payload gets `webSearchCalls`, a COUNT.

### Testing this offline

`dispatch.test.ts` stubs `OPENAI_API_KEY` to `""` for the whole file. That is not hygiene — it is a
COST guard: `convex-test` RUNS scheduled functions rather than queueing them, so the executive-turn
tests actually execute `internal.dispatch.runResearch`, and on any box with the key exported (every
box that runs the live evals) a unit test would fire a genuine, billed, hosted-web-search run.

`__runSpecialistWithScript` gained `softCutoffMs`, the SOFT-stop-only test knob and the only way
D11's wall-clock row is assertable offline. **It must never become a hard-budget override:** a
shrunken `AbortSignal.timeout` would race the mock loop and throw `agent_timeout` — the exact
discard-the-work outcome the row exists to disprove. Do not add a `timeoutMs` sibling.

The research MODEL pin is asserted HERE, not in 16-05: `governedDispatch` resolves the route through
`SPECIALISTS` before the loop runs, so no harness hands `runSpecialistTurn` a `skillName` literally.
The assertion is token equality on the RETURNED `modelId`/`fallbackModelId` — never a source grep,
and never an inference from `costUsd`, because `RESEARCH_MODEL` currently EQUALS `DEFAULT_MODEL` and
the two price identically. **The FALLBACK pair is the non-vacuity anchor:** the 16-02 probe ladder
excludes `gpt-4.1-nano`, which IS `CHEAP_MODEL`, so the fallbacks can never coincide.

### Phase 16 — 16-07 (the findings terminal, bolted onto `runResearch`)

The vault write is a DISPATCHER terminal, `persistResearchFindings` in `dispatch.ts`, calling
`internal.research.persistFindings`. It runs **after `dispatchAndLand` has returned**, which is the
whole error-handling argument: the landing already flipped the plan row to `proposed`, so the user
has the findings on an approvable card before the persist is attempted. A persist failure is
therefore audited (`research.persist_failed`, reason CODE only — never `err.message`, §4) and
swallowed; the `DispatchResult` is returned unchanged. **No retry, no dead-letter, no compensating
write.** The failure costs groundability, not the work.

Three placements are deliberate and should not be "tidied":
- **NOT a tool the specialist calls.** SC#1's containment is that the research specialist has no
  write capability. A "save my findings" tool re-opens the privilege-escalation path.
- **NOT inside `governedDispatch`** — that would put a route conditional inside the shared spine.
- **NOT inside `landSpecialistResult`** — that would thread `sources`/`retrievedAt` through a
  mutation with no business knowing about them.

`DispatchResult` gained an optional `vaultDocId`, present ONLY when a research run's persist
succeeded. A governed refusal persists NOTHING: a paused conversation is not a finding.

`__runSpecialistWithScript` gained a second test knob, `research: v.optional(v.boolean())`, for the
same reason `softCutoffMs` exists — a `LanguageModel` is not Convex-serializable, so `runResearch`
itself can never be driven offline, and without the flag the persist wiring would be code no test
can reach. Absent ⇒ the gap path, byte-identical. The document's own contract lives in `vault.md`
(`### Phase 16 — 16-07`).

### Phase 16 — the research degradation contract

D11 is a table of governed outcomes, not a promise that a provider usually behaves. These are the
offline proofs an operator can run without a deployment, network, or bill:

| Failure mode | Governed outcome | Proving test |
|---|---|---|
| Search call errors | retryable provider errors use the research fallback; non-retryable errors propagate | `search call errors: retryable failures fall back, non-retryable failures propagate` |
| Zero results | stored findings say `insufficient evidence`, regardless of confident prose | `zero sources ⇒ 'insufficient evidence', however confident the body claims to be` |
| Sources contradict | the contradiction section survives the storage fence intact | `sources contradict: the contradiction section survives storage intact` |
| Cost ceiling | keep partial output, mark the card with the cost sentence, then refuse the exhausted envelope exactly | `cost ceiling: partial output lands, then the exhausted envelope refuses exactly` |
| Step budget | stop between steps, keep partial findings, use the distinct step sentence | `step budget: partial findings land with the distinct steps marker` |
| Wall clock | stop between steps, keep partial findings, use the distinct clock sentence; never throw `agent_timeout` | `wall clock: partial findings return and land with the distinct clock marker` |

The companion guards are `three-way marker distinctness: cost, steps and clock differ on the plan
card` and `ONE literal, not two: hosted search emits no step while local searchVault does`.

Mutation-verification ledger (each mutation was applied, observed RED, and reverted):

| Plan | Absence/invariant assertion | Exact mutation | RED observed |
|---|---|---|---|
| 16-05 | non-research turns keep their step floor | derive the soft cutoff unconditionally from the budget | yes |
| 16-05 | only research gets the 180-second timeout | collapse `callTimeoutMsFor` to the 45-second default | yes |
| 16-06 | a second in-flight research run is not scheduled | delete the `collecting` + memo interlock | yes |
| 16-06 | user draft rows are not recycled | delete the `draft_in_progress` refusal | yes |
| 16-06 | specialists cannot construct `dispatchResearch` | remove the `grantDispatch` construction gate | yes |
| 16-06 | non-research routes do not inherit the research model pair | collapse the research model ternary | yes |
| 16-07 | confident prose cannot erase the zero-source verdict | disable the `sources.length === 0` branch in `researchFindingsFence` | yes |
| 16-07 | step/cost/clock markers cannot collapse into one sentence | collapse the steps marker onto cost | yes |
| 16-07 | one tenant cannot read another tenant's findings | remove tenant scope from `vault.listVaultDocs` | yes |
| 16-08 | withheld write tools cannot move the plan row | add `proposePlan` to `RESEARCH_TOOLS` | yes |
| 16-08 | provider-hosted search emits no local activity row | add the `web_search` schema literal and emit a hosted-search step | yes |
| 16-08 | the wall clock never discards partial findings | make the soft clock predicate throw instead of return `true` | yes |
| 16-08 | clock/step markers survive the real card landing | omit `incompleteReason` from `landSpecialistResult` | yes |
| 16-08 | audit payloads contain no question, URL/`http`, or specialist prose | add `question`, `sourceUrls`, and `specialistProse` to `research.persisted` | yes |

This is the CODE proof: scripted models prove deterministic degradation and containment. Plan
16-09 is the PROMPT proof: the eval gate measures grounded, useful, injection-resistant research
answers. Neither proof substitutes for the other.

## The created-artifact surface — what the agent may say about it (2026-08-14)

From a real transcript. The user asked for a slide deck, got one, and then could not find it:

> **User:** Okay, where is the slide deck? I want you to open it in the workspace so that I can see it.
> **Agent:** I can't open files directly in the workspace, but you can easily access the slide
> deck by downloading it from your vault.

**The agent was wrong, and the product was working.** `OutputCard` (`cards.tsx`) renders the
full artifact text in the workspace, ungated by any plan row (it sits above the plan-status
branches with `SourceCard` and `EvaluationCard`, because a creating turn carries no plan row at
all). Four separate causes stacked into one bad conversation.

### 1. The preview was pinned to document #1

`OutputCard` held `useState(0)` and never reconciled it as `docIds` grew. `titles`/`docIds`
ACCUMULATE over the conversation (18-06), so a thread that created three artifacts previewed the
OLDEST while the user asked where the newest was. Recoverable by clicking a title — if you knew
to click.

Now `previewIndex(count, picked)`, **exported and pure**: `null` follows the newest, a number is
an explicit click and wins, an out-of-range pick falls back to the newest rather than blanking
the preview. Exported deliberately — a source scan for `picked ?? newest` passes with the
arithmetic wrong, so the rule lives somewhere a test can CALL it (the 19.1 `ImportDone` lesson).
Mutation-checked: restoring `picked ?? 0` reds four tests.

### 2. A model reports its TOOL inventory as the PRODUCT's capability

There is no `openInWorkspace` tool, the skill body says only that `createDocument` "saves it to
their vault", and the tool's success sentence named no location. Given all three, "I can't open
files in the workspace" is the honest answer from where the model was standing.

**The fix is the tool RESULT, not the skill body.** A tool result is a driver-plane string —
code-owned, free to change, no eval gate — and it is the most immediate thing the model reads.
`createDocument` now returns `… It is already open in the workspace for the user to read.`

> **Rule.** When the model is asked whether the product can do X and answers from its tool list,
> the gap is knowledge, not capability. Close it at the cheapest layer that carries it: tool
> result first, tool description second, skill body only at the next certification.

### 3. It claimed a format that does not exist

Asked for "the slide deck in pptx", the agent replied that it had created one "in PowerPoint
format". `createDocument`'s schema is `{topic, form, replace?}` — there is **no format
argument** — and `DocFormat` is `pdf | html`. No pptx path exists anywhere in the repo. The old
success sentence named no format, so nothing contradicted the invention.

The result now names the real artifact (`Written as markdown, with a PDF to download.`) and the
tool description says `never PowerPoint, Word or slides`. A format claim now has to contradict
the model's own tool result to be made. Same defect class as `provenance-laundering`: **ask what
the stored/returned record actually says, and whether the model can talk over it.**

### 4. A refusal that only the OTHER party could act on

`proposeImage` refused with `draft_in_progress` → *"Tell the user to finish or discard it
first."* The user answered "im ready, proceed", which is not a discard, and the turn deadlocked
— while `resetPlan` sat unused in the model's own toolbox. The refusal now says: ask, and on a
yes call `resetPlan` and retry.

> **Rule.** A refusal string that ends in an instruction the model cannot carry out is a dead
> end. Name the lever the model holds, or say plainly that there is none.

### The interlock (2026-08-14) — two refusals `stageMediaPlan` was missing

`dispatchMedia` fired on three consecutive turns of a SLIDE-DECK conversation. Tracing it found
two distinct gaps, and the second is the one the user actually felt.

**1. `dispatch_in_flight` — the missing copy of `research_in_flight`.** `stageMediaPlan` leaves
the row `kind: memo` + `collecting`, which is exactly the shape `stageResearchPlan` refuses as
`research_in_flight`. This function is documented in its own header as *a SECOND copy of that
shape*, and the copy DROPPED that check — the one that makes "one run per thread" true. A second
dispatch did still refuse, but as `draft_in_progress`, whose reply describes an email draft the
user does not have. So the agent relayed a sentence about a draft that did not exist.

**2. `image_proposal_pending` — a staged proposal is not a spent deck.** `userWork` excludes
`kind: "media"` on the reasoning that a media row holds a PREVIOUS deck. That is true of a deck
already generated or abandoned, and false of one staged moments ago — and `mediaMode: "image"`
rows are `kind: "media"` too. So `proposeImage` staged an image, the next `dispatchMedia`
recycled the row out from under it, the user never saw the image they were told to review, and
the following `proposeImage` then refused against the memo the dispatch had just written. That
is the whole deadlock, and none of it was visible to the user as anything but a loop.

`jobs.length === 0` is what makes "un-acted-on" precise rather than a guess: the moment the user
clicks Generate a row exists, and a spent proposal may be recycled. **A reel replacing a reel is
the intended flow and is deliberately still allowed** — pinned by its own test, because an
interlock that also blocks the happy path is a worse bug than the one it fixes.

Both replies name the lever: `image_proposal_pending` says ask, then `resetPlan`.
`dispatch_in_flight` deliberately names none — there is nothing to reset, the run lands on its
own, and the honest instruction is to wait.

⚠ **Mutation-checking these needed care, and nearly did not happen.** `plans.ts` is LF while much
of this repo (docs, `.planning`, several `apps/web` files) is CRLF. A first mutation pass used
`\r\n` anchors, silently matched nothing, and reported both interlocks GREEN with the code
supposedly removed — the exact `green-tests-over-broken-capability` shape, arrived at while
trying to avoid it. **Assert the anchor is unique and the write actually changed the file BEFORE
trusting a mutation result**: from the output alone, a no-op mutation and a vacuous test are
indistinguishable.

### Still open, and NOT fixed here

**The ROUTING half is still open.** `dispatchMedia` was reachable at all for a slide-deck DESIGN request — the
video-reel specialist, for a document. `MEDIA_UNDERWAY_REPLY` says "do not ask for a reel again
on this conversation", but that is advice to the model rather than an interlock, and
`stageMediaPlan` recycles a `kind:"media"` row with no live jobs — so each retry silently RESET
the previously staged proposal. Two candidate fixes, and they cost very differently: a code-side
interlock (a media dispatch in flight refuses a second one), or a skill-body routing rule (a
registry row, so a candidate seed + a paid eval gate + owner activation).

**OWNER ASSIGNED 2026-08-14: plan 20-12**, which already carries a `cockpit-agent` body edit
and a paid gate. The rule is folded into its scope with the wording drafted, rather than
paying a second gate for one paragraph. Two companions ride with it — that the tool writes
markdown and a PDF and NEVER pptx/docx/slides, and that a created document appears in the
WORKSPACE as well as the vault. Both are already in the tool result and the tool description,
which is the cheap layer; the body is the durable one, and it is the only layer the model
reads BEFORE choosing a tool.

20-12 also gains a NEGATIVE fixture (`38b-media-not-a-document`). Fixture 38 proves only that
ordinary video language REACHES `dispatchMedia`; nothing proved a document request does not.
A gate that only ever asserts the positive cannot catch a tool being over-selected, and this
defect is exactly that shape. The negative case runs in the same paid gate at no extra
authorization.

### How to verify

`apps/web`, `npx vitest run "app/(app)/dashboard/workspace/outputCard.test.ts"`. The selection
rule is behaviour-tested and mutation-checked; the three agent-facing sentences are pinned at
the source, which is all a free test can do for a string the model reads — behaviour coverage
for those lives in the paid eval fixtures.


## Phase 17 gap closure — the `calendar_manage` substrate (17-05)

*Added 2026-08-11 by Plan 17-05. Plans 17-06 … 17-11 build on this and must not re-litigate it.*

### What this plan did NOT do

`17-VERIFICATION.md` (2026-08-10) records Phase 17 as `gaps_found`: ACTN-02 says *schedule and
manage* events for *Google / Microsoft*, and the shipped slice is **Google-only and create-only**.
17-05 closes neither gap. It adds no Microsoft endpoint, no OAuth grant, no update, no delete, no
`If-Match` and no 412 handling. Everything below is compile-time and persistence groundwork whose
only job is to make 17-06 … 17-09 additive.

**The shipped Google create path is byte-unchanged and stays the positive regression anchor.**

### Invariants

1. **`calendar_event` is CREATE. `calendar_manage` is UPDATE/DELETE. They are two action types on
   purpose.** Create has no concurrency problem; management does (etag / `If-Match` / 412), and the
   two cards promise different things. Do not repurpose `calendar_event`, and do not add a type per
   provider — the provider is a closed FIELD (`plans.calendarProvider`), so both providers and both
   operations share one arm.
2. **`CalendarManageOperation` is `update | delete`, and it is closed.** "Move"/"reschedule" map to
   `update`; "cancel"/"remove" map to `delete` (`@pikar/core/calendarManagement`). A verb outside
   the alias map is REFUSED, never guessed.
3. **`delete` means delete — never the provider's cancellation flow.** Google's `sendUpdates` and
   Graph's `/cancel` email the attendees on the app's behalf: an outbound external communication
   with no plan, no audit, no dead letter and no redaction pass. They are out of the vocabulary
   entirely rather than guarded by a parameter default.
4. **Management is limited to Pikar-created, attendee-free, etag-bearing rows in `calendarEvents`.**
   `manageability()` is the single gate and it returns a CODE (`not_found` / `attendees_present` /
   `needs_inspection`). Arbitrary mailbox event discovery stays out of reach because 17-09's
   listing reads the registry, not the provider.
5. **An absent `calendarProvider` MEANS GOOGLE.** Every Phase-17 create row predates this plan and
   is a Google row, so there is no migration and no backfill. `parseCalendarProvider(undefined)`
   is the one place that decision lives; an UNKNOWN value throws rather than falling back, because
   a silent fallback would aim a Microsoft-shaped operation at a Google calendar.
6. **The registry is the FACT plane; the plan row is the PROPOSAL plane.** `resetPlan` clears all
   five proposal fields and touches no `calendarEvents` row. That asymmetry is the whole reason the
   registry is a table rather than more `plans` columns: a user typing "start over" in a thread
   must not erase our record of events that still exist on a real calendar.
7. **`patchPlan` stages `calendarProvider`, `calendarOperation` and `calendarManagedEventId` — and
   NOTHING else.** `calendarExpectedEtag` (the `If-Match` value) and `calendarFailureCode` are
   deliberately not args, and the ABSENCE is the guarantee: a model-suppliable etag is precisely the
   stale-overwrite path G2 exists to close, and a model-writable failure code would let the loop
   claim an operation failed — or that it did not. 17-09 copies a FRESH etag server-side through its
   own internal mutation (the `persistStoryboard` precedent); 17-08's terminal writes the code.
8. **`calendarEvents`' composite index is TENANT-FIRST** (`by_tenant_provider_external`). Two
   tenants can legitimately hold the same provider event id, and a Convex index query must eq its
   prefix in order — so the tenant predicate is unwritable-to-forget, not merely conventional.
9. **Failure reaches the user as a CODE, never provider prose.** `CALENDAR_FAILURE_CODES` has eight
   members. A Google 400 or a Graph 412 body can echo the event summary straight back (§4).
10. **Microsoft management is UPDATE-only, and the missing verb is NAMED** (ADR-023). Google keeps
    create · update · delete; Microsoft gets create · update · —. A Microsoft cancel produces
    `provider_unsupported` before any token, GET or write: never a no-op, never a best-effort
    delete, never a fallback that leaves the event live. ACTN-02 closes as *"management, minus
    Microsoft delete"*, in those words, wherever it is ticked.
11. **`provider_unsupported` is NOT `provider_error`.** The catch-all means "the provider said no
    this time" and a card may offer a retry; this one means "we will never send this request".
    Rendering them the same way promises the user a retry that cannot exist.
12. **Microsoft UPDATE is reachable only behind a probe bound to THIS deployment and THIS account.**
    `PHASE17_GRAPH_PROBE` unset is the normal, safe state; setting it enables nothing by itself,
    because the deployment and tenant hashes inside must match the ones recomputed at call time.

### The inert seam, and who replaces it

| Seam | State today | Owner |
|---|---|---|
| `EXTERNAL_TARGETS.calendar_manage` (`cockpit.ts`) | the REAL `retrier.run(internal.calendar.manageEvent)` thunk + `onManageComplete` | **DONE** (17-08 Task 3) |
| `microsoftCalendarTokens` | table exists, nothing writes it | **17-06** (OAuth flow) |
| `calendarEvents` | written by BOTH terminals, read by `manageEvent`, listed by `listManageable`; `stageChange` refreshes it atomically with the proposal | **DONE** (17-09) |
| `internal.calendar.manageEvent` | started ONLY by a human Approve on a `calendar_manage` plan | **DONE** (17-08 Task 3) |
| `listManagedCalendarEvents` / `proposeCalendarChange` trace literals + VERBs | local executable tools; trace rows render code-owned verbs | **DONE** (17-09) |
| `calendar-manage-plan-card` | renders provider, operation, refreshed original event and only changed desired fields | **DONE** (17-09 Task 3) |

### Discovery and staging order (17-09)

`listManagedCalendarEvents` is a read of `calendarEvents`, never a provider search and never a lazy
migration. It scans at most 100 active tenant rows, applies the shared `manageability()` gate, sorts
by start descending, and returns at most **20** rows. Each row carries the stable Convex
`managedEventId` plus provider/title/start/duration/tz. Omitted unsafe rows are counts only;
truncation is explicit. Deleted, foreign, attendee-bearing and etag-less rows never cross into the
model turn. Title/time are content-plane values already visible on the plan card and never enter
audit, trace, notification or telemetry payloads.

`proposeCalendarChange` accepts that opaque ref and the closed `update | delete` operation. It does
not accept a provider event id, etag, epoch, timezone or cancellation comment. The order is:

1. refuse delete content, empty updates, and ambiguous/past/unsupported natural-language time;
2. tenant-check the registry ref and recover provider + external id server-side;
3. run the provider-neutral **inspect-only** action;
4. refuse missing, reconnect-needed, attendee-bearing or etag-less snapshots with no plan proposal;
5. run exactly one `calendarEvents.stageChange` mutation, which re-checks tenant/active/plan state,
   refuses if another in-app stage changed the stored etag during inspection, refreshes the registry
   snapshot and writes `kind: calendar_manage`, `status: proposed`, fresh `calendarExpectedEtag`,
   operation/ref and actual desired overrides atomically.

There is no call after step 5. In particular the tool slice names no create/manage provider writer,
retrial terminal or `executePlan`. Provider-side changes after staging remain protected by the
existing approval-time `If-Match`; the fresh etag is the version the human sees and approves.

The card reads the refreshed registry through tenant-scoped `calendarEvents.forCard`. Update shows a
CURRENT EVENT block and a PROPOSED CHANGES block containing only changed fields. Delete has no
proposed-content block, uses the established destructive button treatment, and says the event
remains until Approve without promising attendee notifications. `calendarFailureCode` renders
static conflict/attendee/reconnect/unsupported copy and an explicit restage or reconnect path.

A throw inside `executePlan` aborts the whole Convex mutation, so the `status: "approved"` patch
that runs before the target thunk rolls back with it. That rollback — not statement ordering — is
what makes "no run id and no plan-state patch" true, and `cockpit.test.ts` asserts it against a
manually seeded row.

### The card cannot name the original event yet, and says so

`PlanCard` receives the plan row only. The original event's title and time live in the registry,
so the card renders the managed-event **reference** and labels the staged values "New title" /
"New time" / "New length". Reconstructing an "original" from the desired state would be the
provenance-laundering failure this codebase has already had three times. 17-09-03 adds the
registry read; until then the reference is the honest maximum.

### How to verify

```
node scripts/run-calendar-test-gate.mjs --timeout-ms 45000 --test-timeout-ms 20000 \
  --hook-timeout-ms 10000 -- convex/calendar.test.ts
cd packages/backend && npx vitest run convex/plans.test.ts convex/cockpit.test.ts convex/traceParity.test.ts
pnpm --filter @pikar/core typecheck && pnpm --filter @pikar/web typecheck
```

`run-calendar-test-gate.mjs` exists because the 2026-08-10 verifier saw three Calendar runs emit no
result at all (66.2s / 71.8s / 55.3s). It gives the run a hard wall clock, kills it, and asserts
exit 0, `numTotalTests > 0` and `numPassedTests === numTotalTests`. **A timeout is diagnosed, never
converted into a pass.** At HEAD on 2026-08-11 the file passes 39/39 in 9.6–14.5s cold and warm, so
those verifier timeouts are recorded as environmental, not as a Calendar defect.

---

## Phase 23 — the cockpit can draft a skill update (23-03, SKILL-02)

> Landed 2026-08-18. Backend + trace only. No browser observation yet.

One new Executive-only tool, `authorSkillCandidate`. Full mechanism in `agent-runtime.md` §Phase 23;
what belongs here is the **cockpit-surface** contract.

**The v1 rule is EXPLICIT INTENT ONLY.** The tool description says to use it only when the user has
asked to change how the agent works — never on the agent's own initiative and never as a side effect
of another request. **That is guidance in a prompt, not a guarantee**, and this playbook says so
rather than implying otherwise. The guarantee is narrower and harder: whatever the model drafts is a
`candidate` that no code path in the cockpit can activate.

**The activity trace gained one verb**, and its wording is load-bearing:

```
authorSkillCandidate: ["Drafting a skill update…", "Skill update ready for review"]
```

It must never read *"Learned"*, *"Updated how I work"*, or anything implying the change took effect.
Activation requires a passing eval AND the owner's own click; BRAND §1 forbids claiming an action
that did not happen, and the whole point of Phase 23 is that the agent's self-modification is
visibly pending rather than silently applied. The tool's own return text tells the model the same
thing, so the reply the user reads should say it is waiting for review.

**No cockpit skill body was changed.** `cockpit-agent`'s registry row is untouched by 23-03 — the
tool description carries the usage guidance, and the hard boundary stays in code.

**Not yet observed:** that a real model picks this tool only on an explicit request, and what the
user actually sees in the workspace trace when it does. Plan 23-06's browser gate owns both.
