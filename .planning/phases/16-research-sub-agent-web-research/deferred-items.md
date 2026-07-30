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
