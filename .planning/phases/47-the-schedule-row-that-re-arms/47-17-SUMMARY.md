# Plan 47-17 summary — D6 design route chosen, recurrence still deferred

**Completed:** 2026-09-25. **Scope:** the D6 source/governance packet and owner route checkpoint only. This does not complete ROUT-02, Phase 47 or Wave 6.

The [decision packet](47-17-D6-DECISION-PACKET.md) exposed the conflict between ADR-046's literal pending-function cancellation and the preserved sweep-only design, and separated three other test-candidate versus production-design gaps. An [independent reviewer](47-17-INDEPENDENT-REVIEW.md) initially refused presentation until those gaps were added, then accepted the corrected packet. The owner explicitly chose **“B — keep sweep; draft narrow D6 amendment (recommended)”**. This selected a drafting path, not amendment text or D6 evidence.

The candidate's nine synthetic tests and candidate typecheck passed. The historical matrix, eligibility, operational defer and separate stage exits remained **0/1/0/0**; eligibility's exit 1 is the required refusal. Strict planning and diff checks passed. No recurrence runtime, schema, scheduler, ADR, checker, stage, live artifact, provider/paid call, deployment or send changed in this plan. The shared dirty worktree prevented a clean atomic GSD task-commit sequence; no commit is claimed here.

**Next:** Plan 47-18 drafts exact narrow text and asks for separate owner acceptance. The real DST/OAuth/provider observations, D6 implementation/proof and all other eligibility rows remain open.
