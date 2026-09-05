---
phase: 28-connector-backed-revenue-pack
plan: 16
subsystem: revenue-release-gates
tags: [revenue, provider-gates, playwright, responsive, release-evidence]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: Independently judged provider lanes, byte-pinned workflow candidates, active skill pins, and privacy-safe terminal telemetry
provides:
  - Server-owned independent revenue workflow discovery over passed provider lanes and exact active pins
  - Authenticated desktop, tablet, and mobile evidence for the current all-parked exposure state
  - Exhaustive provider-to-REVN completion matrix with separate report, current-state, and strict close modes
affects: [28-27, revenue-operations, connector-playbooks, private-beta-release]
tech-stack:
  added: []
  patterns: [server-owned exposure projection, positive settle marker, single-context responsive auth, strict provider-composed completion]
key-files:
  created:
    - apps/web/app/(app)/dashboard/workspace/RevenuePackPanel.tsx
    - apps/web/app/(app)/dashboard/workspace/RevenuePackPanel.test.tsx
    - apps/web/e2e/revenue-pack.spec.ts
  modified:
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - packages/backend/convex/providerGates.ts
    - packages/backend/convex/providerGates.test.ts
    - scripts/check-phase28-completion.mjs
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/cockpit.md
key-decisions:
  - "Discovery is projected only by current server-owned passed gates intersected with exact active workflow and runtime pins; modules, docs and credentials never imply availability."
  - "Desktop, tablet and mobile evidence reuses one authenticated browser context because Convex Auth refresh tokens rotate and cannot safely be raced from one storageState."
  - "Subset exposure and phase completion are separate: only all four passed provider lanes can complete Phase 28 or any provider-composed REVN requirement."
  - "REVN-01 through REVN-06 remain pending because every current production lane is parked/hidden."
patterns-established:
  - "Hidden-provider assertions wait for a server settle marker or an independent connected-service settle signal before asserting absence."
  - "Completion self-tests exhaust all 16 pass/park combinations and separately refuse parked, expired, failed and unreachable lanes."
requirements-completed: []
requirements-blocked: [REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06]
duration: 2h active across two sessions
completed: 2026-09-02
---

# Phase 28 Plan 16: Controlled Revenue Exposure Summary

**Revenue workflows now appear only from server-owned passed evidence and exact active pins, while an authenticated responsive gate and exhaustive strict matrix prove the current all-parked subset remains hidden and Phase 28 remains incomplete.**

## Performance

- **Duration:** approximately 2 hours active across an interrupted two-session execution
- **Started:** 2026-09-01T15:52:36Z
- **Completed:** 2026-09-01T21:46:42Z
- **Tasks:** 3
- **Plan-owned files created/modified:** 12, plus 6 verification-deviation files

## Accomplishments

- Added a tenant-scoped `revenueDiscovery` projection that composes current passed provider gates with the exact active workflow pin and active `revenue-specialist` pin. A later recorded lane failure removes the affected offer on the next query without affecting other providers.
- Rendered independently available PLAN/REPORT offers in the existing Phase 27 workspace surface and added a hidden positive settle marker so an empty provider set can be tested without a vacuous first-paint assertion.
- Ran one real signed-in browser context across 1440×960, 820×1180, and 390×844. The workspace exposed no revenue offers and Connections exposed no HubSpot, QuickBooks, Stripe, or PayPal cards after positive settle signals; all three measured pages reported no horizontal scroll.
- Implemented reporting, current-state verification, exhaustive self-test, and strict close modes for the provider/REVN matrix. The resolver derives HubSpot → REVN-01, QuickBooks → REVN-02, Stripe + PayPal → REVN-03, and all four providers → REVN-04..06.

## Proposed Exposure and Completion Matrix

| Provider | Current repository gate | Discovery | Requirement effect |
|---|---|---|---|
| HubSpot | Parked; revoke cascade condition unresolved | Hidden | REVN-01 pending; REVN-04..06 pending |
| QuickBooks | Parked; partner tier/poll budget unresolved | Hidden | REVN-02 pending; REVN-04..06 pending |
| Stripe | Parked; platform revocation unresolved | Hidden | REVN-03 pending; REVN-04..06 pending |
| PayPal | Parked; no documented revoke endpoint | Hidden | REVN-03 pending; REVN-04..06 pending |

**Proposed exposure:** no revenue workflow is currently eligible. A later independently passed provider may expose only its proven offer. **Completion:** incomplete; `--strict` must continue to exit 1 until all four named lanes pass.

## Verification

| Command / evidence | Result |
|---|---|
| `pnpm --filter @pikar/web test -- RevenuePackPanel` | **4/4 passed** |
| Focused authenticated Playwright with `PIKAR_E2E_BASE_URL=http://localhost:3111` and the gitignored fresh storage state | **1/1 passed**, exercising desktop, tablet, and mobile in one context; 3 PNG artifacts captured |
| `node scripts/check-phase28-completion.mjs --self-test` | **16/16 pass/park combinations passed**, plus every parked/expired/failed refusal and unreachable-gate refusal |
| `node scripts/check-phase28-completion.mjs --report` | Exit 0; all four providers parked/hidden, REVN-01..06 pending |
| `node scripts/check-phase28-completion.mjs --verify-current` | Exit 0; every current repository projection reachable and non-red in the completion view |
| `node scripts/check-phase28-completion.mjs --strict` | **Expected exit 1**; correctly refuses Phase 28 completion |
| `node scripts/check-provider-lane.mjs --all --stage final` | **Expected exit 1**; names the four unresolved live conditions instead of treating admitted lanes as passed |
| Repository close from the first execution session | revenue **337/337**, web **657/657** plus typecheck/build, backend sharded **3378/3378**, playbook gate and completion current-state verification passed |

Artifacts are stored under `output/playwright/revenue-pack/{desktop,tablet,mobile}-parked.png`. The live storage state remains gitignored under `apps/web/e2e/.auth/user.json` and is not part of any commit.

## Task Commits

1. **Task 1 RED: failing gated discovery contract** — `ce7a083`
2. **Task 1 GREEN: server-owned gated revenue discovery** — `1be383c`
3. **Task 2: authenticated responsive parked-lane evidence** — `1fb3956`
4. **Task 3: exhaustive strict completion matrix** — `f385725`
5. **Repository verification deviations** — `040b1f9`

The pause-state metadata commit `ad3be76` records the earlier authentication gate but contains no product task implementation.

## Decisions Made

- Kept the browser renderer dumb: it receives server-projected offers and has no client-side provider/module inference path.
- Kept absence evidence non-vacuous by waiting for a positive server marker in the workspace and the independently present Microsoft row on Connections.
- Consolidated responsive coverage into one browser context after observing that parallel contexts restored from one Convex Auth storage state race the rotating refresh token and sign each other out.
- Preserved the current honest release posture: a useful independently passed subset may later ship, but no subset can complete Phase 28 or mark REVN-01..06 complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a positive empty-set settle marker**
- **Found during:** Task 2 browser-spec authoring
- **Issue:** Asserting zero revenue cards on first paint could pass before the provider query answered.
- **Fix:** Rendered a hidden `revenue-pack-settled` marker only after the server query resolves to an empty list and asserted it before absence.
- **Files modified:** `RevenuePackPanel.tsx`, `RevenuePackPanel.test.tsx`
- **Verification:** RevenuePackPanel 4/4 and authenticated Playwright 1/1 pass.
- **Committed in:** `1fb3956`

**2. [Rule 1 - Bug] Removed the shared-refresh-token browser race**
- **Found during:** Task 2 authenticated execution
- **Issue:** Three parallel Playwright contexts restored one rotating Convex Auth refresh token and were redirected to sign-in during render.
- **Fix:** Exercised all three viewports sequentially inside one real authenticated context.
- **Files modified:** `apps/web/e2e/revenue-pack.spec.ts`
- **Verification:** The single-context desktop/tablet/mobile gate passes in 21.9 seconds.
- **Committed in:** `1fb3956`

**3. [Rule 3 - Blocking] Re-captured a valid local authenticated state**
- **Found during:** Task 2 continuation
- **Issue:** The earlier parallel run invalidated the supplied refresh token; the persistent profile was also signed out.
- **Fix:** Signed the sanctioned throwaway local account in through the real form and harvested the live browser context with the repository's documented cookie/localStorage method. No credential was committed or persisted elsewhere.
- **Files modified:** gitignored `apps/web/e2e/.auth/user.json` only
- **Verification:** The focused gate passed and all three artifacts were captured.
- **Commit:** None; credential material is intentionally untracked.

**4. [Rule 1 - Bug] Closed repository verification integration gaps**
- **Found during:** Task 3 full repository close
- **Issue:** New production revenue audit events were absent from the safe viewer allowlist, unsubscribe runtime configuration did not fail closed, and scheduled delivery work could escape cockpit test boundaries.
- **Fix:** Extended the closed audit projection, enforced unavailable unsubscribe configuration, and quiesced scheduled work at the test boundary.
- **Files modified:** audit/contact playbooks, `auditProjection.ts`, `contacts.ts` and tests, `cockpit.test.ts`
- **Verification:** Full repository evidence listed above is green.
- **Committed in:** `040b1f9`

---

**Total deviations:** 4 auto-fixed (2 bugs, 1 missing critical verification signal, 1 blocking authentication refresh).
**Impact on plan:** The fixes make the evidence fail-closed and reproducible without expanding provider capability, changing schema, or exposing a parked lane.

## Issues Encountered

- The fresh state captured on `localhost` must be paired with `PIKAR_E2E_BASE_URL=http://localhost:3111`; using the default `127.0.0.1` origin cannot load localhost-scoped cookies/localStorage and correctly lands on sign-in.
- The mobile artifact shows the existing narrow profile shell clipping long descriptive copy despite `html.scrollWidth === clientWidth`. This predates plan-owned changes and was not swept into this plan; the revenue-provider assertions and honest connection states remain visible and passed.
- `docs/playbooks/revenue-connectors.md` contains concurrent 28-09 operational edits. Interactive hunk staging committed only the 28-16 evidence/matrix sections and preserved every 28-09 hunk unstaged.
- Graphify artifacts, generated API/schema changes, `agent-runtime.md`, and the workspace header overflow fix remain unrelated and unstaged.

## User Setup Required

None for this offline/current-state close. Live provider evidence and owner judgment remain separate future gates.

## Next Phase Readiness

- Plan 28-27 can consume the proposed matrix and current authenticated artifacts for the owner subset decision.
- REVN-01..06 and Phase 28 remain pending until every named live provider condition is genuinely cleared and the strict matrix passes.
- Any provider that later fails or expires remains independently removable without hiding a passed sibling lane.

## Self-Check: PASSED

- `RevenuePackPanel.tsx`, `revenue-pack.spec.ts`, `check-phase28-completion.mjs`, and this summary exist.
- Commits `ce7a083`, `1be383c`, `1fb3956`, `f385725`, and `040b1f9` resolve as commits.
- STATE records 28/29 executed with 353 completed plans and next plan 28-27.
- ROADMAP records 28-16 complete and Phase 28 at 28/29 while REVN-01..06 remain pending.
- `git diff --check` passes for SUMMARY, STATE, and ROADMAP.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-02*
