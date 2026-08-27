# Playbook: Unified knowledge search, workflow customization and pinned routines

> Last verified: 2026-08-27 against `e84ab78`
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
| `packages/core/src/knowledgeSearch.ts` | The closed source registry (`KNOWLEDGE_SOURCES`, `NOT_LANDED_SOURCES`), `KnowledgeSourceState`, `SEARCH_CAPS`, `validateSourceRef`, `authorityFor`/`weakestAuthority`, `freshnessFor`/`oldestFreshness`, `normalizeEvidenceText`/`dedupeEvidence`, `clampSearchPlan`, `validateSynthesis`, `aggregateCoverage`, `renderSourceGap`, `searchConfidence`, `redactedSearchEvent`. |
| `packages/core/src/knowledgeSearch.test.ts` | 73 tests. Every honesty rule above has a mutation recorded in `29-01-SUMMARY.md`. |
| `packages/core/src/workflowCustomization.ts` | `CUSTOMIZATION_FIELD_KINDS`, `MATERIAL_FIELD_KINDS`, `CUSTOMIZATION_CAPS`, `validateCustomization`, `renderCustomization`, `canonicalCustomization`, `classifyCustomizationChange`, `checkBaseVersion`, `WorkflowPin`/`pinIdentity`/`pinMatchesActive`/`freshRunCorrelation`. |
| `packages/core/src/workflowCustomization.test.ts` | 83 tests, including the "ordinary business prose is not refused" corpus. |

**Backend (schema only, 29-01)**

| File | Role |
|---|---|
| `packages/backend/convex/schema.ts` | `knowledgeSearches` (new), `tenantSkills` template-lineage fields + `by_tenant_template`, `savedPrompts` pin-lineage fields + `by_tenant_template`. |
| `packages/backend/convex/schema.test.ts` | 21 tests: the Phase-29 widening, and the **recurrence-absence scan** that nothing else in the repo performed. |
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

- **`@pikar/core` has no runtime dependency on `@pikar/revenue`.** `knowledgeSearch.ts`'s
  `validateSourceRef` and `KnowledgeSourceState` deliberately *mirror* `packages/revenue/src/contracts.ts`
  (`validateSourceRef`, `Projection`) rather than importing them. Two domains, two cap sets, one
  design language. If you change one, read the other and decide on purpose.
- **`packages/core/src/workflowPacks.ts` already exports a type named `SourceState`**, and
  `packages/core/src/index.ts` re-exports everything with `export *`. Phase 29's equivalent is
  `KnowledgeSourceState`. Do not "tidy" the names together.
- **No hash implementation lives in `@pikar/core`.** `canonicalCustomization` returns a deterministic
  STRING; the caller hashes it with `packages/backend/convex/lib/hash.ts` `contentHash` (SHA-256).
  A second hash implementation is exactly what that module exists to prevent.
- **`crm` and `support` have no adapter.** Phase 28 landed contracts only — no connector table, no
  credential encryption, no provider module. Evidence:
  `.planning/phases/29-unified-knowledge-and-routines/29-DEPENDENCY-EVIDENCE.md` §2.
- **Convex validator ↔ pure contract coupling.** `knowledgeSearches`' literal unions duplicate
  `KNOWLEDGE_SOURCES`, `CONFIDENCE_LABELS`, `AUTHORITY_CLASSES` and `FRESHNESS_LABELS` as literals
  because a Convex validator needs them at module load. Widening either side without the other
  fails `schema.test.ts` on insert.

## Data flow

Landed today is only steps 0 and 8; the rest is the shape the later plans must build to.

0. Contracts frozen in `@pikar/core`; `knowledgeSearches` exists in the schema.
1. The user asks a question in the workspace.
2. A **toolless** planner call (blueprint.ts `deriveCandidates` shape: `getActiveSkill` →
   `guardrails.preCall` → `scanText` → `generateObject` → `priceUsage` → `guardrails.recordSpend`)
   proposes `{source, query}` pairs.
3. `clampSearchPlan` re-checks every pair in code: closed source enum, one query per source,
   length cap, no remote address. `crm`/`support` come back as ready-made
   `unavailable/not_landed` states rather than plan entries.
4. Adapters run under `Promise.allSettled`. Every rejection becomes a named `KnowledgeSourceState`.
   One provider failure never erases a successful source.
5. `dedupeEvidence` collapses the same record read twice and **cross-links** identical text from
   different records without deleting either.
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
| 3 | **Dedupe never deletes a conflicting record.** Exact `(source, sourceRef)` identity collapses; identical text across *different* records is cross-linked. | A $40 rate and a $60 rate must not become one confident answer. | `dedupeEvidence` + three tests, mutation KS-10. |
| 4 | **A model-invented evidence id is removed and counted.** A claim left with none becomes `unsupported`. | A citation list is not provenance. | `validateSynthesis`, mutations KS-04/KS-05/KS-06. |
| 5 | **An excerpt must be a substring of the evidence THAT CLAIM CITED.** An invalid excerpt drops the excerpt, not the claim. | A quote lifted from another document is a fabrication even though every character is real. | `validateSynthesis`, mutation KS-06. |
| 6 | **Authority, freshness and confidence are code-owned.** A model-supplied `authority`/`confidence`/`probability` is ignored. Confidence is a closed LABEL. | The model does not get to grade its own work. | `authorityFor`/`freshnessFor`/`searchConfidence`; `confidence` is a literal union in the schema so a number cannot be stored. |
| 7 | **`agent_promoted` vault content is the WEAKEST authority class.** | The provenance-laundering defect class: the agent's own earlier output must never read back as the owner's own word. | `authorityFor` + mutation KS-19. |
| 8 | **The Blueprint `spine` is never search evidence.** | It is not a result and must not alter counts, no-match behaviour or citations. | `vaultGround.ts` returns it as a separate field; `searchVaultSpine.test.ts` guards it. **Phase 29 must not put it in the evidence array.** |
| 9 | **Labels/excerpts/prose live on the CONTENT plane; audit gets refs and counts.** | CLAUDE.md §4 — the log must not become a PII honeypot. | `redactedSearchEvent` is a pure function so the ban is testable without a database; `knowledgeSearch.test.ts`, "no label, snippet, title, query or prose can reach it". |
| 10 | **An undeclared customization key is refused before its value is read.** | `tools` is not a field, so it is not a question of what `tools` contains. This is the real firewall; the content scan is the second lock. | `validateCustomization`, mutations WC-01/WC-02. |
| 11 | **`material` and `requiresEval` are separate booleans.** A tone-only edit is not material but STILL requires eval. | Collapsing them is how a "cosmetic" edit skips its gate. | `classifyCustomizationChange`, mutations WC-08/WC-17. |
| 12 | **A stale base version is refused, never merged.** | Silent last-write-wins is the version of that failure nobody notices. | `checkBaseVersion`, mutation WC-10. |
| 13 | **A pinned rerun mints a fresh correlation every run.** | It must create a fresh request and cross current approval, connection, budget and active-version gates — never replay a plan. | `freshRunCorrelation`, mutation WC-12. |
| 14 | **Activation stays owner-gated in Phase 21's existing seam.** Phase 29 adds NO second activation path or status flip. | One choke point or none. | `skills.ts` `activateTenantCandidate` / `rollbackTenantSkill` are `ownerMutation`. |
| 15 | **NO RECURRENCE STORAGE.** No `routines`/`routineRuns` table, no cron text, no `nextRunAt`, no cadence, no IANA timezone rule, no scheduler id on a pin, no standing approval, no run-history table. | Plan 29-11's decision-and-proof gate has not been passed. Inert schema invites the UI that assumes it. | `schema.test.ts` "recurrence storage is structurally absent" — table-name scan over the parsed schema, field-name scan over the source, and a per-table scan of `savedPrompts`. Three pre-existing ONE-SHOT exceptions are named in that test on purpose: `optimizerConfig.lastRunAt`, `plans.scheduledFunctionId`, `pendingTimeouts.scheduledId`. |
| 16 | **A `crm`/`support` gap is `not_landed`, never a stub adapter and never an empty success.** | Owner ruling, 2026-08-27. | `NOT_LANDED_SOURCES` + `clampSearchPlan`, mutation KS-03. |

## How to change safely

**Adding a source** (only when its adapter genuinely lands): add it to `KNOWLEDGE_SOURCES`,
`KNOWLEDGE_SOURCE_LABEL`, `SOURCE_AUTHORITY`, the `knowledgeSource` validator in `schema.ts`, and
remove it from `NOT_LANDED_SOURCES` **in the same change**. Raise `SEARCH_CAPS.maxSources` only if
the count now exceeds it. Most likely to violate: invariants 1 and 16.

**Adding an authority class or confidence label**: both are duplicated as literal unions in
`schema.ts`. Change both or `schema.test.ts` fails on insert. Most likely to violate: invariant 6.

**Adding a customization field kind**: extend `CUSTOMIZATION_FIELD_KINDS`, add the validation arm,
the `renderValue` arm, and decide explicitly whether it belongs in `MATERIAL_FIELD_KINDS`. Most
likely to violate: invariants 10 and 11.

**Touching `savedPrompts.ts`**: read `cockpit.md` first — that module is owned there, and its own
test bans `ctx.scheduler`, `cron`, `schedule`, `recurrence`, `nextRunAt`, `trigger` and `routines`
from the file. **Before the first lineage-bearing pin is written**, fold `templateId`,
`templateVersion`, `tenantSkillId` and `customizationHash` into `textHash`: it is currently computed
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
| `cd packages/core && pnpm vitest run knowledgeSearch workflowCustomization` | 156 unit tests over the pure contracts. |
| `cd packages/core && pnpm typecheck` | `noUncheckedIndexedAccess` holds across the new modules. |
| `cd packages/backend && pnpm vitest run convex/schema.test.ts` | 21 tests: the widening, and recurrence absence. |
| `cd packages/backend && pnpm typecheck` | The schema compiles against `_generated`. |
| `cd packages/backend && pnpm vitest run skills schema` | The Phase-21 seam this phase consumes is still intact beside the widening. |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | §9 watcher. **Read stdout** — `"decision":"block"` means FAILED, empty means passed. Never read its exit code; every path is `exit(0)`, and run bare it hangs forever on stdin. |

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
- The whole `knowledgeSearches` document is kilobytes by construction (`SEARCH_CAPS`: 5 sources,
  12 claims, 24 evidence, 200-char labels). That is why citations are an array on the row rather
  than a second table — one read renders the entire card.

## Known gaps & deferred work

| Gap | Where the upgrade path is recorded |
|---|---|
| **Nothing writes `knowledgeSearches` yet.** The table, the contracts and the tests exist; the coordinator does not. | Plans 29-02 … 29-06. |
| **`crm` and `support` are permanently `not_landed`** until Phase 28 ships a connector rail. | `29-DEPENDENCY-EVIDENCE.md` §2 + owner ruling 2026-08-27. |
| **`savedPrompts.textHash` collision** for two pins of the same text under different customizations. | "How to change safely" above; must be fixed in plan 29-08 before the first lineage-bearing pin. |
| **`USER_AUTHORABLE_SKILLS` is a closed three-name allowlist** and does not yet include the six workflow packs. Widening it is a plan-29-05 decision with eval consequences. | `29-DEPENDENCY-EVIDENCE.md` §1.3. |
| `ponytail:` no hash function in `@pikar/core` — dedupe compares normalized strings directly. Ceiling: a corpus larger than `totalEvidenceCharCap`. | Header comment of `knowledgeSearch.ts`. |
| `ponytail:` `validateSourceRef` mirrors `@pikar/revenue` rather than importing it. Ceiling: the two cap sets diverging silently. | Header comment of `validateSourceRef`. |
| **Recurrence is entirely deferred**, by decision, not by omission. | Plan 29-11's decision record; invariant 15. |
