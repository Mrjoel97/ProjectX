# Playbook: Proposals (document/chat/voice-derived facts, one-click accept)

> Last verified: 2026-08-15 (Task 6, `proposals-table-and-applier` plan — playbook created after
> Tasks 1-5 landed: the §4 basis guard at the shared validator, the closed target registry, the two
> pure guards, the `proposals` table, and the applier. See `docs/superpowers/specs/
> 2026-08-15-document-driven-blueprint-updates-design.md` for the full four-plan design; this
> playbook covers plan 2 only — the spine. Plans 3 (trigger/derive/Approvals surface) and 4
> (gap-chase) are future work; see Known gaps.)
> Build history: `.superpowers/sdd/2026-08-15-proposals-table-and-applier/` · Related ADRs: none yet
> (the design doc §10 calls for one recording the `userProvided`/`fieldProvenance` split; not filed
> as of this entry — check before assuming it exists).

## Purpose

The bridge between a fact an agent extracted (from a vault document, a chat turn, or a voice
session — none of those producers exist yet, see Known gaps) and the store that fact belongs in.
A `proposals` row holds every fact derived from ONE source event; a human accepts some or all of
them in a single click, and the accepted ones are written through the SAME writer a manual edit
would use — never a second, agent-only path into a store. This is what makes a document-derived
figure inherit every validator, consent rule and provenance stamp a hand-typed one already has,
by construction rather than by a second implementation kept in sync.

It exists because three write paths already reach these stores (chat-staged finance/CRM writes,
the blueprint draft button) and none of them is reachable from an upload — a document today becomes
searchable and nothing else (design doc §1).

## Key files

**Pure packages (framework-agnostic, CLAUDE.md §1)**
- `packages/core/src/proposal.ts` — `PROPOSAL_TARGETS` (the closed registry of what may be
  proposed AND WRITTEN), `proposalTarget(store, field)`, `ProposedFact`, `ProposalSourceLocator`,
  `CurrentValue`, `ProposalGuard`, `classifyProposal`, `sweepable`. Zero Convex import.
- `packages/core/src/proposal.test.ts` — registry totality tests (every `CASH_INPUTS` field is a
  target; every model-derivable, `BusinessProfile`-backed blueprint field is a target; the two
  fix-round regression guards below); the `classifyProposal`/`sweepable` truth table.
- `packages/core/src/financeClaim.ts` — `validateFigureClaim`, which now enforces the §4 refs-only
  `basis` rule at the shared boundary EVERY producer runs through (Task 1 of this plan), not just
  the one cockpit tool that used to check it locally. `ProposedFact.confidence`/`origin`/`actor`
  reuse this module's vocabulary rather than inventing a second scale.

**Backend**
- `packages/backend/convex/schema.ts` — the `proposals` table (search `proposals: defineTable`).
  One row per source event; `items` is an EMBEDDED array, not a child table, so accepting a batch
  is one Convex mutation and all-or-none is free — the same property `applyCrmOperations` already
  relies on. Indexes: `by_tenant_status` (the pending-list read) and `by_tenant_source` (built for
  §6.3 supersession; unused today, see Known gaps).
- `packages/backend/convex/proposals.ts` — `acceptProposal` (`tenantMutation`), `discardProposal`,
  `listPending` (`tenantQuery`). The applier. Read the file header before touching it — it states
  the two-pass discipline inline.
- `packages/backend/convex/proposals.test.ts` — round-trip tests for every union member the schema
  accepts, plus the full `acceptProposal` behavioural suite (the invariants below, each pinned by
  name).
- `packages/backend/convex/cash.ts` — `applyFinanceClaims` (the ONE writer for both `financeInputs`
  and `scorecard` proposals, exported already) and `inputStatesFor` (exported for this module,
  comment names `proposals.ts` as the second caller — read current finance/scorecard state in ONE
  call, the same call the finance page renders from).
- `packages/backend/convex/onboarding.ts` — `writeProfileDoc`, `currentProfileDoc`, `currentTierRow`
  (all exported for this module, each with a doc comment naming `proposals.ts` as the second
  caller). The profile writer.
- `packages/backend/convex/contacts.ts` — `applyCrmOperations` exists and is the eventual writer for
  `contacts`/`followUps` proposals, but `proposals.ts` never calls it yet — see invariant 6.

**Not yet built** (tracked here so their absence is a documented decision, not a silent gap):
a `deriveFromDoc`/chat/voice trigger that WRITES a `proposals` row, and any frontend surface that
reads `listPending` or calls `acceptProposal`/`discardProposal`. See Known gaps.

## Dependencies & blast radius

Run `graphify query "proposals applier target registry"` for the current subgraph — as of this
writing the graph is stale for this subsystem (heavily weighted toward an unrelated media community
in this shared tree); do not trust it over the reads above without re-running `graphify update .`
first. Couplings graphify cannot see:

- **`CASH_INPUTS`** (`packages/core/src/cash.ts`) and **`BLUEPRINT_FIELDS`/`FIELD_SPEC`**
  (`packages/core/src/blueprint.ts`) are the two source-of-truth field lists `PROPOSAL_TARGETS` is
  ASSEMBLED from. A field added to either is automatically proposable (finance) or eligible
  (profile, pending the `PROFILE_WRITABLE_FIELDS` intersection) — there is no third list to remember
  to update. A field REMOVED from either must not still be referenced by `PROFILE_WRITABLE_FIELDS`
  or a hardcoded contact target.
- **`schema.ts`'s `target.store` union and `proposal.ts`'s `ProposalStore` type are two hand-written
  copies of the same five literals**, not generated from one source. Adding a sixth store means
  editing both, plus the applier's dispatch and the "one-writer table" doc comment below.
- **`evaluations.ts`'s `fieldProvenance`** column is what makes `inputStatesFor` able to tell a
  user-stated scorecard figure from an agent-written one (`CurrentValue.statedByUser`). This column
  and the `applyScorecardAnswer` provenance parameter were built by a PRIOR plan (21-01, "scorecard
  provenance" in the design doc's build order) — this playbook does not own that surface;
  `dashboard-pages.md` does.
- **The `auditCounts` aggregate component** must be registered in any test that exercises the
  finance branch (`applyFinanceClaims` always reaches `internal.audit.log`) — see
  `proposals.test.ts`'s `withAudit()` helper. A test that seeds a finance fact without it throws
  `Component "auditCounts" is not registered`, not a useful assertion failure.
- **`dashboard-pages.md`** also documents this module's finance/profile write behavior from the
  target-store side (what `acceptProposal` means for `cash.ts`/`onboarding.ts`), because those
  stores are its territory. This playbook is the canonical source for the proposals SUBSYSTEM
  itself — the registry, the guards, the table shape, the two-pass discipline. The two entries
  describe the same code from two angles; if they ever read as disagreeing about BEHAVIOUR (not
  emphasis), that is a bug in one of them.

## Data flow

**Today**, with no producer built yet:
1. A test (or, once plan 3 lands, `internal.proposals.deriveFromDoc`/a chat or voice equivalent)
   inserts a `proposals` row: `{tenantId, createdAt, sourceKind, sourceRef, status: "pending",
   items: ProposedFact[]}`.
2. A human (or, today, a test acting as one) calls `acceptProposal({proposalId, acceptedIndices,
   edits?})`.
3. **PASS 1 — validate, write nothing.** Load the row; refuse `not_found` if absent or foreign,
   `not_pending` if already resolved. Check every accepted index is in range and not duplicated
   (`unknown_item`); apply `edits` over the stored value; stamp `actor: "agent"` on every chosen
   item, unconditionally; refuse `unknown_target` if `proposalTarget(store, field)` is `null` for
   any item; refuse `writer_refused` for every `contacts`/`followUps` item (invariant 6); refuse
   `incomplete_facts` if any item targets `profile` and the tenant has no `tenantProfiles` row yet.
4. **PASS 2 — read current state, classify (reporting only), write.** Finance/scorecard items: one
   `inputStatesFor` call, `classifyProposal` per item (tally only), then ALL chosen finance items in
   one `applyFinanceClaims` call — it is the sole staleness authority and re-validates everything
   itself. Profile items: merge onto `currentProfileDoc`'s parsed doc (or a blank skeleton) and
   write through `writeProfileDoc`.
5. Patch the row to `status: "accepted"` LAST, after every writer call has returned successfully.
6. `discardProposal` is a one-step alternative to step 2: `pending` → `discarded`, no writer touched.

## Invariants — what must never break

**1. The applier never writes a target store via `ctx.db`.** Its only `ctx.db` write anywhere in
`proposals.ts` is `ctx.db.patch(proposalId, { status: ... })` on the `proposals` row itself. Every
fact lands through `applyFinanceClaims` or `writeProfileDoc` — the store's existing single writer —
so every validator, consent rule and provenance stamp that guards a manual entry guards a
proposal-applied one automatically, with no second route to keep in sync.
*Enforcement:* read the file; there is no test that greps for a bare `ctx.db.patch`/`ctx.db.insert`
outside the one `status` site — this is a gap, stated here rather than hidden. If a future change
adds a second `ctx.db` write, this playbook's word is the only thing that will notice.

**2. Two passes, never interleaved. A `return` does not roll back a Convex transaction.** Only a
`throw` does. Every refusal check that can fire for ANY item in the batch must run in PASS 1, before
ANY writer runs — a refusal discovered mid-write leaves the batch half-applied and the row still
`"pending"` (re-acceptable, i.e. re-appliable a second time). This bug ACTUALLY OCCURRED: the
`incomplete_facts` tier-row gate originally sat in PASS 2, after the finance write block, so a mixed
finance+profile batch for a tenant with no `tenantProfiles` row would commit the finance half
(figure rows AND the `finance.claims_applied` audit insert) before refusing on the profile half.
Fixed by hoisting the gate — a pure read — into PASS 1. The one `throw` in the file
(`itemAt`'s "unreachable" guard, and the mirrored `tierRow` re-check before the profile write) is
deliberate and correct for the same reason: it is the one place a rollback is actually wanted if the
pre-validated invariant it guards is somehow false at write time.
*Enforcement:* `proposals.test.ts` — "a mixed finance+profile batch for a tenant with no tier row
refuses incomplete_facts, writing NEITHER half" — asserts zero finance rows, zero audit rows, AND
zero profile docs after the refusal, specifically because a profile-only test cannot catch a gate
sitting in the wrong pass (it never reaches the finance branch at all).

**3. `actor` is STAMPED to `"agent"` in PASS 1, never read off the stored row.** The `proposals` row
is content plane and can be revised between creation and accept — a stored item claiming
`actor: "user"` is either a staging bug or a lie, and either way the applier overwrites it before it
ever reaches a writer. `actor` is a fact about which DOOR the write came through, not data a
content-plane row gets to assert about itself.
*Enforcement:* `proposals.test.ts` — "actor is STAMPED, never read from the row" seeds an item with
`actor: "user"` and asserts the written figure's `fieldProvenance.actor` is `"agent"` and
`userProvided` does NOT gain the field.

**4. The registry is what may be proposed AND WRITTEN — not merely what is nameable.**
`PROPOSAL_TARGETS` intersects "model-derivable blueprint field" with `PROFILE_WRITABLE_FIELDS`, a
hand-maintained `(keyof BusinessProfile)[]` allowlist, for two reasons, both fix-round regression
guards and both permanent until their stated upgrade path lands:
  - `revenueModel` and `bindingConstraint` are legal, derivable blueprint fields with **no
    `BusinessProfile` slot**. Before this exclusion existed, a proposal for either passed
    `proposalTarget`'s existence check, got merged onto the write object by the applier, and was
    silently dropped by `serializeProfile` on write — a proposal that reported success and changed
    nothing. Upgrade path: widen `BusinessProfile` when a real caller needs to persist either.
  - `primaryGoals` and `knownConstraints` DO have a `BusinessProfile` slot, but it is `string[]`
    while every profile `ProposalTarget` is registered `valueType: "string"` (a scalar). The
    applier merges a bare `value` straight onto that slot with no list-vs-scalar handling — a
    proposal for either would land a plain string on a list field and throw inside
    `serializeProfile`'s `bullets()`. Upgrade path: real list-field handling in the applier
    (multi-value accept, append-vs-replace) — not built yet.
Someone will try to re-add one of these four fields because they ARE legitimate, derivable,
model-nameable blueprint fields; the exclusion is deliberate and both reasons are distinct failure
modes (silent drop vs. loud crash), not one rule stated twice.
*Enforcement:* `proposal.test.ts` — "every profile target names a real, SCALAR-WRITABLE
BusinessProfile key" asserts all four resolve to `null` via `proposalTarget`, and a totality test
over `PROPOSAL_TARGETS` itself would fail if any were re-added without also gaining a scalar slot.

**5. Staleness has ONE authority: `applyFinanceClaims`'s own `isNewerThan` check, at write time, in
the same transaction that reads the authoritative stored time.** `classifyProposal`'s `"stale"`
guard IS computed in the applier, but it is REPORTING ONLY — tallied into the `guards` field of the
`ok:true` result, never used to skip or refuse a write. The applier briefly enforced staleness a
second time (a separately-derived "is this stale" check before calling `applyFinanceClaims`) and
that was removed: two independently-derived notions of "stored time" have no guarantee they keep
agreeing, and a second definition of one rule is exactly the shape of bug this whole subsystem
exists to avoid elsewhere.
*Enforcement:* the doc comment directly above the `classifyProposal` call site in `proposals.ts`
states this explicitly; `cash.test.ts` covers `isNewerThan`/`applyFinanceClaims`'s own staleness
skip, which is the actual gate.

**6. Contacts and follow-ups refuse unconditionally (`writer_refused`), pending the batch consent
attestation the bulk importer already requires (spec §4.2).** Not an oversight: harvested addresses
must never reach a store — and eventually a send path — without consent, and the CSV importer
already built and requires exactly this attestation (`contacts-crm.md`'s `IMPORT_ATTESTATION`).
Marked with a `ponytail:` comment in `proposals.ts` naming the upgrade path: accept an `attestation`
argument on `acceptProposal` and pass it through to `applyCrmOperations`. Refusing is the safe
direction while that argument does not exist.
*Enforcement:* no test currently seeds a contacts/followUps item through `acceptProposal` — this is
a gap, stated here. `proposalTarget` still resolves `contacts`/`followUps` fields (the registry
lists them as legal targets, per the design's "closed registry" model), so a future caller building
a contacts proposal will get PAST the `unknown_target` check and land on `writer_refused` — verify
that refusal path with a real test before ever removing it.

**7. A foreign or missing proposal id is indistinguishable — both return `not_found`.** The
existence check (`!row`) and the tenant check (`row.tenantId !== ctx.tenantId`) are ORed into one
refusal reason, never two, so a refusal itself cannot leak whether a given id exists for a different
tenant.
*Enforcement:* `proposals.test.ts` — "another tenant cannot accept this tenant's proposal" asserts
`not_found`, not a distinct "forbidden" reason.

## How to change safely

**Adding a proposable field to an existing store:**
1. Add it to `CASH_INPUTS` (finance/scorecard) or mark it `derivable: true` in `FIELD_SPEC`
   (blueprint/profile) — never add a target directly into `PROPOSAL_TARGETS`, it is ASSEMBLED, not
   authored.
2. If it targets `profile`, confirm `BusinessProfile` has a matching **scalar** field, then add the
   key to `PROFILE_WRITABLE_FIELDS` in `proposal.ts`. If it does not have a scalar slot yet, this is
   invariant 4's exact trap — widen `BusinessProfile` first, in its own reviewed change.
3. Re-run `pnpm --filter @pikar/core test src/proposal.test.ts` — the totality tests fail loudly if
   the new field is derivable-but-unwritable or absent from its source list.

**Adding a new store to `ProposalStore`:** edit BOTH `proposal.ts`'s `ProposalStore` union and
`schema.ts`'s `target.store` validator (they are two hand-written copies, invariant-adjacent — see
Dependencies). Add a PASS-1 refusal or PASS-2 write branch in `proposals.ts`, update the "one-writer
table" this file documents, and add the new literal to `proposals.test.ts`'s
"every union member round-trips through the validator" table.

**Changing the applier's control flow:** preserve the two-pass shape (invariant 2) — any check that
can refuse for ANY chosen item must be provably reachable before the FIRST writer call, not merely
before its own writer's call. When in doubt, add the check to PASS 1 even if it looks
store-specific; a read is always cheap enough to hoist. Re-run the full `proposals.test.ts` suite,
not just the test for the store you touched — the mixed-batch regression test in invariant 2 is
the one that catches a gate landing in the wrong pass.

**Changing `classifyProposal`/`sweepable`:** these are pure and live in `packages/core`; edit them
there and re-run `proposal.test.ts`'s guard truth table. Remember invariant 5 — a guard change must
never become a SECOND enforcement of staleness inside the applier; it stays reporting-only for
finance facts by design.

## How to verify

```bash
# pure predicates and registry totality — $0, no Convex
cd packages/core && pnpm typecheck && pnpm vitest run src/proposal.test.ts

# the applier, and the three stores it touches through their real writers
cd packages/backend && pnpm typecheck && pnpm vitest run convex/proposals.test.ts convex/cash.test.ts convex/evaluations.test.ts convex/onboarding.test.ts

# biome, from packages/backend / packages/core respectively
npx biome check convex/proposals.ts convex/proposals.test.ts
npx biome check src/proposal.ts src/proposal.test.ts
```

There is no live-deployment or browser check for this subsystem yet — there is nothing reachable
from the product to click on. Once plan 3 lands the derive pass and Approvals surface, this section
gains a browser step; do not treat the unit suites above as proof of end-to-end reachability before
then (see Known gaps).

## Operational notes

No env vars, no seed data, no migration. Every test here runs against `convex-test` — none needs a
live deployment. The one non-obvious harness detail: any test that seeds a finance-targeting item
and calls `acceptProposal` must register the `auditCounts` aggregate component first
(`proposals.test.ts`'s `withAudit()`), because `applyFinanceClaims` always writes an audit row —
omitting it fails with a component-registration error, not a useful test failure.

## Known gaps & deferred work

- **No producer exists.** Nothing outside a test ever inserts a `proposals` row — grep confirms
  zero non-test `ctx.db.insert("proposals", ...)` call sites in this repo. The design doc's plan 3
  (trigger + derive pass + Approvals surface) is what builds `internal.proposals.deriveFromDoc` and
  its chat/voice equivalents. Until that lands, this whole subsystem is fully built, fully tested,
  and **unreachable from the product** — the same shape as this repo's own documented clock-plane
  and phase-19 precedents (a capability can be 100% green and still dead in production). Do not cite
  this playbook's green suites as evidence a user can propose anything; they are evidence the spine
  is correct once something calls it.
- **No frontend surface.** Zero references to `proposals.`, `acceptProposal`, `discardProposal` or
  `listPending` anywhere under `apps/web` — confirmed by search. The design's planned home is a
  "Proposed updates" section inside `/dashboard/approvals` (design doc §4.3), not a new page. Not
  built here.
- **`status: "superseded"` and the `by_tenant_source` index are schema-only.** Built for §6.3
  ("re-ingesting the same document supersedes its prior pending proposal") but nothing sets that
  status yet — plan 3's job, alongside the producer.
- **Contacts/followUps refusal has no test exercising it end-to-end through `acceptProposal`** — see
  invariant 6. Add one when plan 3's attestation argument lands, so the refusal-then-acceptance path
  is proven, not just the refusal.
- **The design doc names the fifth `ProposalStore` literal `"blueprint"`; the shipped code calls it
  `"profile"`.** Naming settled during implementation (it matches `onboarding.ts`'s existing
  `BusinessProfile`/`writeProfileDoc` vocabulary); this is not a drift from the design worth
  chasing, but do not search the codebase for a literal `"blueprint"` target — it does not exist.
- **The design doc's §5 writer table names `applyScorecardAnswer` as the `scorecard` writer.** The
  shipped applier routes BOTH `financeInputs` and `scorecard` through `applyFinanceClaims`/
  `writeFigureRow` instead, because `CASH_INPUTS` already carries a `store` designator per field —
  one writer covers both rather than two. Also not a drift worth chasing; `dashboard-pages.md`
  documents `writeFigureRow`'s per-store dispatch.
