# The Business Blueprint — a standing spine for every agent

> Status: DESIGN — awaiting owner review
> Date: 2026-07-27
> Subsystems: Knowledge Vault (`docs/playbooks/vault.md`), Onboarding / Business Profile
> Scope pieces A (folder ingest) and D (visual rendering) are deliberately OUT — see
> [Out of scope](#9-out-of-scope).

## 1. Problem

Every agent surface in Pikar reaches the user's business through exactly one function:
`vaultGroundHydrated` (`packages/backend/convex/vaultGround.ts:126`). Its callers are the cockpit
tool loop (`llm.ts`), onboarding (`onboarding.ts`), the evaluation engine (`evaluations.ts`), the
voice-doc flow (`voiceDoc.ts`), and `tenantProfile.ts`.

That function is a **per-query RAG search**, capped at `TOTAL_CHAR_CAP = 8000` chars
(`vaultGround.ts:30`). It answers *"which passages mention X"*. It never answers *"what IS this
business"*.

The consequence: an agent only knows the parts of the business that the current query happened to
retrieve. A cockpit turn about an email to a supplier retrieves supplier passages; it has no idea
what the business sells, to whom, or what constrains it, unless those words appear in the query.
The agent is not under-informed because the vault is empty — it is under-informed because
retrieval is the wrong instrument for standing context.

### 1.1 Three partial blueprints already exist and none of them is the whole

| # | Artifact | Where | Why it isn't enough |
|---|---|---|---|
| 1 | Business profile | `packages/core/src/businessProfile.ts` | 8 fields, hand-typed. Correct but thin, and never derived from what the user uploaded. |
| 2 | Entity graph | `graphNodes` / `graphEdges`, `schema.ts:645` | A real map of people/orgs/projects, extracted per document — used **only** to hop-expand retrieval seeds (`vaultGraph.expand`). Never rendered, never reasoned over as a whole, never shown to the user. |
| 3 | Evaluation scorecard | `evaluations.ts:250-320` | Already reads documents into a structured model with per-field provenance and citations. But it is query-scoped, run for evaluation, and not agent-facing context. |

Nothing synthesises across the **whole corpus**, and nothing hands the result to agents as standing
context.

## 2. What this builds

A **blueprint**: one compact, structured, cited artifact describing the business, which

1. is **typed by the user** where they have typed it, and **derived from their documents** where
   they have not,
2. requires the user's confirmation before any inference reaches an agent,
3. is **prepended to every grounding call**, so no agent ever operates without knowing the shape of
   the business,
4. is rebuilt on demand, diffed against the live version, and **can never silently overwrite typed
   content**.

### 2.1 Locked decisions (owner, 2026-07-27)

| # | Decision |
|---|---|
| D1 | **Standing spine + retrieval**, not spine instead of retrieval. The blueprint is always present; RAG still runs on top for specifics. |
| D2 | **Draft → user confirms → live.** Inferences never reach agents unconfirmed. Consistent with `decideConfirm` / SC#1 (`businessProfile.ts:78`). |
| D3 | **Auto-detect drift, propose an update**, with a diff. Not a cron by default. |
| D4 | Blueprint content = **profile fields + graph entities**, one artifact. |
| D5 | **Typing is never removed and never overwritten.** Both entry routes (type it / upload it) are permanent and compose. A one-line edit must cost no model call and no confirm step. |

## 3. Architecture

```
typed profile doc ──┐  (authoritative, free)
graphNodes.degree ──┼──→ synthesize ──→ DRAFT  (tenantProfiles, off-vault)
vault documents ────┘   (one model call)     │
                                             │  diff vs live — pure, no model call
                                             ↓
                              user confirms on /dashboard/profile
                                             ↓
                              LIVE blueprint (vaultDocuments)
                                             ↓
                              vaultGroundHydrated prepends it
                                             ↓
              cockpit · onboarding · evaluations · voiceDoc · tenantProfile
```

### 3.1 The live blueprint is a vault document

A `vaultDocuments` row with `kind: "business_blueprint"`. This is the precedent the profile doc set
(`onboarding.ts:486` — *"NEW free-string kind — ZERO schema migration"*). It inherits tenant
scoping, embedding, delete-cascade, PII redaction, the audit trail, and the `by_kind` index at no
cost.

Content is deterministic markdown from a new pure module `packages/core/src/blueprint.ts`
(`serializeBlueprint` / `deserializeBlueprint`), mirroring the `serializeProfile` /
`deserializeProfile` pair and round-trip tested identically. Determinism matters for the same
reason it does on the profile doc: re-embedding on change replaces cleanly and diffs stay
meaningful.

#### The field set

Fixed and closed — a blueprint is not an open bag of keys, or the diff and the spine cap both
become unbounded.

| Field | Source | Probe when blank |
|---|---|---|
| `name` | profile | no — never inferred, the user names their own business |
| `oneLineDescription` | profile | yes |
| `stage`, `tier` | `tenantProfiles` (derived facts) | no — `deriveTier` owns these already |
| `offering` | profile → docs | yes |
| `targetCustomer` | profile → docs | yes |
| `revenueModel` | docs only (new) | yes |
| `bindingConstraint` | docs only (new) | yes |
| `primaryGoals[]` | profile → docs | yes |
| `knownConstraints[]` | profile → docs | yes |
| `entities[]` | `graphNodes` by degree | no — DB read, never a model call |

`revenueModel` and `bindingConstraint` are the only two fields that do not exist on
`BusinessProfile` today. They are added to the blueprint type, **not** to `BusinessProfile` — that
type is a documented downstream contract read by the Phase 12 evaluator
(`businessProfile.ts:22-24`), and widening it drags the evaluator, the onboarding validator, and
the profile form along for two fields only the blueprint uses.

### 3.2 The draft is deliberately NOT a vault document

A draft stored as a vault row would embed into RAG, and unconfirmed inferences about the business
would surface in retrieval **before anyone approved them** — the D2 confirm gate would leak through
the back door.

The draft therefore lives as three optional fields on `tenantProfiles` (already one row per tenant,
`schema.ts:747`):

```ts
// The pending draft — never embedded, never retrievable.
blueprintDraft:   v.optional(v.string()),   // serialized draft markdown
blueprintDraftAt: v.optional(v.number()),
// Bookkeeping for the LIVE blueprint (the doc itself lives in vaultDocuments; this is the
// Stage-1 drift comparison set, kept here so the check is one indexed row read, not a scan).
blueprintSourceDocIds: v.optional(v.array(v.string())),
```

Optional fields on an existing table ⇒ no migration. Structurally keeps the draft out of every
retrieval path.

*Considered and rejected:* a `blueprintDrafts` table — a whole table for one optional blob.

### 3.3 The injection seam is one function

All five agent surfaces call `vaultGroundHydrated`. The live blueprint is prepended there as the
first entry — real `docId`, title `"Business blueprint"`, full text — so every caller renders it
through machinery that already exists.

**No per-caller wiring.** One edit; no surface can drift out of sync with another.

The spine is budgeted **outside** `TOTAL_CHAR_CAP`, which stays at 8000 for retrieval results. The
spine is not a search result and must not compete with them for that budget.

**A tenant with no blueprint gets today's behavior byte for byte.** No regression surface for
existing tenants.

## 4. Precedence — typing wins (D5)

There is **no per-field `source: "user" | "vault"` flag anywhere.** The profile doc *is* the record
of what the user typed (`/dashboard/profile` writes it, `deserializeProfile` reads it back into the
edit form), so a non-empty profile field is user-authored by construction.

| Field state | Behavior |
|---|---|
| User typed it | **User's value wins.** Synthesis never overwrites it. |
| User left it blank | Synthesis fills it from documents, with a citation. |
| Typed **and** documents disagree | Surfaced in the diff as a proposal. Never a silent change. |

This reuses the rule already running in `evaluations.ts:270-280` — *"the VALUE is first-write-wins
(carried/user-provided/earlier-doc beats a later doc)"* while the citation is still recorded. User
value wins; the document is still cited. One rule in the codebase, not two.

**Consequence:** a rebuild can never be destructive to typed content, so the drift diff contains
only *additions* and *contradiction flags* — never silent overwrites.

### 4.0 The rule is a pure function, not a prompt

The model call returns **derived field candidates only**. It is never shown the live blueprint and
never asked to merge anything. Precedence and diff classification are a pure function in
`packages/core/src/blueprint.ts`:

```ts
mergeBlueprint(typed: BusinessProfile, derived: DerivedFields, live?: Blueprint)
  → { blueprint: Blueprint, diff: DiffRow[] }
```

This matters for two reasons. **Testability:** the rule the owner explicitly required ("typing is
never overwritten") is verified without a network call or a model, so it is pinned by a test that
runs on every commit. **Enforceability:** a merge rule expressed in a prompt is a request; a merge
rule expressed as a pure function with no branch that overwrites a non-empty typed field is a
guarantee. Same reasoning as `canComplete`/`missingSlots` in `businessProfile.ts:345` — *"the
guarantee is CODE, never prompt."*

### 4.1 Both entry routes are permanent

- **Type it** — `/dashboard/profile`, unchanged. A small edit is a text field and a save button: no
  upload, no synthesis, no model call, no confirm step.
- **Upload it** — documents in the vault; synthesis proposes a draft covering what is not typed.
- **Neither is required.** A user who never uploads still gets a blueprint (typed profile + graph
  entities). A user who only uploads still gets one. They compose.

## 5. Synthesis

### 5.1 Three inputs, one of which costs money

| Input | How it is read | Cost |
|---|---|---|
| Typed profile | `deserializeProfile` on the existing profile doc | free |
| Entity map | `graphNodes` by `degree`, top 20 | free (DB read) |
| Document content | probe queries → `vaultGroundHydrated` → **one** model call | the only spend |

Two of three inputs are already computed and currently unused for this purpose.

**One-line index:** add `.index("by_tenant_degree", ["tenantId", "degree"])` to `graphNodes`, then
`.order("desc").take(20)`. Convex builds indexes automatically — no migration. Without it the read
full-scans the tenant's nodes and sorts in memory: fine today, unpleasant at ten thousand entities.

### 5.2 Probes derive from the blanks

Each unfilled blueprint field maps to a fixed probe query (*"what does this business sell and at
what price"*, *"who are the customers"*, *"what constrains growth"*, …). **Fields the user typed
generate no probe.** A fully-typed profile therefore costs almost nothing to synthesize — cost
scales with how much the user has *not* told the system.

Each probe returns ≤8000 chars through the existing grounding path. Six probes ≈ 48k chars ≈ 12k
input tokens, then **one** model call producing all fields at once. Not one call per field.

### 5.3 The model call

- Prompt is a `business-blueprint` row in the **skill registry**, not source (CLAUDE.md §5).
- Missing / unpublished skill → **fail closed** with `NO_ACTIVE_SKILL` (existing precedent).
- `guardrails.preCall` gates spend before; `priceUsage` → `recordSpend` records after.
- Input is capped: probe results are already bounded at 8000 chars each, and the assembled prompt
  is capped before the call.

### 5.4 Citation validation is a trust boundary

`vaultGroundHydrated` returns parallel `docIds` / `titles` / `chunks`, so the model cites a **source
index**. An out-of-range index means the model invented a citation, and that field is **dropped, not
kept uncited**.

A blueprint claim with no traceable source is exactly the confidently-unfounded grounding this
design exists to prevent. This is not a place to be lazy (CLAUDE.md §8 — validation at trust
boundaries).

### 5.5 Output is size-capped

The spine rides in **every** agent turn, so per-field char caps are enforced at serialize time with
a hard total assertion (target ≈ 2500 chars). Overrun is truncated at field level, never silently
accepted.

## 6. Drift detection — two stages

**There is no separate drift detector.** Rebuilding and diffing *is* the drift check, so nothing can
disagree with the rebuild.

**Stage 1 — free, always on.** Any `ready` vault doc whose id is not in `blueprintSourceDocIds` is
unincorporated. Pure comparison, no model call. Drives a persistent banner: *"7 documents added
since your blueprint was built."*

**Stage 2 — the actual check.** Rebuild the draft, diff against live. Fields identical ⇒ discard
silently, say nothing. Fields differ ⇒ that is the update proposal, with the diff already computed.

**Stage 2 fires automatically on folder/bulk-ingest completion** — one bulk event, natural debounce,
and the moment "here is my business" actually happened. It does **not** fire per single-document
upload: a 50-file folder would otherwise trigger 50 model calls. The trickle case is served by the
Stage-1 banner's one-click rebuild.

> D3 was stated as "auto-detect drift, propose an update". This is the cheaper faithful reading:
> automatic on the event that matters, one click otherwise, rather than a cron burning spend on a
> timer. Adding a timer later is a cron entry over the same action — the weekly evaluation cron is
> precedent for that shape.

## 7. The confirm surface (`/dashboard/profile`)

Four states, driven by data that already exists:

| State | Surface |
|---|---|
| No blueprint | "Build blueprint from my documents" |
| Live, nothing new | Blueprint rendered + *"Built 12 Jul from 14 documents"* |
| Live + unincorporated docs | Banner: *"7 documents added since. Check for updates"* |
| Draft pending | The diff |

**The diff has exactly two row kinds, and they behave differently:**

- **Additions** — a blank field now has a value + citation. Non-destructive by construction, so
  **one "Accept" applies them all**, defaulted on.
- **Contradictions** — the user typed something and the documents say otherwise. Individually
  checkboxed, **defaulted OFF**. Shown side by side with sources: *"You: small clinics · 3 documents
  indicate: hospital procurement teams — `Q3 pipeline.xlsx`, `Sales review.docx`"*.

That split falls out of §4: additions cannot destroy typed content, so batching them is safe;
contradictions are the *only* destructive case in the system, so they are the only thing needing a
per-item decision. The user never clicks through a 30-row diff to accept obvious gap fills, and can
never lose typed content by clicking Accept too fast.

Rendering is the structured fields as a readable panel plus entities grouped by type. Diagrams are
out of scope (§9).

Confirmation writes an audit event (`blueprint.confirmed`) carrying **refs and counts only** —
docIds, field counts, accepted-contradiction count. No field content (CLAUDE.md §4).

## 8. The spine format

```
## Business blueprint — confirmed 2026-07-24, 14 documents
Acme Clinic Supplies — refurbished dental equipment for independent clinics.

- Stage: early-revenue · Tier: solopreneur
- Offering: refurbished chairs + 6-month warranty        [stated]
- Target customer: independent clinics, 1–3 chairs       [stated]
- Revenue model: unit sale plus service contract         [2025 P&L.xlsm]
- Binding constraint: 11-week import lead time           [Supplier review.docx]

## Key entities
Orgs: Kenmark Dental, Sinclair Imports, NHIF
People: Grace Wanjiru (ops), Tom Odera (supplier contact)
Projects: Nairobi showroom, Q4 warranty programme

⚠ 7 documents added since this was confirmed.
```

Three deliberate properties:

**`[stated]` vs `[source.docx]`.** The agent can distinguish what the user asserted from what the
system inferred. These warrant different behavior: a stated fact is settled and must not be
second-guessed at the user; a derived fact is challengeable and should be cited when leaned on.
Without the marker, an agent treats its own inference with the same authority as the user's
instruction.

**The staleness line.** The agent is told when the spine is incomplete, so it can say so rather than
assert into the gap. This is the direct mitigation for the standing risk of D1: a blueprint is a
lossy compression of the vault, and an agent grounding confidently on a stale summary is worse than
one that knows it is missing something. Same failure class the 15.2 context names for half-ingested
folders — *"the agent grounds confidently on the half it got."*

**Absent blueprint ⇒ unchanged output.** Fail-open; no behavior change for tenants without one.

## 9. Out of scope

Deliberately excluded, each independently buildable later:

- **(A) Folder ingest** — uploading a company folder as a unit. Already sequenced as "Phase 2" of
  the vault line in the 15.2 context (folders, 1–1.5 GB upload, the 200 MB cap raise). This design
  consumes whatever the vault contains; it does not change how documents arrive. The bulk-ingest
  trigger in §6 attaches to that event when it lands, and degrades to the Stage-1 banner until then.
- **(D) Visual rendering** — diagrams, flow charts, generated memos. A presentation layer over a
  structure that must exist first. §7 renders structured fields and an entity list.
- **Per-field re-derivation** — rebuilding one field rather than the whole blueprint. The whole
  rebuild is one model call; a per-field path would be more machinery for less.
- **Cron-scheduled rebuild** — see the note in §6.
- **Multi-blueprint / multi-business per tenant.** One tenant, one business, one blueprint.

## 10. Verification

Pure-module tests (`packages/core/src/blueprint.test.ts`), no framework beyond the existing vitest
setup:

1. **Round trip** — `deserializeBlueprint(serializeBlueprint(b))` deep-equals `b`. Pins the two
   functions to change together (the precedent `businessProfile.test.ts` sets).
2. **Precedence** — `mergeBlueprint` with a typed `targetCustomer` and a contradicting derived
   candidate leaves the typed value in place and emits a `contradiction` row. No model, no network
   — §4.0's whole point. This is the rule the owner explicitly required and it gets a dedicated
   test.
3. **Citation validation** — a derived candidate citing an out-of-range source index drops that
   field rather than emitting it uncited.
4. **Size cap** — oversized derived fields serialize within the spine cap.
5. **Diff classification** — blank→value produces `addition`; typed≠derived produces
   `contradiction`; unchanged produces neither (so an identical rebuild is silently discarded).
6. **Field-set totality** — the diff and serializer cover every member of the closed field set, so
   adding a field without handling it is a compile error rather than a silently-dropped row (the
   `satisfies Record<...>` pattern already used for `TIER_REASON`, `businessProfile.ts:330`).

Backend adapter test (`vaultGround.test.ts`): with a live blueprint present, `vaultGroundHydrated`
returns it as entry 0 and the retrieval entries still receive the full 8000-char budget. With no
blueprint, output is unchanged from today.

**Live gate.** Offline green does not close this. On the owner's deployment: build a blueprint from
the real vault, confirm it, and observe a cockpit turn whose grounding carries the spine — verified
by reading the agent's cited sources, not by asserting it should be there.

## 11. Definition of done

- `docs/playbooks/vault.md` and the onboarding playbook updated in the same commit with
  `Last verified` bumped (CLAUDE.md §9).
- `packages/core/src/blueprint.ts` needs no new `watch.json` entry — the `packages/core/` prefix
  covers it.
- `business-blueprint` skill row seeded and published through the eval gate (CLAUDE.md §5).
- The live gate run and its result recorded in the playbook.

## 12. Parallel-lane constraint

Per `.planning/PARALLELIZATION.md`, Phases 15.2 (vault formats), 16 (Lane R — research) and 17
(Lane K — calendar) are live. This design touches `vaultGround.ts`, `tenantProfile.ts`,
`schema.ts` (optional fields + one index), `packages/core/`, and
`apps/web/app/(app)/dashboard/profile/page.tsx`.

`vaultGround.ts` is the overlap risk — **Lane R stores web research in the vault.** This must be
contracted as an explicit lane with file ownership written into `.planning/PARALLELIZATION.md` in
its first plan, not improvised. Shared-singleton discipline (`STATE.md`, `ROADMAP.md`, playbooks)
applies: append-only, resolved keep-both.

Sequencing note: this design does **not** depend on 15.2 completing. It reads whatever documents
reach `ready`. Better format coverage means a richer blueprint, not a different one.
