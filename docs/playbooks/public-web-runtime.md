# Playbook: Public web runtime

> Last verified: 2026-09-28 — the Phase 49 disposable runner has a terminal-only,
> 20-minute-bounded `--interactive` mode for CLI-driven local browser review. It uses the
> same loopback backend, production web build, in-stack audit and owned-root cleanup as
> its allowlisted specs; it does not run or replace those qualification specs. A synthetic
> Wave 4 edit walkthrough completed and cleanup removed its exact root. The runner source
> changed, so Phase 49's prior 71-file aggregate identity is retired until requalified.
>
> Last verified: 2026-09-27 — the isolated Phase 49 integrated browser spec now waits for a
> persisted signup JWT and confirms the authenticated backend owner flag before checking the
> owner-only page. Its targeted fresh disposable stack, nine-project desktop/mobile matrix,
> isolated audit and owned-root cleanup passed. This narrows an intermittent failure's diagnostic
> boundary; it does not prove its root cause is fixed. Renew the 71-file aggregate and exact
> source digest before citing repository/local qualification at the changed test revision.

> Last verified: 2026-09-27 (watch-gate acknowledgment only - **a `Last verified` bump plus a forward
> record, NOT a verification of the sections below.** No public-runtime code, route, form, renderer
> or recipe changed, and no design-knowledge CONTENT changed.
> `third_party/design-knowledge/manifest.json` changed only because the offline compiler rewrote it,
> and it is now excluded from biome alongside `designKnowledge.generated.ts`: the compiler and the
> formatter each rewrote the other's bytes in a loop, so the compiler's hash-of-itself
> (`compilerSha256`) and `compiledBundleHash` could never both satisfy `--check` and `biome ci` at
> the same time. Byte-exactness is that file's contract, so the formatter must not own those bytes.
> The bundle hash is unchanged at `d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8`
> across eight compiled records and three immutable MIT sources, so every page, proof and citation
> below still resolves to the same knowledge as before.)

> Last verified: 2026-09-25 - the anonymous form's active abuse-bucket lookup now bounds the
> existing `by_tenant_abuse_bucket` index by `abuseWindowExpiresAt > now` before taking five
> rows. Expired rows no longer require a post-index filter scan to find the active window;
> the 15-minute policy, outcomes, stored fields and hourly retention sweep are unchanged.

> Last verified: 2026-09-24 — the hourly `web-form-retention` mutation no longer collects
> every project and loops over every tenant in one transaction. `webSubmissions.by_expires_at`
> selects the oldest expired coordination rows across tenants, deletes at most 100 per call,
> and returns `{deleted, hasMore}`. A two-tenant 101-expired-row test proved that a second
> call drains the remainder without touching a live row; the fixed cron remains hourly.
> This bounds each transaction and prevents project-order starvation, but is **not** a
> throughput or strict 24-hour deletion guarantee under sustained backlog. Check
> `hasMore` through a bounded operator invocation and repeat only as needed on the
> verified deployment; measure ingress and cleanup capacity before production-scale claims.

> Last verified: 2026-09-24 — Phase 50 Plan 05 adds a same-origin, bounded, read-only
> commerce cart preflight under the shared `/p/` POST router. It asks the existing
> host/page resolver, rejects caller tenancy/account/payment fields and returns closed
> 404 before any cart/order/hold write. Existing site/landing GET, CTA and form routes
> stay unchanged; storefront discovery, publish, resolver and public bytes remain dark.

> Last verified: 2026-09-24 — Phase 50 Plan 03 adds private tenant catalogue controls
> to the authenticated sites route. Those controls use tenant-scoped Convex adapters and
> do not change Phase 49 stored publication bytes, `commerceContractReady()`, anonymous
> HTTP, or storefront discovery. The new UI is local-tested; public selling remains dark.

> Last verified: 2026-09-23 against Phase 49 recipe-backed designed-renderer source and isolated
> browser protocol; final aggregate result is recorded in `49-VERIFICATION.md`.
> Build history: `.planning/phases/48-business-website-and-landing-page-runtime/` · Related ADRs: none

## Purpose

This subsystem lets an authenticated tenant author a structured site or landing page, preview an
immutable rendered version, approve it, and publish it on the Pikar platform path. Anonymous reads,
CTA counters, and contact forms use a narrow HTTP boundary. Phase 48 proves repository-controlled
behavior only; it does not prove a custom domain, provider approval, production traffic, legal
formation, or founder beta acceptance.

## Key files

- `packages/contracts/src/webRuntime.ts` — closed structured document and lifecycle contracts.
- `packages/core/src/webRuntime.ts` — validation, canonical hashing, deterministic HTML rendering,
  safe CTA targets, and retention constants.
- `packages/core/src/webForms.ts` — pure allowlisted inbound-form parser and consent provenance.
- `packages/backend/convex/webProjects.ts` — tenant lifecycle, exact-version CAS, rollback, and
  server-owned host binding; recipe-backed versions pin the selected designed renderer profile.
- `packages/core/src/webDesignRenderer.ts` — pure closed-profile designed rendering for recipes.
- `packages/core/src/designKnowledge.ts`, `designKnowledge.generated.ts`, `webRecipes.ts`, and
  `webRecipeFixtures.ts` — pinned offline bundle, closed recipe definitions and exact evaluator
  cases. `third_party/design-knowledge/` pins the three upstream sources and MIT notices.
- `packages/backend/convex/webRecipes.ts` — server-side recipe preview and qualification transcript.
- `packages/backend/convex/webRuntime.ts` — anonymous exact-artifact resolver and closed refusal states.
- `packages/backend/convex/webForms.ts` — bounded idempotency, abuse state, suppression, contact
  upsert, attribution, aggregate counters, and expiry-indexed retention cleanup.
- `packages/backend/convex/http.ts` — anonymous GET/HEAD/POST boundary and security headers.
- `apps/web/app/(app)/dashboard/sites/` — protected editor and exact stored-artifact preview.
- `apps/web/e2e/phase48-web-runtime.spec.ts` — disposable local authenticated/anonymous matrix.
- `apps/web/e2e/phase49-recipe-qualification.spec.ts` and `phase49-web-recipes.spec.ts` — exact
  candidate witness and integrated tenant/anonymous lifecycle, each on a fresh owned stack.
- `apps/web/e2e/phase49-disposable-stack.mjs` — production build, isolated loopback Convex,
  allowlisted exact spec selection, process ownership and cleanup.

## Dependencies & blast radius

`graphify query "Phase 48 public web runtime"` identifies the contract, renderer, Convex, HTTP, and
editor subgraph. Runtime-only dependencies that the graph cannot establish are `CONVEX_SITE_URL`
for the server-owned platform host, a continuously running local Convex deployment for browser
qualification, and an already running web app on port 3111. There is no external hosting provider,
DNS API, mailbox, model, or payment dependency in Phase 48.

## Data flow

1. `createDraft`/`saveDraft` validate a closed `WebDocument`, canonicalize it, render every route,
   hash the whole document, and append `webProjectVersions` artifacts.
2. `approveVersion` binds an exact version and content hash. `publishVersion`, `updateVersion`, and
   `rollback` compare the current revision, approved pair, runtime declaration, and unique host/slug.
3. `resolvePage` returns only the stored artifact for the published exact version. `http.ts` exposes
   it under `/p/:slug/:page` with no-store, no-referrer, nosniff, hosting, and source headers.
4. Rendered CTA forms POST to the runtime; the server resolves the declared target and increments a
   raw-request `cta_click` counter before a 303 response.
5. Rendered contact forms POST allowlisted fields. `submit` resolves the published form, hashes
   idempotency/abuse keys, enforces consent and suppression, writes one inbound contact, preserves
   bounded publisher-authored attribution, and records only bounded outcome coordination rows.

## Invariants — what must never break

- Public bytes are stored immutable artifacts, never a render of current draft code. Enforced by
  `webRuntime.test.ts`, `webRuntimeHttp.test.ts`, preview tests, and the browser exact-byte check.
- New recipe-backed versions store designed HTML for their pinned profile; owner preview uses the
  same server materialization. Editing creates another immutable version. Legacy/manual versions
  and previously published bytes remain unchanged.
- Three pinned MIT upstream roles are reviewed as data and compiled offline into a Pikar-owned
  bundle. Never execute upstream Markdown, prompts, installers, CLI commands or network advice in
  a tenant request. Changes to upstream bytes, exclusions, compiler or renderer require a new
  manifest, deterministic evaluator and fresh exact browser/owner evidence before activation.
- A recipe project stores the originating skill id/version/body hash, definition, input and bundle
  hashes, plus renderer/profile refs. Field and advanced JSON edits append versions while keeping
  that origin and existing route, form, consent, attribution and analytics identities. Stored
  artifacts remain exact bytes across recipe v1→v2→v1 activation and rollback.
- Storefront activation qualifies a private owner artifact only. `commerceContractReady()` is a
  code-owned false seam: tenant discovery/controls, all publication mutations, resolver and
  anonymous HTTP stay dark even for a malformed stored published pointer. Phase 50 must supply
  the typed merchant lifecycle before this boundary changes.
- Host and tenant selection are server-owned. A missing, foreign, pending, duplicate, or ambiguous
  binding fails closed. Enforced by resolver, HTTP, lifecycle, and two-tenant collision tests.
- Draft, approved, and published are distinct; every publish/update/rollback binds revision,
  version, and hash. Enforced by `webProjects.test.ts` and browser stale/rollback drills.
- CTA activation comes from the rendered POST form. No test or product path substitutes a direct
  CTA endpoint call. Enforced in the Phase 48 browser spec.
- Anonymous form storage contains no raw body, address, user-agent, IP, or plaintext idempotency
  key. Consent wording/source and bounded attribution are code/publisher owned. Enforced by form
  integration tests and audit-payload checks.
- Idempotency expires after 24 hours; abuse coordination expires after 15 minutes. The hourly cron
  sweeps tenant-leading indexes. A rate-limited request does not add an unbounded coordination row.
- `page_view`, `cta_click`, `form_accepted`, and `form_rejected` are raw-request aggregates. They are
  not unique visitors, people, conversions, or business outcomes.

## How to change safely

Change contracts first, then pure validation/rendering, then additive schema, then thin Convex and
HTTP adapters, and finally editor/runtime consumers. Add a deterministic renderer-version change
when output bytes change; old versions must continue serving their stored bytes. For a lifecycle
change, preserve exact CAS and append-only publication receipts. For a form change, keep the input
field set closed and update deletion/export classification before accepting new personal data.
Never weaken a refusal to make a local test pass.

## How to verify

```text
pnpm --filter @pikar/core test -- src/webRuntime.test.ts src/webForms.test.ts
pnpm --filter @pikar/backend test -- convex/webProjects.test.ts convex/webRuntime.test.ts convex/webRuntimeHttp.test.ts convex/webForms.test.ts
pnpm --filter @pikar/web test -- app/(app)/dashboard/sites/siteEditor.test.tsx app/(app)/dashboard/sites/preview/previewCanvas.test.tsx
pnpm --filter @pikar/core typecheck
pnpm --filter @pikar/backend typecheck
pnpm --filter @pikar/web typecheck
pnpm --filter @pikar/web build
node scripts/check-phase48-acceptance.mjs --self-test
node scripts/verify-design-knowledge-provenance.mjs --self-test
node scripts/verify-design-knowledge-provenance.mjs
node scripts/compile-design-knowledge.mjs --check
node packages/backend/scripts/run-web-recipe-evals.mjs --self-check
node apps/web/e2e/phase49-disposable-stack.mjs e2e/phase49-recipe-qualification.spec.ts
node apps/web/e2e/phase49-disposable-stack.mjs e2e/phase49-web-recipes.spec.ts
node scripts/check-phase49-acceptance.mjs --self-test
node scripts/check-phase49-qualification.mjs --self-test
node scripts/check-phase49-qualification.mjs
node scripts/check-playbooks.mjs
node scripts/check-planning.mjs
node scripts/check-audit-payloads.mjs --self-test
node scripts/check-free-gates.mjs
```

With the disposable local stack and identity running, execute
`pnpm --filter @pikar/web test:e2e -- e2e/phase48-web-runtime.spec.ts --project=chromium`.
A Playwright listing or skipped test is preparation, not browser evidence.
The Phase 49 runner accepts only the two paths listed above and creates its own fresh production
stack and owner/tenant identities. Do not point it at `.convex/local/default` or a shared session.
Record the fixture marker, exact project ids, candidate refs/hashes and the owned-root cleanup
result. A failed cleanup or unavailable Git/Graphify check is an open gate, never a green result.

## Operational notes

Run `convex dev` continuously and the web app on 3111; the anonymous local runtime defaults to
3211. Set `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` only for a disposable local identity. The spec
uses internal local fixture seams, re-authenticates after CLI calls, cleans its project/contact/
suppression rows, and deliberately retains append-only audit receipts. If interrupted, call
`smoke:cleanupPhase48Acceptance` with the captured exact project ids before re-running.

Rollback is an exact previous version/hash publication, not regeneration. When a publish/update
fails, verify the prior public bytes remain unchanged; repair the declaration or collision, reload
the editor, and retry with the current revision. Never repair by editing immutable version rows.
The dedicated Phase 49 fixture cleanup verifies all three captured families and exact run token
before deleting any registry rows; the project cleanup receives only fixture-owned ids. Audit
receipts are append-only. A failed isolation check requires a fresh disposable deployment.

## Known gaps & deferred work

Custom domains, domain ownership, DNS, TLS, external hosting/provider approval, production anonymous
traffic, and legal registration remain Wave 7 prerequisites. The provisional operating name is
`pikar-ai`; registered entity name, jurisdiction, registration number, and address are pending.
Founder beta qualification remains Wave 8 and must not be inferred from Phase 48 checks.
