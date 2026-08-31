---
phase: 28-connector-backed-revenue-pack
plan: 14
subsystem: skill-registry
tags: [revenue, skill-bodies, provenance, sha256, provider-neutral]
requires:
  - phase: 27-curated-knowledge-work-pack-pilot
    provides: Apache-2.0 attribution, pinned upstream source, and modification-notice contract
  - phase: 28-connector-backed-revenue-pack
    provides: typed revenue workflow result and approval boundaries from plans 28-11 through 28-13
provides:
  - Eight provider-neutral revenue workflow bodies ready for separate dark-candidate publication
  - Exact LF-normalized UTF-8 byte and SHA-256 pins for every body
  - Non-vacuous provenance, authority, deterministic-finance, and approval-terminal tests
affects: [28-28, 28-19, 28-20]
tech-stack:
  added: []
  patterns:
    - Canonical markdown bodies are reviewed and byte-pinned before candidate publication
    - Skill prose explains typed results but cannot grant tools, configuration, or write authority
key-files:
  created:
    - packages/contracts/skills/revenue-specialist.md
    - packages/contracts/skills/revenue-lead-triage.md
    - packages/contracts/skills/revenue-call-list.md
    - packages/contracts/skills/revenue-pipeline-review.md
    - packages/contracts/skills/revenue-customer-pulse.md
    - packages/contracts/skills/revenue-cash-flow.md
    - packages/contracts/skills/revenue-payroll-confidence.md
    - packages/contracts/skills/revenue-invoice-reminder.md
  modified:
    - packages/contracts/src/skills/skillBodies.test.ts
key-decisions:
  - "Preserved the existing body prose because every semantic contract test already passed before byte pins were finalized."
  - "Kept registry publication, discovery, evaluation, and activation entirely out of plan 28-14."
  - "Pinned both normalized byte count and SHA-256, plus the exact upstream source paths named by each body."
patterns-established:
  - "Reviewed-body boundary: canonical prose first, normalized byte/hash pin second, dark candidate publication later."
  - "Provider-neutral body boundary: provider data is untrusted input; code owns ordering, arithmetic, approval, and availability."
requirements-completed: [REVN-04, REVN-05, REVN-06]
duration: 9min
completed: 2026-08-31
---

# Phase 28 Plan 14: Provider-Neutral Revenue Bodies Summary

**Eight attributable revenue bodies now explain bounded code-owned results without acquiring provider, tool, calculation, delivery, publication, or activation authority.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-31T10:41:05Z
- **Completed:** 2026-08-31T10:50:00Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Adopted the eight pre-existing untracked markdown bodies without discarding their good content.
- Finalized exact LF-normalized UTF-8 byte counts and SHA-256 pins for all eight bodies.
- Made provenance checks explicit per body: pinned upstream commit, Apache-2.0, modification notice,
  and the exact upstream skill path or paths used.
- Proved provider neutrality and absence of authority-bearing configuration, formula constants, tool
  grants, and candidate publication/discovery/activation language.
- Preserved code-owned deterministic finance and the existing proposed-plan, human-approval, consent,
  and suppression terminal for invoice reminders.

## Task Commit

1. **Task 1: Author byte-pinned provider-neutral candidate bodies** - `29199b1` (feat)

## Candidate Body Pins and Provenance

These are reviewed **body pins**, ready for plan 28-28 to publish as dark candidates. Plan 28-14 did
not create a registry row or make any workflow discoverable.

| Body | LF UTF-8 bytes | SHA-256 | Attributed upstream source |
|---|---:|---|---|
| `revenue-specialist` | 2192 | `558cca103e7c298472a7d9f1ff4cd48651c4b08388f4ebadb2dd0ff63c082b24` | `small-business/skills/business-pulse`; `sales/skills/call-prep` |
| `revenue-lead-triage` | 1658 | `640c210f6fff276a32dbcdfd0093e984452b2264b09db1e7683547823734c9f8` | `sales/skills/call-prep` |
| `revenue-call-list` | 1468 | `36e760292676ad2a8881cf9d712e78ea595d7f1d9150bbe8a58576d648346c3d` | `sales/skills/call-prep` |
| `revenue-pipeline-review` | 1535 | `a64656d37a59c49f3dae91a2b31281673c509249e0ad467f7569766d08920ece` | `sales/skills/call-prep` |
| `revenue-customer-pulse` | 1586 | `258145d3f7a377d3a605524428b6771c5712eb0d9a55112a312abcdc89732300` | `small-business/skills/business-pulse` |
| `revenue-cash-flow` | 1680 | `327b4fbfb72e07ddea5765d9e8d6a3ae5bebafd10e29735ea4228a6942829ae9` | `small-business/skills/business-pulse` |
| `revenue-payroll-confidence` | 1740 | `f5dcd1736b4b4014b328d58fc77aaa1d9359c9e351e2898bf940687e4d98e80c` | `small-business/skills/business-pulse` |
| `revenue-invoice-reminder` | 1771 | `2541cadb10404c34b0f08ca85fb17f43a810fe8dab86d5ee43d3582ae6b91899` | `small-business/skills/business-pulse`; `small-business/skills/ticket-deflector` |

Every body names upstream commit `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`, Apache-2.0,
attribution, and a prominent provider-neutral modification notice.

## Byte-Parity Evidence

`skillBodies.test.ts` reads each canonical markdown file, normalizes CRLF to LF, then checks both its
exact UTF-8 byte count and SHA-256. The RED baseline produced exactly eight failures because all pins
were the all-zero placeholder; the other semantic rows were already green. After review, the real
pins above made the same suite pass 46/46. This proves the tests are not satisfied by file presence
or a non-empty string.

## Decisions Made

- Existing prose was preserved: all provider-neutral, provenance, finance, and approval semantics
  passed before the pins were changed, so rewriting would have added review risk without adding a
  guarantee.
- Registry behavior stays serialized: plan 28-28 owns publication, 28-19 owns evaluation, and 28-20
  owns activation. These bodies contain no lifecycle instruction and this plan touched no registry.
- Finance bodies explain immutable results and refuse arithmetic; the invoice body ends at an
  ordinary proposed email plan and explicitly leaves delivery to the existing approval terminal.

## Deviations from Plan

None - plan executed exactly as written. The dependency on 28-13 was intentionally overlapped by the
owner; the bodies remain provider-neutral and authority-free, so no runtime detail from that plan was
required or assumed.

## Issues Encountered

- The repository-level `biome` binary was not available through `pnpm exec`. This plan's required
  Vitest gate, contracts TypeScript gate, and `git diff --check` all passed; no formatting mutation
  was needed.

## Verification

| Gate | Result |
|---|---|
| RED baseline: `pnpm --filter @pikar/contracts test -- skillBodies` | **8 failed / 38 passed**, only all-zero SHA pins failed |
| GREEN: `pnpm --filter @pikar/contracts test -- skillBodies` | **46/46 passed** |
| `pnpm --filter @pikar/contracts typecheck` | **exit 0** |
| `git diff --cached --check` before task commit | **exit 0** |
| Scoped task commit | `29199b1` contains exactly the eight bodies and `skillBodies.test.ts` |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 28-28 can consume the exact body pins above for separate, candidate-only publication.
- Plans 28-19 and 28-20 remain the only eval and activation paths; nothing here is active or
  discoverable.
- No provider credentials, endpoints, grants, formulas, or runtime implementation details were
  introduced by the body layer.

## Self-Check: PASSED

- All eight canonical body files — FOUND
- `packages/contracts/src/skills/skillBodies.test.ts` — FOUND
- `.planning/phases/28-connector-backed-revenue-pack/28-14-SUMMARY.md` — FOUND
- Task commit `29199b1` — FOUND
- Roadmap count and 28-14 completion row — FOUND

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-31*
