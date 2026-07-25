---
phase: 13
slug: proactive-in-app-review
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.2.7 + convex-test 0.0.54 |
| **Config file** | `packages/backend/vitest.config.mts` (env `edge-runtime`, include `convex/**/*.test.ts`, no watch mode) |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts convex/evaluations.test.ts` |
| **Full suite command** | `pnpm test` (turbo, all packages) |
| **Estimated runtime** | ~30 seconds quick · ~3 min full |

**Additional gates:** `pnpm --filter @pikar/web typecheck` · `node scripts/check-playbooks.mjs` (Stop hook, must exit 0)

**Known baseline:** the backend suite has ONE pre-existing failure (recorded at 12-05: 474/475). Do NOT treat it as a regression.

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts convex/evaluations.test.ts`
- **After every plan wave:** Run `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/web typecheck` + `node scripts/check-playbooks.mjs`
- **Before `/gsd:verify-work`:** Full `pnpm test` green, plus the live dashboard `runWeekly {}` invocation
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; this map is keyed by behavior and must be re-keyed to
> task IDs in each PLAN.md's `<automated>` verify blocks.

| Behavior | Req | Test Type | Automated Command | File Exists | Status |
|----------|-----|-----------|-------------------|-------------|--------|
| `runWeekly` enumerates only tenants with a `business_profile` doc, schedules one `reviewOne` each | BEVL-03 SC#1 | unit (convex-test) | `pnpm --filter @pikar/backend exec vitest run convex/proactiveReview.test.ts -t "enumerates"` | ❌ W0 | ⬜ pending |
| After `runWeekly` + `finishInProgressScheduledFunctions`: an `evaluations` row on the review thread AND a `notifications` row | BEVL-03 SC#1 | unit (convex-test) | `… -t "writes a review card and a notification"` | ❌ W0 | ⬜ pending |
| Notify-on-change: unchanged second week writes the evaluation row but NO new notification | BEVL-03 SC#1 | unit (convex-test) | `… -t "notifies only on change"` | ❌ W0 | ⬜ pending |
| `proactiveReview.ts` imports neither `./gmail` nor `./notifyExternal`, never references `notifications.notify` | BEVL-03 SC#2 | static source scan (Idiom A) | `… -t "no mailbox token"` | ❌ W0 | ⬜ pending |
| `"weekly_review"` / `"weekly_review_failed"` absent from `NOTIFICATION_KINDS` (second, independent SC#2 barrier) | BEVL-03 SC#2 | unit (pure) | asserted in the same guard test | ❌ W0 | ⬜ pending |
| Every `ctx.db.query(...)` in `proactiveReview.ts` is followed by a `withIndex` whose first `eq` is `tenantId` (except the named `by_kind` enumerator) | BEVL-03 SC#3 | static source scan | `… -t "tenant-scoped"` | ❌ W0 | ⬜ pending |
| Tenant A's cron run writes no row readable by tenant B (`byThread` under B returns null) | BEVL-03 SC#3 | unit (convex-test) | `… -t "cross-tenant"` | ❌ W0 | ⬜ pending |
| The run's audit row is the existing `evaluation.ran`, payload = counts/enums only; no *additional* audit eventType | BEVL-03 SC#3 | unit (convex-test) | extend `proactiveReview.test.ts` | ⚠️ extend | ⬜ pending |
| `delta` absent on first run, present with expected route/playbook diff on second | Delta | unit (convex-test) | `pnpm --filter @pikar/backend exec vitest run convex/evaluations.test.ts -t "delta"` | ⚠️ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/backend/convex/proactiveReview.test.ts` — covers BEVL-03 SC#1/SC#2/SC#3. MUST use the
      `newTest()` helper from `evaluations.test.ts:26-31` (registers the `auditCounts` aggregate
      component) and Idiom A (`import.meta.glob("?raw")`) so the static guards live in the same
      edge-runtime file as the behaviour tests.
- [ ] `docs/playbooks/watch.json` — register `packages/backend/convex/proactiveReview.ts` and
      `proactiveReview.test.ts` under `business-evaluation.md`, or the Stop hook blocks the phase.
- [ ] No framework install needed — vitest + convex-test are already present and configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pinned review tab renders the card and does NOT render the composer | BEVL-03 (UI) | The workspace has no component-test harness — only Playwright e2e under `apps/web/e2e/`, which needs a live deployment + auth. A spec for a cron-produced card would need seeded backend state; not worth the fixture cost this phase. | Convex dashboard → run `proactiveReview:runWeekly {}` → open `/dashboard/workspace` → confirm review card renders and composer is suppressed |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — no `<automated>MISSING</automated>` exists; `proactiveReview.test.ts` is created inside plan 13-02 Task 1 as a `tdd="true"` task (a convex-test file referencing `internal.proactiveReview` cannot typecheck before the module exists)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-25 (gsd-plan-checker, Dimension 8 PASS)
