---
phase: 21-user-authored-skills-and-routines
plan: 07
status: complete
completed: 2026-08-18
paid_run_executed: true
paid_run_outcome: PASSED
gate_run_id: de976d8e
gate_result: "41/41"
gate_cost: "$0.4947"
cumulative_gate_cost: "$2.5363 across seven attempts"
candidate_activated: false
skill_01_complete: false
affects: ["21-08", "23"]
---

# 21-07 COMPLETE — the frozen candidate carries a passing held-out gate

**`run de976d8e — 41/41 passed (retried: 20-reset-and-honesty, 35-create-document) — $0.3751 exec +
$0.1195 specialist = $0.4947`**, exit 0, against the `$2.00` cap. Evidence recorded on
`offer-architect` v12, row `qx73bwshbfds5nk7hd40vsf5y18cm7z0`, tenant `kn790hj6…`.

**NOTHING WAS ACTIVATED.** The row is still `status: candidate` with `gatePassed: true` and
`evidenceState: passing`. The runner prints this itself: *"NOTHING IS ACTIVE. Evidence is not
activation — the candidate still needs the owner's separate act."* That act is Plan 21-08's.

## The handoff was never touched

`bodyHash aee0008ce849…` is byte-identical to the bytes Plan 21-06 froze, across **seven** gate
attempts. `evidenceTarget` is exactly this row's own `{candidateId, registryTenantId, name,
version}`. `compare-refs` post-gate: **5 comparisons, 0 mismatches** (deployment, baseline,
effective-before, global, foreign). `mismatches: []`, `foreignCollision: null`.

## What it cost, and what it took

| run | result | cost |
|---|---|---|
| `6e021dce` | 0/41 — `runCockpitAgent`'s validator refused `tenantSkillIds` at the door | `$0.0000` |
| `e35a0bb4` | 0/41 — same error, against a `convex dev` watcher that had silently stopped pushing | `$0.0000` |
| run 3 (id unrecorded) | 21/41 — `isPinnedCockpitEvaluation` knew only the global pin scope, so the Gmail rail was withheld | `$0.4157` |
| `d0afcca9` | 39/41 — `08-bounce-then-correct`, `33-research-insufficient-evidence` | `$0.5731` |
| `c9e18e2b` | 40/41 — `28-healthy-no-gaps` | `$0.4637` |
| `a88a4597` | 39/41 — `04-edit-remove-recipient`, `28-healthy-no-gaps` | `$0.5224` |
| **`de976d8e`** | **41/41** | **`$0.4947`** |

**`$2.5363` across seven attempts.** Every attempt, including the two `$0.0000` crashes, is in
`21-EVAL-EVIDENCE.json` — the flake rate is the reason, and a ledger that keeps only the winning run
makes the next person re-derive it the expensive way.

`29-gap-dispatch-offer-architect` is the only fixture that exercises this candidate, and it passed on
every run that reached it — **4 for 4**. No failing evidence was ever recorded against
`offer-architect@12`.

## The re-cut earned itself twice

1. **`compare-refs` went 6/6 on the pre-spend check**, on a snapshot where the plan's OLD verify
   block produces **six spurious failures** — the renamed `deploymentUrlHash`/`deploymentHash` key
   plus all five subtree string compares. Demonstrated against live data, not argued.
2. **The split contained the flake.** Run 6 went 39/41 and cost `$0.5224` and nothing else. Under
   the old single plan it would also have discarded non-owner refusal, activation, runtime
   attribution and rollback — all deterministic, all `$0`.

## A methodology error worth not repeating

`--only 04-edit-remove` **unpinned** failed 3/3 with `recipients: []` and a tool list of
`{proposeCalendarEvent, stageCrmWrite}` — no recipient tool present at all. That is the run-3
Gmail-rail signature: with neither `--skill` nor `--tenant-skill`, `isPinnedCockpitEvaluation` is
false and the disconnected eval tenant loses the email rail. The same probe **with**
`--tenant-skill` passed 3/3. `04` is variance in the `04`/`08` two-turn recipient-edit family, not a
regression. `$0.034` was spent proving nothing before the pin was added.

**A filtered probe of an email fixture must carry a pin, or it measures the harness.**

## Defects found and fixed while getting here

- **`4ef7646`** — the CLAUDE.md §5 guard read markdown backticks in JSDoc as a hardcoded prompt.
  `a745d36` took `cockpitCapabilities.ts` from 1 backtick to 29 by explaining itself, and the scan
  went 0 → 3 offenders, longest a 3292-char "string" spanning 80 lines. Comments are now stripped
  before scanning; both directions mutation-proven.
- **`9326622`** — **the owner's rollback list was empty on a tenant that has a baseline.** Eligibility
  was filtered after `.take(10)` and eleven candidates filled the window. Rollback is UI-only by
  design, so there was no other door: **this would have blocked 21-08 outright.** Found by opening
  `/ops`, not by any test — the sibling assertion proved the read was *bounded*, never that it
  *returned the row*.

## Live browser confirmation

`/ops`, signed in as the owner, after the gate: the v12 card reads **"Evaluation passed — ready for
owner activation"** with **`Run de976d8e · 41/41 cases · $0.49 · openai/gpt-4o-mini`**, and
`Activate v12` is enabled. Every sibling card (v11 down to v2) still reads *"No eval run recorded for
this row yet"* — **the evidence pins the exact row and does not leak to siblings.**

## What 21-08 inherits, and the one ordering rule

A candidate that is `status: candidate`, `evidenceState: passing`, `gatePassed: true`, with a
working rollback select offering `v1 (system)`.

**DO THE NON-OWNER REFUSAL FIRST.** `OWNER_REQUIRED` must be observed against a CANDIDATE row;
once v12 is active that window is gone for good. It was deliberately not exercised here because
this session had only the owner identity — a second, non-owner account is required and no
`convex run` path skips the owner check.

SKILL-01 stays **Pending**. Phase 21 is not closed. `.planning/REQUIREMENTS.md` and
`.planning/ROADMAP.md` were not touched by this plan, by design — evidence is not activation.
