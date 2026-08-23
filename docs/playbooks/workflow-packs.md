# Playbook: Workflow Packs (curated knowledge-work pilot)

> Last verified: 2026-08-23 (27-04 — **THE FIRST TWO PACK BODIES.** `pack-business-pulse.md` and
> `pack-campaign-plan.md` land as canonical `.md` + hand-derived `.ts` pairs, both registered in
> `skillBodies.test.ts`'s `bodies` array, with five fixtures each.
>
> **Business Pulse is the honest-partial contract's hardest case.** Its upstream source is almost
> entirely connector-driven — QuickBooks, PayPal, Square, HubSpot, Gmail, Slack — and Pikar can reach
> NONE of them. What survives is `readFinance` and `searchVault`, so the body's mandatory middle
> section is "What I could not see", and the pack is instructed never to state, estimate or imply a
> figure it did not read, and never to call one data point a trend.
>
> **Campaign Plan produces a document, and its body says so in its own second paragraph** — the
> boundary is enforced in code (no allow-listed agent can dispatch), and the body must not promise
> what the runtime cannot keep.
>
> **TWO CORRECTIONS TO EARLIER PLANS, both made here rather than worked around:**
> 1. `workflowPacks.test.ts` required "0 or 6 bodies, never a half corpus". That was wrong about how
>    this phase lands: 27-04/05/06 are three INDEPENDENT lanes writing TWO bodies each, so the rule
>    reddened the moment the first lane committed and made wave 2 unlandable. The per-body
>    "every granted tool is TAUGHT" check stays and now bites per body; completeness is enforced
>    where it can actually be satisfied — 27-01's manifest refuses a half-populated adapted set.
> 2. The fixture runner took ONE FILE PER CASE; 27-04/05/06 all name ONE FILE PER PACK in their
>    `files_modified`. The runner now reads each `<packId>.json` as an ARRAY of cases. Needle
>    uniqueness moved from file-keyed to case-keyed with it, because a file-keyed check stopped
>    seeing collisions between two cases in the same file — which is where they are now most likely.
>
> Gates proven red: a byte appended to a body (drift), a granted tool removed from a body (taught),
> a case in the wrong pack file, a `toolsForbidden` naming a tool the pack holds, and `--packs` for
> a lane that has not landed yet.)
>

> Last verified: 2026-08-23 (27-03 — **THE MEASUREMENT PLANE.** `packages/core/src/
> workflowPackMetrics.ts` defines every success measure as a pure function over the closed event
> vocabulary, and `packages/backend/convex/workflowPackEventLog.ts` is the SOLE write surface for
> the `workflowPackEvents` table 27-02 created. No table, schema or classification change here —
> 27-02 owns those.
>
> **A measure with no data says so.** Every ratio returns `not_applicable` on a zero denominator
> rather than 1.0 or 0.0: "0 of 0 claims were cited" is as wrong reported as perfect as it is
> reported as terrible, and this repo shipped a permanent invented zero once already (26-14's
> `edit: 0`). `not_applicable` also distinguishes `zero_denominator` from `no_data` — measured
> nothing and measured zero are different answers.
>
> **Cost and latency are structurally absent.** `PackMetricEvent` has no field for either, so no
> function in the module can produce one; `PACK_DERIVED_METRIC_SOURCES` names where they really live
> (`spendEvents` rail `reasoning` by `correlationId`, `telemetry.durationMs` / `agentSteps`).
>
> **PRIVACY IS DEFENDED TWICE, and that was measured rather than assumed.** Widening the recorder's
> ARGS validator alone does not open the hole — `record` spreads its args into `ctx.db.insert`, so
> the table's own closed validator refuses the field a second time. A text field becomes storable
> only if BOTH are widened; the test goes red only when both are, verified by mutating each in turn.
>
> **The emission gate is 27-07's**, where the call sites land. This plan proves the plane exists and
> is privacy-bounded; it does not prove real runs write to it.)
>

> Last verified: 2026-08-23 (27-02 follow-up 4 — three defects the review's own skeptic REFUTED, and
> which held up on a second reading. A skeptic that refutes on "it fails closed" can still be
> dismissing a real operational trap.
>
> **`publishPackCandidate` now refuses a manifest that does not pin the version it is minting.**
> Provenance is written at insert and NEVER patched, and the pack gate requires it to pin exactly
> that `(name, version)` — so a manifest pinning v1 stored on a v2 row produced an immutable
> candidate nobody could ever activate, discovered at the gate weeks later, with "publish a third
> version" as the only remedy. It is now one loud, named refusal (`PROVENANCE_PIN`) at publication
> time, and the refusal writes nothing. Mutation-verified.
>
> **The runner's exit-code contract is now true.** An unloadable registry is an ENVIRONMENT abort
> and exits 2, not 1 — reporting it as a fixture failure would send a lane hunting through its
> corpus for a defect that is not there. Proven by pointing the registry path at a missing file.
>
> **The self-test covers its shape rules too.** It exercised 19 rejections against more rules than
> that, so deleting an uncovered rule left it green — the tally counts CASES, and a rule with no
> case is invisible to it. Now 25, with the floor raised to 25 as a tripwire so deleting a case
> fails loudly.)
>

> Last verified: 2026-08-23 (27-02 follow-up 3 — **OWNER DECISION: `customer-complaint` is granted
> `proposePlan`, and it is the only pack that is.** Adversarial review found that the `draft_reply`
> output contract could not reach the gate the code claimed it stopped at: `replyToMessage` never
> writes `status`, `proposePlan` is the only email-path writer of `"proposed"`, and `PlanCard` — the
> only Approve surface — renders solely at that status. The drafted reply terminated at `collecting`,
> where `executePlan` returns `{ alreadyStarted: true }` having sent nothing. The output-contract
> test could not see it: it checked that `replyToMessage` was GRANTED, which is mechanism coverage,
> not behaviour coverage.
>
> `proposePlan` STAGES. `executePlan`'s human compare-and-swap is still the only sender, and the
> injection posture is unchanged because `replyToMessage` resolves the message and the recipient
> server-side — the model never sees an address, so a planted instruction can influence what the
> human is SHOWN, never what leaves the building. The grant is pinned to exactly one pack by name
> ("exactly one pack may stage a plan for approval"), mutation-verified: giving a second pack
> `proposePlan` reddens three tests.)
>

> Last verified: 2026-08-23 (27-02 follow-up 2 — **THREE FIXTURE-GATE DEFECTS FOUND BY ADVERSARIAL
> REVIEW OF THE 27-02 DIFF, ALL CONFIRMED AND FIXED.** Two of them made the `--packs` gate that
> 27-04/05/06 depend on report green over no coverage at all:
>
> 1. The typo'd-filter guard read `kept.length === 0 && all.length > 0`, so it was silent in exactly
>    the case it existed for — with no fixtures on disk, `--packs anything` validated zero cases and
>    exited 0. **A lane that wrote no fixture would have passed its only automated gate.** The guard
>    is now per requested name and never conditioned on corpus size.
> 2. A filter naming one real pack and one typo passed as long as ANY name matched, so the typo'd
>    pack was never validated. Each name is now checked against the registry and against the corpus.
> 3. `expect.sources` accepted a matrix-MISSING source as `"available"` — an expectation
>    `packPreflight` can never produce, and the mirror of two rules the validator already enforced.
>
> **The `--packs` gate is now RED until the named pack actually has fixtures.** That is deliberate:
> `--packs business-pulse,campaign-plan --fixtures-only` is 27-04's blocking evidence, and it has to
> fail while that lane's corpus is empty. A run with NO `--packs` over an empty corpus stays green,
> which is what 27-02's own verify uses. Self-test is now 19 rejections, counted rather than
> hardcoded; every rule above was also proven red against a real fixture written to disk.)
>

> Last verified: 2026-08-23 (27-02 follow-up — **OWNER DECISION: `workflowPackEvents` is
> `audit_immutable`, not `tenant_owned`.** Under `tenant_owned` the table was enrolled in the tenant
> deletion and export walks automatically, so erasing one tenant silently rewrote the denominator of
> every measure computed from the pilot. It now sits on the same plane as `audit` and `deadLetters`:
> same refs-only shape, excluded from both walks BY CONSTRUCTION rather than by an `if`, and covered
> by the existing export omission reason for that category.
>
> Two obligations came with the category and are now invariants 11 and 12 below: the writer must be
> insert-only, and no field on this table may ever become personal data. The bare `by_tenant` index
> was REMOVED in the same change — it existed only to satisfy the `deletableTables()` walk, and
> every tenant-scoped read is already served by the `by_tenant_createdAt` prefix. If the table is
> ever reclassified `tenant_owned`, that index must return in the same commit or the backend does
> not typecheck.
>
> Regression evidence for the reclassification: backend 96 files / 2381 tests green, core
> 42 / 1150, four typechecks clean, `biome ci` clean.)
>

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
- `packages/core/src/tenantData.ts` — classifies `workflowPackEvents` (`audit_immutable`).

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
- **`workflowPackEventLog.ts` is the SOLE write surface for `workflowPackEvents`.** The table is
  classified `audit_immutable`, which is a claim about immutability — a `patch`/`replace`/`delete`
  in that module would make the classification a lie and would leave rows that are outside the
  tenant deletion walk yet still rewritable. Enforced by a source scan in its own test.
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
   surprise, recommendation impressions. Refs, enums and counts only, insert-only, on the audit
   plane — so one tenant's erasure cannot rewrite the denominator of every pack measure.

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
11. **The `workflowPackEvents` writer must be INSERT-ONLY.** The table is classified
    `audit_immutable` (owner decision 2026-08-23), which is a claim about immutability, not just a
    filing category. A `patch` / `replace` / `delete` on this table would make the classification a
    lie. 27-03 owns the module; CLAUDE.md §3 is the general rule.
12. **Nothing in `workflowPackEvents` may ever become personal data.** `audit_immutable` rows are
    outside both the tenant deletion walk and the tenant export, which is exactly what the privacy
    policy describes as "references, identifiers, hashes, and counts only". A text field added here
    later would put user content beyond the reach of an erasure request. Adding one is not a schema
    tweak; it is a compliance change.

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

The `--packs` filter is a GATE, not a convenience: every name in it must be a real pack id AND must
already have at least one fixture, whatever the size of the corpus. A lane's blocking evidence is
`--packs <its two packs> --fixtures-only`, and that command is red until both packs are covered.

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
  (`insertCreatedDoc` fires inside the loop).
- **Drafting a reply is TWO tools, not one.** `replyToMessage` patches recipients, subject, threading
  and body onto the plan row and never touches `status`; `proposePlan` is the only tool on the email
  path that writes `status: "proposed"`, and that status is the only state in which `PlanCard` — the
  Approve control — renders, and the only state `executePlan` acts on. A pack granted the first
  without the second leaves a draft at `collecting`: visible, read-only, approvable by nobody.

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
- **The fixture runner needs Node >= 22.6.** It imports the registry as TypeScript rather than
  regex-parsing it. CI's test job pins Node 20 and never runs the script.
- **No rollback-to-dark path exists.** `skills.ts` has one active-patch site and no owner-facing
  deactivate; the only dark path is `archiveSkill` via `npx convex run`, which ends a browser
  session. 27-09 owns that decision.
