# Playbook: Unified knowledge search, workflow customization and pinned routines

> Last verified: 2026-08-29 (29-08 — **A PINNED WORKFLOW IS A `savedPrompts` ROW, AND A RE-RUN IS
> STRUCTURALLY INCAPABLE OF REPLAYING ONE.** `packages/backend/convex/pinnedWorkflows.ts` ships
> `pinWorkflow` / `unpinWorkflow` / `listPins` / `checkReadiness` / `runAgain` over the SAME table
> 29-01 added the five lineage columns to. No second table, no second pin menu.
>
> `runAgain` declares ONE argument (`id`), so no caller can name a thread, a plan or an approval to
> resume; it calls `cockpit.startWorkflowPack` with no `threadId`, which makes `ensureThreadAndPlan`
> mint a fresh thread and a fresh `plans` row per press. Driven END TO END in convex-test for $0 by
> exhausting the daily budget first — `runPackTurn` takes `preCall`'s governed stop before the model
> — so "two presses are two runs" is a behavioural assertion: two thread ids, two `plans` rows both
> at `collecting`, two correlations, ordinals 1 then 2, and one spend row (the test's own).
>
> THE HONEST STATE IS NAMED: `customization_not_applied`. `PACK_GATE` refuses to activate any
> pack-named tenant candidate and `cockpit.ts` passes no `tenantSkillIds`, so a re-run takes the
> APPROVED GLOBAL TEMPLATE. The claim is pinned by a test that reads `cockpit.ts` itself.
>
> `savedPrompts.list` now excludes rows carrying a `templateId`: a workflow pin in the workspace's
> PROMPT menu would offer "Brand review" and then run an ordinary Executive-Agent turn on the
> opener, never the allow-listed pack agent.
>
> STILL UNPROVEN: the browser. No Playwright spec covers `/dashboard/workflows`, and no model has
> answered a pinned run.)

> Last verified: 2026-08-29 (29-09 — **`renderSourceGap` AND `groundedSourceProps` NOW HAVE A
> PRODUCTION CALLER, AND THE COORDINATOR'S OUTPUT IS TESTED AGAINST THE SENTENCE IT BECOMES.**
> Earlier entries in this file recorded both functions as having no production caller. The caller is
> `apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx`, mounted from the cockpit's
> "Chat options" menu (see `docs/playbooks/cockpit.md`).
>
> WHAT `knowledgeSearch.test.ts` GAINED (sections 9 and 10, 8 tests): the states a REAL run returns
> are put through `renderSourceGap`, so an `available` source renders `null` while `provider_error`,
> `not_connected` and `not_landed` each render their own literal sentence, and the not-landed one
> carries its `MISSING_SOURCE_UNLOCK` clause. `groundedSourceProps` is run over the STORED citations
> of a mixed vault+inbox claim: the vault ref is the only thing in `docIds`, and the mail ref comes
> back under `nonVault`. Two tenants running the same question in the same thread read different
> coverage sentences. And a run whose evidence carries a prompt injection writes its own content and
> audit rows (the presence control) while `requests`, `plans`, `agentSteps`, `notifications`,
> `followUps` and `attachments` all stay empty.
>
> Mutations observed RED for each: unavailable-re-minted-as-available, the gap sentence replaced by
> "no results", the unlock clause dropped, every ref treated as a vault doc id, `nonVault` emptied,
> the content-plane insert removed, the inbox adapter ignoring its `tenantId`, and the unknown-id
> `continue` deleted from `validateSynthesis`. Every one was reverted.
>
> STILL UNPROVEN: the browser. `apps/web/e2e/knowledge-search.spec.ts` is written and UNRUN — it
> needs a live deployment, a seeded E2E user and real credentials. See
> `.planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md`.)


> Last verified: 2026-08-29 (29-W3-TAIL — **A CLAIM 29-FIN-06 DELETED FROM THE CODE SURVIVED IN
> THIS FILE'S OWN "CORRECTED CLAIMS" LIST, AND SIX CITATIONS HAD ROTTED.** (1) The entry recording
> the `renderSourceGap` / `groundedSourceProps` fix still read "Both have ZERO callers repo-wide" —
> the exact sentence that commit removed from the two docstrings for being false (`workflowPacks.ts`'s
> test calls `renderSourceGap`). It was corrected to read that neither had a PRODUCTION caller and
> that 29-09's panel was the intended one — itself superseded hours later when that panel landed;
> see the 29-09 entry above. (2) Every `<file>.ts:<line>` citation in the BODY of this playbook is
> replaced by the SYMBOL it names; the five quoted in the next sentence are the rotted originals and
> are the only ones a grep still finds. The `cards.tsx` chain was wrong by 46, 81 and 38
> lines; `dispatch.ts:256`, `blueprint.ts:271`, `evaluations.ts:1150`, `voice.ts:349` and
> `onboarding.ts:492` had all drifted. This phase has now produced stale citations in four rounds —
> line numbers rot every commit, symbols do not. Prose-only; nothing on the search path changed.)

> Last verified: 2026-08-29 (**29-FIN-06 — TWO OPEN DOORS CLOSED, ONE FLAKE ROOT-CAUSED, AND A
> FALSE CLAIM ABOUT ANOTHER MODULE DELETED RATHER THAN REWRITTEN.**
>
> (1) **`threadId` is bounded at 200 characters and refused as DATA** (`thread_id_invalid`), on the
> same line of `knowledgeSearch.search` as the question cap and before the hash, so it costs $0.
> `question` was capped one wave earlier while the arg beside it — tenant-supplied on the same
> handler, stored VERBATIM on the content row and used as the `by_thread` INDEX KEY — was not.
> An empty id is refused because it is the absence of a thread, not a thread. The cap is a LITERAL
> in the test (importing it would move the oracle with the subject). **`listByThread` deliberately
> has NO check of its own:** one was written, then deleted after mutating it away left the test
> green — `search` refuses to store an id outside the cap, so such an id names no row and the index
> read returns `[]` regardless. A guard that cannot be made to fail is not protection.
>
> (2) **`vaultGround.ts`'s `SMOKE::` seam is gated on `offlineSeamAvailable()`** — the same
> predicate `knowledgeLlm.ts`, `vaultDigest.ts` and `voiceDoc.ts` use, not a fourth variant. It was
> the last tenant-supplied string on the knowledge plane that could select an offline FABRICATION
> path: `vaultGround` is a `tenantAction` and every `vaultGroundHydrated` caller (cockpit tool loop,
> blueprint prober, evaluator, knowledge coordinator) passes user text. The cost of closing it was
> real and is worth knowing: the suite-wide operator consent now lives in
> `packages/backend/vitest.config.mts` (`env: { PIKAR_OFFLINE_FIXTURES: "1" }`) rather than in ~14
> `beforeEach` blocks, and TWO test files were planting a FAKE MODEL CREDENTIAL, which is a claim
> about the deployment and made `offlineSeamAvailable()` false. `knowledgeSearch.test.ts` now mocks
> the model ROUTE (`vi.mock("./lib/models", … resolveModel)`) instead of stubbing
> `OPENROUTER_API_KEY`, and `onboarding.test.ts`'s raw `process.env.OPENAI_API_KEY = FAKE_KEY` (no
> cleanup, leaked into every later file in the worker) is deleted — nothing needed it, 32/32.
>
> (3) **The synthesis fence nonce is spelled with `_`, not `-`.** A test whose subject was the
> per-run fence was nondeterministically red about 1 run in 450, and the cause was not the test:
> `scanText` runs over the ASSEMBLED prompt and its card detector takes 13-19 digits with single
> `-`/space separators plus a Luhn check, which a `crypto.randomUUID()` satisfies by spanning its own
> dashes (measured over 2,000,000 ids: 2.18% reach a 13-digit run, 0.22% clear Luhn). Both fence
> markers then read `[CARD_1]` — the run's unpredictable fence became a guessable constant. `_` is
> not a separator that detector accepts. Driven by a test that pins the exact adversarial id as a
> LITERAL and asserts the dashed spelling really is redactable, so the fixture cannot go vacuous.
>
> (4) **Deleted rather than restated:** `knowledgeSearch.ts`'s "THE ONE GOVERNANCE-PLANE WRITE"
> heading (there are two `audit.log` sites, and the header two hundred lines above already said so);
> "the ONLY UNCAPPED FREE TEXT ON THIS PLANE" and "every other free-text trust boundary in this repo
> is bounded" (a repo-wide absolute, and false about the arg beside it); `@pikar/core`'s "zero
> callers repo-wide" on `renderSourceGap` (`workflowPacks.test.ts` calls it) and on
> `groundedSourceProps`; and `knowledgeLlm.test.ts`'s "only the tests in THE PROMPT THE HANDLER
> ACTUALLY SENDS reach the mocked boundary".
>
> (5) **`llm.ts`'s overlay comment no longer names a closed set of skill names at all.** Its first
> version said "only the three `USER_AUTHORABLE_SKILLS`"; the 29-06 FIX replaced it with "Phase 29
> widened `USER_AUTHORABLE_SKILLS` to admit the six `pack-*` names", which is FALSE —
> `contracts/src/skill.ts` still lists exactly `OFFER_ARCHITECT`, `MONEY_MODEL_DESIGNER` and
> `LEAD_ENGINE`, and 29-05 added a separate channel (`skills.publishPackCustomization`) instead. It
> mattered because it read as justification for removing a sibling's fail-closed gate. The comment
> now describes what `loadEffectiveSkill` QUERIES (`[tenantId, name, status: "active"]`, falling
> through to the global active row) and points at the publish channels for the membership question.
> The same false sentence is corrected in `cockpit.md` and in the "Corrected claims" list below.)
>
> Last verified: 2026-08-28 (**29-06 REMEDIATION — THE PUBLIC ACTION MADE THREE WAVE-2 CLAIMS
> FALSE, AND THE CALLER BECAME THE ATTACKER.** Five corrections, each with a mutation witness.
> (1) **The `SMOKE::` fixture seam is now gated on `lib/models.offlineSeamAvailable()` AND the
> question** — wave 2 keyed it on the `question` argument alone and justified that with "the
> question is the caller's own argument, so keying on it puts the seam back under the operator",
> which stopped being true the moment `knowledgeSearch.search` shipped as a `tenantAction`: any
> authenticated tenant could suppress the synthesizer's model call and steer a fabricated,
> fully-cited answer into `knowledgeSearches`. (2) **`question` is capped at 2,000 characters at the
> trust boundary** and refused as DATA — it was `v.string()` with no bound, interpolated verbatim
> into both PAID prompts and the stored row. (3) **`searchedGapCount` now reports the TOTAL gap for
> a run that searched nothing**, instead of 0, which read as its exact opposite. (4) **A governed
> stop landing BETWEEN the fan-out and the synthesis writes `knowledge.search_stopped`** — that run
> had already read the mailbox, Drive and the CRM and already charged for the planner, and left no
> governance trace at all. (5) **The §4 guard is an ALLOWLIST of payload keys**, pinned against the
> stored row and against `AUDIT_VIEWER_EVENTS`; the old word blocklist admitted every key it did not
> name, and both a stray `rawQuestion` and a model-prose `unansweredList` passed it. See the
> remediation section at the foot of this file.)
>
> Last verified: 2026-08-28 (**29-06 — THE COORDINATOR LANDS, AND THE RUN-LEVEL CLAMP WITH IT.**
> `packages/backend/convex/knowledgeSearch.ts` is the one place a question becomes a search:
> `tenantAction` -> `contentHash(question)` -> `planKnowledgeSearch` -> `Promise.allSettled` over
> `KNOWLEDGE_ADAPTER_ACTIONS` -> `dedupeEvidence` -> `clampEvidence(corpus, "run")` -> re-mint every
> per-source state -> `synthesizeKnowledge` -> one `knowledgeSearches` row -> one refs-only
> `knowledge.searched` audit event. The wave-2 `ponytail:` comments that named this plan are gone
> from `@pikar/core/knowledgeSearch.ts` and `knowledgeLlm.ts`; the second clamp inside
> `synthesizeKnowledge` STAYS, as an action-boundary trust check, and now says so.
> **THREE THINGS ARE NOT BUILT, on purpose and with a test each:** no cockpit tool (the tool-bearing
> loop cannot reach any knowledge module at all — strictly stronger than the counts-only contract
> the plan allowed for), no telemetry row (`writeTerminal` is hard-bound to
> `requestId: v.id("requests")` and that binding is now pinned by a test rather than by a comment),
> and no recurrence. See the 29-06 section at the foot of this file for the invariants, the
> mutation witnesses and the two limits that are stated rather than hidden.)
>
> Last verified: 2026-08-28 (**WAVE-2 FINAL PASS — THE CROSS-PLANE AUTHORITY DIVERGENCE IS DECIDED,
> NOT DISCLOSED.**
>
> Round 3 documented, rather than resolved, that ONE document read two provenances: a file a
> stranger shared into the tenant's Drive was `third_party_research` on the Drive plane (Drive's own
> `ownedByMe`) and `tenant_owned` the moment the folder import copied it into the vault. **DECISION:
> the two planes agree, at the weaker class.** The reading that "an import is a deliberate tenant
> act, so `tenant_owned` means in the tenant's own STORE" was rejected — `tenant_owned` is the
> strongest class and it is what makes a claim citable as the owner's own word; copying a stranger's
> file changes where it is KEPT, not who WROTE it.
>
> The ownership signal is threaded through the import: `vaultDrive.enumerateFolder` ASKS Drive for
> `ownedByMe` (its `files.list` never did — the browse projection did, the import's did not),
> `landFile` collapses Drive's tristate at the WRITE SITE (`ownedByMe === true`, the Drive plane's
> own "absence is not ownership" rule) into `vaultDocuments.driveOwnedByMe`, `ownedDocsMeta` and
> `vaultGroundHydrated` carry it as the `driveOwned` parallel array, and the vault adapter passes it
> to `authorityFor`. The rejected alternative — dropping `"upload"` from `TENANT_AUTHORED_DOC_KINDS`
> — would have downgraded every genuine upload, a much larger untruth than the one it fixes.
>
> **ONE ASYMMETRY IS DELIBERATE AND IT IS ABOUT WHAT ABSENCE MEANS.** On the Drive plane the field
> is always requested, so absent ⇒ Drive declined to confirm ⇒ downgrade (`ownedByMe !== true`). On
> the vault plane it exists only for Drive imports, so absent ⇒ this row never came from Drive, and
> ONLY AN EXPLICIT `false` downgrades (`source !== "drive" && ownedByMe === false`). Downgrading on
> absence there would take `tenant_owned` from the entire upload rail.
>
> Mutations that MUST go red: delete the vault-plane clause in `authorityFor` (core
> `knowledgeSearch.test.ts` + backend `knowledgeVaultDrive.test.ts`); stop the vault adapter passing
> `driveOwned` (`knowledgeVaultDrive.test.ts` — the reason that test is driven through the ADAPTER
> and not through the pure `authorityFor` alone); `landFile`'s `a.ownedByMe === true` → `?? true`
> (`vaultDrive.test.ts`); drop `ownedByMe` from the enumeration projection (`vaultDrive.test.ts`);
> `driveOwned.push(...)` → `push(null)` (`knowledgeVaultDrive.test.ts`).
>
> Also fixed here: the corrected `AGENT_AUTHORED_ORIGINS` docstring — the one carrying round 3's
> retraction of "a row with no origin is a tenant upload" — was ORPHANED. It sat immediately above a
> SECOND `/** */` block belonging to `FACT_OWNING_PROVIDER_AUTHORITIES`, so TypeScript attached it
> to nothing and no reader saw it on hover. Moved onto its symbol.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, ROUND 3 — THE PROMPT DEFENCE HAD NO COVERAGE
> ON THE PATH PRODUCTION TAKES, AND A ROW WITH NO `origin` WAS NEVER PROOF OF A TENANT UPLOAD.**
>
> **(1) THE REPAIR INTRODUCED THE VACUITY IT WAS FIXING.** Rounds A/B exported `plannerPrompt`
> and `synthesisPrompt` "for the test that proves it", and every prompt assertion then called the
> exported builder DIRECTLY with values the test itself chose. Nothing bound either builder to the
> handler that runs, so the whole prompt-assembly defence — the evidence fence, the per-run nonce
> that is the stated remedy for fence forgery, `fenceSafe`'s marker stripping and the planner's
> per-run closed source list — was asserted against a function the shipped path might never call.
> Three mutations proved it green: a hardcoded fence nonce, and `scanText(question)` in place of
> each assembled prompt. `knowledgeLlm.test.ts` now mocks ONLY `generateObject` (via
> `vi.hoisted` + `vi.mock("ai", importOriginal)`) and asserts the `prompt` and `system` THE
> HANDLER HANDED THE MODEL: the fence nonce is read off the RETURNED `runId`, two runs produce two
> fences, the injected markers are gone, the hostile words survive as material, and `system` is the
> REGISTRY body (§5). Every other test in the file still drives the `SMOKE::` seam, and the two
> that need the live call to FAIL still do — `resolveModel` throws on a missing
> `OPENROUTER_API_KEY` before `generateObject` is reached.
>
> **(2) THE THIRD `validateSourceRef` GUARD.** Part B's SUMMARY said "both guards" were closed;
> there are THREE on the external plane — the inbox `message.id`, `dealText`'s `key()` and the CRM
> `sourceRef` — and the CRM one had no test, nor did the `dropped > 0` arm of its `providerError`.
> It is genuinely drivable: `@pikar/revenue`'s `validateSourceRef` is a DENYLIST of quotes and
> control characters with no space class, so `hubspot:deal:a b c` clears the provider layer and
> only `@pikar/core`'s ALLOWLIST refuses it. Now asserted as a VALUE, with the windowed-read `cap`
> state as the negative control that makes `provider_error` falsifiable.
>
> **(3) `authorityFor` NO LONGER READS ABSENCE AS PROOF.** Its docstring asserted "a row with NO
> origin is a tenant upload" and it decided the STRONGEST class from that absence. Three landed
> writers ingest LLM prose with no `origin` at all — `evaluations.ts`'s `persistNextStepMemo` (its
> `vaultDocuments` insert takes `text` from `plan.body`), `voice.ts`'s `persistBrief` and
> `onboarding.ts`'s `writeProfileDoc` — so the agent's own
> memo, brief and onboarding profile were each cited as the owner's own word. Vault authorship is
> now established POSITIVELY from `docKind` against the new `TENANT_AUTHORED_DOC_KINDS`
> (`upload`, `brain_dump`, `document`); anything else, INCLUDING a kind this repo has never heard
> of, falls to `third_party_research` or weaker. An allowlist that fails weak costs a downgrade
> when somebody forgets; a denylist costs a laundered citation. It subsumes the old
> `docKind === "web_research"` special case, which is why that mutation is red three ways.
>
> **(4) THE `rawEvidence.authority` COMMENT NOW MATCHES THE CODE.** The closed union makes an
> UNKNOWN class unspellable; it does not stop a caller passing a wrong-but-valid one, and the
> value cannot be derived inside the module (`authorityFor` needs adapter-local facts that do not
> cross the boundary). Plan 29-06 must carry each adapter's `KnowledgeAdapterResult` through
> unmodified or re-derive at the merge point — that is written on the validator now.
>
> **(5) EVERY `SEARCH_CAPS` VALUE IS PINNED TO A LITERAL.** `maxClaims` (12) and `excerptCharCap`
> (300) had no literal anywhere — every assertion read the constant it was meant to pin, so 12 -> 40
> and 300 -> 3000 both left core and the four backend knowledge suites green. One whole-object
> equality replaces the per-cap guesswork and also fails when a NEW cap lands unpinned.
>
> **HOW TO VERIFY:** `cd packages/core && pnpm vitest run knowledgeSearch` and
> `cd packages/backend && pnpm vitest run knowledgeLlm knowledgeVaultDrive knowledgeExternalSources`.
> MUTATIONS OBSERVED RED: the fence nonce -> `"fence"`; `scanText(synthesisPrompt(...))` ->
> `scanText(question)`; `scanText(plannerPrompt(question))` -> `scanText(question)`; the CRM
> `validateSourceRef` guard -> `if (false)`; the `dropped > 0 ||` term -> `false ||`; the
> `TENANT_AUTHORED_DOC_KINDS` rule reverted to `docKind === "web_research"`; `maxClaims` 12 -> 40;
> `excerptCharCap` 300 -> 3000.
>
> **NOT FIXED, DELIBERATELY, AND NAMED SO IT IS A TASK RATHER THAN A REDISCOVERY:**
> `evaluations.ts`'s `persistNextStepMemo`, `voice.ts`'s `persistBrief` and `onboarding.ts`'s
> `writeProfileDoc` should each store
> `origin: "agent"` on the row they ingest. That is the real fix — it lands them at
> `agent_authored`, the class that names the author, instead of `third_party_research`, which is
> true ("the tenant did not author this") but one rank too strong. All three are outside this
> plan's owned files.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART B — SIX GUARDS IN `knowledgeLlm.ts`
> THAT COULD NOT FAIL, AND ONE ERROR THAT CARRIED PROVIDER PROSE.**
>
> **THE TWO SCHEMAS ARE NOW EXPORTED VALUES**, `KNOWLEDGE_PLAN_JSON_SCHEMA` and
> `KNOWLEDGE_SYNTHESIS_JSON_SCHEMA`, and `SEARCHABLE_SOURCES` / `plannerPrompt` are exported
> beside them — the `synthesisPrompt` precedent. Everything below turns on that: a schema you
> can only scan as TEXT is pinned by `toContain` over a whole block, which ONE occurrence
> satisfies, so `additionalProperties: false` could be dropped from the synthesizer's INNER
> `claims` object with the suite green. That is the grammar lock making a model-authored
> `authority`/`confidence` key unspellable rather than ignored, and a live strict-mode call
> would have rejected the schema outright on every input. The new test WALKS the object and
> checks all four object nodes, closed and fully required.
>
> **The headline claim now has a test.** "A source with no adapter is not in the grammar" was
> covered only by a source scan for the identifier at the enum site: replacing the derivation
> with `() => true` admitted `support-desk` into both the enum AND the prompt, and deleting the
> prompt's source list told the model nothing about which sources exist. Both were green. The
> enum, the prompt's list and `SEARCHABLE_SOURCES` are now asserted against LITERALS.
>
> **The POST-call spend ledger is covered per HANDLER.** One whole-file
> `toContain("internal.guardrails.recordSpend")` was satisfied by the planner's copy alone, so
> the synthesizer's whole `priceUsage` + `recordSpend` block could be deleted and an unbilled
> synthesis would never accumulate against the tenant's daily budget. `preCall` is the PRE-call
> gate and cannot see what a call cost. The two correlation prefixes are pinned as distinct
> literals.
>
> **`runId` is proved per-EXECUTION** (two identical plan runs, different ids; a plan id is
> never a synthesis id) and **`fallbackPlan`'s truncation is proved at the boundary** — without
> it a question over 200 characters degrades to an EMPTY plan while still reporting
> `fallback: true`, which is the "we searched everything and found nothing" outcome the branch
> exists to prevent.
>
> **The injection test used to be unfailable.** It asserted four tables were `[]` after a
> synthesis — true after ANY synthesis, since the module writes to no table, which the
> structural scan already proves by construction. It now searches every governance row for the
> injected SUBSTRING and then PLANTS one to prove the scanner works.
>
> **The synthesizer's provider error is contained.** The planner caught and dropped its error
> ("it can hold provider prose"); the synthesizer — whose prompt is mail bodies, Drive file
> names and CRM records — rethrew verbatim, and an AI SDK `TypeValidationError` embeds the
> model's raw output, which a scheduled caller puts into `deadLetters.payload` (§4). It is a
> content-free RETHROW, not the planner's degradation, and the asymmetry is deliberate: a plan
> with fewer sources is still honest, a synthesis with no model is made up.
>
> **⚠ `llmRedaction.test.ts`'s strict-mode scan LEARNED THE SECOND IDIOM.** It discovered
> schemas by `const X = jsonSchema<`, so a hoisted `const X: JSONSchema7 = {...}` sliced a
> block with no `properties:` in it. Its own anti-vacuity guard is the only reason that was
> loud. It now scans both forms, and a `jsonSchema<T>(HOISTED)` wrapper is exempted from the
> guard because the object it names is a separate, checked entry.
>
> **HOW TO VERIFY:** `cd packages/backend && pnpm vitest run knowledgeLlm llmRedaction`.
> Mutations that MUST go red: the `SEARCHABLE_SOURCES` filter to `() => true`; the prompt's
> source-list line deleted; the inner `additionalProperties: false` dropped; the synthesizer's
> spend block deleted; `runId` a constant; `fallbackPlan`'s `.slice` removed; the synthesizer's
> catch rethrowing `error`; a key dropped from a hoisted `required[]`.

**AND THE SIBLING HALF OF THE evidenceId FINDING.** `inbox:${evidence.length}` was untested in
the mailbox adapter exactly as `crm-facts:${evidence.length}` was in the CRM one — collapsing
either to a constant left every adapter test green, while `validateSynthesis` builds
`new Map(evidence.map((e) => [e.evidenceId, e]))`, so duplicates collapse to the LAST row and an
excerpt is then verified against the wrong message. Both are pinned now, with Gmail's own
recency order asserted beside the ids.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART B — THE CRM ADAPTER STOPS OVERRIDING THE
> CONNECTOR LAYER, AND STOPS PUTTING THE MONEY IN PROSE.**
>
> **(1) HubSpot's own authority is honoured.** `hubspotProjection` hardcodes
> `authority: "supplemental"` — "colour only ... Never a total" — precisely so no caller can
> promote a deal into accounting authority, and `readCrmKnowledge` discarded it and re-stamped
> every row `system_of_record`, the second-strongest class, which feeds `weakestAuthority` and
> `searchConfidence`. `authorityFor` now takes `providerAuthority` and relates the two
> vocabularies in ONE direction only: a value that does not own a money fact
> (`accounting_authority`, `payment_rail`) drops the row to `correspondence` — what somebody said
> — and nothing can RAISE a source above its code-owned class.
>
> **(2) The deal amount is no longer in the evidence text.** It was interpolated verbatim, which
> is everything a model needs to sum a pipeline and cite the total. The absence is STATED in the
> composed sentence so it can never be read as zero. Ceiling, named in the code: a knowledge
> answer cannot say what a deal is worth. Upgrade path is a typed non-summable `Evidence.figure`
> plus a `validateSynthesis` rule, which is a design and belongs with the revenue rail.
>
> **(3) A WINDOWED READ IS A PARTIAL READ.** `readHubSpotDataset` filters to
> `DEFAULT_WINDOW_DAYS` (90) and this adapter never passes a `windowDays`, so the CRM arm now
> always settles `partial/cap`. `available` was a complete-looking answer built from a slice.
>
> **(4) `CRM_UNAVAILABLE_REASON` IS TYPED ON THE TOKEN VERB'S OWN UNION.** It was
> `Record<string, UnavailableReason>` — deleting the `reauth` entry left `tsc` AND the suite
> green while a dead refresh was reported as the transient `provider_error`. It is now
> `Extract<AccessTokenResult, {ok:false}>["reason"]`-keyed, so a gap is a compile error; a
> `crmReason` helper keeps the runtime fail-closed for a value from anywhere else.
>
> **(5) BOTH ADAPTER MODULES ARE INTERNAL-ONLY, AND THAT IS NOW RECORDED.** Every reader takes
> `tenantId: v.string()` as an ARGUMENT, which is correct for an `internalAction` and a
> cross-tenant read on anything public. A scan over both modules fails on `tenantAction`,
> `action(`, `query(`, `mutation(` or `httpAction`. 29-06 must pass `ctx.tenantId` from a tenant
> wrapper, never a caller-supplied value.
>
> **HOW TO VERIFY:** `cd packages/backend && pnpm vitest run knowledgeExternalSources` and
> `cd packages/core && pnpm vitest run knowledgeSearch`. Mutations that MUST go red: drop
> `providerAuthority` from the `authorityFor` call; put the amount back in `dealText`; revert
> `cap: true`; collapse `evidenceId` to a constant; delete the recency `.sort`; make a reader a
> `tenantAction`. Deleting a `CRM_UNAVAILABLE_REASON` member must fail `pnpm typecheck`.

**(6) `KNOWLEDGE_ADAPTERS.drive` NAMED THE WRONG VERB.** It pointed at `findInDrive`, the
identity-BEARING `tenantAction` the cockpit tool loop calls; the toolless plane calls
`findInDriveForTenant`, the identity-less `internalAction`, which is the only one it can call.
Both are exported, so the "every landed source exports the named verb" scan passed on the wrong
one and deleting the RIGHT one would have broken Drive knowledge search with the registry still
green — on the artifact the whole `crm-facts` landedness argument rests on. A second scan now
proves the named verb is the one a toolless adapter actually calls, matching on a word boundary
because `vaultDrive.findInDrive` is a prefix of `vaultDrive.findInDriveForTenant`.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART B — `authorityFor` gained two downgrades
> and one exported registry.**
>
> `AGENT_AUTHORED_ORIGINS` is every value in `vaultDocuments.origin`, exported so the backend can
> read the schema union off disk and fail when one lands with no authority decision. A Drive hit
> is `tenant_owned` ONLY when Drive itself says `ownedByMe: true`; absence is a downgrade, because
> Drive leaves the field unset for shared-drive items. Both are provenance-laundering doors:
> agent-written prose and a stranger's file were reading back as the owner's own word. See
> `vault.md`'s Part-B entry for the full reasoning and the mutations that must go red.)

> Last verified: 2026-08-28 (**WAVE-2 REMEDIATION, PART A — three blockers, one reinvented contract,
> and a cap with no enforcement site.**
>
> **(1) UNTRUSTED THIRD-PARTY CONTENT COULD SELECT THE OFFLINE SMOKE SEAM.** `synthesizeKnowledge`
> tested `safePrompt.includes(SMOKE_SYNTH_PREFIX)`, and `safePrompt` is the rendering of the
> question PLUS every evidence row's `text` and `label` — i.e. inbound mail BODIES and SUBJECT
> LINES. Anyone who could email the tenant could put the sentinel in a message and replace the whole
> synthesis with the code fixture: no model call, no spend, the real answer suppressed, and the
> SENDER choosing which of the tenant's rows were cited and which were reported as conflicts,
> through the `<citeIds>|<excerptFromId>|<conflictIds>` grammar. A remote party selected a code path
> in the one module whose entire safety argument is that untrusted content steers nothing. **Both
> seams now key on the `question` ARGUMENT alone.** `blueprint.ts` and `vaultDigest.ts` may scan
> their whole prompt because theirs is built from the tenant's own profile (**NO LONGER TRUE OF
> `vaultDigest.ts` as of the final pass** — its manifest is built from ingested Drive files and
> email, and its seam is now the credential-based `offlineSeamAvailable()`, selected by nothing in
> the prompt at all; see `vault.md`); this one is not, and the
> difference is a security boundary rather than a style choice.
>
> **(2) THE EVIDENCE FENCE WAS FORGEABLE, AND ITS JSDOC DENIED IT.** `synthesisPrompt` interpolated
> `evidenceId`, `source`, `label` and `text` into the `<<<evidence ...>>>` markers with no escaping
> and no nonce, while the docstring claimed a body containing the closing marker "cannot end a block
> early". Its justification — "nothing downstream parses this string back" — is about the CODE
> plane; the fence exists for the MODEL's view of the prompt. The markers now carry the run's nonce,
> and `fenceSafe` strips `<` and `>` from every interpolated field, so a row can neither close its
> own block nor mint a forged one claiming to be tenant-owned vault evidence. `synthesisPrompt` is
> EXPORTED for the test that proves it: the prompt never leaves the module, so no caller-visible
> assertion can reach it and a source scan would only prove the spelling.
>
> **(3) THE MODEL WAS MISROUTED ON BOTH LIVE CALLS.** The module copied `blueprint.ts`'s stale
> private `resolveModel`, which has no `or/` branch, so both calls sent `or/openai/gpt-4o-mini` to
> the OpenAI provider. Planner-side that failure is silent and permanent — the bad call lands in the
> `catch` and degrades to the vault-only fallback on every production run, which is exactly the "we
> searched everything and found nothing" outcome this module exists to prevent. It imports
> `convex/lib/models.ts` now; see `cockpit.md` for the five stale copies still outstanding.
>
> **(4) THE RUN-LEVEL CAPS WERE ENFORCED NOWHERE, AND THE SYNTHESIZER BILLED AN UNBOUNDED CORPUS.**
> `clampEvidence` is documented as THE admission boundary that applies every per-RUN bound once, and
> its only production call site was inside a SINGLE-SOURCE adapter — so `maxEvidenceTotal: 24` and
> `totalEvidenceCharCap: 8000` bounded nothing (five sources at their per-source cap is 40 rows and
> ~40k characters). `clampEvidence` now takes a SCOPE: `"source"` applies the per-source and per-row
> caps only, `"run"` (the DEFAULT, so a forgetful caller gets the tighter bounds) adds the two run
> bounds. `settleRead` clamps at source scope; `synthesizeKnowledge` clamps the whole corpus at run
> scope as the FIRST act of its handler, before the gate, the prompt and the model.
>
> **`ponytail:` ceiling, named rather than papered over:** the per-source `returned` counts the
> adapters publish are minted BEFORE the union clamp, so a corpus cut at synthesis can leave a state
> that overstates what reached it. Upgrade path: plan 29-06's coordinator clamps the union ONCE and
> mints every state after it, and both ponytail comments come out when it does.
>
> **(5) ONE ADAPTER RESULT CONTRACT, IN `@pikar/core`.** `KnowledgeAdapterResult` and
> `ExternalKnowledgeResult` were structurally identical types written three minutes apart in the
> same wave, with nothing pinning them, and they had ALREADY drifted on who enforces admission — one
> ran `clampEvidence`, the other relied on hand-written slices, so `evidenceTextCharCap` bound a
> mail body and nothing at all bound a CRM row. `KnowledgeAdapterResult`, `unavailableRead` and
> `settleRead` are now defined once beside `clampEvidence` and the closed state union, and all four
> adapters use them. `knowledgeExternalSources.ts` no longer contains a single `status: "..."`
> literal, which its own containment test asserts — a state carrying a subject line is not
> discouraged there, it is unspellable.
>
> **(6) THE CRM EVIDENCE TEXT WAS NOT PROVIDER-STRING-FREE, AND THE HEADER SAID IT WAS.**
> `deal.pipelineId` and `deal.stageId` are HubSpot's own `pipeline` and `dealstage` property values
> — opaque keys in every real portal, unbounded provider strings on the wire — and they were
> interpolated verbatim into text carrying `system_of_record` authority, with no cap on the CRM arm
> at all. They go through `validateSourceRef` now, the same §4 ref-shape rule the `sourceRef` uses,
> so a value that is not id-shaped is reported as `unknown` rather than repeated. The test that
> claimed to prove containment planted its payload in `dealname`, a property the rail never
> requests, so it proved a field was absent rather than that the requested fields were safe.)
>
> Last verified: 2026-08-28 against **plan 29-04** (the TWO TOOLLESS MODEL CALLS land:
> `packages/backend/convex/knowledgeLlm.ts` plus the `knowledge-query-planner` and
> `knowledge-synthesizer` registry rows, both GATED. Four things a reader needs:
> **(a)** the calls live in a NEW module, not `llm.ts` — the plan text's "the existing sole Node
> LLM module" premise is false (`blueprint.ts`, `vaultDigest.ts`, `vaultExtract.ts` and
> `intake.ts` all call toollessly outside it), and putting untrusted mail/Drive/CRM text inside
> the ~6,000-line tool-bearing loop would undo this feature's whole safety argument.
> **(b)** invariant 27: a NOT-LANDED source is `not_landed` whether or not the planner named it —
> `clampSearchPlan` can only mint that state for a source the MODEL proposed, so relying on it
> alone made `support-desk` read as `unplanned` on every ordinary run. A test caught it.
> **(c)** invariant 28: the RAW model object never leaves `knowledgeLlm.ts`.
> **(d)** THE GATE ON BOTH BODIES IS NOT YET CLEARABLE — see "Known gaps". Plan 29-06 owes the
> golden fixture. Do not edit either body before it lands.)
>
> PREVIOUS: 2026-08-28 against **plan 29-03** (the first EXTERNAL adapters land:
> `packages/backend/convex/knowledgeExternalSources.ts` + `gmail.knowledgeQuery` + the HubSpot
> CRM read. **`crm-facts` IS NOW SEARCHABLE** — the search plane got its own landedness
> determination, `KNOWLEDGE_ADAPTERS`, and it deliberately disagrees with the pack plane; see
> invariant 23.) Previously verified against the SECOND 29-01 adversarial-repair round (a first pass found
> 22 defects, a fixer repaired them, a second pass re-ran the mutations and found 10 still
> standing — including two the first round's SUMMARY had claimed as "observed RED". This file
> records the state after the second repair.)
> Build history: `.planning/phases/29-unified-knowledge-and-routines/` · Related ADRs:
> [ADR-003](../decisions/003-skill-registry-for-prompts.md) (skills registry — `tenantSkills` is an
> additive overlay, not a supersession), [ADR-006](../decisions/ADR-006-vault-chunks-trusted-as-own.md)
> (vault chunks trusted as own — **does not extend to Drive/Gmail/CRM**),
> [ADR-025](../decisions/025-promoted-agent-artifacts-enter-retrieval.md) (agent-promoted artifacts
> in retrieval — why `agent_authored` is the weakest authority class).
> **The next free ADR number is 027.** 013 and everything up to 026 are taken; if the recurrence
> gate (plan 29-11) selects enable-safe, its standing-approval decision needs ADR-027, not 013.

## Purpose

Phase 29 ships three things and deliberately defers a fourth.

1. **Unified native search (KNOW-01).** One question, decomposed into bounded per-source queries,
   run against native adapters only, deduplicated in pure code, synthesized by a *toolless* model
   call, and rendered with citations that were validated against the evidence the run actually
   minted. A source that could not be reached produces a visible gap — never an empty "nothing
   exists" for the whole business.
2. **Workflow-pack customization (ROUT-01).** Phase 21's free-text authoring seam gets a closed,
   typed form in front of it. A user changes terminology, tone, thresholds, source preferences and
   bounded instructions. A user cannot add a tool, executable code, a secret, a remote URL or an
   MCP server.
3. **A manually re-runnable pinned workflow (ROUT-02).** A pin names an exact template version and
   an exact tenant candidate row. "Run again" starts an ordinary fresh cockpit turn. It never
   replays a plan and never bypasses a current gate.
4. **Recurrence is DEFERRED** behind the plan-29-11 decision-and-proof gate. Nothing in the schema,
   the contracts or the UI may pre-build it. See "Invariants".

As of plan 29-01 only the **pure contracts and the schema boundary** are landed. There is no
coordinator, no adapter, no UI and no Convex module yet.

## Key files

**Pure packages (landed, 29-01)**

| File | Role |
|---|---|
| `packages/core/src/knowledgeSearch.ts` | The closed source registry (`KNOWLEDGE_SOURCES` — a named SUBSET of `workflowPacks.ts`'s `PackSource`; `KNOWLEDGE_ADAPTERS` and `NOT_LANDED_SOURCES`, DERIVED from it), `KnowledgeSourceState`, `SEARCH_CAPS`, `clampEvidence` (the cap-enforcing admission boundary), `validateSourceRef`, `authorityFor`/`weakestAuthority`, `freshnessFor`/`oldestFreshness`, `normalizeEvidenceText`/`dedupeEvidence`, `clampSearchPlan`, `validateSynthesis`, `aggregateCoverage`, `renderSourceGap`, `groundedSourceProps`, `searchConfidence`, `redactedSearchEvent`. |
| `packages/core/src/knowledgeSearch.test.ts` | 95 tests. Every honesty rule above has a mutation recorded in `29-01-SUMMARY.md`, and each mutation listed there was OBSERVED red. |
| `packages/core/src/workflowCustomization.ts` | `CUSTOMIZATION_FIELD_KINDS`, `MATERIAL_FIELD_KINDS`, `CUSTOMIZATION_CAPS`, `validateCustomization`, `renderCustomization`, `canonicalCustomization`, `classifyCustomizationChange`, `checkBaseVersion`, `TenantSkillRef`, `WorkflowPin` (carries `tenantSkillId`, NOT a version) / `pinIdentity`/`pinMatchesActive`/`freshRunCorrelation`. |
| `packages/core/src/workflowCustomization.test.ts` | 87 tests, including the "ordinary business prose is not refused" corpus and the SOURCE-TEXT recurrence scan that replaced two unfalsifiable runtime bans. |

**Backend (29-01 schema, 29-03 external adapters)**

| File | Role |
|---|---|
| `packages/backend/convex/schema.ts` | `knowledgeSearches` (new), `tenantSkills` template-lineage fields + `by_tenant_template`, `savedPrompts` pin-lineage fields + `by_tenant_template`. |
| `packages/backend/convex/schema.test.ts` | 32 tests: the Phase-29 widening proved by INSERT (not by substring), and the **recurrence-absence scan** that nothing else in the repo performed. |
| `packages/core/src/tenantData.ts` | `knowledgeSearches: "tenant_owned"` — owned by `audit-dead-letter.md`, listed here because Phase 29 is why the row exists. |
| `packages/backend/convex/knowledgeExternalSources.ts` | **29-03.** The EXTERNAL adapters: `EXTERNAL_KNOWLEDGE_READERS` (the code-owned reader registry), `readInboxKnowledge` (via `gmail.knowledgeQuery`), `readCrmKnowledge` (via the landed `hubspot.readHubSpotDataset`), `unavailableResult`/`answeredResult` (the only two state constructors) and `CRM_UNAVAILABLE_REASON` (the closed credential-reason map). Registered under this playbook in `watch.json`. |
| `packages/backend/convex/knowledgeExternalSources.test.ts` | **29-03.** Two-tenant isolation, injected-instruction fixtures, the reader-registry drift scans and the structural containment scans. |
| `packages/backend/convex/knowledgeLlm.ts` | **29-04.** The TWO toolless model calls: `planKnowledgeSearch` (question -> `{source, query}` pairs, over a code-supplied source list, re-checked by `clampSearchPlan`) and `synthesizeKnowledge` (fenced evidence -> claims, post-validated by `validateSynthesis`). Both take a `skillVersion` PIN. `SMOKE::knowledge-plan::` / `SMOKE::knowledge-synth::` are the offline seams, and they replace the `generateObject` call ONLY — the fixture's output still crosses the pure validators. Registered under this playbook in `watch.json`. |
| `packages/backend/convex/knowledgeLlm.test.ts` | **29-04.** 29 tests: plan clamping by name, the plan-plus-gap totality property, the model-failure fallback, invented citations, cross-document excerpts, conflict survival, code-owned authority/freshness, the pin, and the structural containment scans. |
| `packages/contracts/skills/knowledge-query-planner.md` + `.../knowledge-synthesizer.md` | **29-04.** The canonical bodies (with the derived `.ts` constants in `packages/contracts/src/skills/`). Owned by `skill-registry.md` — read that playbook's Last-verified block before editing either. |

**Consumed, not owned** (their own playbooks apply — read those before touching them)

| File | Playbook | What Phase 29 uses |
|---|---|---|
| `packages/backend/convex/vaultGround.ts` | `vault.md` | `vaultGroundHydrated` — `{docIds, titles, origins, chunks, spine}`, caps 1500/doc and 8000 total. |
| `packages/backend/convex/vaultDrive.ts` | `vault.md` | `findInDrive` only. Never `importDriveFolder`. |
| `packages/backend/convex/gmail.ts` | `cockpit.md` | Read verbs only. **29-03 added `knowledgeQuery`** — a FIFTH read verb, separate from `search` (a contact resolver that never fetches a body). `escapeGmailQuery` neutralizes Gmail operator syntax; 25 ids listed, 5 bodies hydrated, each truncated to `SEARCH_CAPS.evidenceTextCharCap`; NO audit row, NO sender returned. |
| `packages/backend/convex/skills.ts` | `skill-registry.md` | `loadEffectiveSkill`, `publishUserCandidate`, `recordTenantEvalEvidence`, `activateTenantCandidate`, `rollbackTenantSkill`. |
| `packages/backend/convex/savedPrompts.ts` | `cockpit.md` | `save`/`list`/`remove` and the workspace pin menu. **Phase 29 extends the ROW, not this module.** |
| `packages/core/src/workflowPacks.ts` | `workflow-packs.md` | `WORKFLOW_PACK_IDS`, `PACK_SOURCE_LABEL`, `packPreflight`, `toolsForWorkflowPack`. |
| `packages/backend/convex/guardrails.ts` | `guardrails.md` | `preCall` / `recordSpend` — the budget gate every toolless call must cross. |
| `packages/backend/convex/hubspot.ts` | `connector-hubspot.md` | `readHubSpotDataset` ONLY, dataset `deals`. GET-only, allow-listed paths, a bounded `Projection`. Phase 29 never writes, never adds a path and never passes a query. |

## Dependencies & blast radius

Run `graphify query "knowledge search"` for the current subgraph. Couplings graphify cannot see:

- **`knowledgeSearch.ts` IMPORTS FROM `workflowPacks.ts`, and that direction is load-bearing.**
  `KNOWLEDGE_SOURCES` is `["vault","drive","inbox","crm-facts","support-desk"] satisfies readonly
  PackSource[]` — a named SUBSET of the one source registry, not a second one. Labels come from
  `PACK_SOURCE_LABEL`, not-landed unlocks from `MISSING_SOURCE_UNLOCK`, and `NOT_LANDED_SOURCES` is
  DERIVED as `KNOWLEDGE_SOURCES` intersected with `MISSING_PACK_SOURCES`. 29-01 originally forked
  the vocabulary and shipped `gmail` beside `inbox` and `crm` beside `crm-facts`, which meant a pin
  whose `sourcePreferences` said `inbox` could never select the mail search source and no code
  could translate between the two. `support-desk` was added to `MISSING_PACK_SOURCES` so the one
  registry carries the fifth member; `workflowPacks.test.ts`'s "no dead vocabulary" test accepts a
  source read by the search plane, which is where that is visible.
- **`SourceState` is `workflowPacks.ts`'s, and `KnowledgeSourceState["status"]` is proved equal to
  it at COMPILE TIME** (`_VOCABULARY_IS_SHARED` in `knowledgeSearch.ts`). The two SHAPES stay
  separate — `packPreflight` keeps the bare string because 30 landed eval fixtures and
  `PACK_SOURCE_PROBE_STATES` assert it — but the vocabulary is one. `@pikar/revenue`'s `Projection`
  is a THIRD statement of the same three states in another package; consolidate at merge.
- **`validateSourceRef` is an ALLOWLIST** (`/^[A-Za-z0-9._:/+=|~-]+$/`), the same charset as
  `@pikar/contracts`' `SAFE_REF`. It replaced a denylist copied byte-for-byte from
  `packages/revenue/src/contracts.ts` that contained NO space class — "Acme Corp Invoice.pdf"
  passed as an "id" while the docstring claimed whitespace was refused. `packages/revenue` still
  holds that copy; the Phase 28 lane owns that file, so consolidation is a merge-time job and is
  recorded as a `ponytail:` comment on the function.
- **No hash implementation lives in `@pikar/core`.** `canonicalCustomization` returns a deterministic
  STRING; the caller hashes it with `packages/backend/convex/lib/hash.ts` `contentHash` (SHA-256).
  A second hash implementation is exactly what that module exists to prevent.
- **THE SEARCH PLANE AND THE PACK PLANE ANSWER DIFFERENT QUESTIONS ABOUT LANDEDNESS, AND THEY
  DISAGREE ON `crm-facts` ON PURPOSE.** `MISSING_PACK_SOURCES` means *no agent-reachable read
  TOOL exists*, and its own docstring carries owner decision A (2026-08-23, binding): do NOT add
  read tools to close these. `KNOWLEDGE_ADAPTERS` in `knowledgeSearch.ts` means *no landed
  TOOLLESS adapter exists*. Phase 29's search plane is toolless by design — that is its whole
  safety argument — so a source can be searchable here while remaining, correctly and
  permanently, unreachable to a workflow pack's tool grant. `crm-facts` is exactly that as of
  2026-08-28 (Phase 28's `convex/hubspot.ts` landed a GET-only bounded CRM read).
  **`NOT_LANDED_SOURCES` was derived from `MISSING_PACK_SOURCES` until 29-03, which conflated the
  two questions.** `support-desk` is `null` on both planes — nothing landed for it at all.
  Evidence: `.planning/phases/29-unified-knowledge-and-routines/29-DEPENDENCY-EVIDENCE.md` §2 and
  the post-merge addendum of 2026-08-28.
- **Convex validator ↔ pure contract coupling.** `knowledgeSearches`' literal unions duplicate
  `KNOWLEDGE_SOURCES`, `CONFIDENCE_LABELS`, `AUTHORITY_CLASSES` and `FRESHNESS_LABELS` as literals
  because a Convex validator needs them at module load. Widening either side without the other
  fails `schema.test.ts` on insert. The `knowledgeSource` union is applied in FIVE places on that
  row — the three arms of `sources[]`, plus `claims[].evidence[].source` and
  `claims[].conflictEvidence[].source`. The last two were bare `v.string()` in the original 29-01,
  so a stored CITATION could name `notion` or `http://evil.example` while the coverage plane beside
  it could not; `schema.test.ts` now proves the refusal by insert and counts the five uses.

## Data flow

Landed today is only steps 0 and 8; the rest is the shape the later plans must build to.

0. Contracts frozen in `@pikar/core`; `knowledgeSearches` exists in the schema.
1. The user asks a question in the workspace.
2. A **toolless** planner call (blueprint.ts `deriveCandidates` shape: `getActiveSkill` →
   `guardrails.preCall` → `scanText` → `generateObject` → `priceUsage` → `guardrails.recordSpend`)
   proposes `{source, query}` pairs. **LANDED as of 29-04:** `knowledgeLlm.planKnowledgeSearch`.
   The `source` enum in its JSON schema is BUILT from `KNOWLEDGE_SOURCES` minus
   `NOT_LANDED_SOURCES`, so an unadaptered source is not in the grammar — and `clampSearchPlan`
   re-checks it anyway. A model-call failure falls back to a VAULT-ONLY plan (invariant 29).
3. `clampSearchPlan` re-checks every pair in code: closed source enum, one query per source,
   length cap, no remote address. `crm-facts`/`support-desk` come back as ready-made
   `unavailable/not_landed` states rather than plan entries. There is deliberately no `source_cap`
   rejection: one entry per DISTINCT source plus `maxSources === KNOWLEDGE_SOURCES.length` make it
   unreachable, and a rejection reason the code cannot produce is a state nobody can trust.
3b. **`clampEvidence` is the admission boundary.** Every adapter result crosses it before dedupe,
   synthesis or storage: `maxEvidencePerSource`, `maxEvidenceTotal`, `evidenceTextCharCap`,
   `labelCharCap` and `totalEvidenceCharCap` are enforced HERE and nowhere else. It reports which
   sources lost something so the caller mints `{status:"partial", reason:"cap"}` — a capped read is
   partial, never available. A coordinator that skips it puts an unbounded array on a Convex row:
   the schema validator imposes no length bound of its own.
4. Adapters run under `Promise.allSettled`. Every rejection becomes a named `KnowledgeSourceState`.
   One provider failure never erases a successful source. **Landed as of 29-03:**
   `knowledgeExternalSources.readInboxKnowledge` and `.readCrmKnowledge` (29-03),
   `knowledgeVaultDrive` (29-02). They return `{state, evidence}` and write to no plane at all.
5. `dedupeEvidence` collapses the same record read twice AND SAYING THE SAME THING, reports a ref
   that disagrees with itself as `conflicting`, and **cross-links** identical text from different
   records without deleting either.
6. A second **toolless** call synthesizes claims citing evidence ids. **LANDED as of 29-04:**
   `knowledgeLlm.synthesizeKnowledge`, which takes FENCED evidence blocks and returns
   `{summary, claims, unanswered}` and nothing else — there is no `authority`, `confidence`,
   `probability`, `freshness` or `score` property in its schema and `additionalProperties: false`
   forbids one, so those values are ABSENT rather than ignored (invariant 6, now structural).
7. `validateSynthesis` drops invented ids (and counts them), substring-verifies excerpts against the
   evidence *that claim cited*, keeps conflicts, and attaches authority/freshness from the table.
8. One `knowledgeSearches` row is written: answer + citations + source states, tenant-scoped.
9. The tool-bearing cockpit is told only counts. `redactedSearchEvent` is what the log plane gets.

Customization: form values → `validateCustomization` → `renderCustomization` → the Phase-21
`publishUserCandidate` seam (which always writes `status: "candidate"`) → eval → `activateTenantCandidate`
(an `ownerMutation`). Pin: `savedPrompts` row carrying `templateId`/`templateVersion`/`tenantSkillId`/
`customizationHash` → Run → an ordinary fresh cockpit turn.

## Invariants — what must never break

| # | Invariant | Why | Enforced by |
|---|---|---|---|
| 1 | **An unreachable source cannot carry a result count.** | "Reauth failed → zero results → nothing exists" is the failure this phase exists to prevent. | The `KnowledgeSourceState` union has no `returned` on the `unavailable` arm, and the Convex validator is a discriminated union that REFUSES the insert (`schema.test.ts`, "an UNAVAILABLE source carrying a count is REFUSED"). |
| 2 | **Aggregate coverage fails closed.** Zero requested sources is not "complete". | Asking nothing is not the same as answering everything. | `knowledgeSearch.test.ts`, "asking nothing is NOT complete". |
| 3 | **Dedupe never deletes a conflicting record, AND never reports one as a safe collapse.** `(source, sourceRef)` identity collapses ONLY when the normalized TEXT also matches; the same ref carrying different text is `conflicting` with its own count; identical text across *different* records is cross-linked. | A $40 rate and a $60 rate must not become one confident answer — and until the 29-01 repair, one ref reading $40 then $60 was filed under `duplicates` with `collapsed: 1`, so a renderer following the documented contract would drop the $60. | `dedupeEvidence` + six tests. MUTATION OBSERVED RED: key on `source\|sourceRef` without comparing `normalizeEvidenceText`. |
| 4 | **A model-invented evidence id is removed and counted.** A claim left with none becomes `unsupported`. | A citation list is not provenance. | `validateSynthesis`, mutations KS-04/KS-05/KS-06. |
| 5 | **An excerpt must be a substring of the evidence THAT CLAIM CITED.** An invalid excerpt drops the excerpt, not the claim. | A quote lifted from another document is a fabrication even though every character is real. | `validateSynthesis`, mutation KS-06. |
| 6 | **Authority, freshness and confidence are code-owned.** A model-supplied `authority`/`confidence`/`probability` is ignored. Confidence is a closed LABEL. | The model does not get to grade its own work. | `authorityFor`/`freshnessFor`/`searchConfidence`; `confidence` is a literal union in the schema so a number cannot be stored — and that union is now DERIVED from `CONFIDENCE_LABELS` (invariant 20). |
| 7 | **`agent_promoted` vault content is the WEAKEST authority class.** | The provenance-laundering defect class: the agent's own earlier output must never read back as the owner's own word. | `authorityFor` + mutation KS-19. |
| 8 | **The Blueprint `spine` is never search evidence.** | It is not a result and must not alter counts, no-match behaviour or citations. | `vaultGround.ts` returns it as a separate field; `searchVaultSpine.test.ts` guards it. **Phase 29 must not put it in the evidence array.** |
| 9 | **Labels/excerpts/prose live on the CONTENT plane; audit gets refs and counts.** | CLAUDE.md §4 — the log must not become a PII honeypot. | `redactedSearchEvent` is a pure function so the ban is testable without a database; `knowledgeSearch.test.ts`, "no label, snippet, title, query or prose can reach it". |
| 10 | **An undeclared customization key is refused before its value is read.** | `tools` is not a field, so it is not a question of what `tools` contains. This is the real firewall; the content scan is the second lock. | `validateCustomization`, mutations WC-01/WC-02. |
| 11 | **`material` and `requiresEval` are separate booleans.** A tone-only edit is not material but STILL requires eval. | Collapsing them is how a "cosmetic" edit skips its gate. | `classifyCustomizationChange`, mutations WC-08/WC-17. |
| 12 | **A stale base version is refused, never merged.** | Silent last-write-wins is the version of that failure nobody notices. | `checkBaseVersion`, mutation WC-10. |
| 13 | **A pinned rerun mints a fresh correlation every run.** | It must create a fresh request and cross current approval, connection, budget and active-version gates — never replay a plan. | `freshRunCorrelation`, mutation WC-12. |
| 14 | **Activation stays owner-gated in Phase 21's existing seam.** Phase 29 adds NO second activation path or status flip. | One choke point or none. | `skills.ts` `activateTenantCandidate` / `rollbackTenantSkill` are `ownerMutation`. |
| 15 | **NO RECURRENCE STORAGE.** No `routines`/`routineRuns` table, no cron text, no `nextRunAt`, no cadence, no IANA timezone rule, no scheduler id on a pin, no standing approval, no run-history table. | Plan 29-11's decision-and-proof gate has not been passed. Inert schema invites the UI that assumes it. | `schema.test.ts` "recurrence storage is structurally absent" — table-name scan over the parsed schema, field-name scan over the source, and a per-table scan of `savedPrompts`. Three pre-existing ONE-SHOT exceptions are named in that test on purpose: `optimizerConfig.lastRunAt`, `plans.scheduledFunctionId`, `pendingTimeouts.scheduledId`. |
| 16 | **A not-landed gap is `not_landed`, never a stub adapter and never an empty success**, and the sentence also names the UNLOCK. Since 29-03 that is `support-desk` alone. | Owner ruling, 2026-08-27. Naming a gap without naming its unlock leaves a complaint instead of a next step. | `NOT_LANDED_SOURCES` (derived) + `clampSearchPlan` + `renderSourceGap` reading `MISSING_SOURCE_UNLOCK`. MUTATION OBSERVED RED: return the bare sentence for `not_landed`. |
| 17 | **EVERY `SEARCH_CAPS` ENTRY IS ENFORCED BY CODE.** Six of eleven were enforced by nothing while `schema.ts` cited them as bounds. | A cap nothing applies is a documented invariant with no enforcement, and the 29-0x adapter that trusts the comment puts an unbounded array on a Convex row. | `clampEvidence`/`clampSearchPlan`/`validateSynthesis`, plus a source scan (`NO CAP IS DEAD`) that fails when a key becomes declaration-only. Two by-construction exceptions are named in that test. Same rule and same test for `CUSTOMIZATION_CAPS`. |
| 18 | **ONE SOURCE VOCABULARY.** `KNOWLEDGE_SOURCES satisfies readonly PackSource[]`; labels and unlocks come from `workflowPacks.ts`. | A pin's `sourcePreferences` are `PackSource[]`; a forked search vocabulary makes a preference unable to select a source with no code that could translate. | `satisfies` at compile time, plus "every knowledge source IS a PackSource" and the derived `NOT_LANDED_SOURCES` test. |
| 20 | **THE CONVEX ENUMS ARE THE `@pikar/core` ENUMS, DERIVED — NOT HAND-COPIED.** `knowledgeSource`, the unavailable/partial reasons, the authority classes, the freshness labels and the confidence labels are all built by `schema.ts`'s `literals(...)` helper from the exported const array. | They were hand-copied, and three separate narrowings of them each left the whole backend suite AND the typecheck green: dropping `support-desk` from the source union, `unplanned` from the unavailable reasons, `agent_authored` from the authority classes. Nothing crossed the package boundary. The cost is exactly the honest-gap row this phase exists to produce: core can construct `{status:"unavailable", reason:"not_landed", source:"support-desk"}` and the validator would refuse it at INSERT time, at runtime, with nothing red in CI. | One list, not two. Falsified by `schema.test.ts`, "the Convex enums are the @pikar/core enums, proved by storing every member" — it inserts EVERY member of every core constant, plus a scan that fails if any member reappears as a hand-written `v.literal` inside `knowledgeSearches`. MUTATIONS OBSERVED RED: hand-write each of the three unions back minus one member. |
| 21 | **`groundedSourceProps` PROJECTS VAULT EVIDENCE ONLY into `docIds`.** Non-vault citations come back in `nonVault` and must be rendered without a vault drill-in. | `docIds[i]` is not a neutral id: `cards.tsx`'s `GroundedSources` -> `VaultDocButton` -> `VaultDocModal` OPENS it as a vault document. (The three line numbers this row used to carry had drifted by 46, 81 and 38 lines; symbols do not rot.) The first version mapped every source's `sourceRef` in, so a Gmail message id rendered a clickable control that opens a document that does not exist — committing, one plane over, the exact naming lie this function's own JSDoc rejects for `citationDocId`. | `knowledgeSearch.test.ts`, "NO NON-VAULT REF EVER REACHES docIds". MUTATION OBSERVED RED: drop the `.filter((e) => e.source === "vault")`. |
| 22 | **`savedPrompts.sourcePreferences` MEMBERSHIP is closed by the Convex validator** — the full `PackSource` vocabulary, derived, not `v.array(v.string())`. | It was `v.array(v.string())` under a comment reading "Bounded `PackSource` names", and a convex-test probe stored `["notion","http://evil.example","sharepoint"]` verbatim: a documented invariant with no enforcement, one field over from where the identical hole had just been closed on `claims[].evidence[].source`. | `schema.test.ts`, "sourcePreferences refuses a source the product does not have — a WRONG VALUE, not a wrong type". MUTATION OBSERVED RED: reopen to `v.optional(v.array(v.string()))`. **LENGTH is NOT bounded** — see Known gaps. |
| 19 | **A PIN NAMES THE EXACT `tenantSkills` ROW, never a (name, version) pair.** | Two tenants can hold the same name AND version — which is why `recordTenantEvalEvidence` keys on the row id, and why the landed rail is `Record<string, Id<"tenantSkills">>` (`dispatchArgs` in `dispatch.ts`; `skill-registry.md`'s "The pin door IS open" lists every declaring site). | `WorkflowPin.tenantSkillId: TenantSkillRef \| null`, `pinIdentity`/`pinMatchesActive` compare it, and `savedPrompts.tenantSkillId` is `v.id("tenantSkills")` — proved by INSERT, not by a substring scan. MUTATIONS OBSERVED RED: relax to `v.optional(v.string())`; drop the id from `pinIdentity`. |
| 23 | **LANDEDNESS ON THE SEARCH PLANE IS DERIVED FROM `KNOWLEDGE_ADAPTERS`, WHICH NAMES A MODULE AND A VERB — never from `MISSING_PACK_SOURCES`, and never from a boolean.** | The two planes ask different questions (see "Dependencies & blast radius"). A boolean would be a claim with nothing to check it; the module path is what makes the claim falsifiable from outside the pure package. Moving `crm-facts` into `REACHABLE_PACK_SOURCES` to remove the disagreement would silently reverse a binding owner decision and tell every workflow pack a CRM tool exists. | `knowledgeSearch.test.ts` ("THE TWO PLANES ANSWER DIFFERENT QUESTIONS", pinned in BOTH directions) + `knowledgeExternalSources.test.ts`, which reads the named modules off disk. MUTATIONS OBSERVED RED: hand-write `NOT_LANDED_SOURCES`; derive it from `MISSING_PACK_SOURCES` again; null the `crm-facts` adapter; point `support-desk` at a module that does not exist; rename a verb the module does not export; delete `crm-facts` from `MISSING_PACK_SOURCES`. |
| 24 | **AN ADAPTER AND ITS SOURCE'S SEARCHABILITY LAND TOGETHER, IN BOTH DIRECTIONS.** A source may not be reported landed with no adapter behind it, and an adapter may not land for a source the search plane still calls `not_landed`. | The first is the lie this phase exists to prevent; the second is dead code behind an invisible gap. | `EXTERNAL_KNOWLEDGE_READERS` in `knowledgeExternalSources.ts` is scanned against `NOT_LANDED_SOURCES` both ways, plus a totality check that every landed non-vault/drive source has a reader. MUTATION OBSERVED RED: add a `support-desk` reader while `support-desk` has no adapter. |
| 25 | **THE EXTERNAL ADAPTERS WRITE NOTHING TO ANY GOVERNANCE PLANE.** No audit row, no telemetry row, no dead letter, no `agentSteps` row, no `payload:` literal, no direct `fetch`. | A unified search reads several sources and owes exactly ONE refs-only `knowledge.searched` event, owned by the 29-06 coordinator. Per-source events would let the log plane infer the shape of the question from how many rows appeared — and a subject line or a mail body in a payload is the §4 PII honeypot. | A source scan in `knowledgeExternalSources.test.ts` (the `briefings.ts` content-plane idiom), plus behavioural assertions that `audit`/`agentSteps`/`telemetry`/`deadLetters` are EMPTY after a read carrying a prompt injection. |
| 26 | **AN UNREACHABLE OR PARTIAL EXTERNAL READ IS NAMED, NEVER SHRUNK.** `unavailableResult` is the only constructor of an unavailable state in the adapters and always returns zero rows with it; a further provider page, a hydration cap, a truncated body, a per-source evidence cap or a dropped malformed ref each produce `partial` with a reason. A provider's own `because`/`missing` string is NEVER forwarded onto the closed enum. | Presenting five of twenty-five messages, or eight of two hundred deals, as a complete read is the same lie as presenting an unreachable CRM as an empty one. `reason` reaches a stored row, so it must stay a code-owned enum (CLAUDE.md §4). | `knowledgeExternalSources.test.ts`. MUTATIONS OBSERVED RED: rewrite `unavailableResult` as `{available, returned: 0}`; force `lost` to `null`; narrow the partial condition; forward the credential layer's raw `revoked` onto the enum; remove the per-source slice. |

| 27 | **A NOT-LANDED SOURCE IS `not_landed` WHETHER OR NOT THE PLANNER NAMED IT.** `settlePlan` decides the reason from the ADAPTER REGISTRY, never from what the model happened to say. | `clampSearchPlan` can only mint `not_landed` for a source the model PROPOSED, so relying on it alone made `support-desk` read as `unplanned` — "we chose not to look there" — on every ordinary run. That is a materially softer and different sentence from "this product cannot look there yet, and here is what would unlock it", and it silently erases the one honest-gap the phase's own owner ruling exists to preserve. Found by a test, not by review. | `knowledgeLlm.test.ts`, "EVERY source is accounted for exactly once across plan + skipped". MUTATION OBSERVED RED: hardcode `reason: "unplanned"` (2 tests). |
| 28 | **THE RAW MODEL OBJECT NEVER LEAVES `knowledgeLlm.ts`.** Every path — live, offline fixture — converges on `validateSynthesis` before returning, and the planner's every path converges on `clampSearchPlan`. | A caller that could receive an unvalidated claim would eventually be written, and "the coordinator validates it" is a convention, not a guarantee. Making it structural means there is no unvalidated shape to hand out. | `knowledgeLlm.test.ts` drives invented ids, cross-document excerpts and conflicts THROUGH the action, not through the pure function. MUTATIONS OBSERVED RED: replace `validateSynthesis` with a pass-through (4 tests); bypass `clampSearchPlan` for the plan (6 tests). |
| 29 | **A PLANNER FAILURE DEGRADES TO THE TENANT'S OWN DOCUMENTS, NEVER TO AN EMPTY SUCCESS.** The fallback is a vault-only plan carrying the user's own words, plus an honest `unplanned`/`not_landed` state for every other source, and `fallback: true` on the result. | "The planner errored, so we searched nothing, so there is nothing" is the same lie as an unreachable source with a zero count — one plane up. | `knowledgeLlm.test.ts`, "a planner FAILURE degrades to the tenant's OWN documents", driven through the REAL `catch` by the `SMOKE::knowledge-plan::FAIL` directive. MUTATION OBSERVED RED: return an empty plan from the fallback. |
| 30 | **AUTHORITY, CONFIDENCE, FRESHNESS AND RESULT LIMITS HAVE NO SCHEMA FIELD.** Neither `jsonSchema` declares one and both objects carry `additionalProperties: false`. | Invariant 6 said the model "does not get to grade its own work", but it was enforced by nobody reading a field the model was free to emit. Absent-by-grammar is a different guarantee from ignored-by-convention, and it is the one that survives a body edit. | `knowledgeLlm.test.ts`, "NEITHER SCHEMA HAS A FIELD FOR AUTHORITY, CONFIDENCE OR A LIMIT" (comments stripped, with a positive control). MUTATION OBSERVED RED: add `confidence: { type: "number" }` to the synthesis schema. |
| 31 | **BOTH KNOWLEDGE CALLS ARE PINNABLE, AND A BAD PIN FAILS RATHER THAN FALLING BACK.** `skillVersion` loads that EXACT version through `getSkillVersion`; a version that does not exist throws `NO_SUCH_SKILL_VERSION`. | This is the ONLY thing that can ever make the two GATED bodies certifiable: an eval run that silently measured the ACTIVE body while claiming to certify a candidate would record passing evidence for the wrong prompt. | `knowledgeLlm.test.ts`, "THE PIN REACHES THE LOAD" (both actions) and "a pin naming a version that does not exist FAILS". MUTATION OBSERVED RED: make the pinned branch load the active row. |
## How to change safely

**Adding a source** (only when its adapter genuinely lands): add it to `workflowPacks.ts`'s
`REACHABLE_PACK_SOURCES` or `MISSING_PACK_SOURCES` **first** (with its `PACK_SOURCE_LABEL`, and its
`MISSING_SOURCE_UNLOCK` + `MISSING_SOURCE_MENTIONS` if missing), then to `KNOWLEDGE_SOURCES` and
`SOURCE_AUTHORITY`. Do **not** touch `schema.ts`'s `knowledgeSource` — it is DERIVED from
`KNOWLEDGE_SOURCES` (invariant 20) and follows on its own. Do NOT edit
`NOT_LANDED_SOURCES` — it is derived from `KNOWLEDGE_ADAPTERS`. **When an adapter genuinely lands,
add its module + verb to `KNOWLEDGE_ADAPTERS` and a reader to `EXTERNAL_KNOWLEDGE_READERS` in the
same change** (invariant 24), and leave `MISSING_PACK_SOURCES` alone unless an agent-reachable read
TOOL also landed — those are different questions (invariant 23). Keep `SEARCH_CAPS.maxSources === KNOWLEDGE_SOURCES.length` (a test pins it).
Most likely to violate: invariants 1, 16 and 18.

**Adding or changing a cap**: add the enforcement in the SAME change, or do not add the cap. The
`NO CAP IS DEAD` scans in both test files fail on a declaration-only key. If a cap is genuinely
unnecessary, DELETE it and fix every comment that cited it. Most likely to violate: invariant 17.

**Adding an authority class or confidence label**: change the `@pikar/core` const ONLY.
`schema.ts` derives both (invariant 20), so there is nothing to keep in sync — and
re-introducing a hand-written `v.literal` copy is itself red. Most likely to violate:
invariants 6 and 20.

**Adding a customization field kind**: extend `CUSTOMIZATION_FIELD_KINDS`, add the validation arm,
the `renderValue` arm, and decide explicitly whether it belongs in `MATERIAL_FIELD_KINDS`. Most
likely to violate: invariants 10 and 11.

**Touching `savedPrompts.ts`**: read `cockpit.md` first — that module is owned there, and its own
test bans `ctx.scheduler`, `cron`, `schedule`, `recurrence`, `nextRunAt`, `trigger` and `routines`
from the file. **Before the first lineage-bearing pin is written**, fold ALL FIVE lineage fields —
`templateId`, `templateVersion`, `tenantSkillId`, `customizationHash` AND `sourcePreferences` —
into `textHash`. (`sourcePreferences` was missing from this list until the 29-01 repair: two pins
differing only in preferred sources are two different runs. `@pikar/core`'s `pinIdentity` already
covers all five and is the intended hash input.) `textHash` is currently computed
from the TEXT ALONE, so two pins of the same words against different customizations would collide on
`by_tenant_textHash` and the second `save` would silently return the first row. Unreachable today
(nothing writes those fields yet), recorded because 29-01 added the field that makes it reachable.

**Touching the Gmail path**: the toolless firewall enforced by `llmRedaction.test.ts` is
**BODY-scoped, not CONTENT-scoped** — sender display names and subject lines are deliberately
admitted into the tool-bearing loop today. That is the known boundary. Do not silently widen it and
do not assume it is narrower than it is.

**If the recurrence gate ever passes**: recurrence tables are a *new* plan, a *new* ADR (027+), and
a rewrite of invariant 15 in this file — not an edit to a schema comment.

## How to verify

`pnpm --filter <pkg> test -- <filters>` **does not filter**: pnpm swallows the `--`. `cd` into the
package.

| Command | What it proves |
|---|---|
| `cd packages/core && pnpm vitest run knowledgeSearch workflowCustomization` | 187 unit tests over the pure contracts. |
| `cd packages/core && pnpm typecheck` | `noUncheckedIndexedAccess` holds across the new modules. |
| `cd packages/backend && pnpm vitest run convex/schema.test.ts` | 41 tests: the widening proved by insert, the core->storage enum seam proved by inserting EVERY member of every core constant, the header index, and recurrence absence. |
| `cd packages/backend && pnpm typecheck` | The schema compiles against `_generated`. |
| `cd packages/backend && pnpm vitest run skills schema` | The Phase-21 seam this phase consumes is still intact beside the widening. |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | §9 watcher. **Read stdout** — `"decision":"block"` means FAILED, empty means passed. Never read its exit code; every path is `exit(0)`, and run bare it hangs forever on stdin. **RUN IT WHILE THE TREE IS DIRTY.** With no baseline file for the session id it compares against `HEAD`, so running it after committing on a clean tree examines ZERO files and its silence means nothing. |

**Not verifiable here (no live deployment, no spend):** every adapter, coordinator and UI gate from
plans 29-02 onward, and every recurrence live proof in 29-11.

## Operational notes

- No new env var, no new dependency and no seed data. `@js-temporal/polyfill` is installed **only**
  if the recurrence gate selects enable-safe.
- **`knowledgeSearches` is already wired into tenant export and deletion.** It is classified
  `tenant_owned` in `packages/core/src/tenantData.ts`, and `tenantDelete.ts`/`tenantExport.ts` walk
  `deletableTables()` — so classification IS the wiring, and no later plan has to remember. That
  walk calls `.withIndex("by_tenant")` on every name it returns, which is why the table carries a
  bare `by_tenant` as well as `by_thread`. Reclassifying it would mean removing that index in the
  same commit, and vice versa. `tenantData.test.ts`'s table-count tripwire moved 46 -> 47.
- The classification is deliberately the OPPOSITE of `workflowPackEvents` (`audit_immutable`): a
  pack event has nowhere to put prose, a search row holds the user's question, answer and document
  titles. The refs-only measurement plane is `redactedSearchEvent`, not this table.
- The whole `knowledgeSearches` document is kilobytes **because `clampEvidence` and
  `validateSynthesis` make it so** (`SEARCH_CAPS`: 5 sources, 12 claims, 24 evidence at 8 per source
  and 1500 chars each, 8000 chars total, 200-char labels, 300-char excerpts). The Convex validator
  imposes NO length of its own — the array validators are unbounded — so the bound is the writer's
  and a writer that skips `clampEvidence` has no bound at all. That is why citations are an array on
  the row rather than a second table — one read renders the entire card.
- **The citation field names are `{source, sourceRef, label}` + `excerpt`, and that is deliberate.**
  This is the third citation shape in the repo (`vaultSources` `{docIds, titles, count}`;
  `evaluations.findings` `{citationDocId, citationTitle, citationExcerpt}`). It keeps `sourceRef`
  rather than `citationDocId` because a knowledge-search ref is a provider id across five planes and
  only one of the five is a vault `docId` — storing a Gmail message id in a field named
  `citationDocId` is how it later gets joined against `vaultDocuments`. The mapping is CODE, not
  prose: `groundedSourceProps` in `@pikar/core` returns exactly the `{docIds, titles, count}` props
  the landed `GroundedSources` component and the `vaultSources` row already take, so one card serves
  both planes and no caller writes a rename shim. **It projects VAULT evidence only**
  (invariant 21) and hands back everything else in `nonVault`, because `docIds[i]` is opened as a
  vault document by `VaultDocButton`/`VaultDocModal`. A 29-0x renderer must give `nonVault` a
  non-vault affordance.

## Known gaps & deferred work

| Gap | Where the upgrade path is recorded |
|---|---|
| **Nothing writes `knowledgeSearches` yet.** The table, the contracts and the tests exist; the coordinator does not. | Plans 29-02 … 29-06. |
| **THE EVAL GATE ON `knowledge-query-planner` AND `knowledge-synthesizer` IS NOT YET CLEARABLE.** Both are in `GATED_SKILLS`. `seedSkills`' `rows.length === 0` branch lands them at v1 `active`, so nothing is blocked today — but the FIRST BODY EDIT mints a candidate `activateSkill`'s EVAL_GATE holds until a green `pnpm eval:golden --skill <name>@N` run, and `run-eval-golden.mjs` drives `llm:runCockpitAgent` and nothing else. **Do not edit either body until 29-06 lands.** | **PLAN 29-06 OWES THIS**: a cockpit-side knowledge tool, `skillVersions` threaded into `knowledgeLlm`, and at least one golden fixture that drives a knowledge search. Half the rail is already built — both actions take a `skillVersion` pin and `knowledgeLlm.test.ts` proves the pinned body is what answers (invariant 31). Recorded on both constants in `packages/contracts/src/skill.ts`, on the `SEEDS` rows, and in `skill-registry.md`. |
| ~~**NOTHING CALLS `knowledgeLlm` YET.**~~ CLOSED by 29-06: `knowledgeSearch.search` is the coordinator, it writes `knowledgeSearches`, and the offline seams are gated on `offlineSeamAvailable()`. The UI is still 29-09. | Plan 29-06 (landed); UI 29-09. |
| **`knowledgeSearches.runId`'s comment overstates what 29-04 built.** It reads "the run correlation the toolless planner/synthesizer calls spent against", but each action MINTS ITS OWN per EXECUTION (`blueprint.ts`'s `deriveCandidates` reasoning: re-entering an action re-runs the model call, so the second charge is real and needs its own ledger row; a stable correlation would put the ledger BELOW the limiter). So there are two spend correlations per search, `knowledge:plan:<runId>` and `knowledge:synth:<runId>`, and neither is the coordinator's own row id. | Both actions RETURN their `runId`. 29-06 should store the coordinator's own correlation in `knowledgeSearches.runId` and, if the join matters, keep the two returned ids beside it. `schema.ts` was not edited from here — it is 29-01's file and the repo's highest-collision one. |
| `ponytail:` **`SUMMARY_CHAR_CAP` (1,200) lives in `knowledgeLlm.ts`, not in `SEARCH_CAPS`.** It is not a search bound — it is how much model prose may reach a stored row — and `@pikar/core`'s cap set is covered by a `NO CAP IS DEAD` scan that demands an enforcement site IN THAT PACKAGE. Ceiling: a cap outside the one registry of caps. | Enforced at the only place a summary is produced, and covered behaviourally (the offline fixture echoes the question so a 5,000-character input drives the cap; `1_200` is a literal). Upgrade path: move it into `SEARCH_CAPS` when `@pikar/core` gains a summary-shaping function to enforce it. |
| `ponytail:` **`literals()` is a two-line copy of `schema.ts`'s private helper.** Ceiling: two identical validator helpers over one boundary. | Comment on the function. Upgrade path: export ONE from `convex/lib/` when a third caller appears — not from `schema.ts`. |
| **The planner fallback passes the question through UNSANITIZED** (truncated to `queryCharCap`). A question containing a URL is refused by `clampSearchPlan`'s remote-address rule, so the vault-only fallback returns an empty plan for it. Deliberate: the refusal is visible as a `remote_url` rejection instead of being silently repaired. | `ponytail:` comment on `fallbackPlan`. Upgrade path: strip addresses THERE, never inside `clampSearchPlan` — that function's job is to refuse, not to rewrite. |
| **`support-desk` is `not_landed`** — nothing landed for it on either plane. `crm-facts` STOPPED being not-landed on 2026-08-28 when Phase 28's HubSpot rail merged. | `29-DEPENDENCY-EVIDENCE.md` §2, the post-merge addendum, and invariant 23. |
| **The CRM read is HubSpot `deals` only, and it ignores the planner's query.** `HUBSPOT_READ_PATHS` has no search endpoint (CRM Search carries its own rate limit and needs its own decision, 28-05), so a CRM knowledge read is a 90-day windowed list of the 8 most recently updated deals and the synthesis model filters them. QuickBooks read, Stripe, PayPal and any support desk are absent. | `ponytail:` comments in `knowledgeExternalSources.ts`. Upgrade path: add CRM Search to the allow-list with its own budget, or add datasets, in a plan that owns `connectorFetch`. |
| **The inbox adapter returns NO sender**, so an answer cannot say "Sarah said X". Deliberate: the landed toolless firewall is BODY-scoped, so senders and subjects already reach the tool-bearing briefing loop, and Phase 29 must not widen that. | `ponytail:` comment on `KnowledgeMailMessage`. Upgrade path: a server-side sender table addressed by index, the `buildRecipientView` idiom. |
| **Inbox hydration selects by RECENCY, not relevance** — Gmail's own newest-first list order, top 5 of up to 25 matches. | `ponytail:` comment in `gmail.knowledgeQuery`. Upgrade path: fetch metadata for all listed ids and rank in pure code, at 5x the quota. |
| **`savedPrompts.textHash` collision** for two pins of the same text under different customizations. | "How to change safely" above; must be fixed in plan 29-08 before the first lineage-bearing pin. |
| **`USER_AUTHORABLE_SKILLS` is a closed three-name allowlist** and does not yet include the six workflow packs. Widening it is a plan-29-05 decision with eval consequences. | `29-DEPENDENCY-EVIDENCE.md` §1.3. |
| `ponytail:` no hash function in `@pikar/core` — dedupe compares normalized strings directly. Ceiling: a corpus larger than `totalEvidenceCharCap`. | Header comment of `knowledgeSearch.ts`. |
| `ponytail:` `validateSourceRef` and `packages/revenue/src/contracts.ts` hold two shape rules for one §4 boundary, and revenue's is the laxer denylist form. The Phase 28 lane owns that file, so it cannot be edited from here. Ceiling: two rules, one boundary. Upgrade at merge: delete revenue's copy, import this one. | `ponytail:` comment on `validateSourceRef`. |
| `ponytail:` `KnowledgeSourceState` and `packPreflight`'s `SourceState` are two SHAPES over one vocabulary. Ceiling: a caller that needs both must switch on `status` twice. Upgrade path: widen `SourceState` into the reason-carrying object and migrate `packPreflight` + the 30 landed eval fixtures in one change. | Doc comment on `KnowledgeSourceState`. |
| **The `mediaJobs.provider` reflow in commit `1e914f9` was not reverted.** It is an unrequested formatting-only edit outside Phase 29's blast radius, and the audit was right to flag it — but `biome@2.5.3` at `lineWidth: 100` REQUIRES the collapsed single line (verified: reverting it makes `biome format packages/backend/convex/schema.ts` red). Reverting would ship formatter-red code that the next save flips back. | 29-01-SUMMARY.md, "deliberately not fixed". |
| **`sourcePreferences` array LENGTH is unbounded at the storage boundary.** Membership is closed (invariant 22); a Convex validator has no array-length bound, so 10000 repeats of `"vault"` is storable. Claiming a length bound in a comment is the defect invariant 22 exists to record, so it is recorded here instead. | `ponytail:` comment on the field. The real ceiling is `CUSTOMIZATION_CAPS.maxValuesPerField` (8) in `validateCustomization`; there is no writer of this field yet. Upgrade path: clamp in the `savedPrompts` mutation when plan 29-08 writes the first pin, and assert the refusal there. |
| **`packages/backend/convex/schema.ts` is NOT watched by the §9 hook.** It is registered under `watch._unassigned` — explicitly acknowledged rather than left as a silent hole. | `watch.json` prefixes are per-file and `schema.ts` holds all 47 tables, so assigning it to this playbook would demand a knowledge-search bump for every unrelated table edit repo-wide — noise that trains readers to ignore the hook. The Phase-29 tables' real gate is `schema.test.ts`, which IS watched here and which now fails on enum drift, header drift and value drift. |
| **Recurrence is entirely deferred**, by decision, not by omission. **CLOSED as a decision on 2026-08-29:** `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md` records `decision: defer` and `packages/backend/scripts/check-routine-gate.mjs --validate-decision` is what permits it. `--eligibility` exits NON-ZERO today (11 rows not `pass`; `oauth-expiry-reauth` and `dst-boundary` carry `automated` where `live` is required), so `enable-safe` was never offerable. | Plan 29-11's decision record; invariant 15; the 2026-08-29 section at the foot of this file. |

## Plan 29-05, Task 1 — the six APPROVED PACK TEMPLATE schemas (2026-08-28)

`workflowCustomization.ts` gained the product half of ROUT-01: the closed field list a tenant may
actually fill in for each Phase 27 workflow pack. Everything that was already here is machinery
tested against a hand-written fixture; these are the six schemas a user can really reach.

**Invariant 32 — the offered sources are DERIVED from the pack's own operation matrix.**
`packReadableSources(templateId)` walks `WORKFLOW_PACKS[templateId].operations`, keeps the
`existing` rows whose `reads` is not `null`, deduplicates and preserves manifest order. A
hand-written list beside the manifest would let a schema offer `crm-facts` — a checkbox promising a
read no tool performs — and nothing would catch it. Same "derive it or it drifts" rule
`WORKFLOW_PACK_SKILL_NAMES` and `toolsForWorkflowPack` already follow.
*Mutations RED:* dropping the `reads === null` skip (a produce-only `saveAsDocument` row becomes a
"source"); dropping the `state !== "existing"` skip (every `missing` plane becomes offerable);
replacing `sources` with a four-name literal.

**Invariant 33 — a preference over ONE source is not offered at all.** `brand-review` reads only
the vault, so it has no `source_preference` field. The other five do. The test asserts BOTH halves,
so a schema that never offers preferences cannot pass by accident.
*Mutation RED:* `sources.length > 1` → `> 0`.

**Invariant 34 — the offered key vocabulary is a pinned literal set of ten**, and none of them is
capability-shaped. `business_terms`, `tone`, one threshold per pack (`priority_count`,
`campaign_weeks`, `reply_max_words`, `brief_max_points`, `sop_max_steps`, `review_max_findings`),
`preferred_sources`, `extra_guidance`. A key matching
`/tool|mcp|server|url|endpoint|key|token|secret|auth|code|script|command|prompt|body|model|webhook|env/i`
fails the suite. Adding an eleventh key is therefore a deliberate act with a test to update.
*Mutation RED:* renaming `business_terms` to `business_prompt`.

**Invariant 35 — layer 1 is proved by ORDERING, not by a count.** The refusal test submits five
capability-shaped keys (`tools`, `mcpServers`, `apiKey`, `body`, `authoredBody`) whose VALUES would
each independently trip layer 2's content scan (a URL, an `sk-` key, `${`, `require(`). All five
come back `unknown_field` and none comes back `forbidden_content` — which is only possible if the
undeclared key was refused before its value was ever looked at. A companion test proves layer 2 is
still live on a DECLARED free-text field, so the pair cannot both be satisfied by a dead scan.

**Invariant 36 — the schema knows its template version but the rendered body does not.**
`customizationSchemaFor(templateId, templateVersion)` echoes the version it was handed; the version
is NOT validated in `@pikar/core`, which has no way to know which pack version is live. The Convex
adapter reads the global ACTIVE pack row and refuses a mismatch — the only place that question can
be answered honestly. The rendered body is therefore identical across two template versions while
`canonicalCustomization` differs (`template=business-pulse@4` vs `@5`), which is exactly what makes
a template republish a material change without churning the stored body.
*Mutations RED:* hardcoding `templateVersion: 1`; moving the instruction block ahead of the
threshold (the rendered body is pinned as one exact literal string).

**Invariant 37 — `resolveWorkflowPack` is the template gate, reused not re-implemented**, because
it uses `Object.hasOwn`: `"__proto__"` and `"constructor"` are refused rather than resolving to
something on `Object.prototype`.
*Mutation RED:* swapping it for `templateId in WORKFLOW_PACKS`, which walks the prototype chain and
resolves both.

**One tone vocabulary, four words** (`plain`, `warm`, `formal`, `direct`), shared by all six packs
and deliberately NOT the `style-direct` / `style-coaching` / `style-concise` registry overlays —
those are separate skill BODIES with their own activation story, and selecting one from a form
field would be a body swap wearing a dropdown.


## Plan 29-06 — the COORDINATOR, and where each bound is finally enforced (2026-08-28)

`packages/backend/convex/knowledgeSearch.ts` composes the wave-2 adapters and the two toolless
model calls into one cited tenant search. It owns no honesty rule of its own — every one lives in
`@pikar/core/knowledgeSearch` and is mutation-tested there — only the ORDER.

**Invariant 38 — the RUN-level clamp is here, and the per-source states are minted AFTER it.**
The adapters clamp at `scope: "source"` because an adapter that cannot see the other four cannot
spend a shared budget honestly. The coordinator is the first place the UNION exists, so
`maxEvidenceTotal` and `totalEvidenceCharCap` bind here, BEFORE `synthesizeKnowledge` is called and
therefore before anything is billed. Every `returned` is then re-computed from what survived the
cut, so a state can no longer report eight rows when three reached the model.
*Mutations RED:* `clampEvidence(corpus, "run")` -> `"source"`; returning `state` unchanged from
`remintState`; taking `searchedGapCount` from the PRE-clamp reads (that last one was a REAL DEFECT
the test caught, not a synthetic mutation).

**Invariant 39 — the dedupe baseline, not the adapter's count, decides "partial".**
A row absorbed as an exact duplicate is the same record read twice, not something a cap took away.
`remintState` compares the kept count against the DEDUPED corpus, so collapsing a duplicate leaves
an `available` read `available`. Only a row lost to a run bound turns a source `partial/cap`, and
`provider_error` still outranks `cap` (the `settleRead` ordering).

**Invariant 40 — a REJECTED adapter promise is a bug, and is surfaced as one.**
Since the wave-2 blocker fix every adapter returns its governed `unavailable` state as DATA, so
`Promise.allSettled`'s rejected arm means something threw that was not supposed to. `adapterOutcome`
turns it into `unavailable/provider_error` — a named gap carrying zero rows, because
`unavailableRead` is the only constructor of that arm and the arm has no `returned` field — and the
coordinator counts it into `adapterCrashCount` so the bug is visible on the log plane.
*Mutation RED:* a rejection returning `{available, returned: 0}`.
*Stated limit:* the FULFILLED branch of `adapterOutcome` is what every behavioural test in this
feature runs through, which is what binds the function to the handler. The REJECTED branch has no
reachable driver today (all four adapters catch) and is exercised directly.

**Invariant 41 — all-empty and all-unavailable are different rows.**
`searchedGapCount` counts gaps among the sources a read was ACTUALLY attempted against, read off the
re-minted states — **and a run that attempted NOTHING reports every source as a gap, not zero.**
The exact invariant, and it is now enforced rather than described: *zero ⟺ at least one source was
searched AND every searched source answered in full*. `renderSourceGap` is the pure function that
turns each state into the user's sentence; **it has no caller yet** — 29-09's panel is the renderer.
*(Corrected in remediation: reading the count off the attempted set alone returned 0 for an empty
plan, i.e. five unavailable sources and nothing read, which is indistinguishable from "we looked
everywhere and there is nothing" — the one pair the field exists to tell apart.)*

**Invariant 42 — the tool-bearing loop cannot reach the knowledge plane AT ALL.**
There is no cockpit tool. The user surface is 29-09's `KnowledgeSearchPanel`, which calls
`knowledgeSearch.search` / `listByThread`. A tool would need a grant inside `llm.ts` AND a
`cockpit-agent` skill-BODY change to make the model aware of it (CLAUDE.md §5 — prompts are registry
rows), which is eval-gated work this plan could not certify. `llmRedaction.test.ts` scans `llm.ts`
for the four knowledge module names with a positive control, so this is an enforced absence.
A later plan that adds the tool must delete that test deliberately and replace it with a
counts-only return assertion.
*Mutation RED:* a `const _k = internal.knowledgeSearch;` line in `llm.ts`.

**Invariant 43 — ONE governance write PER RUN, of TWO event types, and it is the whole §4 surface.**
A completed run writes `knowledge.searched`, `actor: "system"`, `correlationId` = the coordinator's
own run uuid, payload = `redactedSearchEvent` plus eight run refs/counts. A run stopped between the
fan-out and the synthesis writes `knowledge.search_stopped` instead (Invariant 46). A stop BEFORE
the planner writes neither — nothing was read and nothing was charged. The question crosses as
`questionHash` only. **The planner's REJECTED SOURCE NAMES are model-authored strings** ("notion",
"http://evil.example") so only `rejectedPlanCount` crosses.

**The guard is an ALLOWLIST, and that is the load-bearing part.** `knowledgeSearch.test.ts` pins
`Object.keys(payload)` of each STORED row to a literal set, asserts that set equals the event's row
in `AUDIT_VIEWER_EVENTS`, and asserts every one of `redactedSearchEvent`'s 14 output keys is present.
The five-needle test remains as the content check on top. **Do not rely on the word blocklist in
`llmRedaction.test.ts`** — it is a cheap source-level tripwire and it admits every word it does not
name, which is stated in the test itself.
*Mutations RED:* `rawQuestion: question` on the payload (3 tests — this was a REAL stray mutation
found live in the working tree, not synthetic); `unansweredList: [...unanswered]`, model prose over
untrusted mail bodies, which the old blocklist passed (2 tests); deleting `"adapterCrashCount"` from
`AUDIT_VIEWER_EVENTS`, which the whole repo passed before (1 test); the eventType anchor renamed
(the control); `telemetry.` reachable from the coordinator; `telemetry.writeTerminal`'s
`requestId: v.id("requests")` loosened to `v.string()`.

**Invariant 44 — no telemetry row, and the reason is a hard binding, not a preference.**
`telemetry.writeTerminal` is bound to `requestId: v.id("requests")` and throws
`telemetry: no request for <id>`. A search has no `requests` row, and minting one to satisfy a
foreign key would put a fabricated row on the delivery plane. The measurement rides the audit event.
Cost is carried as REFS (`planRunRef` / `synthRunRef`, the `guardrails.recordSpend` correlation ids)
rather than a restated figure.

**Invariant 45 — a search with no evidence costs nothing.**
The synthesizer is not called when the clamped corpus is empty: there is nothing to cite, so there
is nothing a model could honestly write. `summary` is stored empty and the source states carry the
reason.
*Mutation RED:* `if (evidence.length > 0)` -> `if (true)`.

### Two limits stated rather than hidden

1. **`dedupeEvidence`'s same-ref-different-text CONFLICT arm is unreachable from the landed
   adapters.** It needs one `(source, sourceRef)` read twice in ONE run, and no adapter can do that:
   `vault.ownedDocsMeta` returns each document once, and Drive file ids, Gmail message ids and
   HubSpot deal ids are unique within a page. The coordinator still carries `conflicting` rows into
   the corpus (they are not dropped), but that line has no behavioural test and a mutation of it
   would stay green. The conflict the USER sees is the one the synthesizer DECLARES through
   `conflictEvidenceIds`, which `validateSynthesis` re-checks against the run's own evidence table —
   that path IS tested, in both directions (a declared conflict survives onto the stored row; a
   declared conflict citing an unminted id is stripped and counted as an invented citation).
2. **`SEARCH_CAPS.maxEvidenceTotal` (24 rows) cannot be reached in an offline test.** A `SMOKE::`
   vault query holds at most five 32-character document ids before it breaks
   `SEARCH_CAPS.queryCharCap` (200), `gmail.knowledgeQuery` hydrates at most 5 bodies, and Drive
   gives 8 — 18 in total. `totalEvidenceCharCap` (8,000) IS reachable and is what the run-clamp
   tests bind on. The row cap's own enforcement is mutation-tested inside `@pikar/core`.
   An earlier draft of that test used EIGHT vault seeds, which made the QUERY illegal, so
   `clampSearchPlan` refused the vault entirely and the test silently measured a run in which the
   vault was never searched. Count the characters before adding a seed.

### A trap worth remembering: the `internal`-graph type cycle

`type AdapterRef = typeof internal.knowledgeVaultDrive.searchVaultKnowledge` compiles, and it takes
the whole repo's type inference down with it: `internal` is derived from `fullApi`, which now
includes this module, so the reference closes a cycle. Measured — 0 `tsc` errors before, **379**
after, nearly all of them `implicitly has an 'any' type` in unrelated files. The registry uses a
hand-written `FunctionReference<"action", "internal", {tenantId, query}, KnowledgeAdapterResult>`
instead, which avoids the cycle — **and covers TWO of the three drifts, not three.** Measured:
changing an adapter's return type, or RENAMING `query` to `q`, gives `TS2322` on the
`KNOWLEDGE_ADAPTER_ACTIONS` assignment in `knowledgeSearch.ts` (a line number was cited here and had
already drifted); ADDING a newly-required argument gives no error there at all, because the
real reference stays assignable to the hand-written type. That third drift is closed by a source
scan of the four adapters' `args:` blocks in `knowledgeSearch.test.ts`.
*Mutations RED:* `extraRequired: v.string()` added to `searchVaultKnowledge` (the scan; typecheck
stays silent at the registry, which is the point).

---

## Plan 29-06 remediation — five findings, and what each one actually was (2026-08-28)

**Invariant 46 — a run that SPENT and READ is never invisible to governance.**
`if (!synthesized.ok)` used to `return` before both the `knowledgeSearches` insert and the single
`audit.log` call, while the adapters had already run and the planner had already recorded spend. So
"we read your mailbox, your Drive and your CRM, then the budget ran out" wrote nothing at all and
was indistinguishable at the caller from the pre-read planner stop. It now writes
`knowledge.search_stopped` — refs and counts only: `questionHash`, a code-owned `stoppedAt` stage
token, `stopReason` (`guardrails.preCall`'s own closed enum, never a provider message),
`evidenceCount` and the three coverage counts (which is what says the connectors were reached),
`adapterCrashCount`, `rejectedPlanCount`, `plannerFallback`, `planRunRef`, `plannerSkillVersion`,
`durationMs`. Still no content row: there is no answer to store.
*Mutation RED:* restore the bare `if (!synthesized.ok) return {...}` (2 tests).
*How the branch is driven at $0:* the mocked model boundary flips the kill switch after the planner
call and before the fan-out, which is a real production ordering rather than a stubbed one.

**Invariant 47 — the offline fixture seam needs the OPERATOR, not the caller.**
`offlineSeamAvailable() && question.includes(SMOKE_*_PREFIX)` in both `knowledgeLlm.ts` handlers.
`offlineSeamAvailable()` is `lib/models.ts`'s shared predicate — `PIKAR_OFFLINE_FIXTURES === "1"`
AND no model credential — the same one `vaultDigest.ts` and `voiceDoc.ts` use; there is exactly one
such predicate in the repo and a second must not be written. **Both conjuncts are load-bearing and
they close different doors:** the operator flag closes the TENANT (whose typed `question` reaches
the gate through the public `search` action), and keying on `question` rather than the assembled
prompt closes the THIRD PARTY (whose mail body and subject line are interpolated into the synthesis
prompt). `knowledgeLlm.test.ts` sets the flag for the whole file; the "PROMPT THE HANDLER ACTUALLY
SENDS" block stubs a model key on top, which turns the predicate false again and is why those tests
reach the live branch.
*Mutations RED:* drop `offlineSeamAvailable() &&` from the synthesizer seam (2 tests: the source
scan and the behavioural OPERATOR-OFF test); same from the planner seam (1 test).
*Positive control:* the OPERATOR-ON test drives the SAME question string with the flag set and no
credential and gets the fixture, so deleting the seam outright is also RED.

**Invariant 48 — `question` is bounded at the trust boundary.**
`QUESTION_CHAR_CAP = 2_000` in `knowledgeSearch.ts`, checked as the FIRST act of the handler, before
the hash and before the planner, and REFUSED as `{ ok: false, reason: "question_too_long" }` rather
than truncated — silently cutting it would answer a question the user did not ask and store it as if
they had. It was the only uncapped free-text boundary in the repo, and it went verbatim into two paid
prompts and the stored row; `guardrails.preCall` reads accumulated spend and cannot see the size of
the request in front of it. The cap lives in the backend module, not `SEARCH_CAPS`, for
`SUMMARY_CHAR_CAP`'s reason: `@pikar/core`'s cap set requires an enforcement site in that package.
*Mutations RED:* delete the guard; `>` -> `>=`. The test pins 2000/2001 as LITERALS.

**Corrected claims (each was true when written, and had stopped being true):**

- `knowledgeLlm.ts`'s "the `question` is the caller's own argument, so keying on it puts the seam
  back under the operator" — false once a public `tenantAction` supplied the question. Replaced with
  the two-conjunct explanation above.
- `knowledgeSearch.ts`'s `AdapterRef` "breaks the build here rather than at runtime" — two thirds
  true. Now states which half the type holds and names the source scan that holds the other.
- `@pikar/core`'s `renderSourceGap` and `groundedSourceProps` were described first as wired, then
  (wave-3 tail) as having no PRODUCTION caller. Both readings are stale. 29-09's
  `apps/web/app/(app)/dashboard/workspace/KnowledgeSearchPanel.tsx` imports and calls both — see the
  2026-08-29 entry at the head of this file — and the two docstrings in
  `packages/core/src/knowledgeSearch.ts` were updated with it, so they now name the panel. The
  narrower half survives: `groundedSourceProps`' `nonVault` return has no production reader, which
  its docstring says.
- `llm.ts`'s "only the three USER_AUTHORABLE_SKILLS can have an overlay row at all, so every other
  specialist name resolves exactly as before" — false once a second publish channel existed.
  **The replacement written here was ALSO false** and is corrected in 29-FIN-06: 29-05 did NOT
  widen `USER_AUTHORABLE_SKILLS`; it added `skills.publishPackCustomization` beside it, and the
  literal in `@pikar/contracts/skill` still lists exactly three names. The comment now describes the
  `loadEffectiveSkill` query instead of naming any closed set.

**Not closed, deliberately:** `llmRedaction.test.ts`'s `KNOWLEDGE_CONTENT_FIELDS` is still a word
blocklist over source text. It is kept as a cheap tripwire and its ceiling is now written into the
test; the real boundary is the behavioural key allowlist in `knowledgeSearch.test.ts`. Converting
the other ~90 events in `AUDIT_VIEWER_EVENTS` to derived key sets is out of scope — only
`knowledge.*` has an exported pure projection to derive from.

## Plan 29-11 — the recurrence decision gate, and why it says `defer` (2026-08-29)

> Last verified: 2026-08-29 (29-11 — **RECURRENCE IS DEFERRED BY A PARSER, NOT BY A SENTENCE.**
> `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md` carries a closed
> twelve-row YAML matrix in its frontmatter and `decision: defer`.
> `packages/backend/scripts/check-routine-gate.mjs` is the fail-closed validator, and
> `packages/core/src/routineSchedule.ts` is the DST/identity/overlap/retry spike the matrix cites.
> No schema, no scheduler module and no dependency was touched. `schema.ts:442` still carries its
> "deliberately NO `routines` table" sentence verbatim, and `routineDecision.test.ts` asserts it.)

**What the gate is.** Three modes over one artifact:

| Mode | Contract |
|---|---|
| `--matrix` | Closed schema + enumerations, valid even when every row is red. Refuses a fifth key, an unknown row id, a duplicate row, a missing row, an unknown enum member, an empty `evidenceRef`, and a `pass` row whose ref does not resolve to a file in this repo. |
| `--eligibility` | Exit 0 **only** when all twelve rows are `pass`, every ref is non-empty, and `oauth-expiry-reauth` / `dst-boundary` / `provider-read` each carry `evidenceType: live`. |
| `--validate-decision` | `defer` is accepted (plus absence checks: no `routine\|recurrence\|schedul` ADR, no `temporal` dependency in the root/core/backend manifests). `enable-safe` gets the **identical** eligibility check. |

**The distinction the whole artifact turns on.** `status` says whether the evidence meets the row's
requirement; `evidenceType` says what class the best available evidence is. A row can carry good,
passing, automated evidence and still be `missing`, because a code path is not a trace and a
simulation is not an execution. That is why `--eligibility` demands `live` on three named rows
rather than merely demanding twelve green rows — the failure mode this gate exists to prevent is
relabelling `automated` as `live`, and eleven green rows would not catch it.

**Today's matrix: 1 `pass`, 11 `missing`.** The one green row is `provider-read`
(`.planning/phases/03.2-inbox-reading/03.2-06-SUMMARY.md` — CKPT-01, human-verified 2026-07-12, a
real mailbox read against a really-connected account with zero sends). It is green because the
question it asks is genuinely answered; marking it red to make the matrix read uniformly would have
been the same dishonesty pointed the other way. It is also **attended** — no read in this product
has ever happened with nobody present — and §2 of the decision record says so.

**The Temporal spike ran and installed nothing.** `Intl.DateTimeFormat(zone).formatToParts()`
resolves real IANA wall time against full ICU tzdata, so `routineSchedule.ts` has **zero imports**
and `packages/core/package.json` names no temporal dependency (asserted). Proven in
`routineSchedule.test.ts`: New York and Berlin spring-forward gaps resolve to the transition
instant; a **30-minute** Lord Howe gap does too (an implementation assuming "DST means one hour"
fails there); both fall-back repeats resolve to the first instant; 08:30 New York stays 08:30 across
the transition on a 23-hour day; and 01:30 New York across fall-back yields one occurrence per local
date with a 25-hour step. `occurrenceKey` is derived from the LOCAL occurrence, which is what makes
the second 01:30 a duplicate claim rather than a second run.

**Nothing imports the spike.** `routineDecision.test.ts` scans every non-test `.ts` in `convex/` for
the string `routineSchedule` and fails if one appears. It is evidence, not a runtime module — if a
later plan wires it in, that test is the thing to update deliberately.

**If you are the plan that flips this to `enable-safe`:** the ADR number is **027**, not 013 — the
29-11 plan text names `013-standing-routine-governance.md` and **013 is taken** by
`013-the-render-worker.md`. Never edit an accepted ADR. And read §7 of the decision record first: it
names exactly which three live traces have to exist.

## Plan 29-08 — the manual pin, and the three things it refuses to pretend (2026-08-29)

**Files:** `packages/backend/convex/pinnedWorkflows.ts` (+ `.test.ts`, 34 tests),
`packages/backend/convex/savedPrompts.ts` (one filter),
`apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.tsx` (+ `.test.ts`,
`.container.test.ts`), `apps/web/app/(app)/dashboard/workflows/page.tsx`.

### The table decision, made against the plan's own file list

The plan named a `pinnedWorkflows` MODULE, which it gets — but 29-01 had already decided the STORAGE
question one plan earlier, adding `templateId`, `templateVersion`, `tenantSkillId`,
`customizationHash` and `sourcePreferences` to `savedPrompts` under a comment saying a parallel
table "would duplicate all of that AND put a second pin menu in the workspace". So a pinned workflow
is a pinned prompt with lineage, and it inherits the idempotent `textHash`, the code-derived title,
the bounded list and — the part that matters — "Run is an ordinary fresh turn through the existing
governed send path".

The MODULE is separate from `savedPrompts.ts` because that file is deliberately inert and
`savedPrompts.test.ts` scans it for every recurrence word; a readiness resolver that reads `skills`,
`tenantSkills` and the source probe would have forced that scan to be loosened.

### `textHash` folds the LINEAGE, not the text

The pinned text is the pack's code-owned `opener`, so every pin of one pack has byte-identical text.
A text-only hash would make every customization of a pack collapse onto the first pin ever taken of
it — exactly the collision `schema.ts` warned the first lineage-bearing writer about. `pinIdentity`
(@pikar/core, all five fields) is the hash input. Mutation observed RED: hashing `spec.opener`
instead makes "a pin taken after the customization changed is a DIFFERENT pin" fail.

### `sourcePreferences`: membership, not a length clamp

The "Known gaps" row above named a `CUSTOMIZATION_CAPS.maxValuesPerField` clamp as this writer's
job. It is NOT here, deliberately, and this supersedes that upgrade path. `preferredSources` starts
from `packReadableSources(packId)` and filters the stored choices INTO it, so the array can never be
longer than the pack's own readable list (three entries at most) and can never contain a source the
pack does not read. A `.slice(0, 8)` on top of that could not bind on any of the six packs, and a
cap that can never bind is the thing this repo keeps mistaking for a guard. Mutation observed RED:
trusting the stored list lands `crm` and `http://evil.example` on the row.

### Readiness: two lists, and the reason they are two

`blockers` refuse the run; `notices` describe a run that will still happen. Collapsing them is how a
UI turns "you should know" into "you cannot".

| State | Kind | Meaning |
|---|---|---|
| `paused` | blocker | the all-stop kill switch is on |
| `template_not_active` | blocker | no approved row for this pack any more |
| `template_republished` | notice | the pin's version is not the live one; the run re-resolves |
| `customization_not_applied` | notice | the pin names a customization the run cannot use |
| `customization_missing` | notice | the pinned candidate row is gone or foreign |
| `sources_unavailable` | notice | a source this pack reads is not connected (count beside it) |

**The daily BUDGET is deliberately not a readiness state.** `runPackTurn` calls
`guardrails.preCall` before the model and returns the governed stop as DATA (`outcome: "blocked"`,
`costUsd: 0`); a Convex QUERY cannot call a mutation, so a reactive copy here would be a different,
weaker question wearing the same name. The kill switch IS here because it is a plain row read.

### How to verify

```
cd packages/backend && pnpm vitest run pinnedWorkflows savedPrompts cockpit
cd apps/web && pnpm vitest run PinnedWorkflowButton
```

### Known gaps

- **No browser has loaded the Pin / Run again controls.** `apps/web` has no Playwright spec for
  `/dashboard/workflows`, and the route is still absent from the nav.
- **No model has answered a pinned run.** Every backend drive here is a governed stop at $0.
- **Cost is not recorded on the pin's audit row.** `startWorkflowPack` returns `{threadId, ok,
  outcome}` and not the pack's `runId` or `costUsd`, so the pin plane records outcome and latency
  only. The money is joinable through the pack's own `workflowPackEvents`/`spendEvents` `runId`.
  Upgrade path: return the `runId` from `startWorkflowPack` — a `cockpit.ts` change this plan did
  not own.
