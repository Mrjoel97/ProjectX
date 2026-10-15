# ADR-054: Voice interviews prepare a reviewed business foundation

Status: Accepted — 2026-10-15 (implementation decision; customer activation remains gated)

The user approved a progressive live-voice onboarding flow with six business references, explicit on-screen publication, a resumable draft, and seven-day transcript checkpoints. The existing browser Realtime transport, Convex tenant wrappers, registry skills, Vault ingestion and closed Blueprint fields remain the architectural boundaries.

The interview is tenant-owned state with optimistic revision checks. Voice has one draft-only answer tool. Essential facts remain server-derived through the existing onboarding contract; the voice agent cannot choose a tier or declare missing facts complete. Enrichment records direct user statements and labels intended future practices. Deterministic document rendering avoids a second speculative generation stage.

Only the user's on-screen approval publishes the displayed revision and projection hash. The approved profile, five operational references, Blueprint pointers and revision snapshot commit together. Ingestion happens afterward, with visible recoverable failures. Six stable Vault IDs represent current knowledge; previous approved content is stored as revision history outside retrieval. Replacement clears old retrieval derivatives with bounded, content-version-checked cleanup. Blueprint itself is never embedded or graph-extracted.

No onboarding audio is stored by the application. Temporary transcript checkpoints expire after seven days; structured drafts and approved revisions remain tenant content and participate in export/deletion. Discard restores an approved snapshot rather than silently deleting published references. Provider retention is a separate operational disclosure.

The additive implementation is gated by FOUNDATION_ONBOARDING_ENABLED. Disabling it blocks onboarding voice mints while retaining the same draft in typed mode. Hosted audio quality, provider usage reconciliation, accessibility/device UAT and deployment evidence must be recorded before broad activation. This decision does not assert a hard provider cost ceiling or authorize new autonomous business actions.
