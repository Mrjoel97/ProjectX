# Current operations guide

## Latest onboarding status — 2026-10-18

This update supersedes the older current-status paragraphs below. Production runtime is `f921de951b77c3a57b378fa86be81f5e48587199`, with [main CI 39131026130](https://github.com/Mrjoel97/ProjectX/actions/runs/39131026130) and [release 39131345607](https://github.com/Mrjoel97/ProjectX/actions/runs/39131345607) passed. Normal voice remains capped at 15 minutes. Onboarding voice avoids redundant coaching-model work and requires a full 15 minutes remaining in its owner-only 30-minute pilot before connecting.

The owner now confirms working production onboarding voice and review/approval of all six business documents. Read-only browser inspection independently verified approved revision 17, six Ready published sources and six Ready foundational references in the confirmed Business Blueprint. Interview revision 18 is a later saved draft and is not implicitly approved. The remaining real-business approval gate is closed for revision 17 only.

For the latest retry, the owner authorized up to $5 extra AI usage today. An audited one-time 417-cent allowance restored their remaining daily budget from 83 to 500 cents without clearing reservations, changing recorded spend or altering the original window. It expires October 18 at 18:54:14.950 UTC (21:54 EAT). Other users and deployment budgets were unchanged. Subsequent failures at 17:06 EAT were `VOICE_PILOT_WINDOW_TOO_SHORT`, not budget failures; admission was renewed and the owner reported a successful retry.

Billing and global foundation admission remain disabled. The temporary owner pilot expires automatically; a browser refresh does not renew it. Keep the current-revision retrieval trace, actual October 24 retention observation, provider reconciliation, in-flight erasure, upload/cancellation and remaining recovery/legal gates open as detailed in [release readiness](release-readiness.md). This acceptance record does not authorize broader feature changes or approval of later drafts.

## Historical production baseline — 2026-10-17

Source inspection: 2026-10-15, starting revision `53d96a263f055e14bbb1c6a1a35c6d7bb58c9652`.
Current production runtime revision `d95168841ec5e698cd1b6f5b690c76532471aa27` deployed through [release 39057023401](https://github.com/Mrjoel97/ProjectX/actions/runs/39057023401), following [main CI 39056721598](https://github.com/Mrjoel97/ProjectX/actions/runs/39056721598). Normal controlled voice admission is enabled with the 15-minute cap. The bounded owner onboarding pilot expired and its grant was removed; global foundation admission and commercial billing remain disabled. During that pilot, the owner reported production speaking, interruption, reconnect, refresh, typed fallback and correction of a saved answer all worked. Server evidence records one controlled onboarding session, seven trusted responses/reservations, confirmed provider termination, zero unresolved response reservations, 23 cents actual usage, and the initial 100-cent hold retained. Six owned documents were ready at foundation revision 2 and `publishedRevision` 2; the owner has not reviewed all six, so human approval remains open. See [release readiness](release-readiness.md) for all remaining gates and limits.
This guide is the current entry point; dated playbook notes and ADRs explain historical decisions.

## Current production status — 2026-10-17

[Main CI 39056721598](https://github.com/Mrjoel97/ProjectX/actions/runs/39056721598) and [production release 39057023401](https://github.com/Mrjoel97/ProjectX/actions/runs/39057023401) passed for exact runtime `d95168841ec5e698cd1b6f5b690c76532471aa27`. The previous normal-voice cap regression is corrected: shared controlled voice sessions retain the 15-minute maximum. Onboarding sessions remain bounded by their temporary pilot expiry. The owner verified the production voice experience—speaking, interruption, reconnect, refresh, typed fallback and correction of a saved answer. This supplements, but does not replace, server-side accounting and termination evidence.

The separate owner-verified onboarding grant was open only from 18:15 to 18:30 UTC and has been removed. The single controlled session ended with provider termination confirmed. Server-observed counters show seven trusted responses/reservations, no unresolved response reservations, 23 cents actual usage, and the original 100-cent initial hold retained. All six owned reference documents were ready at revision 2 and the published revision was 2. The owner confirmed typed fallback and correction of a saved answer. They have not reviewed all six, so do not call the business content approved and do not turn on global foundation admission. Commercial billing remains disabled.

The owner owns release approval, incident response, privacy requests and provider/billing reconciliation. Legal inputs remain draft pending specialist review; billing stays disabled. The seven-day transcript retention observation is not complete until its recorded expiry and successful purge are observed on 2026-10-24. Backup/recovery, runbook and provider invoice reconciliation remain separate open tasks. The detailed matrix and evidence limitations are in [release readiness](release-readiness.md).

## Voice rollout incident and current admission — 2026-10-17

The owner reported failures on both `/dashboard/voice` and `/dashboard/onboarding`. Normal voice was blocked by the global `VOICE_SERVER_CONTROL_VERIFIED=0` setting. The separate owner onboarding grant ran from 17:27:08 to 17:42:08 UTC, but the backend required five minutes remaining to start a session: its last admission time was 17:37:08 UTC. The UI still offered its start button until 17:42:08 UTC. This mismatch explains refusal in the final five minutes; it does not explain the earlier failure reported around 17:34 UTC, whose cause remains unproven.

[Restoration run 39054802077](https://github.com/Mrjoel97/ProjectX/actions/runs/39054802077), job 117460480454, succeeded at 17:41:12 UTC against unchanged runtime `4e83cd4f77d1978b2d5caec0fed90b514597f820`. It set only `VOICE_SERVER_CONTROL_VERIFIED=1` and removed the exact owner pilot grant. Global foundation admission remains `0`, commercial billing remains disabled, and budgets are unchanged. This restores normal voice admission; a successful browser retry has not yet been observed. Onboarding acceptance also remains pending. Neither both routes working nor full plan completion is established.

## Production acceptance scope — 2026-10-17

At the owner’s instruction, remaining qualification uses https://www.pikar-ai.com; a staging custom domain is not a prerequisite. PR53 adds NATIVE_ONBOARDING_PILOT: exactly one tenant, issued/expiry timestamps and a maximum fifteen-minute grant. It does not bypass native verification, tenant boundaries, budgets, provider controls or deletion fences. General/document voice was disabled during the disposable acceptance window; its later restoration is recorded above. Session deadlines are capped by the grant; cleanup remains available after admission expires. Paid foundation work rechecks admission between calls, voice rechecks expiry after budget reservation, and a known provider call is hung up if its SDP body cannot be read. These changes passed 112 focused tests (overlapping full CI), all twelve package typechecks, 22 free gates and peer review.

A separate disposable password account completed actual production signup/email verification, an empty-business-state check, recovery delivery, password reset and ordinary new-password sign-in. The owner’s Google account was not used for synthetic business publication. Anonymous production dashboard/onboarding/settings requests redirected to sign-in and a foreign-origin authentication POST returned 403. These are API/boundary checks, not native browser or microphone acceptance.

Production acceptance in the disposable native account completed six-document review/publication with all six real indexes ready. The first correction reconfirmation extracted only headcount; it stayed safely incomplete and unpublished. One explicit clarification supplied the remaining four facts, after which exact review passed. One actual Realtime connection then received audio, saved one verbatim planned-offer statement through the server tool, recorded three trusted responses and acknowledged hangup. A second exact synthetic review published that amendment with the same six document IDs; native search returned current references with exact current hydration. This does not expose matched chunks, so nativeMatchedChunksVerified remains false.

A native 192-byte file passed origin/preflight, foreign-origin refusal, ticket replay refusal and indexing. The full native export visited every classified table without truncation, preserved file links across pages, decoded the exact uploaded bytes/hash and matched both actual reviewed publication snapshots plus Blueprint references. These results are synthetic-business API/protocol evidence; browser microphone, interruption/reconnect, browser upload cancellation and real business approval remain separate.

[Production pilot 39051661510](https://github.com/Mrjoel97/ProjectX/actions/runs/39051661510), job 117451330409, completed successfully. The fifteen-minute grant admitted only the verified disposable tenant and was removed at 17:13:13 UTC; the final always-restore confirmed original global configuration unchanged at 17:13:20 UTC. The independent observer recorded one controlled onboarding session, three trusted responses/reservations, nine cents of settled voice usage, the original 100-cent initial hold retained, zero unresolved response reservations and confirmed provider hangup. This is tenant/window ledger corroboration, not a provider invoice or per-response invoice correlation. Foundation revision10 was published at revision10 with six ready owned sources. Test-account erasure was still pending at this observation.

Native production self-erasure succeeded after the verified export. A still-unexpired token was then rejected by query, mutation, ordinary action and erasure action using the installed SDK and actual HTTP200 Convex error envelopes. Same-token positive controls passed before deletion. The original 560-only raw-probe assumption failed and was corrected; production error reasons remain redacted, so no literal UNAUTHENTICATED-message claim is made. [Independent physical observer 39053212353](https://github.com/Mrjoel97/ProjectX/actions/runs/39053212353), job117455837563, passed at 17:22:03 UTC: user, auth accounts/sessions, documents, receipts, known stored objects, all captured RAG references, every namespace version, entries, chunks and vectors were absent; the deleted-identity fence remained and cleanup was complete. It also independently corroborated the reset revocation fence and post-reset session dates. Earlier assertions expecting plaintext authentication errors remain unqualified; they were not retroactively counted as passing. Retained audit, billing and security metadata remain explicit exceptions to content erasure.

Earlier observer attempts refused a global1000-row bound and a hosted inline pagination call. The successful observer used bounded timestamp keyset pages with explicit tie, page and deadline refusals; no fixture deletion occurred before successful capture. Twenty-one private disposable credential/request/snapshot files were removed, retaining only content-free proofs. These results do not establish hosted in-flight work cancellation, external-provider cleanup, actual seven-day retention or human browser acceptance.

## Latest PR51 operational changes — 2026-10-17

PR51 merge aa4b5fb82a88907f42d1a71721a1e72db073e116 passed PR CI and [staging deployment 39045420716](https://github.com/Mrjoel97/ProjectX/actions/runs/39045420716), including strict dry-run/apply and unchanged generated files, configuration, registry and original retention fixture. It contains active folder-upload cancellation, unchanged-foundation-index preservation, scoped test scheduler cleanup and generated-storage ownership across local erasure races. PR CI passed 8,247 package/app tests, two skips, 58 operator checks, one planning check and 22 free gates. The separately recorded targeted suite totals overlap; none establishes hosted concurrency. The storage receipt is registered before bytes are returned, then promoted when attached; unattached receipts expire after one day. Process loss before ownership registration remains a manual orphan-reconciliation case. Do not treat local interleavings as proof of hosted in-flight/provider cleanup. Current aa4b5fb and previous compatible fc491ec also passed separate fresh offline frozen-install rehearsals and all 12 uncached package checks with the same lockfile hash; this is local source restoration, not hosted rollback or database recovery. Main CI and production release passed; independent public and read-only configuration postflights verified the current artifact and disabled feature state summarized above. No native browser or microphone acceptance is implied.

## Latest staging qualification — 2026-10-17

PR49 source b2dfecaa512b5b2bdf34189dcc3a09b9ff4cc41c passed [CI 39034001288](https://github.com/Mrjoel97/ProjectX/actions/runs/39034001288) and [staging deployment/repair 39034220060](https://github.com/Mrjoel97/ProjectX/actions/runs/39034220060). The operator used an exact immutable source, keyless install, strict dry-run and unchanged-source proof, then deployed only the new backend. Original flags/origins, registry and protected seven-day fixture were preserved. The digest-selected historical empty RAG namespace was removed only after proving an erased native identity fence and empty entries/chunks/vectors. Any future rollback must retain the new RAG cleanup checkpoint schema and worker.

Current native qualification proves API signup/OTP/replay, actual expired-JWT rejection and ordinary same-account sign-in; it does not prove browser expiry behavior. Six synthetic foundation sources were reviewed and republished with stable IDs; one embedding failure required exactly one controlled manual retry. No budget increase occurred. A 192-byte native upload and indexing passed. New-fixture export passed all 51 tables without truncation, including the decoded file hash and approved current/prior publication history. Native JWT erasure and subsequent still-unexpired JWT denial passed; [independent observer 39040242540](https://github.com/Mrjoel97/ProjectX/actions/runs/39040242540) also verified user/blob/receipt/RAG content and all namespace versions absent, with the deletion fence retained and cleanup complete. In-flight and external-provider cleanup remain unverified, and [production release 39041361267](https://github.com/Mrjoel97/ProjectX/actions/runs/39041361267) deployed merge fc491ec801654fc0dd36a7baa7ca5f6403b265ff with strict dry-run/apply typechecks after main CI passed, and independent public/configuration postflight passed; see the current [readiness matrix](release-readiness.md). Do not infer browser/microphone, provider consent, real business approval or seven-day retention completion. Production voice/foundation and billing remain off. A post-cleanup [read-only retention check 39040649311](https://github.com/Mrjoel97/ProjectX/actions/runs/39040649311) confirmed the original checkpoint remains present with its unchanged October 24 expiry; no purge receipt or elapsed-retention claim exists yet. Temporary generated test credential/request files were removed after account deletion without touching mailbox or user CLI authentication.

## Latest scoped provider qualification — 2026-10-17

[Staging voice run 39026259737](https://github.com/Mrjoel97/ProjectX/actions/runs/39026259737)
succeeded at reviewed source `3d877c6e8dedc80ebb6bac552c024a5703a16101`: a synthetic tool-free
session connected, received audio, acknowledged server controls and recorded one trusted response.
The ledger verified 184 cents admitted (100-cent initial hold plus 84-cent response reservation),
one cent of reported response cost, and the retained initial hold. Cleanup confirmed provider
termination and restoration of the original staging flag. This is neither an invoice reconciliation
nor native microphone/onboarding acceptance; maximum-duration and termination-failure scenarios
remain open. Production voice/foundation activation and billing remain off. See the readiness
record for the exact workflow/job and remaining gates.

## Architecture and ownership

The Next.js web app uses authenticated Convex queries, mutations and actions. Convex owns durable
workflows, scheduling, database state, storage and component integrations. Pure TypeScript packages
own domain policies. Runtime prompts come from the versioned skill registry. Voice uses a server-owned provider call and WebSocket control channel; the browser carries microphone/playback audio and receives no provider capability. The server admits each response, caps sessions at 15 minutes and 20 responses, and requests termination on failures or disconnects. Permanent provider keys remain server-side. VOICE_SERVER_CONTROL_VERIFIED must stay off until real provider/browser tests verify these controls; an old short-lived-token deployment does not provide them.
The current tenant is the authenticated user ID: this is single-user business isolation, not organizations.

The Vault stores user content and retrieval derivatives. The confirmed Blueprint is standing agent
context, deliberately not embedded or graph-extracted. Human approval governs external execution.
Audit is append-only, with refs/counts/hashes rather than business content. External WORM export is
separately configured and must not be inferred from the existence of the audit table.

## Local setup and validation

Use Node 24+ and the root packageManager version of pnpm. Run `pnpm install --frozen-lockfile`.
Generated Convex API files are tracked; a clean checkout can run static checks without creating a
deployment. When backend interfaces change, run `pnpm --filter @pikar/backend codegen` against the
intended development configuration and review the generated diff. Never target production for local work.

For interactive development run `pnpm --filter @pikar/backend dev` to configure/start a development
deployment and seed skills. Set `NEXT_PUBLIC_CONVEX_URL` in `apps/web/.env.local` to that deployment's
client URL, then run `pnpm dev` from the root. Authentication and providers require their own configuration;
read `packages/backend/convex/ops.ts` for the current environment-name inventory and readiness checks.
Do not copy production credentials into local files or paste values into issues.

Local checks: `pnpm typecheck`, `pnpm lint`, `pnpm test --concurrency=1`, and `pnpm build`.
The build requires `NEXT_PUBLIC_CONVEX_URL`; a placeholder build URL proves compilation only.
`.github/workflows/ci.yml` is authoritative for the full free-gate and operator-check commands.
Live E2E, paid evaluations and provider acceptance checks require isolated accounts and explicit budgets.
Do not treat a fixture or source-text check as provider evidence.

### Offline setup and source-restoration rehearsal

Use `node scripts/rehearse-release-local.mjs <exact-40-character-commit> <absolute-pnpm.cjs-path> <absolute-pnpm-store-path>` for an isolated local rehearsal. Locate the installed pnpm entry point rather than copying a machine-specific path from another operator. The script checks its version against `packageManager`, archives only committed files into a fresh ignored `.tmp/release-rehearsal-*` directory, installs with `--offline --frozen-lockfile --ignore-scripts`, and forces all package typechecks. It passes only operating-system path variables to subprocesses, uses empty user/global npm configuration, and does not invoke codegen, deployment or providers. A populated pnpm cache is a prerequisite; a cache miss is a failed rehearsal, not permission to silently fetch dependencies.

Keep `evidence.json` and the adjacent step logs as local artifacts. The manifest records the exact revision, Node/pnpm versions, lockfile SHA-256, durations and exit codes. Repeat with the previous compatible release to demonstrate that its committed source still restores and typechecks. This validates local source restoration only: it does not prove browser behavior, native install hooks, schema/data compatibility, database restoration or hosted rollback. Do not publish local logs without reviewing them. The older `pnpm boot:check` runs deployment-connected codegen and an unfrozen install; use it only in a deliberately configured development environment, never as the offline release rehearsal.

Local rehearsal on 2026-10-15 restored production revision `6da1bd0711870cb6eea46d87dac149414b304184` with Node 24.7.0 and pnpm 10.28.1. Frozen offline installation downloaded no packages; all 12 package typechecks passed with zero cached tasks. The lockfile remained unchanged with SHA-256 `6ccff58bc35477306e76e41e0155fb92a5c6bbdd6dbffae7dee3dcb407121663`. Local evidence: `.tmp/release-rehearsal-iRC4Nf/evidence.json` and adjacent step logs. The first sandbox attempt failed at pnpm cache project registration; rerunning with access to the existing cache succeeded. The initial execution allowed parallel package checks; the reusable script now limits them to one for constrained machines. This does not close the hosted rollback gate.

The previous release `c2cf18c2cbcf4d16df4e3143271ac69471172f64` was separately restored into `.tmp/release-rehearsal-HZnaTX/` on the same date. Its frozen offline installation and all 12 uncached package typechecks also passed; its unchanged lockfile has the same hash. The two manifests prove both committed source snapshots can be restored locally without deployment credentials. Neither snapshot was deployed or connected to a live backend during this rehearsal.

## Configuration planes

### Remaining accountable-owner and legal records

On 2026-10-17 the owner explicitly assigned Joel (`joel@pikar-ai.com`) as the accountable primary
for release approval, incident response, privacy requests, and provider/billing reconciliation.
These assignments do not establish completed runbook exercises or specialist legal review.
Record backup coverage and escalation procedures in the private operator register; specialist
product, model, connector and legal qualifications retain their separate evidence gates.

The confirmed business inputs are pikar-ai, Tanzania, the configured support contact, and the
owner-provided postal address `Dar es Salaam 17107, Tanzania`. The owner selected Tanzania law
and Dar es Salaam courts as draft terms; counsel review remains open. The postal input does not
prove registered-office status, and no supervisory authority is inferred. Commercial billing
remains disabled by owner instruction.

### Seven-day transcript retention observation

Deployment and feature activation do not begin a retention observation. The isolated synthetic
staging observation started on 2026-10-17; its timestamp evidence and future cleanup window are
recorded in the readiness matrix. Use a dedicated staging interview and
non-sensitive synthetic final text; do not delete its account or discard that interview during the
observation, because those cleanup paths would invalidate expiry evidence.

1. Privately record the exact deployment/runtime, checkpoint reference, first insertion time and
   stored expiry. Confirm expiry is insertion plus seven days. Public evidence contains only dates,
   counts and results, never transcript text or fixture identifiers.
2. Retry the same event ID and confirm it creates no duplicate and does not extend expiry. Confirm
   the checkpoint remains present before expiry without changing the clock or shortening retention.
3. Observe the first scheduled hourly sweep at UTC minute 15 after expiry. Check deletion and any
   scheduled 100-row continuation work to completion; record actual observation timestamps and
   status. Missing evidence or an absent row without the before-expiry observation is insufficient.
4. Separately exercise discard, authenticated export and account erasure. These are independent
   cleanup scenarios and cannot replace seven elapsed days of retention evidence.

The current synthetic fixture has no native user account. Its random tenant reference remains
private in staging. For a future operator check, read at most 201 foundation interviews, require
at most 200 total rows and exactly one `retention-qualification-` tenant prefix, then derive the
tenant privately and use the transcript tenant index with a two-row bound. Refuse incomplete or
ambiguous inventory; emit only counts/timestamps/booleans. Never recreate a missing checkpoint or
retry its creation after expiry, which would invalidate the observation. Preserve the fixture
until the expiry observations are complete, then clean up only that isolated synthetic draft.

### Configuration ownership

| Plane | Configuration and responsible role |
|---|---|
| GitHub production environment | Release operator: `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; variable `PRODUCTION_URL` |
| Vercel production | Release operator: `NEXT_PUBLIC_CONVEX_URL`, `MEDIA_RENDER_SECRET`, `MEDIA_SANDBOX_SNAPSHOT_ID`; sandbox identity configuration |
| Hosted Convex | Service operator: auth, model/provider, encryption, callback, budget and audit-export settings listed in `ops.ts`; `SITE_URL` and `MEDIA_RENDER_URL` must be durable origins |
| Business/release decisions | Business owner: billing configuration, jurisdiction, legal content, provider activation and evidence gates |

Password verification/recovery additionally requires hosted Convex `AUTH_RESEND_KEY` and
`AUTH_EMAIL_FROM` with a verified sending domain. Provisioning and a real delivery/verification/recovery
test are release prerequisites; missing mail configuration must not silently bypass verification.

Run the owner-only `ops.envCheck` through the operator surface before enabling a capability. Record
missing configuration names, fixture state, origins and unseeded skills; never record secret values.
Readiness here is configuration readiness, not proof of live functionality.

## Production release and rollback

### Scoped frontend rollback evidence — 2026-10-17

The dedicated staging-only alias `pikar-staging-rollback-20261017.vercel.app` was assigned
to current frontend source `3d877c6e8dedc80ebb6bac552c024a5703a16101`, previous source
`29785234c2a00ed7eb3c7816bd24e59a313327dd`, then current again. At each transition,
the deployment mapping and all 11 served JavaScript asset paths and SHA-256 bodies matched
the corresponding immutable preview. The compiled backend was `woozy-wren-368`; no production
backend reference was present. Only the exact installed Convex SDK invalid-URL example literal
was excluded from the hostname scan. All 43 pre-existing alias mappings remained unchanged.
The new alias remains on current. No backend deployment, environment change, account operation,
production alias change or auth-origin change occurred.

Local evidence: `../staging-rollback-drill-evidence.json`; reproducible operator script:
`../staging-rollback-drill.mjs`. This closes the scoped hosted frontend artifact rollback drill,
not native sign-in/read/write acceptance, backend rollback, or database restoration. A first
baseline attempt stopped before any assignment on the SDK example hostname; the reviewed exact
literal exclusion preceded the successful three-assignment run.

### Staging backend recovery evidence — 2026-10-17

[Rollback attempt 39030025328](https://github.com/Mrjoel97/ProjectX/actions/runs/39030025328)
passed the current `a129b88` deployment baseline and bounded quiet/configuration/data guards,
then failed during the previous-code phase and its automatic restoration. Completion of the
previous deployment is unknown; suppressed CLI diagnostics do not establish its failure cause.
Staging foundation admission remained paused until the separately reviewed
[current-only recovery 39030285762](https://github.com/Mrjoel97/ProjectX/actions/runs/39030285762)
deployed exact `a129b884445482625b1e8f2a236744fb2a0f2515` from a fresh checkout with dry-run
and TypeScript checks enabled. Recovery restored the proven prior foundation value `1`, verified
other watched configuration unchanged, and preserved bounded skills-registry and retention-fixture
fingerprints. Production was untouched. The original retention interview identity fingerprint is
`b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e`; its checkpoint creation
and expiry matched the original published dates before that fingerprint was recorded.

This is successful current-code recovery after a failed rollback drill, not successful backend
rollback or a diagnosis of the earlier failure. Local redacted artifact:
`../staging-backend-recovery-20261017-evidence.json`. Preserve both runs and do not rerun the
previous-code drill without a new reviewed recovery design and exclusive staging window.

### Subsequent isolated backend rollback and native privacy evidence

[Isolated rollback 39031979534](https://github.com/Mrjoel97/ProjectX/actions/runs/39031979534)
subsequently passed current `a129b884445482625b1e8f2a236744fb2a0f2515` → previous
`de18285d7466ea743d42199dc1d8de4a66dccbf9` → current in the exclusive staging window.
Configuration, registry and original retention fixture were preserved. This evidence applies to the
schema in that window, not database restoration or the unknown cause of the earlier failed attempt.
After deploying the additive `authRevocations.ragCleanup` checkpoint, use a CI-qualified forward
rollback retaining that field, the cleanup worker and tenant-erasure security fence. Do not redeploy
the older schema over checkpoint-bearing rows or disable durable work required to finish erasure.

Native API signup, six-document foundation publication, complete export and actual self-deletion
passed separately; see the readiness evidence for runs `39030504811` and `39031820186`.
Export verified the six reviewed documents plus Blueprint and one exact 192-byte decoded file.
Stale JWTs were denied across public function kinds. Independent physical reads proved storage,
user, receipts and all RAG business content absent, but retained empty namespace metadata prevented
full privacy qualification. The namespace repair, second native phase, hosted in-flight/provider
cleanup and browser/microphone acceptance require separate observed results. The original retention
clock remains pending until 2026-10-24; never reset or delete it to accelerate qualification.

The deploy workflow accepts a successful CI push on main in this repository and checks out its exact
SHA. Promotion currently requires a commit subject beginning `[deploy]`. Verify actual branch and
environment protection settings; the marker alone is not an enforced reviewer approval.
The workflow builds/uploads Vercel without domain promotion, checks Convex deployment/codegen,
deploys and seeds the backend, probes the application, then promotes the web artifact.
Disable competing automatic production deployment paths. Never use Vercel to deploy Convex separately.

The release workflow scopes `CONVEX_DEPLOY_KEY` to authentication checks, Convex dry-run/origin configuration/deploy and registry seeding. `VERCEL_TOKEN` is scoped to the required Vercel operations; Vercel build still needs that token. Dependency installation and CLI installation receive neither deployment credential, and checkout does not persist GitHub credentials. Project/account IDs remain job-wide because they are identifiers, not authentication tokens. Pulled Vercel runtime settings remain sensitive build inputs: step-scoped deployment credentials do not make the build environment public.

Before promotion record the previous frontend artifact, backend SHA, schema compatibility and enabled
feature flags. For a frontend-only failure restore the previous compatible Vercel artifact. For a backend
failure disable affected features first, then deploy the previous compatible backend revision through the
verified release process. Backend deployments do not reverse data writes: destructive schema/data changes
need a tested forward repair or restore procedure. Run staging recovery drills before marking rollback verified.

For a hosted staging rollback drill, first reserve an exclusive staging window so voice, upload and account tests cannot overlap it. Record the staging-only deployment identity, current and previous source SHAs, frontend artifact references, durable staging origin and disabled flags. Confirm the previous reader/writer code accepts the current schema and stored data; abort if that compatibility is unproven. Restore only a compatible staging frontend artifact first, verify sign-in and an isolated read/write flow, then restore the current artifact and repeat. A backend rollback is a separate exercise: prefer a forward corrective revision retaining additive schema fields, qualify its exact SHA through CI, and deploy it using the staging credential only. Record each observed result and restore the staging flags/origin before releasing the window. Never change the production domain, use its deploy key, or claim this drill succeeded from a local compilation result.

## Incidents and scheduled work

Use correlation/request/workflow IDs to trace failures. Check component/workflow state and refs-only
audit events before retrying. An uncertain external send is not evidence of non-delivery; do not manually
replay it without reconciliation. A model timeout may still incur cost. Respect the global kill switch,
tenant/deployment budgets, provider release gates and existing recurrence evidence gates.

`convex/crons.ts` is the schedule source of truth: audit export, Gmail expiry, Vault recovery, invoices,
proactive work and the gated reliability sweep. Confirm environment flags before expecting a job to act.
For stuck Vault processing inspect extraction/ingestion status and use the existing recovery workflow;
do not mark a document ready manually. For voice incidents end the provider call and verify watchdog
termination; browser disconnect alone is insufficient evidence that billing stopped.

For audit export verify bucket Object Lock/retention configuration, pending outbox, batch acknowledgement
and restore/read evidence. Missing configuration means export is disabled, not successfully complete.
For account deletion/export follow the dedicated playbooks and verify storage, RAG and provider cleanup
alongside database state. Retained audit/billing exceptions must match disclosed policy.

## Maintenance

Update this guide and the affected playbook when behavior changes. For every release, refresh the matrix
with revision, environment, evidence date and accountable owner. Unverified or externally blocked gates
remain open. No live production readiness is asserted by this document.

## Foundation onboarding rollout

`FOUNDATION_ONBOARDING_ENABLED` defaults off. Seed the `foundation-voice` skill through the existing
versioned registry before enabling it in staging. When the flag is off, existing drafts remain readable
and can be discarded; server-side gates reject interview writes, paid answers and publication. Approval binds the displayed revision and document hash; editing or changing the
Blueprint requires a new review. Publication keeps six stable Vault IDs and records revision history.
Replacement graph cleanup is paged, and stale embedding entries are excluded during reindexing.
Drain/cancel older ingestion workflows without content hashes before activation. Monitor indexing and
transcript expiry, then complete the release-matrix acceptance scenarios before production enablement.

## Current configuration observations and business constraints

The initial names-only production preflight is [run 38748292173](https://github.com/Mrjoel97/ProjectX/actions/runs/38748292173), against the existing baseline 53d96a. OpenAI/OpenRouter and other provider configuration names were present; values, account balances, scopes and live behavior were not checked. The later [configuration check](https://github.com/Mrjoel97/ProjectX/actions/runs/38756649548) confirmed AUTH_RESEND_KEY and AUTH_EMAIL_FROM after the operator corrected their names. The release key targets `opulent-octopus-494`, matching the owner's dashboard. A single controlled Resend test was accepted with HTTP 200 in [run 38757084736](https://github.com/Mrjoel97/ProjectX/actions/runs/38757084736), receipt `01a14018-2786-7c9c-afb2-598fca0a0f9d`; the owner confirmed inbox arrival on 2026-10-15. An isolated native password-account drill subsequently passed signup verification, replay rejection, recovery, reset, old-JWT revocation and new-JWT authentication; see the current release evidence in the readiness matrix. Never paste credentials into this guide, source control or release evidence. Required WORM/AWS names were absent; WORM stays disabled until its independent retention/acknowledgement evidence is complete.

Business identity settings: pikar-ai; Tanzania; joel@pikar-ai.com. Postal address remains an explicit missing input. Billing remains disabled by the user's instruction, including after a successful technical deployment. Legal review and provider readiness are separate from this configuration record.

## Retrieval and operator-report completeness

[Retrieval boundary inventory](governance/retrieval-boundaries-2026-10-15.md) records indexed selections, cursor pages, durable cleanup and retained closed-set collections. Deploy additive indexes before evaluating the new readers. Request, goal and recipient-report screens expose Load more; a bounded compatibility list is not a full tenant export.

For media reconciliation, spendForPeriod returns one 500-row page plus continueCursor/isDone and unrounded estUsd. Follow every cursor over the same tenant/time interval; sum actualCents and estUsd, then round estimated dollars once. Do not present a single page as the complete period or sum already-rounded estimated cents. listJobsPage provides 100-row operator history; the legacy listJobs explicitly rejects histories over 1000.

SkillOpt export is likewise paged. The CI script scripts/skillopt-export.mjs follows 100-row pages and rejects a repeated/invalid cursor; raw curl of one page is not a full training dataset. Optimizer eligibility uses the newest 1000 feedback sample and discloses truncation. DLQ and operational-signal sample counts are lower bounds where flagged.

Historical mail configuration observation (superseded by the successful configuration and delivery checks above): the owner reports the Resend dashboard domain is Verified. A fresh names-only Convex check ([run 38749457677](https://github.com/Mrjoel97/ProjectX/actions/runs/38749457677)) still found AUTH_RESEND_KEY and AUTH_EMAIL_FROM absent. Domain verification alone does not complete application mail configuration or a successful verification/recovery delivery drill.

## Historical release qualification — 2026-10-16

The production header and readiness matrix above supersede this earlier release record.

Production runtime `de18285d7466ea743d42199dc1d8de4a66dccbf9` passed [PR44 CI](https://github.com/Mrjoel97/ProjectX/actions/runs/38814425138) (8,194 package/application tests passed, two skipped, plus 34 operator regressions), [main CI](https://github.com/Mrjoel97/ProjectX/actions/runs/38815049837), and the [production release workflow](https://github.com/Mrjoel97/ProjectX/actions/runs/38815539297). Foundation onboarding, controlled voice and billing remain off in production; this release changed none of their activation settings. No browser/microphone acceptance is claimed.

[Staging run 38772482415](https://github.com/Mrjoel97/ProjectX/actions/runs/38772482415) confirmed OpenRouter configuration and measured hosted admin-fixture upload throughput: 1 MiB in 601 ms, 64 MiB in 1,334 ms and 200 MiB in 2,856 ms, all HTTP 200. These admin-fixture results do not qualify the authenticated browser upload relay. A separate local 200 MiB upload timed out after 125 seconds with approximately 86 MB tracked as partial data. The isolated account self-deletion succeeded. An independent private, read-only staging query on 2026-10-16 confirmed all five exact known blobs, the user row and tenant upload receipts absent, including the known partial upload. Browser cancellation, hosted in-flight cleanup and provider-side erasure evidence remain open.

The isolated native password-account drill passed signup verification, replay rejection, recovery, password reset, rejection of the old JWT and acceptance of the new JWT. This closes those exercised scenarios only; expiry and browser-specific acceptance remain separate checks. No test account identifiers, tokens or storage identifiers are retained here.

The corrected synthetic privacy drill passed in [staging run 38782552536](https://github.com/Mrjoel97/ProjectX/actions/runs/38782552536), using source `118b8e73a4e4e9dbb4164cdd57724e0ec799bec4` after its exact CI passed. It exercised content/file export, cross-tenant refusal, real embedding usage settlement, known storage/RAG record cleanup and preservation of the other fixture. Both fresh scopes cleaned up and the 10-cent budget closed. These are privileged fixture results, not native identity-export/account-erasure proof. Follow the distinctions in the readiness matrix before enabling a capability.

Staging foundation onboarding was enabled in [run 38785222601](https://github.com/Mrjoel97/ProjectX/actions/runs/38785222601) after required configuration/skills, no active fixture switches and quiet ingestion pools were verified. [Drain inspection 38784711992](https://github.com/Mrjoel97/ProjectX/actions/runs/38784711992) paged all six workflow records, found none unfinished and observed both pools quiet twice. The prior [flag-off RPC drill](https://github.com/Mrjoel97/ProjectX/actions/runs/38784279738) refused begin/paid answer/publication without creating a draft. These privileged checks prepare the staged native acceptance; they do not replace it. Staging voice was not activated by these steps.
