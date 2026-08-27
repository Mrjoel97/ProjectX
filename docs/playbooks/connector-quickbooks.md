# Playbook: QuickBooks Online connector (REVN-02)

> Last verified: 2026-08-27 against eaea00c (28-01 Task 3 recorded the admission decision)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-06, 28-23) · Related ADRs: none yet

> **Status: REGISTERED AHEAD OF IMPLEMENTATION.** No QuickBooks code exists at the `Last verified`
> sha. Everything marked **[PLANNED]** is a contract a later plan must satisfy, not a claim of landed
> behaviour. Shared credential, OAuth-state, fetch, telemetry and release rules live in
> `revenue-connectors.md` and are not repeated here.

## Purpose

Read-only access to a tenant's own QuickBooks Online company so the deterministic finance core can
compute cash flow, AR/AP aging and payroll confidence from real accounting data. QuickBooks carries
the phase's widest stolen-token blast radius, and its refresh-token rotation is the one place where a
naive shared implementation destroys connections.

## Key files

**[PLANNED]**

- `packages/revenue/src/providers/quickbooks.ts` (+ `.test.ts`) — pure parsing of the allow-listed
  reports/entities into named normalized fields. No Convex imports.
- `packages/backend/convex/quickbooksAuth.ts` — realm-bound authorize/callback/refresh/revoke.
- `packages/backend/convex/quickbooks.ts` (+ `.test.ts`) — Node actions performing bounded reads.
- `scripts/smoke-quickbooks-read.mjs` — controlled live read + revoke evidence for the lane gate.
- `docs/connectors/quickbooks-suitability.md` — the suitability record (28-01 drafts, 28-23 decides).

## Dependencies & blast radius

`graphify query "quickbooks connector"`. Beyond that:

- `packages/revenue/src/finance.ts` and `convex/revenueFinance.ts` (`revenue-finance.md`) are the sole
  consumers of these projections. Field renames here move numbers there.
- Shared envelope + `connectorFetch` + `providerGates` — see `revenue-connectors.md`.
- Intuit app credentials, redirect URI and environment (sandbox vs production) in Convex env.

## Admission blockers — SETTLED 2026-08-27, with conditions

> **`approved_production`, on OWNER ATTESTATION — testimony, not evidence.** Owner judgment recorded
> in [`docs/connectors/quickbooks-suitability.md`](../connectors/quickbooks-suitability.md); that
> marker block is the authority. The owner attested that Pikar **holds live Intuit production
> credentials today** (production App Assessment Questionnaire approved). Nothing in this repository
> checked that, and no vendor page can. If it is wrong the approval is void and this lane is
> `blocked` again. Expires `review_by: 2026-11-27`.

Two things the approval did **not** dissolve:

1. **The scope is a data category, not a read verb.** `com.intuit.quickbooks.accounting` grants the
   whole Accounting API. The provider *cannot* enforce read-only for us. The wider stolen-token blast
   radius is now **explicitly ACCEPTED by the owner** — which means containment is entirely ours:
   the **compile-time GET / query / report-only allow-list is MANDATORY**, with no general
   request-method parameter and no entity create/update export.
2. **The App Partner Program tier is UNSTATED.** The owner attested to production credentials, not to
   a tier. The **Builder tier caps at 500,000 CorePlus API calls / workspace / month**, which would
   bound a polling revenue pack. Establish the tier before sizing poll budgets here; do not assume
   headroom. Ongoing security obligations (scans, affidavit, annual review over 500 connections)
   stand regardless.

## Data flow

1. Authorize; the connection is bound to a `realmId`. Verify the returned realm belongs to the
   intended connection before sealing.
2. Access tokens last roughly one hour. Refresh tokens **roll** — the latest one must be persisted.
3. Reads go through a **compile-time endpoint allow-list** of GET/query/report calls only.
4. Report endpoints (Cash Flow, aged receivables/payables, profit and loss) are used only where they
   map to a named normalized field — never scraped generically.
5. Adapter emits bounded projections with coverage window, retrieval time and partial/capped state.
6. Disconnect: Intuit revoke endpoint first, local encrypted row delete second.

## Invariants — what must never break

1. **Refresh needs a per-connection lease/CAS.** Concurrent refresh attempts with the same token
   produce `invalid_grant` and **may invalidate the connection permanently**. Access and refresh
   ciphertext must be replaced atomically on the same row. *Enforced by:* [PLANNED] concurrent-refresh
   test (28-06). **Other providers must not inherit this logic** — see `revenue-connectors.md`.
2. **Compile-time endpoint allow-list.** GET/query/report only. **No general request-method parameter**
   and no entity create/update export exists in the module. This is the only thing standing between a
   full-Accounting-API scope and a write. *Enforced by:* [PLANNED] 28-26 reachability test.
3. **Realm binding.** Every read asserts the stored `realmId`. A projection may never be attributed to
   a company it did not come from. *Enforced by:* [PLANNED] two-tenant test.
4. **Bounded requests.** Dates (Intuit recommends six months for report requests), pages, rows and
   total bytes are all capped.
5. **429 is partial/unavailable, not zero.** A throttled report yields unknown coverage. A zero here
   becomes a false cash figure downstream — this is the phase's most expensive possible bug.
6. **Revoke before delete.** A network/5xx failure yields an honest partial-revoke state.
7. Plus every invariant in `revenue-connectors.md`.

## How to change safely

- Adding a report → add it to the allow-list *and* map it to a named normalized field *and* add a
  fixture test. An unmapped report must not be fetched "in case it is useful".
- Changing a normalized field name → grep `packages/revenue/src/finance.ts` and
  `convex/revenueFinance.ts` first, and bump `revenue-finance.md`. A renamed key that never reaches
  the consumer is a silent zero.
- Touching refresh → re-run the concurrent-refresh test. A broken lease is not visible in a
  single-threaded test.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && pnpm vitest run src/providers/quickbooks` [PLANNED] | Report fixture parsing, pagination, 429, 401. | offline |
| backend `pnpm test quickbooks` [PLANNED] | Realm binding, rotating-refresh CAS, revoke ordering, two-tenant isolation. | offline |
| `node scripts/smoke-quickbooks-read.mjs` [PLANNED] | Sandbox or controlled live read + revoke. Lane evidence. | live creds |
| `node scripts/check-provider-lane.mjs quickbooks` [PLANNED] | `passed` or `parked`. | offline |

## Operational notes

- Sandbox proves payload parsing. It does not prove production authorization or the self-assessment
  gate. Do not let a green sandbox read be recorded as lane evidence for production.
- Per-realm rate limits are documented by Intuit; treat every throttle as coverage loss.

## Known gaps & deferred work

- The broad-scope acceptance and the production self-assessment are both unresolved. Either one
  unresolved keeps the lane `parked`.
- Everything [PLANNED] is unbuilt; invariants 1-3 have no enforcement yet.
- Webhooks and any accounting write (journal entries, invoice creation) are out of phase scope.
