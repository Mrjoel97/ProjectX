# Phase 17 (Calendar Actions) — Owner UAT Runbook

**For:** repo owner, solo, Windows 11, PowerShell. **Repo:** `C:\Users\expert\desktop\pikar-ai`
**Closes:** `.planning/phases/17-calendar-actions/17-VERIFICATION.md` M1–M5 (`status: human_needed`)
**Time:** ~45–60 min in one sitting, of which ~10 min is the production rebuild.

---

## ⛔ SCOPE — read this before you judge anything as broken

Phase 17 ships, on purpose, a deliberately narrow slice:

| Ships | Does NOT ship |
|---|---|
| **Google only** | Microsoft / Outlook (17-01 Q7 — deferred) |
| **Timed events only** | All-day events (17-01 Q2 — deferred) |
| **CREATE only** | Update / move / cancel (17-01 Q3 — deferred, no ETag/412 handling = data-loss path) |
| **No attendees** — enforced by the *absence* of `attendees` / `sendUpdates` keys (17-01 Q6) | Any invite. Google would email attendees itself, outside the plan/audit/DLQ spine |
| Primary calendar only | Secondary calendars |

**Therefore: do NOT test attendee invites, event edits, event cancellation, all-day events, or a
non-primary calendar and then conclude they are broken.** They are not built. `ACTN-02` stays
**Pending** in `.planning/REQUIREMENTS.md` after this UAT — that is the correct outcome, not a failure.

**Also known and accepted:** the time parser has no month-name / ISO grammar. `"January 30 at 3pm"`
silently resolves to *today* at 3pm. `"in 240 hours"` works. This is why the plan card shows the exact
resolved instant before you Approve. Do not file it as a Phase 17 bug — it is Gap 3 in the verification.

---

## ⚠️ SAFETY — M3 writes a REAL event to your REAL Google Calendar

M3 creates one genuine event on your **primary** Google Calendar. It has no attendees, so nobody is
emailed and nobody else sees it. Use an obviously-fake title so you can find and delete it.

- **Use the title:** `PIKAR UAT M3 DELETE ME`
- **Delete it:** Google Calendar → find it at the staged time → open → Delete. Do this at the end (§8).
- The event id is deterministic (13-char base32hex derived from the plan id) and is recorded on the
  plan row as `calendarEventId` and in the audit row `calendar.event.created`.

---

## 🪤 ENVIRONMENT TRAPS — each of these has cost hours in this repo

1. **The convex CLI runs from `packages/backend` ONLY.** Anywhere else it fails or targets nothing.
2. **`pnpm start` serves a FROZEN production build.** A previous live session read as a *total feature
   failure* purely because the running bundle predated the feature. **You must rebuild and check the
   build timestamp before you believe any UI symptom** (§1). As of this writing
   `apps\web\.next\BUILD_ID` is dated **Jul 29 19:06**, which is *older than the 17-04 commits of
   Jul 30* — i.e. the currently-built bundle does **not** contain the finished Calendar work.
3. **`next dev` OOMs on the workspace page.** Never use `pnpm dev` for this UAT. Production build only.
4. **`UV_HANDLE_CLOSING` assertion noise** from the convex CLI is benign. Ignore it.
5. **Fixture-first `freeBusy`.** If a `calendarFixtures` row exists for your tenant, availability
   returns *fake* data and never calls Google — M1 and M2 would both false-PASS. Check and clear it
   in §1.5.

---

## 0. Ordering — do M4 FIRST, and why

**Run order: M4 → M1 → M2 → M5 → M3.**

**M4 must come before M1.** The Google grant was widened in 17-02 to add
`calendar.freebusy` + `calendar.events`. Your stored token predates that widening — it holds only
`gmail.modify`. M4 is the negative test that a **pre-widening token fails into a reconnect prompt
rather than a 403 crash**, and that state is *destroyed the moment you re-consent*. `buildAuthorizeUrl`
always requests the full widened scope set; there is no supported way to mint a narrow token again.
**M1 is the re-consent step.** Do M1 first and M4 becomes untestable without code edits.

The rest follows dependency, not preference: M2 needs the widened token (post-M1); M5's trace half
rides along on M2's request; M5's card half must be confirmed *before* M3, because M3 step 2 is
"read the card's exact time" and you should not Approve a card you have not verified.

If you have **already reconnected** since 2026-07-29 — see the M4 fallback in §3.

---

## 1. Pre-flight (do not skip — this is trap #2)

### 1.1 Confirm the working tree is the code you think it is

```powershell
cd C:\Users\expert\desktop\pikar-ai
git log -1 --format="%H %cd %s"
git status --short
```

Record the commit hash. You will compare the build against it in 1.3.

### 1.2 Rebuild the production bundle

The web app needs `NEXT_PUBLIC_CONVEX_URL` at **build** time, so confirm it exists first:

```powershell
cd C:\Users\expert\desktop\pikar-ai
Get-Content apps\web\.env.local
```

Expect a line `NEXT_PUBLIC_CONVEX_URL=https://...`. If it is missing, regenerate it:

```powershell
cd C:\Users\expert\desktop\pikar-ai\apps\web
"NEXT_PUBLIC_CONVEX_URL=" + ((Select-String -Path ..\..\packages\backend\.env.local -Pattern '^CONVEX_URL=').Line -replace '^CONVEX_URL=','') | Set-Content .env.local
```

Then build:

```powershell
cd C:\Users\expert\desktop\pikar-ai
pnpm --filter @pikar/web build
```

### 1.3 ✅ THE TIMESTAMP GATE — do this before trusting any UI symptom

```powershell
cd C:\Users\expert\desktop\pikar-ai
Get-Item apps\web\.next\BUILD_ID | Select-Object LastWriteTime
git log -1 --format=%cd
```

**GATE:** `BUILD_ID` LastWriteTime must be **NEWER** than the last commit date.
If it is older, the bundle is stale — **stop**, rebuild, re-check. Every UI observation below is
worthless until this gate passes. Write both timestamps down.

### 1.4 Start the backend and the web app (two terminals, leave both running)

Terminal A — **from `packages/backend` only**:

```powershell
cd C:\Users\expert\desktop\pikar-ai\packages\backend
npx convex dev
```

Wait for `Convex functions ready`. `UV_HANDLE_CLOSING` assertions in this window are benign noise.
(If another session already has a deployment up, do not start a second one — coordinate first.)

Terminal B — the frozen-but-now-fresh production server:

```powershell
cd C:\Users\expert\desktop\pikar-ai
pnpm --filter @pikar/web start
```

Open **http://localhost:3000/dashboard/workspace** and sign in.

### 1.5 ✅ THE FIXTURE GATE — clear the offline calendar fixture

`freeBusy` checks `calendarFixtures` **before** the token, before the network. A leftover fixture row
makes M1 and M2 pass with fabricated data.

In the Convex dashboard (the URL `npx convex dev` prints) → **Data** → table **`calendarFixtures`**.

- **If a row exists for your tenantId:** delete it. Record that you did.
- **If the table is empty or absent:** good, continue.

### 1.6 Record your starting token scope (this is M4's precondition)

Convex dashboard → **Data** → table **`gmailTokens`** → your tenant's row → column **`scope`**.

- Pre-widening (M4 is live-testable): `https://www.googleapis.com/auth/gmail.modify` — and **nothing
  else**.
- Already widened: the string also contains `.../auth/calendar.freebusy` and `.../auth/calendar.events`.

**Copy this exact string into your notes.** It is M4's evidence and M1's before/after proof.

---

## 2. What to capture for every test

The phase close needs **evidence, not a verdict**. For each test write down:
the timestamp, the exact on-screen text you saw (copy/paste, don't paraphrase), and the id/row named
in that test's "Record" line. A screenshot of the workspace pane counts.

Keep one scratch file, e.g. `Desktop\phase-17-uat-evidence.txt`.

---

## 3. M4 — pre-widening token fails into RECONNECT, not a 403 crash

**Runs FIRST. Do not reconnect Google before finishing this test.**

**What it proves:** the scope check happens *before* the token refresh, so a grant that can refresh but
cannot call Calendar produces a governed, recoverable `reauth` outcome — a reconnect banner and a
plain-English reply — instead of a 403 escaping the agent loop.

### Steps

1. Confirm §1.6 showed a **mail-only** scope. Do **not** visit `/connect-gmail`.
2. In the workspace chat, type: `Am I free tomorrow?`
3. Watch the reply and the top of the page.

### Expected

- The assistant replies conversationally that it could not check — wording derived from
  *"I couldn't check calendar availability — the calendar isn't reachable… suggest they reconnect Google."*
- The amber **reconnect banner** appears across the top: **“Reconnect Gmail to send this”** with a
  **Reconnect** button linking to `/connect-gmail`.
- The backing notification message is
  **“I couldn't read your calendar — reconnect Google so I can check availability.”**
  (Convex dashboard → `notifications` → kind `gmail_reconnect`.)
- The chat stays alive — you can keep typing. **No error toast, no blank pane, no stack trace.**

### PASS / FAIL — something you can SEE

- **PASS:** amber reconnect banner visible at the top of the page **AND** a normal conversational
  reply in the thread **AND** the input box still works.
- **FAIL:** a red/unhandled error, a crashed or frozen pane, a raw `403` / `Forbidden` /
  `PERMISSION_DENIED` string anywhere on screen, or the thread ending with no reply at all.

### Record

The exact assistant reply text; the exact banner text; the `notifications` row (`kind`, `message`,
`_creationTime`); and the `scope` string from §1.6 that made this the pre-widening case.

### If §1.6 showed an ALREADY-WIDENED scope (M4 fallback)

The true pre-widening grant cannot be re-minted. The closest honest substitute — **and it is a
substitute, say so in your evidence** — is to reproduce the *stored-scope* state the guard actually
reads:

1. Convex dashboard → **Data** → `gmailTokens` → your row → edit **`scope`** to exactly
   `https://www.googleapis.com/auth/gmail.modify`
2. Run the M4 steps above.
3. Restore by reconnecting at `/connect-gmail` (which is M1 anyway).

**Fidelity caveat to write into the evidence:** this exercises the `hasScope`-before-refresh guard and
the reconnect path, which is the mechanism M4 is about — but it does **not** exercise Google itself
returning a 403, because the request never leaves the app. Mark M4 as
**PASS (simulated stored-scope)**, not **PASS (live)**, and note that the live-403 branch
(`401` / `403` + auth-ish reason → `reauth`) remains covered only by the offline tests.

---

## 4. M1 — the widened Google consent can call Calendar

**What it proves:** one consent screen grants Mail **and** Calendar, and the resulting token performs
a real availability read with no permission error.

### Steps

1. Go to **http://localhost:3000/connect-gmail**.
2. Read the copy before clicking. It should say Pikar needs consent to *read, draft, and send email,*
   ***check calendar availability, and create approved calendar events***.
3. Click **Reconnect Google** (or **Connect Google**).
4. Complete the Google consent screen. **Read the permission list Google shows you.**
5. Return to the app. Convex dashboard → `gmailTokens` → re-read **`scope`**.
6. Back in the workspace, ask: `What's on my calendar today?` or `Am I free today?`

### Expected

- Google's consent screen lists **both** a Gmail permission and Calendar permissions.
- After the callback, `scope` now contains all three:
  `.../auth/gmail.modify`, `.../auth/calendar.freebusy`, `.../auth/calendar.events`.
- `/connect-gmail` shows the green **“Google connected”** box with a token expiry time.
- The availability question now returns either `N busy block(s) for today:` with times, or
  `You're free for today — there are no busy blocks in that window.`
- **No** reconnect banner, no permission error.

### PASS / FAIL

- **PASS:** the stored `scope` string visibly contains `calendar.freebusy` **and** `calendar.events`,
  **and** the availability answer names busy blocks or explicitly says you are free.
- **FAIL:** `scope` still lacks either calendar scope; or the answer is still the
  "calendar isn't reachable" copy; or the amber banner reappears after a successful reconnect.

### Record

The `scope` string before (from §1.6) and after; the Google consent screen's permission list
(screenshot is ideal); the verbatim availability reply.

---

## 5. M2 — real freeBusy ranges match your real calendar, and leak nothing

**What it proves:** the busy intervals returned are your genuine calendar's, and that only
`{start, end}` crosses the boundary — no title, description, or attendee.

### Range semantics — read this or you will fail M2 on a misunderstanding

The windows are **rolling from now**, not calendar days:

| Range | Window |
|---|---|
| `today` | now → now + 24h |
| `tomorrow` | now + 24h → now + 48h |
| `week` | now → now + 7 days |

Only the **primary** calendar is queried. Blocks on any secondary calendar will correctly **not** appear.
At most **5** blocks are printed, followed by `N additional busy block(s) not shown.`

### Steps

1. In Google Calendar, on your **primary** calendar, create 2–3 known busy blocks with
   distinctive titles, e.g. `SECRET-TITLE-ALPHA` at a time inside the next 24h and
   `SECRET-TITLE-BETA` in the 24–48h window.
2. Write the exact start/end times down.
3. In the workspace ask, one at a time: `Am I free today?` → `Am I free tomorrow?` →
   `What does my week look like?`
4. Compare each returned interval against your notes.

### Expected

- The `today` answer contains the ALPHA block's start/end (clipped to the rolling window);
  `tomorrow` contains BETA's; `week` contains both.
- Times are rendered in your local timezone.
- **The strings `SECRET-TITLE-ALPHA` / `SECRET-TITLE-BETA` appear NOWHERE** in the reply, and neither
  does any description or attendee address.
- Convex dashboard → `audit` → `calendar.availability.listed` rows have payload exactly
  `{ range, busyCount }` — no times, no titles.

### PASS / FAIL

- **PASS:** every returned interval matches a real block on your primary calendar, **AND** you can
  Ctrl-F the reply for `SECRET-TITLE` and get zero hits.
- **FAIL:** any event title/description/attendee appears in the reply; intervals do not match reality;
  the `today` answer shows a block that is not in the next 24h; or the audit payload contains anything
  beyond `range` and `busyCount`.

### Record

Your three real blocks (title + exact times), the three verbatim replies, and one
`calendar.availability.listed` audit payload copied out in full.

---

## 6. M5 — live trace verbs and the calendar plan card

**What it proves:** the trace-step row actually inserts in production (the AI SDK can silently swallow
a failed insert — this is provable *only* live), and the plan card renders calendar chrome rather than
email chrome.

You can capture **6a during M2's requests** — the trace fires whether or not the read succeeds.

### Steps — 6a, the trace verbs

1. Ask an availability question and **watch the activity/trace strip while it runs.**

**Expected:** the row reads **“Checking your calendar…”** while running, then flips to
**“Checked your calendar”**. It must NOT read the generic **“Working…” / “Done”** fallback.

### Steps — 6b, the plan card

2. Ask the cockpit to stage an event, using a parser-friendly time:
   `Put "PIKAR UAT M3 DELETE ME" on my calendar tomorrow at 3pm for 30 minutes`
3. Watch the trace, then read the card that appears.

**Expected:**
- Trace: **“Putting the event together…”** → **“Event ready to approve”**.
- A card labelled **`CALENDAR EVENT`** showing:
  - the title **PIKAR UAT M3 DELETE ME** in bold,
  - **When:** an *absolute* date-time (not "tomorrow"),
  - **Duration:** `30 min`,
  - the line **“Approving adds this to your Google Calendar. No one is invited and nothing is emailed.”**,
  - a teal button reading **“Approve & add to calendar”**.
- **NO email chrome:** no recipient chips, no `Mode:`, no `Subject:`, no send-time picker, no
  "Send to N recipients".

### PASS / FAIL

- **PASS:** both trace pairs render their calendar-specific words (never “Working…”/“Done”), **AND**
  the card shows CALENDAR EVENT + an absolute time + “Approve & add to calendar”, **AND** you can see
  zero recipient/subject/mode fields on it.
- **FAIL:** any trace row shows the generic fallback or no row appears at all; the card shows a
  dash `—` where the title/time/duration should be; or any email field is visible.

### Record

The two trace verb pairs verbatim; the card's **When:** value verbatim (you need this for M3); a
screenshot of the card.

**Do not click Approve yet.** Leave the card staged and go to M3.

---

## 7. M3 — Approve creates exactly ONE real event, and a second Approve creates none

**What it proves:** the human Approve gate is the sole side effect, and the deterministic event id +
409-as-success makes a retry or double-click idempotent.

⚠️ **This writes a real event.** See §Safety.

### Steps

1. **Before approving**, open Google Calendar at the staged date/time and confirm **no event exists
   there**. Record that.
2. Re-read the card's **When:** and **Duration:** — that exact instant is what will be written.
3. Click **Approve & add to calendar** — **once**. The button should change to **“Adding…”**.
4. Refresh Google Calendar (give it ~5–15 seconds).
5. Now attempt a **second approval**: click the button again if it is still live, or re-open/refresh
   the workspace and try to Approve the same plan again.
6. Refresh Google Calendar once more and count the events at that slot.

### Expected

- Exactly **one** event titled `PIKAR UAT M3 DELETE ME`, at the exact instant the card showed, with a
  30-minute duration.
- The event has **no guests / no attendees** and no invitation email was sent to anyone.
- The second approval is a no-op: **no second event**.
- Convex dashboard: the plan row now has `status: "done"` and a populated **`calendarEventId`**;
  `audit` has exactly one `calendar.event.created` row with payload `{ planId, eventId }` — and
  nothing else in that payload.

### PASS / FAIL

- **PASS:** you can see exactly **one** event in Google Calendar at that slot after *both* approval
  attempts, its start time matches the card's **When:** to the minute, and the guest list is empty.
- **FAIL:** zero events created; **two** events created; the event lands at a different time than the
  card displayed; the event has any guest; or the plan row is stuck at `delivering` after a minute.

### Record

The `calendarEventId` value; the `calendar.event.created` audit payload; the plan row's final
`status`; a screenshot of the single Google Calendar event showing its time and empty guest list.
Also record explicitly: *"no event existed at that slot before approval"*.

---

## 8. Cleanup

1. **Delete the UAT event.** Google Calendar → find `PIKAR UAT M3 DELETE ME` → open → **Delete**.
   (Deleting from Google is fine — Phase 17 ships no cancel path, so nothing in the app tracks it.)
2. Delete the `SECRET-TITLE-ALPHA` / `SECRET-TITLE-BETA` blocks from M2.
3. If you edited `gmailTokens.scope` for the M4 fallback, confirm §4 restored the full widened scope.
4. If you deleted a `calendarFixtures` row in §1.5 and want it back for offline smoke runs, note that —
   do not re-create it by hand.
5. Stop Terminal A (`convex dev`) and Terminal B.

---

## 9. Troubleshooting — symptom → known trap

| Symptom | Almost certainly | Fix |
|---|---|---|
| No calendar card, no calendar trace verbs, agent acts like the feature doesn't exist | **Stale frozen bundle** (trap #2). `.next` predates the 17-04 commits | Redo §1.2–1.3. Do not debug anything until the timestamp gate passes |
| Browser tab dies / node OOM on the workspace page | You ran `pnpm dev` / `next dev` (trap #3) | Kill it. Use `pnpm --filter @pikar/web build` then `pnpm --filter @pikar/web start` |
| `convex` command not found, or it targets nothing | Ran the CLI outside `packages/backend` (trap #1) | `cd packages/backend` first |
| `UV_HANDLE_CLOSING` assertion spam in the convex terminal | Benign CLI noise (trap #4) | Ignore |
| Availability answers instantly and the times look invented / never change | **`calendarFixtures` row present** (trap #5) — fixture is read *before* token and network | §1.5, delete the row, re-run |
| `"I couldn't read your local time and timezone, so I can't check calendar availability yet."` | The browser never sent `clientContext` (trusted clock) — usually a stale bundle or a hard-reload mid-turn | Hard-refresh the workspace page; if it persists, re-check §1.3 |
| Reconnect banner appears **after** a successful M1 reconnect | Either the stored `scope` did not actually widen, or the read hit a transient provider outage (both route to the same banner) | Re-read `gmailTokens.scope`. If it has both calendar scopes, retry the question — an outage returns `unavailable`, which uses the same banner |
| Event lands at the wrong date, e.g. today instead of a month out | **Known parser gap** — no month-name/ISO grammar (Gap 3) | Not a bug. Use relative forms (`tomorrow at 3pm`, `in 240 hours`) and always trust the card's absolute **When:** |
| Plan card shows `—` for title / when / duration | The row was only partially staged; `createEvent` will terminate with `incomplete_stage` before any network call | Re-stage with a clearer sentence. Record it — a repeatable case is worth a follow-up |
| Approve seems to do nothing, plan stuck at `delivering` | Retrier run in flight or terminal not resolving | Wait 60s, then check `deadLetters` for a `calendar_insert <status> <reason>` row — that row *is* the evidence, capture it |
| Google consent screen shows only Gmail permissions | The build serving `/connect-gmail` predates 17-02, **or** `GOOGLE_SCOPES` isn't reaching the authorize URL | §1.3 first. If the build is fresh, this is a real M1 FAIL — record and stop |

---

## 10. Evidence summary template — fill this in and hand it to `/gsd:verify-work 17`

```
Phase 17 UAT — <date> — commit <hash from §1.1>
Build timestamp: <BUILD_ID LastWriteTime>   Last commit: <git log -1 %cd>   Gate: PASS/FAIL
calendarFixtures row present before UAT? yes(deleted)/no
gmailTokens.scope BEFORE: <string>
gmailTokens.scope AFTER M1: <string>

M4 (ran FIRST): PASS / PASS(simulated stored-scope) / FAIL
  reply text: "..."   banner text: "..."   notification row: ...
M1: PASS / FAIL
  consent screen permissions: ...   availability reply: "..."
M2: PASS / FAIL
  real blocks: ...   replies: ...   audit payload: {range:..., busyCount:...}
  title leak check (Ctrl-F "SECRET-TITLE"): 0 hits / N hits
M5: PASS / FAIL
  trace: "Checking your calendar…" -> "Checked your calendar"
  trace: "Putting the event together…" -> "Event ready to approve"
  card When: "..."   email chrome present? no/yes
M3: PASS / FAIL
  no event existed pre-approval: yes/no
  calendarEventId: ...   audit calendar.event.created payload: {planId:..., eventId:...}
  events at slot after TWO approval attempts: <count>   guests on event: <count>
  plan status: done/...

ACTN-02 stays Pending (Google-only, create-only). Not a failure.
```

---

## 11. Unresolved — flagging rather than guessing

**Where does the activity/trace strip render in the workspace UI?** The verbs themselves are pinned
(`cards.tsx` `VERBS`: `checkAvailability` → `["Checking your calendar…", "Checked your calendar"]`,
`proposeCalendarEvent` → `["Putting the event together…", "Event ready to approve"]`) and their
schema-literal parity is test-proven. But the sources do not say *where on the page* the running/done
row appears, or how long a completed row stays visible before it collapses. If you cannot see a trace
row at all during M5, that is exactly the failure mode M5 exists to catch — **record it as a finding
rather than retrying until it disappears**, and note whether the row was absent or merely transient.
