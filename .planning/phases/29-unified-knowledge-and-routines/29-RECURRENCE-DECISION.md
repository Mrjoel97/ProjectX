---
decision: defer
decidedAt: 2026-08-29
decidedBy: agent (29-11 executor), under owner pre-ruling "let the gate decide, fail-closed"
matrix:
  - id: standing-approval
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: material-change-reapproval
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: oauth-expiry-reauth
    status: missing
    evidenceType: automated
    evidenceRef: packages/backend/convex/gmailAuth.ts
  - id: dst-boundary
    status: missing
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
  - id: provider-read
    status: pass
    evidenceType: live
    evidenceRef: .planning/phases/03.2-inbox-reading/03.2-06-SUMMARY.md
  - id: missed-run
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: run-identity
    status: missing
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
  - id: overlap
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: retry
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: cost
    status: missing
    evidenceType: automated
    evidenceRef: packages/backend/convex/guardrails.ts
  - id: pause-revoke
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: audit-notify
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
---

# 29-RECURRENCE-DECISION — ROUT-02

**Verdict: `defer`.** Recurrence does not ship in Phase 29. The completed ROUT-02 deliverable is
the **pinned manual rerun** (`savedPrompts` / pinned workflows), not a scheduler. No `routines`
table, no cron, no trigger, no next-run timestamp, no execution-history table and no scheduling
dependency were added, and `packages/backend/convex/schema.ts:442` still carries its original
sentence verbatim.

**Owner of this file:** plan 29-11. **Consumed by:** 29-12 and 29-13, which branch on the
`decision:` key in the frontmatter above and must not guess.

> **Round 2, 2026-08-29.** Three independent verifiers read this artifact and its gate. The
> verdict survived — it is genuinely parser-derived and every number in §4 reproduced — but the
> gate that produced it was fail-open, and this record overclaimed what the gate proves. Both are
> corrected below and §8 lists exactly what changed. Nothing in the matrix moved from red to
> green; four rows moved from `automated` to `manual` because the code they cited was deleted.

---

## 0. How to read a row, exactly

Every row is `{ id, status, evidenceType, evidenceRef }` and nothing else. The parser
(`packages/backend/scripts/check-routine-gate.mjs`) refuses a fifth key, an unknown id, a
duplicate id, a missing id, an unknown enum member, an empty ref, a `decidedBy` outside the closed
actor set, and a `pass` row whose citation does not hold up.

| Field | What it means here |
|---|---|
| `status` | Does the evidence that exists today **meet this row's requirement**? `pass` = yes. `fail` = it was tried and the answer was no. `missing` = the required evidence does not exist. |
| `evidenceType` | The class of the **best evidence that exists today**, whatever the status. `automated` = a test or a source fact. `manual` = a written attestation or a recorded design ruling. `live` = something that actually happened in the real world, once, and is cited. |
| `evidenceRef` | A repo-relative path to that evidence. |

**What a `pass` row's citation check does and does not prove.** Round 1 of this file said "the
parser proves the file exists; a green row citing nothing is treated as a fabricated citation."
That was false, and three verifiers demonstrated it: an `evidenceRef` of `#` stripped to the empty
string, resolved to the repository root, and passed — so twelve fabricated `pass`/`live` rows
cleared `--matrix`, `--eligibility` **and** `--validate-decision`. Directories, `.`, and paths
escaping the repo passed too.

The claim is now deleted rather than narrowed. What the parser actually checks on a `pass` row,
and all it checks, is that the ref **names a path** (not just an `#anchor`), that the path **stays
inside this repository**, that it resolves to a **regular, non-empty file**, and that **no two
`pass` rows cite the same ref**. Every fabrication shape the verifiers demonstrated is now
refused. A determined author can still write twelve distinct real citations that say nothing — no
parser can read a file and judge whether it answers a governance question. That judgement is what
§5's human checkpoint and §7 are for, and `routineDecision.test.ts` carries a test named
`THE DOCUMENTED LIMIT` that asserts this weakness on purpose so nobody re-reads the gate as more
than it is.

The split between `status` and `evidenceType` is the point of the whole artifact. A row can carry
real, good, passing automated evidence and still be `missing`, because the thing the row asks
about is not the kind of thing a unit test can answer. `oauth-expiry-reauth` and `dst-boundary`
are exactly that shape today.

**This gate exists to stop one specific move: relabelling `automated` or `manual` evidence as
`live`.** That is why `--eligibility` demands `live` on three named rows rather than merely
demanding twelve green rows.

---

## 1. The matrix, in words

| Row | Status | Evidence | Why it is not green |
|---|---|---|---|
| `standing-approval` | missing | manual | A *recommendation* exists (standing approval covers read-only retrieval and in-app preparation; every external write still materialises a per-run plan). Nothing binding records it, and there is no approval object in the product for a routine to hold. |
| `material-change-reapproval` | missing | manual | Recommendation only. Round 1 cited a `materialChanges()` helper in the spike; it was deleted in round 2 (§3) because it was the deferred feature's implementation, not evidence about it — and it carried a defect nothing could observe: it normalised `["a b"]` and `["a","b"]` to the same string, so a change to a recipient **list** could report as immaterial. The field list that voids an approval is a design ruling, not code. |
| `oauth-expiry-reauth` | missing | automated | **Required live.** The code path is real: `gmailAuth.flagExpiringTokens` warns ~24h before the 7-day refresh clock, `gmail.send` routes a missing token to `awaiting_reauth`, and reconnection deliberately does **not** resume held rows. None of that is a trace. No recorded run shows a token actually expiring and a user actually reconnecting. A code path is not a trace. |
| `dst-boundary` | missing | automated | **Required live.** The arithmetic is proven against real tzdata for New York, Berlin, a 30-minute Lord Howe gap and a Pacific/Apia date-line skip, both DST directions (`routineSchedule.test.ts`). **Nothing in this repository has ever executed across a DST boundary**, because nothing in this repository executes on a schedule at all. Simulation is `automated`; it is not `live` and this file will not call it that. |
| `provider-read` | **pass** | **live** | The one green row. `03.2-06` CKPT-01 was human-verified on 2026-07-12: a real mailbox read against a really-connected Google account resolved a correspondent, with zero sends. See §2 for what this row does and does not cover. |
| `missed-run` | missing | manual | Recommendation only: a missed occurrence is skipped, never burst-executed, with a grace window in which a late tick still counts as the run it was armed for. Round 1 cited a `classifyDue()` helper; deleted in round 2 (§3). There is no run to miss. |
| `run-identity` | missing | automated | `occurrenceKey()` is proven, including the case it exists for: both 01:30s of a fall-back night produce the *same* key, so the second is a duplicate claim rather than a second run — and a local date the zone **skipped entirely** produces no key at all. The atomic claim mutation that would consume the key does not exist. |
| `overlap` | missing | manual | Recommendation only: one active run per routine; a due tick that meets a live run skips and records the overlap. Round 1 cited a `classifyOverlap()` helper that was literally `active === null ? "start" : "skip_overlap"` — the requirement retyped. Deleted in round 2. There is no run state to observe. |
| `retry` | missing | manual | Recommendation only: bounded retries for `provider_5xx` / `provider_timeout` / `internal`; `auth`, `validation`, `budget`, `paused` and `provider_refusal` terminal. Round 1 cited a `classifyRetry()` helper; deleted in round 2. No durable run state machine exists to carry an attempt count. |
| `cost` | missing | automated | The budget primitive is real and in production: `internal.guardrails.preCall` → `recordSpend` gates four toolless callers today. What does not exist is reserving a **whole bounded run** before the first paid call and settling once — the reservation shape a routine needs. |
| `pause-revoke` | missing | manual | Recommendation only. Pause must be immediate state plus cancellation of the pending scheduled function, with the callback re-reading status/version after claiming. None of that exists, and there is nothing to cancel. |
| `audit-notify` | missing | manual | Recommendation only. `audit` is insert-only and refs-only today (CLAUDE.md §3/§4), which is the right substrate — but there are no routine/run refs or closed reason codes to write. |

**Count: 1 `pass`, 11 `missing`, 0 `fail`.** Two of the three required-live rows are `missing`.

---

## 2. What the one green row does and does not prove

`provider-read` is `pass`/`live` because the row asks a specific question — *has a real read from
a really-connected provider been observed?* — and the answer is genuinely yes, with a citation
that resolves. It was tempting to mark it `missing` so the matrix would read uniformly red. That
would have been the same dishonesty as relabelling, pointed the other way, and the gate would
then be a rubber stamp for a foregone conclusion instead of a test.

What it does **not** prove, stated so nobody later reads more into it:

- The read was **attended**. A human was signed in, in the browser, driving the cockpit. No read
  in this product has ever happened with nobody present.
- It says nothing about token lifetime. That is `oauth-expiry-reauth`, and that row is `missing`.
- Microsoft is a separate and partly-negative fact: registered and connected, but the 2026-08-16
  Graph concurrency probe returned `supported: false` (`If-Match` enforced on event PATCH,
  **ignored** on DELETE), which is why ADR-023 makes Microsoft calendar management update-only.
  Microsoft *reads* work; Microsoft conditional *deletes* have no seatbelt. Recurrence over a
  Microsoft write path would inherit that, unreviewed.

---

## 3. The Temporal spike — run, and it installed nothing

Plan 29-11 said to spike `@js-temporal/polyfill`. It was not installed, and on a `defer` outcome
the plan forbids installing it anyway. The spike was done by reasoning and tests against the
**native platform first** (ponytail rung 4), and native covers what the matrix needs:

`Intl.DateTimeFormat(zone).formatToParts()` resolves real IANA wall time against full ICU tzdata
(418 zones in this Node v24.7.0), including both transition directions. `packages/core/src/routineSchedule.ts`
is built on that one primitive and nothing else — it has **zero imports**. Every candidate instant
is round-tripped back through ICU, which is how the gap and the ambiguity are *detected* rather
than assumed:

| Case | Result, proven in `routineSchedule.test.ts` |
|---|---|
| Fixed offset (Asia/Kolkata) | one instant per wall time, `exact` |
| New York spring forward | local 02:30 on 2026-03-08 does not exist → `gap_shifted` to `2026-03-08T07:00:00Z`, which reads back as 03:00 local; one second earlier still reads 01:59 |
| Berlin spring forward | `gap_shifted` to `2026-03-29T01:00:00Z` |
| Lord Howe (**30-minute** gap) | `gap_shifted` to `2026-10-03T15:30:00Z`; offset steps +10:30 → +11:00 — an implementation that assumed "DST means one hour" fails here |
| New York fall back | local 01:30 happens twice → `ambiguous_first`, `2026-11-01T05:30:00Z` (EDT), never the 06:30Z repeat |
| Berlin fall back | `ambiguous_first`, `2026-10-25T00:30:00Z` (CEST) |
| Wall time is what is preserved | 08:30 New York stays 08:30 across the spring transition; that calendar day is **23 hours** long |
| One occurrence per local date | 01:30 New York across fall back yields 11-01, 11-02, 11-03 — and 11-02 is **25 hours** after 11-01, not 24 |
| A local date that never existed (**Pacific/Apia 2011-12-30**, date-line skip) | **no occurrence at all**: the walk yields 12-28, 12-29, 12-31, 01-01 |

That last row is a **round-2 correction, not a round-1 result.** Round 1 answered the skipped day
by gap-shifting the entire missing date onto the transition, which returned an occurrence whose
`localDate` was `2011-12-30` — a date that never existed — reading back as 00:00 on 12-31, and
then fired *again* at 08:30 on 12-31 under a **different** `occurrenceKey`. Two runs on one local
day, produced by the module whose job is to prove that cannot happen. The `gap_shifted` branch was
written for a 30-minute-to-2-hour transition and does not generalise to a 24-hour one. A verifier
found it; it is fixed and tested with an ordinary-gap control beside it (New York 02:30 → 03:00
on the same local date still resolves, because that shift stays on its own date).

**What round 2 deleted from the spike.** `classifyOverlap`, `classifyDue`, `classifyRetry` and
`materialChanges`/`MATERIAL_FIELDS` are gone. They were not a spike — they were the implementation
of the feature this gate then declined to build, written so four matrix rows would have something
to cite, and those rows are red either way. They were unreachable (nothing imported them) and one
of them was quietly wrong (see `material-change-reapproval` in §1). CLAUDE.md §8: later can
scaffold for itself. Those four rows now carry `manual` evidence pointing at the research note,
which is what they always actually had.

**Conclusion: `@js-temporal/polyfill` is not needed for daily/weekly local-wall-time recurrence.**
If an enable-safe branch later needs month-end clamping, RRULE or sub-minute precision, that is
the moment to reconsider — not before. No manifest in this repo names a temporal dependency, and
`--validate-decision` now checks all five of them, including `apps/web/package.json` and
`pnpm-lock.yaml` (round 1 checked three and missed the lockfile the 29-12 plan explicitly names).

**None of this is `live` evidence and this file does not present it as such.** It is `automated`.

---

## 4. The gate, run

Every command below was executed in this worktree on 2026-08-29, after the round-2 fixes.
`check-routine-gate.mjs` prints its verdict to stdout; do not read its exit code through a pipe.

| # | Command | Result |
|---|---|---|
| 1 | `node packages/backend/scripts/check-routine-gate.mjs --self-check` | exit 0 — **23/23 cases behaved.** Each case is prefixed with the function it drives (`validateMatrix:` / `eligibility:` / `validateDecision:`), because round 1 reported this list as N *eligibility* results when most were *schema* results |
| 2 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --matrix` | exit 0 — `OK --matrix (decision: defer)` |
| 3 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --eligibility` | **exit 1, 13 problems** — 11 rows not `pass`, and `oauth-expiry-reauth` + `dst-boundary` carry `automated` where `live` is required |
| 4 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --validate-decision` | exit 0 — `OK --validate-decision (decision: defer)` |
| 5 | Four **fabricated** `enable-safe` artifacts (anchor-only refs; twelve rows citing one file; a directory; a path escaping the repo), each run through all three modes | **exit 1, twelve for twelve.** Under round 1 every one of these exited 0 in every mode |
| 6 | `cd packages/core && pnpm vitest run routineSchedule` | 1 file / 19 tests passed |
| 7 | `cd packages/backend && pnpm vitest run routineDecision` | 1 file / 74 tests passed |

Row 3 is the reason row 4 says `defer` and not `enable-safe`. Under `--validate-decision`, an
`enable-safe` artifact is put through the *identical* eligibility check, so this file could not
have recorded `enable-safe` today even if someone had typed it.

Every exit code above is now asserted in `routineDecision.test.ts` by **spawning** the script and
reading `spawnSync().status` — absent file, directory-as-artifact, bad usage, two modes, a
prototype key as a mode, malformed YAML, unknown row, duplicate row, bad enum member, empty ref,
bad `decidedBy`, valid defer, fabricated enable-safe and genuinely-green enable-safe. Round 1
asserted none of them: `main()` was never invoked by a test, and `return 1` → `return 0` on the
absent-file path was a green mutation. 29-12 chains this script with `&&`, so the exit code is the
contract.

---

## 5. The two checkpoints, and what was selected

**Both checkpoints below were auto-approved under a standing owner authorisation** — the owner's
pre-ruling was "let the gate decide, fail-closed" — **with the agent executing plan 29-11 both
presenting the checkpoint and selecting its outcome. No human attended either one.** That is why
the frontmatter reads `decidedBy: agent (29-11 executor), under owner pre-ruling ...` and not
`decidedBy: owner`: the pre-ruling is real and is disclosed, but it authorised a procedure, it did
not attend a decision. Round 1 recorded `owner` here, which is the fourth instance in this phase
of an agent's own output being stored as the owner's word.

**Task 2 — `checkpoint:human-verify`, required live evidence.** Presented: the three required
rows with their real refs, and the question of whether any of them resolves to a live trace.
Resolved as: `provider-read` does (`03.2-06` CKPT-01, human-verified 2026-07-12, real mailbox,
zero sends). `oauth-expiry-reauth` does not — `gmailAuth.ts` is a code path, and no run record
shows an expiry followed by a reconnect. `dst-boundary` does not — nothing in this product has
ever executed on a schedule, so nothing has ever crossed a transition. Neither was relabelled;
both stay `missing` with their real `automated` refs.

**Task 3 — `checkpoint:decision`, recurrence outcome.** `--eligibility` was run immediately
before the choice and exited non-zero (§4 row 3), so **`enable-safe` was not offered**. The only
permitted option was `defer`, and `defer` was selected. Consequence accepted: no unattended
preparation in Phase 29; ROUT-02 completes on the pinned manual rerun.

---

## 6. Consequences, and what `defer` forbids

1. **No ADR was created.** The plan says not to mint one on `defer`, and `--validate-decision`
   enforces it: a `docs/decisions/` filename matching `routine|recurrence|schedul` makes this
   artifact invalid. (Note for whoever gets there: the plan text names
   `docs/decisions/013-standing-routine-governance.md`, and **013 is taken** by
   `013-the-render-worker.md`. The next free number is **027**.) That rule is deliberately
   filename-shaped and will also trip on an unrelated future ADR whose name contains
   `schedul` — fail-closed in a governance gate is the correct direction; rename it or lift the
   defer.
2. **No dependency was installed.** `--validate-decision` greps all five manifests — root, core,
   backend, `apps/web` and `pnpm-lock.yaml` — for `temporal` and fails if one appears.
3. **No schema and no scheduler module was touched.** Round 1's diff was **seven** files: the five
   owned paths plus `docs/playbooks/watch.json` and `docs/playbooks/knowledge-search-routines.md`
   (this record said "four files plus this record", which was wrong). Round 2 adds
   `packages/backend/convex/routines.test.ts` and touches no implementation file.
4. **29-12 and 29-13 must branch on `decision: defer`** and must not build recurrence UI, state
   or arming.

## 7. What would have to change for `enable-safe`

All twelve rows `pass`, every ref resolving and distinct, and these three carrying real `live`
evidence:

- `oauth-expiry-reauth` — a recorded run in which a real Google token reached expiry, the routine
  moved to `awaiting_reauth`, the user reconnected explicitly, and **no catch-up burst followed**.
- `dst-boundary` — a real schedule that executed across a real spring-forward and a real
  fall-back, with the recorded next absolute times matching §3. A simulation does not count; that
  is what §3 already is.
- `provider-read` — already `pass`. An enable-safe branch should additionally show an
  **unattended** read, because §2 is explicit that the existing trace is an attended one.

**Two of those three requirements are NOT machine-enforced, and this file will not pretend
otherwise.** `--eligibility` can see that a row says `evidenceType: live` and that its citation is
a real distinct file. It cannot see whether the cited run was unattended, whether a token really
expired, or whether a schedule really crossed a transition. `provider-read` is already `pass`/
`live`, so the "additionally unattended" requirement above is a **human** condition on the
enable-safe checkpoint, not something the parser will ever refuse. Whoever runs that checkpoint
must read the cited traces, not just the exit code.

Then run `--eligibility` again. If it exits zero, the choice is genuinely open. Until then this
file's answer is `defer`, and the parser is what says so.

## 8. What round 2 changed, exactly

Verdict unchanged (`defer`). Matrix count unchanged (1 `pass`, 11 `missing`). What changed:

| # | Change | Why |
|---|---|---|
| 1 | `checkEvidenceRef`: a `pass` ref must name a path, stay inside the repo, resolve to a **regular non-empty file**, and be **distinct** from every other `pass` ref | A fully fabricated `enable-safe` passed all three modes. `#` alone defeated the check |
| 2 | The "the parser proves the evidence" claim **deleted** from the script header, §0 and the playbook; the residual weakness asserted as a named test | Prefer deleting a claim to narrowing one |
| 3 | Every advertised exit code asserted by **spawning** the script | `main()` was never invoked by a test; four exit-path mutations were green |
| 4 | `decidedBy` constrained to the closed set `owner` / `agent` / `fixture`, and this file's value corrected to `agent (…)`; §5 states the auto-approval in prose | The agent presented and selected two checkpoints recorded as the owner's |
| 5 | `deferAbsenceChecks` driven against fixture roots that really contain a minted ADR and a temporal manifest, one per manifest, plus `apps/web/package.json` and `pnpm-lock.yaml` added to the scan | The whole function could be replaced with `return { ok: true }` and the suite stayed green |
| 6 | The importer scan made recursive over `convex/`, `apps/web` and every package `src`, with a positive control naming `convex/lib/functions.ts` and `convex/render/renderReel.ts` | Round 1 scanned one directory level; `convex/lib/` was invisible |
| 7 | `nextOccurrence` skips a local date the zone deleted; `MAX_LOOKAHEAD_DAYS` pinned; `Occurrence \| null` replaced by a throw | A date-line skip produced a phantom `localDate` and two runs on one local day |
| 8 | `classifyOverlap` / `classifyDue` / `classifyRetry` / `materialChanges` deleted from the spike; four rows moved `automated` → `manual` | Unreachable implementation of the feature that was declined, cited by rows that are red anyway |
| 9 | Two vacuous `--self-check` cases (unknown row id, duplicate row) rewritten to APPEND a row; every case prefixed with the function it drives | Both corruptions also made a required row missing, so the rules under test never ran |
| 10 | `main()` refuses two modes, two files and a prototype key with exit 2; a directory artifact with exit 1 | `--matrix --eligibility` silently ran only the first and printed `OK` |
