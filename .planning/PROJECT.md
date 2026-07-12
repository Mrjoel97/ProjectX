# Pikar-AI

## What This Is

Pikar-AI is a governed, agentic operating layer that turns scattered, unstructured input — voice, text, attachments — into planned, multi-step action that follows through across the user's tools, with built-in guardrails for cost, compliance, and quality, and that gets better over time. It targets every business size, but v1 serves the solopreneur: a 24/7 AI chief-of-staff they couldn't otherwise afford, delivered as a web app reaching private beta in 4 weeks.

## Core Value

A user speaks or types a goal and the system reliably plans it, shows the plan for a **single approval before anything leaves the building** (approve once → hands-off governed execution, with stage notifications and a halt control), executes it with guardrails (cost, PII, quality), and follows through to real delivery (email) — with a full audit trail. *(Approval granularity moved from per-delivery to per-plan on 2026-07-10.)*

## Requirements

### Validated

(None yet — ship to validate)

*Post-beta gate: a feature idea may not move from idea to roadmap phase without an
evidence-backed Validated line — see `.planning/design/moat-strategy.md` for the
evidence hierarchy (behavioral > verbal-specific; verbal-general is noise).*

### Active

- [ ] Request intake via text, file attachments, and voice (recorded dictation → transcription)
- [ ] Live bidirectional voice sessions with the Executive Agent (15-min cap, End-session button, transcript → structured markdown brief → knowledge vault; optional conversion to an executable step-by-step plan with user permission)
- [ ] Knowledge vault: stored, indexed, groundable session briefs and documents; supports future continuation and reference
- [ ] Executive Agent classification and planning (direct tool / sub-agent / direct-LLM routes, explicit invalid-route handling)
- [ ] Attachment processing: classify → OCR / PDF extraction / audio transcription → merge into request context
- [ ] Context grounding against the user's knowledge vault
- [ ] PII scan and redaction producing safeText (explicit null/unknown failure handling)
- [ ] Cost estimation, budget check, and model downgrade (explicit null/unknown failure handling)
- [ ] LLM cache (safeTextHash lookup/store), primary generation, fallback generation on failure/timeout
- [ ] Human review at the PLAN: user approves/edits/rejects the plan once before execution; after approval, execution is hands-off with stage-completion notifications and a halt control; edit/reject retry counters with escalation on threshold breach and review timeout handling *(redefined 2026-07-10 from per-response review)*
- [ ] Conversational email cockpit: guided chat intake (slot-filling) → plan approval → multi-recipient governed send → live per-recipient report; later slices add inbox reading, agent-generated attachments, and per-recipient personalization *(added 2026-07-11, replaces the form/queue UX; see `.planning/design/email-chat-cockpit.md`)*
- [ ] Final delivery via email through a provider-agnostic adapter (Gmail API and Microsoft Graph both supported)
- [ ] Feedback capture; threshold breach triggers the prompt-optimization loop (self-improvement)
- [ ] Telemetry: per-request tokens, cost, duration, decision counts, review outcome
- [ ] Reusable audit logging and compliance archival of the full request trail
- [ ] Dead-letter archive for failed/unhandled requests
- [ ] Notifications for rejection, escalation, retry-limit breach, timeouts, dead-letter events
- [ ] Private beta: invited users beyond the owner — signup/invite flow, per-user data isolation, basic onboarding

### Out of Scope

- UiPath platform (Apps, Action Center, Maestro BPMN) — user chose code-first stack; the BPMN document is the spec, not the runtime
- Enterprise RBAC (Admin/Developer/EndUser roles) — staged for a later milestone; v1 has a single user role
- Multi-reviewer / senior-reviewer human roles — solo user reviews own output in v1; escalation paths map to notifications + timeout defaults
- Slack intake and multi-channel orchestration — startup/SME tier features, later milestone
- Desktop/legacy RPA execution — no UiPath; browser/API tools only in v1
- Public launch (billing, abuse protection, legal pages) — next milestone after private beta
- Custom skills registry for third-party teams — enterprise-tier feature

## Context

- Original specification is a UiPath-vocabulary BPMN end-to-end orchestration document (intake → validation → enrichment → planning → execution → grounding → PII → cost → cache → LLM → review → feedback → archival). It defines 27 capabilities, ~15 child services, the data contracts to create (attachmentRefs, routingDecision, piiScanResult, costEstimateResult, llmResponse, reviewDecision, feedbackResult, telemetryPayload, notificationPayload, auditLogPayload, etc.), and a 20-scenario test matrix. It remains the canonical functional spec.
- User mandate: everything tracked and documented with strict separation of concerns, so any engineer/team can onboard any module from its docs without talking to another team. Every service gets its own README, contract, and runbook.
- Required workflow tools: GSD for all building workflows; ponytail plugin (minimal-code decision ladder) for code-generation discipline.
- Resources on hand: LLM API key(s), cloud hosting account, Microsoft 365 and Google Workspace. No UiPath tenant.
- Builder: solo owner + Claude Code.
- Moat strategy: two structural moats cultivated deliberately — per-tenant learning moat (vault + SkillOpt loop) and compliance/trust moat (audit spine + restricted-scope posture); roadmap prioritization and the post-beta Validated gate follow `.planning/design/moat-strategy.md`.

## Constraints

- **Timeline**: Private beta in production in 4 weeks (target ~2026-08-05) — MVP must be one thin end-to-end slice with everything else staged
- **Tech stack**: Code-first TypeScript monorepo — Next.js web app on a Convex backend (database, functions, realtime, vector search, scheduling), LLM gateway with caching/fallback — no UiPath licensing dependency. Python sidecars (Presidio PII, graphify extraction) are **not yet built and no longer assumed**: the v1 PII engine is **pure-TS in `packages/pii`** (decided 2026-07-12, spike proven — see `.planning/design/pii-engine.md`); the Presidio sidecar is the named upgrade path, adopted only if redaction quality (names/i18n) demands the platform cost
- **Restricted-scope compliance** *(added 2026-07-10)*: `gmail.modify` is a Google **restricted** scope — an annual CASA third-party security assessment (~$500–4,500/yr to the assessor) is a permanent recurring product cost, and the LLM provider MUST be contracted on zero-retention / no-training terms (Google policy forbids using restricted-scope data to train generalized models). Verification also runs longer than the sensitive-scope path
- **Budget**: Cost guardrails are a product feature and a build constraint — LLM cache and model downgrade must exist in v1
- **Compliance**: Every request, redaction, model call, tool execution, and review action is logged and archived from day one — retrofitting audit trails is not acceptable
- **Voice**: Live sessions hard-capped at 15 minutes; sessions end explicitly via End-session button

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Code-first stack, no UiPath | No enterprise licensing dependency; deployable in 4 weeks; BPMN doc becomes the spec | ✅ Good — Phases 1–2 built and smoke-proven on it |
| Solopreneur chief-of-staff as MVP slice | Single user role avoids RBAC scope; demonstrates core value end to end | ✅ Good — single-role model held through Phase 2 |
| Voice in MVP, two modes (dictation + live agent session) | Voice is the product's identity feature; user explicitly requires both modes | — Pending (Phases 4, 6 unbuilt; at schedule risk) |
| Email via provider-agnostic adapter (Gmail + MS Graph) | Multi-channel story real from day one; both accounts available | ◐ Partial — Gmail live end-to-end (Phase 2); MS Graph deferred to Phase 9 |
| User reviews own output in v1 | Solo persona; multi-reviewer RBAC deferred to enterprise milestone | ✅ Good — amended 2026-07-10: review granularity moved to the PLAN (see below) |
| Week-4 "production" = private beta | Invited users beyond owner; adds invite flow + per-user isolation, not billing | — Pending (Phase 9) |
| GSD + ponytail mandated in all build workflows | User requirement for tracked, documented, minimal-code process | ✅ Good — 15 plans executed under it |
| Voice ships both modes in v1, staged (dictation ~W3, live session ~W4) | Identity feature is a hard beta requirement; staging de-risks the core pipeline | ⚠️ At risk — cockpit phases (3.1–3.4) inserted ahead of voice; W3/W4 staging no longer realistic without descope |
| Prompt-optimization loop fully autonomous in v1 | Owner accepts reward-hacking risk for faster learning; mitigate with eval checks + rollback + kill switch | — Pending (Phase 8) |
| Brief→executable-plan conversion ships with the live session in v1 | User-specified flow: session end → brief → permission → plan enters pipeline | — Pending (Phase 6) |
| Convex replaces Postgres/Redis/Inngest as the data+orchestration plane | Owner decision (2026-07-09) after honest tradeoff review: velocity + built-in realtime valued over portability; Convex-focused stack re-research mandated before roadmap | ✅ Good — substrate proven: tenancy, audit, DLQ, workflows, realtime all live |
| Graphify at the core: dev-time codebase graph (always active) + ingestion-time extraction for the knowledge vault | User mandate; extraction stored in the data plane, never served from graphify files at request time | ◐ Partial — dev-time graph active (01-05); ingestion-time extraction pending Phase 5 |
| SkillOpt (microsoft/SkillOpt) is the core skills setup + optimization layer | User mandate (2026-07-09): all agent prompts live as versioned skill docs in a Convex skills registry from Phase 1; Phase 8 optimizes them via SkillOpt's held-out-validation loop (satisfies IMPR-02's eval gate with peer-reviewed machinery) | ◐ Partial — registry live with 3 versioned skills (Phase 1–2); optimization loop pending Phase 8 |
| **Full mailbox access via `gmail.modify` after one explicit consent** (2026-07-10) | One scope covers read/draft/send/organise; deliberately NOT `https://mail.google.com/` so "Pikar cannot delete your email" stays a true published guarantee | ⚠️ Adopted — cost: restricted scope ⇒ annual CASA assessment + zero-retention LLM contract are now hard constraints (see Constraints) |
| **Approval granularity: per-PLAN, not per-delivery** (2026-07-10) | User approves the plan once; execution is hands-off, notifies per stage, and can be halted — matches the chief-of-staff promise | ✅ Adopted — REVW-01 redefined; cockpit design codifies it; Phase 2's per-response gate is the acknowledged interim |
| **Email Chat Cockpit replaces the form/queue UX** (2026-07-11) | Conversational intake/approval over the same governed engine — no rewrite; form + review queue retire | ✅ Registered — Phases 3.1–3.4 in roadmap (2026-07-12); 02-08/02-09 superseded; CKPT-01..03 requirements minted |
| **v1 PII engine: pure-TS `packages/pii`, no sidecar, no DLP API** (2026-07-12) | Deterministic scan/redact (email/card+Luhn/SSN/phone) with fail-closed Result; a cloud DLP API would add a processor for restricted-scope data (CASA surface); a sidecar is a whole deployment plane for one function | ✅ Decided + spike proven (8 tests green) — design record: `.planning/design/pii-engine.md`; names-in-prose tension deferred to Phase 3 planning |

---
*Last updated: 2026-07-12 — re-baselined: per-plan approval, gmail.modify restricted-scope constraints (CASA + zero-retention LLM), cockpit phases 3.1–3.4, sidecar assumption removed, decision outcomes recorded; moat strategy + post-beta Validated gate registered (`.planning/design/moat-strategy.md`)*
