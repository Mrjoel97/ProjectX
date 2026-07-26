# Playbook: Business Evaluation Engine

> Last verified: 2026-07-25 (5) — 14-01 (Phase-14 Wave-0 freeze, Lane C): the `evaluations` TABLE is now shared with the voice-doc flow, but this ENGINE is not. `evaluations.framework` gained a fifth literal `"document-review"`, `findings[]` gained an optional `citationExcerpt`, and a doc-review row is written STRAIGHT through `insertEvaluation` by `voiceDoc.ts` — it never enters `runEvaluation`, has no rubric skill and no `diagnose()` path. **The load-bearing consequence: `runEvaluation`'s `framework` arg is now explicitly PINNED to the four business frameworks instead of being derived from `evalFields`.** See the new **"Sharing the evaluations table with voice-doc (Phase 14)"** section below. Zero behavior change for every existing business-evaluation caller; `evaluations.test.ts` and `proactiveReview.test.ts` unchanged and green, backend 497/498 (sole red the pre-existing `audit.test.ts auditCounts`).

> Last verified: 2026-07-25 (4) — 13-02: the **proactive weekly review** (`proactiveReview.ts`, BEVL-03) — a Monday-06:00-UTC cron enumerates onboarded tenants over `vaultDocuments.by_kind`, fans out one `reviewOne` per tenant, runs this engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, and writes an in-app notification only when something changed. See the **Proactive weekly review** section below. **The repeat-run provenance collapse recorded in the previous line is now CLOSED** — it had to be, because a weekly review is by design a repeat run on one pinned thread. `fillVault` now records a CITATION whenever a grounded document restates a field, even when the slot is already filled by carry-forward (the VALUE stays first-write-wins, and a pre-seeded `user-provided` citation is never downgraded); the two "already set → skip" short-circuits above it (the `currentOffers.length === 0` pre-check and the `FINANCIAL_PATTERNS` `continue`) are gone for the same reason. Regression-guarded by `proactiveReview.test.ts > notifies only on change`, which asserts run 2 has the SAME finding count as run 1 and an empty delta — that test was CONFIRMED red before the fix (a second `weekly_review` notification fired off a false "gaps closed"). `proactiveReview.test.ts` 8/8, `evaluations.test.ts` 11/11 unchanged, backend 494/495 (sole red the pre-existing `audit.test.ts auditCounts`). Prior: 2026-07-25 (3) — 13-01: the optional `evaluations.delta` "what changed" field (BEVL-03 groundwork for the weekly proactive review). See the **"What changed" delta** section below. No behavior change for any existing caller: `withDelta` is opt-in, absent ⇒ no `delta` is written, and the two pre-existing callers (`llm.ts`'s `evaluateBusiness` tool, the tests) pass it nowhere. `evaluations.test.ts` 11/11 (4 new delta tests, all confirmed RED before the engine change). Prior: 2026-07-25 (2) — TWO owner-reported grounding defects fixed; both made a real business assess as "not enough data". **(1) A reference PDF monopolised the corpus.** `rag.search` takes its top-K by CHUNK (`limit: 8`), and `seedDocIds` dedupes only afterwards — so one large book filled every slot and grounding returned exactly ONE doc. Measured live: with the engine's own `DEFAULT_QUERY` the tenant's grounding came back as a single 300-page marketing PDF, the user's own profile never entered the corpus, `findingCount` was 0, and the framework fell back to the persona map (`swot`) because no financials were found. Similarity alone cannot answer "evaluate MY business" — a book ABOUT business outranks a short description OF one on generic business vocabulary. FIX: `runEvaluation` now PREPENDS the tenant's own profile-shaped docs from the new `internal.vault.profileSeedDocs` before the retrieval result. Prepending is load-bearing — `fillVault` keeps the FIRST value per path, so the user's own figures beat book prose. Fail-open: a seed-query failure leaves retrieval-only grounding intact. The shared `vaultGround` is deliberately UNTOUCHED (it also serves `searchVault` + golden fixtures 25/26 — changing it would risk eval-gate churn). **(2) `fillVault` could never fill `identity.currentOffers`.** `emptyScorecard.identity.currentOffers` is `[]`, not null, so the `!= null` guard skipped it forever; `hasOffer` stayed false and `diagnose()` returned Gate 1 ("No offer worth buying yet") on EVERY vault-grounded run, masking the true constraint further down the ladder. The caller's own `.length === 0` check shows the intent. FIX: an empty array now counts as unset. Verified live on the owner's deployment, fresh thread: framework `growth-os`, **8 cited findings** (incl. the previously-impossible `Offer:`), gap = `"Customer doesn't pay for themselves in 30 days."` → `money-model-designer` — exactly the Gate-2 constraint the fixture's economics were built to produce (30-day cash 90 < CAC 180). `evaluations.test.ts` 7/7 with a new regression test that was CONFIRMED to fail against the old guard (`expected [] to have a length of 1`); full backend 479/480 with only the pre-existing `audit.test.ts` red. KNOWN GAP (not fixed, logged): re-running an evaluation in the SAME thread collapses `findingCount` (8 → 1) — carry-forward preserves the scorecard VALUES but not their provenance, so only freshly-filled paths are re-cited. Evaluate in a fresh thread until this is closed. Prior: 2026-07-25 against 12-05 (the gap-action + memo terminal — the ACTING side, BEVL-02)
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
2. **Ground** — `vaultGroundHydrated` returns `{ docIds, titles, chunks }` (parallel arrays). Fail
   open on any error (the carried values still stand).
3. **Fill** — parse a grounded business-profile chunk (`deserializeProfile`) into identity fields
   and scan for direct labeled figures (`CAC: $150`) into financials; each fill records its source
   doc as provenance. A user-provided carried field is provenance "user-provided". A field still
   null → stays null (not-enough-data), never guessed. **Value vs citation are separate rules**
   (13-02): the VALUE is first-write-wins (carried/user-provided/earlier-doc beats a later doc), but
   the CITATION is (re)recorded whenever a document restates the field, so a repeat run over the
   same corpus cites the same things instead of collapsing to zero findings.
4. **Auto-pick framework** — financials present → `growth-os`; else persona map
   (solopreneur→lean, startup→bmc, sme→swot); an explicit `framework` arg overrides.
5. **Diagnose** — `diagnose()` + `leverageRank()` over the filled scorecard → gaps (route/playbook),
   with a `diagnose` `ask` becoming a not-enough-data section, never a gap.
6. **Persist** — `insertEvaluation` writes ONE content-plane row (findings source-tagged
   vault|user-provided, each cited).
7. **Audit + step** — ONE `internal.audit.log` `evaluation.ran` (counts + framework/verdict enums
   ONLY) + an `"evaluateBusiness"` activity step (running→done/error).

## Invariants — what must never break

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

## How to change safely

- **Add a grounded scorecard field / finding** — add the dot-path to `TRACKED` (label + section) and,
  for a financial, a `FINANCIAL_PATTERNS` entry; keep the extraction DIRECT-statement-only (no
  inference that could fabricate). Re-run `evaluations.test.ts`.
- **Change the audit payload** — it must stay counts/enums-only; update the structural assertion's
  key set in lockstep. A prose field here is a §4 regression.
- **Add a framework** — add the literal to the schema `framework` union + `FRAMEWORK_SKILL` +
  (if a persona default) `PERSONA_FRAMEWORK`; ensure the rubric skill is seeded/gated (12-02).
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
