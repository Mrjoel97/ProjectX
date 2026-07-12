# Graph Report - Pikar-Ai  (2026-07-12)

## Corpus Check
- 298 files · ~246,965 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 916 nodes · 1053 edges · 92 communities (79 shown, 13 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `66059698`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Architecture Patterns
- package.json
- Architecture Research
- biome.json
- Stack Research — Convex Revision
- skills.ts
- dependencies
- Playbook: Email Chat Cockpit
- ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages
- result.ts
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
- smokeAssert.ts
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
- pipeline.ts
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
- functions.ts
- auth.ts
- cards.tsx
- Playbook: Email Chat Cockpit
- Playbook: Audit Log & Dead-Letter Pipeline
- check-playbooks.mjs
- Playbook: <feature name>
- docs/

## God Nodes (most connected - your core abstractions)
1. `base()` - 12 edges
2. `Convex Create Component` - 12 edges
3. `Migrations Component Reference` - 12 edges
4. `Convex Quickstart` - 12 edges
5. `Pikar AI — Repository Conventions` - 11 edges
6. `Hot Path Rules` - 11 edges
7. `Convex Auth` - 11 edges
8. `Playbook: Email Chat Cockpit` - 10 edges
9. `Playbook: <feature name>` - 10 edges
10. `Playbook: Audit Log & Dead-Letter Pipeline` - 10 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (92 total, 13 thin omitted)

### Community 0 - "Architecture Patterns"
Cohesion: 0.17
Nodes (11): 1. Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter, 2. Raw `query`/`mutation`/`action` imports are BANNED outside the wrapper module, 3. The audit module is insert-only, 4. Audit and dead-letter payloads must be redaction-safe, 5. No hardcoded agent prompts — skills load from the registry, 6. Pinned pre-1.0 component versions must not be bumped casually, 7. Boot order, 8. Ponytail discipline — the laziest solution that works (MANDATED) (+3 more)

### Community 1 - "package.json"
Cohesion: 0.24
Nodes (7): crons, flagExpiringTokens, exportCursors (table), exportAudit, advanceCursor, auditSince, getCursor

### Community 2 - "Architecture Research"
Cohesion: 0.20
Nodes (7): deliverApprovedPlan, markPlanDone, send, setStatus, telemetry (table), terminalOutcome, writeTerminal

### Community 3 - "biome.json"
Cohesion: 0.20
Nodes (8): DEFAULT_CONFIG, getSafeTextByHash, preCall, prepare, rateLimiter, recordSpend, saveInstruction, setKillSwitch

### Community 4 - "Stack Research — Convex Revision"
Cohesion: 0.28
Nodes (6): buildTelemetry(), LlmUsage, ReviewOutcome, TelemetryRow, TerminalOutcome, OPSG01_KEYS

### Community 5 - "skills.ts"
Cohesion: 0.47
Nodes (4): parseRouting(), ParseRoutingResult, RoutingDecision, routingSchema

### Community 6 - "dependencies"
Cohesion: 0.40
Nodes (4): log, deadLetterRecipient, onPipelineComplete, deadLetters (table)

### Community 7 - "Playbook: Email Chat Cockpit"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 8 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.33
Nodes (5): ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages, Alternatives rejected, Consequences, Context, Decision

### Community 11 - "result.ts"
Cohesion: 0.31
Nodes (8): Answer, applyAnswer(), ApplyResult, dedupeAppend(), EmailIntentState, emptyIntent, nextQuestion, RecipientMode

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
Cohesion: 0.07
Nodes (29): AttachmentPicker(), UploadedAttachment, box, btn, Mode, REJECTION_COPY, retrier, workflow (+21 more)

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 62 - "smoke.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 64 - "smokeAssert.ts"
Cohesion: 0.12
Nodes (15): assertAtReview, assertBlocked, assertDeadLetter, assertDeadLetterReason, assertFallback, assertFanoutIdempotent, assertFanoutReachedAll, assertLlmCalledCount (+7 more)

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
Cohesion: 0.07
Nodes (22): modules, modules, modules, REQ, attachments (table), gmailTokens (table), guardrailConfig (table), skills (table) (+14 more)

### Community 170 - "pipeline.ts"
Cohesion: 0.20
Nodes (8): draft, Route, BlockReason, LABELS, REQUEST_STATUS, saveDraft, Usage, useVerbatimDraft

### Community 171 - "llm.ts"
Cohesion: 0.15
Nodes (13): draftCache, DraftResult, draftUncached, GenUsage, parseSmoke(), routeCache, RouteResult, routeUncached (+5 more)

### Community 176 - "smoke.ts"
Cohesion: 0.15
Nodes (12): pipelineWorkflow, assertSubmitRateLimited, boom, drainDailySpend, failingPipeline, recordReviewOutcome, resetDailySpend, reviewGate (+4 more)

### Community 180 - "requests.ts"
Cohesion: 0.33
Nodes (5): apps/web E2E (Playwright), Auth (storageState), Prerequisite: the local dev backend must be running, Running, Specs

### Community 181 - "migrations.ts"
Cohesion: 0.50
Nodes (3): backfillRequestDefaults, migrations, run

### Community 190 - "tokenExpiry.ts"
Cohesion: 0.09
Nodes (19): heading, panel, RFC-2822, { auth, signIn, signOut, store, isAuthenticated }, password, SendResult, buildAuthorizeUrl(), getForDelivery (+11 more)

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

### Community 217 - "functions.ts"
Cohesion: 0.07
Nodes (16): NAV, STATUS_COLOR, listNew, markResolved, newCount, addItem, listItems, tenantAction (+8 more)

### Community 228 - "cards.tsx"
Cohesion: 0.07
Nodes (28): badge(), box, btn, chip, dim, label, muted, Plan (+20 more)

### Community 232 - "Playbook: Email Chat Cockpit"
Cohesion: 0.12
Nodes (15): ADR-003: All LLM prompts live in a versioned skills registry, never in source, Alternatives rejected, Consequences, Context, Decision, Data flow, Dependencies & blast radius, How to change safely (+7 more)

### Community 233 - "Playbook: Audit Log & Dead-Letter Pipeline"
Cohesion: 0.12
Nodes (15): ADR-002: Insert-only audit log with redaction-safe payloads; WORM immutability lives outside Convex, Alternatives rejected, Consequences, Context, Decision, Data flow, Dependencies & blast radius, How to change safely (+7 more)

### Community 234 - "check-playbooks.mjs"
Cohesion: 0.17
Nodes (10): baselineFile, changed, covered, created, input, problems, sessionId, stale (+2 more)

### Community 235 - "Playbook: <feature name>"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 236 - "docs/"
Cohesion: 0.50
Nodes (3): `decisions/` — Architecture Decision Records (ADRs), docs/, `playbooks/` — one per feature/subsystem

## Knowledge Gaps
- **473 isolated node(s):** `Purpose`, `Key files`, `Dependencies & blast radius`, `Data flow`, `Invariants — what must never break` (+468 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log` connect `dependencies` to `auth.ts`, `pipeline.ts`, `llm.ts`, `smoke.ts`, `tokenExpiry.ts`, `audit.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `requests (table)` connect `cards.tsx` to `tenant.ts`, `smoke.ts`, `auth.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `pendingTimeouts (table)` connect `auth.ts` to `tenant.ts`, `smokeAssert.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `Purpose`, `Key files`, `Dependencies & blast radius` to the rest of the system?**
  _477 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `demo.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `auth.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07200929152148665 - nodes in this community are weakly interconnected._
- **Should `page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12418300653594772 - nodes in this community are weakly interconnected._