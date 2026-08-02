# 20-14 — SUMMARY

**Plan:** the voiceover stage. **Status: complete.** Cost to build: **$0** — every submit takes the
`FAL_FIXTURE` branch or a `fetch` spy, and every callback body is synthesized locally. Nothing
reached fal.

## What shipped

| File | What changed |
|---|---|
| `packages/backend/convex/media.ts` | `SubmittableSpec` widened with `tts`; `buildSubmitBody`'s `tts` arm; `toSubmittable`'s `tts` branch; the new `SUBMIT_TEXT` table and `submitBatch`'s narration read |
| `packages/backend/convex/http.ts` | `ASSET_PATH.tts` — **one line**, `payload.audio.url` |
| `packages/backend/convex/mediaComplete.ts` | `landFailure` (a hoist, not a new path), `TTS_BYTES_PER_SECOND`/`TAKE_OVERRUN_GRACE_S`, the `take_too_long` net |
| `packages/backend/convex/media.test.ts` | 76 → **86 tests**; five pre-existing tally tests updated (see below) |
| `docs/playbooks/media.md` | `## The voiceover stage (20-14)` + `Last verified` bumped |

Verification: `media.test.ts` **86/86**; backend `tsc --noEmit` **13 — the exact pre-existing
baseline, delta 0**, none in any file this plan touched; `biome check` **delta 0 on all four source
files** (baselined via `git show HEAD:<path>` → throwaway sibling → check → delete, per the
shared-tree rule — `git stash` is BANNED here).

## THE EXACT tts REQUEST BODY AS SHIPPED

```ts
// fal-ai/inworld-tts
{ text: <narration verbatim>, voice: spec.voice, sample_rate_hertz: spec.sampleRateHertz }
```

**Three keys, and the key set is asserted by EXACT equality — not a spot-check.** That single
assertion is what makes the `speed` mutation check fire.

- **`voice` and `sampleRateHertz` are read off the ROW, not off `MEDIA_DEFAULT_VOICE`.** Deviation
  worth knowing: the plan's interface block reads them from the constant. The row is the record of
  what was priced, and reading the constant would let a row reserved under one voice submit under
  another after a constant bump. A dedicated test (`the pinned fields track the SPEC, not a
  constant`) fails if anyone "simplifies" it back.
- Pinned voice: `"Evelyn (en)"`. Pinned rate: **24000** (vendor default is 48000).
- **No second secret, no second webhook, no second adapter, no second reconciliation path.** The
  `FAL_KEY` read, the `queue.fal.run/{model}?fal_webhook=` URL, the per-row HMAC segment,
  `claimLine`'s idempotency, `falReasonCode` and the `FAL_FIXTURE` seam are all byte-unchanged. That
  is confirmable from the diff, and it is ADR-012's one-row-not-a-re-architecture argument.

## Deviations from the plan, and why

1. **`ASSET_PATH` lives in `http.ts`, not `mediaComplete.ts`.** The plan's Task 2 named
   `mediaComplete.ts`; 20-06 actually put the table in the route handler. Implemented where the code
   is. Consequence: **`http.ts` is a `cockpit.md`-watched path**, so `check-playbooks` now demands a
   `cockpit.md` bump — see *Playbooks* below.
2. **The overrun net measures `outcome.bytes`, not `payload.audio.file_size`.** `landResult` already
   receives the DOWNLOADED byte length, so the check needs no new plumbing and does not trust a
   provider-supplied number. Same arithmetic, strictly better input.
3. **The net SKIPS when the plan has no `clipSeconds`.** The plan did not say what to do with an
   absent window. `(plan?.clipSeconds ?? 0) + 2` would have failed **every** take on a plan shape
   this phase did not write — a guard that fails closed on its own missing input is a landmine, not
   a net. A test pins the skip.
4. **The plan's window-delta mutation check for `EXACT_SPEND_KINDS` could not fire**, and 20-06
   already recorded why: removing `"tts"` from the set flips `reconciled` to `reprice_failed` but
   leaves the window delta at 0 either way. The observable assertion is `reconciled`, and that is
   what M4 turns RED.

## Mutation checks — ALL FIVE OBSERVED RED, then restored

| # | Mutation | Result |
|---|---|---|
| M1 | drop `sample_rate_hertz` from the tts arm | **3 failed** / 83 passed |
| M2 | add `speed: 1.0` to the tts arm | **2 failed** / 84 passed |
| M3 | make `SUBMIT_TEXT.tts` read `.prompt` | **1 failed** / 85 passed |
| M4 | remove `"tts"` from `EXACT_SPEND_KINDS` | **2 failed** / 84 passed |
| M5 | drop the `take_too_long` net | **1 failed** / 85 passed |

Restored: **86/86**.

## A LANDMINE FOUND AND CLOSED — do not re-open it

**Never write a literal slash-star inside a LINE comment in `media.ts`.** The first draft of the
tts arm's comment named the `fal-ai/kokoro` family with a trailing glob. `media.test.ts` builds a
comment-stripped copy of the module (`mediaCode`) for its static scans using
`/\/\*[\s\S]*?\*\//g` — that stray slash-star OPENED a block comment which the stripper closed at
the next star-slash, silently eating `const _never: never = spec` and every scan between.

It failed loudly here because the `never` scan asserts a POSITIVE match. **The same trick would make
a negative scan — "this module never calls X" — pass VACUOUSLY.** The comment now says so at the
site. Worth a look from 20-17, which adds another arm to the same switch.

## Five pre-existing tests were UPDATED, not weakened

Wiring `tts` moved every batch from 2-submittable-of-4 to 4-of-4, so five tallies changed. Each kept
its intent:

- *TWO consecutive runs* — `{submitted:4, skipped:0}`, 4 fetches; the second run still skips all 4.
- *the rows after a submit* — was "tts untouched at queued", now asserts **four DISTINCT tickets**.
- *a 422 blocks ONE line* — `{submitted:1, blocked:3}`; the sibling-untouched assertions are unchanged.
- *a 5xx* — `{failed:4}`; the retrier-re-runs-for-free assertion is unchanged.
- *a plan with no shots* — `{failed:2}`, and it now asserts **BOTH** kinds refuse with `missing_shot`.
  A voice line with no block to read is the sharper case: an empty `text` is a VALID request that
  bills for nothing and returns silence.

The *unhandled kind* landing test moved from `tts` to **`stt`** — the only kind left without an
`ASSET_PATH` arm. It still proves the route refuses to go looking for a url in a body it does not
understand.

## Things a later plan must know

1. **20-17 owns the LAST `never` arm.** `stt` is deliberately still outside `SubmittableSpec`;
   widening it turns `buildSubmitBody`'s `never` guard red until the arm is written. `SUBMIT_TEXT`
   has NO `stt` key on purpose — an stt line is keyed to the whole deck at `blockIndex: -1` and reads
   neither `prompt` nor `narration`, so the missing key must stay a governed `missing_shot`.
2. **The audit-site count in `mediaComplete.ts` is still PINNED at 1.** `landFailure` is a hoist of
   the existing failure arm, not a new call site — the `llmRedaction.test.ts` scan is untouched and
   green. 20-09 / 20-16 / 20-17 still each owe their own deliberate bump.
3. **`storage.getUrl` scan 6 is still the tripwire for 20-17.** Nothing in this plan touched it.
4. **The 140-character pre-flight ceiling is the real overrun defence**; `take_too_long` is a second,
   cheaper net that runs AFTER the take is paid for. Do not let the existence of the net justify
   relaxing the band.

## Playbooks

`docs/playbooks/media.md` bumped (this plan owns it this wave).

`docs/playbooks/cockpit.md` is **OWED and deliberately NOT bumped here** — `check-playbooks`
reports `block` for it, naming `http.ts` (this plan's one-line `ASSET_PATH.tts`) alongside
`calendar.test.ts` and `gmailAuth.ts`, which are the **reconnect-banner lane's uncommitted work and
not this plan's to verify**. **Plan 20-08 owns `cockpit.md` this wave** and its entry must name the
`http.ts` tts arm explicitly. Do not read a green hook after 20-08 as this obligation having been
discharged separately — it is one bump covering both.

## Test status at hand-off

`pnpm test` — 7 of 8 packages green. Backend **1011 passed / 3 failed**, and the three are the
KNOWN intermittent in `convex/onboarding.test.ts` (`SC#3b`, `SC#6c`, `updateProfile fails closed
when the tenant has no tier row at all`) — **the exact three names recorded in 20-05-SUMMARY.md and
again in 20-07-SUMMARY.md.** Re-run alone: **24/24**. Not this lane's code, not chased; 22.1-03
already tracks a red `onboarding.test.ts §4.2` and this may be the same shared-state sensitivity.
