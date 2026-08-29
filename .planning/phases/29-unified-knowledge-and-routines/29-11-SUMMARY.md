---
phase: 29-unified-knowledge-and-routines
plan: 11
subsystem: knowledge-search-routines
tags: [recurrence, governance, decision-gate, fail-closed, dst, mutation-testing, honesty]

requires:
  - phase: 29-unified-knowledge-and-routines (research)
    provides: "the eleven-gate recurrence table (approval, material change, OAuth, time/DST, missed runs, run identity, overlap, retry, cost, pause/revoke, notifications/audit) this matrix closes over"
  - phase: 03.2-inbox-reading (plan 06)
    provides: "CKPT-01 — the one live provider-read trace in this repository"
provides:
  - "packages/backend/scripts/check-routine-gate.mjs — fail-closed recurrence eligibility and decision validator, three modes"
  - ".planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md — the closed twelve-row matrix and the binding `decision: defer` frontmatter"
  - "packages/core/src/routineSchedule.ts — the DST/identity/overlap/retry/material-change spike, native Intl, zero imports, zero dependencies"
affects: [29-12, 29-13 — both branch on `decision:` and must not build recurrence state]

tech-stack:
  added: []
  patterns:
    - "A gate proven in BOTH directions: every malformation asserted RED, and a synthetic all-green fixture asserted GREEN at the CLI (exit 0) so `defer` is a result, not a hard-coded answer"
    - "`status` (does the evidence meet the requirement) split from `evidenceType` (what class the best available evidence is) — the split is what makes relabelling automated-as-live visible"
    - "A `pass` row's evidenceRef must RESOLVE to a file on disk; a green row citing nothing is treated as a fabricated citation"
    - "Native `Intl.DateTimeFormat(zone).formatToParts()` + ICU round-trip instead of a timezone dependency"

key-files:
  created:
    - packages/core/src/routineSchedule.ts
    - packages/core/src/routineSchedule.test.ts
    - packages/backend/convex/routineDecision.test.ts
    - packages/backend/scripts/check-routine-gate.mjs
    - .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md
  modified:
    - docs/playbooks/watch.json
    - docs/playbooks/knowledge-search-routines.md
  not-created-deliberately:
    - docs/decisions/013-standing-routine-governance.md

key-decisions:
  - "VERDICT: `defer`. It fell out of the parser, not out of an assumption — `--eligibility` was run before the choice and exited 1 with 13 problems, so `enable-safe` was never offerable."
  - "`provider-read` is recorded `pass`/`live`, the ONLY green row. 03.2-06 CKPT-01 was human-verified on 2026-07-12 (real mailbox, really-connected account, zero sends) and the ref resolves. Marking it red so the matrix would read uniformly would have been the same dishonesty pointed the other way."
  - "`@js-temporal/polyfill` was NOT installed. Native Intl covers fixed-offset, both DST directions and a 30-minute gap; on a `defer` outcome the plan forbids the dependency anyway, so an install that could not be committed would have been wasted work."
  - "NO ADR was created. The plan names `docs/decisions/013-standing-routine-governance.md` and **013 is taken** (`013-the-render-worker.md`); the next free number is 027. On `defer` the plan says do not mint one, and `--validate-decision` now ENFORCES that — a `routine|recurrence|schedul` filename in docs/decisions makes the artifact invalid."
  - "The gap resolution is the TRANSITION INSTANT (03:00 local), not Temporal's `compatible` shift-by-the-gap (03:30). The research says 'spring gap uses the next valid instant' and 03:00 is strictly the next instant that exists. Found by a binary search on the ICU offset, which is also what makes the 30-minute Lord Howe gap come out right."
  - "watch.json + the routines playbook WERE edited, outside the plan's files_modified. CLAUDE.md §9 blocks a turn with new code files under packages/ that no playbook covers, and the §9 rule is binding. The edits are additive and 3 lines wide in watch.json."

requirements-completed: [ROUT-02 — as `defer`, with pinned manual rerun remaining the deliverable]

duration: ~105min
---

# Phase 29 Plan 11: The Recurrence Decision Gate — Summary

**Verdict: `defer`, produced by the parser.** Recurrence does not ship. No `routines` table, no cron,
no trigger, no next-run timestamp, no scheduler module, no dependency. `schema.ts:442` still carries
its "deliberately NO `routines` table" sentence verbatim, and there is now a test that fails if it
stops doing so.

---

## 1. What was built

### `packages/backend/scripts/check-routine-gate.mjs` — the deliverable

A fail-closed validator over a closed twelve-row YAML matrix carried in the decision artifact's
frontmatter. Three modes:

| Mode | Contract |
|---|---|
| `--matrix` | Closed schema + enumerations, valid **even when every row is red**. Refuses: a fifth key, an unknown row id, a duplicate row, a missing required row, an unknown enum member, an empty `evidenceRef`, a non-ISO `decidedAt`, a header key outside the closed set, junk inside the frontmatter, and a `pass` row whose `evidenceRef` does not resolve to a file in this repo. |
| `--eligibility` | Exit 0 **only** when all twelve rows are `pass`, every ref is non-empty, and `oauth-expiry-reauth` / `dst-boundary` / `provider-read` each carry `evidenceType: live`. |
| `--validate-decision` | `defer` accepted, plus absence checks (no `routine\|recurrence\|schedul` ADR in `docs/decisions/`, no `temporal` in the root/core/backend manifests). `enable-safe` gets the **identical** eligibility check and is refused with an explicit "rewrite the artifact to `defer`" instruction. |

Absent file → exit 1. Bad usage → exit 2. `--self-check` runs 16 in-memory cases.

The YAML reader is hand-written and hostile rather than a dependency. No YAML parser is installed
here, and more importantly a permissive reader silently accepts a fifth key or a re-ordered row —
a gate that accepts what it did not expect is a gate that can be edited around.

**The row set (closed, exactly these twelve, once each):** `standing-approval`,
`material-change-reapproval`, `oauth-expiry-reauth`, `dst-boundary`, `provider-read`, `missed-run`,
`run-identity`, `overlap`, `retry`, `cost`, `pause-revoke`, `audit-notify`.

### The distinction the artifact turns on

`status` = does the evidence that exists today **meet this row's requirement**.
`evidenceType` = what class the **best available** evidence is.

A row can carry real, good, passing automated evidence and still be `missing`, because the thing it
asks about is not the kind of thing a unit test can answer. That is exactly why `--eligibility`
demands `live` on three named rows rather than merely demanding twelve green ones: twelve green rows
would not catch a simulation relabelled as a trace.

### `packages/core/src/routineSchedule.ts` — the spike, which installed nothing

Zero imports. Native `Intl.DateTimeFormat(zone).formatToParts()` against full ICU tzdata (418 zones
in Node v24.7.0). Every candidate instant is round-tripped back through ICU, which is how the gap
and the ambiguity are *detected* rather than assumed. Exports: `wallPartsAt`, `zoneOffsetMs`,
`resolveLocalInstant`, `nextOccurrence`, `occurrenceKey`, `classifyOverlap`, `classifyDue`,
`classifyRetry`, `materialChanges`.

Nothing imports it. `routineDecision.test.ts` scans every non-test `.ts` in `convex/` and fails if
the string `routineSchedule` appears.

---

## 2. The matrix as recorded: 1 `pass`, 11 `missing`, 0 `fail`

The one green row is **`provider-read`** — `.planning/phases/03.2-inbox-reading/03.2-06-SUMMARY.md`,
CKPT-01, human-verified 2026-07-12: a real mailbox read against a really-connected Google account
that resolved a correspondent with zero sends. The ref resolves; the parser proves it.

I considered marking it `missing` so the matrix would read uniformly red and the `defer` would look
tidier. That would have been the same dishonesty as relabelling, pointed the other way, and it would
have turned the gate into a rubber stamp for a foregone conclusion. §2 of the decision record instead
states plainly what it does **not** prove: the read was **attended** (no read in this product has
ever happened with nobody present), it says nothing about token lifetime, and Microsoft is a
partly-negative fact (ADR-023, the 2026-08-16 Graph probe's `supported: false`).

The two other required-live rows are honestly `missing`:

- **`oauth-expiry-reauth`** — `gmailAuth.ts` really does flag tokens ~24h before the 7-day refresh
  clock, route a missing token to `awaiting_reauth`, and deliberately not resume held rows on
  reconnect. **A code path is not a trace.** No run record shows a token actually expiring and a
  user actually reconnecting. Recorded `missing` / `automated`.
- **`dst-boundary`** — the arithmetic is proven for New York, Berlin and Lord Howe in both
  directions. **Nothing in this repository has ever executed across a DST boundary**, because
  nothing in it executes on a schedule at all. Simulation is `automated`. Recorded `missing`.

The remaining eight are `missing` for the same structural reason: the classifiers are implemented
and proven, but there is no run, no approval object and no state machine for them to govern.
`cost` cites the real, in-production `guardrails.preCall`/`recordSpend` pair — what is absent is
reserving a whole bounded run before the first paid call.

---

## 3. The Temporal spike: native Intl won, and nothing was installed

Ponytail rung 4 before the dependency. `Intl.DateTimeFormat` with `formatToParts` gives real IANA
offsets including transitions, in this runtime, at zero dependency cost. On a `defer` outcome the
plan forbids installing `@js-temporal/polyfill` anyway, so an install that could not be committed
would have been wasted work.

Proven in `routineSchedule.test.ts` with absolute ISO instants (hand-checkable against tzdata, not
re-statements of what the code returned):

| Case | Result |
|---|---|
| Asia/Kolkata (fixed +05:30) | one instant per wall time, `exact` |
| New York spring forward | 02:30 on 2026-03-08 does not exist → `2026-03-08T07:00:00.000Z`, reads back 03:00; one second earlier reads 01:59 |
| Berlin spring forward | `2026-03-29T01:00:00.000Z`, reads back 03:00 |
| **Lord Howe, a 30-minute gap** | `2026-10-03T15:30:00.000Z`; offset steps +10:30 → +11:00 |
| New York fall back | 01:30 twice → `ambiguous_first`, `2026-11-01T05:30:00.000Z` (EDT), never the 06:30Z repeat |
| Berlin fall back | `ambiguous_first`, `2026-10-25T00:30:00.000Z` (CEST) |
| Wall time is preserved, not the interval | 08:30 New York stays 08:30 across the transition; that day is **23 hours** long |
| One occurrence per local date | 01:30 New York → 11-01, 11-02, 11-03; the step from 11-01 to 11-02 is **25 hours** |
| Run identity | both 01:30s of the fall-back night produce the SAME `occurrenceKey` — a duplicate claim, not a second run |

`packages/core/package.json` names no temporal dependency, and the test asserts that.

---

## 4. The two blocking checkpoints — what was presented, what was selected

Neither was skipped. Both are also written into §5 of the decision record.

**Task 2 — `checkpoint:human-verify`, required live evidence.**
*Presented:* the three required rows with their real refs, and the question of whether each resolves
to a live trace. *Resolved:* `provider-read` does (03.2-06 CKPT-01). `oauth-expiry-reauth` does not —
`gmailAuth.ts` is a code path. `dst-boundary` does not — nothing here has ever run on a schedule.
Neither was relabelled; both keep their real `automated` refs and stay `missing`. Owner had
pre-authorised auto-approval for this phase and pre-ruled "let the gate decide, fail-closed".

**Task 3 — `checkpoint:decision`, recurrence outcome.**
*Presented:* `--eligibility` was run immediately before the choice and exited **1 with 13 problems**
(11 rows not `pass`, plus the two `automated`-where-`live`-is-required rows), so per the plan's own
rule `enable-safe` was **not offered**. The only permitted option was `defer`. *Selected:* `defer`.
*Consequence accepted:* no unattended preparation in Phase 29; ROUT-02 completes on the pinned
manual rerun (29-08's `pinnedWorkflows`, plus the existing `savedPrompts` rail).

---

## 5. Mutations observed RED

Every mutation below was applied, the suite run, the result recorded, and the file reverted. The
reverted state was re-run green each time.

### `packages/core/src/routineSchedule.ts` — 12 applied, **12 red** (baseline 20/20 green)

| # | Mutation | Result |
|---|---|---|
| M1 | ambiguous fall-back picks the LAST instant instead of the first | 4 failed |
| M2 | gap resolves by shifting by the gap (Temporal `compatible`) instead of the transition | 4 failed |
| M3 | `nextOccurrence` accepts `>=` so it can return the instant asked about | 5 failed |
| M4 | `occurrenceKey` drops the template version | 2 failed |
| M5 | `classifyDue` treats the grace edge as `missed` | 1 failed |
| M6 | `materialChanges` compares arrays by LENGTH | 1 failed |
| M8 | `assertRule` stops validating the hour | 1 failed |
| M9 | weekly cadence ignored, every day allowed | 1 failed |
| M10 | the walk starts from the UTC calendar date, not the zone's | 1 failed |
| M11 | the ICU round-trip check is removed (candidates accepted unverified) | 7 failed |
| M12 | `classifyOverlap` always starts | 1 failed |
| M13 | retry ignores the attempt cap | 1 failed |

**Two mutations SURVIVED the first pass and are worth recording:**

- **M10 was a real coverage hole.** Starting the walk from the UTC calendar date rather than the
  rule's zone survived the whole original suite. It is a genuine defect for any zone behind UTC:
  at `2026-03-07T01:00Z` (still 2026-03-06 20:00 in New York) a UTC-date walk skips that evening's
  23:00 occurrence and answers a day late. A test was added (`the walk starts from the caller's
  LOCAL date, not the UTC date`) and M10 then went RED. Found by mutation, not by review.
- **M7 (`cursor += DAY_MS + 1`) survived and is a proved no-op.** The cursor is only used to extract
  a UTC calendar date, and 400 iterations of 1ms drift cannot move a date. Recorded as equivalent,
  not as a gap.

### `packages/backend/scripts/check-routine-gate.mjs` — 10 applied, **10 red** (baseline 40/40 green)

| # | Mutation | Result |
|---|---|---|
| P1 | `--eligibility` drops the LIVE requirement | 7 failed |
| P2 | `--eligibility` stops requiring `status: pass` | 3 failed |
| P3 | unknown row ids allowed | 1 failed |
| P4 | `pass` rows no longer have to resolve on disk | 1 failed |
| P5 | missing required rows tolerated | 1 failed |
| P6 | unknown row keys accepted (the closed schema opens) | 1 failed |
| P7 | `--validate-decision` rubber-stamps `enable-safe` | 2 failed |
| P8 | duplicate rows tolerated | 1 failed |
| P9 | empty `evidenceRef` tolerated | 1 failed |
| P10 | `eligibility()` always returns ok | 12 failed |

**P3 and P8 survived the first pass, and the reason matters.** Their fixtures *replaced* a row's id
(`overlap` → `overlapping`), which ALSO made a required row missing — so the "required row missing"
rule caught them and the unknown-id / duplicate-id rules never ran. The tests were rewritten to
**append** an extra row instead, keeping all twelve required rows present, and to assert the specific
error string. Both then went RED. This is the same class of finding as M10: a test that fails for the
wrong reason reads identical to a test that works.

### The gate proven GREEN, at the CLI, exit code read directly (never through a pipe)

Mandated evidence that `defer` is a result and not a hard-coded answer:

```
node packages/backend/scripts/check-routine-gate.mjs <all-green fixture> --eligibility
OK --eligibility (decision: enable-safe)          exit=0
```

Flip one required row from `live` to `manual` in that same fixture:

```
FAIL --eligibility — 1 problem(s):
  - row `dst-boundary` requires LIVE evidence and carries `manual` — a code path, a unit test
    or a manual attestation is not a live trace                                  exit=1
```

Enum garbage → `--matrix` fails with 9 named problems, exit=1. `--validate-decision` on the green
fixture (which records `enable-safe`) → exit=0. **The fixtures live in the scratchpad; the real
artifact was never edited to manufacture a verdict.**

---

## 6. Every gate run, with real numbers

The plan's two verify commands are no-ops as written and were NOT run that way (`pnpm --filter … test -- <filter>`
swallows the `--`; `check-playbooks.mjs` run bare hangs on stdin and signals by printing).

| # | Command | Result |
|---|---|---|
| 1 | `cd packages/core && pnpm vitest run routineSchedule` | **1 file / 20 tests passed** |
| 2 | `cd packages/backend && pnpm vitest run routineDecision` | **1 file / 40 tests passed** |
| 3 | `node packages/backend/scripts/check-routine-gate.mjs --self-check` | **16/16 cases behaved** |
| 4 | `node … check-routine-gate.mjs <artifact> --matrix` | `OK --matrix (decision: defer)`, exit 0 |
| 5 | `node … check-routine-gate.mjs <artifact> --eligibility` | **FAIL, 13 problems**, exit 1 — this is the Task 3 gate |
| 6 | `node … check-routine-gate.mjs <artifact> --validate-decision` | `OK --validate-decision (decision: defer)`, exit 0 |
| 7 | `node … check-routine-gate.mjs nope.md --matrix` | FAIL "the decision artifact does not exist", exit 1 |
| 8 | `node … check-routine-gate.mjs` (no args) | usage, exit 2 |
| 9 | `cd packages/core && pnpm typecheck` | clean |
| 10 | `cd packages/backend && pnpm typecheck` | clean |
| 11 | `cd packages/core && pnpm vitest run` | **46 files / 1477 tests passed** (29-09 recorded 45/1457; this plan adds exactly 1 file / 20 tests) |
| 12 | `cd packages/contracts && pnpm vitest run` | **6 files / 99 tests passed** |
| 13 | `cd packages/backend && pnpm vitest run` | **115 files / 3227 tests: 3225 passed, 2 failed** — both pre-existing, see below |
| 14 | `cd packages/backend && pnpm vitest run media.test` | **1 file / 255 tests passed** (the documented load flake, green alone) |
| 15 | `cd packages/backend && pnpm vitest run env.test` | **1 file / 21 tests: 1 failed** — the STANDING red |
| 16 | `npx biome check <my 5 files>` | **0 errors, 0 warnings** |
| 17 | `echo '{}' \| node scripts/check-playbooks.mjs check` | my paths CLEARED (see §7) |

**The two backend failures are not mine.** `convex/media.test.ts` is the documented load flake and
passes 255/255 alone (row 14). `convex/env.test.ts` (`every consumed name is classified`) is the
known standing `ENV_MANIFEST` red already recorded in `29-SEARCH-GATE.md` row 5;
`git log -2 -- convex/lib/env.ts` names `29-FIN-W2` and `29-W2-CLEANUP`, and this plan's diff touches
no env, manifest or schema file. It was red before this plan and is red after it.

`git diff --stat HEAD -- "*.ts" "*.mjs"` after committing: **empty**. The commit is complete; HEAD
compiles.

---

## 7. CLAUDE.md §9 — two files edited outside the plan's `files_modified`

`docs/playbooks/watch.json` (3 lines, additive) and `docs/playbooks/knowledge-search-routines.md`
(a new dated section with its own `Last verified` line, plus the deferred-recurrence gap row closed
as a decision). The Stop hook blocks a turn with new code files under `packages/` that no playbook
covers, and §9 is binding, so `routineSchedule`, `routineDecision` and `check-routine-gate.mjs` were
registered under the routines playbook. Stated explicitly because the brief said to touch nothing
else.

After that edit the hook no longer names any of my files. It still blocks — on
`docs/playbooks/workflow-packs.md` and three `apps/web/.../workflows/` files, which are the
concurrent **29-08** lane's, not mine.

---

## 8. What I could NOT complete, plainly

- **No live evidence was produced, and none could be.** Producing a real OAuth expiry+reauth trace
  needs a live deployment, a real Google consent and a seven-day wait; producing a real DST-boundary
  execution needs a scheduler that does not exist and a real transition to cross. Both are outside
  what this agent can do at $0 with no deployment, and both were correctly recorded as `missing`
  rather than manufactured. **This is the intended outcome of the gate, not a shortfall in it.**
- **`docs/decisions/013-standing-routine-governance.md` was not created.** Named in the plan's
  `files_modified`, and correctly absent: `defer` forbids the ADR, and 013 is taken by
  `013-the-render-worker.md` regardless. The next free number is **027**. `--validate-decision` now
  enforces the absence, so this is a checked fact and not a promise.
- **`gmailAuth` / `cockpit` tests were not run as a targeted trio.** The plan's Task 1 verify names
  `routineDecision gmailAuth cockpit`; the full backend suite (row 13) ran all three files and every
  `gmailAuth`/`cockpit` test passed, so the coverage is there — but the plan's literal filter form
  was not used because it is one of the two no-op commands.
- **The `--eligibility` refusal is only as good as the honesty of whoever fills the rows.** The
  parser can prove a `pass` row's ref resolves; it cannot prove the cited file describes a live run.
  §7 of the decision record names exactly which three traces a future `enable-safe` needs, so the
  next agent does not have to re-derive them.

## 9. For 29-12 and 29-13

Read `decision:` from the frontmatter of
`.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md`. It says `defer`.
Do not build recurrence UI, state or arming. If a later plan flips it, the ADR number is **027**,
never 013, and `--validate-decision` will refuse the flip until `--eligibility` exits 0.
