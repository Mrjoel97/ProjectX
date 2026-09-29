---
phase: 49-qualified-public-web-and-storefront-recipes
plan: 01
subsystem: design-knowledge
tags: [provenance, sha256, mit, offline-compiler, deterministic-data]
requires:
  - phase: 48-business-website-and-landing-page-runtime
    provides: closed public-web document/runtime boundary used by later recipe plans
provides:
  - immutable three-repository MIT source inventory with per-file commit/tree/blob/byte hashes
  - deterministic offline compiler and generated data-only DesignKnowledgeBundle
  - provenance verifier with manifest-only, full, and positive-control modes
affects: [phase-49-recipe-runtime, SITE-03, LAND-03, SHOP-01]
tech-stack:
  added: [Node.js crypto/fs/path, TypeScript generated data module]
  patterns: [closed allowlisted records, immutable provenance, fail-closed exclusions, canonical hashing]
key-files:
  created:
    - third_party/design-knowledge/manifest.json
    - third_party/design-knowledge/source-snapshot/
    - third_party/design-knowledge/LICENSES/
    - scripts/compile-design-knowledge.mjs
    - scripts/verify-design-knowledge-provenance.mjs
    - packages/core/src/designKnowledge.generated.ts
  modified:
    - THIRD_PARTY_NOTICES.md
key-decisions:
  - "Snapshot only the three owner-selected MIT repositories at exact immutable commits; no branch or runtime network authority is retained."
  - "Compile eight closed records, never raw upstream prose or executable instructions; reviewed source files carry explicit excluded sections."
  - "Store compiler, input, and bundle hashes in the manifest and generated header so changed bytes cannot reuse prior provenance."
requirements-completed: [SITE-03, LAND-03, SHOP-01]
duration: 12min
completed: 2026-09-21
---

# Phase 49 Plan 01: Immutable design-knowledge supply chain Summary

**Three pinned MIT design sources are preserved as byte-hashed review snapshots and compiled into an eight-record deterministic, data-only bundle with fail-closed provenance controls.**

## Performance

- **Duration:** approximately 12 minutes
- **Started:** 2026-09-21T22:53:00Z (execution start estimate)
- **Completed:** 2026-09-21T23:05:18Z
- **Tasks:** 3/3 implemented and verified
- **Files modified:** 16 snapshot/notice/compiler/generated/manifest files (plus this summary)

## Accomplishments

- Pinned UI/UX Pro Max `dcc40ff5133ef78276117db0cc34e7b83cc8aeba`, Taste Skill `5217fb45be2c0b302f29c9cd31cbd3237501c684`, and Nexscope eCommerce-Skills `ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e` with exact tree IDs, Git blob IDs, byte counts, SHA-256 hashes, and preserved MIT notices.
- Added an offline canonical compiler. The generated bundle contains 8 sorted records, input hash `cc6ba41543fec188a611c9c66c76cad1e97b46ad132374c68b33c0a43b15bec8`, and bundle hash `d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8`.
- Added positive controls proving rejection of moving refs, missing/unsupported notices, byte drift, unreviewed paths, executable/package/network instructions, prompt overrides, secret-shaped values, and Phase 50 commerce operations.

## Task Verification Evidence

- `node scripts/verify-design-knowledge-provenance.mjs --manifest-only` — PASS.
- `node scripts/verify-design-knowledge-provenance.mjs --self-test` — PASS (10 rejection controls).
- `node scripts/verify-design-knowledge-provenance.mjs` — PASS.
- `node scripts/compile-design-knowledge.mjs --check` — PASS (8 records; deterministic bundle hash above).
- `node --check scripts/compile-design-knowledge.mjs` and verifier — PASS.
- `node scripts/extract-convex-edges.mjs` — PASS (no output/error).

## Task Commits

Git is not installed or available on PATH in this environment (`git --version` failed), so atomic task commits and a metadata commit could not be created without fabricating SHAs. All requested files and evidence are present in the shared working tree; the parent executor should commit them when Git is available.

## Files Created/Modified

- `third_party/design-knowledge/manifest.json` — exact repository, commit/tree, license, source-file, disposition, record, and compiler-hash inventory.
- `third_party/design-knowledge/source-snapshot/` — reviewed immutable source bytes, including license copies.
- `third_party/design-knowledge/LICENSES/` — unchanged MIT notices for redistribution.
- `scripts/compile-design-knowledge.mjs` — offline canonical compiler and deterministic check.
- `scripts/verify-design-knowledge-provenance.mjs` — manifest/full verifier and positive controls.
- `packages/core/src/designKnowledge.generated.ts` — generated stable data-only bundle.
- `THIRD_PARTY_NOTICES.md` — attribution and modification/exclusion notice.

## Decisions Made

The compiler accepts only manifest records whose source references are explicitly reviewed and allowlisted. Raw skill Markdown is retained for review provenance but its install, network, prompt, tool, secret, and commerce sections are marked excluded and never parsed into runtime output. No production updater, network call, provider/model call, or storefront enablement was added.

## Deviations from Plan

### Tooling limitations

1. Git was unavailable, so no commits could be created or verified. No SHA was fabricated.
2. Biome was unavailable (`pnpm exec biome` reported the binary missing); Node syntax checks and all plan-specific gates passed, but repository formatting could not be run.
3. `graphify update .` completed AST extraction but hung during post-processing under the known Windows resource limitation; it was interrupted after bounded retries. A `graphify update . --no-cluster` retry reached the same post-extraction hang and was interrupted. `node scripts/extract-convex-edges.mjs` ran successfully afterward. No production/runtime claim depends on graph output.

## Issues Encountered

The only issues were environment tooling limitations above. The provenance, compiler, positive-control, generated-output, and edge-extraction gates are green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The next Phase 49 plans can consume `designKnowledge.generated.ts` and the manifest as offline,
data-only inputs. This plan does not clear Wave 7 registered-entity/domain/provider/merchant facts
or Wave 8 founder acceptance; no production storefront or commerce path is enabled.

## Self-Check: PASSED (file and gate checks; commit checks unavailable)

- `49-01-SUMMARY.md`, manifest, compiler, verifier, generated module, snapshots, and notices exist.
- Manifest-only, full provenance, positive-control, compiler determinism, syntax, and edge extraction checks passed.
- Commit existence could not be checked because Git is unavailable; this is recorded above.

## Consolidated Correction Cycle (root acceptance)

- Added exact Git blob SHA-1 validation over `blob <byteLength>\0 + snapshotBytes`, with a positive-control mutation.
- Added normalized relative-path and containment checks for every snapshot and redistributed-license path, including traversal/absolute/separator rejection controls.
- Added exact `sourceEvidence` byte slices (`byteStart`, `byteEnd`, SHA-256) to every compiled record; evidence is validated against the immutable snapshot but omitted from generated runtime data. Positive controls cover drift and removal.
- Enforced all `designProfile` dials (`variance`, `motion`, `density`) and `tasteDial` values in the closed 1..10 range, with lower/upper-bound rejection controls.
- Updated compiler hash: `1bc4fd5816563fb9195f3f47cf30eb04d2e3c2734b0db7b4b355aff12272b8f5`.
- Updated compiled input hash: `cc6ba41543fec188a611c9c66c76cad1e97b46ad132374c68b33c0a43b15bec8`.
- Updated compiled bundle hash: `d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8`.
- Correction-cycle commands all passed: manifest-only verifier, self-test verifier, full verifier, compiler `--check`, both Node syntax checks, and `node scripts/extract-convex-edges.mjs`. The known hanging `graphify update .` was not retried.

## Final Provenance Boundary Correction

- Redistributed notices now require the exact normalized prefix `third_party/design-knowledge/LICENSES/<filename>`; a valid snapshot path/hash substituted as a license path is rejected.
- Every source-evidence pair must also occur in the same record's `sourceRefs`; a cross-record evidence substitution is rejected.
- Final compiler hash is `1bc4fd5816563fb9195f3f47cf30eb04d2e3c2734b0db7b4b355aff12272b8f5`, with input `cc6ba41543fec188a611c9c66c76cad1e97b46ad132374c68b33c0a43b15bec8` and bundle `d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8`.
- Final narrow checks passed: verifier self-test, full provenance, compiler `--check`, and both Node syntax checks. Graphify was not rerun.

---
*Phase: 49-qualified-public-web-and-storefront-recipes*
*Completed: 2026-09-21*
