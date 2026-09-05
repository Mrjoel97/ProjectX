---
phase: 35-outcome-language-and-the-idea-stage-artifact
plan: 01
status: complete
completed: 2026-09-06
commits: [see the phase-close commit's parent — feat(35-01)]
requirements-completed: [G23 half A]
requirements-pending: [G23 half B — the idea-stage artifact pack, plan 35-02]
---

# 35-01 — Outcome language on the landing page and the Command Center

**Landing page (`page.tsx`).** Title and description say what you get and what is never done without
you. The JSON-LD no longer claims "connecting to your tools" or autonomous end-to-end execution. Hero:
"It does the work. You approve it." with a lede naming a reply, a meeting, a document, and the Monday
next move. A new "What you get" section (replies sent; meetings and documents done; the next move every
week) sits above "How it works", which now reads as outcomes (say what you need → Pikar prepares it →
checks run first → you approve, edit or reject → it goes out and you see the record). "What it will not
do" and the ledger excerpt are unchanged — they were already true. Invoice reminders are deliberately
NOT promised until the QuickBooks lane passes (28.2 runbook). `homeEntry.test.ts` now scans the page for
the three retired promises.

**Command Center vocabulary (`@pikar/core` `home.ts`, `CommandCenter.tsx`).**
| Was | Now |
|---|---|
| Clear the blocked work / Blocked work queue / Blocked work (stat) / Open blocked work | Finish the work that stopped / Work that stopped / Work that stopped / Open the work that stopped |
| Fix the failing gate / Diagnostic gates | Fix the first thing blocking growth / Weekly review |
| Name your binding constraint / Binding constraint / Your binding constraint (card) / "No binding constraint on record" / "…types your binding constraint…" / "recorded in your blueprint… not the constraint itself" | Name what is holding you back / What is holding you back / (same) / "Nothing on record about what is holding you back" / "…says what is holding you back yet…" / "recorded in your business profile… not the bottleneck itself" |
| Degraded — "At least one source is reporting a problem." | Needs attention — "At least one thing needs you." |
| lede "…an honest answer about what is broken." | "…a straight answer on what needs you." |
Kept on purpose: the h1 "Run the next revenue move" (BRAND §1's canonical headline), "Nothing is blocked."
(plain English), the locked priority ORDER and routes (owner ruling 2026-08-23; only words moved).

**Pins moved with the words:** `home.test.ts` (byte-identical table), `commandCenter.test.ts` (retyped
EXPECTED + eight literal asserts + the signal-label map), `e2e/command-center.spec.ts` (ladder labels
and the stat label; not run in CI, kept in sync).

**Measured:** core `home.test.ts` 27/27; web `commandCenter.test.ts` + `homeEntry.test.ts` 65/65; repo typecheck 12/12;
contracts, core, extraction, pii, revenue, voice, billing, cost, vault all green; web 47/49 files with the two known jsdom-install artifacts of this worktree (`workflows/PinnedWorkflowButton`, `workflows/WorkflowPackCustomizer.container`; green on CI); biome ci exit 0. No Convex code changed.

**Playbooks:** dashboard-pages.md (Command Center words), beta-admission.md (the public page), cockpit.md
(co-owner of the browser spec) bumped.

**Half B handoff (plan 35-02, not started — a fresh session's work):** the seventh pack
`offer-and-lead-plan` through the pack gate, per 35-RESEARCH.md, with the pins found on 2026-09-06:
`WORKFLOW_PACK_IDS` + `WORKFLOW_PACKS` spec (grant: searchVault, webResearch+declareUnsupported,
saveAsDocument; missing: crm-facts, connector-financials, content-shelf; output document) →
`workflowPacks.test.ts` literal tables (ids at :66, grants at :247, web-research pair at :312, missing
sources at :469); `schema.ts:2822` packId literal; `PACK_THRESHOLD_FIELD` in `workflowCustomization.ts`
(one numeric dial, e.g. `plan_days` 14–60) + the ALL_KEYS literal in its test and the `PACKS` table in
`skills.test.ts:5227`; body `packages/contracts/skills/pack-offer-and-lead-plan.md` with a
"## What you cannot read" section using `MISSING_SOURCE_MENTIONS` phrases, mirrored to
`contracts/src/skills/packOfferAndLeadPlan.ts` and added to `PACK_BODIES` in `skills.ts`; provenance —
`hasValidPackProvenance` (workflowPacks.ts:847) and `packProvenanceFor` accept only the Apache-2.0
upstream shape, so an IN-HOUSE variant must be added to both, kept OUT of `KNOWLEDGE_WORK_PROVENANCE`
(its test asserts key parity with the vendor manifest); five fixtures in
`scripts/workflow-pack-fixtures/offer-and-lead-plan.json` (`--fixtures-only` rules: outcomes reachable,
missingNamed ⊆ matrix, unique needles) + a `thresholds.json` entry + `PACK_EVAL_SUITE` hash/count
(`packEvalSuite.test.ts` pins 6 → 7; `workflowPackEvals.test.ts` pins 6/30/5 → 7/35/5); browser spec
`TITLE_TO_PACK` and the dark-pilot title lists; Command Center "Your first finished thing" section reading
`workflowPackDiscovery.listPacks` and calling `cockpit.startWorkflowPack` then opening the thread.
Owner steps after deploy: `npx convex run skills:seedPackCandidates --prod`, owner preview in the
workspace, `run-workflow-pack-evals.mjs --packs offer-and-lead-plan --candidate` against prod, the
`workflow-pack-pilot.spec.ts` browser run, `activateSkill`.
