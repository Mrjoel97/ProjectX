# Plan 47-21 — independent technical review

**Verdict: ACCEPT the bounded ADR-052 governance/checker transition only.** Independent reviewer: Codex `/root/phase47_21_draft_reviewer`, separate from the transition worker, 2026-09-25. Root also reviewed the final baseline-to-target diffs and four real gate modes. This is not a D6, ROUT-02, Phase 47, Wave 6 or release pass.

The owner explicitly accepted the independently reviewed proposed [ADR-052 draft](47-21-ADR-DRAFT.md), SHA-256 `665fdedc0cd4bb81fb547062f6caba55744391d2fcfa802172ac19b8d23923ab`. The [checkpoint and pre-transition review](47-21-INDEPENDENT-REVIEW.md) record the separate verdict. Comparing draft to [accepted ADR-052](../../../docs/decisions/052-sweep-only-recurrence-d6-evidence-reconciliation.md) shows only title/status/path/provenance/link/retrospective-tense transformations; its D6 obligation and restrictions were not rewritten. The accepted ADR's SHA-256 is `525590dc6dff1f6f9f1d42c13c1f3f565add4b3502d091e6808e66e97b760b65`.

ADR-046, ADR-050, ADR-051, the historical defer decision, the six candidate files and the disabled six-file stage artifact retain their [baseline](47-21-BASELINE.md) hashes. The checker's stage-validator section is byte-identical to the protected pre-edit backup. The only checker change is a distinct exact path/SHA-256/accepted-status predicate for ADR-052 and its own exact filename exception under historical `defer`; neither ADR-050 nor ADR-051's predicate was weakened. The stage frontmatter was not extended. A missing ADR-052 still permits historical defer; a forged, altered, renamed or extra recurrence ADR is refused. The owning playbook states the same narrower authority and open proof.

The spawned actual-CLI controls cover genuine and absent ADR-052, forged/content/status/accepted-path/draft-hash changes, a true rename with the exact path removed, an additional recurrence ADR, ADR-050/051 tampering, and missing, duplicated, unknown, broadened or changed-inventory stage fields. The initial independent post-transition review refused a test gap; the correction was applied and the reviewer accepted the final bytes.

| Check | Final observed result |
| --- | --- |
| Focused backend `routineDecision` / `routines` / `dstProbe` | 108/108, exit 0; worker and independent reviewer |
| Checker `--self-check` | 32/32, exit 0 |
| Backend TypeScript, playbook, strict planning, `git diff --check` | each exit 0; root independently reran the latter checks |
| Historical `--matrix` / `--eligibility` / `--validate-decision` / stage `--validate-stage` | `0/1/0/0`; root independently reran; eligibility still refuses with 14 findings |

Final SHA-256: checker `444e249c20c5b13f69ebb9bb93a1cd517156828721e12087675dee9b293b67ae`; focused test `6706165aaeb9fe0093c4553d2a26858babdb2a64f25496b1a1f7bc130defc5b8`; owning playbook `f4cbeb5aa4e6107019db67fff1d15b212adf135da526d940e644709cad81d124`; stage `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34` (unchanged). Protected byte-exact pre-edit backups are recorded in the worker handoff at `C:\Users\expert\AppData\Local\Temp\pikar-47-21-2e3199e53a784c0aa0c81990d7808d3f\`; no rollback was needed. No provider/paid/live call, deployment, tenant activation or send occurred.

**Open limits:** Real bounded deployed sweep/reachability, spend-rail settlement and recovery liveness, per-run approval integration, D6 production proof, and three separate live DST/OAuth/provider traces are not established. The historical operational decision stays `defer`, the stage stays disabled/isolated and eligibility stays red. Full `graphify update .` was attempted after code edits but stalled without output and was interrupted; no completed full graph refresh is claimed. `node scripts/extract-convex-edges.mjs` exited 0 separately. The four already-armed DST probes remain untouched.
