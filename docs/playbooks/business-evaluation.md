# Playbook: Business Evaluation Engine

> Last verified: 2026-07-31 (ACTN-03) — **`applyScorecardAnswer` now COERCES before it writes, and
> `actOnGapInternal` forwards a skill pin.** (1) The cockpit's `recordScorecardAnswer` tool types
> `value` as a STRING in its JSON schema, so every boolean scorecard leaf arrived as `"true"` /
> `"false"` — and `"false"` is TRUTHY, so `diagnose()`'s presence counts scored a known-ABSENT offer
> type or lead channel as PRESENT. Measured, not theorised: run `c1fe054c` fixture 30 stored
> `offerTypesPresent={attraction:"true",continuity:"false",downsell:"false",upsell:"false"}` and the
> engine returned `healthy` with zero gaps, so the "Act on this" tap had nothing to act on
> (`gap_not_found`). `coerceScorecardValue` sits at the ONE choke point both writers route through,
> and decides by the SHAPE OF `emptyScorecard` (`typeof getPath(emptyScorecard, field) === "boolean"`)
> rather than a hand-maintained field list — the three nullable-boolean paths are the only names it
> spells out. It deliberately leaves `identity.currentOffers` alone (`typeof [] === "object"`):
> `hasOffer` reads `.length > 0`, which is correct for a bare string too. **Rule for a new scorecard
> leaf: give it a real default in `scorecard.ts` and the coercion follows for free; a leaf that
> defaults to `null` and means a boolean must be added to `NULLABLE_BOOL`.** (2) `applyActOnGap`
> takes a trailing optional `skillVersions` forwarded to the scheduled `internal.dispatch.runSpecialist`
> — the eval harness's `--skill` pins otherwise never reached the specialist. `actOnGap` (the UI
> path) deliberately passes none and keeps running the ACTIVE row. PREVIOUS: 2026-07-31 — 22-01 (GOVN-01), TEST-ONLY, no engine behaviour changed: the
> lineage assertion in `evaluations.test.ts` dropped its `stableTenant(TENANT)` wrapping. That
> call was a literal no-op (`TENANT = "tenant_a"` carries no `|sessionId` suffix, so the parser
> returned it unchanged) and the helper was deleted from production source when identity moved
> to the auth package's `getAuthUserId`. The assertion now compares against `TENANT` directly and
> is byte-equivalent in meaning. Nothing in `evaluations.ts` was read or modified — see
> `authorization.md`. PREVIOUS: 2026-07-30 — 17.1-07 (BLPR-02): the confirmed Business Blueprint now enters the
> evaluation chunk set explicitly, after authoritative profile seeds and before ordinary retrieval.
> A contradictory derived figure cannot beat the user's typed value or take its provenance. See
> **"Blueprint standing context and the provenance ceiling"** below.
>
> PRIOR — 2026-07-27 — 16-06 (DISP-02), **CONFIRMED by 16-06's author against the committed code.** **`landSpecialistResult` gained an optional `fallbackBody`, and 16-06 added a SECOND stager (`plans.stageResearchPlan`).** The section **"A second stager, and a memo that stops lying"** below was drafted by the 15.2 lane off the then-uncommitted diff; 16-06's author has now read it against the shipped code and it is ACCURATE — the provenance caveat it carried is resolved and removed. The gap path is byte-identical (`runSpecialist` passes no `fallbackBody`), and the whole 15-04 landing suite is green unchanged, which is the proof rather than the claim. See `cockpit.md` § "Phase 16 — the async research dispatch seam" for the seam's other half.
> Prior: 2026-07-26 — 15.1-04 (ONBD-02, SC#2b): **the rubric is picked from the `tenantProfiles` ROW, not from a string matched out of markdown.** `PERSONA_FRAMEWORK` became `TIER_FRAMEWORK`, bound `as const satisfies Record<Tier, Framework>` (`enterprise` → `swot`, the honest SME-shaped default for an operator grant, D6), and `runEvaluation` reads `internal.tenantProfile.forTenant({ tenantId })` ONCE beside the carry-forward read. **`personaHint` is deleted** — it was the LAST authoritative reader of the markdown persona, which is what makes design §4.2's claim true that `deserializeProfile`'s `"solopreneur"` fallback "stops being a silent reclassification risk once nothing authoritative depends on it". The `text.includes("- **Persona:**")` block SURVIVES as a profile detector and keeps its four CONTENT `fillVault` calls; only the AUTHORITY was removed. The trailing `?? "lean"` was dropped deliberately (the lookup is total, so it was an assertion that could never fail — the Phase-15 `armFor` lesson). **Q3 is unchanged and LOCKED:** `financialsPresent` still overrides with `growth-os`; the tier's perceivable effect lands on the specialist prompt (ADR-009), not on the rubric. New tests confirmed RED first — both authority cases returned `"lean"` against the old code. `evaluations.test.ts` 23/23, `proactiveReview.test.ts` 8/8, `gapAction.test.ts` 5/5.
> Prior: 2026-07-26 — 15-06 (DISP-01): **`actOnGap` now has an identity-less twin.** Its handler was extracted verbatim into a shared `applyActOnGap(ctx, tenantId, threadId, gapIndex)` behind TWO surfaces: the unchanged auth-scoped `actOnGap` (the UI path) and the new `internal.evaluations.actOnGapInternal`, which takes an explicit `tenantId`. Same shape and same reason as `applyScorecardAnswer` / `recordScorecardAnswerInternal` (12-04): `npx convex run` carries NO auth identity, so the golden-eval harness could not otherwise reach the tenant-scoped mutation. It exists so an eval fixture drives the REAL user path — gap → tap → `collecting` → scheduled `internal.dispatch.runSpecialist` → `landSpecialistResult` → `proposed` — rather than a re-implemented imitation of it; because both surfaces share one implementation, the two-terminal choice, the plan recycle and the scheduled dispatch cannot be true in one and absent in the other. ZERO behaviour change: the returned union is unchanged (now the named `ActOnGapResult`, explicit per Convex guidelines §96 so the generated API does not collapse for `apps/web`), and the whole 18-test `evaluations.test.ts` + 5-test `gapAction.test.ts` + 31-test `dispatch.test.ts` set is green unchanged — that is the proof, not a claim. **If you add a guard to the tap, add it to `applyActOnGap`, never to a wrapper.**
> Last verified: 2026-07-26 — 15-04 (DISP-01): **"Act on this" RUNS the specialist.** `actOnGap` stays a `tenantMutation` and now has TWO terminals — a gap routed at a REGISTERED specialist stages `status: "collecting"` with NO body and schedules `internal.dispatch.runSpecialist`; a gap with no registered specialist keeps the 12-05 memo at `proposed` and schedules nothing. The `collecting` staging IS the Approve-race mitigation (a template must never be approvable under a specialist attribution header) and must not be "simplified" back. `landSpecialistResult` is the only writer of the dispatched body and no-ops on any row that is not still `collecting`/`kind: "memo"` under the same tenant; `buildMemo` is now the FALLBACK and its wording branches on `fallbackReason`. See the **"Act on this" now RUNS the specialist** section below. `evaluations.test.ts` 18/18, `gapAction.test.ts` 5/5.
> Last verified: 2026-07-25 (5) — 14-01 (Phase-14 Wave-0 freeze, Lane C): the `evaluations` TABLE is now shared with the voice-doc flow, but this ENGINE is not. `evaluations.framework` gained a fifth literal `"document-review"`, `findings[]` gained an optional `citationExcerpt`, and a doc-review row is written STRAIGHT through `insertEvaluation` by `voiceDoc.ts` — it never enters `runEvaluation`, has no rubric skill and no `diagnose()` path. **The load-bearing consequence: `runEvaluation`'s `framework` arg is now explicitly PINNED to the four business frameworks instead of being derived from `evalFields`.** See the new **"Sharing the evaluations table with voice-doc (Phase 14)"** section below. Zero behavior change for every existing business-evaluation caller; `evaluations.test.ts` and `proactiveReview.test.ts` unchanged and green, backend 497/498 (sole red the pre-existing `audit.test.ts auditCounts`).
> Prior: 2026-07-25 (4) — 13-02: the **proactive weekly review** (`proactiveReview.ts`, BEVL-03) — a Monday-06:00-UTC cron enumerates onboarded tenants over `vaultDocuments.by_kind`, fans out one `reviewOne` per tenant, runs this engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, and writes an in-app notification only when something changed. See the **Proactive weekly review** section below. **The repeat-run provenance collapse recorded in the previous line is now CLOSED** — it had to be, because a weekly review is by design a repeat run on one pinned thread. `fillVault` now records a CITATION whenever a grounded document restates a field, even when the slot is already filled by carry-forward (the VALUE stays first-write-wins, and a pre-seeded `user-provided` citation is never downgraded); the two "already set → skip" short-circuits above it (the `currentOffers.length === 0` pre-check and the `FINANCIAL_PATTERNS` `continue`) are gone for the same reason. Regression-guarded by `proactiveReview.test.ts > notifies only on change`, which asserts run 2 has the SAME finding count as run 1 and an empty delta — that test was CONFIRMED red before the fix (a second `weekly_review` notification fired off a false "gaps closed"). `proactiveReview.test.ts` 8/8, `evaluations.test.ts` 11/11 unchanged, backend 494/495 (sole red the pre-existing `audit.test.ts auditCounts`). Prior: 2026-07-25 (3) — 13-01: the optional `evaluations.delta` "what changed" field (BEVL-03 groundwork for the weekly proactive review). See the **"What changed" delta** section below. No behavior change for any existing caller: `withDelta` is opt-in, absent ⇒ no `delta` is written, and the two pre-existing callers (`llm.ts`'s `evaluateBusiness` tool, the tests) pass it nowhere. `evaluations.test.ts` 11/11 (4 new delta tests, all confirmed RED before the engine change). Prior: 2026-07-25 (2) — TWO owner-reported grounding defects fixed; both made a real business assess as "not enough data". **(1) A reference PDF monopolised the corpus.** `rag.search` takes its top-K by CHUNK (`limit: 8`), and `seedDocIds` dedupes only afterwards — so one large book filled every slot and grounding returned exactly ONE doc. Measured live: with the engine's own `DEFAULT_QUERY` the tenant's grounding came back as a single 300-page marketing PDF, the user's own profile never entered the corpus, `findingCount` was 0, and the framework fell back to the persona map (`swot`) because no financials were found. Similarity alone cannot answer "evaluate MY business" — a book ABOUT business outranks a short description OF one on generic business vocabulary. FIX: `runEvaluation` now PREPENDS the tenant's own profile-shaped docs from the new `internal.vault.profileSeedDocs` before the retrieval result. Prepending is load-bearing — `fillVault` keeps the FIRST value per path, so the user's own figures beat book prose. Fail-open: a seed-query failure leaves retrieval-only grounding intact. The shared `vaultGround` is deliberately UNTOUCHED (it also serves `searchVault` + golden fixtures 25/26 — changing it would risk eval-gate churn). **(2) `fillVault` could never fill `identity.currentOffers`.** `emptyScorecard.identity.currentOffers` is `[]`, not null, so the `!= null` guard skipped it forever; `hasOffer` stayed false and `diagnose()` returned Gate 1 ("No offer worth buying yet") on EVERY vault-grounded run, masking the true constraint further down the ladder. The caller's own `.length === 0` check shows the intent. FIX: an empty array now counts as unset. Verified live on the owner's deployment, fresh thread: framework `growth-os`, **8 cited findings** (incl. the previously-impossible `Offer:`), gap = `"Customer doesn't pay for themselves in 30 days."` → `money-model-designer` — exactly the Gate-2 constraint the fixture's economics were built to produce (30-day cash 90 < CAC 180). `evaluations.test.ts` 7/7 with a new regression test that was CONFIRMED to fail against the old guard (`expected [] to have a length of 1`); full backend 479/480 with only the pre-existing `audit.test.ts` red. KNOWN GAP (not fixed, logged): re-running an evaluation in the SAME thread collapses `findingCount` (8 → 1) — carry-forward preserves the scorecard VALUES but not their provenance, so only freshly-filled paths are re-cited. Evaluate in a fresh thread until this is closed. Prior: 2026-07-25 against 12-05 (the gap-action + memo terminal — the ACTING side, BEVL-02)
> Prior: 2026-07-25 against 12-04 (the cockpit-tool store surface + the EVALUATION card)
> Build history: `.planning/phases/12-business-evaluation-engine/` · Related ADRs: none

## Purpose

The one place that turns a user's grounded vault data + carried-forward answers + a framework
method into a durable, tenant-isolated business assessment (BEVL-01). On demand it grounds over the
vault + business profile, runs the pure `diagnose()` from `@pikar/core/growth`, and persists ONE
`evaluations` row with per-finding citations, H/M/L confidence, honest not-enough-data sections, and
a leverage-ranked gap list. It is READ-ONLY (the two-shapes rule): it never proposes or sends —
acting on a gap crosses the Approve gate separately. It audits counts/enums only (§4).

## Key files

Backend (`packages/backend/convex/`):
- `evaluations.ts` — the engine. `runEvaluation` (internalAction: carry-forward → ground → load
  rubric → fill scorecard → `diagnose()`/`leverageRank()` → persist → refs-only audit → activity
  step), `recordScorecardAnswer` (tenantMutation — the client "store" half) + its identity-free twin
  `recordScorecardAnswerInternal` (internalMutation — same `applyScorecardAnswer` core, called by the
  cockpit tool which carries an explicit tenantId, no live identity), `insertEvaluation`
  (internalMutation), `lastForThread` (internalQuery — carry-forward read), `byThread` (tenantQuery
  — the card's latest-row read). **12-05 (the ACTING half):** `actOnGap` (tenantMutation — a gap →
  a proposed memo-plan), `buildMemo` (the deterministic memo template), `persistNextStepMemo`
  (a plain exported helper — the MEMO TERMINAL, called by `cockpit.executePlan`).
  **15-04 (the DISPATCHING half):** `actOnGap` stages `collecting` + schedules
  `internal.dispatch.runSpecialist`; `landSpecialistResult` (internalMutation, explicit `tenantId`)
  is where the run lands and the only thing that flips a dispatched plan to `proposed`; `buildMemo`
  gained the optional `fallbackReason` branch + the code-owned `FALLBACK_SENTENCE` map.
- `schema.ts` — the append-only `evaluations` table (`by_tenant` / `by_tenant_thread`) + the
  `"evaluateBusiness"` literal in the closed `agentSteps.tool` union + (12-05) the optional
  `plans.kind: "memo"` discriminator and the optional `gaps[].reason`/`gaps[].proofMetric`.
- `evaluations.test.ts` — convex-test over the `SMOKE::` seam: grounded cited row, refs-only audit,
  carry-forward/anti-re-ask, two-tenant isolation (SC #5), thin-data honesty.
- `proactiveReview.ts` (13-02, BEVL-03) — the weekly cron's three functions: `runWeekly`
  (internalMutation — enumerate onboarded tenants over `vaultDocuments.by_kind`, dedupe, fan out),
  `reviewOne` (internalAction — the engine on the stable `REVIEW_THREAD_ID`, notify-on-change),
  `insertReviewNotification` (internalMutation — a DIRECT `notifications` insert, never
  `notifications.notify`). See the **Proactive weekly review** section.
- `proactiveReview.test.ts` — five behaviour cases plus the SC#2 (no mailbox token) and SC#3
  (tenant-scoped) static source guards.
- `crons.ts` — `crons.weekly("proactive-review", monday 06:00 UTC)` (see `audit-dead-letter.md`).
- `gapAction.test.ts` — convex-test for BEVL-02: gap → proposed memo-plan (no recipients), a
  healthy/thin evaluation exposes no gap, approve persists a `next_step_memo` vault doc and seeds
  ZERO `requests` rows (the terminal is a persist, NOT gmail), double-approve idempotence.

Pure package (`packages/core/src/growth/`, see `growth-diagnostic.md`):
- `diagnose.ts` / `financialSpine.ts` / `scorecard.ts` — the Convex-free diagnosis the engine calls.

Reused verbatim (do NOT rebuild): `vaultGround.ts` `vaultGroundHydrated` (grounding), `audit.ts`
`log` (refs-only audit), `agentSteps.ts` `record`/`finish` (activity step), `skills.ts`
`getActiveSkill` (rubric body).

## Dependencies & blast radius

Run `graphify query "business evaluation"` for the live subgraph. Couplings graphify cannot see:

- **Grounding is the existing engine** — `internal.vaultGround.vaultGroundHydrated({ tenantId,
  query })` with an EXPLICIT tenantId (never auth-derived — the tool loop/eval harness carry no
  identity). Its `SMOKE::<docId,…>` seam is how the tests ground with zero network.
- **The rubric method is a gated skill row** (12-02): framework → skill name is `FRAMEWORK_SKILL`
  (growth-os→`growth-os-diagnostic`, swot→`swot`, lean→`lean-canvas`, bmc→`bmc`). Missing/inactive
  method → fail-open "insufficient", never a throw.
- **`agentSteps.tool` is a CLOSED union** — the `"evaluateBusiness"` literal MUST exist in schema.ts
  or the step insert throws and is silently swallowed in prod (Pitfall 2).
- **The Scorecard shape is the @pikar/core contract** — a renamed field there breaks the engine's
  fill/diagnose. Anchor the dot-path keys in `TRACKED` / `FINANCIAL_PATTERNS`.
- **auditCounts aggregate** — `evaluation.ran` rides the audit insert → the aggregate; convex-test
  must `registerComponent("auditCounts", …)` (the cockpitTools.test.ts idiom).

## Data flow

1. **Carry forward** — `lastForThread` reads the tenant's latest row; its `scorecard` +
   `userProvided[]` seed this run (a previously-answered figure is never re-asked).
2. **Ground** — `vaultGroundHydrated` returns `{ docIds, titles, chunks, spine }`. The three
   retrieval arrays stay parallel and the confirmed Blueprint is a separate field. The engine reads
   its real vault document id through `blueprint.liveForTenant`, then assembles the final chunk order
   as **profile seeds → Business Blueprint → ordinary retrieval**. Fail open on any error (the
   carried values and ordinary grounding still stand); `spine: null` keeps the pre-17.1 path
   byte-identical.
3. **Fill** — parse a grounded business-profile chunk (`deserializeProfile`) into identity fields
   and scan for direct labeled figures (`CAC: $150`) into financials; each fill records its source
   doc as provenance. A user-provided carried field is provenance "user-provided". A field still
   null → stays null (not-enough-data), never guessed. **Value vs citation are separate rules**
   (13-02): the VALUE is first-write-wins (carried/user-provided/earlier-doc beats a later doc), but
   the CITATION is (re)recorded whenever a document restates the field, so a repeat run over the
   same corpus cites the same things instead of collapsing to zero findings.
4. **Auto-pick framework** — financials present → `growth-os`; else the tenant's **TIER**, read from
   the `tenantProfiles` row via `internal.tenantProfile.forTenant` (`TIER_FRAMEWORK`:
   solopreneur→lean, startup→bmc, sme→swot, enterprise→swot); an explicit `framework` arg overrides.
   The row is read ONCE at the top of the handler, beside the carry-forward read.
5. **Diagnose** — `diagnose()` + `leverageRank()` over the filled scorecard → gaps (route/playbook),
   with a `diagnose` `ask` becoming a not-enough-data section, never a gap.
6. **Persist** — `insertEvaluation` writes ONE content-plane row (findings source-tagged
   vault|user-provided, each cited).
7. **Audit + step** — ONE `internal.audit.log` `evaluation.ran` (counts + framework/verdict enums
   ONLY) + an `"evaluateBusiness"` activity step (running→done/error).

### Blueprint standing context and the provenance ceiling

The Blueprint is consumed explicitly from `vaultGroundHydrated.spine`; it is never smuggled into the
retrieval arrays. `profileSeedDocs` remains authoritative and is moved to the front even when a
profile document was already a retrieval hit. This ordering is load-bearing because `fillVault`
keeps the first value and provenance it sees. The BLPR-02 evaluation test seeds profile
`CAC: $150`, a contradictory Blueprint `CAC: $999`, and an ordinary retrieval figure, then pins the
distinct citation order to profile → Blueprint → retrieval and keeps CAC attributed to the profile.

**Accepted provenance ceiling:** `FINANCIAL_PATTERNS` scans every chunk. A figure stated only in the
serialized Blueprint is therefore attributed to "Business blueprint", not to the source document
from which `mergeBlueprint` derived it. This is provenance quality, not value correctness: the
profile-first rule still protects the user's typed figure. Upgrade path: suppress numeric restatements
in the serialized spine.

## Invariants — what must never break

- **The rubric comes from the TABLE, never from the markdown (15.1-04, SC#2b)** — the framework
  auto-pick indexes `TIER_FRAMEWORK` with `tenantProfiles.tier`. The `- **Persona:**` line in a
  `business_profile` vault doc is a PROJECTION of that tier (design §4.2) and **selects no
  behaviour**: the surviving `text.includes("- **Persona:**")` block is a profile DETECTOR that
  fills CONTENT fields only (name / niche / avatar / offers). `deserializeProfile` still falls back
  to `"solopreneur"` on a garbled line — harmless precisely because nothing authoritative reads it.
  Reading a tier back out of the markdown re-creates defect 1d. `personaHint` no longer exists.
  Enforced by `evaluations.test.ts > "the framework auto-pick reads the tier table (SC#2b)"`, which
  drives ONE identical malformed document (`- **Persona:** wizard`) at two different table tiers and
  gets two different frameworks.
- **`financialsPresent` still overrides the tier (Q3, LOCKED)** — financials mean a `growth-os`
  diagnosis is actually POSSIBLE, so the override is correct and must not be removed. The tier's
  perceivable effect lands on voice / framing / the specialist prompt (ADR-009), which is
  unconditional — **SC#5 must NOT be read as "the rubric must change"**. Pinned by the "Q3 holds"
  test, which uses the same fixture plus labeled figures.
- **`TIER_FRAMEWORK` is exhaustive by compiler bind** — `as const satisfies Record<Tier, Framework>`,
  with no trailing `?? "lean"`. The index is narrowed to a `Tier` by `?? "solopreneur"`, so the
  lookup is TOTAL and a `??` would be a branch that can never be taken. Mutation-checked: deleting
  the `enterprise` entry raises `TS2741` at the map AND `TS7053` at the index site.
- **Refs-only audit (§4)** — `evaluation.ran` payload is `{ framework, verdict, findingCount,
  gapCount, groundedDocCount, userProvidedCount }` — counts + closed enums ONLY. Findings/citations
  are content-plane (the row), NEVER audited. Enforced by the structural assertion in
  `evaluations.test.ts` ("audit payload carries counts/enums ONLY").
- **`runEvaluation`'s framework arg is PINNED, not schema-derived (14-01)** — it lists the four
  business frameworks literally, even though `insertEvaluation` right beside it derives its
  validator from `evalFields`. This is deliberate and load-bearing; do NOT "simplify" it back to
  `evalFields.framework`. See the Phase-14 section below for why.
- **Two-tenant isolation (SC #5)** — `byThread`/`recordScorecardAnswer` are tenant-scoped
  (`ctx.tenantId` via the wrappers); `runEvaluation`/`lastForThread` filter by explicit `tenantId`
  on `by_tenant_thread`. Tenant B never reads tenant A's row. Enforced by the isolation test.
- **Vault-first, then ask, then store (LOCKED)** — the durable scorecard is UPDATED each run
  (carry-forward), not rebuilt from null; a user-provided figure survives forward and is cited
  "user-provided". Enforced by the carry-forward/anti-re-ask test.
- **No fabricated metrics (SC #1)** — a financial field fills ONLY from a direct labeled statement;
  no grounding → the field stays null → not-enough-data. With zero grounded findings the engine
  suppresses gaps (no basis for a prescription) and returns "insufficient". Enforced by the
  thin-data test + `diagnose`'s conservative unknown→ask (see `growth-diagnostic.md`).
- **Read-only REVIEW (two-shapes rule)** — the evaluate path (`runEvaluation`/`byThread`) never
  proposes or sends. `actOnGap` (12-05) is the ONE control that crosses into the plan gate, and it
  only STAGES: it writes a `proposed` plan and nothing else. Zero sends before the human Approve
  still holds — `executePlan` is still the sole gate and still the sole `workflow.start` site.
- **A memo is NEVER an email (12-05)** — a memo-plan carries `kind: "memo"` and no recipients, and
  `executePlan` branches to the persist terminal BEFORE the mailbox pre-check, so `startFanout` /
  `deliverApprovedPlan` / `gmail.send` are structurally unreachable from it (no `requests` row is
  ever seeded). Enforced by `gapAction.test.ts` (approve with NO `gmailTokens` row succeeds and
  leaves `requests` empty — an email plan would have refused `gmail_not_connected`).
- **One plans row per thread** — `plans.byThread` is a `.unique()` read, so `actOnGap` RECYCLES the
  thread's existing row (resetPlan → patchPlan) instead of inserting a second one. A row that is
  mid-flight or delivered (`approved`/`scheduled`/`delivering`/`done`) is refused (`plan_busy`) —
  staging a memo must never clobber an in-flight send.
- **The memo NAMES the specialist, it does not RUN it** — `gap.route` is written into the memo body
  as an instruction plus its `gap.playbook` citation. Specialist execution is Phase 15+; nothing
  here may invoke a specialist skill.
- **No fabricated content in the memo** — `buildMemo` is a deterministic template over the persisted
  row only (cited findings + the prescription's own `reason`/`proofMetric`). It is a document the
  user reads, NOT an agent prompt, so §5 does not apply — but it must never assert a figure the
  evaluation did not ground.
- **Fail open (SC1)** — any grounding/skill error yields an "insufficient" verdict, never a throw
  out of the governed loop. Enforced by the outer try/catch + the fail-open grounding branch.
- **Closed `agentSteps.tool` union** — `"evaluateBusiness"` must stay in the union (Pitfall 2).
- **The delta is computed IN the engine, never patched on (13-01)** — see below.

## "What changed" — the `evaluations.delta` field (13-01, BEVL-03)

`evaluations.delta` is an OPTIONAL row field:

```ts
delta?: { newFindings: number; gapsClosed: string[]; gapsOpened: string[] }
```

- **Optional ⇒ no migration.** Every pre-13-01 row simply carries none, and the review card hides
  the "what changed" line when it is absent.
- **Written only when the caller asks.** `runEvaluation` takes `withDelta: v.optional(v.boolean())`;
  an on-demand run (the cockpit `evaluateBusiness` tool) passes nothing and records no delta. Only
  the cron-driven weekly review asks for one, because only a recurring run has a meaningful
  "since last time".
- **Computed INSIDE `runEvaluation`, immediately before `insertEvaluation` — not patched on
  afterwards.** Two reasons, both binding: (1) the `evaluations` table is APPEND-ONLY and
  `insertEvaluation` is its single write surface, so a follow-up `ctx.db.patch` would break that
  invariant; (2) the engine already holds `last` (the carry-forward read), `findings` and `gaps` in
  ONE scope at that point, so the delta is pure arithmetic over values already in memory — zero
  extra reads, zero extra writes. A separate "compute the delta" query would re-read `lastForThread`
  for data the action is already holding.
- **Gap identity is `${route}/${playbook}`, not `route` alone.** `diagnose()` emits only THREE
  routes (`offer-architect`, `money-model-designer`, `lead-engine`) and several distinct
  prescriptions share each — a route-only key would report a real move (e.g. "No offer worth buying
  yet" → "Offer is a commodity", both `offer-architect`) as "no change". `playbook` is a code-owned
  string literal from `diagnose()`, never LLM prose, so keying on it is safe in a way that keying on
  the human-readable `label` would not be.
- **`newFindings` is clamped at 0.** A DROP in finding count is not "new findings"; the card only
  renders the line when it is > 0. The clamp is now a belt-and-braces guard rather than a
  workaround: since 13-02 a repeat run over unchanged documents re-cites the SAME paths, so an
  unchanged week produces `newFindings: 0` honestly, not by clamping a negative.
- Enforced by the four `delta`-named tests in `evaluations.test.ts`
  (`vitest run convex/evaluations.test.ts -t "delta"`).

## Proactive weekly review (BEVL-03, 13-02)

`packages/backend/convex/proactiveReview.ts` — three functions, no new tables, no new audit rows.

```
crons.weekly("proactive-review", monday 06:00 UTC)
  → internal.proactiveReview.runWeekly        (internalMutation, no args)
      enumerate vaultDocuments.by_kind == "business_profile", dedupe by tenantId
      → ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne, { tenantId })   per tenant
          → internal.evaluations.lastForThread({ tenantId, REVIEW_THREAD_ID })
          → internal.evaluations.runEvaluation({ …, framework: last?.framework, withDelta: true })
          → internal.proactiveReview.insertReviewNotification   ONLY if something changed
```

### Invariants

- **`REVIEW_THREAD_ID` is STABLE per tenant — never a per-week id.** `lastForThread` is indexed on
  `(tenantId, threadId)`, so a date-derived thread id would silently reset the Scorecard every week
  and re-ask figures the user already answered — it breaks the LOCKED store half. The repeat-run
  cost of a pinned thread (the provenance collapse) was CLOSED in the engine instead; see the
  `fillVault` citation rule below. Do not "fix" a future finding-count anomaly by rotating the id.
- **`fillVault` records a citation on EVERY restatement, but sets the value only when unset.** The
  two rules are separate on purpose. Provenance is not persisted on the row, so it must be rebuilt
  from the grounded corpus each run; if a carried value short-circuits before the citation is
  recorded, `findings` collapses toward zero, the engine then suppresses gaps (SC #1), and the delta
  reports a false `gapsClosed`. A pre-seeded `user-provided` citation always wins (first writer of
  the citation wins), so a carried user figure is never relabelled as a vault fact.
- **The notification is written by a DIRECT `ctx.db.insert("notifications", …)`, never through
  `notifications.notify`.** `notify` unconditionally schedules `internal.notifyExternal.dispatch`,
  which calls `freshAccessToken` → the Gmail refresh path. Proactivity must not be able to break on
  the Google 7-day testing-token expiry (SC#2). The same bypass `gmailAuth.flagExpiringTokens` uses.
- **`weekly_review` / `weekly_review_failed` stay OUT of `NOTIFICATION_KINDS`.** That absence is the
  second, independent barrier: `notifyExternal.dispatch` returns at `if (!KINDS.has(kind)) return;`
  BEFORE any token work. Adding them there would arm the mailbox for the review.
- **Every function takes an explicit validated `tenantId`.** A cron has no `ctx.auth`, so
  `tenantQuery`/`tenantMutation` are structurally uncallable; the `runEvaluation` /
  `recordScorecardAnswerInternal` internal-twin convention applies. `vaultDocuments.by_kind` is the
  ONE deliberate cross-tenant read in the module and it is consumed for tenant ids only.
- **No new audit eventType.** `evaluation.ran` already records the run; a `review.delivered` row
  would duplicate it. There is no `review.*` event anywhere in the phase.
- **Notify only on change.** First review ever, a moved verdict, or a non-empty delta. An idea-stage
  tenant gets ONE "not enough data" ping, then silence. The evaluation ROW is written every week
  regardless, so the card is always current — only the bell is conditional.
- **A failed review still tells the user.** The `catch` in `reviewOne` inserts
  `weekly_review_failed` with the static `REVIEW_FAILED_MESSAGE`; silence would be indistinguishable
  from a healthy quiet week. The failure REASON never reaches the notification plane (§4).

### How to change it safely

- Adding a review notification kind? Add the literal to `insertReviewNotification`'s `v.union` AND a
  static message constant in `packages/core/src/notificationTemplates.ts` — and keep it out of
  `NOTIFICATION_KINDS`. Never interpolate a reason or any grounded prose into `message`.
- Adding a second read to `runWeekly`? The SC#3 guard pins `by_kind` to exactly ONE occurrence; a
  new read must be `withIndex`'d on `tenantId` or the test fails.
- Changing the cadence? Only `crons.ts` changes. `crons.weekly` is used deliberately over
  `crons.cron` (see the comment there); `dayOfWeek` MUST be lowercase — the runtime validator
  rejects `"Monday"` and the JSDoc example is wrong.

### How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts` — 8/8: five
  behaviour cases (enumeration+dedupe, card+notification, notify-only-on-change, cross-tenant
  isolation, audit unchanged) and three static guards. Zero network: `rag.search` throws on the
  unset `OPENAI_API_KEY` and the engine fails open, while the tenant's own profile doc still enters
  the corpus through `internal.vault.profileSeedDocs` (a plain DB read).
- LOCKED manual procedure: *Convex dashboard → function runner → `proactiveReview:runWeekly` with
  `{}` → open `/dashboard/workspace`.*

## "Act on this" now RUNS the specialist (15-04, DISP-01)

12-05 shipped `actOnGap` as a deterministic memo that NAMED the target specialist and cited its
playbook. 15-04 closes that loop: the specialist actually runs, and the memo is what you get when
it cannot.

`actOnGap` is STILL a `tenantMutation`. It does not become a `tenantAction` — a Convex mutation
cannot call an action, and converting would make the plan-row recycle (`resetPlan` + `patchPlan`)
interruptible while leaving the card blank for the same 10-30s anyway. It stages the row and
schedules `internal.dispatch.runSpecialist`.

**Two terminals, chosen by `resolveSpecialist(gap.route)` at the entry point:**

| gap route | plan row after `actOnGap` | scheduled |
|---|---|---|
| a REGISTERED specialist | `status: "collecting"`, `kind: "memo"`, subject set, `body: ""` | one `runSpecialist` |
| anything else (`""`, `"scale"`, a pre-union route) | `status: "proposed"` with the `buildMemo` body — the 12-05 behaviour verbatim | nothing |

The runtime resolve is mandatory, not belt-and-braces: `gaps[].route` persists as `v.string()`
(`schema.ts:350`), so a stored route reaches here un-narrowed — including `diagnose()`'s deliberate
`""`. Resolving at the entry point puts the fail-closed guarantee in front of the scheduler as well
as inside the dispatcher.

### Invariants

- **The `collecting` staging IS the Approve-race mitigation. Do NOT "simplify" it back to
  `proposed`.** The failure it prevents: the user taps *Act on this*, a template body is instantly
  approvable, and they approve it at the exact surface where consent is irreversible — saving a
  template to the vault under a header that will shortly claim a specialist produced it. It costs
  nothing because `executePlan` already returns `alreadyStarted` for any non-`proposed` row
  (`cockpit.ts:530`) and `PlanCard` renders only at `proposed` (`cards.tsx:1624`) — so the race is
  closed BY CONSTRUCTION: no new guard, no new status literal, and zero `apps/web` edits. The
  CKPT-05 dispatch trace step is the progress indicator.
- **`rootRequestId` is minted fresh with `crypto.randomUUID()` and is NEVER derived from `planId`.**
  `plans.byThread` is a `.unique()` read and `actOnGap` RECYCLES the thread's one row (12-05), so a
  planId-derived lineage key would merge two dispatches into one unreconstructable tree. It is not
  `plans.correlationId` either — that is only written at `executePlan`, i.e. after Approve. ADR-008.
- **`landSpecialistResult` is the ONLY writer of a dispatched body**, and it no-ops unless the row
  is still `collecting`, still `kind: "memo"`, and under the SAME `tenantId`. It is an
  explicit-tenantId `internalMutation` (a scheduled action carries no live identity — the 12-04
  `recordScorecardAnswerInternal` precedent), so that tenant check is MANUAL and must not be
  deleted. It patches (never `resetPlan`, which would clear `kind: "memo"`).
- **Every outcome leaves `collecting`.** `dispatch.ts`'s `dispatchAndLand` lands in a `finally`, so
  success, a cost-ceilinged run, all four governed refusals and a thrown turn all end at an
  approvable row. A row stuck at `collecting` renders no card at all — the control would silently
  have done nothing.
- **`buildMemo` is now the FALLBACK, and its wording branches on `fallbackReason`.** With a reason
  it must NOT say *"That specialist does not execute yet"* — that sentence became false the moment
  dispatch shipped, and an approved memo may not tell the user something untrue. The reason is a
  CODE mapped through the code-owned `FALLBACK_SENTENCE`; the code itself never reaches the user.
- **The attribution line and the cost-ceiling marker ride the plan BODY** (`specialistMemoBody`,
  `@pikar/core`), never a new `plans.status` literal — see the cockpit playbook.

## A second stager, and a memo that stops lying (16-06, DISP-02)

> **Provenance, resolved.** This section was drafted by the **15.2 lane** off 16-06's then-uncommitted
> diff (concurrent GSD lanes share one checkout, so the §9 Stop hook blocks on another lane's work
> in progress; describing the diff was the honest resolution, since a one-line `Last verified` bump
> is only legitimate when playbook CONTENT is unaffected — and this changes a memo a user reads).
> **16-06's author has since read it against the shipped code and confirms it. No correction was
> needed.**

**`landSpecialistResult` gained an optional `fallbackBody`.** The no-evaluation-row branch used to
fall through to `LOST_CONTEXT_MEMO` unconditionally; it now consults the caller first, in exactly
one place and with exactly one `??`:

```ts
body = row && gap ? buildMemo(...) : (a.fallbackBody ?? LOST_CONTEXT_MEMO);
```

The reason is the same honesty rule that governs `buildMemo`'s wording (above): `LOST_CONTEXT_MEMO`
says *"the evaluation it was based on is no longer on file"*, and **that sentence is FALSE for a
research run** — a research run was never based on an evaluation, so there is nothing to have lost.
The gap path (`runSpecialist`) passes nothing and stays byte-identical; only the research dispatch
supplies a body. Same invariant as `FALLBACK_SENTENCE`: an approved memo may not tell the user
something untrue.

**`plans.stageResearchPlan` is a deliberate near-copy of `applyActOnGap`'s staging block.** Same
`insertPlan`/`resetPlan`/`patchPlan` spine and the same `collecting` handoff, with a NARROWER
recycle rule:

| row | `applyActOnGap` | `stageResearchPlan` |
|---|---|---|
| `collecting` + `kind: "memo"` | recycles it | **refuses** — `research_in_flight` |
| carries user draft content (recipients/subject/body/bodyIntent/attachments) | may reset (the USER tapped) | **refuses** — `draft_in_progress` |
| empty `collecting` row (fresh thread) | recycles | recycles |
| past `proposed` (approved → done) | never | never |

Two things in that table are load-bearing. **`kind === "memo"` is not decoration:** `cockpit.ts`
inserts every thread's plan row at `collecting` on the first turn and it stays there for the whole
composition, so a bare `status === "collecting"` refusal would refuse research on essentially every
live conversation. A `collecting` row is only "owned by a dispatch" when a dispatch staged it, and
`kind: "memo"` is what records that. And the `draft_in_progress` refusal exists because **`actOnGap`
resets on a USER tap while this stager is driven by the MODEL** — destroying a half-composed email
because someone asked a research question is not a trade the user agreed to.

The persisted `research_in_flight` interlock is also what makes a per-turn envelope closure
unnecessary: one run per thread, one freshly derived root envelope, holding across turns, requests,
and a fallback retry that rebuilds the tool record.

**The two stagers are NOT shared on purpose.** The rules disagree, so a shared helper would need the
rule as a parameter — a knob for two callers that disagree is the abstraction CLAUDE.md §8 forbids.
They are cross-referenced in both directions instead. **Change one and decide CONSCIOUSLY whether
the other moves.**

### How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts convex/gapAction.test.ts`
  — 23/23. `evaluations.test.ts` owns the dispatch assertions (staging, the queued args, the fresh
  `rootRequestId`, both non-specialist terminals, and the end-to-end
  gap → collecting → run → proposed → approve → ONE vault doc → ZERO `requests` rows).
  `gapAction.test.ts` characterizes the no-specialist terminal.
- The end-to-end test drives the queued job through `internal.dispatch.__runSpecialistWithScript`
  after CANCELLING it. Do not replace that with `t.finishAllScheduledFunctions()`: the production
  `runSpecialist` resolves a real gateway model, and convex-test flushes due scheduled work in the
  background — an uncancelled job makes the suite depend on whether `OPENAI_API_KEY` is set.

## How to change safely

- **Add a grounded scorecard field / finding** — add the dot-path to `TRACKED` (label + section) and,
  for a financial, a `FINANCIAL_PATTERNS` entry; keep the extraction DIRECT-statement-only (no
  inference that could fabricate). Re-run `evaluations.test.ts`.
- **Change the audit payload** — it must stay counts/enums-only; update the structural assertion's
  key set in lockstep. A prose field here is a §4 regression.
- **Add a framework** — add the literal to the schema `framework` union + `FRAMEWORK_SKILL` +
  (if it is some tier's default) `TIER_FRAMEWORK`; ensure the rubric skill is seeded/gated (12-02).
- **Add a TIER** — widen `TIERS` in `@pikar/core` and `tenantProfiles.tier` in `schema.ts`, then
  fix the compile error `TIER_FRAMEWORK` raises. That error is the feature: do NOT silence it with a
  `??` default, which would silently classify the new tier as `lean`. See `onboarding.md` for the
  tier control plane itself.
- **Schema change on `evaluations`** — append-only (no migration); update the derived `evalFields`
  consumers only if you add a field. Never make the row mutable except via the two write surfaces.
- **Change what a memo says** — edit `buildMemo` only. It reads the persisted row; if you need a
  new fact in the body, persist it on the gap (optional field) at diagnose time rather than
  re-deriving it at act time (two derivations drift).
- **Change what Approve does for a memo** — edit `persistNextStepMemo` + the `plan.kind === "memo"`
  branch in `cockpit.executePlan`. Do NOT route a memo through `deliverApprovedPlan`: that workflow
  fans out `gmail.send` per recipient and a memo has none. A future non-email terminal (ACTN-01,
  Phase 15) generalizes this branch — it does not widen the gmail one.

## How to verify

- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts` — all six cases
  (grounded cited row, store path, refs-only audit, carry-forward, isolation, thin-data). ~8s, no
  deployment.
- `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts -t "framework auto-pick reads the tier table"` —
  the SC#2b set: the malformed-doc regression, the two-tiers-one-markdown authority proof, the
  no-row fallback, and the Q3 override. Plus the structural check that the authority is really gone:
  `grep -n "personaHint" packages/backend/convex/evaluations.ts` must print NOTHING.
- `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` — the four BEVL-02 cases
  (proposed memo transition, nothing-to-act-on, memo-persisted-not-emailed, double-approve
  idempotence). Needs the `workflow` + `workflow/workpool` components registered (the memo terminal
  ingests through `startIngest`) alongside `auditCounts`.
- `pnpm --filter @pikar/backend typecheck` — the engine source is type-clean (pre-existing
  test-file typecheck failures are tracked in the phase `deferred-items.md`).
- `node scripts/check-playbooks.mjs` — this playbook covers `packages/backend/convex/evaluations.ts`.

## Operational notes

- No new env vars/seeds. The framework rubric skills must be seeded (`seedSkills`) for a real run;
  a missing/inactive method fails open to "insufficient".
- The grounding `query` is an EXPLICIT arg — the cockpit `evaluateBusiness` tool (llm.ts, 12-04)
  calls `runEvaluation` with an explicit tenantId; tests pass a `SMOKE::<docId>` sentinel to ground
  offline. Absent → the `DEFAULT_QUERY` (hits `rag.search`).
- The cockpit `recordScorecardAnswer` tool routes through `recordScorecardAnswerInternal` (explicit
  tenantId) and emits its OWN refs-only `evaluation.answered` audit (field name + value fingerprint)
  from llm.ts — the internal mutation itself stays audit-silent (one audit per tool call, in the tool).

## Known gaps & deferred work

- **Deterministic extraction only** — v1 fills the scorecard by profile-parse + direct labeled-number
  scan; the rich per-quadrant LLM-narrated findings ride the live model, taught via a `cockpit-agent`
  body change through the eval gate (later plan). `ponytail:` upgrade path = thread the rubric body
  into an LLM parse when the card needs prose findings.
- **The memo is the stand-in for the fix, not the fix** (12-05) — approving it saves a next-step
  memo; it does not build the offer or run the campaign. Specialist EXECUTION is Phase 15+.
- **Acting on a gap recycles the thread's plan row** — so a thread that already delivered an email
  (`status: "done"`) refuses `actOnGap` with `plan_busy`; the user starts a new chat. `ponytail:`
  upgrade path = a plan row per artifact (drop the one-row-per-thread `.unique()`) if threads ever
  need to hold an email AND a memo at once.
- **The vault doc is the whole terminal** — there is no memo index/list surface; a `next_step_memo`
  is browsable at `/dashboard/vault` like any other doc and groundable via `startIngest`.
- **Market-fact grounding is out of scope** — vault-grounded findings only until web research
  (Phase 16); `marketViable` is a supplied signal, not verified.
- **Specialist EXECUTION deferred (15+)** — a gap's `route` names the target specialist skill; it is
  not run here.

## Sharing the `evaluations` table with voice-doc (Phase 14, DOCV-01)

Phase 14's voice-doc review persists into the SAME `evaluations` table this engine owns, so the
post-call surface can reuse the existing `byThread` read and `EvaluationCard`. The table is shared;
**the engine is not**. Keep that line clean.

### What Phase 14 added to the table

- `framework` gained a fifth literal, `"document-review"`. It is human-readable on purpose:
  `buildMemo` prints `Diagnosed on the **${row.framework}** framework` as user-visible prose inside
  an approvable memo, so a slug like `docrev` would leak into the product.
- `findings[]` gained `citationExcerpt: v.optional(v.string())` — a capped, substring-verified quoted
  passage. Optional is load-bearing: an absent excerpt is a VALID, non-degraded state, never an empty
  string. Business evaluations simply never set it, and every pre-Phase-14 row is untouched
  (additive + optional ⇒ no migration).
- `voiceSessions.docRef` — not this playbook's table, but it is what scopes a session to one report.

### The invariant: a doc-review row never enters this engine

A voice-doc row is written STRAIGHT through `insertEvaluation` by `voiceDoc.ts`. It never goes
through `runEvaluation`: there is no `document-review` rubric skill, no `FRAMEWORK_SKILL` entry, and
no `diagnose()` path for it. Two mechanisms hold that, and they are not redundant:

1. **`FRAMEWORK_SKILL` has no `document-review` key** (the original design). An unmapped literal
   cannot load a rubric.
2. **`runEvaluation`'s `framework` arg is explicitly PINNED** to `swot | lean | bmc | growth-os`
   (14-01). This is the stronger of the two — it refuses a doc-review row at the **validator
   boundary**, before any handler code runs.

Why the pin exists at all: `const evalFields = schema.tables.evaluations.validator.fields` feeds
**two** signatures. `insertEvaluation` (the write surface) SHOULD widen for free when the schema
widens — that is exactly how a voice-doc row gets persisted with no edit here. `runEvaluation` (the
engine entrypoint) must NOT. Before the pin, widening the schema silently widened the engine's
public input type and broke `const chosen: Framework` at the type level. Phase 14's research
predicted "zero edits to `evaluations.ts`" on the assumption that `evalFields.framework` fed only
`insertEvaluation`; that assumption was wrong, and the pin is the correction (user-approved
2026-07-25, recorded as an authorized Lane-C exception in `.planning/PARALLELIZATION.md`).

**If you widen `evaluations.framework` again, check every signature that derives from `evalFields`,
not just the one you intended to widen.**

`proactiveReview.ts` carries the same rule at the call site: `reviewOne` carries last week's
framework forward, so it explicitly drops a `document-review` value and falls back to auto-pick
rather than throwing. A doc-review row cannot reach `REVIEW_THREAD_ID` today (voice-doc rows live on
synthetic `voice-doc:<sessionId>` threads), so that is a type-level guard, not a live branch — but
the weekly review must never fail on a framework it can simply re-derive.

### The excerpt is content-plane, and strictly so (§4)

`citationExcerpt` is the only verbatim report content Phase 14 persists. It is LEGAL in
`evaluations.findings[]`, in a memo body, and on the post-call card. It is ILLEGAL in every `audit` /
`deadLetters` / `telemetry` `payload:` and in every `agentSteps` row. There is no third state: code
that needs to log "which finding" logs an index or a count, never the quote. This is the same
content-plane/log-plane split the `evaluation.ran` audit already obeys (counts + closed enums only),
extended to the one new field that could break it. Plan 14-09 pins it with a mutation-verified static
scan.

See `voice.md` § "Voice-doc sessions (Phase 14)" for the voice half.
