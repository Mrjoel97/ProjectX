# Graph Report - Pikar-Ai  (2026-07-15)

## Corpus Check
- 434 files · ~612,871 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1486 nodes · 1617 edges · 145 communities (130 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `92fc09d8`
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
- 03.2.1-01-PLAN.md
- Common Pitfalls
- 03.2.1-02-PLAN.md
- 03.2.1-03-PLAN.md
- 03.2.1-04-PLAN.md
- 03.2.1-05-PLAN.md
- audit.ts
- demo.ts
- Pikar AI
- layout.tsx
- importGuard.test.ts
- eventTypes.ts
- Executive Agent — Request Classifier (v1)
- boot-check.mjs
- auth.ts
- 03.2.1-06-PLAN.md
- auditImmutability.test.ts
- tenant.ts
- Sidecars
- page.tsx
- next.config.ts
- convex.config.ts
- buildTelemetry.ts
- layout.tsx
- dependencies
- Phase 4: Attachment & Voice-Dictation Intake — Research
- intake.ts
- graphify
- Phase 04 Plan 02: Attachment Extractor Skill Summary
- smoke.ts
- Phase 4 Plan 04: Backend Intake Spine Summary
- Phase 4 Plan 05: Intake UI (IntakeControls.tsx + Playwright E2E) Summary
- Phase 4 Plan 06: Phase Close (Task 1 of 3 — PAUSED AT CHECKPOINT) Summary
- Phase 4 Plan 01: Extraction Foundation + Intake Playbook Summary
- worm.test.ts
- wormCursor.ts
- Goal Achievement
- Playbook: Attachment & Voice-Dictation Intake
- package.json
- page.tsx
- Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary
- providers.tsx
- buildTelemetry.test.ts
- intakeDb.ts
- Phase 4 — Validation Strategy
- tokenExpiry.test.ts
- Attachment Extractor (v1)
- IntakeControls.tsx
- result.ts
- tsconfig.json
- Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake)
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
- Playbook: Email Chat Cockpit
- Playbook: Audit Log & Dead-Letter Pipeline
- check-playbooks.mjs
- Playbook: <feature name>
- docs/

## God Nodes (most connected - your core abstractions)
1. `base()` - 29 edges
2. `Phase 4: Attachment & Voice-Dictation Intake — Research` - 20 edges
3. `Phase Details` - 18 edges
4. `v1 Requirements` - 14 edges
5. `scripts` - 13 edges
6. `Phase 3.5 Plan 04: Deferred Send — E2E + Phase Close Summary` - 13 edges
7. `Phase 4 Plan 05: Intake UI (IntakeControls.tsx + Playwright E2E) Summary` - 12 edges
8. `Phase 4 Plan 06: Phase Close (Task 1 of 3 — PAUSED AT CHECKPOINT) Summary` - 12 edges
9. `Phase 3.5 Plan 01: Deferred Send Foundation Summary` - 12 edges
10. `Phase 3.5 Plan 02: Deferred Send — setSendTime Fast-Path Summary` - 12 edges

## Surprising Connections (you probably didn't know these)
- `transcribeAudio()` --calls--> `priceTranscription()`  [EXTRACTED]
  packages/backend/convex/intake.ts → packages/cost/src/cost.ts
- `extractVisual()` --calls--> `priceUsage()`  [EXTRACTED]
  packages/backend/convex/intake.ts → packages/cost/src/cost.ts
- `runIntake()` --calls--> `classify()`  [EXTRACTED]
  packages/backend/convex/intake.ts → packages/extraction/src/classify.ts
- `runIntake()` --calls--> `frameForConversation()`  [EXTRACTED]
  packages/backend/convex/intake.ts → packages/extraction/src/frame.ts

## Import Cycles
- None detected.

## Communities (145 total, 15 thin omitted)

### Community 0 - "functions.ts"
Cohesion: 0.16
Nodes (15): activateSkill, getActiveSkill, loadSkill(), seedSkills, modules, COCKPIT_AGENT_SKILL, DOCUMENT_DRAFTER_SKILL, EMAIL_DRAFTER_SKILL (+7 more)

### Community 1 - "package.json"
Cohesion: 0.04
Nodes (25): modules, aggregateModules, modules, workflowModules, workpoolModules, modules, modules, REQ (+17 more)

### Community 2 - "page.tsx"
Cohesion: 0.10
Nodes (21): attRow, badge(), box, btn, chip, ContactMatch, dim, fmtSize() (+13 more)

### Community 3 - "biome.json"
Cohesion: 0.09
Nodes (22): Overview, Phase 03.2.1: Agent-Driven Cockpit (INSERTED), Phase 1: Foundation & Governance Substrate, Phase 2: Thin End-to-End Slice, Phase 3.1: Cockpit Core (INSERTED), Phase 3.2: Inbox Reading (INSERTED), Phase 3.3: Attachment Generation (INSERTED), Phase 3.4: Per-Recipient Personalization (INSERTED) (+14 more)

### Community 4 - "buildTelemetry.ts"
Cohesion: 0.13
Nodes (14): ATTACHMENTS, attachmentUrls, byThread, CANDIDATES, clearCandidates, getById, insertPlan, patchPlan (+6 more)

### Community 5 - "skills.ts"
Cohesion: 0.47
Nodes (4): parseRouting(), ParseRoutingResult, RoutingDecision, routingSchema

### Community 6 - "Phase 03.2 Plan 03: Gmail Headers-Only Search Summary"
Cohesion: 0.10
Nodes (19): Agent Evaluation, Discoverability, Email Cockpit, Executive Agent & Planning, Expansion, Governance & Operations, Guardrails, Human Review & Delivery (+11 more)

### Community 7 - "Playbook: Email Chat Cockpit"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 8 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.33
Nodes (5): ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages, Alternatives rejected, Consequences, Context, Decision

### Community 9 - "emailIntent.ts"
Cohesion: 0.15
Nodes (18): RFC-5322, applyRecipientEdit(), buildRecipientView(), ContactMatch, dedupeAppend(), HeaderRecord, NameCandidates, parseAddress() (+10 more)

### Community 10 - "Project State"
Cohesion: 0.11
Nodes (17): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+9 more)

### Community 11 - "Implementation Decisions (LOCKED)"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 12 - "guardrails.ts"
Cohesion: 0.20
Nodes (8): DEFAULT_CONFIG, getSafeTextByHash, preCall, prepare, rateLimiter, recordSpend, saveInstruction, setKillSwitch

### Community 13 - "pipeline.ts"
Cohesion: 0.12
Nodes (14): deliverApprovedPlan, markPlanDone, send, draft, Route, BlockReason, LABELS, REQUEST_STATUS (+6 more)

### Community 14 - "page.tsx"
Cohesion: 0.17
Nodes (11): retrier, workflow, contentHash(), attachmentArg, generateUploadUrl, get, armTimeout, fireTimeout (+3 more)

### Community 15 - "layout.tsx"
Cohesion: 0.17
Nodes (10): listNew, markResolved, newCount, addItem, listItems, tenantAction, tenantMutation, tenantQuery (+2 more)

### Community 16 - "page.tsx"
Cohesion: 0.29
Nodes (5): box, btn, Mode, reviewGate, submitDecision

### Community 17 - "deadLetters.ts"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+8 more)

### Community 18 - "Phase 03.2.1: Agent-Driven Cockpit — Research"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+8 more)

### Community 19 - "deliverApprovedPlan.ts"
Cohesion: 0.18
Nodes (9): cancelScheduledPlan, cockpitAgent, executePlan, FanoutArgs, listThreadMessages, proposeEmailPlan, resolveRecipients, sendCockpitMessage (+1 more)

### Community 20 - "Phase 03.2.1 — Validation Strategy"
Cohesion: 0.12
Nodes (15): Ambiguity & bounds, Cancel semantics, Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Failure at fire time (locked, design doc), Implementation Decisions (+7 more)

### Community 23 - "guardrails.test.ts"
Cohesion: 0.20
Nodes (8): aggregateModules, call(), fillProposable(), fillTwoProposable(), modules, PIN_CLOCK, T, buildAgentContext()

### Community 24 - "worm.test.ts"
Cohesion: 0.18
Nodes (10): Anti-Patterns Found, Automated Test Results, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 03.4: Per-Recipient Personalization Verification Report (+2 more)

### Community 25 - "03.2.1-01-PLAN.md"
Cohesion: 0.18
Nodes (10): Accumulated Context, Blockers/Concerns, Current Position, Decisions, Pending Todos, Performance Metrics, Project Reference, Project State (+2 more)

### Community 26 - "Common Pitfalls"
Cohesion: 0.25
Nodes (8): out, out, backendDir, convexBin, invoke(), must(), pollPass(), IMPORTANT: on Windows + Node 24 the convex CLI process can crash during exit

### Community 27 - "03.2.1-02-PLAN.md"
Cohesion: 0.22
Nodes (8): Attachments, Decision principles, Executive Agent — Cockpit (v1), Personalization, Recipients — index/label only, Scheduling, Serve the user, not a script, Working a message

### Community 28 - "03.2.1-03-PLAN.md"
Cohesion: 0.22
Nodes (8): Convex scheduled-function testing (offline, the pivotal capability), Manual-Only Verifications, Per-Task Verification Map, Phase 3.5 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 29 - "03.2.1-04-PLAN.md"
Cohesion: 0.25
Nodes (8): buildCockpitTools(), layoutRuns(), markdownToPdf(), parseSmoke(), recordModelSpend(), runAgentLoop(), SMOKE_ROUTES, wrapText()

### Community 30 - "03.2.1-05-PLAN.md"
Cohesion: 0.33
Nodes (5): ADR-003: All LLM prompts live in a versioned skills registry, never in source, Alternatives rejected, Consequences, Context, Decision

### Community 31 - "audit.ts"
Cohesion: 0.24
Nodes (7): auditCounts, backfillAuditCounts, countAudit, AuditHash, AuditPayload, AuditPayloadValue, AuditRef

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
Cohesion: 0.19
Nodes (10): REJECTION_COPY, submit, Attachment, isValidEmail(), MIME_ALLOWLIST, RejectionReason, SubmitInput, base (+2 more)

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 55 - "buildTelemetry.ts"
Cohesion: 0.28
Nodes (6): buildTelemetry(), LlmUsage, ReviewOutcome, TelemetryRow, TerminalOutcome, OPSG01_KEYS

### Community 57 - "dependencies"
Cohesion: 0.04
Nodes (47): dependencies, ai, @ai-sdk/openai, @auth/core, convex, @convex-dev/action-cache, @convex-dev/action-retrier, @convex-dev/agent (+39 more)

### Community 58 - "Phase 4: Attachment & Voice-Dictation Intake — Research"
Cohesion: 0.04
Nodes (46): Append-only singletons (additive, region-scoped — never reorder others' blocks), Architecture & File Map (Lane-B-clean), Binding Constraints (read first — the planner MUST honor these), Classification, CLAUDE.md invariants that shape every task, Common Pitfalls, Confidence breakdown, Core (no new install needed) (+38 more)

### Community 59 - "intake.ts"
Cohesion: 0.13
Nodes (25): attachToThread, decodeUtf8(), dictateToThread, extractVisual(), runIntake(), RunIntakeArgs, transcribeAudio(), chooseModel() (+17 more)

### Community 61 - "Phase 04 Plan 02: Attachment Extractor Skill Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 62 - "smoke.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 63 - "Phase 4 Plan 04: Backend Intake Spine Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 64 - "Phase 4 Plan 05: Intake UI (IntakeControls.tsx + Playwright E2E) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Cross-Lane Note (for Lane A), Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 65 - "Phase 4 Plan 06: Phase Close (Task 1 of 3 — PAUSED AT CHECKPOINT) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments (Task 1 only), Cross-Lane Note (unchanged from 04-05, restated for Task 2's benefit), Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 66 - "Phase 4 Plan 01: Extraction Foundation + Intake Playbook Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 67 - "worm.test.ts"
Cohesion: 0.10
Nodes (20): 1. Use point-in-time reads when live updates are not valuable, 2. Batch related data into fewer queries, 3. Use skip to avoid unnecessary subscriptions, 4. Isolate frequently-updated fields into separate documents, 5. Use the aggregate component for counts and sums, 6. Narrow query read sets, 7. Remove `Date.now()` from queries, 8. Consider pagination strategy (+12 more)

### Community 68 - "wormCursor.ts"
Cohesion: 0.13
Nodes (11): dropped, existing, fileId, files, g, nodeFile, nodeIds, raw (+3 more)

### Community 69 - "Goal Achievement"
Cohesion: 0.15
Nodes (12): 1. SC3 — Live attachment + dictation → delivered email reflects the content, past guardrails, Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required (Deferred by Design), Key Link Verification, Lane B Boundary Check, Observable Truths (+4 more)

### Community 70 - "Playbook: Attachment & Voice-Dictation Intake"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 71 - "package.json"
Cohesion: 0.18
Nodes (10): devDependencies, vitest, exports, name, private, scripts, test, typecheck (+2 more)

### Community 72 - "page.tsx"
Cohesion: 0.20
Nodes (3): STATUS_COLOR, list, list

### Community 73 - "Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary"
Cohesion: 0.22
Nodes (8): Auto-fixed Issues, Concurrency note (not a Rule 1-4 deviation — a shared-worktree race, documented per plan's PARALLEL WAVE warning), Cross-Lane Announcement, Deviations from Plan, Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary, Requirements Tracking Note, Self-Check: PASSED, What Was Built

### Community 75 - "buildTelemetry.test.ts"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 76 - "intakeDb.ts"
Cohesion: 0.25
Nodes (7): byThread, generateUploadUrl, getArtifact, insertArtifact, KIND, patchArtifact, STATUS

### Community 77 - "Phase 4 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 4 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 78 - "tokenExpiry.test.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 79 - "Attachment Extractor (v1)"
Cohesion: 0.40
Nodes (4): Attachment Extractor (v1), Extraction principles, Inputs, Output contract

### Community 80 - "IntakeControls.tsx"
Cohesion: 0.67
Nodes (3): iconBtn(), IntakeControls(), StorageId

### Community 81 - "result.ts"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 82 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 83 - "Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake)"
Cohesion: 0.50
Nodes (3): Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake), From 04-01 execution, From 04-02 execution

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
Cohesion: 0.09
Nodes (39): AttachmentPicker(), UploadedAttachment, bubble(), ChatPane(), messageText(), PasswordField(), TextField(), ArrowIcon() (+31 more)

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
Nodes (12): Err, Ok, Result, DETECTORS, Match, PiiEntity, PiiScanError, PiiScanResult (+4 more)

### Community 168 - "tenant.ts"
Cohesion: 0.12
Nodes (15): assertAtReview, assertBlocked, assertDeadLetter, assertDeadLetterReason, assertFallback, assertFanoutIdempotent, assertFanoutReachedAll, assertLlmCalledCount (+7 more)

### Community 171 - "llm.ts"
Cohesion: 0.06
Nodes (28): ACCENT, AgentSmokeOp, Att, documentSchema, draftCache, draftCockpit, draftDocument, DraftResult (+20 more)

### Community 176 - "smoke.ts"
Cohesion: 0.12
Nodes (15): log, deadLetterRecipient, onPipelineComplete, pipelineWorkflow, assertSubmitRateLimited, boom, drainDailySpend, failingPipeline (+7 more)

### Community 180 - "requests.ts"
Cohesion: 0.33
Nodes (5): apps/web E2E (Playwright), Auth (storageState), Prerequisite: the local dev backend must be running, Running, Specs

### Community 181 - "migrations.ts"
Cohesion: 0.50
Nodes (3): backfillRequestDefaults, migrations, run

### Community 190 - "tokenExpiry.ts"
Cohesion: 0.07
Nodes (25): RFC-2822, crons, HeaderRecord, META_HEADERS, search, SearchResult, SendResult, buildAuthorizeUrl() (+17 more)

### Community 191 - "tenant.ts"
Cohesion: 0.33
Nodes (4): Brand, CONTRACTS_PACKAGE_NAME, TENANT_FIELD, TenantId

### Community 201 - "Logger"
Cohesion: 0.28
Nodes (4): createLogger(), LogFields, Logger, LogLevel

### Community 210 - "SplitPane.tsx"
Cohesion: 0.29
Nodes (7): capsTeal, panel, Tab, clamp(), readSaved(), SplitPane(), userKey()

### Community 215 - "run-smoke-fanout.mjs"
Cohesion: 0.40
Nodes (4): cids, needles, recipients, siblingCids

### Community 232 - "Playbook: Email Chat Cockpit"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

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
- **877 isolated node(s):** `Intake & Enrichment`, `Executive Agent & Planning`, `Guardrails`, `Human Review & Delivery`, `Email Cockpit` (+872 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Route` connect `pipeline.ts` to `llm.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `draft` connect `pipeline.ts` to `llm.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `Intake & Enrichment`, `Executive Agent & Planning`, `Guardrails` to the rest of the system?**
  _882 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04421768707482993 - nodes in this community are weakly interconnected._
- **Should `page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09846153846153846 - nodes in this community are weakly interconnected._
- **Should `biome.json` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `buildTelemetry.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._