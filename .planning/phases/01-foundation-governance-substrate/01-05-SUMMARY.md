---
phase: 01-foundation-governance-substrate
plan: 05
subsystem: infra
tags: [graphify, ponytail, mcp, knowledge-graph, tooling, git-hooks]

# Dependency graph
requires:
  - phase: 01-01
    provides: monorepo substrate (source the graph is built from)
provides:
  - graphify repo knowledge graph (graphify-out/graph.json, 651 nodes) queryable via CLI + MCP
  - post-commit/post-checkout git hooks that auto-refresh the graph (AST-only, no LLM cost)
  - graphify-mcp stdio server registered in .mcp.json for Claude Code
  - ponytail minimal-code discipline (project-scoped plugin + CLAUDE.md convention #8)
  - PreToolUse hook-guards that redirect Read/Grep to `graphify query` (token reduction)
affects: [all-later-phases, gsd-executor-subagents]

# Tech tracking
tech-stack:
  added: [graphifyy 0.9.11 (uv tool, --with mcp), ponytail 4.8.4 (claude plugin)]
  patterns: [query-before-read graph navigation, laziest-diff code discipline]

key-files:
  created: [.mcp.json, graphify-out/graph.json, .claude/settings.json]
  modified: [CLAUDE.md, README.md, .gitignore]

key-decisions:
  - "Built the graph with `graphify update .` (AST, no LLM) instead of `extract` (semantic LLM) — token-free and deterministic for a dev-time code graph."
  - "Installed graphify with `--with mcp` — the base tool ships no `mcp` module, so the MCP server failed with ModuleNotFoundError until injected."
  - "`.mcp.json` uses the `graphify-mcp` executable, not the plan's `python -m graphify.serve` — graphify lives in an isolated uv venv the system python can't import."
  - "Committed graph.json (MCP works from a clean clone); ignored cache/, *.html, and dated backup dirs."
  - "Wired ponytail at BOTH plugin level (SubagentStart hook) and CLAUDE.md §8 so the discipline reaches GSD executor subagents even before hooks load."

patterns-established:
  - "Query-before-read: agents run `graphify query/explain/path` on the graph before grepping/reading source; enforced by PreToolUse hook-guards + CLAUDE.md graphify section."
  - "Minimal-code ladder (ponytail): YAGNI → reuse → stdlib → platform → dep → one line → minimum code, applied after understanding the problem."

requirements-completed: [SC-5]

# Metrics
duration: 35min
completed: 2026-07-09
---

# Phase 01 / Plan 05: Graphify Activation + Ponytail Discipline Summary

**Repo knowledge graph (graphify, 651 nodes) live via CLI + stdio MCP with auto-updating git hooks, plus the ponytail minimal-code plugin wired to reach every GSD subagent — the two mandated token-budget tools are now enforcing input and output token discipline.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-09
- **Tasks:** 2 (Task 1 auto; Task 2 checkpoint — see below)
- **Files modified:** 6 (+ graphify-out artifacts)

## Accomplishments
- graphify installed (`uv tool install graphifyy --with mcp`); CLI `graphify` + `graphify-mcp` resolve; graph built AST-only (no LLM cost) → 651 nodes / 606 edges / 61 communities.
- post-commit + post-checkout git hooks installed and **proven firing** (a live commit triggered a background rebuild that regenerated the graph).
- graphify stdio MCP server registered in `.mcp.json`; server **proven working** via a direct stdio handshake (`initialize` → `tools/list` returned query_graph, get_node, shortest_path, god_nodes, graph_stats, get_pr_impact, …).
- PreToolUse hook-guards registered (Bash/Read/Glob) that inject an ~80-token "query the graph first" nudge and explicitly propagate the rule to subagents.
- ponytail 4.8.4 installed as a project-scoped Claude Code plugin (enabled in `.claude/settings.json`, SubagentStart hook) and restated as binding CLAUDE.md convention #8.

## Task Commits

1. **Task 1: Install graphify, build graph, install hook, register MCP (+ ponytail wiring)** — `1367dfb` (chore)
2. **Settle graph refreshed by hook + ignore dated backups** — `ce7631c` (chore)

## Files Created/Modified
- `.mcp.json` — graphify-mcp stdio MCP server entry (created)
- `graphify-out/graph.json` — committed AST knowledge graph (created)
- `.claude/settings.json` — ponytail enabled + graphify PreToolUse hook-guards (created)
- `CLAUDE.md` — added convention #8 (ponytail ladder) + `## graphify` section (query-before-read)
- `README.md` — "Dev tooling" section: per-machine setup for both tools + Windows PYTHONUTF8/PATH notes
- `.gitignore` — commit graph.json; ignore `graphify-out/cache/`, `*.html`, dated backup dirs

## Decisions Made
See `key-decisions` frontmatter. Headline: the plan's assumed commands (`graphify .`, `python -m graphify.serve`) don't match the shipped tool — corrected to `graphify update .` (no-LLM build) and the `graphify-mcp` executable, and added the missing `mcp` dependency via `--with mcp`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan's build/serve commands don't exist in graphify 0.9.11**
- **Issue:** Plan specified `graphify .` (build) and `.mcp.json` command `python -m graphify.serve`. The shipped CLI has no bare-path build (uses `update`/`extract`), and the isolated uv-tool venv makes `python -m graphify.serve` fail (`ModuleNotFoundError: mcp` + system python can't import graphify).
- **Fix:** Built with `graphify update .` (AST, no LLM); reinstalled with `uv tool install graphifyy --with mcp`; pointed `.mcp.json` at the `graphify-mcp` executable.
- **Verification:** graph.json generated; stdio handshake returned the tool list; `graphify --version` resolves.
- **Committed in:** `1367dfb`

**2. [Rule 2 - Missing scope] Added ponytail wiring (mandated tool not in plan files)**
- **Issue:** ponytail (mandated build-tool per project decisions) was not installed and not enforced for subagents. Out of 01-05's original file scope but required by the user for this session.
- **Fix:** Installed the plugin (project scope) and added CLAUDE.md convention #8 so the ladder reaches GSD executor subagents.
- **Files modified:** `.claude/settings.json`, `CLAUDE.md`
- **Committed in:** `1367dfb`

---

**Total deviations:** 2 (1 blocking command-mismatch, 1 mandated-tool scope add)
**Impact on plan:** Both necessary — the plan could not complete as literally written, and the ponytail add closes a standing project mandate. No unrequested scope creep.

## Issues Encountered
- graphify's MCP server failed on first run (`ModuleNotFoundError: mcp`) — the base package doesn't bundle the MCP transport. Resolved by reinstalling with `--with mcp`.
- Every commit triggers a background graph rebuild that re-dirties `graphify-out/graph.json`. Committed the settled graph once; future churn is left to periodic re-commits (the hook keeps the local graph fresh regardless).

## User Setup Required
**One manual step remains for full Task 2 verification:** restart Claude Code so it loads `.mcp.json` and the `graphify` MCP server connects (confirm via `/mcp`). The server is already proven working standalone; only Claude Code's session-load of it is pending a restart. The post-commit hook auto-update is already confirmed firing.

## Next Phase Readiness
- Both token-budget tools are active for the remaining Phase-1 plans (01-06 → 01-09) and all later phases.
- Recommend running remaining plans **sequentially** (not parallel waves) with graphify + ponytail in the loop to keep sessions budgeted.

---
*Phase: 01-foundation-governance-substrate*
*Completed: 2026-07-09*
