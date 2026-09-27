# ROUT-02 — proposed build-for-evidence stage

Owner path selected: **Choice C, 2026-09-24.** This is a reviewable stage specification, not an activated gate or a claim that recurrence is safe. The historical [29 decision](../29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md) remains `defer`; [ADR-046](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md) D1–D9 and its implementation-before-pass requirement remain binding. The current checker still accepts only `defer` and `enable-safe`. `--eligibility` remains red.

## Purpose and ordered states

The current rule requires implementation tests for D1–D8 before `enable-safe`, but `defer` forbids the implementation. A separately reviewed governance amendment must introduce a third, **non-exposure** state:

`defer` → `build-for-evidence` → `enable-safe`.

`defer` remains the operational product state throughout the intermediate stage. `build-for-evidence` is permission to construct and test a disabled candidate in an isolated development/test deployment only; it is neither a second production mode nor an eligibility verdict. There is no transition to `enable-safe` without twelve substantively reviewed passing rows, including the three required real live traces, and a separate owner release decision. Failure, expiry, or missing evidence returns the candidate to `defer`, not to a weaker launch mode.

## Proposed amendment boundary — not yet effective

1. Draft a new superseding governance decision under Phase 47 planning, outside `docs/decisions/`, and have a reviewer approve its exact scope. It must amend only the *order* of the 29 absence rule for this stage, without editing the accepted 29 record or weakening ADR-046. Do not place a Proposed recurrence-named ADR under `docs/decisions/`: the current `defer` guard would correctly turn red during an indefinite review checkpoint. A general permission grant is not this amendment.
2. After that review, materialize the accepted decision and extend `check-routine-gate.mjs` with a separate `build-for-evidence` validation mode/artifact in one bounded, verified transition. The mode must require that exact accepted decision, an explicit disabled/isolation declaration, and a finite review checkpoint. It must **not** reuse the twelve-row `enable-safe` eligibility result, return success for `enable-safe` with missing evidence, or let the old `defer` artifact validate a recurrence implementation. Keep all three existing modes and their fail-closed tests intact. If verification fails, leave only the planning draft and preserve the former defer-valid state; do not strand a Proposed ADR in the guarded directory.
3. Mutation-test the state boundary: an absent, malformed, expired, or broadened stage artifact is refused; a `defer` tree still forbids recurrence runtime; `build-for-evidence` does not permit a tenant-callable path; and `enable-safe` still rejects missing or non-live rows. The checker remains a structural guard; human review must read each citation for relevance.

Until steps 1–3 are reviewed and pass, **no recurrence table, scheduler, runtime, UI, new recurrence ADR, or production deploy is authorized by this charter**. The already-armed `dstProbe` jobs are an independent evidence probe, not a candidate routine.

## Candidate implementation envelope after the amendment

The implementation may add a dedicated routine/run storage model, pure schedule and material-change functions, an internal claim/state machine, whole-run budget reservation/reconciliation, and refs-only audit/notification outputs needed to test ADR-046 D1–D8. It may be exercised with synthetic tenants and stubbed providers in a separate test deployment. It must have no public UI, no tenant-callable create/arm/activate mutation, no registered cron or self-rearming callback, no production migration/deployment, no real provider reads or paid calls, and no external send/write path. A feature flag alone is not sufficient isolation: tests must prove the absence of reachable activation and outbound edges.

The candidate's tests must cover structured material-change revocation, one atomic occurrence claim across repeated wall time, missed-run skip/no burst, one-active-run overlap, closed retry/terminal classes, immediate pause plus callback re-read, a whole-run reservation released on every terminal path, and refs-only audits. They must also prove that preparation stops at the existing per-run human approval gate and that injected content cannot invoke an external write. Source-only existence or a green unit test is never labelled `live`.

## Evidence and exit review

- Continue the four already-armed real DST checkpoints without re-arming them; each collector artifact requires a fired audit pair and independent timezone review. The spring/fall-back evidence requirement is not relaxed.
- Obtain an owner-designated real grant for the unattended provider-read trace. Observe actual seven-day grant expiry, explicit reconnect, and no catch-up burst through refs-only evidence; access-token refresh or a fixture is insufficient. If no safe method exists while the runtime is disabled, leave the row missing and return for governance review rather than infer a pass.
- After implementation and tests, independently review each of the twelve matrix rows and its distinct citation. Run the existing `--matrix`, `--eligibility`, and `--validate-decision` modes on a **new** proposed `enable-safe` artifact. Only then may the owner consider a separate activation/deployment decision. That decision must specify tenant cohort, monitoring, rollback, spending ceiling, and re-evaluation trigger; none is granted here.

## Stop and rollback

Keep the candidate on a bounded branch/test deployment. If isolation fails, a test finds an outbound path, a budget reservation leaks, a required live trace cannot be obtained, or the review checkpoint expires, stop candidate execution and retain the manual pinned-rerun product behavior. Do not erase the accepted 29 record, rewrite failed evidence as `pass`, or claim that removing source alone undoes a production schema migration. Production deployment is explicitly outside this stage, so there is no production recurrence state to roll back.
