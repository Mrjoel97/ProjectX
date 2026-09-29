---
phase: 25
slug: private-beta-productionization
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-09
---

# Phase 25 — Validation Strategy

**2026-09-29 planning reconciliation:** The original per-task rows below preserve the historical
plan contract and are not current completion evidence. Completed Plan 03 delivered dynamic schema
and owner scans but its planned exhaustive A/B matrix did not land; Plan 16 added local A/B and HTTP
probes. Current source scans find 76 explicit tables, 189 index declaration lines, and 40
owner-wrapper exports, versus the early 45/108/14 baseline. These are source counts, not parsed
runtime-schema counts or a hosted authorization verdict. Plan 18 must reconcile the parsed runtime
tables/indexes, all public/tenant/owner exports and HTTP routes to current behavioral probes or
named exemptions before Plan 11 deploy. Plan 12 repeats the inventory on the exact deployed SHA;
Plan 13 runs hosted A/B acceptance. Phase-local wave numbers in Plans 14-17 now follow their
frontmatter dependencies (7/8/8/9); their completed summaries' "Wave 2" means the separate
closure-programme integration wave, not Phase 25's execution wave. The old references to only three owner functions are the
historical Phase-8 subset, not the present owner surface. Plan 00's owner and checker gates remain
open; no approval, deployment, or BETA-02/BETA-05 completion is inferred from this amendment.

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
present and configured. The Wave 0 file list below is a current inventory; existence alone is not
proof that a requirement or hosted checkpoint passed.

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
| 00-03 | 25-00 | 1 | all | replanning approval | material drift returns to `$gsd-plan-phase 25`; then all current plans receive structure + complete goal-backward re-verification and owner verdict | ✅ | ⬜ pending |
| 01-01 | 25-01 | 2 | BETA-01 | unit | `pnpm --filter @pikar/backend exec vitest run convex/invites.test.ts` | ✅ | historical |
| 01-02 | 25-01 | 2 | BETA-01 | unit | same invites test, including zero-persist callback cases | ✅ | historical |
| 01-03 | 25-01 | 2 | BETA-01 | structural | `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 02-01 | 25-02 | 3 | BETA-01 | build | `pnpm --filter @pikar/web build` | ✅ | ⬜ pending |
| 02-02 | 25-02 | 3 | BETA-01 | e2e | `pnpm test:e2e -- e2e/admin.spec.ts` | ✅ | historical; Plan 16 local browser proof |
| 02-03 | 25-02 | 3 | BETA-01 | structural | `node scripts/check-playbooks.mjs` | ✅ | ⬜ pending |
| 03-01 | 25-03 | 4 | BETA-02/BETA-05 | unit/static | `pnpm --filter @pikar/backend exec vitest run convex/isolation.test.ts` | ✅ | historical; Plan 18 reconciliation open |
| 03-02 | 25-03 | 4 | BETA-02/BETA-05 | unit | same isolation test, one behavioral harness | ✅ | historical; exhaustive matrix did not land |
| 03-03 | 25-03 | 4 | BETA-05 | unit | SkillOpt internal bearer boundary, not public ownerQuery | ✅ | historical supersession |
| 04-01 | 25-04 | 3 | BETA-03 | unit | `... vitest run convex/onboarding.test.ts` | ✅ | historical |
| 04-02 | 25-04 | 3 | BETA-03 | unit | `... vitest run convex/cockpit.test.ts convex/onboarding.test.ts` | ✅ | historical |
| 04-03 | 25-04 | 3 | BETA-03 | e2e | `pnpm test:e2e -- e2e/onboarding-first-send.spec.ts` | ✅ | historical local fixture only |
| 05-01 | 25-05 | 5 | DLVR-02 | TDD/unit | Graph send/delivery/Gmail/cockpit focused suite; no `gmailTokens.provider` migration | ✅/planned | historical; Plan 09 read parity open |
| 06-01 | 25-06 | 6 | DLVR-02 | unit | GmailAuth/Graph lifecycle tests + backend typecheck | ⚠️ extend | ⬜ pending |
| 06-02 | 25-06 | 6 | DLVR-02 | owner decision | honest Microsoft local-disconnect/remote-invalidation posture | n/a | ⬜ pending |
| 06-03 | 25-06 | 6 | DLVR-02 | e2e | `pnpm test:e2e -- e2e/mail-provider.spec.ts` | ❌ | ⬜ pending |
| 07-01 | 25-07 | 8 | DLVR-02 | live | accepted ADR-022 plus hosted DNS/TLS/origins first; fresh Gmail read/send on deployed dispatcher | n/a | ⬜ pending |
| 07-02 | 25-07 | 8 | DLVR-02 | live | governed Outlook send or honest mailReady-false refusal on same SHA | n/a | ⬜ pending |
| 08-01 | 25-08 | 9 | DLVR-02 | live | Outlook MIME threading after Plan 07 | n/a | ⬜ pending |
| 09-01 | 25-09 | 10 | DLVR-02 | unit | fixture-first Graph read plane | ❌ | ⬜ pending |
| 09-02 | 25-09 | 10 | DLVR-02 | unit/static | Graph/Gmail/delivery/llm/briefings + zero direct callers | ❌/⚠️ | ⬜ pending |
| 09-03 | 25-09 | 10 | DLVR-02 | live | dual-audience config, consent-capable parity, honest admin-consent outcome | n/a | ⬜ pending |
| 09-04 | 25-09 | 10 | DLVR-02 | structural | playbook checker | ✅ | ⬜ pending |
| 10-01 | 25-10 | 7 | go-live | unit/build | env/readiness test + backend typecheck + web build | ❌/✅ | historical |
| 10-02 | 25-10 | 7 | go-live | decision | accepted ADR-022; hosted DNS/TLS unproved | n/a | historical |
| 10-03 | 25-10 | 7 | go-live | source gate | durable configured-origin validation; hosted proof remains open | ✅ | historical |
| 11-01 | 25-11 | 12 | go-live | live deploy | durable DNS/TLS + Vercel/Convex + envCheck + seed/readback, after 25-18 | n/a | ⬜ pending |
| 11-02 | 25-11 | 12 | BETA-01 | live | real Google/Microsoft uninvited/invited + password asymmetry | n/a | ⬜ pending |
| 12-01 | 25-12 | 13 | all | exact-SHA qualification | isolated deployed-SHA checkout or byte-identical deployable tree; refresh 25-18 inventory, focused/full + authenticated Chromium + boot + hosted `{ missing: [] }` | planned | ⬜ pending |
| 13-01 | 25-13 | 14 | DLVR-02 | live final-SHA | fresh Outlook connect/search-read/send/reply/disconnect | n/a | ⬜ pending |
| 13-02 | 25-13 | 14 | BETA-02/BETA-05 | live | hosted two-user gate over refreshed 25-18 manifest | n/a | ⬜ pending |
| 13-03 | 25-13 | 14 | BETA-03 | live | timed thin-profile governed self-send | n/a | ⬜ pending |
| 13-04 | 25-13 | 14 | all | metadata | playbook checker after live gates; phase-completeness only after 25-13-SUMMARY | ✅ | ⬜ pending |
| 18-01 | 25-18 | 11 | BETA-02/BETA-05 | owner checkpoint | 25-00 discrepancy, full plan-set checker, and explicit release verdict | n/a | ⬜ pending |
| 18-02 | 25-18 | 11 | BETA-02/BETA-05 | runtime schema + A/B | `pnpm --filter @pikar/backend exec vitest run convex/isolation.test.ts` and core tests | ✅ | ⬜ pending |
| 18-03 | 25-18 | 11 | BETA-02/BETA-05 | exports + HTTP | `pnpm --filter @pikar/backend exec vitest run convex/isolation.test.ts convex/httpBoundary.test.ts` | ✅ | ⬜ pending |
| 18-04 | 25-18 | 11 | BETA-02/BETA-05 | repository packet | `pnpm test`, `pnpm typecheck`, strict planning checker | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements — current file inventory

These files exist in the current repository; re-run their relevant assertions on Plan 12's proven
deployed source tree. Historical local results do not certify the hosted beta:

- [x] `packages/backend/convex/invites.test.ts` — invite admission and subject binding; hosted Google/Microsoft admission remains Plan 11.
- [x] `packages/backend/convex/isolation.test.ts` — runtime table/index and source-derived owner scans plus bounded A/B probes; Plan 18 must reconcile the exhaustive current surface.
- [x] `packages/backend/convex/graph.test.ts` — Graph send behavior; Plan 09 adds fixture-first read parity.
- [x] `apps/web/e2e/onboarding-first-send.spec.ts` — local fixture first-send journey; timed real delivery remains Plan 13.
- [x] `apps/web/e2e/admin.spec.ts` — controlled local owner/non-owner browser proof; hosted admission remains Plan 11.
- [x] `packages/backend/convex/lib/env.ts` and `env.test.ts` — names-only source readiness; hosted DNS/TLS, origins, and redirects remain unproved.
- [x] `packages/backend/convex/onboarding.test.ts`, `cockpit.test.ts`, and `skilloptExport.test.ts` — existing focused tests; SkillOpt export stays on its internal bearer-token plane.

Still planned: `packages/backend/convex/delivery.test.ts` for Plan 09's read/send routing and zero
direct Gmail callers. There is no `gmailTokens.provider` column, backfill, or migration test to
create. The Microsoft grant uses a separate token table under ADR-018.

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
| **Durable-origin proof after accepted ADR-022** | Go-live | ADR-022 settles the policy, while source validation cannot prove hosted DNS/TLS or provider configuration | Before Plan 07's deployment/live sends and again at Plan 11, record durable app/API/HTTP origin values by name, DNS/TLS observations, and exact OAuth redirect equality without secrets; a stable managed Convex HTTPS host may qualify. Missing proof stops live sends. |
| **Live dispatcher continuity** | DLVR-02 | Offline tests cannot prove Gmail still reads/sends or Graph delivers from the deployed dispatcher | Plan 07: on one recorded durable deployment SHA, perform a bounded Gmail read and governed Gmail send, then a governed Outlook send or an honest `mailReady`-false refusal with re-consent; record both grants intact and do not infer live success from a refusal. |
| Hosted two-user isolation | BETA-02/BETA-05 | Offline coverage cannot prove deployed identity/configuration boundaries | On the qualified deployed SHA, use owner A and invited non-owner B across Plan 18's refreshed table/index/export/route manifest; invoke every current owner-wrapper export with validator-valid arguments, including the three historical Phase-8 functions. Keep SkillOpt prose export on its internal bearer boundary and exercise public bearer routes according to their capability contracts. |
| Reconciled Plan 00 release | all | Plan 25-01 and later repository work historically landed before Plan 00's blocking approval | Record the skipped sequence, current inventory/checker verdict, and an explicit prospective owner release or stop decision before new Plan 18 source work; Phase 32 remains excluded. Do not infer retroactive approval. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Plan 09's remaining `delivery.test.ts` reference exists and passes before Plan 12 qualification
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] Every manual/live checkpoint is an explicit `checkpoint:*` task, including hosted durable-origin/dispatcher continuity, two-user, and prerequisite gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
