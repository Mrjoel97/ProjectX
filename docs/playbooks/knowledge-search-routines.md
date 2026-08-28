# Playbook: Unified knowledge search, workflow customization and pinned routines

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART B — THE CRM ADAPTER STOPS OVERRIDING THE
> CONNECTOR LAYER, AND STOPS PUTTING THE MONEY IN PROSE.**
>
> **(1) HubSpot's own authority is honoured.** `hubspotProjection` hardcodes
> `authority: "supplemental"` — "colour only ... Never a total" — precisely so no caller can
> promote a deal into accounting authority, and `readCrmKnowledge` discarded it and re-stamped
> every row `system_of_record`, the second-strongest class, which feeds `weakestAuthority` and
> `searchConfidence`. `authorityFor` now takes `providerAuthority` and relates the two
> vocabularies in ONE direction only: a value that does not own a money fact
> (`accounting_authority`, `payment_rail`) drops the row to `correspondence` — what somebody said
> — and nothing can RAISE a source above its code-owned class.
>
> **(2) The deal amount is no longer in the evidence text.** It was interpolated verbatim, which
> is everything a model needs to sum a pipeline and cite the total. The absence is STATED in the
> composed sentence so it can never be read as zero. Ceiling, named in the code: a knowledge
> answer cannot say what a deal is worth. Upgrade path is a typed non-summable `Evidence.figure`
> plus a `validateSynthesis` rule, which is a design and belongs with the revenue rail.
>
> **(3) A WINDOWED READ IS A PARTIAL READ.** `readHubSpotDataset` filters to
> `DEFAULT_WINDOW_DAYS` (90) and this adapter never passes a `windowDays`, so the CRM arm now
> always settles `partial/cap`. `available` was a complete-looking answer built from a slice.
>
> **(4) `CRM_UNAVAILABLE_REASON` IS TYPED ON THE TOKEN VERB'S OWN UNION.** It was
> `Record<string, UnavailableReason>` — deleting the `reauth` entry left `tsc` AND the suite
> green while a dead refresh was reported as the transient `provider_error`. It is now
> `Extract<AccessTokenResult, {ok:false}>["reason"]`-keyed, so a gap is a compile error; a
> `crmReason` helper keeps the runtime fail-closed for a value from anywhere else.
>
> **(5) BOTH ADAPTER MODULES ARE INTERNAL-ONLY, AND THAT IS NOW RECORDED.** Every reader takes
> `tenantId: v.string()` as an ARGUMENT, which is correct for an `internalAction` and a
> cross-tenant read on anything public. A scan over both modules fails on `tenantAction`,
> `action(`, `query(`, `mutation(` or `httpAction`. 29-06 must pass `ctx.tenantId` from a tenant
> wrapper, never a caller-supplied value.
>
> **HOW TO VERIFY:** `cd packages/backend && pnpm vitest run knowledgeExternalSources` and
> `cd packages/core && pnpm vitest run knowledgeSearch`. Mutations that MUST go red: drop
> `providerAuthority` from the `authorityFor` call; put the amount back in `dealText`; revert
> `cap: true`; collapse `evidenceId` to a constant; delete the recency `.sort`; make a reader a
> `tenantAction`. Deleting a `CRM_UNAVAILABLE_REASON` member must fail `pnpm typecheck`.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART B — `authorityFor` gained two downgrades
> and one exported registry.**
>
> `AGENT_AUTHORED_ORIGINS` is every value in `vaultDocuments.origin`, exported so the backend can
> read the schema union off disk and fail when one lands with no authority decision. A Drive hit
> is `tenant_owned` ONLY when Drive itself says `ownedByMe: true`; absence is a downgrade, because
> Drive leaves the field unset for shared-drive items. Both are provenance-laundering doors:
> agent-written prose and a stranger's file were reading back as the owner's own word. See
> `vault.md`'s Part-B entry for the full reasoning and the mutations that must go red.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART A — three blockers, one reinvented contract,
> and a cap with no enforcement site.**
>
> **(1) UNTRUSTED THIRD-PARTY CONTENT COULD SELECT THE OFFLINE SMOKE SEAM.** `synthesizeKnowledge`
> tested `safePrompt.includes(SMOKE_SYNTH_PREFIX)`, and `safePrompt` is the rendering of the
> question PLUS every evidence row's `text` and `label` — i.e. inbound mail BODIES and SUBJECT
> LINES. Anyone who could email the tenant could put the sentinel in a message and replace the whole
> synthesis with the code fixture: no model call, no spend, the real answer suppressed, and the
> SENDER choosing which of the tenant's rows were cited and which were reported as conflicts,
> through the `<citeIds>|<excerptFromId>|<conflictIds>` grammar. A remote party selected a code path
> in the one module whose entire safety argument is that untrusted content steers nothing. **Both
> seams now key on the `question` ARGUMENT alone.** `blueprint.ts` and `vaultDigest.ts` may scan
> their whole prompt because theirs is built from the tenant's own profile; this one is not, and the
> difference is a security boundary rather than a style choice.
>
> **(2) THE EVIDENCE FENCE WAS FORGEABLE, AND ITS JSDOC DENIED IT.** `synthesisPrompt` interpolated
> `evidenceId`, `source`, `label` and `text` into the `<<<evidence ...>>>` markers with no escaping
> and no nonce, while the docstring claimed a body containing the closing marker "cannot end a block
> early". Its justification — "nothing downstream parses this string back" — is about the CODE
> plane; the fence exists for the MODEL's view of the prompt. The markers now carry the run's nonce,
> and `fenceSafe` strips `<` and `>` from every interpolated field, so a row can neither close its
> own block nor mint a forged one claiming to be tenant-owned vault evidence. `synthesisPrompt` is
> EXPORTED for the test that proves it: the prompt never leaves the module, so no caller-visible
> assertion can reach it and a source scan would only prove the spelling.
>
> **(3) THE MODEL WAS MISROUTED ON BOTH LIVE CALLS.** The module copied `blueprint.ts`'s stale
> private `resolveModel`, which has no `or/` branch, so both calls sent `or/openai/gpt-4o-mini` to
> the OpenAI provider. Planner-side that failure is silent and permanent — the bad call lands in the
> `catch` and degrades to the vault-only fallback on every production run, which is exactly the "we
> searched everything and found nothing" outcome this module exists to prevent. It imports
> `convex/lib/models.ts` now; see `cockpit.md` for the five stale copies still outstanding.
>
> **(4) THE RUN-LEVEL CAPS WERE ENFORCED NOWHERE, AND THE SYNTHESIZER BILLED AN UNBOUNDED CORPUS.**
> `clampEvidence` is documented as THE admission boundary that applies every per-RUN bound once, and
> its only production call site was inside a SINGLE-SOURCE adapter — so `maxEvidenceTotal: 24` and
> `totalEvidenceCharCap: 8000` bounded nothing (five sources at their per-source cap is 40 rows and
> ~40k characters). `clampEvidence` now takes a SCOPE: `"source"` applies the per-source and per-row
> caps only, `"run"` (the DEFAULT, so a forgetful caller gets the tighter bounds) adds the two run
> bounds. `settleRead` clamps at source scope; `synthesizeKnowledge` clamps the whole corpus at run
> scope as the FIRST act of its handler, before the gate, the prompt and the model.
>
> **`ponytail:` ceiling, named rather than papered over:** the per-source `returned` counts the
> adapters publish are minted BEFORE the union clamp, so a corpus cut at synthesis can leave a state
> that overstates what reached it. Upgrade path: plan 29-06's coordinator clamps the union ONCE and
> mints every state after it, and both ponytail comments come out when it does.
>
> **(5) ONE ADAPTER RESULT CONTRACT, IN `@pikar/core`.** `KnowledgeAdapterResult` and
> `ExternalKnowledgeResult` were structurally identical types written three minutes apart in the
> same wave, with nothing pinning them, and they had ALREADY drifted on who enforces admission — one
> ran `clampEvidence`, the other relied on hand-written slices, so `evidenceTextCharCap` bound a
> mail body and nothing at all bound a CRM row. `KnowledgeAdapterResult`, `unavailableRead` and
> `settleRead` are now defined once beside `clampEvidence` and the closed state union, and all four
> adapters use them. `knowledgeExternalSources.ts` no longer contains a single `status: "..."`
> literal, which its own containment test asserts — a state carrying a subject line is not
> discouraged there, it is unspellable.
>
> **(6) THE CRM EVIDENCE TEXT WAS NOT PROVIDER-STRING-FREE, AND THE HEADER SAID IT WAS.**
> `deal.pipelineId` and `deal.stageId` are HubSpot's own `pipeline` and `dealstage` property values
> — opaque keys in every real portal, unbounded provider strings on the wire — and they were
> interpolated verbatim into text carrying `system_of_record` authority, with no cap on the CRM arm
> at all. They go through `validateSourceRef` now, the same §4 ref-shape rule the `sourceRef` uses,
> so a value that is not id-shaped is reported as `unknown` rather than repeated. The test that
> claimed to prove containment planted its payload in `dealname`, a property the rail never
> requests, so it proved a field was absent rather than that the requested fields were safe.)
>
> Last verified: 2026-08-28 against **plan 29-04** (the TWO TOOLLESS MODEL CALLS land:
> `packages/backend/convex/knowledgeLlm.ts` plus the `knowledge-query-planner` and
> `knowledge-synthesizer` registry rows, both GATED. Four things a reader needs:
> **(a)** the calls live in a NEW module, not `llm.ts` — the plan text's "the existing sole Node
> LLM module" premise is false (`blueprint.ts`, `vaultDigest.ts`, `vaultExtract.ts` and
> `intake.ts` all call toollessly outside it), and putting untrusted mail/Drive/CRM text inside
> the ~6,000-line tool-bearing loop would undo this feature's whole safety argument.
> **(b)** invariant 27: a NOT-LANDED source is `not_landed` whether or not the planner named it —
> `clampSearchPlan` can only mint that state for a source the MODEL proposed, so relying on it
> alone made `support-desk` read as `unplanned` on every ordinary run. A test caught it.
> **(c)** invariant 28: the RAW model object never leaves `knowledgeLlm.ts`.
> **(d)** THE GATE ON BOTH BODIES IS NOT YET CLEARABLE — see "Known gaps". Plan 29-06 owes the
> golden fixture. Do not edit either body before it lands.)
>
> PREVIOUS: 2026-08-28 against **plan 29-03** (the first EXTERNAL adapters land:
> `packages/backend/convex/knowledgeExternalSources.ts` + `gmail.knowledgeQuery` + the HubSpot
> CRM read. **`crm-facts` IS NOW SEARCHABLE** — the search plane got its own landedness
> determination, `KNOWLEDGE_ADAPTERS`, and it deliberately disagrees with the pack plane; see
> invariant 23.) Previously verified against the SECOND 29-01 adversarial-repair round (a first pass found
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
| `packages/core/src/knowledgeSearch.ts` | The closed source registry (`KNOWLEDGE_SOURCES` — a named SUBSET of `workflowPacks.ts`'s `PackSource`; `KNOWLEDGE_ADAPTERS` and `NOT_LANDED_SOURCES`, DERIVED from it), `KnowledgeSourceState`, `SEARCH_CAPS`, `clampEvidence` (the cap-enforcing admission boundary), `validateSourceRef`, `authorityFor`/`weakestAuthority`, `freshnessFor`/`oldestFreshness`, `normalizeEvidenceText`/`dedupeEvidence`, `clampSearchPlan`, `validateSynthesis`, `aggregateCoverage`, `renderSourceGap`, `groundedSourceProps`, `searchConfidence`, `redactedSearchEvent`. |
| `packages/core/src/knowledgeSearch.test.ts` | 95 tests. Every honesty rule above has a mutation recorded in `29-01-SUMMARY.md`, and each mutation listed there was OBSERVED red. |
| `packages/core/src/workflowCustomization.ts` | `CUSTOMIZATION_FIELD_KINDS`, `MATERIAL_FIELD_KINDS`, `CUSTOMIZATION_CAPS`, `validateCustomization`, `renderCustomization`, `canonicalCustomization`, `classifyCustomizationChange`, `checkBaseVersion`, `TenantSkillRef`, `WorkflowPin` (carries `tenantSkillId`, NOT a version) / `pinIdentity`/`pinMatchesActive`/`freshRunCorrelation`. |
| `packages/core/src/workflowCustomization.test.ts` | 87 tests, including the "ordinary business prose is not refused" corpus and the SOURCE-TEXT recurrence scan that replaced two unfalsifiable runtime bans. |

**Backend (29-01 schema, 29-03 external adapters)**

| File | Role |
|---|---|
| `packages/backend/convex/schema.ts` | `knowledgeSearches` (new), `tenantSkills` template-lineage fields + `by_tenant_template`, `savedPrompts` pin-lineage fields + `by_tenant_template`. |
| `packages/backend/convex/schema.test.ts` | 32 tests: the Phase-29 widening proved by INSERT (not by substring), and the **recurrence-absence scan** that nothing else in the repo performed. |
| `packages/core/src/tenantData.ts` | `knowledgeSearches: "tenant_owned"` — owned by `audit-dead-letter.md`, listed here because Phase 29 is why the row exists. |
| `packages/backend/convex/knowledgeExternalSources.ts` | **29-03.** The EXTERNAL adapters: `EXTERNAL_KNOWLEDGE_READERS` (the code-owned reader registry), `readInboxKnowledge` (via `gmail.knowledgeQuery`), `readCrmKnowledge` (via the landed `hubspot.readHubSpotDataset`), `unavailableResult`/`answeredResult` (the only two state constructors) and `CRM_UNAVAILABLE_REASON` (the closed credential-reason map). Registered under this playbook in `watch.json`. |
| `packages/backend/convex/knowledgeExternalSources.test.ts` | **29-03.** Two-tenant isolation, injected-instruction fixtures, the reader-registry drift scans and the structural containment scans. |
| `packages/backend/convex/knowledgeLlm.ts` | **29-04.** The TWO toolless model calls: `planKnowledgeSearch` (question -> `{source, query}` pairs, over a code-supplied source list, re-checked by `clampSearchPlan`) and `synthesizeKnowledge` (fenced evidence -> claims, post-validated by `validateSynthesis`). Both take a `skillVersion` PIN. `SMOKE::knowledge-plan::` / `SMOKE::knowledge-synth::` are the offline seams, and they replace the `generateObject` call ONLY — the fixture's output still crosses the pure validators. Registered under this playbook in `watch.json`. |
| `packages/backend/convex/knowledgeLlm.test.ts` | **29-04.** 29 tests: plan clamping by name, the plan-plus-gap totality property, the model-failure fallback, invented citations, cross-document excerpts, conflict survival, code-owned authority/freshness, the pin, and the structural containment scans. |
| `packages/contracts/skills/knowledge-query-planner.md` + `.../knowledge-synthesizer.md` | **29-04.** The canonical bodies (with the derived `.ts` constants in `packages/contracts/src/skills/`). Owned by `skill-registry.md` — read that playbook's Last-verified block before editing either. |

**Consumed, not owned** (their own playbooks apply — read those before touching them)

| File | Playbook | What Phase 29 uses |
|---|---|---|
| `packages/backend/convex/vaultGround.ts` | `vault.md` | `vaultGroundHydrated` — `{docIds, titles, origins, chunks, spine}`, caps 1500/doc and 8000 total. |
| `packages/backend/convex/vaultDrive.ts` | `vault.md` | `findInDrive` only. Never `importDriveFolder`. |
| `packages/backend/convex/gmail.ts` | `cockpit.md` | Read verbs only. **29-03 added `knowledgeQuery`** — a FIFTH read verb, separate from `search` (a contact resolver that never fetches a body). `escapeGmailQuery` neutralizes Gmail operator syntax; 25 ids listed, 5 bodies hydrated, each truncated to `SEARCH_CAPS.evidenceTextCharCap`; NO audit row, NO sender returned. |
| `packages/backend/convex/skills.ts` | `skill-registry.md` | `loadEffectiveSkill`, `publishUserCandidate`, `recordTenantEvalEvidence`, `activateTenantCandidate`, `rollbackTenantSkill`. |
| `packages/backend/convex/savedPrompts.ts` | `cockpit.md` | `save`/`list`/`remove` and the workspace pin menu. **Phase 29 extends the ROW, not this module.** |
| `packages/core/src/workflowPacks.ts` | `workflow-packs.md` | `WORKFLOW_PACK_IDS`, `PACK_SOURCE_LABEL`, `packPreflight`, `toolsForWorkflowPack`. |
| `packages/backend/convex/guardrails.ts` | `guardrails.md` | `preCall` / `recordSpend` — the budget gate every toolless call must cross. |
| `packages/backend/convex/hubspot.ts` | `connector-hubspot.md` | `readHubSpotDataset` ONLY, dataset `deals`. GET-only, allow-listed paths, a bounded `Projection`. Phase 29 never writes, never adds a path and never passes a query. |

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
- **THE SEARCH PLANE AND THE PACK PLANE ANSWER DIFFERENT QUESTIONS ABOUT LANDEDNESS, AND THEY
  DISAGREE ON `crm-facts` ON PURPOSE.** `MISSING_PACK_SOURCES` means *no agent-reachable read
  TOOL exists*, and its own docstring carries owner decision A (2026-08-23, binding): do NOT add
  read tools to close these. `KNOWLEDGE_ADAPTERS` in `knowledgeSearch.ts` means *no landed
  TOOLLESS adapter exists*. Phase 29's search plane is toolless by design — that is its whole
  safety argument — so a source can be searchable here while remaining, correctly and
  permanently, unreachable to a workflow pack's tool grant. `crm-facts` is exactly that as of
  2026-08-28 (Phase 28's `convex/hubspot.ts` landed a GET-only bounded CRM read).
  **`NOT_LANDED_SOURCES` was derived from `MISSING_PACK_SOURCES` until 29-03, which conflated the
  two questions.** `support-desk` is `null` on both planes — nothing landed for it at all.
  Evidence: `.planning/phases/29-unified-knowledge-and-routines/29-DEPENDENCY-EVIDENCE.md` §2 and
  the post-merge addendum of 2026-08-28.
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
   proposes `{source, query}` pairs. **LANDED as of 29-04:** `knowledgeLlm.planKnowledgeSearch`.
   The `source` enum in its JSON schema is BUILT from `KNOWLEDGE_SOURCES` minus
   `NOT_LANDED_SOURCES`, so an unadaptered source is not in the grammar — and `clampSearchPlan`
   re-checks it anyway. A model-call failure falls back to a VAULT-ONLY plan (invariant 29).
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
   One provider failure never erases a successful source. **Landed as of 29-03:**
   `knowledgeExternalSources.readInboxKnowledge` and `.readCrmKnowledge` (29-03),
   `knowledgeVaultDrive` (29-02). They return `{state, evidence}` and write to no plane at all.
5. `dedupeEvidence` collapses the same record read twice AND SAYING THE SAME THING, reports a ref
   that disagrees with itself as `conflicting`, and **cross-links** identical text from different
   records without deleting either.
6. A second **toolless** call synthesizes claims citing evidence ids. **LANDED as of 29-04:**
   `knowledgeLlm.synthesizeKnowledge`, which takes FENCED evidence blocks and returns
   `{summary, claims, unanswered}` and nothing else — there is no `authority`, `confidence`,
   `probability`, `freshness` or `score` property in its schema and `additionalProperties: false`
   forbids one, so those values are ABSENT rather than ignored (invariant 6, now structural).
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
| 16 | **A not-landed gap is `not_landed`, never a stub adapter and never an empty success**, and the sentence also names the UNLOCK. Since 29-03 that is `support-desk` alone. | Owner ruling, 2026-08-27. Naming a gap without naming its unlock leaves a complaint instead of a next step. | `NOT_LANDED_SOURCES` (derived) + `clampSearchPlan` + `renderSourceGap` reading `MISSING_SOURCE_UNLOCK`. MUTATION OBSERVED RED: return the bare sentence for `not_landed`. |
| 17 | **EVERY `SEARCH_CAPS` ENTRY IS ENFORCED BY CODE.** Six of eleven were enforced by nothing while `schema.ts` cited them as bounds. | A cap nothing applies is a documented invariant with no enforcement, and the 29-0x adapter that trusts the comment puts an unbounded array on a Convex row. | `clampEvidence`/`clampSearchPlan`/`validateSynthesis`, plus a source scan (`NO CAP IS DEAD`) that fails when a key becomes declaration-only. Two by-construction exceptions are named in that test. Same rule and same test for `CUSTOMIZATION_CAPS`. |
| 18 | **ONE SOURCE VOCABULARY.** `KNOWLEDGE_SOURCES satisfies readonly PackSource[]`; labels and unlocks come from `workflowPacks.ts`. | A pin's `sourcePreferences` are `PackSource[]`; a forked search vocabulary makes a preference unable to select a source with no code that could translate. | `satisfies` at compile time, plus "every knowledge source IS a PackSource" and the derived `NOT_LANDED_SOURCES` test. |
| 20 | **THE CONVEX ENUMS ARE THE `@pikar/core` ENUMS, DERIVED — NOT HAND-COPIED.** `knowledgeSource`, the unavailable/partial reasons, the authority classes, the freshness labels and the confidence labels are all built by `schema.ts`'s `literals(...)` helper from the exported const array. | They were hand-copied, and three separate narrowings of them each left the whole backend suite AND the typecheck green: dropping `support-desk` from the source union, `unplanned` from the unavailable reasons, `agent_authored` from the authority classes. Nothing crossed the package boundary. The cost is exactly the honest-gap row this phase exists to produce: core can construct `{status:"unavailable", reason:"not_landed", source:"support-desk"}` and the validator would refuse it at INSERT time, at runtime, with nothing red in CI. | One list, not two. Falsified by `schema.test.ts`, "the Convex enums are the @pikar/core enums, proved by storing every member" — it inserts EVERY member of every core constant, plus a scan that fails if any member reappears as a hand-written `v.literal` inside `knowledgeSearches`. MUTATIONS OBSERVED RED: hand-write each of the three unions back minus one member. |
| 21 | **`groundedSourceProps` PROJECTS VAULT EVIDENCE ONLY into `docIds`.** Non-vault citations come back in `nonVault` and must be rendered without a vault drill-in. | `docIds[i]` is not a neutral id: `cards.tsx:2413 GroundedSources` -> `:2373 VaultDocButton` -> `:2317 VaultDocModal` OPENS it as a vault document. The first version mapped every source's `sourceRef` in, so a Gmail message id rendered a clickable control that opens a document that does not exist — committing, one plane over, the exact naming lie this function's own JSDoc rejects for `citationDocId`. | `knowledgeSearch.test.ts`, "NO NON-VAULT REF EVER REACHES docIds". MUTATION OBSERVED RED: drop the `.filter((e) => e.source === "vault")`. |
| 22 | **`savedPrompts.sourcePreferences` MEMBERSHIP is closed by the Convex validator** — the full `PackSource` vocabulary, derived, not `v.array(v.string())`. | It was `v.array(v.string())` under a comment reading "Bounded `PackSource` names", and a convex-test probe stored `["notion","http://evil.example","sharepoint"]` verbatim: a documented invariant with no enforcement, one field over from where the identical hole had just been closed on `claims[].evidence[].source`. | `schema.test.ts`, "sourcePreferences refuses a source the product does not have — a WRONG VALUE, not a wrong type". MUTATION OBSERVED RED: reopen to `v.optional(v.array(v.string()))`. **LENGTH is NOT bounded** — see Known gaps. |
| 19 | **A PIN NAMES THE EXACT `tenantSkills` ROW, never a (name, version) pair.** | Two tenants can hold the same name AND version — which is why `recordTenantEvalEvidence` keys on the row id, and why the landed rail is `Record<string, Id<"tenantSkills">>` (dispatch.ts:234/:256). | `WorkflowPin.tenantSkillId: TenantSkillRef \| null`, `pinIdentity`/`pinMatchesActive` compare it, and `savedPrompts.tenantSkillId` is `v.id("tenantSkills")` — proved by INSERT, not by a substring scan. MUTATIONS OBSERVED RED: relax to `v.optional(v.string())`; drop the id from `pinIdentity`. |
| 23 | **LANDEDNESS ON THE SEARCH PLANE IS DERIVED FROM `KNOWLEDGE_ADAPTERS`, WHICH NAMES A MODULE AND A VERB — never from `MISSING_PACK_SOURCES`, and never from a boolean.** | The two planes ask different questions (see "Dependencies & blast radius"). A boolean would be a claim with nothing to check it; the module path is what makes the claim falsifiable from outside the pure package. Moving `crm-facts` into `REACHABLE_PACK_SOURCES` to remove the disagreement would silently reverse a binding owner decision and tell every workflow pack a CRM tool exists. | `knowledgeSearch.test.ts` ("THE TWO PLANES ANSWER DIFFERENT QUESTIONS", pinned in BOTH directions) + `knowledgeExternalSources.test.ts`, which reads the named modules off disk. MUTATIONS OBSERVED RED: hand-write `NOT_LANDED_SOURCES`; derive it from `MISSING_PACK_SOURCES` again; null the `crm-facts` adapter; point `support-desk` at a module that does not exist; rename a verb the module does not export; delete `crm-facts` from `MISSING_PACK_SOURCES`. |
| 24 | **AN ADAPTER AND ITS SOURCE'S SEARCHABILITY LAND TOGETHER, IN BOTH DIRECTIONS.** A source may not be reported landed with no adapter behind it, and an adapter may not land for a source the search plane still calls `not_landed`. | The first is the lie this phase exists to prevent; the second is dead code behind an invisible gap. | `EXTERNAL_KNOWLEDGE_READERS` in `knowledgeExternalSources.ts` is scanned against `NOT_LANDED_SOURCES` both ways, plus a totality check that every landed non-vault/drive source has a reader. MUTATION OBSERVED RED: add a `support-desk` reader while `support-desk` has no adapter. |
| 25 | **THE EXTERNAL ADAPTERS WRITE NOTHING TO ANY GOVERNANCE PLANE.** No audit row, no telemetry row, no dead letter, no `agentSteps` row, no `payload:` literal, no direct `fetch`. | A unified search reads several sources and owes exactly ONE refs-only `knowledge.searched` event, owned by the 29-06 coordinator. Per-source events would let the log plane infer the shape of the question from how many rows appeared — and a subject line or a mail body in a payload is the §4 PII honeypot. | A source scan in `knowledgeExternalSources.test.ts` (the `briefings.ts` content-plane idiom), plus behavioural assertions that `audit`/`agentSteps`/`telemetry`/`deadLetters` are EMPTY after a read carrying a prompt injection. |
| 26 | **AN UNREACHABLE OR PARTIAL EXTERNAL READ IS NAMED, NEVER SHRUNK.** `unavailableResult` is the only constructor of an unavailable state in the adapters and always returns zero rows with it; a further provider page, a hydration cap, a truncated body, a per-source evidence cap or a dropped malformed ref each produce `partial` with a reason. A provider's own `because`/`missing` string is NEVER forwarded onto the closed enum. | Presenting five of twenty-five messages, or eight of two hundred deals, as a complete read is the same lie as presenting an unreachable CRM as an empty one. `reason` reaches a stored row, so it must stay a code-owned enum (CLAUDE.md §4). | `knowledgeExternalSources.test.ts`. MUTATIONS OBSERVED RED: rewrite `unavailableResult` as `{available, returned: 0}`; force `lost` to `null`; narrow the partial condition; forward the credential layer's raw `revoked` onto the enum; remove the per-source slice. |

| 27 | **A NOT-LANDED SOURCE IS `not_landed` WHETHER OR NOT THE PLANNER NAMED IT.** `settlePlan` decides the reason from the ADAPTER REGISTRY, never from what the model happened to say. | `clampSearchPlan` can only mint `not_landed` for a source the model PROPOSED, so relying on it alone made `support-desk` read as `unplanned` — "we chose not to look there" — on every ordinary run. That is a materially softer and different sentence from "this product cannot look there yet, and here is what would unlock it", and it silently erases the one honest-gap the phase's own owner ruling exists to preserve. Found by a test, not by review. | `knowledgeLlm.test.ts`, "EVERY source is accounted for exactly once across plan + skipped". MUTATION OBSERVED RED: hardcode `reason: "unplanned"` (2 tests). |
| 28 | **THE RAW MODEL OBJECT NEVER LEAVES `knowledgeLlm.ts`.** Every path — live, offline fixture — converges on `validateSynthesis` before returning, and the planner's every path converges on `clampSearchPlan`. | A caller that could receive an unvalidated claim would eventually be written, and "the coordinator validates it" is a convention, not a guarantee. Making it structural means there is no unvalidated shape to hand out. | `knowledgeLlm.test.ts` drives invented ids, cross-document excerpts and conflicts THROUGH the action, not through the pure function. MUTATIONS OBSERVED RED: replace `validateSynthesis` with a pass-through (4 tests); bypass `clampSearchPlan` for the plan (6 tests). |
| 29 | **A PLANNER FAILURE DEGRADES TO THE TENANT'S OWN DOCUMENTS, NEVER TO AN EMPTY SUCCESS.** The fallback is a vault-only plan carrying the user's own words, plus an honest `unplanned`/`not_landed` state for every other source, and `fallback: true` on the result. | "The planner errored, so we searched nothing, so there is nothing" is the same lie as an unreachable source with a zero count — one plane up. | `knowledgeLlm.test.ts`, "a planner FAILURE degrades to the tenant's OWN documents", driven through the REAL `catch` by the `SMOKE::knowledge-plan::FAIL` directive. MUTATION OBSERVED RED: return an empty plan from the fallback. |
| 30 | **AUTHORITY, CONFIDENCE, FRESHNESS AND RESULT LIMITS HAVE NO SCHEMA FIELD.** Neither `jsonSchema` declares one and both objects carry `additionalProperties: false`. | Invariant 6 said the model "does not get to grade its own work", but it was enforced by nobody reading a field the model was free to emit. Absent-by-grammar is a different guarantee from ignored-by-convention, and it is the one that survives a body edit. | `knowledgeLlm.test.ts`, "NEITHER SCHEMA HAS A FIELD FOR AUTHORITY, CONFIDENCE OR A LIMIT" (comments stripped, with a positive control). MUTATION OBSERVED RED: add `confidence: { type: "number" }` to the synthesis schema. |
| 31 | **BOTH KNOWLEDGE CALLS ARE PINNABLE, AND A BAD PIN FAILS RATHER THAN FALLING BACK.** `skillVersion` loads that EXACT version through `getSkillVersion`; a version that does not exist throws `NO_SUCH_SKILL_VERSION`. | This is the ONLY thing that can ever make the two GATED bodies certifiable: an eval run that silently measured the ACTIVE body while claiming to certify a candidate would record passing evidence for the wrong prompt. | `knowledgeLlm.test.ts`, "THE PIN REACHES THE LOAD" (both actions) and "a pin naming a version that does not exist FAILS". MUTATION OBSERVED RED: make the pinned branch load the active row. |
## How to change safely

**Adding a source** (only when its adapter genuinely lands): add it to `workflowPacks.ts`'s
`REACHABLE_PACK_SOURCES` or `MISSING_PACK_SOURCES` **first** (with its `PACK_SOURCE_LABEL`, and its
`MISSING_SOURCE_UNLOCK` + `MISSING_SOURCE_MENTIONS` if missing), then to `KNOWLEDGE_SOURCES` and
`SOURCE_AUTHORITY`. Do **not** touch `schema.ts`'s `knowledgeSource` — it is DERIVED from
`KNOWLEDGE_SOURCES` (invariant 20) and follows on its own. Do NOT edit
`NOT_LANDED_SOURCES` — it is derived from `KNOWLEDGE_ADAPTERS`. **When an adapter genuinely lands,
add its module + verb to `KNOWLEDGE_ADAPTERS` and a reader to `EXTERNAL_KNOWLEDGE_READERS` in the
same change** (invariant 24), and leave `MISSING_PACK_SOURCES` alone unless an agent-reachable read
TOOL also landed — those are different questions (invariant 23). Keep `SEARCH_CAPS.maxSources === KNOWLEDGE_SOURCES.length` (a test pins it).
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
| **THE EVAL GATE ON `knowledge-query-planner` AND `knowledge-synthesizer` IS NOT YET CLEARABLE.** Both are in `GATED_SKILLS`. `seedSkills`' `rows.length === 0` branch lands them at v1 `active`, so nothing is blocked today — but the FIRST BODY EDIT mints a candidate `activateSkill`'s EVAL_GATE holds until a green `pnpm eval:golden --skill <name>@N` run, and `run-eval-golden.mjs` drives `llm:runCockpitAgent` and nothing else. **Do not edit either body until 29-06 lands.** | **PLAN 29-06 OWES THIS**: a cockpit-side knowledge tool, `skillVersions` threaded into `knowledgeLlm`, and at least one golden fixture that drives a knowledge search. Half the rail is already built — both actions take a `skillVersion` pin and `knowledgeLlm.test.ts` proves the pinned body is what answers (invariant 31). Recorded on both constants in `packages/contracts/src/skill.ts`, on the `SEEDS` rows, and in `skill-registry.md`. |
| **NOTHING CALLS `knowledgeLlm` YET.** The two actions, their schemas, their offline seams and 29 tests exist; there is no coordinator, no `knowledgeSearches` write and no UI. | Plan 29-06. |
| **`knowledgeSearches.runId`'s comment overstates what 29-04 built.** It reads "the run correlation the toolless planner/synthesizer calls spent against", but each action MINTS ITS OWN per EXECUTION (`blueprint.ts:271`'s reasoning: re-entering an action re-runs the model call, so the second charge is real and needs its own ledger row; a stable correlation would put the ledger BELOW the limiter). So there are two spend correlations per search, `knowledge:plan:<runId>` and `knowledge:synth:<runId>`, and neither is the coordinator's own row id. | Both actions RETURN their `runId`. 29-06 should store the coordinator's own correlation in `knowledgeSearches.runId` and, if the join matters, keep the two returned ids beside it. `schema.ts` was not edited from here — it is 29-01's file and the repo's highest-collision one. |
| `ponytail:` **`SUMMARY_CHAR_CAP` (1,200) lives in `knowledgeLlm.ts`, not in `SEARCH_CAPS`.** It is not a search bound — it is how much model prose may reach a stored row — and `@pikar/core`'s cap set is covered by a `NO CAP IS DEAD` scan that demands an enforcement site IN THAT PACKAGE. Ceiling: a cap outside the one registry of caps. | Enforced at the only place a summary is produced, and covered behaviourally (the offline fixture echoes the question so a 5,000-character input drives the cap; `1_200` is a literal). Upgrade path: move it into `SEARCH_CAPS` when `@pikar/core` gains a summary-shaping function to enforce it. |
| `ponytail:` **`literals()` is a two-line copy of `schema.ts`'s private helper.** Ceiling: two identical validator helpers over one boundary. | Comment on the function. Upgrade path: export ONE from `convex/lib/` when a third caller appears — not from `schema.ts`. |
| **The planner fallback passes the question through UNSANITIZED** (truncated to `queryCharCap`). A question containing a URL is refused by `clampSearchPlan`'s remote-address rule, so the vault-only fallback returns an empty plan for it. Deliberate: the refusal is visible as a `remote_url` rejection instead of being silently repaired. | `ponytail:` comment on `fallbackPlan`. Upgrade path: strip addresses THERE, never inside `clampSearchPlan` — that function's job is to refuse, not to rewrite. |
| **`support-desk` is `not_landed`** — nothing landed for it on either plane. `crm-facts` STOPPED being not-landed on 2026-08-28 when Phase 28's HubSpot rail merged. | `29-DEPENDENCY-EVIDENCE.md` §2, the post-merge addendum, and invariant 23. |
| **The CRM read is HubSpot `deals` only, and it ignores the planner's query.** `HUBSPOT_READ_PATHS` has no search endpoint (CRM Search carries its own rate limit and needs its own decision, 28-05), so a CRM knowledge read is a 90-day windowed list of the 8 most recently updated deals and the synthesis model filters them. QuickBooks read, Stripe, PayPal and any support desk are absent. | `ponytail:` comments in `knowledgeExternalSources.ts`. Upgrade path: add CRM Search to the allow-list with its own budget, or add datasets, in a plan that owns `connectorFetch`. |
| **The inbox adapter returns NO sender**, so an answer cannot say "Sarah said X". Deliberate: the landed toolless firewall is BODY-scoped, so senders and subjects already reach the tool-bearing briefing loop, and Phase 29 must not widen that. | `ponytail:` comment on `KnowledgeMailMessage`. Upgrade path: a server-side sender table addressed by index, the `buildRecipientView` idiom. |
| **Inbox hydration selects by RECENCY, not relevance** — Gmail's own newest-first list order, top 5 of up to 25 matches. | `ponytail:` comment in `gmail.knowledgeQuery`. Upgrade path: fetch metadata for all listed ids and rank in pure code, at 5x the quota. |
| **`savedPrompts.textHash` collision** for two pins of the same text under different customizations. | "How to change safely" above; must be fixed in plan 29-08 before the first lineage-bearing pin. |
| **`USER_AUTHORABLE_SKILLS` is a closed three-name allowlist** and does not yet include the six workflow packs. Widening it is a plan-29-05 decision with eval consequences. | `29-DEPENDENCY-EVIDENCE.md` §1.3. |
| `ponytail:` no hash function in `@pikar/core` — dedupe compares normalized strings directly. Ceiling: a corpus larger than `totalEvidenceCharCap`. | Header comment of `knowledgeSearch.ts`. |
| `ponytail:` `validateSourceRef` and `packages/revenue/src/contracts.ts` hold two shape rules for one §4 boundary, and revenue's is the laxer denylist form. The Phase 28 lane owns that file, so it cannot be edited from here. Ceiling: two rules, one boundary. Upgrade at merge: delete revenue's copy, import this one. | `ponytail:` comment on `validateSourceRef`. |
| `ponytail:` `KnowledgeSourceState` and `packPreflight`'s `SourceState` are two SHAPES over one vocabulary. Ceiling: a caller that needs both must switch on `status` twice. Upgrade path: widen `SourceState` into the reason-carrying object and migrate `packPreflight` + the 30 landed eval fixtures in one change. | Doc comment on `KnowledgeSourceState`. |
| **The `mediaJobs.provider` reflow in commit `1e914f9` was not reverted.** It is an unrequested formatting-only edit outside Phase 29's blast radius, and the audit was right to flag it — but `biome@2.5.3` at `lineWidth: 100` REQUIRES the collapsed single line (verified: reverting it makes `biome format packages/backend/convex/schema.ts` red). Reverting would ship formatter-red code that the next save flips back. | 29-01-SUMMARY.md, "deliberately not fixed". |
| **`sourcePreferences` array LENGTH is unbounded at the storage boundary.** Membership is closed (invariant 22); a Convex validator has no array-length bound, so 10000 repeats of `"vault"` is storable. Claiming a length bound in a comment is the defect invariant 22 exists to record, so it is recorded here instead. | `ponytail:` comment on the field. The real ceiling is `CUSTOMIZATION_CAPS.maxValuesPerField` (8) in `validateCustomization`; there is no writer of this field yet. Upgrade path: clamp in the `savedPrompts` mutation when plan 29-08 writes the first pin, and assert the refusal there. |
| **`packages/backend/convex/schema.ts` is NOT watched by the §9 hook.** It is registered under `watch._unassigned` — explicitly acknowledged rather than left as a silent hole. | `watch.json` prefixes are per-file and `schema.ts` holds all 47 tables, so assigning it to this playbook would demand a knowledge-search bump for every unrelated table edit repo-wide — noise that trains readers to ignore the hook. The Phase-29 tables' real gate is `schema.test.ts`, which IS watched here and which now fails on enum drift, header drift and value drift. |
| **Recurrence is entirely deferred**, by decision, not by omission. | Plan 29-11's decision record; invariant 15. |
