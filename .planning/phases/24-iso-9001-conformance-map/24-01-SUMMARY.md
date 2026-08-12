---
phase: 24-iso-9001-conformance-map
plan: 01
subsystem: governance
tags: [iso-9001, evidence-map, audit, skills, change-control]

requires:
  - phase: 01-foundation-governance-substrate
    provides: insert-only audit and governed plan execution
  - phase: 03.6-agent-eval-gate
    provides: version-pinned golden evaluation and activation evidence
  - phase: 07-resilience-operations-hardening
    provides: WORM export, DLQ, and notification controls
provides:
  - one canonical ISO 9001:2015 plus Amendment 1:2024 evidence-alignment map
  - bounded clause-to-control matrix with typed repository pointers and verification methods
  - explicit certification, organization-wide, live-WORM, hook, release, and corrective-action limits
affects: [24-02-corrective-action-index, governance-review, compliance-claims]

tech-stack:
  added: []
  patterns:
    - pointer-only governance index over existing evidence systems
    - closed five-status evidence vocabulary
    - typed root-agnostic repository references with symbol or section anchors

key-files:
  created:
    - docs/governance/iso-9001-conformance-map.md
  modified:
    - docs/README.md

key-decisions:
  - "The map is limited to software/product design, governed behavior release, and governed service operation; it is not certification or an organization-wide conformity finding."
  - "External WORM preservation remains conditional until dated real S3 Object Lock retention and delete-refusal evidence exists."
  - "Clause 8.6 Direct status applies only to gated candidate skill versions, never bootstrap, ungated, unpaid, failed, or merely historical versions."
  - "Clause 10.2 remains Partial until Plan 24-02 links complete corrective-action evidence chains."

patterns-established:
  - "Evidence precedence: runtime/readback, executable check, implementation/schema, dated verification, playbook/ADR, then plan/design intent."
  - "Ordinary feature changes do not churn the map when the mapped evidence mechanism is unchanged."

requirements-completed: []

duration: 40 min
completed: 2026-08-10
---

# Phase 24 Plan 01: ISO 9001 Evidence Map Foundation Summary

**One canonical, pointer-only ISO evidence map now ties the shipped audit, GSD/playbook, skill-versioning, eval-release, and DLQ controls to bounded clause intents without claiming certification.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-08-10 20:26 +03:00
- **Completed:** 2026-08-10 21:06 +03:00
- **Tasks:** 3
- **Files modified:** 2 product documentation artifacts

## Accomplishments

- Established the exact ISO 9001:2015 plus Amendment 1:2024 baseline, defined scope, five-status vocabulary, evidence hierarchy, typed pointer contract, climate disposition, and hard no-certification boundary.
- Added a 20-row, seven-column clause matrix covering every roadmap-mandated evidence family and the substantive adjacent clauses while leaving company-wide leadership, competence, internal audit, and management review honestly unassessed.
- Preserved the important anti-theater boundaries: hot insert-only audit is not live WORM, tests are not internal audit, owner checkpoints are not management review, owner authorization is not a quality policy, and a DLQ resolved flag is not corrective action.
- Added operational use guidance, tightly bounded maintenance triggers, offline verification commands, Manual-Only checks, and known limitations without adding a QMS runtime, data store, generator, mirror, dependency, or second ISO document.

## Task Commits

Each task was committed atomically:

1. **Task 1: Establish boundary, vocabulary, and discoverability** — `ecb103b` (`docs(24-01): establish ISO evidence map boundary`)
2. **Task 2: Map audit, design, change, and release evidence** — `d9ed72e` (`docs(24-01): map ISO evidence controls`)
3. **Task 3: Operationalize maintenance and verification** — `31ebbc3` (`docs(24-01): operationalize ISO evidence map`)

## Files Created/Modified

- `docs/governance/iso-9001-conformance-map.md` — canonical defined-scope evidence index, clause matrix, verification guidance, Manual-Only boundaries, and limitations.
- `docs/README.md` — compact governance-index definition and canonical-map link.

## Decisions Made

- Used one canonical Markdown map and typed pointers to the real systems of record; no duplicated audit rows, test output, incident prose, or ISO text was copied into it.
- Classified evidence by what it proves now. Direct status is always constrained to the defined mechanism; supporting and partial rows name what remains unproved.
- Deferred organization-wide readiness and certification judgments to actual company-process evidence and qualified review.
- Left GOVN-02 open because Plan 24-02 still owns the non-vacuous corrective-action evidence index and human claim-boundary gate.

## Deviations from Plan

None in delivered scope. On Windows, the package-local binary directory had to be prepended to PATH before the exact planned pnpm/Vitest command could resolve the already-installed Vitest binary; the command and test selection were otherwise unchanged.

## Issues Encountered

- A concurrent staging race initially included the already-dirty `.planning/ROADMAP.md` in Task 1. The local commit was surgically amended to exclude it while proving the ROADMAP worktree hash was byte-identical before and after; corrected commit `ecb103b` contains only the two owned documentation paths.
- The final playbook-check rerun observed a foreign, concurrent `ImportPanel.tsx` change that requires `docs/playbooks/contacts-crm.md`. Task 3's own playbook check had passed before that change. This plan did not edit or stage the foreign CRM work.

## Verification

- Map structure, baseline, discoverability, claim-boundary, clause coverage, limitation, and operational-section assertions: PASS.
- Typed repository pointer scan: 46 unique local paths resolved; no traversal, absolute, backslash, line-number, or untyped path references.
- Targeted backend controls: 5 files, 72 tests passed (`auditImmutability`, WORM, skills, dead letters, notifications).
- Golden harness offline self-check: PASS, 36 fixtures and 12 gated skills.
- Playbook freshness check: PASS at Task 3 completion; later rerun reported only the unrelated concurrent CRM change described above.

## User Setup Required

None. Real S3 Object Lock retention/delete refusal and any external conformity statement remain Manual-Only and intentionally unclaimed.

## Next Phase Readiness

- Plan 24-02 can add exactly two complete corrective-action evidence chains to the same map, run the final closed-table integrity assertion, and perform the required human claim-boundary review.
- GOVN-02 must remain pending until Plan 24-02 completes.

---
*Phase: 24-iso-9001-conformance-map*
*Completed: 2026-08-10*
