---
phase: 31
slug: marketing-surface-and-funnel-v0
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-10
---

# Phase 31: Marketing Surface and Funnel v0 — Validation Strategy

> Nyquist validation contract for MKTG-01, MKTG-02, and MKTG-03. Phase implementation is not allowed to begin until Plan 31-00 records explicit owner decisions for the three semantic blockers identified by research.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| Frameworks | Vitest 3.2.7; `convex-test` 0.0.54; Playwright 1.61.1 |
| Config files | `packages/core/vitest.config.ts`; `packages/backend/vitest.config.mts`; `apps/web/vitest.config.mts`; `apps/web/playwright.config.ts` |
| Fast core command | `pnpm --filter @pikar/core test -- marketing.test.ts` |
| Fast backend command | `pnpm --filter @pikar/backend test -- funnels.test.ts` |
| Convex generation command | `pnpm --filter @pikar/backend codegen` |
| Fast web command | `pnpm --filter @pikar/web test -- marketingView.test.ts` |
| Browser command | `pnpm --filter @pikar/web test:e2e -- marketing-uat.spec.ts` |
| Full phase gate | `pnpm test && pnpm typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` |
| Expected duration | Targeted checks: 5–20 seconds; package/full gates: 30–180 seconds |

---

## Sampling Rate

- **After every implementation task:** run the task's targeted Vitest command or structural guard.
- **After every plan:** run tests and typecheck for every package touched by that plan.
- **After the final implementation wave:** run `pnpm test`, `pnpm typecheck`, the web production build, and the focused Playwright scenario.
- **Before completing the phase:** execute the live unauthenticated HTTP/browser checklist and confirm the negative-space invariants (no event table, no publishing action, no public contact write, no middleware widening).
- **Maximum feedback latency:** 20 seconds for normal red/green work; slower whole-repository and browser gates are reserved for plan boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command / Evidence | File Exists | Status |
|---------|------|------|-------------|-----------|------------------------------|-------------|--------|
| 31-00-01 | 00 | 0 | MKTG-01/02/03 | decision contract | Owner approval in `31-00-SUMMARY.md`; stage/source/lead decisions and exact compatibility verdict recorded | ❌ W0 | ⬜ pending |
| 31-01-01 | 01 | 1 | MKTG-01/02 | unit | `pnpm --filter @pikar/core test -- marketing.test.ts` — six-channel totality including TikTok, dual social blockers, raw counters, stage/source parsing | ❌ W1 | ⬜ pending |
| 31-01-02 | 01 | 1 | MKTG-02 | structural + type | `pnpm --filter @pikar/backend test -- funnels.test.ts && pnpm --filter @pikar/backend typecheck` — exact three-counter schema/no event plane | ❌ W1 | ⬜ pending |
| 31-01-03 | 01 | 1 | MKTG-01/02/03 | documentation guard | `node scripts/check-playbooks.mjs` | ✅ checker | ⬜ pending |
| 31-02-01 | 02 | 2 | MKTG-02 | codegen + integration | `pnpm --filter @pikar/backend codegen && pnpm --filter @pikar/backend test -- funnels.test.ts` — generated module parity, `api.funnels.create/list/deactivate`, auth, Vault ownership, exact 256-bit token/43-char base64url, `contentHash`, one-time disclosure | ❌ W2 generated | ⬜ pending |
| 31-02-02 | 02 | 2 | MKTG-02 | codegen + integration/concurrency | `pnpm --filter @pikar/backend codegen && pnpm --filter @pikar/backend test -- funnels.test.ts && pnpm --filter @pikar/backend typecheck` — `internal.funnels.resolveAndIncrement`, public API parity, one counter + stored-byte redirect per stage, concurrency/overflow/source/deactivate | ❌ W2 generated | ⬜ pending |
| 31-02-03 | 02 | 2 | MKTG-02 | documentation guard | `node scripts/check-playbooks.mjs` — lifecycle/token/counter prose matches implementation | ✅ checker | ⬜ pending |
| 31-03-01 | 03 | 3 | MKTG-02 | router integration | `pnpm --filter @pikar/backend test -- funnels.test.ts` — every visit/claim/download GET is one increment plus 302; uniform 404/no-count refusal | ❌ W1 | ⬜ pending |
| 31-03-02 | 03 | 3 | MKTG-02 | structural negative-space | `pnpm --filter @pikar/backend test -- funnels.test.ts` plus byte/diff review of `apps/web/middleware.ts` — no Next bypass/public write/event table | ❌ W1 | ⬜ pending |
| 31-03-03 | 03 | 3 | MKTG-02/03 | documentation guard | `node scripts/check-playbooks.mjs` — deployed route matrix and cockpit inventory | ✅ checker | ⬜ pending |
| 31-04-01 | 04 | 2 | MKTG-03 | integration/convergence | `pnpm --filter @pikar/backend test -- contacts.test.ts cockpit.test.ts gmail.test.ts` — single-store provenance plus captured suppressed address refused at `executePlan` and `gmail.send` | ✅ base files | ⬜ pending |
| 31-04-02 | 04 | 2 | MKTG-03 | documentation guard | `node scripts/check-playbooks.mjs` — provenance and both suppression convergence points documented | ✅ checker | ⬜ pending |
| 31-05-01 | 05 | 4 | MKTG-01/02/03 | component | `pnpm --filter @pikar/web test -- marketingView.test.ts` — independent sections, six channels/dual blockers, links, lead capture, honest empty/error states | ❌ W4 | ⬜ pending |
| 31-05-02 | 05 | 4 | MKTG-03 | component negative-space | `pnpm --filter @pikar/web test -- marketingView.test.ts` — workspace navigation only; no provider/model/send/publish action | ❌ W4 | ⬜ pending |
| 31-05-03 | 05 | 4 | MKTG-01/02/03 | component + docs | `pnpm --filter @pikar/web test -- marketingView.test.ts && node scripts/check-playbooks.mjs` — disabled nav and watched ownership | ❌ W4 | ⬜ pending |
| 31-06-01 | 06 | 5 | MKTG-01/02/03 | e2e authoring | `pnpm --filter @pikar/web test:e2e -- marketing-uat.spec.ts --list` — disposable authenticated setup and unauthenticated three-stage 302 journey | ❌ W5 | ⬜ pending |
| 31-06-02 | 06 | 5 | MKTG-01/02/03 | regression/negative-space | `pnpm --filter @pikar/backend test -- funnels.test.ts contacts.test.ts cockpit.test.ts gmail.test.ts && pnpm --filter @pikar/web test -- marketingView.test.ts` | mixed | ⬜ pending |
| 31-06-03 | 06 | 5 | MKTG-01/02/03 | repository gate | `pnpm test && pnpm typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | ✅ commands | ⬜ pending |
| 31-07-01 | 07 | 6 | MKTG-01/02/03 | live HTTP/browser | `pnpm --filter @pikar/web test:e2e -- marketing-uat.spec.ts` plus redacted manual matrix for three independent 302/counter deltas | ❌ W6 | ⬜ pending |
| 31-07-02 | 07 | 6 | MKTG-01/02/03 | manual UAT | Owner verifies six honest channel states, one-time token disclosure, three 302s/counters, Phase 19 provenance/suppression, and no publishing | N/A manual | ⬜ pending |
| 31-07-03 | 07 | 6 | MKTG-01/02/03 | activation regression | `pnpm --filter @pikar/web test -- marketingView.test.ts && pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build && node scripts/check-playbooks.mjs` | ❌ W4 | ⬜ pending |

Legend: ⬜ pending · ✅ passing · ❌ missing/blocking · ⚠️ flaky

---

## Wave 0 Requirements

Plan 31-00 is a decision Wave 0, not an application-scaffolding wave. It must produce `31-00-SUMMARY.md` with:

1. The exact visit/claim/download transition grammar and whether counters are raw request counts.
2. The exact persistence model for `?s=&lt;source&gt;` while retaining only the three required aggregate counters.
3. Whether MKTG-03 means authenticated operator recording or public visitor submission, including the compatibility consequence for MKTG-02.
4. A compatibility verdict. If any decision requires a requirements or threat-model amendment, downstream plans remain blocked and Phase 31 must be replanned before application edits.

The following validation files are then created alongside their production seams, preserving red/green ownership:

- `packages/core/src/marketing.test.ts` in Plan 31-01.
- `packages/backend/convex/funnels.test.ts` in Plans 31-01 through 31-03.
- Additional Phase 31 cases in `packages/backend/convex/contacts.test.ts`, `cockpit.test.ts`, and `gmail.test.ts` in Plan 31-04, including the two real suppression convergence points.
- `apps/web/app/(app)/dashboard/marketing/marketingView.test.ts` in Plan 31-05.
- `apps/web/e2e/marketing-uat.spec.ts` in Plan 31-06.

### Generated API parity

- Plan 31-02 owns `packages/backend/convex/_generated/api.d.ts` because `funnels.ts` is a new Convex module.
- Run `pnpm --filter @pikar/backend codegen` only after the module exists, and again after its internal exports are final. A missing/configuration-failed codegen is blocking, not a reason to hand-edit or accept stale types.
- `funnels.test.ts` carries compile-time witnesses for `api.funnels.create`, `api.funnels.list`, `api.funnels.deactivate`, and `internal.funnels.resolveAndIncrement` (plus any separately named internal storage resolver actually consumed by `http.ts`).
- The generated declaration must contain exactly one `funnels` module import/map entry. Backend typecheck and later web build provide downstream parity coverage for both visibility projections.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Procedure |
|----------|-------------|------------|-----------|
| Semantic decisions are genuinely owner-approved | MKTG-01/02/03 | Tests cannot choose product semantics | At Plan 31-00 checkpoint, owner selects/defines all three contracts; executor records exact answers and compatibility verdict |
| Public request reaches Convex without Clerk middleware change | MKTG-02 | Requires deployed routing and an unauthenticated client | In private/incognito session request each approved funnel stage, inspect status/location, and compare counters |
| Every stage resolves to the intended stored asset | MKTG-02 | Requires a real storage URL and deployed Convex HTTP action | Create a disposable funnel; invoke visit, claim, and download separately; confirm each increments only its named counter and returns 302 to the downloaded artifact; deactivate and confirm 404/no increment |
| Channel state is honest and actionable | MKTG-01 | Copy/state truth is a product judgment | Compare Gmail connected/configured state to actual account; confirm unimplemented social channels say blocked with reason and no fake zero |
| Lead provenance and suppression posture are visible | MKTG-03 | End-to-end evidence spans UI, contact store, and operator review | Record one disposable lead, inspect Phase 19 contact row for approved `origin` and `consentSource`, then delete/clean up via existing safe workflow |
| No outbound/publishing behavior is introduced | MKTG-03 | Negative capability and UX promise require code and product review | Inspect UI copy/actions and source search; confirm only draft/plan actions are offered and no send/publish call is reachable |

---

## Threat-Model Validation Checklist

- [ ] Raw funnel token is generated with cryptographic entropy, returned once, never logged, and persisted only as a hash.
- [ ] Funnel management mutations/queries require Clerk identity and enforce tenant ownership through the Vault artifact boundary.
- [ ] Public route accepts only the approved GET grammar, has no public contact-write path, and does not broaden `apps/web/middleware.ts`.
- [ ] Redirect location is obtained from a trusted Convex storage lookup, not a caller-supplied URL; unsafe or missing targets fail closed.
- [ ] Counter mutations are atomic, integer-only, non-negative, and protected against unsafe-integer overflow.
- [ ] Source attribution follows the Plan 31-00 decision without adding per-visitor/event rows or unbounded attacker-controlled keys.
- [ ] Unknown/deactivated tokens and invalid stages return indistinguishable minimal 404 responses.
- [ ] Lead capture uses the Phase 19 `contacts` store, normalized email, approved provenance literals, and existing suppression/consent logic.
- [ ] No `funnelEvents`, visitor identity, IP address, user-agent, per-click timestamp, or equivalent event-level table exists.
- [ ] No social publisher, outbound-send mutation, or Phase 32 campaign/metric machinery is introduced.

---

## Validation Sign-Off

- [ ] Plan 31-00 decision record approved and compatible with current requirements
- [ ] Every task has an automated check or an explicit manual-only rationale
- [ ] No three consecutive implementation tasks lack automated verification
- [ ] Wave-specific test files exist and pass
- [ ] Convex codegen succeeds and generated API parity covers both `api.funnels` and `internal.funnels`
- [ ] Targeted tests, full tests, typecheck, and web production build pass
- [ ] Live unauthenticated HTTP and browser UAT pass
- [ ] Negative-space and threat-model checklist pass
- [ ] `nyquist_compliant: true` remains accurate after implementation changes

**Approval:** pending
