---
phase: 01-foundation-governance-substrate
plan: 10
subsystem: oauth
tags: [google-oauth, convex, playwright, token-lifecycle, governance]

requires:
  - phase: 37.1-closure-programme-integration-and-wave-0-baseline
    provides: verified Wave 1 handoff and disjoint path ownership
provides:
  - Current shared-Google-grant authorize/callback contract proven offline
  - Closed callback failure codes with token-safe browser copy
  - Deterministic Google connection readiness assertions that stop before provider navigation
  - Six-layer evidence record and fully open Wave 7 re-entry packet
affects: [wave-7-google-verification, gmail, calendar, drive, onboarding]

tech-stack:
  added: []
  patterns:
    - Closed OAuth callback codes at the server-to-browser boundary
    - Independent six-layer evidence statuses
    - Provider-boundary browser checks inspect links without following them

key-files:
  created:
    - apps/web/e2e/google-oauth-readiness.spec.ts
    - .planning/phases/01-foundation-governance-substrate/01-10-EVIDENCE.md
    - .planning/phases/01-foundation-governance-substrate/01-VERIFICATION.md
  modified:
    - packages/backend/convex/http.ts
    - packages/backend/convex/httpAuth.test.ts
    - apps/web/app/(app)/connect-gmail/page.tsx
    - apps/web/app/(app)/_components/DisconnectGoogle.tsx
    - apps/web/app/(app)/_components/reconnectBanner.test.ts
    - docs/playbooks/onboarding.md

key-decisions:
  - "Google callback redirects carry only a closed error code; provider text never reaches browser history."
  - "SC-5 remains open until deployed, live-observed, owner-accepted, and externally-enabled evidence exists."
  - "The browser readiness spec inspects the Google authorize URL but never clicks it in Wave 1A."

patterns-established:
  - "OAuth redirects: map external failures to a small closed code set and render bounded local copy."
  - "Evidence: offline-tested never implies deployed, live-observed, owner-accepted, or externally-enabled."

requirements-completed: []

duration: 37 min
completed: 2026-09-19
---

# Phase 01 Plan 10: Google OAuth Readiness Summary

**Current shared Google grant readiness is proven at repository level, with closed callback errors,
internal-only token lifecycle tests, deterministic pre-provider browser checks, and an explicit
Wave 7 external remainder.**

## Performance

- **Duration:** 37 min
- **Started:** 2026-09-19T18:29:23Z
- **Completed:** 2026-09-19T19:06:00Z
- **Tasks:** 3
- **Files changed:** 9 implementation/evidence files plus this summary

## Accomplishments

- Reconciled the authorize URL against canonical `GOOGLE_SCOPES`: Gmail modify, Calendar free/busy,
  Calendar events, and Drive read-only with offline access, forced consent, configured redirect,
  and tenant-bound signed state.
- Hardened `/gmail/callback` so provider text cannot enter browser history, while tests prove
  refusal ordering, replay/exchange refusal, token secrecy, reconnect replacement, revocation,
  local deletion, and refs-only audit.
- Added bounded loading, unavailable, callback-error, connected/reconnect, and disconnect-result
  browser surfaces plus a Playwright readiness spec that never follows the Google link.
- Published `01-10-EVIDENCE.md` and reconciled `01-VERIFICATION.md`; SC-5 remains OPEN.

## Task Commits

1. **Task 1: Reconcile and test the current Google OAuth contract** — `81b4482` (mixed-attribution
   integration commit; a shared Git-index race placed `http.ts` and `httpAuth.test.ts` in the 17.1
   lane's commit; retained intact per integration-owner instruction)
2. **Task 2: Prove the browser readiness surface** — `c6b4127`
3. **Task 3: Publish evidence and Wave 7 re-entry packet** — `2ee76a4`

## Evidence Layers

| Layer | Status |
|---|---|
| implemented | PASS — repository-controlled authorize, callback, token lifecycle, reconnect/disconnect, and UI paths. |
| offline-tested | PASS at settled install — backend 95/95, UI 13/13, both typechecks, Playwright discovery. |
| deployed | OPEN — no deployment authorized. |
| live-observed | OPEN — no provider round-trip authorized. |
| owner-accepted | OPEN — no founder browser verdict recorded. |
| externally-enabled | OPEN — Google configuration/submission/approval remains Wave 7. |

## Verification Results

- Backend targeted gate passed once in full: **2 files, 95/95 tests**.
- Focused callback/lifecycle file passed after final changes: **23/23 tests**.
- Browser-copy test passed: **13/13 tests**.
- Playwright readiness discovery passed: setup plus four Chromium readiness cases.
- Backend and web TypeScript checks passed.
- Evidence machine check passed with all required layer/status tokens.
- A later final backend rerun encountered a shared-install infrastructure error: missing
  `@workflow/serde/dist/index.js` caused the same 35 unrelated `gmail.test.ts` import failures while
  `httpAuth.test.ts` remained 23/23 green. No source failure was reported; dependency repair belongs
  to the shared integration owner and no further install was started by this lane.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Closed raw Google provider error leakage**

- **Found during:** Task 1 current-source inspection
- **Issue:** `/gmail/callback` interpolated provider error text into the browser redirect, exposing
  attacker/provider-controlled detail to history, proxies, and Referer headers.
- **Fix:** Replaced raw text with five closed callback codes and bounded UI copy; added hostile-input
  and redaction assertions.
- **Files modified:** `packages/backend/convex/http.ts`,
  `packages/backend/convex/httpAuth.test.ts`, `apps/web/app/(app)/connect-gmail/page.tsx`
- **Verification:** focused callback tests 23/23; browser-copy tests 13/13
- **Commit:** backend portion `81b4482` (mixed attribution), browser portion `c6b4127`

### Integration Deviations

- The shared Git index was committed by the parallel 17.1 lane between 01-10's exact-path stage and
  commit. The integration owner directed that `81b4482` remain intact and be cited as a
  mixed-attribution integration commit; no history rewrite or foreign revert was performed.
- Shared Graphify outputs were changed by the repository's background commit hook. This lane did
  not edit, stage, or commit them; the integration owner owns reconciliation.
- Standard GSD state, roadmap, requirements, routing, closure-ledger, and Graphify updates were
  intentionally skipped because `allowed_shared_paths` is empty and the parent integration owner
  reserved those shared paths.

**Total deviations:** 1 auto-fixed bug and 3 integration/process disclosures.<br>
**Impact:** OAuth safety and observability improved without widening scope or crossing an external boundary.

## Authentication Gates

None. No live authorization was attempted.

## Issues Encountered

- Windows `pnpm --filter ... exec` did not resolve package `.bin` shims in the shared checkout;
  the same locked Vitest and Playwright CLIs were invoked directly.
- Parallel dependency repair made the final combined rerun unstable as documented above. The full
  targeted gate had already passed 95/95 on the same source revision before the shared link changed.

## External Remainder

Every Wave 7 item is OPEN: exact candidate identity, consent-screen configuration, provider test
users, domain/policy confirmation, demo evidence, formal submission, approval receipt, live
authorize/callback/reconnect/revoke round-trip, founder verdict, and cleanup. This plan authorizes
none of those actions and does not complete SC-5.

## Next Phase Readiness

Repository-controlled work is ready for integration. Wave 7 may re-enter only with fresh exact
authorization and the checklist in `01-10-EVIDENCE.md`.

## Self-Check: PASSED

All declared created artifacts exist, and commits `81b4482`, `c6b4127`, and `2ee76a4` resolve.
