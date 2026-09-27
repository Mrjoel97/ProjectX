# Plan 47-19 — pre-edit transition baseline

Captured 2026-09-25 before any Plan 47-19 ADR, checker, test, or playbook edit. The shared worktree was already dirty. The accepted proposed ADR-051 draft is unchanged at SHA-256 `fffda838ac5f4ec9364c6721f51e6e129d669e5ab515704366625da2868bbc03`; the independent review records the owner's exact answer, “Accept exact draft (recommended).” The final ADR path is absent.

| Exact target/source | Pre-edit SHA-256 or presence | Git status at capture |
| --- | --- | --- |
| `docs/decisions/051-sweep-only-pause-fencing-for-recurring-routines.md` | ABSENT | absent |
| `packages/backend/scripts/check-routine-gate.mjs` | `37efa6f1fd0b33536744e37a8c82d76e696aa370899fe236faa7f26192863c89` | modified before this plan; `git diff --numstat` 157/3 |
| `packages/backend/convex/routineDecision.test.ts` | `9eb84ca3ea6823e9a69fbb99455c1536f029f1861067579a97e4a9a1f5055676` | modified before this plan; 133/2 |
| `docs/playbooks/knowledge-search-routines.md` | `95e7fd8bf3a23e84d40346a7f9c94a6c902323ffdb7f20c9d9d78c700cb1d067` | modified before this plan; 53/6 |
| Accepted `47-18-ADR-DRAFT.md` | `fffda838ac5f4ec9364c6721f51e6e129d669e5ab515704366625da2868bbc03` | untracked, preserved |
| ADR-046 | `153412ad41ddf274799cf77019915c4d344103a6bf8fa74468e79cc0fd522b45` | preserved |
| ADR-050 | `5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303` | preserved |
| Historical 29 decision | `cc7d4a8667ba5ed9be584e059964708b14433be751ae845dd09a7bdbb775e2ce` | preserved |
| Accepted 47-14 stage | `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34` | preserved |
| `docs/playbooks/watch.json` | `97830d10b110bdc2b02c3f3b0b74a0d8a4d92abc0d73d418d9ee475d5c963850` | preserved; checker and test covered by `knowledge-search-routines.md` |

Byte-exact copies of the three pre-existing, pre-modified transition targets were verified at `C:\Users\expert\AppData\Local\Temp\pikar-adr051-1578288825734773a98c5e79faa59d7f\` with their original SHA-256 values above. This directory is outside the repository; it is not an alternate source of governance authority.

Baseline CLI results, separately observed: `--matrix` exit 0 (`decision: defer`); `--eligibility` exit 1 (14 findings, including missing pause/revoke and the three live-proof gaps); `--validate-decision` exit 0 (`defer`); `--validate-stage` exit 0 (isolated disabled evidence build). `git diff --check` for the three targets exited 0. None of these results is an `enable-safe` verdict.

## Independent governance question — verdict pending

ADR-050 says its exact historical-defer filename exception covers “no other recurrence ADR”; it does not say no later, separately accepted ADR can carry a separately reviewed own-authority metadata exception. The accepted 47-18 draft reserves “a later bounded ADR/checker/ADR-050 reconciliation” and says its exact-text acceptance alone does not materialize an ADR or change the checker. The proposed reading is that this *later* transition may recognize ADR-051 only by its own exact identity, never under ADR-050's exception. An independent reviewer must cite and sign a GO or NO-GO before any transition-target edit. A GO would recognize governance metadata only; ADR-050's literal “pause/cancel” language still needs separate reconciliation before D6 can pass.

## Proposed materialization transform — verdict pending

The owner accepted the complete substantive 47-18 draft, not a newly authored condition. A mechanically materialized accepted ADR would retain every numbered D6 condition, evidence obligation, limitation, and stop rule. Only these bookkeeping changes are proposed for independent review: remove `Proposed` from the title/section labels; change the draft's historical `Status: Proposed` and pending reviewer/owner footer to accepted-status metadata citing this exact source hash and owner answer; change “intended final path” to the actual final path; update the sentence that says acceptance *alone* does not materialize the ADR to record that this separately checked transition now does so while leaving the stage, D6, eligibility and release unchanged; and rebase only relative Markdown links from the planning folder to the final `docs/decisions` folder. If any of those edits introduces a new substantive authority clause or alters a safety condition, this is NO-GO pending a newly accepted exact text. The accepted draft itself must remain byte-for-byte unchanged.

## Compare-and-restore boundary

Immediately before each edit, compare target presence/hash with the baseline above or the last hash made by this plan. Stop on mismatch. Compute and record the planned final ADR bytes/hash before editing the checker; edit the checker first, then create the ADR, so no interval leaves a recurrence-named ADR against a rejecting defer gate. Before any rollback, compare all four targets with last plan-owned hashes and stop rather than overwrite another writer. If unchanged, remove only the exact newly created ADR path (whose baseline was ABSENT) first, then restore only the checker/test/playbook pre-edit bytes from the verified copies. Re-run historical defer and stage. No broad reset, source-directory delete, or rollback of unrelated pre-existing edits is authorized.
