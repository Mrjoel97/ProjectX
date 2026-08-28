# 29-05 FIX — Summary

**Commit:** `e9c9d87` — `fix(29-05): the pack gate has no tenant lane, so the tenant lane fails closed`
**Branch:** `feat/29-unified-knowledge` (worktree `C:/Users/expert/AppData/Local/Temp/pikar29`)
**Files committed (10, all owned by this plan):**

```
packages/core/src/workflowCustomization.ts
packages/core/src/workflowCustomization.test.ts
packages/backend/convex/skills.ts
packages/backend/convex/skills.test.ts
packages/backend/convex/workflowPackBinding.ts
packages/backend/convex/workflowPackBinding.test.ts
packages/backend/scripts/run-eval-golden.mjs
docs/playbooks/skill-registry.md
docs/playbooks/workflow-packs.md      (CLAUDE.md §9 — watches workflowPackBinding.*)
docs/playbooks/agent-runtime.md       (CLAUDE.md §9 — watches run-eval-golden.mjs)
```

I inherited nothing: at resume the working tree held only the two siblings' uncommitted work
(FIX-06's knowledge*/llm/llmRedaction/auditProjection/core-knowledgeSearch). I did not read, edit or
stage any of it. `git diff --stat HEAD -- "*.ts" "*.mjs"` after committing shows only those sibling
files — none of mine.

---

## What each finding got, and the mutation I watched go RED

Every mutation below was applied to the real implementation, the suite run, the failure observed,
and the file restored from a byte copy taken before the mutation.

### [BLOCKER / MAJOR ×3] A tenant pack prompt could go live through the weaker gate

`planTenantActivation` (skills.ts) now refuses **every `pack-*` name, in every mode including
rollback**, with `PACK_GATE`, before the mode branch and before any evidence is looked at.

This is deliberately **not** "apply the same three planes here", and the summary should say why
plainly: `tenantSkills` has **no `provenance` column and no `browserEvidence` column**, and
`hasPassingPackEvalEvidence` has no tenant-scoped runner to satisfy it. Two of the three planes have
nowhere to be written. Running a weaker subset and calling it the gate is the exact defect being
fixed, so the tenant lane **fails closed** instead. Rollback is included because nothing pack-named
can ever have been live, so no incident-time recovery is blocked.

Consequence, stated honestly: **a tenant pack customization can never be activated.** It is a dark,
immutable, reviewable candidate that can be listed, inspected, superseded and RUN under a pin — and
never becomes the body `loadEffectiveSkill` serves by default. That is now the posture in code and
in the playbook, replacing the prose mitigation.

- New test: *"a pack-named TENANT candidate with Phase-21 evidence is still REFUSED"* — publishes
  through the real mutation, writes the byte-shape `run-eval-golden.mjs --tenant-skill` writes,
  asserts `hasPassingTenantEvidence` **would** have accepted it (non-vacuity), then owner-activates
  and expects `PACK_GATE`; then asserts the row is still `candidate`, `loadEffectiveSkill` is still
  `scope: "global"` with the global body, and rollback is refused too.
- New test: *"the Phase-21 tenant lane is UNCHANGED"* — a non-pack (`offer-architect`) tenant
  candidate with the same evidence shape still activates. This is the control that the new branch is
  name-scoped rather than a blanket refusal. The **global** lane's control already exists in this
  file (*"activation succeeds once all three planes pin the exact version"*) and stays green.
- **MUTATION MS2:** `if (isWorkflowPackSkill(row.name))` → `if (false && …)` →
  **RED**, 2 tests (the new one plus *"a candidate cannot self-activate"*).

One pre-existing test changed expectation: *"a candidate cannot self-activate"* asserted `EVAL_GATE`
on owner activation; the blocker is now the **stricter** `PACK_GATE`, which fires on the name before
evidence is read. Updated with a comment saying so, not silently.

### [MAJOR] run-eval-golden.mjs:954 — the certification door

`assertEvaluableCandidate` checked author and status only. Added a `pack-` name refusal, throwing at
$0 before any seed or model call.

- **This is a SOURCE SCAN test, and it proves spelling, not behaviour.** `run-eval-golden.mjs` has
  zero exports and runs its own `main` on import, so there is nothing callable to drive. The test
  slices out the function body and asserts the refusal is present; the *behavioural* gate for this
  hazard is `planTenantActivation` above, which is fully driven. The test says this in its comment.
  The precedent is the existing runner scan at skills.test.ts:892.
- **MUTATION MS5:** `if (typeof c.name === "string" && c.name.startsWith("pack-"))` → `if (false)` →
  **RED**.

### [MAJOR] skills.ts:1524 — a test that could not fail on the derived registry name

The derivation `const name = \`pack-${customizationSchema.templateId}\`` is the channel's whole
authorization claim, and 14 tests all published `templateId: "business-pulse"`.

- New `describe` block: a literal `[id, name, thresholdKey, value]` table for all six packs, plus a
  test that the table's ids and names equal `WORKFLOW_PACK_IDS` / `WORKFLOW_PACK_SKILL_NAMES` so a
  seventh pack cannot slip past it. `test.each` drives the real mutation for each pack against a
  six-pack seeded harness, asserting the returned `name` as a **literal**, the row names, the
  `templateId` on the row, and that the pack's own threshold value reached the rendered body.
- Second test: each pack refuses the other five packs' threshold keys as `unknown_field` (30 cases),
  and writes nothing. This is what makes the per-pack schema differences travel through validation,
  composition, hashing and the audit row rather than only through `business-pulse`.
- **MUTATION MS1:** `const name = "pack-business-pulse";` → **RED, 5 tests** (previously 0).

### [MINOR] skills.ts:1846 — tenant isolation on the pin rail — PARTIALLY CLOSED, read this

`getTenantSkillVersion` resolves a row **by id** and the only downstream guard is
`row.name !== skillName`. A name check is not a tenant check: two tenants can each own
`pack-business-pulse`, which is the entire reason the pin is a row id.

`runPackTurn` now compares `row.tenantId` to the run's tenant for every entry of `tenantSkillIds`,
before `preCall` and before any event row is written, and throws `TENANT_SKILL_PIN_FOREIGN`.

- New test: *"ANOTHER TENANT'S row id cannot be pinned"* — tenant B owns a row with the **same name**
  (so the name check demonstrably is not what saves it), tenant A's run is refused, no
  `workflowPackEvents` row exists for it, and the **positive control** is the identical call with
  tenant B as the runner resolving `skillVersion === 7`.
- **MUTATION MB2:** `if (row.tenantId !== tenantId)` → `if (false && …)` → **RED**.

**WHAT I DID NOT CLOSE.** The root fix is a required `tenantId` arg on `getTenantSkillVersion`
itself, which would also close the pre-existing `dispatch`/`runSpecialistTurn` surface
(`llm.ts` ~L4988, attributed to 21-03, not to 29-05). That is a one-argument, one-comparison change
in **llm.ts, which FIX-06 owns this wave**, so I did not make it. My fix closes the caller surface
29-05 added and nothing more. Recorded as a follow-up below and in both playbooks.

### [MINOR] workflowPackBinding.test.ts:666 — the grant test never reached its scenario

It asserted only that the executed tool record equals `toolsForWorkflowPack`, which is true whether
or not the tenant body ever ran — deleting the entire `tenantSkillIds` feature left it green.

It now asserts `res.skillVersion === 7` on **every** probe chunk (the candidate is seeded at 7, the
global fixture is 1), which is only readable if the pin reached the loader.

- **MUTATION MB1:** removed the `...(args.tenantSkillIds === undefined ? {} : {...})` spread from
  `runPackTurn` → **RED**, and the grant test is now among the failures (it was not before).

### [MINOR] skills.ts:1531 — a sixth failure mode that threw

`readTenantPublishState` → `loadSkill` throws `NO_ACTIVE_SKILL`, and `seedPackCandidates` writes all
six packs as `candidate`, so a seeded-but-not-yet-activated pack 500s the tenant's form. Now a sixth
governed refusal, `template_not_active`, returned as data, checked before `readTenantPublishState`.
The docstring now says SIX and the playbook's numbered list gained the entry.

- **MUTATION MS3:** `if (active === null) return …` → `if (active === null && false) …` → **RED**.

### [MINOR] skills.test.ts:4754 — "the widest legal form" hardcoded its input

Input is now **derived** from `packCustomizationFields("business-pulse")` (free-text fields filled to
`min(field.maxBytes, 4000)`, the longest tone option, `field.max`, all sources), with two non-vacuity
assertions that the derivation really produced 400/1200. The **oracle stays the literal 4000**.

- **MUTATION MS4:** `maxBytes: 400` → `4000` in `packCustomizationFields` → **RED**. The old
  hardcoded form was verified green under exactly this mutation by the verifier.

### [MINOR] workflowCustomization.ts:112 — `values` was an unbounded untrusted map

Added `CUSTOMIZATION_CAPS.maxSubmittedKeys: 24` (layer 0, checked before any key is read) and
`keyMaxBytes: 64` (every echoed key is clamped). Over the key cap returns **one** error with an
**empty** key — enumerating the offending keys is the amplification the cap exists to stop. Added
`too_many_fields` to `CUSTOMIZATION_REJECTIONS` and to the literal enum pin.

- Two new tests; 24 and 64 are **literals** (the file imports the caps, so a constant-valued oracle
  would move with the subject). The flood case asserts the whole serialized error is < 120 bytes.
  Byte-not-character truncation is asserted with astral characters, and a declared key is asserted
  unchanged.
- **MUTATION M1:** `maxSubmittedKeys: 24` → `24_000` → **RED**.
  **MUTATION M2:** `clampKey` early-returns unchanged → **RED**.

### [MINOR] workflowCustomization.ts:430 — a duplicated traversal

`packReadableSources` now reuses `packPreflight(id, {})` and filters to `REACHABLE_PACK_SOURCES`,
with a `ponytail:` comment naming the ceiling (an `existing` operation reading a non-reachable source
would be dropped — the six literal source lists in the core test are what guards that).

- **MUTATION M3:** dropped the filter → **RED, 4 tests**.

### [MINOR] docs/playbooks/skill-registry.md — three false claims corrected

1. *"no text that reaches a body"* — **false**. `business_terms` (400 B) and `extra_guidance`
   (1200 B) are declared free-prose fields rendered verbatim into `tenantSkills.body`. The table cell
   now states the real, narrower property (bounded to 1600 B vs the free-text door's 4000,
   content-scanned, confined to declared keys) and an explicit **CORRECTION** block says a pack
   candidate still needs prompt-content review. The same false claim in the `skills.test.ts` describe
   header and in `publishPackCustomization`'s docstring is corrected in the same words.
2. *"all five come back as DATA, never as a throw"* — corrected to six, with the sixth described.
3. *"a tenant pack candidate cannot be certified in practice … do not paper over it by relaxing the
   activation gate"* — replaced by a **THE PACK GATE HAS NO TENANT LANE** section that states what
   was actually wrong (both doors), what the code now does, what a real tenant pack lane would
   require, and the six mutations that must go red.

---

## Verification

| Suite | Result |
| --- | --- |
| `packages/core` full (`pnpm vitest run`) | **45 files / 1457 passed** (baseline 45/1437; +2 mine, +18 FIX-06's uncommitted core/knowledgeSearch work) |
| `packages/backend` — `skills.test skillBodies workflowPack dispatch evaluations importGuard` | **9 files / 538 passed** |
| `packages/backend` `skills.test.ts` alone | **170 passed** (was 158; +12) |
| `packages/backend` `workflowPackBinding.test.ts` alone | **39 passed** (was 38; +1) |
| `cd packages/core && pnpm typecheck` | clean |
| `cd packages/backend && pnpm typecheck` | clean |
| `echo '{}' \| node scripts/check-playbooks.mjs check` (dirty tree, pre-commit) | blocks only on `cockpit.md` (llm.ts) and `audit-dead-letter.md` (auditProjection.ts) — **both FIX-06's files, not mine** |
| `npx biome format` on my 10 files | clean (skills.test.ts reformatted, then re-run green) |

I did **not** run the whole backend suite: the tree carries two siblings' uncommitted in-flight work,
so a backend total is not comparable to the 111/3033 baseline and any red in it would be
unattributable. I ran the files my changes can reach, which is the comparison that means something.

Nothing was run that needs a live deployment, a Convex CLI or an OpenAI key. $0 spent.

**Verify-the-commit check:** `git diff --stat HEAD -- "*.ts" "*.mjs"` lists only FIX-06's eight files;
none of mine. Both typechecks ran against a tree that also contained FIX-06's work — my files are
byte-identical to HEAD and I changed no signature that `llm.ts` consumes, so HEAD compiles on my
account, but a clean-checkout typecheck of HEAD alone was not possible while the siblings are dirty.

---

## Follow-ups I am handing off, not closing

1. **FIX-06 / llm.ts:4973-4976** — the comment *"only the three USER_AUTHORABLE_SKILLS can have an
   overlay row at all, so every other specialist name resolves exactly as before"* is **false** and is
   the load-bearing premise under the blocker. `pack-*` names carry overlay rows now. The correct line
   is **4973-4976** (`grep -n "overlay row at all"` returns one hit; there is nothing at the 5006 the
   original 29-05 summary cited). The code is right; only the comment is wrong.
2. **FIX-06 / llm.ts ~L4988** — thread `tenantId` into
   `ctx.runQuery(internal.skills.getTenantSkillVersion, { candidateId: tenantPin })` and make the arg
   required on the query, with a `row.tenantId !== tenantId` refusal. That is the root fix for the pin
   rail and also closes the pre-existing `dispatch.ts` surface (21-03). One argument, one comparison.
   Until then the dispatch pin surface remains unscoped — **this is an open isolation gap**, narrowed
   but not closed by my change.
3. **A real tenant pack lane**, if the product ever wants one: two evidence columns on
   `tenantSkills`, a `--tenant-skill` mode in `run-workflow-pack-evals.mjs`, a browser-evidence path,
   and a tenant-scoped `assertPackActivationEvidence`. Not deleting the branch.
4. **The pack pin rail is now the only way a tenant's customized body can execute.** If a UI is ever
   built for pack customization, it needs a "preview this customization" path through
   `runWorkflowPack` + `tenantSkillIds`, or the form writes rows nobody can use.
