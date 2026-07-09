# Graph Report - pikar-ai  (2026-07-09)

## Corpus Check
- 79 files · ~55,246 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 644 nodes · 600 edges · 60 communities (52 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `05dcb84d`
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
- next.config.ts
- convex.config.ts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 14 edges
2. `Architecture Patterns` - 14 edges
3. `compilerOptions` - 13 edges
4. `Phase 1: Foundation & Governance Substrate - Research` - 13 edges
5. `Critical Pitfalls` - 13 edges
6. `Stack Research — Convex Revision` - 13 edges
7. `Phase 1 Plan 01: Foundation & Governance Substrate Summary` - 11 edges
8. `Phase 1 Plan 2: Tenant-Scoping Substrate Summary` - 11 edges
9. `Phase 1 Plan 03: Insert-Only Audit Module Summary` - 11 edges
10. `Phase 1 Plan 4: Skills Registry & Loader Summary` - 11 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (60 total, 8 thin omitted)

### Community 0 - "Architecture Patterns"
Cohesion: 0.05
Nodes (36): Alternatives Considered, Architecture Patterns, Code Examples, Core, Don't Hand-Roll, Metadata, Open Questions, Pattern 10: graphify on the repo (Windows 11) (+28 more)

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
Cohesion: 0.10
Nodes (15): modules, activateSkill, loadSkill(), seedSkills, modules, modules, Brand, CONTRACTS_PACKAGE_NAME (+7 more)

### Community 6 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, convex, @convex-dev/action-retrier, @convex-dev/agent, @convex-dev/auth, @convex-dev/rag, @convex-dev/rate-limiter, @convex-dev/workflow (+17 more)

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
Cohesion: 0.09
Nodes (21): dependencies, convex, next, @pikar/contracts, @pikar/core, react, react-dom, zod (+13 more)

### Community 11 - "result.ts"
Cohesion: 0.13
Nodes (7): createLogger(), LogFields, Logger, LogLevel, Err, Ok, Result

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
Cohesion: 0.12
Nodes (15): Executive Agent & Planning, Expansion, Governance & Operations, Guardrails, Human Review & Delivery, Intake & Enrichment, Knowledge Vault, Live Voice Sessions (+7 more)

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
Cohesion: 0.13
Nodes (14): Overview, Phase 1: Foundation & Governance Substrate, Phase 2: Thin End-to-End Slice, Phase 3: Guardrails, Phase 4: Attachment & Voice-Dictation Intake, Phase 5: Knowledge Vault & GraphRAG, Phase 6: Live Voice Sessions, Phase 7: Resilience & Operations Hardening (+6 more)

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
Cohesion: 0.20
Nodes (9): 1. Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter, 2. Raw `query`/`mutation`/`action` imports are BANNED outside the wrapper module, 3. The audit module is insert-only, 4. Audit and dead-letter payloads must be redaction-safe, 5. No hardcoded agent prompts — skills load from the registry, 6. Pinned pre-1.0 component versions must not be bumped casually, 7. Boot order, 8. Ponytail discipline — the laziest solution that works (MANDATED) (+1 more)

### Community 25 - "Project State"
Cohesion: 0.20
Nodes (9): Accumulated Context, Blockers/Concerns, Current Position, Decisions, Pending Todos, Performance Metrics, Project Reference, Project State (+1 more)

### Community 26 - "Common Pitfalls"
Cohesion: 0.22
Nodes (9): Common Pitfalls, Pitfall 1: Component version drift vs. prior research, Pitfall 2: Tenant wrapper that's advisory, not unavoidable, Pitfall 3: Codegen-before-typecheck ordering breaks clean-clone boot, Pitfall 4: Raw payloads in audit/DLQ from day one (PITFALLS.md #8), Pitfall 5: Stale timeout events firing into later gates, Pitfall 6: `graphifyy` vs `graphify` package confusion, Pitfall 7: OAuth submission blocked on the demo video (+1 more)

### Community 27 - "package.json"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 28 - "package.json"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 29 - "package.json"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 30 - "Phase 1 — Validation Strategy"
Cohesion: 0.25
Nodes (7): Manual-Only Verifications, Per-Task Verification Map, Phase 1 — Validation Strategy, Sampling Rate, Test Infrastructure, Validation Sign-Off, Wave 0 Requirements

### Community 31 - "audit.ts"
Cohesion: 0.33
Nodes (5): log, AuditHash, AuditPayload, AuditPayloadValue, AuditRef

### Community 32 - "demo.ts"
Cohesion: 0.38
Nodes (4): addItem, listItems, tenantMutation, tenantQuery

### Community 33 - "Pikar AI"
Cohesion: 0.29
Nodes (6): Clean-clone boot order (run verbatim), Common commands, Pikar AI, Repository layout, Secrets plane, Sidecars

### Community 34 - "layout.tsx"
Cohesion: 0.40
Nodes (3): metadata, convex, Providers()

### Community 35 - "importGuard.test.ts"
Cohesion: 0.40
Nodes (3): sources, NOTE: `internalQuery`/`internalMutation`/`internalAction` are NOT banned by, RAW_BUILDER_ALLOWLIST

### Community 37 - "Executive Agent — Request Classifier (v1)"
Cohesion: 0.40
Nodes (4): Decision principles, Executive Agent — Request Classifier (v1), Output contract, Routing decision

### Community 38 - "boot-check.mjs"
Cohesion: 0.40
Nodes (3): backend, NOTE: `convex codegen` requires a configured deployment (CONVEX_DEPLOYMENT in, root

### Community 40 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 41 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): exclude, extends, include

## Knowledge Gaps
- **451 isolated node(s):** `metadata`, `convex`, `nextConfig`, `name`, `version` (+446 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Phase 1: Foundation & Governance Substrate - Research` connect `Architecture Patterns` to `Common Pitfalls`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `metadata`, `convex`, `nextConfig` to the rest of the system?**
  _453 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Architecture Patterns` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `Architecture Research` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `biome.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `Stack Research — Convex Revision` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._