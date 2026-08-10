# Playbook: Connected dashboard pages

> Last verified: 2026-08-10 (Plan 19-13 — **`apps/web/e2e/pipeline.spec.ts` DELETED.** It was a
> one-shot receipt, not a regression guard: its own header documented that test 1 pins an
> EMPTY-tenant precondition that can never hold again once test 2 creates a contact, and the
> phase-19 verifier ran it and got **1 failed / 1 did not run**. `e2e/pipeline-uat.spec.ts` steps
> 1+2 and 3 supersede it and assert strictly more, over **throwaway tenants signed up through the
> real `/signup` form**, so their empty-tenant precondition is re-establishable by construction.
> Its `watch.json` entry here was removed with it. No page, query or component changed.)
> 
> Last verified: 2026-08-10 (Plan 19-12 — the phase-19 UAT clock defect). **Approvals gained ONE durable surface and lost no
> behaviour.** `InFlightRow` now renders SC#5's withheld report —
> `Sent to N. Withheld M who unsubscribed: …` — from `plan.withheldRecipients` on the plan row via
> `@pikar/core`'s `withheldNote`, as `role="status"` in `--ink-soft` (never `alert`, never amber).
> WHY IT MOVED: `AwaitingCard` still builds the same sentence with `withheldSuffix` into its
> `result` state, and **nobody can read it** — `approvals.listAwaiting` paginates `"proposed"`
> only, and a successful approve IS the `proposed → approved` transition, so the card unmounts
> before `setResult` lands. The transient copy is left in place (it is correct for the refusal and
> `alreadyStarted` branches, which DO leave the row awaiting); the durable copy is the one a human
> actually sees. **Rule: any state produced BY a status transition must not live in a component
> gated ON that status.** Measured in the browser at phase-19 UAT step 9(b).

> Last verified: 2026-08-10 (WHOLE-BRANCH REVIEW FIX, live-finance-inputs — three corrections to
> the finance plane, two of them to claims this playbook itself made.
> **(C1) `financeSpineLine` had ZERO callers.** The entry below said it was "consumed by Task 7 and
> the existing spine assembler"; neither was true — Task 7 built `readFinance`, which reads
> `unitEconomics`/`solvency`/`inputsFor` and never touches it, and no task ever wired the assembler,
> while the shipped skill body told the model "your context carries a `Finance:` line". It is wired
> now — **as its own query, `internal.cash.financeSpineFor`, joined to the blueprint spine only in
> `llm.ts`'s `buildTurnPrompt`.** (The first attempt appended it inside
> `blueprint.spineForTenant`; the re-review caught that this is also `evaluations.ts`'s grounding
> chunk and the appended figures got captured as `financials.cac` — see the onboarding playbook's
> entry and `evaluations.test.ts`'s pin. `vaultGround.ts:225` calls `spineForTenant`, NOT
> `renderSpine`, which is what made the first rationale wrong.) Both channels are read
> independently and fail open independently, so a tenant with figures and no confirmed blueprint —
> the ordinary state of a new account — still gets the line, and a tenant with neither gets the
> byte-identical legacy prompt. The line also carries a `PIKAR` marker on any figure the owner did
> not supply, mirroring the blueprint spine's `[stated]`/`[source: X]` and the tile copy in C2
> below; `FINANCE_SPINE_BUDGET` was re-measured 437 → **503** for it (11 fields × 6 chars),
> confirmed by the existing `not.toContain("…")` assertion, which caught the truncation when the
> marker first landed at the old budget.
> **(C2/I3) An agent-written figure rendered as the owner's own statement.** EVERY claim this slice
> stores is `origin: "stated"` (spec §1), so origin alone could not separate the owner's typed
> figure from the agent's approved one — `statedFigure` dropped `actor` and `FigureTile` branched on
> origin, printing "You told us this on <date>." over the agent's own arithmetic ($800 × 4
> subscribers → MRR 3,200, which the owner never said). `CashFigure`'s known variant gains an
> OPTIONAL `actor`, `statedFigure` threads it, and the tile branches on the pair: `stated`+`user` →
> "You told us this on <date>."; `stated`+anything else → "Recorded by Pikar from your own
> information[, as of <date>]." Absence means UNKNOWN, never "the user" — attribution to the owner
> requires positive evidence, which is what fixes the three `knownFigure("stated", …)` scorecard
> reads in `@pikar/core` (`statedLtgp`, `grossMargin`, `cohortChurn`) that carry no provenance at
> all. "as of", not "on": an agent write's `statedAt` is the claim's `observedAt` — when the figure
> was TRUE, not when it was approved. In the same fix the read boundary stopped calling a grounded
> scorecard fill `observed`: spec §1 reserves that for "Pikar measured it" and nothing measures yet,
> so `inputStatesFor` now returns `stated` + `actor: "agent"` for a fill absent from `userProvided`,
> which also retires the false "Measured by Pikar on <date>." on that path. `origin: "observed"` is
> therefore UNREACHABLE again (correcting the Task-3 entry below) — the renderer branch stays for
> the measured slice and is pinned by its own tests.
> **(I5) An approved plan that wrote nothing left no audit trace.** `applyFinanceClaims` returned
> early when `isNewerThan` skipped every claim, so `executePlan` patched `done`, the card claimed
> success and the append-only log recorded nothing at all. The row is now ALWAYS written for a
> non-empty claim list, carrying `count` (written) and `skipped` (the rest), and the applier returns
> `{ok, applied, skipped}` — `executePlan`'s finance arm passes `applied` back so both approval
> surfaces say "Your figures were already up to date, so nothing changed." instead of implying a
> write. An EMPTY claim list still writes nothing: `stageFinanceWrite` refuses to stage one, so that
> is a hand-seeded/legacy row, not the skip path.)

> Last verified: 2026-08-10 (Task 7 REVIEW FIX, live-finance-inputs — **`@pikar/core`'s `solvency()`
> now takes `tier: Tier | null`, and `null` is PERMISSIVE, not a guess.** Review found that
> `solvencyForTenant`'s `row?.tier ?? "solopreneur"` default — correct on the Finance PAGE, which
> shows a compensating "complete your shape" invitation beside the guess — had been reused verbatim
> for `readFinance` (the cockpit tool, Task 7 above), which has no such invitation: an unconfirmed
> tier made `mrr`/`arr`/`workingCapital` come back `not-applicable` with the TOOL's own authority
> behind the guess, so a funded startup mid-onboarding asking "what's my MRR?" got told, confidently
> and wrongly, that MRR structurally does not apply to their business. Fixed in `@pikar/core`, not
> patched at either adapter call site: `tier === null` now falls through to the ordinary
> missing-input handling (`requireInputs`/`statedFigure`) instead of asserting a structural fact the
> function does not have — a REAL stated MRR still surfaces as `known`, an absent one reads `unknown`
> ("needs your figure"), and `not-applicable` is reserved for a CONFIRMED tier that genuinely
> excludes the metric. `solvencyForTenant` (`cash.ts`) now takes the fallback as an explicit
> parameter so the two callers state their own policy instead of one function choosing for both: the
> dashboard's `solvency` query is BEHAVIOURALLY UNCHANGED (`"solopreneur"`, same as before — pinned
> by `cash.test.ts`'s existing 35 tests, none of which needed editing), and only `solvencyFor` (the
> tool) passes `null`. `packages/core/src/cash.test.ts` gained a 4-test `tier: null` describe block;
> `cockpitTools.test.ts` gained a dedicated test proving the SAME tenant/data reads `known` MRR
> through the tool and `not-applicable` MRR through the dashboard query, on purpose, not by drift.)

> Last verified: 2026-08-10 (Task 7, live-finance-inputs — **`cash.ts` gains two `internalQuery`
> readers, `unitEconomicsFor`/`solvencyFor`, taking an EXPLICIT `tenantId` for `llm.ts`'s new
> `readFinance` cockpit tool** (the tool loop has no `ctx.tenantId`). Both the existing
> `unitEconomics`/`solvency` `tenantQuery` handlers AND these new readers now call the SAME
> module-private `unitEconomicsForTenant`/`solvencyForTenant` helper functions — a refactor, not a
> second copy: the module's own banner ("re-deriving anything here would create a second,
> silently-drifting definition of the business's money") applies just as much to two Convex
> functions computing the same figure as to a hand-rolled formula, so the explicit-tenant readers
> share the derivation rather than re-implementing it. No behavioural change to the two existing
> tenant-scoped queries — same inputs, same `Date.now()` per-call clock, same output shape.)

> Last verified: 2026-08-10 (Task 5 REVIEW FIX, live-finance-inputs — **pass 1 validated only TWO
> of `validateFigureClaim`'s six rules; the other four still threw, straight past the return
> contract the entry below built.** Review's trace: `{basis: "   ", observedAt: <tomorrow>}`
> cleared both shape-guards (a whitespace string IS a string), reached pass 2's `writeFigureRow`,
> which called `validateFigureClaim` itself and threw — the exact production failure this task
> exists to remove, still live on a blank basis, an out-of-range/NaN value, and a NaN/negative/
> **future** `observedAt` (the likeliest model error once Task 8 parses date phrases). Fix: pass 1
> now calls `validateFigureClaim` directly and returns `malformed_figure_claim` on any failure,
> making the doc comment's claim — "every claim is validated FIRST, with zero writes" — actually
> true. **One subtlety beyond the literal hoist:** `validateFigureClaim` refuses
> `{actor: "user", confidence !== "high"}`, and a claim's `actor` field is untrusted input this
> function always overwrites (see the STAMPED comment a few lines below) — validating the RAW
> claim would have resurrected a narrower version of the same bug for that one field ("a staging
> bug must not become an error on a plan the human already approved"), so pass 1 validates
> `{...claim, actor: "agent"}`, matching exactly what pass 2 would have validated anyway. A side
> effect worth recording: after this fix, `writeFigureRow`'s own `validateFigureClaim` call is
> PROVABLY UNREACHABLE from `applyFinanceClaims` (every claim reaching pass 2 already cleared the
> identical check in pass 1) — the "approve-all-or-none" test was rewritten to describe ORDERING
> rather than ROLLBACK, since a genuine pass-2 failure-after-a-good-write is no longer constructible
> from this function. `writeFigureRow`'s throw stays, unmodified, as the last-resort guard for its
> other caller, `saveInput`. Also: `agent_cannot_update_figure`'s copy in `ApprovalsView.tsx` grew
> "Nothing changed." — a plan defect in the original brief's copy, not an implementation gap; every
> sibling in that map already closes by naming what did not happen.)
>
> Last verified: 2026-08-10 (Task 5, live-finance-inputs — **`applyFinanceClaims`'s two refusals
> now RETURN instead of throwing, so they reach the Approvals card.** Both were
> `throw new Error("INVALID_INPUT: …")`; Convex redacts a non-`ConvexError` message in production,
> so the owner saw an opaque server error with no lever, and because the plan stays `proposed`
> every retry reproduced it. `cash.ts` exports a new `FinanceApplyRefusal` union
> (`"malformed_figure_claim" | "agent_cannot_update_figure"`) and `applyFinanceClaims` returns
> `{ ok: false, reason }` instead — the SAME shape `media.ts`'s `reserveJobInner` already used for
> `no_deck`. This forced a STRUCTURAL change, not just a signature one: a `return` does not roll
> back Convex's transaction the way a throw does, so the function now validates every staged claim
> in a FIRST pass with zero writes, and only runs the write pass once the whole list clears —
> otherwise a bad second claim would leave a good first claim's write committed, silently breaking
> approve-all-or-none. `executePlan`'s `finance_write` arm (`cockpit.ts`) checks `applied.ok` and
> returns the reason rather than letting the (former) throw propagate; its return union grew the
> two reasons. `ApprovalsView.tsx`'s `refusalMessage` map grew the matching copy, verbatim from the
> task brief. `writeFigureRow`'s own scorecard-actor throw is UNCHANGED (last-resort invariant
> guard for every OTHER caller of that shared writer — the applier is the layer that knows a human
> is waiting on the refusal). Also added: a source-scan regression test pinning that the Schedule
> button's `item.kind === "email"` gate in `ApprovalsView.tsx` never grows a `finance_write`
> branch — no source change needed, the button was already unreachable for that plan kind, but
> nothing had pinned it before.)
>
> Last verified: 2026-08-10 (Task 4 REVIEW FIX, live-finance-inputs — **the applier now STAMPS `actor: "agent"` instead of trusting the plan row.** Two of three reviewers found it independently: a row carrying `{actor: "user", confidence: "high"}` passed every guard the entry below describes, because `validateFigureClaim`’s actor rule only bites when `confidence !== "high"` and confidence is model-controlled — so that pair is a LEGAL claim by its contract, and `writeFigureRow` persisted it verbatim. The agent’s figure would then have rendered through `inputStatesFor`/`statedFigure` in the owner’s own trust language (the exact leak Tasks 2 and 3 were spent closing) and, worse, been recorded as `actors: ["user"]` in the APPEND-ONLY audit log, where it could never be corrected. `actor` is not data read off the row — it is a fact about which DOOR the write came through, and `applyFinanceClaims` IS the agent door by construction (`saveInput` hardcodes `actor: "user"` and never routes here), so it is stamped. STAMPED rather than refused because a stamp cannot fail: a staging bug must not surface as an error on a plan the human already approved. The stamped claim is what `written[]` collects, so `payload.actors` reports the door too. Also closed the untested-invariant gap the review found: approve-all-or-none was claimed in three comments and exercised by nothing, because every refusal test passed a SINGLE claim that threw before any write — there is now a two-claim test, good first and a scorecard `cac` second, asserting the enclosing serializable mutation discards the write that already succeeded.)
>
> Last verified: 2026-08-10 (Task 4, live-finance-inputs — **the Approve-gated agent write path exists.** `convex/cash.ts` exports `applyFinanceClaims(ctx, tenantId, claims)`, the ONLY route an agent-proposed figure reaches a store and called from `executePlan`'s `inline` arm alone; `schema.ts` widens `plans.kind` with `finance_write` and adds `plans.financeClaims` (content plane, `field` left as `v.string()` because the closed field union lives in `CASH_INPUTS` and a mirrored validator here would be a second copy). THREE refusals, all pinned by tests, and each one exists because the plan row is DB-sourced JSON cast to `FigureClaim`, NOT type-checked input: **(1)** an unknown `field` or a non-string `basis` is refused as `INVALID_INPUT: malformed claim on plan row` BEFORE `validateFigureClaim` sees it, because that function throws past its own `{ok, reason}` contract on both shapes (`cashInputSpec` throws on an unknown field; a null `basis` TypeErrors on `.trim()`), so an approved plan would crash a mutation instead of refusing cleanly; **(2)** a scorecard-store field is refused as `INVALID_INPUT: that figure cannot be updated by an agent yet` — earlier than `writeFigureRow`'s own throw, so the reason is one the approval card can show — which means **the agent can update the five `financeInputs` figures and CANNOT yet update CAC**, a real product limit whose upgrade path is the per-dot-path provenance map on `evaluations` recorded in the entry below; **(3)** a claim not `isNewerThan` the stored `statedAt` is SKIPPED, not an error — `writeFigureRow` has no ordering guard, so without this a claim observed in June would patch over a figure the human saved today, moving `statedAt` backward and flipping `actor`. §4: the ONE audit event this module writes, `finance.claims_applied`, carries field NAMES, a COUNT and enums and never a value; it counts the claims actually WRITTEN, not the ones staged, so a fully-skipped list writes no row at all. It goes through `internal.audit.log` (the sole insert surface, §3) — hence the applier takes the whole `MutationCtx`, mirroring `contacts.applyCrmOperations`. The approve surface moved with it: `approvals.ts`'s `planKind` union, and `ApprovalsView.tsx`'s badge ("Figure update"), approve label ("Approve & update the figure") and card title (a COUNT of updates — never the figure, §4 applies to a screenshot too).)
>
> Last verified: 2026-08-10 (Task 3 REVIEW FIX, live-finance-inputs — the ceiling recorded in the entry below is now a REFUSAL rather than a comment. `writeFigureRow` throws `INVALID_INPUT: scorecard store carries no provenance` for `actor: "agent"` on any scorecard-store field. Review found the loss is worse than first reported and not display-only: `applyScorecardAnswer` takes only `(db, tenantId, threadId, path, value)`, so FOUR claim fields are dropped — `origin`, `actor`, `basis` and **`observedAt`**, the last meaning the answer is stamped with the WRITE time rather than the time the figure was true — and the dot-path it appends to `userProvided` is what `runEvaluation` rebuilds its citation map from, stamping every member `{title: "user-provided", confidence: "high", source: "user-provided"}`. An agent figure would therefore have laundered into the Business Evaluation Engine at high confidence and suppressed the re-ask. `saveInput` is unaffected (always `actor: "user"`); the applier gets a loud failure instead of a quiet lie. Also closed the coverage gap the review found: Task 3's original two tests both used `cashOnHand`, so the `userProvided` predicate that flips the trust language for SIX of the eleven `CASH_INPUTS` fields had NO test — three now cover it (panel-answered `cac` reads stated/user/null, a grounded fill reads observed/agent/"business evaluation grounding", and the guard refuses without writing), all three verified to fail against a deliberately inverted predicate.)
>
> Last verified: 2026-08-10 (Task 3, live-finance-inputs — the finance WRITE path now has exactly ONE row-writer. `financeInputs` gains three OPTIONAL provenance columns (`origin`/`actor`/`basis`; absent = a user statement, which is what every pre-existing row is, so no backfill and no migration), and `statedAt` is documented as meaning "when the figure was TRUE" — `FigureClaim.observedAt` lands there, un-renamed because a rename would cost a migration for no behavioural gain. `convex/cash.ts` exports `writeFigureRow(db, tenantId, claim)`, a plain async function over an EXPLICIT tenantId, and `saveInput` is now a one-line delegation to it: the ungated human edit and the Approve-gated applier route through the same store-routing rule (contacts-crm invariant 13; invariant 11's ACTOR-decides-gating rule is what makes the human path ungated). `inputStatesFor` populates the Task-2 `CashInputState` fields at the read boundary — the `financeInputs` branch from the stored columns, the scorecard branch from `userProvided` membership, so a grounded fill reads ~~`observed`~~/`agent` instead of borrowing the owner's authority (**CORRECTED by the whole-branch review entry at the top: a grounded fill is `stated` + `agent`, because spec §1 reserves `observed` for figures PIKAR MEASURED and nothing measures yet — so `origin: "observed"` is unreachable again and the renderer branch below is kept for the measured slice, not because anything produces it**). That made `origin: "observed"` REACHABLE for the first time, which exposed a renderer gap fixed in the same commit: `CashView.tsx`'s observed branch discarded `statedAt` and `stale`, so a 200-day-old machine-extracted figure rendered a bare "Measured by Pikar." with no date and no confirm prompt — it now carries the same two affordances the stated branch does, pinned by two `cashView.test.ts` tests. KNOWN CEILING, marked `ponytail:` at the call site: the scorecard store has no provenance columns, so an agent-written SCORECARD figure still reads back as user-stated — `applyScorecardAnswer` adds the dot-path to `userProvided` unconditionally. Only reachable once the applier is pointed at a scorecard field; the upgrade path is a per-dot-path provenance map on `evaluations` beside `userProvidedAt`.)
>
> Last verified: 2026-08-10 (Task 6 REVIEW FIX, live-finance-inputs — owner ruling on the finding directly below: the worst-case test's length assertion was tautological (the function's own `line.length <= FINANCE_SPINE_BUDGET ? line : truncate(...)` return guarantees the check passes at ANY budget value, so it could never have caught an overflow), and truncation silently drops trailing `CASH_INPUTS` fields (`mrr`, `receivables`, `payables` at 320) which the agent then misreads as "never collected" and re-asks the owner for. Ruled a PLAN defect, not an implementation one — the brief mandated both the 320 constant and the truncating expression verbatim. Fix: `FINANCE_SPINE_BUDGET` raised to **437**, the measured true worst case (all 11 `CASH_INPUTS` fields, longest renderable value `999999999`, longest age `9999d`, all stale) — its doc comment now says it must be re-measured whenever `CASH_INPUTS` gains a member. The worst-case test gained a second assertion, `expect(line).not.toContain("…")`, so a line that silently truncated now fails the test instead of merely satisfying a length check that would have passed regardless — confirmed by temporarily lowering the budget back to 320 and observing the new assertion fail, then restoring it. Truncation itself STAYS as a last-resort guard for a future field addition that overflows before anyone re-measures — it just can no longer hide behind an assertion that could never catch it firing.)
>
> Prior: 2026-08-10 (Task 6, live-finance-inputs — the always-on spine finance line, `packages/core/src/cashSpine.ts`'s `financeSpineLine(inputs, nowMs)`/`FINANCE_SPINE_BUDGET`, ~~consumed by Task 7 and the existing spine assembler~~ **— FALSE when written and CORRECTED by the whole-branch review entry at the top of this file: it had ZERO callers outside its own test until `blueprint.ts`'s `spineForTenant` was wired to it. Task 7 built `readFinance`, which never touches this function.** Carries STATE only (value, age in days, STALE flag, or a bare `field ?` for a missing input) — never analysis; derived metrics stay behind the on-demand `readFinance` tool. The worst case (all 11 `CASH_INPUTS` collected, longest values, all stale) measures 437 raw characters before the function's own truncate-with-ellipsis clamp; the clamp holds the returned line at the 320-char budget by construction, so the budget was not raised, and the assertion checking it is TAUTOLOGICAL — the function's own truncate branch guarantees `length <= budget` for ANY budget value, so the test could not have failed regardless. **SUPERSEDED by the review-fix entry above: the owner ruled this a plan defect (the brief mandated both the 320 value and the truncating expression verbatim) and ordered the budget raised to the true 437 measured worst case, with a second assertion that the worst-case line is never actually truncated (`not.toContain("…")`) — kept for history, do not treat as current.**)
>
> Last verified: 2026-08-10 (Task 2, live-finance-inputs — `CashInputState` gains stored `origin`/`actor`/`basis`; `statedFigure` returns `input.origin` instead of hardcoding `"stated"`. Origin was previously DEDUCED from membership of the evaluation row's `userProvided` list, so a vault-grounded fill rendered identically to a figure the owner typed — that leak is closed at the pure layer. Task 3 populates these fields at the Convex read boundary.)
>
> Last verified: 2026-08-10 (Task 1, live-finance-inputs — `financeClaim.ts` lands the `FigureClaim` shape, `validateFigureClaim` and `isNewerThan`, reusing `cash.ts`'s value bounds.)
>
> Previously verified: 2026-08-09 (Plan 19-10 — **`apps/web/e2e/pipeline.spec.ts` HAS NOW ACTUALLY RUN:
> 2/2 PASSED in 12.3s** against a live `convex dev` and a PRODUCTION build on `:3111`. It was
> authored in 19-07 and had never executed; 26-05 and 26-10 both stopped in `auth.setup.ts` for want
> of credentials. **Two things that were believed about running these specs turn out to be false.**
> (1) *"An executor cannot mint `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`"* — not for a LOCAL deployment:
> `convex/auth.ts` runs the Convex Auth `Password` provider and `/signup` is a real form, so a
> throwaway user is one scripted signup away, and a fresh signup is ALSO how you get the empty
> tenant a first-run spec needs without building a reset seam. (2) The resume command every header
> in this repo quotes — `pnpm --filter @pikar/web test:e2e -- <file>` — **does not filter.** The
> `--` is swallowed and the WHOLE e2e suite runs: ~8 minutes, 25 failed / 4 passed, almost all of
> them tenant-precondition failures with nothing to do with the file you asked for. Run
> `npx playwright test <file>` from `apps/web`. **The spec's own first run also found a bug in
> itself** — `(await locator.count()) > 0 ? a : b` does not auto-wait, so straight after a `goto`
> it committed to the branch that structurally could not render on the empty tenant it had just
> asserted, and hung 30s. `locator.or()` is the native fix. **Neither finding was a product
> defect**; the page behaved correctly throughout. SCOPE: the e2e spec and this note only.)
>
> Previously verified: 2026-08-09 (Plan 19-07 — the Phase-19 **Pipeline route exists and is connected**.)
> SCOPE: a new `apps/web/app/(app)/dashboard/pipeline/` route only; no existing page, query,
> pagination or empty state changed. It is URL-reachable with the nav item still `soon: true`
> (26-18 owns the href — see `contacts-crm.md` invariant 15), its browser spec
> `e2e/pipeline.spec.ts` is **AUTHORED AND NOT YET RUN**, and it adds no opportunity, stage or
> monetary value — the blast-radius line below about Phase 19 is now describing shipped code.
>
> Previously verified: 2026-08-09 (Plan 19-06 — the Approvals page learned a FIFTH plan kind, `crm_write`.)
> SCOPE: `approvals.ts` `planKind` + `ApprovalsView.tsx`'s badge/title/action-label trio; no page,
> query, pagination or empty state changed. **This surface is dragged in by a COMPILE error and that
> is deliberate:** `planKind`'s return union is the Approvals page's own enum (`media` splits into
> `reel`/`image`), and `PlanKind` is derived from it, so widening `plans.kind` breaks
> `ApprovalKindBadge`'s `Record<PlanKind, string>` before anything ships. `titleFor` reads the staged
> operation COUNT ("3 changes to your records") rather than an email subject, and `actionLabel`
> returns "Approve & save to records" — every label here must name what Approve DOES, or the page
> promises an email the `inline` arm structurally cannot produce. `crm_write` is deliberately NOT
> given the "Schedule…" button (`item.kind === "email"` gates it) and falls to the generic "Edit in
> cockpit" link. Pinned in `approvalsView.test.ts`'s two `test.each` tables.
> **When a new `ACTION_TYPES` member lands, the badge map, `titleFor` and `actionLabel` all need an
> entry in the same commit — see `cockpit.md`'s registration checklist.**
>
> Previously verified: 2026-08-09 (Plan 19-05 — the Approvals refusal map gained the two CAN-SPAM stops.)
> SCOPE: `ApprovalsView.tsx` only; no page, query, pagination or empty state changed.
> `refusalMessage` now has real copy for `no_postal_address` and `all_recipients_suppressed` — this
> page is the SECOND approve surface (the cockpit plan card is the other), and without an entry the
> fallback prints the raw enum at the user. A new `withheldSuffix` appends the partial-send report
> to whichever success sentence already shows, because a suppressed recipient is a footnote on an
> outcome that happened, not a second outcome. Both are pinned in `approvalsView.test.ts`, including
> the negative assertion that the raw enum never reaches the screen. **When a new `executePlan`
> refusal reason lands, this map needs an entry in the same commit.**
>
> Last verified: 2026-08-10 (post-merge doc pass — recorded the `.take(200)` read cost `latestScorecardRow`
> incurred as B1's fix, ~800 document reads per Business-tab load, with the 4x call multiplier named
> as the cheapest thing to remove and a warning not to just lower the bound. See "Known gaps & deferred
> work". No code changed.)
>
> Prior: 2026-08-09 (Whole-branch review fix wave, AFTER Task 10 — the 10-task plan's own
> per-task reviews all passed, but a whole-branch review found FOUR blocking defects a task-scoped
> review structurally could not see, plus a statically-RED pre-existing e2e spec. Fixed all five:
> **B1** — `evaluations.latestScorecardRow` (`by_tenant`, `.first()`) could select the tenant's newest
> row EVEN WHEN it carried no usable Growth-OS Scorecard: a `voiceDoc.ts` document-review row's
> LITERAL `scorecard: {}`, or a brand-new conversation thread's carrier before `runEvaluation` ever
> filled one in. `cash.ts`'s `scorecard.financials.ltgp` access on `{}` threw
> (`Cannot read properties of undefined (reading 'ltgp')`), and since `CashTab` is always mounted,
> the crash took down the WHOLE Finance page (both tabs) via the one shared error boundary — see the
> isolation bullet below, also fixed this wave. Three-layer fix: (1) `latestScorecardRow` now skips
> `framework === "document-review"` rows and any row whose `scorecard.financials` is absent — see the
> "Cash — the Business tab, assembled" section's isolation bullet, corrected below. (2) every
> `scorecard.financials.*` read in `unitEconomics` (`packages/core/src/cash.ts`) is now optional-
> chained — see the "Cash — unit economics" section below. (3) `evaluations.ts`'s `setPath` now
> CREATES intermediate objects instead of throwing on a missing one — chosen over the alternative
> (making `cash.ts`'s `saveInput` guarantee a well-formed carrier first) because `setPath` has other
> callers (`runEvaluation`'s `fillVault`) that would need the same guard repeated at each site;
> fixing the shared function once is the CLAUDE.md §8 root-cause fix. **B2** — `CashView.tsx`'s
> headline caption was keyed on `funding === "bootstrapped"` ALONE, so an SME/enterprise (whose
> ACTUAL headline, `metricSetFor` clause 2, is `workingCapital`) still read the CFA-framed sentence
> "whether each customer pays for itself matters most right now" — the FIFTH document on this plan to
> certify something the code did not do, and the first to render to a user. `headlineReason` now
> takes the same `metric` `metricSetFor` already computed, so the two cannot drift again — see the
> "Cash — the Business tab, assembled" section's `HeadlineCard` bullet, corrected below. **B3** —
> `solvency()`'s `netBurn` read an UNANSWERED `mrr` as a real zero, so a funded startup with real MRR
> they had not entered saw net burn equal to the full operating cost and a runway shorter than the
> truth, under a headline captioned "the date it runs out matters most right now" — violating the
> module's own suppression contract (`requireInputs`: a derived figure is suppressed while any input
> it rests on is unknown). `mrr` is now REQUIRED alongside `monthlyOperatingCost` whenever
> `recurringApplies`; a solopreneur (`mrr` is `not-applicable`, never unknown, for them) is
> unaffected — see the "Cash — solvency" section below, corrected. **B4** — `CASH_INPUTS` asks
> startup/sme/enterprise for "Referral share", promising it "unlocks the 25% referral gate", and
> `unitEconomics.referralPct`/`REFERRAL_GATE_PCT` already computed and named that gate, but
> `ActivitySection` never rendered `TIER_SETS`' `activity` row at all — breaking the module's own "an
> input with no payoff should not be asked for" rule. `ActivitySection` now takes an optional
> `referralPct` figure and renders it against the 25% gate when the tenant's tier carries it. **B5**
> — `apps/web/e2e/finance.spec.ts`'s one "connected cost console" test was statically RED against
> HEAD: it asserted the pre-Task-1 heading ("Know what it costs" — the shipped one is "Your money,
> and what Pikar costs"), asserted the Finance nav link had count 0 (it is live), and asserted
> Pikar-spend content visible while the page opens on Business with that tab `hidden`. Also found and
> fixed past what the review named: its non-owner "Deployment controls" assertions targeted markup
> that `FinanceTabs.tsx` does not MOUNT at all for a non-owner (not merely hide) — rewritten to assert
> the Operator tab's absence and that no ceiling value leaks into the raw HTML, the same boundary the
> old assertions meant to prove. Fixed by clicking through to the Pikar-spend tab ONCE (persisted via
> `?tab=` through every `page.reload()` in the test) and to Operator after the owner promotion.
> **STILL NOT EXECUTED** — no Convex deployment, no built Next app in this worktree; verified
> statically only, same as Task 10. **Cleanup, same wave:** `ConnectedNumbers` migrated from
> `api.tenantProfile.get` to `api.cash.shape` (one reader per fact) and now gates its loading state on
> BOTH `cash.inputs` and `cash.shape` (an SME used to flash the 6-row solopreneur panel before the
> real tier arrived); the `needs` copy across `cash.ts` unified to sentence case with a trailing
> period (it mixed "Needs your X." with "needs your gross margin"); core's `usd()` provenance
> formatter now matches `CashView.tsx`'s `formatUsdAmount` at `maximumFractionDigits: 0` (a CAC of
> 1234.56 used to show "$1,235" above "from $1,234.56 to acquire" — two numbers for one figure); the
> two tabs now render behind SEPARATE `FinanceView` error boundaries (`FinanceTabs.tsx`) instead of
> one shared one, so a thrown query error degrades one tab, not the whole page — see the isolation
> bullet below. `metricSetFor`'s dead `else set.activity` branch (cash.ts, the orphan-headline guard)
> was NOT removed: B4 does not change its reachability — `metricSetFor`'s headline is only ever
> `cfa`/`runway`/`workingCapital`, never an activity-only key, both before and after this wave — it
> stays as already-documented defensive completion of a three-way routing (Task 9's deferred note,
> restated in "Known gaps & deferred work" below).
> `pnpm --filter @pikar/core test cash` 69/69, `pnpm --filter @pikar/backend test cash` 21/21,
> `pnpm --filter @pikar/backend test evaluations` 29/29, `pnpm --filter @pikar/web test cashView`
> 27/27, `pnpm typecheck` 10/10 packages green.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 10 — FINAL task of the plan. Added
> `finance.spec.ts` browser coverage for the three-tab shell (Business default-selected, no Operator
> tab for a non-owner, the Cost console intact behind Pikar spend, a panel entry landing as a rendered
> business figure, and — placed AFTER the existing `owner:bootstrapOwner` step, because that grant has
> no inverse — an owner-only Operator tab whose deployment controls do not leak onto the tenant's own
> tabs). `playwright.config.ts` sets `fullyParallel: true`, which gives NO ordering guarantee across
> tests in one file by itself; `test.describe.configure({ mode: "serial" })` was added to
> `finance.spec.ts` so the non-owner-first / owner-last order is actually enforced, not just written
> in file order. Added the two source-scan guards to `cash.test.ts` — see the "Cash — the two
> source-scan guards" section below. **`pnpm --filter @pikar/web test:e2e` was attempted and does NOT
> run**: no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` and no running local `convex dev`/Next stack in this
> worktree (verified: both `127.0.0.1:3111` and `127.0.0.1:3210` unreachable). `auth.setup.ts` throws
> before a single feature test executes — 1 failed (setup), 31 did not run. This is recorded as
> **NOT EXECUTED**, not as a passing or failing browser gate; see the "Evidence status" entry further
> down, which this task does not change beyond the count of authored/unexecuted assertions. The six
> guarantees this task's playbook pass was asked to re-confirm are already the CURRENT, checked-in
> state and are cross-referenced rather than restated: the three-tab structure (the "Finance becomes a
> three-tab shell" section below), the four-state `CashFigure` contract and why `not-computable` is
> not `unknown` (the "Cash — business finance" section above), the storage split and the one-writer
> rule (the "Cash — the collection surface and `financeInputs`" section above), the capital-posture
> headline rule's TWO clauses (the "Cash — which metrics a tenant sees" section above), the 90-day
> staleness rule resting on `evaluations.userProvidedAt` carried forward verbatim (the "Cash — the
> suppression rule" section above), and the industry-CAC switch defaulting OFF (the "Cash — unit
> economics" section above).)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 9 REVIEW FIX ROUND 2 — the
> self-review follow-up below was itself corrected by a second reviewer pass. FOUR fixes: (1) the
> "no orphan headline" guard in `metricSetFor` (`packages/core/src/cash.ts`) always prepended an
> orphaned headline to `solvency` and claimed in comment that solvency is "the row every headline
> candidate here belongs to" — false, `cfa` is a `CashUnitEconomics` key, and the guard now routes to
> whichever row's TYPE actually owns the key via two compile-bound `Record<keyof T, true>` maps next
> to it, so a bootstrapped startup's unit-economics row now actually shows CFA rather than only the
> headline card. (2) `SolvencySection` had zero test coverage — the exact reason the routing defect
> was found by hand instead of by a red test; `cashView.test.ts` gained 4 tests. (3) failure isolation
> was asserted in prose only — `cashView.test.ts` gained a pure-component test, and the claim itself
> was corrected: isolated means each section's `useQuery` returning `undefined`/empty independently,
> NOT a thrown exception, which still escapes to `FinanceView.tsx`'s one shared error boundary. (4)
> minor — `cash.shape`'s read-only test's `toMatchObject` cannot catch a `revenueStage` leak; added
> an explicit key-set assertion, verified it actually fails on a reintroduced leak. See the "Cash —
> the Business tab, assembled" and Task 8's "No orphan headline" entries below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 9 SELF-REVIEW FOLLOW-UP — a
> `ponytail:` comment records a known, harmless edge case: `metricSetFor`'s "no orphan headline" rule
> can list a unit-economics key, `cfa`, inside `SolvencySection`'s own `set` for a bootstrapped
> `startup`; `cash.solvency`'s `CashSolvency` return has no `cfa` field, so that tile is silently
> skipped there — `HeadlineCard` already renders it from `economics`, so nothing is lost. Fixing the
> row duplication would require `ConnectedSolvency` to also read `cash.unitEconomics`, which would
> let a scorecard failure take Solvency down with it — the failure-isolation requirement outranks
> this row-completeness nicety. **SUPERSEDED by the entry above: the premise here (always prepend to
> `solvency`) was itself the defect; kept for history, do not treat as current.**)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 9 — the Business tab is ASSEMBLED.
> `cash.shape`/`cash.solvency` adapters land, and `CashView.tsx` composes `HeadlineCard` →
> `UnitEconomicsSection` → `SolvencySection` → `ActivitySection` → `NumbersPanel`, with
> `ShapeMissingNotice` above the headline for a tenant with no `tenantProfiles` row. See the "Cash —
> the Business tab, assembled" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 8 REVIEW FIX — the headline-selection
> rule's prose overstated itself as "one rule, no exceptions" when the code has TWO clauses: posture
> decides whether a survival or unit-economics metric leads, and a SECOND, tier-driven clause then
> overrides a bootstrapped `sme`/`enterprise`'s `cfa` answer with `workingCapital`. Code was already
> correct (confirmed against the design spec's own SME headline and against `deriveTier`, which only
> ever produces `sme` for a bootstrapped business); only the comment and this entry were wrong. Fixed
> by rewriting `metricSetFor`'s JSDoc to state both clauses and all 16 tier×funding cells explicitly,
> and noting clause 2 is near-vacuous for `sme` (bootstrapped by construction) but earns its keep on
> `enterprise`, which is operator-granted and can carry any funding. See the "Cash — which metrics a
> tenant sees" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 8 — `metricSetFor(tier, funding)` adds
> `CashMetricKey`/`CashMetricSet`: which metrics a tenant sees, and which one leads. `TIER_SETS` is a
> `satisfies Record<Tier, …>` table (the `TIER_REASON` precedent), never a switch, so an added tier
> without an entry is a compile error. A no-orphan-headline check prepends the headline into
> `solvency` when the tier's own rows don't already carry it (fires for a bootstrapped `startup`
> leading with `cfa`).)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 7 REVIEW FIX — `revenueStage` deleted
> from `solvency()`'s signature. It was threaded through as `Tier`'s natural pairing but never
> consulted by a single conditional; the reviewer traced it forward and found wiring it would have
> been WRONG anyway — inferring a pre-revenue startup's MRR as `not-applicable` from its stage is
> exactly the "inferred from absent data" move `CashFigure`'s four states forbid. An unanswered MRR
> question is `unknown` regardless of stage; only TIER is a structural fact about whether the concept
> applies at all. Also: `recurringApplies`/`workingCapitalApplies` no longer restate `CASH_INPUTS`'s
> own `tiers` lists as hand-rolled tier comparisons (`tier !== "solopreneur"`, `tier === "sme" ||
> "enterprise"`) — both now derive from `cashInputsForTier(tier)`, the one function already reading
> that catalogue, so an edit to a spec's `tiers` list cannot silently leave these two booleans on the
> old answer. See the "Cash — solvency" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 7 — `solvency()` adds the finance-ops
> layer: `runway`, `netBurn`, `mrr`, `arr`, `workingCapital`, DELIBERATELY OUTSIDE the Hormozi
> framework and marked as such in the module comment — none of those five words appears anywhere in
> the three source books. `not-applicable` is decided by TIER alone, never inferred from an
> absent value — a solopreneur's stated MRR (if any legacy row somehow has one) never leaks through
> as a real figure. See the "Cash — solvency" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 6 — `unitEconomics` wired to the
> Business tab. `convex/cash.ts`'s `inputs` query body was extracted into one shared
> `inputStatesFor(ctx, tenantId, nowMs)`; the new `unitEconomics` tenantQuery calls the SAME
> function rather than re-reading `financeInputs`/the scorecard a second way, so the panel and the
> metrics can never disagree about what the tenant has entered. `FigureTile` is the one renderer
> for every `CashFigure` on the tab — four branches, one per truth, each with its own test that
> fails if two states collapse. See the "Cash — FigureTile and the connected page" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 5 REVIEW FIX — `referralPct` now
> routes through `statedFigure`/`needsConfirmation` like every other stated cash input, instead of
> reading the scorecard directly with no staleness check. `nowMs` was destructured out of
> `unitEconomics`'s args and never read — the tell that a "staleness-aware" figure was not stale-
> checked at all. This is the third instance of the same failure class in this plan (Task 3: version
> reset via carry-forward; Task 4: `isStale` returning `false` for unknown age; Task 5: the check
> skipped entirely) — each fails OPEN, with no visible symptom, which is why each needed a test that
> constructs the stale case, not just a fix. See the "Cash — unit economics" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 5 — `unitEconomics()` composes CFA,
> LTGP:CAC with its sample size, CAC payback and the industry-CAC switch from Task 4's suppression
> rule and `growth/financialSpine.ts`'s guarded arithmetic — no arithmetic reimplemented.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 4 REVIEW FIX — staleness collapsed to
> ONE predicate, `needsConfirmation(value, statedAt, nowMs)`; the two-argument `isStale` is deleted.
> `statedFigure` had re-derived staleness on its own and reached `stale: false` for an unknown-age
> value, disagreeing with `convex/cash.ts`'s already-correct adapter logic. See the "Cash — the
> suppression rule" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 4 — `statedFigure`/`requireInputs`/`valueOf`
> resolve the four truths, provenance and the suppression rule ONCE, in `cash.ts`.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 3 REVIEW FIX — scorecard-field staleness now
> reads `evaluations.userProvidedAt`, never the row's `createdAt`. See the Cash section's staleness
> bullet below and `docs/playbooks/business-evaluation.md` for the write side.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 2 fix — `last7Count` moved into `activityFromSends`, out of the view)
> Build history: `.planning/phases/26-pending-product-pages-and-vault-redesign-integration/` · Related ADRs: [ADR-001](../decisions/001-convex-data-orchestration-plane.md)

## Purpose

This playbook protects the Approvals, Finance, Content, Reports, Phase-19 Pipeline integration and
Command Center v2 surfaces. These pages are projections over existing governed rails, not a second
data plane: each page must preserve tenant isolation, bounded reads, honest uncertainty and the
original action's approval boundary. A page can be rolled back independently without removing its
additive data, safety instrumentation or provenance.

## Key files

### Pure contracts

- `packages/core/src/dashboard.ts` — `resolveDashboardWindow`, `DashboardMoney`, bounded-result,
  stable-order/cursor and code-owned page-state contracts shared before JSX formatting.
- `packages/core/src/spend.ts` — closed rail/phase vocabulary, movement validation at the trust
  boundary, and window aggregation that returns Unknown rather than a fabricated zero.

### Backend page adapters

- `packages/backend/convex/approvals.ts` — bounded plan/decision projections.
- `packages/backend/convex/spendLedger.ts` — append-only reporting movements and coverage start.
- `packages/backend/convex/finance.ts` — tenant and owner finance projections.
- `packages/backend/convex/content.ts` — bounded artifact union and governed artifact actions.
- `packages/backend/convex/reportsBusiness.ts` — comparable business/operations period projections.
- `packages/backend/convex/reportsGovernance.ts` — sanitized audit and owner-only governance views.
- `packages/backend/convex/reportPack.ts` — one-snapshot board-pack generation.
- `packages/backend/convex/home.ts` — narrow source-summary composition for Command Center.

Every module has a colocated `.test.ts`; `dashboardSchema.test.ts` protects the additive schema and
index foundation. Existing action terminals remain owned by their subsystem playbooks.

### Cash — business finance

`packages/core/src/cash.ts` / `packages/backend/convex/cash.ts` are the Business tab's own pure/
adapter split, mirroring the Cost console's `spend.ts`/`finance.ts` pair so one mental model serves
both halves of the page:

- **`cash.ts` (pure) owns the `CashFigure` vocabulary and the activity derivation.** Every business
  figure is exactly one of FOUR states, never collapsed into three: `unknown` (never asked/answered,
  names the missing input), `not-applicable` (the metric does not exist for this business — decided
  by tier/stage, NEVER inferred from absent data, so a project-based consultant is never shown a
  fabricated "$0 MRR"), `not-computable` (inputs are present but make the arithmetic undefined, e.g.
  CAC = 0 — deliberately not folded into `unknown`, because "needs your CAC" is a lie to someone who
  told us it was zero), and `known` (a real number, including a real measured zero). `activityFromSends`
  buckets delivered sends into UTC days and derives `todayCount`, `streakDays` and `last7Count`; the
  streak ENDS TODAY by definition — a streak that keeps counting yesterday's run for someone who has
  not sent today is the flattering lie the row exists to avoid. **`last7Count` (today plus the six
  preceding UTC days) is computed HERE, in the pure module, never in `CashView.tsx`.** A Task-2
  review caught the first version summing `perDay.slice(0, 7)` inside `ActivitySection` itself —
  domain arithmetic, not formatting, breaching CLAUDE.md §1's "the view renders, it never derives."
  The view now reads `activity.last7Count` as a plain field.
- **`convex/cash.ts` (adapter) is a reader only.** `activity` is a `tenantQuery` that scans `requests`
  rows in status `sent` through `by_tenant_status_createdAt`, bounded at 1000 rows with
  `bound.partial` + `partialReason: "row-cap"` when the cap is hit — the same `readWindow` honesty
  contract `finance.ts` uses, so a capped count reads as a floor, never the truth.
- **The activity row is free.** Pikar already delivers the emails, so a `sent` request row IS the
  reach-out count — the row needs no data entry and is the first thing rendered on the Business tab.
  "Posts per day" has no data source yet (Pikar delivers email, not social posts) and renders an
  explicit "not tracked yet", never a fabricated `0`.
- **`ActivitySection` now renders the tier's referral figure, against the 25% gate (whole-branch
  review B4 fix).** `CASH_INPUTS` asks startup/sme/enterprise for "Referral share", promising
  `unlocks: "the 25% referral gate"`, and `unitEconomics.referralPct`/`REFERRAL_GATE_PCT` already
  computed and named that gate — but `TIER_SETS` put the key in `activity` and nothing read `set.
  activity` at all, breaking the module's own "an input with no payoff should not be asked for" rule
  (`cash.ts:118`). `ActivitySection` now takes an optional `referralPct: CashFigure` prop and renders
  it as a `FigureTile` alongside the three measured tiles when present; `ConnectedActivity`
  (`CashView.tsx`) supplies it by also reading `cash.shape` + `cash.unitEconomics` (both already
  subscribed elsewhere on the tab — the `RailsSection`/`TrackedSection` precedent) and checking
  `metricSetFor(tier, funding).activity.includes("referralPct")`, so a solopreneur (whose tier's
  `activity` set has no `referralPct`) sees no extra tile. The measured counts (today/streak/posts)
  do not wait on the two extra queries — they render as soon as `cash.activity` resolves; the
  referral tile joins once its own reads do.

### Cash — the collection surface and `financeInputs` (Task 3)

**The storage split, and why it is not a duplication.** Two stores hold the Business tab's numbers,
split by WHICH kind of figure they are, never by which screen wrote them:

- **The scorecard (`evaluations.scorecard`, `packages/core/src/growth/scorecard.ts`) stays the
  source of truth for every Hormozi input** — `financials.cac`, `financials.ltgp`,
  `financials.thirtyDayCashPerCustomer`, `financials.grossMarginPct`, `financials.churnByCadence`,
  and the four leaves Task 3 added (`financials.grossProfitPerPurchase`,
  `financials.purchasesPerLifetime`, `financials.customerCount`, `leadCard.referralPct` — see
  `docs/playbooks/growth-diagnostic.md`).
- **The new `financeInputs` table (`packages/backend/convex/schema.ts`) holds the five finance-ops
  inputs ONLY**: `cashOnHand`, `monthlyOperatingCost`, `mrr`, `receivables`, `payables`. One row per
  `(tenantId, field)`, read through `by_tenant`/`by_tenant_field`. **CAC is never copied into this
  table.** Duplicating it into a second store is what produced two separate selector bugs on
  2026-08-09 — the whole reason this split is a rule and not a convenience.
- **`packages/core/src/cash.ts`'s `CASH_INPUTS: readonly CashInputSpec[]`** is the single catalogue
  both stores are read through: eleven entries, each naming its `field`, which `store` owns its
  VALUE (`"financeInputs" | "scorecard"`), the Scorecard dot-`path` for the scorecard ones, its
  `unit`, and `unlocks` — what answering it buys the user, asserted non-empty so a field with no
  payoff can never be asked for. `cashInputsForTier(tier)` filters it to what a tier is actually
  asked; `validateCashInput(field, value)` is the trust-boundary check (money ≥ 0/finite, a percent
  ≤ 100, a count a whole number, and `purchasesPerLifetime < 1` REJECTED rather than silently
  multiplied into a plausible-looking wrong LTGP). `STALE_AFTER_MS` (90 days) + `needsConfirmation`
  (Task 4 — see the "Cash — the suppression rule" section below) are the confirm-or-update
  threshold.
  **Staleness reads a per-FIELD stated time, never the evaluation row's `createdAt` (review fix).**
  A finance-ops field's `statedAt` is its own `financeInputs` row's `statedAt`, always present
  alongside a value. A scorecard field's `statedAt` is read from `evaluations.userProvidedAt[path]`
  — a dot-path → epoch-ms map stamped by `applyScorecardAnswer` on every answer and carried forward
  UNCHANGED by `runEvaluation` (see `docs/playbooks/business-evaluation.md`). **The row's own
  `createdAt` was tried first and was wrong**: `runEvaluation` re-runs weekly on one pinned thread
  and persists a fresh row every time, stamping a NEW `createdAt` while copying `scorecard`/
  `userProvided` verbatim — so a CAC answered 91 days ago, merely carried into this week's row, read
  back as "confirmed today" and silently suppressed the exact 90-day prompt the rule exists for. A
  legacy value with no `userProvidedAt` entry (every scorecard-stored figure written before this fix)
  has UNKNOWN age; `cash.ts` treats that as needing confirmation — `stale: true`, `statedAt: null` —
  never as fresh, and never fabricates a date. `CashView.tsx`'s `InputRow` renders this case as "No
  confirmation date on file. Still right? Confirm or update it." rather than formatting a null date.
- **One mutation, `convex/cash.ts`'s `saveInput`, routes by field to the store that owns it — there
  is exactly one writer per number.** A finance-ops field patches/inserts its `financeInputs` row. A
  scorecard field calls `applyScorecardAnswer` (`convex/evaluations.ts`, exported in this task) —
  the SAME function `recordScorecardAnswer` (the cockpit path) and `approvals.answerDecision` (the
  Approvals path) call, so a number entered in the panel, spoken to the cockpit, or answered in
  Approvals lands in the same place and carries forward the same way. No evaluation row yet → seeded
  under the stable thread id `"finance-panel"` so the answer survives into the tenant's first real
  evaluation. `cash.ts`'s `inputs` query reads both stores back through the one `CASH_INPUTS`
  catalogue and returns `CashInputState[]` (`field`, `value`, `statedAt`, `stale`) — nothing is
  logged (CLAUDE.md §4); if an audit event is ever added here it carries the field NAME and a
  boolean, never the value.
- **Approvals' `QUESTION_CATALOG` gained the same three new numeric entries** (`financials.
  grossProfitPerPurchase`, `financials.purchasesPerLifetime`, `financials.customerCount`) so a
  tenant who answers in Approvals and a tenant who answers in the panel fill the same set — a
  catalogue entry that only one surface could see is how a field ships unwritable. Its numeric
  bounds check now routes through `validateCashInput` for every field the two surfaces share (via a
  path→`CashInputField` lookup built off `CASH_INPUTS` itself), so `purchasesPerLifetime: 0.5` is
  refused in Approvals with the SAME reason and the same words as in the panel. `financials.ltgp`
  keeps its own finite/non-negative check — it is never a cash input (see the growth-diagnostic
  playbook's precedence note) and carries no `CashInputField`. `leadCard.referralPct` is
  deliberately NOT in the catalogue: `hasFinancialQuestion` gates it on a `financials`-section
  `notEnoughData` entry, and a lead metric behind a financial gate would be a category error — it
  stays a panel-and-cockpit-only input.
- **`CashView.tsx`'s `NumbersPanel`** renders `cashInputsForTier(tier)` INTERSECTED with the
  `inputs` prop — the tier decides which fields are asked at all, and a field with no matching entry
  in `inputs` is skipped rather than invented. Each row is a real `<label htmlFor>` + `<input id>`
  pair, a Save button with an explicit `aria-label`, and a provenance line: `Unlocks <what>` when
  never answered (never a fabricated `$0`), `Last confirmed <date>` otherwise, with a
  confirm-or-update prompt appended once stale. **The stale prompt uses `--ink-soft` and the
  explicit word "confirm"** — BRAND §2/CLAUDE.md §10 reserve amber (`--held`) for the approval gate
  only. Validated on change with the same `validateCashInput` the mutation enforces (Save disables
  on an invalid draft, the reason renders in a `role="alert"`) — this is convenience, not the trust
  boundary, which stays server-side. `ConnectedNumbers` reads `api.cash.inputs` + `api.cash.shape`
  (for `tier`, defaulting to `"solopreneur"` via the shared `fallbackTier` helper while loading/
  absent) and wires `api.cash.saveInput` through the same busy/refusal `run`-style pattern as
  `OperatorTab` in `FinanceView.tsx`. **`api.cash.shape`, not `api.tenantProfile.get` (whole-branch
  review cleanup).** The first version read `api.tenantProfile.get` — a second reader of the same
  tier fact every sibling `Connected*` on this tab already reads through `cash.shape`, the query
  built for exactly this; two readers for one fact is how they drift. Also gated on BOTH `cash.
  inputs` AND `cash.shape` resolving before rendering — an un-gated `shapeResult` used to let this
  panel render `fallbackTier`'s solopreneur default (6 rows) for a beat before the real tier (e.g.
  an SME's 9 rows) arrived.
  No arithmetic lives in this component beyond formatting (CLAUDE.md §1) — a `.reduce()` in a
  component already failed review once on this plan.

### Cash — the suppression rule (Task 4)

**Every later task (5, 6, 7, 9) routes derived figures through these four functions instead of
reimplementing the unknown-check per metric.**

- **`CashInputs = Partial<Record<CashInputField, CashInputState>>`** and **`toCashInputs(states)`**
  turn the `CashInputState[]` the `inputs` query already returns into the keyed shape the rest of
  this section reads. No new store, no new query — a reshape of what Task 3 produces.
- **`statedFigure(input, spec, nowMs)`** turns ONE stated input into a `CashFigure`. `undefined` or
  `value: null` → `unknown`, naming the field's `label`. **A real `0` is `known`, never `unknown`** —
  measured nothing is an answer, and this is the single most important behaviour in the module: a
  metric that reads "unknown" for a business that genuinely spent $0 on acquisition is lying in the
  opposite direction from a fabricated number. `statedAt: null` (legacy scorecard value, no
  `userProvidedAt` entry — see the Task 3 staleness bullet above) carries through as UNKNOWN age;
  `statedFigure` does not paper over that by inventing a date.
  **`needsConfirmation(value, statedAt, nowMs)` is THE single staleness rule (review fix).** The
  first version of `statedFigure` re-derived staleness from the old two-argument `isStale(statedAt,
  nowMs)` alone, which short-circuits to `false` for `statedAt: null` — so a legacy value with no
  recorded age rendered `stale: false`, "confirmed," and its confirm-or-update prompt never fired.
  `isStale` is DELETED (no other caller needed the raw two-argument form). `needsConfirmation` folds
  in the value: absent (`value === null`) is never stale — that is `unknown`, a different truth
  entirely; a present value with `statedAt: null` (unknown age) or older than `STALE_AFTER_MS` is
  stale. `statedFigure` **and** `convex/cash.ts`'s `inputs` query — both its `financeInputs` branch
  and its scorecard branch — all call this ONE function; none re-derives the rule. Before this fix,
  `cash.ts` and `convex/cash.ts` disagreed (the adapter's scorecard branch already had the correct
  three-way check inline, pinned by its own test since Task 3 — see `convex/cash.test.ts`'s "a
  scorecard value with no recorded stated time... needs confirmation" — while `cash.ts` had the
  simpler, wrong one), which is exactly the two-definitions drift CLAUDE.md §1 exists to prevent.
- **`derived(args)`** wraps an already-computed number as a `known`/`derived` figure with its `from`
  provenance string and optional `sampleSize` — it does no arithmetic itself (that stays in
  `growth/financialSpine.ts`), it only carries the figure vocabulary the view renders.
- **`requireInputs(inputs, fields)` is THE suppression rule, in exactly one place.** Returns the
  blocking `unknown` figure for the FIRST missing field, or `null` once every field in the list is
  present. **The first, not all of them** — a metric that answers a missing-CAC prompt with a
  three-item checklist gets ignored; naming one input is one ask. A caller computing a derived metric
  (CFA, LTGP:CAC, runway, …) calls `requireInputs` first and renders its result verbatim instead of
  the computed figure when it is non-null.
- **`valueOf(inputs, field)`** reads a present input's plain number, for use only after
  `requireInputs` has returned `null` for a field list containing `field`. It throws if the field is
  still absent — a programming-error tripwire, never a runtime path reachable from user input, and
  deliberately NOT softened to `?? 0`: that would fabricate a figure and defeat the suppression rule
  above it.

### Cash — unit economics (Task 5)

`unitEconomics(args: { inputs: CashInputs; scorecard: Scorecard; nowMs: number })` composes the
Hormozi spine as figures a page can render. **The arithmetic is not reimplemented.**
`growth/financialSpine.ts`'s `ltgpCac` and `cfa` — ports of the source scripts, already guarding
every divisor — are called as-is; this function's own job is which of the four truths each result
is in, what it was derived from, and how many customers it rests on.

- **CAC = 0 is intercepted BEFORE calling `cfa`/`ltgpCac`**, on every metric that divides by it
  (`cfa`, `ltgpCac`, `cacPayback`). `financialSpine.ts`'s `cfa` answers `{ratio: 0, achieved:
  false}` for a non-positive denominator — a correct, conservative ROUTING signal — but rendered
  verbatim it reads as "your acquisition does not pay for itself" to someone who told the form
  their CAC was a real, measured zero. `unitEconomics` returns `not-computable` with the reason
  instead, and never emits `Infinity` or falls back to `unknown` (which would ask again for a
  number already given).
- **LTGP has two possible producers and exactly one stored value; the precedence is resolved HERE,
  at read time, never at write time.** `scorecard.financials.ltgp` (Task 3) is never itself
  computed and stored — the two components (`grossProfitPerPurchase` × `purchasesPerLifetime`)
  WIN when both are present, via `ltgpCac`, and the figure's `origin: "derived"` + `from` string
  say so; only when a component is missing does it fall back to the stated total, `origin:
  "stated"`. Storing a computed `ltgp` back onto the scorecard would create a second, driftable
  copy of the same number — the two-store split Task 3 already fought to keep out.
- **A ratio never omits its sample size.** `sampleSize` is `inputs.customerCount?.value ?? null`,
  passed to every ratio's `derived()` call explicitly (including as `null`) so the field is always
  present, never absent-when-unrecorded — `derived()` only omits it when the caller passes
  `undefined`.
- **The industry-CAC comparison is OFF until the user supplies the average, and says why, never a
  pass.** The source material supplies no industry table and instructs researching the average
  yourself; `scorecard.financials.industryAvgCac === null` (or `<= 0`) returns `unknown` naming
  the missing input, never a default "within range" — a business that has never measured its
  market average is not "healthy" by omission. Once supplied, the comparison is against
  `INDUSTRY_MULTIPLE` (financialSpine's `3.0`, the ceiling the source books tell you to stop
  optimising CAC inside). The ratio itself reuses `financialSpine.ts`'s now-`export`ed `round2`
  rather than a second `Math.round(x * 100) / 100` — one rounding definition, not two.
- **CAC payback (months) derives lifetime-months from monthly churn** (`100 / monthlyChurnPct`)
  to spread lifetime gross profit across it — a judgement call the source material's scripts do
  not make explicit (marked `ponytail:` in `cash.ts`, naming the call). Absent or non-positive
  churn is `unknown`, never a guessed lifetime — the honest fallback the whole module is built
  around.
- **`referralPct` carries the same staleness signal every other stated cash input does (REVIEW
  FIX).** `referralPct` IS a `CashInputField` in `CASH_INPUTS` (`store: "scorecard"`, `path:
  "leadCard.referralPct"`) with a real `CashInputState`, so it goes through `statedFigure(inputs.
  referralPct, cashInputSpec("referralPct"), nowMs)` — the exact function every other stated
  figure in this module uses, not a hand-rolled `scorecard.leadCard.referralPct === null ? ... :
  knownFigure(...)` branch. **The first version had exactly that hand-rolled branch, read the
  scorecard directly, and never called `needsConfirmation` or even referenced `nowMs`** — a
  referral share entered a year ago rendered as freshly confirmed, with the function's own
  destructured-but-unused `nowMs` argument as the tell that nothing was checking the clock. This is
  the THIRD instance of the same failure class in this plan: Task 3 (version reset via evaluation
  carry-forward), Task 4 (`isStale` returning `false` for unknown age), Task 5 (the check skipped
  entirely) — each one fails OPEN, with nothing visibly wrong on screen, which is why each needed a
  test that constructs the exact stale case rather than a fix trusted on inspection alone.
  **`grossMargin` and `cohortChurn` deliberately keep reading the scorecard directly** (marked
  `ponytail:` in `cash.ts`) — neither is a `CashInputField`, so neither has a `CashInputState`
  carrying a per-field `statedAt`; routing them through `statedFigure` would require fabricating a
  timestamp, which is worse than no staleness signal. The asymmetry is intentional, not an
  oversight — if staleness on those two is ever wanted, the fix is adding them to `CASH_INPUTS`
  (both already have Scorecard dot-paths), not inventing a date here.
- **Every `scorecard.financials.*` read is optional-chained, defensively (whole-branch review B1
  layer 2).** `scorecard` arrives typed as `Scorecard` but is stored as the DB's `v.any()` column, so
  the type does not guarantee the runtime shape — a `document-review` row (`voiceDoc.ts`) carries a
  LITERAL `scorecard: {}`. The unfixed `scorecard.financials.ltgp !== null` threw
  (`Cannot read properties of undefined (reading 'ltgp')`) on that shape; every read in this function
  (`ltgp`, `costToServicePerCustomer`, `churnByCadence.monthly`, `industryAvgCac`, `grossMarginPct`)
  now reads `scorecard.financials?.<field> ?? null` and reports `unknown` rather than throwing or
  rendering a fabricated `$NaN` (`FigureTile` would have rendered `knownFigure("stated", undefined,
  "usd")`'s `undefined` value as literal "$NaN"). This is layer 2 of the B1 fix — layer 1 is
  `latestScorecardRow` no longer selecting such a row in the first place (see the "Cash — the
  Business tab, assembled" section's isolation bullet); this layer exists because a pure function
  should not throw on a shape the DB can actually hold, regardless of what its caller does.
- **No word "ROAS" anywhere** in this function, its comments, or its rendered strings (CLAUDE.md
  ambient rule for this plan) — absent from all three source books, and the framework's own
  guidance is to stop optimising CAC once inside 3× the industry average, which ROAS as a lever
  contradicts.
- Test evidence: `cash.test.ts`'s `describe("unit economics", ...)` (15 tests) pins every
  degenerate case above — zero-CAC not-computable-never-Infinity, LTGP's two-producer precedence
  both directions, sample size present-as-`null`, the industry switch OFF-with-reason and ON, the
  CFA/payback derivations' `from` provenance strings, `referralPct` stale-past-90-days,
  `referralPct` present-with-unknown-age (no fabricated `statedAt`), `referralPct` absent-is-
  unknown-not-stale, and a minimal known/null pair each for `grossMargin`/`cohortChurn`.
  `pnpm --filter @pikar/core test cash` — 41/41 (26 pre-existing + 10 from the original Task 5 pass
  + 5 from the review fix). `pnpm typecheck` — 10/10 packages green.

### Cash — solvency (Task 7)

`solvency(args: { inputs: CashInputs; tier: Tier; nowMs: number })` adds `runway`, `netBurn`, `mrr`,
`arr`, `workingCapital` as `CashFigure`s. **This layer is deliberately OUTSIDE the Hormozi
framework** — none of those five words appears anywhere in the three source books — and the module
comment says so plainly rather than presenting it as part of the spine. It earns its place as the
survival metric for exactly the population the books exclude: businesses running on outside money,
for whom the constraint is the date the money ends.

- **`not-applicable` is decided by TIER, never inferred from absent data — and NEVER by
  `revenueStage` (REVIEW FIX).** The first version's signature also took `revenueStage: RevenueStage
  | null`, "the natural pairing with `tier`," but no branch ever read it. The reviewer traced it
  forward through the whole plan (it was also threaded into the not-yet-built Task 9 convex query
  and `cash.shape`) and found no conditional anywhere consulted it — and that wiring one would have
  been WRONG, not just unused: making a pre-revenue startup's `mrr` `not-applicable` from its stage
  infers a permanent structural answer from a field that only describes where the business is on the
  revenue curve, exactly the "inferred from absent data" move `CashFigure`'s four states exist to
  forbid. A pre-revenue startup that has not answered the MRR question is `unknown` — "never asked"
  — by this module's own definition, regardless of stage. `revenueStage` is deleted from the
  signature; do not thread it back in on the strength of the design spec's "tier and revenue stage"
  line — that line was never actually implemented and re-adding the parameter without a correct use
  for it is worse than not having it.
  **`recurringApplies`/`workingCapitalApplies` are DERIVED from `CASH_INPUTS` (REVIEW FIX), not
  restated as hand-rolled tier comparisons.** The first version had `tier !== "solopreneur"` and
  `tier === "sme" || tier === "enterprise"` inline — a second, independent copy of exactly what
  `mrr.tiers`/`receivables.tiers`/`payables.tiers` on the catalogue already say, agreeing today only
  by coincidence. Both booleans now come from `cashInputsForTier(tier)` (already exported, already
  the panel's own tier filter), so an edit to a spec's `tiers` list cannot silently leave these two
  booleans on the old answer while the collection panel starts asking (or stops asking) that tier for
  the number. A solopreneur's `mrr` figure is `not-applicable` BEFORE `statedFigure` ever runs — a
  solopreneur with project revenue has no meaningful monthly recurring figure, which is a fact about
  their business, not a gap in their answers. "MRR $0" would describe a failing subscription business
  that does not exist. The three states stay distinct end to end: a startup with `mrr` unanswered is
  `unknown`; a startup whose subscriptions billed nothing is a real measured `known`/`value: 0`; a
  solopreneur is `not-applicable` with no `value` field at all (pinned by a test that greps the
  serialized figure for `"value":0`) — and a dedicated test loops every `Tier` and asserts
  `not-applicable` agrees with `cashInputsForTier` in both directions, for both `mrr` and
  `workingCapital`.
- **Every degenerate case has its own guard, not a shared "looks fine" fallback:**
  - **Monthly cost = 0 → `not-computable`, never infinite runway.** Checked BEFORE the division, so
    `Infinity` can never enter the return value (pinned by a test that stringifies the whole result
    and asserts the literal string `"Infinity"` is absent).
  - **Net burn ≤ 0 (recurring revenue covers cost) → `runway` is `not-applicable`, "not burning" —
    never a month count.** `netBurn` itself is clamped at zero (`Math.max(0, cost - recurring)`): a
    profitable month renders as "not burning," and a raw negative burn number would read as a
    deeper hole than reality, the opposite of what happened.
  - **Cash = 0 with a real burn → `known`, `value: 0`, never negative.** The month count is clamped
    with the same `Math.max(0, …)` pattern `unitEconomics`'s payback figure already uses.
  - **Working capital (`receivables − payables`) is allowed to be negative** — payables exceeding
    receivables is a real, common state, and `knownFigure`/`derived` carry no non-negative guard
    (confirmed by reading both functions: neither clamps or rejects a negative `value`). A test
    pins `receivables: 30_000, payables: 45_000` landing at `value: -15_000`.
- **`netBurn` REQUIRES `mrr` whenever `recurringApplies`, not just `monthlyOperatingCost` (whole-
  branch review B3 fix).** The first version's `requireInputs(inputs, ["monthlyOperatingCost"])` let
  an UNANSWERED `mrr` silently read as `0` recurring (`mrrFigure.state === "known" ? mrrFigure.value
  : 0`), so a funded startup with real MRR they had not entered saw net burn equal to the FULL
  operating cost and a runway shorter than the truth — under a headline captioned "the date it runs
  out matters most right now." This violated the module's own suppression contract stated at the
  top of this file (`requireInputs`: a derived figure is suppressed while any input it rests on is
  unknown, and names the missing one) — `netBurn`/`runway` were the one derived pair in this module
  that did not follow their own rule. Fixed by adding `mrr` to `netBurn`'s required-fields list ONLY
  when `recurringApplies` is true; a tier where MRR does not apply (`!recurringApplies`, i.e. a
  solopreneur) is NOT held to this — their `mrr` is `not-applicable`, never unknown, and requiring it
  would wrongly suppress a runway they are entitled to see. `cash.test.ts` pins both directions: a
  startup/sme/enterprise with `mrr` unanswered now gets `netBurn`/`runway` as `unknown` naming
  "Monthly recurring revenue", and a solopreneur with no `mrr` ever asked still gets a real runway.
  The plan's own pinned test (`tier: "startup"`, no `mrr`, expecting `runway = 6 months`) was WRONG
  by the owner's standing ruling across this plan (correctness governs the plan's literal text,
  precedent from Task 2's `last7Count` and Task 3's `userProvidedAt`) — it now answers `mrr: 0`
  explicitly instead.
- **mrr is the ONE field this function surfaces directly as a figure**, and it is the one field
  that routes through `statedFigure(inputs.mrr, cashInputSpec("mrr"), nowMs)` — the same shared
  staleness function `referralPct` uses in `unitEconomics` above, not a hand-rolled branch.
  `cashOnHand`, `monthlyOperatingCost`, `receivables` and `payables` are never surfaced as their own
  figures in `CashSolvency` — they are only ever CONSUMED through `requireInputs`+`valueOf` on the
  way to a derived figure (`runway`, `netBurn`, `workingCapital`), the identical pattern
  `unitEconomics` already uses for `cac`/`thirtyDayCashPerCustomer`/`grossProfitPerPurchase`/
  `purchasesPerLifetime`; a derived figure's own staleness is a design question `unitEconomics`
  already settled (it does not carry one), not a new one this task reopens. `arr` is `derived` from
  `mrr` (`mrr.value * 12`) and inherits `mrr`'s truth state via `mrrFigure.state !== "known" ?
  mrrFigure : derived(...)` — an `unknown`/`not-applicable`/`not-computable` `mrr` propagates to
  `arr` verbatim rather than `arr` re-deriving its own not-applicable check.
  **This is the fourth call site on this plan for the staleness rule** (Tasks 3, 4 and 5 each
  shipped a safeguard that failed OPEN with no visible symptom); a dedicated test constructs a stale
  `mrr` (`statedAt: NOW - 91 * DAY`) and asserts `stale: true` comes through unchanged, rather than
  trusting that routing through `statedFigure` is enough by inspection alone.
- **No new arithmetic beyond the four guarded formulas above** — `arr` and `workingCapital` are
  spreadsheet-simple, and `runway`/`netBurn` reuse the same `Math.max(0, …)` clamp-and-round-to-one-
  decimal shape `unitEconomics`'s `cacPayback` already established, not a second rounding
  convention.
- Test evidence: `cash.test.ts`'s `describe("solvency — the finance-ops layer", ...)` (15 tests: the
  brief's original 10, the staleness pin, the REVIEW FIX's catalogue-agreement test looping every
  `Tier`, and the whole-branch review B3 fix's two: the suppression case and the solopreneur-still-
  gets-a-runway case) — see the top-of-file "Last verified" entry for the current whole-file total
  (`pnpm --filter @pikar/core test cash` — 69/69). `pnpm typecheck` — 10/10 packages green.

### Cash — which metrics a tenant sees (Task 8)

`metricSetFor(tier: Tier, funding: Funding | null): CashMetricSet` decides which `CashMetricKey`s
render in each of the three rows, and which one is the HEADLINE. **The headline rule has TWO
clauses, not one — an earlier draft of this playbook and the code's own comment claimed "one rule,
no exceptions," and the code disagreed with its own comment (review-caught).** `hasOutsideMoney
(funding)` is `funding === "funded" || funding === "seeking"` — `seeking` reads as outside money for
the same reason `deriveTier` already groups it with `funded` (`businessProfile.ts`): a company
raising watches the date the money ends exactly like a funded one does.

- **Clause 1 — posture decides WHETHER a survival or a unit-economics metric leads.** Outside money
  means the constraint is the date it ends, so `runway` (a survival metric) leads. No outside money
  (`bootstrapped`) means the live question is a unit-economics one, so `cfa` leads.
- **Clause 2 — for a bootstrapped, ESTABLISHED tier (`sme`/`enterprise`), the tier overrides clause
  1's `cfa` with `workingCapital`.** An established business's survival question is the cash
  conversion cycle, not one customer's 30-day payback. This is a genuine second exception layered on
  top of clause 1, not a restatement of it: a bootstrapped `solopreneur`/`startup` still gets `cfa`,
  because they have no `workingCapital` row to prefer it over. All 16 tier×funding cells: bootstrapped
  → `cfa` for `solopreneur`/`startup`, `workingCapital` for `sme`/`enterprise`; `seeking`/`funded` →
  `runway` for every tier; `funding: null` → the tier's own `typicalHeadline` fallback, never a
  blank. Neither clause invents a metric a tier's own set doesn't already carry — clause 2 only
  picks between two rows the tier already has.
- **Clause 2 is near-vacuous for `sme` specifically, and that is expected, not dead code.**
  `deriveTier` (`businessProfile.ts`) only ever derives `sme` when `funding === "bootstrapped"`, so
  an SME tenant is bootstrapped by construction and this branch is "always `workingCapital`" for
  that tier in practice. `enterprise` is the tier where the clause actually varies: it is
  operator-granted (D6) and can carry any funding value, so a bootstrapped enterprise gets
  `workingCapital` while a funded or seeking one falls through to clause 1's `runway` like every
  other tier.
- **`TIER_SETS` is a TABLE (`as const satisfies Record<Tier, …>`), deliberately not a switch or a
  ternary** — the `TIER_REASON` precedent (`businessProfile.ts:342`): a ternary is total by
  construction, so a tier added to the union without an entry here would silently inherit the
  else-branch's rows instead of failing to compile. Each tier's `typicalHeadline` is the `funding:
  null` fallback — what that tier's typical posture would produce — so an incomplete profile still
  gets a sensible lead, never a blank.
- **No orphan headline, routed to the row that OWNS the key (Task 9 review fix).** After composing
  the tier's three rows and picking the headline, the function checks the headline appears
  somewhere in `[...unitEconomics, ...solvency, ...activity]` and, if not, prepends it to whichever
  row's TYPE actually carries that key — `UNIT_ECONOMICS_KEY_SET`/`SOLVENCY_KEY_SET`, two
  `Record<keyof CashUnitEconomics | CashSolvency, true>` maps declared next to the guard and
  compile-bound to those two types, so an added/renamed field there fails to compile until the map
  is updated too. **An earlier version always prepended to `solvency` and claimed in comment that
  solvency is "the row every headline candidate here belongs to" — false: `cfa` is a
  `CashUnitEconomics` member, `cash.solvency`'s actual return has no such field, and the only reason
  nothing broke on screen was `SolvencySection` defensively skipping a key it cannot resolve
  (correct by accident, not by construction — Task 9 review).** The only case this fires today is a
  bootstrapped `startup`, whose own rows don't otherwise carry `cfa`; it now lands in
  `unitEconomics`, so the "Does each customer pay for itself?" row actually shows CFA for that
  tenant, not just the headline card above it. A test loops every tier × posture combination
  (including `funding: null`) and asserts the headline is always in the concatenated rows; a second
  test pins the bootstrapped-startup case specifically: `cfa` is in `unitEconomics`, never `solvency`.
- **Agreement with `CASH_INPUTS` checked by hand, not re-derived.** Every row in `TIER_SETS` is
  backed by an input `cashInputsForTier(tier)` actually collects for that tier: `mrr`/`arr` appear
  only where the catalogue's `mrr` spec lists the tier (`startup`/`sme`/`enterprise`, never
  `solopreneur`), `workingCapital` only where it lists `receivables`/`payables` (`sme`/`enterprise`
  only), `referralPct` only where it lists `referralPct` (never `solopreneur`) — matching the
  panel's own tier gating exactly, so no set implies a field the panel never asks that tier for.
  The reverse asymmetry is intentional and not a contradiction: `solopreneur`'s `cac` and
  `thirtyDayCashPerCustomer` ARE collected (unrestricted `tiers`), but `cacPayback`/`cacVsIndustry`
  are not shown to them — a display curation choice, since `CASH_INPUTS` governs what is asked and
  `TIER_SETS` governs what is shown, and the brief allows the two to differ in that direction.
- **No word "ROAS" anywhere** — same ambient rule as `unitEconomics` above; a dedicated test
  stringifies every tier's set and asserts the lowercase string never appears.
- Test evidence: `cash.test.ts`'s `describe("which metrics a tenant sees", ...)` (9 tests) —
  `pnpm --filter @pikar/core test cash` — 62/62. `pnpm typecheck` — 10/10 packages green.

### Cash — FigureTile and the connected page (Task 6)

- **One read path, enforced by extraction, not convention.** `convex/cash.ts`'s `inputs` query body
  moved verbatim into `async function inputStatesFor(ctx, tenantId, nowMs)`; `inputs` now calls it
  with `(ctx, ctx.tenantId, Date.now())` and the new `unitEconomics` query calls it a second time
  with the same three arguments before passing the result through `toCashInputs` into `@pikar/core`'s
  `unitEconomics` (imported as `coreUnitEconomics` so the export and the query keep distinct names).
  A tenant's `financeInputs` rows and scorecard fields are therefore read exactly once per query, by
  exactly one function — the panel and the metric tiles cannot drift into disagreeing about what was
  entered, because there is only one place that decides.
- **`cash.unitEconomics` is a `tenantQuery` with no args**, returning `CashUnitEconomics` verbatim
  from core. It reads the tenant's OWN `latestScorecardRow` twice (once inside `inputStatesFor`, once
  directly for the `scorecard` argument `coreUnitEconomics` needs) — both calls are tenant-scoped, so
  a foreign tenant's scorecard is never reachable, the same guarantee `cash.inputs` already had.
- **`FigureTile({ label, figure, note })` in `CashView.tsx` is the ONLY renderer for a `CashFigure`**
  on the Business tab. Four branches, matching the four states `cash.ts`'s vocabulary defines:
  `unknown` renders an em dash and the `needs` prompt, never a number; `not-applicable`/
  `not-computable` share a branch (an em dash plus `because`) since both are "the reason, no number";
  `known` renders `formatFigureValue` on `value`/`unit` plus provenance — `from` (and, for a ratio,
  the sample size, rendered even when `null` as "sample size not recorded" rather than omitted) for
  `origin: "derived"`, a confirm-or-update line for `origin: "stated"` when `stale`, and "Measured by
  Pikar." for `origin: "observed"`. **`formatUsdAmount` takes DOLLARS.** `FinanceView.tsx`'s
  `formatUsdCents` is the Cost console's formatter and takes CENTS — the two must never be swapped;
  passing one plane's number through the other's formatter is off by 100×.
- **`UnitEconomicsSection({ economics, keys })`** renders one `FigureTile` per key present in both
  `keys` and `economics`, skipping (not inventing) a key `economics` doesn't have. `ConnectedUnitEconomics`
  (module-private, like every other `Connected*` on this page) passes `Object.keys(economics)` as
  `keys` until Task 8 supplies the tier-scoped metric set — `ponytail:` comment names that ceiling.
  `SolvencySection` (Task 9) is the same shape with its own label map; it is built by copying this
  component, not by generalising both into a configurable renderer nobody asked for.
- **No arithmetic in the view.** `formatFigureValue` only switches on `unit` to pick a display string;
  every number it prints already arrived as a `CashFigure.value` from `@pikar/core`.
- Test evidence: `cashView.test.ts`'s `describe("figure rendering — the four truths, on screen", ...)`
  (7 tests, one per collapse this component exists to prevent) plus the pre-existing 8 — 15/15.
  `cash.test.ts`'s `describe("cash.unitEconomics", ...)` (3 tests: unauthenticated rejection, a
  foreign tenant's scorecard staying unread, and a `cac`+`thirtyDayCashPerCustomer` happy path
  landing `cfa.state === "known"`/`origin === "derived"`) — 16/16 in the file. `pnpm typecheck` — 10/10
  packages green.

### Cash — the Business tab, assembled (Task 9)

- **`cash.shape`** is a read-only `tenantQuery` over the tenant's `tenantProfiles` row, returning
  `{ tier: Tier | null; funding: Funding | null }`. A tenant with no row gets `null`, not a guessed
  `"solopreneur"` — guessing is what the markdown-fallback defect did, and a wrong guess here selects
  the wrong metric set. **`revenueStage` is deliberately NOT returned**, per Task 7's ruling recorded
  above: no branch anywhere can correctly consult it, and deriving `not-applicable` from a stage field
  is exactly the "inferred from absent data" move `CashFigure`'s four states forbid. Do not re-add it.
- **`cash.solvency`** is a `tenantQuery` reading `inputStatesFor` (the same one read path `inputs`/
  `unitEconomics` already use) and calling `@pikar/core`'s `solvency({ inputs, tier, nowMs })`. **No
  profile row defaults `tier` to `"solopreneur"` here, and ONLY here, for not-applicable resolution —
  the conservative choice, because it hides MRR/ARR rather than inventing them.** This is a narrower
  contract than `cash.shape`'s honest `null`: the page separately shows `ShapeMissingNotice`, so a
  tenant is never shown a fabricated tier as fact, only used as the SET-NARROWING default while they
  have not answered.
- **`CashView.tsx`'s `CashTab` composes, top to bottom: `ShapeMissingNotice` (conditional) →
  `HeadlineCard` → `UnitEconomicsSection` → `SolvencySection` → `ActivitySection` → `NumbersPanel`** —
  the design's fixed order. Every section keeps its OWN `Connected*` wrapper and its own `useQuery`
  call; `ConnectedHeadline` reads `cash.shape` + `cash.unitEconomics` + `cash.solvency` (it needs
  whichever underlies its metric), `ConnectedUnitEconomics` reads `cash.shape` + `cash.unitEconomics`,
  `ConnectedSolvency` reads `cash.shape` + `cash.solvency`, `ConnectedActivity`/`ConnectedNumbers` are
  unchanged from Task 2/3. Several `Connected*` components independently subscribing to `cash.shape`
  (or to `cash.unitEconomics`/`cash.solvency`) is the SAME pattern `FinanceView.tsx`'s `RailsSection`/
  `TrackedSection` already use for `finance.summary` — one client-side subscription per unique
  query+args, not a duplicated network read.
  **What "isolated" precisely means here (Task 9 review correction — an earlier version of this
  entry overstated it):** each section's `useQuery` returning `undefined` (loading) or an empty
  result is independent of every other section's — `ConnectedUnitEconomics`'s `cash.unitEconomics`
  read having nothing to show does not blank `ConnectedSolvency`/`ConnectedActivity`, because each
  is its own hook call with its own subscription.
  **A thrown `useQuery` exception is ALSO isolated now, at the TAB level (whole-branch review
  cleanup, superseding the "NOT isolated" claim below).** `FinanceTabs.tsx` used to mount `CashTab`
  under `FinanceView.tsx`'s single, page-wide `FinanceErrorBoundary`, shared with the always-mounted
  `PikarSpendTab` (and the owner-only `OperatorTab`) — a genuinely thrown query exception from ANY
  section unwound to that one shared boundary and took the WHOLE tab tree down with it, which is
  exactly what happened when B1's malformed-scorecard crash reached `unitEconomics`: the Business
  tab's crash also killed the always-mounted Pikar-spend tab. Each of the three tab panels
  (`finance-panel-business`/`-spend`/`-operator` in `FinanceTabs.tsx`) now wraps its own content in
  its OWN `<FinanceView>` boundary instead of one shared outer wrap — a thrown exception in `CashTab`
  now degrades only the Business panel; Pikar spend (and Operator, for an owner) keep rendering.
  **What is still NOT proven by a test, only by reading the composition:** an error boundary needs a
  real React tree with `componentDidCatch` to exercise, and `cashView.test.ts`'s
  `describe("section isolation — what is proven and what is not", ...)` renders pure components with
  `renderToStaticMarkup`, which has no error-boundary machinery — so the exception-isolation claim is
  verified by reading `FinanceTabs.tsx`'s structure, not by a DOM-free unit test; that test's own
  comment says so.
- **`metricSetFor(tier, funding)` is computed once per `Connected*` wrapper** (not hoisted into a
  shared context/provider — nothing here asked for one) from `cash.shape`'s tier, falling back to
  `"solopreneur"` via the same `fallbackTier` helper wherever `tier` is `null` — matching
  `cash.solvency`'s own conservative default so the frontend and backend never disagree about which
  set a shape-less tenant is shown. `UnitEconomicsSection`/`SolvencySection` receive the resulting
  key list; the `ponytail:`-marked `Object.keys(economics)` placeholder from Task 6 is gone.
- **`SolvencySection({ solvency, set })` is `UnitEconomicsSection` COPIED, not generalised** —
  CLAUDE.md §8: two similar presentational components kept separate is the compliant shape, a shared
  configurable renderer would be the unrequested abstraction. It carries a one-line frame — "Not part
  of the growth framework. These are the figures investors and accountants ask for." — marking the
  finance-ops layer as OUTSIDE the Hormozi framework wherever it renders, per Task 7's own module
  comment. A `set` with zero keys renders nothing, matching `UnitEconomicsSection`'s existing contract.
  **Fixed, not just documented (Task 9 review):** `metricSetFor`'s "no orphan headline" rule used to
  put a UNIT-ECONOMICS key (`cfa`, for a bootstrapped `startup`) into the `solvency` array regardless
  of which type actually owns it — see the corrected "No orphan headline" bullet in the Task 8
  section above for the routing fix itself (`@pikar/core`). `SolvencySection` still defensively
  skips any `set` entry with no matching figure — that backstop is real and stays, it is just no
  longer the ONLY thing standing between this row and an unresolvable key.
- **`HeadlineCard({ metric, figure, tier, funding })`** looks its label up in the SAME two label maps
  the two rows already use (`UNIT_ECONOMICS_LABELS`, `SOLVENCY_LABELS`) rather than inventing a third
  copy — CFA's label is already phrased as a question ("Does a customer pay for itself in 30 days?"),
  which is what frames the headline as the question it answers. `tier`/`funding` drive one line of
  posture context text; they never re-decide WHICH metric leads (`metricSetFor` already decided that
  in the caller) — this component only explains the choice, it does not make it.
  **The caption is keyed on `metric` itself, not re-derived from `tier`/`funding` alone (whole-branch
  review B2 fix).** The first version's `headlineReason(tier, funding)` returned "Bootstrapped:
  whether each customer pays for itself matters most right now" for EVERY `funding ===
  "bootstrapped"` tenant — but `metricSetFor`'s clause 2 overrides a bootstrapped `sme`/`enterprise`'s
  headline to `workingCapital`, so that sentence rendered under a working-capital FIGURE for every
  bootstrapped SME, describing a metric the tile was not showing. `headlineReason` now switches on
  `metric` — the SAME value `metricSetFor` already computed and passed in — so the caption cannot
  drift from the headline again: `runway` → the outside-money sentence, `workingCapital` → the cash-
  conversion-cycle sentence, `cfa` (the only remaining case) → the pays-for-itself sentence.
  `cashView.test.ts` pins a bootstrapped SME and a bootstrapped enterprise each showing the
  working-capital caption, not the CFA one.
- **`ShapeMissingNotice()` is a non-blocking invitation, never a gate** — the profile page's
  legacy-tenant precedent. It links to `/dashboard/profile?tab=shape` and its copy avoids "required"/
  "must"; `ConnectedShapeNotice` renders it only once `cash.shape` has resolved and `tier === null`,
  and renders nothing otherwise (loading or a tier present) — the rest of the tab renders exactly the
  same regardless of whether it is on screen.
- Test evidence: `packages/backend/convex/cash.test.ts` gained `describe("cash.shape", ...)`
  (3 tests: null-tier for no row, tier/funding read back verbatim — with an explicit
  `Object.keys(result).sort()` check, since `toMatchObject` alone cannot catch a `revenueStage`
  leak — and tenant isolation) and `describe("tier change", ...)` (1 test: a solopreneur's saved
  inputs persist untouched and a newly-visible field like `mrr` reads `null`, never back-filled,
  once a `tenantProfiles` row appears) — `pnpm --filter @pikar/backend test cash` — 20/20.
  `packages/core/src/cash.test.ts` gained one test pinning the orphan-routing fix directly:
  a bootstrapped startup's `cfa` is in `unitEconomics`, never `solvency` —
  `pnpm --filter @pikar/core test cash` — 63/63.
  `apps/web/app/(app)/dashboard/finance/cashView.test.ts` gained `describe("the headline", ...)`
  (3 tests), `describe("solvency section", ...)` (4 tests: the outside-the-framework frame text, an
  empty `set` renders nothing, a normal `set` renders one tile per key, and a `set` entry absent
  from the `solvency` record is skipped without crashing) and
  `describe("section isolation — what is proven and what is not", ...)` (1 test, pure-component
  layer: a degraded section renders independently of a healthy sibling in the same pass) —
  `pnpm --filter @pikar/web test cashView` — 23/23. `pnpm typecheck` — 10/10 packages green.

### Cash — the two source-scan guards (Task 10)

`packages/core/src/cash.test.ts` gained `describe("what this surface must never say", ...)`, the
`businessProfile.test.ts`/`vaultSurface.test.ts` idiom: read the surface as source TEXT, because a
prohibition on a word cannot be asserted any other way — `metricSetFor`'s existing "ROAS is not a
metric key anywhere" test (Task 8 section above) checks the DATA a tier set produces, not the source
nobody has yet typed a line into.

- **`SURFACES` is four files, read with `node:fs`, resolved from `packages/core/src/`**: `cash.ts`
  itself, `../../../apps/web/app/(app)/dashboard/finance/CashView.tsx`,
  `../../../apps/web/app/(app)/dashboard/finance/FinanceTabs.tsx`, and
  `../../backend/convex/cash.ts`. All four paths were verified by running the test and reading the
  failure before trusting them — the same discipline `vaultSurface.test.ts`'s own header names.
- **"ROAS appears nowhere"** — `/\broas\b/i` on all four files. The framework's own guidance is to
  stop optimising CAC once inside 3× the industry average; adding a ROAS metric points at the exact
  lever the source says to put down.
- **"no price is displayed"** — `/\$(99|297|597)\b/` and `/per month|\/mo\b|upgrade to/i` on all
  four files. Tier pricing is a separate sub-project; this plane only CONSUMES the tier, never prices
  it.
- **Mutation-checked, not assumed.** A one-line `// ROAS test mutation` appended to `cash.ts` was run
  through `pnpm --filter @pikar/core test cash`, confirmed RED on the ROAS guard specifically (the
  other 64 tests stayed green), then reverted with `git checkout -- packages/core/src/cash.ts` and
  the file confirmed byte-clean (`git diff` empty) before committing. If either guard ever goes red
  for real, the fix is removing the word from the surface — never loosening the regex.
- Test evidence: `pnpm --filter @pikar/core test cash` — 65/65 (63 pre-existing + 2 new).

### Frontend and connected browser evidence

- `apps/web/app/(app)/dashboard/{approvals,finance,content,reports}/` — page routes and state views.
- `apps/web/app/(app)/dashboard/{page.tsx,CommandCenter.tsx}` — Command Center v2 and legacy fallback.
- `apps/web/app/(app)/layout.tsx` — serialized page-by-page navigation activation.
- `apps/web/e2e/{approvals,finance,content,reports,pipeline,command-center}.spec.ts` — authenticated
  browser gates. These exact specs are also inside `cockpit.md`'s broad E2E watch, so route plans
  update both playbooks; this entry does not take ownership of unrelated cockpit specs.

## Dependencies & blast radius

`graphify query "Phase 26 shared dashboard primitives packages core index exports tests playbook
watch ownership"` shows the page adapters feeding the app shell while action terminals remain in
Cockpit, Vault, Media, Guardrails, Audit/WORM and Phase 19. Runtime couplings the graph cannot prove:

- Public tenant reads/writes must use `tenantQuery`/`tenantMutation`; deployment-global facts and
  controls must use the owner wrappers and `requireOwner`.
- Convex indexes and optional legacy fields land before page readers. No Phase 26 rollback narrows
  schema, deletes coverage/provenance or invents a historical backfill.
- Storage and attachment URLs are short-lived capabilities minted only after a fresh ownership
  check. They are never persisted in page rows, audit payloads or logs.
- The Finance limiter is enforcement truth; `spendEvents` is reporting/reconciliation truth. UI
  rollback must not stop ledger instrumentation or it creates an irreparable history hole.
- Pipeline data and send safety belong to Phase 19 (`ACTN-05`, `PIPE-01`). Phase 26 consumes its
  bounded summary only after that external gate; it does not add opportunities, stages or value.
- Command Center composes source summaries. It must not reread raw tables or turn one failed source
  into a healthy/zero result.

## Data flow

1. The browser selects an absolute period and supplies its named IANA timezone. Until tenant profile
   timezone exists, the result explicitly records `timeZoneSource: "browser-fallback"`.
2. `resolveDashboardWindow` validates a half-open `[sinceMs, untilMs)` request, rejects reversed or
   oversized ranges, and clamps only to explicit coverage boundaries.
3. A tenant/owner wrapper authenticates and scopes the page request before any database read.
4. The adapter uses an index plus cursor or both time and row caps, then maps rows to a narrow public
   projection. Raw database rows, raw `audit.payload`, prompts and content-like log fields stop here.
5. The adapter returns data plus `DashboardBound`. `partial` and its code-owned reason stay separate
   from `nextCursor` because legacy/coverage gaps can be partial without another page.
6. React renders loading, empty, ready, partial, busy, retryable error or governed refusal as distinct
   states. An exception never becomes `0`, `Healthy` or an empty array.
7. A state-changing control calls the existing governed mutation. The mutation rechecks tenant/owner
   authorization and current state, is retry-idempotent, and audits refs/hashes/counts only.
8. Attachment/report downloads request a newly ownership-checked signed URL on demand.
9. Navigation normally remains disabled/Soon until focused tests, authenticated Playwright,
   responsive and keyboard checks, rollback proof and blocking owner UAT all pass. An explicit
   owner-directed preview may activate one implemented route so UAT is reachable from the product;
   that link is access, not approval, and the checkpoint remains open.

## Invariants — what must never break

1. **Authorization lives on the server.** Hiding a nav item/control is presentation only. Tenant and
   owner isolation tests delete the scope/role premise and must fail.
2. **No raw rows cross the page boundary.** Page adapters return allowlisted refs, timestamps, counts
   and code-owned enums. Governance tests inject nested/address/content-like audit values and prove
   they never reach the result or DOM.
3. **Every list is bounded.** Use a stable total order, cursor pagination, or explicit time plus row
   caps. Never add hot-path `.collect().length`; capped counts carry partial copy.
4. **Time windows are half-open.** Persist epoch milliseconds, filter `>= sinceMs` and `< untilMs`,
   and format with the returned named timezone. Tests pin reversed, equal and oversized refusal.
5. **Money is integer USD cents.** Estimated, reserved, actual, refunded and unlanded are distinct;
   pre-coverage history is Unknown, never fabricated `$0`. **`unlanded` IS NOT ONE NUMBER ACROSS
   RAILS.** On reasoning and ingest it is money in flight that can still land or be refunded; on
   MEDIA it is permanent — that rail consumes the whole job estimate up front and has no refund
   path, so the gap between estimate and actual is never returned. `aggregateSpend` therefore
   derives `unlanded` PER RAIL and returns `byRail` beside the blended `totals`; read `byRail` with
   `UNLANDED_RESOLVES` before the figure reaches a person. Calling the blend "pending" describes
   media wrongly, and re-deriving it from blended sums is worse — one rail's refund would cancel
   another rail's reservation, money that can never come back being "returned" by money from an
   unrelated rail.
6. **Failure is not emptiness.** Loading, successful empty, partial, retryable error, busy/stale and
   governed refusal remain distinct. Health is Healthy only when every required loaded signal is.
7. **Signed URLs are on demand.** Ownership is checked before minting; capabilities never enter
   audit/log/storage rows. Foreign-id tests must fail closed.
8. **Mutations are state-guarded and replay-safe.** Retries, scheduler/webhook races and duplicate
   clicks have one terminal effect and refs/counts-only audit. A discarded plan never rearms.
9. **External success is never seeded.** Seeded terminal rows can prove UI/accounting states only.
   Provider delivery, charge, render or storage success requires separately executed live evidence.
10. **Page rollout is independent.** Direct routes support gates; nav normally activates after that
    page's blocking owner UAT. A named owner-preview exception may expose an implemented route while
    its UAT stays pending. Incomplete pages never receive fake data to unlock navigation.
11. **Pipeline safety is never a UI rollback.** Hiding Pipeline cannot remove Phase-19 suppression,
    consent or postal-footer enforcement.
12. **Command Center only composes summaries.** Source loading/error/partial/unavailable semantics
    survive composition; a Pipeline error cannot erase or zero other cards.

### Approvals read contract

- `approvals.summary` is the single page-and-rail subscription. It reads only `proposed` rows through
  `plans.by_tenant_status_createdAt`, returns the exact oldest timestamp, and reports at most `100`
  as `awaitingCount` with `awaitingCountCapped: true` when more exist. The badge renders `100+`; it
  must not start a second count query.
- `listAwaiting`, `listScheduled`, and `listInFlight` use Convex's opaque index cursor and clamp every
  requested page to `1..50`. Timestamp ties are therefore carried by the database cursor instead of
  a timestamp-only cursor that could skip work. The public row is refs/enums/timestamps/counts only:
  no tenant id, subject, body, recipients, candidate hints, attachment capability or raw plan row.
- Scheduled rows with no legacy `sendAt` are `scheduleState: "legacy-unknown"`. In-flight and cleared
  rows are exact only when `counterComplete` is true and all four counters form a valid total;
  otherwise progress is `partial/legacy-window`, never inferred as zero.
- `listCleared` requires an absolute `sinceMs`, queries `done` and `canceled` separately through the
  same tenant/status/time index, merges them in the shared stable order, and caps the merged result at
  50. A cap is returned as `partialReason: "row-cap"`. A canceled row without `cancelKind` is
  `legacy-unknown`; cost remains `{state:"unknown"}` until the spend ledger owns coverage.
- `listDecisions` scans at most 100 recent tenant evaluation rows and emits only code-owned financial
  questions whose closed Scorecard field is still empty. `answerDecision` accepts three numeric paths
  and one boolean path through a discriminated validator, rechecks that the latest tenant/thread row
  still exposes the question, and then patches it atomically. Rendered text can never choose a field.
- `blockedSummary` reads at most 21 unresolved tenant DLQs and returns only a capped count, oldest and
  newest timestamps, and `/ops`. It never returns DLQ ids, correlation/workflow ids, payload, error,
  notification body or a resolution control. Ops remains the only browser resolution surface.

**Approvals rollback:** disable the route/nav and fall back to the originating cockpit thread,
`/review`, `/requests`, and `/ops`. Keep the compound index, cancellation provenance, delivery
counters and read adapter deployed; rollback never rewrites a legacy row or fabricates cost/progress.

### Approvals type scale — inline styles must quote the mockup, not invent

`ApprovalsView.tsx` styles inline rather than through `globals.css` classes, so nothing stops a
value from drifting off-brand; the owner reported the first build as oversized on every axis at UAT.
The authority is `docs/design/mockups/pending-pages.html`, and the shipped sibling page
(`.vault-header h1`) already matches it. Pinned: the display headline is
`clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)` — the SAME clamp as the Vault, never a steeper `vw` term or
a larger cap; `.btn` is a `999px` pill at `0.86rem` (an inline `font: inherit` silently lands at the
1rem body size and MUST be followed by an explicit `fontSize`); card headings use the `cardTitle`
constant at `1.05rem`, because a bare `<h3>` falls back to the browser's `1.17em` — `globals.css`
has no heading reset; a TEXT stat takes `.stat-value.is-text` (`1.05rem`), not the `2rem` numeral
size; `caps` is `0.7rem`/`0.14em`. Touch targets stay at `2.5rem` `minHeight` (BRAND §6) — reducing
type must never reduce the hit area. When adding a surface here, copy the mockup's value or reuse a
`globals.css` class; do not eyeball a new one.

### Approvals — owner-APPROVED (Plan 26-05, Task 2 closed 2026-08-08)

- **The owner ran the UAT against seeded plan rows and approved it on 2026-08-08**, which is what
  unblocked Task 3's rail badge. Scope of that evidence, stated so it is not over-read later:
  it covers the UI states and the guarded terminals ONLY. **No Gmail send, Calendar insert or media
  generation was executed**, so nothing here is evidence of an external-provider result; that still
  needs a separately executed live run. Two defects were found and fixed during the UAT: the page's
  type scale (see above) and a cockpit crash on `?thread=` (see `cockpit.md` — the bug was in
  `listThreadMessages`, not on this page).
- `ApprovalsBadge` in `apps/web/app/(app)/layout.tsx` subscribes to **the same `approvals.summary`**
  the page does, which is the plan's one-shared-subscription key link: the rail count cannot
  disagree with the page it links to. It is shaped on the existing `DeadLetterBadge` — `undefined`
  (loading) and `0` both render nothing, so the rail never flashes a zero or a stale count — and it
  renders `N+` when `awaitingCountCapped`, never the capped number presented as exact.
- **Rollback is still one line:** delete the `NAV` entry. The route becomes undiscoverable while
  plan state, cancellation provenance, delivery counters and the read model all stay deployed.
- The page composes `approvals.summary`, bounded Awaiting/Scheduled/In-flight/Cleared lanes,
  decisions and the sanitized Ops aggregate. Detail content is fetched through the existing
  tenant-owned `plans.byThread`; attachment capabilities are requested only after the user opens
  the attachment list.
- Initial email scheduling is deliberately two-step: the browser parses `datetime-local` in its
  resolved IANA timezone, rejects invalid/past/out-of-horizon values, displays the resulting absolute
  instant, then confirmation calls `setPlanSendTime` followed by the existing `executePlan` gate.
  Scheduled cancel and move call `cancelScheduledPlan`/`moveScheduledPlan`; `alreadyResolved` and
  `already_fired` are rendered as stale/in-flight outcomes, never successful cancellation/movement.
- Every awaiting row links to `/dashboard/workspace?thread=<id>` for revision or calendar-time
  changes. Destructive discard requires an inline confirmation and keeps the permanent
  `cancelKind:"discarded"` non-rearm boundary. Compliance details remain at `/ops`.
- Loading, successful empty, bounded partial, retryable exception, busy, stale and governed refusal
  copy are distinct. Cost stays “not recorded”; legacy delivery progress stays partial.

**Automation status (2026-08-05):** the executable pure/server-render contract is
`approvalsView.test.ts` (not `.test.tsx`, because `apps/web/vitest.config.mts` intentionally discovers
only `.test.ts` in its DOM-free runner) and passes 13/13. Web typecheck passes. The authenticated
Playwright spec is authored and reached the real local Convex seeding/route run, but this shell has
no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` and the saved storage state is expired; the page correctly
redirected to Sign in. Therefore authenticated browser/UAT evidence is still **pending**, not green;
the owner-preview navigation link is active only to make that verification reachable.
Resume with both runtimes active and credentials set:

```text
pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts
```

The spec seeds plan rows for UI-state evidence only. Public mutations prove schedule replay,
idempotent cancel, no duplicate request fan-out, lost cancel/move races, permanent discard and a
provider-free memo double-approve. It never treats seeded done/delivering rows as Gmail, Calendar or
media-provider success; any such claim requires a separately executed live result.

### Finance ledger contract

`spendEvents` is the reporting/reconciliation plane. **The limiter stays enforcement truth**: it
decides whether a spend may happen, and nothing here may be relaxed to make a report easier.

- **Correlation construction.** A `correlationId` is server-minted from refs and matches
  `^[A-Za-z0-9._:@/-]{1,128}$` — no whitespace, so a pasted sentence cannot enter the table (§4).
  It must be **stable** across every retry of one logical movement and **distinct** between logical
  movements; a random per-attempt id silently defeats replay suppression.
- **Identity is `(tenantId, correlationId, phase)`, not the correlation alone.** A reservation and
  its later actual charge deliberately share one correlation — that shared key is what makes them
  reconcilable — so a correlation-only guard would swallow the actual as a duplicate of the
  reserve. `by_correlation` is not tenant-scoped, so the tenant comparison is part of the identity
  check in `spendLedger.record`, never an assumption.
- **First write wins.** A replay returns the stored id and ignores the replayed amount. A retry
  reporting a different number is an upstream bug; letting it through would rewrite recorded money.
  Drift is corrected by appending an `adjustment` (owed more) or `refunded` (money back) movement.
- **Direction lives in the phase, never the sign.** Every `amountCents` is a positive safe integer,
  so no consumer has to guess whether a negative is a credit or a bug.
- **Indexes.** `by_tenant_createdAt` (window reads), `by_tenant_rail_createdAt` (one-rail reads),
  `by_correlation` (idempotence). A reader that needs a fourth access pattern adds an index; it
  does not filter a wider scan.
- **Retention.** There is no purge, TTL or archival path in this module and adding one is a
  separate, deliberate design — this is financial history, and the insert-only source scan
  (`db.patch`/`db.replace`/`db.delete`) fails the build if an edit path appears (§3).
- **Reconstruction limits — what the ledger cannot tell you.** A window opening before
  `spendCoverage.coverageStartedAt`, or a tenant with no coverage row at all, is **Unknown**; it is
  never rendered as `$0`, and it can never be backfilled because the events were never observed.
  `listEvents` caps at 500 rows, so a window that fills the cap is partial and must carry
  `partialReason: "row-cap"`. The idempotence scan reads at most 32 rows per correlation, which is
  safe only while every writer keeps to one row per `(tenant, correlation, phase)`.
- **Disagreement with the limiter is a signal, not a defect.** Unlanded money — reserved, then
  neither charged nor refunded — is exactly what reconciliation is for. Do not hide it by folding
  it into another phase.
- **Rollback rule, non-negotiable.** Finance may hide its route and owner controls. It may **not**
  stop ledger instrumentation: an append-only history has no backfill, so a dark window is a
  permanent hole in the record.
- **Who writes (26-07).** The reasoning and ingest rails are instrumented at their limiter, inside
  the same transaction, via `spendLedger.recordMovement` — the plain-function half of `record`. The
  writers, the correlation policy and what is deliberately NOT recorded live in
  `docs/playbooks/guardrails.md` §"Phase 26"; Finance is a READER and must not re-derive any of it.
- **Who writes (26-08).** The media rail is instrumented too, so all three rails are covered. It is
  the one rail whose two planes diverge on AMOUNT by design (`docs/playbooks/media.md`): the limiter
  takes the whole batch estimate up front and never refunds, so `reserved − actual` is a PERMANENT
  over-reservation rather than money in flight. `UNLANDED_RESOLVES.media` is `false` and says so in
  code; a surface that calls it "pending" is ignoring an explicit fact.
- **A schema source scan must pin the DECLARATION, not the print width.** `dashboardSchema.test.ts`
  compares whitespace-free and normalizes the trailing comma before `)`, because the formatter adds
  one when it wraps a call across lines and drops it when the call fits on one. Commit `b74c7af`
  re-wrapped `cancelKind` onto a single line and turned this gate red without changing the schema's
  meaning; `dense()` exists so that cannot happen again, and it still goes red on a real change.

### Finance projections and owner controls (26-09)

`packages/backend/convex/finance.ts` is the READ side. It returns the two planes side by side and
never derives one from the other: `rails` is what the limiter will enforce on the next call,
`tracked` is what the ledger observed. `tracked` can be `coverage: "unknown"` while `rails` is
perfectly known — that is not an inconsistency, it is the difference between a gauge and a record.

- **The tenant surface must expose no deployment-global state.** `guardrails.remainingDailyCents`
  and its media/ingest siblings return `min(tenant, deployment)` — correct for sizing a sub-agent
  envelope, WRONG here, because that minimum leaks the keyless ceiling's utilization to every tenant
  that can read it. `finance.summary` reads the PERSONAL window only; the three deployment ceilings
  are `finance.globalRails`, an `ownerQuery`. A test drains all three deployment windows and asserts
  no deployment constant appears anywhere in the tenant payload.
- **`getValue` returns STORED state, not a roll-forward**, so a rail must be rolled to `now` before
  a person sees it — with the component's own exported `calculateRateLimit`, never a
  reimplementation. `guardrails.refundableCents` learned this by refunding 2900 against a capacity of
  2500; the Finance tile is where it bites the other way, telling a tenant with a full allowance that
  they are out of budget because the window rolled overnight with nothing written since.
- **`resetsAtMs` is not midnight anywhere.** A fixed window with no `start` is anchored to the rail's
  FIRST spend, so each rail resets on its own offset. It is returned as an epoch instant labelled
  `resetTimeZone: "UTC"` — the ENFORCEMENT clock, deliberately separate from `window.timeZone`, which
  is the browser-derived DISPLAY timezone and never reaches a query or a filter.
- **The reported window is passed to `aggregateSpend` UNCLAMPED.** Clamping it up to
  `coverageStartedAt` would turn an unknown stretch into a silently shorter window with a confident,
  wrong total. Each `spendSeries` bucket is aggregated on its own for the same reason, so a bucket
  before coverage reports `unknown` instead of inheriting the window's verdict.
- **A window that fills the 500-row cap is `partial` + `"row-cap"`**, and its totals are
  under-reported. Never render a capped window's total as the period's spend.
- **`mediaLedger` uses Convex's own cursor pagination**, because a batch's lines all share one
  `createdAt`; the index cursor carries the document id, so a page boundary inside a timestamp tie
  neither repeats nor drops a row. A hand-rolled `createdAt` cursor cannot do that.
- **Reads go through `spendLedger`'s plain-function halves** (`coverageFor`, `listEventsFor`), added
  in 26-09 for the same reason as `reserveFolderInner`/`reserveFolder`: a Convex query cannot
  `runQuery`, and the cap and index must live in ONE place or the reader grows a second definition of
  the bounded read.

**Operator blast radius — the owner controls are deployment-wide, not per tenant.**

| Control | Effect | Blast radius | Rollback |
|---|---|---|---|
| `finance.setMasterKillSwitch` | `guardrailConfig.killSwitch` | ALL tenants, ALL model calls, incl. the email cockpit and every ingest path | flip it back; nothing is lost, refused calls were never charged |
| `finance.setMediaKillSwitch` | `guardrailConfig.mediaKillSwitch` | ALL tenants' paid generation only; the cockpit keeps running | flip it back |
| `finance.setPerRequestBudget` | `guardrailConfig.budgetUsdPerRequest` | ALL tenants' `chooseModel` ceiling; too low refuses every request as `over_budget` | set the previous value, which the audit row records as `from` |

- **The wrappers are the boundary, not the UI.** All six owner functions are `ownerQuery`/
  `ownerMutation`, so a non-owner is rejected before the handler reads or writes. Hiding a control in
  the console is cosmetic. `requiresConfirmation` is code-owned on every control so the console
  cannot ship a one-click deployment-wide pause by forgetting a prop.
- **One upsert writes every field.** `patchControls` merges over the effective `getGuardrailConfig`,
  so the insert branch can never create a row with one field set and the others missing — which is
  what makes the default-on-read contract survive the first write.
- **One audit row per ACCEPTED transition, none for a no-op** (the `owner.bootstrapOwner`
  precedent): an event for a change that did not happen makes the log lie about when the deployment
  moved. The payload key set is exactly `control,from,to` — booleans, numbers and a code-owned
  control name, nothing identifying (§4).
- **Every mutation returns the re-read effective state**, not the argument it was given, so a write
  a concurrent transaction overwrote cannot be reported as success.

### The connected Cost route (26-10)

`apps/web/app/(app)/dashboard/finance/` — `page.tsx` is a five-line server component; everything
lives in `FinanceView.tsx`, which follows the ApprovalsView shape exactly: `"use client"`, one error
boundary, per-section `useQuery` so a ledger failure cannot erase the live rails, and inline
`CSSProperties` rather than class names.

- **The page is named Cost and reads spend only.** Owner rename decision 2026-08-07: business money
  (revenue, invoices, runway) is Phase 28's separate **Cash** surface. There is no revenue data in
  the system, so a revenue tile would be fabricated (BRAND §5). The route path stays
  `/dashboard/finance` because that is what the plan and the watch map name.
- **Almost none of the mockup's classes exist.** `globals.css` really has `stat-grid`, `stat-tile`,
  `stat-head`, `stat-badge`, `stat-value` and `caps-label`. `.card`, `.meter`, `.pill`, `.btn`,
  `.sec`, `.split`, `.bars`, `.kpi`, `.note`, `.mono`, `.num` are **mockup-only**, and `.ledger` IS
  defined but is the DARK marketing audit block from the landing page — applying it here renders the
  console on a navy panel. Check `globals.css` before reusing a class name from
  `docs/design/mockups/pending-pages.html`.
- **The budget meter is a native `<progress>`, and the percentage is also written in words.** That
  is the in-app precedent (ApprovalsView delivery progress), it needs no new CSS, and it satisfies
  BRAND §6's no-meaning-in-color-alone rule for free. The mockup's `.meter.warn` paints `--held`;
  BRAND §2 reserves amber for the approval gate ("spend amber in exactly one place"), so a budget
  warning must not borrow it.
- **Three page rules, each with a component test that goes red without it.** An `unknown` window
  renders NO currency mark at all (a zero is indistinguishable from a watched-and-empty period);
  media's `unlanded` gets different copy from the other two rails (`unlandedResolves.media` is
  `false`, so it is permanent, not pending); and `bound.partial` says the totals are a FLOOR.
- **The window is clamped to the coverage start, and the clamp ANNOUNCES ITSELF.** `finance.coverage`
  is read first so the page can size its window before asking for totals. Found by the 26-10 UAT on
  a real tenant: a fixed 30-day window over a workspace covered since the previous day made
  `aggregateSpend` return `unknown` for the whole period, so the totals read "Unknown" while the
  per-day series directly beneath them showed **$1.52** on a covered day — self-contradictory, and it
  suppressed every real figure for a month after any tenant starts. `CoverageClampNotice` names the
  truncation ("Showing since 8 Aug 2026, when cost tracking began"). **A SILENT clamp is still
  forbidden** — that reports a confident total for a narrower period than the reader asked for,
  which is the failure the coverage field exists to prevent. Two cases are deliberately not clamped:
  a tenant with no coverage row keeps the full Unknown state, and a coverage start at or after
  `untilMs` is left alone rather than inverting the window into a `resolveDashboardWindow` throw.
- **`requiresConfirmation` is honoured as a backend fact.** Each control arms, then commits, and the
  confirm step is in-component — never `window.confirm`, which blocks the page and cannot be driven
  by the spec that has to prove the boundary.
- **A non-owner's DOM carries no deployment VALUE and no switch POSITION.** Naming that the controls
  exist is product copy; a ceiling amount or an on/off state is a global fact. `ConnectedDeployment`
  passes `"skip"` to the owner queries for a non-owner — firing them would throw `OWNER_REQUIRED`
  and drop the whole page into the error boundary for someone who is simply not the owner.
- **Component tests are `.test.ts`, never `.test.tsx`.** `apps/web/vitest.config.mts` includes
  `app/**/*.test.ts` only, so a `.tsx` is silently skipped. Components are built with
  `createElement` and rendered to a string with `renderToStaticMarkup`; only the hook-free exports
  are importable, which is why the connected pieces stay module-private. The same config now sets
  `esbuild: { jsx: "automatic" }` to match Next; before that, esbuild's classic runtime made every
  `.tsx` reached from a test need a dead default `React` import or die with `React is not defined`.

### Finance becomes a three-tab shell (cash-business-finance Task 1)

The route is now a three-tab shell, structural move only — no cost behaviour changed.
`apps/web/app/(app)/dashboard/finance/page.tsx` renders `FinanceTabs.tsx`, which owns the tablist
and the header; `FinanceView.tsx` no longer renders a page on its own, it exports the tab bodies.

- **Business leads.** `FINANCE_TABS` order is `["business", "spend", "operator"]` and `?tab=`
  defaults to `business` on an unrecognized or missing value — the tenant's own money outranks the
  tool's bill. `CashView.tsx`'s `CashTab` is a placeholder in this task; Tasks 2, 3, 6 and 9 build it.
- **Pikar spend is the shipped Cost console, moved intact, not reopened.** `ConnectedFinance` was
  renamed to the exported `PikarSpendTab` with its own `<header>` deleted — the shell now owns the
  one page header — and every other export (`RailsSection`, `TrackedSection`, `LedgerSection`,
  `RailTile`, `TrackedTotals`, etc.) and their behaviour are untouched.
- **Operator is owner-only, and hiding it is presentation, not the boundary.** `ConnectedDeployment`
  was renamed to the exported `OperatorTab`; its body — including the `isOwner ? {} : "skip"` guards
  on `finance.controls`/`finance.globalRails` — is unchanged. `visibleTabs(isOwner)` filters the tab
  out of the tablist and `FinanceTabs` mounts the Operator panel only when `isOwner` is true (a
  hidden-but-mounted panel would still fire the owner queries for a non-owner and throw
  `OWNER_REQUIRED` into the error boundary). The actual trust boundary remains the `ownerQuery`/
  `ownerMutation` wrappers on `finance.ts`, exactly as recorded above — moving the tab does not
  change who Convex lets call them.
- **Tab mechanics are copied from `dashboard/profile/page.tsx`, not invented**: roving tabindex that
  moves real DOM focus on arrow-key navigation, `?tab=` read once from `window.location.search`
  (never `useSearchParams`, which needs a Suspense boundary typecheck cannot see is missing), and
  `history.replaceState` on switch so a tab change is not a navigation that re-runs every query.
  Business and Pikar-spend stay mounted and toggle with `hidden`, so a half-typed figure on one tab
  survives a trip to another.
- **Test evidence:** `financeView.test.ts` gained a `describe("finance tabs", ...)` block (5 tests)
  asserting tab order, `visibleTabs` owner-gating, and that every tab carries a sub-heading; every
  pre-existing assertion in that file stayed green because the pure/exported components it imports
  were not restructured. `pnpm --filter @pikar/web test` and `pnpm typecheck` both pass.

**Rollout state, 2026-08-09 — Finance navigation is ACTIVE, on owner direction.** The owner reviewed
the connected page as owner and directed activation; Task 3 replaced the disabled item with
`href: "/dashboard/finance"`. Recorded honestly, because the checkpoint's own wording is "owner types
approved or reports exact defects" and this was a direction to activate rather than a completed
checklist.

*Verified live in the browser before activation:* the three rails and their three DIFFERENT UTC reset
instants; `Unknown` rather than `$0` for a pre-coverage window; both unlanded sentences on one page;
blended unlanded `$6.90` where a blended re-derivation would read `$6.44` (26-08's per-rail decision,
visible on screen); the two-step arm/confirm; the write and its effective-state readback; the master
switch staying independent of the media switch; the revert; and exactly two audit rows with keys
`control,from,to` and actor `owner`.

*NOT observed live, and not claimed:* (1) the non-owner view — `bootstrapOwner` has no inverse, so
once the reviewing account became owner the "managed by the operator" state was unreachable from it;
it stays covered by the backend `OWNER_REQUIRED` tests and the non-owner DOM component test.
(2) Responsive breakpoints — the browser extension's window resize would not move the rendered
viewport, so that check belongs to the Playwright spec's `setViewportSize`. (3) `finance.spec.ts`
itself. Evidence rows seeded for this review are permanent and carry the correlation prefix
`uat-26-10:`.

**Evidence status, 2026-08-09 — the browser gate is NOT green.** Currently passing:
`pnpm --filter @pikar/web test` (88/88, of which 29 are Cost Console), web typecheck, and the
production build, in which `/dashboard/finance` appears in the route table. `e2e/finance.spec.ts` now
carries 5 tests (3 non-owner tab/panel tests, the existing connected cost-console/owner-boundary
test, and Task 10's owner-Operator-tab test, in that declared and `describe.serial`-enforced order).
It is authored and was **attempted again under Task 10**: `pnpm --filter @pikar/web test:e2e`, run
from this worktree with no local `convex dev`/Next stack up (`127.0.0.1:3111`/`127.0.0.1:3210` both
unreachable) — it stopped in the canonical `auth.setup.ts` because this shell has no
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD`, exactly as before: 1 failed (setup), 31 did not run across the
whole `e2e/` suite. Do not cite the browser gate as passed. A green run here would still only be
accounting evidence about seeded state and the projection — it proves nothing about a provider or an
external charge. With local `convex dev` (not `--once`) plus Next on `:3111` and both credentials
exported, resume exactly:

```text
pnpm --filter @pikar/web test:e2e -- e2e/finance.spec.ts
```

The nav item stays `Soon` until that run and the blocking owner UAT both pass; the route is reachable
directly at `/dashboard/finance` in the meantime, and the spec asserts the absence of the nav link so
activation cannot happen by accident.

### The connected Pipeline route (19-07)

`apps/web/app/(app)/dashboard/pipeline/` — the same three-file shape as Cost: `page.tsx` returns
`<PipelineView />`, `PipelineView.tsx` is `"use client"` and holds the page, `pipelineView.test.ts`
is the DOM-free contract. Its backend is `convex/contacts.ts`'s three read models; it has **no
adapter module of its own**, because PIPE-01's whole worry is a second CRM data plane.

- **The route is URL-reachable and the nav is NOT flipped.** `Sales Pipeline` stays `soon: true`.
  The rail branch keys off `href`, so adding the href IS activation; 26-18 owns it. Rollback here
  is deleting the directory — no writer, no instrumentation and no schema is involved, which is
  why the Pipeline row of the rollback table says "hide the route" and nothing more.
- **Four tiles, and every one of them is ALWAYS-KNOWN.** Unlike Finance, this page has no coverage
  start: the substrate is created by the user, so "we weren't watching" cannot apply. A real zero
  is `0` — never `—`, never `Unknown`. This is invariant 6 ("failure is not emptiness") read from
  the other end, and it is the exact inverse of the 26-10 defect: there a number the system did
  not know was printed as `$0`; here a number it DOES know must not be hedged.
- **`.ledger` is the DARK marketing audit block from the landing page and must never dress a data
  table.** It IS defined in `globals.css`, which is what makes copying it out of
  `docs/design/mockups/pending-pages.html` so easy and so wrong — the Pipeline mockup uses
  `<table class="ledger">` and would have rendered this table on a navy panel. Only `stat-grid`,
  `stat-tile`, `stat-head`, `stat-badge`, `stat-value` and `caps-label` are real shared classes;
  everything else here is inline `CSSProperties` over the tokens.
- **Chips carry teal in the FILL and `--ink` on the label** (BRAND §6 bans `--teal-600` as small
  text at ~2.9:1), and there is **zero `--held` amber** on the page — that is the approval gate's
  alone (BRAND §2).
- **Un-suppressing is an in-component arm/commit, never `window.confirm`** — the same rule as the
  Finance owner controls, and for the same reason: a browser modal blocks the page and cannot be
  driven by the spec that has to prove the boundary.
- **Evidence status, 2026-08-09 — the browser gate is NOT green.** *(SUPERSEDED: it went green
  2026-08-09 at 2/2, and the spec was then DELETED at 19-13 — see the top of this file. Kept for
  the reasoning trail; do not read it as current.)* `pipelineView.test.ts` passes
  17/17, web typecheck and the production build are green and `/dashboard/pipeline` appears in the
  route table. `e2e/pipeline.spec.ts` is authored and `--list`-discoverable with two tests, and has
  **never executed** — a `--list` is not a run, and a blank result means NOT RUN. The spec's own
  header carries the runtime prerequisites and the verbatim resume command; the owner runs it at
  19-10.

## How to change safely

1. Add optional fields and compound indexes before readers. Keep legacy rows readable as
   `legacy`, `unknown` or `partial`; backfill only through resumable bounded jobs when justified.
2. Put reusable arithmetic/state/order behavior in a pure package and mutation-test it first.
3. Add a thin tenant/owner adapter with explicit projection, stable order and caps. Test unauthenticated
   access, a guessed foreign id, timestamp ties, empty, cap/partial, retry and legacy rows.
4. For money/action terminals, instrument every success/refund/failure branch and replay before
   building Finance/UI copy. Never weaken the enforcement limiter to make reporting easier.
5. Build the direct route with navigation normally disabled. If the owner explicitly requires an
   in-product preview link for UAT, record that exception without claiming checkpoint completion.
   Cover every page state in component tests, then run authenticated Playwright without claiming
   seeded provider outcomes are live outcomes.
6. Exercise desktop/tablet/mobile, keyboard/focus, no color-only meaning and the rollback boundary.
7. After owner approval, rerun the page browser spec, web typecheck/build and watcher, then record
   approval/evidence here. If an owner-preview link is already active, approval changes the recorded
   rollout state rather than silently treating link activation as sign-off.

## How to verify

### Pure contracts and operational ownership

```text
pnpm --filter @pikar/core test -- dashboard
pnpm --filter @pikar/core typecheck
node scripts/check-playbooks.mjs
```

### Focused backend gates

```text
pnpm --filter @pikar/backend test -- approvals
pnpm --filter @pikar/backend test -- spendLedger
pnpm --filter @pikar/backend test -- finance
pnpm --filter @pikar/backend test -- content
pnpm --filter @pikar/core test -- reports
pnpm --filter @pikar/backend test -- reportsBusiness reportsGovernance reportPack
pnpm --filter @pikar/core test -- home
pnpm --filter @pikar/backend test -- home briefings
```

These prove adapter authorization/isolation, caps/cursors, ledger replay, safe projection, one-snapshot
packs and composed priority/health semantics. Subsystem plans add their terminal-focused commands.

### Connected page gates

```text
pnpm --filter @pikar/web test -- approvals
pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts
pnpm --filter @pikar/web test -- finance
pnpm --filter @pikar/web test:e2e -- e2e/finance.spec.ts
pnpm --filter @pikar/web test -- content
pnpm --filter @pikar/web test:e2e -- e2e/content.spec.ts
pnpm --filter @pikar/web test -- reports
pnpm --filter @pikar/web test:e2e -- e2e/reports.spec.ts
pnpm --filter @pikar/web test:e2e -- e2e/command-center.spec.ts
```

Playwright requires the documented authenticated local Convex/Next runtime. A listed spec is not
evidence until it has executed. Owner UAT remains manual-only and blocking for navigation.

### Phase close

```text
pnpm --filter @pikar/backend test
pnpm --filter @pikar/web test
pnpm --filter @pikar/backend typecheck
pnpm --filter @pikar/web typecheck
pnpm --filter @pikar/web build
node scripts/check-playbooks.mjs
```

## Operational notes

- Roll out per page: additive schema/index → writer/instrumentation → adapter → hidden route → browser
  gate → owner UAT → nav. Never combine nav activation with an unexecuted gate.
- Keep the old Command Center component as a simple feature-switchable fallback through final UAT.
- Treat deployment/provider auth errors as live gates, not test failures and not permission to stub
  success. Record the missing runtime prerequisite and exact resume command.
- `apps/web/e2e/` is broadly watched by `cockpit.md`. The six exact Phase 26 specs intentionally
  require both cockpit and this playbook when changed; unrelated E2E remains cockpit-only.

### Per-page rollback boundary

| Page | Safe rollback | Must remain active/retained |
|------|---------------|-----------------------------|
| Approvals | Disable nav/route and use workspace, `/review`, `/requests` | plan state, discard/cancel provenance and delivery progress |
| Finance | Disable the route and owner controls | spend-event instrumentation, coverage start, enforcement limiters, and the operator paths `guardrails:setKillSwitch` / `setMediaKillSwitch` (`npx convex run`), which stay the fallback when the console is off |
| Content | Disable route/promotion control | provenance and already-promoted/ingesting rows; never silently demote |
| Reports | Disable route and pack generation | immutable generated artifacts/snapshots and safe audit metadata |
| Pipeline | Hide the Phase-19 route | suppression, consent, send-terminal guards and postal footer |
| Command Center | Restore the legacy component | bounded source-summary APIs and their error/partial semantics |

## Known gaps & deferred work

- Tenant profile has no canonical timezone. Browser IANA timezone is the explicit v1 fallback; the
  upgrade is a validated tenant setting, not silent server-local formatting.
- Finance begins at `coverageStartedAt`; earlier history remains Unknown. There is no invented
  backfill from enforcement windows.
- Inline calendar time editing is deferred until availability recheck plus CAS semantics exist;
  Approvals links back to the originating cockpit.
- Pipeline remains a narrow contacts/follow-up/consent/suppression surface. Opportunities, stages
  and monetary pipeline value are out of scope.
- Exact Vault category counters and any new Drive write scope/vendor/data plane remain deferred.
- **`apps/web/e2e/finance.spec.ts` remains NOT EXECUTED** (whole-branch review, same status as Task
  10). No Convex deployment and no built Next app exist in this worktree; `auth.setup.ts` throws on
  missing `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` before a single feature test runs. The whole-branch
  review fixed every statically-provable defect in the spec (the stale heading, the inverted
  nav-disabled assertion, the un-clicked Pikar-spend/Operator tabs, the non-owner Operator-tab
  assertions that targeted unmounted markup) and re-verified the two source-scan guards and the
  `describe.serial` ordering, but none of it has been run in a real browser against a real backend.
- **`latestScorecardRow`'s framework/shape filter (B1 layer 1) does not close every path to
  `setPath` throwing on a malformed carrier** — `applyScorecardAnswer` re-queries by
  `(tenantId, threadId)`, and if a THREAD's own newest row is malformed while an OLDER row on that
  same thread was the tenant's globally-newest usable one, `existing.threadId` could still route into
  a malformed row. Believed unreachable in practice (a `document-review` row's `threadId` comes from
  `voiceDoc.ts`'s own generation, not a conversational thread id), but not proven impossible by a
  type or an index — layer 3 (`setPath` creating intermediate objects) is the real backstop, kept
  deliberately even though layer 1 closes the common case.
- **`metricSetFor`'s `else set.activity` branch (the orphan-headline guard's three-way routing,
  `packages/core/src/cash.ts`) stays unreachable, deliberately left in.** B4 (rendering the referral
  tile) does not change what `metricSetFor`'s `headline` can BE — it is still only ever
  `cfa`/`runway`/`workingCapital`, never an activity-only key, so the branch remains dead defensive
  completion of the three-way `if`/`else if`/`else`. Recorded here (Task 9 first flagged it) so it is
  not mistaken for new dead code from this wave.
- **`TIER_SETS.solopreneur.activity` lists `"engagedLeads"` as a `CashMetricKey`, but nothing computes
  it and nothing renders it** — unlike `referralPct` before B4 (which WAS computed by `unitEconomics`
  and only missing its render), `engagedLeads` has no backing figure anywhere: no `CASH_INPUTS` entry,
  no field on `CashUnitEconomics`/`CashSolvency`, no tile. A deeper gap than B4's, never raised by any
  review on this plan and out of scope for this wave. Flagged here rather than silently left for a
  future reviewer to re-discover.
- **`latestScorecardRow` reads up to 200 `evaluations` documents per call, and the Business tab calls
  it four times per load — the one PERFORMANCE regression this feature introduced.** Before B1 it was
  a single `.first()`; the fix needed to skip rows that carry no usable Scorecard (a `document-review`
  row, or one whose `scorecard.financials` is absent), and a filtered scan cannot be expressed as one
  indexed read, so it became `.take(200)` + `.find(hasUsableScorecard)`.

  The multiplier is the part to watch. `cash.unitEconomics` calls it twice on its own — once inside
  `inputStatesFor` and once directly for the raw `Scorecard` — and `cash.inputs`, `cash.solvency` and
  `cash.saveInput` each call it again. One Business-tab load therefore issues roughly **800 document
  reads**, and `evaluations` rows are not small: each carries `findings[]` with citation excerpts plus
  a full `scorecard` snapshot. For a tenant with a long evaluation history this will measurably slow
  the page and, in the worst case, approach Convex's per-query byte limit — which surfaces as a thrown
  query, and a throw on this page is what B1 proved takes the whole Finance route down.

  It has NOT been measured against a real tenant; the concern is analytic, from reading the call graph.
  **Measure before optimising.** The cheapest real fix is to stop calling it more than once per request
  — thread one resolved row through `inputStatesFor` and its caller instead of re-querying — which
  removes the 4× multiplier without touching the scan. Narrowing the scan itself (a `by_tenant_framework`
  index, or storing a pointer to the tenant's current Growth-OS row) is the deeper fix and needs a
  schema change. Do not simply lower the `200`: that silently reintroduces B1 for any tenant whose
  usable row sits further back than the new bound, and B1's failure mode was a page-wide crash.
