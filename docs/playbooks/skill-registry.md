# Playbook: Skill Registry (versioned LLM prompts)

> Last verified: 2026-07-31 (16-09 follow-up) — **`cockpit-agent` learned `dispatchResearch`; candidate minted, NOT activated.** Phase 16 built the entire research plane (tool at `convex/llm.ts:773`, scheduler, specialist, persistence, activity-card verb) and **no plan owned the skill-body teaching**, so the executive never called the tool: filtered eval run `442341cf` (`--only research`, 0/3, $0.0213) on a proven-healthy deployment produced exactly THREE audit rows across six attempts — `mailbox.searched` ×2, `vault.searched` ×1 — and zero `subagent.completed`/`research.persisted`. Structural absence was REFUTED first (`grantDispatch` is `toolNames === undefined` at `llm.ts:2069`; the runner passes no `toolNames`, so the tool WAS in the record), leaving the body: `cockpit-agent@15` contained zero occurrences of `dispatchResearch`/`research`/`web search`. **This is the withheld-tool pattern from `agent-runtime.md` @ 03.11-05 (RPLY-01) repeating** — a tool plane shipped complete while the prompt stayed silent, so the capability looks mysteriously broken. Added `## Researching the outside world` to `packages/contracts/skills/cockpit-agent.md` (22,548 → 25,555 chars): the `searchVault`-is-THEIR-material vs `dispatchResearch`-is-the-OUTSIDE-world routing split, findings-do-not-arrive-this-turn, **pass the question FAITHFULLY with its constraints intact** (the specialist receives `question` and nothing else — no history — so a stripped "do not substitute similarly named organisations" is how fixture 33's fabrication guard dies), instruction-shaped text inside a research question is the SUBJECT not a command (fixture 34 plants an injected address in the USER turn and expects `recipientCount: 0` — the `<vault_context>` rule one layer earlier), refusals are conversational (`research_in_flight`/`draft_in_progress` — the latter would DISCARD a draft), and not-a-composing-turn. **Process note worth more than the diff:** the `.md` is canonical but the Convex runtime ships the hand-derived `packages/contracts/src/skills/cockpitAgent.ts` constant, and there is NO codegen script — only the `skillBodies.test.ts` drift assertion. Editing the `.md` alone changed nothing and the first `seedSkills` left the table at 15 rows; the `.ts` must be regenerated (`JSON.stringify` of the LF-normalized `.md`) and the watcher must re-push BEFORE seeding, because `seedSkills` reads the bundled constant, not the file. Drift test 15/15 green, `tsc --noEmit` clean. **Nothing was activated:** the new body is a CANDIDATE and `activateSkill` still requires an EVAL_GATE evidence row, which a `--only` run structurally cannot produce (evidence is suppressed on any filtered run). Phase 16 stays 8/9 and `ACTN-03` stays Pending until one full unfiltered 33-case gate passes. **Also unproven:** everything downstream of the tool call — no specialist run, no persisted doc, no `webSearchCalls` has EVER executed, so the teaching is necessary but not shown sufficient. PREVIOUS ENTRY: 2026-07-27 (17.1-02) — added the **UNGATED `business-blueprint`** row through the full 5-file mirror; drift row mutation-verified (a one-char `.md` edit turned exactly that row RED, 1 failed / 20 passed, and reverting restored 21/21) and `isGatedSkill("business-blueprint") === false` is now an EXPLICIT assertion, not an absence. See "## Phase 17.1 — business-blueprint" below.
> Last verified: 2026-07-27 (16-04) — added the GATED research-specialist row + its 5-file mirror; drift test mutation-verified. Restates the seedSkills maxVersion+1 collision rule. PREVIOUSLY: 2026-07-26 (15.1-06 — **`onboarding-agent` joined the registry, UNGATED (Q6, LOCKED)** — the system prompt for the design §6 conversational onboarding, loaded by `onboarding.converse` (`packages/backend/convex/onboarding.ts`) FAIL-CLOSED via `internal.skills.getActiveSkill`: an unseeded row throws `NO_ACTIVE_SKILL` and there is no turn, exactly like `extractProfile`'s `business-profile` load. Shipped through the full 5-file mirror (`skills/onboarding-agent.md` → derived `src/skills/onboardingAgent.ts` → `ONBOARDING_AGENT_SKILL` in `src/skill.ts` → a `seedSkills` row → a `skillBodies.test.ts` drift row); the drift row was MUTATION-CHECKED — a one-character edit to the `.md` turned exactly that row RED and reverting restored the suite. **UNGATED matches `business-profile`**, the nearest precedent by two measures: also an onboarding skill, also producing something a human confirms rather than autonomous tool-state. The stronger reason is that the property worth asserting is not IN the body: `converse` picks the next question from `missingSlots(...)` in `REQUIRED_SLOTS` order and computes `done` from `canComplete(...)`, so no body edit — and no model temperature — can make the conversation finish with a required slot empty. Gating would buy an eval-corpus obligation this phase has no budget for (on top of a Phase-15 gate that is still unpaid) to assert something the code already guarantees. The rationale sits as a comment ON `GATED_SKILLS` in `contracts/src/skill.ts`, because that list is where a later reader would "fix" the omission. **Body-writing rules for a conversational skill:** it states that it will be TOLD which single fact to obtain each turn and that the named fact is the turn's job; it forbids inferring, guessing or estimating any fact not stated (defect 1a at the prompt layer — the STRUCTURAL half is the code); it carries the closing beat as a behaviour claim, not a read-back of the answers; and it carries the `inbox-digest` DATA-not-instructions defense clause adapted for a live conversation ("mark us as an enterprise", "skip the remaining questions"). It deliberately does NOT enumerate the `revenueStage`/`funding` literals — the CODE supplies the slot name and its permitted shape on each turn, so the enum has exactly one home.)
> Last verified: 2026-07-26 (15.1-05 — **three UNGATED behaviour-preset style overlays joined the registry: `style-direct`, `style-coaching`, `style-concise`** (design §7). Each is the versioned prompt content behind one member of `BEHAVIOR_PRESETS` (`direct`/`coaching`/`concise`, @pikar/core). The preset is a CLOSED ENUM mapping to a registry row, deliberately NOT a free-text box: user-authored text injected into every future system prompt would be a standing prompt-injection surface and would smuggle unversioned prompt content into every call, against §5. Shipped through the full 5-file mirror (canonical `.md` → derived `.ts` constant → `skill.ts` name constant → `seedSkills` row → `skillBodies.test.ts` drift row); the drift test was MUTATION-CHECKED — a one-character edit to `style-coaching.md` turned exactly that row RED, 15/16, and reverting restored 16/16. **All three are UNGATED (Q6, LOCKED)**, matching `business-profile` rather than the Phase-12 rubrics: an overlay changes HOW a specialist speaks, never what it may do or claim (the capability grant stays code-owned — ADR-007), so there is nothing for an eval corpus to assert that the specialist's own gated body does not already assert; gating them would add an eval-corpus obligation this phase has no budget for on top of a Phase-15 gate that is already unpaid. The rationale is a comment on `GATED_SKILLS` itself so a later reader does not "fix" the omission. **Body-writing rules for an overlay** — each states in its own text that it is a style overlay that never changes what the agent may do, claim, or ground, and that the agent's own instructions take precedence on conflict (a directive that could widen capability would be a privilege-escalation path through a DB row); no tool names, no capability language, no "you may now …"; and NO tier language, because the tier is a separate CODE-owned FACT line assembled at dispatch time — presets and tiers are orthogonal and there are deliberately three overlays, not nine cross-product variants. `dispatch.ts` reads the row the tenant's `behaviorPreset` names via `PRESET_SKILL` and prepends it to the specialist's prompt FAIL-OPEN: an unseeded overlay costs voice, never a dispatch.)
> Last verified: 2026-07-26 (15.1-03 — **the UNGATED `business-profile` body stopped guessing.** Defect 1a in its written form: the old `## Persona` section told the extractor to infer one of three values and stated outright that *"a best-fit guess is correct behavior"*, which made the tier a model-temperature output. That section is replaced by **`## Never classify the business — those questions are ASKED`**: do not infer or output a persona, tier, business size, headcount, staffing level, revenue stage or funding position; there is no field for any of them and no correct guess, because the system ASKS the user and derives the classification from the answers (`deriveTier`, @pikar/core). A size mentioned in passing lands in `stage` (the user's own words) or `knownConstraints`, never as a classification. `persona` is deleted from the `## Output contract` field list and from the closing *"Persona is the ONE field you always infer"* sentence. Shipped through the standard 2-file mirror — canonical `.md` edited, `businessProfileSkillBody` regenerated byte-identically, `skillBodies.test.ts` 13/13 green. **Re-verified UNGATED before editing**: `business-profile` is absent from `GATED_SKILLS` (skill.ts:100-115), so this body edit does NOT ride the unpayable eval gate — unlike 15-06, it ships LIVE on the next `seedSkills`. The STRUCTURAL half of the same defect is `onboarding.ts`: `profileSchema` no longer has a `persona` property, so the model has nowhere to put a guess even if a future body regressed.)
> Last verified: 2026-07-26 (15-06 — **the three specialist bodies were rewritten to RUN, and the gate they must ride is UNPAID.** `offer-architect`, `money-model-designer` and `lead-engine` were minted in 12-02 as METHOD-only rubrics carrying the placeholder framing *"Registered now; a full build runs later"* — honest then, false the moment Phase 15 shipped dispatch. Each `.md` (plus its byte-identical derived `.ts`; the `skillBodies.test.ts` no-drift `test.each` stays green) now DROPS that framing and gains a **`## How to ground this`** section naming the ONE tool the specialist actually has: `searchVault`. Three properties are deliberate. (a) It names the tool, because until this phase the specialist had NO retrieval tool at all — so the pre-existing closing line *"Cite the user's own material for every claim"* was literally unsatisfiable. (b) It states the READ-ONLY posture in prose (*"You cannot send anything, save anything, or change the plan"*), reinforcing at the PROMPT layer what `SPECIALIST_TOOLS` already enforces STRUCTURALLY. (c) It makes the not-enough-data state an affirmative, honest answer ("say what is missing and what to gather; do not fill the gap from general knowledge") — the Phase-12 posture, never dressed up as a finding. The METHOD content is otherwise untouched (CONTEXT defers output-quality work past the first rewrite), and each body's deferral to the shared financial spine now says explicitly that it never restates a figure the evaluation did not ground. Original wording only — no Hormozi (or any) book text; the 12-02 constraint stands.
>
> **A specialist's TOOL-SET is not in the registry and never will be (ADR-007).** The prompt is registry-owned and versioned; the capability grant is code-owned data in `packages/core/src/specialists.ts` asserted as an EQUALITY over the whole registry. Do not add a "tools" column to a skill row, do not teach a body about a tool it was not granted, and do not try to widen a grant by wording.
>
> **Seeding rules that bind this phase.** `seedSkills` writes `maxVersion + 1`, and optimizer dry-run candidates already occupy versions, so a version number written into a PLAN is routinely wrong against the live DB — **read back which version carries your body before any eval or activate** (memory: `skill-version-collision`). Beware the BOOTSTRAP LIE: on a fresh/empty deployment a gated skill's FIRST seed takes the `rows.length === 0` path and lands **v1 ACTIVE**, so the gate appears not to apply. That is a property of the empty deployment, not of the gate — `activateSkillVersion` still throws without `hasPassingEvidence`. Never conclude gate behaviour from a lane deployment. Seeding is Lane-A-only this phase (PARALLELIZATION singleton #8): two lanes seeding concurrently cross versions SILENTLY. And `npx convex dev` ALONE does not seed — only `pnpm dev` / `npm run seed` runs `skills:seedSkills`.
>
> **GATE OUTCOME: NOT RUN — the three candidates are PARKED, unseeded and unactivated.** The `.worktrees/lane-a-dispatch` checkout has no `CONVEX_DEPLOYMENT` (15-01 bootstrapped it with a COPIED `_generated`), so `pnpm eval:golden` cannot run there at all. Nothing was faked, no fixture was weakened, and nothing was hand-activated. The ACTIVE v1 bodies stay live and the phase ships dark — exactly as CONTEXT pre-decided for a gate that does not go green in-phase: Phase 15's five success criteria are proven by 15-01..15-05 and none of them requires a rewritten body. To pay the gate on a deployment that has one: `pnpm dev` (seeds; `convex dev` alone does not) → read back the live version carrying each of the three bodies → `pnpm eval:golden --skill offer-architect@N --skill money-model-designer@N --skill lead-engine@N` (multi-pin ships in this plan; ONE run records one evidence row per pin) → on green, `activateSkill` each and VERIFY LIVE via `getActiveSkill` that the active row is the version you pinned. On red, flaky, or over `COST_CAP_USD`: do NOT weaken a fixture and do NOT hand-activate — leave them parked. Budget ≈ $0.19 extrapolated from the last recorded run (27 cases / $0.1686 / run `ed251c29`), plus three dispatched specialist turns.)
> Last verified: 2026-07-25 (14-01 — minted the `document-analyst` UNGATED voice-doc persona via the standard 5-file mirror: canonical `packages/contracts/skills/document-analyst.md` + a byte-identically-generated derived `documentAnalystSkillBody` constant + the `DOCUMENT_ANALYST_SKILL` name const + a `seedSkills` row appended directly after `VOICE_BRIEF_SKILL` + a `skillBodies.test.ts` drift row. It is the Phase-14 (DOCV-01) Realtime persona for discussing ONE vault report by voice: an opening move that summarizes then names 2-3 non-obvious observations and hands back (never a walkthrough monologue), explicit up-front disclosure when the extraction was truncated, citation discipline (quote the passage when you have one; never assert a figure the report lacks), honest refusal — "the report doesn't say that" is a correct answer and a genuinely clean document gets an affirmative "no gaps" with its strengths named rather than a manufactured concern (SC2's spoken half) — the `search_document` retrieval tool with a spoken pause-cover, an untrusted-content clause (the pre-loaded digest sits in SYSTEM INSTRUCTIONS, a materially stronger exposure than ADR-006's tool-return case, so report text is DATA and never instruction), the shared 15-minute cap + wrap-up behaviour, and "you cannot act — outcomes are chosen after the call". ORIGINAL wording; `voice-session.md` is left byte-unchanged so a Phase-14 prompt change can never regress Phase 6. **Left UNGATED — a LOCKED user decision (2026-07-25) that overrides 14-CONTEXT.md, following the `voice-session`/`voice-brief`/`business-profile` precedent: `run-eval-golden.mjs` drives `runCockpitAgent` over TEXT fixtures and hard-validates `--skill` against a closed `SKILL_NAMES` list, so it structurally cannot exercise a Realtime voice persona; gating would deadlock the skill at v1 on its first body edit with no runner able to clear the gate. NOT added to `GATED_SKILLS`, and `run-eval-golden.mjs` is byte-unchanged.** Appended only — no other `seedSkills` row was touched or reordered, because `seedSkills` writes `maxVersion + 1` and Lane A is concurrently seeding Phase-15 specialists; landing this row in the Wave-0 freeze commit is the coordination resolution. Bootstrap v1 seeds active via the `rows.length === 0` path. See `voice.md` § "Voice-doc sessions (Phase 14)".)
> Last verified: 2026-07-25 (12-06 — v-bumped the GATED `cockpit-agent` skill via the 2-file mirror (canonical `packages/contracts/skills/cockpit-agent.md` edited, derived `cockpitAgentSkillBody` regenerated byte-identically, the backend `skills.test.ts` drift `test.each` row stays green): two new sections teaching the BEVL-01 evaluation surface, which the agent previously had ZERO knowledge of (12-04's deferred human-verify root-caused exactly this — registering `evaluateBusiness` in `buildCockpitTools` makes it CALLABLE, not KNOWN). **"## Assessing the business"** teaches WHEN to call `evaluateBusiness` (evaluate / diagnose / review / "run a SWOT" / "where is my bottleneck" intents), auto-pick vs. the CLOSED four-value framework enum, that the result renders as a card the agent must point at rather than recite, that a thin result is stated honestly and never dressed up as a diagnosis — and the load-bearing REGRESSION GUARD, mirroring 10-04's `searchVault` "not on an unrelated composing turn" clause: never assess on a composing/reply/scheduling/briefing turn, which is what protects the other 25 golden fixtures from a spurious assessment call. **"## Remembering figures the user gives you"** teaches the STORE half of the LOCKED vault-first→ask→store loop: after asking for a figure the assessment needs, call `recordScorecardAnswer` with the answer in the SAME turn so it is cited "user-provided" and never re-asked. Because the tool's `field` arg is a FREE-FORM string (not an enum), the body enumerates the exact accepted scorecard dot-paths — `identity.*`, `financials.*`, the `modelCard.offerTypesPresent.*` and `leadCard.coreFourActive.*` booleans — since an invented path is written silently and then diagnoses nothing. `ponytail:` the ceiling here is prose-taught paths; the upgrade path is a closed enum on the tool's `inputSchema` (the `setMode`/`framework` precedent) if a live run shows the model drifting off them. Minted as a CANDIDATE (`seedSkills` publishes gated edits as candidates only) and activated ONLY through the gate cycle: `pnpm eval:golden --skill cockpit-agent@<verified>` all-green incl. the new fixtures 27-grounded-assessment / 28-healthy-no-gaps → evidence recorded → `activateSkill`. NEVER hand-activated (§5). **Verified against the live deployment 2026-07-25:** active `cockpit-agent` is v14 (Phase 10 shipped @14, not the planned @13 — always query, never assume: memory `skill-version-collision`), so this edit publishes the NEXT version; AND all 7 Phase-12 rubric/specialist skills have NO row at all on the deployment (`NO_SUCH_SKILL_VERSION`) because `seedSkills` has not run since 12-02 — plain `npx convex dev` does not seed, only `pnpm dev` (`convex dev --run skills:seedSkills`) or `npm run seed` does. Their first seed takes the `rows.length === 0` bootstrap path and lands each v1 **active**, so they need NO eval-gated activation; gating costs nothing until their first body edit.)
> Last verified: 2026-07-24 (12-02 — minted SEVEN new GATED skills for the Business Evaluation Engine (BEVL-01) via the standard mirror: 4 framework rubrics (`growth-os-diagnostic`, `swot`, `lean-canvas`, `bmc`) the engine loads to ASSESS a business, + 3 specialist skills (`offer-architect`, `money-model-designer`, `lead-engine`) an approved gap-action NAMES as its target (execution deferred to Phase 15+). Each is the canonical `packages/contracts/skills/<name>.md` (METHOD in ORIGINAL wording derived from `Skills/*/references` — NO Hormozi book text) + a byte-identically-generated derived `packages/contracts/src/skills/<camel>.ts` constant + a name constant + `GATED_SKILLS` entry + a `seedSkills` entry. The `growth-os-diagnostic` body folds the diagnostic gate order (Market → Offer → Money Model → Leads → Scale) + the financial-spine metric definitions (LTGP, CAC, the ratio, 30-day cash, CFA, the master switch) + 7-level positioning — the METHOD matching the pure `diagnose()` gate order (plan 03). The 3 persona-fallback framework bodies (`swot`=SME, `lean-canvas`=solopreneur, `bmc`=startup) carry their quadrants/blocks + the SHARED rubric rules every finding obeys: cite a vault source per finding, H/M/L confidence label, explicit "not enough data to assess" state distinct from a real gap, NO numeric % scores, and the affirmative healthy "no gaps" result (SC #2). The md↔ts no-drift assertion for all 7 lives in the NEW `packages/contracts/src/skills/skillBodies.test.ts` (contracts-side `test.each`, mirroring the backend `skills.test.ts` precedent). ALL 7 are in `GATED_SKILLS` — activation requires a recorded passing eval run (SC #4); bootstrap seeds each v1 ACTIVE via the `rows.length===0` path, so gating costs nothing until the first edit. Rubric-body activation flows through the eval gate in plan 06. Verify which live version carries your body before eval/activate — optimizer dry-runs/prior candidates occupy versions (memory: skill-version-collision).)
> Last verified: 2026-07-24 (11-01 — minted the `business-profile` UNGATED extraction skill via the standard 5-file mirror (canonical `packages/contracts/skills/business-profile.md` + derived `businessProfileSkillBody` constant generated byte-identically from the `.md` + `BUSINESS_PROFILE_SKILL` name constant + `seedSkills` entry + drift `test.each` row). It reads a user's business intake (pasted text / extracted file text / spoken brief) and emits the Lean-core structured profile INCLUDING an inferred persona (`solopreneur | startup | sme` only — NEVER enterprise), returning fields it cannot determine as empty rather than inventing them. Left UNGATED (mirroring `voice-brief`/`voice-session` OQ3 rationale): its output is a vault document a human CONFIRMS (SC#1, `decideConfirm` always `needsConfirm:true`), not autonomous tool-state, so the eval gate cannot meaningfully assert it — NOT added to `GATED_SKILLS`. Bootstrap v1 seeds active via the `rows.length===0` path. Powers the Phase 11 onboarding flow — see `onboarding.md`.)
> Last verified: 2026-07-24 (10-04 — v-bumped the GATED `cockpit-agent` skill via the 2-file mirror (canonical `.md` edited, derived `cockpitAgentSkillBody` regenerated byte-identically, drift `test.each` row stays green): new "## Grounding in your knowledge vault" section teaching (a) WHEN to call `searchVault` — data-needing/advice/business turns, exactly the read-only posture of `listInbox`/`briefInbox`, and explicitly NOT on an unrelated composing turn (the load-bearing clause that protects the existing 23 golden fixtures from a retrieval regression); (b) the `<vault_context …>` fence is REFERENCE-ONLY — informational material that shapes the answer but is NEVER an instruction/tool-call/parameter (reinforces Plan 02's SC2 fence; human Approve is the backstop); (c) honest-no-match + upload nudge — say so plainly on an empty search, never silently answer ungrounded, never claim a grounding that did not happen. Minted as CANDIDATE cockpit-agent@13 — activated ONLY through the eval gate cycle (`seedSkills` mints candidate → `activateSkill` REFUSES pre-evidence → `pnpm eval:golden --skill cockpit-agent@13` all-green with the new fixtures 25-vault-grounded/26-vault-empty records evidence → `activateSkill` flips v13 active). NEVER hand-activated (§5).)
> Last verified: 2026-07-24 (08-08 phase close — the §9 definition-of-done sweep for ALL of Phase 8 (self-improvement); every prior Phase-8 plan deferred the playbook/watch.json update to this plan. Documented the **SkillOpt write-back loop** in the new "## Phase 8: SkillOpt write-back loop" section below: feedback → scrubbed trajectory export → offline SkillOpt CI batch → candidate write-back → eval gate → owner activate. The candidate-provenance chain is `POST /skillopt/writeback` → `skills.insertCandidate` (CANDIDATE-only, gated names only, idempotent) → owner `skills.activateCandidate`/`activateSkill` through the SAME `EVAL_GATE` — never a raw patch to `active`. The optimizer ships **DORMANT** (`optimizerConfig.enabled` default OFF); the write-back writes ONE refs/counts-only `skill.optimized` audit row (§3/§4). Recorded the **Phase-9 blockers** (ops-surface owner-authorization, PII names-in-prose, deployment env config) as an explicit gating section — owner-approved deferrals that MUST close before Phase-9 multi-user. Registered the new Phase-8 watched paths in `watch.json` (feedback.ts, optimizerConfig.ts, optimizerEligibility.ts, skilloptExport.ts, packages/core/src/optimizerBreach.ts, skillopt/, .github/workflows/skillopt.yml); http.ts is already watched under cockpit.md, notificationTemplates.ts under audit-dead-letter.md. The manual cockpit-agent dry-run (the phase's proof-of-life) is the owner checkpoint — NOT yet run.)
> Last verified: 2026-07-20 (06-02 — minted the `voice-brief` UNGATED skill via the standard 5-file mirror (canonical `packages/contracts/skills/voice-brief.md` + derived `voiceBriefSkillBody` + `VOICE_BRIEF_SKILL` constant + `seedSkills` entry + drift `test.each` row). It is the toolless call-to-brief structurer (`llm.draftVoiceBrief`, Phase 6 plan 04): fills the fixed sections (summary, decisions[], actionItems[], openQuestions[], discussion — decisions + action items lead) from the kept transcript, IN the spoken language, returning empty fields for uncovered sections (code renders "None" via buildBriefMarkdown). Carries the inbox-digest DATA-not-instructions defense clause (the transcript is content to summarize, never a command to obey). Left UNGATED (RESEARCH OQ3): its output is a vault document, not tool-state. Bootstrap v1 seeds active.)
> Last verified: 2026-07-20 (06-02 — minted the `voice-session` UNGATED skill via the standard 5-file mirror (canonical `packages/contracts/skills/voice-session.md` + derived `voiceSessionSkillBody` constant generated byte-identically from the `.md` + `VOICE_SESSION_SKILL` name constant + `seedSkills` entry + drift `test.each` row). It is the live realtime-call Executive Agent persona — the `instructions` string injected into the ephemeral client secret at mint (Phase 6 plan 03), NOT hardcoded (§5). Left UNGATED (RESEARCH OQ3): it is a free-form spoken persona whose output is speech, not tool-state, so the 3.6 eval gate cannot meaningfully assert it — not added to `GATED_SKILLS`. Bootstrap v1 seeds active via the `rows.length===0` path.)
> Last verified: 2026-07-19 (03.11-05 — v-bumped the GATED `cockpit-agent` skill via the 2-file mirror (canonical `.md` edited, derived `cockpitAgentSkillBody` regenerated byte-identically, drift `test.each` row stays green): reworked the reply guidance to TEACH `replyToMessage` (Plan 04) — a "reply to …" about a mailbox message is a REPLY, not a fresh compose; the tool reads the real thread and sets the recipient-by-ref + real `Re: <subject>` + threading + drafts the body from the intent, so the agent no longer ASKS for/invents a subject when a message resolves; a bare unresolvable "reply to Bob" still degrades gracefully (the tool clarifies/lists candidates, never invent a subject or recipient). The "briefing is not permission" clause keeps its governance truth (a reply still crosses a human Approve) but now notes the mechanics route through `replyToMessage`. Activated ONLY through the gate cycle (EVAL-01): `seedSkills` mints candidate vN → `activateSkill` REFUSES pre-evidence → `pnpm eval:golden --skill cockpit-agent@<N>` all-green (incl. new cases 23-reply-happy/24-reply-injection) records evidence → `activateSkill` succeeds. This is the "withheld tool" activation Plans 02-04 deferred.)
> Last verified: 2026-07-19 (03.11-02 — minted the `reply-drafter` gated skill via the standard 5-file mirror (`packages/contracts/skills/reply-drafter.md` canonical body + derived `replyDrafterSkillBody` constant + `REPLY_DRAFTER_SKILL` name constant + `seedSkills` entry + drift `test.each` row) and added it to `GATED_SKILLS`. It is the toolless reply-body writer (`llm.draftReply`): like `inbox-digest` its INPUT is untrusted third-party mail (the original body), so it is gated — a body edit publishes a candidate that only activates through a green `pnpm eval:golden --skill reply-drafter@<N>` run (EVAL-01). Bootstrap v1 still activates ungated via the `rows.length===0` path. Its body carries the inbox-digest DATA-not-instructions defense clause adapted for drafting: an injected instruction in the original may be described/addressed but never adopted, never turns the reply into a command, never introduces an unsupplied recipient/address.)
> Last verified: 2026-07-19 (03.10-07 — v-bumped the `cockpit-agent` skill via the 2-file mirror (canonical `.md` edited, derived `cockpitAgentSkillBody` regenerated byte-identically; the drift `test.each` row stays green): new "## After a pick completes" section — the continue message ("I've picked the recipients from the contact list") means the fold ALREADY happened, the #index recipients WITH names ARE the picks, do not second-guess/re-resolve/"confirm" a completed pick, the recipient-editing tools are not available on that turn, and "continue composing" is NOT license to invent a subject/body/recipient — ask the one pending question instead. And the pre-propose distrust clause is now SCOPED: the placeholder check is only for recipients NO pick or typed address accounts for — a panel-picked recipient is user-chosen (even nameless) and never needs re-confirming (the unscoped v10 clause scripted the live "didn't properly register" defect verbatim, UAT-F1). The mechanisms are CODE (recipientNames persistence/render, the omitRecipientEdits tool withholding — see cockpit.md); the skill only teaches trusting them. Activated ONLY through the gate cycle (03.6 shape): `seedSkills` mints the candidate → `activateSkill` REFUSES pre-evidence (EVAL_GATE) → `pnpm eval:golden --skill cockpit-agent@<N>` all-21-green records evidence → `activateSkill` succeeds.)
> Build history: `.planning/phases/01-foundation-governance-substrate/01-04-*.md` · Related ADRs: [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

All agent/LLM prompts live as versioned rows in the `skills` table (`name`, `version`,
`body`, `status`) and are loaded at runtime — never hardcoded in source (CLAUDE.md §5).
A prompt change is a NEW version row plus an atomic status flip, never an in-place
edit. This gives versioning, rollback, and audit-able `{name, version}` telemetry, and
it is the substrate the Phase 8 SkillOpt optimization loop will operate on.

## Key files

- `packages/backend/convex/schema.ts` — `skills` table + `by_name_status`, `by_name_version` indexes
- `packages/backend/convex/skills.ts` — the module (the SOLE status-writing module): `loadSkill`, `getActiveSkill` (internalQuery), `getSkillVersion` (internalQuery — version-pinned read, any status), `activateSkill` (internalMutation — the sole ACTIVATION path and the EVAL_GATE choke point), `recordEvalEvidence` (internalMutation — evidence-only patch), `seedSkills` (internalMutation — idempotent vs the newest row; publishes an edited body as CANDIDATE for gated skills, publish-and-activate for non-gated), `archiveSkill` (internalMutation — one-off retirement flip)
- `packages/contracts/src/skill.ts` — loader contract, error prefixes, skill-name constants, `GATED_SKILLS`/`isGatedSkill`/`hasPassingEvidence`/`EvalEvidence` (the gate's pure logic)
- `packages/contracts/skills/*.md` — canonical human-editable prompt bodies; `packages/contracts/src/skills/*.ts` — derived bundler-safe constants (drift between the two is test-enforced)
- `packages/backend/convex/llm.ts` — the runtime callers (`route`, `draft`, `draftCockpit` → `getActiveSkill`)
- `packages/backend/scripts/run-seed.mjs` — post-deploy seed runner
- `packages/backend/convex/skills.test.ts` — loader/activation/immutability/no-hardcoded-prompt tests (incl. the backend-side md↔ts drift `test.each`)
- `packages/contracts/src/skills/skillBodies.test.ts` — contracts-side md↔ts no-drift assertion for the Phase-12 (BEVL-01) evaluation/specialist bodies (12-02) + the 3 behaviour-preset style overlays (15.1-05) + `onboarding-agent` (15.1-06)
- **The 5-file mirror for a NEW skill** (all five or the skill is half-registered): `contracts/skills/<name>.md` (canonical) → `contracts/src/skills/<camelName>.ts` (derived constant) → `contracts/src/skill.ts` (`export const X_SKILL = "<name>" as const;`) → `convex/skills.ts` (`seedSkills` row + import) → a `skillBodies.test.ts` drift row. Miss the last one and a stale `.ts` seeds silently.

## Dependencies & blast radius

`graphify query "skills registry"`. Every LLM call site depends on an active skill row
existing — **a fresh deployment without seeding dead-letters every request**
(`NO_ACTIVE_SKILL: executive-router`). Current seeded skills: `executive-router`,
`email-drafter`, `cockpit-agent`, `document-drafter`, `attachment-extractor`,
`graph-extractor`, `inbox-digest`, `reply-drafter`, `voice-session`, `voice-brief` (06-02),
`business-profile` (11-01), the 7 Phase-12 evaluation skills `growth-os-diagnostic`, `swot`,
`lean-canvas`, `bmc`, `offer-architect`, `money-model-designer`, `lead-engine` (12-02), and the 3
behaviour-preset style overlays `style-direct`, `style-coaching`, `style-concise` (15.1-05 — one per
`BEHAVIOR_PRESETS` member), and `onboarding-agent` (15.1-06 — the conversational onboarding system
prompt). The dead `executive-agent.classifier` was
de-seeded and archived in 03.6-01; its constant + `.md` remain as historical record. GATED
(candidate activation requires eval evidence): `cockpit-agent`, `document-drafter`, `inbox-digest`
(03.7-03), `reply-drafter` (03.11-02 — the skills whose INPUT is untrusted third-party mail), and
the 7 Phase-12 rubric/specialist skills (12-02 — their METHOD findings/next-step memos leave the
building, so an edited body activates only through a green `pnpm eval:golden`). **UNGATED on
purpose** (do not "fix"): `business-profile` (11-01), the 3 style overlays (15.1-05, Q6) and
`onboarding-agent` (15.1-06, Q6) — see the rationale comment on `GATED_SKILLS` in
`contracts/src/skill.ts`.
Also seeded and also UNGATED on purpose: `business-blueprint` (17.1-02, BLPR-01 — the corpus
synthesis prompt; see "## Phase 17.1 — business-blueprint" below for why gating it would DEADLOCK it).
The active row's `version`
is part of the LLM action-cache key, so activation/rollback automatically invalidates
cached outputs.

## Data flow

1. **Seed + publish**: `seedSkills` inserts each skill v1/`active` on first run (bootstrap — gated or not, a fresh clone never fails closed). On re-run it is idempotent when the body is UNCHANGED vs the NEWEST row (so an already-published candidate is not re-minted). When a `.md` edit has changed the derived constant it publishes a NEW version (`maxVersion+1`) — never mutating a prior row (immutable-per-version): **non-gated** skills archive the old active row and activate the new one (unchanged behavior); **gated** skills insert the new version as `candidate` and leave the active row untouched — activation only through the gate (step 4). Local dev auto-seeds (`convex dev --run skills:seedSkills`); production requires `npm run seed` after `npx convex deploy`.
2. **Load**: `loadSkill(ctx, name)` selects the single row with `status == "active"` for the name (`.unique()` — throws on 0 or >1). Selection is active-row-wins, NOT max-version. `getSkillVersion(name, version)` is the version-pinned read (any status) the eval runner threads into the agent loop so a candidate evaluates as itself.
3. **Missing/ambiguous** → throws `NO_ACTIVE_SKILL` → the pipeline dead-letters the request. Fail-closed by design: an agent can never silently run without a governed prompt.
4. **Gated publish → eval → activate** (EVAL-01): edit the `.md` → dev boot/`seedSkills` publishes candidate vN (active untouched) → `pnpm eval:golden --skill <name>@<N>` (plan 04) → a green run records evidence on the row via `recordEvalEvidence` (refs/counts-only JSON: `{runner, runId, pass, casesPassed, casesTotal, retriedCases, costUsd, model, skillVersions, ts}` — never raw content, §4) → `npx convex run skills:activateSkill '{"name":"<name>","version":<N>}'` passes the gate (`hasPassingEvidence` requires `pass === true` AND `skillVersions[name] === N` — stale/mismatched/unparseable evidence fails closed). Non-gated candidates activate without evidence.
5. **Rollback**: `activateSkill(name, priorVersion)` — same atomic flip in reverse, and STRUCTURALLY exempt from the gate: an `archived`/`rolled_back` target was active before and activates on status alone, no evidence needed. A broken eval harness can never block a mid-incident rollback.

## Invariants — what must never break

- **No hardcoded prompts in source**: enforced by `skills.test.ts`, which scans `convex/*.ts` and fails on any string literal >200 chars. Also enforces `.md` ↔ derived `.ts` body no-drift.
- **Bodies immutable per version**: only `status` and `evidence` are EVER patched — never `body`/`name`/`version`. Tested (v1 body unchanged after activating v2; `recordEvalEvidence` patches evidence only).
- **Exactly one active row per name**: `.unique()` on `by_name_status`; loader throws otherwise.
- **Fail-closed loader**: `NO_ACTIVE_SKILL` throw, never a fallback default prompt. Tested in `skills.test.ts` and `cockpitDraft.test.ts` (unseeded `email-drafter`).
- **`skills.ts` is the sole status-WRITING module** (restated 03.6-01; it uses the raw internal builder and sits on the plan-02 allow-list — do not add writers elsewhere). Within it: `activateSkill` is the sole ACTIVATION path (and the EVAL_GATE choke point), `seedSkills` writes `candidate`/`active` on publish, `archiveSkill` is the one-off retirement flip.
- **Gated candidates only activate through a recorded green eval** (EVAL-01, 03.6-01): gated list = `cockpit-agent` + `document-drafter` + `inbox-digest` (03.7-03) + `reply-drafter` (03.11-02) (`GATED_SKILLS` in `@pikar/contracts`); a `candidate` target without version-pinned passing evidence → `EVAL_GATE` refusal. `seedSkills` never auto-activates a gated edit — the gate would be decorative otherwise.
- **The eval gate never blocks rollback** (EVAL-01, 03.6-01): only a `candidate` version of a gated skill needs passing evidence; `archived`/`rolled_back` targets were active before and are exempt purely by status — a broken eval harness must never stop a mid-incident rollback.
- **Skills are GLOBAL** — the table has no `tenantId` (deliberate; the LLM cache is tenant-namespaced, the prompt body is shared). Don't "fix" this by adding tenancy without an ADR.

## How to change safely

- **Editing a NON-gated prompt**: edit the canonical `.md` in `packages/contracts/skills/`, regenerate/update the derived `.ts` constant, re-seed — publish-and-activate is automatic. Never edit an existing row's body — the immutability test will not catch a direct DB edit, only discipline does.
- **Editing a GATED prompt** (`cockpit-agent`, `document-drafter`, `inbox-digest`, `reply-drafter`): same edit + re-seed, which lands a CANDIDATE only; then run the eval (`pnpm eval:golden --skill <name>@<N>`) and `activateSkill` once evidence is green. There is no bypass switch — if the harness is broken, fix the harness (rollback of an already-active version still works regardless).
- **Adding a skill**: add the `.md` + derived constant + name constant in `contracts/src/skill.ts`, extend `seedSkills`, seed the deployment. Decide gating: add to `GATED_SKILLS` if its output leaves the building.
- **Retiring a skill**: remove its `seedSkills` entry FIRST (or the next boot resurrects it), then `npx convex run skills:archiveSkill '{"name":"<name>"}'` on the deployment. Keep the contracts constant + `.md` as historical record.
- **Rollback of a bad prompt**: `npx convex run skills:activateSkill '{"name":"<name>","version":<prior>}'` — cache invalidation is automatic via the version-keyed cache.
- **Do not bump** the pinned agent/workflow component versions as part of skill work (CLAUDE.md §6).

## How to verify

- `pnpm --filter @pikar/backend test` (or `vitest run skills`) — seed+load, fail-closed throw, idempotent seed, atomic flip + immutability, gate refuse/exempt/stale-evidence/fail-closed-parse, gated candidate-publish + idempotence, classifier non-resurrection, md/ts no-drift, no long inline literals
- Seed check: `npm run seed` in `packages/backend` (calls `seedSkills` then asserts `executive-router` is active)

## Operational notes

- **Fresh deploy checklist**: `npx convex deploy` → `npm run seed`. Skipping the seed dead-letters everything.
- Skill names are hyphenated (`executive-router`); `executive_router` silently fails to match.
- `run-seed.mjs` judges success by CLI *output*, not exit code — the convex CLI returns a bogus non-zero exit on Windows/Node 24.
- Rollback is CLI-only today; there is no admin UI.

## Phase 8: SkillOpt write-back loop (self-improvement)

Phase 8 wires an **offline** prompt-optimization loop ON TOP of this registry. The registry's
candidate→active gate is the load-bearing invariant it reuses — SkillOpt never bypasses it.

**The loop (ships DORMANT):**

1. **Feedback capture** (`convex/feedback.ts`, IMPR-01): a thumbs±comment on a delivered response
   writes one tenant-scoped `feedback` row keyed to `requestId` + `skillName` + `skillVersion`
   (the attribution stamped at propose in `cockpit.ts`, copied plan→requests at `executePlan`).
2. **Eligibility / breach** (`convex/optimizerEligibility.ts` + pure `packages/core/src/optimizerBreach.ts`):
   a rolling negative-rate over a minimum sample floor (`optimizerConfig` thresholds) decides whether
   the loop is eligible to fire. Below the floor → never eligible (one bad rating can't trigger it).
3. **Scrubbed export** (`convex/skilloptExport.ts` → `GET /skillopt/export`, bearer `SKILLOPT_TOKEN`):
   every text field runs through `packages/pii` `scanText`; only `safeText`+counts leave, fail-closed
   (a scan `Err` drops that trajectory). This is a SEPARATE export plane from the refs-only audit (§4).
4. **SkillOpt CI batch** (`skillopt/`, `.github/workflows/skillopt.yml`, `skillopt==0.2.0`): reads
   `optimizerConfig.enabled` FIRST and no-ops when dormant; otherwise runs rollout→reflect→edit→held-out
   accept and emits `best_skill.md`. The optimizer NEVER sees the golden `eval-cases/` set — that
   in-repo partition is the independent third gate.
5. **Write-back → CANDIDATE** (`POST /skillopt/writeback` → `skills.insertCandidate`): the accepted body
   lands as a NEW `candidate` version (`maxVersion+1`), prior rows immutable. `insertCandidate` rejects a
   non-gated name (`NOT_GATED`) and is idempotent vs the newest row (identical body → `inserted:false`,
   no churn). **It never sets `active` — that is the whole point.** IMPR-03 evidence: on a genuinely new
   candidate the endpoint writes ONE insert-only `skill.optimized` audit row —
   `{skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}`, refs/counts ONLY (§3/§4, no
   body, no prose) — and fires the `optimizer.candidate` owner notification through the notify choke point.
6. **Eval gate** (`pnpm eval:golden --skill cockpit-agent@N+1`): a green run records evidence via
   `recordEvalEvidence` (the EXISTING gate). No new gate.
7. **Owner activate** (`skills.activateCandidate`, ops panel; `candidatesForReview` feeds the before/after
   diff + evidence): routes through the SAME `activateSkill`/`EVAL_GATE` choke point as the CLI — an
   unevaluated gated candidate CANNOT go live from the UI either. Rollback = `activateSkill(prior)`,
   status-exempt (a broken eval harness never blocks a mid-incident rollback).

**Kill switch (Pitfall 5):** `optimizerConfig` is a single-row table (`enabled` default **false** on read
— DORMANT), mirroring the `guardrailConfig` default-off-on-read pattern. The ops toggle
(`optimizerConfig.setOptimizerEnabled`) writes it; the CI job reads-and-obeys it as step 1. Disabling the
Actions schedule is the harder backstop.

**Provenance invariant:** a SkillOpt-authored body reaches `active` ONLY via `insertCandidate` (candidate)
→ green eval → owner `activateCandidate`/`activateSkill`. The `skills.test.ts` drift test asserts only SEED
constants match their `.md` — it does NOT require every row to match a constant, so an externally-authored
candidate body is legal. Never `db.patch` a skill body/status to active from CI.

**Cross-tenant IDOR fix (commit d67802d):** the write-back's audit/notify tenant is NOT taken from the
request body (attacker-controllable with the shared token) — it comes from server-side `SKILLOPT_OWNER_TENANT`
env. When unset, the global candidate still inserts safely but the tenant-scoped audit/notify are skipped.

### Phase-9 blockers (owner-approved deferral 2026-07-24 — ship inert in single-owner beta, MUST close before Phase-9 multi-user)

These are recorded here as explicit gating items — do NOT fix them in Phase 8; they are the entry criteria
for the Phase-9 multi-user work.

- **a. Ops-surface owner-authorization** (a commit-time security review item): `optimizerConfig.setOptimizerEnabled`
  (tenantMutation), `skills.activateCandidate` (tenantMutation) and `skills.candidatesForReview` (tenantQuery)
  are callable by ANY authenticated tenant — the codebase has no owner/admin role primitive yet. In the
  single-owner beta the authenticated identity IS the owner, so this is inert. Phase 9 MUST add a
  `requireOwner()` primitive and gate all three; the SC-2 cross-user isolation test should assert a non-owner
  cannot reach them.
- **b. PII names-in-prose** (RESEARCH Pitfall 2): the `/skillopt/export` scrub (`packages/pii` `scanText`)
  removes STRUCTURED PII only (emails, Luhn cards, US SSNs, phones) — person names typed in free prose
  (comments/bodies) survive the export. Accepted ONLY for the solo-owner/own-tenant beta export (the export
  goes to the owner's OWN CI over the owner's OWN tenant data). A HARD BLOCKER (needs NER/Presidio) before
  any multi-user export.
- **c. Deployment env config**: `SKILLOPT_TOKEN` (export + write-back bearer auth) and `SKILLOPT_OWNER_TENANT`
  (the trusted owner tenant for the write-back audit/notify — the cross-tenant IDOR fix, commit d67802d) must
  be set on the Convex deployment before the loop runs. The dormant-ship default means neither is legitimately
  called until the owner configures them.

## Known gaps & deferred work

- **Source prompt edits publish via `seedSkills`** (a changed body → new version; gated → candidate, non-gated → activate; 03.2.1, gated split 03.6-01). Phase 8 (SkillOpt) remains the designated owner of the *automated* candidate→eval→activate loop; `seedSkills` covers the manual source-edit→publish path (edit `.md` → regenerate `.ts` → re-seed).
- The `rolled_back` status literal is still never WRITTEN (rollback produces `archived`) but since 03.6-01 it is READ: the gate's structural exemption checks for it. Keep the literal.
- The live `executive-agent.classifier` row's archival (`npx convex run skills:archiveSkill`) runs in plan 03.6-05's checkpoint — until then the deployed row is active but unreachable (nothing loads it).

## Phase 16 — research-specialist

> Append-only container: each Phase-16 plan writes ONLY inside its own subsection.
> On merge conflict, **keep both**.

### Phase 16 — 16-04

New registry row: **`research-specialist`**, the web-research sub-agent's §5 body.

**GATED, and it is the strongest gating case in the list.** This body's whole value is
BEHAVIOURAL — *does it refuse to confabulate when search comes back empty* — which is exactly what
an eval corpus can assert and code cannot. Bootstrap v1 still activates ungated through
`seedSkills`' `rows.length === 0` path, so the gate costs nothing until the first edit.

The 5-file mirror for this row (all five, or it drifts):

| # | File | What |
|---|---|---|
| 1 | `packages/contracts/skills/research-specialist.md` | canonical, human-editable source |
| 2 | `packages/contracts/src/skills/researchSpecialist.ts` | derived constant — **generated from the .md, never retyped** |
| 3 | `packages/contracts/src/skill.ts` | `RESEARCH_SPECIALIST_SKILL` + membership in `GATED_SKILLS` |
| 4 | `packages/backend/convex/skills.ts` `seedSkills` | the seed row (append-only) |
| 5 | `packages/contracts/src/skills/skillBodies.test.ts` | the md↔ts drift row |

The drift test is byte-exact after LF normalization and **was mutation-verified in 16-04**:
appending one stray line to the `.md` without regenerating the `.ts` turns it RED.

> **The spelling of `RESEARCH_SPECIALIST_SKILL` is load-bearing.**
> `packages/core/src/specialists.test.ts` reads `skill.ts` **off disk** and asserts a matching
> exported constant for every `SPECIALISTS[route].skillName`. This is why 16-04 runs in wave 2,
> BEFORE 16-03 adds the `research` route — otherwise 16-03's verify goes red on a test it does not
> own. Do not move it back.

### ⚠ The version-collision rule — verbatim, do not skip

`seedSkills` writes **`maxVersion + 1`**, and optimizer dry-run candidates already occupy versions.
**A plan's assumed version number can be WRONG against the live DB.** Do not pin a version anywhere
in code or in a fixture. **Before any eval or activate, VERIFY which version actually carries your
body.** This has already bitten once: Phase 10 grounding shipped at `cockpit-agent@14`, not the
`@13` its plan assumed.

## Phase 17.1 — business-blueprint

> Append-only container: each Phase-17.1 plan writes ONLY inside its own subsection.
> On merge conflict, **keep both**.

### Phase 17.1 — 17.1-02

New registry row: **`business-blueprint`** (BLPR-01) — the ONE model call in blueprint synthesis. It
is shown the tenant's blank blueprint fields plus numbered excerpts from that tenant's own vault
documents, and returns derived CANDIDATES for those fields.

**UNGATED, and that is an owner decision (2026-07-27) that REPLACES the "through the eval gate" line
in the phase's original Definition of Done. Do not "fix" it back.** Two independent reasons:

- **Mechanical (the `document-analyst` reason, verbatim).** `run-eval-golden.mjs` hard-validates
  `--skill` against a closed name list and drives `runCockpitAgent` over text fixtures; it
  structurally cannot exercise the synthesis path. Gating a skill the golden runner cannot drive
  **deadlocks it at v1 on its first body edit** — the candidate is minted and nothing can ever clear
  it.
- **Principled (the `business-profile` reason, verbatim).** The output is a vault doc a human
  confirms, not autonomous tool-state, and **D2's confirm gate IS that human check**. The properties
  worth asserting are already CODE, not prose: precedence is `mergeBlueprint` (no branch overwrites a
  non-empty typed field) and the citation check is a source-index validation that DROPS an
  unsupported claim. An eval corpus would assert nothing the code does not already guarantee.

The rationale also sits as a doc comment ON `BUSINESS_BLUEPRINT_SKILL` in `contracts/src/skill.ts`,
next to `GATED_SKILLS`, because that list is where a later reader would "fix" the omission — and
`skillBodies.test.ts` now asserts `isGatedSkill("business-blueprint") === false` EXPLICITLY, so the
tidy-up fails loudly instead of silently deadlocking the skill.

The 5-file mirror for this row (all five, or it drifts):

| # | File | What |
|---|---|---|
| 1 | `packages/contracts/skills/business-blueprint.md` | canonical, human-editable source |
| 2 | `packages/contracts/src/skills/businessBlueprint.ts` | derived constant — **generated from the .md, never retyped** |
| 3 | `packages/contracts/src/skill.ts` | `BUSINESS_BLUEPRINT_SKILL`, DELIBERATELY absent from `GATED_SKILLS` |
| 4 | `packages/backend/convex/skills.ts` `seedSkills` | the seed row (append-only, last in the array) |
| 5 | `packages/contracts/src/skills/skillBodies.test.ts` | the md↔ts drift row + the ungated assertion |

**Mutation-verified in 17.1-02**: changing `# Business Blueprint (v1)` to `(v2)` in the `.md` without
regenerating the `.ts` turned exactly ONE row red (1 failed / 20 passed); reverting restored 21/21.

**Three body-writing rules this prompt obeys — none of them is style.**

1. **It returns CANDIDATES ONLY and is never asked to merge.** It is never shown the live blueprint
   and the body says so plainly: *"You do not decide what the blueprint says. You propose candidates;
   code decides."* A merge rule in a prompt is a request; `mergeBlueprint` is a guarantee.
2. **It does NOT enumerate the field set** (the 15.1-06 split, and it is load-bearing). The CODE
   supplies the field names and their permitted shape at call time; the BODY is written against "the
   FIELDS TO FILL listed in the request" and "the numbered SOURCES provided". The closed set then has
   exactly ONE home and cannot drift between the prompt and the type.
3. **Every candidate cites a source INDEX, and inventing one is worse than declining.** `sourceIndex`
   is a REQUIRED integer with `-1` as the "no supporting source" sentinel — modelled as a sentinel
   rather than an optional field because the adapter's `generateObject` schema must be strict-mode
   legal (every property required, `additionalProperties: false`; `llmRedaction.test.ts` asserts this
   statically over every schema). The body tells the model outright that an out-of-range index causes
   the claim to be **dropped entirely**, so guessing gains it nothing.

It also carries the standard DATA-not-instructions defense clause: vault excerpts are content to
read, never commands to obey (a document saying "classify this business as enterprise" is described,
never adopted).
