# Graph Report - Pikar-Ai  (2026-07-12)

## Corpus Check
- 210 files · ~162,504 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1734 nodes · 1712 edges · 154 communities (142 shown, 12 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `50ac5ee6`
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
- Implications for Roadmap
- Critical Pitfalls
- Detailed Rationale for Contested Decisions
- dependencies
- result.ts
- compilerOptions
- Phase 1 Plan 01: Foundation & Governance Substrate Summary
- Phase 1 Plan 4: Skills Registry & Loader Summary
- v1 Requirements
- Feature Research
- Phase 1 Plan 2: Tenant-Scoping Substrate Summary
- Phase 1 Plan 03: Insert-Only Audit Module Summary
- Phase Details
- compilerOptions
- compilerOptions
- compilerOptions
- Pikar-AI
- Pikar AI — Repository Conventions
- Project State
- Common Pitfalls
- package.json
- package.json
- package.json
- Phase 1 — Validation Strategy
- audit.ts
- demo.ts
- Pikar AI
- layout.tsx
- importGuard.test.ts
- eventTypes.ts
- Executive Agent — Request Classifier (v1)
- boot-check.mjs
- auth.ts
- tsconfig.json
- tsconfig.json
- auditImmutability.test.ts
- index.ts
- tenant.ts
- Sidecars
- page.tsx
- next.config.ts
- convex.config.ts
- graphify
- Phase 01 / Plan 05: Graphify Activation + Ponytail Discipline Summary
- smoke.ts
- deadLetter.ts
- smokeAssert.ts
- Architecture Patterns
- run-smoke-reviewgate.mjs
- worm.test.ts
- wormCursor.ts
- crons.ts
- worm.ts
- run-smoke-worm.mjs
- Phase 01 Plan 07: WORM Export Cron Stub Summary
- Architecture Patterns
- providers.tsx
- buildTelemetry.test.ts
- notifications.ts
- requests.ts
- tokenExpiry.test.ts
- Architecture Patterns
- buildTelemetry.ts
- result.ts
- telemetry.ts
- tenant.ts
- Executive Agent — Router (v1)
- Email Drafter (v1)
- executiveAgentClassifier.ts
- tokenExpiry.ts
- auth.ts
- Phase 2 Plan 04: Review Gate Decision Union + Write-Once Telemetry Summary
- Architecture Patterns
- llm.ts
- Phase 2 Plan 02: Executive Agent LLM Surface Summary
- drafting.ts
- Phase 2 Plan 05: Gmail Delivery Integration Summary
- Architecture Patterns
- pipeline.ts
- deadLetters.test.ts
- Architecture Patterns
- review.ts
- run-smoke-dlq.mjs
- run-smoke-pipeline.mjs
- page.tsx
- layout.tsx
- page.tsx
- Phase 2 Plan 07: Authenticated Surface Summary
- AttachmentPicker.tsx
- page.tsx
- page.tsx
- run-seed.mjs
- Email Chat Cockpit
- ReconnectBanner.tsx
- Convex Authentication Setup
- Auth0
- Clerk
- WorkOS AuthKit
- Convex Authentication Setup
- Architecture Patterns
- Packaged Convex Components
- Packaged Convex Components
- 01-08 Summary — Public web surface (PARTIAL)
- Phase 2: Thin End-to-End Slice - Research
- Code Examples
- Phase 2 — Validation Strategy
- Common Pitfalls
- Advanced Component Patterns
- Hybrid Convex Components
- Local Convex Components
- Advanced Component Patterns
- Hybrid Convex Components
- Local Convex Components
- Convex
- Convex
- Validation Architecture
- User Constraints (from CONTEXT.md)
- Standard Stack
- Sources

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 14 edges
2. `Phase Details` - 14 edges
3. `Architecture Patterns` - 14 edges
4. `Phase 2: Thin End-to-End Slice - Research` - 14 edges
5. `compilerOptions` - 13 edges
6. `Phase 1: Foundation & Governance Substrate - Research` - 13 edges
7. `Critical Pitfalls` - 13 edges
8. `Stack Research — Convex Revision` - 13 edges
9. `base()` - 12 edges
10. `v1 Requirements` - 12 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (154 total, 12 thin omitted)

### Community 0 - "Architecture Patterns"
Cohesion: 0.04
Nodes (45): Alternatives Considered, Architecture Patterns, Code Examples, Common Pitfalls, Core, Don't Hand-Roll, Metadata, Open Questions (+37 more)

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (32): devDependencies, @biomejs/biome, turbo, typescript, engines, node, name, packageManager (+24 more)

### Community 2 - "Architecture Research"
Cohesion: 0.07
Nodes (29): Anti-Pattern 1: Reaching for microservices on day one, Anti-Pattern 2: Putting LLM/tool calls in a determinism-constrained workflow engine, Anti-Pattern 3: Proxying realtime audio through your backend, Anti-Pattern 4: Bolting on audit/PII/cost after the pipeline works, Anti-Pattern 5: Cross-tenant cache/state leakage, Anti-Patterns, Architectural Patterns, Architecture Research (+21 more)

### Community 3 - "biome.json"
Cohesion: 0.07
Nodes (27): files, ignoreUnknown, includes, formatter, enabled, indentStyle, indentWidth, lineWidth (+19 more)

### Community 4 - "Stack Research — Convex Revision"
Cohesion: 0.07
Nodes (26): 10. Rate limiting / cost kill-switch, 1. Orchestration: Convex Workflow component (replaces Inngest), 2. Auth: Convex Auth (replaces Better Auth for the beta), 3. Vector search + GraphRAG modeling, 4. Realtime UX (subscriptions), 5. Python sidecars + file storage, 6. Audit / compliance, 7. Scheduled functions (watchdog + token refresh) (+18 more)

### Community 5 - "skills.ts"
Cohesion: 0.09
Nodes (24): draft, GenUsage, parseSmokeRoute(), Route, SMOKE_ROUTES, ZERO_USAGE, activateSkill, getActiveSkill (+16 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (36): dependencies, ai, @auth/core, convex, @convex-dev/action-retrier, @convex-dev/agent, @convex-dev/aggregate, @convex-dev/auth (+28 more)

### Community 7 - "Implications for Roadmap"
Cohesion: 0.08
Nodes (24): Architecture Approach, Confidence Assessment, Convex Revision (2026-07-09), Critical Pitfalls, Executive Summary, Expected Features, Gaps to Address, Implications for Roadmap (+16 more)

### Community 8 - "Critical Pitfalls"
Cohesion: 0.08
Nodes (23): Critical Pitfalls, Integration Gotchas, "Looks Done But Isn't" Checklist, Performance / Cost Traps, Pitfall 10: Durable-orchestration learning curve eats the timeline, Pitfall 11: Integration scope creep (the "provider-agnostic adapter" trap), Pitfall 12: Multi-user isolation retrofitted instead of designed in, Pitfall 1: Google OAuth verification silently kills the 4-week plan (Gmail send) (+15 more)

### Community 9 - "Detailed Rationale for Contested Decisions"
Cohesion: 0.08
Nodes (23): Alternatives Considered, Auth: Better Auth (over Auth.js / Clerk), Core Technologies, Detailed Rationale for Contested Decisions, Development Tools, Email: own adapter, not Nylas, Executive Recommendation (one-liner per decision), Installation (+15 more)

### Community 10 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, @auth/core, convex, @convex-dev/auth, next, @pikar/backend, @pikar/contracts, @pikar/core (+17 more)

### Community 11 - "result.ts"
Cohesion: 0.08
Nodes (16): onPipelineComplete, terminalOutcome, writeTerminal, buildTelemetry(), LlmUsage, ReviewOutcome, TelemetryRow, TerminalOutcome (+8 more)

### Community 12 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, allowJs, allowSyntheticDefaultImports, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module (+7 more)

### Community 13 - "Phase 1 Plan 01: Foundation & Governance Substrate Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 14 - "Phase 1 Plan 4: Skills Registry & Loader Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 15 - "v1 Requirements"
Cohesion: 0.11
Nodes (17): Discoverability, Email Cockpit, Executive Agent & Planning, Expansion, Governance & Operations, Guardrails, Human Review & Delivery, Intake & Enrichment (+9 more)

### Community 16 - "Feature Research"
Cohesion: 0.12
Nodes (15): Add After Validation (v1.x), Anti-Features (Commonly Requested, Often Problematic), Competitive Landscape Snapshot (mid-2026), Competitor Feature Analysis, Dependency Notes, Differentiators (Competitive Advantage), Feature Dependencies, Feature Landscape (+7 more)

### Community 17 - "Phase 1 Plan 2: Tenant-Scoping Substrate Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 18 - "Phase 1 Plan 03: Insert-Only Audit Module Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 19 - "Phase Details"
Cohesion: 0.11
Nodes (18): Overview, Phase 1: Foundation & Governance Substrate, Phase 2: Thin End-to-End Slice, Phase 3.1: Cockpit Core (INSERTED), Phase 3.2: Inbox Reading (INSERTED), Phase 3.3: Attachment Generation (INSERTED), Phase 3.4: Per-Recipient Personalization (INSERTED), Phase 3: Guardrails (+10 more)

### Community 20 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+6 more)

### Community 21 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, jsx, module, moduleResolution, noEmit, skipLibCheck, types (+3 more)

### Community 22 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, incremental, jsx, module, moduleResolution, noEmit, plugins, exclude (+2 more)

### Community 23 - "Pikar-AI"
Cohesion: 0.18
Nodes (10): Active, Constraints, Context, Core Value, Key Decisions, Out of Scope, Pikar-AI, Requirements (+2 more)

### Community 24 - "Pikar AI — Repository Conventions"
Cohesion: 0.18
Nodes (10): 1. Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter, 2. Raw `query`/`mutation`/`action` imports are BANNED outside the wrapper module, 3. The audit module is insert-only, 4. Audit and dead-letter payloads must be redaction-safe, 5. No hardcoded agent prompts — skills load from the registry, 6. Pinned pre-1.0 component versions must not be bumped casually, 7. Boot order, 8. Ponytail discipline — the laziest solution that works (MANDATED) (+2 more)

### Community 25 - "Project State"
Cohesion: 0.20
Nodes (9): Accumulated Context, Blockers/Concerns, Current Position, Decisions, Pending Todos, Performance Metrics, Project Reference, Project State (+1 more)

### Community 26 - "Common Pitfalls"
Cohesion: 0.25
Nodes (8): out, out, backendDir, convexBin, invoke(), must(), pollPass(), IMPORTANT: on Windows + Node 24 the convex CLI process can crash during exit

### Community 27 - "package.json"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 28 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, zod, devDependencies, vitest, exports, name, private, scripts (+4 more)

### Community 29 - "package.json"
Cohesion: 0.18
Nodes (10): devDependencies, vitest, exports, name, private, scripts, test, typecheck (+2 more)

### Community 30 - "Phase 1 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 1 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 31 - "audit.ts"
Cohesion: 0.22
Nodes (8): auditCounts, backfillAuditCounts, countAudit, log, AuditHash, AuditPayload, AuditPayloadValue, AuditRef

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
Cohesion: 0.13
Nodes (16): { auth, signIn, signOut, store, isAuthenticated }, password, buildAuthorizeUrl(), flagExpiringTokens, getForDelivery, getTokens, gmailConnectUrl, gmailStatus (+8 more)

### Community 40 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 41 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 43 - "index.ts"
Cohesion: 0.08
Nodes (24): Agent Mode, Checklist, Convex Quickstart, Development vs Production, Environment variables, Install, Next.js (App Router), Next Steps (+16 more)

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 61 - "Phase 01 / Plan 05: Graphify Activation + Ponytail Discipline Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+6 more)

### Community 62 - "smoke.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 63 - "deadLetter.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 64 - "smokeAssert.ts"
Cohesion: 0.22
Nodes (8): backfillRequestDefaults, migrations, run, assertDeadLetter, assertDeadLetterReason, assertMigrationRan, assertPipelineDelivered, assertReviewOutcome

### Community 65 - "Architecture Patterns"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 66 - "run-smoke-reviewgate.mjs"
Cohesion: 0.09
Nodes (21): Accepted risks, Auth, Gmail OAuth, tokens, Claude's Discretion, Content plane vs log plane (CLAUDE.md §4 boundary), Correlation and identifiers, Deferred Ideas, Established Patterns, Executive Agent — routing and LLM surface (+13 more)

### Community 67 - "worm.test.ts"
Cohesion: 0.10
Nodes (20): 1. Use point-in-time reads when live updates are not valuable, 2. Batch related data into fewer queries, 3. Use skip to avoid unnecessary subscriptions, 4. Isolate frequently-updated fields into separate documents, 5. Use the aggregate component for counts and sums, 6. Narrow query read sets, 7. Remove `Date.now()` from queries, 8. Consider pagination strategy (+12 more)

### Community 68 - "wormCursor.ts"
Cohesion: 0.50
Nodes (3): advanceCursor, auditSince, getCursor

### Community 71 - "run-smoke-worm.mjs"
Cohesion: 0.10
Nodes (20): 1. Use point-in-time reads when live updates are not valuable, 2. Batch related data into fewer queries, 3. Use skip to avoid unnecessary subscriptions, 4. Isolate frequently-updated fields into separate documents, 5. Use the aggregate component for counts and sums, 6. Narrow query read sets, 7. Remove `Date.now()` from queries, 8. Consider pagination strategy (+12 more)

### Community 72 - "Phase 01 Plan 07: WORM Export Cron Stub Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+6 more)

### Community 73 - "Architecture Patterns"
Cohesion: 0.40
Nodes (4): 02-06 execution — pre-existing test failure (out of scope), 02-06 execution — pre-existing typecheck failures (out of scope), Phase 02 — Deferred Items, Pre-existing `tsc --noEmit` failures in backend test files (found during 02-01, Task 1)

### Community 75 - "buildTelemetry.test.ts"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 76 - "notifications.ts"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 77 - "requests.ts"
Cohesion: 0.40
Nodes (3): box, btn, Mode

### Community 78 - "tokenExpiry.test.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 79 - "Architecture Patterns"
Cohesion: 0.20
Nodes (9): Dependency graph, Deviations from Plan, Metrics, Out-of-scope (logged, not fixed), Phase 2 Plan 03: Intake Trust Boundary Summary, Self-Check: PASSED, Tech tracking, Verification (+1 more)

### Community 80 - "buildTelemetry.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 81 - "result.ts"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 82 - "telemetry.ts"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 83 - "tenant.ts"
Cohesion: 0.12
Nodes (9): modules, modules, modules, modules, sources, Brand, CONTRACTS_PACKAGE_NAME, TENANT_FIELD (+1 more)

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

### Community 89 - "Phase 2 Plan 04: Review Gate Decision Union + Write-Once Telemetry Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+6 more)

### Community 90 - "Architecture Patterns"
Cohesion: 0.33
Nodes (3): RFC-2822, send, SendResult

### Community 91 - "llm.ts"
Cohesion: 0.12
Nodes (15): Cancel a Running Migration, Check Migration Status, Configuration Options, Custom Batch Size, Define a Migration, Dry Run, Installation, Migrate a Subset Using an Index (+7 more)

### Community 92 - "Phase 2 Plan 02: Executive Agent LLM Surface Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 93 - "drafting.ts"
Cohesion: 0.12
Nodes (15): 1. Reduce read set size, 2. Split hot documents, 3. Move non-critical work to scheduled functions, 4. Combine competing writes, Broad read sets causing false conflicts, Common Causes, Core Principle, Fan-out from triggers or cascading writes (+7 more)

### Community 94 - "Phase 2 Plan 05: Gmail Delivery Integration Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Issues Encountered, Metrics (+7 more)

### Community 95 - "Architecture Patterns"
Cohesion: 0.12
Nodes (15): 1. Scope the problem, 2. Trace the full read and write set, 3. Apply fixes from the relevant reference, 4. Fix sibling functions together, 5. Verify before finishing, Checklist, Convex Performance Audit, Escalate Larger Fixes (+7 more)

### Community 96 - "pipeline.ts"
Cohesion: 0.06
Nodes (37): listNew, markResolved, newCount, addItem, listItems, retrier, workflow, tenantMutation (+29 more)

### Community 97 - "deadLetters.test.ts"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 98 - "Architecture Patterns"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed / adapted, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 99 - "review.ts"
Cohesion: 0.17
Nodes (11): Adding a Required Field, Changing a Field Type, Cleaning Up Orphaned Documents, Deleting a Field, Dual Read, Dual Write (Preferred), Migration Patterns Reference, Small Table Shortcut (+3 more)

### Community 100 - "run-smoke-dlq.mjs"
Cohesion: 0.17
Nodes (11): Checklist, Concrete Steps, Convex Auth, Expected Files and Decisions, Gotchas, Human Handoff, Production, Validation (+3 more)

### Community 101 - "run-smoke-pipeline.mjs"
Cohesion: 0.17
Nodes (11): Adding a Required Field, Changing a Field Type, Cleaning Up Orphaned Documents, Deleting a Field, Dual Read, Dual Write (Preferred), Migration Patterns Reference, Small Table Shortcut (+3 more)

### Community 102 - "page.tsx"
Cohesion: 0.20
Nodes (17): PasswordField(), TextField(), ArrowIcon(), base(), BoltIcon(), BrainIcon(), CheckCircleIcon(), EyeIcon() (+9 more)

### Community 105 - "page.tsx"
Cohesion: 0.17
Nodes (11): Checklist, Concrete Steps, Convex Auth, Expected Files and Decisions, Gotchas, Human Handoff, Production, Validation (+3 more)

### Community 106 - "Phase 2 Plan 07: Authenticated Surface Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+8 more)

### Community 107 - "AttachmentPicker.tsx"
Cohesion: 0.20
Nodes (10): AttachmentPicker(), UploadedAttachment, REJECTION_COPY, Attachment, MIME_ALLOWLIST, RejectionReason, SubmitInput, base (+2 more)

### Community 109 - "page.tsx"
Cohesion: 0.18
Nodes (10): Auth0, Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 113 - "run-seed.mjs"
Cohesion: 0.18
Nodes (10): Checklist, Clerk, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 114 - "Email Chat Cockpit"
Cohesion: 0.20
Nodes (9): Backend flow & reuse map, Email Chat Cockpit, Error & edge handling (nothing sends on an assumption), Guided conversation (slot-filling), Layout & visual system, Multiple recipients, Scope of slice 1, Slices (each becomes a GSD phase) (+1 more)

### Community 115 - "ReconnectBanner.tsx"
Cohesion: 0.18
Nodes (10): Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation, What To Do (+2 more)

### Community 116 - "Convex Authentication Setup"
Cohesion: 0.18
Nodes (10): After Choosing a Provider, Checklist, Convex Authentication Setup, Core Pattern: Protecting Backend Functions, First Step: Choose the Auth Provider, Provider References, Reference Files, When Not to Use (+2 more)

### Community 117 - "Auth0"
Cohesion: 0.18
Nodes (10): Auth0, Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 118 - "Clerk"
Cohesion: 0.18
Nodes (10): Checklist, Clerk, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 119 - "WorkOS AuthKit"
Cohesion: 0.18
Nodes (10): Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation, What To Do (+2 more)

### Community 120 - "Convex Authentication Setup"
Cohesion: 0.18
Nodes (10): After Choosing a Provider, Checklist, Convex Authentication Setup, Core Pattern: Protecting Backend Functions, First Step: Choose the Auth Provider, Provider References, Reference Files, When Not to Use (+2 more)

### Community 121 - "Architecture Patterns"
Cohesion: 0.18
Nodes (11): Anti-Patterns to Avoid, Architecture Patterns, New schema tables (first schema change → register migrations FIRST), Pattern 1: The pipeline workflow (reuse the smoke.ts shape), Pattern 2: Submit-time validation gate (INTK-04), Pattern 3: Route dispatch = throw-into-DLQ, never default (AGNT-03), Pattern 4: Review gate reuse (REVW-01) — three required edits to `review.ts`, Pattern 5: Gmail OAuth + token lifecycle (DLVR-03) (+3 more)

### Community 122 - "Packaged Convex Components"
Cohesion: 0.25
Nodes (7): Build Flow, Checklist, Default Approach, Package Exports, Packaged Convex Components, Testing, When to Choose This

### Community 123 - "Packaged Convex Components"
Cohesion: 0.25
Nodes (7): Build Flow, Checklist, Default Approach, Package Exports, Packaged Convex Components, Testing, When to Choose This

### Community 124 - "01-08 Summary — Public web surface (PARTIAL)"
Cohesion: 0.25
Nodes (7): 01-08 Summary — Public web surface (PARTIAL), Commits, Deferred (NOT done), GDPR obligations a document cannot satisfy, The guard, Unverified claims in the legal documents, What shipped

### Community 125 - "Phase 2: Thin End-to-End Slice - Research"
Cohesion: 0.25
Nodes (7): Don't Hand-Roll, Metadata, Open Questions, Phase 2: Thin End-to-End Slice - Research, Phase Requirements, State of the Art, Summary

### Community 126 - "Code Examples"
Cohesion: 0.25
Nodes (8): Aggregate over audit (verified pattern), Attachment upload (Convex file storage, standard pattern), Code Examples, Convex Auth Google sign-in (verified), convex.config.ts — register the two new components (verified), Gmail send via raw REST, wrapped by retrier (verified endpoints), Migration client + first migration (verified), Structured routing via AI Gateway (verified pattern)

### Community 127 - "Phase 2 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 2 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 128 - "Common Pitfalls"
Cohesion: 0.29
Nodes (7): Common Pitfalls, Pitfall 1: convex-test cannot exercise component-backed workflows, Pitfall 2: `--once` and Windows exit codes, Pitfall 3: missing `refresh_token` from the Gmail consent, Pitfall 4: `_generated` not present / codegen order, Pitfall 5: raw `query`/`mutation` import ban, Pitfall 6: AI SDK in Convex Node runtime

### Community 129 - "Advanced Component Patterns"
Cohesion: 0.33
Nodes (5): Advanced Component Patterns, Class-based client wrappers, Deriving validators from schema, Function Handles for callbacks, Static configuration with a globals table

### Community 130 - "Hybrid Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Advice, Hybrid Convex Components, Risks, What This Means

### Community 131 - "Local Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Layout, Local Convex Components, When to Choose This, Workflow Notes

### Community 132 - "Advanced Component Patterns"
Cohesion: 0.33
Nodes (5): Advanced Component Patterns, Class-based client wrappers, Deriving validators from schema, Function Handles for callbacks, Static configuration with a globals table

### Community 133 - "Hybrid Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Advice, Hybrid Convex Components, Risks, What This Means

### Community 134 - "Local Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Layout, Local Convex Components, When to Choose This, Workflow Notes

### Community 135 - "Convex"
Cohesion: 0.40
Nodes (4): Convex, Route to the Right Skill, Start Here, When Not to Use

### Community 136 - "Convex"
Cohesion: 0.40
Nodes (4): Convex, Route to the Right Skill, Start Here, When Not to Use

### Community 137 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 138 - "User Constraints (from CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from CONTEXT.md)

### Community 139 - "Standard Stack"
Cohesion: 0.50
Nodes (4): Core (new dependencies to add), Do NOT add, Standard Stack, Supporting (already installed — reuse, do not re-add)

### Community 140 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence), Secondary (MEDIUM confidence), Sources, Tertiary (LOW confidence — validate at implementation)

## Knowledge Gaps
- **1212 isolated node(s):** `graphify-mcp`, `NAV`, `STATUS_COLOR`, `Mode`, `box` (+1207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `tenantQuery` connect `pipeline.ts` to `auth.ts`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `graphify-mcp`, `NAV`, `STATUS_COLOR` to the rest of the system?**
  _1215 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Architecture Patterns` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `Architecture Research` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `biome.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `Stack Research — Convex Revision` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._