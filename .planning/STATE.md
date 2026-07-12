---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Completed 03-05-PLAN.md
last_updated: "2026-07-12T02:40:06.964Z"
last_activity: "2026-07-12 — Phase 3 execution complete: 03-05 guardrails phase gate green (smoke:guardrails + smoke:pipeline)"
progress:
  total_phases: 13
  completed_phases: 1
  total_plans: 23
  completed_plans: 20
  percent: 87
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-09)

**Core value:** A user speaks or types a goal and the system reliably plans it, shows the plan for a single approval before anything leaves the building (approve once → hands-off governed execution, notify + halt), executes it with guardrails (cost, PII, quality), and follows through to real delivery (email) — with a full audit trail. *(Per-plan approval, 2026-07-10.)*
**Current focus:** Phase 3 — Guardrails

## Current Position

Phase: 3 (Guardrails) EXECUTION COMPLETE — all 5 plans executed (wave 4 done: 03-05 phase gate green). Awaiting /gsd:verify-work.
Plan: 03-05 executed (smoke:guardrails — the dev-deployment phase gate — PASSED all six sections against a live `convex dev` deployment: action-cache tenant isolation + model-free hit via the llm.called draft-row count oracle (GRDL-04); real primary-failure fallback still reaching review (GRDL-05); kill-switch + daily-budget governed stops on BOTH prepare AND mid-flight preCall → one `blocked` terminal, NEVER the DLQ; submit-limiter rejects the 6th consume (GRDL-06); zero raw PII across audit/deadLetters/telemetry (GRDL-02). seedPipeline parameterized (tenant+goal); five assertions + assertAtReview + three limiter drivers added; smoke:pipeline regression still green; failure-proof try/finally cleanup left kill switch OFF and spend window reset). 03-04 executed (THE LLM choke point closed: llm.ts reads redacted text ONLY via getSafeTextByHash — getForDelivery/.goal removed, static-scan enforced GRDL-01/02; route/draft wrappers front the tenant-namespaced action cache with sentinel-first short-circuit + preCall governed gate + timestamp-inferred cacheHit; real CHEAP_MODEL fallback in-action audited by error name; pipeline runs prepare BEFORE route → ONE governed blocked terminal, priced recordSpend per real call, LLM steps retry:false; smoke:pipeline green). 03-03 executed (guardrails.ts prepare/preCall/getSafeTextByHash/recordSpend/setKillSwitch; submit rate limit; contentHash → lib/hash.ts). 03-02 executed (action-cache 0.3.1 + guardrail schema rails); 03-01 executed (pii SafeText brand, @pikar/cost). NEXT: /gsd:verify-work for Phase 3 (all GRDL SCs asserted live). 02-01…02-07 executed; 02-08/02-09 SUPERSEDED by Phase 3.1 (not verified, not deleted)
Status: Phase 2 backend spine COMPLETE (routing, drafting, review-gate mechanics, Gmail delivery, DLQ, telemetry, audit, migrations, aggregate) — unblocks Phase 3. The interim submit-form + review-queue UI shipped ad-hoc but is superseded by the Email Chat Cockpit: the `/submit` form and `/review` queue-gate are retired UX (kept on disk, retired later), while `/connect-gmail` (cockpit prerequisite), the ops page (OPSG-07), and `ReconnectBanner` (DLVR-03) SURVIVE and are reused by the cockpit. Phase 2 SC-1 (submit + live status) and SC-2 (see-plan + approve/edit/reject) end-user verification is reassigned to Phase 3.1's manual checkpoint. Phase 1's 01-08/01-09 remain deferred human checkpoints (Phase 9).
Last activity: 2026-07-12 — Phase 3 execution complete: 03-05 guardrails phase gate green (smoke:guardrails + smoke:pipeline)

Progress: [█████████░] 87%

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
| Phase 03 P02 | 15 | 3 tasks | 7 files |
| Phase 03 P03 | 30 | 3 tasks | 5 files |
| Phase 03 P04 | 12 | 3 tasks | 4 files |
| Phase 03 P05 | 35 | 2 tasks | 4 files |

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
- [Phase 08 — SkillOpt deployment model 2026-07-12]: SkillOpt runs as a **no-sidecar batch runner** (GitHub Actions / local cron executing the Python tool nightly; trajectory export + registry write-back via authenticated `convex/http.ts` endpoints) — NOT a hosted Python sidecar. The original "third sidecar" assumption died when the PRD dropped the sidecar plane (PII went pure-TS); SkillOpt is an offline batch job emitting a static best_skill.md, so it needs no live service. Kill switch = disable the schedule; rollback = activateSkill (unchanged). Escalate to a hosted sidecar only on demonstrated need. Amends: research/SKILLOPT.md (dated update section added; sidecar risk line superseded)
- [Phase 03 — PII engine decided 2026-07-12]: v1 PII engine is pure-TS `packages/pii` — NO Presidio sidecar (a deployment plane for one function), NO cloud DLP API (adds a processor for restricted-scope Gmail-derived text → bigger CASA surface). Spike shipped: `scanText(unknown) → Result<PiiScanResult, PiiScanError>` detecting email/card(Luhn)/SSN/phone → stable placeholders ([EMAIL_1]…), fail-closed on non-string input (GRDL-01), `counts` is the only log-safe summary, `entities` never logged (CLAUDE.md §4); 8 tests green, typecheck clean. safeTextHash is the convex adapter's job (no node:crypto in the package). Phase 3 planning must resolve the flagged tensions (names-in-prose vs drafting utility; GRDL-04 cache-collision semantics; fail-closed UX) — see `.planning/design/pii-engine.md`. Amends: PROJECT.md Tech-stack constraint (open decision → decided) + Key Decisions row added; ROADMAP Phase 3 PII-engine note added
- [PRD — re-baseline 2026-07-12]: PROJECT.md + REQUIREMENTS.md re-baselined to absorb the three 2026-07-10/11 scope decisions they had drifted from: (1) core-value + REVW-01 redefined to per-PLAN approval; (2) `gmail.modify` restricted-scope constraints (annual CASA, zero-retention LLM contract) added to PRD Constraints; (3) cockpit named in PRD Active requirements + CKPT-01/02/03 minted for slices 2–4 (mapped to Phases 3.2/3.3/3.4 in traceability and roadmap). Also: Python-sidecar assumption removed from the PRD stack (none built; Phase 3 PII approach is an open decision), Key Decisions outcomes recorded (were all "Pending"), requirement count closed at 43. **Process rule going forward: any [PRODUCT]/[LEGAL] decision logged here must name the PRD/REQUIREMENTS line it amends in the same entry, or the decision isn't done**
- [Cockpit — supersede 02-08/09, 2026-07-12]: 02-08 (submit form) + 02-09 (review queue/gate/ops/connect-gmail/reconnect) code already existed on disk (built ad-hoc during auth work), never got SUMMARY files or their blocking human-verify checkpoints. Rather than finish+verify UX the cockpit retires, they are SUPERSEDED by Phase 3.1. RETIRED UX: `/submit` form, `/review` queue + collapsed gate (cockpit approves at the PLAN, not a mid-run gate). SURVIVES & reused by cockpit (do NOT delete): `/connect-gmail` (prerequisite), ops page (OPSG-07), `ReconnectBanner` (DLVR-03) — verified real (markResolved/buildAuthorizeUrl/awaiting_reauth present). Nothing deleted now (design: retired pages "Kept, retired later"). Phase 2 backend spine complete → unblocks Phase 3. SC-1/SC-2 end-user verification reassigned to 3.1's manual checkpoint
- [Cockpit — roadmap 2026-07-12]: Email Chat Cockpit slices registered as decimal phases **3.1 Cockpit Core, 3.2 Inbox Reading, 3.3 Attachment Generation, 3.4 Per-Recipient Personalization** (INSERTED after Phase 3, before Phase 4 — zero renumber of existing 4–9). Sequenced AFTER Guardrails; the cockpit REPLACES Phase 2's /submit form + /review queue UX while reusing the governed backend spine unchanged. Slice 1 reshapes INTK-01/AGNT-02/REVW-01/DLVR-01 UX (no new v1 ID); slices 2–4 are new capabilities with no prior v1 ID (formal REQUIREMENTS.md IDs are a follow-up if wanted). Source: `.planning/design/email-chat-cockpit.md`. total_phases 9→13
- [Phase 03 — 03-01 domain logic]: Guardrail domain logic is pure-TS in packages/* (CLAUDE.md §1). `@pikar/cost` (new workspace pkg) fails closed — estimateCostUsd/priceUsage/chooseModel return Result (unknown model → Err, over-budget → Err, never NaN/throw); GRDL-03 downgrade default→cheap proven by test. `chooseModel(safeText: SafeText, …)` is brand-only, so "cost estimated from redacted text" is a compile-time guarantee (GRDL-02/03). `isFallbackEligible` in @pikar/core (GRDL-05) classifies via SDK `.isInstance` statics (never instanceof, never reads message text): RetryError→unwrap lastError, APICallError→isRetryable, NoObjectGeneratedError→true, timeout/abort by name; config/auth/our-bugs→rethrow→DLQ. `ai@7.0.20` pinned exact in @pikar/core to match backend. estCents = max(1, ceil(usd*100)) — integer, fail-closed bias
- [Phase 02]: [Phase 02] Google is the Convex Auth sign-in provider (from @auth/core/providers/google — Convex Auth ships none); front-door scope is openid email profile ONLY, gmail.modify stays in the separate /connect-gmail flow. Authenticated shell lives under the (app) route group behind a default-deny middleware; dashboard at /dashboard (the group root would collide with the public / marketing page)
- [Phase 03]: [Phase 03] action-cache 0.3.1 registered + guardrail schema rails laid (safeText/hash fields, by_tenant_safeTextHash index, guardrailConfig kill-switch table, scanning/blocked statuses, blocked telemetry outcome) — NO migration (all optional/default-on-read, Pitfall 7)
- [Phase 03]: [Phase 03] guardrails.ts is the single guard choke point: prepare (kill-switch→PII scan+persist→cost/model→daily-spend check) and preCall share ONE discriminated governed-stop contract (RETURN, never throw — a governed stop is not a DLQ failure); getSafeTextByHash THROWS when redaction is missing so a model call cannot read raw goal text (GRDL-01); recordSpend reserves actual spend into the daily window so the next request fails closed (GRDL-03); per-tenant submit rate limit rejects the (N+1)th submit with an INTK-04-shaped auditable outcome (GRDL-06)
- [Phase 03]: [Phase 03] 03-04 closed the LLM choke point: llm.ts reads redacted text ONLY via getSafeTextByHash (getForDelivery/.goal removed, static-scan enforced GRDL-01/02); route/draft wrappers front the tenant-namespaced action cache (key = tenantId/safeTextHash/model/skillVersion[/instructionHash], hash-only) with sentinel-first short-circuit + preCall governed gate + timestamp-inferred cacheHit; real fallback to CHEAP_MODEL in-action (audited by error NAME only); pipeline runs prepare BEFORE route, routes prepare+mid-flight-preCall stops to ONE governed blocked terminal (never DLQ), records priced spend per real call, LLM steps retry:false
- [Phase 03]: [Phase 03] 03-05 phase gate green: smoke:guardrails proves (live dev deployment) action-cache tenant isolation + model-free hit (llm.called draft-row count oracle), real primary-failure fallback, kill-switch + daily-budget governed stops on BOTH prepare and mid-flight preCall paths (one blocked terminal, never DLQ), submit-limiter rejection, and zero raw PII across audit/deadLetters/telemetry; smoke:pipeline regression still passes

### Pending Todos

None yet.

### Blockers/Concerns

- ~~**Requirement count discrepancy**~~ **CLOSED 2026-07-12:** count corrected 36→40 during roadmap creation; +3 CKPT IDs minted for cockpit slices 2–4 → **43 v1 requirements**, all mapped.
- **External clock (OAuth — updated 2026-07-12):** verification is now for `gmail.modify`, a **restricted** scope: 2–4+ week review PLUS an annual CASA third-party security assessment (~$500–4,500/yr) — longer than the old `gmail.send` sensitive-scope path. Cannot start until a legal entity exists (the reviewed privacy policy must name a real data controller) — deferred to Phase 9. Phases 2–8 run on Testing mode (100-user cap, 7-day token expiry handled). The LLM provider must be on zero-retention/no-training terms before restricted-scope data flows to it (hard Phase 3 constraint).
- **Pre-1.0 Convex components:** Workflow 0.2.x, Agent/RAG/Auth 0.x — pin versions; expect API churn.

## Session Continuity

Last session: 2026-07-12T02:29:13.724Z
Stopped at: Completed 03-05-PLAN.md
Resume file: None

**Local dev backend must stay running:** `convex dev` (NOT `--once`) — `--once`
pushes then stops the workpool, so async `onComplete`/scheduler steps never
advance and the smoke scripts hang. See 01-06-SUMMARY.md.
