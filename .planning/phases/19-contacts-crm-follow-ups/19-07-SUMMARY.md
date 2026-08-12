---
phase: 19-contacts-crm-follow-ups
plan: 07
subsystem: contacts-crm
tags: [pipeline, dashboard-page, bounded-read, always-known-counts, brand, e2e-authored, pipe-01]
requires:
  - "19-02: the contacts/followUps/suppressions person store these reads sit on"
  - "19-06: crm_write, so an agent-approved plan has a surface that reflects it"
  - "26-01: packages/core/src/dashboard.ts — createDashboardBound / compareDashboardOrder / cursor / DASHBOARD_STATE_COPY"
provides:
  - "convex/contacts.ts: the module's FIRST three public reads — pipelineTiles, listContacts, listUnassignedFollowUps"
  - "apps/web/app/(app)/dashboard/pipeline/ — page.tsx + PipelineView.tsx + pipelineView.test.ts (17 tests)"
  - "apps/web/e2e/pipeline.spec.ts — AUTHORED, two tests, NEVER EXECUTED"
  - "contacts-crm.md invariants 14 (last-touch ceiling) and 15 (the nav stays soon)"
affects:
  - "docs/playbooks/contacts-crm.md, dashboard-pages.md, cockpit.md"
  - "19-10 (runs the e2e spec and eyeballs the page)"
  - "26-18 (owns flipping the nav href; deliberately NOT done here)"
tech-stack:
  added: []
  patterns:
    - "a connected route with NO adapter module of its own — the read models live in the substrate module (PIPE-01)"
    - "bounded scan + in-memory compareDashboardOrder sort + v1 cursor, instead of a hand-rolled limit/offset"
    - "ALWAYS-KNOWN counts: a real zero renders as 0, and the ABSENCE of a hedge is what the test asserts"
    - "uncontrolled <form> + FormData + native <input type=\"date\"> instead of component state and a picker dep"
    - "source scans over a COMMENT-STRIPPED component, so gravestone comments can name what is absent"
key-files:
  created:
    - apps/web/app/(app)/dashboard/pipeline/page.tsx
    - apps/web/app/(app)/dashboard/pipeline/PipelineView.tsx
    - apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts
    - apps/web/e2e/pipeline.spec.ts
  modified:
    - packages/backend/convex/contacts.ts
    - packages/backend/convex/contacts.test.ts
    - docs/playbooks/contacts-crm.md
    - docs/playbooks/dashboard-pages.md
    - docs/playbooks/cockpit.md
decisions:
  - "No opportunities table, no stage enum, no amountCents — the 19-02 structural scan was NOT weakened and now covers 293 more lines of contacts.ts; the page carries the same scan in its own test over a comment-stripped source"
  - "lastTouchAt is DERIVED at read time (one bounded requests fold + the newest completedAt), never a denormalized field: that would be a write-path obligation this phase does not otherwise have"
  - "The tiles return four plain numbers and no `partial` flag. A bound on a tile invites hedging on the one page whose invariant is 'never hedge'; the row cap is a ponytail ceiling in a comment instead"
  - "NO e2e reset seam in contacts.ts. A deletion path in the phase's most governed module, for a spec that has never run, is speculative — the empty-tenant precondition is stated in the spec header instead, with the seam named as the upgrade path"
  - "The playbooks are LF in this working tree, not CRLF as STATE/memory claim — the CRLF-safe insert had to be undone"
metrics:
  duration: ~1h 5min
  tasks: 3
  files: 9
  completed: 2026-08-09
---

# Phase 19 Plan 07: The connected Pipeline route Summary

`/dashboard/pipeline` is a connected, tenant-safe, bounded page over the ONE Phase-19 substrate —
four always-known counts, a five-column contact table, a contactless-follow-ups section beneath it
and three row actions — that introduces **no backing store, no opportunity, no deal state and no
monetary value**, and whose nav item is deliberately still `soon: true`.

## What shipped

### Task 1 — the three read models (`e32f0b7` RED, `efc6dd4` GREEN)

`packages/backend/convex/contacts.ts` grew from 545 to 838 lines and gained its **first public
reads**. 19-02 recorded "there are deliberately NO public reads here yet — the Pipeline page's reads
land with the page"; they landed, in this same module, which is PIPE-01 satisfied by construction
rather than by promise.

- **`pipelineTiles()`** — `{needingAttention, followUpsDue, consentOnRecord, suppressed}`, four plain
  numbers. `needingAttention` uses `@pikar/core`'s `needsAttention` (contacts with NO open follow-up
  — complementary to the due tile, so two adjacent tiles cannot report the same fact); `followUpsDue`
  uses `followUpIsDue` and counts **contactless follow-ups too**, one honest total; `consentOnRecord`
  counts a real `consentAt` and nothing is defaulted to consented.
- **`listContacts({cursor?, limit?})`** — newest-first rows carrying `contactId`, `email`,
  `name|null`, `origin`, `lastTouchAt|null`, `nextStep|null`, `consent|null` and `suppressed` (the
  `contacts.unsubscribedAt` DISPLAY MIRROR, never the guard). Bounded by `createDashboardBound`,
  ordered by `compareDashboardOrder`, paged with `dashboardCursorFor`/`parseDashboardCursor`.
- **`listUnassignedFollowUps({cursor?, limit?})`** — open follow-ups with no `contactId`, same shape.

**Open Question 4, resolved.** `lastTouchAt` is the newer of (the newest DELIVERED send to that
address, from ONE bounded `requests` read through `by_tenant_status_createdAt` folded in memory
against `recipientMembers` — so a comma-joined group send counts for every member) and (the newest
`completedAt` on that contact's follow-ups). No denormalized field. The `ponytail:` note names the
1 000-row ceiling and the upgrade path (`recordDeliveryTerminal` + `setFollowUpStatus`, both, or the
field lies).

`pageBounded` is the one paging helper: bounded scan → `compareDashboardOrder` sort → cursor slice →
`createDashboardBound`. The in-memory sort is what makes createdAt TIE handling exact — and ties are
not hypothetical, `convex-test` creates several contacts inside one millisecond.

`contacts.test.ts` went **40 → 62 tests**: three new isolation cases in the `asA`/`asB` block, the
empty-tenant four-zeroes assertion (by value AND by `typeof`), the complementarity of
`needingAttention`, the contactless total, the consent count, the short-page/long-page bound pair,
the cursor round-trip with disjoint pages, `lastTouchAt`'s max-of-two, `nextStep`'s soonest-open, and
the unassigned pair. The public export-set pin grew by three, so a fourth read added without an
isolation test fails there.

### Task 2 — the route (`351e599` RED, `7f28c8f` GREEN)

`page.tsx` is five lines; `PipelineView.tsx` is `"use client"` and holds the page; every section owns
its own `useQuery` (asserted: exactly three `useQuery(api.contacts.` call sites).

- **Four tiles** on the REAL classes (`stat-grid`/`stat-tile`/`stat-head`/`stat-value`/`caps-label`),
  in mockup order. A real zero renders as `0`; `resolveDashboardWindow` is deliberately not imported
  because these are not windowed.
- **Five columns + actions**, inline `CSSProperties` over `var(--card)`/`--rule`/`--ink`/`--ink-soft`.
  **No `<table class="ledger">`** — that class IS defined and is the dark marketing audit block.
  Chips carry teal in the FILL (`color-mix(in srgb, var(--teal-400) 30%, var(--card))`) with `--ink`
  labels (BRAND §6 bans `--teal-600` as small text). **Zero `--held`.**
- **Contactless follow-ups get their own section beneath the table**, never an em-dash row inside it.
- **Row actions: read + mark suppressed + add follow-up.** Un-suppressing arms, states that
  re-subscribing without fresh consent is the user's responsibility, then commits — the sentence the
  backend's `acknowledged: true` actually means. **No `window.confirm` anywhere.**
- Page-state prose comes from `DASHBOARD_STATE_COPY`; the add-contact and add-follow-up forms are
  uncontrolled `<form>` + `FormData` + a native `<input type="date">` (no state, no picker dep).

`pipelineView.test.ts` — **17 tests, `.test.ts` not `.test.tsx`** — pins all of it, including the
four-zeroes count as `">0<"` exactly four times **and** the explicit absence of `—`/`Unknown`.

### Task 3 — the browser gate and the playbooks (`ead5eff`)

`apps/web/e2e/pipeline.spec.ts`: two `--list`-discoverable tests, `serial`, empty-tenant first. Its
header states in the file that it has **NEVER EXECUTED**, that a `--list` is not a run, that a blank
result means NOT RUN, and exactly what a real run needs (live `convex dev`, Next on `:3111`, the two
credentials an executor cannot mint) plus the verbatim resume command. Three playbooks bumped;
`check-playbooks.mjs` exits 0.

## Verification

| Check | Result |
|---|---|
| `pnpm test` (full turbo) | **9/9 tasks** — backend **72 files / 1405 tests** (1391 → 1405), web **122** (105 → 122), core 697, all green |
| `pnpm typecheck` (full turbo) | **10/10, exit 0**, delta 0 |
| `pnpm --filter @pikar/web test -- pipelineView` | **17/17** — a NON-ZERO count, so the file was not silently skipped |
| `pnpm --filter @pikar/backend test -- contacts` | 62/62 in `contacts.test.ts` (rows 9, 20, 21 all still green) |
| `pnpm --filter @pikar/web build` | green — `/dashboard/pipeline` is in the route table |
| `playwright test --list e2e/pipeline.spec.ts` | 2 tests + the setup project. **A LIST IS NOT A RUN.** |
| `node scripts/check-playbooks.mjs` | exit 0 |
| nav guard (`layout.tsx` has no `/dashboard/pipeline`) | `nav ok` |
| forbidden-word grep over the route dir | only the deliberate gravestone comment + the test's own regex |
| `biome check` on all touched files | clean |
| `graphify update .` + `extract-convex-edges` | 14677 nodes / 16728 edges, +414 convex edges, +62 table edges |

**RED was real.** The backend tests failed 15/15 before the implementation existed; the component
test failed at collection (`Failed to load url ./PipelineView`). Both were committed red.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — bug in my own fixture] The `lastTouchAt` max was untestable as written**
- **Found during:** Task 1's first GREEN run (1 failure of 62).
- **Issue:** `setFollowUpStatus` stamps `completedAt` at `Date.now()`, so in a fixture *every*
  completion is newer than *every* seeded send and the `Math.max` branch that picks the SEND could
  never be exercised. The test asserted a value it could not produce.
- **Fix:** the "old" completion is aged by hand (`ctx.db.patch(oldTouch, {completedAt: now-900_000})`)
  so one contact resolves to its send and the other to its completion — the max is now tested in
  both directions.
- **Commit:** `efc6dd4`

**2. [Rule 3 — blocking] The page's source scans had to strip comments**
- **Found during:** Task 2's first GREEN run (3 failures).
- **Issue:** the scans for `window.confirm`, `--held` and `/amountCents|opportunit|\bstage\b/` all hit
  the file's own **gravestone comments** explaining why those things are absent. A scan that punishes
  its own documentation forces the absence to go unexplained.
- **Fix:** the same `stripComments` rule `contacts.test.ts` already uses (19-02), plus a non-vacuity
  floor (the source must load at >4 000 chars and the regex must be shown to match a real violation).
- **Commit:** `7f28c8f`

**3. [Rule 3 — blocking] `docs/playbooks/*.md` are LF in this tree, not CRLF**
- **Found during:** Task 3.
- **Issue:** STATE.md and the standing memory note say the playbooks are CRLF, so the bump script
  joined inserted blocks with `\r\n`. A byte count afterwards showed the three files held **zero**
  `\r` before the edit (contacts-crm 0/379 lines, dashboard-pages 0/645, cockpit 0/2266) — the CRs
  were all mine, and the files would have shipped with mixed endings.
- **Fix:** stripped every `\r` from the three files and re-verified 0. **The single-line-anchor rule
  still held and is still worth keeping** — it is what made the eight edits assert-unique — but the
  line-ending half of that note is wrong for these files today.
- **Commit:** `ead5eff`

### Judgement calls recorded

**No e2e reset seam.** The empty-tenant test needs a tenant with no contacts, and the obvious fix is
a `__`-prefixed `internalMutation` in `contacts.ts` that clears the tenant's rows. It was
deliberately NOT built: a deletion path in the phase's most governed module (export-set pins, a
structural scan, ten playbook invariants) for a spec that has never executed is speculative. The
precondition is stated plainly in the spec header, and the seam is named there as the upgrade path if
19-10 finds it annoying.

**The tiles return four plain numbers, with no `partial` flag.** A bound on a tile is an invitation to
hedge, on the one page whose invariant is "never hedge". The 1 000-row scan cap is a `ponytail:`
comment naming the ceiling instead.

**The plan's "eight sites" claims were checked, not trusted.** The interfaces block was verified
against source: `.ledger` really is the dark landing-page block (`globals.css:398`), only the five
`stat-*` classes plus `caps-label` exist, `requests.by_tenant_status_createdAt` exists, the nav
comment at `layout.tsx:43-46` says what the plan quotes, and `apps/web/vitest.config.mts` really does
include `app/**/*.test.ts` only. One thing the plan got wrong is recorded above (deviation 3).

**`note`, not `title`.** `createFollowUp` takes `note` (19-01's schema field); the plan text's `title`
pre-dates it, the same correction 19-02 and 19-06 both recorded.

**No codegen needed and none run.** New functions on an EXISTING module do not change
`_generated/api.d.ts` (`ApiFromModules` is derived from the module's types) — 19-06 measured the same
thing. `git status` over `packages/` is clean.

## Notes for the next plans

- **19-10 owes this page three things.** (1) RUN `e2e/pipeline.spec.ts` — it has never executed, and
  its first test needs a tenant with no contacts. (2) Eyeball the BRAND conformance of a page no
  human has seen: the tile row, the chip fills, the un-suppress armed sentence, the empty state. (3)
  Confirm that a `crm_write` plan reaching `done` is visible HERE — 19-06 deliberately ships no chat
  receipt, and its note says "if UAT reads that as nothing happened, the fix is the Pipeline page".
  It now exists.
- **26-18 owns the nav.** Adding `href: "/dashboard/pipeline"` to `NAV` is the whole activation.
  `contacts-crm.md` invariant 15 and the e2e spec's last assertion both guard against doing it by
  accident.
- **`listContacts` is the read that grows first.** It runs one `by_tenant_contact` query per PAGE row
  (≤ 25) plus one `requests` fold. If the Pipeline ever feels slow, the requests fold is the first
  suspect and invariant 14 names its upgrade path.
- **`ROADMAP.md` is hand-ticked but NOT committed** — it still mixes the concurrent phase-25 lane's
  uncommitted lines. 19-10 reconciles it. No phase-25 file was touched, and `graphify-out/*` is in
  no commit.
- **No `gsd-tools state *` subcommand was run.** Every one clobbers this project's STATE.md
  frontmatter. Hand-edited.

## Self-Check: PASSED

- `packages/backend/convex/contacts.ts` — FOUND (838 lines; `pipelineTiles`, `listContacts`, `listUnassignedFollowUps` present)
- `packages/backend/convex/contacts.test.ts` — FOUND (1221 lines, 62 tests)
- `apps/web/app/(app)/dashboard/pipeline/page.tsx` — FOUND (5 lines)
- `apps/web/app/(app)/dashboard/pipeline/PipelineView.tsx` — FOUND (739 lines, well over the 200 floor)
- `apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` — FOUND (201 lines, 17 tests, `.test.ts`)
- `apps/web/e2e/pipeline.spec.ts` — FOUND (135 lines, 2 tests, header contains `NOT RUN`)
- `docs/playbooks/contacts-crm.md` / `dashboard-pages.md` / `cockpit.md` — FOUND (`19-07` in all three; `check-playbooks.mjs` exit 0)
- commits `e32f0b7`, `efc6dd4`, `351e599`, `7f28c8f`, `ead5eff` — all FOUND in `git log`
