# Playbook: Workflow Packs (curated knowledge-work pilot)

> Last verified: 2026-08-23 (27-02 — the contract half only. This plan built the registry, the
> candidate-only publication door, the pack activation gate, the `workflowPackEvents` table and the
> offline fixture validator. **No pack body exists yet, no pack row exists in any deployment, and
> nothing is discoverable.** 27-04/05/06 write the bodies and fixtures, 27-07 binds the runtime,
> 27-08 publishes the six candidates on DEV, 27-09 runs the browser gate and the owner checkpoint.)
>
> Build history: `.planning/phases/27-curated-knowledge-work-pack-pilot/` · Related ADRs: ADR-007
> (skill text in the DB, capability authority in code)

## Purpose

Six curated knowledge-work workflows — Business Pulse, Campaign Plan, Customer Complaint Response,
Sales Call Prep, Process/SOP Builder and Brand Review — adapted from Anthropic's upstream
knowledge-work plugins into native Pikar packs. A pack is not a plugin and not a second agent
runtime: it is one skill-registry body plus a code-owned tool allow-list, run through the existing
agent loop. The pilot proves the pack model using capabilities Pikar already owns, and ships every
pack DARK until it has earned three independent kinds of evidence.

## Key files

**Pure packages**
- `packages/core/src/workflowPacks.ts` — the registry: closed pack ids, the operation matrix, the
  derived tool grant, the preflight computation, and the three pack-gate predicates.
- `packages/core/src/workflowPacks.test.ts` — whole-registry assertions, plus the cross-file scans
  that pin the registry to `convex/llm.ts` and `convex/schema.ts`.
- `packages/core/src/tenantData.ts` — classifies `workflowPackEvents` (`tenant_owned`).

**Backend**
- `packages/backend/convex/schema.ts` — `workflowPackEvents`, and the `provenance` /
  `browserEvidence` columns on `skills`.
- `packages/backend/convex/skills.ts` — `publishPackCandidate`, `recordPackBrowserEvidence`,
  `assertPackActivationEvidence`, and the pack branch of `planGlobalActivation`.
- `packages/backend/convex/skills.test.ts` — the `workflow-pack candidate lifecycle` block.

**Scripts**
- `packages/backend/scripts/run-workflow-pack-evals.mjs` — fixture schema, validator and
  `--self-test`. `pnpm --filter @pikar/backend eval:packs` is the wrapper.
- `packages/backend/scripts/workflow-pack-fixtures/` — the corpus (empty until 27-04/05/06).

## Dependencies & blast radius

Run `graphify query "workflow packs"` for the current subgraph. Couplings graphify cannot see:

- **`llm.ts` derives two grants from the ABSENCE of an allow-list.** `grantDispatch` and
  `grantSkillAuthoring` are both `toolNames === undefined`. Changing either expression silently
  changes what every pack can do. `workflowPacks.test.ts` scans for both literals.
- **The tool record is filtered by exact name and never widened.** An allow-list entry that is not
  a key of `buildCockpitTools` is silently dropped — no throw, no log, just a smaller tool set.
  The registry-to-`llm.ts` name scan is the only thing that catches a typo.
- **`workflowPackEvents.packId` is a closed `v.literal` union.** A pack id with no literal makes the
  insert throw inside an AI-SDK callback that swallows it: the event vanishes in prod while the
  suite stays green. Pinned by a source scan in `workflowPacks.test.ts`.
- **The runner imports the registry as TypeScript.** Node >= 22.6 strips types natively; CI's test
  job pins Node 20 and never runs this script.

## Data flow

1. **Author** — 27-04/05/06 write a body to `packages/contracts/skills/pack-<id>.md` AND mirror it
   into `packages/contracts/src/skills/`, keyed to this registry's operation vocabulary.
2. **Publish** — `internal.skills.publishPackCandidate({name, body, provenance})` mints
   `status: "candidate"`. There is no branch in that mutation that can produce an active row.
3. **Evaluate** — the pack runner scores the candidate and `skills:recordEvalEvidence` pins the
   result to the exact `(name, version)`.
4. **Browser-gate** — 27-09 drives the candidate in an authenticated browser at two or more
   viewports and `skills:recordPackBrowserEvidence` records it, again pinned to the exact version.
5. **Activate** — `skills:activateSkill` (or the owner's `activateCandidate`) routes through
   `planGlobalActivation`, which calls `assertPackActivationEvidence`. All three planes must name
   this exact version or the flip throws `PACK_GATE`.
6. **Run** — 27-07 resolves the pack id, computes `packPreflight` in code, and calls the agent loop
   with `toolsForWorkflowPack(packId)` as `toolNames`.
7. **Measure** — 27-03 writes `workflowPackEvents` rows: lifecycle, plan decisions, missing-source
   surprise, recommendation impressions. Refs, enums and counts only.

## Invariants — what must never break

1. **No pack body is ever in `SEEDS`.** `package.json`'s `dev` script runs `skills:seedSkills` on
   every dev boot, and its `rows.length === 0` branch inserts `v1, active` regardless of gating.
   Enforced: `skills.test.ts` "a dev boot leaves ZERO pack rows".
2. **First publication is always a candidate.** Enforced: `skills.test.ts` "first publication mints
   a CANDIDATE at v1". Mutation-verified 2026-08-23 — flipping the literal to `"active"` reddens
   four tests.
3. **Activation needs provenance + eval + browser evidence, each pinning the exact version.**
   Enforced: `skills.test.ts` "activation refuses a pack candidate missing ANY of its three
   evidence planes" (each plane asserted alone as the blocker) and "evidence pinning a DIFFERENT
   version cannot activate this one". Mutation-verified — disabling the gate reddens both.
4. **Rollback stays exempt.** `archived` / `rolled_back` rows were active before and skip the gate
   BY STATUS. Rollback must work mid-incident and must never be blocked by a broken harness.
   Enforced: `skills.test.ts` "rollback to a previously-active pack version needs no evidence".
5. **Pack names are never in `GATED_SKILLS`.** `run-eval-golden.mjs` derives its `--skill`
   allow-list from that array and drives `runCockpitAgent` over TEXT fixtures; a gated pack name
   would mint candidates no eval run could certify. Enforced in both packages.
6. **The tool grant is derived from the `existing` operations, never typed twice.** A skill body is
   a DB row a candidate can change; it can never add a tool (ADR-007). Enforced:
   `workflowPacks.test.ts` whole-registry equality plus the derivation test.
7. **Packs are leaf agents.** No pack may name `dispatchResearch`, `dispatchMedia`, `proposeImage`
   or `authorSkillCandidate` — an allow-listed agent never receives them. Campaign Plan produces a
   plan; it does not orchestrate one.
8. **`webResearch` and `declareUnsupported` are granted as a pair.** `llm.ts` builds them under one
   flag and then filters by name, so listing search alone drops the structured refusal channel.
9. **Every pack declares at least one `missing` source, and every missing source names its unlock.**
   The honest-partial statement is the phase's primary deliverable, not a fallback. Enforced in the
   registry test and, at corpus level, by the fixture runner.
10. **`workflowPackEvents` holds refs, enums and counts only.** There is nowhere in the table to put
    text — that absence is the enforcement. It re-emits neither cost (`spendEvents`) nor latency
    (`telemetry.durationMs` / `agentSteps`).

## How to change safely

- **Adding a pack**: add the id to `WORKFLOW_PACK_IDS`, add a `v.literal` to
  `workflowPackEvents.packId` in the SAME commit, add the spec, then the body (both files) and
  fixtures. The registry test fails on each missing half in turn.
- **Widening a grant**: it is a privilege escalation, never a one-line edit. Add the `existing`
  operation that asks for the tool; the grant follows. Then update the whole-registry equality in
  `workflowPacks.test.ts` deliberately, and teach the tool in the pack's body — a granted tool a
  body never names is never called and nothing errors.
- **Changing a missing classification**: owner decision A (2026-08-23) forbids adding read tools to
  close a `missing` source inside Phase 27. Reclassifying is a phase-level decision.
- **Touching the activation gate**: re-run the two mutations recorded above. A gate that cannot be
  observed failing is not a gate.

## How to verify

```
cd packages/core && npx vitest run src/workflowPacks.test.ts     # registry, matrix, cross-file scans
cd packages/core && npx vitest run src/tenantData.test.ts        # the new table is classified
cd packages/core && npx tsc --noEmit                             # compile-time totality proofs
cd packages/backend && npx vitest run convex/skills.test.ts      # publication + gate + rollback
cd packages/backend && npx vitest run convex/isolation.test.ts   # tenant scoping of the new table
cd packages/backend && node scripts/run-workflow-pack-evals.mjs --fixtures-only --self-test
```

Never `pnpm --filter <pkg> test -- <name>`: the `--` is swallowed and the whole suite runs, so the
command reads green whether or not the named file exists. Never `node scripts/check-playbooks.mjs`
as a gate: it reads stdin at module top and every terminal path is `process.exit(0)`.

## Operational notes

- `pnpm --filter @pikar/backend eval:packs -- --fixtures-only --self-test` is the wrapper; it costs
  nothing and touches no deployment.
- Evidence lives on the skills ROW with an exact-version pin, and version numbers differ per
  deployment. **A DEV eval can never certify a PROD candidate.** Phase 27 is DEV-scoped throughout.
- A pack granted `listInbox` / `briefInbox` / `replyToMessage` receives them even with no Gmail
  grant: `runSpecialistTurn` does not pass `gmailEnabled` and the flag defaults true, so the refusal
  arrives at runtime as `mailboxUnavailable` rather than as tool absence. Fixtures must expect the
  conversational refusal, not a missing tool.
- `runSpecialistTurn` also does not pass `clientContext`, so any date-dependent tool takes its
  no-clock refusal. None of the six grants depends on a clock today; a future one would.
- `createDocument` is the only granted tool that persists a durable artifact with no approval gate
  (`insertCreatedDoc` fires inside the loop). Every other write stages `status: "proposed"` and
  waits for the human Approve arm.

## Known gaps & deferred work

- **`bodySha256` is shape-checked, not byte-checked, on the server.** A Convex mutation has no
  synchronous digest. `scripts/verify-knowledge-work-provenance.mjs --check` (27-08) is the
  bytes-level enforcement. Upgrade path: compute the digest in a publishing ACTION, where
  `crypto.subtle` is available, and pass it in as a checked argument.
- **Packs are absent from the owner governance report.** `reportsGovernance.activeSkills` iterates
  `REGISTRY_SKILL_NAMES`, which is `SEEDS.map(s => s.name)` — and keeping pack bodies out of `SEEDS`
  (invariant 1) keeps them out of that report. Surfacing them needs a deliberate second enumeration,
  not a `SEEDS` row.
- **The mirror from `packages/contracts/skills/*.md` to `packages/contracts/src/skills/*.ts` has no
  generator.** It is hand-written, and the only drift guards are two hand-maintained tables
  (`skillBodies.test.ts` and `skills.test.ts`). A pack body added to neither table has zero drift
  protection — 27-04/05/06 must add each body to one of them.
- **`workflowPackEvents` erasure is an OPEN owner question.** `tenant_owned` enrols the table in the
  tenant export and deletion walks, so erasure removes a tenant's pack events today and export
  returns them. Whether measurement rows should instead survive erasure the way `audit` does — at
  the cost of leaving an Art. 17 walk — is recorded in `packages/core/src/tenantData.ts` for the
  owner, not resolved here.
- **The fixture runner needs Node >= 22.6.** It imports the registry as TypeScript rather than
  regex-parsing it. CI's test job pins Node 20 and never runs the script.
- **No rollback-to-dark path exists.** `skills.ts` has one active-patch site and no owner-facing
  deactivate; the only dark path is `archiveSkill` via `npx convex run`, which ends a browser
  session. 27-09 owns that decision.
