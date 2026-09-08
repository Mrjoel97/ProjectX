# ADR-041 (DRAFT) — An eval failure must be attributable before it can veto

- **Status:** **PROPOSED — NOT ACCEPTED. Do not implement from this document yet.**
  It is blocked on one measurement, named in "The measurement that must land first" below.
  Being a draft, it may still be edited; once accepted it becomes immutable like every other ADR
  (CLAUDE.md §9) and further change happens by supersession.
- **Date drafted:** 2026-09-07
- **Supersedes:** nothing yet.
- **Related:** ADR-035 (fixture selection is an operator fact); the 42.1 commit (`6cf2f62`), which
  diagnosed the current red and shipped the instrument this decision depends on.

## Context

`shouldRecordEvidence` requires **all 46 golden cases green with no filters**, and
`activateSkillVersion` refuses a gated candidate without that evidence. The consequence, observed
rather than predicted: one red fixture jams **every** gated activation in the system —
`cockpit-agent`, `research-specialist` v4, six packs, the revenue pins.

Phase 40 is the worked example. A document-format edit to `cockpit-agent` was certified against 46
live cases; `33-research-insufficient-evidence` failed, on the research lane, twice. The summary
states the outcome exactly: *"the change is exonerated and the gate is still red."* ~$0.90 and 46
live model conversations, and the verdict carried no information about the change under test.

### What must NOT be given up

The all-green rule is not arbitrary, and the argument for it is recorded in this repo rather than
assumed. A skill body is a **global prompt**, and its blast radius is not the fixture that obviously
exercises it: 12-06's body edit needed a regression guard that the playbook describes as *"what
protects the other 25 golden fixtures from a spurious assessment call."* A body change moves
behaviour on paths the diff never touches. Nobody would have drawn that pairing on a relevance map.

So **narrowing what runs is rejected.** The cases most worth keeping are exactly the ones nobody
would have put in the bundle.

### The deadlock any scoping scheme inherits

`spreadsheet-drafter` is deliberately **ungated** because `SKILL_NAMES` derives from `GATED_SKILLS`
and no golden fixture reaches the drafting path — gating it would mint a candidate no eval run could
ever certify and strand the row at v1 on its first body edit. Any bundle-based scheme reproduces
that hazard per skill: **a gated skill whose bundle is empty is a deadlock by construction.** An
invariant, not a note.

## The finding that shapes the decision

The obvious mechanism — "live cases are independently flaky, and 46 of them compound" — **does not
fit the observed failure**, and designing against it would produce a mechanism that measures nothing.

The Phase-40 data:

| Run | Body | Result |
|---|---|---|
| full, 46 cases | pinned candidate | case 33 FAILED |
| full, 46 cases (re-run) | pinned candidate | case 33 FAILED, identical signature |
| `--only 33-research` | **active** body | PASSED (on a retry) |
| `--only 33-research` | **pinned candidate** | PASSED, first attempt |

Fixture 33 **passes in isolation on both bodies and fails in the full suite on both.** The
discriminating variable is not the body version — it is **suite position**.

This refutes the natural design of a per-case A/B ("re-run the failing case on the active body; if
it fails there too it is not the candidate's fault"). Run in isolation, that A/B would have returned
*pass on both* in Phase 40 — no signal at all, not even a standing red. Therefore:

> **An attribution A/B must run in situ — same suite, same position — or it is measuring a different
> system than the one that failed.**

One candidate mechanism was checked and largely excluded: all 46 cases share one throwaway
`eval-<runId>` tenant with a 500¢ cap, so by case 33 roughly 65¢ is spent and the derived envelope
is ~109¢ instead of ~125¢. Real and order-dependent, but ~13% against a specialist turn costing
8–17¢ — almost certainly too small to explain it. Recorded as ruled out rather than left as a
plausible story. The remaining hypothesis, untested, is that the executive's forwarded question
differs once thread and tenant state have accumulated.

## Proposed decision (pending the measurement)

**1. Breadth is kept. All 46 cases run for evidence.** Bundling is permitted only as *fail-fast
ordering* — run the likely-affected cases first so a real regression surfaces in a minute rather
than fifteen — never as a reduction in what must pass.

**2. A failure must be attributed before it can veto.** A case that fails identically **in situ** on
both the active and the candidate body is not evidence against the candidate. It becomes a
**standing red**: quarantined, with a named owner and a written cause, and it does not block
activation of unrelated skills.

**3. The quarantine list is an EXACT expected-failure set, never a threshold.** This is the clause
that keeps the mechanism from becoming the disease. A gate that reports "45/46, known red" silently
absorbs a *second*, new regression. The run is green only when the failing set **equals** the
quarantine set — a different case failing is a failure, and a quarantined case *passing* is also a
signal (the quarantine is stale and must be removed).

**4. A standing red on a capability is not a licence to ship it broken.** Quarantine unblocks
unrelated activations. It never converts a broken capability into an accepted one, and it carries an
expiry that forces the question back.

**5. Retries stay per-case and stay recorded.** `retriedCases` already exists and already reports
`PASS (retried)`; a retried pass is never reported as clean.

**6. No gated skill may have an empty bundle** (the `spreadsheet-drafter` invariant), enforced by a
test rather than a convention, if and when ordering-bundles are introduced.

## The measurement that must land first

> **UPDATE 2026-09-08 (ADR-043).** Questions 1 and 2 below are ANSWERED, analytically and at zero
> cost. The conjunction does not "beat" the declaration — it **absorbs** it: `evidenceVerdict`
> reads `sourceCount === 0 || declaredUnsupported` while `llm.ts` computes
> `declaredUnsupported = declaredQuestionScope && sources.length === 0` off the SAME array, so the
> disjunction reduces to `sourceCount === 0` and the declaration is unreachable in the verdict for
> every input (exhaustively checked: 0 of 24). So Q2's "is the conjunction load-bearing" is **no**,
> and Q1's premise is stronger than drafted. **Question 3 is untouched and still needs the run.**
> This draft therefore stays PROPOSED. Note that this ADR's own sentence below — "fixture 33's
> current red is a real broken capability (D11: a fabricated entity reads `sourced`)" — is
> CONFIRMED, and ADR-043 deliberately does not close it: it separates what fixture 33 can prove
> (the model refused to confabulate) from what it cannot (that the refusal reached the verdict).


One full `pnpm eval:golden --skill cockpit-agent@<v>` run, ~$0.90. Thanks to 42.1 the runner now
prints `questionScope / declaredUnsupported / insufficientEvidence` for **every** research fixture,
passing ones included, so a single run answers three questions at once:

1. Does 33 show `questionScope=true` with the conjunction beating it, **in situ**? (confirms or
   refutes 42.1's diagnosis on the live path)
2. Do 32 and 34 declare too — is the `&& sources.length === 0` conjunction load-bearing? (decides
   whether it can simply be dropped)
3. Does 33's in-suite reading differ from its `--only` reading on the same body? (isolates the
   suite-position variable this ADR turns on)

Until that lands, the shape of Decision 2 is a guess about what needs attributing. **Fixture 33's
current red is a real broken capability** (D11: a fabricated entity reads `sourced`), and it is
fixed on its own merits — never by quarantining it. Quarantine is for failures that are genuinely
not about the change under test; using it on this one would be the "green tests over broken
capability" failure this repo has already paid for.

## Rejected

- **Narrow the gate to a relevance bundle.** The relevance map is a guess, and 12-06 is the recorded
  counter-example.
- **Lower the bar to a pass threshold** (e.g. 45/46). Indistinguishable from "one unknown regression
  is acceptable", and it hides which case.
- **Hand-activate around the gate.** `activateSkillVersion`'s refusal is the system working; Phase
  40 recorded that no override was attempted and none should be.
