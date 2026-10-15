# Release readiness and implementation checklist

Last reviewed: 2026-10-15. Implementation starting baseline: `53d96a263f055e14bbb1c6a1a35c6d7bb58c9652`.
Release implementation and deployment evidence: Codex, acting on the repository owner's instructions. Ongoing operator and specialist review assignments remain open under the owner roles below; deployment does not close those operational ownership tasks.
Current production runtime: `6da1bd0711870cb6eea46d87dac149414b304184`, deployed 2026-10-15 in [run 38771736815](https://github.com/Mrjoel97/ProjectX/actions/runs/38771736815). Local implementation and tests never imply live provider verification. Voice/foundation activation and the remaining drills below are still open.

| Gate | Owner role | Current state | Required closure evidence |
|---|---|---|---|
| Operations guide | Release engineer | Current/previous exact-revision local setup and restoration rehearsals passed; hosted recovery pending | Fresh setup, staging release and recovery using only the guide |
| Release configuration | Release engineer | Exact-SHA CI, production configuration gate, Convex dry-run/generated-type check, deploy/seed, staged probe and promotion passed at 6da1bd0; rollback drill pending | Exact SHA, configuration check, environment protections, successful staged promotion and rollback |
| External delivery | Backend engineer | Implemented locally: durable claims/receipts and manual uncertainty review; live reconciliation pending | Durable attempt state, no blind resend, concurrent/crash/timeout tests and controlled provider reconciliation |
| Cost admission | Backend engineer | Paid admission and strict voice bounds tested; live OpenRouter embedding usage/settlement exercised in isolated staging; voice/invoice reconciliation pending | Atomic reservations, all paid callers migrated, idempotent settlement, uncertain holds, provider reconciliation |
| Identity | Security/backend engineer | Isolated native signup verification, replay rejection, recovery/reset and old/new JWT checks passed; expiry and browser acceptance remain open | Cross-tenant negative tests, password verification/recovery, privilege and callback checks |
| Privacy/export/deletion | Security/backend engineer | Synthetic staging content/file export, isolation and storage/RAG cleanup passed; original native account self-deletion succeeded but independent original-blob proof remains pending | Typed operational events, sensitive-data sink tests, all new content included in export/deletion |
| Graph retrieval | Backend engineer | Bounded indexed traversal and stale-revision filtering tested locally | Adjacency-only reads, cycle/high-degree/isolation regression tests, read-budget evidence |
| Other request scans | Backend engineer | Indexed selection, cursor pagination, bounded working queues and durable cleanup implemented; inventory complete locally | Each scan bounded, paginated or moved to checkpointed work |
| Module boundaries | Backend engineer | Research tools, PDF renderer and current-media readers extracted in addition to traversal/foundation/stock domains; regressions passed | Incremental pure-domain extraction with behavioral regression coverage |
| Voice onboarding | Product/frontend/backend | Implemented behind disabled-by-default flag; live acceptance pending | Resumable interview, typed fallback, restricted tools, admission budget, real browser/provider evidence |
| Foundation publication | Product/backend | Implemented with six stable document IDs and exact review hash; indexing regressions passed locally | Six documents, provenance, explicit revision approval, atomic publication, searchable approved content |
| Blueprint consistency | Backend engineer | Atomic foundation/Blueprint publication implemented; no Blueprint embedding | Matching published revisions, bounded summary and references, no Blueprint embedding loop |
| Transcript retention | Security/backend engineer | Seven-day purge and export/deletion coverage implemented; live purge drill pending | Seven-day checkpoint purge, no application-stored audio, discard/export/deletion coverage |
| Billing and legal | Business owner + reviewer | Billing deliberately disabled; pikar-ai/Tanzania/contact configured; postal address pending | Confirmed business inputs and reviewed public content before commercial activation |
| Audit WORM | Service operator | WORM/AWS names absent in production preflight; export remains disabled | Configured retention, export/acknowledgement and recovery evidence; otherwise feature remains disabled |
| Connectors | Provider operator | Per-provider gates remain binding | Current connection, scope/expiry/revoke/read evidence for each enabled provider |
| Recurrence | Workflow operator | Existing gate remains binding | Required actual DST/OAuth/provider traces; do not enable on simulated evidence alone |
| Skill activation | Model operator | Per-skill evidence required | Seed/version identity, evaluation, activation and rollback evidence |
| CI portability/build | Release engineer | Local Windows checks and hosted Linux CI passed; release 6da1bd0 passed PR40/main CI and production workflow; PR40 suite: 8,190 passed, two skipped | Clean Windows/Linux checks and resolved or dispositioned build warnings |

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

- [ ] Qualify the tenant-bound upload relay on hosted Convex: production-origin CORS/preflight, a 200 MiB raw streaming upload within the storage upload timeout, single-use receipt binding, original plus normalized audio sidecar, cancellation and deletion races. Hosted admin-fixture throughput passed through 200 MiB, but the separate local 200 MiB path timed out with partial data; browser relay, cancellation and cleanup qualification remain open.

- [ ] Assign named owners and run fresh setup, staging promotion and rollback drills; attach exact revision and environment evidence.
- [ ] Exercise controlled Gmail/Microsoft acceptance, response loss and mailbox reconciliation. Confirm one provider send per request and no blind retries.
- [ ] Establish trusted voice session ownership, hard termination and provider usage reconciliation. Browser telemetry must never release a hold. Verify transcription duration ceilings against trusted metadata, and provider pricing against the configured model.
- [x] Route the operator-only `probeGemini` diagnostic through paid admission. Folder and per-call reservations remain conservatively overlapping; reconcile actual provider invoices before tuning allowances.
- [x] Provision verified sender configuration and confirm one controlled production email reaches the owner's inbox. Native application authentication is a separate gate below.
- [x] Run native signup verification, replay rejection, recovery/reset and old/new JWT checks with an isolated account. See the release evidence below.
- [ ] Complete authentication expiry and browser-specific acceptance checks.
- [ ] Verify erasure against storage/RAG/provider systems, including already-running work. Record retained audit/billing/security exceptions.
- [x] Inventory request-time `.collect()` paths; replace unbounded histories with exact indexes, pagination or bounded cleanup; extract research/PDF/media read modules. See [retrieval inventory](governance/retrieval-boundaries-2026-10-15.md). Production index rollout and load evidence remain release checks.
- [ ] Run real microphone/browser onboarding: interruption, reconnect, resume, typed/upload fallback, correction, six-document review, explicit approval and repeat publication. Confirm only current approved documents ground answers.
- [ ] Drain or cancel pre-upgrade ingestion workflows that lack content-hash guards before enabling foundation onboarding. Seed/version the new skill, verify evaluation, then enable `FOUNDATION_ONBOARDING_ENABLED=1` in staging first.
- [ ] Observe seven-day transcript expiry and bounded cleanup; verify discard, export and account erasure.
- [ ] Obtain the remaining postal address and reviewed legal content. Keep billing disabled as explicitly instructed; do not activate it during this release. Resolve WORM retention, connector and recurrence provider evidence independently and preserve their gates.

The unchecked tasks require additional implementation or operational evidence. The runtime release recorded above does not establish completion of every original gap.

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
| Isolated account self-deletion | Self-deletion succeeded | Independently verify storage blob absence and remaining RAG/provider cleanup before closing erasure |

Native drill outcomes are operator-observed evidence; this document retains no test emails, account IDs, storage IDs, codes or tokens. Their independent cleanup proof remains pending. Production foundation onboarding and controlled voice remain off; billing remains off by owner instruction. No qualified browser/microphone session exists, and no live voice or six-document onboarding acceptance is claimed by these tests.

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
