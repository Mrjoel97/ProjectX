---
phase: 48-readiness-and-qualification-closure
plan: "02"
status: approved-conditional-release-failed
completed: false
requirements-completed: []
---

# Staging alternative — approved scope awaiting free preflight

Prepared and conditionally approved 2026-10-20. The user explicitly replied **“Approve staging
alternative.”** The immutable approval hash is
`50cd91ae6e081d6b911ab52ecce7a4966faac95f54d4c3bddbd21277beb63a19`; its private scope
receipt is dated2026-10-20. This conditional scope remains separate from the later release
approval. **The separately approved staging apply completed, but final release acceptance failed;
parity-zero is false and final billing-label readback was not reached. No new accounts or probe exist.**

This is the approved conditional replacement scope for the unavailable controlled-account credentials,
not a continuation receipt or an assertion that Phase23/48-02 passed. The original production
accounts, historical once-lock identity, recovered closed/expired unused budget and zero-use
probe remain untouched. No new production probe was created. The old scope remains unused;
it does not authorize new staging accounts, fixture writes, a staging owner grant or spending.

## Target and observed prerequisites

The parent operator's exact-deployment read-only CLI observation identifies staging deployment
`woozy-wren-368`, backend `https://woozy-wren-368.convex.cloud`, and configured
`SITE_URL=https://pikar-ai-staging-joelferuzi.vercel.app`. It reports
`authEmailConfigured=true`, `openRouterConfigured=true`, and foundation onboarding enabled.
These are configuration-presence observations, not proof of successful mail delivery, provider
billing, current deployed-source parity, or authenticated A/B readiness.

The user subsequently attested **Standard OpenRouter; free Tavily** for staging. This factual
attestation is preserved in a separate private immutable `billing-attestation.json`; it does not
change the approval hash above and is not a configuration-write or paid-execution receipt.
The pre-release observation returned null billing labels. The later separately approved release
may have changed them, but its final readback was not reached. **Paid readiness remains blocked
until supported exact staging configuration and source parity are verified.** The conditional
scope itself did not authorize configuration writes; the separate limited release approval and
its failed acceptance are recorded below. Unknown pricing or usage stops work; no guessed cost
or automatic retry.

Use an explicitly selected `woozy-wren-368` deployment for every proposed administrative call.
Do not use `--prod`, infer the target from an unset/default dev configuration, or treat a
localhost web origin as proof of its backend. The existing authoring harness's nonproduction
branch uses configured dev selection; independently prove that it resolves to this exact target
before any mutation. If that cannot be established, stop and repair/qualify target selection
before executing this proposal. No deployment or code push is included here.

Current CLI inspection shows that even `CONVEX_DEPLOYMENT=dev:...` can leave a deploy command
selecting production by default. That variable alone is therefore insufficient evidence.
The strict staging-key CI dry-run/parity operator completed a successful **no-apply** inspection.
No deploy, push, registry repair or configuration change is authorized by the staging approval;
preparation must fail closed before egress if exact staging selection cannot be proved.

## Latest readiness observation and separate release boundary

PR74 source `d40a7f08a2da2b8730d5df2cc8437ce2e9b9c190` passed CI `39407950620`
and merged as `bc43f80531c060faab9f86e7015ff4514fd57170` without production promotion.
Second staging inspection `39409301452`/job`118582833599` passed, preserving configuration,
registry and the protected retention fixture. The result is `diffStatus=changes`,
`changedItemCount=1`, `parityEstablished=false`; see `48-STAGING-PREFLIGHT-2026-10-20.json`.
Five global registry references/hashes are snapshot observations only, not semantic proof.
Intermittent local Windows UV failures did not justify mutation or replacing the CI evidence.

The subsequent PR75 source `50289ed15db4e20547b5a5e5b9ff5cd8fb80bb71` passed full CI
`39412119620` and squash-merged as `9e2ba0551736cab603c35e59a0d5202a1af28aed` without
production promotion. Third read-only run`39412743386`/job`118594268238` passed with the same
preservation guarantees and changes=1/parity=false. Its exact sanitized result is preserved
separately as `48-STAGING-PREFLIGHT-RUN3-2026-10-20.json`; the prior run2 receipt is unchanged.
All five selected globals have exactly one active row; four match current source. The
`cockpit-agent v1` hash `b765d7422d5e0d5d0d6beaa58b1310fbba02ced028a613cdc38aef01c3fec7e7`
is the documented Phase20-20 owner-ratified cloud-dev predecessor in the skill-registry and
agent-runtime playbooks. Treat its variance as diagnostic provenance, not a registry repair
instruction or current46-case semantic certification.

The narrow new-profile qualification marker now prevents ordinary weekly-review spending at
both enumeration and already queued execution. Legacy ordinary profiles are unchanged and
there is no backfill. Its46focused backend tests/typecheck and existing evaluator identity
checks pass; golden/vertical cases are unchanged. This is source preparation, not deployment.

A separate manual release workflow/operator was prepared with exact-source successful CI
and a fresh release-authorization hash. Its only scoped
configuration writes are the3attested labels `GOLDEN_OPENROUTER_BILLING=standard`,
`GOLDEN_TAVILY_BILLING=free`, `GOLDEN_TAVILY_CREDIT_USD=0`; protected hashes must survive
and post-release source diff must be zero. Unknown outcomes stop without automatic apply retry
or rollback. Its51operator tests and exact PR75 full CI pass, and the fresh read-only comparison
above is recorded. The user then explicitly approved that source and only those3labels, with
separate release hash`a1772ce8b78d8d34e4a88fb54d6e5c7fd41e84d2f355adcd927c848d0bb18f47`.
The approval hash at the top remains the conditional account/fixture/$1scope.

Actual release run`39416580614`/job`118606976651` completed apply but returned `success=false`
at`postflight_preservation`. All3protected before/after hashes match and the read-only postflight
ran successfully; `postflightParityZero=false` still prevents release acceptance. Final billing
verification was not reached. Its false verification flag does not establish incorrect labels,
and the sanitized result provides no remaining change count or cause. See the separate exact
`48-STAGING-RELEASE-2026-10-20.json` observation. Keep this attempt closed failed pending
separate read-only diagnosis, with no automatic apply retry, rollback or weakened gate. No
accounts, owner grant, probe or model work occurred. Phase48 remains partial and Phase49 has
not started.

Before any later authoring, preserve the actual five-global baseline using separate pre/post
redaction-safe supplemental receipts. The fixed Phase23 handoff binds only offer-architect;
do not change its shape or claim it pins all five globals. These snapshots do not establish
actual loaded-body attribution: ordinary unpinned native turns do not emit the explicit-pin
load witness. No baseline supplement, historical evidence or source comparison alone grants
semantic qualification, activation or a current46-case pass.

## Approved narrow authorization

The explicit approval covers the following together, on staging only and only after their
prerequisites pass. It does not waive any free gate below:

1. Create two new disposable, unique plus-address aliases of the already connected Gmail
   account, labeled A and B only in Git. Use normal Pikar password signup and real verification
   for each. Do not reset, reuse, delete or change any existing account. If invitations are
   required, use only `invites:__seedInvite({email})` for these two exact private aliases.
   Check uniqueness before creating either account; a collision stops creation rather than
   adopting an old identity.
2. Generate independent strong passwords and keep the credential bundle encrypted locally
   with Windows CurrentUser DPAPI in an ignored/private location. Never print passwords,
   commit aliases or passwords, send passwords through chat, or create plaintext credential
   files. Record exact resulting user IDs privately and verify them through the existing
   unique `owner:findUserIdByEmail({email})` read. No browser token decoding, extraction,
   auth-state replay or identity impersonation is permitted.
3. Read only the new Pikar email verification messages addressed to those exact aliases and
   sent during this setup, solely to complete the two native verification forms. This is not
   permission to browse unrelated Gmail content, send messages, change mailbox state, or
   use account password-reset flows. Stop if real verification does not complete.
4. For each exact new verified user ID, invoke the existing staging-only operator fixture
   `onboarding:__seedOnboardedTenant({tenantId})` once after confirming the tenant is new and
   empty. This creates synthetic business facts and a ready business-profile document without
   model calls, embeddings, indexing or graph extraction. Its existing internal mutation has
   no staging guard; exact target and new-ID checks are mandatory before each invocation.
   Do not patch the database directly or extend this exception to other tenants.
5. Establish fresh native A/B sessions and observe both exact IDs with owner=false before
   the grant. Then invoke `owner:bootstrapOwner({userId: A})` exactly once for this new
   staging A, observe A owner=true and B owner=false, and retain the witnesses. Never grant B,
   bootstrap an existing production owner, or rerun a grant after an ambiguous result.
6. After every free gate below passes, register one new staging authoring probe with
   `authoringProbe:prepare({userId: A, capCents: 100, authorizationSha256})`, using the new
   concrete approval's hash. Permit at most two ordinary native Executive submissions on
   that returned exact thread: one inert `offer-architect` candidate adaptation request,
   then one escalation/refusal request. Maximum aggregate spend is **100 cents ($1)** across
   supported descendants, not $1 per turn. Two submissions may involve multiple provider
   calls. Apply the native expiry and supported-call ceilings; unknown-cost holds remain held.

**The user expressly approved the fixture exception as part of this replacement scope.**
It changes the original qualification preparation. The seeded profile is browsable but not
retrievable: it has no RAG entry.
This permits native signup/authentication plus fixture-backed skill-authoring qualification, **not
proof of real onboarding, business-profile grounding, foundation publication or ingestion**.
Do not submit a foundation interview answer, use voice onboarding, upload a document, call
`foundation.publish`, or run `onboarding.commitProfile` under this $1 proposal. Those routes
can trigger separate ordinary paid work outside the authoring envelope.

The scope excludes full/partial candidate evaluation, owner activation, rollback exercises,
routine scheduling, provider connections, external posting/sending, production changes and
any other paid test. Each later step retains its own concrete checkpoint.

## Free preflight and preservation gates

Before provisioning, pin the exact current source commit, successful CI run and staged backend
revision. Run the current dry-run/discovery and offline gates from23-06 and the execution
preparation, including artifact/operator checks, native auth/control tests, source/candidate
inspector self-checks and golden no-model checks. Record actual commands/results; previous CI
or an old source hash is not a current pass. Graphify is unavailable in this checkout; use the
recorded focused source fallback rather than claim graph validation.

Before authoring, also require:

- Exact app/backend/config parity: deployed public/internal APIs and containment code match
  the pinned source. Local native origins, if used, point to that exact staging backend. Use
  the existing closed legacy authRefs or native-origin witness shape truthfully; do not invent
  storage exports. The native-origin branch uses exactly `http://127.0.0.1:3111` for A and
  `http://localhost:3111` for B. Start empty native sessions and independently verify IDs/roles.
- The active skill registry and exact baseline rows qualify on staging, including the
  authoring, extraction/evaluation/governing skill pins consumed by the current inspector.
  Record IDs, versions and hashes, not sensitive bodies. Missing/drifted registry rows stop
  the attempt. Seeding/promoting registry rows or changing source is not implicit permission;
  any necessary repair is prepared and reviewed separately, then the free gates repeat.
- The fixture exception is expressly approved, the two synthetic tenant profiles are distinct
  and stable, no pre-existing tenant data was overwritten, and current native profile/owner
  reads agree. Auth-only readiness performs no owner grant, probe creation or model call;
  perform the grant only in the separately approved fresh-owner sequence above.
- Review staging retention/deletion schedules and fixture admission rules for the exact new
  identities, thread, candidate and downstream evidence. Ensure they can remain stable through
  the original23-06 →23-07 →23-08 →23-09 chain without broadening or silently disabling
  retention. If the existing schedule cannot preserve them long enough, stop and obtain a
  separately scoped preservation decision before paid work. A partial test is not permission
  to erase evidence or reset once-locks.
- Truthful supported OpenRouter/Tavily billing configuration is established and its free
  preflight passes. Confirm zero existing staging candidates/probes for this new pair and
  no unresolved spend. New approval/once-lock/thread/budget identities must be distinct from
  historical production controls. Never reopen the old budget or reuse its authorization.

Prepare a redaction-safe scope receipt containing target/source/CI/config/registry hashes,
new A/B IDs, fixture provenance, fresh role witnesses, new authorization hash and allowed
turns/cap. Keep aliases, passwords, verification codes and raw private outputs out of Git.
Do not run the new paid spec merely to discover a missing gate.

## Stop conditions, evidence and later decisions

Stop on wrong deployment/source, ambiguous identity, delivery/verification failure, missing
profile, unexpected owner state, registry drift, failed free gates, unsupported provider mode,
expired/closed envelope, unresolved usage, containment or any uncertain mutation result.
Preserve the actual state and produce a partial receipt; never repeat a signup, owner grant,
probe registration or paid submission automatically to make evidence look complete.

After the two turns, inspect actual probe/ledger/candidate state and close only through the
existing native terminal controls when allowed and no unresolved hold remains. A successful
authoring result may create only its truthful immutable handoff and associated budget receipt.
It cannot create evaluation, activation or rollback evidence. Preserve the same exact new
staging pair, candidate, source/deployment pins and artifact hash chain for any later approved
steps. Production's original controlled identities and candidate baseline are not substituted.

**Staging evidence cannot certify the old production identities or production deployment.**
Decide explicitly how staging acceptance contributes to48-02; leave production-specific
acceptance open unless independently fulfilled. Phase23/48-02 remain partial and Phase49
is not unlocked by this proposal.

Retain the new encrypted credential bundle and disposable fixtures through the exact chain.
Afterward prepare a separate native cleanup scope listing only the new A/B accounts, fixture
documents, candidate/probe references and owner-role disposition. No cleanup, deletion,
credential destruction, broad tenant erasure or role revocation is authorized here. Preserve
required immutable audit/evidence and unknown-cost holds; do not promise cleanup before its
effects and supported native operations are reviewed.

## Source anchors

- `packages/backend/convex/auth.ts` and `lib/authEmail.ts`: native password verification and mail admission.
- `packages/backend/convex/invites.ts`: exact-email internal invite fixture.
- `packages/backend/convex/onboarding.ts`: `status`, paid intake and explicit `__seedOnboardedTenant` limitations.
- `packages/backend/convex/tenantProfile.ts`: tenant-profile read and derived business facts.
- `packages/backend/convex/owner.ts`: unique identity lookup and audited bootstrap.
- `packages/backend/convex/authoringProbe.ts` and `guardrails.ts`: new thread/envelope, turns, admission and closure.
- `apps/web/e2e/agent-skill-authoring.spec.ts`, `phase23NativeAuth.ts` and `phase23OwnerContinuation.ts`: fresh native identity and bounded authoring controls; do not enable existing-owner mode for the new pair.
- `../23-agent-authored-skills/23-EXECUTION-PREPARATION.md`, plans06–09 and their validators: original staged acceptance and immutable chain.
- `48-02-SUMMARY.md` and `48-RECOVERY-2026-10-19.json`: preserved production recovery and partial disposition.
