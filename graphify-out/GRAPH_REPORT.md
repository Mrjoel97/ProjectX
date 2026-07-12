# Graph Report - Pikar-Ai  (2026-07-12)

## Corpus Check
- 334 files · ~288,556 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1015 nodes · 1155 edges · 109 communities (93 shown, 16 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3baf29e1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- functions.ts
- package.json
- page.tsx
- biome.json
- buildTelemetry.ts
- skills.ts
- Phase 03.2 Plan 03: Gmail Headers-Only Search Summary
- Playbook: Email Chat Cockpit
- ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages
- emailIntent.ts
- Project State
- Implementation Decisions (LOCKED)
- guardrails.ts
- pipeline.ts
- page.tsx
- layout.tsx
- page.tsx
- deadLetters.ts
- Phase 03.2.1: Agent-Driven Cockpit — Research
- deliverApprovedPlan.ts
- Phase 03.2.1 — Validation Strategy
- auth.ts
- guardrails.test.ts
- worm.test.ts
- Common Pitfalls
- audit.ts
- demo.ts
- Pikar AI
- layout.tsx
- importGuard.test.ts
- eventTypes.ts
- Executive Agent — Request Classifier (v1)
- boot-check.mjs
- auth.ts
- auditImmutability.test.ts
- tenant.ts
- Sidecars
- page.tsx
- next.config.ts
- convex.config.ts
- graphify
- smoke.ts
- worm.test.ts
- wormCursor.ts
- providers.tsx
- buildTelemetry.test.ts
- tokenExpiry.test.ts
- result.ts
- Executive Agent — Router (v1)
- Email Drafter (v1)
- executiveAgentClassifier.ts
- tokenExpiry.ts
- auth.ts
- review.ts
- run-smoke-dlq.mjs
- page.tsx
- page.tsx
- run-seed.mjs
- ReconnectBanner.tsx
- Convex Authentication Setup
- Packaged Convex Components
- Advanced Component Patterns
- Hybrid Convex Components
- Local Convex Components
- Convex
- scan.ts
- tenant.ts
- llm.ts
- drafting.ts
- llmRedaction.test.ts
- smoke.ts
- requests.ts
- migrations.ts
- tokenExpiry.ts
- tenant.ts
- Logger
- fallback.test.ts
- SplitPane.tsx
- run-smoke-fanout.mjs
- cockpitDraft.test.ts
- auth.ts
- Playbook: Email Chat Cockpit
- Playbook: Audit Log & Dead-Letter Pipeline
- check-playbooks.mjs
- Playbook: <feature name>
- docs/

## God Nodes (most connected - your core abstractions)
1. `Phase Details` - 16 edges
2. `base()` - 12 edges
3. `Convex Create Component` - 12 edges
4. `Migrations Component Reference` - 12 edges
5. `Convex Quickstart` - 12 edges
6. `Design — Agent-Driven Cockpit (capability #1)` - 11 edges
7. `Hot Path Rules` - 11 edges
8. `Convex Auth` - 11 edges
9. `Playbook: Email Chat Cockpit` - 10 edges
10. `Playbook: <feature name>` - 10 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (109 total, 16 thin omitted)

### Community 0 - "functions.ts"
Cohesion: 0.18
Nodes (11): activateSkill, loadSkill(), seedSkills, modules, EMAIL_DRAFTER_SKILL, EXECUTIVE_AGENT_CLASSIFIER_SKILL, EXECUTIVE_ROUTER_SKILL, LoadedSkill (+3 more)

### Community 1 - "package.json"
Cohesion: 0.15
Nodes (8): modules, modules, attachments (table), gmailTokens (table), pendingTimeouts (table), requests (table), skills (table), modules

### Community 2 - "page.tsx"
Cohesion: 0.17
Nodes (11): 10. Open questions, 1. Problem, 2. Goal, 3. Fixed frame — invariants that hold no matter what, 4. Architecture, 5. PII / redaction in the reasoning loop, 6. Guardrails, error handling, testing, 7. Rollout — clean cutover (+3 more)

### Community 3 - "biome.json"
Cohesion: 0.24
Nodes (7): crons, flagExpiringTokens, exportCursors (table), exportAudit, advanceCursor, auditSince, getCursor

### Community 4 - "buildTelemetry.ts"
Cohesion: 0.06
Nodes (37): badge(), box, btn, chip, ContactMatch, dim, label, matchHint() (+29 more)

### Community 5 - "skills.ts"
Cohesion: 0.47
Nodes (4): parseRouting(), ParseRoutingResult, RoutingDecision, routingSchema

### Community 6 - "Phase 03.2 Plan 03: Gmail Headers-Only Search Summary"
Cohesion: 0.10
Nodes (20): Overview, Phase 03.2.1: Agent-Driven Cockpit (INSERTED), Phase 1: Foundation & Governance Substrate, Phase 2: Thin End-to-End Slice, Phase 3.1: Cockpit Core (INSERTED), Phase 3.2: Inbox Reading (INSERTED), Phase 3.3: Attachment Generation (INSERTED), Phase 3.4: Per-Recipient Personalization (INSERTED) (+12 more)

### Community 7 - "Playbook: Email Chat Cockpit"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 8 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.33
Nodes (5): ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages, Alternatives rejected, Consequences, Context, Decision

### Community 9 - "emailIntent.ts"
Cohesion: 0.16
Nodes (19): RFC-5322, Answer, applyAnswer(), ApplyResult, ContactMatch, dedupeAppend(), dedupeNames(), EmailIntentState (+11 more)

### Community 10 - "Project State"
Cohesion: 0.18
Nodes (10): Accumulated Context, Blockers/Concerns, Current Position, Decisions, Pending Todos, Performance Metrics, Project Reference, Project State (+2 more)

### Community 11 - "Implementation Decisions (LOCKED)"
Cohesion: 0.17
Nodes (11): Claude's Discretion, Cutover, Deferred Ideas, Engine, Implementation Decisions (LOCKED), Phase 03.2.1: Agent-Driven Cockpit — Context, Phase Boundary, Redaction (§2-D) (+3 more)

### Community 12 - "guardrails.ts"
Cohesion: 0.20
Nodes (8): DEFAULT_CONFIG, getSafeTextByHash, preCall, prepare, recordSpend, saveInstruction, setKillSwitch, guardrailConfig (table)

### Community 13 - "pipeline.ts"
Cohesion: 0.22
Nodes (7): draft, Route, BlockReason, LABELS, saveDraft, Usage, useVerbatimDraft

### Community 14 - "page.tsx"
Cohesion: 0.15
Nodes (13): rateLimiter, retrier, workflow, contentHash(), pipelineWorkflow, REQUEST_STATUS, attachmentArg, get (+5 more)

### Community 15 - "layout.tsx"
Cohesion: 0.07
Nodes (16): NAV, STATUS_COLOR, listNew, markResolved, newCount, addItem, listItems, tenantAction (+8 more)

### Community 16 - "page.tsx"
Cohesion: 0.29
Nodes (5): box, btn, Mode, reviewGate, submitDecision

### Community 17 - "deadLetters.ts"
Cohesion: 0.28
Nodes (6): buildTelemetry(), LlmUsage, ReviewOutcome, TelemetryRow, TerminalOutcome, OPSG01_KEYS

### Community 18 - "Phase 03.2.1: Agent-Driven Cockpit — Research"
Cohesion: 0.25
Nodes (7): Files changed (from design §8), Locked decisions (from the design record — do not relitigate), Phase 03.2.1: Agent-Driven Cockpit — Research, Pitfalls / risks, Suggested plan decomposition (guidance — planner owns the final shape), Tool set (each wraps an existing governed primitive), Validation Architecture

### Community 19 - "deliverApprovedPlan.ts"
Cohesion: 0.14
Nodes (11): log, deadLetterRecipient, onPipelineComplete, deliverApprovedPlan, markPlanDone, send, setStatus, deadLetters (table) (+3 more)

### Community 20 - "Phase 03.2.1 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 03.2.1 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 26 - "Common Pitfalls"
Cohesion: 0.25
Nodes (8): out, out, backendDir, convexBin, invoke(), must(), pollPass(), IMPORTANT: on Windows + Node 24 the convex CLI process can crash during exit

### Community 31 - "audit.ts"
Cohesion: 0.22
Nodes (8): auditCounts, backfillAuditCounts, countAudit, audit (table), AuditHash, AuditPayload, AuditPayloadValue, AuditRef

### Community 32 - "demo.ts"
Cohesion: 0.08
Nodes (24): Agent Mode, Checklist, Convex Quickstart, Development vs Production, Environment variables, Install, Next.js (App Router), Next Steps (+16 more)

### Community 33 - "Pikar AI"
Cohesion: 0.18
Nodes (10): Clean-clone boot order (run verbatim), Common commands, Dev tooling — build discipline & repo knowledge graph, graphify — repo knowledge graph (query before you read), Pikar AI, ponytail — minimal-code discipline, Repository layout, Secrets plane (+2 more)

### Community 34 - "layout.tsx"
Cohesion: 0.25
Nodes (6): body, display, metadata, mono, convex, Providers()

### Community 35 - "importGuard.test.ts"
Cohesion: 0.40
Nodes (3): sources, NOTE: `internalQuery`/`internalMutation`/`internalAction` are NOT banned by, RAW_BUILDER_ALLOWLIST

### Community 37 - "Executive Agent — Request Classifier (v1)"
Cohesion: 0.40
Nodes (4): Decision principles, Executive Agent — Request Classifier (v1), Output contract, Routing decision

### Community 38 - "boot-check.mjs"
Cohesion: 0.40
Nodes (3): backend, NOTE: `convex codegen` requires a configured deployment (CONVEX_DEPLOYMENT in, root

### Community 39 - "auth.ts"
Cohesion: 0.17
Nodes (13): AttachmentPicker(), UploadedAttachment, REJECTION_COPY, generateUploadUrl, submit, Attachment, isValidEmail(), MIME_ALLOWLIST (+5 more)

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 62 - "smoke.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 67 - "worm.test.ts"
Cohesion: 0.10
Nodes (20): 1. Use point-in-time reads when live updates are not valuable, 2. Batch related data into fewer queries, 3. Use skip to avoid unnecessary subscriptions, 4. Isolate frequently-updated fields into separate documents, 5. Use the aggregate component for counts and sums, 6. Narrow query read sets, 7. Remove `Date.now()` from queries, 8. Consider pagination strategy (+12 more)

### Community 68 - "wormCursor.ts"
Cohesion: 0.13
Nodes (11): dropped, existing, fileId, files, g, nodeFile, nodeIds, raw (+3 more)

### Community 75 - "buildTelemetry.test.ts"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 78 - "tokenExpiry.test.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 81 - "result.ts"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 84 - "Executive Agent — Router (v1)"
Cohesion: 0.33
Nodes (5): Decision principles, Executive Agent — Router (v1), Output contract, Routes, Step plan

### Community 85 - "Email Drafter (v1)"
Cohesion: 0.40
Nodes (4): Drafting principles, Email Drafter (v1), Inputs, Output contract

### Community 86 - "executiveAgentClassifier.ts"
Cohesion: 0.12
Nodes (15): Cancel a Running Migration, Check Migration Status, Configuration Options, Custom Batch Size, Define a Migration, Dry Run, Installation, Migrate a Subset Using an Index (+7 more)

### Community 87 - "tokenExpiry.ts"
Cohesion: 0.12
Nodes (15): 1. Reduce read set size, 2. Split hot documents, 3. Move non-critical work to scheduled functions, 4. Combine competing writes, Broad read sets causing false conflicts, Common Causes, Core Principle, Fan-out from triggers or cascading writes (+7 more)

### Community 88 - "auth.ts"
Cohesion: 0.12
Nodes (15): 1. Scope the problem, 2. Trace the full read and write set, 3. Apply fixes from the relevant reference, 4. Fix sibling functions together, 5. Verify before finishing, Checklist, Convex Performance Audit, Escalate Larger Fixes (+7 more)

### Community 99 - "review.ts"
Cohesion: 0.17
Nodes (11): Adding a Required Field, Changing a Field Type, Cleaning Up Orphaned Documents, Deleting a Field, Dual Read, Dual Write (Preferred), Migration Patterns Reference, Small Table Shortcut (+3 more)

### Community 100 - "run-smoke-dlq.mjs"
Cohesion: 0.17
Nodes (11): Checklist, Concrete Steps, Convex Auth, Expected Files and Decisions, Gotchas, Human Handoff, Production, Validation (+3 more)

### Community 102 - "page.tsx"
Cohesion: 0.20
Nodes (17): PasswordField(), TextField(), ArrowIcon(), base(), BoltIcon(), BrainIcon(), CheckCircleIcon(), EyeIcon() (+9 more)

### Community 109 - "page.tsx"
Cohesion: 0.18
Nodes (10): Auth0, Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 113 - "run-seed.mjs"
Cohesion: 0.18
Nodes (10): Checklist, Clerk, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 115 - "ReconnectBanner.tsx"
Cohesion: 0.18
Nodes (10): Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation, What To Do (+2 more)

### Community 116 - "Convex Authentication Setup"
Cohesion: 0.18
Nodes (10): After Choosing a Provider, Checklist, Convex Authentication Setup, Core Pattern: Protecting Backend Functions, First Step: Choose the Auth Provider, Provider References, Reference Files, When Not to Use (+2 more)

### Community 122 - "Packaged Convex Components"
Cohesion: 0.25
Nodes (7): Build Flow, Checklist, Default Approach, Package Exports, Packaged Convex Components, Testing, When to Choose This

### Community 129 - "Advanced Component Patterns"
Cohesion: 0.33
Nodes (5): Advanced Component Patterns, Class-based client wrappers, Deriving validators from schema, Function Handles for callbacks, Static configuration with a globals table

### Community 130 - "Hybrid Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Advice, Hybrid Convex Components, Risks, What This Means

### Community 131 - "Local Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Layout, Local Convex Components, When to Choose This, Workflow Notes

### Community 135 - "Convex"
Cohesion: 0.40
Nodes (4): Convex, Route to the Right Skill, Start Here, When Not to Use

### Community 155 - "scan.ts"
Cohesion: 0.14
Nodes (19): Err, Ok, Result, unwrap(), chooseModel(), CostError, estimateCostUsd(), estimateTokens() (+11 more)

### Community 168 - "tenant.ts"
Cohesion: 0.12
Nodes (15): assertAtReview, assertBlocked, assertDeadLetter, assertDeadLetterReason, assertFallback, assertFanoutIdempotent, assertFanoutReachedAll, assertLlmCalledCount (+7 more)

### Community 171 - "llm.ts"
Cohesion: 0.14
Nodes (14): draftCache, draftCockpit, DraftResult, draftUncached, GenUsage, parseSmoke(), routeCache, RouteResult (+6 more)

### Community 176 - "smoke.ts"
Cohesion: 0.17
Nodes (11): assertSubmitRateLimited, boom, drainDailySpend, failingPipeline, recordReviewOutcome, resetDailySpend, reviewGate, runFailingPipeline (+3 more)

### Community 180 - "requests.ts"
Cohesion: 0.33
Nodes (5): apps/web E2E (Playwright), Auth (storageState), Prerequisite: the local dev backend must be running, Running, Specs

### Community 181 - "migrations.ts"
Cohesion: 0.50
Nodes (3): backfillRequestDefaults, migrations, run

### Community 190 - "tokenExpiry.ts"
Cohesion: 0.07
Nodes (21): heading, panel, RFC-2822, HeaderRecord, META_HEADERS, search, SearchResult, SendResult (+13 more)

### Community 191 - "tenant.ts"
Cohesion: 0.33
Nodes (4): Brand, CONTRACTS_PACKAGE_NAME, TENANT_FIELD, TenantId

### Community 201 - "Logger"
Cohesion: 0.28
Nodes (4): createLogger(), LogFields, Logger, LogLevel

### Community 210 - "SplitPane.tsx"
Cohesion: 0.70
Nodes (4): clamp(), readSaved(), SplitPane(), userKey()

### Community 215 - "run-smoke-fanout.mjs"
Cohesion: 0.40
Nodes (4): cids, needles, recipients, siblingCids

### Community 232 - "Playbook: Email Chat Cockpit"
Cohesion: 0.12
Nodes (15): ADR-003: All LLM prompts live in a versioned skills registry, never in source, Alternatives rejected, Consequences, Context, Decision, Data flow, Dependencies & blast radius, How to change safely (+7 more)

### Community 233 - "Playbook: Audit Log & Dead-Letter Pipeline"
Cohesion: 0.12
Nodes (15): ADR-002: Insert-only audit log with redaction-safe payloads; WORM immutability lives outside Convex, Alternatives rejected, Consequences, Context, Decision, Data flow, Dependencies & blast radius, How to change safely (+7 more)

### Community 234 - "check-playbooks.mjs"
Cohesion: 0.14
Nodes (14): ackFile, acks, baselineFile, changed, covered, created, git(), hashHits() (+6 more)

### Community 235 - "Playbook: <feature name>"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 236 - "docs/"
Cohesion: 0.50
Nodes (3): `decisions/` — Architecture Decision Records (ADRs), docs/, `playbooks/` — one per feature/subsystem

## Knowledge Gaps
- **531 isolated node(s):** `Overview`, `Phases`, `Phase 1: Foundation & Governance Substrate`, `Phase 2: Thin End-to-End Slice`, `Phase 3: Guardrails` (+526 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log` connect `deliverApprovedPlan.ts` to `llm.ts`, `pipeline.ts`, `page.tsx`, `smoke.ts`, `tokenExpiry.ts`, `audit.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `writeTerminal` connect `deliverApprovedPlan.ts` to `pipeline.ts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `telemetry (table)` connect `deliverApprovedPlan.ts` to `package.json`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `Overview`, `Phases`, `Phase 1: Foundation & Governance Substrate` to the rest of the system?**
  _536 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `buildTelemetry.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05893719806763285 - nodes in this community are weakly interconnected._
- **Should `Phase 03.2 Plan 03: Gmail Headers-Only Search Summary` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `layout.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06890756302521009 - nodes in this community are weakly interconnected._