---
phase: 28-connector-backed-revenue-pack
plan: 02
subsystem: finance
tags: [money, iso-4217, minor-units, ar-aging, payment-lag, cash-flow, payroll, reconciliation, confidence, pure-ts]

# Dependency graph
requires:
  - phase: 28-connector-backed-revenue-pack (plan 28-17)
    provides: the landed-contract readiness gate (scripts/check-phase28-readiness.mjs, exits 0)
  - phase: earlier (packages/core)
    provides: CashFigure's four-state figure vocabulary, CashOrigin, FigureActor, Result<T,E>
provides:
  - "@pikar/revenue — a Convex-free, LLM-free workspace package holding every Phase 28 number"
  - "Money: safe-integer minor units + explicit ISO 4217 currency; mixed currency refused or separated"
  - "Closed Provider / SourceAuthority vocabularies and a ready/partial/unavailable Projection contract with code-owned caps"
  - "AR aging, payment-lag percentiles, cash timeline, payroll gap — all pure and boundary-tested"
  - "reconcilePayments + receiptsTotal: the only route to a payments total, so books and rails cannot double-count"
  - "coverageOf / confidenceFor: closed high|medium|low|unavailable, monotone downward"
affects:
  - 28-03 onward (every provider adapter must terminate in these contracts)
  - 28-18 (playbook/watch ownership of packages/revenue)
  - any revenue workflow or specialist prompt that reports a figure

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Figure<V> generic reuses @pikar/core CashFigure's unresolved arm by Exclude, never a second copy"
    - "A capped read is `partial`, never `ready`"
    - "The only exported total over payments takes a Reconciled, making double-count unreachable through the public API"
    - "Currency is a required argument, never inferred from the first element"

key-files:
  created:
    - packages/revenue/package.json
    - packages/revenue/tsconfig.json
    - packages/revenue/vitest.config.ts
    - packages/revenue/src/contracts.ts
    - packages/revenue/src/contracts.test.ts
    - packages/revenue/src/money.ts
    - packages/revenue/src/money.test.ts
    - packages/revenue/src/finance.ts
    - packages/revenue/src/finance.test.ts
    - packages/revenue/src/index.ts
  modified:
    - docs/playbooks/watch.json
    - pnpm-lock.yaml

key-decisions:
  - "Reused @pikar/core's CashFigure states via Exclude<CashFigure, {state:'known'}> rather than minting a second figure union"
  - "Money carries no exponent: it is derived from the currency through a code-owned ISO 4217 exception table with the ISO default of 2"
  - "Parsing is BigInt string arithmetic — no float ever holds a money value"
  - "Nearest-rank for both p50 and p90: one algorithm, always an observed value, no interpolated half-day"
  - "Same-day cash ordering is prudent: outflows settle before receipts, and the timeline records the intraday trough"
  - "No payroll run on file yields UNKNOWN, never `covered: true`"
  - "Confidence is monotone downward, asserted over every authority-subset x degradation permutation"

patterns-established:
  - "Two failure channels: Result.err for a caller/argument contradiction, an unresolved Figure for a data gap the owner can close"
  - "Mutation discipline: off-by-one on boundaries, rename on discriminating literals — never deletion"

requirements-completed: [REVN-05]

# Metrics
duration: ~75min
completed: 2026-08-27
---

# Phase 28 Plan 02: Deterministic Finance Core Summary

**`@pikar/revenue` now owns every Phase 28 number in pure TypeScript — integer minor-unit money with
explicit currency, AR aging / payment-lag / cash-timeline / payroll-gap math, and an
accounting-authority-vs-payment-rail reconciliation that makes double-counting unreachable through
the public API — before any provider response or prompt exists to define it.**

## Performance

- **Duration:** ~75 min
- **Tasks:** 2/2
- **Files created:** 10 (+2 modified)
- **Tests:** 79 passing across 3 files; typecheck and Biome clean

## Readiness Gate

`node scripts/check-phase28-readiness.mjs` was run FIRST, directly (not through a pipe), and exited
**0** over all 16 Phase 19/25/27 prerequisite rows. No implementation began before it was green.

## Accomplishments

- **A money type the repo did not have.** `@pikar/core`'s `CashUnit` is the literal `"usd"`, which
  is fine for a self-reported figure and wrong the moment a Stripe account settles in EUR.
  `Money = { minor, currency }` is a safe-integer count of the currency's minor unit. Parsing is
  BigInt string arithmetic, so `0.1` USD is exactly `10` and never `10.000000000000002`, and the
  magnitude check happens BEFORE any lossy conversion. Exponents come from a code-owned ISO 4217
  exception table (JPY 0, BHD 3, CLF 4) with the ISO default of 2 — enumerating the exceptions IS
  enumerating all of them, so the default is not a guess.
- **Currencies never combine silently.** `addMoney`/`subMoney`/`compareMoney`/`sumMoney` all return
  a `Result` and refuse a mismatch. `sumMoney` takes the currency as a *required argument* rather
  than reading it off the first element — an empty ledger still has to answer in some currency, and
  inferring one is how a caller silently totals the wrong ledger. `groupByCurrency` is the
  "separate" half of the phase context's "reject or separate".
- **A bounded vocabulary every provider must terminate in.** Closed `Provider` and
  `SourceAuthority` unions, `ready | partial | unavailable` projections, code-owned page/item/byte/
  window/source caps, and `SourceRef`s guarded to refs-and-ids-only against straight *and* curly
  quotes (CLAUDE.md §4 — the realistic leak is a possessive, not a quoted passage). **A capped read
  is `partial`, never `ready`:** a prefix of reality is not a total.
- **Deterministic finance math.** AR aging by whole UTC day across current/1-30/31-60/61-90/90+/
  unknown; payment lag from issue to an invoice's *last* payment with nearest-rank p50/p90; a cash
  timeline that settles same-day outflows before same-day receipts and records the intraday trough;
  and a payroll gap that names the first run that cannot clear.
- **Double-counting has no route through the public API.** `reconcilePayments` drops a rail's copy
  of an invoice the books already settled, and drops an unlinked rail charge inside the books'
  coverage window — while keeping a rail charge the books never covered, which is genuinely new
  information. `receiptsTotal` is the **only** exported total over payments and it takes a
  `Reconciled`, so there is no shape in the API that lets a caller sum raw provider payments.
- **Unknown never becomes zero, and never improves confidence.** A missing due date is the `unknown`
  aging bucket, not `current`. A median over no settled invoices is `not-computable`, not `0`.
  Missing opening cash makes the whole timeline `unknown`, not a balance starting from zero. No
  payroll run on file is `unknown`, **not** `covered: true` — silence is not safety.
  `confidenceFor` is closed and monotone downward, asserted over every authority-subset ×
  degradation permutation.

## Task Commits

1. **Task 1: Scaffold the revenue package and freeze normalized contracts** — `d963bf3` (feat)
2. **Task 2: Deterministic money and finance functions with mutation-resistant tests** — `eaea00c` (feat)

Each task was committed green (tests + typecheck passing at HEAD). TDD RED was **observed** before
each implementation (`Cannot find module './contracts'`, `'./money'`, `'./finance'`) but not
committed separately: other lanes share this working tree, and leaving a HEAD with a failing suite
would break their gates.

`git diff --stat HEAD -- "*.ts"` was empty after both commits — nothing meant to ship was left
unstaged.

## Reuse Boundary (CLAUDE.md §8 rung 2)

**Reused verbatim, not re-minted:**

| From core | How |
| --- | --- |
| `CashFigure`'s `unknown` / `not-applicable` / `not-computable` arms | `type Unresolved = Exclude<CashFigure, { state: "known" }>` — one definition of the distinction in the repo |
| `unknownFigure` / `notComputable` constructors | Called through `gap()` / `undefinedResult()` narrowing wrappers |
| `CashOrigin` | Used as-is on `Figure<V>` |
| `FigureActor` | Carried on `Figure<V>` for the same reason core carries it — attributing an agent's arithmetic to the owner is a recorded defect class here |
| `Result` / `ok` / `err` / `unwrap` | Every refusal path |

**Genuinely new, and why it could not be core:**

- `Money` — core's `CashUnit` is the literal `"usd"`. There is no way to express EUR or JPY in it.
- `Figure<V>` — core's `CashFigure` pins `value: number` + `unit: CashUnit`. A `Money` or a
  day-count cannot occupy it. `Figure<V>` is the same four states over an arbitrary value type; the
  three unresolved arms are imported, not copied.
- A `days` unit — `CashUnit` has `months`, `perDay`, `count`, but no `days`. Adding one would edit a
  shared type outside this plan's `files_modified`, so `DayFigure = Figure<number>` carries it here.
- All AR-aging / payment-lag / cash-timeline / payroll-gap math — none of it exists anywhere.

**Bridge back:** `toCashFigure()` converts a `Figure<Money>` to core's `CashFigure` for the existing
cash panel and finance spine, and returns `not-computable` for any non-USD figure rather than
losing the currency code and printing a dollar sign over euros.

## Mutation Testing

18 non-deletion mutations were applied one at a time and the suite observed; every source file was
restored from a backup between mutations and the suite re-verified green at the end. Per the 28-17
finding, **no mutation was a deletion** — boundaries were mutated by off-by-one and literals by
rename.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | `window > maxWindowDays*DAY` → `>=` | RED (1) |
| 2 | `items.length > maxItems` → `>=` | RED (1) |
| 3 | `"stripe"` → `"stripeRENAMED"` in `PROVIDERS` | RED (2) |
| 4 | `value.length > REF_CHAR_CAP` → `>=` | RED (1) |
| 5 | aging `overdue <= 30` → `< 30` | RED (1) |
| 6 | aging `overdue <= 0` → `< 0` | RED (2) |
| 7 | aging `overdue <= 90` → `<= 91` | RED (1) |
| 8 | percentile `Math.ceil` → `Math.floor` | RED (5) |
| 9 | p90 rank `0.9` → `0.95` | RED (1) |
| 10 | timeline same-day order flipped (inflows first) | RED (3) |
| 11 | **payroll `low.minor >= 0` → `> 0`** | **SURVIVED — see below** |
| 12 | `s.authority === "accounting_authority"` → renamed | RED (2) |
| 13 | confidence `degraded ? "medium" : "high"` → always `"high"` | RED (1) |
| 14 | payroll no-runs `unknown` → `covered: true` | RED (2) |
| 15 | excess-scale `frac.length > exp` → `> exp + 1` | RED (2) |
| 16 | `magnitude > MAX_BIG` → `> MAX_BIG + 1n` | RED (1) |
| 17 | `JPY: 0` renamed out of the exponent table | RED (4) |
| 18 | `BHD: 3` → `2`; default `?? 2` → `?? 3` | RED (4) / RED (7) |
| 19 | `sameCurrency` compares `.length` instead of the code | RED (1) |
| 20 | `sumMoney` `isSafeInteger` → `isFinite` | RED (1) |
| 21 | `ALPHA3` `{3}` → `{2,4}` | RED (2) |

### The survivor — a real coverage hole

Mutation 11 changed the payroll shortfall test from `low.minor >= 0` to `low.minor > 0` and **all 78
tests still passed.** That mutation makes a payroll run that lands the balance on *exactly zero*
report `covered: false` with a `$0.00` shortfall — a false alarm telling an owner they missed
payroll when they made it. The boundary was untested. A test was added
(`"clears a payroll run that lands the balance on EXACTLY zero"`), the mutation replayed, and it now
kills (1 failed / 78 passed). Final suite: **79 passing.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `receiptsTotal` summed `Payment` rows instead of their amounts**
- **Found during:** Task 2
- **Issue:** `receiptsTotal` passed `r.included` (a `readonly Payment[]`) straight into `sumMoney`,
  which expects `readonly Money[]`. Every reconciled total failed with
  `Cannot total undefined into a USD figure`.
- **Fix:** `sumMoney(r.included.map((p) => p.amount), currency)`.
- **Verification:** The `"totals only what survived reconciliation"` test went from RED to GREEN.
- **Committed in:** `eaea00c`

**2. [Rule 2 - Correctness] `nearestRank`'s `?? 0` fallback was a fabricated zero**
- **Found during:** Task 2
- **Issue:** `nearestRank` ended `?? 0`. Unreachable for a non-empty list, but it is *precisely* the
  shape this module exists to prevent — an index miss silently reporting a 0-day payment lag.
- **Fix:** `nearestRank` now returns `number | undefined`; `paymentLag` refuses with
  `"A percentile over no data is undefined."` rather than inventing a number.
- **Committed in:** `eaea00c`

**3. [Rule 3 - Blocking] Core's figure constructors are typed to the whole union**
- **Found during:** Task 2 (typecheck, after the suite was already green)
- **Issue:** `unknownFigure()` / `notComputable()` are declared as returning the full `CashFigure`
  union, so their results are not assignable to `Figure<Money>` or `Figure<CashTimeline>`. The tests
  passed; `tsc` did not. (This is why typecheck ran separately from the suite.)
- **Fix:** One local `asUnresolved` narrowing helper with a provably-unreachable throw, plus `gap()`
  and `undefinedResult()` wrappers — real narrowing, not a cast, and still reusing core's
  constructors rather than re-declaring the shapes.
- **Committed in:** `eaea00c`

**4. [Rule 3 - Blocking] `packages/revenue/` had no playbook coverage**
- **Issue:** The Stop hook blocks new code under `packages/` that no playbook watches.
- **Fix:** `packages/revenue/` acknowledged under `"_unassigned"` in `docs/playbooks/watch.json` —
  the sanctioned interim resolution. The plan explicitly assigns playbook/watch ownership to 28-18.
- **Note for 28-18:** an untracked `docs/playbooks/revenue-connectors.md` already exists in this
  working tree (another lane, "REGISTERED AHEAD OF IMPLEMENTATION"). 28-18 should move
  `packages/revenue/` from `_unassigned` onto that playbook's watch list. It was **not** staged
  here — it is another lane's uncommitted file.

---

**Total deviations:** 4 auto-fixed (1 × Rule 1, 1 × Rule 2, 2 × Rule 3). No scope creep — all four
were required for the plan's own tasks to be correct and to land.

## Issues Encountered

- **The plan's verify command is a known no-op filter.** `pnpm --filter @pikar/revenue test --
  contracts` does not filter (recorded repo gotcha). Tests were run by `cd`-ing into the package,
  and the un-filtered `pnpm --filter @pikar/revenue test` / `typecheck` were both run at the end and
  are green.
- **A green suite hid a type error.** Vitest transpiles without typechecking, so 78 tests passed
  while `tsc` had two genuine errors. Both gates are now run separately every time.

## Verification

```
node scripts/check-phase28-readiness.mjs        exit 0 (run first, not piped)
pnpm --filter @pikar/revenue test               3 files, 79 tests passed
pnpm --filter @pikar/revenue typecheck          clean
npx biome check packages/revenue/src            clean
git diff --stat HEAD -- "*.ts"                  empty after both commits
```

## User Setup Required

None — pure TypeScript, no runtime dependency, no external service.

## Next Phase Readiness

- REVN-05's calculations exist with no Convex, no network and no LLM in the path. A provider adapter
  (28-03 onward) has a frozen target: normalize into `Projection<Invoice|Payment|Obligation>`, pass
  `validateProjection`, and hand it to `finance.ts`.
- Every adapter MUST mark a capped read `partial` — `validateProjection` refuses a capped `ready`.
- Adapters must produce `Money` only through `parseMoney` / `moneyFromMinor` / `moneyFromNumber`.
  Nothing else may construct one.
- A payment-rail adapter must declare `authority: "payment_rail"` and a real coverage window, or
  `reconcilePayments` cannot exclude its copy of what QuickBooks already booked.
- **Open for 28-18:** move `packages/revenue/` out of `watch.json`'s `_unassigned` onto the
  `revenue-connectors.md` playbook once that playbook is committed.

## Self-Check: PASSED

All 10 created files verified present on disk. Both task commits (`d963bf3`, `eaea00c`) verified in
`git log --all`, and verified by CONTENT via `git show --stat` — 528 + 1494 lines actually landed in
those commits, not merely in the working tree.

Every path in this plan's `files_modified` frontmatter was genuinely touched by the diff — no
coverage hole:

| Plan `files_modified` | In a commit |
| --- | --- |
| `packages/revenue/package.json` | `d963bf3` |
| `packages/revenue/tsconfig.json` | `d963bf3` |
| `packages/revenue/src/contracts.ts` | `d963bf3` |
| `packages/revenue/src/contracts.test.ts` | `d963bf3` |
| `packages/revenue/src/index.ts` | `d963bf3` + `eaea00c` |
| `packages/revenue/src/money.ts` | `eaea00c` |
| `packages/revenue/src/money.test.ts` | `eaea00c` |
| `packages/revenue/src/finance.ts` | `eaea00c` |
| `packages/revenue/src/finance.test.ts` | `eaea00c` |

Beyond the plan: `packages/revenue/vitest.config.ts` (required to run the suite at all, mirroring
`@pikar/cost`), `docs/playbooks/watch.json` and `pnpm-lock.yaml`.

`graphify update .` and `node scripts/extract-convex-edges.mjs` were run after the code landed
(exit 0). `graphify-out/*` was deliberately NOT staged — a session hook owns it and other lanes
share this tree.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-27*
