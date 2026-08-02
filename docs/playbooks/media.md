# Playbook: Media Canvas (finished reel)

> Registration note, 2026-08-02: `check-fal-catalog.mjs` was first registered here by a foreign
> session (profile-tabs) that hit the §9 creation gap on it while it was still untracked, and
> classified it without reading or running it. **The media lane has since authored, run and
> verified it — see `## Reconciliation` bullet (b) and plan 20-19.** The registration it made was
> the correct one and is kept.

> Last verified: 2026-08-02 (20-06 — **the authenticated callback and the landing plane.**
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
