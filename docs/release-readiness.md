# Release readiness and implementation checklist

Last reviewed: 2026-10-17. Implementation starting baseline: `53d96a263f055e14bbb1c6a1a35c6d7bb58c9652`.
Release implementation and deployment evidence: Codex, acting on the repository owner's instructions. On 2026-10-17 the owner assigned Joel (`joel@pikar-ai.com`) responsibility for release approval, incident response, privacy requests, and provider/billing reconciliation. Runbook exercises, backup coverage and specialist review remain separate open requirements.
Current production runtime: `e92bd5e51cc60368dd94095483bdb7b62f8f1690`, verified 2026-10-17 in [release run 39030778689](https://github.com/Mrjoel97/ProjectX/actions/runs/39030778689), after [main CI 39030531634](https://github.com/Mrjoel97/ProjectX/actions/runs/39030531634). READY frontend artifact `dpl_A8FbQAGNYVWazneuxqyYWNuMkSCs`, routes/aliases and legal draft were verified by the release coordinator. Local implementation and tests never imply live provider verification. Production voice/foundation activation and the remaining drills below are still open; staging foundation is enabled for controlled acceptance.

| Gate | Owner role | Current state | Required closure evidence |
|---|---|---|---|
| Operations guide | Release engineer | Current/previous exact-revision local setup and restoration rehearsals passed; hosted recovery pending | Fresh setup, staging release and recovery using only the guide |
| Release configuration | Release engineer | Exact-SHA CI, production configuration gate, Convex dry-run/generated-type check, deploy/seed, staged probe and promotion passed at a129b88 with step-scoped credentials; rollback drill pending | Exact SHA, configuration check, environment protections, successful staged promotion and rollback |
| External delivery | Backend engineer | Implemented locally: durable claims/receipts and manual uncertainty review; live reconciliation pending | Durable attempt state, no blind resend, concurrent/crash/timeout tests and controlled provider reconciliation |
| Cost admission | Backend engineer | Live staging embedding settlement and one synthetic voice response ledger verified; retained initial voice hold, invoice and failure-mode reconciliation remain open | Atomic reservations, all paid callers migrated, idempotent settlement, uncertain holds, provider reconciliation |
| Identity | Security/backend engineer | Isolated native signup verification, replay rejection, recovery/reset and old/new JWT checks passed; expiry and browser acceptance remain open | Cross-tenant negative tests, password verification/recovery, privilege and callback checks |
| Privacy/export/deletion | Security/backend engineer | Synthetic content/file export and isolation passed; native self-deletion plus independent absence of its five known blobs/user/receipts verified; native export/in-flight/provider evidence open | Typed operational events, sensitive-data sink tests, all new content included in export/deletion |
| Graph retrieval | Backend engineer | Bounded indexed traversal and stale-revision filtering tested locally | Adjacency-only reads, cycle/high-degree/isolation regression tests, read-budget evidence |
| Other request scans | Backend engineer | Indexed selection, cursor pagination, bounded working queues and durable cleanup implemented; inventory complete locally | Each scan bounded, paginated or moved to checkpointed work |
| Module boundaries | Backend engineer | Research tools, PDF renderer and current-media readers extracted in addition to traversal/foundation/stock domains; regressions passed | Incremental pure-domain extraction with behavioral regression coverage |
| Voice onboarding | Product/frontend/backend | Production off; staging synthetic tool-free voice connected, received audio and terminated with trusted usage; native microphone/onboarding acceptance pending | Resumable interview, typed fallback, restricted tools, admission budget, real browser/provider evidence |
| Foundation publication | Product/backend | Implemented with six stable document IDs and exact review hash; indexing regressions passed locally | Six documents, provenance, explicit revision approval, atomic publication, searchable approved content |
| Blueprint consistency | Backend engineer | Atomic foundation/Blueprint publication implemented; no Blueprint embedding | Matching published revisions, bounded summary and references, no Blueprint embedding loop |
| Transcript retention | Security/backend engineer | Synthetic staging clock started 2026-10-17; expires 2026-10-24 10:18:29.493 UTC; actual purge/native lifecycle evidence pending | Seven-day checkpoint purge, no application-stored audio, discard/export/deletion coverage |
| Billing and legal | Joel + legal reviewer | Billing deliberately disabled; owner confirmed pikar-ai/Tanzania/contact and Dar es Salaam 17107, Tanzania postal address; Tanzania law/Dar es Salaam courts remain draft pending legal review | Confirmed business inputs and reviewed public content before commercial activation |
| Audit WORM | Service operator | WORM/AWS names absent in production preflight; export remains disabled | Configured retention, export/acknowledgement and recovery evidence; otherwise feature remains disabled |
| Connectors | Provider operator | Per-provider gates remain binding | Current connection, scope/expiry/revoke/read evidence for each enabled provider |
| Recurrence | Workflow operator | Existing gate remains binding | Required actual DST/OAuth/provider traces; do not enable on simulated evidence alone |
| Skill activation | Model operator | Per-skill evidence required | Seed/version identity, evaluation, activation and rollback evidence |
| CI portability/build | Release engineer | Release e92bd5e passed PR48/main CI and production workflow: 8,224 passed, two skipped, plus 50 operator checks | Continue full-suite qualification; targeted cleanup does not prove every historical teardown cause resolved |

## Delivery order

- [ ] 1. Establish operations guide, matrix, accountable owners and configuration decisions.
- [ ] 2. Close delivery ambiguity, atomic paid-work admission, identity and privacy boundaries.
- [ ] 3. Bound graph and other retrieval reads; extract affected domain logic incrementally.
- [ ] 4. Add durable progressive interview, voice purpose/tools, retention and typed fallback.
- [ ] 5. Generate six foundation documents; review and atomically publish approved revisions with Blueprint.
- [ ] 6. Add enrichment/diffs, indexing repair, export/deletion, controlled live evidence and flagged rollout.

## Agreed product requirements

Progressive essentials then optional enrichment; six documents (business overview, offers/customers,
operating model, sales/delivery, goals/metrics, constraints/decisions); explicit on-screen approval of the
displayed revision; seven-day temporary transcript checkpoints; no application-stored raw audio.
Preserve existing single-user tenancy and text onboarding. Shared organizations are a separate migration.
The business overview remains compatible with `business_profile`. The Blueprint summarizes confirmed
facts and links current foundation versions; it remains excluded from embeddings and graph extraction.
Drafts and superseded versions must not become current agent grounding.

## Evidence record format

For each gate append: owner, exact revision, environment, date, command/scenario, result, artifact location,
limitations, and next action. Never include credentials, transcripts or customer content. Mark blocked gates
explicitly and keep their affected capability disabled. Re-run evidence when a dependency or relevant
implementation changes; old evidence is not current assurance.

## Remaining closure tasks

- [x] Rehearse isolated hosted frontend artifact rollback: current `3d877c6` → previous
  `2978523` → current on a new staging-only alias, with deployment and 11 asset hashes verified
  at each stage and all 43 existing alias mappings unchanged. See the operations guide evidence.
  Backend rollback, database recovery and native acceptance remain separate open gates.

- [x] Recover current staging backend from a fresh pinned checkout after the failed backend
  rollback attempt: run `39030285762` restored `a129b88`, original foundation admission and
  unchanged watched configuration, skills registry and retention fixture. Backend rollback itself
  remains unqualified: run `39030025328` failed during previous-code deployment and automatic
  restoration; its exact cause is unproven. See the operations guide for both run links.

- [ ] Qualify the tenant-bound upload relay on hosted Convex: production-origin CORS/preflight, a 200 MiB raw streaming upload within the storage upload timeout, single-use receipt binding, original plus normalized audio sidecar, cancellation and deletion races. Hosted admin-fixture throughput passed through 200 MiB, but the separate local 200 MiB path timed out with partial data; browser relay, cancellation and cleanup qualification remain open.

- [x] Assign release approval, incident response, privacy requests and provider/billing reconciliation to Joel; owner accepted all four roles on 2026-10-17.
- [ ] Complete remaining runbook, staging backend rollback and recovery drills; attach exact revision and environment evidence and record backup coverage.
- [ ] Exercise controlled Gmail/Microsoft acceptance, response loss and mailbox reconciliation. Confirm one provider send per request and no blind retries.
- [ ] Establish trusted voice session ownership, hard termination and provider usage reconciliation. Browser telemetry must never release a hold. Verify transcription duration ceilings against trusted metadata, and provider pricing against the configured model.
- [x] Route the operator-only `probeGemini` diagnostic through paid admission. Folder and per-call reservations remain conservatively overlapping; reconcile actual provider invoices before tuning allowances.
- [x] Provision verified sender configuration and confirm one controlled production email reaches the owner's inbox. Native application authentication is a separate gate below.
- [x] Run native signup verification, replay rejection, recovery/reset and old/new JWT checks with an isolated account. See the release evidence below.
- [ ] Complete authentication expiry and browser-specific acceptance checks.
- [ ] Verify erasure against storage/RAG/provider systems, including already-running work. Record retained audit/billing/security exceptions.
- [x] Independently verify all five known original native test blobs, the exact deleted user and tenant upload receipts absent. This is scoped cleanup evidence, not proof of all possible storage/provider residuals.
- [x] Inventory request-time `.collect()` paths; replace unbounded histories with exact indexes, pagination or bounded cleanup; extract research/PDF/media read modules. See [retrieval inventory](governance/retrieval-boundaries-2026-10-15.md). Production index rollout and load evidence remain release checks.
- [ ] Run real microphone/browser onboarding: interruption, reconnect, resume, typed/upload fallback, correction, six-document review, explicit approval and repeat publication. Confirm only current approved documents ground answers.
- [x] Inspect the complete pre-upgrade workflow inventory and confirm both ingestion pools quiet before enabling foundation onboarding in staging. Required skill versions/configuration were verified; staging activation succeeded in run 38785222601.
- [ ] Complete live skill/voice evaluation and native six-document acceptance before production foundation or controlled voice activation. Staging configuration and registry presence alone do not qualify these capabilities.
- [ ] Observe seven-day transcript expiry and bounded cleanup; verify discard, export and account erasure.
- [ ] Review legal content using the owner-confirmed postal address. Keep billing disabled as explicitly instructed; do not activate it during this release. Resolve WORM retention, connector and recurrence provider evidence independently and preserve their gates.

The unchecked tasks require additional implementation or operational evidence. The runtime release recorded above does not establish completion of every original gap.

- [ ] Isolate and drain the workflow-test work that intermittently outlives Vitest teardown. Documentation
  [CI 39024491759, first attempt](https://github.com/Mrjoel97/ProjectX/actions/runs/39024491759/attempts/1), passed
  all 8,220 assertions but failed on unhandled `process is not defined` in the Vitest fork worker.
  The installed workflow environment temporarily removes `global.process`; existing investigation
  in the Vault playbook documents scheduled work surviving teardown. This Linux occurrence
  supersedes its earlier Windows-only characterization. The exact offending suite is unproven.
  The unchanged second attempt passed the complete gate; that is diagnostic evidence, not a fix.
  Preserve the failed attempt; do not suppress
  worker errors, shim globals or increase timeouts to report a green gate.

On 2026-10-17, Chrome inventory reported an unrelated private site and automatic approval review
refused its accessibility snapshot. The owner requested continued direct fixes. A separate pinned,
read-only staging workflow subsequently obtained the account/invite state without publishing fixture
identifiers; its results are recorded below. No account conclusion is inferred from the browser refusal.
Source review found actionable voice lifecycle and foundation correction defects, recorded below.
The synthetic seven-day checkpoint observation has now started; actual expiry remains pending.
Follow its timestamp/evidence protocol and accountable-owner/legal records in
[operations](operations.md#configuration-planes).
The original signup diagnosis, native acceptance and live operational gates remain unchecked.

## Synthetic staging voice provider evidence — 2026-10-17

[Voice run 39026259737](https://github.com/Mrjoel97/ProjectX/actions/runs/39026259737),
job `117377727268`, succeeded using reviewed source
`3d877c6e8dedc80ebb6bac552c024a5703a16101` and temporary workflow revision `6b40847`.
The actual job output reported `toolFree`, `controlReady`, `trustedUsageObserved`,
`connected` and `receivedAudio` as true. The synthetic session exercised the provider
transport and server-controlled response path without business tools or a native microphone session.

The ledger admitted 184 cents: the initial 100-cent hold plus one 84-cent response reservation.
One trusted response reported one cent of actual cost; `ledgerComplete` and `ledgerVerified`
were true. The initial 100-cent hold remained retained. These are the application's trusted-usage
and reservation observations, not a reconciled provider invoice or proof that the entire session
cost only one cent. Cleanup reported `providerTerminationConfirmed` and `originalFlagRestored`
as true; `nativeAcceptance` was false. Production activation and billing were unchanged.

This closes this isolated tool-free connection, audio receipt, acknowledged control, single-response
settlement and successful termination scenario only. Native microphone quality, interruption,
reconnect, business-tool exchange, six-document onboarding, maximum-duration watchdog behavior,
termination failure/outage recovery, unknown-usage holds and provider invoice reconciliation remain
open. The successful termination is not evidence of all failure modes or a hard outage ceiling.
The bounded signup diagnostic still shows no matching user and an unredeemed invitation; source
review did not reproduce its cause. Neither this provider drill nor the UI fixes establish that
native signup is fixed or that missing verification mail was its cause.

## PR46 correction navigation and scheduler ownership — 2026-10-17

[PR46](https://github.com/Mrjoel97/ProjectX/pull/46) exact head
`3d877c6e8dedc80ebb6bac552c024a5703a16101` passed
[CI 39025462441](https://github.com/Mrjoel97/ProjectX/actions/runs/39025462441).
Merged revision `a129b884445482625b1e8f2a236744fb2a0f2515` passed
[main CI 39025828381](https://github.com/Mrjoel97/ProjectX/actions/runs/39025828381) and
[production release 39026090675](https://github.com/Mrjoel97/ProjectX/actions/runs/39026090675).
Both revisions share tree `3e2f602a2f5bad1ecc465082ffa5d41345eb32ba`. The full suite passed
8,224 package/application tests with two existing skips, plus 34 operator regressions. Neither
PR nor main CI reported the prior worker error. Dispatch now owns its real scheduler timers and
harnesses; 130 dispatch tests, including real pending-cancellation and active-work barriers on
success/error paths, passed locally. No timeout, pool or unhandled-error suppression was added.
This is targeted cleanup and successful full-suite evidence, not proof that all historical
worker-teardown causes are resolved. The earlier failed documentation CI remains recorded in the open cleanup task above.

The UI follows the server's essential phase after a correction, allowing current facts to be
reconfirmed before review. Its rendered regression covers the section selector. Backend runtime
source is unchanged from PR45; the backend diff contains only the dispatch test.

Independent postflight resolved READY production artifact `dpl_5oWEXKHhDdSAGbWpiiiMWgiR5GiH`
at the merged SHA in the expected project. All four production aliases resolved to that artifact;
home, signin, signup, privacy and terms returned HTTP 200 HTML. All 11 signin assets returned
HTTP 200; inspection of the served bundle found the production Convex hostname and no staging hostname.

A fresh staging-only preview of the exact PR head is READY at
`https://pikar-ai-convex-hwvk2r03b-joelferuzi-gmailcoms-projects.vercel.app`, artifact
`dpl_BYNCwSRefh5ZtRBrbDqk4NhyomaY`. All 2,784 archived blobs matched; all 11 served signin
assets were inspected with the staging hostname present and production hostname absent. No staging
backend redeployment was needed. No aliases, staging SITE_URL, feature flags or billing settings
were changed by preview preparation. The earlier GP preview remains the coordinated signup origin.
These checks do not establish native signup, microphone, authenticated export, six-document
acceptance, elapsed retention, provider reconciliation or hosted rollback. Those gates remain open.

## Onboarding reliability corrections — 2026-10-17

This correction round prevents late microphone/signaling/reconnect completion from resurrecting an
ended voice session, retains typed text until server acceptance, and disables sending during
connection. It removes a discarded browser wrap-up command; countdown presentation and server-owned
response admission remain. The server now remembers input arriving during another response and
creates a separately admitted follow-up only after trusted settlement. A regression fails when that
follow-up is removed, then passes with the fix.

Editing or removing a current essentials statement invalidates extracted tier facts and requires
reconfirmation before review/publication. Duplicate statement event IDs are rejected without writes.
Planned essentials retain provenance without extraction or changing confirmed current facts; editing
planned-only statements preserves those facts. Signup guidance now distinguishes code recognition
from email matching and acknowledges generic transport/service failure without disclosing account
existence. This is accurate guidance, not a proven resolution of the live signup failure.

Local validation: 59 backend voice/foundation tests, 16 web voice/onboarding tests and nine signup/auth
guards passed; backend and web typechecks, repository Biome and playbook checks passed. The voice UI
also blocks duplicate pending submissions and best-effort aborts known active sessions on navigation;
the durable provider watchdog remains authoritative. Golden/vertical offline checks and four evaluator
identity regressions passed with no fingerprint changes required. Graphify was unavailable; the
Convex-edge fixup ran but does not establish a complete graph refresh. Hosted CI/release evidence,
required before deployment could be claimed, is attached below. Production foundation/controlled
voice and commercial billing activation settings were not changed.

[PR45](https://github.com/Mrjoel97/ProjectX/pull/45) exact head
`29785234c2a00ed7eb3c7816bd24e59a313327dd` passed
[CI 39022997943](https://github.com/Mrjoel97/ProjectX/actions/runs/39022997943): 8,220 package tests
passed, two existing skips, 34 operator regressions, typecheck/lint/free gates/planning/build passed.
Its merged main revision is `be63035592c7333d04322af40eeb4a3d380244ca`; both commits have exact
tree `9d57528a993d4296dd311e74fd7773dea82fdaaa`.

[Staging backend run 39023282442](https://github.com/Mrjoel97/ProjectX/actions/runs/39023282442)
required that exact successful PR CI and checked out only its literal source SHA. Dependencies
installed without the deployment key; only the final guarded step received the existing staging
secret. The exact woozy target, coordinated signup origin, absent fixture activation and disabled
voice were checked before deployment; dry-run/generated types, deployment and direct strict-exit
skill seeding passed. Captured activation/origin configuration was unchanged afterward. No provider
action or account-data query was invoked. This supersedes the first successful run's weaker
origin/seed verification; it does not qualify a native signup or onboarding session.

The same reviewed source built as READY non-production preview
`https://pikar-ai-convex-ltit9wxav-joelferuzi-gmailcoms-projects.vercel.app`, artifact
`dpl_96wXoqeJhGCKBGxQTuTvEfa5iMec`. All 2,784 tracked blobs matched the commit; all 11 served
signin assets were checked, with the staging backend present and production backend absent. No
alias or staging `SITE_URL` changed. The coordinated GP preview remains the signup origin; this
new preview is available for the repaired client acceptance checks once authentication is resolved.
The temporary staging workflow branch remains: automatic approval review rejected its deletion
because deployment authorization did not explicitly include branch deletion. No cleanup workaround
was attempted, and no historical metadata purge is claimed.

[Main CI 39023291826](https://github.com/Mrjoel97/ProjectX/actions/runs/39023291826) and
[production release 39023562539](https://github.com/Mrjoel97/ProjectX/actions/runs/39023562539)
passed for merged revision `be63035592c7333d04322af40eeb4a3d380244ca`. Independent Vercel inspection
confirmed READY production artifact `dpl_8i7Q57Wdwqab2toqaMMtdmTLuqUC` in the expected project,
with all four existing production aliases resolving to it. Home, signin, signup, privacy and terms
returned HTTP 200 HTML; all 11 signin client assets returned HTTP 200 and compiled the production
Convex hostname without the staging hostname. These checks establish deployment and public-route
health, not interactive identity, microphone, authenticated export or six-document acceptance.
No feature activation or commercial billing change was made.

[Read-only signup diagnostic 39023822180](https://github.com/Mrjoel97/ProjectX/actions/runs/39023822180)
checked out exact main revision `be630355` only after its successful CI, installed without the staging
key and exposed that key only to the final target-guarded inspection step. Its sandboxed inline query
selected the unique matching foundation-test invite family within the newest 100 invitations, deriving
the invited email internally. No actual test email, user/storage ID, invite code, hash of an email,
message body or credential appeared in its source/output. A zero/multiple-match or duplicate-user
result would refuse interpretation. Observed booleans: `fixtureMatchUnique=true`, `userExists=false`,
`emailVerified=false`, `inviteExists=true`, `inviteRedeemed=false`. These establish no matching user
and an unredeemed invitation at query time within that bounded selector. The failure precedes
committed account creation; verification delivery is not the next branch to investigate. Exact
submitted email/code and the original admission failure remain unproven; do not claim signup fixed,
redeem/reset the invite or alter mail configuration based on these booleans. No account,
configuration or provider write was performed. The temporary diagnostic branch is retained.

[Retention start run 39024375484](https://github.com/Mrjoel97/ProjectX/actions/runs/39024375484)
used the same CI-pinned source and isolated final-step staging credential. Exact deployment,
foundation-enabled/voice-disabled and absent fixture switches were checked. Before any write,
bounded 201-row reads proved both relevant inventories complete within 200 rows and no earlier
retention-prefix fixture. A new random administrator-impersonated synthetic tenant created only an
unpublished interview and one fixed, non-sensitive transcript checkpoint through existing functions;
it created no native account and invoked no model/provider/configuration/deployment operation.
Indexed reads confirmed one checkpoint and an exact seven-day lifetime; repeating the same event
preserved its count, creation time and expiry. Fixture identifiers/text remained private.

| Retention observation | Actual UTC timestamp / state |
|---|---|
| Checkpoint created | 2026-10-17 10:18:29.493 UTC |
| Stored expiry | 2026-10-24 10:18:29.493 UTC |
| First eligible hourly cleanup tick | 2026-10-24 11:15 UTC (14:15 Africa/Dar_es_Salaam) |
| Current result | Start and same-event replay verified; seven elapsed days and cleanup unverified |

Keep this synthetic fixture intact. Observe presence before expiry and absence after the eligible
scheduled sweep/continuations before closing retention. Use the bounded, uniqueness-checked private
lookup in the operations guide; refuse ambiguity rather than inventing an absence result. No clock
advance, shortened retention or simulated purge qualifies this elapsed-time gate. Native transcript
export/discard/erasure and provider retention remain separate scenarios. The temporary start branch
is retained and is not scheduled to rerun.

## Implemented code checklist

- [x] Current operations guide and evidence-oriented release matrix.
- [x] Durable email claim, receipt, uncertainty watchdog and tenant-scoped manual reconciliation.
- [x] Atomic product-path paid admission, idempotent settlement and retained uncertain holds.
- [x] Password verification/recovery, typed audit payload boundary and post-erasure JWT tombstone.
- [x] Bounded graph traversal, Blueprint activity, notification windows and full request-scan inventory, with explicit partial states or cursor access.
- [x] Pure foundation rendering, bounded traversal, stock selection, research tools, PDF rendering and media-slot readers separated into focused modules.
- [x] Resumable voice-led interview with typed/upload fallback and restricted draft-only voice tool.
- [x] Six reviewed foundation documents, stable IDs, provenance, exact approval hash and atomic Blueprint publication.
- [x] Revision-guarded indexing, bounded replacement cleanup and stale-entry retrieval rejection.
- [x] Seven-day transcript cleanup and foundation export/deletion coverage.

## First implementation-round validation (2026-10-15; superseded for changed source)

The dated entries below preserve the state at each earlier phase. Their pending diagnostic and
release references are historical; the current header and 2026-10-17 correction/diagnostic records
above supersede them. In particular, signup state was subsequently inspected in run 39023822180.

The following was captured before the second implementation round (trusted voice, upload ownership, broader retrieval and lifecycle changes). It is historical local evidence, not current release assurance.

Production build passed using a placeholder Convex URL (compilation only); no live deployment.
All 12 package typechecks and Biome error-level CI passed. Targeted delivery concurrency and receipt
tests passed (4), stale grounding/graph/sealing tests passed (35), and combined media/research tests
passed (461). Final package test runs passed: backend 4,473 tests across 175 files; web 1,043 passed and two
existing skips across 61 files; other nine tested packages 2,623 passed. Total: **8,139 passed, two skipped**.
The initial integration failures were corrected and the complete backend/frontend suites rerun.
All 22 offline free gates, evaluator identity checks, playbook coverage and `git diff --check` passed.
Generated Convex API module inventory was reconciled locally; deployment-connected codegen remains a
release check. Prior golden/vertical evaluation fingerprints were retired; no new live eval is claimed.
Local logs are in the parent workspace (`projectx-backend-final2.log`, `projectx-web-full-final.log`,
`projectx-other-full.log`, `projectx-typecheck-complete.log`, `projectx-lint-final3.log`, and
`projectx-final-build-network.log`). The other-package log includes the earlier web failure; the final
web log supersedes that section. This evidence describes the uncommitted working tree, not a deployed SHA.
A complete Graphify AST refresh remains unavailable: the Python launcher points to a missing C:\Python313\python.exe interpreter. The second-round Convex edge extraction added 28 edges between existing nodes and two table edges, but new-module AST nodes remain unresolved. The graph artifact is therefore only partially refreshed and is not evidence of full architecture coverage.

## Second implementation-round evidence (2026-10-15)

Production preflight [GitHub run 38748292173](https://github.com/Mrjoel97/ProjectX/actions/runs/38748292173) succeeded against the already-existing baseline 53d96a. It inspected configuration names only. OpenAI/OpenRouter and other provider configuration names were present; neither values nor live provider behavior were verified. AUTH_RESEND_KEY and AUTH_EMAIL_FROM were missing. Required WORM/AWS configuration names were absent. The user requested secure mail configuration; this is an operator task still requiring completion, not permission to print or commit credentials.

Business settings now use pikar-ai, Tanzania and joel@pikar-ai.com. The postal address remains pending. Billing must remain disabled by explicit user instruction. Missing WORM configuration is not a reason to invent retention evidence or enable WORM.

Local second-round retrieval evidence: 345 backend tests passed (media 294, isolation 47, high-cardinality retrieval 4); pin/export 60 passed including 401 audit events across pages and 105 scrubbed trajectories across pages. Backend TypeScript passed at that snapshot. The full web run reported 1041 passed, 2 skipped and 2 pagination-mock failures; those mocks were fixed and the affected 9-test suite passed, including a real Load more interaction retaining 101 legacy report outcomes. Logs: parent workspace retrieval-final-small.log, retrieval-web-full.log; the pin/export and affected UI checks were terminal runs. These are targeted/full-web results at their execution times, not a final integrated gate for subsequent source changes.

The second-round complete backend suite is being recorded separately in parent workspace projectx-round2-backend-full.log. The release engineer must replace pending status with its actual final result and attach the final typecheck/build/free-gate evidence after all concurrent source changes stop. Do not add test totals from overlapping targeted runs or reuse the first-round 8,139 total as assurance for this round.

Mail configuration follow-up: the owner reports the Resend dashboard domain is Verified. A fresh names-only Convex check ([run 38749457677](https://github.com/Mrjoel97/ProjectX/actions/runs/38749457677)) still found AUTH_RESEND_KEY and AUTH_EMAIL_FROM absent. Domain verification alone does not complete application mail configuration or a successful verification/recovery delivery drill.

Second-round package checks: all nine other tested packages passed (2,629 tests; one cached package), recorded in parent workspace projectx-round2-packages.log. Dispatch/routine regression checks passed 137 tests in round2-dispatch-routines.log. These targeted checks overlap full-suite coverage and must not be added to its total.

Evaluator fingerprints were regenerated after the second-round source freeze. Golden revision is 2026-09-11.budgeted-evaluator.ccc63fda5b8ce9d9c8b9a724f11fe9199ccc10e475f8cc8546ab86a8f8467c2c; its 46-case corpus is unchanged. Vertical pins were regenerated for six lanes/40 cases. Golden offline self-check, four identity tests (including extracted helpers), and vertical manifest check passed. This retires prior evidence and does not constitute a new live evaluation.

## Integrated local qualification and review branch

Historical snapshot before PR39 merged and production deployment; the current release evidence below supersedes its branch/deployment status.

Implementation commit `5e6ce5bb5cd74bf5009697363fd82a3ccefb03b6` is pushed in [draft PR39](https://github.com/Mrjoel97/ProjectX/pull/39); it is neither merged nor deployed. Final local web run:1,045passed/twoexisting skips across61files. Other nine packages:2,629passed. All12package typechecks, production compilation with a placeholder backend URL, error-level Biome,22offline free gates and playbook coverage passed. Logs in the parent workspace: `projectx-round2-web-final.log`, `projectx-round2-packages.log`, `projectx-round2-typecheck-final.log`, `projectx-round2-build-final.log`, `projectx-round2-lint-final.log`, `projectx-round2-free-gates.log`.

The final backend run recorded4,505passed/onefailed across179files (`projectx-round2-backend-final.log`). The sole failure was the closed cron-count assertion still expecting nine rather than ten after adding bounded voice-control retention. That assertion was corrected and the complete24-test reliability sweep suite passed (`projectx-round2-cron-final.log`). No runtime behavior changed in this correction. Hosted CI on the corrected revision must still pass; these facts do not falsely describe the earlier full run as all-green.

Release authentication preflight checks capture CLI output without printing credentials and reject empty/missing/multiline settings. Isolated child-process checks exercised missing settings, malformed sender and configured values, with no fake key echoed. A valid-looking key still requires real verification/recovery delivery. User-confirmed Resend domain verification does not replace this gate.

## Hosted qualification — 2026-10-15

Historical snapshot before production mail configuration and release; the following sections supersede those statuses.

[CI run38752712434](https://github.com/Mrjoel97/ProjectX/actions/runs/38752712434) passed every required step at implementation revision `fab5f33`:12package typechecks, error-level lint,22free gates, all11tested packages, operator regressions, planning evidence and production build. The full hosted backend suite passed4,506tests; web passed1,045with twoexisting skips; other packages passed2,629. Total:8,180passed/twoskipped. This supersedes the local cron-count failure for that code revision. The subsequent evidence-only documentation commit changes no runtime or test behavior.

[Draft PR39](https://github.com/Mrjoel97/ProjectX/pull/39) contains the implementation. Main and production remain at the prior release; no new deployment, provider acceptance, microphone session or real mail delivery is implied by CI success. The missing production mail settings and the open live gates above remain binding.

## Production email qualification — 2026-10-15

The subsequent [names-only check](https://github.com/Mrjoel97/ProjectX/actions/runs/38756649548) confirmed both required authentication settings. A separate supported CLI check identified the release target as `opulent-octopus-494`, matching the owner's dashboard. Earlier names were reversed (`RESEND_AUTH_KEY` and `EMAIL_AUTH_FROM`); the operator corrected them without sharing credentials.

[Controlled send run 38757084736](https://github.com/Mrjoel97/ProjectX/actions/runs/38757084736) used the existing production key only in its final isolated step after a baseline-pinned checkout/install. Resend accepted one message with HTTP 200 and receipt `01a14018-2786-7c9c-afb2-598fca0a0f9d`. The owner confirmed inbox arrival. The test used a fixed idempotency key, exposed no credential, and changed no account or password. This closes sender configuration and basic delivery; native signup/recovery, expiry/replay and session invalidation drills remain open. Earlier absent-setting observations above are historical and superseded by this check.

Final release review found that the foundation UI flag did not prevent direct RPC writes. The follow-up enforces the flag on server draft writes, paid answers, late answer commits and publication. When disabled, saved drafts remain readable/discardable and the UI hides editing, upload, voice and publication controls. Targeted backend and UI tests plus both package typechecks passed; exact-head hosted CI must qualify the follow-up before release. Foundation and new voice sessions remain disabled until their live gates pass. Commercial billing remains disabled by owner instruction.

The same review added a legacy delivery cutover guard. Only a fresh transition into delivery receives the new claim-protocol marker; an already-delivering legacy request without a receipt is quarantined as unknown before provider work, including direct claim callers. Its outcome requires the existing delayed mailbox reconciliation and never permits an automatic resend. Delivery/pipeline/Gmail/Graph regression suites passed 100 tests. The owner confirmed current voice sessions ended and uploads finished before cutover. A component inline read-only workflow inventory failed; no empty-workload claim is made from that failed inspection. Legacy ingestion drain remains required before enabling foundation publication.

The delivery change retires the prior evaluator identity. The replacement golden revision is `2026-09-11.budgeted-evaluator.57fafc5af36add4953d274c529897853c331d7c9d8e13114c8125cc82fcb8ea7`; the 46-case corpus is unchanged. Its offline self-check and four identity tests passed. This refresh does not assert new live model evidence or activate candidates.

## Production deployment and postflight — 2026-10-15

[PR39](https://github.com/Mrjoel97/ProjectX/pull/39) merged as runtime revision `c2cf18c2cbcf4d16df4e3143271ac69471172f64`. [Exact-head CI](https://github.com/Mrjoel97/ProjectX/actions/runs/38759580384) and [main CI](https://github.com/Mrjoel97/ProjectX/actions/runs/38760253262) passed. The corrected full suites passed 4,511 backend tests, 1,046 web tests with two existing skips, and 2,629 tests in the other packages: 8,186 passed, two skipped. All 12 typechecks, lint, 22 offline gates, operator regressions, planning checks and production build passed. The earlier single vertical evaluator-pin failure was corrected by regenerating its identity; its four tests passed before the complete hosted rerun.

[Release run 38760903041](https://github.com/Mrjoel97/ProjectX/actions/runs/38760903041) passed the authentication configuration gate, Vercel build/upload, Convex dry-run, committed-generated-types check, origin pinning, backend deployment to `opulent-octopus-494`, registry seed, staged probe, promotion and durable-origin check. Independent Vercel inspection confirmed READY production artifact `dpl_9N1jDxAZFDthA3M8gyTxhudC5DKy` serves `https://www.pikar-ai.com`. Previous frontend rollback reference: `dpl_HsdwHaM1iTUCpUv6fC52GEjgQh5J`; previous backend revision: `53d96a263f055e14bbb1c6a1a35c6d7bb58c9652`. These are references, not proof of a rehearsed rollback or a safe reversal of data writes.

Postflight HTTP checks returned 200 HTML for `/`, `/signin`, `/signup`, `/privacy` and `/terms`; home and legal pages contain the approved support address. One public native password-recovery request for the authorized mailbox was accepted by the deployed app. It changed no password and did not log a code or token. The owner confirmed this mailbox uses Google sign-in only and received no recovery email, consistent with the non-enumerating response for an absent password account. A complete isolated password signup/recovery/session drill remains pending; this negative account case is not evidence of password-account delivery.

The temporary production preflight branch was deleted after its controlled test; evidence runs remain available. The owner confirmed voice sessions ended and uploads completed for cutover, then supplied staging deployment `woozy-wren-368` in the same Convex project. Usable staging release access is being checked separately; production credentials must not be reused for it. Voice/foundation live acceptance, hosted upload throughput, erasure/provider reconciliation and rollback drills remain unqualified. The release does not enable foundation/new voice sessions or commercial billing. Follow-up evidence-only documentation changes do not change the deployed runtime revision above.

## Staging qualification and voice admission follow-up — 2026-10-15

The isolated staging preflight confirmed `woozy-wren-368` using its separate GitHub staging secret. Missing staging signing keys were generated as a fresh pair only when both names were absent; production keys were never copied. The staging frontend was built from verified runtime revision c2cf18c with `NEXT_PUBLIC_CONVEX_URL=https://woozy-wren-368.convex.cloud`; no production domain was promoted by that preview deployment. Staging provider configuration and live acceptance remain independent gates.

Review found that the old first-response admission could never fit a fresh tenant's defaults: the100c initial reservation plus417c response reservation exceeded the500c daily allowance. The follow-up preserves the100c hold and500c allowance, requires acknowledged8192-token post-instruction truncation, and reserves84c per response using conservative full-context text, bounded audio-input and output prices. It rejects missing/mismatched provider controls and terminates on usage outside the contract. Known overages are charged in full; contract violations never release a conservative hold. Local voice suites passed36 backend tests and four shared contract tests, including a real initial reservation and overage accounting; mint13 tests were rerun after their contract assertion. Backend typechecking, scoped formatting, golden self-check and vertical corpus checks passed. These overlapping targeted checks are not a new full-suite total or live provider evidence. Production voice/foundation flags remain off until real acceptance passes.

## PR40 production release and isolated acceptance — 2026-10-15

Independent postflight confirmed Vercel deployment `dpl_BmHDosKvPMCMXBt6Zsp8kDvWko7R` is READY with target production. Public home, sign-in, signup, privacy and terms routes returned HTTP 200; the home and legal pages contain the configured support address.

Evidence owner: Codex acting on the repository owner's instructions. Production runtime: `6da1bd0711870cb6eea46d87dac149414b304184`. [PR40 CI run 38769971783](https://github.com/Mrjoel97/ProjectX/actions/runs/38769971783) passed with 8,190 tests and two skips. [Main CI run 38771336560](https://github.com/Mrjoel97/ProjectX/actions/runs/38771336560) and [production deployment run 38771736815](https://github.com/Mrjoel97/ProjectX/actions/runs/38771736815) succeeded. These supersede the earlier production runtime references; the preceding records remain historical evidence for their stated revisions.

| Scenario and environment | Observed evidence | Remaining limitation / next action |
|---|---|---|
| Staging provider configuration | [Run 38772482415](https://github.com/Mrjoel97/ProjectX/actions/runs/38772482415) confirmed OpenRouter configuration | Configuration presence does not prove provider output quality or voice acceptance |
| Hosted staging admin-fixture uploads | Same run: 1 MiB / 601 ms, 64 MiB / 1,334 ms, 200 MiB / 2,856 ms; all HTTP 200 | Qualify the authenticated browser relay, CORS, receipt binding, sidecars and cancellation separately |
| Isolated native password-account drill | Signup verification, replay rejection, recovery, reset, rejection of old JWT and acceptance of new JWT passed | Complete expiry and browser-specific scenarios; do not generalize this native drill to browser/microphone acceptance |
| Local large-upload attempt | 200 MiB attempt timed out after 125 seconds; approximately 86 MB tracked as partial data | Investigate the local path and prove partial-data cleanup; hosted admin-fixture success does not erase this failure |
| Isolated account self-deletion | Self-deletion succeeded; independent read-only check on 2026-10-16 found all five known blobs/user/receipts absent | Native export, hosted in-flight cleanup and provider residual checks remain open |

Native drill outcomes are operator-observed evidence; this document retains no test emails, account IDs, storage IDs, codes or tokens. Independent cleanup proof for the five known blobs/user/receipts subsequently passed on 2026-10-16; broader native export/in-flight/provider evidence remains open. Production foundation onboarding and controlled voice remain off; billing remains off by owner instruction. No qualified browser/microphone session exists, and no live voice or six-document onboarding acceptance is claimed by these tests.

## Continued qualification preparation — 2026-10-15

Credential-free local rehearsals archived production `6da1bd0711870cb6eea46d87dac149414b304184` and previous runtime `c2cf18c2cbcf4d16df4e3143271ac69471172f64` into separate fresh directories. Both frozen offline installs and all twelve uncached package typechecks passed. Both retained lockfile SHA-256 `6ccff58bc35477306e76e41e0155fb92a5c6bbdd6dbffae7dee3dcb407121663`. Local artifacts: `.tmp/release-rehearsal-iRC4Nf/evidence.json` and `.tmp/release-rehearsal-HZnaTX/evidence.json`. No codegen, provider request or deployment ran; this is local restoration evidence, not a hosted rollback.

Reusable native foundation and synthetic staging privacy runners now keep credentials and fixture metadata out of public workflow output. Foundation evidence assertions compare exact reviewed content/hash, provenance, stored revisions and Blueprint references. Twenty-two Node regression tests passed after the first hosted attempt exposed synthetic export/cleanup contract gaps. Three additional backend lifecycle tests passed for erasure racing a storage write, persisted session expiry and installed-provider email-code expiry. The expiry tests advance a local clock; they do not establish elapsed hosted retention. The privacy runner still requires a successful staging execution, and synthetic admin-context cleanup must not be reported as native account self-deletion.

Graph maintenance limitation: `graphify update .` could not run because the executable is unavailable in this workstation. The existing Convex edge fixup completed without changing the graph; it is not a replacement for a full AST refresh.

Browser access is now established. The operator's signed-in production workspace was visible, but this is not staging onboarding acceptance. A staging Google attempt returned HTTP 400 `redirect_uri_mismatch`; reconcile the actual requested callback with the Google client's authorized redirect URIs before claiming staging OAuth acceptance. The disposable password-account route remains a separate test path. Browser authentication and microphone permission are recipient-operated under the desktop automation rules.

The first synthetic hosted privacy attempt ([run 38780164711](https://github.com/Mrjoel97/ProjectX/actions/runs/38780164711)) failed before completing content export/isolation assertions. Its fresh-fixture cleanup and budget close both succeeded. This is failed qualification evidence, not a privacy pass; investigate the exact synthetic export contract before another paid attempt.

Follow-up harness corrections stop before the final real-user identity export page, wait for asynchronous RAG entry deletion before bounded namespace cleanup, reject pre-existing fixture scopes before any mutation, and verify preservation of the other fixture's captured retrieval rows. Output includes only allowlisted phase/error booleans. A full positive fixture orchestration test and negative collision test passed locally; these corrections still require exact-revision CI and one controlled hosted rerun. The original invitation was refused by the staging UI; issue and validate a fresh recipient-controlled invitation before further signup acceptance.

## Successful isolated storage/retrieval drill — 2026-10-15

Source `118b8e73a4e4e9dbb4164cdd57724e0ec799bec4` passed [CI run 38782463692](https://github.com/Mrjoel97/ProjectX/actions/runs/38782463692): 8,193 package/application tests passed with two existing skips, plus 34 operator regression tests. [Hosted staging run 38782552536](https://github.com/Mrjoel97/ProjectX/actions/runs/38782552536) then passed against the explicitly guarded staging target. Its key was available only in the final inspection/test step after pinned-source CI, checkout and installation.

Two fresh synthetic scopes completed owned 1 KiB uploads, real RAG embedding, all tenant-content export pages and cross-tenant document denial. Deleting the first fixture removed its known file metadata and captured RAG entry/chunk/content/vector records while preserving the second fixture's document, blob and captured RAG records. Final cleanup removed both exact fixture scopes and closed the 10-cent evaluation budget; all allowlisted error flags were false. The embedding adapter requires observed standard OpenRouter usage and successful reservation settlement before returning, so this also exercises the configured staging provider and paid embedding accounting.

This uses privileged synthetic fixture identities and existing scoped cleanup helpers. It does not establish native user-identity export, native account deletion, removal of the original account's five blobs, a hosted in-flight erasure race, seven elapsed days of retention or provider invoice reconciliation. Synthetic content export contains document text and RAG references; it is not an embedding/vector export. A local attempt to derive file URLs from modern storage IDs returned HTTP 400 and supplies no absence evidence; direct system-metadata checks remain necessary for the original files. Browser/microphone onboarding, the fresh invitation and hosted rollback are still open.

## PR41 production release and staging rollout preparation — 2026-10-15

[PR41](https://github.com/Mrjoel97/ProjectX/pull/41) merged as `054b49d914d2281b25452183c4a930d04375cc94`; [main CI 38784521521](https://github.com/Mrjoel97/ProjectX/actions/runs/38784521521) and [production deployment 38785069376](https://github.com/Mrjoel97/ProjectX/actions/runs/38785069376) passed. The credential-scoped pipeline deployed Convex, seeded skills, probed and promoted Vercel. Independent inspection of `www.pikar-ai.com` resolved READY production artifact `dpl_45jF1NCppN6cSxsKkVExb7uWu4LT`. Home, signin, signup, privacy and terms returned HTTP 200; the home/legal contact remained correct. Production voice/foundation and billing activation settings were not changed.

[Hosted flag-off drill 38784279738](https://github.com/Mrjoel97/ProjectX/actions/runs/38784279738) refused interview creation, paid answers and publication without creating a draft. [Read-only drain inspection 38784711992](https://github.com/Mrjoel97/ProjectX/actions/runs/38784711992) paged the complete six-record workflow inventory, found zero unfinished/unversioned ingestion and verified both workflow/ingestion pools quiet twice. [Staging prerequisite/activation run 38785222601](https://github.com/Mrjoel97/ProjectX/actions/runs/38785222601) then found no missing required configuration or active fixture switches, verified all seven required skills and rechecked pool quiescence before setting `FOUNDATION_ONBOARDING_ENABLED=1` only in staging. These are privileged operational checks; native browser/microphone acceptance remains open. Voice activation was not changed.

The new preview upload was initially blocked by automatic approval review; the owner subsequently authorized proceeding. On 2026-10-16, exact source `054b49d914d2281b25452183c4a930d04375cc94` built successfully as READY preview `dpl_CxsunYGJsBQuCPDbM7iPkwQU3Swv` at `https://pikar-ai-convex-j32zw3iij-joelferuzi-gmailcoms-projects.vercel.app`. All 2,780 tracked source blobs matched the archived revision. The served signin page and all 11 client assets were inspected: the compiled client contains the staging Convex hostname and no production hostname. Production, aliases, feature flags and staging `SITE_URL` were unchanged; the earlier staging origin remains the coordinated authentication origin. This preview build does not establish hosted rollback or browser acceptance.

The current staging signup invitation was refused. Source inspection confirms password signup consumes an invite before email verification, so an existing unverified account must resume through sign-in and a new verification challenge instead of reusing signup. The actual account state and original-file absence checks await the approved private read-only diagnostic and exclusive Chrome access. The temporary earlier metadata-bearing branch was deleted, but historical public commits/logs are not erased by branch deletion.


## Signup recovery release — 2026-10-16

[PR42](https://github.com/Mrjoel97/ProjectX/pull/42) adds generic sign-in recovery guidance beside invalid invite results. It changes no admission, authentication handler, schema or activation setting. Exact head `596cb5c156e5ccccbdafd182d786050efe74de73` passed [CI 38807478554](https://github.com/Mrjoel97/ProjectX/actions/runs/38807478554); merged revision `3ea7981c134b4820d95470e86554edd68286347c` passed [main CI 38808093330](https://github.com/Mrjoel97/ProjectX/actions/runs/38808093330) and [production release 38808615617](https://github.com/Mrjoel97/ProjectX/actions/runs/38808615617). Independent production inspection resolved READY artifact `dpl_5Et4nRoYFubPZ8zSrJ9JWdbv4LVw`. Five public routes returned HTTP 200; all 12 signup assets returned HTTP 200, with the new recovery/verification copy and production Convex hostname present and the staging hostname absent. This proves shipped copy, not interactive recovery.

The earlier staging signin page and all 11 app assets were also inspected through authenticated, read-only Vercel CLI. Its actual client contains `woozy-wren-368.convex.cloud`; the only other Convex hostname is an installed SDK example. A compiled backend mismatch is not supported by that evidence. The owner approved entering the scoped test identifiers into the private read-only dashboard diagnostic, including its possible private query history. Chrome was initially unavailable; the subsequent diagnostic and invitation results are recorded below.

## Native storage absence and fresh invitation — 2026-10-16

After explicit idle-Chrome approval, an operator ran the approved private read-only custom query against `woozy-wren-368`. Result: `knownBlobCount: 5`, `allKnownBlobsAbsent: true`, `originalUserAbsent: true`, `originalReceiptsAbsent: true`. Each file check used the exact known storage ID with `ctx.db.system.get`; the user check used the exact ID and receipts used the tenant index. The first attempt named the users email index incorrectly and failed without writing data; correcting it to the existing `email` index produced the successful result. Only booleans/counts are retained here. This closes absence of those known native test objects, including the partial upload; it does not establish native export completeness, unknown residual absence, hosted in-flight erasure, post-erasure JWT denial, native RAG deletion or provider-side cleanup. The earlier old-JWT rejection exercised password-reset revocation, not a post-erasure request.

The same private query found the prior onboarding invite present and **unredeemed**, with no matching user and no verified user. An existing unverified account therefore does not explain that specific failed signup. Its supplied code is not retained or recovered here; the exact cause of the refusal remains unproven. A different disposable alias received a newly issued staging invitation (`reused: false`), and the coordinated staging signup page displayed **Invite recognised**. Native password creation and recipient-private email verification are handed to the owner under the Computer Use authentication restriction; no native account creation or live onboarding acceptance is claimed yet.


## Paginated export file links release — 2026-10-16

Native Settings export review found that the API returned file descriptors but the frontend discarded them when assembling the downloaded JSON. [PR43](https://github.com/Mrjoel97/ProjectX/pull/43) preserves every page's file descriptors across tables, including null links, with existing omissions and final partial-export limits. Its rendered regression clicks Download and inspects the actual Blob across three pages/two tables. Thirteen targeted tests and frontend/backend typechecks passed; the shared aggregate type and existing backend test assembler were corrected without changing backend runtime or schema.

Exact head `ce154e17da278de54c6fbeecea32bfe47b62429d` passed [CI 38812363971](https://github.com/Mrjoel97/ProjectX/actions/runs/38812363971), with 8,194 package tests passed and two existing skips. Merged revision `42c65d40a0a97dc8eac537e042d473a1b045782e` passed [main CI 38812953245](https://github.com/Mrjoel97/ProjectX/actions/runs/38812953245) and [release 38813312965](https://github.com/Mrjoel97/ProjectX/actions/runs/38813312965). Independent production inspection resolved READY artifact `dpl_6zrEwppqYm67YiJcsDpiqJTqevZs`; five public routes returned HTTP 200. The Settings route correctly requires authentication; no protected browser-download acceptance is claimed from anonymous postflight. Feature flags and billing were unchanged.

The newly recognised staging invitation subsequently reached a generic account-creation failure during the owner's private signup attempt. Its post-attempt account state has not yet been inspected, so neither email mismatch, configuration nor delivery failure is established. Computer Use reported concurrent input, and automatic approval review required renewed idle/snapshot consent. The owner supplied that consent, but read-only snapshots still reported Chrome minimized after refreshed window selection and retry; automated inspection stopped and a scoped manual read-only query was handed to the owner. Its result is pending. Earlier signup-status prompts are superseded by the reported error.

Source audit also confirms password-provider account IDs retain the exact submitted email string, while invite/user-email matching normalizes trim/case separately. Use the exact original credential email when diagnosing existing accounts; a future normalization change requires legacy-ID compatibility tests. This observation is not evidence of the current fresh-signup cause. Do not enable auth DEBUG logging to diagnose it: the installed verification implementation can log sensitive verification arguments.


## File-link disclosure and current staging evidence — 2026-10-16

[PR44](https://github.com/Mrjoel97/ProjectX/pull/44) corrects automatic-expiry claims in export/Vault copy and core/rendering comments without changing storage, authentication or access behavior. Fifty existing settings/preview/content tests passed locally. Exact head `36d180422465e439ee1bfb394b3f2921a00e463a` passed [CI 38814425138](https://github.com/Mrjoel97/ProjectX/actions/runs/38814425138); merged runtime `de18285d7466ea743d42199dc1d8de4a66dccbf9` passed [main CI 38815049837](https://github.com/Mrjoel97/ProjectX/actions/runs/38815049837) and [production release 38815539297](https://github.com/Mrjoel97/ProjectX/actions/runs/38815539297). The suite remains 8,194 passed/two existing skips. Independent postflight resolved READY production artifact `dpl_C4JSbRgXUu86ujNnfZD55p7kr4hE`; five public routes returned HTTP 200. Protected Settings acceptance remains unverified. [ADR-057](decisions/057-stored-file-link-lifetime-disclosure.md) supersedes only ADR-045 D4's incorrect lifetime claim, preserving the immutable historical ADR and existing architecture.

A separate READY staging preview includes the file-export assembly fix at exact source `42c65d40a0a97dc8eac537e042d473a1b045782e`: `https://pikar-ai-convex-mngemgf4f-joelferuzi-gmailcoms-projects.vercel.app`, artifact `dpl_3yCb2humtj5Bwguo8P35VYSjMq16`. All 2,780 archived source blobs matched. Build and runtime explicitly use staging; the served provider chunk contains the staging Convex hostname and no production hostname. This preview predates PR44's copy correction and is not native export or rollback acceptance. No alias, staging `SITE_URL`, voice/foundation activation or billing setting changed; the earlier coordinated signup origin remains in use.

For the latest failed signup, a read-only mailbox-ID search including Spam found no matching verification message for the exact fresh alias; no message body or verification code was read. Source and installed-bundle inspection show both client preflight and same-origin password transport use `NEXT_PUBLIC_CONVEX_URL`, with no `CONVEX_URL`/`CONVEX_SITE_URL` precedence override; that setting was supplied for staging at build and runtime. These checks do not identify the failure cause. The private account/invite-state diagnostic remains necessary before retrying signup, changing mail configuration or claiming delivery failure.
