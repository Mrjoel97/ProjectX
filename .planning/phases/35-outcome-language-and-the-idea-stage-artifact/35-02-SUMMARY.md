---
phase: 35-outcome-language-and-the-idea-stage-artifact
plan: 02
status: complete (code); going live is the owner's gate run
completed: 2026-09-06
commits: [see the phase-close commit's parent — feat(35-02)]
requirements-completed: [G23 half B — the idea-stage artifact, shipped dark through the pack gate]
requirements-pending: [the owner's five-step gate run below; until it passes the pack is a candidate and the Command Center card does not exist]
---

# 35-02 — The `offer-and-lead-plan` pack and the first-thing card

**What an idea-stage user gets.** One document, saved to their vault: the offer (the niche and the
four-part market check, the dream outcome, the problem→solution stack, guarantee + reason to act, a
name) and a 30-day lead plan (ONE channel by the warm-first / time-versus-money rule, one lead magnet,
four weeks of COUNTED actions, the one funnel number to watch). Price, terms and 30-day cash are
QUESTIONS for the owner — the body forbids any money figure, the threshold row enforces zero — and the
last section says what was assumed and asks the one question that would sharpen it most. A one-line
business is the normal input, not a blocked one.

**The registry (`@pikar/core`).** Seventh id `offer-and-lead-plan`, `pack-offer-and-lead-plan`, title
"Offer and lead plan", opener "Write my offer and my 30-day lead plan.", `output: "document"`. Grant =
`searchVault` + `webResearch`/`declareUnsupported` + `saveAsDocument` (campaign-plan's shape); missing =
`crm-facts` (the warm list), `connector-financials` (price, cost per lead), `content-shelf` (a reusable
magnet). Customization dial `plan_days` 14–60. Every literal pin moved 6→7 (ids, grants, research pair,
missing table, outputs; `schema.ts` + `workflowPackOutcomes.ts` unions; `READABLE` + `ALL_KEYS`;
`WORKFLOW_PACK_SKILL_NAMES` + the `PACKS` handler table; `listPacks` candidate list; `packEvalSuite.test`
6→7; `workflowPackEvals.test` 6/30→7/35 and the injection-plant literal).

**Provenance — the one gate change (ADR-034).** `hasValidPackProvenance` accepted only Apache-2.0.
`PACK_PROVENANCE_LICENSES = ["Apache-2.0", "Pikar-original"]`; every other field keeps its rule. The
record is `IN_HOUSE_PACK_PROVENANCE` (beside the vendor mirror, not in it — the manifest parity test is
untouched): this repo, commit `3f77378bc036ffeae4c138ddefb4d71df3368ecb` (where `offer-architect.md` and
`lead-engine.md`, the method sources, last changed), their paths, the body hash
`72949904d7c7…ea50d`, a notice, and that commit's timestamp as `ts`. `packProvenanceFor` reads vendor
first, in-house second. Its own test hashes the `.md` on disk and checks the paths exist.

**The gate corpus.** `offer-and-lead-plan.json`, five cases: 01 one-line business (happy path, all
three gaps named, document saved), 02 asks for a price (both land as questions), 03 unsupported market /
best-channel claim (declare, still deliver), 04 no list / no money / only time (one channel, by the
rule), 05 injected pasted blurb (turn-text injection; forbids reply/plan/dispatch/send-time tools).
`thresholds.json`: `minCasesPassed 5`, `maxUnsupportedFigures 0`, `minCitationsWhenWebRead 1`.
`PACK_EVAL_SUITE` gained a seventh row WITHOUT a revision bump (the six certified rows are byte-unchanged,
so their evidence stands). `--fixtures-only`: 35 valid.

**The Command Center card (`first-thing`, own boundary).** Reads ACTIVE-only `listPacks` + `agenda.current`
and renders ONLY when the pack is offered AND the agenda has nothing to rank (`null`, or `items: []` —
`asks` alone do not hide it). "Write it now" → `cockpit.startWorkflowPack({ packId, text: opener })`
(the quick-start seam; never `previewVersion`) → status line + link to
`/dashboard/workspace?thread=<id>&label=<title>`; the workspace deep link now honours `label`. No send,
schedule or approve word on the card. Dark pack ⇒ no card, with no flag.

**Dark on deploy, by construction.** The body is in `PACK_BODIES` (→ `seedPackCandidates`) and NOT in
`SEEDS`. **Owner steps to go live (in order):**
1. `cd packages/backend && npx convex run skills:seedPackCandidates --prod` — inserts
   `pack-offer-and-lead-plan` v1 as a CANDIDATE (the six others are idempotent no-ops).
2. Preview it as owner in the workspace candidates section; read the document it saves.
3. `CONVEX_URL=<prod url> node scripts/run-workflow-pack-evals.mjs --packs offer-and-lead-plan
   --candidate` (paid; five cases; evidence lands on the prod row only — EVAL_GATE is per deployment).
4. The browser run: `workflow-pack-pilot.spec.ts` against prod (`TITLE_TO_PACK` carries the new title;
   the @evidence writer records its row).
5. `activateSkill` for `pack-offer-and-lead-plan@1`. From then on `listPacks` returns it, the workspace
   offers it as a quick start, and the Command Center card appears for tenants whose agenda is empty.

**Measured.** core 1501/1501; contracts 122/122; backend two shards 67 files / 2036 tests + 66 files /
1933 tests, both exit 0; web `commandCenter.test.ts` 66/66 (five new), full web 47/49 files with the two
known jsdom-install artifacts of this worktree (green on CI); repo typecheck 12/12; `pnpm lint
--diagnostic-level=error --max-diagnostics=none` exit 0.

**Playbooks:** workflow-packs.md, skill-registry.md, dashboard-pages.md, cockpit.md bumped; ADR-034 added.
`knowledge-search-routines.md` owns `workflowCustomization.ts` per watch.json — the dial row there is one
literal in a table that playbook already describes; not re-verified beyond the green suites.
