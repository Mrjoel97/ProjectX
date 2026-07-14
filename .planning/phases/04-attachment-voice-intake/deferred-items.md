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
