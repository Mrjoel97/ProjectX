# Phase 31: Marketing Surface and Funnel v0 — Research

**Researched:** 2026-08-10  
**Requirements:** MKTG-01, MKTG-02, MKTG-03  
**Depends on:** Completed Phase 19 person/consent/suppression substrate  
**Confidence:** High for repository architecture, public-route boundary, Phase 19 reuse, UI state semantics, and validation seams; medium for the intended meanings of `visits`, `claims`, `downloads`, and persisted `?s=` attribution because the roadmap names the counters but does not define their transition grammar.

## Executive Finding

Phase 31 should be a small aggregate-and-surface phase, not the first half of a social publishing
platform. Build one authenticated Marketing route, one aggregate `funnels` table, one thin Convex
module, and one GET-only public route family in `convex/http.ts`. Reuse Gmail's existing safe status
projection, Phase 19's single contact writer and suppression guard, the Vault/storage ownership
checks, the existing workspace/cockpit, and the current plan gate. Do not add provider credentials,
social OAuth, a publish tool, a social `ACTION_TYPES` member, a content calendar, a public Next
route, or a `funnelEvents` table.

The channel surface should be code-owned and total:

- Gmail/email is `connected` when `gmailStatus.connected` is true and otherwise `connectable` when
  `gmailConnectUrl.configured` is true.
- Meta/Instagram, LinkedIn, TikTok, X, and YouTube are `blocked-with-reason`, with copy that names
  the legal entity and Phase 32 provider review as the missing gates. They are not `0`, `inactive`,
  `disconnected`, or silently hidden.
- The agent-assistance control opens the existing workspace with marketing context. It does not
  call a provider or create a new action authority. Existing content drafting produces an artifact;
  existing email delivery still ends at one human Approve.

Funnel v0 should treat the public token as a bearer capability to one deliberately public stored
asset. Store only a SHA-256 token hash, generate the raw token server-side once, accept only GET,
resolve only an indexed active row, increment exactly one safe-integer counter in an internal
mutation, and return the storage URL from that same mutation so a missing asset cannot produce a
phantom count. The HTTP action returns the required `302` with `Cache-Control: no-store` and a
`Location` obtained only from `ctx.storage.getUrl(...)`; it never accepts an arbitrary redirect
target.

Two specification edges must be made explicit in Plan 31-01 before schema code:

1. A link-only funnel needs a code-owned stage grammar. The minimum compatible grammar is one raw
   token with three GET paths, `/f/<token>/visit`, `/f/<token>/claim`, and
   `/f/<token>/download`, each redirecting to stored bytes and incrementing only its named counter.
   These are raw request counts, not unique people, sessions, or verified humans.
2. MKTG-02 forbids a public write while MKTG-03 requires a captured lead to use Contacts. The only
   compatible observable v0 is an authenticated "Record captured lead" action on the Marketing
   surface, delegating to Phase 19's `upsertContactRow` with `origin: "inbound"` and a real
   `inbound-form` consent record. A visitor-facing form/POST is not authorized by the current
   requirement. If that is what the owner meant, amend MKTG-02 first; do not hide an unauthenticated
   PII write inside the counter route.

## Phase Constraints and Binding Decisions

### MKTG-01 — honest channel state

- Every planned outbound channel is visible in exactly one of three states: `connected`,
  `connectable`, or `blocked-with-reason`.
- An unavailable provider has no numerical metric. `0` means a measured zero and is therefore
  false for an unconnected social provider.
- The reason is code-owned, not model-written. For tranche-B social channels it must name the legal
  entity and provider suitability/OAuth review.
- The Executive Agent proposes artifacts or ordinary approved actions. It never publishes.

### MKTG-02 — link-only public boundary

- Public plane: Convex `httpAction`, not a Next route. `apps/web/middleware.ts` stays byte-unchanged.
- One unguessable bearer token identifies an active, tenant-created link. The raw token is never
  stored or returned by a list query after creation.
- Three integer aggregate fields only: `visits`, `claims`, `downloads`. No append-only click/event
  rows and no channel-metrics table.
- `?s=` is a bounded code-owned attribution label, never an email, campaign prose, recipient id, or
  arbitrary URL.
- Success is a `302` to a URL produced by `ctx.storage.getUrl`. Invalid, inactive, source-mismatched,
  malformed, or missing-asset links all produce the same bare `404` and no count.

### MKTG-03 — one person store and unchanged suppression trust boundary

- No `leads` table. The only person row is `contacts`.
- The write goes through `packages/backend/convex/contacts.ts`'s exported `upsertContactRow`, never
  a second normalization/upsert implementation.
- New capture supplies `origin: "inbound"` plus `{ source: "inbound-form", wording, context }`.
  `upsertContactRow` supplies `consentAt`, stores exact wording, and fills consent only when absent.
- Existing provenance is not rewritten when a known contact later appears in a funnel. Existing
  stronger consent is not overwritten.
- The send guard remains `suppressions`-only at both convergence points. A captured contact whose
  address is suppressed remains unsendable.

## Repository Findings

1. `packages/backend/convex/gmailAuth.ts` already exposes the correct client-safe inputs for email
   state: `gmailStatus` returns booleans/timestamps without token or scope leakage, and
   `gmailConnectUrl` returns `{ configured, url }` with an honest unavailable state. Marketing
   should compose these rather than infer connection from UI or expose OAuth material.
2. `apps/web/app/(app)/layout.tsx` keys navigation activation on the presence of `href`. The phase
   should add Marketing as `soon: true` first and add `/dashboard/marketing` only after the
   authenticated browser gate. This is the Phase 19/26 rollout pattern.
3. Phase 19 is complete. `contacts`, `followUps`, and `suppressions` are the only CRM substrate;
   `upsertContactRow` is explicitly shared across user, approved-agent, and import actors.
4. `upsertContactRow` already supports the exact Phase 31 literals: `ContactOrigin` includes
   `inbound`; `ConsentSource` includes `inbound-form`; the helper stamps time, stores exact wording,
   does not downgrade existing consent, and does not rewrite original provenance.
5. Suppression is structurally separate from contacts. `executePlan` drops suppressed recipients
   before group joining, and `gmail.send` rechecks just before delivery. Phase 31 should not touch
   either guard to satisfy MKTG-03; it should add a regression case proving capture cannot bypass
   them.
6. `packages/backend/convex/http.ts` already holds the repository's public-route precedents. The
   unsubscribe route proves strict path parsing, one indistinguishable 404, explicit GET/POST
   semantics, HTML escaping, and `convex-test` router execution. The media asset route proves
   storage access inside `httpAction`.
7. `packages/backend/convex/lib/hash.ts` is the repository's one SHA-256 implementation. Use
   `contentHash(rawToken)` before any indexed lookup; do not add another digest helper.
8. `packages/backend/convex/vault.ts` already enforces tenant ownership before returning storage
   URLs. Funnel creation should accept a `vaultDocId`, re-check the row's tenant and downloadable
   `storageId`, then snapshot that storage id onto the funnel row. Never accept a browser-supplied
   storage id as sufficient authorization.
9. `packages/contracts/skills/content-drafter.md` is already explicit that it creates content and
   does not publish. `cockpit-agent.md` is explicit that tools stage writes and the agent cannot
   trigger Approve. Phase 31 can reuse these contracts without editing a gated skill body.
10. `packages/contracts/skills/lead-engine.md` reinforces the honest-state rule: channel advice is
    grounded, absent channel/cost evidence is named as missing, and the specialist is read-only.
    Marketing should not derive provider state from this model output; the page state remains code.
11. BRAND §5 says honest empty zeros are correct. The inverse is equally important here: a
    provider the system cannot observe must not render a zero. Use status copy, not a stat tile.
12. Convex HTTP actions can call internal queries/mutations and return Fetch `Response` objects,
    while mutations provide atomic reads/writes. `storage.getUrl` is available from a mutation
    context and returns `null` for missing bytes. This supports one internal atomic
    resolve-and-increment boundary instead of an action-level read followed by a separate write.

## Standard Stack

Use the repository's existing stack only:

| Concern | Required implementation |
|---|---|
| Channel catalog/state | Pure TypeScript total table in `@pikar/core`; Gmail booleans from existing `gmailAuth` queries |
| Authenticated surface | Existing Next 16 app shell, Convex React queries/mutations, hand-rolled BRAND-token CSS |
| Funnel persistence | One additive Convex `funnels` table; `v.number()` aggregate counters guarded as safe non-negative integers |
| Token generation | Web Crypto server-side randomness; SHA-256 through existing `contentHash` |
| Public routing | Existing `convex/http.ts` router and `httpAction`; GET only; strict path parser |
| File delivery | Existing Convex storage; ownership checked at authenticated creation; `ctx.storage.getUrl` at hit time |
| Lead write | Existing `upsertContactRow` in `contacts.ts`; no second validator, normalizer, consent writer, or table |
| Agent assistance | Existing `/dashboard/workspace`, `content-drafter`, `createDocument`, email plan gate, and Approvals surface |
| Unit/integration tests | Existing Vitest, `convex-test`, and React server-render/component patterns |
| Browser proof | Existing Playwright configuration and throwaway-tenant signup pattern from `pipeline-uat.spec.ts` |
| Operational ownership | New marketing playbook for new files; existing cockpit playbook updated for `http.ts`; dashboard playbook owns nav/e2e |

Do not add an analytics SDK, UUID/token dependency, component library, social SDK, OAuth package,
redirect service, event store, CAPTCHA, or new rate-limiter component.

## Architecture Patterns

### 1. A total channel catalog, not database-shaped provider rows

Tranche A has one real provider integration and five known blocked provider families. Do not add a
`channelConnections` table ahead of Phase 32. Represent the planned set as a total code-owned
catalog and compute state from existing facts:

```ts
type MarketingChannelId =
  | "gmail"
  | "meta-instagram"
  | "linkedin"
  | "tiktok"
  | "x"
  | "youtube";

type ChannelState =
  | { kind: "connected" }
  | { kind: "connectable"; href: "/connect-gmail" }
  | { kind: "blocked-with-reason"; reason: ChannelBlockReason };

type ChannelBlockReason =
  | "google-oauth-not-configured"
  | "legal-entity-required"
  | "phase-32-provider-review-required";
```

Use a `Record<MarketingChannelId, ...> satisfies ...` so a future channel literal cannot land
without label, state resolver, and blocked copy. For social providers, render both blockers in one
plain sentence: the legal entity is not formed and the provider suitability/OAuth review has not
started. Do not render a disabled Connect button; a disabled control suggests the product already
has a connection flow. Render explanation only.

Gmail has three honest outcomes:

- `connected` when `gmailStatus.connected`;
- `connectable` when disconnected and OAuth is configured;
- `blocked-with-reason: google-oauth-not-configured` when disconnected and configuration is absent.

The page should show channel state independently from funnel state, so a failed funnel query cannot
erase Gmail truth and a Gmail query failure cannot turn blocked social cards into loading forever.
Use one query per independent section, matching the Pipeline page pattern.

### 2. One link row, three counters, no event plane

Recommended v0 row:

```ts
type FunnelRow = {
  tenantId: string;
  title: string;
  tokenHash: string;          // SHA-256 hex; raw bearer returned once
  source: string;             // normalized code-owned label, 1..32 chars
  assetStorageId: Id<"_storage">;
  active: boolean;
  visits: number;
  claims: number;
  downloads: number;
  createdAt: number;
  updatedAt: number;
};
```

Indexes:

- `by_tokenHash_source` on `tokenHash, source` for the public lookup. The token is globally random,
  so the public boundary does not accept tenant id.
- `by_tenant_createdAt` for the bounded authenticated list.

Each row is one distributable source link. If the same asset is promoted in two places, create two
rows/tokens (`source=linkedin`, `source=newsletter`) instead of a nested arbitrary source map. This
keeps exactly three integer columns per row, makes attribution real, and keeps an attacker from
creating unbounded source keys on first click. The copied URL contains `?s=<stored source>`; a
different or absent source does not fall back to an unattributed bucket—it 404s without a count.

This is deliberately not a campaign model. There is no schedule, budget, creative variant,
recipient, event timestamp, unique visitor, conversion, or sale field. `title` and `source` are
tenant content in the ordinary content plane and never go into audit.

### 3. The public token boundary

Creation is authenticated:

1. Take `vaultDocId`, title, and source.
2. Validate source with one pure helper (recommended `^[a-z0-9][a-z0-9_-]{0,31}$`). It is a label,
   never PII or prose.
3. Read the Vault document and reject missing, foreign, processing, failed, or non-downloadable
   rows with one tenant-safe refusal.
4. Generate 32 random bytes server-side and base64url-encode them (43 characters, no padding).
5. Store `contentHash(rawToken)`, source, snapshotted storage id, counters at exact integer zero,
   and `active: true`.
6. Return the three complete URLs once. Later list queries return row id, title, source, active,
   counters, and timestamps—never token or URLs.

Rotation is create-new/deactivate-old, not token patching. Counters remain historical evidence and
are never reset. A delete endpoint is unnecessary in v0; deactivation is recoverable and preserves
the aggregate.

Public hit flow:

```text
GET /f/<raw-token>/<visit|claim|download>?s=<source>
  -> strict length/charset/path/source parse
  -> SHA-256(raw-token)
  -> internal mutation resolveAndIncrement(hash, source, stage)
       indexed unique row lookup
       require active
       require all counters safe non-negative integers
       storage.getUrl(assetStorageId); null => no patch, null result
       patch exactly one counter + updatedAt
       return storage URL
  -> null => bare 404 + Cache-Control: no-store
  -> URL => 302 Location:<storage URL> + Cache-Control: no-store
```

The redirect target is never caller-controlled. Do not accept `returnTo`, `url`, or a storage id in
the public request. Do not expose a route that resolves token metadata without incrementing; that
would add a second unauthenticated read surface for no requirement.

### 4. Integer counter semantics and concurrency

Convex `v.number()` is a float64, not an integer type. Every write boundary must require:

```ts
const validCounter = (n: number) => Number.isSafeInteger(n) && n >= 0;
```

The internal mutation reads the one indexed row, validates all three counters, increments one, and
patches once. Convex's serializable mutations/OCC prevent lost updates under ordinary concurrency.
Still test a parallel burst because one hot row can eventually hit write-conflict limits. At v0
volume a single row is the correct ponytail design; if measured traffic creates conflicts, the
upgrade is bounded counter sharding and read-time summation—not an event table.

Counts mean HTTP requests that reached the mutation. They do not mean people:

- refreshes and repeated clicks count again;
- mail/security scanners and bots may count;
- a successful mutation followed by a lost 302 response can be retried and count twice;
- `Cache-Control: no-store` prevents an intermediary from hiding later hits behind a cached 302,
  but cannot make a request human.

The UI must state this next to the counters. Do not call them unique visitors, leads, qualified
claims, or conversions. `claims` is only a hit on the claim-stage URL until a later, separately
authorized capture surface proves more.

### 5. Lead recording through Phase 19

Add one tenant-scoped `captureInboundLead` mutation to `contacts.ts`, implemented as a one-line
delegation to `upsertContactRow` after boundary validation:

```ts
await upsertContactRow(ctx, ctx.tenantId, {
  email,
  name,
  origin: "inbound",
  consent: {
    source: "inbound-form",
    wording,               // exact text, non-blank
    context,               // funnel/source ref; content plane
  },
});
```

This is a direct human action on an authenticated page, so it does not require the agent plan gate
(Phase 19 invariant 11: the actor determines gating). If the agent proposes the same CRM write, it
must continue through `stageCrmWrite` and Approve; do not give the agent direct access to
`captureInboundLead`.

The Marketing form should not manufacture consent. The user must enter or confirm the exact
wording shown at the external capture point. Blank wording is refused; the UI must not substitute a
default checkbox sentence. `context` may hold a bounded funnel/source reference and user-entered
capture context, but neither it nor the email goes into audit.

Important existing-row behavior is correct and must be tested:

- a known `user-entered` contact keeps that origin;
- an existing asserted consent record is not downgraded to `inbound-form`;
- a contact with no consent receives the new exact record;
- a suppressed address receives/updates the contact row but remains suppressed because the send
  guard reads only `suppressions`.

No HTTP action calls this mutation in Phase 31. A public signup form requires explicit abuse,
dedupe, exact-consent, deletion/export, and PII threat decisions and contradicts MKTG-02 as written.

### 6. Agent assistance is navigation plus existing governed tools

The Marketing page should provide one visible "Ask the Executive Agent" affordance that opens or
prefills `/dashboard/workspace` with the selected channel/funnel context. It must not call a model
directly from the page and must not add a Marketing-only tool.

Existing behavior already satisfies the safe split:

- lead-engine is read-only and returns grounded recommendations;
- content-drafter produces a standalone artifact and explicitly cannot publish;
- `createDocument` stores a post/document but sends nothing;
- email composition reaches `proposePlan`, then stops for the user's one Approve;
- no social provider executor exists, so social publishing is structurally impossible.

Avoid a `cockpit-agent` body edit in this phase. It is gated, versioned, and costs a live eval cycle;
the page can frame the user's prompt without changing capability. If implementation discovers that
a new tool is genuinely required, that becomes a separately planned gated-skill change with
fixture/evidence—not incidental UI work.

### 7. Honest surface states

Render three independent sections:

1. **Channels** — total catalog, with Gmail live status and social blockers.
2. **Tracked links** — bounded newest-first link rows. Empty means "No tracked links yet," not a
   chart of zeros. Partial/read failure is explicit and does not erase Channels.
3. **Captured leads** — a record form plus a count/link to Pipeline derived from Contacts. Do not
   duplicate the contact table on Marketing.

For a real funnel row, `0` is an honest measured zero and should render as `0`. For a blocked
channel, no metric is available and the metric area should not exist. This preserves both sides of
BRAND §5.

Do not add a content calendar in tranche A. ADR-015 says scheduled email already lives in Approvals
and social scheduling does not exist until tranche B.

## Threat Model

| Threat | Boundary and required control |
|---|---|
| Token guessing | 256-bit server-generated random token; store SHA-256 only; strict 43-char base64url parser; indexed hash lookup |
| Raw token leakage from authenticated reads | Return raw token/URLs only from create; list/read models omit them; never audit the token |
| Cross-tenant asset exposure | Authenticated create accepts `vaultDocId`, checks tenant ownership and downloadable state, then snapshots storage id; public route derives tenant solely from the bearer row |
| Open redirect / SSRF | Redirect only to the string returned by `ctx.storage.getUrl`; no request/row arbitrary URL field |
| Source tampering or PII attribution | Pre-register one bounded source on the row; require exact `?s=` match; reject arbitrary/unknown labels; prohibit emails/prose in source |
| Malformed-path oracle | Invalid token, stage, source, inactive row, foreign/missing asset all return identical bare 404 with no count |
| Counter inflation / replay | Define counters as raw requests; show caveat; allow deactivate/rotate. Do not claim uniqueness. Rate limiting cannot make a public bearer link trustworthy |
| Lost updates | One atomic internal mutation over one indexed row; parallel exact-count test; shard only after measured contention |
| Counter overflow/corruption | Validate all counters with `Number.isSafeInteger && >= 0`; refuse rather than wrap, clamp, or silently reset |
| Redirect caching hides hits | `Cache-Control: no-store` on both 302 and 404 |
| Missing/deleted stored bytes | Call `storage.getUrl` before patch inside the mutation; null means 404 and no counter increment |
| Revocation misconception | Deactivating the token stops future route resolution but cannot revoke a storage URL already revealed by a previous 302; UI/playbook must say delete/re-upload bytes to revoke that bearer URL |
| Public PII write smuggled into funnel | GET-only route; no email/body parsing; no call to Contacts from `http.ts`; authenticated lead record only |
| Consent fabrication | Exact non-blank wording required; no code-owned default; stored in content plane; consent readback remains `consentRecord` |
| Suppression bypass | No send implementation in funnels; capture writes Contacts only; existing two send-path suppression guards stay unchanged and are regression-tested |
| Channel readiness fabrication | Code-owned catalog and existing Gmail projection; no model-generated connection status; social blockers always name external gates |
| Premature Phase 32 authority | Structural scans assert no social credential table, provider SDK/client, publish mutation/action, channel metrics table, or new social action type |

## File-Level Seams

| File / area | Change and ownership |
|---|---|
| `packages/core/src/marketing.ts` | New pure channel catalog, source/stage parsers, safe-counter helpers, public result types |
| `packages/core/src/marketing.test.ts` | Total-catalog, state, parser, source, integer and non-PII-label tests |
| `packages/core/src/index.ts` | Export the pure contract; one shared-owner edit |
| `packages/backend/convex/schema.ts` | Add only `funnels`; one schema owner; no `funnelEvents`, provider credentials, channel metrics, or leads table |
| `packages/backend/convex/funnels.ts` | Authenticated create/deactivate/list and internal resolve+increment; ownership checks and token hashing boundary |
| `packages/backend/convex/funnels.test.ts` | Isolation, storage ownership, raw-token omission, exact counters, concurrency, missing asset, inactive/source mismatch |
| `packages/backend/convex/http.ts` | Add GET `pathPrefix: "/f/"`; strict parse, hash, internal mutation, bare 404 or exact 302. Existing cockpit playbook also owns this file |
| `packages/backend/convex/contacts.ts` | Add authenticated `captureInboundLead` delegating to `upsertContactRow`; do not create a second helper/writer |
| `packages/backend/convex/contacts.test.ts` | Extend export-set/isolation pins; exact consent, provenance-preservation, and suppression-survival cases |
| `apps/web/app/(app)/dashboard/marketing/page.tsx` | Thin route wrapper |
| `apps/web/app/(app)/dashboard/marketing/MarketingView.tsx` | Independent channel/link/lead sections, honest states, workspace CTA, no provider action |
| `apps/web/app/(app)/dashboard/marketing/marketingView.test.ts` | Server-render/component assertions; `.test.ts`, not `.test.tsx`, per current Vitest include |
| `apps/web/app/(app)/layout.tsx` | Add disabled Marketing nav first; add href only after browser evidence |
| `apps/web/e2e/marketing-uat.spec.ts` | Throwaway-tenant authenticated route plus unauthenticated tracked-link execution and responsive checks |
| `docs/playbooks/marketing.md` | New invariants, counter meaning, token rotation/revocation ceiling, operations and verification |
| `docs/playbooks/cockpit.md` | Bump/update the `http.ts` route inventory; do not let a green watcher hide this obligation |
| `docs/playbooks/dashboard-pages.md` | Register route/nav/e2e rollout and activation evidence |
| `docs/playbooks/watch.json` | Assign new paths to one playbook owner each; avoid duplicate ownership of existing shared paths |

No edit is needed to `apps/web/middleware.ts`, `packages/core/src/actionType.ts`, the plan schema,
`cockpit-agent`, `content-drafter`, `agentSteps.tool`, Approvals, Gmail send code, or provider adapters.

## Suggested Implementation Ordering

Use serial shared-boundary work, then UI, then activation. `schema.ts`, `http.ts`, `contacts.ts`, nav,
and playbook/watch files are shared-tree hotspots and should each have one owner at a time.

1. **31-01 — Freeze contracts and negative space.** Define the stage grammar, raw-request counter
   meaning, source-label rule, authenticated-only lead recording, total channel catalog, pure tests,
   new playbook, and structural absence tests. This is the required Wave 0 decision plan.
2. **31-02 — Add the aggregate substrate.** One `funnels` table, create/deactivate/list and
   resolve+increment internals, Vault ownership check, token hash-only persistence, two-tenant tests,
   safe-integer and parallel-burst tests. Run codegen because this is a new Convex module.
3. **31-03 — Expose the GET-only token route.** Add `/f/` to `http.ts`; router-level tests assert
   exact 302/404 headers, source/stage parsing, no count on refusal/missing bytes, one counter per
   stage, and no POST route. Update cockpit playbook in the same plan.
4. **31-04 — Reuse the person store.** Add `captureInboundLead` as a delegation to
   `upsertContactRow`; extend public-function export/isolation pins; prove exact consent round-trip,
   origin preservation, consent non-downgrade, and suppression survival. Do not touch send guards.
5. **31-05 — Build the Marketing route dark.** Add disabled nav item, channel cards, bounded link
   list/create/deactivate, authenticated lead-record form, raw-count caveat, independent
   loading/empty/error states, and workspace CTA. Component tests prove blocked channels have no
   fabricated `0` and real funnel zeros render as `0`.
6. **31-06 — Repository and threat gates.** Whole core/backend/web suites, typechecks, production
   build, playbook watcher, structural scans, mutation checks, and generated API parity. No paid
   model eval is expected because no gated skill body changes.
7. **31-07 — Connected browser/UAT and nav activation.** Run the real Convex deployment plus
   production Next build, create a throwaway tenant and Vault asset, exercise all three public
   stages without authentication, inspect desktop/mobile states and copy, verify captured contact
   in Pipeline and suppression refusal, record evidence, then and only then add the nav href.

The HTTP route should not land before the authenticated create/deactivate controls and playbook are
ready. The nav href should be the last code change, not the first.

## Don't Hand-Roll

- Do not build a social provider abstraction, credential table, OAuth flow, SDK client, publish
  executor, metrics event table, or content calendar in tranche A.
- Do not build a second CRM/lead table or copy contact normalization, validation, consent, or
  suppression logic into `funnels.ts`.
- Do not store raw funnel tokens, arbitrary redirect URLs, IP addresses, user agents, referrers,
  emails, or message text as click analytics.
- Do not use JWT for an opaque bearer token. A random value plus stored hash is smaller and has no
  claims to misinterpret.
- Do not use `crypto.randomUUID()` if implementing the specified 256-bit token; use Web Crypto bytes
  and a tiny base64url encoder. Do not add a dependency for three lines of standard-library work.
- Do not write a custom transaction/idempotency layer. Convex mutations own atomic counter updates.
- Do not add unique-visitor cookies, fingerprinting, pixels, or IP dedupe. They add privacy state and
  still do not prove a human.
- Do not add a generic analytics chart. Three integer values fit three stat tiles and honest copy.
- Do not widen Next middleware or rely on its dot-skipping matcher for public access.
- Do not edit a gated skill body merely to create a Marketing CTA.

## Common Pitfalls

1. **Showing social `0`s.** A zero reads as measured. The provider is blocked and unobserved.
2. **Calling raw hits people or leads.** Scanners, bots, refreshes and retries are included.
3. **Incrementing before resolving storage.** A deleted asset then produces phantom success counts.
4. **Reading then patching in separate HTTP calls.** The action is not a transaction; use one
   internal mutation.
5. **Using `take().first()` on token lookup.** A collision or duplicate becomes silent. Creation
   checks and public lookup should be unique/loud.
6. **Trusting `?s=` and creating buckets dynamically.** An attacker can create unbounded rows/keys
   and place PII in analytics. Source is registered authenticated-first and exact-matched.
7. **Returning a row-supplied URL.** That turns the route into an open redirect/SSRF primitive.
8. **Exposing token in list/audit/log payloads.** The URL is the authority. Hash-only persistence is
   the blast-radius reduction.
9. **Assuming deactivation revokes a revealed storage URL.** It does not; official Convex storage
   URLs are reusable bearer URLs.
10. **Adding a public lead POST because ADR-015 mentions leads.** MKTG-02 expressly refuses that
    boundary. Amend first.
11. **Writing `contacts` directly from a funnel module.** It bypasses Phase 19's one writer and
    creates provenance/consent drift.
12. **Updating `contacts.unsubscribedAt` as the guard.** It is a display mirror; the trust boundary
    is the separate `suppressions` table.
13. **Putting the agent behind a direct Publish/Send button.** Existing plan/Approve remains the only
    outbound authority.
14. **Activating nav before connected browser proof.** In this repo, adding `href` is activation.
15. **Adding a new backend module without codegen.** Generated API parity will otherwise create a
    misleading typecheck error.
16. **Trusting a green playbook watcher in a dirty shared tree.** Explicitly update the playbooks
    whose owned files changed.

## Code Examples

### Pure public-link parser

```ts
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const STAGES = ["visit", "claim", "download"] as const;

function parseFunnelPath(pathname: string, source: string | null) {
  const [, root, token, stage, extra] = pathname.split("/");
  if (root !== "f" || extra !== undefined) return null;
  if (!TOKEN_RE.test(token ?? "")) return null;
  if (!STAGES.includes(stage as (typeof STAGES)[number])) return null;
  if (!source || !SOURCE_RE.test(source)) return null;
  return { token: token!, stage: stage as (typeof STAGES)[number], source };
}
```

### Atomic resolve-and-increment

```ts
export const resolveAndIncrement = internalMutation({
  args: { tokenHash: v.string(), source: v.string(), stage: stageValidator },
  handler: async (ctx, args): Promise<string | null> => {
    const row = await ctx.db
      .query("funnels")
      .withIndex("by_tokenHash_source", (q) =>
        q.eq("tokenHash", args.tokenHash).eq("source", args.source),
      )
      .unique();
    if (!row || !row.active) return null;
    if (![row.visits, row.claims, row.downloads].every(validCounter)) return null;
    const url = await ctx.storage.getUrl(row.assetStorageId);
    if (!url) return null;
    const key = `${args.stage}s` as "visits" | "claims" | "downloads";
    if (row[key] === Number.MAX_SAFE_INTEGER) return null;
    await ctx.db.patch(row._id, { [key]: row[key] + 1, updatedAt: Date.now() });
    return url;
  },
});
```

### HTTP response boundary

```ts
const notFound = () =>
  new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// After strict parse + contentHash(raw token):
const location = await ctx.runMutation(internal.funnels.resolveAndIncrement, args);
if (!location) return notFound();
return new Response(null, {
  status: 302,
  headers: {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  },
});
```

## Validation Architecture

### Test layers

1. **Pure contract tests (`@pikar/core`)**
   - Channel catalog is total and exactly the six planned provider families.
   - Social channels always resolve to blocked reasons naming legal entity/provider review.
   - Gmail state truth table covers connected/configured/unconfigured.
   - Funnel stage, token, and source parsers accept only the closed grammar.
   - Source labels cannot carry `@`, whitespace, URL syntax, or more than 32 characters.
   - Counter validator refuses negative, fractional, NaN, Infinity, unsafe, and overflow values.

2. **Backend aggregate and isolation tests (`convex-test`)**
   - Tenant A cannot create from tenant B's Vault document, list/deactivate B's link, or observe B's
     counters.
   - Create returns a 43-character raw token once; database stores a 64-character digest and never
     the raw value.
   - List projection omits token hash, raw token, storage id, and generated storage URL.
   - Missing/foreign/non-downloadable Vault documents refuse before insert.
   - Each stage increments exactly one field and preserves the other two.
   - Inactive, source-mismatched, malformed, and missing-storage cases write nothing.
   - A parallel burst yields the exact total without lost updates at expected v0 load.
   - Deactivation is idempotent; old counters stay unchanged.

3. **Real-router HTTP tests (`convex-test` `t.fetch`)**
   - Valid GET for all three stages returns exactly 302, a Convex storage `Location`, `no-store`,
     and no response body.
   - Source is required and exact. Tampering returns the same bare 404 as malformed token/stage.
   - POST/PUT/PATCH/DELETE are not registered and never change counters.
   - Deleted storage returns 404 and leaves counters unchanged.
   - Row counts before/after prove refusal paths are inert; do not test only response status.
   - Route never reflects token/source into HTML or redirects to a caller-supplied URL.

4. **Contacts/consent integration tests**
   - `captureInboundLead` is in the public-function export/isolation pin.
   - It normalizes through the existing function, sets `origin=inbound`, stamps consent, and
     reproduces exact wording/source/context through `consentRecord`.
   - Blank consent wording is refused with no contact write.
   - Existing origin remains unchanged; existing asserted consent is not downgraded.
   - Capture of an already-suppressed address leaves one suppression row and both send-path guards
     still refuse delivery.
   - Audit contains no email, source prose, consent wording, token, or asset title.

5. **Web component tests**
   - Disconnected configured Gmail renders Connect; connected renders Connected; unconfigured
     renders a named reason.
   - Every social channel is present and names the legal entity; none has a Connect/Publish action.
   - No social blocked card renders `0`, `Unknown`, or an empty metric shell.
   - A real funnel row with three zero counters renders exactly three honest zeros plus the raw-hit
     caveat.
   - Loading/error in one section does not erase the others.
   - Agent CTA targets workspace; the page contains no direct send/publish handler.
   - Lead form never supplies default consent wording and surfaces server refusal inline.

6. **Structural negative-space tests**
   - `schema.ts` contains `funnels` and does not contain `funnelEvents`, `leads`, social credential,
     social post, or channel metrics tables.
   - `apps/web/middleware.ts` diff is empty.
   - No Phase 31 file imports a social provider SDK or adds an `ACTION_TYPES`/`agentSteps.tool`
     literal.
   - `http.ts` `/f/` handler never calls Contacts and registers GET only.
   - `funnels.ts` never inserts/patches `contacts` or `suppressions`.
   - New Convex feature files use approved tenant wrappers; internal functions are explicit and
     accept no caller-supplied tenant on the public HTTP path.

7. **Authenticated/live browser gate**
   - Sign up two throwaway tenants through the real form.
   - Upload/create a downloadable Vault asset as A; B cannot bind it to a funnel.
   - Create a link as A, open all three public URLs in an unauthenticated browser context, and
     observe exactly `1/1/1` on A only.
   - Deactivate and verify a later public request 404s without changing counts.
   - Record a captured lead and verify the Pipeline shows inbound provenance and consent while a
     pre-existing suppression remains effective.
   - Verify desktop and phone width, keyboard focus, blocker copy, and absence of social actions.
   - Confirm Marketing remains disabled in nav before evidence and becomes a real link only after
     the gate is recorded.

8. **Manual-only review**
   - Does "raw requests" read plainly enough that nobody mistakes it for unique people?
   - Do blocked social cards feel honest and useful rather than broken?
   - Is the legal-entity explanation precise without promising a Phase 32 date?
   - Does the captured-lead consent control make the user supply actual evidence rather than invite
     a fictional default?
   - Is the agent affordance clearly advisory and does no copy claim anything was published?

### Requirement-to-test map

| Requirement | Automated proof | Live/manual proof |
|---|---|---|
| MKTG-01 | Total catalog/state truth table; Gmail projection tests; blocked-card no-zero/no-action component assertions; structural absence of publish authority | Authenticated desktop/mobile route; blocker and agent-assistance copy; nav activation gate |
| MKTG-02 | Schema absence scan; token/hash/ownership tests; exact stage counters; concurrency; real-router 302/404/no-store; POST absence; middleware byte pin | Unauthenticated browser follows three links to real stored bytes; deactivate/404 check; counter caveat judged |
| MKTG-03 | `captureInboundLead` isolation/export pin; exact consent round-trip; no second table/writer; existing-origin/consent preservation; suppressed-address delivery regression | Record lead in real UI, observe Pipeline, verify suppressed address remains withheld |

### Mutation checks that make the suite non-vacuous

- Remove the social blocked reason from one catalog row: total-state test must fail.
- Replace one blocked card value with `0`: component test must fail.
- Store raw token instead of its hash: persistence-shape test must fail.
- Drop the source equality predicate: tampered-source router test must fail.
- Patch `visits` for every stage: claim/download exact-delta tests must fail.
- Move the patch before `storage.getUrl`: missing-storage no-count test must fail.
- Change 302 to 200/303/307: router test must fail.
- Add a POST route: method-absence test must fail.
- Implement capture with `ctx.db.insert("contacts")`: one-writer structural test must fail.
- Read `contacts.unsubscribedAt` instead of `suppressions`: existing Phase 19 send tests must fail.

### Fast and full commands

Expected command shapes, to be confirmed against the authored file names:

```text
pnpm --filter @pikar/core test marketing
pnpm --filter @pikar/backend test funnels
pnpm --filter @pikar/backend test contacts
pnpm --filter @pikar/web test marketingView
node scripts/check-playbooks.mjs
pnpm typecheck
pnpm test
pnpm --filter @pikar/web build
```

Run Playwright directly from `apps/web` against a live `convex dev` and production Next server, as
the Phase 19 UAT playbook requires. Do not use a command form that accidentally expands to the full
unrelated e2e suite. No paid model eval is part of the base plan because no gated skill changes.

### Wave 0 validation gaps the planner must close

- Freeze the three stage meanings and exact public URL grammar before schema implementation.
- Confirm the recommended one-row-per-source-link interpretation of `?s=`. A single row plus an
  arbitrary source map violates the "three integer columns only" constraint; a source query that is
  parsed but not persisted is not attribution.
- Confirm authenticated manual lead recording is the intended MKTG-03 v0. A visitor form is a
  requirement change and needs a new public-PII abuse/privacy design.
- Decide the maximum tracked links per tenant and page bound. Recommended first ceiling: 100 active
  links, 25 rows/page, newest-first. The exact numbers are not specified in roadmap documents.
- Confirm which downloadable Vault states are eligible. Recommended: only tenant-owned rows with a
  present storage id and terminal ready/succeeded state; no processing or failed asset.
- Add a deterministic fixture path for real storage redirects so the browser gate is rerunnable
  without model cost.

## Open Questions

1. **Stage semantics (blocking for Plan 31-01):** Where are the visit, claim, and download URLs
   placed, and what user act distinguishes claim from download? The research recommendation is a
   closed path segment and raw-request semantics; calling a `claim` a lead is not justified.
2. **Source attribution (blocking for Plan 31-01):** The documents require both exactly three
   integer columns and `?s=` attribution. The recommended compatible model is one row/token per
   source link. If the owner expects one token compared across arbitrary sources, the schema needs
   a bounded source aggregate representation and the "three columns only" wording must be clarified.
3. **Lead capture (blocking for Plan 31-04 product copy, not for funnel counters):** Does
   "captured" mean an authenticated user recording an externally captured signup, or a public Pikar
   visitor form? Only the former is permitted by MKTG-02 today.
4. **Asset revocation:** Is deactivating the tracked link sufficient, knowing a previously revealed
   Convex storage URL remains reusable, or must the Marketing UI also offer delete/re-upload? The
   latter expands into Vault lifecycle and should not be inferred.

## Sources

### Primary repository sources — HIGH confidence

- `.planning/ROADMAP.md` — Phase 31 goal, five success criteria, Phase 32 gate and sequencing gap.
- `.planning/REQUIREMENTS.md` — MKTG-01, MKTG-02, MKTG-03 exact wording.
- `.planning/STATE.md` — Phase 19 final closure and shared-tree/test discipline.
- `CLAUDE.md` — thin adapters, tenant wrappers, refs/counts-only payloads, ponytail discipline,
  playbook ownership and UI/BRAND obligations.
- `docs/decisions/015-marketing-milestone-pulled-pre-beta.md` — binding tranche split, legal-entity
  gate, public-read decision, plan-gated outbound authority and event-plane limits.
- `.planning/design/growth-surfaces-canvas-funnels-connections.md` — public-plane analysis,
  link-only funnel shape, rejected event/public-write scope, SEND-path suppression and legal risks.
- `docs/design/BRAND.md` — honest zeros, component patterns and accessibility.
- `docs/playbooks/contacts-crm.md` — the one person store, exact consent, single writer, suppression
  split, actor-based gating, public-route testing and operational caveats.
- `packages/backend/convex/schema.ts`, `contacts.ts`, `http.ts`, `gmailAuth.ts`, `gmail.ts`,
  `cockpit.ts`, `vault.ts`, `lib/hash.ts` — current implementation seams.
- `packages/core/src/contacts.ts` — one address normalization/validation and CRM operation contract.
- `packages/contracts/skills/lead-engine.md`, `content-drafter.md`, `cockpit-agent.md`,
  `growth-os-diagnostic.md`; `Skills/lead-engine/SKILL.md`; `Skills/growth-os/SKILL.md` — grounded
  channel advice, read-only specialist posture, artifact-not-publish and Approve boundaries.
- `.planning/phases/19-contacts-crm-follow-ups/19-RESEARCH.md`, `19-VALIDATION.md`,
  `19-VERIFICATION.md` — existing convergence map and non-vacuous test lessons.

### Official platform sources — HIGH confidence, verified 2026-08-10

- Convex HTTP Actions: <https://docs.convex.dev/functions/http-actions> — router/pathPrefix,
  Fetch responses, internal function calls, public `.convex.site` exposure, and action retry limits.
- Convex Serving Files: <https://docs.convex.dev/file-storage/serve-files> — `storage.getUrl`, bearer
  URL security, direct HTTP serving tradeoffs and revocation by delete/re-upload.
- Convex StorageReader API: <https://docs.convex.dev/api/interfaces/server.StorageReader> —
  `getUrl(Id<"_storage">): Promise<string | null>` and availability on query/mutation/action contexts.
- Convex Mutations: <https://docs.convex.dev/functions/mutation-functions> — transactional reads and
  writes, all-or-none commit and deterministic boundary.
- Convex OCC and Atomicity: <https://docs.convex.dev/database/advanced/occ> — serializable atomic
  updates and automatic conflict retry.
- Convex write-conflict guidance: <https://docs.convex.dev/error> — hot-row counter conflict risk
  and the need to read only the indexed row actually updated.

## Metadata

**Research mode:** implementation/ecosystem  
**Scope:** Phase 31 only; Phase 32 social connection/publishing/metrics remains blocked  
**Negative-space confidence:** High — every excluded provider/event/public-write capability is
explicitly refused or deferred by ADR-015 and the growth-surface design  
**Planning gate:** Resolve the three Wave 0 semantic questions before authoring implementation plans

