# Image quality qualification — scoped operator proposal, 2026-10-22

This is the retained pre-execution review packet. The three requests subsequently completed;
see [the actual image comparison](53-IMAGE-RESULTS-2026-10-22.md) for costs and visual findings.

The owner approved **$5 total testing allowance** for provider benchmark and planning calls in
this chat. This is a policy target, not a guaranteed invoice ceiling. At preparation, no paid image request
had been made by this lane. No key was created/changed, production secret retrieved, price/default
changed, skill activated or deployment performed.

## Narrow first comparison

Run exactly three requests in sequence: GPT Image 2 low, medium, high; each `n:1`, PNG,
`size:1024x1536`, `stream:false`, same exact synthetic Soko Studio prompt frozen in
`packages/core/src/productionQuality.fixtures.ts`. Pin OpenAI provider and disable fallbacks.
No references, image edits, planning model calls, loop, automatic retry or second round.

Expected output-only charges remain $0.00474 + $0.04116 + $0.16464 = **$0.21054**, plus actual
prompt input billed at $0.000005/token. These are estimates, not worst-case prices. The $5
allowance is shared with any testing the integration owner authorizes in another lane; the runner
must receive the remaining allowance after that spend, rather than treating each lane as another $5.

The approved per-profile policy allowances are 25¢ low, 50¢ medium and 75¢ high. They are admission
targets, not invoice ceilings. Before each call, known shared spend plus that profile's allowance
must fit within $5. A profile overrun is recorded and stops the next purchase. Actual provider
`usage.cost` is retained even when token-rate reconciliation or billing-mode evidence fails.

The reviewed request manifest must contain the full literal prompt, exact provider/route/model,
three bodies, approval reference, remaining policy allowance and a SHA-256 digest of that content.
The original benchmark packet's placeholder prompt is never submitted literally.

## What the provider controls actually establish

[OpenRouter Limits](https://openrouter.ai/docs/api_reference/limits) documents per-key, guardrail
and workspace spend checks. Its in-flight estimate explicitly excludes image pricing, and its
budget-error example has $52 spent against a $50 budget. Consequently this evidence does not
establish a no-overshoot Images invoice ceiling. A key limit is still useful as a stop-later-request
backstop, but this run cannot describe a nominal $5 key limit as guaranteed total exposure.

[OpenRouter shared-key guidance](https://openrouter.ai/docs/guides/best-practices/capping-shared-agent-keys)
says workspace budgets reject the next request after a limit is reached. Per-key limits are
available on every plan; workspace budgets require Enterprise. BYOK counting is separately
controlled. Any future qualification key should be dedicated, have a lifetime limit and avoid BYOK
external billing; do not alter a production/shared key to prepare this experiment.

[OpenRouter's public OpenAPI](https://openrouter.ai/openapi.json), `ImageGenerationRequest`,
contains explicit quality/size/n/stream/provider controls, but no documented `max_tokens`,
`max_output_tokens` or per-request dollar limit. The dedicated GPT Image2 endpoint advertises only
`moderation` as provider passthrough. A `max_cost_in_dollars` field found elsewhere belongs to
server-tool-loop stopping after cumulative cost, not image-generation admission. It cannot cap
one image call. The public request-schema snapshot is at
`.tmp/media-quality-pricing/openrouter-image-request.json`.

[Official OpenAI spend-limit documentation](https://developers.openai.com/api/docs/guides/spend-limits)
now supports project/organization hard limits, but explicitly allows some extra usage while
enforcement propagates. Switching to the direct OpenAI route would therefore neither prove an
exact exposure ceiling nor qualify the application's actual OpenRouter route.

The [OpenAI Images request reference](https://developers.openai.com/api/reference/resources/images/methods/generate)
documents a 32,000-character prompt limit and image-count/size controls, but no Images output-token
budget. The text Responses API's `max_output_tokens` must not be assumed to bound a separately
billed image-generation tool or the application's dedicated Images route.

## Execution gate and receipts

An operator qualification is a measured experiment under this specific approval, not permission
to publish an unpriced production quality preset. Existing media playbook reconciliation expects
provider receipts and actual billing comparison; existing ordinary/evaluation LLM budget contracts
require their reviewed ceilings and cannot be repurposed to pretend this Images estimate is one.
The storyboard bakeoff exercises director proposals, not finished low/medium/high images.

A future isolated qualification runner must:

1. Default to no-egress preparation. Require an exact approved manifest digest and dedicated
   explicitly authorized operator/staging key supplied through a process environment variable. Never load a production
   `.env`, export hosted credentials, accept a key in command arguments or log an Authorization header.
2. Verify dedicated key/billing state with a read-only provider request and record a redacted
   summary. A configured nominal limit is a backstop, not a proof of no overage. Reject fixture
   mode, missing/unknown billing attestation, unrelated provider/model, changed input or reused run.
3. Write a durable local started receipt before each POST. Only one request can run at a time.
   Persist provider request id, exact usage/cost, geometry, hashes, latency and output path after
   completion. Store images locally as explicit benchmark artifacts; no publication/tenant mutation.
4. On timeout, connection loss, malformed response, absent/invalid cost, missing output or
   unexpected provider/model, stop with an unresolved receipt. Do not replay a purchase. Stop when
   reported cumulative spend reaches the remaining policy allowance, and disclose any overrun.
5. Compare the three actual images blindly, then inspect their dimensions/detail/composition and
   record the owner's preference and receipts. No price-policy/default promotion follows automatically.

## Credential availability and subsequent owner authorization

Names-only process inspection found no configured `OPENROUTER_API_KEY`,
`OPENROUTER_QUALIFICATION_API_KEY`, `OPENAI_API_KEY`, `CONVEX_DEPLOYMENT` or `CONVEX_DEPLOY_KEY`.
The isolated worktree has no supplied operator credential. The repository's
`docs/operations.md` source-of-truth map places provider secrets in hosted Convex; historical
names-only staging checks do not grant a safe local retrieval path. No values were read or copied.
An existing staging/provider operator connection or separately supplied qualification credential
was initially needed before live requests. The owner subsequently authorized the existing
**staging** provider key in memory only. The integration owner verified the explicitly named
`woozy-wren-368` staging target and staging origin, and owns the private CLI-to-child-process
credential broker. No credential value is printed or written into the worktree. The broker maps
staging `OPENROUTER_API_KEY` into child-only `OPENROUTER_QUALIFICATION_API_KEY`; the runner
does not read hosted secrets or fall back to a production/shared environment file.

## Prepared implementation and offline evidence

`packages/backend/scripts/run-image-quality-qualification.mjs` defaults to no-egress preparation.
It binds its own source and the frozen fixture into the manifest digest. Exact reviewed digest,
explicit policy-allowance acknowledgement and credit-billing attestation are required to execute.
Only three requests exist. The shared append-only ledger has an exclusive lock and durable
started-before-POST receipts; unknown or interrupted attempts block subsequent purchases.
The run directory is single-use. Returned PNG signature/IHDR dimensions are checked and bytes
are saved privately, including delivered bytes whose billing metadata later prevents continuation.
This header check is not a substitute for decoding and visually reviewing the actual output.

The documented Images usage shape is `prompt_tokens`, `completion_tokens`, `total_tokens`,
optional `cost` and `is_byok`. Positive image output-token counts, consistent counts, finite
nonnegative cost and `is_byok:false` are required before advancing. Unknown/absent metadata,
HTTP/transport errors, wrong model/provider, corrupt/missing output, profile overrun or token-price
variance stops the run. Known reported dollars are still counted when other checks fail. Exceptions
and raw key-preflight responses are not logged; only controlled codes and redacted numeric
key-limit state are retained.

Ten focused no-egress tests passed: exact request scope, no-network preparation, approval refusal,
durable receipts/exact charge accounting, duplicate prevention, missing-usage stop and retained
output, unknown billing mode, known-rate variance, zero placeholder usage, policy overrun,
transport redaction and cross-lane shared allowance. The mock PNG only supplies a synthetic header;
these tests claim no real generated image, visual quality or provider billing acceptance.

Final prepared manifest: `.tmp/phase53-image-qualification/manifest.json`.
Reviewed candidate digest: `87016a791f1625b8408a0899bf4e297dfc33d6d4ccf07a6857dc51d997e44d3b`.
Shared ledger path: `.tmp/phase53-paid-qualification/charges.jsonl` (not created by preparation).
The integration owner must review this exact manifest/source before issuing the live go-ahead.
No app price/default/registry activation follows from running this operator qualification.
