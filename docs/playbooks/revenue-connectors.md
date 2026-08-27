# Playbook: Revenue connectors — shared lifecycle, gates and release semantics

> Last verified: 2026-08-27 against 28-26 (the provider gate plane: admission and live lane held
> apart as separate axes, plus the per-provider lane gate CLI), on top of 28-04's OAuth state and
> read transport and 28-03's credential envelope and four Phase 28 tables
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` · Related ADRs: none yet

> **Status: PARTLY IMPLEMENTED.** At the `Last verified` sha the Phase 28 code on disk is the
> readiness gate (28-17), the `@pikar/revenue` contracts (28-02), 28-03's credential envelope, the
> four connector tables and the credential adapter, and 28-04's shared OAuth-state and read-transport
> mechanics. Every item still marked **[PLANNED]** below is a *contract a later plan must satisfy*,
> not a claim that code exists — do
> not cite a [PLANNED] line as evidence that something works.
>
> **NO PROVIDER EXISTS YET AND NO LANE HAS PASSED.** 28-26 landed the machinery that *decides*
> whether a lane has passed and, run against the tree today, it says every lane is `pending`:
> `node scripts/check-provider-lane.mjs --all` is exit 0 with 13 pending rows and zero green lanes.
> There is no adapter, no OAuth callback route,
> no connections UI and no live read. What 28-03 and 28-04 delivered is the ability to *store a
> connector credential safely* and to *round-trip a consent and read a page under bounds* if a
> provider ever arrives — preconditions, not features. Nothing in 28-04 has ever spoken to a
> provider: every one of its 68 tests is offline against an injected `fetch` or a fake DB. All four
> open conditions from the admission decisions survive untouched.

## Purpose

Phase 28 gives a tenant read-only rails into their own HubSpot, QuickBooks, Stripe and PayPal
accounts so revenue workflows can reason over real business data. This playbook owns everything
**shared** across those providers: the encrypted credential envelope, the one-time OAuth state, the
bounded fetch helper, the connections surface, the provider-gate/lane status, revenue tool exposure,
telemetry, invoice-reminder containment, and the release semantics that decide when a provider — or
the phase — is done. Each provider's own auth quirks, endpoints and suitability record live in its
own playbook (`connector-hubspot.md`, `connector-quickbooks.md`, `connector-stripe.md`,
`connector-paypal.md`). CRM and finance orchestration live in `revenue-crm.md` and
`revenue-finance.md`.

This playbook does **not** own Phase 19's contact/consent/suppression store (`contacts-crm.md`),
Phase 27's skill/pack registry (`skill-registry.md`), the cockpit tool loop (`cockpit.md`), or
`convex/schema.ts`. Phase 28 consumes those; it does not deliver them.

## Key files

**Landed (28-17)**

- `scripts/check-phase28-readiness.mjs` — the offline readiness gate. 16 prerequisite rows over 91
  named symbols resolved from files on disk. `--self-check` proves each row can go red;
  `--inventory` regenerates the doc's interface table. Never hand-edit that inventory.
- `docs/connectors/phase28-readiness.md` — evidence and the single sealed go/no-go status, including
  the owner-attested `p25-production-posture` row under its explicit "no code checked this" heading.

**Landed (28-02, `d963bf3`) — pure package, no Convex imports, no model calls**

- `packages/revenue/src/contracts.ts` (+ `.test.ts`) — the frozen vocabulary every lane builds on:
  closed `PROVIDERS` / `SOURCE_AUTHORITIES` sets with `isProvider` / `isSourceAuthority` guards, the
  code-owned `CAPS` (page/item/byte/window/source), `Projection<T>` as
  `ready | partial | unavailable` with `validateProjection`, `SourceRef` + `validateSourceRef`
  (refs/ids only, straight **and** curly quotes guarded, per CLAUDE.md §4), `Money`,
  `Figure<V>`/`MoneyFigure`, `Coverage`, the closed `FINANCE_CONFIDENCES` set with
  `CONFIDENCE_RANK`, `DECISION_SUPPORT_NOTICE`, and the `Invoice`/`Payment`/`Obligation` shapes.
  **A capped read is `partial`, never `ready` — a prefix of reality is not a total.**
- `packages/revenue/src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts` — the package
  boundary.

**Landed (28-04) — shared mechanics, reused by every provider lane**

- `packages/backend/convex/connectorOAuth.ts` (+ `.test.ts`) — the consent round-trip. `STATE_TTL_MS`
  (10 min), `hashState`, `safeRedirectPath`, `CONNECT_RESULTS`/`callbackRedirectPath`,
  `PROVIDER_REVOKE_SUPPORT`, `classifyRevokeOutcome`, the `mintConnectState` tenantMutation, the
  `pendingConnectStates` tenantQuery (counts only) and the `consumeConnectState` internalMutation.
  **Neither public function accepts a `tenantId` and neither does the consume.**
- `packages/backend/convex/connectorFetch.ts` (+ `.test.ts`) — the bounded read transport.
  `PROVIDER_API_ORIGINS`, `PROVIDER_READ_PATHS`, `isAllowedRead`, `buildReadUrl`, `classifyStatus`,
  `retryDelayMs`, `readPages`, and the `READ_TIMEOUT_MS` / `MAX_RETRIES` / `MAX_RETRY_DELAY_MS`
  bounds. Declares **no Convex function at all** — it is transport an adapter action calls, and a
  source scan in its test keeps it that way.

**Landed (28-26) — the provider gate plane**

- `packages/revenue/src/contracts.ts` — `resolveProviderEligibility`, THE composite rule, plus the
  closed `ADMISSIONS` / `LANES` / `ELIGIBILITY_STATES` / `ELIGIBILITY_REASONS` sets and
  `PROVIDER_OPEN_CONDITIONS`. Pure, Convex-free; the read-path count is passed IN rather than
  imported, so the rule can never contradict `connectorFetch`'s allow-list.
- `packages/backend/convex/providerGates.ts` (+ `.test.ts`) — the thin adapter. `availableProviders`
  (tenantQuery, passed-only, provider+environment and nothing else), `inspectGate` / `sealGate`
  (ownerQuery/ownerMutation, CAS on `revision`), `gateEligibility` (internalQuery) and
  `recordLaneFailure` (internalMutation). **No tenant-callable write exists and a source scan in the
  test file fails if one appears.**
- `scripts/check-provider-lane.mjs` — the per-provider lane gate. `--provider`/`--all`,
  `--stage engineering|final`, `--json`, `--seal-decision pass|park|from-owner`, `--verify-gate`,
  `--self-test`. Every fact is read out of a file; nothing is retyped.

**Landed (28-03 Task 1) — pure package**

- `packages/revenue/src/credential.ts` (+ `.test.ts`) — the AES-256-GCM envelope AND the connection
  vocabulary. `importCredentialKey` fails closed on anything that is not exactly 32 decoded bytes;
  `sealCredential`/`openCredential` bind ciphertext to
  `keyVersion | environment | tenantId | provider | connectionId` as AAD, encoded as a JSON ARRAY so
  the binding is injective — a delimiter-joined string is forgeable across field boundaries
  (`tenant|a` + `b` and `tenant` + `a|b` join to the same bytes). Also the closed sets
  `CONNECTOR_ENVIRONMENTS`, `CREDENTIAL_KEY_VERSIONS` (`v1` live, `v2` RESERVED so a rotation needs
  no schema edit), `CONNECTION_STATUSES`, `REVOCATION_UPSTREAM_STATES` and
  `CONNECTION_FAILURE_CLASSES`. **It seals ONE blob, not one field per token** — that is what makes
  QuickBooks' rolling refresh survivable, because replacing both tokens is then a single-field patch
  inside one Convex transaction, and it keeps the scope string (a capability inventory) and the
  provider account id out of the clear.

**[PLANNED] — pure package**

- `packages/revenue/src/reminders.ts` — invoice-reminder draft shaping (REVN-06). No send.

**Landed (28-03 Task 2) — schema and the credential adapter**

- `packages/backend/convex/schema.ts` — the WHOLE Phase 28 schema, in one additive edit, because
  28-03 is the phase's single serialized owner of that file. Four NEW tables, no existing table or
  field altered, no backfill: `connectorConnections` (tenant × provider × environment, sealed
  credential + honest lifecycle), `connectorOAuthStates` (SHA-256 of a server nonce, consumed
  atomically), `contactProviderRefs` (a JOIN to Phase 19 contacts, never a second person store) and
  `providerGates` (deployment-wide, no `tenantId`). Also the four pre-declared `agentSteps.tool`
  revenue literals — see the cross-lane note under Operational notes.
- `packages/backend/convex/connectorCredentials.ts` (+ `.test.ts`) — the thin adapter.
  `requireCredentialKey` (fail-closed env read), `newConnectionId`, `hashExternalAccountId`, and
  the internal lifecycle `get` / `upsertSealed` / `acquireRefreshLease` / `commitRefresh` /
  `recordRevocation` / `recordReadOutcome`. EXACTLY ONE public function — `connectorStatuses`, a
  read — and a source scan in the test file fails if a public write builder ever appears here.
- `packages/core/src/tenantData.ts` — the four tables classified. `connectorConnections` and
  `connectorOAuthStates` are `tenant_credential`, `contactProviderRefs` is `tenant_owned`,
  `providerGates` is `global`. Bumped `audit-dead-letter.md` in the same commit.

**[PLANNED] — Convex adapters (thin, per CLAUDE.md §1)**

- `connectorOAuth.ts` — one-time `connectorOAuthStates` nonce, consumed atomically.
- `connectorFetch.ts` — bounded outbound fetch: allow-listed host and path, timeout, page cap.
- `connectorConnections.ts` — sanitized `ConnectionStatus` projection for the UI.
- `providerGates.ts` — per-provider `passed` / `parked` lane status read by tools and UI.
- `revenueTools.ts` — the read-only revenue tool surface exposed to the Executive Agent.
- `revenueTelemetry.ts` — refs, counts and status outcomes only.
- `invoiceReminders.ts` — stages an ordinary plan. No provider write, no send.

**[PLANNED] — gates and evidence**

- `scripts/check-provider-lane.mjs` — machine-readable lane status.
- `scripts/check-phase28-completion.mjs` — the full-phase completion gate (see Release semantics).
**Landed — the admission register (28-01 Task 1)**

- `docs/connectors/README.md` — the register: decision vocabulary, marker format, evidence-expiry
  policy, and the rule that `.mcp.json` is evidence of nothing.
- `docs/connectors/{hubspot,quickbooks,stripe,paypal}-suitability.md` — one evidence record each,
  carrying **both** evidence dates (2026-08-05 research, 2026-08-27 re-verification), an explicit
  verified/could-not-verify split, and the one owner question no vendor doc can answer.
- **All four decisions are `approved_production` as of 2026-08-27** (28-01 Task 3) — every lane is
  admitted for build *and* production exposure. Read the current state with
  `grep -h '^decision:' docs/connectors/*-suitability.md`, never from prose.
- **Three of the four do not rest on evidence.** HubSpot is evidence-consistent. **Stripe is an owner
  OVERRIDE against its own record** (platform-initiated revocation is undocumented and the condition
  is still open — 28-24). **QuickBooks and PayPal rest on owner ATTESTATIONS** of external vendor
  approvals (live Intuit production credentials; PayPal partner acceptance with a partner manager)
  that nothing here can check. Never restate an attestation as a verified fact.
- **Approval is permission to start, not a `passed` lane.** All four open conditions survive —
  HubSpot's revoke-cascade test (28-05/28-22), Stripe's revocation story (28-24), QuickBooks' unstated
  partner tier + mandatory GET-only allow-list (28-06/28-23), PayPal's absent revoke endpoint and
  non-probative sandbox (28-25). A partial release still completes no REVN requirement.

## Dependencies & blast radius

Run `graphify query "revenue connectors"` for the current subgraph. Couplings graphify cannot see:

- **Deployment secret** `CONNECTOR_CREDENTIAL_KEY_V1` — base64 32-byte key, Convex environment only.
  Missing credentials **THROW** (the `requireEnv` idiom). A connector that degrades to a dev default
  is exactly what `p25-no-dev-fallback` in the readiness gate forbids.
- **Readiness gate** — every Phase 28 plan runs `node scripts/check-phase28-readiness.mjs` FIRST.
  Exit 1 means stop, not shim. Setting `phase25_production_posture: block` in the attestation
  comment re-blocks every dependent plan in one edit.
- **Phase 19 seam** — `convex/contacts.ts` is the only person/consent/suppression/follow-up store.
  Provider refs attach to it. There is no second CRM and no local opportunity/stage/deal-value table.
- **Phase 27 seam** — `workflowPackEvents` plus `core/workflowPackMetrics.ts` is the event contract.
  Cost and latency are READ from `spendEvents`/`telemetry`, never re-emitted. There is no sixth plane.
- **Leaf-agent constraint** — `runAgentLoop` sets `grantDispatch: toolNames === undefined`, so a pack
  carrying a static tool grant structurally cannot dispatch a specialist. Compose in the Executive
  Agent instead.
- **External services** — the four provider APIs. Each has its own rate, pagination and verification
  posture; that lives in the provider playbook, not here.

## Data flow

1. Owner starts a connection from the Connections surface (`dashboard/profile/`, owned by
   `onboarding.md`) — provider authorize URL carrying a fresh one-time state nonce.
2. Provider redirects to `convex/http.ts` (owned by `cockpit.md`) and into the provider callback.
3. The handler **validates and consumes state before token exchange**, exchanges the code
   server-side, verifies the returned provider account/realm belongs to the intended connection,
   seals the credential, persists it, writes a refs/status-only audit event, and redirects with **no**
   `code`, `state` or `token` query parameters.
4. A workflow calls a provider read action, which goes through `connectorFetch` (allow-listed host
   and path, bounded pages), and the provider adapter normalizes a bounded projection.
5. The projection carries provider, coverage window, retrieval time, partial/capped state and source
   refs. Raw vendor payloads are discarded at the adapter boundary.
6. Deterministic math runs in `packages/revenue` (see `revenue-finance.md`). The model receives
   computed results, never operands it is expected to calculate.
7. Outcomes land in `revenueTelemetry` as refs, counts and status only.
8. Disconnect: provider revoke/deauthorize **first**, local encrypted row delete **second**. A
   network or 5xx failure yields an honest partial-revoke state and a retry path, never a silent
   success.

## Invariants — what must never break

1. **Read-only.** No write, refund, credit, dispute, journal-entry or CRM-mutation endpoint is
   reachable from any adapter export or specialist grant. *Enforced by:* the `read-only` row of
   `scripts/check-provider-lane.mjs`, which scans every provider LANE module for `POST`/`PUT`/
   `PATCH`/`DELETE` and for a direct `fetch(` outside `connectorFetch` — LANDED, 28-26. It scans
   lane modules only: `connectorOAuth.ts` legitimately POSTs a token exchange and a revoke. The row
   is `pending` for a provider with no lane module yet, which is all four today, so the scan has
   nothing to bite on until wave 6 — it is armed, not yet exercised on real code.
2. **Tenant isolation.** Credentials are sealed with AAD binding
   `tenantId | provider | connectionId | environment | keyVersion`. Copying ciphertext to another
   tenant or provider must fail authentication. *Enforced by:* `credential.test.ts` (one case per
   AAD component) and `connectorCredentials.test.ts` (two tenants over real `users` rows, plus a
   plaintext-sentinel scan of the stored row and the client projection) — LANDED, 28-03.
3. **No public secret write.** Only provider callback handlers create or replace an envelope. Public
   queries return a sanitized `ConnectionStatus` — never ciphertext, IV, external account id, scopes,
   tokens, or provider errors that may embed secrets.
4. **Refs-only audit and telemetry.** Per CLAUDE.md §4, `audit.payload`, `deadLetters.payload` and
   all revenue telemetry carry refs, hashes, ids and counts ONLY — no amounts, names, message bodies
   or raw provider data.
5. **No raw payload storage.** Vendor response shapes stop at the adapter. Nothing arbitrary reaches
   a prompt, a React component or a stored row.
6. **Source authority.** Every projection names its provider, coverage window, retrieval time and
   partial/capped state. Missing history is **unknown**, never zero, and never silently merged across
   providers in a way that could double-count.
7. **Fail closed on missing credentials.** Throw, per the `requireEnv` idiom. No dev default, ever.
8. **One-time OAuth state.** State is a 32-byte CSPRNG nonce stored only as its SHA-256, bound to
   tenant + provider + environment + connectionId + redirectPath at mint, expiring in
   `STATE_TTL_MS`, and burned atomically **before** the code exchange. HMAC binding alone prevents
   tenant tampering but **not** callback replay, which is why the two pre-existing HMAC states
   (`gmailAuth`, `microsoftAuth`) were not the pattern copied here. A refusal returns a bare reason
   and **no tenantId, connectionId or redirectPath**, so "zero exchange, zero store" does not depend
   on the caller checking `ok`. *Enforced by:* `connectorOAuth.test.ts`, each of the five guards
   observed refusing alone — LANDED, 28-04.
9. **Suppression is checked twice, not three times.** `cockpit.executePlan` per-recipient before the
   group join, and `gmail.prepareGovernedMessage` at the wire. REVN-06 must not add a third check.
10. **Independent lanes.** A provider lane resolves to `passed` or `parked` on its own evidence. One
    parked provider must not block release of an already-proven provider or workflow subset.
11. **The LLM explains, it does not compute.** No financial formula in a skill body; no model-supplied
    figure stored or rendered as if the tenant stated it.
12. **"We deleted our copy" is never rendered as "the grant is revoked."** For at least THREE of the
    four admitted providers, local credential deletion may be the only revocation Pikar can actually
    perform: Stripe Apps has no documented platform-initiated revoke (owner override, condition
    open), PayPal documents no revocation endpoint anywhere, and HubSpot's revoke is unproven
    against already-issued ACCESS tokens. Only QuickBooks is confirmed. `revocation.upstream` is
    therefore a four-value enum — `confirmed` / `attempted_failed` / `unsupported` /
    `not_attempted` — and a boolean `revoked` flag must never be reintroduced. *Enforced by:*
    `connectorCredentials.test.ts` ("an UNSUPPORTED upstream revoke never reads as a confirmed
    one"), mutation-verified by forcing `upstream` to `confirmed` and observing red — LANDED, 28-03.
13. **Refresh is single-flight AND fenced.** Intuit may revoke the token a successful refresh issued
    when a second refresh races it, so a racing refresh does not merely fail — it can kill the
    connection and force re-consent. `acquireRefreshLease` stops a concurrent refresher from
    starting; `revision` is the compare-and-set FENCE that stops one which already started, slept
    past its lease and came back stale. Both are required: the lease alone is a lock that lies.
    *Enforced by:* `connectorCredentials.test.ts` — and read the note in
    "the FENCE refuses a stale revision even when the lease check would pass" before touching
    either guard, because the first version of that test proved the wrong thing.
14. **A provider read cannot be steered, and a bounded read is never a complete one.** `readPages`
    takes a provider, an environment and a path from `PROVIDER_READ_PATHS` — there is no method,
    origin, host, header or body parameter to point somewhere else, the verb is a hardcoded `GET`,
    and `redirect: "error"` refuses to replay the bearer at an origin the provider named. Every
    stop short of the provider's own end-of-list (page/item/byte cap, repeated cursor, 4xx, 5xx,
    network, timeout, malformed JSON) yields `partial: true` with the pages already read intact.
    **A cap is never an empty success and never a zero.** *Enforced by:* `connectorFetch.test.ts`,
    each cap constructed so only that one guard can fire, mutation-verified by off-by-one on the
    caps and rename on the status/header/path literals — LANDED, 28-04.

15. **An admission is never a passed lane, and one flag can never mean both.** `providerGates`
    keeps `admission` (the owner's decision) and `lane` (an observed live gate) as separate fields,
    and `resolveProviderEligibility` is the only place they are combined. Do not add a convenience
    boolean, do not let a UI derive availability from `admission`, and do not let any tool read the
    stored `lane` directly — read the passed-only projection. *Enforced by:*
    `providerGates.test.ts` (24 cases, including a source scan that fails if the projection ever
    mentions `lane`) and `contracts.test.ts` — LANDED, 28-26.

## Release semantics — passed / parked / subset / complete

These four states are deliberately distinct. Conflating them is how a partial rollout gets recorded
as a finished phase.

| State | Meaning | Decided by | Effect |
|---|---|---|---|
| **lane `passed`** | One provider holds a current suitability decision **and** a controlled live read/revoke gate observed green. | `resolveProviderEligibility` over the `providerGates` row; `scripts/check-provider-lane.mjs` over the tree — LANDED, 28-26 | That provider may appear in the product. |
| **lane `parked`** | Blocked, deferred, or evidence missing/expired. | same | Provider hidden; dependents report unknown coverage, not zero. |
| **subset release** | At least one lane `passed` and its workflows shipped. | owner | Users get value. **This is NOT phase completion.** |
| **phase complete** | REVN-01, REVN-02 and REVN-03 each require *every* provider they name to hold a current production-suitability decision and a `passed` live read/revoke gate. | `scripts/check-phase28-completion.mjs` [PLANNED] | Only then may Phase 28 be closed. |

A suitability record carries an owner, a review date, evidence links, a decision
(`approved_beta` | `approved_production` | `blocked` | `deferred`) and an expiry/re-review trigger.
Code may be written against a sandbox after `approved_beta`; navigation and discovery require the
production decision. **An expired record is `parked`, not `passed`.**

### The two axes — admission is not a passed lane

`providerGates` carries **two** fields and they answer different questions. This is the single most
important thing in this playbook to not undo.

| Axis | Field | Means | Set by |
|---|---|---|---|
| **Admission** | `admission` | The owner's suitability DECISION: engineering and production exposure are *permitted*. Mirrors the `decision:` marker in the record. | An owner judgment, sealed with `sealGate` |
| **Live gate** | `lane` | Whether a controlled live read/revoke was actually OBSERVED green. | 28-22..25, sealed with live evidence |

On 2026-08-27 all four providers were admitted `approved_production` and **not one lane has ever
run**; three of those four admissions rest on owner testimony rather than evidence. If the two ever
collapsed into one flag, the wave-7 seals would be decorative and a provider would go discoverable on
a say-so. **`approved_production` + `lane: parked` is the normal state for most of this phase.**

**The composite rule** (`resolveProviderEligibility`, and nothing else may re-derive it) — a provider
is available only when EVERY one of these holds, and a refusal names each axis that refused:

1. a gate record exists (no row is `pending`, never `passed` — a missing row IS `undecided`);
2. `lane === "passed"` (a `failed` lane short-circuits to `failed`; a failure outranks expiry);
3. `reviewBy > now` (resolved against the clock, never stored — an expired record is `expired`);
4. the admission permits that environment (`approved_production` for production; `approved_beta`
   reaches sandbox only);
5. the provider has at least one allow-listed read path — **this is why Stripe cannot be made
   available today whatever the owner approved**: `PROVIDER_READ_PATHS.stripe` is `[]` by decision;
6. every entry in `PROVIDER_OPEN_CONDITIONS[provider]` appears in the row's `clearedConditions`.

Rule 6 is what makes the four surviving admission conditions load-bearing rather than advisory:
28-22..25 each own exactly one, and `sealGate` refuses a `passed` lane until it is named with
evidence. **A seal to `passed` is validated by running the same resolver the readers run**, so a pass
can never be recorded that a reader would then refuse.

`parking is never blocked.` A refusal must always be recordable, or a lane discovered to be broken
could not be shut off. `recordLaneFailure` likewise carries **no** compare-and-set — refusing to
record a failure because the revision moved would leave a known-broken lane readable — but it does
bump `revision`, so an owner seal already in flight fails rather than resurrecting the lane.

### The lane gate CLI — `scripts/check-provider-lane.mjs`

Three row statuses, because "not built yet" and "wrong" are different facts: `green`, `pending`
(nothing is wrong, the thing does not exist yet) and `red` (an inconsistency). Exit 0 = no red. At
`--stage final` a `pending` IS red, because final means "this lane claims to be passed".

| Row | Red when |
|---|---|
| `decision` | the marker will not parse, names another provider, carries a value outside the closed vocabulary, or records a decision with no date |
| `evidence-life` | `review_by` has passed — 90 days is the maximum evidence life |
| `absence` | a `blocked`/`deferred`/`undecided` provider nonetheless has a lane module |
| `adapter` | (final only) an admitted provider has no lane module |
| `read-only` | a lane module contains `POST`/`PUT`/`PATCH`/`DELETE` or a direct `fetch(` — **this is invariant 1's enforcement** |
| `allow-list` | a lane module exists over an empty read allow-list, or the provider has no `PROVIDER_READ_PATHS` entry at all |
| `open-conditions` | the register and `PROVIDER_OPEN_CONDITIONS` disagree about which conditions survive or which plan owes them |
| `parity` | the register, `PROVIDERS` and the `providerGates` schema literals do not name the same four providers |

Seal modes, and the one that matters:

- `--seal-decision from-owner` reads the record's marker and resolves **deterministically to
  `park`, always**. An admission is permission to start; turning it into a `passed` lane here would
  be exactly the laundering of testimony into observation the register exists to prevent. An
  `undecided` record is refused outright — there is no judgment to seal.
- `--seal-decision park` is always available.
- `--seal-decision pass` requires `--evidence <ref>` from a live gate, a `--clear-condition <id>` for
  every open condition, and a fully green `--stage final`. Today it refuses for all four providers.
- Neither applies anything without `--apply`; the default prints the payload.

`--self-test` mutates the tree in memory and requires every row to be observed going RED, then
re-runs the real tree to prove the baseline is clean, then walks every seal combination — including
one that MUST resolve to `pass`, because a gate that refuses everything is broken rather than safe.
`--verify-gate` runs the real `providerGates` behaviour tests rather than grepping for the branch
that is supposed to disable a failed lane; a source tripwire proves spelling, not validity.

## Shared connector mechanics — what a provider lane reuses, and what it must NOT

28-04 generalised exactly two things: the consent round-trip (`connectorOAuth.ts`) and the read
transport (`connectorFetch.ts`). Both are **security mechanics, not a connector runtime.** There is
no plugin registry, no provider-agnostic client and no config table. A provider lane (28-05..28-08)
is expected to be a small module that calls into these and keeps everything else to itself.

### State lifecycle

`mintConnectState` (tenantMutation) -> provider consent -> `consumeConnectState` (internalMutation).

- The nonce is 32 CSPRNG bytes, base64url, returned to the caller **once** and never stored. Only
  its SHA-256 lands in `connectorOAuthStates.stateHash`, so a database read yields nothing a
  callback could present.
- The row fixes `tenantId`, `provider`, `environment`, `connectionId` and `redirectPath` at mint.
  `connectionId` is minted **before** the redirect, so the credential AAD tuple exists before any
  token does and a callback cannot choose which connection its tokens get sealed into.
- `expiresAt = now + STATE_TTL_MS` (10 minutes: a consent screen plus a slow login, nothing more).
- Consume burns the row by setting `usedAt` inside the same Convex mutation that read it. **The
  atomicity is the platform's serializable transaction** — do not add a lease, a CAS column or a
  "check then act" query in front of it. That is why consuming is a mutation, not a query the
  callback action inspects first.
- A **refusal does not burn the row.** A wrong-provider or wrong-environment probe against a state a
  user is legitimately mid-consent with must not strand their real connect.

### Callback ordering — this order is the contract

1. `consumeConnectState({ state, provider, environment })`. If `ok` is false, STOP: no exchange, no
   store, redirect with the mapped result.
2. Exchange the code (provider-specific, in the provider's own module).
3. Verify the external account and bind it (below).
4. Seal the credential with `connectorCredentials` under the `connectionId` the state carried.
5. Redirect via `callbackRedirectPath`.

Step 1 before step 2 is the whole point: a replayed, expired, grafted or cross-provider callback
must perform **zero** external calls and **zero** writes. `consumeConnectState` takes **no
`tenantId` argument** — the tenant is read out of the row. Adding one would reopen tenant grafting
for an attacker who completes their own consent.

### Redirect hygiene

- `safeRedirectPath` is a **character allow-list**, not a blocklist of known tricks (`//host`,
  `/\host`, `%2f%2f`, a `\n` header injection and a `user@host` authority are each their own bypass
  of a blocklist, and the next one is not invented yet). Anything not matching the unreserved-plus-
  slash pattern, longer than 128 chars, or containing `..` becomes `DEFAULT_REDIRECT_PATH`.
- It runs at mint **and** again on the way out of consume. A defence that only runs at the write is
  one migration away from not running at all.
- The `Location` carries the provider name and one member of `CONNECT_RESULTS` and nothing else. A
  provider error string is **never** echoed, so a code, a token or a customer name can never reach
  browser history or a referrer header (CLAUDE.md 4). An unrecognised result degrades to
  `unavailable` rather than being passed through.

### Account binding

The connection is scoped by the server-minted `connectionId` from the mint, never by an id the
callback supplies. The provider's own account id is stored **hashed**
(`connectorCredentials.hashExternalAccountId`) so a reconnect can be recognised as the same account
without the raw id sitting in a row. A callback whose verified account does not match an existing
binding is `account_mismatch` — a terminal, not a silent re-seal over someone else's grant.

### Refresh — deliberately NOT shared

`connectorCredentials` provides `acquireRefreshLease` (stops a concurrent refresher starting) and
the `revision` compare-and-set fence (stops one that already started, slept past its lease and came
back stale). **Both are required; the lease alone is a lock that lies.** But the *policy* stays per
provider: QuickBooks rotates its refresh token and Intuit may revoke the token a successful refresh
issued when a second refresh races it, so a racing refresh there does not merely fail — it can kill
the connection and force re-consent. The other three must not inherit that shape by assumption.
**Do not hoist a shared refresh routine until two concrete implementations justify it.**

### The endpoint allow-list

`PROVIDER_READ_PATHS` is the containment boundary, and for QuickBooks it is the *only* one: the
`com.intuit.quickbooks.accounting` scope grants writes, Intuit publishes no read-only alternative
and will not constrain it, so a stolen live token has full Accounting-API write reach and nothing
vendor-side stops it. Rules for extending the table:

- The path must be a **documented read** in that provider's suitability record.
- List it **whole**. Matching is segment-by-segment equality; `{}` is a placeholder for exactly one
  non-empty segment and cannot swallow a `/`. Never introduce a prefix, a substring or an `includes`
  match — a rename mutation walks straight through those and this repo has shipped that defect.
- **QuickBooks stays inside `query` and `reports`.** Every other Accounting-API path has a write
  sibling reachable with the same token.
- `PROVIDER_READ_PATHS.stripe` is `[]` **by decision, not by omission** — the Stripe route is an
  unbuilt Stripe App with `*_read` permissions and its server-initiated revocation condition is
  still open. 28-07 lands its paths when the route is settled. Until then Stripe reads nothing and
  fails closed.
- Adding an entry is a **security change**: it needs the same review as a scope change, not a
  drive-by edit.

### Retry and partial semantics

| Situation | Class | Retried? | Result |
|---|---|---|---|
| 401 | `reauth` | no — the same dead token returns the same 401 | `partial` |
| 403 | `forbidden` | no | `partial` |
| 429 | `rate_limited` | only if `Retry-After` fits `MAX_RETRY_DELAY_MS` | `partial` if it does not |
| 5xx | `provider_error` | yes, up to `MAX_RETRIES` **per read** | `partial` on exhaustion |
| 3xx | `provider_error` | no — a redirect is refused, never followed | `partial` |
| other 4xx | `provider_error` | no | `partial` |
| network throw | `network` | yes | `partial` |
| abort / timeout | `timeout` | **no** — the attempt already spent the whole budget | `partial` |
| malformed JSON | `provider_error` | no | `partial`, pages that parsed are kept |
| page/item/byte cap, repeated cursor | — | — | `partial` **and** `capped` |

- A `Retry-After` **longer** than the budget means STOP, not "retry sooner". Intuit documents "wait
  60 s" on a 429; an action cannot sleep that long and calling back inside the provider's stated
  window is how a rate limit becomes a suspension. An unparseable (HTTP-date) value falls back to
  backoff, never to zero.
- **Pages already read are never discarded.** A 500 on page three returns pages one and two.
- `partial` is `stoppedBy !== null`; `capped` is a code-owned bound firing rather than the provider
  failing. Both feed Invariant 6: a projection built from a partial read reports honest coverage.
  **Missing history is unknown, never zero** — a capped receivables read presented as complete would
  silently understate what a tenant is owed.
- Only the closed `ConnectionFailureClass` leaves the transport. Vendor text can embed a customer
  name or an invoice memo, so it stops there — the module contains no `console.*` and no reach into
  audit, telemetry or dead letters, and a source scan keeps it that way.

### The rule for any FURTHER shared abstraction

**Two concrete implementations must exist and be shown to need the same thing before anything else
is hoisted here.** `connectorOAuth.ts` earned its place because `gmailAuth.ts` and
`microsoftAuth.ts` had already written the same round-trip twice and it got weaker the second time.
Nothing else has cleared that bar. In particular: no shared refresh routine, no shared account
verifier, no shared normalizer and no provider-config table. A lane that "just needs one more
parameter" on a shared helper is telling you it should have kept its own copy.

### Diagnostics — status and counts only

| Question | How | What comes back |
|---|---|---|
| Are consents in flight for this tenant? | `connectorOAuth.pendingConnectStates` (tenantQuery) | `{ provider, environment, pending }` per provider. **No hash, no nonce, no connection id** — nothing a support session could paste into a callback. |
| What state is a connection in? | the `connectorCredentials` sanitized projection | `ConnectionStatus`, `lastFailureClass`, `revocation.upstream`. Never ciphertext, IV, external account id, scopes or tokens. |
| Why did the last read stop? | the caller's `ReadPagesResult.stoppedBy` | a cap reason or a `ConnectionFailureClass` — never the provider's message body. |
| Can this provider be revoked upstream? | `PROVIDER_REVOKE_SUPPORT` | `confirmed` (QuickBooks only) / `unproven` / `unsupported`. Read Invariant 12 before writing any UI copy. |

## Credential key operations — setup, rotation, loss

Everything below concerns `CONNECTOR_CREDENTIAL_KEY_V1`, the base64-encoded 32-byte AES-256-GCM key
that seals every connector credential. **No command here prints the key**, and none should be added
that does: a key echoed into a terminal is a key in a scrollback buffer, a screen share and a shell
history file.

### Generating and installing it

Generate 32 random bytes and pipe them straight into Convex environment configuration — never into
a file, a clipboard step or a `console.log`:

```bash
# From packages/backend. The value is written to the deployment and never displayed.
npx convex env set CONNECTOR_CREDENTIAL_KEY_V1 "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
```

**Validate WITHOUT printing.** The only correct check is a decode-and-length check whose output is a
verdict, not the material:

```bash
npx convex env get CONNECTOR_CREDENTIAL_KEY_V1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=Buffer.from(s.trim(),"base64");console.log(b.length===32?"OK: 32 bytes":`BAD: ${b.length} bytes`)})'
```

`importCredentialKey` performs the same check at runtime and THROWS on anything that is not exactly
32 decoded bytes, so a 16-byte key cannot silently become AES-128.

**Environment names.** `CONNECTOR_CREDENTIAL_KEY_V1` today; `CONNECTOR_CREDENTIAL_KEY_V2` is read by
`requireCredentialKey("v2")` and exists only for rotation. Set on the DEPLOYMENT (`npx convex env
set`), not in `.env.local` — a Convex function reads the deployment's environment, and this has
caught people out here before.

**Missing key = THROW.** `requireCredentialKey` fails closed with
`Connector credential key not configured: CONNECTOR_CREDENTIAL_KEY_V1`. There is no development
default and there must never be one: `p25-no-dev-fallback` in the readiness gate exists to forbid
exactly that, because a connector that falls back to a dev key writes rows that look encrypted and
are not, and nobody finds out until someone reads the database.

### Rotating the key

The envelope binds its `keyVersion` into the AAD, so a row cannot be relabelled onto another key —
rotation is a real re-seal, per row, and both keys must be live while it runs.

1. **Set the new key alongside the old.** `npx convex env set CONNECTOR_CREDENTIAL_KEY_V2 ...`.
   **Do not remove V1.** Every row at rest is still sealed under it.
2. **Re-seal row by row, with the fence.** For each connection: take the refresh lease
   (`acquireRefreshLease`), read `revision`, `openCredential` with the v1 key, `sealCredential` with
   the v2 key **for the same scope tuple**, then `commitRefresh` with the revision read in step 2.
   The CAS refuses if anything else moved the row meanwhile — a rotation must never clobber a
   credential a live refresh just replaced.
3. **Read back before believing it.** Re-open each rotated row with the v2 key and compare. A
   rotation that reports success without a read-back has proven nothing.
4. **Retain V1 until every row is proven.** A row still carrying `keyVersion: "v1"` is unreadable
   the moment V1 is removed. Query for stragglers before retiring the old key, not after.
5. **Then, and only then**, unset `CONNECTOR_CREDENTIAL_KEY_V1`.

To roll a rotation BACK mid-flight: stop re-sealing and leave both keys set. Mixed-version rows are
a supported state — `openCredential` selects the key by the row's own `keyVersion` — so a paused
rotation is not an outage.

### If the key is lost

**It is irrecoverable. There is no escrow, no backup and no recovery path.** Every
`credentialCiphertextB64` sealed under the lost version becomes permanently unreadable. That is the
intended property, not a gap.

Recovery is re-consent, not decryption:

1. Set a fresh key under the NEXT version.
2. Mark the affected connections `failed` (or `reauth_required`) so the UI stops implying a working
   connection. Do **not** mark them `revoked` — nothing was revoked, and Invariant 12 forbids
   saying so.
3. Each tenant reconnects through the normal OAuth flow, which writes a new envelope.
4. The unreadable ciphertext is dead weight, not a secret; it is cleared by the next
   `upsertSealed` on that row.

Note what is NOT lost: `provider`, `status`, `connectedAt`, `revocation` and the whole lifecycle
history are plaintext metadata by design, so the connections surface can still tell each user the
truth about what happened.

### Disconnect: revoke first, delete second — and say which one worked

The order is provider revoke/deauthorize FIRST, local clear SECOND, matching the Google
privacy-control invariant. The local clear runs **even when the provider refuses**, because
leaving a crown-jewel credential at rest in a database where nothing honours it is strictly worse.

What `recordRevocation` must be passed is **what the caller observed**, never what it hoped:

| Situation | `upstream` | What the UI must say |
|---|---|---|
| Provider's revoke endpoint returned success (or an already-invalid 4xx) | `confirmed` | Disconnected and revoked. |
| Called it, got a network error or 5xx | `attempted_failed` | Disconnected here. We could not confirm with the provider — retry available. |
| Provider documents no revocation call we can make | `unsupported` | Disconnected here. Your grant stays active at the provider until you remove it there. |
| Nothing was called (internal cleanup, erasure sweep) | `not_attempted` | Removed. |

**As of the 2026-08-27 admissions, `unsupported` is the honest answer for PayPal and — pending
28-24 — for Stripe Apps, and HubSpot may need `residualAccessUntil` because its revoke is unproven
against already-issued ACCESS tokens.** Only QuickBooks is confirmed. A future plan that finds a
working revoke for one of them changes the VALUE passed here; it does not get to change the enum
into a boolean.

**Partial revoke is a terminal state with a retry, not a silent success.** A row left at
`attempted_failed` keeps its cleared ciphertext (nothing is usable) and its retry affordance. Do not
"resolve" it by flipping it to `confirmed` without a successful provider call.

### This does NOT touch the existing Google or Microsoft tokens

`gmailTokens` and `microsoftCalendarTokens` are UNCHANGED by Phase 28 — same tables, same plaintext
columns, same modules. Nothing here migrates, re-seals, reads or deletes them, and
`CONNECTOR_CREDENTIAL_KEY_V1` has no bearing on Gmail, Calendar, Drive or Outlook. Setting or
losing the connector key cannot affect mail delivery.

Bringing those two grants under this envelope would be a real migration with a real rollback plan
and its own owner decision. It is not in this phase, and this playbook must not be read as
implying it happened.

## Rollback

- **Per provider (fast, no deploy):** park the lane — set that provider's suitability decision to
  `blocked` or `deferred`. `providerGates` hides the provider, its tools drop out of the grant, and
  dependent workflows report unknown coverage. Other lanes are unaffected.
- **Per tenant:** disconnect (provider revoke first, local clear second). A partial-revoke state is
  an honest terminal with a retry, not a retryable no-op — and for PayPal and Stripe Apps the
  honest terminal is `unsupported`, meaning the grant stays live at the provider. See
  "Credential key operations → Disconnect" for the exact enum value each situation takes.
- **Rolling back THIS plan's schema:** you cannot un-add a Convex table by reverting the file — a
  deployed schema with rows in it is data. The rollback is behavioural: park all four lanes so
  nothing writes, and leave the empty tables in place. They cost nothing and no code reads them
  when every lane is parked.
- **Whole phase:** set `phase25_production_posture: block` in the readiness attestation comment —
  one edit re-blocks every dependent plan. Then park all four lanes.
- **Key rotation** (not a rollback, but the same discipline): decrypt with the old key version,
  reseal with the new, CAS on the original row, and retain the old key until verification completes.
  Full procedure, including the read-back step and what happens if the key is lost, is under
  "Credential key operations" above.

## How to change safely

- **Adding a provider:** new suitability record, new playbook, new `watch.json` entry. Do not widen
  an existing provider prefix to cover it.
- **Adding a scope:** read-only is the phase boundary. A write scope needs a separate plan and a new
  approval-path analysis — not a scope-string edit.
- **Sharing refresh logic:** do not, until two concrete implementations justify it. QuickBooks'
  rotating refresh token needs a per-row lease/CAS that the other providers must not inherit.
- **Touching `schema.ts`, `http.ts`, `specialists.ts` or the Connections UI:** these are the
  highest-collision files, each with one serialized plan owner, and they belong to *other* playbooks.
  Bump the owning playbook's `Last verified` in the same commit.

## How to verify

| Command | What it proves | Needs |
|---|---|---|
| `node scripts/check-phase28-readiness.mjs` | The 16 prerequisite rows are still green. Exit 0 is required before any Phase 28 work. | offline |
| `node scripts/check-phase28-readiness.mjs --self-check` | The gate can still go red (delete plus rename mutations). | offline |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | Watch coverage. **Read stdout, not the exit code — see Operational notes.** | git repo |
| `cd packages/revenue && pnpm vitest run` | Contract, money, finance AND credential-envelope logic. 104 tests. | offline |
| `cd packages/revenue && npx tsc --noEmit` | **Run this SEPARATELY.** Vitest transpiles without typechecking; 104 green tests sat over 4 real `ArrayBuffer`-generic errors here. | offline |
| `cd packages/backend && pnpm vitest run connectorCredentials` | Two-tenant isolation, plaintext-sentinel scan, lease/CAS, revocation honesty. 30 tests. | offline |
| `cd packages/backend && npx vitest run convex/connectorOAuth.test.ts` | Replay, expiry, wrong-tenant, wrong-provider and wrong-environment states each perform zero exchange and zero store, observed refusing alone. 30 tests. | offline |
| `cd packages/backend && npx vitest run convex/connectorFetch.test.ts` | The allow-list refuses relocation, each cap fires on its own, a later failure keeps earlier pages, and no token or vendor body escapes. 38 tests. | offline |
| `cd packages/backend && pnpm vitest run isolation traceParity tenantDelete tenantExport` | The four derived gates a new table or a new tool literal must satisfy. | offline |
| `cd packages/backend && npx tsc --noEmit` | Same reason as above — it caught an untyped validator getter this suite was green over. | offline |
| `node scripts/smoke-<provider>-read.mjs` [PLANNED] | Controlled live read and revoke for one lane. | live creds |
| `cd packages/backend && npx vitest run convex/providerGates.test.ts` | The two axes stay apart: an admitted provider with an unrun lane is unavailable, a seal cannot invent a pass, expiry and live-refresh failure each empty the projection, two tenants read the same thing and neither can write. 24 tests. | offline |
| `node scripts/check-provider-lane.mjs --all` | No lane contradicts its record. Exit 0 today with 13 pending rows. **Consistent is not passed.** | offline |
| `node scripts/check-provider-lane.mjs --self-test` | Every row observed going RED under a rename/substitution mutation, the real tree clean, and every seal combination — including the one that must resolve to `pass`. | offline |
| `node scripts/check-provider-lane.mjs --verify-gate` | Runs the gate behaviour tests directly, rather than grepping for the branch. | offline |
| `node scripts/check-phase28-completion.mjs` [PLANNED] | All lanes `passed` — the only proof of phase completion. | offline |

## Operational notes

- **`scripts/check-playbooks.mjs` always exits 0.** It is a Claude Code hook: it signals a violation
  by printing `{"decision":"block","reason":...}` on **stdout**, and it reads its input from stdin, so
  running it bare hangs forever. Verify it with `echo '{}' | node scripts/check-playbooks.mjs check`
  and grep stdout for `"decision":"block"`. Treating its exit code as a gate is a no-op that reads
  green. This was observed directly while registering this playbook (28-18).
- It keeps an acknowledgment file at `.git/claude-playbooks-ack.json`. Touching a playbook alongside
  its watched files blesses that exact file state; any further edit to those files re-triggers.
- **Cross-lane playbook touches.** Several Phase 28 plans change files owned by playbooks *outside*
  Phase 28 and must bump those playbooks' `Last verified` in the same commit:
  28-09 → `cockpit.md` (`http.ts`) and `onboarding.md` (`dashboard/profile/`);
  28-12 → `growth-diagnostic.md` (`specialists.ts`) and `skill-registry.md` (`contracts/src/skill.ts`);
  28-13 → `cockpit.md` (`llm.ts`); 28-14 and 28-28 → `skill-registry.md`;
  28-16 → `cockpit.md`; 28-21 and 28-29 → every provider/CRM/finance playbook they touch, plus
  `cockpit.md`.
- **`packages/backend/convex/schema.ts` is watched by no playbook.** That is a pre-existing repo gap,
  not a Phase 28 decision. 28-03 is the single serialized schema owner for this phase's CONNECTOR
  tables — see Known gaps for the one edit it deliberately left to 28-14.
- **Adding a table costs three edits, not one**, and two of them are in other playbooks' files.
  `isolation.test.ts` derives its coverage from the runtime schema in BOTH directions, so a new
  table must also be classified in `packages/core/src/tenantData.ts` (bump `audit-dead-letter.md`),
  and any index that does not lead with `tenantId` must be registered in `NON_TENANT_LEADING` with
  the consumer that makes it safe. `connectorOAuthStates.by_state` is there because an OAuth
  callback arrives with a nonce and no tenant at all. A `tenant_owned`/`tenant_credential` table
  also needs a bare `by_tenant` index or the backend does not typecheck — `tenantDelete.ts` calls
  `.withIndex("by_tenant", ...)` on every name `deletableTables()` returns.
- **A green vitest run is not a typecheck, and this plan hit it twice.** Vitest transpiles without
  checking types: 104 green revenue tests sat over 4 real `Uint8Array<ArrayBufferLike>` errors, and
  30 green backend tests sat over an untyped `.json` validator getter. Run `npx tsc --noEmit` from
  INSIDE each package, separately, and read its exit code.

## Known gaps & deferred work

- Every **[PLANNED]** item above is unbuilt at the `Last verified` sha. This playbook was registered
  first, deliberately, so parallel lanes have non-overlapping owners before they start writing.
- **Invariants 1, 2 and 15 are now enforced** (28-26, 28-03, 28-26). Invariant 1's scan is armed
  but has never bitten: there is no lane module in the tree for it to scan, so it is proven only
  against a synthetic module in `--self-test`. The first real provider lane is its first real test.
- **`sealGate` writes no audit row.** `providerGates` is deployment-global and the `audit` table is
  tenant-scoped, so there is no tenant to attribute an owner's deployment-wide judgment to. The
  `revision` counter and `evidenceRef` are the only history a gate keeps. If provider admissions
  ever need a governance trail, that is a deliberate plan, not a one-line addition here.
- **A condition id is only pinned by a literal in `contracts.test.ts`.** Renaming one there and in
  the seal invocation together would be self-consistent and silent; the register's table pins the
  *provider* and the *owning plan*, not the slug. Wave-7 plans type these ids by hand.
- **`workflowPackEvents` was NOT extended, and 28-14/28-15 must extend it.** Its `packId` and
  `event` unions are Phase 27's, and `packId` is pinned to `WORKFLOW_PACK_IDS` in `@pikar/core` by a
  source scan in `packages/core/src/workflowPacks.test.ts` — so adding the seven Phase 28 workflow
  ids means editing `schema.ts` AND `workflowPacks.ts` together, and their exact names are 28-14's
  contract, not 28-03's. Guessing seven literals from a schema plan would have produced wrong names
  with a green test over them. **Consequence: 28-03 is the single schema owner for the CONNECTOR
  tables only, not for the pack-event literals.** 28-14 (pack registration) must own that edit, and
  28-15 must not emit a pack event whose `packId` has no literal — the insert throws
  `ArgumentValidationError` and the event silently vanishes.
- **No provider cache table was added.** 28-RESEARCH allows "optional non-authoritative caches" and
  no Phase 28 plan asks for one; a speculative table with no reader is a migration nobody needed
  (CLAUDE.md §8 rung 1). If a lane later proves a bounded cache is required, it adds one table with
  an explicit freshness column — a cache without a visible retrieval time would break Invariant 6.
- **`tenantDelete.ts` reports per-provider disconnect truth for Google/Microsoft and does not yet
  know about connector connections.** Erasure DOES delete the rows (they are `tenant_credential`),
  but the deletion report says nothing about whether the four provider grants were revoked upstream
  — which, per Invariant 12, is often "we could not". `tenantDelete.ts` is owned by
  `audit-dead-letter.md` and no Phase 28 plan currently claims it. Flagged, not fixed.
- Deferred by phase boundary: refunds, credits, PayPal invoice sends, CRM cleanup, journal entries,
  any accounting mutation, and the Canva/DocuSign/Slack/Square connector candidates.
- Webhooks are out of scope for v1 (polling only). The suitability records still capture each
  provider's webhook signing and replay behaviour so a later plan need not re-research it.
