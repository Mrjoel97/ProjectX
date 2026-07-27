# Context Handoff — 2026-07-27

Written after a session that planned Phases 16 and 17 concurrently. Read this + `STATE.md` +
`.planning/PARALLELIZATION.md` + `CLAUDE.md` to resume.

## Where the project is

```
v2.0  Phases 10 · 11 · 12 · 13 · 14 · 15 · 15.1   ✅ CLOSED
      Phase 17  ✅ PLANNED + VERIFIED        (lane-k/calendar-actions)
      Phase 16  ⚠  PLANNED, final check in flight (lane-r/research-web)
Next: finish 16's check → settle the ONE open UX call → Stage-1 freeze on `main` → execute
```

Both phases were planned **concurrently in two git worktrees**. `.planning/PARALLELIZATION.md`'s
CURRENT CONTRACT section is the 16 ∥ 17 lane definition — read it before touching either lane.

| Lane | Worktree | Branch | Plans |
|---|---|---|---|
| R | `.worktrees/lane-r-research` | `lane-r/research-web` | 9 plans / 6 waves |
| K | `.worktrees/lane-k-calendar` | `lane-k/calendar-actions` | 4 plans / 4 waves |

Both merged `main` at `880b061` and carry the `llm.ts` memo-context fix. **Neither has run
`pnpm install` or `npx convex dev`** — every verify command in every plan needs that first.

## ~~THE GATE~~ — CLEARED 2026-07-27. Stage 1 is COMPLETE on both sides.

The freeze was **absorbed into the lanes and serialized through `main`**, not landed as one joint
commit — resolved in `22c7bb0`, recorded in `.planning/PARALLELIZATION.md`. The property that
matters is **serialization, not single-commit-ness**. Do not go looking for a joint freeze commit;
there is none to restore.

| Step | Commit | Result |
|---|---|---|
| Lane R `16-01` | `4d32ce1` → merged `7386744` | `dispatchResearch` literal, `vaultDocuments.retrievedAt`, VERB entry, watch paths, the three `llm.ts` signature widenings |
| Lane K `17-01` | `468cbd6` → merged `0da5041` | `calendar_event` + the `externalAction` arm, two trace literals, staged-event `plans` fields + `by_calendar_run`, `calendarFixtures`, the calendar plan card, pure `@pikar/core` calendar module |

Lane R went first so its `llm.ts` **signature** widenings landed before `17-03` adds a tool key
inside that shape. Lane K's down-merge and its merge to `main` both had **zero conflicts** — the
freeze working as designed. Both lanes may now run their remaining waves **in parallel**.

**The one file still shared after the freeze is `convex/llm.ts`** (16-05, 16-06 ∥ 17-03).
Whichever lane reaches its `llm.ts` wave second merges `main` down FIRST and re-runs `tsc`.

## RESOLVED — the owner decision that gated the freeze

**`stageResearchPlan` REFUSES while a `proposed` email draft is on the card** (owner, 2026-07-27).
The alternative is `resetPlan`, which `applyActOnGap` does — but only because a USER tapped a
control. Here the MODEL decides, so a research question would silently destroy a half-composed
email. Consequence, accepted: "research this" can fail with *"finish or discard your draft first."*
`plans.byThread` **stays `.unique()`** — no multi-row schema change, so the one-root-envelope
invariant `16-06`/`16-07` are planned against holds. The >1-plan-row fix is a later phase's work.

## ⚠ NEW — the typecheck baseline is not clean, and `pnpm typecheck` lies

`turbo`'s `typecheck` task declares no `inputs`, so its cache restores a **stale pass without
running `tsc`**. Always pass `--force`. Forced, `@pikar/backend` has **52 errors** — all in
`*.test.ts`, **zero in production source**, all Phase-1 vintage (`tsconfig.json` sets
`"types": ["node"]`, starving test files of ambient types, while `include` sweeps them in).
**Check the DELTA, not an absolute-clean gate**, which no plan in either phase can meet as written.
Full analysis in `PARALLELIZATION.md` (`0d85975`).

## Phase 16 — what is owed

The **third plan-checker pass** was in flight when this was written. Two earlier passes each found
3 blockers (all fixed); then D9-REVISED + D12 forced a targeted replan of `16-06`/`16-07` and
amendments to `16-03`/`16-05`/`16-08`. **That replan is what the check is verifying.** If it did not
finish, look for `16-CHECK-PARTIAL.md` in the phase dir before re-running.

### Verified by hand — do NOT re-derive

- **`dispatchGuard.test.ts:16-24` PRESCRIBES the async design** — it ends *"dispatch RETURNS to the
  orchestrator, which starts the specialist loop as its own governed call."* Written in Phase 15,
  before research existed. The comment is SATISFIED, so the D9 amendment obligation is correctly
  **DROPPED**, and `16-06` asserts `git diff --name-only` does not list that file. **Do not amend it.**
- **`stopWhen?: Arrayable<StopCondition<…>>`** exists in the shipped `ai` typings
  (`dist/index.d.ts:4838`) — so `stopWhen: [stepCountIs(n), outOfClock]` stops BETWEEN steps and
  returns partial findings. `AbortSignal` throws instead. Different mechanisms; the hard abort stays
  as a backstop for a single hung step.
- **`plans.byThread` is `.unique()`** (`plans.ts:281`) — the one-row-per-thread interlock really does
  yield one persisted root envelope (it replaced the per-turn closure two passes had validated).
- **D12's test pins a LITERAL `45_000`**, never the `CALL_TIMEOUT_MS` symbol, with the RED mutation
  named (change `callTimeoutMsFor`'s fallback to `RESEARCH_CALL_TIMEOUT_MS`).

### ⚠ A stale claim that was propagated into 11 files — partially swept

`convex/audit.test.ts` is **GREEN** (verified, 1/1). The 2026-07-26 handoff already recorded the
backend suite at 643/643 with `auditCounts` fixed, but this session's research agents found the older
"documented pre-existing red" line in legacy phase docs and carried it into both phases.

**This is the dangerous class of stale doc: it instructs an executor to ignore a red in exactly the
file their change might break** — and Phase 16 touches the audit path heavily.

Swept so far: both `VALIDATION.md` files (corrected), `17-01`/`17-04` (`<verification>` blocks).
**Still carrying it:** `16-RESEARCH.md`, `17-RESEARCH.md`, and `16-01`/`16-05`/`16-06`/`16-08`/`16-09`.
The lane-r plan files were left alone deliberately — the checker was reading them. **Sweep them
before executing Phase 16.** RESEARCH files may keep the original wording as a historical record;
VALIDATION supersedes them.

## The locked decisions (16-CONTEXT.md is authoritative — this is the index)

D1 hosted OpenAI `web_search`, no new dep/key · D2 one swap seam, not an abstraction layer ·
D3 `research` joins `SPECIALIST_ROUTES`, `diagnose()` NOT widened · D4 least-privilege tool-set is
SC#1's containment · **D5 CORRECTED** — retrieved page text is provider-side and CANNOT be fenced
(a "retrieved text is fenced" test would pass because the text is ABSENT); containment is the empty
grant proved POSITIVELY, the OUTPUT fence, and an SSRF scan with a non-vacuity floor ·
D6 §4 refs/counts only · D7 freshness is a stored queryable field · D8 probe before pinning the model ·
**D9-REVISED** async memo terminal, supersedes D9 — read its CORRECTION block ·
D10 sophistication = agentic depth in the specialist loop (owner directive) ·
D11 degradation contract, six failure modes, proven by mocks AND `eval:golden` ·
**D12** research-only `RESEARCH_CALL_TIMEOUT_MS ≈ 180s`; 45s unchanged elsewhere.

**The three-decision interaction is easy to break — restating it because I got it wrong once:**
async alone still aborts at 45s (the timeout is a property of the `generateText` call, not the
caller: `runSpecialistTurn` → `runAgentLoop`). D12 alone builds a bigger cliff that still discards
work. D11 alone makes truncation the ROUTINE outcome, so the sophistication silently never happens.
**All three are required.**

## Phase 17 — done, nothing owed

4 plans / 4 waves (serial). Research **REFUTED** the roadmap's "likely skippable":

- `inline` cannot create an event (a Convex mutation cannot `fetch`, and `executePlan` is a
  `tenantMutation` pinned by source scan) and `workflow` IS the gmail fan-out — so a third `Arm`
  (`externalAction`, on `retrier.run`) is **structurally forced**.
- `freshAccessToken` returns `{ok:true}` for a token lacking the calendar scope → 403 lands AFTER
  the human approved. Read the persisted `gmailTokens.scope` first.
- **Use `freeBusy.query`, not `events.list`** — it returns only busy `{start,end}`, deleting the
  §4/§2-D PII problem by construction rather than by a redaction layer.
- `events.insert` with attendees makes GOOGLE send invitations outside the governed path. Attendees
  are out of scope, enforced by the ABSENCE of both `attendees` and `sendUpdates`.
- A client-supplied event id gives exactly-once free — 409 MEANS success.
- The retrier's `onComplete` carries only `{runId, result}` (no `context`), so
  `deadLetter.onPipelineComplete` cannot be reused; correlation rides `returnValue` (typed refs-only,
  making §4 structural) plus a `plans.by_calendar_run` index — **which is why it had to be caught
  before the schema freeze.**

**Carries a drive-by fix:** `replyToMessage` is in `agentSteps.tool` but has no `VERB` entry, so every
inbox-reply trace row renders the generic "Working…"/"Done" `FALLBACK`. A live defect since Phase
3.11, found by specifying a parity test precisely enough to be checkable. Fixed in `17-01` Task 1e,
labelled as unrelated.

**Cannot be fully verified without the owner** — 4 criteria need owner-granted Google OAuth consent.

## Environment

- The local Convex backend was RESTARTED this session and `convex dev` ran **from that session — it
  dies with it.** Restart in a real terminal from `packages/backend`.
- `pnpm start` serves a FROZEN production build. Rebuild before any UAT and check the build timestamp
  against `git log` before believing a UI symptom.
- `npx convex data <bigTable>` times out / dumps megabytes (`vaultDocuments`). The
  `UV_HANDLE_CLOSING` assert is benign exit noise.
- **Network is flaky here: two subagents died to ECONNRESET, one to the session limit.** Tell
  long-running agents to commit incrementally and flush partial work before stopping.

## Also still open from the previous handoff

1. **Phase 15.1 SC#5** (perceivable tier difference) — run this session, **INCONCLUSIVE**. With the
   framework pinned so only tier varied, the two memos were near-identical. The negative assertion
   (solopreneur output never presumes delegation) holds; "tier visibly changes treatment" does not
   survive into memo output. See `.planning/phases/15.1-*/deferred-items.md`.
   **SC#6, SC#1c and SC#3 were PAID live this session** — details in the same file.
2. `.planning/WAVE-0.md` §A/§B/§D post-integration items (the `evaluations` facts split,
   `gaps[].proofMetricPath`, weekly-cron hardening — `runWeekly`'s unbounded `.collect()` dies as a
   cliff near ~3,000 tenants).
3. Phase 15's specialist-body eval gate is still UNPAID; those three bodies ship DARK.
4. The dev tenant is left at `sme` / `tierSource: "derived"`, not its original factless legacy row.
