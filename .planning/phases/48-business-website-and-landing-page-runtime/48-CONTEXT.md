# Phase 48: Business Website and Landing Runtime - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning
**Source:** PRD Express Path (`48-ARCHITECTURE-PROPOSAL.md`)

<domain>
## Phase Boundary

Deliver one structured, durable creator/editor and one declared public runtime for tenant-owned
multi-page business sites and campaign landing pages. The phase owns responsive preview plus exact
version create, edit, approve, publish, update, unpublish and rollback semantics; anonymous lead
capture; attribution and aggregate conversion measurements; and repository-controlled hosting,
accessibility, SEO, privacy, isolation, failure and recovery behavior.

The existing Pikar homepage and Phase 31 funnel are not tenant page publishers. Phase 48 must reuse
Phase 19 contacts, consent and suppression instead of creating a second CRM. Phase 49 owns reusable
recipe/evaluation/activation work. Wave 7 owns custom-domain DNS/TLS and provider/formal enablement;
Wave 8 owns exact-production founder acceptance.

</domain>

<decisions>
## Implementation Decisions

### Structured project and version contracts

- Use closed unions for project kind, lifecycle actions, publication outcomes, public-read states,
  domain posture and form outcomes.
- Keep one mutable tenant/project coordination head and append-only immutable structured versions.
- Do not store arbitrary HTML, JavaScript, CSS, iframes, event handlers or executable model output.
- Bind approval to the exact `(projectId, version, contentHash)` and invalidate it after any edit.
- Use revision/CAS protection for publication and rollback so stale browser tabs fail closed.
- Derive displayed lifecycle status from authoritative pointers and receipts rather than maintaining
  a second mutable state machine.

### Deterministic renderer and artifacts

- Implement the canonical renderer as a pure `(validatedDocument, rendererVersion) -> UTF-8 HTML`
  function with escaped text, stable ordering and deterministic bytes.
- Use a small closed AST supporting shell, navigation, hero, text, media references, CTA, form,
  section and footer nodes with explicit size/depth/URL limits.
- Render and store immutable version-owned bytes before appending the version record; record storage
  reference, byte length, SHA-256 and renderer identity.
- Clean up a just-created unreferenced artifact when the version append fails.
- Rollback restores an exact prior version and artifact/hash; it never re-renders changed input.

### Publication and public runtime

- Serve only the artifact named by the authoritative published pointer; drafts and unapproved
  versions are never public and there is no fallback to a newer draft or another tenant.
- Support a platform-hosted path first through the same adapter that can later resolve a verified
  custom host. Custom-pending must never be advertised as active.
- Update failure leaves prior published bytes live. Unpublish clears the pointer but retains
  history. Every publish/update/unpublish/rollback attempt appends a refs-only audit receipt.
- Public reads return explicit published, not-found, unpublished, invalid-host or render-failed
  outcomes and safe headers/SEO metadata.

### Authenticated editor and preview

- Provide a nontechnical dashboard editor for multi-page navigation, brand inputs, sections, CTAs
  and bounded forms.
- Preview an exact version through the same component/AST registry used by the public renderer; it
  must never read an implicit latest candidate.
- Show honest loading, empty, partial, refusal, error and success states and support responsive,
  keyboard-accessible desktop/mobile operation.

### Forms, leads and measurement

- Minimum form: email plus optional name/company and an explicit consent checkbox whose exact
  wording belongs to the published version.
- Derive tenant, project, version and form from the verified public host/path and published pointer;
  reject caller-supplied tenant selection.
- Reuse Phase 19 contact upsert, consent and suppression. Persist inbound origin and valid consent
  context in the content plane; do not create a second leads table or send mail.
- Return distinct public-safe outcomes for invalid input, missing consent, duplicate idempotency,
  suppression, abuse limit and unavailable/unpublished content.
- Store only short-lived hashed idempotency/abuse state. Never put raw IPs, user agents, names,
  email addresses, consent wording or form bodies in metrics, audit or logs.
- Keep aggregate counters by tenant/project/version and closed metric kind, labelled honestly as
  raw requests where bots or retries may be included.

### Privacy, governance and acceptance

- Extend existing export/erasure ownership maps to projects, versions, metrics, idempotency state
  and rendered storage artifacts.
- Preserve tenant-leading indexes and tenant wrappers for authenticated operations. Anonymous reads
  and writes resolve ownership only through verified published routing.
- Prove success, refusal, durable failure, bounded idempotent retry, cancellation/unpublish,
  refresh/recovery, audit linkage, isolation, bounded cost, accessibility and responsive states.
- Keep all custom-domain, legal-entity, DNS/TLS, hosting-provider and anonymous-production evidence
  in an explicit Wave 7 re-entry packet; do not claim those layers here.

### Claude's Discretion

- Exact platform-path URL shape, within the single-adapter and server-owned-routing constraints.
- Exact schema/table and pure-module names, provided they follow repository conventions and avoid a
  duplicate CRM or publication-history authority.
- Exact plan split and test-file organization, provided ownership is disjoint and the complete
  verification matrix is executable.
- Editor interaction details that are not fixed above, provided they comply with `BRAND.md` and
  accessibility requirements.

</decisions>

<specifics>
## Specific Ideas

- Prefer a `webProjects` pointer record, append-only `webProjectVersions`, aggregate `webMetrics`
  and short-lived `webSubmissions` idempotency/abuse records.
- Use existing typed append-only audit receipts instead of adding a second publication-history
  table unless implementation proves the existing audit contract cannot carry the required refs.
- Plan disjoint ownership for core contracts/renderer, backend persistence, editor/preview, public
  runtime, forms, and acceptance/playbook work.
- Required acceptance includes two-tenant isolation, stale-CAS refusal, failed update preserving
  old bytes, explicit unpublish, byte-exact rollback, consent/suppression/rate/idempotency matrices,
  export/erasure coverage, desktop/mobile keyboard UAT and a Wave 7 re-entry packet.

</specifics>

<deferred>
## Deferred Ideas

- Reusable website, landing-page and storefront recipes, provenance, evaluation and activation are
  Phase 49 / Wave 4.
- Tenant merchant catalogue, checkout, orders, payments, refunds and fulfilment are Phase 50 / Wave 5.
- Custom-domain DNS/TLS, provider applications and formal enablement are Wave 7.
- Exact-production founder qualification on the promoted revision is Wave 8.

</deferred>

---

*Phase: 48-business-website-and-landing-page-runtime*
*Context gathered: 2026-09-21 via PRD Express Path*
