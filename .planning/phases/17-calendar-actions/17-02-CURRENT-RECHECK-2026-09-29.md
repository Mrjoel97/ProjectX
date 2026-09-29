# Plan 17-02 current-source recheck — 2026-09-29

Source baseline: `5dce295` on `step0-evidence-integrity`. This is a read-only reconciliation of the repository/offline Plan 17-02 exit test, not a Wave 3 entry verdict, hosted OAuth observation, or ACTN-02 closure. The only pre-existing dirty files were `graphify-out/` outputs; no Calendar source was changed.

| Exit condition | Current evidence | Verdict |
| --- | --- | --- |
| Internal Calendar fixture seed/get round-trip | `packages/backend/convex/smoke.ts` exports `seedCalendarFixture` and `getCalendarFixture`; `packages/backend/convex/calendar.test.ts` runs both via `convex-test` and asserts the replacement tenant row, deterministic busy slots and one stored row. | Repository/offline yes |
| One Google authorize URL with Mail, Calendar availability/event and Drive scopes | `gmailAuth.ts` exports `buildAuthorizeUrl`; `calendar.test.ts` asserts the exact four-scope set and scans non-test Convex source for the one Google authorize endpoint. | Repository/offline yes |
| Consent copy names Calendar capability | `apps/web/app/(app)/connect-gmail/page.tsx` tells the user the connection checks Calendar availability and creates approved Calendar events; it also names Mail and Drive. | Source yes; no new browser observation |
| One-authorize-URL scan observed RED on a planted second builder | Historical `17-02-SUMMARY.md` records the RED mutation and restoration. The current green test retains an anti-vacuity count and exact single-file expectation. | Historical mutation evidence plus current green, not a new mutation run |

Command: `pnpm --filter @pikar/backend test -- convex/calendar.test.ts` exited 0 with **88/88** tests. The preceding direct `pnpm --filter @pikar/backend exec vitest run ...` invocation could not locate the binary; the package test script was used successfully instead. The prior full `pnpm test` and `pnpm typecheck` at the same source SHA were green in the Phase 25 baseline record, but they do not prove Google provider consent on a hosted release.

The closure ledger may mark Plan 17-02's implemented/offline layers yes. Keep its disposition **open**: the Wave 2 tenant/admission/product-spine entry gate is not passed, and no exact-deployment Google consent/reconnect observation or owner acceptance is asserted here. Calendar availability and event creation still require the broader Phase 17 and ACTN-02 qualification.
