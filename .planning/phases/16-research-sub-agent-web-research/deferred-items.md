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
