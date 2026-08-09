# Deferred items — Phase 19

Out-of-scope discoveries. Logged, NOT fixed (executor scope boundary).

## 1. `eval:golden --self-check` has been RED on `main` since Phase 20 — the offline gate was unrunnable

Found by 19-09 while verifying fixture 36. Two independent stale assertions, both invisible
because **`runLive()` never calls `selfCheck()`** — the one check that stops a bad fixture before
it costs a cent could not itself be run.

- **(a) FIXED in 19-09** — `selfCheck`'s hardcoded `SPECIALIST_ROUTES` snapshot
  (`run-eval-golden.mjs`) omitted `media`, which Phase 20 (20-08) registered in
  `packages/core/src/specialists.ts`. One-line re-snapshot; the assertion's stated intent ("read
  off the core registry") is unchanged.
- **(b) NOT FIXED — owner decision, raised at 19-09's checkpoint.** With (a) fixed, the next
  assertion fails honestly:

  ```
  [eval:golden] media must also be GATED — a body edit rides the gate
  ```

  `media` is a dispatchable specialist route (`SPECIALIST_ROUTES`), its skill is `media-director`
  (`specialists.ts` `SPECIALISTS.media.skillName`), and `media-director` is **not** in
  `GATED_SKILLS` (`packages/contracts/src/skill.ts`). So a `media-director` body edit activates
  with no eval evidence, which is exactly what the 15-06 assertion exists to forbid.

  Three ways out, all owner calls:
  1. Add `MEDIA_DIRECTOR_SKILL` to `GATED_SKILLS` — but then its first body edit deadlocks unless a
     golden fixture can reach it (the documented `content-drafter` / `document-analyst` trap).
  2. Record `media-director` as DELIBERATELY UNGATED with a reason, and add the exemption to the
     assertion (the `content-drafter` precedent, which has a written justification).
  3. Decide the assertion over-reaches for routes `diagnose()` never emits.

  Also cosmetic, and worth folding into whichever fix lands: the loop's route→skill mapping is a
  hand-maintained ternary (`route === "research" ? "research-specialist" : route`), so the error
  above names `media` rather than the real skill `media-director`. The registry already carries
  `skillName`; the ternary is a second copy of it.

## 2. The 19-09 plan's own verification command would have spent money

`19-09-PLAN.md` twice names `node packages/backend/scripts/run-eval-golden.mjs --list` as an
OFFLINE verification. **There is no `--list` flag.** Unknown argv entries are ignored, so the entry
block falls straight through to `runLive(...)` — a full paid run of every fixture. The offline
command is `--self-check`. Recorded here because the next plan author will copy the phrasing.

## 3. STATE.md’s `stopped_at` scalar contains UNESCAPED double quotes — likely why gsd-tools keeps clobbering it

Found by 19-09 while hand-editing STATE.md. The frontmatter `stopped_at:` value is a YAML
DOUBLE-QUOTED scalar, and it currently holds **4 unescaped `"` characters** — all pre-existing
19-08 prose (`TS2322: Type '"stageCrmWrite"'` and `Record<AgentSmokeOp["kind"], StepTool>`).
An unescaped `"` TERMINATES the scalar early, so a real YAML parser sees a truncated `stopped_at`
followed by garbage — which is a plausible root cause for the complaint recorded repeatedly in
STATE.md itself: *"gsd-tools state advance-plan CLOBBERED the frontmatter block AGAIN"*,
hand-restored at least twice in this phase alone.

NOT fixed here: the text belongs to 19-08, no YAML parser is installed in the workspace so the
impact could not be demonstrated, and 19-09 had no mandate to rewrite another plan’s record.
**Two ways out, both cheap:** escape the four quotes (`\"`), or switch `stopped_at` to a YAML
block scalar (`stopped_at: |-`), which needs no escaping at all and is far friendlier to an
18 000-character value. Whoever fixes it should add one assertion that the frontmatter parses.
