---
phase: 19-contacts-crm-follow-ups
plan: 09
subsystem: testing
tags: [skill-registry, cockpit-agent, eval-golden, crm, stageCrmWrite, convex, prompt-versioning]

# Dependency graph
requires:
  - phase: 19-contacts-crm-follow-ups (19-06)
    provides: "the `crm_write` action type and `plans.crmOperations`, the content-plane field `crmOperationCount` is graded off"
  - phase: 19-contacts-crm-follow-ups (19-08)
    provides: "the registered `stageCrmWrite` tool and contacts-first `resolveContacts` — registered but invisible to the model until this plan's body edit"
  - phase: 18-documents (18-08)
    provides: "the binding shared-gate override condition (`teach a tool, owe a fixture`) and the `createdDocCount` observable this one is modelled on"
provides:
  - "The `cockpit-agent` body teaching contacts-first resolution and `stageCrmWrite` (27 313 -> 28 368 chars)"
  - "The byte-identical auto-derived `.ts` mirror"
  - "`eval-cases/36-crm-follow-up.json` — the fixture owed by the 18-08 override condition"
  - "The `crmOperationCount` $0 observable and its anti-vacuity rule"
  - "The 34 -> 35 fixture-floor bump (the deletion tripwire)"
  - "`cockpit-agent@18` SEEDED as a candidate, hash-verified, NOT activated"
  - "A measured, twice-reproduced routing failure: the cockpit composes an email instead of calling `stageCrmWrite`"
affects: [19-10, 20-12, 20.1-01, skill-registry, eval-golden]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plan-row observables (`crmOperationCount`) are graded off the plan row `plans:getById` already returned — no `smoke:` op, no extra hop, $0"
    - "Hash-verify a seeded skill body BEFORE any paid eval run"
    - "`--only <id>` diagnostic on a brand-new fixture BEFORE the unfiltered gate"

key-files:
  created:
    - packages/backend/scripts/eval-cases/36-crm-follow-up.json
  modified:
    - packages/contracts/skills/cockpit-agent.md
    - packages/contracts/src/skills/cockpitAgent.ts
    - packages/backend/scripts/run-eval-golden.mjs
    - docs/playbooks/skill-registry.md
    - docs/playbooks/agent-runtime.md
    - .planning/phases/19-contacts-crm-follow-ups/deferred-items.md

key-decisions:
  - "The unfiltered $0.12 gate was NOT run after fixture 36 failed its $0.0115 diagnostic — with 36 red the gate scores 34/35 at best, certifies nothing, and would have to be paid for again after any fix"
  - "Nothing was activated: cockpit-agent@17 remains ACTIVE, v18 remains candidate — activation was explicitly withheld by the owner"
  - "Fixture 36's failure is read as a FIXTURE defect first, not a body defect: turn 1 supplies an email address inline (because the address is also the needle) and a supplied address is the cockpit's strongest recipient-collection cue"
  - "No third instruction was added to the body — the behaviour was uniform across 2/2 runs, and the body already forbids it verbatim"

patterns-established:
  - "Diagnostic-before-gate: a fixture that has never executed costs one case to falsify, not thirty-five"
  - "Seed-then-hash-verify: never run a paid eval against a body you cannot identify"

requirements-completed: []

# Metrics
duration: ~35 min (this session; the plan spans two executor sessions)
completed: 2026-08-09
---

# Phase 19 Plan 09: Teach the Body, Owe the Fixture Summary

**The `cockpit-agent` body now teaches contacts-first resolution and `stageCrmWrite`, the owed fixture and its `$0` `crmOperationCount` observable exist, and `cockpit-agent@18` is seeded and hash-verified — but fixture 36 FAILED its first live execution twice for $0.0115, so the golden gate was never started and NOTHING WAS ACTIVATED.**

## Status in one line

**`cockpit-agent@17` is still ACTIVE. `cockpit-agent@18` is a `candidate`. The gate is UNRUN.**

## Performance

- **Duration:** ~35 min this session (the plan was resumed across its blocking owner checkpoint; Tasks 1-2 landed in a prior session)
- **Completed:** 2026-08-09
- **Tasks:** 4 of 4 authored; Task 3 (the owner gate) partially executed — seed + diagnostic ran, the gate and activation did not
- **Files modified:** 6 (1 created)
- **Model spend:** **$0.0115** against a $0.30 ceiling

## Accomplishments

- The canonical `cockpit-agent.md` teaches three things in the body's own voice: contacts-first resolution, that `stageCrmWrite` STAGES and never saves, and that a follow-up always belongs to someone (ask, never invent an owner). The `.ts` mirror is byte-identical (LF-normalized) and the vitest sync assertion is green.
- `eval-cases/36-crm-follow-up.json` — the fixture owed by 18-08's binding *"teach a tool, owe a fixture"* override condition. Two turns: one that must route to `stageCrmWrite`, one that must be refused-by-asking. `crmOperationCount: 1` (never 2), `recipientCount: 0`, `statusAtMost: proposed`. The first fixture in the set to set `clock: true`.
- `crmOperationCount`, a `$0` observable graded off `plan.crmOperations` — deliberately NOT a `smoke:` read, because a staged CRM operation IS the plan row `plans:getById` already returns — with the same anti-vacuity rejection that governs `createdDocCount` and the hosted-search floor.
- The fixture floor bumped 34 -> 35, the deletion tripwire that stops a quietly dropped case from quietly shrinking the gate.
- `seedSkills` minted `cockpit-agent@18` and it was **hash-verified before a cent was spent**: 28 368 chars, sha256 `6ca4d937639cc6b97a90f4f4ca54315f6c39ae9c818b9c94c1ec3d72a17510ad`.
- **The diagnostic did exactly the job it exists for**: it falsified the gate's premise for $0.0115 instead of $0.13.

## Task Commits

1. **Task 1: Teach the body, regenerate the mirror** — `f5e527f` (feat) *[prior session]*
2. **Task 2: The owed fixture, the `$0` observable, the floor bump** — `53254e7` (test) *[prior session]*
3. **Task 3: OWNER GATE** — seed + diagnostic executed this session; gate and activation NOT executed (see below)
4. **Task 4: Record the certification in the playbooks** — `8a0612b` (skill-registry, prior session, Stop-hook-forced) + `e3baaa4` (both playbooks, the REAL outcome, this session)

## What Actually Happened at the Gate

The owner authorized seed + diagnostic + gate and **explicitly withheld activation**. Here is each step and its real result.

### 1. One clean `convex dev` — PASS

No convex process was running at start. Exactly one `npx convex dev` was started from `packages/backend` with `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=180`; it reached `Convex functions ready! (1.48m)` on `:3210` and stayed stable for the whole session. **No retry storm, no `InternalServerError`, zero restarts.**

### 2. Seed — PASS, and hash-verified

Read off the deployment at $0 before seeding: `cockpit-agent` v12-v15 archived, **v16 candidate**, **v17 active**, nothing above. `seedSkills` therefore minted `maxVersion + 1` = **v18**, a FORWARD arrow, not the rollback the registry playbook warns about.

| Field | Expected | Measured |
|---|---|---|
| version | 18 | **18** |
| status | candidate | **candidate** |
| body length | 28 368 | **28 368** |
| sha256 | `6ca4d937639c…` | **`6ca4d937639cc6b97a90f4f4ca54315f6c39ae9c818b9c94c1ec3d72a17510ad`** |

### 3. Diagnostic `--only 36` — **FAIL, $0.0115**

```
[eval:golden] run fa9180be — 1 cases, tenant eval-fa9180be, cap $2.00, pins cockpit-agent@18
[eval:golden] PARTIAL RUN — --only 36 (1/35 fixtures). Diagnostic only: NO evidence will be recorded.
  · 36-crm-follow-up thread=smoke-attach-fd0b1b46… plan=mh78fmprgrck62zag5179jkqzx8c4wyj
  · 36-crm-follow-up thread=smoke-attach-47cd314f… plan=mh7cerw152jzkvbzqqkm4dqmzx8c5w1k
  FAIL            36-crm-follow-up  ($0.0115)
      crmOperationCount: expected 1, got 0
      recipientCount: expected 0, got 1

[eval:golden] 0/1 passed — total cost $0.0115
```

Both attempt plan rows were then inspected directly at $0. They are the **same shape**:

```
status: "collecting"
recipients: ["eval-rhea-6q@golden.example"]
subject: "Reminder to chase Rhea Calloway about benchmark-CR1 renewal"
crmOperations: (field absent)
```

**The agent never called `stageCrmWrite` once.** It did not stage a follow-up and additionally email — turn 1 became an outbound email draft, both times, identically. The needles passed, which is the whole point of the observable: a reply assertion could not have told this apart from success.

### 4. The unfiltered gate — **NOT RUN, deliberately**

This is the one place I departed from the literal instruction, and the reasoning is the same reasoning that put step 3 before step 4:

- With 36 red the gate can score **34/35 at best**. It cannot certify anything and cannot lead to activation.
- Any fix to the fixture or the body invalidates the run, so the ~$0.12 would be **paid twice**.
- The cost discipline forbids re-running a failure hoping for a different answer; running its superset is the same act with a bigger bill.

The step-3 de-risking gate existed precisely to create this decision point, and it fired. **It is still worth one run for a narrower question the owner should decide separately: did the body edit (27 313 -> 28 368 chars) regress the other 34?** That command is `pnpm eval:golden --skill cockpit-agent@18`.

### 5. Activation — **NOT RUN** (withheld by the owner)

## Diagnosis: why fixture 36 failed

**This is not a missing instruction.** The shipped v18 body's "Keeping track of people" section already says, verbatim:

> **Use the email address the user gave you, and never invent one.** If you do not have it, ask for it. This is not a compose: do not add the person as a recipient to get at their address.

The model did it anyway, on 2/2 runs. Per the reflex-vs-judgement rule, behaviour uniform across every run regardless of input is not fixable by another sentence in the body — a third instruction is the wrong next move.

**The likeliest root cause is the FIXTURE, and it is the exact trap the fixture's own `description` names.** Turn 1 reads:

> `Remind me on Thursday to chase Rhea Calloway about the benchmark-CR1 renewal — her address is eval-rhea-6q@golden.example.`

The address is in the turn because the address is also the non-vacuity **needle**. But a supplied email address is the cockpit's strongest recipient-collection cue, and *"Remind me … to chase \<person\>"* reads as compose. The fixture needs the address in the turn and forbids it becoming a recipient — **it fights itself**.

**Recommended next move, cheapest first:** change the FIXTURE — get the needle off something that is not an email address, or make turn 1 unambiguously a records act — then re-run `--only 36` for ~$0.01. One paid diagnostic separates fixture-defect from body-defect. Do not run the full gate until 36 is green.

`stageCrmWrite` wiring was checked and ruled out: the tool is built unconditionally in `buildCockpitTools` (`llm.ts:2314`), with no `rootRequestId`-style gate like the one that silently removed the research tool in 16-09.

## Decisions Made

- **Did not run the unfiltered gate.** Reasoning above. Reported as a judgement call the owner can override with one command.
- **Did not touch the fixture or the body.** Redesigning the fixture and re-running is a design decision with real money attached, and the owner gated spending on this plan.
- **Left `convex dev` RUNNING** on `:3210` so the owner can act on this report without paying the 1.5-minute cold start again.
- **Recorded the outcome as UNRUN, never as passed**, in both playbooks and in STATE.md, per the plan's explicit instruction.

## Deviations from Plan

### Auto-fixed / handled

**1. [Rule 3 - Blocking] `run-eval-golden.mjs --list` does not exist**
- **Found during:** Task 3 (pre-run verification)
- **Issue:** `19-09-PLAN.md` names `node packages/backend/scripts/run-eval-golden.mjs --list` twice as an **offline** verification. There is no `--list` flag. Unknown argv is ignored and execution falls straight through to `runLive` — **a full PAID run**. Following the plan literally would have spent ~$0.12 while believing it cost nothing.
- **Fix:** Used `--self-check`, the real offline command. Recorded the trap in `agent-runtime.md` so the next reader of the plan does not fall in.
- **Verification:** `argv.includes("--self-check")` is the only branch before `runLive` (`run-eval-golden.mjs:1558-1564`).
- **Committed in:** `e3baaa4`

**2. [pre-existing, NOT fixed] `eval:golden --self-check` is RED on `main`**
- **Found during:** Task 3
- **Issue:** `--self-check` exits 1 with `[eval:golden] media must also be GATED — a body edit rides the gate`. `media` is a dispatchable specialist route whose skill `media-director` is not in `GATED_SKILLS`.
- **Why not fixed:** Already triaged by the prior executor and written up in `deferred-items.md` as an owner decision with three named ways out. **It does not block the gate** — `runLive()` never calls `selfCheck()`, and fixture-level `validateFixture` still runs inside `runLive`. Out of scope for this plan.

---

**Total deviations:** 1 blocking auto-fix, 1 pre-existing issue documented and deferred.
**Impact on plan:** The `--list` correction prevented an unbudgeted paid run. No scope creep.

## Issues Encountered

- **Fixture 36 failed its first live execution.** This is the plan's headline outcome, diagnosed above. It is a real signal, not a flake — identical on 2/2 attempts, with the plan-row evidence inspected directly.
- **`UV_HANDLE_CLOSING` assertion noise** on every `npx convex run` exit (Windows/Node24). Known-benign; the mutation and queries all committed. Verified by reading the results back.

## User Setup Required

None.

## Next Phase Readiness

**Blocking for 19-10 and for the phase close:**

1. **Fixture 36 is red and the gate is unrun.** ACTN-05 has a body that teaches the tool and a fixture that proves the teaching does not hold. `requirements-completed` is deliberately **empty** — ACTN-05 is NOT satisfied.
2. **`cockpit-agent@18` is a seeded candidate sitting above the active v17.** Any later lane running `seedSkills` will mint v19 on top of it. It is a forward arrow and harmless, but it is no longer a clean 17-max.
3. **20-12 and 20.1-01 must rebase on this body** before seeding a candidate of their own — one candidate stream, one gate.

**Ready:** the observable, the floor, the mirror sync, and the seed/verify procedure all work and are documented. The remaining work is a fixture redesign plus ~$0.01, then the gate.

**ROADMAP.md is hand-ticked but deliberately NOT committed** — it still mixes the concurrent phase-25 lane's uncommitted lines. 19-10 reconciles it.

## Self-Check: PASSED

- All 6 key files present on disk (1 created, 5 modified).
- All 4 commits resolve: `f5e527f`, `53254e7`, `8a0612b`, `e3baaa4`.
- 35 fixture files on disk; floor asserts `fixtures.length >= 35` (`run-eval-golden.mjs:588`).
- `node scripts/check-playbooks.mjs` exit 0; both playbooks contain `19-09`.
- Live registry re-read at $0: `cockpit-agent` **v17 `active`**, **v18 `candidate`**. Nothing activated.

---
*Phase: 19-contacts-crm-follow-ups*
*Completed: 2026-08-09*
