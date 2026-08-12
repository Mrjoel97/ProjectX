---
phase: 19-contacts-crm-follow-ups
plan: 10
subsystem: phase-closeout
tags: [validation, roadmap, playbook, eval-golden, e2e, honesty-pass, actn-05, pipe-01]

# Dependency graph
requires:
  - phase: 19-contacts-crm-follow-ups (19-05)
    provides: "the send-path trust boundary whose refusal copy the UAT judges"
  - phase: 19-contacts-crm-follow-ups (19-07)
    provides: "the Pipeline route and the AUTHORED e2e spec this plan finally ran"
  - phase: 19-contacts-crm-follow-ups (19-09)
    provides: "cockpit-agent@18, gate 086f8267, and the fixture-36 op-type gap this plan closes"
provides:
  - "19-VALIDATION.md: all 22 rows filled from re-measured commands, plus the finding the 22 rows structurally cannot see"
  - "ROADMAP.md: the three stale Phase-19 status locations corrected in place"
  - "run-eval-golden.mjs: datedFollowUpCount in the closed EXPECT_KEYS vocabulary, mutation-proven"
  - "run-eval-golden.mjs: --self-check GREEN for the first time since Phase 20"
  - "e2e/pipeline.spec.ts: EXECUTED, 2/2 passing, plus the opener-race fix that first run found"
  - "the measured ACTN-05 defect: the live body stages addContact, not a dated follow-up"
affects: [19-VALIDATION, ROADMAP, contacts-crm, agent-runtime, cockpit, dashboard-pages, eval-golden]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "derive a policy exemption from the file that already documents it, so the exemption can only register by writing its justification"
    - "a SUBSET expect key must require its total, or it can be satisfied alongside unrequested extras"
    - "mutation-prove a new assertion offline BEFORE spending a cent proving it live"
    - "a fresh /signup is a reset seam you do not have to build: a new tenant is an empty tenant"

key-files:
  created:
    - .planning/phases/19-contacts-crm-follow-ups/19-10-SUMMARY.md
  modified:
    - packages/backend/scripts/run-eval-golden.mjs
    - packages/backend/scripts/eval-cases/36-crm-follow-up.json
    - apps/web/e2e/pipeline.spec.ts
    - .planning/ROADMAP.md
    - .planning/phases/19-contacts-crm-follow-ups/19-VALIDATION.md
    - .planning/phases/19-contacts-crm-follow-ups/deferred-items.md
    - docs/playbooks/contacts-crm.md
    - docs/playbooks/agent-runtime.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/dashboard-pages.md

key-decisions:
  - "Did NOT weaken datedFollowUpCount to make fixture 36 green. The live body genuinely does not create the follow-up; trimming the measurement to fit the model is the third time this phase that temptation appeared"
  - "Did NOT run a full gate. --only 36 answered the question for $0.0142; a gate is ~$0.35 and would only have re-measured the same red"
  - "Did NOT edit REQUIREMENTS.md — the phase-25 lane owns it, and ACTN-05/PIPE-01 must stay Pending until the owner UAT anyway"
  - "media-director turned out NOT to be an owner architectural call: skill.ts already carried the written DELIBERATELY UNGATED justification. Derived the exemption instead of re-litigating it"
  - "Fixed the e2e opener race rather than reporting the spec as unrunnable — it was a bug in a file this phase shipped, and running it was this plan's mandate"

requirements-completed: []  # ACTN-05 and PIPE-01 stay Pending. The owner UAT has not run, AND the
# measured defect below means ACTN-05 is not met regardless of what the UAT says about the UI.

# Metrics
duration: ~2h 40m
tasks: 3 (Task 2 is the blocking owner gate — NOT self-approved)
completed: 2026-08-10
model-spend: $0.0142
---

# Phase 19 Plan 10: Close the phase honestly Summary

**The phase's documents claimed more than the phase delivered, and this plan's job was to say so.
It corrected six falsified claims, filled all 22 validation rows from re-measured commands, ran the
e2e spec that had never executed (2/2 green), got the offline eval gate running again for the first
time since Phase 20 — and used it to prove that ACTN-05's headline capability does not work.**

## Status in one line

**22/22 validation rows green, `pnpm test` 9/9 (1415 backend tests), typecheck 10/10 exit 0, e2e
2/2 — and ACTN-05 is still NOT met, because the live `cockpit-agent@18` body stages an `addContact`
instead of the dated follow-up it is asked for.** The owner browser UAT has not run; this plan
stops at it.

## The headline finding

Fixture 36 was certified 35/35 by 19-09. 19-09 also noticed, on that same passing run, that the
staged operation was an `addContact` with no `due` rather than the `addFollowUp` its prose
described — and correctly reported that `crmOperationCount` is a COUNT and cannot tell op types
apart. This plan closed that hole and re-measured.

**Result: `datedFollowUpCount: expected 1, got 0`.** Run `309b1c3d`, `--only 36`, **$0.0142**,
against the now-ACTIVE v18. The plan row, read back at $0:

```json
{"kind":"crm_write","status":"proposed",
 "crmOperations":[{"op":"addContact","email":"eval-rhea-6q@golden.example",
                   "name":"Rhea Calloway","origin":"mailbox-resolved"}]}
```

On the run's other attempt it staged nothing at all and the plan stayed `collecting` — so the
behaviour is not even uniform: 1 of 2 attempts reached the tool, and neither produced a follow-up.

**Two wrongs, not one.** The dated follow-up the user asked for was never created, AND a contact
the user never asked to save was — which is in tension with invariant 1's explicit-acts-only rule,
the very invariant SC#7 required this phase to state in writing.

**What this means for the requirement.** Every mechanism works: the tool is registered at all three
surfaces, `patchPlan` accepts the kind, the apply is one serializable transaction, the guards hold,
the isolation holds. **None of that is the capability.** ACTN-05 says the agent can log a follow-up.
It cannot. `requirements-completed` is empty and `REQUIREMENTS.md` is untouched.

**Do not fix this with another sentence in the body.** 19-09 established the pattern the hard way:
the body forbids the adjacent failure VERBATIM and the model did it anyway on 2/2 runs. The
candidate fixes are the tool's SHAPE (one grammar that takes a person and a due date together,
rather than two ops the model must compose) or an explicit refusal when a follow-up request yields
a contact-only operation list.

## Task commits

| # | Task | Commit |
|---|---|---|
| — | `datedFollowUpCount` + the self-check repair (folded items 1 & 3) | `e326ef9` |
| — | `e2e/pipeline.spec.ts` executed + opener race fixed (folded item 2) | `ed1dbdb` |
| 1 | ROADMAP's three stale locations + all 22 validation rows | `ef23a52` |
| 3 | Playbook close-out | in `e326ef9` / `ed1dbdb` (paired with the code each watches) |
| 2 | **OWNER GATE — not reached. Not self-approved.** | — |

## The falsified claims, corrected

The plan named two documents. The phase produced more than two untruths.

| Claim | Where | Reality |
|---|---|---|
| "two new tables: `contacts` and `followUps`" | ROADMAP Phase-26 note | **Three.** `suppressions` is the one that makes SC#5 structurally clean |
| Phase 19 "needs planning first — 0/TBD" | ROADMAP amended-2026-08-07 bullet | 10 plans, 9 complete |
| Phase 19 index row "5/10" | ROADMAP Phase Index | 9/10 |
| a full eval gate costs ~$0.12–0.15 | the plan, and several summaries | **~$0.35.** Corrected in `contacts-crm.md`, `agent-runtime.md`, ROADMAP and VALIDATION |
| `run-eval-golden.mjs --list` is an offline check | `19-09-PLAN.md`, twice | **No such flag.** Unknown argv falls through to `runLive` — a full PAID run |
| v18 is a "candidate"; ACTN-05 "certified but not live" | STATE, summaries, playbooks | **v18 is ACTIVE.** Stale everywhere it still says otherwise |
| `14feb4b7` certified v17 | `19-09-PLAN.md` | The `skills.evidence` row says `d17039a8`. Trust the row |

**Two more the plan did not anticipate, both found by executing rather than reading:**

**1. `pnpm --filter @pikar/<pkg> test -- <name>` does not filter — anywhere in this repo.**

```
pnpm --filter @pikar/core test -- contacts   → vitest run "--" "contacts"  → 32 files
pnpm --filter @pikar/core test    contacts   → vitest run "contacts"       →  1 file
```

pnpm forwards the literal `--`; vitest matches nothing and runs everything. On the backend that is
72 files / 1415 tests / ~2 minutes, not the "~90 s filtered" the validation contract claimed. **Same
root cause** as the e2e resume command every spec header quotes, which ran all 25 specs for 8
minutes instead of one file. One `--`, two symptoms — fixed at both.

**The nastiest consequence:** seven validation rows named `-- cockpitTools`, and
`cockpitTools.test.ts` contains **zero** `executePlan` tests (`grep -c` = 0, versus 78 in
`cockpit.test.ts`). Those rows pass today **only because the broken `--` accidentally runs
`cockpit.test.ts` too.** Repairing the `--` without repairing the file names would have silently
converted six rows into vacuous greens. Both are corrected.

**2. The plan's own verify script cannot pass on a correct document.** Its ROADMAP regex,
`/Phase 19[\s\S]{0,4000}?\*\*Plans\*\*: TBD/`, matches an unrelated "Phase 19" mention at line 271
running 27 lines into a *different* phase's `**Plans**: TBD` at line 298. Replaced with a scoped
assertion against the Phase 19 section's own `**Plans**:` line. Two other scans in this plan
(`⬜ pending`, the stale-string list) fail on a document that *quotes* the bad string while
correcting it — a self-reference trap that cost two edit cycles and is worth knowing about.

## Folded-in items

### 1. Fixture 36's op-type gap — CLOSED, and it went red

`datedFollowUpCount` joined the CLOSED `EXPECT_KEYS` vocabulary: it counts staged ops that are an
`addFollowUp` carrying a finite `dueAt`.

- **A SUBSET key.** The runner REFUSES it without `crmOperationCount`, and refuses a subset larger
  than the total. Without that pairing, an agent could stage the right follow-up plus three
  unrequested contacts and still pass.
- **The `dueAt` half is not decoration.** `stageCrmWrite` resolves the user's WORDS through
  `parseSendTime` against the trusted clock, so a finite `dueAt` is the observable end of that whole
  §2-D chain; and an undated follow-up never reaches the `by_tenant_status_dueAt` range read, so the
  "Follow-ups due" tile can never surface it.
- **Both halves mutation-proven offline, at $0**, before any paid run:

  | Mutation | Result |
  |---|---|
  | grader counts every op (aliases `crmOperationCount`) | RED: *"MUST FAIL when the agent staged a contact instead of a dated follow-up"* |
  | grader drops the `dueAt` requirement | RED: *"MUST FAIL on an UNDATED follow-up"* |

  Both reverted; `--self-check` green after.
- Then `--only 36` against the active body: **FAIL, $0.0142.** Reported as a defect, not repaired
  by weakening the key.

### 2. `e2e/pipeline.spec.ts` — RAN, 2/2 PASSED

Authored in 19-07, never executed. Now run against a live `convex dev` on `:3210` and a PRODUCTION
build on `:3111`.

**19-07's blocker was not real.** It recorded that an executor cannot mint
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD`. `convex/auth.ts` runs the Convex Auth `Password` provider and
`/signup` is a real form, so a throwaway user is one scripted signup away — and **a fresh signup is
also how the empty-tenant precondition was met without building the reset seam 19-07 declined to
build.** A new tenant is an empty tenant. 26-05 and 26-10 stopped for want of an account, which is
a missing account, not an impossibility.

**The first run found a bug in the spec itself** — not a product defect:
`(await locator.count()) > 0 ? a : b` does not auto-wait, so immediately after `goto` the
empty-state button counted 0 and the ternary committed to `add-contact`, which only renders when
`contacts.length > 0` and therefore could never appear on the empty tenant the file's own
precondition requires. 30-second hang. `locator.or()` auto-waits for whichever affordance is real —
the native fix.

Precondition note, now OBSERVED rather than predicted: test 2 created a contact, so re-running
against that same user WILL fail test 1. That is a precondition failure. Sign up another.

**What this browser-verifies:** the four tiles as real integers on an empty tenant (a hedge makes
the parse throw), the one-action empty state, add → follow-up → suppress → two-click un-suppress,
the contactless section staying separate, and the nav still carrying no Pipeline link.

### 3. The `media-director` gating hole — RESOLVED, and it was not an owner call

`skill.ts` **already carried** a written, dated `DELIBERATELY UNGATED — do NOT add to GATED_SKILLS`
justification above `MEDIA_DIRECTOR_SKILL` (Phase 20, MEDIA-01), with the mechanical reason: the
runner drives TEXT fixtures and structurally cannot drive a script/art-direction/storyboard turn, so
gating it would deadlock the row at v1 on its first body edit. It is one of **six** rows carrying
such a justification. The decision existed at the canonical site; the assertion simply could not see
it. That is a much cheaper problem than an unmade architectural decision.

`run-eval-golden.mjs` now DERIVES the exemption set from `skill.ts`, using the same
read-the-constant-off-disk idiom it already used for `GATED_SKILLS`. A dispatchable route's skill
must be gated **or** carry that justification; neither still fails hard. Deriving means a new
exemption registers itself the day it is written and **can only register by writing the
justification** — which is the enforcement actually wanted. Two non-vacuity assertions stop the
derivation degrading into "anything goes" if the regex ever stops matching. The hand-maintained
route→skill ternary is gone too, replaced by `SPECIALISTS[route].skillName` — that second copy is
why the failure named the route `media` rather than the real skill `media-director`.

**`--self-check` PASSES for the first time since Phase 20**, and immediately earned its keep: it is
what proved `datedFollowUpCount` red-able at $0.

**Two residual risks, deliberately left open and recorded, not hidden:**
1. A `media-director` body edit still activates with no eval evidence. That is the accepted cost of
   the exemption, stated in `skill.ts`. Re-raise it if media ever ingests untrusted third-party
   input — that property is what forces gating for `inbox-digest` / `reply-drafter`.
2. **`runLive()` still never calls `selfCheck()`.** This is why the breakage stayed invisible for a
   whole phase: the one check that stops a bad fixture before it costs a cent could not itself be
   run, and nothing in the paid path would say so. Recorded in `agent-runtime.md` as the next fix
   here; left out only because changing what a PAID entry point does was not this plan's mandate.

## Verification

| Check | Result |
|---|---|
| `pnpm test` (full turbo) | **9/9 tasks — backend 72 files / 1415 tests green** |
| `pnpm typecheck` (full turbo) | **10/10 packages, exit 0** |
| backend `npx tsc --noEmit` foreground | **exit 0, no output** — baseline RE-MEASURED, delta 0 |
| `pnpm --filter @pikar/web build` | green |
| `node scripts/check-playbooks.mjs` | **exit 0** |
| `run-eval-golden.mjs --self-check` | **PASSED** — 35 fixtures valid, 12 gated skills derived (first green since Phase 20) |
| `npx playwright test e2e/pipeline.spec.ts` | **2/2 passed, 12.3s** |
| `pnpm eval:golden --skill cockpit-agent@18 --only 36` | **FAIL — `datedFollowUpCount: expected 1, got 0`.** $0.0142, run `309b1c3d` |
| mutation checks on the new key | **2 RED, both reverted** |
| per-file counts (re-measured) | cockpit 63 · gmail 42 · plans 22 · backend contacts 62 · core contacts 23 · actionType 12 · pipelineView 17 · crmCard 2 · llmRedaction 60 · traceParity 2 · cockpitTools 101 |
| `biome check` on both touched sources | clean |
| REQUIREMENTS.md checkbox vs status table | **AGREE** (both not-complete) — and the file was not edited |

## Deviations from plan

### Auto-fixed

**1. [Rule 1 — bug] `e2e/pipeline.spec.ts`'s opener race**
- **Found during:** folded item 2, on the spec's first-ever execution.
- **Issue:** a non-auto-waiting `count()` ternary committed to a locator that could not render on
  the empty tenant the same file asserts. 30s timeout, reported as a failure of a passing product.
- **Fix:** `locator.or()`. **Commit:** `ed1dbdb`

**2. [Rule 3 — blocking] The offline eval gate could not run**
- **Found during:** folded item 1 — I needed `--self-check` to mutation-prove the new key, and it
  was red on `main`.
- **Fix:** derive the DELIBERATELY UNGATED exemption from `skill.ts`. **Commit:** `e326ef9`

**3. [Rule 1 — bug] The plan's own ROADMAP verify regex cannot pass**
- Over-broad `[\s\S]{0,4000}` spanning from an unrelated "Phase 19" mention into another phase's
  TBD. Replaced with a scoped assertion. Recorded above.

### Judgement calls recorded

- **`REQUIREMENTS.md` NOT edited.** The orchestrator assigned it to the concurrent phase-25 lane,
  and the plan's own rule is that requirements tick only on a passed checkpoint. Both point the
  same way. Verified the checkbox and status table AGREE (both not-complete) rather than editing.
- **`ROADMAP.md` WAS committed.** It had carried the phase-25 lane's ~17 uncommitted lines all
  phase, which is why waves 5-9 each ticked it and left it dirty. That lane has since committed:
  `git diff` showed only Phase-19 checkbox lines, and the final diff adds zero phase-25 content.
  Checked before committing, as instructed.
- **No full gate run.** `--only 36` answered the question for $0.0142. A gate would have cost ~$0.35
  to re-measure the same red.
- **`contacts-crm.md`'s `Last verified` is bumped to `12bde78` with the UAT explicitly marked
  PENDING**, not to a sha the owner verified — because the owner has verified nothing yet. It says
  so in the line itself and will be re-bumped when the UAT passes.

## Issues encountered

- The full e2e suite run (8 minutes, 25 failures) was self-inflicted by trusting the documented
  `--` command. Almost every failure is a tenant-precondition failure on a fresh un-onboarded
  signup, unrelated to this phase. Not investigated; out of scope.
- `UV_HANDLE_CLOSING` assertion noise on every `npx convex run` exit (Windows/Node 24). Known
  benign; every result was read back to confirm.

## Next

1. **The owner browser UAT** — this plan's blocking gate. Not self-approved.
2. **The ACTN-05 defect needs a plan of its own.** Body edits are the wrong instrument; start with
   `stageCrmWrite`'s shape.
3. `runLive()` should call `selfCheck()`.
4. Repair the `--` idiom repo-wide — it is quoted in most playbooks and every e2e spec header.

## Self-Check: PASSED

- `packages/backend/scripts/run-eval-golden.mjs` — FOUND (`datedFollowUpCount`, `ungatedSkillNames`, `SPECIALIST_SKILLS` all present)
- `packages/backend/scripts/eval-cases/36-crm-follow-up.json` — FOUND (`datedFollowUpCount: 1`)
- `apps/web/e2e/pipeline.spec.ts` — FOUND (`locator.or`, header records the 2/2 run)
- `.planning/phases/19-contacts-crm-follow-ups/19-VALIDATION.md` — FOUND (22 rows, zero unfilled)
- `.planning/ROADMAP.md` — FOUND (three tables named; all three Phase-19 locations corrected)
- `docs/playbooks/contacts-crm.md` / `agent-runtime.md` / `cockpit.md` / `dashboard-pages.md` — FOUND (`19-10` in all four; `check-playbooks.mjs` exit 0)
- commits `e326ef9`, `ed1dbdb`, `ef23a52` — all FOUND in `git log`

---
*Phase: 19-contacts-crm-follow-ups*
*Completed: 2026-08-10 (offline surface) — owner UAT PENDING*
