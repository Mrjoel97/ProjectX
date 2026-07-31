---
phase: 20
name: media-canvas
type: spike
status: complete-with-blockers
requirements: [MEDIA-01]
researched: 2026-07-31
verdict: "Phase 20 CANNOT proceed to implementation as scoped. All three premises in the roadmap's SC #1/#2/#3 are refuted. Needs an owner decision."
---

# Phase 20 Spike — Pikar-Ai MCP auth + pricing units

Roadmap SC #1 mandates this spike **before the media adapter action is written**, flagging that
"backend OAuth/token-exchange + per-image/per-second pricing units are unverified from the repo".

**Verified. They do not exist in the assumed form.** The spike did its job: it refuted three
load-bearing premises before any code was written. Zero shared files touched.

---

## Finding 1 — There is no MCP backend path. The connector is client-side only.

`.mcp.json` in this repo declares exactly one server:

```json
{ "mcpServers": { "graphify": { "type": "stdio", "command": "graphify-mcp", … } } }
```

**"Pikar-Ai" is not there.** It is an account-level OAuth connector on the claude.ai *client*
session — the same class as the Gmail/Canva/Stripe connectors in this session. It is reachable
from a Claude conversation and from nowhere else.

**Consequence:** a Convex action cannot call it. There is no backend OAuth/token-exchange flow to
implement, because there is no backend MCP endpoint to exchange a token *with*. The roadmap's
phrasing ("the connected Pikar-Ai MCP service") assumes a server-reachable integration that does
not exist.

## Finding 2 — "Pikar-Ai" is white-labelled Higgsfield, and the real backend is a different product

The MCP's own tool descriptions leak the upstream repeatedly: `Higgsfield Upgrade`,
`Higgsfield Credit Top-up`, `Higgsfield Auto-refill`, and `provider_name: "Higgsfield"` on the
first-party models. Third-party models (Kling, Veo 3, Seedance, MiniMax, Wan, Grok) are resold
through it.

A genuine server-to-server path **does** exist, but it is a separate product: the Higgsfield Cloud
REST API (`cloud.higgsfield.ai`), authenticated by an **API key in a request header**, with an
official Python SDK (`higgsfield-ai/higgsfield-client`). Reporting is consistent that it is
**gated behind higher-tier plans** with sparse documentation.

**This is good news for design and bad news for cost.** An API key is far simpler than OAuth
token-exchange — one Convex deployment secret (`HIGGSFIELD_API_KEY`), no refresh-token store, no
crown-jewel rotation problem like `gmailAuth.ts`. But it requires a paid plan, and its pricing
must be re-spiked because the MCP tells us nothing about it (Finding 3).

## Finding 3 — There are no per-image / per-second pricing units, and NO cost field in the API at all

The consumer product is **credit-based**: one-time packs of 500 / 1,000 / 2,000 / 4,000 credits,
plus Plus/Ultra subscriptions. Not USD-per-image and not USD-per-second-of-video.

Worse for SC #3: **the MCP exposes no cost field whatsoever.** Both `models_explore action=list`
and `action=get` were checked against every video model. Cost appears only as prose inside
parameter descriptions:

- `"Output resolution (higher = more credits)"`
- `"Use 'off' for silent video and lower credits"`
- `"'fast' = cheaper/faster"`

There is no number anywhere. You cannot compute what a generation will cost before firing it.

> **This directly blocks SC #3** — *"Media draws a separate, capped media budget line with its own
> kill-switch"*. A pre-flight cap requires a pre-flight price. Against this API you could only
> ever meter *after* the fact by polling the credit balance, which is a post-hoc reconciliation,
> not a cap. That is a materially weaker guarantee than the token-budget rail the cockpit already
> has, and it should not be shipped while claiming parity with it.

**Current account state:** `balance` → `{"credits": 0, "subscription_plan_type": "free"}`. Nothing
can be generated today regardless, and the API tier is gated.

## Finding 4 — Max video duration is 15 SECONDS, not 3 minutes. The scope is off by 12×.

Roadmap SC: *"images and video (**≤3 min**)"*. Every generative video model across all 28 checked
(2 pages, `has_more` still true but the ceiling is consistent):

| Model | Max duration |
|---|---|
| Cinema Studio 3.0 / Seedance 2.0 / Kling 3.0 / Kling 3.0 Turbo / Wan 2.7 / Grok 1.5 / MiniMax H3 / Happy Horse | **15 s** |
| Marketing Studio | 15 s |
| Cinema Studio v2 | 12 s |
| Seedance 1.5 Pro | 12 s |
| Gemini Omni Flash | 10 s |
| Kling 2.6 / Cinema Studio / Minimax Hailuo | 10 s |

**Nothing generates 180 seconds.** The only routes to longer output are not generation:

- `explainer_video` — *assembles* two or more ordered blocks with per-block voice takes. This is
  the one plausible path to a multi-minute artifact, by concatenation.
- `clipify` (Personal Clipper) — re-cuts an existing YouTube video into clips.
- `topaz_video`, `video_upscale`, `bytedance_video_upscale`, `video_deflicker`, `sync_so` —
  post-processing on video you already have.

## Where this leaves Phase 20's success criteria

| SC | Status |
|---|---|
| #1 spike before the adapter | ✅ **Done — and it refuted the premises.** This document is the deliverable. |
| #2 async job, never blocks the request | 🟡 Still sound and still worth building — but a 15 s generation is a much weaker motivation for durable async than a 3-minute one. |
| #3 separate capped media budget + kill-switch | ❌ **BLOCKED.** No pre-flight price is obtainable. Unbuildable as specified against this API. |
| #4 tenant-scoped asset refs, moderation-verdict ref, isolation assertion | ✅ Buildable — unaffected by these findings. |

## Recommendation

**Do not start Phase 20 implementation.** It needs an owner decision first, and the options are
genuinely different products:

1. **Re-scope to what the platform does** — "short-form clips (≤15 s)" instead of "≤3 min", with
   `explainer_video` as an explicit later path to longer assembled pieces. Cheapest, honest, and
   arguably a better fit for the cockpit's actual job (social/marketing assets).
2. **Buy a Higgsfield tier that unlocks the Cloud API, then re-spike pricing.** Only then can SC #3
   be designed truthfully. Costs money before we know whether the pricing API even exists.
3. **Use an aggregator with transparent per-generation billing** (e.g. VideoGenAPI / Pixazo resell
   Higgsfield with pay-per-use). This is the option that actually *restores SC #3* — a real
   per-generation price is what the budget rail needs. Worth pricing out.
4. **Defer Phase 20** and take Phase 18/19 to completion first.

**My recommendation: (1) + (3) together.** Re-scope the duration to match reality, and source the
model through something that exposes a per-generation price so the capped-budget criterion stays
real instead of being quietly downgraded to post-hoc reconciliation. Option 2 spends money to
answer a question options 1 and 3 answer for free.

## What was NOT done, deliberately

- **No generation call was made.** `generate_image` / `generate_video` cost real credits; only the
  free read-only tools (`balance`, `models_explore`) were used. The account has 0 credits anyway.
- **No purchase widget was opened.** `show_plans_and_credits` renders upgrade CTAs at the user; it
  was skipped as out of scope for a spike.
- **No adapter, schema, union member, or budget code was written** — the whole point of gating this
  behind SC #1. `packages/core/src/actionType.ts`, `convex/schema.ts`, `cards.tsx` and `llm.ts` are
  untouched, so nothing here collides with the live Phase 18/19 lanes.

## Sources

- [How to Use Higgsfield API](https://apidog.com/blog/higgsfield-api/)
- [higgsfield-ai/higgsfield-client (official Python SDK)](https://github.com/higgsfield-ai/higgsfield-client)
- [Higgsfield API — pricing & documentation overview](https://www.pixazo.ai/models/higgsfield)
- [Higgsfield API alternatives, 2026](https://www.wireflow.ai/blog/best-higgsfield-api-alternatives-in-2026)
- [Higgsfield pricing 2026 — Starter vs Plus vs Ultra](https://flowith.io/blog/higgsfield-pricing-2026-free-vs-creator-vs-studio/)
- Live MCP probes: `balance`, `models_explore(list|get)` over 28 video models, 2026-07-31.
