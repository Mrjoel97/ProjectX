# Phase 46 — The autonomy / standing-approval ADR

**Opened and closed 2026-09-09.** One plan: this commit. Research is `46-RESEARCH.md` (measured at
`9b992fc`); the deliverable is **ADR-046**. **No code, no schema change** — the same shape as Phase
41, and required by G25's own row: *"do not build the table first."*

## What the research changed before a word of the ADR was written

**G25's headline is half stale.** It says "no per-tenant schedule table; only one-shot `runAt` and
six static crons". The schema half is still true and deliberate — `schema.ts` carries "There is
deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp, execution-history
table, canvas or DSL", and "Routine v0" is `savedPrompts`, inert at rest.

But the **recurrence arithmetic already exists and is proven**. `packages/core/src/routineSchedule.ts`
is a deliberate spike written as evidence for a decision gate, not a scheduler, and nothing in
production imports it — `routineDecision.test.ts` enforces that by scanning `convex/**`, `apps/web`
and EVERY `packages/<pkg>/src` tree with roots **derived from the filesystem**, after an earlier
version hardcoded four of nine and a verifier's added import went unnoticed. It installs no Temporal
polyfill: ICU tzdata via `Intl.formatToParts`, with every candidate round-tripped back through ICU so
gaps and ambiguities are *detected* rather than assumed. Proven cases include Lord Howe's
**30-minute** gap (an implementation assuming "DST means one hour" fails there), both 01:30s of a
fall-back night collapsing onto one `occurrenceKey`, 23- and 25-hour local days, and **Pacific/Apia
2011-12-30 yielding no occurrence at all**.

So the ADR does not re-decide time. Had the research not been done first, it would have.

**ROUT-02 already ran a formal gate that said `defer`.**
`29-RECURRENCE-DECISION.md` (2026-08-29) carries a twelve-row matrix of which **one row is green**,
and it survived three adversarial rounds during which the gate itself was found fail-OPEN three ways
and a verifier built a complete self-arming recurrence subsystem the absence proof initially missed.
The **seven `manual` rows** are recommendations nobody ever ruled on — and they are exactly what an
ADR is for. That artifact is NOT edited here (CLAUDE.md §9); a later phase flips its key by earning
the rows.

## The structural finding

`check-routine-gate.mjs` — one of the sixteen free gates Phase 45 put into CI — will not offer
`enable-safe` until `dst-boundary`, `oauth-expiry-reauth` and `provider-read` each carry
`evidenceType: live`, on the stated ground that *"a code path is not a trace; a unit test is not a
live run"*.

That rule is correct. It also contains a **bootstrap**: `dst-boundary` cannot have live evidence
until something schedules across a real DST transition, and nothing schedules until the gate opens.
Left unaddressed, G25 never opens — not because anyone decided against it, but because the gate's
precondition is unreachable.

The ADR resolves it by *defining what satisfies the row* rather than weakening the gate (**D9**).

## ADR-046 — the decisions

| | |
|---|---|
| **D1** | A standing approval covers **retrieval and preparation only**. Every external write still materialises a per-run plan a human approves — via the EXISTING approvals path, so no routine-shaped bypass is created. |
| **D2** | A **closed list** of material changes invalidates the approval (body/version, recipients, connected identity, envelope, schedule). Comparison is over **structured values, never a joined string** — the helper deleted in ROUT-02 round 2 normalised `["a b"]` and `["a","b"]` identically, so a recipient change could read as immaterial. |
| **D3** | A missed occurrence is **skipped, never burst-executed**, with a grace window. An outage that ends must not fire twelve runs at once, each spending. |
| **D4** | **One active run per routine.** An overlapping tick skips and **records** the overlap — routine overlap means the cadence is wrong, and that signal must survive. |
| **D5** | Retries bounded for `provider_5xx` / `provider_timeout` / `internal`; `auth`, `validation`, `budget`, `paused`, `provider_refusal` **terminal**. A refusal is an answer, not a failure — retrying one is how it becomes a spend loop. |
| **D6** | Pause writes state **and** cancels the pending function; because `scheduler.cancel` throws on a committed id, the cancel is best-effort and the **authoritative** check is the callback re-reading status/version after claiming. |
| **D7** | Audit carries routine/run **refs, an occurrence key and a closed outcome class** — no prompt text, no recipient, no provider prose. An outcome that cannot be named is not a permitted outcome. |
| **D8** | An unattended run **reserves its whole envelope before its first paid call** and does not start if it cannot. Reuses `limit({ reserve: true })` / `media.reserveJob`'s shipped whole-job reservation. Released on **every** terminal path — a leak silently shrinks the envelope for every later run. |
| **D9** | `live` evidence for `dst-boundary` is a **throwaway `ctx.scheduler` function armed before, and observed firing after, a real DST transition** on a real deployment. A trace, not a test. No table, no feature. Two fall-backs are inside the beta window: **2026-10-25 Berlin**, **2026-11-01 New York**. |

**Owner decisions 2026-09-09:** read + prepare only; reserve up front; throwaway scheduled job as
`dst-boundary` evidence; skip and never burst.

## What this buys, and what it costs

The first version of recurring routines is a **preparation engine, not an autonomous agent** — the
draft is waiting at 7am, but nothing leaves the building unattended. That is the deliberate trade:
D1's small blast radius is what makes the other eight rows tractable at all. A routine that silently
sends turns every one of them into a way to send the wrong thing twice.

The cost is D8's release path on every terminal branch. The consuming phase owes a test that a run
failing in **each** terminal class of D5 releases its reservation.

## State at close

**Closed:** the seven `manual` rows now have a ruling to cite, and the `dst-boundary` bootstrap has a
defined exit.

**Not closed, and deliberately:** every matrix row is still `missing`. A row moves to `pass` when the
ruling is **implemented and tested**, not when this ADR is accepted — relabelling is the exact
failure `check-routine-gate.mjs` exists to catch, and this phase does not touch it.
`oauth-expiry-reauth` remains genuinely blocked on a real 7-day refresh clock lapsing; it is not
bootstrapped, since that clock runs whether or not routines exist.

**Next:** the consuming phase — schedule row that re-arms, per-run budget reservation, DLQ — in G25's
stated order, now that the ADR it was waiting on exists.
