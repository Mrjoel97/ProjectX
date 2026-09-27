# Proposed ADR-050 — A disabled evidence build precedes recurrence eligibility

- **Status:** Proposed; not effective.
- **Drafted:** 2026-09-24.
- **Intended final path:** `docs/decisions/050-recurrence-build-for-evidence.md` (currently absent).
- **Owner choice:** On 2026-09-24 the owner selected the reviewed `build-for-evidence` path (Option C in [47-13-GATE-REVIEW.md](47-13-GATE-REVIEW.md)). That choice selected this governance approach; it did not accept this unseen text, activate a stage, or approve a production routine.
- **Would supersede:** Only the implementation-before-eligibility ordering in the accepted [29 recurrence decision](../29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md). That historical artifact remains immutable and operative as `decision: defer` until a separately accepted transition.
- **Does not supersede:** [ADR-046](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md) D1–D9, the twelve evidence questions, the three required real live traces, or any product release gate.

## Context

ADR-046 requires D1–D8 to be implemented and tested before their matrix rows can pass. The 29 decision's `defer` branch forbids the schedule/run implementation, while `enable-safe` requires all twelve rows to pass. Waiting for the real DST and OAuth clocks does not resolve the other implementation rows. Relabelling source/tests as `live`, editing the accepted 29 record, or disguising a recurrence ADR filename would make the gate appear open without meeting it.

## Proposed decision

Introduce an intermediate governance state, **`build-for-evidence`**, ordered as:

`defer` → `build-for-evidence` → `enable-safe`.

The stage is authority to construct and test an **isolated, disabled candidate** only. It is not a customer-facing mode, production deployment approval, a tenant standing approval, or an eligibility verdict. While it exists, the operational product remains the pinned manual rerun. The historical `defer` artifact is not edited. A new, separately validated stage artifact records the narrow exception and expires automatically unless renewed by a new reviewed decision.

The stage validator must be separate from the existing `--matrix`, `--eligibility`, and `--validate-decision` modes. The current three modes retain their meanings and fail-closed behavior. An accepted ADR-050 may be an **exact** exception to the historical defer branch's recurrence-ADR filename scan only as governance metadata; no other recurrence ADR, scheduling dependency, runtime module, table, cron, self-arm, or tenant/public activation edge is covered by that exception. A stage pass cannot return `enable-safe`, change a missing row to `pass`, or make a simulated observation `live`.

## Candidate boundary

Before any candidate code, a separate reviewed plan and updated stage artifact must enumerate **every exact candidate file** and its isolation tests. Empty inventory means pre-build governance readiness only. Candidate code may be exercised solely with synthetic tenants and stubbed providers in an isolated development/test deployment. It may cover dedicated routine/run storage, a pure schedule/material-change function, internal atomic claim/state machine, whole-run budget reservation/reconciliation, and refs-only audit/notification outputs needed to test ADR-046 D1–D8.

The intermediate stage forbids public UI, tenant-callable create/arm/activate functions, production deployment or migration, registered recurrence cron, self-rearming callback, real provider reads or paid calls from the candidate, and **all external writes/sends**. A feature flag alone is not isolation. Tests and source/reachability review must demonstrate that the candidate cannot be called from a public/tenant path and cannot reach an outbound edge. The existing four already-armed `dstProbe` jobs are independent evidence probes; their module and `arm`/`observe` export names must remain stable until their last scheduled fire.

## Evidence and exit

The candidate must prove D1–D8 adverse paths with automated tests: structured material-change revocation, one atomic occurrence claim across a repeated wall hour, missed-run skip/no burst, one-active-run overlap, closed retry/terminal classes, pause/cancel plus callback re-read, whole-envelope reservation released on every terminal branch, refs-only audit, and the existing per-run human approval boundary. Those tests are `automated`, never `live`.

`dst-boundary`, `oauth-expiry-reauth`, and `provider-read` retain their distinct real-world evidence requirements and collector/human review. The four DST fire checkpoints, an actual seven-day grant expiry with explicit reconnect and no catch-up burst, and an unattended real provider read cannot be replaced by candidate fixtures. If a condition is unobservable while the candidate is disabled, leave its row missing and return for governance review; do not infer a pass.

`enable-safe` still requires all twelve rows substantively reviewed as passing, the three required live artifacts, the existing checker eligibility result, and a **separate owner release decision** specifying tenant cohort, production deployment, monitoring, rollback, spending ceiling and re-evaluation triggers. The stage never grants unattended external writes: ADR-046 D1 continues to require a fresh human approval for each external action.

## Proposed initial stage artifact contract

If this ADR is accepted, create `47-14-STAGE-DECISION.md` with a closed, machine-checked frontmatter carrying exactly: `stage: build-for-evidence`, `status: accepted`, accepted ADR path and SHA-256, reviewer identity/date, `expiresAt: 2026-12-31`, `environment: isolated-test`, `candidateFiles: []`, `tenantActivation: disabled`, `productionDeployment: forbidden`, `providerCalls: forbidden`, `paidCalls: forbidden`, `externalWrites: forbidden`, and `externalSends: forbidden`. The checker must reject omitted, unknown, duplicated, broadened, expired or mismatched fields; it must not read an empty file inventory as permission to add arbitrary later files. Record the corresponding human-readable scope and negative test evidence beside that frontmatter. The exact parser syntax and tests are part of the later bounded checker transition, not an unreviewed assumption that this prose already validates.

## Stop and recovery

The stage ends at the earlier of its review expiry or a failed isolation, spend, approval, audit, or live-evidence review. Stop candidate execution and retain `defer`/manual reruns. No production candidate is deployed under this stage, so source removal is not presented as a production schema rollback. If the accepted ADR and checker transition fails verification, recover only that transition's exact files from its captured baseline, leave this planning draft for review, and re-run the historical defer validator. Never leave a recurrence-named ADR in `docs/decisions/` against a checker that still rejects it.

## Review status

**Verdict:** Accepted by the owner on 2026-09-24, in response to the review request linking this exact draft. The accepted scope is the limited `build-for-evidence` governance-order amendment above: isolated disabled candidate only; no tenant/production activation, provider/paid calls, or external writes/sends; expiry 2026-12-31. This verdict authorizes only Plan 47-14 Task 3's bounded ADR/checker transition. It is not `enable-safe`, candidate implementation approval, a release decision, or live evidence. The draft itself is non-operative; the accepted ADR and validated stage artifact are separate prerequisites.
