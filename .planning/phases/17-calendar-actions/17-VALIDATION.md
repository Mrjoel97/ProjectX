---
phase: 17
slug: calendar-actions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `17-RESEARCH.md` § Validation Architecture — read that section for the reasoning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.7 + `convex-test` 0.0.54, `environment: "edge-runtime"` |
| **Config file** | `packages/backend/vitest.config.mts` (`testTimeout: 20_000`, no watch mode) |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run convex/calendar.test.ts convex/dispatchGuard.test.ts` |
| **Full suite command** | `pnpm test` |
| **Typecheck (a REAL test here)** | `pnpm typecheck` — the `satisfies Record<ActionType, Arm>` binds and `assertNever` are enforced by `tsc`, not Vitest. Half this phase's enforcement is compile-time. |
| **Estimated runtime** | ~30s quick, ~3min full |
| **Known pre-existing red** | `convex/audit.test.ts` (`auditCounts` unregistered) — documented since Phase 2, NOT a regression |
| **Harness note** | Any test exercising an audit-writing action must register the aggregate component (`gmail.test.ts:20-25` `harness()` idiom) or the audit path throws "component not registered" |

---

## Sampling Rate

- **After every task commit:** quick run + `pnpm typecheck`
- **After every plan wave:** `pnpm test` + `pnpm typecheck` + `node scripts/check-playbooks.mjs`
- **Before `/gsd:verify-work`:** full suite green (modulo the documented `audit.test.ts` red)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

Task IDs are assigned by the planner; this is the criterion→test contract the tasks must satisfy.

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SC#1a | Availability read is in-loop and read-only; no write endpoint reachable from a tool | static scan | quick | ❌ W0 (append below `dispatchGuard.test.ts:75`) | ⬜ pending |
| SC#1b | `executePlan` is still `export const executePlan = tenantMutation({` | static scan | quick | ✅ `dispatchGuard.test.ts:95` | ⬜ must stay green |
| SC#1c | No calendar write name is a key of the `llm.ts` tool record | static scan | quick | ❌ W0 (mirrors `:125-137`) | ⬜ pending |
| SC#1d | An approved calendar plan creates the event; any other status creates nothing | unit (`convex-test`) | quick | ❌ W0 | ⬜ pending |
| SC#1e | Double-approve creates ONE event (CAS + the 409-duplicate path) | unit, stubbed `fetch` | quick | ❌ W0 | ⬜ pending |
| SC#2a | `calendar.availability.listed` payload is exactly `{range, busyCount}`; a FAILED read audits nothing | unit | quick | ❌ W0 | ⬜ pending |
| SC#2b | `calendar.event.created` carries `{planId, eventId}` — no title/attendee/description | unit + substring-absence seeded with a distinctive title | quick | ❌ W0 | ⬜ pending |
| SC#2c | Dead-letter payload on a Calendar API error carries status/reason, never the response body | unit, stubbed 400 echoing the summary | quick | ❌ W0 | ⬜ pending |
| SC#2d | Adapter reuses `freshAccessToken`; a dead token returns `{ok:false}` and never throws | unit, stubbed refresh failure | quick | ❌ W0 | ⬜ pending |
| SC#2e | A token whose stored `scope` lacks the calendar scope is reconnect-needed **before** any API call | unit (pure `hasScope` + one action test) | quick | ❌ W0 | ⬜ pending |
| SC#3 | Two tenants, same input → no row crosses; both sides wrote something (anti-vacuity) | unit (`convex-test`) | quick | ❌ W0 (`dispatch.test.ts:520-556` is the template) | ⬜ pending |
| ACTN-02 arm | Adding the action type without an arm is a COMPILE error; arm switch exhaustive | typecheck | `pnpm typecheck` | ✅ mechanism exists | ⬜ pending |
| ACTN-02 pure | Epoch↔RFC3339 conversion + base32hex event-id derivation | unit (pure) | `pnpm --filter @pikar/core exec vitest run src/calendar.test.ts` | ❌ W0 | ⬜ pending |
| ACTN-02 tz | "in 2 hours" resolves off the trusted `nowMs`, tz-independent | unit (pure) | already covered | ✅ `emailIntent.test.ts:209` — REUSE, do not duplicate | ⬜ pending |
| ACTN-02 trace | New `agentSteps.tool` literals insert without throwing; `VERB` has an entry for each | unit + key-parity scan | `pnpm --filter @pikar/backend exec vitest run convex/agentSteps.test.ts` | ⚠️ parity scan is new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/backend/convex/calendar.test.ts` — SC#1d/1e, SC#2a-e, SC#3
- [ ] `packages/core/src/calendar.test.ts` — pure conversion + event-id derivation
- [ ] Appended assertions in `packages/backend/convex/dispatchGuard.test.ts` (below the `:75` marker) — SC#1a/1c
- [ ] A calendar POST-**target** scan (write target unreachable from `llm.ts`). **Gmail's "POST ⇒ write verb" scan does NOT carry over** — `freeBusy` is itself a POST, so this scan must whitelist by target name, never by HTTP method
- [ ] A `sendUpdates` value scan, if attendees are in scope at all (see Pitfall 3 — `events.insert` with attendees makes Google send invitations outside the governed path)
- [ ] **The offline calendar fixture seam** (the `inboxFixtures` analogue), checked BEFORE `freshAccessToken`. This is the load-bearing one: it is what keeps the offline tier large, and it must land early or most of the map above becomes live-only
- [ ] `docs/playbooks/watch.json` registration for new paths under `cockpit.md` — the Stop hook blocks without it
- [ ] **Stage-1 shared-union freeze items (on `main`, coordinated with Lane R per PARALLELIZATION.md):** `schema.ts` `agentSteps.tool` literals + staged-event fields; `cards.tsx` `VERB` entries; `actionType.ts` `ACTION_TYPES`/`Arm`/`ARMS`; `cockpit.ts` arm table + case
- [ ] Framework install: **none** — Vitest + convex-test already present

---

## Manual-Only Verifications

**This phase CANNOT be fully verified without the owner.** OAuth consent is not self-servable by any agent.

| Behavior | Req | Why Manual | Test Instructions |
|----------|-----|------------|-------------------|
| Trace step rows actually appear in the workspace | SC#1 | The silently-swallowed-insert failure mode (Pitfall 4) passes every offline test by construction | `npx convex dev` in this worktree + `pnpm dev`; run a calendar read and watch the activity trace |
| The widened scope returns a token that can call Calendar | SC#2 | Needs real Google OAuth consent | Owner reconnects Google, then run an availability read |
| `freeBusy` against a real calendar | SC#1 | Needs a real account with real busy blocks | Compare returned ranges against the actual calendar |
| One real event created on Approve, visible in Google Calendar | SC#1 | The end-to-end claim | Approve a staged event; confirm it appears |
| A pre-widening token lights the reconnect banner instead of crashing | SC#2e | Depends on a token issued BEFORE the change — cannot be synthesised after the fact | Connect once, deploy the widened scope, call calendar WITHOUT reconnecting. Expected: reconnect banner, not a 403 crash. **Worth scripting as the one live negative test** |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the fixture seam especially)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
