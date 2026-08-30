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

> **Round 3, 2026-08-29.** Three more verifiers read round 2. The verdict survived again and every
> published number reproduced, but three fail-OPEN holes remained and several sentences in this
> file were wrong. Fixed: `--self-check` anywhere in argv discarded the requested mode and exited 0
> without opening the artifact; an unrecognised flag was silently dropped; the duplicate-citation
> rule keyed on the raw string so twelve `#anchor`s on one file read as twelve citations; and
> 29-12's absence proof was defeated three ways at once — a verifier built a complete self-arming
> recurrence subsystem and all eight tests passed. Corrections to this file's own text are in §9.
> **The absence proof has now been run against that subsystem**: it was re-created in this
> worktree, watched to turn the relevant tests red, and deleted (§9).

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
inside this repository**, that it resolves to a **regular, non-empty file**, that it is **not this
artifact itself**, and that **no two `pass` rows resolve to the same FILE**.

That last rule was keyed on the raw `evidenceRef` **string** in round 2, anchor included, so
`package.json#row-1 … package.json#row-12` counted as twelve distinct citations and a fabricated
`enable-safe` exited 0 in all three modes — while the duplicate error message told the author how
to do it ("cite the specific section with a `#anchor`"). It is keyed on the **resolved path** now.
Round 2's summary said the gate made fabrication cost "twelve distinct real citations — a
twelve-line diff a human reads"; that sentence was false when written and is deleted. It is true
now, of twelve distinct **files**.

A determined author can still cite twelve distinct real files that say nothing — no parser can
read a file and judge whether it answers a governance question. That judgement is what §5's human
checkpoint and §7 are for, and `routineDecision.test.ts` carries a test named
`THE DOCUMENTED LIMIT` that asserts this weakness on purpose so nobody re-reads the gate as more
than it is. The self-check's green fixture IS that shape — twelve repo manifests, not one of which
mentions a routine — and it is no longer described anywhere as "genuinely green".

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
| `run-identity` | missing | automated | `occurrenceKey()` is proven, including the case it exists for: both 01:30s of a fall-back night produce the *same* key, so the second is a duplicate claim rather than a second run — and a local date the zone **skipped entirely** produces no key at all. **One input to that key is tenant-mutable:** `templateVersion` is part of it, so a template edited between the two 01:30s yields two keys and two runs. That is deliberate (an edited template is a different run) and asserted as such, but it is the one way the duplicate guarantee can be defeated from the product, and an enable-safe branch owes it a decision. The atomic claim mutation that would consume the key does not exist. |
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

Every command below was executed in this worktree on 2026-08-29, after the round-3 fixes.
`check-routine-gate.mjs` prints its verdict to stdout; do not read its exit code through a pipe.

| # | Command | Result |
|---|---|---|
| 1 | `node packages/backend/scripts/check-routine-gate.mjs --self-check` | exit 0 — **25/25 cases behaved.** Each case is prefixed with the function it drives (`validateMatrix:` / `eligibility:` / `validateDecision:`), because round 1 reported this list as N *eligibility* results when most were *schema* results |
| 2 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --matrix` | exit 0 — `OK --matrix (decision: defer)` |
| 3 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --eligibility` | **exit 1, 13 problems** — 11 rows not `pass`, and `oauth-expiry-reauth` + `dst-boundary` carry `automated` where `live` is required |
| 4 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --validate-decision` | exit 0 — `OK --validate-decision (decision: defer)` |
| 5 | Six **fabricated** `enable-safe` artifacts (anchor-only refs; twelve rows citing one file; **twelve `#anchor`s on one file**; **every row citing the artifact itself**; a directory; a path escaping the repo), each run through all three modes | **exit 1, eighteen for eighteen.** Round 2 published "under round 1 every one of these exited 0 in every mode"; a verifier re-ran round 1 against seven fixtures and that is false for **3 of 12 cells** — `../../../Windows/win.ini` and `../../../etc/hosts` resolve outside the user profile, so round 1's plain `existsSync` already refused them. The containment rule is load-bearing only for a **deeper** escape than either published fixture uses |
| 6 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --eligibility --self-check` (either argv order) | **exit 2.** Round 2 exited **0** here without ever opening the artifact |
| 7 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --matrix --eligibilty` (typo) | **exit 2, naming the flag.** Round 2 exited 0, having silently run `--matrix` alone |
| 8 | `cd packages/core && pnpm vitest run routineSchedule` | 1 file / 19 tests passed |
| 9 | `cd packages/backend && pnpm vitest run routineDecision routines` | 2 files / 89 tests passed (82 + 7) |

Row 3 is the reason row 4 says `defer` and not `enable-safe`. Under `--validate-decision`, an
`enable-safe` artifact is put through the *identical* eligibility check, so this file could not
have recorded `enable-safe` today even if someone had typed it.

Every exit code above is now asserted in `routineDecision.test.ts` by **spawning** the script and
reading `spawnSync().status` — absent file, directory-as-artifact, bad usage, two modes, **an
unrecognised flag**, **`--self-check` beside a mode in either argv order**, malformed YAML,
unknown row, duplicate row, bad enum member, empty ref, bad `decidedBy`, valid defer, fabricated
enable-safe and schema-valid enable-safe. Round 1 asserted none of them: `main()` was never invoked
by a test. 29-12 chains this script with `&&`, so the exit code is the contract.

**One guard is deliberately recorded as UNCOVERED.** `Object.hasOwn(MODES, a)` rather than
`a in MODES` is still the right method, but with flags now required to start with `--`, and no
prototype key doing so, mutating it to `a in MODES` leaves all 82 tests green. Round 2's summary
listed this as covered by the test named "a prototype key is not a mode"; that test passes for a
different reason (`constructor` lands in the file list and dies on the two-files rule). The test is
kept for the observable behaviour, and its comment now says exactly this.

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
   backend, `apps/web` and `pnpm-lock.yaml` — for a **closed, named** set of schedulers and fails if one
   appears: `temporal`, `rrule`, `cron-parser`, `node-cron`, `node-schedule`, `croner`, `bullmq`,
   `js-joda`, `toad-scheduler`. Round 2 matched `/temporal/i` alone under a test heading that said
   "no scheduling DEPENDENCY", so every other name on that list read green. `agenda` is
   deliberately **outside** the set — it is an English word as well as a scheduler, and a rule that
   false-positives on prose is a rule someone deletes.
3. **No schema and no scheduler module was touched.** Round 1's diff was **seven** files: the five
   owned paths plus `docs/playbooks/watch.json` and `docs/playbooks/knowledge-search-routines.md`
   (this record said "four files plus this record", which was wrong). Round 2's own commit
   (`75d3ded`) was **six** files and did **not** contain `packages/backend/convex/routines.test.ts`
   — 29-12 added that one commit later, in `db9185a`; the sentence here and the matching line in
   the playbook both named a file their commit did not carry, and are corrected. Round 3 touches
   no implementation file either: the gate script, the two test files, the spike header, this
   record and the playbook.
4. **29-12 and 29-13 must branch on `decision: defer`** and must not build recurrence UI, state
   or arming.

## 7. What would have to change for `enable-safe`

All twelve rows `pass`, every ref resolving to a distinct real file that is not this artifact,
and these three carrying real `live` evidence:

- `oauth-expiry-reauth` — a recorded run in which a real Google token reached expiry, the routine
  moved to `awaiting_reauth`, the user reconnected explicitly, and **no catch-up burst followed**.
- `dst-boundary` — a real schedule that executed across a real spring-forward and a real
  fall-back, with the recorded next absolute times matching §3. A simulation does not count; that
  is what §3 already is.
- `provider-read` — already `pass`. An enable-safe branch should additionally show an
  **unattended** read, because §2 is explicit that the existing trace is an attended one.

**And a fourth condition, on the CLASS of evidence.** Today's single green row cites
`.planning/phases/03.2-inbox-reading/03.2-06-SUMMARY.md` — an agent-written planning summary
recording a human verification. The underlying event is genuine (§2), but the artifact is a
*narrative about* a run, not a run record. §0 defines `live` as "something that actually happened
in the real world, once, and is cited", and the gate cannot tell a trace from a document: a future
author satisfies `evidenceType: live` by writing another `-SUMMARY.md`, which will resolve, be
distinct and be non-empty. The enable-safe checkpoint must therefore require a **trace** for the
two outstanding rows — a run id, a dated audit or telemetry ref, a spend row — and not a summary.

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
| 6 | The importer scan made recursive over `convex/`, `apps/web/app` and **four** package `src` trees, with a positive control naming `convex/lib/functions.ts` and `convex/render/renderReel.ts` | Round 1 scanned one directory level; `convex/lib/` was invisible. (This row said "every package `src`" when it covered four of nine. Corrected here; the scan itself is fixed in §9 row 4.) |
| 7 | `nextOccurrence` skips a local date the zone deleted; `MAX_LOOKAHEAD_DAYS` pinned; `Occurrence \| null` replaced by a throw | A date-line skip produced a phantom `localDate` and two runs on one local day |
| 8 | `classifyOverlap` / `classifyDue` / `classifyRetry` / `materialChanges` deleted from the spike; four rows moved `automated` → `manual` | Unreachable implementation of the feature that was declined, cited by rows that are red anyway |
| 9 | Two vacuous `--self-check` cases (unknown row id, duplicate row) rewritten to APPEND a row; every case prefixed with the function it drives | Both corruptions also made a required row missing, so the rules under test never ran |
| 10 | `main()` refuses two modes, two files and a prototype key with exit 2; a directory artifact with exit 1 | `--matrix --eligibility` silently ran only the first and printed `OK` |

## 9. What round 3 changed, exactly

Verdict unchanged (`defer`). Matrix count unchanged (1 `pass`, 11 `missing`). No implementation
file was touched. Three verifiers read round 2; two of their findings were fail-open blockers.

| # | Change | Why |
|---|---|---|
| 1 | `--self-check` is **mutually exclusive** with a mode+file, and an **unrecognised flag** is exit 2 by name. Both asserted from a spawned process, in both argv orders | `if (args.includes("--self-check")) return selfCheck();` ran before the arity check, so `--self-check` anywhere in argv discarded the requested mode and exited **0 without opening the artifact**. `--matrix --eligibilty` exited 0 too. A mis-composed verify line silently certifying is the exact failure this gate exists to prevent, and 29-12/29-13 chain it with `&&` |
| 2 | The duplicate-citation rule keys on the **resolved path**, not the raw string; a row may not cite the **artifact under validation**; the green fixture is twelve **distinct real files** | `package.json#row-1 … package.json#row-12` exited 0 in all three modes, and the error message named the bypass. The old fixture was that same shape, so hardening the rule would have turned the suite red — the fixture pinned the hole in place |
| 3 | `routines.test.ts`: the convex module scan reads the **full path**, not the basename | `convex/routines/arm.ts` — a self-arming per-tenant loop in a directory named `routines` — was not "named for routines". The sibling UI scan already used the full path; the two disagreed |
| 4 | `routines.test.ts`: **comment stripping deleted**. The one legitimate occurrence (`schema.ts`'s promise sentence) is exempted by file **and exact line**, and a second test asserts that line still exists. Tokens matched case-insensitively | The stripper deleted the WHOLE LINE for `//`, so every banned identifier was invisible behind a trailing comment (`export const nextRunAt = 1;` red, the same line plus `// comment` green), and an unanchored `/*…*/` strip ate code inside string literals. Both fail-open. A fail-closed exemption list has neither failure mode |
| 5 | `routineDecision.test.ts`: the spike-importer roots are **derived from the filesystem** — every `packages/*/src`, `apps/web`'s top level, `apps/web/scripts` — with controls naming `packages/{revenue,pii,audit}/src` and `apps/web/middleware.ts` | Round 2 hardcoded four of nine package `src` trees; a verifier added the import to `packages/revenue/src/index.ts` and the suite stayed green |
| 6 | **The absence proof was run against the thing it forbids.** The verifier's self-arming subsystem was re-created here (`convex/routines/arm.ts` with a `nextRunAt` type, a cadence constant, `armNextOccurrence`, `occurrenceKey`, a `ctx.scheduler.runAt` self-arm, every identifier behind a trailing `//`, and a `/*` inside a string literal), plus a spike import from `packages/audit/src` and from `apps/web/middleware.ts`, and a `tenantId` in `crons.ts`. Each turned its own test red; all were deleted | An absence test that has never seen the thing it forbids is decoration. This repo shipped one: `workflow-pack-pilot.spec.ts`'s `@dark` block passed with all six packs ACTIVE |
| 7 | The scheduling-dependency rule is a **closed, named set** (§6.2), asserted package by package | The rule was `/temporal/i` under a heading that said "no scheduling DEPENDENCY" |
| 8 | Pinned by new tests: `decidedBy` membership is **equality** (a prefix like `agentic automation` is refused), the containment check needs the **separator** (a sibling directory whose name extends the root is outside it), and the documented ref suffix forms `#anchor` / `:line` / trailing note all resolve | All three mutations SURVIVED round 2's suite while the mutated gate visibly misbehaved |
| 9 | Two tests deleted from `routines.test.ts` — "no table is recurrence-shaped" and "schema.ts still carries the deferral sentence" | `schema.test.ts` owns both, over the same corpus, and this file's header claimed it deliberately did not re-implement them (ponytail rung 2) |
| 10 | Corrected in this record: §0 (the "twelve distinct real citations / twelve-line diff" cost claim), §4 row 1 (23 → 25 cases), §4 row 5 (round 1 refused 3 of those 12 cells, not 0), §4 (the `Object.hasOwn` guard is UNCOVERED, not covered), §6.2, §6.3 (`75d3ded` did not contain `routines.test.ts`), §7 (a fourth, evidence-class condition), §8 row 6 ("every package `src`" was four of nine), and `run-identity` in §1 (`templateVersion` is a tenant-mutable input to the idempotency key) | A claim you cannot prove true is a finding |

**What round 3 did NOT fix.** A `pass` row may still cite twelve distinct real files that say
nothing about routines; that residual is disclosed in §0 and asserted as `THE DOCUMENTED LIMIT`.
`decidedBy: fixture` neither marks an artifact synthetic nor blocks eligibility — the script header
no longer claims it does. And `Object.hasOwn` is documented as an uncovered belt-and-braces guard
rather than dressed up as a tested one.

