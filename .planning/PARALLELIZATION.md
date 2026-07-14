# Parallel Build Lanes (multi-session)

Three Claude Code sessions run in parallel, each in its own **git worktree** on its own
**branch**, integrating to `main`. This file is the shared contract — **every session reads it
first** and stays inside its lane. Set up 2026-07-14 after Phase 3.3.

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
