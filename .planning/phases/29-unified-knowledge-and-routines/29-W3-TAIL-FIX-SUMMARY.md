---
phase: 29-unified-knowledge-and-routines
plan: W3-TAIL-FIX
subsystem: docs-and-test-hygiene
tags: [false-absolutes, stale-citations, overstated-evidence, playbooks]

# Dependency graph
requires:
  - plan: 29-W3-TAIL
    provides: "the six items this pass corrects — including the bullet it wrote to replace a deleted absolute, which was itself false"
  - plan: 29-09
    provides: "KnowledgeSearchPanel.tsx, which falsified a W3-TAIL playbook claim three commits after it was written"
provides:
  - "docs/playbooks/skill-registry.md — the pin-door bullet describes what `v.id` checks and where the refusal actually happens; no replacement absolute"
  - "packages/backend/convex/workflowPackBinding.ts — the two surviving copies of the deleted `internalAction` justification are gone"
  - "docs/playbooks/vault.md — the provenance block's six citations are symbols; the cap duplication is labelled DEBT with a probe behind it"
  - "docs/playbooks/knowledge-search-routines.md — renderSourceGap/groundedSourceProps recorded as HAVING a production caller"
  - "packages/backend/convex/vaultGround.test.ts + vitest.config.mts — two comments no longer claim more than they hold"
  - ".planning/.../29-W3-TAIL-SUMMARY.md — the afterEach mutation costs 9, not 13; two other overstatements corrected in place"
affects: [any later plan reading these playbooks as the record of what is enforced]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The replacement for a deleted absolute must describe MECHANISM. Narrowing the guarantee is the failure mode — this is the third time in one phase that the narrowed replacement was itself false."
    - "A recorded mutation number is evidence. Re-measure it; vitest's summary line is `N failed | M passed`, and M is the bigger number."

key-files:
  created:
    - .planning/phases/29-unified-knowledge-and-routines/29-W3-TAIL-FIX-SUMMARY.md
  modified:
    - docs/playbooks/skill-registry.md
    - docs/playbooks/vault.md
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/workflow-packs.md
    - packages/backend/convex/workflowPackBinding.ts
    - packages/backend/convex/vaultGround.test.ts
    - packages/backend/vitest.config.mts
    - .planning/phases/29-unified-knowledge-and-routines/29-W3-TAIL-SUMMARY.md

metrics:
  commits: 1
  duration: "~1h"
  completed: 2026-08-29
---

# Phase 29 W3-TAIL-FIX: closing W3-TAIL's residue

Six findings, all in the same defect class: a sentence that claims more than anything enforces, or a
number read off the wrong column. Every change is prose or a comment except zero lines of logic. No
behaviour changed; `pnpm typecheck` is clean and every suite I touched is at its baseline.

`packages/backend/convex/skills.test.ts` is in my ownership list and I did **not** modify it —
nothing in the findings required it, and it already carries the test that makes the new
`skill-registry.md` bullet checkable.

---

## Item 1 — `skill-registry.md:2577`, the replacement absolute that was itself false

**Deleted** (it was written to replace an earlier deleted absolute):

> Every declaring site takes `v.optional(v.record(v.string(), v.id("tenantSkills")))`, so a value
> that is not a real row of that table is refused before any handler runs. No site accepts a body, a
> name, or a `(name, version)` pair.

Three clauses are false and the fourth is unenforced:

| Clause | Status |
|---|---|
| "refused before any handler runs" | **False.** `v.id` checks an id's shape and table, not row existence. |
| "No site accepts … a name" | **False.** The record's KEY is a skill name — `llm.ts:4993` `const tenantPin = tenantSkillIds?.[skillName];` inside `runSpecialistTurn`. |
| "No site accepts … a `(name, version)` pair" | **False.** `skillVersions: v.optional(v.record(v.string(), v.number()))` is declared immediately above it at every site. |
| "Every declaring site takes …" | Unenforced — no test scans the eight sites, which is the exact enumeration a previous author got wrong 5-of-8. |

**Replaced with mechanism only**, and with the test that already holds it: a well-formed id whose
row was deleted passes validation, the handler runs, and `loadTenantCandidate` throws
`NO_SUCH_TENANT_CANDIDATE_ERROR` from inside `skills.getTenantSkillVersion`.

**EVIDENCE — this is pinned by a test that already exists**, so the verifier's throwaway convex-test
was not needed: `packages/backend/convex/skills.test.ts` deletes the row and then asserts
`rejects.toThrow(/NO_SUCH_TENANT_CANDIDATE/)` against `internal.skills.getTenantSkillVersion`
(the "Absence: the error names NOTHING" block). Run: `cd packages/backend && pnpm vitest run
skills.test` → **170 passed**. The `loadTenantCandidate` source is `skills.ts` — `ctx.db.get(id)`,
`if (row === null) throw new Error(NO_SUCH_TENANT_CANDIDATE_ERROR)`, i.e. inside the handler.

I also caught my own first draft of the retraction sentence overstating itself ("every clause of
that was wrong") and corrected it to three-of-four before committing.

---

## Item 2 — `workflowPackBinding.ts:143` and `:159`

Both deleted, verbatim:

- `:143` — "`internalAction` ⇒ never model-supplied."
- `:159` — "Validated as `v.id("tenantSkills")`, never a string, and declared only on the two
  `internalAction`s below."

They are the same justification that W3-TAIL's own commit removed at `:205-209`, surviving 49 lines
above the comment that records the removal. The `v.id(...)` validator is on the very next line of
source, so nothing is lost by deleting the sentence that restates it.

`docs/playbooks/workflow-packs.md` carries the same claim in its 2026-08-28 changelog entry
("`internalAction` only, never model-supplied"). That file is **not** in my ownership list, but the
CLAUDE.md §9 hook blocks on a `workflowPackBinding.ts` change with that playbook untouched, so it
gets a `Last verified` block that points readers at `skill-registry.md`'s gap bullet instead of the
sentence below it. Flagging that as a deliberate step outside my list.

**Mutation:** none applicable — comment deletion. `pnpm vitest run workflowPackBinding` → **39
passed**, `pnpm typecheck` clean, confirming the deletion is inside a block comment.

---

## Item 3 — `vault.md`'s stale citations, and the cap duplication

Every citation in the provenance block is now a SYMBOL. All six were verified at HEAD before
conversion:

| Was | Verified at HEAD | Drift |
|---|---|---|
| `evaluations.ts:1150` | `persistNextStepMemo` at `:1145` | 5 |
| `voice.ts:349` | `persistBrief` (`internal.voice.persistBrief`, `:342`) | 7 |
| `onboarding.ts:492` | `writeProfileDoc` at `:462` | 30 |
| `schema.ts:1971` | the `vaultDocuments.origin` comment at `:1966` | 5 |
| `vault.ts:265` / `:1174` / `:186` | `vaultUpload` / `ingestFromAttachment` / `vaultIngestText` | still inside each |
| `smoke.ts:1196` | `seedVoiceDocSession` — and it writes `kind: "document"`, not an upload | — |
| `vaultDrive.ts:1169` | `landFile` (its `kind: "upload"` is at `:1204`) | — |

The first three are exactly the ones W3-TAIL fixed in `knowledge-search-routines.md` and left
standing in `vault.md`, in the same commit.

**The cap duplication is now labelled DEBT, with a probe behind it**, rather than asserted as a
fact with nothing under it:

> **PROBE, RUN AND REVERTED.** Set `DIGEST_PER_DOC_CHARS = 1400` in `convex/vaultDigest.ts`
> (from `1500`): `pnpm vitest run vaultDigest` → **17 passed (17)**, `pnpm typecheck` → clean.
> Nothing pins the pair. Reverted from a byte copy; `git status --porcelain -- convex/vaultDigest.ts`
> is empty. This is a **non-red mutation** and is the evidence FOR the debt label, not against it.

`vaultDigest.ts` is outside my ownership, so the one-line derivation fix (export the caps from one
module, import in the other) is named in the playbook as the fix, not made.

---

## Item 4 — the two overstatements in `29-W3-TAIL-SUMMARY.md`

**(a) The mutation blast radius. RE-MEASURED, not taken from the verifier.**

Baseline `cd packages/backend && pnpm vitest run vaultGround.test` → `Tests 22 passed (22)`.
Deleted the file-level `afterEach(() => { vi.unstubAllEnvs(); })` (replaced with a marker comment),
re-ran:

```
⎯⎯⎯ Failed Tests 9 ⎯⎯⎯
 FAIL  the operator consent is RESTORED for the tests that follow
 FAIL  vaultGroundHydrated > hydrates titles + per-doc-capped chunk text parallel to docIds
 FAIL  vaultGroundHydrated > blueprint presence does not consume any of TOTAL_CHAR_CAP
 FAIL  vaultGroundHydrated > cross-tenant: an explicit foreign tenantId yields no arrays or foreign spine
 FAIL  citation metadata (29-02) > kinds / sourceUpdatedAt / truncated stay index-parallel …
 FAIL  citation metadata (29-02) > a MATCHED PASSAGE is what gets hydrated …
 FAIL  citation metadata (29-02) > a passage that IS the whole document is NOT reported as truncated
 FAIL  citation metadata (29-02) > a passage is attached only to a doc the TENANT owns
 FAIL  vaultGroundHydrated spine (BLPR-02) > returns a live spine without changing any retrieval array
      Tests  9 failed | 13 passed (22)
```

**9, not 13** — 13 is the PASSED column. Reverted from a byte copy; `afterEach` back at `:26`, the
`MUTATION:` marker absent, re-run **22 passed (22)**. The summary's block now enumerates all nine
(its own list summed to 8 while asserting 13) and carries the correction inline. Also honest about
what this means: 8 of the 9 reds are pre-existing tests, so the added guard contributes naming more
than detection.

**(b) The citation claim.** `docs/playbooks/knowledge-search-routines.md — zero line-number
citations remain` is falsified by one grep. Re-scanned at HEAD:
`grep -cE "[A-Za-z_/.-]+\.(ts|tsx|mts|mjs):[0-9]+"` → **2 lines, 5 matches**, all on lines 38-39
inside the changelog entry where they are quoted as the rotted originals. Corrected in the
frontmatter, in the body, and in the playbook's own sentence (which had the same unqualified "EVERY
citation in this playbook is replaced" wording).

I added a third correction the findings did not ask for: W3-TAIL's `### vault.md` section claimed
its citations were done while three were stale, and its "left undone" list did not disclose it. That
section now says so.

---

## Item 5 — two comments that claimed more than they hold

**`vaultGround.test.ts:198`** — "It must run immediately after it" deleted. Vitest guarantees no
adjacency and nothing in the file asserts one. The comment now states the actual condition (the
guard catches the leak only while it runs after the stubbing test) and names the order-free fix:
`unstubEnvs: true` in `vitest.config.mts`.

**I did NOT apply `unstubEnvs: true`.** It is a suite-wide behaviour change across 112 backend test
files in a closing pass, with two sibling agents committing into the same worktree. It is recorded
as a follow-up below — and it is the better fix, because it also covers `blueprint.test.ts`, which
carries the identical unprotected `vi.stubEnv` / trailing `unstubAllEnvs()` pattern.

**`vitest.config.mts:25-31`** — the comment called the surviving content-selected `SMOKE::` seams
"deliberately ungated" and used `vault.ts`'s `vaultSearch` as the exemplar. The register
(`29-SMOKE-SEAM-DEBT.md`) classifies them as **open debt** and does not enumerate `vaultSearch` at
all (its numbered instances are `vaultLlm.ts` ×2, `vaultRag.ts`, `gmail.ts`, `vaultGround.ts`
(closed) and `knowledgeLlm.ts`). The comment now says "still ungated, and the register carries them
as OPEN DEBT rather than as a design choice" and names no seam the register does not carry. The
register is the source of truth and it is unowned in wave 4, so I did not add a `vaultSearch` entry
to it — see follow-ups.

---

## Item 6 — the claim a sibling falsified mid-wave

`renderSourceGap` / `groundedSourceProps` DO have a production caller: 29-09's
`apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx` imports both and calls
`groundedSourceProps(claim.evidence)` and `renderSourceGap(state)`. True when W3-TAIL wrote the
entry; false at HEAD.

Corrected in **two** places, because the stale sentence appeared twice: the standing "Corrected
claims" bullet **and** the W3-TAIL changelog entry that announced the correction. The narrower
surviving fact is kept: `groundedSourceProps`' `nonVault` return still has no production reader.

**The `@pikar/core` docstrings named in the finding were already fixed by 29-09** — I read them
rather than trusting the report. `packages/core/src/knowledgeSearch.ts` now says "Callers:
`KnowledgeSearchPanel.tsx` renders the return value…" and `grep -n 'NOT WIRED'` over that file
returns nothing. No follow-up is owed there.

---

## Verification — corrected commands, real output

The plan's two gate forms are no-ops and were not used.

| Command | Result |
|---|---|
| `cd packages/backend && pnpm typecheck` | clean (`tsc --noEmit`, no output) |
| `cd packages/backend && pnpm vitest run vaultGround.test` | **22 passed (22)** |
| `cd packages/backend && pnpm vitest run workflowPackBinding` | **39 passed (39)** |
| `cd packages/backend && pnpm vitest run skills.test` | **170 passed (170)** |
| `cd packages/backend && pnpm vitest run vaultDigest` | **17 passed (17)** (also under the reverted probe) |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **empty stdout** — no `"decision":"block"` |
| `git diff --stat HEAD -- "*.ts" "*.mts"` after committing | only `workflowPackEvals.test.ts` (29-07's uncommitted work, not mine) |

I did not run the full backend suite: nothing here changes executable behaviour, and the four files
that could be affected were run individually and are at baseline.

**Mutations observed RED:** one — the `afterEach` deletion above (9 red, enumerated, reverted).
**Mutations observed GREEN as evidence:** one — `DIGEST_PER_DOC_CHARS = 1400` (17/17 still passing,
which is the proof of the DEBT label). Everything else in this pass is a deletion of prose or of a
comment, where a mutation is not defined; I am not going to manufacture one.

---

## What I did NOT close, and why

- **`unstubEnvs: true` in `packages/backend/vitest.config.mts`** — the order-free root fix for the
  env-leak class, covering `blueprint.test.ts:741-749` as well. Suite-wide blast radius across 112
  files, in a closing pass, in a worktree two other agents are committing to. Named in the test
  comment and here; not applied.
- **`vault.md`'s other line-number citations** — the provenance block is clean, but a grep still
  finds citations elsewhere in the file (`vaultGround.ts:29`, `schema.ts:900`, `vaultRag.ts:390` ×3,
  `vaultDrive.ts:697`, `blueprint.ts:540`, `evaluations.ts:295`, `llm.ts:3873`, `voiceDoc.ts:75`,
  `DocGrid.tsx:101/148`, and more). Sweeping the whole 3.4k-line playbook is a different job from
  the finding, and an unverified conversion is how stale citations get minted. **Stated as open.**
- **`29-SMOKE-SEAM-DEBT.md` does not enumerate `vault.ts`'s `vaultSearch`.** I made the comment
  agree with the register (the register is source of truth, per the brief) instead of editing the
  register, which is not in my ownership list. If the phase wants `vaultSearch` carried as instance
  #7, that is a one-entry edit for whoever owns the register.
- **`packages/core/src/knowledgeSearch.ts`** — no change needed; 29-09 already fixed both docstrings.
- **`convex/env.test.ts`** stays red. Phase 28's, not mine.
- **`docs/playbooks/production-beta.md`** still owes a bump for Phase 28's `lib/env.ts` change.
- **STATE.md / ROADMAP.md not updated.** This pass has no PLAN.md and no requirements; advancing the
  plan counter for a residue-fix would misreport the phase.

## Self-Check: PASSED

- `.planning/phases/29-unified-knowledge-and-routines/29-W3-TAIL-FIX-SUMMARY.md` — created.
- Commit `d76144a` exists and carries all eight modified paths; nothing of a sibling's was staged
  (`git status --short` before the commit listed exactly the eight owned files).
- `git diff --stat HEAD -- "*.ts" "*.mts"` after the commit shows only `workflowPackEvals.test.ts`,
  which is 29-07's in-flight work — my source changes are all in HEAD.
- Both probe files (`convex/vaultDigest.ts`, `convex/vaultGround.test.ts`) verified reverted:
  `DIGEST_PER_DOC_CHARS = 1500` at `:57`, `afterEach(() => {` at `:26`, `git status --porcelain`
  clean for `vaultDigest.ts`.
