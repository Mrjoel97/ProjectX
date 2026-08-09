# Phase 16 Deferred Items

## 16-09 live golden gate blocked before fixture execution (2026-07-30) — DID NOT REPRODUCE 2026-07-31

**Read the 2026-07-31 update below before acting on this entry.** The original record is kept
verbatim because the failure was real, was hit twice, and the conditions that produced it can
recur — but its instruction "do not re-run the paid gate" has since been discharged.

### Original record (2026-07-30, lane worktree `agent/research-16-09`)

- The lane-local Convex watcher reached `Convex functions ready` and completed
  `skills:seedSkills`.
- `OPENAI_API_KEY` was set on the local deployment through stdin. An in-memory read-back matched
  the source value exactly; metadata checks found ASCII-only content with no whitespace.
- Active `research-specialist` is v1 and its body is byte-identical (LF-normalized) to
  `packages/contracts/skills/research-specialist.md`.
- A direct, no-cost authenticated `GET https://api.openai.com/v1/models` returned HTTP 200, so the
  source credential itself is valid.
- Golden run `e58e036b` stopped during `vaultSmoke:seedCorpus`, before fixture 01, with:
  `Uncaught Error: Invalid arguments for fetch: failed to parse header value`.
- Per the plan's one-clean-Convex guidance, the lane's watcher/backend pair was stopped, one clean
  watcher was started after the deployment env was configured, and the gate was retried once.
  Retry run `3d0f65e2` failed at the identical seed call with the identical error, again before
  fixture 01 and before any runner-recorded model spend.
- The failing request is constructed by the pre-existing `openaiEmbeddingV2.doEmbed` adapter in
  `packages/backend/convex/vaultRag.ts`; it combines `Content-Type`, `Authorization`, and the AI
  SDK's forwarded headers before Convex `fetch`. No Task-3-owned file participates before this
  failure.

**Deferred (as written 2026-07-30):** diagnose/fix the pre-existing Convex-local embedding header
construction/runtime compatibility outside plan 16-09, then run the golden gate once. Do not weaken
fixtures 32-34 and do not re-run the paid gate until the seed call is proven healthy.

### Update 2026-07-31 — the seed call is healthy on the MAIN deployment

The gate was re-run from the main working tree against `local-joel_feruzi-pikar_ai_50c69-1`.
`vaultSmoke:seedCorpus` **succeeded** — the runner logged `seeded vault corpus: 2 doc(s), live
embed` and proceeded past fixture 01. `vaultRag.ts` was UNMODIFIED for this run (the diagnostic
probe below was never applied to main). So the header defect is **not** an unconditional property
of `openaiEmbeddingV2.doEmbed`, and the "fix `vaultRag.ts` first" framing above is too strong.

**The two runs differed in two ways, and BOTH remain candidate explanations — this is NOT settled:**

1. **Different deployment.** The 2026-07-30 attempt used the *lane-local* deployment that the
   `agent/research-16-09` worktree brought up; each worktree runs its own (`PARALLELIZATION.md`).
   2026-07-31 used the main tree's long-lived deployment.
2. **Different provenance for `OPENAI_API_KEY`.** 2026-07-30 SET the variable on its deployment via
   stdin. 2026-07-31 set nothing — `npx convex env list` already carried the key, so the value that
   worked is one written by some earlier session through an unrecorded path.

**The most probable cause, stated as a hypothesis and NOT as a finding:** a stray control character
(a trailing `\r` is the classic Windows stdin case) captured into the deployment's env value. That
would parse fine as a string, read back as "matching", and still make `Authorization: Bearer <v>`
an unparseable *header* — which is exactly the error text, exactly why the failure landed in
`fetch` rather than in auth, and exactly what the 16-09 diagnostic probe was written to detect
(it flagged key characters outside `0x21..0x7e`). **This was never confirmed.** The probe was
never run to a recorded result, and the lane deployment it would have measured is gone.

**Consequence for the next person who sets this variable:** on Windows, prefer
`npx convex env set OPENAI_API_KEY <value>` with the value as an argument over any stdin/piped
form, and if a header-parse error appears at the first embedding call, suspect the stored value's
bytes before suspecting `vaultRag.ts`.

**Status of the deferred item:** the blocking instruction is DISCHARGED for the main deployment —
the paid gate ran there. The underlying question (what exactly poisoned the lane deployment's
header) is UNRESOLVED and cheap to leave open, because nothing currently depends on it.

### Discarded with the lane worktree (2026-07-31)

`agent/research-16-09`'s working tree carried an uncommitted `probeEmbeddingHeaders` internalAction
in `packages/backend/convex/vaultRag.ts`, self-labelled *"TEMPORARY 16-09 diagnostic probe. Removed
after identifying the Convex-local rejected header."* It probed `/v1/models` under five header
combinations and reported any key character outside `0x21..0x7e`. It was **not** carried to main:
it is debug scaffolding whose own comment says to remove it, the condition it diagnoses does not
reproduce on the main deployment, and it reads `OPENAI_API_KEY` into a returned structure. If the
header error ever recurs, this file records what the probe measured so it can be rewritten in ten
minutes rather than rediscovered.

Everything else in that worktree was byte-identical to `main` (fixtures 32/33/34 and
`run-eval-golden.mjs`, line endings aside) and was lost to nothing.

## 16-09 SETTLED 2026-07-31 — the research plane is built but the agent was never TOLD about it

Run `442341cf`, tenant `eval-442341cf`, `--only research`, **0/3, $0.0213**, pins
`cockpit-agent@15 research-specialist@1 offer-architect@2 money-model-designer@2 lead-engine@2`.

**This supersedes the "environment problem" reading of the two earlier runs.** The deployment was
healthy for this one and PROVEN so: started clean at 14:07:59, soaked ~5 min idle with zero retry
storms, `vaultSmoke:seedCorpus` embedded live, and `convex-local-backend` pid 13796 was still
listening on `0.0.0.0:3210` and serving AFTER the run. All three fixtures still failed identically
(`researchDocPresent: no research document before timeout`), and all six plans still ended at
`status=collecting` with `kind`/`route` unset.

**The audit trail settles it.** Across all six attempts the tenant accumulated exactly THREE audit
rows: `mailbox.searched` ×2, `vault.searched` ×1. Zero `subagent.completed`, zero
`research.persisted`. The agent never called `dispatchResearch`, so `dispatch.runResearch` was never
scheduled, so `landSpecialistResult`'s `finally` never ran — which is precisely why the plans sit at
`collecting` forever.

**Correction to `run-eval-golden.mjs:41`.** Its comment says a row still at `collecting` past the
timeout "means the deployment never ran the job — an environment problem, not a case failure." The
first clause is right and the inference is WRONG: a job can also never run because nothing ever
SCHEDULED it. That misreading cost two paid runs ($0.4376) spent chasing the environment. The
comment should distinguish "scheduled but never landed" (environment) from "never scheduled"
(the agent didn't call the tool) — the audit trail is what separates them.

**Cause, confirmed on both legs:**

1. The tool EXISTS and was OFFERED. `dispatchResearch` is built at `convex/llm.ts:773` and is
   conditionally constructed under `grantDispatch` (`llm.ts:2069` — `toolNames === undefined`).
   The eval runner calls `llm:runCockpitAgent` WITHOUT `toolNames` and with a real `threadId` +
   `rootRequestId`, so the gate evaluated true and the tool was in the record. Structural absence
   is REFUTED.
2. The active skill body never mentions it. `cockpit-agent@15` (active, 22,548 chars) contains
   **ZERO** occurrences of `dispatchResearch`, `research`, `web search`, or `websearch` — while
   mentioning `searchVault` 4× and `evaluateBusiness` 3×, which is exactly the behaviour observed.
   `packages/contracts/skills/cockpit-agent.md` on disk has zero too, so this is not DB drift.

**This is the "withheld tool" pattern this repo has already hit once and documented** — see
`docs/playbooks/agent-runtime.md` @ 03.11-05 (RPLY-01): the reply plane shipped complete in plans
02-04 while the skill body stayed silent, and "reply to X" looked mysteriously broken until
`cockpit-agent@12` learned the tool existed. Phase 16 built the whole research plane (plans 01-08)
and no plan owned the skill-body teaching. Fixtures 32/33/34 CANNOT pass until it lands.

**Fix path (the 03.11-05 recipe, unchanged):** teach `dispatchResearch` in
`packages/contracts/skills/cockpit-agent.md` (when to reach for it vs `searchVault`; that findings
arrive later as an approvable card, not in-turn) -> `seedSkills` mints candidate v16 ->
iterate with `--only research --skill cockpit-agent@16 …` at ~$0.02 a try -> once green, ONE full
unfiltered 33-case gate for the evidence row -> `activateSkill` v16.

**Not yet known:** whether the research plane works once invoked. Nothing downstream of the tool
call has EVER executed — no specialist run, no persisted doc, no `webSearchCalls`. The teaching is
necessary; it is not proven sufficient.


---

## DEFERRED 2026-08-02 (owner) — ACTN-03 is ENGINEERING-COMPLETE and BLOCKED ON BILLING ONLY

**Do not re-diagnose this. The behavioural work is done, committed and probe-verified.** What is
missing is one paid run, and nothing else.

**Status: Phase 16 stays 8/9 and `ACTN-03` stays Pending in ROADMAP/REQUIREMENTS.** It is NOT
complete and must not be ticked. The blocker is an OpenAI balance of $0
(`credit_balance_exhausted` on chat AND embeddings — verified directly against the key, not
inferred from a failed run).

### What was fixed (all committed, all probe-verified green)

| Fixtures | Probe | Result |
|---|---|---|
| 29 / 30 / 31 | `73583564` | 3/3, first attempt, $0.0220 |
| 32 / 33 / 34 | `1246bb4a` then `e106bc36` | 3/3, then 32 re-verified 1/1 |

Commits: `52a421d` (the verdict conjunction + web-only research grant), `3f77378` (growth
specialists' mandatory `## Sources` list), `d57dcce` (per-sub-question search as an output
element). The last full gate `3ec490ab` scored **32/33**, and its only red was fixture 32's search
count — which `d57dcce` then fixed and `e106bc36` verified.

### The resume recipe — ONE command, ~$1 of credit

```
cd packages/backend && node ./scripts/run-eval-golden.mjs \
  --skill cockpit-agent@16 --skill research-specialist@8 \
  --skill offer-architect@4 --skill money-model-designer@4 --skill lead-engine@4
```

1. **Read the header back before walking away.** It must list all five pins and must NOT contain
   `PARTIAL RUN` — that line means evidence is suppressed, and it is what silently wasted two
   earlier attempts.
2. Green ⇒ one evidence row per pin ⇒ `activateSkill` each of the five ⇒ confirm with
   `getActiveSkill` that the ACTIVE row is the version you pinned.
3. Then tick ACTN-03 in ROADMAP **and** REQUIREMENTS **by hand** — `gsd phase complete` silently
   no-ops the ROADMAP checkbox and table.

**Free tokens do NOT unblock this** (checked, 2026-08-02): `gpt-4o-mini` is eligible for OpenAI's
complimentary-tokens programme, but the vault seed embeds with `text-embedding-3-small` BEFORE
case one and embeddings bill separately, and fixtures 32/33/34 need hosted web search at
`WEB_SEARCH_CALL_USD = $0.01` per call. Both sit outside the programme. A partial `--only` run
cannot substitute: evidence is suppressed on filtered runs BY DESIGN.

### The one consequence of deferring — READ THIS BEFORE PLANNING 18-08

**18-08 is gated on Phase 16 closing, so deferring ACTN-03 also stalls Phase 18 at 7/10.** The
gate exists because `cockpit-agent` has ONE candidate stream: Lane R holds it un-activated at v16,
and 18-08 must teach `createDocument` in that same body, so a concurrent edit would mint a
candidate carrying both lanes' prose and the next eval would certify instructions nobody tested.

That contract assumed Phase 16 would close soon. It no longer will, so the owner has a choice to
make DELIBERATELY rather than by drift:

- **(a) Hold 18-08.** Phase 18 stays 7/10 until credits exist. Safest, costs schedule.
- **(b) Let 18-08 edit the body to v17 and certify BOTH lanes in the same eventual gate run.**
  `--skill` is already multi-pin, so one run can carry it. The price is that the closing gate then
  certifies 18-08's teaching too, which means 18-08 owes its own fixtures BEFORE that run — without
  them the gate would certify the `createDocument` teaching having never exercised it, which is the
  exact vacuity 22.1b and this phase have spent weeks removing.

Recommendation: **(b) with fixtures**, because it converts two paid gate runs into one. Do not take
(b) without the fixtures.

---

## UPDATE 2026-08-07 — THE BILLING BLOCKER MOVED VENDORS. GROUNDING IS QUOTA-REFUSED ON GEMINI.

**Read this before acting on the resume recipe above — that recipe is for the OpenAI pins, and the
pins are no longer OpenAI.** The research pins were repointed to Gemini on 2026-08-07 (the
two-vendor alternation in `packages/cost/src/cost.ts`), which was supposed to route around the $0
OpenAI balance. It does not, yet.

### What was built

`probeGemini` (llm.ts) gained `grounded: true`, exposed as `pnpm probe:gemini:grounded` /
`node scripts/probe-gemini.mjs [model] --grounded`. It attaches `buildWebResearchTool()` — the
PRODUCTION tool record, extracted from inside `buildCockpitTools` to module scope for this, so the
probe and the research loop cannot build different tools — and adds three FAILING verdicts for
200-OK responses that read as success: `no_search_call`, `no_sources`, `tool_vendor_mismatch`.
Rationale for each is in `docs/playbooks/agent-runtime.md`; an offline guard in
`cockpitTools.test.ts` pins the record key and the provider-match, mutation-verified RED.

### What it measured — and the control is the point

| model | plain | with `googleSearch` |
|---|---|---|
| `google/gemini-3.5-flash` (`RESEARCH_MODEL`) | **PASS** (in=8 out=93, $0.000235) | **429 quota** |
| `google/gemini-3.5-flash-lite` (`RESEARCH_FALLBACK_MODEL`) | **PASS** (in=8 out=1, $0.000001) | **429 quota** |

Same AI Studio key (`GOOGLE_GENERATIVE_AI_API_KEY`, so Vertex was never reached), same deployment,
seconds apart. **The key is not exhausted, and this is an ENTITLEMENT not a spent allowance:
waiting for a daily reset does nothing.** An ordinary free-tier rate limit (reproduced on
`gemini-2.0-flash`, which 429s on the plain call too) names the exhausted bucket in
`QuotaFailure.violations` and carries a `retryDelay`; the grounded refusal carries neither, while
a plain call to the same model returns 200 in the same second. Google Search grounding on
the free tier is entitled to ZERO. A 429 is `isRetryable`, so the
`flash` -> `flash-lite` fallback fires and hits the same quota, failing twice.

### What is STILL unknown — do not read a 429 as "the wiring works"

The request never got past quota, so none of the three new verdicts fired and all three original
unknowns stand: whether Gemini accepts the tool SHAPE (the cast in `buildWebResearchTool` is an SDK
typing gap no compiler checks), whether the SDK flags the hosted call `providerExecuted` (the sole
input to `webSearchCalls` -> `searchFeeUsd`; a missing flag bills $0 on every research run), and
whether Google's grounding metadata reaches `res.sources` (an empty array makes
`declaredQuestionScope && sources.length === 0` fire on every run and reddens fixtures 32/34 for a
reason unrelated to the skill body).

### Status and the three doors

**Phase 16 stays 8/9 and ACTN-03 stays Pending.** The blocker is unchanged in KIND (billing) and
changed in VENDOR. Ranked:

1. **Bill the AI Studio project.** Smallest change, keeps the pins, `resolveModel` untouched.
2. **Bill the Vertex project.** Also opens Imagen/Veo; already refused once for billing the same
   day. Vertex has no free tier.
3. **Revert the research pins to OpenAI** and fund that account — `OPENAI_RESEARCH_MODEL` /
   `OPENAI_RESEARCH_FALLBACK_MODEL` are retained priced for exactly this two-line edit. It is the
   only door with PROVEN grounding (the 16-02 probe), but it re-inherits the $0 balance that caused
   the repoint.

**Whichever door is taken: `probe:gemini --grounded` must return PASS on BOTH pins (or the OpenAI
probe must be re-run) BEFORE any paid gate.** A green gate on an unproven grounding path certifies
nothing, and that is the mistake that already cost two paid runs on this phase.
