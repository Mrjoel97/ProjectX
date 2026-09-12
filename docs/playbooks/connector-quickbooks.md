# Playbook: QuickBooks Online connector (REVN-02)

> Last verified: 2026-09-12 — the smoke CLI now forwards the explicit
> `PIKAR_CONVEX_TARGET=prod` selection through Node to Convex with no shell, preserving JSON
> arguments on Windows. `--environment production` selects the provider environment only;
> it does not select the Convex deployment. Run `node --test scripts/smoke-quickbooks-read.test.mjs`
> for the offline targeting regression checks. The v1 evidence field `requestCount` is retained
> for compatibility but counts successful entity reads, not HTTP requests: pagination and token
> refresh requests are unmeasured. It cannot establish the unresolved partner tier/poll budget.
> No live QuickBooks read, revoke, OAuth consent, or gate sealing was performed by these checks.

> Last verified: 2026-09-09 (45-10 — DIAGNOSIS CLOSED. The app's ONLY registered redirect URI is
> Intuit's Playground default; production was pointed at that exact string and consent STILL
> failed. A registered URI is refused, so the redirect URI was never the variable.
>
> THE CHAIN: (1) the token endpoint returns `invalid_grant`, not `invalid_client` — the app exists
> and its credentials are provisioned; (2) the consent page's “**undefined** didn't connect” is the
> app's DISPLAY NAME failing to resolve, so appcenter cannot READ the app record; (3) the console
> cannot read it either (`v4/graphql` → `responseStatus: 0`). ONE unreadable app record explains
> the empty workspace list, the absent Create-workspace control, the missing Save button, and the
> refused consent. Intuit-side; no configuration of ours can affect it.
>
> KEEP THE CONTROL IN MIND: a fabricated client_id yields the same error page, so `undefined`
> proves nothing ALONE. It becomes evidence only paired with (1), which rules out non-existence.
> Two weak signals that constrain each other beat one strong-sounding signal read on its own.
>
> STANDBY BRIDGE if Intuit repairs the app record but not the console: point
> `QUICKBOOKS_REDIRECT_URI` at the Playground URI, consent, take `state`/`code`/`realmId` from the
> ADDRESS BAR, then `convex run --prod quickbooksAuth:handleCallback` — the same internalAction the
> HTTP callback invokes, so the credential is sealed by the ordinary path with a manual last hop.
> Both the code and the state row expire in ~10 minutes. Steps in the suitability record.)
> Last verified: 2026-09-09 (45-09 — ROOT CAUSE of the connect failure, and it is Intuit's, not
> ours: on the app's Keys and credentials page a redirect URI can be typed but **there is no Save
> button**, so it is never stored. Measured cause — the console's workspaces query
> (`developerdeveloper.api.intuit.com/v4/graphql`) returns `responseStatus: 0`, a network-layer
> failure, on its SECOND call after a 200 on the first; the app never retries. No list mounts, so
> there is no Create-workspace control either.
>
> Ruled out BY TEST, not assumption: extensions/local state (owner reproduced it in Incognito),
> authentication (authZ PERMIT plus three other authenticated GraphQL 200s), cookie consent
> (OneTrust initialised; its `Script error.` is cross-origin noise), and a malformed host
> (`developerdeveloper…` resolves through Akamai and behaves like `developer.api.intuit.com`).
>
> AND THE KEYS ARE CORRECT — that question is closed. They are in the root `.env` as
> `INTUITAPP_CLIENT_ID`/`INTUITAPP_CLIENT_SECRET`, not `QUICKBOOKS_*`; a grep for the wrong
> spelling reported them missing and briefly made “wrong keys on prod” the leading theory. By
> SHA-256 the deployment values are byte-identical to `.env`.
>
> THE WORKAROUND THAT NEEDS NO FIX FROM INTUIT: registering a NEW URI is blocked; MATCHING an
> already-registered one is not. If any URI already on the app is on a host we control, point
> `QUICKBOOKS_REDIRECT_URI` at it — `http.ts` serves the callback on the deployment and the
> `apps/web` forwarder serves the same shape on `www.pikar-ai.com`.)
> Last verified: 2026-09-09 (45-08 — first live production connect attempt. It did NOT connect,
> and the blocker is on Intuit's side: the developer account has **no workspace**, so no surface
> will display the app's registered redirect URIs. The OAuth Playground says it outright — “you
> must first create a workspace” — and `/workspaces` renders its shell but never issues the XHR
> for its list (verified in the tab's network log: only a notification-tray POST and a logging
> POST fire, and there is no console error). `/app/developer/myapps` now 302s to `/homepage`.
>
> TWO THINGS TO REUSE, both of which cost minutes and save hours:
>
> 1. **Probe the TOKEN endpoint to test credentials — never the authorize page.** A POST to
>    `/oauth2/v1/tokens/bearer` with a deliberately bogus code returns `invalid_grant` when the
>    client_id/secret pair is GOOD and `invalid_client` when it is not — an answer with no consent
>    and no authorization. On 2026-09-09 it returned `invalid_grant`, which is how we know the
>    production keys are live and the failure is elsewhere. Exact curl in the suitability record.
> 2. **`appcenter.intuit.com/app/connect/oauth2`'s error page tells you NOTHING.** It renders the
>    same “Sorry, but *undefined* didn't connect” for a good client_id with a good URI, a good
>    client_id with a URI that is definitely unregistered, AND a client_id that DOES NOT EXIST.
>    The fabricated-client_id control is what proves it, and it is one navigation. Run that control
>    BEFORE building a theory on that page: a detector returning the same answer for known-good and
>    known-bad inputs is measuring nothing, and reasoning from it produces confident wrong fixes.
>    (Same discipline as `scripts/check-absence-guards.mjs`; see cockpit.md.)
>
> Our side is verified complete and live: keys set on prod, `QUICKBOOKS_REDIRECT_URI` read back
> byte-for-byte, and the `http.ts` callback answering — junk params → `303` to
> `?connect=quickbooks&result=invalid_state`, with no provider text in the redirect (§4).
>
> THE LANE STAYS UNSEALED. No live read has happened, so there is nothing to seal — the gate
> behaving correctly, not an omission. Full record: `docs/connectors/quickbooks-suitability.md`.)
> Last verified: 2026-09-01 (28-29 recovery telemetry — after the passed-only tenant read returns a
> normalized zero-balance invoice or linked payment, it can match a provider-scoped one-way ref
> from an earlier tenant-owned reminder and emit one idempotent `recovery_observed`. Unavailable
> reads, another tenant and another provider cannot match). Prior: 28-21 terminal telemetry — the
> bounded read reduces its projection to provider, state and counts on the shared Phase 27 plane;
> lifecycle events remain centralized at the credential mutation seam.
> Prior: 2026-08-31 against the 28-09 connect-start gate — **THE CONNECT FLOW IS NOW GATED,
> AND `beginConnect` CHECKS THE GATE BEFORE IT READS THE DEPLOYMENT CONFIG.** Read from the working
> diff by the 33.1 lane, which does not own this subsystem; recorded here because §9 asks the change
> to travel with its playbook. The behaviour below is verified by reading the code and its tests,
> **not** by a live QuickBooks grant — the lane's live status is unchanged and still says so above.
>
> **What was open.** `beginConnect` was an ungated `tenantAction`. Once the owner sealed a
> `providerGates` row to begin gathering evidence, **any tenant who called it directly could
> complete a real OAuth grant against a provider whose lane had not passed** — a stored credential
> on a connector nothing had proven. The same hole existed on `hubspotConnectUrl` and the Stripe
> `beginConnect`.
>
> **Where the fix lives, and why it is one place.** In `connectorOAuth.mintConnectState`, not here.
> Every provider's connect flow mints its state through that one mutation, so a single
> `connectStartAllowed` check covers all four providers and a fifth lane cannot forget it. This
> playbook's subject is downstream of that gate, not a second copy of it — do NOT add a QuickBooks-
> specific connect check.
>
> **`connectStartAllowed` has three answers and the middle one is the point:** a `passed` lane is
> open to any tenant; an admitted-but-unproven lane is **owner-only**, which is what keeps the
> evidence path reachable without exposing it to customers; anything else refuses. The refusal is
> the CODE `PROVIDER_NOT_CONNECTABLE` and never a reason — which axis refused is operator
> information and this throw reaches a browser.
>
> **THE ORDERING CHANGE IN THIS FILE'S OWN CODE, which is the part a reader here must not undo.**
> `beginConnect` used to call `requireQbApp()` first and mint the state second. Reading the
> deployment config first told an unauthorized caller **whether QuickBooks is configured on this
> deployment**, because a missing-config throw and a refusal are distinguishable. The order is now
> gate-then-config: `mintConnectState` runs first and an unauthorized caller is refused before
> learning anything, with `requireQbApp()` moved inline into the return. **Do not "tidy" that back
> into a local `const app` at the top of the handler** — the position is the security property.
>
> Its accepted cost is written at the call site: an unconfigured deployment now leaves ONE state row
> that expires in 10 minutes. Cheaper than a second gate call, and the row grants nothing alone.
>
> **How the tests stay honest, and the trap in them.** `quickbooks.test.ts`'s harness now seeds
> EVERY lane passed (via the shared `__fixtures__/providerGates.ts`) so the new gate is transparent
> to suites that are about OAuth mechanics and bounded reads. That seeding would have made this
> file's fail-closed cases **unfalsifiable** — a test asserting "no gate record means no request
> leaves" cannot fail if the harness just wrote a passing gate. Four such tests therefore call
> `clearGates(t)` first. **Any new test here that is ABOUT the absence of a judgment must do the
> same**, or it will pass for the wrong reason.
>
> `sealPassedGate` is now patch-or-insert rather than insert, because a second row for the same
> `(provider, environment)` makes `rowFor`'s `.unique()` throw and reads as a mystery failure.
>
> **The fixture is shared on purpose** (`packages/backend/__fixtures__/providerGates.ts`, registered
> under `revenue-connectors.md` — it is cross-provider, not this connector's). It builds
> `clearedConditions` from `PROVIDER_OPEN_CONDITIONS` rather than typing the ids, so a renamed
> condition breaks the seeder instead of leaving a row that silently resolves to `pending`; and it
> is ONE copy because the last time a fixture was duplicated here a repair reached two of the three
> copies. A suite that IS about the gate should still build its rows inline, so the axis under test
> is visible in the test body.

> **Formatting-only pass, 2026-08-29.** `biome format` + `organizeImports` ran across this
> subsystem's files to clear a CI `Lint` red that had been blocking the `Test` and `Build`
> steps behind it since 2026-08-27. Whitespace, line wrapping and import order ONLY — no
> behaviour change, and **this is not a re-verification of anything below.** The
> `Last verified` line still means what it said.

> Last verified: 2026-08-28 against 28-07 (`boundedWindow`, `normalizeAll` and
> `separateByCurrency` hoisted from `providers/quickbooks.ts` to `providers/shared.ts` and
> re-exported — no behaviour change), on top of 28-06 complete (OAuth, bounded reads, gate script)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-06, 28-23) · Related ADRs: none yet

> **Status: BUILT AND OFFLINE-PROVEN. THE LANE HAS NOT RUN LIVE.** The normalizer, the OAuth
> module, the read adapter and the lane gate script are landed with 90 backend + 73 pure tests and
> 22 gate-validator cases — every one $0 against a stub. **Nothing here has ever spoken to Intuit,
> and on 2026-08-28 no Intuit credential was loaded in this deployment,** so 28-06 could not run
> the live report/revoke gate it was asked for. The `providerGates` lane row stays `parked`, the
> open condition `partner-tier-and-poll-budget` stays UNCLEARED, REVN-02/05 stay PENDING, and
> **28-23 closed the wave-7 judgment as PARK on 2026-08-31.** A later evidence-backed review may
> reopen it. The env names a live run needs are in
> `docs/connectors/quickbooks-suitability.md`.
> Shared credential, OAuth-state, fetch, telemetry and release rules live in
> `revenue-connectors.md` and are not repeated here.

> **28-23 park verification:** `--seal-decision from-owner` resolved only to a production
> `parked` payload with `clearedConditions: []`; `--verify-gate` passed all 25 offline behavior
> tests. No live smoke/read/revoke ran, and no Intuit endpoint was called. Parked remains absent from
> the passed-only provider projection and is reversible only through a later live-evidence seal.

## Purpose

Read-only access to a tenant's own QuickBooks Online company so the deterministic finance core can
compute cash flow, AR/AP aging and payroll confidence from real accounting data. QuickBooks carries
the phase's widest stolen-token blast radius, and its refresh-token rotation is the one place where a
naive shared implementation destroys connections.

## Key files

- `packages/revenue/src/providers/quickbooks.ts` (+ `.test.ts`) — **LANDED.** Pure parsing of the
  allow-listed query entities into named normalized fields. No Convex imports, no URL, no request
  verb, no arithmetic — `finance.ts` owns every number.

- `packages/backend/convex/quickbooksAuth.ts` — **LANDED.** Realm-bound
  `beginConnect` / `handleCallback` / `refreshConnection` / `disconnect`. Contains no request verb
  and no transport: the only non-GET in the connector plane is `connectorOAuth.postTokenForm`.
- `packages/backend/convex/quickbooks.ts` (+ `quickbooks.test.ts`) — **LANDED.** Bounded reads.
  `readEntity` over a four-member closed entity union, plus `receivablesSummary` and `cashOnHand`,
  which return `finance.ts`'s figures and compute none of their own.

- `scripts/smoke-quickbooks-read.mjs` — **LANDED, NEVER RUN LIVE.** The lane evidence producer:
  `--self-test` and `--verify-evidence` are offline; a normal run needs credentials and a connected
  company. It refuses to fake a read, and `--verify-evidence` prints **"THIS FILE IS A STUB, NOT A
  LIVE PASS"** on anything recorded in `self-test` mode.

**[PLANNED]**

- The HTTP callback route. `handleCallback` is an `internalAction` and **nothing calls it yet** —
  registering `/quickbooks/callback` on the router touches `http.ts`, which 28-06 does not own.
  A live gate run needs that route first.

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
4. **Only the `query` endpoint is used.** `/v3/company/{}/reports/{}` is allow-listed and **parsed by
   nothing**: on 2026-08-27 Intuit's Reports API reference could not be read (the JSON store returns
   403 and the docs site is a client-rendered SPA), so a report parser would be written against a
   *guessed* response shape. Every field `finance.ts` consumes — invoices, payments, bills, bank
   balances — comes from the documented query endpoint instead. Aged receivables/payables are
   COMPUTED by `finance.agingReport` from normalized invoices, not scraped from Intuit's aged report,
   so the repo keeps one definition of a number the owner acts on. To add a report: read the
   reference in a real browser, map it to NAMED fields, land a captured fixture, then parse it.
5. Adapter emits bounded projections with coverage window, retrieval time and partial/capped state.
6. Disconnect: Intuit revoke endpoint first, local encrypted row delete second.

## Invariants — what must never break

1. **Refresh needs a per-connection lease/CAS, and exactly ONE attempt.** Concurrent refresh
   attempts with the same token produce `invalid_grant` and **may invalidate the connection
   permanently** — a racing or RETRIED refresh does not degrade the connection, it kills it. The
   lease stops a second request existing; the `revision` fence stops a refresher that slept past its
   lease from committing stale tokens; both ciphertexts replace atomically in one blob.
   **There is no retry on any failure class.** *Enforced by:* `quickbooks.test.ts` — the lease, the
   fence and the one-attempt rule each observed refusing ALONE, with `commitRefresh` also driven
   directly so neither guard can be satisfied by the other (28-03 shipped a fence test that was).
   **Other providers must not inherit this logic** — see `revenue-connectors.md`.
2. **Compile-time endpoint allow-list, and no verb anywhere in the lane.** GET/query only. **No
   request-method parameter, no path parameter, no entity create/update export.** A caller picks an
   entity from a four-member closed union; the path is built from a pinned template. This is the
   only thing standing between a full-Accounting-API scope and a write. *Enforced by:* the
   `read-only` row of `scripts/check-provider-lane.mjs` **and** a mirrored source scan in
   `quickbooks.test.ts` — a gate that only runs at release is a gate discovered at release.
3. **Realm binding.** The realm is read out of the CIPHERTEXT, never from a caller argument, and is
   validated as a plain numeric id BEFORE the single-use code is spent — it becomes a path segment.
   Re-consent with a different realm is terminal (`account_mismatch`), not a silent re-seal. A
   refresh can never rebind the company. *Enforced by:* two-tenant and realm-swap tests.
   **3a. TENANT-FACING reads fail closed on the gate — and only those.** `readEntity`,
   `receivablesSummary` and `cashOnHand` go through `gatedRead` and return `unavailable` unless
   `providerGates.gateEligibility` resolves `passed`. The lane-evidence action
   `quickbooksReadEvidence` deliberately does NOT check it: the gate governs CONSUMPTION, and
   gating the evidence producer on the pass it produces would force 28-23 to seal FIRST and verify
   afterwards — publishing QuickBooks to every tenant on evidence nobody has. 28-05 reached the
   same conclusion for HubSpot. *Enforced by:* a pair of tests that read the SAME unsealed state
   twice, once through each door, and require opposite answers.
4. **Bounded requests.** Dates, pages, rows and total bytes are all capped.
   `QB_DEFAULT_WINDOW_DAYS = 180` is **this repo's choice, not a vendor recommendation.** The
   widely-repeated "Intuit recommends six months for report requests" figure is **UNSOURCED** — it
   could not be found in primary vendor documentation on 2026-08-27, only in an Intuit Developer
   Medium post and a client-rendered KB article, neither admissible. Bounding is correct practice;
   do not re-attribute the specific number to Intuit. *Enforced by:* a literal assertion in
   `quickbooks.test.ts`, which kills a silent widening of the default.
5. **Nothing the adapter touches computes a figure.** The provider module normalizes rows and does
   no arithmetic; aging, payment lag, cash timelines, coverage and confidence all come from
   `packages/revenue/src/finance.ts`. A second copy of that math is a second, divergent definition
   of a number the owner acts on. An LLM may EXPLAIN a computed result and may never produce one.
6. **A row that will not normalize is COUNTED, never dropped.** `normalizeAll` returns a reject
   count so the projection goes `partial` and names what is missing. Silently skipping a malformed
   invoice understates what a tenant is owed — missing history is unknown, never zero.
7. **Mixed currency is separated and named, never summed.** `separateByCurrency` keeps the home
   currency and lists the others; totalling across currencies without an FX rate is impossible and
   dropping them silently would understate the business.
8. **429 is partial/unavailable, not zero.** A throttled report yields unknown coverage. A zero here
   becomes a false cash figure downstream — this is the phase's most expensive possible bug.
9. **Revoke before delete.** A network/5xx failure yields an honest partial-revoke state.
10. Plus every invariant in `revenue-connectors.md`.

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
| `cd packages/revenue && pnpm vitest run src/providers/quickbooks` | Query-text construction, pagination, row normalization, missing-vs-zero, mixed currency, and that the module contains no request verb. 73 tests, all offline. | offline |
| `cd packages/backend && npx vitest run convex/quickbooks.test.ts` | Realm binding, the lease and the fence each refusing alone, one-attempt refresh, revoke ordering, gate fail-closed, 429-is-partial, mixed currency, two-tenant isolation, and the no-write-verb scan. 86 tests, all offline. | offline |
| `node scripts/smoke-quickbooks-read.mjs --self-test` | The evidence builder and all 22 validator guards, each observed refusing. Prints that it is **not** a live pass. | offline |
| `node scripts/smoke-quickbooks-read.mjs --verify-evidence <file>` | Schema, freshness, environment, revoke ordering, no leaked realm/token/email. Refuses a stub as lane evidence. | offline |
| `node scripts/smoke-quickbooks-read.mjs --tenant <id>` **[NEVER RUN]** | Controlled live read; `--revoke` adds a real, destructive revoke. Lane evidence. | live creds + connected company + the callback route |
| `node scripts/check-provider-lane.mjs --provider quickbooks --stage engineering` | Consistency, not a pass. Currently `consistent`, 1 row pending. | offline |

## Operational notes

- Sandbox proves payload parsing. It does not prove production authorization or the self-assessment
  gate. Do not let a green sandbox read be recorded as lane evidence for production.
- Per-realm rate limits are documented by Intuit; treat every throttle as coverage loss.

## Known gaps & deferred work

- Controlled live read/revoke evidence and the partner tier/poll budget are unresolved. Either one
  unresolved keeps the lane `parked`; the owner explicitly chose that outcome in 28-23.
- Everything [PLANNED] is unbuilt; invariants 1-3 have no enforcement yet.
- Webhooks and any accounting write (journal entries, invoice creation) are out of phase scope.
