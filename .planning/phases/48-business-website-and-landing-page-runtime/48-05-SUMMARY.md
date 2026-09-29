---
phase: 48-business-website-and-landing-page-runtime
plan: 05
status: complete
completed: 2026-09-21
requirements: [SITE-01, SITE-02, LAND-01, LAND-02]
---

# 48-05 Summary — Protected editor and immutable preview

`/dashboard/sites` now provides tenant-scoped project inventory, honest loading/empty/unavailable
states, structured draft editing, stale-revision handling, exact-version approval, publish and
unpublish controls, and an explicit hosting/source declaration. The navigation exposes the route in
the authenticated shell.

The protected preview reads the requested immutable version and renders its stored page artifact in
a sandboxed, labelled iframe. It does not rebuild old versions with the current renderer and does
not use raw HTML injection into the application DOM. Missing version/artifact states are explicit.

Verification:

- Editor and preview tests: 4 passed.
- `@pikar/web` typecheck: passed.
- Brand tokens, visible focus behavior, labelled controls, and no `dangerouslySetInnerHTML` are
  structurally pinned.

Custom-domain readiness and external hosting evidence remain unclaimed.
