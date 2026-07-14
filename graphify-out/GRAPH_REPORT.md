# Graph Report - lane-b-intake  (2026-07-14)

## Corpus Check
- 396 files · ~539,518 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1148 nodes · 1448 edges · 110 communities (97 shown, 13 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cb6e2441`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- functions.ts
- package.json
- page.tsx
- gmailAuth.ts
- classify.ts
- skills.ts
- documentGen.ts
- cockpit.ts
- intake.ts
- emailIntent.ts
- logger.ts
- documentGen.ts
- guardrails.ts
- functions.ts
- page.tsx
- layout.tsx
- page.tsx
- deadLetters.ts
- cockpit.test.ts
- deliverApprovedPlan.ts
- deliverApprovedPlan.ts
- tenant.ts
- intakeDb.ts
- worm.test.ts
- tokenExpiry.ts
- Common Pitfalls
- auth.ts
- deadLetters.test.ts
- plans.test.ts
- demo.ts
- Pikar AI
- layout.tsx
- importGuard.test.ts
- eventTypes.ts
- Executive Agent — Request Classifier (v1)
- boot-check.mjs
- auditImmutability.test.ts
- tenant.ts
- Sidecars
- page.tsx
- next.config.ts
- convex.config.ts
- documentGen.ts
- plans.ts
- graphify
- smoke.ts
- worm.test.ts
- wormCursor.ts
- providers.tsx
- buildTelemetry.test.ts
- gmail.ts
- tokenExpiry.test.ts
- buildCockpitTools
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
- llmRedaction.test.ts
- smoke.ts
- requests.ts
- Pikar AI — Brand & UI Reference
- tokenExpiry.ts
- intake.test.ts
- runCockpitAgent.test.ts
- fallback.test.ts
- cockpit.test.ts
- cockpitTools.test.ts
- SplitPane.tsx
- Playbook: Email Chat Cockpit
- Playbook: Audit Log & Dead-Letter Pipeline
- check-playbooks.mjs
- Playbook: <feature name>
- docs/
- guardrails.test.ts
- wormCursor.ts

## God Nodes (most connected - your core abstractions)
1. `scripts` - 12 edges
2. `base()` - 12 edges
3. `Convex Create Component` - 12 edges
4. `Migrations Component Reference` - 12 edges
5. `Convex Quickstart` - 12 edges
6. `must()` - 11 edges
7. `Hot Path Rules` - 11 edges
8. `Convex Auth` - 11 edges
9. `Playbook: Attachment & Voice-Dictation Intake` - 10 edges
10. `buildCockpitTools()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `buildCockpitTools()` --calls--> `contentHash()`  [EXTRACTED]
  packages/backend/convex/llm.ts → packages/backend/convex/lib/hash.ts
- `buildCockpitTools()` --calls--> `applyRecipientEdit()`  [EXTRACTED]
  packages/backend/convex/llm.ts → packages/core/src/emailIntent.ts
- `buildCockpitTools()` --calls--> `rankCandidates()`  [EXTRACTED]
  packages/backend/convex/llm.ts → packages/core/src/emailIntent.ts
- `buildCockpitTools()` --calls--> `scanText()`  [EXTRACTED]
  packages/backend/convex/llm.ts → packages/pii/src/scan.ts
- `recordModelSpend()` --calls--> `priceUsage()`  [EXTRACTED]
  packages/backend/convex/llm.ts → packages/cost/src/cost.ts

## Import Cycles
- None detected.

## Communities (110 total, 13 thin omitted)

### Community 0 - "functions.ts"
Cohesion: 0.13
Nodes (15): activateSkill, getActiveSkill, loadSkill(), seedSkills, modules, ATTACHMENT_EXTRACTOR_SKILL, COCKPIT_AGENT_SKILL, DOCUMENT_DRAFTER_SKILL (+7 more)

### Community 1 - "package.json"
Cohesion: 0.18
Nodes (7): modules, modules, guardrailConfig (table), intakeArtifacts (table), requests (table), skills (table), modules

### Community 2 - "page.tsx"
Cohesion: 0.04
Nodes (45): dependencies, ai, @ai-sdk/openai, @auth/core, convex, @convex-dev/action-cache, @convex-dev/action-retrier, @convex-dev/agent (+37 more)

### Community 3 - "gmailAuth.ts"
Cohesion: 0.12
Nodes (16): attRow, badge(), box, btn, chip, ContactMatch, dim, fmtSize() (+8 more)

### Community 4 - "classify.ts"
Cohesion: 0.21
Nodes (10): asciiAt(), classify(), ClassifyResult, IntakeKind, sniffBytes(), sniffExtension(), sniffMime(), startsWith() (+2 more)

### Community 5 - "skills.ts"
Cohesion: 0.47
Nodes (4): parseRouting(), ParseRoutingResult, RoutingDecision, routingSchema

### Community 6 - "documentGen.ts"
Cohesion: 0.23
Nodes (9): modules, DocToken, HEADING_KINDS, InlineRun, isTableRow(), isTableSep(), splitRow(), tokenizeMarkdown() (+1 more)

### Community 7 - "cockpit.ts"
Cohesion: 0.15
Nodes (15): box, bubble(), ChatPane(), messageText(), cockpitAgent, executePlan, listThreadMessages, proposeEmailPlan (+7 more)

### Community 8 - "intake.ts"
Cohesion: 0.36
Nodes (7): attachToThread, decodeUtf8(), dictateToThread, extractVisual(), runIntake(), RunIntakeArgs, transcribeAudio()

### Community 9 - "emailIntent.ts"
Cohesion: 0.20
Nodes (13): RFC-5322, buildAgentContext(), applyRecipientEdit(), buildRecipientView(), ContactMatch, dedupeAppend(), HeaderRecord, NameCandidates (+5 more)

### Community 10 - "logger.ts"
Cohesion: 0.28
Nodes (4): createLogger(), LogFields, Logger, LogLevel

### Community 11 - "documentGen.ts"
Cohesion: 0.17
Nodes (13): AttachmentPicker(), UploadedAttachment, REJECTION_COPY, generateUploadUrl, submit, Attachment, isValidEmail(), MIME_ALLOWLIST (+5 more)

### Community 12 - "guardrails.ts"
Cohesion: 0.15
Nodes (13): DEFAULT_CONFIG, getSafeTextByHash, preCall, prepare, rateLimiter, recordSpend, saveInstruction, setKillSwitch (+5 more)

### Community 13 - "functions.ts"
Cohesion: 0.16
Nodes (11): listNew, markResolved, addItem, listItems, tenantAction, tenantMutation, tenantQuery, markRead (+3 more)

### Community 14 - "page.tsx"
Cohesion: 0.16
Nodes (13): deliverApprovedPlan, markPlanDone, send, retrier, workflow, draft, Route, BlockReason (+5 more)

### Community 15 - "layout.tsx"
Cohesion: 0.12
Nodes (6): ReconnectBanner(), NAV, STATUS_COLOR, newCount, list, list

### Community 16 - "page.tsx"
Cohesion: 0.29
Nodes (5): box, btn, Mode, reviewGate, submitDecision

### Community 17 - "deadLetters.ts"
Cohesion: 0.28
Nodes (6): buildTelemetry(), LlmUsage, ReviewOutcome, TelemetryRow, TerminalOutcome, OPSG01_KEYS

### Community 18 - "cockpit.test.ts"
Cohesion: 0.40
Nodes (4): Attachment Extractor (v1), Extraction principles, Inputs, Output contract

### Community 19 - "deliverApprovedPlan.ts"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 20 - "deliverApprovedPlan.ts"
Cohesion: 0.29
Nodes (7): CardList(), heading, panel, clamp(), readSaved(), SplitPane(), userKey()

### Community 22 - "tenant.ts"
Cohesion: 0.33
Nodes (4): Brand, CONTRACTS_PACKAGE_NAME, TENANT_FIELD, TenantId

### Community 23 - "intakeDb.ts"
Cohesion: 0.25
Nodes (7): byThread, generateUploadUrl, getArtifact, insertArtifact, KIND, patchArtifact, STATUS

### Community 25 - "tokenExpiry.ts"
Cohesion: 0.25
Nodes (6): armTimeout, fireTimeout, reviewDecisionValidator, reviewEventValidator, sendDecision, pendingTimeouts (table)

### Community 26 - "Common Pitfalls"
Cohesion: 0.13
Nodes (15): out, cids, needles, pdfMarkerB64, recipients, siblingCids, { storageId, size }, seedThroughReview() (+7 more)

### Community 27 - "auth.ts"
Cohesion: 0.38
Nodes (5): audit (table), exportCursors (table), advanceCursor, auditSince, getCursor

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

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 54 - "documentGen.ts"
Cohesion: 0.25
Nodes (8): buildCockpitTools(), layoutRuns(), markdownToPdf(), wrapText(), buildDocFilename(), exceedsByteCap(), inlineRuns(), toWinAnsi()

### Community 57 - "plans.ts"
Cohesion: 0.17
Nodes (11): ATTACHMENTS, attachmentUrls, CANDIDATES, getById, patchPlan, PLAN_STATUS, recordAttachments, reportForPlan (+3 more)

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

### Community 77 - "gmail.ts"
Cohesion: 0.22
Nodes (7): log, deadLetterRecipient, onPipelineComplete, deadLetters (table), telemetry (table), terminalOutcome, writeTerminal

### Community 78 - "tokenExpiry.test.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 79 - "buildCockpitTools"
Cohesion: 0.33
Nodes (3): recordModelSpend(), runAgentLoop(), isFallbackEligible()

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
Cohesion: 0.12
Nodes (22): toUsage(), Err, Ok, Result, unwrap(), chooseModel(), CostError, estimateCostUsd() (+14 more)

### Community 168 - "tenant.ts"
Cohesion: 0.10
Nodes (20): backfillRequestDefaults, migrations, run, assertAtReview, assertBlocked, assertDeadLetter, assertDeadLetterReason, assertFallback (+12 more)

### Community 171 - "llm.ts"
Cohesion: 0.06
Nodes (31): ACCENT, AgentSmokeOp, Att, documentSchema, draftCache, draftCockpit, draftDocument, DraftResult (+23 more)

### Community 176 - "smoke.ts"
Cohesion: 0.14
Nodes (13): assertSubmitRateLimited, boom, drainDailySpend, failingPipeline, recordReviewOutcome, resetDailySpend, reviewGate, runFailingPipeline (+5 more)

### Community 180 - "requests.ts"
Cohesion: 0.33
Nodes (5): apps/web E2E (Playwright), Auth (storageState), Prerequisite: the local dev backend must be running, Running, Specs

### Community 186 - "Pikar AI — Brand & UI Reference"
Cohesion: 0.20
Nodes (9): 1. What Pikar AI is (identity + voice), 2. Color system, 3. Typography, 4. Layout & structure, 5. Component patterns (from the screenshots), 6. Accessibility (non-negotiable — from `globals.css` notes), 7. Screenshot index (`docs/design/brand/`), 8. For agents building UI (+1 more)

### Community 190 - "tokenExpiry.ts"
Cohesion: 0.06
Nodes (31): RFC-2045, RFC-2047, RFC-2822, { auth, signIn, signOut, store, isAuthenticated }, password, crons, buildMime(), HeaderRecord (+23 more)

### Community 195 - "intake.test.ts"
Cohesion: 0.28
Nodes (7): agentModules, aggregateModules, modules, rateLimiterModules, seedThread(), setup(), T

### Community 196 - "runCockpitAgent.test.ts"
Cohesion: 0.28
Nodes (6): modules, provUsage(), rateLimiterModules, T, textStep(), toolStep()

### Community 202 - "fallback.test.ts"
Cohesion: 0.29
Nodes (6): Attachments, Decision principles, Executive Agent — Cockpit (v1), Recipients — index/label only, Serve the user, not a script, Working a message

### Community 203 - "cockpit.test.ts"
Cohesion: 0.25
Nodes (3): modules, workflowModules, workpoolModules

### Community 205 - "cockpitTools.test.ts"
Cohesion: 0.29
Nodes (5): aggregateModules, call(), fillProposable(), modules, T

### Community 210 - "SplitPane.tsx"
Cohesion: 0.33
Nodes (5): Attaching, Document Drafter (v1), Drafting principles, Inputs, Output contract

### Community 232 - "Playbook: Email Chat Cockpit"
Cohesion: 0.06
Nodes (30): ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages, Alternatives rejected, Consequences, Context, Decision, ADR-003: All LLM prompts live in a versioned skills registry, never in source, Alternatives rejected, Consequences (+22 more)

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

### Community 245 - "wormCursor.ts"
Cohesion: 0.24
Nodes (7): auditCounts, backfillAuditCounts, countAudit, AuditHash, AuditPayload, AuditPayloadValue, AuditRef

## Knowledge Gaps
- **594 isolated node(s):** `Purpose`, `Key files`, `Dependencies & blast radius`, `Data flow`, `Invariants — what must never break` (+589 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log` connect `gmail.ts` to `llm.ts`, `guardrails.ts`, `page.tsx`, `smoke.ts`, `wormCursor.ts`, `tokenExpiry.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `pendingTimeouts (table)` connect `tokenExpiry.ts` to `tenant.ts`, `package.json`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `list` connect `layout.tsx` to `guardrails.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `Purpose`, `Key files`, `Dependencies & blast radius` to the rest of the system?**
  _598 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `functions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `gmailAuth.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12280701754385964 - nodes in this community are weakly interconnected._