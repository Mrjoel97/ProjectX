---
phase: 50-tenant-merchant-commerce
plan: 05
subsystem: closed-public-commerce-preflight
tags: [commerce, http, host-binding, isolation, fail-closed]
requires:
  - phase: 50-tenant-merchant-commerce
    provides: Plan 04 private tenant cart/order adapter and Phase 49 storefront-dark guards
provides:
  - bounded read-only anonymous cart-intent POST seam under the existing public host/page resolver
  - zero-write direct HTTP and cross-tenant refusal proof while storefront publication remains closed
affects: [50-06, 50-07, 50-08, 50-09, 50-16, 50-17]
tech-stack:
  added: []
  patterns: [exact-field streamed JSON preflight, same-origin refusal, unchanged code-owned storefront darkness]
key-files:
  created:
    - packages/backend/convex/tenantCommerceHttp.test.ts
    - .planning/phases/50-tenant-merchant-commerce/50-05-PREEDIT-BASELINE-2026-09-24.md
  modified:
    - packages/backend/convex/http.ts
    - packages/backend/convex/isolation.test.ts
    - docs/playbooks/tenant-commerce.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/public-web-runtime.md
    - docs/playbooks/authorization.md
key-decisions:
  - "The anonymous POST seam is a closed read-only preflight: it must not call tenantOrders or persist cart, attempt, order or reservation state while Phase 49 storefront publication is code-owned dark."
  - "Ordinary published sites prove A/B host resolver behavior; they are not evidence of positive storefront host binding or a merchant checkout."
patterns-established:
  - "Later buyer-flow activation must place the first positive anonymous write behind the same code-owned joint Stripe/PayPal readiness and exact host/publication gate, never a seeded pointer or request flag."
requirements-touched: [SHOP-03, SHOP-05]
requirements-completed: []
duration: approximately 35 minutes
completed: 2026-09-24
---

# Phase 50 Plan 05: Closed host-derived cart preflight

An anonymous `/p/:slug/:page/commerce/cart` POST now validates a small, same-origin cart intent and asks the existing host/page resolver, then refuses before any commerce write. It cannot start payment or make a storefront sellable.

## Performance

- Duration: approximately 35 minutes on 2026-09-24
- Tasks: 2/2 under the revised closed-preflight plan
- Plan-owned source/test/playbook paths: 7; baseline and summary artifacts: 2

## Scope and implementation

The HTTP path accepts only an 8 KiB maximum streamed JSON body with 1–50 unique presentation item IDs, quantities 1–100 and a two-letter address country. An `Idempotency-Key` is syntactically bounded to 128 ASCII word/dash characters. Same-origin `Origin` and JSON media type are required; caller tenant, account, cart, product, order, client amount and card fields are rejected. The key is **not persisted** and no attempt lifetime begins, because no order/attempt is created. The preflight is read-only despite POST; it never calls `tenantOrders`.

The current Phase 49 resolver returns `invalid_host` for storefronts before tenant/project/version information and the normal publication path refuses storefronts. The HTTP preflight collapses those states to the existing 404 public refusal. A normal site/landing page also cannot use this commerce path. No seeded unreachable storefront publication pointer or private host resolver was introduced. Plan 16 must add the first positive storefront host binding and anonymous write only after both merchant-owned direct-account provider paths and the conjunctive buyer-flow/publication gate qualify.

## Evidence

| Check | Result |
| --- | --- |
| TDD red then green | Initial 3-case HTTP test failed on unsafe-origin expected 403 vs absent-route 404; after implementation, focused 4/4 pass including additional adversarial assertions |
| Backend HTTP, order, public runtime and isolation tests | exit 0; 79/79 in four exact files (4 commerce HTTP, 9 local order, 5 public runtime, 61 isolation); post-test-augmentation HTTP rerun 4/4 exit 0 |
| Backend typecheck | exit 0 on final source/test state |
| Commerce boundary self-test and normal scan | exit 0; 11 positive controls, 7 scanned sources |
| Strict playbook gate | exit 0 with portable Git on PATH; all four overlapping playbooks updated |
| Scoped tracked-file `git diff --check` | exit 0; pre-existing CRLF normalization warning only |
| Scoped Graphify + Convex edge fixup | full `graphify update .` was cancelled after no output/near-zero CPU; exact three-path one-worker `_rebuild_code` exited 0 with 12,816 nodes/22,332 edges/726 communities; 3/3 manifest source mtimes match with nonempty AST hashes; edge fixup exited 0 |

The direct router tests cover malformed body, missing/unsafe origin, media type, oversized body/token, duplicate item, foreign tenant/account/cart/order/product fields, forged `Host`, query-string success shape, unsupported status/method and duplicate submission. Every valid-looking or hostile request leaves carts, orders, attempts and reservations empty. A separate test drives the existing resolver with two real published **site** host bindings and proves foreign-host, custom-pending, collision and stale-publication refusal. `convex-test.fetch` fixes the HTTP request host at `some.convex.site`, so the two-host comparison is a direct resolver test, not an HTTP A/B storefront proof. The existing Phase 48 public GET/CTA/form regression remains green.

The isolation test seeds B's private cart, proves authenticated A's `tenantOrders.placeOrder` returns `CART_UNAVAILABLE`, and proves anonymous HTTP rejects an injected foreign product field; neither path creates an order or hold.

## Deviations and remaining gates

- **[Rule 4 — architectural constraint, resolved by approved plan revision]** The original Plan 05 asked for a positive anonymous order while Phase 49 hard-refused storefront publication and resolution. The planner narrowed Plan 05 to this closed preflight, deferring positive binding/write to Plan 16. This avoids a DB-seeding bypass and keeps independent discovery, publish, resolver and HTTP darkness intact.
- Abuse protection here is bounded body, item count, key syntax and same-origin validation, not a persistent per-client rate limit. The route performs one internal resolver read and no external/provider call. The first positive buyer write must add its own qualified abuse/idempotency retention policy; this preflight key is deliberately non-durable.
- No Stripe or PayPal adapter, merchant-account credential, hosted session, signed callback, charge, live store, legal/provider eligibility, Wave 7 or Wave 8 acceptance is claimed. The owner chose both providers in the first test-mode release with merchant-owned direct accounts; global country coverage and USD/EUR/GBP eligibility remain to be established per provider/account.

## Shared-worktree and commit handoff

Exact pre-edit hashes and pre-existing dirty/untracked status for overlapping paths are in `50-05-PREEDIT-BASELINE-2026-09-24.md`. All unrelated user and worker edits were preserved. No task or metadata commit, staging, push, deploy, `.env` change or provider call was made under root's batched-review instruction. Root owns ROADMAP/STATE/REQUIREMENTS reconciliation and acceptance.

## Next phase readiness

The closed preflight passed root's batched source review, not public commerce activation. Revised Plans 06–17 require independent plan-check acceptance and remaining provider/policy evidence. Plan 16 must turn the code-owned joint readiness gate, exact verified host and approved published artifact into the first safe positive anonymous cart/order write, with two-tenant/account tests and no client-selected tenant/account/payment fact. `SHOP-03` and `SHOP-05` were touched, not completed by this local refusal proof.

## Self-Check: PASSED

The new HTTP test, pre-edit baseline and this summary exist; 79/79 focused backend tests, final typecheck, commerce guard, strict playbook, scoped Graphify manifest and Convex edge fixup passed. No plan commit exists by explicit root instruction; the broader phase and closure waves remain open.
