---
phase: 23-agent-authored-skills
plan: "07"
subsystem: acceptance
status: partial
completed: false
requirements-addressed: [SKILL-02]
requirements-completed: []
---

# Phase 23-07 — approved full-suite attempt interrupted; partial

## Exact authorized scope and preserved inputs

The user's verbatim answer was **“Approve scoped $2 evaluation”**. This approved one full,
unfiltered 46-case evaluation of candidate `qn73f3q6zcs1fsjpm9x2vwykc58gm09j`,
offer-architect v2, under an aggregate 200-cent ($2) cap.
The private immutable approval is `phase23-eval-approved-20261020/authorization.json`, SHA256
`bbe9dea3b15d832fc474c7beb211a25ca6fbbc85ff92798a3155d4077efd2e64`.
The approved scope includes success-only cleanup of this exact synthetic evaluation root,
preserving spend events. That success condition was not reached; unconditional or partial-run
cleanup is not authorized. It excludes an automatic second attempt, additional runtime-attribution
turns and candidate activation. Native B public refusal follows only after passing full evidence.

The unchanged input is `23-LIVE-HANDOFF.json`, exact SHA256
`112ce2643ae15d4b2c39961b09506223bf0d6fe9978993dfe9536cee2dcbdc45`.
Candidate body hash remains the pinned input
`4ec9235c1d0ccce418e54e2adcc2393aa2e778fb8d0968047053f6e5473c12e0`;
suite revision `2026-09-11.budgeted-evaluator.1724732bc7d73e8f907ce53184186129e7e6a93e71d5fa3de7201f79fefb7cd3`,
Cases hash: `5794b8b0a9716d76bb3cab9f513f251994ad832eaf87d443cef4b3787db6f4fa`; count: 46.
Execution source was `06060d2bc51b1c4b985bb3a8296f03aad0513b86`, with full CI `39432731681`.
No immutable handoff or earlier observation was rewritten by this attempt.

## Actual single attempt

The runner started once: run `0b8d825d`, synthetic root `eval-0b8d825d`, new evaluation budget
`p57067hpjwen71yc4vhx5txav98gmnat`. It exited 2 at `2026-10-20T14:37:32.660Z`.
Seven case passes and zero case failures were reported before the stop. Case08 returned all
three submissions but produced no verdict. This is an incomplete run, not a 46-case pass,
an inferred case 08 failure or proof that all remaining cases failed. Case 08 is unjudged and
the remaining 38 cases are unattempted, as recorded in the actual partial receipt.

The exposed code is `GOLDEN_PAID_CALL_UNRESOLVED`. That wrapper conflates failures at
budget-guard and receipt/response boundaries; the exact cause is not established. Do not turn
the error label into a provider-failure, exhausted-budget or unsettled-ledger diagnosis.
Actual later controls below are separate evidence.

## Separate routing diagnosis and changed-source boundary

Offline qualification reproduced a concrete case 08 routing defect: an imperative email request
with a lowercase invalid recipient is classified as general with gmailRequired=false. The
capability detector recognizes valid addresses, supported recipient prepositions or capitalized
names, so this malformed-recipient form misses the email route. Actual case 08 first-turn
observations include dispatchMedia/dispatchTeam and CRM writes; the later proper-address turn
adds email tools to a media-kind plan. These are synthetic evaluation-tenant observations.

This routing diagnosis is separate from the still-unproven exact branch behind
GOLDEN_PAID_CALL_UNRESOLVED. The narrow routing fix and playbook update are implemented;
39 routing tests and four closed-code paid-attempt diagnostic tests pass offline. Diagnostics
distinguish the fixed budget-guard code without exposing arbitrary errors. No wait or verdict
oracle changed in that routing/diagnostic repair. The later free oracle correction below changes
the current corpus and evaluator identity. This interrupted attempt and
the immutable handoff remain evidence for their original source, not qualification of the fix.
At this offline-repair boundary, fresh source qualification, an explicit handoff disposition
and new paid approval were still outstanding. The later release/refresh below supplies a new
current handoff, without retry permission or a passing evaluation.

The free oracle gap is now corrected offline: fixture 08 adds `emailOnly: true` while retaining
its original input turns, proposed-status and exact-recipient positives. Ordinary email requires absent
plan.kind; the existing exact tenant/thread query rejects attempts, including refusals, at the
closed seven operations dispatchMedia, dispatchTeam, dispatchResearch, stageCrmWrite,
proposeCalendarEvent, proposeCalendarChange and stageFinanceWrite. Missing or malformed
observations fail closed. No grants, endpoint, waits, retries or paid execution were added.
The existing scoped-query/refusal tests pass 25/25, and the golden self-check passes 57 valid
fixtures across 12 gated skills. The current golden suite remains 46 cases, now with cases hash
`5dbe6fdbd447ab2a152ccf928d195ed404ca3bf431f5240397f6be3b627e55fd` and revision
`2026-09-11.budgeted-evaluator.d122dad4d5610f14a4934962b82d7a8c30acd8444cc3694a41b008705e8d210f`.
This is an offline assertion/identity update, not a new live semantic pass or permission to
rewrite the original source/corpus pins above or the immutable handoff/partial observation.

## Budget observations and later normal closure

At `2026-10-20T14:38:57.281Z`, the native ledger reported 89 settled calls, zero unsettled
calls, actual cost `$0.06160618`, cap 200 cents and remaining 124 cents. The budget was open,
unexpired and unbreached at that observation. This historical snapshot remains valid and
must not be silently rewritten as a closed-budget observation.

Private `timing-reconciliation.json`, observed at `14:48:03.773Z`, reconstructs one outstanding
reservation at the local process-exit timestamp and five settlements after exit. The exact
guard-time state is unknown. These timings are compatible with an asynchronous guard stop,
but do not certify that branch or establish the generic error's exact cause. All 89 calls were
subsequently settled with zero holds; cost remained `$0.06160618`.

Normal `guardrails:closeEvalBudget` was called once after native guards verified settled
workflow/document state in its transaction. Private `budget-close-result.json`, observed at
`14:48:43.529Z`, records closed=true, 89 settled calls, zero holds/breach and unchanged cost.
The earlier 124-cent remaining balance is unavailable because the envelope is now closed.
This is guarded closure, not force-close, cleanup, a passing evaluation or new spending consent.

No passing candidate evidence, `23-EVAL-RESULT.json`, B public mutation, owner activation,
cleanup or rerun followed. Retain the exact candidate, synthetic fixtures, source/result
observations and spend ledger. No fixture or spend evidence was deleted or reset.

A separate read-only postcheck at `14:58:53.908Z` confirmed exact candidate provenance,
global registry and protected retention unchanged, with the budget still closed, 89 settled
calls and the same cost. Private `phase23-eval-approved-20261020/postcheck.json` has SHA256
`3a78984bacc3e009f06a5eb14d922f028379dc33bc21daea245f783d3fcabca6`.
This observation does not supply missing case verdicts or runtime prompt-load attribution.

The immutable refs/hash-only [partial observation](23-07-PARTIAL-2026-10-20.json) has exact SHA256
`14ca4569bf8ae82e7254372106a8e7f0435fe4ea08459745a50020b2ee12a87b`.
It binds approval/private receipt hashes, reported case disposition, all dated budget observations,
normal closure and inert candidate state. It is a partial observation, not the certified
`23-EVAL-RESULT` schema or a passing gate. Preserve its bytes; corrections require a separate
versioned observation. Exact stop-branch and actual runtime prompt-load attribution remain unproven.

## Later approved staging release and current readiness

The later verbatim approval **“Approve staging release”**, authorization SHA256
`53269cc546d1e7b6be1ba17a49f310591e5c6a564513f343bf1a0a41cd102371`, covers PR79,
staging-only release, existing A/B checks and a new versioned handoff. It authorizes no new
paid evaluation, activation or production deployment. PR79 merged at
`2314691a6fd34f85b3b0fd8febdbf43bf500ee45`; staging run `39460078883`, job
`118756953910`, succeeded for source `b10740d6466db155c48519aba6323d5b0c27c406`
and CI `39446162910`. The separate
[release observation](../48-readiness-and-qualification-closure/48-STAGING-PR79-RELEASE-2026-10-20.json),
SHA256 `731c7c7e67096c28d5dc230257864ca5f054bdedb1ee89a3f977d280887e38dd`,
records completed apply, passing postflight/zero parity/preservation/billing verification and
unchanged watched configuration, registry and protected retention. Billing labels did not change.

Private `phase23-eval-approved-20261020/release-readiness.json`, observed at
`16:48:53.219Z`, confirms the same exact candidate, provenance/source, baseline, effective,
global and foreign state, A owner/B non-owner, closed old budget with no holds and unchanged
cost, standard/free billing and the current d122/5dbe 46-case suite. Native
`release-native-identities.json` records A_IDENTITY_MATCH, B_IDENTITY_MATCH and NOT_STARTED.
Fresh responsive proof and a new versioned handoff were subsequently completed as below.
Historical authoring, responsive and interrupted-evaluation records are not relabeled as
current-source proof.
The documented Phase20-20 cockpit body/source variance remains accepted and preserved;
no registry repair or claim that every body matches source follows from this release.

## Current versioned handoff, without paid authorization

At `17:01:27.296Z`, the existing immutable writer, closed scanner and assertLiveMatches
passed for [the new handoff](handoffs/2026-10-20-pr79/23-LIVE-HANDOFF.json), exact SHA256
`ce31e352302bab168ba81bc564fbec90e76b2ab3eeafac402bbfa65792857d61`.
Its [refresh observation](handoffs/2026-10-20-pr79/23-HANDOFF-REFRESH.json), SHA256
`6b86ddbe2ad61dc4f331024a0e08b3fdb3420c0771bdbb28a5a38c3161cc31c8`, binds the
approved PR79 source/release/current d122/5dbe 46-case suite and six stable post-UI reads.
Exact candidate/source/provenance/global/foreign/baseline and governance remained unchanged.
Native existing A owner/B non-owner sessions were verified; existingOwnerAtStart is true.

Measured iframes at 1440x900 and 390x900 showed the exact candidate and disabled activation
gate. Draft/diff expansion by keyboard was verified in the direct native signed-in A view;
embedded controls were not exercised. Initial desktop AX-presence-only proof was excluded;
the recorded actual scrolled screenshots/new witnesses are used. This remains desktop-browser
responsive evidence, with no touch or physical-mobile-device claim. Historical source-thread
authoring/refusal was not replayed and no new agent turn was run.

This directory supersedes only the current next-input reference. The original handoff and
interrupted-run observation remain unchanged and retain their original source/corpus meaning.
No new eval-result, paid run, public B mutation, activation or production release followed;
paidReady and paidAuthorized remain false. This handoff refresh is not consent to spend.

## Current disposition

Plan 23-07 remains partial. Preserve the actual single attempt and its timing/cause uncertainty;
do not retry automatically or substitute a partial result for the full gate. Only an actual
complete passing full suite followed by native B public OWNER_REQUIRED with unchanged state
can support the existing immutable eval-result writer. This attempt produced neither that
result artifact nor permission to bypass the gate. A later attempt must revalidate the new
versioned handoff and receive its own concrete authorization, not reuse this closed budget or
silently rewrite the original handoff. No paid-consent request is part of this release/refresh.

Plan 23-06 stays complete; Phase 23 remains 6/9 with 23-07/08/09 open. SKILL-02 and Phase 48
remain open/partial, Phase 21 stays accepted and Phase 49 has not started.

## October21 free continuation and next checkpoint

Three agents reconciled the executable23-07/08/09 current input/result paths and stale Phase48
inventories without changing runtime or historical artifacts. Today's [preparation observation](23-07-PREPARATION-2026-10-21.json),
SHA256 `5ebb281e37def7c71927bbcc1a7587c987360e93022613d3060076cdca899a35`, binds source
`b10740d6466db155c48519aba6323d5b0c27c406`, current ce31 handoff and d122/5dbe46-case suite.
Readbacks at12:51:18.032Z preserved candidate/source/provenance/baseline/effective/global/foreign,
registry/protected retention, declared standard/free/0 billing and the closed old budget. Native
observations at12:55:42.393Z confirmed A_IDENTITY_MATCH, B_IDENTITY_MATCH and NOT_STARTED after
routine reauthentication of the same approved test accounts. No access grant was made.

Shared schema/private-canary scan and assertLiveMatches accepted these captured readbacks at
13:02:40.871Z; that validation process performed no additional live reads. A redundant standalone
operator invocation exited1 without a passing receipt; its cause was not established and it is
not substituted for or described as a fresh successful end-to-end CLI preflight. PaidReady remains
false; immediate pre-spend prerequisites must pass anew.

Subsequently the shared operator passed through the authorized developer CLI at13:07:46.389Z:
[separate immutable preflight](23-07-PREFLIGHT-2026-10-21.json), SHA256
`6b7f112d3e4544625e56a299004083a4345d9a31da7bfe0faaf5696052ac2915`, records six matching
reads/current ce31 handoff and candidate status. This separate receipt preserves the earlier
preparation observation rather than rewriting it. The later CLI used a public secondary canary;
original private-canary scanning passed in the separate captured-readback validation. Native
identity checks are likewise separate; retain the operator's authSessionVerified:false and
paidReady:false rather than upgrading its scope. No paid call or public B mutation followed.

Fresh local golden self-check passed57 fixtures/12 gated skills; skills.test.ts passed187 tests.
Focused validator/operator/planning checks passed. Unauthenticated October21 public catalogs list
all proposed chat/embedding routes; they establish neither provider account quota nor inference.

[The new proposed scope](23-07-CHECKPOINT-2026-10-21.md) requests one complete current46-case
evaluation under a new aggregate$2/one-hour envelope, preserving existing retry/stop/cleanup and
non-owner-refusal gates. Evidence cost stays equal to candidate evidenceSummary; aggregate provider
spend is separately bound to the closed budget in a refs-only accounting companion. No schema or
runtime equality was weakened. This document and general continuation grant no new paid consent.
Old checkpoint/handoff/partial/budget remain historical; no eval result, B mutation, activation or
production change followed. Phase23 remains6/9,48 partial,49 not started.

## October21 separately approved attempt: precise stop cause observed

The owner subsequently answered verbatim **“Approve this new $2 staging evaluation”** for
[the exact October21 scope](23-07-CHECKPOINT-2026-10-21.md). Private authorization SHA256
`944728bd84721c101713df0d4f91e08880f6782f8b30e39b3acc552d1d0faeba` binds checkpoint SHA256
`76e6fa096f9c6d73dc540e80765a120138ca7ecb87edd06f7ac38e0fe4546b96`, ce31 handoff, exact
candidate/body/current46-case suite, sourceb107,200-cent cap/one-hour lifetime and one full run.
The sole runner used an isolated cleanb107 checkout and external immutable current handoff;
sanitized exact-stage selection, six stable readbacks, provider-presence/billing declarations,
native A/B witnesses and private scanner/shared live matching passed immediately beforehand.

Run`31a81b38`, root`eval-31a81b38`, budget`p5763r5x30jrpfkbqf94zv75ps8gpbdh`, started
13:20:49.330Z and exited2 at13:37:56.964Z.28cases reported PASS, including repaired fixture08;
zero FAIL/zero retries. Next fixture by runner order,30-gap-dispatch-money-model, has no verdict;
17later cases were unattempted.63exclusive paid-action starts have62returned receipts and1
unresolved llm:runCockpitAgent attempt`9f16ec7d-8c11-47ca-99f9-45a082988ff3`. No replay occurred.

Runner code was GOLDEN_PAID_CALL_UNRESOLVED. Bounded private server-log inspection identified
EVAL_BUDGET_EXHAUSTED in both reserveEvalCall and runCockpitAgent under request
`2d70ceb67a61eb5b`. Unlike the October20 attempt's uncertain generic exception, this native
admission cause is observed. The action still lacked a certified return and is not retried.
The ledger had198calls/198settlements/zero holds, actual$0.14551101 and2remaining enforcement
cents under the200-cent cap. Per-call ceil(actualUSD*100) explains how sub-cent calls consume
nearly the entire enforcement allowance without spending that many provider dollars.

Normal closeEvalBudget ran once with its own ledger/durable-work guards; closure passed at
13:47:31.744Z, preserving actual cost and all spend/test records. Post-close readback confirmed
closed/unbreached/198settled/0holds and unchanged candidate/source/provenance/baseline/effective/
global/foreign/registry/protected-retention state. The private postrun helper initially compared
caller expectation metadata; only that non-live metadata was excluded in the corrected helper.
Original failed postrun-1 was retained; successful postrun-2/3 are separate observations.

[The new immutable partial record](23-07-PARTIAL-2026-10-21.json), SHA256
`64a1edc5b7843212673e119679da0eba1bc7993fe6343ce712fb821534399062`, binds exact source,
approval, handoff, suite, native errors and receipt hashes. It is not23-EVAL-RESULT. No passing
evidence, B public call, activation, cleanup, budget reset/top-up or second full run followed.
The earlier October20 artifacts/budget remain unchanged.

The accounting repair is being prepared offline, retaining the approved dollar cap and full
unknown-call holds while using integer nanodollars for aggregate admission in new isolated golden
envelopes only. Legacy envelopes, authoring probes, packs/verticals and independent rails remain.
New source needs its own CI/reviewed staging release, refreshed handoff and fresh paid checkpoint;
this authorization is consumed. Existing private result writer remains unexecuted and refuses
this incomplete run. Phase23 remains6/9,48partial,SKILL-02open and49notstarted.

## Offline accounting repair prepared after terminal reconciliation

The implementation opts only new isolated golden runs without authoring probes into immutable
ledger-nanos-v1 aggregate accounting. The pure cost helper conservatively rounds each settled
provider dollar charge upward to integer nanodollars, retains every unknown call's whole-cent
ceiling, and rejects invalid/duplicate/orphan/overflow ledgers. Native reservation reads and append
remain one indexed transaction. Legacy envelopes, new probes/packs/verticals, per-call bounds,
daily/deployment rails, expiry, breach checks,500-call bound and native closure remain unchanged.
The exact marker is mirrored in schema and the existing append-only movement validator; there is
no caller-selected migration, reset, top-up, reopening or retry path.

Focused tests passed14cost/provider cases plus49native/legacy/authoring/admission/ledger cases.
Independent review found no material precision, race or migration issue. The repository free
gates passed; source review and CI remain the release boundary. ProposedADR061 and the watched
playbooks disclose that no live billing/qualification acceptance follows from these tests.

Both pinned source identities were refreshed deliberately: golden
`2026-09-11.budgeted-evaluator.5867c6e86ad02677493c5b238d206965704761cf7eac8b7561078afac91d8d4d`,
same46-case5dbe corpus; vertical
`e4174daf40d9477487ae28a45b3a7412c5f30223bdbdeb1dfcb9137de98a20f4`, same6lanes/40cases/dc21
corpus. The current deployedb107/ce31 input and all prior immutable records retain their historical
meaning. A reviewed new staging release and a new source-bound handoff must precede any new paid
checkpoint. No staging or production deployment, further evaluation or activation occurred.
