# Website quality provider pilot

Date: 2026-10-26. Scope: isolated online-presence branch and dedicated staging only.

## Plan and task list

- [x] Inspect the current renderer, model gateway and provider boundaries with three agents.
- [x] Add an explicit operator comparison route for the current model, Kimi K3.1 Pro, and Kimi with Stitch; never change the global model default.
- [x] Add a bounded server-side Stitch adapter with validated responses, tenant-owned references and no silent fallback. Adapter/probe tests: 19 passed; live compatibility remains to be checked.
- [x] Improve supported motion: restrained entrances and feedback, immediate usable content and reduced-motion support. Renderer tests: 20 passed; browser performance qualification remains separate.
- [x] Freeze one representative synthetic studio website brief and the same hash-verified image for the first three-arm comparison. Separate renderer examples cover website, landing page and shop; a provider comparison across all three formats remains a later evaluation, not an inferred result.
- [x] Verify live provider availability and prices before spending. Credential names and ledger verified; all calls remained within the original $5 total ceiling.
- [x] Run focused checks and the live three-arm comparison; recover and hash-verify the durable artifacts and settled receipts.
- [x] Review outputs and record measured costs, timing limitations and the provisional provider recommendation below.

## Decision criteria

Prefer Kimi plus Stitch if the actual rendered pages clearly improve business specificity, visual composition and usability without unacceptable cost or failure rates. Keep provider selection explicit. An unavailable Stitch step must not silently become a lower-quality completed job. Both providers become required only if comparative evidence and operational availability justify that decision.

Quality review covers website, landing page and shop at 1440, 768 and 390px; typography, imagery, overlay readability, mobile overflow, focus and touch targets; functioning navigation and truthful forms/commerce states. Motion must be judged in-browser, not inferred from still images. Prefer opacity/transform, restrained staggering and progressive enhancement; no scroll hijacking or essential content hidden pending animation.

## Constraints

The current closed document renderer cannot faithfully accept arbitrary Stitch HTML/React. Imported provider designs require a validated supported representation or an explicit fidelity refusal. Payment, publication, source approval and tenant isolation remain code-owned. No provider output grants financial or publication authority.

No new credentials are requested in chat. Provider secrets stay server-side. Prior recorded staging cost is an upper bound of $0.05901071, not a current balance; recheck the ledger before admission. Stitch quota/cost and service access must be verified separately from token prices.

## Results

The first three-arm website proposal comparison is complete. This is a limited visual pilot, not native workflow or commerce qualification.

### Adjusted run: completed comparison, reviewed 2026-10-29

Run `e71230c1` completed all three arms. The command connection failed to return its final response; read-only recovery required the completed audit, three verified artifact records, three actual settlements and the closed budget receipt. Downloaded bytes matched the saved SHA-256 values. No generation was repeated during recovery.

| Arm | Settled model cost (USD) | Approximate time |
| --- | ---: | ---: |
| Current model | 0.0004872 | 9.8 seconds |
| Kimi K3.1 Pro, low reasoning | 0.060234 | 150.2 seconds |
| Kimi + Stitch | 0.0517624 | 193 seconds including Stitch; 103.3 seconds for Kimi |

Timing comes from durable audit intervals, including transaction overhead. Exact provider finish reasons and observed aliases were not retained after the disconnect; audit records confirm model identity matched. All three downloaded documents have complete HTML structure and passed the preview's inert-content checks. Structural completeness is not a claim about the missing provider finish reason.

The completed run cost $0.1124836. Including the stopped attempt, new pilot model costs were $0.1961306. The latest reconciled cumulative staging model spend is $0.25514131 of the original $5 ceiling, with no unresolved holds or breach. Stitch uses included/free credits without paid overage according to the user's account declaration; no dollar charge is supplied by its API. Model/media switches were restored to disabled and the previous deployment budget restored.

Browser review found both Kimi outputs substantially stronger than the current model: readable image-overlay headings and actions, deliberate serif typography, restrained warm colours and coherent section layouts. The baseline has weak image contrast, text crowded across its hero, no meaningful hero action, and a Home link without a matching target. Kimi alone is a credible minimalist option. Kimi + Stitch is the provisional visual preference for this brief, with a stronger editorial arrangement and clearer service sections; this is subjective evidence from one fictional studio, not proof of general superiority.

Both Kimi pages loaded their image at 390px without horizontal overflow (document 375px, viewport 390px). Kimi + Stitch also reported 753px document width at 768px. Desktop captures were saved at 1440px. The browser interrupted further tablet inspection, so a complete three-width comparison matrix is not claimed. Source inspection confirms both Kimi outputs include reduced-motion rules; runtime reduced-motion and frame performance remain unmeasured. The combined output's 14-second image settling animation should be shortened before production acceptance.

Recommendation: keep Stitch optional and explicitly selectable, with Kimi + Stitch as the preferred candidate for the next quality evaluation. Do not make either provider a global requirement based on one brief. The operator comparison is deployed to dedicated staging; customer-facing provider selection, faithful conversion into the native renderer, real contact handling, publishing qualification and broader landing/shop provider evaluations are still required before activation. Existing website, landing and shop gallery examples are renderer fixtures, not these generated proposals. Merchant checkout qualification is separate.

Review files are retained locally under `.tmp/presence-provider-results/`: the recovered receipt, review manifest, three original proposals, desktop/mobile screenshots and Stitch reference image. The private local comparison viewer exposes inert previews only. No secrets or storage download URLs are committed.

Validation: focused adapter/probe/runner checks passed 26/26; guarded model wrapper checks passed 9/9, including real SDK request assertions; cost regression checks passed 14/14. Renderer checks passed 20/20, example checks 4/4 and legacy publication checks 6/6. The staging build passed all four package typechecks and the production build. These checks establish implementation behaviour, not an automatic design-quality pass.

### Live attempt 1: known stopped result

Run `524477a8` completed the current-model proposal in 11.308 seconds ($0.000525). Kimi at its default reasoning setting returned no HTML within the 8192-token output allowance; its settled charge was $0.083122. Total attempt cost was $0.083647. The envelope closed with two settled calls, no unresolved holds and no breach; Stitch generation was never started. This is a failed Kimi proposal, not quality evidence. Both the previous deployment budget and disabled model switch were restored.

The current-model HTML was hash-verified and reviewed in the inert local viewer. Its large hero placed heading and body side by side without adequate spacing, and it supplied no clear hero action. It is not an excellent design and does not justify retaining that output as the quality target.

The follow-up configuration explicitly requests low reasoning only for Kimi in this operator comparison. The guarded provider wrapper enforces the setting after rebuilding routing options, and tests verify it on the actual SDK request. Output cap, fixture, imagery, baseline model and original total authorization remain unchanged. An adjusted run is not a successful comparison until real usable output is inspected.

Live Stitch discovery authenticated successfully but initially refused the assumed `get_screen` schema. The returned official schema requires only `name`; discovery and request arguments were aligned to that exact resource identity. A subsequent live preflight passed all three required tools without generation. The deployed image returned 200 with exactly 200924 bytes and its frozen SHA-256. Focused adapter/probe/runner checks passed 26/26 after the correction.

On 2026-10-26, the dedicated staging environment's names-only listing confirmed STITCH_API_KEY and OPENROUTER_API_KEY. The user confirmed that Stitch uses included/free credits with no automatic paid overage. This is an account declaration, not API-observed usage. A fresh ledger read at 09:26:54 UTC returned 320 rows, $0.05901071 cumulative upper bound, $4.94098929 remaining, no unknown holds and no breaches. Both global model/media kill switches remained enabled.

Local browser review using the supported in-app browser observed the real website/landing examples at 390/768/1440 widths, loaded imagery, readable image-overlay copy and functioning website About navigation. The clay shop was corrected after inspection to overlay its real heading, copy and collection action on the photograph; desktop/mobile screenshots were reviewed. These are Pikar renderer fixtures, not Kimi/Stitch outputs and not hosted recipe-qualification receipts. Reduced-motion behavior has unit coverage; no measured LCP/CLS or frame-rate claim is made.

The final clay shop also passed the tablet visual check at 768px: all images loaded and document width was 753px, with no horizontal overflow. Local screenshots are retained under `.tmp/presence-quality-v7/browser/`.

Pricing checked against primary sources on 2026-10-26: [OpenRouter Kimi K3.1 Pro](https://openrouter.ai/moonshotai/kimi-k3.1-pro) lists the standard Moonshot route at $2 input / $10 output per million tokens (highspeed differs). [Kimi billing documentation](https://platform.kimi.ai/docs/pricing/chat) describes automatic five-minute caching and separate cache-write charges. The pilot must account conservatively for caching and verify actual reported cost; a token-price estimate is not an invoice.

The operator lane uses the candidate-only `website-design-proposal` registry prompt; it does not activate a customer-facing skill. Each arm receives the same fictional Fieldwork studio facts and image. Artifacts are stored as plain text for quarantined visual review, with requested/observed model identity and actual settled model cost. Stitch preflight and the supplied image's byte/hash check precede model spending. The existing native renderer cannot import these designs with guaranteed fidelity; proposal quality alone cannot qualify an automatic publishing workflow.

The new pure comparison checks passed 9/9, native control checks 7/7 and Stitch adapter/probe checks 19/19. Official backend code generation and recipe/golden/vertical identity self-checks passed after runtime freeze. Refreshed identities retire old evidence; they do not issue fresh qualification.
