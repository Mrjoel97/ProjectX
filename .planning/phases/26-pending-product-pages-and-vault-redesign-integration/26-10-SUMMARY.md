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

status: PARTIAL — Task 1 executed, Task 2 (blocking owner UAT) NOT performed
---

# 26-10 — Connected Finance route: the evidence, and what is still owed

**This plan is NOT closed.** Task 1 ran and produced real evidence. Task 2 is a
`gate="blocking"` human checkpoint and **has not happened**, so Task 3's closure is
deliberately not claimed. This summary exists because the run produced findings worth
recording now rather than after the checkpoint.

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

## Still owed

- **Task 2, the blocking owner UAT.** Three items: the non-owner view (now observable for the first
  time via `owner:revokeOwner` → observe → `bootstrapOwner`), the responsive/keyboard breakpoints,
  and a human review of the Task 1 run rather than merely a green tick.
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
