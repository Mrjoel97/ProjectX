---
phase: 53-agentic-online-presence
plan: "02"
status: partial
updated: 2026-10-24
requirements-completed: []
---

# 53-02 — Dedicated staging deployed; hosted qualification remains open

The owner answered **"Create a separate staging environment"**. Created a new Vercel
project and Convex project/deployment exclusively for this branch. Existing production
and Phase48 staging resources were not selected or modified.

## Original October22 deployed resources and source

- Frontend: https://pikar-presence-stg.vercel.app, project `prj_O01HZIZVy4rg8u3W91W7bPjTSDQB`.
- Backend: `joel-feruzi:pikar-presence-stg:dev/presence`, deployment `third-gecko-977`;
  https://third-gecko-977.convex.cloud and https://third-gecko-977.convex.site.
- Application source: `3b189161ab2df466130d2b237ece2d7eec581f09`, plus actual Convex-generated
  API declarations produced during this apply. No handwritten application changes were
  required to provision the environment.
- Backend apply passed strict TypeScript and code generation. Frontend cloud build passed
  TypeScript and generated39 pages. Final deployment `dpl_Amez1qATSWmp9J9pvsznu4WxiAAE`
  became ready at `2026-10-21T23:37:17Z` (October22 EAT).
- Final immutable frontend URL:
  https://pikar-presence-8ufzbm9dv-joelferuzi-gmailcoms-projects.vercel.app.
- Fresh authentication RSA keys and stage `SITE_URL` were configured. Frontend receives
  only its new public Convex URL. No provider keys, user data or prior qualification
  evidence were copied. Local selectors and secrets remain ignored.

## Actual observations

[Machine-readable receipt](53-02-STAGING-2026-10-22.json) records the final observation
at `2026-10-21T23:43:29.475Z`:

| Check | Observed result |
| --- | --- |
| Anonymous frontend | `/signin`200, `/signup`200, `/dashboard/sites`307 to `/signin` |
| Search indexing policy | All three routes return staging marker and `noindex, nofollow, noarchive` |
| Public draft refusal | Missing unpublished page and missing image both404 |
| Fresh authentication public keys | JWKS200 with one public key; no private bytes captured |
| Real Edge browser | Rechecked23:48:55.721Z in headless Edge155.0.4283.62 at1280×900; sign-in/password and signup/email forms present; no page runtime errors |
| Fresh stage data | Zero users and zero website projects at observation |
| Model/media admission | Both global kill switches true |
| Recipe seed/evaluation | Read back23:48:45.065Z: all three v1 candidates have pass:true,20/20, costUsd0, model:none, no skips/retries/filter; exact runner/suite/body/definition/compiler/bundle identities recorded |
| Recipe browser evidence | Absent for all three; none activated |

The first frontend deployment omitted staging headers: a separate `--local-config` did
not apply them under the monorepo app root. A second deployment with the same temporary
config at `apps/web/vercel.json` fixed this; the final GET observations above verify it.
The temporary app file was removed after deployment. The reusable staging-only config
and [operations guide](../../../docs/online-presence-staging.md) are committed separately
from the default application config. An initial direct Node HTTP probe timed out; the
later complete probe passed. This is connectivity history, not a discarded failing gate.

Planning and playbook consistency checks, changed JSON lint/format, receipt identity/link
checks and Git whitespace checks passed. Graphify remains unavailable; the existing
Convex-edge fixup ran with79 tables and zero edge changes. No full AST regeneration is
claimed. No handwritten runtime source changed after the actual cloud typechecks/build.

## What remained open at the October22 observation

No native account verification, authenticated A/B tenant test, actual model/media call,
recipe browser qualification/activation, public website publication, inquiry/rollback
acceptance or merchant checkout ran. Canonical registry seeding is bootstrap, not new
model-quality evidence. Hosted deterministic cases do not prove browser or user workflow
acceptance. Zero model/provider evaluation spend was incurred by these deterministic checks.

Staging-only email sender/credential and bounded model access are absent. The browser
qualification endpoints exist, but a complete hosted runner/operator interface remains
to be implemented. Finish these and the actual53-02 protocol before marking OPRES-03 or
the plan complete. No other workstream's paid consent, identities or evidence were reused.
Phase53 stays3/5 complete;53-02 is partial and53-03 commerce remains open. The separate
readiness programme and historical53-05 observations remain unchanged.


## Separate continuation — 2026-10-23

See [53-06](53-06-SUMMARY.md) for current source and actual checks. Both separate staging
accounts are verified; exact approved A is the only owner, B ordinary, with one audited,
idempotent grant. Production accounts were not copied. Sender/provider key names and
confirmed standard billing are configured under the approved$5 maximum.

The first October23 source `df0286d53a09c055572e14aa982a6d3361111b1f` passed the staging
backend strict check/apply and frontend cloud TypeScript/build. Dedicated frontend
deployment `dpl_7EotyeRNHrgWUdoSV397z1ZKTnNY` reached READY and was promoted to the staging
alias. See the [October23 release receipt](../../../docs/releases/2026-10-23-online-presence-staging.json).
Historical October22 deployed-source receipts above are unchanged.

Backend repair `84d005d1dce664c3895d530aaf9a5455f600a359` was applied separately. The first
bounded100-cent evaluation exited2 and closed43 settled calls/$0.01474832; the fresh
repaired100-cent attempt also exited2 and closed45/$0.02033942. Both have zero holds,
no breach and restored model/media kill switches: total88 calls/$0.03508774. All five
second-run cases have saved artifacts. Scorer-grammar false positives were identified and
exact model-prefix comparison corrected locally; neither original paid verdict is changed, and no
passing evidence or activation exists. No further paid attempt is planned. See the
[follow-up receipt](../../../docs/releases/2026-10-23-online-presence-followup.json).

Auth UI source `7e86189009f4aafd9c9d7604d68ecd3da33fa2fd` then passed15 focused tests
and a fresh strict cloud build with40 pages. Deployment `dpl_2QjtcxFRcGxQHK5P61A87iraq1ep`
was promoted to the stable dedicated-stage alias. Actual fresh native browser sign-in
shows email/password, verification/recovery controls, and no unconfigured Google button
or OR separator. This is anonymous UI observation, not a completed owner sign-in.

Native browser control recovered and signed-in onboarding was observed. The fresh-owner
redirect is fixed and13 real Shell tests pass, but the user's owner login, actual recipe review protocol,
authenticated A/B workflow/lifecycle acceptance and exact-source browser qualification
remain pending. No full hosted acceptance or merchant checkout is claimed;53-02 stays partial.

## Native service qualification and website lifecycle — 2026-10-24

The Sites/form release `8b9064cd9bef38ecaf80eec24bd542582b79e39e` passed dedicated-stage
backend apply and frontend cloud strict build/promotion. Business-site/campaign-landing
v3 each passed20 free deterministic cases and together completed24 actual desktop/mobile
protocol outcomes, with independent audit and issuer readback. The trusted internal
operator activated only those two current service recipes. Catalogue v2 stays candidate;
its historical body/evidence is unchanged. See the [Sites release receipt](../../../docs/releases/2026-10-24-sites-staging.json).

The later deployed runtime `bea65ebf0f3e3efb016e77ee56bf9eefba5b12b6` repairs optional-field
revision retention. Its26-source recipe identity remains
`020145277a86e1023eadb14b02d95f730a45bad959912e5547d8f087e38d69ff`; v3 recipe evidence
therefore remains applicable. No new recipe version or qualification was fabricated.

Codex exercised the authenticated owner UI to approve/publish the synthetic four-page v3
website and verify all public pages, image and mobile layout. Browser consent enforcement blocked an unchecked inquiry;
one consented inquiry was accepted and stored. Headline-only v4 preserved all four pages,
asset, services and consent, then received test-operator approval/publication. Codex used
the same UI to approve/restore historical v3, verify its old public headline and take the
site offline. The user signed in; these authorized staging actions are not human
production approval. Final13:04:21.843Z readback confirms draft4/approved3/publishedVersion null;
the public route showed not found. See the [final lifecycle receipt](../../../docs/releases/2026-10-24-presence-revision-followup.json).

Both provider paths are off, unknown holds/held cents are zero and no breach occurred.
The final window ledger upper increment is$0.00436575; cumulative dedicated-stage upper
spend is$0.05901071. Historical failed shop verdicts remain unchanged. Stored inquiry
acceptance does not establish email delivery; ordinary-account tenant denial, complete
Foundation acceptance, erasure, custom domains and merchant checkout remain unestablished.
Model-written placeholder review links remain a presentation limitation.53-02/53-06 stay
partial and OPRES requirements remain open; earlier dated pending states are preserved
as history, with production/Phase48 scopes and progress counters unchanged.
