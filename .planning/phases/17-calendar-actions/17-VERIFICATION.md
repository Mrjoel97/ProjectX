---
phase: 17-calendar-actions
verified: 2026-08-10T17:42:00Z
status: gaps_found
score: "The narrowed Google create-only phase goal is implemented, but ACTN-02 is not satisfied as written; current pure/static gates pass and the Convex behavior gate timed out"
human_verification:
  - test: "H1 — real Google consent and availability"
    expected: "The widened grant contains the Calendar scopes; a known real busy block is returned without event content, and the audit payload is exactly {range,busyCount}."
    why_human: "The live adapter requires owner-controlled Google OAuth consent and a real calendar."
  - test: "H2 — live stage, trace, card, and exactly-once create"
    expected: "The trace and Calendar card render before approval; no event exists before approval; approving twice leaves exactly one real event and one refs-only created audit row."
    why_human: "Provider creation and the production SDK/UI trace path are not proved by fixture or source-scan tests."
  - test: "H3 — old-scope reconnect behavior"
    expected: "A stored mail-only grant yields the reconnect banner and a conversational reply; no raw 403 escapes and the thread stays usable."
    why_human: "A genuine pre-widening token is historical state; editing the stored scope is an acceptable mechanism-level substitute if that token no longer exists."
---

# Phase 17: Calendar Actions Verification Report

## Verdict

**Status: `gaps_found`.**

The Phase 17 implementation meets its deliberately narrowed goal: Google primary-calendar
availability is read in-loop; a timed event is staged at `status: "proposed"`; the model-facing
tool surface cannot call the provider write; and the human `executePlan` mutation starts the
retried Google create action. The audit/DLQ shapes and tenant boundaries are substantive in current
source, and the current pure/static gates pass.

That narrowed goal is not the whole requirement. `ACTN-02` says the agent can **schedule and
manage** calendar events **(Google / Microsoft)**. Current source is Google-only and create-only.
There is no Microsoft/Outlook adapter or grant, and no update, move, or cancel action. The phase's
own Q3/Q7 decisions, playbook, STATE entry, and unchecked requirement all record those omissions.
They are honest deferrals, but they are still requirement gaps. Human UAT can validate the shipped
Google slice; it cannot make the missing provider and operations exist.

## Requirement Result

| Requirement clause | Status | Current evidence |
|---|---|---|
| Governed Google availability read | **IMPLEMENTED; LIVE HUMAN CHECK OPEN** | `llm.ts:2314` exposes `checkAvailability`; `calendar.ts:23,102` owns the Google `freeBusy` endpoint/action; audit is `calendar.availability.listed` with `{range,busyCount}` at `calendar.ts:123-125`. |
| Governed Google timed-event scheduling | **IMPLEMENTED; LIVE HUMAN CHECK OPEN** | `llm.ts:2362` stages only; `actionType.ts:75` maps `calendar_event` to `externalAction`; `cockpit.ts:626-631` owns the only retrier call to `internal.calendar.createEvent`; `calendar.ts:24,196` owns the primary-calendar insert. |
| Google event management after creation | **GAP** | No update, move, cancel, delete, ETag, `If-Match`, or 412-concurrency path exists. Only `freeBusy` and `createEvent` are exported by the Calendar adapter. |
| Microsoft/Outlook scheduling and management | **GAP** | No Microsoft Graph Calendar endpoint, OAuth grant/token path, adapter, action type, or completion terminal exists. The plan card explicitly promises Google Calendar. |

**ACTN-02 remains correctly unchecked and Pending.** It must not be marked complete from the
narrow Google-create result.

## Narrow Phase Must-Haves

| ROADMAP success criterion | Result | Actual code/test evidence |
|---|---|---|
| Availability is read in-loop; an event is proposed; creation occurs only after human approval | **CODE-VERIFIED / LIVE OPEN** | `checkAvailability` and `proposeCalendarEvent` are in the one tool record (`llm.ts:2314,2362`). `dispatchGuard.test.ts:116` positively anchors the read and forbids Calendar writes from `llm.ts`. `executePlan` routes `calendar_event` through the external target table (`cockpit.ts:626-631`). The dedicated Calendar card begins at `cards.tsx:622`. |
| OAuth/refresh is reused and audit/DLQ carry refs, ids, counts, status, and reason codes only | **CODE-VERIFIED / LIVE CONSENT OPEN** | Both Calendar actions check persisted scope before shared token refresh. Availability audit is `{range,busyCount}`; successful terminal audit is `{planId,eventId}` at `calendarComplete.ts:73-75`; provider response messages are not terminal payloads. |
| Reads/writes are tenant-scoped and isolation assertions ship with the surface | **CODE/TEST PRESENT; CURRENT BEHAVIOR RUN TIMED OUT** | `calendar.test.ts:794` contains the non-vacuous tenant-isolation group, including same-input approvals, plan reads, distinct fixture reads, cross-tenant create refusal, and run-id ownership. Current execution of that file did not complete; see Automated Evidence. |

## Current Automated Evidence — 2026-08-10

| Gate | Result |
|---|---|
| `packages/core: npx vitest run src/calendar.test.ts src/emailIntent.test.ts src/actionType.test.ts` | **PASS — 3 files, 70/70 tests** |
| `packages/backend: npx vitest run convex/dispatchGuard.test.ts convex/traceParity.test.ts` | **PASS — 2 files, 17/17 tests** |
| `node scripts/check-playbooks.mjs` | **PASS — exit 0** |
| Five-file backend Calendar/Cockpit gate | **TIMEOUT — 71.8 s**; `traceParity` 2/2 and `dispatchGuard` 15/15 completed before the timeout, while the behavior files produced no final result |
| `npx vitest run convex/calendar.test.ts` | **TIMEOUT — 66.2 s**, no test result emitted |
| `npx vitest run convex/calendar.test.ts -t "freeBusy" --testTimeout=10000 --hookTimeout=10000` | **TIMEOUT — 55.3 s**, no test result emitted |

The timeout is recorded as current measurable evidence, not converted into a false pass or a
Calendar product failure. The last committed Phase 17 evidence remains historical: 17-04 recorded
73/73 across Calendar/Cockpit/guards, and the 2026-07-30 verification recorded 143/143 across the
five backend files. Current source has since accumulated later-phase changes, so those counts do
not replace a current behavior run.

## Evidence Review

### Governed staging and write boundary

- `packages/backend/convex/calendar.ts` defines exactly two provider targets: Google
  `freeBusy` and primary-calendar `events.insert` (`:23-24`).
- `packages/backend/convex/llm.ts:2362` stages the event. The current static guard proves it does
  not reference `calendar.createEvent`, a Calendar terminal, or the Approve mutation.
- `packages/backend/convex/cockpit.ts:626-631` is the Calendar create callsite behind the human
  mutation and action retrier.
- `packages/backend/convex/calendarComplete.ts:49` is the non-Node completion mutation and owns
  final status, audit, reconnect, and dead-letter handling.
- The deterministic provider id and HTTP 409-as-success branch provide idempotency for create;
  this does not implement update/cancel management.

### Privacy and tenant boundary

- Availability uses `freeBusy`, not `events.list`, so titles, descriptions, and attendee addresses
  are absent by construction.
- `calendar.ts` has no executable guest/invitation fields; static enforcement pins the absence of
  `attendees` and `sendUpdates`.
- Audit shapes are exact refs/counts shapes. Provider error bodies cannot become audit or DLQ text.
- The current isolation tests remain present at `calendar.test.ts:794`; their current run is
  unresolved because the behavior gate timed out.

### UI and trace

- `cards.tsx:622` has a Calendar-specific card, so a staged event does not fall through to email
  chrome.
- `traceParity.test.ts:61` proves every schema tool literal has a UI verb and vice versa.
- A source/parity test cannot prove the production SDK successfully persists and renders a live
  trace row; H2 remains necessary.

## Gaps

### G1 — Microsoft/Outlook Calendar is absent

**Severity:** requirement-blocking.

Implement a Microsoft OAuth/token adapter, availability read, governed write terminal, and the
same tenant/audit/idempotency guarantees. This should be additive behind the existing governed arm;
it is not a human-verification task.

### G2 — Calendar event management is absent

**Severity:** requirement-blocking.

Implement at least update/move and cancel/delete as explicit governed actions. Provider concurrency
must use an ETag/`If-Match`/412 design so a stale plan cannot overwrite a newer calendar edit. These
operations must stage for approval and must not be added as direct tool side effects.

### G3 — Shipped Google slice lacks owner live evidence

**Severity:** live-validation gate for the narrow phase, not a substitute for G1/G2.

No Phase 17 UAT evidence artifact records M1-M5 as completed. The existing file is a runbook, and
STATE still describes Phase 17 as `human_needed` for those checks.

### G4 — Current Convex behavior gate does not complete

**Severity:** verification-infrastructure gap.

The pure/static subsets pass, but the current Calendar behavior file timed out repeatedly before
emitting a test result. Diagnose the test harness/process lifecycle before using the current branch
as fresh automated proof of adapter, retrier-terminal, and tenant-isolation behavior.

## Minimal Remaining Human Steps

These steps validate only the shipped Google/create slice. They cannot close ACTN-02 until G1 and
G2 are implemented.

1. **Old-scope negative, before reconnect:** with a genuine pre-widening mail-only token, ask for
   availability. If that state is gone, edit only the stored scope to mail-only and label the result
   “simulated stored-scope.” Confirm the reconnect banner, normal reply, and usable thread; capture
   the notification row and absence of raw 403 text.
2. **Real availability, after reconnect:** reconnect through the one Google consent flow, confirm
   both Calendar scopes are persisted, create one known busy block, and request availability.
   Compare the interval and capture the exact `{range,busyCount}` audit payload. Confirm no title,
   description, or attendee content appears.
3. **Live stage and create:** stage a timed event with an unmistakable title. Capture both trace
   verbs and the Calendar card's exact time/duration; confirm no event exists before approval.
   Approve, then attempt a second approval. Capture one provider event, `status: done`, the stored
   `calendarEventId`, and exactly `{planId,eventId}` in `calendar.event.created`. Delete the UAT event.

## Final Assessment

The previous `human_needed` report correctly described the remaining live checks for the narrow
Google create-only phase, but it was too weak as the final ACTN-02 verdict. Current evidence supports
that narrow implementation and simultaneously proves that the literal requirement is incomplete.
The correct phase verifier status is therefore **`gaps_found`**.

---

*Verifier: Codex (goal-backward Phase 17 / ACTN-02 audit)*
