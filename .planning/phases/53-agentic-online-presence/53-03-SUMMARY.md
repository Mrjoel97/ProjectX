---
phase: 53-agentic-online-presence
plan: "03"
status: in_progress
requirements-completed: []
---

# 53-03 — Partial provider-independent goods foundation

On2026-10-22, recovered the pure tenantCommerce contract/core, tenantInventory and tenantOrder with
their three suites from immutable PR36 `5d7b9e5a8e0acaecbdc110123718798565421b5c`. No shared exports,
database tables, interface, provider adapters or public gate changes accompanied this recovery.
The existing wildcard package exports and hash helper resolve these modules. Repository formatting
was applied after recovery. All22 focused tests passed.

The useful foundation covers checked integer-minor totals, authoritative product/policy quote
snapshots, physical/digital distinctions, finite/untracked inventory, merchant-bounded1–60minute
holds, expiry, stale/foreign refusal and late-paid unavailable-stock exceptions. It is not a working
shop: callers are trusted inputs, `payment_confirmed` is not a verified provider event, policy refs
are declarations, and no runner performs refunds, merchant review or fulfilment.

Persistent private catalogue/order adapters, their eight tenant-owned tables/privacy maps, actual
merchant identity/onboarding, both Stripe and PayPal lifecycles, signed event reconciliation,
refunds, shipment/digital entitlement, buyer notices, account/country/currency admission and actual
provider/browser witnesses remain. Service booking/deposit lifecycles are not established by these
goods contracts. Historical decisions remain pending where account/provider evidence is absent.

The original first test release scope remains both providers, merchant-direct receiving accounts,
physical plus digital goods, versioned merchant policies and merchant-admin review of late-paid
unavailable stock. Do not auto-refund/fulfil an exception or reuse Pikar subscription credentials.
The code-owned public checkout refusal stays intact. OPRES-04 remains open.
