# Phase 27 — Readiness Audit

> Produced 2026-08-23 by a 19-agent readiness workflow (6 scouts over the nine plans, adversarial
> refutation of every HARD blocker, then synthesis). READ-ONLY: no code was changed to produce it.
>
> **Why it exists.** The nine plans were authored 2026-08-05. Phases 25.1 and 26 shipped after that,
> so every plan premise was re-checked against the code as it stands today rather than trusted.
> Premises are marked HOLDS / ROTTED / UNVERIFIABLE with file:line evidence.

---

# Phase 27 Decision Memo — Curated Knowledge-Work Pack Pilot

## Verdict

**GO-WITH-CHANGES.** All twelve HARD blockers raised across the six scouts were refuted, and none survived. Every one of them reduced to the same two non-arguments: "the wave-1 outputs don't exist yet" (that is the work, not an obstacle to it) and "a wave-5 plan needs the owner" (it is authored `autonomous: false` on purpose). What is left is real but cheap: a pile of plan-text rot — wrong paths, verify commands that provably cannot go red, and an upstream source table that names a directory absent at the pinned SHA — plus three genuine engineering decisions nobody has made (candidate-only first publication vs. `seedSkills`, whether packs run as leaf agents, and what the six packs are honestly allowed to claim). Do a ~1-sitting plan-correction pass, then start at **27-02**, not 27-01. Do not open 27-08 or 27-09 until the corrections land — those are the plans that cost money and owner time.

Scout disagreement worth recording: five clusters returned `readyToExecute: false`, one (`deps`) returned `true`. The five "false" verdicts are all justified by dependency ordering inside the phase, which is not a reason not to start. `deps` is right on the merits.

## What Phase 27 actually is

Anthropic publishes an open-source repo of "knowledge work plugins" — prompt/skill bundles for ordinary business tasks. Phase 27 vendors a pinned snapshot of that repo with proper Apache-2.0 attribution, then adapts six of those bundles into Pikar skill bodies (Business Pulse, Sales Call Prep, Campaign Plan, Brand Review, Process/SOP Builder, plus one more) that run on the agent loop the product already has. Each pack is a closed id with a code-owned list of exactly which existing tools it may use, so a pack can never quietly widen its own capability. The packs get published *dark* (candidate status, invisible to users), evaluated against fixtures, shown to the owner in a browser, and only then activated one at a time — with rollback drilled. Nine plans, five waves; the last one needs the owner in a chair.

## Rotted premises

| Plan | Premise | What is true now |
|---|---|---|
| 27-01, 27-RESEARCH | Adapted bodies live at `packages/contracts/src/skills/<name>.md` | That directory holds **auto-derived `.ts`** constants. Canonical bodies are `.md` in `packages/contracts/skills/` (30 files). `skillBodies.test.ts` asserts the pair stays byte-identical. Each adapted body is **two files + a sync-test entry**, and the manifest hash must pin the `.md`. |
| 27-01 | `pnpm vitest run scripts/knowledge-work-provenance.test.ts` runs | No root vitest, no root vitest.config, `scripts/` is not a pnpm workspace, turbo's test task cannot reach it. The test has **no home**. |
| 27-01 | Upstream source table is accurate at SHA `5267cf7` | `small-business/skills/ticket-deflector/` does not exist there (the tree has `customer-pulse` / `customer-pulse-check`). Sales Call Prep and Process/SOP Builder were never inventoried at all. 27-01 Task 1 is written to *fail closed* on an absent path — it will halt on its first task. |
| 27-02, 27-03, 27-07, 27-08, 27-09 | `pnpm --filter X test -- <name>` filters to the named test | **Measured false, three times independently.** `pnpm --filter @pikar/core test -- zzznonexistentfilter` ran 41 files / 1123 tests, green. The `--` is swallowed. Every such gate reads green whether or not the plan's test file was ever written. |
| 27-03, 27-08, 27-09 | The verify command names a file some task creates | Four name suites no file is called: `workflowPackTelemetry` (Task 2 creates `workflowPackEvents.test.ts`), `workflowPackPublication`, `workflowPackActivation`, `workflowPackRollback`. `deps` argues these are suite labels inside files that *are* in `files_modified`; either way, rename so the gate addresses something real. |
| 27-02, 27-09 | `node scripts/check-playbooks.mjs` is a gate | It reads stdin at module top (blocks forever if run bare) and every terminal path is `process.exit(0)`. It signals blocking via JSON on stdout. It can only ever read green. |
| 27-03 | A new `workflowPackEvents` table is a self-contained edit | Forces `packages/core/src/tenantData.ts` (isolation.test.ts and tenantData.test.ts both go red on an unclassified table), which is watched by `audit-dead-letter.md`. Neither is in `files_modified`. |
| 27-04/05/06 | Packs can compose Phase 26 summaries, the content shelf, CRM facts, brand guidance | **None of these are agent tools.** `reportsBusiness.ts` business/operations/sentMail are `tenantQuery`; `content.ts` is `tenantQuery`-only by construction; the only contact tools are `resolveContacts` (labels, never addresses) and `stageCrmWrite`. There is **no tenant brand store** — `brandVoice` is a per-plan string at `schema.ts:757`. |
| 27-05, 27-06, 27-07 | `convex/inbox.ts`, `convex/documents.ts`, `convex/artifacts.ts` | None ever existed. Real seams: inbox is `llm.ts` `listInbox:3377` / `briefInbox:3417` + `gmail.ts` + `briefings.ts`; created docs go through `llm.ts` `createDocument:3715` → `internal.vault.insertCreatedDoc` (llm.ts:3840); the bounded artifact read plane is `content.ts` (`listArtifacts`/`summary`/`artifactById`). |
| 27-07 | Task 1 builds a pack runtime | **`runSpecialistTurn` at `llm.ts:4633` already is** the `(skill body, tool-set)` seam, and `runAgentLoop:4230` already filters by exact `toolNames` (verified at 4351-4353). Task 1 is a ~40-line binding, not a runtime. Left unqualified an executor will write a second loop. |
| 27-07 | Passing `toolNames` is side-effect-free | **Verified at llm.ts:4337/4342:** `grantDispatch: toolNames === undefined`, `grantSkillAuthoring: toolNames === undefined`. Any pack with an allow-list is structurally a **leaf agent** — no specialist dispatch. Directly collides with 27-CONTEXT's "Campaign Plan composes research/content/media". |
| 27-07 | `runSpecialistTurn` can run read-only | `planId: Id<"plans">` is required. Analysis-only packs must mint or reuse a plan row, and `plans` is email-shaped with a closed `ACTION_TYPES` set. |
| 27-08 | The existing publisher can publish a first-ever pack candidate | **Verified:** `insertCandidate` throws `NOT_GATED` unless gated, then throws `NO_ACTIVE_SKILL` when `rows.length === 0`. And `seedSkills` inserts `version: 1, status: "active"` on `rows.length === 0` **regardless of gating** — and `packages/backend/package.json dev` runs `seedSkills` on every dev boot. Six new names in SEEDS go **live at v1, uneval'd, on the next boot.** |
| 27-08 | Adding the packs to `GATED_SKILLS` is free | `run-eval-golden.mjs` derives `SKILL_NAMES` from `GATED_SKILLS` by regex and drives `runCockpitAgent` over text fixtures. Gating a name the runner cannot drive recreates the document-analyst / media-director deadlock that `skill.ts:279-292` documents by name. |
| 27-09 | Paths `apps/web/app/(dashboard)/workspace/`, `apps/web/components/workflow-packs/`, root `e2e/` | Real: `apps/web/app/(app)/dashboard/workspace/`, components colocate under the route, `apps/web/e2e/` with `apps/web/playwright.config.ts`. There is no `apps/web/components` and no root playwright config. |
| 27-09 | Owner can preview a pinned candidate through the product | `skillVersions` exists only inside `llm.ts` (1576/4240/4643/4710). `cockpit.ts:99 sendCockpitMessage` and `useSendCockpitMessage.ts:35` don't carry it. This is the recorded "clock plane dead in production" class — the browser silently loads the ACTIVE row. Neither file is in 27-09's `files_modified`. |
| 27-09 | "Roll back to dark" has a path | Global registry has exactly one active-patch site and no owner-facing deactivate. Only dark path is `archiveSkill` via `npx convex run`, which `apps/web/e2e/README.md` measured as **signing the browser out**. Rollback-to-prior-version is supported. |
| 27-04 | Business Pulse composes a stable Command Center priority | `HOME_PRIORITY_ORDER` was reordered on **2026-08-23** (85daa4b) — connection-failure moved from priority 0 to sixth. Five files re-declare the order as a literal and none import it. |
| ROADMAP | Phase 25 is `0/14 Planned`, and gates Phase 27 | Seven Phase 25 SUMMARYs exist and their code is live (`invites.ts` `requestAccess`/`preflight`/`approve`, `betaWaitlist`/`betaInvites`, `beta-admission.md`). And no Phase 27 plan references a single Phase 25 artifact — grep for outlook/invite/waitlist/custom-domain across all nine plans returns zero. The roadmap cell is stale bookkeeping that will keep re-manufacturing this false dependency. |

**Needs re-planning rather than execution: 27-09 only.** Its route paths, component directory, e2e location, rollback story and candidate-preview mechanism are all wrong or unsupported. Everything else is edit-in-place.

## Blockers that survived

**Zero of twelve HARD blockers survived refutation.** Refuted: 27-01..27-07 unbuilt (that is the work; 27-01 and 27-02 are wave 1, `depends_on: []`); wave-2 lanes depend on wave-1 outputs (the wave field enforces exactly that); fabricated key_links (inert planning metadata — no script reads `key_links`, and 27-RESEARCH already names the right seams); the tenantData/audit-dead-letter playbook conflict (25-01 set the precedent by doing exactly that, and the Stop hook blocks once then exits 0); table category undecided (`tenant_owned` is forced by the phase's own research and is a one-token reversal); recommendation-shown has no terminal (`CommandCenter.tsx` + `home.ts recommendNextMove` already ship a recommendation card; the caller lands in the same phase with browser proof); owner checkpoint (wave 5 of 5, ~90% of the phase runs first); e2e credentials (`e2e-wave6@pikar.test` / `pikar-e2e-2026-Wave6!` are committed in `26-13-UAT-SCRIPT.md` and `26-20-UAT-SCRIPT.md`, the stack answered on :3111/:3210, and the expired JWT self-heals via `--project=setup`); component-test harness absent (`apps/web/app/(app)/dashboard/workspace/groundedSources.test.ts` renders a `.tsx` via `renderToStaticMarkup` and was run: 5 passed); vacuous verify commands (a plan-text edit); 27-08's runner (its own wave-1 deliverable, and `recordEvalEvidence` has zero writer-identity check so a second runner satisfies the gate today).

What remains are SOFT items that must be resolved **before the wave they land in**, not before the phase starts. The four that are real engineering, not typos:

**1. `seedSkills` will activate the six packs at v1 on the next dev boot.**
Real: verified in source above. Both branches are hostile — `seedSkills` auto-activates an unseeded name, `insertCandidate` refuses one. This is the actual content of 27-02 Task 2 and the only thing standing between "dark pilot" and "six uneval'd skills live".
Cheapest unblock: keep the six pack bodies **out of `SEEDS` entirely** and give the packs their own first-publication mutation that always mints `status: "candidate"`. Do **not** change the `rows.length === 0` branch generally — `skill.ts:266-268` and `skills.ts:557` lean on it by name, and CLAUDE.md §7 forbids a fresh clone failing closed.

**2. Packs with a tool allow-list cannot dispatch specialists.**
Real: `llm.ts:4337/4342`, verified. Undecided in every plan.
Cheapest unblock: accept it. Packs are leaf agents; the Executive Agent keeps composition. Rewrite Campaign Plan's brief so it *produces a plan* rather than orchestrating research + content + media. Decide this before 27-04/05/06 author a single body.

**3. Three of the six packs are specified against capabilities the agent cannot reach.**
Real: Phase 26 summaries, the content shelf and CRM reads are `tenantQuery`-only; there is no tenant brand store at all.
Cheapest unblock: classify them **MISSING** in 27-02's matrix and let the phase's own honest-partial-state contract carry it. Do not add new read tools — that is scope no plan owns and it inflates the eval corpus. If that guts Business Pulse and Brand Review to the point of not being worth shipping, cut them from the pilot rather than building tools for them.

**4. Eval cost exceeds the runner's own cap.**
Real: ~35-55 fixtures across six packs; ~$0.017/case plain, ~$0.21/case when research dispatches; `COST_CAP_USD = 2.0` in `run-eval-golden.mjs:88`; evidence only writes on an all-green unfiltered run, and one teardown crash discards the whole gate. Realistic 3-6 attempts = **$10-25**, plus Tavily.
Cheapest unblock: run **per-pack**, not per-corpus (27-08 Task 3 already has per-pack isolation, and 27-VALIDATION says failure blocks only that pack). Cap fixtures at ~5 per pack. Cut the pilot to three packs.

Plus the mechanical ones, all one-sitting: rewrite every `pnpm --filter X test -- <name>` to `cd <pkg> && npx vitest run <path>`; fix 27-09's four paths; add `skill-registry.md` (27-02/04/05/06/08), `cockpit.md` (27-07/09) and `audit-dead-letter.md` (27-03) to `files_modified`; re-inventory the upstream tree at `5267cf7` before 27-01 Task 1 runs; pick a home for the provenance test inside an existing package.

## Recommended execution order

**Run 27-02 first — not 27-01.** Both are wave 1 with no dependencies, but 27-02 is where the only load-bearing engineering lives (the candidate-only publication path, the tool-grant registry, the operation matrix), it is entirely offline and internal, and every downstream plan reads its output: 27-04/05/06 cannot write a body without the operation vocabulary, 27-07 cannot bind without the grants, 27-08 cannot publish without the candidate path. 27-01 by contrast needs a network fetch **and** its source table is wrong at the pinned SHA, so it will halt on its first task until someone re-inventories the upstream tree.

0. **Plan-correction sitting** (no code, no money). Verify commands, 27-09's paths, playbook entries, upstream source table, test homes. ~1 hour.
1. **27-02** — registry, matrix, candidate-only first publication, fixture runner. Add the `workflowPackEvents` `defineTable` here too (it already owns `schema.ts` and `watch.json`), with `tenant_owned` and a `ponytail:` comment naming the open erasure question. Register `packages/core/src/workflowPack` and `packages/backend/convex/workflowPack` prefixes in `watch.json` while you're in there.
2. **27-01** — after re-inventorying the upstream tree. *Needs network* (one fetch of a pinned commit; no credit, no human).
3. **27-03** — metrics module only, table already landed. Downgrade its success criterion from "PACK-04 is measurable" to "measurable in principle"; the real gate belongs on 27-07. Rename the backend-side module so it doesn't collide with `packages/core/src/workflowPackMetrics.ts`.
4. **27-04 / 27-05 / 27-06** in parallel — bodies + fixtures, keyed to 27-02's matrix. Cap fixture counts here, before 27-08 inherits the bill.
5. **27-07** — re-scoped to a binding on `runSpecialistTurn`. Wrap the new entry point in `traced()` (`lib/foglamp.ts:92`) or the pack lane is the one model path invisible in Foglamp, and no test catches it.
6. **27-08** — ***first plan that costs money.*** Per-pack runs, ~$0.35-4 each, 3-6 attempts likely. Needs a verified-stable `convex dev` (17.1-10 burned three consecutive live attempts on timeout / socket 10013 / DNS ENOTFOUND). **Name the deployment explicitly** — evidence is a column on the skills row with an exact-version pin, so a dev-deployment eval can never certify a prod candidate, and version numbers differ per deployment. Recommend: dev only, and state that "activation" in 27-09 means dev only.
7. **27-09** — ***needs the owner and a live stack.*** Two sittings minimum: Tasks 1-2 (UI + Playwright evidence, all packs dark) autonomously, then a real owner sitting for Task 3's per-pack approve/reject, then Task 4. Requires a **prod build served on :3111** (`next dev` is OOM-fragile on exactly the workspace page this UI lands on), `convex dev` not `--once`, and the seeded e2e account. Add `cockpit.ts` + `llm.ts` to Task 1 if the owner candidate preview is to be real rather than a lie.

Cannot run autonomously: **27-08** (OpenAI + Tavily credit, live stack), **27-09** (owner judgment, live stack, browser). Everything from 27-01 through 27-07 is offline except 27-01's single upstream fetch.

## What I would NOT do

**Do not build a second eval runner at repo root.** `scripts/` is not a workspace, has no vitest, and cannot reuse `smokeRun.mjs`'s `cwd: backendDir` convex invoker. Meanwhile `packages/backend/scripts/run-eval-golden.mjs` already has the convex invocation, the cost cap, the evidence write and 46 fixtures beside it. Put `run-workflow-pack-evals.mjs` and its fixtures under `packages/backend/scripts/` — same directory, already covered by `agent-runtime.md`'s watch prefix. Two evidence-writing runners against one `evidence` column and one choke point is a defect waiting to happen, especially since global-scope evidence has **no suite-identity binding** (only agent-scope rows get `AGENT_EVAL_SUITE`), so stale pack evidence goes undetected.

**Do not build `workflowPackRuntime.ts` as a runtime.** `runSpecialistTurn` is it. Cap 27-07 Task 1 at a pack-id → `{skillName, toolNames, prompt, planId}` binding and say so in the plan text, or you get a second agent loop in a file whose header says "There is NO second loop".

**Do not create `artifacts.ts`, `inbox.ts` or `documents.ts`.** They are hallucinated paths, and 27-RESEARCH's own Don't-Hand-Roll list forbids a second artifact store. Re-point at `content.ts`, `llm.ts` and `internal.vault.insertCreatedDoc`.

**Do not re-emit cost and latency into `workflowPackEvents`.** `spendEvents` owns cost (rail `reasoning`, by_correlation) and `telemetry.durationMs` / `agentSteps` own latency. A duplicate cost number that can disagree with the billing plane is worse than no number. This would be the *fifth* tenant event plane beside `audit`, `telemetry`, `agentSteps` and `spendEvents`; keep it to the events that genuinely have no home (pack run lifecycle, plan decisions, missing-source surprise, recommendation impressions) and read cost/latency from their existing owners.

**Do not add new read tools** for Phase 26 summaries, the content shelf, or CRM just to make the packs look complete. Classify MISSING; the honest-partial contract is the product feature here.

**Do not treat Phase 25 or 17.1-10 as prerequisites.** Phase 25 is downstream of the same unfinished lanes Phase 27 consumes — treating it as a gate is a cycle, and no Phase 27 plan touches a Phase 25 artifact. 17.1-10 blocking 18-09/18-10 means the Output-card *browser gate* never ran, but `createDocument` is live and cockpit-agent is certified at v17. Ship the packs against the current connector state with missing sources named honestly.

**Cut six packs to three for the pilot.** Business Pulse and Brand Review are the two most starved of real capability (no summary tool, no brand store), and the eval corpus is the phase's only real cost. Prove the machinery on Sales Call Prep, Process/SOP Builder and one more, then add the rest once the pack runner has a green run behind it.

**Cut 27-09's rollback-to-dark drill, or add an owner-facing dark path first.** As written the only mechanism is `archiveSkill` via `npx convex run`, which signs the browser out mid-spec. `skills.ts` is already in 27-09's `files_modified`, so adding a proper deactivate is in scope — but it is new registry surface, and sequencing all browser evidence before the drill is the free alternative.
