# Independent strict-verifier repair

Date: 2026-09-23. Implements the already-recorded verifier gap in the Phase 49
final-review map, not execution or acceptance of dependent Plan 07. Plan 06
remains open for exact temporary-directory lifecycle cleanup.

## Scope and ownership

One native Luna worker owns `scripts/check-planning.mjs`, its test,
`scripts/check-playbooks.mjs`, a focused subprocess test for that script, and
the relevant existing playbook/watch documentation. Read CLAUDE.md, applicable
AGENTS instructions and subsystem playbook before edits; attempt bounded graph
discovery. Preserve all unrelated shared-worktree changes. No recursive workers.

## Required behavior

Provide an explicit strict qualification mode which exits nonzero if required
root discovery, Git/diff discovery, watch loading/schema validation, or required
planning inputs are unavailable. Preserve editor-hook compatibility, but make
its intentional skip distinguishable in output from a passed check. Preserve
all existing substantive planning/playbook rules and acknowledgement behavior;
strict qualification must not silently bless missing inputs or empty discovery.
Reuse existing `--exit-code` semantics where suitable rather than inventing
multiple overlapping modes. Explicit-root planning must still operate without
Git and genuinely inspect the corpus. Do not fabricate changed-file inventories
or relax rules to make this Git-less environment green.

Tests must execute the CLI as a subprocess and assert actual exit/status output
for missing root, unavailable Git, failed diff, absent/malformed watch map,
missing required planning input, genuine violations and a valid positive fixture.
Use test-owned fixtures and deterministic mocks only in tests; production code
must not accept caller-supplied success flags. No installs or production/provider
actions. No changes to runner/protocol/renderer/browser files, package manifests,
Phase 49 acceptance summaries, STATE, or ROADMAP.

Report exact files/commands/results and any environment-limited live verification.
Git absence is not a passing strict check. Update docs and watch coverage; attempt
bounded graph refresh after edits and state whether it actually ran. Return
ready_for_review, not accepted. Root owns final review and integration registration.
