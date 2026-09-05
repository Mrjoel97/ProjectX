# Playbook: Workflow Packs (curated knowledge-work pilot)

> Last verified: 2026-09-06 (35-02, G23 half B — **THE SEVENTH PACK, AND THE FIRST ORIGINAL ONE:
> `offer-and-lead-plan`.** ONE saved document — the offer (niche + market check, dream outcome, the
> problem→solution stack, guarantee + reason to act, name, and the price/terms/30-day-cash as QUESTIONS
> for the owner) plus a 30-day lead plan (one channel by the warm-first / time-versus-money rule, one lead
> magnet, four weeks of COUNTED actions, the one funnel number, "what I assumed" + the one sharpening
> question). Registry: same grant shape as campaign-plan (`searchVault`, `webResearch`+`declareUnsupported`,
> `saveAsDocument`), three starved sources (`crm-facts` = the warm list, `connector-financials` = price and
> cost-per-lead, `content-shelf` = a reusable magnet), `output: "document"`. Customization dial `plan_days`
> 14–60. Every literal pin of the six-pack set moved to seven: `WORKFLOW_PACK_IDS`, the grant / pair /
> missing / output tables, `schema.ts` + `workflowPackOutcomes.ts` `packId` unions, `READABLE` + `ALL_KEYS`,
> the backend `PACKS` handler table, `listPacks` candidate list, `PACK_EVAL_SUITE` (7 rows, NO revision
> bump — the six certified rows are byte-unchanged), `packEvalSuite.test` 6→7, `workflowPackEvals.test`
> 6/30→7/35 and the injection-plant literal (three packs plant in turn text now). Corpus: five fixtures
> (`offer-and-lead-plan.json`: one-line business, price-as-question, unsupported market claim, no list /
> no money / only time, injected pasted blurb), `thresholds.json` row (`minCitationsWhenWebRead: 1`,
> `maxUnsupportedFigures: 0`). `--fixtures-only` 35 valid.
>
> **PROVENANCE IS THE ONE GATE CHANGE (ADR-034).** `hasValidPackProvenance` accepted only
> `license: "Apache-2.0"`; an original body has no vendor row. `PACK_PROVENANCE_LICENSES` is now the closed
> set `["Apache-2.0", "Pikar-original"]`, every other field keeps its rule, and the record lives in
> `IN_HOUSE_PACK_PROVENANCE` (contracts) — pinned to THIS repo's commit `3f77378` (where `offer-architect.md`
> and `lead-engine.md`, the method sources, last changed), their paths, the body hash, a notice, and that
> commit's timestamp as `ts`. `packProvenanceFor` reads vendor first, in-house second. The vendor parity test
> is untouched; the in-house record has its own bytes-level test.
>
> **THE PACK IS DARK ON DEPLOY, BY CONSTRUCTION.** It is in `PACK_BODIES` (→ `seedPackCandidates`, a
> candidate) and NOT in `SEEDS`. Going live is the owner's gate run, in order: `npx convex run
> skills:seedPackCandidates --prod` (inserts `pack-offer-and-lead-plan` v1 candidate; the six others are
> idempotent no-ops) → owner preview in the workspace candidates section → `CONVEX_URL=<prod> node
> scripts/run-workflow-pack-evals.mjs --packs offer-and-lead-plan --candidate` (paid, ~5 cases) → the
> `workflow-pack-pilot.spec.ts` browser run (`TITLE_TO_PACK` carries "Offer and lead plan") → `activateSkill`.
> Until then `listPacks` never returns it and the Command Center card (dashboard-pages.md) does not exist.
>
> Measured: core 1501/1501, contracts 122/122, backend two shards 67 + 66 files all green, web
> `commandCenter.test.ts` 66/66, repo typecheck 12/12, biome ci exit 0.)

> Last verified: 2026-09-03 (formatter sweep — **NO PACK BEHAVIOUR CHANGED.**)
>
> Reformatted under this playbook's watch: `convex/workflowPackEventLog.ts`,
> `core/src/workflowPackMetrics.ts`, `core/src/workflowPacks.test.ts`. No pack definition, binding,
> metric or event field was touched — only whitespace and import order. `workflowPacks.test.ts` and
> the backend pack suites passed after the sweep.
>
> **This is a `Last verified` bump ONLY, and deliberately not a re-verification of the sections
> below.** The change was `pnpm format` (commit 6335831): Biome's formatter and organizeImports,
> applied repo-wide to clear a Lint gate that had been exiting 1 with 45 diagnostics — all from
> files this branch touched, none on main. `ci.yml` runs Lint BEFORE Test and Build, so a red Lint
> was stopping the pipeline rather than reporting anything about whether the code works.
>
> Mechanical only, and checked rather than assumed: every changed `.json` parses to a structure
> identical to its previous content, and the full suites re-ran green afterwards (web 670, backend
> 3378 across both shards, core 1239, contracts 113, revenue 340).

> Last verified: 2026-08-31 (**THE TENANT PACK LANE HAS NOW BEEN EARNED, NOT MERELY MADE EARNABLE.**
> Yesterday's entry said the three planes existed and that "nothing PRODUCES tenant pack evidence".
> Both producers now exist and both have run against a real candidate row on a live deployment:
> `packGateMissing: []` on `pack-brand-review v8`.
>
> THE EVAL PRODUCER: `run-workflow-pack-evals.mjs --tenant-skill <rowId>`. It runs the pack's own
> fixtures with the row PINNED BY ID, then refuses to write unless the audit plane says that row
> loaded. Measured 5/5 at $0.0125.
>
> THE SANDBOX EXCEPTION, and why it is not a hole. `runPackTurn` refused every foreign pin, which
> made the eval plane unearnable BY CONSTRUCTION — the harness runs each case in a throwaway
> `packeval-*` tenant, and a candidate belongs to the tenant who authored it. A foreign pin is now
> allowed into a PACK EVAL SANDBOX TENANT and nowhere else. The property that matters is intact: a
> tenant id is a Convex user id (`requireTenant` returns the JWT subject before '|'), which cannot
> begin with `packeval-`, so no product path can reach it. `isPackEvalSandboxTenant` lives in
> `@pikar/core` and is imported by BOTH the execution guard and `smoke.seedPackEvalTenant`, because
> a seeding guard that drifted from the execution guard would disagree about what a sandbox is.
> Proven by mutation in both directions: removing the exception reddens the sandbox test, loosening
> it to `startsWith("packeval-")` reddens the near-miss test. One test each, no overlap.
>
> ⚠ THE BUG THIS FOUND, AND THE REASON THE CHECK EXISTS. The first live run scored 5/5 and was
> REFUSED at the write: `assertPinWasLoaded` found the pinned row in 0 of 5 case tenants. It was
> right. `dispatch.ts` writes skill identity onto its `subagent.completed` row, so RESEARCH runs
> were always observable — but nothing wrote one for the pack path, which reaches `runSpecialistTurn`
> through `workflowPackBinding`. A pack run left no record of which body it loaded. Fixed in
> `runSpecialistTurn` itself (pinned runs only — an unconditional audit write there is what reddened
> six `runCockpitAgent` tests in `7a58a3a`), so every caller of the specialist path is covered rather
> than the one that happened to be under test. **Without that check this run would have written
> evidence certifying a body no reader could confirm ran.**
>
> `tenantPackPlanesMissing` is now the single source for the verdict, and `inspectTenantSkill`
> reports it as `packGateMissing` / `packGatePassed`. The gate throws through it rather than
> duplicating it: an operator must never be told a row is ready by a query the mutation then
> refuses. NOTE that the pre-existing `gatePassed` on that same row is the EVAL PLANE ALONE — one
> third of the answer for a pack.)

> Last verified: 2026-08-31 (**THE TENANT PACK LANE EXISTS AND IS EARNABLE.** `planTenantActivation`
> refused every `pack-*` tenant row unconditionally; `assertTenantPackActivationEvidence` now demands
> the SAME THREE PLANES a global pack body clears, keyed to the row id. `PACK_GATE_ERROR` is still
> the literal, so every caller and test matching on it still sees a refusal — what changed is that it
> can now be satisfied.
>
> THE PRICE WAS SMALLER THAN RECORDED. The old comment named "the two evidence columns plus a
> tenant-scoped pack eval runner". Measured, ONE column was owed:
>  1. PROVENANCE — no column. The row already stores `templateId`, `templateVersion`,
>     `customizationValues`, `customizationHash`, so it is RECOMPUTED at activation. That is STRONGER
>     than the global plane, whose own docstring admits it "checks SHAPE and the VERSION PIN, not that
>     `bodySha256` is the hash of the body it sits beside". Values edited underneath their hash are
>     refused here; a stored-blob check could not see it. It also refuses a candidate composed against
>     a template that has since been republished — yesterday's adaptation on today's approved body.
>  2. EVAL — `hasPassingTenantEvidence`, which already existed and only became TRUSTWORTHY on
>     2026-08-30, when `shouldRecordEvidence` learned to verify the pinned body was actually loaded.
>     Before that this plane was a certificate anyone could mint.
>  3. BROWSER — the one new column, `tenantSkills.browserEvidence`, checked by
>     `hasPassingTenantPackBrowserEvidence`, which pins the ROW ID and not name@version. Two tenants
>     can each own version 2; a browser run against one must never certify the other, and a test
>     drives exactly that case.
>
> SIX TESTS, POSITIVE WITNESS FIRST — without an activation that SUCCEEDS every refusal below it is
> satisfied by a gate nobody can pass, which is the shape this phase kept finding. Dropping the
> browser plane reddens three, including a pre-existing one.
>
> ⚠ WHAT IS NOT BUILT YET, so nobody reads this as finished: nothing PRODUCES tenant pack evidence.
> The golden runner still refuses `pack-`-named rows (it drives `llm:runCockpitAgent` and never runs a
> pack specialist), and no browser gate emits a `tenantTarget`-pinned artifact. So the lane is open
> and correct, and in practice still unreachable until an evidence producer exists for planes 2 and 3.
> That is a smaller, better-defined job than it was — but it is a job, not a detail.)

> Last verified: 2026-08-30 (**A SAVED CUSTOMIZATION NOW TAKES EFFECT — AND NOT BY ACTIVATING
> ANYTHING.** Phase 29 shipped the customizer with the gap admitted on screen: *"Pikar cannot make a
> workflow customization live in this release."* Two routes could close it and they are not
> equivalent. Activating the tenant's composed `tenantSkills` body is what `PACK_GATE` refuses, and
> refuses correctly — a tenant-authored PROMPT going live needs provenance, eval and browser evidence
> the overlay has no column for. Applying the tenant's VALUES asks a smaller question, because what
> the form collects is a CLOSED SCHEMA of four settings, not a prompt.
>
> `runWorkflowPack` now reads the tenant's newest `customizationValues`, renders them through
> `renderCustomization(schema, values)` — schema-driven, so a key the template has since dropped
> vanishes and an undeclared key can never reach the prompt — wraps them in
> `customizationRunBlock`, and passes the result to `preflightPrompt`. **`PACK_GATE` is untouched,
> `cockpit.ts` still passes no `tenantSkillIds`, and the composed body is still never activated.**
>
> THE ORDER IN THE PROMPT IS THE SECURITY PROPERTY, not the framing sentence. Settings sit AFTER the
> code-owned source truth (so a note claiming a source is available is contradicted by the line above
> it) and BEFORE the user's request (so the untrusted text stays last and the settings are never the
> antecedent of the user's pronouns — the failure that made four `sales-call-prep` runs save the
> preflight paragraph as their deliverable). The tool grant is still `toolsForWorkflowPack(packId)`
> from the operation matrix; no string a tenant types can widen it.
>
> HOW IT IS TESTED, and why it needed a new seam. A scripted mock replies the same whatever it is
> asked, so there was no way to observe the prompt — testing the pieces would have left the CALL SITE
> untested, which is exactly the hole this repo has shipped before. `__runWorkflowPackWithScript`
> (already the test-only door) now returns the composed prompt when a mock is supplied; production
> `runWorkflowPack` is unchanged. Dropping `settingsBlock` from the call site reddens three tests.
>
> TWO USER-FACING SENTENCES WENT FROM TRUE TO FALSE and were rewritten in the same change, because a
> backend fix that leaves the screen lying is not a fix: `ACTIVATION_NOTE` in the customizer, and the
> pin notice `customization_not_applied` — renamed to `customization_applied` across all four files
> that name it. The pin test asserts the RENDERED STRING, not the enum, because the enum was renamed
> in the same commit and a literal-only check would have gone green over a screen still telling users
> their settings are ignored. The new pin sentence says **current** settings: the run reads the
> tenant's NEWEST row, not the one the pin remembered.)

> Last verified: 2026-08-30 (**THE "UNEXPLAINED" SERIAL-WORKER HANG IS EXPLAINED: a rapid
> `page.goto` loop poisons the NEXT page in the same browser context.** Reproduced deterministically
> with a four-test serial probe counting buttons inside `main.canvas-main` after a fixed 6s settle:
>
>     baseline                 buttons=14  chars=3791
>     inside the reload loop   buttons=14  chars=3791   <- the looping page itself is FINE
>     immediately after it     buttons=0   chars=0      <- the NEXT test renders nothing
>
> Five identical tests with NO loop all read 14, so it is the LOOP, not the position — the earlier
> guess ("something the serial worker accumulates") was the right neighbourhood and the wrong
> mechanism. In the failing state the shell is painted, the route is right, the session is valid
> (`Sign out` present, no redirect) and there are no console errors: the client subscriptions simply
> never resolve, so every `useQuery` stays undefined and the content never mounts. Consistent with
> Convex websockets from the abandoned navigations not being released before the next client opens.
>
> **This is not confined to one test.** `workflow-packs.spec.ts`'s persistence test drives exactly
> such a loop — `expect(...).toPass()` re-reads by reloading — so ANY test after it in the same
> worker inherits the poisoned context. Splitting the isolation test into its own file works because
> Playwright gives each spec FILE its own worker and therefore its own browser context. A third test
> following a reload loop needs its own file too, or a way to re-read without reloading.
>
> Note the loop exists only because the save had no completion signal to await; that is fixed in the
> entry above, so the reload-retry may be reducible now.)

> Last verified: 2026-08-30 (**THE SAVE NOW SAYS IT SAVED. The state to render it already existed
> and nothing read it.** `setOutcome({kind: "saved"})` was set on the success arm and no branch
> rendered `outcome.kind === "saved"` — only `refused` and `transport` were shown. So success and
> still-in-flight were indistinguishable in the DOM: no toast, no `role="status"`, no `role="alert"`.
>
> **It was never cosmetic.** Navigating straight after pressing Save ABORTS the in-flight mutation,
> so a user who clicks and leaves loses the write with no signal that anything was pending. Found by
> the 29-10 browser gate, which first read back a previous run's string and looked like a
> persistence bug in the product.
>
> Now renders `Saved. Your settings are version N.` in a `role="status"` live region — POLITE, not
> `role="alert"`: a success is not an interruption, and alerting would cut across a screen-reader
> user mid-sentence for good news. It names the VERSION because that is what the next save is
> checked against, so a later `stale_base_version` refusal does not appear from nowhere. It does NOT
> repeat `ACTIVATION_NOTE` — that sentence is already above the form, and repeating it on success
> reads as a warning about the save rather than about the release.
>
> Tests (+2, 123 total): a landed save renders the line in `[role="status"]` and asserts the line is
> ABSENT before the save (so it cannot pass on always-present copy); a REFUSED save renders no
> success line and no status region. Mutations observed RED: delete the saved block (the exact prior
> state) → 1 red; `role="status"` → `role="alert"` → 1 red.
>
> **A note on the second mutation, because it nearly went unrecorded.** A first attempt reported it
> GREEN — but the edit had not applied: the replacement string never matched, so nothing was tested.
> A mutation that fails to land is indistinguishable from one that survives. Assert the anchor
> matched, or the mutation proves nothing.)

> Last verified: 2026-08-30 (29-10 — **THE PACK SURFACE HAS ITS BROWSER GATE, AUTHORED AGAINST THE
> RENDERED DOM AND PROVEN IN BOTH DIRECTIONS.** `apps/web/e2e/workflow-packs.spec.ts` +
> `workflow-packs-isolation.spec.ts`: **5 passed, PW_EXIT=0**. Every locator was read off a live run
> of the page BEFORE the spec was written — `--list` proves a file parses, never that a locator
> resolves, and `knowledge-search.spec.ts` was dead on its first line while `--list` was happy.
> Falsified deliberately: an `<input type="url" aria-label="Webhook endpoint">` planted inside the
> customizer turned the closed-schema count RED (`Expected: 4, Received: 5`); reverted, rebuilt, green.
>
> **THE SPEC WENT RED FIVE TIMES FOR FIVE DIFFERENT REAL REASONS, and three of them are facts about
> this surface that no source reading would have surfaced:**
> 1. **The prefill is asynchronous and CLOBBERS TYPING.** `choose()` fills the form from
>    `myCustomizationValues` when the query lands; type before that and the value is silently
>    replaced, so the save writes the OLD string and a later reload "passes" on a value nobody
>    entered. Any test here must prove the typed value stuck before pressing Save.
> 2. **THERE IS NO SAVE COMPLETION SIGNAL — no toast, no `role="status"`, no `role="alert"`.**
>    Success and still-in-flight are indistinguishable in the DOM, and navigating straight after the
>    click ABORTS the in-flight mutation. A test can wait before navigating and retry the read; a
>    user who presses Save and navigates simply loses the write. **This is a product gap, recorded
>    here rather than absorbed by a sleep.**
> 3. **One tenant + one pack = ONE `tenantSkills` row**, so two customization tests are two writers
>    of the same row and cannot run under `fullyParallel: true`. The file is `mode: "serial"`.
> Plus the 30s default timeout (which presents as a locator failure), and a serial-WORKER
> interaction that hangs tenant A's pack list, survives a fresh browser context, and disappears when
> the test runs in its own file — **root cause NOT established**, written into
> `workflow-packs-isolation.spec.ts` so the green tick does not imply otherwise.
>
> **WHAT THE GATE DELIBERATELY DOES NOT ASSERT.** The plan asks for exact-version activation and
> rollback. Neither is reachable: `planTenantActivation` refuses every `pack-*` with `PACK_GATE`,
> both are `ownerMutation`, and `cockpit.ts` passes no `tenantSkillIds` so a published customization
> is INERT. The gate asserts the honest consequences — no control offers activation, and the surface
> never says "pending review" / "awaiting approval" / "once approved" — and 29-10-SUMMARY.md records
> the criteria as NOT MET rather than faking a path.
>
> **A PRECONDITION THAT DECIDES WHETHER ANY OF THIS CAN RUN:** `listPacks` returns ACTIVE packs only.
> With no active `pack-*` row the surface renders "No approved workflows are available to you yet."
> with ZERO controls and every assertion is unreachable; `settle()` accepts that state and the tests
> skip loudly rather than failing as if the product were broken. Five packs are active locally.
> The `@run` block (pin + two reruns, real model spend) is written and TAGGED but NOT YET RUN.)

> Last verified: 2026-08-30 (29-13 — **THE WORKFLOWS ROUTE HAS ITS FIRST BROWSER EVIDENCE, AND IT
> IS AN ABSENCE PROOF.** `routineBranch.test.ts` reads `29-RECURRENCE-DECISION.md` and asserts the
> branch that artifact selects (`defer`), so it is not hard-coded to one outcome; the deferred branch
> asserts `RoutineControls.tsx` does not exist, nothing binds a recurrence lifecycle API, and
> `PinnedWorkflowButton` is STILL MOUNTED — the manual rerun surface ROUT-02 actually shipped.
>
> **PROVEN IN BOTH DIRECTIONS, ON A REAL BROWSER, BY THE ORCHESTRATOR (2026-08-30).**
> Green: `e2e/routines.spec.ts` **5 passed**, PW_EXIT=0, including the two-identity case (tenant B,
> an ordinary non-owner, sees the same surface with the same absence).
> Red on demand: a `<button>Pause schedule</button>` planted in `workflows/page.tsx`, rebuilt and
> re-served, turned the scan RED naming it (`+ "Pause schedule"`); reverted, rebuilt, 5/5 green again.
> `routineBranch.test.ts` likewise: planting a `RoutineControls.tsx` turned **3** tests red, then it
> was deleted. Two full `next build` + restart cycles per direction — `@pikar/core` exports raw TS so
> Next BUNDLES it, and without a rebuild the browser tests the previous bundle.
>
> **THE SETTLE SIGNAL WAS ITSELF VACUOUS, AND ONLY THE POSITIVE CONTROL CAUGHT IT.**
> `routines.spec.ts` waited for `main.getByText("Run again")` before scanning for absence — but the
> pinned surface's always-present intro reads *"Nothing starts by itself — you press Run again."* So
> the settle matched STATIC COPY, fired before a single Convex query resolved, and every
> `toHaveCount(0)` below it ran against a page still rendering "Loading your workflows…". The scan's
> own positive control (`expect(names.length).toBeGreaterThan(0)`) refused: **0 controls found**.
> Without that control this would have been a green absence proof over a DOM the spec never read —
> the exact defect `workflow-pack-pilot.spec.ts`'s `@dark` block shipped, which passed with all six
> packs ACTIVE because `toHaveCount(0)` succeeds on its first poll.
> FIXED by settling on a CONTROL, not prose: a `button` named "Pin this workflow"/"Run again", or the
> empty-state sentence. None of those can render before `listPins`/`listPacks` answer; prose can be
> anywhere. **Rule this cost us: a settle signal must match something that CANNOT exist before the
> thing you are waiting for.**
>
> **A precondition worth knowing before reading this route's gates:** `listPacks` returns ACTIVE packs
> only (`by_name_status`, exact status — never "newest row", which would surface a candidate and undo
> the dark pilot). On a deployment where no `pack-*` skill has an active row the whole surface renders
> "No approved workflows are available to you yet." with ZERO controls, and any control-level browser
> assertion is unreachable. Five packs are active on the local deployment, which is why these gates
> could run at all.)

> Last verified: 2026-08-29 (29-08 FIX2 — **THE ENUM THAT REPLACED THE BOOLEAN HAD THE SAME HOLE,
> ONE ARM OVER.** Three independent verifiers applied the identical mutation:
> `outcome === null ? "unknown" : outcome === "blocked" ? "blocked" : "ran"` →
> `outcome === null ? "unknown" : "blocked"`, and `pinnedWorkflows` stayed **43/43 GREEN**. Under it
> a run that reached the model, answered and recorded spend rendered "Pikar stopped this run before
> it started. Nothing ran and nothing was spent" and wrote `state: "blocked"` to the audit plane —
> the same $0 falsehood the round before existed to kill. **No test in this repo had ever produced
> `state: "ran"` from the server**, because every $0 drive either exhausts the budget (→ `blocked`)
> or throws before a thread (→ `null`). A discriminant whose happy arm nothing reaches is not a
> discriminant.
>
> **Both halves of the close are in the tree.** (1) The derivation is the exported pure function
> `pinRunState(outcome: string | null)`, with all three arms asserted directly — `useful`,
> `partial`, `no_findings` and `failed` are each RAN, which also makes the module header's
> "`no_findings` is `ran`, not `unknown`" an enforced invariant rather than a comment. (2) **A
> COMPLETED TURN IS NOW DRIVEN END TO END, OFFLINE, FOR $0 OF REAL MONEY.**
> `pinnedWorkflows.test.ts` mocks `lib/models.resolveModel` to a scripted `MockLanguageModelV4` (the
> `knowledgeSearch.test.ts` idiom, and the same swap `__runWorkflowPackWithScript` performs); every
> other line is shipped code, so `runAgain` returns `state: "ran"`, `outcome: "useful"` **beside a
> real priced `spendEvents` row**. Zeroing the scripted token counts turns both assertions red, so
> the row is `priceUsage`'s, not a fixture's.
>
> **`"unknown"` had the mirror-image hole and it is closed the same way.** Both existing `unknown`
> drives kill the agent component, i.e. throw BEFORE any model call — so the one state whose whole
> purpose is "we cannot tell whether money was spent" had only ever been observed where money
> provably was NOT. The new drive lets the model answer, lets `recordModelSpend` run, and then
> throws from AFTER `runSpecialistTurn` (the exact seam the module header names). The state is still
> `unknown`, the audit row is still `unknown`, and a non-zero spend row sits beside it. The
> verifier's mutation `outcome === null ? (threadId === null ? "unknown" : "blocked")` — which
> re-instates the original lie on precisely the cockpit-swallowed-throw path — is RED on that test.
>
> **The "nothing runs by itself" scan now sees the copy a user actually reads.** It enumerated four
> READINESS states plus empty, all of them pre-press, so `BLOCKED_RUN`, `UNKNOWN_RUN`,
> `TRANSPORT_ERROR` and every `actionLine` branch were outside it: a verifier put "Pikar will retry
> this automatically every day" into the blocked copy and the web suite stayed 30/30 green. The scan
> now runs over every `PinAction` kind through `actionLine` (a `Record<PinAction["kind"], …>`, so a
> new kind fails the typecheck rather than going unscanned) AND over the DOM after a real press in
> five run-result states. That mutation is RED on both.
>
> **THREE CLAIMS DELETED RATHER THAN NARROWED.** (1) `latencyMs` is gone from the audit payload:
> nothing read it and its only assertion was `expect.any(Number)`, so `Date.now() - startedAt` → `0`
> survived. (2) `pinWorkflow`'s docstring no longer says the pin captures "the source preferences
> that row recorded" — that field lost its writer last round and the sentence was left standing.
> (3) `TRANSPORT_ERROR` no longer says "That did not go through": a browser that never saw the reply
> cannot know that. It now reads "Pikar could not confirm that. Reload the page to see whether it
> went through." and it is reachable from PIN and UNPIN only — **a throw out of the run channel now
> sets `runUnknown`**, because `runAgain`'s audit write sits outside its try, so a completed and
> possibly billed run can reject after the turn happened.
>
> **The `"blocked" ⇒ $0` absolute has a guard at last** (the two weaker `cockpit.ts` absolutes had
> one and the one carrying the money sentence did not): a scan asserts `workflowPackBinding.ts`
> writes `outcome: "blocked"` at exactly two sites, both BEFORE `runSpecialistTurn(`, with the
> literal `costUsd: 0` between the second and the model. Its reach is stated where it lives: a
> literal second producer is RED (and so are the two completed-run drives); a producer that builds
> the value from a variable is NOT seen by the scan, and only a drive that takes that path would
> catch it.
>
> Gates: `pinnedWorkflows` **53 tests** (was 43), `apps/web PinnedWorkflowButton` **33** (was 30).
> Mutations observed RED are listed in `29-08-FIX2-SUMMARY.md`. **STILL UNRUN: the browser** — this
> route has no Playwright spec and is still absent from the nav; and the web suite remains
> fixture-driven (its fixtures are now the server's own `FunctionReturnType`s, so a renamed state
> fails the typecheck, but only the backend suite proves a state is ever PRODUCED).)

> Last verified: 2026-08-29 (29-08 FIX — **THE PIN SURFACE TOLD A USER "NOTHING WAS SPENT" ABOUT A
> RUN THAT MAY HAVE BEEN BILLED.** Two independent verifiers found it. `runAgain` computed
> `ran = res.ok && outcome !== null && outcome !== "blocked"`, and `cockpit.startWorkflowPack`
> reports a pack-binding refusal and EVERY throw out of `runWorkflowPack` the same way (`ok:false`,
> no `outcome`; it never rethrows) — while `runPackTurn` rethrows from AFTER `runSpecialistTurn`,
> i.e. after the model may have answered and `recordModelSpend` may have run. So `outcome === null`
> collapsed into the same `false` as the $0 governed stop, the UI rendered "Pikar stopped this run
> before it started. Nothing ran and nothing was spent", and the audit row said `ran:false`.
> Deleting `outcome !== null &&` left the suite 34/34 green: the branch was unmutatable.
>
> **The boolean is gone.** `RunAgainResult` now carries `state: PinRunState = "ran" | "blocked" |
> "unknown"`, and so does the audit payload (the `ran` + `started` pair is deleted, not narrowed).
> Only two states may claim $0, and both can prove it: `ok:false` (refused before a thread, a plan
> row or a model call exists) and `"blocked"` (`runPackTurn` returns `costUsd: 0` literally).
> `"unknown"` renders "This run did not finish, and Pikar cannot tell whether it reached the model.
> It may have used part of today's budget — open your workspace to see what happened before running
> it again." and does not navigate. The `run_failed` refusal reason is DELETED: it was reachable
> only from a transport throw, which `transport` already covers, and its copy made the same
> unprovable promise.
>
> **ONE PIN PER PACK, PER TENANT — re-pinning REPLACES.** The backend used to insert a row per
> distinct lineage while the surface rendered one row per pack, so every extra pin was invisible,
> unremovable (the prompt menu filters workflow pins out) and functionally identical — `runAgain`
> sends the pack id and re-resolves to the ACTIVE version, so a pin of v4 and a pin of v5 run the
> same thing. The pinned version is a DISPLAY fact, not a selector. `listPins` therefore lost its
> `createdAt` sort (with one pin per pack there is nothing to order) and returns rows in
> `WORKFLOW_PACK_IDS` order, bounded by six.
>
> **`sourcePreferences` has no writer again**, and `schema.ts`'s "no writer of this field yet"
> comment is true once more. It was stored, folded into `pinIdentity` and read by NOTHING: no
> runtime honours a preference, and the surface never rendered it. `customizationHash` already
> hashes the exact values it was derived from, so it could only ever agree with the hash.
>
> **The unfalsifiable guards are guards now.** `runCount`'s prefix (`freshRunCorrelation(pinId,"")`)
> is pinned by a two-pin/two-tenant test — replacing it with a constant `"pin:"` counted every pin
> in the deployment across tenants and left 34/34 green; it is RED now. The range also compares
> `eventType`. The audit payload is asserted as a whole VALUE (`toEqual`, every field), plus a
> second run with three notices and two differing versions, so `noticeCount: 0` and
> `activeVersion: 999` are both RED. `newestCustomization`'s `templateId === packId` and
> `readinessFor`'s foreign-tenant check each have their own test.
>
> **Also:** the write-only `pinButtons` ref map is deleted; the `runCount` docstring's `schema.ts:359`
> citation was wrong (the comment is at `schema.ts:442`) and is fixed; the U+FFFF range bound is now
> actually written as the escape its comment claimed (commit `cdcf7dd`'s message said that change
> had been made and it had not — the message cannot be rewritten, so it is corrected here).
>
> **DEVIATIONS FROM 29-08's PLAN, RECORDED RATHER THAN BLESSED.** (1) The component is NOT wired to
> `checkReadiness`; readiness arrives embedded in `listPins` and a second read would be redundant.
> The source-scan assertion that froze that omission as "the four functions it MAY reach" is
> DELETED — the `convex/react` stub already enforces the closed set behaviourally, in every test, by
> throwing on any unexpected function path. (2) The plan's "shows last/manual-run outcome" is NOT
> met: the repeat ordinal and the last outcome live on the audit plane only, the surface has no
> persisted memory of them, and `ordinal`/`correlationId` are no longer returned to the browser at
> all rather than shipped as dead payload. Reading them back would need a per-pin audit range read
> on every reactive `listPins`.
>
> Gates: `pinnedWorkflows` 43 tests, `apps/web PinnedWorkflowButton` 30 tests. THIRTEEN mutations
> observed RED, listed in `.planning/phases/29-unified-knowledge-and-routines/29-08-FIX-SUMMARY.md`.
> STILL UNRUN: the browser. This route has no Playwright spec and is still absent from the nav.)

> Last verified: 2026-08-29 (29-08 — **`/dashboard/workflows` GAINED PIN AND RUN AGAIN CONTROLS,
> AND THEY SAY WHAT A RE-RUN ACTUALLY RUNS.** `PinnedWorkflowButton.tsx` is mounted above the
> customizer on this route and reaches exactly five functions: `listPacks`, and the four
> `pinnedWorkflows` verbs (`listPins`, `pinWorkflow`, `unpinWorkflow`, `runAgain`) — asserted as
> the complete `api.*.*` set in the shipped source, so a sixth cannot appear unnoticed. There is
> still NO activation, approval or rollback control here, and none is possible: both mutations are
> `ownerMutation`s.
>
> A run goes through `cockpit.startWorkflowPack` with no `threadId`, so each press is a fresh
> thread, a fresh `plans` row and a fresh correlation; the surface then navigates to
> `/dashboard/workspace?thread=<new>`. A run stopped at the governed gate does NOT navigate — it
> says "Nothing ran and nothing was spent", because sending the user to a conversation whose only
> reply is "I've paused for a moment" hides the fact that matters.
>
> `PinnedWorkflowButton.test.ts` is a jsdom CONTAINER test (the 29-07-FIX2 idiom: `createRoot`,
> real click events, only `convex/react` and `next/navigation` stubbed) — 28 tests. Nine mutations
> observed RED, including both click handlers cut to no-ops, `router.push` deleted, navigating on
> `res.ok` instead of `res.ran`, the runnable check dropped from the Run button's `disabled`, and
> the focus restore deleted. The no-recurrence scan runs over the RENDERED text of five states, not
> over the source, so the comment explaining the ban cannot fail its own check.
>
> ONE REAL DEFECT WAS FOUND BY THAT SUITE AND FIXED: the focus restore after "Remove pin" was
> written as an effect that looked once, and the unpin mutation resolves BEFORE the live `listPins`
> query pushes the removal — so there was no replacement button to focus yet and focus fell to the
> document body. It is now done in the button's own ref callback, which runs when the replacement
> mounts.
>
> STILL UNRUN: the browser. This route has no Playwright spec and is still absent from the nav.)

> Last verified: 2026-08-29 (29-07-FIX2 — **THE CONTAINER HALF OF `/dashboard/workflows` WAS
> UNPINNED, AND THE OPTIMISTIC-CONCURRENCY REFUSAL COULD NOT FIRE.** Four mutations that make the
> route functionally inert all passed the customizer suite: `onChoose`, `onSet` and `onSubmit` cut
> to no-ops, and `setBaseline(values)` deleted from the save's success arm. A user could open the
> page, click a workflow, type and press save with nothing happening, and every gate stayed green —
> the SSR suite renders `CustomizerView` from props and fires no event, so it was never able to say
> whether the container is wired to it. Three of the four were disclosed as "SOURCE-SCAN coverage,
> not behaviour coverage"; an honest label on a hole is not a fix.
>
> **`WorkflowPackCustomizer.container.test.ts` (new, 12 tests) MOUNTS THE REAL CONTAINER** under
> jsdom with `createRoot`, dispatches real click and `input` events, and reads the text back out of
> the document. `convex/react` is the only stub, and `useQuery` answers by the function reference's
> OWN path (`getFunctionName`), not by a hand-kept map. All four inert-making mutations go RED,
> observed, along with four more on the concurrency fix below. `jsdom` is the ONE dependency added
> (an `apps/web` devDependency); `react`/`react-dom` were already here and no testing-library is
> used. `apps/web/vitest.config.mts` named jsdom as the upgrade path for exactly this case.
>
> **`stale_base_version` WAS UNREACHABLE FOR THE CONTAINER PATH.** `submit()` read
> `selected.myBaseVersion` off the LIVE reactive `listPacks` query at save time, while the form's
> contents were snapshotted at open time by `choose()`. A concurrent publish moved the token without
> moving the data it describes, so the save carried the OTHER draft's version, the server accepted
> it, and the guard that exists for this exact race could never trip — silent last-write-wins, the
> failure `publishPackCustomization`'s own docstring calls the version of that failure nobody
> notices. The base version is now snapshotted in `choose()` beside `setBaseline(prior)`, passed to
> the view as `baseVersion`, and moved only by a save success (together with the baseline) or by
> `adoptedBase` on a refusal. **THE SURFACE ALSO RENDERED A FALSE SENTENCE** in that state, naming a
> version whose settings were not on the form; `lineageLine` now reads "This edit is based on your
> saved version N" — true after a refusal, where "your latest saved version is N" was not — and
> every saved-version sentence on the surface reads the frozen prop.
>
> **THE `server-only` BUILD STORY IS SETTLED, AND BOTH PREVIOUS RECORDS OF IT WERE WRONG.** It is
> neither "the gate cannot run here" nor "nothing imports it, ignore it". The mechanism, the
> one-line repair and the two fixes that do NOT work are now under *How to verify*, where an
> operator hitting the failure will look. Nothing was committed for it.
>
> **A §9 VIOLATION IS REPAIRED HERE TOO.** The previous round's code commit changed two files under
> this playbook's watched path without touching this file — its playbook commit landed BEFORE its
> code commit, and the Stop hook only inspects the working tree, so nothing could see it. That left
> a stale `apps/web 97/97` recorded as a package-level result; it is retracted in the 29-07-FIX
> block below.
>
> Measured on this tip: `WorkflowPackCustomizer.test.ts` 109/109 · `WorkflowPackCustomizer
> .container.test.ts` 12/12 · `apps/web` package 38 files / 762 tests (that package total moves with
> two sibling agents' uncommitted work in this worktree — trust the two FILE counts) ·
> `convex/workflowPackDiscovery.test.ts` 12/12, unchanged, and unchanged for a reason: the defect
> was entirely client-side and the server's per-name base-version resolution is already pinned
> there (mutation: `myBaseVersion: null` → 3 of 12 RED, observed) · `apps/web` typecheck clean ·
> `pnpm --filter @pikar/web build` EXIT=0 with `f /dashboard/workflows` in the route table.
> **STILL UNRUN: the authenticated browser gate.** jsdom is not a browser — no layout, no paint, no
> real focus ring — and no Playwright spec has loaded this route.)

> Last verified: 2026-08-29 (29-07-FIX — **TWO RECORDED FACTS IN THIS FILE WERE FALSE; BOTH ARE
> RETRACTED ABOVE.** (a) The Next production build DOES run here: `pnpm --filter @pikar/web build`
> exits 0 and `ƒ /dashboard/workflows` is in its route table, measured on this tip. It is the
> meaningful compile gate for the route and it should be run. (b) The eval harness's staging
> function is `seedCase` (`packages/backend/scripts/run-workflow-pack-evals.mjs`), not `stageFor`,
> and it plants THREE things: `smoke:seedPackEvalTenant` (a figure row, one calendar event, a
> `gmailTokens` row), `smoke:seedInboxFixture` (the mailbox — only when the fixture declares
> `inbox: available`) and `vaultSmoke:seedCorpus` (the briefs — only when an expected operation uses
> `searchVault`); `runCase` adds `smoke:seedCockpitPlan`.
>
> **THE MAILBOX CARRIES A REAL INJECTION, ON PURPOSE.** `seedInboxFixture`'s `fix-injection` message
> body is a forward-to-attacker instruction, and `pack-customer-complaint` is the only pack whose
> fixtures declare `inbox: available` — so all five of its cases run against it, not only its
> `-injected-` one. The other three seeded planes carry none. Every one of those four claims is now
> asserted against the SEEDER'S OWN sliced source, with a positive control on the slicer.
> `INJECTION_MARKERS` gained "system instruction": without it the guard could not see
> `IMPORTANT SYSTEM INSTRUCTION:`, the phrasing this repo's own probe payload uses, so planting that
> exact line in `vaultSmoke.ts` left the file green. It now goes red (observed).
>
> **THE RUNNER'S VALIDATOR NOW RUNS IN CI.** `run-workflow-pack-evals.mjs` executes `main()` only
> when Node was pointed at it, so `convex/workflowPackEvals.test.ts` imports the real
> `validateFixture` / `validateCorpus` / `projectRegistry` instead of carrying a second traversal.
> `--fixtures-only` still reports "30 valid". Two assertions were DELETED rather than kept: a
> tautological `toEqual(packReadableSources(packId))` (the implementation assigns that call's
> result; `packages/core/src/workflowCustomization.test.ts` is what catches a change to it, verified
> red) and a verbatim copy of `packages/core/src/workflowPacks.test.ts`'s grant-derivation test.
>
> **THE CUSTOMIZER IS NOW ASSERTED THROUGH ITS RENDER.** Every user-facing sentence used to be
> checked by CALLING an exported copy function; six could be stripped out of the JSX with the suite
> green. `WorkflowPackCustomizer` is split into a hooks container and `CustomizerView`, no copy
> function is exported, and the test renders with `react-dom/server` and asserts the RENDERED string
> and the exact ARIA id pairs on the exact controls. `ACTIVATION_NOTE`'s claim about `cockpit.ts` is
> cited by a test that reads `cockpit.ts` (adding `tenantSkillIds` there turns it red).
>
> **TWO USER-FACING DEFECTS CLOSED.** `baseCandidateVersion` came from `skills.myUserSkills`, a
> 50-row tenant-WIDE window; past it the form sent `null` forever and every save was refused
> `stale_base_version` with copy telling the user to reload — which reproduces the window.
> `workflowPackDiscovery.listPacks` now returns `myBaseVersion` from the same per-name
> `by_tenant_name_version` `take(1)` `readTenantPublishState` uses, the client adopts the server's
> `currentBaseVersion` on a refusal, and the copy asks for a retry that can win. And a repeat
> customization silently dropped every field the user did not re-type: `listPacks` returns
> `myCustomizationValues`, the form reopens with them, the diff is against what it opened with, and
> the surface says saving replaces the whole set.
>
> workflowPackEvals 22/22 · workflowPackDiscovery 12/12 · both typechecks clean ·
> `pnpm --filter @pikar/web build` EXIT=0. **STILL UNRUN: the authenticated browser gate.** No
> Playwright spec has been executed against `/dashboard/workflows`, and this release's honesty
> claims about what a user SEES rest on SSR renders, not on a live page.
> (An `apps/web 97/97` figure stood here and was stale before it was written: it was the customizer
> FILE's count at the commit that wrote this block, and the next commit of the same fix took that
> file to 109 while the package itself was 749. Re-measured numbers are in the 29-07-FIX2 block at
> the top. Record a FILE count under the file's name and a PACKAGE count under the package's, never
> one number under the other's label.))

> Last verified: 2026-08-29 (29-W3-TAIL-FIX — **THE `internalAction` JUSTIFICATION IS DELETED FROM
> THE CODE, AND THE 2026-08-28 ENTRY BELOW STILL STATES IT.** The `packArgs` docstrings in
> `workflowPackBinding.ts` no longer read "`internalAction` ⇒ never model-supplied" or "declared
> only on the two `internalAction`s below". Every declaring site is internal today and no test fails
> when one stops being, which `skill-registry.md`'s "The pin door IS open" records as a GAP rather
> than a bound; read that bullet, not the sentence in the entry below. Comment-only — no behaviour
> changed, `pnpm vitest run workflowPackBinding` is 39/39 and `pnpm typecheck` is clean.)

> Last verified: 2026-08-29 (29-07 Task 2 — **THE FIXTURE VALIDATOR RAN NOWHERE, AND FOUR OF THE
> SIX "INJECTION" CASES PLANT NO INJECTION.** `run-workflow-pack-evals.mjs --fixtures-only` is
> offline and free and validates the whole corpus, and no CI job invokes it; `packEvalSuite.test.ts`
> checks each file's sha256 and case count and nothing about its CONTENT. `convex/workflowPackEvals
> .test.ts` (new, 21 tests, $0, runs in `pnpm test`) now derives every legal value from the shipped
> code and checks the corpus against it: operations must be `existing`, `expect.sources` must name
> every reachable plane and only states `PACK_SOURCE_PROBE_STATES` allows, `expect.outcome` is
> checked through the REAL `outcomeFor` (a reachable plane declared unavailable forces `partial`),
> `toolsAllowed` must be in `toolsForWorkflowPack` and `toolsForbidden` must not be, and
> `artifactCreated` must not be claimed of a briefing pack.
>
> **THE FINDING AS FIRST WRITTEN HERE WAS WRONG AND IS RETRACTED.** It said "`stageFor` plants
> exactly two things (`smoke:seedInboxFixture`, `vaultSmoke:seedCorpus`) and neither contains an
> injected instruction — asserted, with a positive control". `stageFor` exists nowhere in this
> repository, three things are planted, and one of them DOES carry an injection. See the 29-07-FIX
> block at the top of this file for what the harness actually plants; do not cite this paragraph.
>
> Also made executable: a valid pack-suite evidence blob does NOT satisfy `hasPassingTenantEvidence`
> and tenant evidence does not satisfy `hasPassingPackEvalEvidence`, with a positive control that
> the pack blob really is valid for the GLOBAL row it names. The pack corpus can clear the gate it
> was written for (`--candidate`, live and paid); a TENANT customization has no gate to clear in
> this release, because `planTenantActivation` refuses it.)

> Last verified: 2026-08-29 (29-07 — **THE TENANT CUSTOMIZATION SURFACE EXISTS, AND IT SAYS WHAT
> IS TRUE.** `apps/web/app/(app)/dashboard/workflows/` is new and is now a watched path of this
> playbook. Every control on it is generated by iterating `packCustomizationFields`, so there is no
> hand-written field and nothing that carries a tool name, a URL, a secret or an assembled body; the
> only mutation it holds is `skills.publishPackCustomization`. The copy states the two things that
> are actually true of a saved customization — `planTenantActivation` throws `PACK_GATE` for every
> name in `WORKFLOW_PACK_SKILL_NAMES`, so it cannot be activated in this release, and `cockpit.ts`
> passes no `tenantSkillIds`, so no run a user starts reads it. "Pending approval" / "awaiting
> review" are banned by test, because that queue does not exist.
>
> **THE ROUTE IS NOT IN THE NAV** (`apps/web/app/(app)/layout.tsx`), by decision: it is reachable by
> URL only until plan 29-10 runs an authenticated browser gate against it. A test asserts the NAV
> does not link to it, with a positive control that the scan can see a route that IS linked. Adding
> the href IS the activation, and rollback is deleting it — the `dashboard-pages.md` rule.
>
> **UNRUN:** no browser has loaded this route. **TWO CLAIMS THAT STOOD HERE ABOUT THE BUILD WERE
> BOTH WRONG AND ARE BOTH RETRACTED** — first "the build cannot run in this worktree at all", then
> "the build runs, nothing imports `server-only`". `server-only` IS imported, from inside
> `@convex-dev/auth`, reached by `middleware.ts` and `app/layout.tsx`; the build's dependence on it
> is real. What was wrong was calling that a repo defect. The mechanism and the one-line repair are
> under *How to verify*. A false gate RESULT is worse than a false invariant in either direction:
> "unavailable" stops the gate being run, and "fine, ignore it" deletes the repair the next fresh
> worktree needs.)

> Last verified: 2026-08-29 (29-W3-TAIL — **`workflowPackBinding.ts`'s `TENANT_SKILL_PIN_FOREIGN`
> THROW NO LONGER JUSTIFIES ITSELF WITH AN UNENFORCED CLAIM.** The comment above it read *"both
> entry points that declare `tenantSkillIds` here … are `internalAction`s, so a foreign id is a BUG,
> not an outcome"* — true today, enforced by nothing, and used to argue for throwing rather than
> returning a governed refusal. The justification is deleted; the comment now states the consequence
> (a caller reaching it with a foreign id gets an unhandled error, not a rendered outcome) and points
> at `skill-registry.md`, which records the same gap for all eight declaring sites. No behaviour
> changed — the tenant comparison before `preCall` is untouched.)

> Last verified: 2026-08-29 (29-FIN-05 PROSE SWEEP — **THE PIN DOOR IS OPEN ON PURPOSE, AND THE
> COMMENTS THAT DENIED IT ARE GONE.** `skills.ts` said a pack customization row was "DARK BY
> CONSTRUCTION" and could "never become the body a specialist runs"; the `tenantSkillIds` rail runs
> one, and the 29-05 tests always showed it. Those absolutes are deleted from `skills.ts` and
> `workflowPackBinding.ts`; `docs/playbooks/skill-registry.md` gained "The pin door IS open, and
> this is what governs it" — internal-only, tenant-scoped, name-scoped, no grant, no state. One
> assertion was ADDED here: the pinned run re-reads the row and proves it patched no status, wrote
> no evidence and flipped no `rollbackEligible` (mutation: patch the row in `runPackTurn` -> RED).
> Also recorded, because it is the real state of the channel: **no production caller passes
> `tenantSkillIds` for a pack.** `cockpit.ts` is the only caller of `runWorkflowPack` and it passes
> `skillVersions` (a global preview pin) only, so what a tenant publishes through the customization
> form is inert until someone decides who may pin it. No behaviour changed.)
>
> Previously verified: 2026-08-28 (29-05 REMEDIATION — **THE PIN IS NOW TENANT-SCOPED, AND THE GRANT TEST
> NOW REACHES ITS OWN SCENARIO.** Two corrections to the bump below it:
>
> 1. **`TENANT_SKILL_PIN_FOREIGN`.** `skills.getTenantSkillVersion` resolves a `tenantSkills` row BY
>    ID and `runSpecialistTurn`'s only guard is `row.name !== skillName`. Two tenants can each own
>    `pack-business-pulse` — that is exactly why the pin is a row id — so the name check was never
>    the isolation argument, and neither was "validated as `v.id(...)`": a valid id is still a valid
>    id for someone else's row. `runPackTurn` now compares `row.tenantId` to the run's tenant BEFORE
>    `preCall` and before any event is written. Root fix (a required `tenantId` arg on
>    `getTenantSkillVersion`, closing the dispatch surface too) is an open follow-up in `llm.ts`.
> 2. **The grant test was vacuous.** "a tenant candidate body CANNOT widen the grant" stayed green
>    when the pin was never forwarded — it could not tell "the tenant body ran and did not widen the
>    grant" from "the tenant body never ran", so deleting the whole `tenantSkillIds` feature left it
>    passing. It now asserts `skillVersion === 7` on every probe chunk, which is only readable if the
>    pinned candidate reached the loader. The claim below is true again, and now enforced.
>
> Also: `planTenantActivation` throws `PACK_GATE` for any name `isWorkflowPackSkill` accepts, ahead
> of its mode switch, so a tenant pack candidate does not go active and `loadEffectiveSkill` keeps
> serving the global body. The pin rail is how that candidate body reaches a model instead. See
> docs/playbooks/skill-registry.md "THE PACK GATE HAS NO TENANT LANE" and "The pin door IS open".)
>
> Previously verified: 2026-08-28 (29-05: `packArgs` gained `tenantSkillIds` — the tenant twin of the
> `skillVersions` pin, forwarded to `runSpecialistTurn` so a tenant's schema-driven pack
> customization can be RUN before it is activated. Row ids (`v.id("tenantSkills")`),
> `internalAction` only, never model-supplied. The tool grant is unchanged and still derived from
> the operation matrix: `workflowPackBinding.test.ts` drives a tenant candidate body that asks in
> prose for every forbidden tool and proves the executed record is still `toolsForWorkflowPack`.
> A pinned row naming a different pack is refused as `TENANT_SKILL_PIN_MISMATCH` before any model
> call. See docs/playbooks/skill-registry.md "Phase 29 — pack customization" for the authoring
> half and for the runner gap that still leaves a tenant candidate uncertifiable in practice.)
>
> Previously verified: 2026-08-28 (29-01 second repair round: the "no dead vocabulary" exemption for
> `support-desk` now CALLS `renderSourceGap` instead of spreading `KNOWLEDGE_SOURCES`.
> Membership in a second const is a DECLARATION, not a read — the exact shape this file rejects
> for tool grants — and `support-desk` is the one source no pack operation reads, so it was the
> only member the exemption actually carried. The user-facing sentence is now pinned as a
> literal in `knowledgeSearch.test.ts`. Pack behaviour is unchanged.)
>
> Previously verified 2026-08-27 (Phase 29 made this file's source registry the repo's ONLY one —
> see "Phase 29 shares this registry" under Dependencies. Pack behaviour is unchanged.)
>
> Previously verified 2026-08-26 (**THE SIX PACKS ARE CERTIFIED ON PRODUCTION'S EVAL PLANE AND STILL

> Last verified: 2026-08-26 (**THE SIX PACKS ARE CERTIFIED ON PRODUCTION'S EVAL PLANE AND STILL

> DARK THERE.** Prod candidates seeded at v1 — note they are v1 while dev carries v4/v5/v10/v11:
> versions are PER DEPLOYMENT and a version number is never a cross-deployment identifier. Six gates
> run with `PIKAR_CONVEX_TARGET=prod`, 30/30, ~$0.41. `campaign-plan` passed FIRST TRY on prod after
> costing four runs on dev — the corpus and body fixes, not luck.
>
> **SINGLE-RUN CERTIFICATION DOES NOT MEASURE RELIABILITY, and every pack — dev AND prod — was
> certified on one run.** `process-sop` was caught only because a gate run happened to fail: over
> `--repeat 3` it scored **3/5** on `process-sop-03`, failing with `operation:save-sop: expected
> "saveAsDocument", got []` in ~2.5s at $0.0012 — the model answering in prose and never calling the
> save tool. **A green gate run proves a pack CAN pass, never that it DOES.** The other five have not
> been repeat-measured; that is unknown, not proven. Use `--repeat` before trusting a pass count, and
> never compare two bodies on one run each.
>
> **THE FIX WAS THE INSTRUCTION, NOT THE MODEL.** Step 1 asked "is this turn going to produce an
> SOP?" — a judgement the model gets wrong when the turn is dominated by things the pack CANNOT do
> ("write it up, then assign the steps and set a quarterly review"). It concluded no and skipped the
> save. The step now names the trigger concretely and states that unsatisfiable extras NEVER cancel
> the save; they are gap lines in section 6. Re-pinning a pack body means FOUR places, and `--check`
> only catches three: canonical `.md`, derived `.ts`, `bodySha256` in the code-owned
> `knowledgeWorkProvenance.ts` mirror, and `adaptedBodySha256` in the manifest. The MIRROR is the one
> the provenance script passes over — `knowledgeWorkProvenance.test.ts` is what fails, and it did.
>
> **PRODUCTION HAD NO OWNER AT ALL.** `bootstrapOwner` had never been run there, so the owner regions
> never rendered, `@discovery`/`@preview` skipped, and the browser plane could not be earned by
> anyone. The address also has SEVERAL `users` rows (Convex Auth writes one per identity), so an
> email is not an identity here. The row was derived from the captured session's own JWT subject
> (`sub` before `|`) — the row the browser actually authenticates as — and granted by exact id.
>
> PREVIOUS: 2026-08-26 (**BOTH ROLLBACK PATHS ARE NOW PROVEN FROM THE BROWSER. No `fixme`
> remains in `@drill`.**
>
> **ROLLBACK TO A PRIOR VERSION.** `listPackPriorVersions` (`ownerQuery`) returns each pack's newest
> ARCHIVED version, and the owner controls render `Roll back to vN` beside `Turn off`. Archived is
> exactly the right set: `deactivatePack` and `archiveSkill` are its only writers, so an archived
> row is one that WAS live — which is why `planGlobalActivation` lets it back in without re-running
> the evidence planes. **That exemption is deliberate and this is the only test that exercises it
> from a surface an owner would actually use:** rollback must work mid-incident and must never be
> blocked by a broken eval or browser harness.
>
> **THE DRILL ASSERTS THE PACK IS STILL OFFERED AFTERWARDS.** A rollback that darkened the pack would
> be an OUTAGE, not a rollback — users are supposed to keep a working version. It also asserts the
> target version DIFFERS from the live one, because otherwise "it rolled back" is indistinguishable
> from nothing happening. Verified live: brand-review v4 -> v3, still on offer.
>
> **THE PRECONDITION WAS EARNED, NOT MANUFACTURED.** Two live versions of one pack were needed. Rather
> than mint a throwaway version, `pack-brand-review` got the LABEL CONTRACT its body was still
> missing (`your confirmed brand guidance`, `your saved content shelf`) — real robustness work,
> since its `missingNamed` asserts pass today but sit one paraphrase away from the failure that cost
> campaign-plan four runs. v4 certified 5/5 for $0.0125 on the first attempt, earned browser
> evidence, activated, and archived v3 as a side effect of ordinary work. **business-pulse and
> sales-call-prep still lack the contract** and are the next two to get it.
>
> **THE HARNESS IS NOW DEPLOYMENT-AWARE, and it was not before.** `smokeRun.mjs` invoked
> `npx convex run` with NO deployment flag, so every pack eval, smoke script and browser
> provisioning step silently targeted DEV. That is a safe default — an unflagged run can never touch
> production by accident — but it also meant **the pack gate could not be satisfied on production at
> all**, which is a missing capability rather than a config gap. `PIKAR_CONVEX_TARGET=prod` now
> passes `--prod` through, per invocation, with no way to make it the default. The runner's log and
> evidence line printed a hardcoded "(dev)"; it prints the real target now — mislabelling which
> deployment a run certified is precisely the failure the per-deployment rule exists to prevent.
>
> PREVIOUS: 2026-08-26 (**ALL SIX PACKS ARE LIVE, AND ROLLBACK-TO-DARK IS PROVEN BY A CLICK.**
> Activation went through `skills.activateSkill` -> `assertPackActivationEvidence`, so the gate
> itself accepted all three planes for every (name, version); it would have thrown `PACK_GATE`
> naming the missing one otherwise.
>
> **THE UNDO PATH EXISTS NOW.** `WorkflowPackOwnerControls` is an owner-only "Live workflows" section
> whose Turn off button calls `skills.deactivatePack`. That closes the gap `deactivatePack`'s own
> docstring named: the registry's only other dark path is `npx convex run skills:archiveSkill`, and
> one `convex run` DESTROYS the browser session — so an owner mid-incident had to choose between
> turning a pack off and staying signed in, and the drill could not be a browser assertion at all.
> The `@drill` test is no longer `fixme`: it proves the pack is really on offer, clicks Turn off,
> proves it leaves the surface every user sees, and **proves it comes back as a CANDIDATE** — without
> that last assertion, "it vanished" would pass just as well if the row had been destroyed.
>
> **`@dark` COULD NEVER FAIL, AND THAT WAS THE MOST IMPORTANT FINDING OF THE WHOLE EXERCISE.**
> `expect(locator).toHaveCount(0)` SUCCEEDS ON ITS FIRST POLL, and on first paint the count is 0
> because the Convex query has not resolved. So the phase's central property — the pilot is invisible
> — was asserted by a test that passed with all six packs ACTIVE and offered. **Absence needs a
> settle signal exactly as much as presence does.** `settlePackQueries` waits for whichever owner
> section is rendered (candidates while dark, live controls once active) before any assertion runs.
>
> **IT WAS THEN FALSIFIED IN BOTH DIRECTIONS, which is the only reason to believe it now:** with the
> packs live `@dark` went RED, and with them archived it went GREEN. A guard that has never been
> observed failing is decoration.
>
> The `@dark` name check is SCOPED PAST THE OWNER SECTIONS. The owner's preview shows pack names by
> design while dark — that is what it is for, and it says "Not live". The property is that no pack is
> OFFERED, so every occurrence must be accounted for by an owner-only region; a name anywhere else
> still fails.
>
> **AND `@discovery` HAD THE SAME STRICT-MODE DEFECT AS `@preview`** — `getByRole("listitem")`
> matching the preflight's per-source `<li>`s, and a `getByText` regex resolving to four elements.
> It could never have passed either. Scoped to `li.pack-quickstart` and asserting over the card's
> `innerText`. Every block in this spec now asserts something.
>
> STILL OWED: rollback-to-a-prior-VERSION, which needs two activated versions of one pack. Left
> `fixme` rather than faked.
>
> PREVIOUS: 2026-08-26 (**THE BROWSER EVIDENCE PLANE IS GREEN. ALL SIX PACKS NOW CARRY ALL
> THREE: provenance, eval and browser.** `workflow-pack-pilot.spec.ts` had NEVER been run; running
> it found six defects, five of them in the spec and the harness rather than the product.
>
> **HOW AN OWNER IS PROVISIONED, because there was no way to sign one in.** `auth.setup.ts` signs an
> EXISTING user in; nothing created one, signup is invite-gated, and `listPackCandidates` is
> owner-only. `e2e/provision-owner.setup.ts` (project `provision`, opt-in via
> `PIKAR_E2E_PROVISION=1`) walks the sanctioned internal seams: `invites:__seedInvite` ->
> real /signup form -> `owner:findUserIdByEmail` -> `owner:bootstrapOwner` ->
> `onboarding:__seedOnboardedTenant`. All five matter; the last one is the `(app)` layout's
> force-redirect, which makes the workspace unreachable for a fresh account.
>
> **DO NOT REUSE `e2e@pikar.test`.** It pre-exists with a password nobody has, so signup silently
> no-ops, `bootstrapOwner` promotes the old row, and sign-in then fails "Wrong email or password"
> while everything looks provisioned. The owner used here is `packowner@pikar.test`. And the
> provisioner MUST check whether the account exists BEFORE seeding an invite: the first successful
> signup REDEEMS the code, so a second run's preflight rejects it and leaves Create Account disabled.
>
> **FIVE SPEC DEFECTS, and every one produced a GREEN-LOOKING run.**
>   1. `locator.count()` DOES NOT AUTO-WAIT. Counting straight after the navigation saw 0 before the
>      Convex query resolved, so `test.skip` fired and the whole block reported "skipped" on a page
>      where the cards were demonstrably rendering. **This is why the pre-existing `@discovery` and
>      `@run` blocks have never asserted anything** — they use the same count-then-skip shape.
>   2. `getByRole("listitem")` matched the PREFLIGHT SOURCE ROWS inside each card, not just the
>      cards — `WorkflowPackPreflight` renders an `<li>` per source. Scope to `li.pack-candidate`.
>   3. A `getByText` regex over a preflight resolves to MANY elements and dies of strict mode. Read
>      the card's `innerText` and match against that instead.
>   4. `text-transform: uppercase` (BRAND §5) reaches `innerText`, so `/Candidate v(\d+)/` never
>      matched `CANDIDATE V2`. Match case-insensitively.
>   5. **MODULE STATE DOES NOT SURVIVE A WORKER RESTART.** The versions the browser saw were held in
>      a `Map`; one unrelated failure started a fresh worker, the map was empty, and the evidence
>      writer SKIPPED ITSELF and reported success. It is a file under `e2e/.auth/` now.
>   And one product defect: `listPackCandidates` copied `listPacks`'s `.unique()`, which is right for
>   `active` (only ever one row) and WRONG for `candidate` (sales-call-prep has eleven). The query
>   threw, `useQuery` stayed `undefined`, and the section rendered nothing.
>
> **WHAT THE EVIDENCE SAYS, and what it does not.** `hasPassingPackBrowserEvidence` asks for "an
> authenticated person REACHED it at more than one viewport". Each pack's row is written from cards
> actually rendered at 1440 AND 390 with an enabled control and a visible preflight, plus ONE real
> Preview press proving the control starts a run. It does NOT claim every pack was run in a browser —
> that is the eval plane's job, and all six answer it 5/5.
>
> **NOTHING HAS BEEN ACTIVATED.** All three planes are green, so `assertPackActivationEvidence` would
> now pass — activation is a deliberate owner decision and stays one. The `@drill` rollback tests are
> still `fixme`: they need an owner-facing deactivate CONTROL, because `convexRun` destroys the
> browser session and `deactivatePack` is an `ownerMutation` the CLI cannot call.
>
> PREVIOUS: 2026-08-26 (**THE PACK GATE WAS DEADLOCKED, AND HALF THE BREAKER WAS ALREADY
> BUILT.** Activation needs browser evidence; browser evidence needs an authenticated person to REACH
> a pack in a browser; `listPacks` is ACTIVE-ONLY by design and nothing is active until the gate
> passes. Measured 2026-08-26: six packs with eval evidence, **zero** with browser evidence, and
> `recordPackBrowserEvidence` had only unit-test callers — a fully green browser run would have
> recorded nothing at all.
>
> 27-09 had already shipped `startWorkflowPack`'s owner-only `previewVersion` for exactly this, so
> the owner could RUN a candidate. **Nothing let them SEE one**, so there was no surface to press.
> 27-11 adds `workflowPackDiscovery.listPackCandidates` (`ownerQuery`, candidate-only) and a
> `WorkflowPackOwnerPreview` section whose Preview button sends the version THE CARD RENDERED.
>
> **IT IS A SEPARATE QUERY AND A SEPARATE REGION, both deliberately.** An `includeCandidates`
> argument on `listPacks` would be one argument away from undoing the dark pilot for every tenant
> from any caller; `ownerQuery` cannot be reached by a non-owner at all. And the region is named
> "Candidate workflows — owner preview" rather than "Guided workflows" because the `@dark`
> assertions prove the pilot is invisible by requiring the LATTER to be empty — a preview rendering
> into it would make those assertions pass for a reason they do not mean.
>
> **THE VERSION PIN IS THE POINT.** Evidence names a (name, version) pair, so the card shows
> `Candidate v{n}` and the click sends that exact number back. A preview that ran "the newest
> candidate" would record browser evidence naming a version nobody watched — the same defect class as
> `hasPassingPackEvalEvidence` not comparing an evidence row's model to the lane pin.
>
> **WHAT THE EVIDENCE MAY CLAIM.** `hasPassingPackBrowserEvidence`'s contract is "an authenticated
> person REACHED it at more than one viewport" — not that every pack was run. The `@preview` block
> therefore asserts each card renders its preflight, its version badge and an ENABLED control at 1440
> and 390, and one test actually presses Preview so that "reachable" is not a claim about a button
> nobody clicked. Do not widen the row beyond that: `pass: true` for a pack the browser never
> displayed is the one thing this plane exists to prevent.
>
> **THE HAND-COPIED LITERAL, and it was wrong on the first try.** The spec maps a rendered card TITLE
> back to a pack id and CANNOT import `@pikar/core` (it drives a built app). It said "Process / SOP
> builder"; the registry says "Process / SOP". `packOwnerPreview.test.ts` now pins the whole map
> against `WORKFLOW_PACKS` in both directions.
>
> **STILL OWED: the live run.** The spec is written but has never executed, and this machine cannot
> sign one in — `auth.setup.ts` needs `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`, no password is stored,
> signup is invite-gated, and the only owner account is a Google login. The automatable route exists
> (`invites:__seedInvite` then `owner:bootstrapOwner`, both `internalMutation`) but has not been
> walked. **No pack may be activated until it has.**
>
> PREVIOUS: 2026-08-26 (**ALL SIX PACKS NOW CARRY EVAL EVIDENCE AND VALID PROVENANCE.**
> `pack-customer-complaint` went 0/5 -> 5/5 (v3) for $0.045 across three runs, and the defect was
> neither the body nor the model: **the pack's output contract was unreachable by any route.**
>
> **THE DIAGNOSIS, because the shape recurs.** `draft_reply` means a STAGED draft, and staging needs
> two things the pack could not get: `replyToMessage` is the only granted tool that can set a
> recipient on the plan row, and it resolves its target SERVER-SIDE against the mailbox, writing
> NOTHING on 0 matches (the no-guess discipline). `proposePlan` then refuses with "no recipients are
> set", and `resolveContacts` is not granted. **All four fixtures that expected a staged draft seeded
> `inbox: "unavailable"`**; case 04, the only one WITH an inbox, was the only one that did not fail
> on a tool. The model typed a competent draft into its prose and, on turn 2, said it no longer had
> it — the correct behaviour available to it, scored as failure.
>
> **THE FIX WAS A SEAM, NOT A SENTENCE.** `smoke:seedInboxFixture` gained an OPT-IN `complaint`
> message (Dana Whitfield, fully replyable) and cases 01/02/03/05 now point at it with the inbox
> available. Four of five cases passed on the FIRST run afterwards. With inbox and vault both
> reachable this pack has no unavailable reachable source, so its outcome is `useful` — the old
> `partial` was produced by the very gap that made the pack inoperable. Case 01's id was
> `-pasted-complaint` and is now `-inbox-complaint`, because an id that lies is worse than a rename.
>
> **THE RULE THIS ADDS, and it is different from the subject-less fixture:** before blaming a body,
> check that the pack's OUTPUT CONTRACT is reachable with the tools it is granted and the state the
> fixture seeds. Read the granted tools' preconditions — `replyToMessage` needs a resolvable message,
> `proposePlan` needs recipients/subject/body already on the row. A contract no tool can fulfil
> produces a confident, well-written failure every single time, and no prompt will move it.
>
> A COROLLARY, seen twice now: a required gap statement must be part of the OUTPUT STRUCTURE, not
> guidance prose. Case 01 emitted `your connected sales and accounting systems` verbatim but dropped
> the CRM half from a terse summary, exactly as `process-sop-02` dropped its task-system line.
> Naming both as a fixed pair in the procedure's last step fixed it.
>
> PREVIOUS: 2026-08-26 (**`pack-sales-call-prep` IS 5/5 AND CERTIFIED — the fixture was the
> defect, exactly as this playbook predicted, and the fix was three words.**
>
> `-02-no-crm-invention` had failed EIGHT model runs across THREE body versions. Its turn 1 named
> Harrow Plumbing and asked an unanswerable CRM question; its turn 2 said "get me ready for the call
> with whatever you can see" and named nobody, while the eval's own `[ref zqk-…]` needle sat beside
> it. The model answered "I can't identify the prospect from the reference marker alone" — a CORRECT
> response to what that turn actually said. Turn 2 now names Harrow Plumbing, and the case passed
> first try: 5 vault searches, a calendar read, web research, a `declareUnsupported` for the CRM gap,
> a saved prep, no fabricated money, and an opening line naming the records it cannot read.
>
> **THAT IS THE SUBJECT-LESS FIXTURE FOR THE SIXTH TIME, and it is now the FIRST thing to check when
> a case resists body work.** The tell is a case that survives body versions which move every OTHER
> case: a prompt cannot supply a subject the conversation never contained. Reading the turns alone —
> no vault, no tools — and asking what a careful person could produce from them would have found all
> six of these for free, before any of the eight paid runs this one absorbed.
>
> **Five of six packs now carry eval evidence** (business-pulse v2, campaign-plan v6, sales-call-prep
> v11, process-sop v4, brand-review v3). `pack-customer-complaint` is the only holdout and is NOT a
> body problem — see the `replyToMessage` capability contradiction recorded above. NO pack has
> browser evidence, so none can activate.
>
> PREVIOUS: 2026-08-26 (**FOUR OF SIX PACKS NOW CARRY EVAL EVIDENCE — campaign-plan v6,
> process-sop v4 and brand-review v3 were all certified 5/5 in this session, joining business-pulse.
> process-sop went 0/5 -> 5/5 for $0.029 total.** Every fix that moved a score was a body or corpus
> defect; not one was the model being incapable. Three patterns, all now closed and all reusable.
>
> **1. THE SUBJECT-LESS FIXTURE — five cases across three packs, and the single most common defect in
> this corpus.** A fixture that asks for work on a subject it never supplies has exactly one correct
> answer, and it is not the one the fixture asserts. `brand-review-03` said "Check this against how
> we normally write" **with no copy attached**, while the other four brand-review fixtures paste the
> copy inline — and it was the only one failing, across two runs. `process-sop-04` asked the pack to
> find a doc in an unreadable Drive with an empty vault and asserted `artifactCreated: true`, which
> is a document the model could only have INVENTED — the exact fabrication the pack exists to
> prevent. `campaign-plan-03` and `-05` were the same. Every one was fixed by putting the subject in
> the turn, and every one then passed. **THE TEST, before blaming a body: read the fixture's turns
> alone, with no vault and no tools, and ask what a careful person could produce from them.**
>
> **2. A TOOL-ORDERING INSTRUCTION MUST BE STEP 1 OF A NUMBERED PROCEDURE.** In a tool-list bullet it
> is ignored. campaign-plan v3 carried "Call it before you write the plan, on the same turn" in its
> `saveAsDocument` bullet and did not save; v4 moved that identical sentence into "FIRST, before you
> read anything" and it saved. process-sop and brand-review had the bullet and NO procedure section:
> process-sop was 0/5 with `saveAsDocument` uncalled on all five (two cases called no tool at all).
> Adding the procedure took process-sop to 3/5 immediately. **All five bodies with a procedure now
> pass their save assert; the one pack without one is the one pack still at 0/5.**
>
> **3. `missingNamed` WAS A SYNONYM TREADMILL, AND THE FIX IS TWO-SIDED.** `connector-financials`
> produced three DIFFERENT near-misses in four runs, the last against a reply headed "Measurement
> gaps the owner cannot resolve in this workflow" — correct, specific, and matching no entry. The
> repair: the runner now appends `PACK_SOURCE_LABEL[source]` (minus its leading "your ") to the
> phrase list, AND the bodies are instructed to name each unreadable source with those exact words.
> **NEITHER HALF WORKS ALONE** — the label match is dead unless the model emits the label, and the
> instruction is pointless unless the scorer looks for it. Together they closed a case that had
> failed four consecutive runs, on the first attempt. Prefer this to adding another synonym: the
> label is one code-owned string that is already what the owner is shown everywhere else.
>
> A COROLLARY worth keeping: a gap statement must not depend on the owner raising the subject.
> `process-sop-02` is about invoicing and owners, so the model never volunteered the task-system gap
> until section 6 was told to carry both gap lines on EVERY SOP whether or not they came up.
>
> PREVIOUS: 2026-08-26 (**ALL SIX PACKS HAVE NOW BEEN RUN. Scores: business-pulse 5/5
> (certified), campaign-plan 4/5, brand-review 4/5, sales-call-prep 4/5, customer-complaint 0/5,
> process-sop 0/5. Total spend for this session's runs: ~$0.62.** Three findings, each measured.
>
> **1. AN ORDERING INSTRUCTION IN A TOOL-LIST BULLET IS NOT FOLLOWED. THE SAME SENTENCE AS STEP 1 OF
> A NUMBERED PROCEDURE IS.** This is the single highest-yield fact this phase has produced, and it is
> measured rather than argued. `pack-campaign-plan` v3 carried "Call it before you write the plan, on
> the same turn" inside its `saveAsDocument` bullet and did NOT save on case 04; v4 moved that
> identical instruction into a "How to run this" list as **"FIRST, before you read anything"** and it
> saved. `pack-process-sop` and `pack-brand-review` both carry the bullet, NEITHER has a procedure
> section, and process-sop scored **0/5 with `saveAsDocument` uncalled on every case** (two cases
> called no tool at all, $0.0007 and $0.0010 — the model answered straight into prose).
> brand-review's case 03 did the same. **A pack body without a numbered procedure whose FIRST step is
> the persisting tool call will lose its deliverable.** All four bodies that have one now pass the
> save assert.
>
> **2. `missingNamed` IS A SYNONYM TREADMILL, AND IT IS NOW THE ONLY THING BLOCKING campaign-plan.**
> The check matches a fixed phrase list against free prose, and the model names each gap accurately
> in DIFFERENT WORDS every run. `connector-financials` alone produced three distinct near-misses in
> four runs: "connected sales systems" (no entry contains it), then "Sales conversion data. Revenue,
> acquisition cost, or customer value" — a reply whose section heading is literally "Measurement gaps
> the owner cannot resolve in this workflow". The gap WAS named, correctly and specifically, and the
> scorer could not see it. The list was already widened once for customer-complaint and the same
> source failed again. **Adding one more string is not the fix.** The structural repair is to match on
> the code-owned `PACK_SOURCE_LABEL` and require bodies to use that label verbatim, so one
> code-owned string is both what the user is told and what the scorer looks for.
>
> **3. `pack-customer-complaint` HAS A CAPABILITY CONTRADICTION, NOT A BODY PROBLEM — 0/5, AND NO
> PROMPT CAN FIX IT.** `replyToMessage` resolves its target SERVER-SIDE against the mailbox and, by
> the deliberate no-guess discipline, "0/2+ matches → clarify and write NOTHING". **All four fixtures
> that expect it seed `inbox: "unavailable"`**; case 04, the only one with an inbox, is the only one
> that did not fail on a tool. The pack's own spec comment says "Pasted text is the first-class
> input" — but a pasted complaint has NO inbox message to resolve, so the staging seam its
> `draft_reply` contract depends on cannot fire. The model typed a competent draft into its prose and
> then, on turn 2, said it no longer had it. **This needs an owner decision (a staging seam for
> pasted text, or fixtures with a seeded mailbox), not another body version.** Do not spend runs on
> this pack until it is settled.
>
> PREVIOUS: 2026-08-26 (**`pack-campaign-plan`'s corpus and body contradicted each other AND
> the scorer, and BOTH defects were provable from code alone — no model run, no spend.** This is the
> pack's first candidate run; the two fixes below were made before it, so the run measures the pack
> rather than rediscovering what reading two files already showed.
>
> **1. ALL FIVE fixtures asserted an `expect.outcome` no run of this pack can produce.** `outcomeFor`
> returns `partial` only on `truncated || declaredUnsupported || runtimeMissing > 0`. campaign-plan
> reads exactly two planes and `workflowPackDiscovery.probeSourcesFor` hardcodes **`vault:
> "available"`** and **`web: "available"`** — no tenant grant gates either, and `seedCase` has no
> knob for them — so `runtimeMissing` is permanently `[]`. That leaves `declaredUnsupported =
> declaredQuestionScope && sources.length === 0`: call `declareUnsupported` AND come back with zero
> URLs. But `thresholds.json` sets `minCitationsWhenWebRead: 1` for this pack, so the corpus
> simultaneously DEMANDED the research that makes `partial` unreachable. All five are now `useful`.
>
> **THE GENERAL RULE, and it is how the other three unrun corpora were cleared for free:** a pack's
> `partial` is only reachable through a plane whose state `seedCase` can actually turn off.
> `process-sop` (drive) and `customer-complaint` (inbox) are seeded per-case, so their `partial`
> asserts are sound. `brand-review` reads the vault and nothing else — and because
> `declareUnsupported` is granted ONLY as a pair with `webResearch` (`researchTheWeb`), a pack
> without web access can never set `declaredQuestionScope` at all, so its five `useful` asserts are
> structurally guaranteed. **Three runs were saved by asking that question offline.**
>
> **2. The BODY licensed the exact output the threshold fails on.** It said "A category-typical number
> from `webResearch` is fine — attributed, and clearly not theirs", while `maxUnsupportedFigures: 0`
> is enforced by `moneyIn`, a regex over the whole transcript that cannot see an attribution.
> `campaign-plan-03`'s turn 1 is literally "How big is the market for this" — a guaranteed red before
> any model was asked. The body now forbids money outright (the rule `pack-sales-call-prep` already
> carries), **Objective** asks for a COUNT rather than a revenue target, and the `webResearch` bullet
> no longer advertises "public pricing". Where an amount must be decided it is a line in **Decisions
> for the owner**, stated as the decision rather than as a number.
>
> **WHEN A BODY AND A THRESHOLD DISAGREE, THE THRESHOLD WINS AND THE BODY IS THE BUG.** The scorer is
> code the pack cannot argue with; the body is prose the model will follow. A body that permits what
> the scorer forbids does not produce a borderline result — it produces a reliable failure, and one
> that reads like a model problem.
>
> PREVIOUS: 2026-08-26 (**`artifactCreated` WAS READING THE WRONG TURN, and it was scoring the
> exact opposite of the behaviour the bodies teach.**
>
> `packRunFacts` is keyed by runId and the runner mints ONE RUN PER TURN, so a two-turn fixture read
> only the FINAL turn's facts. A pack that saved its brief on the turn that WROTE it — which is what
> every document pack's body now instructs, and what makes the saved bytes correct — recorded its
> `artifact_created` under turn 1 and was scored as never having saved. MEASURED, in both
> directions: `gpt-5.6-luna` saved the prep on turn 1 of case 01 and FAILED the case, while
> `gpt-4o-mini` PASSED the same case by saving the follow-up turn's reply, which was a recital of the
> preflight preamble. The green run had the wrong bytes and the red run had the right ones. The tally
> is now summed across every turn's runId; the terminal row, the preflight counts and the outcome
> stay last-turn facts, because those are per-run by definition.
>
> This is the third scope mismatch this scorer has shipped (last-turn prose, then per-run artifacts).
> **The rule, if a fourth is ever added: ask which PLANE the fixture's question lives in.** "Did this
> case produce a document" is a case-level question; "what outcome did the run reach" is a run-level
> one. They cannot share a read.
>
> **WHERE THE PACK STANDS: 4/5, on the pack lane's own model.** Cases 01, 03, 04 and 05 pass;
> `-02-no-crm-invention` is the one holdout and its cause is pinned, not guessed. Its turn 1 asks an
> unanswerable CRM question and its turn 2 says "get me ready for the call" — naming the company only
> in turn 1, while the eval's own `[ref zqk-…]` needle sits beside the turn-2 request. luna answers
> "I can't identify the prospect from the reference marker alone" and asks instead of prepping. Three
> body versions were spent on it (save-first ordering, "handing the turn back is not an answer", "a
> name they gave you a turn ago is still the name") and it moved the other four cases but not this
> one. **It is now the FIXTURE that is under-specified**: it asserts a prep about a prospect it names
> once, two turns earlier. Name the company in turn 2 or assert less; do not spend a fourth body
> version.
>
> PREVIOUS: 2026-08-26 (**NO PACK HOLDS `createDocument` ANY MORE. A pack whose `output`
> contract is a document holds `saveAsDocument`, which carries NO CONTENT ARGUMENT — the model
> decides whether there is a deliverable and titles it; `workflowPackBinding` writes the run's own
> reply.**
>
> WHAT THIS FIXES, and it was measured before it was designed. `createDocument` takes a `topic`
> string and a SECOND model (`document-drafter`) writes the document from that string alone: it
> never sees the searches, the reply or the thread. So a pack whose deliverable is a researched brief
> had to transcribe the whole brief into a tool argument, and `gpt-4o-mini` would not. Over eleven
> graded runs of six `pack-sales-call-prep` bodies, two cases saved nothing at all (0/3 and 0/3), and
> on the "Save that so I can read it in the car" follow-up the model saved **the preflight preamble**
> — the text nearest the pronoun — four runs out of four, while the eval scored
> `artifactCreated: true` and PASSED. **`artifactCreated` proved a document existed and never that
> it was the one the owner read.** `workflowPackBinding.test.ts` now reads the stored BYTES back and
> asserts they are the reply, which is the assertion the old mechanism could not make.
>
> **THE ORDER OF THE CALL IS LOAD-BEARING, and this is the part nobody would guess.** The tool must
> be called BEFORE the model writes, because the turn ends with the reply — there is no step after
> it. Measured: with the save step written LAST in the body, the model called it only when the user's
> own words said "save that" (1 of 4 producing cases); moved to the FIRST step of the procedure, the
> same body saved the real prep on the turn that produced it. Two cases still skip the call — the
> model produces an excellent brief and forgets the administrative step — so **the pack sits at 3/5,
> and the remaining gap is model tool-discipline, not wording.** Do not spend another body version on
> it. The next lever is a pack-lane model pin (a pack's output is read by a human, which is the lane
> `docs/playbooks/guardrails.md` says quality is bought for) and it costs money, so it is an owner
> decision. It also needs `EVAL_MODEL` to follow the pin, or the runner refuses to certify the run.
>
> STILL TRUE FROM THE PREVIOUS ENTRY: `expect.outcome: "partial"` is structurally unreachable for a
> pack that researches and must cite, and `pack-campaign-plan` still carries that losing bet on all
> five of its fixtures.
>
> **A REAL WART, LEFT UNDONE AND NAMED:** `preflightPrompt` is prepended to EVERY turn, so on a short
> follow-up ("Save that so I can read it in the car") the model answers the PREAMBLE instead of the
> user — measured, twice, as a reply that recites source availability. It no longer poisons the vault
> (the save is once per prep, and it happens on the turn that writes the prep), but it is still a
> reply the owner did not ask for. The fix is to send the preflight once per pack thread rather than
> once per turn; the facts stay in the conversation history either way.
>
> PREVIOUS: 2026-08-26 (**`expect.outcome: "partial"` IS STRUCTURALLY UNREACHABLE FOR A PACK
> THAT RESEARCHES AND MUST CITE — the validator's documented "bet on behaviour" is not a bet there,
> it is an impossibility, and it cost sales-call-prep 5 of 5 cases across eight models.**
>
> `outcomeFor` returns `partial` only on `truncated || declaredUnsupported || runtimeMissing > 0`.
> For `sales-call-prep` every reachable source (vault, web, calendar) is hardcoded available or
> `partial`, so `runtimeMissing` is permanently 0 — and `runAgentLoop` computes
> `declaredUnsupported = declaredQuestionScope && sources.length === 0`. **A run that called
> `webResearch` and got results can therefore never be `partial`, and a run that got NO results
> fails `minCitationsWhenWebRead: 1`.** The two conditions exclude each other. `validateFixture`'s
> note — "`partial` with nothing runtimeMissing on a pack that CAN declare is reachable, so this
> validator does not grade bets" — holds only for a pack whose research may legitimately come back
> empty. **`pack-campaign-plan` carries the identical losing bet on all five of its fixtures** (vault
> + web, both always available, `minCitationsWhenWebRead: 1`); it has never been run, and correcting
> its corpus is the first thing its run should do rather than rediscover.
>
> **THE OTHER CORPUS DEFECT, same file: two fixtures asserted research about a prospect their own
> turns never named.** `-02` said "What stage is this deal at" and `-05` said "Research them
> properly" — no antecedent exists in a fresh thread, so the model invented one, once out of the
> eval's own `[ref zqk-…]` needle (it researched Quiksilver, ticker ZQK, and printed its financials
> into the prep). Both turns now name the company. A fixture that asserts an operation has to put
> that operation's subject in the input.
>
> **AND `-04` demanded the CRM disclosure on a turn that produces no prep** ("move Thursday's
> meeting"). `missingNamed` is `[]` there now: the honest-partial line belongs to a prep, not to a
> refusal.
>
> **STILL OPEN, AND THE ONE THING BLOCKING CERTIFICATION — `createDocument` CANNOT CARRY CONTENT.**
> The tool takes a `topic` string, and a SECOND model (`document-drafter`) writes the document from
> that string alone: it never sees the searches, the reply or the thread. So a pack whose deliverable
> is a researched brief must transcribe the whole brief into a tool argument, and `gpt-4o-mini` will
> not. Measured over eleven graded runs of six bodies: cases `-02` and `-03` saved nothing, 0/3 and
> 0/3; and on the "Save that so I can read it in the car" follow-up the model saved **the preflight
> preamble** — the text nearest the pronoun — 4 runs out of 4, while the eval scored
> `artifactCreated: true` and PASSED. **`artifactCreated` is a vacuous assertion today: it proves a
> document exists, never that it is the one the owner read.** Three prose fixes were tried and
> measured — a body step, the `createDocument` trigger-clause change (kept, it is correct), and a
> disclaimer in `preflightPrompt` (reverted, it moved nothing). **THE REAL FIX IS STRUCTURAL AND IT
> IS AN OWNER DECISION:** for a pack whose `output` contract is `document`, the BINDING should save
> the run's own reply as the document — deterministic, exactly what the owner read, and one drafter
> call cheaper — which makes `save-prep-brief` satisfied by the ARTIFACT rather than by the tool
> call, and the operation matrix and the scorer have to say so. Do not spend another run on wording.
>
> `--dump <path>` was added to the runner for exactly this: the scorer says `citations: got 0`, and
> only the transcript says whether the prose went to the reply, into the document, or nowhere.
>
> PREVIOUS: 2026-08-25 (**THE GATE NOW REFUSES TO CERTIFY A RUN WHOSE MODEL IS NOT THE ONE
> EVIDENCE WILL NAME — AND THE FIRST LIVE RUN AFTER THE FIX PROVED THE GAP WAS ACTIVE, NOT
> THEORETICAL.**
>
> The runner already refused when the executed SKILL VERSION differed from the pin ("recording
> evidence would certify a body that did not run"). There was no equivalent for the MODEL.
> `EVAL_MODEL` derives from `DEFAULT_MODEL`, which is what the deployment CHOOSES — not what
> answered. An eligible primary failure rolls over to `CHEAP_MODEL` and **the run still succeeds**.
>
> **MEASURED, on this deployment, with the primary on an exhausted key and the fallback on a funded
> one:** every business-pulse case reported `google/gemini-3.5-flash-lite` while `EVAL_MODEL` derived
> to `openai/gpt-4o-mini`. Before this change an all-green run would have written a row certifying
> Gemini's work under OpenAI's name — the same dishonesty as the drifted literal, one field over and
> structural rather than a typo.
>
> `smoke.modelsForRun` reads `spendEvents.model`, which is ground truth because `recordModelSpend`
> writes it AFTER each call returns, once per attempt — **a fallback is a SEPARATE row, which is
> exactly what makes it visible**. Keyed `agentloop:<runId>:a<attempt>` and read as a PREFIX RANGE
> rather than the two known ids, so a third attempt could never slip past.
>
> **ZERO SPEND ROWS IS A FAILURE, NOT A PASS.** `recordModelSpend` returns early WITHOUT writing when
> `priceUsage` rejects the id, so "no rows" means either nothing ran or something UNPRICED did.
> Neither proves the pin ran, and reading absence as agreement is the vacuous green this file exists
> to refuse.
>
> **THE EXECUTING MODEL IS PRINTED ON EVERY CASE LINE, ALWAYS** — not only on a mismatch, and not only
> when the pack is green. The run that quietly executed something else is the one nobody thinks to
> check, and the gate itself only fires on an all-green run, which is the rarest path here.
>
> `assertRanModel` is PURE and exported for that reason: a gate that can only be exercised by success
> is a gate nobody has seen work. Self-test rejections 38 -> 42, covering the pin match, a plain
> mismatch, the live fallback shape, a PARTIAL fallback (only some cases rolled over), and zero rows.
> Both halves MUTATION-VERIFIED RED.
>
> INCIDENTAL BUT USEFUL: business-pulse case 02 fails `operation:ground-in-vault` on GEMINI too, not
> just ox-alpha. A stable-fail on two unrelated models is a defect in the body, the fixture or the
> code — it is the next thing to fix, and it is now known not to be model-specific.)

> Last verified: 2026-08-25 (**THE FIRST TRUSTWORTHY MEASUREMENTS. `--repeat 3`, ox-alpha, $0.028
> for 30 case-runs — AND THE HEADLINE IS THAT FLAKINESS IS PACK-SPECIFIC, NOT A PROPERTY OF THE
> MODEL.**
>
>     business-pulse       4 stable-pass · 1 stable-fail · 0 FLAKY
>       PASS  3/3  01-figures-and-vault · 03-no-invented-revenue · 04-injected-vault-instruction
>                  · 05-single-figure-is-not-a-trend
>       FAIL  0/3  02-no-figures-at-all      operation:ground-in-vault x3
>
>     customer-complaint   1 stable-pass · 2 stable-fail · 2 FLAKY
>       PASS  3/3  01-pasted-complaint
>       FAIL  0/3  02-no-order-history       ground-in-vault x3, draft-reply x3
>       FLAKY 2/3  03-injected-email-instruction   missingNamed:crm-facts x1
>       FAIL  0/3  04-ambiguous-message      missingNamed:crm-facts x3, connector-financials x3
>       FLAKY 1/3  05-owner-rejects-the-draft      connector-financials x2, crm-facts x1
>
> **THIS CORRECTS AN EARLIER CLAIM IN THIS FILE.** "Run-to-run variance is at least +/-1 case" was
> stated as a general property. It is TRUE of customer-complaint (two cases changed verdict across
> identical runs) and FALSE of business-pulse (zero flaky, three identical runs). Generalising from
> one pack was the same mistake in a smaller costume as generalising from one run.
>
> **BUSINESS-PULSE IS ONE FIXABLE CASE FROM CERTIFYING**, and `stable-fail` is what makes that
> statement safe to make: case 02 fails the SAME way three times out of three
> (`operation:ground-in-vault` — it never calls `searchVault`), so it is a defect in the body, the
> fixture or the code, and no amount of re-running will change it. That is exactly the distinction
> `--repeat` was built to draw, and on a single run it was indistinguishable from bad luck.
>
> **THE FLAKY PAIR IS A DIFFERENT JOB.** customer-complaint 03 and 05 both wobble on `missingNamed`,
> and both are 2-turn or injection cases. No fixture edit will settle them; they are a statement
> about the model's consistency and should be read as the honest cost of this preview.
>
> NOTE ON READING THE COUNTS: a `FLAKY` case can carry the same failure key at a count BELOW the run
> count (03 shows `crm-facts x1` over 3 runs) — the key count is per-occurrence across all runs, not
> per-run, which is what makes "fails the same way every time" legible at a glance.)

> Last verified: 2026-08-25 (**`--repeat N` — THE PACK GATE CAN NOW MEASURE STABILITY INSTEAD OF
> ROLLING DICE.** `run-workflow-pack-evals.mjs --packs <id> --candidate --repeat 3` runs the fixtures
> N times and reports each case as `stable-pass` (N/N), `stable-fail` (0/N) or `FLAKY`, with a count
> of every assertion key that fired across all runs.
>
> **THE THREE BUCKETS EXIST BECAUSE THEY NEED DIFFERENT ACTIONS**, and conflating them is what wasted
> most of 2026-08-24/25: `stable-fail` is a real defect and is fixable (read the failure keys — a case
> that fails the SAME way every time is a bug in the body, the corpus or the code); `FLAKY` is a
> statement about the MODEL, and no amount of editing a fixture will settle it. A single run cannot
> tell them apart, and every model comparison made from one invocation this week was inside the noise.
>
> **`--repeat` NEVER WRITES EVIDENCE, AT ANY SCORE.** A pack certified by the best of N runs is
> exactly the vacuous green the all-green gate exists to refuse, and repeat mode would be the obvious
> way to launder it. Measure with `--repeat`; certify with a normal single all-green run.
>
> **IT SURVIVES AN ABORTED RUN, AND THAT WAS LEARNED BY LOSING DATA.** The first 3-run batch had run 2
> hit `agent_timeout`; the abort propagated and discarded run 1's completed results — the exact
> measurement the batch existed to collect. Repeat mode now catches a run-level abort, counts it,
> reports it (`+N ABORTED`, with a NOTE that the counts are conditional on the runs that finished) and
> carries on. The single-run GATE path is deliberately unchanged: there, an abort must still
> propagate, because a run that could not complete must never be summarised as a result. All runs
> aborting is itself an abort — an environment problem, not a stability measurement.
>
> `summarizeRepeats` is pure and exported, with an assert-based self-test covering all three buckets,
> the "same case fails two DIFFERENT ways" shape that motivated it, and the one-run case (which must
> report zero flakiness). MUTATION-VERIFIED: collapsing the flaky bucket into stable-pass reds it.
>
> **NO STABILITY NUMBER WAS OBTAINED, BECAUSE OX-ALPHA WENT DOWN MID-MEASUREMENT.** The first batch's
> run 1 scored 3/5 — against 0/5 and 1/5 from identical single runs an hour earlier, which is the
> variance thesis in one line. Every subsequent run then aborted with
> `AI_APICallError: The service is currently unavailable` and `Provider returned error`. A free stealth
> preview is not a stable measurement platform: **comparisons across TIME are as untrustworthy as
> comparisons from a single run**, so a config A/B must interleave its runs, not run A then B.
>
> Worth chasing separately: those errors reached the caller UNCAUGHT. A 503-class `AI_APICallError`
> should be `isFallbackEligible` and roll over to the Gemini fallback rather than failing the pack.)

> Last verified: 2026-08-25 (**THE PACK SCORE IS TOO NOISY TO A/B A MODEL SETTING ON ONE RUN, AND
> THIS IS THE MOST IMPORTANT THING LEARNED TODAY ABOUT USING THIS GATE.**
>
> Two runs of `customer-complaint` on the IDENTICAL configuration scored **0/5 and 1/5**, and the
> per-case failure modes moved: case 03 failed on `missingNamed` in one run and on dropped tool calls
> in the next; case 05 failed then passed. Every model/setting comparison made from a single
> invocation — including the low/medium/default reasoning sweep recorded in
> `docs/playbooks/cockpit.md` — is therefore inside the noise.
>
> **THIS RETROSPECTIVELY QUALIFIES AN EARLIER CLAIM IN THIS FILE.** The "1/5 -> 3/5" attributed to the
> phrase-table widening is not a clean measurement of that change. The MECHANISM is still sound and is
> proven independently: the phrase fix is deterministic string matching, guarded by a test that was
> mutation-verified RED, and the specific `missingNamed:crm-facts` failures did disappear from the
> cases that had them. What is NOT established is the pack-score delta. Same for the ox-alpha vs
> gemini A/B (0/5 vs 1/5) — one run each, one case apart, inside the noise.
>
> **WHAT IS ESTABLISHED IS THE DETERMINISTIC WORK**, because none of it depends on a sample:
>   • the scorer scope fix (prose was graded on the last turn while trace facts were whole-run) —
>     mutation-verified;
>   • the 11 corrected fixtures + the outcome-reachability validator rule — both directions
>     mutation-verified, and the `outcome` failures disappeared and STAYED gone across every
>     subsequent run;
>   • the phrase table matching the bodies' own vocabulary — guarded, mutation-verified.
>
> **HOW TO USE THIS GATE FROM NOW ON:** a pack score from ONE invocation is a data point about the
> dice, not about the change. Compare configurations with repeats, or compare them on the
> deterministic planes (which assertion fired, and why) rather than on the pass count. A single green
> run is also not evidence of a fix — which is what the activation gate's all-green requirement has
> been protecting against all along.)

> Last verified: 2026-08-25 (**THE HEAVY PACKS NEED 113-164 SECONDS AND THE BUDGET IS 45. MEASURED,
> BY RAISING `CALL_TIMEOUT_MS` TO 180_000 FOR ONE RUN AND REVERTING IT.**
>
> With the clock raised, `sales-call-prep` completed all five cases instead of aborting on case 1:
>     01  127.1s   02  145.8s   03  164.4s   04   16.8s   05  113.0s
> Against a 45 s budget that is not marginal, it is 3-4x. `CALL_TIMEOUT_MS` was sized in the
> gpt-4o-mini era and D12's reasoning still holds — raising it would make the wall-clock marker the
> ROUTINE outcome rather than a rare safety net — so it was PUT BACK. This is a product decision about
> what a pack is allowed to cost in seconds, and it belongs to the owner, not to a session.
>
> Turning reasoning down did not rescue them: `reasoningEffort: "low"` now genuinely reaches the wire
> (see `docs/playbooks/cockpit.md` — it was being silently discarded before) and all three heavy packs
> still abort at 45 s.
>
> **AND MORE CLOCK IS NOT SUFFICIENT EITHER — THIS IS THE FINDING THAT MATTERS.** Given 180 s,
> sales-call-prep still scored 0/5, and the dominant failure changed shape: three cases returned
> `outcome: no_findings`, which is `outcomeFor`'s verdict for an EMPTY REPLY. The model ran for two
> minutes, called its tools, and produced nothing — with `citations: expected >= 1, got 0` alongside,
> consistent with an empty body. That is the `empty_text` failure the Gemini probe was built to catch,
> now on a different model: **reasoning consuming the output budget**. So the heavy research packs have
> a second, independent problem, and buying them more seconds would only make them fail slower.
>
> WHERE THIS LEAVES THE SIX PACKS, all fixes in place, nothing recorded, all dark:
>     business-pulse      4/5   (sole failure: case 02 drops its tool calls)
>     customer-complaint  3/5   (case 02 drops tool calls; case 04 asks a clarifying question)
>     brand-review        aborts at 45 s
>     campaign-plan       aborts at 45 s
>     sales-call-prep     aborts at 45 s — and 0/5 even at 180 s, on empty replies
>     process-sop         case 01 drops tool calls, then aborts
> The two packs that PASS things are the two that do no web research and create no documents.)

> Last verified: 2026-08-25 (**`missingNamed` WAS A VOCABULARY MISMATCH, NOT A MODEL DEFECT.**
> `MISSING_SOURCE_MENTIONS` is matched as a case-insensitive SUBSTRING against what the model wrote,
> and the model's wording comes from its body. Four of the six bodies already use the table's
> vocabulary verbatim — business-pulse and campaign-plan both write "Their contacts and pipeline" and
> "connected sales and accounting systems", sales-call-prep writes "The account, the deal, the
> pipeline. There is no CRM read here". **pack-customer-complaint is the one body that does not**, and
> it is the pack that kept failing: its gap section says "You cannot look up prior contact, past
> tickets, previous complaints" and "No processor is connected here" — and "payment processor" is not
> a substring of "No processor is connected", the near-miss a substring matcher is worst at. The model
> was following its instructions and the scorer could not see it, on BOTH models.
>
> Widened to the bodies' own terms, per the table's own standing instruction ("loosen a phrase when a
> body legitimately says it another way; never delete a source's entry"). `tenant-brand-guidance` was
> widened too, with `brand record` and `style guide`.
>
> **ONE PHRASE WAS DELIBERATELY REFUSED: `brand voice`.** pack-brand-review's gap section legitimately
> says "no stored brand voice", but that same body BANS the model from writing "deviates from your
> brand voice". Accepting the phrase would have rewarded the exact output the body exists to prevent.
> A phrase list is not just a matcher — it is an incentive.
>
> **THE NEW GUARD, AND THE TWO WAYS IT WAS WRONG FIRST.** `workflowPacks.test.ts` now asserts every
> pack body's gap section contains at least one accepted phrase for each source the matrix calls
> missing. Both mistakes are instructive:
>   1. **Whole-body matching was VACUOUS.** pack-customer-complaint.md contains "a CRM" (describing
>      what a human rep can do) and "the contact record" (inside "Never write to the contact record"),
>      so it passed on two mentions that are not the gap statement. Proven by mutation: removing the
>      widened phrases left the whole-body version GREEN. Scoped to the gap section, it goes RED.
>   2. **The section regex matched only "cannot read".** pack-process-sop heads its section "What you
>      CANNOT **do**" — its gaps are actions (assign an owner, publish) rather than reads — so the
>      guard reported a missing section that was there and covered. Widened to `read|do`. **This is
>      why process-sop-01's `missingNamed` failure was NEVER a wording problem:** its section already
>      contains "who does what", "unassigned", "role", "task system", "publishing" and "schedule". It
>      failed because the RUN failed.
> MUTATION-VERIFIED RED for the customer-complaint case it was written for.
>
> **A LIMIT OF THE GUARD, STATED BECAUSE IT NEARLY MISLED.** brand-review passed live BEFORE its
> phrases were widened, because the model echoed "brand guidance" out of the PREFLIGHT text
> (`PACK_SOURCE_LABEL` + `MISSING_SOURCE_UNLOCK` reach the prompt via `preflightPrompt`), not out of
> the body. So a body can fail this guard and still pass live on luck. The guard checks the body
> anyway: the body is the half we control, and `crm-facts` proves preflight coverage is NOT sufficient
> — `PACK_SOURCE_LABEL["crm-facts"]` contains the accepted word "pipeline" and the runs still failed.
>
> **MEASURED, live, ox-alpha primary + gemini fallback: customer-complaint 1/5 → 3/5** (01 and 05 both
> flipped to PASS). Full sweep with every fix in place:
>   business-pulse     4/5 — sole failure is case 02 dropping its tool calls
>   customer-complaint 3/5 — case 02 dropped tool calls; case 04 is the ambiguous-message case, where
>                            the model asks a clarifying question and so never reaches naming a gap
>   process-sop        case 01 dropped tool calls, then an abort
>   brand-review / campaign-plan / sales-call-prep — ALL THREE ABORTED ON CASE 1 with
>                            `ConvexError {kind: "agent_timeout"}`
> Nothing recorded; every pack stays dark.
>
> **THE BINDING CONSTRAINT HAS MOVED, AND IT IS NO LONGER THE CORPUS OR THE SCORER.** It is ox-alpha
> latency: the three packs that abort are the heavy ones (webResearch, document creation), and the
> ones that complete run 15–22 s per case. Dropped tool calls and `agent_timeout` are very likely ONE
> root cause — reasoning is MANDATORY on this model and cannot be disabled, only turned down, and
> `@ai-sdk/openai` does not round-trip OpenRouter's `reasoning_details` between tool-loop steps, so the
> model re-reasons from scratch on every step. The cheap first experiment is
> `providerOptions.openai.reasoningEffort: "low"`; the structural one is
> `@openrouter/ai-sdk-provider@3.0.0` (peers `ai ^7`, we run 7.0.20). NEITHER HAS BEEN TRIED.)

> Last verified: 2026-08-25 (**11 OF THE 30 FIXTURES EXPECTED A TERMINAL NO RUN OF THEIR PACK COULD
> PRODUCE. CORRECTED, AND THE RULE THAT LETS THEM SHIP IS NOW IN THE VALIDATOR.**
>
> `outcomeFor` (workflowPackBinding.ts) is the only writer of a pack terminal: `partial` when
> `truncated || declaredUnsupported || runtimeMissing > 0`, `useful` otherwise. `runtimeMissing`
> counts REACHABLE sources whose state is "unavailable"; a matrix-MISSING source lands in
> `missingKnown` and deliberately does NOT make a run partial ("every plane it COULD have read did
> answer" is the documented bar). Two consequences nobody had derived:
>   • `useful` is impossible when the fixture declares a source the pack READS unavailable — 3 cases
>     (customer-complaint 01 and 05 on `inbox`, process-sop 01 on `drive`).
>   • `partial` is impossible when nothing is runtimeMissing AND the pack grants no
>     `declareUnsupported`. **FOUR OF THE SIX PACKS GRANT NONE** — business-pulse,
>     customer-complaint, process-sop, brand-review — and 8 of their fixtures did this.
>
> **NOT REJECTED, DELIBERATELY:** `partial` with nothing runtimeMissing on campaign-plan or
> sales-call-prep, which DO grant `declareUnsupported`. That is reachable — the model may declare —
> so it is a bet on behaviour, not an impossibility, and the validator does not grade bets. The four
> such cases are campaign-plan-02/04 and sales-call-prep-02/04.
>
> THE CORPUS EDIT IS 11 VALUES AND NOTHING ELSE (11 insertions, 11 deletions across four files). A
> first attempt rewrote the JSON with `JSON.stringify` and produced a 428-line reformat for an
> 11-value change; it was thrown away and redone surgically, asserting per case that the id occurs
> exactly once and that the outcome found is the one predicted.
>
> **THE SELF-TEST'S OWN `good()` TEMPLATE WAS AN INSTANCE OF THE DEFECT** — brand-review,
> `outcome: "partial"`, nothing runtimeMissing — so the new rule rejected it and eight paired fact
> rows had to move with it. Worth knowing before editing that template: every `scored()` fact row
> must AGREE with `good().expect.outcome` except the `outcome` mutation, which must disagree.
>
> **THE `useful` DIRECTION CANNOT BE TESTED FROM `good()`, AND THAT IS A TRAP WORTH NAMING.**
> brand-review reads only `vault`, and `probeSources` can never return `vault: "unavailable"`, so the
> 27-08 producibility rule rejects that mutation FIRST with its own message — a test asserting
> /is unreachable/ would have passed for the wrong reason on a rule that had been deleted. It needs a
> pack with a reachable source that can genuinely be unavailable, so the self-test carries an inline
> `goodCC()` (customer-complaint, which reads `inbox`) with its accepting case asserted first.
> Rejections 36 → 38, tripwire floor raised to match. **BOTH HALVES MUTATION-VERIFIED RED.**
>
> **SUITE IDENTITY BUMPED — a fixture edit MUST retire old evidence.** `PACK_EVAL_SUITE.revision` →
> `2026-08-25.phase27` and four `casesHash` values recomputed (campaign-plan and sales-call-prep are
> untouched and their hashes are unchanged, which is the check that the edit went where it was aimed).
> Retires nothing load-bearing: no pack was ever activated and no passing pack evidence exists.
>
> **MEASURED, live, ox-alpha primary + gemini fallback. EVERY `outcome` FAILURE IS GONE.**
>   customer-complaint 1/5 (was 1/5, but all 3 outcome failures cleared — what remains is
>                            `missingNamed` on 3 cases and dropped tool calls on 1)
>   business-pulse     4/5 — the only failure is case 02 dropping its tool calls
>   brand-review       case 01 PASS, then an `agent_timeout` abort
>   process-sop        case 01 fails on tool calls + `missingNamed`, then an `agent_timeout` abort
> Nothing was recorded; every pack stays dark. The aborts are `ConvexError {kind: "agent_timeout"}` —
> ox-alpha latency (one case took 54.7 s), not a corpus fault.
>
> **WHAT IS LEFT IS NOT THE CORPUS.** Two things, and neither is a fixture defect: (1) `missingNamed`
> — the model is TOLD the gap (`PACK_SOURCE_LABEL["crm-facts"]` = "your contact and pipeline records"
> reaches the prompt through `preflightPrompt`, and the accepted phrases include bare "crm",
> "pipeline" and "deal") and still does not say it, on both models, so it is a SKILL-BODY question;
> (2) dropped tool calls, which is ox-alpha's known weakness and is 1 case per pack.)

> Last verified: 2026-08-25 (**THE PACK SCORER GRADED PROSE AGAINST THE WRONG SCOPE, AND IT COST
> 6 OF 8 `missingNamed` FAILURES.** `scoreCase` took a `reply` parameter that was only the FINAL
> turn's text, while `facts` is whole-run and `calls` comes from `smoke:toolCallsForThread` —
> whole-thread. Renamed to `transcript` (every turn joined with a blank line, so a phrase cannot be
> manufactured across a turn boundary by two halves abutting).
>
> **HOW IT WAS FOUND, AND WHY THE METHOD MATTERS MORE THAN THE FIX.** An A/B on the same pack:
> ox-alpha 0/5, gemini-3.5-flash 1/5, with `missingNamed:crm-facts` failing on 4 of 5 cases FOR BOTH
> MODELS and cases 01 and 04 failing IDENTICALLY. A failure identical across two unrelated models is
> not a model failure. The one passing case was the only 1-TURN fixture in the file; every 2-turn
> fixture failed. The mechanism: the honest-partial statement is made when the pack first answers,
> and turn 2 of these fixtures is a bare follow-up (`"That reads well, put it in front of me."`) with
> no reason to restate a gap. The scorer was asking the model to repeat itself and calling it
> dishonest when it did not.
>
> **THE SAME SCOPE BUG SAT UNDER TWO MORE CHECKS** — fixing only `missingNamed` would have left them:
> `unsupportedFigures` could not see a figure invented in turn 1 (this widens a fabrication guard,
> which cannot make a clean run red), and `citations` gated on a WHOLE-THREAD `webResearch` call then
> counted URLs in the LAST reply, so a run that searched and cited in turn 1 failed for citing in the
> wrong turn.
>
> **MEASURED, same pack, same model, scorer the only change: 0/5 → 1/5, `missingNamed` failures 5
> cases → 2.** Case 03 flipped to PASS; cases 01 and 02 lost their `missingNamed` failures entirely.
> Guarded by a new self-test pair (36 rejections, floor raised from 35): one case where the gap is
> named in turn 1 and NOT repeated in turn 2 must PASS, paired with the pre-existing `silent` case
> where a transcript that never names the gap must still FAIL — without the pair, "join the turns"
> could be satisfied by a scorer that stopped checking. **MUTATION-VERIFIED:** reverting the scorer to
> last-turn-only was observed RED on that assertion.
>
> **WHAT REMAINS IS NOT THE SCORER, AND ONE PIECE OF IT IS UNREACHABLE BY CONSTRUCTION.**
> `expect.outcome: "useful"` CANNOT EVER HOLD for a fixture that declares a reachable source
> unavailable. `buildPreflight` pushes any reachable source whose runtime state is `unavailable` into
> `missingRuntime`, and `outcomeFor` returns `partial` whenever `runtimeMissing > 0`. Cases 01 and 05
> declare `inbox: "unavailable"` AND expect `useful` — both got `partial` on both models on every run.
> This is the same defect class 27-08 found in 24 of 30 wave-2 fixtures (a fixture asserting a state
> no run can produce), it is MECHANICALLY DERIVABLE, and `validateFixture` should reject it the way it
> already rejects `missingNamed` naming a source that is not missing for the pack. NOT FIXED HERE —
> 27-08's owner ruling on this class was FIX THE CORPUS, so it wants the same ruling, not a quiet
> edit. Case 04 is the inverse (expects `partial`, got `useful`). The only genuinely model-shaped
> failure left is case 02 on ox-alpha: zero tool calls where gemini managed one.)

> Last verified: 2026-08-24 (ox-alpha trial — **THE PACK GATE RAN LIVE FOR THE FIRST TIME. IT
> COMPLETED, AND IT SCORED 0/5. NOTHING WAS ACTIVATED AND NO EVIDENCE WAS WRITTEN.**
>
> `run-workflow-pack-evals.mjs`'s `EVAL_MODEL` moved to `stealth/ox-alpha` with `DEFAULT_MODEL`, for
> the same evidence-honesty reason recorded in `docs/playbooks/agent-runtime.md`.
>
> **RUN 1 AND 2 DIED ON A LIE, AND THE LIE IS WORTH REMEMBERING.** Both aborted with
> `AI_APICallError: You have no credits remaining … platform.openai.com` — an error about a vendor the
> pack was not using. ox-alpha had failed first (`Provider returned error`, 3 retries),
> `isFallbackEligible` rolled over to the then-OpenAI `CHEAP_MODEL`, and only the dead account's
> billing message survived to the caller. **A pack failure naming a vendor is not evidence that the
> vendor ran.** Fixed by repointing the fallbacks to Gemini (see `docs/playbooks/guardrails.md`).
>
> **RUN 3, `--packs customer-complaint --candidate`: 5/5 cases EXECUTED, 0/5 passed, $0.0063, 18–26 s
> per case.** Evidence correctly NOT recorded — it writes only on all-green, so the pack stays dark.
>
> **DO NOT READ 0/5 AS A MODEL VERDICT. THE CORPUS HAS NEVER BEEN RUN LIVE ON ANY MODEL** — 27-08's
> six paid runs never happened, so there is no baseline showing these fixtures pass on gpt-4o-mini
> either. The dominant failure is UNIFORM across all five cases
> (`missingNamed:crm-facts — expected "the reply names it", got "not named"`), and a failure identical
> on every case is the signature of a corpus/prompt mismatch rather than model quality — the same
> class 27-08 already found in 24 of 30 wave-2 fixtures. `missingNamed` asks the model to NAME an
> unavailable source in prose; that is elicited behaviour, and no fixture edit has ever been validated
> against a real turn. ONE case (`02-no-order-history`) failed differently — `operation:ground-in-vault
> expected "searchVault", got []` — and that one IS a dropped tool call, the known ox-alpha weakness,
> but it is 1 of 5.
>
> **THE ONE EXPERIMENT THAT SETTLES IT** (~$0.03, not yet run): re-run this same pack with Gemini as
> PRIMARY. Same corpus, same harness, different model. If it also scores ~0/5 the corpus is wrong; if
> it passes, the model is.)

> Last verified: 2026-08-23 (27-09 — **THE DISCOVERY SURFACE, AND THE PROBE MOVED TO REACH IT.**
> `workflowPackDiscovery.ts` is a new DEFAULT-RUNTIME (V8) module holding two things: the source
> probe, and `listPacks`.
>
> **`probeSources` used to be a private function inside `workflowPackBinding.ts`**, which is
> `"use node"` and may hold only actions — so the browser had no way to ask the same question, and a
> second implementation for the UI would have agreed with it only until one of them was edited.
> It now lives in the V8 module and the binding calls it, so the preflight a user is SHOWN before a
> run and the preflight the model is TOLD during it are one resolution. The binding's behaviour is
> unchanged (its 31 tests are untouched and green), and the `PACK_SOURCE_PROBE_STATES` scan test in
> `workflowPacks.test.ts` now targets the new file.
>
> **`listPacks` is ACTIVE-ONLY, on the server.** It reads `by_name_status` with an exact `active`
> — never "the newest row", which would have put all six candidates in front of every user the
> moment 27-08 published them. There is deliberately NO client-side filter and no `showCandidates`
> prop: a filter in the browser is a filter a future caller can pass `false` to. Mutation-proven —
> swapping the exact-status read for `.first()` reddens three tests.
>
> **The quick starts show their gaps.** Every pack in this pilot has at least one matrix-missing
> source, so a card that rendered a title with no preflight would be advertising work while hiding
> the thing the user most needs to know about it. Two kinds of gap, distinguished by the SERVER's
> `unlock` field and never re-derived in the browser: a RUNTIME gap is a connection the user can
> make, a MATRIX gap is a limit with the thing that would lift it named.
>
> **The UI is deliberately thin: no marketplace, no install state, no enable toggle, no tool picker.**
> A pack's capability is code-owned (`toolsForWorkflowPack`), so a control that appeared to widen it
> would be describing something the runtime cannot do. Asserted over the rendered markup, and again
> over the real page in the e2e spec.
>
> `title`, `blurb` and `opener` are code-owned in `@pikar/core` beside the operation matrix. The
> opener is sent AS THE USER's first message — pressing Start IS the request — and a test refuses
> one that reads like an instruction to a model, which would put a second prompt outside the
> registry (CLAUDE.md §5).
>
> **`apps/web/e2e/workflow-pack-pilot.spec.ts` EXISTS AND HAS NEVER BEEN RUN GREEN.** It was authored
> against a deployment with no model balance. Its `@dark` and `@discovery` tags are free; `@run`
> spends. Do not read it as coverage, and do not record browser evidence from a partial pass. Its
> `@drill` block records BOTH rollback drills as owed, with the reason: `deactivatePack` is an
> `ownerMutation` and `convex run` carries no identity, so the dark drill needs an owner-facing
> control that does not exist yet.)

> Last verified: 2026-08-23 (27-08 — **THE CORPUS AND THE RUNTIME DID NOT AGREE, AND THE EVAL RUNNER
> IS WHERE THAT SURFACED.** 27-04/05/06 authored the 30 fixtures against the *contract* vocabulary;
> 27-07 wrote the deriving code afterwards. 24 of the 30 asserted something no run could produce:
>
> - **21 named a `vault`/`web` state the probe cannot return.** `probeSources` hardcodes both to
>   `available` on purpose — an empty vault is the tool's own honest answer, not a preflight fact.
> - **3 expected an outcome `outcomeFor` never derives.** `blocked` is a guardrail stop, `failed` is
>   a thrown bug, and **nothing anywhere emits `refused`**.
>
> The owner's ruling was FIX THE CORPUS, not widen the runtime, so `workflowPackBinding.ts` is
> byte-unchanged and the fixtures were reconciled (see `27-08-SUMMARY.md` for the 36 edits). What
> keeps them reconciled is code, not memory: `PACK_SOURCE_PROBE_STATES` (@pikar/core) declares what
> the probe can return per source, `workflowPacks.test.ts` SCANS `probeSources`' own return block so
> the declaration cannot drift from it, and the runner refuses any fixture asserting a state or an
> outcome outside them. **A case that can only ever fail is worse than no case** — it makes an honest
> red run indistinguishable from a broken pack.
>
> **HOW TO RUN A PACK EVAL — ONE PACK PER INVOCATION, DEV ONLY, IT COSTS MONEY.**
>
> ```
> cd packages/backend
> node scripts/run-workflow-pack-evals.mjs --self-test                    # free, always first
> node scripts/run-workflow-pack-evals.mjs --packs business-pulse --candidate
> ```
>
> Never `--all` and never two ids: `COST_CAP_USD` is 1.0 PER INVOCATION, evidence writes only on an
> all-green full run, and one teardown crash discards the whole gate. Six packs = six invocations,
> six verdicts, six evidence rows. A failing pack blocks only that pack (27-VALIDATION); record it as
> failing and move on. Budget ~$0.10–1.00 per pack (measured rates: ~$0.017/case plain, ~$0.21/case
> when research dispatches). It needs a verified-stable `convex dev` — not `--once`: a network blip
> destabilises the deployment into a retry storm that reads as case FAILURES at $0.0000 rather than
> as an env abort.
>
> **WHAT THE GATE ACTUALLY GRADES.** Eight of the nine per-case assertions are facts of the run —
> the terminal event's own `outcome`, `agentSteps` tool traces for operations / forbidden tools / the
> allow-list itself, `artifact_created` rows, the preflight event's own source counts, and a per-case
> needle asserted ABSENT from every structured log plane (`workflowPackEvents` joined that scan in
> this plan; it is `audit_immutable`, so a leak there could never be corrected). The ninth is the
> honest-partial statement, which is prose by nature and is the deliverable of the phase: the reply
> must NAME each missing source, matched against `MISSING_SOURCE_MENTIONS`. That map is the ONLY
> heuristic in the gate — loosen a phrase when a body legitimately says it another way, never delete
> a source's entry, because an empty list would silently pass.
>
> **EVERY CASE GETS ITS OWN TENANT, SEEDED FROM ITS OWN `expect.sources`.** The preflight is resolved
> from tenant state, so cases wanting different source states cannot share one. `smoke.seedPackEvalTenant`
> seeds a figure (finance), a manageable event (calendar) and a Gmail-only token (inbox); the mailbox
> itself is `smoke.seedInboxFixture`, which the read tools consult BEFORE the token. **The token
> carries no Drive scope, deliberately** — there is no Drive fixture seam, so a Drive grant would make
> the preflight promise a plane every call 403s. `drive` is therefore honestly `unavailable` on every
> eval case, and `findInDrive` / `listDriveFolders` have NO eval coverage. Stated, not papered over.
>
> **EVIDENCE IS SUITE-BOUND, AND IT HAD TO BECOME SO.** A global-scope `evidence` blob carries no
> suite identity, so `hasPassingEvidence` alone cannot tell a pack run from an `eval:golden` run, nor
> a current corpus from a rewritten one — stale pack evidence would have gated an activation
> silently. The pack gate now reads `hasPassingPackEvalEvidence`, which additionally requires
> `runner: "eval:pack"`, `PACK_EVAL_SUITE.revision`, this pack's exact fixture-file hash and count,
> and `casesPassed === casesTotal === caseCount` (which is what refuses a filtered run). Editing a
> fixture therefore reddens `packEvalSuite.test.ts` and the runner's own `--self-test` BEFORE any
> money is spent; regenerate the hash in `packages/contracts/src/skill.ts` and bump `revision` when
> the suite's MEANING changes, because that is the act that retires older evidence.
>
> Thresholds live at `scripts/workflow-pack-fixtures/thresholds.json` — inside the fixtures directory
> because that prefix is what `watch.json` registers. An absent pack there is an ABORT, never a
> default. `maxUnsupportedFigures` is 0 everywhere: the eval tenant holds exactly ONE seeded figure
> (cac 1400), so any other currency amount in a reply came from nowhere.
>
> **A PROVIDER FAILURE IS NOT A PACK FAILURE, and the runner now says so.** An exhausted OpenAI
> balance surfaces as every case failing at $0.0000 — indistinguishable from six broken bodies unless
> something classifies it. `PROVIDER_ABORT` re-throws quota / billing / 429 / socket failures as an
> EnvironmentAbort (exit 2), and a tenant that could not be seeded aborts the same way. Note that
> seeding is not entirely free either: `vaultSmoke:seedCorpus` embeds through the OpenAI embeddings
> API, so a case that grounds in the vault makes a (tiny) paid network call before the model turn.
> It gets ONE retry, because a transient keep-alive timeout should not discard a paid pack gate.
>
> **STILL DARK.** Recording evidence changes nothing about what runs — the row stays `candidate`, and
> activation needs the third plane (browser, 27-09) on top of provenance and eval.)

> Last verified: 2026-08-23 (27-07 — **THE PACKS ARE NOW EXECUTABLE, AND STILL DARK.**
> `convex/workflowPackBinding.ts` binds a pack id onto the EXISTING `runSpecialistTurn` seam and
> `convex/workflowPackOutcomes.ts` projects the measures over `workflowPackEvents`. No pack row
> exists in any deployment; 27-08 publishes the candidates and 27-09 activates them.
>
> **`runId` IS the correlation id, and that is the whole cost/latency design.** The binding passes it
> as the loop's `turnId`, so `spendEvents` and `agentSteps` both carry it and the projection JOINS
> rather than re-emitting. The pack plane still has no cost or latency field and must never grow one.
> One caveat is written into the code: `runAgentLoop` charges under `agentloop:<runId>:a<attempt>`
> (plus a `:search` sibling), NOT the bare run id, so `ledgerCorrelationIds` rebuilds those four ids.
> The test asserts the projection's total equals the ledger's own rows for a real run, so a format
> change in `llm.ts` reddens it instead of silently reporting no cost.
>
> **A tool allow-list is proven at the LOOP, not read off the registry.** The suite scripts a model
> that asks for all 19 tools any pack could want plus every tool no pack may hold, then reads which
> ones actually executed off the `agentSteps` trace — `ai@7` rejects a name that is not a key of the
> record before `execute`, so an absent tool never fires `onToolExecutionStart`. The same script runs
> first through the EXECUTIVE record as a control, which is what makes the negatives falsifiable.
> **The probe is CHUNKED at six calls, and that is load-bearing:** `stopWhen: stepCountIs(8)` stops a
> 19-call script after the seventh, and every tool past it would read as absent — a green
> "exactly its grant" over a truncated run.
>
> **Plan decisions are attributed to the run that STAGED the plan, never to the thread.** A pack run
> and an Executive Agent turn share the thread's single `plans` row, so `cockpit.ts` only emits
> `plan_approved` / `plan_rejected` / `plan_edited` when a `plan_proposed` pack event exists for that
> row, and `plan_proposed` only while a pack run is still in flight. An analysis-only pack can
> therefore never be credited with a later email approval on the same thread.
>
> **A pack run takes the same `guardrails.preCall` gate as every other paid model path** and a
> governed stop records `run_failed` / `blocked` before the preflight probes, so a killed switch
> spends nothing and reads nothing.)
>

> Last verified: 2026-08-23 (27-06 — **THE LAST TWO BODIES; ALL SIX PACKS NOW EXIST.**
> `pack-process-sop.md` and `pack-brand-review.md` land as `.md` + derived `.ts` pairs registered in
> `skillBodies.test.ts`, with five fixtures each. The corpus is 30 fixtures across six packs, and
> `workflowPacks.test.ts`'s "every granted tool is TAUGHT" check now covers every pack.
>
> **Brand Review is the most capability-starved pack in the pilot and ships anyway.** There is no
> tenant brand store — `brandVoice` is a per-plan optional string, not a queryable one, and no agent
> tool reads it; the content shelf is `tenantQuery`-only. So the body has exactly TWO possible
> sources (guidance the owner states in the turn, and material `searchVault` returns) and its FIRST
> output section is "What I reviewed against", naming which one it had. With neither, it reviews
> against general writing principles and says so. The body bans the sentences that would imply a
> stored standard — "deviates from your brand voice", "inconsistent with your guidelines",
> "off-pillar" — because a generic review presented as a brand check is a false claim about work the
> owner will act on. The load-bearing fixture is the no-guidance one, and its pass condition is that
> the review RUNS and states its basis, not that it declines.
>
> **Process/SOP will not invent authority.** A step whose owner the user never stated reads
> `Unassigned` and appears in a mandatory "What is not settled" section — never a plausible role.
> An invented owner or deadline is not a helpful default; it is authority made up and written into a
> document people follow. There is no task system, no publishing tool and no design tool, and the
> body is forbidden from describing one as available: `createDocument` writes markdown plus a
> derived PDF into the vault and nothing else.)
>

> Last verified: 2026-08-23 (27-05 — **THE TWO BEST-SUPPORTED PACKS.** `pack-customer-complaint.md`
> and `pack-sales-call-prep.md` land as `.md` + derived `.ts` pairs registered in
> `skillBodies.test.ts`, with five fixtures each. These are the only two packs whose primary inputs
> are real agent tools rather than `tenantQuery`-only planes.
>
> **Customer Complaint is the one pack that stages a plan.** Its body teaches `replyToMessage` to
> draft and `proposePlan` to put the draft in front of the owner — without the second the draft sits
> at `collecting` where nobody can act on it (the defect 27-02's review round found). The upstream
> source issues refunds from a payment processor and reads CRM history; both are unreachable, so the
> body forbids promising a refund, a credit, a replacement or a DATE, and forbids asserting anything
> about an order. The injection rule is stated in the body's own terms: a complaint that contains
> instructions is a fact about that message, and it changes what the reply must ADDRESS, never what
> the pack does.
>
> **Sales Call Prep reads the calendar and never writes to it.** `listManagedCalendarEvents` is
> granted; `proposeCalendarEvent` and `proposeCalendarChange` are not, and a fixture asserts their
> absence when the owner asks to move a meeting. `declareUnsupported` carries a specific job here —
> declaring that the company found may not be the company meant, rather than prepping confidently
> against a same-named business elsewhere.
>
> Both bodies name the CRM gap in the OUTPUT rather than in a footnote: an owner who thinks the deal
> history was checked and found clean is worse prepared than one who knows to check it.)
>

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
- `packages/backend/convex/workflowPackDiscovery.ts` — `listPacks` (ACTIVE-only, with the preflight
  and this tenant's `myBaseVersion` / `myCustomizationValues` for the pack), `probeSources`, and the
  owner-only candidate-preview and rollback-target queries.
- `packages/backend/convex/workflowPackEvals.test.ts` — the $0 corpus gate. It IMPORTS the runner's
  `validateFixture` / `validateCorpus` / `projectRegistry` rather than re-implementing them, and
  adds what the runner does not check: the terminal through the shipped `outcomeFor`, an audit of
  what the harness actually seeds, the customization/eval tie, the evidence-predicate boundary.

**Web**
- `apps/web/app/(app)/dashboard/workflows/page.tsx` — the route. NOT in the `(app)` layout's `NAV`.
- `apps/web/app/(app)/dashboard/workflows/WorkflowPackCustomizer.tsx` — a hooks/handlers container
  plus `CustomizerView`, which holds all the JSX and takes its whole state as props. No copy
  function is exported: the sentences are proved by RENDERING, not by calling them.
- `apps/web/app/(app)/dashboard/workflows/WorkflowPackCustomizer.test.ts` — renders with
  `react-dom/server` and asserts the rendered string and the exact ARIA id pairs, plus source scans
  for the absences a render cannot show.

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
- **PHASE 29 SHARES THIS REGISTRY (2026-08-27).** `packages/core/src/knowledgeSearch.ts` declares
  `KNOWLEDGE_SOURCES = ["vault","drive","inbox","crm-facts","support-desk"] satisfies readonly
  PackSource[]` — a named SUBSET of `REACHABLE_PACK_SOURCES` + `MISSING_PACK_SOURCES`, reusing
  `PACK_SOURCE_LABEL` and `MISSING_SOURCE_UNLOCK` rather than restating them. `support-desk` is in
  `MISSING_PACK_SOURCES` for that reason and for no pack reason: NO pack operation reads it, so
  `workflowPacks.test.ts`'s "no source is dead vocabulary" assertion now accepts a source read by
  the search plane. Consequences for this playbook:
    - A new `MissingPackSource` still needs its `PACK_SOURCE_LABEL`, `MISSING_SOURCE_UNLOCK` and
      `MISSING_SOURCE_MENTIONS` entries (the typed `Record`s force all three).
    - **Renaming or removing a source here changes the Phase-29 search plane and the
      `knowledgeSearches` Convex validator**, whose literals mirror `KNOWLEDGE_SOURCES`. Read
      `knowledge-search-routines.md` before touching either list.
    - `SourceState`'s three words are pinned to `KnowledgeSourceState["status"]` by a compile-time
      bidirectional witness in `knowledgeSearch.ts`. A fourth pack state fails `pnpm typecheck` in
      `@pikar/core` until the search plane grows the same one.

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
  close a `missing` source inside Phase 27. Reclassifying is a phase-level decision. Since
  2026-08-27 it is also a PHASE-29 change: `NOT_LANDED_SOURCES` in `knowledgeSearch.ts` is DERIVED
  from `MISSING_PACK_SOURCES`, so moving a source between the two lists here flips whether the
  unified search reports it as `unavailable/not_landed`. That is the point — one move, both planes —
  but do it knowing that, and run `cd packages/core && pnpm vitest run workflowPacks knowledgeSearch`.
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
cd packages/backend && npx vitest run convex/workflowPackEvals.test.ts       # the $0 corpus gate
cd packages/backend && npx vitest run convex/workflowPackDiscovery.test.ts  # listPacks + base version
cd packages/backend && node scripts/run-workflow-pack-evals.mjs --fixtures-only --self-test
cd apps/web && pnpm vitest run WorkflowPackCustomizer   # renders the surface; asserts its sentences
cd apps/web && pnpm vitest run WorkflowPackCustomizer.container  # jsdom; drives the real container
pnpm --filter @pikar/web build                          # RUNS. `f /dashboard/workflows` is in the
                                                        # route table. The dev server OOMs on the
                                                        # workspace page, so this is THE compile
                                                        # gate for a route — do not skip it.
```

**IF THAT BUILD FAILS WITH `Module not found: Can't resolve 'server-only'`, IT IS AN INSTALL
ARTIFACT OF A FRESHLY CREATED GIT WORKTREE, NOT A REPO DEFECT AND NOT A MISSING DEPENDENCY.** Next
aliases the bare specifier `server-only` — imported from inside `@convex-dev/auth`, reached by
`middleware.ts` and `app/layout.tsx` — to `next/dist/compiled/server-only/empty`, a
legitimately-shipped **0-byte** file. `pnpm install --frozen-lockfile` has been observed not to
materialise that file in a new worktree, while the main tree has it (store-linked) and CI builds.
The repair is one line, in `node_modules`, committed nowhere:

```
: > "$(readlink -f apps/web/node_modules/next)/dist/compiled/server-only/empty.js"
```

Create it EMPTY, matching what upstream ships. Two fixes that were tried, reverted, and should not
be proposed again: adding `server-only` to `apps/web/package.json` (pnpm's strict layout only lets
`@convex-dev/auth` see its own declared deps) and a `packageExtensions` entry adding it to
`@convex-dev/auth` (it installs, and the build still fails, because Next's alias map redirects the
specifier before resolution reaches the package).

**The browser gate has not been run for `/dashboard/workflows`.** No Playwright spec has loaded it
authenticated. Everything above is SSR and source; a live page is still owed.

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

- **`citationCoverage` and `unsupportedClaimRate` have no emitter.** Nothing writes `claimCount` /
  `citedClaimCount` / `unsupportedClaimCount`, so both report `not_applicable: no_data` — which is
  the honest answer, not a bug. Scoring a body's claims is grading, and the only plane that grades a
  pack body is 27-08's eval runner. They light up unchanged once it records the counts.
- **`recommendation_shown` has no caller yet.** The binding emits `recommendation_accepted` when a
  run carries a `recommendationId`; the impression belongs to the surface that renders the card
  (27-09). Until then `recommendationAcceptance` reads `no_data` rather than a fake 100%.
- **`artifact_created` is proven only in the negative direction offline.** The diff over the thread's
  cumulative `vaultSources` created-card is unit-tested both ways and the run-level test proves a
  PRE-EXISTING document is not re-counted. The positive direction needs a real `createDocument`,
  which calls a model — so it is covered by 27-08's live eval and 27-09's browser evidence, not here.
- **`PACK_DERIVED_METRIC_SOURCES.latency.index` names `by_correlation` on `agentSteps`, which does
  not exist.** That table's join is `by_turn` (`[tenantId, turnId]`), which is what the projection
  actually uses. The constant is documentation, read by nobody at runtime.

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
