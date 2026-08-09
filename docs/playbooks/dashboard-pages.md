# Playbook: Connected dashboard pages

> Last verified: 2026-08-09 (Plan 26-10 Task 1 — the connected Cost route, nav still `Soon`, owner UAT pending)
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
