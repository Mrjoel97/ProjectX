# Plan 47-22 summary — derived due and bounded synthetic sweeps

> **2026-09-28 current-source correction:** The historical independent GO below binds
> three source hashes that do not match the current candidate. It remains a record of
> the 2026-09-26 review, not independent acceptance of today's bytes. Current tests
> still pass, but fresh exact-source review is required. See
> [47-23 current-source and real-rail audit](47-23-CURRENT-SOURCE-AND-REAL-RAIL-AUDIT.md).

**Status:** Completed as independently accepted, isolated synthetic design evidence on 2026-09-26. Recurrence remains operationally `defer`; this is not D6, ROUT-02, Phase 47 or Wave 6 completion.

The existing six-file disabled candidate no longer stores next-due or next-local fields. It derives the latest eligible local occurrence from the IANA rule and approval anchor, transactionally rechecks the claim, and never drains an outage backlog. Manually invoked, tenant-scoped due and recovery sweeps use bounded pages and durable cursor/high-water/epoch progress; recovery passes an unresolved early row to settle later known holds. The final tests also force a rollback before a due-claim commit and a restart after terminal rail settlement but before recovery-cursor advancement.

The [independent source review](47-22-TECHNICAL-REVIEW.md) gives a hash-bound GO for this synthetic evidence only. Candidate Vitest passed 35/35; candidate and backend TypeScript passed; focused backend governance/DST tests passed 108/108; checker self-test passed 32/32; the four actual governance modes remain `0/1/0/0` with 14 eligibility findings. Playbook, strict planning and diff checks passed. Full Graphify refresh and Convex edge fixup exited 0 after the final test edit.

No production caller, tenant activation, real spend rails, provider/paid call, external action or send was added. Deployed recovery liveness, D6, ROUT-02, three distinct live DST/OAuth/provider observations and separate release governance remain open.
