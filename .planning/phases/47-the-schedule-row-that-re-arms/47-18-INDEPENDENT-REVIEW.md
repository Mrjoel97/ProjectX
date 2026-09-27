# Plan 47-18 — independent review of proposed ADR-051

**Date:** 2026-09-25. **Draft author:** Codex `/root`. **Independent reviewer:** Codex `/root/phase47_d6_adr_checker` (read-only). **Final verdict:** ACCEPT [the exact proposed draft](47-18-ADR-DRAFT.md) for owner text review at SHA-256 `fffda838ac5f4ec9364c6721f51e6e129d669e5ab515704366625da2868bbc03`. This is not ADR acceptance, D6 evidence, ROUT-02 or Wave 6 closure, or release authority.

## Review history and corrections

The reviewer first **refused** draft `427c3479f07fabb5a45dbe5f58f4be181215d26e2c5fb904fac78d4b509bd36d`: a successful pre-call read could be followed by a pause commit, then an asynchronous reservation or network start. The draft had falsely promised that no physical call could start after pause. The author introduced transactionally fenced reservation and paid-step **admission**, with both commit orders and explicit acknowledgment that a previously admitted call may physically start or finish after pause. The source description was also corrected: current production `reliability-sweep` performs unrelated, flag-gated watchdog work, and the candidate has no routine sweep selector and stores `nextDueUtcMs`.

The reviewer then **refused** revision `2cba6f7c583f1f1b7ffad50fd2b6c59f5c48d00353e51c74dea64175ad71cb55`: unique step IDs and one active *run* did not prevent two paid steps in that run from being admitted before pause. The final draft requires a transactionally enforced single outstanding paid-step admission per run, idempotent same-ID replay, settlement and fence recheck before retry/next-step admission, and a two-competing-ID adversarial race. The reviewer re-read the exact final bytes and accepted them for owner consideration, with no remaining false current-proof claim or broadened D1/stage authority found.

## Source and scope challenge

The review covered ADR-046 D1–D9, ADR-050, the 47-17 owner B choice and technical packet, Phase 47 context/research/validation, the accepted stage, candidate model/schema/tests, pure schedule helper, production `crons.ts`/`reliabilitySweep.ts`/`dstProbe.ts`, checker, and historical decision 29. Their exact source hashes are recorded in the draft's source snapshot; the reviewer checked the cited bytes and found proposed ADR-051 numbering unused. The draft narrowly and conditionally targets D6's per-routine pending-function cancellation assumption. It retains D1's per-run human approval, every other ADR-046 duty, the three distinct real live traces, and ADR-050's disabled isolation. It explicitly requires later reconciliation of ADR-050's literal “pause/cancel” wording before D6 can pass.

No present implementation is claimed to satisfy the new admission protocol. The candidate has only synthetic state/version tests and mocked rails; the production sweep does not select routines. A real bounded selector, durable admission/idempotency state, two-rail reservation/settlement, race tests, approval integration, source/reachability proof and live evidence remain open. A green draft review cannot convert a `missing` matrix row to `pass`.

## Verification at review

| Check | Result |
|---|---|
| Historical `--matrix` | exit `0` |
| Historical `--eligibility` | exit `1`, required refusal with 14 findings |
| Historical `--validate-decision` | exit `0`, operational `defer` |
| Separate `--validate-stage` | exit `0`, isolated disabled stage only |
| Candidate edge-runtime Vitest | 9/9, exit `0` |
| Candidate TypeScript project | exit `0` |
| Strict planning | exit `0` |
| `git diff --check` | exit `0`; existing unrelated line-ending warnings only |

The draft and this review are the only Plan 47-18 execution artifacts. No accepted ADR, checker exception, stage, candidate, production/app source, matrix row, evidence file, provider call, paid call, external send, deployment or DST probe was changed.

**Owner exact-text checkpoint (2026-09-25):** The owner accepted the exact draft identified above, answering “Accept exact draft (recommended).” The draft file remains byte-for-byte at its reviewed SHA-256 `fffda838ac5f4ec9364c6721f51e6e129d669e5ab515704366625da2868bbc03`. To preserve that exact accepted object, the verdict is recorded here rather than appended to the draft's own pending-status line; this is a deliberate deviation from Plan 47-18 Task 3's annotation location, not a change in its substantive outcome. The next step is a separately scoped accepted-ADR/checker transition and technical proof; this review and owner acceptance do not pass D6 or alter operational `defer`.
