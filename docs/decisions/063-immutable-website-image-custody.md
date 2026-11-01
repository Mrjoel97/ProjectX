# ADR-063: Freeze owned website images with the reviewed version

Date: 2026-10-22
Status: accepted for isolated local implementation under the owner's instruction to finish the visual workflow. Hosted release remains53-02.

## Context

The website service was text-led despite containing design knowledge. Existing uploaded and
generated raster images already live in the tenant Vault, but a raw storage URL would expose a
private bearer capability, and a mutable source pointer could change a reviewed website.

## Decision

Prepare only selected owned, ready, unsealed Vault raster files through the bounded service tool.
Inspect actual PNG/JPEG/WebP container structure, dimensions and size; compare authoritative storage
size/SHA and declared MIME, then freeze an independently owned copy. Recheck source revision and
storage identity when committing. Compensate rejected/deduplicated copies and their upload receipts.
Do not fetch arbitrary image URLs or accept SVG/active content. Maximum5MiB per image and eight
distinct image refs per website version (logo, hero and up to six gallery images).

Use opaque `webasset:<id>:<digest>` references in the closed document. Their digest participates in
canonical content hashing. Each immutable version snapshots its exact owned asset rows and source
lineage. Selected image context is metadata-only; a generated image's prompt cannot become business
facts. Private source warnings and exact human publication review still apply.

Private previews retrieve one exact-version image through tenant-authenticated actions and substitute
bounded data URLs only inside an inert sandboxed presentation. Stored HTML/hash remain unchanged.
Image loading failure blocks the preview's approval readiness. Preview policy permits data images
and inline style; public policy permits same-origin images only.

Anonymous image requests resolve host/slug against the current published head and its exact asset
snapshot. Compare immutable storage digest/size to the frozen attestation, check the returned blob
length and recheck publication after storage I/O before streaming it. Drafts, wrong hashes/hosts,
erasure, unpublish and retired images refuse. No anonymous storage URL or private fallback exists.

Source-file deletion does not rewrite an already reviewed copy. Tenant export and erasure include
the new owned table/storage field. Public no-store responses preserve lifecycle withdrawal rather
than promising revocation of bytes a visitor has already downloaded.

## Consequences and evidence

The existing specialist can prepare real logo/hero/gallery imagery from supplied assets and the
existing generated-image Vault. It does not silently invoke paid generation or fabricate product,
team or client photographs. Missing visual material remains an explicit business-information gap.
No new image provider, recurring job or public approval tool is introduced.

Native tests exercise actual copies and the specialist tool cycle, tenant refusal, stale source,
retry/dedup cleanup, exact protected preview, public large-image bytes, storage/publication races,
source deletion and tenant erasure. Browser checks decode actual illustrated PNG fixtures across
three directions and three widths. These are local source checks, not hosted qualification.
