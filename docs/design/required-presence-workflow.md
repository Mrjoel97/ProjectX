# Required Stitch and Kimi workflow

Decision: 2026-10-29. The owner selected Stitch followed by Kimi K3.1 Pro as required for future website, landing-page and shop creation. This supersedes the pilot recommendation to keep Stitch optional. Provider failure must not silently fall back to the old design route.

## Delivered in this change

- Renderer/compiler v8 supports galleries of one or two images and keyboard/swipe scroll-snap carousels of three to six owned images. No autoplay or executable provider scripts. Images retain provenance, descriptions and lazy loading. Reduced-motion preferences disable transitions and smooth scrolling.
- Section headings balance, body text has a tighter readable measure, and existing restrained entrances remain available. The studio example adds three explicitly illustrative material studies using existing provenance-pinned assets. No new image/model spend.
- `apps/web/public/presence-examples/fieldwork.html` preserves the owner-selected Kimi/Stitch art direction while grouping the hero heading, supporting sentence and action, shortening the image settle from 14 seconds to 1.2 seconds and adding a material-study carousel. Sites links to this fictional, non-operational preview. It is not a native generated project or new provider receipt. Original comparison artifacts remain unchanged.
- `runRequiredPresenceDesign` executes claim/admission, Stitch, exact-model Kimi, closed document/profile validation, source-authority validation, native render, deterministic quality inspection and hash-bound candidate recording in that order. Neither provider can be omitted; there are no hidden retries or fallback models.
- The concrete `presenceRequiredRun` action is restricted to the dedicated staging fixture tenant and original bounded comparison budget. It uses the actual adapters; tests replace provider traffic. Real tenants are refused before provider calls rather than being relabelled as test tenants.
- Deterministic quality checks return repair instructions for missing pages, broken local destinations, missing headings/images, unsafe markup, lost inquiry endpoints/consent or missing reduced-motion rules. This does not substitute for browser measurement.
- Stored versions from renderer v7 remain accepted as historical origin records. Their published bytes are unchanged.

## Not yet customer activation

The new runner is a staging candidate, not wired into `buildOnlinePresenceProject`. The old native recipe workflow remains unchanged. The current supported document cannot express arbitrary Stitch layouts, and the candidate preserves canonical source content exactly while allowing only supported design profiles. It therefore does **not** reproduce the approved arbitrary HTML layout automatically.

Before making the mandatory pipeline live for users:

1. Add a reviewed ordinary-tenant Kimi budget contract using real tenant attribution; do not reuse the fixture-only evaluation envelope. Stitch billing/quota must also be governed for the connected account.
2. Extend the validated layout representation and importer so Kimi can preserve the Stitch composition without arbitrary HTML, scripts, invented business claims or model-owned commerce authority.
3. Add an automated browser worker to inspect exact artifacts at desktop/mobile sizes, verify contrast, interaction, image loading, reduced motion and design fidelity, and issue bounded repair requests. Static pass is always marked `browserReviewRequired`.
4. Persist those exact artifact/provider/browser receipts with the native project version and require them when approving/publishing new mandatory-pipeline versions. Preserve existing historical publications.
5. Route the user workflow through that qualified chain; validate real forms and the separately governed merchant checkout before announcing operational websites/shops.

No customer activation, autonomous browser repair, payment qualification or production deployment is claimed here. These explicit remaining tasks prevent a polished preview from being mistaken for a completed customer workflow.

## Validation

Renderer/recipe tests: 36 passed. Example UI tests: 4 passed. Historical publication tests: 7 passed. Deterministic quality tests: 6 passed. All four package typechecks passed. Additional provider/control/coordinator tests are recorded in the change report. Native gallery browser inspection loaded all four images, moved to the chosen slide, and measured no document overflow at 390px. The refined provider preview also loaded all four images without overflow at 390px. Browser captures are local review evidence, not issued qualification receipts. No paid provider call was made in this change.
