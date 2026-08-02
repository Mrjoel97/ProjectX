# 20-05 — SUMMARY

**Plan:** the fal submit adapter. **Status: complete, UNCOMMITTED** (see `## Committing` — two of
the five files carry a foreign lane's uncommitted hunks). Cost to build: **$0** — every test stubs
`fetch` or takes the `FAL_FIXTURE` branch; nothing reached fal.

## What shipped

| File | What changed |
|---|---|
| `packages/backend/convex/gmailAuth.ts` | `async function hmacHex` → `export async function hmacHex`. **One word. No behaviour change.** |
| `packages/backend/convex/media.ts` | `+~300` lines: `requireEnvMedia`, `SubmittableSpec`, `buildSubmitBody`, `falReasonCode`, `submitLine`, `toSubmittable`, `batchToSubmit`, `claimLine`, `recordSubmission`, `submitBatch` |
| `packages/backend/convex/media.test.ts` | 34 → **59 tests** |
| `docs/playbooks/media.md` | `## The submit adapter (20-05)` + `Last verified` bumped |
| `docs/playbooks/cockpit.md` | `Last verified` bumped, naming the `hmacHex` export and what did NOT change |

Verification: `media.test.ts` **59/59**; full backend **967/967 across 56 files**; backend
`tsc --noEmit` **13 errors — the exact pre-existing baseline, delta 0**, none in `media.ts` or
`media.test.ts`; `biome check` clean on both media files (baseline via
`git show HEAD:<path>` → throwaway sibling → check → delete, per the shared-tree rule).

## THE EXACT fal REQUEST-SCHEMA FIELD NAMES USED — for plans 20-14 and 20-17

`buildSubmitBody` emits **exactly** these keys and no others:

```ts
// fal-ai/wan-25-preview/text-to-video
{ prompt, resolution: spec.resolution, duration: String(spec.seconds), enable_prompt_expansion: false }
// fal-ai/flux/schnell
{ prompt, image_size: { width: spec.width, height: spec.height }, num_images: 1 }
```

- `duration` is a **STRING**. `String(seconds)` is at the boundary; submitting the number `10`
  fails schema validation *after* the reservation is taken.
- `enable_prompt_expansion` defaults **true** and is pinned off — otherwise the prompt we priced is
  not the prompt that ran.
- `num_images` defaults `1` and is a **straight price multiplier**; pinned for the same reason as
  `resolution`.

**Plan 20-14 inherits:** the tts arm is `{ text, voice, sample_rate_hertz: 24000 }` (20-01's
preflight); it must read `plans.shots[blockIndex].narration`, **not** `.prompt` — the `submitBatch`
loop's text read is a single line and is commented with exactly that.
**Plan 20-17 inherits:** the stt arm is `{ audio_url, keyterms: [] }` — **keep `keyterms` empty,
+30%**.

## THE WEBHOOK URL, VERBATIM — plan 20-06 must match this character for character

```ts
const webhookUrl = `${siteUrl}/fal/callback/${line.jobId}.${await hmacHex(line.jobId, secret)}`;
// siteUrl = requireEnvMedia("CONVEX_SITE_URL"), secret = requireEnvMedia("FAL_WEBHOOK_SECRET")
// both read ABOVE the loop, so a missing secret refuses the batch before line 1 claims itself
```

The `gmailAuth.buildAuthorizeUrl:59` construction, per **JOB ROW** rather than per tenant. The
separator is a `.` and the jobId is recovered with **`lastIndexOf(".")`**, not `split(".")` — a
Convex id contains no dot today, but `verifyState` already uses `lastIndexOf` and 20-06 should too.
**Nothing is stored** (20-02's recorded deviation): 20-06 re-derives with
`ctx.db.normalizeId("mediaJobs", raw)` + a fresh `hmacHex`. A test in `media.test.ts` re-derives the
segment from the jobId and asserts two lines get two *different* segments.

## `buildSubmitBody`'s signature — 20-14 and 20-17 each add an arm

```ts
export type SubmittableSpec = Extract<MediaSpec, { kind: "video" | "image" }>;
export function buildSubmitBody(spec: SubmittableSpec, text: string): Record<string, unknown>;
```

**Widen the `Extract<>` alias and the `const _never: never = spec` arm goes RED until you write the
matching `case`.** That is the whole mechanism.

## Deliberate deviations from the plan — read these before writing a dependent plan

1. **The `never` arm is over a NARROWED alias, not over `MediaSpec`.** The plan asked for
   `const _never: never = spec` with `tts`/`stt` left as *live compile errors until 20-14/20-17*.
   Taken literally that leaves `tsc` permanently RED and contradicts the same plan's "typecheck
   delta exactly 0" gate — `MediaSpec` has **six** members (`video|image|tts|stt|render|free`), and
   `render`/`free` have no provider request at all, so arms for them would be lies rather than gaps.
   The shipped form keeps the mechanism and compiles today: the parameter is
   `Extract<MediaSpec, {kind:"video"|"image"}>`, and **widening that one alias is the act that fires
   the guard**. The plan's mutation check was run in that translated form and is recorded below.
2. **There is NO audio field on the submit, and Open Question 5 closes at the ASSEMBLER.** The plan
   said *"the audio field is present and explicitly false on every video submit"*. **The endpoint
   has no audio toggle** — 20-01's preflight is explicit: *"There is no `enable_audio` flag. Audio
   is `audio_url` (optional)."* Sending an invented `audio: false` would be a guess at a money
   boundary. Wan 2.5 generates native audio and we cannot ask it not to — but that is **not** a
   fight with the D8 voiceover bed: `render/assemble_final.sh`'s LEVEL LAW already ducks a clip's
   own diegetic track to `SFXVOL 0.20` under a voice pinned at 1.0 (`assemble_final.sh:70,156-166`),
   and clips with no audio stream take the `HASAUD` fallback branch. The pin is expressed as
   *"`audio_url` is never sent"* plus a test asserting **no key matching `/audio/i`** appears in any
   video body.
3. **`SubmitResult` carries `blocked`, not `retryable`.** The plan's behaviour list wanted "a
   distinct retryable code" for 5xx. `submitBatch` never branches on retryability — step 4 of the
   plan hands that to the retrier's own policy — so a `retryable` field would have been a value
   nothing reads. `blocked` (the 422 arm) is the only bit that changes a row, and 422-vs-5xx
   distinctness is asserted directly on the codes (`content_policy_violation` vs `http_503`).
4. **`batchToSubmit` is deliberately UNFILTERED by status.** Filtering `queued` in the reader would
   have made the two-consecutive-runs test pass *with `claimLine` deleted* — i.e. it would have made
   the plan's own mutation check vacuous. `claimLine` is the sole gate, and that is provable.
5. **Two failure codes the plan did not name.** `missing_shot` (the plan row has no shot at this
   `blockIndex` — fails the line with **zero fetches**, never an empty prompt) and `no_request_id`
   (a 200 whose body carries no ticket — a line that would otherwise be silently lost forever, since
   the webhook is the only other way it can land).
6. **`submitBatch`'s env reads are hoisted above the loop** rather than inlined at the URL mint as
   the plan's snippet showed. Same fail-closed semantics, one rung better: a missing
   `FAL_WEBHOOK_SECRET` refuses the batch **before line 1 is claimed**, instead of stranding line 1
   at `submitted` with nothing sent. There is a test for exactly that.
7. **Kinds this plan does not wire are checked BEFORE the claim**, so `tts`/`stt` rows are left at
   `queued` untouched for 20-14/20-17 rather than claimed-then-skipped.

## The three mutation checks — every one observed, then restored

| mutation | what fired |
|---|---|
| delete `resolution: spec.resolution` from the video arm | **2 tests RED** — `expected { prompt, duration, … } to deeply equal { prompt, resolution, … }` |
| widen `SubmittableSpec` with `"tts"` (what 20-14 will do) | `media.ts(516,13): error TS2322: Type '{ kind: "tts"; model: string; characters: number; }' is not assignable to type 'never'` |
| …then replace the arm with `default: return {}` | the TS2322 **disappears** — the guard was the thing doing the work |
| delete the `claimLine` call from the submit loop | **4 tests RED**, headline `expected "spy" to be called 2 times, but got 4 times` |

Restored after each; `tsc` back to 13, `media.test.ts` back to 59/59.

## Committing — READ THIS, the tree is shared

`ls .git/MERGE_HEAD` → absent. **Three files are entirely this plan's** and commit safely by
pathspec:

```
packages/backend/convex/media.ts
packages/backend/convex/media.test.ts
docs/playbooks/media.md
```

**TWO files carry a FOREIGN lane's uncommitted hunks and must NOT be pathspec-committed**, because
`git commit -- <path>` takes the whole working file:

- `packages/backend/convex/gmailAuth.ts` — a foreign 12-line hunk in `store` that marks unread
  `gmail_reconnect` notifications read (the ReconnectBanner lane). Mine is the **one word** at
  line 26.
- `docs/playbooks/cockpit.md` — foreign hunks predating this session. Mine is the top
  `Last verified` block only.

`git stash` is BANNED in this tree. Stage those two by hunk with
`git diff -- <path> | <select my hunk> | git apply --cached`, then `git commit` **with no pathspec**
(index-only) after confirming `git diff --cached --name-only` lists exactly the five intended files.

## Two things a later plan should know

1. **`check-playbooks.mjs` still reports `block`**, for `docs/playbooks/onboarding.md` against the
   *profile* lane's uncommitted `BlueprintPanel.tsx` (+537) / `ShapePanel.tsx` / `page.tsx` /
   `blueprintSegments.ts` / `.test.ts` — 645 lines, plus an untracked `BlueprintCanvas.tsx`.
   **Foreign — deliberately not bumped, OWNER DECISION 2026-08-02.** The bump IS a verification
   claim, and that lane owns the diff (STATE.md, *Shared-tree discipline*). The hook has **no
   acknowledge-without-touching path** for a covered playbook: `watch._unassigned` only covers new
   files no playbook claims, and `.git/claude-playbooks-ack.json` only blesses a file state when the
   playbook is touched alongside it. **So this red is expected and is the profile lane's to clear
   when it commits — do not "fix" it from another lane.** This plan's own two playbooks are not in
   the demand list, so its §9 obligation is discharged.
2. **`convex/onboarding.test.ts` flaked 3/24 in ONE full-suite run** (`SC#3b`, `SC#6c`,
   `updateProfile fails closed when the tenant has no tier row at all`) at 07:41, between two green
   full runs (07:31 and 07:48, both 967/967) and with the file untouched since 01:52. It passes
   **24/24 alone**. Not this plan's code, not chased — recorded because 22.1-03 already tracks a red
   `onboarding.test.ts §4.2` and this may be the same shared-state or clock sensitivity.
</content>
</invoke>
