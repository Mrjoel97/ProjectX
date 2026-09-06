---
phase: 37-planning-corpus-repair
plan: 01
status: complete
completed: 2026-09-06
commits: [see the phase-close commit — feat(37-01)]
requirements-completed: []
requirements-pending: []
---

# 37-01 — The planning corpus tells the truth again, and a hook keeps it that way

**Measured before (2026-09-06, tree `5338d3c`).** STATE.md: 3,215 lines, 36 stacked frontmatter
blocks (lines 1–1,170), body stuck at "Phase 15.3 — Wave 4 of 9". ROADMAP.md: 63 `### Phase`
headings, 32 progress-table rows, 31 headings without a row, 7 rows contradicting their own phase
directory (3 read "0/5 Planned" with 5/5 closed and a VERIFICATION; 21 read "Not started" with 8/8
closed). REQUIREMENTS.md: 47 of 124 unticked, the traceability table consistent with the checkboxes
but not with the phase record. The audit's "three PDFs committed under `Skills/`" was wrong in kind —
they are untracked and git-ignored (`.gitignore:104`); nothing to repair.

**Root cause of the stacking, pinned to the writer.** `gsd-tools` `spliceFrontmatter` replaces the
span `/^---\n[\s\S]+?\n---/` and, when that fails to match, PREPENDS a fresh block above the whole
file. Any byte other than a dash at position 0 (BOM, blank line, CR) or a CRLF fence makes it fail —
so every state write on a file that had once been touched that way added a block. Git history shows
no CR bytes, so the trigger was invisible to diffs; the guard is a byte-0 and one-block check, not a
tool patch (the tool is a plugin outside the repo).

**What changed.**
- `STATE.md` → 44 lines: one frontmatter block (`current_phase: 37`, `progress: 48/64 phases,
  400/443 plans` counted from the regenerated table), a body that says where each kind of truth
  lives, the last three closes, the next merged-order step and the owner-side items still owed,
  session continuity, and the one-block rule. The whole prior file is
  `.planning/archive/STATE-history-2026-09-06.md`, unchanged.
- `ROADMAP.md` → a Phase 37 block; the progress table regenerated in numeric order: **64 rows** (one
  per heading incl. 37), 25 consistent rows kept verbatim, 13 rebuilt from the phase census — 1
  (8/9, open 01-09), 2 (7/9, 02-08/09 superseded by 3.1), 3 (5/5 Complete), 9 (superseded by 25,
  empty directory), 17 (9/11, open 17-10/11), 18 (8/10, open 18-09/10), 21 (8/8 Complete), 22 (3/3
  Complete), 23 (5/9), 24 (1/2), 25 (7/14), 31 (0/8 Not started), and 26 new rows for the cockpit
  sub-phases, 15.x, 17.1, 19.1, 20.1, 22.1, 25.1–25.3, 27, 28.1, 28.2, 29, 30, 33, 33.1, 33.2. The
  "NOT AUTHORITATIVE" banner is replaced by the two-line contract the hook enforces. Heading blocks
  were NOT re-ordered (insertion history; the table is the index).
- `REQUIREMENTS.md` → **12 ticked** with evidence in the traceability row (DASH-01, APRV-01, FIN-01,
  HOME-01, CONT-01, RPRT-01 — Phase 26 frontmatter claims, 21/21, deployed 08-23; PACK-01..04 — 27
  claims, 9/9; KNOW-01, ROUT-01 — 29 claims + VERIFICATION). **22 annotated `*(open: …)*`** (DLVR-02,
  VALT-13, VALT-15, BETA-01, BETA-02, BETA-03, BETA-05, ACTN-02, ACTN-04, MEDIA-01, SKILL-02,
  GOVN-02, REVN-04..06, BILL-01..06, ROUT-02) — each note names the shipped code and the missing
  proof, so the closure rule passes on them honestly. 35 remain unticked (the 22 + REVN-01..03,
  VERT-01..04, MKTG-01..06, all with nothing shipped). Bucket A shrank from the research's 15 to 12
  on the evidence pass: 15.3-VERIFICATION is `human_needed` (VALT-13), 20.1-01 defers VALT-15 to an
  unrun 20.1-02, 25-02 says in so many words that it does not certify BETA-01, and BETA-02's proof is
  the unrun two-user test.
- `.planning/archive/` → README + CONTEXT-HANDOFF, WAVE-0, PARALLELIZATION, the three v2.0 audit
  files, `debug/`, `todos/`, `codebase/` (25 renames). `research/` stays (phase research cites it).
- `scripts/check-planning.mjs` + a second Stop hook in `.claude/settings.json`: (1) STATE.md starts
  with `---\n` and holds one block; (2) every heading has a row; (3) a fully-summarised phase
  directory may not sit behind a non-Complete row and a Complete row may not hide an open plan;
  (4) a Complete phase's traceability rows are Complete or their checkbox line carries `(open:`.
  Registered under `ci-gate.md` in `watch.json` with its sibling; playbook bumped. Not run in CI.

**Verified.** Real tree: exit 0 — after the check itself caught three rows I had kept verbatim (17
and 18 read Complete over open plans; 22 hid a 3/3 directory behind a UAT note), which were
rebuilt. Scratch copy (file names only): five mutations each exit 1 with exactly their own line —
a second frontmatter block; row 21 deleted; a 21-09-PLAN with no summary under a Complete row; row
21 rewritten "Not started"; DASH-01 reverted to Pending under Complete Phase 26 ("Closure rule:
Phase 26 reads Complete but DASH-01 is "Pending" … no `(open: …)` note"). `pnpm lint
--diagnostic-level=error --max-diagnostics=none` exit 0.

**Deliberately not done.** Re-ordering 64 heading blocks (huge diff, no reader benefits); CI
enforcement (a docs drift must never hold a deploy); patching the plugin; deleting the ignored
PDFs (owner: keep). The `Do NOT run gsd-tools state *` warning stays in STATE.md's `stopped_at`
because the hook refuses the damage but cannot stop the tool from trying.
