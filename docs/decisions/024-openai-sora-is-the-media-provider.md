# ADR-024: OpenAI is the whole media provider — Sora 2 for video, GPT Image 2 for stills, and the fal callback is deleted rather than retained

- **Status**: **Accepted** — 2026-08-21, recorded at the 25.1 consistency-and-reliability gate (D14)
- **Recorded**: 2026-08-21, from the shipped code rather than from a plan. Every figure below was
  read out of `packages/backend/convex/media.ts` and `packages/cost/src/media.ts` on that date; this
  ADR does not propose the cutover, it **records one that already happened and was never written
  down** — which is the defect (D14) it exists to close.
- **Supersedes**: [ADR-017](017-direct-wan-visuals-openai-audio.md), specifically its two visual
  bullets (*"generate images and videos directly through the Singapore Alibaba Model Studio
  workspace"* and *"submit Wan jobs asynchronously, poll by task id"*) and its retention clause
  (*"retain the old callback and schema fields temporarily"*). ADR-017's AUDIO decision — OpenAI for
  voice and transcription — is **not** superseded; it is now simply the whole picture rather than
  half of it, and its data-transfer approval still stands.
- **Does NOT supersede**: [ADR-011](011-media-provider-fal-wan25.md)'s price-table-in-code
  consequence, its separate-rail consequence or its no-OAuth consequence (all still load-bearing,
  and its provider line was already superseded by ADR-017 — this ADR does not re-supersede it, and
  ADR-011 stays byte-unchanged). [ADR-012](012-media-route-and-the-reel.md)'s structural
  media-authority boundary — the `media` route ships a finished reel, a specialist cannot spend —
  is untouched: a provider swap does not move an authority boundary.
  [ADR-013](013-the-render-worker.md) (the render worker), [ADR-016](016-veo-premium-video-behind-a-raised-cap.md)
  and [ADR-019](019-the-scene-timeline.md) are untouched.
- **Phases**: 20 / 20.2 / 33 shipped the code; 25.1 (plan 25.1-06) writes the record.

## Context

The media provider has moved twice and the decision record moved once.

1. ADR-011 chose **fal.ai on Wan 2.5**, with an HMAC-guarded `POST /fal/callback/*` webhook as the
   landing plane (plan 20-06).
2. ADR-017 (2026-08-13) dropped fal for **direct Alibaba Model Studio (Wan)** visuals plus OpenAI
   audio, replacing the webhook with task polling. It deliberately **retained** the fal callback and
   its schema fields *"temporarily only so jobs submitted before the cutover can still be
   interpreted"*.
3. Then the visuals moved again — to **OpenAI** — and no ADR was written. That is the state the
   codebase has been in ever since: two Accepted ADRs describing two providers, neither of which is
   the one the code posts to.

This is worse than an out-of-date document. `docs/` is the only place a decision survives a session,
and "which provider does this product send a customer's prompt to?" is a question with legal,
privacy and cost consequences. An engineer reading ADR-017 today would go looking for Alibaba code
paths that visual jobs no longer take.

The retention clause is the second half of the problem. A clause that says "temporarily" with no
expiry does not expire.

## Decision

### 1. OpenAI is the provider for every media kind

Read from `media.ts` and pinned in `packages/cost/src/media.ts`:

| Kind | Endpoint | Model / pin |
| --- | --- | --- |
| Video | `POST https://api.openai.com/v1/videos` (multipart), polled at `/v1/videos/{id}` and fetched at `/v1/videos/{id}/content` | `sora-2`, `720p` (`720x1280` portrait), **4 s** — `MEDIA_DEFAULT_VIDEO` |
| Image | `POST https://api.openai.com/v1/images/generations`, `b64_json` returned inline | `gpt-image-2`, `1024x1536`, `quality: "low"`, `png` — `MEDIA_DEFAULT_IMAGE` |
| Voice | `POST https://api.openai.com/v1/audio/speech` | `openai/tts-1`, voice `nova`, 24 kHz — `MEDIA_DEFAULT_VOICE` |
| Transcript | `POST https://api.openai.com/v1/audio/transcriptions` (multipart) | `whisper-1`, word timestamps |

Every dimension the price table keys on is submitted explicitly — never left to a provider default.
`buildSubmitBody`'s `never` arm makes that mechanical: a new priced dimension fails to compile until
the request carries it. Six four-second Sora clips are **$2.40**, which is what makes 4 s at 720p
the pin rather than a preference.

Nothing else about the money rail changes. ADR-011's rule — a stable published per-generation USD
price **table in code**, checked pre-flight, failing closed on `unknown_model` — is exactly how these
four kinds are priced. That is the part of ADR-011 this ADR is careful not to disturb.

### 2. The fal callback is DELETED, not retained

`POST /fal/callback/*`, its HMAC path segment, its replay window, its `fal.media`/`fal.ai`/`fal.run`
SSRF host allow-list, `mediaComplete.resolveJob` and the `FAL_WEBHOOK_SECRET` env name are all
removed (plan 25.1-06). ADR-017's retention clause is spent.

The verification that made this safe to do, recorded because "it looked dead" is not evidence:

- `submitLine`'s third parameter was already `_webhookUrl?` — **unused**, and its one caller passed
  two arguments. Nothing in the repo has minted a `fal_webhook` URL or a callback path segment since
  the ADR-017 cutover, so **no provider could reach the route**.
- `internal.mediaComplete.resolveJob` had exactly one caller: the route.
- `process.env.FAL_WEBHOOK_SECRET` had exactly one reader: `resolveJob`.

So the route's only reachable caller was **somebody holding `FAL_WEBHOOK_SECRET`** — for whom it
offered a `fetch` to an attacker-named URL (host-checked, but still) and a mutation that writes a
terminal `succeeded` onto a `mediaJobs` row. Keeping a landing door open for a provider that is
never going to knock is not conservatism; it is an unused authenticated write path.

`FAL_FIXTURE` **survives the cull**. Its name is a fossil but the seam is live: it still
short-circuits `media.ts`'s submit path and keeps the offline suites at $0.

### 3. The legacy Wan poller stays — and its retention is now known to be vestigial

`pollWanTask`, `wanBaseUrl`, `WAN_API_BASE_URL` and `Video_and_image_API_Key` are **left in place**,
per ADR-017's pre-cutover-interpretation rationale and the same env-gated-retention discipline the
Microsoft calendar code follows.

**Recorded honestly, because the next person to touch this deserves the finding rather than the
rationale:** `pollWanTask` is scheduled **only by itself** (its own transient-error retry, capped at
60 attempts ≈ 10 minutes). No submit path enqueues it any more. Its reachability therefore depended
entirely on Convex's scheduler queue at the moment of the cutover, and that queue drained within
minutes of 2026-08-13. It is dead in the same sense the fal route was — but unlike the route it is
an `internalAction` with no external caller and no HTTP surface, so it is not a security question,
and removing it is a media-lane change this hygiene plan was not scoped to make. Logged as a
deferred item, not smuggled in.

### 4. Both Wan env names are now CLASSIFIED, not invisible

`WAN_API_BASE_URL` and `Video_and_image_API_Key` join `MEDIA_RENDER_URL` in `ENV_MANIFEST` as
`feature` (25.1-06, D12). They were invisible to the readiness screen for their whole lives because
they are read through `requireEnvMedia("X")` — a `process.env[name]` indirection the drift scan's
literal-only regex could not see. `Video_and_image_API_Key` is spelled in Alibaba's own mixed case;
that is why the scan matches the string literal rather than a `[A-Z_]` shape.

## Alternatives rejected

- **Edit ADR-017 in place.** ADRs are immutable (CLAUDE.md §9, `docs/README.md`). Only its Status
  line is touched, which is the one edit the house rule allows.
- **One combined "media provider" ADR superseding 011, 012 and 017 together.** ADR-013 already
  argued against exactly this shape: *"a grab-bag ADR cannot be partially superseded later."* The
  provider is one decision; the reel's authority boundary is another; they move at different rates
  and this ADR touches only the first.
- **Keep the fal route behind an env flag.** The Microsoft-calendar retention rule (env-gated code
  is kept, not deleted) applies to code that is *reachable when configured*. This route is reachable
  by nobody and interprets a payload shape no provider will ever send it again — the rule's
  condition is not met.
- **Remove the Wan poller in the same commit.** Verified-then-deleted is the standard this plan
  applied to the fal route; the poller is a different lane and did not get the same scrutiny budget.
  Deleting it on a hunch is precisely what the fal verification above was designed to avoid.

## Consequences

- **OpenAI now sees prompts for visual jobs.** ADR-017 recorded that it did *not* — *"it does not
  receive prompts for visual jobs"* — and that sentence is false as of this cutover. It is the
  single most consequential line this ADR supersedes. Voice narration text and the generated voice
  audio already went there under ADR-017's approved transfer; visual prompts are new. There is no
  Alibaba transfer left on the visual path.
- **The landing plane has no HTTP door.** `mediaComplete.landResult` is reached from `media.ts`'s
  poller and from `reliabilitySweep`'s watchdog (25.1-01), both internal. The "download the bytes
  here, never persist the URL" rule (CLAUDE.md §4) moved with it and still holds — it now lives in
  the poller.
- **There is no fal spend and no fal credential.** `FAL_KEY` went at ADR-017; `FAL_WEBHOOK_SECRET`
  goes here. `FAL_FIXTURE` is a test seam and is not a credential.
- **Video is 4 seconds per clip.** Not a limitation this ADR introduces — it is `MEDIA_DEFAULT_VIDEO`
  and the whole-job cap arithmetic — but it is the number a reader of ADR-011's *"~$0.05 per second
  of Wan 2.5"* will otherwise carry away wrong.
- **This ADR is superseded the moment the provider moves again.** Do not edit it; write the
  successor and flip this Status line, per `docs/README.md`.
