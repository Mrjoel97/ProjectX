---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 02-07-PLAN.md
last_updated: "2026-07-11T16:25:06.122Z"
last_activity: 2026-07-11 — Completed 02-07 (authenticated surface; OPSG-07, BETA-04)
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 18
  completed_plans: 15
  percent: 83
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-09)

**Core value:** A user speaks or types a goal and the system reliably plans it, executes it with guardrails (cost, PII, quality), lets the user approve/edit/reject before anything leaves the building, and follows through to real delivery (email) — with a full audit trail.
**Current focus:** Phase 2 — Thin End-to-End Slice

## Current Position

Phase: 2 of 9 (Thin End-to-End Slice)
Plan: 7 of 9 in current phase complete (02-01, 02-02, 02-03, 02-04, 02-05, 02-06, 02-07)
Status: Executing — 02-07 done (authenticated surface: Convex Auth swapped Password→Google [openid email profile only; gmail.modify stays in the separate /connect-gmail flow]; Next.js wired via ConvexAuthNextjsServerProvider + client provider + default-deny middleware.ts gating all non-public routes to /signin; authenticated (app) shell with nav + persistent OPSG-07 dead-letter badge bound to a live deadLetters.newCount query; /signin + /dashboard pages; @pikar/backend/api exposed as the web app's first Convex client surface; privacy policy now names Vercel AI Gateway + OpenAI as active processors). Remaining in Phase 2: 02-08, 02-09. Phase 1's 01-08/01-09 remain deferred human checkpoints (Phase 9).
Last activity: 2026-07-11 — Completed 02-07 (authenticated surface; OPSG-07, BETA-04)

Progress: [████████░░] 83%

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
| Phase 02 P01 | 65 | 3 tasks | 11 files |
| Phase 02 P03 | 8 | 3 tasks | 5 files |
| Phase 02 P02 | 28 | 3 tasks | 11 files |
| Phase 02 P05 | 30 | 3 tasks | 4 files |
| Phase 02 P06 | 35 | 3 tasks | 10 files |
| Phase 02 P07 | 35 | 3 tasks | 13 files |

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

- [PRODUCT — scope change 2026-07-10]: Pikar's agents get FULL mailbox access after a single explicit user consent (read, draft, send, organise) — not send-only. Therefore the Gmail scope is `gmail.modify`, NOT `gmail.send`. `gmail.modify` subsumes send and covers read + draft + labels, so ONE scope replaces several. Deliberately NOT requesting `https://mail.google.com/` (permanent delete) — that keeps "Pikar cannot delete your email" as a true, published guarantee
- [COST — restricted scope]: `gmail.modify` is a **restricted** scope (`gmail.send` was merely *sensitive*). Any app that stores or transmits restricted-scope data on servers — Pikar does, via Convex and the LLM provider — must pass an annual **CASA third-party security assessment**, ~$500–$4,500/yr paid to the assessor, repeated every 12 months. This is a permanent recurring cost of the product's core capability. Verification also takes longer than the sensitive-scope path
- [PRODUCT — approval granularity]: Approval moved from per-delivery to **per-plan**. The user approves the plan, then Pikar executes autonomously, notifies on stage completion, and can be halted. REVW-01 ("approve/edit/reject the generated response") must be re-read in this light before Phase 2 planning
- [LEGAL — restricted scope]: Google's restricted-scope policy forbids using that data to train/improve generalised AI models. The Phase-3 LLM provider MUST therefore be contracted on zero-retention / no-training terms. This is now a hard constraint on provider selection, not a preference. Message content reaching an LLM provider must also be disclosed in the privacy policy processor list (it is)
- [LEGAL — third-party data]: Reading the mailbox means processing personal data of people who never agreed to anything with Pikar. The privacy policy places the lawful basis on the user (they instruct us to process it on their behalf). Worth a lawyer's eye — it is the single most exposed GDPR claim in the document
- [Phase 02]: [Phase 02] audit.log is the SOLE aggregate insert site — TableAggregate mirrored there covers OPSG-01 counting without Triggers; countAudit returns O(log n) with no .collect()
- [Phase 02]: [Phase 02] Migration harness proven live (OPSG-06): backfillRequestDefaults ran and recorded state=success; assertMigrationRan checks via migrations.getStatus by name. A migration that has never run is a migration that does not work
- [Phase 02]: [Phase 02] Intake trust boundary: validateSubmit is pure/tested and runs BEFORE workflow.start; recipient is the explicit validated To: field, never model-derived (INTK-04)
- [Phase 02]: [Phase 02] Rejection is redaction-safe: audit request.rejected payload is reason+counts+SHA-256 goalHash, never raw goal/recipient (CLAUDE.md §4); correlationId minted server-side
- [Phase 02]: [Phase 02] Executive Agent LLM surface: routingSchema+parseRouting put AGNT-03 no-silent-default in the type system (unknown_route thrown, never defaulted); llm.ts route/draft load prompts from the skills registry and call generateObject through the Vercel AI Gateway (bare string model id, no provider import)
- [Phase 02]: [Phase 02] LLM output/domain schemas (routingSchema, draftSchema) live in @pikar/contracts so the use-node convex adapter stays zod-free and thin (CLAUDE.md §1); draftSchema in contracts/drafting.ts, not inline in llm.ts
- [Phase 02]: [Phase 02] Gmail delivery: use-node send (gmail.ts) refreshes the access token on demand + POSTs the Gmail REST send; a dead/refresh-failed token routes to awaiting_reauth WITHOUT throwing (preserves the approved draft, resolves the 7-day expiry race for the user), and message id is recorded as an audit ref (refs only)
- [Phase 02]: [Phase 02] A new use-node action module joining the internal graph can tip sibling use-node actions past TS's circular-inference limit (gmail.ts tipped llm.ts to any); fix is explicit return-type annotations on the actions + runQuery results (Convex guidelines §96) — same remedy applies to the still-deferred smoke.ts pattern
- [Phase 02]: [Phase 02] Pipeline spine (02-06): one pipelineWorkflow sequences route→draft→review gate (regenerate loop)→Gmail delivery, staging requests.status at each stage; delivery uses step.runAction + workpool default retries (a workflow handler has no scheduler ctx for retrier.run), gmail.send's discriminated result drives sent-vs-awaiting_reauth
- [Phase 02]: [Phase 02] Failed terminal (OPSG-01) owned at the single onComplete choke point: deadLetter.onPipelineComplete patches requests.status=failed + inserts one failed telemetry row (redaction-safe, idempotent) so a mis-route never hangs at routing; both AGNT-03 reasons (unknown_route vs route_not_implemented) dead-letter distinctly
- [Phase 02]: [Phase 02] SMOKE::route goal sentinel in llm.route/draft forces routes deterministically offline (local backend has no AI_GATEWAY_API_KEY); keeps the REAL pipeline (gate/delivery/DLQ/telemetry) in the smoke loop with zero duplication — remove once a mock-gateway smoke exists
- [Phase 02]: [Phase 02] Web imports the Convex api via a @pikar/backend/api package export (source-export, added to transpilePackages) — the web app's first Convex client surface; being the first typechecked consumer of the generated api forced the deferred smoke.ts workflow.start self-reference fix (explicit handler return types, TS7022)
- [Phase 02]: [Phase 02] Google is the Convex Auth sign-in provider (from @auth/core/providers/google — Convex Auth ships none); front-door scope is openid email profile ONLY, gmail.modify stays in the separate /connect-gmail flow. Authenticated shell lives under the (app) route group behind a default-deny middleware; dashboard at /dashboard (the group root would collide with the public / marketing page)

### Pending Todos

None yet.

### Blockers/Concerns

- **Requirement count discrepancy:** REQUIREMENTS.md header says "36 v1 requirements" but the file contains 40 distinct IDs. Roadmap maps all 40; traceability corrected to 40. Confirm the intended count.
- **External clock (OAuth):** Google `gmail.send` verification (2–4 weeks, uncontrollable) must have paperwork submitted in Week 1 (Phase 1); beta ships on Testing-mode (100-user cap, 7-day token expiry handled).
- **Pre-1.0 Convex components:** Workflow 0.2.x, Agent/RAG/Auth 0.x — pin versions; expect API churn.

## Session Continuity

Last session: 2026-07-11T16:24:27.963Z
Stopped at: Completed 02-07-PLAN.md
Resume file: None

**Local dev backend must stay running:** `convex dev` (NOT `--once`) — `--once`
pushes then stops the workpool, so async `onComplete`/scheduler steps never
advance and the smoke scripts hang. See 01-06-SUMMARY.md.
