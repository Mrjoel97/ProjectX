---
phase: 48-readiness-and-qualification-closure
plan: "02"
status: partial
completed: false
requirements-completed: []
---

# 48-02 — Read-only recovery and native refusal preparation

The user restored the signed-in Convex dashboard session on 2026-10-19. Existing internal **queries only** inspected production `opulent-octopus-494`; no custom query, mutation, impersonation, model call, role change or production deployment was used. The redaction-safe observation is `48-RECOVERY-2026-10-19.json`; original rendered outputs stay in the private local evidence directory outside Git. This observation is not one of the three certified Phase23 artifacts and does not independently identify deployed source revision.

## Actual recovery

- A is already owner; B is non-owner. The old fresh-non-owner/bootstrap sequence cannot be rerun unchanged.
- A's ledger returned four rows below the500-row cap for August1 through October20 UTC: one historical authoring envelope and its closure, plus a separate ordinary embedding reservation/actual pair. The separate embedding actual is not a probe turn. This is a bounded window, not a whole-lifetime financial assertion.
- Exact historical budget `ps76dmw7zp8rngqbdbcddw6f558edfxc` is closed and expired, with zero calls, spend, unsettled calls or unresolved cents. It cannot fund new work.
- Its exact source thread `m57929vc8gh530905dxbs799hd8ecmv4` has zero candidates and authoring tool calls. A has zero tenant-skill rows and active tenant skills. Probe control has zero started, finished, failed or containment turns. Repeated source/probe/budget reads agree.
- These live observations do **not** substantiate the earlier STATE description that initial authoring/refusal turns completed. Preserve that description as historical; current recovery controls the continuation. No candidate or handoff can be reconstructed from it.
- The documented once-lock identity is preserved. Its exact file and the original private auth/attempt receipts are unavailable in this checkout. No lock was reset or removed, and absence is not proof that every historical action was absent.

## Free preparation

The native public-refusal route is disabled outside development and requires explicit server-only candidate/B pins. A dedicated native B session performs one real public mutation call; only literal `OWNER_REQUIRED` qualifies. Offline tests cover loading/identity/owner guards, exact error matching, one-shot execution, invalidation and production404. This is preparation for23-07, **not an observed live refusal**. The helper must run on a freshly authenticated local development origin bound to the exact intended backend; production cookies cannot be copied. Client readiness cannot prevent a concurrent server-side role change, so independent before/after witnesses and an unchanged dedicated B session remain mandatory.

Independent agents reviewed the seam and identified no implementation blocker. Current-suite golden offline checks validate57 fixtures across12gated skills; the actual agent corpus remains46 cases. Operator tests, the1,338-probe artifact validator and six probe-control checks passed before continuation edits; rerun affected checks after those edits.

## Validated continuation

The explicit existing-owner mode reads the old exact source/probe/budget, requires terminal zero-use
state, verifies A owner/B non-owner through fresh native authentication and never calls bootstrap.
A new authorization must differ from the old one; server-side duplicate-authorization protection
prevents another envelope with that same new authorization. The old lock remains untouched.
The handoff validator accepts exactly one owner witness (legacy non-owner-before-bootstrap or
truthful existing-owner-at-start), rejects both/neither/false and preserves historical artifact
bytes plus downstream hash binding. Actual owner decisions and the real B public refusal are not
replaced. An independent source review found no remaining concrete blocker in these changes.

Auth-only qualification supports the same existing-owner identity witness without any budget,
probe or owner-grant path. It requires fresh native sessions and no new spending hash. Focused
checks pass26continuation,7native-auth and24access-route tests; broader web checks pass1,151tests
with the two existing deferred-recurrence skips. All12package typechecks pass;22offline free gates
and the subsequently expanded7probe-control checks pass. Planning regression, artifact1,338-probe
validation and operator checks pass. The production web build passes, including the disabled
qualification route. Repository-wide serial tests pass all11test tasks, including4,602backend
tests and the1,151web tests (two existing defer skips). Changed-file Biome, planning consistency,
watched-playbook coverage and whitespace checks pass. Graphify is unavailable; the shared
Convex-edge fixup completed without graph changes. No paid/live acceptance follows from these
checks. The auth-only receipt directory is now created before sign-in, preventing a successful
login from failing at receipt persistence in a checkout without ignored output folders.

The signed-in dashboard session does not authenticate the local developer CLI. An exact-deployment
read-only query was attempted without codegen/push; it returned `MissingAccessToken`. No new CLI
credential was created or requested from the browser. Local app/backend configuration and fresh
controlled-account sign-in therefore remain live execution prerequisites, not silently passing
readiness. Existing dashboard access remains usable for bounded read-only inspection.

## Remaining checkpoint

### October20 native-session preparation

The user approved the fresh developer-login/$1scope; official CLI device login succeeded. Exact
production read-only queries now work, and duplicate recovery observations still agree on zero
historical use. PR71 passed exact-head CI and merged without deployment. Original encrypted
test credentials remain unavailable. The observed app sign-in ended on production, while the
local controlled origin still displayed Sign In; it cannot be counted as local authentication.
Source inspection confirms Google resolves relative redirects against production SITE_URL, while
the existing password form remains local. No redirect configuration or account role was changed.

Prepared a read-only, explicitly enabled development identity view and a recursively closed
native-origin handoff alternative. Independent review and13identity/24public-refusal tests,
1,338legacy artifact probes plus native-origin cases,2operator tests and web TypeScript pass.
Each real A/B session must show its exact native ID/role at its actual fixed origin; labels and
prefilled addresses alone cannot pass. Missing profiles remain a blocker. No fabricated export
or native witness is written. The new local view performs no mutation and production remains404.
The user confirmed the controlled password is unavailable. The old account remains untouched;
no password reset, new envelope/model/candidate or repeat login is attempted. The concrete
`48-STAGING-ALTERNATIVE.md` proposal was initially prepared pending a separate decision before
new accounts, fixture writes or an A-only owner grant. Staging billing labels are absent and source parity is unproven;
configuration presence is not paid readiness. Its explicit fixture exception does not prove real
onboarding and staging evidence cannot certify the old production identities.

The read-only identity view distinguishes exact A/non-owner (`A_NON_OWNER_MATCH`) before a
separately approved fresh grant from A/owner (`A_IDENTITY_MATCH`) required for paid readiness.
Only exact B/non-owner produces `B_IDENTITY_MATCH`; B/owner and absent profiles remain NOT_READY.

### October20 conditional staging approval

PR72 exact head `a2f07b31ba35ed3a462f95e91427f8a5e53e0e7a` passed full CI run
`39402077280` and merged as `f6330e70772b984c3fc4bf5e4158ee21b72c4a6d` without
production promotion. This qualifies the free native identity/evidence changes, not a live test.

The user's explicit reply “Approve staging alternative” approves only the replacement staging
scope in `48-STAGING-ALTERNATIVE.md`. The private scope receipt is dated2026-10-20; immutable
approval hash: `50cd91ae6e081d6b911ab52ecce7a4966faac95f54d4c3bddbd21277beb63a19`.
It covers two new native-verified private Gmail aliases, Pikar-OTP-only inbox reads, locally
DPAPI-encrypted generated credentials, the expressly approved synthetic-profile fixture
exception, an A-only staging owner grant after fresh A/B non-owner witnesses, and at most
100cents aggregate across two authoring turns after all free admission gates pass. It does not
authorize deploy/apply, registry repair, evaluation, activation, cleanup or production changes.
No new accounts, owner grant, envelope, model call or probe have started under this approval.
The original production $1 scope remains unused and its recovered controls remain untouched.

Exact staging CLI observations identify `woozy-wren-368`, configured staging SITE_URL, email
and OpenRouter configuration presence, and enabled foundation onboarding. The user subsequently
attested “Standard OpenRouter; free Tavily.” A separate private immutable
`billing-attestation.json` preserves that factual answer without changing the approval hash.
No configuration write or model call followed. Billing labels remain null: the supported exact
staging configuration must still be recorded through a separately approved write; the current
no-apply scope does not authorize it. Configuration presence does not establish paid readiness.
Source parity is unproven.
CLI inspection also shows that even a dev-labeled CONVEX_DEPLOYMENT can default a deploy command
to production. A strict staging-key CI dry-run/parity operator is being prepared without apply;
no account or paid work may rely on the ambiguous default. These remain execution blockers.
Real onboarding/grounding are not certified by the fixture exception, and staging evidence
cannot certify the old production identities. Phase23/48-02 remain partial; Phase49 stays blocked.

### October20 first staging read-only workflow

PR73 source `37f58ab42b7b9e64346d2db815b338ad106ec348` passed green CI run
`39405761515` and merged as `d68824b58f50dabf37e74da5e63e92a71777dc47` without
production promotion. The first staging read-only workflow `39406448185`, job
`118573430518`, failed after4seconds without a source-diff result. Its sanitized failure
message did not identify the exact stop stage, so that stage is not independently established.
There was no apply, model call, new account or probe. This is a failed readiness observation,
not source-parity evidence and not a reason to bypass the failed gate.

The parent's exact-stage read-only CLI check confirmed that built-in `CONVEX_SITE_URL` is
absent from the stored environment-variable list, while runtime site/cloud URLs and configured
`SITE_URL` are correct. This confirms a blocker in the checker, not the exclusive cause of
the unlabelled failure. A focused repair verifies the appropriate native
sources; no parity pass is claimed. Standard OpenRouter/free Tavily remain factually attested,
but their staging billing labels have not been written. The conditional staging approval hash
and exclusions above remain unchanged. Production's original $1 scope is unused, and
Phase23/48-02 remain partial with Phase49 blocked.

### October20 successful read-only staging inspection and release preparation

PR74 source `d40a7f08a2da2b8730d5df2cc8437ce2e9b9c190` passed green CI run
`39407950620` and merged as `bc43f80531c060faab9f86e7015ff4514fd57170` without
production promotion. Second staging workflow `39409301452`, job`118582833599`, completed
successfully. Its exact-target read-only comparison preserved configuration, registry and the
protected retention fixture. It returned `diffStatus: changes`, `changedItemCount: 1`, and
`parityEstablished: false`. This is successful inspection with an outstanding deployment difference,
not a parity pass or deployment receipt. The redaction-safe observation is
`48-STAGING-PREFLIGHT-2026-10-20.json`; it is not a certified Phase23 lifecycle artifact.

Local exact-stage CLI registry reads also encountered intermittent Windows UV crashes.
The prepared CI operator will report five global registry references/hashes without raw bodies. Those snapshots
do not certify skill semantics or replace exact candidate/evaluation/activation evidence.

A narrow qualification-fixture marker is now implemented on new tenant profiles: both weekly
enumeration and already queued review execution skip marked fixtures. Existing ordinary
profiles remain unchanged; no backfill was performed. The36onboarding and10proactive-review
tests and backend typecheck pass. Golden and vertical identities were refreshed using their
existing closed inventories; the46golden and40vertical cases/hashes remain unchanged and their
offline checks pass. These source changes are not yet a staging deployment or new accounts.

The separate manual-only staging release workflow/operator is prepared, **not authorized or
dispatched**. It binds an exact approved source, successful CI and a fresh release-authorization
hash, admits only the strict staging selector, and limits billing writes to the3attested labels
`GOLDEN_OPENROUTER_BILLING=standard`, `GOLDEN_TAVILY_BILLING=free`, and
`GOLDEN_TAVILY_CREDIT_USD=0`. It preserves protected snapshot hashes and requires a zero-change
post-release diff; unknown results stop without automatic apply retry or rollback. The51combined
operator tests pass. Full CI for the new combined release/fixture branch remains pending;
fresh exact-source read-only comparison and the user's explicit release approval are still
required. The existing no-apply staging approval does not authorize this release.

No apply, configuration-label write, account creation, owner grant, probe or model call occurred.
The conditional scope approval hash remains
`50cd91ae6e081d6b911ab52ecce7a4966faac95f54d4c3bddbd21277beb63a19`; the original
production $1scope is unused. Phase21 stays accepted, Phase23/48-02 remain partial, and
Phase49 has not started.

### October20 PR75 exact-source read-only comparison

PR75 source `50289ed15db4e20547b5a5e5b9ff5cd8fb80bb71` passed full CI run
`39412119620` and squash-merged as `9e2ba0551736cab603c35e59a0d5202a1af28aed`, without
production promotion. Third read-only staging run`39412743386`, job`118594268238`, passed
and preserved configuration, registry and the protected retention fixture. It returned
`diffStatus=changes`, `changedItemCount=1`, `parityEstablished=false`; no deployment parity
or apply is claimed. `48-STAGING-PREFLIGHT-RUN3-2026-10-20.json` is a byte-identical copy of
the sanitized actual operator result, SHA256
`cb56c2837973cae012ac15e65829bb122481e54274966effd77c4c6f0e8e6dea`. It supplements,
and does not replace, the preserved run2 observation. Neither is a Phase23 certified artifact.

The actual run3 registry observation has exactly one active row for each of five selected
global skills. Four active body hashes match current source. `cockpit-agent v1` has hash
`b765d7422d5e0d5d0d6beaa58b1310fbba02ced028a613cdc38aef01c3fec7e7`; this is the
already owner-ratified Phase20-20 cloud-dev predecessor documented in
`docs/playbooks/skill-registry.md` and `docs/playbooks/agent-runtime.md`. The source variance
is a diagnostic with established provenance, not authorization to seed/promote/repair registry
state. Its historical evidence does not establish a current46-case semantic pass.

Preserve the actual global baseline through separate redaction-safe pre/post snapshot receipts;
the fixed Phase23 handoff pins only the offer-architect baseline and must not be extended or
made to imply all five globals were bound. An ordinary unpinned native turn does not emit the
explicit-pin-load witness; baseline snapshots alone cannot prove which body actually loaded.
Keep this attribution limit explicit in any later acceptance disposition.

At the read-only comparison, the separate exact-PR75 staging release checkpoint was pending: only the approved source plus
the3attested billing labels are proposed. The earlier conditional account/fixture/$1approval
hash is unchanged and does not authorize this release. No apply, label write, new account,
owner grant, probe or model call occurred. Source parity remains false, production's original
$1scope remains unused, Phase21 stays accepted, and Phase23/48-02 remain partial with Phase49
not started.

### October20 separately approved staging apply and failed final acceptance

The user subsequently approved only the exact PR75 staging release and3attested billing
labels. This separate approval hash is
`a1772ce8b78d8d34e4a88fb54d6e5c7fd41e84d2f355adcd927c848d0bb18f47`; the earlier
conditional account/fixture/$1scope hash is unchanged. Source remains
`50289ed15db4e20547b5a5e5b9ff5cd8fb80bb71`, qualified by CI`39412119620`.

Release run`39416580614`, job`118606976651`, returned `success=false` at
`postflight_preservation` after `applyAttempted=true` and `applyCompleted=true`.
`postflightPassed=true` means the read-only postflight ran, not that release acceptance passed.
`preservationVerified=true` and all3before/after hashes match. `postflightParityZero=false`;
the result does not expose a remaining change count or cause. Final billing-label verification
was not reached, so `billingLabelsVerified=false` means unverified, not proof the labels are
wrong; `billingLabelsMayHaveChanged=true` remains explicit.

The exact sanitized result is preserved separately as `48-STAGING-RELEASE-2026-10-20.json`,
byte-identical SHA256`c5f7f35f5aa102aab813bae64ae2682c325014194671ba2bea5f1aeeb3b10b89`.
Earlier read-only observations remain unchanged. The release attempt is closed failed pending
separate read-only difference-category and billing readback diagnosis. No automatic apply retry,
rollback, gate weakening or app-code change follows. No new accounts, owner grant, probe or
model call occurred. No overall release/parity, current46-case semantic pass or actual loaded-body
witness is claimed. Production's original $1scope is unused; Phase21 remains accepted,
Phase23/48-02 remain partial and Phase49 has not started.

### October20 read-only post-release diagnostic and independent billing readback

PR76 source`adda7a4c4ae6d1fe5790654ee3a7e0e13e93dfed` passed CI`39418008690` and
squash-merged as`40598640e13a9b2669b5c11f820f7c538070c471`. Read-only workflow
`39418700527`, job`118613983360`, passed without apply. The exact sanitized result is preserved
separately in `48-STAGING-DIAGNOSTIC-2026-10-20.json`, byte-identical SHA256
`7f88e071e628f4a2bce5cfcbdee83b092809acd563ef40e055c4ec43671d9421`.

Configuration, registry and protected retention hashes are unchanged. The diagnostic reports
`structuredChangedItemCount=0`, but its then-current raw classifier still reports changes=1
and parity=false, classifying a block as `node_version` with zero added/removed versions.
The parent's focused source diagnosis identifies that block as a CLI Node-version advisory
heading, not an application configuration delta. The narrow checker correction is awaiting
its own CI and fresh read-only proof; this diagnostic does not itself establish zero parity.

Both this workflow and the independent exact-stage local readback confirm billing declarations
`standard`, `free`, and`0`. The independent receipt, observed at`2026-10-20T11:54:13.040Z`,
is `48-STAGING-BILLING-READBACK-2026-10-20.json`, byte-identical SHA256
`42a20271a6099c13f0bc618674e8fdc077f41a2ecebbf43ffd2cba6ce36d4382`;
all3matches are true and mutationRequested=false. This resolves the billing-readback uncertainty
through new evidence, without rewriting the earlier release result's unverified flag.

The original apply/final-acceptance failure and every prior observation remain preserved.
No automatic retry, rollback, gate weakening, new accounts, owner grant, probe or model call
occurred. Registry provenance and prompt-load attribution limits remain unchanged. No overall
release/parity or current-suite semantic pass is claimed. Phase23/48-02 stay partial, Phase21
remains accepted and Phase49 has not started.

### October20 corrected parity, native pair and bounded authoring observation

Final corrected read-only run`39420426683`, job`118619711072`, used source
`f382c7316b63e118e7080c49681e61853d9712d3` and successful CI`39419822599`. It returned
zero structured changes and parity=true after recognizing only the exact empty Node advisory.
Configuration/registry/protected-retention hashes and standard/free/0 billing remain verified.
`48-STAGING-PREFLIGHT-FINAL-2026-10-20.json` preserves its exact sanitized bytes, SHA256
`12c96727cd556b2555111ee4ddf32a6cea5f44386caa45cd5127b005e7ae6eca`. This later read-only
proof does not overwrite the historical failed release or imply another apply.

Both new native password accounts are verified. A is`pn70yzs016xgrvzd6bqkaedj098gmytz`;
B is`pn72x2hv0nct3mzdkcjtn6rrex8gn92j`. Initial profile receipts show exactly one synthetic
`onboarding-harness-v1` profile and ready business-profile document each, no RAG entry and no
rows in the six checked connector/plan/request/spend/skill tables. Setup requested zero model
calls and does not certify real onboarding/grounding. Native A_NON_OWNER_MATCH/B_IDENTITY_MATCH
preceded the one-time A grant; actual grant result changed=true and post-reads show A owner,
B non-owner. `48-STAGING-NATIVE-PAIR-2026-10-20.json` binds these refs and private-source hashes.

The approved two-turn probe ran on thread`m57egf5rjkbqhbyzdknjhmvybn8gnh4r`, envelope
`p571bfke7xwxw9hsmxcpbw0khs8gn1jk`. One agent-authored offer-architect v2 candidate was created:
`qn73f3q6zcs1fsjpm9x2vwykc58gm09j`, body hash
`4ec9235c1d0ccce418e54e2adcc2393aa2e778fb8d0968047053f6e5473c12e0`.
It remains candidate-only, with absent evaluation evidence/owner approval and rollbackEligible=false.
The second escalation/refusal turn did not create another candidate or change activation/grants.
Native B excludes the candidate; A's review control was disabled and keyboard-observed.

Actual closed budget: two started/two finished turns, zero failed/containment refusals,
three settled provider calls, total`$0.00322965`, zero unsettled calls/unresolved cents or breach,
closed=true under the100cent cap. `48-STAGING-AUTHORING-PROBE-2026-10-20.json` binds exact
candidate/source/budget refs and all named turn/closure/global-baseline receipt hashes. Registry
and protected retention match their actual pre/post hashes. This is an observation, not a
certified Phase23 artifact; counters alone do not establish policy acceptance or actual loaded body.

The initial CUA requested1440/390viewports left the top window at1280. Those requested-label
witnesses are excluded from responsive acceptance; originals remain preserved and private
viewport-attempt-invalidation.json explicitly names their actual replacements. Subsequent actual-desktop-review-witness.json and
actual-mobile-review-witness.json use a local read-only port3112 harness with the real signed-in
`http://127.0.0.1:3111/ops` app in fixed-size iframes. Frame DOM measured1440x900 and390x900;
keyboard Enter review open/close, the exact candidate, executive provenance and disabled
pre-evaluation activation were observed at both sizes; compact navigation was observed at390.
`48-STAGING-RESPONSIVE-2026-10-20.json` binds only these two actual witness hashes.
This completes free desktop-browser responsive layout proof, not actual mobile-device/touch
testing. The historical probe observation's earlier responsive=false flag remains unchanged.
Root subsequently completed full CI and wrote/validated the immutable23-LIVE-HANDOFF;23-06
completion is recorded below. This documentation pass never overwrites handoff bytes. Exact-row paid evaluation, actual owner
activation/rollback and23-09 closure remain separate checkpoints. Production's original $1scope
is unused; SKILL-02/Phase23/48-02 remain open and Phase49 has not started.

### October20 plan23-06 complete; next exact-row evaluation checkpoint

Full exact-source CI`39430449721`, job`118653817153`, passed Typecheck/Lint/Free gates/Test/
Operator controls/Planning/Build for`79c07bd595500a7043719ecd4bfc34123095cb93`.
Root then wrote the immutable`../23-agent-authored-skills/23-LIVE-HANDOFF.json` once through
the existing writer and private-needle validator. Exact bytes SHA256:
`112ce2643ae15d4b2c39961b09506223bf0d6fe9978993dfe9536cee2dcbdc45`.
It freezes the actual parked candidate/native origins/IDs, suite/source/lineage, rollback and
effective/global/foreign/refusal state. The separate actual closed-budget observation remains
`48-STAGING-AUTHORING-PROBE-2026-10-20.json`, whose hashes bind private`probe-closed.json`;
no fictional Playwright budget attachment or auth-state export is created.

`48-STAGING-23-06-COMPLETION-2026-10-20.json` binds that handoff, new full CI, exact closed
budget receipt, public observation hashes and the private viewport invalidation hash. Earlier
partial receipts remain unchanged, including their then-pending flags. Plan23-06 is complete;
421of477plans are complete and Phase23 is6/9.23-07/08/09 remain open. The next23-07checkpoint
is fresh authorization for the literal handoff candidate's full unfiltered46-case evaluation
only, followed by actual native B public OWNER_REQUIRED refusal without credential extraction.
It adds no runtime-attribution turn. Activation/runtime/rollback retain23-08's separate checkpoint.
No evaluation or activation occurred; SKILL-02/Phase23/48-02 remain open and Phase49 has not started.
