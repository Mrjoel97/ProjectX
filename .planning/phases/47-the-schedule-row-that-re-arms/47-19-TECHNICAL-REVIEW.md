# Plan 47-19 — independent technical review

## Task 1 governance verdict (before transition edits)

**GO, bounded to accepted-ADR/checker metadata only.** Reviewer: Codex `/root/phase47_d6_transition_checker`, 2026-09-25, independent of the root implementer. The reviewer read the [exact baseline](47-19-TRANSITION-BASELINE.md), [owner-accepted draft](47-18-ADR-DRAFT.md), [owner checkpoint and prior independent review](47-18-INDEPENDENT-REVIEW.md), [ADR-046](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md), and [ADR-050](../../../docs/decisions/050-recurrence-build-for-evidence.md).

ADR-050 says *its own* exact defer-filename exception covers “no other recurrence ADR”; it does not prohibit a later separately accepted ADR from having a separately reviewed exact metadata exception. The owner-accepted draft expressly anticipates “a later bounded ADR/checker/ADR-050 reconciliation” and an “accepted-ADR/checker transition,” while leaving historical `defer` operative. The exact-text owner acceptance is recorded at draft SHA-256 `fffda838ac5f4ec9364c6721f51e6e129d669e5ab515704366625da2868bbc03`. This GO does not borrow ADR-050 authority or pass ADR-046 D6. ADR-050's literal pause/cancel wording still needs separate exact-text reconciliation before D6 may pass.

The reviewer limits the materialization transform to title/status/provenance, final-path bookkeeping, correctly rebased Markdown links, and tense of the now-completed materialization sentence. The five D6 conditions, safety property, evidence/release obligations and ADR-050 reconciliation requirement must remain verbatim in substance. A new own-authority clause or any other substantive rewrite is a NO-GO for that diff. The root must compare actual final bytes to this boundary and obtain a separate post-edit review.

## Post-transition review

**ACCEPT for this bounded governance/checker transition.** Reviewer: Codex `/root/phase47_d6_transition_checker`, independent read-only re-review, 2026-09-25. The reviewer compared the actual final ADR to the owner-accepted draft and the pre-edit baseline, inspected the checker/test/playbook diffs, re-ran the focused tests and four real gate modes, and found no widened authority or substantive safety rewrite. The accepted draft remains `fffda838ac5f4ec9364c6721f51e6e129d669e5ab515704366625da2868bbc03`; final ADR-051 is `d52ca4736eff665e3f1f3747a2be984f6138236347353fffbf4455c7d8ec813c`, exactly the hash pinned by the checker.

The draft-to-final diff is limited to the Task 1-reviewed status/title/path/section/provenance bookkeeping, rebased relative links and tense of the now-completed materialization sentence. The five D6 conditions, safety property, adverse-proof demands, unchanged ADR-046 duties, live evidence requirements and explicit later ADR-050 reconciliation remain in substance. ADR-050's own hash (`5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303`), stage (`cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34`) and historical decision (`cc7d4a8667ba5ed9be584e059964708b14433be751ae845dd09a7bdbb775e2ce`) are unchanged. The checker adds a separate `acceptedSweepAdr` exact path/hash/accepted-status predicate and one exact filename skip; it does not change the ADR-050 exception or stage validator. A missing ADR-051 still leaves defer valid; forged/altered exact-path ADRs, a renamed recurrence/schedule ADR, extra recurrence/schedule ADR and tampered ADR-050 refuse. A renamed nonmatching file is not falsely claimed detected by the filename scan. The new mutation controls call the predicate directly; the existing spawned CLI tests cover shipped `0/1/0` and stage behavior, which the reviewer judged adequate for this narrow change.

| Check | Observed result |
| --- | --- |
| Checker `--self-check` | 32/32, exit 0 |
| Focused `routineDecision`, `routines`, `dstProbe` Vitest | 106/106, exit 0; independently re-run by reviewer |
| Historical `--matrix` / `--eligibility` / `--validate-decision` / separate `--validate-stage` | `0/1/0/0`; eligibility still refuses with 14 findings; independently re-run by reviewer |
| Backend TypeScript `--noEmit` | exit 0 |
| Playbook checker / strict planning / `git diff --check` | exits 0/0/0; only pre-existing unrelated CRLF warnings on diff check |

Post-edit target hashes: checker `e8599c09f737601940c7dc4cd1c8d14c7364e19b9643be99312560d4204d261f`; test `a35e266981fc4cb3d1d5219dbf36ee6bff385ab6228b4e94a8216307bf9112dd`; playbook `f22dbc4fa1b7b9925dd053d107bdce5349608052062d8464d4b202c6d465daa4`. No rollback was needed; the captured pre-existing user edits were preserved. The graph refresh is tracked separately below.

**Open, not passed:** ADR-046 D6 implementation and source/reachability proof; ADR-050's literal pause/cancel reconciliation; real spend rails and per-run approval integration; `dst-boundary` live fired probe, actual seven-day Google grant expiry with explicit reconnect and no burst, and unattended real provider-read collection/review. ROUT-02, Phase 47, Wave 6 and release remain open. No tenant activation, production recurrence deployment, provider/paid call or external send was made by this transition.

## Graph maintenance

`graphify update .` parsed 3,171/3,171 uncached files, then remained in index assembly while its Python process grew past roughly 3 GB and a diagnostic PowerShell process hit a memory fatal error. The update was interrupted (exit 1) to prevent further host pressure; no completed graph refresh is claimed. `node scripts/extract-convex-edges.mjs` then exited 0, reporting 76 table nodes and no newly added edges. This index-maintenance limitation does not alter the independently verified source/tests/gates and is not recurrence evidence or release permission.
