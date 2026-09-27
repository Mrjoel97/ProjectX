# Phase 49 runner acceptance corrections

Date: 2026-09-23. Root source review; Plan 49-06 remains unaccepted.

The browser spec exercises real owner controls at 1280px/390px, records the server
transcript before the internal witness, and checks immutable artifacts through rollback.
The transcript mutations independently enforce candidate identity, owner, revision,
ordered outcomes, changed edits, and final preview equality. These are useful local
evidence, not production acceptance. Remaining integration review is still open.

## Required runner corrections

1. `phase49-disposable-stack.mjs` currently exits successfully when directory removal
   fails. Make incomplete cleanup or unverified process termination a failing result,
   independently of browser assertions. Preserve the original failure if both fail.
2. Register termination observation before requesting termination; do not equate a
   timeout or a stop request with observed termination. Handle owned descendant processes
   conservatively. Never kill by generic image name or kill a recycled PID without identity
   verification. Do not infer EPERM means an open handle: determine the actual cause.
3. The SQLite deployment received JWT_PRIVATE_KEY. Removing the three standalone files
   does not establish that residual database/storage is inert or secret-free. Remove that
   claim from code/report. Resolve the 12 exact run-owned residual directories safely,
   or retain an explicit unresolved potentially sensitive residual gate. Never inspect or
   print private-key values; never touch the default Convex database.
4. `redacted` replaces empty secrets, and `run` truncates before redaction, which can leave
   partial secrets in diagnostics. Prefer closed error metadata rather than raw captured
   output. Test unset secrets and truncation-boundary cases without real credentials.
5. Harden the exact temporary-root guard using portable path containment and owned-root
   identity, not a Windows separator plus substring test. Refuse broad/outside/symlink
   targets. Add focused lifecycle tests for failed cleanup, failed termination, and safe
   target validation. Formatting and playbook/watch coverage are required.
6. Browser console/pageerror handlers print raw messages. Replace with bounded redaction-safe
   metadata; do not print arbitrary browser/network/auth error strings.

## Remaining integration review findings (same correction batch)

7. `WebRecipeQualification.tsx` permits opening mobile before desktop completes, then
   disables the already-open desktop button permanently. The selected viewport is overwritten,
   so the unfinished desktop lane becomes unreachable without discarding the run. Either
   prevent opening a second lane until the first completes, or allow switching back to an
   existing lane without issuing a second open mutation. Add a rendered regression for this
   ordering and retain the server's duplicate-open refusal. Also expose an explicit empty
   candidate state rather than an empty section after loading.
8. The browser helper checks newly created artifacts' numeric recipe version and renderer,
   but not exact skillId/bodyHash/name despite Plan 06 requiring exact future resolution.
   Retain the captured v1/v2 candidates and assert their exact identity against each created
   site/landing/storefront recipeRef, before and after rollback. Do not weaken immutable-v2
   comparisons. A matching version number alone is not an exact-candidate assertion.

Use focused zero-cost tests first; do not rerun full production builds just to change
logging. A final full run is appropriate only once lifecycle corrections are verified.
No provider calls, production mutation, dependency installation, or default DB access.

The prior goal turn was a status-only response (no implementation progress). This review
adds source-backed acceptance findings and directs the next concrete repair.

## Independent root check

Root reran `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check`
after reviewing the canonical profile hash integration. Exit 0 on 2026-09-23:
implementation `9d153dd40291a8037a306bb20ad327f7f3f24b99e8bd316bc9dfdd382a44f524`,
fixture `fc9ff50300ef7de36d4b2e7f28ea32518e10d7f2ad4e18d258ec6e80caa2b379`,
reported costUsd 0. This confirms the current exact deterministic evaluator check,
not browser acceptance, cleanup completion, or any production gate.

## Root residual cleanup follow-up

After the corrected browser run, root validated the two exact residual paths
`C:\Users\expert\AppData\Local\Temp\pikar-phase49-enRK8i` and
`C:\Users\expert\AppData\Local\Temp\pikar-phase49-g2R52Z`, including absence of
reparse points, and attempted native PowerShell removal with `require_escalated`.
Both commands exited 1 on final directory removal with Windows reporting that the
directory is used by another process. Both nonetheless removed the database/storage
contents. Fresh recursive `Get-ChildItem -Force -ErrorAction Stop` readback returned
zero descendants for each exact directory. No process was killed and the default
Convex database was untouched. The synthetic database/storage files were deleted
directly (not moved to trash); empty directory removal remains unresolved.

This supersedes the worker handoff's last observation of potentially sensitive
files in those two roots, but does not convert the runner's exit 1 into success.

## Correction verification by root

Root inspected the revised runner, lifecycle helper/tests, viewport gating/empty
state, and captured-candidate identity assertions. Independent commands passed:
`node --test apps/web/e2e/phase49-stack-lifecycle.test.mjs` (5/5, exit 0) and
`pnpm --filter @pikar/web test -- webRecipeQualification` (4/4, exit 0).
The runner now preserves primary and cleanup failures, suppresses raw diagnostic
output, observes captured direct-child exit, checks listeners separately, and
requires owned-root removal for success. It explicitly does not prove descendant
termination merely from a signal request. The browser spec now binds new artifacts
to captured exact name/version/skillId/bodyHash and retains immutable v2 comparisons.

These corrections satisfy the reviewed code findings, but Plan 06 remains open:
the final corrected stack command exited 1 on root removal. A bounded read-only
worker is identifying holders of the 13 empty run-owned directories; it has no
authority to kill unidentified processes. No further full browser run is needed
merely to reproduce the already-observed directory cleanup failure.

## Minimal lifecycle isolation

The subsequent diagnostic in `phase49-minimal-lifecycle-diagnosis.md` separates two
observations: bare synthetic backend start/stop removed its root, while adding a successful
local-only function push reproduced the final directory sharing violation. Backend exit and
both free listeners were observed in each case. The latter probe's contents were removed;
its exact empty residual `pikar-phase49-MygGTP` brings the known empty-root count to 14.
This narrows the trigger but does not identify the holder or justify changing cwd to hide it.
Root requested a synthetic-only Windows Job Object capability probe to determine whether
task-owned descendant lifetimes can be controlled before changing the runner. No new full
browser run, acceptance, or production operation follows from the diagnostic.

## Job ownership implementation contract

The synthetic capability probe stopped both owned child and grandchild on job-handle close.
This supports implementation, not acceptance of the backend lifecycle. The serial Sol worker
now owns the runner/helper and focused new Windows broker/tests, with these root constraints:
assign the backend before execution/descendant creation; no inherited job handle or breakaway;
handle normal stop and parent EOF; verify job cleanup rather than only requesting it;
fail closed on setup, accounting or cleanup failure; retain independent listener and exact
owned-root checks and secret-safe diagnostics. The probe's accounting query error must be
resolved, not suppressed. No default database, provider calls or broad process kills.
Focused synthetic tests precede one backend-plus-push probe; a full browser/build run is
withheld until root reviews that correction evidence. Existing 14 empty roots remain open.

## Root final Plan 06 local qualification (2026-09-23)

Root reviewed the final broker, Node helper, runner and focused tests against the
gated-assignment, closed-protocol and cleanup contract. Independent
`node --test apps/web/e2e/phase49-stack-lifecycle.test.mjs
apps/web/e2e/phase49-windows-job.test.mjs` passed 8/8, exit 0. The final corrected source
hashes match the worker's report. Root then ran
`node apps/web/e2e/phase49-disposable-stack.mjs` as one fresh isolated stack:

- Local function push, disposable JWT/JWKS and offline-fixture setup: exit 0 each.
- Production webpack build and authenticated Chromium qualification: exit 0 each.
- Six exact v1/v2 candidate runs, three immutable v2 artifacts and three post-rollback v1
  artifacts; v2 refs `ts7dqt96nyrsdwcz0h1xnahh2s8ezs9z`,
  `ts756n4akp4qyc6by8yw4d6dp18eznjx`,
  `ts7an981q5z33yft9w0zafbbsn8ezj4f`.
- Exact fixture rows cleaned: 6/6. Exact owned temporary root removed: true.
- **Whole runner exit 0.** A fresh inventory found only the same 14 older empty roots;
  this run added no residual root.

## Historical empty-root cleanup follow-up (2026-09-23)

The preceding 14-root statement was accurate at the time of that runner review but is
superseded by this later independent cleanup. Root obtained Microsoft's signed Sysinternals
Handle diagnostic, used it read-only to map each of the 14 exact empty `pikar-phase49-*`
directories to a distinct orphan `node.exe` handle holder, and corroborated the exact
PID, executable path and process start time with Windows process metadata. Each exact
directory was rechecked as empty and not a reparse point, and none of the mapped holders
owned an active listener. Root stopped only those 14 identified orphan processes, then
nonrecursively removed only their 14 validated empty directories. All 14 removals
succeeded; the old mapped PIDs were no longer alive on readback. No file contents were
deleted, no current Plan 07 runner root was touched, and no broad process kill was used.
Those empty directory names were deleted directly rather than moved to trash and are not
recoverable as directory entries; they held no files. New disposable runs retain their
own independent cleanup requirement.

Root independently reran the exact evaluator self-check: exit 0, implementation
`9d153dd40291a8037a306bb20ad327f7f3f24b99e8bd316bc9dfdd382a44f524`, fixture
`fc9ff50300ef7de36d4b2e7f28ea32518e10d7f2ad4e18d258ec6e80caa2b379`, costUsd 0.
The Plan 06 repository/local functional and lifecycle proof is now accepted. It does not
verify production or external provider gates. Historical empty roots, Git-unavailable live
playbook verification/commit, and the stalled Graphify refresh remain explicit environment
work; they are not turned into passing checks by this browser result.
