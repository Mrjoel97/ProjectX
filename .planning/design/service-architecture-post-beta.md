# Service architecture, post-beta — design note

- **Status**: Design note (NOT an ADR — nothing here is accepted; each item needs its own phase and, where marked, its own ADR)
- **Date**: 2026-08-24 (owner + agent session, working branch `feat/27-02-pack-contracts`, STATE at Phase 27, 76%)
- **Trigger**: owner reviewed the knowledge graph and asked whether tools, RAG, skills, workflow generation, research, marketing, finance, sales, workspace and auth should each become "a service"
- **Verdict**: the vision is feasible on the current foundation; the *sequence* is what matters. **Finish Phase 25 first.** Nothing below is in the remaining 24% of v2.0 except Phase 21.

## 1. "Service" means a boundary, never a deployment

A separately-deployed process is rejected outright: it breaks the `tenantQuery`/`tenantMutation`
wrapper (CLAUDE.md §2), loses Convex transactions, and adds network failure modes for a solo team
pre-launch. "Service" here means: **owns data nobody else owns, enforces a rule that must hold
everywhere, has one entry door and its own tests** — same deployment, `packages/*` + thin adapter.

Test for admission: two yeses (owns data AND enforces an invariant) = service. Zero = it is a
workflow pack wearing a service costume.

## 2. The four tiers (the framework the owner's list was missing)

| Tier | What it is | Members |
|---|---|---|
| Identity | who is asking | auth, workspace, membership, roles |
| Capability | how work gets done | tool registry, retrieval (RAG), **research**, LLM gateway, cost, audit |
| Domain | what must stay true | finance (figure provenance), consent/suppression |
| Control loop | what runs over time, acting on the world | **marketing**, sales nurture |

A part in the wrong tier is what breaks later. Research is a *capability* (cross-cutting, every
workflow calls it), not a domain vertical. Marketing is a *control loop*, not a request/response
module — and control loops are where "durable and reliable" is actually decided.

## 3. Item-by-item verdicts

| Item | Verdict | Why (with the evidence) |
|---|---|---|
| **Tool registry** | YES — do first | `llm.ts` is 6,382 lines; `buildCockpitTools` takes 7 append-only positional args; grants derived 3× from `toolNames === undefined` (llm.ts ~L4336-4342). Registry = declared `{name, schema, handler, requires, grantedTo}`; caller filtering becomes a filter over declarations. Deletes the "param not threaded through both runAgentLoop and the web caller" defect class (clock-plane incident). |
| **Workflow packs → user-authored** | YES — this IS Phase 21 | `packages/core/src/workflowPacks.ts` already has the declarative op vocabulary (`existing/missing/forbidden`), `toolsForWorkflowPack`, `packPreflight`, and `WorkflowManager` durability. The one gap: `WORKFLOW_PACKS` is a compile-time const; user workflows must be DB rows (the §5 skills migration pattern) plus a **compose-time validator** (every op id in vocabulary, every tool in registry + granted, no forbidden op). Agent composes over a fixed vocabulary of verified steps; it never invents steps. Validation at save time replaces the eval gate for user-authored packs. |
| **RAG** | YES, later | 8 `vault*.ts` files ≈ 5k lines. One door `retrieve(tenantId, query, scope) → {chunks, citations, provenance}` = one place provenance is stamped (the recurring laundering bug). |
| **Skills** | NO — leave alone | Already the most service-shaped thing (rows, versions, activation, gate). Its bugs are operational (per-deployment evidence, version collisions), not structural. |
| **Research** | YES as a capability — but it is a BUILD, not an extraction | `research.ts` is 221 lines, owns zero tables, and ships a footer saying findings are "NOT source-audited … never an established fact" because search is provider-executed. The owner's target ("decisive building blocks, self-validating, perpetual, reusable across marketing/finance/pages") requires **system-executed fetch** (we choose sources, fetch, keep text) + a findings store with `observedAt` and a staleness policy. Generalize `packages/core/src/financeClaim.ts` (`FigureOrigin`, `FigureActor`, `FigureConfidence`, `isNewerThan`) into a shared claim/provenance module rather than a parallel one. `research.ts` records "no researchFindings table" as a deliberate non-decision to revisit with a plan — this is that plan's seed. |
| **Marketing** | YES as a control loop — LAST | Owner's loop: plan → connect channels → publish variants → A/B → measure → cut/double-down → capture emails → pipeline. Zero social connectors exist (only `gmailTokens`, `microsoftCalendarTokens`); no campaigns/channels/metrics tables. Gated on (a) the **legal entity** (ADR-015: Meta/LinkedIn APIs require it; "not started"), (b) connectors, (c) an **autonomy ADR** — see §4. Without measurement the loop is a document generator. |
| **Finance** | YES — strongest domain candidate | Owns `financeInputs`, `spendEvents`, `spendCoverage`, `goals`. Real invariant: a figure's provenance is never laundered (agent-authored ≠ owner's word). Boundary exists to make the rule impossible to route around. |
| **Sales pipeline** | YES for contacts+consent; NO for "pipeline" | Owns `contacts`, `followUps`, `suppressions`, `proposals`. Invariant: never contact a suppressed address from any path. Stages/deal value/close dates do not exist — a data model to design, not a service to extract. |
| **Workspace + auth** | YES — ONE project, do early | `requireScope` returns `tenantId = String(userId)` (lib/functions.ts). 46 tables, 141 `tenantId` refs, 86 tenant-keyed indexes; no `workspaceId`/`memberId`/role anywhere. Migration: add `workspaces` + `memberships`; `requireScope` resolves userId → membership → workspaceId; existing tenants get `workspaceId = ownerUserId` (byte-identical, zero data movement). Model **type / role / plan as three separate fields** from day one. Check `@convex-dev/auth@0.0.94` (pinned pre-1.0) supports org membership BEFORE committing. Cost rises with every real tenant — do it while small, and alone (not overlapped with Phase 21). |

Also by the same test, not on the owner's list: **approvals gate** (the SOLE
`workflow.start(deliverApprovedPlan)` site is enforced by comment + grep today; make it structural),
**cost/budget** (`preCall`/`recordSpend`, half-built), **connector tokens** (a token never leaves
its tenant), **audit** (already done — do not touch).

## 4. The one decision that gates the most expensive work: autonomy

The marketing loop requires the agent to act on the world repeatedly without asking. The current
containment is the opposite — one human Approve before anything external. **ADR-015 §2 explicitly
keeps approve-once-for-many and standing rules deferred and names them a trap.** Building the loop
means superseding ADR-015 with a new ADR, on purpose. Recommended shape: **standing approval with
caps** — the user approves a *campaign* (budget, channel set, date range, variant ceiling); the loop
acts freely inside and stops at the edge. Alternatives: approve-per-action (kills the loop's value);
approve only the risky class (publish needs approval, measure/cut does not). Write the ADR before
any connector code.

## 5. What is missing (data)

| Domain | Owns today | Missing |
|---|---|---|
| Research | nothing (findings land as `vaultDocuments`) | findings table, source-audit trail, `observedAt` + staleness policy |
| Marketing | nothing (`content.ts`, `contentAudit.ts` only) | channel connections, posts, variants, experiments, metrics, forms, leads |
| Finance | `financeInputs` + provenance | ledger, time series, connector actuals |
| Sales | contacts, proposals, followUps, suppressions | stages, deal value, close dates |
| Workspace/auth | nothing | workspaces, memberships, roles |

Three of five have no data to own. A boundary drawn before the data exists is a guess.

## 6. Why reliability is not an architecture problem here (the part to remember)

STATE.md, 2026-08-23: Phase 27 is blocked on a **$0 OpenAI key** — six packs built, all
`candidate`, all dark, `listPacks` returns nothing. Phase 25 (private beta productionization) is
**0 of 13 plans**. `citationCoverage`/`unsupportedClaimRate` report `not_applicable: no_data` in
production — there is no production signal for whether a user got a good answer.

Every reliability failure in this repo's memory has been a *verification* failure with a green
suite over it (26-14: 13 defects behind green; clock plane dead in prod; provenance laundering ×3),
never an architecture failure. Six new boundaries multiply the surface where that happens.

**Make the honesty the product**: `missing()` ops, the research limits footer, `probeSources`,
`declareUnsupported` — the system says what it could not do. Reliability = "you always know what
this answer rests on," not "the answer is always right."

Define 2–3 production reliability metrics before any of §3: grounded-claim rate, refusal-honesty
rate, plan-approved-without-edit rate.

## 7. Recommended order

1. Top up the key; run the six pack evals; activate (hours, not weeks).
2. **Phase 25** — one real user, one real result, in production.
3. Workspace identity + membership + roles (§3, one project, alone).
4. Tool registry.
5. Phase 21 — user-authored routines over the pack vocabulary + compose-time validator.
6. Research engine (system-executed fetch, findings store, generalized claim provenance).
7. Autonomy ADR → legal entity → channel connectors → marketing control loop.

Habit to keep for every structural step: diff the plan's `files_modified` against
`git diff --stat`; mutation-test the assumption, not the guard.
