# Plan 47-22 independent technical review — synthetic GO (2026-09-26)

> **Current-source correction, 2026-09-28:** the three code/test SHA-256 values below do not
> match the current tree. This review remains historical for its recorded bytes; it is not an
> independent GO for the current candidate. See [47-23 current-source and real-rail audit](47-23-CURRENT-SOURCE-AND-REAL-RAIL-AUDIT.md).

Reviewer: Codex `/root/candidate22_final_review`, independent of the implementer. I read the final schema, model, tests, README, Plan 47-22, its pre-edit baseline, the playbook, accepted ADR-046/050/051/052 and stage, and the historical `defer` decision. This verdict applies **only** to the exact source hashes below and the isolated, manually invoked synthetic candidate. It is not a D6, ROUT-02, live-evidence, production, or release verdict.

## Scope and actual-source findings

The accepted stage enumerates exactly six paths under `packages/backend/candidate/recurrence/`; all six exist, and only `schema.ts`, `model.ts`, `model.test.ts` and `README.md` changed for this plan. The candidate remains outside the configured production Convex root. A targeted production/app/core import search found no candidate import; source inspection found no candidate scheduler, cron, callback ID, `fetch`, provider key or outbound primitive. The historical decision, stage and ADR identities still match the baseline hashes. No matrix or live-evidence row was promoted.

Routine storage now has an activation anchor and last occurrence key, not a stored next due/local/arm timestamp. `latestEligible` uses the existing IANA-zone `nextOccurrence` helper within a bounded cadence horizon and takes at most the latest eligible occurrence. `claimTick` reads the current tenant, approved status, version, derived key and active run inside its transaction; it records one claimed, missed or overlap outcome and progresses the last key atomically. Approval/material reapproval anchors at its acceptance time. The new tests cover repeated fall-back time, Lord Howe's gap, Apia's deleted date, exact grace boundary and long-outage no-burst behavior.

Both synthetic sweeps traverse immutable, tenant-scoped ordinals, with durable cursor, pass high-water and epoch; a page is capped at 16. The high-water freezes a pass under insertion, deletion cannot pin a cursor, and wrap revisits previously blocked rows. Due claim and cursor advancement occur in the same transaction. Recovery classifies/settles before advancing its cursor; keyed rail release can be replayed if a process stops after terminal settlement but before cursor commit. An unknown `start_claimed` physical call stays visibly blocked and is not redispatched. An unresolved early rail row does not starve later terminal holds. The two added crash tests assert rollback before claim commit and idempotent terminal replay before cursor commit. Existing paid-step, pause, budget and refs-only adverse controls remain passing.

The single progress row per tenant may contend at production scale, and the synthetic rails' keyed tombstone/lookup semantics have not been proven on a real limiter. The pre-edit candidate files were untracked, so Git cannot provide a byte-for-byte baseline diff; I compared the recorded pre-edit hashes and gaps with the actual final source, tests and stage inventory, without treating the plan's prose as proof.

| Final candidate file | SHA-256 |
| --- | --- |
| `schema.ts` | `ef6352a000c0cd17896c52e3cf1ec7f4e00ee596f4b741dc8c20f3fdf1b17e4d` |
| `model.ts` | `adfefce74817d36b4f92b1b88a681748ee4c24ac81a8e3383c10310f4dca9be9` |
| `model.test.ts` | `10c2d9f4ddcc01eae0186a6d53b9dd7afe9003117149917e8fb0a15756324f03` |
| `README.md` | `825e93bbc9fe3cf351bb00fb1f8d54b98de43870ae4ec8bb056d92c487d9be8d` |
| Unchanged `tsconfig.json` / `vitest.config.mts` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` / `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |

## Independently run checks

| Check | Observed result |
| --- | --- |
| Candidate Vitest and candidate TypeScript | 35/35 tests, exits `0/0` |
| Backend TypeScript | exit `0` |
| `routineDecision.test.ts`, `routines.test.ts`, `dstProbe.test.ts` | 108/108 tests, exit `0` |
| Gate `--self-check` | 32/32 cases behaved, exit `0` |
| Historical `--matrix` / `--eligibility` / `--validate-decision` / stage `--validate-stage` | `0/1/0/0`; eligibility refused with 14 findings |
| Playbook checker (`'{}'` on stdin), strict planning checker, `git diff --check` | exits `0/0/0`; diff emitted unrelated CRLF warnings only |

The root's earlier recorded graph refresh and edge fixup exited `0/0`; I did not treat that as behavioral proof or rerun it for this document-only review.

## Verdict and remaining proof

**GO for Plan 47-22's isolated synthetic design evidence only.** The final 35-test source is coherent with the plan's derived-occurrence and bounded/replayable sweep contract, and I found no material issue requiring candidate edits. This does **not** change the operational `defer` decision or the `0/1/0/0` gate exits. D6 and ROUT-02 remain missing. A real production sweep/caller and unattended recovery liveness, transactionally integrated real spend rails and compensation, actual per-run approval/action admission, live DST fire observations, seven-day OAuth explicit-reconnect/no-burst, unattended provider-read artifact, substantive matrix review and a separate owner release decision all remain open. No tenant activation, production deployment, provider/paid call, external write or send is authorized by this review. Any candidate source change invalidates this hash-bound verdict and requires fresh review.
