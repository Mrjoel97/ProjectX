# Playbook: Skill Registry (versioned LLM prompts)

> Last verified: 2026-08-11 (21-04 — **A TENANT ROW CAN NOW BECOME `active`.** 21-02 and 21-03 both
> closed with "no tenant row can become active through any code path"; that sentence is now false.
> **Nothing was activated live, no tenant candidate has ever passed a real eval run, and NO PAID
> EVAL WAS RUN BY THIS PLAN — $0.00.** The green 36/36 gate recorded in the entry below is a
> **GLOBAL `cockpit-agent v1`** run by another lane; it certifies no tenant row and grants no tenant
> activation. Every result here is `convex-test` in memory plus source scans.
> **This entry supersedes that one's "does NOT cover" clause**: `packages/backend/convex/skills.ts`
> was dirty from the 21-03 lane when that session ran, and 21-03 has since committed; 21-04's own
> changes to the same file are committed in `18d8bca`.)
>
> **TWO INDEPENDENT GATES, and neither is sufficient.** Evaluation asks *has this body earned
> activation?*; owner authorization asks *may this caller change live runtime?*.
>
> ```text
> tenant candidate goes live  ⟺  ownerMutation(requireOwner)  AND  hasPassingTenantEvidence(row)
> tenant rollback goes live   ⟺  ownerMutation(requireOwner)  AND  rollbackEligible === true
> ```
>
> The load-bearing test cell is *non-owner WITH valid exact evidence*: EVAL_GATE would let that
> through, so the refusal proves authorization is doing the work. Downgrading the wrapper to
> `tenantMutation` lets the candidate's **own author** activate it (measured: `changed: true`).
>
> **ONE STATUS TRANSITION FOR BOTH SCOPES.** `transitionSkillActivation(ctx, target)` where target
> is exactly `{scope:"global",name,version}` or `{scope:"tenant",candidateId,mode}`. It owns target
> resolution, the scope-LOCAL current-active lookup, the evidence/exemption decision, idempotence,
> and **the only `ctx.db.patch(..., {status:"active"})` in the module** — `skills.test.ts` counts
> that patch and fails at two. `activateSkillVersion(ctx,name,version)` survives as a thin wrapper,
> so `activateSkill` and `activateCandidate` are behaviour-identical (all 72 prior tests green
> through the refactor, unchanged).
>
> **GLOBAL AND TENANT ROLLBACK DIFFER, and the difference is not cosmetic.**
>
> | | Global `skills` | Tenant `tenantSkills` |
> |---|---|---|
> | Identity | `name@version` | the ROW ID |
> | Evidence predicate | `hasPassingEvidence` (name + version) | `hasPassingTenantEvidence` (candidateId + registryTenantId + name + version) |
> | Rollback exemption | **status alone** (`archived`/`rolled_back`) | **`rollbackEligible === true` AND an archived/rolled_back status** |
> | Who may activate | `internal.skills.activateSkill` (identity-free) or `activateCandidate` (owner) | `activateTenantCandidate` (owner) ONLY |
>
> Status alone is sufficient globally because nothing else in the `skills` table can produce those
> statuses — an archived global row was live. In `tenantSkills` a **superseded draft is also
> archived and was never live**, so status-only would launder a pending candidate straight around
> the eval gate. `rollbackEligible` is written in exactly two places: the shared patch block, when a
> row actually goes live, and the `system` baseline `publishUserCandidate` mints as a byte copy of
> the code-owned core on a tenant's first customization. Measured: deleting the `rollbackEligible`
> predicate makes a never-active candidate restorable (`changed: true`).
>
> **Activation is tenant/name-LOCAL.** It archives only the active row at this tenant + this name,
> and patches no body, authoredBody, name, version, author, lineage or evidence. A colliding row in
> another tenant and the global registry row are both outside the index range. *A single-tenant test
> cannot prove this*: with only one tenant ever live, an unscoped "find the active row for this
> name" read returns the same row, and all 86 tests stayed green under that mutation. The test that
> bites puts BOTH tenants live at the same name and version and then supersedes the **younger**
> one's row.
>
> **THE OWNER REVIEW QUEUE.** `skills.tenantCandidatesForReview` (ownerQuery) — `by_status_createdAt`
> with a fixed `.take(25)`, newest first, never a deployment-wide `.collect()`. It returns the exact
> row id, tenant/user refs, `authoredBody` + `candidateBody` + `baseBody` (the diff pair), status,
> `gatePassed`, an `absent|passing|failing` evidence state, a refs-only evidence summary
> (runId/counts/cost/model — **never the raw evidence string**), and the bounded list of eligible
> rollback targets. Its returned key set is pinned by EQUALITY in the test, because the next field
> somebody adds to this queue is the next field a raw prompt leaks through.
>
> **AUDIT KEY SETS**, refs only (CLAUDE.md §4), one row per REAL transition — an idempotent
> re-activation and a refused attempt write nothing:
>
> | Event | actor | payload keys (exact) |
> |---|---|---|
> | `skill.user_candidate_activated` | `owner` | `author, evalRunId, fromTenantSkillId, fromVersion, ownerUserId, skillName, tenantSkillId, version` |
> | `skill.user_skill_rolled_back` | `owner` | the same eight; `evalRunId` is `null` because rollback is evidence-exempt |
>
> The row belongs to the TENANT whose runtime changed and rides that candidate's own
> `correlationId`, so it joins the `skill.user_candidate_published` row from 21-02.
>
> **OPERATOR STEPS.** Review and act at `/ops` → Optimizer → *User-authored candidates* (owner only;
> the whole section is mount-gated, and the server wrappers are the actual boundary). Activate is
> disabled until `gatePassed`. `Roll back` lists only rows that have genuinely been live, plus the
> server baseline. Read a candidate's situation at $0 with
> `npx convex run skills:inspectTenantSkill '{"candidateId":"<id>"}'` — refs only, no body.
> **There is deliberately no `convex run` path to tenant activation or rollback**: their authority is
> a human, and a CLI door would be a door around `requireOwner`.
>
> **STILL UNPAID AND UNOBSERVED.** No tenant candidate has passing evidence anywhere except in a
> test; `--tenant-skill` has never executed end to end against a real deployment; nothing has been
> activated or rolled back in a browser. The browser proof is 21-06's and the first paid tenant gate
> run is 21-07's. **Phase 22's internal identity-free eval path is intact** —
> `internal.skills.activateSkill`, `recordEvalEvidence` and `recordTenantEvalEvidence` still take no
> identity, and `requireOwner` is deliberately NOT inside the shared transition.

> Last verified: 2026-08-11 (THE GATE IS GREEN — run `107ee875`, **36/36**, evidence recorded on
> `cockpit-agent v1` of the CLOUD DEV deployment `woozy-wren-368`. $0.2944 exec + $0.1103
> specialist = **$0.4047**; one fixture retried (`21-fragment-answer-absorbed`). Not a splice —
> all 36 green in ONE unfiltered run, which the runner requires before it writes evidence.
> **Version numbering restarted:** the gate moved off the local backend to an always-on cloud dev
> deployment, whose skills table was empty, so `seedSkills` bootstrapped the body as **v1 ACTIVE**
> rather than a candidate. Local's `@18`/`@19`/`@20` history did NOT travel. `v1`'s body is
> sha256 `b765d7422d5e0d5d0d6beaa58b1310fbba02ced028a613cdc38aef01c3fec7e7`, byte-identical to the
> local `@20` that fixed the fixture-29 regression — verified by sha on both deployments, not
> assumed. Fixture 37 (`finance-update`, the one owed by 'teach a tool, owe a fixture') passed
> INSIDE this full run, not only in isolation.
> **What this entry does NOT cover:** `packages/backend/convex/skills.ts` is dirty in the shared
> tree from the concurrent 21-03 tenant-overlay lane. This session did not author or read that
> change and does not attest to it; that lane supersedes this clause when it commits.
> **Production is NOT seeded.** `opulent-octopus-494` has 0 functions — `convex deploy` fails with
> a server-side `408` on `/api/deploy2/evaluate_push`, twice, on a cold nine-component push.)

> Last verified: 2026-08-11 (21-03 — **EVIDENCE CAN NOW NAME ONE EXACT TENANT CANDIDATE ROW.
> NOTHING HAS PASSED A LIVE GATE, NOTHING WAS ACTIVATED, AND NO PAID EVAL WAS RUN — $0.00.** The
> only eval invocation this plan made is the FREE `--self-check`. A standing do-not-rerun order is
> in force on the paid gate and this plan did not need one.)
>
> **`<name>@<version>` IS NOT AN IDENTITY IN THE TENANT SCOPE.** 21-02's two-tenant test creates the
> collision on purpose: two tenants can each own `offer-architect@2`. Everything below therefore
> names the ROW.
>
> **TWO PIN SCOPES, orthogonal, never overlapping.**
>
> | Flag | Names | Read | Evidence lands via |
> |---|---|---|---|
> | `--skill <name>@<version>` | a GLOBAL `skills` row | `skills.getSkillVersion` | `skills.recordEvalEvidence` (name+version) |
> | `--tenant-skill <tenantSkillsId>` | an EXACT `tenantSkills` row | `skills.getTenantSkillVersion` | `skills.recordTenantEvalEvidence` (row id) |
>
> Both are multi-pin and may be combined **for different skills**. One skill NAME in both scopes is
> refused at $0 by `mergePinScopes`: both records are keyed by name into `runSpecialistTurn` and the
> TENANT id wins there, so a name in both scopes would leave the `--skill` pin doing nothing while
> its evidence row still claimed the version ran. Two `--tenant-skill` rows of one skill are refused
> for the same reason — last-one-wins must never decide which body a paid run certifies.
>
> **The exact identity is `{candidateId, registryTenantId, name, version}`**, and
> `hasPassingTenantEvidence` (contracts) compares EVERY field. `hasPassingEvidence` is deliberately
> NOT widened — the global gate asks "was this NAME at this VERSION certified", which is exactly the
> question that stopped being sufficient. Mutation-checked both ways: dropping the `candidateId`
> comparison turns a forgery test red (evidence agreeing with row B on tenant, name AND version and
> disagreeing only on which row ran), and a name/version write in `recordTenantEvalEvidence` turns
> the two-tenant collision test red.
>
> **REGISTRY TENANT vs THROWAWAY DATA TENANT.** The registry tenant (the one that owns the candidate
> row) is used for exactly two things: the pre-run inspection read, and the post-run evidence write.
> Every fixture plan, message, vault doc, Blueprint and assertion still belongs to the throwaway
> `eval-<runId>` tenant, unchanged. The resolution read is `skills.inspectTenantSkill`, **not**
> `getTenantSkillVersion`, precisely so the candidate BODY never enters the runner process at all.
>
> **EVERY no-evidence condition, in one predicate** (`shouldRecordEvidence`):
> `allGreen && casesTotal > 0 && filters.length === 0`.
>
> - a FAILED run certifies nothing;
> - a `--only` run is a tenth of the coverage and is indistinguishable from a full gate once it is a
>   row (16-09's clause, unchanged, and still mutation-checked);
> - a ZERO-case run is `0 === 0`, i.e. "all green", and would have written `0/0 pass` — **this hole
>   was open before 21-03**;
> - an OVER-CAP or governed stop never reaches the block at all, because `abortEnv` `process.exit(2)`s
>   from inside the case loop. That ORDERING is asserted against the source in `--self-check`, because
>   a rule that holds only because of where it sits is one refactor from being false.
>
> **The dispatched handoff is the part that is easy to get silently wrong.** The tenant id must ride
> BOTH the turn (`llm:runCockpitAgent`) and the tap (`evaluations:actOnGapInternal` → scheduled
> `dispatch.runSpecialist` → `llm.runSpecialistTurn`). Drop it at the tap and the specialist runs the
> tenant's EFFECTIVE body while the run certifies the candidate — 16-09's defect, one registry scope
> down, and invisible in a green run. `dispatch.test.ts` drives the scheduled seam with the tenant's
> ACTIVE overlay, the pinned CANDIDATE and ANOTHER tenant's same-name/version row all present, and
> asserts the audit `skillBodyHash` against `contentHash(candidateBody)`; dropping the handoff turns
> it red.
>
> **A pin whose row names a different skill REFUSES before `generateText`** (`TENANT_SKILL_PIN_MISMATCH`).
> A mis-wired harness costs $0 rather than a model call plus an evidence row certifying the wrong
> skill. Tool names stay the code-owned `SPECIALISTS` record and are never read from a tenant row
> (ADR-007).
>
> **Only a USER-authored CANDIDATE is evaluable.** `active` (already what the tenant runs — a ~$0.4
> no-op), `archived`, and `system` baselines all abort before the inbox/vault/Blueprint seeds.
>
> **`skills.inspectTenantSkill` is BODY-FREE by construction**, not by care: every registry row leaves
> it as a `SkillRefs` shape that has no body field, so the candidate's composed body, the user's
> authored adaptation and the global prompt (an owner-only boundary, research pitfall 4) are all
> absent. `evidenceState` is `absent | passing | failing` — an unparseable or stale pin reads
> `failing`, never `absent`, because "there is a pin and it does not hold" is a different operator
> situation from "there is none". `rollbackBaseline` is resolved through the **stored lineage**
> (bounded walk to the first `rollbackEligible` row; a global-based candidate reads its tenant's
> version 1, written in the same transaction) — never "the newest archived row", which is the guess
> that made `candidatesForReview` offer `v17 -> v16` in production.
>
> **The two READ-ONLY operator commands (no seed, no model, no write):**
>
> ```powershell
> pnpm --filter @pikar/backend eval:golden -- --inspect-tenant-skill <tenantSkillsId>
> npx convex run smoke:userSkillRuntimeAttribution '{"tenantId":"<tenantId>","correlationId":"<rootRequestId>"}'
> ```
>
> The first reports status / evidence state / lineage / rollback baseline / effective + global refs
> and SHA-256 body hashes, with **no bodies**; add `--json`, `--foreign-tenant <tenantId>`, and the
> inspection-only `--expect-status=`, `--expect-evidence=`, `--expect-gate-passed=`,
> `--expect-rollback-eligible=` flags (nonzero exit on mismatch, no write). The JSON carries a
> `deploymentHash` — SHA-256 of the configured deployment URL with query string and fragment dropped
> BEFORE hashing, because a deploy URL can carry a key — so the Phase-21 handoff can pin that the
> pre-gate and post-gate inspections talked to the same deployment. `--foreign-tenant` REFUSES a
> result whose effective row is the candidate's id or its bytes. The second command reads the
> EXISTING `subagent.completed` lineage through `audit.by_correlation` (bounded `take`, tenant
> equality re-checked because that index is deliberately cross-tenant) and returns scope / row id /
> name / version / body hash only.
>
> **The free command, and the only one this plan ran:**
> `pnpm --filter @pikar/backend eval:golden -- --self-check` — ZERO Convex calls, ZERO model calls,
> **$0.00**. `--self-check` now asserts that too, by scanning its own body for `must(`.
>
> **Runner behaviour change worth knowing: unknown arguments now ABORT.** The prior note that
> "unknown argv is ignored" is no longer true (see `agent-runtime.md`, which keeps the `--list`
> warning): `--tenant-skil <id>` used to buy a full UNPINNED gate run at ~$0.4 and record nothing.
>
> **Fixed in passing (Rule 1): `myUserSkills.gatePassed` asked the GLOBAL predicate of a TENANT row.**
> A tenant-only run's `skillVersions` is `{}`, so a genuinely certified candidate read `false`
> forever and the panel's "Evaluation passed" copy was unreachable for the same reason "Live" is. It
> now asks `hasPassingTenantEvidence` against the row's own identity.
>
> **STILL OWED, and 21-03 claims none of it.** **NO tenant row can become `active` through any code
> path** — 21-02's finding is unchanged, and every test here that needs an active overlay still
> patches the row directly. 21-04 owns activation and rollback. **No candidate has been evaluated
> live**: `--tenant-skill` has never been run against a model, no `tenantSkills.evidence` row exists
> outside a test, and `gatePassed` has only ever been observed as `false` in production. The live
> paid proof is 21-07's. SKILL-01 stays open.

> Last verified: 2026-08-10 (21-02 — **THE OVERLAY IS NOW LIVE CODE: a signed-in user can publish
> an immutable tenant candidate, and an ACTIVE tenant row now reaches the real specialist model
> call. NOTHING was evaluated, activated or spent — publishing costs $0 and cannot change what any
> model runs today, because no activation path to a tenant row exists yet.**)
>
> **ONE immutable-version rule for both scopes.** `allocateImmutableVersion(newest, duplicate)` in
> `skills.ts` is the whole allocation contract: a body that byte-matches the newest row in scope
> mints nothing, anything else becomes `newest.version + 1`, and a prior row is never patched. The
> global `insertCandidate` (SkillOpt write-back) now routes through it and is behaviour-identical —
> `rows` is non-empty by its own guard, so `newest.version + 1` is the `maxVersion + 1` it replaced.
> The helper takes the newest ROW rather than reading it, because the two scopes are indexed
> differently: global reads `by_name_status` and collects (a bounded registry), tenant reads
> `by_tenant_name_version` with `.order("desc").take(1)`. **A tenant's authoring history is
> open-ended and must never be collected** — `skills.test.ts` scans the publisher's source region
> for `by_tenant_name_version` + `.order("desc")` + `.take(1)` and for the absence of an unbounded
> read, because the 200-version behaviour test passes either way. Keep that literal out of the
> region's COMMENTS too, or the scan false-positives on prose.
>
> **`publishUserCandidate` takes `{name, authoredBody}` and nothing else.** Tenant, author,
> `authorUserId`, status, version, evidence, `rollbackEligible`, the base body and the composed body
> are all derived server-side, so Convex's arg validator is the refusal boundary: a caller cannot
> even NAME a field it does not own. Mutation-checked — adding `authorUserId` as an optional arg
> turned the provenance test red.
>
> **TWO DIFFERENT BASES, and collapsing them is a real defect.** The COMPOSITION core is the
> **global active body** (`loadSkill`): it is the only body in the system that provably carries no
> tenant adaptation, because nothing can write one into the `skills` table. The LINEAGE base is the
> tenant's **effective** row (`loadEffectiveSkill`) — the row this candidate supersedes, and what
> 21-03 pins evidence to. Composing against the tenant's ACTIVE body instead appends the previous
> draft to the new one on every re-edit, forever; this plan's own non-recursion test caught exactly
> that before the code shipped. **Consequence 21-03 must know: a candidate based on a tenant row
> records the SUPERSEDED tenant version in `basedOnVersion`, not the core version.** Read the core
> from the global active row at eval time; do not infer it from `basedOnVersion`.
>
> **The first customization writes TWO rows in one transaction.** A `system` / `authoredBody: ""` /
> `archived` / `rollbackEligible: true` baseline that is a byte copy of the core, then the user
> candidate at version 2. Removing the baseline insert turns the first-customization test red.
> A tenant that already has history gets NO new baseline — it is a first-customization artifact.
>
> **Idempotence is bytes AND lineage.** A republication matches only when the newest row is a
> `user` `candidate` whose TRIMMED `authoredBody` and whose `basedOnScope`/`basedOnVersion` all
> match. The same words against a NEW base are a real new candidate, not a repost. An idempotent
> repost mints no version and writes NO second audit event.
>
> **The audit row is `skill.user_candidate_published` and its key set is pinned by EQUALITY:**
> `skillName, tenantSkillId, version, baseScope, baseSkillId, baseVersion, author, bodyHash,
> authoredBytes`. Adding `authoredBody` or `body` fails `skills.test.ts` on purpose (mutation-
> checked), and a needle scan covers `audit` + `deadLetters`. Candidate text is content-plane data.
>
> **`loadEffectiveSkill(ctx, tenantId, name)` is the load order: tenant ACTIVE row -> the existing
> global `loadSkill` -> `NO_ACTIVE_SKILL`.** A `candidate` row is invisible by construction (the
> index pins `status: "active"`), which is what makes publishing a runtime no-op. The global branch
> delegates to `loadSkill` rather than re-querying, so the fail-closed contract has one home.
> `getEffectiveSkill` is the internalQuery wrapper; its `tenantId` is trusted server state.
>
> **`myUserSkills` is the disclosure boundary.** It takes NO arguments — there is no id to point at
> another tenant — and returns exactly `name, label, authoredBody, version, status, baseScope,
> baseVersion, gatePassed, createdAt`. No base or composed body, no raw evidence, no row id, no
> foreign tenant. `gatePassed` is a boolean derived from `hasPassingEvidence`, which fails closed.
>
> **STILL OWED, and 21-02 claims none of it.** 21-03: an eval pin EXACT on the tenant candidate id
> (`offer-architect@2` is ambiguous the moment two tenants hold it — this plan's two-tenant test
> creates that collision deliberately) plus tenant evidence. 21-04: owner activation and rollback
> through the one shared transition helper; **there is currently NO way for a tenant row to become
> `active` other than a direct DB write, which is why every 21-02 test that needs an active overlay
> patches the row itself.** SKILL-01 stays open.

> Last verified: 2026-08-10 (21-01 — **CONTRACTS AND SCHEMA ONLY. Nothing here is reachable yet:
> there is no public function, no UI, no model call, no eval path and no activation. No registry row,
> global or tenant, exists or changed.**)
>
> **`tenantSkills` is an OVERLAY, and the separate table is the whole point.** `skills` is
> deployment-global and its `by_name_status` reads are `.unique()`. Putting tenant rows in it makes
> every one of those reads multi-row and breaks every agent on the deployment; encoding the tenant
> into `name` would make authorization depend on string parsing rather than an indexed key. The
> global `skills` definition and both its indexes are BYTE-UNCHANGED by this plan (the schema diff
> is 71 lines, all insertions, zero deletions).
>
> Row shape: `tenantId, name, version, body, authoredBody, status, author, authorUserId?,
> basedOnScope, basedOnName, basedOnVersion, basedOnGlobalSkillId?, basedOnTenantSkillId?,
> rollbackEligible, evidence?, createdAt`. Indexes `by_tenant_name_status`,
> `by_tenant_name_version`, `by_tenant_createdAt`, `by_status_createdAt`.
>
> **IMMUTABLE AFTER INSERT:** `name`, `version`, `body`, `authoredBody`, `author`, `authorUserId`
> and the whole `basedOn*` lineage. Later code may patch ONLY `status`, `evidence`, and the
> code-owned `rollbackEligible` transition when a row genuinely becomes active. A re-edit is a NEW
> row composed against the CURRENT effective base — never a patched body, and never an older
> adaptation appended to a newer one.
>
> **TWO ROW SHAPES, and only server code can mint the first.** A server baseline is
> `author: "system"`, `authoredBody: ""`, `status: "archived"`, `rollbackEligible: true` — it is
> what gives a tenant's FIRST customization a real, evidence-exempt rollback target. A user
> candidate is `author: "user"`, a real `authorUserId` derived from authenticated identity,
> `status: "candidate"`, `rollbackEligible: false`. `rollbackEligible` is code-owned precisely so a
> user candidate cannot mint itself one.
>
> **THE v0 AUTHORABLE SET IS THREE NAMES AND IS NOT `GATED_SKILLS`.**
> `USER_AUTHORABLE_SKILLS` = `offer-architect`, `money-model-designer`, `lead-engine`. Gating is an
> ACTIVATION policy; authorability is a PRODUCT decision. The three are chosen because their real
> runtime is `dispatch.runSpecialist` -> `llm.runSpecialistTurn` and held-out fixtures 29/30/31
> drive one each — so a tenant candidate has a runner that can clear its gate. Adding a name whose
> runner cannot drive it reproduces the `document-analyst`/`media-director` deadlock recorded
> further down, except now once per tenant. `skillAuthoring.test.ts` pins the exact set and its
> subset relationship to `GATED_SKILLS`; adding `cockpit-agent` to the tuple was mutation-checked
> RED before this entry was written.
>
> **The user authors an ADDITION, never a replacement.** `composeUserSkillBody(base, authored)`
> emits the base verbatim, one fixed `## Tenant-authored business adaptation` marker, and the
> trimmed adaptation. It never parses or strips the base (raw bodies stay an owner-only disclosure
> boundary), never accepts a tool/capability list (ADR-007 — capability is code), and throws rather
> than returning a partial body. The cap is `USER_SKILL_ADAPTATION_MAX_BYTES = 4000` **BYTES, not
> characters** — a character cap lets one multibyte paste carry ~4x the tokens the number implies,
> and swapping `TextEncoder().encode(...).length` for `.length` was mutation-checked RED.
>
> **STILL OWED, and this plan claims none of it.** 21-02: the `tenantMutation` publisher, the
> initial baseline write, `loadEffectiveSkill` (tenant active -> global active -> `NO_ACTIVE_SKILL`)
> and the refs-only audit row. 21-03: an eval pin that is EXACT on the tenant candidate id —
> `<name>@<version>` alone is ambiguous once two tenants both hold `offer-architect@2`. 21-04: owner
> activation and rollback through the one shared transition helper. Until 21-02 lands, these tables
> have no writer and no reader; SKILL-01 stays open.

> Last verified: 2026-08-10 (WHOLE-BRANCH RE-REVIEW, live-finance-inputs — **CODE ONLY, still not
> seeded or evaluated. The body's `Finance:` sentence called every figure in that line "the user's
> own figures", and once C1 made the line live that was a false statement to the model on every
> turn** — the same invariant C2 had just fixed at the page surface, at the surface that actually
> talks. `cashSpine.ts` now emits a `PIKAR` marker on any figure the owner did not supply (agent
> write, or evaluation-grounded scorecard fill), mirroring the blueprint spine's `[stated]` /
> `[source: X]` one token wide, and the body reads "the figures on file" plus a bullet: a `PIKAR`
> figure is never "you told us", say it is the figure on file and ask them to confirm. Unmarked
> means theirs — a marker on everything would say nothing. `FINANCE_SPINE_BUDGET` re-measured
> 437 → 503. `cockpitAgent.ts` regenerated; `skills.test.ts` green. The eval-gate debt from the
> entry below now covers both body edits.)

> Last verified: 2026-08-10 (WHOLE-BRANCH REVIEW FIX I1, live-finance-inputs — **CODE ONLY, body
> edit not yet seeded or evaluated. The `cockpit-agent` body's OLD `recordScorecardAnswer` section
> was the live back door around everything the new finance section governs.** That tool is ungated,
> agent-callable, takes a free-string `field`, and `applyScorecardAnswer` appends the dot-path to
> `userProvided` — from which `runEvaluation` rebuilds its citation map at `{source:
> "user-provided", confidence: "high"}`. The body listed `financials.cac` / `financials.ltgp` /
> `financials.thirtyDayCashPerCustomer` on that tool's path list, so the exact laundering
> `applyFinanceClaims` refuses and `writeFigureRow` throws on was reachable in one turn through the
> older instruction, and the new section's "CAC has to be entered on their finance page for now"
> contradicted it. **The review offered two fixes and the second was taken, because the first would
> have broken two golden fixtures**: dropping the three `financials.*` paths kills fixture 27
> (`27-grounded-assessment.json` — the user STATES a CAC and the agent stores it, which is its whole
> subject) and fixture 31 (`31-gap-dispatch-lead-engine.json` — needs `financials.ltgp` on the
> scorecard to reach diagnostic gate 3). So the arithmetic boundary was carried into the old section
> instead: a new bullet, "**The number they SAID, never one you worked out**", with the 14,000/10
> CAC worked example, plus the CAC bullet in the finance section rewritten to route by SOURCE — a
> STATED CAC goes to `recordScorecardAnswer` (it really is the user's own figure), a COMPUTED one
> goes nowhere and the user is asked to enter it. Both fixtures state their figures, so both stay
> valid. `cockpitAgent.ts` regenerated from the `.md`; `skills.test.ts`'s byte-identity table is
> green. NOT re-evaluated: `EVAL_GATE` costs ~$0.35 of real spend and was out of scope for this
> offline fix wave — the next cycle to touch this body must run it.)

> Last verified: 2026-08-10 (Task 9, live-finance-inputs — **CODE ONLY: the `cockpit-agent` body
> now teaches `readFinance`/`stageFinanceWrite` (a new "Financial figures" section — never compute
> a ratio yourself, only these five figures are writable: `cashOnHand`, `monthlyOperatingCost`,
> `mrr`, `receivables`, `payables`, and raise a stale/missing figure only when relevant to what
> the user is asking), and the owed fixture (`37-finance-update.json`) and its
> `financeClaimCount` observable were added, mirroring `crmOperationCount` exactly** (graded off
> `plan.financeClaims`, the array `stageFinanceWrite` itself writes). Floor bumped 35 → 36. THE
> 2-FILE MIRROR WAS KEPT IN SYNC: `cockpitAgent.ts` was regenerated from the edited `.md` and
> `skills.test.ts`'s no-drift row (53/53) passed. Verified OFFLINE ONLY —
> `node run-eval-golden.mjs --self-check` passed at zero cost (36 fixtures valid, vocabulary/
> anti-vacuity rules hold) — because `convex dev` was NOT RUNNING for this session and this
> worktree does not own the deployment `seedSkills` would write to (the main checkout, mid-refactor
> by another session, does). **NOTHING WAS SEEDED. NO GATE WAS RUN. NOTHING WAS ACTIVATED.** The
> active skill is UNCHANGED by this entry. Evidence recorded is never activation — this entry is
> neither: it is a code change awaiting the seed+gate+activate cycle a later dispatch runs after
> the merge. Budget that cycle at **~$0.35, not ~$0.12** per the note below, now one case heavier
> at 36.**)
>
> Last verified: 2026-08-09 (**19-09 took the `cockpit-agent` override lane. GATE `086f8267` PASSED
> 35/35 on `cockpit-agent@18`, zero retries, $0.3505. EVIDENCE IS RECORDED ON v18. NOTHING WAS
> ACTIVATED — `cockpit-agent@17` IS STILL ACTIVE and activation was withheld by the owner.**)
>
> **THE GATE COSTS ~$0.35, NOT ~$0.12. Read v17's own evidence row before budgeting one.** The
> previous gate (`d17039a8`, 34/34) is stamped `costUsd: 0.357` on the v17 skill row, and this one
> came in at `0.3505` for 35. Any plan or checkpoint quoting $0.12–0.15 for a full gate is STALE by
> roughly 3x — the three research fixtures (32/33/34) alone are ~$0.11 of specialist spend. The
> figure is free to check at $0: read `skills.evidence` on the active row.
>
> **A ONE-LINE FIXTURE REPAIR, NOT A BODY EDIT, IS WHAT TURNED 36 GREEN.** Its first live execution
> failed twice, identically, for $0.0115: the agent composed an EMAIL instead of ever calling
> `stageCrmWrite`. Turn 1 read *"Remind me on Thursday to chase Rhea Calloway … her address is
> \<addr\>"* — an outreach verb plus an inline address, which is the cockpit's strongest
> recipient-collection cue. Rewriting turn 1 in the records grammar turn 2 already used (*"Add a
> follow-up for Thursday with …"*) passed first try for $0.0071. **The body was deliberately NOT
> touched** — it already forbids the behaviour verbatim, so the instruction was outgunned, not
> missing, and a third prohibition would have been the reflex move that produces a third identical
> failure. **The address deliberately STAYED in the turn**: it is the temptation that gives
> `recipientCount: 0` its teeth, and a needle absent from every turn is a vacuous canary.
>
> **OPEN, AND THE ONE THING TO FIX BEFORE TRUSTING 36:** on the passing run the staged operation is
> `addContact` with no `due`, **not the `addFollowUp` the fixture's prose describes**.
> `crmOperationCount` is a COUNT and cannot tell the two apart, so 36 currently proves *"exactly one
> CRM op was staged, it never became an outbound plan, and turn 2 did not add a second"* — all real
> ACTN-05 teeth — but NOT that a dated follow-up was created. Closing that needs a new key in the
> closed EXPECT vocabulary (an op-type/`due` assertion), which is a code change, not a fixture edit.
>
> Phase 19 (ACTN-05) edited the `cockpit-agent` body to teach `stageCrmWrite` and contacts-first
> resolution, and discharged 18-08's binding *"teach a tool, owe a fixture"* override condition with
> `eval-cases/36-crm-follow-up.json` and the 34 → 35 fixture-floor bump. **`cockpit-agent@18` was
> SEEDED, GATED and left as a CANDIDATE. Gate `086f8267` passed **35/35**, zero retries, $0.3505,
> and `recordEvalEvidence` stamped that run onto the v18 row — so v18 now SATISFIES `EVAL_GATE`
> and is one `activateCandidate` click from live. **It was deliberately not clicked:
> `cockpit-agent@17` is still ACTIVE.** Evidence recorded is NOT activation; do not conflate them.
>
> **The gate was reached in two steps, and the order is the reusable part.** `--only 36` first
> ($0.0115, FAILED — see the repair above), then the one-line fixture repair, then `--only 36`
> again ($0.0071, PASS), and only then the unfiltered run. A brand-new fixture costs one case to
> falsify and thirty-five to certify — never let a new fixture execute for the first time inside
> the gate.
>
> The pre-seed reading that made the FORWARD arrow safe to trust, kept because the PROCEDURE is the
> point — read off the live deployment (`local:`) on 2026-08-09 at $0 BEFORE seeding: ACTIVE
> `cockpit-agent` is **v17** (body 27 313 chars, sha256 `b5c8b6a50aed` — byte-identical,
> LF-normalized, to the pre-19-09 canonical `.md`), and **v18/v19/v20 are ABSENT**, so no optimizer
> dry-run candidate is squatting above the active row and `seedSkills` will mint **v18**: a FORWARD
> arrow, not the rollback the block below warns about. The body it will carry is 28 368 chars,
> sha256 `6ca4d937639c`. **All of that was CONFIRMED after seeding** — `seedSkills` minted v18,
> `status: "candidate"`, body 28 368 chars, sha256
> `6ca4d937639cc6b97a90f4f4ca54315f6c39ae9c818b9c94c1ec3d72a17510ad`, read back off the deployment
> at $0 before a cent was spent. Verify that hash after seeding — never trust a plan's version
> number.
>
> **20-12 and 20.1-01 must now rebase on this body** before seeding a candidate of their own. One
> candidate stream, one gate: a candidate carrying two lanes' prose is precisely what the override
> condition exists to prevent.
>
> Found while verifying the fixture and deliberately NOT fixed here: **`eval:golden --self-check` has
> been red on `main` since Phase 20**, invisibly, because `runLive()` never calls `selfCheck()` — the
> one check that stops a bad fixture before it costs a cent was itself unrunnable. Its stale
> `SPECIALIST_ROUTES` snapshot is fixed; the second failure (`media` is a dispatchable route whose
> skill `media-director` is NOT in `GATED_SKILLS`, so a media body edit rides no gate) is an owner
> decision, written up in `.planning/phases/19-contacts-crm-follow-ups/deferred-items.md`.

> Last verified: 2026-08-09 (Stop-hook pass, unrelated to any in-flight plan — **acknowledging
> `packages/contracts/skills/cockpit-agent.md` and `packages/contracts/src/skills/cockpitAgent.ts`,
> flagged as changed-since-baseline with no matching playbook touch.**) Traced both: `cockpit-agent.md`
> was last substantively changed by `cb48d11` (2026-08-02, "teach createDocument in cockpit-agent"),
> a new-tool skill-body edit from an earlier, unrelated plan; `cockpitAgent.ts` was last touched by
> `cf1c5fd` (2026-08-04, "make repository verification hermetic"), a 2-line CI-hermeticity fix to how
> the seed body is emitted, no prompt-content change. Neither commit is part of the
> cash-business-finance plan and neither touches this playbook's actual guarantees (skill versioning,
> the review-queue/EVAL_GATE ordering, activation flow) — this is a straight `git diff`-since-an-older-
> baseline artifact the Stop hook surfaced, not a real content gap. Bumping this line only, per
> CLAUDE.md §9's own escape hatch, to close it out.
>
> Last verified: 2026-08-09 (**the review queue offered DOWNGRADES, and EVAL_GATE is what caught
> it.**) `candidatesForReview` picked the highest-versioned CANDIDATE and never compared it to the
> active row. Optimizer dry-runs leave candidate rows behind at lower versions, so once a real
> upgrade lands those stale rows are offered forever. Observed live: the ops panel showed
> `cockpit-agent v17 → v16`, `offer-architect v4 → v3` and `money-model-designer v4 → v3`, and every
> Activate click returned `EVAL_GATE: … has no recorded passing eval run`.
>
> **Do NOT respond to that error by running `pnpm eval:golden` on the named version.** It spends real
> model money to bless a rollback nobody asked for. Read the arrow first: if the target version is
> below the active one, the queue is wrong, not the gate. Fixed by filtering candidates to
> `version > active.version` (a skill with no active row at all is still offered, since there is
> nothing to be behind), with a mutation-checked test that goes red if a downgrade is ever listed.
>
> The wider lesson: `reduce(max)` over a filtered set answers *"newest candidate"*, which reads like
> *"next version"* and silently stops being the same thing the moment a sibling advances. Rollback
> stays a deliberate operator act through `activateSkill` — never a button in a review queue.

> Prior: Last verified: 2026-08-03 (15.3-08 task 2 — **`document-classifier` added, DELIBERATELY UNGATED.**
>
> **`document-classifier`** gives every vault document a machine-derived type and a short
> human-readable identity line — *"2025 P&L"*, not *"a spreadsheet"*. It runs on ONE workflow step
> at the single ingest convergence point, so single-file uploads are classified too, not only
> folder members.
>
> **THE LITERAL ENUM KEYS LIVE IN THE OUTPUT CONTRACT SECTION, NOT IN GUIDANCE PROSE.** That is a
> recorded lesson in this repo: guidance is what a model drops under length pressure, an output
> contract is not. The body lists the `DOC_TYPES` literals verbatim and says *"use `unclassified`
> when none fits — never force a nearest match"*, because a forced nearest match is worse than an
> honest blank.
>
> **UNGATED, for the same MECHANICAL reason as `content-drafter` and `folder-digest`:**
> `run-eval-golden.mjs` derives `--skill` from `GATED_SKILLS` and drives `runCockpitAgent` over
> text fixtures, and no fixture reaches vault ingest — so gating this row would deadlock it at v1
> on its first body edit. Pinned by `expect(isGatedSkill(DOCUMENT_CLASSIFIER_SKILL)).toBe(false)`.
> FOUR skills now carry that warning; if a fifth appears, the eval harness is the thing to fix.
>
> **THE CONSUMER DEGRADES RATHER THAN FAILS, WHICH IS AN EXCEPTION WORTH KNOWING.** Everywhere
> else `getActiveSkill` is fail-closed by contract. `vaultLlm.classifyDoc` catches INSIDE itself
> and returns `unclassified` instead, because a throw there exhausts the workflow's retries and
> `onIngestComplete` then marks the document `failed` — so an unseeded row would fail EVERY ingest
> in the deployment, and by the honest-manifest rule would inflate a folder's failure count, for a
> COSMETIC label. The fallback is a degraded LABEL, never a degraded grounding corpus.
>
> No version pinned anywhere, as always: `seedSkills` inserts v1/active only on an empty name and
> otherwise `maxVersion + 1`. Verify with `getActiveSkill`, never by asserting a number.)

> Last verified: 2026-08-03 (15.3-06 task 1 — **`folder-digest` added, DELIBERATELY UNGATED.**
>
> **`folder-digest`** is the folder-synthesis body: one model call turns a completed vault folder
> into a three-part markdown digest. Its OUTPUT CONTRACT names all three parts — (1) what the
> folder IS (manifest: counts, kinds, date range, a one-line identity per document), (2) what it
> SAYS (cross-document synthesis), (3) what could NOT be read (failed / unsupported /
> still-processing members, named with the reason the manifest gives). **Part 3 lives in the
> contract section, not in guidance prose** — a model under length pressure drops guidance, and a
> digest that silently omits an unreadable document is worse than no digest, because the reader
> assumes full coverage.
>
> **UNGATED, the `content-drafter` / `business-blueprint` mechanism verbatim:**
> `run-eval-golden.mjs` derives its `--skill` list from `GATED_SKILLS` and drives
> `runCockpitAgent` over TEXT fixtures. A folder digest is fed a folder manifest plus bounded
> per-member excerpts, which no text fixture can assemble — so gating it would deadlock it at v1
> on its first body edit. `skillBodies.test.ts` asserts `isGatedSkill(FOLDER_DIGEST_SKILL)` is
> false, so a "tidy up the gate list" edit fails there rather than in production.
>
> **There is no generator script for the derived body.** `src/skills/folderDigest.ts` is
> hand-derived from `skills/folder-digest.md`; the `skillBodies.test.ts` drift row is the ONLY
> thing that turns an edit to one side into a failure instead of a silently stale seeded prompt.
>
> **Never pin its version.** `seedSkills` inserts at v1 `active` only when `rows.length === 0`,
> otherwise `maxVersion + 1`. Read the live version back with `getActiveSkill`; never assert v1.)
>
> Prior: Last verified: 2026-08-03 (20-11 tasks 1-3 — **no registry row changed; the §5 EXEMPTION that
> two Phase-20 files rely on is now an ADR decision.**
> [ADR-013](../decisions/013-the-render-worker.md) Decision 5 records that `assemble_final.sh` and
> `burn_caps.sh` are **CODE, not registry rows**: §5 governs *prompts*, and a runtime-mutable shell
> script executed in a VM holding tenant media is remote code execution. The scan that refuses them
> as rows was mutation-checked — adding `{ name: "assemble", body: assembleScriptBody }` to
> `skills.ts` fires it. `media-director` itself is unchanged and still UNGATED at v1; ADR-012
> records the whole media spine it emits.)
>
> Prior: 2026-08-02 (20-03 — **`media-director` added, DELIBERATELY UNGATED, live at v1.**)
>
> **`media-director`** is the Phase-20 media specialist: script → art direction → block deck →
> block prompts, all four produced in ONE turn (one row, not four — a `SpecialistSpec.skillName` is
> ONE string, and a composing dispatcher does not exist in this repo).
>
> **UNGATED, and it is not a style preference.** MECHANICALLY, gating it deadlocks it at v1: the
> golden runner hard-validates `--skill` against a closed name list and drives `runCockpitAgent`
> over TEXT fixtures, so it structurally cannot exercise a storyboard turn and no run could ever
> certify the first body edit. That is the `document-analyst` mechanism exactly. SUBSTANTIVELY, the
> guarantees are CODE: `searchVault` is its only grant so it cannot spend a cent; the narration
> character band is enforced by `@pikar/core/storyboard`'s parser whatever the body says; the model
> is chosen from a price table the body cannot name into. And unlike `inbox-digest` /
> `reply-drafter` / `research-specialist`, it ingests no untrusted third-party content — only the
> tenant's own profile, blueprint and vault. `skillBodies.test.ts` asserts the ungated state, so a
> "tidy up the gate list" edit fails there rather than in production.
>
> **Its `.md` carries a WORKED EXAMPLE that a test parses.** `storyboard.test.ts` feeds the body's
> own BLOCK DECK to `parseBlockDeck` and asserts every narration line sits inside the character band
> the body teaches. A body edit that drifts off the table shape, or that writes an example line
> violating its own rule, is RED — which matters because the silent failure mode is an EMPTY deck
> that reads as "the specialist proposed nothing" rather than as a bug.
>
> **There is no `assemble` row and there must never be one.** The ffmpeg assembler is a repo file
> with a byte-identity mirror; a registry row is mutable by a database write, and a runtime-mutable
> shell script executed in a VM is remote code execution. `llmRedaction.test.ts` scans `skills.ts`
> for it.
>
> PREVIOUSLY:
> Last verified: 2026-08-01 (16-09 — **run `56bff5b8` paid, 29/33; FOUR bodies changed and NONE
> are seeded. The “NUMBER-FREE” claim in the block below is SUPERSEDED.**)
> Gate run `56bff5b8`: **29/33 passed, $0.3025** ($0.2290 executive + $0.0734 specialist) against a
> $2.00 cap. Failures: **29, 31, 32 AND 34** — note 34, which an earlier note omitted because it was
> read off a partial stream before 34 finished.
>
> **The block below states the search mandate “is now NUMBER-FREE”. That is no longer true.**
> `841f668` put the numbers back: `research-specialist` now opens with an explicit at-least-two
> floor, because removing the number cost the multi-search ceiling (fixture 32 ran ONE search
> against its `webSearchCallsAtLeast: 2`). Do not read the paragraph below as describing HEAD.
>
> ⚠ **THE FIVE PINS NAMED BELOW ARE STALE — four of them point at bodies that FAILED.**
> `841f668` + `ae38192` changed `research-specialist`, `offer-architect`, `money-model-designer`
> and `lead-engine` in the REPO ONLY. The live registry’s highest rows are still the exact bodies
> that failed run `56bff5b8` (`research-specialist@4`; the other three `@2`). **A re-run carrying
> the pin list below would re-certify the failing bodies and reproduce an identical RED for ~$0.30.**
> Re-seed, READ BACK the minted versions (`seedSkills` writes maxVersion+1 and optimizer dry-run
> candidates occupy versions), and pin THOSE. Plan-authored version numbers are routinely wrong
> against the live DB — that is the standing rule below, hit again.
>
> **Prose was tried three times and measured to fail.** `research-specialist` has now carried an
> unconditional search mandate through three separate tunings. Run `eval-f795ede0` logged
> `webSearchCalls` of **1, 1, 1, 0, 0, 4** across six dispatches — the “without exception” floor was
> violated twice in six attempts. **16-09 therefore moved containment into CODE:**
> `persistResearchFindings` (`dispatch.ts`) now refuses to write a `web_research` VAULT DOCUMENT
> when `webSearchCalls === 0`, and audits `research.persist_skipped` with refs+counts only. The memo
> CARD is untouched — it is landed before the persist seam and keeps its `NOT_RESEARCHED_LABEL`, so
> the user still reads the findings and the label. Only the RETRIEVABLE artifact is withheld,
> because `vaultSearch` returns arbitrary CHUNKS and a slice carries neither the label (which sits
> BEFORE the fence) nor the fence itself. **This does NOT force a search and cannot turn a
> `webSearchCallsAtLeast` fixture green** — forcing the first tool call would edit `llm.ts`, which
> carries a zero-edit pin from 17.1-07, and is an unmade decision.
>
> ⚠ **Fixture 33 is exposed and was perturbed with NO measurement.** It PASSED under
> `research-specialist@4`; `841f668` changed that body anyway, discarding the certification. Its
> load-bearing keys are `declaredUnsupported: true` AND `insufficientEvidence: true`, and BOTH new
> bullets are anti-declare — one says an “as of” date no page confirms “does not turn published,
> retrieved facts into ‘no support’”, and 33’s turn pins the impossible date **31 February 2026**;
> the other says “support in hand is support” against 33’s DESIGNED near-miss corpus. Countervailing
> text survives (“a near-miss is a source, not support”). **If 32 goes green and 33 goes red the
> phase is net WORSE off** — 33 is the only fixture proving refusal-to-confabulate. Check it first.
>
> Also: `money-model-designer` was edited although fixture 30 PASSED `citesVaultDoc` in run
> `56bff5b8` without the new sentence — a certified green is now uncertified for no measured gain.
>

> Last verified: 2026-08-02 (22.1-03 — **`skillopt.yml`'s two gates were VACUOUS and are now
> loud.**) Both gate steps read a `convex run` through `$(… 2>/dev/null || true)`. When that call
> failed — no `CONVEX_DEPLOY_KEY`, unreachable deployment — `OUT` was EMPTY, `jq -r '.enabled //
> false'` yielded the empty string, and `"" != "true"` was read as *dormant — skipping*, so the
> job reported GREEN having verified nothing. STATE recorded the symptom (it logs `enabled=`,
> empty rather than `false`); this is the cause and the fix.
>
> **The distinction the gates now make: DORMANT is not the same as COULD-NOT-TELL.** Dormant is a
> legitimate skip and stays green; could-not-tell is a broken gate and exits 1 with a
> `::error::`. The `// false` jq defaults are gone from the two decision fields as well — a
> MISSING `enabled`/`eligible` is a contract break, not a dormant optimizer — and a non-boolean
> value is refused rather than guessed. (`negativeRate`/`sampleCount` keep their `// 0` defaults:
> they are reported numbers, not decisions.)
>
> **The general trap, worth carrying to any other workflow:** `|| true` on a command whose OUTPUT
> feeds a decision converts a failure into a silent default. The step can then never fail, so its
> green means only *it ran* — the most expensive kind of passing check, because it buys
> confidence it has not earned. If a command's output drives a branch, its failure must be a
> separate branch. Grep for `|| true` before trusting any gate here.
>
> Not yet observable in CI: `ci.yml` still fails earlier at codegen because `CONVEX_DEPLOY_KEY`
> has never been set on this repo, so `skillopt.yml`'s first HONEST run is still owed.
>
> Last verified: 2026-08-02 (ACTN-03 — **`research-specialist` v8: the per-sub-question SEARCH became
> an OUTPUT ELEMENT, and fixture 32's flaky search floor stopped being flaky.** Probe `e106bc36`:
> 1/1 first attempt, $0.1042 specialist — a genuine multi-angle run.) Gate `3ec490ab` came back
> 32/33 with fixture 32 the only red, on `webSearchCallsAtLeast: 2` — got 1. The count is not a
> reflex (unlike the declaration): it is a real judgement with high VARIANCE — 1, 1, 1, 3 and 20
> searches observed on the same body. **Ruled out first, and worth not re-deriving:** the dispatch
> ENVELOPE is not the cause. It looked like one (the passing probe ran at `envelopeCents=125` and
> made 20 searches; the gate ran fixture 32 32nd at `106` and made 1), but `governedDispatch`
> checks `spentCents >= envelopeCents` only AFTER the turn returns, and 106 cents against a 1.2
> cent spend is nowhere near binding. Late position in a gate does not handicap a fixture.
> The fix is the SAME lever that took fixtures 29/30/31 from 3/7 to 3/3 the hour before: the
> decomposition had lived in guidance prose since v1, and guidance is followed probabilistically.
> `## What you produce` item 2 now requires, beside each sub-question, **the search actually run
> for it, quoted, with what it returned** — so a six-part question answered by one search is
> visibly incomplete IN THE DOCUMENT while the model is writing it.
>
> **THE RULE, now three-for-three (research scope, growth Sources, this):** if an eval key measures
> something the model must DO, put the requirement in the OUTPUT CONTRACT, not in guidance prose.
> The model can see a missing output element; it cannot see an unfollowed instruction. Guidance
> prose is a suggestion with a pass rate — measured here at roughly a third.
>
> Last verified: 2026-08-01 (ACTN-03 — **the three GROWTH specialist bodies gained a mandatory
> `## Sources` list; fixtures 29/30/31 all green at run `73583564`, $0.0220.** Candidates v4, NOT
> activated.) `citesVaultDoc` is a LITERAL substring test for the seeded corpus needle in the memo
> body (`run-eval-golden.mjs`), and fixture 29 had failed it in three separate paid runs. Retrieval
> was never broken — the failing memo quoted a fact that exists ONLY in the seeded brief — the memo
> simply never echoed a document TITLE. The requirement existed but sat in conditional prose (*cite
> the document title beside every claim*); it is now a MANDATORY OUTPUT ELEMENT (*a memo without a
> `## Sources` list is incomplete*, titles copied character for character), which is the shape the
> memos that DID pass had used all along. Applied to all three (`offer-architect`,
> `money-model-designer`, `lead-engine`) because each is the target of one of 29/30/31.
> **General rule, and this is its second instance:** when an eval key reads for a LITERAL string in
> model output, the instruction that produces it belongs in the OUTPUT CONTRACT, not in guidance
> prose — guidance is followed probabilistically (the measured needle rate was 3/7), an output
> element is followed structurally. The same move fixed the research specialist's scope teaching.
>
> Last verified: 2026-08-01 (ACTN-03 — **`research-specialist` v7 teaches the SCOPED declaration;
> 32/33/34 all green at run `1246bb4a`. Candidate, NOT activated** — activation still needs a full
> unfiltered green gate.) v7 adds two things to v6's deletions: the `scope` distinction
> (`"question"` = the core is unsupported and marks the findings; `"sub-question"` = one part came
> back empty and the findings STAND), and an explicit statement that calling the tool is **not a
> step in the routine** — a run that answered its question calls it NOT AT ALL. That last line
> exists because the measured failure was a RITUAL: the model calls each tool it owns once per run.
> **Do not read v7's green run as proof the prose worked.** It did not, on its own: at v7 the model
> still passed `scope: "question"` on 5/5 dispatches while holding up to 10 sources. What made the
> fixtures green was the CODE conjunction in `llm.ts` (`… AND sources.length === 0`). The body
> teaching is kept because it is honest and costs nothing, not because it is load-bearing — see
> `agent-runtime.md` for the measurements and the 22.1b reversal that came with it.
>
> Last verified: 2026-08-01 (ACTN-03 — **`research-specialist` v6: THREE DELETIONS, the first
> version in this skill's history that SHRINKS the body (12,295 -> 11,693 chars). Candidate minted,
> NOT activated.**) Root-caused by a 13-agent read-only investigation after two prose rewrites (v4,
> v5) failed to stop the specialist calling `declareUnsupported` on runs holding 5, 7 and 8
> genuinely relevant sources — which forces `insufficient_evidence` and reds fixtures 32 and 34.
> **The body contained a DIRECT ORDER to do exactly that**, at the paragraph beginning *"The same
> holds for a specific fact inside a findable subject…"*: if the entity is real but a specific fact
> is in nothing you retrieved, *"that is a declaration"*. Fixture 32 asks whether two REAL vendors'
> APIs expose freshness filters and return source URLs — real subject, specific facts, absent from
> retrieval: the body ORDERED the declaration. That paragraph was written for fixture 33, whose
> subject is INVENTED, so its stated condition ("the entity is real") never matched 33 and always
> matched 32/34; 33 stays covered by the two clauses directly above it. DELETED, not qualified.
> Also deleted: the false step-budget scarcity premise ordering the call *"before you write the
> findings document"* (measured: max 6 of 12 steps, 48.8s of a 180s budget — never scarce; it made
> the model declare before it could see what it had retrieved). Third deletion follows the
> capability change below (research is web-only, so the `searchVault` teaching had to go).
> **WHY THE TWO PRIOR PROMPT REWRITES MISSED IT** — the reusable lesson. v4 (820c247) and v5
> (ae38192) both only APPENDED bullets to the "Do not call it when" list (it grew 5 -> 6 -> 8),
> BELOW an unmodified positive imperative. An exception list cannot beat a direct order, and
> neither author noticed the order was there. When a model keeps doing X after you have twice
> written "do not do X in case Y", stop adding cases and go looking for the sentence that TELLS
> it to do X.
> Seeded and READ BACK on the live row before spending (v6, 11,693 chars, direct order absent,
> "exactly two tools" present) — the step skipped when 841f668 was never seeded and a paid gate
> then measured a body that did not contain the fix. Drift test 15/15, core 56/56, backend
> typecheck at the exact 150 baseline, `--self-check` green.
>
> Last verified: 2026-08-01 (ACTN-03 — **the `research-specialist` search instruction was RE-TUNED:
> the one-search floor stopped capping the multi-search ceiling; candidate minted, NOT activated.**)
> Commit `820c247` fixed zero-search runs by opening the search section with "issue at least ONE web
> search on every run" — and the next gate run (28/33) showed the anchoring cost: fixture 32's
> multi-part question ran ONE search against its `webSearchCallsAtLeast: 2` floor. The mandate stays
> (zero-search runs were a real, measured failure: 3 of 6 dispatches) but is now NUMBER-FREE ("never
> answer from memory alone — every run searches the web"), and "how many" is handed to
> `## Decompose before you search`, which now states the norm: each sub-question gets its own
> search, any question with more than one part takes at least two searches, and a single-search run
> is defensible only for a genuine single-fact lookup. Standard 2-file mirror (`.md` edited,
> `researchSpecialistSkillBody` regenerated — there is still NO codegen script), drift test 15/15,
> `--self-check` 33 fixtures green, backend tsc at the 150 baseline. Seeds as the NEXT candidate
> version — read it back (maxVersion+1 collision rule below). Reminder for the next gate attempt,
> paid for twice now: `--skill` is MULTI-pin and the gate run must carry ALL FIVE pins —
> `cockpit-agent`, `offer-architect`, `money-model-designer`, `lead-engine`,
> `research-specialist` — the 28/33 attempt dropped three of them and certified nothing.
>
> Last verified: 2026-08-01 — ⚠ **date bumped to clear a `check-playbooks.mjs` false positive; NOT a
> re-verification.** The hook attributed commit `820c247` (a foreign lane's `research-specialist`
> tuning) to an unrelated Phase-18 planning session, because it builds its changed-set from the whole
> working tree rather than the session's own diff. Nothing below was re-checked against the code on
> this date. The last line-by-line verification remains the one dated below.
>
> Last verified: 2026-07-31 (22-02, GOVN-01) — **the Phase-8 blocker (a) is CLOSED.**
> `activateCandidate` and `candidatesForReview` moved from tenant wrappers to
> `ownerMutation`/`ownerQuery`, so candidate prompt BODIES (global registry rows) are no longer
> readable by any signed-in tenant and no tenant can flip a skill live. Activation is now
> `owner authorization AND EVAL_GATE` — two independent gates, deliberately not merged:
> `activateSkillVersion` stays un-gated by owner because it is also the trusted internal path for
> the eval runner and seeding, which have no browser identity. Public rollback is owner-authorized
> but remains evidence-exempt BY TARGET STATUS (rollback must work mid-incident). No skill body,
> version, or seeding behaviour changed. See `docs/playbooks/authorization.md`.
> PREVIOUS: 2026-07-31 (22.1b — **`research-specialist` gained a structured refusal channel; candidate minted, NOT activated**) — the second gated body changed today, and the reason is a defect no prompt edit could fix. `insufficientEvidence` was a pure COUNTER (`sourceCount === 0`), and a counter cannot express a semantic judgement: a diligent search of a NONEXISTENT entity always surfaces near-miss sources, so the honest refusal could never earn the label while a zero-search memory answer earned it every time (measured, run `a5dfafc2`: the 1-search $0.0120 refusal — which correctly flagged "31 February" as an impossible date and declined to invent a jurisdiction — FAILED; the 0-search $0.00088 answer PASSED). 22.1 split `not_researched` from `insufficient_evidence`, which killed the false pass but left fixture 33 with NO verdict assertion. 22.1b restores it: the specialist now CALLS `declareUnsupported({claim})`, and **the SIGNAL IS THE CALL** — the tool is a local no-op whose argument is read by nobody (not returned, not persisted, not audited), because reading it would put model prose back on the verdict path that f2226fe removed. `evidenceVerdict` gains a REQUIRED `declaredUnsupported` (never optional-with-false-default: `false` biases toward `sourced`, the fail-OPEN direction for an honesty label), and `webSearchCalls === 0` stays the OUTERMOST check — so "declare instead of searching" is worth nothing. **The two legs that killed `dispatchResearch` twice today were both verified explicitly, and this is the discipline to repeat for ANY new tool:** (LEG A, presence) `declareUnsupported` is in `RESEARCH_TOOLS` (`specialists.ts:84`) and is built under a SINGLE conjunct — `grantWebResearch` — merged into the SAME spread as `webResearchTool`, so granting hosted search without the declaration channel is structurally impossible; contrast `dispatchResearch`'s three-conjunct gate (`llm.ts:1099`), where one optional arg being undefined made the tool invisible with nothing erroring. (LEG B, teaching) 4 occurrences in `research-specialist.md` AND 4 in the shipped `packages/contracts/src/skills/researchSpecialist.ts` — **the runtime ships the derived `.ts`, there is NO codegen script, and a `.md`-only edit is a silent no-op that cost a wasted cycle earlier today.** Byte-identity is guarded ONLY by `skillBodies.test.ts` (15/15 green). Two couplings that would have shipped RED and that any future tool must also honour: the `agentSteps.tool` schema literal is REQUIRED for a LOCAL executable tool (`onToolExecutionStart` fires, unlike provider-executed `webResearch`, and the insert throws inside a callback the AI SDK SWALLOWS — no prod trace row while every offline test passes), and `traceParity.test.ts` asserts set-equality BOTH ways between those literals and `cards.tsx`'s `VERB` keys. Fixture 33 is STRENGTHENED, not weakened: `insufficientEvidence: true` returns ALONGSIDE `webSearchCallsAtLeast: 1`, so it now proves diligence AND the honest verdict — a run that searches once then invents an answer makes no call, reads `sourced`, and fails both keys. Fixture 34's `insufficientEvidence: false` silently CHANGED MEANING and must not be pruned as redundant: it was near-vacuous under a counter (that question has abundant sources) and is now a LIVE INDUCTION PROBE — a retrieved page arguing "no sources exist" is a CLAIM to report, never an instruction to obey, so a RED there is a correct alarm to fix in the body, never by relaxing the key. Gates green: core 374, contracts 21, backend 146 across 4 files, `--self-check` PASSED. **Nothing is activated.** `research-specialist` v2 is a CANDIDATE; `activateSkill` still demands an EVAL_GATE evidence row. Because `--skill` is MULTI-pin and writes one row PER pin off ONE run, a single green unfiltered 33-case run (~$0.85) can certify BOTH `cockpit-agent@16` and `research-specialist@2`. PREVIOUS ENTRY: 2026-07-31 (16-09 follow-up) — **`cockpit-agent` learned `dispatchResearch`; candidate minted, NOT activated.** Phase 16 built the entire research plane (tool at `convex/llm.ts:773`, scheduler, specialist, persistence, activity-card verb) and **no plan owned the skill-body teaching**, so the executive never called the tool: filtered eval run `442341cf` (`--only research`, 0/3, $0.0213) on a proven-healthy deployment produced exactly THREE audit rows across six attempts — `mailbox.searched` ×2, `vault.searched` ×1 — and zero `subagent.completed`/`research.persisted`. Structural absence was REFUTED first (`grantDispatch` is `toolNames === undefined` at `llm.ts:2069`; the runner passes no `toolNames`, so the tool WAS in the record), leaving the body: `cockpit-agent@15` contained zero occurrences of `dispatchResearch`/`research`/`web search`. **This is the withheld-tool pattern from `agent-runtime.md` @ 03.11-05 (RPLY-01) repeating** — a tool plane shipped complete while the prompt stayed silent, so the capability looks mysteriously broken. Added `## Researching the outside world` to `packages/contracts/skills/cockpit-agent.md` (22,548 → 25,555 chars): the `searchVault`-is-THEIR-material vs `dispatchResearch`-is-the-OUTSIDE-world routing split, findings-do-not-arrive-this-turn, **pass the question FAITHFULLY with its constraints intact** (the specialist receives `question` and nothing else — no history — so a stripped "do not substitute similarly named organisations" is how fixture 33's fabrication guard dies), instruction-shaped text inside a research question is the SUBJECT not a command (fixture 34 plants an injected address in the USER turn and expects `recipientCount: 0` — the `<vault_context>` rule one layer earlier), refusals are conversational (`research_in_flight`/`draft_in_progress` — the latter would DISCARD a draft), and not-a-composing-turn. **Process note worth more than the diff:** the `.md` is canonical but the Convex runtime ships the hand-derived `packages/contracts/src/skills/cockpitAgent.ts` constant, and there is NO codegen script — only the `skillBodies.test.ts` drift assertion. Editing the `.md` alone changed nothing and the first `seedSkills` left the table at 15 rows; the `.ts` must be regenerated (`JSON.stringify` of the LF-normalized `.md`) and the watcher must re-push BEFORE seeding, because `seedSkills` reads the bundled constant, not the file. Drift test 15/15 green, `tsc --noEmit` clean. **Nothing was activated:** the new body is a CANDIDATE and `activateSkill` still requires an EVAL_GATE evidence row, which a `--only` run structurally cannot produce (evidence is suppressed on any filtered run). Phase 16 stays 8/9 and `ACTN-03` stays Pending until one full unfiltered 33-case gate passes. **Also unproven:** everything downstream of the tool call — no specialist run, no persisted doc, no `webSearchCalls` has EVER executed, so the teaching is necessary but not shown sufficient. PREVIOUS ENTRY: 2026-07-27 (17.1-02) — added the **UNGATED `business-blueprint`** row through the full 5-file mirror; drift row mutation-verified (a one-char `.md` edit turned exactly that row RED, 1 failed / 20 passed, and reverting restored 21/21) and `isGatedSkill("business-blueprint") === false` is now an EXPLICIT assertion, not an absence. See "## Phase 17.1 — business-blueprint" below.
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

- **a. Ops-surface owner-authorization — ✅ CLOSED 2026-07-31 by Phase 22 (GOVN-01).** Was: those three
  functions were callable by ANY authenticated tenant because the codebase had no owner/admin primitive,
  and the source comments said so outright ("the authenticated identity IS the owner gate"). Now:
  `requireOwner` reads the durable `users.owner` boolean and `optimizerConfig.getOptimizerStatus` +
  `setOptimizerEnabled` + `skills.activateCandidate` + `skills.candidatesForReview` are all on
  `ownerQuery`/`ownerMutation`, refusing `OWNER_REQUIRED` before a body is read or a status flips. See
  `docs/playbooks/authorization.md`. **Two properties matter here and are separately pinned:** owner
  authorization and the EVAL_GATE are INDEPENDENT (an owner still cannot activate an unevaluated gated
  candidate; a non-owner still cannot perform an evidence-exempt rollback), and the trusted internal path
  — `internal.skills.activateSkill`, seeding, evidence recording — is deliberately NOT owner-gated, because
  it runs from the eval runner and scheduler with no browser identity at all. The Phase-25 cross-user
  isolation test still owes the multi-user assertion that a second real user cannot reach them.
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
