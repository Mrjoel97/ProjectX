# 20-04 — SUMMARY

**Plan:** the media budget rail + the transactional JOB reservation. **Status: complete**
(2026-08-02). Cost to build: **$0** — no test in this plan calls fal, OpenAI or Vercel.

## What shipped

| File | What it is |
|---|---|
| `packages/backend/convex/guardrails.ts` | `mediaSpendCents` (keyed) + `deploymentMediaSpendCents` (keyless) on the ONE limiter, the media kill switch + setter, `mediaRemainingCents`, and `getConfig` exported as `getGuardrailConfig` |
| `packages/backend/convex/media.ts` | **NEW.** `reserveJobInner` + the `reserveJob` internalMutation — the one money gate |
| `packages/backend/convex/media.test.ts` | **NEW.** 22 tests, every SC3 rail assertion, $0 |
| `docs/playbooks/media.md` | the `## The budget rail (20-04)` section, the four mutation-check observations, two corrections (below) |

Verification: `media` **22/22**, `guardrails` **9/9**, `importGuard` **63/63**.
`node scripts/check-playbooks.mjs` exits 0. Biome clean on both new files; `guardrails.ts`'s
diagnostic set is **identical to its `git show HEAD:` baseline** (1 pre-existing format error on the
`remainingDailyCents` line, unmoved).

## `reserveJobInner` — the signature VERBATIM (20-07, 20-09 and 20-16 all call it)

```ts
export async function reserveJobInner(
  ctx: MutationCtx,
  a: {
    tenantId: string;
    planId: Id<"plans">;
    blocks: readonly Block[];
    clipSeconds: number;
    withCaptions: boolean;
  },
): Promise<
  | { ok: true; batchId: string; estUsd: number; estCents: number; lineCount: number }
  | { ok: false; reason: ReserveRefusal }
>;

export type ReserveRefusal =
  | "kill_switch" | "unknown_model" | "over_job_cap" | "illegal_duration"
  | "narration_too_long" | "narration_too_short"          // ← BOTH ends, see deviation 1
  | "media_daily_exhausted" | "deployment_media_exhausted";
```

**Call it DIRECTLY, not via `runMutation`.** 20-07's approve arm runs inside `executePlan`, itself a
`tenantMutation`, and a Convex mutation cannot `runMutation`. The direct call keeps the reservation
in the SAME transaction as the plan's `proposed → approved` CAS — that is what makes "approve once,
reserve once" true. The `reserveJob` internalMutation wrapper exists for the canvas path (20-09) and
for tests.

`lineCount` counts `mediaJobs` ROWS (video + tts + stt). **The render line is reserved but gets no
row** — it has no `falRequestId` and no webhook.

## `DEPLOYMENT_MEDIA_BUDGET_CENTS` = 10,000, and the exposure arithmetic (ADR-012 records this)

D10 names only the per-tenant number, so the ceiling was a planning decision. Chosen at **10,000**
because it keeps the **same 10× ratio** `DEPLOYMENT_BUDGET_CENTS` (5,000) holds over
`DAILY_BUDGET_CENTS` (500) — one ratio to remember across both rails.

| Rail | Per tenant | Deployment ceiling |
|---|---|---|
| LLM | 500 ($5) | 5,000 ($50) |
| Media | 1,000 ($10) | 10,000 ($100) |

**Worst-case daily exposure = $100 media + $50 LLM = $150, across four windows that never share.**
Without the keyless media ceiling it would be `N × $10`, unbounded in N, with the manual kill switch
as the only global stop.

## The four mutation checks — every one OBSERVED RED, then restored byte-identical

| Mutation applied | What actually fired |
|---|---|
| `rateLimiter.limit(...)` removed from `reserveJobInner` | **7 of 22 RED**, incl. concurrency — no window moved at all |
| tenant `check` sized `count: 1` instead of `count: estCents` (the `preCall` shape) | concurrency RED **on the target line**: `expected [ {…}, {…} ] to have a length of 1 but got 2` — both jobs won |
| cents floor moved from the batch total to per-line | **6 RED**: 13-line sub-cent job `expected 15 to be 4`; §4.1 job `expected 309 to be 305` |
| narration band pre-flight guard deleted | **3 RED**, each returning a 5-key `ok: true` — **the over-length job reached a reservation. Money moved.** |

Both files were `diff`ed against a pre-mutation copy after every restore; both came back
byte-identical, and the suite is green.

## DELIBERATE DEVIATIONS — read these before writing a dependent plan

1. **The narration guard uses the BAND, not the flat ceiling — and there is a NEW refusal code.**
   The plan said `block.narration.length <= MAX_CHARS_PER_BLOCK`. Since it was written, 20-13
   shipped `minCharsFor(clipSeconds)` / `maxCharsFor(clipSeconds)` and the playbook invariant became
   *"a narration line has a BAND, not a ceiling."* `reserveJobInner` uses the band, so it also
   returns **`narration_too_short`** — a code the plan does not list. Too short is as fatal as too
   long: `assemble_final.sh` hard-errors on a take whose speech falls outside
   `[clipSeconds - 1.4, clipSeconds]`, and both land after the clips are paid for. The codes match
   `ParsedDeck`'s spelling so a UI can share one message map.
2. **The §4.1 job is 305 cents, not the plan's 306, and `media.md`'s table was corrected.** The old
   `voice (~1,200 chars)` figure is **not reachable**: 1,200 chars over 6 blocks is 200/block and
   the 10-second band caps a block at **140**. The largest legal 6-block job is
   `$3.00 + $0.0168 + $0.008 + $0.02 = $3.0448 → 305 cents`. Nothing regressed — the ceiling got
   tighter when the band shipped, and the estimate predates it.
3. **The D12(a) rail assertion is 4 cents vs 15, not the plan's "1 cent, not 13".** No job reachable
   through `reserveJob` can total under 2 cents, because the flat `$0.02` render line is on **every**
   job by construction. The rail-level construction is 13 unpaid TEXT blocks at 5 s: true cost
   `$0.03118` → **4 cents** once-only vs **15** floored per line (13 × 1 + 2). Same defect, same
   ~4× magnitude. The purer "13 sub-cent lines → 1 cent, not 13" already lives in
   `packages/cost/src/media.test.ts` (20-01) and is untouched.
4. **A `clipSeconds` legality check was added BEFORE the band check.** `chooseMediaBatch` would
   catch an illegal duration anyway, but with the check first the band is computed against a legal
   window rather than a nonsense one. Two lines, reusing the exported `CLIP_SECONDS`.
5. **The 720p refusal is asserted at `chooseMediaBatch`, not through the rail.** `reserveJob` has
   **no resolution argument by design** — 480p is pinned in `MEDIA_DEFAULT_VIDEO` so nobody can pick
   a tier that triples the invoice. Adding a parameter purely to test it would be config for a value
   that never changes. The test asserts what the pin is *worth*: the identical 6-block deck is `ok`
   at 480p and `over_job_cap` at 720p. The **12-blocks-at-480p** refusal does go through the rail.
6. **The wrapper's `type` validator is a CLOSED 4-literal union**, unlike `plans.shots[].type` which
   is `v.string()`. That schema chose `v.string()` to avoid a second place to widen; this is a money
   gate, and an unknown shot type must be a boundary rejection rather than a block that silently
   estimates to zero because `isPaidBlock` found no `PAID` entry for it.

## TWO PRE-EXISTING REDS FOUND, NEITHER FIXED HERE — both need an owner

1. **`skills.test.ts:803` is RED on `main`, and it is 20-13's.** The `MAX_INLINE_STRING` scan (the
   CLAUDE.md §5 no-hardcoded-prompts guard) walks every `convex/**/*.ts` and flags
   `convex/render/assembleScript.ts: 18085-char inline string` — the bundler-safe mirror committed
   in `de73981`. The offender list has exactly ONE entry and it is not a 20-04 file. Full backend
   suite: **928/929, 55/56 files.** Fixing it means either raising a governance threshold or
   restructuring another plan's file, so it is left for 20-13's owner.
2. **`media:spendForPeriod` does not exist and no plan authors it.** `media.md`'s D5 reconciliation
   procedure said the query "lands with plan 20-04". It does not — 20-04 ships only the reservation —
   and a grep across all seventeen Phase-20 plans finds no plan authoring it or `media:listJobs`.
   `mediaJobs.actualCents` is written by 20-06's webhook, so **the reader is the missing half of the
   D5 procedure.** Recorded as an ⚠️ block in the playbook; the natural home is 20-11's live gate,
   but that assignment has not been made.

## Typecheck — measured, and the one delta is a CODEGEN artefact, not a type error

`npx tsc --noEmit` from `packages/backend`: **14 errors, all in `convex/*.test.ts`.** Thirteen are
in files this plan never touched. The fourteenth is mine and is:

```
convex/media.test.ts(75,23): error TS2339: Property 'media' does not exist on type '{ agentSteps: … }'
```

**`internal.media` is absent from `convex/_generated/api.d.ts` because codegen has not run since
`media.ts` was created.** `_generated/` is git-ignored and produced by codegen (CLAUDE.md §7), and
`npx convex codegen` could not run here: `CONVEX_DEPLOYMENT` is a **local** deployment and the local
backend would not boot (timed out at both 30 s and 180 s). The tests all pass because `convex-test`
resolves modules through `import.meta.glob`, not through the generated API. **This error disappears
on the next `npx convex dev`** — no source change can fix it and none was attempted.

⚠️ **The 150 baseline in `STATE.md` is stale.** The live count is **14**, all in `convex/*.test.ts`,
zero non-test. Something (most likely 22.1-03's `@ts-expect-error import.meta.glob` sweep, which
STATE describes as "100 of the 150 errors across 37 files") already landed. Re-measure before using
150 as a gate.

## What the next plans inherit

- **20-07** calls `reserveJobInner(ctx, …)` directly inside `executePlan`. Do NOT `runMutation`.
- **20-09** calls `internal.media.reserveJob` from the canvas path, and must map all eight refusal
  codes — **including `narration_too_short`**, which the plan text does not list.
- **20-06** writes `actualCents` on the rows this plan inserts at `status: "queued"`; every row
  already carries `batchId`, `blockIndex` (`-1` for the deck-wide `stt`), `model`, `spec`,
  `promptHash` and its own unfloored `estUsd`.
- **20-11's ADR-012** records the 10,000 ceiling and the `$150/day` worst-case arithmetic above.
