# ADR-065 — Keep field provenance with the existing business blueprint

- **Status:** Implemented locally; authenticated release acceptance pending.
- **Date:** 2026-10-23

## Decision

Reuse the existing profile, blueprint document, draft review and immutable audit. Store only a bounded, versioned provenance sidecar on tenantProfiles; do not create another business-fact store. The native producer binds exact blueprint and entry hashes to original owned source IDs, source hashes and source creation times. The original observation time remains unknown when the source does not supply it.

An actual user review records a proposal decision, not independent verification of each claim. Its native audit reference, timestamp and closed field/hash references bind the reviewed entry; no values or business prose enter audit. Unchanged carried fields retain their original recording/review times. Newly proposed sources that change or disappear during synthesis or review cannot silently acquire a fresh citation.

The Business Ledger and Executive share the same read projection. Recheck current ownership, readiness, sealed state, exact source bytes and native review references. Changed, withdrawn, malformed or legacy title-only linkage remains explicit in the interface and does not enter assured standing context. A source title, an extraction label, an agent-authored document or copying a value never creates userProvided authority. The standing serializer describes statements and inferences accordingly.

Keep existing documents available in their original store. No mass refiling, migration, background model call, autonomous goal write or new publication permission follows. Legacy values remain visible as unverified; original dates do not become fresh on read. The isolated golden fixture remains an unreviewed synthetic record and must be excluded from assured standing context, with separate positive proof that the fixture itself exists.

## Consequences

Users can inspect the evidence beside each existing business value. The brain receives the same provenance checks as the interface. Existing title-only blueprints may contribute less assured context until genuinely reviewed with traceable sources. Current-source tests and release checks must cover that compatibility change; they do not establish live business outcomes or complete the social pilot.
