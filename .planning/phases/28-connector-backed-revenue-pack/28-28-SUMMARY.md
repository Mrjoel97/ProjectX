---
phase: 28-connector-backed-revenue-pack
plan: 28
subsystem: skill-registry
tags: [revenue, candidates, provenance, sha256, dark-publication]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: Eight reviewed provider-neutral revenue bodies and their LF byte pins from plan 28-14
  - phase: 27-curated-knowledge-work-pack-pilot
    provides: Candidate-only publication, immutable provenance, and activation-gate patterns
provides:
  - Eight exact v1 revenue candidate pins with byte, hash, version, and provenance identity
  - Candidate-only publication and content-free read-back with no seed, grant, or discovery widening
  - Existing exact-version eval gate extended to every lock-listed revenue candidate
affects: [28-19, 28-20]
tech-stack:
  added: []
  patterns:
    - A code-owned lock manifest is validated against the runtime body before candidate insertion
    - Exact duplicate publication is idempotent; every version or byte conflict fails closed
key-files:
  created:
    - packages/contracts/src/skills/revenueBodies.ts
    - scripts/generate-revenue-skill-bodies.mjs
  modified:
    - packages/backend/convex/skills.ts
    - packages/backend/skills-lock.json
    - packages/backend/convex/skills.test.ts
    - packages/contracts/src/skills/skillBodies.test.ts
    - docs/playbooks/skill-registry.md
key-decisions:
  - "Revenue publication uses one exact lock-listed v1 candidate per body and refuses to allocate around drift."
  - "Revenue names stay outside SEEDS and ordinary discovery; the global activation choke point eval-gates them by lock membership."
  - "Canonical markdown remains the reviewed source while one generated aggregate supplies byte-identical runtime strings to Convex."
requirements-completed: [REVN-04, REVN-05, REVN-06]
duration: 11min
completed: 2026-09-01
---

# Phase 28 Plan 28: Byte-Pinned Revenue Candidate Publication Summary

**Eight reviewed revenue bodies now have immutable, attributable v1 candidate rows that remain undiscoverable and cannot pass the existing activation choke point without exact-version eval evidence.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-31T21:33:00Z
- **Completed:** 2026-08-31T21:43:15Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments

- Added eight candidate-only manifest entries fixing name, version, status, LF UTF-8 bytes,
  SHA-256, source repo/commit/paths, Apache-2.0 license, and modification notice.
- Added `seedRevenueCandidates`, which validates runtime bytes before insert, writes only
  `status: "candidate"`, treats the one exact v1 row as an idempotent duplicate, and refuses every
  pre-existing version/body/provenance conflict.
- Kept revenue rows out of `SEEDS` and ordinary `loadSkill` discovery, and added a content-free
  `inspectRevenueCandidates` read-back for exact candidate refs.
- Extended the existing global activation gate to lock-listed revenue names, so an unevaluated
  candidate cannot be activated through either internal or owner-facing global activation.
- Generated a single runtime body bundle from the reviewed markdown and proved all eight strings
  remain byte-identical to the canonical files.

## Task Commits

1. **RED: exact candidate pin, isolation, refusal, and gate tests** - `2fc8420` (test)
2. **GREEN: candidate manifest, publisher, read-back, and activation gate** - `89b4776` (feat)

## Exact Candidate Pins

| Candidate | Version | LF bytes | SHA-256 |
|---|---:|---:|---|
| `revenue-specialist` | 1 | 2192 | `558cca103e7c298472a7d9f1ff4cd48651c4b08388f4ebadb2dd0ff63c082b24` |
| `revenue-lead-triage` | 1 | 1658 | `640c210f6fff276a32dbcdfd0093e984452b2264b09db1e7683547823734c9f8` |
| `revenue-call-list` | 1 | 1468 | `36e760292676ad2a8881cf9d712e78ea595d7f1d9150bbe8a58576d648346c3d` |
| `revenue-pipeline-review` | 1 | 1535 | `a64656d37a59c49f3dae91a2b31281673c509249e0ad467f7569766d08920ece` |
| `revenue-customer-pulse` | 1 | 1586 | `258145d3f7a377d3a605524428b6771c5712eb0d9a55112a312abcdc89732300` |
| `revenue-cash-flow` | 1 | 1680 | `327b4fbfb72e07ddea5765d9e8d6a3ae5bebafd10e29735ea4228a6942829ae9` |
| `revenue-payroll-confidence` | 1 | 1740 | `f5dcd1736b4b4014b328d58fc77aaa1d9359c9e351e2898bf940687e4d98e80c` |
| `revenue-invoice-reminder` | 1 | 1771 | `2541cadb10404c34b0f08ca85fb17f43a810fe8dab86d5ee43d3582ae6b91899` |

All eight entries pin upstream commit `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`,
Apache-2.0, exact upstream paths, and a non-empty modification notice.

## Candidate Isolation

- `seedSkills` creates zero revenue rows; routine dev boot cannot publish or activate them.
- Publication accepts no body, version, status, grant, discovery, or provenance arguments.
- Every inserted row is `candidate`; no branch contains an active-state write or activation call.
- `loadSkill` throws `NO_ACTIVE_SKILL` for every published candidate.
- Direct activation without exact passing evidence throws `EVAL_GATE`.
- Read-back exposes only id, name, version, status, bytes/hash, and provenance validity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a generated runtime body bundle**

- **Found during:** Task 1
- **Issue:** The plan named canonical markdown and the Convex publisher, but Convex cannot read the
  filesystem at runtime and no derived revenue body constants existed.
- **Fix:** Added one generated aggregate module plus a deterministic generator; the contract test
  compares every generated string to the LF-normalized canonical markdown.
- **Files modified:** `packages/contracts/src/skills/revenueBodies.ts`,
  `scripts/generate-revenue-skill-bodies.mjs`, `packages/contracts/src/skills/skillBodies.test.ts`
- **Verification:** Contract body suite 47/47 and both package typechecks passed.
- **Commit:** `89b4776`

**Total deviations:** 1 auto-fixed (1 blocking issue). **Impact:** Required runtime packaging only;
it added no authority or lifecycle transition.

## Issues Encountered

- The first drift-refusal test nested a `convex-test` harness call inside `t.run`, causing a 20 s
  timeout. The test now queries through its existing transaction context; the suite reran 143/143.
- The repository declares Biome but this checkout has no runnable `biome` binary (`'biome' is not
  recognized`). Scoped `git diff --check`, both TypeScript gates, both plan suites, and the playbook
  gate passed. This is the same local tooling limitation recorded by plan 28-14.
- `graphify-out/*` was already dirty shared work and explicitly excluded from this plan; no graph
  rebuild output was staged or overwritten.

## Verification

| Gate | Result |
|---|---|
| RED: contracts `skillBodies` | Failed: missing `revenueBodies` runtime bundle |
| RED: backend `skills` | Failed: missing candidate publisher/runtime bundle |
| `pnpm --filter @pikar/contracts test -- skillBodies` | **47/47 passed** |
| `pnpm --filter @pikar/backend test -- skills` | **143/143 passed** |
| `pnpm --filter @pikar/contracts typecheck` | **exit 0** |
| `pnpm --filter @pikar/backend typecheck` | **exit 0** |
| `node scripts/check-playbooks.mjs` | **exit 0** |
| `git diff --check` | **exit 0 for scoped work** |

## Authentication Gates

None. No live deployment, provider, activation, or paid-evaluation operation was attempted.

## User Setup Required

None - candidate publication is code-owned and remains inert pending plans 28-19 and 28-20.

## Next Phase Readiness

- Plan 28-19 can read the eight exact candidate refs and produce version-specific diagnostic/eval
  evidence without activation.
- Plan 28-20 remains the only owner-judgment and activation plan; every candidate is dark until then.
- No candidate was inserted into a live deployment by this plan; the committed mutation and tests
  define the publication contract without running `npx convex run`.

## Self-Check: PASSED

- `packages/backend/skills-lock.json` contains exactly eight revenue candidates — FOUND
- `packages/contracts/src/skills/revenueBodies.ts` — FOUND
- `.planning/phases/28-connector-backed-revenue-pack/28-28-SUMMARY.md` — FOUND
- RED commit `2fc8420` — FOUND
- GREEN commit `89b4776` — FOUND
- Roadmap 28-28 completion row — FOUND
- No `STATE.md` or `REQUIREMENTS.md` edit — VERIFIED

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
