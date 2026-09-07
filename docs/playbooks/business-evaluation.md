# Playbook: Business Evaluation Engine

> Last verified: 2026-09-07 (43-04 — **TWO defects in `landSpecialistResult`, one of them live in
> production since 42.2.**
>
> FIX E, the live one. The body precedence was
> `row && gap ? buildMemo(row, gap, ...) : (fallbackBody ?? LOST_CONTEXT_MEMO)`. But EVERY non-gap
> dispatch passes `gapIndex: 0` as a DUMMY (`dispatchRun.ts`, comment `// no gap on this path`),
> and on any thread that has ever been evaluated index 0 resolves to a REAL gap. So a research /
> media / fan-out worker that produced nothing landed an unrelated business-gap memo under its own
> heading, instead of the honest failure sentence its caller had already composed. No throw, no
> audit, and it reads like a real answer to a question nobody asked. A caller that supplies a
> `fallbackBody` is SAYING “I am not a gap run” — which is what that field's own doc comment has
> claimed since 16-06 — so it is checked first now. The gap path passes none and is byte-identical.
>
> This is the ONLY place that defect is visible: it lives inside a Convex mutation, so a pure
> string test in `packages/core` cannot see it, and the fix is a two-line reorder a reverted diff
> would leave looking identical. The test reads `plan.body` BACK OFF THE ROW, and its sibling
> proves the gap path still builds the gap memo — without that control, “prefer the fallback” could
> have been implemented as “never use the gap memo” and every other assertion would still pass.
>
> PROVENANCE. `persistNextStepMemo` hardcoded `kind: "next_step_memo"` and `source: "evaluation"`.
> Filing content-batch variants under those is a FALSE CLAIM written into a stored row that is read
> back months later — the provenance-laundering class this repo has shipped before. It branches on
> `plan.channel === "vault"` now, which is reliable BECAUSE `channel` is birth-only: nothing can
> flip a row into or out of it after the fact. An ordinary memo carries no channel and is unchanged
> byte for byte. ponytail: ONE literal (`content_draft`) for the root assembly and its variants
> alike — `sourcePlanId` already tells them apart for anyone who needs to.)

> Last verified: 2026-09-07 (43-01 — comment-only, no behaviour change. `applyActOnGap`'s header
> still said it "REUSES the thread's single `plans` row" because `plans.byThread` is a `.unique()`
> read. Both halves are false since 42-03: it INSERTS a root per gap, and `newestRoot` replaced the
> unique read. The `plan_busy` refusal is unchanged and is now the ONLY thing keeping a memo from
> clobbering an in-flight send — the one-open-root invariant, not a database uniqueness that no
> longer exists.)

> Last verified: 2026-09-07 (42-03 — `landSpecialistResult` now BRANCHES ON `parentPlanId`. A
> landed CHILD takes `approved`, not `proposed`: exactly two statuses are invisible to every
> approvals query, and `collecting` is unavailable because two other predicates read
> `collecting` + `kind: "memo"` as "a dispatch still owns this row" and would re-arm the watchdog
> against finished work. Only the PARENT ever reaches `proposed`, and only when no sibling is still
> `collecting` — which is what makes a five-worker fan-out exactly one card and one Approve.
>
> The finish check lives in `lib/planRow.ts` as `flipParentWhenSiblingsDone`, not here, because the
> reliability sweep needs the identical predicate for a child it resolves itself. There is no
> coordinator and no counter: whichever run lands last does the work. The parent's own CAS is the
> same `collecting` + `kind: "memo"` every landing uses, so a cancelled parent is left alone.
>
> The parent's body is `fanOutMemoBody` — a DETERMINISTIC assembly of the children's memos in mint
> order (owner decision 2026-09-07), never a synthesis turn. Children's `sources` are merged and
> de-duplicated by URL onto the parent by direct `ctx.db.patch`, for the same reason the
> single-run path uses one: a source list is a PROVENANCE claim and `patchPlan` is the door the
> model writes through.)

> Last verified: 2026-09-07 (42-02 — `evaluations.ts`'s specialist kick-off is a DURABLE start:
> `internal.dispatchRun.startDispatchRun` (journaled, `onComplete` terminal, paid step
> `{ retry: false }`) replaces the bare `scheduler.runAfter(0, internal.dispatch.runSpecialist)`.
> Same args, same guards, same landing; `crypto.randomUUID()` stays in the caller because the
> workflow environment has no `crypto`. Owned and explained in `cockpit.md` / `dispatchRun.ts`.)

> Last verified: 2026-09-07 (42-01, ADR-037 — **`applyActOnGap` INSERTS A ROOT PER STAGED GAP** and
> no longer recycles the review thread's one row. `REVIEW_THREAD_ID` is a fixed string, so under
> `.unique()` the weekly review had ONE plan row for the tenant's entire lifetime, and 34-01 had to
> carve out `done && memo` just to let it propose more than once. That carve-out is DELETED: a done
> memo is not an OPEN root, so it falls to the insert, and every terminal status now behaves the way
> the exception made `done` behave. ROOTS, never children — a staged gap is a proposal the owner
> approves on the ordinary surface, and an ADR-037 child is by definition unapprovable.
>
> `plan_busy` SURVIVES and is re-scoped, and the re-scoping CLOSES A REAL HOLE rather than preserving
> one. It used to mean "the row is mid-send or delivered" — a lifetime ceiling. It now means "a
> dispatch still owns the open root" (`collecting` + `kind: "memo"`), the check `stageResearchPlan`
> has had since 16-06 and this function never acquired. Its own header said to decide CONSCIOUSLY
> whether the two move together; this is that decision. Before it, a second "Act on this" tap RESET
> the row out from under a running specialist and silently discarded findings the tenant had paid
> for. The UI copy moved with it — "start a new chat to act on this" named a workaround for a
> refusal that no longer exists.
>
> `lib/agenda.ts`'s demotion loop is KEPT and its justification rewritten: two agenda rows can no
> longer collide on one planId, so the branch stops firing in practice, but it is still correct for
> a planId that IS reused (a recycled open composer) and costs one comparison per row.
>
> Measured: evaluations + gapAction 51 tests green; the in-flight guard mutation-verified (2 RED,
> restored by `cmp`). Read `docs/playbooks/cockpit.md`'s 42-01 block for the root/child rules
> themselves — this playbook owns only what `evaluations.ts` and the agenda do with them.)

> Last verified: 2026-09-05 (34-01 — **THE AGENDA SPEAKS (Goal Engine v0, G13, ADR-033).** The weekly
> review now ends with `internal.agenda.syncFromReview`: every gap on the pinned review thread becomes an
> `agenda` row keyed by `gapKey` with a lifecycle (`open / proposed / acted / dismissed / recurring`; rules in
> `@pikar/core` `agenda.ts`), and the lowest-rank `open`/`recurring` gap is staged as ONE proposal through the
> SAME `applyActOnGap` the review card's "Act on this" uses — same memo/specialist terminals, same `plans`
> row, same approvals surface, same Approve gate. Nothing sends; nothing recurs beyond the Monday cron. A
> staged week notifies `agenda_proposal` (deep link to approvals) instead of `weekly_review`; a week whose
> proposal is still waiting stages nothing and stays silent; `plan_busy` leaves the row `open` for next
> Monday. Both doors call `markAgendaProposed` (`convex/lib/agenda.ts`), so the row reads `proposed`
> whichever way it was staged. **`applyActOnGap` now recycles a DONE memo** — before this the review
> thread's one plan row was `plan_busy` forever after its first approved memo (the review could propose
> exactly once, ever); a done EMAIL plan is still refused. A proposal's fate is READ from its plan row
> (`agendaStatusFromPlan`: approved/scheduled/delivering/done → acted, canceled → dismissed) — derived at
> read time by `agenda.current`, persisted by the next sync; no `executePlan` hook. `agenda.current` is the
> Command Center's read: ≤3 rows — current gaps, then the review's `notEnoughData` asks as interview
> openers (the cockpit's `recordScorecardAnswer` stores the answer; this playbook's provenance rules are
> untouched) — with the review's citation titles and the active goal on the gap's segment
> (`segmentForRoute`, read-only; the agent still writes no goal). `agenda.dismiss` refuses a `proposed` row.
> Tests: backend `agenda.test.ts` 10/10 (seeds an UNREGISTERED route so the memo terminal is exercised without
> a dispatch), core `agenda.test.ts` 6/6, `proactiveReview.test.ts` 8/8 — the fixture's money-model gap now
> dispatches under test with both model keys stubbed empty, so its audit assertion is "contains
> `evaluation.ran`, no `review.*`" and `./dispatch.ts` is warmed in a `beforeAll` before the timer-pumped
> drain. New watched paths: `convex/agenda.ts`, `convex/agenda.test.ts`, `convex/lib/agenda.ts`,
> `core/src/agenda.ts`, `core/src/agenda.test.ts`.)

> Last verified: 2026-09-05 (25.3-01 — **THE WEEKLY REVIEW FAN-OUT IS A BATCH JOB, NOT A TABLE
> COLLECT.** `runWeekly` (the cron target, name unchanged) kicks `enumerateWeeklyReview`, a
> `@convex-dev/migrations` walk over `users` (one row per tenant; tenantId = String(userId)). Per
> user: one indexed `by_tenant_kind` `.first()` for a business_profile, one
> `deploymentSpendCents` check (a spent day schedules NOTHING instead of 10k refusals), then
> `reviewOne` at a random point in the next 30 minutes. `reviewOne`'s catch now logs the error's
> class with the tenantId (never the message). Tests seed a `users` row per tenant and run one
> synchronous batch; the tenant-scope guard's `by_kind` count is 0 — every read is tenant-first.)
>
> Last verified: 2026-08-23 (FORMATTING ONLY — **no engine behaviour, contract or invariant
> changed.** `evaluations.test.ts` was reformatted by `biome format --write` as part of the Phase 26
> merge gate: nine committed files differed from Biome's formatting output, which reddened
> `pnpm lint` (`biome ci .`) and blocked the PR. Not one assertion, fixture or expectation in that
> file was altered — verified by running it rather than assuming: the backend vault/cockpitTools/
> dispatch/evaluations selection passed 519/519 after the reformat.
>
> Recorded here only because this playbook watches `evaluations.test.ts` and CLAUDE.md §9 requires a
> touched subsystem's playbook to move with it. Worth knowing WHY the debt existed: five of the nine
> files were carried in by the earlier Phase 26 commits (26-14 to 26-17), which had never faced a
> main-branch CI run because none of that stack had been merged. Formatting drift accumulates
> silently on a long-lived branch — the gate only speaks at the merge.)

> Last verified: 2026-08-22 (26-14 — **one import; no engine behaviour changed.** `runEvaluation`'s
> local `gapKey` arrow is deleted and the identical function is imported from `@pikar/core`
> (`reports.ts`), which the RPRT-01 report plane also uses to diff two snapshots. The engine writes
> `evaluations.delta` with it and the report reads that delta; shipping a COPY left two live
> definitions of "the same gap", which is the drift the core function's own doc comment claims to
> prevent. Same `${route}/${playbook}` key, same exclusion of `leverageRank`.
>
> Also relevant to this engine, decided in 26-14 and NOT changed here: the report's snapshot diff
> disqualifies an `insufficient` row on EITHER side. This module has two insufficient paths and they
> disagree — `findings.length === 0` clears `gaps`, `!skillOk` leaves them as they were — so a
> reader must check the verdict AND the zero-findings condition, on both rows. backend 2294/2294.)
>

> Last verified: 2026-08-22 (26-11 -- **the approved memo carries its provenance, and a promoted
> artifact is no longer cited as the owner's own word.** `persistNextStepMemo` writes
> `sourceThreadId`/`sourcePlanId` from the `plans` row it already holds. More importantly,
> `fillVault` used to stamp EVERY grounded chunk `{confidence:"high", source:"vault"}` -- the same
> label the owner's own uploaded P&L gets -- so once promotion existed, a figure the model invented
> in its own `createDocument` output would be scanned by the financial patterns, written into the
> Scorecard and cited back to the owner as their own source. That is the provenance-laundering
> class. A chunk whose `origins[i] === "agent_promoted"` is now cited `source: "agent-relayed"`, the
> union member that already meant "the owner STATED it, the agent WROTE it". `confidence` stays
> "high" ON PURPOSE: the owner promoted the artifact deliberately, so only the ATTRIBUTION changes,
> never the weight. See ADR-025.)
>
> Last verified: 2026-08-21 (25.1-05, D11 — **`landSpecialistResult` now writes the memo's
> REFERENCES, not just its body.** New optional arg `sources` (`{title, url, retrievedAt}[]`),
> passed by `dispatch.ts`'s landing and written to the plan row by a DIRECT `ctx.db.patch` in the
> same transaction as the `patchPlan` that flips `collecting → proposed`. Guarded on non-empty, so
> a turn that retrieved nothing leaves the field ABSENT (the card renders its block on presence) and
> a later re-land cannot blank a filled one.
>
> **Not through `patchPlan`, and that is the invariant**: `patchPlan` is the model-reachable door,
> and a source list is a provenance claim. These values come from the search tool's own result
> parts, never from prose — the same distinction this playbook's 2026-08-15 entry drew between
> `user-provided` and `agent-relayed`. §4 is unchanged: `evaluation.ran` and every dispatch audit
> stay counts-only, and `dispatch.test.ts` scans every audit row of a real research run for the
> URLs. The gap path passes no `sources`, so it is byte-identical.)

> Last verified: 2026-08-15 (**the provenance split lost its join, and the engine went silent about
> figures it had just been given** — root-caused, fixed and LIVE-verified). `runEvaluation` seeded
> its findings-provenance map from `userProvided`, but `5523f3e` (21-01, same day) had made that
> array LITERAL — only what the USER supplied — while `recordScorecardAnswerInternal` writes
> `actor: "agent"` by construction, because the cockpit RELAYS what it heard. Both facts are
> correct; together they made `userProvided` permanently empty on the conversational path, so
> `findings` came out EMPTY, so SC #1 force-cleared every gap. The engine answered "not enough
> data" about a number the owner had given it one turn earlier and which was sitting correctly in
> the scorecard the whole time. **The defect was citation-only — the VALUE always landed.**
>
> **THIS WAS LIVE ON THE ACTIVE BODY, NOT ONLY IN THE GATE.** Any tenant who stated a figure in
> conversation and then asked for an evaluation got the thin-data answer. The window is short only
> because `5523f3e` landed the same day.
>
> FIX: seed `provenance` from `fieldProvenance` (the record of WHO answered), `userProvided` kept
> as the legacy-row fallback, and a relayed figure cited as `agent-relayed` — a third ADDITIVE
> literal on `findings[].source`. That literal is load-bearing: a relayed figure MUST be cited
> (`FigureActor`'s contract is that origin and actor are INDEPENDENT — the owner stated it, the
> agent only wrote it down) but must NEVER be cited as `user-provided`, which is the laundering
> `5523f3e` closed. Both wrong answers were reachable; the union needed a third member so the
> honest one was expressible. Do not collapse it back to two.
>
> MEASURED: new regression test observed RED (`expected undefined to be defined`) then green — it
> asserts the SPECIFIC finding for the relayed field, never `findings.length >= 1`, because the
> profile doc contributes identity findings that would have made a count assertion pass while the
> figure still cited nothing. `evaluations` 39/39 with the anti-laundering assertions intact,
> `gapAction`+`cash` 59/59, `tsc` clean. **LIVE on the ACTIVE `cockpit-agent@24`: fixtures 27+28
> went 0/2 → 2/2 (run `e6ddb1e9`), and 29+30+31 went 0/3 → 3/3 each with a real specialist
> dispatch. All five originally-red fixtures pass, from ONE fix.**
>
> WHY IT ESCAPED, and the rule worth keeping: `5523f3e` shipped 105 lines of correct new tests that
> asserted the MECHANISM (provenance records the right actor) and never the BEHAVIOUR (an evaluation
> still produces findings). The pre-existing findings test seeds a vault doc WITH financial lines,
> so it grounded through the vault path and stayed green throughout. When a write side is split,
> test the READ side that consumed the old shape. Full write-up:
> `.planning/debug/business-evaluation-no-grounded-findings.md`.)

> Touched 2026-08-15 (phase 14→25 gap-audit session) to clear the §9 Stop hook — **NOT a
> verification**, and deliberately not a `Last verified` line. **This session changed no product
> code at all** — its edits were planning documents (`25-05/06/07` re-cut, new `22.1-04`/`22.1-05`,
> `25-RESEARCH.md`, `25-CONTEXT.md`, `ROADMAP.md`), three playbook notes, `biome.json` and
> `.gitignore`. The hook fired on `packages/backend/convex/evaluations.ts` and
> `evaluations.test.ts`, which carry uncommitted in-flight changes from a concurrent lane; HEAD
> moved twice more while this note was being written (`2d74b1a`, `40046b2`). That work is unread
> and unattested here. **The lane that owns it still owes this playbook a real entry and a real
> `Last verified` bump.**
>
> This is the THIRD playbook and the FOURTH firing of this kind in one session (`cockpit.md` and
> `vault.md` are the others). Recorded as playbook debt in
> `.planning/phases/25-private-beta-productionization/25-PREREQUISITE-EVIDENCE.md` — the §9 hook
> cannot be scoped to one lane's diff, so in a shared working tree every passing session is forced
> to either assert a verification nobody performed or stack another disclaimer.

> Last verified: 2026-08-15 (plan `2026-08-15-scorecard-field-provenance`, COMPLETE — full backend
> suite green: `pnpm typecheck` clean, `pnpm vitest run` 79 test files / 1793 passed / 24 skipped, 0
> red; `evaluations.test.ts` 38/38 on its own. **The invariant, now landed and verified, not merely
> decided:** `evaluations.userProvided` means THE USER SUPPLIED IT and nothing else — it is NEVER
> widened to cover writes an agent performed. `evaluations.fieldProvenance` (dot-path →
> `{actor, origin, source, at}`) records EVERY answer, including agent ones, and is the authority
> readers consult first; `userProvided`/`userProvidedAt` remain the fallback for any row whose write
> path never recorded a `fieldProvenance` entry. See
> `docs/decisions/021-userprovided-fieldprovenance-split.md` for the full decision record — the
> problem, the alternatives rejected, and the standing rule future work must not undo.
>
> **CORRECTED 2026-08-15 (whole-branch review Finding 3):** the line above used to say the fallback
> applies "only for rows written before the map existed, and nothing else" — false. `runEvaluation`'s
> `fillVault` (`evaluations.ts`) is a SECOND scorecard writer, alongside `applyScorecardAnswer`: it
> fills a null slot from grounded vault text via `setPath` and records NO `fieldProvenance` entry, so
> a row written TODAY can still take this fallback. Harmless today — both writers resolve to
> `actor: "agent"`, `statedAt: null` on the read side either way — but the fallback is live code that
> a future "only legacy rows use this" cleanup could wrongly delete.
>
> **Why it matters here:** `runEvaluation` rebuilds its citation map from `userProvided` membership
> and stamps every member `{source: "user-provided", confidence: "high"}`. A figure an agent read out
> of a document appearing in that list would be cited back to the owner as their own testimony — the
> laundering this split exists to prevent. Do not "simplify" it by merging the two.
>
> **Known consequence, accepted by the owner:** the cockpit `recordScorecardAnswer` tool (both the
> `tenantMutation` and its `recordScorecardAnswerInternal` twin) now stamps `actor: "agent"`
> unconditionally — a model relays what it heard in chat, it does not verify it — so a chat-given
> figure no longer joins `userProvided` or is cited "user-provided" at high confidence until a later
> phase teaches the citation map to read `fieldProvenance`.
>
> **`applyScorecardAnswer(db, tenantId, threadId, field, value, provenance)` now takes a REQUIRED
> sixth `FieldProvenance` argument, no default.** That turned every existing call site into a compile
> error until it declared who is answering — a silent fifth caller cannot slip through.
> **`userProvidedAt` (dot-path → epoch-ms) is stamped ONLY when `provenance.actor === "user"`, from
> `provenance.at` — never `Date.now()`, and never on an agent answer.** This corrects the LOCKED
> "A field's STATED TIME…" bullet further down this file, which used to claim `userProvidedAt` is
> stamped "on every answer" — false since this plan; caught in the plan's own controller review
> (ruling PF-9) and fixed at that bullet rather than only noted here.
>
> **`runEvaluation` carries `fieldProvenance` forward unchanged into every new row**, exactly like
> `userProvided`/`userProvidedAt` (the same carry-forward block, near line 236; persisted via
> `insertEvaluation` near line 496). Without this, a weekly re-evaluation would silently erase every
> provenance record on its fresh row, and the read side (`dashboard-pages.md`) would fall back to the
> legacy proxy — reporting an agent-relayed figure as unknown-origin. Regression-guarded by
> `evaluations.test.ts > "carry-forward / anti-re-ask" > "fieldProvenance is carried forward
> unchanged by a re-evaluation"`, confirmed RED against the code with the carry-forward line stubbed
> out.
>
> **An agent write DROPS a stale `userProvided` membership marker, not just declines to add one.**
> Found in review: the laundering guarantee above only covered a FIRST write. A sequence where the
> owner types CAC on the finance page (`actor: "user"`, legitimately joins `userProvided`) and an
> approved agent claim later overwrites the VALUE left the stale `userProvided` marker in place — so
> `runEvaluation`'s citation map (built from `userProvided` membership alone, `evaluations.ts` ~line
> 250) would still cite the AGENT's new number as the owner's own testimony. Refusing the overwrite
> was ruled out — `applyFinanceClaims` runs POST-APPROVAL, after the human already agreed to it — so
> `applyScorecardAnswer`'s `last` branch now filters `field` out of `userProvided` and deletes its
> `userProvidedAt` entry whenever `provenance.actor !== "user"`, alongside the existing unconditional
> `fieldProvenance` write. Regression-guarded by `cash.test.ts`'s "an agent claim overwriting a
> user-saved cac drops it from userProvided, not just declines to add it" — seeds a genuine user save
> via `saveInput` first, confirmed RED against the pre-fix code (`expected ['financials.cac'] to not
> include 'financials.cac'`).
>
> **Both agent-write refusals into the scorecard store are DELETED, not narrowed.** `writeFigureRow`'s
> `if (claim.actor === "agent") throw` guard and `applyFinanceClaims`'s unconditional
> `agent_cannot_update_figure` return for a scorecard-store field are both gone — the applier now
> accepts an agent claim on `cac` (or its five `CASH_INPUTS` siblings) with honest provenance: the
> value lands, `fieldProvenance[path].actor` reads `"agent"`, and the path stays OUT of
> `userProvided`. See `docs/playbooks/dashboard-pages.md`'s consolidated entry for the read-side and
> applier detail (including the legacy-row staleness fallback), and `docs/playbooks/cockpit.md` for
> why `llm.ts`'s `stageFinanceWrite` tool STILL refuses to STAGE such a claim from chat — a
> deliberate hold on what the model may propose, not a mirror of this store limit, which this plan
> lifted.)

> Last verified: 2026-08-11 — ⚠ **DATE BUMPED TO CLEAR A `check-playbooks.mjs` FALSE POSITIVE.
> NOTHING BELOW WAS RE-VERIFIED, AND THIS ENTRY DOCUMENTS NO CHANGE OF ITS OWN.** The precedent is
> the identically-shaped entries in `skill-registry.md` and `agent-runtime.md` (21-01).
>
> The hook builds its changed-set from the WHOLE WORKING TREE, not from the session's own diff. It
> named this playbook because `packages/backend/convex/evaluations.ts` is dirty in the shared tree. **That file is not mine.**
> Plan 21-05 (pinned prompts / "routine v0") touched exactly five code paths, all committed in
> `cf18305` and `fc20c60`:
>
> - `packages/backend/convex/savedPrompts.ts` + `savedPrompts.test.ts`
> - `apps/web/app/(app)/dashboard/workspace/ChatPane.tsx`, `page.tsx`, `pinnedPrompts.test.ts`
>
> …and one playbook, `cockpit.md`, which genuinely owns all five (`watch.json`). `packages/backend/convex/evaluations.ts` is
> being written RIGHT NOW by the concurrent 21-03 lane (eval evidence / tenant-skill pinning /
> runtime attribution), whose own file list names it explicitly. **I did not run, read, re-measure,
> endorse, revert or restage that lane's change**, and I make no claim about whether it is correct.
>
> **The real entry for `packages/backend/convex/evaluations.ts` is owed by the 21-03 lane and must replace this one.** If you are
> that lane: do not treat this bump as coverage — nothing here was checked.

> Last verified: 2026-08-10 (WHOLE-BRANCH RE-REVIEW, live-finance-inputs — **the grounding corpus
> will fabricate a financial figure out of anything appended to the blueprint chunk, and now has a
> test saying so.** `FINANCIAL_PATTERNS` (`evaluations.ts:79-87`) is described as a "labeled-number
> scan… only a DIRECT statement fills a financial field", but its gaps are `[^\d$]*` — unbounded,
> and `.` is not involved so newlines match. A label and its "value" can therefore be hundreds of
> characters and several lines apart, in different documents' worth of text, as long as no digit or
> `$` intervenes. The `"Business blueprint"` chunk is `internal.blueprint.spineForTenant`'s WHOLE
> return value (`vaultGround.ts:225` → `evaluations.ts:264-272`), so anything appended to that query
> donates its first number to any `CAC`/`LTGP`/`price` the blueprint merely MENTIONS. A live attempt
> to append the cockpit's finance line there turned a blueprint reading "Constraint: CAC is too high"
> plus a stored cash-on-hand figure into `financials.cac = 38500`, cited `{source: "vault",
> confidence: "high"}` — which then flipped `financialsPresent` to growth-os and suppressed the
> honest "we need your CAC" gap. Fixed by keeping the finance line in its own query
> (`internal.cash.financeSpineFor`, joined only in `buildTurnPrompt`); pinned by
> `evaluations.test.ts`'s "the cockpit finance line never reaches the grounding corpus", verified RED
> against the concatenating version. **Before adding ANY text to the blueprint chunk, re-read this:
> the existing `ponytail: PROVENANCE CEILING` note at `evaluations.ts:274` warns about attribution;
> this is the sharper hazard — FABRICATION — and the only real fix for it is narrowing the patterns,
> which was deliberately not attempted here.**)

> Last verified: 2026-08-09 (cash-business-finance whole-branch review B1 — **`latestScorecardRow`
> can select a row with no usable Scorecard, and `setPath` used to throw on one.** Two reachable
> producers write a row this Finance-page reader must not hand back as "the tenant's financial
> truth": `voiceDoc.ts` inserts a `framework: "document-review"` row with `scorecard: {}` LITERALLY
> (never routed through this engine — see the "document-review" entry below), and this engine's own
> `runEvaluation`, run by the cockpit's `assessBusiness` tool on a BRAND-NEW conversation thread, has
> no prior row to carry forward and seeds from `emptyScorecard` before it fills anything in. Either
> shape made `packages/core/src/cash.ts`'s `scorecard.financials.*` reads crash. Fixed in THIS file
> (`evaluations.ts`), two layers: (1) `latestScorecardRow` (exported plain function, `by_tenant`,
> newest-200 bounded) now skips `framework === "document-review"` rows and any row whose `scorecard.
> financials` is absent, via a new `hasUsableScorecard` predicate — a Scorecard whose LEAVES are
> merely `null` (the normal not-yet-answered state) still counts as usable, only a missing
> `financials` object does not. (2) `setPath` (the dot-path writer `applyScorecardAnswer` and
> `runEvaluation`'s `fillVault` both use) now CREATES intermediate objects instead of assuming they
> already exist — `cur["financials"] === undefined` used to make the final assignment throw; it is
> now created as `{}` and the walk continues. Chosen over making `cash.ts`'s `saveInput` guarantee a
> well-formed carrier before calling `applyScorecardAnswer`, because `setPath` has OTHER callers that
> would each need the same guard repeated — fixing the shared function once is the root-cause fix
> (CLAUDE.md §8). See `docs/playbooks/dashboard-pages.md`'s "Cash — the Business tab, assembled" and
> "Cash — unit economics" sections for the Finance-page-side layers of the same fix (the crash site
> and the caller). Zero behavior change for the engine's own grounding/diagnosis/carry-forward path —
> `evaluations.test.ts` gained 4 tests (`latestScorecardRow` skip behaviour ×2, `setPath`
> non-throwing on a malformed carrier ×1 — folded into the count with the pre-existing suite) and is
> 29/29.)
>
> Last verified: 2026-08-09 (cash-business-finance Task 3 review fix — **`userProvidedAt` closes
> the "a carried-forward answer reads as freshly confirmed" bug.** `runEvaluation`'s carry-forward
> stamps every new row with a fresh `createdAt` while copying `scorecard`/`userProvided` verbatim —
> that is by design, for the field VALUES. The Business tab's Task-3 reader wrongly treated the same
> `createdAt` as a stand-in for a FIELD's stated time, so a 91-day-old CAC survived a weekly
> re-evaluation and read back as "confirmed today", silently suppressing the 90-day confirm-or-update
> prompt. Fix: `applyScorecardAnswer` stamps a dot-path → epoch-ms `userProvidedAt` map on every
> answer, `runEvaluation` carries it forward unchanged (the same shape as `userProvided`), and
> `cash.ts` reads it instead of `createdAt` — with a legacy value that predates this field (no
> recorded time) read as needing confirmation, never as fresh. See the new invariant below and
> `docs/playbooks/dashboard-pages.md`'s Cash section. Zero change to grounding, diagnosis, carry-
> forward of VALUES, citations or any existing engine behaviour — `evaluations.test.ts` 26/26.)
>
> Last verified: 2026-08-03 (15.3-05 — **`unincorporatedFor` now excludes SEALED folder members.**
> A vault folder's members are unretrievable until the folder is `complete` (VALT-07), but they
> reach `status: "ready"` at ingest step 6 *during* that window — and `unincorporatedFor` reads
> `by_tenant_status` ready docs. `spineForTenant` runs it on EVERY grounding call, so without the
> filter, uploading a folder made the blueprint spine announce drift the user could not act on, on
> every cockpit turn, for the whole ingest window — a user-visible lie about their own vault. The
> predicate is `vaultFolders.sealedIn`, called on rows this helper has already read (no second doc
> read); a MISSING folder row means folder-less, not sealed, so cancelled folders count normally.
> Proven by `convex/vaultSealing.test.ts` § 4, mutation-verified RED. Full rationale and the other
> two sealing sites: `docs/playbooks/vault.md` § `### 15.3-05`.)

> Last verified: 2026-08-02 (22.1-03 — ⚠ **date bumped for a BEHAVIOUR-FREE sweep; the
> subsystem below was NOT re-verified.**) The dead-directive sweep (`72dd652`) deleted one line
> — `// @ts-expect-error import.meta.glob …` — from watched test files (evaluations.test.ts, proactiveReview.test.ts).
> It suppressed nothing: `tsconfig.json` includes `vitest.config.mts`, which pulls Vite's global
> types in, so TypeScript reported all 100 occurrences as TS2578 *unused directive*. Deletions
> only, zero additions, no assertion, invariant or product line touched anywhere. Backend
> typecheck 150 → 50; full suite 54/54.
> **Re-verified 2026-08-02** (a later session, closing the ⚠ above for THIS subsystem): evaluations.test.ts + proactiveReview.test.ts run green under vitest as part of a 10-file, 212/212 pass. The sweep's claim of behaviour-freedom now has evidence here, not just a typecheck delta.
>
> Last verified: 2026-07-31 (ACTN-03) — **`applyScorecardAnswer` now COERCES before it writes, and
> `actOnGapInternal` forwards a skill pin.** (1) The cockpit's `recordScorecardAnswer` tool types
> `value` as a STRING in its JSON schema, so every boolean scorecard leaf arrived as `"true"` /
> `"false"` — and `"false"` is TRUTHY, so `diagnose()`'s presence counts scored a known-ABSENT offer
> type or lead channel as PRESENT. Measured, not theorised: run `c1fe054c` fixture 30 stored
> `offerTypesPresent={attraction:"true",continuity:"false",downsell:"false",upsell:"false"}` and the
> engine returned `healthy` with zero gaps, so the "Act on this" tap had nothing to act on
> (`gap_not_found`). `coerceScorecardValue` sits at the ONE choke point both writers route through,
> and decides by the SHAPE OF `emptyScorecard` (`typeof getPath(emptyScorecard, field) === "boolean"`)
> rather than a hand-maintained field list — the three nullable-boolean paths are the only names it
> spells out. It deliberately leaves `identity.currentOffers` alone (`typeof [] === "object"`):
> `hasOffer` reads `.length > 0`, which is correct for a bare string too. **Rule for a new scorecard
> leaf: give it a real default in `scorecard.ts` and the coercion follows for free; a leaf that
> defaults to `null` and means a boolean must be added to `NULLABLE_BOOL`.** (2) `applyActOnGap`
> takes a trailing optional `skillVersions` forwarded to the scheduled `internal.dispatch.runSpecialist`
> — the eval harness's `--skill` pins otherwise never reached the specialist. `actOnGap` (the UI
> path) deliberately passes none and keeps running the ACTIVE row. PREVIOUS: 2026-07-31 — 22-01 (GOVN-01), TEST-ONLY, no engine behaviour changed: the
> lineage assertion in `evaluations.test.ts` dropped its `stableTenant(TENANT)` wrapping. That
> call was a literal no-op (`TENANT = "tenant_a"` carries no `|sessionId` suffix, so the parser
> returned it unchanged) and the helper was deleted from production source when identity moved
> to the auth package's `getAuthUserId`. The assertion now compares against `TENANT` directly and
> is byte-equivalent in meaning. Nothing in `evaluations.ts` was read or modified — see
> `authorization.md`. PREVIOUS: 2026-07-30 — 17.1-07 (BLPR-02): the confirmed Business Blueprint now enters the
> evaluation chunk set explicitly, after authoritative profile seeds and before ordinary retrieval.
> A contradictory derived figure cannot beat the user's typed value or take its provenance. See
> **"Blueprint standing context and the provenance ceiling"** below.
>
> PRIOR — 2026-07-27 — 16-06 (DISP-02), **CONFIRMED by 16-06's author against the committed code.** **`landSpecialistResult` gained an optional `fallbackBody`, and 16-06 added a SECOND stager (`plans.stageResearchPlan`).** The section **"A second stager, and a memo that stops lying"** below was drafted by the 15.2 lane off the then-uncommitted diff; 16-06's author has now read it against the shipped code and it is ACCURATE — the provenance caveat it carried is resolved and removed. The gap path is byte-identical (`runSpecialist` passes no `fallbackBody`), and the whole 15-04 landing suite is green unchanged, which is the proof rather than the claim. See `cockpit.md` § "Phase 16 — the async research dispatch seam" for the seam's other half.
> Prior: 2026-07-26 — 15.1-04 (ONBD-02, SC#2b): **the rubric is picked from the `tenantProfiles` ROW, not from a string matched out of markdown.** `PERSONA_FRAMEWORK` became `TIER_FRAMEWORK`, bound `as const satisfies Record<Tier, Framework>` (`enterprise` → `swot`, the honest SME-shaped default for an operator grant, D6), and `runEvaluation` reads `internal.tenantProfile.forTenant({ tenantId })` ONCE beside the carry-forward read. **`personaHint` is deleted** — it was the LAST authoritative reader of the markdown persona, which is what makes design §4.2's claim true that `deserializeProfile`'s `"solopreneur"` fallback "stops being a silent reclassification risk once nothing authoritative depends on it". The `text.includes("- **Persona:**")` block SURVIVES as a profile detector and keeps its four CONTENT `fillVault` calls; only the AUTHORITY was removed. The trailing `?? "lean"` was dropped deliberately (the lookup is total, so it was an assertion that could never fail — the Phase-15 `armFor` lesson). **Q3 is unchanged and LOCKED:** `financialsPresent` still overrides with `growth-os`; the tier's perceivable effect lands on the specialist prompt (ADR-009), not on the rubric. New tests confirmed RED first — both authority cases returned `"lean"` against the old code. `evaluations.test.ts` 23/23, `proactiveReview.test.ts` 8/8, `gapAction.test.ts` 5/5.
> Prior: 2026-07-26 — 15-06 (DISP-01): **`actOnGap` now has an identity-less twin.** Its handler was extracted verbatim into a shared `applyActOnGap(ctx, tenantId, threadId, gapIndex)` behind TWO surfaces: the unchanged auth-scoped `actOnGap` (the UI path) and the new `internal.evaluations.actOnGapInternal`, which takes an explicit `tenantId`. Same shape and same reason as `applyScorecardAnswer` / `recordScorecardAnswerInternal` (12-04): `npx convex run` carries NO auth identity, so the golden-eval harness could not otherwise reach the tenant-scoped mutation. It exists so an eval fixture drives the REAL user path — gap → tap → `collecting` → scheduled `internal.dispatch.runSpecialist` → `landSpecialistResult` → `proposed` — rather than a re-implemented imitation of it; because both surfaces share one implementation, the two-terminal choice, the plan recycle and the scheduled dispatch cannot be true in one and absent in the other. ZERO behaviour change: the returned union is unchanged (now the named `ActOnGapResult`, explicit per Convex guidelines §96 so the generated API does not collapse for `apps/web`), and the whole 18-test `evaluations.test.ts` + 5-test `gapAction.test.ts` + 31-test `dispatch.test.ts` set is green unchanged — that is the proof, not a claim. **If you add a guard to the tap, add it to `applyActOnGap`, never to a wrapper.**
> Last verified: 2026-07-26 — 15-04 (DISP-01): **"Act on this" RUNS the specialist.** `actOnGap` stays a `tenantMutation` and now has TWO terminals — a gap routed at a REGISTERED specialist stages `status: "collecting"` with NO body and schedules `internal.dispatch.runSpecialist`; a gap with no registered specialist keeps the 12-05 memo at `proposed` and schedules nothing. The `collecting` staging IS the Approve-race mitigation (a template must never be approvable under a specialist attribution header) and must not be "simplified" back. `landSpecialistResult` is the only writer of the dispatched body and no-ops on any row that is not still `collecting`/`kind: "memo"` under the same tenant; `buildMemo` is now the FALLBACK and its wording branches on `fallbackReason`. See the **"Act on this" now RUNS the specialist** section below. `evaluations.test.ts` 18/18, `gapAction.test.ts` 5/5.
> Last verified: 2026-07-25 (5) — 14-01 (Phase-14 Wave-0 freeze, Lane C): the `evaluations` TABLE is now shared with the voice-doc flow, but this ENGINE is not. `evaluations.framework` gained a fifth literal `"document-review"`, `findings[]` gained an optional `citationExcerpt`, and a doc-review row is written STRAIGHT through `insertEvaluation` by `voiceDoc.ts` — it never enters `runEvaluation`, has no rubric skill and no `diagnose()` path. **The load-bearing consequence: `runEvaluation`'s `framework` arg is now explicitly PINNED to the four business frameworks instead of being derived from `evalFields`.** See the new **"Sharing the evaluations table with voice-doc (Phase 14)"** section below. Zero behavior change for every existing business-evaluation caller; `evaluations.test.ts` and `proactiveReview.test.ts` unchanged and green, backend 497/498 (sole red the pre-existing `audit.test.ts auditCounts`).
> Prior: 2026-07-25 (4) — 13-02: the **proactive weekly review** (`proactiveReview.ts`, BEVL-03) — a Monday-06:00-UTC cron enumerates onboarded tenants over `vaultDocuments.by_kind`, fans out one `reviewOne` per tenant, runs this engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, and writes an in-app notification only when something changed. See the **Proactive weekly review** section below. **The repeat-run provenance collapse recorded in the previous line is now CLOSED** — it had to be, because a weekly review is by design a repeat run on one pinned thread. `fillVault` now records a CITATION whenever a grounded document restates a field, even when the slot is already filled by carry-forward (the VALUE stays first-write-wins, and a pre-seeded `user-provided` citation is never downgraded); the two "already set → skip" short-circuits above it (the `currentOffers.length === 0` pre-check and the `FINANCIAL_PATTERNS` `continue`) are gone for the same reason. Regression-guarded by `proactiveReview.test.ts > notifies only on change`, which asserts run 2 has the SAME finding count as run 1 and an empty delta — that test was CONFIRMED red before the fix (a second `weekly_review` notification fired off a false "gaps closed"). `proactiveReview.test.ts` 8/8, `evaluations.test.ts` 11/11 unchanged, backend 494/495 (sole red the pre-existing `audit.test.ts auditCounts`). Prior: 2026-07-25 (3) — 13-01: the optional `evaluations.delta` "what changed" field (BEVL-03 groundwork for the weekly proactive review). See the **"What changed" delta** section below. No behavior change for any existing caller: `withDelta` is opt-in, absent ⇒ no `delta` is written, and the two pre-existing callers (`llm.ts`'s `evaluateBusiness` tool, the tests) pass it nowhere. `evaluations.test.ts` 11/11 (4 new delta tests, all confirmed RED before the engine change). Prior: 2026-07-25 (2) — TWO owner-reported grounding defects fixed; both made a real business assess as "not enough data". **(1) A reference PDF monopolised the corpus.** `rag.search` takes its top-K by CHUNK (`limit: 8`), and `seedDocIds` dedupes only afterwards — so one large book filled every slot and grounding returned exactly ONE doc. Measured live: with the engine's own `DEFAULT_QUERY` the tenant's grounding came back as a single 300-page marketing PDF, the user's own profile never entered the corpus, `findingCount` was 0, and the framework fell back to the persona map (`swot`) because no financials were found. Similarity alone cannot answer "evaluate MY business" — a book ABOUT business outranks a short description OF one on generic business vocabulary. FIX: `runEvaluation` now PREPENDS the tenant's own profile-shaped docs from the new `internal.vault.profileSeedDocs` before the retrieval result. Prepending is load-bearing — `fillVault` keeps the FIRST value per path, so the user's own figures beat book prose. Fail-open: a seed-query failure leaves retrieval-only grounding intact. The shared `vaultGround` is deliberately UNTOUCHED (it also serves `searchVault` + golden fixtures 25/26 — changing it would risk eval-gate churn). **(2) `fillVault` could never fill `identity.currentOffers`.** `emptyScorecard.identity.currentOffers` is `[]`, not null, so the `!= null` guard skipped it forever; `hasOffer` stayed false and `diagnose()` returned Gate 1 ("No offer worth buying yet") on EVERY vault-grounded run, masking the true constraint further down the ladder. The caller's own `.length === 0` check shows the intent. FIX: an empty array now counts as unset. Verified live on the owner's deployment, fresh thread: framework `growth-os`, **8 cited findings** (incl. the previously-impossible `Offer:`), gap = `"Customer doesn't pay for themselves in 30 days."` → `money-model-designer` — exactly the Gate-2 constraint the fixture's economics were built to produce (30-day cash 90 < CAC 180). `evaluations.test.ts` 7/7 with a new regression test that was CONFIRMED to fail against the old guard (`expected [] to have a length of 1`); full backend 479/480 with only the pre-existing `audit.test.ts` red. KNOWN GAP (not fixed, logged): re-running an evaluation in the SAME thread collapses `findingCount` (8 → 1) — carry-forward preserves the scorecard VALUES but not their provenance, so only freshly-filled paths are re-cited. Evaluate in a fresh thread until this is closed. Prior: 2026-07-25 against 12-05 (the gap-action + memo terminal — the ACTING side, BEVL-02)
> Prior: 2026-07-25 against 12-04 (the cockpit-tool store surface + the EVALUATION card)
> Build history: `.planning/phases/12-business-evaluation-engine/` · Related ADRs: none

## Purpose

The one place that turns a user's grounded vault data + carried-forward answers + a framework
method into a durable, tenant-isolated business assessment (BEVL-01). On demand it grounds over the
vault + business profile, runs the pure `diagnose()` from `@pikar/core/growth`, and persists ONE
`evaluations` row with per-finding citations, H/M/L confidence, honest not-enough-data sections, and
a leverage-ranked gap list. It is READ-ONLY (the two-shapes rule): it never proposes or sends —
acting on a gap crosses the Approve gate separately. It audits counts/enums only (§4).

## Key files

Backend (`packages/backend/convex/`):
- `evaluations.ts` — the engine. `runEvaluation` (internalAction: carry-forward → ground → load
  rubric → fill scorecard → `diagnose()`/`leverageRank()` → persist → refs-only audit → activity
  step), `recordScorecardAnswer` (tenantMutation — the client "store" half) + its identity-free twin
  `recordScorecardAnswerInternal` (internalMutation — same `applyScorecardAnswer` core, called by the
  cockpit tool which carries an explicit tenantId, no live identity), `insertEvaluation`
  (internalMutation), `lastForThread` (internalQuery — carry-forward read), `byThread` (tenantQuery
  — the card's latest-row read). **12-05 (the ACTING half):** `actOnGap` (tenantMutation — a gap →
  a proposed memo-plan), `buildMemo` (the deterministic memo template), `persistNextStepMemo`
  (a plain exported helper — the MEMO TERMINAL, called by `cockpit.executePlan`).
  **15-04 (the DISPATCHING half):** `actOnGap` stages `collecting` + schedules
  `internal.dispatch.runSpecialist`; `landSpecialistResult` (internalMutation, explicit `tenantId`)
  is where the run lands and the only thing that flips a dispatched plan to `proposed`; `buildMemo`
  gained the optional `fallbackReason` branch + the code-owned `FALLBACK_SENTENCE` map.
- `schema.ts` — the append-only `evaluations` table (`by_tenant` / `by_tenant_thread`) + the
  `"evaluateBusiness"` literal in the closed `agentSteps.tool` union + (12-05) the optional
  `plans.kind: "memo"` discriminator and the optional `gaps[].reason`/`gaps[].proofMetric`.
  **cash-business-finance Task 3 review fix:** `userProvidedAt: v.optional(v.record(v.string(),
  v.number()))` — a dot-path → epoch-ms map, the ONE place a scorecard field's true stated time
  lives. Optional ⇒ no migration; a pre-existing row simply has no entries.
- `evaluations.test.ts` — convex-test over the `SMOKE::` seam: grounded cited row, refs-only audit,
  carry-forward/anti-re-ask, two-tenant isolation (SC #5), thin-data honesty, and (Task 3 fix) a
  field's `userProvidedAt` surviving a re-evaluation's fresh `createdAt` unchanged.
- `proactiveReview.ts` (13-02, BEVL-03) — the weekly cron's three functions: `runWeekly`
  (internalMutation — enumerate onboarded tenants over `vaultDocuments.by_kind`, dedupe, fan out),
  `reviewOne` (internalAction — the engine on the stable `REVIEW_THREAD_ID`, notify-on-change),
  `insertReviewNotification` (internalMutation — a DIRECT `notifications` insert, never
  `notifications.notify`). See the **Proactive weekly review** section.
- `proactiveReview.test.ts` — five behaviour cases plus the SC#2 (no mailbox token) and SC#3
  (tenant-scoped) static source guards.
- `crons.ts` — `crons.weekly("proactive-review", monday 06:00 UTC)` (see `audit-dead-letter.md`).
- `gapAction.test.ts` — convex-test for BEVL-02: gap → proposed memo-plan (no recipients), a
  healthy/thin evaluation exposes no gap, approve persists a `next_step_memo` vault doc and seeds
  ZERO `requests` rows (the terminal is a persist, NOT gmail), double-approve idempotence.

Pure package (`packages/core/src/growth/`, see `growth-diagnostic.md`):
- `diagnose.ts` / `financialSpine.ts` / `scorecard.ts` — the Convex-free diagnosis the engine calls.

Reused verbatim (do NOT rebuild): `vaultGround.ts` `vaultGroundHydrated` (grounding), `audit.ts`
`log` (refs-only audit), `agentSteps.ts` `record`/`finish` (activity step), `skills.ts`
`getActiveSkill` (rubric body).

## Dependencies & blast radius

Run `graphify query "business evaluation"` for the live subgraph. Couplings graphify cannot see:

- **Grounding is the existing engine** — `internal.vaultGround.vaultGroundHydrated({ tenantId,
  query })` with an EXPLICIT tenantId (never auth-derived — the tool loop/eval harness carry no
  identity). Its `SMOKE::<docId,…>` seam is how the tests ground with zero network.
- **The rubric method is a gated skill row** (12-02): framework → skill name is `FRAMEWORK_SKILL`
  (growth-os→`growth-os-diagnostic`, swot→`swot`, lean→`lean-canvas`, bmc→`bmc`). Missing/inactive
  method → fail-open "insufficient", never a throw.
- **`agentSteps.tool` is a CLOSED union** — the `"evaluateBusiness"` literal MUST exist in schema.ts
  or the step insert throws and is silently swallowed in prod (Pitfall 2).
- **The Scorecard shape is the @pikar/core contract** — a renamed field there breaks the engine's
  fill/diagnose. Anchor the dot-path keys in `TRACKED` / `FINANCIAL_PATTERNS`.
- **auditCounts aggregate** — `evaluation.ran` rides the audit insert → the aggregate; convex-test
  must `registerComponent("auditCounts", …)` (the cockpitTools.test.ts idiom).

## Data flow

1. **Carry forward** — `lastForThread` reads the tenant's latest row; its `scorecard` +
   `userProvided[]` seed this run (a previously-answered figure is never re-asked).
2. **Ground** — `vaultGroundHydrated` returns `{ docIds, titles, chunks, spine }`. The three
   retrieval arrays stay parallel and the confirmed Blueprint is a separate field. The engine reads
   its real vault document id through `blueprint.liveForTenant`, then assembles the final chunk order
   as **profile seeds → Business Blueprint → ordinary retrieval**. Fail open on any error (the
   carried values and ordinary grounding still stand); `spine: null` keeps the pre-17.1 path
   byte-identical.
3. **Fill** — parse a grounded business-profile chunk (`deserializeProfile`) into identity fields
   and scan for direct labeled figures (`CAC: $150`) into financials; each fill records its source
   doc as provenance. A user-provided carried field is provenance "user-provided". A field still
   null → stays null (not-enough-data), never guessed. **Value vs citation are separate rules**
   (13-02): the VALUE is first-write-wins (carried/user-provided/earlier-doc beats a later doc), but
   the CITATION is (re)recorded whenever a document restates the field, so a repeat run over the
   same corpus cites the same things instead of collapsing to zero findings.
4. **Auto-pick framework** — financials present → `growth-os`; else the tenant's **TIER**, read from
   the `tenantProfiles` row via `internal.tenantProfile.forTenant` (`TIER_FRAMEWORK`:
   solopreneur→lean, startup→bmc, sme→swot, enterprise→swot); an explicit `framework` arg overrides.
   The row is read ONCE at the top of the handler, beside the carry-forward read.
5. **Diagnose** — `diagnose()` + `leverageRank()` over the filled scorecard → gaps (route/playbook),
   with a `diagnose` `ask` becoming a not-enough-data section, never a gap.
6. **Persist** — `insertEvaluation` writes ONE content-plane row (findings source-tagged
   vault|user-provided, each cited).
7. **Audit + step** — ONE `internal.audit.log` `evaluation.ran` (counts + framework/verdict enums
   ONLY) + an `"evaluateBusiness"` activity step (running→done/error).

### Blueprint standing context and the provenance ceiling

The Blueprint is consumed explicitly from `vaultGroundHydrated.spine`; it is never smuggled into the
retrieval arrays. `profileSeedDocs` remains authoritative and is moved to the front even when a
profile document was already a retrieval hit. This ordering is load-bearing because `fillVault`
keeps the first value and provenance it sees. The BLPR-02 evaluation test seeds profile
`CAC: $150`, a contradictory Blueprint `CAC: $999`, and an ordinary retrieval figure, then pins the
distinct citation order to profile → Blueprint → retrieval and keeps CAC attributed to the profile.

**Accepted provenance ceiling:** `FINANCIAL_PATTERNS` scans every chunk. A figure stated only in the
serialized Blueprint is therefore attributed to "Business blueprint", not to the source document
from which `mergeBlueprint` derived it. This is provenance quality, not value correctness: the
profile-first rule still protects the user's typed figure. Upgrade path: suppress numeric restatements
in the serialized spine.

## Invariants — what must never break

- **The rubric comes from the TABLE, never from the markdown (15.1-04, SC#2b)** — the framework
  auto-pick indexes `TIER_FRAMEWORK` with `tenantProfiles.tier`. The `- **Persona:**` line in a
  `business_profile` vault doc is a PROJECTION of that tier (design §4.2) and **selects no
  behaviour**: the surviving `text.includes("- **Persona:**")` block is a profile DETECTOR that
  fills CONTENT fields only (name / niche / avatar / offers). `deserializeProfile` still falls back
  to `"solopreneur"` on a garbled line — harmless precisely because nothing authoritative reads it.
  Reading a tier back out of the markdown re-creates defect 1d. `personaHint` no longer exists.
  Enforced by `evaluations.test.ts > "the framework auto-pick reads the tier table (SC#2b)"`, which
  drives ONE identical malformed document (`- **Persona:** wizard`) at two different table tiers and
  gets two different frameworks.
- **`financialsPresent` still overrides the tier (Q3, LOCKED)** — financials mean a `growth-os`
  diagnosis is actually POSSIBLE, so the override is correct and must not be removed. The tier's
  perceivable effect lands on voice / framing / the specialist prompt (ADR-009), which is
  unconditional — **SC#5 must NOT be read as "the rubric must change"**. Pinned by the "Q3 holds"
  test, which uses the same fixture plus labeled figures.
- **`TIER_FRAMEWORK` is exhaustive by compiler bind** — `as const satisfies Record<Tier, Framework>`,
  with no trailing `?? "lean"`. The index is narrowed to a `Tier` by `?? "solopreneur"`, so the
  lookup is TOTAL and a `??` would be a branch that can never be taken. Mutation-checked: deleting
  the `enterprise` entry raises `TS2741` at the map AND `TS7053` at the index site.
- **Refs-only audit (§4)** — `evaluation.ran` payload is `{ framework, verdict, findingCount,
  gapCount, groundedDocCount, userProvidedCount }` — counts + closed enums ONLY. Findings/citations
  are content-plane (the row), NEVER audited. Enforced by the structural assertion in
  `evaluations.test.ts` ("audit payload carries counts/enums ONLY").
- **`runEvaluation`'s framework arg is PINNED, not schema-derived (14-01)** — it lists the four
  business frameworks literally, even though `insertEvaluation` right beside it derives its
  validator from `evalFields`. This is deliberate and load-bearing; do NOT "simplify" it back to
  `evalFields.framework`. See the Phase-14 section below for why.
- **Two-tenant isolation (SC #5)** — `byThread`/`recordScorecardAnswer` are tenant-scoped
  (`ctx.tenantId` via the wrappers); `runEvaluation`/`lastForThread` filter by explicit `tenantId`
  on `by_tenant_thread`. Tenant B never reads tenant A's row. Enforced by the isolation test.
- **Vault-first, then ask, then store (LOCKED)** — the durable scorecard is UPDATED each run
  (carry-forward), not rebuilt from null; a user-provided figure survives forward and is cited
  "user-provided". Enforced by the carry-forward/anti-re-ask test.
- **A field's STATED TIME is a fact about the field, never about the row (cash-business-finance
  Task 3 review fix).** `userProvidedAt` (dot-path → epoch-ms) is stamped by `applyScorecardAnswer`
  ONLY for a USER answer (`provenance.actor === "user"`), from `provenance.at` — never
  `Date.now()` — including a re-answer of an already-provided field, since a confirm-or-update IS a
  fresh stated time. **Corrected 2026-08-15 (`2026-08-15-scorecard-field-provenance`, ruling PF-9):
  this bullet used to claim `userProvidedAt` is stamped "on every answer", full stop — false since
  `applyScorecardAnswer` gained its required `provenance` argument. An agent answer never touches
  `userProvidedAt` at all; it is recorded in `evaluations.fieldProvenance` instead (see the entry at
  the top of this file).** `runEvaluation` carries `userProvidedAt` forward UNCHANGED into every new
  row, exactly like `userProvided`. **A row's own `createdAt` is NEVER a stand-in for a field's
  stated time.** The bug this closes: `runEvaluation` re-runs weekly on one pinned thread and persists a
  NEW row stamped `createdAt: Date.now()` on every run, carrying `scorecard`/`userProvided`
  verbatim. Before `userProvidedAt` existed, `packages/backend/convex/cash.ts`'s Business-tab
  reader used the carrying row's `createdAt` as a floor on a field's stated time — so a CAC answered
  91 days ago, merely carried into this week's fresh row, read back as "confirmed today" and
  silently suppressed the 90-day confirm-or-update prompt the rule exists for. A legacy row (no
  `userProvidedAt` entry for a field that has a value) has UNKNOWN age — `cash.ts` treats that as
  needing confirmation, never as fresh, and never fabricates a date. Enforced by
  `evaluations.test.ts`'s carry-forward describe block (a field's stated time survives a
  re-evaluation unchanged, even though the row's `createdAt` is fresh) and by `cash.test.ts`'s two
  `cash.inputs` staleness tests (a carried-forward stale answer, and the legacy-no-timestamp path).
  See `docs/playbooks/dashboard-pages.md`'s Cash section for the read side.
- **No fabricated metrics (SC #1)** — a financial field fills ONLY from a direct labeled statement;
  no grounding → the field stays null → not-enough-data. With zero grounded findings the engine
  suppresses gaps (no basis for a prescription) and returns "insufficient". Enforced by the
  thin-data test + `diagnose`'s conservative unknown→ask (see `growth-diagnostic.md`).
- **Read-only REVIEW (two-shapes rule)** — the evaluate path (`runEvaluation`/`byThread`) never
  proposes or sends. `actOnGap` (12-05) is the ONE control that crosses into the plan gate, and it
  only STAGES: it writes a `proposed` plan and nothing else. Zero sends before the human Approve
  still holds — `executePlan` is still the sole gate and still the sole `workflow.start` site.
- **A memo is NEVER an email (12-05)** — a memo-plan carries `kind: "memo"` and no recipients, and
  `executePlan` branches to the persist terminal BEFORE the mailbox pre-check, so `startFanout` /
  `deliverApprovedPlan` / `gmail.send` are structurally unreachable from it (no `requests` row is
  ever seeded). Enforced by `gapAction.test.ts` (approve with NO `gmailTokens` row succeeds and
  leaves `requests` empty — an email plan would have refused `gmail_not_connected`).
- **One plans row per thread** — `plans.byThread` is a `.unique()` read, so `actOnGap` RECYCLES the
  thread's existing row (resetPlan → patchPlan) instead of inserting a second one. A row that is
  mid-flight or delivered (`approved`/`scheduled`/`delivering`/`done`) is refused (`plan_busy`) —
  staging a memo must never clobber an in-flight send.
- **The memo NAMES the specialist, it does not RUN it** — `gap.route` is written into the memo body
  as an instruction plus its `gap.playbook` citation. Specialist execution is Phase 15+; nothing
  here may invoke a specialist skill.
- **No fabricated content in the memo** — `buildMemo` is a deterministic template over the persisted
  row only (cited findings + the prescription's own `reason`/`proofMetric`). It is a document the
  user reads, NOT an agent prompt, so §5 does not apply — but it must never assert a figure the
  evaluation did not ground.
- **Fail open (SC1)** — any grounding/skill error yields an "insufficient" verdict, never a throw
  out of the governed loop. Enforced by the outer try/catch + the fail-open grounding branch.
- **Closed `agentSteps.tool` union** — `"evaluateBusiness"` must stay in the union (Pitfall 2).
- **The delta is computed IN the engine, never patched on (13-01)** — see below.

## "What changed" — the `evaluations.delta` field (13-01, BEVL-03)

`evaluations.delta` is an OPTIONAL row field:

```ts
delta?: { newFindings: number; gapsClosed: string[]; gapsOpened: string[] }
```

- **Optional ⇒ no migration.** Every pre-13-01 row simply carries none, and the review card hides
  the "what changed" line when it is absent.
- **Written only when the caller asks.** `runEvaluation` takes `withDelta: v.optional(v.boolean())`;
  an on-demand run (the cockpit `evaluateBusiness` tool) passes nothing and records no delta. Only
  the cron-driven weekly review asks for one, because only a recurring run has a meaningful
  "since last time".
- **Computed INSIDE `runEvaluation`, immediately before `insertEvaluation` — not patched on
  afterwards.** Two reasons, both binding: (1) the `evaluations` table is APPEND-ONLY and
  `insertEvaluation` is its single write surface, so a follow-up `ctx.db.patch` would break that
  invariant; (2) the engine already holds `last` (the carry-forward read), `findings` and `gaps` in
  ONE scope at that point, so the delta is pure arithmetic over values already in memory — zero
  extra reads, zero extra writes. A separate "compute the delta" query would re-read `lastForThread`
  for data the action is already holding.
- **Gap identity is `${route}/${playbook}`, not `route` alone.** `diagnose()` emits only THREE
  routes (`offer-architect`, `money-model-designer`, `lead-engine`) and several distinct
  prescriptions share each — a route-only key would report a real move (e.g. "No offer worth buying
  yet" → "Offer is a commodity", both `offer-architect`) as "no change". `playbook` is a code-owned
  string literal from `diagnose()`, never LLM prose, so keying on it is safe in a way that keying on
  the human-readable `label` would not be.
- **`newFindings` is clamped at 0.** A DROP in finding count is not "new findings"; the card only
  renders the line when it is > 0. The clamp is now a belt-and-braces guard rather than a
  workaround: since 13-02 a repeat run over unchanged documents re-cites the SAME paths, so an
  unchanged week produces `newFindings: 0` honestly, not by clamping a negative.
- Enforced by the four `delta`-named tests in `evaluations.test.ts`
  (`vitest run convex/evaluations.test.ts -t "delta"`).

## Proactive weekly review (BEVL-03, 13-02)

`packages/backend/convex/proactiveReview.ts` — three functions, no new tables, no new audit rows.

```
crons.weekly("proactive-review", monday 06:00 UTC)
  → internal.proactiveReview.runWeekly        (internalMutation, no args)
      enumerate vaultDocuments.by_kind == "business_profile", dedupe by tenantId
      → ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne, { tenantId })   per tenant
          → internal.evaluations.lastForThread({ tenantId, REVIEW_THREAD_ID })
          → internal.evaluations.runEvaluation({ …, framework: last?.framework, withDelta: true })
          → internal.proactiveReview.insertReviewNotification   ONLY if something changed
```

### Invariants

- **`REVIEW_THREAD_ID` is STABLE per tenant — never a per-week id.** `lastForThread` is indexed on
  `(tenantId, threadId)`, so a date-derived thread id would silently reset the Scorecard every week
  and re-ask figures the user already answered — it breaks the LOCKED store half. The repeat-run
  cost of a pinned thread (the provenance collapse) was CLOSED in the engine instead; see the
  `fillVault` citation rule below. Do not "fix" a future finding-count anomaly by rotating the id.
- **`fillVault` records a citation on EVERY restatement, but sets the value only when unset.** The
  two rules are separate on purpose. Provenance is not persisted on the row, so it must be rebuilt
  from the grounded corpus each run; if a carried value short-circuits before the citation is
  recorded, `findings` collapses toward zero, the engine then suppresses gaps (SC #1), and the delta
  reports a false `gapsClosed`. A pre-seeded `user-provided` citation always wins (first writer of
  the citation wins), so a carried user figure is never relabelled as a vault fact.
- **The notification is written by a DIRECT `ctx.db.insert("notifications", …)`, never through
  `notifications.notify`.** `notify` unconditionally schedules `internal.notifyExternal.dispatch`,
  which calls `freshAccessToken` → the Gmail refresh path. Proactivity must not be able to break on
  the Google 7-day testing-token expiry (SC#2). The same bypass `gmailAuth.flagExpiringTokens` uses.
- **`weekly_review` / `weekly_review_failed` stay OUT of `NOTIFICATION_KINDS`.** That absence is the
  second, independent barrier: `notifyExternal.dispatch` returns at `if (!KINDS.has(kind)) return;`
  BEFORE any token work. Adding them there would arm the mailbox for the review.
- **Every function takes an explicit validated `tenantId`.** A cron has no `ctx.auth`, so
  `tenantQuery`/`tenantMutation` are structurally uncallable; the `runEvaluation` /
  `recordScorecardAnswerInternal` internal-twin convention applies. `vaultDocuments.by_kind` is the
  ONE deliberate cross-tenant read in the module and it is consumed for tenant ids only.
- **No new audit eventType.** `evaluation.ran` already records the run; a `review.delivered` row
  would duplicate it. There is no `review.*` event anywhere in the phase.
- **Notify only on change.** First review ever, a moved verdict, or a non-empty delta. An idea-stage
  tenant gets ONE "not enough data" ping, then silence. The evaluation ROW is written every week
  regardless, so the card is always current — only the bell is conditional.
- **A failed review still tells the user.** The `catch` in `reviewOne` inserts
  `weekly_review_failed` with the static `REVIEW_FAILED_MESSAGE`; silence would be indistinguishable
  from a healthy quiet week. The failure REASON never reaches the notification plane (§4).

### How to change it safely

- Adding a review notification kind? Add the literal to `insertReviewNotification`'s `v.union` AND a
  static message constant in `packages/core/src/notificationTemplates.ts` — and keep it out of
  `NOTIFICATION_KINDS`. Never interpolate a reason or any grounded prose into `message`.
- Adding a second read to `runWeekly`? The SC#3 guard pins `by_kind` to exactly ONE occurrence; a
  new read must be `withIndex`'d on `tenantId` or the test fails.
- Changing the cadence? Only `crons.ts` changes. `crons.weekly` is used deliberately over
  `crons.cron` (see the comment there); `dayOfWeek` MUST be lowercase — the runtime validator
  rejects `"Monday"` and the JSDoc example is wrong.

### How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts` — 8/8: five
  behaviour cases (enumeration+dedupe, card+notification, notify-only-on-change, cross-tenant
  isolation, audit unchanged) and three static guards. Zero network: `rag.search` throws on the
  unset `OPENAI_API_KEY` and the engine fails open, while the tenant's own profile doc still enters
  the corpus through `internal.vault.profileSeedDocs` (a plain DB read).
- LOCKED manual procedure: *Convex dashboard → function runner → `proactiveReview:runWeekly` with
  `{}` → open `/dashboard/workspace`.*

## "Act on this" now RUNS the specialist (15-04, DISP-01)

12-05 shipped `actOnGap` as a deterministic memo that NAMED the target specialist and cited its
playbook. 15-04 closes that loop: the specialist actually runs, and the memo is what you get when
it cannot.

`actOnGap` is STILL a `tenantMutation`. It does not become a `tenantAction` — a Convex mutation
cannot call an action, and converting would make the plan-row recycle (`resetPlan` + `patchPlan`)
interruptible while leaving the card blank for the same 10-30s anyway. It stages the row and
schedules `internal.dispatch.runSpecialist`.

**Two terminals, chosen by `resolveSpecialist(gap.route)` at the entry point:**

| gap route | plan row after `actOnGap` | scheduled |
|---|---|---|
| a REGISTERED specialist | `status: "collecting"`, `kind: "memo"`, subject set, `body: ""` | one `runSpecialist` |
| anything else (`""`, `"scale"`, a pre-union route) | `status: "proposed"` with the `buildMemo` body — the 12-05 behaviour verbatim | nothing |

The runtime resolve is mandatory, not belt-and-braces: `gaps[].route` persists as `v.string()`
(`schema.ts:350`), so a stored route reaches here un-narrowed — including `diagnose()`'s deliberate
`""`. Resolving at the entry point puts the fail-closed guarantee in front of the scheduler as well
as inside the dispatcher.

### Invariants

- **The `collecting` staging IS the Approve-race mitigation. Do NOT "simplify" it back to
  `proposed`.** The failure it prevents: the user taps *Act on this*, a template body is instantly
  approvable, and they approve it at the exact surface where consent is irreversible — saving a
  template to the vault under a header that will shortly claim a specialist produced it. It costs
  nothing because `executePlan` already returns `alreadyStarted` for any non-`proposed` row
  (`cockpit.ts:530`) and `PlanCard` renders only at `proposed` (`cards.tsx:1624`) — so the race is
  closed BY CONSTRUCTION: no new guard, no new status literal, and zero `apps/web` edits. The
  CKPT-05 dispatch trace step is the progress indicator.
- **`rootRequestId` is minted fresh with `crypto.randomUUID()` and is NEVER derived from `planId`.**
  `plans.byThread` is a `.unique()` read and `actOnGap` RECYCLES the thread's one row (12-05), so a
  planId-derived lineage key would merge two dispatches into one unreconstructable tree. It is not
  `plans.correlationId` either — that is only written at `executePlan`, i.e. after Approve. ADR-008.
- **`landSpecialistResult` is the ONLY writer of a dispatched body**, and it no-ops unless the row
  is still `collecting`, still `kind: "memo"`, and under the SAME `tenantId`. It is an
  explicit-tenantId `internalMutation` (a scheduled action carries no live identity — the 12-04
  `recordScorecardAnswerInternal` precedent), so that tenant check is MANUAL and must not be
  deleted. It patches (never `resetPlan`, which would clear `kind: "memo"`).
- **Every outcome leaves `collecting`.** `dispatch.ts`'s `dispatchAndLand` lands in a `finally`, so
  success, a cost-ceilinged run, all four governed refusals and a thrown turn all end at an
  approvable row. A row stuck at `collecting` renders no card at all — the control would silently
  have done nothing.
- **`buildMemo` is now the FALLBACK, and its wording branches on `fallbackReason`.** With a reason
  it must NOT say *"That specialist does not execute yet"* — that sentence became false the moment
  dispatch shipped, and an approved memo may not tell the user something untrue. The reason is a
  CODE mapped through the code-owned `FALLBACK_SENTENCE`; the code itself never reaches the user.
- **The attribution line and the cost-ceiling marker ride the plan BODY** (`specialistMemoBody`,
  `@pikar/core`), never a new `plans.status` literal — see the cockpit playbook.

## A second stager, and a memo that stops lying (16-06, DISP-02)

> **Provenance, resolved.** This section was drafted by the **15.2 lane** off 16-06's then-uncommitted
> diff (concurrent GSD lanes share one checkout, so the §9 Stop hook blocks on another lane's work
> in progress; describing the diff was the honest resolution, since a one-line `Last verified` bump
> is only legitimate when playbook CONTENT is unaffected — and this changes a memo a user reads).
> **16-06's author has since read it against the shipped code and confirms it. No correction was
> needed.**

**`landSpecialistResult` gained an optional `fallbackBody`.** The no-evaluation-row branch used to
fall through to `LOST_CONTEXT_MEMO` unconditionally; it now consults the caller first, in exactly
one place and with exactly one `??`:

```ts
body = row && gap ? buildMemo(...) : (a.fallbackBody ?? LOST_CONTEXT_MEMO);
```

The reason is the same honesty rule that governs `buildMemo`'s wording (above): `LOST_CONTEXT_MEMO`
says *"the evaluation it was based on is no longer on file"*, and **that sentence is FALSE for a
research run** — a research run was never based on an evaluation, so there is nothing to have lost.
The gap path (`runSpecialist`) passes nothing and stays byte-identical; only the research dispatch
supplies a body. Same invariant as `FALLBACK_SENTENCE`: an approved memo may not tell the user
something untrue.

**`plans.stageResearchPlan` is a deliberate near-copy of `applyActOnGap`'s staging block.** Same
`insertPlan`/`resetPlan`/`patchPlan` spine and the same `collecting` handoff, with a NARROWER
recycle rule:

| row | `applyActOnGap` | `stageResearchPlan` |
|---|---|---|
| `collecting` + `kind: "memo"` | recycles it | **refuses** — `research_in_flight` |
| carries user draft content (recipients/subject/body/bodyIntent/attachments) | may reset (the USER tapped) | **refuses** — `draft_in_progress` |
| empty `collecting` row (fresh thread) | recycles | recycles |
| past `proposed` (approved → done) | never | never |

Two things in that table are load-bearing. **`kind === "memo"` is not decoration:** `cockpit.ts`
inserts every thread's plan row at `collecting` on the first turn and it stays there for the whole
composition, so a bare `status === "collecting"` refusal would refuse research on essentially every
live conversation. A `collecting` row is only "owned by a dispatch" when a dispatch staged it, and
`kind: "memo"` is what records that. And the `draft_in_progress` refusal exists because **`actOnGap`
resets on a USER tap while this stager is driven by the MODEL** — destroying a half-composed email
because someone asked a research question is not a trade the user agreed to.

The persisted `research_in_flight` interlock is also what makes a per-turn envelope closure
unnecessary: one run per thread, one freshly derived root envelope, holding across turns, requests,
and a fallback retry that rebuilds the tool record.

**The two stagers are NOT shared on purpose.** The rules disagree, so a shared helper would need the
rule as a parameter — a knob for two callers that disagree is the abstraction CLAUDE.md §8 forbids.
They are cross-referenced in both directions instead. **Change one and decide CONSCIOUSLY whether
the other moves.**

### How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts convex/gapAction.test.ts`
  — 23/23. `evaluations.test.ts` owns the dispatch assertions (staging, the queued args, the fresh
  `rootRequestId`, both non-specialist terminals, and the end-to-end
  gap → collecting → run → proposed → approve → ONE vault doc → ZERO `requests` rows).
  `gapAction.test.ts` characterizes the no-specialist terminal.
- The end-to-end test drives the queued job through `internal.dispatch.__runSpecialistWithScript`
  after CANCELLING it. Do not replace that with `t.finishAllScheduledFunctions()`: the production
  `runSpecialist` resolves a real gateway model, and convex-test flushes due scheduled work in the
  background — an uncancelled job makes the suite depend on whether `OPENAI_API_KEY` is set.

## How to change safely

- **Add a grounded scorecard field / finding** — add the dot-path to `TRACKED` (label + section) and,
  for a financial, a `FINANCIAL_PATTERNS` entry; keep the extraction DIRECT-statement-only (no
  inference that could fabricate). Re-run `evaluations.test.ts`.
- **Change the audit payload** — it must stay counts/enums-only; update the structural assertion's
  key set in lockstep. A prose field here is a §4 regression.
- **Add a framework** — add the literal to the schema `framework` union + `FRAMEWORK_SKILL` +
  (if it is some tier's default) `TIER_FRAMEWORK`; ensure the rubric skill is seeded/gated (12-02).
- **Add a TIER** — widen `TIERS` in `@pikar/core` and `tenantProfiles.tier` in `schema.ts`, then
  fix the compile error `TIER_FRAMEWORK` raises. That error is the feature: do NOT silence it with a
  `??` default, which would silently classify the new tier as `lean`. See `onboarding.md` for the
  tier control plane itself.
- **Schema change on `evaluations`** — append-only (no migration); update the derived `evalFields`
  consumers only if you add a field. Never make the row mutable except via the two write surfaces.
- **Change what a memo says** — edit `buildMemo` only. It reads the persisted row; if you need a
  new fact in the body, persist it on the gap (optional field) at diagnose time rather than
  re-deriving it at act time (two derivations drift).
- **Change what Approve does for a memo** — edit `persistNextStepMemo` + the `plan.kind === "memo"`
  branch in `cockpit.executePlan`. Do NOT route a memo through `deliverApprovedPlan`: that workflow
  fans out `gmail.send` per recipient and a memo has none. A future non-email terminal (ACTN-01,
  Phase 15) generalizes this branch — it does not widen the gmail one.

## How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts` — all six cases
  (grounded cited row, store path, refs-only audit, carry-forward, isolation, thin-data). ~8s, no
  deployment.
- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts -t "framework auto-pick reads the tier table"` —
  the SC#2b set: the malformed-doc regression, the two-tiers-one-markdown authority proof, the
  no-row fallback, and the Q3 override. Plus the structural check that the authority is really gone:
  `grep -n "personaHint" packages/backend/convex/evaluations.ts` must print NOTHING.
- `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` — the four BEVL-02 cases
  (proposed memo transition, nothing-to-act-on, memo-persisted-not-emailed, double-approve
  idempotence). Needs the `workflow` + `workflow/workpool` components registered (the memo terminal
  ingests through `startIngest`) alongside `auditCounts`.
- `pnpm --filter @pikar/backend typecheck` — the engine source is type-clean (pre-existing
  test-file typecheck failures are tracked in the phase `deferred-items.md`).
- `node scripts/check-playbooks.mjs` — this playbook covers `packages/backend/convex/evaluations.ts`.

## Operational notes

- No new env vars/seeds. The framework rubric skills must be seeded (`seedSkills`) for a real run;
  a missing/inactive method fails open to "insufficient".
- The grounding `query` is an EXPLICIT arg — the cockpit `evaluateBusiness` tool (llm.ts, 12-04)
  calls `runEvaluation` with an explicit tenantId; tests pass a `SMOKE::<docId>` sentinel to ground
  offline. Absent → the `DEFAULT_QUERY` (hits `rag.search`).
- The cockpit `recordScorecardAnswer` tool routes through `recordScorecardAnswerInternal` (explicit
  tenantId) and emits its OWN refs-only `evaluation.answered` audit (field name + value fingerprint)
  from llm.ts — the internal mutation itself stays audit-silent (one audit per tool call, in the tool).

## Known gaps & deferred work

- **Deterministic extraction only** — v1 fills the scorecard by profile-parse + direct labeled-number
  scan; the rich per-quadrant LLM-narrated findings ride the live model, taught via a `cockpit-agent`
  body change through the eval gate (later plan). `ponytail:` upgrade path = thread the rubric body
  into an LLM parse when the card needs prose findings.
- **The memo is the stand-in for the fix, not the fix** (12-05) — approving it saves a next-step
  memo; it does not build the offer or run the campaign. Specialist EXECUTION is Phase 15+.
- **Acting on a gap recycles the thread's plan row** — so a thread that already delivered an email
  (`status: "done"`) refuses `actOnGap` with `plan_busy`; the user starts a new chat. `ponytail:`
  upgrade path = a plan row per artifact (drop the one-row-per-thread `.unique()`) if threads ever
  need to hold an email AND a memo at once.
- **The vault doc is the whole terminal** — there is no memo index/list surface; a `next_step_memo`
  is browsable at `/dashboard/vault` like any other doc and groundable via `startIngest`.
- **Market-fact grounding is out of scope** — vault-grounded findings only until web research
  (Phase 16); `marketViable` is a supplied signal, not verified.
- **Specialist EXECUTION deferred (15+)** — a gap's `route` names the target specialist skill; it is
  not run here.

## Sharing the `evaluations` table with voice-doc (Phase 14, DOCV-01)

Phase 14's voice-doc review persists into the SAME `evaluations` table this engine owns, so the
post-call surface can reuse the existing `byThread` read and `EvaluationCard`. The table is shared;
**the engine is not**. Keep that line clean.

### What Phase 14 added to the table

- `framework` gained a fifth literal, `"document-review"`. It is human-readable on purpose:
  `buildMemo` prints `Diagnosed on the **${row.framework}** framework` as user-visible prose inside
  an approvable memo, so a slug like `docrev` would leak into the product.
- `findings[]` gained `citationExcerpt: v.optional(v.string())` — a capped, substring-verified quoted
  passage. Optional is load-bearing: an absent excerpt is a VALID, non-degraded state, never an empty
  string. Business evaluations simply never set it, and every pre-Phase-14 row is untouched
  (additive + optional ⇒ no migration).
- `voiceSessions.docRef` — not this playbook's table, but it is what scopes a session to one report.

### The invariant: a doc-review row never enters this engine

A voice-doc row is written STRAIGHT through `insertEvaluation` by `voiceDoc.ts`. It never goes
through `runEvaluation`: there is no `document-review` rubric skill, no `FRAMEWORK_SKILL` entry, and
no `diagnose()` path for it. Two mechanisms hold that, and they are not redundant:

1. **`FRAMEWORK_SKILL` has no `document-review` key** (the original design). An unmapped literal
   cannot load a rubric.
2. **`runEvaluation`'s `framework` arg is explicitly PINNED** to `swot | lean | bmc | growth-os`
   (14-01). This is the stronger of the two — it refuses a doc-review row at the **validator
   boundary**, before any handler code runs.

Why the pin exists at all: `const evalFields = schema.tables.evaluations.validator.fields` feeds
**two** signatures. `insertEvaluation` (the write surface) SHOULD widen for free when the schema
widens — that is exactly how a voice-doc row gets persisted with no edit here. `runEvaluation` (the
engine entrypoint) must NOT. Before the pin, widening the schema silently widened the engine's
public input type and broke `const chosen: Framework` at the type level. Phase 14's research
predicted "zero edits to `evaluations.ts`" on the assumption that `evalFields.framework` fed only
`insertEvaluation`; that assumption was wrong, and the pin is the correction (user-approved
2026-07-25, recorded as an authorized Lane-C exception in `.planning/PARALLELIZATION.md`).

**If you widen `evaluations.framework` again, check every signature that derives from `evalFields`,
not just the one you intended to widen.**

`proactiveReview.ts` carries the same rule at the call site: `reviewOne` carries last week's
framework forward, so it explicitly drops a `document-review` value and falls back to auto-pick
rather than throwing. A doc-review row cannot reach `REVIEW_THREAD_ID` today (voice-doc rows live on
synthetic `voice-doc:<sessionId>` threads), so that is a type-level guard, not a live branch — but
the weekly review must never fail on a framework it can simply re-derive.

### The excerpt is content-plane, and strictly so (§4)

`citationExcerpt` is the only verbatim report content Phase 14 persists. It is LEGAL in
`evaluations.findings[]`, in a memo body, and on the post-call card. It is ILLEGAL in every `audit` /
`deadLetters` / `telemetry` `payload:` and in every `agentSteps` row. There is no third state: code
that needs to log "which finding" logs an index or a count, never the quote. This is the same
content-plane/log-plane split the `evaluation.ran` audit already obeys (counts + closed enums only),
extended to the one new field that could break it. Plan 14-09 pins it with a mutation-verified static
scan.

See `voice.md` § "Voice-doc sessions (Phase 14)" for the voice half.
