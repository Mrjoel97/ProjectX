---
phase: 48-business-website-and-landing-page-runtime
plan: 04
status: complete
completed: 2026-09-21
requirements: [SITE-01, SITE-02, LAND-01, LAND-02]
---

# 48-04 Summary — Exact public runtime

The public runtime now serves immutable per-page artifacts named by the current published pointer.
Whole-project content hashes cover the canonical multi-page document, so changing a secondary page
changes the approved hash. Platform and verified custom bindings share one indexed resolver;
missing, foreign, ambiguous, pending, unpublished, and broken-artifact states fail closed without a
draft/latest fallback.

`GET` and `HEAD /p/:slug/:page` return deterministic bytes and safe cache/referrer/content headers,
plus the closed `pikar_platform_path` / `tenant_structured_content` ownership declaration. Canonical
renderer CTA forms activate the POST boundary, increment only the `cta_click` raw-request aggregate,
and navigate only to the published closed target. Canonical lead forms delegate to the host-bound
form adapter. Unsupported or malformed routes refuse safely; existing funnel and unsubscribe routes
remain intact.

Verification:

- Core runtime/form tests: 11 passed.
- Runtime resolver, HTTP, form, and lifecycle suites: 19 passed.
- `@pikar/core` and `@pikar/backend` typechecks: passed.

No provider/custom domain was navigated and no production/external enablement is claimed.
