# Playbook: Media Canvas (finished reel)

> Registration note, 2026-08-02: `check-fal-catalog.mjs` was first registered here by a foreign
> session (profile-tabs) that hit the §9 creation gap on it while it was still untracked, and
> classified it without reading or running it. **The media lane has since authored, run and
> verified it — see `## Reconciliation` bullet (b) and plan 20-19.** The registration it made was
> the correct one and is kept.

> Also 2026-08-02 (20-08 — **`storyboard.ts` gained `parseScript` and `parseArtDirection`**, the
> two remaining §-parsers, plus a section-terminator fix. Pure `@pikar/core`, zero new deps. See
> `## The §-parsers` below. The dispatch route itself is documented in `cockpit.md`.)
>
> Last verified: 2026-08-02 (20-09 + 20-16 + the unrenderable-deck guard - **the canvas plane, the
> render trigger and D12(b) retention.** ONE bump covering waves 9 and 10; this lane executed both.
> Five tenant-guarded reads and six writes with the BETA-05 isolation assertion shipped alongside;
> the last landing starts the render with NO chain and NO poller (the pending->rendering transition
> is the once-only guard); delete-on-success / KEEP-on-failure retention pinned to a single
> `storage.delete` site. **And a money leak closed: a deck with a TEXT or SCREEN REC block used to
> pass the money gate and could never assemble.** See `## The canvas plane`, `## The render trigger
> and D12(b) retention` and `## The unrenderable-deck guard` below.)
>
> PREVIOUSLY: 2026-08-02 (20-15 - **the renderer.** A Next.js route handler starts an
> ephemeral Vercel Sandbox and runs `assemble_final.sh` over the landed clips and voice takes,
> with **no Vercel access token existing anywhere in the system** (D11) - a property now asserted
> repo-wide rather than described. `persistent: false` and `networkPolicy: "deny-all"` are the two
> cross-tenant leak vectors and both were OBSERVED to fail a test when deleted. Plan tier **Pro**,
> route `maxDuration` **300 s**, sandbox `timeout` **240 s**. See `## The renderer` below.)
>
> PREVIOUSLY: 2026-08-02 (20-14 - **the voiceover stage.** One TTS take per block through the
> SAME adapter, secret, webhook and landing code: two switch arms, one narration read, and no
> second integration anywhere. The endpoint was chosen because it has NO rate knob, so D8's
> no-time-stretch rule is enforced by the provider rather than by our discipline. See
> `## The voiceover stage` below.)
>
> PREVIOUSLY: 2026-08-02 (20-06 — **the authenticated callback and the landing plane.**
> `POST /fal/callback/*` with an HMAC path segment and a ±300 s window, the asset downloaded and
> stored INSIDE the webhook so no fal URL can live anywhere, the honest four-value verdict, and
> kind-aware reconciliation. See `## The landing plane` below.)
>
> PREVIOUSLY: 2026-08-02 (20-05 — **the fal submit adapter.** `buildSubmitBody` is an
> EXHAUSTIVE switch over the priced spec, `submitBatch` claims each line before it POSTs, and
> `FAL_FIXTURE` drives the whole path at $0. See `## The submit adapter` below.)
>
> PREVIOUSLY: 2026-08-02 (20-19 — **D5(b) is automated.** `pnpm check:fal-catalog` +
> a weekly `fal-catalog.yml`: verbatim vendor-string diffing, endpoint-health flags, and THREE
> outcomes so "could not check" can never report green. All three observed before it was trusted.)
>
> PREVIOUSLY: 2026-08-02 (20-18 — **the D5 reconciliation readers.** `media.spendForPeriod` +
> `media.listJobs`, so `mediaJobs.actualCents` stops being a write-only field and the procedure in
> `## Reconciliation` names commands that exist. The three caveats that would otherwise make the
> number lie are in the payload, not just on this page.)
>
> PREVIOUSLY: 2026-08-02 (20-04 — **the second budget rail and the transactional job
> reservation.** `mediaSpendCents` + `deploymentMediaSpendCents` at the D10 numbers, the media kill
> switch, and `media.reserveJob` — the ONE money gate. See `## The budget rail` below.)
>
> PREVIOUSLY: 2026-08-02 (20-13 — **the assemble contract landed before its machinery.**
> `assemble_final.sh` harvested from the Higgsfield workflow v2.0, its bundler-safe mirror, the
> `assembly.json` validator in `packages/core/src/assembly.ts`, and the RCE scan that keeps the
> script out of the `skills` registry. See `## The assemble contract` below.)
>
> PREVIOUSLY: 2026-08-02 (20-01 tasks 2+3 — `storyboard.ts` and `media.ts` shipped; the price
> figures were re-read VENDOR-DIRECT from fal's catalog API the same day and are unchanged; the
> `## Reconciliation` procedure below is now runnable, not a stub.)

## What this subsystem is

The **finished-reel spine** (D8): script → art-direction → storyboard → generate → voiceover →
assemble → captions. The deliverable is **ONE mp4**, not a bag of clips.

The storyboard is a **BLOCK DECK**: N blocks, every block the same length, each carrying exactly one
narration line. `packages/core/src/storyboard.ts` parses it; `packages/cost/src/media.ts` prices the
whole job before a request exists.

## Invariants — what must never break

- **The price table is keyed by the billing unit the vendor actually charges on.** A media line item
  MUST be priced per **submitted input** — characters, megapixels, video-seconds, input audio-minutes.
  **A model billed per GENERATED output duration, or per COMPUTE second, cannot be reserved and is
  therefore REFUSED by construction.** The whole job is reserved before any request exists, so a
  guess-vs-submit gap there is the money bug in a new costume. This is why
  `fal-ai/elevenlabs/…/scribe-v2` (input audio minute) is in and `fal-ai/whisper` (compute second) is
  out — not because whisper is expensive, but because it is unreservable. *"Cheap in practice"* is
  exactly the reasoning ADR-011 exists to forbid.
- **A resolution missing from a model's row is `unknown_model`** — never a fallback to another tier.
  A fallback would price a 1080p submit at the 480p row and under-report by 3×.
- **The adapter pins `model`, `resolution`, `duration`, the audio flag and the TTS sample rate
  EXPLICITLY on every submit.** Never rely on a fal default. **Wan 2.5's default is 1080p**, so an
  estimate computed at 480p against a submit that omits `resolution` under-reports by **3×**.
- **Wan 2.5 accepts `duration` of 5 or 10 seconds ONLY.** There is no 15 s.
- **Blocks are fixed-length and uniform** (D8). A clip shorter than its window is a HARD ERROR, never
  a held still frame. **No time-stretch, ever** — no `atempo`, no `setpts`, no TTS `speed`. A test in
  `media.test.ts` greps for those tokens.
- **The JOB is the priced and reserved unit** — not the shot, not the clip.
- **The cents floor is applied ONCE, on the batch total** (D12a). Never per line item: a 6-block
  reel's true $0.012 voice cost becomes $0.06 that way — a 5× over-reservation that compounds on
  longer decks.
- **A narration line has a BAND, not a ceiling, and the band travels with the block length:**
  `minCharsFor(clipSeconds)`–`maxCharsFor(clipSeconds)` — **103–140 at 10 s, 43–70 at 5 s.**
  `MAX_CHARS_PER_BLOCK = 140` is only the 10-second ceiling and the number the skill body teaches.
  `assemble_final.sh` hard-errors on a take whose speech falls OUTSIDE
  `[clipSeconds - 1.4, clipSeconds]` seconds — **too short is as fatal as too long**, and both land
  after the clips are paid for. Two holes lived here: a flat 140 passed a 120-character line in a
  5-second deck, and no floor at all passed a pithy 46-character line in a 10-second one. The floor
  is computed at the SLOWEST plausible delivery (12 chars/s) on purpose, so it only refuses a line
  that cannot fill its window at any pace — measured pace wanders 1.9–3.4 words/second between
  generations of the same line.
- A narration line outside the band is refused at storyboard parse,
  **before a cent is spent**. The provider returns no duration (delta §1.5), so the overrun is
  otherwise only measurable by `ffprobe` in the sandbox — after ~$3.00 of clips have been paid for.
- **No fal URL is ever written to any row or any audit payload** (§4).

## Rate observation (dated, vendor-direct)

Read from fal's own catalog API on **2026-08-02** —
`GET https://fal.ai/api/models?keywords=…`, unauthenticated and machine-readable. Verbatim vendor
strings are pinned in `packages/cost/src/media.fixtures.json` and a test asserts the table agrees
with them.

| Model | Rate | Billing unit | Confidence |
|---|---|---|---|
| `fal-ai/wan-25-preview/text-to-video` | 480p $0.05/s · 720p $0.10/s · **1080p $0.15/s** | video-second. **1080p is fal's DEFAULT.** `duration` ∈ {5,10} only | **HIGH** — vendor `pricingInfoOverride` |
| `fal-ai/flux/schnell` | $0.003 per WHOLE megapixel | megapixel, rounded UP | **MEDIUM** — see below |
| `fal-ai/inworld-tts` | $0.01 per 1000 characters | **submitted** characters — fractional, NOT rounded up | **HIGH** — vendor `pricingInfoOverride` |
| `fal-ai/elevenlabs/speech-to-text/scribe-v2` | $0.008 per input audio minute | input audio minute | **HIGH** — vendor `pricingInfoOverride` |
| Vercel Sandbox render | flat `$0.02` estimate | per render — a named constant, not metered | estimate (delta §2.5) |

Three things the 2026-08-02 read established that the plan's table did not say:

1. **`fal-ai/wan-25-preview/text-to-video` is live**: `deprecated: false`, `removed: false`,
   `status: "public"`. The `-preview` rename risk has NOT fired. Its `image-to-video` sibling carries
   an identical rate string.
2. **scribe-v2 has a surcharge**: *"If keyterm is used, you request will cost %30 more."* We do not
   send keyterms, and must not start without re-pricing — $0.008 → $0.0104/min.
3. **FLUX schnell's per-megapixel RATE is not vendor-confirmed.** Its catalog entry exposes only
   `billingMessage: "Images are billed by rounding up to the nearest megapixel"` and **no
   `pricingInfoOverride`**. The rounding RULE is vendor-direct; the **$0.003 figure is secondary-
   sourced** and stays MEDIUM until an invoice reconciles it. Both `fal-ai/flux/schnell` and
   `fal-ai/flux-1/schnell` exist and both carry the same billing message.

## The §4.1 job economics

The **worst legal case**: 6 paid blocks at 480p × 10 s, every narration at the band ceiling
(`maxCharsFor(10)` = 140 chars), with captions.

| Line | Cost |
|---|---|
| 6 × 480p × 10 s clips | $3.0000 |
| voice — 6 × 140 chars, reserved at **2×** (840 chars → 1,680 submitted) | $0.0168 |
| captions STT (1 min) | $0.0080 |
| render (sandbox) | $0.0200 |
| **Total** | **$3.0448 → 305 cents** |

Against `MEDIA_JOB_CAP_USD = $3.50` — **13% headroom**.

> **Corrected 2026-08-02 (20-04).** This table previously read `voice (~1,200 chars) $0.012` +
> `voice retry allowance $0.012`, total **$3.052 → 306 cents**. That 1,200 is **not reachable**: it
> is 200 characters per block, and 20-13's narration BAND caps a 10-second block at **140**. Six
> blocks hold at most 840 characters, so the largest legal 6-block job is **$3.0448 → 305 cents**,
> and `media.test.ts` pins that number. The old figure was an estimate written before the band
> existed; nothing regressed, the ceiling simply got tighter. The retry allowance is unchanged in
> substance — it is the `× 2` on the voice line, not a separate row.

**The cap is bounded by the CLIPS.** TTS is 0.55% of the job and is not a threat to it. That is why
D10's arithmetic refuses 6 blocks at 720p ($6.00+) and 12 blocks at 480p ($6.00+), and why **the
budget rail is also the render-duration rail**: the sandbox never sees a resolution whose encode time
would change delta §2.4's numbers. Both refusals are pinned in `media.test.ts`.

## The budget rail (20-04)

Media draws its **own** named daily windows. They are appended to the ONE `RateLimiter` in
`packages/backend/convex/guardrails.ts` — a second limiter instance would be a second component
mount for zero gain.

| Window | Rate | Keyed by |
|---|---|---|
| `mediaSpendCents` | `MEDIA_DAILY_BUDGET_CENTS` = **1,000** ($10/day) | `tenantId` |
| `deploymentMediaSpendCents` | `DEPLOYMENT_MEDIA_BUDGET_CENTS` = **10,000** ($100/day) | **KEYLESS** |

`DEPLOYMENT_MEDIA_BUDGET_CENTS` resolves research Open Question 2. D10 names only the per-tenant
number; the ceiling is a planning decision, and 22.1-02's argument applies unchanged — per-tenant
keying alone makes exposure `N × $10`, unbounded in N, with the manual kill switch as the only
global stop. **10,000 keeps the same 10× ratio `DEPLOYMENT_BUDGET_CENTS` holds over
`DAILY_BUDGET_CENTS`** — one ratio to remember across both rails. Worst-case daily exposure is
therefore **$100 media + $50 LLM, across four windows that never share.**

### Invariants

- **Media spend NEVER moves the token budget, in either direction.** ADR-011 and D10 both say the
  rails do not share a window, and `dispatch.ts`'s `ENVELOPE_FRACTION` takes its 25% out of the LLM
  rail specifically — folding media in would silently shrink every sub-agent envelope. Asserted both
  ways in `media.test.ts`.
- **The whole JOB is reserved BEFORE the first POST.** `media.reserveJob` estimates every line
  (clips + voice + captions STT + render), refuses over `MEDIA_JOB_CAP_USD`, `check`s both windows
  and consumes them with `reserve: true` — **all inside one mutation, which is one serializable
  transaction.** This is the ONE place media diverges from the LLM rail: `prepare`/`recordSpend` can
  safely check-then-record-later because LLM calls in a turn are serial and an overshoot is cents.
  Here 13+ jobs are submitted back-to-back and land minutes apart, so post-hoc recording would let
  all of them fire against a window that had room for one. *An LLM overshoot is cents, a media
  overshoot is dollars* (20-PROVIDER-EVAL.md §4).
- **A refused job inserts ZERO `mediaJobs` rows.** All-or-nothing by construction, not by cleanup —
  every refusal returns before the first `ctx.db.insert`.
- **The cents floor is applied ONCE, on the job total**, by `chooseMediaBatch`. Per-line `estUsd`
  goes onto the rows unfloored.
- **The voice line is reserved at 2× its character estimate** so one rewrite round is already paid
  for. The provider returns no duration, so an overrunning line is only provable in the sandbox, and
  the cure is a rewrite plus a re-voice — a job that cannot afford its own cure would strand a paid
  deck.
- **The render is a reserved cost line with NO `mediaJobs` row.** It has no `falRequestId` and no
  webhook; it is a plan-row concern. It is reserved so a job that cannot afford its own render is
  refused before its clips are bought.
- **No refunds.** If 3 of 6 blocks come back `provider_blocked`, the reserved cents stay consumed.
  Over-reservation is the fail-closed bias. Refunding turns a rate-limiter window into a ledger; the
  upgrade path, if drift ever proves material, is a real spend table — not a credit call.
- **Regenerate-one-block is a job of ONE block through the identical path** (one video line, one tts
  line, one render line — regenerating a block invalidates the reel and forces a re-render). No
  second rail, no second cap, no bypass.

### The two kill switches — INDEPENDENT levers

```bash
# from packages/backend — the convex CLI only resolves the deployment from there
npx convex run guardrails:setKillSwitch      '{"on":true}'   # stops EVERYTHING incl. media
npx convex run guardrails:setMediaKillSwitch '{"on":true}'   # stops paid generation ONLY
```

Flipping the LLM kill switch must not be the only way to pause media, and pausing media must not
pause the email cockpit — that is the point of a separate rail. But `reserveJob` checks **both**: an
all-stop is an all-stop. `mediaKillSwitch` is `v.optional` in the schema, so a row written before
Phase 20 reads OFF by the same default-on-read the main switch uses. Zero seed, zero migration.

Read remaining budget without consuming it: `guardrails:mediaRemainingCents` (the tighter of the two
rails, each clamped `>= 0` first — `reserve: true` can drive a window negative).

### The refusal codes

`kill_switch` · `unknown_model` · `over_job_cap` · `illegal_duration` · `narration_too_long` ·
`narration_too_short` · `media_daily_exhausted` · `deployment_media_exhausted`

They are distinct because they send the user to distinct levers: rewrite a line, cut blocks, wait
for tomorrow, or call the operator. `unknown_model` is the one that fires on the `-preview` rename
risk below — loud, free, and fail-closed.

### Mutation checks — observed RED on demand, 2026-08-02

The guarantees below were each **seen to fail**, not merely asserted. Restored byte-identical after
every one.

| Mutation applied | What actually fired |
|---|---|
| `rateLimiter.limit(...)` removed from `reserveJobInner` (consumption outside the transaction) | **7 of 22 tests RED**, incl. the concurrency test — no window moved at all |
| the tenant `check` sized `count: 1` instead of `count: estCents` (the `preCall` shape) | concurrency test RED on the target line: **`expected [ {…}, {…} ] to have a length of 1 but got 2`** — both jobs won |
| the cents floor moved from the batch total to per-line | **6 RED**: the 13-line sub-cent job `expected 15 to be 4`; the §4.1 job `expected 309 to be 305` |
| the narration band pre-flight guard deleted | **3 RED**, and each returned a 5-key `ok: true` object — i.e. **the over-length job reached a reservation. Money moved.** That second half is the point of the guard |

### Known gap — `guardrails.ts` is in NO playbook's watch prefix

Research §11.3 recorded it and it is still true: `packages/backend/convex/guardrails.ts` appears in
no `watch.json` entry, so `check-playbooks` cannot demand a playbook bump when the spend rails
change. **20-04 deliberately did not fix it** — `guardrails.ts` is shared by the LLM rail and the
media rail, so assigning it to `media.md` alone would be wrong, and assigning it needs an owner
decision about which playbook holds the guard subsystem.

## The submit adapter (20-05)

`packages/backend/convex/media.ts`, below the D5 readers. It turns a reserved `mediaJobs` row into
a fal queue ticket and returns. **No code path in this module polls fal or waits for a terminal
status** — `media.test.ts` scans the comment-stripped source for `status_url` / `response_url` /
`cancel_url` / `setTimeout` / `setInterval` / `while (` and fails if any appears. A 10 s Wan 2.5
clip is **1–3 minutes** of wall clock; plan 20-06's webhook is what lands it.

| | |
|---|---|
| Submit | `POST https://queue.fal.run/{model_id}?fal_webhook=<url-encoded callback>` |
| Auth | header `Authorization: Key ${FAL_KEY}` |
| Accept | `{ request_id, response_url, status_url, cancel_url, status, queue_position }` — only `request_id` is read |
| Input refused | HTTP **422**, `type: "content_policy_violation"`, **non-retryable** |

### THE PINNED-SPEC RULE

**Every dimension the price table keys on is set explicitly on the submit, from the SAME `spec`
object `chooseMediaBatch` consumed.** Never let fal default one.

> Omit `resolution` and a 10 s clip costs **$1.50 instead of $0.50** — Wan 2.5 defaults to 1080p.
> That is 3× the reserved rate and **a third of the whole $3.50 job cap**, eaten silently, with no
> test going red. The estimate would keep reporting $0.50 and only the invoice would disagree.

The containment is a test that asserts the submitted JSON **field for field** against
`buildSubmitBody` of the priced spec. Mutation check, observed RED 2026-08-02: delete
`resolution: spec.resolution` from the video arm → 2 assertions fail.

The field names are the ones read vendor-direct from
`fal.ai/api/openapi/queue/openapi.json` (plan 20-01's preflight), **not** from memory:

- **video** — `prompt`, `resolution`, `duration`, `enable_prompt_expansion: false`.
  `duration` is a **STRING enum `["5","10"]`**; submitting the number `10` fails schema validation
  *after* the reservation is taken, so `String(seconds)` at the boundary is load-bearing.
  `enable_prompt_expansion` defaults **true** — a model-side rewrite of our prompt — so it is
  pinned off, or the prompt we priced is not the prompt that ran.
- **image** — `prompt`, `image_size: {width, height}`, `num_images: 1`. There is **no `width`/
  `height`** on this endpoint, and `num_images` is a **straight price multiplier**.

**Audio: Open Question 5 is CLOSED, and it closes at the assembler, not here.** The endpoint has
**no audio toggle at all** — the only audio field is `audio_url` (optional), which we never send.
Wan 2.5 generates native audio and we cannot ask it not to. That is not a conflict with the D8
voiceover bed: `render/assemble_final.sh`'s LEVEL LAW already ducks a clip's own diegetic track to
`SFXVOL 0.20` under the voice, and the narration is always 1.0. A test asserts **no key matching
`/audio/i` appears in any video body** — re-adding one is a visible decision.

### THE EXHAUSTIVENESS RULE

`buildSubmitBody` takes `SubmittableSpec = Extract<MediaSpec, {kind:"video"|"image"}>` and its
switch ends in `const _never: never = spec`. **A new priced `kind` MUST get its own arm — and that
is a compile error, not a code review.** Plan 20-14 adds `"tts"` to that alias and plan 20-17 adds
`"stt"`; the moment either widens it, `tsc` goes red until the matching `case` is written.

Mutation check, observed 2026-08-02: widening the alias with `"tts"` gives
`media.ts(516,13): error TS2322: Type '{ kind: "tts"; … }' is not assignable to type 'never'`.
Replacing the arm with `default: return {}` makes that error **disappear** — which is exactly the
failure mode the guard exists to prevent: a `tts` spec inheriting another arm's body, priced as one
thing and submitted as another. **The money bug in a new costume.**

`SubmittableSpec` deliberately excludes `"render"` and `"free"` — neither has a provider request at
all, so an arm for them would be a lie rather than a gap.

### THE IDEMPOTENT CLAIM

`submitBatch` calls `internal.media.claimLine` — a serializable mutation flipping `queued →
submitted` and returning `false` if the row has already moved — **before** each POST.

**This matters more now that a batch is ~2N+1 lines rather than N.** The action-retrier re-runs a
failed action, so a `submitBatch` that dies on line 7 of 13 would re-POST lines 1–6 on retry: a real
double spend against a window that has already been consumed, with no refund path (the rate-limiter
is a window, not a ledger). The claim makes the retry free.

The batch reader is deliberately **UNFILTERED by status** — `claimLine` is the sole gate, so
removing it is provable. Mutation check, observed RED 2026-08-02: delete the claim from the loop and
two consecutive `submitBatch` runs issue **4 fetches instead of 2**.

Rows this plan does not wire (`tts`, `stt`) are recognised **before** the claim and left at
`queued`, untouched, for 20-14/20-17.

### Failure → a CODE, never provider prose

The `calendar.ts:84` `reasonCode` idiom (CLAUDE.md §4). Only a **422** body is parsed at all, and
only its `type` discriminator (top-level or `detail[0].type`, validated against
`/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/`). A 5xx body is a stack trace as often as not, so it is never
read — its status alone becomes `http_503`. A transport throw becomes `transport_error`, and the
exception is dropped on the floor because **its message can carry the URL, and therefore the
webhook's HMAC segment**.

| outcome | row |
|---|---|
| accepted | `status: submitted`, `falRequestId` recorded |
| 422 | `status: blocked`, `verdict: provider_blocked`, `failureReason: <code>` — siblings untouched |
| 5xx / transport / no `request_id` | `status: failed`, `failureReason: <code>` |
| plan has no matching shot | `status: failed`, `failureReason: missing_shot`, **zero fetches** |

### The webhook URL

```
${CONVEX_SITE_URL}/fal/callback/${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}
```

The `gmailAuth.buildAuthorizeUrl:59` construction **verbatim**, per **JOB ROW** rather than per
tenant — `hmacHex` was exported from `gmailAuth.ts` for this (one word; there is exactly one
HMAC-path-segment pattern in this repo and it has been in production on the OAuth `state` since
Phase 2). The segment binds to ONE `mediaJobs` row, so a leaked URL buys an attacker one
already-finished job. **No `callbackHash` is stored** (20-02's recorded deviation) — plan 20-06
re-derives this string, so it must match character for character. A test re-derives it from the
jobId and asserts two lines get two different segments.

### The `FAL_FIXTURE` seam and the two secrets

```bash
# from packages/backend — the convex CLI only resolves the deployment from there
npx convex env set FAL_KEY <key>
npx convex env set FAL_WEBHOOK_SECRET <random-32-bytes>
```

Both are **deployment env vars, not `.env.local`**. `submitBatch` reads `CONVEX_SITE_URL` and
`FAL_WEBHOOK_SECRET` **above** the loop, so a missing secret refuses the batch before line 1 claims
itself.

`FAL_FIXTURE=1` short-circuits `submitLine` with a synthetic `fixture-<uuid>` request id and
**zero** fetches — the whole submit → webhook → land path is exercisable at $0. It sits **after**
the `FAL_KEY` check on purpose, so "no key" is the same refusal in fixture mode as in production
(`submitLine`'s first statement is the key read, and the test asserts a fetch-call count of **0**,
not merely the error message). Remove the seam only when a hermetic fal mock exists.

## The landing plane (20-06)

`POST /fal/callback/*` in `packages/backend/convex/http.ts`, terminating in
`packages/backend/convex/mediaComplete.ts`. An unguarded callback here would be a write endpoint
that flips job status, stores attacker-supplied bytes as a tenant's asset, and drives spend
reconciliation — so every step below is fail-closed.

### The auth, and its ceiling

The last path segment is `${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}` — the SAME construction
`gmailAuth.buildAuthorizeUrl:59` has used for the OAuth `state` in production since Phase 2, and
verified with `verifyState`'s shape (`lastIndexOf(".")`, split, re-derive, compare). **Nothing is
stored**: `resolveJob` re-derives the digest, so there is no `callbackHash` field to leak or drift.

Refusals, every one a bare `401` with no detail and a **byte-unchanged row**:

| | |
|---|---|
| `FAL_WEBHOOK_SECRET` unset | the fail-closed env guard, and it lives in `resolveJob` — **the one place the comparison happens.** A second copy at the route would make its mutation check vacuous |
| segment has no `.` | malformed |
| digest mismatch | forged or tampered |
| `normalizeId("mediaJobs", raw)` is null | garbage, or a well-formed id from a FOREIGN table. `ctx.db.get` is never reached |
| `x-fal-webhook-timestamp` outside ±300 s, **or absent** | replay of a captured URL + body |

> ⚠️ **The absent-timestamp refusal rests on an unverified assumption.** Research §1.2 is
> MEDIUM-HIGH that fal sends `x-fal-webhook-timestamp` on every delivery. If it does not, EVERY
> callback 401s — loudly, not silently, and **plan 20-11's owner-run live gate is where that is
> confirmed.** It is the first thing to check if live clips submit fine and never land.

**ponytail: HMAC path segment, not Ed25519/JWKS.** The segment proves the caller knows a secret we
minted for THIS job; it does **not** prove fal sent it. Upgrade path when that matters: verify
`X-Fal-Webhook-Signature` (Ed25519 over `request_id\nuser_id\ntimestamp\nsha256(body)`) against
fal's JWKS at `https://rest.fal.ai/.well-known/jwks.json`, cached ≤24 h. **First** confirm the
Convex default runtime's `crypto.subtle` supports Ed25519 — UNVERIFIED, research Open Question 3,
deliberately deferred — and note that a file holding an `http.route` cannot be `"use node"`, so
`node:crypto` is only reachable via an extra `runAction` hop.

### Nothing security-relevant comes from the body

`tenantId`, `planId`, `batchId`, `kind` and `model` are read from the ROW. This is the
`/skillopt/writeback` rule verbatim (`http.ts:123-129`): a body-supplied tenant is
attacker-controllable and is a cross-tenant write. **The only two things taken from the body are
the asset URL and the moderation field, and both are validated.**

The asset URL is extracted through `ASSET_PATH`, **keyed on the ROW's kind, never on the payload's
shape** — `video → payload.video.url`, `image → payload.images[0].url`. An unhandled kind fails with
`unhandled_kind`, because *"find whatever url is in this body"* is a third party choosing what we
download. Plans 20-14 (`tts`) and 20-17 (`stt`) each add ONE arm and touch no part of the security
half.

Then the URL itself is gated before any fetch:

- **https only**, and the host must be `fal.media` / `fal.ai` / `fal.run` or a subdomain (suffix
  match on `.${host}`, so `fal.media.evil.com` is refused). Without this the route is an SSRF into
  whatever the caller names, and the caller only had to know one job's digest.
- **32 MiB ceiling** on the download. An abuse ceiling, not a budget — a 10 s 480p clip is ~4 MB.

### The URL dies in the webhook

The bytes are fetched, `ctx.storage.store`d, and the URL is **discarded**: not passed to
`landResult`, not logged, not stored. **This is what makes CLAUDE.md §4 structural rather than a
promise** — a signed fal URL is both a content leak and a live credential, and after this there is
nowhere in the schema for one to live. The row carries `assetStorageId`, `assetHash`
(`contentHash` over the bytes — the shared hash, widened to accept them), `mimeType` and `bytes`.

### The verdict is the honest four — `none_reported` is NOT "clean"

| value | set when |
|---|---|
| `provider_blocked` | 422 `content_policy_violation` at SUBMIT; no asset exists |
| `checker_flagged` | the response carried `has_nsfw_concepts` and it was true |
| `checker_clear` | the response carried `has_nsfw_concepts` and it was false |
| `none_reported` | an asset came back and the response carried **no** moderation field |

**Every Wan 2.5 video and every `inworld-tts` take lands as `none_reported`** — neither publishes a
per-output moderation field. Rendering it as passed/clear/safe would be a compliance claim fal never
made. **Do not add a fifth value meaning "probably fine."**

### Reconciliation is SKIPPED when there is nothing to reconcile — never faked

```ts
const EXACT_SPEND_KINDS = new Set(["tts", "stt"]);
```

`inworld-tts` bills per **submitted character** and its response carries no duration and no
character count; `scribe-v2` bills per **input audio minute**, of audio we generated and already
measured. A member records `actualCents = estCents` and moves **neither window by one cent**.

**This is not an optimisation and not a trust decision.** Re-pricing a tts row would mean INVENTING
an actual from a value the provider never returns — the guess this whole phase forbids. The
difference is visible in the audit's `reconciled` ref: `exact_by_construction` (skipped),
`repriced`, or `reprice_failed` (the table could not price what fal claimed — recorded, with the
drifting `resolution` in the payload, never silently trusted).

Every other kind is re-priced from the SAME `@pikar/cost/media` table using what fal actually
produced. **Only a POSITIVE delta is consumed**, on both windows, with the same `reserve: true` the
reservation used. `actual <= est` consumes nothing and **refunds nothing** — plan 20-04's no-refunds
rule. The 2× voice over-reservation is therefore never returned, which is intended: it is the
rewrite budget, and it is $0.012.

### Idempotency

fal's retry policy is undocumented, so delivery is assumed **at-least-once**. A row already at
`succeeded`/`failed`/`blocked` short-circuits to `200` at the route AND is re-checked inside
`landResult`. A re-delivered webhook produces no second download, no second store, no second window
consumption and no second audit row.

### `onSubmitComplete` — the retrier terminal, added by 20-07

`mediaComplete.onSubmitComplete` is the `EXTERNAL_TARGETS.media` completion mutation. **It does NOT
land assets — the webhook does — and it does NOT render.** A SUCCESS is a deliberate no-op:
`submitBatch` already recorded every line's outcome, and rows left at `submitted` are waiting on the
webhook, not on this.

Its only job is the failure case. When the retrier finally gives up, a batch that never reached fal
would otherwise sit at `queued` forever while `plans.renderStatus` said `pending` — the canvas
promising a reel that will never arrive. So it fails the still-`queued` rows with
`submit_failed`/`submit_canceled` and sets `renderStatus: "failed"` with the same code. **Rows
already at `submitted` are left alone** — they reached fal and their webhook may still land.

It resolves the plan through `plans.by_media_run` because the retrier's `onComplete` receives only
`{runId, result}` (no context bag), the same constraint `calendarComplete` lives under.

### Who may write a terminal status

**`media.ts` and `mediaComplete.ts` — exactly those two — and `succeeded` is `mediaComplete.ts`'s
alone.** This CORRECTS research's SC2 line (*"the webhook is the ONLY writer of
succeeded/failed/blocked"*), which is not achievable: a 422 `content_policy_violation` is
**synchronous at submit** and produces no webhook at all, so `media.ts` must be able to write
`blocked`/`failed`. Both halves are pinned by a scan.

Plan 20-16's render terminal writes `plans.renderStatus`, **not** `mediaJobs.status`, so it does not
widen this set. If it ever needs to, that is a deliberate edit to the scan.

### The audit allow-list, and the scans that hold it

ONE audit row per landing: `eventType: "media.landed"`, `actor: "fal"`, `correlationId: batchId`.
The payload is **exactly**:

```
jobId, batchId, planId, falRequestId, kind, model, resolution, promptHash,
assetHash, verdict, estCents, actualCents, reconciled, failureReason
```

Ids, hashes, counts and two enums. **No URL. No prompt text. No narration text. No filename.**
`packages/contracts/src/audit.ts` permits any string in its flat map, so the TYPE is not the guard —
six scans in `llmRedaction.test.ts` are:

1. every media audit payload key is on the allow-list;
2. no `url` / `href` / `http` substring reaches one;
3. no `prompt`/`narration` identifier does either (`promptHash` is the only representation);
4. the audit-site count is **PINNED at 1** — **plans 20-09, 20-14, 20-16 and 20-17 each add sites
   and must each bump it deliberately**, having checked the new payload against the allow-list;
5. the terminal-writer set above;
6. **`storage.getUrl` is only ever called inside a `tenantQuery`.** A storage URL is a bearer
   capability. **This is the scan plan 20-17 must not break:** handing fal a `ctx.storage.getUrl()`
   result as the STT `audio_url` would give a third party a bearer capability to a tenant's asset.
   If 20-17 needs the bytes at a provider, it uploads them — it does not hand over a URL.

All six strip comments before matching, so the modules can spell out what they forbid.

## The voiceover stage (20-14)

The reel gets a voice, and it cost **two switch arms, one narration read and zero new integration
surface**. Same provider, same `FAL_KEY`, same queue submit, same HMAC webhook segment, same
`mediaJobs` row, same landing, same audit. If you are here to add a "TTS adapter", stop — there
isn't one, and that is the design.

### The endpoint and its three PINNED fields

`fal-ai/inworld-tts`, **$0.01 per 1000 SUBMITTED characters** (`MEDIA_TTS_PRICING`). The request
body is exactly:

```ts
{ text, voice: spec.voice, sample_rate_hertz: spec.sampleRateHertz }   // and NOTHING else
```

- `text` — the block's **narration**, verbatim. Never truncated, never re-wrapped. A silent
  truncation ships a voiceover missing its last words with no error anywhere and a clip that still
  renders.
- `voice` — `MEDIA_DEFAULT_VOICE.voice` (`"Evelyn (en)"`), read off the **ROW**, not off the
  constant. A row reserved under one voice must not submit under another after a constant bump; the
  row is the record of what was priced.
- `sample_rate_hertz` — **24000**, pinned. The vendor default is **48000**, which doubles the bytes
  that have to reach the render sandbox and makes the ffmpeg resample step non-deterministic.

### THE NO-RATE-KNOB RULE — why this model, and not a better-sounding one

**`fal-ai/inworld-tts` has no `speed` / `rate` parameter at all.** D8's *no time-stretch, ever* is
therefore enforced by the **provider's own schema**, not by our discipline. The `fal-ai/kokoro`
family exposes `speed: 0.1-5.0` and is a live foot-gun: a future contributor "fixing" an overrunning
line by nudging `speed` to 1.15 would violate D8 silently and no test would catch it (delta pitfall
15). **That outranks any difference in voice character.** If the model is ever swapped, this
paragraph is the thing to read first.

The tripwire is an **exact key-set equality** on the built body, not a substring absence — mutation
check M2 (adding `speed: 1.0`) was observed RED.

### The character arithmetic, and what the 2x reservation buys

~15 characters per second of speech, so a 10 s block's narration band is **103-140 characters**
(`minCharsFor`/`maxCharsFor`, 20-01) and a 5 s block's is 43-70. A 6-block 60 s voiceover is
~1,200 characters and **$0.012 — 0.4% of a $3.05 job.** The cap is bounded by the clips, and the
clips were already the locked constraint.

`reserveJob` (20-04) reserves each voice line at **2x** its character estimate. That is the rewrite
budget: a re-voiced line does not need a second reservation. It is never refunded (20-04's
no-refunds rule) and at $0.012 it does not need to be.

**The 140-character pre-flight ceiling is the real defence against an overrun** — it is the only
check that runs BEFORE money moves.

### Landing: `none_reported`, exact spend, and a window that does not move

`ASSET_PATH.tts` reads `payload.audio.url`; everything after that is the video path, unchanged.

- **`verdict` is `none_reported`.** inworld-tts publishes no moderation field. *"Audio is obviously
  fine"* is exactly the reasoning that would put a compliance claim fal never made onto a row.
- **`actualCents === estCents`, and both media windows move by exactly 0.** `tts` is in
  `EXACT_SPEND_KINDS`: the response carries **no duration and no character count**, so there is
  nothing to reconcile and re-pricing would mean INVENTING an actual. The audit records
  `reconciled: "exact_by_construction"` — that field, not the window delta, is where the
  distinction is observable (the delta is 0 either way, which is why the plan's stated
  window-based mutation check could not fire).

### The `file_size` heuristic and its honest ceiling

`landResult` fails a `tts` line with `failureReason: "take_too_long"` when
`bytes / 48000 > plan.clipSeconds + 2`. It is a **byte-count heuristic, not a measurement** — 24 kHz
mono 16-bit PCM is ~48 KB/s, so the division is a duration ESTIMATE. Three things it is not:

1. **Not a pre-flight guard.** By the time it runs the take is already paid for. The 140-character
   ceiling is the only check before money moves.
2. **Not reliable on a compressed container.** A compressed take reads far smaller per second and
   will simply not trip it — a false negative, which is the safe direction for a heuristic.
3. **Not a blanket refusal.** A plan with no `clipSeconds` has no window to measure against, so the
   net is **skipped** — never *"zero seconds, therefore too long"*, which would fail every take on
   a plan shape this phase did not write.

A take that trips it leaves the reel **un-renderable** rather than rendering with a word cut off —
D8's hard-error direction. Upgrade path: read the WAV header's byte rate instead of assuming it.

### Two things that bit, recorded so they do not bite twice

- **`SUBMIT_TEXT` is a table, not an `if`-chain.** `video`/`image` submit `prompt`, `tts` submits
  `narration`, and 20-17's `stt` reads NEITHER (it is keyed to the whole deck at `blockIndex: -1`),
  so a missing key stays a governed `missing_shot` rather than falling through to `prompt`. A `tts`
  line submitting `prompt` would voice the **shot description** over the clip — fluent, plausible,
  completely wrong, and nothing else goes red. The fixture behind it has a prompt and a narration
  that differ, per block.
- **Never write a literal slash-star inside a LINE comment in `media.ts`.** `media.test.ts` builds a
  comment-stripped copy of the module for its static scans, and the stripper closes the block at the
  next star-slash — silently eating the code between, including the `never` guard. Caught here
  because the scan failed loudly; the same trick would make a security scan pass **vacuously**.

## The §-parsers (20-08)

`parseBlockDeck` is joined by two siblings in `@pikar/core/storyboard`, both pure, both feeding the
plan row's DISPLAY fields rather than the money:

- **`parseScript(body)`** — the SCRIPT section verbatim, or `""`. Deliberately not re-wrapped or
  length-checked: the per-block narration is what gets submitted, and `parseBlockDeck` already
  enforces the 103-140 band on it. This string is the reel's script of record at the Approve gate.
- **`parseArtDirection(body)`** — koda's fixed nine fields, or **`null`**. Never a partial object
  with empty strings: the schema field is a 9-key object and a half-filled one renders as an art
  direction the specialist never wrote. `typography` is the one optional key, matching the schema.
  A missing art direction still gets its DECK — a worse-looking reel, not an unusable one.

**The parser does NOT enforce the hex-palette rule.** The skill body teaches *"hex, never a vague
colour word"*; a parser that refused `warm tones` would turn a soft quality problem into a hard
refusal at the Approve gate, where a human is already reading the proposal and is the better judge.

**Two shapes of heading exist in real output and both must parse.** `media-director.md` uses
`## 2. ART DIRECTION` for its own instruction headings but shows the model a **bare `BLOCK DECK`
token** in its example (`media-director.md:76`). `sectionOf` therefore matches with or without `#`s
and with or without an `N.` prefix — and, more importantly, a section ends at the next `#` heading
**or at the next known section token**. With a `#`-only terminator a model emitting bare tokens
would have ART DIRECTION run to EOF and swallow the whole deck, so `avoid` would come back carrying
table rows onto a row the user reads. Found by a fixture that used the wrong heading shape.

## The assemble contract (20-13)

`packages/backend/convex/render/assemble_final.sh` is the governed assembler, **harvested** from
the Higgsfield `faceless-channel-video` workflow v2.0 on 2026-08-02. Harvested, not cloned: the
contract and the ffmpeg invocations were taken; the workflow is not a dependency, and its MCP is
client-side only — structurally unreachable from a Convex action and from a Vercel Sandbox, which
is the finding ADR-011 exists to record.

### §5 DOES NOT APPLY TO THIS FILE

**CLAUDE.md §5 makes PROMPTS versioned `skills` rows. The obvious generalisation — "the assemble
script should be a registry row too" — is REMOTE CODE EXECUTION.** A registry row is mutable by a
database write, and this string is executed as a shell script inside a VM that holds tenant media.
The script is a repo file mirrored to a bundler-safe constant (`assembleScript.ts`) with a
byte-identity drift test, and `llmRedaction.test.ts` scans `skills.ts` to prove no `assemble` seed
entry and no `render/`-sourced body ever appears. Do not "fix" the mirror into a registry row.

### The five inherited properties, and the failure each one encodes

| Property | The failure it prevents |
|---|---|
| **Fixed length `N × clip-seconds`**, asserted on the OUTPUT to ±1s | a video silently shortened to fit its audio |
| **No time-stretch, ever** — no `atempo`, no `setpts`, no speech trimming | an overrunning line rate-shifted into the window; audible, and no downstream test would catch it. An overrun is a HARD ERROR to be rewritten upstream |
| **A clip shorter than its window by >0.5s is a HARD ERROR** | a held still frame passed off as a scene |
| **Speech-centred, not file-centred** (lead/trail silence measured by `silencedetect` and ignored) | a padded TTS take shifting the words off their scene |
| **Narration in every window**, asserted on the joined track before finalisation | the "silent second half" failure of every hand-rolled assembly |

Also inherited: per-input voice loudnorm (a fresh TTS take lands near −31 dB while dialogue lifted
out of a generated clip lands near −21 dB — mixing both at 1.0 is the "narrator quiet, character
loud" complaint), two-pass **linear** loudnorm at −16 LUFS on the final, and full-decode validation.

### The sidecar field set AS HARVESTED

**`packages/core/src/assembly.ts` is the SOURCE OF TRUTH for these names from here on.** The
validator maps snake_case in → camelCase out in one place, so a field-name correction is a one-file
change.

Top level: `script` · `out` · `block_count` · `clip_seconds` · `total_duration_s` ·
`actual_duration_s` · `width` · `height` · `fps` · `sfx_vol` · `gates[]` · `blocks[]` · `ts`
Per block: `block_index` (0-based) · `window_start_s` · `lead_silence_s` · `speech_abs_s` ·
`speech_dur_s` · `clip_dur_s` · `overrun` · `internal_pauses` · `freeze_head` · `freeze_tail`

The captions rebase is why the two anchors exist, and it is one line:
`absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)`

### An invalid sidecar means the reel is NOT published

This is an invariant, not a preference. D8: *"a final video without one was hand-assembled."* An
invalid sidecar is not "render with a warning" — the job fails with a code and nothing is published
(plan 20-16 enforces it). A sidecar reporting `overrun: true` on any block is INVALID: it is
reporting a failed render, not a rendered failure.

### Deferred, and re-adding either is a scope decision

`--music` (ducked bed) and `--song` (music-video mode) are stripped, along with `--stepped`, the
poster frame, and the `--manifest`/`--allow-mismatch` pair plumbing that index discovery replaces.
`assembleScript.test.ts` scans for all three flags, so re-adding one is a visible decision rather
than a quiet drift.

## The renderer (20-15)

Where the reel is actually assembled: an ephemeral Vercel Sandbox microVM, started by a Next.js
route handler, running `assemble_final.sh` over the landed clips and voice takes.

**The architecture, in three sentences.** Convex cannot encode video (D9), so `renderReel` (a Convex
`internalAction`) POSTs to `apps/web/app/api/media/render` with a shared bearer; that route starts
an OIDC-authed sandbox, fetches the tenant bytes itself from a bearer-guarded Convex blob route,
runs ffmpeg, and validates everything that comes back; the finished `final.mp4` and its sidecar go
up through two Convex-minted single-use upload URLs, and only small JSON travels in the response.

### THE PROPERTY THIS DESIGN EXISTS FOR: no Vercel access token anywhere

The re-scope delta wanted the runner in Convex with a `VERCEL_TOKEN`. **D11 overrode that.** A Vercel
personal access token is scoped to a **team, not a capability**: it can deploy, delete projects and
read every project environment variable. That is strictly more powerful than anything else this
codebase holds, and it would falsify ADR-011's cleanest property — *"an API key in a deployment
secret is the whole auth story"* — which is true of `FAL_KEY` precisely because `FAL_KEY` can only
generate media.

Putting the runner where OIDC is automatic deletes three secrets, the crown-jewel-token liability,
the `convex.json` Node-22 pin, the `@vercel/sandbox`-under-Convex-bundler question and the
connectivity spike. It costs one HTTP hop.

`llmRedaction.test.ts` scans every Convex source plus the route, the bake script and
`packages/core/src/render.ts` for `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` and
requires **zero occurrences in code** (comments may name them while explaining the absence). This is
a headline property, so it is an assertion rather than a paragraph.

### The plan tier and the duration ceiling — the number D11 moved

**Vercel plan tier: Pro. Route `maxDuration`: 300 s. Sandbox `timeout`: 240 s.** Settled at plan
20-15's blocking Task 1 checkpoint, 2026-08-02. Record both numbers here whenever the tier changes.

Under the delta's Convex-hosted runner the ceiling was Convex's 10-minute action limit. **Under D11
the binding ceiling is the Vercel function's max duration** — and on Hobby that defaults to 60 s,
which does *not* fit a 60–150 s render. Pro's 300 s gives ~2× headroom over the modelled render.

The sandbox timeout is **strictly below** the route's, with 60 s of teardown margin, so the VM is
stopped by our own `finally` rather than orphaned by the function being killed mid-cleanup.
`buildSandboxOptions` CLAMPS to `RENDER_SANDBOX_TIMEOUT_MS` rather than trusting its caller, and a
scan pins the route's `maxDuration` literal to `RENDER_MAX_DURATION_S` (Next.js reads route segment
config by static analysis, so the route cannot import the constant — the scan is the drift guard the
import would have been).

⚠ **On Hobby, exhausting the 5 free Active-CPU hours PAUSES sandbox creation for 30 days rather
than charging** (delta pitfall 18). The render stage silently stops working mid-month with no
invoice to notice. D10 permits 2 jobs/day ≈ 60/month against ≈150 renders/month of allotment — but
a retry storm or a test suite that accidentally creates real sandboxes eats that headroom fast,
which is why `MEDIA_SANDBOX_FIXTURE` is mandatory in tests.

### Two INVARIANTS, not implementation details

Both are cross-tenant leak vectors, both are closed by an infrastructure option, and a test has been
**observed to fail without each one**:

| Option | Why it is mandatory |
|---|---|
| `persistent: false` | **The SDK default is TRUE** (vendor README: *"Sandboxes are persistent by default"*). Left unset, the SDK snapshots the filesystem on stop and restores it on the next resume — so tenant A's clips, voice takes and `final.mp4` survive into the VM that renders tenant B's reel. A cross-tenant data leak created by an *unset option*, not by a bug. |
| `networkPolicy: "deny-all"` | The VM holds tenant media and must not be able to send it anywhere. This is why the route — never the sandbox — does every fetch, and why ffmpeg is baked into a snapshot instead of downloaded per invocation. |

`name` is **never** passed either: a named sandbox is resumable BY NAME, which is the whole
persistence mechanism. The test asserts `"name" in opts === false`, not `opts.name === undefined` —
an explicit `name: undefined` would pass the weaker check and still hand the SDK the key.

These are assertable at $0 **because `buildSandboxOptions` is a pure function rather than an inline
literal** inside `Sandbox.create({...})`. A literal could only be tested by booting a real VM. This
is the same move plan 20-05 makes with `buildSubmitBody`, and a scan pins the route to calling
`Sandbox.create(options)` and never `Sandbox.create({`.

### The snapshot, and the bake

ffmpeg is **not** present in a stock sandbox and is **not** in Amazon Linux 2023's `dnf` repos.
`deny-all` and a per-invocation download are mutually exclusive; the snapshot is that tension's
resolution.

```bash
cd apps/web && npx vercel link && npx vercel env pull   # writes VERCEL_OIDC_TOKEN into .env.local
pnpm --filter @pikar/web bake:sandbox
```

- **The exact asset:** BtbN `ffmpeg-master-latest-linux64-gpl.tar.xz` (~125 MB) — ffmpeg AND
  ffprobe, statically linked, **`libass` ENABLED**. Plan 20-17's caption burn needs `libass`, so an
  LGPL build is not a substitute, and the bake **fails** if `ffmpeg -buildconf` does not show it.
- `dejavu-sans-fonts` is baked now, so 20-17 adds nothing to the image and a cut of 20-17 costs
  nothing.
- **`snapshotExpiration: 0`.** Snapshots otherwise expire 30 days after last use, and a media rail
  that goes 31 days unused would wake up with a dead id and fail for everyone at once.
- **The `awk` question is settled by a command, not an assumption:** the bake runs
  `command -v awk ffmpeg ffprobe` and fails if any is missing. AL2023 is *expected* to ship `gawk`;
  expected is not verified. In-repo fallback if it ever fails: add `dnf install -y gawk`.
- **The script lives in `apps/web/scripts/`, not `packages/backend/scripts/`** (a recorded deviation
  from plan 20-15). `@vercel/sandbox` is a dependency of `apps/web` ALONE — that is what keeps the
  SDK out of the Convex bundle — and under pnpm's default isolated linker it is materialised at
  `apps/web/node_modules/@vercel/sandbox` and nowhere else, so the import cannot resolve from
  `packages/backend/`. `vercel link` also points at `apps/web`, which is where the OIDC token lands.
  The script belongs where its dependency and its credential already are.
- **Local auth is an OIDC token, not a PAT.** The SDK resolves credentials from `VERCEL_OIDC_TOKEN`
  (`@vercel/oidc`); `vercel env pull` writes it into `.env.local` and it is short-lived and
  project-scoped. If it expires, pull again. D11's no-access-token property holds for the bake too.

### What NEVER crosses into the VM

No `FAL_KEY`, no `OPENAI_API_KEY`, no Vercel credential, no `tenantId`, no fal URL, no signed
storage read-URL, no prompt and no narration. The runner passes `env` to neither `Sandbox.create`
nor `runCommand`, and the only bytes written in are the media itself and `assemble_final.sh`.

The request body Convex sends is the complete list: `{ renderId, blockCount, clipSeconds, inputs:
[{name, jobId}], uploadUrls }`. **The job ids are opaque refs — the runner is handed no URL to fetch
at all** and builds every blob URL itself from `convexSiteOrigin(NEXT_PUBLIC_CONVEX_URL)`. That is
the read-direction SSRF guard; the write direction is guarded by requiring both `uploadUrls` to sit
on the derived deployment origin. A scan asserts the body literal carries none of the banned names.

Filenames are validated against `RENDER_INPUT_NAME` before a byte is written: a name from a request
body reaching `writeFiles` unchecked is a path traversal into the VM — including over
`assemble_final.sh` itself, which would make the endpoint arbitrary code execution.

### What comes BACK is not trusted either

`validateRenderReturn` (pure, `packages/core/src/render.ts`) runs before anything is published:

| Condition | Code |
|---|---|
| `readFileToBuffer` returned `null` | `missing_output` |
| zero bytes | `empty_output` |
| bytes 4..8 are not `ftyp` | `not_an_mp4` |
| outside 200 KB – 200 MB | `implausible_size` |
| sidecar absent | `invalid_sidecar` (detail `missing`) |
| sidecar fails `parseAssemblySidecar` | `invalid_sidecar` (detail = the validator's own code) |
| **valid JSON reporting `overrun: true`** | **`invalid_sidecar` — D8's HARD ERROR arriving from the renderer, and NOTHING is published** |

**The MIME type is OURS**: the stored blob's type is the literal `"video/mp4"` we assert, never a
value read from the VM.

**And Convex re-validates the sidecar a second time**, with the same `parseAssemblySidecar`, from
the bytes that actually landed in our storage. That is defence in depth, not duplication: it costs
one function call and a ~2 KB read, and it means a compromised or buggy route cannot publish an
ungoverned reel. `gatesPassed` in the audit comes from *that* re-validation, never from what the
route claimed.

### ffmpeg's stderr never reaches a row, a log or a dead letter

`reasonCodeFor(exitCode, stderr)` maps to a CLOSED union and **returns a code only** — the input
cannot appear in the output by construction. ffmpeg's stderr carries file paths and, on a caption
burn, narration text; it is CLAUDE.md §4 content. A scan asserts `.stderr()` is read **exactly
once** in `render.ts` and on the same line it becomes a code, and never at all in the route or in
`renderReel.ts`. The bake script is the one exemption, recorded at the scan: it runs by hand against
a sandbox with zero tenant bytes in it.

### The blob route, and where the tenant boundary actually is

`GET /media/blob/{jobId}` on `http.ts`, bearer-guarded by `MEDIA_RENDER_SECRET` with the same
fail-closed shape as `/skillopt/export`. It takes ONE opaque job id and nothing else — no tenant, no
path, no storage id (`http.ts:123-129`'s rule) — resolves it with `normalizeId`, and refuses a row
that is not `succeeded`.

**The tenant boundary is NOT on this route.** It is upstream, in `renderReel.batchToRender`, which
reads job ids through the tenant-prefixed `by_batch` index. Saying the route "checks the tenant"
would be a phrase with no mechanism: it is handed an id it did not choose, and the only honest
guarantee it makes is that it invents nothing.

**No HMAC path segment, unlike `/fal/callback/*`**, and the difference is the caller: fal is a third
party holding no secret of ours, so the segment is the only thing that can authenticate it. Here the
caller already proves knowledge of `MEDIA_RENDER_SECRET` in the header, and an HMAC keyed on that
same secret is derivable by anyone who has it. It would be ceremony, not defence.

### A reel is ALL-OR-NOTHING

`batchToRender` refuses `not_all_succeeded` (a line without bytes), `incomplete_blocks` (an index
missing its clip or its voice take) and `empty_batch` — all **before** a sandbox exists, so the
failure is free rather than a $0.02 VM that hard-errors on a missing input. The assembler asserts
`--blocks N` before any work for the same reason: a dropped block must FAIL, not ship a hole.

⚠ **A deck containing a TEXT or SCREEN REC block cannot currently render.** `reserveJobInner`
creates a video line only `if (isPaidBlock(block))`, so those indices have a voice take and no clip,
and `assemble_final.sh` requires both. It is refused as `incomplete_blocks` rather than discovered
inside the VM. Making those blocks renderable (a generated title card, say) is a **scope decision
for the canvas**, not a patch in the render path.

### The `MEDIA_SANDBOX_FIXTURE` seam — and the rule that it is the DEFAULT in tests

`renderReel` short-circuits on `MEDIA_SANDBOX_FIXTURE` (the `FAL_FIXTURE` / `llm.ts:922` precedent)
and never issues a fetch. It sits **after** the two `requireEnvMedia` reads on purpose, so "no
secret" is the same refusal in fixture mode as in production.

**No test suite may reach `Sandbox.create`.** On Hobby an accidental real create burns a shared
monthly allotment whose exhaustion is a 30-day outage. The route body is asserted in
`packages/core/src/render.test.ts` with the SDK *injected* — which is also the only way "a bad
bearer creates NO sandbox" is assertable at all, since `apps/web` has no unit-test runner.

### The two secrets

```bash
# from packages/backend
npx convex env set MEDIA_RENDER_SECRET <fresh random>
npx convex env set MEDIA_RENDER_URL https://<app>/api/media/render
# and on Vercel (Project -> Settings -> Environment Variables)
MEDIA_RENDER_SECRET=<the same value>
MEDIA_SANDBOX_SNAPSHOT_ID=<from the bake script>
```

`MEDIA_RENDER_SECRET` is the shared bearer in **both** directions (Convex→route and route→Convex)
and is set on BOTH sides. The route additionally reads `NEXT_PUBLIC_CONVEX_URL`, which apps/web
already has — no third secret. Both Convex-side values are **deployment** env vars
(`npx convex env set`), never `.env.local`.


## The canvas plane (20-09)

Five tenant-guarded reads and six tenant-guarded writes, in `media.ts`. **Reads return `[]`/null for
a foreign tenant; writes THROW** (`cockpit.ts:531`'s rule). One `ownedPlan` guard behind all of them,
so a new canvas function cannot ship without it.

| Read | What it is for |
|---|---|
| `byPlan` | one entry per BLOCK, carrying **two independent states** — `clip` and `voice`. They arrive minutes apart through two different webhooks, and a merged status cannot express "voice landed, clip did not". Carries `narrationChars` / `maxChars` / `overCharLimit`. **No URL.** |
| `assetUrls` | the per-asset signed URLs. **The only bearer-minting surface** — a query that mints a capability should be the smallest one possible, which is why this is not merged into `byPlan`. A line with no asset yields a NULL url, not an omitted row. |
| `reel` | the finished mp4 + the sidecar's gate summary. |
| `jobEstimate` | the ITEMISED estimate. |

### D7's rule is a BACKEND requirement before it is a UI one

*"The editor must not offer a control that can spend money without showing the estimate first."*
`jobEstimate` returns **four labelled lines** — clips, voice, captions, render — plus `totalCents`,
`capCents` and `remainingCents`, so the UI can print *"6 clips $3.00 · voice $0.02 · captions $0.01 ·
render $0.02 = $3.05"*. A single total is not enough: **the user must be able to see WHICH line is
the expensive one before deciding to cut a block.**

It builds the SAME spec list `reserveJobInner` builds, from the same price table, including the 2×
voice multiplier and the flat render constant. **`media.test.ts` asserts `jobEstimate.totalCents ===
reserveJobInner`'s `estCents` for the same deck** — a UI that computes its own total and a rail that
computes another is the drift this phase exists to prevent. It also returns the pre-flight `refusal`
(with block index and character count) so the canvas can name the lever *before* the button is
pressed.

`jobEstimate` **consumes nothing.** It is a query and cannot.

### The url guarantee, and where it actually lives

`reel` returns a non-null `url` ONLY when `renderStatus === "rendered"` AND both storage ids AND
`renderSummary` are present. `recordRender` writes all four in ONE patch, and only after
`parseAssemblySidecar` accepted the bytes — **so the check is at the WRITE**, which is the only place
it can be: `ctx.storage` in a query is a `StorageReader` with `getUrl` and no way to read a blob.
A row hand-patched to `rendered` therefore surfaces no reel.

`renderSummary` (`{ durationS, blockCount, gates }`) exists for that reason and one more: it means
the sidecar is parsed once per RENDER instead of once per canvas subscription tick.

### The free editor: five affordances, floor AND ceiling

`editBlockPrompt` · `editBlockNarration` · `regenerateBlock` · `reorderBlocks` · `deleteBlock`.
**Nothing else.** No timeline, transitions, filters, layers, masking, music, or client-side
rendering. If a reviewer asks for one, it is a deferred idea and not a small addition.

`editBlockNarration` is **the UI half of the pre-payment guard, not scope creep**: without it,
`narration_too_long` from the rail is a dead end — a user told *"block 4's line is 186 characters"*
with no way to shorten it is stuck. It refuses with the same reason and the same count the rail
would return.

### EVERY structural edit clears the render, through ONE helper

`clearRender` unsets `renderStatus` → `pending`, `renderStorageId`, `sidecarStorageId`,
`sidecarHash`, `renderReason`, `renderedAt` and `renderSummary`. **Six callers, one helper**, and
that is the point: six copies of the unset is exactly how one of them ends up missing a field. It
already happened — `renderSummary` was added to the schema and to `recordRender` but not to
`clearRender`, and the regenerate test caught it.

A canvas showing a stale `final.mp4` beside a freshly regenerated block is lying to the user, and it
is a lie they would only discover by watching the whole reel.

### The reorder ceiling, stated

`mediaJobs.blockIndex` is a SNAPSHOT taken at reserve time, and `byPlan` renders a job under the
block it was reserved for. A reorder after submit therefore leaves in-flight jobs pointing at their
original index. That is deliberate — the alternative is re-pointing a landed asset at a different
block's tile, which is worse. Upgrade path if it ever confuses anyone: a stable per-block id instead
of an array index, which is a schema change and not a UI one.

`reorderBlocks` refuses anything that is not a PERMUTATION of the existing indices: a dropped or
duplicated block becomes a deck with a hole, which hard-errors at the assembler.

### BETA-05 isolation, shipped WITH the surface

`media.test.ts` § *BETA-05 ISOLATION*: tenant B gets `[]`/null from every read (including no signed
URL) and a thrown `plan not found` from all six writes, with zero rows and zero budget movement.
An unauthenticated caller gets `UNAUTHENTICATED`. **Mutation-checked**: dropping
`plan.tenantId !== ctx.tenantId` from `ownedPlan` turns it red.

## The render trigger and D12(b) retention (20-16)

### There is NO chain, and that is a decision, not an omission

Delta §6.7 N4 described *"reserve → submit → wait-for-all-landed → render"*, and 20-07 left a
hand-off to re-point `EXTERNAL_TARGETS.media` at a chain entry action. **20-16 evaluated that and
declined it**, and `cockpit.ts` now says so at the site instead of carrying a promise nobody kept.

`mediaComplete.landResult` already runs on every arrival, already holds the batch id, and already
runs inside a serializable mutation. So "wait for all" is `maybeStartRender` — one indexed read of
the batch — and **the `pending → rendering` transition IS the once-only guard**: two concurrent
last-landings cannot both observe `pending`, so they cannot both schedule. A double render is a
double sandbox.

- An earlier landing schedules nothing.
- A re-delivered webhook for a terminal row schedules nothing.
- **A failed or blocked sibling means `renderStatus: "failed"`, `renderReason: "incomplete_batch"`,
  and NO render.** D8's fixed-window contract makes a missing clip a hard error, so that render is
  already known to fail — and finding that out in the sandbox costs a sandbox.
- **A pending `stt` line does NOT hold the reel hostage.** Captions are a POST-assembly step (D8),
  submitted after `final.mp4` exists. The trigger fires on the video+tts set alone.

`ponytail:` an O(batch) read on every landing — 13 rows, indexed. The ceiling is a reel with hundreds
of blocks, which D10's cap refuses long before it matters; the upgrade path is a landed-count on the
plan row.

### Retention: delete on SUCCESS, KEEP on FAILURE

The arithmetic that forces it: ~55 MB/job × 2 jobs/day = **~3.3 GB/month against a Convex
Free/Starter allowance of 1 GB TOTAL**.

On a successful render, every `video`/`image`/`tts` row in the batch has its blob deleted and its
`assetStorageId` unset. **`final.mp4` and the sidecar are KEPT** — deleting them would delete the
deliverable. On a FAILED render **everything is kept**: the intermediates are the only debugging
evidence a failed render leaves, and failures are rare.

**ORDER MATTERS, and the code says why:** the plan row is patched FIRST, so the reel is published and
readable, and only then are the intermediates deleted. A crash between the two leaves orphaned blobs
— 35 MB of waste. A crash in the other order leaves a published reel whose tiles point at deleted
blobs — a broken canvas. **Fail toward waste, not toward a lie.**

The loop dedupes storage ids before deleting: `storage.delete` THROWS on an id that is already gone,
so a blob referenced by two rows would abort the loop AFTER the reel was published and leave the rest
of the batch undeleted forever.

**`llmRedaction.test.ts` pins `storage.delete` to EXACTLY ONE site in the media subsystem**
(`render/renderReel.ts`) and asserts the failure arm does not contain it. A second deletion site is
how a delete-on-failure bug gets introduced later, and the failure half is the one that is easy to
get backwards and impossible to notice.

`ponytail:` no TTL, no cron, no sweep job. Upgrade path if failed-render debris ever accumulates: a
scheduled sweep of `mediaJobs` older than N days — which is a cron, and this deliberately is not one.

### A failed render dead-letters, and does not retry

ONE `deadLetters` row, payload `{ batchId, planId, reasonCode }` and nothing else — no ffmpeg output,
no filename, no narration, no URL. **A failed render does NOT retry:** at 480p a structural failure
repeats, and the action-retrier would buy N sandboxes to learn the same thing N times.

## The unrenderable-deck guard (20-15 follow-up)

⚠ **`storyboard.ts`'s PAID table promised something the assembler cannot do.** Its comments called
TEXT *"rendered by the assembler"* and SCREEN REC *"an instruction to the human"* — but the assembler
harvested in 20-13 has **no title-card path and no upload path**, and it discovers inputs BY INDEX
and hard-errors on the first missing clip. An unpaid block gets no video line, so nothing ever writes
its `blockNN.mp4`.

**That was a money leak, not a cosmetic gap:** a deck containing a TEXT block passed the money gate,
spent real money on its AI blocks, and could then never assemble anything.

`reserveJobInner` now refuses any deck containing an unpaid block with **`unrenderable_block`, BEFORE
a cent moves** — the same placement rule the narration band follows: *a condition that makes a render
impossible must be caught UPSTREAM of the reservation, never downstream of it.* `renderReel.
batchToRender` still refuses it too (`incomplete_blocks`), but by then the clips are bought.

`jobEstimate` surfaces the same refusal with its block index, so the canvas names the block.

`ponytail:` refuse, rather than build a title card. The ceiling is that a deck mixing an AI block
with a TEXT card cannot be made at all. The upgrade path is a `drawtext` branch in
`assemble_final.sh` for a clipless index — **the DejaVu font is already baked into the sandbox
snapshot** for 20-17 — plus a regenerated mirror and its byte-identity drift test, at which point the
guard narrows to "unpaid AND no overlay text" rather than disappearing.

**A test that displaced coverage was re-homed, not dropped:** the old *"D12a AT THE RAIL: 13 sub-cent
lines"* test used a 13×TEXT deck and passed — which was the defect. The flooring-once property is now
asserted on a RENDERABLE deck, and the pure 13-line arithmetic remains in
`packages/cost/src/media.test.ts`.


## Storage retention (D12b)

~55 MB/job × 2 jobs/day = **3.3 GB/month** against a Convex Free/Starter allowance of **1 GB**. On a
successful render with a valid sidecar, the intermediate clips and voice takes are
`ctx.storage.delete()`d; **on FAILURE they are KEPT as debugging evidence**. Plan 20-16 implements it.

## Dependencies & blast radius

`fal-ai/wan-25-preview/…` is a **`-preview` endpoint**. Preview paths get renamed and retired, and a
rename turns every generation into `unknown_model` — which is the *correct* failure (loud, free) but
reads to a user as a broken feature.

**Detection is free:** one unauthenticated `GET https://fal.ai/api/models?keywords=…` returns
`deprecated` / `removed` / `status` per model. Replicate is ADR-011's recorded fallback.

**That check now runs weekly, unattended** — `.github/workflows/fal-catalog.yml` (plan 20-19), or
`pnpm check:fal-catalog` on demand. It is a **detector, not a merge gate**: it runs on a schedule,
never on `pull_request`, because a vendor price change is a task for a human rather than a reason to
block someone's unrelated PR. The shipped fixture test cannot do this job — it compares our table to
our OWN committed fixture, so both sides are ours. See `## Reconciliation` (b) for the three exit
codes and the dated proof that each one fires.

## Reconciliation

The D5 procedure. Two bullets, both runnable, both $0. Cadence: **at each phase close, and any time
a price row is edited.** **Plan 20-11's owner-run live gate IS this procedure's first run.**

**(a) Did the provider charge what we ESTIMATED?** (Not *what we reserved* — see caveat 1.) Sum
`mediaJobs.actualCents` for a period and compare against fal's own dashboard balance delta:

```bash
# from packages/backend — the convex CLI only resolves the deployment from there
npx convex run media:spendForPeriod \
  '{"tenantId":"<tenant>","sinceMs":1754006400000,"untilMs":1754611200000}'
```

`tenantId` is REQUIRED and is the tenant boundary — this reader is per-tenant by construction, so a
deployment-wide figure is the sum of per-tenant runs, never one unscoped query. The window is
**half-open** `[sinceMs, untilMs)`, so consecutive periods partition rows exactly once.

Compare the returned `actualCents` total against fal's billing page for the same window. A gap
means the table is wrong, not that the meter is wrong — the meter records what the provider
reported.

**THREE CAVEATS TRAVEL WITH THAT NUMBER, and `spendForPeriod` puts each one in its own payload
rather than relying on you to remember this page:**

1. **`estCents` is NOT what was reserved** (`notes.reservedTotalNotDerivable: true`). The
   reservation priced the whole batch **including the `render` line** and floored it to cents
   **once**; the render line has no row. Reserved is therefore always a little more than `Σ rows`.
   Do not "fix" the gap by adding a render row.
2. **A `tts` row's `estUsd` is DOUBLE by design** (`notes.ttsReservedAt2x: true` whenever any voice
   line is in range). 20-04 reserves voice at 2× so one rewrite round is pre-paid, so est/actual ≈ 2
   on voice is **healthy**. Without the flag it reads as a 100% overcharge.
3. **`unlanded > 0` means the period is NOT FINAL.** `actualCents` is absent until a row lands and
   stays absent if it failed, so the total covers only what reported. Re-run after the batch
   settles. A reader that summed silently would report an in-flight period as *cheaper*, which is
   the one failure mode a reconciliation tool must not have.

`byKind` subtotals are each rounded once, so they can differ from `estCents` by a cent or two — the
total is authoritative, and the breakdown exists because a drift in ONE table row is invisible in a
single number.

For per-plan detail: `npx convex run media:listJobs '{"tenantId":"…","planId":"<id>"}'` — a
projection, deliberately without `assetStorageId` / `assetHash` / `mimeType` / `bytes`. An operator
reconciling money has no use for storage handles, and a reader that returned them would be the
easiest accidental route to a URL (§4).

**(b) Is the price table still the vendor's price?** **Automated since 2026-08-02 (plan 20-19)** —
one command, and a weekly `fal-catalog.yml` run that does it unattended:

```bash
cd packages/backend && pnpm check:fal-catalog
```

It reads fal's catalog for all four keywords and diffs the **verbatim** `pricingInfoOverride` /
`billingMessage` strings against `packages/cost/src/media.fixtures.json`, plus
`status`/`deprecated`/`removed`. **THREE outcomes, and the third is the point:**

| Exit | Meaning | Do |
|---|---|---|
| `0` | AGREE | nothing |
| `1` | DRIFT — a string changed, a flag flipped, or a pinned id is GONE | the printed diff IS the patch: edit `media.ts` **and** the fixture together, re-run |
| `2` | UNREACHABLE | **not a price verdict.** Re-run later. Never read as green |

It diffs the STRING, never a parsed number, on purpose: a regex that extracts `$0.05` silently
passes a vendor edit that changes the *unit* — "per second" → "per generated second" is exactly the
class of change ADR-011 exists to refuse, and it moves no number at all.

FLUX schnell needs no special case. The general rule is *an entry with no pinned price string is
checked for flags and presence only* — and if the vendor ever **starts** publishing one, that is a
drift, because the MEDIUM confidence then becomes resolvable.

**Anti-vacuous proof — all three outcomes OBSERVED 2026-08-02, before the workflow was trusted:**

| Seeded | Observed |
|---|---|
| nothing (live catalog) | **exit 0**, four `OK` lines; FLUX schnell still publishes no price string, so it is still MEDIUM |
| one character changed in `inworld-tts`'s pinned string (`per 1000 character` → `characters`) | **exit 1**, `DRIFT fal-ai/inworld-tts`, printing fixture and vendor strings on adjacent lines. Fixture restored byte-identical |
| `FAL_CATALOG_BASE` pointed at an unroutable host | **exit 2**, *"UNREACHABLE — could not read fal's catalog. This is NOT a price verdict"*. Not 0, and not 1 |

That third row is why the check exists in this shape: `skillopt.yml` has been reporting green for a
year because a `|| true` swallows its failing step, and a monitor nobody has seen fail is
indistinguishable from no monitor. The old manual recipe is kept below for a machine without the
repo checked out:

```bash
curl -s "https://fal.ai/api/models?keywords=wan-25&page=1" \
  | node -e "const j=JSON.parse(require('fs').readFileSync(0));for(const m of j.items)console.log(m.id,'|',m.status,'| deprecated:',m.deprecated,'| removed:',m.removed,'|',m.pricingInfoOverride)"
# repeat for keywords=inworld, keywords=scribe, keywords=schnell
```

This is unauthenticated and free, and it is **also the endpoint-health check**: the same response
carries `deprecated` / `removed` / `status`, which is the detection mechanism for the `-preview`
rename risk below. Any change is a one-line table edit plus a fixture update — and
`media.test.ts` fails until the two agree, so the edit cannot land half-done.

**Known open item from the 2026-08-02 read:** FLUX schnell's **$0.003/megapixel is MEDIUM
confidence** — the vendor publishes the rounding rule but no price string. The first invoice that
includes an image generation resolves it.

## How to change this safely

- A rate edit is a one-line table change **plus** a `media.fixtures.json` update from a fresh catalog
  read, so the diff shows the vendor string that justified it.
- Adding a model means answering ONE question first: *what does the vendor bill on?* If the answer is
  generated-output duration or compute seconds, the answer is no.

## Playbook ownership for Phase 20

Exactly **ONE plan per wave** may bump this file, so concurrent waves never contend for it:

20-01 (W1) · 20-13 (W2) · 20-04 (W3) · 20-05 (W4) · 20-06 (W5) · **20-18 (W6)** · 20-14 (W7) ·
20-15 (W8) · 20-09 (W9) · 20-16 (W10) · 20-10 (W11) · 20-17 (W12) · 20-11 (W13) · **20-19 (W14)**.

This is why the wave graph is longer than the dependency graph alone requires.

W6 and W14 were the only waves with no owner (20-07 owns `cockpit.md`, 20-12 owns
`skill-registry.md`), which is why the two plans added on 2026-08-02 took them. **20-19 depends only
on 20-01 and is technically runnable from W2** — it sits at W14 solely because every wave in between
was already claimed. If the wave graph is ever re-cut, pull it earlier: it protects every paid plan
downstream of it.

<!-- ponytail: watch.json registers PRODUCTION paths only, deliberately NOT the `.test.ts` siblings.
     Test files are exempt from check-playbooks' creation gap, and registering them would force every
     plan in this phase that touches a media test to bump this playbook — serialising waves that share
     nothing else. If check-playbooks ever blocks on a `.test.ts` creation anyway, the fix is to add
     that ONE path, not to abandon the split.
     `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` is registered as a single FILE, not via
     its directory: `cockpit.md` already claims that directory, and a change to MediaCanvas.tsx should
     demand BOTH playbooks — it is a cockpit surface and a media surface at once. -->
