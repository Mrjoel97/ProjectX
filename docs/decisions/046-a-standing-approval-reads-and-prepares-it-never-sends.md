# ADR-046 — A standing approval reads and prepares; it never sends

- **Status:** Accepted
- **Date:** 2026-09-09
- **Owner decisions, 2026-09-09:** standing approval covers **read + prepare only**; an unattended
  run **reserves its envelope up front**; a missed occurrence is **skipped, never burst-executed**;
  and a throwaway scheduled function firing across a real DST transition is **admissible `live`
  evidence** for `dst-boundary`.
- **Supersedes:** nothing. `29-RECURRENCE-DECISION.md` is a decision RECORD consumed by 29-12/29-13
  and is not edited here; its `decision: defer` key stands until a later phase earns the rows.
  ADR-038's envelope arithmetic is unchanged — this ADR reserves an envelope, it does not resize one.

## What this ADR does and does not do

It **rules the seven `manual` rows** of the ROUT-02 matrix that have carried "recommendation only"
since 2026-08-29, plus the `cost` row's missing half. It builds **nothing**. G25's row says *"do not
build the table first"*, and `schema.ts`'s sentence — *"There is deliberately NO `routines` table,
cron, trigger, recurrence, next-run timestamp, execution-history table, canvas or DSL"* — remains
true on the day this ADR is accepted.

It does **not** re-decide the time arithmetic. `packages/core/src/routineSchedule.ts` already proves
it against real ICU tzdata, including Lord Howe's 30-minute gap, both 01:30s of a fall-back night
collapsing onto one `occurrenceKey`, 23- and 25-hour local days, and Pacific/Apia's date-line skip
yielding no occurrence at all. The spike stays **unimported**, and `routineDecision.test.ts` keeps
enforcing that until the phase that consumes it.

---

## Decisions

### D1. A standing approval covers RETRIEVAL and PREPARATION. It never authorises an external write.

A routine running unattended may read what the tenant has already connected it to, and may produce
artifacts **inside the product** — a draft, a memo, a document, a queued plan row. Every action that
leaves the building — email, calendar write, connector mutation, publish — **materialises a per-run
plan that a human approves**, exactly as an attended turn does today.

This is the whole autonomy boundary, and it is deliberately the conservative one: the value of
"the draft is waiting at 7am" is most of the value of "it was sent at 7am", at a fraction of the
blast radius. A routine that silently sends is a routine whose every other row — retry, overlap,
material change — becomes a way to send the wrong thing twice.

**The boundary is the EXISTING approval gate, not a new one.** A prepared artifact lands as a plan
row at `proposed`, reaching the approvals inbox by the path Phase 42 already built. No routine-shaped
bypass is created, so there is nothing new to get wrong.

### D2. A material change invalidates the standing approval. "Material" is a CLOSED list.

A standing approval is bound to what the human saw. If any of the following changes, the routine
returns to `awaiting_approval` and does not run until re-approved:

- the prompt or template body it runs, or its pinned version
- the recipient set, for any routine that prepares an addressed artifact
- the connected account or provider identity it reads through
- the budget envelope assigned to it
- the schedule itself (cadence, wall time, or timezone)

**Comparison is over STRUCTURED values, never a joined string.** The helper deleted in round 2 of
ROUT-02 normalised `["a b"]` and `["a","b"]` to the same text, so a change to the recipient list
could report as immaterial — the exact failure this rule exists to prevent. Compare arrays
element-wise, after ordering, with the element boundary preserved.

Anything not on that list is immaterial and the approval survives it. A closed list is what makes
this checkable; an open "significant change" test is a judgement call that would drift.

### D3. A missed occurrence is SKIPPED, never burst-executed.

If a tick does not fire on time — deploy, outage, cold deployment — the occurrence is recorded as
missed and abandoned. There is a **grace window** inside which a late tick still counts as the run it
was armed for; outside it, the run is skipped and the next occurrence is armed normally.

Never queue-and-drain. An outage that ends must not fire twelve runs at once, each of them spending
and each of them preparing an artifact for a moment that has passed. The failure mode of skipping is
one missing digest; the failure mode of bursting is a bill and an inbox.

The grace window's length is an implementation parameter for the consuming phase, not a decision
here — but it is a **single named constant**, not a per-call literal.

### D4. One active run per routine. A due tick that meets a live run skips and records the overlap.

Overlap is not queued and not run in parallel. The skip is **recorded**, because a routine that
routinely overlaps is a routine whose cadence is wrong, and that signal must survive to be read.

### D5. Retries are bounded and the terminal classes are CLOSED.

Retryable: `provider_5xx`, `provider_timeout`, `internal`. Bounded — the ceiling is a named constant.

Terminal, never retried: `auth`, `validation`, `budget`, `paused`, `provider_refusal`.

A `provider_refusal` is an answer, not a failure. Retrying one is how a refusal becomes a spend loop,
and it is why the class is listed terminal rather than left to a numeric ceiling to absorb.

### D6. Pause and revoke are IMMEDIATE, and the callback re-reads after claiming.

Pausing writes the paused state **and** cancels the pending scheduled function. Neither alone is
enough: state without cancellation leaves an armed function that will fire, and cancellation without
state leaves the next arm free to re-arm it.

Because `scheduler.cancel` throws on an already-committed id — the same fact Phase 43's batch cancel
had to hold behind one guard — the cancel is best-effort and the **authoritative** check is in the
callback: after claiming its run, the callback re-reads status and version and stops if either moved.
A run that has already started is stopped at its next claim boundary, not mid-call.

### D7. The audit carries routine and run REFS, and nothing else.

`audit` is insert-only and refs-only (CLAUDE.md §3, §4), which is already the right substrate. This
ADR adds the vocabulary it lacks: a routine ref, a run ref, an occurrence key, and a closed outcome
class. **No prompt text, no recipient, no artifact content, no provider prose** — a refusal class,
never the provider's sentence.

A run that skipped (D3), overlapped (D4), exhausted retries (D5) or was paused mid-flight (D6) is
each a distinct outcome class. If an outcome cannot be named in that closed list, it is not a
permitted outcome.

### D8. An unattended run RESERVES its envelope before it starts.

`guardrails.preCall` → `recordSpend` gates spend at call time and reserves nothing. That is correct
for an attended turn, where a human is present to see a run stop halfway. It is wrong for an
unattended one: the run dies mid-way having already spent, leaving a half-built artifact and a
consumed budget with nobody watching.

A routine run therefore takes a **whole-run reservation before its first paid call**, and does not
start if the reservation cannot be met. This reuses the shipped mechanism rather than inventing one:
`limit({ reserve: true })` already takes whole-job reservations, and `media.reserveJob` already
consumes both rails that way for exactly this reason (ADR D10 — the reserved unit is the whole job).

A reservation is **released on every terminal path**, including the terminal failure classes in D5.
A reservation that leaks is worse than no reservation, because it silently shrinks the envelope for
every later run.

### D9. `live` evidence for `dst-boundary` is a scheduled function that FIRED across a real transition.

`check-routine-gate.mjs` will not offer `enable-safe` until `dst-boundary`, `oauth-expiry-reauth` and
`provider-read` each carry `evidenceType: live`, on the stated ground that *"a code path is not a
trace; a unit test is not a live run"*. That rule is correct and is **not weakened here**.

But it contains a bootstrap: `dst-boundary` cannot have live evidence until something schedules
across a real DST transition, and nothing schedules until the gate opens. This ADR resolves it by
naming what satisfies the row:

> A **throwaway `ctx.scheduler` function**, armed on a real deployment before a real DST transition
> and observed to fire on the far side of it, with its armed instant, its fired instant and the
> resolved wall time recorded. No `routines` table, no feature, no schema change.

This meets the gate's actual standard — a trace, not a test — because it is a real scheduled
execution on a real deployment across a real transition. What it deliberately does not claim is
anything about a *routine*: it proves the platform's scheduler and the tzdata agree across a
boundary, which is precisely and only what the row asks.

Two transitions fall inside the beta window: **2026-10-25 Europe/Berlin** and **2026-11-01
America/New_York**, both fall-backs — the harder direction, since a fall-back is where an ambiguous
local time exists twice and `occurrenceKey` must collapse both to one claim.

`oauth-expiry-reauth` is untouched by this ADR and remains genuinely blocked on a real 7-day refresh
clock lapsing. It is not bootstrapped: that clock runs whether or not routines exist.

---

## What must be true before the gate is asked again

The consuming phase earns the rows; it does not relabel them. In particular:

1. D1–D8 give the seven `manual` rows a ruling to cite, which is what they lacked. A row moves to
   `pass` when the ruling is **implemented and tested**, not when this ADR is accepted.
2. `dst-boundary` moves to `live` only on the trace D9 describes, captured and referenced.
3. `29-RECURRENCE-DECISION.md` is superseded by a NEW artifact, never edited. Its `decision:` key is
   read by 29-12/29-13 and CLAUDE.md §9 forbids amending an accepted record.
4. `check-routine-gate.mjs` is not loosened. Its three fail-open holes were found by adversarial
   verifiers rather than by tests, and that work is not to be spent.

## Consequences

**Accepted:** a routine cannot finish a send unattended, so the first version of recurring routines
is a *preparation* engine, not an autonomous agent. That is the deliberate trade — D1 buys a blast
radius small enough that the remaining rows are tractable.

**Cost:** reservation adds a release path to every terminal branch (D8), and a leak there shrinks the
envelope silently. The consuming phase owes a test that a run failing in each terminal class of D5
releases its reservation.

**Deferred:** unattended external writes. Revisiting D1 is a new ADR with its own evidence, and its
precondition is a routine that has run under D1 long enough to have a record worth reading.
