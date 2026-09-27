---
phase: 17-calendar-actions
plan: 10
subsystem: calendar-offline-verification
tags: [calendar, convex, vitest, playwright, mutation-testing, disposable-stack]

requires:
  - phase: 17-09
    provides: tenant-safe managed-event staging, review card, and Approve-only execution
provides:
  - bounded 457-test two-provider backend Calendar gate and 72-test core gate
  - seven current isolated production-source mutation kills with restored green tests
  - one passed authenticated management-card browser test on an owned disposable loopback stack
  - refs-only two-provider live UAT protocol for Plan 17-11
affects: [17-11, ACTN-02, cockpit, calendar-live-gate]

tech-stack:
  added: []
  patterns:
    - exact JSON-reporter count and duration gate for one disposable browser spec
    - local admin/backend/app origin binding before ephemeral signup or fixture calls
    - finish local CLI fixtures before fresh browser sign-in

key-files:
  created:
    - .planning/phases/17-calendar-actions/17-10-SUMMARY.md
  modified:
    - packages/backend/convex/calendar.test.ts
    - apps/web/e2e/calendar-management.spec.ts
    - apps/web/e2e/phase49-disposable-stack.mjs
    - apps/web/e2e/phase49-stack-lifecycle.test.mjs
    - .planning/phases/17-calendar-actions/17-UAT-RUNBOOK.md
    - docs/playbooks/cockpit.md

key-decisions:
  - "Use the existing Phase 49 fresh loopback stack for the one Calendar browser spec, preserving its three prior allowlist entries and owned cleanup."
  - "Microsoft delete remains a provider_unsupported refusal under ADR-023; native cleanup is not product management."
  - "Keep ACTN-02 pending until real Google/Microsoft and owner visual evidence; the offline gate alone does not close it."

patterns-established:
  - "A browser pass requires exactly one expected Chromium result, zero skips, one passed attempt, positive measured duration, and clean owned teardown."
  - "Each live lifecycle row retains the exact smoke.calendarLifecycleReadback shape; provider-wide duplicate and cleanup counts need separate bounded measurements."

requirements-completed: []
duration: multi-session
completed: 2026-09-25
---

# Phase 17 Plan 10: Calendar offline Nyquist and operational gate Summary

**The two-provider Calendar matrix, seven current mutation checks, and an authenticated disposable management-card browser test pass within measured bounds; real provider and owner UAT remain for Plan 17-11.**

## Verification

| Gate | Measured result |
|---|---|
| Core Calendar, management, action-type tests | 3 files, **72/72** passed; Vitest duration **1.70 s** |
| `run-calendar-test-gate.mjs --timeout-ms 90000 --test-timeout-ms 20000 --hook-timeout-ms 10000` over seven backend files | **457/457** passed; wrapper elapsed **43,083 ms**, below the 90 s outer bound |
| `node apps/web/e2e/phase49-disposable-stack.mjs e2e/calendar-management.spec.ts` | Exact Calendar Chromium feature **1/1 passed, 0 skipped**, reporter `durationMs=27953.673000000003`; local audit check exited 0 |
| `node --test apps/web/e2e/phase49-stack-lifecycle.test.mjs` | **6/6** passed; final run duration **1,324.6054 ms** before the duration-only runner edit, then **6/6** passed in **461.5557 ms** after it |
| Core/backend/web `typecheck` | All exited 0; backend reported no TypeScript diagnostic |
| Production web build | Phase 49's existing offline font mock with `next build --webpack` exited 0, both standalone and within the final disposable run |
| `node scripts/check-playbooks.mjs`, strict `check-planning.mjs --exit-code`, changed-file `git diff --check` | All exited 0 before this summary was created. After summary creation, playbooks and diff still exit 0; strict planning reports only the ROADMAP phase-17 row mismatch (9/11 versus canonical 10/11). ROADMAP is reserved for the parent review. |

The default Turbopack `pnpm --filter @pikar/web build` tried to fetch Google fonts without network and failed. Turbopack with the existing local font mock also failed to resolve its internal CSS module. The repository's established Webpack/offline-font production recipe passed without changing app or font source.

After the final browser pass, the runner printed `Phase 49 exact owned temporary root removed: true`. Independent read-only checks found **zero** listeners on ports 3410, 3411, and 3112, **zero** `pikar-phase49-*` temp roots, and no `convex-local-backend` process. The account, signing keys, and admin key were generated inside that owned disposable stack; no provider account, remote deployment, OAuth consent, paid call, or external send was used.

## Offline requirement matrix

The focused backend/core suite covers Google and Microsoft availability/reconnect, Google deterministic create ID and 409 reconciliation, Microsoft `transactionId`, desired-state update reconciliation, conditional `If-Match` and 412 refusal, replay, Google delete missing-as-success, attendee-bearing refusal before write, tenant isolation across plan/registry/terminal, exact audit/DLQ key sets, stage-to-Approve separation, and double-approval no-op. Microsoft delete is tested as **explicit `provider_unsupported` with no Graph delete/cancel request** under ADR-023.

`smoke.calendarLifecycleReadback` tests assert its exact key set, positive plan/registry/audit witnesses, three independent etags, audit name/key-set/count shape, duplicate event types, measured content/token absence with positive checked-string counts, a leak detector negative control, and foreign-tenant non-observation. The one real browser test proves the bounded listing, update/delete staging, actual review cards, code-owned trace, and Approve buttons before any provider write. It does not prove a real provider event.

## Current mutation table

An isolated 358-file Convex copy received seven source mutations. Seven specifically named tests failed by assertion (**0/7 passed**); after byte-for-byte restoration, the same selection passed (**7/7**). The copy, temporary Vitest config, and JSON reports were removed. No shared production source was mutated.

| Class | Mutant | Named failing test |
|---|---|---|
| Approval reachability | Reference `api.cockpit.executePlan` from the model loop | `llm.ts holds NO reference to the Approve gate or the fan-out at all (not even by name)` |
| Tenant guard | Bypass managed-plan tenant comparison | `a plan belonging to another tenant is a tenant mismatch, not a managed event` |
| Attendee refusal | Invert the live attendee gate | `guests added at the provider refuse the write, even though the registry says attendee-free` |
| ETag / If-Match | Rename Graph PATCH's `If-Match` header | `with the measured probe bound to this deployment and account, it PATCHes conditionally` |
| Retry reconciliation | Disable equal-desired-state success | `a retry after a lost success reconciles instead of reporting a false conflict` |
| Token rotation | Persist the old Microsoft refresh token | `a ROTATED refresh token replaces the stored one` |
| Provider default | Route absent `calendarProvider` through Microsoft | `an ABSENT calendarProvider still takes the Google path` |

The prior Plans 05–09 mutation ledgers remain historical evidence for their wider mutants; this table reports only the seven actually rerun here.

## Google regression and existing worktree

The old create fixture with **no** `calendarProvider` passed as Google in the 457-test suite and in the restored mutation selection. The core grant test `a gmail+calendar grant does not satisfy the Drive scope` passed. The unchanged grant test files have SHA-256 `gmail.test.ts` `0C7D8DAFF8A565D21E846D337E11517986F110F2F552C2A53165AFE9B8461A6B`, `httpAuth.test.ts` `41FF61F7BC0776E044D7EFB041A9B6F05F02081664E2F27C176F0A0C20D873F4`, and `vaultDrive.test.ts` `3C1A5280E1539CA292D0E0B279DFE14CEFE874BF8841836D2270C25514B9CB23`.

Pre-existing edits in `cockpit.test.ts` (SHA-256 `B5D85D1F230FB9115FBA518EDDE22A8DD58BA9EFCD74136C99E3853FB93442A9`) and `smoke.ts` (`605E256048364972190693B0527283E2D9C10DC4B8145EF01E5114553196308B`) remained byte-identical. Earlier edits in `docs/playbooks/cockpit.md` were preserved and a Phase 17 verification note was added. No commit was made, as directed; planning STATE, ROADMAP, REQUIREMENTS, and Plan 17-11 were not edited.

## Deviations and resolved issues

1. **[Rule 1 - Test bug] Google consent static scan counted a test fixture URL.** Restricting the scan to non-test source preserved its positive anchor and exact `gmailAuth.ts` ownership. The restored backend gate passed 457/457.
2. **[Rule 3 - Browser harness] The ordinary Playwright setup lacked seeded credentials.** The existing Phase 49 owned loopback runner now allowlists the one Calendar spec, passes exact admin/backend/app bindings, and the spec creates a random invite/signup identity only under explicit disposable flags. JSON-report validation rejects setup-only, skipped, repeated, or extra tests. The original three allowlist entries and owned cleanup remain intact.
3. **[Rule 1 - Browser fixture] Local `convex run` invalidated the authenticated session.** The spec completes every CLI fixture first, then signs in with its ephemeral account and rechecks the JWT tenant before rendering cards.
4. **[Rule 1 - Browser fixture] `agentSteps:finish` returns empty stdout on local CLI success.** Only that write-only fixture accepts an empty successful result; result-bearing fixtures still require JSON. The rendered trace positively verifies the finish effect.
5. **[Rule 1 - Browser fixture] Tenant-wide `latestTurn` displayed the most recently seeded delete trace while the test inspected the update thread.** The update trace is seeded last, and the delete card is checked against its exact plan.

`graphify update .` was attempted with a hard 120 s bound and returned `ETIMEDOUT`; no graphify process remained and all four pre-existing dirty graph hashes were unchanged. `node scripts/extract-convex-edges.mjs` exited 0 with `+0` Convex/table edges. The graph refresh is not claimed complete and no existing graph edit was overwritten.

## Plan 17-11 live checklist and limits

The [UAT runbook](./17-UAT-RUNBOOK.md) gives the agent-operated, no-terminal-command owner protocol: app/env/callback preflight, actual H3 stored-scope negative before Google reconnect, bounded legacy migration completed before listing, provider availability, stage/card/Approve creates, owner out-of-band stale-etag edits, 412 refusals, fresh restaged updates, Google governed delete and idempotent replay, Microsoft delete refusal, native cleanup, and final owner visual check. `17-LIVE-EVIDENCE.json` was **not** created. ACTN-02 remains pending real Google/Microsoft and owner evidence, with Microsoft management explicitly **minus Microsoft delete**.

Every lifecycle evidence row must preserve an unmodified exact `smoke.calendarLifecycleReadback` result and non-vacuous content/token checks. That readback observes one named event and cannot alone count provider-wide duplicates, migration completion, or final residue; the runbook requires separate bounded measurements for those operational facts and forbids a green reconciliation while they are absent. No offline result is substituted for those live observations.

## Self-Check: PASSED FOR OFFLINE PLAN 17-10

The summary and claimed implementation files exist. The superseded partial-evidence note was removed. No commit check applies because commits were explicitly withheld in the shared dirty worktree. Root reviewed the final diff, updated only the ROADMAP phase-17 planning entry to 10/11 without closing ACTN-02, and independently reran the lifecycle test (6/6), strict planning, playbook and diff checks (all exit 0). Plan 17-11's real-provider and owner evidence remains open.
