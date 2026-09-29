---
status: investigating
trigger: "Investigate only, do not edit files unless root cause is confirmed and you first report it. Symptoms prefilled: expected local owner:findUserIdByEmail returns JSON/null when launched by E2E provisioning with local backend :3210 healthy. Actual corrected run used pnpm --filter @pikar/web exec playwright test e2e/google-oauth-readiness.spec.ts --project=chromium --workers=1, intended six tests began; provision owner lookup returned no stdout (exit_nonzero) after 3.2 sec; OAuth did not run. pnpm tail says Command \"playwright\" not found, potentially a misleading trailing wrapper error. A direct detached local Convex golden readiness query previously returned valid payload before known Windows UV teardown -1073740791. Backend PID6300 and web PID23112 currently HTTP200. Parent directs read-only diagnostic: inspect actual subprocess cwd/CLI resolution, bounded no-stdout exit/signal classification, distinguish pnpm tail error from actual missing binary. No new account creation/retries, no provider/paid calls, no watcher changes, no secret/email/code output, do not infer account state. Graphify tool unavailable in current tool inventory; state this in debug record. Report root cause evidence and minimal fix/tests proposal."
created: 2026-09-20T16:20:00+03:00
updated: 2026-09-20T18:15:00+03:00
---

## Current Focus

hypothesis: Confirmed: Windows pnpm wrapper argument forwarding is unsafe for detached Playwright control here: both `exec playwright` resolution and a literal `--` package-script run failed. The direct Node Playwright CLI vector is the only validated detached controller. In addition, the installed Convex CLI deliberately prints no stdout for a returned `null`, and this owner lookup returns `null` for an absent address; an empty result for that particular absence path is therefore expected rather than a generic transport classification.
test: Direct Node `--list` validates exactly the intended provision/auth/OAuth set. Source inspection establishes the nullable CLI output contract; it does not prove the exact prior lookup's server return.
expecting: A structured, non-null query result for any future provisioner absence check, with separate readiness evidence from the live owner.
next_action: Repair verified offline. Do not launch browser provisioning until a fresh runtime release; the first historical tenant outcome remains unknown.

## Symptoms

expected: Local `owner:findUserIdByEmail` returns JSON or JSON null when E2E provisioning launches against healthy local backend :3210.
actual: The corrected outer command began intended tests, then the owner lookup returned no stdout classified `(exit_nonzero)` after 3.2 seconds; OAuth did not run.
errors: pnpm tail says `Command "playwright" not found`; child lookup has no stdout.
reproduction: Do not reproduce: account provisioning is mutating. Inspect existing code/logs only.
started: Wave 1 browser verification on 2026-09-20.

## Eliminated

- hypothesis: The `Command "playwright" not found` tail was merely a post-test wrapper artifact.
  evidence: A standalone, non-test command `pnpm --filter @pikar/web exec playwright --version` reproduced the same command-not-found failure.
  timestamp: 2026-09-20T16:24:00+03:00

## Evidence

- timestamp: 2026-09-20T16:20:00+03:00
  checked: Tool inventory
  found: Graphify was not exposed as a callable tool, but the local `graphify` executable is installed and was used for a read-only traversal before source inspection.
  implication: Investigation uses graph context plus local static and sanitized process evidence.
- timestamp: 2026-09-20T16:22:00+03:00
  checked: Provisioner source, package scripts, installed executable paths, and redacted corrected-run logs.
  found: The provisioner invokes `process.execPath <repo>/packages/backend/node_modules/convex/bin/main.js run owner:findUserIdByEmail <JSON>` with cwd `packages/backend`; both the Convex entrypoint and `apps/web/node_modules/.bin/playwright.cmd` exist. The run reached Playwright's provision project and failed inside that child at 3.2 seconds; only after Playwright printed its result did pnpm emit `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found`.
  implication: The tail cannot be the initial cause of the child failure; its wording alone is insufficient evidence that the outer binary was unavailable.
- timestamp: 2026-09-20T16:24:00+03:00
  checked: A standalone filtered pnpm executable-resolution command.
  found: `pnpm --filter @pikar/web exec playwright --version` fails before a test with Windows `playwright is not recognized` and pnpm `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`.
  implication: The outer controller's corrected `exec playwright` form is invalid in this environment; prior output cannot certify a browser execution.
- timestamp: 2026-09-20T16:26:00+03:00
  checked: Local Playwright shim and package-script `--list` invocation.
  found: The present shim targets `apps/web/node_modules/@playwright/test/cli.js`, which exists. `pnpm --filter @pikar/web test:e2e -- e2e/google-oauth-readiness.spec.ts --project=chromium --list` successfully enumerated five non-provision tests (the provision project is absent because provisioning was not opted in).
  implication: This validated only an interactive-shell route, not detached Windows pnpm argument forwarding.
- timestamp: 2026-09-20T16:27:00+03:00
  checked: Process environment and backend `.env.local` configuration keys, without printing configuration values.
  found: Process-level Convex URLs are absent; the backend-local dotenv contains a Convex URL whose parsed host is `127.0.0.1` and port is `3210`.
  implication: The exact child cwd has a local target available; one read-only query can test transport without touching a deployment, paid model, provider grant, or account state.
- timestamp: 2026-09-20T16:29:00+03:00
  checked: One 15-second-bounded direct query using the same Node executable, Convex CLI entrypoint, backend cwd, and a reserved non-existent address.
  found: The child produced zero stdout/stderr bytes and exceeded 15 seconds, so it was terminated by the diagnostic harness before it could mutate anything.
  implication: This is an inconclusive bounded observation. Because its execution permission/session was not recorded as escalated, it cannot be generalized to the earlier 3.2-second exit or labeled a backend transport defect. Current TCP health alone remains insufficient evidence of function readiness.
- timestamp: 2026-09-20T16:30:00+03:00
  checked: Local HTTP health and static Convex CLI configuration discovery, with broad source-map output intentionally disregarded.
  found: `GET http://127.0.0.1:3210/instance_name` returned HTTP 200 with a local-instance-shaped body. The local Convex CLI includes `.env.local` discovery for its working directory.
  implication: HTTP health and CLI-readiness remain distinct evidence planes; this observation alone does not diagnose the earlier child exit.
- timestamp: 2026-09-20T16:33:00+03:00
  checked: `packages/backend/convex/owner.ts` declaration for `findUserIdByEmail`.
  found: The function is an `internalQuery`; its implementation documents and performs only a row read, with grants handled by a separate mutation.
  implication: The single reserved-address direct diagnostic was read-only and did not create an account, provider grant, or paid-model action.

- timestamp: 2026-09-20T16:34:00+03:00
  checked: Exact package-script controller with `--list` only, no provision flag.
  found: `pnpm --filter @pikar/web test:e2e -- e2e/google-oauth-readiness.spec.ts --project=chromium --workers=1 --list` enumerated auth setup plus exactly four named Google OAuth readiness tests; it did not enumerate the provision project or Chrome profile files.
  implication: The package-script argument route is syntactically valid in that interactive invocation only. It does not certify detached pnpm handling, runtime backend readiness, or authorize provisioning.

- timestamp: 2026-09-20T16:34:00+03:00
  checked: Elevated, redacted process inventory after the manually bounded read.
  found: No local Convex CLI child using `packages/backend/node_modules/convex/bin/main.js` remained.
  implication: The bounded diagnostic left no orphaned CLI process.

- timestamp: 2026-09-20T16:37:00+03:00
  checked: One parent-authorized escalated, 60-second-bounded exact provisioner child lookup using a synthetic nonexistent address. The command used Node plus the backend Convex CLI entrypoint and backend cwd; it emitted only closed diagnostics.
  found: It returned in 8.9 seconds with status `3221226505` (signed `-1073740791`), no signal/spawn error, empty stdout, and nonempty stderr withheld by policy.
  implication: The known Windows teardown status alone is not a successful query. Because no validated JSON payload was emitted, this does not establish a valid-null owner lookup, backend readiness, or the cause of the earlier 3.2-second exit.

- timestamp: 2026-09-20T16:39:00+03:00
  checked: Installed Convex CLI print logic and `owner:findUserIdByEmail` return path, source-only.
  found: The CLI emits output only when the returned value is non-null (`if (result !== null) logOutput(...)`). The owner query returns `null` when its user-row lookup is absent.
  implication: Empty stdout from the synthetic absent-address query is compatible with a successful `null` result, including a later Windows teardown exit. This fact must be applied only to this documented nullable query path; arbitrary empty stdout remains invalid.

- timestamp: 2026-09-20T16:54:00+03:00
  checked: Shared-resolver repair and focused offline checks.
  found: `findUserIdByEmail` retains its nullable operator contract and duplicate refusal; a new internal provisioning envelope returns a non-null `{ result }` object from the same private resolver. Provisioning validates this envelope at both lookup sites and still rejects arbitrary empty or malformed child output. A pre-existing diagnostic-helper TypeScript mismatch for real Node `Error` values was detected by web typecheck and repaired with a closed-code extractor.
  implication: Future absent-user provisioning reads remain observable without changing the existing lookup contract or treating empty stdout as a success. Focused owner tests (19), web diagnostics tests (2), backend and web typechecks all passed after the repair; no runtime fixture, provider, or paid call occurred.

- timestamp: 2026-09-20T16:58:00+03:00
  checked: One parent-authorized escalated local read of the new provisioning envelope using a synthetic nonexistent address, exact backend CLI child cwd and a 60-second bound.
  found: Exit status was zero; the parsed response was exactly `{ result: null }`; stderr was empty.
  implication: The non-null envelope makes the documented absence observable without accepting arbitrary empty stdout. This is readiness for the narrow local provisioning harness, not browser acceptance or a finding about the historical unknown identity.

- timestamp: 2026-09-20T17:07:00+03:00
  checked: One released direct-Node OAuth Playwright run, after the non-null envelope preflight and recovered local web server.
  found: The direct controller selected exactly six intended tests and did not discover Chrome-profile files. Provisioning reached the signup page, but the Create Account button remained disabled for its full 30-second wait; the five dependent tests did not run. The button is disabled only while busy or `invites.preflight` is not valid.
  implication: This is a product/harness preflight blocker, not a controller discovery failure. The disposable identity's invite/signup state requires read-only reconciliation before any future use; OAuth UI acceptance remains not run.

- timestamp: 2026-09-20T18:08:00+03:00
  checked: One anonymous synthetic invalid-invite browser probe against the running `next dev` server on :3111, followed by the same probe against the existing production build served by `next start` on :3112.
  found: On :3111, navigation completed; all 20 script responses returned 200 and finished; there were no request failures or page errors; the static page exposed two Show-password controls and accepted the click dispatch, but the password input remained `type=password` after a bounded React-state poll. No Convex WebSocket was observed; only six HMR sockets to `127.0.0.1:3111` reported `NET::ERR_INVALID_HTTP_RESPONSE`. The same synthetic probe on :3112 changed the password input to `type=text` and settled the invalid invite message.
  implication: The previous :3111 observation is a development-server hydration failure, not evidence of an invalid invite or a Convex preflight rejection. The current production build is the validated browser harness for further unpaid acceptance work; no product repair or provider call is inferred.

- timestamp: 2026-09-20T18:20:00+03:00
  checked: One direct-Node OAuth suite against the verified :3112 production build using the retained storage state, with dependencies disabled; one direct password sign-in setup against the same build; and one released provisioning attempt with local E2E variables loaded in memory.
  found: The retained state was stale and all four OAuth checks found no authenticated connect-Gmail surface. The password setup did not reach the signed-in terminal and the local auth route returned the closed `InvalidAccountId` class. Provisioning stopped before browser navigation because the local Convex CLI owner lookup emitted no output. No provider navigation, signup submit, invite mutation, or outbound message occurred in these attempts.
  implication: Production hydration is fixed, but current authenticated identity/provisioning evidence is still absent. The no-output CLI condition is separate from the :3111 hydration defect and remains unresolved; do not claim OAuth readiness or Wave 1 closure.

## 2026-09-20 production browser re-entry

The local Convex CLI continued to select the remote control plane in this shell, so no further CLI
provisioning attempt was made. Instead, the existing local backend was accessed only through the
direct local Convex HTTP client for the sanctioned disposable invite, owner, and onboarding fixture
seams. A fresh password signup and sign-in then passed on a rebuilt production web server at `:3112`.

The direct Node Playwright run of `google-oauth-readiness.spec.ts` completed **4/4 passed** with a
fresh storage state. The configured authorize URL and scopes were inspected in place; the test never
clicked or navigated to `accounts.google.com`, and no provider/token/outbound/paid operation occurred.
The previous stale-state/`InvalidAccountId` diagnosis is superseded for local readiness, while the
next-dev `:3111` hydration defect remains. Provider, founder, and external-enablement gates remain
open.

## Resolution

root_cause: Confirmed controller defects: `pnpm --filter @pikar/web exec playwright ...` cannot resolve `playwright` in this Windows workspace, and detached pnpm package-script launches preserve a literal `--` so Playwright recursively discovers the Chrome profile. The validated detached vector is direct Node: `node node_modules/@playwright/test/cli.js test <spec> --project=chromium --workers=1` from `apps/web`. Confirmed contract defect in the provisioner: it treated empty stdout as failure even though this installed Convex CLI intentionally suppresses output for `null`, which is the documented absent-user return of its first lookup. The exact historical 3.2-second function return remains unobserved. A separate current `next dev` :3111 hydration defect is demonstrated by the controlled production comparison; it is not a Convex transport diagnosis.
fix: Landed a private shared resolver in `owner.ts`, retaining the original nullable query and adding a narrowly named non-null internal provisioning envelope. The provisioner uses that envelope at both lookup points and refuses arbitrary empty/malformed output. The previously existing `SpawnResult.error` typing did not accept Node's real `Error`; it now accepts that runtime shape while preserving a closed code allow-list.
verification: `exec playwright --version` reliably failed; only direct Node `--list` resolved provision, auth setup and the four intended Google OAuth readiness tests for detached control. CLI source directly shows suppression of null output; owner source directly shows absent-user return `null`. Focused backend 19/19, focused web 2/2, backend typecheck exit 0, web typecheck exit 0, formatter warnings-only for two pre-existing assertions, and playbook check all passed after repair. The synthetic invalid-invite comparison is green on :3112 (hydration and invalid terminal) and red on :3111 (static shell, click without React state change); no account or invite write occurred in that comparison.
files_changed: packages/backend/convex/owner.ts; packages/backend/convex/owner.test.ts; apps/web/e2e/provision-owner.setup.ts; apps/web/e2e/provision-owner.diagnostics.ts; apps/web/app/provision-owner.diagnostics.test.ts; docs/playbooks/authorization.md; docs/playbooks/cockpit.md; .planning/debug/wave1-provision-owner-child-transport.md
