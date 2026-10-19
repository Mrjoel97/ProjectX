---
phase: 48-readiness-and-qualification-closure
plan: "02"
status: partial
completed: false
requirements-completed: []
---

# 48-02 — Read-only recovery and native refusal preparation

The user restored the signed-in Convex dashboard session on 2026-10-19. Existing internal **queries only** inspected production `opulent-octopus-494`; no custom query, mutation, impersonation, model call, role change or production deployment was used. The redaction-safe observation is `48-RECOVERY-2026-10-19.json`; original rendered outputs stay in the private local evidence directory outside Git. This observation is not one of the three certified Phase23 artifacts and does not independently identify deployed source revision.

## Actual recovery

- A is already owner; B is non-owner. The old fresh-non-owner/bootstrap sequence cannot be rerun unchanged.
- A's ledger returned four rows below the500-row cap for August1 through October20 UTC: one historical authoring envelope and its closure, plus a separate ordinary embedding reservation/actual pair. The separate embedding actual is not a probe turn. This is a bounded window, not a whole-lifetime financial assertion.
- Exact historical budget `ps76dmw7zp8rngqbdbcddw6f558edfxc` is closed and expired, with zero calls, spend, unsettled calls or unresolved cents. It cannot fund new work.
- Its exact source thread `m57929vc8gh530905dxbs799hd8ecmv4` has zero candidates and authoring tool calls. A has zero tenant-skill rows and active tenant skills. Probe control has zero started, finished, failed or containment turns. Repeated source/probe/budget reads agree.
- These live observations do **not** substantiate the earlier STATE description that initial authoring/refusal turns completed. Preserve that description as historical; current recovery controls the continuation. No candidate or handoff can be reconstructed from it.
- The documented once-lock identity is preserved. Its exact file and the original private auth/attempt receipts are unavailable in this checkout. No lock was reset or removed, and absence is not proof that every historical action was absent.

## Free preparation

The native public-refusal route is disabled outside development and requires explicit server-only candidate/B pins. A dedicated native B session performs one real public mutation call; only literal `OWNER_REQUIRED` qualifies. Offline tests cover loading/identity/owner guards, exact error matching, one-shot execution, invalidation and production404. This is preparation for23-07, **not an observed live refusal**. The helper must run on a freshly authenticated local development origin bound to the exact intended backend; production cookies cannot be copied. Client readiness cannot prevent a concurrent server-side role change, so independent before/after witnesses and an unchanged dedicated B session remain mandatory.

Independent agents reviewed the seam and identified no implementation blocker. Current-suite golden offline checks validate57 fixtures across12gated skills; the actual agent corpus remains46 cases. Operator tests, the1,338-probe artifact validator and six probe-control checks passed before continuation edits; rerun affected checks after those edits.

## Validated continuation

The explicit existing-owner mode reads the old exact source/probe/budget, requires terminal zero-use
state, verifies A owner/B non-owner through fresh native authentication and never calls bootstrap.
A new authorization must differ from the old one; server-side duplicate-authorization protection
prevents another envelope with that same new authorization. The old lock remains untouched.
The handoff validator accepts exactly one owner witness (legacy non-owner-before-bootstrap or
truthful existing-owner-at-start), rejects both/neither/false and preserves historical artifact
bytes plus downstream hash binding. Actual owner decisions and the real B public refusal are not
replaced. An independent source review found no remaining concrete blocker in these changes.

Auth-only qualification supports the same existing-owner identity witness without any budget,
probe or owner-grant path. It requires fresh native sessions and no new spending hash. Focused
checks pass26continuation,7native-auth and24access-route tests; broader web checks pass1,151tests
with the two existing deferred-recurrence skips. All12package typechecks pass;22offline free gates
and the subsequently expanded7probe-control checks pass. Planning regression, artifact1,338-probe
validation and operator checks pass. The production web build passes, including the disabled
qualification route. Repository-wide serial tests pass all11test tasks, including4,602backend
tests and the1,151web tests (two existing defer skips). Changed-file Biome, planning consistency,
watched-playbook coverage and whitespace checks pass. Graphify is unavailable; the shared
Convex-edge fixup completed without graph changes. No paid/live acceptance follows from these
checks. The auth-only receipt directory is now created before sign-in, preventing a successful
login from failing at receipt persistence in a checkout without ignored output folders.

The signed-in dashboard session does not authenticate the local developer CLI. An exact-deployment
read-only query was attempted without codegen/push; it returned `MissingAccessToken`. No new CLI
credential was created or requested from the browser. Local app/backend configuration and fresh
controlled-account sign-in therefore remain live execution prerequisites, not silently passing
readiness. Existing dashboard access remains usable for bounded read-only inspection.

## Remaining checkpoint

New authoring requires its own exact fresh authorization, a new bounded envelope and fresh native controlled sessions; no old envelope or undocumented receipt grants that work. The prepared scope is one inert `offer-architect` adaptation plus one escalation/refusal turn, maximum100cents aggregate and no full evaluation or activation. Exact-row paid evaluation and actual owner activation/rollback remain separate later checkpoints. Missing configuration/credentials and historical private receipts must not be replaced by fabricated readiness. Phase23 and48-02 remain open; Phase49 has not started.
