# Playbook: Guardrails (the spend rails, the kill switches, the redaction choke point)

Last verified: 2026-09-12 — internal `authoringProbe.prepare` creates one native empty Agent
thread/plan and one existing golden envelope for an already-owner identity, an explicit cap
of 1–1000 cents and a single-use authorization hash. It grants no ownership and invokes no model.
The ordinary authenticated cockpit claims at most two serialized root turns for that exact
tenant/thread before provider work. Unknown, failed, expired, closed or exhausted probe state
never falls through to unbudgeted execution. Root controls are append-only reserved audit refs;
money remains on the existing ledger with its unchanged 500-call limit and pre-call ceilings.
Closure checks root completion and the exact probe-thread plan inventory; unrelated owner
documents/work cannot block it. Synthetic golden tenants retain their full pending-work scan.
Pack/vertical starts, recipient-picker re-entry, approval and intake on the registered thread
refuse rather than bypassing the two text-turn budget, including after closure or expiry.
Read-only `authoringProbe.inspect` reports containment refusal counts separately; any such
refusal is budget containment, not evidence that the ordinary policy rejected the request.

Last verified: 2026-09-12 — verified Tavily Free accounts use
`GOLDEN_TAVILY_BILLING=free` with `GOLDEN_TAVILY_CREDIT_USD=0`. Absent billing mode preserves
the existing positive standard-rate contract; absent/blank rates never imply Free. The trusted
attestation means the account remains Free with no paid overage enabled, not that credits are
unlimited. The same positive reservation ceilings, 500-call envelope limit and request bounds
remain in force; provider quota exhaustion must not trigger an upgrade. Even Free responses
must include finite nonnegative bounded `usage.credits`; missing usage retains the full hold.
Settlements preserve `evalTavilyCredits` separately from actual USD (zero for Free), and replays
must agree on both. Offline transport/ledger checks do not establish live billing acceptance.

Last verified: 2026-09-10 — native evaluation budgets now have an append-only terminal closure.
`closeEvalBudget` refuses unsettled reservations or recorded breaches and writes one
`eval_budget_closed` adjustment. New reservations consult that same durable marker; closing and
reserving race through the existing transactional indexes. Closure is idempotent, does not erase
accounting, and cannot turn an unknown provider charge into a settled result. Native semantic
evidence issuance requires the closed ledger and rereads its exact case charges.

Last verified: 2026-09-11 — the golden runner opens one envelope before corpus embedding and
carries it through executive, nested drafting, dispatch, RAG, ingest and Tavily requests. The
closed provider descriptor computes a worst-case pre-call reservation; unknown charges retain
their hold. Golden envelopes accept only one `eval-<run>` family and refuse opening without
operator-verified `GOLDEN_OPENROUTER_BILLING=standard` and a positive
`GOLDEN_TAVILY_CREDIT_USD <= 0.008`. These environment values attest independently checked
account terms; setting them is not billing evidence. Provider response billing metadata must also
agree. Source revision, native closure and settled ledger are required before passing evidence.
Live billing/semantic acceptance remains unobserved. Recurrence and WORM remain deferred.
Golden closure additionally scans the isolated run's durable plans/documents (at most 256 plans
and 32 documents). Collecting memo work, running or unknown workflow state, unfinished linked
ingest and incomplete inventory refuse closure. A retry of that free closure check is safe;
replaying the paid workflow is not a recovery step.

> Last verified: 2026-09-10 — G17 notification regression: the expiry scan uses an exact indexed
> tenant/kind/read existence check instead of inspecting only 50 unrelated unread messages.
> `scaleConstants.test.ts` seeds 60 unrelated notifications before the existing warning and checks
> repeated scans preserve that warning while still raising one for a second tenant.

> Last verified: 2026-09-06 (39-01 — `@pikar/cost` gains `WEB_PAGE_READ_USD_TAVILY` = a fifth of the search proxy (Tavily /extract bills 1 credit per 5 URLs) and `pageReadFeeUsd()`; `runAgentLoop` adds `pageReads × pageReadFeeUsd()` to the SAME `web_search_fee` row as the searches, charged per call (over-count is the fail-safe direction). No new rail, no new kind.)
>

> Last verified: 2026-09-05 (25.3-01 — **THE THREE DEPLOYMENT-WIDE CEILINGS ARE ENV-DRIVEN (G17).**
> `DEPLOYMENT_BUDGET_CENTS`, `DEPLOYMENT_MEDIA_BUDGET_CENTS`, `DEPLOYMENT_INGEST_BUDGET_CENTS` are read
> at module load through `envCents(raw, fallback)` — a positive integer replaces the compiled $50 /
> $100 / $250 per day; anything else (unset, "0", "12.5", a word) keeps the fallback and never reads as
> zero. The rate-limiter windows, the Finance rails view and the ingest refusal all take the same
> value. Under the free-beta decision these ARE the spend ceiling, set from the deployment env.
> Sharding the three deployment counters is deferred with the ceiling named in a `ponytail:` comment
> (a sharded fixed window is approximate; ~10k users is honest unsharded).)
>
> Last verified: 2026-09-05 (33.2-05 — two routed transcription pins beside TRANSCRIPTION_PRICING:
> `OR_TRANSCRIPTION_MODEL` (whisper-1) and `OR_INTAKE_TRANSCRIPTION_MODEL` (gpt-4o-transcribe). No
> PRICING rows — transcription is billed per second/minute, and OpenRouter's body carries the
> figure the callers record; `priceTranscription` remains the fallback. Measured: cost 95/95.)
>
> Last verified: 2026-09-05 (33.2-03 — **`MEDIA_MODEL` = `OR_RESEARCH_FALLBACK_MODEL` (gpt-4.1-mini),
> `MEDIA_FALLBACK_MODEL` = `OR_DEFAULT_MODEL` (gpt-4o-mini): the pin moved on the bake-off rule.**
> ADR-032, `33.2-BAKEOFF.md`. The inequality landed with the pin: `cost.test.ts` now holds
> `MEDIA_MODEL !== DEFAULT_MODEL` AND `MEDIA_MODEL !== MEDIA_FALLBACK_MODEL` (a rollover must change
> the model), both priced, fallback off the cheap tier. Still NO media PRICING row: both ids already
> have one (the computed-key collapse rule). The two premium candidate constants and their rows
> left with the bake-off — the ids and prices live in the ADR. Bill: a storyboard is ~$0.008,
> 2.6x the old $0.003. Measured: cost 95/95.)
>
> Last verified: 2026-09-04 (33.2-01 — **A FOURTH MODEL LANE: `MEDIA_MODEL` / `MEDIA_FALLBACK_MODEL`,
> shipped ALIASED to `OR_DEFAULT_MODEL` / `OR_RESEARCH_FALLBACK_MODEL`, so this commit moves no bill.**
>
> The storyboard turn (`media-director`) fell through `runSpecialistTurn`'s skill-name lookup to
> `DEFAULT_MODEL` — the VOLUME pin, by cost.ts's own paragraph — while carrying the heaviest rule
> load of any single turn. It now has its own pair, for the `PACK_MODEL` reason (one lane must not
> silently move another). NO PRICING row of its own while it aliases an id that already has one
> (the computed-key collapse rule); `cost.test.ts` holds both pins priced and the fallback off the
> cheap tier. Deliberately NO `MEDIA_MODEL !== DEFAULT_MODEL` inequality yet — 33.2-03's bake-off
> (`.planning/phases/33.2-*/33.2-PRD.md` L3/L4: four candidates, a decision rule fixed BEFORE the
> run, repin only at >= 3 of 24 passes over the baseline) moves the pin or records that it stays,
> and the inequality lands with the pin. Measured: cost 95/95.)
>
> Last verified: 2026-08-26 (**A THIRD MODEL LANE: `PACK_MODEL` / `PACK_FALLBACK_MODEL`, pinned to
> `or/openai/gpt-5.6-luna` + `or/openai/gpt-4.1-mini`, and the A/B was run in BOTH directions before
> the pin was kept.**
>
> `DEFAULT_MODEL` is a VOLUME pin — ingest, classification, routing — where capability buys nothing
> and the cost caps are calibrated around $0.15/$0.60. A workflow-pack run is the opposite: one
> deliberate turn whose output a human reads, which is the same argument that moved `RESEARCH_MODEL`
> on 2026-08-25. The lane is derived from the SKILL NAME in `runSpecialistTurn`
> (`isWorkflowPackSkill`), beside the model pin and the step budget, exactly where the file already
> says such decisions belong.
>
> **MEASURED, same body (v9), same corpus, same scorer, `--repeat 3` each way:**
>
>                           gpt-4o-mini      gpt-5.6-luna
>       stable-pass                   1                 3
>       stable-fail                   1                 0
>       FLAKY                         3                 2
>       $ / 3 runs                0.1701            0.3496
>
> **Zero stable failures is what decided it** — every case is reachable on luna, so an all-green run
> exists to be had, while gpt-4o-mini could not save the deliverable at all on three different cases.
> `pack-business-pulse` re-certified 5/5 on the new lane for $0.0089 (it was $0.0044), so the one
> pack with evidence stayed certified at 2x a trivial cost.
>
> **THE CLOCK MOVED WITH IT.** `callTimeoutMsFor` now gives every pack the RESEARCH timeout (180 s),
> not the cockpit's 45 s. Not belt-and-braces: luna took 82.9 s on one case and 30-65 s routinely, and
> `pack-business-pulse` v2 had already blown the 45 s wall the moment its body added one tool call.
> Without this the lane would fail for the clock rather than for the answer.
>
> **A GAP, NAMED:** `hasPassingPackEvalEvidence` does NOT compare the evidence row's model to the
> lane's pin. The runner refuses to WRITE a row whose executed model is not `EVAL_MODEL`, so every
> row is honest when written — but a later pin change silently keeps old rows valid. Moving either
> pack pin means re-running every certified pack, and nothing enforces that yet.
>
> PREVIOUS: 2026-08-26 (**THE PINS MOVED TO OPENROUTER AS A ROUTE-ONLY CHANGE AT IDENTICAL
> RATES, PLUS ONE DELIBERATE QUALITY UPGRADE ON RESEARCH. TWO PRICING ROWS THAT WERE WRONG BY A WHOLE
> GENERATION WERE CORRECTED.** `DEFAULT_MODEL` = `or/openai/gpt-4o-mini` (0.15/0.60, unchanged rate),
> `CHEAP_MODEL` = `or/openai/gpt-4.1-nano` (0.10/0.40, unchanged), `RESEARCH_FALLBACK_MODEL` =
> `or/openai/gpt-4.1-mini` (0.40/1.60, unchanged), and **`RESEARCH_MODEL` = `or/openai/gpt-5.6-luna`
> (0.20/1.20) — the one pin that actually moves.** OpenRouter's rates for these ids are IDENTICAL to
> direct OpenAI's, so nothing downstream recalibrates: this changes the FUNDING DOOR, not the economics. The OpenAI account was exhausted; OpenRouter is now the funded door and one
> balance backs every pin, which is what finally makes cross-vendor fallback safe (see the
> 2026-08-07 incident block below — that precondition disappears rather than being managed).
>
> **THE PRICING BUG, WHICH WAS LATENT AND HAD JUST GONE LIVE.** `[GEMINI_MODEL]` carried
> `0.3/2.5` and `[GEMINI_CHEAP_MODEL]` carried `0.1/0.4` — those are gemini-**2.5**'s published
> rates sitting on gemini-**3.5** ids. Real rates, read off OpenRouter's live `/models`: 1.5/9.0 and
> 0.3/2.5. That is a **5x and 6.25x UNDER-draw**, the exact silent under-billing this file's own
> comments exist to prevent, and the block above even claimed the rows were "deliberately rounded UP
> where uncertain" — they were rounded DOWN. Harmless while nothing selected them; **live the moment
> `CHEAP_MODEL` and `RESEARCH_FALLBACK_MODEL` were pointed at them.** Both rows corrected.
>
> **A gpt-4.1 DEFAULT WAS TRIED THE SAME DAY AND REVERTED ON EVIDENCE — do not re-derive it.**
> `business-pulse` passed **5/5 on BOTH**: gpt-4.1 at $0.0665, gpt-4o-mini at $0.0044. **15x the cost
> for an identical score** — the 5/5 came from the v2 body fix (34c42aa), not from the model. It also
> broke calibration the rails depend on: folder-ingest estimates rose ~7x (a 3-file folder 3c -> 21c;
> one job reached 17,507c and went OVER its cap) and **13 backend tests reddened**, the same shape as
> the ox-alpha `estCents: 0` breakage recorded below. GRDL-03's gap would have widened 1.5x -> 13x,
> and at ~$0.14/turn `DAILY_BUDGET_CENTS = 500` buys ~36 turns/day against ~450 today.
> **THE LESSON, and it generalises: `DEFAULT_MODEL` is a VOLUME pin** — ingest, classification,
> routing — where extra capability buys nothing measurable and a 13x rate breaks caps that were
> calibrated around $0.15/$0.60. "Quality over cost" is a decision to make PER LANE, on the pins
> whose output a human actually reads. That is why `RESEARCH_MODEL` moved and the default did not.
>
> **HOW THE MODELS WERE CHOSEN — measured 2026-08-26, not selected on price.** Governance suite
> (forbidden-tool discipline, honest-partial, injection resistance, near-miss fabrication, buried
> rule + strict JSON) plus a research-memo audit graded by a blind judge that was not a candidate.
> Every frontier model scored 10/10 on governance, so **governance stopped discriminating** and the
> decision fell to latency and faithfulness. `google/gemini-3-flash-preview` was the FASTEST model
> measured (4.7 s) and is **rejected**: asked for a memo it invented "80%+ gross margin" and "120%+
> NRR" against retrieved evidence saying 74% and 104%. A short refusal test cannot see that; only a
> long-form audit can. Price predicted nothing — `gpt-5.6-sol` ($2/$10) was 4x slower than
> `gemini-3-flash-preview` ($0.50/$3) and no more capable.
>
> PREVIOUS: 2026-08-25 (**THE OX-ALPHA TRIAL IS OVER: `DEFAULT_MODEL` AND `RESEARCH_MODEL` ARE
> BACK ON `openai/gpt-4o-mini`. THE REASON IS NOT THE MODEL'S QUALITY — IT IS THAT A $0 PIN DISABLES
> TWO SAFETY PROPERTIES, SILENTLY.**
>
>   1. **GRDL-03's downgrade becomes unreachable.** `chooseModel` tries [DEFAULT_MODEL, CHEAP_MODEL]
>      in order and a free model fits every positive budget, so the cheap branch is never taken.
>   2. **Folder ingest reserves NOTHING.** `estimateFolderCents` -> `perDocumentUsd` is
>      `EMBED_USD_PER_MTOK + modelUsd(DEFAULT_MODEL)`, and `EMBED_USD_PER_MTOK` is already 0. A free
>      default made the whole term 0, so every document estimated at 0 cents and the "never starve the
>      cockpit" isolation stopped isolating. Eight guardrails tests read `estCents: 0`.
>
> **THAT SECOND ONE IS THE INTERESTING DEFECT, BECAUSE THE CODE ALREADY FORBADE IT IN WORDS.**
> `modelUsd` throws for a model ABSENT from `PRICING` and says why — "estimating it at 0 would reserve
> nothing and strand the folder mid-run". A model priced AT zero is a different code path with an
> IDENTICAL outcome, and it walked straight through the guard. `ok(0)` and `Err(unknown_model)` are
> genuinely different (cost.test.ts pins that), but here the distinction did not help: zero is the
> harmful value however it arrives. Floored shut in `ingestEstimate.ts`; see `docs/playbooks/vault.md`.
>
> **WHAT STAYS.** Everything that makes ox-alpha reachable: `OX_ALPHA_MODEL`, its `PRICING` row, the
> `stealth/` branch in `resolveModel`, `@openrouter/ai-sdk-provider`, the `OPENROUTER_API_KEY` manifest
> row. Re-running the trial is: point these two pins at `OX_ALPHA_MODEL` and move `EVAL_MODEL` in BOTH
> runners with them.
>
> **THE FALLBACK PINS STAY ON GEMINI** (`CHEAP_MODEL` = flash-lite, `RESEARCH_FALLBACK_MODEL` = flash).
> That is the one unambiguous win of the trial and it costs nothing: the Gemini and OpenAI cheap rows
> carry IDENTICAL prices (0.1 / 0.4 per MTok), so no budget, reserve, ceiling or ledger number moves —
> while the OpenAI account is the exhausted one, so an eligible failure that rolled over to it turned
> a recoverable hiccup into a hard failure carrying someone else's billing message.
>
> TWO TESTS WERE KEPT FROM THE TRIAL RATHER THAN REVERTED, because both encode something that was NOT
> obvious before it cost a day: that priced-at-zero and unpriced are different, and that GRDL-03's
> downgrade branch is only reachable while the default costs something (asserted directly, so a future
> repoint reds with the reason attached instead of leaving a vacuous test over a dead path).
>
> **FULL BACKEND SUITE 2475/2475, 100/100 FILES** — green, and one better than the pre-trial baseline.)

> Last verified: 2026-08-25 (**A 503 DELIVERED INSIDE AN HTTP 200 WAS CLASSIFIED AS "OUR BUG" AND
> NEVER ROLLED OVER. FIXED IN `isFallbackEligible`, WHICH THIS PLAYBOOK NOW WATCHES.**
> `packages/core/src/fallback.ts` (+ its test) were added to `watch.json` under this playbook: the
> file's own header calls itself GRDL-05, so this was always its home and nothing covered it.
>
> **THE SHAPE.** OpenRouter reports UPSTREAM provider failures inside an HTTP **200** body —
> `{"error": {"code": 503, "message": "The service is currently unavailable"}}` — not as a 5xx status.
> `@openrouter/ai-sdk-provider` faithfully throws `APICallError` with `statusCode: 200`, and the AI
> SDK's default rule (retryable iff 408/409/429/>=500) then computes `isRetryable: false`. The
> classifier was CORRECT about everything it could see and still reached the wrong answer.
>
> **CONFIRMED BY ABSENCE, WHICH IS THE CHEAPEST PROOF AVAILABLE HERE:** three consecutive workflow-pack
> runs died on that error and the `audit` table contained NOT ONE `llm.fallback` row. The cross-vendor
> failover was not slow or unlucky — it never ran.
>
> **THE FIX READS A NUMBER, NEVER TEXT.** `bodyDeliveredRetryable` applies the SAME 408/409/429/>=500
> rule to `data.error.code` / `data.code` (both shapes, because providers differ on whether `data` is
> the error object or the envelope). It is consulted ONLY after `isRetryable` is already false, so it
> can only ever widen. The §4 promise at the top of that file — never read error message text — is
> intact and was the binding constraint on the design.
>
> **THREE WAYS IT REFUSES TO OVER-WIDEN**, each pinned by a test:
>   • `statusCode !== 200` returns false, so a body code can never PROMOTE a genuine 4xx into a
>     cross-vendor retry. **This guard was untested until mutation testing found it** — deleting it
>     left all twenty other assertions green.
>   • A body-delivered 400/401 is still NOT retryable, so a config error dead-letters instead of
>     burning a second vendor. (`reasoning: {enabled:false}` returns exactly that from this provider.)
>   • A non-numeric code (`"insufficient_quota"`) is NOT retryable — guessing from an unknown string is
>     how a billing failure becomes an infinite cross-vendor retry, which is the 2026-08-07 lesson in a
>     new costume.
>
> fallback.test.ts 9 -> 21 assertions. MUTATION-VERIFIED three ways: disabling the helper, deleting the
> status guard, and widening it to "any body error is retryable" each turn the suite RED.
>
> **WHAT THIS DOES NOT FIX.** It makes the rollover FIRE; it does not make the fallback succeed. The
> fallback pins are Gemini and its free tier caps `generate_content` at 20 requests/minute/model, so a
> dense run that rolls over often will meet that ceiling instead. And a pack whose PRIMARY is
> unavailable for the whole run still costs the wall clock of every failed attempt before the fallback
> gets its turn — see `docs/playbooks/workflow-packs.md` on `agent_timeout`.)

> Last verified: 2026-08-24 (ox-alpha trial — **A FREE `DEFAULT_MODEL` SILENTLY RETIRES MOST OF THIS
> PLAYBOOK'S SUBJECT MATTER. READ THIS BEFORE PINNING ANY $0 MODEL.**
>
> `OX_ALPHA_MODEL = "stealth/ox-alpha"` was added with a REAL `PRICING` row of 0/0 — an honest zero,
> not an omission. The distinction is load-bearing and is now pinned by a test: a priced-at-zero model
> returns `ok(0)` from `priceUsage`, an UNKNOWN model returns `Err(unknown_model)`. Only the second is
> the silent-under-draw failure this file exists to prevent.
>
> **MEASURED CONSEQUENCE, AND IT IS BIGGER THAN IT LOOKS.** Pinning `DEFAULT_MODEL`/`RESEARCH_MODEL`
> at the free id turned 24 backend tests red (baseline on the same six files: 1 pre-existing failure;
> with the pin: 25). Nothing in the product breaks — the ≥1-cent floor in `chooseModel`
> (`Math.max(1, …)`) keeps the daily rail drawing down — but every assertion that derives cents from
> `DEFAULT_MODEL` degenerates: folder-ingest reserve/refund, the shared root-request cost envelope,
> cost-ceiling partial-output markers, ledger parity, and GRDL-03 itself. **GRDL-03's downgrade branch
> becomes UNREACHABLE**: `chooseModel` tries `[DEFAULT_MODEL, CHEAP_MODEL]` in order and a free model
> fits every positive budget, so it never reaches the cheap pin. `cost.test.ts` now records that
> dormancy explicitly rather than asserting a downgrade that cannot happen — and carries the
> instruction to restore the CHEAP_MODEL assertion on the same day the pin reverts, so the revert
> cannot ship with an untested rail. THE 24 RED TESTS WERE NOT REWRITTEN TO AGREE; the recommendation
> is a narrower per-call-site seam instead of a global repoint.
>
> **THE FALLBACK PINS MOVED TO GEMINI, AND THAT PART IS UNAMBIGUOUSLY CORRECT.** `CHEAP_MODEL` →
> `gemini-3.5-flash-lite`, `RESEARCH_FALLBACK_MODEL` → `gemini-3.5-flash`. **NO COST NUMBER MOVES:**
> `GEMINI_CHEAP_MODEL` and `OPENAI_CHEAP_MODEL` carry identical rows (0.1 / 0.4 per MTok). The reason
> is diagnostic, not economic, and it was measured: with the fallback on the exhausted OpenAI account,
> every workflow-pack eval died with `You have no credits remaining` — an error about the WRONG
> VENDOR. ox-alpha had failed first (`Provider returned error`, 3 retries), `isFallbackEligible`
> rolled it over, and only the billing message reached the caller. That is the 2026-08-07
> "failures become UNDIAGNOSABLE" inversion reproduced exactly. With a live fallback the same pack ran
> all 5 cases to completion. THE KNOWN CEILING: the Gemini free tier caps `generate_content` at 20
> req/min/model — survivable for a fallback that only absorbs flakes, NOT for a primary.)

> Last verified: 2026-08-12 (production release-gate formatting pass — the watched cost table had
> only an extra blank line removed; model pricing, search fees, budget math, and kill-switch
> behavior are unchanged.)

> Last verified: 2026-08-08 (26-07 + its follow-up sweep — the spend ledger rides alongside every
> reasoning and ingest limiter movement, and **all twelve `recordSpend` call sites now pass a
> stable correlation**; see the Phase 26 section below for the per-site table and the discriminator
> each one needs.)
>
> Previously verified: 2026-08-07 (**a second LLM vendor entered the price table, and this playbook
> started watching that table.** `packages/cost/src/cost.ts` was watched by NO playbook until now —
> a gap worth naming, because that file is where a model becomes billable: `PRICING` is keyed on the
> full model id, an id missing from it makes `priceUsage` return `unknown_model`, `recordModelSpend`
> then records 0, and the run draws down NOTHING against `DAILY_BUDGET_CENTS`. **A free-looking model
> is the failure mode this rail exists to prevent**, so the table is now under the same watch as the
> rails it feeds. Added to `watch.json` under this playbook.
>
> Gemini rows landed with their constants (`GEMINI_MODEL`, `GEMINI_CHEAP_MODEL`), obeying the file's
> own standing rule that a model constant and its `PRICING` row ship in the same commit.
>
> **THE PINS ARE NOW CROSS-VENDOR, AND THAT IS THE WHOLE FEATURE.** Owner decision 2026-08-07: the
> aim is NOT to replace OpenAI but for both vendors to alternate, so work continues when either runs
> out of credit. `DEFAULT_MODEL` = `google/gemini-2.5-flash`, `CHEAP_MODEL` = `openai/gpt-4.1-nano`.
> Because `CHEAP_MODEL` is already the failure-fallback target and `runAgentLoop` already runs
> primary → fallback, pointing it at the OTHER vendor turns the shipped mechanism into provider
> failover with **no new retry layer, no router and no config**. A same-vendor fallback structurally
> cannot do this — an exhausted key just fails twice.
>
> **The honest limit: failover only fires on a FALLBACK-ELIGIBLE error.** `isFallbackEligible`
> returns `APICallError.isRetryable`, so an out-of-credits 429 rolls to the other vendor, but a 403
> (Vertex billing not enabled) does NOT — a config error stays a config error rather than silently
> spending the other vendor's money. Gemini leads only because the OpenAI account is the one at $0;
> the pair is symmetric and swapping the leader is a two-line edit.
>
> **`GOOGLE_SEARCH_CALL_USD` (0.035) is a THIRD-hand estimate and ~3.5x OpenAI's hosted-search fee.**
> `searchFeeUsd(model)` picks the rate from the model that ACTUALLY ran (`m.id`, not the pin — the
> fallback may be executing) and fails safe to the higher rate on an unrecognised prefix.
>
> **Cost went UP, not down.** `gemini-2.5-flash` is 2x `gpt-4o-mini` on input and 4.2x on output.
> This surfaced as five red tests: the folder-ingest fixtures had treated files and cents as the same
> number because one 1 KB file cost exactly 1 cent. It now costs 2, so `CENTS_PER_FILE` is pinned as
> a literal in both `guardrails.test.ts` and `vaultFolders.test.ts` (a future rate change SHOULD
> redden them). Deriving it from `PRICING` would make those tests agree with themselves.
>
> **THE GEMINI RATES ARE UNVERIFIED AGAINST A LIVE PRICE PAGE** and are pinned from published-rate
> knowledge, rounded UP where uncertain. The direction is deliberate and asymmetric: over-pricing
> throttles a tenant early (fail-safe), under-pricing silently under-draws the rail (the failure
> above). Verify against Google's Vertex pricing page and correct the two rows before real spend.
> DIFF-REVIEWED ONLY: `pnpm --filter @pikar/cost test` 56/56 and backend typecheck 0 errors were
> run; no live Gemini call has ever been made from this repo.
>
> PREVIOUSLY: 2026-08-03 (15.3-03 - **the THIRD rail: folder ingest.** Two new windows
> (`ingestSpendCents` $25/tenant, `deploymentIngestSpendCents` $250 keyless), a whole-folder
> `reserveFolder`/`settleFolder` pair whose refund is a CLAMPED negative `count`, and an
> OPTIONAL `rail` selector on `preCall`/`recordSpend`. Every pre-15.3 call site is unchanged:
> the argument is absent there, and absent means exactly today's behaviour.)
>
> PREVIOUSLY: 2026-08-02 (20-09 - **`mediaRemainingCentsInner` extracted as a plain function**,
> so a `tenantQuery` can read today's remaining media budget: a Convex query cannot `runQuery`, and
> the canvas must show the remaining budget beside the itemised estimate (D7). The `internalQuery`
> face is unchanged and now delegates to it - the `reserveJobInner` / `reserveJob` split, for the
> same reason. NO rail behaviour changed: same two windows, same `Math.min`, same clamping at 0.)
>
> PREVIOUSLY: 2026-08-02 (created by 20-04 to close a standing §9 gap — `guardrails.ts` was in
> NO playbook's watch prefix, recorded in 20-RESEARCH §11.3 and never assigned. It is now covered
> here.)
> Build history: `.planning/phases/03-guardrails/`, `.planning/phases/22.1-*/` (22.1-02, the
> per-tenant keying), `.planning/phases/20-media-canvas/` (20-04, the media rail) ·
> Related ADRs: ADR-011 (media provider + separate cost cap)

## Purpose

`packages/backend/convex/guardrails.ts` is the **choke point every spend passes through.** It
answers three questions before any provider is called: *is the system stopped?* (kill switches),
*has this tenant any money left?* (spend windows), and *has the text been redacted?* (the PII scan
that must precede a model call). A governed refusal here is a **returned value**, never a throw —
an expected rejection is not a dead-letter failure.

**Why this file has its own playbook:** it is shared by two subsystems that must not be edited as
if they were one. The LLM rail serves the cockpit; the media rail serves Phase 20. Assigning
`guardrails.ts` to either subsystem's playbook would mean every change to one rail demands
verification of the other's playbook — claiming a review of a diff nobody read.

## Key files

| Path | Role |
|---|---|
| `packages/backend/convex/guardrails.ts` | the module: rails, switches, `prepare` / `preCall` / `recordSpend`, the two remaining-budget readers |
| `packages/backend/convex/guardrails.test.ts` | unit proof of both LLM rails against the REAL rate-limiter component |
| `packages/backend/convex/media.test.ts` | unit proof of both MEDIA rails, and that the two pairs never share |
| `packages/backend/scripts/run-smoke-guardrails.mjs` | `pnpm smoke:guardrails` — the end-to-end prepare/preCall-through-the-pipeline path against a live deployment |
| `packages/cost/src/cost.ts` · `packages/cost/src/media.ts` | the pure estimators. `guardrails.ts` never prices anything itself |

## The six windows

All six are named windows on **ONE** `RateLimiter` instance. A second `RateLimiter` would be a
second component mount for zero gain — add a name, not an instance.

| Window | Rate | Key | Consumed by |
|---|---|---|---|
| `dailySpendCents` | `DAILY_BUDGET_CENTS` = 500 | `tenantId` | `recordSpend`, AFTER the call |
| `deploymentSpendCents` | `DEPLOYMENT_BUDGET_CENTS` = 5,000 | **keyless** | `recordSpend`, AFTER the call |
| `mediaSpendCents` | `MEDIA_DAILY_BUDGET_CENTS` = 1,000 | `tenantId` | `media.reserveJob`, BEFORE the call |
| `deploymentMediaSpendCents` | `DEPLOYMENT_MEDIA_BUDGET_CENTS` = 10,000 | **keyless** | `media.reserveJob`, BEFORE the call |
| `ingestSpendCents` | `INGEST_DAILY_BUDGET_CENTS` = 2,500 | `tenantId` | `reserveFolder` BEFORE, `recordSpend(rail)` DURING, `settleFolder` credits back |
| `deploymentIngestSpendCents` | `DEPLOYMENT_INGEST_BUDGET_CENTS` = 25,000 | **keyless** | same three |

Worst-case daily exposure: **$50 LLM + $100 media + $250 ingest = $400** deployment-wide, **$40 per
tenant.** The keyless ceilings are what bound it; per-tenant keying alone makes exposure
`N × budget`, unbounded in N. Each rail's deployment ceiling is **10× its per-tenant window** —
one ratio across all three rails.

## Invariants — what must never break

- **The two rails NEVER share a window, in either direction.** ADR-011 and D10. `dispatch.ts`'s
  `ENVELOPE_FRACTION` takes its 25% out of the LLM rail *specifically*, so folding media spend in
  would silently shrink every sub-agent envelope. *Enforced:* `media.test.ts` — "THE RAILS NEVER
  SHARE", asserted in both directions.
- **`check` does not consume; `limit` does.** Both inside ONE Convex mutation is ONE serializable
  transaction. *Enforced:* `media.test.ts` concurrency test, observed RED when the check is resized
  or the limit is moved out.
- **Every keyed window's call sites pass `{ key: tenantId }`.** A call without a key silently shares
  one bucket across tenants — the exact bug 22.1-02 fixed. *Enforced:* `guardrails.test.ts` "tenant
  A exhausting its day does not refuse tenant B" and the media twin.
- **`reserve: true` on consumption, always.** The window goes NEGATIVE rather than under-counting,
  so the NEXT check fails closed. *Consequence:* every reader must clamp `>= 0` **before** any
  `Math.min`, or one negative rail zeroes everyone's budget. *Enforced:* the "clamps to 0" tests in
  both suites.
- **Governed stops RETURN a discriminated result; only bugs throw.** A missing row throws. An
  exhausted budget returns `{ ok: false, reason }`. Mixing the two turns an expected refusal into a
  dead-letter entry (03-RESEARCH anti-pattern 1).
- **Redact before you write, and before any model call.** `prepare` destructures ONLY `safeText` +
  counts from the scan — the raw-PII field must never appear in this file. `getSafeTextByHash`
  throws when `safeText` was never written, so a model call structurally cannot obtain raw goal
  text. *Enforced:* the 03-04 static scan.
- **Default-on-read: a missing `guardrailConfig` row means every switch is OFF.** Zero seed, zero
  migration. A newly added switch must be `v.optional` in the schema so pre-existing rows read OFF
  too. *Enforced:* `media.test.ts` "a missing guardrailConfig row reads BOTH switches OFF".
- **The kill switches are INDEPENDENT levers.** Pausing paid media generation must not pause the
  email cockpit, and vice versa. But a consumer MAY check both — `media.reserveJob` does, because
  an all-stop is an all-stop. *Enforced:* `media.test.ts` "setMediaKillSwitch … does NOT touch the
  global switch".
- **Every exported reader declares an explicit `Promise<number>` return type.** An inferred return
  type collapses the generated API to `any` (13-01 shipped 90 `apps/web` errors that way).

## The two consumption shapes — and when each is legitimate

This is the single most important distinction in the file, and getting it wrong is a money bug.

| | LLM rail | Media rail |
|---|---|---|
| Shape | `check` in `prepare` → **consume in `recordSpend` afterwards** | `check` **and** `limit` in the SAME mutation, **before** the first POST |
| Why it is safe | LLM calls in a turn are **serial**, and an overshoot is **cents** | 13+ provider jobs are submitted back-to-back and land minutes apart |
| What the other shape would cost | — | post-hoc recording lets every job pass against a window that had room for one. *An LLM overshoot is cents, a media overshoot is dollars* |

**Do not "unify" these two shapes.** The asymmetry is deliberate and is the whole content of D10.

## How to change safely

**Adding a new rail** (the 20-04 recipe, in order):
1. Two exported constants — per-tenant and a keyless ceiling at **10×**. Never alias an existing
   rail's numbers.
2. Two named windows on the existing `rateLimiter`. Comment the keyless one with *why* it is
   keyless, so nobody deletes it as redundant.
3. A `Promise<number>` reader in the `remainingDailyCents` shape: clamp each rail `>= 0` **before**
   the `Math.min`.
4. A test asserting the new rail does not move the old ones **and** the old ones do not move it.
   Both directions, or the test is half a test.

**Adding a kill switch:** `v.optional` in `schema.ts`, an entry in `DEFAULT_CONFIG`, and a setter
that is `setKillSwitch`'s upsert verbatim. Put the operator command in the doc comment.

**Changing a budget number:** it is a one-line constant edit — but re-read the consumers first.
`dispatch.ts` sizes sub-agent envelopes off `remainingDailyCents`, so lowering the LLM rail shrinks
every envelope proportionally.

**Never** add media spend to `dailySpendCents`/`deploymentSpendCents`, and never add token spend to
the media pair. See the first invariant.

## How to verify

```bash
# unit, $0, no deployment needed — both rails, both directions
pnpm --filter @pikar/backend test -- guardrails
pnpm --filter @pikar/backend test -- media

# end-to-end, needs a live deployment: prepare/preCall through the real pipeline
cd packages/backend && pnpm smoke:guardrails          # 7/7 expected

# operator levers (from packages/backend — the convex CLI only resolves the deployment there)
npx convex run guardrails:setKillSwitch      '{"on":true}'   # stops EVERYTHING incl. media
npx convex run guardrails:setMediaKillSwitch '{"on":true}'   # stops paid generation ONLY
```

## Phase 15.3 — the folder-ingest rail

### 15.3-03 — the third window, the clamped refund, and the rail selector

**Why a third rail at all.** Until this plan the ENTIRE vault ingest path spent
`dailySpendCents` — the cockpit's $5 — at six sites (`vaultIngest.ts` gate + charge,
`vaultExtract.ts` gate + per-OCR-page charge, `vaultTranscribe.ts` gate + charge). So a folder
upload both **starved the agent the user relies on for actual work** and **could be refused
halfway by an unrelated cockpit turn.** A half-ingested folder is worse than a refused one,
because the agent then grounds on it confidently without knowing what is missing.

**$25/day per tenant**, deliberately the largest of the three per-tenant windows: a folder upload
is a bursty one-off onboarding-shaped event, not a daily habit. Owner decision; accepted
consequence is $40 worst-case per-tenant daily exposure. The number is calibrated to the
**scanned-PDF OCR path and to nothing else** — ~$0.005/page � a 50-page cap – which is the only
work in the pipeline that costs real money at folder scale. Extraction of text/office/text-layer
PDF is free, embedding is free today, graph extraction is ~$0.006/doc.

**The refund is a NEGATIVE `count`. That is arithmetic, not an API.**
`@convex-dev/rate-limiter@0.3.2` has no release/refund/credit call; `reserve: true` only permits
the value to go negative. `count` is an unvalidated `v.float64()` and the component computes
`value = min(state.value + rate * elapsedWindows, capacity) - count`, so a negative count credits
the window. The package is EXACT-pinned and pre-1.0 (CLAUDE.md §6) and **a bump can silently stop
refunds**, which is why `guardrails.test.ts` drives the real component rather than a mock. The
upgrade path is a real spend table, not a better credit call.

**THE MONEY BUG, and the two guards that close it.** The capacity clamp runs BEFORE the count is
subtracted, so a refund issued after the 24h fixed window rolls credits a window that never paid:
a live probe produced **2900 against a capacity of 2500.** Folder ingests routinely span the
reset. Both guards are needed and neither is sufficient alone:

1. **The clamp** — `clampRefundCents(unspent, value, capacity)` = `max(0, min(unspent, capacity -
   value))`, a pure function in `packages/vault/src/ingestEstimate.ts`, unit-tested there because
   reproducing a window roll inside convex-test means hand-editing the component's private rows.
2. **The rollover skip** — if the window rolled since `vaultFolders.reservedAt`, refund nothing.
   The clamp alone does NOT cover this: after a roll the window refills to capacity and then
   somebody else spends, which re-opens exactly *their* spend as headroom for our credit.

⚠ **`getValue` returns the STORED state, not a roll-forward.** With one shard its internal
`calculateRateLimit` call passes `now = state.ts`, so `elapsedWindows` is 0: a window that rolled
overnight with nothing written since still reports yesterday's value and yesterday's window start.
`settleFolder` therefore rolls the numbers forward itself using the component's OWN exported
`calculateRateLimit`, so a version bump that changes the arithmetic changes the guard with it.

**NEITHER ingest window is sharded, including the keyless one.** Sharding would buy OCC throughput
under the OCR fan-out, and it costs two things this rail cannot pay: `getValue` becomes a SAMPLED
APPROXIMATION (and the pre-flight card promises an honest "you have $1.10 left today" figure), and
`limit()` picks a shard AT RANDOM — so a clamp reading one value could credit a shard that never
paid, re-opening the bug above per-shard. The contention is not new: the same writers already hit
the unsharded `dailySpendCents`/`deploymentSpendCents` today.

**`check()` THROWS above capacity** (`Rate limit ingestSpendCents count 3000 exceeds 2500`), so
`reserveFolder` compares `estCents` against both ceilings **before touching the limiter.** Without
that ordering the locked plain-language refusal is a stack trace. `media.ts` never hits this only
because `MEDIA_JOB_CAP_USD` sits below its own window; ingest has no per-job cap.

**The deliberate divergence from the media rail.** `media.ts:279-282` says, in writing, *"no
refunds … refunding turns a rate-limiter window into a ledger."* This rail takes the opposite
position on purpose, and the difference is the SIZE of the over-reservation:

| | media | folder ingest |
|---|---|---|
| Over-reserves by | **cents** — every line priced from a known spec, whole job bounded by `MEDIA_JOB_CAP_USD` ($3.50) | **dollars** — the estimator cannot see page counts or audio duration before the bytes land, so every unprobed PDF is priced as a 50-page scan |
| Therefore | a ledger would not pay for itself | not refunding would charge a tenant $25 for a $2 folder |

Both sites state this from their own side. **Do not harmonise them in either direction** without
re-reading both reasons.

**The rail selector.** `preCall` and `recordSpend` take an OPTIONAL `rail?: "ingest"` plus
`reserved?: boolean`. Optional is mandatory, not stylistic: there are ~15 call sites, and
`dispatch.ts`'s sub-agent envelope sizing reads `remainingDailyCents` over the TOKEN window —
folding another rail in would silently resize every envelope. **Absent means exactly today's
behaviour, everywhere.** Reserved folder work checks **the kill switch ONLY**: the money is already
paid, so checking the ingest window would refuse the run precisely when its own reservation drove
that window to 0. It still *charges* the ingest window, because settle releases against a window
that must have seen the real cost.

**Operator check — the cross-window refund is NOT provable offline.** Every test here runs inside
one window; the case that actually manufactures budget only exists across a real day boundary. Do
not read a green suite as proof of it. Verify on a live deployment instead, from
`packages/backend`:

```bash
npx convex run guardrails:ingestRemainingCents '{"tenantId":"<id>"}'   # before the folder
# ... ingest a folder, let it complete, and let the 24h window roll ...
npx convex run guardrails:ingestRemainingCents '{"tenantId":"<id>"}'   # after
```

The number after the roll must be **at most `INGEST_DAILY_BUDGET_CENTS` (2500)**. Anything above it
means the clamp or the rollover skip regressed, and the tenant is minting budget.

## Phase 26 — the spend ledger rides alongside the limiter (FIN-01)

> Last verified: 2026-08-08 (26-07 — **every reasoning and ingest limiter movement now writes a
> matching `spendEvents` row, in the SAME transaction.**)

**TWO PLANES, AND THE ORDER OF AUTHORITY IS FIXED.** The limiter stays ENFORCEMENT truth: it decides
whether a spend may happen, and nothing in this section may be relaxed to make a report easier.
`spendEvents` is REPORTING/RECONCILIATION truth: it remembers what happened. A limiter is a gauge of
the present and structurally cannot answer "what did this tenant spend last Tuesday on the media
rail" — that is the whole reason for the second plane.

**The ledger write is a PLAIN FUNCTION CALL (`spendLedger.recordMovement`), never
`ctx.runMutation`.** The limiter movement and its row must commit or fail together; a second
transaction could leave the window moved with no record, and an append-only table has no backfill to
repair that. It writes the SAME `cents` variable the limiter consumed — a re-derived `Math.round`
would drift below the limiter on every sub-cent call and, at zero, be refused outright.

### Where each movement is written

| site | phase | rail | correlation | note |
|---|---|---|---|---|
| `prepare`, OK path only | `estimated` | reasoning | `req:<requestId>:prepare` | a governed stop is NOT a spend and writes nothing |
| `recordSpend` | `actual` | selector | caller's, else a per-execution nonce | see below |
| `reserveFolderInner`, success path | `reserved` | ingest | `f:<folderId>:<reservedAt>` | only when a `folderId` is supplied |
| `settleFolder`, inside `refundedCents > 0` | `refunded` | ingest | `f:<folderId>:<reservedAt>` | rebuilt from `folder.reservedAt` |

### The correlation policy, and why it is split in two

**A correlation that is too COARSE is worse than none.** It collapses a genuine second charge into
one row, so the ledger sits BELOW the limiter — and a missing movement is indistinguishable from
money that was never spent. A duplicate, by contrast, is findable by reconciling the two planes.
Under-count is therefore the unrecoverable direction, and every choice here breaks that way.

- **Replayable sites derive.** `prepare`, `reserveFolderInner` and `settleFolder` can each be
  re-entered without new money changing hands (the pipeline's regenerate loop; a re-entered workflow
  `onComplete`). They build a deterministic correlation from refs, so a second entry finds the
  stored row. **`settleFolder`'s CAS protects the MONEY; the correlation protects the RECORD** —
  they are two guards on two different things, and neither substitutes for the other.
- **`recordSpend` mints a nonce.** Its ~15 callers are all ACTIONS, where re-entry re-runs the model
  call, so the second charge is real money that MUST get its own row. A ref-derived correlation
  there would swallow a retry, a fallback model or a per-page OCR fan-out. A caller that genuinely
  IS replayable — a journaled workflow step, a webhook landing — passes its own stable
  `correlationId` and gets replay suppression.

**`reservedAt` is stamped ONCE** and used for both the returned value and the correlation. A second
`Date.now()` in `reserveFolderInner` would silently orphan every refund: settle rebuilds the string
from `folder.reservedAt` and would never match.

### What is deliberately NOT recorded

- **The deployment-window refund.** `spendEvents` is a per-tenant statement and the two clamps
  return DIFFERENT amounts, so a second tenant-scoped row would claim ~800¢ returned on a 400¢
  credit and drive `unlanded` to a false zero. The reserve side already carries this asymmetry:
  both windows debited, one row written. The deployment figure keeps `settleFolder`'s return value
  and `ingestRemainingCents`.
- **A zero refund.** `validateSpendMovement` rejects `amountCents <= 0`, and that throw would run
  inside `tryComplete`'s transaction — folder completion would fail for an accounting reason. The
  write lives strictly inside the existing `refundedCents > 0` branch. Recording nothing is also
  the honest answer, and the arithmetic already ships: reserved 900, actual 500, refunded 0 →
  `aggregateSpend` reports **400 unlanded**, which is the literal truth. `settleFolder` returns
  `settled_window_rolled` rather than `settled` so the reason is distinguishable from a clamp that
  happened to land on zero.

### Every call site, and the discriminator that keeps it honest

All twelve `recordSpend` call sites now pass a correlation. **The discriminator column is the point
of this table** — it names the second real charge that would have been swallowed without it.

| call site | correlation | discriminator earns its place because… |
|---|---|---|
| `pipeline.ts` `recordLlm` | `req:<requestId>:<stage>:<seq>` | `seq` (= `usages.length` read BEFORE the push): `stage` alone collapses every regenerate onto the first draft, and each regenerate is a real second model call. **Derived, not minted — journaled step.** |
| `intake.ts` transcribe / extract | `intake:transcribe:<artifactId>` / `intake:extract:<artifactId>` | `runIntake` inserts a FRESH `intakeArtifacts` row per attempt, so a re-entry gets a new id; the verb token keeps a video's audio and frame charges apart |
| `llm.ts` agent loop | `agentloop:<loopId>:a<attempt>` | `loopId = turnId ?? randomUUID()`; `attempt` separates the primary from the fully-billed CHEAP_MODEL fallback |
| `llm.ts` web-search fee | `agentloop:<loopId>:a<attempt>:search` | a SEPARATE payment in the SAME turn — bare would collide with that turn's token cost |
| `llm.ts` digest / reply / voice-brief | `digest\|reply\|brief:<runId>:a0` / `:a1` | each is a try/catch pair of TWO fully-billed calls, not a retry of one |
| `blueprint.ts` `deriveCandidates` | `blueprint:derive:<runId>` | re-running the action is a genuine re-spend; a tenant-scoped constant would record only the first run of the day |
| `vaultExtract.ts` | `vault:extract:<vaultDocId>:<attemptId>[:p<i>]` | the PDF fan-out bills PER PAGE — a document-level correlation records one page's cost for a 50-page scan. The image branch omits `:p` entirely rather than faking `:p0` |
| `vaultIngest.ts` | `vault:ingest:<vaultDocId>:<step.workflowId>` | **Derived, not minted — journaled step.** Deliberately NOT the handler's `correlationId` arg, which a sweep retry passes as a constant |
| `vaultDigest.ts` | `vault:digest:<folderId>:<runId>` | a rebuild is a real second charge |
| `vaultTranscribe.ts` | `vault:transcribe:<vaultDocId>:<attemptId>` | a sweep retry re-transcribes for real |
| `voice.ts` metering | `voice:usage:<sessionId>:<offset>` | the cumulative token offset — one session meters repeatedly, and `sessionId` alone would record only the first slice |
| `voiceDoc.ts` review | `voicedoc:review:<sessionId>:<nonce>` | re-reviewing a doc re-spends |

**`{ unstableArgs: true }` IS LOAD-BEARING at the two journaled sites** (`pipeline.ts`,
`vaultIngest.ts`). Their step args GREW, and a workflow already mid-flight replays the step against
a journal entry recorded with the old args and dies on `Journal entry mismatch` — killing in-flight
work that is already paid for. Confirmed on the public `RunOptions` type in
`@convex-dev/workflow@0.4.4` (`dist/client/workflowContext.d.ts`), not merely on an internal type.
Droppable only once nothing started before that deploy can still be parked. **Any future change to
a journaled step's args carries the same hazard.**

### Coverage opens at the GATE, not at the money

`spendCoverage` answers "from when does this ledger see everything for this tenant". The answer is
**from when we started watching**, not from when money first moved — so `ensureCoverage` is called
at the top of every spend gate: `prepare`, `preCall`, `reserveFolderInner` and `reserveJobInner`.
**Above every refusal, including the kill switches.**

Opening it only on the first recorded movement inverts the very lie the field exists to prevent:
instead of a fake zero it reports fake *ignorance*. A tenant we have been gating all week, who
simply has not spent, would read as `unknown` when the truth is a confident nothing — and a tenant
paused by the kill switch would read as `unknown` for the whole pause, which is the period we know
most about.

A refused gate is **positive knowledge that no money moved**, so it opens coverage and writes no
movement. Those are two different statements and both are needed.

Placement is load-bearing and a test caught it being wrong: `reserveJobInner`'s kill-switch check
returns *above* `reserveProviderLinesInner`, so a gate placed in the inner function missed exactly
the refusal it most needed to cover. `ensureCoverage` is insert-if-absent and never moves an
existing start forward, so calling it at both an outer and an inner gate is free.

`recordSpend` deliberately does NOT open coverage — it runs *after* a gate, so coverage is already
open by the time it is reached, and a zero-cost call stays a complete no-op on both planes.

**A NEW CALL SITE CANNOT SHIP UNINSTRUMENTED.** `correlationId` is optional, so the compiler will
not catch a missing one — a static scan in `guardrails.test.ts` ("every recordSpend call site passes
a correlation") balances braces from each call's argument object and fails the build instead. It
carries a non-vacuity floor (≥10 sites) because a per-site loop over an empty list passes for free.

### How to verify

```text
pnpm --filter @pikar/backend test -- guardrails vaultFolders spendLedger
pnpm --filter @pikar/backend typecheck
```

Mutation checks actually run for this section: (1) write `Math.round(costUsd * 100)` into the ledger
instead of the limiter's `cents`; (2) correlate settle on `Date.now()` instead of
`folder.reservedAt`; (3) replace the nonce with a per-tenant constant; (4) drop `folderId` from the
`reserveFolderInner` call in `vaultFolders.ts`. Each turns a DIFFERENT test red.

### Rollback

Non-negotiable, and it is the same rule `dashboard-pages.md` states from the Finance side: the
Finance UI may be disabled; **these writers may not be.** An append-only history has no backfill, so
a dark window is a permanent hole in the record.

## Phase 30 offline-proven evaluation reservations

`openEvalBudget` creates a one-hour, non-renewing envelope in the existing append-only
`spendEvents` table for at most 64 explicit fixture tenants and 1,000 cents. Each native SDK
`doGenerate` call passes through `evalBudgetModel`: it reserves against that aggregate envelope,
the tenant daily limiter, and the deployment limiter before contacting the provider. Loop steps
and explicit fallback attempts reserve separately; SDK automatic retries are disabled for this
evaluation path. At most 500 calls can be reserved, bounding their eventual reservation, refund,
and actual rows to 1,500 even when outstanding calls settle concurrently.

The closed model table in `@pikar/cost/evalBudget` reserves the entire advertised input context
plus an explicit 8,192-token output ceiling, using conservative maximum input/output prices.
Current ceilings are 54 cents for `or/openai/gpt-5.6-luna` and 44 cents for
`or/openai/gpt-4.1-mini`. The provider request also fixes OpenAI routing, disables provider fallback,
plugins and transforms, and supplies `provider.max_price` ceilings (including zero per-request and
per-image fees). Native vision inputs consume input tokens within the advertised context. Only
bounded inline PNG/JPEG bytes are accepted; URL inputs and cache-write controls are refused.

These bounds were checked against the [OpenRouter model catalogue](https://openrouter.ai/api/v1/models),
[maximum-price routing contract](https://openrouter.ai/docs/guides/routing/provider-selection#maximum-price),
and [OpenAI image token accounting](https://developers.openai.com/api/docs/guides/images-vision)
on 2026-09-10. Catalogue or provider-contract changes require revalidation of the closed table;
an unlisted model fails before reservation or a provider call.

Successful calls settle the exact `providerMetadata.openrouter.usage.cost` dollar value. Integer
cents remain conservative enforcement units; the exact value is retained on the actual movement.
An explicit zero is settled, whereas missing usage or a failed request retains the entire hold.
Late settlement never refunds a newly opened daily window. A known over-ceiling provider charge
is recorded truthfully with `evalBreach`, then the model action fails and future reservations are
refused. A provider contract breach is not reported as a successfully enforced spending cap.

The accounting scope is **OpenRouter credits**, as defined by its
[usage accounting contract](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
External BYOK upstream invoices are not included or proven bounded. Real evaluation must remain
closed until the runner can verify a supported billing mode; a local fixture assertion is not
account-level proof. Offline tests exercise the actual limiter component and capture provider
request bodies using an injected HTTP response; they make no paid calls and establish no live
quality, invoice, or release evidence.

Evaluation grants only `searchVault` and `saveAsDocument`. Controlled owned fixture hydration
replaces RAG for this method evaluation, so no hidden embedding or paid search call can bypass the
envelope. Extra tools, streaming, unsupported output/media paths, and failed source verification
fail closed. This does not measure live retrieval quality. Preserve the evaluation spend history
when removing throwaway fixture content; an envelope or outstanding hold must not disappear with
its tenant. Status exposes `breached`, `unsettledCount` and `unresolvedCents` separately from known
actual dollars; a zero known total does not mean an unresolved request was free.

## Known gaps & deferred work

- **Charges the pricer never sees are invisible to BOTH planes.** `draftUncached` runs
  `maxRetries: 1` and then a whole CHEAP_MODEL fallback but returns only the surviving attempt's
  usage; `!priced.ok` (an id missing from `PRICING`) records nothing anywhere. Ledger and limiter
  still AGREE, so reconciliation cannot see the hole — only an invoice can.
- **`folder.spentCents` is permanently 0.** Nothing increments it, and a zero money field sitting
  beside a real ledger is how someone reads 0 and believes it. Feed it or delete it.
- **No media equivalent of `recordSpend`.** The media rail reserves and never reconciles: if 3 of 6
  blocks fail, the reserved cents stay consumed. Over-reservation is the deliberate fail-closed
  bias; refunding would turn a rate-limiter window into a ledger. The upgrade path, if drift ever
  proves material, is a real spend table — not a credit call. The `ponytail:` note is at the site
  in `media.ts`, and now also points at the ingest rail's opposite decision so neither reads as a
  bug.
- **The ingest refund's cross-window behaviour has no offline proof.** See the operator check in
  §15.3-03. A test suite runs inside one window; the failure mode needs a day boundary.
- **A folder whose workflow dies after reserving holds its cents for up to 24h.** `settleFolder` is
  the only release, and nothing sweeps for orphaned reservations yet — 15.3-04 owns the folder
  watchdog. `retryStuckIngests` re-derives the rail from the row's `folderId`, but a swept retry
  can spend the ingest window without a live reservation.
- **The windows are fixed 24-hour windows, not rolling.** A tenant exhausted at 23:00 is refused
  until the window rolls, not for 24 hours. Accepted.
- **`run-smoke-guardrails.mjs` has NO ingest arm either (15.3-03).** The ingest rail is proven
  offline against the REAL rate-limiter component (`guardrails.test.ts`, 18 tests, every
  guarantee mutation-verified), and the one thing an arm still could not cover is the
  cross-window refund — that needs a day boundary, not a script. Use the §15.3-03 operator
  check instead. Adding an arm means writing `vaultFolders` rows to a live deployment.
- **`run-smoke-guardrails.mjs` covers the LLM rail only.** There is no live smoke for the media
  rail; `media.test.ts` is unit-only against the real component. Plan 20-11's owner-run live gate is
  the first end-to-end exercise of `reserveJob`.
- **Media economics live in `media.md`, not here.** This playbook owns the *mechanism*; the job cap,
  the price tables, the §4.1 arithmetic and the reservation contract are `docs/playbooks/media.md`.
  A change to the media rail's NUMBERS bumps both.
