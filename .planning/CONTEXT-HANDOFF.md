# Context Handoff — 2026-07-26

Written when the working session's context filled. Read this + `STATE.md` + `CLAUDE.md` to resume.
Everything below is committed and **pushed** (`origin/main` = `d19c729`, 0 ahead / 0 behind).

## Where the project is

```
v2.0  Phases 10 · 11 · 12 · 13 · 14 · 15 · 15.1   ✅ CLOSED
Next: /gsd:verify-work on Phase 15.1  →  Phase 16 (Research Sub-Agent & Web Research)
```

Phase 14 closed 2026-07-26 with an owner live human-verify on a real call (real duplex audio, real
model): the agent discussed the uploaded report, a mid-call drill-in returned a grounded answer, and
both outcome paths landed — memo saved to the vault, and a gap turned into a plan that produced an
email through the Approve gate. SC4 is enforced by seven mutation-verified static scans.

## Environment — READ BEFORE DEBUGGING ANYTHING UI-LEVEL

Two traps cost hours this session. Both are now in `docs/playbooks/voice.md`; repeating them here
because they present as product bugs.

1. **`pnpm start` serves a FROZEN production build.** A live voice session produced a generic
   assistant (*"I can't access any knowledge vault"*) that read exactly like a grounding regression.
   The code was fine — the running bundle had been compiled **4h14m before the first Phase-14
   commit**, so there was no picker, no `?doc=`, no `docId` at the mint, and therefore no document
   scope. **Run `pnpm build` before any UAT, and check the build timestamp against `git log` before
   believing a UI symptom.** `next dev` is not an option here (it OOMs on the workspace page).
2. **The local Convex deployment config is fragile.** `packages/backend/.convex/local/default/
   config.json` had been deleted; the backend kept running only because the live process held it in
   memory, so the break was invisible until a restart. If `npx convex dev` says *"Failed to load
   deployment config"*, that file is missing. It is reconstructible — `instanceSecret` falls back to
   a shipped public constant (`LOCAL_BACKEND_INSTANCE_SECRET`) and the loader does a bare
   `JSON.parse` with no schema validation, so it needs only `ports`, `backendVersion`,
   `deploymentName`. **`CONVEX_DEPLOYMENT`'s trailing `# team: … project: …` is a dotenv COMMENT,
   not part of the deployment name** — capturing it breaks the match silently.

Current runtime state (started from THIS session — they die with it, restart in a real terminal):
- web: `pnpm --filter @pikar/web start` → `localhost:3000` (built from `main`)
- backend: `npx convex dev` from `packages/backend` → `127.0.0.1:3210`, functions pushed,
  skills seeded, `document-analyst` active v1. `OPENAI_API_KEY` + auth vars set in the deployment.
- `npx convex dev --configure` **cannot be run from an agent shell** — it checks for a TTY, and
  piping stdin does not satisfy it (winpty does not help; it refuses piped stdin too).

## Outstanding work, in priority order

1. **`/gsd:verify-work` on Phase 15.1** — 7/7 plans complete, never verified.
2. **The `WAVE-0.md` post-integration items** (full rationale in `.planning/WAVE-0.md`, §A/§B/§D —
   read it, the design reasoning matters more than the task list):
   - **§A the `evaluations` facts split.** `evaluations` currently holds facts (the scorecard,
     **patched in place** on every in-conversation answer) in the same document as conclusions
     (findings/gaps/verdict). That violates two documented Convex rules —
     `convex/_generated/ai/guidelines.md:159` (every update rewrites the whole document) and `:160`
     (high-churn and stable data must not share a document). Splitting into an append-only
     `businessFacts` table is a **net deletion**: the patch branch, the seed-carrier branch, the
     deep-copy carry-forward, the provenance rebuild loop and `userProvided[]` all go, and storage
     moves from `O(tenants × weeks)` to `O(tenants × changes)`. Blast radius verified contained —
     nothing outside `evaluations.ts` reads `.scorecard` or `userProvided`.
   - **§B `gaps[].proofMetricPath`** — one optional field; makes the later outcome-ledger work pure
     logic with no migration.
   - **§D weekly-cron hardening** — `runWeekly` does an unbounded `.collect()` over every
     `business_profile` doc (reading full text to get tenant ids). It dies near **~3,000 tenants**,
     as a cliff, taking every tenant's review with it. Also: no jitter (whole fleet at one instant
     Monday 06:00 UTC), no cost-kill-switch check, no DLQ on failure, and `groundedDocCount` is
     computed for the audit but never stored — so nothing can tell a degraded week from a real one.
     **Re-derive before applying: `proactiveReview.ts` is no longer lane-unowned — Lane C edited
     `reviewOne`.**
3. **Phase 16** — Research Sub-Agent & Web Research (depends on the Phase-15 dispatch framework,
   which is now landed).

## Open by decision — do NOT fabricate either

- **Open Question 3 (tool-declaration branch).** Which branch the Realtime API accepts is
  **unrecoverable after a session**: `toolsAtMint` is returned to the browser
  (`voiceToken.ts:174-191`) and never persisted, and both branches are invisible in the UI. A
  successful drill-in proves *a* branch works, not which. `realtime.ts:107` carries the full note and
  names the one-line fix. `voiceToken.ts` has been wrong about that request body **twice** — a
  guessed value is worse than a blank one.
- **Retrieval round-trip latency.** Never timed. "Never observed as a problem" is weak evidence it is
  acceptable, not evidence it is fast.

## Gotchas confirmed this session

- **Mutation-verifying a static scan:** in `docReviewSchema`, `properties` keys are indented 10
  spaces and `required` 8. A literal-anchor mutation misses silently — the mutation *looks* applied,
  the test stays green, and the scan gets recorded as verified having never been exercised. Two of
  seven reported a false PASS this way. **Anchor on a regex.** Ledger is in the `llmRedaction.test.ts`
  header.
- **`packages/audit` had no `tsconfig.json`** since Phase 01-03, so root `pnpm typecheck` had never
  been green. Fixed (`d684640`). Root typecheck still exits non-zero on backend's **52 pre-existing
  test-file errors** — that is the documented baseline; **0 errors in source** is the real gate.
- **Stale codegen reads as source errors.** `convex/_generated/` is gitignored; if `api.d.ts` lacks
  a module you'll get phantom `Property 'x' does not exist` errors in *source* files. Regenerate
  before believing them.
- Backend suite is **643/643** — the long-documented `audit.test.ts` `auditCounts` red is now green.
  Do not re-document it as expected-red.
- `git worktree remove` fails on Windows against `node_modules` (`Directory not empty`); it
  deregisters anyway, then delete the folder with PowerShell `Remove-Item -Recurse -Force`.
- The `UV_HANDLE_CLOSING` assertion from `npx convex run` is benign exit noise — check the actual
  result, not the assertion.

## Uncommitted, deliberately left alone

- `Skills/` (untracked) — the owner-added Growth OS suite.
- `CLAUDE.md` (modified before this session started).
- `graphify-out/*` — regenerated artifacts, churn on every commit.
- **`packages/backend/.env.local.bak-pre-repair` and `.bak-before-configure` (untracked).**
  These are env-file backups that are **not covered by the `.env.local` ignore rule**. Do not
  `git add -A` without checking — delete them once the deployment is known-good.
