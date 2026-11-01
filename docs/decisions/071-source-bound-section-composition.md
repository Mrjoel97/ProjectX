# ADR-071: Preserve the approved reference and source-bound composition

Date: 2026-11-01
Status: implementation prepared for staging; actual workflow visual acceptance pending

## Problem

The approved Fieldwork comparison was a complete design, but the native workflow reduced visual direction to seven global layout switches and tokens. Services were flattened to text. More importantly, the workflow generated a fresh Stitch reference without binding the user's approved Fieldwork reference. Passing technical checks or displaying an attractive standalone reference did not establish native fidelity. The recorded v15 visual review failed fidelity on all four pages; the subsequent v16 changes did not establish a passing visual review.

## Decision

Keep the approved Fieldwork HTML unchanged. Its code-owned manifest pins the HTML, actual desktop/mobile reference screenshots, four image assets and carousel script by byte length and SHA-256. The explicit selection is `approvedDesignReference: "fieldwork-v1"`; the immutable identity contains `id`, `revision` and `manifestHash`. There is no automatic selection for other customers.

The backend loads only fixed paths from the configured HTTPS site origin. Unknown selections, invalid origins, redirects, unavailable resources, changed sizes/hashes or invalid image signatures fail closed. Reference HTML and scripts are data, never executed by the loader and never treated as instructions or authority for business facts. Loading the reference makes no provider call.

The selected identity participates in the prepared source fingerprint and provider receipt. Stitch receives the approved HTML as untrusted visual reference alongside the business context. Kimi receives the approved reference HTML and actual desktop/mobile screenshots alongside the generated Stitch reference. Visual review receives the same approved identity and screenshots. These are distinct inputs: a new Stitch output cannot silently replace the approved reference. Stale or changed identity must invalidate reuse.

Version 3 layout plans preserve the legacy choices/tokens and add exact page/node-bound annotations. Every top-level section and form must have a compatible annotation; an empty list is permitted only when no such nodes exist. Unknown, duplicate, missing or incompatible references fail rather than silently reverting to generic styling. The closed compositions are:

- `editorial-lead`: source heading and text.
- `service-panels` / `numbered-services`: source service titles, optional descriptions and details; title-only services remain compact without invented descriptions.
- `principles-grid`: exactly three source heading/text groups.
- `image-caption`: source media and caption content; carousel mode permits only one target per page with the current code-owned controller.
- `contact-copy`: source heading, text and actions.
- `contact-panel`: a real form retaining its fields, consent and route.

Optional page presentation controls choose bounded hero framing, compact editorial chrome and contact surface. Heading treatments refer to exact source headings using validated line-break positions and emphasis ranges; they cannot supply replacement copy. Structured services and separate image captions preserve content through materialization. Captions do not replace accessible alt text. Local anchor targets remain source-bound and validated, not arbitrary script or external navigation injection.

No composition accepts arbitrary HTML, CSS or provider URLs. Untargeted business facts, document order, owned assets, real form/commerce authority and consent remain code-owned. Legacy canonical forms and existing published artifact bytes remain unchanged. New compiler/renderer identities and fresh artifact hashes identify newly rendered versions; generation, repair, finalization and rendering enforce the same document-bound contract.

## Acceptance and limits

Local unit tests, type checks, deterministic rendering and recipe protocol qualification establish technical behavior only. The reference loader's hash checks establish which reference bytes were used, not visual similarity. Static source-matched renderer fixtures can reveal representation gaps but are not a completed agent workflow.

Completion requires an actual staged Kimi + Stitch run with explicit reference selection, fresh immutable output and desktop/mobile captures. Compare that output against the pinned approved reference for hero proportions, heading hierarchy, section grouping, source-backed service detail, image/caption treatment, contact composition, spacing and footer placement. Sparse content must have a deliberate compact composition; it must not acquire invented facts merely to resemble the reference.

Review must also verify no clipped or overlapping text, mobile overflow or unreadable overlays; working local navigation and real forms; smooth autoplay/arrows with hover/focus and reduced-motion behavior; and unchanged source content. Bind all observations to the exact version, renderer, source fingerprint, approved-reference identity, receipt, artifact and screenshot hashes. Preview and publication must use the same accepted artifact bytes. Payments remain test-only; visual acceptance does not qualify live checkout.

**Current status: staged visual acceptance is pending.** This decision creates no passing browser/vision evidence and does not authorize reporting fidelity as complete. See the execution checklist in `docs/playbooks/online-presence.md`.
