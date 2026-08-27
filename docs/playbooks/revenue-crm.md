# Playbook: Revenue CRM workflows (REVN-04)

> Last verified: 2026-08-27 against 4295bcc
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-10) · Related ADRs: none yet

> **Status: REGISTERED AHEAD OF IMPLEMENTATION.** At the `Last verified` sha neither
> `packages/revenue/src/crm.ts` nor `convex/revenueCrm.ts` exists. Everything marked **[PLANNED]** is
> a contract a later plan must satisfy, not a claim of landed behaviour. Connector lifecycle,
> credentials and release semantics live in `revenue-connectors.md`.

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
