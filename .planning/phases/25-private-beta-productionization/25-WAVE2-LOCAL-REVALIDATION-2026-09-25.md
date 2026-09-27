# Phase 25 closure Wave 2 local revalidation — 2026-09-25

This is a current repository/local checkpoint, not hosted beta acceptance. The canonical phase index already counted 11/18 plans complete, and summaries exist for 25-01–06, 25-10 and 25-14–17. The Phase 25 roadmap checklist incorrectly left those 11 plans unchecked and described 25-14–17 as unexecuted; its entries now agree with the summaries. Plans 25-00, 25-07–09 and 25-11–13 remain open.

## Verification repair

Plan 25-15 Task 1 named `convex/telemetry.test.ts`, which does not exist. Vitest accepted the other filenames and reported six passing files, so that command could not prove the terminal-event seam. The terminal journey event is emitted by `plans.recordDeliveryTerminal`, not `telemetry.writeTerminal`; the latter remains the separate cost/latency authority. The plan now names `convex/plans.test.ts`, where sent, failed and suppressed terminal tests assert one tenant-owned refs-only event per request under replay, with the exact event type, idempotency key, plan/request references and terminal outcome. Removing that event emission would fail these assertions.

The literal historical `pnpm --filter @pikar/backend exec vitest run ...` command was also checked on this Windows environment and exited 1 before discovery (`Command "vitest" not found`). Plans 25-14–17 now use their package `test` scripts; all three packages declare `test: vitest run`. The corrected Plan 25-15 five-file backend selection exited 0 with **124/124** tests. The result-history web selection exited 0 with **1/1** test. The initial seven-name selection reported 197/197 over only six existing files; it is not counted as proof for the missing telemetry file.

## Current focused evidence

- Backend admission/terminal group: 124/124 over `betaJourney`, `invites`, `onboarding`, `approvals` and `plans`.
- Backend isolation/HTTP/export/erasure group: 221/221 over six exact files.
- Core tenant-data, journey-metrics, capability-claim and marketing group: 52/52 over four exact files.
- Real capability checker: 15 claims across 10 sources, exit 0; mutation suite exit 0.
- Backend TypeScript, strict planning and playbook checks: exit 0.
- Full `graphify update .`: exit 0 after 1,144 uncached AST extractions; post-refresh Convex edge fixup exit 0. The changed `plans.test.ts` manifest entry has a nonempty AST hash and matching source mtime; the manifest has zero `apps/web/e2e/.auth/` entries.

Selections overlap; their counts are not summed into a unique-test total. The dated 25-14 and 25-16 controlled local browser results are preserved in their summaries but were **not** rerun in this checkpoint. No hosted identity, provider consent, real send, legal registration, production deployment, founder acceptance or Wave 8 release is inferred.

## 2026-09-27 Wave 0 ledger versus Phase 19 handoff

The frozen Wave 0 `37.1-CLOSURE-LEDGER.json` still labels ten Phase 19 plan rows and its verification row `open` from semantic source-membership classification. That baseline disposition is **not** a new instruction to rebuild the CRM: `19-VERIFICATION.md` records a passed 8/8 phase verification, ACTN-05/PIPE-01 closure, owner browser judgement and owner-attested live inbox delivery on 2026-08-10; the Phase 19 roadmap row likewise says complete. A fresh, narrower current-worktree `pnpm --filter @pikar/backend test -- convex/contacts.test.ts` passed **93/93** on 2026-09-27. The old live/browser/provider evidence is historical and does not certify Phase 25's exact hosted release, while the current local test does not replace it. Leave the Wave 0 baseline intact and route Wave 2's remaining work to Phase 25's open hosted/provider/exact-release plans, not a duplicate Phase 19 implementation.

## 2026-09-27 Plan 25-11 deployment preflight

The repository-wide `pnpm typecheck` completed successfully: **12/12 packages**, exit 0 (two cached). This is a current-worktree local check, not a release-SHA or hosted-service check. At preflight, `git status --short` reported **352 changed paths** and HEAD was `dd6ffca`; `.planning/phases/25-private-beta-productionization/25-DEPLOY-EVIDENCE.md` did not exist. Thus Plan 25-11's exact *clean* SHA, durable Convex/Vercel domain and TLS, hosted `envCheck`/skill readback, service smokes, and real Google/Microsoft/password invite-admission evidence have not been established. No deployment or live-admission attempt was made; Plan 25-11 and dependent hosted plans remain open.
