# Playbook: Guardrails (the spend rails, the kill switches, the redaction choke point)

> Last verified: 2026-08-08 (26-07 — the spend ledger now rides alongside every reasoning and
> ingest limiter movement; see the Phase 26 section below.)
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

## Known gaps & deferred work

- **The other ~15 `recordSpend` call sites pass no correlation yet, so they have no replay
  suppression** — they rely on the nonce, which cannot under-count but can duplicate under a
  replay-without-respend. A 19-site correlation design (per-turn, per-page, per-fallback
  discriminators for `llm.ts`, `pipeline.ts`, `intake.ts`, `blueprint.ts`, `vaultExtract.ts`,
  `vaultIngest.ts`, `vaultTranscribe.ts`, `vaultDigest.ts`) was produced and adversarially reviewed
  during 26-07 and is recorded in that plan's SUMMARY. It was scoped OUT because it edits ~10 files
  and ~6 playbooks this plan does not own. **Two of those sites need `{ unstableArgs: true }` on
  their `step.runMutation` when they change** (`pipeline.ts` and `vaultIngest.ts`) or in-flight
  journaled workflows die on deploy.
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
