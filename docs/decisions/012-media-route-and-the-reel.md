# ADR-012: The `media` route ships a FINISHED REEL — a dispatchable specialist whose product costs money and which cannot spend any

- **Status**: Accepted (2026-08-03 — Phase 20, MEDIA-01; owner decision)
- **Recorded**: 2026-08-03 (plan 20-11, after waves 1–12 shipped; the arithmetic below is
  vendor-direct as of 2026-08-02, not the indicative third-party figures ADR-011 carried)
- **Amends**: [ADR-011](011-media-provider-fal-wan25.md). ADR-011 is **Accepted and stays
  byte-unchanged** — `docs/README.md` permits editing a superseded ADR's Status line, and this ADR
  deliberately declines even that, because only **one line** of ADR-011 is superseded. Its provider
  choice, its price-table-in-code consequence, its separate-rail consequence and its
  no-OAuth consequence all still stand and are load-bearing. The superseded line is named
  explicitly below.
- **Relates to**: [ADR-010](010-dispatchable-routes-superset-of-diagnose.md) (dispatchable routes
  are a superset of what `diagnose()` emits), [ADR-007](007-sub-agent-capability-is-code-owned.md)
  (a tool-set is a code-owned capability grant), [ADR-013](013-the-render-worker.md) (the renderer)

## Context

Phase 20 was scoped as "a media canvas producing images and video". The mandated spike refuted its
two premises and ADR-011 recorded the replacement. Then, **after the first 12 plans were committed**,
the owner re-scoped again (2026-08-01, `20-CONTEXT.md` D8–D12): the deliverable is **ONE finished
mp4**, not a bag of clips.

That re-scope is what makes this ADR necessary rather than a footnote. It changes the output
contract, the cap arithmetic, and one line of an Accepted ADR. It also puts a **dispatchable
specialist** in front of a pipeline that spends real dollars — which is the governance question this
phase actually had to answer.

## What this ADR does NOT re-decide

**ADR-010 already decided the superset question.** *"`SPECIALIST_ROUTES` is the set of routes the
SYSTEM can dispatch; the routes `diagnose()` emits are a strict SUBSET of it."* Its own last
consequence says any future dispatch-reachable, non-diagnosis-emitted route *"follows this precedent
and needs no new ADR — this one covers the shape."*

`media` is the **second instance** of that pattern, which is precisely what keeps it a decided
pattern rather than a one-off exception minted for `research`. A reel is not a remedy for a
diagnosed business constraint — it is something a user asks for — so `diagnose()` must never
prescribe one. The companion assertion is
`packages/core/src/specialists.test.ts`: *"diagnose() emits neither `research` nor `media` —
dispatch-only routes stay dispatch-only"*.

**ADR-007 already decided that a tool-set is a code-owned capability grant.** Being a member of
`SPECIALIST_ROUTES` grants nothing by itself; the grant is a separate, code-owned table.

Both are cited here, not re-litigated.

## Decision 1 — the reel is the deliverable (D8)

The spine, in order:

| # | Stage | Cost | Gate |
|---|---|---|---|
| 1 | `script` | tokens | none (proposal) |
| 2 | `art-direction` | tokens | none (proposal) |
| 3 | `storyboard` → N fixed-length blocks | tokens | none (proposal) |
| 4 | `generate` — N clips via fal | **fal $** | whole-job reserve + Approve |
| 5 | `voiceover` — one TTS take per block | **fal $** | same reservation |
| 6 | `assemble` — ffmpeg → ONE mp4 | sandbox compute | post-Approve only |
| 7 | `captions` — burned AFTER assembly | **fal $** (STT) + compute | post-Approve only |

**Explicitly OUT, and each for its own reason:** `/brief`, `/concept`, `/trends`, `/publish`,
`/repurpose` (content stages, not media — they stay with the 2026-07-16 koda todo for a later
content phase); **re-cutting footage the user already has** (Phase 20 assembles only what it
generated); **music beds and sung tracks** (the harvested assembler supports `--music` and `--song`;
neither is in the stage list, and `assembleScript.test.ts` scans for the flags so re-adding one is
visible in a diff).

`/script` moved **IN** from that todo, because a voiceover has nothing to say without one.

**Blocks are fixed-length, N × `clipSeconds`, `clipSeconds` ∈ {5, 10}** — the same closed set the
price table, the storyboard parser and the assembler's CLI all enforce. Generation and assembly
therefore agree by construction rather than by validation. A clip shorter than its window is a hard
error, never a held still frame, and **no time-stretch is ever applied** to speech: an overrunning
narration line is a hard error to rewrite upstream, not something to speed up.

## Decision 2 — three stages, and the human is the second one (D2)

| Stage | Who acts | Cost | Gate |
|---|---|---|---|
| script → art-direction → storyboard | the media specialist, read-only | tokens (existing LLM rail) | none — no external effect |
| canvas spin-up | the specialist emits the canvas + block deck | none | none — it is a *view* |
| **generate / voice / render / captions** | **the human** | **fal dollars + sandbox compute** | media budget rail + Approve |
| regenerate one block | **the human**, in-canvas | fal dollars | media budget rail (human-initiated by construction) |

The canvas must show **four itemised estimate lines** and the remaining media budget *before* the
Generate control is live. An editor affordance that can spend money without showing its estimate
first is forbidden.

## Decision 3 — "plan-gated by construction" is STRUCTURAL, not procedural

This is the decision the phase most needs recorded, because the cheap version of it — a check inside
a tool — reads identical from the outside and is not the same thing.

**There is no code path from a dispatched specialist to any of the four paid capabilities.** The
four are: clip generation, TTS voiceover, captions STT, and the sandbox render.

The two paid entry points, both human-initiated, are:

1. the **post-`approved`** execution arm — `cockpit.ts`'s `EXTERNAL_TARGETS.media`, reached only
   after the `proposed → approved` lifecycle the plans plane already owns; and
2. the **canvas mutations**, each fired by an explicit human click.

Both funnel through the ONE money gate, `media.reserveJob`.

The absence is asserted, not asserted-about:

- `SPECIALISTS.media.tools` **is `SPECIALIST_TOOLS` by object identity** —
  `expect(SPECIALISTS.media.tools).toBe(SPECIALISTS["offer-architect"].tools)`. There is no media
  grant to widen, which is a strictly stronger statement than "the media grant happens to be small".
- the per-route grant table pins `["media", ["searchVault"]]`, and the mutation that must turn it
  red is named at the assertion: *add a generate/voice/render tool to `SPECIALISTS.media`*.
- a four-way no-path scan (plan 20-08) covers the dispatch surface.

## Decision 4 — a generate/voice/render tool is DELIBERATELY REFUSED

`specialists.ts:50-56` already records `evaluateBusiness` as deliberately refused, for persisting
rows and re-entering the engine mid-dispatch. A media tool would be **strictly worse than the thing
that comment already rejects**: it spends real dollars with no human in the loop, and it would
falsify roadmap SC #3 (*"an agent or injected content cannot fire generation without human
approval"*).

The precedent is followed verbatim: the refusal lives in the source as a comment naming the mutation
that would break it, so a future contributor cannot "fix" it by accident.

## Decision 5 — the whole JOB is the priced and reserved unit

Not the shot. Not the batch of clips. **The whole job** — every clip, every voice take, the captions
STT line and the render line — priced and reserved in ONE serializable transaction *before a single
provider request exists*.

**Why a per-shot cap bounds nothing:** a storyboard is N blocks and one approval means N
generations. A $1.00-per-request cap passes every individual line of a 12-block deck and still
authorises $6.00. The per-request shape also has a TOCTOU hole — check-then-record-later lets two
concurrent approvals each pass a cap that neither would pass after the other landed. Widening the
unit from "batch of clips" to "whole job" adds strictly more line items, so that argument gets
**stronger**, not weaker.

The worst legal case (`media.md` §4.1) — 6 paid blocks at 480p × 10 s, every narration at the
`maxCharsFor(10)` = 140-character band ceiling, with captions:

| Line | Cost |
|---|---|
| 6 × 480p × 10 s clips | $3.0000 |
| voice — 6 × 140 chars, reserved at **2×** (840 → 1,680 submitted chars) | $0.0168 |
| captions STT (1 min) | $0.0080 |
| render (Vercel Sandbox, a flat named estimate) | $0.0200 |
| **Total** | **$3.0448 → 305 cents** |

Against `MEDIA_JOB_CAP_USD = $3.50` — **13% headroom**, and `media.test.ts` pins the number so the
headroom cannot silently vanish.

**The cap is bounded by the CLIPS.** TTS is 0.55% of the job. That is why D10's arithmetic refuses 6
blocks at 720p ($6.00+) and 12 blocks at 480p ($6.00+), and why **the budget rail is also the
render-duration rail**: the sandbox never sees a resolution whose encode time would blow ADR-013's
duration ceiling.

> **These are the MODELLED numbers.** The live gate that compares them against fal's actual billed
> delta is plan 20-11 Task 4 and **has not been run as of 2026-08-03**. Its observed figures land in
> `docs/playbooks/media.md` § *Reconciliation* → *Live gate*, which is D5's first reconciliation run.
> Nothing in this ADR should be read as an invoice-confirmed figure until that section is filled.

## Decision 6 — the cents floor is applied ONCE, on the job total (D12a)

`chooseModel`'s fail-closed bias is `Math.max(1, Math.ceil(usd * 100))`. That is correct for one
line item and **wrong for a job**, and it reads as a micro-optimisation, which is why it is recorded
as a decision.

`estimateBatchUsd` sums in fractional **USD**; `chooseMediaBatch` floors **once**, on the total.
`mediaJobs.estUsd` stores fractional USD, never floored cents.

| | true cost | once-only (shipped) | per-line (the bug) |
|---|---|---|---|
| 6 voice lines × 200 chars | $0.012 | **2 cents** | **6 cents** |
| 13 sub-cent lines (50 chars each) | $0.0065 | **1 cent** | **13 cents** |

Three times the reservation, five times the true cost, and it compounds with deck length. Both rows
are pinned in `packages/cost/src/media.test.ts`, and the mutation — move the floor into
`estimateMediaUsd` — was **observed red** before the test was trusted.

> **Correction recorded deliberately.** D12(a) as written asserted *"a 6-line batch of $0.002 items
> reserves 1 cent, not 6."* $0.012 is 1.2 cents, so the fail-closed ceiling is **2**, not 1. The
> contrast the test exists for is unchanged; the second row above is the case that does land on 1.

One consequence follows and must not be "fixed": the reservation prices the **render line**, which
has no `mediaJobs` row. Reserved is therefore always slightly more than `Σ rows`, and
`spendForPeriod` flags it (`notes.reservedTotalNotDerivable`). Do not close that gap by adding a
render row.

## Decision 7 — a second budget rail, at the D10 numbers, with its own kill switch

| Window | Rate | Keyed by |
|---|---|---|
| `mediaSpendCents` | `MEDIA_DAILY_BUDGET_CENTS` = **1,000** ($10/day) | `tenantId` |
| `deploymentMediaSpendCents` | `DEPLOYMENT_MEDIA_BUDGET_CENTS` = **10,000** ($100/day) | **KEYLESS** |
| per-job ceiling | `MEDIA_JOB_CAP_USD` = **$3.50** | per job |

Plus `guardrailConfig.mediaKillSwitch`, independent of the LLM `killSwitch`; `media.reserveJob`
reads **both** inside its own transaction.

**Media spend never moves the token budget, in either direction.** `dispatch.ts`'s
`ENVELOPE_FRACTION` takes its 25% out of the LLM rail specifically, so folding media in would
silently shrink every sub-agent envelope by up to 20×. Asserted both ways in `media.test.ts`.

The keyless deployment ceiling exists for exactly the reason `deploymentSpendCents` does, and its
argument is 22.1-02's unchanged: **per-tenant keying alone makes exposure `N × $10`, unbounded in
N**, with the manual kill switch as the only global stop. 10,000 keeps the **same 10× ratio**
`DEPLOYMENT_BUDGET_CENTS` holds over `DAILY_BUDGET_CENTS` — one ratio to remember across both rails.
Worst-case daily exposure is **$100 media + $50 LLM across four windows that never share**. Do not
remove it as redundant.

## Decision 8 — delete-on-success retention (D12b)

A job produces ~55 MB (6 clips ≈30 MB + 6 voice takes ≈5 MB + `final.mp4` ≈10 MB + the captioned cut
≈10 MB). At D10's 2 jobs/day that is **3.3 GB/month** against a Convex Free/Starter allowance of
**1 GB total**. Storage, not spend, is the first thing this phase would have broken.

**Rule:** once the FINAL artifact is published — with a valid sidecar — delete the intermediate clip
and voice storage ids and null those fields. **On FAILURE, keep everything**: it is the only
debugging evidence, and failures are rare.

Plan 20-17 narrowed the condition rather than restating it: the clean voice takes are the
transcript's source, so when captions are still owed they survive the render and are deleted at the
caption terminal instead. A failed *burn* keeps everything, exactly as a failed render does.

There is no TTL and no cron. The `ponytail:` ceiling is named at the site: *delete-on-success is the
whole retention policy; the upgrade path if failed-render debris accumulates is a scheduled sweep of
`mediaJobs` older than N days.*

## The ADR-011 correction, and the one line that is SUPERSEDED

ADR-011's own last consequence said its rates *"must be re-read from fal's live pricing page when
the adapter is written; the figures here are indicative and sourced from third-party comparisons,
not from the vendor API."* That re-read happened on **2026-08-02**, vendor-direct, against fal's own
catalog API (`GET https://fal.ai/api/models?keywords=…`, unauthenticated). The verbatim vendor
strings are pinned in `packages/cost/src/media.fixtures.json` and a test asserts the table agrees
with them.

| ADR-011 claim | Reality (vendor-direct, 2026-08-02) |
|---|---|
| "Wan 2.5 ~$0.05/s" | True **only at 480p**. 720p is 2× ($0.10/s), 1080p is 3× ($0.15/s), and **1080p is the endpoint's DEFAULT**. **No number changed — the SOURCING did**, so confidence is upgraded MEDIUM → HIGH. |
| "a 15 s Wan 2.5 clip is ~$0.75 → passes with headroom" | **Wan 2.5 cannot generate 15 s.** `duration` is a STRING enum `["5","10"]`, default `"5"`. The conclusion (Wan passes, flagships do not) survives; the worked example does not. |
| "Veo 3 (~$6.00), Seedance 1080p (~$10.23) fail closed" | Unchanged, and still the right conclusion. |
| **"Video is ≤15 s. Any longer artifact is assembly or re-cutting, which are different features and out of Phase 20's scope."** | **SUPERSEDED.** Replaced by: *"a **CLIP** is ≤15 s — and Wan 2.5's own ceiling is 10 s; a **DELIVERABLE** is N clips assembled, and assembly is now IN scope. Re-cutting footage the user already has remains a different feature and remains OUT."* |

**Why the pricing half is worth an ADR rather than a footnote:** an estimate built on "~$0.05/s"
**under-reports a default-resolution 10-second clip by 3×**. A budget rail that under-reports by 3×
is not a rail. The containment is structural: the price table is keyed by `(model, resolution)`, an
absent resolution resolves to `unknown_model` rather than falling back to the 480p row (mutation
observed red), and **the submit body is built from the same spec object the estimate consumed** — so
the thing we priced and the thing we submitted cannot diverge.

Two further facts the 2026-08-02 read established, both recorded here because each is a silent
mispricing waiting to happen:

- **scribe-v2 carries a +30% keyterm surcharge** (*"If keyterm is used, you request will cost %30
  more"*). We submit no keyterms. Starting to, without re-pricing $0.008 → $0.0104/min, is a silent
  30% under-reservation.
- **FLUX schnell's $0.003/megapixel is NOT vendor-confirmed.** The catalog publishes the rounding
  *rule* only (`billingMessage`), no `pricingInfoOverride`. The figure is secondary-sourced and
  recorded at **MEDIUM** confidence; the fixture-agreement test permits an unjustified number *only*
  for a MEDIUM entry. The first invoice containing an image generation resolves it.

## Deferred, deliberately

- **Wan 2.5's native audio.** Pinned OFF on every submit. The reel's audio is the TTS track; a clip
  carrying its own would fight the narration bed. (There is no `enable_audio` flag — audio is an
  optional `audio_url`, which we never send.)
- **Ed25519 webhook signature verification.** The callback is authenticated by an HMAC path segment
  with a ±300 s window, matching what `http.ts` already does for the Gmail callback rather than
  inventing a third pattern. Convex default-runtime `crypto.subtle` support for Ed25519 is
  **UNVERIFIED** (research Open Question 3); verify it before adopting.
- **Music beds and sung tracks** — the `--music` / `--song` flags exist upstream and are stripped.
- **Re-cutting footage the user already has.**
- **A premium model default** (Veo 3 / Seedance) — reversible as a table entry behind a deliberately
  raised cap and an explicit owner decision. Never as a default (ADR-011, unchanged).
- **LongCat-Video** — evaluated 2026-08-01 and DECLINED for now (`20-CONTEXT.md` D13). Three of the
  four motivations were refuted outright; the survivor is *resolution-for-price*, which no benchmark
  can rank. Its trigger is already scheduled as the live gate's Run B/C. Adoption, if it happens, is
  one price-table row, one arm in the exhaustive submit switch, one `num_frames` divisor constant
  and a paragraph here — the rail is model-agnostic by construction.
- **Automated reconciliation of spend vs invoice.** D5(b) — the catalog half — *is* automated (plan
  20-19, weekly, three outcomes). The invoice half stays manual and evidence-gated on the manual
  step actually proving drift.

## Alternatives rejected

- **A cockpit tool or a standalone `/media` page instead of a dispatch route.** Rejected under D1:
  media is reached by dispatch so that future agent-orchestrated media chains have a route to
  orchestrate. This is the heaviest of the three surfaces considered and was chosen deliberately.
- **A per-shot or per-request cap.** Rejected in Decision 5 — it bounds one line item while the
  approval authorises N, and it reintroduces the TOCTOU window.
- **Flooring cents per line item** (the `chooseModel` shape, copied unexamined). Rejected in
  Decision 6, with the mutation observed red.
- **A per-tenant media window alone, with no deployment ceiling.** Rejected in Decision 7: exposure
  `N × $10` is unbounded in N.
- **Folding media into `dailySpendCents`.** Rejected: one window means media spend silently shrinks
  every sub-agent's token envelope.
- **A TTL or scheduled sweep for retention.** Rejected as unneeded machinery; delete-on-success is
  the whole policy and its upgrade path is written at the site.
- **A brand-profile table or "creative DNA" document type** for the art-direction stage. Rejected:
  `businessProfile.ts` + `tenantProfile.ts` + `docs/design/BRAND.md` already hold every field koda
  keeps in its config file.

## Consequences

- **`media` is dispatchable and un-fundable.** Any future edit that gives the media specialist a
  paid tool must supersede this ADR — three tests go red first.
- **The price table is keyed by `(model, resolution)` and fails closed.** A generation whose model
  or resolution is not in the table is refused, never guessed.
- **A new priced kind is a compile error**, not a runtime surprise: the submit body is an exhaustive
  switch over the priced spec.
- **The reservation is the only money gate.** Adding a second one would create two places to forget
  a kill switch.
- **The reel is all-or-nothing.** A render without a valid `assembly.json` sidecar publishes
  nothing — see ADR-013.
- **`docs/playbooks/media.md` is the operational surface for all of this**, including the two
  reconciliation bullets and the live-gate observations. This ADR records *why*; the playbook
  records *how to run and change it*.
