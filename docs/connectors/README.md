# Provider suitability register — Phase 28 connector admission

> **A provider is admitted by a line in a file, not by a conversation.** Every connector Phase 28
> may build reads its authority from exactly one machine-readable marker block in its own record.
> There is no all-provider approval flag and there never will be one.

**Register opened:** 2026-08-27 (plan 28-01) · **Owner:** repository owner ·
**All four judged:** 2026-08-27 (plan 28-01 Task 2) — see [Recorded judgments](#recorded-judgments--2026-08-27)

---

## The four records

| Provider | Record | Blocker shape (2026-08-27) | Decision |
|---|---|---|---|
| HubSpot | [`hubspot-suitability.md`](./hubspot-suitability.md) | Marketplace **listing** requirement + install caps | `approved_production` — evidence-consistent |
| QuickBooks Online | [`quickbooks-suitability.md`](./quickbooks-suitability.md) | Intuit **approval** gate on production credentials; no read-only scope | `approved_production` — on owner **attestation** |
| Stripe | [`stripe-suitability.md`](./stripe-suitability.md) | Extension path **closed**; a Stripe App read-only route exists | `approved_production` — owner **override** |
| PayPal | [`paypal-suitability.md`](./paypal-suitability.md) | **Partner-network** membership + partner manager | `approved_production` — on owner **attestation** |

The table above is a courtesy copy. The authority is the marker block inside each record:

```
grep -h '^decision:' docs/connectors/*-suitability.md
```

Plan 28-26 consumes these markers as durable server state. Keep the format byte-stable.

---

## Decision vocabulary

The value set is **closed**. A typo reads `undecided`, never an approval.

| Value | Meaning | Unlocks |
|---|---|---|
| `approved_beta` | Owner accepts the residual risk for **sandbox/controlled beta engineering only**. | The provider's adapter lane may be built. No production discovery, no tenant-visible entry point. |
| `approved_production` | Owner accepts the risk for **live tenant data and production exposure**. | Production discovery/navigation for that provider. Requires `approved_beta` first — it is not a shortcut past it. |
| `blocked` | A named external condition is unmet and Pikar cannot meet it unilaterally today. | Nothing. The lane is **parked**. |
| `deferred` | Not blocked by the vendor; the owner is choosing not to spend on it now. | Nothing. The lane is **parked**. |
| `undecided` | No judgment on record. **Default. Blocking.** | Nothing. The register must not be satisfiable by forgetting to answer. |

A `blocked` or `deferred` provider becomes **parked** — it is not a blocker to any other provider's
lane. The four lanes complete independently.

**On 2026-08-27 all four judgments were issued directly as `approved_production`, with no
intervening `approved_beta` marker.** Recorded as given. The production marker carries beta
engineering authority, so every lane may be built — but the beta stage was *skipped*, not passed,
and none of the `approved_production` gates listed as *not researched* in the records
(data-processing / commercial terms, retention & deletion duties, data residency) was cleared
before it was granted.

### Marker block format

Every record carries exactly one of these, unindented, at the top:

```
<!-- phase28-provider-decision
provider: <slug>
decision: undecided
decided_on: none
evidence_first: 2026-08-05
evidence_reverified: 2026-08-27
review_by: 2026-11-27
-->
```

`decided_on` stays `none` until an owner judgment exists. Writing a decision without a date is not
a decision.

---

## Recorded judgments — 2026-08-27

Four independent owner judgments, one per provider. **They do not rest on the same kind of thing,
and the difference is the point.** Only one of the four is supported by the evidence in its record.

| Provider | Decision | Rests on | If that basis is wrong |
|---|---|---|---|
| HubSpot | `approved_production` | **Evidence.** The record supports it: unlisted OAuth needs no HubSpot permission, and the install cap is accepted while a Marketplace listing is deferred. | — |
| Stripe | `approved_production` | **OWNER OVERRIDE.** The record says production is *not* supportable today; the owner was shown that and approved anyway. | The override stands until reversed; the open revocation condition is unaffected either way. |
| QuickBooks | `approved_production` | **OWNER ATTESTATION** that Pikar holds live Intuit production credentials (App Assessment Questionnaire approved). | Approval is void; QuickBooks is `blocked` again — production credentials are the whole gate. |
| PayPal | `approved_production` | **OWNER ATTESTATION** that Pikar holds PayPal partner acceptance with an assigned partner manager on a live partner account. | Approval is void; third-party Transaction Search returns 401 and PayPal is `blocked` again. |

**Three of these four are testimony, not evidence.** Nothing in this repository checked the Stripe
override's risk acceptance, the Intuit approval or the PayPal partner acceptance, and no vendor page
proves the latter two. They are recorded as human claims with a date, and they must never be
restated downstream as verified facts — the laundering of supplied claims into "observed" ones is a
recorded defect class here.

### Open conditions that survived every approval

None of the four approvals resolved its record's open condition. Each is a live obligation on a
named downstream plan:

| Provider | Condition still open | Who must confront it |
|---|---|---|
| HubSpot | Does `POST /oauth/2026-03/token/revoke` cascade to already-issued **access** tokens? Undocumented; the legacy `DELETE` did not. | **28-05 tests it; 28-22 must not seal without the result.** |
| Stripe | Platform-initiated revocation for Stripe Apps is **undocumented**. 28-CONTEXT requires per-tenant revocation. | **28-24.** It cannot be closed by a green test. |
| QuickBooks | App Partner Program **tier unstated** (Builder = 500,000 CorePlus calls/workspace/month). Write blast radius **accepted**, so the GET/query-only allow-list is **mandatory**. | **28-06** (allow-list + poll budget); **28-23**. |
| PayPal | **No revoke endpoint documented anywhere.** Sandbox is **non-probative** about production authorization. | **28-25.** Resolve with the partner manager. |

---

## What is NOT evidence of admission

**`.mcp.json` is evidence of NONE of this.** The upstream lead list
(`anthropics/knowledge-work-plugins/main/small-business/.mcp.json`) is a list of URLs that work in
an MCP client. It proves nothing about:

- whether the endpoint is reachable server-side from Convex,
- whether a per-tenant OAuth grant exists at all,
- whether the scopes are read-only,
- whether the vendor's terms permit a multi-tenant SaaS to hold those grants,
- whether Pikar is approved by that vendor for anything.

A URL working in Claude or Cowork is a lead, not an authorization. The same applies to vendor
marketing pages, a working sandbox, and a green integration test.

**Additionally not evidence:** a passing sandbox call (PayPal states outright that sandbox works
*before* partner approval); a prior session's confident SUMMARY.md; a planner's memory of the
2026-08-05 research.

---

## A partial release is not Phase 28

**A partial subset release does NOT complete REVN-01, REVN-02 or REVN-03, and does not complete
Phase 28.** Those requirements — and therefore the phase — remain incomplete until *every* provider
they name carries a current production-suitability decision **and** a controlled production/live
read/revoke gate marked `passed`.

One provider shipping is a shipped provider. It is not a shipped phase. Do not let a green lane
close a red requirement.

**As of 2026-08-27 all four providers carry `approved_production` — and Phase 28 is still not
complete.** Not one lane gate has been run; no adapter exists yet. Four approvals are permission to
start, not evidence of a finished phase.

---

## Evidence discipline — verified vs unverified

This repository has a recorded defect class in which unverified claims get laundered into facts by
being restated in a later document. Every record therefore splits its findings into two headed
sections and **never merges them**:

- **Verified from primary vendor documentation** — a sentence read on the vendor's own docs or
  published OpenAPI spec, with the URL. Quoted where the exact wording carries the constraint.
- **Could NOT verify** — inference, a page that renders empty to a non-JS fetch, a community/blog
  source, or documentation silence. **These may not be relied upon and may not be restated
  elsewhere without this qualifier.** Documentation silence is not permission.

A claim that appears in neither section was not researched. Say so rather than implying coverage.

## Both evidence dates travel together

Each record carries **two** dates, because they disagree:

- **2026-08-05** — the original phase research (`28-RESEARCH.md`, lines 172-290).
- **2026-08-27** — an independent primary-source re-verification of all four providers.

**Where the two disagree, 2026-08-27 supersedes.** The three-week-old record was wrong or materially
incomplete for **three of the four providers** — see below.

### The volatility finding

This is itself a finding worth recording: **three weeks aged this research badly.**

- **Stripe** — the recorded conclusion reversed in *both* directions. The blocker's own remedy
  ("become an Extension") became unreachable — Stripe now states "You can no longer build new
  Connect extensions" — while a route the Aug-5 record did not consider (a read-only Stripe App)
  turned out to exist.
- **HubSpot** — the blocker turned out to be materially narrower than recorded: a Marketplace
  *listing* requirement, not a distribution ban.
- **QuickBooks** — the blocker turned out to be materially *stronger* than recorded: Intuit does not
  reveal production credentials at all until it approves the App Assessment Questionnaire.
- **PayPal** — substance unchanged, but two of the three cited doc URLs had moved or 404'd.

Two vendors also now contradict *themselves* in live documentation (Stripe's
`oauth-changes-for-standard-platforms`; HubSpot's `working-with-oauth`). A single vendor page is not
a settled fact — cross-check against the API reference or the published spec.

**Therefore: 90 days is the maximum evidence life.** `review_by` defaults to **2026-11-27**. Any
approval granted on this evidence expires with it.

### Re-review triggers (any one, immediately, ahead of `review_by`)

- The vendor announces a deprecation, sunset, versioning or partner-program change touching the
  named surface.
- A cited evidence URL 404s, redirects, or changes its stated constraint.
- Pikar's registration status with that vendor changes (application submitted, approved, rejected,
  tier changed).
- An item in a record's *Could NOT verify* section gets tested and the result contradicts the plan.
- A live call returns an authorization error the record says should not happen.

---

## Secrets

**No raw token, account id, client id, client secret, realm id, merchant id or copied vendor secret
may appear in any file in this directory.** These are public repository documents. Record the *name*
of a credential and where it lives, never a value — the same rule
`packages/backend/convex/lib/env.ts` follows (names only, never a value, never a length).

---

## How a record gets written

1. Research from **primary vendor documentation** — the vendor's own docs, API reference or
   published OpenAPI spec. Not a blog, not a KB article that renders client-side, not an LLM's recall.
2. Fill the shared checklist. Mark every row `verified` / `unverified` / `not researched`.
3. State the provider-specific blocker in the vendor's own words where the wording is the constraint.
4. Surface **the single owner question** — the fact about Pikar's actual status or relationship with
   that vendor that **no documentation can answer**. This is what the owner decides against.
5. Leave `decision: undecided`. **The researcher does not decide.**
6. The owner records one judgment per provider. A blanket approval across providers is not accepted.

## Related

- [`phase28-readiness.md`](./phase28-readiness.md) — the landed-contract gate (Phase 19/25/27
  prerequisites). That gate is about *this repository*. This register is about *four vendors*. Both
  must be green before a connector reaches a tenant.
- `docs/playbooks/revenue-connectors.md` — how connector code is built and changed safely.
- `.planning/phases/28-connector-backed-revenue-pack/28-RESEARCH.md` lines 172-290 — the 2026-08-05
  research, superseded where it disagrees with the records here.
