---
phase: 28
plan: 26
subsystem: revenue-connectors
tags: [provider-gates, release-semantics, eligibility, cli-gate, phase-28]
requires:
  - 28-01 (the four admission markers in docs/connectors/)
  - 28-03 (the providerGates table, additive schema owner)
  - 28-04 (PROVIDER_READ_PATHS, the fail-closed read allow-list)
provides:
  - "resolveProviderEligibility — the ONE composite rule over admission x lane x expiry x read-paths x open conditions"
  - "convex/providerGates.ts — passed-only tenant projection, owner seal with CAS, internal lane-failure write"
  - "scripts/check-provider-lane.mjs — the per-provider lane gate, source-derived and self-tested"
  - "PROVIDER_OPEN_CONDITIONS — the four surviving admission conditions, machine-visible to 28-22..25"
affects:
  - 28-05..08 (each lane's adapter is what the `adapter`/`read-only` rows scan)
  - 28-22..25 (each must clear its provider's open condition to seal a passed lane)
  - 28-09 (connections UI must read availableProviders, never the admission)
  - 28-27/28-30 (phase completion reads the same gate)
tech-stack:
  added: []
  patterns:
    - "Two orthogonal axes with one explicit composite rule, never a collapsed boolean"
    - "Derived-and-parity-tested against the markdown register rather than hand-copied"
    - "Three row statuses (green/pending/red) so 'not built' and 'wrong' cannot be confused"
key-files:
  created:
    - packages/backend/convex/providerGates.ts
    - packages/backend/convex/providerGates.test.ts
    - scripts/check-provider-lane.mjs
  modified:
    - packages/revenue/src/contracts.ts
    - packages/revenue/src/contracts.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/isolation.test.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/revenue-connectors.md
decisions:
  - "Extended 28-02's contracts.ts rather than minting a new module or reusing Phase 27's SourceState"
  - "Widened providerGates.lane additively to include `failed`; added optional `clearedConditions`"
  - "`pending` and `expired` are RESOLVED, never stored — a stored freshness flag rots"
  - "An owner admission can never produce a passed lane, in code or in the CLI"
  - "sealGate validates a pass by running the same resolver the readers run"
  - "No audit row for a gate seal: providerGates is deployment-global, audit is tenant-scoped"
metrics:
  duration: ~2h
  completed: 2026-08-27
requirements-completed: []
---

# Phase 28 Plan 26: Durable Machine-Readable Provider Eligibility Gate Summary

Provider availability is now one server-owned answer computed by one rule from two deliberately
separate axes — the owner's admission decision and an observed live gate — with the register's four
surviving open conditions made machine-visible and load-bearing, plus an offline per-provider lane
gate that is source-derived from the markdown records and observed going red on every row.

## Gate

`node scripts/check-phase28-readiness.mjs` — **exit 0**, all 16 rows green, run unpiped before any
work started.

## What the plan was actually for, and what landed

The danger this plan exists to prevent: on 2026-08-27 the owner admitted all four providers
`approved_production`, and **three of those four rest on human testimony rather than evidence**
(Stripe is an OVERRIDE against its own record; QuickBooks and PayPal are ATTESTATIONS of vendor
approvals nothing in this repository can check). Not one of the four approvals resolved its record's
open condition. If "the owner approved this" and "this provider proved itself" ever collapsed into
one flag, wave 7's seals would be decorative and a provider could go discoverable on a say-so.

**28-03 had already made the schema right.** `providerGates` shipped with `admission` and `lane` as
two separate fields and a comment saying exactly why. This plan did not have to invent the
separation — it had to make it *enforceable*, which meant: one rule that combines them, a write path
that cannot record a pass the readers would refuse, and a gate that can say all of this about the
tree without a deployment.

### Task 1 — the gate state machine (`1bb8b3b`)

**`resolveProviderEligibility` in `@pikar/revenue` is the only place the axes are ever combined.**
Five RESOLVED states over three STORED ones, because two of them cannot honestly be stored:

- `pending` — the ABSENCE of a row. A row saying "pending" would be a row claiming a judgment
  exists. There is no `undecided` literal in the schema for the same reason: a missing row IS
  undecided, so there is exactly one representation of "nobody judged this".
- `expired` — resolved against `now`, never stored. The register caps evidence life at 90 days
  precisely because a stored freshness flag is true when written and silently false an hour later.

The composite rule, and a refusal names every axis that refused rather than the first:

1. a gate record exists;
2. `lane === "passed"` — a `failed` lane short-circuits, and **a failure outranks expiry** (a lane
   that broke is an incident, not staleness);
3. `reviewBy > now`;
4. the admission permits that environment (`approved_production` for production, `approved_beta`
   reaches sandbox only, `blocked`/`deferred` reach neither);
5. `readPathCount > 0` — **passed IN rather than imported**, so the pure rule stays Convex-free and
   can never contradict `connectorFetch`. This is what makes Stripe unavailable today whatever the
   owner approved: `PROVIDER_READ_PATHS.stripe` is `[]` BY DECISION until 28-07;
6. every entry in `PROVIDER_OPEN_CONDITIONS[provider]` appears in the row's `clearedConditions`.

Rule 6 is what turns the four surviving conditions from prose into a gate. **`sealGate` validates a
pass by running the same resolver the readers run**, so a pass can never be recorded that a reader
would then refuse — one rule, one implementation, no second composite to drift.

Parking is never blocked (a refusal must always be recordable, or a lane discovered broken could not
be switched off). `recordLaneFailure` deliberately carries **no** CAS — refusing to record a failure
because the revision moved would leave a known-broken lane readable — but it bumps `revision`, so an
owner seal already in flight fails rather than resurrecting the lane.

The tenant projection returns **provider and environment and nothing else**: no evidence ref, no
revision, no review date. A surface that could see the review date would start rendering "expiring
soon" and treating an admission as a status.

### Task 2 — the lane gate CLI (`40047f3`)

`scripts/check-provider-lane.mjs`, 8 rows per provider, **every fact read out of a file**: the
decision markers, the register's open-condition table, `PROVIDER_READ_PATHS`, `PROVIDERS` and the
`providerGates` schema literals. Nothing is retyped.

Three row statuses, because "not built yet" and "wrong" are different facts. Exit 0 = no red; at
`--stage final` a `pending` IS red. Run against the tree today: **exit 0, 13 pending rows, zero green
lanes** — the honest picture.

The seal modes carry the whole point: **`--seal-decision from-owner` resolves an ADMITTED provider to
`park`, always**, and says why. An `undecided` record is refused outright. `--seal-decision pass`
requires live evidence, a named `--clear-condition` for every open condition, and a fully green
`--stage final`; it refuses for all four providers today.

`--verify-gate` runs the real `providerGates` behaviour tests rather than grepping for the branch
that is supposed to disable a failed lane — a source tripwire proves spelling, not validity.

## Reuse decision — Phase 27 prior art, and why it was not adopted

Read `workflowPackDiscovery.ts` and the candidate/active lifecycle first, as instructed.

**Reused: the SHAPE.** `listPacks` returns a pack only when its registry row is `active`, so a
candidate is invisible to ordinary discovery *by construction* rather than by a caller remembering
to filter. `availableProviders` is the same move — a passed-only projection is the only tenant door,
so a surface cannot accidentally read the raw row.

**Not reused: the VOCABULARY.** `SourceState` is `available | partial | unavailable`, and `partial`
has no meaning for eligibility — a provider is not half-permitted. More importantly the admission
vocabulary already exists twice (28-01's register, 28-03's schema) and minting a third parallel set
is exactly the drift this plan is about. `ADMISSIONS`/`LANES` were added to `@pikar/revenue` as the
single closed source, and the schema literals are pinned to them by a source scan.

**Not reused: a new module.** The pure rule went into `packages/revenue/src/contracts.ts` — the
module that already owns `PROVIDERS` and is described as "the bounded vocabulary every Phase 28
provider must terminate in". That kept the file count down, needed no `watch.json` edit, and gives
the parity scan one file to read.

## Deviations from Plan

### Auto-fixed / design deviations

**1. [Rule 3 - Blocking] The plan's file list omitted the pure module; CLAUDE.md §1 requires it**
- **Found during:** Task 1
- **Issue:** `files_modified` named only `providerGates.ts`. The composite rule is domain logic and
  §1 puts domain logic in `packages/*`, with `convex/` as a thin adapter.
- **Fix:** the rule and its vocabulary live in `packages/revenue/src/contracts.ts`; `providerGates.ts`
  reads rows, supplies the allow-list count, and writes.
- **Commit:** `1bb8b3b`

**2. [Rule 3 - Blocking] Two additive schema fields on a table that had never held a row**
- **Found during:** Task 1
- **Issue:** the plan's five states include `failed`, and rule 6 needs somewhere to record a cleared
  condition. `providerGates.lane` was `passed|parked` only.
- **Fix:** widened `lane` to include `failed` and added `clearedConditions: v.optional(...)`. Both
  strictly additive; the table has never held a row anywhere, so nothing could be invalidated.
  28-03 remains the schema owner for the connector tables — flagged rather than assumed.
- **Commit:** `1bb8b3b`

**3. [Rule 2 - Missing critical] `isolation.test.ts`'s derived owner surface had to grow**
- **Found during:** Task 1 verification
- **Issue:** the repo derives its owner-endpoint list from the source and pins the count and module
  set. Two new owner endpoints turned it red — which is the assertion doing its job for the sixth
  time. It also refuses `{}` args, because argument validation runs BEFORE `requireOwner` and an
  empty-args test would pass on a validator error while proving nothing about authorization.
- **Fix:** added `providerGates` to the module set, bumped the floor to 23, and gave both endpoints
  deliberately HARMLESS fixtures (the seal would PARK hubspot on a `blocked` admission with an
  expired review date, so if the wrapper ever let it through the worst outcome is a provider
  switched off).
- **Commit:** `1bb8b3b`

**4. [Rule 1 - Bug] The CLI's condition row disagreed with the runtime resolver**
- **Found during:** Task 2, exercising `--seal-decision pass`
- **Issue:** the CLI's `open-conditions` row was pending whenever the code listed any condition, so
  a `pass` could never be sealed even with every condition named — while the runtime resolver
  clears conditions via the row's `clearedConditions`. Two mechanisms, one rule: exactly the drift
  class this plan exists to close, found inside this plan.
- **Fix:** the row now honours `--clear-condition`, matching `resolveProviderEligibility` exactly,
  and a self-test case proves the pass path is REACHABLE.
- **Commit:** `40047f3`

**5. [Rule 3 - Blocking] `_generated/api.d.ts` needed the new module registered by hand**
- **Found during:** Task 1 typecheck
- **Issue:** `npx convex codegen` needs a running local backend and timed out; `tsc` failed on 40
  `Property 'providerGates' does not exist` errors while **the vitest suite was fully green**.
- **Fix:** added the two generated lines by hand, exactly as codegen emits them.
- **Commit:** `1bb8b3b`

**6. Playbook updated once, in the Task 2 commit** rather than split across both, per CLAUDE.md §9's
"same commit/phase". The hook was verified clean afterwards.

No architectural (Rule 4) decisions were needed — 28-03 had already made the load-bearing structural
choice, and this plan consumed it.

## Verification

| What | Result |
|---|---|
| `node scripts/check-phase28-readiness.mjs` (unpiped) | **exit 0**, 16/16 rows green |
| `packages/revenue` vitest | **123/123**, exit 0 (baseline 104 → +19) |
| `packages/revenue` `npx tsc --noEmit`, run SEPARATELY | **exit 0** |
| `packages/backend` `convex/providerGates.test.ts` | **24/24**, exit 0 |
| `packages/backend` full vitest | **104/104 files, 2668/2668 tests pass** (baseline 2641) |
| `packages/backend` `npx tsc --noEmit`, run SEPARATELY | **exit 0** — it caught 41 real errors under a fully green suite |
| `npx biome check` on every touched file | clean; caught 2 real lint errors and 4 formatting diffs |
| `node scripts/check-provider-lane.mjs --all` | **exit 0**, 13 pending rows, 0 green lanes |
| `node scripts/check-provider-lane.mjs --provider hubspot --stage final` | **exit 1**, 3 red — correct |
| `node scripts/check-provider-lane.mjs --self-test` | **exit 0** |
| `node scripts/check-provider-lane.mjs --verify-gate` | **exit 0** |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | no `"decision":"block"` on stdout |
| `git diff --stat HEAD -- "*.ts"` after committing | empty |

**A GREEN VITEST RUN IS NOT A TYPECHECK, and it caught it twice again.** 123 green revenue tests sat
over a `string | undefined` error, and 24 green backend gate tests sat over 41 `readonly string[]`
and missing-module errors. `tsc --noEmit` was run separately from inside each package.

### The one non-green thing, and why it is not this plan's

The full backend run reports `Errors 1 error` — a worker-level
`ReferenceError: process is not defined` in `ForksBaseWorker.executeTests`, which makes the process
exit 1 while **every one of the 104 files and 2668 tests passes**. 28-03 recorded this; 28-04 did
not reproduce it. **Attributed by exclusion rather than by assertion:** re-running the whole suite
with `--exclude convex/providerGates.test.ts` reproduces it identically (103 files, 2644 tests, same
1 error, same exit 1). It is a pre-existing flaky vitest/edge-runtime teardown artifact. Observed,
not fixed, out of scope.

## Mutation testing

**Nine non-deletion mutations against the state machine, ALL RED, ZERO SURVIVORS**, each restored and
the restore asserted. Every mutation is a RENAME, a value substitution or a RELATION change —
deletion-only mutation is blind to substring matching.

| # | Mutation | Red tests |
|---|---|---|
| M1 | `reviewBy <= now` → `<` | 1 (the boundary case) |
| M2 | `environment === "sandbox"` → `"production"` in the admission rule | 1 |
| M3 | `readPathCount <= 0` → `< 0` | 2 |
| M4 | the `failed` branch guarded by `reviewBy > now` (precedence swap) | 1 |
| M5 | `sealGate`'s composite guard fires on `parked` instead of `passed` | 7 |
| M6 | `recordLaneFailure` does not bump `revision` | 1 |
| M7 | projection filter `state === "passed"` → `state !== "failed"` | 2 |
| M8 | `sealGate`'s CAS default `?? 0` → `?? currentRevision` | 1 |
| M9 | schema literal `"failed"` → `"broken"` | 3 |

**Blind spot (a) — substring matching:** every literal mutation is a RENAME to a string that is not
a substring relation of the original (`passed`→`parked`, `failed`→`broken`), and the module's own
import scan compares the WHOLE set of imported builder names rather than searching for banned
substrings — `tenantMutation`, `ownerMutation` and `internalMutation` all contain `Mutation(`, so a
substring ban would either miss the ban or fire on the sanctioned builder.

**Blind spot (b) — two guards in sequence:** `sealGate` has a CAS guard and then the composite
guard. Disabled independently: **M8 (CAS off) failed exactly 1 test and no composite test; M5
(composite off) failed 7 tests and no CAS test.** Neither absorbs the other.

**Blind spot (c) — a constant the test imports:** mutating `PROVIDER_OPEN_CONDITIONS` would move
`openConditionIdsFor`'s assertion with it. So the ids and their owning plans are pinned by a
**whole-value comparison against written-out LITERALS** in `contracts.test.ts`, and the
provider-level set is compared against the register's own markdown table. M9 mutates the SCHEMA
literal rather than the imported constant for the same reason.

**Plus 11 row mutations in the CLI's own `--self-test`**, each observed RED against a mutated
in-memory tree, with the real tree re-run afterwards to prove the baseline is clean — and **9 seal
combinations including one that MUST resolve to `pass`**, because a gate that refuses everything is
broken rather than safe.

## Deferred / known gaps (recorded in the playbook, not fixed)

- **Invariant 1's read-only scan is armed but has never bitten.** There is no lane module in the
  tree for it to scan, so it is proven only against a synthetic module in `--self-test`. The first
  real provider lane in wave 6 is its first real test.
- **`sealGate` writes no audit row.** `providerGates` is deployment-global and `audit` is
  tenant-scoped, so there is no tenant to attribute a deployment-wide owner judgment to. `revision`
  and `evidenceRef` are the only history a gate keeps.
- **A condition id is pinned only by a literal in `contracts.test.ts`.** Renaming one there and in
  the seal invocation together would be self-consistent and silent; the register's table pins the
  *provider* and the *owning plan*, not the slug.
- **`--apply` is the one non-offline path** and shells out to `npx convex run`. Marked with a
  `ponytail:` comment naming the ceiling (`ConvexHttpClient`).

## What this does NOT mean

**No requirement was completed. `requirements-completed: []`.** REVN-01/02/03/05 stay pending. There
is still no provider adapter, no OAuth callback route, no connections UI and no live read. All four
admission conditions survive untouched. `check-provider-lane.mjs --all` says **consistent**, and
consistent is not passed — it says every lane is `pending` and zero are green. What landed is the
machinery that will refuse to let any of that be misreported.

## Self-Check: PASSED

- `packages/backend/convex/providerGates.ts` — FOUND
- `packages/backend/convex/providerGates.test.ts` — FOUND
- `scripts/check-provider-lane.mjs` — FOUND
- `.planning/phases/28-connector-backed-revenue-pack/28-26-SUMMARY.md` — FOUND
- commit `1bb8b3b` — FOUND
- commit `40047f3` — FOUND
