---
phase: 48-business-website-and-landing-page-runtime
status: proposed
wave: 3
acceptance_gate: Wave 2 complete; Phase 48 entry depends on verified Wave 2 contracts
requirements: [SITE-01, SITE-02, LAND-01, LAND-02]
---

# Phase 48 public website and landing-page runtime — architecture proposal

This is a planning proposal only. It does not create a route, schema, deployment, domain, public
form, provider connection, or legal claim. Phase 48 is the single technical owner for SITE-01,
SITE-02, LAND-01 and LAND-02. Phase 49 owns recipe/eval/activation work (SITE-03/LAND-03), and
Wave 7 owns entity, domain/DNS/TLS, hosting/provider and public-production prerequisites.

## Contract boundary

The existing `apps/web/app/page.tsx` is Pikar's static homepage, not a tenant site runtime. The
existing Phase 31 funnel is a bounded file-link/counter surface, not a page publisher. Phase 48
must reuse the existing contacts/suppression and bounded attribution primitives without turning
either surface into a second CRM or a generic CMS.

The runtime must provide one declared public renderer for both a multi-page business site and a
campaign landing page. A tenant user can create/edit a structured draft, preview it responsively,
approve one exact version, publish it, update it, unpublish it, and roll back to an exact prior
published version. Every public read resolves only the current published pointer; drafts and
unapproved versions are never public.

Custom domains are an external prerequisite, not a reason to fork the runtime. The technical
runtime should work on a platform-hosted path/host first and resolve a custom host only after a
server-owned domain binding is verified. No public claim may imply a custom domain while its
binding is pending.

## Typed state contracts

Use closed unions in `@pikar/core`/`@pikar/contracts`; do not let the model or browser invent
states.

```ts
type ProjectKind = "site" | "landing";
type ProjectStatus = "draft" | "approved" | "published" | "unpublished" | "publish_failed";
type DomainMode = "platform_path" | "custom_pending" | "custom_active";
type PublicationAction = "publish" | "update" | "unpublish" | "rollback";
type PublicationStatus = "pending" | "published" | "failed" | "rolled_back" | "unpublished";
type PublicReadState = "published" | "not_found" | "unpublished" | "invalid_host" | "render_failed";
type FormOutcome =
  | "accepted"
  | "duplicate"
  | "invalid"
  | "consent_required"
  | "suppressed"
  | "rate_limited"
  | "unavailable";
```

`approved` is bound to `(projectId, version, contentHash)` and is invalidated by any edit. A
publish/update/rollback command must name that exact approved version. `publish_failed` is a derived
read state from the latest failed publication attempt while the authoritative published pointer
still names the prior version; it never silently advances the pointer. Unpublish is a deliberate
pointer clear, not deletion of version history. `published`, `unpublished` and `publish_failed`
must not become a second independently mutable state machine.

## Tenant-safe data model

The schema should follow the existing `tenantQuery`/`tenantMutation` wrappers and tenant-leading
indexes. Names below are proposed, not implementation instructions.

### `webProjects` — one mutable head per tenant/project

Fields: `tenantId`, `kind`, `slug`, `title`, `domainMode`, `draftVersion`, `approvedVersion`,
`publishedVersion`, `revision`, `createdAt`, `updatedAt`. The displayed project status is derived
from these pointers and the latest audit outcome; it is not a second lifecycle authority.

Indexes: `by_tenant`, `by_tenant_slug`, and a public lookup that resolves `(host, slug)` to a
tenant-owned published pointer without accepting a tenant id from the request. The public lookup
must reject absent, ambiguous, inactive and non-published bindings.

The row is a pointer/coordination record, not the history. Pointer changes use a revision/CAS
guard so two browser tabs cannot publish over one another or roll back an unseen version.

### `webProjectVersions` — append-only structured versions

Fields: `tenantId`, `projectId`, monotonically increasing `version`, `document`, `contentHash`,
`rendererVersion`, `createdBy`, `createdAt`, `basedOnVersion`, and immutable source/provenance
refs. There is no free-form HTML or executable code field. A version is never patched or deleted
by ordinary lifecycle operations.

`document` is a bounded AST (page metadata, navigation, sections, text, images by storage ref,
links, CTAs, and bounded forms). Every node has a closed kind and bounded fields. URLs are limited
to approved local paths or `https:` targets; arbitrary attributes, CSS, script, iframe, event
handler and `javascript:` URL fields are rejected at the contract boundary.

### Version-owned rendered artifact

Render and store deterministic bytes before appending the immutable version row, then include the
storage reference, byte length, SHA-256 and renderer identity on that version. A failed append must
clean up the just-created unreferenced blob; a later erasure/export walk must include this storage
field. Publication points to the version, whose artifact is therefore immutable and cannot drift.
A rollback restores the exact prior artifact/hash rather than re-rendering changed input.

### Existing audit receipts

Do not add a second publication-history table unless implementation proves the existing typed
append-only audit cannot carry the required receipt. Each publish/update/unpublish/rollback attempt
uses the existing audit insert path with tenant/project/version/artifact refs, action, previous and
resulting pointer refs, status, failure reason (closed enum), actor and timestamps. It carries refs,
hashes, ids and counts only. The audit receipt is evidence, not the source of truth; the project
pointer is. Failed attempts remain evidence and do not mutate the active public pointer.

### `webMetrics` — bounded aggregate counters

Counters are keyed by tenant/project/version and a closed metric kind (`page_view`, `cta_click`,
`form_accepted`, `form_rejected`). They contain integers and timestamps/windows only. Raw request
events, IP addresses, user agents, names, emails and form bodies never enter telemetry or audit.
Counts must be labelled as raw requests where bots/retries may be included, matching the existing
Phase 31 funnel caveat.

### `webSubmissions` — idempotency and abuse state

Store a short-lived, tenant/project/form-scoped hash of the idempotency key and outcome refs so a
retry returns the same legal outcome without creating a second contact. Do not store raw IPs:
derive a keyed short-retention abuse bucket from server-held material, with bounded windows and a
documented deletion/retention policy. The write must resolve tenant/project/form from the verified
public host and published version; caller-supplied tenant ids are forbidden.

## Rendering and public runtime

The canonical renderer is a pure function: `(validatedDocument, rendererVersion) -> UTF-8 HTML`. It
must escape all text, emit stable attribute ordering and whitespace, and produce the same bytes for
the same version. The allow-list is deliberately small: site shell, navigation, hero, text,
media-by-storage-ref, CTA, form, section and footer. No arbitrary HTML, JavaScript, CSS, inline
event handlers, third-party script tags or model-generated executable content is accepted.

The authenticated editor renders the same AST through the same component registry. Preview receives
an exact version pin and never reads “latest candidate” implicitly. The public adapter serves only
the artifact on the version named by the published pointer and returns explicit `not_found`, `unpublished`,
`invalid_host` or `render_failed` states. It must not fall back to the newest draft or another
tenant's project.

The platform-hosted URL shape can be selected in the Phase 48 plan; a single adapter must also
support host-based custom-domain resolution later. `sitemap.ts`, `robots.ts` and global legal pages
remain separate from tenant content until a routable public runtime and legal/domain facts exist.

## Forms, leads and attribution

Forms are AST nodes with a closed field schema. The minimum supported form is email plus optional
name/company and an explicit consent checkbox whose exact wording is part of the published version.
The browser submits `project`, `page`, `form`, `publishedVersion`, source attribution and an
idempotency key, but the server trusts none of those for tenant selection; host/slug resolution and
the published pointer are authoritative.

The public write is a narrow HTTP/internal adapter that calls the existing contact upsert and
suppression logic. It writes the existing Phase 19 contact row with `origin: "inbound"`,
`consentSource: "inbound-form"` only when the submitted consent is valid, and preserves the exact
wording/context in the content plane. It does not create a second lead table or send email.

Required outcomes are explicit: malformed/unknown form, missing consent, duplicate idempotency key,
suppressed address, rate limit and unavailable project each return a distinct safe result. A valid
submission creates or updates exactly one contact and returns only a public-safe acknowledgement;
audit/telemetry gets refs/counts/outcome, never the email, name, company, wording or form body.

## Approval, publish and rollback semantics

1. `createDraft` creates a versioned structured document under the tenant.
2. `saveDraft` appends a new version; it never patches an old version.
3. `approveVersion` requires the exact version/hash and records the actor; any later save clears
   the approval pointer.
4. `publishVersion` atomically checks approval, domain/runtime readiness, version artifact/hash and
   CAS revision, then moves the published pointer and appends an audit receipt.
5. `update` is a publish of a newer approved version; a failure leaves the prior version public.
6. `unpublish` clears the pointer while retaining all versions/artifacts and audit receipts.
7. `rollback` names an exact prior published version/artifact, uses the same approval and CAS
   rules, and appends a rollback audit receipt. It never means “restore whatever is newest”.

No lifecycle action deletes history. Tenant erasure/export must include project rows, versions,
audit refs, metrics, idempotency rows and rendered storage artifacts according to the existing
storage-field map and privacy decisions.

## Ownership split

Phase 48 should be planned as disjoint work groups:

1. **Core contracts/renderer:** AST, closed states, limits, canonical HTML, URL/form validation,
   deterministic hashes and unit/mutation checks.
2. **Backend persistence:** additive schema, tenant-safe queries/mutations, immutable versions,
   pointer CAS, version-owned artifact generation, audit receipts, metrics and erasure/export wiring.
3. **Authenticated editor/preview:** dashboard route, multi-page navigation editor, brand inputs,
   form editor, exact-version preview, approval and honest loading/empty/error/refusal states.
4. **Public runtime:** one platform/custom-host adapter, published-version artifact reads, headers, SEO metadata,
   route isolation, unpublish and failure behavior.
5. **Public forms:** bounded POST adapter, host/version binding, rate/idempotency controls, contact
   upsert, consent/suppression outcomes and aggregate conversion counters.
6. **Acceptance/playbook:** desktop/mobile keyboard UAT, accessibility/SEO checks, two-tenant
   isolation, publish/update failure, unpublish, exact rollback bytes, duplicate/rate-limit/consent
   matrix, cleanup and Wave 7 re-entry packet.

Phase 49 must not be pulled into these tasks: recipe provenance/eval/activation is a later owner and
must consume this runtime through typed structured input.

## Meaningful verification matrix

| Area | Required checks |
|---|---|
| Contract | AST allow-list, size/depth caps, URL/script rejection, deterministic HTML/hash, renderer version pin |
| Isolation | Authenticated private reads/edits/previews/publication refuse a foreign tenant. Published pages and forms remain public to anonymous and signed-in visitors; the server derives the owning tenant from the published host/path and never lets a submission select another tenant. Public host/slug ambiguity fails closed |
| Versioning | Edits append, old versions remain byte-stable, approval binds exact hash, stale CAS publish/rollback refuses |
| Lifecycle | Draft → approve → publish; update failure retains old public bytes; unpublish returns explicit state; rollback restores exact prior hash |
| Runtime | Only published pointer is public; no draft fallback; headers/SEO/accessibility; platform path and custom-host pending states |
| Forms | Valid lead once, duplicate idempotency, malformed field, missing consent, suppressed address, abuse limit, expired/unpublished version, no outbound send |
| Privacy | Content-plane contact fields excluded from audit/metrics; no raw IP/user-agent/form body telemetry; erasure/export includes all owned rows/artifacts |
| Responsive UAT | Nontechnical editor and public page at desktop/mobile widths, keyboard/focus, visible loading/empty/error/refusal states |
| Release | Exact revision, clean build/deploy, public bytes/hash receipt, claim-versus-code review, Wave 7 domain/legal prerequisites clearly separate |

## Acceptance gate

This proposal may be reviewed now. Phase 48 entry depends on verified Wave 2 technical product-spine
contracts. A later Phase 48 plan must name exact source files, tests, playbook
watch paths, cleanup and rollback. No external domain, legal entity, provider, anonymous production
traffic or public claim is authorized by this proposal.
