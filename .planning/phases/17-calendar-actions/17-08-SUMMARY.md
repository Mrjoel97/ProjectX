# 17-08 SUMMARY — governed calendar management: management, minus Microsoft delete

**Status: COMPLETE (Tasks 1, 2, 3).** ACTN-02 closes in ADR-023's own words — *management, minus
Microsoft delete*. It does **not** close against its original unqualified wording, and nothing in
this phase may be read as implying Microsoft cancellation exists.

| Task | Commit | What landed |
|---|---|---|
| 1 | `5323c63` | the durable managed-event registry, written before the plan is done |
| 2 | `6d5b394` | conditional management on both providers, minus Microsoft delete |
| 3 | this commit | the Approve-only arm, the management terminal, the lifecycle readback |

---

## 1. The registry lifecycle

`calendarEvents` is the record that makes a created event MANAGEABLE. Without a row carrying
`{provider, externalEventId, etag}` written at CREATE time, a later update is a read-modify-write
against a version nobody wrote down.

| Moment | Writer | What it writes |
|---|---|---|
| Create success | `onCreateComplete` → `calendarEvents.upsertManaged` | one active row, keyed `tenantId+provider+externalEventId`, **before** the plan is marked done |
| Create replay | same, idempotent | patches the same row; never a twin (`.unique()` on that index THROWS on a duplicate) |
| Legacy backfill | `migrateLegacyCalendarEvents` (operator-only, bounded, cursor-paged) | etag-ABSENT rows → `manageability` reports `needs_inspection` |
| Update success | `onManageComplete` → `calendarEvents.applyUpdate` | new etag + the state the PLAN staged, **before** the plan is marked done |
| Delete success | `onManageComplete` → `calendarEvents.markDeleted` | `status: "deleted"`. MARKED, never removed — "Pikar put this on a calendar and later took it off" is the point |
| Refusal / conflict / reauth | — | **nothing.** Both planes are left byte-unchanged |

**Order is the guarantee in both terminals.** Marking the plan done first would leave a done plan
whose provider event has moved while the row still describes the old state, with no signal anything
is stale. If the registry write throws, the mutation rolls back and the retrier redelivers against a
plan still at `delivering`.

**The state written comes from the PLAN's own staged fields**, never echoed out of the provider
result. An absent staged field means "leave it alone". The result crossing the retrier boundary
carries refs, ids, statuses and bounded codes only — no title ever enters it.

---

## 2. Result and audit tables

### `internal.calendar.manageEvent` → `ManageEventResult`

| Outcome | Carries | Meaning |
|---|---|---|
| `updated` | `managedEventId`, `provider`, `etag \| null` | the PATCH landed, or the provider already held the desired state |
| `deleted` | `managedEventId`, `provider` | the DELETE landed, or the event was already gone |
| `refused` | `code` (closed `CALENDAR_FAILURE_CODES`) | terminal and never retried — the plan is finished, wrongly |
| `reauth` | `provider` | recoverable; a reconnect fixes it, a retry does not |
| `terminal` | `status`, `reason` | bounded provider rejection → dead letter |

### Audit

| Event | Payload — EXACTLY these four keys | When |
|---|---|---|
| `calendar.event.updated` | `planId`, `managedEventId`, `provider`, `operation` | update success |
| `calendar.event.deleted` | `planId`, `managedEventId`, `provider`, `operation` | Google delete success |
| `deadletter.written` | `workflowId`, `kind`, `status` | terminal / failed / canceled run |
| *(none)* | — | refusal, conflict, reauth: no success audit may exist for an act that did not happen |

Never the title, never the etag, never a provider body. Asserted at RUNTIME on the stored rows, not
by a source scan.

### Failure codes

`CALENDAR_FAILURE_CODES` is now **eight**: `conflict`, `not_found`, `reauth`, `attendees_present`,
`needs_inspection`, `not_managed`, **`provider_unsupported`**, `provider_error`.

`provider_unsupported` is deliberately distinct from `provider_error`. The catch-all means "the
provider said no this time" and a card may offer a retry; this one means "we will never send this
request". Rendering them the same way promises the user a retry that cannot exist.

### Terminal plan states

| Outcome | Plan row |
|---|---|
| updated / deleted | `status: "done"` |
| refused (any code) | `status: "canceled"`, `cancelKind: "refused"`, `calendarFailureCode`, `canceledAt` |
| reauth | unchanged (`delivering`) + provider-specific reconnect notification |
| terminal | unchanged + dead letter |

`cancelKind: "refused"` is a new third literal. `approvals.ts` surfaces `cancelKind` as the
cancellation's PROVENANCE, so reporting a system refusal as a user `discarded` would attribute the
decision to the wrong actor. `reschedulePlan` excludes `refused` alongside `discarded`: re-arming it
would re-run a write the system already declined.

---

## 3. Provider endpoint matrix

| | Google | Microsoft Graph |
|---|---|---|
| Availability | `POST /freeBusy` | `GET /me/calendarView` (`$select=start,end,showAs`) |
| Create | `POST /calendars/primary/events` | `POST /me/calendar/events` + `transactionId` |
| Inspect | `GET …/events/{id}?fields=id,etag,summary,start,end,attendees` | `GET …/events/{id}?$select=id,subject,start,end,attendees`, `Prefer: outlook.timezone="UTC"` |
| Update | `PATCH …/events/{id}` + `If-Match` | `PATCH …/events/{id}` + `If-Match` — **probe-gated** |
| Delete | `DELETE …/events/{id}` + `If-Match`, no body | **— none. No writer exists.** |
| Cancellation endpoint | **never** (`sendUpdates` absent) | **never** (`/cancel` absent) |

**The GET answers three questions and nothing else**: does the event exist, did it grow guests, is
the desired state already there. Version arbitration stays SERVER-SIDE, in the provider's 412
against the etag the HUMAN approved (`plans.calendarExpectedEtag`) — never the freshly-read one.
Sending the fresh etag would make every write succeed: a read-modify-write race with the comparison
moved client-side, which ADR-023 names as forbidden.

**`tz` is excluded from the idempotency comparison.** Graph is asked to speak UTC and echoes UTC
back, so a registry zone of `Africa/Dar_es_Salaam` would never compare equal and every Microsoft
update would be forced into a PATCH that changes nothing. The absolute instant is the fact; the zone
rides the write payload.

### The Microsoft UPDATE gate

Reachable only when `PHASE17_GRAPH_PROBE` parses, carries schema
`phase17-graph-concurrency-probe.v1`, shows `stalePatchStatus === 412` **and**
`stalePatchPreserved === true`, and its `deploymentUrlHash`/`accountIdHash` match the values
recomputed at call time. Missing, blank, malformed, wrong-schema, failing either half of the pair, or
bound elsewhere all mean "no evidence", and no evidence means no Microsoft write.

The pair is read APART from the artifact's collapsed `supported` boolean — that boolean ANDed patch
and delete together and could only report the worse of them, which is exactly why a provably-safe
PATCH sat unreachable behind an unsafe DELETE. **The gate lives on the WRITER** (`patchEvent`), not
on the caller: a caller that forgot it would be a silent widening. It costs a refused path one extra
inspection GET and buys a guard nothing can route around.

---

## 4. THE NO-CANCELLATION-MESSAGE INVARIANT

Google's `sendUpdates` and Graph's `/cancel` **email the attendees on the app's behalf** — an
outbound external communication with no plan row, no audit event, no dead letter and no redaction
pass. That is the single sharpest way this phase could falsify the system's central claim, so:

- neither string appears in any calendar module's executable code (static guard, comments stripped);
- no write body carries `attendees`, and the guard bans it as an object-literal KEY while still
  requiring `body.attendees` to be READ — management must inspect the guest list to refuse an event
  that grew one, so a blanket ban would have forbidden the very check that protects people;
- the Google DELETE sends **no body** and no query parameter;
- the Microsoft PATCH body is exactly `{subject, start, end}`.

Every one of these is mutation-proven, not asserted.

---

## 5. Microsoft delete, stated in ADR-023's own words

> **Microsoft calendar management ships UPDATE-only. Cancel/delete stays Google-only.**
> Google keeps the full set: create · update · delete. Microsoft gets: create · update · **—**.
> ACTN-02 closes as *"management, minus Microsoft delete"*.
> The absence is a **product surface**, not a silent hole: a Microsoft-hosted event the user asks to
> cancel must produce an explicit refusal naming the provider limitation, never a no-op, never a
> best-effort delete, and never a fallback that quietly leaves the event live on the calendar.

How that is enforced, in three independent places:

1. **`providerSupports(provider, operation)` takes NO PROBE ARGUMENT.** ADR-023 records that a later
   work/school probe showing a 412 on DELETE justifies a *superseding ADR*, never an automatic
   widening — and an argument that does not exist cannot be threaded through by accident. A test
   pins that a probe reporting a REFUSED stale delete unlocks the PATCH branch and nothing else.
2. **`microsoftCalendar.ts` has no Graph delete writer.** A static guard asserts every
   `method: "DELETE"` in that module sits after the `graphConcurrencyProbe` landmark (the probe
   cleans up after itself, which is also the scan's anti-vacuity floor).
3. **The refusal is raised before a token is fetched.** A test asserts ZERO fetch calls for a
   Microsoft cancel, with both grants present and irrelevant.

The user-facing message names the limitation and says the event is still there.

---

## 6. Mutation ledger

Every mutation was applied to a green tree, measured against a baseline pinning both the FILE count
and the TEST count, then reverted. A mutant that breaks compilation prints `Tests no tests` and would
be scored SURVIVED by a naive "N failed" detector — the Task-1 harness defect, still guarded against.

### Task 2 — 15 applied, 15 caught

Microsoft delete let through · the update gate ignoring its deployment/account binding · the gate
reading only the status and dropping `preserved` · a malformed probe parsing into a usable one ·
`If-Match` carrying the freshly-read etag · the attendee refusal removed · reconciliation removed so
it always PATCHes · a 412 turned into a retry · an already-gone delete reported as `not_found` · the
probe gate skipped entirely · the delivering CAS guard dropped · a superseded staged version allowed
through · the PATCH body addressing guests · the Microsoft PATCH dropping `If-Match` · a PATCH onto a
vanished event reported as success.

### Task 3 — the plan's named ledger, 11 applied, 11 caught

| # | Mutation | Caught by |
|---|---|---|
| L1 | remove the attendee refusal | guests-added-at-provider test |
| L2 | drop `If-Match` on the Google PATCH | human-approved-If-Match test |
| L2b | drop `If-Match` on the Graph PATCH | Graph conditional-PATCH test + static guard |
| L3 | turn a 412 into a retry | conflict tests |
| L4 | remove desired-state reconciliation | lost-success reconciliation test |
| L5 | map a Microsoft delete to `/cancel` | cancellation-endpoint guard |
| L6a | let a Microsoft delete fall through to a Graph DELETE | no-Graph-DELETE-outside-the-probe guard |
| L6b | let a Microsoft delete become a SILENT NO-OP reported as success | Microsoft-cancel refusal test |
| L7 | route `calendar_manage` through the Gmail workflow arm | cockpit arm tests |
| L8 | drop the terminal's tenant/status guard | the three stale/foreign completion tests |
| L9 | point `calendar_manage`'s terminal at `onCreateComplete` | distinct-terminals guard |

### Two survivors, and what each one found

- **Task 2 — the pre-flight 404 was tested; the RACE was not.** The event existed at the GET and was
  gone by the DELETE. That branch's right answer DIFFERS BY VERB — already-gone is idempotent
  SUCCESS for a delete and `not_found` for an update — so one missing test was hiding two distinct
  behaviours. Both are now pinned.
- **Task 3 — `cockpit.ts`'s `_ARM_TABLE` is TYPE-LEVEL ONLY.** Flipping `calendar_manage` to
  `"workflow"` there changed nothing at runtime and the whole suite stayed green. The runtime table
  is `ARMS`/`armFor` in `@pikar/core/actionType.ts`; the cockpit copy exists only to derive the type
  that makes `EXTERNAL_TARGETS` incomplete at compile time. Re-aimed at the core file, the mutation
  was caught immediately.

---

## 7. The readback

`smoke.calendarLifecycleReadback({tenantId, provider, planId, managedEventId, correlationId})` reads
FOUR planes independently — plan row, registry row, provider, audit log — so none vouches for the
others. Bounded: exactly the rows named in the args, plus `audit.by_correlation` capped at 50.

Returns refs, codes, counts, key names, hashes and booleans only. Etags are returned deliberately: a
version marker is the fact the whole concurrency story turns on, and it is not content. The tenant
travels as a hash.

`contentLeak` / `tokenLeak` are **measured**, by substring search against the tenant's real titles
and real credentials — a probe that hardcoded `false` would assert the very thing it exists to
measure. `contentChecked` / `tokensChecked` report how many strings the check had to look for; zero
would mean the booleans proved nothing. A negative-control test forces `contentLeak: true`, so the
detector is known to be able to fire.

The **registry's** provider drives the inspection, never the operator's argument; a mismatch is
REPORTED (`providerMatches: false`), not resolved.

---

## 8. What is still not wired

Nothing STAGES a `calendar_manage` plan. No tool writes `kind: "calendar_manage"` until 17-09, so
the arm is reachable today only by a seeded row. What changed in Task 3 is that reaching it now
performs the approved act instead of throwing.

- **17-09** — the listing and staging tools (`listManagedCalendarEvents`, `proposeCalendarChange`),
  and the server-side FRESH-etag copy into `calendarExpectedEtag`. The migration's dry-run and
  bounded apply pages run before the listing tool is enabled; listing never invokes the migration.
- **17-09-03** — the plan card reads the registry, so it can finally name the ORIGINAL event
  instead of rendering a reference. It also owns the copy keyed off `calendarFailureCode`.
- **17-11** — the owner live gate. Per ADR-023 it asks for availability, approved create, approved
  move/update, conflict refusal and restaged update on BOTH providers, approved delete on **Google
  only**, plus the Microsoft delete refusal. `calendarLifecycleReadback` is its evidence tool.

## 9. Measured

- calendar 88/88 · microsoftCalendar 62/62 · cockpit 73/73 · dispatchGuard 20/20 ·
  calendarEvents 10/10 · dashboardSchema 5/5 — **258/258 across the six suites this phase touches**.
- backend **88 files / 2147 passed | 24 skipped**, exit 0; core **39 files / 1063 passed**.
- *A caveat about that backend total, recorded rather than smoothed over:* a concurrent lane was
  editing `skills.ts`/`skills.test.ts` throughout this task, so the whole-suite count moved under me
  (2148 → 2165 → 2171 collected) and one full run showed 10 failures in THEIR file that were green
  again minutes later without me touching it. The 258 figure above is the one this phase owns; the
  backend total is a point-in-time reading of a tree two sessions were writing to.
- `tsc --noEmit` clean in both packages.
- biome clean, verified on LF-normalised copies (the working-tree red is this repo's known CRLF
  noise).
- `node scripts/check-playbooks.mjs` clean for every path this phase touched.
