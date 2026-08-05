# Playbook: Connected dashboard pages

> Last verified: 2026-08-05 against 48c622b
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
9. Navigation remains disabled/Soon until focused tests, authenticated Playwright, responsive and
   keyboard checks, rollback proof and blocking owner UAT all pass. The owner-approved route plan
   activates only that page.

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
   pre-coverage history is Unknown, never fabricated `$0`.
6. **Failure is not emptiness.** Loading, successful empty, partial, retryable error, busy/stale and
   governed refusal remain distinct. Health is Healthy only when every required loaded signal is.
7. **Signed URLs are on demand.** Ownership is checked before minting; capabilities never enter
   audit/log/storage rows. Foreign-id tests must fail closed.
8. **Mutations are state-guarded and replay-safe.** Retries, scheduler/webhook races and duplicate
   clicks have one terminal effect and refs/counts-only audit. A discarded plan never rearms.
9. **External success is never seeded.** Seeded terminal rows can prove UI/accounting states only.
   Provider delivery, charge, render or storage success requires separately executed live evidence.
10. **Page rollout is independent.** Direct hidden routes support gates; nav activates only after
    that page's blocking owner UAT. Incomplete pages never receive fake data to unlock navigation.
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

### Approvals hidden-route gate (Plan 26-05, pre-owner UAT)

- `/dashboard/approvals` is directly reachable behind the authenticated shell while its serialized
  rail entry remains `aria-disabled="true"` with `Soon`. Do not add the href or badge before the
  blocking owner checkpoint passes.
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
redirected to Sign in. Therefore browser/UAT/navigation evidence is still **pending**, not green.
Resume with both runtimes active and credentials set:

```text
pnpm --filter @pikar/web test:e2e -- e2e/approvals.spec.ts
```

The spec seeds plan rows for UI-state evidence only. Public mutations prove schedule replay,
idempotent cancel, no duplicate request fan-out, lost cancel/move races, permanent discard and a
provider-free memo double-approve. It never treats seeded done/delivering rows as Gmail, Calendar or
media-provider success; any such claim requires a separately executed live result.

## How to change safely

1. Add optional fields and compound indexes before readers. Keep legacy rows readable as
   `legacy`, `unknown` or `partial`; backfill only through resumable bounded jobs when justified.
2. Put reusable arithmetic/state/order behavior in a pure package and mutation-test it first.
3. Add a thin tenant/owner adapter with explicit projection, stable order and caps. Test unauthenticated
   access, a guessed foreign id, timestamp ties, empty, cap/partial, retry and legacy rows.
4. For money/action terminals, instrument every success/refund/failure branch and replay before
   building Finance/UI copy. Never weaken the enforcement limiter to make reporting easier.
5. Build the direct route with navigation still disabled. Cover every page state in component tests,
   then run authenticated Playwright without claiming seeded provider outcomes are live outcomes.
6. Exercise desktop/tablet/mobile, keyboard/focus, no color-only meaning and the rollback boundary.
7. After owner approval, change the one serialized nav entry, rerun the page browser spec, web
   typecheck/build and watcher, then record approval/evidence here.

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
| Finance | Disable the route and owner controls | spend-event instrumentation, coverage start and enforcement limiters |
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
