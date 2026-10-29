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

## Customer workflow integration — 2026-10-29

The real `buildOnlinePresenceProject` tool now calls `onlinePresenceDesign.build`. It resolves a fresh tenant-owned source snapshot, requires Stitch and exact Kimi, records durable provider stages, and finalizes a private native project version. Calling the former mutation without provider completion refuses the build; there is no old-template fallback.

- Ordinary tenant Kimi requests use the existing paid ledger with a dedicated exact-model scope, conservative 428-cent maximum reservation, no model fallback, no hidden retries, and retained uncertain holds. The staging comparison's original $5 envelope is separate and is not automatically inherited by this runtime. No paid calls were made during this integration.
- Stitch requires the server declaration `PRESENCE_STITCH_BILLING=included_free_no_overage`; a key alone does not establish this. Reference HTML and screenshot blobs are registered to the tenant before subsequent paid work and tracked for account erasure. Completion recovery avoids re-running either provider after a finalization disconnect.
- Renderer v9 accepts a validated layout plan for hero placement, section composition, services, galleries, spacing, type scale and restrained motion. These are meaningful native layout choices, but **not an arbitrary Stitch HTML importer** or a guarantee that every Stitch composition is reproduced. Historical v8 artifacts remain readable.
- Immutable versions hold provider and artifact hashes. New provider versions and their edits cannot be approved or published until the exact version has a passing browser receipt. The Sites editor displays pending/failed review and disables publishing accordingly. Database field order is normalized before receipt comparisons.
- A read-only browser inspector and server-only report endpoint check every page at desktop 1440px, mobile 390px, and actual reduced-motion 390px. Missing or stale reports fail; uncertain photographic contrast requires review. Reports also require separate fidelity evidence and cannot be supplied by an ordinary client.

### Remaining activation work

The deployed automated browser worker, screenshot-based fidelity/overlay review, and bounded repair loop are **not connected yet**. The internal report endpoint is not itself a worker. New required-provider versions therefore remain private until real exact-artifact review is supplied; no passing review is fabricated. A source identity refresh invalidates stale qualification rather than creating evidence. Fresh recipe qualification and a bounded staging run are still required before customer activation.

The generic tenant lifecycle action wrapper was found to receive definition metadata rather than runtime arguments; this new action explicitly binds its tenant storage scope. Auditing other existing users of that wrapper is a separate outstanding repository issue.

Forms and merchant checkout still require their separate end-to-end qualification. No autonomous browser repair, production deployment, or completed operational shop is claimed.

### Preview carousel refinement

The owner subsequently requested automatic movement, smaller images and exactly two directional controls. The fictional Fieldwork preview now uses a reviewed, same-origin `fieldwork-carousel.js` controller: 4.2-second advances, 750ms transitions, seamless looping, hover/focus/background-tab pause, keyboard/swipe navigation and no autoplay with reduced motion. Images are 260px tall on desktop and 220px on phones. Services use matching columns on desktop and stacked heading/description groups on phones. Only this code-owned preview permits its same-origin script through CSP; native generated project artifacts remain script-free. Real-browser checks observed automatic movement, arrow navigation and no document overflow at 390px.

## Validation

Renderer/recipe tests: 36 passed. Example UI tests: 4 passed. Historical publication tests: 7 passed. Deterministic quality tests: 6 passed. All four package typechecks passed. Additional provider/control/coordinator tests are recorded in the change report. Native gallery browser inspection loaded all four images, moved to the chosen slide, and measured no document overflow at 390px. The refined provider preview also loaded all four images without overflow at 390px. Browser captures are local review evidence, not issued qualification receipts. No paid provider call was made in this change.
