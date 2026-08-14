---
phase: 24
slug: iso-9001-conformance-map
status: research-complete
research_type: ecosystem
requirement: GOVN-02
researched: 2026-08-10
---

# Phase 24 Research: ISO 9001 Conformance Map

## Research Summary

Phase 24 should produce **one canonical, thin evidence map** for the parts of Pikar's real
product-development and service-operation system that align with ISO 9001:2015. It should not
create a second quality manual, a duplicate audit store, a new approval workflow, or a claim that
Pikar or its customers are certified.

The repository already contains substantial objective evidence:

- insert-only, redaction-safe operational audit records with a conditional WORM export;
- immutable-per-version skills, candidate status, version-pinned eval evidence, owner activation,
  and rollback;
- requirements, plans, acceptance criteria, validation strategies, summaries, verification
  reports, immutable ADRs, and Git history;
- playbooks tied to source paths through `watch.json` and a Stop/SubagentStop freshness hook;
- telemetry, production eval signals, feedback, DLQ rows, operator visibility, and notifications.

The main work is classification, not construction. The map must distinguish:

1. **direct evidence** — an artifact/process actually satisfies the mapped requirement in the
   defined scope;
2. **supporting evidence** — relevant, but insufficient alone;
3. **partial evidence / genuine gap** — some required behavior exists and the missing element is
   named precisely;
4. **not assessed in this foundation** — organization-wide clauses such as quality policy,
   competence, internal audit, and management review that cannot honestly be inferred from a
   software repository.

The most important research finding is that the roadmap's shorthand `DLQ/notifications -> 10.2`
is only partially true. DLQ and notifications prove detection, containment, and visibility. They do
not by themselves prove cause analysis, corrective action, or effectiveness review. Existing GSD
debug/gap-closure artifacts often contain those missing elements, but the linkage is inconsistent.
The smallest genuine closure is a **pointer-only corrective-action evidence index inside the same
conformance map**, seeded with real incidents and linking to the existing plan/debug/commit/test
artifacts. It must not copy their narratives.

Repository context read for this research included `.planning/ROADMAP.md`,
`.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `CLAUDE.md`,
`.planning/design/iso9001-qms-layer.md`, `.planning/design/agent-eval-gate.md`, the Phase 1/3.6/7/8
plans, validation and verification artifacts, the current audit/skill/eval/DLQ implementations and
tests, `docs/README.md`, the relevant ADRs, and the current playbooks/watcher configuration.

## Recommendation

Create a single artifact, recommended at
`docs/governance/iso-9001-conformance-map.md`, with these sections:

1. scope, edition, and claim boundary;
2. evidence-status vocabulary;
3. the clause-to-evidence matrix;
4. explicit non-applicability/not-assessed decisions;
5. genuine gaps and their disposition;
6. a pointer-only corrective-action evidence index;
7. review triggers and verification commands.

Use stable file paths plus symbol/section names, not line numbers. Point to live data/query surfaces
where the evidence is a runtime record. Point to verification reports or summaries only when the
claim is historical/live and cannot be reproduced offline. The conformance map is an index over
the existing system, never the system of record itself.

No new dependency is warranted. No new Convex table is warranted. No QMS SaaS or generated binder
is warranted. A small code change is justified only if planning discovers that one of the mapped
claims cannot be verified using an existing command; do not pre-commit to a new parser or checker.

## Standards Baseline and Claim Boundary

### Current baseline

As of 2026-08-10, ISO still identifies ISO 9001:2015 as the current fifth edition, while a revised
edition is expected in 2026. ISO 9001:2015/Amd 1:2024 applies to the 2015 edition and adds climate
consideration to clauses 4.1 and 4.2. Therefore the document should name its baseline as:

> ISO 9001:2015, including Amendment 1:2024, evidence-alignment foundation

The phase requirement says “ISO 9001:2015”; acknowledging the applicable 2024 amendment is
maintenance of that baseline, not scope expansion. The map should include a review trigger when the
next edition is published, but Phase 24 must not attempt to anticipate or conform to unpublished
requirements.

Authoritative sources:

- [ISO 9001:2015 standard page](https://www.iso.org/standard/62085.html) — current edition,
  standard purpose, topic groups, certification boundary, and revision status.
- [ISO 9001:2015/Amd 1:2024](https://www.iso.org/standard/88431.html) — amendment applicability and
  publication status.
- [ISO/IAF climate amendment communiqué](https://committee.iso.org/files/live/sites/jtcg/files/news/Joint%20ISO-IAF%20Communique%20re%20Climate%20Change%20Amds%20to%20ISO%20MSS%20Feb%202024a.pdf)
  — the amendment's intent for clauses 4.1 and 4.2.
- [ISO 9001 Auditing Practices Group](https://committee.iso.org/home/tc176/iso-9001-auditing-practices-group.html)
  — non-normative auditing guidance and explicit warning that its papers are not additional
  requirements.

### Hard claim boundary

The map must repeat the already-adopted boundary in
`.planning/design/iso9001-qms-layer.md`:

- ISO certification applies to an organization's management system; embedding principles in a
  product does not certify Pikar or any customer.
- Permitted language is limited to careful evidence-alignment phrasing such as “built on ISO
  9001:2015 principles” or “supports quality-management practices.”
- The artifact is not a certificate, audit report, declaration of conformity, or substitute for an
  accredited certification audit.
- Full Pikar-company certification readiness is a separate organization-wide project. Clauses
  without repository evidence are marked not assessed, not silently excluded and not fabricated.

This scope statement is itself a genuine missing control. Without it, a technically accurate table
can still be misused as a global conformity claim.

## What the Repository Actually Proves

### Audit, traceability, and retained records

| Evidence source | What it proves | Limitation that must remain visible |
|---|---|---|
| `CLAUDE.md` §§3–4 | Binding insert-only and redaction-safe audit rules | A policy statement is supporting evidence; implementation/tests prove operation |
| `docs/decisions/002-insert-only-audit.md` | Accepted architecture decision, alternatives, and consequences | ADR records intent; it is not runtime evidence |
| `packages/backend/convex/audit.ts` (`log`) | Sole internal insert surface; timestamped tenant/correlation/event/actor/payload rows | `payload` validator is `v.any()` at the database boundary; safety also depends on caller controls/tests |
| `packages/contracts/src/audit.ts` (`AuditPayload`) | Flat refs/hashes/counts/flags contract, no nested objects | Type safety does not cover dynamically constructed/untyped callers by itself |
| `packages/backend/convex/auditImmutability.test.ts` | No audit patch/replace/delete and no public writer | Static scope does not prove every desired event is logged |
| `packages/backend/convex/schema.ts` (`audit`, indexes) | Identification and traceability by tenant, time, correlation | Operational copy remains mutable to deployment administrators; true retention is external |
| `packages/backend/convex/worm.ts`, `wormCursor.ts`, `packages/core/src/retention.ts` | Deterministic incremental S3 Object Lock export, checksum, retention, advance-after-write | With `WORM_BUCKET` unset the path deliberately skips; real Object Lock durability/delete refusal remains owner-deferred in Phase 7 evidence |
| `.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md` | Reproducible offline proof plus explicit manual-only WORM gap | Must not convert “code implemented” into “archive operational” |

This is strong evidence for 7.5 and traceability controls, conditional evidence for preservation, and
supporting evidence for controlled service provision. The conformance map must label WORM status
**conditional/unverified in real infrastructure** unless newer live evidence exists at execution
time.

### Design, change control, and organizational knowledge

| Evidence source | What it proves | Limitation that must remain visible |
|---|---|---|
| `.planning/REQUIREMENTS.md` + `.planning/ROADMAP.md` | Identified product requirements, phase ownership, success criteria, and traceability | Requirements can drift; the map should cite current requirement IDs and verification evidence |
| `.planning/phases/*/*-PLAN.md` | Design/development planning, inputs, tasks, must-haves, verification actions | Quality varies by phase; a plan is intent, not completion |
| `.planning/phases/*/*-SUMMARY.md` | Implemented changes, commits, test results, deviations | Historical report; corroborate critical claims with code/tests |
| `.planning/phases/*/*-VALIDATION.md` | Planned test architecture and sampling | Several old files still say draft/pending after execution; do not treat frontmatter alone as current truth |
| `.planning/phases/*/*-VERIFICATION.md` | Goal-backward verification against requirements/artifacts/wiring | Verification is not ISO 9001 clause 9.2 internal audit unless an actual QMS audit program exists |
| `docs/decisions/*.md` + `docs/README.md` | Significant decisions are recorded; accepted ADRs are immutable and superseded rather than rewritten | Git technically permits edits; discipline and review history are the control |
| `docs/playbooks/*.md` + `docs/playbooks/TEMPLATE.md` | Operational knowledge, invariants, safe-change instructions, exact verification commands, known gaps | Some playbooks have long/repeated “Last verified” histories; freshness claim must be checked, not assumed |
| `docs/playbooks/watch.json` + `scripts/check-playbooks.mjs` + `.claude/settings.json` | Changed watched code blocks agent completion until the matching playbook is touched; uncovered new code is surfaced | Enforcement is agent-hook scoped and fails open on tool/Git errors; it is not a universal merge gate for human or non-Claude changes |
| Git history (`git log`, commits referenced by summaries) | Change identity, chronology, author/commit trace, rollback substrate | A commit alone does not prove review/approval or fitness |

This is strong evidence for 7.1.6, 7.5, 8.3, and 8.5.6 within the software/product scope.
The map must not claim that the Stop hook is a universal organization-wide document-control system.

### Skill versioning, evaluation, release, and rollback

| Evidence source | What it proves | Limitation that must remain visible |
|---|---|---|
| `docs/decisions/003-skill-registry-for-prompts.md` | Accepted versioned-registry design and fail-closed loader | Architecture record, not operation |
| `packages/backend/convex/schema.ts` (`skills`) | Name, version, immutable body-by-practice, status, evidence, creation time | Status/evidence are mutable by intended design |
| `packages/backend/convex/skills.ts` | New body becomes a new version; gated edits become candidates; shared eval gate; owner activation; rollback via prior version | First seed becomes active; non-gated skills activate without the golden gate; the map must scope its claim to gated candidates |
| `packages/backend/convex/skills.test.ts` | Immutability, one-active-row, gate refusal, evidence pinning, owner/eval independence, rollback exemption | Unit proof does not prove a particular live candidate passed |
| `packages/backend/scripts/run-eval-golden.mjs` + `eval-cases/*.json` | Closed state-based expectations, cost cap, no-approve/no-send posture, version pinning, evidence write on green full run | Live-model runs are on demand and can fail/fluctuate; filtered diagnostic runs are not the gate |
| `.planning/phases/03.6-agent-eval-gate/03.6-VERIFICATION.md` | Historical live 15/15 and candidate-refuse/evaluate/activate/rollback cycle | Historical version only; do not use it as evidence for a later candidate |
| `docs/playbooks/skill-registry.md` | Current operational procedure, version-collision warning, candidate/eval/activate/rollback flow | Large append-only history contains deferred/unpaid gates; read current active/candidate state before making a release claim |
| `packages/backend/convex/opsSignals.ts`, telemetry/audit/DLQ reads | Production performance monitoring using existing records | Monitoring supports 9.1; it is not release authorization by itself |

This is direct evidence for 8.5.6 and, for **gated candidate skill versions only**, 8.6. It is
supporting evidence for 9.1 and 10.3. The exact release claim must say which artifact/version/run and
who authorized activation. A generic statement that “all skills are eval-gated” is false.

### Nonconformity, containment, correction, and improvement

| Evidence source | What it proves | Limitation that must remain visible |
|---|---|---|
| `packages/backend/convex/deadLetter.ts` | Workflow/per-recipient failure becomes a DLQ row plus audit, notification, request/telemetry terminal state | Failure capture is not cause analysis |
| `packages/backend/convex/deadLetters.ts` + tests | Tenant-scoped operator visibility and idempotent new-to-resolved transition | `markResolved` records no cause, correction, corrective action, effectiveness result, or approver; replay is absent |
| `packages/backend/convex/notifications.ts` + tests | In-app record is written before best-effort external notification | Notification proves awareness, not resolution |
| `docs/playbooks/audit-dead-letter.md` | Failure process, invariants, smoke commands, and explicit known gaps | Playbook knowledge is not a per-incident corrective-action record |
| `.planning/debug/resolved/*.md` | Some defects have durable diagnosis/root-cause records | Coverage is not systematic |
| Phase gap-closure plans/summaries/verification, e.g. Phase 19 plans 19-10..19-13 | Real defects were measured, root-caused, corrected, regression-tested, and documents corrected | Linkage is distributed and must be indexed; not every DLQ row follows this path |
| `feedback`, optimizer eligibility, SkillOpt candidate flow, golden eval, rollback | Evidence-driven continual-improvement loop | The optimizer ships dormant and some historical candidates/gates are explicitly unpaid |

ISO/IAF guidance on reviewing nonconformity closure distinguishes correction, cause analysis, and
corrective action; effectiveness must be verified. See the official
[Nonconformity – review and closing guidance](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20General/APG-ReviewNonconformity2015.pdf).
The APG digital-process guidance also highlights the ability to link nonconforming outcomes to
corrective actions: [Auditing Digital Processes](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20General/APG-Digital_Processes.pdf).

The smallest honest 10.2 gap closure is therefore an index row with links for:

- nonconformity/effect observed;
- immediate correction/containment;
- cause analysis;
- corrective action (recurrence prevention, if warranted);
- effectiveness evidence;
- final disposition/owner.

Each cell points to the existing incident/plan/commit/test/verification artifact. The map must not
copy the incident story or create another mutable case store.

## Prescriptive Clause-to-Evidence Model

The downstream plan should implement the following minimum matrix. “Relevant” means relevant to
the defined **software product design, controlled behavior release, and governed service-operation
scope**, not every clause required for organization-wide certification.

| Clause | Required mapping | Evidence status to start with | Planning instruction |
|---|---|---|---|
| 4.1–4.3 | Repository/product context, interested-party constraints, scope and claim boundary; acknowledge Amd 1:2024 | Partial | Add the explicit scope/claim boundary. Record climate relevance as considered, with a short rationale; do not invent environmental objectives |
| 4.4 | GSD lifecycle + playbooks/ADRs + governed runtime as interacting processes | Supporting | Describe interactions by links; do not redraw a second process manual |
| 5.1–5.3 | Leadership, policy, responsibilities | Not assessed | Owner approvals and `requireOwner` are product controls, not a company quality policy or complete QMS responsibility model |
| 6.1–6.3 | Risks/opportunities, measurable phase objectives, planning of changes | Supporting/partial | Map guardrails, roadmap criteria, plan risks/must-haves, ADRs, and change plans. Do not create a risk register solely to fill a clause |
| 7.1.6 | Organizational knowledge | Direct within repo scope | Map playbooks, ADRs, summaries, graph navigation, and known-gaps sections |
| 7.2–7.4 | Competence, awareness, communications | Not assessed | Do not infer personnel competence from tests or docs |
| 7.5 | Documented information and control | Direct/partial | Map Git, ADR immutability, playbook watcher, audit log, WORM design. Keep universal-hook and live-WORM limitations explicit |
| 8.1 | Operational planning and control | Direct within product scope | Map success criteria/validation plus approve/guardrail/execute flow; acceptance criteria must be identified before execution |
| 8.2 | Product/service requirements | Direct/supporting | Map REQUIREMENTS, phase context/design records, roadmap traceability, and owner UAT decisions |
| 8.3 | Design and development | Direct | Map plan inputs/controls/outputs/changes, ADRs, tests, summaries, and verification. ISO APG guidance confirms software/service design remains design and development |
| 8.4 | External providers | Partial | Map pinned dependencies/provider ADRs and adapter verification only where evidence exists; do not claim a complete supplier-management system |
| 8.5.1–8.5.2 | Controlled service provision; identification/traceability | Direct within runtime scope | Map plan approval, closed action types, tenant/correlation IDs, skill version attribution, audit/telemetry |
| 8.5.6 | Control of changes | Direct | Map immutable skill versions/status flips/evidence/rollback and code ADR/playbook/Git controls |
| 8.6 | Release of products/services | Direct for gated skill candidates; supporting for code | Map golden-run evidence + owner activation for gated skills and CI/phase verification for code. State exceptions (bootstrap/ungated skills; deployment not automated) |
| 8.7 | Nonconforming outputs | Direct/supporting | Map fail-closed refusals, terminal states, DLQ, suppression, and no-send tests |
| 9.1 | Monitoring, measurement, analysis, evaluation | Direct/supporting | Map telemetry, ops signals, eval results, feedback, DLQ and cost; identify measurement windows and known unknowns |
| 9.2 | Internal audit | Not evidenced | Tests and GSD verification are not an internal QMS audit program. Record as future company-certification work, not Phase 24 build scope |
| 9.3 | Management review | Not evidenced | Owner checkpoints are change approvals/UAT, not a complete management review with required inputs/outputs |
| 10.2 | Nonconformity and corrective action | Partial; genuine linkage gap | Map detection/containment plus real GSD root-cause/fix/effectiveness artifacts; add the pointer-only evidence index |
| 10.3 | Continual improvement | Supporting/direct in behavior-change scope | Map feedback -> candidate -> eval -> owner activation/rollback and roadmap gap-closure history; preserve dormant/unpaid-gate caveats |

ISO's official service-organization guidance warns against dismissing design/development merely
because the output is a service, and requires objective justification for non-applicability:
[APG Service Organizations guidance](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20to%20ISO%209001%202015/APG-ServiceOrganizations2015.pdf).
The detailed 8.3 mapping should follow the official APG
[Design and Development Process guidance](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20to%20ISO%209001%202015/APG-Design%26Development2015.pdf)
without copying its text.

## Standard Stack

### Core

| Concern | Use | Why |
|---|---|---|
| Canonical conformance artifact | Markdown under `docs/governance/` | Reviewable in Git, linkable, consistent with ADR/playbook practice |
| Evidence sources | Existing code, tests, runtime tables/queries, playbooks, ADRs, GSD artifacts, Git commits | These are the actual system; the map only indexes them |
| Change history | Git | Already supplies chronology, identity, diffs, and rollback substrate |
| Verification | Existing Vitest suites, eval runner self-check/live gate, smoke scripts, `check-playbooks.mjs`, targeted `rg`/path checks | Reuses proven rails and avoids a bespoke compliance engine |
| External interpretation | ISO and ISO/IAF primary sources | Avoids unsourced clause folklore and consultant-template cargo cults |

### No new stack

Do not add a QMS SaaS, database table, schema, package, Markdown generator, policy-as-code DSL, or
third-party ISO checklist dependency for this phase. The repository is already the controlled
information system. A generated PDF/binder would immediately create a second copy with a drift
problem.

## Architecture Patterns

### Pattern 1: Pointer map, not evidence duplication

Each row should use this shape:

```markdown
| 8.5.6 | Control of changes | Direct (defined scope) |
| `packages/backend/convex/skills.ts` — `activateSkillVersion`, `seedSkills`;
  `docs/decisions/003-skill-registry-for-prompts.md`;
  `docs/playbooks/skill-registry.md` |
| New skill bodies are new rows; gated candidates require version-pinned passing evidence;
  prior active versions remain rollback targets. |
| Scope caveat: first seed and explicitly ungated skills do not use the golden gate. |
| `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts` |
```

The final table can be formatted more compactly, but every row needs: clause, status, artifact,
actual control, limitation/gap, and verification method.

### Pattern 2: Status is a bounded vocabulary

Use only:

- `Direct — defined scope`
- `Supporting`
- `Partial — gap named`
- `Not assessed — organization-wide`
- `Not applicable — justified`

Avoid percentages or maturity scores. They imply measurement precision the project does not have.
Do not use `Compliant` as a row status; evidence alignment is not a certification verdict.

### Pattern 3: Evidence hierarchy

Prefer evidence in this order:

1. runtime record/read surface for a specific event/version/run;
2. executable test or smoke proving the control can fail;
3. implementation source and schema;
4. verification report with concrete run ID/commit/result;
5. playbook/ADR/policy statement;
6. plan or design intent.

A higher item can be supported by lower items, but a plan must never be cited as proof that its task
was implemented.

### Pattern 4: One gap, one disposition

Every `Partial` row must have exactly one of:

- close in Phase 24 with a minimal artifact/control;
- accept as a named limitation of this foundation;
- defer to company-certification readiness with an explicit reason/trigger;
- block the claim until live evidence exists.

This prevents both silent gaps and a speculative compliance backlog.

### Pattern 5: Corrective action links the real chain

The pointer-only 10.2 index should be seeded with at least two material, already-closed examples.
Good candidates are Phase 19's dropped trusted-clock/fabricated-address sequence
(`19-10` through `19-13`) and an eval-gate failure/fix sequence with a recorded run ID. Each index
row points to the observation, root cause, fix commit, regression/effectiveness test, and closure
record. Do not create an index row for every unit-test failure or every DLQ event; only material
nonconformities needing corrective action.

### Pattern 6: Maintenance follows mechanism changes

The map's review triggers should be narrow:

- publication of the next ISO 9001 edition;
- change to the audit/WORM mechanism;
- change to skill candidate/eval/activation/rollback semantics;
- change to playbook/ADR/GSD change control;
- introduction of an actual internal-audit or management-review process;
- a new marketing/compliance claim.

Ordinary feature changes do not require a conformance-map edit when the mapped mechanism is
unchanged. This prevents the map becoming a high-churn shadow changelog.

## Don't Hand-Roll

- **Do not build a second audit or corrective-action table.** The audit/DLQ/GSD/Git artifacts are
  already the evidence planes. Add links, not rows in a new database.
- **Do not write an ISO clause engine or maturity scorer.** Applicability and sufficiency require
  judgment; a numeric score would launder opinion into pseudo-fact.
- **Do not reproduce the ISO standard text.** It is copyrighted and unnecessary. Paraphrase control
  intent and link to official sources; the owner/certification professional must use a licensed copy
  for an actual conformity assessment.
- **Do not generate a quality manual/PDF from the map.** That creates a stale parallel artifact.
- **Do not rename product UI or user workflows with ISO vocabulary.** The adopted design explicitly
  keeps clause language out of the solopreneur UI.
- **Do not turn every test failure into a formal nonconformity.** Use the corrective-action index for
  material failures where recurrence prevention/effectiveness evidence matters.
- **Do not retrofit new ceremonies solely to populate clauses 5, 7.2, 9.2, or 9.3.** Mark those
  organization-wide areas not assessed until a real certification/business need exists.
- **Do not claim WORM operation from the presence of `worm.ts`.** Require live bucket evidence or
  state the configured/unconfigured limitation.

## Common Pitfalls

### Pitfall 1: Clause-number cargo cult

An artifact is not evidence merely because its filename sounds similar to a clause. Explain the
actual control, its scope, and its verification. `audit` is primarily an operational trace, not an
ISO internal audit.

### Pitfall 2: Equating tests with clause 9.2 internal audit

Tests and GSD verification are excellent design/release evidence. An internal audit requires an
audit program with scope, criteria, frequency/methods, responsibilities, reporting, objectivity,
results, and follow-up. ISO/IAF's
[Internal Audits guidance](https://committee.iso.org/files/live/sites/tc176/files/PDF%20APG%20New%20Disclaimer%2012-2023/ISO-TC%20176-TF_APG-InternalAudit.pdf)
makes that distinction explicit. Phase 24 should record the gap, not relabel CI.

### Pitfall 3: Equating owner approval with clause 9.3 management review

Owner activation/UAT proves authorization for a release or phase. It does not automatically cover
the inputs, outputs, trends, resource decisions, and improvement decisions of management review.

### Pitfall 4: Treating “resolved” as corrective action

`deadLetters.markResolved` is a visibility-state flip. It carries no cause, action, or effectiveness
result. Cite GSD/debug/fix/test evidence for 10.2 and state where no such evidence exists.

### Pitfall 5: Overstating release control

The golden gate applies to gated candidate skill versions. Bootstrap v1 and deliberately ungated
skills follow different controls. Code CI proves build/test quality but does not deploy, and the e2e
suite is not universally in CI (`docs/playbooks/ci-gate.md`). Scope each 8.6 statement precisely.

### Pitfall 6: Taking document freshness on faith

Some `VALIDATION.md` frontmatter remains draft/pending after successful execution, and playbooks can
accumulate multiple historical `Last verified` lines. Prefer code/current tests and the latest
verification evidence. Never silently normalize contradictory evidence.

### Pitfall 7: Ignoring enforcement boundaries

`check-playbooks.mjs` is real, useful automation, but it is wired through Claude hooks and is
fail-open on tool/Git failure. Do not describe it as an unavoidable repository merge gate.

### Pitfall 8: Forgetting the 2024 amendment or near-term edition change

Name Amendment 1:2024 and add a re-baseline trigger. Do not guess at the unpublished 2026 edition.

### Pitfall 9: Path rot

Line-number citations rot immediately. Cite repo paths plus exported function/section names. A
Phase 24 verification pass should confirm that every local path in the final map exists.

### Pitfall 10: A compliance artifact that creates more maintenance than control

If the map starts duplicating playbook content, incident narratives, test outputs, or audit data,
stop. The correct artifact is a small index with explicit caveats.

## Concrete Planning Shape

### Plan 24-01 — Scope and evidence inventory

- Create the canonical map with the claim boundary, edition/amendment, status vocabulary, and clause
  applicability decisions.
- Populate the roadmap-mandated rows first: 7.5/8.5.1 audit spine, 8.5.6 skill versioning/rollback,
  7.5/8.3 playbooks/ADRs/GSD, 8.6 eval/release, and 10.2 DLQ/corrective action.
- Add supporting rows only where repository evidence is substantive; mark organization-wide areas
  not assessed.
- Do not touch production code.

### Plan 24-02 — Genuine-gap closure and anti-overclaim verification

- Add the explicit scope/claim boundary if not completed in 24-01.
- Add the pointer-only corrective-action evidence index and seed it with real closed incidents.
- Record WORM's live-infrastructure status from current evidence (verified or explicitly
  conditional), not from source presence.
- Add review triggers and exact verification commands.
- Run the evidence-source tests/smokes that can be run offline; record manual-only/live evidence as
  manual-only, never as passed.
- Update only existing governance documentation whose statements Phase 24 actually changes. Do not
  bump unrelated playbooks merely to satisfy a hook.

Two plans are sufficient unless execution discovers an actual missing control requiring code. If
that occurs, split one narrowly owned gap-closure plan; do not mix it into the mapping task.

## Validation Architecture

### Validation principle

Phase 24 validates two different things:

1. **map integrity** — claims have real, existing evidence and honest limitations;
2. **underlying control health** — the cited mechanisms still pass their own executable checks.

The phase does not need to rerun every historical UAT. It must sample each mapped evidence family,
use prior live evidence only when clearly dated/versioned, and leave live-only residuals open.

### Test infrastructure

| Property | Value |
|---|---|
| Document checks | PowerShell `Test-Path`, `rg`, Git diff/history |
| Backend controls | Vitest + `convex-test` through existing backend package scripts |
| Eval controls | `run-eval-golden.mjs --self-check`; live golden run only if a specific new gated candidate is being released |
| Operational controls | Existing smoke scripts; live WORM only with a real configured Object-Lock bucket |
| Playbook control | `node scripts/check-playbooks.mjs check` in the real changed-tree context |
| External review | Human review of claim boundary/applicability; licensed standard/certification professional for any conformity claim |

### Per-behavior verification map

| Behavior | Proof | Command / method | Expected result |
|---|---|---|---|
| Canonical map is singular | Search for ISO/QMS conformance artifacts | `rg -n -i "ISO 9001|conformance map" docs .planning/design .planning/phases/24-*` | One canonical operational map; older design/research records clearly remain design/history, not competing binders |
| Claim boundary is present | Static phrase review | `rg -n -i "not certified|not a certificate|does not certify|defined scope" docs/governance/iso-9001-conformance-map.md` | Explicit no-certification and defined-scope language |
| Required clause families are present | Static clause check | `rg -n "7\.5|8\.3|8\.5\.1|8\.5\.6|8\.6|9\.1|9\.2|9\.3|10\.2|10\.3" docs/governance/iso-9001-conformance-map.md` | Every mandated/direct and anti-overclaim row exists |
| Every local evidence pointer resolves | Enumerate backticked repo paths and `Test-Path` each; manually resolve symbol/section names | PowerShell read-only path check during the plan | Zero missing files; no line-number-only citations |
| Audit is insert-only | Static/unit tests | `pnpm --filter @pikar/backend exec vitest run convex/auditImmutability.test.ts convex/audit.test.ts` | Immutability/public-writer controls green; any known harness limitation named rather than hidden |
| WORM control is accurately stated | Unit plus current live-evidence review | `pnpm --filter @pikar/backend exec vitest run convex/worm.test.ts`; inspect `07-VERIFICATION.md` and any newer live record | Cursor/order/serialization control green; infrastructure status exactly matches available evidence |
| Skill version/change control works | Registry unit suite | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts` | Candidate gate, immutable body, evidence pin, owner boundary, and rollback cases green |
| Eval harness is structurally valid | Offline self-check | `node packages/backend/scripts/run-eval-golden.mjs --self-check` | Fixture grammar/floor/anti-vacuity checks pass without model spend |
| Current gated release claim is valid | Read live version/evidence, then full unfiltered gate only when Phase 24 changes/releases a gated skill | `pnpm eval:golden --skill <name>@<actual-version>` | Full run green and evidence pinned to exact version; filtered diagnostics never cited as release evidence |
| Playbook change-control mechanism still operates | Run checker against the actual Phase 24 tree and inspect hook wiring | `node scripts/check-playbooks.mjs check`; inspect `.claude/settings.json` | Exit 0 only when real watched-code obligations are discharged; boundary documented |
| DLQ visibility/control works | Targeted tests | `pnpm --filter @pikar/backend exec vitest run convex/deadLetters.test.ts convex/notifications.test.ts` | Tenant visibility, resolved transition, in-app floor, and no notification loop green |
| Corrective-action index is non-vacuous | Human evidence-chain review | For every seeded row, open observation, cause, action, effectiveness, and closure targets | At least two real chains; no copied incident narratives; no row relying only on `status: resolved` |
| No certification overclaim exists | Static scan plus human semantic review | `rg -n -i "ISO certified|ISO compliant|certified operations|fully conform" docs/governance/iso-9001-conformance-map.md` | No prohibited/unqualified claim; any occurrence appears only in an explicit prohibition |

### Manual-only verification

| Behavior | Why manual | Required disposition |
|---|---|---|
| Clause applicability and claim-boundary judgment | This is semantic/legal/compliance interpretation, not a syntax check | Owner reviews; a qualified ISO professional reviews before any external conformity statement |
| Real S3 Object Lock retention/delete refusal | Requires configured cloud infrastructure and credentials | Cite dated live evidence if performed; otherwise mark conditional/unverified |
| Organization-wide clauses 5, 7.2–7.4, 9.2, 9.3 | Evidence lives in company practices, people, and management activity, not the repo | Keep not assessed; do not fabricate completion in Phase 24 |
| Next-edition re-baseline | ISO 9001 revision is not yet the phase baseline | Add trigger, not speculative mappings |

### Anti-vacuity gates

- A clause row with only a policy/playbook link and no actual control/evidence is `Supporting`, not
  `Direct`.
- A 10.2 row with only a DLQ/resolved link fails review.
- An 8.6 row with only `run-eval-golden.mjs` but no exact version/run/activation evidence cannot
  claim a specific release.
- A 7.5 preservation claim with only `worm.ts` and no configured live evidence must say conditional.
- A `Not applicable` row without a written applicability rationale fails review; prefer `Not
  assessed` when the truth is simply unknown/outside the foundation.
- The phase is not complete if the map says “compliant,” “certified,” or equivalent without the
  defined-scope limitation and independent assessment.

### Phase completion gate

Phase 24 is complete when:

1. one canonical map exists and all local evidence links resolve;
2. every roadmap-mandated mapping has an actual artifact, limitation, and verification method;
3. organization-wide clauses are honestly bounded;
4. 10.2 has real corrective-action chains, not only failure records;
5. executable samples for audit, skills, eval harness, playbook control, DLQ, and notifications are
   green or explicitly documented as currently blocked/pre-existing;
6. WORM operational status is not overstated;
7. no second binder/process/table was introduced;
8. GOVN-02 is marked complete only after the finished map is reviewed against these gates.

## Confidence Assessment

| Area | Confidence | Basis |
|---|---|---|
| Repository evidence inventory | High | Direct source, tests, playbooks, ADRs, verification reports, and Git history inspected |
| Roadmap-mandated clause mappings | High | They align with actual mechanisms, with the caveats above |
| 10.2 gap diagnosis | High | DLQ schema/API lacks cause/action/effectiveness; official ISO/IAF guidance supports the distinction |
| Organization-wide applicability | Medium | Correctly bounded as not assessed; full judgment requires company evidence and a licensed standard |
| Current ISO edition status | High as of 2026-08-10 | Official ISO pages show 2015 + Amd 1:2024 current and revision in progress |
| Certification readiness | Not assessed | Explicitly outside this phase and cannot be inferred from the repository |

## Sources

Primary external sources only:

- [ISO 9001:2015](https://www.iso.org/standard/62085.html)
- [ISO 9001:2015/Amd 1:2024](https://www.iso.org/standard/88431.html)
- [ISO/IAF climate amendment communiqué](https://committee.iso.org/files/live/sites/jtcg/files/news/Joint%20ISO-IAF%20Communique%20re%20Climate%20Change%20Amds%20to%20ISO%20MSS%20Feb%202024a.pdf)
- [ISO 9001 Auditing Practices Group library and disclaimer](https://committee.iso.org/home/tc176/iso-9001-auditing-practices-group.html)
- [APG Auditing Digital Processes](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20General/APG-Digital_Processes.pdf)
- [APG Design and Development Process](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20to%20ISO%209001%202015/APG-Design%26Development2015.pdf)
- [APG Service Organizations](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20to%20ISO%209001%202015/APG-ServiceOrganizations2015.pdf)
- [APG Internal Audits](https://committee.iso.org/files/live/sites/tc176/files/PDF%20APG%20New%20Disclaimer%2012-2023/ISO-TC%20176-TF_APG-InternalAudit.pdf)
- [APG Nonconformity — review and closing](https://committee.iso.org/files/live/sites/tc176/files/documents/ISO%209001%20Auditing%20Practices%20Group%20docs/Auditing%20General/APG-ReviewNonconformity2015.pdf)
- [ISO 10013:2021 documented-information overview](https://www.iso.org/standard/75736.html)

---

## RESEARCH COMPLETE

The planning answer is: build one narrow evidence index over the system that already exists, state
its scope and limitations, and close only the real 10.2 linkage/claim-boundary gaps. Do not create a
parallel QMS. The validation architecture above gives the planner concrete commands, manual-only
boundaries, and anti-vacuity gates for GOVN-02.
