---
decision: defer
decidedAt: 2026-08-29
decidedBy: owner (pre-ruled "let the gate decide, fail-closed"; gate run 29-11 Task 3)
matrix:
  - id: standing-approval
    status: missing
    evidenceType: manual
    evidenceRef: .planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md
  - id: material-change-reapproval
    status: missing
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
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
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
  - id: run-identity
    status: missing
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
  - id: overlap
    status: missing
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
  - id: retry
    status: missing
    evidenceType: automated
    evidenceRef: packages/core/src/routineSchedule.test.ts
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

---

## 0. How to read a row, exactly

Every row is `{ id, status, evidenceType, evidenceRef }` and nothing else. The parser
(`packages/backend/scripts/check-routine-gate.mjs`) refuses a fifth key, an unknown id, a
duplicate id, a missing id, an unknown enum member, an empty ref and a `pass` row whose ref does
not resolve to a file in this repository.

| Field | What it means here |
|---|---|
| `status` | Does the evidence that exists today **meet this row's requirement**? `pass` = yes. `fail` = it was tried and the answer was no. `missing` = the required evidence does not exist. |
| `evidenceType` | The class of the **best evidence that exists today**, whatever the status. `automated` = a test or a source fact. `manual` = a written attestation or a recorded design ruling. `live` = something that actually happened in the real world, once, and is cited. |
| `evidenceRef` | A repo-relative path to that evidence. On a `pass` row the parser proves the file exists; a green row citing nothing is treated as a fabricated citation. |

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
| `material-change-reapproval` | missing | automated | `materialChanges()` is implemented and proven over all ten governed fields (`routineSchedule.test.ts`). There is no standing approval for it to invalidate, so the rule is proven but unenforced. |
| `oauth-expiry-reauth` | missing | automated | **Required live.** The code path is real: `gmailAuth.flagExpiringTokens` warns ~24h before the 7-day refresh clock, `gmail.send` routes a missing token to `awaiting_reauth`, and reconnection deliberately does **not** resume held rows. None of that is a trace. No recorded run shows a token actually expiring and a user actually reconnecting. A code path is not a trace. |
| `dst-boundary` | missing | automated | **Required live.** The arithmetic is proven against real tzdata for New York, Berlin and a 30-minute Lord Howe gap, both DST directions (`routineSchedule.test.ts`, 20 tests). **Nothing in this repository has ever executed across a DST boundary**, because nothing in this repository executes on a schedule at all. Simulation is `automated`; it is not `live` and this file will not call it that. |
| `provider-read` | **pass** | **live** | The one green row. `03.2-06` CKPT-01 was human-verified on 2026-07-12: a real mailbox read against a really-connected Google account resolved a correspondent, with zero sends. See §2 for what this row does and does not cover. |
| `missed-run` | missing | automated | `classifyDue()` implements skip-by-default with a grace window and is proven. There is no run to miss. |
| `run-identity` | missing | automated | `occurrenceKey()` is proven, including the case it exists for: both 01:30s of a fall-back night produce the *same* key, so the second is a duplicate claim rather than a second run. The atomic claim mutation that would consume the key does not exist. |
| `overlap` | missing | automated | `classifyOverlap()` is proven for all three live states. There is no run state to observe. |
| `retry` | missing | automated | `classifyRetry()` is proven: bounded retries for `provider_5xx`/`provider_timeout`/`internal` only; `auth`, `validation`, `budget`, `paused` and `provider_refusal` are terminal. No durable run state machine exists to carry an attempt count. |
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

**Conclusion: `@js-temporal/polyfill` is not needed for daily/weekly local-wall-time recurrence.**
If an enable-safe branch later needs month-end clamping, RRULE or sub-minute precision, that is
the moment to reconsider — not before. `packages/core/package.json` names no temporal dependency,
and `routineSchedule.test.ts` asserts that.

**None of this is `live` evidence and this file does not present it as such.** It is `automated`.

---

## 4. The gate, run

Every command below was executed in this worktree on 2026-08-29. `check-routine-gate.mjs` prints
its verdict to stdout; do not read its exit code through a pipe.

| # | Command | Result |
|---|---|---|
| 1 | `node packages/backend/scripts/check-routine-gate.mjs --self-check` | 16/16 cases behaved — the green fixture is eligible, and every single-field corruption of it is not |
| 2 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --matrix` | `OK --matrix (decision: defer)` |
| 3 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --eligibility` | **FAIL, 13 problems** — 11 rows not `pass`, and `oauth-expiry-reauth` + `dst-boundary` carry `automated` where `live` is required |
| 4 | `node packages/backend/scripts/check-routine-gate.mjs <this file> --validate-decision` | `OK --validate-decision (decision: defer)` |
| 5 | `cd packages/core && pnpm vitest run routineSchedule` | 1 file / 20 tests passed |

Row 3 is the reason row 4 says `defer` and not `enable-safe`. Under `--validate-decision`, an
`enable-safe` artifact is put through the *identical* eligibility check, so this file could not
have recorded `enable-safe` today even if someone had typed it.

---

## 5. The two checkpoints, and what was selected

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
   `013-the-render-worker.md`. The next free number is **027**.)
2. **No dependency was installed.** `--validate-decision` also greps the root, core and backend
   manifests for `temporal` and fails if one appears.
3. **No schema and no scheduler module was touched.** This plan's diff is four files plus this
   record.
4. **29-12 and 29-13 must branch on `decision: defer`** and must not build recurrence UI, state
   or arming.

## 7. What would have to change for `enable-safe`

All twelve rows `pass`, every ref resolving, and these three carrying real `live` evidence:

- `oauth-expiry-reauth` — a recorded run in which a real Google token reached expiry, the routine
  moved to `awaiting_reauth`, the user reconnected explicitly, and **no catch-up burst followed**.
- `dst-boundary` — a real schedule that executed across a real spring-forward and a real
  fall-back, with the recorded next absolute times matching §3. A simulation does not count; that
  is what §3 already is.
- `provider-read` — already `pass`. An enable-safe branch should additionally show an
  **unattended** read, because §2 is explicit that the existing trace is an attended one.

Then run `--eligibility` again. If it exits zero, the choice is genuinely open. Until then this
file's answer is `defer`, and the parser is what says so.
