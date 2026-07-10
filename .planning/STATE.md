---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 01 closed with 01-08 Tasks 2-3 and 01-09 deferred to Phase 9 (blocked on legal entity). Next -> /gsd:plan-phase 02
last_updated: "2026-07-10T02:45:00.000Z"
last_activity: 2026-07-10 — 01-08 Task 1 done (homepage + GDPR privacy + Terms); deploy/OAuth deferred to Phase 9; OPSG-06/07 added
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 9
  completed_plans: 7
  percent: 78
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-09)

**Core value:** A user speaks or types a goal and the system reliably plans it, executes it with guardrails (cost, PII, quality), lets the user approve/edit/reject before anything leaves the building, and follows through to real delivery (email) — with a full audit trail.
**Current focus:** Phase 1 — Foundation & Governance Substrate

## Current Position

Phase: 1 of 9 (Foundation & Governance Substrate)
Plan: 7 of 9 in current phase complete (01-01 … 01-07)
Status: Executing — remaining 01-08, 01-09 are BOTH human checkpoints
Last activity: 2026-07-10 — Completed 01-07 (WORM export cron stub + cursor mechanics, SC-4 WORM half)

Progress: [████████░░] 78%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 13 | 3 tasks | 34 files |
| Phase 01 P03 | 8 | 2 tasks | 7 files |
| Phase 01 P02 | 18 | 3 tasks | 8 files |
| Phase 01 P04 | 12 | 2 tasks | 5 files |
| Phase 01 P06 | 35 | 2 tasks | 9 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Stack]: Convex replaces Postgres/Redis/Inngest as the data + orchestration plane (2026-07-09).
- [Foundation]: `awaitEvent`-timeout race + `onComplete`-DLQ + insert-only-audit + WORM export are the "new learning cost" — established up front in Phase 1.
- [Voice]: Ships both modes in v1, staged — dictation (Phase 4) before live sessions (Phase 6).
- [Email]: Sequence Gmail (Phase 2) fully end-to-end before Microsoft Graph (Phase 9); never parallel.
- [Self-improvement]: Prompt-optimization loop is autonomous in v1 but eval-gated with rollback + kill switch (Phase 8).
- [Phase 01]: Source-export packages/* (no build step) resolve through Convex esbuild + Next transpilePackages; proven via @pikar/contracts import in convex/schema.ts
- [Phase 01]: TypeScript 7 removed baseUrl/non-relative paths; @pikar/* now resolves via pnpm workspace symlinks + package exports (no tsconfig paths)
- [Phase 01]: Audit is insert-only: single internalMutation write surface; immutability enforced by convention + static-scan test (OPSG-02)
- [Phase 01]: Tenant scoping is unavoidable: tenantQuery/tenantMutation inject tenantId (=userId) from identity; enforced by biome noRestrictedImports + static importGuard test (SC-2)
- [Phase 01]: Skills are immutable per version; change = new version row + activateSkill flip; rollback = re-activate a prior version. Seed body ships as a derived .ts constant (Convex cannot fs.read repo files) kept in sync with the canonical .md by a vitest assertion (SC-6)
- [Phase 01]: Workflow `onComplete` result kind for a failed run is `"failed"`, NOT `"error"` (01-RESEARCH and the 01-06 plan both had this wrong). deadLetter.ts guards with `if (result.kind === "success") return;` so any future kind fails INTO the DLQ rather than silently past it (01-06)
- [Phase 01]: Convex CLI crashes on exit teardown on Windows/Node24 (`UV_HANDLE_CLOSING`) returning a bogus exit code on BOTH success and failure paths. `scripts/smokeRun.mjs` judges pass/fail by matching the CLI failure banner in output; never trust `npx convex run` exit codes here (01-06)
- [Phase 01]: A `"use node"` module may contain ONLY actions — DB-touching cursor helpers live in a separate module (wormCursor.ts) reached via ctx.runQuery/runMutation. Actions cannot use ctx.db (01-07)
- [Phase 01]: WORM stub path must NOT advance the export cursor when WORM_BUCKET is unset — advancing would mark audit rows exported that never reached S3, a permanent hole in the compliance log. Phase 7 advances ONLY after a confirmed durable write (01-07)
- [Cross-phase]: S3 cannot be consolidated into Convex. WORM Object Lock (COMPLIANCE mode) is what makes the audit log credible — the system that writes the log must not be able to erase it (CLAUDE.md §3). Collapsing that platform is a compliance regression, not a simplification. Vercel and Google are likewise irreducible (Convex hosts no Next.js frontend; `gmail.send` is the product)
- [Cross-phase]: The maintenance lever is fewer hand-rolled modules, not fewer platforms — adopt Convex components rather than write equivalents
- [Phase 02]: `@convex-dev/migrations` adopted for OPSG-06. Adopt BEFORE the first schema change; retrofitting migrations onto a live deployment with un-tracked ad-hoc backfills is the expensive path
- [Phase 02]: `@convex-dev/aggregate` implements OPSG-01 counters. `audit` is append-only and unbounded, so a `.collect()`-based count eventually exceeds Convex read limits and HARD-FAILS rather than degrading
- [Phase 03]: `@convex-dev/action-cache` implements GRDL-04 (not a new requirement — GRDL-04 already specified a tenant-namespaced cache). Cache key MUST include `tenantId` alongside `safeTextHash`: action-cache keys on the action's args, so omitting tenantId serves one tenant's LLM response to another — a cross-tenant leak, not a cache miss
- [Auth]: STAY on `@convex-dev/auth` for v1. RBAC is EXPN-03 and teams are EXPN-06, both deferred; PROJECT.md: "v1 has a single user role", and BETA-01 already names Convex Auth. Clerk's org/RBAC feature set is the $300/mo Business plan and adds a platform (contra the consolidation goal); Better Auth is the natural in-Convex path IF EXPN-03/06 ever land. Convex Auth is beta (0.0.94) and Convex now promotes Better Auth — revisit at EXPN-03, not before. Migration cost is bounded because tenantQuery/tenantMutation already isolate the rest of the codebase from the identity provider

- [Sequencing]: Google OAuth verification (01-09) and the public deploy (01-08 Tasks 2–3) are DEFERRED to Phase 9. Verification reads a privacy policy that must name a real data controller, and no legal entity exists yet — so the 2–4 week clock cannot start regardless of whether we deploy. Gmail **Testing mode** (100 test users, sensitive scopes permitted unverified, 7-day token expiry) carries Phases 2–8. Phase 2 SC-5 already assumed this ("a Gmail token nearing its 7-day expiry prompts the user to re-auth"). Deploying now would publish a ToS naming "[LEGAL ENTITY — NOT YET FORMED]" for zero gain
- [Ops]: `convex deployment token create <name> --deployment prod --save-env <path>` mints a production deploy key from the CLI — deploy keys are NOT dashboard-only. `--save-env` writes it to a file so the secret never transits an agent's context. The key currently in `.env` is a `preview:` key (prefix names team:project); a production key's prefix names a deployment
- [Ops]: Background `convex dev` / `next start` do not survive a session compaction. A blank page at :3111 or `insights` reporting "local backend isn't running" means the process died, not that the code broke. `convex dev` also reports a bogus non-zero exit on Windows/Node24 — check `curl 127.0.0.1:3210/version` instead of trusting the exit code (same class of bug as the smokeRun.mjs workaround)
- [Phase 02]: OPSG-07 added — a dead-letter write must surface to the operator without database inspection. OPSG-05's full notification matrix stays in Phase 7, but the DLQ starts collecting failures in Phase 2, and a failure nobody sees is a failure nobody fixes

### Pending Todos

None yet.

### Blockers/Concerns

- **Requirement count discrepancy:** REQUIREMENTS.md header says "36 v1 requirements" but the file contains 40 distinct IDs. Roadmap maps all 40; traceability corrected to 40. Confirm the intended count.
- **External clock (OAuth):** Google `gmail.send` verification (2–4 weeks, uncontrollable) must have paperwork submitted in Week 1 (Phase 1); beta ships on Testing-mode (100-user cap, 7-day token expiry handled).
- **Pre-1.0 Convex components:** Workflow 0.2.x, Agent/RAG/Auth 0.x — pin versions; expect API churn.

## Session Continuity

Last session: 2026-07-10T02:45:00.000Z
Stopped at: Completed 01-07-PLAN.md (WORM export cron stub + cursor mechanics)
Resume file: None

**Local dev backend must stay running:** `convex dev` (NOT `--once`) — `--once`
pushes then stops the workpool, so async `onComplete`/scheduler steps never
advance and the smoke scripts hang. See 01-06-SUMMARY.md.
