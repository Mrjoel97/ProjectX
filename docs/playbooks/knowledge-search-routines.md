# Playbook: Unified knowledge search, workflow customization and pinned routines

> Last verified: 2026-08-28 against the SECOND 29-01 adversarial-repair round (a first pass found
> 22 defects, a fixer repaired them, a second pass re-ran the mutations and found 10 still
> standing — including two the first round's SUMMARY had claimed as "observed RED". This file
> records the state after the second repair.)
> Build history: `.planning/phases/29-unified-knowledge-and-routines/` · Related ADRs:
> [ADR-003](../decisions/003-skill-registry-for-prompts.md) (skills registry — `tenantSkills` is an
> additive overlay, not a supersession), [ADR-006](../decisions/ADR-006-vault-chunks-trusted-as-own.md)
> (vault chunks trusted as own — **does not extend to Drive/Gmail/CRM**),
> [ADR-025](../decisions/025-promoted-agent-artifacts-enter-retrieval.md) (agent-promoted artifacts
> in retrieval — why `agent_authored` is the weakest authority class).
> **The next free ADR number is 027.** 013 and everything up to 026 are taken; if the recurrence
> gate (plan 29-11) selects enable-safe, its standing-approval decision needs ADR-027, not 013.

## Purpose

Phase 29 ships three things and deliberately defers a fourth.

1. **Unified native search (KNOW-01).** One question, decomposed into bounded per-source queries,
   run against native adapters only, deduplicated in pure code, synthesized by a *toolless* model
   call, and rendered with citations that were validated against the evidence the run actually
   minted. A source that could not be reached produces a visible gap — never an empty "nothing
   exists" for the whole business.
2. **Workflow-pack customization (ROUT-01).** Phase 21's free-text authoring seam gets a closed,
   typed form in front of it. A user changes terminology, tone, thresholds, source preferences and
   bounded instructions. A user cannot add a tool, executable code, a secret, a remote URL or an
   MCP server.
3. **A manually re-runnable pinned workflow (ROUT-02).** A pin names an exact template version and
   an exact tenant candidate row. "Run again" starts an ordinary fresh cockpit turn. It never
   replays a plan and never bypasses a current gate.
4. **Recurrence is DEFERRED** behind the plan-29-11 decision-and-proof gate. Nothing in the schema,
   the contracts or the UI may pre-build it. See "Invariants".

As of plan 29-01 only the **pure contracts and the schema boundary** are landed. There is no
coordinator, no adapter, no UI and no Convex module yet.

## Key files

**Pure packages (landed, 29-01)**

| File | Role |
|---|---|
| `packages/core/src/knowledgeSearch.ts` | The closed source registry (`KNOWLEDGE_SOURCES` — a named SUBSET of `workflowPacks.ts`'s `PackSource`; `NOT_LANDED_SOURCES`, DERIVED from `MISSING_PACK_SOURCES`), `KnowledgeSourceState`, `SEARCH_CAPS`, `clampEvidence` (the cap-enforcing admission boundary), `validateSourceRef`, `authorityFor`/`weakestAuthority`, `freshnessFor`/`oldestFreshness`, `normalizeEvidenceText`/`dedupeEvidence`, `clampSearchPlan`, `validateSynthesis`, `aggregateCoverage`, `renderSourceGap`, `groundedSourceProps`, `searchConfidence`, `redactedSearchEvent`. |
| `packages/core/src/knowledgeSearch.test.ts` | 95 tests. Every honesty rule above has a mutation recorded in `29-01-SUMMARY.md`, and each mutation listed there was OBSERVED red. |
| `packages/core/src/workflowCustomization.ts` | `CUSTOMIZATION_FIELD_KINDS`, `MATERIAL_FIELD_KINDS`, `CUSTOMIZATION_CAPS`, `validateCustomization`, `renderCustomization`, `canonicalCustomization`, `classifyCustomizationChange`, `checkBaseVersion`, `TenantSkillRef`, `WorkflowPin` (carries `tenantSkillId`, NOT a version) / `pinIdentity`/`pinMatchesActive`/`freshRunCorrelation`. |
| `packages/core/src/workflowCustomization.test.ts` | 87 tests, including the "ordinary business prose is not refused" corpus and the SOURCE-TEXT recurrence scan that replaced two unfalsifiable runtime bans. |

**Backend (schema only, 29-01)**

| File | Role |
|---|---|
| `packages/backend/convex/schema.ts` | `knowledgeSearches` (new), `tenantSkills` template-lineage fields + `by_tenant_template`, `savedPrompts` pin-lineage fields + `by_tenant_template`. |
| `packages/backend/convex/schema.test.ts` | 32 tests: the Phase-29 widening proved by INSERT (not by substring), and the **recurrence-absence scan** that nothing else in the repo performed. |
| `packages/core/src/tenantData.ts` | `knowledgeSearches: "tenant_owned"` — owned by `audit-dead-letter.md`, listed here because Phase 29 is why the row exists. |

**Consumed, not owned** (their own playbooks apply — read those before touching them)

| File | Playbook | What Phase 29 uses |
|---|---|---|
| `packages/backend/convex/vaultGround.ts` | `vault.md` | `vaultGroundHydrated` — `{docIds, titles, origins, chunks, spine}`, caps 1500/doc and 8000 total. |
| `packages/backend/convex/vaultDrive.ts` | `vault.md` | `findInDrive` only. Never `importDriveFolder`. |
| `packages/backend/convex/gmail.ts` | `cockpit.md` | Read verbs only. A NEW knowledge query is needed; `gmail.search` is a contact resolver. |
| `packages/backend/convex/skills.ts` | `skill-registry.md` | `loadEffectiveSkill`, `publishUserCandidate`, `recordTenantEvalEvidence`, `activateTenantCandidate`, `rollbackTenantSkill`. |
| `packages/backend/convex/savedPrompts.ts` | `cockpit.md` | `save`/`list`/`remove` and the workspace pin menu. **Phase 29 extends the ROW, not this module.** |
| `packages/core/src/workflowPacks.ts` | `workflow-packs.md` | `WORKFLOW_PACK_IDS`, `PACK_SOURCE_LABEL`, `packPreflight`, `toolsForWorkflowPack`. |
| `packages/backend/convex/guardrails.ts` | `guardrails.md` | `preCall` / `recordSpend` — the budget gate every toolless call must cross. |

## Dependencies & blast radius

Run `graphify query "knowledge search"` for the current subgraph. Couplings graphify cannot see:

- **`knowledgeSearch.ts` IMPORTS FROM `workflowPacks.ts`, and that direction is load-bearing.**
  `KNOWLEDGE_SOURCES` is `["vault","drive","inbox","crm-facts","support-desk"] satisfies readonly
  PackSource[]` — a named SUBSET of the one source registry, not a second one. Labels come from
  `PACK_SOURCE_LABEL`, not-landed unlocks from `MISSING_SOURCE_UNLOCK`, and `NOT_LANDED_SOURCES` is
  DERIVED as `KNOWLEDGE_SOURCES` intersected with `MISSING_PACK_SOURCES`. 29-01 originally forked
  the vocabulary and shipped `gmail` beside `inbox` and `crm` beside `crm-facts`, which meant a pin
  whose `sourcePreferences` said `inbox` could never select the mail search source and no code
  could translate between the two. `support-desk` was added to `MISSING_PACK_SOURCES` so the one
  registry carries the fifth member; `workflowPacks.test.ts`'s "no dead vocabulary" test accepts a
  source read by the search plane, which is where that is visible.
- **`SourceState` is `workflowPacks.ts`'s, and `KnowledgeSourceState["status"]` is proved equal to
  it at COMPILE TIME** (`_VOCABULARY_IS_SHARED` in `knowledgeSearch.ts`). The two SHAPES stay
  separate — `packPreflight` keeps the bare string because 30 landed eval fixtures and
  `PACK_SOURCE_PROBE_STATES` assert it — but the vocabulary is one. `@pikar/revenue`'s `Projection`
  is a THIRD statement of the same three states in another package; consolidate at merge.
- **`validateSourceRef` is an ALLOWLIST** (`/^[A-Za-z0-9._:/+=|~-]+$/`), the same charset as
  `@pikar/contracts`' `SAFE_REF`. It replaced a denylist copied byte-for-byte from
  `packages/revenue/src/contracts.ts` that contained NO space class — "Acme Corp Invoice.pdf"
  passed as an "id" while the docstring claimed whitespace was refused. `packages/revenue` still
  holds that copy; the Phase 28 lane owns that file, so consolidation is a merge-time job and is
  recorded as a `ponytail:` comment on the function.
- **No hash implementation lives in `@pikar/core`.** `canonicalCustomization` returns a deterministic
  STRING; the caller hashes it with `packages/backend/convex/lib/hash.ts` `contentHash` (SHA-256).
  A second hash implementation is exactly what that module exists to prevent.
- **`crm-facts` and `support-desk` have no adapter.** Phase 28 landed contracts only — no connector
  table, no credential encryption, no provider module. Evidence:
  `.planning/phases/29-unified-knowledge-and-routines/29-DEPENDENCY-EVIDENCE.md` §2.
- **Convex validator ↔ pure contract coupling.** `knowledgeSearches`' literal unions duplicate
  `KNOWLEDGE_SOURCES`, `CONFIDENCE_LABELS`, `AUTHORITY_CLASSES` and `FRESHNESS_LABELS` as literals
  because a Convex validator needs them at module load. Widening either side without the other
  fails `schema.test.ts` on insert. The `knowledgeSource` union is applied in FIVE places on that
  row — the three arms of `sources[]`, plus `claims[].evidence[].source` and
  `claims[].conflictEvidence[].source`. The last two were bare `v.string()` in the original 29-01,
  so a stored CITATION could name `notion` or `http://evil.example` while the coverage plane beside
  it could not; `schema.test.ts` now proves the refusal by insert and counts the five uses.

## Data flow

Landed today is only steps 0 and 8; the rest is the shape the later plans must build to.

0. Contracts frozen in `@pikar/core`; `knowledgeSearches` exists in the schema.
1. The user asks a question in the workspace.
2. A **toolless** planner call (blueprint.ts `deriveCandidates` shape: `getActiveSkill` →
   `guardrails.preCall` → `scanText` → `generateObject` → `priceUsage` → `guardrails.recordSpend`)
   proposes `{source, query}` pairs.
3. `clampSearchPlan` re-checks every pair in code: closed source enum, one query per source,
   length cap, no remote address. `crm-facts`/`support-desk` come back as ready-made
   `unavailable/not_landed` states rather than plan entries. There is deliberately no `source_cap`
   rejection: one entry per DISTINCT source plus `maxSources === KNOWLEDGE_SOURCES.length` make it
   unreachable, and a rejection reason the code cannot produce is a state nobody can trust.
3b. **`clampEvidence` is the admission boundary.** Every adapter result crosses it before dedupe,
   synthesis or storage: `maxEvidencePerSource`, `maxEvidenceTotal`, `evidenceTextCharCap`,
   `labelCharCap` and `totalEvidenceCharCap` are enforced HERE and nowhere else. It reports which
   sources lost something so the caller mints `{status:"partial", reason:"cap"}` — a capped read is
   partial, never available. A coordinator that skips it puts an unbounded array on a Convex row:
   the schema validator imposes no length bound of its own.
4. Adapters run under `Promise.allSettled`. Every rejection becomes a named `KnowledgeSourceState`.
   One provider failure never erases a successful source.
5. `dedupeEvidence` collapses the same record read twice AND SAYING THE SAME THING, reports a ref
   that disagrees with itself as `conflicting`, and **cross-links** identical text from different
   records without deleting either.
6. A second **toolless** call synthesizes claims citing evidence ids.
7. `validateSynthesis` drops invented ids (and counts them), substring-verifies excerpts against the
   evidence *that claim cited*, keeps conflicts, and attaches authority/freshness from the table.
8. One `knowledgeSearches` row is written: answer + citations + source states, tenant-scoped.
9. The tool-bearing cockpit is told only counts. `redactedSearchEvent` is what the log plane gets.

Customization: form values → `validateCustomization` → `renderCustomization` → the Phase-21
`publishUserCandidate` seam (which always writes `status: "candidate"`) → eval → `activateTenantCandidate`
(an `ownerMutation`). Pin: `savedPrompts` row carrying `templateId`/`templateVersion`/`tenantSkillId`/
`customizationHash` → Run → an ordinary fresh cockpit turn.

## Invariants — what must never break

| # | Invariant | Why | Enforced by |
|---|---|---|---|
| 1 | **An unreachable source cannot carry a result count.** | "Reauth failed → zero results → nothing exists" is the failure this phase exists to prevent. | The `KnowledgeSourceState` union has no `returned` on the `unavailable` arm, and the Convex validator is a discriminated union that REFUSES the insert (`schema.test.ts`, "an UNAVAILABLE source carrying a count is REFUSED"). |
| 2 | **Aggregate coverage fails closed.** Zero requested sources is not "complete". | Asking nothing is not the same as answering everything. | `knowledgeSearch.test.ts`, "asking nothing is NOT complete". |
| 3 | **Dedupe never deletes a conflicting record, AND never reports one as a safe collapse.** `(source, sourceRef)` identity collapses ONLY when the normalized TEXT also matches; the same ref carrying different text is `conflicting` with its own count; identical text across *different* records is cross-linked. | A $40 rate and a $60 rate must not become one confident answer — and until the 29-01 repair, one ref reading $40 then $60 was filed under `duplicates` with `collapsed: 1`, so a renderer following the documented contract would drop the $60. | `dedupeEvidence` + six tests. MUTATION OBSERVED RED: key on `source\|sourceRef` without comparing `normalizeEvidenceText`. |
| 4 | **A model-invented evidence id is removed and counted.** A claim left with none becomes `unsupported`. | A citation list is not provenance. | `validateSynthesis`, mutations KS-04/KS-05/KS-06. |
| 5 | **An excerpt must be a substring of the evidence THAT CLAIM CITED.** An invalid excerpt drops the excerpt, not the claim. | A quote lifted from another document is a fabrication even though every character is real. | `validateSynthesis`, mutation KS-06. |
| 6 | **Authority, freshness and confidence are code-owned.** A model-supplied `authority`/`confidence`/`probability` is ignored. Confidence is a closed LABEL. | The model does not get to grade its own work. | `authorityFor`/`freshnessFor`/`searchConfidence`; `confidence` is a literal union in the schema so a number cannot be stored — and that union is now DERIVED from `CONFIDENCE_LABELS` (invariant 20). |
| 7 | **`agent_promoted` vault content is the WEAKEST authority class.** | The provenance-laundering defect class: the agent's own earlier output must never read back as the owner's own word. | `authorityFor` + mutation KS-19. |
| 8 | **The Blueprint `spine` is never search evidence.** | It is not a result and must not alter counts, no-match behaviour or citations. | `vaultGround.ts` returns it as a separate field; `searchVaultSpine.test.ts` guards it. **Phase 29 must not put it in the evidence array.** |
| 9 | **Labels/excerpts/prose live on the CONTENT plane; audit gets refs and counts.** | CLAUDE.md §4 — the log must not become a PII honeypot. | `redactedSearchEvent` is a pure function so the ban is testable without a database; `knowledgeSearch.test.ts`, "no label, snippet, title, query or prose can reach it". |
| 10 | **An undeclared customization key is refused before its value is read.** | `tools` is not a field, so it is not a question of what `tools` contains. This is the real firewall; the content scan is the second lock. | `validateCustomization`, mutations WC-01/WC-02. |
| 11 | **`material` and `requiresEval` are separate booleans.** A tone-only edit is not material but STILL requires eval. | Collapsing them is how a "cosmetic" edit skips its gate. | `classifyCustomizationChange`, mutations WC-08/WC-17. |
| 12 | **A stale base version is refused, never merged.** | Silent last-write-wins is the version of that failure nobody notices. | `checkBaseVersion`, mutation WC-10. |
| 13 | **A pinned rerun mints a fresh correlation every run.** | It must create a fresh request and cross current approval, connection, budget and active-version gates — never replay a plan. | `freshRunCorrelation`, mutation WC-12. |
| 14 | **Activation stays owner-gated in Phase 21's existing seam.** Phase 29 adds NO second activation path or status flip. | One choke point or none. | `skills.ts` `activateTenantCandidate` / `rollbackTenantSkill` are `ownerMutation`. |
| 15 | **NO RECURRENCE STORAGE.** No `routines`/`routineRuns` table, no cron text, no `nextRunAt`, no cadence, no IANA timezone rule, no scheduler id on a pin, no standing approval, no run-history table. | Plan 29-11's decision-and-proof gate has not been passed. Inert schema invites the UI that assumes it. | `schema.test.ts` "recurrence storage is structurally absent" — table-name scan over the parsed schema, field-name scan over the source, and a per-table scan of `savedPrompts`. Three pre-existing ONE-SHOT exceptions are named in that test on purpose: `optimizerConfig.lastRunAt`, `plans.scheduledFunctionId`, `pendingTimeouts.scheduledId`. |
| 16 | **A `crm-facts`/`support-desk` gap is `not_landed`, never a stub adapter and never an empty success**, and the sentence also names the UNLOCK. | Owner ruling, 2026-08-27. Naming a gap without naming its unlock leaves a complaint instead of a next step. | `NOT_LANDED_SOURCES` (derived) + `clampSearchPlan` + `renderSourceGap` reading `MISSING_SOURCE_UNLOCK`. MUTATION OBSERVED RED: return the bare sentence for `not_landed`. |
| 17 | **EVERY `SEARCH_CAPS` ENTRY IS ENFORCED BY CODE.** Six of eleven were enforced by nothing while `schema.ts` cited them as bounds. | A cap nothing applies is a documented invariant with no enforcement, and the 29-0x adapter that trusts the comment puts an unbounded array on a Convex row. | `clampEvidence`/`clampSearchPlan`/`validateSynthesis`, plus a source scan (`NO CAP IS DEAD`) that fails when a key becomes declaration-only. Two by-construction exceptions are named in that test. Same rule and same test for `CUSTOMIZATION_CAPS`. |
| 18 | **ONE SOURCE VOCABULARY.** `KNOWLEDGE_SOURCES satisfies readonly PackSource[]`; labels and unlocks come from `workflowPacks.ts`. | A pin's `sourcePreferences` are `PackSource[]`; a forked search vocabulary makes a preference unable to select a source with no code that could translate. | `satisfies` at compile time, plus "every knowledge source IS a PackSource" and the derived `NOT_LANDED_SOURCES` test. |
| 20 | **THE CONVEX ENUMS ARE THE `@pikar/core` ENUMS, DERIVED — NOT HAND-COPIED.** `knowledgeSource`, the unavailable/partial reasons, the authority classes, the freshness labels and the confidence labels are all built by `schema.ts`'s `literals(...)` helper from the exported const array. | They were hand-copied, and three separate narrowings of them each left the whole backend suite AND the typecheck green: dropping `support-desk` from the source union, `unplanned` from the unavailable reasons, `agent_authored` from the authority classes. Nothing crossed the package boundary. The cost is exactly the honest-gap row this phase exists to produce: core can construct `{status:"unavailable", reason:"not_landed", source:"support-desk"}` and the validator would refuse it at INSERT time, at runtime, with nothing red in CI. | One list, not two. Falsified by `schema.test.ts`, "the Convex enums are the @pikar/core enums, proved by storing every member" — it inserts EVERY member of every core constant, plus a scan that fails if any member reappears as a hand-written `v.literal` inside `knowledgeSearches`. MUTATIONS OBSERVED RED: hand-write each of the three unions back minus one member. |
| 21 | **`groundedSourceProps` PROJECTS VAULT EVIDENCE ONLY into `docIds`.** Non-vault citations come back in `nonVault` and must be rendered without a vault drill-in. | `docIds[i]` is not a neutral id: `cards.tsx:2413 GroundedSources` -> `:2373 VaultDocButton` -> `:2317 VaultDocModal` OPENS it as a vault document. The first version mapped every source's `sourceRef` in, so a Gmail message id rendered a clickable control that opens a document that does not exist — committing, one plane over, the exact naming lie this function's own JSDoc rejects for `citationDocId`. | `knowledgeSearch.test.ts`, "NO NON-VAULT REF EVER REACHES docIds". MUTATION OBSERVED RED: drop the `.filter((e) => e.source === "vault")`. |
| 22 | **`savedPrompts.sourcePreferences` MEMBERSHIP is closed by the Convex validator** — the full `PackSource` vocabulary, derived, not `v.array(v.string())`. | It was `v.array(v.string())` under a comment reading "Bounded `PackSource` names", and a convex-test probe stored `["notion","http://evil.example","sharepoint"]` verbatim: a documented invariant with no enforcement, one field over from where the identical hole had just been closed on `claims[].evidence[].source`. | `schema.test.ts`, "sourcePreferences refuses a source the product does not have — a WRONG VALUE, not a wrong type". MUTATION OBSERVED RED: reopen to `v.optional(v.array(v.string()))`. **LENGTH is NOT bounded** — see Known gaps. |
| 19 | **A PIN NAMES THE EXACT `tenantSkills` ROW, never a (name, version) pair.** | Two tenants can hold the same name AND version — which is why `recordTenantEvalEvidence` keys on the row id, and why the landed rail is `Record<string, Id<"tenantSkills">>` (dispatch.ts:234/:256). | `WorkflowPin.tenantSkillId: TenantSkillRef \| null`, `pinIdentity`/`pinMatchesActive` compare it, and `savedPrompts.tenantSkillId` is `v.id("tenantSkills")` — proved by INSERT, not by a substring scan. MUTATIONS OBSERVED RED: relax to `v.optional(v.string())`; drop the id from `pinIdentity`. |

## How to change safely

**Adding a source** (only when its adapter genuinely lands): add it to `workflowPacks.ts`'s
`REACHABLE_PACK_SOURCES` or `MISSING_PACK_SOURCES` **first** (with its `PACK_SOURCE_LABEL`, and its
`MISSING_SOURCE_UNLOCK` + `MISSING_SOURCE_MENTIONS` if missing), then to `KNOWLEDGE_SOURCES` and
`SOURCE_AUTHORITY`. Do **not** touch `schema.ts`'s `knowledgeSource` — it is DERIVED from
`KNOWLEDGE_SOURCES` (invariant 20) and follows on its own. Do NOT edit
`NOT_LANDED_SOURCES` — it is derived; a connector that lands moves between the two pack lists once
and both planes follow. Keep `SEARCH_CAPS.maxSources === KNOWLEDGE_SOURCES.length` (a test pins it).
Most likely to violate: invariants 1, 16 and 18.

**Adding or changing a cap**: add the enforcement in the SAME change, or do not add the cap. The
`NO CAP IS DEAD` scans in both test files fail on a declaration-only key. If a cap is genuinely
unnecessary, DELETE it and fix every comment that cited it. Most likely to violate: invariant 17.

**Adding an authority class or confidence label**: change the `@pikar/core` const ONLY.
`schema.ts` derives both (invariant 20), so there is nothing to keep in sync — and
re-introducing a hand-written `v.literal` copy is itself red. Most likely to violate:
invariants 6 and 20.

**Adding a customization field kind**: extend `CUSTOMIZATION_FIELD_KINDS`, add the validation arm,
the `renderValue` arm, and decide explicitly whether it belongs in `MATERIAL_FIELD_KINDS`. Most
likely to violate: invariants 10 and 11.

**Touching `savedPrompts.ts`**: read `cockpit.md` first — that module is owned there, and its own
test bans `ctx.scheduler`, `cron`, `schedule`, `recurrence`, `nextRunAt`, `trigger` and `routines`
from the file. **Before the first lineage-bearing pin is written**, fold ALL FIVE lineage fields —
`templateId`, `templateVersion`, `tenantSkillId`, `customizationHash` AND `sourcePreferences` —
into `textHash`. (`sourcePreferences` was missing from this list until the 29-01 repair: two pins
differing only in preferred sources are two different runs. `@pikar/core`'s `pinIdentity` already
covers all five and is the intended hash input.) `textHash` is currently computed
from the TEXT ALONE, so two pins of the same words against different customizations would collide on
`by_tenant_textHash` and the second `save` would silently return the first row. Unreachable today
(nothing writes those fields yet), recorded because 29-01 added the field that makes it reachable.

**Touching the Gmail path**: the toolless firewall enforced by `llmRedaction.test.ts` is
**BODY-scoped, not CONTENT-scoped** — sender display names and subject lines are deliberately
admitted into the tool-bearing loop today. That is the known boundary. Do not silently widen it and
do not assume it is narrower than it is.

**If the recurrence gate ever passes**: recurrence tables are a *new* plan, a *new* ADR (027+), and
a rewrite of invariant 15 in this file — not an edit to a schema comment.

## How to verify

`pnpm --filter <pkg> test -- <filters>` **does not filter**: pnpm swallows the `--`. `cd` into the
package.

| Command | What it proves |
|---|---|
| `cd packages/core && pnpm vitest run knowledgeSearch workflowCustomization` | 187 unit tests over the pure contracts. |
| `cd packages/core && pnpm typecheck` | `noUncheckedIndexedAccess` holds across the new modules. |
| `cd packages/backend && pnpm vitest run convex/schema.test.ts` | 41 tests: the widening proved by insert, the core->storage enum seam proved by inserting EVERY member of every core constant, the header index, and recurrence absence. |
| `cd packages/backend && pnpm typecheck` | The schema compiles against `_generated`. |
| `cd packages/backend && pnpm vitest run skills schema` | The Phase-21 seam this phase consumes is still intact beside the widening. |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | §9 watcher. **Read stdout** — `"decision":"block"` means FAILED, empty means passed. Never read its exit code; every path is `exit(0)`, and run bare it hangs forever on stdin. **RUN IT WHILE THE TREE IS DIRTY.** With no baseline file for the session id it compares against `HEAD`, so running it after committing on a clean tree examines ZERO files and its silence means nothing. |

**Not verifiable here (no live deployment, no spend):** every adapter, coordinator and UI gate from
plans 29-02 onward, and every recurrence live proof in 29-11.

## Operational notes

- No new env var, no new dependency and no seed data. `@js-temporal/polyfill` is installed **only**
  if the recurrence gate selects enable-safe.
- **`knowledgeSearches` is already wired into tenant export and deletion.** It is classified
  `tenant_owned` in `packages/core/src/tenantData.ts`, and `tenantDelete.ts`/`tenantExport.ts` walk
  `deletableTables()` — so classification IS the wiring, and no later plan has to remember. That
  walk calls `.withIndex("by_tenant")` on every name it returns, which is why the table carries a
  bare `by_tenant` as well as `by_thread`. Reclassifying it would mean removing that index in the
  same commit, and vice versa. `tenantData.test.ts`'s table-count tripwire moved 46 -> 47.
- The classification is deliberately the OPPOSITE of `workflowPackEvents` (`audit_immutable`): a
  pack event has nowhere to put prose, a search row holds the user's question, answer and document
  titles. The refs-only measurement plane is `redactedSearchEvent`, not this table.
- The whole `knowledgeSearches` document is kilobytes **because `clampEvidence` and
  `validateSynthesis` make it so** (`SEARCH_CAPS`: 5 sources, 12 claims, 24 evidence at 8 per source
  and 1500 chars each, 8000 chars total, 200-char labels, 300-char excerpts). The Convex validator
  imposes NO length of its own — the array validators are unbounded — so the bound is the writer's
  and a writer that skips `clampEvidence` has no bound at all. That is why citations are an array on
  the row rather than a second table — one read renders the entire card.
- **The citation field names are `{source, sourceRef, label}` + `excerpt`, and that is deliberate.**
  This is the third citation shape in the repo (`vaultSources` `{docIds, titles, count}`;
  `evaluations.findings` `{citationDocId, citationTitle, citationExcerpt}`). It keeps `sourceRef`
  rather than `citationDocId` because a knowledge-search ref is a provider id across five planes and
  only one of the five is a vault `docId` — storing a Gmail message id in a field named
  `citationDocId` is how it later gets joined against `vaultDocuments`. The mapping is CODE, not
  prose: `groundedSourceProps` in `@pikar/core` returns exactly the `{docIds, titles, count}` props
  the landed `GroundedSources` component and the `vaultSources` row already take, so one card serves
  both planes and no caller writes a rename shim. **It projects VAULT evidence only**
  (invariant 21) and hands back everything else in `nonVault`, because `docIds[i]` is opened as a
  vault document by `VaultDocButton`/`VaultDocModal`. A 29-0x renderer must give `nonVault` a
  non-vault affordance.

## Known gaps & deferred work

| Gap | Where the upgrade path is recorded |
|---|---|
| **Nothing writes `knowledgeSearches` yet.** The table, the contracts and the tests exist; the coordinator does not. | Plans 29-02 … 29-06. |
| **`crm-facts` and `support-desk` are permanently `not_landed`** until Phase 28 ships a connector rail. | `29-DEPENDENCY-EVIDENCE.md` §2 + owner ruling 2026-08-27. |
| **`savedPrompts.textHash` collision** for two pins of the same text under different customizations. | "How to change safely" above; must be fixed in plan 29-08 before the first lineage-bearing pin. |
| **`USER_AUTHORABLE_SKILLS` is a closed three-name allowlist** and does not yet include the six workflow packs. Widening it is a plan-29-05 decision with eval consequences. | `29-DEPENDENCY-EVIDENCE.md` §1.3. |
| `ponytail:` no hash function in `@pikar/core` — dedupe compares normalized strings directly. Ceiling: a corpus larger than `totalEvidenceCharCap`. | Header comment of `knowledgeSearch.ts`. |
| `ponytail:` `validateSourceRef` and `packages/revenue/src/contracts.ts` hold two shape rules for one §4 boundary, and revenue's is the laxer denylist form. The Phase 28 lane owns that file, so it cannot be edited from here. Ceiling: two rules, one boundary. Upgrade at merge: delete revenue's copy, import this one. | `ponytail:` comment on `validateSourceRef`. |
| `ponytail:` `KnowledgeSourceState` and `packPreflight`'s `SourceState` are two SHAPES over one vocabulary. Ceiling: a caller that needs both must switch on `status` twice. Upgrade path: widen `SourceState` into the reason-carrying object and migrate `packPreflight` + the 30 landed eval fixtures in one change. | Doc comment on `KnowledgeSourceState`. |
| **The `mediaJobs.provider` reflow in commit `1e914f9` was not reverted.** It is an unrequested formatting-only edit outside Phase 29's blast radius, and the audit was right to flag it — but `biome@2.5.3` at `lineWidth: 100` REQUIRES the collapsed single line (verified: reverting it makes `biome format packages/backend/convex/schema.ts` red). Reverting would ship formatter-red code that the next save flips back. | 29-01-SUMMARY.md, "deliberately not fixed". |
| **`sourcePreferences` array LENGTH is unbounded at the storage boundary.** Membership is closed (invariant 22); a Convex validator has no array-length bound, so 10000 repeats of `"vault"` is storable. Claiming a length bound in a comment is the defect invariant 22 exists to record, so it is recorded here instead. | `ponytail:` comment on the field. The real ceiling is `CUSTOMIZATION_CAPS.maxValuesPerField` (8) in `validateCustomization`; there is no writer of this field yet. Upgrade path: clamp in the `savedPrompts` mutation when plan 29-08 writes the first pin, and assert the refusal there. |
| **`packages/backend/convex/schema.ts` is NOT watched by the §9 hook.** It is registered under `watch._unassigned` — explicitly acknowledged rather than left as a silent hole. | `watch.json` prefixes are per-file and `schema.ts` holds all 47 tables, so assigning it to this playbook would demand a knowledge-search bump for every unrelated table edit repo-wide — noise that trains readers to ignore the hook. The Phase-29 tables' real gate is `schema.test.ts`, which IS watched here and which now fails on enum drift, header drift and value drift. |
| **Recurrence is entirely deferred**, by decision, not by omission. | Plan 29-11's decision record; invariant 15. |
