# Deferred items — Phase 19

Out-of-scope discoveries. Logged, NOT fixed (executor scope boundary).

> **RESOLUTION PASS — 2026-08-10, plan 19-10.** The owner directed that all three open items be
> folded into 19-10 rather than carried out of the phase. **All three are now closed** — outcomes
> are recorded inline under each item below. Nothing here is left as an undated note.
>
> | # | Item | Outcome |
> |---|---|---|
> | 1 | `eval:golden --self-check` red on `main` since Phase 20 | **RESOLVED** — green again; exemption DERIVED from `skill.ts` |
> | 2 | `run-eval-golden.mjs --list` does not exist | **RESOLVED** — corrected in the playbook and in `19-VALIDATION.md`; root cause turned out to be broader than this one flag |
> | 3 | `STATE.md`'s `stopped_at` holds unescaped `"` | **RESOLVED** — fixed in commit `12bde78` before this plan started; a parse assertion now runs |

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

  ### RESOLVED 2026-08-10 (19-10, commit `e326ef9`) — remedy 2, and it was NOT an owner call

  **The decision already existed at the canonical site.** `packages/contracts/src/skill.ts` carries
  a written, dated `DELIBERATELY UNGATED — do NOT add to GATED_SKILLS` justification above
  `MEDIA_DIRECTOR_SKILL` (Phase 20, MEDIA-01), with the mechanical reason spelled out: the runner
  drives `runCockpitAgent` over TEXT fixtures and structurally cannot drive a script /
  art-direction / storyboard turn, so gating it would deadlock the row at v1 on its first body
  edit — the documented `content-drafter` / `document-analyst` trap. It is one of **six** rows
  carrying such a justification. So this was never an unmade architectural decision; it was a made
  decision the assertion could not see, which is a different and much cheaper problem.

  **The fix:** `run-eval-golden.mjs` now DERIVES the exemption set from `skill.ts` — the same
  read-the-constant-off-disk idiom it already uses for `GATED_SKILLS` — instead of re-listing it.
  A dispatchable route's skill must be in `GATED_SKILLS` **or** carry that written justification;
  neither, and it still fails hard. Deriving means a new exemption registers itself the day it is
  written, and **can only register by writing the justification**, which is the enforcement
  actually wanted. Two non-vacuity assertions pin the derivation so it cannot silently degrade into
  "anything goes" if the regex stops matching.

  The cosmetic half is fixed too: the ternary is gone, replaced by `SPECIALISTS[route].skillName`.

  **`--self-check` now PASSES — the first time since Phase 20.** It immediately earned its keep: it
  is the gate that proved 19-10's new `datedFollowUpCount` key can go red, at $0.

  **STILL OPEN, and deliberately so — two residual risks, both named where they belong:**
  1. **A `media-director` body edit still activates with no eval evidence.** That is the accepted
     cost of the exemption and it is stated in `skill.ts`. Revisit when a fixture can reach a media
     turn. This is the item to re-raise if media ever handles untrusted third-party input, since
     that is the property (`inbox-digest` / `reply-drafter`) that forces gating.
  2. **`runLive()` still never calls `selfCheck()`.** This is why the whole thing stayed invisible
     for a phase: the one check that stops a bad fixture before it costs a cent could not itself be
     run, and nothing in the paid path would have told you. Recorded in `agent-runtime.md` as the
     next thing to fix here. It is a two-line change and was left out of 19-10 only because
     changing what a PAID entry point does was not this plan's mandate.

## 2. The 19-09 plan's own verification command would have spent money

`19-09-PLAN.md` twice names `node packages/backend/scripts/run-eval-golden.mjs --list` as an
OFFLINE verification. **There is no `--list` flag.** Unknown argv entries are ignored, so the entry
block falls straight through to `runLive(...)` — a full paid run of every fixture. The offline
command is `--self-check`. Recorded here because the next plan author will copy the phrasing.

### RESOLVED 2026-08-10 (19-10) — and the root cause is bigger than this flag

Corrected in `contacts-crm.md`'s "How to verify" and in `19-VALIDATION.md`, both of which now state
that `--self-check` is the offline command and that **no `--list` flag exists**.

But chasing it turned up the shared root cause, which is a `--` swallowing problem across the whole
repo, not a typo in one plan:

- **`pnpm --filter @pikar/<pkg> test -- <name>` does not filter.** Measured both ways:
  `pnpm --filter @pikar/core test -- contacts` → `vitest run "--" "contacts"` → **32 files**;
  `pnpm --filter @pikar/core test contacts` → `vitest run "contacts"` → **1 file**. Every
  "filtered" command in `19-VALIDATION.md` and in nine plan summaries runs the entire package
  suite. **Drop the `--`.**
- **`pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts`** — the verbatim resume command
  every e2e spec header in this repo quotes — has the same defect: it ran all 25 specs for ~8
  minutes instead of the one file asked for.
- The nastiest consequence is in `19-VALIDATION.md` and is now recorded there: seven rows named
  `-- cockpitTools`, and `cockpitTools.test.ts` contains **zero** `executePlan` tests. They pass
  today only because the broken `--` accidentally runs `cockpit.test.ts` too. Fixing the `--`
  without fixing those file names would have turned six rows into vacuous greens.

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

### RESOLVED 2026-08-09 in commit `12bde78`, before 19-10 began

The four quotes were escaped as `\"`. The diagnosis was confirmed correct and it explains the
long-running complaint recorded repeatedly in STATE.md itself: **STATE.md carries THREE frontmatter
blocks**, so a parser that dies on the first one falls through to a stale block — which reads
exactly like "gsd-tools clobbered the frontmatter" without anything having clobbered anything.

**Standing rule for anyone appending to `stopped_at`: escape every `"` as `\"`, or prefer backticks
and avoid raw double quotes entirely.** 19-10 verified the block parses after its own append.


---

## 19-11 — a follow-up can name a FABRICATED address (`no-email`). OPEN, pre-existing.

`parseCrmOperations` (`packages/core/src/contacts.ts`) accepts **any non-empty string** as an
email. `normalizeAddress` is `s.trim().toLowerCase()` and the only check is `email === ""`, so
there is no address-shape validation at either CRM boundary.

Observed on eval run `266ef8f4` (the run that turned fixture 36 green). Turn 2 asks for a follow-up
that "isn't tied to anyone" — which the cockpit body forbids the agent from creating. The agent
satisfied the required-`email` brake by inventing one, and the plan row was staged:

```json
{"op":"addFollowUp","email":"no-email","note":"to review our pricing page","dueAt":1786698000000}
```

Why it matters: the required `email` on `addFollowUp` is 19-08's structural brake against the CRM
becoming a general task generator, and a pseudo-address defeats it. On Approve,
`applyCrmOperations` would upsert a contact row keyed `no-email`.

It also means fixture 36's green is currently green for a slightly wrong reason: `patchPlan`
REPLACES `crmOperations` wholesale, so turn 2's op overwrote turn 1's Rhea follow-up, and the count
assertions are satisfied by replacement as readily as by turn 2 correctly declining. The ACTN-05
clock fix is independently proven by the offline tests in `runCockpitAgent.test.ts`; this is a
separate hole that fix made visible.

**NOT fixed in 19-11 deliberately:** pre-existing (shipped 19-06), outside the executor scope
boundary (not caused by this plan's changes), and the paid-verification allowance was spent.

**The fix:** an address-shape check in `parseCrmOperations`. Reuse whatever `addRecipients` already
bounces invalid addresses with rather than authoring a second rule. Expect turn 2 to be refused and
the model to ASK — which the body already tells it to do — leaving turn 1's follow-up standing.
Budget one `--only 36` re-verify at roughly $0.006.
