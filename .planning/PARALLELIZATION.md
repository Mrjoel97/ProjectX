# Parallel Build Lanes (multi-session)

Three Claude Code sessions run in parallel, each in its own **git worktree** on its own
**branch**, integrating to `main`. This file is the shared contract — **every session reads it
first** and stays inside its lane. Set up 2026-07-14 after Phase 3.3.

> **CURRENT CONTRACT: Phases 14 + 15 — see the section directly below.** The Phase 3.x and
> Phase 3.8 sections further down are kept as *precedent* (they are what proved the pattern);
> they are not live lanes. The **shared-singleton discipline** and **rules of the road** at the
> bottom apply to every contract, current and historical.

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

### Stage 1 — Wave-0 freeze commit on `main` (serial, small, unavoidable)

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

### Stage 2 — three execution lanes (PROVISIONAL until Stage 0 lands)

**This table is provisional on purpose.** Real file ownership can only be read off the finished
plans; writing it before planning would be inventing the constraint instead of measuring it.
The Stage-1 session finalizes this table in the same commit as the freeze.

| Lane | Worktree | Branch | Scope | Owns (edit freely) | Must NOT touch |
|------|----------|--------|-------|--------------------|----------------|
| **A · Dispatch core** | `.worktrees/lane-a-dispatch` | `lane-a/dispatch-core` | Phase 15 SC #1, #2 | `convex/llm.ts` (route → specialist skill+tool-set swap, depth cap, cycle refusal, shared cost envelope), specialist skill rows in `convex/skills.ts` + `packages/contracts` | executor files, any voice file |
| **B · Executor + lineage** | `.worktrees/lane-b-executor` | `lane-b/executor-lineage` | Phase 15 SC #4, #3, #5 | `convex/deliverApprovedPlan.ts`, `convex/plans.ts`, audit/telemetry lineage rows, the cross-tenant isolation assertion | `convex/llm.ts` (zero edits), voice files |
| **C · Voice-doc flagship** | `.worktrees/lane-c-voicedoc` | `lane-c/voice-doc` | Phase 14 (all SC) | `convex/voice.ts`, the new voice-doc module, `apps/web/app/(app)/dashboard/voice/*`, read-only use of `convex/evaluations.ts` **except the ONE authorized exception below** | `convex/llm.ts`, executor files |

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
lane run a live smoke without clobbering another's.

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
