---
phase: 13-proactive-in-app-review
plan: 03
subsystem: frontend
tags: [nextjs, react, cockpit, workspace, notifications, evaluations, brand, bevl-03]

# Dependency graph
requires:
  - phase: 13-proactive-in-app-review
    plan: 01
    provides: "`evaluations.delta` on the persisted row and `REVIEW_THREAD_ID` exported from `@pikar/core`"
  - phase: 13-proactive-in-app-review
    plan: 02
    provides: "the cron that writes one `evaluations` row per tenant per week on the STABLE review thread, plus the `weekly_review` / `weekly_review_failed` in-app notification rows"
  - phase: 12-business-evaluation-engine
    provides: "`api.evaluations.byThread` (latest-row-per-thread read) and the `EvaluationCard` this plan extends"
  - phase: 11-onboarding-profile
    provides: "`/dashboard/profile` — the enrichment surface the thin-data CTA routes to"
  - phase: 07-resilience-ops
    provides: "`NotificationsBanner` — the exclude-list in-app render surface that already showed both review kinds"
provides:
  - "A PINNED, non-closable 'Weekly review' tab seeded into the workspace tab strip, with the composer suppressed on it (the synthetic thread has no `plans` row)"
  - "`EvaluationCard` review-only branches: a pre-first-run empty state, a dated header, a `delta` 'what changed' line, and a `/dashboard/profile` CTA on the thin-data variant"
  - "`KIND_HREF` in `NotificationsBanner` — an opt-in per-kind click destination, so the review notification opens the review"
affects: [13-04, cockpit, audit-dead-letter, proactive-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seed a deterministic id as a REAL list item rather than rendering it beside the list — the existing dedupe (`openThread`) then makes the deep-link idempotent for free"
    - "Suppress the CLIENT surface that would hit a backend guard, never loosen the guard: the guard protects every other caller"
    - "Opt-in per-kind lookup map (`Record<string, string>`) over a per-kind conditional — absence is the default, so no existing kind changes behaviour"
    - "Resolved-null vs undefined as the empty-state branch point: `undefined` is still loading, so an empty state gated on `=== null` cannot flash"

key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/workspace/page.tsx
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/_components/NotificationsBanner.tsx
    - docs/playbooks/cockpit.md
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "The pinned tab is a REAL `Tab` seeded into `useState<Tab[]>([REVIEW_TAB])`, not a separately-rendered element beside the strip. That choice is what makes the `?thread=proactive-review` notification deep-link dedupe for free — `openThread` already skips ids it is showing, so the click-through lands on the existing tab instead of minting a twin. No persistence is needed because the thread id is deterministic, so the 'tabs are session-only view state' note in `cockpit.md` still holds unamended."
  - "The COMPOSER is suppressed on the review thread; the `cockpit.ts:93` `plan row missing for thread` guard was NOT loosened. Reading the synthetic thread already degrades gracefully (empty message page, null plan, null briefing, and it stays out of `cockpit.listThreads` because that reads agent-component threads), so the send path is the only broken one — and that guard protects every real cockpit thread from a plan-less send."
  - "The review branch is checked BEFORE the gmail-status branch. The review has nothing to do with a mailbox, so a user who never connected Gmail must still see it — that is the whole point of SC#2 (the review cannot break on the Google 7-day testing token)."
  - "The empty state branches on `evaluation === null` specifically, not on falsiness. `undefined` is still loading, so gating on falsiness would flash the 'first review runs Monday' card on every load of a thread that HAS a review. Off the review thread the original bare `return null` is preserved byte-for-byte, so an on-demand evaluation thread never gains a card it did not have."
  - "The DATE is the freshness signal — no unread dot, no badge (deferred by decision). The framework label stays in the header alongside it so the user compares like with like week over week."
  - "`deltaLine` stayed INLINE in `cards.tsx` rather than moving to `@pikar/core` for a unit test. `apps/web` has no unit-test runner (only Playwright), and CLAUDE.md §8 explicitly forbids standing up frameworks/fixtures for a check; the failure mode is a cosmetic plural on a line that is visible on sight, with no data or security consequence. Moving 8 lines of string formatting across a package boundary (new file + test + watch.json + playbook coverage) is a bigger diff than the code it guards."
  - "The profile CTA uses `--teal-900`, not the `--teal-600` its sibling links in the same card use. BRAND §6 is explicit: teal-600 is ~2.9:1 on light paper — fine as a white-text button FILL, not as small teal TEXT — and says to darken it. The pre-existing teal-600 links in `EvaluationCard` are a pre-existing violation and out of scope."
  - "`KIND_HREF` hrefs are code-owned constants built from `@pikar/core`, never derived from notification row data, so no row can steer a user anywhere. `message` is a static §4 label by contract, so using it as link TEXT carries no PII."

patterns-established:
  - "Playbook-recorded anti-fix: `cockpit.md` now states in prose that the composer suppression IS the fix and that relaxing `cockpit.ts:93` is the wrong one, so a future reader hitting the throw does not 'helpfully' widen the guard"

requirements-completed: [BEVL-03]

# Metrics
duration: ~25min
completed: 2026-07-25
---

# Phase 13 Plan 03: The In-App Review Surface Summary

**The half of BEVL-03 the user can actually see: a pinned, non-closable "Weekly review" tab whose composer is suppressed (the synthetic thread has no `plans` row, so a send would throw), a dated review card that says what changed since last week and offers the profile page as the one action that unblocks a thin-data verdict, and a notification that opens the review — three small web edits, no new component, no new route, no new card idiom.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-25T17:47Z
- **Completed:** 2026-07-25T18:12Z
- **Tasks:** 3/3
- **Files modified:** 5 + regenerated `graphify-out/`

## Accomplishments

- **The cron's rows are now visible without the user knowing anything exists.** `REVIEW_TAB` is seeded into the tab strip on every workspace load, so the review has a permanent home rather than being reachable only by a notification the user might dismiss.
- **The pinned tab cannot be closed by accident or on purpose.** The `×` button and the `has-close` wrapper class are both dropped for that id, and `closeTab` returns early on it as defence in depth. There is no surface that would reopen it, so "hard to close" was not good enough.
- **Typing in the review thread is impossible rather than merely discouraged.** `ChatPane` is not rendered there at all; a one-line explainer routes the user to a new chat instead. The plan's Pitfall 6 (`sendCockpitMessage` throws `"cockpit: plan row missing for thread"`) is therefore unreachable from the UI, and the backend guard that protects every real thread was left alone — a point now written into `cockpit.md` in prose so a future reader does not widen it.
- **A disconnected mailbox does not hide the review.** The review branch precedes the gmail-status branch, so SC#2 holds at the surface as well as in the backend: nothing about the weekly review depends on Gmail.
- **Four additive `EvaluationCard` branches, all review-scoped, with the non-review render byte-identical.** Empty state (only on `null`, never on `undefined` — no flash), dated header, delta line from the persisted row, profile CTA. `CardList` was not restructured, no second query was added, and the card is still a dumb renderer over one `byThread` row.
- **The "what changed" line reads the engine, never re-derives it.** `deltaLine` consumes the persisted `evaluation.delta` verbatim, omits zero terms, and returns `null` when every term is zero — so an on-demand evaluation (no delta) and an unchanged week (all-zero delta) both render nothing rather than a hollow "no change" line. No score, no percentage: the engine emits none and the card does not invent one.
- **The notification click-through is general, not a special case.** `KIND_HREF` is a kind→href map, so every future kind that wants a destination gets one by adding a line; a kind without an entry keeps today's exact plain-text row. Two entries today, both routed over the existing VOIC-04 `?thread=` deep-link — no new route was added.
- **Gates clean.** `pnpm --filter @pikar/web typecheck` exit 0, `node scripts/check-playbooks.mjs` exit 0, backend 494/495 (the sole red is the documented pre-existing `audit.test.ts auditCounts` row — see Issues for the one flaky timeout).

## Task Commits

1. **Task 1: Pinned review tab + composer suppression** — `3931294` (feat)
2. **Task 2: Dated header, delta line, profile CTA, empty state, notification link** — `048a708` (feat)
3. **Task 3: Playbooks, graph refresh, wave gate** — `88e3ffe` (docs)

## Files Created/Modified

- `apps/web/app/(app)/dashboard/workspace/page.tsx` — `REVIEW_THREAD_ID` import + the `REVIEW_TAB` constant; `useState<Tab[]>([REVIEW_TAB])`; the `pinned` branch in the tab-strip `map` (no `×`, no `has-close`); the `closeTab` early return; the review branch ahead of the gmail-status branch rendering the explainer instead of `ChatPane`.
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — the `deltaLine` pure helper; `isReview`; the resolved-null empty state; the dated header prefix; the delta line; the `/dashboard/profile` CTA inside `evaluation-insufficient`.
- `apps/web/app/(app)/_components/NotificationsBanner.tsx` — the `KIND_HREF` map and the `<Link>`/`<span>` branch. Dismiss, the `gmail_reconnect` exclusion, and the `notif-*` classes untouched.
- `docs/playbooks/cockpit.md` — new **Phase 13 — the pinned Weekly review tab (BEVL-03, 13-03)** section (three tab rules incl. the explicit "do not loosen `cockpit.ts:93`" instruction, the four card branches, the branch-order rationale), a manual verification bullet, `Last verified` bumped to 2026-07-25 (3).
- `docs/playbooks/audit-dead-letter.md` — the `KIND_HREF` bullet in the Notification matrix (opt-in per kind, code-owned hrefs, §4 link text, no new route); `Last verified` bumped to 13-03 recording explicitly that the notification PLANE did not change.

## Decisions Made

See `key-decisions` in frontmatter. The two load-bearing ones:

**Suppress the client surface, do not loosen the backend guard.** The review thread throws on send because it has no `plans` row. The tempting "fix" is to make `sendCockpitMessage` tolerate a missing plan row — which would silently remove a guard that protects every real cockpit thread from a plan-less send. The composer is simply not rendered instead, and the playbook now says so in prose at the exact place a future reader would look after hitting the throw.

**The pinned tab is a real `Tab`, not a sibling element.** Seeding it into the same `tabs` array the deep-link handler dedupes against means `?thread=proactive-review` (the notification's destination) needs zero special-casing: `openThread` sees the id is already showing, skips the insert, and just selects it. Rendering the tab beside the strip would have required a second, hand-written dedupe in the mount effect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `KIND_HREF[n.kind]` is `string | undefined` and `next/link`'s `href` is not**

- **Found during:** Task 2
- **Issue:** The plan's inline form `KIND_HREF[n.kind] ? <Link href={KIND_HREF[n.kind]}> : <span>` does not typecheck — TS does not narrow a repeated index access, so `apps/web` failed with `TS2322: Type 'string | undefined' is not assignable to type 'Url'`.
- **Fix:** The `map` callback gained a body (`const href = KIND_HREF[n.kind]; return (…)`) and the JSX branches on the local. Same render, one narrowing binding.
- **Files modified:** `apps/web/app/(app)/_components/NotificationsBanner.tsx`
- **Verification:** `pnpm --filter @pikar/web typecheck` exit 0.
- **Committed in:** `048a708`

**2. [Rule 1 - Bug] `biome check --write` reformatted 740 lines of pre-existing `cards.tsx`, burying the change**

- **Found during:** Task 2
- **Issue:** `cards.tsx` has never been Biome-formatted (it is committed with long lines the formatter wraps), so running `--write` on it produced a 740-line diff around a ~50-line change. That is a review hazard, not a fix — 13-02 hit a milder version of the same thing and recorded it.
- **Fix:** Reverted the file to `HEAD` and re-applied the five edits by hand in the file's existing style (long single-line `style={{…}}` props). Final `cards.tsx` diff: **57 lines**. `NotificationsBanner.tsx` was formatted (its 47-line diff is entirely the arrow-body reindentation, verified by reading the diff).
- **Files modified:** `apps/web/app/(app)/dashboard/workspace/cards.tsx`
- **Committed in:** `048a708`

### Out of scope, deliberately not done

- **Two pre-existing Biome lint errors in `cards.tsx`** (`lint/correctness/useHookAtTopLevel`, `lint/suspicious/noArrayIndexKey`) and **one in `page.tsx`** (`lint/correctness/useExhaustiveDependencies` on the mount effect, which carries an `eslint-disable` comment Biome does not honour). All three confirmed present at `HEAD` by an A/B `git stash` run before/after. Not caused by this plan, not fixed.
- **The pre-existing `--teal-600` small-text links** elsewhere in `EvaluationCard` (the citation links, the "N more" summary) — the same BRAND §6 contrast issue the new CTA avoids. Left alone; a card-wide sweep is not this plan's scope.
- **The pre-existing `audit.test.ts > audit.log inserts exactly one row that round-trips`** failure (auditCounts component not registered) — untouched, still the sole real red.
- **No unread dot / badge** on the review tab — deferred by the plan's own decision; the date in the header is the freshness signal.

---

**Total deviations:** 2 auto-fixed (1 × Rule 1, 1 × Rule 3).
**Impact on plan:** Both are mechanical corrections inside files the plan already owned. No scope creep, no architectural change, no new dependency, no new component.

## Issues Encountered

**One flaky backend timeout in the full-suite run, not a regression.** `pnpm --filter @pikar/backend test` reported 493/495: the documented `audit.test.ts auditCounts` red plus `voice.test.ts > storeBrief drafts via the SMOKE transcript…` failing with `Test timed out in 5000ms`. This plan touched ZERO backend files. Re-run in isolation the file is **8/8 green** with that test at 3588ms — i.e. it sits at ~72% of the 5s budget and tips over when the machine is loaded (the graphify rebuild was running concurrently). Effective baseline is unchanged at **494/495**. The test's own timeout headroom is thin and will keep flaking under load; not raised here because it is outside this plan's scope.

**`apps/web` has no unit-test runner.** Only `@playwright/test` (`test:e2e`). This is why `deltaLine` carries no unit check — see the key-decision. Anything wanting a real assertion on the review card's rendering has to be a Playwright spec, which the plan did not ask for and which needs a running `convex dev` + a seeded review row.

## User Setup Required

None. No new env vars, no schema change, no seed change, no new route. The tab appears on the next load of `/dashboard/workspace`.

To see a populated card immediately instead of waiting for Monday 06:00 UTC:
`npx convex run proactiveReview:runWeekly '{}'` (from `packages/backend`), then reload the workspace and select the "Weekly review" tab. Run it a second time after editing a vault doc to make the delta line appear.

## Next Phase Readiness

Plan 04 can assume:

- **The review surface exists and is reachable three ways:** the always-present pinned tab, `/dashboard/workspace?thread=proactive-review`, and the `weekly_review` notification (now a link).
- **`EvaluationCard` is still one dumb read of one `byThread` row.** Any new review affordance should be another branch inside it, not a second query or a second card — the plan-level constraint "no new card idiom" held and is worth holding.
- **`KIND_HREF` is the extension point for notification click-through.** A new kind that wants a destination adds one line; a kind without an entry keeps plain text. Do NOT reach for `notifications.notify` for review kinds (it arms the mailbox — asserted in `proactiveReview.test.ts`).
- **The composer is suppressed on the review thread only.** If plan 04 wants the user to act from the review, route them to a new chat (what the explainer already says) or extend the existing `Act on this` gap control — do not make the review thread sendable.
- **Do not pre-emptively touch `/dashboard/profile`.** The tier/conversational-onboarding design doc scheduled after Phase 13 rewrites that page; the thin-data CTA only needs the route to keep existing.

## Self-Check: PASSED

- `apps/web/app/(app)/dashboard/workspace/page.tsx` FOUND (contains `REVIEW_THREAD_ID`, `REVIEW_TAB`; `REVIEW_THREAD_ID` precedes `ChatPane` in the left-pane branch)
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` FOUND (contains `REVIEW_THREAD_ID`, `deltaLine`, `evaluation.delta`, `/dashboard/profile`, `evaluation-empty`)
- `apps/web/app/(app)/_components/NotificationsBanner.tsx` FOUND (contains `KIND_HREF`, `weekly_review`, `weekly_review_failed`)
- `docs/playbooks/cockpit.md` FOUND (`Last verified: 2026-07-25 (3)`, new Phase 13 section)
- `docs/playbooks/audit-dead-letter.md` FOUND (`Last verified: 2026-07-25 (13-03)`, `KIND_HREF` bullet)
- Commits FOUND: `3931294`, `048a708`, `88e3ffe`
- Gates: `@pikar/web typecheck` exit 0 · `check-playbooks.mjs` exit 0 · backend 494/495 (sole pre-existing red; one flaky timeout re-verified green in isolation) · no new route, no new component, no component library

---
*Phase: 13-proactive-in-app-review*
*Completed: 2026-07-25*
