# Playbook: Stripe connector (REVN-03)

> Last verified: 2026-08-28 against 28-07 (the read-only Stripe App lane: OAuth, bounded reads and
> the lane gate script)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-07, 28-24) · Related ADRs: none yet

> **Status: BUILT, LANE PARKED, NEVER RUN LIVE.** The code below is on disk at the `Last verified`
> sha and proven offline. **No Stripe App credential exists in this deployment and nothing here has
> ever spoken to Stripe.** The `providerGates` lane row is `parked`, the open condition
> `platform-initiated-revocation` is UNCLEARED, and 28-24 owns the seal. Shared credential,
> OAuth-state, fetch, telemetry and release rules live in `revenue-connectors.md`.

> **Naming:** this is the *tenant's own* Stripe account, read for their business finance. It is
> unrelated to Pikar's own billing/spend reporting (`dashboard-pages.md`). Keep the two apart in code
> and in copy, exactly as Phase 26 Finance and Business Finance are kept apart.

## Key files

- `packages/revenue/src/providers/stripe.ts` (+ `.test.ts`) — pure normalization of the balance,
  charges, invoices, payouts and disputes. No Convex imports, no verb, no URL. Owns
  `STRIPE_READ_PATHS`, the page/window budget and every money conversion.
- `packages/revenue/src/providers/shared.ts` — `boundedWindow`, `normalizeAll`,
  `separateByCurrency`, shared with the QuickBooks lane (hoisted by 28-07, re-exported from there).
- `packages/backend/convex/stripeAuth.ts` — Stripe **App** OAuth: authorize, callback, rolling
  refresh, and a disconnect that clears LOCALLY ONLY.
- `packages/backend/convex/stripeConnector.ts` (+ `.test.ts`) — bounded reads, the derived figures,
  and the ungated `stripeReadEvidence` 28-24 drives. Named `stripeConnector`, not `stripe`, to keep
  it apart from Pikar's own billing surface.
- `scripts/smoke-stripe-read.mjs` — lane evidence producer + offline validator. **Runnable on
  credentials; never run live.**
- `docs/connectors/stripe-suitability.md` — the suitability record and the admission override.

**Deployment env (all `STRIPE_APP_*`, never `BILLING_STRIPE_*`):** `STRIPE_APP_CLIENT_ID`,
`STRIPE_APP_SECRET_KEY`, `STRIPE_APP_REDIRECT_URI`, `STRIPE_APP_API_VERSION` (**no default — the
lane refuses to read without it**), plus `CONNECTOR_CREDENTIAL_KEY_V1`.

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

1. **Stripe App OAuth**, not Connect. Consent at `marketplace.stripe.com/oauth/v2/authorize`
   (client id, redirect, state — **there is no `scope` parameter to widen**); exchange at
   `POST api.stripe.com/v1/oauth/token`, authenticated with the app developer's secret key as a
   bearer credential through the shared `postTokenForm`.
2. The grant must carry a `refresh_token`, an `acct_` id, the literal scope `stripe_apps`, and a
   `livemode` that MATCHES the connection's environment. Re-consent from a different account is
   refused, not silently re-sealed.
3. Reads are GET-only through `connectorFetch.readPages` against the five allow-listed paths, with
   `Stripe-Version` pinned from `STRIPE_APP_API_VERSION`, `starting_after` pagination, `limit=100`
   and at most 5 pages per entity.
4. Adapter emits bounded projections with coverage window, retrieval time and partial/capped state,
   at `payment_rail` authority.
5. **Disconnect is a LOCAL CLEAR and nothing else.** There is no upstream request, because Stripe
   documents no platform-initiated revoke for Stripe Apps. It records
   `revocation.upstream = "unsupported"`, and the grant stays live until the user uninstalls.

## Invariants — what must never break

1. **Read-only surface.** The lane exports list/retrieve only. It must **never** export refund,
   capture, cancel, invoice-send, invoice-finalize, dispute-update, transfer, payout-create, customer
   update, or a generic request method. *Enforced by:* the `*_read`-only manifest permissions (the
   vendor-side boundary), `readPages`' hardcoded GET, `PROVIDER_READ_PATHS.stripe`, and a source scan
   in `stripeConnector.test.ts` mirroring `check-provider-lane.mjs`'s write-verb markers.
2. **No `read_write` scope request.** The authorize URL has no `scope` parameter at all, and
   `parseStripeGrant` refuses any scope string but `stripe_apps` — including `read_only`, which is
   the dead Connect vocabulary. *Enforced by:* `stripeConnector.test.ts`, with `STRIPE_GRANT_SCOPE`
   asserted as a literal once, so a constant rename cannot move the tests with it.
3. **Pinned API version.** `STRIPE_APP_API_VERSION` has NO DEFAULT: unset or malformed, the lane
   returns `unavailable` and makes no request. This repo cannot verify a live Stripe version string
   offline and refuses to invent one. *Enforced by:* `versionHeaders` in `connectorFetch.ts` plus
   three tests.
4. **Revocation is recorded honestly.** `revocation.upstream` is `unsupported` and can never be
   `confirmed`: `classifyRevokeOutcome` short-circuits on the provider before it looks at a status
   code. A local ciphertext clear is a real act and is **never** reported as an upstream revocation.
   *Enforced by:* `PROVIDER_REVOKE_SUPPORT`, four disconnect tests, and the smoke validator, which
   rejects every other upstream state.
5. **The two Stripe lanes never cross.** This lane is `STRIPE_APP_*` / `convex/stripe*.ts` /
   `packages/revenue/src/providers/stripe.ts` and reads a TENANT's account. Phase 28.1's is
   `BILLING_STRIPE_*` / `convex/billing*.ts` / `packages/billing/`, charging from Pikar's own
   merchant account, write-capable. *Enforced by:* a namespace source scan in
   `stripeConnector.test.ts` and a forbidden-substring guard in the smoke validator.
6. **Throttling is partial.** A 429, a cap and a rejected row all produce `partial` naming what is
   missing — never a shorter list that reads as complete.
7. **Bounded pagination.** No unbounded list walk: `limit=100`, 5 pages per entity, a 90-day window.
8. **No double-counting with QuickBooks.** `receiptsSummary` goes through
   `finance.reconcilePayments` even with one source, because `receiptsTotal` accepts only a
   `Reconciled` — there is no shape in the adapter that could total raw provider payments.
9. Plus every invariant in `revenue-connectors.md`.

## How to change safely

- New endpoint → allow-list entry + operation-matrix row in the suitability record + fixture test.
- API version bump → read the changelog, re-run the provider fixtures, and update the suitability
  record's version pin. Treat it like the pre-1.0 component rule in CLAUDE.md §6.
- Webhooks are deferred. If later justified: use Stripe's official verification library, preserve raw
  bodies, enforce timestamp tolerance, dedupe event ids, and tolerate retries/out-of-order events.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && npx vitest run src/providers/stripe` | Minor-unit money, pagination, closed status sets. 39 tests. | offline |
| `cd packages/backend && npx vitest run convex/stripeConnector.test.ts` | Route, mode binding, revocation honesty, gate, caps, tenant isolation. 76 tests. | offline |
| `cd packages/backend && npx tsc --noEmit` | Run SEPARATELY — a green vitest run is not a typecheck. | offline |
| `node scripts/smoke-stripe-read.mjs --self-test` | 28 validator guards, each observed refusing. Prints **NOT A LIVE PASS**. | offline |
| `node scripts/smoke-stripe-read.mjs` | Exits **2** with `LIVE_EVIDENCE_NOT_PRODUCED`. | offline |
| `node scripts/smoke-stripe-read.mjs --tenant <id>` | Controlled live read. Lane evidence. | live creds |
| `node scripts/check-provider-lane.mjs --provider stripe --stage engineering` | `consistent`, 1 row pending. Consistent is NOT passed. | offline |

## Operational notes

- A test-mode install proves parsing only. Production lane evidence needs a controlled live read
  against a live-mode grant, and `livemode` must match the environment or nothing seals.
- **External testing serves 25 accounts with NO App Review.** A 0-to-25-customer pilot needs no
  Stripe approval; publishing costs an App Review (~4 business days, one published app per account).
- **Size polling against the read ALLOCATION, not the rate limit:** 500 reads per transaction with a
  10,000/month floor, aggregated across connected accounts, over a rolling 30 days. A full poll is at
  most 25 requests (5 entities x 5 pages), so an account on the floor tolerates roughly 400 polls a
  month. Raising `STRIPE_PAGE_SIZE` or `STRIPE_MAX_PAGES` spends that budget.
- Disputes are read for *context* only. Reading a dispute must never become updating one — the
  normalized shape has five fields and none of them is evidence or a deadline.

## Known gaps & deferred work

- **THE LANE HAS NEVER RUN LIVE.** No Stripe App credential exists in this deployment. The lane row
  is `parked`, the open condition is UNCLEARED, and REVN-03 stays incomplete.
- **`handleCallback` has NO CALLER.** The `/stripe/callback` HTTP route and the connections UI are
  28-09's, so a live run cannot complete a consent yet.
- **The Stripe App itself is not registered.** The manifest declaring `stripe_api_access_type:
  "oauth"` and the `*_read` permissions in `STRIPE_APP_PERMISSIONS` is an owner action, not a repo
  artefact. `STRIPE_APP_PERMISSIONS` documents what it must contain.
- Nothing consumes these projections yet (28-12/28-13). `openInvoices` returns rows; no aging is
  computed here, because Stripe hands back several currencies and `agingReport` needs one.
- `payment_intents` and `balance_transactions` are deliberately not read; see the pure module header.
- Webhooks are out of scope. `account.application.deauthorized` is the ONLY deauth signal that
  exists on this route, and it is recorded here rather than implemented.
