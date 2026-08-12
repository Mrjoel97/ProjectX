# Live finance inputs — the agent reads the numbers and proposes the updates

> Status: design, approved in conversation 2026-08-10. Supersedes nothing; extends
> `2026-08-09-cash-business-finance-design.md`, whose origin vocabulary, staleness rule and
> six-input model this design keeps verbatim.

## Why this exists

The Finance page is correct and inert. Every figure it reasons over — cash on hand, CAC, gross
profit per purchase — arrives by a human typing it into a panel, and stays whatever was typed
until the same human returns. A CAC entered in May is still driving the headline in August.

That is the wrong shape for the product. The figures decay on their own schedule, the owner has
no reason to remember which ones have decayed, and the one participant who *could* notice — the
agent — cannot see the Finance page at all. It grounds on vault documents and is blind to the
numbers those documents are about.

This design closes both halves: the agent gains sight of the tenant's figures, and a governed
path to update them.

## What the exploration changed

Four things were going to be built that already exist. Each is recorded because the naive version
of this design builds all four and ends up with vocabularies that disagree with the stored ones.

1. **The document classifier exists.** `document-classifier` is a seeded registry skill run at
   ingest by `vaultLlm.ts`, and `vaultDocuments` persists `docType`, `identityLine` and
   `docTypeSource`. Its closed vocabulary is twelve values — `pnl`, `balance_sheet`, `cash_flow`,
   `invoice`, `contract`, `policy`, `deck`, `report`, `plan`, `correspondence`,
   `spreadsheet_other`, `unclassified`. This design reads that column; it adds no classifier.
2. **Format detection exists.** `sniff.ts` (`sniffContainer`, `ole2Kind`, `resolveRail`) and
   `extractKind.ts` (`extractionKindFor`) already distinguish PDF / Office / image / legacy
   `doc`-`ppt`-`xls`, and `vaultDocuments.mimeType` is stored on every row.
3. **Vault-to-figure extraction exists.** The Business Evaluation Engine grounds via
   `vaultGroundHydrated` and fills the Scorecard from grounded text, carrying
   `Provenance { title, confidence, source }` per field. What it does not do is *propose* — its
   header states the two-shapes rule, and it is the read-only side.
4. **The governance pattern exists.** `contacts-crm.md` invariants 11 and 13, shipped in 19-06:
   the ACTOR decides gating, not the operation; and one row-writer serves both actors.

One thing was found broken. **Grounded figures already reach the Finance page and render as
though the owner stated them.** `cash.ts` resolves scorecard-stored fields out of the latest
evaluation row, and a grounded fill lands in that same Scorecard; only the `userProvided` list
separates the two, and the page reads it solely for the staleness clock. The four-origin
vocabulary is specified and not enforced at the boundary. This design closes it, because it is
the same read boundary the design rewrites.

## Section 1 — the claim model and the write path

### One shape from every source

```
FigureClaim {
  field       // a member of the closed CASH_INPUTS vocabulary — never free text
  value       // number, validated by the existing validateCashInput
  origin      // "stated" | "observed"
  actor       // "user" | "agent"
  basis       // refs / ids / labels ONLY — never quoted content (CLAUDE.md §4)
  observedAt  // epoch ms: when the figure was TRUE, not when the row was written
  confidence  // "high" | "medium" | "low" — reusing evaluations.ts's Provenance vocabulary
}
```

`origin` stays the display vocabulary the prior spec defined. `actor` is what invariant 11 gates
on. The two are independent: a figure the agent heard the owner say is `stated` by a human and
written by an agent.

Two clarifications the vocabulary otherwise invites arguments about:

- **Every claim this slice stores is `origin: "stated"`.** A figure read out of the owner's own
  P&L is still an assertion by a human, made in a document; `observed` means *Pikar measured it*,
  and measured figures are a later slice. `observed` is in the union because the read boundary
  must be able to return it without a schema change, not because anything writes it yet.
- **`actor: "user"` is always `confidence: "high"`.** A typed figure has no extraction step to be
  uncertain about. Confidence grades extraction, not truth.

### `finance_write` is the sixth action type

`ACTION_TYPES` gains `finance_write` as an **`inline`** arm, beside `crm_write`. This is the same
mechanism, one phase later, and it is chosen over a finance-local queue because `actionType.ts`
argues at length against "two Approve stories instead of one".

The closure is load-bearing: the arm table in `cockpit.ts` makes a member without an arm a compile
error, and the Approvals page's `Record<PlanKind, string>` breaks before anything ships. A
half-added governed action is not expressible.

### One writer, two actors

Following invariant 13 exactly:

- `writeFigureRow(db, tenantId, claim)` — a plain async function over an explicit `tenantId`.
- `cash.saveInput` (the ungated human edit) becomes a one-line delegation to it.
- `applyFinanceClaims`, called **only** by `executePlan`, calls the same function per claim.

`tenantId` is injected by the wrapper at the public call site and read off the approved plan row
at the applier. It is never model-supplied, so this does not widen the tenant boundary.

### Three decisions worth stating

**`observedAt` is not `statedAt`.** `saveInput` currently writes `statedAt: Date.now()`. A P&L
dated 31 July, read on 10 August, describes a figure that is already six weeks into its 90-day
staleness clock. Writing "now" resets a clock that should not be reset. The stored time is when
the figure was true; `needsConfirmation` continues to measure against it unchanged.

**`basis` is a reference, never a quotation.** `"vault:<docId>#p3"`, `"user statement, turn 4"`,
`"14000 / 10, turn 4"`. It reaches the audit log and the approval card, and §4 forbids raw
content in either.

**Origin is returned, not inferred.** The read boundary stops deducing origin from membership of
`userProvided` and returns the stored provenance. This is the leak fix.

### Schema

`financeInputs` gains `origin`, `actor`, `basis`, `observedAt`, `confidence`. The scorecard-stored
fields (`financials.*`) gain the same provenance through the `applyScorecardAnswer` carrier, so
both stores answer the origin question the same way. Existing rows have no provenance: they read
as `origin: "stated"`, `actor: "user"`, `observedAt: statedAt` — which is what they are. No
backfill, no migration.

## Section 2 — how the agent reads the numbers

Two context channels exist and split by cost. The spine is assembled on **every** turn; tools are
paid for only when called.

### The spine carries state, not analysis

One char-budgeted line, extending the budget Phase 19's goals work established:

```
Finance: cash 38.5k(38d) · opcost 12k(38d) · CAC 1400(94d STALE)
       · 30d-cash ? · GP/purchase 4500(12d) · purchases/life 3.2(12d)
```

Values, ages, `?` for unknown, `STALE` past `needsConfirmation`. About 150 characters. The
existing worst-case spine budget test is extended, not replaced — the finance line is included in
the same proof, at the longest values the vocabulary permits.

### `readFinance` carries the derived detail

A tool returning `unitEconomics()`, `solvency()`, the active tier set, the headline and its
suppression reasons.

**The agent never computes a financial ratio.** It reports what the pure functions in
`packages/core/src/cash.ts` return. The degenerate guards, the suppression rule and the
never-infinite runway are tested pure logic; a model re-deriving LTGP:CAC in prose produces a
confident wrong number on the figure that drives the headline. The tool exists so that the
correct value is always cheaper to fetch than to invent.

### Staleness stops being passive

The `STALE` marker plus a skill-body rule: when a figure is stale or unknown **and relevant to
what the owner is asking**, search the vault first, then ask. The relevance clause is the cost
control — without it every conversation opens with an interrogation about CAC.

## Section 3 — the two sources

### B — conversation

Two cases:

| Owner says | Claim |
|---|---|
| "our CAC is about $1,400 now" | `cac = 1400`, `basis: "user statement, turn N"` |
| "we spent 14k on ads and got 10 customers" | `cac = 1400`, `basis: "14000 / 10, turn N"` |

The boundary on model arithmetic: **the agent may arrive at an input, never at a derived metric.**
CAC is one of the six inputs. `LTGP:CAC` is a definition owned by `financialSpine.ts`. Even for
inputs, the working goes in `basis`, renders on the approval card, and passes `validateCashInput`.

### C — vault documents

Retrieval reuses `vaultGroundHydrated`. Extraction reuses the evaluation engine's `Provenance`.
The new part is that a grounded figure becomes a staged claim rather than a silent Scorecard fill.

Three rules:

1. **The document's date becomes `observedAt`.**
2. **Propose only if the document is newer than what is stored** — one comparison on `observedAt`.
   A figure typed three days ago is not challenged by a July P&L.
3. **`low` confidence asks instead of staging.** A confidently-wrong number is worse than none;
   a low-confidence one that costs an approval click is noise.

### `docType` gates which fields a document may claim

Read from the stored column. The table is pure and lives in `@pikar/core`:

| `docType` | May claim |
|---|---|
| `balance_sheet` | `cashOnHand`, `receivables`, `payables` |
| `cash_flow` | `cashOnHand`, `monthlyOperatingCost` |
| `pnl` | `monthlyOperatingCost`, `mrr` |
| `spreadsheet_other` | any input the sheet **labels** — see below |
| `invoice` | *nothing* — one transaction is not an aggregate |
| all others, `unclassified` | *nothing* — may prompt a question |

"Labels" is checkable, not a judgement call: the extraction must return the **verbatim row or
column heading** it matched, that heading goes in `basis`, and a claim whose matched label is
empty is dropped. A tracker with a `Cash in bank` column can claim `cashOnHand`; a grid of bare
numbers claims nothing. This keeps `spreadsheet_other` — the bucket every unrecognised
spreadsheet falls into — from becoming a wildcard.

`pnl` is deliberately not allowed to claim `grossProfitPerPurchase`: a P&L reports period totals,
not per-unit figures, unless it also states unit counts — and a per-purchase average derived from
a period total is exactly the plausible-looking wrong number this table exists to stop.

**The table may only narrow.** A misclassification then costs a missed proposal, which is safe,
rather than a bad write, which is not. `docTypeSource` is respected: an owner-corrected label
(VALT-12) is authoritative.

**Retrieval is filtered by `docType` before grounding.** Finance-bearing types only. This is
cheaper and more accurate than a semantic query over the whole vault, because it filters on a
stored column rather than an embedding guess.

## Section 4 — honesty and failure states

- **Fail open on grounding.** A retrieval or extraction hiccup yields no proposals, never a throw
  — the `SC1` precedent. The Finance page renders unchanged.
- **A rejected claim is not re-proposed.** Same `field` + `value` + `basis` stays quiet.
- **Validation at the trust boundary.** `validateCashInput` runs on every claim from every source.
  Model-supplied numbers are untrusted input; the laziness ladder does not apply here.
- **Audit carries no values.** `finance.claims_staged` / `finance.claims_applied` record field
  names, counts, `origin`/`actor`/`confidence` enums and doc-id refs. Never the figures. §4
  forbids the audit log becoming a PII honeypot, and tenant revenue is exactly that.
- **`tenantId` is never model-supplied.**
- **Nothing writes without approval.** There is no direct-write path for `actor: "agent"`.

### Display

Pending claims render on the Finance tile they target — `$42,000 → $38,500`, with
`identityLine` and a click-through to the document. The approve action links to the single
Approvals surface. Shown in two places, decided in one.

## Section 5 — code, tests, ship order

### Placement (CLAUDE.md §1)

| Where | What |
|---|---|
| `packages/core/src/financeClaim.ts` | `FigureClaim`, claim validation, the `docType` table, newer-`observedAt`-wins |
| `packages/core/src/cash.ts` | the spine finance line; origin returned rather than inferred |
| `packages/core/src/actionType.ts` | `finance_write` in `ACTION_TYPES` |
| `packages/backend/convex/cash.ts` | `writeFigureRow`; `saveInput` delegates; `applyFinanceClaims` |
| `packages/backend/convex/cockpit.ts` | the `finance_write` inline arm |
| `packages/backend/convex/llm.ts` | `stageFinanceWrite`, `readFinance` |
| `packages/contracts/skills/cockpit-agent.md` | the staleness/relevance rule and the arithmetic boundary |
| `apps/web/app/(app)/dashboard/finance/` | pending-claim display on the tile |
| `apps/web/app/(app)/dashboard/approvals/` | the sixth badge / title / action-label trio |

### Tests

| Layer | Proves |
|---|---|
| Pure core | Claim validation; the `docType` table; newer-`observedAt`-wins; the spine line at its **worst-case** char budget |
| Convex | A staged claim writes nothing until approved; `executePlan` is the only caller of `applyFinanceClaims`; a rejected claim leaves the row untouched; `low` never stages; tenant isolation |
| Compile-forced | The `ACTION_TYPES` arm table and Approvals' `Record<PlanKind, string>` |
| Eval | One golden fixture for the conversation source; fixture floor 35 → 36 |
| Browser | The pending-claim strip on a Finance tile |

### Ship order

1. Provenance columns + `writeFigureRow` + origin returned at the read boundary (the leak fix).
2. `finance_write` action type, arm, applier, Approvals trio.
3. The spine finance line and `readFinance`.
4. `stageFinanceWrite` + the skill-body edit + the eval fixture + one full `EVAL_GATE` cycle.
5. The vault source: `docType`-filtered retrieval, claim extraction, the allowed-fields gate.
6. Finance-tile display of pending claims.

Steps 1–3 ship no agent behaviour and are independently verifiable. Step 4 is the first step that
changes what the cockpit does.

### Budget

One full `EVAL_GATE` cycle is **~$0.35**, per `skill-registry.md`'s own evidence row — not the
~$0.12 that stale plans quote. Falsify a new fixture with `--only <n>` before it ever executes
inside the gate.

### Playbooks (§9)

`dashboard-pages.md`, `cockpit.md`, `vault.md`, `business-evaluation.md`, `skill-registry.md` —
all five are watch-listed on paths this touches.

## Out of scope

- **Connectors (Stripe / QuickBooks).** Still Phase 28. They become a fourth source feeding the
  same `FigureClaim` substrate, replacing `stated` with `observed`, with no redesign here.
- **Measured `observed` figures** (reach-outs from `plans.sentCount`, media spend from the Cost
  ledger). A small later slice against the same substrate. Deferred deliberately: Pikar has no
  customers-acquired signal, so measured data cannot move CAC or any ratio — it would be visible
  automation that does not touch the figures this design is about.
- **Extraction on upload.** Rejected on cost: it spends tokens on every document regardless of
  content and surfaces approval items nobody asked for.
- **A second approval plane.** Rejected on precedent.

## Open questions

None blocking. Two to revisit after the first slice is live:

1. Whether the matched-label rule is enough to keep `spreadsheet_other` honest. It is the owner's
   own running record and plausibly the most authoritative source for `cashOnHand`, but it is
   also the bucket every unrecognised spreadsheet falls into, and a heading match is a weaker
   guarantee than a document type.
2. Whether the 90-day staleness threshold should vary by metric before this ships rather than
   after — cash on hand decays far faster than purchases-per-lifetime, and an agent that acts on
   staleness makes a wrong threshold louder than a page that merely displays it. This inherits
   open question 1 from the prior spec.
