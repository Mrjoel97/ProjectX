# Director comparison — 26 October 2026

## Actual bounded result

The owner authorized at most USD0.50 additional testing within the original USD5 allowance.
Two sequential direct OpenRouter requests used the same frozen production director skill, fictional
FORMA brief, test identity, and the existing black-bottle reference image. The staging credential
was read into process memory, never printed or persisted. No new image or video was generated.

| Director | Reported cost | Response time | Production parser result |
|---|---:|---:|---|
| `openai/gpt-4.1-mini` | $0.0045764 | 15.771s | Two native 15s variations |
| `moonshotai/kimi-k3.1-pro` | $0.027624 | 55.284s | Two native 15s variations |

At the end of this two-call comparison, additional spend was **$0.0322004**, the shared ledger
total was **$4.4814872**, and unresolved attempts were **0**. The later SDK check below introduced
one unresolved attempt; the known spend total did not change.
Both responses reported the requested model and credit billing (`is_byok: false`). Both requests
finished normally with no retries, no model fallback, and no automatic routing change.

Before either request, the public catalogue confirmed both models and current token rates. The
pair's conservative policy reservations totaled $0.19; both requests had an 8,000 completion-token
ceiling and a 90s timeout. These were policy bounds, not guaranteed provider invoice ceilings.
Kimi's catalogue rate was $2/M input and $10/M output tokens; GPT-4.1-mini was $0.40/M and $1.60/M.
Source: [OpenRouter public model catalogue](https://openrouter.ai/api/v1/models).

## What the outputs show

This is an **assistant qualitative review**, not a blinded human score or a statistical benchmark.
Kimi gave more explicit camera starting positions and endpoints, including a low-to-eye-level rise,
centred overhead descent and held closing hero. It treated gold as lighting, with instructions not
to invent product detail. GPT-4.1-mini introduced a purported gold accent ring and a fabricated
`[doc:test-reference]` citation; no such Vault document was supplied. The source image shows a black
bottle with a warm edge reflection, not evidence of a gold material ring.

Both outputs met the actual storyboard/native scene validators, with three 5s scenes per variation.
Neither chose the optional explicit transition or overlay timing columns. Therefore this test does
not establish improved edited transitions, finished footage, cross-shot geometry, voice stability,
or reliable use of the new finishing controls.

**Decision:** Kimi merits further production-path evaluation; do not promote it solely on this
single pair. The existing director remains unchanged. Its clearer camera instructions can inform
the shared director skill without paying for more media.

## Subsequent SDK continuation check: stopped, not qualified

A subsequent bounded check used the actual `resolveModel` and installed OpenRouter/AI SDK, with
one read-only fixture tool and a shared90s clock. Its first provider request returned an HTTP
failure in974ms, with no reported model, generation id or cost. No retry or second request occurred.
The append-only ledger therefore now has **one unresolved attempt**; the known total remains
**$4.4814872**. Do not claim that the failed request cost zero or spend the remaining allowance.

Read-only endpoint inspection identifies a concrete probe error: both current Kimi endpoints
advertise `supports_tool_choice.function: false`, while `required`, `auto` and `none` are supported.
The probe forced the named function `searchVault`. A corrected probe must use `required` with
only that fixture tool available. This is not evidence that Kimi lacks tool support.
Source: [Kimi endpoint capabilities](https://openrouter.ai/api/v1/models/moonshotai/kimi-k3.1-pro/endpoints).

The operator recorder omitted the numeric HTTP status/error payload before process exit. They
cannot be reconstructed from the saved receipt, and the failed request has no generation id for
exact read-only billing lookup. Endpoint metadata diagnoses the unsupported parameter; it does
not prove the exact response status or invoice. Preserve this uncertainty instead of replaying.

Two free real-SDK wire tests now verify the supported `required` selection, fixture-tool result
continuation and reasoning behavior. Signed reasoning details round-trip unchanged; the installed
provider deliberately filters unsigned reasoning details. Actual Kimi tool-turn reasoning therefore
still needs a successful paid receipt before claiming production compatibility. Candidate pricing
is also absent from the application token table; it must be added with qualification before any
default migration. The correct release decision remains **keep the current director** and ship the
brand/image/finishing improvements independently. A broad model migration is not required to gain
their deterministic improvements.

## Scope and reproducibility

These calls used the same production skill and reference pixels, but **did not run the application
tool loop, Vault search, dispatch or fallback clock**. The supplied test brand was fictional and
explicitly test-only, not a customer-approved Vault kit. No production qualification is claimed.

Frozen skill SHA256: `7b58ead6610cccde6dba988b8218ecf5385c48650c8b6faa51b1eab8ab26dc0f`.
Reference SHA256: `c846f4a64227be2f0861a0f414738a4809d0be104efebb8540dc43e4e7cca0f3`.
Private local evidence is in `.tmp/phase53-director-comparison-20261026`: manifest, provider receipts,
original outputs, `supplied-runs.json` and the offline evaluation. Shared append-only receipts are
in `.tmp/phase53-paid-qualification/charges.jsonl`. Never replay the operator file to recover output.

## Offline evaluator

From repository root:

```powershell
node packages/backend/scripts/prepare-director-comparison.mjs
node packages/backend/scripts/evaluate-director-comparison.mjs --input supplied-runs.json
node --test packages/backend/scripts/evaluate-director-comparison.test.mjs
```

The evaluator makes no network requests. Supply `runs` with caseId, repetition1–3, requestedModel,
executedModel, fallbackUsed, elapsedMs, providerCostUsd, output, and pins containing skillSha256,
briefSha256, brandSha256, brandRevision, vaultFixtureSha256 and ordered productReferences hashes.
Hashes must identify the actual supplied inputs, not invented evidence. It uses the current
production storyboard/native validators and refuses mismatched pairs, stale skill/brief,
fallbacks, unknown costs and timeouts. Exit0 means structural eligibility, never creative approval.

The report includes an anonymous `reviewPacket`; give only that packet to a reviewer. Optional
review records contain reviewer, notes, seven0–4 scores in manifest rubric order, groundedClaims
and productIsolation. The evaluator never generates subjective scores or trusts supplied execution
metadata as verified billing. Verify provider/production receipts before any promotion.

Accurate customer-product 3D still needs a supplied, licensed mesh or a reviewed reconstruction
with dimensions/material references. A generated image or this director's prose cannot establish
accurate geometry. Procedural decorative graphics must not be presented as a customer's model.
