# Pikar AI — Repository Conventions

These conventions are binding for every contributor (human or agent). They encode the
architecture and governance decisions that later phases depend on.

## 1. Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter

All business logic belongs in framework-agnostic packages under `packages/*` (e.g.
`contracts`, `core`, and later `validation`, `pii`, `cost`, `llm-gateway`, `delivery`, ...).
Convex functions in `packages/backend/convex/` are **thin adapters** that import those
packages, read/write the DB, and orchestrate. This keeps domain logic portable (the lock-in
mitigation) and testable without Convex.

## 2. Raw `query`/`mutation`/`action` imports are BANNED outside the wrapper module

Do **not** import `query`, `mutation`, `action` (or their internal variants) directly from
`./_generated/server` in feature files. Import the tenant-scoped wrappers from
`convex/lib/functions.ts` instead (added in plan 02). A small, explicit internal allow-list
is the only exception. This is enforced by a Biome import rule (plan 02). The wrapper injects
`tenantId` scoping — the multi-tenant isolation linchpin.

## 3. The audit module is insert-only

The `audit` table is an append-only log. The audit module exposes **only insert functions** —
never `patch`, `replace`, or `delete`. True immutability/retention lives outside Convex via a
scheduled WORM export (S3 Object Lock). Do not add mutating audit functions.

## 4. Audit and dead-letter payloads must be redaction-safe

`audit.payload` and `deadLetters.payload` (and all structured log fields) carry **refs, hashes,
ids, and counts ONLY** — never raw user content or PII. Redaction happens before the write
(redact-then-write is a workflow-step ordering contract). The audit log must never become a
PII honeypot.

## 5. No hardcoded agent prompts — skills load from the registry

Agent/LLM prompts are **not** hardcoded in source. They are versioned rows in the `skills`
table (`name`, `version`, `body`, `status`) and loaded at runtime. Prompt changes flow through
the skill registry with rollback, not code edits.

## 6. Pinned pre-1.0 component versions must not be bumped casually

The Convex components (Workflow, Agent, RAG, Rate-Limiter, Action-Retrier) and Convex Auth are
pre-1.0 and pinned to EXACT versions (no `^`). Do not bump them without reading the changelog
and re-running the full boot check + tests. API churn is expected.

## 7. Boot order

`convex/_generated/` is git-ignored and produced by codegen. A fresh clone must run
`pnpm install` -> `npx convex dev` (creates the deployment + codegen) -> `pnpm dev`.
Typecheck fails before `_generated/` exists. See `README.md` for the verbatim steps and the
secrets-plane rules.

## 8. Ponytail discipline — the laziest solution that works (MANDATED)

`ponytail` (Claude Code plugin, enabled in `.claude/settings.json`) is a mandated build-tool.
Its hooks inject this ladder into the main session and every subagent; this section restates it
so the discipline holds even before the hooks load. **Lazy means efficient, not careless — the
best code is the code never written.** Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper/util/pattern that's already here.
3. Does the standard library already do this? Use it.
4. Does a native platform/framework feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs **after** you understand the problem, not instead of it: read the task and the
code it touches, trace the real flow end to end, then climb. Bug fix = root cause, not symptom —
grep every caller and fix the shared function once.

Rules: no abstractions that weren't explicitly requested; no new dependency if avoidable; no
unrequested boilerplate; deletion over addition, boring over clever, fewest files possible; the
shortest working diff wins (but only once you understand the problem). Mark intentional
simplifications with a `ponytail:` comment naming the ceiling and the upgrade path.

**Not lazy about:** understanding the problem, input validation at trust boundaries, error
handling that prevents data loss, security, accessibility, and anything explicitly requested.
Non-trivial logic leaves ONE runnable check behind (assert-based self-check or one small test
file — no frameworks/fixtures). Trivial one-liners need no test.

Review commands: `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`.

## 9. Playbooks and ADRs are part of definition-of-done

`docs/playbooks/` holds one playbook per feature/subsystem (invariants, how to change
safely, how to verify, operations); `docs/decisions/` holds immutable ADRs. Before
changing a subsystem that has a playbook, read it. A change that touches a playbook's
subsystem updates the playbook in the same commit/phase (and bumps its `Last verified`
line). A new significant architectural decision gets a new ADR; ADRs are never edited
after acceptance — supersede with a new one. See `docs/README.md`.

This is enforced by a Stop hook (`scripts/check-playbooks.mjs` + `docs/playbooks/watch.json`):
finishing a turn with code changed under a playbook's watched paths but the playbook
untouched is blocked, and so is finishing with new code files under `packages/`/`apps/`
that no playbook covers (resolve by extending an existing `watch.json` entry, creating a
playbook from `docs/playbooks/TEMPLATE.md` and registering it, or acknowledging the path
under `"_unassigned"`). New playbooks must register their watched path prefixes in
`watch.json` or the hook cannot protect them.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost),
  then `node scripts/extract-convex-edges.mjs` — rebuilds drop the injected Convex cross-module
  edges (`internal.*`/`api.*` references), and without them the delivery spine is invisible in
  the graph. A SessionStart hook also re-injects them each session.
