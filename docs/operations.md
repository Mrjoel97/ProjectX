# Current operations guide

Source inspection: 2026-10-15, starting revision `53d96a263f055e14bbb1c6a1a35c6d7bb58c9652`.
Production runtime revision `c2cf18c2cbcf4d16df4e3143271ac69471172f64` deployed on 2026-10-15 through [release run 38760903041](https://github.com/Mrjoel97/ProjectX/actions/runs/38760903041). Convex deployment, registry seed, staged probe, promotion and durable-origin verification passed. [Release readiness](release-readiness.md) records the evidence and live gates that remain open; deployment does not establish voice/onboarding activation or complete provider qualification.
This guide is the current entry point; dated playbook notes and ADRs explain historical decisions.

## Architecture and ownership

The Next.js web app uses authenticated Convex queries, mutations and actions. Convex owns durable
workflows, scheduling, database state, storage and component integrations. Pure TypeScript packages
own domain policies. Runtime prompts come from the versioned skill registry. Voice uses a server-owned provider call and WebSocket control channel; the browser carries microphone/playback audio and receives no provider capability. The server admits each response, caps sessions at five minutes and 20 responses, and requests termination on failures or disconnects. Permanent provider keys remain server-side. VOICE_SERVER_CONTROL_VERIFIED must stay off until real provider/browser tests verify these controls; an old short-lived-token deployment does not provide them.
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

## Configuration planes

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

The deploy workflow accepts a successful CI push on main in this repository and checks out its exact
SHA. Promotion currently requires a commit subject beginning `[deploy]`. Verify actual branch and
environment protection settings; the marker alone is not an enforced reviewer approval.
The workflow builds/uploads Vercel without domain promotion, checks Convex deployment/codegen,
deploys and seeds the backend, probes the application, then promotes the web artifact.
Disable competing automatic production deployment paths. Never use Vercel to deploy Convex separately.

Before promotion record the previous frontend artifact, backend SHA, schema compatibility and enabled
feature flags. For a frontend-only failure restore the previous compatible Vercel artifact. For a backend
failure disable affected features first, then deploy the previous compatible backend revision through the
verified release process. Backend deployments do not reverse data writes: destructive schema/data changes
need a tested forward repair or restore procedure. Run staging recovery drills before marking rollback verified.

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

The initial names-only production preflight is [run 38748292173](https://github.com/Mrjoel97/ProjectX/actions/runs/38748292173), against the existing baseline 53d96a. OpenAI/OpenRouter and other provider configuration names were present; values, account balances, scopes and live behavior were not checked. The later [configuration check](https://github.com/Mrjoel97/ProjectX/actions/runs/38756649548) confirmed AUTH_RESEND_KEY and AUTH_EMAIL_FROM after the operator corrected their names. The release key targets `opulent-octopus-494`, matching the owner's dashboard. A single controlled Resend test was accepted with HTTP 200 in [run 38757084736](https://github.com/Mrjoel97/ProjectX/actions/runs/38757084736), receipt `01a14018-2786-7c9c-afb2-598fca0a0f9d`; the owner confirmed inbox arrival on 2026-10-15. Native password verification/recovery and session invalidation still require a real application drill. Never paste credentials into this guide, source control or release evidence. Required WORM/AWS names were absent; WORM stays disabled until its independent retention/acknowledgement evidence is complete.

Business identity settings: pikar-ai; Tanzania; joel@pikar-ai.com. Postal address remains an explicit missing input. Billing remains disabled by the user's instruction, including after a successful technical deployment. Legal review and provider readiness are separate from this configuration record.

## Retrieval and operator-report completeness

[Retrieval boundary inventory](governance/retrieval-boundaries-2026-10-15.md) records indexed selections, cursor pages, durable cleanup and retained closed-set collections. Deploy additive indexes before evaluating the new readers. Request, goal and recipient-report screens expose Load more; a bounded compatibility list is not a full tenant export.

For media reconciliation, spendForPeriod returns one 500-row page plus continueCursor/isDone and unrounded estUsd. Follow every cursor over the same tenant/time interval; sum actualCents and estUsd, then round estimated dollars once. Do not present a single page as the complete period or sum already-rounded estimated cents. listJobsPage provides 100-row operator history; the legacy listJobs explicitly rejects histories over 1000.

SkillOpt export is likewise paged. The CI script scripts/skillopt-export.mjs follows 100-row pages and rejects a repeated/invalid cursor; raw curl of one page is not a full training dataset. Optimizer eligibility uses the newest 1000 feedback sample and discloses truncation. DLQ and operational-signal sample counts are lower bounds where flagged.

Mail configuration follow-up: the owner reports the Resend dashboard domain is Verified. A fresh names-only Convex check ([run 38749457677](https://github.com/Mrjoel97/ProjectX/actions/runs/38749457677)) still found AUTH_RESEND_KEY and AUTH_EMAIL_FROM absent. Domain verification alone does not complete application mail configuration or a successful verification/recovery delivery drill.
