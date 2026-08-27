# Playbook: Revenue connectors — shared lifecycle, gates and release semantics

> Last verified: 2026-08-27 against 4295bcc
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` · Related ADRs: none yet

> **Status: REGISTERED AHEAD OF IMPLEMENTATION.** At the `Last verified` sha the Phase 28 code on
> disk is the readiness gate (28-17) and the `@pikar/revenue` scaffold + frozen contracts (28-02,
> `d963bf3`, still in flight). Every item marked **[PLANNED]** below is a *contract a later plan must
> satisfy*, not a claim that code exists. Do not cite a [PLANNED] line as evidence that something
> works.

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

**[PLANNED] — pure package**

- `packages/revenue/src/credential.ts` — AES-256-GCM seal/open primitive only.
- `packages/revenue/src/reminders.ts` — invoice-reminder draft shaping (REVN-06). No send.

**[PLANNED] — Convex adapters (thin, per CLAUDE.md §1)**

- `connectorCredentials.ts` — envelope persistence. No public "store secret" mutation.
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
- `docs/connectors/README.md` — index of the four suitability records.

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
   tenant or provider must fail authentication. *Enforced by:* two-tenant tests [PLANNED, 28-03].
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

## Rollback

- **Per provider (fast, no deploy):** park the lane — set that provider's suitability decision to
  `blocked` or `deferred`. `providerGates` hides the provider, its tools drop out of the grant, and
  dependent workflows report unknown coverage. Other lanes are unaffected.
- **Per tenant:** disconnect (provider revoke first, local delete second). A partial-revoke state is
  an honest terminal, not a retryable no-op.
- **Whole phase:** set `phase25_production_posture: block` in the readiness attestation comment —
  one edit re-blocks every dependent plan. Then park all four lanes.
- **Key rotation** (not a rollback, but the same discipline): decrypt with the old key version,
  reseal with the new, CAS on the original row, and retain the old key until verification completes.

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
| `cd packages/revenue && pnpm vitest run` [PLANNED] | Pure contract, money and finance logic. | offline |
| backend `pnpm test` [PLANNED] | Adapter, credential and two-tenant isolation tests. | offline |
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
  not a Phase 28 decision. 28-03 is the single serialized schema owner for this phase.

## Known gaps & deferred work

- Every **[PLANNED]** item above is unbuilt at the `Last verified` sha. This playbook was registered
  first, deliberately, so parallel lanes have non-overlapping owners before they start writing.
- Invariants 1 and 2 have no enforcement yet. That is a gap, not a footnote — the tests land with
  28-26 and 28-03/28-04 respectively.
- Deferred by phase boundary: refunds, credits, PayPal invoice sends, CRM cleanup, journal entries,
  any accounting mutation, and the Canva/DocuSign/Slack/Square connector candidates.
- Webhooks are out of scope for v1 (polling only). The suitability records still capture each
  provider's webhook signing and replay behaviour so a later plan need not re-research it.
