# Website quality provider pilot

Date: 2026-10-26. Scope: isolated online-presence branch and dedicated staging only.

## Plan and task list

- [x] Inspect the current renderer, model gateway and provider boundaries with three agents.
- [x] Add an explicit operator comparison route for the current model, Kimi K3.1 Pro, and Kimi with Stitch; never change the global model default.
- [x] Add a bounded server-side Stitch adapter with validated responses, tenant-owned references and no silent fallback. Adapter/probe tests: 19 passed; live compatibility remains to be checked.
- [x] Improve supported motion: restrained entrances and feedback, immediate usable content and reduced-motion support. Renderer tests: 20 passed; browser performance qualification remains separate.
- [x] Freeze one representative synthetic studio website brief and the same hash-verified image for the first three-arm comparison. Separate renderer examples cover website, landing page and shop; a provider comparison across all three formats remains a later evaluation, not an inferred result.
- [ ] Verify live provider availability and prices before spending. Credential names and current ledger verified. The original $2 pilot target must not defeat a larger valid reservation; any admitted call remains within the original $5 total ceiling.
- [ ] Run meaningful local checks, then live provider comparisons when prerequisites are satisfied. Preserve real receipts; mocked tests cannot establish design superiority.
- [ ] Present reviewable outputs, measured cost/latency, acceptance results and a recommendation on making the combination the default.

## Decision criteria

Prefer Kimi plus Stitch if the actual rendered pages clearly improve business specificity, visual composition and usability without unacceptable cost or failure rates. Keep provider selection explicit. An unavailable Stitch step must not silently become a lower-quality completed job. Both providers become required only if comparative evidence and operational availability justify that decision.

Quality review covers website, landing page and shop at 1440, 768 and 390px; typography, imagery, overlay readability, mobile overflow, focus and touch targets; functioning navigation and truthful forms/commerce states. Motion must be judged in-browser, not inferred from still images. Prefer opacity/transform, restrained staggering and progressive enhancement; no scroll hijacking or essential content hidden pending animation.

## Constraints

The current closed document renderer cannot faithfully accept arbitrary Stitch HTML/React. Imported provider designs require a validated supported representation or an explicit fidelity refusal. Payment, publication, source approval and tenant isolation remain code-owned. No provider output grants financial or publication authority.

No new credentials are requested in chat. Provider secrets stay server-side. Prior recorded staging cost is an upper bound of $0.05901071, not a current balance; recheck the ledger before admission. Stitch quota/cost and service access must be verified separately from token prices.

## Results

Implementation and evaluation in progress. No winner selected and no new paid comparison claimed.

On 2026-10-26, the dedicated staging environment's names-only listing confirmed STITCH_API_KEY and OPENROUTER_API_KEY. The user confirmed that Stitch uses included/free credits with no automatic paid overage. This is an account declaration, not API-observed usage. A fresh ledger read at 09:26:54 UTC returned 320 rows, $0.05901071 cumulative upper bound, $4.94098929 remaining, no unknown holds and no breaches. Both global model/media kill switches remained enabled.

Local browser review using the supported in-app browser observed the real website/landing examples at 390/768/1440 widths, loaded imagery, readable image-overlay copy and functioning website About navigation. The clay shop was corrected after inspection to overlay its real heading, copy and collection action on the photograph; desktop/mobile screenshots were reviewed. These are Pikar renderer fixtures, not Kimi/Stitch outputs and not hosted recipe-qualification receipts. Reduced-motion behavior has unit coverage; no measured LCP/CLS or frame-rate claim is made.

The final clay shop also passed the tablet visual check at 768px: all images loaded and document width was 753px, with no horizontal overflow. Local screenshots are retained under `.tmp/presence-quality-v7/browser/`.

Pricing checked against primary sources on 2026-10-26: [OpenRouter Kimi K3.1 Pro](https://openrouter.ai/moonshotai/kimi-k3.1-pro) lists the standard Moonshot route at $2 input / $10 output per million tokens (highspeed differs). [Kimi billing documentation](https://platform.kimi.ai/docs/pricing/chat) describes automatic five-minute caching and separate cache-write charges. The pilot must account conservatively for caching and verify actual reported cost; a token-price estimate is not an invoice.

The operator lane uses the candidate-only `website-design-proposal` registry prompt; it does not activate a customer-facing skill. Each arm receives the same fictional Fieldwork studio facts and image. Artifacts are stored as plain text for quarantined visual review, with requested/observed model identity and actual settled model cost. Stitch preflight and the supplied image's byte/hash check precede model spending. The existing native renderer cannot import these designs with guaranteed fidelity; proposal quality alone cannot qualify an automatic publishing workflow.

The new pure comparison checks passed 9/9, native control checks 7/7 and Stitch adapter/probe checks 19/19. Official backend code generation and recipe/golden/vertical identity self-checks passed after runtime freeze. Refreshed identities retire old evidence; they do not issue fresh qualification.
