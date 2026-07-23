---
phase: 08-self-improvement
plan: 04
subsystem: backend
tags: [convex, http, pii, skillopt, export, IMPR-02]

# Dependency graph
requires:
  - phase: 08-self-improvement
    provides: feedback table + requests.skillVersion attribution (Plan 01 schema, Plan 02 capture)
  - phase: grdl (guardrails)
    provides: packages/pii scanText — deterministic fail-closed structured-PII scrub
provides:
  - skilloptExport.ts — buildTrajectoryExport internalQuery (scrubbed, scored, split trajectory JSON)
  - http.ts GET /skillopt/export — authenticated (SKILLOPT_TOKEN bearer) export seam the CI SkillOpt job pulls
affects: [08-07 Python dataloader.py (consumes the export JSON contract verbatim), 08-08 phase close/dry-run + playbook §9 sweep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SEPARATE PII-scrubbed export plane (CLAUDE.md §4): real bodies+comments scrubbed via packages/pii AT the boundary, emit safeText+counts only — distinct from the refs-only audit log"
    - "Fail-closed export: any scan Err DROPS the whole trajectory (never ship partially-scrubbed text) — reuses the intake.ts PII_POISON:: sentinel to exercise the real scanText Err branch in a unit test"
    - "Deterministic hash split: FNV-1a(requestId) % 5 → train/valid, stable across runs (the optimizer-never-sees-valid partition, RESEARCH held-out §)"
    - "Shared-secret bearer auth on an httpAction (owner's own deployment; CI holds SKILLOPT_TOKEN) — fail-closed 401 on unset token OR mismatch"

key-files:
  created:
    - packages/backend/convex/skilloptExport.ts
    - packages/backend/convex/skilloptExport.test.ts
  modified:
    - packages/backend/convex/http.ts

key-decisions:
  - "The export reads only feedback→request rows (never the in-repo golden eval-cases/*.json) — the golden set stays the truly-independent gate the optimizer structurally cannot see (RESEARCH anti-pattern)"
  - "names-in-prose is an ACCEPTED beta ceiling (packages/pii scrubs STRUCTURED PII only) — ponytail-flagged at the scrub site as a HARD BLOCKER before Phase 9 multi-user; do NOT ship this export cross-tenant until closed"
  - "comment (the feedback 'why') is scrubbed and appended as a trailing user turn in conversation — reflect() gets the rationale; its scan Err still drops the trajectory (fail-closed)"
  - "each item carries per-type redaction counts (safeText + counts, the only log-safe scan summary) beside the pinned contract fields"

requirements-completed: []
requirements-contributed: [IMPR-02]

# Metrics
duration: ~15min (across a weekly-limit interruption)
completed: 2026-07-24
---

# Phase 8 Plan 04: Trajectory Export (PII-scrubbed) Summary

**The SEPARATE, PII-scrubbed trajectory export plane: `buildTrajectoryExport` joins every feedback row to its request, scrubs goal/body/comment through `packages/pii` (emit safeText+counts only), scores rating→hard, assigns a deterministic FNV-1a train/valid split, and DROPS any trajectory whose scan errs — served over an authenticated `GET /skillopt/export` the CI SkillOpt job pulls.**

## Performance

- **Duration:** ~15 min (spanning a weekly-limit reset)
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `skilloptExport.ts` — `buildTrajectoryExport` internalQuery (args `{ skillName?: "cockpit-agent" }`): reads feedback via the `by_skill` index, joins each to its `requests` row, and for each **scrubs goal + delivered body (`editedBody ?? draft ?? ""`) + optional comment** through `scanText`. Emits ONLY `.safeText` + aggregated per-type `.counts` — raw values never leave. **Fail-closed:** any `scanText` Err on any field → `continue` (the whole trajectory is dropped; a half-scrubbed export is a leak). `hard = rating==="up" ? 1 : 0`; `split = FNV-1a(requestId) % 5 === 0 ? "valid" : "train"` (deterministic, ~1/5 valid). Unattributable trajectories (no request / no `skillVersion`) are skipped. Output shape is the pinned EXPORT JSON CONTRACT the Plan 07 Python `dataloader.py` consumes verbatim.
- `http.ts` — `GET /skillopt/export` route on the existing `httpRouter` (Gmail callback untouched): requires `Authorization: Bearer <SKILLOPT_TOKEN>`; a missing token OR a mismatch returns `401` fail-closed; on auth OK it runs `buildTrajectoryExport` and returns `Response.json(data)`.
- **names-in-prose ceiling ponytail-flagged** at the scrub site: `packages/pii` is structured-PII-only (emails, Luhn cards, US SSNs, phones) — person names typed into prose survive. Marked an accepted solo-owner/own-tenant beta ceiling and a **HARD BLOCKER before Phase 9 multi-user** (needs NER/Presidio first).

## Task Commits

1. **Task 1 RED: failing trajectory-export test** — `32b89f4` (test)
2. **Task 1 GREEN: buildTrajectoryExport (scrub/score/split, fail-closed)** — `2741dcb` (feat)
3. **Task 2: authenticated GET /skillopt/export route** — `5935340` (feat)

_TDD: Task 1 was RED (5 failing — module missing) → GREEN (5/5). No refactor (the implementation is already minimal). Task 2 was code-first (a thin httpAction over the query)._

## Files Created/Modified
- `packages/backend/convex/skilloptExport.ts` — `buildTrajectoryExport` internalQuery; `scrub()` helper (reuses the `PII_POISON::` sentinel to route into scanText's real Err branch); 6-line FNV-1a `hashString` for the split; the names-in-prose ceiling comment at the scrub site.
- `packages/backend/convex/skilloptExport.test.ts` — 5 cases: PII scrub firewall (no raw email/SSN/phone in output + counts reflect it), rating→hard, fail-closed drop of a `PII_POISON::` trajectory, deterministic split stable across runs, unattributable skip.
- `packages/backend/convex/http.ts` — the authenticated `GET /skillopt/export` route.

## Decisions Made
- **Export source is feedback→request rows only** — the in-repo golden `eval-cases/*.json` is NEVER an export source, keeping it the independent gate the optimizer cannot overfit (RESEARCH anti-pattern / held-out partitioning §).
- **Fail-closed drop over partial redaction** — one un-scrubbable field drops the entire trajectory rather than shipping any raw text. Verified by the `PII_POISON::` drop test.
- **comment appended as a trailing scrubbed user turn** — gives `reflect()` the "why" without a bespoke field; still gated by the fail-closed scan.
- **Shared-secret bearer auth, not OAuth** — the owner's own deployment; the CI job holds `SKILLOPT_TOKEN`. Fail-closed when the token is unset (never accidentally open).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. One additive detail beyond the pinned contract skeleton: each item carries per-type `counts` (the plan's "emit safeText + counts" requirement) and the scrubbed comment rides as a trailing conversation turn.

## Issues Encountered
- **Weekly-limit interruption** mid-plan (after Task 1 committed + Task 2 written-but-uncommitted). Resumed cleanly: env restored (convex dev on :3210 with fresh codegen), Task 2 typecheck + commit finished from the exact resume point.
- **Pre-existing non-regressions** (untouched here): the `lib/functions.ts:25` TS2322 (documented 08-01) and the test-file `import.meta.glob` tsc noise — my two source files add zero new errors.

## Verification
- `pnpm --filter @pikar/backend test skilloptExport` → **5/5 green**.
- Backend source `tsc --noEmit` → my source files (`skilloptExport.ts`, `http.ts`) add **no** new errors (only the pre-existing `lib/functions.ts:25` + test-file glob noise remain).
- A seeded email (`a@b.com`), SSN (`555-12-3456`), and phone (`555-123-4567`) in goal/body/comment are **ABSENT** from the serialized export (asserted by test); counts reflect the redaction.

## User Setup Required
- **`SKILLOPT_TOKEN`** must be set in the Convex deployment env (`npx convex env set SKILLOPT_TOKEN <secret>` from `packages/backend`) before the CI job can pull `/skillopt/export`. Until set, the route is fail-closed (every call → 401). This is exercised end-to-end in the Plan 08 dry-run.

## Next Phase Readiness
- The Convex/TS export seam is fully pinned and testable independent of the Python side. Plan 07's `dataloader.py` consumes the EXPORT JSON CONTRACT verbatim; Plan 08's dry-run hits `/skillopt/export` with a real token and greps the output for raw PII.
- **Playbook/watch.json for all of Phase 8 remain centralized in Plan 08-08** (deliberately untouched here — the check-playbooks hook self-clears on the second stop). The names-in-prose ceiling is flagged at the scrub site now; the playbook note lands in 08-08.

## Self-Check: PASSED

All created files exist (skilloptExport.ts, skilloptExport.test.ts) and all three task commits (32b89f4, 2741dcb, 5935340) are present in git history.

---
*Phase: 08-self-improvement*
*Completed: 2026-07-24*
