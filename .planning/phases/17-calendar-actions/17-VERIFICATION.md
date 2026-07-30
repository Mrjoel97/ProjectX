---
phase: 17-calendar-actions
verified: 2026-07-30T11:39:45Z
status: human_needed
score: "3/3 ROADMAP success criteria verified offline; ACTN-02 remains partial as written; owner UAT M1-M5 pending"
human_verification:
  - test: "M1 — widened Google consent can call Calendar"
    expected: "After reconnecting through /connect-gmail, an availability request succeeds with the single Mail + Calendar grant."
    why_human: "Requires owner-controlled Google OAuth consent and a real token."
  - test: "M2 — real freeBusy ranges match the owner's calendar"
    expected: "Returned busy intervals match real busy blocks and expose no title, description, or attendee content."
    why_human: "Requires a real Google Calendar containing known busy blocks."
  - test: "M3 — Approve creates exactly one real event"
    expected: "A staged calendar plan creates one visible Google Calendar event only after Approve; a second approval creates no duplicate."
    why_human: "The offline tier stubs provider calls; the end-to-end provider write requires owner consent and a live deployment."
  - test: "M4 — pre-widening token fails into reconnect, not a 403 crash"
    expected: "Calling Calendar with a token issued before the scope widening lights the reconnect banner and keeps the governed loop alive."
    why_human: "Requires a token issued before the widened grant; this state cannot be synthesized after the fact."
  - test: "M5 — live trace verbs and calendar plan card render"
    expected: "The workspace shows Checking your calendar… → Checked your calendar, then a calendar card with title, exact time, duration, and Approve & add to calendar rather than email chrome."
    why_human: "The AI SDK can swallow a failed trace-row insert; schema/VERB parity is provable offline, but the live insert and visual render are not."
---

# Phase 17: Calendar Actions Verification Report

**Verified goal:** Calendar availability is read in-loop, while event creation is reachable only
after the human Approve gate.

**Requirement reviewed:** `ACTN-02` — “The agent can schedule and manage calendar events
(Google / Microsoft) as governed actions.”

**Verified at:** `e31793688bbf32acab9c69247e4c09f91ec05954`

## Verdict

**Status: `human_needed`.**

The narrowed Phase 17 goal is substantively implemented and passes the focused offline tier:
availability is a governed in-loop read, `proposeCalendarEvent` stages a `proposed` plan without
network or event creation, and `executePlan` is the sole non-test caller of the Google create action.
The write runs through the action retrier only after the tenant-scoped human mutation fires.

The phase cannot be marked `passed` until owner UAT M1-M5 exercises real Google consent,
real `freeBusy`, one real approved event, the pre-widening-token failure path, and the live
trace/card surface.

`ACTN-02` also remains **partial as literally written**: Phase 17 ships Google timed-event creation
only. Microsoft/Outlook and update/cancel management are explicitly deferred. The unchecked
requirement and `Pending` traceability row in `.planning/REQUIREMENTS.md` are therefore honest and
must remain open; this verification did not edit them.

## Goal Achievement

### ROADMAP Success Criteria

| # | Observable truth | Status | Evidence |
|---|---|---|---|
| 1 | Availability is read in-loop, an event is proposed, and creation occurs only after human Approve | **VERIFIED OFFLINE / LIVE UAT PENDING** | `packages/backend/convex/llm.ts:1363` wires `checkAvailability` to `internal.calendar.freeBusy`; `packages/backend/convex/llm.ts:1411` stages all four event fields with `status: "proposed"` and has no write-action reference. `packages/backend/convex/cockpit.ts:521` keeps `executePlan` a `tenantMutation`; its `externalAction` case at `packages/backend/convex/cockpit.ts:558` is the only non-test caller of `internal.calendar.createEvent`. Tool, approve-arm, static-guard, and adapter tests all pass. M3 and M5 remain live-only. |
| 2 | Calendar reuses the Google OAuth/refresh adapter and writes refs, ids, counts, status, and reason codes only to audit/DLQ | **VERIFIED OFFLINE / LIVE CONSENT PENDING** | `packages/backend/convex/gmailAuth.ts:54` puts `GOOGLE_SCOPES` on the one authorize URL. Both actions import the existing `freshAccessToken` and check stored scope first. Availability audit is exactly `{range,busyCount}` at `packages/backend/convex/calendar.ts:123`; successful create audit is `{planId,eventId}` at `packages/backend/convex/calendarComplete.ts:73`; provider messages are discarded before terminal handling. M1 and M4 remain live-only. |
| 3 | Calendar reads/writes are tenant-scoped and ship with isolation assertions | **VERIFIED** | `createEvent` rejects a mismatched plan tenant before token/network work; `freeBusy` reads `calendarFixtures.by_tenant`; `onCreateComplete` resolves failed runs through `plans.by_calendar_run`. `packages/backend/convex/calendar.test.ts:663` contains non-vacuous two-tenant coverage for approvals, plan reads, fixture reads, cross-tenant create refusal, and run-id terminal ownership. |

**Offline score:** 3/3 ROADMAP success criteria have substantive code and passing focused evidence.
The live portions of criteria 1 and 2 remain uncertain until M1-M5.

## Requirement Coverage

| Requirement | Status | Evidence and boundary |
|---|---|---|
| `ACTN-02` governed scheduling | **SATISFIED OFFLINE FOR GOOGLE CREATE** | A timed event is staged for review, then `calendar_event → externalAction → retrier.run → calendar.createEvent → calendarComplete.onCreateComplete`. The model tool surface cannot call the create action or Approve mutation. |
| `ACTN-02` availability read | **SATISFIED OFFLINE** | Fixture-first and live-adapter paths return content-free busy ranges in-loop; failures return conversational reconnect/unavailable results rather than escaping the loop. |
| `ACTN-02` “manage” (update/cancel) | **NOT IMPLEMENTED / DEFERRED** | No update, move, or cancel action type or adapter exists. This is the recorded 17-01 Q3 scope decision. |
| `ACTN-02` Microsoft/Outlook | **NOT IMPLEMENTED / DEFERRED** | The shipped adapter, OAuth grant, and UI copy are Google-only. This is the recorded 17-01 Q7 scope decision. |

**Conclusion:** the narrow phase goal is achieved offline, but `ACTN-02` is not fully satisfied as
worded and correctly remains unchecked at `.planning/REQUIREMENTS.md:132` with a `Pending`
traceability row at `.planning/REQUIREMENTS.md:252`.

## Evidence Review

### Read and Stage Boundary

- `packages/backend/convex/calendar.ts:102` implements fixture-first `freeBusy`, using only
  `{startMs,endMs}` ranges and returning recoverable failure results.
- `packages/backend/convex/llm.ts:1363` exposes the read in the one governed tool record with a
  closed `today | tomorrow | week` input.
- `packages/backend/convex/llm.ts:1411` exposes staging only. The resolved branch writes
  `kind`, `status`, `eventTitle`, `eventStartMs`, `eventDurationMs`, and `eventTz` in one patch.
- `packages/backend/convex/dispatchGuard.test.ts:83` positively anchors `freeBusy` while forbidding
  `calendar.createEvent`, `calendarComplete`, and the Approve/fan-out surfaces from `llm.ts`.
- Repository-wide non-test callsite inspection found one events-insert URL owner
  (`calendar.ts`) and one `internal.calendar.createEvent` caller (`cockpit.ts`).

### Human Approve and Exactly-Once Path

- `packages/core/src/actionType.ts:8` includes `calendar_event`; the exhaustive arm table maps it
  to `externalAction` at `packages/core/src/actionType.ts:42`.
- The independent dispatcher table repeats that compile-time bind at
  `packages/backend/convex/cockpit.ts:505`.
- `packages/backend/convex/cockpit.ts:521` declares the human gate as `tenantMutation`.
- `packages/backend/convex/cockpit.ts:558` starts the retrier only for a `proposed` plan, persists
  `correlationId` and `calendarRunId`, and returns before Gmail request/workflow fan-out.
- `packages/backend/convex/calendar.ts:196` creates from the approved plan fields using a
  deterministic provider event id; HTTP 409 is treated as idempotent success.
- `packages/backend/convex/calendarComplete.ts:49` is the non-Node terminal and sole Calendar
  writer of final plan status, created-event audit, reconnect notification, and DLQ rows.
- `deliverApprovedPlan.ts` has no Phase 17 diff and remains the email-only workflow entry point.

### Schema, Reset, UI, and Trace

- `packages/backend/convex/schema.ts:250` widens `plans.kind`; the six Calendar fields and
  `by_calendar_run` index are present.
- `packages/backend/convex/plans.ts:172` permits model-reachable staging of only the four content
  fields; event/run ids are intentionally absent from `patchPlan`.
- `packages/backend/convex/plans.ts:297` clears all six Calendar fields on reset.
- `packages/backend/convex/schema.ts:491` contains both Calendar trace literals.
- `apps/web/app/(app)/dashboard/workspace/cards.tsx:281` renders dedicated Calendar chrome and
  `apps/web/app/(app)/dashboard/workspace/cards.tsx:1165` supplies both human trace verbs.
- `traceParity.test.ts` proves schema-literal/VERB set equality both ways, but M5 is still required
  because the production SDK may swallow a failed trace insert.

### Privacy, Failure Handling, and Isolation

- Availability audit is exactly `{range,busyCount}`; failed reads audit nothing.
- Created-event audit is exactly `{planId,eventId}`.
- Terminal provider failures keep only status and a validated reason code; the response message/body
  cannot reach audit or DLQ.
- `calendar.ts` contains no executable `attendees` or `sendUpdates` surface, preventing Google from
  sending invitations outside the governed plan.
- Scope checks precede refresh in both actions; missing/dead grants produce reconnect outcomes rather
  than retrying permanent failures.
- Cross-tenant plan references stop before token or network work, and two-tenant tests include
  anti-vacuity floors.

## Focused Validation

| Command | Result |
|---|---|
| `packages/core/node_modules/.bin/vitest.CMD run src/calendar.test.ts src/emailIntent.test.ts src/actionType.test.ts` | **PASS — 3 files, 63/63 tests** |
| `packages/backend/node_modules/.bin/vitest.CMD run convex/calendar.test.ts convex/cockpit.test.ts convex/cockpitTools.test.ts convex/dispatchGuard.test.ts convex/traceParity.test.ts` | **PASS — 5 files, 143/143 tests** |
| `pnpm --filter @pikar/core typecheck` | **PASS — exit 0** |
| `pnpm --filter @pikar/web typecheck` | **PASS — exit 0** |
| `pnpm --filter @pikar/backend typecheck` | **EXPECTED BASELINE RED — 150 diagnostics, all in `*.test.ts`; zero production diagnostics** |
| `node scripts/check-playbooks.mjs` | **PASS — exit 0** |

The nine diagnostics in Phase 17's three large Convex test files are only unused
`@ts-expect-error` directives on `import.meta.glob`; all affected tests execute and pass.
No full workspace suite was run because the focused 206-test gate directly covers the Phase 17
goal and the summaries already record unrelated full-suite nondeterminism.

The isolated worktree initially had no dependencies or generated Convex types. Dependencies were
installed from the lockfile; a compatible ignored `_generated` artifact was temporarily seeded from
the Phase 17 integration lineage to execute `convex-test`, then removed. No tracked implementation or
planning file other than this verification report was changed.

## Gaps and Limitations

1. **Owner UAT M1-M5 is still open.** This is the reason for `human_needed`.
2. **`ACTN-02` is broader than the shipped scope.** Microsoft/Outlook and update/cancel management
   remain deferred, so the requirement must not be marked complete.
3. **Calendar time parsing has a known narrow grammar.** Relative offsets and supported
   today/tomorrow/weekday forms work, but month-name/ISO absolute dates are not supported; the phase
   documentation records that strings such as “January 30 at 3pm” can be interpreted as a bare time.
   The review card exposes the exact resolved instant before Approve, which prevents an unreviewed
   wrong-date write, but a future calendar-time input should add a trusted absolute-date route.
4. **Timed events only.** All-day events and attendees are intentionally out of scope.

These are not hidden implementation stubs in the narrow verified path. The first is a live-validation
gate; the others are explicit product-scope/grammar limitations and are why `ACTN-02` remains open.

## Human Verification Steps

### M1 — Widened Google Grant

1. Deploy this integrated worktree.
2. Open `/connect-gmail` and reconnect the owner Google account.
3. Ask the cockpit to check availability.

**Expected:** the single consent flow grants Mail + Calendar and the read succeeds without a
permission error.

### M2 — Real Availability

1. Add known busy blocks to the owner's primary Google Calendar.
2. Ask for `today`, `tomorrow`, and `week` availability.
3. Compare returned intervals with the real calendar.

**Expected:** busy intervals match; no title, attendee, or description is surfaced.

### M3 — Approved Event Creation

1. Ask the cockpit to stage a timed event.
2. Confirm the plan card's exact title, time, timezone, and duration.
3. Verify no event exists before approval.
4. Click **Approve & add to calendar** once, then attempt a second approval.

**Expected:** one event appears after the first approval and no duplicate appears.

### M4 — Pre-Widening Token Negative

1. Preserve or issue a token on the pre-Phase-17 scope.
2. Deploy this build without reconnecting.
3. Attempt a Calendar read/write.

**Expected:** the reconnect banner appears and no 403 escapes the governed loop.

### M5 — Live Trace and Card

1. Run an availability request in the deployed workspace.
2. Watch the activity trace.
3. Stage a calendar event and inspect the plan card.

**Expected:** trace text transitions from **Checking your calendar…** to
**Checked your calendar**; the card shows Calendar-specific fields and approval copy, never email
recipients/mode/send-time chrome.

---

*Verifier: Codex (goal-backward Phase 17 audit)*
