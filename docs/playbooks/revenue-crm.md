# Playbook: Revenue CRM workflows (REVN-04)

> Last verified: 2026-08-31 against 28-10 (the pure ranking, the adapter and its tests)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-10) · Related ADRs: none yet

> **Status: BUILT AND LOCAL-ONLY.** `packages/revenue/src/crm.ts` (30 tests) and
> `convex/revenueCrm.ts` (17 tests) both exist as of 28-10. **They read Phase 19 and NOTHING ELSE.**
> `coverage` is the literal `local`, `deal` and `paymentFlag` are always `null`, and that is not a
> stub — no provider lane has passed, so there is nothing honest to put there. 28-11 and 28-12
> compose provider facts ON TOP of these same pure functions rather than replacing them. Items
> still marked **[PLANNED]** below remain contracts, not claims. Connector lifecycle, credentials
> and release semantics live in `revenue-connectors.md`.
>
> ## What 28-10 decided, and why each decision has a test
>
> **SUPPRESSION IS TERMINAL, NOT A LOW RANK.** `rankAttention` REMOVES a suppressed contact. Ranking
> it last still puts a do-not-contact person at the bottom of a short day's call list. The adapter
> does the address join server-side (Phase 19 keys suppression by address, so there is no other
> way), lower-cases both sides — a case-sensitive miss silently re-admits someone who asked not to
> be contacted, the worst possible direction — and the address never reaches the output.
>
> **NOTHING IS FABRICATED FROM ROW METADATA.** `lastActivityAt` is `null`, not `_creationTime`.
> Phase 19 has no activity timeline yet, and deriving one from the row's creation date would make
> every imported contact look freshly touched and every old one newly quiet. `rankAttention` never
> fires `gone_quiet` from a null date, and a test pins the pair: null does not fire, a known-old
> date does.
>
> **SILENCE IN PROVIDER METADATA IS NOT "OPEN".** A deal fires `deal_closing` only when
> `stageClosed === false`. `null` means HubSpot did not say, and treating that as open would put
> won and lost deals back on a working list forever.
>
> **A ROW WITH NO REASON IS NOT RETURNED.** A call list padded with people there is no reason to
> call stops being read. `scanned` is reported separately, so an empty list is visibly a JUDGMENT
> rather than an empty read.
>
> **THE PULSE REFUSES TO BE HEALTHY ON A READ THAT DID NOT HAPPEN.** `coverage: "unavailable"` and
> `"partial"` both yield `unknown`. A "healthy" computed from a read that never ran is
> indistinguishable from a real all-clear — the most dangerous output this module could produce. A
> dispute is still `at_risk` on a partial read, because that fact IS known and silence about it
> would be worse. `coverage` is a required ARGUMENT rather than a default, or the guard would never
> fire.
>
> **THE MODULE CANNOT WRITE, AND A SOURCE SCAN ENFORCES IT.** `revenueCrm.test.ts` fails if the
> module ever contains `tenantMutation(`, `internalMutation(`, `tenantAction(` or any `ctx.db`
> write verb. A read surface that can write is exactly how the second CRM starts.
>
> **BOUNDED:** `ATTENTION_SCAN_CAP = 500`, with `capped` reported. `ponytail:` a fixed cap rather
> than pagination, because the output is a working list a person reads and nobody works 500 rows;
> the upgrade path is a cursor when a tenant genuinely outgrows it.

## Purpose

Lead triage, call lists, pipeline review and customer pulse — the read-only analyses that join Phase
19's people/follow-ups to bounded provider signals. The defining constraint: **THERE IS NO SECOND
CRM.** `convex/contacts.ts` is the only person, consent, suppression and follow-up store. This
subsystem attaches provider references to it and computes rankings. It creates no opportunity, no
stage and no deal value.

## Key files

**[PLANNED]**

- `packages/revenue/src/crm.ts` (+ `.test.ts`) — pure ranking/triage rules over source facts. No
  Convex import, no model call.
- `packages/backend/convex/revenueCrm.ts` (+ `.test.ts`) — thin orchestration: read Phase 19 people
  and follow-ups, read bounded HubSpot projections, join by provider reference, call the pure rules.

`packages/revenue/src/finance.ts` and `money.ts` belong to `revenue-finance.md`.
`packages/revenue/src/contracts.ts` and `reminders.ts` belong to `revenue-connectors.md`.

## Dependencies & blast radius

`graphify query "revenue crm"`. Beyond that:

- **Phase 19** (`contacts-crm.md`): the landed contact/consent/suppression/follow-up API and the
  narrow Pipeline summary. Read it; do not rewrite its storage or its send guard.
- **HubSpot** (`connector-hubspot.md`): the only provider feeding this subsystem. If HubSpot is
  `parked` or absent, this subsystem still works from Phase 19 alone and names deal coverage
  unavailable.
- **`revenueTools.ts`** (`revenue-connectors.md`): how these analyses reach the Executive Agent.

## Data flow

1. Read Phase 19 people and follow-ups for the tenant.
2. Read bounded HubSpot contact/company/deal projections (if the lane is `passed` and connected).
3. Join by **provider reference**, not by name. An unmatched provider record stays unmatched.
4. A pure rule ranks attention from source facts: overdue follow-up, source-provided next activity,
   stale contact, source-provided deal timing.
5. The model may explain the ordered result. It may not reorder it, invent a stage or a value, or
   fill a blank.

## Invariants — what must never break

1. **No second person or pipeline store.** No local opportunity/stage/deal-value table is created.
   *Enforced by:* [PLANNED] schema + integration tests against the landed Phase 19 API (28-10, 28-21).
2. **Never substitute an unmatched name.** Contact resolution matches by provider reference or
   returns unmatched. Guessing a person is how the wrong customer gets contacted. *Enforced by:*
   [PLANNED] resolution tests, mirroring the Phase 3.3 contact-resolution invariant.
3. **Suppressed contacts are visible only as "do not contact"** and can never enter an outreach plan.
   The terminal suppression checks stay Phase 19's — `cockpit.executePlan` per-recipient and
   `gmail.prepareGovernedMessage` at the wire. **Do not add a third check.**
4. **Provider-owned fields stay source-attributed and visibly separate from local follow-up state.**
   A user must be able to see which system said what.
5. **No fictional opportunities.** If HubSpot is absent, retain the Phase 19 view and name deal
   coverage unavailable. Do not promote Phase 19 contacts into opportunities that do not exist.
6. **Read-only analyses.** Lead triage, call lists, pipeline review and customer pulse write nothing —
   not to the provider, not to Phase 19 storage.
7. **Bounded operational signals only.** Customer pulse uses open/overdue follow-ups, last
   contact/activity time, invoice status, payment lateness, dispute status and source availability.
   V1 excludes arbitrary CRM notes, support transcripts, custom metadata and free-text invoice
   descriptions **from the tool-bearing loop** — untrusted third-party text must not reach a model
   holding tools. Any future text ingestion uses the established toolless, schema-validated
   summarization pattern.
8. **The model explains, it does not compute or decide.** Rankings come from the pure rule.

## How to change safely

- **New ranking signal:** add it to the pure rule with a fixture, then thread it through. Never rank
  in `revenueCrm.ts`.
- **New provider field:** it must be source-attributed at the projection boundary before it can be
  displayed, or invariant 4 breaks silently.
- **Anything touching suppression or consent:** stop and read `contacts-crm.md` first. This subsystem
  consumes that boundary; it does not extend it.
- **Adding free text to a pulse:** requires the toolless summarization pattern and its own plan.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && pnpm vitest run src/crm` [PLANNED] | Ranking rules, unmatched handling, empty-provider behaviour. | offline |
| `cd packages/backend && pnpm vitest run revenueCrm` [PLANNED] | Phase 19 join, suppression visibility, no local pipeline writes. | offline |
| `cd packages/backend && pnpm vitest run revenueTelemetry.integration` [PLANNED, 28-21] | End-to-end lane behaviour with providers parked and passed. | offline |

Run vitest from **inside** the package; `vitest --root <pkg>` from the repo root fakes mass failures.

## Operational notes

- With HubSpot `parked`, this subsystem must still return a useful Phase 19-only result. Test that
  path first — it is the one users will hit until a lane passes.
- A green suite over an unwired join is the known failure mode here: assert the *rendered* attribution,
  not just that the join function was called.

## Known gaps & deferred work

- Everything [PLANNED] is unbuilt. Invariants 1, 2 and 5 have no enforcement yet.
- CRM writes, cleanup and any provider mutation are out of phase scope.
- Free-text ingestion (notes, transcripts, invoice descriptions) is deferred pending the toolless
  summarization path.
