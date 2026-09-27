# Playbook: Tenant commerce (Phase 50)

> Last verified: 2026-09-28 against the provider-independent inventory rule that a payment after an explicitly released hold returns a distinct `released_paid_exception` without consuming stock, including stale-revision, foreign-product and malformed-reservation refusals. This is a pure local outcome, not a signed payment landing, durable merchant-review workflow, refund or buyer notice. The 2026-09-27 policy/clock/link checks below and pending merchant decision remain unchanged.
> Build history: `.planning/phases/50-tenant-merchant-commerce/` · Related ADRs: ADR-049 pending owner decision

## Purpose

Tenant commerce will let a business sell its own catalogue through its published site. This is separate from Pikar's subscription billing and the tenant's read-only finance connectors. Plan 50-01 establishes a pure contract and a source boundary; no checkout, merchant account, card collection, public selling or live charge exists yet.

## Key files

- `packages/contracts/src/tenantCommerce.ts` — closed identities and refusal/result shapes.
- `packages/core/src/tenantCommerce.ts` and `.test.ts` — checked integer-minor arithmetic and server-owned quote inputs.
- `scripts/check-tenant-commerce-boundary.mjs` — exact source inventory and positive-control separation checks.
- `docs/releases/phase-50-merchant-decision.md` and `scripts/check-phase50-merchant-decision.mjs` — pending Stripe/PayPal direct-account decision packet and fail-closed adapter entry gate; synthetic self-test is not real approval.
- `docs/playbooks/watch.json` — commerce ownership, including intentional overlap with public-web and tenant-data playbooks on shared files.

Plan 50-02 adds `packages/core/src/tenantInventory.ts` and `packages/backend/convex/tenantCatalogue.ts`, plus `tenantProducts`, `tenantStock` and `tenantReservations` in the schema. Later plans add `tenantOrder`, `tenantPayment`, thin Convex order/provider adapters, distinct commerce HTTP routes, a versioned storefront-readiness check and buyer/admin UI. The plan files are the change order; these paths are watched before their first edit.

Plan 50-03 mounts `TenantCatalogue` under the authenticated sites page. The UI invokes only
`tenantCatalogue` query/mutation references, displays finite availability or explicitly approved
untracked posture, and pins product/stock revisions on edits. A stale view names refresh/retry;
creation and stock controls keep their values on refusal. Its responsive card layout and labelled
keyboard controls have local DOM checks; painted desktop/mobile browser acceptance remains for
the later integrated gate. A catalogue status of `active` is private and never implies checkout.
For finite stock, the list projects the stored reservation TTL (or null when unconfigured), so the
editor shows the current minutes rather than a default as if it were saved. Merchants may edit an
active finite product's current 1–60-minute policy through stock-revision CAS; invalid
minute input never calls the mutation and a stale refusal preserves the entered value. Existing
holds retain their recorded expiry. This is the owner-selected first-test-mode range, not
permission to open checkout or a provider capability claim. Legacy wider finite policies must
be reconfigured before checkout.

Plan 50-04 adds `tenantOrder.ts` and `tenantOrders.ts`. Authenticated tenant operators supply a
versioned local policy with explicit seller, tax, shipping and refund source refs, exact country
list, currency, tax basis points and half-up rounding. They map a private storefront presentation
item to their own live product. Cart lines carry product ids, quantities and observed price/revision,
never an authoritative total. The server re-reads mapped product, stock and policy in one mutation,
computes an exact minor-unit quote and immutable hash, then persists order, attempt and stock holds
atomically. An identical retry returns the same attempt; a different retry key on the same cart
revision refuses rather than creating a second hold. A cart edit requires a new retry key.
New quotes hash a canonical, recursively key-sorted representation: equal merchant policy values
produce the same digest regardless of object property insertion order, while cart line order stays
significant. Before cancellation or expiry releases a hold, the close path checks that digest
against both stored hashes. It also reconstructs the original insertion-order quote for already
pending local orders, so the change does not strand their reservations. Reading an object from
Convex may reorder its keys, so hashing a spread of the fetched object is not a valid legacy
check. A changed persisted quote total refuses with no order, attempt, hold or stock write; this
local integrity check does not verify a provider payment or permit public checkout.
Required seller, tax, shipping, return, refund, retention, delivery and revocation references must
contain a non-whitespace character at both authenticated policy write and pure quote. The validator
does not trim or silently rewrite a merchant's accepted reference; legacy blank-looking rows refuse
before any new order/hold write.
Checkout demand releases expired holds on its products in the same transaction before quoting,
up to five expired reservations. A larger backlog refuses checkout and the tenant-scoped
`reconcileExpiredProduct` mutation drains it in bounded pages. An order expiry releases every
linked hold once and marks the local attempt expired; cancellation marks it refused.
The drain refuses a due held reservation linked to a terminal or not-yet-due order; it must not
count an unchanged hold as processed and leave finite stock stranded on every retry.
Before either close path releases stock, it requires one still-local-pending payment attempt whose
snapshot hash, cart identity and cart revision match the order, and every held reservation's product,
quantity, attempt link and expiry
to match the immutable order and its deadline. A corrupt cross-order link or mismatched
deadline refuses the entire transaction rather than releasing stock early. This does not reconcile
a provider payment fact; the future provider lifecycle must keep order and attempt state monotonic.
Order creation also durably schedules `expireDue` at the exact hold expiry. Its internal mutation
checks the persisted tenant/order pair and no-ops after cancellation or prior expiry, so idle
catalogues regain finite availability without a new checkout request. The on-demand path repairs
delayed timer execution and legacy standalone holds.
The cart's 30-minute lifetime is only the deadline to **place** an order. Once placed, its stock
hold starts at that transaction's time and uses the merchant's configured 1–60-minute finite
duration (the earliest held line for a mixed cart); an almost-expired cart cannot shorten that
promise. Legacy active finite rows with a wider saved duration refuse before order/attempt/hold
writes and can be reconfigured through stock-revision CAS.
There is no selected merchant adapter and attempts remain `local_pending`. These local policy refs
record tenant declarations, not verified seller, provider, tax or legal eligibility.

Plan 50-18 requires a merchant-declared `physical` or `digital` kind on every new product;
legacy unclassified rows remain readable but cannot quote until an authenticated, revisioned
product edit classifies them. A versioned shop policy carries separate physical shipping,
returns, tax, refund and buyer-retention refs, and digital delivery, revocation, explicit
no-shipping, tax, refund and buyer-retention refs. Each cart requires the branch for every
goods kind it contains. Tax is calculated per kind with half-up integer rounding; physical
shipping is added once only for a physical cart line. The immutable order snapshot pins the
used branch facts and per-line kind/refs. Missing or legacy policy facts refuse before an
order, attempt or hold is created. These are merchant declarations, not legal/provider
eligibility. Plan 50-19 classifies those exact rows and nested fields for tenant export and
deletion. The export projects a closed merchant-safe view: kind, revisions, quoted minor units,
policy branch refs and snapshot provenance survive; attempt `retryKeyHash` is omitted. An unknown
top-level or nested policy/snapshot/line field refuses export, rather than falling through to a
raw document dump. Legacy products and policy/order rows carry explicit missing-classification
markers in export; they gain no new permission to quote. Buyer values, policy prose and provider
credentials must never be added to refs-only audit or export metadata.

Unused buyer-free products and policy revisions are erasable with the ordinary bounded tenant
walk. Orders and attempt history refuse erasure before any row or provider side effect because
financial, fulfilment, refund and buyer-retention authority remains undecided. A linked
reservation likewise refuses, including a direct page/cursor replay. The order-linked check uses
`by_tenant_order`; attempt-only links have no matching index, so each preflight inspects at most
256 tenant reservations and refuses with `RESERVATION_SCAN_CAP` above that bound. This is an
operational review refusal, not a legal retention duration. No accepted jurisdictional rule,
Stripe/PayPal merchant credential or public checkout follows from this local data contract.

Plan 50-05 adds a bounded, same-origin JSON POST preflight at
`/p/:slug/:page/commerce/cart`. Its body accepts only 1–50 distinct presentation item ids,
integer quantities 1–100 and a two-letter address country; the entire body is streamed under
8 KiB and an opaque idempotency token is bounded to 128 ASCII word/dash characters. Caller
tenant, account, product, cart, total, card and payment fields are rejected. The handler asks
the existing exact host/page runtime resolver, but storefront resolution remains code-owned
dark and every well-formed request returns 404 before `tenantOrders` or any cart, attempt, order
or hold write. This is a refusal/preflight seam, not anonymous cart creation or checkout.
The existing test runner fixes its HTTP origin at `some.convex.site`; its A/B host proof runs
the real internal published-site resolver directly, while direct HTTP proves storefront
refusal. No test seeds an unreachable storefront published pointer as positive evidence.

## Dependencies & blast radius

The Phase 48/49 published site is a presentation shell, not an authoritative price or stock ledger. A commerce source change may also hit the `public-web-runtime.md`, `billing.md`, `revenue-finance.md`, `authorization.md`, or tenant-data watchers; update every overlapping playbook in the same phase. Provider, account topology, jurisdiction, tax, shipping, refund, retention and fulfilment policy are not inferred from the site copy. ADR-049 must record owner decisions before a selected test-mode adapter.

## Data flow

1. A tenant-scoped catalogue record and approved policy provide product, SKU, currency, price, inventory and policy-version facts to a pure quote reducer.
2. The reducer validates bounded quantities and checked integer-minor totals. Client totals and authored display text are ignored as payment authority.
3. Later thin Convex adapters pin tenant, product, quote and policy versions into an order and preserve idempotent payment/fulfilment transitions. Public requests derive tenant from the verified host, never a client-supplied tenant id.
4. A separately selected merchant adapter may initiate provider-hosted checkout only after owner policy and code-owned readiness. A signed provider fact, not a return URL, establishes payment state. Audit carries refs, hashes and counts only.

## Invariants — what must never break

- Never import Pikar's `packages/billing` or reuse its credentials, tables, ledger, routes or subscription events for tenant sales. The source guard and its mutation self-test enforce the named boundary.
- Never use the read-only finance connector credentials as merchant payment authority. The guard enforces imports/secrets; future route and integration tests must preserve this.
- Never collect card fields or put private buyer data in audit/event shapes. The guard scans forbidden card-entry fields; event-shape tests are required in later plans.
- Unknown provider, merchant account or policy means `configuration_required`, not a guessed default. Core tests cover this contract.
- Plans 50-07/08 must run the real decision checker before adapter work. It requires both provider identities and an exact accepted ADR-049 hash; separately evidenced delegated sandbox/account capabilities and a versioned provider/account/country/payment-method/quote/settlement matrix. Missing, unsupported or unverified combinations refuse; global seller reach is an owner target, not a provider capability claim.
- Evidence `checkedAt` dates and the capability-matrix date must be real calendar dates no later than the checker run date. This prevents impossible or future dates from satisfying a decision record; it does not establish that a dated assertion is true or sufficiently fresh. Provider/account evidence still needs independent review at adapter entry.
- PayPal's partner Standard Checkout example still uses supported browser SDK v5, while its current new-integration guidance directs v6. The pending decision checker now requires an explicit v5/v6 generation and evidence that the chosen browser flow binds the exact merchant-owned seller account; v5 also requires a documented exception. Server-side partner Orders permissions and exact-account fetch/refund remain separate. Do not infer v6 multiparty compatibility from a v5 sample.
- No finite-stock oversell, cross-tenant lookup or duplicate payment side effect. Later inventory/adapter plans must add atomic and two-tenant tests before exposure.
- Pending-order cancel and expiry first verify the complete held-reservation set against the immutable order snapshot: one distinct reservation per line, with the exact product and quantity. A count-only match is insufficient; a mismatched link refuses before any stock, reservation, order or attempt transition. Backend tests pin wrong-product cancellation and wrong-quantity expiry with byte-equivalent rows after refusal.
- Catalogue isolation is behaviorally checked through production adapters: A/B list reads return
  only each tenant's rows, foreign product/stock/reservation writes refuse, owner scope does not
  bypass tenant scope, anonymous calls refuse, and failed foreign attempts append no audit event.
- Active finite stock requires a configured 1–60-minute whole-minute reservation TTL. Untracked stock requires explicit approval; it is never the fallback for a missing finite policy. Available finite units are `onHand - reserved`; every stock transition checks the exact revision in one Convex mutation. Release/expiry can occur once, and a late paid fact becomes an exception rather than silently rewinding or overselling stock.
- The pure `consumeInventory` contract distinguishes an expired hold (`late_paid_exception`) from an explicitly released hold (`released_paid_exception`, including a cancellation before expiry); neither changes stock. A later signed provider landing must journal and reconcile those causes separately. No provider event, refund, fulfilment alternative or buyer notice is implemented by this core rule.
- A standalone authenticated `reserveProduct` hold journals an exact due-time callback in its creation transaction; the callback checks tenant/product/hold identity, due time and held state before one stock/hold/audit transition. An early, foreign or replayed callback is inert. Catalogue release/expiry mutations refuse order- or attempt-linked holds; those remain owned by the order close path. Checkout's bounded expired-hold drain remains a recovery route if a due callback is delayed. This is local stock hygiene, not recurrence enablement, payment reconciliation or public checkout.
- The expired-hold drain also refuses an orderless reservation that still has a payment-attempt link; loss of the `orderId` alone must not make pending checkout stock look like a standalone hold. A red-then-green backend control pins unchanged order, attempt, hold and stock rows on this malformed link.
- The owner chose a merchant-set 1–60-minute finite hold for the first test-mode shop. If payment succeeds after hold expiry and stock is unavailable, stop for merchant review; do not automatically fulfil or refund. A merchant admin chooses refund or a documented fulfilment alternative and the buyer gets a status notice. The decision checker requires those exact choices with owner evidence. Actual review, refund, alternative-fulfilment and notice operations, plus other late-paid paths, remain open and require separate verification.
- A draft may be created before its policy is ready, then explicitly set its finite TTL or approve its untracked posture using `configureStockPolicy` with stock-revision CAS. Changing finite ↔ untracked kind is refused; an active item cannot lose its approved policy silently.
- Every stock-writing transition uses one checked next-revision rule. At `Number.MAX_SAFE_INTEGER`, adjustment, policy configuration, reservation, release, expiry and consumption refuse rather than writing an unsafe CAS revision; a late-paid exception does not advance the stock revision.
- Buyer-free product, stock and reservation rows are `tenant_owned` in `tenantData.ts`. Plan 50-19 applies a closed field projection to export and a bounded deletion disposition; unused rows erase, linked holds refuse. This classification does not decide financial-record retention.
- Plan 50-04 policy, mapping, cart, order and attempt rows are tenant-owned content-plane data. Plan 50-19 exports only declared merchant-safe fields, omits retry-key hashes, and refuses unknown nested fields. Order snapshots may include address country and later buyer content; audit carries only order/attempt ids and snapshot hash. `authorizeTenantDeletion` and direct deletion pages refuse before any erasure when an order or attempt exists, pending a recorded accounting-retention decision.
- A private mapping never changes Phase 49 publication. `tenantOrders` has authenticated tenant entry only; the host-derived anonymous entry, provider selection, signed payment facts, real refund/fulfilment and public readiness belong to later plans.
- The Plan 50-05 HTTP route is read-only preflight, even though it receives POST: it never calls
  `tenantOrders` and never persists an idempotency key or buyer content. Two-provider merchant-owned
  direct-account qualification, typed buyer-flow readiness and exact publication binding must
  precede Plan 16's first positive anonymous cart/order write. A code-owned gate—not a seeded DB
  pointer, request flag or host header—must authorize that transition.
- Public storefront and production merchant traffic remain dark until their separate code-owned and Wave 7/8 gates pass. No Plan 50-01 test is release evidence.

## How to change safely

Follow Plans 50-01 through 50-17 in order. Extend the guard's exact declared inventory when a later plan creates a source; do not silently skip a new merchant path. Update this playbook and every overlapping watcher with the source edit. Keep core pure TypeScript, Convex thin, and provider-specific code behind the owner decision. Preserve immutable published bytes and rollback semantics when adding a dynamic commerce projection.

## How to verify

- `pnpm --filter @pikar/core test -- src/tenantCommerce.test.ts` and `pnpm --filter @pikar/core typecheck` — contract behavior and types.
- `node scripts/check-tenant-commerce-boundary.mjs --self-test` then `node scripts/check-tenant-commerce-boundary.mjs` — forbidden-boundary positive controls and scoped clean scan.
- `node scripts/check-phase50-merchant-decision.mjs --self-test` then `node scripts/check-phase50-merchant-decision.mjs` — synthetic positive/negative controls should pass; the real pending gate must exit nonzero until an evidenced accepted ADR exists.
- `node scripts/check-playbooks.mjs check --exit-code` — watched ownership on current changes.
- `graphify update .` then `node scripts/extract-convex-edges.mjs` after source edits — refresh graph edges; these are not runtime qualification.
- `pnpm --filter @pikar/core test -- src/tenantInventory.test.ts src/tenantData.test.ts` and `pnpm --filter @pikar/backend test -- convex/tenantCatalogue.test.ts convex/tenantExport.test.ts convex/tenantDelete.test.ts` — Plan 50-02 finite-stock, tenant-boundary and data-lifecycle checks.
- `pnpm --filter @pikar/backend test -- convex/isolation.test.ts convex/tenantCatalogue.test.ts`
  and `pnpm --filter @pikar/web test -- tenantCatalogue` plus web typecheck — Plan 50-03
  actual-adapter isolation, labelled controls, finite/untracked truth, edit/pause, stale retry,
  pagination and authenticated mount.
- `pnpm --filter @pikar/core test -- src/tenantOrder.test.ts src/tenantInventory.test.ts` and
  `pnpm --filter @pikar/backend test -- convex/tenantOrders.test.ts convex/tenantExport.test.ts convex/tenantDelete.test.ts` — Plan 50-04 quote, one stock decision, retry, two-tenant isolation and retention gate.
- `pnpm --filter @pikar/core test src/tenantInventory.test.ts src/tenantOrder.test.ts src/tenantData.test.ts` and `pnpm --filter @pikar/backend test convex/tenantCatalogue.test.ts convex/tenantOrders.test.ts convex/tenantExport.test.ts convex/tenantDelete.test.ts` — Plan 50-19 field-map, merchant projection, named erasure refusal and Plan 18 regression gate.
- `pnpm --filter @pikar/backend test -- convex/tenantCommerceHttp.test.ts convex/isolation.test.ts convex/webRuntimeHttp.test.ts` — Plan 50-05 malformed/unsafe-origin refusal, A/B host resolver, foreign cart and unchanged public-runtime darkness.
- Later plans require exact Convex, browser, provider test-mode and aggregate checks. Live and founder evidence remain separate.

## Operational notes

No commerce provider key, account, webhook endpoint or live merchant route is configured by this plan. Do not read, copy or modify the app's `.env` key for commerce. Provider-hosted checkout narrows the intended card surface but does not assert PCI eligibility.

## Known gaps & deferred work

ADR-049 policy facts and Plans 50-06 through 50-17 remain open. The owner chose both Stripe and PayPal in the first test-mode release, merchant-owned direct accounts, all seller countries as a long-term target and USD/EUR/GBP as target settlement currencies. The first release may enable only provider-verified eligible seller/account/currency combinations and must visibly refuse the rest. This does not establish provider coverage, delegated flow eligibility or tax/shipping/refund authority; public selling remains dark. Wave 7 legal/provider facts and Wave 8 exact-production founder acceptance remain open. The catalogue is authenticated-tenant-only and locally tested, not a public merchant runtime. Painted desktop/mobile browser and founder usability evidence are still open.
