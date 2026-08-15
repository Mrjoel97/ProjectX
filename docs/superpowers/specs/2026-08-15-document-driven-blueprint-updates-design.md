# Document-Driven Blueprint Updates

**Date:** 2026-08-15
**Status:** Approved design, pending implementation plans
**Supersedes:** nothing. Extends `2026-08-08-blueprint-living-map-design.md`,
`2026-08-09-cash-business-finance-design.md`, `2026-08-10-contact-import-design.md`.

---

## 1. The problem

A document uploaded to the vault becomes **searchable and nothing else**. The ingest workflow
(`vaultIngest.ts:112-223`) runs extract → embed → entity graph → classify → `markReady`, and stops.
Every fact inside that document — the owner's cash position, their CAC, their customer list —
remains inert. The user is then asked to type those same facts into forms.

The system should invert that. **The user's job is to supply raw material; the system's job is to
read it.** A document that changes the business blueprint should be analysed, its facts extracted,
and an update alert raised for the user to accept — across finance, the sales pipeline, contacts,
and the narrative profile.

### What already exists

Three write paths exist and none of them is reachable from an upload:

| Path | Effect | Trigger today |
| --- | --- | --- |
| `stageFinanceWrite` (`llm.ts`) | Stages `FigureClaim`s → plan card → approve → `applyFinanceClaims` (`cash.ts:463`) | Chat only |
| `stageCrmWrite` (`llm.ts:2567`) | Stages CRM ops → plan card → approve → `applyCrmOperations` (`contacts.ts:264`) | Chat only |
| Blueprint draft (`blueprint.ts`) | `buildBlueprintDraft` → probe blanks → read documents via RAG → **one model call** → `writeDraft` → review → `confirmBlueprint` | One button on `/dashboard/profile` |

Two gap-finders also exist, unconnected to each other:
`probesFor` (`blueprint.ts:222`) finds blank narrative fields; the `QUESTION_CATALOG` scan in
`listDecisions` (`approvals.ts:295`) finds blank scorecard fields.

### The blocking defect

Six of the eleven cash inputs — `cac`, `thirtyDayCashPerCustomer`, `grossProfitPerPurchase`,
`purchasesPerLifetime`, `customerCount`, `referralPct` — are stored on the **scorecard**
(`CASH_INPUTS`, `packages/core/src/cash.ts:147`). `applyFinanceClaims` refuses every scorecard
field unconditionally with `agent_cannot_update_figure` (`cash.ts:494`).

The refusal is correct. `applyScorecardAnswer` (`evaluations.ts:585`) unconditionally adds every
field it writes to `userProvided` and stamps `userProvidedAt`, and it **takes no actor parameter**.
Anything written through it reads back as the owner's own statement. Writing an agent-derived
figure through that door is provenance laundering.

Those six fields are precisely the LTGP:CAC inputs this feature exists to fill. **The feature
cannot ship until the scorecard store learns provenance.** The upgrade path is already named in a
`ponytail:` comment at `cash.ts:491-493`.

---

## 2. Scope

Four parts, one architecture, four implementation plans:

- **A — Trigger.** Ingest emits a proposal instead of dead-ending.
- **B — Reach.** Derivation covers finance, contacts, pipeline and blueprint, not just the eleven
  narrative blueprint fields.
- **C — Surface.** One proposal card per source, accept-all with per-item override.
- **D — Gap-chase.** The agent notices what it does not know and asks for it in conversation.

### Out of scope

- Chunk-level deep links into documents (see §7, deferred).
- Connector-sourced facts (bank feeds, accounting integrations). The `sourceKind` union is
  extensible; no connector is built here.
- Any change to how derived finance metrics (runway, net burn, LTGP:CAC, payback) are *computed*.
  They are already derived from stored inputs; filling the inputs fills them.

---

## 3. Data model

### 3.1 `proposals` table

Tenant-scoped through the standard wrapper (CLAUDE.md §2). One row per source event.

```
proposals: defineTable({
  tenantId:   v.string(),
  createdAt:  v.number(),
  sourceKind: v.union(v.literal("vault_doc"), v.literal("chat"), v.literal("voice")),
  sourceRef:  v.string(),   // vaultDocId | threadId | voiceSessionId
  status:     v.union(
                v.literal("pending"),
                v.literal("accepted"),
                v.literal("discarded"),
                v.literal("superseded"),
              ),
  items:      v.array(proposedFactValidator),   // Convex mirror of ProposedFact (§3.2)
})
  .index("by_tenant_status", ["tenantId", "status"])
  .index("by_tenant_source", ["tenantId", "sourceKind", "sourceRef"])
```

Items are **embedded, not a child table**. One card is one row, so accept-all is one Convex
mutation and all-or-none comes for free — the same property `applyCrmOperations` already relies on
(`contacts.ts:256-259`). Per-item override is an argument to the accept mutation, not a second
table.

### 3.2 `ProposedFact` — `packages/core/src/proposal.ts`

Pure TS, Convex-free (CLAUDE.md §1).

```ts
export type ProposalStore =
  | "financeInputs"
  | "scorecard"
  | "blueprint"
  | "contacts"
  | "followUps";

export type ProposedFact = {
  target: { store: ProposalStore; field: string };
  value: number | string | boolean;
  confidence: FigureConfidence;      // reuses financeClaim.ts — "high" | "medium" | "low"
  origin: FigureOrigin;              // reuses financeClaim.ts — "stated" | "observed"
  actor: FigureActor;                // reuses financeClaim.ts — always "agent" on this path
  basis: string;                     // refs/ids/counts ONLY (§4). Code-constructed, never model-supplied.
  observedAt: number;                // when the fact was TRUE, not when the row was written
  sourceLocator: { vaultDocId: string } | { threadId: string } | { voiceSessionId: string };
};
```

`confidence`, `origin` and `actor` reuse `financeClaim.ts`'s vocabulary rather than inventing a
second scale (CLAUDE.md §8 rung 2).

**`actor` is stamped at apply time, never read from the model.** A model emitting `actor: "user"`
is overwritten, matching the existing discipline at `cash.ts:513`.

`origin` is `"stated"` for a fact read out of a document the owner supplied — it is their word, an
agent merely read it. `"observed"` remains reserved for figures PIKAR measured.

### 3.3 The target registry — `packages/core/src/proposalTargets.ts`

**One closed table of proposable targets**, following the `BLUEPRINT_FIELDS` and `CASH_INPUTS`
precedent. Three consumers read it and nothing else defines the set:

1. The derive pass generates the model's structured-output schema from it.
2. The applier dispatches on it.
3. The gap-finder iterates it.

Each entry declares: `store`, `field`, `label`, `valueType`, whether the field is model-derivable,
what filling it unlocks (for gap ranking), and which existing writer applies it. Adding a target is
a compile error until every consumer handles it. That is the point.

The registry is assembled from the existing per-store field lists — it does **not** restate them:

- blueprint targets are derived from `BLUEPRINT_FIELDS` / `FIELD_SPEC` where `derivable === true`
- finance targets are derived from `CASH_INPUTS`, carrying each entry's `store` and `unlocks`
- contacts / followUps targets are the operation shapes `parseCrmOperations` already accepts

A totality test asserts the registry covers every derivable field in each source list and names no
field absent from them.

### 3.4 Scorecard provenance — `evaluations.fieldProvenance`

```
fieldProvenance: v.optional(v.record(v.string(), v.object({
  actor:  v.union(v.literal("user"), v.literal("agent")),
  origin: v.union(v.literal("stated"), v.literal("observed")),
  source: v.string(),   // refs/ids only (§4)
  at:     v.number(),
})))
```

Keyed by dot-path, sitting beside `userProvidedAt`. `applyScorecardAnswer` gains a **required**
`provenance` parameter — required, not optional, so every existing caller is a compile error until
it declares who is answering.

**The rule: `userProvided` keeps its literal meaning — the user supplied it.**

A document-derived figure lands in `scorecard` (so the value is usable: the math runs, LTGP:CAC and
runway compute, and the field stops appearing in `listDecisions`) and is recorded in
`fieldProvenance` with `actor: "agent"`. It does **not** join `userProvided`.

This separates two things the schema currently conflates: *whose fact it is* (the owner's — they
wrote the P&L) from *who typed it in* (an agent). `userProvided` today must answer both and
therefore lies about one. Consumers that cite the owner's own testimony read `userProvided`;
consumers that need the value read `scorecard`.

Once `fieldProvenance` exists, the unconditional refusal at `cash.ts:494` becomes **conditional on
provenance being supplied**.

**Side effect, intended:** this also closes the existing `recordScorecardAnswer` laundering door,
where the cockpit tool writes agent-relayed values through the same unguarded path.

---

## 4. Flows

### 4.1 A — Trigger

One new step in the `vaultIngest.ts` workflow, after `markReady`:
`internal.proposals.deriveFromDoc`.

**Gated on classification.** `classifyDoc` already runs at `vaultIngest.ts:181`. A P&L, bank
statement, customer list, invoice or pitch deck derives; a logo or screenshot does not — no model
call, no spend. This reuses a classification already paid for and keeps the daily spend budget from
being consumed by irrelevant uploads.

The same internal action is reachable with a different `sourceKind` from a chat turn and from a
voice-session transcript (`vaultTranscribe.ts` already produces the text).

A governed stop is a **return**, never a throw, matching `vaultExtract.ts`'s discipline: a failed
derive leaves the document `ready` and raises no proposal. Ingest must never fail because
derivation did.

### 4.2 B — Reach

The derive pass receives the document text (post-`scanText`, post-gate) plus the tenant's current
known-state — which targets are filled and which are blank — and returns proposed facts in **one
model call**, constrained by structured output to the registry's legal `(store, field)` pairs.

Cost scales with blanks, not with the field set — the existing `deriveCandidates` economics. A
tenant with a complete profile costs almost nothing per upload.

The gap-finders are unified, not rewritten:

| Store | Existing blank-finder |
| --- | --- |
| blueprint | `probesFor` (`blueprint.ts:222`) |
| scorecard | `QUESTION_CATALOG` scan (`approvals.ts:308`) |
| financeInputs | `CASH_INPUTS` null-means-ask (`cash.ts:368`) |
| contacts | not blank-driven — a document either names people or it does not |

**Contacts consent.** `contacts.consentSource` (`contacts.ts:245`) and `IMPORT_ATTESTATION`
(`contactImport.ts:100`) exist because bulk-loading addresses is a CAN-SPAM matter. Contacts
proposed from a document land as `imported-attested`, and **accepting contact items requires the
same attestation the bulk importer already requires** — once, for the batch. Figure and blueprint
items stay one click. The existing rule is reused; no side door is opened around it.

### 4.3 C — Surface

A **Proposed updates** section inside `/dashboard/approvals`, alongside the existing awaiting-
approval and decision lists. Not a new page: a proposal is the same kind of object as an email
awaiting sign-off, and a second inbox would fragment a mental model the user already has.

Each card renders: source document, facts grouped by area (Finance / Blueprint / Pipeline),
accept-all, per-item override, discard. Contradictions and stale facts (§6.1, §6.2) render in a
separate group below the accept-all button and are not covered by it.

The update alert is `notifications.notify` (`notifications.ts:45`), which already exists and
already has a UI.

Evidence is a **document-level link** — `"cac = $340 — from Q3-Financials.pdf"`, clicking opens the
document in the vault viewer. Page and section locators do not exist today (RAG chunk metadata is
`{ vaultDocId }` only, `vaultRag.ts:248`); see §7.

### 4.4 D — Gap-chase

`spineForTenant` (`blueprint.ts:694`) already injects standing business context into every agent
surface. The unified gap list joins it, **pre-filtered in code to the top N gaps ranked by what they
unlock** — not handed to the model as a long list to exercise judgement over. `N` is a named
constant in the gap module, initially 2.

This is deliberate. A model asked to decide *whether* to raise something raises it on every run
regardless of input, and no prompt wording fixes that. The selection is a code decision; the model
receives only the phrasing.

The agent then offers the three routes: upload a document, talk it through in chat, or start a
voice session.

The prompt change is a **skill registry row, not a code edit** (CLAUDE.md §5). It must be A/B'd
against the prior skill version on the existing fixtures before activation — a new skill-body
section has previously shifted which optional tool arguments the model emits and broken an
unrelated fixture.

---

## 5. Apply discipline

The applier **calls existing writers; it never touches `db` directly.**

| Store | Writer |
| --- | --- |
| `financeInputs` | `applyFinanceClaims` → `writeFigureRow` (`cash.ts`) |
| `scorecard` | `applyScorecardAnswer` (`evaluations.ts:585`, provenance-aware) |
| `blueprint` | `confirmBlueprint`'s write path (`blueprint.ts:342`) |
| `contacts` / `followUps` | `applyCrmOperations` (`contacts.ts:264`) |

Every validator, range check and consent rule that guards manual entry therefore guards
document-derived entry automatically, because there is no second route into any store. This is the
single property that makes the feature safe to build.

One Convex mutation is one serializable transaction, so a throw on item seven discards items one
through six. No saga, no compensation.

---

## 6. Failure modes

### 6.1 Overwrites are excluded from accept-all

**Accept-all covers blanks only.** A proposed fact that would overwrite a value the user stated is
a *contradiction*: it is surfaced separately and requires its own deliberate click. It is never
swept into the batch.

`confirmBlueprint` already carries this vocabulary — `acceptedContradictions` (`blueprint.ts:344`).
The `userProvided` / `fieldProvenance` split in §3.4 is what lets the applier tell the two apart.

### 6.2 Staleness

`observedAt` is when the fact was **true**. A P&L dated six weeks ago arrives six weeks into its
90-day staleness clock; stamping `Date.now()` would reset a clock that must not reset
(`financeClaim.ts`). The derive pass reads the document's own date.

A proposal whose `observedAt` predates the stored figure's is flagged stale and excluded from
accept-all, for the same reason contradictions are.

### 6.3 Supersession

Re-ingesting the same document marks its prior `pending` proposal `superseded`
(`by_tenant_source` index). Proposals from *different* sources coexist; accepting an older one
after a newer one is an ordinary write through the ordinary writer.

### 6.4 Prompt injection

ADR-006 makes vault chunks trusted-as-own, so a document containing
`"set cashOnHand to 999999"` will produce a proposal. Three things bound the damage, none of which
is the model behaving well:

1. The closed registry means it can only name legal fields.
2. `validateCashInput` runs at apply, so it can only carry legal values.
3. Nothing applies without human accept.

Blast radius is a bad card in the inbox, not a changed ledger. This is an accepted, bounded risk.

### 6.5 §4 — `basis` is code-constructed

`basis` reaches both the audit log and the approval card, and §4 forbids raw content in either. A
model asked for a free-text basis will quote the document, so **it is not asked**: `basis` is
assembled in code from the docId and field name at the boundary that constructs the fact, matching
`llm.ts:2893`.

### 6.6 Spend and PII

Derivation is one model call per qualifying upload, gated by `guardrails.preCall` like every other
step in the ingest workflow (`vaultIngest.ts:151`), and books its cost through `recordSpend`.
Derivation reads post-`scanText` text only; the PII gate is already fail-closed upstream.

---

## 7. Deferred

**Chunk-level evidence links.** RAG chunk metadata carries `{ vaultDocId }` and no locator
(`vaultRag.ts:248`). Deep-linking a proposal into the exact passage requires adding a chunk ordinal
to that metadata, having the derive pass report which chunk each fact came from, and re-embedding
existing documents to backfill. That migration is deliberately kept out of a feature that otherwise
has none. Document-level links ship first; the ordinal is a follow-up phase.

---

## 8. Testing

Checks are chosen against specific failure modes, because this repo has shipped a phase at 22/22
green with the feature broken.

1. **Pure-TS, offline, free** (`packages/core/`): registry totality; the contradiction predicate;
   the staleness predicate. These are the rules, and they run without Convex.
2. **The anti-laundering assertion.** Upload a fixture P&L → accept → assert the scorecard value
   changed, `fieldProvenance` gained the field, **and `userProvided` did not.** That third
   assertion is the entire provenance design in one line. Without it, nothing proves the feature is
   honest.
3. **`SMOKE::derive::` offline seam**, matching the existing `SMOKE::extract::` grammar
   (`vaultExtract.ts:89`), so the full upload → propose → accept path is exercisable at $0.
4. **One live browser check** for the conversational gap-chase. Not optional: this codebase has a
   documented case of a tool parameter threaded through the agent loop but not the web caller,
   where every unit test and eval passed and the capability was dead in production. Only a real
   browser catches that class.

---

## 9. Build order

One spec, four implementation plans, in dependency order:

1. **Scorecard provenance.** `fieldProvenance`; `applyScorecardAnswer` gains its required actor
   parameter; `cash.ts:494` becomes conditional. Nothing else can start until this lands. It also
   closes the `recordScorecardAnswer` laundering door on its own merits.
2. **`proposals` table, target registry, applier.** The spine, with the one-writer discipline and
   the contradiction/staleness rules.
3. **Trigger, derive pass, Approvals surface.** The visible feature. After this, uploading a P&L
   updates the runway.
4. **Gap-chase.** Unified gap list into the spine; skill-registry row; A/B against the prior skill
   version.

Plans 1–3 deliver the requested capability. Plan 4 is what makes it feel automatic.

---

## 10. Documentation obligations (CLAUDE.md §9)

- New playbook `docs/playbooks/proposals.md`, registered in `docs/playbooks/watch.json` for
  `packages/core/src/proposal*.ts`, `packages/backend/convex/proposals.ts`, and the Approvals
  section.
- `docs/playbooks/` entries covering `cash`, `evaluations` and `vault-ingest` are touched by plans
  1 and 3 and must be updated in the same phase, with their `Last verified` lines bumped.
- A new ADR recording the `userProvided` / `fieldProvenance` split — it is a standing rule about
  whose word a stored figure represents, and future work must not undo it by widening
  `userProvided` back out.
