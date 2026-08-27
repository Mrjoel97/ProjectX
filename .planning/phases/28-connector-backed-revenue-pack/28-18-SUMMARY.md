---
phase: 28-connector-backed-revenue-pack
plan: 18
subsystem: infra
tags: [playbooks, watch-json, governance, stop-hook, ownership-matrix, parallel-lanes]

# Dependency graph
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: 28-17's sealed readiness gate (scripts/check-phase28-readiness.mjs, exit 0) — run first, exit 0 observed
  - phase: 27-curated-knowledge-work-pack-pilot
    provides: workflowPackEvents + core/workflowPackMetrics.ts event contract, static grant / leaf-agent constraint
  - phase: 19-contacts-crm-followups
    provides: convex/contacts.ts as the ONLY person/consent/suppression/follow-up store
provides:
  - "Seven playbooks covering every Phase 28 subsystem, authored before the code so parallel lanes never contend for one doc"
  - "40 watch.json prefixes across 7 new entries — mechanically proven 0 collisions, 0 uncovered Phase 28 source paths"
  - "Release semantics table: lane passed / lane parked / subset release / phase complete are four distinct states"
  - "A per-provider rollback path (park the lane) and a whole-phase one (re-block the readiness attestation)"
  - "Empirical confirmation that scripts/check-playbooks.mjs signals ONLY on stdout and exits 0 either way"
affects: [28-02, 28-03, 28-04, 28-05, 28-06, 28-07, 28-08, 28-09, 28-10, 28-11, 28-12, 28-13, 28-15, 28-16, 28-21, 28-26, 28-29]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Register watch ownership BEFORE the parallel lanes write, not after — an ownership plan is cheap, a doc merge conflict across 8 lanes is not"
    - "Prove a hook is load-bearing by observing it RED on a real probe, asserting its stdout marker, never its exit code"
    - "Programmatic prefix-overlap proof (startsWith both directions) rather than eyeballing a 380-line JSON map"
    - "[PLANNED] markers on unbuilt sections so a playbook written ahead of code cannot be misread as landed behaviour"

key-files:
  created:
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/connector-hubspot.md
    - docs/playbooks/connector-quickbooks.md
    - docs/playbooks/connector-stripe.md
    - docs/playbooks/connector-paypal.md
    - docs/playbooks/revenue-crm.md
    - docs/playbooks/revenue-finance.md
  modified:
    - docs/playbooks/watch.json

key-decisions:
  - "Removed packages/revenue/ from watch._unassigned — 28-02 parked it there with the commit message '28-18 owns the playbook'; leaving it would keep claiming those paths need no playbook"
  - "Followed each downstream plan's DECLARED playbook target when assigning prefixes, so no plan is forced to update a doc it does not own — this, not taxonomy, is what makes collisions zero"
  - "Invoice reminders (packages/revenue/src/reminders*, convex/invoiceReminders*) went to revenue-connectors.md rather than revenue-finance.md because 28-13 declares revenue-connectors.md"
  - "Did NOT claim packages/backend/convex/schema.ts, http.ts, specialists.ts, contracts/src/skill.ts, dashboard/profile/ or dashboard/workspace/ — all already owned by other playbooks; the cross-lane touches are documented instead"
  - "Every unbuilt section is marked [PLANNED] with an explicit status block; a playbook that reads as landed is worse than no playbook"
  - "requirements-completed is EMPTY — this plan registers ownership and implements none of REVN-01..06, despite the plan frontmatter listing all six"

patterns-established:
  - "Ownership-registration plan: a phase with N parallel lanes gets its playbook/watch map committed in one early wave-2 plan"
  - "Seven simultaneous probe files, one per lane, assert that each entry names ONLY its own owner — proves the assignment, not merely that the hook fires"

requirements-completed: []

# Metrics
duration: 33min
completed: 2026-08-27
---

# Phase 28 Plan 18: Playbook and Watch Ownership Summary

**Seven Phase 28 playbooks and 40 watch.json prefixes registered before the parallel lanes start writing — with the ownership proven load-bearing by watching the Stop hook go red on all seven, never by trusting its exit code, which is 0 either way.**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-08-27T14:15Z
- **Completed:** 2026-08-27T14:48Z
- **Tasks:** 1 of 1
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- **Zero-collision ownership across 8 parallel lanes.** 40 prefixes in 7 new `watch.json` entries.
  A script checked every pair of prefixes in the whole file in both directions (`startsWith` is how
  the hook matches) and reported **0 Phase-28 collisions** and **0 uncovered Phase 28 source paths**
  against a 31-path must-cover list drawn from every 28-xx plan's `files_modified`.
- **The hook was observed RED, seven times, one per lane.** Seven probe files were created at once
  under seven newly-registered prefixes with no playbook touched; the checker named exactly the
  right owner for each and cross-named none. It also swept up 28-02's *real* in-flight
  `packages/revenue/src/money.ts`, `money.test.ts`, `finance.ts`, `finance.test.ts` under
  `revenue-finance.md` and `src/index.ts` under `revenue-connectors.md` — the registration is
  already doing work on live code, not just on synthetic probes.
- **Release semantics made operationally explicit**, which was the phase context's sharpest
  requirement: `lane passed`, `lane parked`, `subset release` and `phase complete` are four distinct
  states in a table, with who decides each and what it permits. A subset release is explicitly **not**
  phase completion; REVN-01/02/03 need *every* named provider `passed`.
- **Each provider playbook leads with its real admission blocker**, so a lane cannot start by
  accident: HubSpot's AI-connector Marketplace classification, QuickBooks' data-category scope plus
  production self-assessment, Stripe's Extension-only `read_only` eligibility, PayPal's partner
  status (and the trap that ordinary client credentials read the *app's own* merchant, which would
  serve one merchant's figures to every tenant while every unit test stayed green).
- **`_unassigned` shrunk rather than grew.** The one Phase 28 acknowledgment was retired.

## Task Commits

1. **Task 1: Create non-overlapping shared and lane playbooks** — `1cdfef4` (docs)

No plan-metadata commit was needed beyond the state/summary commit; see below.

## Files Created/Modified

- `docs/playbooks/revenue-connectors.md` — the shared spine: credential envelope, one-time OAuth
  state, bounded fetch, connections surface, `providerGates`, revenue tools, telemetry,
  invoice-reminder containment, 11 invariants, the release-semantics table, rollback paths, and the
  `check-playbooks.mjs` stdout gotcha.
- `docs/playbooks/connector-hubspot.md` — REVN-01. No-second-CRM, read-scopes-only, **current**
  revoke endpoint (the legacy delete did not invalidate access tokens, so "disconnect" would lie).
- `docs/playbooks/connector-quickbooks.md` — REVN-02. Rotating-refresh lease/CAS (concurrent refresh
  can permanently invalidate a connection), compile-time GET/query/report allow-list, realm binding.
- `docs/playbooks/connector-stripe.md` — REVN-03. Extension gate, pinned API version, the explicit
  list of verbs the module must never export, and the naming split from Pikar's own billing surface.
- `docs/playbooks/connector-paypal.md` — REVN-03. Per-merchant binding as the invariant that
  separates a tenant grant from the app's own account; sandbox proves parsing and nothing else.
- `docs/playbooks/revenue-crm.md` — REVN-04. No second person/pipeline store, never substitute an
  unmatched name, suppression stays Phase 19's two checks (do not add a third), no fictional
  opportunities, untrusted third-party text stays out of the tool-bearing loop.
- `docs/playbooks/revenue-finance.md` — REVN-05. Integer minor units, never parse a provider decimal
  with binary float, `mixed_currency` over silent combination, source authority to stop
  QuickBooks/Stripe double-counting, missing is unknown never zero, confidence is a coverage label
  derived from the landed `FINANCE_CONFIDENCES` set, the LLM explains and does not compute.
- `docs/playbooks/watch.json` — 7 entries / 40 prefixes added; `packages/revenue/` removed from
  `_unassigned`.

## The ownership matrix

| Playbook | Owns (prefixes) | Written by plans |
|---|---|---|
| `revenue-connectors.md` | `packages/revenue/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/contracts,src/credential,src/reminders}`, `convex/{connector,providerGates,revenueTools,revenueTelemetry,invoiceReminders}`, `scripts/check-phase28-{readiness,completion}.mjs`, `scripts/check-provider-lane.mjs`, `docs/connectors/{README,phase28-readiness}.md` | 28-02, 28-03, 28-04, 28-09, 28-12, 28-13, 28-15, 28-16, 28-17, 28-20, 28-26, 28-27 |
| `connector-hubspot.md` | `packages/revenue/src/providers/hubspot`, `convex/hubspot`, `scripts/smoke-hubspot-read.mjs`, `docs/connectors/hubspot-suitability.md` | 28-01, 28-05, 28-22 |
| `connector-quickbooks.md` | `…/providers/quickbooks`, `convex/quickbooks`, `scripts/smoke-quickbooks-read.mjs`, `docs/connectors/quickbooks-suitability.md` | 28-01, 28-06, 28-23, 28-29 |
| `connector-stripe.md` | `…/providers/stripe`, `convex/stripeAuth`, `convex/stripeConnector`, `scripts/smoke-stripe-read.mjs`, `docs/connectors/stripe-suitability.md` | 28-01, 28-07, 28-24, 28-29 |
| `connector-paypal.md` | `…/providers/paypal`, `convex/paypalAuth`, `convex/paypalConnector`, `scripts/smoke-paypal-read.mjs`, `docs/connectors/paypal-suitability.md` | 28-01, 28-08, 28-25, 28-29 |
| `revenue-crm.md` | `packages/revenue/src/crm`, `convex/revenueCrm` | 28-10, 28-21 |
| `revenue-finance.md` | `packages/revenue/src/money`, `packages/revenue/src/finance`, `convex/revenueFinance` | 28-02, 28-11, 28-21 |

**Deliberately NOT claimed** (already owned; the touching plan must bump the *existing* playbook):

| Path | Existing owner | Plans that touch it |
|---|---|---|
| `convex/http.ts`, `convex/llm.ts`, `convex/cockpitTools.test.ts`, `dashboard/workspace/`, `apps/web/e2e/` | `cockpit.md` | 28-09, 28-12, 28-13, 28-16, 28-29 |
| `dashboard/profile/` | `onboarding.md` | 28-09 |
| `packages/core/src/specialists.ts` | `growth-diagnostic.md` | 28-12 |
| `packages/contracts/src/skill.ts`, `packages/contracts/skills/`, `packages/backend/convex/skills.ts` | `skill-registry.md` | 28-12, 28-14, 28-20, 28-28 |
| `convex/opsSignals.ts`, `packages/backend/scripts/eval-cases/`, `run-eval-golden.mjs` | `agent-runtime.md` | 28-15, 28-19 |
| `convex/contacts.ts` | `contacts-crm.md` | read-only consumer |

## Decisions Made

1. **Assign prefixes by each plan's declared playbook target, not by taxonomy.** 28-13's invoice
   reminders are conceptually finance, but 28-13 declares `revenue-connectors.md`; following the
   declaration is what makes the collision count zero in practice rather than on paper.
2. **Retire `_unassigned: packages/revenue/`.** 28-02's own commit message says "28-18 owns the
   playbook" — this is the completion of a deliberate handoff, not a fight with a parallel lane.
3. **Do not annex other playbooks' files to make Phase 28 self-contained.** `http.ts` belongs to
   `cockpit.md`; taking it would create exactly the two-owner collision this plan exists to prevent.
   The cross-lane touches are documented in `revenue-connectors.md` → Operational notes instead.
4. **Mark every unbuilt section `[PLANNED]` and say so at the top of each file.** A playbook written
   ahead of its code is the ideal shape for a confidently-misleading document; the status block and
   the markers are the mitigation.
5. **`requirements-completed: []`.** The plan frontmatter lists REVN-01..06, but this plan implements
   none of them — it registers who will. `requirements mark-complete` was deliberately not called.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `_unassigned` had grown to cover `packages/revenue/` mid-flight**

- **Found during:** Task 1, at the overlap-proof step.
- **Issue:** Between reading `watch.json` and writing it, 28-02 committed `d963bf3`, adding
  `"packages/revenue/"` to `watch._unassigned`. My overlap check refused to write (exit 1) because
  every new `packages/revenue/*` prefix contradicted an acknowledgment that those paths need no
  playbook. Registering ownership on top of the acknowledgment would have left the file asserting
  both things at once.
- **Fix:** Removed `packages/revenue/` from `_unassigned` in the same edit. 28-02's commit message
  explicitly designates 28-18 as the playbook owner, so this completes an intended handoff.
- **Files modified:** `docs/playbooks/watch.json`
- **Verification:** Re-ran the overlap proof — 0 Phase-28 collisions, 0 uncovered paths, `_unassigned`
  back to its single pre-Phase-28 entry.
- **Committed in:** `1cdfef4`

**2. [Rule 1 - Bug] Two playbooks described `packages/revenue` as non-existent after it landed**

- **Found during:** Task 1, immediately after discovering `d963bf3`.
- **Issue:** `revenue-connectors.md` and `revenue-finance.md` were drafted stating that no
  `packages/revenue` code existed, and marked `contracts.ts` `[PLANNED]`. 28-02 had already landed
  the package and the frozen contracts, so both status blocks were false at the moment of writing —
  the precise failure mode ("a playbook that reads as landed") inverted.
- **Fix:** Read the landed exports and rewrote both status blocks and the `contracts.ts` entry from
  the actual file. Also corrected `revenue-finance.md`: the `Money` **type** lives in the landed
  `contracts.ts` (owned by `revenue-connectors.md`), so `money.ts` owns the arithmetic, not the
  shape; and the confidence invariant now points at the landed `FINANCE_CONFIDENCES` closed set to
  derive from rather than retype.
- **Files modified:** `docs/playbooks/revenue-connectors.md`, `docs/playbooks/revenue-finance.md`
- **Verification:** `git show HEAD:docs/playbooks/…` read back; exports cross-checked against
  `packages/revenue/src/contracts.ts`.
- **Committed in:** `1cdfef4`

**3. [Rule 3 - Blocking] `watch.json` formatting rejected by Biome after programmatic rewrite**

- **Found during:** Task 1, pre-commit.
- **Issue:** `JSON.stringify(_, null, 2)` always expands arrays, so two single-element entries
  (`_unassigned`, `tracing.md`) were reflowed and Biome's formatter flagged the file. Left alone it
  would have been reverted by the next `biome check --write` and shown as churn.
- **Fix:** `npx biome check --write docs/playbooks/watch.json`, then re-checked **without a pipe**
  (a piped exit code reads the pipe's, not the gate's). CRLF was preserved: 378/378 lines.
- **Files modified:** `docs/playbooks/watch.json`
- **Verification:** Re-check clean; diff reduced to 52 insertions / 1 deletion; overlap proof re-run
  after the reformat and still 0/0.
- **Committed in:** `1cdfef4`

**4. [Rule 1 - Bug] My own commit message stated the wrong prefix count**

- **Found during:** Post-commit verification of the commit object.
- **Issue:** The message claimed "32 registered prefixes"; the real count is 40.
- **Fix:** `git commit --amend` with the corrected figure (`4b2d1e8` → `1cdfef4`).
- **Verification:** `git show HEAD:docs/playbooks/watch.json` counted 40 from the commit, not the tree.

---

**Total deviations:** 4 auto-fixed (2× Rule 3 blocking, 2× Rule 1 bug)
**Impact on plan:** None on scope. Two were caused by a parallel lane landing mid-execution, one by a
formatter, one by my own arithmetic. No files outside the plan's `files_modified` were changed.

## Issues Encountered

### The verification command the plan specified is a no-op

The plan's `<verify><automated>node scripts/check-playbooks.mjs</automated></verify>` cannot verify
anything, for two independent reasons, both confirmed empirically here:

1. **It reads its input from stdin (`readFileSync(0, …)`), so run bare it blocks forever.** It was
   never run bare.
2. **It always exits 0.** Its violation signal is a JSON object printed on **stdout**:
   `{"decision":"block","reason":…}`. Measured directly:

   | Run | stdout | exit |
   |---|---|---|
   | control (clean tree, no probe) | *empty* | **0** |
   | one probe under `packages/backend/convex/connector` | `{"decision":"block", … revenue-connectors.md …}` | **0** |
   | seven probes, one per lane | `{"decision":"block", … all 7 playbooks …}` | **0** |

   A green exit code is returned in the violating case and the clean case alike.

**This is a real finding, not a failure of this plan**, and it matches the repo's recorded defect. It
is now written into `revenue-connectors.md` → Operational notes so the next lane does not re-learn it:
verify with `echo '{}' | node scripts/check-playbooks.mjs check` and grep **stdout** for
`"decision":"block"`.

The load-bearing proof therefore used stdout, and used *observation of red* rather than absence of
red. Full seven-lane result:

```
- docs/playbooks/revenue-connectors.md   (changed: packages/revenue/src/index.ts, .../connectorWatchProbe.ts)
- docs/playbooks/connector-hubspot.md    (changed: .../hubspotWatchProbe.ts)
- docs/playbooks/connector-quickbooks.md (changed: .../quickbooksWatchProbe.ts)
- docs/playbooks/connector-stripe.md     (changed: .../stripeConnectorWatchProbe.ts)
- docs/playbooks/connector-paypal.md     (changed: .../paypalConnectorWatchProbe.ts)
- docs/playbooks/revenue-crm.md          (changed: .../revenueCrmWatchProbe.ts)
- docs/playbooks/revenue-finance.md      (changed: .../revenueFinanceWatchProbe.ts, packages/revenue/src/finance.test.ts,
                                                   finance.ts, money.test.ts, money.ts)
```

All seven probe files were deleted immediately; `git status` confirms none remain. The hook's
acknowledgment file (`.git/claude-playbooks-ack.json`) was backed up before the probes and restored
after, so no file state was left falsely blessed.

### A second, smaller finding: `apps/web/e2e/` has 12 pre-existing two-owner collisions

The overlap proof also surfaced 12 collisions that predate Phase 28 — `cockpit.md`'s broad
`apps/web/e2e/` and `dashboard/workspace/` prefixes overlap five `dashboard-pages.md` specs, two
`voice.md` specs, one `vault.md` spec, one `intake.md` file and two `media.md` files, plus
`proposals.ts` listed under both `dashboard-pages.md` and `proposals.md`. **These were left
untouched** — they are outside this plan's scope, and their effect is over-blocking (two playbooks
flagged instead of one), not under-blocking. Logged here rather than fixed.

### 28-02 is now blocked on `revenue-finance.md` — correctly

28-02 landed `packages/revenue/src/money.ts` and `finance.ts` while this plan ran. They are now owned
by `revenue-finance.md`, which 28-02 has not touched, so its Stop hook will flag them. That is the
registration working as designed, and it is the handoff 28-02's own commit message asked for: 28-02
bumps `Last verified` (or fills in the finance sections) and continues. It was deliberately **not**
pre-bumped here — bumping a playbook to clear a gate over another lane's unreviewed code is the
silencing pattern this whole mechanism exists to prevent.

## User Setup Required

None.

## Next Phase Readiness

- **Ready:** every Phase 28 lane (28-01, 28-03 through 28-16, 28-19 through 28-29) now has exactly
  one playbook owner and can run in parallel without doc contention.
- **Every lane must still run `node scripts/check-phase28-readiness.mjs` first** — it was run first
  here and exited 0.
- **Carry-over for the lanes, not blockers:**
  - Verify the playbook hook with `echo '{}' | node scripts/check-playbooks.mjs check` and read
    **stdout**. Its exit code is 0 in every case.
  - Each of the four provider playbooks opens with an unanswered admission question. Those are
    28-01/28-22..25's work; no provider lane should write adapter code before its own is settled.
  - `packages/backend/convex/schema.ts` remains watched by no playbook (pre-existing repo gap).
    28-03 is Phase 28's single serialized schema owner regardless.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-27*

## Self-Check: PASSED

- All 7 playbooks + `watch.json` verified present **in commit `1cdfef4`** (via `git cat-file -e HEAD:<path>`), not merely in the working tree.
- Commit `1cdfef4` verified reachable.
- Zero probe files leaked: `git ls-files --others` shows no `*WatchProbe*`.
- `node scripts/check-phase28-readiness.mjs` re-run after all changes, exit **0** (run directly, not through a pipe).
