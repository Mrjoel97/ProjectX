# Graph Report - lane-c-voicedoc  (2026-07-26)

## Corpus Check
- 877 files · ~1,261,688 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 7713 nodes · 8189 edges · 762 communities (693 shown, 69 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a49660f4`
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
- formatAbsolute
- Cockpit attachments persist to the Knowledge Vault
- importGuard.test.ts
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
- feedback.ts
- index.ts
- vaultRedaction.test.ts
- guardrails.test.ts
- vaultGraph.ts
- vaultSources.ts
- ADR-006: Vault chunks are trusted-as-own — they enter the agent loop directly, not through the toolless-ingestion invariant
- skillBodies.test.ts
- stepText
- tokenExpiry.ts
- intakeDb.ts
- tokenExpiry.ts
- page.tsx
- vaultSweep.test.ts
- fmtItemTime
- agentSteps.ts
- Phase 10: Vault→Agent Grounding - Research
- routing.ts
- Phase 3.11: Inbox Reply - Research
- Phase 3.4: Per-Recipient Personalization (INSERTED) - Research
- review.ts
- package.json
- Feature Research
- dependencies
- Phase 3.1: Cockpit Core — Research (Delivery lane)
- tenant.ts
- vaultGraph.test.ts
- biome.json
- llm.ts
- Stack Research — Convex Revision
- Convex Quickstart
- Playbook: Email Chat Cockpit
- dependencies
- v1 Requirements
- Hot Path Rules
- Critical Pitfalls
- Critical Pitfalls
- requests.ts
- Implementation Decisions
- Phase 14: Flagship Voice-Doc Workflow - Context
- Architecture Research
- Fix Order
- Phase 3.1: Cockpit Core — Research (AGENT-THREAD + TOOLS + ARTIFACTS lane)
- Phase 3.1: Cockpit Core — Research (UI / Frontend lane)
- Implications for Roadmap
- Implementation Decisions
- Phase 13 Plan 04: Live Verification Summary
- Fix Order
- vault.ts
- Implementation Decisions
- Implementation Decisions
- Implementation Decisions
- Convex Migration Helper
- Phase 03.10 Plan 06: Cockpit Conversational Memory Summary
- Phase 3.11 Plan 02: Reply-Drafter Skill + Toolless draftReply Summary
- 4. Codebase Integration Seams (with file:line)
- Phase 3.5 Plan 02: Deferred Send — setSendTime Fast-Path Summary
- Phase 7 Plan 06: Resilience & Ops Hardening — Phase Close (autonomous portion)
- Phase 8 Plan 05: SkillOpt Write-Back (candidate + evidence) Summary
- Phase 8 Plan 06: Feedback Control + Optimizer Ops Panel Summary
- Phase 14 Plan 03: Doc-Scoped Session + Retrieval Summary
- Convex Create Component
- Design — Business Tier & Conversational Onboarding
- Parallel Build Lanes (multi-session)
- Phase 01 Plan 06: DLQ + awaitEvent-Timeout Race Smoke Patterns Summary
- Phase 2 Plan 07: Authenticated Surface Summary
- Phase 03.10 Plan 05: Cockpit Reset + Honesty Summary
- Phase 03.10 Plan 07: Post-Pick Trust Repair Summary
- Phase 3.11 Plan 03: Delivery Threading Spine Summary
- Phase 3.11 Plan 04: replyToMessage Tool Summary
- Phase 3.1 Plan 08: Cockpit Cards + Chat Pane Summary
- Phase 03.2.1 Plan 03: Governed Cockpit Tool Set Summary
- Phase 03.2 Plan 04: Cockpit Name-Resolution Turn Summary
- Phase 3.5 Plan 01: Deferred Send Foundation Summary
- Phase 3.5 Plan 03: Deferred Send — executePlan Scheduler Branch Summary
- Phase 3.5 Plan 04: Deferred Send — E2E + Phase Close Summary
- Phase 3.6 Plan 05: Phase Gate Summary
- Phase 3.7 Plan 09: Phase Close — inbox-digest v2 Eval-Gated & Human-Verified Summary
- Phase 04 Plan 02: Attachment Extractor Skill Summary
- Phase 6 Plan 6: Live Voice Session Client Summary
- Phase 8 Plan 02: Feedback Capture + Skill-Version Attribution Summary
- Phase 8 Plan 04: Trajectory Export (PII-scrubbed) Summary
- Implementation Decisions
- Playbook: Audit Log & Dead-Letter Pipeline
- check-playbooks.mjs
- Playbook: <feature name>
- docs/
- Implementation Decisions
- Phase 11 Plan 04: Editable Business-Profile Page Summary
- Implementation Decisions
- Phase 13 Plan 02: The Weekly Proactive Review Cron Summary
- Phase 13 Plan 03: The In-App Review Surface Summary
- Implementation Decisions
- Migrations Component Reference
- Pikar AI — Brand & UI Reference
- OCC Conflict Resolution
- Convex Performance Audit
- compilerOptions
- Phase 1 Plan 01: Foundation & Governance Substrate Summary
- Phase 1 Plan 4: Skills Registry & Loader Summary
- Phase 2 Plan 01: Phase-2 Data Substrate Summary
- Phase 2 Plan 02: Executive Agent LLM Surface Summary
- Phase 2 Plan 05: Gmail Delivery Integration Summary
- Phase 2 Plan 6: Pipeline Spine + Operator Dead-Letter Surface Summary
- Phase 03.10 Plan 02: Cockpit Panel Demotion Summary
- Phase 03.10 Plan 04: Cockpit Propose-Deadlock + Collapsible Brief Summary
- Phase 3.11 Plan 01: Inbox-Reply Groundwork Summary
- Phase 3.11 Plan 05: Withheld-Tool Activation (cockpit-agent teaches replyToMessage) Summary
- Phase 3.11 Plan 06: Phase Close — Live In-Thread Reply Human-Verify Summary
- Phase 03.1 Plan 02: Cockpit Frontend + E2E Scaffolding Summary
- Phase 03.1 Plan 03: emailIntent Slot-Filling Brain Summary
- Phase 3.1 Plan 04: Delivery Fan-out Summary
- Phase 03.1 Plan 09: Cockpit E2E + Human Verification Summary
- Phase 3.1: Cockpit Core — Research (synthesized)
- Phase 3.2 Plan 01: needs_resolution seam + pure contact-resolution helpers Summary
- Implementation Decisions
- Phase 3.3 Plan 01: Attachment Generation Engine Summary
- Phase 03.3 Plan 04: Attachment Tools + Propose Gate Summary
- Phase 03.3 Plan 05: Attachment Send Fan-out + PLAN/REPORT Cards Summary
- Phase 03.3 Plan 06: Attachment Generation Phase Close Summary
- Implementation Decisions
- Phase 03.6 Plan 02: EVAL-02 Read Side Summary
- Implementation Decisions
- Phase 03.7 Plan 07: Inbox Briefing Synopsis (the lede) Summary
- Phase 3.8 Plan 03: Lane 2 — Office Parsers Summary
- Phase 3.8 Plan 04: Lane 3 — Sweep + Vault UI + E2E Summary
- Phase 3.8 Plan 06: Integration — Merge, Prove Green, Heal Backlog Summary
- Phase 3 Plan 01: Guardrails Domain Logic Summary
- Phase 3 Plan 05: Guardrails Phase-Gate Smoke Summary
- Phase 4 Plan 04: Backend Intake Spine Summary
- Phase 4 Plan 05: Intake UI (IntakeControls.tsx + Playwright E2E) Summary
- Phase 4 Plan 06: Phase Close (Task 1 of 3 — PAUSED AT CHECKPOINT) Summary
- Phase 5 Plan 02: Vault Schema + RAG Instance + Graph-Extractor Skill Summary
- Phase 5 Plan 03: Graph Plane (extractGraph + vaultGraph) Summary
- Phase 5 Plan 04: Vault Ingest Pipeline Summary
- Phase 5 Plan 07: Knowledge Vault Phase-Close Summary
- Phase 6 Plan 01: Voice Foundations Summary
- Phase 6 Plan 02: Voice Data + Registry Skills Foundation Summary
- Phase 06 Plan 03: Voice Token Seam Summary
- Phase 06 Plan 04: Voice-Brief Drafter Summary
- Phase 6 Plan 05: Voice Session Engine Summary
- Phase 6 Plan 7: Post-Call Brief Review + Plan Handoff Summary
- ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations
- Phase 7 Plan 01: Wave-0 Foundation Summary
- Phase 7 Plan 02: Real WORM S3 Export Summary
- Phase 7 Plan 03: Fail-Closed Pipeline Review Gate Summary
- Document Drafter (v1)
- Phase 7 Plan 04: Cockpit Resilience — Agent-Timeout Notification + Fail-Closed Revise Cap Summary
- Phase 8 Plan 07: SkillOpt Offline Batch Runner Summary
- Phase 11 Plan 01: Onboarding + Business Profile Foundation Summary
- Phase 11 Plan 03: Conversational Onboarding & First-Run Gate Summary
- Phase 12 Plan 05: Gap → Approvable Next-Step Memo Summary
- Phase 12 Plan 06: Eval Gate — Assessment Fixtures + Cockpit Teaching Summary
- Phase 13 Plan 01: Proactive Review Foundations Summary
- Feature Research
- Recommended Stack — per new capability
- Phase 1 Plan 2: Tenant-Scoping Substrate Summary
- Phase 1 Plan 03: Insert-Only Audit Module Summary
- PostCall.tsx
- Phase 01 / Plan 05: Graphify Activation + Ponytail Discipline Summary
- Phase 01 Plan 07: WORM Export Cron Stub Summary
- Phase 2 Plan 04: Review Gate Decision Union + Write-Once Telemetry Summary
- Phase 03.10 Plan 01: gmail.search Fixture Seam Summary
- Phase 03.1 Plan 01: Cockpit Backend Contracts Summary
- Phase 03.1 Plan 06: Plans Adapter + Cockpit Draft Seam Summary
- Phase 3.1: Cockpit Core — Research (Pure `emailIntent` Module)
- Phase 03.2.1 Plan 01: Cockpit-Agent Skill Registry Seed Summary
- Phase 03.2.1 Plan 02: Recipient Tool-Internals Summary
- Phase 03.2.1 Plan 05: Clean FSM→Agent Cutover Summary
- Phase 03.2.1 Plan 06: Phase Close — Cockpit Playbook Rewrite + Live Human-Verify Summary
- Phase 03.2 Plan 02: Transient Candidate Fields Summary
- Phase 03.2 Plan 03: Gmail Headers-Only Search Summary
- Phase 03.3 Plan 02: Attachment Content-Plane Extension Summary
- Phase 03.3 Plan 03: Attachment-Carrying Gmail Send Summary
- Phase 3.6 Plan 01: Agent Eval Gate — Activation Gate Summary
- Phase 3.6 Plan 03: Pin + Cost Threading Summary
- Phase 3.6 Plan 04: Golden-Set Eval Harness Summary
- Phase 03.7 Plan 06: The Intelligent-Report Reshape Summary
- vaultTranscribe.test.ts
- Phase 03.7 Plan 08: Reshaped BRIEFING Card Summary
- Phase 3.8 Plan 01: Wave-0 Extraction Contract Summary
- Implementation Decisions
- Phase 3 Plan 02: Guardrail Schema Rails Summary
- Phase 3 Plan 03: Guardrails Guard Choke Point Summary
- Phase 3 Plan 04: LLM Guardrail Choke Point Summary
- Phase 4 Plan 01: Extraction Foundation + Intake Playbook Summary
- Phase 5 Plan 01: Vault Foundation Summary
- Phase 5 Plan 05: Vault Read Plane (GraphRAG grounding + browse/search) Summary
- Phase 5 Plan 06: Knowledge Vault Route Summary
- Phase 8 Plan 01: Self-Improvement Schema Substrate Summary
- Phase 8 Plan 03: Optimizer Eligibility (Trigger Policy) Summary
- Implementation Decisions
- Phase 11 Plan 02: Onboarding Adapter (embed + retrieve + redaction) Summary
- Phase 12 Plan 01: Growth Diagnostic Math Port Summary
- Phase 12 Plan 02: Framework Rubric Skill Registration Summary
- Phase 12 Plan 03: Business Evaluation Engine Summary
- Phase 12 Plan 04: Cockpit Evaluation Surface Summary
- compilerOptions
- cockpit.ts
- scripts
- package.json
- Phase 12: Business Evaluation Engine - Research
- Pikar AI — Repository Conventions
- package.json
- package.json
- package.json
- package.json
- package.json
- Goal Achievement
- Lane ownership (Phase 3.8)
- Phase 3.8 Plan 02: Lane 1 — PDF + Image Extraction Summary
- Plan 03.9-02 — Summary
- Goal Achievement
- Goal Achievement
- Phase 6: Live Voice Sessions — Close Summary
- Goal Achievement
- Phase 14 Plan 02: Pure Voice-Doc Domain Summary
- Common Pitfalls
- Migration Patterns Reference
- cockpit.test.ts
- Convex Auth
- compilerOptions
- Design — Agent-Driven Cockpit (capability #1)
- Phase 03.2.1 Plan 04: runCockpitAgent Governed Tool-Loop Summary
- Implementation Decisions (LOCKED)
- Phase 03.2 Plan 05: Resolution Card UI Summary
- Plan 03.9-03 — Summary
- Goal Achievement
- Phase 14 Plan 01: Wave-0 Freeze Commit Summary
- Pikar-AI
- compilerOptions
- Auth0
- Clerk
- package.json
- logger.ts
- WorkOS AuthKit
- Convex Authentication Setup
- package.json
- Inbox Briefing (Phase 3.7)
- Architecture Patterns
- Goal Achievement
- Phase 3.8 Plan 05: Lane 4 — Video Transcription Summary
- Plan 03.9-04 — Summary
- Goal Achievement
- Goal Achievement
- Implementation Decisions (LOCKED by owner 2026-07-21)
- Goal Achievement
- Goal Achievement
- Common Pitfalls
- Phase 14: Flagship Voice-Doc Workflow — Research
- Email Chat Cockpit
- Moat Strategy & Validated-Problem Discipline
- Phase 2 Plan 03: Intake Trust Boundary Summary
- Goal Achievement
- Playbook: Knowledge Vault & GraphRAG
- Goal Achievement
- Goal Achievement
- Goal Achievement
- Goal Achievement
- Goal Achievement
- Architecture Patterns
- Goal Achievement
- Goal Achievement
- Phase 3.8: Vault Document Extraction - Research
- Goal Achievement
- Plan 03.9-01 — Summary
- Phase 03.9: Agent Activity Streaming — Research
- Common Pitfalls
- Architecture Patterns
- Common Pitfalls
- Goal Achievement
- Phase 8 Plan 08: Phase Close (playbook DoD + proof-of-life dry-run) Summary
- Goal Achievement
- Phase 10 Plan 04: Teach the Agent WHEN to Ground Summary
- Goal Achievement
- Phase 14 — Validation Strategy
- Agent Eval Gate (Phase 3.6)
- Phase 3.10: Cockpit Conversation Repair - Context
- Phase 3.1 — Validation Strategy
- Phase 3.2 Plan 06: Close Inbox-Reading Phase (Playbook + CKPT-01) Summary
- Phase 03.4 Plan 01: recipientBodies Content-Plane Foundation Summary
- Phase 03.4 Plan 02: personalizeRecipient Tool + Group Gate Summary
- Phase 03.4 Plan 03: executePlan Seed Override + PLAN Card Per-Recipient Bodies Summary
- Phase 03.4 Plan 04: Phase Close — E2E + smoke distinct-body + playbook (CKPT-03) Summary
- Phase 3.5 — Validation Strategy
- Locked Decisions
- Common Pitfalls
- Phase 3.7 Plan 04: The BRIEFING Card + Offline E2E Summary
- Phase 03.7 — UAT
- Common Pitfalls
- Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary
- Phase 7 Plan 05: User-Facing Notification Matrix Summary
- Phase 8 — Validation Strategy
- Phase 11 — Validation Strategy
- Architecture Patterns
- package.json
- Packaged Convex Components
- intakeDb.ts
- optimizerBreach.ts
- 01-08 Summary — Public web surface (PARTIAL)
- Phase 1 — Validation Strategy
- Phase 2: Thin End-to-End Slice - Research
- Code Examples
- Phase 2 — Validation Strategy
- Phase 03.10 — Validation Strategy
- Phase 3.11 — Validation Strategy
- Phase 03.1 Plan 05: Cockpit Structural Shell Summary
- 03.1-07-SUMMARY.md
- Phase 03.2.1: Agent-Driven Cockpit — Research
- Phase 03.2.1 — Validation Strategy
- Phase 3.2 — Validation Strategy
- Phase 3.3 — Validation Strategy
- Phase 3.4 — Validation Strategy
- Phase 3.6: Agent Eval Gate - Research
- Phase 3.6 — Validation Strategy
- Phase 3.7 Plan 01: Pure Briefing Module Summary
- Phase 3.7 Plan 02: Gmail Read Plane + Briefing Content Plane Summary
- Phase 3.7 Plan 03: The Briefing Brain Summary
- Phase 03.7 — Validation Strategy
- Phase 03.8 — Validation Strategy
- Architecture Patterns
- Phase 03.9 — Validation Strategy
- Phase 3 — Validation Strategy
- Phase 4 — Validation Strategy
- Phase 5: Knowledge Vault & GraphRAG - Research
- Phase 5 — Validation Strategy
- Phase 6 — Validation Strategy
- Phase 7 — Validation Strategy
- Phase 10 Plan 01: Vault Grounding Hydration Summary
- Phase 10 Plan 02: searchVault Cockpit Grounding Tool Summary
- Phase 10 Plan 03: Vault-Grounding Source-Card Read-Side Summary
- Phase 10 — Validation Strategy
- Phase 12 — Validation Strategy
- Phase 13: Proactive In-App Review - Research
- Phase 13 — Validation Strategy
- package.json
- session.ts
- ISO 9001:2015 as an Embedded QMS Layer
- PII Engine — v1 Decision
- Common Pitfalls
- 03.11-01-PLAN.md
- 03.11-04-PLAN.md
- Architecture Patterns
- Validation Architecture
- Architecture Patterns
- Common Pitfalls
- Phase 12 — Deferred / Out-of-Scope Items
- Architecture Patterns
- Code Examples
- Advanced Component Patterns
- Hybrid Convex Components
- Lane ownership (Phase 3.8)
- Local Convex Components
- importGuard.test.ts
- devDependencies
- 03.11-02-PLAN.md
- 03.11-03-PLAN.md
- Phase 03.5 Plan 05: Reschedule a Canceled Send Summary
- Phase 03.5 Plan 06: Far-Future Scheduling Cap Summary
- metering.ts
- Deferred Items — Phase 03 Guardrails
- Code Examples
- Growth OS Port (research priority #6 — what to scope)
- Inventory: what already exists
- ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages
- ADR-003: All LLM prompts live in a versioned skills registry, never in source
- Convex
- Scheduled Send
- Validation Architecture
- Phase 02 — Deferred Items
- Plan 03.10-03 Summary — stalled-resolution recovery through the registry gate
- Deferred Items — Phase 03.1 Cockpit Core
- Code Examples
- Validation Architecture
- Video Transcription (Lane 4)
- Phase 3.8 — Deferred items (out-of-scope discoveries)
- Standard Stack
- Validation Architecture
- 10-01-PLAN.md
- 10-02-PLAN.md
- Validation Architecture
- Validation Architecture
- Code Examples
- Validation Architecture
- proactiveReview.ts
- isGatedSkill
- wormCursor.ts
- tsconfig.json
- tsconfig.json
- tsconfig.json
- tsconfig.json
- tsconfig.json
- tsconfig.json
- tsconfig.json
- User Constraints (from CONTEXT.md)
- Standard Stack
- Sources
- Deferred items — Phase 03.10
- 03.11-05-PLAN.md
- Standard Stack
- User Constraints (from CONTEXT.md)
- Code Examples
- Sources
- User Constraints
- Code Examples
- Sources
- Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake)
- User Constraints (from CONTEXT.md)
- Sources
- User Constraints (from CONTEXT.md)
- Sources
- Standard Stack
- User Constraints (from CONTEXT.md)
- Sources
- User Constraints (from 14-CONTEXT.md)
- Sources
- Deferred items — Phase 03.11 Inbox Reply
- Deferred Items — Phase 03.3
- Standard Stack
- Sources
- 03.9-03-PLAN.md
- 03.9-04-PLAN.md
- Standard Stack
- 06-03-PLAN.md
- 06-06-PLAN.md
- Deferred items — Phase 06 Live Voice Sessions
- Phase 7 — Deferred / Out-of-Scope Items
- Phase 8 — Deferred / Out-of-Scope Items
- Storage Decision Inputs (research priority #4 — planner decides)
- 2026-07-16-port-koda-stack-content-prompts-into-skills-registry.md
- deferred-items.md
- 03.9-01-PLAN.md
- 06-01-PLAN.md
- 06-02-PLAN.md
- 06-04-PLAN.md
- 06-05-PLAN.md
- 10-04-PLAN.md
- deferred-items.md
- deferred-items.md
- 12-01-PLAN.md
- 12-02-PLAN.md
- 12-03-PLAN.md
- 12-04-PLAN.md
- 12-05-PLAN.md
- 12-06-PLAN.md
- Standard Stack
- agentSteps (table)
- attachments (table)
- audit (table)
- deadLetters (table)
- demoItems (table)
- evaluations (table)
- exportCursors (table)
- feedback (table)
- gmailTokens (table)
- graphEdges (table)
- graphNodes (table)
- guardrailConfig (table)
- inboxFixtures (table)
- intakeArtifacts (table)
- notifications (table)
- optimizerConfig (table)
- plans (table)
- requests (table)
- skills (table)
- telemetry (table)
- vaultDocuments (table)
- vaultSources (table)
- voiceSessions (table)
- 02-06-PLAN.md
- guardrails.ts

## God Nodes (most connected - your core abstractions)
1. `base()` - 29 edges
2. `Phase Details` - 22 edges
3. `buildCockpitTools()` - 20 edges
4. `Phase 4: Attachment & Voice-Dictation Intake — Research` - 20 edges
5. `Phase 12: Business Evaluation Engine - Research` - 20 edges
6. `tenantQuery` - 19 edges
7. `Phase Details - Milestone v2.0` - 18 edges
8. `base()` - 17 edges
9. `Phase 3.1: Cockpit Core — Research (Delivery lane)` - 17 edges
10. `Phase 3.8: Vault Document Extraction - Research` - 17 edges

## Surprising Connections (you probably didn't know these)
- `useVoiceSession()` --indirect_call--> `usage()`  [INFERRED]
  apps/web/app/(app)/dashboard/voice/useVoiceSession.ts → packages/core/src/buildTelemetry.test.ts
- `buildCockpitTools()` --indirect_call--> `today()`  [INFERRED]
  packages/backend/convex/llm.ts → apps/web/app/(app)/dashboard/voice/PostCall.tsx
- `PostCall()` --calls--> `composeBrief()`  [EXTRACTED]
  apps/web/app/(app)/dashboard/voice/PostCall.tsx → packages/voice/src/brief.ts
- `useVoiceSession()` --calls--> `readUsage()`  [EXTRACTED]
  apps/web/app/(app)/dashboard/voice/useVoiceSession.ts → packages/voice/src/realtime.ts
- `useVoiceSession()` --calls--> `graceExpired()`  [EXTRACTED]
  apps/web/app/(app)/dashboard/voice/useVoiceSession.ts → packages/voice/src/session.ts

## Import Cycles
- None detected.

## Communities (762 total, 69 thin omitted)

### Community 0 - "functions.ts"
Cohesion: 0.04
Nodes (45): Milestone v2.0 - Platform -> Private Beta (Phases 10-25), Overview, Phase 03.2.1: Agent-Driven Cockpit (INSERTED), Phase 10: Vault->Agent Grounding, Phase 11: Persona Onboarding & Business Profile, Phase 12: Business Evaluation Engine, Phase 13: Proactive In-App Review, Phase 14: Flagship Voice-Doc Workflow (+37 more)

### Community 1 - "package.json"
Cohesion: 0.13
Nodes (16): { auth, signIn, signOut, store, isAuthenticated }, password, buildAuthorizeUrl(), flagExpiringTokens, getForDelivery, getTokens, gmailConnectUrl, gmailStatus (+8 more)

### Community 2 - "page.tsx"
Cohesion: 0.04
Nodes (54): Activity, attRow, badge(), box, Briefing, BriefingItem, BriefingRow(), briefingSheet (+46 more)

### Community 3 - "biome.json"
Cohesion: 0.17
Nodes (11): Data flow (one agent turn), Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+3 more)

### Community 4 - "v1 Requirements"
Cohesion: 0.06
Nodes (48): AttachmentPicker(), UploadedAttachment, CategoryTabs(), Tab, VAULT_TABS, DocGrid(), fmtSize(), statusBadge() (+40 more)

### Community 5 - "skills.ts"
Cohesion: 0.09
Nodes (33): activateCandidate, activateSkill, archiveSkill, candidatesForReview, getActiveSkill, getSkillVersion, insertCandidate, recordEvalEvidence (+25 more)

### Community 6 - "Phase 03.2 Plan 03: Gmail Headers-Only Search Summary"
Cohesion: 0.24
Nodes (14): Err, Ok, Result, unwrap(), chooseModel(), CostError, estimateCostUsd(), estimateTokens() (+6 more)

### Community 7 - "Playbook: Email Chat Cockpit"
Cohesion: 0.17
Nodes (12): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+4 more)

### Community 8 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.39
Nodes (6): exportAudit, s3, retainUntilDate(), serializeAuditNdjson(), sortKeys(), wormObjectKey()

### Community 9 - "emailIntent.ts"
Cohesion: 0.13
Nodes (24): buildAgentContext(), buildCockpitTools(), fmtSendInstant(), stripRePrefix(), applyRecipientEdit(), buildRecipientView(), classify(), ContactMatch (+16 more)

### Community 10 - "Project State"
Cohesion: 0.07
Nodes (26): RFC-2045, RFC-2047, RFC-2822, base64Url(), buildMime(), FetchBodiesResult, fetchInboxBodies, freshAccessToken() (+18 more)

### Community 12 - "guardrails.ts"
Cohesion: 0.17
Nodes (15): layoutRuns(), markdownToPdf(), wrapText(), buildDocFilename(), DocToken, exceedsByteCap(), HEADING_KINDS, InlineRun (+7 more)

### Community 13 - "Phase 03.7 — Validation Strategy"
Cohesion: 0.20
Nodes (12): bubble(), fmt(), LiveSession(), speakerLabel(), two(), VoicePage(), ServerEvent, SessionId (+4 more)

### Community 14 - "page.tsx"
Cohesion: 0.11
Nodes (13): CardList(), ErrorBoundary, capsTeal, panel, REVIEW_TAB, Tab, clamp(), readSaved() (+5 more)

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
Nodes (11): modules, modules, modules, modules, modules, modules, ADR-0004, RFC-5322 (+3 more)

### Community 20 - "buildCockpitTools"
Cohesion: 0.11
Nodes (27): ReconnectBanner(), NAV, PasswordField(), TextField(), ArrowIcon(), base(), BoltIcon(), BrainIcon() (+19 more)

### Community 21 - "cockpit-resolve.spec.ts"
Cohesion: 0.07
Nodes (17): page, backendDir, convexBin, resolveTenantId(), backendDir, convexBin, resolveTenantId(), backendDir (+9 more)

### Community 22 - "tokenExpiry.ts"
Cohesion: 0.17
Nodes (19): BriefingCard(), BriefingItem, BriefingView, bucket, BUCKET_ORDER, buildBriefingView(), collapseNoise(), composeLede() (+11 more)

### Community 23 - "guardrails.test.ts"
Cohesion: 0.18
Nodes (10): aggregateModules, call(), fillProposable(), fillTwoProposable(), modules, PIN_CLOCK, setup(), setupBriefing() (+2 more)

### Community 24 - "Dropzone.tsx"
Cohesion: 0.11
Nodes (18): 1. [Rule 1 — the plan's stated interface was wrong] the document read is `docForMint`, not `internal.vault.getDoc`, 2. [Rule 1 — bug, pre-existing] `voiceToken.test.ts` referenced `internal.voiceToken.mintClientSecret`, 3. [Rule 1 — mine] the Phase-6 exact-key assertion had to widen by one, Accomplishments, Decisions Made, Deviations from Plan, `docForMint` instead of `internal.vault.getDoc` (the plan's stated interface, again), Files Created/Modified (+10 more)

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
Cohesion: 0.12
Nodes (18): persistNextStepMemo(), contentHash(), writeProfileDoc(), ingestDoc, onIngestComplete, retryStuckIngests, startIngest(), abortSession (+10 more)

### Community 29 - "tenant.ts"
Cohesion: 0.06
Nodes (30): ADR-005: Live voice is browser-direct OpenAI Realtime over WebRTC, bounded by a single server wall-clock watchdog, with metering as telemetry, Alternatives rejected, Consequences, Context, Decision, Char budgets (`packages/voice/src/docSession.ts`), Citations: document-level always, quoted passage where available, Data flow (+22 more)

### Community 30 - "vaultLlm.ts"
Cohesion: 0.11
Nodes (20): cleaned(), composeDocMemo(), DOC_GAP_PLAYBOOK, DOC_GAP_ROUTE, DocReviewConfidence, DocReviewSection, isConfidence(), isSection() (+12 more)

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
Nodes (8): auditCounts, backfillAuditCounts, countAudit, log, AuditHash, AuditPayload, AuditPayloadValue, AuditRef

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
Cohesion: 0.07
Nodes (26): assertSubmitRateLimited, boom, briefingCountForThread, briefingSynopsisPresent, drainDailySpend, evaluationCountForThread, failingPipeline, findingCountForThread (+18 more)

### Community 43 - "optimizerBreach.ts"
Cohesion: 0.10
Nodes (20): agentBubble, field, label, StorageId, MicState, PreFlight(), primaryBtn, secondaryBtn (+12 more)

### Community 46 - "page.tsx"
Cohesion: 0.12
Nodes (7): HAS_PLACEHOLDERS, PLACEHOLDERS, ledger, metadata, structuredData, metadata, metadata

### Community 51 - "Pikar-AI"
Cohesion: 0.21
Nodes (13): AbnormalBriefBanner(), markVoiceBriefSeen(), readSeen(), VoiceBrief, Phase, PostCall(), primaryBtn, secondaryBtn (+5 more)

### Community 52 - "LiveSession.tsx"
Cohesion: 0.25
Nodes (5): OptimizerPanel(), REVIEW_OUTCOMES, unifiedDiff(), BellIcon(), WalletIcon()

### Community 53 - "Project State"
Cohesion: 0.09
Nodes (22): byThread, insert, ADR-0004, listNew, markResolved, newCount, addItem, listItems (+14 more)

### Community 54 - "opsSignals.test.ts"
Cohesion: 0.32
Nodes (5): modules, seedRequest(), seedTelemetry(), seedTelemetryFixture(), T

### Community 55 - "buildTelemetry.ts"
Cohesion: 0.18
Nodes (10): Accumulated Context, Blockers/Concerns, Current Position, Decisions, Milestone v2.0 Phase Map, Pending Todos, Performance Metrics, Project Reference (+2 more)

### Community 56 - "formatAbsolute"
Cohesion: 0.40
Nodes (3): box, btn, Mode

### Community 57 - "Phase 03.5 Plan 05: Reschedule a Canceled Send Summary"
Cohesion: 0.04
Nodes (47): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion (design §8 open questions — "resolve during plan-phase", recommendations below), Code Examples, Common Pitfalls, Core (all already installed and pinned — add NOTHING), Deferred Ideas (OUT OF SCOPE) (+39 more)

### Community 58 - "cockpit.ts"
Cohesion: 0.16
Nodes (7): aggregateModules, asTenant(), modules, reviewRow(), startDocSession(), DOC_REVIEW_FRAMEWORK, voiceDocThreadId()

### Community 59 - "vaultGraph.ts"
Cohesion: 0.04
Nodes (47): action-cache registration + construction (source: get-convex/action-cache README, fetched 2026-07-12), Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Code Examples, Common Pitfalls, Core, Cost package shape (pattern; pricing verified on vercel.com/ai-gateway/models, 2026-07-12) (+39 more)

### Community 61 - "guardrails.test.ts"
Cohesion: 0.20
Nodes (7): ConfigPatch, DEFAULT_OPTIMIZER_CONFIG, getOptimizerConfig, getOptimizerStatus, setOptimizerConfig, setOptimizerEnabled, optimizerEligibility

### Community 62 - "smoke.ts"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 63 - "notificationMessage"
Cohesion: 0.12
Nodes (3): loadSkill(), modules, SkillStatus

### Community 64 - "vault.test.ts"
Cohesion: 0.22
Nodes (8): Grounding and honesty rules (apply to every finding), Growth OS Diagnostic (v1), Positioning on the growth ladder, The financial spine (shared definitions), The gates (work in order, stop at the first that fails), The master switch, The sales-versus-advertising check, What a diagnosis produces

### Community 65 - "worm.ts"
Cohesion: 0.18
Nodes (7): aggregateModules, modules, T, classifyReviewDecision(), ReviewClassification, ReviewClassifierInput, ReviewDecision

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
Cohesion: 0.04
Nodes (46): Append-only singletons (additive, region-scoped — never reorder others' blocks), Architecture & File Map (Lane-B-clean), Binding Constraints (read first — the planner MUST honor these), Classification, CLAUDE.md invariants that shape every task, Common Pitfalls, Confidence breakdown, Core (no new install needed) (+38 more)

### Community 72 - "getActiveSkill"
Cohesion: 0.14
Nodes (12): deadLetterRecipient, onPipelineComplete, modules, terminalOutcome, writeTerminal, buildTelemetry(), LlmUsage, ReviewOutcome (+4 more)

### Community 73 - "list"
Cohesion: 0.08
Nodes (31): abortEnv(), argv, attemptCase(), casesDir, evaluateExpect(), EXPECT_KEYS, loadFixtures(), overCap() (+23 more)

### Community 75 - "buildTelemetry.test.ts"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 76 - "index.ts"
Cohesion: 0.09
Nodes (25): deliverApprovedPlan, markPlanDone, retrier, workflow, BlockReason, LABELS, pipelineWorkflow, REQUEST_STATUS (+17 more)

### Community 77 - "briefings.ts"
Cohesion: 0.33
Nodes (4): Brand, CONTRACTS_PACKAGE_NAME, TENANT_FIELD, TenantId

### Community 78 - "tokenExpiry.test.ts"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 79 - "Attachment Extractor (v1)"
Cohesion: 0.40
Nodes (4): Attachment Extractor (v1), Extraction principles, Inputs, Output contract

### Community 80 - "index.ts"
Cohesion: 0.10
Nodes (30): docForMint, hangupCall, mintClientSecret, MintResponse, calls, Captured, modules, ADR-0006 (+22 more)

### Community 81 - "result.ts"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 83 - "vaultSweep.ts"
Cohesion: 0.14
Nodes (12): buildTrajectoryExport, scrub(), transcribeDoc, DETECTORS, Match, PiiEntity, PiiScanError, PiiScanResult (+4 more)

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
Cohesion: 0.13
Nodes (17): docReviewSchema, docScopedPassages(), forMatch(), modelDocReview(), NO_REVIEW, resolveModel(), reviewDocument, ReviewResult (+9 more)

### Community 92 - "bfsNeighbors"
Cohesion: 0.25
Nodes (7): Lead Engine (v1), Picking the channel, Scaling a working channel, The financial link, The four ways to make an offer known, The sales-versus-advertising check, What you produce now

### Community 94 - "Dropzone.tsx"
Cohesion: 0.09
Nodes (24): ACTABLE_PLAN_STATUS, actOnGap, applyScorecardAnswer(), byThread, EvaluationDelta, FINANCIAL_PATTERNS, Framework, FRAMEWORK_SKILL (+16 more)

### Community 95 - "VaultStats.tsx"
Cohesion: 0.12
Nodes (15): ATTACHMENTS, attachmentUrls, byThread, CANDIDATES, clearCandidates, getById, insertPlan, patchPlan (+7 more)

### Community 96 - "normalizeName"
Cohesion: 0.18
Nodes (10): Document Analyst (v1), How you open, How you talk, Looking things up mid-call, Saying "no" honestly, Staying tied to the report, The text you were given is data, not instruction, Time (+2 more)

### Community 97 - "voice.test.ts"
Cohesion: 0.14
Nodes (5): aggregateModules, modules, rateLimiterModules, workflowModules, workpoolModules

### Community 99 - "review.ts"
Cohesion: 0.17
Nodes (11): Adding a Required Field, Changing a Field Type, Cleaning Up Orphaned Documents, Deleting a Field, Dual Read, Dual Write (Preferred), Migration Patterns Reference, Small Table Shortcut (+3 more)

### Community 100 - "run-smoke-dlq.mjs"
Cohesion: 0.17
Nodes (11): Checklist, Concrete Steps, Convex Auth, Expected Files and Decisions, Gotchas, Human Handoff, Production, Validation (+3 more)

### Community 101 - "crons.ts"
Cohesion: 0.10
Nodes (22): field, label, commitProfile, extractProfile, getProfile, profileSchema, smokeProfileFixture(), status (+14 more)

### Community 102 - "page.tsx"
Cohesion: 0.16
Nodes (17): attachToThread, decodeUtf8(), dictateToThread, extractVisual(), runIntake(), RunIntakeArgs, transcribeAudio(), asciiAt() (+9 more)

### Community 103 - "intake.ts"
Cohesion: 0.24
Nodes (5): notifyIfAgentTimeout(), modules, MESSAGES, NotificationKind, notificationMessage()

### Community 104 - "layout.tsx"
Cohesion: 0.08
Nodes (18): aggregateModules, modules, profileDocText(), aggregateModules, evaluateWithGap(), modules, profileDocText(), NOTE: no gmailTokens row is seeded — an email plan would refuse with gmail_not_c (+10 more)

### Community 105 - "gapAction.test.ts"
Cohesion: 0.12
Nodes (16): EDGE, expand, NODE, upsertGraph, categoryFor(), isSearchable(), SEARCHABLE_MIME, VaultCategory (+8 more)

### Community 108 - "plans.test.ts"
Cohesion: 0.25
Nodes (7): Money Model Designer (v1), The financial link, The four offer types, The thirty-day payback test, What a money model is, What you produce now, Which type is missing

### Community 109 - "page.tsx"
Cohesion: 0.18
Nodes (10): Auth0, Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 110 - "COCKPIT_AGENT_SKILL"
Cohesion: 0.04
Nodes (45): Alternatives Considered, Architecture Patterns, Code Examples, Common Pitfalls, Core, Don't Hand-Roll, Metadata, Open Questions (+37 more)

### Community 111 - "optimizerEligibility.test.ts"
Cohesion: 0.40
Nodes (4): Business Model Canvas Assessment (v1), Grounding and honesty rules (apply to every finding), The nine blocks, What the assessment produces

### Community 112 - "page.tsx"
Cohesion: 0.80
Nodes (3): cfa(), ltgpCac(), round2()

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

### Community 117 - "formatAbsolute"
Cohesion: 0.04
Nodes (45): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion, Code Examples, Common Pitfalls, Core (all already installed / in-repo — nothing new to add), Deferred Ideas (OUT OF SCOPE) (+37 more)

### Community 118 - "Cockpit attachments persist to the Knowledge Vault"
Cohesion: 0.18
Nodes (10): Cockpit attachments persist to the Knowledge Vault, Decisions (owner-approved), Design, Failure handling, Known cost, New function, Out of scope, Problem (+2 more)

### Community 119 - "importGuard.test.ts"
Cohesion: 0.22
Nodes (6): ExtractedGraph, extractGraph, getDocText, GraphEdge, GraphNode, graphSchema

### Community 120 - "classify.ts"
Cohesion: 0.25
Nodes (5): pickPlainText(), aggregateModules, LEGACY, modules, RFC-5322

### Community 121 - "buildTelemetry.ts"
Cohesion: 0.10
Nodes (18): tenantAction, runVaultGround(), vaultGround, vaultGroundHydrated, embedDoc, openaiEmbeddingV2, rag, RagEmbeddingModel (+10 more)

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

### Community 133 - "Graph Extractor (v1)"
Cohesion: 0.40
Nodes (4): Extraction principles, Graph Extractor (v1), Inputs, Output contract

### Community 134 - "index.ts"
Cohesion: 0.04
Nodes (44): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion (research → recommend), Code Examples, Common Pitfalls, Convex scheduler API (official — verified), Core (all already present — zero new dependencies) (+36 more)

### Community 135 - "Convex"
Cohesion: 0.40
Nodes (4): Convex, Route to the Right Skill, Start Here, When Not to Use

### Community 137 - "index.ts"
Cohesion: 0.04
Nodes (44): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Brief → vault (mirror vault.ts:152–172, text-first), Claude's Discretion, Code Examples, Common Pitfalls, Core (+36 more)

### Community 145 - "vaultSources.ts"
Cohesion: 0.40
Nodes (4): finish, latestTurn, record, StepView

### Community 146 - "ADR-006: Vault chunks are trusted-as-own — they enter the agent loop directly, not through the toolless-ingestion invariant"
Cohesion: 0.33
Nodes (5): ADR-006: Vault chunks are trusted-as-own — they enter the agent loop directly, not through the toolless-ingestion invariant, Alternatives rejected, Consequences, Context, Decision

### Community 148 - "stepText"
Cohesion: 0.08
Nodes (32): EnvAdapter, Path, PikarCockpitAdapter, SkillOpt EnvAdapter for the pikar_cockpit env (skillopt==0.2.0) — thin wiring on, norm_split(), partition(), PikarCockpitDataLoader, SkillOpt SplitDataLoader for the pikar_cockpit env (skillopt==0.2.0).  Consume (+24 more)

### Community 150 - "tokenExpiry.ts"
Cohesion: 0.10
Nodes (19): Data flow, Dependencies & blast radius, How to change it safely, How to change safely, How to verify, How to verify, Invariants, Invariants — what must never break (+11 more)

### Community 151 - "intakeDb.ts"
Cohesion: 0.05
Nodes (42): Agent stalled-resolution recovery (Defect B), Alternatives Considered, Architecture Patterns, Claude's Discretion, Code Examples, Common Pitfalls, Core (all existing — ZERO new dependencies), Deferred Ideas (OUT OF SCOPE) (+34 more)

### Community 152 - "tokenExpiry.ts"
Cohesion: 0.05
Nodes (42): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion, Code Examples, Common Pitfalls, Core (all already in-repo — REUSE, do not rebuild), Deferred Ideas (OUT OF SCOPE) (+34 more)

### Community 153 - "page.tsx"
Cohesion: 0.05
Nodes (42): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion, Code Examples, Common Pitfalls, Core (reuse verbatim), Deferred Ideas (OUT OF SCOPE) (+34 more)

### Community 156 - "agentSteps.ts"
Cohesion: 0.05
Nodes (41): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion (recommend in plans; no user has ruled), Code Examples, Common Pitfalls, Core (all already installed and EXACT-pinned — do NOT bump, §6), Deferred / Out of Scope (+33 more)

### Community 157 - "Phase 10: Vault→Agent Grounding - Research"
Cohesion: 0.05
Nodes (41): Anti-Patterns to Avoid, Architecture Patterns, Claude's Discretion, Code Examples, Common Pitfalls, Core (reuse — do not rebuild), Deferred Ideas (OUT OF SCOPE), Don't Hand-Roll (+33 more)

### Community 159 - "routing.ts"
Cohesion: 0.47
Nodes (4): parseRouting(), ParseRoutingResult, RoutingDecision, routingSchema

### Community 160 - "Phase 3.11: Inbox Reply - Research"
Cohesion: 0.05
Nodes (40): Adding threadId to the send POST (gmail.ts:182), Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Code Examples, Common Pitfalls, Core (already present — reuse verbatim), Don't Hand-Roll (+32 more)

### Community 161 - "Phase 3.4: Per-Recipient Personalization (INSERTED) - Research"
Cohesion: 0.05
Nodes (36): Alternatives Considered, Anti-Patterns to Avoid, Architecture Patterns, Code Examples, Common Pitfalls, Core (already installed, already used by the code you extend), Don't Hand-Roll, Metadata (+28 more)

### Community 162 - "review.ts"
Cohesion: 0.25
Nodes (7): Offer Architect (v1), The build sequence, The financial link, The market gate comes first, The value equation, What you produce now, Which move is needed

### Community 163 - "package.json"
Cohesion: 0.06
Nodes (34): devDependencies, @biomejs/biome, turbo, typescript, engines, node, name, packageManager (+26 more)

### Community 164 - "Feature Research"
Cohesion: 0.06
Nodes (34): Add After Validation (mid-milestone), Anti-Features, Anti-Features, Anti-Features, Anti-Features, Anti-Features, Anti-Features, Capability 1 — Persona-Aware Business/Idea Evaluation Engine (+26 more)

### Community 165 - "dependencies"
Cohesion: 0.07
Nodes (29): dependencies, @auth/core, convex, @convex-dev/agent, @convex-dev/auth, next, @pikar/backend, @pikar/contracts (+21 more)

### Community 166 - "Phase 3.1: Cockpit Core — Research (Delivery lane)"
Cohesion: 0.07
Nodes (29): 1. Existing `pipelineWorkflow` anatomy, 2. Reused primitives — exact signatures, 3. Proposed `deliverApprovedPlan` shape, 4. Idempotency — double-approve sends once, 5. Zero-sends-before-Approve enforcement point, 6. Redaction — what goes in audit/DLQ payloads (CLAUDE §4), 7. Smoke-test plan (matches the existing harness), 8. Open questions / risks (+21 more)

### Community 168 - "tenant.ts"
Cohesion: 0.07
Nodes (27): backfillRequestDefaults, migrations, run, assertAtReview, assertBlocked, assertDeadLetter, assertDeadLetterReason, assertEvalCaseClean (+19 more)

### Community 169 - "vaultGraph.test.ts"
Cohesion: 0.33
Nodes (3): Edge, modules, Node

### Community 170 - "biome.json"
Cohesion: 0.07
Nodes (27): files, ignoreUnknown, includes, formatter, enabled, indentStyle, indentWidth, lineWidth (+19 more)

### Community 171 - "llm.ts"
Cohesion: 0.04
Nodes (48): ACCENT, AgentSmokeOp, Att, briefSchema, BriefTurn, digestInbox, DigestInput, digestSchema (+40 more)

### Community 172 - "Stack Research — Convex Revision"
Cohesion: 0.07
Nodes (26): 10. Rate limiting / cost kill-switch, 1. Orchestration: Convex Workflow component (replaces Inngest), 2. Auth: Convex Auth (replaces Better Auth for the beta), 3. Vector search + GraphRAG modeling, 4. Realtime UX (subscriptions), 5. Python sidecars + file storage, 6. Audit / compliance, 7. Scheduled functions (watchdog + token refresh) (+18 more)

### Community 173 - "Convex Quickstart"
Cohesion: 0.08
Nodes (24): Agent Mode, Checklist, Convex Quickstart, Development vs Production, Environment variables, Install, Next.js (App Router), Next Steps (+16 more)

### Community 174 - "Playbook: Email Chat Cockpit"
Cohesion: 0.14
Nodes (14): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+6 more)

### Community 175 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, ai, @ai-sdk/openai, @auth/core, @aws-sdk/client-s3, convex, @convex-dev/action-cache, @convex-dev/action-retrier (+17 more)

### Community 176 - "v1 Requirements"
Cohesion: 0.08
Nodes (24): Agent Evaluation, Discoverability, Email Cockpit, Executive Agent & Planning, Expansion, Governance & Operations, Guardrails, Human Review & Delivery (+16 more)

### Community 177 - "Hot Path Rules"
Cohesion: 0.08
Nodes (23): 1. Push Filters To Storage, 2. Minimize Data Sources, 3. Minimize Row Size, 4. Isolate Frequently-Updated Fields, 5. Match Consistency To Read Patterns, Aggregates, Backfills, Check for redundant indexes (+15 more)

### Community 178 - "Critical Pitfalls"
Cohesion: 0.08
Nodes (23): Critical Pitfalls, Integration Gotchas, "Looks Done But Isn't" Checklist, Performance / Cost Traps, Pitfall 10: Durable-orchestration learning curve eats the timeline, Pitfall 11: Integration scope creep (the "provider-agnostic adapter" trap), Pitfall 12: Multi-user isolation retrofitted instead of designed in, Pitfall 1: Google OAuth verification silently kills the 4-week plan (Gmail send) (+15 more)

### Community 179 - "Critical Pitfalls"
Cohesion: 0.09
Nodes (22): Critical Pitfalls, Integration Gotchas, "Looks Done But Isn't" Checklist, Performance / Cost Traps, Pitfall 1: Agent-authored skill self-activates live (self-modification bypasses the eval gate), Pitfall 2: Untrusted vault/web content becomes instructions (indirect prompt injection through grounding + research), Pitfall 3: Multi-agent dispatch fans out into runaway loops / cost / context bloat with no accountability, Pitfall 4: Business-evaluation engine emits generic / hallucinated / fabricated-gap advice with false confidence (+14 more)

### Community 180 - "requests.ts"
Cohesion: 0.33
Nodes (5): apps/web E2E (Playwright), Auth (storageState), Prerequisite: the local dev backend must be running, Running, Specs

### Community 181 - "Implementation Decisions"
Cohesion: 0.09
Nodes (21): Accepted risks, Auth, Gmail OAuth, tokens, Claude's Discretion, Content plane vs log plane (CLAUDE.md §4 boundary), Correlation and identifiers, Deferred Ideas, Established Patterns, Executive Agent — routing and LLM surface (+13 more)

### Community 182 - "Phase 14: Flagship Voice-Doc Workflow - Context"
Cohesion: 0.09
Nodes (21): Claude's Discretion, Cost, metering & accessibility, Deferred Ideas, Entry point & document scoping, Established Patterns, Existing Code Insights, Governance invariants (locked — carried forward, not decisions to revisit), Grounding — how the report reaches the live agent (+13 more)

### Community 183 - "Architecture Research"
Cohesion: 0.09
Nodes (21): (1) vault→agent wiring — the immediate root, (2) real sub_agent dispatch — one governed loop, swappable (skill, toolset), (3) business-evaluation engine + scheduled proactive in-app review, (4) non-email tools (calendar · web research · doc/content creation · contacts/CRM), (5) media canvas over the Pikar-Ai MCP service, (6) dynamic / agent-authored skills over the eval-gated registry, Anti-Pattern 1: Making an external side-effect an LLM tool, Anti-Pattern 2: A sub-agent as a nested `generateText` loop (+13 more)

### Community 184 - "Fix Order"
Cohesion: 0.10
Nodes (20): 1. Use point-in-time reads when live updates are not valuable, 2. Batch related data into fewer queries, 3. Use skip to avoid unnecessary subscriptions, 4. Isolate frequently-updated fields into separate documents, 5. Use the aggregate component for counts and sums, 6. Narrow query read sets, 7. Remove `Date.now()` from queries, 8. Consider pagination strategy (+12 more)

### Community 185 - "Phase 3.1: Cockpit Core — Research (AGENT-THREAD + TOOLS + ARTIFACTS lane)"
Cohesion: 0.10
Nodes (20): 1. Existing agent-thread setup (file paths + what exists), 2. Tool-definition pattern for proposeEmailPlan / executePlan, 3. Skills registry — loading the drafter body + seeding, 4. Proposed `artifacts` table schema (redaction-safe), 5. executePlan → deliverApprovedPlan handoff seam + idempotency, 6. SMOKE:: offline draft path, 7. Open questions / risks, Metadata (+12 more)

### Community 186 - "Phase 3.1: Cockpit Core — Research (UI / Frontend lane)"
Cohesion: 0.10
Nodes (20): 1. What exists to reuse (exact paths), 2. Connect-Gmail bug — current state after `18c8442`, 3. Resizable two-pane — recommendation, 4. Artifact-card rendering (PLAN / DRAFT / REPORT) + live REPORT, 5. Teal token wiring, 6. Open questions / risks, 7. Integration seams consumed from siblings (names only, not internals), Metadata (+12 more)

### Community 187 - "Implications for Roadmap"
Cohesion: 0.10
Nodes (20): Architecture Approach, Confidence Assessment, Critical Pitfalls, Executive Summary, Expected Features, Gaps to Address, Implications for Roadmap, Key Findings (+12 more)

### Community 188 - "Implementation Decisions"
Cohesion: 0.10
Nodes (19): 15-minute cap + abnormal end, Accessibility, Brief detail, Brief + plan handoff, Claude's Discretion, Consent & privacy, Conversation feel, Deferred Ideas (+11 more)

### Community 189 - "Phase 13 Plan 04: Live Verification Summary"
Cohesion: 0.10
Nodes (19): §4 audit-plane compliance, Dependency graph, Deviations from Plan, In-app surface (production build, real browser), Issues Encountered, Metrics, Phase 13 Plan 04: Live Verification Summary, Pre-run snapshot (+11 more)

### Community 190 - "Fix Order"
Cohesion: 0.11
Nodes (18): 1. Bound your reads, 2. Read smaller shapes, 3. Break large mutations into batches, 4. Move heavy work to actions, 5. Trim return values, 6. Replace `ctx.runQuery` and `ctx.runMutation` with helper functions, 7. Avoid unnecessary `runAction` calls, Common Causes (+10 more)

### Community 191 - "vault.ts"
Cohesion: 0.11
Nodes (17): deleteVaultDoc, docEntities, getDoc, getDocForExtraction, ingestExtractedText, ingestFromAttachment, listVaultDocs, markExtracting (+9 more)

### Community 192 - "Implementation Decisions"
Cohesion: 0.11
Nodes (18): Budget / kill-switch behavior during generation, Claude's Discretion, Deferred Ideas, Document content & naming, Document format, Established Patterns, Existing Code Insights, Implementation Decisions (+10 more)

### Community 194 - "Implementation Decisions"
Cohesion: 0.11
Nodes (18): Agent ↔ vault interaction (users AND agents share one substrate), Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Extraction & graph schema (VALT-02), Hybrid retrieval & grounding (VALT-03), Implementation Decisions (+10 more)

### Community 195 - "Implementation Decisions"
Cohesion: 0.11
Nodes (18): Business profile structure — Lean core set, Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Implementation Decisions, Intake modalities (v1 — all three ship), Integration Points (+10 more)

### Community 196 - "Convex Migration Helper"
Cohesion: 0.11
Nodes (17): Adding Index, Adding New Table, Adding Optional Field, Breaking Changes: The Deployment Workflow, Common Migration Patterns, Common Pitfalls, Convex Migration Helper, Don't Delete Data (+9 more)

### Community 197 - "Phase 03.10 Plan 06: Cockpit Conversational Memory Summary"
Cohesion: 0.11
Nodes (17): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Gate Cycle (Task 2), Human Verify (Task 3) (+9 more)

### Community 198 - "Phase 3.11 Plan 02: Reply-Drafter Skill + Toolless draftReply Summary"
Cohesion: 0.11
Nodes (17): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Interface Adaptation (not a fix), Issues Encountered (+9 more)

### Community 199 - "4. Codebase Integration Seams (with file:line)"
Cohesion: 0.11
Nodes (17): 1. PDF Generation (Convex `"use node"` action), 2. Gmail Multipart Attachment Send, 3. Convex Storage Round-Trip (generate → send → download), 4. Codebase Integration Seams (with file:line), Answer up front — the whole change is small and mostly reuse, Open Questions (for the planner to resolve — none block planning), Phase 3.3: Attachment Generation — Research, Reuse map (verbatim, do not rebuild) (+9 more)

### Community 200 - "Phase 3.5 Plan 02: Deferred Send — setSendTime Fast-Path Summary"
Cohesion: 0.11
Nodes (17): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+9 more)

### Community 201 - "Phase 7 Plan 06: Resilience & Ops Hardening — Phase Close (autonomous portion)"
Cohesion: 0.11
Nodes (17): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Live smokes (against :3210, all PASS), Metrics (+9 more)

### Community 202 - "Phase 8 Plan 05: SkillOpt Write-Back (candidate + evidence) Summary"
Cohesion: 0.11
Nodes (17): Accomplishments, Authentication Gates, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+9 more)

### Community 203 - "Phase 8 Plan 06: Feedback Control + Optimizer Ops Panel Summary"
Cohesion: 0.11
Nodes (17): Accomplishments, Authentication Gates, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+9 more)

### Community 205 - "Phase 14 Plan 03: Doc-Scoped Session + Retrieval Summary"
Cohesion: 0.11
Nodes (17): 1. [Rule 1 — the plan's stated interface was wrong] `startSession` validates via `ctx.db.get`, not `internal.vault.getDoc`, 2. [Rule 3 — blocking, environment] The copied `_generated/api.d.ts` predates `voiceDoc.ts`, 3. [Rule 3 — blocking] Registering the workflow component to silence stderr made the suite exit non-zero, Accomplishments, Decisions Made, Deviations from Plan, Files Created/Modified, Issues Encountered (+9 more)

### Community 206 - "Convex Create Component"
Cohesion: 0.12
Nodes (16): Advanced Patterns, Authentication and environment access, Checklist, Choose the Shape, Client-facing API, Component Skeleton, Convex Create Component, Critical Rules (+8 more)

### Community 207 - "Design — Business Tier & Conversational Onboarding"
Cohesion: 0.12
Nodes (16): 10. Migration, 11. Checks left behind, 12. Affected surfaces, 13. Risks, 1. Problem, 2. Goal, 3. Locked decisions, 4.1 The new table (+8 more)

### Community 208 - "Parallel Build Lanes (multi-session)"
Cohesion: 0.12
Nodes (16): Constraint on Lane A: dispatch stays tier-agnostic, How each session starts, Parallel Build Lanes (multi-session), Phase 14/15 additions to the shared-singleton list, Phase 3.8 — Vault document extraction (4 lanes, Wave 0 landed 2026-07-18), Phases 14 + 15 — voice-doc flagship ∥ dispatch framework (set up 2026-07-25), Rules of the road, Sequencing note (+8 more)

### Community 209 - "Phase 01 Plan 06: DLQ + awaitEvent-Timeout Race Smoke Patterns Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 210 - "Phase 2 Plan 07: Authenticated Surface Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+8 more)

### Community 211 - "Phase 03.10 Plan 05: Cockpit Reset + Honesty Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Gate Cycle (Task 2), Human Verify (Task 3), Issues Encountered (+8 more)

### Community 212 - "Phase 03.10 Plan 07: Post-Pick Trust Repair Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Gate Cycle (Task 2), Human Verify (Task 3), Issues Encountered (+8 more)

### Community 213 - "Phase 3.11 Plan 03: Delivery Threading Spine Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Design choice within plan latitude (not a fix), Deviations from Plan, Issues Encountered, Metrics (+8 more)

### Community 214 - "Phase 3.11 Plan 04: replyToMessage Tool Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Issues Encountered, Metrics, Next Phase Readiness (+8 more)

### Community 215 - "Phase 3.1 Plan 08: Cockpit Cards + Chat Pane Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+8 more)

### Community 216 - "Phase 03.2.1 Plan 03: Governed Cockpit Tool Set Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+8 more)

### Community 217 - "Phase 03.2 Plan 04: Cockpit Name-Resolution Turn Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+8 more)

### Community 218 - "Phase 3.5 Plan 01: Deferred Send Foundation Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 219 - "Phase 3.5 Plan 03: Deferred Send — executePlan Scheduler Branch Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+8 more)

### Community 223 - "Phase 3.5 Plan 04: Deferred Send — E2E + Phase Close Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+8 more)

### Community 224 - "Phase 3.6 Plan 05: Phase Gate Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+8 more)

### Community 225 - "Phase 3.7 Plan 09: Phase Close — inbox-digest v2 Eval-Gated & Human-Verified Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Environment Handling, Eval Runs (live spend on local-joel_feruzi-pikar_ai_50c69), Files Created/Modified, Issues Encountered (+8 more)

### Community 226 - "Phase 04 Plan 02: Attachment Extractor Skill Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 227 - "Phase 6 Plan 6: Live Voice Session Client Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 228 - "Phase 8 Plan 02: Feedback Capture + Skill-Version Attribution Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 229 - "Phase 8 Plan 04: Trajectory Export (PII-scrubbed) Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 232 - "Implementation Decisions"
Cohesion: 0.12
Nodes (16): Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Flagged for Research/Planning (not user decisions — resolve in RESEARCH/PLAN), Go-live gating, Implementation Decisions, Integration Points (+8 more)

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

### Community 237 - "Implementation Decisions"
Cohesion: 0.12
Nodes (16): §4 audit split (planner invariant — not optional), Claude's Discretion, Deferred Ideas, Empty / no-match behavior, Established Patterns, Existing Code Insights, Implementation Decisions, Integration Points (+8 more)

### Community 238 - "Phase 11 Plan 04: Editable Business-Profile Page Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Deferred Issues, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+8 more)

### Community 239 - "Implementation Decisions"
Cohesion: 0.12
Nodes (16): Claude's Discretion, Confidence & thin-data honesty, Deferred Ideas, Established Patterns, Existing Code Insights, Framework selection, Gap → action triage (BEVL-02 core), Governance invariants (locked — carried forward, not decisions to revisit) (+8 more)

### Community 240 - "Phase 13 Plan 02: The Weekly Proactive Review Cron Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 241 - "Phase 13 Plan 03: The In-App Review Surface Summary"
Cohesion: 0.12
Nodes (16): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+8 more)

### Community 242 - "Implementation Decisions"
Cohesion: 0.12
Nodes (16): Cadence and tenant selection, Claude's Discretion, Constraints Worth Flagging to the Planner, Deferred Ideas, Established Patterns, Existing Code Insights, Governance (SC#2 and SC#3), Implementation Decisions (+8 more)

### Community 243 - "Migrations Component Reference"
Cohesion: 0.12
Nodes (15): Cancel a Running Migration, Check Migration Status, Configuration Options, Custom Batch Size, Define a Migration, Dry Run, Installation, Migrate a Subset Using an Index (+7 more)

### Community 244 - "Pikar AI — Brand & UI Reference"
Cohesion: 0.20
Nodes (9): 1. What Pikar AI is (identity + voice), 2. Color system, 3. Typography, 4. Layout & structure, 5. Component patterns (from the screenshots), 6. Accessibility (non-negotiable — from `globals.css` notes), 7. Screenshot index (`docs/design/brand/`), 8. For agents building UI (+1 more)

### Community 245 - "OCC Conflict Resolution"
Cohesion: 0.12
Nodes (15): 1. Reduce read set size, 2. Split hot documents, 3. Move non-critical work to scheduled functions, 4. Combine competing writes, Broad read sets causing false conflicts, Common Causes, Core Principle, Fan-out from triggers or cascading writes (+7 more)

### Community 246 - "Convex Performance Audit"
Cohesion: 0.12
Nodes (15): 1. Scope the problem, 2. Trace the full read and write set, 3. Apply fixes from the relevant reference, 4. Fix sibling functions together, 5. Verify before finishing, Checklist, Convex Performance Audit, Escalate Larger Fixes (+7 more)

### Community 247 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, allowJs, allowSyntheticDefaultImports, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module (+7 more)

### Community 248 - "Phase 1 Plan 01: Foundation & Governance Substrate Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 249 - "Phase 1 Plan 4: Skills Registry & Loader Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 250 - "Phase 2 Plan 01: Phase-2 Data Substrate Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 251 - "Phase 2 Plan 02: Executive Agent LLM Surface Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 252 - "Phase 2 Plan 05: Gmail Delivery Integration Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Issues Encountered, Metrics (+7 more)

### Community 253 - "Phase 2 Plan 6: Pipeline Spine + Operator Dead-Letter Surface Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed / adapted, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 254 - "Phase 03.10 Plan 02: Cockpit Panel Demotion Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 255 - "Phase 03.10 Plan 04: Cockpit Propose-Deadlock + Collapsible Brief Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 256 - "Phase 3.11 Plan 01: Inbox-Reply Groundwork Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 257 - "Phase 3.11 Plan 05: Withheld-Tool Activation (cockpit-agent teaches replyToMessage) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Decisions Made, Dependency graph, Deviations from Plan, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 258 - "Phase 3.11 Plan 06: Phase Close — Live In-Thread Reply Human-Verify Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Decisions Made, Dependency graph, Deviations from Plan, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 259 - "Phase 03.1 Plan 02: Cockpit Frontend + E2E Scaffolding Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Environment/Process (not a code fix), Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 260 - "Phase 03.1 Plan 03: emailIntent Slot-Filling Brain Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 261 - "Phase 3.1 Plan 04: Delivery Fan-out Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 262 - "Phase 03.1 Plan 09: Cockpit E2E + Human Verification Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 263 - "Phase 3.1: Cockpit Core — Research (synthesized)"
Cohesion: 0.12
Nodes (15): 1. The one-paragraph answer, 2. Consolidated reuse map (what NOT to build), 3. New work, by lane (each maps to success criteria), 4. ⚠ CROSS-LANE DECISION #1 — the PLAN/REPORT data model (planner MUST resolve), 5. ⚠ CROSS-LANE DECISION #2 — conversation control (planner MUST resolve), 6. Other confirmed constraints (do not violate), 7. Consolidated open questions (non-blocking unless noted), Phase 3.1: Cockpit Core — Research (synthesized) (+7 more)

### Community 264 - "Phase 3.2 Plan 01: needs_resolution seam + pure contact-resolution helpers Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 265 - "Implementation Decisions"
Cohesion: 0.12
Nodes (15): Claude's Discretion, Deferred Ideas, Ephemerality, auth, latency & audit (governance), Established Patterns, Existing Code Insights, How matches surface (resolution card in the workspace pane), Implementation Decisions, Integration Points (+7 more)

### Community 266 - "Phase 3.3 Plan 01: Attachment Generation Engine Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 267 - "Phase 03.3 Plan 04: Attachment Tools + Propose Gate Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 268 - "Phase 03.3 Plan 05: Attachment Send Fan-out + PLAN/REPORT Cards Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 269 - "Phase 03.3 Plan 06: Attachment Generation Phase Close Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 270 - "Implementation Decisions"
Cohesion: 0.12
Nodes (15): Ambiguity & bounds, Cancel semantics, Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Failure at fire time (locked, design doc), Implementation Decisions (+7 more)

### Community 271 - "Phase 03.6 Plan 02: EVAL-02 Read Side Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 272 - "Implementation Decisions"
Cohesion: 0.12
Nodes (15): Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Golden set & assertions (EVAL-01), Housekeeping, Implementation Decisions, Integration Points (+7 more)

### Community 273 - "Phase 03.7 Plan 07: Inbox Briefing Synopsis (the lede) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 274 - "Phase 3.8 Plan 03: Lane 2 — Office Parsers Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 275 - "Phase 3.8 Plan 04: Lane 3 — Sweep + Vault UI + E2E Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 276 - "Phase 3.8 Plan 06: Integration — Merge, Prove Green, Heal Backlog Summary"
Cohesion: 0.12
Nodes (15): Auto-fixed / handled, Backlog sweep (production one-shot), Deferred / carry-over (reconciled), Dependency graph, Deviations from Plan, E2E skip-guards removed, Graph, Merged-whole verification (offline, no live dev) (+7 more)

### Community 277 - "Phase 3 Plan 01: Guardrails Domain Logic Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 278 - "Phase 3 Plan 05: Guardrails Phase-Gate Smoke Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 279 - "Phase 4 Plan 04: Backend Intake Spine Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 280 - "Phase 4 Plan 05: Intake UI (IntakeControls.tsx + Playwright E2E) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Cross-Lane Note (for Lane A), Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 281 - "Phase 4 Plan 06: Phase Close (Task 1 of 3 — PAUSED AT CHECKPOINT) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments (Task 1 only), Cross-Lane Note (unchanged from 04-05, restated for Task 2's benefit), Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 282 - "Phase 5 Plan 02: Vault Schema + RAG Instance + Graph-Extractor Skill Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 283 - "Phase 5 Plan 03: Graph Plane (extractGraph + vaultGraph) Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+7 more)

### Community 284 - "Phase 5 Plan 04: Vault Ingest Pipeline Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Authentication Gates, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered (+7 more)

### Community 285 - "Phase 5 Plan 07: Knowledge Vault Phase-Close Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Deferred / Carry-forward, Dependency graph, Deviations from Plan, Environment workaround (not committed), Files Created/Modified, Issues Encountered (+7 more)

### Community 286 - "Phase 6 Plan 01: Voice Foundations Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 287 - "Phase 6 Plan 02: Voice Data + Registry Skills Foundation Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 288 - "Phase 06 Plan 03: Voice Token Seam Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 289 - "Phase 06 Plan 04: Voice-Brief Drafter Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 290 - "Phase 6 Plan 05: Voice Session Engine Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 291 - "Phase 6 Plan 7: Post-Call Brief Review + Plan Handoff Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 292 - "ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations"
Cohesion: 0.33
Nodes (5): ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations, Alternatives rejected, Consequences, Context, Decision

### Community 293 - "Phase 7 Plan 01: Wave-0 Foundation Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 294 - "Phase 7 Plan 02: Real WORM S3 Export Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 295 - "Phase 7 Plan 03: Fail-Closed Pipeline Review Gate Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 296 - "Document Drafter (v1)"
Cohesion: 0.33
Nodes (5): Attaching, Document Drafter (v1), Drafting principles, Inputs, Output contract

### Community 297 - "Phase 7 Plan 04: Cockpit Resilience — Agent-Timeout Notification + Fail-Closed Revise Cap Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 298 - "Phase 8 Plan 07: SkillOpt Offline Batch Runner Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+7 more)

### Community 299 - "Phase 11 Plan 01: Onboarding + Business Profile Foundation Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 300 - "Phase 11 Plan 03: Conversational Onboarding & First-Run Gate Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 301 - "Phase 12 Plan 05: Gap → Approvable Next-Step Memo Summary"
Cohesion: 0.12
Nodes (15): Auto-fixed Issues, Carried-Forward Deferred Items (still open, NOT fixed here), Deferred Verification — carried into 12-06, Dependency graph, Deviations from Plan, Next, Phase 12 Plan 05: Gap → Approvable Next-Step Memo Summary, Scope boundaries honored (+7 more)

### Community 302 - "Phase 12 Plan 06: Eval Gate — Assessment Fixtures + Cockpit Teaching Summary"
Cohesion: 0.12
Nodes (15): Auto-fixed Issues, Carried-Forward Deferred Items (still open), Dependency graph, Deviations from Plan, Known Gap — logged, NOT fixed, Next, Phase 12 Plan 06: Eval Gate — Assessment Fixtures + Cockpit Teaching Summary, Scope boundaries honored (+7 more)

### Community 303 - "Phase 13 Plan 01: Proactive Review Foundations Summary"
Cohesion: 0.12
Nodes (15): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+7 more)

### Community 304 - "Feature Research"
Cohesion: 0.12
Nodes (15): Add After Validation (v1.x), Anti-Features (Commonly Requested, Often Problematic), Competitive Landscape Snapshot (mid-2026), Competitor Feature Analysis, Dependency Notes, Differentiators (Competitive Advantage), Feature Dependencies, Feature Landscape (+7 more)

### Community 305 - "Recommended Stack — per new capability"
Cohesion: 0.12
Nodes (15): 1. Business-evaluation engine — **NO new dependencies**, 2. Real sub-agent dispatch — **NO new runtime dependency** (promote one devDep), 3. Non-email action tools, 4. Media canvas (images + video ≤3 min) — **add an MCP client; the Pikar-Ai MCP IS the media backend**, 5. Dynamic / self-authored skills — **NO new dependency**, 6. ISO 9001:2015 QMS tooling for software — **NO runtime dependency (mostly docs + native tables)**, 7. Microsoft Graph / Outlook (second email provider, DLVR-02) — **add MSAL; keep API calls on raw `fetch`**, Alternatives Considered (+7 more)

### Community 306 - "Phase 1 Plan 2: Tenant-Scoping Substrate Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 307 - "Phase 1 Plan 03: Insert-Only Audit Module Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 308 - "PostCall.tsx"
Cohesion: 0.27
Nodes (11): BRIEF_HEADERS, BriefSections, buildBriefMarkdown(), composeBrief(), renderList(), renderText(), renderTurns(), empty (+3 more)

### Community 309 - "Phase 01 / Plan 05: Graphify Activation + Ponytail Discipline Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+6 more)

### Community 310 - "Phase 01 Plan 07: WORM Export Cron Stub Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+6 more)

### Community 311 - "Phase 2 Plan 04: Review Gate Decision Union + Write-Once Telemetry Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Auto-fixed Issues, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics (+6 more)

### Community 312 - "Phase 03.10 Plan 01: gmail.search Fixture Seam Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 313 - "Phase 03.1 Plan 01: Cockpit Backend Contracts Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 314 - "Phase 03.1 Plan 06: Plans Adapter + Cockpit Draft Seam Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 315 - "Phase 3.1: Cockpit Core — Research (Pure `emailIntent` Module)"
Cohesion: 0.13
Nodes (14): 1. Existing `packages/core` conventions (the template), 2. Email validation to reuse (do NOT rebuild), 3. Recommended `emailIntent` API shape, 4. How the mode (individual/group) slot fits, 5. Test approach (the ONE runnable check), 6. Open questions / risks, Confidence, Key findings (+6 more)

### Community 316 - "Phase 03.2.1 Plan 01: Cockpit-Agent Skill Registry Seed Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 317 - "Phase 03.2.1 Plan 02: Recipient Tool-Internals Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 318 - "Phase 03.2.1 Plan 05: Clean FSM→Agent Cutover Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 319 - "Phase 03.2.1 Plan 06: Phase Close — Cockpit Playbook Rewrite + Live Human-Verify Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Gap-closure during verification (live-only defects), Issues Encountered, Metrics (+6 more)

### Community 320 - "Phase 03.2 Plan 02: Transient Candidate Fields Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 321 - "Phase 03.2 Plan 03: Gmail Headers-Only Search Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 322 - "Phase 03.3 Plan 02: Attachment Content-Plane Extension Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 323 - "Phase 03.3 Plan 03: Attachment-Carrying Gmail Send Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 324 - "Phase 3.6 Plan 01: Agent Eval Gate — Activation Gate Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 325 - "Phase 3.6 Plan 03: Pin + Cost Threading Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 326 - "Phase 3.6 Plan 04: Golden-Set Eval Harness Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 327 - "Phase 03.7 Plan 06: The Intelligent-Report Reshape Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 328 - "vaultTranscribe.test.ts"
Cohesion: 0.17
Nodes (6): aggregateModules, modules, rateLimiterModules, T, workflowModules, workpoolModules

### Community 329 - "Phase 03.7 Plan 08: Reshaped BRIEFING Card Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 330 - "Phase 3.8 Plan 01: Wave-0 Extraction Contract Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 333 - "Implementation Decisions"
Cohesion: 0.13
Nodes (14): Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Failure & progress UX, Format coverage (v1), Implementation Decisions, Integration Points (+6 more)

### Community 334 - "Phase 3 Plan 02: Guardrail Schema Rails Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 335 - "Phase 3 Plan 03: Guardrails Guard Choke Point Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 336 - "Phase 3 Plan 04: LLM Guardrail Choke Point Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 337 - "Phase 4 Plan 01: Extraction Foundation + Intake Playbook Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 338 - "Phase 5 Plan 01: Vault Foundation Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 339 - "Phase 5 Plan 05: Vault Read Plane (GraphRAG grounding + browse/search) Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 340 - "Phase 5 Plan 06: Knowledge Vault Route Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 341 - "Phase 8 Plan 01: Self-Improvement Schema Substrate Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 342 - "Phase 8 Plan 03: Optimizer Eligibility (Trigger Policy) Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 343 - "Implementation Decisions"
Cohesion: 0.13
Nodes (14): Claude's Discretion, Deferred Ideas, Established Patterns, Existing Code Insights, Feedback capture UX (IMPR-01), Implementation Decisions, Integration Points, Phase 8: Self-Improvement - Context (+6 more)

### Community 344 - "Phase 11 Plan 02: Onboarding Adapter (embed + retrieve + redaction) Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 345 - "Phase 12 Plan 01: Growth Diagnostic Math Port Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 346 - "Phase 12 Plan 02: Framework Rubric Skill Registration Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 347 - "Phase 12 Plan 03: Business Evaluation Engine Summary"
Cohesion: 0.13
Nodes (14): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+6 more)

### Community 348 - "Phase 12 Plan 04: Cockpit Evaluation Surface Summary"
Cohesion: 0.13
Nodes (14): Auto-fixed Issues, Carried-Forward Deferred Items (still open, NOT fixed here), Deferred Verification — Task 3 (NOT passed, NOT skipped), Dependency graph, Deviations from Plan, Next, Phase 12 Plan 04: Cockpit Evaluation Surface Summary, Process Deviation (+6 more)

### Community 349 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+6 more)

### Community 350 - "cockpit.ts"
Cohesion: 0.14
Nodes (11): cancelScheduledPlan, cockpitAgent, executePlan, FanoutArgs, listThreadMessages, listThreads, proposeEmailPlan, reschedulePlan (+3 more)

### Community 351 - "scripts"
Cohesion: 0.14
Nodes (14): scripts, codegen, dev, eval:golden, seed, smoke:dlq, smoke:fanout, smoke:guardrails (+6 more)

### Community 352 - "package.json"
Cohesion: 0.14
Nodes (13): dependencies, @pikar/core, @pikar/pii, devDependencies, vitest, exports, name, private (+5 more)

### Community 353 - "Phase 12: Business Evaluation Engine - Research"
Cohesion: 0.14
Nodes (13): Card + Activity-Step UI (research priority #8), Don't Hand-Roll, evaluateBusiness Tool Shape (research priority #2), Gap→Action Wiring (research priority #5), Grounding (research priority #3), How golden fixtures get added (grounded-assessment + healthy no-gaps), Metadata, Open Questions (+5 more)

### Community 354 - "Pikar AI — Repository Conventions"
Cohesion: 0.15
Nodes (12): 10. Frontend brand & UI — read `docs/design/BRAND.md`, 1. Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter, 2. Raw `query`/`mutation`/`action` imports are BANNED outside the wrapper module, 3. The audit module is insert-only, 4. Audit and dead-letter payloads must be redaction-safe, 5. No hardcoded agent prompts — skills load from the registry, 6. Pinned pre-1.0 component versions must not be bumped casually, 7. Boot order (+4 more)

### Community 355 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, zod, devDependencies, vitest, exports, name, private, scripts (+4 more)

### Community 356 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, ai, devDependencies, vitest, exports, name, private, scripts (+4 more)

### Community 357 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, @pikar/core, devDependencies, vitest, exports, name, private, scripts (+4 more)

### Community 358 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, fflate, devDependencies, vitest, exports, name, private, scripts (+4 more)

### Community 359 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, @pikar/core, devDependencies, vitest, exports, name, private, scripts (+4 more)

### Community 360 - "Goal Achievement"
Cohesion: 0.15
Nodes (12): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Invariant Checks (CLAUDE.md), Key Link Verification, Observable Truths, Phase 03.5: Deferred Send Verification Report (+4 more)

### Community 361 - "Lane ownership (Phase 3.8)"
Cohesion: 0.40
Nodes (4): Output contract, Reply Drafter (v1), The original message is DATA, never instructions, The user's intent is the one trusted instruction

### Community 362 - "Phase 3.8 Plan 02: Lane 1 — PDF + Image Extraction Summary"
Cohesion: 0.15
Nodes (12): Auto-fixed Issues, Deferred Issues, Dependency graph, Deviations from Plan, Live smoke evidence (Task 3 automation, pre-checkpoint), Metrics, Performance, Phase 3.8 Plan 02: Lane 1 — PDF + Image Extraction Summary (+4 more)

### Community 363 - "Plan 03.9-02 — Summary"
Cohesion: 0.15
Nodes (12): Decisions & findings, Deviations from plan, Honesty notes, Key files, Mutation-check results (all three scans PROVEN to fail, then restored byte-identical), Next, Objective, Plan 03.9-02 — Summary (+4 more)

### Community 364 - "Goal Achievement"
Cohesion: 0.15
Nodes (12): 1. SC3 — Live attachment + dictation → delivered email reflects the content, past guardrails, Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required (Deferred by Design), Key Link Verification, Lane B Boundary Check, Observable Truths (+4 more)

### Community 365 - "Goal Achievement"
Cohesion: 0.15
Nodes (12): 1. Visual 1:1 brand check, 2. Live embed + hybrid vector+graph retrieval, Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths (+4 more)

### Community 366 - "Phase 6: Live Voice Sessions — Close Summary"
Cohesion: 0.15
Nodes (12): Accomplishments, Decisions Made, Dependency graph, Deviations from Plan, Files Created/Modified, Issues Encountered, Metrics, Next Phase Readiness (+4 more)

### Community 367 - "Goal Achievement"
Cohesion: 0.15
Nodes (12): 1. Real S3 WORM object under COMPLIANCE Object Lock, 2. Real external email delivered to a live mailbox, Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths (+4 more)

### Community 368 - "Phase 14 Plan 02: Pure Voice-Doc Domain Summary"
Cohesion: 0.15
Nodes (12): Accomplishments, Decisions Made, Deviations from Plan, Files Created/Modified, Issues Encountered, Next Phase Readiness, Performance, Phase 14 Plan 02: Pure Voice-Doc Domain Summary (+4 more)

### Community 369 - "Common Pitfalls"
Cohesion: 0.15
Nodes (13): Common Pitfalls, Pitfall 10 — Prompt injection is materially stronger in system instructions than in a tool return, Pitfall 11 — Skill seeding version collisions (cross-lane), Pitfall 12 — The known pre-existing red, Pitfall 1 — Widening `evaluations.framework` breaks the web typecheck, Pitfall 2 — `runEvaluation` silently accepts a framework it cannot handle, Pitfall 3 — The gated-skill deadlock, Pitfall 4 — The instruction budget is not free, and it is billed every turn (+5 more)

### Community 370 - "Migration Patterns Reference"
Cohesion: 0.17
Nodes (11): Adding a Required Field, Changing a Field Type, Cleaning Up Orphaned Documents, Deleting a Field, Dual Read, Dual Write (Preferred), Migration Patterns Reference, Small Table Shortcut (+3 more)

### Community 371 - "cockpit.test.ts"
Cohesion: 0.18
Nodes (4): aggregateModules, modules, workflowModules, workpoolModules

### Community 372 - "Convex Auth"
Cohesion: 0.17
Nodes (11): Checklist, Concrete Steps, Convex Auth, Expected Files and Decisions, Gotchas, Human Handoff, Production, Validation (+3 more)

### Community 373 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, jsx, module, moduleResolution, noEmit, skipLibCheck, types (+3 more)

### Community 374 - "Design — Agent-Driven Cockpit (capability #1)"
Cohesion: 0.17
Nodes (11): 10. Open questions, 1. Problem, 2. Goal, 3. Fixed frame — invariants that hold no matter what, 4. Architecture, 5. PII / redaction in the reasoning loop, 6. Guardrails, error handling, testing, 7. Rollout — clean cutover (+3 more)

### Community 375 - "Phase 03.2.1 Plan 04: runCockpitAgent Governed Tool-Loop Summary"
Cohesion: 0.17
Nodes (11): Auto-fixed Issues, Dependency graph, Deviations from Plan, Metrics, Notes for Plan 05, Out-of-scope (not fixed), Phase 03.2.1 Plan 04: runCockpitAgent Governed Tool-Loop Summary, Self-Check: PASSED (+3 more)

### Community 376 - "Implementation Decisions (LOCKED)"
Cohesion: 0.17
Nodes (11): Claude's Discretion, Cutover, Deferred Ideas, Engine, Implementation Decisions (LOCKED), Phase 03.2.1: Agent-Driven Cockpit — Context, Phase Boundary, Redaction (§2-D) (+3 more)

### Community 377 - "Phase 03.2 Plan 05: Resolution Card UI Summary"
Cohesion: 0.17
Nodes (11): Auto-fixed Issues, Dependency graph, Deviations from Plan, Metrics, Phase 03.2 Plan 05: Resolution Card UI Summary, Plan-reading clarifications (not deviations, but worth recording), Playbook, Self-Check: PASSED (+3 more)

### Community 378 - "Plan 03.9-03 — Summary"
Cohesion: 0.17
Nodes (11): Decisions & findings, Deviations from plan, Honesty notes, Key files, Next, Objective, Plan 03.9-03 — Summary, Self-Check: PASSED (+3 more)

### Community 379 - "Goal Achievement"
Cohesion: 0.17
Nodes (11): 1. Live grounded-turn UI render (Plan 03 Manual-Only UAT), 2. Live skill-gate activation (SC5) — ✓ CLOSED 2026-07-24, Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths (Success Criteria, ROADMAP Phase 10) (+3 more)

### Community 380 - "Phase 14 Plan 01: Wave-0 Freeze Commit Summary"
Cohesion: 0.17
Nodes (11): 1. [Rule 4 — architectural, USER-APPROVED] The "zero edits to `evaluations.ts`" premise was false, 2. [Rule 3 — blocking] `proactiveReview.ts` carried the widened framework forward, 3. [Rule 3 — blocking] Playbook ordering vs. the §9 Stop hook, 4. [Rule 3 — environment] No `node_modules` and no `CONVEX_DEPLOYMENT` in this worktree, Deviations from Plan, For the next plans, Phase 14 Plan 01: Wave-0 Freeze Commit Summary, Self-Check: PASSED (+3 more)

### Community 381 - "Pikar-AI"
Cohesion: 0.17
Nodes (11): Active, Constraints, Context, Core Value, Current Milestone: v2.0 — Platform → Private Beta, Key Decisions, Out of Scope, Pikar-AI (+3 more)

### Community 382 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, incremental, jsx, module, moduleResolution, noEmit, plugins, exclude (+2 more)

### Community 383 - "Auth0"
Cohesion: 0.18
Nodes (10): Auth0, Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 384 - "Clerk"
Cohesion: 0.18
Nodes (10): Checklist, Clerk, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation (+2 more)

### Community 385 - "package.json"
Cohesion: 0.20
Nodes (6): aggregateModules, modules, PROFILE, SENTINELS, workflowModules, workpoolModules

### Community 386 - "logger.ts"
Cohesion: 0.24
Nodes (5): msg(), createLogger(), LogFields, Logger, LogLevel

### Community 387 - "WorkOS AuthKit"
Cohesion: 0.18
Nodes (10): Checklist, Concrete Steps, Files and Env Vars To Expect, Gotchas, Key Setup Areas, Production, Validation, What To Do (+2 more)

### Community 388 - "Convex Authentication Setup"
Cohesion: 0.18
Nodes (10): After Choosing a Provider, Checklist, Convex Authentication Setup, Core Pattern: Protecting Backend Functions, First Step: Choose the Auth Provider, Provider References, Reference Files, When Not to Use (+2 more)

### Community 389 - "package.json"
Cohesion: 0.18
Nodes (10): devDependencies, vitest, exports, name, private, scripts, test, typecheck (+2 more)

### Community 390 - "Inbox Briefing (Phase 3.7)"
Cohesion: 0.18
Nodes (10): 1. Problem / value, 2. Current surface (verified 2026-07-14), 3. Design, 4. Threat model, 5. The toolless-ingestion invariant (name it, enforce it), 6. Phase spec (GSD form — registered in ROADMAP.md), 7. Out of scope, 8. Open questions (resolve during /gsd:plan-phase) (+2 more)

### Community 391 - "Architecture Patterns"
Cohesion: 0.18
Nodes (11): Anti-Patterns to Avoid, Architecture Patterns, New schema tables (first schema change → register migrations FIRST), Pattern 1: The pipeline workflow (reuse the smoke.ts shape), Pattern 2: Submit-time validation gate (INTK-04), Pattern 3: Route dispatch = throw-into-DLQ, never default (AGNT-03), Pattern 4: Review gate reuse (REVW-01) — three required edits to `review.ts`, Pattern 5: Gmail OAuth + token lifecycle (DLVR-03) (+3 more)

### Community 392 - "Goal Achievement"
Cohesion: 0.18
Nodes (10): Anti-Patterns Found, Automated Test Results, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 03.4: Per-Recipient Personalization Verification Report (+2 more)

### Community 393 - "Phase 3.8 Plan 05: Lane 4 — Video Transcription Summary"
Cohesion: 0.18
Nodes (10): Auto-fixed Issues, Checkpoint status, Deferred Issues (out of scope, logged in deferred-items.md), Deviations from Plan, Live smoke (Task 2 automation — done; human confirmation PENDING), Phase 3.8 Plan 05: Lane 4 — Video Transcription Summary, Self-Check: PASSED, Task Commits (TDD) (+2 more)

### Community 394 - "Plan 03.9-04 — Summary"
Cohesion: 0.18
Nodes (10): Four checkpoint-feedback fixes (all committed atomically), Honest accounting, Key files, Next, Objective, Plan 03.9-04 — Summary, Standing environmental note (not a code defect), Tasks (+2 more)

### Community 395 - "Goal Achievement"
Cohesion: 0.18
Nodes (10): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Known, Documented Gap (not a failure), Observable Truths (by plan), Phase 03.9: Agent Activity Streaming Verification Report (+2 more)

### Community 396 - "Goal Achievement"
Cohesion: 0.18
Nodes (10): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Live Verification Run (this session, against the running `convex dev` deployment), Observable Truths, Phase 3: Guardrails Verification Report (+2 more)

### Community 397 - "Implementation Decisions (LOCKED by owner 2026-07-21)"
Cohesion: 0.18
Nodes (10): Audit retention (OPSG-03 / SC#4) — EXPORT ONLY, NEVER SWEEP, Claude's Discretion, Deferred Ideas, Implementation Decisions (LOCKED by owner 2026-07-21), Notifications (OPSG-05) — IN-APP + EXTERNAL (email/push), Phase 7: Resilience & Operations Hardening - Context, Phase Boundary, Specific Ideas (+2 more)

### Community 398 - "Goal Achievement"
Cohesion: 0.18
Nodes (10): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 11: Persona Onboarding & Business Profile Verification Report, Required Artifacts (+2 more)

### Community 399 - "Goal Achievement"
Cohesion: 0.18
Nodes (10): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Known Open Items (confirmed honestly recorded, not new discoveries), Observable Truths (Success Criteria from ROADMAP.md), Phase 12: Business Evaluation Engine Verification Report (+2 more)

### Community 400 - "Common Pitfalls"
Cohesion: 0.18
Nodes (11): Common Pitfalls, Pitfall 10: convex-test needs the aggregate component registered, Pitfall 1: `vaultDocuments` has no `kind` index — the tenant enumerator can blow the read limit, Pitfall 2: the repo's own Convex guidelines forbid `crons.weekly`, Pitfall 3: `dayOfWeek` must be lowercase — the JSDoc example is wrong, Pitfall 4: `runEvaluation` does not return the row — CONTEXT's delta plan needs a correction, Pitfall 5: `diagnose()` returns exactly ONE prescription — `gaps.length` is 0 or 1, Pitfall 6: the pinned review tab feeds a fake `threadId` into the composer, which throws (+3 more)

### Community 401 - "Phase 14: Flagship Voice-Doc Workflow — Research"
Cohesion: 0.18
Nodes (10): Core (already present), Don't Hand-Roll, Metadata, Open Questions, OpenAI Realtime API surface (external contract), Phase 14: Flagship Voice-Doc Workflow — Research, Phase Requirements, Standard Stack (+2 more)

### Community 402 - "Email Chat Cockpit"
Cohesion: 0.20
Nodes (9): Backend flow & reuse map, Email Chat Cockpit, Error & edge handling (nothing sends on an assumption), Guided conversation (slot-filling), Layout & visual system, Multiple recipients, Scope of slice 1, Slices (each becomes a GSD phase) (+1 more)

### Community 403 - "Moat Strategy & Validated-Problem Discipline"
Cohesion: 0.20
Nodes (9): 1. Per-tenant learning moat (strongest candidate), 2. Compliance / trust moat, 3. Network effects — none in v1, one named shelf, Companion records, How this record is used, Moat candidates already latent in the architecture, Moat Strategy & Validated-Problem Discipline, Timing — what matters when (+1 more)

### Community 404 - "Phase 2 Plan 03: Intake Trust Boundary Summary"
Cohesion: 0.20
Nodes (9): Dependency graph, Deviations from Plan, Metrics, Out-of-scope (logged, not fixed), Phase 2 Plan 03: Intake Trust Boundary Summary, Self-Check: PASSED, Tech tracking, Verification (+1 more)

### Community 405 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 03.10: Cockpit Conversation Repair Verification Report, Required Artifacts (+1 more)

### Community 406 - "Playbook: Knowledge Vault & GraphRAG"
Cohesion: 0.20
Nodes (10): Data flow, Dependencies & blast radius, How to change safely, How to verify, Invariants — what must never break, Key files, Known gaps & deferred work, Operational notes (+2 more)

### Community 407 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 3.11: Inbox Reply Verification Report, Required Artifacts (+1 more)

### Community 408 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths (SC1–SC5 + Groundwork, from 03.1-VALIDATION.md), Phase 3.1: Cockpit Core Verification Report, Required Artifacts (+1 more)

### Community 409 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 03.2.1: Agent-Driven Cockpit Verification Report, Required Artifacts (+1 more)

### Community 410 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 3.2: Inbox Reading Verification Report, Required Artifacts (+1 more)

### Community 411 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 03.3: Attachment Generation Verification Report, Required Artifacts (+1 more)

### Community 412 - "Architecture Patterns"
Cohesion: 0.20
Nodes (10): Anti-Patterns to Avoid, Architecture Patterns, Pattern 1: Driving one eval case (verified against run-smoke-guardrails.mjs §7), Pattern 2: State assertions (fixture `expect` block), Pattern 3: Candidate version-pinning (required for `--skill <name>@<version>`), Pattern 4: Per-run cost cap, Pattern 5: The gate on `activateSkill` (skills.ts:63), Pattern 6: EVAL-02 read-side — what the rows ACTUALLY contain (verified) (+2 more)

### Community 413 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths (Roadmap Success Criteria used as must-haves), Phase 3.6: Agent Eval Gate Verification Report, Required Artifacts (+1 more)

### Community 414 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 3.7: Inbox Briefing Verification Report, Required Artifacts (+1 more)

### Community 415 - "Phase 3.8: Vault Document Extraction - Research"
Cohesion: 0.20
Nodes (9): Don't Hand-Roll, Governance Call Shapes (verified verbatim, question 7), Metadata, Open Questions, Phase 3.8: Vault Document Extraction - Research, Skill Decision (discretion resolved): reuse `attachment-extractor`, seed nothing, State of the Art, Summary (+1 more)

### Community 416 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 3.8: Vault Document Extraction Verification Report, Required Artifacts (+1 more)

### Community 417 - "Plan 03.9-01 — Summary"
Cohesion: 0.20
Nodes (9): Decisions & findings, Deviations, Fixed in flight, Key files, Next, Objective, Plan 03.9-01 — Summary, Tasks (+1 more)

### Community 418 - "Phase 03.9: Agent Activity Streaming — Research"
Cohesion: 0.20
Nodes (9): BRAND (§10 — binding, and it already specifies this feature), Don't Hand-Roll, Metadata, Open Questions, Phase 03.9: Agent Activity Streaming — Research, Phase Requirements, Skill gate (EVAL_GATE) — **no gate cycle needed**, State of the Art (+1 more)

### Community 419 - "Common Pitfalls"
Cohesion: 0.20
Nodes (10): Common Pitfalls, Pitfall 1 — The first turn has no `threadId` until the wait is over (**the worst one**), Pitfall 2 — Terminal state on a hard action kill, Pitfall 3 — The fallback retry re-runs the tools → duplicate rows, Pitfall 4 — The SMOKE path emits nothing (your offline E2E can't see the feature), Pitfall 5 — Widening the §4 surface through the event object, Pitfall 6 — The emitter fails silently, Pitfall 7 — An unbounded `byThread` read eventually hard-fails (+2 more)

### Community 420 - "Architecture Patterns"
Cohesion: 0.20
Nodes (10): Anti-Patterns to Avoid, Architecture Patterns, Pattern 1: The RAG instance (one construction site), Pattern 2: Ingest = a workflow mirroring `deliverApprovedPlan`, Pattern 3: Embed step (action) with content-hash dedup, Pattern 4: `vaultGround` — hybrid vector + hop-capped graph (action), Pattern 5: Graph upsert with cross-doc dedup + degree bookkeeping (VALT-02), Pattern 6: Signed-URL download (mirror `plans.ts attachmentUrls`) (+2 more)

### Community 421 - "Common Pitfalls"
Cohesion: 0.20
Nodes (10): Common Pitfalls, Pitfall 1: Action-vs-mutation for RAG calls, Pitfall 2: Embedding dimension cap / mismatch, Pitfall 3: The `"use node"` circular-inference cliff (extractor home), Pitfall 4: convex-test cannot embed (offline) — SMOKE seam required, Pitfall 5: Workpool test devDep already pinned, Pitfall 6: Biome raw-import ban (§2), Pitfall 7: Playbook watch.json registration (§9) (+2 more)

### Community 422 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths (ROADMAP Success Criteria = the contract), Phase 6: Live Voice Sessions — Verification Report, Required Artifacts (+1 more)

### Community 423 - "Phase 8 Plan 08: Phase Close (playbook DoD + proof-of-life dry-run) Summary"
Cohesion: 0.20
Nodes (9): Deviations from Plan, Dry-run DB artifacts left behind (harmless — append-only design), Honest residual (documented, NOT a pass), Phase 8 Plan 08: Phase Close (playbook DoD + proof-of-life dry-run) Summary, Self-Check: PASSED, Status, Task 2 — cockpit-agent dry-run (proof-of-life): PASSED, Verification (Task 1) (+1 more)

### Community 424 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 8: Self-Improvement Verification Report, Required Artifacts (+1 more)

### Community 425 - "Phase 10 Plan 04: Teach the Agent WHEN to Ground Summary"
Cohesion: 0.20
Nodes (9): Auto-fixed / Notes, Deferred Issues (out of scope), Deviations from Plan, Phase 10 Plan 04: Teach the Agent WHEN to Ground Summary, Phase Gate (deferred — live, needs OPENAI_API_KEY), Self-Check: PASSED, Tasks, Verification (+1 more)

### Community 426 - "Goal Achievement"
Cohesion: 0.20
Nodes (9): Anti-Patterns Found, Gaps Summary, Goal Achievement, Human Verification Required, Key Link Verification, Observable Truths, Phase 13: Proactive In-App Review Verification Report, Required Artifacts (+1 more)

### Community 427 - "Phase 14 — Validation Strategy"
Cohesion: 0.20
Nodes (9): Manual-Only Verifications, Per-Task Verification Map, Phase 14 — Validation Strategy, Sampling Rate, STATED EXCEPTION — `pnpm --filter @pikar/web build` as a per-task verify, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements (+1 more)

### Community 428 - "Agent Eval Gate (Phase 3.6)"
Cohesion: 0.22
Nodes (8): 1. Problem, 2. Design, 3. Phase spec (GSD form — paste-ready for ROADMAP.md), 4. Out of scope, 5. Phase 8 impact (re-scope note), 6. Open questions (resolve during /gsd:plan-phase), Agent Eval Gate (Phase 3.6), Phase 3.6: Agent Eval Gate (INSERTED)

### Community 429 - "Phase 3.10: Cockpit Conversation Repair - Context"
Cohesion: 0.22
Nodes (8): Agent stalled-resolution recovery (Defect B), Deferred Ideas, Governance invariants (unchanged, restated because both defects touch their surfaces), Implementation Decisions, Panel arbitration (Defect A), Phase 3.10: Cockpit Conversation Repair - Context, Phase Boundary, Specific Ideas

### Community 430 - "Phase 3.1 — Validation Strategy"
Cohesion: 0.22
Nodes (8): Manual-Only Verifications, Per-Task Verification Map, Phase 3.1 — Validation Strategy, Sampling Rate, SC → Plan / Task map (populated at plan time), Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 431 - "Phase 3.2 Plan 06: Close Inbox-Reading Phase (Playbook + CKPT-01) Summary"
Cohesion: 0.22
Nodes (8): Authentication / human gates, Deviations from Plan, Phase 3.2 Plan 06: Close Inbox-Reading Phase (Playbook + CKPT-01) Summary, Self-Check: PASSED, Task 1 — playbook + watch (commit `4348527`), Task 2 — CKPT-01 human-verify (APPROVED), Verification, What was done

### Community 432 - "Phase 03.4 Plan 01: recipientBodies Content-Plane Foundation Summary"
Cohesion: 0.22
Nodes (8): Build-time confirmation (lane flag resolved), Commits, Deviations from Plan, Phase 03.4 Plan 01: recipientBodies Content-Plane Foundation Summary, Scope boundary held, Self-Check: PASSED, Verification, What was built

### Community 433 - "Phase 03.4 Plan 02: personalizeRecipient Tool + Group Gate Summary"
Cohesion: 0.22
Nodes (8): Ceilings / carry-forward, Commits, Deviations from Plan, Phase 03.4 Plan 02: personalizeRecipient Tool + Group Gate Summary, Scope boundary held, Self-Check: PASSED, Verification, What was built

### Community 434 - "Phase 03.4 Plan 03: executePlan Seed Override + PLAN Card Per-Recipient Bodies Summary"
Cohesion: 0.22
Nodes (8): Ceilings / carry-forward, Commits, Deviations from Plan, Phase 03.4 Plan 03: executePlan Seed Override + PLAN Card Per-Recipient Bodies Summary, Scope boundary held, Self-Check: PASSED, Verification, What was built

### Community 435 - "Phase 03.4 Plan 04: Phase Close — E2E + smoke distinct-body + playbook (CKPT-03) Summary"
Cohesion: 0.22
Nodes (8): CKPT-03 human-verify — PENDING (the sole live-only proof), Commits, Deviations from Plan, Phase 03.4 Plan 04: Phase Close — E2E + smoke distinct-body + playbook (CKPT-03) Summary, Scope boundary held, Self-Check: PASSED, Verification, What was built

### Community 436 - "Phase 3.5 — Validation Strategy"
Cohesion: 0.22
Nodes (8): Convex scheduled-function testing (offline, the pivotal capability), Manual-Only Verifications, Per-Task Verification Map, Phase 3.5 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 437 - "Locked Decisions"
Cohesion: 0.22
Nodes (9): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Golden set & assertions (EVAL-01), Housekeeping, Locked Decisions, Production read-side (EVAL-02), Runner, The gate (+1 more)

### Community 438 - "Common Pitfalls"
Cohesion: 0.22
Nodes (9): Common Pitfalls, Pitfall 1: `seedSkills` publish-on-change bypasses the gate (CRITICAL), Pitfall 2: Eval certifies the wrong version, Pitfall 3: Live-model nondeterminism read as regression, Pitfall 4: Governed stops misread as failures, Pitfall 5: Classifier archival is undone by the next dev boot, Pitfall 6: EVAL-02 card overpromises what telemetry contains, Pitfall 7: §9 Stop hook blocks the phase-close turn (+1 more)

### Community 439 - "Phase 3.7 Plan 04: The BRIEFING Card + Offline E2E Summary"
Cohesion: 0.22
Nodes (8): Deviations from Plan, Key Decisions, Notes for Next Plans, Phase 3.7 Plan 04: The BRIEFING Card + Offline E2E Summary, Self-Check: PASSED, The E2E is BLOCKED, and for TWO reasons — the second is new, Verification, What Was Built

### Community 440 - "Phase 03.7 — UAT"
Cohesion: 0.22
Nodes (8): Fixed during the checkpoint session (already landed), Gap 1 — The briefing is a receipt, not a report, Gap 2 — Deferred to Phase 3.9 (not gap-closure on 3.7), Gaps, Phase 03.7 — UAT, Resolution path, Still blocked, What passed

### Community 441 - "Common Pitfalls"
Cohesion: 0.22
Nodes (9): Common Pitfalls, Pitfall 1: unpdf's pdf.js 5.x needs `Promise.withResolvers` — Convex node actions default to Node 20, Pitfall 2: The closed status union, Pitfall 3: The seam's identity wall (blocks Lanes 1, 3, and 4 at integration), Pitfall 4: pnpm-lock.yaml is a shared singleton nobody listed, Pitfall 5: `watch.json` entries are prefixes — new files aren't covered by existing ones, Pitfall 6: Convex 1 MiB document size limit vs extracted text, Pitfall 7: OOXML gotchas that break naive walks (+1 more)

### Community 442 - "Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary"
Cohesion: 0.22
Nodes (8): Auto-fixed Issues, Concurrency note (not a Rule 1-4 deviation — a shared-worktree race, documented per plan's PARALLEL WAVE warning), Cross-Lane Announcement, Deviations from Plan, Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary, Requirements Tracking Note, Self-Check: PASSED, What Was Built

### Community 443 - "Phase 7 Plan 05: User-Facing Notification Matrix Summary"
Cohesion: 0.22
Nodes (8): Auto-fixed Issues, Commits, Deviations from Plan, NOT run (live-only, phase gate), Phase 7 Plan 05: User-Facing Notification Matrix Summary, Self-Check: PASSED, Verification, What shipped

### Community 444 - "Phase 8 — Validation Strategy"
Cohesion: 0.22
Nodes (8): Held-out Set Partitioning, Manual-Only Verifications, Per-Requirement Verification Map, Phase 8 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 445 - "Phase 11 — Validation Strategy"
Cohesion: 0.22
Nodes (8): Manual-Only Verifications, Per-Task Verification Map, Phase 11 — Validation Strategy, Sampling Rate, Test Infrastructure, The four SCs, mapped to concrete assertions, Validation Sign-Off, Wave 0 Requirements

### Community 446 - "Architecture Patterns"
Cohesion: 0.22
Nodes (9): Anti-patterns to avoid, Architecture Patterns, Pattern 1 — Declare the retrieval tool at mint, in the session config `voiceToken.ts` already builds, Pattern 2 — Relay the call through the EXISTING `response.done` case (do not pin a new event name), Pattern 3 — Doc-scoped retrieval: reuse `vaultGround`'s engine, filtered to one doc, Pattern 4 — Findings producer: `vaultLlm.ts` shape, citations welded in code, Pattern 5 — Reach the Approve gate without a route jump: render the exported `CardList`, Pattern 6 — The §4 split for the retrieval tool (+1 more)

### Community 447 - "package.json"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 448 - "Packaged Convex Components"
Cohesion: 0.25
Nodes (7): Build Flow, Checklist, Default Approach, Package Exports, Packaged Convex Components, Testing, When to Choose This

### Community 449 - "intakeDb.ts"
Cohesion: 0.25
Nodes (7): byThread, generateUploadUrl, getArtifact, insertArtifact, KIND, patchArtifact, STATUS

### Community 450 - "optimizerBreach.ts"
Cohesion: 0.29
Nodes (6): BreachConfig, BreachInput, BreachReason, BreachResult, classifyBreach(), cfg

### Community 451 - "01-08 Summary — Public web surface (PARTIAL)"
Cohesion: 0.25
Nodes (7): 01-08 Summary — Public web surface (PARTIAL), Commits, Deferred (NOT done), GDPR obligations a document cannot satisfy, The guard, Unverified claims in the legal documents, What shipped

### Community 452 - "Phase 1 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 1 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 453 - "Phase 2: Thin End-to-End Slice - Research"
Cohesion: 0.25
Nodes (7): Don't Hand-Roll, Metadata, Open Questions, Phase 2: Thin End-to-End Slice - Research, Phase Requirements, State of the Art, Summary

### Community 454 - "Code Examples"
Cohesion: 0.25
Nodes (8): Aggregate over audit (verified pattern), Attachment upload (Convex file storage, standard pattern), Code Examples, Convex Auth Google sign-in (verified), convex.config.ts — register the two new components (verified), Gmail send via raw REST, wrapped by retrier (verified endpoints), Migration client + first migration (verified), Structured routing via AI Gateway (verified pattern)

### Community 455 - "Phase 2 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 2 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 456 - "Phase 03.10 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 03.10 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 457 - "Phase 3.11 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 3.11 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 458 - "Phase 03.1 Plan 05: Cockpit Structural Shell Summary"
Cohesion: 0.25
Nodes (7): Auto-fixed Issues, Deferred Issues, Deviations from Plan, Phase 03.1 Plan 05: Cockpit Structural Shell Summary, Self-Check: PASSED, Verification, What shipped

### Community 459 - "03.1-07-SUMMARY.md"
Cohesion: 0.25
Nodes (7): 03.1-07: Cockpit orchestration seam (SC2/SC3/SC4), Dependency graph, Deviations, Notes for the orchestrator, Tasks, Tech tracking, Verification

### Community 460 - "Phase 03.2.1: Agent-Driven Cockpit — Research"
Cohesion: 0.25
Nodes (7): Files changed (from design §8), Locked decisions (from the design record — do not relitigate), Phase 03.2.1: Agent-Driven Cockpit — Research, Pitfalls / risks, Suggested plan decomposition (guidance — planner owns the final shape), Tool set (each wraps an existing governed primitive), Validation Architecture

### Community 461 - "Phase 03.2.1 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 03.2.1 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 462 - "Phase 3.2 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 3.2 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 463 - "Phase 3.3 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 3.3 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 464 - "Phase 3.4 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 3.4 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 465 - "Phase 3.6: Agent Eval Gate - Research"
Cohesion: 0.25
Nodes (7): Don't Hand-Roll, Metadata, Open Questions, Phase 3.6: Agent Eval Gate - Research, Phase Requirements, State of the Art (repo-internal), Summary

### Community 466 - "Phase 3.6 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 3.6 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 467 - "Phase 3.7 Plan 01: Pure Briefing Module Summary"
Cohesion: 0.25
Nodes (7): Deviations from Plan, Key Decisions, Notes for Next Plans, Phase 3.7 Plan 01: Pure Briefing Module Summary, Self-Check: PASSED, Verification, What Was Built

### Community 468 - "Phase 3.7 Plan 02: Gmail Read Plane + Briefing Content Plane Summary"
Cohesion: 0.25
Nodes (7): Deviations from Plan, Key Decisions, Notes for Next Plans, Phase 3.7 Plan 02: Gmail Read Plane + Briefing Content Plane Summary, Self-Check: PASSED, Verification, What Was Built

### Community 469 - "Phase 3.7 Plan 03: The Briefing Brain Summary"
Cohesion: 0.25
Nodes (7): Deviations from Plan, Key Decisions, Notes for Next Plans, Phase 3.7 Plan 03: The Briefing Brain Summary, Self-Check: PASSED, Verification, What Was Built

### Community 470 - "Phase 03.7 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 03.7 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 471 - "Phase 03.8 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 03.8 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 472 - "Architecture Patterns"
Cohesion: 0.25
Nodes (8): Anti-patterns to avoid, Architecture Patterns, Pattern 1: emit from the SDK's callbacks, not from the tools (the whole backend, ~20 lines), Pattern 2: the `briefings.ts` adapter, verbatim, Pattern 3: the driver owns turn lifecycle; the SDK owns step lifecycle, Pattern 4: a THIRD independent `useQuery` in `CardList` (the trap 03.7-04 already sprang), Pattern 5: derive the chat bubble from the same query — but keep `busy` for the first turn, Recommended shape

### Community 473 - "Phase 03.9 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 03.9 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 474 - "Phase 3 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 3 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 475 - "Phase 4 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 4 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 476 - "Phase 5: Knowledge Vault & GraphRAG - Research"
Cohesion: 0.25
Nodes (7): Don't Hand-Roll, Metadata, Open Questions, Phase 5: Knowledge Vault & GraphRAG - Research, Phase Requirements, State of the Art, Summary

### Community 477 - "Phase 5 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 5 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 478 - "Phase 6 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 6 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 479 - "Phase 7 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Nyquist Notes, Per-Requirement Verification Map, Phase 7 — Validation Strategy, Sampling Rate, Test Infrastructure, Wave 0 Requirements

### Community 480 - "Phase 10 Plan 01: Vault Grounding Hydration Summary"
Cohesion: 0.25
Nodes (7): Deferred / Out of Scope, Deviations from Plan, Phase 10 Plan 01: Vault Grounding Hydration Summary, Self-Check: PASSED, Tasks, Verification, What Was Built

### Community 481 - "Phase 10 Plan 02: searchVault Cockpit Grounding Tool Summary"
Cohesion: 0.25
Nodes (7): Deferred / Out of Scope, Deviations from Plan, Phase 10 Plan 02: searchVault Cockpit Grounding Tool Summary, Self-Check: PASSED, Tasks, Verification, What Was Built

### Community 482 - "Phase 10 Plan 03: Vault-Grounding Source-Card Read-Side Summary"
Cohesion: 0.25
Nodes (7): Deferred / Out of Scope, Deviations from Plan, Phase 10 Plan 03: Vault-Grounding Source-Card Read-Side Summary, Self-Check: PASSED, Tasks, Verification, What Was Built

### Community 483 - "Phase 10 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 10 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 484 - "Phase 12 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 12 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 485 - "Phase 13: Proactive In-App Review - Research"
Cohesion: 0.25
Nodes (7): Don't Hand-Roll, Metadata, Open Questions, Phase 13: Proactive In-App Review - Research, Phase Requirements, State of the Art, Summary

### Community 486 - "Phase 13 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 13 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 487 - "package.json"
Cohesion: 0.29
Nodes (6): exports, ./api, name, private, type, version

### Community 488 - "session.ts"
Cohesion: 0.48
Nodes (5): canTransition(), capEndsAt(), graceExpired(), isEnded(), SessionStatus

### Community 489 - "ISO 9001:2015 as an Embedded QMS Layer"
Cohesion: 0.29
Nodes (6): Claim boundary (hard rule), Embedding decision: skills registry, not code, ISO 9001:2015 as an Embedded QMS Layer, Moat linkage, Phased sequencing, Why the cost is low: the harness is already ISO-shaped

### Community 490 - "PII Engine — v1 Decision"
Cohesion: 0.29
Nodes (6): Ceilings (ponytail), Insertion points (already marked in code), Options considered, PII Engine — v1 Decision, Tensions Phase 3 planning MUST resolve (flagged, not silently decided), What the spike proves (`packages/pii`)

### Community 491 - "Common Pitfalls"
Cohesion: 0.29
Nodes (7): Common Pitfalls, Pitfall 1: convex-test cannot exercise component-backed workflows, Pitfall 2: `--once` and Windows exit codes, Pitfall 3: missing `refresh_token` from the Gmail consent, Pitfall 4: `_generated` not present / codegen order, Pitfall 5: raw `query`/`mutation` import ban, Pitfall 6: AI SDK in Convex Node runtime

### Community 492 - "03.11-01-PLAN.md"
Cohesion: 0.29
Nodes (6): schema.ts:133 plans: defineTable, schema.ts:263 agentSteps.tool: v.union(...), schema.ts:313 inboxFixtures: defineTable  (messages[] object at ~316), schema.ts:84  requests: defineTable, The exact schema anchors to extend (line refs from RESEARCH § Recommended file touch-set):, The precedent eval case shape (18-briefing-then-action.json) + the injection-probe precedent (17):

### Community 493 - "03.11-04-PLAN.md"
Cohesion: 0.29
Nodes (6): llm.ts:1155 listInbox strips ids (Pitfall 3 — the loop has NO message ids, so the tool takes a fuzzy ref), llm.ts:1202-1218 briefInbox rawBodies (the toolless-boundary static-scan precedent) ; draftReply from Plan 02, llm.ts:473/502 buildAgentContext + recipientNames (the label render — reuse verbatim, set recipientNames[addr]=displayName), llm.ts:591 buildCockpitTools (add the tool here) ; llm.ts:759 resolveContacts (server-side resolve, labels-only, no-guess), plans.ts patchPlan / resetPlan (03.10-05 built resetPlan because patchPlan drops undefined — clear must be explicit), The precedents to reuse (line refs from RESEARCH):

### Community 494 - "Architecture Patterns"
Cohesion: 0.29
Nodes (7): Anti-Patterns to Avoid, Architecture Patterns, Pattern 1: The dispatcher action (Lane 1, mirrors intake.ts structurally), Pattern 2: PDF text-layer-first with garbage heuristic (Lane 1), Pattern 3: One XML text-walk for all three Office formats (Lane 2), Pattern 4: Sweep as a migration + retry mutation (Lane 3), Recommended file layout (= lane ownership map)

### Community 495 - "Validation Architecture"
Cohesion: 0.29
Nodes (7): Environment notes (from STATE.md — don't re-chase), Known-live blockers carried in from 03.7 (read before planning the E2E), Phase requirements → test map, Sampling rate, Test framework, Validation Architecture, Wave 0 gaps

### Community 496 - "Architecture Patterns"
Cohesion: 0.29
Nodes (7): Anti-Patterns to Avoid, Architecture Patterns, Pattern 1: The read-only tool (mirror `searchVault` verbatim), Pattern 2: Skill body = canonical `.md` → derived `.ts` constant → sync-asserted, Pattern 3: Pure package function + Convex thin adapter (§1), Recommended structure, The two-shapes rule (STATE.md decision, locked)

### Community 497 - "Common Pitfalls"
Cohesion: 0.29
Nodes (7): Common Pitfalls, Pitfall 1: Skill version collision (HIGH — from memory + `skills.ts`), Pitfall 2: Closed union / closed expect-vocab silently drops the new capability (HIGH), Pitfall 3: Assuming `deliverApprovedPlan` covers the memo (HIGH — see §Gap→Action), Pitfall 4: Fabricated metrics leaking through thin-data (HIGH — SC #1), Pitfall 5: PII-in-prose in audit/export (MEDIUM — §4 + STATE.md open blocker), Pitfall 6: §5 no-hardcoded-prompt scan ceiling (MEDIUM)

### Community 498 - "Phase 12 — Deferred / Out-of-Scope Items"
Cohesion: 0.29
Nodes (6): ~~Deferred verification added by 12-05 → 12-06 (the debt is now THREE-part)~~ — RESOLVED 2026-07-25, ~~Deferred verification carried forward from 12-04 → 12-06~~ — RESOLVED 2026-07-25, Eval fixture `18-briefing-then-action` is degrading — OPEN (logged 2026-07-25), Known gap — logged during 12-06 verification, NOT fixed, Phase 12 — Deferred / Out-of-Scope Items, Pre-existing failures observed during 12-02 execution (NOT caused by 12-02)

### Community 499 - "Architecture Patterns"
Cohesion: 0.29
Nodes (7): Anti-Patterns to Avoid, Architecture Patterns, Pattern 1: Cron → fan-out mutation → per-tenant action, Pattern 2: Direct `notifications` insert (the no-OAuth bypass), Pattern 3: Explicit-`tenantId` internal twin, Pattern 4: Static source-scan guard test, Recommended Layout

### Community 500 - "Code Examples"
Cohesion: 0.29
Nodes (7): Code Examples, Verified: `crons.weekly` type surface (convex 1.42.1), Verified: existing cron registration to extend, Verified: scheduled-function completion in tests, Verified: the barrier that makes an unregistered kind safe, Verified: the direct-insert cron mutation (the exact pattern to copy), Verified: the graceful-degradation read the pinned tab relies on

### Community 501 - "Advanced Component Patterns"
Cohesion: 0.33
Nodes (5): Advanced Component Patterns, Class-based client wrappers, Deriving validators from schema, Function Handles for callbacks, Static configuration with a globals table

### Community 502 - "Hybrid Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Advice, Hybrid Convex Components, Risks, What This Means

### Community 504 - "Lane ownership (Phase 3.8)"
Cohesion: 0.33
Nodes (6): Extraction lifecycle (Phase 3.8), Lane 1 — PDF + images (`convex/vaultExtract.ts` + test), Lane 2 — Office parsers (`packages/vault/src/officeText.ts` + test), Lane 3 — Sweep + UI + E2E (`convex/vaultSweep*.ts` + `apps/web/.../dashboard/vault/` + `apps/web/e2e/vault.spec.ts`), Lane 4 — Video transcription (`convex/vaultTranscribe.ts` + test), Lane ownership (Phase 3.8)

### Community 505 - "Local Convex Components"
Cohesion: 0.33
Nodes (5): Checklist, Default Layout, Local Convex Components, When to Choose This, Workflow Notes

### Community 506 - "importGuard.test.ts"
Cohesion: 0.40
Nodes (3): sources, NOTE: `internalQuery`/`internalMutation`/`internalAction` are NOT banned by, RAW_BUILDER_ALLOWLIST

### Community 507 - "devDependencies"
Cohesion: 0.33
Nodes (6): devDependencies, @convex-dev/workpool, convex-test, @edge-runtime/vm, @types/node, vitest

### Community 508 - "03.11-02-PLAN.md"
Cohesion: 0.33
Nodes (5): draftCockpit is reachable from the tool-bearing draftBody at llm.ts:904, so feeding it a body, llm.ts:~2090 digestInbox ; llm.ts:357 draftCockpit (the shape to mirror; do NOT reuse it —, The gated-skill 5-file mirror precedent — inbox-digest (STATE 03.7-03):, The template to clone — digestInbox (toolless, gated-skill, fallback, explicit return type):, there would put mail one hop from the loop; RESEARCH Alternatives Considered / Open Q2).

### Community 509 - "03.11-03-PLAN.md"
Cohesion: 0.33
Nodes (5): cockpit.ts:415 executePlan (requests insert ~:476) — single-arm-site startFanout at :371 stays UNCHANGED, gmail.ts:391 listInbox / :484 fetchInboxBodies / :242 search — already fetch metadata/full; extend to return the target headers, gmail.ts:78 buildMime (zero-attachment branch :84; multipart branch below) ; gmail.ts:138 send (POST body :182), gmailAuth.ts:120 getForDelivery (projection: subject:r.goal, body:r.editedBody??r.draft — new fields invisible unless added), The exact seams (line refs from RESEARCH):

### Community 510 - "Phase 03.5 Plan 05: Reschedule a Canceled Send Summary"
Cohesion: 0.33
Nodes (5): Deviations from Plan, Phase 03.5 Plan 05: Reschedule a Canceled Send Summary, Self-Check: PASSED, Verification, What was built

### Community 511 - "Phase 03.5 Plan 06: Far-Future Scheduling Cap Summary"
Cohesion: 0.33
Nodes (5): Deviations from Plan, Phase 03.5 Plan 06: Far-Future Scheduling Cap Summary, Self-Check: PASSED, Verification, What was built

### Community 512 - "metering.ts"
Cohesion: 0.33
Nodes (6): Live smoke / phase-close human-verify (each lane's own deployment), Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 513 - "Deferred Items — Phase 03 Guardrails"
Cohesion: 0.33
Nodes (5): Deferred (found during 03-04), Deferred Items — Phase 03 Guardrails, `pnpm -r typecheck` turbo runner quirk on @pikar/audit (out of scope for 03-01), Pre-existing audit.test.ts failure (out of scope for 03-02), Pre-existing backend test-file typecheck errors (out of scope for 03-02)

### Community 514 - "Code Examples"
Cohesion: 0.33
Nodes (6): Browse list (cheap query, no vectors — VALT-04), Code Examples, Graph-extractor: structured JSON via `generateObject` (V8 action, mirrors `draftCockpit`), The `graph-extractor` skill (5-file mirror — mirror `document-drafter`), UI wiring (match screenshots, tokens only), `vaultIngestText` seam (Phase-4 + agent write path)

### Community 515 - "Growth OS Port (research priority #6 — what to scope)"
Cohesion: 0.33
Nodes (6): `cfa.py` → `cfa(...)`, `diagnose.py` → `diagnose(scorecard)`, Growth OS Port (research priority #6 — what to scope), `ltgp_cac.py` → `ltgpCac(...)`, References → rubric skill bodies (original wording), Scorecard template → TS type + default

### Community 516 - "Inventory: what already exists"
Cohesion: 0.33
Nodes (6): A. Report ingestion / extraction (Phases 3.8 / 5) — consume, do not extend, B. Live voice sessions (Phase 6) — Lane C owns these files, C. Findings, citations, gap → plan → Approve (Phases 10 & 12) — read-only for this lane, D. Skills registry & eval gate, E. Governance / §4 enforcement precedents, Inventory: what already exists

### Community 517 - "ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages"
Cohesion: 0.40
Nodes (5): ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages, Alternatives rejected, Consequences, Context, Decision

### Community 518 - "ADR-003: All LLM prompts live in a versioned skills registry, never in source"
Cohesion: 0.40
Nodes (5): ADR-003: All LLM prompts live in a versioned skills registry, never in source, Alternatives rejected, Consequences, Context, Decision

### Community 519 - "Convex"
Cohesion: 0.40
Nodes (4): Convex, Route to the Right Skill, Start Here, When Not to Use

### Community 520 - "Scheduled Send"
Cohesion: 0.40
Nodes (4): Amends (process rule: scope decisions name the PRD lines they change), Scheduled Send, Tier 1 — deferred send (v1, Phase 3.5, SCHD-01), Tier 2 — recurring send (deferred; design constraints recorded now)

### Community 521 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 522 - "Phase 02 — Deferred Items"
Cohesion: 0.40
Nodes (4): 02-06 execution — pre-existing test failure (out of scope), 02-06 execution — pre-existing typecheck failures (out of scope), Phase 02 — Deferred Items, Pre-existing `tsc --noEmit` failures in backend test files (found during 02-01, Task 1)

### Community 523 - "Plan 03.10-03 Summary — stalled-resolution recovery through the registry gate"
Cohesion: 0.40
Nodes (4): Deviations, Key files, Plan 03.10-03 Summary — stalled-resolution recovery through the registry gate, Tasks

### Community 524 - "Deferred Items — Phase 03.1 Cockpit Core"
Cohesion: 0.40
Nodes (4): Deferred Items — Phase 03.1 Cockpit Core, Pre-existing biome config warnings (found 03.1-01), Pre-existing `tsc --noEmit` errors in `*.test.ts` (found 03.1-01), Untracked `@pikar/core` WIP fails typecheck (found 03.1-01)

### Community 525 - "Code Examples"
Cohesion: 0.40
Nodes (5): Code Examples, Evidence record + gate check (refs/counts only, §4), Ops signals query shape (tenant-scoped, windowed, read-only), Runner skeleton (mirrors run-smoke-fanout.mjs structure, verified conventions), Script wiring

### Community 526 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 527 - "Video Transcription (Lane 4)"
Cohesion: 0.40
Nodes (5): 1. How intake transcribes audio today (verified in-repo — intake.ts:61–75, NOT llm.ts), 2. Video containers direct to the endpoint — yes, no ffmpeg, 3. Lane-4 ownership + Wave-0 additions, 4. Offline validation strategy (discretion resolved: SMOKE:: only, no video fixtures), Video Transcription (Lane 4)

### Community 528 - "Phase 3.8 — Deferred items (out-of-scope discoveries)"
Cohesion: 0.40
Nodes (4): From 03.8-02 (Lane 1, 2026-07-18), From 03.8-05 (Lane 4, 2026-07-18), Phase 3.8 — Deferred items (out-of-scope discoveries), Reconciliation (03.8-06 integration, 2026-07-18)

### Community 529 - "Standard Stack"
Cohesion: 0.40
Nodes (5): Alternatives Considered, Core, New workspace package, Standard Stack, Supporting

### Community 530 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 531 - "10-01-PLAN.md"
Cohesion: 0.40
Nodes (4): return shape, or ranking):, The engine you extend (extract its body into a shared helper — do NOT change its public signature,, The identity-less internalAction convention to MIRROR (explicit tenantId arg, no auth):, The identity placeholder that hydration replaces (do NOT edit — read-only context):

### Community 532 - "10-02-PLAN.md"
Cohesion: 0.40
Nodes (4): The content-plane adapter precedent to mirror for vaultSources.ts:, The refs-only insert-only audit surface + payload contract:, The template to COPY (briefInbox — the ONE tool doing the exact three-plane split):, The test harness:

### Community 533 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 534 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 535 - "Code Examples"
Cohesion: 0.40
Nodes (5): Code Examples, Doc-scoped session start (schema + call shape), Offline-deterministic test seam, The §4-safe retrieval audit (mirrors `gmail.ts mailbox.searched`), The synthetic thread id (pure, testable)

### Community 536 - "Validation Architecture"
Cohesion: 0.40
Nodes (5): Phase Requirements → Test Map, Sampling Rate, Test Framework, Validation Architecture, Wave 0 Gaps

### Community 537 - "proactiveReview.ts"
Cohesion: 0.50
Nodes (3): insertReviewNotification, reviewOne, runWeekly

### Community 538 - "isGatedSkill"
Cohesion: 0.50
Nodes (4): activateSkillVersion(), GATED_SKILLS, hasPassingEvidence(), isGatedSkill()

### Community 539 - "wormCursor.ts"
Cohesion: 0.50
Nodes (3): advanceCursor, auditSince, getCursor

### Community 540 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 541 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 542 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 543 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 544 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 545 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 546 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 547 - "User Constraints (from CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from CONTEXT.md)

### Community 548 - "Standard Stack"
Cohesion: 0.50
Nodes (4): Core (new dependencies to add), Do NOT add, Standard Stack, Supporting (already installed — reuse, do not re-add)

### Community 549 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence), Secondary (MEDIUM confidence), Sources, Tertiary (LOW confidence — validate at implementation)

### Community 550 - "Deferred items — Phase 03.10"
Cohesion: 0.50
Nodes (3): Deferred at phase close (2026-07-19 human sign-off), Deferred items — Phase 03.10, Pre-existing test reds found during 03.10-01 (2026-07-19)

### Community 551 - "03.11-05-PLAN.md"
Cohesion: 0.50
Nodes (3): cockpit-agent.md:22-26 ("a reply does NOT hand you a subject… ASK") + :255-259 ("a briefing is not permission"), skills.ts EVAL_GATE / GATED_SKILLS / activateSkill ; run-eval-golden.mjs parseSkillPin (already knows cockpit-agent), The skill to edit + the gate machinery (STATE 03.10-03/05/06/07 ran this exact cycle repeatedly):

### Community 552 - "Standard Stack"
Cohesion: 0.50
Nodes (4): Already installed — reuse, add nothing, Alternatives Considered, Core (the only two new dependencies), Standard Stack

### Community 553 - "User Constraints (from CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from CONTEXT.md)

### Community 554 - "Code Examples"
Cohesion: 0.50
Nodes (4): Code Examples, Hosted image/PDF-scan call (extractVisual shape, verified in-repo — intake.ts:83–106), In-test fixture generation (no binary fixtures in the repo), SMOKE:: seam grammar (extend the repo convention)

### Community 555 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence), Secondary (MEDIUM confidence), Sources, Tertiary (LOW confidence)

### Community 556 - "User Constraints"
Cohesion: 0.50
Nodes (4): Claude's discretion (recommendations in this document), Deferred / out of scope, Locked (from ROADMAP 3.9 + 03.7-UAT Gap 2), User Constraints

### Community 557 - "Code Examples"
Cohesion: 0.50
Nodes (4): Code Examples, The code-owned verb map (UI side — the ONLY place a human-readable string exists), The reactive card, dispatched independently of plan status (`cards.tsx`), Turn lifecycle in the driver (`cockpit.ts`) — including the governed-stop leak

### Community 558 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence — read from installed source / repo files), Secondary (MEDIUM), Sources, Tertiary (LOW — flagged)

### Community 559 - "Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake)"
Cohesion: 0.50
Nodes (3): Deferred / Out-of-Scope Items — Phase 4 (Attachment & Voice-Dictation Intake), From 04-01 execution, From 04-02 execution

### Community 560 - "User Constraints (from CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from CONTEXT.md)

### Community 561 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence), Secondary (MEDIUM confidence), Sources, Tertiary (LOW confidence)

### Community 562 - "User Constraints (from CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from CONTEXT.md)

### Community 563 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence — this repo, read directly), Secondary (MEDIUM — cross-referenced memory/state), Sources, Tertiary (LOW / to validate)

### Community 564 - "Standard Stack"
Cohesion: 0.50
Nodes (4): Alternatives Considered, Core — everything is already installed and in use, Standard Stack, Supporting — existing repo modules the phase composes

### Community 565 - "User Constraints (from CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from CONTEXT.md)

### Community 566 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence), Secondary (MEDIUM confidence), Sources, Tertiary (LOW confidence)

### Community 567 - "User Constraints (from 14-CONTEXT.md)"
Cohesion: 0.50
Nodes (4): Claude's Discretion, Deferred Ideas (OUT OF SCOPE), Locked Decisions, User Constraints (from 14-CONTEXT.md)

### Community 568 - "Sources"
Cohesion: 0.50
Nodes (4): Primary (HIGH confidence), Secondary (MEDIUM confidence), Sources, Tertiary (LOW confidence — flagged for validation)

### Community 571 - "Standard Stack"
Cohesion: 0.67
Nodes (3): Alternatives Considered, Core (all existing), Standard Stack

### Community 572 - "Sources"
Cohesion: 0.67
Nodes (3): Primary (HIGH confidence — direct source reads, 2026-07-15, repo @ adc7dd0), Secondary / Tertiary, Sources

### Community 575 - "Standard Stack"
Cohesion: 0.67
Nodes (3): Core — all already installed; this phase adds NO dependency, Explicitly NOT used, Standard Stack

### Community 581 - "Storage Decision Inputs (research priority #4 — planner decides)"
Cohesion: 0.67
Nodes (3): Option A — `vaultDocuments` doc-kind (`kind: "business_scorecard"`), Option B — dedicated `evaluations` table, Storage Decision Inputs (research priority #4 — planner decides)

### Community 643 - "02-06-PLAN.md"
Cohesion: 0.24
Nodes (8): extractDoc, Extracted, extractHosted(), ExtractPath, extractPdf(), PromiseCtor, slicePdfToPageCap(), WithResolvers

### Community 655 - "guardrails.ts"
Cohesion: 0.20
Nodes (8): DEFAULT_CONFIG, getSafeTextByHash, preCall, prepare, rateLimiter, recordSpend, saveInstruction, setKillSwitch

## Knowledge Gaps
- **5333 isolated node(s):** `graphify-mcp`, `KIND_HREF`, `StorageId`, `agentBubble`, `label` (+5328 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **69 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `badge()` connect `page.tsx` to `v1 Requirements`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Why does `tenantMutation` connect `Project State` to `intakeDb.ts`, `cockpit.ts`, `vault.ts`, `crons.ts`, `skills.ts`, `tenant.ts`, `index.ts`, `Validation Architecture`, `guardrails.test.ts`, `Dropzone.tsx`, `VaultStats.tsx`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Why does `contentHash()` connect `Validation Architecture` to `crons.ts`, `emailIntent.ts`, `Project State`, `llm.ts`, `index.ts`, `guardrails.ts`, `guardrails.test.ts`, `buildTelemetry.ts`, `plans.ts`, `Dropzone.tsx`, `vault.ts`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `buildCockpitTools()` (e.g. with `today()` and `isNeedsYou()`) actually correct?**
  _`buildCockpitTools()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `graphify-mcp`, `KIND_HREF`, `StorageId` to the rest of the system?**
  _5355 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `functions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._