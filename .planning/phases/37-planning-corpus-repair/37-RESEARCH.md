# Phase 37 (proposed) — Planning-corpus repair (G26): research

**Source:** rev 5 audit G26 (`.planning/design/system-audit-2026-09-03-merged.md` §4 and §5, Track A
step 5): "STATE.md carries 36 stacked frontmatter blocks; ROADMAP table stale; requirement rows never
ticked for shipped phases; three Hormozi PDFs committed under `Skills/`. One repair pass; then a rule: a
phase closes only when its requirement rows are ticked." Measured against the tree at `5338d3c`
(main, 2026-09-06), not against the audit's 09-03 reading.

## 1. What is actually drifted (measured 2026-09-06)

### STATE.md — 36 stacked frontmatter blocks, a body from Phase 15.3

| Fact | Measured |
|---|---|
| File | 3,215 lines; **72 `---` fences = 36 frontmatter blocks** occupying lines 1–1,170; the body (`# Project State`) begins at line 1,171 |
| Block 1 (the only one any tool reads) | `current_phase: 28`, `status: in_progress`, `last_updated: 2026-09-02`, `progress: 36/53 phases, 353/421 plans`; its `stopped_at` ends with *"Do NOT run any `gsd-tools state *` subcommand against this file -- it has corrupted it seven times."* |
| Other blocks | `current_phase` values include 15.3; `completed_phases` runs 24 → 36 across blocks — a stack of snapshots, newest on top |
| Body `## Current Position` | **"PHASE 15.3 — Vault Folders (Wave 4 of 9)"** — six weeks and ~20 phases stale |
| Body `## Lane Status` | the 2026-08 four-lane table (19, 26, 15.4, 15.3, 17.1, 15.2, 16, 17, 22) — every lane since closed |
| Body `## Historical Position — Phase 14 (SUPERSEDED)` | lines 2,580–2,780, kept "for context" |
| Body `## Session Continuity` | stopped at 28.1-04 (2026-08-29) |
| Last commits touching it | 33.2 plans (09-04/05) — executors keep appending to the top block's `stopped_at`; nobody reads the body |

**Mechanism of the stacking (pinned as far as the tool allows).** `~/.claude/get-shit-done/bin/lib/frontmatter.cjs`
`spliceFrontmatter` matches `/^---\n[\s\S]+?\n---/` and REPLACES that span; when the match fails it
PREPENDS a fresh block above the whole file. The match fails for any byte at position 0 other than
`-` (a BOM, a leading blank line, a `\r`), and for a `\r\n` fence. Git history of STATE.md carries no
`\r` (checked: 0 CR bytes across all patches), so the prepends came from writes that saw a
non-matching head that a diff does not show (a BOM or a leading newline are the usual suspects) or
from a workflow prompt that had the agent write a block by hand. Either way the guard is the same and
cheap: **STATE.md must start with the exact bytes `---\n` and contain exactly one block** — a check,
not a tool fix (the tool is a plugin outside the repo).

### ROADMAP.md — 63 heading blocks, 32 table rows, 7 rows contradicting their own block

| Fact | Measured |
|---|---|
| `### Phase` headings | 63 |
| Progress-table rows (`## Progress`, line 1,499) | 32 |
| **Headings with NO table row (31)** | 3.1, 3.2, 3.2.1, 3.3–3.11 (11 cockpit sub-phases), 15.1–15.4, 17.1, 19.1, 20.1, 22.1, 25.1, 25.2, 25.3, 27, 28.1, 28.2, 29, 30, 33, 33.1, 33.2 |
| **Rows contradicting the phase directory** | 1 "7/9 In progress" (dir: 9 plans / 8 summaries; live in prod since July) · 2 "7/9 Spine complete" (9/7, +2 superseded) · 3 "0/5 Planned" (**5/5 closed, VERIFICATION present**) · 21 "0/TBD Not started" (**8/8 closed, verified**) · 23 "0/TBD Not started" (9 plans / 5 summaries) · 24 "0/TBD Not started" (2/1) · 25 "0/14 Planned" (14/7) · 31 "0/TBD Not started" (8 plans / **0 summaries — correct, never executed**) |
| Heading order | 26, 27, 28, 28.1, 28.2, 35, 36, 29, 30, 31, 32, 33, 33.1, 33.2, 25.2, 25.3, 34, **then 1 … 25.1** — inserted phases were prepended, the original sequence follows |
| `## Progress` banner (line ~1,490) | says *"THIS TABLE IS NOT AUTHORITATIVE … STATE's progress block is the number to trust: 34/53 phases, 306/413 plans"* — STATE's block 1 now says 36/53 and 353/421; both are stale against the 63 headings |
| Phase 9 | heading + table row, **empty directory** (0 plans) — the private-beta productionization that Phase 25 re-scoped; row should say superseded |

Ground truth for a rebuilt table exists and is mechanical: every phase directory's PLAN/SUMMARY/
VERIFICATION counts (table in §3 below), each block's own `**Plans:**` line, and the 34/35/36 rows
written by hand this week, which are the shape to copy.

### REQUIREMENTS.md — 47 of 124 unticked; the traceability table agrees with the checkboxes

The file is internally consistent (124 checkbox ids ↔ 124 traceability rows; no row says Complete
while its checkbox is open, and vice-versa). The drift is between the file and the phase record.
Evidence was gathered two ways: frontmatter `requirements-completed:` claims (only Phases 17, 26, 27,
28, 29 ever filled it — the corpus's habit is `requirements-completed: []` with a sentence saying
what it does NOT certify, e.g. 25-10: *"does not certify BETA-01 or DLVR-02"*) and body mentions
across every SUMMARY/VERIFICATION.

| Bucket | Ids | Evidence pointer |
|---|---|---|
| **A. Tick — a closed phase's own record certifies it** | VALT-13 (15.3, 9/9 + VERIFICATION) · VALT-15 (20.1-01 summary) · DASH-01, APRV-01, FIN-01, HOME-01 (26 frontmatter claims; 21/21) · CONT-01, RPRT-01 (26 bodies, 21/21 closed, deployed 08-23) · PACK-01..04 (27 frontmatter claims; 9/9; dark on prod is an activation fact, not a build fact) · KNOW-01, ROUT-01 (29, 13 plans, VERIFICATION present) · BETA-01 (invite-only signup shipped in 22.1 — `provision-owner.setup.ts` drives it; owner decision 09-03 "invite-only") · BETA-02 (tenant scoping is the `requireTenant` wrapper, Phase 1 + 22.1 identity hardening; the 2026-07-21 fix and `importGuard.test.ts`) |
| **B. Owner judgment — shipped in code, live proof missing or partial** | DLVR-02 (25-05 shipped the Graph send arm; Microsoft is env-gated and its concurrency probe failed 08-16) · ACTN-02 (17 claims complete; Google half live, Microsoft half blocked — same probe) · BILL-01..06 (28.1 11/11 closed, but STATE continuity: *"NOTHING HAS EVER SPOKEN TO STRIPE ON A BILLING PATH"*) · MEDIA-01 (20.2 pending; 25.1-07 proved one rendered reel in prod by data; media audit 09-04 says the rail has since never completed a reel) · GOVN-02 (24: 1/2 — "Clause 10.2 remains Partial until 24-02") · SKILL-02 (23: 5/9 closed; the candidate-only invariant shipped in 23-01..05) · ACTN-04 (18: 8/10 closed; document creation is live in the cockpit) · BETA-03 (the merged order's item 9 measures it — time-to-first-outcome; not yet measured) · BETA-05 (two-user isolation test — the second tenant needs the invite path; not run end to end) · REVN-04..06 (28 frontmatter claims them; the lane is PARKED by owner choice 08-31 and 28.2 unparked one connector's code half) · ROUT-02 (29 claims it; 34 lists it pending — fail-closed by design) |
| **C. Stays open — nothing shipped** | REVN-01, REVN-02 (28.2 pending), REVN-03 · VERT-01..04 (Phase 30: 10 plans, 0 summaries) · MKTG-01..06 (Phase 31: 8 plans, 0 summaries; no `/dashboard/marketing` route exists; 04–06 gated on the entity) |

Bucket A is 15 ids, B is 21, C is 11. Only A is mechanical. B is exactly the set where a tick would
be the provenance-laundering pattern this repo keeps catching (a record saying "done" that the code
does not prove) — each B row should carry a one-line *open because* note instead of a tick, unless the
owner rules otherwise per id.

### `Skills/` PDFs — the audit's claim is wrong in KIND

The three files exist ONLY as untracked, **git-ignored** files in the shared tree
(`.gitignore:104 Skills/**/*.pdf`, with a comment recording the decision not to ingest them). `git
ls-files Skills` returns 66 files, none a PDF. Nothing to repair in the repo; the only question is
whether the owner wants the ~31 MB local copies deleted.

### Loose planning files and directories nobody reads

| Item | Last touched | Size |
|---|---|---|
| `.planning/CONTEXT-HANDOFF.md` | 2026-07-27 | 223 lines |
| `.planning/WAVE-0.md` | 2026-07-25 | 280 lines |
| `.planning/PARALLELIZATION.md` | 2026-08-02 | 632 lines |
| `.planning/v2.0-phases-14-25-{GAP-LEDGER,MILESTONE-AUDIT,SUPERPOWERS-CROSSWALK}.md` | 2026-08-20 | 3 files |
| `.planning/debug/` | 2026-08-16 | 11 files |
| `.planning/todos/` | 2026-08-03 | 1 file |
| `.planning/codebase/` | 2026-07-29 | 7 files |
| `.planning/research/` | 2026-08-28 | 10 files (still referenced by phase research — keep) |

## 2. The rule, and where it can live

The audit's rule — *a phase closes only when its requirement rows are ticked* — needs the same shape
as the playbook gate: a Stop-hook script that reads the working tree and refuses the turn. The
existing `scripts/check-playbooks.mjs` (+ `.claude/settings.json` Stop hook) is the template; a
sibling `scripts/check-planning.mjs` would refuse when:

1. `.planning/STATE.md` does not start with the bytes `---\n` or contains more than one frontmatter
   block (the stacking guard);
2. a `### Phase N` heading exists in ROADMAP.md with no row in the progress table;
3. a progress-table row reads Complete while a REQUIREMENTS traceability row for that phase is not
   Complete and its checkbox line carries no `(open: …)` note — the closure rule itself;
4. a phase directory has a SUMMARY for every PLAN but its table row is not Complete (the
   `phase complete` no-op the memory records).

Cost: one script, one settings line, one `watch.json`-style exemption list for phases that are
deliberately open (9 superseded, 30/31/32 unstarted). CI need not run it — the corpus is not shipped
product and a docs drift must never hold a deploy.

## 3. Ground truth for the table rebuild (phase directory census, 2026-09-06)

plans / summaries / verification per directory: 01 9/8/0 · 02 9/7/0 · 03 5/5/1 · 03.1 9/9/1 · 03.2 6/6/1 ·
03.2.1 6/6/1 · 03.3 6/6/1 · 03.4 4/4/1 · 03.5 6/6/1 · 03.6 5/5/1 · 03.7 9/8/1 · 03.8 6/6/1 · 03.9 4/4/1 ·
03.10 7/7/1 · 03.11 6/6/1 · 04 6/6/1 · 05 7/7/1 · 06 8/8/1 · 07 6/6/1 · 08 8/8/1 · 09 0/0/0 · 10 4/4/1 ·
11 4/4/1 · 12 6/6/1 · 13 4/4/1 · 14 9/9/1 · 15 6/6/1 · 15.1 7/7/1 · 15.2 8/8/1 · 15.3 9/9/1 · 15.4 4/4/1 ·
16 9/9/1 · 17 11/9/1 · 17.1 10/9/0 · 18 10/8/0 · 19 11/11/1 · 19.1 7/7/1 · 20 20/19/0 · 20.1 2/1/0 ·
20.2 1/1/0 · 21 8/8/1 · 22 3/3/1 · 22.1 5/5/1 · 23 9/5/0 · 24 2/1/0 · 25 14/7/0 · 25.1 7/7/1 · 25.2 3/3/0 ·
25.3 1/1/0 · 26 21/21/0 · 27 9/9/0 · 28 29/28/0 · 28.1 11/11/0 · 28.2 1/1/0 · 29 13/30/1 · 30 10/0/0 ·
31 8/0/0 · 33 10/11/0 · 33.1 6/5/0 · 33.2 3/3/0 · 34 1/1/0 · 35 2/2/0 · 36 1/1/0.

Partially-closed phases the rebuilt rows must say so about (plans open, not "complete"): 01 (1),
02 (2, superseded by 3.1), 03.7 (1), 17 (2), 17.1 (1), 18 (2), 20 (1), 20.1 (1), 23 (4), 24 (1),
25 (7 — 25.1/25.2/25.3 absorbed part of the scope), 28 (1, parked), 33.1 (1).

## 4. Proposed shape of the plan (one plan, one commit, no code path touched)

1. **STATE.md**: one frontmatter block regenerated from the census (`current_phase`, `progress`), a
   ~60-line body (Current Position = merged-order pointer, Session Continuity = last three closes),
   the 3,150 lines of history moved to `.planning/archive/STATE-history-2026-09-06.md` (git keeps
   them regardless — the archive file is a courtesy for grep).
2. **ROADMAP.md**: headings re-ordered numerically; 31 rows added and 7 rewritten from §3, status
   column in the 34/35/36 style; the "NOT AUTHORITATIVE" banner and the Progress prose replaced by a
   two-line note that the table is now generated-and-checked; Phase 9 row marked superseded by 25.
3. **REQUIREMENTS.md**: bucket A ticked with the phase and evidence file in the traceability row;
   bucket B rows annotated `(open: <one line>)`; bucket C untouched.
4. **Archive**: the loose files and `debug/`, `todos/`, `codebase/` moved under `.planning/archive/`
   with a one-paragraph README; `research/` stays.
5. **Rule**: `scripts/check-planning.mjs` + Stop hook + `docs/playbooks/ci-gate.md` note (that
   playbook owns the hook scripts per `watch.json`) + a memory line replacing the "phase complete
   no-ops" workaround with "the hook now refuses it".
6. **Verify**: the script run against the repaired tree exits 0; run against a copy with one stacked
   block and one un-ticked complete phase exits 1 (the one runnable check).

## 5. Owner questions (the four the plan cannot decide)

1. **STATE.md history** — archive file under `.planning/archive/` (recommended; grep-able, costs
   nothing) or rely on git alone and delete?
2. **Requirement ticks** — tick bucket A on the executor's verification of each pointer, annotate
   bucket B `(open: …)` and leave C (recommended); or rule per id now on any B row you consider
   proven (DLVR-02, ACTN-02, BILL-01..06, MEDIA-01, GOVN-02, SKILL-02, ACTN-04, BETA-03, BETA-05,
   REVN-04..06, ROUT-02)?
3. **Loose planning files** — move to `.planning/archive/` (recommended) or delete outright?
4. **The three local PDFs** — delete the ~31 MB ignored copies from the shared tree, or keep (they
   never reach git either way)?
