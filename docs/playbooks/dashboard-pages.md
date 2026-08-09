# Playbook: Connected dashboard pages

> Last verified: 2026-08-09 (Plan cash-business-finance Task 4 REVIEW FIX — staleness collapsed to
> ONE predicate, `needsConfirmation(value, statedAt, nowMs)`; the two-argument `isStale` is deleted.
> `statedFigure` had re-derived staleness on its own and reached `stale: false` for an unknown-age
> value, disagreeing with `convex/cash.ts`'s already-correct adapter logic. See the "Cash — the
> suppression rule" section below.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 4 — `statedFigure`/`requireInputs`/`valueOf`
> resolve the four truths, provenance and the suppression rule ONCE, in `cash.ts`.)
>
> Prior: 2026-08-09 (Plan cash-business-finance Task 3 REVIEW FIX — scorecard-field staleness now
> reads `evaluations.userProvidedAt`, never the row's `createdAt`. See the Cash section's staleness
> bullet below and `docs/playbooks/business-evaluation.md` for the write side.)
> Build history: `.planning/phases/26-pending-product-pages-and-vault-redesign-integration/` · Related ADRs: [ADR-001](../decisions/001-convex-data-orchestration-plane.md)

## Purpose

This playbook protects the Approvals, Finance, Content, Reports, Phase-19 Pipeline integration and
Command Center v2 surfaces. These pages are projections over existing governed rails, not a second
data plane: each page must preserve tenant isolation, bounded reads, honest uncertainty and the
original action's approval boundary. A page can be rolled back independently without removing its
additive data, safety instrumentation or provenance.

## Key files

### Pure contracts

- `packages/core/src/dashboard.ts` — `resolveDashboardWindow`, `DashboardMoney`, bounded-result,
  stable-order/cursor and code-owned page-state contracts shared before JSX formatting.
- `packages/core/src/spend.ts` — closed rail/phase vocabulary, movement validation at the trust
  boundary, and window aggregation that returns Unknown rather than a fabricated zero.

### Backend page adapters

- `packages/backend/convex/approvals.ts` — bounded plan/decision projections.
- `packages/backend/convex/spendLedger.ts` — append-only reporting movements and coverage start.
- `packages/backend/convex/finance.ts` — tenant and owner finance projections.
- `packages/backend/convex/content.ts` — bounded artifact union and governed artifact actions.
- `packages/backend/convex/reportsBusiness.ts` — comparable business/operations period projections.
- `packages/backend/convex/reportsGovernance.ts` — sanitized audit and owner-only governance views.
- `packages/backend/convex/reportPack.ts` — one-snapshot board-pack generation.
- `packages/backend/convex/home.ts` — narrow source-summary composition for Command Center.

Every module has a colocated `.test.ts`; `dashboardSchema.test.ts` protects the additive schema and
index foundation. Existing action terminals remain owned by their subsystem playbooks.

### Cash — business finance

`packages/core/src/cash.ts` / `packages/backend/convex/cash.ts` are the Business tab's own pure/
adapter split, mirroring the Cost console's `spend.ts`/`finance.ts` pair so one mental model serves
both halves of the page:

- **`cash.ts` (pure) owns the `CashFigure` vocabulary and the activity derivation.** Every business
  figure is exactly one of FOUR states, never collapsed into three: `unknown` (never asked/answered,
  names the missing input), `not-applicable` (the metric does not exist for this business — decided
  by tier/stage, NEVER inferred from absent data, so a project-based consultant is never shown a
  fabricated "$0 MRR"), `not-computable` (inputs are present but make the arithmetic undefined, e.g.
  CAC = 0 — deliberately not folded into `unknown`, because "needs your CAC" is a lie to someone who
  told us it was zero), and `known` (a real number, including a real measured zero). `activityFromSends`
  buckets delivered sends into UTC days and derives `todayCount`, `streakDays` and `last7Count`; the
  streak ENDS TODAY by definition — a streak that keeps counting yesterday's run for someone who has
  not sent today is the flattering lie the row exists to avoid. **`last7Count` (today plus the six
  preceding UTC days) is computed HERE, in the pure module, never in `CashView.tsx`.** A Task-2
  review caught the first version summing `perDay.slice(0, 7)` inside `ActivitySection` itself —
  domain arithmetic, not formatting, breaching CLAUDE.md §1's "the view renders, it never derives."
  The view now reads `activity.last7Count` as a plain field.
- **`convex/cash.ts` (adapter) is a reader only.** `activity` is a `tenantQuery` that scans `requests`
  rows in status `sent` through `by_tenant_status_createdAt`, bounded at 1000 rows with
  `bound.partial` + `partialReason: "row-cap"` when the cap is hit — the same `readWindow` honesty
  contract `finance.ts` uses, so a capped count reads as a floor, never the truth.
- **The activity row is free.** Pikar already delivers the emails, so a `sent` request row IS the
  reach-out count — the row needs no data entry and is the first thing rendered on the Business tab.
  "Posts per day" has no data source yet (Pikar delivers email, not social posts) and renders an
  explicit "not tracked yet", never a fabricated `0`.

### Cash — the collection surface and `financeInputs` (Task 3)

**The storage split, and why it is not a duplication.** Two stores hold the Business tab's numbers,
split by WHICH kind of figure they are, never by which screen wrote them:

- **The scorecard (`evaluations.scorecard`, `packages/core/src/growth/scorecard.ts`) stays the
  source of truth for every Hormozi input** — `financials.cac`, `financials.ltgp`,
  `financials.thirtyDayCashPerCustomer`, `financials.grossMarginPct`, `financials.churnByCadence`,
  and the four leaves Task 3 added (`financials.grossProfitPerPurchase`,
  `financials.purchasesPerLifetime`, `financials.customerCount`, `leadCard.referralPct` — see
  `docs/playbooks/growth-diagnostic.md`).
- **The new `financeInputs` table (`packages/backend/convex/schema.ts`) holds the five finance-ops
  inputs ONLY**: `cashOnHand`, `monthlyOperatingCost`, `mrr`, `receivables`, `payables`. One row per
  `(tenantId, field)`, read through `by_tenant`/`by_tenant_field`. **CAC is never copied into this
  table.** Duplicating it into a second store is what produced two separate selector bugs on
  2026-08-09 — the whole reason this split is a rule and not a convenience.
- **`packages/core/src/cash.ts`'s `CASH_INPUTS: readonly CashInputSpec[]`** is the single catalogue
  both stores are read through: eleven entries, each naming its `field`, which `store` owns its
  VALUE (`"financeInputs" | "scorecard"`), the Scorecard dot-`path` for the scorecard ones, its
  `unit`, and `unlocks` — what answering it buys the user, asserted non-empty so a field with no
  payoff can never be asked for. `cashInputsForTier(tier)` filters it to what a tier is actually
  asked; `validateCashInput(field, value)` is the trust-boundary check (money ≥ 0/finite, a percent
  ≤ 100, a count a whole number, and `purchasesPerLifetime < 1` REJECTED rather than silently
  multiplied into a plausible-looking wrong LTGP). `STALE_AFTER_MS` (90 days) + `needsConfirmation`
  (Task 4 — see the "Cash — the suppression rule" section below) are the confirm-or-update
  threshold.
  **Staleness reads a per-FIELD stated time, never the evaluation row's `createdAt` (review fix).**
  A finance-ops field's `statedAt` is its own `financeInputs` row's `statedAt`, always present
  alongside a value. A scorecard field's `statedAt` is read from `evaluations.userProvidedAt[path]`
  — a dot-path → epoch-ms map stamped by `applyScorecardAnswer` on every answer and carried forward
  UNCHANGED by `runEvaluation` (see `docs/playbooks/business-evaluation.md`). **The row's own
  `createdAt` was tried first and was wrong**: `runEvaluation` re-runs weekly on one pinned thread
  and persists a fresh row every time, stamping a NEW `createdAt` while copying `scorecard`/
  `userProvided` verbatim — so a CAC answered 91 days ago, merely carried into this week's row, read
  back as "confirmed today" and silently suppressed the exact 90-day prompt the rule exists for. A
  legacy value with no `userProvidedAt` entry (every scorecard-stored figure written before this fix)
  has UNKNOWN age; `cash.ts` treats that as needing confirmation — `stale: true`, `statedAt: null` —
  never as fresh, and never fabricates a date. `CashView.tsx`'s `InputRow` renders this case as "No
  confirmation date on file. Still right? Confirm or update it." rather than formatting a null date.
- **One mutation, `convex/cash.ts`'s `saveInput`, routes by field to the store that owns it — there
  is exactly one writer per number.** A finance-ops field patches/inserts its `financeInputs` row. A
  scorecard field calls `applyScorecardAnswer` (`convex/evaluations.ts`, exported in this task) —
  the SAME function `recordScorecardAnswer` (the cockpit path) and `approvals.answerDecision` (the
  Approvals path) call, so a number entered in the panel, spoken to the cockpit, or answered in
  Approvals lands in the same place and carries forward the same way. No evaluation row yet → seeded
  under the stable thread id `"finance-panel"` so the answer survives into the tenant's first real
  evaluation. `cash.ts`'s `inputs` query reads both stores back through the one `CASH_INPUTS`
  catalogue and returns `CashInputState[]` (`field`, `value`, `statedAt`, `stale`) — nothing is
  logged (CLAUDE.md §4); if an audit event is ever added here it carries the field NAME and a
  boolean, never the value.
- **Approvals' `QUESTION_CATALOG` gained the same three new numeric entries** (`financials.
  grossProfitPerPurchase`, `financials.purchasesPerLifetime`, `financials.customerCount`) so a
  tenant who answers in Approvals and a tenant who answers in the panel fill the same set — a
  catalogue entry that only one surface could see is how a field ships unwritable. Its numeric
  bounds check now routes through `validateCashInput` for every field the two surfaces share (via a
  path→`CashInputField` lookup built off `CASH_INPUTS` itself), so `purchasesPerLifetime: 0.5` is
  refused in Approvals with the SAME reason and the same words as in the panel. `financials.ltgp`
  keeps its own finite/non-negative check — it is never a cash input (see the growth-diagnostic
  playbook's precedence note) and carries no `CashInputField`. `leadCard.referralPct` is
  deliberately NOT in the catalogue: `hasFinancialQuestion` gates it on a `financials`-section
  `notEnoughData` entry, and a lead metric behind a financial gate would be a category error — it
  stays a panel-and-cockpit-only input.
- **`CashView.tsx`'s `NumbersPanel`** renders `cashInputsForTier(tier)` INTERSECTED with the
  `inputs` prop — the tier decides which fields are asked at all, and a field with no matching entry
  in `inputs` is skipped rather than invented. Each row is a real `<label htmlFor>` + `<input id>`
  pair, a Save button with an explicit `aria-label`, and a provenance line: `Unlocks <what>` when
  never answered (never a fabricated `$0`), `Last confirmed <date>` otherwise, with a
  confirm-or-update prompt appended once stale. **The stale prompt uses `--ink-soft` and the
  explicit word "confirm"** — BRAND §2/CLAUDE.md §10 reserve amber (`--held`) for the approval gate
  only. Validated on change with the same `validateCashInput` the mutation enforces (Save disables
  on an invalid draft, the reason renders in a `role="alert"`) — this is convenience, not the trust
  boundary, which stays server-side. `ConnectedNumbers` reads `api.cash.inputs` + `api.tenantProfile
  .get` (for `tier`, defaulting to `"solopreneur"` while loading/absent) and wires `api.cash.
  saveInput` through the same busy/refusal `run`-style pattern as `OperatorTab` in `FinanceView.tsx`.
  No arithmetic lives in this component beyond formatting (CLAUDE.md §1) — a `.reduce()` in a
  component already failed review once on this plan.

### Cash — the suppression rule (Task 4)

**Every later task (5, 6, 7, 9) routes derived figures through these four functions instead of
reimplementing the unknown-check per metric.**

- **`CashInputs = Partial<Record<CashInputField, CashInputState>>`** and **`toCashInputs(states)`**
  turn the `CashInputState[]` the `inputs` query already returns into the keyed shape the rest of
  this section reads. No new store, no new query — a reshape of what Task 3 produces.
- **`statedFigure(input, spec, nowMs)`** turns ONE stated input into a `CashFigure`. `undefined` or
  `value: null` → `unknown`, naming the field's `label`. **A real `0` is `known`, never `unknown`** —
  measured nothing is an answer, and this is the single most important behaviour in the module: a
  metric that reads "unknown" for a business that genuinely spent $0 on acquisition is lying in the
  opposite direction from a fabricated number. `statedAt: null` (legacy scorecard value, no
  `userProvidedAt` entry — see the Task 3 staleness bullet above) carries through as UNKNOWN age;
  `statedFigure` does not paper over that by inventing a date.
  **`needsConfirmation(value, statedAt, nowMs)` is THE single staleness rule (review fix).** The
  first version of `statedFigure` re-derived staleness from the old two-argument `isStale(statedAt,
  nowMs)` alone, which short-circuits to `false` for `statedAt: null` — so a legacy value with no
  recorded age rendered `stale: false`, "confirmed," and its confirm-or-update prompt never fired.
  `isStale` is DELETED (no other caller needed the raw two-argument form). `needsConfirmation` folds
  in the value: absent (`value === null`) is never stale — that is `unknown`, a different truth
  entirely; a present value with `statedAt: null` (unknown age) or older than `STALE_AFTER_MS` is
  stale. `statedFigure` **and** `convex/cash.ts`'s `inputs` query — both its `financeInputs` branch
  and its scorecard branch — all call this ONE function; none re-derives the rule. Before this fix,
  `cash.ts` and `convex/cash.ts` disagreed (the adapter's scorecard branch already had the correct
  three-way check inline, pinned by its own test since Task 3 — see `convex/cash.test.ts`'s "a
  scorecard value with no recorded stated time... needs confirmation" — while `cash.ts` had the
  simpler, wrong one), which is exactly the two-definitions drift CLAUDE.md §1 exists to prevent.
- **`derived(args)`** wraps an already-computed number as a `known`/`derived` figure with its `from`
  provenance string and optional `sampleSize` — it does no arithmetic itself (that stays in
  `growth/financialSpine.ts`), it only carries the figure vocabulary the view renders.
- **`requireInputs(inputs, fields)` is THE suppression rule, in exactly one place.** Returns the
  blocking `unknown` figure for the FIRST missing field, or `null` once every field in the list is
  present. **The first, not all of them** — a metric that answers a missing-CAC prompt with a
  three-item checklist gets ignored; naming one input is one ask. A caller computing a derived metric
  (CFA, LTGP:CAC, runway, …) calls `requireInputs` first and renders its result verbatim instead of
  the computed figure when it is non-null.
- **`valueOf(inputs, field)`** reads a present input's plain number, for use only after
  `requireInputs` has returned `null` for a field list containing `field`. It throws if the field is
  still absent — a programming-error tripwire, never a runtime path reachable from user input, and
  deliberately NOT softened to `?? 0`: that would fabricate a figure and defeat the suppression rule
  above it.

### Frontend and connected browser evidence

- `apps/web/app/(app)/dashboard/{approvals,finance,content,reports}/` — page routes and state views.
- `apps/web/app/(app)/dashboard/{page.tsx,CommandCenter.tsx}` — Command Center v2 and legacy fallback.
- `apps/web/app/(app)/layout.tsx` — serialized page-by-page navigation activation.
- `apps/web/e2e/{approvals,finance,content,reports,pipeline,command-center}.spec.ts` — authenticated
  browser gates. These exact specs are also inside `cockpit.md`'s broad E2E watch, so route plans
  update both playbooks; this entry does not take ownership of unrelated cockpit specs.

## Dependencies & blast radius

`graphify query "Phase 26 shared dashboard primitives packages core index exports tests playbook
watch ownership"` shows the page adapters feeding the app shell while action terminals remain in
Cockpit, Vault, Media, Guardrails, Audit/WORM and Phase 19. Runtime couplings the graph cannot prove:

- Public tenant reads/writes must use `tenantQuery`/`tenantMutation`; deployment-global facts and
  controls must use the owner wrappers and `requireOwner`.
- Convex indexes and optional legacy fields land before page readers. No Phase 26 rollback narrows
  schema, deletes coverage/provenance or invents a historical backfill.
- Storage and attachment URLs are short-lived capabilities minted only after a fresh ownership
  check. They are never persisted in page rows, audit payloads or logs.
- The Finance limiter is enforcement truth; `spendEvents` is reporting/reconciliation truth. UI
  rollback must not stop ledger instrumentation or it creates an irreparable history hole.
- Pipeline data and send safety belong to Phase 19 (`ACTN-05`, `PIPE-01`). Phase 26 consumes its
  bounded summary only after that external gate; it does not add opportunities, stages or value.
- Command Center composes source summaries. It must not reread raw tables or turn one failed source
  into a healthy/zero result.

## Data flow

1. The browser selects an absolute period and supplies its named IANA timezone. Until tenant profile
   timezone exists, the result explicitly records `timeZoneSource: "browser-fallback"`.
2. `resolveDashboardWindow` validates a half-open `[sinceMs, untilMs)` request, rejects reversed or
   oversized ranges, and clamps only to explicit coverage boundaries.
3. A tenant/owner wrapper authenticates and scopes the page request before any database read.
4. The adapter uses an index plus cursor or both time and row caps, then maps rows to a narrow public
   projection. Raw database rows, raw `audit.payload`, prompts and content-like log fields stop here.
5. The adapter returns data plus `DashboardBound`. `partial` and its code-owned reason stay separate
   from `nextCursor` because legacy/coverage gaps can be partial without another page.
6. React renders loading, empty, ready, partial, busy, retryable error or governed refusal as distinct
   states. An exception never becomes `0`, `Healthy` or an empty array.
7. A state-changing control calls the existing governed mutation. The mutation rechecks tenant/owner
   authorization and current state, is retry-idempotent, and audits refs/hashes/counts only.
8. Attachment/report downloads request a newly ownership-checked signed URL on demand.
9. Navigation normally remains disabled/Soon until focused tests, authenticated Playwright,
   responsive and keyboard checks, rollback proof and blocking owner UAT all pass. An explicit
   owner-directed preview may activate one implemented route so UAT is reachable from the product;
   that link is access, not approval, and the checkpoint remains open.

## Invariants — what must never break

1. **Authorization lives on the server.** Hiding a nav item/control is presentation only. Tenant and
   owner isolation tests delete the scope/role premise and must fail.
2. **No raw rows cross the page boundary.** Page adapters return allowlisted refs, timestamps, counts
   and code-owned enums. Governance tests inject nested/address/content-like audit values and prove
   they never reach the result or DOM.
3. **Every list is bounded.** Use a stable total order, cursor pagination, or explicit time plus row
   caps. Never add hot-path `.collect().length`; capped counts carry partial copy.
4. **Time windows are half-open.** Persist epoch milliseconds, filter `>= sinceMs` and `< untilMs`,
   and format with the returned named timezone. Tests pin reversed, equal and oversized refusal.
5. **Money is integer USD cents.** Estimated, reserved, actual, refunded and unlanded are distinct;
   pre-coverage history is Unknown, never fabricated `$0`. **`unlanded` IS NOT ONE NUMBER ACROSS
   RAILS.** On reasoning and ingest it is money in flight that can still land or be refunded; on
   MEDIA it is permanent — that rail consumes the whole job estimate up front and has no refund
   path, so the gap between estimate and actual is never returned. `aggregateSpend` therefore
   derives `unlanded` PER RAIL and returns `byRail` beside the blended `totals`; read `byRail` with
   `UNLANDED_RESOLVES` before the figure reaches a person. Calling the blend "pending" describes
   media wrongly, and re-deriving it from blended sums is worse — one rail's refund would cancel
   another rail's reservation, money that can never come back being "returned" by money from an
   unrelated rail.
6. **Failure is not emptiness.** Loading, successful empty, partial, retryable error, busy/stale and
   governed refusal remain distinct. Health is Healthy only when every required loaded signal is.
7. **Signed URLs are on demand.** Ownership is checked before minting; capabilities never enter
   audit/log/storage rows. Foreign-id tests must fail closed.
8. **Mutations are state-guarded and replay-safe.** Retries, scheduler/webhook races and duplicate
   clicks have one terminal effect and refs/counts-only audit. A discarded plan never rearms.
9. **External success is never seeded.** Seeded terminal rows can prove UI/accounting states only.
   Provider delivery, charge, render or storage success requires separately executed live evidence.
10. **Page rollout is independent.** Direct routes support gates; nav normally activates after that
    page's blocking owner UAT. A named owner-preview exception may expose an implemented route while
    its UAT stays pending. Incomplete pages never receive fake data to unlock navigation.
11. **Pipeline safety is never a UI rollback.** Hiding Pipeline cannot remove Phase-19 suppression,
    consent or postal-footer enforcement.
12. **Command Center only composes summaries.** Source loading/error/partial/unavailable semantics
    survive composition; a Pipeline error cannot erase or zero other cards.

### Approvals read contract

- `approvals.summary` is the single page-and-rail subscription. It reads only `proposed` rows through
  `plans.by_tenant_status_createdAt`, returns the exact oldest timestamp, and reports at most `100`
  as `awaitingCount` with `awaitingCountCapped: true` when more exist. The badge renders `100+`; it
  must not start a second count query.
- `listAwaiting`, `listScheduled`, and `listInFlight` use Convex's opaque index cursor and clamp every
  requested page to `1..50`. Timestamp ties are therefore carried by the database cursor instead of
  a timestamp-only cursor that could skip work. The public row is refs/enums/timestamps/counts only:
  no tenant id, subject, body, recipients, candidate hints, attachment capability or raw plan row.
- Scheduled rows with no legacy `sendAt` are `scheduleState: "legacy-unknown"`. In-flight and cleared
  rows are exact only when `counterComplete` is true and all four counters form a valid total;
  otherwise progress is `partial/legacy-window`, never inferred as zero.
- `listCleared` requires an absolute `sinceMs`, queries `done` and `canceled` separately through the
  same tenant/status/time index, merges them in the shared stable order, and caps the merged result at
  50. A cap is returned as `partialReason: "row-cap"`. A canceled row without `cancelKind` is
  `legacy-unknown`; cost remains `{state:"unknown"}` until the spend ledger owns coverage.
- `listDecisions` scans at most 100 recent tenant evaluation rows and emits only code-owned financial
  questions whose closed Scorecard field is still empty. `answerDecision` accepts three numeric paths
  and one boolean path through a discriminated validator, rechecks that the latest tenant/thread row
  still exposes the question, and then patches it atomically. Rendered text can never choose a field.
- `blockedSummary` reads at most 21 unresolved tenant DLQs and returns only a capped count, oldest and
  newest timestamps, and `/ops`. It never returns DLQ ids, correlation/workflow ids, payload, error,
  notification body or a resolution control. Ops remains the only browser resolution surface.

**Approvals rollback:** disable the route/nav and fall back to the originating cockpit thread,
`/review`, `/requests`, and `/ops`. Keep the compound index, cancellation provenance, delivery
counters and read adapter deployed; rollback never rewrites a legacy row or fabricates cost/progress.

### Approvals type scale — inline styles must quote the mockup, not invent

`ApprovalsView.tsx` styles inline rather than through `globals.css` classes, so nothing stops a
value from drifting off-brand; the owner reported the first build as oversized on every axis at UAT.
The authority is `docs/design/mockups/pending-pages.html`, and the shipped sibling page
(`.vault-header h1`) already matches it. Pinned: the display headline is
`clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)` — the SAME clamp as the Vault, never a steeper `vw` term or
a larger cap; `.btn` is a `999px` pill at `0.86rem` (an inline `font: inherit` silently lands at the
1rem body size and MUST be followed by an explicit `fontSize`); card headings use the `cardTitle`
constant at `1.05rem`, because a bare `<h3>` falls back to the browser's `1.17em` — `globals.css`
has no heading reset; a TEXT stat takes `.stat-value.is-text` (`1.05rem`), not the `2rem` numeral
size; `caps` is `0.7rem`/`0.14em`. Touch targets stay at `2.5rem` `minHeight` (BRAND §6) — reducing
type must never reduce the hit area. When adding a surface here, copy the mockup's value or reuse a
`globals.css` class; do not eyeball a new one.

### Approvals — owner-APPROVED (Plan 26-05, Task 2 closed 2026-08-08)

- **The owner ran the UAT against seeded plan rows and approved it on 2026-08-08**, which is what
  unblocked Task 3's rail badge. Scope of that evidence, stated so it is not over-read later:
  it covers the UI states and the guarded terminals ONLY. **No Gmail send, Calendar insert or media
  generation was executed**, so nothing here is evidence of an external-provider result; that still
  needs a separately executed live run. Two defects were found and fixed during the UAT: the page's
  type scale (see above) and a cockpit crash on `?thread=` (see `cockpit.md` — the bug was in
  `listThreadMessages`, not on this page).
- `ApprovalsBadge` in `apps/web/app/(app)/layout.tsx` subscribes to **the same `approvals.summary`**
  the page does, which is the plan's one-shared-subscription key link: the rail count cannot
  disagree with the page it links to. It is shaped on the existing `DeadLetterBadge` — `undefined`
  (loading) and `0` both render nothing, so the rail never flashes a zero or a stale count — and it
  renders `N+` when `awaitingCountCapped`, never the capped number presented as exact.
- **Rollback is still one line:** delete the `NAV` entry. The route becomes undiscoverable while
  plan state, cancellation provenance, delivery counters and the read model all stay deployed.
- The page composes `approvals.summary`, bounded Awaiting/Scheduled/In-flight/Cleared lanes,
  decisions and the sanitized Ops aggregate. Detail content is fetched through the existing
  tenant-owned `plans.byThread`; attachment capabilities are requested only after the user opens
  the attachment list.
- Initial email scheduling is deliberately two-step: the browser parses `datetime-local` in its
  resolved IANA timezone, rejects invalid/past/out-of-horizon values, displays the resulting absolute
  instant, then confirmation calls `setPlanSendTime` followed by the existing `executePlan` gate.
  Scheduled cancel and move call `cancelScheduledPlan`/`moveScheduledPlan`; `alreadyResolved` and
  `already_fired` are rendered as stale/in-flight outcomes, never successful cancellation/movement.
- Every awaiting row links to `/dashboard/workspace?thread=<id>` for revision or calendar-time
  changes. Destructive discard requires an inline confirmation and keeps the permanent
  `cancelKind:"discarded"` non-rearm boundary. Compliance details remain at `/ops`.
- Loading, successful empty, bounded partial, retryable exception, busy, stale and governed refusal
  copy are distinct. Cost stays “not recorded”; legacy delivery progress stays partial.

**Automation status (2026-08-05):** the executable pure/server-render contract is
`approvalsView.test.ts` (not `.test.tsx`, because `apps/web/vitest.config.mts` intentionally discovers
only `.test.ts` in its DOM-free runner) and passes 13/13. Web typecheck passes. The authenticated
Playwright spec is authored and reached the real local Convex seeding/route run, but this shell has
no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` and the saved storage state is expired; the page correctly
redirected to Sign in. Therefore authenticated browser/UAT evidence is still **pending**, not green;
the owner-preview navigation link is active only to make that verification reachable.
Resume with both runtimes active and credentials set:

```text
pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts
```

The spec seeds plan rows for UI-state evidence only. Public mutations prove schedule replay,
idempotent cancel, no duplicate request fan-out, lost cancel/move races, permanent discard and a
provider-free memo double-approve. It never treats seeded done/delivering rows as Gmail, Calendar or
media-provider success; any such claim requires a separately executed live result.

### Finance ledger contract

`spendEvents` is the reporting/reconciliation plane. **The limiter stays enforcement truth**: it
decides whether a spend may happen, and nothing here may be relaxed to make a report easier.

- **Correlation construction.** A `correlationId` is server-minted from refs and matches
  `^[A-Za-z0-9._:@/-]{1,128}$` — no whitespace, so a pasted sentence cannot enter the table (§4).
  It must be **stable** across every retry of one logical movement and **distinct** between logical
  movements; a random per-attempt id silently defeats replay suppression.
- **Identity is `(tenantId, correlationId, phase)`, not the correlation alone.** A reservation and
  its later actual charge deliberately share one correlation — that shared key is what makes them
  reconcilable — so a correlation-only guard would swallow the actual as a duplicate of the
  reserve. `by_correlation` is not tenant-scoped, so the tenant comparison is part of the identity
  check in `spendLedger.record`, never an assumption.
- **First write wins.** A replay returns the stored id and ignores the replayed amount. A retry
  reporting a different number is an upstream bug; letting it through would rewrite recorded money.
  Drift is corrected by appending an `adjustment` (owed more) or `refunded` (money back) movement.
- **Direction lives in the phase, never the sign.** Every `amountCents` is a positive safe integer,
  so no consumer has to guess whether a negative is a credit or a bug.
- **Indexes.** `by_tenant_createdAt` (window reads), `by_tenant_rail_createdAt` (one-rail reads),
  `by_correlation` (idempotence). A reader that needs a fourth access pattern adds an index; it
  does not filter a wider scan.
- **Retention.** There is no purge, TTL or archival path in this module and adding one is a
  separate, deliberate design — this is financial history, and the insert-only source scan
  (`db.patch`/`db.replace`/`db.delete`) fails the build if an edit path appears (§3).
- **Reconstruction limits — what the ledger cannot tell you.** A window opening before
  `spendCoverage.coverageStartedAt`, or a tenant with no coverage row at all, is **Unknown**; it is
  never rendered as `$0`, and it can never be backfilled because the events were never observed.
  `listEvents` caps at 500 rows, so a window that fills the cap is partial and must carry
  `partialReason: "row-cap"`. The idempotence scan reads at most 32 rows per correlation, which is
  safe only while every writer keeps to one row per `(tenant, correlation, phase)`.
- **Disagreement with the limiter is a signal, not a defect.** Unlanded money — reserved, then
  neither charged nor refunded — is exactly what reconciliation is for. Do not hide it by folding
  it into another phase.
- **Rollback rule, non-negotiable.** Finance may hide its route and owner controls. It may **not**
  stop ledger instrumentation: an append-only history has no backfill, so a dark window is a
  permanent hole in the record.
- **Who writes (26-07).** The reasoning and ingest rails are instrumented at their limiter, inside
  the same transaction, via `spendLedger.recordMovement` — the plain-function half of `record`. The
  writers, the correlation policy and what is deliberately NOT recorded live in
  `docs/playbooks/guardrails.md` §"Phase 26"; Finance is a READER and must not re-derive any of it.
- **Who writes (26-08).** The media rail is instrumented too, so all three rails are covered. It is
  the one rail whose two planes diverge on AMOUNT by design (`docs/playbooks/media.md`): the limiter
  takes the whole batch estimate up front and never refunds, so `reserved − actual` is a PERMANENT
  over-reservation rather than money in flight. `UNLANDED_RESOLVES.media` is `false` and says so in
  code; a surface that calls it "pending" is ignoring an explicit fact.
- **A schema source scan must pin the DECLARATION, not the print width.** `dashboardSchema.test.ts`
  compares whitespace-free and normalizes the trailing comma before `)`, because the formatter adds
  one when it wraps a call across lines and drops it when the call fits on one. Commit `b74c7af`
  re-wrapped `cancelKind` onto a single line and turned this gate red without changing the schema's
  meaning; `dense()` exists so that cannot happen again, and it still goes red on a real change.

### Finance projections and owner controls (26-09)

`packages/backend/convex/finance.ts` is the READ side. It returns the two planes side by side and
never derives one from the other: `rails` is what the limiter will enforce on the next call,
`tracked` is what the ledger observed. `tracked` can be `coverage: "unknown"` while `rails` is
perfectly known — that is not an inconsistency, it is the difference between a gauge and a record.

- **The tenant surface must expose no deployment-global state.** `guardrails.remainingDailyCents`
  and its media/ingest siblings return `min(tenant, deployment)` — correct for sizing a sub-agent
  envelope, WRONG here, because that minimum leaks the keyless ceiling's utilization to every tenant
  that can read it. `finance.summary` reads the PERSONAL window only; the three deployment ceilings
  are `finance.globalRails`, an `ownerQuery`. A test drains all three deployment windows and asserts
  no deployment constant appears anywhere in the tenant payload.
- **`getValue` returns STORED state, not a roll-forward**, so a rail must be rolled to `now` before
  a person sees it — with the component's own exported `calculateRateLimit`, never a
  reimplementation. `guardrails.refundableCents` learned this by refunding 2900 against a capacity of
  2500; the Finance tile is where it bites the other way, telling a tenant with a full allowance that
  they are out of budget because the window rolled overnight with nothing written since.
- **`resetsAtMs` is not midnight anywhere.** A fixed window with no `start` is anchored to the rail's
  FIRST spend, so each rail resets on its own offset. It is returned as an epoch instant labelled
  `resetTimeZone: "UTC"` — the ENFORCEMENT clock, deliberately separate from `window.timeZone`, which
  is the browser-derived DISPLAY timezone and never reaches a query or a filter.
- **The reported window is passed to `aggregateSpend` UNCLAMPED.** Clamping it up to
  `coverageStartedAt` would turn an unknown stretch into a silently shorter window with a confident,
  wrong total. Each `spendSeries` bucket is aggregated on its own for the same reason, so a bucket
  before coverage reports `unknown` instead of inheriting the window's verdict.
- **A window that fills the 500-row cap is `partial` + `"row-cap"`**, and its totals are
  under-reported. Never render a capped window's total as the period's spend.
- **`mediaLedger` uses Convex's own cursor pagination**, because a batch's lines all share one
  `createdAt`; the index cursor carries the document id, so a page boundary inside a timestamp tie
  neither repeats nor drops a row. A hand-rolled `createdAt` cursor cannot do that.
- **Reads go through `spendLedger`'s plain-function halves** (`coverageFor`, `listEventsFor`), added
  in 26-09 for the same reason as `reserveFolderInner`/`reserveFolder`: a Convex query cannot
  `runQuery`, and the cap and index must live in ONE place or the reader grows a second definition of
  the bounded read.

**Operator blast radius — the owner controls are deployment-wide, not per tenant.**

| Control | Effect | Blast radius | Rollback |
|---|---|---|---|
| `finance.setMasterKillSwitch` | `guardrailConfig.killSwitch` | ALL tenants, ALL model calls, incl. the email cockpit and every ingest path | flip it back; nothing is lost, refused calls were never charged |
| `finance.setMediaKillSwitch` | `guardrailConfig.mediaKillSwitch` | ALL tenants' paid generation only; the cockpit keeps running | flip it back |
| `finance.setPerRequestBudget` | `guardrailConfig.budgetUsdPerRequest` | ALL tenants' `chooseModel` ceiling; too low refuses every request as `over_budget` | set the previous value, which the audit row records as `from` |

- **The wrappers are the boundary, not the UI.** All six owner functions are `ownerQuery`/
  `ownerMutation`, so a non-owner is rejected before the handler reads or writes. Hiding a control in
  the console is cosmetic. `requiresConfirmation` is code-owned on every control so the console
  cannot ship a one-click deployment-wide pause by forgetting a prop.
- **One upsert writes every field.** `patchControls` merges over the effective `getGuardrailConfig`,
  so the insert branch can never create a row with one field set and the others missing — which is
  what makes the default-on-read contract survive the first write.
- **One audit row per ACCEPTED transition, none for a no-op** (the `owner.bootstrapOwner`
  precedent): an event for a change that did not happen makes the log lie about when the deployment
  moved. The payload key set is exactly `control,from,to` — booleans, numbers and a code-owned
  control name, nothing identifying (§4).
- **Every mutation returns the re-read effective state**, not the argument it was given, so a write
  a concurrent transaction overwrote cannot be reported as success.

### The connected Cost route (26-10)

`apps/web/app/(app)/dashboard/finance/` — `page.tsx` is a five-line server component; everything
lives in `FinanceView.tsx`, which follows the ApprovalsView shape exactly: `"use client"`, one error
boundary, per-section `useQuery` so a ledger failure cannot erase the live rails, and inline
`CSSProperties` rather than class names.

- **The page is named Cost and reads spend only.** Owner rename decision 2026-08-07: business money
  (revenue, invoices, runway) is Phase 28's separate **Cash** surface. There is no revenue data in
  the system, so a revenue tile would be fabricated (BRAND §5). The route path stays
  `/dashboard/finance` because that is what the plan and the watch map name.
- **Almost none of the mockup's classes exist.** `globals.css` really has `stat-grid`, `stat-tile`,
  `stat-head`, `stat-badge`, `stat-value` and `caps-label`. `.card`, `.meter`, `.pill`, `.btn`,
  `.sec`, `.split`, `.bars`, `.kpi`, `.note`, `.mono`, `.num` are **mockup-only**, and `.ledger` IS
  defined but is the DARK marketing audit block from the landing page — applying it here renders the
  console on a navy panel. Check `globals.css` before reusing a class name from
  `docs/design/mockups/pending-pages.html`.
- **The budget meter is a native `<progress>`, and the percentage is also written in words.** That
  is the in-app precedent (ApprovalsView delivery progress), it needs no new CSS, and it satisfies
  BRAND §6's no-meaning-in-color-alone rule for free. The mockup's `.meter.warn` paints `--held`;
  BRAND §2 reserves amber for the approval gate ("spend amber in exactly one place"), so a budget
  warning must not borrow it.
- **Three page rules, each with a component test that goes red without it.** An `unknown` window
  renders NO currency mark at all (a zero is indistinguishable from a watched-and-empty period);
  media's `unlanded` gets different copy from the other two rails (`unlandedResolves.media` is
  `false`, so it is permanent, not pending); and `bound.partial` says the totals are a FLOOR.
- **The window is clamped to the coverage start, and the clamp ANNOUNCES ITSELF.** `finance.coverage`
  is read first so the page can size its window before asking for totals. Found by the 26-10 UAT on
  a real tenant: a fixed 30-day window over a workspace covered since the previous day made
  `aggregateSpend` return `unknown` for the whole period, so the totals read "Unknown" while the
  per-day series directly beneath them showed **$1.52** on a covered day — self-contradictory, and it
  suppressed every real figure for a month after any tenant starts. `CoverageClampNotice` names the
  truncation ("Showing since 8 Aug 2026, when cost tracking began"). **A SILENT clamp is still
  forbidden** — that reports a confident total for a narrower period than the reader asked for,
  which is the failure the coverage field exists to prevent. Two cases are deliberately not clamped:
  a tenant with no coverage row keeps the full Unknown state, and a coverage start at or after
  `untilMs` is left alone rather than inverting the window into a `resolveDashboardWindow` throw.
- **`requiresConfirmation` is honoured as a backend fact.** Each control arms, then commits, and the
  confirm step is in-component — never `window.confirm`, which blocks the page and cannot be driven
  by the spec that has to prove the boundary.
- **A non-owner's DOM carries no deployment VALUE and no switch POSITION.** Naming that the controls
  exist is product copy; a ceiling amount or an on/off state is a global fact. `ConnectedDeployment`
  passes `"skip"` to the owner queries for a non-owner — firing them would throw `OWNER_REQUIRED`
  and drop the whole page into the error boundary for someone who is simply not the owner.
- **Component tests are `.test.ts`, never `.test.tsx`.** `apps/web/vitest.config.mts` includes
  `app/**/*.test.ts` only, so a `.tsx` is silently skipped. Components are built with
  `createElement` and rendered to a string with `renderToStaticMarkup`; only the hook-free exports
  are importable, which is why the connected pieces stay module-private. The same config now sets
  `esbuild: { jsx: "automatic" }` to match Next; before that, esbuild's classic runtime made every
  `.tsx` reached from a test need a dead default `React` import or die with `React is not defined`.

### Finance becomes a three-tab shell (cash-business-finance Task 1)

The route is now a three-tab shell, structural move only — no cost behaviour changed.
`apps/web/app/(app)/dashboard/finance/page.tsx` renders `FinanceTabs.tsx`, which owns the tablist
and the header; `FinanceView.tsx` no longer renders a page on its own, it exports the tab bodies.

- **Business leads.** `FINANCE_TABS` order is `["business", "spend", "operator"]` and `?tab=`
  defaults to `business` on an unrecognized or missing value — the tenant's own money outranks the
  tool's bill. `CashView.tsx`'s `CashTab` is a placeholder in this task; Tasks 2, 3, 6 and 9 build it.
- **Pikar spend is the shipped Cost console, moved intact, not reopened.** `ConnectedFinance` was
  renamed to the exported `PikarSpendTab` with its own `<header>` deleted — the shell now owns the
  one page header — and every other export (`RailsSection`, `TrackedSection`, `LedgerSection`,
  `RailTile`, `TrackedTotals`, etc.) and their behaviour are untouched.
- **Operator is owner-only, and hiding it is presentation, not the boundary.** `ConnectedDeployment`
  was renamed to the exported `OperatorTab`; its body — including the `isOwner ? {} : "skip"` guards
  on `finance.controls`/`finance.globalRails` — is unchanged. `visibleTabs(isOwner)` filters the tab
  out of the tablist and `FinanceTabs` mounts the Operator panel only when `isOwner` is true (a
  hidden-but-mounted panel would still fire the owner queries for a non-owner and throw
  `OWNER_REQUIRED` into the error boundary). The actual trust boundary remains the `ownerQuery`/
  `ownerMutation` wrappers on `finance.ts`, exactly as recorded above — moving the tab does not
  change who Convex lets call them.
- **Tab mechanics are copied from `dashboard/profile/page.tsx`, not invented**: roving tabindex that
  moves real DOM focus on arrow-key navigation, `?tab=` read once from `window.location.search`
  (never `useSearchParams`, which needs a Suspense boundary typecheck cannot see is missing), and
  `history.replaceState` on switch so a tab change is not a navigation that re-runs every query.
  Business and Pikar-spend stay mounted and toggle with `hidden`, so a half-typed figure on one tab
  survives a trip to another.
- **Test evidence:** `financeView.test.ts` gained a `describe("finance tabs", ...)` block (5 tests)
  asserting tab order, `visibleTabs` owner-gating, and that every tab carries a sub-heading; every
  pre-existing assertion in that file stayed green because the pure/exported components it imports
  were not restructured. `pnpm --filter @pikar/web test` and `pnpm typecheck` both pass.

**Rollout state, 2026-08-09 — Finance navigation is ACTIVE, on owner direction.** The owner reviewed
the connected page as owner and directed activation; Task 3 replaced the disabled item with
`href: "/dashboard/finance"`. Recorded honestly, because the checkpoint's own wording is "owner types
approved or reports exact defects" and this was a direction to activate rather than a completed
checklist.

*Verified live in the browser before activation:* the three rails and their three DIFFERENT UTC reset
instants; `Unknown` rather than `$0` for a pre-coverage window; both unlanded sentences on one page;
blended unlanded `$6.90` where a blended re-derivation would read `$6.44` (26-08's per-rail decision,
visible on screen); the two-step arm/confirm; the write and its effective-state readback; the master
switch staying independent of the media switch; the revert; and exactly two audit rows with keys
`control,from,to` and actor `owner`.

*NOT observed live, and not claimed:* (1) the non-owner view — `bootstrapOwner` has no inverse, so
once the reviewing account became owner the "managed by the operator" state was unreachable from it;
it stays covered by the backend `OWNER_REQUIRED` tests and the non-owner DOM component test.
(2) Responsive breakpoints — the browser extension's window resize would not move the rendered
viewport, so that check belongs to the Playwright spec's `setViewportSize`. (3) `finance.spec.ts`
itself. Evidence rows seeded for this review are permanent and carry the correlation prefix
`uat-26-10:`.

**Evidence status, 2026-08-09 — the browser gate is NOT green.** Currently passing:
`pnpm --filter @pikar/web test` (88/88, of which 29 are Cost Console), web typecheck, and the
production build, in which `/dashboard/finance` appears in the route table. `e2e/finance.spec.ts` is
authored and was **executed**; it stopped in the canonical `auth.setup.ts` because this shell has no
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD`, so 27 assertions did not run. Do not cite the browser gate as
passed. With local `convex dev` (not `--once`) plus Next on `:3111` and both credentials exported,
resume exactly:

```text
pnpm --filter @pikar/web test:e2e -- e2e/finance.spec.ts
```

The nav item stays `Soon` until that run and the blocking owner UAT both pass; the route is reachable
directly at `/dashboard/finance` in the meantime, and the spec asserts the absence of the nav link so
activation cannot happen by accident.

## How to change safely

1. Add optional fields and compound indexes before readers. Keep legacy rows readable as
   `legacy`, `unknown` or `partial`; backfill only through resumable bounded jobs when justified.
2. Put reusable arithmetic/state/order behavior in a pure package and mutation-test it first.
3. Add a thin tenant/owner adapter with explicit projection, stable order and caps. Test unauthenticated
   access, a guessed foreign id, timestamp ties, empty, cap/partial, retry and legacy rows.
4. For money/action terminals, instrument every success/refund/failure branch and replay before
   building Finance/UI copy. Never weaken the enforcement limiter to make reporting easier.
5. Build the direct route with navigation normally disabled. If the owner explicitly requires an
   in-product preview link for UAT, record that exception without claiming checkpoint completion.
   Cover every page state in component tests, then run authenticated Playwright without claiming
   seeded provider outcomes are live outcomes.
6. Exercise desktop/tablet/mobile, keyboard/focus, no color-only meaning and the rollback boundary.
7. After owner approval, rerun the page browser spec, web typecheck/build and watcher, then record
   approval/evidence here. If an owner-preview link is already active, approval changes the recorded
   rollout state rather than silently treating link activation as sign-off.

## How to verify

### Pure contracts and operational ownership

```text
pnpm --filter @pikar/core test -- dashboard
pnpm --filter @pikar/core typecheck
node scripts/check-playbooks.mjs
```

### Focused backend gates

```text
pnpm --filter @pikar/backend test -- approvals
pnpm --filter @pikar/backend test -- spendLedger
pnpm --filter @pikar/backend test -- finance
pnpm --filter @pikar/backend test -- content
pnpm --filter @pikar/core test -- reports
pnpm --filter @pikar/backend test -- reportsBusiness reportsGovernance reportPack
pnpm --filter @pikar/core test -- home
pnpm --filter @pikar/backend test -- home briefings
```

These prove adapter authorization/isolation, caps/cursors, ledger replay, safe projection, one-snapshot
packs and composed priority/health semantics. Subsystem plans add their terminal-focused commands.

### Connected page gates

```text
pnpm --filter @pikar/web test -- approvals
pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts
pnpm --filter @pikar/web test -- finance
pnpm --filter @pikar/web test:e2e -- e2e/finance.spec.ts
pnpm --filter @pikar/web test -- content
pnpm --filter @pikar/web test:e2e -- e2e/content.spec.ts
pnpm --filter @pikar/web test -- reports
pnpm --filter @pikar/web test:e2e -- e2e/reports.spec.ts
pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts
pnpm --filter @pikar/web test:e2e -- e2e/command-center.spec.ts
```

Playwright requires the documented authenticated local Convex/Next runtime. A listed spec is not
evidence until it has executed. Owner UAT remains manual-only and blocking for navigation.

### Phase close

```text
pnpm --filter @pikar/backend test
pnpm --filter @pikar/web test
pnpm --filter @pikar/backend typecheck
pnpm --filter @pikar/web typecheck
pnpm --filter @pikar/web build
node scripts/check-playbooks.mjs
```

## Operational notes

- Roll out per page: additive schema/index → writer/instrumentation → adapter → hidden route → browser
  gate → owner UAT → nav. Never combine nav activation with an unexecuted gate.
- Keep the old Command Center component as a simple feature-switchable fallback through final UAT.
- Treat deployment/provider auth errors as live gates, not test failures and not permission to stub
  success. Record the missing runtime prerequisite and exact resume command.
- `apps/web/e2e/` is broadly watched by `cockpit.md`. The six exact Phase 26 specs intentionally
  require both cockpit and this playbook when changed; unrelated E2E remains cockpit-only.

### Per-page rollback boundary

| Page | Safe rollback | Must remain active/retained |
|------|---------------|-----------------------------|
| Approvals | Disable nav/route and use workspace, `/review`, `/requests` | plan state, discard/cancel provenance and delivery progress |
| Finance | Disable the route and owner controls | spend-event instrumentation, coverage start, enforcement limiters, and the operator paths `guardrails:setKillSwitch` / `setMediaKillSwitch` (`npx convex run`), which stay the fallback when the console is off |
| Content | Disable route/promotion control | provenance and already-promoted/ingesting rows; never silently demote |
| Reports | Disable route and pack generation | immutable generated artifacts/snapshots and safe audit metadata |
| Pipeline | Hide the Phase-19 route | suppression, consent, send-terminal guards and postal footer |
| Command Center | Restore the legacy component | bounded source-summary APIs and their error/partial semantics |

## Known gaps & deferred work

- Tenant profile has no canonical timezone. Browser IANA timezone is the explicit v1 fallback; the
  upgrade is a validated tenant setting, not silent server-local formatting.
- Finance begins at `coverageStartedAt`; earlier history remains Unknown. There is no invented
  backfill from enforcement windows.
- Inline calendar time editing is deferred until availability recheck plus CAS semantics exist;
  Approvals links back to the originating cockpit.
- Pipeline remains a narrow contacts/follow-up/consent/suppression surface. Opportunities, stages
  and monetary pipeline value are out of scope.
- Exact Vault category counters and any new Drive write scope/vendor/data plane remain deferred.
