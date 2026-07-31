# Parallel Build Lanes (multi-session)

Three Claude Code sessions run in parallel, each in its own **git worktree** on its own
**branch**, integrating to `main`. This file is the shared contract — **every session reads it
first** and stays inside its lane. Set up 2026-07-14 after Phase 3.3.

> **CURRENT CONTRACT: Phases 18 + 19 — see the section directly below.** The Phases 16+17,
> 15.2, 14+15, 3.x and 3.8 sections further down are kept as *precedent* (they are what proved
> the pattern); they are not live lanes. The **shared-singleton discipline** and **rules of the
> road** at the bottom apply to every contract, current and historical.
>
> ⚠ **The worktree model in the header above is HISTORICAL.** Lanes have shared ONE working tree
> since 2026-07-27 (`STATE.md` line 22: *"they are NOT separate git worktrees"*). Every
> `.worktrees/lane-*` reference below describes how a contract was *originally* written, not how
> lanes run today. The **shared-tree discipline** in `STATE.md` — never `git add -A`, always
> `git commit -m "msg" -- <paths>`, check `.git/MERGE_HEAD` first, never bump a foreign
> playbook's `Last verified` — is what replaced worktree isolation, and it is mandatory.

## Phases 18 + 19 — document artifacts, then people/CRM (set up 2026-07-31)

**These two run SERIAL, not parallel — owner decision, 2026-07-31.** The contract exists anyway,
because the surface it maps is real and the next planner needs it. A reader looking for a Wave-0
freeze commit for 18 ∥ 19 must not go hunting: **there is none, deliberately** (§ *Why there is no
freeze* below).

| Lane | Phase | Name | Status |
|------|-------|------|--------|
| **Lane D** | 18 | **D · Document artifacts** (ACTN-04) | planning may start now (Stage 0); execution gated on Phase 16 closing |
| **Lane P** | 19 | **P · People, CRM & follow-ups** (ACTN-05) | not started; follows 18 |
| **Lane O** | 22 | **O · Owner authorization** | LIVE — `22-01` landed `d62c46c` |
| **Lane R** | 16 | **R · Research sub-agent** | LIVE — 8/9, holds the gated candidate stream |

`D`/`P`/`O` follow the R (research) / K (kalendar) / V (vault) first-letter convention. `C` is
retired to the completed Phase-14 lane; do not recycle it.

### Execution order: 16 → 18 → 19. The reason is a correctness hazard, not a preference.

**`cockpit-agent` is a GATED skill with exactly ONE candidate stream, and Lane R is holding it.**

- `COCKPIT_AGENT_SKILL` is in `GATED_SKILLS` (`packages/contracts/src/skill.ts:170`) — a new body
  reaches `active` only through a recorded passing eval run.
- `seedSkills` (`packages/backend/convex/skills.ts:334-352`) compares the file body against the
  **NEWEST** row, not the active one, and mints `maxVersion+1` when they differ. The comment there
  records why (Pitfall 1: repeated dev boots must not mint N+1, N+2).
- Lane R has candidate **v16** in flight, un-activated (`68afb7b feat(16): teach cockpit-agent the
  dispatchResearch tool` is the most recent commit to that body).

Both Phase 18 and Phase 19 **must** edit `packages/contracts/skills/cockpit-agent.md` to teach
their new tools — this is not optional. `docs/../16/deferred-items.md:114-127` documents the
**withheld-tool pattern**: a tool constructed, offered, and never called because the active body
never mentioned it. Hit at RPLY-01, hit again at 16-09 (~$0.46 of paid runs to diagnose). **A tool
the body does not teach is a tool that does not exist.**

So a Phase-18 body edit landing while R's candidate is open mints a candidate carrying **both
lanes' prose**, and whichever lane runs its eval next certifies instructions it never tested —
with the evidence row attached to its own phase. **That is a correctness failure inside the skill
registry, not a merge conflict a rebase fixes.**

> **THE HARD RULE, and it binds even if the serial decision is later reversed:**
> **No lane edits `packages/contracts/skills/cockpit-agent.md` while another lane holds an
> un-activated candidate for it.** Confirm with the live DB, not with a plan doc — per the
> standing version-collision gotcha, plan-authored version pins are frequently wrong because
> optimizer dry-run candidates occupy versions too. Verify which version carries your body
> BEFORE any eval or activate.

**`STATE.md`'s "Phase 16 paused, no `OPENAI_API_KEY`" line is STALE — verified 2026-07-31.** The
key is provisioned on the deployment (`16-02-PLAN.md:19`) and **the gate has been run and paid for
TWICE, both RED**: runs `9dde13e8` (27/33, $0.2148) and `c1fe054c` (26/33, $0.2228) —
**$0.4376 total, nothing activated**, per `docs/playbooks/agent-runtime.md` and
`16/deferred-items.md:103`. **Candidate v16 exists and is un-activated**, which is precisely the
hazard above; `cockpit-agent@15` remains active and contains zero mentions of the research tool.

Two consequences for anyone planning around this:

- **Do not read "the gate ran" as "the gate passed."** Phase 16 is 8/9 and `ACTN-03` stays Pending
  until a run id, per-case verdicts, total cost and the active `research-specialist` version are
  recorded. `agent-runtime.md` says so in its own words: *"Anyone finding this line must not read
  it as evidence."*
- **Budget the remaining gate honestly.** A full 33-case run is **~$0.83 clean / ~$1.06 with one
  research retry** — the earlier ~$0.02 figures were cheap *because nothing dispatched*. The
  runner's reported cost **understates research fixtures by ~10×** (the specialist bills
  asynchronously after the case is scored), and on a dispatch timeout an abandoned run's ~$0.21
  reads as $0 while it keeps billing. Cross-check against `npx convex data audit` (free) before
  declaring any run's cost.

The live blocker is the shared candidate stream, which is a *worse* constraint for 18/19 than a
missing key would have been. Fix the `STATE.md` line when 16 closes — it belongs to Lane R.

### Why there is no Wave-0 union freeze here

16 ∥ 17 needed one because both lanes added literals to the same closed unions concurrently.
**18 → 19 run serially, so no two lanes ever edit a shared union at the same time — the freeze
property that matters is serialization, not a commit** (the resolved 16/17 note below says exactly
this). The ordering IS the freeze.

Had they run in parallel, the freeze would have been narrow and specific — recorded here so a
future parallel attempt does not re-derive it:

| Would-be freeze item | Why it cannot be left to git |
|---|---|
| `convex/schema.ts` `tool: v.union(` — **:462-522**, 26 literals | One contiguous arg list, both lanes append at the tail. `schema.ts:486-492` records the failure mode *in the file*: a step insert for an unlisted tool **throws inside an AI-SDK callback that swallows it** — no trace row in prod, every offline test green. Bitten twice already, at `searchVault` and `evaluateBusiness`. |
| `apps/web/.../workspace/cards.tsx` `VERB` — **:1139-1177** | `traceParity.test.ts:61-81` asserts **set equality both ways**; a half-landed lane reddens the other lane's build. (Its floor at :57-58 is `>= 22` against 26/26 — **not** a freeze item, do not bump.) |
| `packages/contracts/skills/cockpit-agent.md` + mirror `src/skills/cockpitAgent.ts` | **The mirror is one string literal on ONE line (:8)** — concurrent edits are unmergeable by construction, and `skillBodies.test.ts` asserts byte-identity. Plus the gated-stream hazard above. |
| `packages/backend/scripts/run-eval-golden.mjs` | `EXPECT_KEYS` is a **closed vocabulary that `fail()`s on an unknown key** (:130-195, :224); both lanes would bump the same fixture floor at :518. |

### Locked decisions for Phase 18 (owner, 2026-07-31)

These two answer the questions that size the phase. A planner treats them as settled input.

1. **Phase 18 writes IN-LOOP. It takes no `ACTION_TYPES` member, no arm, and no `plans.kind`
   widening.** ROADMAP:702-704 requires only that *external delivery* crosses the Approve gate —
   *"creation alone has no external side effect."* A `vaultDocuments` insert has none. The shipped
   template is `packages/backend/convex/research.ts:133-210` (`persistFindings`): generated
   markdown → `vaultDocuments` row → `startIngest` → refs-only audit, **no plan, no gate, no
   action type**.
   > ⚠ **`packages/core/src/actionType.ts:30-32` says Phases 18 and 19 should reuse the
   > `externalAction` arm. That comment is WRONG for both and predates either design.**
   > `externalAction` is retrier-driven and `dispatchGuard.test.ts:181` pins it to *"only the
   > Calendar retrier action and its non-Node terminal."* A vault insert and a contacts insert are
   > both DB writes inside a `tenantMutation` → `inline` if gated at all. Whichever lane next
   > touches that file corrects the comment.
   >
   > **Consequence:** `actionType.ts`, `cockpit.ts`'s `_ARM_TABLE`, `plans.kind`, `plans.ts`
   > `patchPlan`/`resetPlan` and the `PlanCard` kind chain are **Lane P-only files**. If Phase 18
   > is ever redesigned to stage behind Approve, all five become shared and this contract needs
   > rewriting.

2. **A created document is stored as a `text/markdown` row with `text` present; the PDF is a
   derived download.** It is embedded, groundable and retrievable immediately. Storing
   `application/pdf` instead would land the row at `pending_extraction` and round-trip it through
   `vaultExtract` to recover the text it was rendered *from* — pure waste for content we authored.
   `vaultDocuments.kind` is `v.string()` (`schema.ts:691`), so this needs **no new table and no
   migration**.

### Sequencing interlocks — check these before Lane D executes

1. **`17.1-10`'s live gate is unrun, and a Phase-18 artifact would corrupt what it measures.**
   `blueprint.ts:566-573` (`unincorporatedFor`) counts every `ready` tenant doc *except*
   `kind === "business_blueprint"` as blueprint drift. A document Phase 18 creates lands at `ready`
   and inflates the number the gate exists to read. **Either sequence 18 after `17.1-10`, or make
   the filter fix part of 18** — note there is **no shared constant**, the string is inline at
   `blueprint.ts:199` and `:571`.
2. **Lane O's blocking human checkpoints must not overlap a sibling lane editing deployed source**
   — `22-01-PLAN.md:231` (`bootstrapOwner`) and `22-03-PLAN.md:122-123` (two-identity live verify).
3. **`docs/playbooks/cockpit.md` is contested three ways** — dirty from Lane R, claimed by the
   unrun `17.1-10`, and forced for both 18 and 19. `check-playbooks.mjs:55-63` builds its
   changed-set from `git diff --name-only <baseline>` over the **whole working tree plus all
   untracked files**, not the session's own files, so a Lane D session inherits every foreign dirty
   file. The `.git/claude-playbooks-ack.json` escape is **shared, not session-keyed**, and re-arms
   whenever a foreign lane saves. Append inside your own `### Phase 18` subsection; **never bump a
   foreign playbook's `Last verified`.**
4. **`stableTenant` is DELETED** by Lane O's landed `22-01`. It was the tenant-isolation test idiom
   at the previous HEAD (`dispatch.test.ts:659`, `evaluations.test.ts:930`). Copying that shape
   from an older commit imports a symbol that no longer exists — write tests with plain string
   subjects (`t.withIdentity({ subject: "tenant_a" })`), matching the 25 test files Lane O leaves
   alone. `ctx.tenantId` itself is unchanged and call-site compatible; **nothing in ACTN-04/05 is
   owner-gated, so neither lane needs a new wrapper.**
5. **`importGuard.test.ts` needs no registration** for new convex modules — its
   `import.meta.glob("./**/*.ts", { eager: true })` auto-scans them. `RAW_BUILDER_ALLOWLIST` is
   opt-in, for raw-builder exemptions only.
6. **Phase 19 owes an ADR before it writes schema.** It *reverses* the written **"no contacts cache
   at rest"** invariant (the `plans.candidates` comment in `schema.ts`), which `plans.ts:282-287`
   `clearCandidates` exists solely to enforce — reopening the PII-at-rest question that invariant
   closed. Per CLAUDE.md §9 ADRs are superseded, never edited. Phase 19 also needs a new
   `docs/playbooks/contacts.md` + its `watch.json` key: **no existing prefix covers contacts/crm**,
   and `check-playbooks.mjs:125-134` blocks the turn that creates an uncovered module.

### Relative size — why serial costs little

| | Phase 18 (D) | Phase 19 (P) |
|---|---|---|
| New tables / indexes | 0 / 0 | 2 / ≥3 |
| New action types + arms | 0 | 1 + 1 |
| New tools | 1 | 2 |
| New playbooks / ADRs | 0 / 0 | 1 / 1 (reverses an invariant) |
| Staged `plans` fields | 0 | 4-6 |

Roughly **1:4**. Phase 18's SC#2 is *already structurally true at zero cost*: `executePlan` is a
`tenantMutation` unreachable by name from the tool loop (`dispatchGuard.test.ts:222-252`), the
model's only write verb `patchPlan` deliberately cannot write a delivery handle
(`plans.ts:200-203`), and `startFanout` (`cockpit.ts:462`) is the sole `workflow.start` site.
SC#3 has shipped precedent on both halves. **Phase 18 is realistically one helper + one tool + one
kind + one card + prose.** Parallelizing a 1:4 pair buys the wall-clock of the short lane and pays
coordination cost on both.

### ⚠ Gate on the typecheck DELTA — `pnpm typecheck` lies

Restated here because it binds these lanes too, and the 16/17 section below carries the full
measurement: Turbo's `typecheck` task declares no `inputs`, so its cache restores a **stale pass
without running `tsc`**. Always `pnpm exec turbo run typecheck --filter=@pikar/backend --force`.
The real baseline is **52 errors, ALL in `convex/*.test.ts`, ZERO in production convex source**.
Require that your change adds no error and no error in a production file. An absolute-clean gate is
unachievable and makes an executor either thrash or start ignoring reds wholesale. With Lane O
mid-rewrite on `importGuard.test.ts`/`tenant.test.ts`, the backend suite is **not** a clean
baseline for either new lane today — re-measure at the moment you start.

## Phases 16 + 17 — research sub-agent ∥ calendar actions (set up 2026-07-26)

Two Claude Code sessions, run **concurrently** at the owner's direction. Both phases depend on
Phase 15 (landed) and on **nothing from each other** — the cleanest parallel pair the roadmap has
offered so far.

| Session | Worktree | Branch | Phase |
|---------|----------|--------|-------|
| **Lane R** | `.worktrees/lane-r-research` | `lane-r/research-web` | 16 — Research Sub-Agent & Web Research |
| **Lane K** | `.worktrees/lane-k-calendar` | `lane-k/calendar-actions` | 17 — Calendar Actions |

### Why these two can run together — and the one place they collide

Phase 16 adds a **specialist** (a new dispatch route + its own least-privilege tool-set) and a
**research capability**. Phase 17 adds an **action type** (a read tool in-loop + a write arm behind
the Approve gate). Different seams, different requirements (DISP-02/ACTN-03 vs ACTN-02), no shared
goal. Phase 15 built both seams *specifically* so a later phase could add an arm or a route with
zero spine edits — `actionType.ts:23-27` and `specialists.ts:18-21` both say so in their comments.

**They collide in exactly one class of file: the closed unions that Phase 15 deliberately made
closed.** Both lanes must add literals to unions whose whole design property is that adding a
member without deciding its behaviour is a *compile* error. That is a feature — and it means two
lanes editing the same few lines:

| Shared file | Lane R (16) adds | Lane K (17) adds |
|---|---|---|
| `convex/schema.ts` — `agentSteps.tool` union (~L420-450) | research/web-search step literals | calendar read + propose literals |
| `apps/web/.../workspace/cards.tsx` — `VERB` map (L1107) | verbs for its literals | verbs for its literals |
| `core/src/actionType.ts` — `ACTION_TYPES` + `ARMS` | only if research needs a new action type | `calendar_event` + its arm |
| `convex/cockpit.ts` — `executePlan` arm switch (L517) | probably none | the new arm |
| `convex/llm.ts` — the ONE governed loop | dispatch route wiring | the in-loop calendar read tool |
| `convex/skills.ts` — `seedSkills` | the research specialist body | none expected |
| `docs/playbooks/watch.json` | its playbook's paths | its playbook's paths |
| `.planning/STATE.md` + `ROADMAP.md` | phase-16 rows | phase-17 rows |

`llm.ts` is the dangerous one — it is the file the 14∥15 contract was written to protect, for the
reason recorded there: a textual conflict inside a large restructured file becomes a
*re-derivation*, not a resolution.

### The stages

**Stage 0 — parallel planning. FREE, start now.** Planners *read* code and *write* only into
disjoint `.planning/phases/16-*/` and `17-*/` directories. There is no code-conflict surface.
Planning needs **no `pnpm install` and no Convex deployment** — defer both to Stage 2.

**Stage 1 — Wave-0 freeze on `main` (serial, unavoidable).** When *both* plan sets exist, ONE
session on `main` lands ONE commit adding **every union member both phases need**, plus the
`VERB` entries, plus `watch.json` registration — with stub/no-op behaviour where the arm isn't
built yet. Then each lane fills in its *own* files instead of both editing the union. Skipping
this is the single failure mode this contract exists to prevent.

> **RESOLVED 2026-07-27 — the freeze is ABSORBED INTO THE LANES and SERIALIZED through `main`.
> There is no single joint Stage-1 commit, and a later reader must not go looking for one.**
> This is the Phase-15 precedent (recorded below: *"both lanes absorbed the freeze"*), and BOTH
> Wave-1 plans already specify it as an accepted execution — `16-01 <freeze_contract>` bullet 2
> and `17-01 <parallelization_contract>` last paragraph. The freeze property that matters is
> **serialization, not single-commit-ness**: no two lanes may edit a shared union concurrently.
>
> Execution order (each step completes and merges before the next begins):
>
> 1. **Lane R runs `16-01` → merge to `main`.** First because its `llm.ts` change is the three
>    *signature* widenings (`buildCockpitTools` 7th arg, `runAgentLoop`/`runSpecialistTurn`
>    returns); Lane K's `17-03` later adds a tool key *inside* that widened shape, so landing
>    the shape first makes the second edit additive instead of a re-derivation.
> 2. **Lane K merges `main` down, runs `17-01` → merge to `main`.** Its union members
>    (`calendar_event` + the `externalAction` arm, the two trace literals, the staged-event
>    `plans` fields, `calendarFixtures`) then apply on a base that already carries Lane R's.
> 3. **Only then Stage 2** — remaining waves run in parallel (16-02…16-09 ∥ 17-02…17-04).
>
> **Why hand-writing a joint commit was rejected:** it would re-derive ~2/3 of two
> checker-verified plans with no plan doc, no tests and no SUMMARY, after which both plans still
> have to be re-verified as "already present" — more work and more risk for the same end state.
>
> **The one file still shared after the freeze is `convex/llm.ts`** (16-05, 16-06 ∥ 17-03).
> Different regions of a 2,985-line file, so git should merge it — but it is the file this
> contract was written to protect. Whichever lane reaches its `llm.ts` wave second merges `main`
> down FIRST and re-runs `pnpm exec tsc --noEmit` before writing a line.
>
> **Owner decision that unblocked the freeze (2026-07-27):** `stageResearchPlan` **REFUSES**
> while a `proposed` email draft is on the card ("finish or discard your draft first").
> `plans.byThread` stays `.unique()` — **no multi-row-per-thread schema change**, so the
> one-root-envelope invariant `16-06`/`16-07` are planned against holds. The >1-plan-row fix
> stays deferred and is a later phase's schema change.

**Stage 2 — parallel execution.** Each lane runs `/gsd:execute-phase` in its own worktree, with
its own `pnpm install`, its own `npx convex dev` deployment, its own `_generated/`.

**Stage 3 — integrate, then verify.** Merge each lane to `main` as it lands; announce it so the
other lane merges `main` down. Verify each phase after its own merge.

### ⚠ THE TYPECHECK BASELINE IS NOT CLEAN — measured 2026-07-27, applies to ALL THREE lanes

Every plan in Phases 16 and 17 gates on "typecheck clean". **It is not, and never has been.**
Measured on `main` and in both lane worktrees:

```
pnpm exec turbo run typecheck --filter=@pikar/backend --force   ->  52 errors
```

**`pnpm typecheck` reports GREEN and is lying.** Turbo's `typecheck` task declares no `inputs`
(`turbo.json`), and its cache restores a stale pass without running `tsc`. **Always pass
`--force` when you mean it.** This is how the red survived unnoticed since Phase 1.

**All 52 errors are in `convex/*.test.ts`. ZERO are in production `convex/` source** — the
shipped code typechecks clean. Root cause is a tsconfig artifact, not a code defect:
`packages/backend/tsconfig.json` sets `"types": ["node"]`, which suppresses every other ambient
type package (including the one declaring `import.meta.glob`), while its `include` of
`convex/**/*.ts` sweeps the test files in anyway. `tenant.test.ts`'s `import.meta.glob` dates to
commit `0385176` — **Phase 1**.

Per-file baseline (`skills` 10, `audit` 7, `plans` 5, `vault` 4, `llmRedaction` 4, `tenant` 3,
`optimizerConfig` 3, `notifications` 3, `feedback` 3, `evaluations` 3, `worm` 2, then
`optimizerEligibility` / `opsSignals` / `importGuard` / `guardrails` / `deadLetters` 1 each).

**What an executor must do instead of "typecheck clean":** check the **delta**. Re-measure with
`--force` before your change, and require that your change adds no error and no error in a
production `convex/*.ts` file. An absolute-clean gate is unachievable and will make an executor
either thrash or start ignoring reds wholesale.

> **Do not conflate this with the `audit.test.ts` correction.** Both are true and they are
> different tools: `audit.test.ts` is **GREEN at runtime** (`vitest`, 1/1 — any runtime red there
> is a REAL regression, per both VALIDATION.md files) and simultaneously carries **7 of these
> pre-existing TYPECHECK errors**. Phase 16 touches the audit path heavily, so keep the two
> apart.

**NOT fixed here, deliberately.** `tsconfig.json` is a build singleton all three lanes share, and
widening `types` / excluding tests mid-flight could mask a real error in exactly the phases that
are building. Owner call, best taken between lanes rather than during them.

### Carried-forward debt neither lane owns

Both of these predate this contract and are recorded so they are not silently lost:

1. **Phase 15.1 was never `/gsd:verify-work`'d** — 7/7 plans complete, verification skipped.
2. **`.planning/WAVE-0.md` §A/§B/§D post-integration items** — the `evaluations` facts split, the
   `gaps[].proofMetricPath` field, and the weekly-cron hardening (`runWeekly`'s unbounded
   `.collect()` dies as a cliff near ~3,000 tenants).

## Phase 15.2 — vault format recognition (Lane V, added 2026-07-27)

Phases 16 (Lane R) and 17 (Lane K) are LIVE. Phase 15.2 runs as an explicitly contracted **third
lane**. This contract is written BEFORE any code lands, per 15.2-CONTEXT `<coordination>`.

| | Files |
|---|---|
| **Lane V owns (edit freely)** | `packages/vault/src/*`, `packages/backend/convex/vaultExtract.ts`, `packages/backend/convex/vaultSweep.ts`, `packages/backend/convex/vaultLlm.ts`, `apps/web/app/(app)/dashboard/vault/*` |
| **Lane V must NOT touch** | `convex/schema.ts` (this phase needs NO schema change and NO migration — a locked decision), `convex/llm.ts`, `convex/cockpit.ts`, `apps/web/.../workspace/cards.tsx`, `packages/core/src/actionType.ts`, `packages/core/src/specialists.ts`, `convex/skills.ts` (this phase adds NO skill row — §5 is satisfied by REUSING `attachment-extractor`) |
| **Shared risk (ONE file)** | `packages/backend/convex/vault.ts` |

**`packages/backend/convex/vault.ts` is the one shared-risk file** (RESEARCH §10 rates it MEDIUM:
Lane R stores web research in the vault). Lane V's edit is confined to the `vaultUpload` scheduling
block (`:162-176`) plus `markReady` (`:416-421`). Any Lane R edit elsewhere in that file merges
cleanly; a collision **inside those two blocks is a coordination event, not a resolution** — stop and
talk, do not merge-resolve by hand.

**Why there is NO Wave-0 union freeze here** (RESEARCH §10): 16∥17 needed one because both lanes add
literals to the same closed unions and to `convex/schema.ts`. Phase 15.2 touches **no closed union**
and needs **no `schema.ts` edit** — so the freeze is not applicable, not forgotten. A later reader
must not "restore" a missing Stage-1 commit for this lane; there is none to restore.

**`docs/playbooks/vault.md` is an append-only shared singleton this phase** (the Phase-3.8 rule):
each plan writes ONLY inside its own `### Phase 15.2 — 15.2-0N` subsection under one `## Phase 15.2`
container, and bumps `Last verified`. On merge conflict, **keep both**.

Lane V also appends to the shared singletons `.planning/STATE.md` + `.planning/ROADMAP.md` (phase-15.2
rows) under the same append-only / keep-both discipline — see
[The three shared singletons](#the-three-shared-singletons--append-only-discipline) below; the full
list is not restated here.

## Phases 14 + 15 — voice-doc flagship ∥ dispatch framework (set up 2026-07-25)

Approved shape: **plan-parallel, then execute-laned.** Four stages, each removing a different
serial wait. Owner runs the sessions; lanes merge on automated gates.

### Why these two phases can run together — and where they can't

Phase 15 restructures the ONE governed loop (`convex/llm.ts`, **2,985 lines**) and generalizes
the executor (`convex/deliverApprovedPlan.ts`, **69 lines**). Phase 14 is "mostly integration of
shipped machinery" (Phase 6 voice + Phase 10 grounding + the Phase 12 evaluation engine).

They are **not naturally disjoint** — Phase 14 *reads* the very loop Phase 15 is rewriting.
**Wave 0 is what makes them disjoint.** It lands the seams on `main` first, so each lane fills in
its OWN file instead of three lanes editing `llm.ts`. Skipping Wave 0 converts a textual merge
conflict inside a 2,985-line file that one lane just restructured into a *re-derivation*, not a
resolution. That is the single failure mode this contract exists to prevent.

**Lane weighting is deliberate: 2 lanes on Phase 15, 1 on Phase 14.** Phase 15 is a hard
dependency of Phases 16, 17, 18 and 19. Phase 14 is a leaf (flagship demo) and unblocks nothing.
Throughput should follow the dependency graph, not split evenly.

### Constraint on Lane A: dispatch stays tier-agnostic

**Phase 15 routes specialists by NAME only.** Tier-based filtering/ordering of Growth OS
specialists is **Phase 15.1**, not Phase 15 — it plugs into the dispatch seam afterwards as a
filter layer. Lane A must not build tier awareness into the router, and must not read the tier in
`llm.ts`. Reason: the tier is currently self-assignable by any caller
(`onboarding.ts:56` accepts it as a mutation arg), so routing on it today would make a
user-writable field select code paths. Phase 15.1 fixes the write path first.

### Stage 0 — parallel planning (start first; no `pnpm install` needed)

Planners **read** code and **write** only to disjoint `.planning/phases/14-*/` and
`15-*/` directories. There is no code-conflict surface, so this stage is free.
Planning sessions do **not** need `node_modules` or a Convex deployment — defer both to Stage 2.

| Session | Worktree | Branch | Command |
|---------|----------|--------|---------|
| **Plan 15** | `.worktrees/lane-a-dispatch` | `lane-a/dispatch-core` | `/gsd:discuss-phase 15` → `/gsd:plan-phase 15` |
| **Plan 14** | `.worktrees/lane-c-voicedoc` | `lane-c/voice-doc` | `/gsd:discuss-phase 14` → `/gsd:plan-phase 14` |

One planning pass per **phase**, not per lane — Phase 15's single plan set is split across
Lanes A and B at execution time. When both finish, **merge both branches to `main`**; the phase
dirs are disjoint so only `STATE.md` conflicts (resolve by **keeping both**, per the singleton
rule below).

### Stage 1 — Wave-0 freeze commit on `main` (serial, unavoidable)

> **⚠ OVERTAKEN 2026-07-25 — read `.planning/WAVE-0.md`'s STATUS banner before acting on this
> stage.** Both lanes absorbed the freeze into their own phase plans and are executing, so there is
> no separate Stage-1 freeze commit to land on `main`. `WAVE-0.md` remains the reference for the
> `evaluations` facts split (per Convex `guidelines.md:159/:160`) and the cron hardening — both now
> **post-integration** work, not a precondition for Stage 2.
>
> Lanes mid-flight: do NOT wait for a Stage-1 commit that is not coming. Carry on to Stage 3.

ONE session, on `main`, reads **both** finished plans and lands **one commit** that:

1. adds every `convex/schema.ts` table/field either phase needs — including Phase 15's
   `rootRequestId` / `parentAgentId` lineage fields (SC #3) and any Phase 14 voice-doc rows;
2. creates an **empty stub file** for every new module a lane will own;
3. lands the **seams** as no-op passthroughs — the executor's dispatch-by-action-type `switch`
   carrying only today's email + memo arms, and the specialist-route lookup **failing closed to
   `unknown_route`** (SC #1) with no specialists registered yet.

After this commit, `convex/llm.ts`, `convex/schema.ts` and `convex/deliverApprovedPlan.ts` are
**FROZEN to their owning lane** for the rest of the phase. A lane that believes it needs an edit
outside its column stops and coordinates — that is a contract change, not a code change.

### Stage 2 — execution lanes (FINALIZED at 15-01; Phase 15 runs SERIALLY)

**FINALIZED 2026-07-25 by the Stage-1 (15-01) freeze commit.** No longer provisional: the
ownership below is read off the six finished Phase-15 plans, not guessed.

> **OWNER DECISION (2026-07-25): Phase 15 executes SERIALLY, not in parallel.** All six plans
> (15-01 … 15-06) run in `.worktrees/lane-a-dispatch` on `lane-a/dispatch-core`. There is no
> Lane B session and no concurrent Phase-15 lane. The Wave-0 freeze still executed in FULL —
> the seams below are real architecture (a closed schema union, a fail-closed lookup, a readable
> budget rail), not coordination scaffolding — but its "land on `main` to unblock parallel lanes"
> framing is moot, so it landed on the lane branch. **The Lane A / Lane B columns below are
> retained as the file-ownership CONTRACT** (which plan may touch which file), which still holds
> under serial execution and is what keeps 15-05's executor work from silently colliding with
> 15-02/03/04's dispatch work. Phase 14 / Lane C is unaffected.

| Lane | Worktree | Branch | Scope | Owns (edit freely) | Must NOT touch |
|------|----------|--------|-------|--------------------|----------------|
| **A · Dispatch core** | `.worktrees/lane-a-dispatch` | `lane-a/dispatch-core` | Phase 15 SC #1, #2 | `convex/llm.ts` (route → specialist skill+tool-set swap, depth cap, cycle refusal, shared cost envelope), specialist skill rows in `convex/skills.ts` + `packages/contracts` | executor files, any voice file |
| **B · Executor + lineage** | `.worktrees/lane-b-executor` | `lane-b/executor-lineage` | Phase 15 SC #4, #3, #5 | `convex/deliverApprovedPlan.ts`, `convex/plans.ts`, audit/telemetry lineage rows, the cross-tenant isolation assertion | `convex/llm.ts` (zero edits), voice files |
| **C · Voice-doc flagship** | `.worktrees/lane-c-voicedoc` | `lane-c/voice-doc` | Phase 14 (all SC) | `convex/voice.ts`, the new voice-doc module, `apps/web/app/(app)/dashboard/voice/*`, read-only use of `convex/evaluations.ts` **except the ONE authorized exception below** | `convex/llm.ts`, executor files |

**Contract amendments recorded with this finalization (15-01):**

- **Web column: RESOLVED — there is none.** Phase 15's ONLY `apps/web` edit is 15-01's `VERB` map
  addition in `apps/web/app/(app)/dashboard/workspace/cards.tsx`. Specialist attribution rides the
  plan BODY (15-04), and `PlanCard` renders only at `plan.status === "proposed"`, so a `collecting`
  plan needs no pending state. **`apps/web` is FROZEN for Phase 15 after Wave 0.**
- **SC #5 moves from Lane B to Lane A.** The lineage rows keyed on `rootRequestId` are written by
  `convex/dispatch.ts`, so the two-tenant isolation assertion belongs in `convex/dispatch.test.ts`.
  Splitting it across lanes would put two lanes in one test file. Lane B keeps SC #4 whole.
- **`convex/evaluations.ts` → Lane A** (it is the dispatch TRIGGER, `actOnGap`). Lane B's arm table
  calls the existing `persistNextStepMemo` unchanged, so Lane B needs zero edits there.
- **`docs/playbooks/cockpit.md` is an append-only shared singleton this phase** (the `vault.md`
  Phase-3.8 rule): each lane writes ONLY inside its own `### Phase 15 — Lane X` subsection and
  bumps `Last verified`; on merge conflict, keep both. The `## Phase 15` container section and its
  `### Phase 15 — Wave 0 (freeze)` subsection were opened by 15-01.
- **`docs/playbooks/watch.json` is a Wave-0 singleton** (rule #5) — 15-01 registered
  `convex/dispatch.ts`, `convex/dispatch.test.ts`, `convex/dispatchGuard.test.ts` and
  `packages/core/src/actionType*.ts` under `cockpit.md`, and `packages/core/src/specialists*.ts`
  under `growth-diagnostic.md`. No lane edits it after that commit.
- **No lineage SCHEMA change was needed.** RESEARCH Q5: `AuditPayload` already permits
  `rootRequestId`/`parentAgentId`, `audit.by_correlation` already exists, and `telemetry`
  structurally cannot carry them (`requestId: v.id("requests")`, and a specialist run seeds zero
  `requests` rows by design). Stage 1 item (1)'s "lineage fields" turned out to be a no-op — SC #3
  needs zero schema change. What Stage 1 item (1) DID need was the three `agentSteps.tool` dispatch
  literals.

**Authorized exception to Lane C's read-only use of `convex/evaluations.ts` (approved 2026-07-25,
plan 14-01).** The Wave-0 schema widening (`evaluations.framework` += `"document-review"`) could not
be "zero edits to `evaluations.ts`" as the Phase-14 research assumed: `evalFields.framework` is
derived from the schema and feeds **two** signatures — `insertEvaluation` (:139), which SHOULD widen
for free, and `runEvaluation` (:161), which must not. Lane C therefore pinned `runEvaluation`'s
`framework` arg to the four business frameworks, so the business-evaluation engine refuses a
doc-review row at the validator boundary. Same change forced one line in `convex/proactiveReview.ts`
(:79 carries the persisted framework forward into that now-narrower arg). `insertEvaluation`, the
local `Framework` type (:44), `FRAMEWORK_SKILL` (:48) and `buildMemo` are byte-unchanged, as is
`convex/llm.ts` (its `evaluateBusiness` enum is hardcoded, not schema-derived). **Any other lane
touching `evaluations.ts` or `proactiveReview.ts` coordinates first.**

**Per-worktree setup, once, at Stage 2 only:** `pnpm install` → `npx convex dev` (codegen + its
own dev deployment) → `pnpm dev`. Each lane gets an isolated deployment, which is what lets a
lane run a live smoke without clobbering another's. (Under the serial decision this is done once,
in `.worktrees/lane-a-dispatch`.)

### Stage 3 — integrate, then verify once

**Merge gate is automated only.** A lane merges to `main` when its tests + `tsc --noEmit` +
`scripts/check-playbooks.mjs` are green. Lanes do **not** block on owner sign-off — that would
re-serialize exactly the wait this contract removes.

The owner's **live human-verify happens ONCE, on integrated `main`, after all three lanes land**,
covering both phases in one pass (real voice, real Gmail, real dispatch). Accepted risk: a defect
found at that point can span two lanes' work.

### Phase 14/15 additions to the shared-singleton list

8. **`convex/skills.ts` seeding — Lane A only this phase.** Phase 15's specialists need skill
   rows, and seeding is version-collision-prone: `seedSkills` writes `maxVersion + 1`, and
   optimizer dry-run candidates already occupy versions, so a plan's pinned version number can be
   wrong against the live DB. Two lanes seeding concurrently will silently cross versions.
   **Verify which version carries your body before any eval or activate.** Any skill-body edit
   still rides the Phase-3.6 `EVAL_GATE`.
9. **`convex/llm.ts` — Lane A's exclusive property after Wave 0.** Lanes B and C get zero edits.
10. **`convex/schema.ts` — Wave-0-owned this phase.** Both phases' fields land in Stage 1; no
    lane adds a field afterwards without coordinating.

## Why this split works

The remaining roadmap's deep tail (`5 → 6 → 7 → 8 → 9`) is a **strict dependency chain** — not
parallelizable. The parallel window is the **3.x / 4 frontier**, split by *which files a lane
owns* (the real conflict source is shared hot files — `llm.ts`, `schema.ts`, `cockpit.ts`,
`cards.tsx` — not logical dependency).

## The lanes

| Lane | Worktree | Branch | Phases | Owns (edit freely) | Must NOT touch |
|------|----------|--------|--------|--------------------|----------------|
| **A · Cockpit send** | `.worktrees/lane-a-cockpit` | `lane-a/cockpit-send` | 3.4 → 3.5 (sequential) | `convex/cockpit.ts`, `convex/llm.ts` (cockpit tools + `runCockpitAgent`), `convex/plans.ts`, `convex/gmail.ts`, cockpit `apps/web/.../cards.tsx`/`ChatPane.tsx`, `packages/core/src/emailIntent.ts`, cockpit skills in `packages/contracts` | intake/voice services, vault packages |
| **B · Intake & Voice** | `.worktrees/lane-b-intake` | `lane-b/intake-voice` | 4 | `services/*` (Python sidecars), new intake convex module(s), extraction/transcription `packages/*`, intake-specific UI | `llm.ts` cockpit tools, `cockpit.ts`, vault packages |
| **C · Knowledge Vault** | `.worktrees/lane-c-vault` | `lane-c/knowledge-vault` | 5 (scaffolding) | new `packages/*` (embeddings, hybrid retrieval), new `convex/vault*.ts` + `graphNodes`/`graphEdges` modules | `llm.ts` cockpit tools, `cockpit.ts`, intake services |

**Lane A runs 3.4 then 3.5 sequentially in one session** — they share files, so they must not be
split across two sessions.

## Phase 3.8 — Vault document extraction (4 lanes, Wave 0 landed 2026-07-18)

Wave 0 (03.8-01, on `main`) froze every shared file and stubbed every lane's file. The four
Wave-2 lanes are pairwise-disjoint — no lane edits another lane's file or any shared singleton:

| Lane | Branch | Owns (edit freely) | Must NOT touch |
|------|--------|--------------------|----------------|
| **1 · PDF + images** | `lane-1/vault-extract` | `convex/vaultExtract.ts`, `convex/vaultExtract.test.ts` | everything else below; `vault.ts`, `schema.ts`, package.jsons |
| **2 · Office parsers** | `lane-2/office-parsers` | `packages/vault/src/officeText.ts`, `packages/vault/src/officeText.test.ts` | ANY `convex/` file (zero Convex edits); the `@pikar/vault` index barrel |
| **3 · Sweep + UI + E2E** | `lane-3/sweep-ui` | `convex/vaultSweep.ts`, `convex/vaultSweep.test.ts`, `apps/web/app/(app)/dashboard/vault/`, `apps/web/e2e/vault.spec.ts` | `vaultExtract*`, `vaultTranscribe*`, `officeText*` |
| **4 · Video transcription** | `lane-4/video-transcribe` | `convex/vaultTranscribe.ts`, `convex/vaultTranscribe.test.ts` | everything else; adds NO deps, NO e2e file (a video E2E row is Lane 3's, via SMOKE sentinel bytes) |

Phase-3.8 additions to the shared-singleton list (beyond the three below):

4. **`pnpm-lock.yaml` + `packages/backend/package.json` + `packages/vault/package.json`** —
   FROZEN after Wave 0 (unpdf/fflate installed there). No lane runs `pnpm add`.
5. **`docs/playbooks/watch.json`** — Wave-0-only this phase (all six new convex paths already
   registered). Lanes do not edit it.
6. **`docs/playbooks/vault.md`** — append-only, each lane writes ONLY inside its own
   `### Lane ownership (Phase 3.8)` subsection; on merge conflict keep both (same rule as
   STATE.md/ROADMAP.md).
7. **`convex/vault.ts` + `convex/schema.ts`** — Wave-0-owned this phase; already carry the hook,
   seam, and status union every lane needs. If a lane thinks it needs an edit here, stop and
   coordinate — that's a contract change.

## The three shared singletons — append-only discipline

Only these files are touched by every lane. Keep edits **additive and region-scoped** so merges
are trivial:

1. **`convex/schema.ts`** — add your table/field in your own block; never reorder or reformat
   others'. New tables > new fields on shared tables where possible.
2. **`convex/skills.ts`** (the `seedSkills` list) — **append** your skill row; don't touch others'.
   Each skill is the 5-file mirror (`.md` + derived `.ts` + name const + seed row + drift row).
3. **`.planning/STATE.md` + `.planning/ROADMAP.md`** — GSD bookkeeping. Different lanes tick
   different phases (additive ROADMAP lines). On merge conflict, **keep both** phases' progress.
   Per-phase `PLAN.md`/`SUMMARY.md` live in separate `.planning/phases/<phase>/` dirs → never
   conflict.

## Rules of the road

- **Merge `main` into your lane daily** (`git fetch && git merge origin/main` or from local main).
  Small frequent merges beat one big painful one. Resolve schema/skills append-conflicts by
  keeping both blocks.
- **Land a phase → merge your branch to `main`** (PR or fast-forward). Announce it so the other
  lanes pull it in.
- **Convex deployment isolation:** each worktree runs its **own** `npx convex dev` → its **own**
  dev deployment. That's what lets lanes run live smokes/human-verify without clobbering each
  other. Most dev + tests are **offline** (`convex-test`, no backend) — only smokes/verify need a
  live backend.
- **Per-worktree setup (once, when you open the session):** `pnpm install` → `npx convex dev`
  (codegen + deployment) → `pnpm dev`. `_generated/` and `node_modules/` are per-worktree.
- **Stay in your lane.** If you genuinely need a change in another lane's owned file, note it for
  that lane rather than editing across the boundary.
- **Known pre-existing red:** `convex/audit.test.ts` (`auditCounts` unregistered in convex-test) —
  documented since Phase 2, NOT a regression. Don't chase it.

## How each session starts

1. Read `.planning/STATE.md`, this file, and `CLAUDE.md`.
2. Confirm you're in your lane's worktree (`git branch --show-current`).
3. Run `/gsd:plan-phase <your phase>` then `/gsd:execute-phase <your phase>`.
4. Ponytail + graphify conventions apply as normal (per `CLAUDE.md`).

## Sequencing note

Lane C (Phase 5) integrates with Lane B's extraction output eventually — the vault *engine*
(embeddings, retrieval, graph tables) builds independently now; the intake→vault wiring happens
after B lands Phase 4. Lanes A and B are fully independent of each other.
