# ADR-068: Explicit owned product references for native films

- Status: Accepted for isolated source, 2026-10-24; not deployed.
- Provenance: owner requests consistent product identity, creative camera angles and a short 15-second acceptance film.

## Decision

Add 15 seconds to native film targets. Allow users to select up to three owned Vault images for a native plan. Store document/storage identifiers, content hash, MIME type and size; include the ordered references in review identity. Verify ownership and actual image bytes before sending provider image URLs. Do not automatically select arbitrary attachments or introduce audio/video references.

Freeze references during paid campaign execution. A dedicated product-reference hash prevents reusing footage from a different product even when edits share a timestamp. Keep per-scene retry behavior and historical jobs without product references compatible. Include referenced storage in tenant export/erasure inventory.

## Consequences and verification

References improve conditioning but do not guarantee exact labels, geometry or voices. Owner visual/audio acceptance remains required. Free tests cover tenant isolation, byte validation, provider request shape, changed-reference rejection, partial retry compatibility and daily budget boundaries. The separately approved $5 operator test allowance is unchanged. Hosted activation follows acceptance and current-source CI.