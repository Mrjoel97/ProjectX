---
phase: 48
slug: business-website-and-landing-page-runtime
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-21
---

# Phase 48 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. This strategy proves
> repository-controlled behavior only; Wave 7 domain/provider/legal enablement and Wave 8 exact
> production founder acceptance remain separate evidence layers.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + convex-test + Playwright + repository static/self-check scripts |
| **Config files** | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` |
| **Quick run command** | Plan-local targeted Vitest file(s), followed by `node scripts/check-audit-payloads.mjs --self-test` when an audit seam changes |
| **Full suite command** | `node scripts/check-free-gates.mjs` plus the Phase 48 targeted backend/web/browser commands named by each plan |
| **Estimated runtime** | Targeted task feedback ≤ 60 seconds; phase browser/build gate may take several minutes |

---

## Sampling Rate

- **After every task:** Run its named targeted unit, component, boundary or static check.
- **After every plan wave:** Run all Phase 48 tests introduced through that wave plus affected
  package typechecks.
- **Before phase verification:** Run the Phase 48 contract/backend/HTTP/web/browser matrix, the
  production web build, planning/playbook checks, and all 23 repository free gates.
- **Max routine feedback latency:** 60 seconds; browser/build gates are explicitly end-of-wave.
- Never use watch mode, a paid provider, public DNS, a custom domain or production traffic as a
  routine task verifier.

---

## Per-Task Verification Map

The planner must replace the provisional workstream identifiers below with every concrete task ID.
No three consecutive implementation tasks may lack an automated command.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 48-01-T1 | 48-01 | 1 | SITE-01, SITE-02, LAND-01, LAND-02 | contract types | `pnpm --filter @pikar/contracts typecheck` | ❌ plan creates | ready |
| 48-01-T2 | 48-01 | 1 | SITE-01, SITE-02, LAND-01, LAND-02 | pure renderer | `pnpm --filter @pikar/core typecheck` | ❌ plan creates | ready |
| 48-01-T3 | 48-01 | 1 | SITE-01, SITE-02, LAND-01, LAND-02 | adversarial deterministic Vitest | `pnpm --filter @pikar/core test -- webRuntime && pnpm --filter @pikar/core typecheck` | ❌ plan creates | ready |
| 48-02-T1 | 48-02 | 2 | SITE-01, SITE-02, LAND-01, LAND-02 | schema/privacy/export/erasure | `pnpm --filter @pikar/core test -- tenantData && pnpm --filter @pikar/backend test -- tenantExport tenantDelete && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-02-T2 | 48-02 | 2 | SITE-01, SITE-02, LAND-01, LAND-02 | lifecycle Convex tests | `pnpm --filter @pikar/backend test -- webProjects && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-02-T3 | 48-02 | 2 | SITE-01, SITE-02, LAND-01, LAND-02 | audit/isolation/redaction | `pnpm --filter @pikar/backend test -- webProjects isolation auditImmutability && node scripts/check-audit-payloads.mjs --self-test && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-03-T1 | 48-03 | 3 | SITE-01, SITE-02, LAND-01, LAND-02 | inbound contact boundary | `pnpm --filter @pikar/core test -- contacts && pnpm --filter @pikar/backend test -- contacts && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-03-T2 | 48-03 | 3 | SITE-01, SITE-02, LAND-01, LAND-02 | form/idempotency expiry/metrics | `pnpm --filter @pikar/backend test -- webForms && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-03-T3 | 48-03 | 3 | SITE-01, SITE-02, LAND-01, LAND-02 | form/privacy/cleanup | `pnpm --filter @pikar/backend test -- webForms && node scripts/check-audit-payloads.mjs --self-test && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-04-T1 | 48-04 | 4 | SITE-01, SITE-02, LAND-01, LAND-02 | host resolver/page_view raw-request metric | `pnpm --filter @pikar/backend test -- webRuntime && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-04-T2 | 48-04 | 4 | SITE-01, SITE-02, LAND-01, LAND-02 | HTTP route/CTA metric boundary | `pnpm --filter @pikar/backend test -- webRuntimeHttp httpBoundary httpAuth && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-04-T3 | 48-04 | 4 | SITE-01, SITE-02, LAND-01, LAND-02 | runtime failure/no-fallback/analytics | `pnpm --filter @pikar/backend test -- webRuntime webRuntimeHttp httpBoundary && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ready |
| 48-05-T1 | 48-05 | 3 | SITE-01, SITE-02, LAND-01, LAND-02 | editor state Vitest | `pnpm --filter @pikar/web test -- siteEditor && pnpm --filter @pikar/web typecheck` | ❌ plan creates | ready |
| 48-05-T2 | 48-05 | 3 | SITE-01, SITE-02, LAND-01, LAND-02 | preview/lifecycle UI | `pnpm --filter @pikar/web test -- previewCanvas siteEditor && pnpm --filter @pikar/web typecheck` | ❌ plan creates | ready |
| 48-05-T3 | 48-05 | 3 | SITE-01, SITE-02, LAND-01, LAND-02 | accessibility/playbook | `pnpm --filter @pikar/web test -- siteEditor previewCanvas && pnpm --filter @pikar/web typecheck && node scripts/check-playbooks.mjs` | ❌ plan creates | ready |
| 48-06-T1 | 48-06 | 5 | SITE-01, SITE-02, LAND-01, LAND-02 | controlled browser/ownership/analytics/retention | `pnpm --filter @pikar/web test:e2e -- e2e/phase48-web-runtime.spec.ts` | ❌ plan creates | ready |
| 48-06-T2 | 48-06 | 5 | SITE-01, SITE-02, LAND-01, LAND-02 | governance/typechecks | `node scripts/check-playbooks.mjs && pnpm --filter @pikar/core typecheck && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck` | ❌ plan creates | ready |
| 48-06-T3 | 48-06 | 5 | SITE-01, SITE-02, LAND-01, LAND-02 | re-entry claim guard/free gates | `node scripts/check-phase48-acceptance.mjs --self-test && node scripts/check-planning.mjs && node scripts/check-free-gates.mjs` | ❌ plan creates | ready |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Required Automated Coverage

### Pure contract and deterministic rendering

- Closed AST/state unions, size/depth/field/URL caps and adversarial rejection.
- Escaping and rejection of script, iframe, event handlers, arbitrary CSS/HTML and `javascript:`.
- Canonical byte identity, stable ordering, renderer identity and intentional hash changes only.
- Closed form schema plus bounded consent wording and attribution.

### Backend state, privacy and isolation

- Append-only versions, exact-hash approval/invalidation and stale revision/CAS refusal.
- Publish/update/unpublish/rollback terminals; update failure preserves old public bytes and rollback
  restores the exact stored hash without re-rendering.
- Artifact cleanup after failed append without deleting a newly referenced blob.
- Refs-only insert-only audit receipts for successes, refusals and failures.
- Two tenants with colliding slugs/hosts, foreign private operations refused, ambiguous public
  routing failed closed and no caller-selected tenant on anonymous writes.
- Tenant classification/index/storage-map drift, export rows/files and erasure of rows/files while
  preserving the neighboring tenant.
- Project-level hosting/source declaration is closed and visible; platform paths identify Pikar's
  runtime plus tenant structured content, while pending/verified custom-domain posture cannot imply
  provider ownership or external enablement.
- `webSubmissions` expiry fields/indexes are bounded by the 24-hour idempotency and 15-minute abuse
  policies; expired rows are ignored and cleaned without replaying outcomes or deleting live rows,
  and the runtime playbook records the sweep/retention procedure.

### HTTP runtime and anonymous forms

- Exact declared route/method registry including explicit `HEAD`/unsupported-method behavior.
- Uniform safe outcomes for malformed, absent, pending, unpublished, ambiguous and render-failed
  routes; safe content/cache/referrer/security headers.
- Accepted form writes exactly one Phase 19 contact with inbound provenance and valid consent.
- Duplicate idempotency, malformed fields, missing consent, suppression, rate limit and unavailable
  content return distinct safe outcomes with no second contact or outbound send.
- Audit, metrics and logs contain no email, name, IP, user agent, consent wording or form body.
- Successful public reads increment `page_view` and valid CTA actions increment `cta_click` as
  closed integer aggregates explicitly labelled as raw-request counts; retries/bots may inflate these counts and no unique-person
  or raw visitor-content claim is permitted.
- The core renderer emits a no-JavaScript CTA form targeting the declared `/cta/:ctaId` route;
  HTTP and Playwright checks activate that rendered form rather than calling the endpoint directly,
  then verify safe local/https acknowledgement/navigation and the `cta_click` aggregate.

### Authenticated editor and browser acceptance

- Exact-version edit/preview/approve, stale/refused buttons, and honest loading, empty, partial,
  refusal, error and success states.
- Desktop/mobile layout, keyboard/focus, accessible names/error linkage and no raw HTML injection.
- Authenticated disposable tenant creates both shapes; an anonymous browser reads only published
  bytes and exercises update failure, unpublish, rollback and the form outcome matrix.
- Refresh/recovery and cleanup remain deterministic. Browser evidence explicitly does not certify
  a provider, custom domain, legal entity or production release.

---

## Wave 0 Requirements

Existing Vitest, convex-test, Playwright, typecheck, build, planning, playbook and free-gate
infrastructure covers the phase. Each implementation plan must create its own targeted tests before
or with the corresponding production code; no new test framework or dependency is authorized.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Nontechnical editor clarity and visual brand judgment | SITE-01, LAND-01 | Automation cannot establish comprehension or brand quality | On the exact local/release fixture, founder completes create/edit/preview/approve without implementation guidance; record the revision and verdict without promoting it to Wave 8 production acceptance. |
| Custom-domain and provider enablement | SITE-02 | External DNS/TLS/account facts do not exist in repository tests | Wave 7 follows the exact re-entry packet only after registered/entity/provider facts exist. No Phase 48 execution may mark this passed. |
| Exact production founder acceptance | SITE-01, SITE-02, LAND-01, LAND-02 | Requires one promoted production revision and anonymous public traffic | Wave 8 runs the frozen-revision desktop/mobile authoring and anonymous-runtime packet. No local fixture may satisfy this row. |

---

## Validation Sign-Off

- [x] Planner replaces every provisional row with exact plan/task IDs and commands.
- [x] All tasks have `<automated>` verification or a named prior test dependency.
- [x] Sampling continuity: no three consecutive tasks without automated verification.
- [x] Existing infrastructure covers Wave 0; no missing framework install.
- [x] No watch-mode flags or paid/live/provider routine checks.
- [x] Targeted task feedback latency remains below 60 seconds; browser/build/free-gate checks are explicitly end-of-wave.
- [x] `nyquist_compliant: true` is justified by the complete 18-task map and automated command on every task.

**Approval:** ready for plan-checker verification
