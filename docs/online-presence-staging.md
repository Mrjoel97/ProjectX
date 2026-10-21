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
No production or sibling-staging environment was copied. No email, model, media or
merchant provider credentials have been configured in this new deployment.

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

## Admission and remaining acceptance

Both global model and media kill switches are **on**. Canonical skills were seeded;
three v1 web recipes remain **candidates**. Each has hosted deterministic20-case,
zero-model-cost evidence and lacks browser qualification. A storefront recipe does not
establish working checkout; merchant adapters and fulfillment remain open under53-03.

Next prerequisites are a staging-only verified email sender and Resend credential,
fresh native owner/non-owner signup/verification, and a bounded model access setup.
Create real email-bound invites; grant owner authority only to the exact verified owner.
Do not bootstrap an existing unrelated owner or substitute CLI identities for native
browser witnesses. Google login is also unconfigured in this environment.

Then earn exact-source hosted recipe browser evidence through the existing gates before
activation. The current source has qualification endpoints but no complete hosted browser
runner/operator interface. Finish that integration, exercise the actual Foundation/documents
→ questions → image-backed private draft → revision → exact review → explicit publication
→ inquiries → offline/rollback flow, and verify tenant isolation at phone/desktop sizes.
Local design fixtures and scripted models do not satisfy those gates. Publication still
requires the customer's review of the exact content; provisioning did not publish a site.
