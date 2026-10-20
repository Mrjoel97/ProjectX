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
The next gate is fresh source qualification, an explicit handoff disposition and new paid
approval. No new-source handoff readiness, retry permission or passing evaluation is claimed.

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

## Disposition

Plan 23-07 remains partial. Preserve the actual single attempt and its timing/cause uncertainty;
do not retry automatically or substitute a partial result for the full gate. Only an actual
complete passing full suite followed by native B public OWNER_REQUIRED with unchanged state
can support the existing immutable eval-result writer. This attempt produced neither that
result artifact nor permission to bypass the gate. A later attempt requires fresh source
qualification, handoff disposition and its own concrete authorization, not reuse of this closed
budget or silent rewriting of the original handoff.

Plan 23-06 stays complete; Phase 23 remains 6/9 with 23-07/08/09 open. SKILL-02 and Phase 48
remain open/partial, Phase 21 stays accepted and Phase 49 has not started.
