# Phase 23 current-boundary mutation supplement

Status: 17 current targets have hash-bound controls across two explicit harness revisions; prerequisite acceptance still requires review of the limits below. This record
does not certify Task 1, authorize Task 2, or amend historical 23-01 through 23-05 observations.
No provider, deployment, owner grant, candidate, or evaluation evidence is involved.

The historical plans name 18 targets: 3 + 4 + 3 + 6 + 2. The isolated owner-wrapper proof already
has a dated hash-bound supplement in 23-05. `scripts/check-phase23-mutation-proofs.mjs` addresses
the other 17 current targets, with the reconciliations below. A successful count alone is not
acceptance of a different claim.

## Operation and evidence

`node scripts/check-phase23-mutation-proofs.mjs --plan` validates unique exact patch anchors and
lists targets without executing tests. `node --test scripts/check-phase23-mutation-proofs.test.mjs`
tests the patch engine and target inventory. Neither command changes production sources.

After the release suite finishes, `node scripts/check-phase23-mutation-proofs.mjs --run` runs
serial clean/rejected/restored subprocesses. An optional exact target ID selects one target.
The harness snapshots tracked files into ignored `.tmp/phase23-mutation-*`; dependencies are
shared through directory links, but Vitest package aliases point at the isolated source copy and
its cache is isolated. Local environment/auth/output files are excluded. The child environment is
an explicit OS-variable allowlist, and preload/setup disable fetch and native HTTP/TCP/TLS calls.
No model or deployment command is an execution mode.

Each v2 receipt binds immutable executing harness bytes/hash, the copied snapshot manifest, original source hashes, control hashes, mutant
hashes, restored control hashes, named rejection, and subprocess exits. Active source bytes are
checked again. Raw test diagnostics remain only in the ignored scratch directory. Compiler
rejection is classified separately from behavioral rejection. Failed control, wrong failure,
timeout, missing anchor, or unrestored bytes abort without a passing receipt.

Runner mutations change the evaluator source revision. Only the disposable copy is mechanically
repinned using the existing evaluator identity function and native suite-manifest writer, so the
targeted native guard can be reached. Those copy-only revisions and changed contract/manifest
hashes are included in receipts and restored before the final clean control. Root evaluator pins
and historical qualification remain unchanged.

## Target mapping and limits

| Plan target | Current isolated witness | Qualification |
| --- | --- | --- |
| 23-01 widen agent set | Add document analyst; exact-set contract rejects | Direct |
| 23-01 remove subset assertion | Widen set and remove exact/subset assertions; independent ungated-name test rejects | Composite sensitivity, not proof that deleting an assertion alone is detected |
| 23-01 allow absent lineage | Reorder source-turn index and remove tenant predicate in isolated reader; cross-tenant test rejects | Historical documented substitute; optional schema provenance remains optional, not a proven required-lineage constraint |
| 23-02 insert active | Change writer's candidate status; existing writer-region guard rejects | Structural invariant witness |
| 23-02 caller tenant/author | Add author to real writer validator; independent author-key version of existing extra-key test rejects acceptance | Tenant is already a trusted internal argument; no invented client tenant input. Tests forbidden author input, not a newly widened row-author assignment |
| 23-02 missing tenant predicate | Remove tenant prefix from writer query | Expected TypeScript TS2345, not a behavioral red |
| 23-02 archive pending | Replace refusal with archive; existing pending behavior rejects | Direct |
| 23-03 unconditional tool | Remove structural grant/lineage gate | Existing grant-absence test |
| 23-03 self-selected grant | Derive authoring grant from requested tool list | Existing specialist real-loop test |
| 23-03 activation call | Insert activation call in authoring tool | Existing tool-region guard |
| 23-04 omit row identity | Remove exact candidate ID comparison | Existing contract identity test |
| 23-04 stale suite | Remove suite revision comparison | Existing stale-suite test |
| 23-04 record filtered run | Remove actual `shouldRecordEvidence` filter clause | Native self-check's positively witnessed filtered-run rejection |
| 23-04 zero cases | Remove actual `shouldRecordEvidence` positive-count clause | Native zero-case evidence rejection |
| 23-04 skip preflight | Remove final and earlier revenue-entry self-check calls | Composite source-scan sensitivity; existing scan can otherwise match the earlier branch, so this does not prove each branch independently |
| 23-04 expose holdout | Reach fixture loader from exact source inspector | Native holdout boundary assertion after copy-only repin |
| 23-05 remove mount | Remove existing workspace panel mount | Existing mounted-panel assertion |

The original lineage requirement and independent per-branch preflight guarantee are not established
by these composite witnesses. They must remain explicit review decisions or follow-up requirements;
do not close Task 1 merely because all 17 IDs eventually obtain receipts. The author-key companion
test is installed only in the copied test file, identically for both clean controls and the mutant.

## Initial free validation

- Five patch-engine tests passed, including fail-closed snapshot/control drift and explicit package export resolution; all 17 current anchors resolve.
- Prior handoff validator passed 1,338 probes during prerequisite review.
- Full release suite remains separately owned; this supplement does not replace its results.

The preliminary run completed five controls before stopping because the harness expected TypeScript
exit 2, while the actual `--noEmit` TS2345 rejection correctly exited 1. Its source hashes matched
the snapshot, but the executing harness bytes were not captured and lightweight harness changes
occurred during that run. Those ignored records remain unchanged as limited observations. The
final frozen harness captures its own bytes, rejects changes during execution, verifies active
source hashes against the snapshot before every case, and expects the correct compiler exit.
A complete fresh run is required; preliminary rows are not substituted into final proof.

## Observed final controls

The fresh frozen run completed the first 16 targets, including native filtered/zero-case writer
rejections, the explicit TS2345 compiler rejection, and restored controls. Its last UI clean
control failed before mutation because the isolated alias generator assumed every package
subpath lived under `src/`; the generated backend API actually has an explicit package export.
That failure was a harness defect and generated no UI proof.

The narrow harness correction gives explicit package exports precedence and has an independent
resolution regression. The UI target was then run with the corrected frozen harness and passed
clean/rejected/restored controls. The two receipt files remain separate and unchanged:

| Receipt | Targets | Receipt SHA-256 | Executing harness SHA-256 |
| --- | --- | --- | --- |
| `.tmp/phase23-mutation-1789214899970/receipts.json` | First 16 | `b404d6cf6df9eb97c0dc5f01891ee25023068b217f7dae93ab1383d0996669d5` | `c5d4b83be4ac22d299b1bc87245678d94acda6146bfc9b47b3a139bd150b5554` |
| `.tmp/phase23-mutation-1789215449370/receipts.json` | UI mount only | `4a3a5b33fc1bd618df372f66371dd0aa3fa9e6ac900e50a6c8f2aecc58503cbb` | `ed774bd085f8f61daf632c8bfc0a796a19fda65fed105465fc8979acc9e607b3` |

Independent read-only validation confirmed 17 distinct target IDs, all clean/restored exits 0,
all deliberate rejection exits 1, captured harness hash agreement, snapshot manifest hash
agreement, source-before/snapshot/source-after/current-source equality, and byte-identical
control/restored copies. This is evidence across two stated harness revisions, not a claim that
one uninterrupted execution completed 17 cases. No production source or evaluator manifest was
modified. No provider/model spend occurred. The composite and required-lineage limitations
above still apply; Task 1 and subsequent live acceptance are not automatically marked complete.
