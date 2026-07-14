# Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake)

Items observed during execution that are out of the executing plan's file scope. Logged,
not fixed, per the deviation-rules scope boundary.

## From 04-01 execution

- `node scripts/check-playbooks.mjs` reported `docs/playbooks/skill-registry.md` stale
  against an uncommitted change to `packages/backend/convex/skills.ts` (+3 lines) at the
  time 04-01's Task 1 verify ran. This is a sibling wave-1 plan's (04-02) in-progress work
  in the same shared worktree — not touched by 04-01 (files_modified scope is
  `packages/extraction/*` + `docs/playbooks/intake.md` + `watch.json` only). The intake.md
  registration itself was NOT flagged stale. Expected to self-resolve when 04-02 commits its
  own playbook update.

## From 04-02 execution

- `pnpm --filter @pikar/backend test -- skills` (the plan's verify command) does not narrow
  to `skills.test.ts` — `vitest run "--" "skills"` runs the FULL backend suite (17 files)
  regardless of the trailing `skills` arg, a pre-existing quirk of the package's plain
  `vitest run` test script, not something 04-02 changed. Verified the intended narrow
  assertion directly instead: `npx vitest run convex/skills.test.ts` → 13/13 green (includes
  the new attachment-extractor no-drift row).
- Running the full suite concurrently with sibling wave-1 plans (04-01/04-03) executing in
  the SAME worktree causes CPU-contention flakiness: `cockpitDraft.test.ts`,
  `cockpitTools.test.ts`, `documentDraft.test.ts`, `runCockpitAgent.test.ts` intermittently
  hit vitest's 5000ms default test timeout (mock-model LLM loop tests are timing-sensitive).
  These are pre-existing tests untouched by 04-02's file scope (`skills.ts`/`skills.test.ts`
  only) — not a regression, self-resolves once the parallel wave finishes and the full suite
  is re-run serially (owned by phase-close / verify-work).
- A shared git index race in the concurrent worktree: 04-02's Task 1 `git add` staged its
  three files, but the subsequent `git commit` hit `index.lock` held by a sibling plan's
  concurrent commit; sibling 04-03's next commit (`6e9374f`) picked up 04-02's already-staged
  files alongside its own, so Task 1's three files (`attachment-extractor.md`,
  `attachmentExtractor.ts`, the `ATTACHMENT_EXTRACTOR_SKILL` const in `skill.ts`) landed
  inside 04-03's commit message rather than a 04-02-authored commit. Content verified correct
  and present at HEAD — no further action; a structural risk of the "same worktree, no
  branching" parallelization mode, not a 04-02 defect.
- `node scripts/check-playbooks.mjs` (Task 3 verify) blocked on `docs/playbooks/intake.md`
  being stale against an uncommitted `packages/extraction/src/frame.test.ts` change at the
  time 04-02's Task 3 ran — sibling plan 04-01/04-03's in-progress work in the same shared
  worktree, outside 04-02's file scope (`docs/playbooks/skill-registry.md` only). The
  `skill-registry.md` bump itself cleared its own stale-check (not flagged). Expected to
  self-resolve once the owning sibling plan commits its `intake.md` bump.
