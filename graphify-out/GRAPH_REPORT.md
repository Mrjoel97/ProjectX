# Graph Report - lane-c-voicedoc  (2026-07-26)

## Corpus Check
- 876 files · ~1,250,577 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2402 nodes · 3622 edges · 202 communities (181 shown, 21 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dce4e382`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- functions.ts
- package.json
- page.tsx
- biome.json
- v1 Requirements
- skills.ts
- Phase 03.2 Plan 03: Gmail Headers-Only Search Summary
- Playbook: Email Chat Cockpit
- ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages
- emailIntent.ts
- Project State
- scan.ts
- guardrails.ts
- Phase 03.7 — Validation Strategy
- page.tsx
- layout.tsx
- page.tsx
- index.ts
- intakeDb.ts
- tenant.ts
- buildCockpitTools
- cockpit-resolve.spec.ts
- tokenExpiry.ts
- guardrails.test.ts
- Dropzone.tsx
- classify.ts
- index.ts
- 03.2.1-02-PLAN.md
- Validation Architecture
- tenant.ts
- vaultLlm.ts
- buildCockpitTools
- demo.ts
- Pikar AI
- layout.tsx
- log
- eventTypes.ts
- Executive Agent — Request Classifier (v1)
- boot-check.mjs
- intakeDb.ts
- 03.7-08-PLAN.md
- auditImmutability.test.ts
- optimizerBreach.ts
- tenant.ts
- Sidecars
- page.tsx
- next.config.ts
- convex.config.ts
- Pikar-AI
- LiveSession.tsx
- Project State
- opsSignals.test.ts
- buildTelemetry.ts
- formatAbsolute
- Phase 03.5 Plan 05: Reschedule a Canceled Send Summary
- cockpit.ts
- vaultGraph.ts
- graphify
- guardrails.test.ts
- smoke.ts
- notificationMessage
- vault.test.ts
- worm.ts
- layout.tsx
- worm.test.ts
- wormCursor.ts
- Inbox Digest (v1)
- Playbook: Attachment & Voice-Dictation Intake
- vaultLlm.ts
- getActiveSkill
- list
- providers.tsx
- buildTelemetry.test.ts
- index.ts
- briefings.ts
- tokenExpiry.test.ts
- Attachment Extractor (v1)
- index.ts
- result.ts
- vaultSweep.ts
- Executive Agent — Router (v1)
- Email Drafter (v1)
- executiveAgentClassifier.ts
- tokenExpiry.ts
- auth.ts
- vaultLlm.ts
- plans.ts
- bfsNeighbors
- Dropzone.tsx
- VaultStats.tsx
- normalizeName
- voice.test.ts
- ADR-003: All LLM prompts live in a versioned skills registry, never in source
- review.ts
- run-smoke-dlq.mjs
- crons.ts
- page.tsx
- intake.ts
- layout.tsx
- gapAction.test.ts
- notificationMessage
- categories.ts
- plans.test.ts
- page.tsx
- COCKPIT_AGENT_SKILL
- optimizerEligibility.test.ts
- page.tsx
- run-seed.mjs
- 12-01-PLAN.md
- ReconnectBanner.tsx
- Convex Authentication Setup
- financialSpine.ts
- Cockpit attachments persist to the Knowledge Vault
- proactiveReview.ts
- classify.ts
- buildTelemetry.ts
- Packaged Convex Components
- runCockpitAgent.test.ts
- fallback.test.ts
- optimizerEligibility.test.ts
- officeText.ts
- intake.test.ts
- vaultGround.test.ts
- Advanced Component Patterns
- Hybrid Convex Components
- Local Convex Components
- tokenExpiry.ts
- Graph Extractor (v1)
- index.ts
- Convex
- metering.ts
- contentHash
- vaultRedaction.test.ts
- vaultLlm.ts
- vaultGraph.ts
- http.ts
- ADR-006: Vault chunks are trusted-as-own — they enter the agent loop directly, not through the toolless-ingestion invariant
- intakeDb.ts
- stepText
- tokenExpiry.ts
- index.ts
- notifyExternal.ts
- scanText
- vaultSweep.test.ts
- session.ts
- agentSteps.ts
- voiceDoc.ts
- optimizerEligibility.test.ts
- review.ts
- tenant.ts
- vaultGraph.test.ts
- llm.ts
- Playbook: Email Chat Cockpit
- requests.ts
- Playbook: Audit Log & Dead-Letter Pipeline
- check-playbooks.mjs
- Playbook: <feature name>
- docs/
- Pikar AI — Brand & UI Reference
- ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations
- Document Drafter (v1)
- PostCall.tsx
- vaultTranscribe.test.ts
- Lane ownership (Phase 3.8)
- cockpit.test.ts
- pipeline.test.ts
- package.json
- logger.ts
- Playbook: Knowledge Vault & GraphRAG
- optimizerBreach.ts
- Phase 03.2.1 — Validation Strategy
- Lane ownership (Phase 3.8)
- ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages
- ADR-003: All LLM prompts live in a versioned skills registry, never in source
- routing.ts
- crons.ts
- telemetry (table)
- 02-06-PLAN.md
- guardrails.ts

## God Nodes (most connected - your core abstractions)
1. `base()` - 29 edges
2. `Phase Details` - 22 edges
3. `buildCockpitTools()` - 20 edges
4. `tenantQuery` - 19 edges
5. `Phase Details - Milestone v2.0` - 18 edges
6. `base()` - 17 edges
7. `Executive Agent — Cockpit (v1)` - 17 edges
8. `tenantMutation` - 16 edges
9. `log` - 15 edges
10. `must()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `useVoiceSession()` --indirect_call--> `usage()`  [INFERRED]
  apps/web/app/(app)/dashboard/voice/useVoiceSession.ts → packages/core/src/buildTelemetry.test.ts
- `buildCockpitTools()` --indirect_call--> `today()`  [INFERRED]
  packages/backend/convex/llm.ts → apps/web/app/(app)/dashboard/voice/PostCall.tsx
- `PostCall()` --calls--> `composeBrief()`  [EXTRACTED]
  apps/web/app/(app)/dashboard/voice/PostCall.tsx → packages/voice/src/brief.ts
- `useVoiceSession()` --calls--> `graceExpired()`  [EXTRACTED]
  apps/web/app/(app)/dashboard/voice/useVoiceSession.ts → packages/voice/src/session.ts
- `BriefingCard()` --calls--> `buildBriefingView()`  [EXTRACTED]
  apps/web/app/(app)/dashboard/workspace/cards.tsx → packages/core/src/briefing.ts

## Import Cycles
- None detected.

## Communities (202 total, 21 thin omitted)

### Community 0 - "functions.ts"
Cohesion: 0.04
Nodes (45): Milestone v2.0 - Platform -> Private Beta (Phases 10-25), Overview, Phase 03.2.1: Agent-Driven Cockpit (INSERTED), Phase 10: Vault->Agent Grounding, Phase 11: Persona Onboarding & Business Profile, Phase 12: Business Evaluation Engine, Phase 13: Proactive In-App Review, Phase 14: Flagship Voice-Doc Workflow (+37 more)

### Community 1 - "package.json"
Cohesion: 0.22
Nodes (10): buildAuthorizeUrl(), getForDelivery, getTokens, gmailConnectUrl, gmailStatus, hmacHex(), requireEnv(), updateAccess (+2 more)

### Community 2 - "page.tsx"
Cohesion: 0.04
Nodes (49): Activity, attRow, badge(), box, Briefing, BriefingItem, BriefingRow(), briefingSheet (+41 more)

### Community 3 - "biome.json"
Cohesion: 0.17
Nodes (11): Data flow (one agent turn), Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+3 more)

### Community 4 - "v1 Requirements"
Cohesion: 0.06
Nodes (55): AttachmentPicker(), UploadedAttachment, CategoryTabs(), Tab, VAULT_TABS, DocGrid(), fmtSize(), statusBadge() (+47 more)

### Community 5 - "skills.ts"
Cohesion: 0.11
Nodes (32): activateSkill, activateSkillVersion(), archiveSkill, recordEvalEvidence, seedSkills, ATTACHMENT_EXTRACTOR_SKILL, BMC_SKILL, BUSINESS_PROFILE_SKILL (+24 more)

### Community 6 - "Phase 03.2 Plan 03: Gmail Headers-Only Search Summary"
Cohesion: 0.10
Nodes (22): tenantAction, vaultDocuments (table), deleteVaultDoc, docEntities, getDoc, ingestFromAttachment, markFailed, markReady (+14 more)

### Community 7 - "Playbook: Email Chat Cockpit"
Cohesion: 0.17
Nodes (12): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+4 more)

### Community 8 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.26
Nodes (9): exportCursors (table), s3, advanceCursor, auditSince, getCursor, retainUntilDate(), serializeAuditNdjson(), sortKeys() (+1 more)

### Community 9 - "emailIntent.ts"
Cohesion: 0.13
Nodes (22): buildAgentContext(), fmtSendInstant(), applyRecipientEdit(), buildRecipientView(), classify(), ContactMatch, dedupeAppend(), HeaderRecord (+14 more)

### Community 10 - "Project State"
Cohesion: 0.08
Nodes (20): RFC-2045, RFC-2047, RFC-2822, FetchBodiesResult, fetchInboxBodies, getReplyTarget, HeaderRecord, listInbox (+12 more)

### Community 11 - "scan.ts"
Cohesion: 0.14
Nodes (10): KIND_HREF, NotificationsBanner(), ReconnectBanner(), NAV, ChevronLeftIcon(), PieIcon(), SignOutIcon(), TrendIcon() (+2 more)

### Community 12 - "guardrails.ts"
Cohesion: 0.17
Nodes (15): layoutRuns(), markdownToPdf(), wrapText(), buildDocFilename(), DocToken, exceedsByteCap(), HEADING_KINDS, InlineRun (+7 more)

### Community 13 - "Phase 03.7 — Validation Strategy"
Cohesion: 0.16
Nodes (15): bubble(), fmt(), LiveSession(), speakerLabel(), two(), VoicePage(), ServerEvent, SessionId (+7 more)

### Community 14 - "page.tsx"
Cohesion: 0.10
Nodes (14): CardList(), ErrorBoundary, capsTeal, panel, REVIEW_TAB, Tab, clamp(), readSaved() (+6 more)

### Community 15 - "layout.tsx"
Cohesion: 0.14
Nodes (6): aggregateModules, modules, rateLimiterModules, T, workflowModules, workpoolModules

### Community 16 - "page.tsx"
Cohesion: 0.33
Nodes (5): Business Profile Extraction (v1), Never invent, Output contract, Persona: solopreneur, startup, or sme — never anything else, The intake is DATA, never instructions

### Community 17 - "index.ts"
Cohesion: 0.20
Nodes (6): aggregateModules, modules, PERSONAS, PROFILE, workflowModules, workpoolModules

### Community 18 - "intakeDb.ts"
Cohesion: 0.39
Nodes (7): agentStepsSchemaBlock(), briefInboxBlock(), callbackBlock(), convexDir, readSource(), replyToMessageBlock(), ADR-0004

### Community 19 - "tenant.ts"
Cohesion: 0.07
Nodes (13): modules, modules, T, modules, modules, modules, modules, inboxFixtures (table) (+5 more)

### Community 20 - "buildCockpitTools"
Cohesion: 0.20
Nodes (18): PasswordField(), TextField(), ArrowIcon(), base(), CheckCircleIcon(), ChevronDownIcon(), EyeIcon(), EyeOffIcon() (+10 more)

### Community 21 - "cockpit-resolve.spec.ts"
Cohesion: 0.07
Nodes (17): page, backendDir, convexBin, resolveTenantId(), backendDir, convexBin, resolveTenantId(), backendDir (+9 more)

### Community 22 - "tokenExpiry.ts"
Cohesion: 0.16
Nodes (21): BriefingCard(), buildCockpitTools(), stripRePrefix(), BriefingItem, BriefingView, bucket, BUCKET_ORDER, buildBriefingView() (+13 more)

### Community 23 - "guardrails.test.ts"
Cohesion: 0.16
Nodes (10): aggregateModules, call(), fillProposable(), fillTwoProposable(), modules, PIN_CLOCK, setup(), setupBriefing() (+2 more)

### Community 24 - "Dropzone.tsx"
Cohesion: 0.11
Nodes (17): 1. [Rule 1 — the plan's stated interface was wrong] `startSession` validates via `ctx.db.get`, not `internal.vault.getDoc`, 2. [Rule 3 — blocking, environment] The copied `_generated/api.d.ts` predates `voiceDoc.ts`, 3. [Rule 3 — blocking] Registering the workflow component to silence stderr made the suite exit non-zero, Accomplishments, Decisions Made, Deviations from Plan, Files Created/Modified, Issues Encountered (+9 more)

### Community 25 - "classify.ts"
Cohesion: 0.20
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 26 - "index.ts"
Cohesion: 0.17
Nodes (11): Approach, Data: discard, no migration, Definition of done, Design: Fix per-session tenant scoping, Goal, Manual verification, Out of scope, Problem (+3 more)

### Community 27 - "03.2.1-02-PLAN.md"
Cohesion: 0.11
Nodes (17): After a pick completes, Assessing the business, Attachments, Cancel and start over, Decision principles, Executive Agent — Cockpit (v1), Grounding in your knowledge vault, Inbox briefing (+9 more)

### Community 28 - "Validation Architecture"
Cohesion: 0.13
Nodes (16): draftVoiceBrief, voiceSessions (table), forceEndSession, getActiveSession, getSession, markEndedAbnormal, markEndedClean, persistBrief (+8 more)

### Community 29 - "tenant.ts"
Cohesion: 0.07
Nodes (28): ADR-005: Live voice is browser-direct OpenAI Realtime over WebRTC, bounded by a single server wall-clock watchdog, with metering as telemetry, Alternatives rejected, Consequences, Context, Decision, Char budgets (`packages/voice/src/docSession.ts`), Citations: document-level always, quoted passage where available, Data flow (+20 more)

### Community 30 - "vaultLlm.ts"
Cohesion: 0.10
Nodes (37): TranscriptTurn, buildDocDigest(), cleaned(), composeDocMemo(), DIGEST_FENCE_CLOSE, DIGEST_FENCE_OPEN, DOC_GAP_PLAYBOOK, DOC_GAP_ROUTE (+29 more)

### Community 31 - "buildCockpitTools"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 32 - "demo.ts"
Cohesion: 0.08
Nodes (24): Agent Mode, Checklist, Convex Quickstart, Development vs Production, Environment variables, Install, Next.js (App Router), Next Steps (+16 more)

### Community 33 - "Pikar AI"
Cohesion: 0.18
Nodes (10): Clean-clone boot order (run verbatim), Common commands, Dev tooling — build discipline & repo knowledge graph, graphify — repo knowledge graph (query before you read), Pikar AI, ponytail — minimal-code discipline, Repository layout, Secrets plane (+2 more)

### Community 34 - "layout.tsx"
Cohesion: 0.25
Nodes (6): body, display, metadata, mono, convex, Providers()

### Community 35 - "log"
Cohesion: 0.22
Nodes (8): auditCounts, backfillAuditCounts, countAudit, audit (table), AuditHash, AuditPayload, AuditPayloadValue, AuditRef

### Community 37 - "Executive Agent — Request Classifier (v1)"
Cohesion: 0.40
Nodes (4): Decision principles, Executive Agent — Request Classifier (v1), Output contract, Routing decision

### Community 38 - "boot-check.mjs"
Cohesion: 0.40
Nodes (3): backend, NOTE: `convex codegen` requires a configured deployment (CONVEX_DEPLOYMENT in, root

### Community 39 - "intakeDb.ts"
Cohesion: 0.33
Nodes (5): How you talk, Silence, Time, Voice Session (v1), What you are doing

### Community 40 - "03.7-08-PLAN.md"
Cohesion: 0.08
Nodes (25): assertSubmitRateLimited, boom, briefingCountForThread, briefingSynopsisPresent, drainDailySpend, evaluationCountForThread, failingPipeline, findingCountForThread (+17 more)

### Community 43 - "optimizerBreach.ts"
Cohesion: 0.20
Nodes (13): ActivityCard(), stepText(), bubble(), ChatPane(), messageText(), IntakeControls(), StorageId, MicIcon() (+5 more)

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 51 - "Pikar-AI"
Cohesion: 0.19
Nodes (14): AbnormalBriefBanner(), markVoiceBriefSeen(), readSeen(), VoiceBrief, Phase, PostCall(), primaryBtn, secondaryBtn (+6 more)

### Community 52 - "LiveSession.tsx"
Cohesion: 0.20
Nodes (7): OptimizerPanel(), REVIEW_OUTCOMES, unifiedDiff(), BellIcon(), WalletIcon(), activateCandidate, candidatesForReview

### Community 53 - "Project State"
Cohesion: 0.09
Nodes (23): finish, latestTurn, record, StepView, listNew, markResolved, addItem, listItems (+15 more)

### Community 54 - "opsSignals.test.ts"
Cohesion: 0.32
Nodes (5): modules, seedRequest(), seedTelemetry(), seedTelemetryFixture(), T

### Community 55 - "buildTelemetry.ts"
Cohesion: 0.14
Nodes (9): field, label, getProfile, profileSchema, smokeProfileFixture(), status, updateProfile, vProfile (+1 more)

### Community 56 - "formatAbsolute"
Cohesion: 0.29
Nodes (5): box, btn, Mode, reviewGate, submitDecision

### Community 57 - "Phase 03.5 Plan 05: Reschedule a Canceled Send Summary"
Cohesion: 0.12
Nodes (3): loadSkill(), modules, SkillStatus

### Community 58 - "cockpit.ts"
Cohesion: 0.25
Nodes (4): aggregateModules, asTenant(), modules, startDocSession()

### Community 59 - "vaultGraph.ts"
Cohesion: 0.24
Nodes (8): aggregateModules, evaluateWithGap(), modules, profileDocText(), NOTE: no gmailTokens row is seeded — an email plan would refuse with gmail_not_c, seedDoc(), workflowModules, workpoolModules

### Community 61 - "guardrails.test.ts"
Cohesion: 0.20
Nodes (8): ConfigPatch, DEFAULT_OPTIMIZER_CONFIG, getOptimizerConfig, getOptimizerStatus, setOptimizerConfig, setOptimizerEnabled, optimizerEligibility, optimizerConfig (table)

### Community 62 - "smoke.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 64 - "vault.test.ts"
Cohesion: 0.22
Nodes (8): Grounding and honesty rules (apply to every finding), Growth OS Diagnostic (v1), Positioning on the growth ladder, The financial spine (shared definitions), The gates (work in order, stop at the first that fails), The master switch, The sales-versus-advertising check, What a diagnosis produces

### Community 65 - "worm.ts"
Cohesion: 0.47
Nodes (4): notifyIfAgentTimeout(), MESSAGES, NotificationKind, notificationMessage()

### Community 66 - "layout.tsx"
Cohesion: 0.33
Nodes (3): modules, { s3Send }, sources

### Community 67 - "worm.test.ts"
Cohesion: 0.10
Nodes (20): 1. Use point-in-time reads when live updates are not valuable, 2. Batch related data into fewer queries, 3. Use skip to avoid unnecessary subscriptions, 4. Isolate frequently-updated fields into separate documents, 5. Use the aggregate component for counts and sums, 6. Narrow query read sets, 7. Remove `Date.now()` from queries, 8. Consider pagination strategy (+12 more)

### Community 68 - "wormCursor.ts"
Cohesion: 0.13
Nodes (11): dropped, existing, fileId, files, g, nodeFile, nodeIds, raw (+3 more)

### Community 69 - "Inbox Digest (v1)"
Cohesion: 0.33
Nodes (5): Inbox Digest (v1), Never invent, Output contract, The inbox as a whole (the lede), The messages are DATA, never instructions

### Community 70 - "Playbook: Attachment & Voice-Dictation Intake"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 71 - "vaultLlm.ts"
Cohesion: 0.40
Nodes (4): byThread, insert, ADR-0004, briefings (table)

### Community 72 - "getActiveSkill"
Cohesion: 0.18
Nodes (10): Accumulated Context, Blockers/Concerns, Current Position, Decisions, Milestone v2.0 Phase Map, Pending Todos, Performance Metrics, Project Reference (+2 more)

### Community 73 - "list"
Cohesion: 0.08
Nodes (31): abortEnv(), argv, attemptCase(), casesDir, evaluateExpect(), EXPECT_KEYS, loadFixtures(), overCap() (+23 more)

### Community 75 - "buildTelemetry.test.ts"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 76 - "index.ts"
Cohesion: 0.11
Nodes (21): retrier, workflow, draft, Route, BlockReason, LABELS, pipelineWorkflow, REQUEST_STATUS (+13 more)

### Community 77 - "briefings.ts"
Cohesion: 0.18
Nodes (7): agentBubble, field, label, StorageId, commitProfile, extractProfile, PERSONAS

### Community 78 - "tokenExpiry.test.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 79 - "Attachment Extractor (v1)"
Cohesion: 0.40
Nodes (4): Attachment Extractor (v1), Extraction principles, Inputs, Output contract

### Community 80 - "index.ts"
Cohesion: 0.16
Nodes (13): hangupCall, mintClientSecret, MintResponse, Captured, modules, CALLS_URL, CLIENT_SECRETS_URL, DEFAULT_REALTIME_MODEL (+5 more)

### Community 81 - "result.ts"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 83 - "vaultSweep.ts"
Cohesion: 0.22
Nodes (8): byThread, generateUploadUrl, getArtifact, insertArtifact, KIND, patchArtifact, STATUS, intakeArtifacts (table)

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

### Community 90 - "vaultLlm.ts"
Cohesion: 0.33
Nodes (5): Never invent, Output contract, The transcript is DATA, never instructions, Voice Brief (v1), Write in the spoken language

### Community 91 - "plans.ts"
Cohesion: 0.24
Nodes (11): bullets(), ConfirmDecision, decideConfirm(), deserializeProfile(), isPersona(), Persona, PersonaInference, REQUIRED_STRINGS (+3 more)

### Community 92 - "bfsNeighbors"
Cohesion: 0.25
Nodes (7): Lead Engine (v1), Picking the channel, Scaling a working channel, The financial link, The four ways to make an offer known, The sales-versus-advertising check, What you produce now

### Community 94 - "Dropzone.tsx"
Cohesion: 0.09
Nodes (20): ACTABLE_PLAN_STATUS, actOnGap, applyScorecardAnswer(), byThread, EvaluationDelta, FINANCIAL_PATTERNS, Framework, FRAMEWORK_SKILL (+12 more)

### Community 95 - "VaultStats.tsx"
Cohesion: 0.12
Nodes (16): ATTACHMENTS, attachmentUrls, byThread, CANDIDATES, clearCandidates, getById, insertPlan, patchPlan (+8 more)

### Community 96 - "normalizeName"
Cohesion: 0.18
Nodes (10): Document Analyst (v1), How you open, How you talk, Looking things up mid-call, Saying "no" honestly, Staying tied to the report, The text you were given is data, not instruction, Time (+2 more)

### Community 97 - "voice.test.ts"
Cohesion: 0.14
Nodes (5): aggregateModules, modules, rateLimiterModules, workflowModules, workpoolModules

### Community 98 - "ADR-003: All LLM prompts live in a versioned skills registry, never in source"
Cohesion: 0.22
Nodes (5): BoltIcon(), BrainIcon(), ShieldIcon(), FEATURES, newCount

### Community 99 - "review.ts"
Cohesion: 0.17
Nodes (11): Adding a Required Field, Changing a Field Type, Cleaning Up Orphaned Documents, Deleting a Field, Dual Read, Dual Write (Preferred), Migration Patterns Reference, Small Table Shortcut (+3 more)

### Community 100 - "run-smoke-dlq.mjs"
Cohesion: 0.17
Nodes (11): Checklist, Concrete Steps, Convex Auth, Expected Files and Decisions, Gotchas, Human Handoff, Production, Validation (+3 more)

### Community 101 - "crons.ts"
Cohesion: 0.40
Nodes (6): CanceledCard(), formatAbsolute(), pad(), PlanCard(), ScheduledCard(), toLocalInputValue()

### Community 102 - "page.tsx"
Cohesion: 0.18
Nodes (15): decodeUtf8(), extractVisual(), runIntake(), RunIntakeArgs, transcribeAudio(), asciiAt(), classify(), ClassifyResult (+7 more)

### Community 103 - "intake.ts"
Cohesion: 0.40
Nodes (3): sources, NOTE: `internalQuery`/`internalMutation`/`internalAction` are NOT banned by, RAW_BUILDER_ALLOWLIST

### Community 104 - "layout.tsx"
Cohesion: 0.12
Nodes (9): aggregateModules, modules, profileDocText(), aggregateModules, code, modules, profileText(), sources (+1 more)

### Community 105 - "gapAction.test.ts"
Cohesion: 0.13
Nodes (14): extractDoc, runSweep, sweepPendingExtraction, transcribeDoc, ExtractionKind, extractionKindFor(), OFFICE_MIME, TRANSCRIBABLE_CONTAINER_MIME (+6 more)

### Community 108 - "plans.test.ts"
Cohesion: 0.25
Nodes (7): Money Model Designer (v1), The financial link, The four offer types, The thirty-day payback test, What a money model is, What you produce now, Which type is missing

### Community 109 - "page.tsx"
Cohesion: 0.18
Nodes (10): Auth0, Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 110 - "COCKPIT_AGENT_SKILL"
Cohesion: 0.16
Nodes (12): Err, Ok, Result, unwrap(), DETECTORS, Match, PiiEntity, PiiScanError (+4 more)

### Community 111 - "optimizerEligibility.test.ts"
Cohesion: 0.40
Nodes (4): Business Model Canvas Assessment (v1), Grounding and honesty rules (apply to every finding), The nine blocks, What the assessment produces

### Community 113 - "run-seed.mjs"
Cohesion: 0.18
Nodes (10): Checklist, Clerk, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 114 - "12-01-PLAN.md"
Cohesion: 0.40
Nodes (4): Grounding and honesty rules (apply to every finding), Lean Canvas Assessment (v1), The canvas blocks, What the assessment produces

### Community 115 - "ReconnectBanner.tsx"
Cohesion: 0.18
Nodes (10): Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation, What To Do (+2 more)

### Community 116 - "Convex Authentication Setup"
Cohesion: 0.18
Nodes (10): After Choosing a Provider, Checklist, Convex Authentication Setup, Core Pattern: Protecting Backend Functions, First Step: Choose the Auth Provider, Provider References, Reference Files, When Not to Use (+2 more)

### Community 118 - "Cockpit attachments persist to the Knowledge Vault"
Cohesion: 0.18
Nodes (10): Cockpit attachments persist to the Knowledge Vault, Decisions (owner-approved), Design, Failure handling, Known cost, New function, Out of scope, Problem (+2 more)

### Community 119 - "proactiveReview.ts"
Cohesion: 0.11
Nodes (15): log, cancelScheduledPlan, cockpitAgent, executePlan, FanoutArgs, listThreadMessages, proposeEmailPlan, reschedulePlan (+7 more)

### Community 120 - "classify.ts"
Cohesion: 0.25
Nodes (5): pickPlainText(), aggregateModules, LEGACY, modules, RFC-5322

### Community 121 - "buildTelemetry.ts"
Cohesion: 0.13
Nodes (13): graphEdges (table), graphNodes (table), EDGE, expand, NODE, upsertGraph, assertGroundNeighbor, assertNoRawText (+5 more)

### Community 122 - "Packaged Convex Components"
Cohesion: 0.25
Nodes (7): Build Flow, Checklist, Default Approach, Package Exports, Packaged Convex Components, Testing, When to Choose This

### Community 123 - "runCockpitAgent.test.ts"
Cohesion: 0.14
Nodes (9): agentModules, aggregateModules, modules, provUsage(), rateLimiterModules, T, textStep(), toolStep() (+1 more)

### Community 124 - "fallback.test.ts"
Cohesion: 0.29
Nodes (4): isTimeoutError(), recordModelSpend(), runAgentLoop(), isFallbackEligible()

### Community 125 - "optimizerEligibility.test.ts"
Cohesion: 0.40
Nodes (4): Grounding and honesty rules (apply to every finding), SWOT Assessment (v1), The four quadrants, What the assessment produces

### Community 126 - "officeText.ts"
Cohesion: 0.29
Nodes (8): decodeEntities(), docxText(), extractOfficeText(), NAMED, numericSorted(), pptxText(), runsOf(), xlsxText()

### Community 127 - "intake.test.ts"
Cohesion: 0.17
Nodes (7): agentModules, aggregateModules, modules, rateLimiterModules, T, workflowModules, workpoolModules

### Community 128 - "vaultGround.test.ts"
Cohesion: 0.47
Nodes (4): modules, seedChain(), seedDoc(), seedEdge()

### Community 129 - "Advanced Component Patterns"
Cohesion: 0.33
Nodes (5): Advanced Component Patterns, Class-based client wrappers, Deriving validators from schema, Function Handles for callbacks, Static configuration with a globals table

### Community 130 - "Hybrid Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Advice, Hybrid Convex Components, Risks, What This Means

### Community 131 - "Local Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Layout, Local Convex Components, When to Choose This, Workflow Notes

### Community 132 - "tokenExpiry.ts"
Cohesion: 0.21
Nodes (10): diagnose(), gateOrder(), leverageRank(), Prescription, cfa(), ltgpCac(), round2(), emptyScorecard (+2 more)

### Community 133 - "Graph Extractor (v1)"
Cohesion: 0.40
Nodes (4): Extraction principles, Graph Extractor (v1), Inputs, Output contract

### Community 134 - "index.ts"
Cohesion: 0.42
Nodes (10): chooseModel(), CostError, estimateCostUsd(), estimateTokens(), priceRealtime(), priceTranscription(), priceUsage(), PRICING (+2 more)

### Community 135 - "Convex"
Cohesion: 0.40
Nodes (4): Convex, Route to the Right Skill, Start Here, When Not to Use

### Community 136 - "metering.ts"
Cohesion: 0.60
Nodes (3): accumulateUsage(), UsageDelta, ZERO_USAGE

### Community 137 - "contentHash"
Cohesion: 0.25
Nodes (9): persistNextStepMemo(), contentHash(), writeProfileDoc(), startIngest(), categoryFor(), isSearchable(), SEARCHABLE_MIME, VaultCategory (+1 more)

### Community 139 - "vaultLlm.ts"
Cohesion: 0.20
Nodes (7): getActiveSkill, ExtractedGraph, extractGraph, getDocText, GraphEdge, GraphNode, graphSchema

### Community 145 - "http.ts"
Cohesion: 0.25
Nodes (6): { auth, signIn, signOut, store, isAuthenticated }, password, store, http, buildTrajectoryExport, insertCandidate

### Community 146 - "ADR-006: Vault chunks are trusted-as-own — they enter the agent loop directly, not through the toolless-ingestion invariant"
Cohesion: 0.33
Nodes (5): ADR-006: Vault chunks are trusted-as-own — they enter the agent loop directly, not through the toolless-ingestion invariant, Alternatives rejected, Consequences, Context, Decision

### Community 148 - "stepText"
Cohesion: 0.08
Nodes (32): EnvAdapter, Path, PikarCockpitAdapter, SkillOpt EnvAdapter for the pikar_cockpit env (skillopt==0.2.0) — thin wiring on, norm_split(), partition(), PikarCockpitDataLoader, SkillOpt SplitDataLoader for the pikar_cockpit env (skillopt==0.2.0).  Consume (+24 more)

### Community 150 - "tokenExpiry.ts"
Cohesion: 0.10
Nodes (19): Data flow, Dependencies & blast radius, How to change it safely, How to change safely, How to verify, How to verify, Invariants, Invariants — what must never break (+11 more)

### Community 152 - "notifyExternal.ts"
Cohesion: 0.29
Nodes (6): base64Url(), buildMime(), freshAccessToken(), wrap76(), dispatch, KINDS

### Community 155 - "session.ts"
Cohesion: 0.40
Nodes (4): MicState, PreFlight(), primaryBtn, secondaryBtn

### Community 156 - "agentSteps.ts"
Cohesion: 0.28
Nodes (7): buildTelemetry(), LlmUsage, ReviewOutcome, TelemetryRow, TerminalOutcome, OPSG01_KEYS, usage()

### Community 162 - "review.ts"
Cohesion: 0.25
Nodes (7): Offer Architect (v1), The build sequence, The financial link, The market gate comes first, The value equation, What you produce now, Which move is needed

### Community 168 - "tenant.ts"
Cohesion: 0.08
Nodes (25): backfillRequestDefaults, migrations, run, pendingTimeouts (table), assertAtReview, assertBlocked, assertDeadLetter, assertDeadLetterReason (+17 more)

### Community 169 - "vaultGraph.test.ts"
Cohesion: 0.33
Nodes (3): Edge, modules, Node

### Community 171 - "llm.ts"
Cohesion: 0.04
Nodes (45): ACCENT, AgentSmokeOp, Att, briefSchema, BriefTurn, digestInbox, DigestInput, digestSchema (+37 more)

### Community 174 - "Playbook: Email Chat Cockpit"
Cohesion: 0.14
Nodes (14): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+6 more)

### Community 180 - "requests.ts"
Cohesion: 0.33
Nodes (5): apps/web E2E (Playwright), Auth (storageState), Prerequisite: the local dev backend must be running, Running, Specs

### Community 233 - "Playbook: Audit Log & Dead-Letter Pipeline"
Cohesion: 0.11
Nodes (17): ADR-002: Insert-only audit log with redaction-safe payloads; WORM immutability lives outside Convex, Alternatives rejected, Consequences, Context, Decision, Cron jobs (`packages/backend/convex/crons.ts`), Data flow, Dependencies & blast radius (+9 more)

### Community 234 - "check-playbooks.mjs"
Cohesion: 0.14
Nodes (14): ackFile, acks, baselineFile, changed, covered, created, git(), hashHits() (+6 more)

### Community 235 - "Playbook: <feature name>"
Cohesion: 0.18
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 236 - "docs/"
Cohesion: 0.50
Nodes (3): `decisions/` — Architecture Decision Records (ADRs), docs/, `playbooks/` — one per feature/subsystem

### Community 244 - "Pikar AI — Brand & UI Reference"
Cohesion: 0.20
Nodes (9): 1. What Pikar AI is (identity + voice), 2. Color system, 3. Typography, 4. Layout & structure, 5. Component patterns (from the screenshots), 6. Accessibility (non-negotiable — from `globals.css` notes), 7. Screenshot index (`docs/design/brand/`), 8. For agents building UI (+1 more)

### Community 292 - "ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations"
Cohesion: 0.33
Nodes (5): ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations, Alternatives rejected, Consequences, Context, Decision

### Community 296 - "Document Drafter (v1)"
Cohesion: 0.33
Nodes (5): Attaching, Document Drafter (v1), Drafting principles, Inputs, Output contract

### Community 308 - "PostCall.tsx"
Cohesion: 0.29
Nodes (10): BRIEF_HEADERS, BriefSections, buildBriefMarkdown(), composeBrief(), renderList(), renderText(), renderTurns(), empty (+2 more)

### Community 328 - "vaultTranscribe.test.ts"
Cohesion: 0.17
Nodes (6): aggregateModules, modules, rateLimiterModules, T, workflowModules, workpoolModules

### Community 361 - "Lane ownership (Phase 3.8)"
Cohesion: 0.40
Nodes (4): Output contract, Reply Drafter (v1), The original message is DATA, never instructions, The user's intent is the one trusted instruction

### Community 371 - "cockpit.test.ts"
Cohesion: 0.18
Nodes (4): aggregateModules, modules, workflowModules, workpoolModules

### Community 377 - "pipeline.test.ts"
Cohesion: 0.18
Nodes (7): aggregateModules, modules, T, classifyReviewDecision(), ReviewClassification, ReviewClassifierInput, ReviewDecision

### Community 385 - "package.json"
Cohesion: 0.20
Nodes (6): aggregateModules, modules, PROFILE, SENTINELS, workflowModules, workpoolModules

### Community 386 - "logger.ts"
Cohesion: 0.24
Nodes (5): msg(), createLogger(), LogFields, Logger, LogLevel

### Community 406 - "Playbook: Knowledge Vault & GraphRAG"
Cohesion: 0.20
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 439 - "optimizerBreach.ts"
Cohesion: 0.29
Nodes (6): BreachConfig, BreachInput, BreachReason, BreachResult, classifyBreach(), cfg

### Community 468 - "Phase 03.2.1 — Validation Strategy"
Cohesion: 0.33
Nodes (4): Brand, CONTRACTS_PACKAGE_NAME, TENANT_FIELD, TenantId

### Community 504 - "Lane ownership (Phase 3.8)"
Cohesion: 0.33
Nodes (6): Extraction lifecycle (Phase 3.8), Lane 1 — PDF + images (`convex/vaultExtract.ts` + test), Lane 2 — Office parsers (`packages/vault/src/officeText.ts` + test), Lane 3 — Sweep + UI + E2E (`convex/vaultSweep*.ts` + `apps/web/.../dashboard/vault/` + `apps/web/e2e/vault.spec.ts`), Lane 4 — Video transcription (`convex/vaultTranscribe.ts` + test), Lane ownership (Phase 3.8)

### Community 517 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.40
Nodes (5): ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages, Alternatives rejected, Consequences, Context, Decision

### Community 518 - "ADR-003: All LLM prompts live in a versioned skills registry, never in source"
Cohesion: 0.40
Nodes (5): ADR-003: All LLM prompts live in a versioned skills registry, never in source, Alternatives rejected, Consequences, Context, Decision

### Community 541 - "routing.ts"
Cohesion: 0.47
Nodes (4): parseRouting(), ParseRoutingResult, RoutingDecision, routingSchema

### Community 581 - "crons.ts"
Cohesion: 0.40
Nodes (4): crons, flagExpiringTokens, runWeekly, exportAudit

### Community 608 - "telemetry (table)"
Cohesion: 0.20
Nodes (8): deadLetterRecipient, deliverApprovedPlan, markPlanDone, send, setStatus, telemetry (table), terminalOutcome, writeTerminal

### Community 643 - "02-06-PLAN.md"
Cohesion: 0.17
Nodes (12): preCall, recordSpend, getDocForExtraction, ingestExtractedText, markExtracting, Extracted, extractHosted(), ExtractPath (+4 more)

### Community 655 - "guardrails.ts"
Cohesion: 0.22
Nodes (7): DEFAULT_CONFIG, getSafeTextByHash, prepare, rateLimiter, saveInstruction, setKillSwitch, guardrailConfig (table)

## Knowledge Gaps
- **1076 isolated node(s):** `searchDocument`, `ADR-0005`, `Overview`, `Phases`, `Milestone v2.0 - Platform -> Private Beta (Phases 10-25)` (+1071 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `page` connect `cockpit-resolve.spec.ts` to `buildTelemetry.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `log` connect `proactiveReview.ts` to `log`, `02-06-PLAN.md`, `page.tsx`, `03.7-08-PLAN.md`, `Project State`, `llm.ts`, `index.ts`, `http.ts`, `buildTelemetry.ts`, `Validation Architecture`, `Dropzone.tsx`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `vaultDocuments (table)` connect `Phase 03.2 Plan 03: Gmail Headers-Only Search Summary` to `03.7-08-PLAN.md`, `tenant.ts`, `buildTelemetry.ts`, `buildTelemetry.ts`, `Validation Architecture`, `Dropzone.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `buildCockpitTools()` (e.g. with `today()` and `isNeedsYou()`) actually correct?**
  _`buildCockpitTools()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `searchDocument`, `ADR-0005`, `Overview` to the rest of the system?**
  _1098 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `functions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0366120218579235 - nodes in this community are weakly interconnected._