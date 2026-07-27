# Phase 17: Calendar Actions - Research

**Researched:** 2026-07-26
**Domain:** Google Calendar API v3 over the shipped Google-OAuth adapter; the ACTN-01 action-type spine
**Confidence:** HIGH (codebase findings verified by direct read; Google API findings verified against developers.google.com)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D1 — Mirror the shipped `gmail.ts` adapter; do not invent a second integration shape.**
The roadmap says this explicitly ("mirrors the shipped `gmail.ts` adapter pattern"). OAuth token
storage, refresh-on-expiry, and reconnect-prompt handling all already exist for Gmail
(`gmail.ts` / `gmailAuth.ts`, including the `kind: "gmail_reconnect"` surfaced error). Reuse that
shape. CLAUDE.md §8 rung 2: the pattern is already in this codebase.

**D2 — The write is an ACTION TYPE, never a tool side effect (SC#1, hard).**
Creating the event happens **only** after the human Approve gate fires `executePlan`. The tool
call stages; it does not create. This is the ACTN-01 spine and it is not negotiable:

- Add the member to `ACTION_TYPES` in `packages/core/src/actionType.ts` **and** its arm in the
  `ARMS` table. The `as const satisfies Record<ActionType, Arm>` bind means forgetting the arm is
  a COMPILE error — that is the designed behaviour, not an obstacle to route around.
- Pick the arm deliberately. `actionType.ts:15-20` already anticipates this phase: `workflow` =
  durable multi-step orchestration ("email today, calendar in Phase 17"), `inline` = a single
  transactional write. Decide from what a calendar write actually needs, and record why.
- `executePlan` stays a `tenantMutation`. **Approve is never a tool** — `dispatchGuard.test.ts`
  asserts this by source scan; do not weaken it.
- `deliverApprovedPlan.ts` is the workflow-backed EMAIL arm's entry point, **not** the universal
  dispatcher. Routing calendar through it would re-expose the gmail fan-out as reachable in
  principle from a calendar action.

**D3 — The read tool follows `listInbox`, including its §4 discipline.**
Read calendar availability in-loop. Audit rows carry **ids and counts only** — no event titles,
no attendee addresses, no free-text descriptions (CLAUDE.md §4). `mailbox.listed` (`{range,
resultCount}`) is the shape to copy. Attendee addresses are PII and must not reach the model-facing
context in raw form; the `buildRecipientView` index+label precedent (§2-D) exists for exactly this.

**D4 — Tenant scoping and an isolation assertion ship WITH the surface (SC#3).**
Every calendar read and write goes through the `convex/lib/functions.ts` tenant wrappers
(CLAUDE.md §2 — raw `query`/`mutation`/`action` imports are banned outside the wrapper module).
A cross-tenant isolation assertion ships in the same phase, not after it.

**D5 — Provider scope: decide and record, do not silently do both or neither.**
The roadmap names "Google / Microsoft". Shipping both doubles the OAuth surface for one phase.
Recommended: **Google first** (it reuses the existing Gmail OAuth client and consent flow most
directly), with the adapter boundary drawn so Microsoft is a later addition rather than a rewrite.
If research finds that reuse is thinner than it looks, say so and re-scope explicitly — do not
half-build both.

### Claude's Discretion

- The `agentSteps.tool` literals and their `VERB` labels.
- Whether availability rendering is a new card or reuses an existing panel component.
- The `plans` fields a staged event needs, and whether they warrant their own table.
- Test topology and which assertions get mutation-checked.

### Deferred Ideas (OUT OF SCOPE)

- Microsoft/Outlook calendar, if D5 lands on Google-first.
- Recurring events, free-busy negotiation across organizations, and automated scheduling without
  a human approval.
- (From the phase boundary) recurring-event rules, attendee negotiation / free-busy across external
  organizations, calendar-driven scheduling automation, and any standing rule that creates events
  without a human approval.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ACTN-02 | The agent can schedule and manage calendar events (Google / Microsoft) as governed actions | §Standard Stack (Google-only scope decision, D5 CONFIRMED); §Architecture Pattern 1 (read tool = `freeBusy.query`); §Architecture Pattern 2 (the third `Arm` literal + `retrier.run`); §Pitfall 1 (the scope-insufficiency gap `freshAccessToken` cannot see) |
| SC#1 — read in-loop, create only after Approve | Read tool mirrors `listInbox`; create is an action type behind `executePlan` | §Architecture Pattern 2 (why `inline` is structurally impossible and `workflow` is the gmail terminal → a THIRD arm is forced); §Anti-Patterns (what `dispatchGuard.test.ts` actually checks, and the 4th assertion this phase should add) |
| SC#2 — reuse OAuth-refresh/adapter pattern; refs/ids/counts only to audit | `freshAccessToken` + `gmailTokens` + `buildAuthorizeUrl` are Google-generic, not Gmail-specific | §Q1 transfer table; §Pitfall 1 (the ONE thing that does not transfer); §Audit Shape (`calendar.availability.listed` / `calendar.event.created`, and the 4 leak temptations) |
| SC#3 — tenant-scoped + isolation assertion shipped with the surface | `tenantQuery`/`tenantAction` wrappers; `dispatch.test.ts:520` two-tenant precedent | §Validation Architecture (test map, all offline-provable under `convex-test`) |
</phase_requirements>

---

## Summary

**The roadmap's "research likely skippable" claim is REFUTED — narrowly, but on four load-bearing
points.** D1's premise ("mirror `gmail.ts`") is not only CONFIRMED, the reuse is *thicker* than the
roadmap credits: `freshAccessToken`, `buildAuthorizeUrl`, the HMAC'd `state` round-trip, the
`gmailTokens` row (which already persists a `scope` string), the `flagExpiringTokens` 7-day-expiry
cron and the `gmail_reconnect` notification are all **Google-generic**, not Gmail-specific. A calendar
adapter reuses them verbatim. But four things would have been discovered mid-execution, each of
which changes the plan's file list or its governance surface:

1. **`executePlan` is a `tenantMutation` and a Convex mutation cannot `fetch`.** So the `inline` arm
   ("a single transactional write") structurally *cannot* create a calendar event, and the `workflow`
   arm falls straight into the gmail fan-out block (`cockpit.ts:544-558`). A **third `Arm` literal is
   forced** — the phase cannot be built with the two that exist.
2. **`freshAccessToken` returns `{ok: true}` for a token that lacks the calendar scope.** The refresh
   grant succeeds; the Calendar call then 403s on insufficient scope. Gmail never needed this check.
3. **Every already-connected user must re-consent** — Google does not retroactively widen an
   existing grant. This is a real user-facing migration, and it is mitigated to near-zero cost *only
   because* the app is in OAuth "Testing" status where refresh tokens die after 7 days anyway
   (`tokenExpiry.ts` already encodes this). You have to know that to size the migration correctly.
4. **Adding attendees to an event makes Google send invitation email on the app's behalf** — an
   outbound external communication that does not cross the plan → Approve → audit → DLQ spine at all.

**The single most valuable finding is a simplification, not a complication:** Google's
`freeBusy.query` returns *only* busy `{start, end}` ranges — no titles, no attendees, no
descriptions. It is the exact match for SC#1's "reads calendar availability", it is the only
**non-sensitive** calendar OAuth scope, and it makes the §4 / §2-D problem disappear by construction
rather than by a redaction layer. Use `freeBusy.query`, not `events.list`. That is CLAUDE.md §8 rung 4
(a native platform feature covers it) instead of rung 7.

**Primary recommendation:** Google-only (D5 confirmed). One `convex/calendar.ts` `"use node"` module
holding two internal actions (`freeBusy` read, `createEvent` write) reusing the exported
`freshAccessToken`; the calendar scope added to the ONE existing `buildAuthorizeUrl` (one connect
button, one token row, no second OAuth flow); a **third `Arm` literal** driven by
`retrier.run(ctx, internal.calendar.createEvent, …)` from `executePlan` — not `workflow.define`,
because a single idempotent POST with a client-supplied event id needs retry, not orchestration.

---

## Standard Stack

### Core — all already installed; **zero new dependencies**

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) — global `fetch` | Node 20+ | Google Calendar v3 HTTP calls | `gmail.ts` calls Google with bare `fetch`. `googleapis` is a ~40MB dep for three endpoints; adding it is rung-7 work where rung 3 holds. |
| `@convex-dev/action-retrier` | 0.3.1 (pinned) | Retry + terminal→DLQ routing for the one calendar POST | Already constructed at `convex/index.ts:14`. Exactly the "one action, retries, onComplete dead-letter" primitive the calendar arm needs. |
| `convex` | 1.42.1 | `internalAction` / `tenantQuery` / scheduler | The `"use node"` + `internalAction` shape is the sanctioned exception to the §2 import ban (`importGuard.test.ts:17` bans only lowercase `query`/`mutation`). |
| `@pikar/core` | workspace | `parseSendTime`, `tokenExpiry`, the pure calendar domain shape | CLAUDE.md §1 — domain logic is pure TS; `convex/calendar.ts` is the thin HTTP adapter. |

### Google Calendar API v3 endpoints (the whole surface this phase needs)

| Endpoint | Method | Purpose | Scope required |
|----------|--------|---------|----------------|
| `https://www.googleapis.com/calendar/v3/freeBusy` | **POST** | Availability read — returns `busy: [{start, end}]` ONLY | `calendar.freebusy` (**non-sensitive**) |
| `https://www.googleapis.com/calendar/v3/calendars/primary/events` | POST | Create the approved event | `calendar.events` (sensitive) |
| `https://oauth2.googleapis.com/token` | POST | Token refresh — **already implemented** (`gmail.ts:41`) | — |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `freeBusy.query` | `events.list` | `events.list` returns `summary`, `description`, `attendees[].email` — every one a §4/§2-D hazard needing a hand-built projection. `freeBusy` cannot leak them. Choose `freeBusy`. Upgrade path if a *specific* event must be named later: `events.list` with an explicit `?fields=` projection + a `buildRecipientView`-style index+label mapping. |
| Bare `fetch` | `googleapis` npm client | A 40MB dep, its own auth object, and it hides the URL from `llmRedaction`-style static endpoint scans — which are the codebase's actual governance mechanism. Refuse. |
| Third `Arm` + `retrier.run` | A second `workflow.define` | A workflow buys durable multi-step orchestration. This is one POST that cannot partially fail and is already exactly-once via a client-supplied event id. Workflow rows + latency for nothing. |
| Third `Arm` + `retrier.run` | `ctx.scheduler.runAfter(0, …)` | Scheduler runs once; a thrown action is NOT retried and there is no `onComplete` → no DLQ route. The retrier gives both, and `gmail.ts:8` documents it as the established shape. |
| Google-only | Google + Microsoft | Microsoft needs a second OAuth client, second redirect route, second token row (or a `provider` column on `gmailTokens`), and Graph's different event/free-busy shapes. Doubling the OAuth surface for one phase. **D5 CONFIRMED: Google only.** |

**Installation:** none. `pnpm install` unchanged; `pnpm-lock.yaml` untouched.

### OAuth scope decision

Add to the existing `GMAIL_SCOPE` constant in `gmailAuth.ts:15` (rename it — it is now the Google
scope set, not the Gmail one):

```
https://www.googleapis.com/auth/gmail.modify         (existing)
https://www.googleapis.com/auth/calendar.freebusy    (read — NON-SENSITIVE)
https://www.googleapis.com/auth/calendar.events      (write — sensitive)
```

`calendar.events` is the narrowest scope that can create an event (`calendar` full-access is
strictly wider and unnecessary). The verification tier does not move: `gmail.modify` is already at
or above `calendar.events`'s classification, and the app is in **Testing** publishing status where
no verification applies at all. (Confidence: MEDIUM on the exact sensitive/restricted label for
`gmail.modify`; HIGH that the tier does not *increase*.)

---

## Architecture Patterns

### Recommended file layout

```
packages/core/src/
├── calendar.ts             # NEW. Pure domain: the availability window + proposed-event shape,
│                           #   epoch↔RFC3339 conversion, the deterministic event-id derivation.
│                           #   Unit-testable with no Convex, no network (CLAUDE.md §1).
├── calendar.test.ts        # NEW.
└── actionType.ts           # EDIT (shared union — Wave 0). +1 ACTION_TYPES member, +1 Arm literal,
                            #   +1 ARMS row, widen actionTypeOf's param.

packages/backend/convex/
├── calendar.ts             # NEW. "use node". ONLY actions: freeBusy read + createEvent write.
│                           #   Reuses the EXPORTED freshAccessToken from gmail.ts.
├── calendar.test.ts        # NEW. convex-test; fetch stubbed.
├── gmailAuth.ts            # EDIT. Scope constant (+ a hasCalendarScope reader over the stored row).
├── cockpit.ts              # EDIT (shared — Wave 0/lane-owned). _ARM_TABLE row + the new arm case.
├── llm.ts                  # EDIT (shared — Wave 0). The in-loop read tool + the staging write tool.
├── schema.ts               # EDIT (shared — Wave 0). agentSteps.tool literals; plans.kind widened;
                            #   the staged-event fields on `plans`.
├── dispatchGuard.test.ts   # EDIT. Append the calendar assertion below the :75 marker.
└── llmRedaction.test.ts    # EDIT (or a sibling scan in calendar.test.ts). POST-target scan for
                            #   calendar.ts — see Anti-Patterns.

apps/web/app/(app)/dashboard/workspace/cards.tsx   # EDIT (shared — Wave 0). VERB entries.
docs/playbooks/watch.json                          # EDIT (Wave-0 singleton). Register the new paths.
docs/playbooks/cockpit.md                          # EDIT. Append a `## Phase 17` section.
```

**Playbook registration (CLAUDE.md §9 — the Stop hook blocks without it):** every neighbour file
(`gmail.ts`, `gmailAuth.ts`, `http.ts`, `llm.ts`, `cockpit.ts`, `plans.ts`, `actionType.ts`,
`workspace/`) is already mapped to `cockpit.md` in `watch.json`. Register
`packages/backend/convex/calendar.ts`, `calendar.test.ts` and `packages/core/src/calendar*.ts`
under **`cockpit.md`** too — rung 2, no new playbook file. (A standalone `calendar.md` is defensible
only if the planner decides the surface is big enough to have its own invariants section; the
cheaper answer is right here.)

---

### Pattern 1 — The read tool: `freeBusy.query`, mirroring `listInbox`

**What:** an in-loop read-only tool that returns *when the user is busy*, never *what they are doing*.

**Why `freeBusy` and not `events.list`:** the response contains only `{start, end}` ISO strings per
calendar. There is structurally nowhere for a title, a description or an attendee address to appear —
which is exactly the property `agentSteps` bought by having no text field (`schema.ts:460-464`). It
also happens to be the only non-sensitive calendar scope.

**Verified response shape** (`POST https://www.googleapis.com/calendar/v3/freeBusy`):
```json
{ "timeMin": "...", "timeMax": "...",
  "calendars": { "primary": { "busy": [ { "start": "...", "end": "..." } ], "errors": [] } } }
```
Limits: max 50 calendars per query; group expansion max 100. No documented max time range.

**The `listInbox` properties to copy verbatim** (`gmail.ts:417-500`, `llm.ts:1160-1198`):

| `listInbox` property | Calendar analogue |
|---|---|
| `range` is a closed ENUM in `inputSchema`, never a free string — it flows into the audit payload | Same: `range: "today" \| "tomorrow" \| "week"`. Model prose must not reach the audit. |
| Fixture seam checked **BEFORE** the token, so the offline E2E needs no mailbox | A `calendarFixtures` row (or reuse of the `inboxFixtures` idiom) checked before `freshAccessToken`. Written only by an internal mutation → unreachable for a real tenant. |
| ONE refs-only audit event per successful read; a FAILED read audits nothing | `calendar.availability.listed` → `{range, busyCount}`. Failure → no audit, nothing was read. |
| Never throws on a dead token — returns `{ok:false, reason}` and the caller lights the reconnect banner | Same. Reuse the `mailboxUnavailable` shape (`llm.ts:656-663`): `notifications.notify` + a conversational fallback string. A calendar we cannot read is a recoverable conversation, never a throw out of the governed loop. |
| Explicit return type on the action (Convex guidelines §96 — avoids the circular-inference collapse) | Same. Non-negotiable in this codebase; `llm.ts` inference dies without it. |

**One divergence to note in the plan:** `freeBusy` is a **POST**. The gmail invariant "every mailbox
READ is a GET; a POST is a write verb" (`llmRedaction.test.ts:131-144`) does **not** carry over. A
calendar POST-target scan must therefore whitelist three targets by NAME and assert the *write*
target is unreachable from `llm.ts` — it cannot infer safety from the HTTP method.

---

### Pattern 2 — The write: a THIRD `Arm` literal, driven by `retrier.run`

**This is the phase's central architectural decision. The two existing arms are both structurally wrong.**

**`inline` is impossible.** `executePlan` is a `tenantMutation` (`cockpit.ts:517`) and
`dispatchGuard.test.ts:95-102` pins that exact source string, for two stated reasons — an *action*
could be invoked from the tool loop, and the CAS on `plan.status` needs mutation serializability. A
Convex **mutation cannot `fetch`**. `inline`'s own definition is "a single transactional write"
(`actionType.ts:21`) — a DB write, executed in the mutation. A calendar event is an *external side
effect*, not a DB write. `inline` cannot express it.

**`workflow` is wrong, and the code says so in its own comment.** `cockpit.ts:496-505`:

> "The `workflow` case in executePlan below IS the gmail fan-out (seed requests → startFanout →
> deliverApprovedPlan). A new ActionType that merely classified as `workflow` would therefore
> inherit the EMAIL terminal silently."

`case "workflow": break;` (`cockpit.ts:554-555`) falls through to the mailbox pre-check → CAS →
seed `requests` rows → `startFanout`. Classifying calendar as `workflow` does exactly what D2 forbids.

**What a calendar create actually needs — the four questions CONTEXT asks:**

| Question | Answer | Consequence |
|---|---|---|
| Does it fan out? | **No.** One event, one calendar, one POST. | No workflow needed. |
| Can it partially fail? | **No.** There is no "half an event". | The per-recipient try/catch isolation that justifies `deliverApprovedPlan` has no analogue. |
| Does it need retry? | **Yes.** Calendar returns 403 `rateLimitExceeded` / `userRateLimitExceeded`, 429, and 5xx. | Retry with backoff — the **action-retrier's** job. |
| Does it need durability? | **Only exactly-once.** | Free: `events.insert` accepts a **client-supplied `id`** (base32hex, 5–1024 chars) and returns **409 `duplicate`** on collision. Derive the id from `planId` → a retried create either succeeds or 409s, and 409 *means success*. Stronger than anything a workflow gives you. |

**Recommendation:** add a third `Arm` literal (name it for what it does — e.g. `"externalAction"`),
and implement the case as `retrier.run(ctx, internal.calendar.createEvent, { planId, tenantId })`
followed by `ctx.db.patch(planId, { status: "delivering", correlationId })`. The retrier is already
constructed (`convex/index.ts:14`) and gives retries **plus** the `onComplete` → dead-letter route
for free — the exact shape `gmail.ts:8` documents as the pipeline's original send path. No
`workflow.define`, no workflow rows, no second `deliverApprovedPlan`.

**Three compile sites break the day `ACTION_TYPES` grows. Visit all three; route around none:**

1. `packages/core/src/actionType.ts:27` — `ARMS … satisfies Record<ActionType, Arm>`
2. `packages/backend/convex/cockpit.ts:505` — `_ARM_TABLE … satisfies Record<ActionType, Arm>`
   (the deliberate second bind; its comment names precisely this moment)
3. `packages/backend/convex/cockpit.ts:556-557` — `default: return assertNever(armType)` stops
   compiling until the new arm has a `case`.

**Plus two type widenings that are easy to miss:**
- `actionType.ts:13` — `actionTypeOf(kind: "memo" | undefined)` must accept the new literal.
- `schema.ts:246` — `kind: v.optional(v.literal("memo"))` must become a `v.union` of literals.
  Absent still means "email", so **no migration and no backfill** (the `sendAt`/`attachments`
  precedent). This is a `schema.ts` edit → a PARALLELIZATION Stage-1 / Wave-0 freeze item.

---

### Pattern 3 — Timezone: one clock, already built. Do not add a second.

The §2-D rule is already fully implemented and the calendar path must ride it end to end:

| Layer | Existing artefact | Calendar use |
|---|---|---|
| Trusted client supplies the clock | `clientContext: v.optional(v.object({ tz: v.string(), nowMs: v.number() }))` — `cockpit.ts:84`, `llm.ts:2038`, `llm.ts:2198`; threaded into `buildCockpitTools` as its 4th arg (`llm.ts:633`) | The staging tool reads `clientContext.nowMs` / `.tz`. **The model never supplies an instant.** |
| NL time → ONE absolute epoch | `parseSendTime(text, nowMs, tz)` — `packages/core/src/emailIntent.ts:201+`, already tz-injected and unit-tested (`emailIntent.test.ts:209`) | Reuse verbatim for "next Tuesday at 3". Do not write a second parser. |
| Storage | `plans.sendAt: v.optional(v.number())` — "the ONE source of truth … an absolute epoch ms; never a wall-clock string or a tz pair (the Tier-1-compatibility rule, `scheduled-send.md`)" — `schema.ts:217-222` | Store the event start as **one epoch ms** on the plan, same rule. Duration as ms, not an end-string. |
| Human-readable confirmation | `fmtSendInstant(ms, tz)` — `llm.ts:471` | Reuse for the plan card / agent context line. |
| Offline determinism | `SMOKE_NOW_MS = Date.UTC(2020,0,1,12,0,0)` — `llm.ts:1877` | The calendar SMOKE op pins the same clock so a `"in 2 hours"` staging op resolves deterministically with zero model calls. |

**Conversion happens at the adapter boundary ONLY.** `convex/calendar.ts` turns `{epochMs, tz}` into
`{"dateTime": <RFC3339>, "timeZone": <IANA>}` immediately before the POST. Nothing upstream of that
line holds an RFC3339 string.

**All-day events are the one genuine gap.** Calendar's `start`/`end` take *either* `date`
("yyyy-mm-dd", no `timeZone`) *or* `dateTime` + `timeZone`. Sending both is a 400. An all-day event
cannot be derived from an epoch — it needs a boolean on the plan row. **Recommendation: defer
all-day** (timed events only), with a `ponytail:` comment naming the ceiling and the upgrade path
(one `allDay: v.optional(v.boolean())` field + a branch at the adapter boundary). `timeZone` is
*required* for recurring events — which is precisely why CONTEXT deferring recurrence is correct.

---

### Pattern 4 — The audit shape (§4)

Copy `mailbox.listed` exactly (`gmail.ts:426-433`):

```ts
await ctx.runMutation(internal.audit.log, {
  tenantId, correlationId,
  eventType: "calendar.availability.listed",
  actor: "system",
  payload: { range, busyCount },     // enum literal + a count. Nothing else.
});
```

For the write: `calendar.event.created` → `{ planId, eventId }`. The Google `eventId` is an opaque
ref, not content — the `workflowId`/`storageId` precedent.

**The four places the temptation to log a title will arise. Name them in the plan:**

1. **The tool's return string in `llm.ts`.** `listInbox` deliberately returns sender *display names*
   + subjects to the model (`llm.ts:1194-1197`) — a §2-D judgement call. `freeBusy` hands you nothing
   to leak; keep the return string to counts and times. Do not "enrich" it with `events.list`.
2. **`agentSteps`.** It has no text field *by construction* (`schema.ts:460-464`; `count` is declared
   and deliberately unwritten). The `VERB` map (`cards.tsx:1107`) is code-owned and keyed off the
   closed union. **Do not add a text field** — that re-opens the hole the union closed.
3. **The dead-letter payload — the sharpest leak in this phase.** `deadLetterRecipient` takes
   `error: String(e)`. A Google Calendar 400/409 error body can **echo the event `summary` back**.
   Stringify the *status and reason code* (`409 duplicate`, `403 rateLimitExceeded`), never the
   response body.
4. **The plan row is where content belongs.** `schema.ts:184-216` states it outright: raw content
   lives in `plans`, NEVER in audit/DLQ. Event title / description / attendee list go on the plan
   row alongside `recipients` / `body` / `recipientBodies`, and they are wiped by the same reset path.

---

### Anti-Patterns to Avoid

- **Creating the event inside a tool call.** The whole phase. See the guard analysis below.
- **Classifying calendar as `workflow`** — inherits the gmail fan-out terminal (`cockpit.ts:496-505`).
- **Routing calendar through `deliverApprovedPlan.ts`** — D2, explicitly. That file is byte-unchanged
  by Phase 15 on purpose; keep it that way.
- **Adding attendees with `sendUpdates: "all"` / `"externalOnly"`** — Google then sends invitation
  email on the app's behalf. That is an outbound external communication with **no plan, no audit, no
  DLQ, no redaction scan** — it bypasses the entire governance spine. Either put attendees out of
  scope for this phase, or pin `sendUpdates: "none"` as a literal and add a static-scan test that no
  other value can appear. (Default for `events.insert` is already no-notification, but relying on a
  default for a governance property is not acceptable here.)
- **A second OAuth flow / second token table for calendar.** One Google grant, one row, one connect
  button, one reconnect banner.
- **Using `events.list` for the availability read** — see Pattern 1.
- **A `provider: v.string()` field "for Microsoft later"** — unrequested scaffolding (rung 1). Add it
  in the phase that adds Microsoft.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Google access-token refresh | A calendar-specific refresh | **`freshAccessToken(ctx, tenantId)`** — exported from `gmail.ts:32` | It is already "the ONE token-refresh root" by explicit design (`gmail.ts:27-31`, root-cause discipline). A second one is the exact duplication CLAUDE.md §8 forbids. |
| OAuth `state` / CSRF binding | A nonce table | **`buildAuthorizeUrl` / `verifyState`** (`gmailAuth.ts:43-66`) | HMAC over the tenantId with the client secret. Zero calendar-specific logic. |
| Token storage + 7-day expiry banner | A `calendarTokens` table + a second cron | **`gmailTokens` + `flagExpiringTokens`** (`gmailAuth.ts:75-185`) | The 7-day window is a property of the **Google grant**, not of Gmail. One row, one clock, one `gmail_reconnect` notification covers both surfaces. |
| "Next Tuesday at 3pm" → an instant | A date parser or a date library | **`parseSendTime`** (`packages/core/src/emailIntent.ts`) | Already tz-injected, deterministic, unit-tested, and dependency-free by a recorded decision ("a dep is non-deterministic across versions and can't be tz-injected cleanly", `emailIntent.ts:203`). |
| Wall-clock rendering | `toLocaleString` sprinkled around | **`fmtSendInstant`** (`llm.ts:471`) | One formatter, one zone source. |
| Exactly-once event creation | A dedup table, a claimed-lock row, a "created" flag | **A client-supplied `events.insert` `id`** → 409 `duplicate` on retry | Google gives idempotency for free. A dedup table is a whole consistency problem invented to solve a solved one. |
| Retry + dead-letter for the create | A retry loop in the action | **`retrier.run(ctx, internal.calendar.createEvent, …)`** | Backoff + `onComplete` → DLQ already wired (`convex/index.ts:14`, `deadLetter.ts`). |
| Free/busy computation from event lists | Merging/sorting event intervals | **`freeBusy.query`** | Google merges overlapping busy blocks server-side and returns no content. Building it yourself means pulling full events — i.e. re-opening the PII surface to solve a problem Google already solved. |
| Redacting calendar content from the model | A projection/redaction layer over events | **Not fetching it** (`freeBusy`) | The strongest redaction is a response shape with nowhere to put the secret. |

**Key insight:** almost everything this phase needs is already built and is Google-generic rather
than Gmail-specific. The genuinely new code is ~2 HTTP calls, 1 arm case, 2 tools, and the tests. If
the plan's diff is much bigger than that, something is being re-implemented.

---

## Common Pitfalls

### Pitfall 1 — `freshAccessToken` succeeds for a token that has no calendar scope (HIGH)

**What goes wrong:** a user connected before Phase 17 holds a refresh token granted for
`gmail.modify` only. `freshAccessToken` POSTs the refresh grant, Google returns a perfectly valid
access token, and the function returns `{ok: true}`. The Calendar call then fails **403 insufficient
authentication scopes** — a code path no existing handler covers, arriving *after* the user
approved a plan.

**Why it happens:** OAuth scope lives on the *grant*, not on the *token exchange*. The refresh
succeeding says nothing about which scopes it covers. Gmail never had to distinguish these because
it only ever used one scope.

**How to avoid:** the fix is already sitting in the schema — `gmailTokens.scope: v.string()` is
persisted from the callback (`http.ts:71`, `gmailAuth.ts:81`). Check it **before** the API call and
return the existing `{ok:false, reason:"not_connected"}`-flavoured reconnect signal:

```ts
// convex/gmailAuth.ts — beside getTokens. Reuses the row that already exists.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const hasScope = (scope: string, want: string) => scope.split(" ").includes(want);
```

Belt-and-braces: also treat a 403 whose reason is a scope error as `reason:"reauth"` rather than as a
retriable failure — otherwise the retrier burns its attempts on a permanent condition, exactly the
failure mode `gmail.ts:172` documents for a dead token.

**Warning signs:** the reconnect banner never lights but calendar calls 403 in production; the
retrier DLQs a plan that a reconnect would have fixed.

---

### Pitfall 2 — Every already-connected user must re-consent (MEDIUM impact, HIGH confidence)

**What goes wrong:** the calendar scope is added, tests pass, and existing beta users silently cannot
use the feature until they click Reconnect.

**Why it happens:** Google does not retroactively widen an existing grant. `include_granted_scopes=true`
(already set at `gmailAuth.ts:51`) means a **new** authorization returns a token covering the union of
old and new scopes — it does not touch tokens already issued.

**How to avoid — and why this is nearly free here:** the app is in OAuth **Testing** publishing
status, where authorizations expire **7 days from consent** (this is exactly what
`REFRESH_TOKEN_TTL_MS = 7 days` in `packages/core/src/tokenExpiry.ts` encodes, and what
`flagExpiringTokens` already nags about). The beta cohort therefore re-consents at least weekly
already, and the delivery vehicle — the `gmail_reconnect` notification + `/connect-gmail` page — is
shipped. Adding the scope to the single existing `buildAuthorizeUrl` means the next routine reconnect
grants calendar with **zero new UI and zero migration code**.

Two things the plan should still do: (a) reword the reconnect copy so it does not say "Gmail" only,
and (b) have the calendar surfaces report "not connected" via the same banner when the scope is
absent (Pitfall 1), so a user who has not yet cycled gets a working prompt rather than a 403.

**Do NOT build:** a second authorize URL for incremental calendar-only consent. It works (the union
token would be correct, and `store` replaces the row so the 7-day clock resets correctly), but it is a
second flow, a second callback consideration, and a second button for a problem the weekly cycle
already solves.

---

### Pitfall 3 — Attendees silently send email outside the governance spine (HIGH)

**What goes wrong:** `events.insert` with `attendees: [...]` and `sendUpdates: "all"` makes Google
email every attendee. That email has no plan, no `requests` row, no audit event, no DLQ, and never
passed the PII scan. The system's central claim — every outbound communication crosses the Approve
gate and is audited — quietly becomes false.

**Why it happens:** it reads like a field on a JSON body, not like a send verb.

**How to avoid:** put attendees out of scope for Phase 17 (a self-calendar hold is the whole of SC#1),
or pin `sendUpdates: "none"` as a literal with a static-scan test forbidding `"all"` / `"externalOnly"`
in `calendar.ts` — the `llmRedaction.test.ts:121-127` "forbidden endpoint substring" idiom applied to
a parameter value.

**Warning signs:** an attendee reports receiving mail the audit log has no record of.

---

### Pitfall 4 — The new tool literal is missing from the closed `agentSteps.tool` union (MEDIUM, and it fails SILENTLY)

**What goes wrong:** the step-trace insert throws, the AI SDK **swallows it**, and there is no
"Checking your calendar…" row in production while every test passes.

**Why it happens:** documented twice already in `schema.ts` — at `:439-442` (searchVault) and
`:443-446` (evaluateBusiness), both flagged as "Research Pitfall". It has bitten this codebase twice.

**How to avoid:** add the literals to `schema.ts:416-455` **and** the matching `VERB` entries at
`cards.tsx:1107` in the same change. Per PARALLELIZATION these are the Wave-0 / Stage-1 shared-union
freeze items that Lane R also touches — land them in the freeze commit, not in a lane.

---

### Pitfall 5 — Calendar's read is a POST, so the gmail "POST ⇒ write" invariant does not carry

**What goes wrong:** a plan copies `llmRedaction.test.ts:131-144` ("the ONLY POSTs are TOKEN_ENDPOINT
and SEND_ENDPOINT") and either the scan is wrong or the author concludes `freeBusy` must be a GET.

**Why it happens:** the gmail invariant is genuinely method-based because every mailbox read *is* a GET.

**How to avoid:** write the calendar scan target-by-NAME, three allowed constants
(`TOKEN_ENDPOINT`, `FREEBUSY_ENDPOINT`, `EVENTS_INSERT_ENDPOINT`), and add the assertion that
actually matters: **`EVENTS_INSERT_ENDPOINT` is unreachable from `llm.ts`** — the method tells you
nothing here, the call graph does.

---

### Pitfall 6 — `events.insert` id format (LOW, but a 400 at the last step)

Client-supplied event ids must be **base32hex** (`0-9a-v`), length **5–1024**, unique per calendar.
`crypto.randomUUID()` contains `w`–`z` and hyphens → rejected. Derive it, e.g. lowercase base32hex of
a hash of the `planId`. Pure, unit-testable, belongs in `packages/core/src/calendar.ts`.

---

### Pitfall 7 — Optimistic concurrency on update (LOW this phase, HIGH if update is in scope)

Calendar supports `ETag` + `If-Match`; a stale write returns **412 `conditionNotMet`**. If the phase
adds an update path, it must read → `If-Match: <etag>` → refuse on 412 and re-read. `If-Match: *`
force-overwrites and must not be used for a user's calendar. **Recommendation: create-only this
phase** — the SC only requires create, and "manage" without concurrency control is a data-loss path.

---

## Code Examples

### The availability read (adapter boundary)

```ts
// packages/backend/convex/calendar.ts — "use node"; ONLY actions (01-07 rule).
// Source shape verified: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";

const res = await fetch(FREEBUSY_ENDPOINT, {
  method: "POST",
  headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    timeMin: new Date(fromMs).toISOString(),
    timeMax: new Date(toMs).toISOString(),
    timeZone: tz,                       // the TRUSTED client's zone (§2-D)
    items: [{ id: "primary" }],
  }),
});
// → { calendars: { primary: { busy: [{ start, end }], errors: [] } } }
// No titles. No attendees. Nothing to redact.
```

### The event create (behind the Approve gate, retrier-driven)

```ts
// Source: https://developers.google.com/workspace/calendar/api/guides/create-events
//         https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
const EVENTS_INSERT_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const res = await fetch(EVENTS_INSERT_ENDPOINT, {
  method: "POST",
  headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    id: eventIdFor(planId),             // base32hex — makes a retry idempotent (409 = already done)
    summary: plan.eventTitle,           // CONTENT plane: from the plan ROW, never a model arg
    start: { dateTime: new Date(plan.eventStartMs).toISOString(), timeZone: tz },
    end:   { dateTime: new Date(plan.eventEndMs).toISOString(),   timeZone: tz },
    // attendees: OUT OF SCOPE — Google would email them outside the governance spine (Pitfall 3).
  }),
});
if (res.status === 409) return { created: true, duplicate: true }; // idempotent retry — success
if (res.status === 403 /* scope */) return { created: false, reason: "reauth" }; // never throw
if (!res.ok) throw new Error(`calendar insert ${res.status}`);      // 5xx/429 → retrier retries
```

### The arm, in `executePlan` (`cockpit.ts`)

```ts
const armType = armFor(actionTypeOf(plan.kind));
switch (armType) {
  case "inline": { /* memo — unchanged */ }
  case "externalAction": {                       // ← the NEW third arm
    await ctx.db.patch(planId, { status: "approved" });
    const correlationId = crypto.randomUUID();   // server-minted, mirrors the fan-out
    await retrier.run(ctx, internal.calendar.createEvent, { planId, tenantId: ctx.tenantId, correlationId });
    await ctx.db.patch(planId, { status: "delivering", correlationId });
    return { ok: true };
  }
  case "workflow": break;                        // → the EXISTING gmail fan-out block
  default: return assertNever(armType);
}
```

### The isolation assertion (SC#3) — the `dispatch.test.ts:520` precedent

```ts
// Two tenants, the SAME planId-shaped input; assert no row crosses AND that each side
// wrote something (the anti-vacuity floor dispatch.test.ts:554-555 establishes).
expect(a.length, "tenant A wrote no rows — the isolation check is vacuous").toBeGreaterThan(0);
expect(b.length, "tenant B wrote no rows — the isolation check is vacuous").toBeGreaterThan(0);
```

---

## The Approve-gate guard: what `dispatchGuard.test.ts` actually checks

Read in full. It asserts four things; understand each before touching the tool surface.

| Line | Assertion | Phase-17 impact |
|---|---|---|
| :25-31 | `dispatch.ts` contains zero `generateText` call sites | Untouched. |
| :49-71 | `llm.ts` has EXACTLY ONE **tool-bearing** `generateText` call | Adding tools does not add a call site. Safe — **unless** a calendar tool internally calls `generateText` (e.g. to phrase an event title). **Do not.** |
| :95-102 | `cockpit.ts` literally contains `export const executePlan = tenantMutation({` | **Do not change that declaration.** This is why `inline` cannot fetch and why a third arm is forced. |
| :104-123 | No key of the `llm.ts` tool record is `executePlan`/`approvePlan`/`deliverApprovedPlan`; requires **≥20** `name: tool({` keys as a non-vacuity floor | Phase 17 *raises* the count. Safe, and the comment already anticipates "Phases 16-19 add tools". |
| :125-137 | `llm.ts` contains **no textual reference** (comments stripped) to `internal\|api.cockpit.executePlan` or `deliverApprovedPlan` | The strongest one. A calendar tool must never `ctx.runMutation` toward the gate, nor `scheduler.runAfter` to it. |

**What the phase should ADD (append below the `:75` marker so lanes do not collide):** a fifth
assertion mirroring :125-137 — `llm.ts` holds no reference to `internal.calendar.createEvent` (or
whatever the write action is named), and `calendar.ts`'s `EVENTS_INSERT_ENDPOINT` constant appears in
exactly one module. That is the calendar analogue of "zero sends before Approve", and it is the
cheapest possible enforcement of SC#1.

---

## State of the Art

| Old approach | Current approach | Impact on this phase |
|---|---|---|
| `plan.kind === "memo"` ad-hoc branch (12-05) | `armFor(actionTypeOf(plan.kind))` exhaustive switch + `assertNever` (15-05) | The seam exists; adding an action type is a compile-guided edit, not a spine rewrite. |
| `googleapis` npm client (the usual tutorial path) | Bare `fetch` against documented endpoints | Keeps the URL visible to the static endpoint scans that are this codebase's real governance mechanism. |
| `sendNotifications` (deprecated) | `sendUpdates` (`"all"` / `"externalOnly"` / `"none"`) | Use `sendUpdates`; do not copy older snippets. |
| Google Calendar docs at `developers.google.com/calendar/*` | Now `developers.google.com/workspace/calendar/*` | Older links redirect; cite the `workspace` paths. |

**Deprecated / not applicable here:** `sendNotifications`; Calendar API v2; `calendar` (full) scope
where `calendar.events` + `calendar.freebusy` suffice.

---

## Open Questions

1. **The third `Arm` literal's name.**
   - Known: a third literal is structurally required (a mutation cannot fetch; `workflow` is the gmail terminal).
   - Unclear: `"externalAction"` vs `"retried"` vs `"externalWrite"`. `Arm` names *how* it executes, not *what* it is — so a name describing the mechanism (an external call driven by the retrier) beats one naming the feature, or Phase 18/19 will add a fourth for no reason.
   - Recommendation: planner's call, but it must generalize to Phase 18/19's external writes.

2. **All-day events.**
   - Known: `date` and `dateTime` are mutually exclusive; all-day cannot be derived from an epoch.
   - Unclear: whether "block out Friday" is a beta-relevant ask.
   - Recommendation: **defer**, with a `ponytail:` comment naming the upgrade (one optional boolean + one branch at the adapter boundary).

3. **Update / cancel ("manage" in the requirement text).**
   - Known: SC#1-3 only require *create*. Update needs ETag/`If-Match`/412 handling.
   - Unclear: whether the owner reads "manage" as in-scope.
   - Recommendation: **create-only**, recorded explicitly. A "manage" without concurrency control is a data-loss path; adding it later is additive (a second action type + arm reuse).

4. **`plans` fields vs. a `calendarEvents` table** (CONTEXT lists this as Claude's discretion).
   - Known: `plans` is already the content plane and already carries optional feature-specific fields (`sendAt`, `attachments`, `replyThreadId`) with no migration.
   - Recommendation: **optional fields on `plans`** — three or four of them. A new table needs its own tenant index, its own isolation assertion and its own lifecycle for one row per plan. Rung 2.

5. **`gmailTokens` table name.**
   - Known: the row is now a *Google* grant covering two products.
   - Recommendation: **do not rename.** A Convex table rename is a migration for a cosmetic gain; a comment costs nothing. (Flagging it so the planner does not spend the phase on it.)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.7 + `convex-test` 0.0.54, `environment: "edge-runtime"` (`@edge-runtime/vm`) |
| Config file | `packages/backend/vitest.config.mts` (`testTimeout: 20_000`; `include: ["convex/**/*.test.ts"]`; no watch mode) |
| Pure-TS package tests | `packages/core` — same Vitest, `packages/core/src/*.test.ts` |
| Quick run command | `pnpm --filter @pikar/backend exec vitest run convex/calendar.test.ts convex/dispatchGuard.test.ts` |
| Full suite command | `pnpm test` (turbo, all packages) — or `pnpm --filter @pikar/backend test` |
| Typecheck (the compile-error guarantees) | `pnpm typecheck` — **this is a real test here**: the `satisfies Record<ActionType, Arm>` binds and `assertNever` are enforced by `tsc`, not by Vitest |
| Known pre-existing red | `convex/audit.test.ts` (`auditCounts` unregistered) — documented since Phase 2, **not** a regression |
| Harness note | Any test exercising an audit-writing action must register the aggregate component (`gmail.test.ts:20-25` `harness()` idiom) or the real audit path throws "component not registered" |

### Phase Requirements → Test Map

| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|--------------|
| SC#1a | The availability read is in-loop and read-only: no write endpoint reachable from a tool | static scan | `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts` | ❌ Wave 0 (append below the `:75` marker) |
| SC#1b | `executePlan` is still `export const executePlan = tenantMutation({` | static scan | same | ✅ exists (`dispatchGuard.test.ts:95`) — must stay green |
| SC#1c | No calendar write name is a key of the `llm.ts` tool record; `llm.ts` holds no reference to the create action | static scan | same | ❌ Wave 0 (new assertion, mirrors `:125-137`) |
| SC#1d | An approved calendar plan creates the event; a plan in any other status creates nothing | unit (`convex-test`) | `pnpm --filter @pikar/backend exec vitest run convex/calendar.test.ts` | ❌ Wave 0 |
| SC#1e | Double-approve creates ONE event (CAS + the 409-duplicate path) | unit, stubbed `fetch` | same | ❌ Wave 0 |
| SC#2a | `calendar.availability.listed` payload is exactly `{range, busyCount}`; a FAILED read audits nothing | unit | same | ❌ Wave 0 |
| SC#2b | `calendar.event.created` payload carries `{planId, eventId}` and no title/attendee/description | unit + a substring-absence assert seeded with a distinctive title | same | ❌ Wave 0 |
| SC#2c | The dead-letter payload on a Calendar API error carries a status/reason, never the response body | unit, stubbed 400 whose body echoes the summary | same | ❌ Wave 0 |
| SC#2d | The adapter reuses `freshAccessToken` — a dead token returns `{ok:false}` and never throws | unit, stubbed refresh failure | same | ❌ Wave 0 |
| SC#2e | A token whose stored `scope` lacks the calendar scope is treated as reconnect-needed **before** any API call | unit (pure `hasScope` + one action test) | same | ❌ Wave 0 |
| SC#3 | Two tenants, same input → no row crosses; both sides wrote something (anti-vacuity) | unit (`convex-test`) | same | ❌ Wave 0 (`dispatch.test.ts:520-556` is the template) |
| ACTN-02 arm | Adding the action type without an arm is a **compile** error; the arm switch is exhaustive | typecheck | `pnpm typecheck` | ✅ mechanism exists (`actionType.ts:27`, `cockpit.ts:505`, `assertNever`) |
| ACTN-02 pure | Epoch↔RFC3339 conversion + base32hex event-id derivation | unit (pure) | `pnpm --filter @pikar/core exec vitest run src/calendar.test.ts` | ❌ Wave 0 |
| ACTN-02 tz | "in 2 hours" resolves off the trusted `nowMs`, tz-independent | unit (pure) | already covered by `emailIntent.test.ts:209` — reuse, do not duplicate | ✅ exists |
| ACTN-02 trace | The new `agentSteps.tool` literals insert without throwing; `VERB` has an entry for each | unit + a `cards.tsx`/`schema.ts` key-parity scan | `pnpm --filter @pikar/backend exec vitest run convex/agentSteps.test.ts` | ⚠️ partially — parity scan is new |

### Sampling Rate

- **Per task commit:** `pnpm --filter @pikar/backend exec vitest run convex/calendar.test.ts convex/dispatchGuard.test.ts` + `pnpm typecheck` (the compile-error guarantees are half the phase's enforcement).
- **Per wave merge:** `pnpm test` + `pnpm typecheck` + `node scripts/check-playbooks.mjs`.
- **Phase gate:** full suite green (modulo the documented `audit.test.ts` red) before `/gsd:verify-work`.

### What is offline-provable vs. what needs a live deployment vs. what needs owner consent

**This split is the honest answer to "can this phase be verified without the owner?" — it cannot, fully.**

| Tier | Criteria | Why |
|------|----------|-----|
| **Offline — no deployment, no network** (the large majority) | SC#1a-e, SC#2a-e, SC#3, the arm exhaustiveness, all pure-TS conversion/id logic, the trace-literal parity | `convex-test` runs Convex functions in-memory; every Google call is a stubbed `fetch`. The fixture-before-token seam (`gmail.ts:435-449` precedent) is what lets the whole read path run with no account at all. **Build the calendar fixture seam early — it is what keeps this tier large.** |
| **Live deployment, no Google account** | The `agentSteps` step rows actually appear in the workspace trace (the silently-swallowed-insert failure mode, Pitfall 4, passes every offline test by construction) | Requires `npx convex dev` in this worktree + `pnpm dev`. |
| **Live deployment + a real Google account + OWNER-GRANTED consent** | (a) the widened scope actually returns a token that can call Calendar; (b) `freeBusy` against a real calendar; (c) one real event created on Approve and visible in Google Calendar; (d) a real 403-insufficient-scope from a pre-widening token lights the reconnect banner | Only the owner can grant OAuth consent for the app's own Google account, and the Testing-status 100-test-user list is owner-controlled. **No agent can self-serve this.** |
| **Cannot be verified this phase** | That a *pre-existing* connected user's token lacks the scope (Pitfall 2) | Depends on a token issued before the change. Verify by connecting once, deploying the widened scope, and calling calendar **without** reconnecting — the expected result is the reconnect banner, not a crash. Worth scripting as the one live negative test. |

### Wave 0 Gaps

- [ ] `packages/backend/convex/calendar.test.ts` — covers SC#1d/1e, SC#2a-e, SC#3
- [ ] `packages/core/src/calendar.test.ts` — covers the pure conversion + event-id derivation
- [ ] Appended assertions in `packages/backend/convex/dispatchGuard.test.ts` (below the `:75` marker) — covers SC#1a/1c
- [ ] A calendar POST-target scan (3 named constants; write target unreachable from `llm.ts`) — new, or appended to `llmRedaction.test.ts`
- [ ] A `sendUpdates` value scan if attendees are in scope at all (Pitfall 3)
- [ ] The offline **calendar fixture seam** (the `inboxFixtures` analogue) — a prerequisite for keeping the offline tier large; must be checked BEFORE `freshAccessToken`
- [ ] `docs/playbooks/watch.json` registration for the new paths under `cockpit.md` (Wave-0 singleton per PARALLELIZATION; the Stop hook blocks without it)
- [ ] Shared-union freeze items (Stage 1, on `main`, coordinated with Lane R): `schema.ts` `agentSteps.tool` literals + widened `plans.kind` + the staged-event fields; `cards.tsx` `VERB` entries; `actionType.ts` `ACTION_TYPES`/`Arm`/`ARMS`; `cockpit.ts` `_ARM_TABLE` + arm case
- [ ] Framework install: **none** — Vitest + convex-test are already present

---

## Sources

### Primary (HIGH confidence)

Codebase, read directly in `.worktrees/lane-k-calendar` at `lane-k/calendar-actions`:
- `packages/core/src/actionType.ts` (all 35 lines) — `ACTION_TYPES`, `Arm`, `ARMS`, `armFor`, `actionTypeOf`, `assertNever`
- `packages/core/src/tokenExpiry.ts` — `REFRESH_TOKEN_TTL_MS`, `isExpiringSoon`, `isDead`
- `packages/backend/convex/gmailAuth.ts` (all 205 lines) — scope const, `buildAuthorizeUrl`, `verifyState`, `store`/`getTokens`/`updateAccess`, `flagExpiringTokens`, `gmailStatus`
- `packages/backend/convex/gmail.ts` — `freshAccessToken` (:32-60), `listInbox` (:417-500), endpoint constants, the audit call (:426-433)
- `packages/backend/convex/cockpit.ts` — `_ARM_TABLE` (:505), `executePlan` (:517-630), `startFanout` (:462-477)
- `packages/backend/convex/deliverApprovedPlan.ts` (all 69 lines)
- `packages/backend/convex/dispatchGuard.test.ts` (all 137 lines)
- `packages/backend/convex/llmRedaction.test.ts` :121-144 (the POST-target scan)
- `packages/backend/convex/importGuard.test.ts` :1-42 (the §2 allow-list mechanics)
- `packages/backend/convex/schema.ts` — `plans` (:152-254), `agentSteps` (:411-476), `inboxFixtures` (:483-502), `notifications` (:537-544), `gmailTokens` (:548-555)
- `packages/backend/convex/llm.ts` — `fmtSendInstant` (:471), `buildCockpitTools` (:626-663), `mailboxUnavailable` (:656-663), `listInbox` tool (:1160-1198), `briefInbox` (:1200-1250), `clientContext` args (:2038, :2198), `SMOKE_NOW_MS` (:1877)
- `packages/backend/convex/http.ts` :14-77 (the OAuth callback; `scope` persistence at :71)
- `packages/backend/convex/dispatch.test.ts` :520-556 (the two-tenant isolation template)
- `packages/backend/convex/gmail.test.ts` :1-30 (the `harness()` aggregate-registration idiom)
- `packages/backend/vitest.config.mts`, `packages/backend/package.json`, root `package.json`
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` :1102-1130 (the `VERB` map)
- `docs/playbooks/watch.json`, `.planning/PARALLELIZATION.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` :602-611, `.planning/STATE.md`, `.planning/config.json`

Google official documentation:
- https://developers.google.com/identity/protocols/oauth2/web-server — `include_granted_scopes` semantics
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert — client-supplied `id`, `sendUpdates`, `start`/`end` shape, scopes
- https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query — POST, request/response shape, limits, scopes
- https://developers.google.com/workspace/calendar/api/guides/create-events — notification defaults, minimal body, `primary` alias
- https://developers.google.com/workspace/calendar/api/guides/errors — 409 `duplicate`, 412 `conditionNotMet`, 403 `rateLimitExceeded`/`quotaExceeded`
- https://developers.google.com/workspace/calendar/api/guides/performance — ETag / `If-Match` optimistic concurrency, `fields` partial response
- https://developers.google.com/identity/protocols/oauth2/scopes — Calendar scope sensitivity classification

### Secondary (MEDIUM confidence)

- Testing-status refresh tokens expire 7 days from consent — WebSearch, corroborated by multiple sources **and** independently by this codebase's own `REFRESH_TOKEN_TTL_MS` + the `flagExpiringTokens` cron, which were built against observed behaviour. Treated as HIGH in practice.
- https://support.google.com/cloud/answer/15549945 — Testing audience / 100-test-user cap

### Tertiary (LOW confidence — validate if it becomes load-bearing)

- The exact 403 reason string for insufficient scope (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`) is not in the Calendar errors page. **Mitigation makes this moot:** check the stored `gmailTokens.scope` *before* the call (Pitfall 1), so the phase never depends on parsing Google's error reason.
- The precise sensitive/restricted label for `gmail.modify`. Does not change the recommendation — the app is in Testing status where verification does not apply, and the calendar scopes do not raise the tier.

---

## Metadata

**Verdict on "research phase likely skippable" (ROADMAP :604):** **REFUTED, narrowly.** D1's premise
is confirmed and the gmail reuse is *thicker* than claimed. But four findings change the plan and
would have surfaced mid-execution: (1) `inline` cannot fetch, so a **third `Arm` literal is forced**;
(2) `freshAccessToken` cannot detect insufficient scope; (3) every connected user must re-consent
(cheap only because of the Testing-mode 7-day window); (4) attendee invites are an ungoverned
outbound email path. The offsetting simplification — `freeBusy.query` removes the calendar-PII
problem by construction — is worth more than the research cost on its own.

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| gmail adapter reuse surface | **HIGH** | Every file read directly; `freshAccessToken` and `buildAuthorizeUrl` are exported and Google-generic. |
| The arm decision (third literal + retrier) | **HIGH** | Follows from two verified facts: `executePlan` is a pinned `tenantMutation`, and `case "workflow"` falls into the gmail fan-out. Both read in source. |
| Calendar API shapes (freeBusy, insert, errors, ETag) | **HIGH** | Official `developers.google.com` reference pages. |
| OAuth re-consent migration | **HIGH** on the mechanism; **MEDIUM** on cohort impact | Mechanism from Google docs + the persisted `scope` field. Impact depends on how many beta users are currently connected. |
| Timezone approach | **HIGH** | `parseSendTime`/`fmtSendInstant`/`clientContext`/`sendAt` all read in source; the "one absolute epoch" rule is a written codebase decision. |
| Audit shape | **HIGH** | `mailbox.listed` read verbatim; the four leak points located by line number. |
| Scope-insufficiency error handling | **MEDIUM** | Detection design is HIGH (the stored `scope` string exists); the fallback 403-reason parsing is LOW and deliberately not depended on. |
| D5 Google-only | **HIGH** | Reuse measured file-by-file; Microsoft's cost enumerated. |

**Research date:** 2026-07-26
**Valid until:** ~2026-08-25 (30 days — Calendar API v3 and Google OAuth are stable; the codebase
findings are pinned to this worktree's commit and should be re-checked if the Stage-1 freeze lands
before planning)
