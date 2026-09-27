# Phase 48 research — business website and landing-page runtime

**Measured 2026-09-21.** Research only. This document does not add a route, schema, deployment,
domain binding, provider connection, legal assertion, or public/production acceptance claim.

## Scope and governing inputs

The phase owns SITE-01, SITE-02, LAND-01 and LAND-02. The phase context and architecture proposal
are the source of truth: one bounded structured document model must serve both a multi-page site and
a campaign landing page; one tenant/project coordination head points at append-only immutable
versions; approval, publication and rollback are exact-version operations; anonymous forms reuse the
Phase 19 person/consent/suppression substrate; and all public routing resolves ownership from a
verified published host/path. The existing Pikar homepage and Phase 31 funnel are not tenant
publishers. Phase 49 owns recipes/evaluation/activation, Phase 50 owns commerce, and Wave 7 owns
custom-domain DNS/TLS/provider prerequisites. Wave 8 owns clean-production founder acceptance.

The ROADMAP adds the universal workflow definition of done: happy path, actionable refusal,
durable failure, bounded idempotent retry, honest cancellation, refresh/recovery,
approval-to-result/audit linkage, server-boundary isolation, bounded cost, and honest desktop/mobile
loading, empty, partial, refusal, error and success states. Generated HTML, a tracked download,
screenshots, Pikar subscription billing, or a provider test result cannot satisfy the runtime gate.

## Existing contracts and reusable seams

Use these seams before introducing another abstraction or table:

| Concern | Existing seam | Planning consequence |
| --- | --- | --- |
| Tenant auth and isolation | `packages/backend/convex/lib/functions.ts` — `tenantQuery`, `tenantMutation`, `tenantAction`, `owner*` | Authenticated editor/preview/publication functions must use the wrapper; never import raw Convex builders or accept a caller tenant id. Public anonymous writes need a separate internal adapter because `tenantMutation` requires auth. |
| Closed audit payload | `packages/contracts/src/audit.ts` — `AuditPayload`; `packages/backend/convex/audit.ts` — `appendAudit`, `internal.audit.log` | Publication receipts are insert-only and flat refs/hashes/ids/counts/flags. Audit is evidence, not the project pointer and cannot carry document, form, email, IP or user-agent content. |
| Stable hashes | `packages/backend/convex/lib/hash.ts` — `contentHash` | Reuse the single SHA-256 implementation at the adapter boundary. The pure renderer still needs canonical serialization and deterministic bytes; do not hash non-canonical object order or re-render on rollback. |
| Phase 19 contact writer | `packages/backend/convex/contacts.ts` — `upsertContactRow`, `recordMarketingLead`, `consentRecord`, suppression reader/writers; `packages/core/src/marketingLead.ts` — `parseMarketingLead` | Reuse `upsertContactRow` as the one contact write. Preserve `origin: "inbound"`, `consentSource: "inbound-form"` and exact published consent wording for a public form. `parseMarketingLead` currently models manual entry (`user-entered`/`asserted-by-user`), so blindly calling `recordMarketingLead` would misstate provenance; add a narrow inbound-form parser/adapter or pass the code-owned inbound values after equivalent validation. |
| Existing aggregate precedent | `packages/backend/convex/funnels.ts`, `funnels.test.ts` | Reuse its bounded token/source/counter and public HTTP testing patterns as precedent only. Do not make a funnel/download a published site, and do not add raw visitor/event rows to `funnels`. |
| Public HTTP boundary | `packages/backend/convex/http.ts` — `/f/` and `/unsubscribe/` routes, explicit method checks, no-store/referrer headers, opaque server-owned resolution | A Convex HTTP adapter is the closest existing public-runtime seam. Keep route parsing/headers thin and delegate ownership, publication and form work to internal functions. Handle `HEAD` explicitly, reject unexpected methods, and return closed safe outcomes without echoing provider/request detail. |
| Next auth boundary | `apps/web/middleware.ts` — default-deny `isPublic`; `apps/web/app/layout.tsx` | Authenticated editor pages under `(app)` are protected automatically. A new browser-rendered anonymous path requires an explicit middleware decision; do not widen it accidentally. A Convex-hosted public artifact route avoids an auth-cookie redirect but still needs exact route tests. |
| UI shell and state language | `apps/web/app/globals.css`; `apps/web/app/(app)/dashboard/CommandCenter.tsx`; `apps/web/app/(app)/dashboard/finance/FinanceView.tsx`; `apps/web/app/(app)/admin/page.tsx` | Reuse CSS variables and hand-rolled components. Existing state components distinguish `undefined` loading from `null` empty and have explicit partial/refusal/error copy. The editor/preview must carry the same state honesty and keyboard/focus rules. |
| Browser harness | `apps/web/e2e/README.md`, `apps/web/playwright.config.ts`, existing `e2e/*.spec.ts` | Use the real sign-in/storage-state path for the editor and a separate anonymous context for the public runtime. Fixtures must be disposable and seeded before authentication when CLI operations would invalidate a session. No browser test implies provider or production evidence. |
| UI brand/accessibility | `docs/design/BRAND.md`, `apps/web/app/globals.css`, `docs/playbooks/dashboard-pages.md` | Use CSS tokens, one clear headline, cards/whitespace, visible focus, keyboard operation and no color-only state. Read and update the relevant playbook when the dashboard/public UI paths are changed. |

## Data and lifecycle design to plan

The proposal's names (`webProjects`, `webProjectVersions`, `webMetrics`, `webSubmissions`) are
reasonable planning anchors, but exact names remain discretionary. Whichever names are chosen:

1. The project row is the single mutable coordination head: tenant, kind (`site`/`landing`), slug,
   domain posture, draft/approved/published pointers and a revision/CAS value. Displayed status is
   derived from pointers plus publication receipts, never maintained as a second state machine.
2. A version row is append-only structured content with a monotonic version, bounded AST, content
   hash, renderer version, actor/time and immutable provenance refs. No HTML, JavaScript, CSS,
   iframe, event-handler or executable model-output field may cross the contract boundary.
3. The AST is closed and bounded (shell, navigation, hero, text, media-by-storage-ref, CTA, form,
   section and footer). Text is escaped; URLs are limited to approved local paths or `https:`;
   size/depth/URL limits and field lengths are enforced in pure TypeScript before persistence.
4. The canonical renderer is pure: `(validatedDocument, rendererVersion) -> UTF-8 HTML`. Stable
   ordering, attributes and whitespace make the bytes reproducible. Rendered bytes are stored
   before the version append, with storage id, byte length, SHA-256 and renderer identity. If the
   append fails, clean up the new unreferenced blob. Rollback restores the old artifact/hash and
   never re-renders input.
5. Publish/update/rollback must check exact `(projectId, version, contentHash)` approval plus CAS
   revision. An update failure leaves the old published bytes live. Unpublish clears the pointer
   but retains versions/artifacts. Every attempt, including refusal/failure, gets a refs-only audit
   receipt.
6. Public reads resolve only the authoritative published pointer. They must return explicit
   `published`, `not_found`, `unpublished`, `invalid_host` or `render_failed` outcomes, never a
   draft/latest/other-tenant fallback. The platform-hosted path comes first; custom host resolution
   must remain behind a server-owned verified binding and `custom_pending` must never advertise
   active service.
7. Metrics are aggregate counters keyed by tenant/project/version and a closed metric kind
   (`page_view`, `cta_click`, `form_accepted`, `form_rejected`). Label them honestly as raw
   requests where retries/bots may be present. Idempotency/abuse rows contain only short-lived
   keyed hashes and outcome refs; never persist raw IP, user-agent, email, name, consent wording or
   form body in audit, metrics or logs.

Every new tenant-owned table needs the existing `by_tenant` leading index because both export and
erasure call it generically. Update `packages/core/src/tenantData.ts` in the same change:
`TENANT_TABLE_CLASSIFICATION` must classify project/version/metric/idempotency rows as
`tenant_owned`, and `STORAGE_ID_FIELDS` must include any rendered artifact storage field. The
existing `packages/backend/convex/tenantExport.ts` emits rows and storage links from those maps;
`packages/backend/convex/tenantDelete.ts` deletes mapped blobs before rows and has orphan reaping.
The map-driven drift tests in `packages/core/src/tenantData.test.ts` and
`packages/backend/convex/isolation.test.ts` are mandatory coverage, not documentation.
Audit/dead-letter tables remain immutable/excluded by classification; publication refs may survive
as the redaction-safe compliance record.

## Forms and Phase 19 boundary

The minimum public form is email, optional name/company and an explicit consent checkbox. The exact
wording shown is part of the published version and must be stored in the content plane alongside
the resulting contact consent context. The server must derive tenant/project/version/form from the
verified host/path and published pointer; browser fields (`project`, `form`, `publishedVersion`,
source and idempotency key) are hints only.

`upsertContactRow` already normalizes/validates identity, preserves first provenance and only
writes consent where absent. `suppressions` is independent and outlives a contact. The form path
must call these helpers in one transactional adapter, then return a closed public-safe
`accepted`/`duplicate`/`invalid`/`consent_required`/`suppressed`/`rate_limited`/`unavailable`
outcome. It must not send mail or create a leads table. A suppressed address remains suppressed;
capture never unsuppresses it. A retry with the same idempotency key returns the same legal outcome
without creating a second contact or metric.

The key implementation hazard is the current `recordMarketingLead`: it is an authenticated
tenant mutation and intentionally records manual-entry provenance. It is a useful validation and
result-shape precedent, not the anonymous public write itself. The phase should add one narrowly
named inbound-form internal seam (or extend the existing pure parser without changing manual
semantics), with server-owned `origin`/consent-source constants and tests proving no caller can
select another tenant.

## Runtime, hosting and UI boundaries

The public runtime should have one adapter for platform path and future verified custom host, with
server-owned route resolution. A public Convex HTTP route follows the existing `/f/` pattern and
keeps anonymous traffic outside Next's default-deny auth middleware; a Next route is possible but
would require an explicit `isPublic` exception and a test proving private routes remain protected.
Choose one adapter, not two divergent renderers. Set safe content type, cache/referrer/security
headers and deterministic SEO metadata from the validated document. Avoid `ctx.storage.getUrl`
outside a tenant query; serve the artifact through an ownership-checked internal read or the
declared adapter rather than leaking a bearer storage URL.

The authenticated editor should live under the existing dashboard shell and use exact version pins
for edit/preview/approve. It should offer page navigation, bounded brand inputs, section/CTA/form
editing and responsive desktop/mobile preview through the same AST/component registry as the
canonical renderer. Follow the established `CommandCenter`/`FinanceView` state model: loading,
empty, partial, refusal, error and success remain distinguishable; a failed section must not blank
the page. Native controls/details and the existing focus styles are preferred over a component
library.

## Hazards and unresolved planning choices

- Approval is invalid after every edit. Do not let a mutable `approved` boolean survive a new
  version or let a stale tab publish through a missing revision check.
- Do not use a mutable version row as publication history, and do not infer `published` from the
  presence of an artifact. The pointer and receipt are authoritative.
- Store-before-append creates a cleanup race. Tests must exercise append failure and confirm the
  unreferenced blob is removed without deleting a blob now referenced by another version.
- Deterministic output requires canonical AST validation and stable serialization; object insertion
  order, locale-dependent sorting, timestamps or random ids must not affect HTML/hash.
- Host/path parsing is a trust boundary. Reject absent, ambiguous, inactive and pending bindings;
  never accept a tenant id or project id from a public form. Test two tenants with colliding slugs.
- Form metrics can be inflated by bots/retries. Use honest raw-request labels, short retention and
  keyed hashes; do not imply unique people or conversion quality.
- Existing Phase 31 funnels count visits/claims/downloads, but using them for page publication or
  lead analytics would conflate ownership and retention semantics.
- Next's default-deny middleware, metadata/caching and browser auth state are easy to widen by
  accident. Add route registry and anonymous/authenticated boundary tests before UI polish.
- Accessibility is not an afterthought: keyboard navigation, focus order, labels, error linkage,
  touch-target sizing, responsive overflow and reduced-motion behavior need assertions and browser
  evidence. Teal/amber contrast rules in BRAND.md are specific and non-negotiable.
- Custom domains, DNS/TLS, hosting/provider approval, legal entity facts and any paid/live
  integration are Wave 7/8 inputs. Phase 48 plans must leave an explicit re-entry packet and must
  not claim those layers from local fixtures or test-mode behavior.

## Dependency and ownership guidance

Plan disjoint work groups so the pure contract can be consumed without Convex and backend adapters
remain thin:

1. **Core contracts/renderer:** closed unions, AST limits, URL/form validation, canonical HTML,
   hashing inputs and pure tests/mutation checks.
2. **Backend persistence:** additive schema, tenant indexes/wrappers, immutable versions, artifact
   lifecycle/cleanup, project CAS, audit receipts, metrics, export and erasure maps.
3. **Authenticated editor/preview:** dashboard route/components, exact-version preview, approval,
   responsive/keyboard states and UI tests.
4. **Public runtime:** one adapter, host/path resolution, published artifact reads, headers,
   metadata, unpublish/failure behavior and HTTP boundary tests.
5. **Public forms:** closed POST input/output, server-bound host/version resolution, idempotency and
   abuse controls, contact upsert/consent/suppression and aggregate counters.
6. **Acceptance/playbook:** desktop/mobile UAT, accessibility/SEO checks, isolation, stale CAS,
   failed update preserving bytes, unpublish, exact rollback, form matrix, cleanup and Wave 7
   re-entry packet.

Phase 49 must consume this runtime through typed structured inputs and must not add a second page
publisher, renderer or publication authority. Any new watched dashboard/public path requires the
corresponding playbook registration and a `Last verified` update under CLAUDE.md §9.

## Validation Architecture

Validation should be layered so each invariant is tested at the boundary that owns it:

1. **Pure contract/renderer tests (`packages/core`/`packages/contracts`):** closed-union rejection,
   AST depth/size/field/URL caps, script/event/iframe/javascript rejection, consent/form bounds,
   canonical HTML byte equality, escaping, stable ordering, renderer-version identity and hash
   changes only when intended. Include adversarial text and transposition/empty-fixture mutation
   checks so assertions cannot pass vacuously.
2. **Backend Convex tests (`packages/backend/convex/*.test.ts`):** create/edit append-only history;
   approval exact hash and invalidation; project revision/CAS races; publish/update/unpublish and
   rollback terminals; store cleanup after append failure; old bytes remain live after failed update;
   no draft fallback; audit receipts are insert-only and refs-only; metrics/idempotency retention;
   anonymous host-derived form writes; duplicate/retry, suppression, consent and abuse outcomes.
3. **Isolation/schema/export tests:** two tenants with colliding slugs/hosts, foreign reads/edits/
   previews/publication refused, ambiguous host fail-closed, no caller tenant selection, required
   `by_tenant` indexes, classification coverage, artifact inclusion in `STORAGE_ID_FIELDS`, tenant
   export rows/files and erasure of rows/files while preserving the neighboring tenant.
4. **HTTP boundary tests:** route registry has exactly the declared public methods; HEAD/unsupported
   methods are explicit; malformed/unknown/pending/unpublished/foreign hosts are uniform safe
   outcomes; content type/cache/referrer/security headers are present; form responses do not echo
   raw content or PII; public requests can never mutate another tenant.
5. **Web component tests:** editor and preview render exact pinned versions; loading/empty/partial/
   refusal/error/success states are explicit; approval button disables on stale/refused state;
   status/error text is linked to controls; no raw AST HTML injection; desktop/mobile layout does
   not lose navigation or actions. Reuse current Vitest/JSDOM patterns and state helpers.
6. **Playwright browser proof:** authenticated disposable tenant creates/edits/approves/previews a
   site and landing page at desktop and mobile widths; anonymous context reads only published
   bytes; update failure, unpublish, exact rollback and form outcome matrix are exercised through
   the real browser/HTTP boundary. Check keyboard-only navigation, focus visibility, responsive
   overflow, metadata/headers and refresh/recovery. Keep provider/domain/paid claims out of the
   test result.
7. **Static/governance checks:** import guard for raw Convex builders, audit immutability/redaction
   scans, schema drift tests, playbook watcher, TypeScript/Biome, production web build and the
   normal backend/web test gates. No test may certify a live provider, DNS/TLS, legal entity or
   production founder layer without its separately required evidence.

## Recommended planning questions

- Confirm the platform-hosted URL shape and whether the public adapter is Convex HTTP or a Next
  route; then write one route contract and one set of boundary tests.
- Confirm the exact storage artifact lifetime and whether rendered bytes use Convex `_storage`;
  this determines the required `STORAGE_ID_FIELDS` entry and erasure/export proof.
- Confirm bounded AST limits, metric windows and idempotency/abuse retention before schema work;
  these are contract decisions, not UI details.
- Confirm the inbound-form adapter shape and consent-source semantics against the existing
  `recordMarketingLead` result without changing Phase 19 manual-entry behavior.
- Keep custom-domain/provider/legal/founder acceptance as an explicit Wave 7/8 re-entry packet.

## RESEARCH COMPLETE

Phase 48 can be planned as a pure structured-contract/renderer layer plus thin Convex persistence,
one public adapter, and an authenticated dashboard editor. The highest-risk seams are exact-version
CAS/approval, deterministic artifact lifecycle, anonymous host-derived ownership, and the distinction
between Phase 19 inbound consent and the existing manual marketing-lead helper. Validation must span
pure contracts, Convex state/isolation, HTTP boundaries, UI states/accessibility, browser flows and
export/erasure maps; no live/provider/paid capability is established by this research.
