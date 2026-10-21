# Actual image comparison — 2026-10-22

Three real OpenRouter GPT Image 2 requests completed under the owner's shared $5 testing policy
allowance. The authorized staging key stayed in memory. No app default/price, registry activation,
tenant record, deployment, key configuration or publication changed. Original PNGs were inspected
with `view_image`; these are fictional unbranded bottles, not an actual business product.

| Explicit quality | Dimensions | Prompt/output tokens | Reported USD | Request latency |
|---|---|---:|---:|---:|
| low | 1024×1536 | 97 / 158 | $0.005225 | 18.823 s |
| medium | 1024×1536 | 97 / 1,372 | $0.041645 | 32.129 s |
| high | 1024×1536 | 97 / 5,488 | $0.165125 | 71.628 s |
| Total | 3 original PNGs | — | **$0.211995** | 122.580s sequential request time |

Every response reported `usage.is_byok:false` and matched the published $5/M prompt and $30/M
output-token equation exactly. These are authoritative reported request charges; they do not prove
an account invoice reconciliation or a worst-case price for arbitrary prompts. The provider response
did not report a model identity/request id, so receipts accurately retain the requested model and
the pinned provider allowlist/no-fallback basis rather than inventing response metadata.

Source receipts are `.tmp/phase53-image-qualification/journal.jsonl`; final state is `result.json`.
The shared ledger has three settled attempts and no unresolved purchase. Remaining testing policy
allowance is **$4.788005**, before any other lane's approved testing spend.

## Visual findings

- **Low:** already credible as an editorial illustration. Matte bottles have visible material
  texture and convincing contact shadows. Warm light/shadow patterns and substantial upper empty
  space make a usable composition. The front teal and terracotta bottles compete more equally for
  attention; texture is not uniformly softer than every other sample.
- **Medium:** clean silhouette and restrained material detail, with a simple composition and soft
  depth separation. Its screw-cap bottle design differs from the loop-cap designs in low/high.
  This is a meaningful identity change despite an identical prompt, not a rendering defect.
- **High:** the central rear teal bottle and foreground terracotta bottle create a clear depth
  hierarchy. Wall, stone and matte surfaces retain fine texture; lighting and shadows remain
  coherent. It is the preferred candidate for the reel still in this review, subject to the owner's
  own preference. Higher quality did not increase pixel dimensions; it used more output tokens.

All three contain exactly three unbranded bottles, one teal/two terracotta, no stray generated
lettering and a quiet upper area. They preserve the restrained ivory/teal/terracotta vocabulary.
The bottle designs/heights/caps vary; a quality control alone cannot guarantee a consistent real
product or character across a batch. Reference-driven identity needs its own qualified workflow.

A centered 9:16 crop of these 2:3 sources retains an 864 px wide region, trimming 80 px from each side.
The primary bottle silhouettes fit that region in all three. Final captions must still avoid covering
important bottle details and must be inspected after the actual pan/crop/render, not certified from
these full-source previews.

## Decision and limitations

Reuse the actual high-quality PNG for the forthcoming reel still; do not purchase another image
merely to exercise assembly. Keep the comparison originals intact. Medium is about 8× low's
reported charge here; high is about 4× medium's and 31.6× low's, and it takes materially longer.
The owner should judge whether that tradeoff is useful for the intended asset.

This is **one stochastic output per profile**, not a controlled statistical quality result. Different
compositions/material decisions cannot all be attributed to quality level. It demonstrates that the
actual route accepts all three explicit qualities and that this fixed prompt's charges reproduce the
official output-token calculator. It does not establish general prompt billing bounds, reference
identity consistency, batch recovery under live failures, finished-reel quality or owner acceptance.
Production preset/default promotion remains a separate review.
