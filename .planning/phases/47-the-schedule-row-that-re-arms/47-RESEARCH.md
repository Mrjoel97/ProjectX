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
