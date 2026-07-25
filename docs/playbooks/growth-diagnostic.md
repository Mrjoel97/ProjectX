# Playbook: Growth Diagnostic (pure-TS math)

> Last verified: 2026-07-25 against 15-01 (Phase 15 Wave-0 freeze) — `packages/core/src/specialists.ts`
> (+ its test) is now registered under this playbook as a STUB: the fail-closed route lookup with
> ZERO specialists registered. It is the CONSUMER side of `diagnose()`'s `Prescription.route`. The
> registry itself, and the closing of `Prescription.route` into a union, land in 15-02. No diagnostic
> math changed. See "Consumer side — specialist dispatch" below.
> Previously verified: 2026-07-24 against 12-01 (Python→TS port of the Growth OS diagnostic spine)
> Build history: `.planning/phases/12-business-evaluation-engine/` · Related ADRs: none

## Purpose

The deterministic core of the Business Evaluation Engine (BEVL-01). Given a Business Scorecard it
routes to the single highest-leverage constraint — top-down Market → Offer → Money Model → Leads —
by porting the Growth OS Python scripts (`diagnose.py`, `ltgp_cac.py`, `cfa.py`) to framework-agnostic
TypeScript. It is pure and Convex-free (CLAUDE.md §1) so the engine (plan 03) merely orchestrates it,
and it is conservative by construction: an unknown financial input makes it ASK, never fabricate a
metric or a route (§4 / RESEARCH Pitfall 4).

## Key files

Pure package (`packages/core/src/growth/`):
- `scorecard.ts` — the `Scorecard` type (an all-nullable mirror of
  `Skills/growth-os/assets/business-scorecard.template.json`) + `emptyScorecard` (the all-null default).
  Every leaf is `T | null`; a null means "not enough data", never a fabricated value.
- `financialSpine.ts` — `ltgpCac()` (LTGP:CAC ratio + `business_model | advertising` master switch) and
  `cfa()` (30-day self-funding test). `FLOOR_RATIO = 3.0`, `INDUSTRY_MULTIPLE = 3.0`. Every divisor is
  guarded → a bad input returns `null`/`false`, never `NaN`.
- `diagnose.ts` — `diagnose(sc): Prescription` (top-down gates, stop at first failure, one prescription;
  `gate: 0|1|2|3|"scale"`) + `leverageRank()` (orders a gap list by gate). Imports `ltgpCac`/`cfa`
  constants for the Gate 2/3 numeric checks.
- `index.ts` — re-exports the three modules.
- `financialSpine.test.ts`, `diagnose.test.ts` — the runnable checks (vitest; ponytail — no fixtures).

Consumer side — specialist dispatch (`packages/core/src/specialists.ts`, + `specialists.test.ts`):
- `SPECIALIST_ROUTES` / `SpecialistRoute` / `SPECIALISTS` / `resolveSpecialist(route)` — the DISP-01
  lookup that turns a `Prescription.route` string into a dispatchable specialist. At Wave 0 (15-01)
  the registry is DELIBERATELY EMPTY and every input resolves to `{ ok: false, reason: "unknown_route" }`.
  15-02 registers the three specialists.
- It mirrors `parseRouting` (`packages/contracts/src/routing.ts`) exactly: a discriminated result,
  NEVER a throw, and deliberately **no default specialist** — "a route the system cannot validate is
  a route it must not take". This is the same guarantee as the diagnostic's own conservatism, one
  layer out: `diagnose()` refuses to fabricate a route, and this refuses to invent one downstream.
- The runtime branch is load-bearing even though `route` will become a union type in 15-02:
  `gap.route` persists as `v.string()`, including the deliberate `route: ""` this file's `diagnose.ts`
  emits on the not-enough-data ask branch, so rows predating the union reach the lookup un-narrowed.
- The lookup uses `Object.prototype.hasOwnProperty.call(...)`, not `SPECIALISTS[route]`: a bare index
  read resolves `"__proto__"`/`"constructor"` to `Object.prototype` members, which are TRUTHY, so a
  truthiness guard would happily "route" on them. Asserted in `specialists.test.ts`.
- `SpecialistSpec.tools` is a CAPABILITY grant and is therefore code-owned, never DB-writable — only
  the skill BODY is a registry row (CLAUDE.md §5). A row that could widen its own tool set would be
  a privilege-escalation path.

## Dependencies & blast radius

Run `graphify query "growth diagnostic"` for the live subgraph. Couplings graphify cannot see:

- **Source of truth is the Python** — behaviour is a verbatim port of `Skills/growth-os/scripts/diagnose.py`
  + `ltgp_cac.py` + `cfa.py`. Change the diagnostic logic there first (or in lockstep); the TS must stay
  behaviour-identical to the worked examples in those files.
- **Plan 03 (the Convex engine) is the consumer** — it parses grounded vault text into a `Scorecard` and
  calls `diagnose()`. Renaming a `Scorecard` field or a `Prescription` field is a breaking contract change
  for that engine — anchor the names.
- **Not yet exported from the package root** — consumers import via `@pikar/core/growth/index`
  (the `./*` wildcard export). `packages/core/src/index.ts` deliberately does NOT re-export growth (ponytail —
  add it only when a root import is actually needed).

## Data flow

1. **Parse** — the engine (plan 03) turns grounded findings into a `Scorecard` (nulls where unknown).
2. **Spine math** — `ltgpCac`/`cfa` compute the health ratios from GROSS PROFIT (never revenue).
3. **Diagnose** — `diagnose()` walks the gates top-down and stops at the first that fails, emitting ONE
   `Prescription` (constraint, gate, route specialist, playbook, reason, proofMetric, roadmapLevel).
4. **Ask instead of guess** — if the money-model gate's financial inputs are all null, the prescription
   carries `ask` (naming the missing figure) with an empty route/proofMetric — no fabricated diagnosis.
5. **Rank** — `leverageRank()` orders multiple prescriptions by gate for the ≤5 gap list (plan 04/05).

## Invariants — what must never break

- **Gross profit, never revenue** — `ltgpCac` LTGP is `grossProfitPerPurchase × purchases`. Enforced by the
  worked-example assertion in `financialSpine.test.ts` (LTGP 4500 / CAC 150 / ratio 30).
- **Conservative: unknown → ask, never fabricate** — a null decisive financial input at the money-model
  gate returns a prescription with `ask` set and an EMPTY `route`/`proofMetric`; it never routes or invents
  a number, and an all-null scorecard never falsely reaches `scale`. Enforced by the null→ask case in
  `diagnose.test.ts`.
- **Every divisor is guarded** — `customers <= 0` → null CAC/ratio; `cac + serviceCost <= 0` → not achieved;
  never `NaN`. Enforced by the guard cases in `financialSpine.test.ts`.
- **`FLOOR_RATIO` and `INDUSTRY_MULTIPLE` are both 3.0** — the scalability floor and the "3× industry CAC"
  master switch. Changing either changes every routing boundary; keep them in step with the Python.
- **All-nullable Scorecard** — every leaf is `T | null` (booleans in presence-checklists default `false` =
  known-absent). A null is a nudge to ask, not a zero. Enforced by the type + `emptyScorecard`.
- **Top-down, stop at first failing gate** — Market < Offer < Money < Leads; the first failure wins and the
  rest are not evaluated. `leverageRank` preserves this order (`scale` last). Enforced by `diagnose.test.ts`.
- **Pure / Convex-free (CLAUDE.md §1)** — no Convex, no network, no I/O in `packages/core/src/growth/`.

## How to change safely

- **Change a routing boundary or a gate** — edit the Python script first (or decide the port diverges and
  document why), then mirror it in `diagnose.ts` and add/adjust the matching gate case in `diagnose.test.ts`.
  Most likely to violate the top-down/stop-at-first-gate and unknown→ask invariants — re-run both test files.
- **Add/rename a Scorecard field** — edit `scorecard.ts` type + `emptyScorecard` together, then check plan
  03's parser and every `diagnose.ts` reader; a rename is a breaking contract change for the engine.
- **Change a spine formula** — keep gross-profit semantics and the divisor guards; update the worked-example
  assertions in `financialSpine.test.ts` so they still pin the Growth OS numbers.

## How to verify

- `pnpm --filter @pikar/core test -- financialSpine` — worked example + CFA boundaries (ratio 1 and 2) +
  divisor guards. ~6s, no deployment.
- `pnpm --filter @pikar/core test -- diagnose` — one case per gate regime + healthy→scale + null→ask +
  `leverageRank` order. ~6s, no deployment.
- `pnpm --filter @pikar/core typecheck` — the module is pure and type-clean.
- `node scripts/check-playbooks.mjs` — this playbook covers `packages/core/src/growth/`.

## Operational notes

- No env vars, no seeds, no deployment — the module is pure math. The Python scripts in `Skills/growth-os/`
  are the reference, NOT a runtime dependency (do not shell out to Python).

## Known gaps & deferred work

- **CFA is not yet wired into `diagnose`** — the Gate 2 checks read the raw financial fields directly (as the
  Python does); `cfa()` is exported for the engine/UI to surface the 30-day self-funding verdict. `ponytail:`
  upgrade path = route Gate 2 through `cfa()` if the payback/tdc fields are ever derived rather than supplied.
- **Market-fact grounding is out of scope** — Phase 12 diagnoses from vault-grounded findings only; external
  market facts wait on web research (Phase 16). Until then `marketViable` is a supplied signal, not verified.
