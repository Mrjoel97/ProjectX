# Phase 35 (proposed) — Outcome language and the idea-stage artifact (G23): research

**Source:** rev 5 audit G23 (`.planning/design/system-audit-2026-09-03-merged.md` §4, Track B step 8):
"Landing page sells 'connecting to your tools' and 'executes end to end'; actuator set is Gmail +
Calendar create; every specialist returns a memo; Command Center speaks 'binding constraint' and
'blocked work'. Rewrite in outcome language; make the artifact (finished offer + 30-day lead plan) the
product for idea-stage users, not a memo about one." Verified against the tree at `9c78be8`
(production, 2026-09-06). The audit carries no further prose on G23; this is the whole brief.

## Two halves, very different sizes

### Half A — the words (copy only, a few hours)

| Surface | What it says today | Why the audit objects | Pins that move with it |
|---|---|---|---|
| `apps/web/app/page.tsx` metadata + JSON-LD | "connecting to your tools", "executes it autonomously", "runs it end to end" | The actuators are Gmail send, Calendar create, vault documents, invoice reminders (after G22) and a weekly diagnosis with one staged proposal (Phase 34). "Connecting to your tools" is four parked connectors. | `homeEntry.test.ts` (eyebrow, CTA hrefs only) |
| `page.tsx` hero / how-it-works / will-not-do | "It plans and executes. You hold the gate." — process language (plan, gate, guardrails, audit log) | Says HOW it is governed, not WHAT you get. No outcome sentence: a reply drafted, a meeting booked, an offer written, a reminder sent, a diagnosis with the next move. | none on prose |
| `@pikar/core` `home.ts` `HOME_PRIORITY_COPY`, `HOME_SIGNAL_LABEL`; `CommandCenter.tsx` `CONSTRAINT_COPY`, `HEALTH_COPY`, hero lede | "Name your binding constraint", "Clear the blocked work", "Fix the failing gate", "Diagnostic gates", "Blocked work queue", "binding constraint" ×5 | Operator vocabulary on a tenant surface. "Binding constraint" is the blueprint's field name; "blocked work" is the dead-letter queue; "failing gate" is `diagnose()`'s ladder. | `home.test.ts` ("byte-identical to the expected strings"), `commandCenter.test.ts` `EXPECTED` (retyped on purpose), `e2e/command-center.spec.ts` (not CI; keep in sync) |

BRAND §1 already asks for "executive and outcome-first" headlines and keeps "Run the next revenue
move" as the canonical example — that h1 stays. The rewrite replaces mechanism nouns with what the
person gets or must do, and stays honest (BRAND: "never claim a send happened that didn't").

### Half B — the artifact (a new capability, one to two days)

**What an idea-stage tenant gets today.** Sparse-start onboarding admits a one-line description
(Phase 11). The weekly review then finds no grounded findings → `verdict: insufficient`, gaps
suppressed, `notEnoughData` asks (Phase 34 renders them as interview openers). `applyActOnGap` needs a
gap, so NO specialist ever runs for them; the offer-architect and lead-engine (which do know how to
"build the offer" from nothing and "pick the first channel") are unreachable. The Command Center's
first move for them is "Connect your mailbox". Nothing hands them a finished thing.

**What exists to build on (verified):**

| Piece | Where | Fit |
|---|---|---|
| Workflow packs: a skill body + a code-owned grant (`searchVault`, `webResearch`, `declareUnsupported`, `saveAsDocument`), leaf agent, `output: "document"` → `saveAsDocument` lands the reply as a vault document; started by `cockpit.startWorkflowPack({packId, text})` which returns a `threadId` | `@pikar/core` `workflowPacks.ts`, `llm.ts:506,1810`, `cockpit.ts:232` | EXACTLY "a finished document, not a memo". A seventh pack is registry + body + fixtures, no new tool, no new table |
| Offer-architect and lead-engine skill bodies: the value equation, the build sequence (select market → build → enhance → name), the four channels, "pick one channel and push it", lead magnets | `packages/contracts/skills/offer-architect.md`, `lead-engine.md` | The pack body borrows their method verbatim; both are already adapted from the $100M material the repo carries |
| Pack discovery is ACTIVE-only; the workspace lists packs as quick starts; owner preview path for candidates | `workflowPackDiscovery.listPacks`, `workspace/page.tsx:395-430` | The entry exists; a Command Center card can call the same action and open the returned thread |
| Pack activation gate: a `candidate` pack row needs pack-eval evidence (`run-workflow-pack-evals.mjs --candidate`, paid, per deployment) + browser evidence; the six pilot packs are candidates on prod today (G19). A NEW skill name with no rows seeds `active v1` on deploy (`seedSkills`, `rows.length === 0` branch) | `skills.ts:836-842`, 27-08/27-09 | The one real decision (below) |
| Pins a seventh pack id moves: `WORKFLOW_PACK_IDS` exact list (`workflowPacks.test.ts:66`), `schema.ts:2822` `packId` union, corpus-of-six pins (`workflowPackEvals.test.ts:118`, `packEvalSuite.test.ts:25`), fixtures required per pack (`run-workflow-pack-evals.mjs:475`) | | all mechanical |
| `MarkdownDocument` renders documents in the vault preview and the workspace | `dashboard/MarkdownDocument.tsx` | the artifact renders as a document already |
| Phase 31 (Marketing surface, tranche A) is "Not started — schedulable" and owns outbound channels + funnel, NOT the landing page or the Command Center | ROADMAP:1530 | no overlap; G23 does not touch Phase 31's scope |

**The artifact, concretely: pack `offer-and-lead-plan`.** Opener: "Write my offer and my 30-day lead
plan." Grant: `searchVault` (the profile is in the vault), `webResearch` (market/channel context),
`declareUnsupported`, `saveAsDocument`. Output: ONE document — (1) the offer: market/niche chosen, dream
outcome, the problems in the way and the solution stack, delivery, guarantee, name; (2) the money line
it needs the owner to confirm (price, 30-day cash) as questions, never invented numbers; (3) the
30-day lead plan: the one channel (warm list first), a lead magnet, week-by-week actions, the one
funnel step to watch. Every figure either cited from the vault or flagged as the owner's decision
(ADR-021 posture: the document is agent-authored draft content, saved as such; nothing enters the
scorecard). For a sparse profile the pack says what it assumed and what one answer would sharpen.

**Entry for idea-stage tenants.** A Command Center card ("Your first finished thing") shown when the
diagnosis cannot run yet — `agenda.current` is `null` or has no items — with one control that calls
`startWorkflowPack` and opens the returned thread. Derivable from a query the page already holds; no
stage flag needed. Everyone else sees it in the workspace quick starts as the other packs.

## Decisions (owner)

1. **Scope now:** copy only (Half A), or both halves.
2. **How the pack goes live:** (a) the pack gate — ship the body as a CANDIDATE with fixtures; you run
   `run-workflow-pack-evals.mjs --packs offer-and-lead-plan --candidate` against prod (paid, minutes)
   and activate; or (b) seed it `active v1` on deploy (new name, live at once, un-evaluated).
3. **Command Center entry:** the idea-stage card as above, or workspace quick-start only.

## Not in scope

Phase 31's marketing surface; the "every specialist returns a memo" shape for non-idea-stage tenants
(the pack is the artifact route; specialists stay memo-then-approve); the weekly review's
`insufficient` copy.
