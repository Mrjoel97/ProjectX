---
phase: 21-user-authored-skills-and-routines
plan: 03
subsystem: skill-registry
requirements: [SKILL-01]
requirement_status: OPEN — deliberately not marked complete
tags: [eval-evidence, exact-row-identity, runtime-attribution, refs-only-inspector, unpaid]
dependency_graph:
  requires:
    - "21-01: tenantSkills table + 4 indexes, USER_AUTHORABLE_SKILLS"
    - "21-02: publishUserCandidate, loadEffectiveSkill/getEffectiveSkill (scope + skillId)"
    - "21-02: composition core != lineage base — basedOnVersion is the SUPERSEDED TENANT version"
  provides:
    - "contracts: EvalEvidence.tenantTarget + hasPassingTenantEvidence + NO_SUCH_TENANT_CANDIDATE_ERROR"
    - "skills.getTenantSkillVersion / recordTenantEvalEvidence / inspectTenantSkill (internal)"
    - "llm.runSpecialistTurn: tenantSkillIds arg + {skillScope,skillId,skillName,skillBodyHash} return"
    - "dispatch: tenantSkillIds through all 4 runSpecialistTurn seams + subagent.completed attribution"
    - "evaluations.actOnGapInternal: tenantSkillIds"
    - "smoke.userSkillRuntimeAttribution (bounded read-only correlation readback)"
    - "run-eval-golden: --tenant-skill, --inspect-tenant-skill, --json, --foreign-tenant, 4 expectation flags"
  affects: ["21-04", "21-06", "21-07"]
tech_stack:
  added: []
  patterns:
    - "the ROW is the identity; name@version is not"
    - "refs-only inspector whose return TYPE has no body field"
    - "attribution on the existing audit lineage, never a second trace plane"
    - "one named predicate for the evidence rule, so each clause is separately provable offline"
key_files:
  created: []
  modified:
    - packages/contracts/src/skill.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/dispatch.test.ts
    - packages/backend/convex/evaluations.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/scripts/run-eval-golden.mjs
    - docs/playbooks/skill-registry.md
    - docs/playbooks/agent-runtime.md
metrics:
  commits:
    - "ce04642 — contracts + exact reads/evidence/inspector (3 files, +716 / -2)"
    - "d2374bf — tenant ids through the scheduled dispatch + audit attribution (6 files, +419 / -12)"
    - "6cd236b — the golden runner (1 file, +915 / -15)"
    - "490d5a0 — playbooks + 21-03-PLAN.md (3 files, +487 / -0)"
  files_changed: 12
  insertions: 2537
  deletions: 29
  spend_usd: 0.00
  completed: 2026-08-11
---

# Phase 21 Plan 03: Exact Tenant Candidate Evaluation Summary

Eval evidence can now name ONE tenant candidate row, that exact row's body is provably what the
dispatched specialist executed, and every use is attributed refs-only on the existing audit lineage
— while nothing was evaluated live, nothing was activated, and **$0.00** was spent.

---

## Measured Results

Every number below was read off a command run in this session. Nothing is estimated.

| Gate | Command | Result |
|---|---|---|
| Registry suite (Task 1) | `npx vitest run convex/skills.test.ts --maxWorkers=1` | **72/72 passed** (65/65 at 21-02's end; **+7**) |
| Task 2 verify (exact plan command) | `… vitest run convex/dispatch.test.ts convex/skills.test.ts --maxWorkers=1` | **149/149 passed** (dispatch 73→**77**, +4) |
| Backend regression set | `… vitest run skills + dispatch + runCockpitAgent + importGuard + dispatchGuard + llmRedaction + auditImmutability` | **333/333 passed**, 7 files |
| Contracts suite | `pnpm --filter @pikar/contracts exec vitest run` | **31/31 passed**, 3 files |
| Backend typecheck | `pnpm typecheck` (packages/backend) | exit **0** (twice; see the TS2339 note) |
| Contracts typecheck | `pnpm typecheck` (packages/contracts) | exit **0** |
| Task 3 verify (exact plan command) | `node scripts/run-eval-golden.mjs --self-check` | **PASSED**, exit **0**, 36 fixtures, 12 gated skills |
| Task 4 verify | `node scripts/check-playbooks.mjs check` | exit **0** |
| Whitespace | `git diff --check` | exit **0** |
| **Model spend** | — | **$0.00 — no model call, no paid eval, no `--skill` or `--tenant-skill` run, no activation** |

**THE EVAL GATE WAS NOT RUN.** The standing do-not-rerun order was honoured. The only eval
invocation this plan made is `--self-check`, which is free and which now *proves itself* free: it
scans its own function body for `must(` (the one helper that shells out to `npx convex run`) and
fails if it finds one.

Three `$0` argument-guard smokes were also run against the real script (each exits 1 before any
Convex call): `--tenant-skil x` → `unknown argument "--tenant-skil"`; `--expect-status=candidate`
→ `status expectation flags require --inspect-tenant-skill`; `--inspect-tenant-skill` with no value
→ `--tenant-skill requires a tenantSkills row id (got undefined)`.

### Biome, measured against HEAD rather than asserted

| File | HEAD | After |
|---|---|---|
| `contracts/src/skill.ts`, `convex/skills.ts`, `convex/dispatch.ts` | clean | **clean** (0 errors, 0 warnings) |
| `convex/evaluations.ts` | clean | **clean** |
| `convex/skills.test.ts` | 29 warnings | **29 warnings, 0 errors** (net zero added) |
| `convex/llm.ts` | 8 warnings, 0 errors | **8 warnings, 0 errors** (I introduced one format error and fixed it) |
| `convex/smoke.ts` | 1 error + 1 warning | **1 error + 1 warning** (pre-existing, untouched) |
| `convex/dispatch.test.ts` | 1 error + 1 warning | **1 error + 1 warning** (the error is a pre-existing unused `runTolerant`) |
| `scripts/run-eval-golden.mjs` | 1 format error (2 regions) | **1 format error, the SAME 2 regions** (`BLUEPRINT_NEEDLE` + `attemptCase`) |

Every file must be **LF-normalised before biome is believed**: `llm.ts`, `evaluations.ts` and
`run-eval-golden.mjs` are CRLF in this working tree and biome reports the whole file as a format
error on that basis alone. The baselines above were taken with matching normalisation.

### The TS2339 the 21-05 lane reported — mine, and already fixed

The sibling lane measured `packages/backend/convex/skills.test.ts(1704,23): error TS2339` at my
first commit `ce04642` and correctly attributed it to me. Their diagnosis was one step off: the
`?? {}` rest-destructure itself is legal — the error came from *reading* `beforeRest.status`, which
does not exist on the `{}` branch of the union. Fixed by reading `status` off the row before
destructuring (`expect(beforeRow?.status).toBe("candidate")`), which landed in the very next commit
`d2374bf`, one commit after the one they measured. **`pnpm typecheck` at current HEAD: exit 0, no
diagnostics.** Verified twice.

---

## What Was Built

### Task 1 — the exact identity (`contracts/src/skill.ts` +61, `skills.ts` +279)

`EvalEvidence.tenantTarget` is a new OPTIONAL field (`{candidateId, registryTenantId, name,
version}`) and `hasPassingTenantEvidence` compares **every** one of them. `hasPassingEvidence` was
deliberately **not** widened: the global gate asks "was this NAME at this VERSION certified", which
is precisely the question that stopped being sufficient the moment two tenants could each own
`offer-architect@2`. Widening it would let a `name@version` row certify a tenant candidate — the
exact confusion this plan exists to end.

Three internal functions, all keyed on `ctx.db.get(candidateId)` and never on a name/version query:

- **`getTenantSkillVersion`** — the tenant twin of `getSkillVersion`. It returns `status` and
  `author` alongside the body because the *runner* must refuse a non-candidate / non-user id at $0
  and has no other read to ask with. The read itself serves any status (an `active` row is a
  legitimate diagnostic target); the refusal belongs at the boundary where money starts.
- **`recordTenantEvalEvidence`** — patches `evidence` and nothing else.
- **`inspectTenantSkill`** — the refs-only snapshot. **Body-free by construction, not by care**:
  every registry row leaves as a `SkillRefs` shape that *has no body field*, so the candidate's
  composed body, the user's authored adaptation and the global prompt are all structurally absent.
  Read-only is a property of the function KIND (`internalQuery` cannot write), not of a reviewer.

Two design points that are not cosmetic:

**`evidenceState` is `absent | passing | failing`, and unparseable reads `failing`.** "There is a
pin and it does not hold" is a different operator situation from "there is none", and collapsing
them hides a stale pin.

**`rollbackBaseline` is resolved through the STORED LINEAGE.** A tenant-based candidate names the
row it supersedes, so the chain is walked (bounded, 8 hops) to the first `rollbackEligible` row; a
global-based candidate is a first customization whose baseline was written in the same transaction
at version 1, read by that *exact* version. Never "the newest archived row" — that guess is what
made `candidatesForReview` offer `v17 -> v16` in production. The test asserts the initial baseline's
hash **equals the pre-activation global hash**, which is the invariant that makes the whole rollback
story true rather than plausible.

### Task 2 — the runtime (`llm.ts` +75/−8, `dispatch.ts` +24, `evaluations.ts` +15, `smoke.ts` +62)

`runSpecialistTurn`'s load order is now: **exact tenant row (for its own skill name) → global
version pin → `getEffectiveSkill`**. A pin whose resolved row names a *different* skill throws
`TENANT_SKILL_PIN_MISMATCH` **before `generateText`** — a mis-wired harness costs $0 rather than a
model call plus an evidence row certifying the wrong skill. The test drives that with a mock that
throws if reached and asserts the daily rail is byte-unmoved.

The turn now returns `{skillScope, skillId, skillName, skillBodyHash}` beside the existing
`skillVersion`, hashed from **the exact string handed to the provider** — so the attribution cannot
describe a body that never ran. `governedDispatch` puts those four refs on the **existing**
`subagent.completed` audit row. Not a new event type, not a new table, not a second trace plane:
"which body did this specialist run" is a property of a run that is already logged, and
`audit.by_correlation` already reconstructs the tree.

`smoke.userSkillRuntimeAttribution` is the bounded read-only readback — fixed `.take()`, tenant
equality re-checked inside the loop because that index is deliberately cross-tenant (the guard and
the reason `researchTrailForThread` already carries), and a return type with no branch that can
produce a body, adaptation, prompt, reply or source URL.

The dispatch test builds a **three-way collision**: the tenant's ACTIVE overlay (what an unpinned
run loads), the pinned CANDIDATE, and *another tenant's* row at the same name and version. Nothing
short of the exact id can pick the right one, and the audit assertion is
`skillBodyHash === contentHash(candidateBody)` rather than a version number.

### Task 3 — the golden runner (`run-eval-golden.mjs` +915/−15)

`--tenant-skill <tenantSkillsId>` is multi-pin and orthogonal to `--skill`. Resolution happens
**before the inbox / vault / Blueprint seeds and before the first paid turn**, through
`skills:inspectTenantSkill` — **not** `getTenantSkillVersion` — precisely so the candidate BODY
never enters the runner process at all. The registry tenant is used for exactly two things: that
read and the evidence write. Every fixture plan, message, vault doc and assertion still belongs to
the throwaway `eval-<runId>` tenant.

`mergePinScopes` refuses a skill NAME pinned in both scopes, and two tenant rows of one skill. This
is load-bearing rather than tidy: both records are keyed by name into `runSpecialistTurn` and the
**tenant id wins there**, so a name in both scopes would leave the `--skill` pin doing nothing while
its evidence row still claimed the version ran.

The evidence rule became one named predicate so each clause is separately provable offline:
`allGreen && casesTotal > 0 && filters.length === 0`. **The `casesTotal > 0` clause closes a hole
that was open before this plan**: a zero-case run is `0 === 0`, i.e. "all green", and would have
written `0/0 pass` as an EVAL_GATE input. The over-cap/interrupted case is guarded by ORDERING
(`abortEnv` exits(2) from inside the case loop), and that ordering is asserted against the source —
because a rule that holds only because of where it sits is one refactor from being false.

`--inspect-tenant-skill` is dispatched **before** `runLive` and exits: no seed, no model, no write,
asserted three ways in `--self-check`. It carries `--json`, `--foreign-tenant`, and four
inspection-only expectation flags that exit nonzero on mismatch. The JSON's `deploymentHash` drops
the query string and fragment **before** hashing, because a deploy URL can carry a key and a hash of
a credential is still a thing you should not print next to the id it authorizes.

**Behaviour change every operator should know: unknown arguments now ABORT.** `--tenant-skil <id>`
used to buy a full UNPINNED ~$0.4 gate run and record nothing.

### Task 4 — the playbooks

`skill-registry.md` (+114) carries the registry semantics: the two pin scopes as a table, the exact
identity, the registry-tenant vs throwaway-data-tenant split, every no-evidence condition, the
dispatched handoff, both read-only commands and the free command. `agent-runtime.md` (+63) carries
the runtime and **explicitly takes over the real entry the 21-05 lane's claim-nothing date-bump
handed to this lane**, without re-litigating their bump. Both entries open by stating that no
Phase-21 candidate has passed live and that this plan authorizes no paid run.

---

## Mutation Ledger

Every mutation was applied, run, its verbatim red recorded, then reverted from a byte-exact
pre-mutation copy; `diff` against the copy confirmed no residue, and the suite was re-run green.

| # | Exact mutation | Observed red (verbatim) | Restored |
|---|---|---|---|
| **4** (ledger) Exact eval target | `recordTenantEvalEvidence`: `ctx.db.get(candidateId)` → find-by-name/version over `tenantSkills` | `FAIL … evidence lands on the EXACT row: the colliding same-name same-version row stays uncertified` — `AssertionError: expected false to be true // Object.is equality`; **1 failed \| 71 passed** | yes — 72/72 |
| **6** (ledger) Exact evidence identity | contracts: delete the `t.candidateId === target.candidateId` clause | **2 failed \| 70 passed** — `A's passing evidence COPIED onto B's colliding row still cannot certify B` and `myUserSkills.gatePassed reflects EXACT tenant evidence`, both `AssertionError: expected true to be false // Object.is equality` | yes — 72/72 |
| drop `tenantSkillIds` at one handoff | `dispatch.ts`: remove the field from `__runSpecialistWithScript`'s runner | `FAIL … subagent.completed carries EXACT refs-only attribution` — `AssertionError: expected 2 to be 3 // Object.is equality` (the fallback resolved the ACTIVE overlay, v2, not the candidate, v3); **1 of 77 failed** | yes — 77/77 |
| **12c** (ledger) drop/substitute the attribution id | `governedDispatch`: delete `skillId: turn.skillId` from `subagent.completed` | **2 failed** — `expected { ancestryDepth: +0, …(15) } to match object { skillScope: 'tenant', …(4) }` and `… { skillScope: 'global', …(4) }` | yes — 77/77 |
| **12c** (ledger) Runtime audit privacy | widen `runSpecialistTurn` with `skillBody` and log it on `subagent.completed` | `AssertionError: expected '[{"ancestryDepth":0,"depth":1,"envelo…' not to contain 'ZQ7CANDb51f3a0d9'`; **1 of 77 failed** | yes — 77/77 |
| **5** (ledger) Filtered evidence suppression | runner: delete `&& filters.length === 0` | `a --only run executes cases and records NO evidence (a tenth of the coverage is not the gate)` — `true !== false`; **exit 1** | yes — exit 0 |
| Zero-case evidence | runner: delete `&& casesTotal > 0` | ``ZERO cases is `0 === 0`, i.e. all green — it must not write `0/0 pass` as an EVAL_GATE input`` — `true !== false`; **exit 1** | yes — exit 0 |
| Both-scope pin collision | runner: delete the `existing === "global"` throw in `mergePinScopes` | `Missing expected exception: one skill cannot be pinned globally AND by row in the same run`; **exit 1** | yes — exit 0 |
| Deployment-hash credential leak | runner: `url.split("#")[0].split("?")[0]` → `url.trim()` | `the query string is dropped BEFORE hashing — a deploy URL can carry a key` + a full hex diff (`cfb6692…` vs `c79fb34…`); **exit 1** | yes — exit 0 |
| Unknown-argument guard | runner: delete the `KNOWN_FLAGS` throw | `Missing expected exception: a one-character typo must not buy a full unpinned gate run`; **exit 1** | yes — exit 0 |

### Two mutations that were GREEN on first attempt — and what that exposed

These are the entries most worth reading, because in both cases the mutation passing was a defect in
**my test**, not evidence that the code was safe.

1. **Ledger 4 (name/version selection) was initially GREEN.** My collision test recorded evidence on
   tenant **A**, who published *first* — so the mutated find-by-name/version lookup happened to
   return A's row anyway and the wrong-row failure was invisible. Fixed by certifying the
   **second-published** row (B) and asserting A stays evidence-free, plus the reverse direction so
   neither row is privileged by insertion order. Only then did the mutation bite.

2. **Ledger 6 (drop the candidate-id comparison) did not turn the copy test red as literally
   worded.** Copying A's evidence onto B's row disagrees on `registryTenantId` *as well as*
   `candidateId`, so the predicate still refused for a different reason — the test would have passed
   with the id check gone. Fixed by adding a forgery that agrees with B on tenant, name **and**
   version and disagrees only on which row ran. **Flagged rather than glossed**, per the 21-02
   precedent for a mutation that cannot be applied as literally worded.

### Anti-vacuity

No zero/absence assertion in this plan stands alone:

- "B stays evidence-free" sits beside B *being* certified in the other direction, and beside
  `A.evidence !== B.evidence` proving one write did not overwrite the other.
- the inspector's needle scan (no `NEEDLE_A`, no `NEEDLE_B`, no `GLOBAL_BODY`, no section marker,
  no `AUTHORED_A`) ends with `expect(serialized).toContain(snap.candidate.bodyHash)` and
  `toContain(String(idA))` — proof the scan actually read the payload.
- the audit privacy scan over every payload on the lineage ends with the same two positive
  witnesses, plus the dead-letter plane.
- "the pinned candidate reaches the model" sits beside an **unpinned** capture that receives the
  ACTIVE overlay byte-for-byte, and `pinned.system !== unpinned.system`.
- the tenant readback's two `null`s (wrong tenant, unknown correlation) sit beside the exact
  five-field object returned for the right pair.
- `--self-check`'s filtered-evidence suppression assertion sits directly beneath
  `applyOnly(fixtures, ["research"]).length === 3` — so "no evidence" is suppression, not an empty
  run.
- the `hasPassingTenantEvidence` refusals sit beside `hasPassingTenantEvidence(evidence, targetA) === true`
  on the same bytes.
- the `--self-check` source-order probes use `lastIndexOf`, because an `indexOf` finds the copy of
  the anchor sitting in the self-check's own text — the 21-02 `</HeaderMenu>` vacuity in another
  shape. This was caught while writing it: the first version of the probe matched itself and
  reported the evidence block as preceding the cost cap.

---

## NOT DONE AND NOT CLAIMED

**SKILL-01 is deliberately not marked complete.** Concretely, as of `490d5a0`:

- **NO PAID EVAL WAS RUN. $0.00.** No `--skill` pin, no `--tenant-skill` pin, no fixture executed
  against a model. The standing do-not-rerun order was honoured; the only eval invocation is the
  free `--self-check`. **`--tenant-skill` has never executed end to end against a real deployment.**
  Its parsing, merge, eligibility, suppression and evidence-shape logic are proven **offline**; the
  Convex reads it makes (`skills:inspectTenantSkill`, `skills:recordTenantEvalEvidence`) have been
  exercised only through `convex-test`, never through `npx convex run`. **A first live invocation
  could still fail on CLI/serialization grounds this plan cannot see.** That is 21-07's.
- **No tenant candidate has passing evidence anywhere except in a test.** `gatePassed` has only ever
  been observed as `false` in production, and `tenantSkills.evidence` is unset on every real row.
- **21-02's finding is UNCHANGED: no tenant row can become `active` through any code path.** There
  is still no tenant activation and no tenant rollback; `activateSkillVersion` still only knows the
  global `skills` table. Every test here that needs an active overlay **patches the row directly**,
  and the panel's "Live" copy remains unreachable. 21-04 owns all of it. **Evidence is not
  activation** — the runner prints that sentence after every tenant evidence write, deliberately.
- **`inspectTenantSkill` and `userSkillRuntimeAttribution` have no UI and no owner gate.** Both are
  `internalQuery`s reachable only by trusted server code / `npx convex run`. They are operator
  commands, not product surface, and this plan added no ops panel.
- **`--inspect-tenant-skill`'s printed output has never been seen against a real row.** The JSON
  shape, the `deploymentHash`, the expectation exit codes and the foreign-collision refusal are all
  proven against in-memory snapshots in `--self-check`. The first real run is 21-06's.
- **The `deploymentHash` proves SAMENESS, not identity.** It is a hash of whatever
  `CONVEX_URL`/`NEXT_PUBLIC_CONVEX_URL`/`CONVEX_SELF_HOSTED_URL`/`.env.local:CONVEX_DEPLOYMENT`
  happens to be set to in the *runner's* process. It does not prove the `npx convex run` child
  actually reached that deployment — the CLI resolves its own target. Two inspections agreeing is
  evidence they were configured the same, not proof they hit the same backend.
- **No browser proof, no Playwright spec, no UAT.** Nothing user-visible changed except the
  `myUserSkills.gatePassed` fix, which has no test beyond the backend suite.
- **The RETRY_TURN change on the paid `attemptCase` turn was not run, re-measured, endorsed,
  reverted or restaged.** It was another lane's, already committed (`4ea300c`) when this plan
  started. My edit touches the same statement — I added `...tenantPinArg` to that call's argument
  object — and left `RETRY_TURN` and its rationale byte-unchanged. Its load-bearing assumption (an
  empty stdout with no failure banner can ONLY be the `UV_HANDLE_CLOSING` teardown crash) remains
  unexamined here.
- **`skillBodies.test.ts`'s no-drift list was not consulted, because no skill body was edited.**
  This plan changed zero `.md` files under `packages/contracts/skills/` and zero derived constants.
  The `cockpit-agent` drift hazard does not apply.
- **`packages/backend/convex/_generated/api.d.ts` is dirty in the shared tree and was NOT staged.**
  Its diff is 2 lines, both `savedPrompts` — entirely the 21-05 lane's, none of mine. Codegen, not
  authored.
- **`graphify-out/` was not staged.** Shared generated artifact carrying other lanes' state.
- **The one remaining `run-eval-golden.mjs` biome format error is PRE-EXISTING**, in the same two
  regions as at HEAD (`BLUEPRINT_NEEDLE`, `attemptCase`). I did not fix it — it is not mine and
  reformatting a contended file mid-session is the interference this tree keeps punishing.

---

## Deviations

**Rule 1 (bug) — `myUserSkills.gatePassed` asked the GLOBAL predicate of a TENANT row.** Found while
wiring the tenant predicate: `hasPassingEvidence(r.evidence, r.name, r.version)` reads
`skillVersions[name]`, and a tenant-only run's `skillVersions` is `{}` — so a genuinely certified
candidate would have read `false` forever and the panel's "Evaluation passed" copy was unreachable
for the same reason "Live" is. One line, plus a test asserting both directions (it flips true on a
correct write, and back to false when the evidence names another row). Files:
`packages/backend/convex/skills.ts`. Commit `ce04642`.

**Rule 2 (missing critical functionality) — the runner ignored unknown arguments.** `agent-runtime.md`
documents this as a known hazard ("Do not run `--list`. There is no such flag; unknown argv is
ignored"). Combined with a new `--tenant-skill` flag, a one-character typo would buy a full
UNPINNED ~$0.4 gate run and record nothing. Added `assertKnownArgs` as the first statement of the
entry block, with a mutation proof. This is a paid-spend guard, which §8 exempts from laziness.
Files: `packages/backend/scripts/run-eval-golden.mjs`. Commit `6cd236b`.

**Rule 2 (missing critical functionality) — the zero-case evidence hole.** The plan asks for "zero
case … records none". The shipped condition `allGreen && pins.length && !filters.length` writes
evidence on a zero-case run, because `0 === 0` is all-green. Closed in `shouldRecordEvidence` with
its own mutation proof. Same file/commit.

**Rule 3 (blocking) — `getTenantSkillVersion` had to return `status` and `author`.** The plan's
stated return is body/version/skillId/name/tenantId, but the same plan requires the runner to refuse
non-candidate / non-user ids at $0 and gives it no other read. Rather than widen that read further,
the runner resolves through `inspectTenantSkill` (refs-only, no body in the runner process) and the
two extra fields exist for any other trusted caller. Flagged rather than silently absorbed.

**Rule 3 (blocking) — the `rollbackBaseline` shape needed three fields `SkillRefs` does not carry.**
`tenantId`, `author` and `rollbackEligible` are exactly what an operator asks of a row they are
about to restore, and the plan's own snapshot spec lists them. A second, wider shape (`baselineRefs`)
rather than widening `SkillRefs`, which would have put a `tenantId` on the global row.

**Rule 3 (blocking) — my own first `--self-check` source probes matched themselves.** `indexOf` for
`"function attemptCase("` and `"function abortEnv"` found the copies inside the self-check's own
text, so the ordering assertion was about its own source. Fixed with `lastIndexOf` plus a slice, and
the reason is written into the code so nobody "simplifies" it back. Noted because the shipped
`blueprintSeedAt` probe above it has the same latent shape — I did not touch it.

**Rule 3 (blocking) — backend typecheck OOM, then a real error.** `pnpm typecheck` died three times
with `FATAL ERROR: Zone Allocation failed / MarkCompactCollector … out of memory` (exit 134, **zero
tsc diagnostics**) under concurrent-lane memory pressure — the known 21-01 flake. It later ran
normally and surfaced ONE real diagnostic (the TS2339 above), which was fixed. Final: exit 0, twice.

**Rule 3 (blocking) — CRLF and a `git stash` round-trip.** `llm.ts`, `evaluations.ts` and
`run-eval-golden.mjs` are CRLF in this tree; a naive `\n`-anchored patch silently no-ops (the
recorded hazard) and biome reports the whole file as a format error. All scripted edits were made
CRLF-aware. Separately, a `git stash push/pop` I used to take a biome baseline converted
`skills.test.ts` to CRLF; normalised back to LF before committing. **This is why the biome table
above states its normalisation.**

**No Rule 4 deviations.** Nothing architectural was in question: no new table, no new index, no new
event type, no new dependency, no second log plane. The one judgement call — where the runtime
attribution should live — resolved onto the existing `subagent.completed` row, which is what the
plan asked for.

**Process — `21-03-PLAN.md` was untracked.** Committed in `490d5a0` alongside the playbooks (the
21-01/21-02 precedent) so code does not land ahead of the plan authorizing it. **Only**
`21-03-PLAN.md`; 21-04/06/07 remain untracked and untouched.

---

## Shared-tree conduct

- **No `git add -A` / `git add .` / `git add <dir>` was run.** The only `git add` was one explicit
  path (the untracked plan file), immediately followed by a pathspec commit **in the same shell
  invocation** to close the race window.
- Every commit used `git commit -- <explicit paths>`, which takes those paths from the working tree
  and ignores the rest of the index.
- `.git/MERGE_HEAD` was checked before every commit and was absent every time.
- All four commits were verified with `git merge-base --is-ancestor <sha> HEAD` immediately after
  each one, **and again after this summary was written**. None fell out; nothing needed re-applying.
- `git diff --cached --stat` after the final commit: **empty**. No foreign file entered any commit —
  each `git show --stat` lists only my own paths.
- **`docs/playbooks/cockpit.md` was NOT touched** (21-05's). `agent-runtime.md`'s existing
  claim-nothing date-bump entries were left byte-unchanged; my entry was **prepended**, and both
  playbook diffs are additive (177 insertions, 1 deletion line in the diff header only —
  `git diff | grep -c "^-"` → 1, the `---` file marker).
- `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`,
  `packages/backend/convex/_generated/api.d.ts` and `graphify-out/` were **not modified or staged**.

---

## Graph

`graphify update .` rebuilt **15957 nodes / 18300 edges / 1601 communities**;
`node scripts/extract-convex-edges.mjs` re-injected **+436 convex edges, +65 table edges (39 tables)**
and removed 9385 noise nodes. `graphify-out/` was **not staged**.

---

## State handoff (NOT written — other lanes own these files)

`.planning/STATE.md` and `.planning/ROADMAP.md` both carry other lanes' uncommitted edits, so I did
not touch or stage either. What I would have written:

- **STATE.md** — Current Plan advances 21-03 → 21-04; Stopped At: `Completed 21-03-PLAN.md`; add
  decision: *"21-03: eval evidence for a tenant skill binds the ROW ID, not `name@version` — two
  tenants can hold the same pair, and every identity field is compared."*; add decision:
  *"21-03: runtime skill attribution rides the EXISTING `subagent.completed` audit row as refs +
  SHA-256 body hash — no new event type, no new table, no body."*; add decision: *"21-03: the eval
  runner records evidence only on an all-green, NONEMPTY, unfiltered run, and unknown arguments now
  abort at $0."*
- **ROADMAP.md** — Phase 21 plan progress 3/7 → 4/7 complete (21-05 also landed in parallel; the
  count should be reconciled against SUMMARY files on disk rather than incremented blindly). Phase
  status stays in-progress.
- **REQUIREMENTS.md** — **SKILL-01 stays OPEN.** Owner activation and rollback (21-04), the browser
  checkpoint (21-06) and the live paid proof (21-07) are all outstanding.
- **21-VALIDATION.md** — rows `21-03-01` … `21-03-04` can move from ⬜ pending to ✅, with the
  mutation ledger above as evidence. Ledger rows 4, 5, 6 and 12c are all discharged; rows 4 and 6
  carry the "green on first attempt" notes above and should not be read as clean passes. **I did not
  edit this file** — it is dirty in the shared tree.

---

## Next

**21-04** is the plan that makes any of this reach a user: there is still no way to activate a
tenant row, so a candidate with passing evidence changes nothing. It should route through one shared
transition helper and read `hasPassingTenantEvidence` against the row's own identity —
`inspectTenantSkill` already returns exactly the `gatePassed` boolean that gate needs, and
`rollbackBaseline` already names the evidence-exempt target.

**21-07** owns the first paid `--tenant-skill` run. Before spending: pin the `deploymentHash` from
`--inspect-tenant-skill --json` *before* the gate, run the gate, and pin it again after — that pair
is what this plan built it for. Budget the full unfiltered gate (~$0.35–0.45 measured historically),
and note that a filtered or zero-case run will now correctly refuse to record anything.

## Self-Check: PASSED

- `packages/contracts/src/skill.ts` — FOUND (+61 in `ce04642`)
- `packages/backend/convex/skills.ts` — FOUND (+279 / −2)
- `packages/backend/convex/skills.test.ts` — FOUND (+378 in `ce04642`, +5/−1 in `d2374bf`)
- `packages/backend/convex/llm.ts` — FOUND (+75 / −8 in `d2374bf`)
- `packages/backend/convex/dispatch.ts` — FOUND (+24)
- `packages/backend/convex/dispatch.test.ts` — FOUND (+250)
- `packages/backend/convex/evaluations.ts` — FOUND (+15 / −3)
- `packages/backend/convex/smoke.ts` — FOUND (+62)
- `packages/backend/scripts/run-eval-golden.mjs` — FOUND (+915 / −15 in `6cd236b`)
- `docs/playbooks/skill-registry.md` — FOUND (+114, zero deletions)
- `docs/playbooks/agent-runtime.md` — FOUND (+63, zero deletions)
- `.planning/phases/21-user-authored-skills-and-routines/21-03-PLAN.md` — FOUND (310 lines, newly tracked)
- Commits `ce04642`, `d2374bf`, `6cd236b`, `490d5a0` — all four verified with
  `git merge-base --is-ancestor <sha> HEAD` **after this summary was written**
