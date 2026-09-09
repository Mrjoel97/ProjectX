# 47-RESEARCH — the G25 consuming phase: a schedule row that re-arms, a per-run reservation, a DLQ

**Measured 2026-09-09 at `dd13f77`.** Research only. No code, no schema change — this note
establishes what the tree already provides so the phase builds the smallest thing that satisfies
ADR-046, and asks the four questions that materially change the design.

ADR-046 is the input. It ruled D1–D9 and built nothing; this phase is the first that may write a
table. G25's order is now satisfied: standing-approval ADR **done**, schedule row **next**.

---

## Finding 1 — the absence proof is a LOADED GUN, and this phase is what trips it

`packages/backend/convex/routines.test.ts` exists to prove recurrence is **absent** from the tree,
and it will go red the moment this phase adds a module. That is by design and must be handled
deliberately, because of *how* it was built.

Rounds 1–3 of that file asked "does any file contain one of these ten tokens?". **Three independent
verifiers defeated it, independently, simply by not using the words** — a `recurrenceEngine.ts` +
`tick.ts` self-arming via `ctx.scheduler.runAt` (135/135 green), a `cadence.ts` + `dueTimer.ts`
pair (89/89 green), and a per-tenant self-arming `digestLoop.ts` (8/8 green). Round 2 was defeated
by a trailing `//`; round 3 by renaming, and separately by changing one letter's case.

The conclusion written into the file is the thing to preserve: **"A BLOCKLIST OVER AN OPEN
VOCABULARY CANNOT PROVE ABSENCE. Renaming defeats it, always."** So the question was replaced with
two closed allowlists — `CONVEX_MODULES` (the whole convex namespace, enumerated from the
filesystem, so a new module under ANY name in ANY subdirectory is a visible governance diff) and
`SCHEDULER_CALL_SITES` / `CRON_REGISTRARS` (every file calling a scheduling primitive). All three
attacks needed a new module, because `ctx.scheduler` and `internalMutation` exist nowhere else.

**This phase must convert that file from an absence proof into a SHAPE proof, not delete it.** The
allowlists are exactly the right instrument for "a routine arms its next occurrence" versus "a
workflow step schedules a follow-up" — the file says so itself. Deleting it discards three rounds of
adversarial work; leaving it red discards the signal. Converting it means the new module and the new
scheduler call site are each a deliberate, reviewed line.

Note also its own standard: every absence claim in that file carries a **positive control** in the
same test, because this repo shipped a `toHaveCount(0)` that passed with all six packs active.

## Finding 2 — the tick already exists, and it is a cron, not a self-arming loop

`crons.ts` registers **seven** jobs today (the audit row says six — minor drift, corrected here),
including:

```
crons.interval("reliability-sweep", { minutes: 30 }, internal.reliabilitySweep.runSweep, {});
```

A due-check can ride an interval cron instead of a self-arming `ctx.scheduler` chain. That matters
for more than taste: **the self-arming loop is precisely the shape all three verifier attacks took**,
and it is the shape that makes "is this routine still armed?" a question about a scheduled-function
id rather than about a row.

The trade is granularity. A 30-minute sweep fires a 07:00 routine somewhere in 07:00–07:29. Exact
arming via `ctx.scheduler.runAt` fires at 07:00 but owns a re-arm chain, a cancel path (ADR-046 D6),
and an id that can be orphaned by a deploy.

A sweep also composes better with D3 (skip, never burst) and D4 (one active run): a sweep asks "what
is due and not running?" and answers it declaratively from rows, where a chain has to *not* have
lost its own arm.

## Finding 3 — the reservation release is real, but the repo deliberately has BOTH policies

ADR-046 D8 requires a whole-envelope reservation released on every terminal path. Both halves exist,
and choosing between two shipped precedents is this phase's money decision.

**The reserve half is a straight reuse.** `limit({ reserve: true })` takes whole-job reservations, and
`maxReserved` is deliberately UNSET on the reserving rails — `validateRequest` enforces it only on
the reserve path, so leaving it unset is precisely what permits a whole-unit reservation. *Setting it
"for safety" breaks the reservation.*

**The release half has two opposing precedents, and neither is a bug:**

| Rail | Policy | Stated reason |
|---|---|---|
| **ingest** | refunds, via `releaseFolderReservation` — *"THE ONE PLACE a reservation is ever released"* | over-reserves by **dollars** (the estimator prices every unprobed PDF as a 50-page scan); refusing to refund would charge $25 for a $2 folder |
| **media** | **never** refunds | over-reserves by **cents** (every line bounded by `MEDIA_JOB_CAP_USD` $3.50); a ledger would not pay for itself |

The refund mechanism has sharp edges worth knowing before committing to it:

- **It is arithmetic, not an API.** `@convex-dev/rate-limiter@0.3.2` has no release/refund/credit
  call; `count` is an unvalidated float and `value = min(...) - count`, so a **negative count**
  credits the window. The dependency is EXACT-pinned and pre-1.0 (CLAUDE.md §6) — *a bump can
  silently stop refunds*, which is why `guardrails.test.ts` drives the real component.
- **It is clamped, and the clamp was learned expensively** — a live probe once refunded 2900 against
  a capacity of 2500. `refundableCents` also returns **0 if the window rolled** since the
  reservation.
- **It is idempotent by CAS**, because a re-entered workflow `onComplete` can and does happen.
- The stated upgrade path is *a real spend table*, not a better credit call.

So D8's release path is implementable by reuse — but **which precedent applies depends on whether a
routine run over-reserves by cents or by dollars**, and that is the owner's call, not mine to assume.

## Finding 4 — where the row lives is a ladder question, and Phase 29 already answered its cousin

"Routine v0" is `savedPrompts`: saved cockpit prompt text, INERT AT REST, whose only execution path
is a human clicking Run. When Phase 29 needed pinned *workflows*, it **extended that row rather than
adding a second pinned surface**, and said why: `save`/`list`/`remove`, the twenty-entry menu, the
code-derived title and the "Run is an ordinary fresh cockpit turn" execution path are all inherited
verbatim (CLAUDE.md ladder rung 2), where a parallel table would duplicate all of it and put a second
pin menu in the workspace.

The same argument points at extending `savedPrompts` with a schedule. The counter-argument is real
too: a schedule has run state (next due, last run, active run, paused, consecutive failures) that an
inert pin does not, and hanging run state off a "saved text" row is how a table stops meaning one
thing. `schema.ts` also carries a KNOWN CONSTRAINT on that row — `textHash` is computed from the
text alone, so two pins differing only in lineage collide on `by_tenant_textHash`; a schedule-bearing
pin would need the same hash discipline.

**`deadLetters` needs no new table.** It already carries `tenantId`, `correlationId`, optional
`workflowId`, `payload`, `error`, `status: new|replayed|resolved` and `by_tenant_status`. Its
`source` union is `"workflow" | "billing"` and was made optional precisely because *"the field is
optional because the fact is optional"* — a routine failure is a third source, which is a
widen-only change of exactly the kind that field already absorbed once.

---

## What this phase must NOT do

- **Not weaken `check-routine-gate.mjs`.** Rows move to `pass` by being implemented and tested.
- **Not edit `29-RECURRENCE-DECISION.md`** (CLAUDE.md §9) — supersede with a new artifact.
- **Not delete `routines.test.ts`** — convert it (Finding 1).
- **Not set `maxReserved`** on a reserving rail (Finding 3).
- **Not send anything.** ADR-046 D1: retrieval and preparation only; every external write still
  materialises a per-run plan through the existing approvals path.

## Finding 5 (2026-09-09, AFTER the owner's answers) — THE PHASE CANNOT BUILD THE TABLE YET

This was found by trying. With the owner's four answers in hand I wrote ADR-047, added the
`routines` table to `schema.ts`, and ran the guards. **Six went red exactly where they should**, and
one of them was a rule this research had missed:

```
decision is `defer` but docs/decisions/047-one-routines-table-…md exists — no ADR may be minted
```

`check-routine-gate.mjs`'s `deferAbsenceChecks` forbids **any ADR whose FILENAME matches
`routine|recurrence|schedul`** while `29-RECURRENCE-DECISION.md` records `decision: defer`. Its own
ponytail note states the two exits:

> *Upgrade path if it ever fires falsely: **rename the ADR, or lift the defer**.*

**Renaming is not available to us.** Slipping past a governance scan by choosing different words is
precisely the attack three verifiers used to defeat this repo's earlier absence proofs, and the
lesson written into `routines.test.ts` is that a blocklist over an open vocabulary cannot prove
absence. Renaming ADR-047 would be that behaviour, performed deliberately, by the person the gate
exists to stop.

**Lifting the defer is not available either — yet.** `check-routine-gate.mjs` accepts only
`defer | enable-safe`, and will not offer `enable-safe` until `dst-boundary`, `oauth-expiry-reauth`
and `provider-read` each carry `evidenceType: live`. Only `provider-read` does.

So the ordering was wrong, and the gate caught it. **The table is not this phase's first deliverable.
The EVIDENCE is.** ADR-046 D9 defined what `dst-boundary` evidence looks like; nobody has collected
it. Defining evidence and holding it are different things, and the gate is built to know the
difference — it is the same distinction that made 44-07's erasure spec matter only once it actually
ran.

### What was reverted, and what it proved

`schema.ts` and the ADR were reverted; `schema.test.ts` + `routines.test.ts` are **50/50 green**
again. The exercise was not wasted — it is the positive control for the whole guard family. Watched
going red, in order:

| Guard | Failure |
|---|---|
| `no table named after a routine, schedule, cron, recurrence or run history` | the new table |
| `no table name contains routine/cron/recurr/schedul at all` | `table routines is recurrence-shaped` |
| `NO FIELD ANYWHERE is a next-run, cadence, timezone-rule…` | `a schema field is named ianaTimezone` |
| `the L359 promise is still written down` | the superseded sentence |
| `the ten banned tokens … none appears in the convex namespace` | the new comments |
| `no ADR may be minted` | ADR-047's filename |

`CONVEX_MODULES` and `SCHEDULER_CALL_SITES` stayed **green**, correctly — no module was added. They
are what will fire on the next attempt, and they are the two that renaming cannot dodge.

### THE REVISED PHASE SCOPE

Not the table. In order:

1. **Collect `dst-boundary` live evidence** (ADR-046 D9): a throwaway `ctx.scheduler` function armed
   before, and observed firing after, a real DST transition, recording armed instant, fired instant
   and resolved wall time. This needs no `routines` table, mints no ADR and installs no dependency,
   so it does not trip `deferAbsenceChecks`. It DOES need a `SCHEDULER_CALL_SITES` entry — a
   deliberate, reviewed one-line diff, which is exactly what that allowlist is for.
   **Next transitions: 2026-10-25 Europe/Berlin, 2026-11-01 America/New_York.**
2. **Collect `oauth-expiry-reauth` live evidence**: a real Gmail 7-day refresh clock observed
   lapsing and re-authing. `gmailAuth.flagExpiringTokens` already warns ~24 h ahead. Not
   bootstrapped — that clock runs whether or not routines exist — so it is available on a ~7-day
   horizon rather than a six-week one.
3. **Then** supersede `29-RECURRENCE-DECISION.md` with an artifact recording `enable-safe`, which
   the gate will accept once (1) and (2) are held and every other row is `pass`.
4. **Then** the table, under an ADR that may finally be minted.

### The design decisions, PRESERVED but not yet minted

The owner delegated two of the four questions and they were answered; the answers are recorded here
rather than lost, to be minted as an ADR when the defer lifts:

- **A new `routines` table, not an extension of `savedPrompts`.** That row is defined as INERT AT
  REST — a contract, not an implementation detail — and `by_tenant_textHash` already collides on
  identical text, so two schedules of one prompt would be two routines and one hash. Above all, a
  new module and a new table are a **visible governance diff**; burying recurrence under an existing
  table name would spend exactly the visibility the guards buy. A routine REFERENCES a
  `savedPrompts` row, which is the reuse the ladder actually asks for.
- **Due-ness is COMPUTED, never stored — there is no `nextRunAt`.** The sweep resolves the
  occurrence key for "now" in the routine's zone and compares it with `lastOccurrenceKey`. This
  removes the re-arm chain a deploy or cancel can orphan, composes with D3/D4 (a sweep asks "what is
  due and not running?" declaratively from rows), and reduces the schema's carve-out from the
  twenty-name banned list to **exactly one**, `ianaTimezone` — named honestly rather than spelled
  around.
- **One envelope constant, `ROUTINE_RUN_ENVELOPE_CENTS`**, reserved on the EXISTING
  `dailySpendCents` + `deploymentSpendCents` rails so a routine cannot escape either ceiling. Not a
  per-routine field (nobody sets it in a free beta) and not a share of the daily budget (which makes
  the same routine succeed at 09:00 and be refused at 17:00 for no reason a user can act on).
  `maxReserved` stays UNSET — setting it "for safety" breaks a whole-unit reservation.
- **The routine envelope REFUNDS; media and ingest keep their own policies.** Reserving ~$1 and
  spending $0.10 is dollars of drift, which is ingest's case, not media's.

## Owner questions

1. **Tick: cron sweep or exact arming?** Ride the existing 30-minute `reliability-sweep` shape (30-min
   granularity, declarative, no arm chain to lose, and avoids the self-arming shape three verifiers
   used to defeat the absence proof) — or `ctx.scheduler.runAt` for exact wall-time firing, owning a
   re-arm chain and a cancel path?
2. **Money: refund or consume?** Does a routine run over-reserve by **cents** (media's precedent — no
   refund, simplest, honest if envelopes are small and bounded) or by **dollars** (ingest's precedent
   — refund via the clamped, CAS-idempotent negative-count path)?
3. **Where does the schedule live?** Extend `savedPrompts` (ladder rung 2, Phase 29's own precedent)
   or a new table for run-bearing state?
4. **How much does one routine cost, and who says so?** D8 refuses to start a run that cannot afford
   to finish, which requires a per-run envelope figure. Is that a fixed per-routine cap the owner
   sets, a share of the existing daily tenant budget, or a per-routine value the user chooses within
   a ceiling?
