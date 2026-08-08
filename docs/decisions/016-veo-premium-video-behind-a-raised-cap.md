# ADR-016: Veo 3 is admitted as an opt-in premium video model behind a raised per-job cap — Wan 2.5 stays the default

- **Status**: Accepted in principle (2026-08-07 — owner decision). **The cap raise is NOT yet landed.** See §4.
- **Amends**: ADR-011 (`011-media-provider-fal-wan25.md`) — its rejection of a premium default STANDS;
  this exercises the escape hatch ADR-011 itself wrote ("a table entry behind a raised cap and an
  explicit owner decision, not a default").
- **Does NOT supersede**: ADR-011's provider choice, ADR-012's structural media-authority boundary,
  or the whole-job reservation model.

## Context

The owner has a GCP service-account credential and asked for Gemini's media models — Imagen for
images, Veo 3 for video — alongside the Gemini text path added the same day.

ADR-011 priced Veo 3 when choosing the default and rejected it on economics, not quality:

| Model | Rate | 15 s clip | % of the $5/day text budget |
|---|---|---|---|
| Wan 2.5 (chosen default) | ~$0.05/s | ~$0.75 | ~15% |
| **Veo 3** | ~$0.40/s | **~$6.00** | **120%** |

The binding number is not that budget, though — it is **`MEDIA_JOB_CAP_USD = 3.50`**. The whole job
(every clip, every voice take, captions STT and the render) is priced and reserved as ONE number
before any request exists. **One 15-second Veo clip at ~$6.00 is 1.7× the entire per-job cap**, so
`priceJob` returns `over_job_cap` and refuses it. Veo is not merely expensive today; it is
**structurally unreachable**. Even an 8-second clip (~$3.20) fits only by leaving no room for the
voiceover and render that share its job.

## Decision

### 1. Veo 3 is admitted as opt-in premium. Wan 2.5 remains the default.

Every default stays where ADR-011 put it. Veo becomes an explicit per-job choice, never automatic,
never a fallback target, and never what an agent picks on its own.

### 2. `MEDIA_JOB_CAP_USD` rises 3.50 → **7.50** (proposed)

The owner asked for a proposed number. $7.50 is chosen against three constraints, not picked round:

- **It admits exactly one premium clip.** One 15 s Veo clip (~$6.00) + voiceover + captions + the
  $0.02 sandbox render ≈ $6.10, with headroom for price drift.
- **It refuses a premium REEL.** Two 15 s Veo clips (~$12.00) still exceed it. The runaway case — a
  six-block reel at flagship rates — stays refused by construction rather than by good intentions.
- **The daily rail becomes the real guard.** `MEDIA_DAILY_BUDGET_CENTS` is 1000 ($10/tenant/day), so
  a $7.50 job means **at most one premium job per tenant per day**. The cap and the rail bound each
  other; neither is doing the work alone.

Accepted cost: the raise is global, so a *Wan* reel may also now reserve up to $7.50 (more blocks per
reel). That is bounded by the same daily rail and is judged acceptable over the alternative — a
second, premium-only cap constant, which is more machinery for the same ceiling.

### 3. Imagen is a separate, much smaller question

Image pricing is per-image and sits far below the cap. Imagen needs a `MEDIA_IMAGE_PRICING` row and
an adapter, but **no cap change and no ADR** — it is ordinary Phase-20 table work.

### 4. The cap raise lands WITH the model, not before — and the adapter is an open fork

**A raised cap with no premium model available is widened exposure for zero benefit**, so it does not
ship on its own. This mirrors the rule `packages/cost/src/cost.ts` already enforces for text models —
a constant and its `PRICING` row land in the same commit — applied one level up: the cap and the model
it exists for land together.

**The open fork, which changes the cost of this work by an order of magnitude:**

- **Veo via fal.ai** — fal hosts Veo 3. This reuses the ENTIRE shipped media plane: the queue submit,
  the HMAC webhook onto `convex/http.ts`, the landing/reconciliation path, the vendor-drift detector.
  The change really is "a table entry plus a raised cap", exactly as ADR-011 predicted. **It does not
  use the owner's GCP credential.**
- **Veo via Vertex AI** — uses the owner's credential and the same auth as the Gemini text path, but
  **Vertex long-running prediction is POLL-based (`predictLongRunning` → `fetchPredictOperation`).
  There is no callback URL.** The shipped landing plane is webhook-driven end to end (ADR-011/012),
  so this needs a poller — new scheduled machinery, new failure modes (a poll that never terminates,
  a reservation held against an operation nobody is watching), and a second landing path to keep
  reconciled with the first.

This is not a technical toss-up: one is a config change, the other is a subsystem. **It is recorded
as an open owner decision rather than resolved here**, because the deciding factor is whether using
the existing GCP credential is worth building and maintaining a second, poll-shaped landing plane.

## Consequences

- Until §4 resolves, **nothing changes in the media rails**. `MEDIA_JOB_CAP_USD` stays 3.50 and Veo
  stays refused — the honest state, not a half-applied decision.
- Whichever path is chosen, the price row must be **computable pre-submit and bounded above** from
  the request's own parameters (ADR-011 SC#1). Veo passes only because duration is a pinned request
  parameter; a per-compute-second billing mode would be refused by construction.
- The vendor-drift detector (`check-fal-catalog.mjs`, plan 20-19) covers fal only. A Vertex-hosted
  Veo price would sit **outside** that reconciliation and would need its own, or it silently rots.
- ADR-011's reasoning is not discredited. It priced Veo correctly and rejected it correctly for a
  DEFAULT; this ADR changes what is available, not what is automatic.
