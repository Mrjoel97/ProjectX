# ADR-040 — A fan-out child is an ASSIGNMENT, not a route

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** ADR-037 Decision 6's `≤5` worker figure, and the route-dedupe clause it implies.
  ADR-038 stands unchanged — the narrowing arithmetic is untouched and still governs.
- **Owner decision:** "the fanout should be able to release up to 15 agents not only 5."

## Context

`MAX_FAN_OUT = 5` was set by ADR-037 and the owner asked for 15. Raising the constant on its own
would have been a **no-op**, and that is the whole reason this record exists.

While a fan-out child was **a route**, the binding constraint was never `MAX_FAN_OUT`. It was
`SPECIALIST_ROUTES` — a closed six-member set — minus `media`, which `startTeamRun` refuses at the
door. Five distinct workers were available, `legalRoutes` deduped by route, and the cap happened to
equal the same number. Changing `5` to `15` would have let more entries through the arithmetic and
still produced at most five children, because the dedupe collapsed the rest.

The dedupe is not incidental and must not be removed: five `research` entries on one question are
five *identical* paid turns for one answer, and the cycle guard cannot catch it — `wouldCycle` is
evaluated per child against an empty ancestry and never fires between siblings.

So "more agents" required changing what a child **is**, not what a constant says.

## Decision

**1. A child is an assignment: a route AND its own sub-question.** `dispatchTeam` takes
`assignments: { route, question }[]` alongside the umbrella `question`. The umbrella question briefs
nobody; it is the approval card's subject and what the assembled parent memo answers. Each worker is
dispatched with **its own** sub-question.

**2. Dedupe is on the PAIR.** Same route + same sub-question still collapses to one worker, so the
identical-paid-turn protection is preserved exactly. Same route + different sub-questions is now
several workers, because it is several different pieces of work. The key is case-folded and
whitespace-collapsed so a trivial re-spelling cannot buy a second paid turn; the **original** wording
is what briefs the worker, because the model's own phrasing is the brief.

**3. A blank sub-question is DROPPED, never defaulted to the umbrella question.** Defaulting would
quietly re-create the identical-turn case one layer down, wearing a route the caller really did ask
for — and no dedupe could see it there.

**4. `MAX_FAN_OUT = 15`, and it binds for the first time.** It is a **money ceiling**, not a
concurrency preference. A child is dispatched with `spentCents: 0` and `governedDispatch` refuses
only on `spent >= envelope`, which is false at the start of every child — so the envelope bounds
*recursion*, not the first turn. This constant is the real bound on how many paid turns one Approve
can buy. ADR-038's `narrowFanOut` still caps `n` by `rootEnvelope`, so a thin rail starts fewer.

**5. `ROOT_SCAN` is DERIVED from `MAX_FAN_OUT`, not a literal.** `2 * (MAX_FAN_OUT + 1)`.

## Why Decision 5 is in this ADR rather than left as a comment

ADR-037 Decision 2 justified `ROOT_SCAN = 20` **in prose**: "a descending scan meets a root after at
most `C_max` rows — 6 for a G6 fan-out (≤5 workers), 11 for a G10 batch (2–10). A window of 20
carries headroom." Raising the cap to 15 makes the true bound 16. Still under 20 — so the literal
would have kept passing, with four rows of margin instead of the "headroom" the ADR claimed, and
nothing anywhere would have said so.

That is the same defect class as the `declaredUnsupported` conjunction diagnosed in 42.1 the same
day: **a constant whose safety depends on another constant's value, with the dependency recorded
only in a comment.** The prose does not fail when the premise expires. So the relationship is code
now, and `fanOut.test.ts` pins `ROOT_SCAN > MAX_FAN_OUT + 1` rather than pinning either number.
`plans.test.ts`'s scan-window test was hardcoding `20`; it derives from `ROOT_SCAN` now, because a
test that hardcodes the bound it is checking stops checking it the moment the bound moves.

## Consequences

- One Approve can now buy up to 15 paid specialist turns, ~3× the previous ceiling. The daily rail
  narrows this automatically when it cannot fund them (ADR-038), and `workerCount` on
  `subagent.dispatched` records how many actually started.
- The model must now author a genuine breakdown rather than a list of names. The `cockpit-agent`
  body teaches it (ADR-007: a granted capability must be TAUGHT), which makes a new **gated
  candidate** — it is unreachable until the eval gate 42.1 diagnosed is unjammed and it is activated.
- A child's `subject` carries the route *and* the sub-question, because two children may now share a
  route and two identical `## Research` headings in the assembled parent memo would leave the reader
  unable to tell which answer belonged to which question.
- Phase 43's batch children reuse this shape: a content variant is an assignment whose "route" is a
  variant rather than a specialist.
- `MAX_DEPTH = 1` is unchanged. Nothing here lets an agent spawn an agent.

## Rejected

- **Raise the cap and drop the dedupe.** The smallest diff literally matching "15 not 5", and it
  re-opens the money defect the dedupe exists to close: N identical entries buy N identical turns.
- **Grow `SPECIALIST_ROUTES` past six.** Each new route needs its own registry body and its own eval
  evidence — a phase of its own, and blocked behind the same gate.
- **Parallel arrays (`routes[]` + `subQuestions[]`).** A pairing that can silently mis-align.
