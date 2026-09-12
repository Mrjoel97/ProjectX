---
phase: 31-marketing-surface-and-funnel-v0
plan: "03"
subsystem: marketing
tags: [convex-http, bearer-links, pagination]
requires:
  - phase: 31-02
    provides: Native management and internal aggregate resolver
provides:
  - Strict public GET redirect transport with side-effect-free HEAD rejection
  - HTTP negative-space and existing webhook regression coverage
  - Paginated tenant artifact picker prerequisite for Plan 05
affects: [31-05, 31-06, 31-07]
tech-stack:
  added: []
  patterns: [GET-only bearer route, no-store redirects, native tenant pagination]
key-files:
  created: []
  modified:
    - packages/backend/convex/http.ts
    - packages/backend/convex/funnels.ts
    - packages/backend/convex/funnels.test.ts
    - docs/playbooks/marketing.md
    - docs/playbooks/cockpit.md
key-decisions:
  - Explicitly reject HEAD before mutation because native Convex routes HEAD through GET
  - Unsupported methods remain unmatched rather than introducing public write-method registrations
  - Paginate the tenant inventory before eligibility filtering so older and filed artifacts stay reachable
requirements-addressed: [MKTG-02]
requirements-completed: []
completed: 2026-09-12
---

# Phase 31 Plan 03: Public funnel transport

The Convex `/f/` GET route strictly parses 43-character bearer tokens, exact stages and bounded optional source metadata, calls only the internal aggregate resolver, and returns empty 302 responses to trusted stored bytes. Malformed, unknown, inactive and unavailable links return identical empty 404 responses. All handler-produced responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; no cookies, permissive CORS or request logs were added.

HEAD is explicitly rejected with 405 before mutation. Installed Convex source and native HTTP tests confirm HEAD routes through the GET handler while preserving the request method. POST, PUT, PATCH, DELETE and OPTIONS remain unmatched native router 404 responses with no counter effects; those framework responses are outside the handler's cache-header control. This preserves the plan's single GET registration and no public write-route boundary.

## Justified prerequisite

Root authorized `api.funnels.downloadableArtifacts` for Plan 05. Existing Vault metadata exposes storage IDs and a fixed scan could hide eligible older files. The new native tenant query scans at most 50 rows per page and filters ready documents with actual storage metadata, including folder documents. It returns only ID, title and MIME type plus native pagination metadata. Empty filtered pages retain their cursor so the UI can continue. Creation still rechecks ownership and availability. The existing generated module infers this export without handwritten API changes.

## Qualification

- 84 tests passed: 15 funnel tests and all 69 existing Stripe webhook tests.
- Native HTTP coverage verifies all three redirect stages, identical storage destination, no-store headers, side-effect-free HEAD, unsupported methods, strict path/query bounds, no counting on unavailable links, and preserved OAuth/webhook registrations.
- Picker coverage traverses empty ineligible pages, includes a folder-owned file, rejects unauthenticated access, excludes foreign rows and removed bytes, and asserts the exact safe DTO.
- Source invariants keep the funnel route in Convex, prevent middleware/public Next funnel exemptions, and restrict the handler to the internal aggregate resolver. `git diff -- apps/web/middleware.ts` is empty.
- Focused Biome, `git diff --check` and final backend `tsc --noEmit` passed. The initial TypeScript run identified only concurrent authoringProbe fixture issues; that lane corrected them before the successful rerun.
- Marketing and cockpit playbooks include the response matrix, redacted route format, protected-input acceptance procedure, counter comparison and deactivation limits. Combined playbook check currently blocks only the other lane's vertical-packs update, reported to root.

No deployment or live request was performed by this lane. UI, exact-version live acceptance and explicit navigation activation remain Plans 05–07; MKTG-02 is not yet complete. Root owns commits and global planning state.
