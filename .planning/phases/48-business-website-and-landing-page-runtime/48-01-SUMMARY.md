---
phase: 48-business-website-and-landing-page-runtime
plan: 01
subsystem: contracts
tags: [web-runtime, renderer, ast, validation, hashing, cta]

requires:
  - phase: 19-contacts-and-consent
    provides: consent and suppression semantics consumed by later public-form adapters
provides:
  - closed bounded site/landing document AST and lifecycle/routing/form/metric contracts
  - portable deterministic UTF-8 HTML renderer with escaped text and safe CTA POST wiring
  - canonical renderer bytes and stable sha256 hash material
affects: [48-02, 48-03, 48-04, 48-05, 48-06, phase-49]

tech-stack:
  added: []
  patterns: [closed-union-contracts, pure-validation, deterministic-rendering, no-javascript-cta]

key-files:
  created:
    - packages/contracts/src/webRuntime.ts
    - packages/core/src/webRuntime.ts
    - packages/core/src/webRuntime.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/core/src/index.ts
    - packages/core/package.json

key-decisions:
  - "Use one bounded AST for site and landing projects; arbitrary HTML, scripts, handlers, iframes, unsafe URLs and provider/request data are excluded at validation."
  - "Render analytics CTAs as no-JavaScript POST forms whose action is derived only from validated slug/page/CTA ids."
  - "Use a pure synchronous SHA-256 implementation over renderer-version-prefixed canonical UTF-8 bytes so core remains framework and runtime portable."

patterns-established:
  - "Validation returns closed error codes and rejects unknown fields, duplicate routes/ids, unsafe URLs, depth, node, URL and size overages."
  - "Renderer fixes HTML tag/attribute ordering and escapes all text; only validated local paths or https targets are emitted."

requirements-completed: [SITE-01, SITE-02, LAND-01, LAND-02]

duration: 35min
completed: 2026-09-21
---

# Phase 48 Plan 01: Business Website and Landing Runtime Summary

One shared closed document contract and deterministic renderer now support both multi-page sites and campaign landing pages, with stable escaped bytes/hashes and safely connected rendered CTA forms.

## Tasks completed

1. Added `@pikar/contracts` workspace linkage and exported the closed Phase 48 contract: project/lifecycle/public-read/form/metric unions, hosting/source posture, bounded AST, retention constants, safe outcomes and explicit limits.
2. Implemented pure validation, canonical serialization, HTML rendering, UTF-8 byte output, renderer identity and SHA-256 hash material in `packages/core/src/webRuntime.ts`.
3. Added adversarial and mutation-oriented Vitest coverage for both fixtures, hostile executable/URL input, escaping, deterministic bytes/hash, renderer-version changes, duplicate ids/routes and bounds. The rendered analytics CTA is asserted as a no-JavaScript POST form to `/p/:slug/:page/cta/:ctaId`.

## Verification

- Passed direct TypeScript 5.9.3 checks for both contract files and the new core runtime source with strict/bundler options.
- Passed Node 24 strip-types self-check covering site and landing validation, repeated bytes, stable `sha256:` hashes, escaped/POST renderer output and hostile input rejection.
- `node scripts/extract-convex-edges.mjs` completed successfully.
- Required `pnpm --filter @pikar/contracts typecheck`, `pnpm --filter @pikar/core typecheck`, and Vitest commands could not execute because the repository's `node_modules` was already incomplete: Vitest's internal package links and the `tsc`/`vitest` workspace binaries are unavailable. An offline pnpm repair was attempted but required a missing cached Biome tarball; the escalated forceful install request was rejected. No external dependency was added.
- `graphify update .` was attempted but did not complete in the bounded verification window; it was stopped to avoid repeated full rebuilds. Edge extraction did complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repaired stale workspace linkage for isolated checks**
- **Found during:** Task 1 verification
- **Issue:** `@pikar/contracts` was not linked under `packages/core/node_modules`, preventing direct resolution after the planned package dependency was added.
- **Fix:** Created a local workspace junction under `packages/core/node_modules` for verification only; no external package or source dependency was introduced.
- **Files modified:** node_modules workspace link (ignored/generated)
- **Verification:** strict direct TypeScript check passed.
- **Commit:** unavailable (git executable is not installed).

**2. [Rule 3 - Blocking] Kept verification portable when Node type declarations were unavailable**
- **Found during:** Task 2 implementation
- **Issue:** The incomplete workspace lacked Node type declarations and the Vitest binary; importing `node:crypto` would make the pure core source untypecheckable in the available environment.
- **Fix:** Implemented synchronous SHA-256 over canonical bytes in the pure runtime, avoiding a Node-only dependency while preserving the required hash format.
- **Files modified:** packages/core/src/webRuntime.ts
- **Verification:** direct strict TypeScript check and Node self-check passed.
- **Commit:** unavailable (git executable is not installed).

**Total deviations:** 2 auto-fixed (blocking verification/environment issues). **Impact:** source remains dependency-free and portable; the normal pnpm/Vitest gate remains pending a healthy install.

## Authentication Gates

None.

## Issues Encountered

Git is unavailable in the execution environment, so per-task and metadata commits could not be created. The parent executor should preserve this limitation in phase-level reconciliation rather than fabricating hashes.

## Self-Check: PASSED

- All three planned source/test files and the summary exist.
- Strict direct TypeScript verification and the deterministic Node self-check passed.
- Edge extraction completed.
- Commit-hash verification is not applicable because `git` is not installed in this environment; this is recorded above under Issues Encountered.
