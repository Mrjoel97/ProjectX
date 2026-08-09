---
phase: 25
slug: private-beta-productionization
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-09
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `25-RESEARCH.md` § Validation Architecture. That section is the source of
> truth for the requirement→test map; this file is the execution contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` ^3.2.7 + `convex-test` 0.0.54 (backend) · `@playwright/test` (web e2e) |
| **Config file** | `packages/backend/vitest.config.ts` — `environment: "edge-runtime"`, `server.deps.inline: ["convex-test"]`, `include: ["convex/**/*.test.ts"]`, `testTimeout: 20_000` |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run convex/<file>.test.ts` |
| **Full suite command** | `pnpm test` (turbo, all packages) |
| **E2E command** | `pnpm --filter @pikar/web exec playwright test --project=chromium --list` then `pnpm test:e2e -- --project=chromium` (every authenticated spec; storage-state via `auth.setup.ts`) |
| **Skill gate** | `pnpm eval:golden` — **required** whenever the `cockpit-agent` body changes |
| **Boot gate** | `pnpm boot:check` (install → codegen → typecheck) · `pnpm lint` (biome ci) |
| **Estimated runtime** | ~60s backend quick · ~4-6 min full suite · e2e additional |

**No framework install needed** — vitest, convex-test, edge-runtime and Playwright are all
present and configured. Wave 0 writes test FILES, not infrastructure.

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @pikar/backend exec vitest run convex/<touched>.test.ts` + `pnpm lint`
- **After every plan wave:** `pnpm test` + `pnpm typecheck`; add `pnpm test:e2e` on any wave touching `apps/web`
- **Skill-body waves only:** `pnpm eval:golden` before activating — **read back the live version first** (`seedSkills` writes `maxVersion + 1`; optimizer dry-runs occupy versions)
- **Before `/gsd:verify-work`:** full suite + e2e green, `ops:envCheck` returns `missing: []` on the hosted deployment, and every live checkpoint recorded
- **Max feedback latency:** ~60 seconds (single backend test file)

---

## Per-Task Verification Map

*Populated by `gsd-planner`. Every task must map to an `<automated>` verify, a Wave 0 dependency,
or an explicit checkpoint enumerated under Manual-Only below.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 00-01 | 25-00 | 1 | all | prerequisite checkpoint | owner approval of completion matrix | n/a | ⬜ pending |
| 00-02 | 25-00 | 1 | all | baseline | `pnpm test && pnpm typecheck` | ✅ | ⬜ pending |
| 00-03 | 25-00 | 1 | all | replanning approval | material drift returns to `$gsd-plan-phase 25`; then 01-13 structure + complete goal-backward re-verification and owner approval | ✅ | ⬜ pending |
| 01-01 | 25-01 | 2 | BETA-01 | unit | `pnpm --filter @pikar/backend exec vitest run convex/invites.test.ts` | ❌ | ⬜ pending |
| 01-02 | 25-01 | 2 | BETA-01 | unit | same invites test, including zero-persist callback cases | ❌ | ⬜ pending |
| 01-03 | 25-01 | 2 | BETA-01 | structural | `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 02-01 | 25-02 | 3 | BETA-01 | build | `pnpm --filter @pikar/web build` | ✅ | ⬜ pending |
| 02-02 | 25-02 | 3 | BETA-01 | e2e | `pnpm test:e2e -- e2e/admin.spec.ts` | ❌ | ⬜ pending |
| 02-03 | 25-02 | 3 | BETA-01 | structural | `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 03-01 | 25-03 | 4 | BETA-02/BETA-05 | unit/static | `pnpm --filter @pikar/backend exec vitest run convex/isolation.test.ts` | ❌ | ⬜ pending |
| 03-02 | 25-03 | 4 | BETA-02/BETA-05 | unit | same isolation test, one behavioral harness | ❌ | ⬜ pending |
| 03-03 | 25-03 | 4 | BETA-05 | unit | `... vitest run convex/skilloptExport.test.ts convex/isolation.test.ts` | ⚠️ extend | ⬜ pending |
| 04-01 | 25-04 | 3 | BETA-03 | unit | `... vitest run convex/onboarding.test.ts` | ⚠️ extend | ⬜ pending |
| 04-02 | 25-04 | 3 | BETA-03 | unit | `... vitest run convex/cockpit.test.ts convex/onboarding.test.ts` | ⚠️ extend | ⬜ pending |
| 04-03 | 25-04 | 3 | BETA-03 | e2e | `pnpm test:e2e -- e2e/onboarding-first-send.spec.ts` | ❌ | ⬜ pending |
| 05-01 | 25-05 | 5 | DLVR-02 | TDD/unit | red contracts then green Graph/delivery/migration/Gmail/cockpit focused suite | ❌/⚠️ | ⬜ pending |
| 06-01 | 25-06 | 6 | DLVR-02 | unit | GmailAuth/Graph lifecycle tests + backend typecheck | ⚠️ extend | ⬜ pending |
| 06-02 | 25-06 | 6 | DLVR-02 | owner decision | honest Microsoft local-disconnect/remote-invalidation posture | n/a | ⬜ pending |
| 06-03 | 25-06 | 6 | DLVR-02 | e2e | `pnpm test:e2e -- e2e/mail-provider.spec.ts` | ❌ | ⬜ pending |
| 07-01 | 25-07 | 7 | DLVR-02 | hosted migration | dry-run → run → zero undefined; no source edits | n/a | ⬜ pending |
| 07-02 | 25-07 | 7 | DLVR-02 | unit/deploy | focused migration/Gmail/auth/delivery → narrow → exact-SHA deploy | ⚠️ extend | ⬜ pending |
| 07-03 | 25-07 | 7 | DLVR-02 | live | fresh Gmail read/send after narrowed deployment | n/a | ⬜ pending |
| 08-01 | 25-08 | 8 | DLVR-02 | live | first Microsoft check: Outlook MIME threading | n/a | ⬜ pending |
| 09-01 | 25-09 | 9 | DLVR-02 | unit | fixture-first Graph read plane | ❌ | ⬜ pending |
| 09-02 | 25-09 | 9 | DLVR-02 | unit/static | Graph/Gmail/delivery/llm/briefings + zero direct callers | ❌/⚠️ | ⬜ pending |
| 09-03 | 25-09 | 9 | DLVR-02 | live | dual-audience config, consent-capable parity, honest admin-consent outcome | n/a | ⬜ pending |
| 09-04 | 25-09 | 9 | DLVR-02 | structural | playbook checker | ✅ | ⬜ pending |
| 10-01 | 25-10 | 10 | go-live | unit/build | env/readiness test + backend typecheck + web build | ❌/✅ | ⬜ pending |
| 10-02 | 25-10 | 10 | go-live | decision | Branch A continues; Branch B explicitly blocks Phase 25 | n/a | ⬜ pending |
| 10-03 | 25-10 | 10 | go-live | conditional implementation | durable Branch-A origin validation only | ⚠️ extend | ⬜ pending |
| 11-01 | 25-11 | 11 | go-live | live deploy | durable DNS/TLS + Vercel/Convex + envCheck + seed/readback | n/a | ⬜ pending |
| 11-02 | 25-11 | 11 | BETA-01 | live | real Google/Microsoft uninvited/invited + password asymmetry | n/a | ⬜ pending |
| 12-01 | 25-12 | 12 | all | exact-SHA qualification | focused/full + authenticated Chromium + boot + hosted `{ missing: [] }` | planned | ⬜ pending |
| 13-01 | 25-13 | 13 | DLVR-02 | live final-SHA | fresh Outlook connect/search-read/send/reply/disconnect | n/a | ⬜ pending |
| 13-02 | 25-13 | 13 | BETA-02/BETA-05 | live | hosted two-user cross-tenant/owner gate | n/a | ⬜ pending |
| 13-03 | 25-13 | 13 | BETA-03 | live | timed thin-profile governed self-send | n/a | ⬜ pending |
| 13-04 | 25-13 | 13 | all | metadata | phase-completeness validation + playbook checker after all live gates | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test files (all six are MISSING and gate their requirement):

- [ ] `packages/backend/convex/invites.test.ts` — BETA-01: zero-row-persistence on uninvited sign-in, subject binding, **cross-subject re-redemption refused driven twice (Google-shaped 21-digit `sub` AND Entra-shaped opaque ~44-char `sub`)**, returning-identity skip, password wrong-code asymmetry, owner-gated issuance
- [ ] `packages/backend/convex/isolation.test.ts` — BETA-02 + BETA-05: the `schema.tables` enumeration (**an unclassified table FAILS**), the every-index-leads-with-`tenantId` scan with a non-vacuity floor, the reverse check (no `EXEMPT_GLOBAL` table declares `tenantId`), the two-user behavioural cross-read/cross-write matrix, owner's pre-existing rows stay attributed, and the three `OWNER_REQUIRED` assertions
- [ ] `packages/backend/convex/graph.test.ts` — DLVR-02: MIME byte-parity with `gmail.send`, suppression refusal before credential mint + CAN-SPAM footer (19-05 parity), error taxonomy (≥500 throws / non-202 4xx terminal), provider-aware >4 MB attachment cap, rotated-`refresh_token` persistence, and the fixture-first read plane
- [ ] `packages/backend/convex/delivery.test.ts` — DLVR-02: per-send routing, and the **static scan proving `internal.gmail.send` appears in ZERO non-test source files** after the seam lands
- [ ] `apps/web/e2e/onboarding-first-send.spec.ts` — BETA-03 DOM path against the `SMOKE::` fixture spine
- [ ] `apps/web/e2e/admin.spec.ts` — BETA-01 issuance DOM; also closes **Phase 22's outstanding `/ops` DOM UAT residue**
- [ ] `packages/backend/convex/lib/env.ts` + `ops:envCheck` — the fail-closed production secret manifest

Extensions to existing files (no new file):

- [ ] `onboarding.test.ts` — the first-send offer appears iff `needsOnboarding === true`
- [ ] `cockpit.test.ts` — **a tenant with NO `postalAddress` can complete the first-send offer**, and the offer works on a thin idea-stage profile (only `oneLineDescription` + persona)
- [ ] `skilloptExport.test.ts` — grounded-prose export stays owner-gated
- [ ] `migrations.test.ts` — the `gmailTokens.provider` backfill sets `"google"` on every pre-existing row

---

## Manual-Only Verifications

All manual state changes and live behaviors are explicit checkpoints; none may be inferred from
offline tests or reused across a later production deploy.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **Outlook MIME threading** | DLVR-02 | Whether Graph honours `In-Reply-To`/`References` in the conversation view is observable only against a real Outlook client. **This is the one whose failure changes the design** | **Schedule FIRST among the live MS checks, not last.** Send a real reply via Graph to a real Outlook thread; confirm it lands in the conversation view, not as a new thread |
| **Microsoft remote-invalidation posture** | DLVR-02 | Entra has no Google-equivalent app-grant revoke endpoint under the requested Mail scopes; logout and broad `revokeSignInSessions` are not equivalent | Owner explicitly accepts truthful local disconnect + remote grant-removal instructions, or stops for a separately authorized privileged mechanism; never claim unverified parity |
| **Post-deploy compact Outlook matrix** | DLVR-02 | Pre-deploy provider evidence cannot prove the final production bundle/configuration | After Plan 11 deploy and Plan 12 qualification, freshly connect, search/read, send, reply-thread, and disconnect on the exact deployed SHA; do not reuse Plans 08/09 evidence |
| Real Google + Microsoft OAuth | BETA-01 | Real IdP round-trip against the hosted deployment; synthetic subjects cannot prove the door | On the hosted deployment: sign in **uninvited** (must be blocked, and `users`/`authAccounts` must show zero new rows) and **invited** (must admit and bind the subject) — for BOTH providers |
| Real Outlook send lands | DLVR-02 | Requires a real Azure app, real consent, real mailbox | Approve a plan routed `provider: "microsoft"`; confirm arrival in a real inbox with correct headers and CAN-SPAM footer |
| First delivered result in minutes | BETA-03 | The requirement is about a real human's wall-clock experience | A brand-new invited human completes the first-send offer and receives a real email at their own address |
| Vercel deploy + secret manifest green | Go-live | Hosted-environment state | Deploy; `npx convex run ops:envCheck` returns `missing: []`; seed the skill registry and confirm `executive-router` is active |
| **Custom-domain decision (SC#6)** | Go-live | Owner judgment, but mandatory live sends make only durable Branch A completion-capable | `checkpoint:decision` records A/B; A continues to durable-origin enforcement, while B explicitly BLOCKS Phase 25 and all downstream deploy/live qualification |
| Hosted token migration | DLVR-02 | Existing production Gmail rows cannot be simulated away | Migration-only checkpoint: dry-run, run/monitor, verify zero undefined rows; then automatic source/schema narrowing deploy and a separate fresh live Gmail check |
| Hosted two-user isolation | BETA-02/BETA-05 | Offline coverage cannot prove deployed identity/configuration boundaries | Use owner A and invited non-owner B in separate contexts across every dynamically covered surface; call the three owner functions and prose export directly |
| Pre-beta prerequisite freeze | all | The current shared baseline is still moving | Block Plan 25-01 until all named pre-beta lanes finish, final inventories are recorded, and overlapping dirty files are gone; Phase 32 is explicitly excluded |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (7 new files above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] Every manual/live checkpoint is an explicit `checkpoint:*` task, including migration, two-user, and prerequisite gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
