# Phase53 local validation — 2026-10-21

## Hosted staging continuation — 2026-10-22

The owner requested a separate environment. Dedicated frontend/backend cloud builds, anonymous real-browser auth pages, no-index headers and missing unpublished route refusals passed. All three recipe candidates passed hosted deterministic20-case checks each at zero model cost; none has browser qualification or activation. There are no stage accounts or website projects, and both model/media kill switches are on. Staging email credentials and bounded model access remain unconfigured. See [53-02 summary](53-02-SUMMARY.md) and [actual observation](53-02-STAGING-2026-10-22.json). These observations supersede only historical statements below that no staging deployment had run; they do not establish authenticated/model/publication/merchant acceptance.

Scope: isolated `codex/online-presence-discovery-20261021`, based on
`821c3206e47eb4cec0ebcf3d99cf943358f2910a`. Recovery source is PR36 immutable
`5d7b9e5a8e0acaecbdc110123718798565421b5c`; its prior hosted verdicts do not qualify this source.

## Executed local evidence

| Check | Actual result |
| --- | --- |
| Full contracts tests | 7 files,129 passed; contracts typecheck passed |
| Full core baseline | 66 files,1692 tests;1689 passed and3 storage/table-registry drift failures |
| Core corrections | Exact real `artifactStorageId` map and78-table tripwire corrected; entire failed `tenantData.test.ts`14/14 passed; core typecheck passed |
| Full frontend baseline | 79 files,1188 passed,2 existing skips; later review tests added2 scenarios |
| Final frontend review recheck | SiteEditor8, PreviewCanvas6, OnlinePresenceCard6:20/20 passed |
| Full backend during integration | 193 files,4685 passed,18 failed while agents were finishing shared exports/config and source identities; this run is not a passing full-suite receipt |
| Final backend integration recheck | 18 files,365/365 passed: isolation, redaction, watchdog, cockpit, authoring-probe, agent runner, tool registry, trace parity, online-presence, recipes/evaluator/registry, HTTP, projects/lifecycle, forms/runtime and web tenant privacy |
| Final source-identity/registry recheck | 5 files,222/222 passed: vertical corpus, all187 existing skill tests, recipe/evaluator and online-presence suites |
| Real specialist tool cycle | Existing `runSpecialistTurn` uses scripted model to read trusted context → save brief → build real immutable four-page project. No approval/publication tool; exact source metadata assertions pass |
| Probe isolation | Actual authenticated `sendCockpitMessage` with a registered authoring-probe/service thread refuses before human source, model, spend claim or trace work;14/14 online-presence native tests pass |
| Privacy regression | Real artifact bytes and all five new tables export/erase; other tenant rows/files and immutable audits survive |
| Tool grants |17/17 tests: exact frozen service tuple grants, copied arrays/named tools cannot grant service writes |
| Typechecks | Backend,web,core,contracts completed successfully; latest backend check after shared integration passed |
| Production frontend build | `pnpm --filter @pikar/web build` exit0;39 static pages; sites and preview routes included. Process-only loopback Convex URLs; no secret files copied or remote deployment contacted |
| Evaluator identity tests |9/9 isolated source edit/restore checks passed; both fingerprints change without fixture changes |
| Free gates |23/23 registered offline gates green; final golden self-check also passed after final generated source refresh |
| Compiler/provenance |8 deterministic records;3 immutable MIT source inventories; adversarial provenance self-test and compile `--check` passed. CI now checks deterministic generated output |

The failed backend baseline consisted of unfinished recipe exports, then-unavailable owner methods,
then-old host binding behavior, the stale thirteen-cron inventory, the redaction scan's end anchor,
an unfinished scripted tool test, and deliberately stale evaluator pins. Final focused rechecks
cover all eight failed files; remaining185 baseline files passed. A fresh full backend run after
all fixes was not executed. Existing harness stderr about absent RAG/workflow fixtures is not
reclassified as hosted success or silently suppressed.

## Source identities and governance

- Golden revision: `2026-09-11.budgeted-evaluator.d2ff5053a85dfc857dcfc8566b91ceb15bafaf95ae409704ee6cc5f81e6012c4`.
- Golden46-case hash unchanged: `5dbe6fdbd447ab2a152ccf928d195ed404ca3bf431f5240397f6be3b627e55fd`.
- Vertical evaluator revision: `5646d432942476c0df940d80098b57aaed37d85b43315df19c8fb59825cb8c3a`; six lanes/40 cases; corpus hash unchanged.
- Design bundle: `d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8`.
- `graphify query/update` was attempted but the executable is unavailable. Scoped source/history
  inspection was the fallback. `extract-convex-edges.mjs` ran with this worktree's process-local
  safe-directory configuration and registered78 tables. Missing new AST nodes remain unresolved;
  this is not a claim of full graph regeneration.
- Playbook watches include the new feature; affected cockpit/registry/privacy/authorization/
  recurrence/CI/media/vertical documentation is updated. Planning/playbook checks and final lint
  outcomes are confirmed before the branch is saved.

## Not established by local checks

No paid model/provider call, shared registry seed, live activation, staging/production deployment,
real customer/publication, native authenticated browser acceptance or merchant checkout ran.
Scripted models establish the tool/data integration, not actual model quality. Browser-like UI
tests use jsdom; they are not hosted visual/semantic acceptance. Public runtime configuration,
new canonical recipe activation and actual browser qualification remain prerequisites. Source
references preserve provenance; they do not prove every marketing claim. Private/planned/stale
warnings require reviewing the actual public copy. Commerce is explicitly unavailable.

Next work is53-02 hosted acceptance/release admission and53-03 merchant commerce. Requirements
OPRES-01..04 stay open until their corresponding acceptance exists.
