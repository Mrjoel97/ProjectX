# Playbook: Revenue connectors — shared lifecycle, gates and release semantics

> Last verified: 2026-08-27 against 82d14a6 (28-03 landed the credential envelope, the four Phase 28
> tables and the credential adapter)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` · Related ADRs: none yet

> **Status: PARTLY IMPLEMENTED.** At the `Last verified` sha the Phase 28 code on disk is the
> readiness gate (28-17), the `@pikar/revenue` contracts (28-02), and 28-03: the credential
> envelope, the four connector tables and the credential adapter. Every item still marked
> **[PLANNED]** below is a *contract a later plan must satisfy*, not a claim that code exists — do
> not cite a [PLANNED] line as evidence that something works.
>
> **NO PROVIDER EXISTS YET AND NO LANE HAS PASSED.** There is no adapter, no OAuth callback, no
> connections UI and no live read. What 28-03 delivered is the ability to store a connector
> credential safely if one ever arrives — a precondition, not a feature. All four open conditions
> from the admission decisions survive untouched.

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
   reachable from any adapter export or specialist grant. *Enforced by:* static reachability tests
   [PLANNED, 28-26]. Until those land this is a review-only rule — that is a real gap.
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
8. **One-time OAuth state.** State is consumed atomically before token exchange. HMAC binding alone
   prevents tenant tampering but not callback replay.
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

## Release semantics — passed / parked / subset / complete

These four states are deliberately distinct. Conflating them is how a partial rollout gets recorded
as a finished phase.

| State | Meaning | Decided by | Effect |
|---|---|---|---|
| **lane `passed`** | One provider holds a current suitability decision **and** a controlled live read/revoke gate observed green. | `scripts/check-provider-lane.mjs` [PLANNED] over that provider's evidence | That provider may appear in the product. |
| **lane `parked`** | Blocked, deferred, or evidence missing/expired. | same | Provider hidden; dependents report unknown coverage, not zero. |
| **subset release** | At least one lane `passed` and its workflows shipped. | owner | Users get value. **This is NOT phase completion.** |
| **phase complete** | REVN-01, REVN-02 and REVN-03 each require *every* provider they name to hold a current production-suitability decision and a `passed` live read/revoke gate. | `scripts/check-phase28-completion.mjs` [PLANNED] | Only then may Phase 28 be closed. |

A suitability record carries an owner, a review date, evidence links, a decision
(`approved_beta` | `approved_production` | `blocked` | `deferred`) and an expiry/re-review trigger.
Code may be written against a sandbox after `approved_beta`; navigation and discovery require the
production decision. **An expired record is `parked`, not `passed`.**

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
| `cd packages/backend && pnpm vitest run isolation traceParity tenantDelete tenantExport` | The four derived gates a new table or a new tool literal must satisfy. | offline |
| `cd packages/backend && npx tsc --noEmit` | Same reason as above — it caught an untyped validator getter this suite was green over. | offline |
| `node scripts/smoke-<provider>-read.mjs` [PLANNED] | Controlled live read and revoke for one lane. | live creds |
| `node scripts/check-provider-lane.mjs` [PLANNED] | Machine-readable lane status. | offline |
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
- Invariant 1 (read-only reachability) has no enforcement yet. That is a gap, not a footnote — the
  static scan lands with 28-26. **Invariant 2 is now enforced** (28-03).
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
