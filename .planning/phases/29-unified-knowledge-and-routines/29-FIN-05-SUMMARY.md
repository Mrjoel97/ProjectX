# 29-FIN-05 — the pack candidate was never dark

Commit: `290647b`. Six files, 178 insertions / 62 deletions, all prose except two
test additions. **No behaviour changed.**

## Item 2(a) — the decision, and why

`skills.ts:1544` claimed a row minted by `publishPackCustomization` was "DARK BY
CONSTRUCTION" and "can never become the body a specialist runs". The
`tenantSkillIds` pin rail resolves a `pack-*` `tenantSkills` row into
`runSpecialistTurn`, and 29-05's own passing test (`workflowPackBinding.test.ts`,
"the pinned CANDIDATE body runs, not the tenant's effective one") runs one and
reads version 7 back.

I was offered two resolutions. **I took the second: delete the absolute, document
the door.** The reason is that closing the pin rail would have made
`publishPackCustomization` a form that writes a row nothing can ever read —
`planTenantActivation` refuses activation in every mode, `run-eval-golden.mjs`
refuses a pack row as a `--tenant-skill` target, so a pin is the only remaining
way a customization body reaches a model. Closing it deletes a shipped
capability; deleting the sentence costs nothing true.

What the door is bounded by (now stated in `skill-registry.md` under "The pin
door IS open, and this is what governs it", and verified rather than assumed):

| Bound | Where | Verified how |
| --- | --- | --- |
| Internal only | `runWorkflowPack`, `__runWorkflowPackWithScript`, `dispatchArgs`' four, `runCockpitAgent` | read every registration: all `internalAction` |
| Tenant-scoped | `runPackTurn` before `preCall` | existing two-tenant test |
| Name-scoped | `runSpecialistTurn` `TENANT_SKILL_PIN_MISMATCH` | existing test |
| No grant | `toolsForWorkflowPack` | existing behavioural probe |
| **No state** | **added this pass** | new assertions + red mutation |

## What I made TRUE (new assertion, with its red mutation)

`workflowPackBinding.test.ts` — the pinned run now re-reads the row afterwards
and asserts `status === "candidate"`, `evidence === undefined`,
`rollbackEligible === false`. Running a pinned candidate must not be a back door
into the status `PACK_GATE` refuses.

**MUTATIONS OBSERVED RED (both reverted, both verified by running):**

1. `runPackTurn` calls `internal.skills.recordTenantEvalEvidence` on the pinned
   row → `expect(after?.evidence).toBeUndefined()` FAILED with `"MUTATION"`.
2. `getTenantSkillVersion` throws on `isWorkflowPackSkill(row.name)` (i.e. the
   door is closed) → "the pinned CANDIDATE body runs" FAILED. This is the test
   that goes RED if the door changes state, as item 2(a) required; the test
   header now says so explicitly, so a future closer knows the red is the alarm
   and not a nuisance.

## What I DELETED (no mutation needed — these are removals)

- `skills.ts:271` "Two things differ from the global scope **and only two**" —
  the pack refusal is a third. Now an open list with the third named.
- `skills.ts` "a pack-named tenant row **cannot be activated AT ALL** … because
  nothing pack-named **can ever** have been live to roll back to" → replaced by
  the mechanism that makes it so (the throw sits ahead of the mode switch; the
  module's single `status: "active"` patch routes every tenant target through
  this function), citing the existing test that counts that patch.
- `skills.ts` "refuses **every** `pack-*` name outright" (×3 sites incl. the
  playbook) — the code calls `isWorkflowPackSkill`, which is membership in
  `WORKFLOW_PACK_SKILL_NAMES`, **not** a `pack-` prefix match. Said what the code
  does. (This matters: `run-eval-golden.mjs` really does prefix-match, so the two
  gates have different sets, deliberately, and the prose hid that.)
- `skills.ts` "**There is no code path** from this function to an activation
  function" on `insertTenantUserCandidate` — unenforced: the region scan in
  `skills.test.ts` covers `publishAgentCandidate` only. Deleted; the surviving
  sentence describes the literal and cites the module-wide patch count.
- `skills.ts` the whole "DARK BY CONSTRUCTION … can never become the body a
  specialist runs" paragraph (item 2(a)).
- `skills.test.ts:4211` "**Both** overlay doors refuse before any read today" —
  falsified by this FIX's own subject. Now names the third door
  (`publishPackCustomization`) and points at the test that actually stops it.
- `workflowPackBinding.ts:200` "**every caller** of `tenantSkillIds` is trusted
  server code" — a repo-wide survey claim. Replaced with the two entry points in
  this file, which a reader can check twenty lines down.
- `workflowPackBinding.ts:204` the citation `llm.ts:4988` — at HEAD it is 4996.
  Line number dropped, symbol named instead (`runSpecialistTurn`). Same for the
  playbook's `llm.ts ~L4988`.
- `workflowPackBinding.ts:148` "because `activateTenantCandidate` demands
  evidence pinning the exact row, a schema-driven pack customization could never
  leave `candidate` at all" — stale since the PACK_GATE fix, which refuses it
  whatever the evidence says. The rail's actual purpose is stated instead.
- `skill-registry.md` "all six come back as DATA … and **none of them carries
  user text**" — FALSE: `invalid_values` returns `{key, reason}` rows whose `key`
  is the caller's own submitted string, clamped to
  `CUSTOMIZATION_CAPS.keyMaxBytes` (64). Now says which of the six carries what,
  and states the property to preserve when a seventh is added.
- `workflow-packs.md` "That makes this pin rail the **ONLY** way a tenant's
  customized pack body can execute at all."

I also checked my own replacement prose for the failure mode this pass exists to
stop, and tightened two absolutes I had just written ("`loadEffectiveSkill` never
resolves that row" → the mechanism plus the test that asserts it; "for every pack
name" → "for every name in `WORKFLOW_PACK_SKILL_NAMES`").

## Item 6 — recorded, not fixed

`run-eval-golden.mjs`'s `pack-` refusal is proven by a **source-text scan only**
(`skills.test.ts:5041`). The script has zero exports and runs `main` on import,
so there is nothing to call; a short-circuit above the check that preserved the
scanned substring would neutralise it while green. The ceiling is now stated in
`skill-registry.md`: the behavioural gate for that hazard is
`planTenantActivation`, which IS driven end to end, and the scan is drift
detection on a $0 convenience, never the gate. **`run-eval-golden.mjs` is in my
ownership list and my diff does not touch it — that is the instruction ("RECORD,
DO NOT FIX"), not an oversight.** `packages/contracts/src/skill.ts` is likewise
untouched: I read `USER_AUTHORABLE_SKILLS`' docstring (:350-374) and it is
accurate — it correctly says the packs were NOT added and explains why. The false
"Phase 29 widened `USER_AUTHORABLE_SKILLS`" claim is in `llm.ts:4975-4984`,
`cockpit.md` and `knowledge-search-routines.md`, none of which I own.

## WHAT I LEFT OPEN

1. **The channel is not end-to-end, and I did not close it.** No production
   caller passes `tenantSkillIds` for a pack. `cockpit.ts` is the only caller of
   `runWorkflowPack` and it passes `skillVersions` (a global, owner-only preview
   pin) and nothing else. So a tenant can fill in the customization form, the row
   is written, and **production never reads it**. Closing that means deciding who
   may pin — most plausibly the tenant's own newest candidate on their own run —
   which is a product decision, not a comment fix. Stated in `skills.ts`'s
   docstring, in the test header, and in both playbooks.
2. **`packages/core/src/workflowCustomization.{ts,test.ts}` — reverted, and this
   is the one thing I would hand to the next agent verbatim.** I wrote and
   VERIFIED a small test ("no SHIPPED pack declares a key the rejection clamp
   would truncate": iterate `WORKFLOW_PACK_IDS`, `customizationSchemaFor(id, 1)`,
   assert every declared key is `< 64` bytes as a LITERAL, non-vacuity
   `seen.length > 17`). It closes the unenforced claim added in-range at
   `CUSTOMIZATION_CAPS.keyMaxBytes` ("Declared keys are all far shorter, so this
   only ever truncates a key nobody declared"), and **I observed it RED** by
   renaming `business_terms` to a 75-byte key (`expected 75 to be less than 64`).
   I also dropped two stale citations there (`llm.ts:1840/:5424`,
   `dispatch.ts:234/:256`). **I reverted all of it** because
   `docs/playbooks/watch.json` maps `packages/core/src/workflowCustomization` to
   `knowledge-search-routines.md`, which 29-06 owns this wave — any edit to those
   two files obliges a bump to a sibling's playbook. Copies of both edited files
   are at `/tmp/wcs.keep` and `/tmp/wct.keep` in this session's shell; the diff is
   ~20 lines and reproducible from this paragraph.
3. **The root fix for the unscoped pin read** stays open, as 29-05 recorded: a
   required `tenantId` arg on `skills.getTenantSkillVersion` would close the
   dispatch surface too, and needs `llm.ts`.
4. **The §9 gate cannot read clean for anyone in this shared tree.** On the dirty
   tree it blocks on `vault.md` (the W2 fixer's `vaultGround.ts`) and
   `knowledge-search-routines.md` (29-06's `knowledgeLlm.ts`). **Both of my
   obligations are met** — `skill-registry.md` and `workflow-packs.md` are
   updated and `Last verified`-bumped in the same commit — and after my revert my
   paths no longer appear in the gate output at all.

## Gates

- `cd packages/backend && pnpm vitest run workflowPackBinding skills.test` →
  **209/209**, 2 files.
- `cd packages/backend && pnpm vitest run importGuard` → 119/119.
- `cd packages/backend && pnpm vitest run llmRedaction` → 67/67 (it source-scans
  `skills.ts`; comment edits could have moved it).
- `cd packages/backend && pnpm typecheck` → clean. `cd packages/core && pnpm
  typecheck` → clean.
- `cd packages/core && pnpm vitest run` → 45 files / **1458** — baseline 1457 was
  measured while my one extra test was in the tree; after the revert core is back
  to the untouched baseline.
- `echo '{}' | node scripts/check-playbooks.mjs check` → blocks only on the two
  sibling-owned playbooks named above.
- `git diff --stat HEAD -- "*.ts"` after committing → only the two siblings'
  files. Nothing of mine was left out of the commit.

## Honest notes

- I did not run the full backend suite. Two fixers are editing `knowledgeLlm.ts`,
  `vaultGround.ts` and `vitest.config.mts` in this same tree right now, so a full
  run would mix their in-flight state into my numbers and I could not attribute a
  red. Instead I ran every file that imports or **source-scans** what I changed
  (`importGuard`, `llmRedaction`, `skills`, `workflowPackBinding`) — that is the
  complete set, found by grepping for reads of `skills.ts`,
  `workflowPackBinding.ts` and `workflowCustomization.ts`.
- Everything I changed in `skills.ts` and `workflowPackBinding.ts` is a comment.
  The only executable changes in this commit are four `expect` lines.
