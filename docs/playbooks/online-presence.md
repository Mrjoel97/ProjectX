> Last verified: 2026-10-22 — 53-05 adds real owned logo/hero/gallery preparation, exact-version private image preview and current-published-only raster serving. The actual specialist loop prepares imagery before save/build; source warnings, immutable copies, tenant export/erasure and human exact-version review remain. See ADR-063, docs/design/online-presence-media.md and53-05-SUMMARY. Pure goods foundations were recovered under partial53-03; working checkout/hosted qualification remain open.

> Last verified: 2026-10-21 —53-04 Taste and UI/UX Pro Max quality pass adds business-directed editorial/studio/technical rendering, source-backed brand colors, useful home content and content-dependent pages. Profile direction and current renderer/compiler identity flow through schema, provenance and immutable versions; old published bytes remain unchanged. Real browser checks cover1440/768/390, touch targets, contrast/focus, long text and actual actions. See docs/design/online-presence-quality.md and53-04; no hosted model/recipe acceptance is implied.

# Playbook: Agentic online presence

> Last verified: 2026-10-21 against the isolated Phase53 working tree; local verification is recorded in `53-VALIDATION.md`. Hosted qualification remains open.
> Build history: `.planning/phases/53-agentic-online-presence/` · ADR: `docs/decisions/062-online-presence-selective-recovery.md`

## Purpose

Prepare a business website or landing page from the customer's business context and conversation. The agent prepares the brief, copy and private pages; the customer supplies missing information and reviews the version before publication. A shop request records its business brief but remains blocked by the unfinished commerce runtime.

## Key files and flow

1. `dashboard/skills-workflows/page.tsx` links to `dashboard/sites/page.tsx`. `cockpit.startOnlinePresence` creates a normal tenant-owned thread and plan, then routes its messages through `onlinePresenceRun.run` and the existing `runSpecialistTurn`.
2. `contracts/skills/online-presence-specialist.md` is the canonical registry body. `core/onlinePresence.ts` owns the closed brief assessment, missing questions and receipt-derived state. `backend/convex/onlinePresence.ts` reads server-selected Foundation, confirmed Blueprint, explicit human statements and selected owned ready Vault documents.
3. `lib/onlinePresenceTools.ts` exposes context, save-brief and private-build tools. `core/toolGrants.ts` grants these only to the Executive and the exact frozen specialist tool tuple. Search uses the existing scoped Vault reader. No model approval or publication tool exists.
4. `webRecipes.ts` binds active canonical recipe identity and qualification to `core/webRecipes.ts`, `webDesignRenderer.ts` and `webRuntime.ts`. Stored immutable versions carry actual rendered page artifacts and hashes. Repeating an unchanged saved brief reconciles its existing project; a changed brief creates a new immutable version.
5. `OnlinePresenceCard.tsx` shows real receipt state. `SiteEditor.tsx` reviews an exact version; `PreviewCanvas.tsx` selects its stored pages and mobile/desktop widths. Its inert iframe receives a presentation-only base target; stored bytes and hashes are untouched.
6. `webProjects.ts` owns exact-version/hash approval, publish, update, unpublish and rollback. `webHttp.ts` registers `/p/` GET/HEAD and consented inquiry POST through `webRuntime.ts` and `webForms.ts`.

## Invariants

- Tenant/thread/plan and source approval are derived by the server. Model references cannot promote another tenant's document, a generated summary, or arbitrary research into authoritative business evidence. Source revisions are rechecked before a build. Tests: `onlinePresence.test.ts`.
- Private/planned/stale source warnings accompany the private draft. Source membership is provenance, not proof of every claim. Publication requires reviewing the actual copy; private documents do not authorize automatic disclosure.
- The model never receives approval, publish, credentials, checkout or arbitrary content-write capabilities. Exact frozen grants are tested in `core/toolGrants.test.ts`; the existing bounded skill runner executes the tool loop.
- Approval and publication bind the same saved version and content hash. Edits preserve already published bytes. A stale revision refuses. Cross-tenant access, erasure and exact approval are tested in `webProjectLifecycle.test.ts`, `webProjects.test.ts` and `webRuntime.test.ts`.
- Public serving resolves only published immutable bytes for the configured host and live tenant. No scripts, arbitrary executable HTML or public preview fallback. Contact forms require provided consent, bounded streamed input, idempotence, suppression and rate controls. Tests: `webHttp.test.ts`, `webForms.test.ts`.
- `webProjects`, `webProjectVersions`, `webMetrics`, `webSubmissions`, `onlinePresenceSessions` are tenant-owned in the existing export/deletion registry. Stored artifact IDs participate in blob erasure. Audit holds refs, counts and hashes, never raw source/site copy.
- The hourly `web-form-retention` cron only deletes expired privacy rows in bounded pages. No generalized user recurrence is introduced.
- Storefront runtime and checkout are code-owned unavailable. Platform subscription billing and invoice connector credentials do not establish a customer's merchant checkout.

## Changing and verifying

Read the Phase53 discovery/design and ADR before changing source authority, publication or commerce. A compiler/renderer/profile change retires prior recipe evidence; seed a new candidate and earn deterministic and actual browser qualification before activation. Never fabricate hosted evidence from local test counts. Preserve older draft-PR Phase48–50 histories under their full directory names; current-main managed-service phases retain their own meaning.

Run the focused core web/online-presence tests, backend online-presence/project/runtime/form/HTTP/recipe tests, frontend service-card/editor/preview interactions and all three package typechecks. Run `compile-design-knowledge.mjs --check` and `verify-design-knowledge-provenance.mjs --self-test`; verify accepted command flags before use. Run tenant isolation/export/erasure, schema, trace parity, grants and registry suites after shared changes. CI free gates and evaluator fingerprints must match the integrated source; refreshing identity creates no passing evaluation evidence.

## Operations and remaining work

The checked-in source does not deploy or seed a shared environment. Development needs the configured Convex backend, `online-presence-specialist` registry seed, qualified active recipes and valid public runtime host. Until those exist the workflow must return a truthful unavailable result. Production release needs the existing readiness programme plus exact-source native authenticated end-to-end review and recipe browser qualification. Local mocked provider/tool tests exercise integration but do not certify model quality, real customer sign-in or hosted publication.

Custom domains, rich customer asset selection, real merchant onboarding, Stripe plus PayPal test-mode checkout, inventory holds, paid stock races, refunds, delivery and digital fulfillment remain separate work. Preserve the already recorded merchant decisions in the discovery report; do not re-ask them or enable a shop from a flag.
