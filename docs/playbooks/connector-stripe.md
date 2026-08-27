# Playbook: Stripe connector (REVN-03)

> Last verified: 2026-08-27 against eaea00c (28-01 Task 3 recorded the admission decision)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-07, 28-24) · Related ADRs: none yet

> **Status: REGISTERED AHEAD OF IMPLEMENTATION.** No Stripe connector code exists at the
> `Last verified` sha. Everything marked **[PLANNED]** is a contract a later plan must satisfy, not a
> claim of landed behaviour. Shared credential, OAuth-state, fetch, telemetry and release rules live
> in `revenue-connectors.md` and are not repeated here.

> **Naming:** this is the *tenant's own* Stripe account, read for their business finance. It is
> unrelated to Pikar's own billing/spend reporting (`dashboard-pages.md`). Keep the two apart in code
> and in copy, exactly as Phase 26 Finance and Business Finance are kept apart.

## Key files

**[PLANNED]**

- `packages/revenue/src/providers/stripe.ts` (+ `.test.ts`) — pure normalization of balances,
  charges/payment intents, invoices, payouts/balance transactions and disputes. No Convex imports.
- `packages/backend/convex/stripeAuth.ts` — Connect OAuth authorize/callback/deauthorize.
- `packages/backend/convex/stripeConnector.ts` (+ `.test.ts`) — Node actions performing bounded reads.
  Named `stripeConnector`, not `stripe`, to avoid colliding with Pikar's own billing surface.
- `scripts/smoke-stripe-read.mjs` — controlled live read + deauthorize evidence for the lane gate.
- `docs/connectors/stripe-suitability.md` — the suitability record (28-01 drafts, 28-24 decides).

## Dependencies & blast radius

`graphify query "stripe connector"`. Beyond that:

- `revenue-finance.md` consumes these projections for cash and payment-lag statistics. Beware
  double-counting: a payment visible in both Stripe and QuickBooks must be reconciled by source
  authority, never summed (see `revenue-connectors.md` invariant 6).
- Shared envelope + `connectorFetch` + `providerGates`.

## Admission blocker — decided 2026-08-27 by OWNER OVERRIDE

> **`approved_production` — and the evidence did not support it.** Owner judgment recorded in
> [`docs/connectors/stripe-suitability.md`](../connectors/stripe-suitability.md); that marker block
> is the authority. The record states production is **not supportable today** because
> **platform-initiated revocation for Stripe Apps is undocumented**, and 28-CONTEXT makes per-tenant
> revocation a hard requirement. The owner was shown that and approved anyway. This is an override,
> not a finding — do not restate it as an evidence-supported decision.
>
> **THE REVOCATION CONDITION REMAINS OPEN. 28-24 must confront it** — with a Stripe support answer,
> or with an explicit, tenant-visible statement that "disconnect" means Pikar deletes the stored
> ciphertext locally while the grant stays live on Stripe's side until the *user* uninstalls. It
> cannot be closed by a green test; no test here can prove an API that is not documented to exist.

**The Extension route is DEAD, not gated.** Stripe: "You can no longer build new Connect extensions."
The old advice to "be accepted/configured as an Extension" is a closed door. The route is a **Stripe
App** with `stripe_api_access_type: "oauth"` declaring only `*_read` permissions — read-only by
construction. Stripe's own `oauth-changes-for-standard-platforms` page still describes the dead
Extension path; it is stale, do not follow it.

- Do **not** request `read_write` "for later". That is the exact substitution this phase forbids.
- Size polling against the **500 reads / transaction, 10,000 / month floor** allocation, not the
  100 req/s rate limit.

## Data flow

1. Connect OAuth for Standard accounts; a deauthorize endpoint exists and is the disconnect path.
2. Verify the returned connected-account id belongs to the intended connection before sealing.
3. Reads use Stripe's recommended connected-account access model with a **pinned API version**, and
   expose only list/retrieve calls.
4. Adapter emits bounded projections with coverage window, retrieval time and partial/capped state.
5. Disconnect: Stripe deauthorize first, local encrypted row delete second.

## Invariants — what must never break

1. **Read-only surface.** The module exports list/retrieve only. It must **never** export refund,
   capture, cancel, invoice-send, invoice-finalize, dispute-update, transfer, payout-create, customer
   update, or a generic request method. *Enforced by:* [PLANNED] 28-26 reachability test.
2. **No `read_write` scope request.** *Enforced by:* [PLANNED] scope-constant test.
3. **Pinned API version.** Stripe ships breaking changes per version; an unpinned read can silently
   change a projection's meaning. *Enforced by:* [PLANNED] allow-list test.
4. **Throttling is partial.** Honour 429 and `Stripe-Rate-Limited-Reason`; represent a capped search
   as `partial`, never as a complete result.
5. **Bounded pagination and concurrency.** No unbounded list walk.
6. **No double-counting with QuickBooks.** Source authority decides which provider owns a fact.
7. Plus every invariant in `revenue-connectors.md`.

## How to change safely

- New endpoint → allow-list entry + operation-matrix row in the suitability record + fixture test.
- API version bump → read the changelog, re-run the provider fixtures, and update the suitability
  record's version pin. Treat it like the pre-1.0 component rule in CLAUDE.md §6.
- Webhooks are deferred. If later justified: use Stripe's official verification library, preserve raw
  bodies, enforce timestamp tolerance, dedupe event ids, and tolerate retries/out-of-order events.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && pnpm vitest run src/providers/stripe` [PLANNED] | Projection shape, pagination cap, 429/401 handling. | offline |
| backend `pnpm test stripeConnector` [PLANNED] | Two-tenant isolation, deauthorize ordering. | offline |
| `node scripts/smoke-stripe-read.mjs` [PLANNED] | Controlled live read + deauthorize. Lane evidence. | live creds |
| `node scripts/check-provider-lane.mjs stripe` [PLANNED] | `passed` or `parked`. | offline |

## Operational notes

- A test-mode key proves parsing only. Lane evidence for production requires the Extension decision
  plus a controlled live read.
- Disputes are read for *context* only. Reading a dispute must never become updating one.

## Known gaps & deferred work

- The Extension/`read_only` eligibility question is unanswered; the lane cannot start until it is.
- Everything [PLANNED] is unbuilt; invariants 1-3 have no enforcement yet.
- Webhooks and every write verb listed in invariant 1 are out of phase scope.
