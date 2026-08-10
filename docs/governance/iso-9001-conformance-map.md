# ISO 9001 Evidence-Alignment Map

- **Owner:** _TBD_
- **Reviewer:** _TBD_
- **Last reviewed: 2026-08-10**

**Baseline:** ISO 9001:2015 including Amendment 1:2024

## Defined scope and claim boundary

This map covers only Pikar's software/product design, governed behavior release, and governed
service operation. It indexes evidence that those defined mechanisms align with selected ISO 9001
quality-management intents. It does not assess Pikar's complete organizational management system
or any customer's management system.

This artifact is not a certificate, declaration of conformity, certification audit, or claim that
Pikar or a customer is ISO certified. A qualified, independent assessment is required before any
external conformity or certification statement. The adopted design direction and Phase 24 research
are historical inputs, not evidence systems: `repo:.planning/design/iso9001-qms-layer.md` and
`repo:.planning/phases/24-iso-9001-conformance-map/24-RESEARCH.md`.

The baseline is [ISO 9001:2015](https://www.iso.org/standard/62085.html), including
[Amendment 1:2024](https://www.iso.org/standard/88431.html). The
[ISO/IAF climate amendment communique](https://committee.iso.org/files/live/sites/jtcg/files/news/Joint%20ISO-IAF%20Communique%20re%20Climate%20Change%20Amds%20to%20ISO%20MSS%20Feb%202024a.pdf)
informs the climate-context disposition. Publication of the next ISO 9001 edition triggers a
review; this map does not anticipate unpublished requirements.

For clauses 4.1 and 4.2, climate relevance was considered for this defined evidence-map scope.
No repository evidence presently shows climate change to be a material requirement of the mapped
software controls or an identified interested-party requirement. That disposition does not create
an environmental objective or climate program, and it must be revisited when product context,
interested-party requirements, or the published standard changes.

## Closed status vocabulary

- `Direct — defined scope`: the operating mechanism and objective evidence address the intent
  within the defined scope.
- `Supporting`: relevant evidence contributes to the intent but is not sufficient by itself.
- `Partial — gap named`: part of the intent is evidenced and the exact gap has a disposition.
- `Not assessed — organization-wide`: the needed evidence belongs to company-wide practices that
  this repository foundation cannot establish.
- `Not applicable — justified`: the intent is outside the defined scope for a stated reason.

These are the only statuses used by this map. They are classifications, not scores or certification
findings.

## Evidence hierarchy and pointer rule

Prefer evidence in this order: runtime record/read surface; executable test or smoke; implementation
or schema; dated/versioned verification; playbook or ADR; then plan or design intent. Higher-level
intent never substitutes for an operating control.

This file is a pointer-only index. It points to existing artifacts and never copies their content,
runtime rows, test output, or incident narratives. Local evidence pointers use the typed repo
prefix and may add a symbol or section anchor. Non-path evidence uses typed commit, run, or symbol
references. External sources use ordinary Markdown links. Pointers do not use line numbers.

## Clause evidence map

Clause intent is paraphrased; this map does not reproduce the standard. In addition to the baseline
sources above, the [ISO 9001 Auditing Practices Group](https://committee.iso.org/home/tc176/iso-9001-auditing-practices-group.html)
provides non-normative guidance rather than additional requirements.

| Clause | Intent | Status | Evidence | Control | Limitation / gap | Verification |
|---|---|---|---|---|---|---|
| 4.1, 4.2, 4.3 | Understand product context and interested-party requirements, then bound the management-system scope. | Partial — gap named | `repo:.planning/REQUIREMENTS.md`<br>`repo:.planning/ROADMAP.md`<br>`repo:.planning/design/iso9001-qms-layer.md` | Requirements and roadmap define the product context; this map defines its software/product and governed-service boundary and records the Amendment 1:2024 climate consideration. | Disposition — defer to company-certification readiness: organization-wide context, interested parties, and scope require company evidence and qualified review; revisit when those inputs or the published edition change. | Review the defined-scope and climate disposition against the current requirements, roadmap, and official amendment sources. |
| 4.4 | Identify interacting processes and the controls used to operate them. | Supporting | `repo:CLAUDE.md`<br>`repo:docs/README.md`<br>`repo:docs/playbooks/TEMPLATE.md`<br>`repo:.planning/phases/01-foundation-governance-substrate/01-01-PLAN.md` | GSD requirements-to-plan-to-verification flow, ADRs, playbooks, approval gates, and runtime records describe interacting software delivery and service-operation processes without a second process manual. | Accepted foundation boundary: the linked process descriptions do not establish a complete organization-wide QMS process model. | Follow the linked lifecycle artifacts and run the verification commands named by the applicable plan and playbook. |
| 5.1–5.3 | Establish leadership commitment, policy, responsibilities, and authorities. | Not assessed — organization-wide | Organization-wide leadership and policy evidence is outside this repository foundation. | Product owner authorization protects high-risk transitions within the application. | Owner authorization is not a company quality-policy substitute and does not establish organization-wide QMS roles. | Review only during company-certification readiness using actual leadership, policy, responsibility, and accountability records. |
| 6.1–6.3 | Address risks and opportunities, set objectives, and plan controlled changes. | Supporting | `repo:.planning/REQUIREMENTS.md`<br>`repo:.planning/ROADMAP.md`<br>`repo:.planning/phases/24-iso-9001-conformance-map/24-01-PLAN.md`<br>`repo:packages/backend/convex/guardrails.ts` | Roadmap success criteria, plan must-haves and validation, ADRs, approval gates, and runtime guardrails make product risk and change intent explicit. | Accepted foundation boundary: these controls are not an organization-wide risk register, quality-objective program, or planning-of-change record for every business process. | Check requirement-to-plan traceability, task verification, and the relevant guardrail tests before accepting a change. |
| 7.1.6 | Retain and make available knowledge needed to operate and change the product. | Direct — defined scope | `repo:docs/README.md`<br>`repo:docs/playbooks/TEMPLATE.md`<br>`repo:docs/decisions/002-insert-only-audit.md`<br>`repo:scripts/check-playbooks.mjs` | Playbooks capture invariants and safe-change steps, ADRs retain decisions, plans/summaries retain delivery evidence, and Graphify/Git provide navigation and history. | Direct status is limited to repository-held product and operational knowledge; tacit company knowledge is not assessed. | Run `node scripts/check-playbooks.mjs check`, inspect linked ADR status, and verify current source rather than relying on historical prose alone. |
| 7.2–7.4 | Ensure competence, awareness, and controlled internal and external communication. | Not assessed — organization-wide | Personnel, competence, awareness, and communications evidence is outside this repository foundation. | Playbooks support technical knowledge transfer but cannot prove competence or awareness. | Company-wide training, competence evaluation, and communication controls are deferred to company-certification readiness. | Review actual people, training, competence, and communication records when that readiness work begins. |
| 7.5 | Create, control, identify, protect, and retain documented information. | Direct — defined scope | `repo:CLAUDE.md#3.-Immutable-audit-log`<br>`repo:CLAUDE.md#4.-Redaction-before-persistence`<br>`repo:docs/decisions/002-insert-only-audit.md`<br>`repo:packages/backend/convex/audit.ts#log`<br>`repo:packages/contracts/src/audit.ts#AuditPayload`<br>`repo:packages/backend/convex/schema.ts#audit`<br>`repo:packages/backend/convex/auditImmutability.test.ts`<br>`repo:packages/backend/convex/worm.ts#exportAudit`<br>`repo:packages/backend/convex/wormCursor.ts`<br>`repo:packages/core/src/retention.ts`<br>`repo:.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md` | The hot audit copy is tenant-scoped, insert-only through the sole internal log surface, indexed for traceability, and constrained to refs/hashes/counts/flags. Deterministic export writes external S3 Object Lock records and advances its cursor only after a successful write. | External preservation remains conditional: an unset WORM_BUCKET intentionally skips export, the hot copy is not WORM, and real S3 retention/delete refusal has no newer dated live proof. The preservation claim stays blocked until live evidence exists. | Run the audit immutability and WORM suites; inspect current deployment evidence before claiming external preservation. |
| 8.1 | Plan and control product/service work before execution. | Direct — defined scope | `repo:.planning/REQUIREMENTS.md`<br>`repo:.planning/phases/01-foundation-governance-substrate/01-01-PLAN.md`<br>`repo:.planning/phases/01-foundation-governance-substrate/01-VALIDATION.md`<br>`repo:packages/backend/convex/cockpit.ts#executePlan`<br>`repo:packages/backend/convex/guardrails.ts` | Plans define acceptance and verification; runtime work crosses guardrails and an explicit Approve transition before governed execution. | This evidence covers software delivery and governed service actions, not every company operating process. | Run the plan's automated checks and inspect the approved plan plus its audit/correlation references before execution. |
| 8.2 | Determine, review, and control product/service requirements. | Direct — defined scope | `repo:.planning/REQUIREMENTS.md`<br>`repo:.planning/ROADMAP.md`<br>`repo:.planning/phases/01-foundation-governance-substrate/01-08-SUMMARY.md` | Requirement IDs map to roadmap phases, plans, success criteria, summaries, and owner UAT decisions. | Repository traceability does not establish contracts, customer communications, or requirements review for every commercial engagement. | Trace the requirement from REQUIREMENTS through ROADMAP, plan, summary, and verification or UAT evidence. |
| 8.3 | Control software/product design and development inputs, reviews, outputs, verification, and changes. | Direct — defined scope | `repo:.planning/REQUIREMENTS.md`<br>`repo:.planning/ROADMAP.md`<br>`repo:.planning/phases/03.6-agent-eval-gate/03.6-01-PLAN.md`<br>`repo:.planning/phases/03.6-agent-eval-gate/03.6-01-SUMMARY.md`<br>`repo:.planning/phases/03.6-agent-eval-gate/03.6-VALIDATION.md`<br>`repo:.planning/phases/03.6-agent-eval-gate/03.6-VERIFICATION.md`<br>`repo:docs/README.md`<br>`repo:docs/playbooks/TEMPLATE.md`<br>`repo:docs/playbooks/watch.json`<br>`repo:scripts/check-playbooks.mjs`<br>`repo:.claude/settings.json` | GSD artifacts separate intent, acceptance, validation, implementation summary, and goal-backward verification. ADRs record significant choices; Git provides version identity and rollback. The playbook checker connects changed watched paths to knowledge updates. | The watcher is a Claude Stop/SubagentStop hook, fails open on Git/tool errors, and is not a universal merge gate for human or non-Claude changes. | Run `node scripts/check-playbooks.mjs check`, the plan's targeted tests, and CI; inspect the actual diff and linked verification rather than frontmatter status alone. |
| 8.4 | Control externally provided products, services, and processes. | Partial — gap named | `repo:package.json`<br>`repo:pnpm-lock.yaml`<br>`repo:.github/workflows/ci.yml` | Locked dependencies and adapter/CI tests provide repeatable technical checks for selected providers and packages. | Disposition — accepted limitation: the repository does not contain a complete supplier selection, monitoring, re-evaluation, or provider-performance system. | Verify lockfile integrity and the provider-specific adapter tests; do not infer supplier approval from a passing build. |
| 8.5.1–8.5.2 | Operate governed services under controlled conditions with identification and traceability. | Direct — defined scope | `repo:packages/backend/convex/cockpit.ts#executePlan`<br>`repo:packages/backend/convex/plans.ts`<br>`repo:packages/backend/convex/audit.ts#log`<br>`repo:packages/backend/convex/schema.ts#audit`<br>`repo:packages/backend/convex/auditImmutability.test.ts`<br>`repo:docs/playbooks/audit-dead-letter.md` | Closed plan action types, guardrails, owner approval, tenant/correlation identifiers, pinned skill versions, telemetry, and insert-only audit records control and trace governed execution. | Traceability is only as complete as the instrumented event set; static immutability tests do not prove every desired event is logged. | Run the audit and governed-execution tests, then follow tenant, correlation, plan, and version references through their read surfaces. |
| 8.5.6 | Review and control product/runtime changes while retaining version and rollback evidence. | Direct — defined scope | `repo:docs/decisions/003-skill-registry-for-prompts.md`<br>`repo:packages/backend/convex/schema.ts#skills`<br>`repo:packages/backend/convex/skills.ts#seedSkills`<br>`repo:packages/backend/convex/skills.ts#insertCandidate`<br>`repo:packages/backend/convex/skills.ts#recordEvalEvidence`<br>`repo:packages/backend/convex/skills.ts#activateSkillVersion`<br>`repo:packages/backend/convex/skills.test.ts`<br>`repo:docs/playbooks/skill-registry.md`<br>`repo:.github/workflows/ci.yml` | Skill bodies are immutable per version; a body change inserts a new version. Status and version-pinned eval evidence are the sanctioned mutable fields. Candidate evaluation, owner activation, one-active-version transitions, prior-version rollback, Git, CI, ADRs, and playbooks provide change control. | Direct status covers the implemented registry and repository mechanisms; a Git commit alone does not prove review, approval, or fitness. | Run the skills suite and CI, inspect evidence pinned to the exact candidate version, and prove rollback using a prior immutable version. |
| 8.6 | Authorize release only after planned checks are satisfied. | Direct — defined scope | `repo:packages/backend/scripts/run-eval-golden.mjs`<br>`repo:packages/backend/convex/skills.ts#recordEvalEvidence`<br>`repo:packages/backend/convex/skills.ts#activateSkillVersion`<br>`repo:packages/backend/convex/skills.test.ts`<br>`repo:.planning/phases/03.6-agent-eval-gate/03.6-VERIFICATION.md`<br>`repo:.github/workflows/ci.yml` | For gated candidate skill versions, a full unfiltered golden run records evidence against the exact version and separate owner activation releases it. Code uses CI and phase verification as supporting release checks. | Scope excludes bootstrap v1 and explicitly ungated skills. Unpaid or failed candidates remain unreleased; live model runs are on demand. Deployment is not automatically performed by the evidence gate, and historical run evidence never releases a later version. | Run `node packages/backend/scripts/run-eval-golden.mjs --self-check`; for an actual candidate require a full unfiltered version-pinned run and read back its evidence before owner activation. |
| 8.7 | Identify and control nonconforming outputs to prevent unintended use or delivery. | Direct — defined scope | `repo:packages/backend/convex/deadLetters.ts`<br>`repo:packages/backend/convex/deadLetters.test.ts`<br>`repo:packages/backend/convex/guardrails.ts`<br>`repo:packages/backend/convex/cockpit.ts#executePlan`<br>`repo:docs/playbooks/audit-dead-letter.md` | Fail-closed guardrails, approval refusal, terminal workflow states, DLQ capture, notifications, and no-send tests prevent or surface selected failed/nonconforming runtime outputs. | This is a product/runtime control, not an organization-wide nonconforming-output process. | Run the dead-letter, guardrail, cockpit, and notification tests and inspect the tenant-scoped operational read surface. |
| 9.1 | Monitor, measure, analyze, and evaluate process and product behavior. | Supporting | `repo:packages/backend/convex/telemetry.ts`<br>`repo:packages/backend/convex/opsSignals.ts`<br>`repo:packages/backend/convex/opsSignals.test.ts`<br>`repo:packages/backend/scripts/run-eval-golden.mjs` | Tenant-scoped telemetry, audit-derived operational signals, evaluation results, feedback, DLQ rates, and cost measures provide selected software/service observations. | Metrics and windows are mechanism-specific and do not constitute a complete organization-wide quality-performance evaluation. | Run the ops-signal tests, inspect metric windows and denominators, and cite exact version/run records for live evaluation claims. |
| 9.2 | Conduct an independent, planned internal audit program for the management system. | Not assessed — organization-wide | No repository artifact establishes an internal QMS audit program. | Tests and GSD verification challenge product behavior and phase goals. | Tests are not clause 9.2 internal audits; independence, audit program, criteria, scope, reporting, and follow-up require organization-wide evidence. | Defer assessment until a real internal-audit program exists and is reviewed during company-certification readiness. |
| 9.3 | Perform management review using required inputs and decisions. | Not assessed — organization-wide | No repository artifact establishes a complete management-review process or its inputs and outputs. | Owner checkpoints authorize changes and capture UAT decisions. | Owner checkpoints are not clause 9.3 management review and owner authorization is not a company quality policy. | Defer assessment until a real management-review process produces dated inputs, outputs, actions, and decisions. |
| 10.2 | React to nonconformity, control effects, determine cause, take corrective action, and review effectiveness. | Partial — gap named | `repo:packages/backend/convex/deadLetters.ts`<br>`repo:packages/backend/convex/deadLetters.test.ts`<br>`repo:packages/backend/convex/notifications.ts`<br>`repo:packages/backend/convex/notifications.test.ts`<br>`repo:packages/backend/convex/audit.ts#log`<br>`repo:docs/playbooks/audit-dead-letter.md`<br>`repo:docs/governance/iso-9001-conformance-map.md#corrective-action-evidence-index` | DLQ writing, tenant-scoped reading, resolve transition, deadletter audit event, notification choke point, and tests directly evidence detection, containment, visibility, and operator disposition. The bounded index supports cause, correction, recurrence-prevention, effectiveness, and closure for selected material cases. | Disposition — accepted defined-scope limitation: a resolved DLQ status alone is not corrective action, and no claim is made that every test failure or DLQ row receives formal cause analysis and effectiveness review. The index does not establish organization-wide clause 10.2 conformity. | Run the dead-letter and notification suites, then open every pointer in each selected evidence chain and confirm observation, cause, action, effectiveness, and dated closure. |
| 10.3 | Improve behavior using observed evidence and controlled changes. | Supporting | `repo:packages/backend/convex/skills.ts#insertCandidate`<br>`repo:packages/backend/convex/skills.ts#recordEvalEvidence`<br>`repo:packages/backend/convex/skills.ts#activateSkillVersion`<br>`repo:packages/backend/convex/skills.test.ts`<br>`repo:.planning/ROADMAP.md` | Feedback and observed failures can create immutable candidate versions; evaluation, owner activation, rollback, and roadmap gap-closure provide a controlled improvement loop. | Candidate creation may be dormant, unpaid, rejected, or intentionally ungated; this does not establish organization-wide continual-improvement effectiveness. | Trace the observation to an exact candidate version, full evidence, activation or rejection, later observation, and rollback where applicable. |

## Corrective-action evidence index

This is a pointer index, not an incident register, workflow, required template, or second record
store. Entry is limited to a material product/service or governance nonconformity for which
recurrence-prevention and effectiveness evidence matter. Ordinary test failures and DLQ rows do not
enter automatically. Future rows may be appended only after the complete evidence already exists.

| Nonconformity / observed effect | Containment / immediate correction | Cause evidence | Corrective action / recurrence prevention | Effectiveness evidence | Closure / disposition and owner / date |
|---|---|---|---|---|---|
| `repo:.planning/phases/19-contacts-crm-follow-ups/19-10-SUMMARY.md#the-headline-finding` records `run:309b1c3d`: the strengthened dated-follow-up fixture measured a contact-only operation instead of the requested dated follow-up. | `repo:packages/backend/scripts/eval-cases/36-crm-follow-up.json` made the op type and finite due date load-bearing; ACTN-05 remained open rather than treating the earlier count-only green as closure. | `repo:.planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md#the-six-defect-closures-confirmed-not-taken-on-trust` identifies the dropped trusted clock in the loop and absent browser client context; `repo:.planning/phases/19-contacts-crm-follow-ups/19-13-SUMMARY.md` retains the fabricated-address and follow-up closure history. | `repo:packages/backend/convex/llm.ts#runAgentLoop` and `repo:apps/web/app/(app)/dashboard/workspace/useSendCockpitMessage.ts` carry the shared clock fixes in `commit:6c9e442` and `commit:135943d`; the refusal/address corrections are retained by `commit:ef2dd8b` and `commit:07d1520`. | `repo:apps/web/e2e/pipeline-uat.spec.ts` step 7 observed a dated addFollowUp with finite dueAt; `repo:.planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md#applying-the-green-and-meaningless-lens` records focused PASS `run:0b2b6b22` and preserves the splice caveat: earlier 35/35 `run:086f8267` predates the strengthened key and fix. | `repo:.planning/phases/19-contacts-crm-follow-ups/19-13-SUMMARY.md` and `repo:.planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md#owner-sign-off-and-live-inbox-evidence` record phase closure and owner UAT on 2026-08-10; no single post-fix 35-case run is claimed. |
| `repo:.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md#owner-signoff` records the owner finding that unread notification rows had no general in-app render surface beyond the narrow reconnect banner. | `repo:packages/backend/convex/notifications.ts#notify` retained the in-app row and best-effort external channel while the display gap was corrected; `repo:.planning/phases/07-resilience-operations-hardening/07-06-SUMMARY.md#live-smokes-against-3210-all-pass` records the DLQ notification smoke. | `repo:apps/web/app/(app)/_components/ReconnectBanner.tsx` covered only gmail_reconnect, while `repo:.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md#goal-achievement` records the missing general surface as a human-review finding. | `repo:apps/web/app/(app)/_components/NotificationsBanner.tsx` and `repo:apps/web/app/(app)/layout.tsx` add and mount the general unread-notification surface in `commit:e147fe9`, with Dismiss routed to markRead. | `repo:.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md#human-verification` records a production build and the owner seeing agent.timeout render with working Dismiss; `repo:docs/playbooks/audit-dead-letter.md#in-app-render-surface` retains the operating invariant. | `repo:.planning/phases/07-resilience-operations-hardening/07-06-SUMMARY.md#owner-verification-outcome-task-2-resolved` and `repo:.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md#owner-signoff` record owner closure on 2026-07-21; real S3 Object Lock remains a separate Manual-Only residual and is not claimed corrected here. |

## How to use this map

1. Start with the relevant clause row and confirm that its status matches the claim being made.
2. Follow the actual source, test, runtime-read, or dated verification pointers in evidence-hierarchy
   order. A path's presence is not proof that the control currently operates.
3. Run the row's verification against the current revision and inspect any required live readback.
4. Treat summaries and verification reports as historical evidence only for the exact version,
   commit, run, and date they name. Never reuse them to release or characterize a later version.
5. If evidence and status disagree, narrow or block the claim first; update the status only after
   stronger evidence exists.

## Maintenance triggers

Review this map only when one of these evidence mechanisms or claim boundaries changes:

- ISO publishes a new edition or an applicable amendment;
- the audit or WORM mechanism, retention boundary, or live preservation evidence changes;
- skill candidate, evaluation, evidence, activation, or rollback semantics change;
- playbook, ADR, GSD, Git, or CI change-control mechanisms change materially;
- Pikar introduces an actual internal-audit or management-review process; or
- a new marketing, procurement, compliance, conformity, or certification claim is proposed.

Ordinary feature changes do not update this map when the mapped mechanism is unchanged. Their own
plans, tests, summaries, verification, and playbooks remain the evidence.

## Offline verification

Run from the repository root. These commands validate the map's baseline and the existing controls;
they do not establish certification, organization-wide conformity, or live infrastructure state.

```powershell
node -e "const s=require('fs').readFileSync('docs/governance/iso-9001-conformance-map.md','utf8'); if(!s.includes('ISO 9001:2015')) throw new Error('missing baseline'); console.log('map readable')"
pnpm --filter @pikar/backend exec vitest run convex/auditImmutability.test.ts convex/worm.test.ts convex/skills.test.ts convex/deadLetters.test.ts convex/notifications.test.ts --maxWorkers=1
node packages/backend/scripts/run-eval-golden.mjs --self-check
node scripts/check-playbooks.mjs check
```

When the shell does not expose the package-local binary directory, repair that local execution
environment before interpreting a wrapper failure as a control failure. Do not replace these
bounded commands with a paid live eval or production mutation.

## Manual-Only verification

| Behavior | Why manual | Required disposition |
|---|---|---|
| Claim boundary and clause applicability | Syntax and unit tests cannot decide legal/compliance meaning or organization-wide applicability. | The owner reviews the defined scope and statuses; obtain qualified ISO review before any external conformity statement. |
| Real S3 Object Lock durability and delete refusal | It requires configured AWS infrastructure, credentials, an actual retained object, and a refused delete. | Cite dated live evidence only when performed; otherwise keep preservation conditional and the claim blocked. |
| Leadership, competence, internal audit, and management review | Evidence belongs to people and company processes, not repository implementation. | Keep clauses 5, 7.2–7.4, 9.2, and 9.3 not assessed until actual organization-wide evidence exists. |
| ISO edition re-baseline | The next edition is not yet the baseline mapped here. | Review after publication; do not guess future requirements. |

## Known limitations

- Live WORM evidence is conditional: code, cursor ordering, checksums, and the unset-bucket skip are
  tested, but no newer dated proof establishes real S3 COMPLIANCE retention and delete refusal.
- Playbook freshness enforcement is hook-scoped, can fail open on Git/tool errors, and is not a
  universal human or non-Claude merge gate.
- The direct 8.6 release status applies only to gated candidate skill versions. Bootstrap v1,
  explicitly ungated skills, unpaid/failed candidates, on-demand live runs, and deployment remain
  outside that claim.
- Clause 10.2 currently proves detection, containment, visibility, and disposition only. Plan 24-02
  owns the corrective-action evidence linkage; resolved status alone is insufficient.
- No repository evidence establishes a clause 9.2 internal-audit program or clause 9.3 management
  review. Tests and owner checkpoints must not be relabelled as either.
