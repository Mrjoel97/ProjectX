---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 10
subsystem: web
tags: [finance, cost-console, e2e, owner-auth, evidence, sc7-deviation]

requires:
  - phase: 26-09
    provides: tenant Finance projections, owner-only controls, the summary/spendSeries contract
provides:
  - Executed authenticated browser evidence for the landed Cost Console
  - A re-runnable finance E2E (five spec defects fixed, none of them product defects)
  - An explicit record of the SC#7 nav-activation deviation
affects: [26-11, finance, cash]

status: COMPLETE — Task 1 executed, Task 2 approved by the owner 2026-08-22, Task 3 recorded
---

# 26-10 — Connected Finance route: executed browser gate, owner UAT, closure

**Closed 2026-08-22.** Task 1 ran, Task 2's blocking owner checkpoint was performed and
**approved by the owner**, and this records Task 3. The UAT found one real defect, which was
fixed and re-verified before approval — see "The UAT found a defect" below.

## The plan was replanned first, on evidence

The previous revision asserted "the implementation is landed, only evidence is missing." The
implementation half was accurate. The evidence half was not executable, and a six-lens
adversarial audit (21 agents) found four blockers before a live stack was spent:

1. **The UAT it demanded had already happened** — 2026-08-09, recorded at
   `dashboard-pages.md:1872-1889` with three items named as *not observed and not claimed*.
2. **Two demanded states cannot exist.** The "managed by the operator" copy is unreachable
   markup (`FinanceTabs.tsx:195` mounts `OperatorTab` only when `isOwner`), and there is **no
   runtime presentation kill-switch** — the only rollback is deleting the nav `href`, which makes
   the route undiscoverable but still URL-reachable. The two switches actually on the page are
   SPEND kill switches with all-tenant blast radius that would produce *no* ledger movements —
   the exact inverse of the property being demonstrated.
3. **The run was single-use.** `owner:bootstrapOwner` had no inverse anywhere in the codebase.
4. **The verify command does not filter** — `pnpm --filter @pikar/web test:e2e -- <file>` swallows
   the `--` and queues all 59 tests, as this repo's own playbook already records.

## What the run proved

Executed against local `convex dev` + a **production** build on `:3111` (`next dev` OOMs on
dashboard pages), from `apps/web`:

```
npx playwright test e2e/finance.spec.ts
```

**GREEN — 26-10's core evidence:**

- `the Finance page opens on Business, and a non-owner is offered no Operator tab`
- `the Cost console is intact behind the Pikar spend tab`
- `connected cost console: coverage, rails, unlanded meaning and the owner boundary` (35.1s)

The third is the substance of FIN-01. Passing it proves, in a real browser against a real
backend: coverage renders **Unknown, never `$0`**; each seeded movement lands exactly once and the
replay is deduped; the two unlanded sentences say different things on one page; the enforcement
clock is labelled UTC and is not the chart's timezone; a non-owner sees **no Operator tab and not
one deployment ceiling** in the page source; and the live cross-origin call to `finance:controls`
is refused with **`OWNER_REQUIRED`**.

Every movement was seeded through the real `spendLedger:record` writer. **It proves nothing about
any provider.** No model call, fal job or invoice was involved, and no seeded `actual` row may be
cited as evidence that money reached OpenAI or fal.

## The identity, because it is not the obvious one

The `.env` `user_email` is `joel.feruzi@gmail.com` — a **`google`** provider row with no password
credential, so the `/signin` form could never authenticate it regardless of the password. The run
used `joel.feruzi+phase21b@gmail.com`, a password-auth **non-owner** already on the deployment from
the phase-21b invite path. That is strictly better than the owner account: the boundary assertions
test a genuinely non-owner identity rather than a temporarily demoted owner, and the deployment
owner is never touched.

## Five defects, all in the spec, none in the product

These tests had been authored and never executed.

| # | Defect | Fix |
|---|---|---|
| 1 | `getByLabel("Cash on hand")` substring-matched the input **and** `aria-label="Save Cash on hand"` (measured: loose 2, exact 1) | `{ exact: true }` |
| 2 | `getByText(/no refund path/)` matched two deliberate renderings | scoped to `[data-unlanded="media"]` |
| 3 | Section 5 asserted literal `$5.00`/`$1.90` — **window totals that accumulate** | baseline + delta via `unlandedShown` |
| 4 | Owner ceilings snapshotted with `page.content()` before `globalRails` resolved — caught `Loading cost…` | wait for the first figure |
| 5 | `revokeOwner` placed in `seedOnboarded`, which the boundary test never calls | moved to `test.beforeAll` |

Defect 3 is the one the pre-flight audit predicted **to the cent**: "a second run against the same
tenant reads $10.00/$3.80, not $5.00/$1.90." The tenant reached 10 `spendEvents` rows and it failed
exactly there.

Defect 5 was introduced by this phase's own pre-flight. The lesson generalises: a helper that only
three of five tests call cannot carry a file-wide precondition.

## SC#7 DEVIATION — recorded, not normalised

Phase 26 **SC#7** requires authenticated responsive UAT *before* a nav item goes live. The Finance
`href` was added on **2026-08-09 on owner direction**, with the browser run and three UAT items
outstanding (commit `d5d4841`, whose own body says three items "were never observed live"). This is
an **accepted deviation with a date and an authoriser**, not a satisfied criterion. It is also why
26-18 (wave 14) closed while 26-10 (wave 7) did not.

## Task 2 — the blocking owner UAT, performed 2026-08-22

All three items the 2026-08-09 record named as *not observed and not claimed* were observed.
Evidence was gathered against local `convex dev` + a production build on `:3111`, as
`joel.feruzi+phase21b@gmail.com` — a password-auth NON-OWNER. **The deployment owner was never
demoted**: that account was promoted and put back instead, which the audit log shows as
`owner-revoke` → `owner-grant` → `owner-revoke`.

**Item 1 — the non-owner view.** Reachable for the first time, because `owner:revokeOwner` now
exists. Operator tab count `0`; tabs offered exactly `Business, Pikar spend`; **not one** of
`$50.00`/`$100.00`/`$250.00` anywhere in the DOM; no deployment-controls heading; and
`finance:controls` refused over the wire with `OWNER_REQUIRED`. Promoted, the same account shows
the Operator tab, all three ceilings, the "there is no single combined limit" copy, and all three
controls with arm-then-confirm on the kill switches. Restored to non-owner afterwards
(`revokeChanged: true`).

**Item 2 — responsive and keyboard.** Desktop 1440 and tablet 834 clean. **Mobile 390 was broken**
— see below.

**Item 3 — rails and one movement per phase.** Tenant caps ($5/$10/$25) stay distinct from
deployment ceilings ($50/$100/$250); they are never merged into one number. The two unlanded
sentences genuinely differ: ingest *"Reserved and not yet settled — still expected to land"*, media
*"Reserved and never returned… no refund path, so the difference is permanent — not pending."*

## The UAT found a defect, and this is a DEVIATION from Task 3

Task 3 says to leave the landed source untouched. **That was not possible and was not done.** The
responsive item found the Cost Console clipping its own copy at 390×844 on `?tab=spend` —
"three daily budg…", "from the lim…", "whether the next call w…". A checkpoint that finds a defect
and then declines to fix it is not a checkpoint, so the fix landed before approval and the owner
approved the fixed state.

**Root cause was grid intrinsic sizing, not the tables.** Every container is `display: grid` with
no explicit columns, so the implicit track is `auto` — it sizes to its widest item and refuses to
go below it — and grid items default to `min-width: auto`. The ledger widened its column to 441px
inside a 339px `main` and every sibling stretched to match. The three `scroller` wrappers already
had `overflow-x: auto` and were **useless**: an element that cannot shrink never scrolls, it
expands. Fixed with three properties and no markup change — `minWidth: 0` on `scroller`, and
`gridTemplateColumns: "minmax(0, 1fr)"` on `stack`, the FinanceTabs page container and
FinanceView's outer grid.

**Why nothing caught it, which generalises past Finance.** The page never scrolled horizontally:
`document.documentElement.scrollWidth` stayed exactly 390 because the content CLIPPED. A
page-level overflow assertion therefore reports clean on a visibly broken page — the first probe
written for this did exactly that. The metric that works is per-container (`main.scrollWidth` vs
`main.clientWidth`) plus classifying each overflowing element by whether it sits inside a real
horizontal scroller. Recorded in `dashboard-pages.md` for every page there, not just this one.

Measured at 390×844 on `?tab=spend`: before 441/339 with 103 past the edge and 103 genuinely
clipped; after 339/339 with 50 past the edge and **0 clipped** — the 50 are inside the ledger's
scroller, which is intended. `financeView` + `cashView` 70/70; the three 26-10 evidence e2e tests
still pass; `biome ci .` 638 files exit 0.

## Still owed elsewhere

- **Two red tests, characterised and out of 26-10 scope.**
  - `a number entered in the panel appears as a business figure` (Cash-side): passes alone, passes
    after test 2, fails after test 1, survives a 120s timeout so it is not budget. Characterised,
    **not explained**. Blocks the tests below it only because the file is `mode: "serial"`.
  - `an owner gets the Operator tab`: the account **is** an owner at that point (the audit log shows
    `owner-revoke` → `owner-grant` → `owner-revoke`), and it still times out after test 4's ~8
    `convexRun` calls — matching this repo's own note that every `convex run` against a LOCAL
    deployment invalidates the browser session ("STAGE FIRST, THEN AUTHENTICATE").
- **The rollback gap.** There is no runtime presentation switch; the documented rollback is a source
  edit that only makes the route undiscoverable. Carried forward as a deferred item rather than
  faked.
- **26-VALIDATION.md** still lists 26-06/07/08 as pending and quotes the non-filtering `test:e2e --`
  command. Not silently closed here.

## Pre-flight changes that live outside this plan

- `owner:revokeOwner` (`packages/backend/convex/owner.ts`) — the grant's missing inverse.
  `internalMutation`, exact `users._id`, `NO_SUCH_USER`, idempotent, one `owner.revoked` audit event,
  payload key set exactly `owner,userId`. Mutation-tested: removing the short-circuit reddens 2
  tests, dropping the audit event reddens 3.
- `finance.spec.ts` media kill-switch wrapped in `try`/`finally` — it previously left
  `guardrailConfig.mediaKillSwitch` **ON deployment-wide** if an assertion failed between the toggles.
- `authorization.md`, `dashboard-pages.md`, `cockpit.md` — the inverse recorded, and two statements
  corrected in place that were already false (the nav item does **not** stay `Soon`; the spec asserts
  the nav link's **presence**, not its absence).
