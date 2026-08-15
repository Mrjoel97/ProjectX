---
status: open
trigger: "eval:golden fixtures 27/28/29/30/31 red on the ACTIVE cockpit-agent@24; findingsPresent false, gapCount 0, actOnGap gap_not_found; runs 9aaff3b3, bcaa9c7e, ceb81926; 2026-08-15"
created: 2026-08-15T21:20:00.0000000Z
updated: 2026-08-15T21:20:00.0000000Z
---

## Current Focus

hypothesis: `evaluateBusiness` completes and writes an evaluation row, but persists ZERO grounded
findings, so SC#1's force-clear empties the gap list and every gap-dispatch fixture then has nothing
to tap. ONE defect presenting as FIVE red fixtures.
test: Read `smoke:findingCountForThread` / `smoke:gapCountForThread` for a fixture-27 thread against
`evaluations.ts`'s writer, and establish whether findings are never produced, produced-then-dropped,
or produced-but-written under a different thread than the one the harness reads.
expecting: Unknown — this has NOT been investigated. The eval evidence below establishes only that
the defect exists and is not attributable to any recent skill-body change.
next_action: Investigate `packages/backend/convex/evaluations.ts` (the `business-evaluation.md`
playbook's watched path). Nothing here has been root-caused yet.

## Symptoms

expected: `27-grounded-assessment` returns a grounded evaluation with at least one finding and
exactly one leverage-ranked gap; `28-healthy-no-gaps` returns findings with no gaps;
`29`/`30`/`31` tap that gap and dispatch a specialist.
actual: `findingsPresent: expected true, got false` on 27 and 28. `gapCount: expected 1, got 0`
on 27. `actOnGap: expected "ok", got "gap_not_found"` on 29 and 30 (31 not reached).
errors: no exception, no dead-letter, no refusal string — the turns complete and cost real money
($0.0130-$0.0317 per case). The failure is SILENT absence, which is why no reply assertion and no
smoke test caught it.
reproduction: `node ./scripts/run-eval-golden.mjs --skill cockpit-agent@24 --only 27-grounded --only 28-healthy`
from `packages/backend`. 0/2 passed, $0.0440, both retried once on a fresh thread and failed
identically.
started: Unknown. NOT established by this investigation — see Open Questions.

## Eliminated

- hypothesis: Caused by the item-4 cockpit-agent body change (calendar section + document-section
  merge, candidate v26).
  evidence: Reproduced identically on `cockpit-agent@24`, the row that is `status: "active"` right
  now. Run `bcaa9c7e`, same two assertions, same values, comparable cost. A change cannot cause a
  failure that predates it in the active body.
- hypothesis: Caused by 20-12 / 20.1-02's media+Drive work (candidate v25).
  evidence: Same run `bcaa9c7e` — v24 is BELOW v25, so neither candidate is implicated.
- hypothesis: The vault corpus or `searchVault` is broken, so nothing can be grounded.
  evidence: `25-vault-grounded` PASSED in run `9aaff3b3` on the same seeded corpus in the same
  process, and `39-drive-read` + `35-create-document` passed in run `548a3d86`. Retrieval works.
- hypothesis: An artifact of the OpenAI credit exhaustion that killed run `9aaff3b3` at fixture 30.
  evidence: 27 and 28 failed BEFORE credits ran out (they carry real per-case costs; the credit
  failures all cost $0.0000), and 27/28 reproduced AFTER the account was topped up, in run
  `bcaa9c7e`.
- hypothesis: A transient environment fault (the retry-storm / stale-backend class).
  evidence: The reproducing run ran against a freshly killed-and-restarted `convex dev` with
  `grep -c "Retrying request" == 0`, functions ready, and 32 other fixtures green in the same
  deployment state.

## Open Questions

- **When did this start?** Not established. `agent-runtime.md` records gate `420c852b` as RED at
  35/38 with "BOTH failures were the harness", which does not obviously include 27/28 — but that
  run's per-fixture output was not preserved here, so whether these five were green then is
  UNKNOWN. Do not assume a regression window without checking that run's log.
- **Does it affect production users, or only the eval tenant?** The eval tenant is a throwaway with
  a seeded 5-doc corpus and a seeded Blueprint. A real tenant has a larger corpus. Whether the
  defect is corpus-size-dependent is untested.

## Why this matters beyond the five fixtures

Evidence is recorded ONLY on an all-green UNFILTERED run (`allGreen && pins.length && !filters.length`).
While these five are red, **no `cockpit-agent` candidate can be activated at all** — not v25's
media/Drive work, not v26's calendar/document work — because `activateSkill`'s EVAL_GATE has no
green run to consume. This defect is therefore the blocker for the whole
`20-11 → 20-12 → 20.1-02` skill chain that STATE.md names as the next track, and none of those
plans mention it.
