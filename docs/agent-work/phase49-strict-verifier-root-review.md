# Phase 49 strict verifier root review

Status: bounded code correction accepted; live Git qualification unavailable. This tooling repair does not close
Plan 06 or advance dependent Plan 07.

2026-09-23: root independently ran `node --test scripts/check-planning.test.mjs
scripts/check-playbooks.test.mjs`: 15/15 passed, exit 0. Source review found gaps not
covered by those tests:

1. Planning's `stop_hook_active` branch suppresses strict failure.
2. Playbook hashing treats all Git hash failures as deleted files; strict checking must
   distinguish actual deletion from failure to inspect an existing file.
3. An existing unusable session baseline silently falls back to HEAD, potentially omitting
   committed session changes from strict qualification.
4. Tests need actual newly created uncovered code and acknowledgment invalidation coverage.
5. Owned scripts/tests/watch map need focused formatting verification.

One consolidated correction request was sent to the existing native Luna worker
`phase49_strict_verifiers`, retaining original file ownership. Gitless subprocess fixtures
are not live Git qualification. Graph discovery/refresh remains unavailable after bounded
worker attempts.

Root also rechecked the 13 exact residual directories listed in the browser cleanup handoff:
all are empty and are not reparse points. Nonrecursive deletion of each validated exact
directory still failed. No contents were deleted by this follow-up; the lifecycle gate
remains open and no browser rerun or production operation was performed.

## Correction review

Root independently reran the corrected suites: 18/18 passed, exit 0. The hook-flag,
baseline, acknowledgment and uncovered-code corrections are present. One residual
false-pass path remains: `existsSync` returns false for some access failures, not only
missing paths. The worker is tightening strict baseline and deletion classification to
accept only confirmed missing-path errors and adding subprocess fault injection coverage.
Acceptance remains pending that bounded correction.

The residual directory failure was narrowed to Windows sharing violation
(`System.IO.IOException`, HResult `-2147024864`). A separate bounded lifecycle-only
diagnostic was assigned to the existing browser worker: at most two fresh synthetic local
backend start/stop probes comparing child working directories, without push, auth, browser,
build, provider calls or application source changes. This is causal investigation, not a
rerun or acceptance of Plan 06.

## Final bounded acceptance

Root reviewed the final `lstatSync` classification: only ENOENT/ENOTDIR count as
absence, and other inspection failures fail strict qualification. Independent focused
subprocess rerun reported 18/18 passed. The real repository command
`node scripts/check-planning.mjs . --exit-code` returned `status: passed`, exit 0.
`node scripts/check-playbooks.mjs check --exit-code` returned `status: failed`, exit 1,
because Git cannot be spawned (ENOENT). This is the intended failure behavior, not
successful live playbook qualification. Worker formatting passed; graph refresh remains
unavailable. The bounded verifier repair is accepted, not Plan 06/07 or wave closure.

## Real Git-backed follow-up

Root later downloaded the official Git for Windows 2.55.0(5) MinGit zip from
`https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.5` into the
separate OS temporary directory `pikar-git-tool-20260923`. The archive's SHA-256
`56d7b226b7693196cfc71fef26568f536c4a021ab6c37ff2db4287bed908e96e`
matched the release's published digest; extracted `git.exe --version` reported
`2.55.0.windows.5`. No project dependency or global PATH was changed. With only
this command's PATH prefixed, real `git status` and strict playbook discovery ran.

`node scripts/check-playbooks.mjs check --exit-code` returned exit 1 with substantive
stale playbooks (`agent-runtime.md`, `contacts-crm.md`, `guardrails.md`) and uncovered
core design/recipe files. This replaces the earlier Git-unavailable explanation for
that check in the temporary-tool environment; the failure is not a green gate. Plan 07
worker was informed of its owned watch/runtime part. Unrelated pre-existing changes
remain untouched pending root review. The shared worktree is heavily dirty, so no
broad staging or commit is justified.
