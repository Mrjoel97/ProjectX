# 26-20 Task 2 — Command Center v2 and Phase 26 owner UAT (BLOCKING, open)

**Status:** Task 1 (build + automated gate) must be green and recorded before you start this. This
is not the summary — `26-20-SUMMARY.md` is written only after you approve below, and it must quote
your recorded observations verbatim, not a generic "looks good".

**What has and has not been executed.** The AUTOMATED browser gate
(`e2e/command-center.spec.ts`) has run: 8/8 green, twice, 2026-08-23. Sections 0-1 and parts of
2, 5 and 7 are covered by it. Everything phrased as a JUDGEMENT below — does the ranking match how
you want a morning ranked, does the copy read true, is a stat's definition the one you meant — has
NOT been executed and cannot be. That is what this file is for.

---

## 0. Prerequisites — a runnable authenticated stack

**Updated 2026-08-23 after actually running this.** The original version of this section was written
blind and was wrong in three places. What is below is what worked.

`next dev` OOMs on the workspace page in this repo, so UAT runs against a **production build**.

### Terminal 1 — the local Convex backend

```bash
cd C:/Users/expert/desktop/pikar-ai/packages/backend
CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=180 npx convex dev
```

`CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS` is **required**, not optional: the local database is
large enough that the backend takes ~1.8 minutes to come up and the default 30s timeout kills it.

Wait for **`✔ Convex functions ready!`**. If you instead see `✘ Could not resolve "node:http"` or
any bundle error, **the push did not happen** and the app will run against whatever functions were
last deployed — possibly months old. Do not continue past an error here.

### THEN VERIFY THE PUSH LANDED — do not skip this

```bash
npx convex function-spec | grep home
```

You must see `home.js:summary` and `home.js:health`. If that output is empty, the backend does not
have the code you are about to test, and the page will render five `error` cards.

> **This is the step that caught the worst defect in the whole phase.** A `convex/lib/foglamp.ts`
> missing its `"use node"` directive had been silently aborting every push. Every unit suite
> (3,900+ tests), all three typechecks and the production build were green while the three HOME-01
> functions had never reached the deployment. `convex-test` runs in-process — it can never tell you
> a function failed to *reach* the backend. Only this command can.

### Terminal 2 — the web app, production build

```bash
cd C:/Users/expert/desktop/pikar-ai/apps/web
npx next build
npx next start -p 3111
```

Rebuild **after** flipping the flag in 0a — a production build does not hot-reload, and `next start`
serves what was on disk when you built.

### Signing in

The seeded local user works and its password is known:

| | |
|---|---|
| Email | `e2e-wave6@pikar.test` |
| Password | `pikar-e2e-2026-Wave6!` |

Signing in as the owner (Google) also works for every step except step 6.

| Piece | Where |
|---|---|
| Web | http://127.0.0.1:3111 (production build) |
| Convex | local backend on :3210 |
| The page | http://127.0.0.1:3111/dashboard |

### Optional — run the automated browser gate first

It passes 8/8 and takes about a minute. If it fails, fix that before spending your own time:

```bash
cd C:/Users/expert/desktop/pikar-ai/apps/web
E2E_USER_EMAIL='e2e-wave6@pikar.test' E2E_USER_PASSWORD='pikar-e2e-2026-Wave6!' npx playwright test e2e/command-center.spec.ts --project=chromium --no-deps
```

`--no-deps` reuses saved auth. If it complains about credentials, mint them first with
`npx playwright test --project=setup` and the same two env vars.

### Cleaning up afterwards

`npx convex dev` owns the local backend process. Killing it can leave an orphaned
`convex-local-backend.exe` holding port 3210, and the next `npx convex dev` then refuses with
*"A local backend is still running on port 3210."* If that happens, kill that process by name
before restarting.

### 0b. Two things to hold me to

- **Some steps change real data.** Resolving a dead letter, naming a binding constraint, rejecting
  an approval and connecting/disconnecting a mailbox are real writes to your tenant. Each step below
  says so. Nothing here spends model credits **except** re-running the business review in step 2.5,
  which is optional and marked.
- **A blocker you do not have cannot be cleared.** If a step's blocker is already absent, do not
  manufacture it — write "not present" and record which recommendation was showing instead. That is
  a valid observation; a faked one is not.

---

## 1. Desktop / tablet / mobile

Load `/dashboard` at each width and look at all five sections: the hero recommendation, Your binding
constraint, Key numbers (incl. Sales pipeline), Latest briefing, System health.

| Width | What to check | Recorded |
|---|---|---|
| Desktop 1440x900 | nothing clipped, no horizontal scroll | ____________________ |
| Tablet 1024x768 | stat grid and pipeline list reflow, cards keep their padding | ____________________ |
| **Mobile 390x844** | 26-10's UAT found a real clip at exactly this width on a sibling page | ____________________ |

Then, at desktop width, **Tab through the page**: the recommendation's "Open" CTA, the constraint's
"Open your business profile" link, and every briefing row's "Open in workspace" link should take
focus visibly and in reading order.

Keyboard/focus observation: ______________________________________________________

**No colour-only meaning.** Every state renders a word (`Clear` / `Needs attention` / `Unknown` /
`Unavailable`). Confirm you can read every state with the colours ignored: ______________________

---

## 2. Clear the blockers IN ORDER, and record each recommendation

The order is locked in `packages/core/src/home.ts` (`HOME_PRIORITY_ORDER`) and is not
input-order-dependent: the highest-priority **triggered** signal wins, and an `unknown` signal never
becomes a recommendation.

Before each step, read the hero and capture both the human label and the machine code:

```js
// DevTools console, on /dashboard
const h = document.querySelector('[data-cc-priority]');
[h?.dataset.ccPriority, h?.textContent, document.querySelector('.next-move a')?.getAttribute('href')]
```

Work down the table. After clearing each one, **reload** and record what the hero shows next.

| # | Priority code | Expected label when it is the top blocker | How to clear it (real write) |
|---|---|---|---|
| 2.1 | `connection-failure` | "Connect your mailbox" | Connect the mailbox at `/connect-gmail` |
| 2.2 | `unresolved-dead-letters` | "Clear the blocked work" | Resolve the rows at `/ops` |
| 2.3 | `stale-approval` | "Answer the waiting approval" | Answer the >24h-old item at `/dashboard/approvals`. **Rejecting is the safe clear — approving sends real email.** |
| 2.4 | `scheduled-risk` | "Check the scheduled sends" | At `/dashboard/approvals`, cancel or re-time the send that is due within the hour or has no confirmed send time |
| 2.5 | `diagnostic-blocker` | "Fix the failing gate" | Only a `gaps` verdict triggers this. Clearing means re-running the business review — **paid model spend**; skip it and record instead unless you want to pay |
| 2.6 | `binding-constraint` | "Name your binding constraint" | Name it at `/dashboard/profile` |
| 2.7 | `workspace` (fallback) | "Open the workspace" — "Nothing needs your decision right now." | nothing to clear; this is the floor |

Record one line per step — code, label, and the CTA's href:

- 2.1 ______________________________________________________________________
- 2.2 ______________________________________________________________________
- 2.3 ______________________________________________________________________
- 2.4 ______________________________________________________________________
- 2.5 ______________________________________________________________________
- 2.6 ______________________________________________________________________
- 2.7 ______________________________________________________________________

**The thing this step is really testing:** clearing a blocker must *reveal the next one down*, never
jump the queue and never blank the card. If any step produced a code that sits ABOVE the one you
just cleared, or an empty hero, that is a defect — write it down exactly.

---

## 3. The binding-constraint card, including the INSUFFICIENT copy

The card speaks for exactly three states and renders nothing from your blueprint's own text:

| `data-cc-constraint` | Heading | Body |
|---|---|---|
| `ok` | "Your binding constraint is on record" | "Work on this page is ranked against the bottleneck in your blueprint." |
| `triggered` | "Name your binding constraint" | "Your blueprint has no binding constraint on record, so nothing here is ranked against your real bottleneck." |
| `insufficient` | **"Not enough information"** | **"Nothing on record types your binding constraint yet, so this page cannot rank against it."** |

```js
document.querySelector('[data-cc-constraint]')?.dataset.ccConstraint
```

3a. Which state is showing, and does the rendered copy match the row above **word for word**?

Recorded: ________________________________________________________________________

3b. **The INSUFFICIENT state specifically.** It is the fail-closed branch: it renders whenever the
signal is absent, `unknown`, or off-contract — i.e. whenever Pikar could not read your blueprint at
all. To see it, run the step-7 injection against the **last** `orElse` in `health` (the
`blueprint.blueprintState` one) instead of the mailbox one. Confirm the copy claims **no knowledge**
and does not imply the constraint is missing — "missing" is a stronger claim than that read can
support, and asserting it would be the defect.

Recorded: ________________________________________________________________________

3c. Confirm none of the three variants renders any text from your own blueprint — no constraint
sentence, no profile prose, no interpolated values. Recorded: ____________________________

---

## 4. Read each source stat's definition and confirm it matches what the backend counts

Definitions live in `packages/backend/convex/home.ts`. Read the definition, then compare the tile to
its source page. A source that could not be read renders the word **Unavailable** — never `0`. A
capped count renders as a floor, e.g. `1000+`.

| Tile | What the backend actually counts | Compare against | Recorded |
|---|---|---|---|
| **Awaiting approval** | `approvals.summary.awaitingCount`; the cap bit is carried through, so `N+` means "at least N" | `/dashboard/approvals` | __________ |
| **Content artifacts** | `content.summary.total.count` | `/dashboard/content` | __________ |
| **Emails delivered** | `requests` rows with `status === "sent"`, **all-time, no window**, one row per recipient, **both** the legacy/pipeline lane and the cockpit lane, capped at 1000 | *no page shows this exact number* — sanity-check it is not roughly **double** what you know you have sent | __________ |
| **Blocked work** | `deadLetters.newCount` — unresolved rows only | `/ops` | __________ |

**The double-count trap this tile is shaped to avoid:** two other counters exist over the same
event — `telemetry.reviewOutcome === "sent"` (both lanes) and `plans.sentCount` (cockpit only).
Neither is read here. Adding `plans.sentCount` would double cockpit sends while counting legacy
sends once, so the result would come out *biased* rather than obviously wrong. If "Emails delivered"
looks inflated against what you know you sent, say so — that is exactly the failure mode.

**Sales pipeline** (four narrow counts, from `contacts.pipelineTiles`): Contacts needing attention,
Follow-ups due, Consent on record, Suppressed contacts. Compare against `/dashboard/pipeline`.

```js
document.querySelector('[data-cc-pipeline]')?.dataset.ccPipeline  // ready | partial | unavailable | error
```

- Status observed: ____________  Four numbers observed: ______________________________
- If `partial`: the notice must say the scan hit its limit and the four numbers must render as
  floors (`N+`). Recorded: ______________________________________________
- Confirm the pipeline block shows **no** opportunities, stages, deal value or contact rows — it is
  a roll-up only. Recorded: ______________________________
- Confirm an unavailable/error pipeline renders a sentence, **not four zeros**: ____________________

---

## 5. Latest briefing — links open the workspace and promise nothing

The card shows the range, timezone, "N listed of M in this window", an attributed **Pikar summary**
(when the briefing has one) and up to five rows.

5a. Each row's only affordance is **"Open in workspace"**, going to `/dashboard/workspace`. Click one
and confirm nothing else happens — no reply drafted, no send, no schedule, no write of any kind.

Recorded: ________________________________________________________________________

5b. Read every label on the card. **No row may offer or imply an action** — nothing that reads
"Reply", "Send", "Follow up", or otherwise promises Pikar will do something. Rows may state facts
(`Unanswered`, `Today` / `Yesterday` / `This week`).

Any action-sounding string found: ____________________________________________________

5c. The model-written synopsis must sit under the explicit **"Pikar summary"** label so it can never
read as your own words. Recorded: ____________________________________________

5d. If this tenant has never been briefed, the card reads "Nothing here yet" — an empty state, not an
error. Recorded: ______________________________

---

## 6. Owner vs non-owner health

Health is **not** owner-gated: both roles must get the same state word and the same six signal rows.
This deployment has one loggable human account, so the $0 way to see the non-owner side is to revoke
your own owner flag and put it back.

> **`npx convex run` against the local backend SIGNS THE BROWSER OUT** (measured 2026-08-14). Expect
> to sign in again after each command below.

```bash
cd C:/Users/expert/desktop/pikar-ai/packages/backend
# find your users._id first (Convex dashboard -> Data -> users), then:
npx convex run owner:revokeOwner "{\"userId\":\"<your users._id>\"}"
```

6a. Sign back in, load `/dashboard`, and record the health word plus the six signal rows:

```js
[document.querySelector('[data-cc-health]')?.dataset.ccHealth,
 [...document.querySelectorAll('[data-cc-signal]')].map(e => [e.dataset.ccSignal, e.textContent])]
```

As NON-owner: ____________________________________________________________________

```bash
npx convex run owner:bootstrapOwner "{\"userId\":\"<your users._id>\"}"
```

6b. Sign back in and record the same reading as owner:

As OWNER: ________________________________________________________________________

6c. **They must match** — same state word, same six codes, same order. A difference here means health
leaked an owner-only read. Match? ______

6d. Confirm `bootstrapOwner` reported `changed: true` (proving you really were non-owner in between),
and that `/ops` behaves as expected for each role. Recorded: __________________________

---

## 7. Inject a health failure and confirm it reads **Unknown**

This is the fail-closed proof: a source that cannot answer must never be counted as healthy, and the
page must never say "Nothing is blocked" over an incomplete set.

**Back up the file first** — it may be newly added and untracked, in which case `git checkout` will
not restore it:

```bash
cd C:/Users/expert/desktop/pikar-ai/packages/backend
cp convex/home.ts "$TEMP/home.ts.uat-backup"
```

Now break exactly one source. In `packages/backend/convex/home.ts`, inside the **`health`** query,
find the **first** `orElse(async () => {` — the one that reads `api.gmailAuth.gmailStatus` and
returns the `connection-failure` signal — and make its first line:

```ts
        throw new Error("UAT health injection");
```

Save. `npx convex dev` pushes it automatically (watch terminal 1 for the push). Reload `/dashboard`.

7a. The **Mailbox connection** row must read **Unknown** — not "Clear", not "Needs attention".
(Health ROWS use neutral source names from `HOME_SIGNAL_LABEL`; the imperative "Connect your
mailbox" belongs to the hero only. A status list that reads "Connect your mailbox — Clear" would be
commanding an action while declaring nothing is blocked, which is the bug that split the two maps.)

Recorded: ____________________

7b. The overall verdict must be **Unknown**, with the body *"At least one source did not report, so
Pikar cannot tell you whether anything is blocked."* The words "Healthy" and "Nothing is blocked"
must appear **nowhere** on the page.

Recorded: ________________________________________________________________________

7c. The recommendation must **not** claim a connection failure — an `unknown` signal is not a
triggered one, so the hero falls through to the next actually-triggered blocker, or to the workspace
fallback.

`data-cc-priority` observed: ____________________

7d. The other four sections (constraint, key numbers, latest briefing, and the remaining health rows)
must all still render their real values. One section going dark must never blank another.

Recorded: ________________________________________________________________________

**Revert, and prove you reverted:**

```bash
cp "$TEMP/home.ts.uat-backup" convex/home.ts
grep -c "UAT health injection" convex/home.ts     # must print 0
```

Reload and confirm the health word went back to what step 6 recorded: ____________________

---

## 8. Every Phase 26 nav route is reachable

Click each rail item in turn, top to bottom, and confirm the route loads under the auth gate and the
rail lights that item. `/dashboard` is exact-match; every other item is a prefix match.

| # | Rail item | Route | Loads? | Rail lights it? |
|---|---|---|---|---|
| 1 | Command Center | `/dashboard` | ____ | ____ |
| 2 | Approvals | `/dashboard/approvals` (+ pending badge) | ____ | ____ |
| 3 | Finance | `/dashboard/finance` | ____ | ____ |
| 4 | Content | `/dashboard/content` | ____ | ____ |
| 5 | Sales Pipeline | `/dashboard/pipeline` | ____ | ____ |
| 6 | Compliance | `/ops` (+ dead-letter badge) | ____ | ____ |
| 7 | My Workspace | `/dashboard/workspace` (full-bleed) | ____ | ____ |
| 8 | Live Voice | `/dashboard/voice` | ____ | ____ |
| 9 | Reports | `/dashboard/reports` | ____ | ____ |
| 10 | Knowledge Vault | `/dashboard/vault` (full-bleed) | ____ | ____ |
| 11 | Join Community | *no route by design* — must render greyed with "Soon" and **must not navigate** | ____ | n/a |

Rail foot (below the nav list):

| Item | Route | Loads? |
|---|---|---|
| Business Profile | `/dashboard/profile` | ____ |
| Connections | `/dashboard/profile?tab=connections` (a plain `<a>`, deliberately — it must land on the Connections tab) | ____ |
| Settings | `/dashboard/settings` | ____ |
| Collapse | collapses the rail, and the choice survives a reload | ____ |
| Sign Out | signs out (do this last) | ____ |

**Known, already-parked defect — do not report it as new:** Business Profile and Connections light
at the same time, because the active check strips the query string. It is commented as parked in
`layout.tsx`. Confirm you see exactly that and nothing worse: ____________________

Any route that 404s, throws, or bounces to `/dashboard/onboarding`: __________________________

---

## 9. Rollback to the legacy dashboard

Rollback is presentation-only. No data changes, no backend deploy, and every source page and API
stays exactly where it was.

**The one-line flip** — `apps/web/app/(app)/dashboard/page.tsx` line 19:

```ts
const COMMAND_CENTER_V2: boolean = true;   ->   const COMMAND_CENTER_V2: boolean = false;
```

Then rebuild and restart terminal 2:

```bash
cd C:/Users/expert/desktop/pikar-ai/apps/web
npx next build
npx next start -p 3111
```

**Verify the rollback took effect** on `/dashboard`:

```js
document.querySelectorAll('[data-cc-section]').length          // must now be 0
document.querySelector('.cc-hero .caps-label')?.textContent    // legacy -> "Solopreneur - <today>"
                                                               // v2     -> "Command Center"
```

9a. The legacy dashboard renders: its hero reads "Solopreneur - `<date>`" and its next move is
"Open your operating workspace". Recorded: ____________________________________

9b. **Every source page still works after rollback** — re-visit each and confirm it still loads with
real data. This is the whole point: rollback hides one presentation, it disables nothing.

`/dashboard/approvals` ____  `/dashboard/finance` ____  `/dashboard/content` ____
`/dashboard/pipeline` ____  `/ops` ____  `/dashboard/reports` ____  `/dashboard/vault` ____
`/dashboard/workspace` ____  `/dashboard/profile` ____

9c. The backend is untouched by the flip: `home.summary`, `home.health` and
`briefings.latestForTenant` are still deployed and still answer. Confirm terminal 1 shows no redeploy
and no error while you flipped. Recorded: ____________________________________

9d. Flip back to `true`, or leave it `false`, per your decision below — then rebuild, and note which
state you are leaving the tree in: ____________________________________

---

## 10. Final approval — HOME-01 and all of Phase 26

Two decisions, please, named separately:

1. **Command Center v2 (HOME-01)** — approved to become the default `/dashboard`
   (`COMMAND_CENTER_V2 = true`, with `LegacyDashboard.tsx` deleted in a follow-up)?
2. **Phase 26 as a whole** — connected product pages plus the vault redesign: approved to close?

```
APPROVED
  Command Center v2 (HOME-01): _______________________________________________
  Phase 26 overall:            _______________________________________________
  Leave the switch at:         true / false   (circle one)

DEFECTS  (exact, one per line — step number, what you saw, what you expected)
  1. __________________________________________________________________________
  2. __________________________________________________________________________
  3. __________________________________________________________________________
```

### After you answer

- **Approved** → `26-20-SUMMARY.md` is written, quoting your recorded observations from steps 1-9
  verbatim, alongside the Task 1 command results and the step-9 rollback evidence. The switch flips
  to `true`, and both watched playbooks record the final rollback and verification procedure.
- **Defects** → nothing closes. They get fixed, the affected steps get re-run, and this script comes
  back to you with the re-run observations before the phase can close.
