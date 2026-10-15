# ADR-057 — Disclose the actual lifetime of stored-file links

- **Status:** Accepted technical correction under the repository owner's implementation mandate.
- **Date:** 2026-10-16
- **Supersedes:** ADR-045 D4's automatic-expiry claim only. ADR-045 remains immutable; its admission, erasure and file-export decisions are unchanged.

## Context

ADR-036 decision 5 correctly identifies Convex file URLs as durable bearer capabilities. ADR-045 D4 later described the same `ctx.storage.getUrl` URLs as automatically expiring, although the implementation adds no expiry mechanism. Export, preview copy and core comments repeated that incorrect assumption.

The [current Convex file-serving contract](https://docs.convex.dev/file-storage/serve-files) permits anyone holding a file URL to reuse or share it. Deleting the stored file revokes that URL. The provider recommends a different serving mechanism when automatic expiration or authorization on every request is required.

## Decision

Preserve the existing tenant-authorized, explicitly requested export and preview architecture. Describe the URLs as reusable bearer capabilities, without a timed-expiry guarantee. Tell users to keep exports private and save file copies before erasure. Keep unavailable file descriptors with null URLs, and preserve file descriptors from every export page and table.

This corrects disclosure rather than adding a new storage service. A future timed-expiry requirement needs an actual enforceable serving mechanism and its own compatibility, authorization, revocation and large-file tests; a client timestamp or different wording cannot provide expiry.

## Validation and limits

Existing settings, Vault-preview and content tests cover the corrected disclosure and unchanged preview behavior. The paginated download regression checks the actual JSON Blob, including file descriptors, null URLs and partial-export limits.

Provider-documented deletion revocation is a contract, not a claim that a hosted URL-revocation drill has passed. Native export acceptance, hosted in-flight erasure and provider-side residual evidence retain their separate release gates. This decision does not change authentication, file ownership checks, storage behavior, billing or activation settings.
