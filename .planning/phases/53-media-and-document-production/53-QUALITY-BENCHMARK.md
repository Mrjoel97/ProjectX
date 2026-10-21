# Media quality benchmark — review packet, 2026-10-21

Status: prepared; no paid request, deployment, skill activation or owner output acceptance.
The frozen proposals are `packages/core/src/productionQuality.fixtures.ts`. The deterministic
review-record validator is `productionQuality.ts`; its empty result means the supplied assertions
meet the candidate house policy, not that code inspected pixels, listened to audio or verified a
license. All evidence in unit tests is explicitly synthetic.

## Findings that explain current quality

The current provider request explicitly sends GPT Image 2 `quality: low`, PNG, one image at
1024×1536. There is no quality selection in the persisted image job spec. The live $0.006 image
reservation is a measured short-prompt, low-quality policy estimate, not a portable price for every
quality, size or prompt length. Changing only the provider body would bypass the estimator.

Low/medium/high and explicit size are supported by the dedicated OpenRouter Images endpoint.
OpenAI's current guide has newer models too; this packet deliberately qualifies the existing
GPT Image 2 instead of silently migrating. Generated videos remain Grok Imagine at the existing
priced 720p tier, at most twelve generated seconds per reel. The locally verified fixed
720×1280/30fps delivery profile improves assembly consistency; it does not invent source detail.

Creative quality can improve through composition, a coherent palette, intentional shot purposes,
licensed B-roll coverage, spacing and pace. These are different from a higher provider quality
setting. Taste Skill guides frontend design; it is not a video-generation engine.

## Verified primary sources and price basis

Read anonymously on 2026-10-21; no account credentials or generation requests used:

- [OpenRouter Images guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation):
  dedicated `/api/v1/images`, model discovery, explicit quality/size and provider routing.
- [Dedicated supported image models](https://openrouter.ai/api/v1/images/models): GPT Image 2
  low/medium/high, `n` and reference support. More capabilities do not imply this application prices them.
- [Dedicated GPT Image 2 endpoint](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints):
  OpenAI provider, input text $5/M tokens, input image $8/M, output image $30/M.
- [OpenAI image-generation guide](https://developers.openai.com/api/docs/guides/image-generation):
  GPT Image 2 explicit quality/size, size rules and output-token calculator. Its calculator is an
  **estimate**, excludes text/image inputs and streaming partial images, and is not a billing ceiling.
- [Published calculator module inspected](https://developers.openai.com/_astro/GptImageTokenCalculator.react.wgrD2PnI.js):
  exact reproducible estimates below. The regression copies its GPT Image 2 formula, including
  round-to-even on half-integer short-axis dimensions; do not substitute the older-model token table.

Do not use the general chat `/models/.../endpoints` pricing/context metadata to price the dedicated
Images route. The chat endpoint's advertised 400,000-token context does not establish a maximum
Images billable output. No route-specific documented combined token bound, request spend limiter,
or guaranteed prompt/overhead ceiling has been established. Even 400k output tokens at $30/M would
be $12, above the existing $3.50 per-job admission cap. There is no justified higher-profile hard
exposure cap yet. A tokenizer estimate or a guessed safety percentage would not supply one.

| Explicit size | Low tokens / output estimate | Medium tokens / output estimate | High tokens / output estimate |
|---|---:|---:|---:|
| 1024×1536 portrait | 158 / $0.00474 | 1,372 / $0.04116 | 5,488 / $0.16464 |
| 1024×1024 square | 196 / $0.00588 | 1,756 / $0.05268 | 7,024 / $0.21072 |
| 1536×1024 landscape | 158 / $0.00474 | 1,372 / $0.04116 | 5,488 / $0.16464 |

Three portrait qualities total **$0.21054 estimated output only**; the nine size/quality combinations
total **$0.69036 estimated output only**. Add actual text input charges ($0.000005/token). No
references, streaming partials or automatic retry are proposed. These totals are not a payment
authorization or maximum invoice. Higher profiles remain unconnected to production egress.

## Concrete image comparison

Use fictional Soko Studio and the exact single prompt in the frozen fixture: an unbranded bottle
still life, ivory/teal/terracotta, soft window light, believable proportions, quiet upper composition,
no generated text/logos. There is no real business/product claim, private source, likeness or remote
reference. Identity consistency is a review criterion, not a capability guaranteed without references.

Proposed candidate request, one per explicit quality/size:

```json
{
  "model": "openai/gpt-image-2",
  "prompt": "EXACT productionQuality.fixtures.ts IMAGE_QUALITY_BENCHMARK.prompt",
  "n": 1,
  "size": "1024x1536",
  "quality": "medium",
  "output_format": "png",
  "provider": { "only": ["openai"], "allow_fallbacks": false }
}
```

The prompt token above is a reference to frozen text, not a literal submitted placeholder. Execute
only after the reviewed request contains that exact text and a qualified route/billing guard.
Keep input prompt identical across low/medium/high; do not claim identical composition/seed control.
Start with portrait; square/landscape are a second round if the portrait result warrants it.
Judge subject geometry, edges, material texture, lighting, palette, intentional empty space,
crop survival at9:16, absence of unwanted lettering and practical mobile use. Blind-label outputs
for owner comparison; record which is preferred and whether its cost/latency tradeoff is worthwhile.

## Representative 30/60-second reels

Frozen briefs/narration have no unsupported performance, environmental, price, certification or
testimonial claims. All scenes are five seconds; the arrays sum exactly to30/60. Narration fits the
existing fourteen-character/second preflight ceiling. Use one instrumental `warm` bed. Captions
and overlays are rendered separately; do not ask the image generator to draw words.

| Deliverable | Motion and coverage | Current shared reservation |
|---|---|---:|
| 30-second,6 scenes | 1×5s generated720p,1 still,3 distinct illustrative stock clips,1 card | **41¢** |
| 60-second,12 scenes | 2×5s generated720p,2 stills,6 distinct illustrative stock clips,2 cards | **77¢** |
| 3 baseline portrait image siblings | current low-quality1024×1536;1 image per independently recoverable item | **3¢** |
| Proposed current-profile campaign total | 5 independently tracked deliverables | **121¢ ($1.21)** |

The focused test derives reel estimates from the existing shared `chooseMediaBatch`, actual frozen
narration lengths with the existing2× voice rewrite allowance, one whole STT input minute, the
existing library bed and the flat render allowance. Cents round upward once per whole child job.
These are exact **current software reservation amounts**, not guaranteed provider invoice maxima.
They exclude director/research AI planning costs, which use their separate existing envelope.
When staged plans differ from frozen scenes/narration, discard these totals and use the fresh
review-bound estimate; never force a generated proposal into this price label.

Suggested current-profile image siblings use the frozen prompt plus these explicit composition
changes: (1) shelf hero; (2) closer material detail; (3) wider counter arrangement. Preserve palette,
lighting and bottle design. They assess style consistency under current capability, not an
unsupported size/quality matrix. Current runtime always uses portrait low.

Before asking for a paid go-ahead, stage the actual private plans, inspect scene/narration/source
tables and disclose both the fresh media reservation and separate planning envelope. A $1.21
software reservation is concrete but does not cure the inherited input-billing-bound uncertainty.
No benchmark should be described as capped real exposure while that uncertainty remains.

## Evidence and pass/rework criteria

For each output, save tenant-owned stable refs, exact reviewed plan/hash, provider request id,
explicit model/quality/size, charged usage, elapsed time and stage failures. Never put temporary
download capabilities or private prompts in audit/dead letters. Final output/credit manifest uses
stable refs; source checks name actual chosen asset URL/id and license evidence, not search results.

Apply `reviewProductionQuality` to an actual review record after generating/retrieving the artifact.
The candidate house policy uses normalized text/caption safe area x8–92%,y10–80%, minimum font
size4% of frame width, at most2 caption lines and20 characters/second,2–8s editorial scenes,
three shot scales including detail, four narrative purposes, at least two distinct licensed/owned
B-roll coverage keys, opening hook and meaningful ending. These are review policy choices, not
universal platform guarantees; inspect real target-platform chrome and revise policy deliberately.

Then review the actual media, not only its record:

1. Probe final dimensions, fps, duration, frame timestamps and codecs; decode the whole output.
2. Inspect first/middle/last frames, detail shots and every overlay/caption transition on mobile.
   Frame crop must preserve the bottle/subject; no black bars, clipped text or source upscale claims.
3. Check B-roll relevance, wide/medium/detail changes, stable design/palette and purposeful pauses.
   Stock is labelled illustrative; no claimed premises/staff/product proof from stock/generated media.
4. Listen start-to-end on headphones and phone speaker: intelligibility, full-span voice, no clip,
   abrupt cut or audible loop seam, music beneath speech. Check caption words, sync and safe area.
5. Owner rates relevance, composition, continuity, pacing and finished usefulness from1–5. Require
   at least4 in each and no technical/source/caption/audio failure. A technically playable reel can
   still fail creative acceptance; preserve the rejection reason and rework just the affected child.

## Recovery and invalid-state rehearsal

Run these locally/mocked first; no provider failures deliberately induced with paid calls:

- One failed item among succeeded siblings: retry only that selection; retain downloads and refs.
- Provider submission acknowledgement lost: `needs_reconciliation` freezes queue; no blind repurchase.
- Cancel while two children active: no new starts; active items settle truthfully into partial/cancel.
- Research/budget/claim refusal before reservation, all-silent deck, empty stock prompt, missing owned
  asset, invalid duration/generated-seconds, unavailable stock and caption failure: useful recoverable
  reason, no false success or permanent loading state. Inspect queue and watchdog terminal behavior.
- Repeated same staged tool call schedules no duplicate directors; transaction failure leaves no
  orphan campaign/children. A reservation refusal rolls back all earlier selected reservations.

Existing focused campaign tests cover offline admission/replay/rollback/partial behavior. They are
not hosted scheduler/crash/provider recovery acceptance. Actual batch acceptance needs observed
stable terminal states after approved benchmark runs; record those separately.

## Promotion decision

`MEDIA-DIRECTOR-v7-CANDIDATE.md` is a complete alternative body assembled from the existing v6
with a focused editorial section. It is outside registry seeds/canonical mirrors and is NOT active.
The media director is deliberately ungated by the text golden runner; blindly editing its seed
would auto-activate on reseed. Compare A/B outputs through the existing governed media planning
path, validate both parsed decks, inspect source refs and obtain owner creative acceptance before
an explicit registry promotion/rollback decision. No activation follows from these unit tests.

Next runtime quality implementation must persist explicit quality+placement in plan AND immutable
job specs, validate the same tuple in estimate/admission/request/reconciliation, retain legacy low
jobs, and bind changed choices to a refreshed exact review. Add only a price policy supported by
qualified evidence; label estimate/reservation honestly. No default flip until representative results
justify it. Reference-image edits require separate bounded image-input pricing and ownership checks.
