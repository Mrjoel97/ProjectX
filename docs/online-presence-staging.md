# Dedicated online-presence staging

Created at the owner's explicit request on 2026-10-22 EAT. This is a new environment
for `codex/online-presence-discovery-20261021`, separate from production and the Phase48
staging workstream. Infrastructure is deployed; authenticated model/workflow qualification
is still open. Current evidence: [53-02 summary](../.planning/phases/53-agentic-online-presence/53-02-SUMMARY.md).

## Resources

| Resource | Exact staging target |
| --- | --- |
| Website | https://pikar-presence-stg.vercel.app |
| Vercel scope/project | `joelferuzi-gmailcoms-projects/pikar-presence-stg` |
| Vercel project ID | `prj_O01HZIZVy4rg8u3W91W7bPjTSDQB` |
| Vercel team ID | `team_A2KUgi8LeCYzoSNiQNKhy2CQ` |
| Convex team/project | `joel-feruzi/pikar-presence-stg` |
| Convex deployment reference | `joel-feruzi:pikar-presence-stg:dev/presence` |
| Convex deployment name | `third-gecko-977` (cloud development deployment) |
| Convex client URL | https://third-gecko-977.convex.cloud |
| Convex HTTP URL | https://third-gecko-977.convex.site |
| Backend dashboard | https://dashboard.convex.dev/d/third-gecko-977 |

The Vercel **production target inside this staging project** supplies its stable alias.
It is independent of the application's production Vercel project and domains. Do not
reuse the Phase48 release/parity workflows, credentials, accounts or evidence here.

## Configuration and deployment

Vercel: root directory `apps/web`, Next.js, Node24, include files outside root enabled,
install `pnpm install --frozen-lockfile`, build `pnpm --filter @pikar/web build`, default
`.next` output. Its only application environment variable is the public
`NEXT_PUBLIC_CONVEX_URL=https://third-gecko-977.convex.cloud` in all three Vercel targets.
There is no Convex deployment step in the frontend build.

The backend has fresh, staging-only RSA authentication keys (`JWT_PRIVATE_KEY`, `JWKS`)
and `SITE_URL=https://pikar-presence-stg.vercel.app`. Convex supplies its built-in URLs.
Keys were generated in memory and passed over stdin; none belong in source or receipts.
No production or sibling-staging environment was copied. On2026-10-23, a names-only
check confirmed staging-only AUTH_RESEND_KEY and OPENROUTER_API_KEY are present.
AUTH_EMAIL_FROM is the owner's supplied joel@pikar-ai.com. Secret values were not read.
Media and merchant integrations remain unconfigured.

Before any future backend apply, clear inherited deploy/self-hosted credentials and
explicitly select `joel-feruzi:pikar-presence-stg:dev/presence` with the installed
`convex deployment select` command from `packages/backend`. Confirm that the resulting
ignored `.env.local` points at `dev:third-gecko-977` and both URLs above. Then the existing
`pnpm --filter @pikar/backend exec convex dev --once --typecheck enable --codegen enable --tail-logs disable`
applies only to that selected development deployment. Review generated changes. Stop
on any different target; do not accept an interactive production fallback.

Before frontend deployment, confirm the ignored root `.vercel/project.json` contains
the exact project/team IDs above. Link this project only if it is not already selected.
Use [the staging header config](../config/online-presence-staging.vercel.json) as
`apps/web/vercel.json` **temporarily**, refusing to overwrite an existing app config.
Deploy from the repository root using the installed Vercel CLI, `--prod --yes
--scope joelferuzi-gmailcoms-projects --archive=tgz`, and remove only that temporary copy
in a `finally` cleanup. Keep the original config in `config/`; never make its no-index
policy the default for every project. Passing this file solely through `--local-config`
did not apply headers to the monorepo app in the first observed deployment.

After deployment verify GET `/signin` and `/signup` return200, `/dashboard/sites`
redirects307 to `/signin`, and all three have `X-Robots-Tag: noindex, nofollow, noarchive`
plus `X-Pikar-Environment: online-presence-staging`. Verify missing unpublished page/image
routes on the Convex HTTP origin return404. Check the real browser for runtime errors.
Do not treat anonymous sign-in rendering as authenticated account acceptance.

## Current release and bounded repair — 2026-10-23

Source `df0286d53a09c055572e14aa982a6d3361111b1f` passed dedicated-stage backend strict
checking/apply and frontend cloud TypeScript/build. Frontend deployment
`dpl_7EotyeRNHrgWUdoSV397z1ZKTnNY` reached READY and was promoted to this staging project.
The [dated release receipt](releases/2026-10-23-online-presence-staging.json) preserves
that source and its first paid attempt: runner exit2, five failed fixture verdicts and
refused model-spend attribution evidence. Its envelope closed with43 settled calls,
zero holds, no breach and$0.01474832 actual cost; both kill switches were restored true.
That observation remains a failure receipt.

Repair `84d005d1dce664c3895d530aaf9a5455f600a359` was saved/pushed and applied only to
`third-gecko-977` in28.8 seconds. It fixes the shop-only ledger/model-proof mismatch and
clarifies evidence-grounded commercial preparation. Focused native proof16/16,
contracts73/73 and the runner's8 packs/40 cases/78 rejection controls passed. Local
rescoring of saved actual replies found zero fixture failures; it is offline diagnosis,
not a new paid pass or a rewrite of the first verdicts. This strings/provenance/constants
follow-up reuses the previous strict deployment validation; no new full typecheck or
frontend deployment is claimed for that backend-only apply. Its frontend was then the
df0286d5 build; the later auth deployment is recorded below.

Golden revision is now
`2026-09-11.budgeted-evaluator.248d2235e0f29bb466e834ad4de5e98297be96858377758c7bcdf4f0491e62da`;
vertical evaluator is `e7b070967def6f100b6c2943222026193ac031444f3810689515a1a5c723cb43`.
Both offline identity checks pass, with unchanged46-case golden and six-lane/40-case
vertical corpora. Recipe26-source identity remains
`9dcc29ebea307d30fd9f998d34fefa37a2136ab88c2931079c050fac608d3410`.
Refreshing these pins creates no passing evaluation evidence.

### Final paid attempt and deployed sign-in repair

The fresh100-cent attempt on84d005d1 ran14:44:15.223–14:51:25.146Z and exited2. Its
authoritative envelope closed with45 settled calls, zero holds, no breach and$0.02033942
actual cost, with both kill switches restored true. Across both attempts the observed
total is88 settled calls/$0.03508774. All five second-run cases have saved artifacts;
scorer-grammar false positives were identified and model-prefix comparison was corrected
locally. Those diagnoses do not rewrite either failed verdict or issue passing evidence.
No more paid runs are planned. See the
[follow-up receipt](releases/2026-10-23-online-presence-followup.json).

Actual sign-in exposed Google OAuth before it was configured. Auth UI repair
`7e86189009f4aafd9c9d7604d68ecd3da33fa2fd` reuses `invites.authProviders` and offers
Google only after an explicit configured response. It passed15 focused tests and a new
strict cloud TypeScript/build with40 pages. Deployment `dpl_2QjtcxFRcGxQHK5P61A87iraq1ep`
was promoted to the stable staging alias; its immutable URL is
https://pikar-presence-j5esn3fel-joelferuzi-gmailcoms-projects.vercel.app.
The backend remains84d005d1. A fresh native browser reload actually shows email/password,
verification and recovery controls, with no Google button or OR separator. No Google
credentials, provider or production configuration changed. The user's owner sign-in
and authenticated recipe protocol remain pending.

## Admission and remaining acceptance

Both global model and media kill switches stay on outside an explicitly bounded test
window. Canonical skills were seeded; the original October22 three v1 recipe candidates
had hosted deterministic20-case, zero-model-cost evidence without browser qualification.
Those dated observations do not qualify a newer source. A storefront recipe does not
establish working checkout; merchant adapters and fulfillment remain open under53-03.

The owner approved a maximum total model-test spend of$5 for this environment.
Reasoning's deployment rail is$2 and ingest's is$1; the first and fresh follow-up shop
evaluation envelopes are each capped at$1. Allocated maxima total$5, not$6. These caps
are distinct from actual spend and do not authorize future-day runs.
Both kill switches remain on outside an explicitly bounded test window. The new shop-only operator harness uses a fixed100c envelope before seeding, covers
seed/query/chat, refuses outstanding reservations and disables paid/seed replay.
Require unbreached settled status and normal close plus authoritative closed/zero-hold
readback before evidence; retain unknown holds and never replace or top up an unresolved
budget. The fresh repaired attempt follows confirmed closure/zero holds of the first,
uses its own fixed100-cent envelope within the existing$5 total and does not replay paid
work on the old envelope. Both attempts are now closed with zero holds and restored
switches; neither qualified. Unspent actual cost is not authorization for another run.
The historic runner's post-call cap alone does not provide this bound.

The owner completed two native staging signups and email verifications on2026-10-23.
Exact server readback confirms both verified; the explicitly approved A owner grant
produced one audit and idempotent readback, with B ordinary and exactly one owner.
Browser control recovered and the signed-in onboarding page was observed directly.
Production accounts were not copied. These facts are not full feature/browser qualification.
Create real email-bound invites; grant owner authority only to the exact verified owner.
Do not bootstrap an existing unrelated owner or substitute CLI identities for native
browser witnesses. Google login is also unconfigured in this environment.

Fresh owners use the exact /ops or /ops/web-recipes exception to business onboarding;
ordinary users and customer routes retain setup. Page/server owner checks remain.

Then earn exact-source hosted recipe browser evidence through the existing gates before
activation. Current source adds an owner-only operator interface at `/ops?view=web-recipes`
for the existing qualification endpoints. Its sandboxed inert preview disables images
and cannot issue independent passing browser evidence or activation. The independent
runner and native browser witness remain required. Exercise the actual Foundation/documents
→ questions → image-backed private draft → revision → exact review → explicit publication
→ inquiries → offline/rollback flow, and verify tenant isolation at phone/desktop sizes.
Local design fixtures and scripted models do not satisfy those gates. Publication still
requires the customer's review of the exact content; provisioning did not publish a site.
