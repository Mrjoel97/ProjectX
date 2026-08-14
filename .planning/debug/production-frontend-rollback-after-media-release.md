---
status: resolved
trigger: "User reports that the production deployment we just promoted rolled the app back to an older version because media changes were staged from an older base. Determine the exact prior Vercel production deployment/version and the safest restoration path while preserving the newly deployed Convex media/backend fixes and corrected Alibaba endpoint."
created: 2026-08-14T00:58:03.0900334+03:00
updated: 2026-08-14T01:31:00+03:00
---

## Current Focus

hypothesis: Confirmed. A newer manual production build from the dirty feature worktree was overwritten by the protected workflow's older committed-main frontend snapshot.
test: Resolve the production aliases after promoting the immutable pre-incident deployment.
expecting: All custom and stable project aliases point back to `dpl_DwpdcvdxiUyt3kYtZSHx8URZncXy`, while Convex and Alibaba configuration remain untouched.
next_action: Before any future protected frontend promotion, integrate and verify the newer dirty-worktree product changes in `main`; do not treat `main` as the newest product snapshot until that happens.

## Symptoms

expected: Production should retain the newest app UI/features while adding the media generation fixes.
actual: After protected deployment run 31747156480 promoted commit f2965fe, production appears to be an older app version.
errors: No runtime error reported; visible product rollback/regression.
reproduction: Open https://www.pikar-ai.com after the 2026-08-14 deployment and compare with the version that was live immediately before promotion.
started: Began immediately after the protected production promotion completed at 2026-08-14 around 00:49 Africa/Dar_es_Salaam.

## Eliminated

## Evidence

- timestamp: 2026-08-14T01:00:00+03:00
  checked: Local resolution of promoted short SHA f2965fe.
  found: Git reports `f2965fe` as an unknown revision in the current working tree.
  implication: The current clone cannot yet be used as authoritative evidence for the promoted source; deployment and workflow metadata must supply the full SHA and prior production source.

- timestamp: 2026-08-14T01:04:00+03:00
  checked: Local Git branches, remote-tracking refs, and worktree status.
  found: The checkout is `feature/cash-business-finance` at 5c06b33 with extensive pre-existing modifications; local `main` is 232 commits behind `origin/main`; `origin/main` is d7ca017 (merge PR #9 for media permissions/routing), whose media commits a9519d1 and 06eb63c descend from the release-pipeline history.
  implication: The dirty feature worktree must not be used for restoration or altered. The authoritative production comparison must use immutable remote/deployment metadata and isolated source snapshots.

- timestamp: 2026-08-14T01:04:00+03:00
  checked: Local Vercel linkage.
  found: `.vercel/project.json` links project `pikar-ai-convex`, project ID `prj_WmCtlmOX0ZsIxusuSc6Zwad3otN0`, org ID `team_A2KUgi8LeCYzoSNiQNKhy2CQ`, root directory `apps/web`.
  implication: Read-only Vercel history can be scoped to the exact frontend project rather than inferred from domain aliases.

- timestamp: 2026-08-14T01:09:00+03:00
  checked: Complete `.github/workflows/deploy-production.yml` release path.
  found: The workflow sets `DEPLOY_SHA` to the successful CI workflow-run `head_sha`, checks out exactly that SHA, builds/uploads a prebuilt production artifact with `githubCommitSha` and `githubCommitRef=main` metadata, deploys Convex first, then promotes that staged Vercel artifact.
  implication: If production regressed, the pipeline did not accidentally deploy the runner worktree; it intentionally promoted the exact main SHA supplied by the triggering CI run. A prior production deployment from another ref could still be newer in product content.

- timestamp: 2026-08-14T01:09:00+03:00
  checked: Prior media and endpoint debug records.
  found: Media fixes span backend files plus `MediaCanvas.tsx`, with corrected Alibaba workspace host stored externally; the last known healthy endpoint release was run 31653512312. Media record says run 31747156480 completed Convex deploy and Vercel promotion successfully.
  implication: A raw Vercel rollback would restore only the frontend artifact and would not revert the already-deployed Convex backend or Alibaba environment value, but it could lose the MediaCanvas retry/UI changes. A forward source integration is safer for a durable complete fix.

- timestamp: 2026-08-14T01:11:00+03:00
  checked: Initial read-only GitHub API queries for run 31747156480 and commit f2965fe.
  found: The sandbox denied outbound socket access before GitHub returned metadata.
  implication: This is an environment access limitation, not evidence about the deployment; the same read-only calls require approved network execution.

- timestamp: 2026-08-14T01:14:00+03:00
  checked: GitHub Actions run 31747156480 metadata, commit API, and promotion logs.
  found: Run succeeded from 2026-08-13T21:46:53Z to 21:49:53Z (00:46:53-00:49:53 +03) with exact head SHA f2965fe9f2f205265263a704adca559611000f23. It promoted URL `pikar-ai-convex-w9j3uzuem-joelferuzi-gmailcoms-projects.vercel.app`, deployment ID `dpl_2ecLxrhJfCHgogRVGpbWjH17eH3T`, at 21:49:47Z.
  implication: The new production artifact and its immutable identifiers are confirmed; the visible rollback is not a mistaken report of which run finished.

- timestamp: 2026-08-14T01:14:00+03:00
  checked: GitHub commit object f2965fe9f2f205265263a704adca559611000f23.
  found: f2965fe is PR #10 merge `fix(schema): accept organizational vault folders`, parents d7ca0171297ebd6e533cc9c6a07fdc1a79d5e389 and 05f2bbfb188e858dd3f583f9def62d9fd9d6c7c8, authored 2026-08-13T21:43:08Z. Relative to first parent, it changes only three lines in `packages/backend/convex/schema.ts`; d7ca already includes the media PR.
  implication: The newly promoted main includes the backend media work and schema compatibility fix, but this does not establish that it contains the frontend version previously live from Vercel.

- timestamp: 2026-08-14T01:18:00+03:00
  checked: Read-only Vercel deployment list for project `pikar-ai-convex`.
  found: The protected artifact w9j3uzuem was created 2026-08-13T21:48:48.744Z. The immediately preceding READY production-target deployment is `pikar-ai-convex-lffd7c8w2-joelferuzi-gmailcoms-projects.vercel.app`, created 2026-08-13T21:39:21.741Z, sourced from `feature/cash-business-finance` at 5c06b33cdaa79bc3ed9ffb8625367f0243d9341f, with metadata `gitDirty=1` and `actor=codex`. The next older deployment efivznpg6 is clean pipeline main d7ca017.
  implication: The chronology strongly supports that a manual dirty-worktree production build containing newer UI was replaced by the later protected main deployment. Commit 5c06b33 alone cannot recreate that artifact because `gitDirty=1` means uncommitted files participated in the build.

- timestamp: 2026-08-14T01:22:00+03:00
  checked: Initial Vercel inspect of the suspected previous deployment.
  found: lffd7c8w2 has immutable deployment ID `dpl_DwpdcvdxiUyt3kYtZSHx8URZncXy`, target production, READY, and Vercel reports the custom production aliases in its deployment record. Raw combined inspect output was too large to reliably distinguish all three queried objects.
  implication: The prior immutable artifact is identified, but concise parsing is required to prove the current alias resolves to the new ID and to interpret whether the old aliases field is historical or active.

- timestamp: 2026-08-14T01:24:00+03:00
  checked: Concise Vercel inspect parser with stderr suppressed.
  found: The installed Vercel CLI emitted no parseable stdout under that redirection.
  implication: JSON/progress output is carried on stderr by this CLI; capture and sanitize both streams without changing Vercel state.

- timestamp: 2026-08-14T01:27:00+03:00
  checked: Combined-stream Vercel JSON capture through PowerShell.
  found: The CLI renderer bypassed the PowerShell pipeline capture despite the shell runner receiving output in direct invocations.
  implication: Use direct human-readable inspect output; this is a tooling-output limitation, not deployment evidence.

- timestamp: 2026-08-14T01:31:00+03:00
  checked: Direct Vercel inspect of `www.pikar-ai.com`, old lffd7c8w2, and incident w9j3uzuem after operator restoration.
  found: `www.pikar-ai.com` now resolves to `dpl_DwpdcvdxiUyt3kYtZSHx8URZncXy` (lffd7c8w2), created 2026-08-14 00:39:21 +03, READY production. Its aliases include both custom domains and stable project aliases. Incident deployment `dpl_2ecLxrhJfCHgogRVGpbWjH17eH3T` (w9j3uzuem), created 00:48:48 +03, remains READY but retains only its immutable/project-specific alias.
  implication: The exact pre-incident frontend artifact has been restored successfully without deleting the incident artifact. This alias restoration does not redeploy or roll back Convex and does not alter the Alibaba workspace endpoint.

## Resolution

root_cause: "The frontend that was live before the media release was a manual Vercel production build from feature/cash-business-finance at 5c06b33 with gitDirty=1. The protected workflow correctly built committed main at f2965fe, but committed main did not contain the newer uncommitted product/UI changes, so promotion replaced a newer product snapshot with an older one."
fix: "Promoted the exact immutable pre-incident Vercel deployment dpl_DwpdcvdxiUyt3kYtZSHx8URZncXy (lffd7c8w2) back to production. This changed only Vercel aliases and preserved the already-fixed Convex backend and Alibaba workspace endpoint."
verification: "Vercel inspect of https://www.pikar-ai.com resolves to dpl_DwpdcvdxiUyt3kYtZSHx8URZncXy, READY production, with aliases www.pikar-ai.com, pikar-ai.com, and the stable project aliases. Incident deployment dpl_2ecLxrhJfCHgogRVGpbWjH17eH3T remains available but is no longer assigned the custom production domains."
files_changed: []
