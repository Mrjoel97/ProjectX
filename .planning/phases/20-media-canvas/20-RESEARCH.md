---
phase: 20
name: media-canvas
type: research
requirements: [MEDIA-01]
researched: 2026-08-01
confidence: MEDIUM-HIGH
supersedes_figures: "ADR-011 §'Why Wan 2.5 rather than a flagship' — the 15 s / $0.75 row is WRONG on two counts. See §1.3."
---

# Phase 20: Media Canvas — Research

**Researched:** 2026-08-01
**Domain:** async governed media generation (fal.ai queue + webhook), a second budget rail, a new dispatch route, a workspace canvas
**Confidence:** MEDIUM-HIGH (repo anchors HIGH; live fal rates MEDIUM — two independent sources, vendor page 429'd; webhook signature mechanics MEDIUM; Convex Ed25519 support LOW/unverified)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D1 — Surface: a new `media` specialist route (LOCKED, owner, 2026-08-01).** Media is reached by
DISPATCH, not a standalone page and not a cockpit tool. `"media"` joins `SPECIALIST_ROUTES`. **A new
ADR is required** and is part of this phase's deliverable. A new `SpecialistSpec.stepTool` literal
(`"dispatchMedia"`) joins the closed union at `specialists.ts:39-43`; `agentSteps.tool` and the
`cards.tsx` VERB entry must accept it together (the Phase 18-02 precedent). New versioned `skills`
registry rows carry the media specialist bodies (CLAUDE.md §5). The `SPECIALIST_TOOLS` capability
grant is reviewed, not silently widened.

**D2 — The media specialist PROPOSES and OPENS THE CANVAS; it never GENERATES (LOCKED).**

| Stage | Who acts | Cost | Gate |
|---|---|---|---|
| art-direction → storyboard | media specialist, read-only | tokens only (existing LLM rail) | none needed |
| canvas spin-up | media specialist emits the canvas + shot list | none | none — it is a *view* |
| **generate** | **the human**, from the canvas or by approving the plan | **fal.ai dollars** | **media budget rail + Approve** |
| regenerate one shot | **the human**, in-canvas | fal.ai dollars | media budget rail |

The media specialist stays **read-only**. The fal adapter fires from the **post-`approved`**
execution path and from **explicit human clicks inside the canvas**. Do NOT "fix" this by adding a
generate tool to `SPECIALIST_TOOLS`.

**D3 — Provider and model (LOCKED by ADR-011).** Provider **fal.ai**; default model **Wan 2.5**.
Replicate is the recorded fallback. Auth: one `FAL_KEY` Convex deployment secret. Async: fal queue +
`webhook_url` → `convex/http.ts`. **Exact per-model rates MUST be re-read from fal's live pricing
page when the adapter is written.**

**D4 — Budget numbers (LOCKED, owner, 2026-08-01).** media per-request cap **$1.00**; media daily cap
**500 cents ($5.00/day)**. Worst-case daily exposure is **$5 media + $5 text = $10**, across two rails
that never share a window. `budgetUsdPerRequest = 0.05` is NOT reused. The daily media window must be
**keyed per tenant** (the 22.1-02 correction). **A storyboard is N shots, so one approval can mean N
generations** — the planner must decide how a multi-shot storyboard is estimated and capped *as a
batch*, and what the canvas shows the user before they commit.

**D6 — Adopt the koda-stack MEDIA workflow (LOCKED, owner, 2026-08-01).** `/art-direction` PORT →
registry skill body. `/storyboard` PORT → registry skill body. `/generate` PORT the prompt shape, but
the CALL is ours. `/assemble`, `/trends`, `/brief`, `/concept`, `/script`, `/publish`, `/repurpose`
are OUT. MIT — keep an attribution note in each ported skill body's header. Do NOT clone the repo.
Follow the `documentDrafter` / `content-drafter` mirror pattern. **Gated vs ungated is a planning
decision.** "Creative DNA" needs no new storage — `businessProfile.ts` + `tenantProfile.ts` +
`docs/design/BRAND.md` already carry it. **Do not add a brand-profile table or a creative-DNA
document type.**

**D7 — The canvas lives in the WORKSPACE right pane (LOCKED, owner, 2026-08-01).** Not a new route,
not a new NAV entry. Canvas contents: art direction as a compact header; the storyboard, one tile per
shot in order with timing and description; each tile shows its generated image or video once the job
lands, and its live job status before then; assets render from tenant-scoped refs, never from a URL
held in audit. **"Simple editor" — the floor, and the ceiling.** In scope: edit a shot's prompt text,
regenerate that one shot, reorder shots, delete a shot. Out of scope: timeline scrubbing, transitions,
filters, layers, masking, audio, any client-side rendering. **The editor must not offer a control that
can spend money without showing the estimate first.** Reuse `cards.tsx`. Follow `docs/design/BRAND.md`
and use `globals.css` tokens — never a hardcoded hex. The app has no component library; do not add one.

### Claude's Discretion
- Which fal image model joins the price table alongside Wan 2.5.
- Webhook authentication mechanism — signature verification vs a secret path segment. **Match what
  `http.ts` already does** rather than inventing a third pattern.
- Table/schema shape for media jobs and assets, and where the isolation assertion lives.
- Whether art-direction and storyboard are two registry rows or one; whether they are gated.
- Plan/wave decomposition.
- **D5 — Reconciliation.** A documented **manual** procedure in the media playbook plus a `ponytail:`
  comment naming the ceiling and the upgrade path. No cron, no `/ops` panel, no reconciliation table.

### Deferred Ideas (OUT OF SCOPE)
- **koda `/assemble`** — the reel from shots + voiceover. The single most likely scope creep.
- **Multi-minute video by assembly**, and **re-cutting footage the user already has**.
- **koda content stages** (`/brief`, `/concept`, `/script`, `/publish`, `/repurpose`) and `/trends`.
- **A premium model default (Veo 3 / Seedance).**
- **Automated reconciliation** (cron or `/ops` panel).
- **A real video editor** in the canvas.
- **Agent-orchestrated media chains.**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEDIA-01 | "A media-creation canvas produces images and video (≤3 min) via the connected Pikar-Ai service as async governed jobs with a separate cost cap — generation is wrapped, not rebuilt" | §1 (fal adapter + live rates), §2 (webhook auth), §3 (verdict ref), §4 (batch budget rail), §5 (job/asset schema + isolation), §6 (dispatch surface), §7 (skill rows), §8 (canvas), §9 (koda prompts) |

> **REQUIREMENTS.md:139 IS STALE AND CONTRADICTS THE ROADMAP.** MEDIA-01 still reads "video (≤3 min)
> via the connected Pikar-Ai service". `ROADMAP.md:743-747` re-scoped both premises on 2026-08-01
> (≤15 s; not the MCP). **This phase must correct `REQUIREMENTS.md:139` in the same pass** — the
> Phase-18 precedent (its plan 18-09 owns "the two ROADMAP contradictions") is the model. A phase that
> ships against a requirement line stating a refuted premise cannot be honestly marked Complete.
</phase_requirements>

---

## Summary

This phase is **assembly, not invention**, exactly as `20-PROVIDER-EVAL.md` §2 claims — but three
things research turned up materially change the plan, and one of them is a live budget-rail defect
waiting to happen.

**First, ADR-011's price row is wrong twice.** Wan 2.5 on fal does **not** produce 15-second clips —
`fal-ai/wan-25-preview` accepts `duration` of **5 or 10 seconds only** — and its price is **tiered by
resolution** ($0.05/s at 480p, $0.10/s at 720p, $0.15/s at 1080p), with **1080p as the endpoint's
DEFAULT**. So a submit that omits `resolution` and asks for 10 s costs **$1.50** and fails the locked
$1.00 per-request cap, while an estimate computed at the ADR's "~$0.05/s" would have under-reported it
by 3×. **The adapter must pin `resolution` and `duration` explicitly on every submit, and the price
table must be keyed by the exact (model, resolution) pair submitted. Never rely on a provider
default.** This is the sharpest single finding here; nothing else in the phase can silently cost
money the way this can.

**Second, D4's open question has one correct answer: the BATCH is the priced unit and the reserved
unit.** A per-request cap applied per shot does not bound N shots at all — ten 480p 5-second clips are
ten passing $0.25 requests and one $2.50 day. And the LLM rail's shape (check in `prepare`, consume in
`recordSpend` after the fact) cannot be copied, because N fal jobs are in flight concurrently for
minutes: N concurrent checks all pass against a window nothing has consumed yet. The fix is one
transactional `internalMutation` that estimates the whole storyboard, refuses over the $1.00 cap,
`check`s the per-tenant daily window and `limit(..., reserve: true)`s it **in the same mutation** —
Convex mutations are serializable, so that pair is atomic and N concurrent batches cannot each win.

**Third, the "narrowing opportunity" CONTEXT hoped for HOLDS — but only for the skill bodies.** The
media specialist bodies can be new UNGATED registry rows that never touch `cockpit-agent`. The
dispatch ENTRY POINT cannot: `cockpit-agent.md` carries a whole `## Researching the outside world`
section teaching `dispatchResearch`, and a `dispatchMedia` tool needs its twin. The Phase-18 answer
applies verbatim — **split the `cockpit-agent` body edit into its own late plan (the 18-08 precedent)
and park only that behind Phase 16.** Everything else in Phase 20 is free of Lane-R contention.

**Primary recommendation:** build the price table as `packages/cost/src/media.ts` keyed by
(model, resolution) with `estimateMediaUsd` / `estimateBatchUsd` / `chooseMediaBatch` mirroring
`estimateCostUsd` / `chooseModel` exactly; reserve the whole batch atomically against a second named
per-tenant window before a single POST; authenticate the webhook with an HMAC path segment built from
the shipped `gmailAuth.hmacHex` primitive; download the asset bytes inside the webhook so a fal URL
never reaches the database at all; and render the canvas as one more `plan.kind` in `cards.tsx`.

---

## 1. fal.ai adapter mechanics + LIVE rates

### 1.1 Queue submission (HIGH confidence)

| Property | Value |
|---|---|
| Submit endpoint | `POST https://queue.fal.run/{model_id}` |
| Auth header | `Authorization: Key ${FAL_KEY}` |
| Webhook | query param on the submit URL: `?fal_webhook=<url-encoded callback>` |
| Submit response | `{ request_id, response_url, status_url, cancel_url, status, queue_position }` |
| Status values | `IN_QUEUE` → `IN_PROGRESS` → `COMPLETED` |
| Poll (unused here) | `GET /requests/{request_id}/status`, result at `GET /requests/{request_id}` |
| Cancel | `PUT /requests/{request_id}/cancel` |

The `request_id` is the round-trip handle: it comes back on submit and it comes back in the webhook
body as `request_id`. **We store it on our job row; we do not key the webhook lookup on it** (see §2).

Wall-clock: fal's own model page states **1–3 minutes** for Wan 2.5 (longer for 10 s). That is the
evidence for roadmap SC #2 — a synchronous action would time out; `dispatch.ts`'s `CALL_TIMEOUT_MS`
class of budget does not stretch this far.

### 1.2 The callback payload (MEDIUM-HIGH)

```json
{
  "request_id": "<uuid>",
  "gateway_request_id": "<uuid>",
  "status": "OK" | "ERROR",
  "payload": { /* the model output, or error detail */ },
  "error": "<string, ERROR only>"
}
```

For a video model the success `payload` carries `{ video: { url, content_type, file_name, file_size } }`;
for an image model `{ images: [{ url, content_type, file_name, file_size, width, height }], seed,
has_nsfw_concepts: [bool] }`.

### 1.3 LIVE rates, re-read 2026-08-01 — and the ADR-011 correction

**Wan 2.5 (`fal-ai/wan-25-preview/text-to-video`), MEDIUM confidence — two independent sources agree;
fal's own model page returned HTTP 429 to every fetch attempt, so this is NOT vendor-direct:**

| Resolution | Rate | 5 s clip | 10 s clip | Passes the $1.00 cap? |
|---|---|---|---|---|
| 480p | **$0.05/s** | $0.25 | $0.50 | ✅ both |
| 720p | **$0.10/s** | $0.50 | $1.00 | ✅ (10 s sits exactly ON the cap) |
| 1080p **(fal's DEFAULT)** | **$0.15/s** | $0.75 | **$1.50** | ❌ 10 s is REFUSED |

- **Allowed `duration`: 5 or 10 seconds. There is no 15.** Aspect ratios 16:9 / 9:16 / 1:1. Wan 2.5
  also generates native audio.
- **The endpoint is a `-preview` path.** A preview endpoint can be renamed or retired; the price table
  key must therefore be the full model id string, and `unknown_model` must fail closed (it already
  does — `cost.ts:64`).

**Image model — recommendation: `fal-ai/flux/schnell` as the default, `fal-ai/flux/dev` as the
quality row.** MEDIUM confidence.

| Model | Rate | 9:16 @ 1080×1920 (2.0736 MP → billed 3 MP) |
|---|---|---|
| `fal-ai/flux/schnell` | **$0.003/megapixel** | **$0.009/image** |
| `fal-ai/flux/dev` | **$0.025/megapixel** | **$0.075/image** |

**Images are billed rounded UP to the nearest whole megapixel.** The price function must do
`Math.ceil(megapixels)` or it under-reports every non-integer resolution — which is every 9:16 social
format koda's `/generate` defaults to.

**How ADR-011's figures moved — state this plainly in the new ADR:**

| ADR-011 claim | Reality (2026-08-01) |
|---|---|
| "Wan 2.5 ~$0.05/s" | True **only at 480p**. 720p is 2×, 1080p is 3×, and 1080p is the endpoint default. |
| "a 15 s Wan 2.5 clip is ~$0.75 → passes with headroom" | **Wan 2.5 cannot generate 15 s.** Max 10 s. At the default 1080p a 10 s clip is $1.50 and is REFUSED by the locked cap. |
| "Veo 3 (~$6.00) and Seedance 1080p (~$10.23) fail closed" | Unchanged and still the right conclusion. |
| "≤15 s is a MODEL ceiling across 28 models" | Still true as a class statement. Wan 2.5's own ceiling is tighter (10 s). The UI must not offer 15 s for Wan 2.5. |

**None of this makes a locked decision unworkable.** The $1.00 cap is in fact well sized: it admits
every 480p and 720p clip and the 5 s 1080p clip, and refuses exactly the one combination that would
eat 30% of the day in a single click. What it does invalidate is the *arithmetic in the ADR*, which
must be corrected in the new Phase-20 ADR rather than silently re-derived.

### 1.4 Where the adapter lives

- A **default-runtime `internalAction`** (NOT `"use node"`). It needs only `fetch` and, in the
  webhook, `ctx.storage.store`. `calendar.ts:1` is `"use node"` only because of its Google client
  shape; `smoke.ts:234` records the rule that a regular action already has `ctx.storage.store`.
- Reuse `calendar.ts`'s `reasonCode(response)` idiom (`calendar.ts:84`): map a provider response to a
  **code**, never carry the provider's message or body forward (§4).

---

## 2. Webhook authentication — CLOSES `20-PROVIDER-EVAL.md` §5 Q2

### 2.1 What `http.ts` does today (HIGH — read from source)

`convex/http.ts` has **three** existing route patterns, and the Gmail one is the *least* applicable:

| Route | Guard | Anchor |
|---|---|---|
| `/gmail/callback` | an **HMAC-SHA256 over `tenantId`** carried in the OAuth `state` param and re-derived on return (`verifyState`, `gmailAuth.ts:65-72`, using `hmacHex` at `gmailAuth.ts:20-38` — Web Crypto `crypto.subtle.sign("HMAC", …)`, hex-encoded) | `http.ts:15-77` |
| `/skillopt/export` | **shared bearer token** from `process.env.SKILLOPT_TOKEN`, **fail-closed** when the env is unset OR the header mismatches → 401 | `http.ts:84-97` |
| `/skillopt/writeback` | same bearer, **and** the SECURITY rule that the tenant is taken from trusted server config, never from the request body | `http.ts:105-163` |

`/skillopt/writeback` is the closest analogue: an **unauthenticated-by-default write endpoint that
inserts rows**, guarded by a shared secret with a fail-closed 401, plus a rule that nothing
security-relevant is read out of the body.

### 2.2 Does fal offer signature verification? (MEDIUM)

Yes. fal signs each webhook with an **Ed25519** signature:

- Header `X-Fal-Webhook-Signature` (hex), plus `x-fal-webhook-request-id`, `x-fal-webhook-user-id`,
  `x-fal-webhook-timestamp`.
- The signed message is the `\n`-join of `[request_id, user_id, timestamp, sha256_hex(raw_body)]`.
- Public keys at fal's JWKS: `https://rest.alpha.fal.ai/.well-known/jwks.json` (also served from
  `https://rest.fal.ai/.well-known/jwks.json`), each key's `x` field a base64url Ed25519 public key.
  Cache but **never longer than 24 h**.
- Timestamp tolerance: **300 seconds**.

**The blocker, and it is honest uncertainty, not a finding:** an `httpAction` runs in the Convex
default runtime and a file containing `http.route` cannot be `"use node"`. Whether that runtime's
`crypto.subtle` supports `importKey("raw", …, "Ed25519", …)` / `verify("Ed25519", …)` is
**UNVERIFIED** — LOW confidence either way. Verifying via a `runAction` hop into a `"use node"` module
to reach `node:crypto` would add an action round-trip, an outbound JWKS fetch, and a key cache to every
callback.

### 2.3 Recommendation — ONE mechanism

**Use a per-job HMAC path segment, built from the shipped `hmacHex` primitive.**

```
webhook_url = `${CONVEX_SITE_URL}/fal/callback/${jobId}.${await hmacHex(jobId, FAL_WEBHOOK_SECRET)}`
```

The route is `path: "/fal/callback/*"`, `method: "POST"`; the handler splits on the last `.`, re-derives
the HMAC, and **fails closed with 401** when the env is unset or the digest mismatches — the
`/skillopt/*` shape verbatim, with `gmailAuth.ts`'s `state` construction verbatim.

Why this one:

1. **It is literally the shipped pattern, twice over.** `gmailAuth.buildAuthorizeUrl:59` already
   embeds `${tenantId}.${hmacHex(tenantId, secret)}` in a URL a third party echoes back, and
   `verifyState` already re-derives it. CONTEXT explicitly says match `http.ts` rather than invent a
   third pattern. Ponytail rung 2.
2. **It needs no algorithm the Convex runtime might not have.** `crypto.subtle.sign("HMAC", …)` is
   proven in production on this deployment today.
3. **It is per-job and self-expiring.** The segment binds to ONE `mediaJobs` row; once that row is
   terminal the handler no-ops. A leaked URL buys an attacker one already-finished job.
4. **The body is not trusted for anything that matters.** Everything security-relevant —
   `tenantId`, `planId`, `model`, `estCents` — is read from the row found by `jobId`, never from the
   payload (the `http.ts:123-129` IDOR rule). The only thing taken from the body is the asset URL to
   fetch and the moderation field, and both are validated.

**Defence in depth, cheap, take it:** also require the `x-fal-webhook-timestamp` header to be within
±300 s and reject otherwise. That costs three lines and kills replay of a captured URL+body.

**`ponytail:` ceiling comment to leave at the route:** *"HMAC path segment, not Ed25519/JWKS. The
segment proves the caller knows a secret we minted for this job; it does not prove fal sent it.
Upgrade path when that matters: verify `X-Fal-Webhook-Signature` (Ed25519 over
`request_id\nuser_id\ntimestamp\nsha256(body)`) against fal's JWKS — first confirm the Convex default
runtime's `crypto.subtle` supports Ed25519; a `use node` file cannot hold an `http.route`."*

---

## 3. Moderation verdict ref — CLOSES `20-PROVIDER-EVAL.md` §5 Q1 / roadmap SC #4

### What fal actually returns (MEDIUM-HIGH)

| Path | Signal | Available for |
|---|---|---|
| **Input refused** | HTTP **422**, `type: "content_policy_violation"`, message *"The content could not be processed because it contained material flagged by a content checker"*, **non-retryable**. fal has integrated **OpenAI's Omni moderation API**; the flag may come from fal's filter or a partner's, with differing sensitivity. | **Both** images and video |
| **Output checked** | `has_nsfw_concepts: boolean[]` in the response when `enable_safety_checker` is on (default true on many image models). A flagged image is **replaced with a black image of the same dimensions**. | **Image models only** |
| **Output checked** | *(nothing)* — Wan 2.5's video output is `{ video: { url, … } }` with **no documented moderation field**. | **Video: NOT AVAILABLE** |

### The honest verdict ref — DO NOT INVENT A VERDICT

Store a **closed four-value enum** on the job row, derived only from what the provider actually said:

| Value | Set when | Means |
|---|---|---|
| `provider_blocked` | 422 `content_policy_violation` | the INPUT was refused; no asset exists |
| `checker_flagged` | the response carried `has_nsfw_concepts` and it was `true` | the provider's checker flagged this output |
| `checker_clear` | the response carried `has_nsfw_concepts` and it was `false` | the provider's checker passed this output |
| `none_reported` | an asset came back and the response carried **no** moderation field | **the provider reported nothing. This is NOT "clean."** |

**Every Wan 2.5 video lands as `none_reported`.** Say that in the playbook, in the ADR, and in the
audit-payload comment. Labelling it `passed` / `clear` / `safe` would be exactly the invented verdict
CONTEXT forbids — and it would be a compliance claim the provider never made.

The audit payload carries the enum string **plus fal's `request_id`** as the provenance ref, and
nothing else from the provider. The enum is a `AuditRef`-class string under
`packages/contracts/src/audit.ts` (flat scalar map, no nested objects) — it typechecks; the
*prohibition* on a URL is enforced by a static scan, not by the type (§5.4).

---

## 4. The budget rail, concretely — AND the D4 batch answer

### 4.1 What exists today (HIGH — read from source, post-22.1-02)

`packages/backend/convex/guardrails.ts` after 22.1-02:

```ts
export const DAILY_BUDGET_CENTS = 500;          // per TENANT
export const DEPLOYMENT_BUDGET_CENTS = 5_000;   // KEYLESS, across all tenants
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  submitRequest:        { kind: "token bucket", rate: 20,  period: HOUR, capacity: 5 },
  dailySpendCents:      { kind: "fixed window", rate: DAILY_BUDGET_CENTS,      period: 24*HOUR }, // key: tenantId
  deploymentSpendCents: { kind: "fixed window", rate: DEPLOYMENT_BUDGET_CENTS, period: 24*HOUR }, // keyless
});
const DEFAULT_CONFIG = { killSwitch: false, budgetUsdPerRequest: 0.05 };
```

- `prepare` (`:77-133`) — kill switch → PII scan → `chooseModel` → `check` tenant window → `check`
  deployment window. **Tenant checked FIRST**, so a tenant that is personally out is told so rather
  than blamed for a global pause.
- `recordSpend` (`:198-208`) — `Math.ceil(costUsd*100)`, skips `<= 0`, then `limit(..., {reserve: true})`
  on **both** rails. `reserve: true` drives the window negative rather than under-counting.
- `setKillSwitch` (`:56-70`) — the single-row `guardrailConfig` upsert: patch if present, else insert
  with defaults. Default-on-read means a missing row = kill switch OFF, zero seed, zero migration.
- `remainingDailyCents` (`:223-230`) — `Math.min` of both rails, each clamped `>= 0` first.
- **`check` does not consume; `limit` does** (confirmed against `@convex-dev/rate-limiter@0.3.2`
  typings). Both in one Convex mutation is one serializable transaction.

`packages/cost/src/cost.ts`: `PRICING` table (`:43-47`), `estimateCostUsd` → `err({code:"unknown_model"})`
when the row is missing (`:64`), `chooseModel` (`:123-138`) loops `[DEFAULT_MODEL, CHEAP_MODEL]`,
propagates any `unknown_model` **fail closed**, returns `err({code:"over_budget"})` if neither fits,
and floors cents at `Math.max(1, Math.ceil(est*100))`.

### 4.2 The media price table — `packages/cost/src/media.ts`

```ts
// A media generation is priced by (model, resolution) for video and (model, megapixels) for images.
// Keyed by the FULL fal model id: a -preview endpoint can be renamed, and an unpriced key must
// refuse, never guess (the cost.ts:64 rule).
export const MEDIA_VIDEO_PRICING: Record<string, Partial<Record<VideoRes, number>>> = {
  "fal-ai/wan-25-preview/text-to-video": { "480p": 0.05, "720p": 0.10, "1080p": 0.15 }, // USD/second
};
export const MEDIA_IMAGE_PRICING: Record<string, number> = {   // USD per WHOLE megapixel
  "fal-ai/flux/schnell": 0.003,
  "fal-ai/flux/dev":     0.025,
};

export const MEDIA_BUDGET_USD_PER_REQUEST = 1.00;  // D4 — NOT budgetUsdPerRequest (0.05)
export const MEDIA_DAILY_BUDGET_CENTS     = 500;   // D4 — mirrors DAILY_BUDGET_CENTS, own window
export const MEDIA_DEFAULT_VIDEO = { model: "fal-ai/wan-25-preview/text-to-video",
                                     resolution: "480p", seconds: 5 } as const;
export const WAN25_DURATIONS = [5, 10] as const;   // fal accepts NOTHING else

export type MediaSpec =
  | { kind: "video"; model: string; resolution: VideoRes; seconds: number }
  | { kind: "image"; model: string; width: number; height: number };

export function estimateMediaUsd(spec: MediaSpec): Result<number, CostError>;   // unknown_model → Err
export function estimateBatchUsd(specs: readonly MediaSpec[]): Result<number, CostError>; // any Err propagates
export function chooseMediaBatch(                                                // the chooseModel analogue
  specs: readonly MediaSpec[], capUsd: number,
): Result<{ estCents: number }, MediaCostError>;   // { code: "unknown_model" | "over_batch_cap" }
```

Rules the tests must pin:
- images: `Math.ceil((width*height)/1_000_000) * usdPerMegapixel` — **round the megapixels UP**.
- video: `usdPerSecond[resolution] * seconds`, and **a resolution missing from the model's row is
  `unknown_model`, not a fallback to another tier**.
- cents: `Math.max(1, Math.ceil(usd * 100))` — the `chooseModel:134` fail-closed bias, verbatim.
- `MEDIA_DEFAULT_VIDEO` pins 480p deliberately. **Never omit `resolution` on submit** — fal defaults
  to 1080p and the estimate would be 3× low.

`ponytail:` ceiling comment (D5's home): *"Hand-maintained table, sourced from fal's published pricing
2026-08-01 (NOT the vendor API — fal's model pages 429'd; two independent secondary sources agreed).
It CAN drift. Reconciliation is the manual step in docs/playbooks/media.md. Upgrade path if fal ever
publishes a machine-readable price list: fetch + cache it and keep this table as the fail-closed
fallback."*

### 4.3 The second named window + the media kill switch

```ts
// guardrails.ts — append to the SAME RateLimiter (the component already supports named windows)
mediaSpendCents: { kind: "fixed window", rate: MEDIA_DAILY_BUDGET_CENTS, period: 24 * HOUR },
// PER TENANT — every call site MUST pass { key: tenantId }. 22.1-02 exists because a keyless
// window caps the DEPLOYMENT. Do not ship the defect this repo just finished closing.
```

**Do NOT add media spend to `dailySpendCents` or `deploymentSpendCents`** — ADR-011 and D4 both say
the rails never share a window, and `ENVELOPE_FRACTION` (`dispatch.ts:45`) takes its 25% out of the
LLM rail specifically.

**Media kill switch — reuse the `guardrailConfig` single-row upsert.** Add
`mediaKillSwitch: v.optional(v.boolean())` to the `guardrailConfig` table (optional → zero migration,
the `sendAt`/`attachments` precedent) and `DEFAULT_CONFIG.mediaKillSwitch = false` so a missing row
still reads OFF. Operator control mirrors `setKillSwitch` exactly:
`npx convex run guardrails:setMediaKillSwitch '{"on":true}'`. **Two independent switches:** flipping
the LLM kill switch must not stop media and vice versa — that is the point of a separate rail. But the
media reserve should check **both** (an all-stop is an all-stop): global `killSwitch` OR
`mediaKillSwitch` → refuse.

> **Deployment ceiling for media — an open question the planner should put to the owner.** 22.1-02's
> whole argument was that per-tenant keying alone makes exposure unbounded in N. A per-tenant media
> window has exactly the same property: 10 beta tenants × $5 = $50/day of *media* on top of the
> existing $50 LLM ceiling. The symmetric fix is a keyless `deploymentMediaSpendCents` beside it.
> D4 does not name one, so this is not a locked number — recommend adding it at $5,000 cents ($50)
> to match `DEPLOYMENT_BUDGET_CENTS`, or documenting deliberately why not.

### 4.4 **The batch answer — D4's sharpest open question**

**A single $1.00 per-request cap does not bound N shots. So the batch is the request.**

The concrete mechanism, one transactional `internalMutation` (`media.reserveBatch`):

```
reserveBatch(tenantId, planId, shots[]) :
  1. cfg = getConfig(ctx)
     if cfg.killSwitch || cfg.mediaKillSwitch        -> { ok:false, reason:"kill_switch" }
  2. est = chooseMediaBatch(shots.map(toSpec), MEDIA_BUDGET_USD_PER_REQUEST)
     if !est.ok -> { ok:false, reason: est.error.code }   // unknown_model | over_batch_cap  (FAIL CLOSED)
  3. cents = est.value.estCents                            // the WHOLE deck, one number
  4. if !(await rateLimiter.check(ctx,"mediaSpendCents",{key:tenantId,count:cents})).ok
        -> { ok:false, reason:"media_daily_exhausted" }
  5. await rateLimiter.limit(ctx,"mediaSpendCents",{key:tenantId,count:cents,reserve:true})  // CONSUME NOW
  6. insert N mediaJobs rows at status "queued", each carrying its own estCents + callbackHash
  7. return { ok:true, batchId, estCents: cents, shotCount: N }
```

Why each part is load-bearing:

- **Steps 4 and 5 are in the SAME mutation.** Convex mutations are serializable (`cockpit.ts:532-534`
  states this for the double-approve CAS), so `check`-then-`limit` is atomic. Two concurrent
  storyboards cannot both pass a check against a window neither has consumed.
- **Reserve BEFORE the POST, not after.** This is the one place media must *diverge* from the LLM
  rail. `prepare`/`recordSpend` can safely check-then-record-later because LLM calls inside a turn are
  serial and an overshoot is cents. Here N jobs are submitted back-to-back and land minutes apart:
  post-hoc recording would let all N fire against a window that had room for one. `20-PROVIDER-EVAL.md`
  §4's own line — *"an LLM overshoot is cents, a media overshoot is dollars"* — is the reason.
- **`over_batch_cap` is a distinct refusal from `unknown_model`,** so the canvas can say *"this deck
  would cost $1.35, over the $1.00 per-generation limit — remove a shot or drop to 480p"* instead of
  a generic no. `chooseModel`'s two-reason error union (`:56`) is the precedent.
- **Regenerate-one-shot is a batch of one** and goes through the identical path. No second rail, no
  second cap, no bypass.
- **Reconciliation at landing, delta only.** The webhook re-prices from the SAME table using what fal
  actually produced (duration / dimensions are in the payload) and consumes only
  `actual - est` when positive: `limit("mediaSpendCents",{key,count: delta, reserve:true})`.
- **Do NOT refund an over-reservation.** If 3 of 10 shots come back `provider_blocked`, the reserved
  cents stay consumed. `ponytail:` — *"over-reservation is the fail-closed bias, same as
  `Math.max(1, Math.ceil(...))`. Refunding turns a rate-limiter window into a ledger; if drift ever
  proves material, the upgrade path is a real spend table, not a credit call."*

**What the canvas MUST show before the button is clickable (D7's "never spend without showing the
estimate first"):** the per-shot estimate, the **deck total**, the model+resolution the total was
computed at, and the remaining media budget for today (a `mediaRemainingCents` tenantQuery mirroring
`remainingDailyCents`). Worked example the copy should be able to produce: *"9 images + 1 clip —
9 × $0.009 (FLUX schnell, 1080×1920) + 1 × $0.25 (Wan 2.5, 480p, 5 s) = $0.33. $4.67 of today's
$5.00 media budget remains."*

**Failure shape to name in the plan:** the batch submit action must be **idempotent per shot**. The
action-retrier will re-run a failed action, and re-POSTing a shot that already reached fal is a
double spend. Each shot claims itself `queued → submitted` in a mutation *before* its POST, and a
row already past `queued` is skipped.

---

## 5. Media job + asset schema

### 5.1 Where things live — and the constraint that forces the split

**`plans.by_thread` is `.unique()`** (`plans.ts:396-397`) — ONE plan row per thread, and
`stageResearchPlan` (`plans.ts:123-166`) recycles it. So the storyboard cannot be "another plans row".

**Recommended split, both halves already precedented:**

| Plane | Home | Precedent |
|---|---|---|
| Storyboard CONTENT (shot prompt, description, timing, overlay, order) | **inline on `plans`**: `shots: v.optional(v.array(v.object({...})))` + `artDirection: v.optional(v.object({...}))` | `plans.attachments` (`schema.ts:196-205`) and `plans.candidates` — all optional → **zero migration**; content plane, NEVER audited (§4); `resetPlan` must wipe both (the `eventTitle` rule at `schema.ts:274-276`) |
| JOB + ASSET plane | **one new `mediaJobs` table** | `attachments` / `vaultSources` — *"a dedicated TABLE, not a vaultDocuments doc-kind — a clean…"* (`schema.ts:362`) |

Inline shots make the D7 editor one array patch (`reorder`, `delete`, `edit prompt`) instead of N row
writes plus an ordering column. **Do NOT add a separate `mediaAssets` table** — a job produces at most
one asset; the storage id lives on the job row. Ponytail rung 1.

### 5.2 `mediaJobs`

```ts
mediaJobs: defineTable({
  tenantId: v.string(),
  planId: v.id("plans"),
  batchId: v.string(),            // server-minted crypto.randomUUID(); groups one reservation
  shotIndex: v.number(),          // index into plans.shots
  provider: v.literal("fal"),     // closed literal — a second provider is a deliberate schema edit
  model: v.string(),              // MUST be a key of the media price table (fail-closed at estimate)
  spec: v.union(                  // exactly what was SUBMITTED — never a provider default
    v.object({ kind: v.literal("video"), resolution: v.string(), seconds: v.number() }),
    v.object({ kind: v.literal("image"), width: v.number(), height: v.number() }),
  ),
  promptHash: v.string(),         // §4 — the prompt TEXT lives on plans.shots, only its hash here
  status: v.union(v.literal("queued"), v.literal("submitted"), v.literal("succeeded"),
                  v.literal("failed"), v.literal("blocked")),
  callbackHash: v.string(),       // the HMAC segment we minted — the webhook's ONLY lookup key
  falRequestId: v.optional(v.string()),
  estCents: v.number(),
  actualCents: v.optional(v.number()),
  verdict: v.optional(v.union(v.literal("provider_blocked"), v.literal("checker_flagged"),
                              v.literal("checker_clear"), v.literal("none_reported"))),
  assetStorageId: v.optional(v.id("_storage")),
  assetHash: v.optional(v.string()),        // contentHash(bytes) — lib/hash.ts:5
  mimeType: v.optional(v.string()),
  bytes: v.optional(v.number()),
  failureReason: v.optional(v.string()),    // a CODE only (calendar.ts:84 reasonCode idiom) — never provider prose
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_plan", ["tenantId", "planId"])
  .index("by_callback", ["callbackHash"])       // the webhook resolves ONLY through this
  .index("by_batch", ["tenantId", "batchId"])
```

New table → **no migration, no backfill** (prior-phase discipline, `schema.ts:303`).

### 5.3 Tenant-scoped refs for binary assets — how it works today (HIGH)

The pattern is already shipped end to end and needs no invention:

1. **Write:** `ctx.storage.store(new Blob([bytes], { type }))` → `Id<"_storage">`
   (`llm.ts:947-949`, `smoke.ts:239`). The `_storage` id goes on the tenant-scoped row; the bytes
   never travel as function args (`vault.ts:645`).
2. **Read:** a **`tenantQuery`** that guards the owning row and mints the URL at read time —
   `plans.attachmentUrls` (`plans.ts:374-388`) is the template, and its header comment is the rule:
   *"the URL is a bearer capability, so it is ONLY ever returned from this tenant-guarded query and
   NEVER logged (CLAUDE.md §4). Guards on the plan row — a caller whose identity ≠ plan.tenantId gets
   an empty array, never another tenant's signed URL."*
3. **Media's version:** `media.assetUrls({ planId })` — a `tenantQuery` returning
   `[{ shotIndex, mimeType, status, verdict, url }]` where `url` is
   `await ctx.storage.getUrl(job.assetStorageId)` and any job whose `tenantId !== ctx.tenantId` yields
   nothing. Copy `plans.attachmentUrls` structurally.

**The webhook downloads the bytes.** `httpAction` has `ctx.storage`: fetch fal's result URL inside the
callback, `ctx.storage.store` it, record `assetHash = await contentHash(bytes)` (`lib/hash.ts:5`), and
**discard the fal URL entirely — it is never written to any row.** This is what makes the §4 rule
structural instead of a promise: there is nowhere in the schema for a fal URL to live.

### 5.4 Where the isolation assertion goes

- **The guard** lives in `media.assetUrls` / `media.byPlan` (`tenantQuery`, row-level
  `!== ctx.tenantId` check) and in `media.regenerateShot` / `media.generateBatch` (`tenantMutation`,
  same check) — the `executePlan` rule at `cockpit.ts:531`: *"no cross-tenant approve"*.
- **The assertion** lives in a new `packages/backend/convex/media.test.ts`, using the
  `research.test.ts` two-tenant harness (`convex-test` + registered component schemas). Assert:
  tenant B cannot read tenant A's asset URL; tenant B cannot regenerate tenant A's shot; and the
  webhook, given tenant A's `callbackHash`, writes only to tenant A's row.

### 5.5 CLAUDE.md §4 compliance — confirmed, and how it is enforced

**Audit gets id / hash / verdict-ref / counts ONLY. Never the asset. Never a signed URL.**

`packages/contracts/src/audit.ts` permits `string | number | boolean | null | readonly string[]` in a
flat map — so a URL string **would typecheck**. The type is not the guard. The guard is a static scan,
and the file for it already exists: `packages/backend/convex/llmRedaction.test.ts` (45 tests, all of
this shape — e.g. `:110` *"gmail.ts mailbox.searched audit payload is refs-only ({ queryHash,
resultCount })"*, `:876` *"voiceDoc.ts: EVERY payload object is free of report content"*).

Add there:
- **`media.ts` audit payloads are refs-only** — the allowed key set is exactly
  `{ jobId, batchId, planId, falRequestId, model, resolution, promptHash, assetHash, verdict,
  estCents, actualCents, shotCount }`. Any other key fails.
- **No `url` / `href` / `http` substring may appear in any media audit payload literal.** A signed fal
  URL in an audit row is *both* a content leak and a live credential (CONTEXT says so explicitly).
- **`media.ts` never interpolates a shot prompt into an audit/DLQ/telemetry write** — the `promptHash`
  is the only representation.
- The **log-plane surface is PINNED** to an exact audit-site count (the `voiceDoc.ts:915` idiom), so a
  later plan cannot quietly add a fifth write.

---

## 6. The dispatch surface edits — the exact diff

Phase 18-02 is the precedent and CONTEXT names it: **the schema literal and its trace label ship in
ONE plan.** `traceParity.test.ts` asserts set equality **both ways** (it reads `schema.ts` and
`cards.tsx` off disk, with a `// @vitest-environment node` pragma), and its header records that this
exact gap left `replyToMessage` rendering the generic "Working…" fallback from the day it shipped.

| # | File:anchor | Change |
|---|---|---|
| 1 | `packages/core/src/specialists.ts:23-28` | add `"media"` to `SPECIALIST_ROUTES` |
| 2 | `packages/core/src/specialists.ts:39-43` | add `"dispatchMedia"` to the `stepTool` closed union |
| 3 | `packages/core/src/specialists.ts:91-112` | add `media: { skillName: <MEDIA_*_SKILL value>, tools: SPECIALIST_TOOLS, stepTool: "dispatchMedia" }` |
| 4 | `packages/core/src/specialists.ts:58` | **reuse `SPECIALIST_TOOLS` (`["searchVault"]`) VERBATIM.** D2. Do not mint a media grant, do not add a generate tool. |
| 5 | `packages/backend/convex/schema.ts:462-522` | add `v.literal("dispatchMedia")` to `agentSteps.tool` |
| 6 | `apps/web/app/(app)/dashboard/workspace/cards.tsx:1139-1177` | add `dispatchMedia: ["Art-directing the shots…", "Storyboard ready"]` to `VERB` — **same plan as #5** |
| 7 | `packages/contracts/src/skill.ts` | export the media skill-name constants (`specialists.test.ts:46-64` reads this file off disk and asserts a matching constant for every `skillName`) |
| 8 | `packages/core/src/specialists.test.ts:23-32` | the exact-array assertion must grow `"media"` |
| 9 | `packages/core/src/specialists.test.ts:74-83` | the per-route grant assertion must grow `["media", ["searchVault"]]` |
| 10 | `packages/core/src/specialists.test.ts:202-266` | **NEW companion assertion: `diagnose()` emits no `"media"` under any input** — the ADR-010 pattern that exists today for `research` |
| 11 | `packages/core/src/specialists.test.ts:94-112` | *"every granted tool is TAUGHT in its specialist's canonical skill body"* — the media body **must teach `searchVault`** or this test goes red |
| 12 | `packages/backend/convex/schema.ts:273` | widen `plans.kind` with `v.literal("media")` |
| 13 | `packages/backend/convex/plans.ts:197` | the **hand-maintained mirror** of that union in `patchPlan` — widen together or the runtime validator rejects the new kind (the `PLAN_STATUS` Pitfall-5 lesson at `plans.ts:20-21`) |
| 14 | `packages/core/src/actionType.ts:8,:13,:39-43` | `ACTION_TYPES` + `actionTypeOf`'s param + the `ARMS` `satisfies` table — see §6.1 |
| 15 | `packages/backend/convex/cockpit.ts:505-509,:558-584` | `_ARM_TABLE` re-bind + the `externalAction` case — see §6.1 |
| 16 | `packages/backend/convex/llm.ts:811-859` | the `dispatchMedia` tool, the `dispatchResearchTool` shape verbatim (stage the plan row, schedule, return immediately) |
| 17 | `packages/backend/convex/dispatch.ts:633-654` | `runMedia` = `dispatchAndLand(…) + persistStoryboard(…)`, the `runResearch` shape verbatim |
| 18 | `packages/contracts/skills/cockpit-agent.md` | a `## Creating images and video` section — **THIS ONE PLAN parks behind Phase 16; see §7.3** |

### 6.1 The `externalAction` arm is NOT yet generic — name this as real work

`cockpit.ts:558-584` hardcodes the `externalAction` case to `retrier.run(ctx, internal.calendar.createEvent, …)`
with `onComplete: internal.calendarComplete.onCreateComplete`. **Media would be the arm's second
occupant** — `actionType.ts:30-31` pre-committed phases 18 and 19 to it, but Phase 18's scope decision
(`ROADMAP.md:703`) explicitly declined to add an `ACTION_TYPES` member, so nobody has generalized it yet.

Two options; **recommend (a):**

**(a) `media: "externalAction"`, and generalize the arm body into a per-`ActionType` table.**
Adding a member to `ACTION_TYPES` without an arm is a compile error at *two* `satisfies Record<ActionType, Arm>`
binds (`actionType.ts:43` and `cockpit.ts:509`) — that is the guarantee working as designed. Approving
a `media` plan calls `media.reserveBatch` then `retrier.run(internal.media.submitBatch, …)` with its own
`onComplete` in a non-node sibling (the `calendarComplete.ts` rule: a `"use node"` file may hold only
actions). **Cost, stated honestly:** the shipped calendar path must come out behaviourally
byte-identical, and that refactor is a named task with its own regression test, not a freebie.
**Why it wins:** roadmap SC #3's *"plan-gated by construction"* is strongest when the trigger IS the
one shipped Approve gate, and D2's table lists "approving the plan" as a legitimate generate path.

**(b) Keep media off `ACTION_TYPES`; the media card's button calls `api.media.generateBatch` directly.**
Smaller diff, no calendar-arm refactor. **But** widening `plans.kind` still breaks
`actionTypeOf(plan.kind)`'s parameter type at `cockpit.ts:547`, so `executePlan` needs an explicit
early refusal for `kind === "media"` — which is a hole wearing a guard's clothes, and it splits the
"one Approve gate" story into two.

---

## 7. The skill registry rows

### 7.1 The five-file mirror, exactly (HIGH — read from source)

Using `research-specialist` as the live example:

| # | File | Content |
|---|---|---|
| 1 | `packages/contracts/skills/<kebab-name>.md` | **the canonical, human-editable body.** e.g. `research-specialist.md` |
| 2 | `packages/contracts/src/skills/<camelName>.ts` | the **AUTO-DERIVED** escaped single-line literal, e.g. `export const researchSpecialistSkillBody = "# Research Specialist (v2)\n\nYou answer…"`. Header comment, verbatim shape: *"AUTO-DERIVED from packages/contracts/skills/<x>.md. The .md is the canonical, human-editable source. This .ts constant is the bundler-safe artifact that ships (the Convex runtime cannot fs.read repo files). A vitest sync assertion keeps the two byte-identical (LF-normalized), so this is registry-bound generated data, NOT a hardcoded prompt."* |
| 3 | `packages/contracts/src/skill.ts` | `export const MEDIA_*_SKILL = "<kebab-name>" as const;` with a doc comment stating gated/ungated **and why** |
| 4 | `packages/contracts/src/skills/skillBodies.test.ts:27-53` | a `[kebab-basename, derivedConstant]` row in the `bodies` array → the md↔ts byte-identical (LF-normalized) drift test |
| 5 | `packages/backend/convex/skills.ts:42-66` + `:279-331` | the `import { xSkillBody } from "@pikar/contracts/skills/<camelName>"` line **and** the `{ name: X_SKILL, body: xSkillBody }` entry in the `seeds` array, with a comment saying GATED or UNGATED and why |

**No `package.json` edit needed** — `@pikar/contracts` exports `"./*": "./src/*.ts"`, so
`@pikar/contracts/skills/mediaDirector` resolves for free.

`seedSkills` semantics (`skills.ts:333-381`): first run inserts **v1 active** (bootstrap — a fresh
clone must never fail closed, so **gating costs nothing until the first body edit**); re-running is
idempotent against the **newest** row; an edited body publishes `maxVersion + 1` as **candidate** if
gated, or **publish-and-activate** if not.

### 7.2 Gated vs ungated — the 18-03 precedent, and whether it applies

**It applies, and it should be taken.** Recommendation: **land the media skill bodies DELIBERATELY
UNGATED at v1**, and say so in a `skill.ts` doc comment plus a `skillBodies.test.ts` assertion.

The repo has four ungated precedents with recorded reasoning, and the media bodies match all of them:

| Precedent | Recorded reason | Applies to media? |
|---|---|---|
| `document-analyst` (`skill.ts:64-74`) | `run-eval-golden.mjs` hard-validates `--skill` against a closed name list and drives `runCockpitAgent` over **text fixtures**; it structurally cannot exercise this path, so gating **deadlocks the skill at v1 on its first body edit** | **YES — and this is the mechanical killer.** The golden runner cannot drive a storyboard/art-direction turn any more than it can drive a Realtime voice persona. |
| `business-blueprint` (`skill.ts:108-129`) | output is candidate fields **a human confirms**, not autonomous tool-state; and what is worth asserting is already CODE | **YES.** The storyboard is a proposal a human sees on a canvas and must click to pay for. |
| `business-profile` / `onboarding-agent` | the guarantee that matters is code, not prose | **YES.** The media specialist is `searchVault`-only and structurally cannot spend (D2); the budget rail is code. |
| `style-*` overlays | changes HOW, never WHAT it may do | Partially. |

**Contrast with the gated cases** (`inbox-digest`, `reply-drafter`, `research-specialist`): each
ingests **untrusted third-party content** and its value is behavioural (does it refuse to confabulate).
The media specialist ingests the tenant's own profile, blueprint and vault. There is no untrusted
ingestion boundary here.

**And the sequencing consequence is exactly the narrowing CONTEXT asked me to test — for the bodies:**
new ungated rows touch `skills.ts`'s `seeds` array (append-only), `skill.ts`, `skillBodies.test.ts` and
two new files. **Zero contact with `cockpit-agent`'s body. Zero contact with Lane R's un-activated
v16 candidate stream.** No eval run, no paid gate.

### 7.3 **But the narrowing DOES NOT extend to the dispatch entry point — get this right**

`packages/contracts/skills/cockpit-agent.md` carries a full section teaching the research dispatch —
*"## Researching the outside world … You have one tool for those: `dispatchResearch`"* — spanning
roughly lines 294-335, with rules on what the tool is for, that findings do not arrive this turn, how
to pass the question faithfully, and how to relay a refusal. **A `dispatchMedia` tool needs its twin,
or the model has a capability it was never taught to reach for.**

That edit is a `cockpit-agent` body change → a new **gated** candidate → the exact Lane-R contention
`.planning/STATE.md:35` describes (`cockpit-agent` is GATED with ONE candidate stream held un-activated
at v16, and Phase 18 must edit the same body).

**The Phase-18 answer is the right one and it is already written down:** `18-06` ships the tool, and
`18-08` — *"Teach `cockpit-agent` the tool + regenerate its one-line mirror, gated on Phase 16 closing
the shared candidate stream (Wave 6, has a blocking checkpoint)"* — is a **separate late plan with a
blocking checkpoint.**

**So state this in the plan frontmatter:**
- Plans 1..N-1 (price table, guardrails window, schema, adapter, webhook, media skill rows, canvas,
  dispatch surface, ADR, playbook) are **NOT gated on Phase 16.** They can run now.
- **Exactly one plan** — the `cockpit-agent` body section — is parked behind Phase 16 closing.
- Until that plan lands, the `dispatchMedia` tool is exercisable by the offline SMOKE driver and by an
  eval fixture, and the media plan/canvas are exercisable by the canvas controls directly. The phase is
  demonstrable without it; only the *conversational* entry point waits.
- **This makes Phase 20's gate strictly smaller than Phase 18's** (18 has two independent parks: Phase
  16 *and* `17.1-10`'s live gate). Phase 20 may therefore run earlier than Phase 18 — say so, but note
  that both edit the same `cockpit-agent` body eventually, so those two plans still serialize with
  each other.

---

## 8. The canvas

### 8.1 How the right pane decides what to render (HIGH)

```
workspace/page.tsx:209  <SplitPane left={chat} right={workspace} />
workspace/page.tsx:403    └─ <CardList threadId sending />
cards.tsx:1649            CardList: useQuery(plans.byThread) + briefings.byThread + agentSteps.latestTurn
cards.tsx:1693-1704         renders trace → SourceCard → EvaluationCard → rest()
cards.tsx:1690              rest() → <PlanCards plan threadId briefing />
cards.tsx:1708              PlanCards: status branches
cards.tsx:254               if (plan.kind === "memo")           → memo card, early return
cards.tsx:281               if (plan.kind === "calendar_event") → calendar card, early return
```

**The minimal addition is one more early-return branch of the same shape:** `if (plan.kind === "media")
return <MediaCanvas plan={plan} />;`, placed beside the other two. Both existing branches carry the
same justifying comment — *"everything below this branch is email chrome … and every word of it would
be a lie"* — which is equally true of a storyboard. `PlanCards:1713` (`hasDraft`) must also exclude
`"media"` the way it already excludes `"memo"`, or a DRAFT card prints beside the canvas.

### 8.2 Reusable verbatim from `cards.tsx`

| Primitive | Anchor | Use |
|---|---|---|
| `box` / `label` / `dim` / `btn` style objects | used throughout the memo + calendar branches (`:254-310`) | tile and header chrome |
| `capsTeal` | `:1206-1213` | the BRAND §3 tracked-caps section label ("ART DIRECTION", "STORYBOARD") |
| `traceText` | `:1217` | `{minWidth:0, overflowWrap:"anywhere"}` — **required** on any long shot description; the split handle is user-resizable |
| the `approve()` / `busy` / `note` handler | `:240-248` | the Generate button's busy state, verbatim |
| `ActivityCard`'s `aria-live="polite"` block | `:1226-1246` | per-shot job status must be hearable, not just visible (BRAND §6) |
| `.trace-line` class | `globals.css:1119` | status rows — already mono/0.75rem/`--ink-soft` with a teal ring dot |
| the `SourceCard` "dumb renderer that self-queries" idiom | `:1256-1260` | `MediaCanvas` self-queries `api.media.assetUrls` rather than threading URLs through props |

### 8.3 BRAND / `globals.css` (CLAUDE.md §10)

**`docs/design/BRAND.md:101-102` already specifies the exact tile:** *"**Output card:** titled card
('Generated image') with an UPPERCASE type badge pill ('IMAGE'), a 'Synced to workspace history'
subline, and the rendered artifact."* There is a real screenshot for it (`§7`, "generated-image output
card"). **Build the shot tile as that card.** Note the collision: `18-07` plans to implement the same
BRAND Output card in this file — coordinate rather than build a second one.

Tokens only (`apps/web/app/globals.css:8-31`): `--paper`, `--ink`, `--ink-soft`, `--rule`, `--card`,
`--canvas`, `--teal-900`, `--teal-600`, `--teal-400`, `--held`, `--held-text`, `--released`, `--glass`,
`--glass-line`. Accessibility hard rules (BRAND §6, non-negotiable): `--teal-600` on white is ~2.9:1 —
**button fills only, never small teal body text**; amber for TEXT on paper is `--held-text`, never
`--held`; never encode meaning in colour alone (a `blocked` verdict needs a word, not a red dot).

### 8.4 What would need RESTRUCTURING rather than extension — flag these

1. **`plans.by_thread` is `.unique()`.** One storyboard per thread. A user who wants a second deck must
   start a new chat, and `stageMediaPlan` must refuse a recycle that would destroy an in-flight deck —
   `stageResearchPlan`'s three-rule refusal (`plans.ts:103-166`, incl. its own `ponytail:` at `:119-121`
   naming "more than one plan row per thread" as the real fix) is the template to copy, **not** to
   generalize into a shared helper (its own comment forbids that: *"a knob for two callers that
   disagree is the abstraction §8 forbids"*).
2. **`PlanCards` assumes ONE artifact per plan.** The memo and calendar branches each render a single
   thing. A canvas is N tiles with N independent live statuses. That is a new component, not a widened
   branch — but it mounts through the same one-line `plan.kind` switch, so nothing above it changes.
3. **`CardList`'s `rest()` early-returns.** The media canvas replaces the plan card region entirely
   (like memo/calendar), so the trace + SourceCard + EvaluationCard still render above it. Good.
4. **No polling anywhere.** Job status is `useQuery(api.media.byPlan)` — Convex reactivity delivers the
   webhook's mutation to the open canvas with no ticker. `ActivityCard:1239` already records the rule:
   *"Measured server-side … never a `setInterval`."*

---

## 9. koda-stack media prompts (MIT) — the substance

Source: `github.com/timkoda/koda-stack`, MIT, files `skills/{art-direction,storyboard,generate}/SKILL.md`.
**Port the TEXT into registry rows. Do not clone the repo** (CLAUDE.md §5). **Keep an MIT attribution
line in each ported body's header** (D6).

### 9.1 `/art-direction` — The Art Director

**Asks for:** the complete visual language of a piece — palette, mood, lighting, composition,
references. Reads the user's `CLAUDE.md` for visual identity, analyses the script for visual cues, and
commits to a direction that serves the narrative.

**Output shape — a fixed 9-field block:**

```
ART DIRECTION
---
Palette: [3-5 hex colors with names]
Mood: [one sentence — the feeling this should evoke]
Lighting: [specific lighting setup — golden hour, studio, neon, etc.]
Composition: [framing rules — shallow DOF, wide, close-up dominant, etc.]
Environment: [where this takes place visually]
Texture: [film grain, clean digital, matte, glossy]
Typography: [if applicable — font style, color, placement]
References: [2-3 real-world visual references the user can look up]
Do NOT: [specific things to avoid for this piece]
---
```

**Rules worth porting:** be specific (*"warm golden light from camera left at 45 degrees"*, not *"warm
lighting"*); **colours must be hex, never vague names**; references must be findable (photographer,
film, campaign); consider the platform format (9:16 vertical) in every composition decision.

**Our substitution for koda's `CLAUDE.md`:** `businessProfile.ts` + `tenantProfile.ts` (voice,
audience, tier) and `docs/design/BRAND.md` (palette, typography, visual rules). D6 forbids a new
brand-profile table. **This maps cleanly onto the shipped grounding spine** — `renderSpine`
(`packages/core/src/blueprint.ts`) is already injected into the cockpit turn prompt and
`vaultGroundHydrated`, so the art-direction body reads it the same way every other skill does.

### 9.2 `/storyboard` — The Storyboarder ← **this is the contract**

**Asks for:** every shot of a reel mapped with precise timing, visual descriptions and type assignments.
Breaks the script into shots; assigns timing, type and visual description to each; ensures visual rhythm
matches audio pacing.

**Output shape — the shot deck, and this is the interface between specialist, plan row, canvas and
batch estimate:**

```
SHOT DECK
---
Total duration: [seconds]
Screen rec: [seconds] ([percentage]%)

| # | Time | Duration | Type | Description | Text overlay |
|---|------|----------|------|-------------|--------------|
| 1 | 0:00 | 2s   | AI         | [detailed visual description] | [if any] |
| 2 | 0:02 | 1.5s | SCREEN REC | [what's on screen]            |          |
| 3 | 0:03 | 2s   | AI         | [detailed visual description] |          |
---
```

**Shot types (a closed set — port it as one):**
- `AI` — AI-generated image or video (full screen, editorial quality)
- `SCREEN REC` — terminal or app screen recording
- `TEXT` — bold text screen with design treatment
- `VIDEO` — real footage or AI-generated video clip

**Rules:** screen recordings ≤ 20% of total duration; AI output ≥ 80% of the reel; **hard cuts only**;
the first shot must be the strongest visual; rapid montage 0.5–1.5 s per shot; every shot must have a
stated purpose or be cut; text overlays bold, ≤ 3–4 words, **never top-right** (profile zone); shots
sync to voiceover beats.

**Why the precise structure matters for us — four consumers, one schema:**

| Consumer | What it reads |
|---|---|
| `plans.shots[]` | `{ index, timeOffsetMs, durationMs, type, description, overlay?, prompt }` — `Duration` is what prices a video shot; `Type` is what decides image vs video |
| the canvas | one tile per shot, **in `index` order**, showing `Time`/`Duration`/`Description` and the asset or status |
| `estimateBatchUsd` | **only `Type: AI` and `Type: VIDEO` shots cost money.** `SCREEN REC` and `TEXT` are free — they are *instructions to the human*, not generations. Estimating them as generations inflates every deck and refuses decks that would have passed. |
| the editor | reorder = permute `index`; delete = splice; edit prompt = patch one element |

**Two adaptations forced by our constraints, and they must be in the ported body:**
1. **`Duration` must be legalised to the model.** Wan 2.5 accepts **5 or 10 seconds only**; koda's deck
   routinely uses 1.5–2 s shots. Either the body constrains video shots to `{5,10}` seconds, or the
   adapter generates a still image for short shots and video only for 5/10-second ones. **Recommend the
   latter** — it matches koda's own `AI` (image) vs `VIDEO` split and keeps the deck's rhythm honest.
2. **Total duration is NOT a generation.** A 30-second deck is 30 seconds of *assembled* output, and
   assembly is `/assemble` — explicitly OUT (ADR-011). The canvas shows shots, not a reel. Say so in
   the body so the model does not promise a finished video.

### 9.3 `/generate` — The Producer

**Asks for:** per-shot, an optimized generation prompt with model and settings.

**Output shape, per shot:**
```
SHOT [n]
---
Prompt: [the full generation prompt]
Negative prompt: [what to avoid]
Model: [which model to use]
Settings: [aspect ratio, guidance scale, steps, seed if relevant]
Output: [file path]
---
```

**Rules worth porting:** default aspect ratio **9:16 (1080×1920)**; prompts specific and technical, not
poetic; include lighting, camera angle, lens and composition in every prompt; add *"photograph, ultra
realistic, editorial quality"* for photorealistic shots; iterate on a bad prompt rather than re-running
the same one.

**Rules to DROP (they are koda's invocation, which D6 says we do not adopt):** *"Read `CLAUDE.md` for
API keys"*, *"Save all outputs in the project's `visuals/` folder"*, *"Name files `shot-01.png`"*, and
`Output: [file path]`. Our outputs are `_storage` ids on tenant-scoped rows. **Also drop `Model:` from
the model's output** — the model is chosen by our price table, not proposed in prose; a model-authored
model name is an unpriced-model vector.

**Worth recording as corroboration for D2:** koda's own `/generate` rule reads *"Never generate without
the user's approval — propose prompts first, generate after validation."* An unrelated author reached
the same split D2 locked.

---

## 10. Pitfalls, ranked by how likely this phase is to go wrong

### 1. Estimating at one resolution and submitting at the provider's default — **the money bug**
`fal-ai/wan-25-preview` defaults to **1080p**. An estimate at 480p ($0.05/s) against a submit that
omits `resolution` under-reports by **3×**, and the daily window drains at triple the rate with no test
going red. **Avoid:** the price table is keyed by `(model, resolution)`; the submit body is built FROM
the same `spec` object the estimate consumed; a test asserts the submitted JSON's `resolution` and
`duration` equal the priced spec, field for field. **Warning sign:** any code path where `resolution`
is optional, or where the fal request body is assembled separately from the estimate.

### 2. Batch cost blowout on a multi-shot storyboard — **D4's named risk**
A per-shot $1.00 cap bounds nothing: 10 shots × $0.25 = $2.50, all passing. Worse, N concurrent
`check`s pass against a window nothing has consumed. **Avoid:** §4.4 — one transactional
`reserveBatch` doing `chooseMediaBatch` → `check` → `limit(reserve:true)`, and the canvas showing the
deck total before the button is live. **Warning sign:** a per-shot budget call, or `check` and `limit`
in different mutations/actions.

### 3. A signed asset URL reaching audit — **content leak AND a live credential**
`AuditPayload` permits any string; nothing in the type system stops a URL. **Avoid:** the webhook
downloads the bytes and **never persists the fal URL anywhere**; the schema has no URL field; a static
scan in `llmRedaction.test.ts` bans `url`/`href`/`http` from every media audit payload literal and pins
the media audit-site count. **Warning sign:** a `mediaJobs` field named `url`, or `storage.getUrl`
called anywhere outside a `tenantQuery`.

### 4. An unauthenticated webhook
An unguarded `POST /fal/callback` is a write endpoint that flips job status, stores attacker-supplied
bytes as a tenant's asset, and can drive the spend reconciliation. **Avoid:** §2's HMAC path segment,
fail-closed 401 when the env is unset (the `/skillopt/*` shape), ±300 s timestamp, and **everything
security-relevant read from the row, never the body** (`http.ts:123-129`). **Warning sign:** any
`tenantId`, `planId` or cents figure taken out of the callback JSON.

### 5. Retry double-spend on batch submit
The action-retrier re-runs a failed action. A `submitBatch` that fails on shot 7 of 10 re-POSTs shots
1–6 on retry. **Avoid:** claim each shot `queued → submitted` in a mutation before its POST; skip any
row past `queued`. **Warning sign:** a submit loop with no per-shot state write.

### 6. Scope creep into `/assemble`
CONTEXT calls it *"the single most likely scope creep in this phase"*, and it is the natural finale of
the koda pipeline the storyboard's *"Total duration: [seconds]"* line invites. **Avoid:** the canvas
renders shots, never a timeline; the storyboard body says the deck is a set of assets, not a reel;
no concatenation, no audio, no transitions anywhere in the diff.

### 7. Lane R / Phase 18 `cockpit-agent` contention
Editing `cockpit-agent.md` concurrently with Lane R's un-activated v16 candidate mints a candidate
carrying both lanes' prose, and the next eval certifies untested instructions. **Avoid:** §7.3 — that
edit is its own late plan with a blocking checkpoint (18-08 precedent); everything else runs free.

### 8. The `agentSteps` literal without its VERB entry
The AI SDK **swallows** the throw from a step insert with an unknown literal: no trace row in prod,
every offline test green. `replyToMessage` shipped broken this way for a whole phase. **Avoid:** the
schema literal and the `cards.tsx` VERB entry in ONE plan; `traceParity.test.ts` asserts set equality
both ways. **Do NOT** "fix" a failure there by adding a text field to `agentSteps` — that re-opens the
§4 hole the closed union closed.

### 9. `plans.kind` widened in the schema but not in `plans.ts:197`
`patchPlan`'s `kind` validator is a **hand-maintained mirror**. Widen one and the runtime validator
rejects the new kind — the exact Pitfall-5 shape recorded at `plans.ts:20-21` for `PLAN_STATUS`.

### 10. Wan 2.5 is a `-preview` endpoint
Preview paths get renamed and retired. A rename turns every generation into `unknown_model` — which is
the **correct** failure (loud, free) but reads as a broken feature. **Avoid:** name it in the playbook's
dependency section with the reconciliation step; keep Replicate recorded as the ADR-011 fallback.

### 11. Treating `none_reported` as "clean"
Every Wan 2.5 video carries no moderation signal. A UI that renders it as a green check makes a
compliance claim the provider never made. **Avoid:** the four-value enum of §3, with copy that says
"not checked" for `none_reported`.

### 12. `check-playbooks` blocking on FOUR playbooks, not one
See §11. A plan that budgets for one new playbook will be stopped by three stale existing ones.

---

## 11. Playbook (CLAUDE.md §9)

### 11.1 The new playbook

**`docs/playbooks/media.md`** — from `docs/playbooks/TEMPLATE.md`. Must contain, at minimum: the
provider/model/price-table invariants; the pinned-`resolution` rule (§10 pitfall 1); the batch-reserve
contract; the four-value verdict enum and what `none_reported` does and does not mean; the webhook
auth mechanism and its `ponytail:` ceiling; the §4 audit-payload allow-list; **D5's manual
reconciliation procedure** (compare `sum(mediaJobs.actualCents)` for a period against fal's dashboard
balance/invoice, cadence: at each phase close and any time a rate row is edited); and the Wan-2.5
`{5,10}` second / `-preview` endpoint dependency notes.

### 11.2 `watch.json` prefixes `media.md` MUST register

```json
"media.md": [
  "packages/cost/src/media.ts",
  "packages/cost/src/media.test.ts",
  "packages/backend/convex/media.ts",
  "packages/backend/convex/media.test.ts",
  "packages/backend/convex/mediaComplete.ts",
  "apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx"
]
```

Two rules from `scripts/check-playbooks.mjs` that decide this list:
- **Creation gap (`:127-134`):** any NEW `.ts`/`.tsx`/`.mjs` under `packages/` or `apps/` that no
  playbook prefix covers **blocks the turn**. `packages/cost/` appears **nowhere** in today's
  `watch.json`, so `packages/cost/src/media.ts` is uncovered unless registered here. Test files are
  exempt from the creation gap but **not** from the staleness check.
- **Do not double-claim a prefix.** `apps/web/app/(app)/dashboard/workspace/` is already claimed by
  `cockpit.md`; registering the *file* `MediaCanvas.tsx` under `media.md` means both playbooks are
  demanded when it changes, which is correct here (it is a cockpit surface **and** a media surface) —
  but registering the whole directory would be wrong.

### 11.3 The three EXISTING playbooks this phase will also make stale

The Stop hook demands a `Last verified` bump on **every** playbook whose watched prefixes changed:

| Playbook | Triggered by |
|---|---|
| `cockpit.md` | `llm.ts`, `dispatch.ts`, `plans.ts`, `http.ts`, `actionType.ts`, `traceParity.test.ts`, `apps/web/.../workspace/` — **six or more of this phase's files** |
| `growth-diagnostic.md` | `packages/core/src/specialists.ts` **and** `specialists.test.ts` |
| `skill-registry.md` | `packages/contracts/skills/`, `packages/contracts/src/skills/`, `packages/contracts/src/skill.ts`, `packages/backend/convex/skills.ts` |

**`authorization.md` is NOT triggered** (no `lib/functions.ts` / `owner.ts` change) provided the media
controls stay `tenantMutation`/`tenantQuery` — which they should: a media job is tenant data, not an
owner control. The media **kill switch** rides `guardrails.ts` (not in any playbook's prefix list
today, so `guardrailConfig` edits trigger nothing — worth noting as a gap, not fixing here).

Budget one plan for playbooks + the ADR + the two `REQUIREMENTS.md`/`ROADMAP.md` corrections, the way
`18-09` does.

### 11.4 The new ADR — what it must say (verified against ADR-009/010)

CONTEXT D1 says a new ADR is required. **Verified: partly already covered, but a new ADR is still
genuinely owed — for different content than D1 assumes.**

- **ADR-010 already decided the superset question.** *"`SPECIALIST_ROUTES` is the set of routes the
  SYSTEM can dispatch. The routes `diagnose()` emits are a strict SUBSET of it."* Adding `media` as a
  non-`diagnose()` route is the **second instance of a decided pattern**, not a new decision. The new
  ADR should cite ADR-010 and add the companion assertion (`diagnose()` emits no `"media"`), not
  re-litigate it.
- **ADR-007** already establishes that a tool-set is a code-owned capability grant.
- **What NEITHER covers, and what ADR-012 must actually decide:** *a dispatchable route whose
  downstream product costs real money, where the specialist is structurally incapable of spending it.*
  ADR-012 records: the D2 three-stage split (propose → canvas → human-initiated paid generation); that
  "plan-gated by construction" is **structural**, since no code path runs from a dispatched specialist
  to a `fal` POST; that `SPECIALIST_TOOLS` is reused verbatim and a generate tool is **deliberately
  refused** (the `evaluateBusiness` precedent at `specialists.ts:50-56`); and the **corrected ADR-011
  arithmetic** from §1.3 — Wan 2.5 is 5/10 s, tiered by resolution, and 1080p is fal's default.
- ADRs are never edited after acceptance (CLAUDE.md §9). **ADR-011 is Accepted, so its wrong price row
  is corrected by ADR-012, not by editing ADR-011.**

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **vitest ^3.2.7**, plus **`convex-test` 0.0.54** for in-memory Convex functions |
| Config file | `packages/backend/vitest.config.ts` — `environment: "edge-runtime"`, `include: ["convex/**/*.test.ts"]`, `testTimeout: 20_000`, **no watch mode ever** |
| Env pragma | a test that reads repo files off disk needs `// @vitest-environment node` on line 1 (`traceParity.test.ts:1`, `research.test.ts:1`) — `edge-runtime` has no `node:fs` |
| Quick run (backend) | `pnpm --filter @pikar/backend test -- media` |
| Quick run (core) | `pnpm --filter @pikar/core test -- specialists` |
| Quick run (cost) | `pnpm --filter @pikar/cost test` |
| Full suite | `pnpm test` (turbo, all packages) |
| Typecheck | `pnpm typecheck` — backend baseline is **exactly 150 errors, all in test files, ZERO non-test**. Any delta is a regression. |
| Web build | `pnpm --filter @pikar/web build` (a `cards.tsx` change is not proven by vitest) |
| Playbook gate | `node scripts/check-playbooks.mjs` must exit 0 |
| **Cost of the whole suite** | **$0.** No test in this phase may call fal or OpenAI. |

### Phase Requirements → Test Map

MEDIA-01 decomposes into the roadmap's five success criteria.

| SC | Behavior | Test type | Automated command | File exists? |
|----|----------|-----------|-------------------|--------------|
| **SC1** | fal adapter builds a submit body whose `model`/`resolution`/`duration` are **exactly the priced spec** — no provider default is ever relied on | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 (`convex/media.test.ts`) |
| SC1 | `FAL_KEY` unset → the adapter refuses **before** any fetch (fail-closed, the `requireEnv` idiom) | unit | same | ❌ Wave 0 |
| SC1 | the webhook rejects a bad/absent HMAC segment with 401 and writes **nothing** | unit (convex-test http) | same | ❌ Wave 0 |
| **SC2** | submit returns immediately with `status: "submitted"`; no code path awaits completion; the canvas renders a per-shot status before any asset exists | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC2 | the webhook is the ONLY writer of `succeeded`/`failed`/`blocked`; a static scan pins that | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ exists (`llmRedaction.test.ts`) — add cases |
| **SC3** | price table: known model+resolution prices correctly; **unknown model → `unknown_model`**; **unknown resolution → `unknown_model`, never a tier fallback**; image megapixels **round UP** | pure unit, $0 | `pnpm --filter @pikar/cost test` | ❌ Wave 0 (`packages/cost/src/media.test.ts`) |
| SC3 | `chooseMediaBatch` sums N shots and returns `over_batch_cap` above $1.00; free shot types (`SCREEN REC`, `TEXT`) cost 0 | pure unit, $0 | same | ❌ Wave 0 |
| SC3 | **the D4 table, as data:** Wan 2.5 480p 10 s = $0.50 ✅; 720p 10 s = $1.00 ✅ (boundary); **1080p 10 s = $1.50 ❌ refused**; Veo-class rate ❌ refused | pure unit, $0 | same | ❌ Wave 0 |
| SC3 | `reserveBatch` refuses on `mediaKillSwitch` **and** on the global `killSwitch`, independently | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC3 | **the media window is per-tenant:** tenant A exhausting `mediaSpendCents` does not refuse tenant B (the 22.1-02 assertion, re-run for the media rail) | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **the media rail is SEPARATE:** a media reserve does not move `dailySpendCents`, and an LLM `recordSpend` does not move `mediaSpendCents` | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **plan-gated by construction:** a static scan proves no `SPECIALIST_TOOLS`/`RESEARCH_TOOLS` member reaches the fal adapter, and that `media.ts`'s submit is called only from the post-approve arm and the canvas mutations | static scan | `pnpm --filter @pikar/core test -- specialists` + `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ pattern exists — add cases |
| **SC4** | asset bytes land in `_storage`; the row holds `assetStorageId` + `assetHash`; **no field anywhere holds a fal URL** | convex-test + static scan | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC4 | audit payload keys are exactly the allow-list; **no `url`/`href`/`http` substring**; no prompt text | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ exists — add cases |
| SC4 | verdict is one of the four enum values; a video response with no moderation field yields **`none_reported`**, never a clear/pass value | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC4 | **isolation assertion:** tenant B gets `[]` from `media.assetUrls` on tenant A's plan; tenant B cannot regenerate tenant A's shot; the webhook writes only to the row its `callbackHash` resolves | convex-test, $0 | same | ❌ Wave 0 |
| **SC5** | the price table carries a `ponytail:` comment naming the ceiling and the upgrade path; `docs/playbooks/media.md` contains a runnable manual reconciliation procedure | static scan + doc | `pnpm --filter @pikar/cost test` + `node scripts/check-playbooks.mjs` | ❌ Wave 0 |
| **Surface** | `agentSteps.tool` and the `cards.tsx` VERB map agree **both ways** (i.e. `dispatchMedia` is in both) | static scan | `pnpm --filter @pikar/backend test -- traceParity` | ✅ exists (`traceParity.test.ts`) — goes RED until both land |
| **Surface** | `SPECIALIST_ROUTES` exact array; media's grant is exactly `["searchVault"]`; every granted tool is taught in the body; **`diagnose()` emits no `"media"`** | unit | `pnpm --filter @pikar/core test -- specialists` | ✅ exists — extend |
| **Surface** | every media `.md` body is byte-identical (LF-normalized) to its derived `.ts` constant; media skills are **NOT** in `GATED_SKILLS` | unit | `pnpm --filter @pikar/contracts test` | ✅ exists (`skillBodies.test.ts`) — add rows |

### How the budget rail and the isolation assertion are tested WITHOUT spending real money

**Three layers, none of which touch fal or OpenAI:**

1. **Pure-TS, zero infrastructure.** The entire price table + `estimateMediaUsd` / `estimateBatchUsd` /
   `chooseMediaBatch` live in `packages/cost` (Convex-free, CLAUDE.md §1). Every cap boundary in §1.3's
   table is a plain arithmetic assertion. This is where the D4 numbers are pinned, and it costs
   nothing and needs no harness — exactly how `cost.test.ts` already pins the LLM rail.

2. **`convex-test` with the rate-limiter component registered — real windows, fake money.**
   `research.test.ts:15-30` is the working template: it imports
   `../node_modules/@convex-dev/rate-limiter/src/component/schema.js`, registers the component modules
   via `import.meta.glob`, and drives functions that genuinely draw on the daily window. The media
   tests do the same and assert real state transitions:
   - reserve $0.33 → `mediaSpendCents` for that tenant drops by 33; another tenant's window is untouched.
   - reserve until exhausted → the next reserve returns `media_daily_exhausted` and **inserts zero
     `mediaJobs` rows** (no reservation, no jobs — proving the transaction is all-or-nothing).
   - **two-tenant isolation**, both for the window and for `assetUrls` / `regenerateShot`.
   - Mutation check (the repo's standing discipline): move `limit(...)` out of the reserve mutation
     into a separate call and the concurrency test must go **RED**; restore and it goes green.

3. **An offline fal seam, the SMOKE precedent.** `llm.ts:922-924` (`render=fail::`) and
   `smokeRun.mjs` establish the pattern: a per-request offline hook that short-circuits the external
   call. Media's version — `FAL_FIXTURE` env or a `smoke::` prompt prefix — makes `submitShot` return
   a synthetic `request_id` without a POST, and lets the test **synthesize a webhook body** (both the
   `status: "OK"` image case with `has_nsfw_concepts`, the `status: "OK"` video case with no
   moderation field, and the 422 `content_policy_violation` case) and POST it to the real route with a
   correctly-derived HMAC segment. That exercises the whole landing path — signature check, byte
   store, hash, verdict derivation, delta reconciliation, audit shape — **at $0.**
   Leave a `ponytail:` comment naming the seam and its removal condition, as `llm.ts:922` does.

**The ONE thing offline testing cannot prove** (and must therefore be an explicit, owner-run,
budgeted live gate — the 15.2 / 17.1-10 precedent): that fal's live queue accepts our submit body,
that our webhook URL is reachable from fal's egress, and that the actual billed amount matches the
table. **Budget: one 480p 5-second Wan 2.5 clip ($0.25) + one FLUX schnell image ($0.009) ≈ $0.26.**
Record the observed fal dashboard delta against `sum(mediaJobs.actualCents)` — **that single
observation IS D5's first reconciliation run**, and the playbook should say so.

### Sampling Rate

- **Per task commit:** `pnpm --filter @pikar/cost test` and `pnpm --filter @pikar/backend test -- media`
  (both < 30 s).
- **Per wave merge:** `pnpm test` + `pnpm typecheck` (backend delta must be **exactly 0** against the
  150 baseline) + `pnpm --filter @pikar/web build` for any wave touching `cards.tsx` +
  `node scripts/check-playbooks.mjs` exit 0.
- **Phase gate:** full suite green, then the live gate above (owner-run, ≈ $0.26, recorded), then
  `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `packages/cost/src/media.ts` + `packages/cost/src/media.test.ts` — price table, batch estimator,
      SC3 boundaries. **`packages/cost/` is uncovered by `watch.json`; registering it is part of this item.**
- [ ] `packages/backend/convex/media.test.ts` — the convex-test harness (copy `research.test.ts:1-40`'s
      component-schema registration block verbatim); covers SC1/SC2/SC3/SC4 and the isolation assertion.
- [ ] `packages/backend/convex/llmRedaction.test.ts` — **exists**; add the media audit allow-list scan,
      the no-URL scan, and the pinned media audit-site count.
- [ ] `packages/contracts/src/skills/skillBodies.test.ts` — **exists**; add one `bodies[]` row per media
      skill and one "DELIBERATELY UNGATED" assertion (the `business-blueprint` block at `:66-70`).
- [ ] `packages/core/src/specialists.test.ts` — **exists**; extend four assertions and add the
      `diagnose()`-emits-no-`media` companion.
- [ ] `packages/backend/convex/traceParity.test.ts` — **exists**, needs no edit; it goes RED the moment
      the schema literal lands without its VERB entry, which is the point.
- [ ] The offline fal seam (`FAL_FIXTURE` / `smoke::`) — no new framework, one branch in `media.ts`.
- [ ] Framework install: **none.** vitest + convex-test are already present and pinned.

---

## Open Questions

1. **Is the `externalAction` arm generalized, or does media bypass `executePlan`?** (§6.1)
   - **Known:** `cockpit.ts:558-584` hardcodes the calendar retrier run; `actionType.ts:30-31`
     pre-committed a second occupant; `_ARM_TABLE` makes ignoring it a compile error.
   - **Unclear:** whether the owner wants Phase 20 to pay for the arm generalization (with a
     calendar-behaviour-unchanged regression test) or to route the media Generate button around
     `executePlan`.
   - **Recommendation:** generalize (option a). D2 lists "approving the plan" as a legitimate generate
     path, and one Approve gate is the stronger SC #3 story. Flag it as its own task with its own test.

2. **Does the media rail get a keyless deployment ceiling?** (§4.3)
   - **Known:** 22.1-02's whole argument was that per-tenant keying alone leaves exposure unbounded in
     N; it shipped `deploymentSpendCents` for exactly that.
   - **Unclear:** D4 names only the per-tenant number, so this is not locked either way.
   - **Recommendation:** add `deploymentMediaSpendCents` at 5,000 cents, or record deliberately why
     not. Do not leave it unstated.

3. **Does the Convex default runtime's `crypto.subtle` support Ed25519?** (§2.2) — LOW confidence,
   unverified. Only matters if the HMAC ceiling is ever raised. A 20-minute spike inside an existing
   `httpAction` answers it; do not spend that time in this phase.

4. **Which duration values does the storyboard body allow for video shots?** (§9.2)
   - **Known:** fal accepts 5 or 10 only; koda's decks use 1.5–2 s shots.
   - **Recommendation:** image for short shots, video only at 5/10 s — which matches koda's own
     `AI` vs `VIDEO` split. Confirm in the skill body, and have the canvas refuse to price a video
     shot at any other duration.

5. **Wan 2.5 generates native audio.** Not requested, not in D6/D7, and audio raises separate
   moderation and rights questions. **Recommendation:** pin audio OFF explicitly on every submit (do
   not rely on a default — the §10.1 rule), and record it as deferred.

---

## Sources

### Primary — repo (HIGH; all read from source at the anchors cited inline)
`packages/core/src/specialists.ts`, `specialists.test.ts`, `actionType.ts`;
`packages/cost/src/cost.ts`; `packages/backend/convex/{guardrails,http,gmailAuth,plans,cockpit,dispatch,llm,schema,skills,calendar,calendarComplete}.ts`;
`packages/backend/convex/{traceParity,llmRedaction,research}.test.ts`;
`packages/contracts/src/skill.ts`, `packages/contracts/src/skills/{researchSpecialist.ts,skillBodies.test.ts}`, `packages/contracts/src/audit.ts`;
`packages/contracts/skills/cockpit-agent.md`;
`apps/web/app/(app)/dashboard/workspace/{page.tsx,cards.tsx}`, `apps/web/app/globals.css`;
`docs/design/BRAND.md`, `docs/playbooks/watch.json`, `scripts/check-playbooks.mjs`;
`docs/decisions/{007,009,010,011}`; `node_modules/@convex-dev/rate-limiter@0.3.2` typings.

### Primary — upstream source (HIGH)
- `github.com/timkoda/koda-stack` — `skills/art-direction/SKILL.md`, `skills/storyboard/SKILL.md`,
  `skills/generate/SKILL.md`, fetched verbatim 2026-08-01 via the GitHub contents API. **MIT.**

### Secondary (MEDIUM — fal's own model/docs pages returned HTTP 429 to every fetch; each claim below has ≥2 independent sources)
- [fal webhooks documentation](https://docs.fal.ai/model-apis/model-endpoints/webhooks) *(429; content reached via the guide below)*
- [fal.ai Webhooks Guide — Hooklistener](https://www.hooklistener.com/learn/fal-ai-webhooks-guide) — `fal_webhook` param, callback payload shape, Ed25519/JWKS recipe, 300 s tolerance
- [Queue API | fal.ai Reference](https://fal.ai/docs/model-endpoints/queue) — `queue.fal.run`, `request_id`, `IN_QUEUE`/`IN_PROGRESS`/`COMPLETED`
- [Error Reference — fal](https://docs.fal.ai/errors/) and [Model Errors — fal](https://fal.ai/docs/documentation/model-apis/errors) — 422 `content_policy_violation`, non-retryable
- [Trust & Safety | fal](https://fal.ai/legal/trust-and-safety) — OpenAI Omni moderation integration
- [Common Model Arguments — fal](https://fal.ai/docs/documentation/model-apis/model-arguments) — `enable_safety_checker`, `has_nsfw_concepts`, black-image replacement
- [Wan 2.5 Text to Video | fal](https://fal.ai/models/fal-ai/wan-25-preview/text-to-video) and [Wan 2.5 (Preview) is now available on fal](https://blog.fal.ai/wan-2-5-preview-is-now-available-on-fal/) — resolution-tiered $0.05/$0.10/$0.15 per second, native audio
- [Wan API Pricing Guide (Wan 2.7 / 2.6 / 2.5), 2026](https://evolink.ai/blog/wan-api-pricing-guide) — corroborates the three-tier rate
- [AI Image & Video API Pricing 2026](https://www.teamday.ai/blog/ai-api-pricing-comparison-2026) — FLUX schnell $0.003/MP, FLUX dev $0.025/MP, per-MP round-up rule; states its figures were pulled from live vendor pages in July 2026
- [FLUX.1 \[schnell\] | fal](https://fal.ai/models/fal-ai/flux/schnell), [FLUX.1 \[dev\] | fal](https://fal.ai/models/fal-ai/flux/dev)

### Tertiary (LOW — flagged for validation)
- Convex default-runtime `crypto.subtle` Ed25519 support: **not verified from any source.** Treated as
  unknown; the recommendation in §2.3 deliberately does not depend on it.
- fal webhook retry policy and delivery timeout: **not documented in anything found.** The design
  assumes at-least-once delivery and makes the callback idempotent for that reason.

---

## Metadata

**Confidence breakdown:**
- Repo anchors / reuse map: **HIGH** — every line cited was read from source in this session.
- Budget-rail design + batch mechanism: **HIGH** — derived from the shipped `guardrails.ts` /
  `cost.ts` / `@convex-dev/rate-limiter@0.3.2` semantics, all read directly.
- fal queue + webhook mechanics: **MEDIUM-HIGH** — consistent across the docs mirror and two SDKs.
- **Live fal rates: MEDIUM** — two independent sources agree on every figure, but fal's own pages
  429'd throughout. **These numbers must be re-confirmed against fal's live pricing page at
  implementation time before the table is written** (this is D3's standing requirement, and it is
  still open).
- Moderation signals: **MEDIUM-HIGH** for what exists; **HIGH** for the negative claim that Wan 2.5
  emits no per-output moderation field (checked against the documented output schema and the
  image-model contrast).
- Webhook signature mechanics: **MEDIUM**; Convex Ed25519 support: **LOW/unverified**.
- koda prompt substance: **HIGH** — fetched verbatim from the MIT repo.

**Research date:** 2026-08-01
**Valid until:** **2026-08-15** for the fal rates and the `-preview` endpoint id (fast-moving; a
preview endpoint and a promotional price tier can both move inside a month). 30 days for everything
repo-derived.
