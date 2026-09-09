# 46-RESEARCH — the autonomy / standing-approval ADR (Track C step 13, G25)

**Measured 2026-09-09 at `9b992fc`.** Research only. No code, no schema change, no ADR yet — this
note establishes what already exists so the ADR decides what is actually undecided.

## 0. Why this phase, and why it is an ADR rather than a build

The merged order's step 13 is "Autonomy ADR → recurring routines (G25) → connectors → marketing
loop". G25's own row fixes the internal sequence and is unusually explicit:

> Correct order: OAuth verification (G20) → standing-approval ADR (08-24 §4) → schedule row that
> re-arms + per-run budget gate + DLQ. **Do not build the table first.**

Step 12 is settled and not next: the retention ADR shipped as **ADR-044** (Phase 44), workspace
identity waits on a first team customer that does not exist, and BYOK is premature — all three
established by Phase 44's research turn.

## 1. WHAT ALREADY EXISTS — and G25's headline claim is half stale

G25 says "no per-tenant schedule table; only one-shot `runAt` (deferred send) and six static crons".
The schema half is **still true and deliberate**. `schema.ts` carries, verbatim:

> There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp,
> execution-history table, canvas or DSL.

"Routine v0" is `savedPrompts` — saved cockpit prompt text, INERT AT REST, whose only execution path
is a human clicking Run, which starts an ordinary governed cockpit turn. Phase 29 extended that row
with pin lineage rather than adding a second pinned surface.

**But the recurrence arithmetic is already built and proven**, which the audit row does not say.
`packages/core/src/routineSchedule.ts` is a deliberate SPIKE — `nextOccurrence()`, `wallPartsAt()`,
`zoneOffsetMs()`, `resolveLocalInstant()`, `occurrenceKey()` — written as *evidence for a decision
gate*, not as a scheduler. Nothing in production imports it, and `routineDecision.test.ts` enforces
that by scanning `convex/**`, `apps/web` and EVERY `packages/<pkg>/src` tree (roots derived from the
filesystem, after an earlier version hardcoded four of nine and a verifier's added import went
unnoticed).

It uses no `@js-temporal/polyfill`: `Intl.DateTimeFormat(..., { timeZone })` + `formatToParts`
resolves real IANA wall time against full ICU tzdata, and every candidate is round-tripped back
through ICU before being returned — so gaps and ambiguities are *detected*, never assumed. Proven
cases include Lord Howe's **30-minute** gap (an implementation assuming "DST means one hour" fails
there), both New York 01:30s on a fall-back night collapsing to the same `occurrenceKey`, a 23-hour
and a 25-hour local day, and **Pacific/Apia 2011-12-30 yielding no occurrence at all** (date-line
skip).

**Consequence for this phase: the ADR must not re-decide the time arithmetic. It is done.**

## 2. THE PRIOR DECISION — ROUT-02 already ran a formal gate, and it said `defer`

`.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md` carries
`decision: defer` (2026-08-29) under the owner's pre-ruling "let the gate decide, fail-closed", and
a twelve-row matrix. It survived three rounds of adversarial verification, during which the gate
itself was found fail-OPEN three ways and fixed, and a verifier built a complete self-arming
recurrence subsystem that the absence proof failed to catch until it was hardened.

`packages/backend/scripts/check-routine-gate.mjs` is the gate. It is one of the sixteen free gates
Phase 45 put into CI, so it runs on every push today.

**One of twelve rows is green.**

| Row | Status | Why it is not green |
|---|---|---|
| `provider-read` | **pass / live** | The only green row. Human-verified 2026-07-12 against a real mailbox. |
| `standing-approval` | missing / manual | **Recommendation only** — standing approval covers read-only retrieval and in-app preparation; every external write still materialises a per-run plan. |
| `material-change-reapproval` | missing / manual | Recommendation only. Its helper was deleted in round 2 as premature implementation. |
| `missed-run` | missing / manual | Recommendation only: skip, never burst-execute; grace window in which a late tick still counts. |
| `overlap` | missing / manual | Recommendation only: one active run per routine; a due tick meeting a live run skips and records. |
| `retry` | missing / manual | Recommendation only: bounded retries for `provider_5xx` / `provider_timeout` / `internal`; `auth`, `validation`, `budget`, `paused`, `provider_refusal` terminal. |
| `pause-revoke` | missing / manual | Recommendation only: immediate state + cancellation of the pending scheduled function, callback re-reading status/version after claiming. |
| `audit-notify` | missing / manual | Recommendation only. `audit` insert-only + refs-only is the right substrate, but no routine/run refs exist. |
| `run-identity` | missing / automated | `occurrenceKey()` is proven, including both 01:30s of a fall-back night colliding deliberately. |
| `dst-boundary` | missing / automated | **Required live.** Arithmetic proven against real tzdata; a unit test is not a live run. |
| `oauth-expiry-reauth` | missing / automated | **Required live.** The code path is real (`gmailAuth.flagExpiringTokens` warns ~24 h before the 7-day refresh clock). |
| `cost` | missing / automated | `guardrails.preCall` → `recordSpend` gates spend today. What is missing is **reserving**. |

**The seven `manual` rows are exactly the ADR's job.** Each is a recommendation nobody has ruled on.
Writing them down as decisions is the whole deliverable, and needs no code and no OAuth.

## 3. THE STRUCTURAL PROBLEM THE ADR MUST SOLVE — a live-evidence bootstrap

`check-routine-gate.mjs` will not offer `enable-safe` unless `oauth-expiry-reauth`, `dst-boundary`
AND `provider-read` each carry `evidenceType: live`. Its header states the failure mode it exists to
catch: *"A code path is not a trace; a unit test is not a live run; `manual` is not `live`."* That
rule is right, and it is why the gate has held.

But it creates a bootstrap: **`dst-boundary` cannot have live evidence until something schedules
across a real DST transition, and nothing can schedule until the gate opens.** The same holds more
weakly for `oauth-expiry-reauth`, which needs a real 7-day refresh clock to actually lapse.

This is not an argument to weaken the gate — it is the thing the ADR has to define. The plausible
resolution is that "live" for `dst-boundary` means *a scheduled function on a real deployment firing
across a real transition*, which `ctx.scheduler` can already demonstrate with a throwaway job and no
`routines` table. That satisfies the gate's actual standard (a trace, not a test) without building
the feature first. **The ADR should say so explicitly, or the gate stays shut forever and G25 never
opens.**

Two real DST transitions are available for such a trace: **2026-10-25 Europe/Berlin** (fall back) and
**2026-11-01 America/New_York** (fall back). Both are inside the beta window.

## 4. WHAT THE ADR MUST NOT DO

- **Not build the table.** G25 says so, and Phase 29 held that line through three verification
  rounds. An ADR that ships a schema change is not an ADR.
- **Not re-decide the time arithmetic** (§1) — it is proven, and the spike stays unimported.
- **Not edit `29-RECURRENCE-DECISION.md`.** Its `decision:` key is consumed by 29-12/29-13, and
  CLAUDE.md §9 makes ADRs immutable: supersede, never edit. A later phase flips it by earning the
  rows, not by rewriting the artifact.
- **Not weaken `check-routine-gate.mjs`.** Its three fail-open holes were found by adversarial
  verifiers, not by tests; loosening it now would discard that work.

## 5. OWNER QUESTIONS — asked before any ADR text is written

1. **How far does a standing approval reach?** The standing recommendation is that it covers
   read-only retrieval and in-app preparation only, with every external write still materialising a
   per-run plan a human approves. The alternative is to let a standing approval also cover *named*
   external writes (e.g. "send the Monday invoice reminder") so a routine can complete unattended.
   This is the core autonomy decision and it is a risk/product call, not a technical one.
2. **Money: reserve or gate?** `preCall`/`recordSpend` gates spend at call time; nothing reserves.
   An unattended run can therefore die halfway having already spent. Reserve the envelope up front
   and refuse to start a run that cannot afford to finish, or keep per-call gating and accept
   partial spend?
3. **The live-evidence bootstrap (§3).** Ratify that a throwaway scheduled function firing across a
   real DST transition is admissible `live` evidence for `dst-boundary`, or name what else would be.
4. **Missed runs.** Skip and never burst-execute (the recommendation), or is there a class of
   routine the owner wants executed late?
