# The Business Blueprint — a standing spine for every agent

> Status: DESIGN — awaiting owner review
> Date: 2026-07-27
> Subsystems: Knowledge Vault (`docs/playbooks/vault.md`), Onboarding / Business Profile
> Scope pieces A (folder ingest) and D (visual rendering) are deliberately OUT — see
> [Out of scope](#9-out-of-scope).

## 1. Problem

Every agent surface in Pikar reaches the user's business through exactly one function:
`vaultGroundHydrated` (`packages/backend/convex/vaultGround.ts:126`). It has **three** real callers:
the cockpit `searchVault` tool (`llm.ts:1347`), the evaluation engine (`evaluations.ts:235`), and
the voice-doc flow (`voiceDoc.ts:75`).

> **Amended 2026-07-27 after Phase 17.1 research.** This section originally listed *five* callers,
> adding `onboarding.ts` and `tenantProfile.ts`. Those two only mention the function in comments
> (`onboarding.ts:5,451,539,595`; `tenantProfile.ts:14,127`) — they are not callers. The original
> count came from grep hits rather than call sites. See §3.3, which was rewritten for the same
> reason, and the amendment log in §13.

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
scoping, delete-cascade, PII redaction, the audit trail, and the `by_kind` index at no cost.

**It is NOT embedded, and NOT graph-extracted** (amended 2026-07-27 — the original text listed
embedding as a benefit). The spine is prepended unconditionally, so the blueprint never needs to be
*retrievable* to reach an agent. Embedding it would create two real defects and buy nothing:

- **Double entry** — RAG could return the blueprint as a hit *and* the seam adds it, so it appears
  twice in one context.
- **Graph feedback loop** — its own entities would flow back into `graphNodes`, inflating the exact
  `degree` ranking the next rebuild reads to choose entities. The blueprint would progressively
  re-derive itself from itself.

Excluding it also saves the embedding spend. `serializeBlueprint` must additionally **never emit the
literal `- **Persona:**` line** — `evaluations.ts:291` and `vault.profileSeedDocs`
(`vault.ts:484`) both use that exact string as a *business-profile detector*, and a blueprint
carrying it would be misread as a profile doc by both.

**Locate it by id, not by scan.** `tenantProfiles` carries a `blueprintDocId` so the seam reads one
indexed row. The obvious `currentProfileDoc` clone (`onboarding.ts:521-533`) `.collect()`s
`vaultDocuments` *including the `text` blob* — acceptable on a profile save, unacceptable on a hot
path that now runs on every grounding call.

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
| `stage` | **`BusinessProfile.stage`** — the typed free string, the user's own words | no |
| `tier` | `tenantProfiles.tier` | no — `deriveTier` owns it already |
| `offering` | profile → docs | yes |
| `targetCustomer` | profile → docs | yes |
| `revenueModel` | docs only (new) | yes |
| `bindingConstraint` | docs only (new) | yes |
| `primaryGoals[]` | profile → docs | yes |
| `knownConstraints[]` | profile → docs | yes |
| `entities[]` | `graphNodes` by degree | no — DB read, never a model call |

**`stage` is NOT `revenueStage`** (amended 2026-07-27 — the original spec was ambiguous and its
example rendered a `revenueStage` literal). These are two different fields with confusingly similar
names: `BusinessProfile.stage` is a free string in the user's own words
(`businessProfile.ts:46-47`), while `tenantProfiles.revenueStage` is a closed union
(`schema.ts:758-760`). The blueprint uses **`stage`**, because D5 makes typed content authoritative
and `tier` already carries the derived shape. Reading the wrong one is a silent correctness bug no
test would catch, so the choice is stated here rather than left to the implementer.

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
blueprintDocId:        v.optional(v.string()),   // hot-path lookup — never scan vaultDocuments
```

**Required-field trap.** `tier`, `tierSource` and `derivedAt` are REQUIRED on this table
(`schema.ts:768-783`), so a draft writer cannot *insert* a row for a tenant that has none without
inventing a tier — which is precisely the silent-reclassification defect §4.2 of the tier design
exists to kill. The writer must **refuse** for a tenant with no profile row, exactly as `saveFacts`
does (`tenantProfile.ts:194`), never patch-or-create.

Optional fields on an existing table ⇒ no migration. Structurally keeps the draft out of every
retrieval path.

*Considered and rejected:* a `blueprintDrafts` table — a whole table for one optional blob.

### 3.3 The injection seam — TWO seams, not one (rewritten 2026-07-27)

The original design prepended the blueprint as entry 0 of `vaultGroundHydrated`'s return and claimed
"one edit, every agent inherits it". **Research disproved that**, twice over:

**It breaks the most important caller.** `llm.ts`'s `searchVault` tool reads the returned parallel
arrays directly, and a prepended entry 0 causes three distinct defects:

| # | Code | Breakage |
|---|---|---|
| A | `if (docIds.length === 0) return noMatch;` (`llm.ts:1364`) | Becomes **unreachable**. The agent permanently loses its honest *"nothing in your vault"* answer. |
| B | `resultCount: docIds.length` (`llm.ts:1360`) | Every `vault.searched` audit count inflated by one. |
| C | `vaultSources.insert` (`llm.ts:1367-1374`) | A "Business blueprint" source chip on **every** search. |

**And it would not deliver the requirement anyway.** The spine would only reach the cockpit agent on
turns where it happens to call `searchVault`. A turn like *"draft an email to Bob"* never calls that
tool — so the agent still would not know what the business is. `searchVault` is a **search tool**;
the blueprint is not a search result. Conflating them is the root cause of all three defects above,
not three separate bugs to patch.

So there are two seams, by layer:

**Seam 1 — the cockpit gets it in the turn prompt.** The blueprint is prepended as a labelled
context block to the `prompt` passed into `runAgentLoop`. Present on **every** turn regardless of
which tools fire — which is what "standing" actually means. `vaultGroundHydrated` keeps its current
semantics, so defects A/B/C never arise rather than needing patches.

**Not the system prompt:** `system: skill.body` verbatim at every call site (`llm.ts:1837` and 17
others). The system string comes from the registry (CLAUDE.md §5); tenant context belongs in the
turn, not spliced into a versioned skill body across 18 call sites.

**Seam 2 — a separate `spine` field for the grounding-driven callers.** `vaultGroundHydrated` gains
a fourth return field, **alongside** the parallel arrays and never inside them:

```ts
{ docIds, titles, chunks, spine }   // spine: string | null
```

`evaluations.ts` and `voiceDoc.ts` consume it explicitly. This matters for `voiceDoc.ts` in
particular: its `if (docIds[i] !== docRef) continue;` (`voiceDoc.ts:99`) would have silently
discarded a prepended entry 0, so the spine would never have reached the model there at all.

*Note:* `vaultGround.test.ts:179` asserts full-object equality
(`expect(out).toEqual({ docIds: [], titles: [], chunks: [] })`) and must be updated for the added
field.

The spine is budgeted **outside** `TOTAL_CHAR_CAP`, which stays at 8000 for retrieval results. The
spine is not a search result and must not compete with them for that budget.

**A tenant with no blueprint gets today's behavior byte for byte** — `spine` is `null`, the turn
prompt gains nothing. No regression surface for existing tenants.

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
- **UNGATED** (owner decision 2026-07-27, amending §11's original "through the eval gate"). Two
  reasons. Mechanical: `run-eval-golden.mjs` hard-validates `--skill` against a closed name list
  (`skill.ts:68-72`), so gating a skill the golden runner cannot drive **deadlocks it at v1** on its
  first body edit — the documented reason `document-analyst` was left ungated. Principled: the
  existing rationale for ungating `business-profile` (`skills.ts:282`) applies verbatim — its output
  is a vault doc a human confirms, not tool-state. **D2's confirm gate IS that human check.**
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

**Stage 2 is USER-TRIGGERED this phase** (amended 2026-07-27, owner-confirmed). The original text
said it fires automatically on folder/bulk-ingest completion. **No such event exists** —
`vaultIngest.onIngestComplete` is per-document (`vault.md:39`), and a 50-file folder would therefore
trigger 50 model calls. Building a debounced bulk-completion event means editing `vaultIngest.ts`,
which is exactly the file 15.2's lane is restructuring.

So this phase ships: the **always-on Stage-1 banner** plus a **one-click rebuild**. Automatic
triggering is deferred to when folder ingest lands (15.2's "Phase 2"), which is the natural
"here is my business" event to attach to.

> This is scoped honestly rather than half-built: detection is automatic and free, the *spend* is
> one click. Adding the automatic trigger later attaches to the same action with no rework. A cron
> variant remains available — the weekly evaluation cron is precedent for that shape.

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
- `business-blueprint` skill row seeded and published **ungated** (§5.3 — the eval-gate requirement
  originally stated here was amended 2026-07-27; gating it would deadlock the skill at v1).
- The live gate run and its result recorded in the playbook.

## 13. Amendment log

All amendments 2026-07-27, from Phase 17.1 research (`17.1-RESEARCH.md`) plus owner decisions. The
sections themselves are corrected in place; this is the index.

| § | Was | Now | Why |
|---|---|---|---|
| 1 | Five `vaultGroundHydrated` callers | **Three** | `onboarding.ts` / `tenantProfile.ts` mention it in comments only. Original count came from grep hits, not call sites. |
| 3.1 | Blueprint is embedded | **Not embedded, not graph-extracted** | Avoids duplicate entry-0 and a graph feedback loop where the blueprint re-derives itself from its own entities. |
| 3.1 | — | `blueprintDocId` added | Hot-path lookup; a `.collect()` over `vaultDocuments` would now run on every grounding call. |
| 3.2 | — | Required-field trap documented | `tier`/`tierSource`/`derivedAt` are required; the draft writer must refuse, never invent a tier. |
| 3.3 | One seam, prepend entry 0 | **Two seams** — turn prompt for the cockpit, `spine` field for the others | The single seam broke `llm.ts` three ways *and* would not have delivered standing context there at all. |
| 3.3 field set | `stage` from `tenantProfiles` | `stage` = the typed `BusinessProfile.stage` | `stage` and `revenueStage` are different fields; the ambiguity was a silent-bug risk. |
| 5.3 | Eval-gated skill | **Ungated** | Golden runner hard-validates skill names; gating deadlocks it at v1. Matches `business-profile`'s existing rationale. |
| 6 | Stage 2 auto-fires on bulk ingest | **User-triggered this phase** | No bulk-completion event exists; building one collides with 15.2's lane. |

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
