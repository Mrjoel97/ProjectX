# Seedance production pipeline analysis — 2026-10-24

Status: source analysis with bounded paid-comparison observations. Runtime defaults, duration
contracts, spending caps, registry activation, deployment and acceptance counts are unchanged.

The owner wants Seedance tested, prefers it as the video default, and wants to remove added visual
assets if doing so improves quality and production time. A product photograph or logo supplied
as a generation reference is different from stock filler. Final composition, audio normalization,
captions and truthful duration checks still perform necessary delivery work.

## Current code contracts

| Concern | Source and current behavior |
| --- | --- |
| Default and picture price | `packages/cost/src/media.ts`: `MEDIA_DEFAULT_VIDEO` uses `x-ai/grok-imagine-video`, 720p, four seconds; its 720p price is $0.07 per generated second. Historical model rows remain priceable and are not fallback choices. |
| Job and generated ceilings | The same module sets `MEDIA_JOB_CAP_USD = 3.5` and `MEDIA_GENERATED_SECONDS_CAP = 12`. `chooseMediaBatch` enforces both before its single aggregate cents rounding. |
| Partial regeneration | `packages/backend/convex/media.ts`, `reserveSceneJobInner`, independently sums the entire scene deck before narrowing purchase lines. This prevents buying a forbidden all-generated deck one scene at a time. Retain equivalent whole-deck protection in any candidate mode. |
| Duration grid | `packages/cost/src/media.ts`, `MEDIA_VIDEO_SECONDS`, and `packages/core/src/storyboard.ts`, `GENERATED_CLIP_SECONDS`, both encode integer clip lengths 1–15 for the current default. Existing tests enforce parity. A new model's verified grid must replace both for new plans without breaking historical reservations. |
| Final durations | `packages/core/src/storyboard.ts`, `TARGET_DURATIONS`, permits 15, 30 and 60. Brief parsing and `media.editBrief` use that set. `packages/backend/scripts/storyboard-briefs.json` explicitly contains `45-illegal-duration`; the bakeoff runner asserts its rejection. Forty-five seconds is not supported merely by changing wording. |
| Wire request | `packages/core/src/mediaProviderContract.ts`, `buildSubmitBody`, sends model, prompt, duration, resolution and portrait aspect ratio. No product-reference image or audio flag is currently carried by the video contract. |
| Durable submission | `packages/backend/convex/media.ts`, `toSubmittable`, rereads model and dimensions from the reserved job row. The candidate must preserve this relationship rather than substituting a newer global default at submission time. |
| Transport and latency | `media.submitBatch` processes rows sequentially; synchronous stock acquisition and voice generation can precede later video submissions. Video requests return asynchronous IDs and are polled separately at ten-second intervals. Removing stock can remove those fetches, but adding substantially more generated footage changes the critical path and may increase latency. |
| Final assembly | `packages/backend/convex/render/assemble_final.sh` normalizes pictures to 720×1280 at 30fps, validates scene totals against declared duration, normalizes final audio and records an assembly sidecar. Its scene path can assemble generated-only inputs; it does not require stock pictures. |
| Native video audio | The assembler drops clip audio in scenes with a narration take and retains it only for scenes without narration. Paying for native generated audio in the existing narrated path can therefore pay for discarded audio. |
| Candidate creative review | `packages/core/src/productionQuality.ts` currently admits only 30/60-second review records, caps generated footage at 12 seconds and requires two distinct stock/uploaded B-roll sources. A generated-only candidate needs an explicit matching review policy; passing the old review cannot qualify it. |
| Director instructions | `packages/contracts/skills/media-director.md` and the unactivated Phase53 `MEDIA-DIRECTOR-v7-CANDIDATE.md` teach the 12-second ceiling and mandatory mixed kinds. The generated mirror is `packages/contracts/src/skills/mediaDirector.ts`; registry seed inputs are in `packages/backend/convex/skills.ts`. Runtime prompts must remain registry-managed. |

## Verified candidate route and cost comparison

The provider-analysis agent verified public [OpenRouter video model metadata](https://openrouter.ai/api/v1/videos/models)
and the [Seedance 1.5 Pro model page](https://openrouter.ai/bytedance/seedance-1-5-pro)
on October 24. The route is `bytedance/seedance-1-5-pro`, with integer durations 4–12,
480p/720p/1080p and first/last-frame support. Its silent rate is $0.0000012 per video token;
the published formula at 720×1280 and 24fps gives $0.02592 per second. Audio doubles the token
rate. [Video API documentation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
documents `generate_audio: false`; the default is true, so silence must be explicit and priced.

**The model page announces retirement on November 11, 2026, eighteen days after this review.**
This is suitable for a bounded comparison, not a durable default without a successor plan.
The inspected Seedance 2.0 Mini silent 720p rate is approximately $0.0756/s and Fast $0.09072/s;
neither establishes a cheaper successor to the current $0.07/s Grok route.

| Generated seconds | Current Grok 720p | Seedance 1.5 Pro silent 720p |
| --- | ---: | ---: |
| 12 | $0.84 | $0.31104 |
| 30 | $2.10 | $0.7776 |
| 45 | $3.15 | $1.1664 |
| 60 | $4.20 | $1.5552 |

These are published picture arithmetic, not measured charges or an invoice ceiling. Narration,
caption transcription, rendering, planning, failed attempts and retries are excluded from this table.
Comparing a 60-second generated-only candidate against the current 12-second mixed allowance is
not a like-for-like quantity comparison. The current Grok 60-second picture total alone would
exceed the unchanged $3.50 job cap; none of these all-generated totals is currently admitted by
the 12-second policy.

The 12-second provider maximum requires at least three, four and five clip requests for
30, 45 and 60 seconds respectively. More short scenes may be needed for pacing. One generated
clip cannot replace the existing assembler for those targets, and fewer stock requests do not
establish lower total latency.

Separately, the root operator's authenticated generation lookup resolved the old stopped
transcription request's reported `total_cost` to $0.0056, with BYOK and cancellation both false.
The benchmark lane is preparing append-only reconciliation. This billing fact does not repair
the original output failure, authorize a replay, erase the stopped receipt or release an
unrelated unknown hold.

## Smallest honest candidate

1. Benchmark a bounded short Seedance clip first with recorded request fields, actual provider
   cost, elapsed generation time, decoded dimensions/duration and product-identity review.
   Identical references and shot intent are needed for a useful quality comparison. A text-only
   benchmark cannot qualify product-reference preservation.
2. Keep the existing financial and final-assembly spine. Price every submitted dimension,
   including audio when it affects billing. A reference image must come from an owned and
   explicitly selected source; do not allow a model-authored arbitrary URL.
3. Represent generated-only production explicitly on the reviewed plan and durable job contract.
   The whole deck must satisfy that mode on initial admission, estimate and selective retry.
   Generated-only means no silent stock/still substitution on provider failure. Keep references,
   captions, branding and approved sound available as separate deliberate choices.
4. Add 45 seconds end to end: target set, brief parsing/editing, actual deck validation, derived
   UI options, bakeoff fixtures and production-quality review records. A closed target does not
   imply one provider request can generate the entire target duration.
5. Use the model's verified clip grid to form exact 30/45/60-second totals. Do not stretch,
   duplicate, pad or silently add assets to compensate for an invalid generated deck. Keep
   failed generation visible and reuse successful paid clips for approved selective retries.
6. Update the registry-managed director candidate and source mirrors only after contracts agree;
   retain owner promotion and the existing budget/hold rules. User preference can select the
   intended provider, but it does not constitute measured quality or latency evidence.

## Focused verification needed for an implementation

- Pricing and request-body parity for each supported model/resolution/audio tuple; reject an
  unsupported grid point or omitted priced dimension before egress.
- Exact 30/45/60-second generated-only plans pass their mode contract; malformed sums and
  unapproved mixed kinds fail; historical mixed plans and reserved rows keep their old meaning.
- Initial estimate, initial reserve and selective retry agree on the complete deck's policy and
  unchanged job/tenant/deployment money rails. No per-scene bypass or unknown-hold release.
- Owned product-reference resolution and request binding refuse foreign/missing references.
- Actual assembly still produces full-duration video/audio and valid sidecars; the native-audio
  choice matches narration/caption behavior rather than disappearing underneath it.
- Benchmark reports compare elapsed ready-to-download time as well as source clip generation;
  no speed improvement is claimed from a model name or fewer stock calls alone.

Graphify was attempted first and is unavailable on PATH in this checkout. Navigation used scoped
`rg` searches with generated mirrors excluded, followed by reads of the identified source spans.

## Actual short-clip comparison and decision

The isolated benchmark subsequently produced the following reported charges and request elapsed
times. Each comparison is a five-second source shot, not a complete launch film. These numbers
exclude final assembly and do not establish production ready-to-download latency.

| Candidate shot | Reported cost | Elapsed | Matched Grok baseline |
| --- | ---: | ---: | --- |
| Seedance 1.5 Pro, hero | $0.13068 | 94.430s | $0.35 / 67.621s |
| Seedance 1.5 Pro, detail | $0.13068 | 99.493s | $0.35 / 58.986s |
| Seedance 2.0 Mini, hero | $0.38115 | 97.795s | $0.35 / 67.621s |

Independent visual review used the actual five-frame strips under
`.tmp/phase53-seedance-qualification-20261024/`. Observations are limited to those sampled frames:

- Grok's hero shot preserves reusable-bottle silhouettes and matte teal/terracotta colors, but
  its tall rear bottle visibly floats without support. Its detail shot is grounded and stable,
  although the teal bottle's proportions and closure differ from its first shot; cross-shot
  product identity is unproven.
- Seedance 1.5 Pro's hero shot grounds all three objects on boards and retains count/order,
  but produces glossy, rounded vase-like forms in beige/taupe instead of the matte reusable
  bottle and terracotta brief. Its detail shot changes the material to transparent glass and
  rotates an initially unsupported horizontal bottle upright without a hand or support. These
  are meaningful product and physical failures, not a qualified quality improvement.
- Seedance Mini's hero shot has the strongest sampled grounding and matte material fidelity.
  Three capped bottles stay coherent on the ledge, with teal at the right and terracotta beside
  it. The taller teal does not reproduce the baseline's dramatic rear-height hierarchy. The
  lateral push progressively crops the teal hero at the right edge. One shot cannot qualify
  cross-shot identity, full motion, labels, audio or 30/45/60-second continuity.

Seedance 1.5 Pro was approximately 62.7% cheaper per sampled shot but 39.6% and 68.7% slower than
the matching Grok requests. Mini was approximately 8.9% more expensive and 44.6% slower than its
matched baseline. No tested Seedance candidate demonstrated faster source generation here.

**Decision:** retain Seedance as a preferred quality candidate for further product-reference
qualification, with Mini the more promising sampled visual result. Keep the existing runtime
default and mixed-media policies unchanged in this work: the owner's conditional improvement
in quality and time has not been demonstrated, and removing supplementary assets would not
repair the observed generated-object failures. Preserve the exact paid outputs and report;
do not automatically repurchase, substitute stock, raise spending caps or call this a
qualified complete launch-video workflow.
