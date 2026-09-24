# Playbook: Tenant commerce (Phase 50)

> Last verified: 2026-09-24 against Plan 50-01 contract and guard only
> Build history: `.planning/phases/50-tenant-merchant-commerce/` · Related ADRs: ADR-049 pending owner decision

## Purpose

Tenant commerce will let a business sell its own catalogue through its published site. This is separate from Pikar's subscription billing and the tenant's read-only finance connectors. Plan 50-01 establishes a pure contract and a source boundary; no checkout, merchant account, card collection, public selling or live charge exists yet.

## Key files

- `packages/contracts/src/tenantCommerce.ts` — closed identities and refusal/result shapes.
- `packages/core/src/tenantCommerce.ts` and `.test.ts` — checked integer-minor arithmetic and server-owned quote inputs.
- `scripts/check-tenant-commerce-boundary.mjs` — exact source inventory and positive-control separation checks.
- `docs/playbooks/watch.json` — commerce ownership, including intentional overlap with public-web and tenant-data playbooks on shared files.

Later plans add `tenantInventory`, `tenantOrder`, `tenantPayment`, thin Convex `tenantCatalogue`, `tenantOrders`, `tenantMerchant`, `tenantPayments`, distinct commerce HTTP routes, a versioned storefront-readiness check and buyer/admin UI. The plan files are the change order; these paths are watched before their first edit.

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
- No finite-stock oversell, cross-tenant lookup or duplicate payment side effect. Later inventory/adapter plans must add atomic and two-tenant tests before exposure.
- Public storefront and production merchant traffic remain dark until their separate code-owned and Wave 7/8 gates pass. No Plan 50-01 test is release evidence.

## How to change safely

Follow Plans 50-01 through 50-15 in order. Extend the guard's exact declared inventory when a later plan creates a source; do not silently skip a new merchant path. Update this playbook and every overlapping watcher with the source edit. Keep core pure TypeScript, Convex thin, and provider-specific code behind the owner decision. Preserve immutable published bytes and rollback semantics when adding a dynamic commerce projection.

## How to verify

- `pnpm --filter @pikar/core test -- src/tenantCommerce.test.ts` and `pnpm --filter @pikar/core typecheck` — contract behavior and types.
- `node scripts/check-tenant-commerce-boundary.mjs --self-test` then `node scripts/check-tenant-commerce-boundary.mjs` — forbidden-boundary positive controls and scoped clean scan.
- `node scripts/check-playbooks.mjs check --exit-code` — watched ownership on current changes.
- `graphify update .` then `node scripts/extract-convex-edges.mjs` after source edits — refresh graph edges; these are not runtime qualification.
- Later plans require exact Convex, browser, provider test-mode and aggregate checks. Live and founder evidence remain separate.

## Operational notes

No commerce provider key, account, webhook endpoint or live merchant route is configured by this plan. Do not read, copy or modify the app's `.env` key for commerce. Provider-hosted checkout narrows the intended card surface but does not assert PCI eligibility.

## Known gaps & deferred work

ADR-049 owner choices and Plans 50-02 through 50-15 remain open. Wave 7 legal/provider facts and Wave 8 exact-production founder acceptance remain open. A single provider-independent reducer is the current ceiling; add only the one selected adapter after the recorded decision.
