# Playbook: Production Beta Readiness (25-10)

> Last verified: 2026-08-30 (**THE READINESS SCREEN NOW CHECKS THE SKILL REGISTRY, WHICH IT NEVER
> DID.** `ops:envCheck` gains `unseededSkills: string[]` — every name in `REGISTRY_SKILL_NAMES`
> (`skills.ts`, already exported) with no `status: "active"` row — and `ready` now turns on THREE
> things: required env names, durable origins, **and a seeded registry**.
>
> **MEASURED, NOT HYPOTHETICAL.** Phase 29 added `knowledge-query-planner` and
> `knowledge-synthesizer` to `SEEDS`. The deployment was never re-seeded. Unified knowledge search
> was **completely inert** — the browser gate died on `NO_ACTIVE_SKILL: knowledge-query-planner` —
> while the entire unit suite stayed green, because `convex-test` seeds the registry INSIDE each
> test. One `npx convex run skills:seedSkills '{}'` turned the same spec green with no code change.
> A whole feature was dark, and the one surface whose job is "is this deployment configured?" did
> not look.
>
> **Why this belongs on the readiness screen rather than in a runbook.** §5 puts every agent prompt
> in the `skills` table and `loadSkill` fails CLOSED (`NO_ACTIVE_SKILL`) — deliberately, so a
> hardcoded prompt can never sneak in. That fail-closed behaviour is correct and unchanged. What was
> missing is that **nothing reported the precondition**: `seedSkills` is an `internalMutation` an
> operator must RUN, and its absence was invisible until a user touched the surface. An unseeded
> skill is NOT a dark feature (a product decision) — it is a surface that throws on contact, so it
> belongs in `ready`, not in `missingFeature`.
>
> Names only, like every other row here: a body is a prompt, not a readiness signal.
> **Two existing tests asserted `ready === true` over an UNSEEDED registry** — i.e. over exactly
> the deployment state that shipped a dark feature — and both now seed first. That they broke is the
> change working.
> Tests: 3 new in `env.test.ts` (unseeded is not ready and every agent is NAMED; seeding clears it,
> so the check tracks the registry rather than a constant; ONE archived row breaks `ready` and only
> that name is reported — the partial/drifted-seed case). Verified LIVE against the 1.24 GB local
> deployment: 31 index lookups, `unseededSkills: []`, `ready: false` for localhost origins only.
> `env.test.ts` 23 passed / 1 failed — the standing `QUICKBOOKS_*` red owned by 28-06, not this.)

> Last verified: 2026-08-29 (**COMMENT-ONLY CORRECTION IN `convex/lib/env.ts`; NO READINESS
> BEHAVIOUR CHANGED.** `missingEnv`'s comment above `fixturesActive` claimed the screen "cannot
> announce a seam that is off (or stay quiet about one that is on)". **That was false**, and its own
> pinning test says so: the screen reports the FLAG, while `lib/models.ts` `offlineSeamAvailable()`
> ANDs the flag with "neither model key is set", so on a keyed deployment the screen reports
> `PIKAR_OFFLINE_FIXTURES` ACTIVE while the seam is inert. The comment now states the shared half
> (one value test, `isOfflineFixtureConsent`) and the deliberate asymmetry separately, and the entry
> below is corrected where it generalised the `"1"` rule to every fixture-tier name — only
> `PIKAR_OFFLINE_FIXTURES` is routed through the shared predicate. This entry does NOT discharge the
> separate bump this playbook owes for Phase 28's `lib/env.ts` change.)

> Last verified: 2026-08-28 (**THE READINESS SCREEN NO LONGER DECIDES "IS THIS FIXTURE SEAM ON?" FOR
> ITSELF.** `missingEnv().fixturesActive` reported any fixture-tier name whose value was non-blank,
> while its one consumer, `lib/models.ts` `offlineSeamAvailable()`, required the literal `"1"`. So
> `PIKAR_OFFLINE_FIXTURES=on` — the spelling every other fixture flag in this repo takes — produced
> all three of: a readiness screen announcing a LIVE fabrication seam, a fixture that was silently
> OFF, and an unexplained `OPENROUTER_API_KEY is not set`. The value test is now ONE exported
> predicate, `lib/env.ts` `isOfflineFixtureConsent`, called by both sites, and `lib/models.test.ts`
> runs a table of literal values through both. **Only `PIKAR_OFFLINE_FIXTURES` is routed through
> it**; every other fixture-tier name keeps the non-blank test, because no consumer of those
> disagrees with it. Behaviour change, stated plainly and scoped to that ONE name: a
> `PIKAR_OFFLINE_FIXTURES` value that is not `"1"` (`on`, `true`, `""`) now reads as OFF in the
> readiness screen as well as at the seam. Other fixture-tier names are unchanged — any non-blank
> value still reports them active. The manifest row's `whatBreaks` string is the operator-facing
> spec for that.
>
> The two sites still differ on one thing, deliberately: the screen reports the FLAG, while
> `offlineSeamAvailable()` ANDs the flag with "neither model key is set". On a keyed deployment the
> screen reports the flag active while the seam is inert. That asymmetry is pinned by the same
> table.
>
> This entry does NOT discharge the separate bump this playbook owes for Phase 28's `lib/env.ts`
> change.)

> Last verified: 2026-08-28 (**ONE NEW `fixture`-TIER MANIFEST NAME: `PIKAR_OFFLINE_FIXTURES`**,
> added to `ENV_MANIFEST` in `convex/lib/env.ts`. It is the POSITIVE operator opt-in for the
> vault-digest and voice-doc offline fixtures: set to the literal `"1"` ON A KEYLESS deployment,
> folder digests and voice-doc review are FAKED from a local fixture with no model call; ignored
> while either model key is set. It is `fixture` tier for the `FAL_FIXTURE` reason — `missingEnv`
> reports it under `fixturesActive`, so the readiness screen says out loud that a fabrication seam is
> live. **Production must never set it.** It exists because the previous gate was the ABSENCE of both
> model keys, which turned a lost-credentials misconfiguration into silent fabrication; see
> `docs/playbooks/vault.md`'s wave-3 block. NOTHING ELSE in the readiness surface changed, and this
> entry does NOT discharge the separate bump this playbook owes for Phase 28's `lib/env.ts` change.)

> Last verified: 2026-08-26 (**ONE NEW `feature`-TIER MANIFEST NAME: `PEXELS_API_KEY`**, added to
> `ENV_MANIFEST` in `convex/lib/env.ts` for the free stock-footage scenes. The row is mandatory
> rather than documentation — `env.test.ts` scans source for `process.env.X` and reds on any
> consumed name nobody classified, which is exactly how this addition was caught: the gate failed
> with `expected [ 'PEXELS_API_KEY' ] to deeply equal []` before the row existed.
>
> **`feature`, not `required`, and the tier is the whole claim.** Absent, only `stock_video` /
> `stock_image` scenes fail — with a governed code, and with no cent at risk, because a stock line
> reserves $0. Every other part of the media rail, and the whole cockpit, are unaffected. It is a
> Convex deployment env var (`npx convex env set`), never Vercel. Nothing else in this playbook's
> scope was re-read against this change. See docs/playbooks/media.md, "Free stock footage".)

> Last verified: 2026-08-24 (ox-alpha trial — **ONE NEW `required`-TIER MANIFEST NAME:
> `OPENROUTER_API_KEY`.** Added to `ENV_MANIFEST` in `convex/lib/env.ts`. The manifest is
> derived-checked — `env.test.ts` scans source for `process.env.X` and reds when a consumed name is
> classified by nobody — so the row is mandatory, not documentation.
>
> **THE TIER IS `required` DELIBERATELY, AND IT IS CONDITIONAL ON A PIN.** While
> `DEFAULT_MODEL`/`RESEARCH_MODEL` point at `stealth/ox-alpha` (packages/cost/src/cost.ts) this key IS
> the model lane: absent, every agent turn and every eval fails, and the OpenAI fallback absorbs
> nothing because that account is the exhausted one. A readiness screen calling it `feature` would be
> lying to an operator. **It must drop back to `feature` on the same edit that reverts those pins** —
> a `required` row for a key nothing routes to would red a healthy production for no reason.
>
> `GOOGLE_GENERATIVE_AI_API_KEY`'s `whatBreaks` was corrected in the same pass: it is no longer only
> "the Gemini model lane". It now also carries VAULT EMBEDDINGS (`vaultRag.ts` pins
> `gemini-embedding-001`) and BOTH fallback pins. On this deployment it is the single credential
> whose absence would take out ingest, retrieval and every model failover at once.
>
> **PRODUCTION HAS NOT BEEN TOLD ANY OF THIS.** The key is set on the LOCAL dev deployment only, and
> per the standing deploy gate nothing here is a licence to deploy — the pins, the tier, and the
> Stealth-EULA data question (prompts are retained and shared with an ANONYMOUS provider) are all
> open. Eval fixtures are synthetic so the trial is clean; tenant traffic is a separate §4 decision
> that has NOT been taken.)

> Last verified: 2026-08-21 (the promotion gate is `startsWith`, not `contains` — **AND THE FIRST
> VERSION NEARLY DEPLOYED PRODUCTION BY ACCIDENT ON ITS OWN INTRODUCING MERGE.** Read this before
> touching the clause.)
>
> - **What happened.** The gate landed as
>   `contains(...head_commit.message, '[deploy]')`. PR #25 was then merged with the body *"No
>   [deploy]-marker, so production is not promoted by this merge"* — a sentence written to state the
>   marker's ABSENCE, which contains the marker. `contains` is a substring test with no notion of
>   surrounding words, so the gate evaluated TRUE on the merge that created it.
> - **What caught it.** A `grep -c '[deploy]'` run against the actual merge commit on main,
>   expecting `0` and getting `1`, inside the ~4-minute `ci` window before `deploy-production`
>   fires. `gh workflow disable deploy-production.yml` stopped it. **Production was not promoted.**
>   Checking the artifact rather than trusting the intent is the only reason this is a near-miss and
>   not an incident.
> - **The lesson, which generalises past this one clause.** Commit messages discuss deploying
>   constantly — "do not deploy", "revert the deploy", "[deploy] gate added". A substring marker
>   fires on prose that means the OPPOSITE of what it matches, and the more carefully someone writes
>   about not deploying, the likelier they trip it. `startsWith` confines the marker to the head of
>   the subject line, where only a deliberate act puts it; the body may then say "[deploy]" freely.
> - **Do not relax this back to `contains`.** It also closes a residual edge: merge `dcb4183`'s
>   message permanently contains `[deploy]`, so under `contains` a manual re-run of `ci` against
>   that SHA would have promoted production at any point in the future. Under `startsWith` it cannot
>   — that subject begins `Merge pull request #25`.
> - **To deploy:** make the merge commit SUBJECT begin with `[deploy]`, or re-run the
>   `deploy-production` workflow manually against the SHA you want.

> Last verified: 2026-08-21 (26-10 pre-flight — **PRODUCTION HAD NO HUMAN PROMOTION GATE, AND
> THE PIPELINE BELIEVED IT DID.** `deploy-production.yml` now requires `[deploy]` in the merge
> commit message. Verified: `environments/production` returns `protection_rules: []`, and the
> pipeline succeeded unattended twice on 2026-08-21 alone — 2m33s at 14:36 and 2m31s at 13:06.)
>
> - **What was actually true.** The workflow declares `environment: production` and its header says
>   *"configure required reviewers there when an explicit human promotion gate is desired."* Nobody
>   ever configured them, and **an `environment:` block with no rules provisioned does not fail
>   closed — it deploys silently.** So every merge to main promoted BOTH Convex and Vercel to
>   production, unattended, about 2.5 minutes later. The gate was designed, documented, and absent.
> - **Why the recommended fix is unavailable here, measured not assumed.** GitHub environment
>   protection rules need a PAID plan on a PRIVATE repo. This is a private repo on a free personal
>   account. Both rules were attempted on 2026-08-21 via `gh api --method PUT`:
>   `reviewers` → 422 *"ensure the billing plan supports the required reviewers protection rule"*;
>   `wait_timer` → 422, same shape. The environment was left at `protection_rules: []` — the calls
>   set nothing. **Do not re-attempt without checking the plan first.**
> - **The gate that replaced it.** One clause on the deploy job's existing `if:`:
>   `contains(github.event.workflow_run.head_commit.message, '[deploy]')`. Promotion is opt-in per
>   merge; a merge without the marker lands on main, runs the full `ci` gate, and stops. The
>   verified-SHA checkout and the fork-safety conditions are untouched. **It gates its own
>   introduction**: `workflow_run` always runs the workflow file from the default branch HEAD, so
>   the moment this merges, main carries the gated version and evaluates it against that very merge.
> - **This is a weaker gate than an enforced approval and is chosen only because the enforced one is
>   unreachable.** A commit-message convention can be typed by anyone with merge rights and carries
>   no audit trail beyond git. If the plan ever gains environment protection, provision the real
>   reviewer gate and delete the clause. Deleting that one line restores auto-deploy.
> - **To deploy now:** put `[deploy]` in the merge commit message, or re-run the `deploy-production`
>   workflow manually against the desired SHA.

> Last verified: 2026-08-18 (17-08 Task 2 added ONE `feature`-tier manifest name,
> `PHASE17_GRAPH_PROBE` — the Graph concurrency-probe artifact as JSON. **Unset is the normal,
> healthy state**: Microsoft calendar UPDATE simply refuses with `provider_unsupported`, and nothing
> else changes. Setting it does not enable anything by itself either — the deployment and tenant
> hashes inside the artifact must match the ones recomputed at call time, so a probe measured on
> another deployment or against another account binds to nothing. Microsoft calendar DELETE is
> unaffected in every case; it is forbidden outright, not gated (ADR-023). No `required`-tier name
> was added, so the readiness surface is unchanged for a healthy deployment.)
>
> Last verified: 2026-08-17 (25-10 Tasks 1 **and 3** — the environment manifest, the drift scan, the
> owner readiness surface, and durable-origin enforcement. **Task 2's ADR-022 was ACCEPTED by the
> owner on 2026-08-17; Gate 2 is closed.**)
>
> **ADR-022 is the durable-domain posture, and it is numbered 022 because 017 COLLIDES** with the
> Accepted `017-direct-wan-visuals-openai-audio.md`; ADRs are immutable (§9). It also drops the
> plan's "custom" requirement: `*.convex.site` is durable but not custom, and a literal reading
> would have blocked the phase on a hostname property nothing consumes.
>
> **What Task 3 enforces, and the failure it exists for:** `envCheck` now also returns
> `nonDurableOrigins`, and `ready` requires it to be empty. A **set but ephemeral** origin is
> invisible to every other check — the name is present, so `missingRequired` is empty and the
> screen reads green, while the unsubscribe link in an already-sent email points at a preview build
> that stopped resolving on the next push. `ORIGIN_ENV` covers `CONVEX_SITE_URL`, `SITE_URL` and
> both OAuth redirect URIs. An UNSET origin is reported as missing and NOT as non-durable — one
> fault, one message.
>
> **This widened `ready`, and it caught a stale test doing so:** the existing "ready turns on
> REQUIRED only" case stubbed every required name to the literal `"set"`, which is not a URL, so
> `ready` correctly went false. The test's premise had changed and it was updated rather than
> worked around.
> Build history: `.planning/phases/25-private-beta-productionization/` · Related ADRs: ADR-020
> (production opened without an admission gate)

## Purpose

Answer "is this deployment actually configured?" without having to try every feature and see which
one is broken. One manifest of every environment name the Convex deployment reads, tiered by what
its absence costs, surfaced to the owner on `/admin` as **names only**.

## Key files

- `packages/backend/convex/lib/env.ts` — `ENV_MANIFEST`, `missingEnv()`, `isDurableOrigin()`.
- `packages/backend/convex/ops.ts` — `envCheck`, an `ownerQuery`.
- `packages/backend/convex/env.test.ts` — the drift scan and the leak assertions.
- `apps/web/app/(app)/admin/AdminView.tsx` — the `EnvReadiness` section.

## Invariants

1. **Names only ever leave the manifest.** No consumer returns a value, a length, or a prefix. A
   readiness screen that echoed a secret to prove it was set would be a worse leak than the
   misconfiguration it reports. Asserted: a stubbed `UNSUBSCRIBE_SECRET` value appears nowhere in
   the serialized response.
2. **Never throw at module load.** A missing key must surface as an ANSWER, not as a deployment
   that refuses to boot and takes every working feature down with the broken one.
3. **A blank value counts as UNSET.** `convex env set X ""` is the most common way a key looks
   configured and is not.
4. **`ready` turns on REQUIRED names AND durable origins — never on features.** A dark feature is a
   product decision; a missing required name, or an origin that will stop resolving, is a broken
   deployment. Collapsing features in with those makes the screen unactionable.
5. **A SET but EPHEMERAL origin must fail.** This is the one fault no other check can see: the name
   is present, so `missingRequired` is empty and everything reads green, while the unsubscribe link
   in an already-sent email points at a preview build that died on the next push. An UNSET origin
   is reported as missing and NOT as non-durable — one fault, one message.
6. **An ACTIVE fixture seam is reported as a warning.** `FAL_FIXTURE`, `MEDIA_*_FIXTURE` and the
   Graph-probe flag FAKE real providers — a failure that looks like success, which is the worst
   kind to leave undetectable in production.
7. **The manifest is drift-checked in BOTH directions.** `env.test.ts` scans source for
   `process.env.NAME` and fails on a consumed-but-unclassified name AND on a classified-but-dead
   entry. A manifest maintained by remembering to update it goes stale silently, and in the
   direction that matters: a new required key nobody classified reads as "ready".
8. **The scan follows `requireEnvMedia("X")` as well as `process.env.X`** (25.1-06, D12). That
   helper is a `process.env[name]` lookup, so a literal-only scan was blind to every media name it
   reads — `MEDIA_RENDER_URL`, `WAN_API_BASE_URL` and `Video_and_image_API_Key` were unclassified
   for their whole lives. `MEDIA_RENDER_URL` is the sharp one: it is read inside the scheduled
   `renderReel` action, so unset it throws where no user is waiting and the plan sits at
   `rendering` forever while this screen reports ready. **A THIRD indirection would be invisible
   again** — add its regex in the same commit that adds the helper. The test asserts those names
   are NOT reachable as literals, so deleting the extension reds instead of quietly narrowing the
   guard.

## How to verify

| Command | Proves |
| --- | --- |
| `pnpm --filter @pikar/backend exec vitest run convex/env.test.ts` | The manifest matches source, reports names only, and `envCheck` refuses a non-owner, and no origin is ephemeral. 19 tests. |
| Sign in as owner → `/admin` | The readiness section against the REAL deployment env. This is the easy path. |
| `cd packages/backend && npx convex run --prod ops:envCheck --identity '{"subject":"<ownerUserId>\|cli"}'` | The same, from the CLI. **All three parts are required** — see below. |

**Why the obvious CLI form fails, which 25-12's plan specified:** there is no `convex.json` in this
repo, so the CLI resolves the deployment from `packages/backend/.env.local` and must run from that
directory; without `--prod` it targets the local dev deployment rather than the hosted one; and
`convex run` invokes with NO identity, so `requireScope` throws `UNAUTHENTICATED` long before
`requireOwner` is reached.

## Operational notes

- **Sign-in credentials and MAILBOX credentials are different pairs** (ADR-018).
  `AUTH_GOOGLE_ID`/`_SECRET` are Convex Auth's; `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` are the Gmail
  grant's. Setting one and expecting the other to work is the easy mistake.
- **`AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` are `feature`, not `required`**, because `/signup` hides
  the Microsoft button while they are unset (`invites.authProviders`). Absence is honest rather
  than broken. They also need an Azure app registration whose redirect URI is
  `${CONVEX_SITE_URL}/api/auth/callback/microsoft-entra-id`.
- **`UNSUBSCRIBE_SECRET` is the sharpest required name.** Absent, the CAN-SPAM footer cannot be
  built and EVERY send fails closed — by design.
- **`NEXT_PUBLIC_CONVEX_URL` and the Vercel-side names are deliberately NOT in this manifest.**
  They are web-build variables validated by `deploy-production.yml`, which is the right place.
  The dead-entry check caught `NEXT_PUBLIC_CONVEX_URL` being listed here and it was removed.
- **`MEDIA_SANDBOX_SNAPSHOT_ID` is the same class and is deliberately NOT here either** (25.1-06
  re-checked it: the only reader in the repo is `apps/web/app/api/media/render/route.ts`, a Vercel
  variable no Convex process can see). Listing it would make `envCheck` report a name missing on
  every healthy deployment — a readiness screen that cries wolf is worse than one blind spot.
  `deploy-production.yml` already asserts it alongside `NEXT_PUBLIC_CONVEX_URL` and
  `MEDIA_RENDER_SECRET`, and that check is the coverage. **Its absence bites in a different
  place**: unset, the render route returns `not_configured`, which is not in
  `TRANSIENT_RENDER_CODES` and so goes straight to a dead letter — visible on `/ops` (see
  `docs/playbooks/audit-dead-letter.md`), not here.

## Known gaps & deferred work

1. **Task 2 shipped as ADR-022, ACCEPTED by the owner 2026-08-17 — this gap is CLOSED.** The plan's framing is stale and the ADR says why: 25-10 poses
   an A/B decision where Branch B is "no user-shareable URL ships". The 25-00 baseline found that
   decision **already made and shipped**: `docs/decisions/020-production-opened-without-an-admission-gate.md`
   is Accepted and records `https://www.pikar-ai.com` live with the full platform.
   **Branch B is not "decline to ship" — it is "take down a live promoted deployment."** The ADR
   should RATIFY or SUPERSEDE ADR-020, not re-litigate it.
   **Also: the plan's `docs/decisions/017-…` filename COLLIDES** — 017 is
   `017-direct-wan-visuals-openai-audio.md`, Accepted. ADRs are immutable (CLAUDE.md §9), so two
   files numbered 017 is permanent. **The next free number is 022.**
2. **Task 3 IS WIRED** — `ops.envCheck` returns `nonDurableOrigins`, `ready` requires it empty, and
   `/admin` names any offender. **It deliberately does NOT implement the plan's "custom" wording:**
   the Convex HTTP-action origin is `*.convex.site`, fixed by Convex domain configuration and never
   set by this repo, so requiring custom would block the phase on a property nothing consumes.
   Enforcement is scoped to what the repo controls — `SITE_URL` and the two OAuth redirect URIs —
   plus a read-only assertion that `CONVEX_SITE_URL` is a non-empty https origin. **It cannot
   validate DNS, TLS chains, or that a provider's registered redirect actually matches**; those are
   observed at the live gates (25-11/25-12).
3. **This manifest covers the CONVEX deployment only.** The web build's variables are the
   pipeline's business and are not visible to `envCheck`.
