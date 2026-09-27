---
phase: 48-business-website-and-landing-page-runtime
plan: 03
status: complete
completed: 2026-09-21
requirements: [SITE-01, SITE-02, LAND-01, LAND-02]
---

# 48-03 Summary — Anonymous form and contact boundary

Anonymous form submissions now resolve only from the request host/path to the authoritative
published project and form. The pure parser normalizes bounded fields, requires explicit consent,
and assigns `origin: inbound` plus `consentSource: inbound-form` from code-owned values. The Convex
adapter reuses the existing contact and suppression stores, writes no outbound request or
notification, hashes idempotency/abuse keys, retains coordination rows for 24 hours, applies a
15-minute abuse window, and aggregates only the closed raw-request metric kinds.

Integration evidence covers accepted exactly once, duplicate, consent refusal, suppression,
rate limiting, invalid/foreign host, unpublished state, no raw request persistence, no outbound
work, and aggregate counts. `web-form-retention` performs hourly expiry cleanup through
tenant-leading indexes.

Verification:

- `@pikar/core` typecheck: passed.
- Core web form/runtime tests: 11 passed.
- `@pikar/backend` typecheck: passed.
- Phase 48 form integration/source tests: 8 passed.

No customer data, provider call, email, or paid model call was used.

## Current-source continuation — 2026-09-25

The form abuse lookup now uses the existing `by_tenant_abuse_bucket` index's expiry field as
an index range (`abuseWindowExpiresAt > now`) instead of a post-index filter. The five-request
limit, 15-minute window, hashed keys, outcomes and retention cleanup are unchanged. A source
regression assertion pins that range, and the focused form suite passes 9/9. Backend typecheck,
strict planning/playbook checks and tracked-file diff check exited 0. The refreshed graph
manifest has current nonempty AST hashes for `webForms.ts` and its test; the post-refresh Convex
edge fixup exited 0. The graph update's terminal exit was not retained across the session
handoff, so graph freshness is supported by the artifact mtimes/hashes rather than a captured
exit code. No production-traffic or strict deletion-throughput claim follows from this change.
