---
phase: 19-contacts-crm-follow-ups
plan: 05
subsystem: cockpit-send-path
tags: [contacts, suppression, can-spam, send-path, trust-boundary, footer, counters, brand]
requires:
  - "19-01: @pikar/core normalizeAddress + renderFooter"
  - "19-02: internal.contacts.suppressedAmong / isSuppressed / footerFor"
  - "19-03: tenantProfiles.postalAddress on the write boundary"
  - "19-04: the /unsubscribe/ route the minted footer links to"
provides:
  - "executePlan: the pre-CAS no_postal_address refusal, the pre-join per-address suppression drop, all_recipients_suppressed, and withheld[] on the ok arm"
  - "gmail.send: the per-send suppression backstop (delivered:false, reason:'suppressed') and the CAN-SPAM footer at the buildMime call site"
  - "plans.recordDeliveryTerminal: a third 'suppressed' outcome -> requests.status 'blocked', decrementing recipientTotal"
  - "cards.tsx / ApprovalsView.tsx: both approve surfaces name the two refusals and the withheld report"
affects:
  - "packages/backend/convex/pipeline.ts (the SECOND gmail.send caller — the plan said there was one)"
  - "packages/backend/convex/onboarding.ts (__seedOnboardedTenant now seeds a postal address, or every e2e approve refuses)"
  - "docs/playbooks/cockpit.md, contacts-crm.md, dashboard-pages.md"
  - "19-10 (the UAT that will look at the withheld note and the refusal copy)"
tech-stack:
  added: []
  patterns:
    - "fail-before-mutate: every governed refusal returns above the CAS patch, proven by asserting status === 'proposed'"
    - "guard at the convergence point, not at every caller — but grep the callers first, because there were two"
    - "one note affordance, two tones (error / info) instead of a second error mechanism"
    - "test-harness component registration is opt-in per test, not per file (19-02's fork-crash lesson, re-applied twice)"
key-files:
  created: []
  modified:
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpit.test.ts
    - packages/backend/convex/gmail.ts
    - packages/backend/convex/gmail.test.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/plans.test.ts
    - packages/backend/convex/deliverApprovedPlan.ts
    - packages/backend/convex/pipeline.ts
    - packages/backend/convex/onboarding.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/dashboard/approvals/ApprovalsView.tsx
    - apps/web/app/(app)/dashboard/approvals/approvalsView.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/contacts-crm.md
    - docs/playbooks/dashboard-pages.md
decisions:
  - "The tests live in cockpit.test.ts, not the plan's cockpitTools.test.ts: cockpitTools.test.ts contains ZERO executePlan tests and cockpit.test.ts is the whole executePlan suite, with the harness, the mailbox seeder and the arm regressions the plan told me to extend"
  - "gmail.send has TWO production callers, not the one the plan asserted — pipeline.ts:379 also calls it and would have stranded a suppressed row at `delivering` forever. Guarded there too, with a status patch rather than recordDeliveryTerminal (a pipeline request carries no planId)"
  - "The footer throw names BOTH the tenant's postal address AND UNSUBSCRIBE_SECRET/CONVEX_SITE_URL: footerFor collapses three causes into one null, and an operator told only 'no postal address' would hunt a field that is already set"
  - "__seedOnboardedTenant seeds a postal address — without it every e2e spec that approves an email plan now refuses. Fixed at the one tenant seeder rather than in nine specs"
  - "The withheld report is a NON-error tone on the same note state, never amber (BRAND §2 reserves --held for the approval gate)"
metrics:
  duration: ~2h15m
  tasks: 3
  files: 15
  completed: 2026-08-09
---

# Phase 19 Plan 05: The trust boundary Summary

SC#5 and SC#6 at the two points where they are structurally unbypassable: a per-address suppression
drop that runs before the group join *and* before the CAS patch in `executePlan`, and a per-send
backstop plus the CAN-SPAM footer inside `gmail.send`. Both were needed; the plan's claim that the
send path converges once turned out to be wrong in a second way, and that is the most important
thing in this summary.

## What shipped

### Task 1 — the pre-CAS refusals and the pre-join drop (commit `4fc4941`)

`executePlan`'s workflow arm gained two refusals and one partition, all of them **above the
`proposed → approved` CAS patch**:

- **`no_postal_address`** sits beside the existing `gmail_not_connected` check. One indexed
  `tenantProfiles` read; a whitespace-only address is the same as none. It refuses at the human
  gate, where the missing field is nameable and fixable, instead of letting every recipient's send
  throw at delivery time.
- **The partition**, immediately before `targets` is computed:
  `suppressedAmong → filter → all_recipients_suppressed`. It has to be there and nowhere else —
  `mode === "group"` collapses recipients into ONE comma-joined string on the very next line, after
  which a per-address drop is impossible (`isSuppressed` can only refuse the whole row; the
  `ponytail:` note on it in `contacts.ts` says exactly this).
- **`withheld?: string[]`** on the `ok: true` arm. A partial send is not a refusal. `recipientTotal`
  and `queuedCount` fall out of `targets.length`, which now describes the ALLOWED set by
  construction — the Approvals progress bar cannot promise a fifth delivery that structurally
  cannot happen.

Seven tests in `cockpit.test.ts` (rows 11, 12, 13, 16a, plus the normalize agreement and the
email-only boundary). The group test uses **three** recipients: with two, the joined string contains
the survivor whether or not a drop happened, and the test passes vacuously.

**Mutation-verified.** Moving the suppression guard below the CAS patch turns the row-13 assertion
RED (`expected "proposed", received "approved"`), confirmed and reverted. That is the 20-07 lesson
made enforceable: a refusal after the CAS leaves the plan `approved` with zero `requests` rows and
no workflow — a half-approved state nothing can resume.

### Task 2 — the backstop, the footer, the honest terminal (commit `0bc7c76`)

**The backstop.** `gmail.send` calls `internal.contacts.isSuppressed` immediately after
`getForDelivery`, before `freshAccessToken` — so a suppressed recipient does not even cost a token
refresh. `SendResult`'s non-delivered arm gained `"suppressed"`. The row-14 test is the one that
proves the guard is in the SEND path: a request frozen at approve time with a clean recipient, the
suppression created afterwards, then `gmail.send` — `{ delivered: false, reason: "suppressed" }` and
**zero fetch calls**. The approve-time filter cannot see that; `startScheduledDelivery` re-fires a
`requestIds` list frozen at approve time.

**The footer**, at the `buildMime` CALL SITE. Not inside `buildMime` (`notifyExternal.ts` is a
second caller sending a service notice to the user's own mailbox, and the V4 tests pin `buildMime`'s
zero-attachment bytes — both still green, and a test now asserts the service notice carries neither
the postal address nor an `/unsubscribe/` URL). Not earlier either: the model's output flows
`plans.body → plans.recipientBodies → requests.draft` and `getForDelivery` reads
`editedBody ?? draft`, so every earlier stage is a bypass. `footerFor` returning null is a hard
throw, mirroring the existing missing-attachment-blob precedent.

**The honest terminal (Open Question 3, resolved).** `recordDeliveryTerminal`'s outcome union gained
`"suppressed"`: it patches `requests.status = "blocked"` (an existing member — no new state), the
idempotency early-return now includes `"blocked"`, and `recipientTotal` is DECREMENTED. That is the
truthful statement — the plan now has one fewer recipient, exactly what the approve-time filter
produces. `deliverApprovedPlan` branches on `result.reason === "suppressed"` and leaves every other
`!delivered` reason on the existing `continue` (the resumable `awaiting_reauth` hold is untouched).

### Task 3 — the two approve surfaces and three playbooks (commit `cc58004`)

`cards.tsx`'s `note` became `{ text, tone, href? }` — **one** affordance with two tones, not a second
error mechanism. Refusals render in the file's existing error red with `role="alert"`; the withheld
report renders in `var(--ink-soft)` with `role="status"`, because it reports something that already
succeeded. No amber anywhere: BRAND §2 reserves `--held` for the approval gate and says to spend it
in exactly one place. The `no_postal_address` note carries a `next/link` to `/dashboard/profile`
styled `--teal-900`, not `--teal-600` (BRAND §6 bars teal-600 as small text on white, ~2.9:1).

`ApprovalsView.tsx` is the SECOND approve surface and its `refusalMessage` map has a raw-enum
fallback, so both reasons got real copy there too, plus a `withheldSuffix` helper appended to
whichever success sentence already shows. `approvalsView.test.ts` pins all of it, including the
negative assertion that the raw enum never reaches the screen.

Playbooks: `cockpit.md` (the four invariants the plan asked for), `contacts-crm.md` (new invariant
12 — two guards, two different jobs), `dashboard-pages.md` (the refusal map now needs an entry
whenever a new `executePlan` reason lands).

## Verification

| Check | Result |
|---|---|
| `pnpm test` (full turbo) | **9/9 tasks — backend 72 files / 1383 tests green**, run TWICE |
| `pnpm typecheck` (full turbo) | 10/10 packages, exit 0, delta **0** vs the measured zero baseline |
| `pnpm --filter @pikar/web build` | green |
| `node scripts/check-playbooks.mjs` | exit 0 |
| mutation check: guard moved below the CAS | **1 RED** at `status === "proposed"`, reverted |
| `grep -rn "internal.gmail.send" --include=*.ts \| grep -v test` | **TWO** production hits, not one — see below |
| `biome check` on every touched file | no new diagnostic (ApprovalsView's 6 are pre-existing) |
| `graphify update .` + `extract-convex-edges` | 14398 nodes / 16424 edges, +407 convex edges, +62 table edges |

Backend test counts: 1368 (19-04) → 1383. cockpit.test.ts 50 → 57, gmail.test.ts 36 → 42,
plans.test.ts 18 → 20, approvalsView.test.ts +1.

No codegen was needed — no new Convex module and no schema field landed, so `_generated/api.d.ts` is
untouched.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — bug, and the plan's premise was wrong] `gmail.send` has TWO production callers**
- **Found during:** Task 2, running the convergence grep the plan supplied as a verification step.
- **Issue:** The plan states `deliverApprovedPlan.ts:37` is the SOLE production caller and that
  `grep -rn "internal.gmail.send"` returns 1 hit. It returns three lines: one comment, plus
  `deliverApprovedPlan.ts:37` **and `pipeline.ts:379`**. The pipeline lane's `if (!result.delivered)
  return null` would have stranded a suppressed request at `delivering` forever — the exact defect
  the plan identified for the cockpit lane, in the lane it did not know about.
- **Fix:** `pipeline.ts` branches on `result.reason === "suppressed"` and patches `blocked`. It uses
  the status setter rather than `recordDeliveryTerminal` because a pipeline request carries no
  `planId` and there are no plan counters to move. Recorded in both playbooks with "re-grep before
  claiming convergence".
- **Commit:** `0bc7c76`

**2. [Rule 3 — blocking] `__seedOnboardedTenant` needed a postal address**
- **Found during:** Task 2, tracing who else calls `executePlan` on an email plan.
- **Issue:** Nine e2e specs approve email plans through the harness tenant that
  `onboarding:__seedOnboardedTenant` creates. It writes a `tenantProfiles` row with no
  `postalAddress`, so every one of them would now come back `no_postal_address`. Not caught by any
  gate — e2e needs a live deployment.
- **Fix:** one field at the one tenant seeder, guarded with `existingRow.postalAddress ?? …` so it
  never clobbers a real one. An onboarded tenant that cannot send is not an onboarded tenant.
- **Commit:** `0bc7c76`

**3. [Rule 1 — bug, caused by this plan] The new tests crashed the shared vitest fork — TWICE**
- **Found during:** Task 1 verification, and again at the full-suite gate after Task 3.
- **Issue:** 19-02's exact signature. First pass: `cockpit.test.ts` alone was clean but
  `cockpit + dispatchGuard` produced `ReferenceError: process is not defined` from
  `ForksBaseWorker.executeTests` — baseline was clean over 4 runs, mine flaked 1-in-3. Second pass,
  under `pnpm test`'s concurrent load: **`vaultDigest.test.ts` 8 failures** plus the
  `Cannot set properties of undefined (setting 'exit')` unhandled error, while my own files were
  green. Every added `convexTest` instance is another in-memory backend, and every
  `registerComponent` loads that component's whole module tree into it.
- **Fix, in three steps, each measured:** (a) a local `withFanoutOnly()` in `cockpit.test.ts` that
  registers workflow + workpool and NOT the audit aggregate or the retrier — run time for that file
  halved, 27s → 13s; (b) the tests that never reach `workflow.start` use a plain `convexTest`, and
  the ones that only need request rows and counters arm the scheduler with a future `sendAt` instead
  of starting the fan-out (row 11 deliberately keeps the immediate arm, so the drop is proven on
  both); (c) the two postal-address assertions share one backend. Then the same treatment in
  `gmail.test.ts`: five of the six new tests use a plain `convexTest` because only the successful
  send writes an audit row. Result: two consecutive clean `pnpm test` runs, no Errors line.
- **Commits:** `4fc4941`, `988e24b`

**4. [Rule 2 — missing critical functionality] The Approvals page needed the refusals too**
- The plan names `cards.tsx` only. `ApprovalsView.tsx` is the second surface that calls
  `executePlan`, and its `refusalMessage` has a raw-enum fallback — a user approving from there
  would have read `The governed action refused (no_postal_address)`. Two map entries plus
  `withheldSuffix`, and a test that asserts the raw enum never renders. **Commit:** `cc58004`

**5. [Rule 3] The `recordDeliveryTerminal` site-count test needed updating**
- `cockpit.test.ts` structurally pins `deliverApprovedPlan.ts` to exactly two
  `internal.plans.recordDeliveryTerminal` call sites. There are now three. Updated to 3 with the
  `outcome: "suppressed"` literal added, so the guard keeps its teeth instead of being loosened.

### Judgement calls recorded

**The tests are in `cockpit.test.ts`, not `cockpitTools.test.ts`.** The plan names
`cockpitTools.test.ts` in `files_modified` and in its verify commands. That file contains **zero**
`executePlan` tests; `cockpit.test.ts` is the entire `executePlan` suite — the delivery-component
harness, the mailbox seeder, `listScheduled`, `countRequests`, and the calendar/media/memo arm
regressions the plan explicitly told me to extend rather than duplicate. Writing them in
`cockpitTools.test.ts` would have meant copying ~60 lines of harness to put them in the wrong file.
`pnpm --filter @pikar/backend test -- cockpit` runs both.

**Row 7's regression is a boundary statement, not a copy.** The plan says to extend 20-07's existing
arm regression. The existing calendar and media arm suites already seed no mailbox and no profile,
so they ARE the regression and they stayed green untouched. What was missing was the claim stated as
a claim, so one test asserts the memo arm approves with neither gate satisfied. The parallel calendar
test I first wrote was deleted — it was a verbatim copy of an existing one and cost a
retrier-registered backend.

**`seedMailbox` now seeds the postal address too.** Every email-arm test in `cockpit.test.ts` needs
to pass both pre-CAS gates, so the two gates are seeded at the one helper; the tests that assert a
refusal seed only the other half. The alternative — a second call in twenty tests — is the change
that gets forgotten.

**The footer throw's wording.** The plan's suggested message says "tenant has no postal address".
`footerFor` returns null for three distinct causes (no postal address, unset `UNSUBSCRIBE_SECRET`,
unset `CONVEX_SITE_URL`), and the `executePlan` gate already catches the tenant-fixable one before
approve — so a throw reaching production most likely means the DEPLOYMENT is misconfigured. The
message names all three. This is the carried-forward instruction "make its failure mode legible
rather than silent", and it is why no second env guard was added anywhere (invariant 8 stands).

## Notes for the next plans

- **A hosted deployment still has no `UNSUBSCRIBE_SECRET`.** It is now load-bearing for SENDING, not
  just for links: unset ⇒ `footerFor` returns null ⇒ `gmail.send` throws ⇒ the retrier dead-letters
  the row. The throw text names the variable, which is the only reason this will be diagnosable.
- **19-10 (UAT):** three new strings have never been seen by a human — the withheld note on the
  cockpit plan card, the `no_postal_address` note with its profile link, and the
  `all_recipients_suppressed` note. The withheld note is the SC#5 deliverable; check that it reads
  as information rather than as a failure.
- **The e2e specs have not been run.** They need a live deployment. `__seedOnboardedTenant` now
  seeds a postal address, which should keep every approve assertion green, but that is reasoned, not
  observed.
- **`gmail.send` has two callers.** Anything that adds a new `SendResult` reason must handle it in
  BOTH `deliverApprovedPlan.ts` and `pipeline.ts`, or one lane strands its rows.
- **Test-harness discipline:** `convexTest` instances are not free and `registerComponent` is much
  less free. Register per TEST, not per file. This cost two rounds of debugging in this plan and a
  whole task in 19-02.
- `graphify-out/*` was dirty from a prior session throughout and is in NONE of these commits. All
  four commits use the pathspec form.

## Self-Check: PASSED

- `packages/backend/convex/cockpit.ts` — FOUND (`no_postal_address`, `all_recipients_suppressed`, `suppressedAmong` all present)
- `packages/backend/convex/gmail.ts` — FOUND (`internal.contacts.isSuppressed` + `internal.contacts.footerFor` present)
- `packages/backend/convex/plans.ts` — FOUND (`v.literal("suppressed")` present)
- `packages/backend/convex/deliverApprovedPlan.ts` — FOUND (3 `recordDeliveryTerminal` sites)
- `packages/backend/convex/pipeline.ts` — FOUND (the `suppressed` branch)
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — FOUND (`no_postal_address` present)
- `docs/playbooks/cockpit.md` / `contacts-crm.md` / `dashboard-pages.md` — FOUND (`19-05` in all three, `check-playbooks.mjs` exit 0)
- commits `4fc4941`, `0bc7c76`, `cc58004`, `988e24b` — all FOUND in `git log`
