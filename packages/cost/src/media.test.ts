import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GENERATED_CLIP_SECONDS,
  MUSIC_MOODS,
  parseVariations,
  TARGET_DURATIONS,
  type VisualKind,
} from "@pikar/core/storyboard";
import { describe, expect, it } from "vitest";
import {
  chooseMediaBatch,
  estimateBatchUsd,
  estimateMediaUsd,
  MEDIA_DEFAULT_IMAGE,
  MEDIA_DEFAULT_MUSIC,
  MEDIA_DEFAULT_STOCK,
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_GENERATED_SECONDS_CAP,
  MEDIA_IMAGE_PRICING,
  MEDIA_JOB_CAP_USD,
  MEDIA_MUSIC_PRICING,
  MEDIA_SANDBOX_USD_PER_RENDER,
  MEDIA_STOCK_PRICING,
  MEDIA_STT_PRICING,
  MEDIA_TTS_PRICING,
  MEDIA_VIDEO_PRICING,
  MEDIA_VIDEO_SECONDS,
  type MediaSpec,
  SCENE_VISUAL_LINE,
  sceneVisualSpec,
  type VideoRes,
} from "./media";

const VIDEO_MODEL = MEDIA_DEFAULT_VIDEO.model;
const clip = (
  resolution: VideoRes = MEDIA_DEFAULT_VIDEO.resolution,
  // ANNOTATED, like `resolution` above. `MEDIA_DEFAULT_VIDEO` is `as const`, so `.seconds` is the
  // literal `4` — and an unannotated parameter takes its type FROM its default, which pinned this
  // helper to `seconds: 4`. That silently made the illegal-duration cases (3, 5, 10, 15, 0, NaN)
  // uncompilable: the test proving duration validation works could not itself typecheck.
  seconds: number = MEDIA_DEFAULT_VIDEO.seconds,
): MediaSpec => ({
  kind: "video",
  model: VIDEO_MODEL,
  resolution,
  seconds,
});
const voice = (characters: number): MediaSpec => ({
  kind: "tts",
  model: MEDIA_DEFAULT_VOICE.model,
  characters,
});
/** The voice rate, READ from the table rather than typed. Several tests below used to assert
 *  `openai/tts-1`'s $0.015/1k as a literal, so 33.1-06's move to `openai/gpt-audio-mini` at
 *  $0.006/1k turned rules about ROUNDING and about the CENTS FLOOR into arithmetic failures that
 *  said nothing about either. A rate a test reads cannot rot; a rate it types always can. */
const ttsRate = MEDIA_TTS_PRICING[MEDIA_DEFAULT_VOICE.model] as number;

const usd = (spec: MediaSpec) => {
  const r = estimateMediaUsd(spec);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
};
const codeOf = (spec: MediaSpec) => {
  const r = estimateMediaUsd(spec);
  return r.ok ? "ok" : r.error.code;
};

describe("estimateMediaUsd — video, priced per video-second", () => {
  it("the PINNED video model is grok on OpenRouter, spelled out", () => {
    // A LITERAL on one side, like the image pin's test: the default, the price key and the fixture
    // id are three copies of one string, and comparing two of them proves only self-equality.
    expect(MEDIA_DEFAULT_VIDEO.model).toBe("x-ai/grok-imagine-video");
    // The superseded row stays PRICEABLE for historical `mediaJobs` rows, and is NOT the pin.
    expect(MEDIA_VIDEO_PRICING["sora-2"]).toEqual({ "720p": 0.1 });
  });
  it("Grok 720p x 4 s = $0.28, and $0.07/s is under the $0.10/s it replaces", () => {
    expect(usd(clip())).toBeCloseTo(0.28, 10);
    expect(MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model]?.["720p"]).toBe(0.07);
    expect(MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model]?.["480p"]).toBe(0.05);
  });
  it("a NON-multiple-of-4 length prices at ITS OWN length — the grid xAI publishes", () => {
    // The defect this phase exists to kill: 5 and 7 were `illegal_duration` on the Sora grid.
    for (const s of [1, 5, 6, 7, 10, 13, 15]) {
      expect(usd(clip("720p", s))).toBeCloseTo(s * 0.07, 10);
    }
    // The 480p leg is the MEASURED one: a live paid call on 2026-08-30 for
    // `{duration: 5, resolution: "480p"}` returned `usage.cost` 0.25 = exactly 5 x $0.05.
    expect(usd(clip("480p", 5))).toBeCloseTo(0.25, 10);
  });
  it("an unpriced model → unknown_model (a Veo-class endpoint is not in the table)", () => {
    expect(codeOf({ kind: "video", model: "fal-ai/veo3", resolution: "720p", seconds: 4 })).toBe(
      "unknown_model",
    );
  });
  it("a resolution missing from the model's row → unknown_model, NEVER a tier fallback", () => {
    expect(codeOf(clip("4k" as VideoRes))).toBe("unknown_model");
    // xAI publishes 480p and 720p and no 1080p, so a 1080p request is refused rather than
    // silently downgraded to the tier below it (rule 2). The sora-2 row had no 480p and this is
    // the same question asked of the new row.
    expect(codeOf(clip("1080p", 4))).toBe("unknown_model");
  });
  it("the grid is WIDER, not OPEN: 16, 0 and a fraction are still illegal_duration", () => {
    for (const s of [16, 20, 0, -4, 4.5]) expect(codeOf(clip("720p", s))).toBe("illegal_duration");
    for (const s of [1, 4, 8, 12, 15]) expect(codeOf(clip("720p", s))).toBe("ok");
  });
  it("a non-finite duration is refused, never NaN dollars", () => {
    expect(codeOf(clip("480p", Number.NaN))).toBe("illegal_duration");
  });
});

describe("estimateMediaUsd — the billing units differ, and the tests sit side by side", () => {
  it("GPT Image 2 low portrait reserves the MEASURED $0.006, not the guessed $0.01", () => {
    // The number is the reservation, not the invoice: OpenRouter billed $0.004875 for exactly this
    // request on 2026-08-30 (33.1-PRICE-EVIDENCE.md) and the row rounds UP, because a reservation on
    // a no-refunds rail may never come in under the charge.
    const { model, width, height } = MEDIA_DEFAULT_IMAGE;
    expect(usd({ kind: "image", model, width, height })).toBeCloseTo(0.006, 10);
    // …and it is strictly above the measured floor. This is what "rounded up" MEANS, asserted.
    expect(usd({ kind: "image", model, width, height })).toBeGreaterThan(0.004875);
  });
  // 33.1-06 restated these two AS THE PROPERTY they were always about — see `ttsRate` above.
  it("TTS does NOT round its thousands: 1,200 chars bills 1.2 rates, never 2", () => {
    expect(usd(voice(1200))).toBeCloseTo(ttsRate * 1.2, 10);
    expect(usd(voice(1200))).toBeLessThan(ttsRate * 2); // the rounding this forbids, named
  });
  it("…and 1 char is a fraction of a cent, not a whole thousand", () => {
    expect(usd(voice(1))).toBeCloseTo(ttsRate / 1000, 12);
    expect(usd(voice(1))).toBeLessThan(0.00001); // still a fraction of a cent at the new rate
  });
  it("STT bills whole INPUT audio minutes: 1 min → $0.006, 30 s still buys one", () => {
    const stt = (audioMinutes: number): MediaSpec => ({
      kind: "stt",
      model: MEDIA_DEFAULT_STT.model,
      audioMinutes,
    });
    expect(usd(stt(1))).toBeCloseTo(0.006, 10);
    expect(usd(stt(0.5))).toBeCloseTo(0.006, 10);
    expect(usd(stt(2))).toBeCloseTo(0.012, 10);
  });
  it("the render is a flat named constant, and a free block is zero", () => {
    expect(usd({ kind: "render" })).toBe(MEDIA_SANDBOX_USD_PER_RENDER);
    expect(usd({ kind: "free" })).toBe(0);
  });
  it("an unpriced model in ANY kind → unknown_model", () => {
    expect(codeOf({ kind: "tts", model: "fal-ai/kokoro", characters: 10 })).toBe("unknown_model");
    expect(codeOf({ kind: "stt", model: "fal-ai/whisper", audioMinutes: 1 })).toBe("unknown_model");
    expect(codeOf({ kind: "image", model: "fal-ai/sd", width: 1, height: 1 })).toBe(
      "unknown_model",
    );
  });
});

// The §4.1 job, as data. This is the reel the phase was budgeted around.
const JOB_4_1: MediaSpec[] = [
  ...Array.from({ length: 6 }, () => clip()), // 6 x 720p x 4 s = $1.680 (was $2.400 on sora-2)
  voice(1200), //                                voice            = $0.0072 (was $0.018)
  voice(1200), //                                retry allowance  = $0.0072
  { kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes: 1 }, // captions = $0.006
  { kind: "render" }, //     render, incl. the one auto-retry sandbox (33-04)  = $0.040
];

describe("estimateBatchUsd + the job cap", () => {
  it("the six-block job PRICES at $1.7404 — 30% under sora-2, on TWO rate moves", () => {
    // Was $2.482 when the clips were sora-2's $0.10/s and the voice was tts-1's $0.015/1k. Both
    // moved to OpenRouter in this phase and both moved DOWN: $1.762 after the clips (33.1-04),
    // $1.7404 after the voice (33.1-06). Attributing the whole 30% to grok would now be wrong by
    // 2.2 cents, which is exactly the kind of stale sentence the playbook rule exists to stop.
    // A successor cheaper than what it replaces is the test ADR-026 sets for a migration, and the
    // reason MEDIA_JOB_CAP_USD does not move.
    const total = estimateBatchUsd(JOB_4_1);
    expect(total.ok).toBe(true);
    if (total.ok) expect(total.value).toBeCloseTo(1.7404, 10);
  });
  it("...and the SAME six-block job is now REFUSED — 24 generated seconds is over the ceiling", () => {
    // The §4.1 reel was six four-second clips, which is 24 s of generated video: double the cap.
    // Stated plainly rather than deleted, because it is the cost the decision spends — a reel that
    // used to be the phase's canonical job is now illegal, and the cure is a mixed deck, which is
    // exactly the behaviour the ceiling exists to force (ADR-027).
    const r = chooseMediaBatch(JOB_4_1, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_generated_seconds");
  });
  it("MEDIA_JOB_CAP_USD IS STILL $3.50 — a successor needing a bigger cap is a worse outcome", () => {
    // Asserted on its own, against a literal, because this is the phase where it would slip:
    // ADR-026 is explicit that a replacement that needs the ceiling raised is a regression
    // wearing a migration's clothes. Grok is CHEAPER, so nothing here has to move.
    expect(MEDIA_JOB_CAP_USD).toBe(3.5);
  });
  it("THE TWO COPIES OF THE PROVIDER GRID AGREE — the drift that went unnoticed last cutover", () => {
    // `@pikar/core` deliberately does not depend on `@pikar/cost` (the dependency runs the other
    // way), so the pinned model's duration grid is written out in both packages. They drifted at
    // the OpenAI cutover and nothing noticed — `isBuyableClipLength`'s comment in
    // `packages/backend/convex/media.ts` records what that cost. This one line is what makes
    // "keep them in step" enforceable rather than aspirational.
    expect([...GENERATED_CLIP_SECONDS]).toEqual([...(MEDIA_VIDEO_SECONDS[VIDEO_MODEL] ?? [])]);
  });
  it("13 and 20 grok blocks are refused by the SECONDS cap, which now binds before the job cap", () => {
    // THESE TWO TESTS WERE `over_job_cap` UNTIL 33.1-04, and the change of code is the honest
    // record of what the cap did: 13 clips are $3.64 and 20 are $5.60, both still over the $3.50
    // ceiling — but at 52 and 80 generated seconds they never reach the price check, because
    // `MEDIA_GENERATED_SECONDS_CAP` refuses them first. Asserted rather than quietly re-keyed.
    for (const count of [13, 20]) {
      const job = [...Array.from({ length: count }, () => clip()), { kind: "render" } as MediaSpec];
      const r = chooseMediaBatch(job, MEDIA_JOB_CAP_USD);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("over_generated_seconds");
    }
  });
  it("over_job_cap IS STILL REACHABLE — through the kinds the seconds cap does not bound", () => {
    // The cap ceilings generated video at $0.84, so video alone can no longer reach $3.50. That
    // does NOT retire `over_job_cap`: stills, voice and captions are unbounded by scene COUNT, and
    // 600 stills at $0.006 is $3.60. If this ever goes red because the code stopped checking the
    // price at all, the seconds cap has quietly replaced the money cap rather than joining it.
    const stills: MediaSpec[] = Array.from({ length: 600 }, () => ({
      kind: "image",
      model: MEDIA_DEFAULT_IMAGE.model,
      width: MEDIA_DEFAULT_IMAGE.width,
      height: MEDIA_DEFAULT_IMAGE.height,
    }));
    const r = chooseMediaBatch(stills, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_job_cap");
  });
  it("A 30-SECOND ALL-GENERATED REEL NOW PRICES AT $2.10, UNDER THE $3.50 JOB CAP", () => {
    // The fact the generated-seconds cap exists to answer, asserted rather than skipped past.
    // On the Sora grid this deck was not composable at all (every length a multiple of 4); on
    // grok's 1..15 it is two 15-second clips at $0.07/s, and the ARITHMETIC no longer refuses it.
    // If this is the only thing that changed, kind-mixing has dropped from structural to advisory.
    const thirty = [clip("720p", 15), clip("720p", 15)];
    const total = estimateBatchUsd(thirty);
    expect(total.ok && total.value).toBeCloseTo(2.1, 10);
    const r = chooseMediaBatch(thirty, MEDIA_JOB_CAP_USD);
    expect(r.ok ? "ok" : r.error.code).not.toBe("over_job_cap");
    // ...and what DOES refuse it is the ceiling Task 4 added, named on its own return value.
    expect(r.ok ? "ok" : r.error.code).toBe("over_generated_seconds");
  });
  it("ANY member's Err propagates — one unpriceable line refuses the whole job", () => {
    const r = estimateBatchUsd([
      clip(),
      { kind: "video", model: "fal-ai/veo3", resolution: "720p", seconds: 4 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown_model");
  });
  it("free line items contribute 0 and never make a job unknown_model", () => {
    const r = estimateBatchUsd([clip(), { kind: "free" }, { kind: "free" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(0.28, 10);
  });
  it("a non-positive cap refuses rather than passing everything", () => {
    for (const cap of [0, -1, Number.NaN]) {
      const r = chooseMediaBatch([{ kind: "free" }], cap);
      expect(r.ok).toBe(false);
    }
  });
});

// D12(a) — THE reason this module exists. The cents floor is a fail-closed bias that is correct
// ONCE and catastrophic per line item.
describe("chooseMediaBatch — the cents floor is applied ONCE, on the total", () => {
  it("6 lines of $0.0012 reserve 1 cent ($0.0072 → ceil 0.72), NOT 6", () => {
    // The plan wrote "1 cent, not 6"; at tts-1's rate the honest answer was 2 and this test said
    // so. 33.1-06's cheaper voice rate brings it back to 1 — the plan's number, arrived at by
    // arithmetic rather than by restoring it. The number that matters is unchanged and is now
    // starker: per-line flooring reserves 6, which is 6x this and 8x the true cost.
    const six = Array.from({ length: 6 }, () => voice(200));
    const r = chooseMediaBatch(six, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.estUsd).toBeCloseTo(6 * 200 * (ttsRate / 1000), 10);
    expect(r.value.estCents).toBe(1);
    // what per-line flooring would have reserved, spelled out so the regression is legible:
    expect(six.reduce((c, s) => c + Math.max(1, Math.ceil(usd(s) * 100)), 0)).toBe(6);
  });
  it("13 sub-cent lines reserve 1 cent, not 13", () => {
    const thirteen = Array.from({ length: 13 }, () => voice(50)); // $0.00075 each → $0.00975
    const r = chooseMediaBatch(thirteen, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.estCents).toBe(1);
  });
  it("estUsd stays FRACTIONAL — the row stores USD, only the reservation is cents", () => {
    const r = chooseMediaBatch([voice(1200)], MEDIA_JOB_CAP_USD);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.estUsd).toBeCloseTo(1200 * (ttsRate / 1000), 10);
    expect(Number.isInteger(r.value.estUsd)).toBe(false);
  });
});

// --- provenance + SC5: the ceiling is verified, not promised -------------------------------
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MEDIA_SRC = read("./media.ts");
const FIXTURES = JSON.parse(read("./media.fixtures.json")) as {
  readAt: string;
  entries: {
    id: string;
    kind: string;
    rate?: number;
    rates?: Record<string, number>;
    vendor: Record<string, unknown>;
  }[];
  sceneKinds: {
    perScene: {
      visual: VisualKind;
      buys: "video" | "image" | null;
      usdAt4s: number;
      durations: number[] | "any";
    }[];
    reel30s: { mixed: { pictureUsd: number; generatedSeconds: number } };
    targetsUnreachableByGeneratedVideoAlone: number[];
  };
};

describe("the price tables agree with the committed vendor fixture", () => {
  // WAS `entries.find(...)` — FIRST MATCH ONLY, so a SECOND fixture entry of the same kind was
  // never checked against its table row at all. That held while every kind was a singleton and
  // stops holding the moment one is not (33.1-04 adds a second `video` entry), which is why the
  // helper is fixed HERE rather than there: a guard inherited already working beats a guard
  // somebody has to remember to widen.
  const allOfKind = (k: string) => {
    const es = FIXTURES.entries.filter((x) => x.kind === k);
    // …and the loops below cannot pass VACUOUSLY on an empty filter.
    if (es.length === 0) throw new Error(`no fixture entry for ${k}`);
    return es;
  };

  it("EVERY fixture entry of a kind matches its table row, not just the first", () => {
    for (const e of allOfKind("video")) expect(MEDIA_VIDEO_PRICING[e.id]).toEqual(e.rates);
    for (const e of allOfKind("image")) expect(MEDIA_IMAGE_PRICING[e.id]).toBe(e.rate);
    for (const e of allOfKind("tts")) expect(MEDIA_TTS_PRICING[e.id]).toBe(e.rate);
    for (const e of allOfKind("stt")) expect(MEDIA_STT_PRICING[e.id]).toBe(e.rate);
  });

  it("the PINNED image id is the route-qualified one, spelled out", () => {
    // A LITERAL, not `MEDIA_DEFAULT_IMAGE.model` on both sides. The pin, the price key and the
    // fixture id are three copies of one string; comparing two of them to each other proves only
    // that they are equal to themselves. `openai/gpt-image-2` and not `gpt-image-2`, because
    // `buildSubmitBody` sends this value to OpenRouter UNSTRIPPED and the gateway keys on the route.
    expect(MEDIA_DEFAULT_IMAGE.model).toBe("openai/gpt-image-2");
    expect(allOfKind("image").map((e) => e.id)).toContain("openai/gpt-image-2");
    // The superseded bare id stays PRICEABLE for historical rows, and is NOT the pin.
    expect(MEDIA_IMAGE_PRICING["gpt-image-2"]).toBe(0.01);
  });
  it("every fixture entry records a live endpoint and any deprecation has a shutdown date", () => {
    for (const e of FIXTURES.entries) {
      expect(e.vendor.removed).toBe(false);
      expect(e.vendor.status).toBe("public");
      if (e.vendor.deprecated) expect(e.vendor.shutdown).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // ── THE SHUTDOWN TRIPWIRE ────────────────────────────────────────────────────────────────────
  //
  // Recording a shutdown date is not the same as being warned by it. Before this, `sora-2` sat in
  // the fixture flagged `deprecated: true` with a date one month out and EVERY TEST WAS GREEN — so
  // the day the Videos API is withdrawn, `generated_video` scenes would simply start failing in
  // production with nothing having gone red first.
  //
  // These are deliberately TIME-DEPENDENT. That is the mechanism, not a flaw: a build that can
  // only break on the day the vendor breaks it has no warning value at all. Each failure below
  // names the decision it wants, so a red build here is actionable rather than merely alarming.
  const PINNED_MODELS = new Set<string>([MEDIA_DEFAULT_VIDEO.model, MEDIA_DEFAULT_IMAGE.model]);
  /**
   * IN SCOPE = every PINNED model, PLUS every entry still carrying an unretired `succession`.
   *
   * Keying on `PINNED_MODELS` alone was a hole, and 33.1-04 walked straight into it: repinning
   * `MEDIA_DEFAULT_VIDEO` to the successor drops the DYING model out of the set, so all three
   * alarms below `continue` past `sora-2` and go green **while the submit path still posts to the
   * endpoint being withdrawn**. Measured, not theorised: with the repin landed and `sora-2`'s
   * shutdown moved to five days out, this file was green.
   *
   * That is the same self-certification shape commit 7012068 closed one level up, where keying on
   * `status !== "decision_pending"` meant that WRITING THE ADR disarmed the alarm. A decision is
   * not a migration, and NEITHER IS A REPIN. The exit condition is unchanged and is still the only
   * one: `replacementWiredUp === true`, which plan 33.1-05 sets beside the landed submit path.
   *
   * **`deprecated` is the THIRD arm, and it was added by mutation rather than by design.** The
   * plan proposed `pinned || succession !== undefined`; mutation 3 (delete `sora-2`'s succession
   * block outright) came back GREEN under it, because an unpinned entry with no succession falls
   * out of scope — so the alarm "a deprecated model carries a written succession decision" could
   * be silenced by DELETING the thing it asks for. Fixed in the predicate, not in the fixture.
   *
   * ponytail: one predicate, three call sites. Not a fixture-scanning helper module — this is a
   * test file and the whole mechanism is one line.
   */
  const inScope = (e: {
    id: string;
    succession?: unknown;
    vendor: Record<string, unknown>;
  }): boolean =>
    PINNED_MODELS.has(e.id) || e.succession !== undefined || e.vendor.deprecated === true;
  const daysUntil = (iso: string): number =>
    Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.now()) / 86_400_000);

  it("A DEPRECATED MODEL IN SCOPE CARRIES A WRITTEN SUCCESSION DECISION", () => {
    // The point is that "we know" has to become "it is written down". A deprecation with nobody
    // named as its replacement is how a dependency dies quietly.
    for (const e of FIXTURES.entries) {
      if (!e.vendor.deprecated || !inScope(e)) continue;
      const succession = (e as { succession?: { status?: string; why?: string } }).succession;
      expect(
        succession,
        `${e.id} is deprecated and IN SCOPE, but no \`succession\` is recorded in media.fixtures.json`,
      ).toBeDefined();
      expect(succession?.status).toMatch(/^(decision_pending|decided|migrated)$/);
      expect(
        (succession?.why ?? "").length,
        `${e.id}: succession.why must say WHY`,
      ).toBeGreaterThan(40);
    }
  });

  it("A MODEL IN SCOPE IS NOT ALREADY PAST ITS SHUTDOWN DATE", () => {
    // The last line of defence. If this is red, the product is shipping requests to an endpoint the
    // vendor has withdrawn — every `generated_video` scene is failing right now.
    for (const e of FIXTURES.entries) {
      if (!e.vendor.shutdown || !inScope(e)) continue;
      expect(
        daysUntil(String(e.vendor.shutdown)),
        `${e.id} SHUT DOWN on ${e.vendor.shutdown}. It is still pinned. Migrate it now.`,
      ).toBeGreaterThan(0);
    }
  });

  it("AN UNWIRED SUCCESSION HAS RUNWAY LEFT — decided is not the same as done", () => {
    // The real tripwire, and the number is a deadline rather than a preference: choosing a video
    // vendor means an ADR, a data-transfer decision, a price-table row and a submit path. Two weeks
    // is the least that is honest, so work still open inside it turns the build red while there is
    // time to act. Moving this number to silence it is the failure mode to resist.
    //
    // THIS USED TO KEY ON `status !== "decision_pending"`, AND THAT WAS A HOLE BIG ENOUGH TO DRIVE
    // THE WHOLE OUTAGE THROUGH. Writing the ADR flips the status to `decided` — which disarmed
    // this test while `media.ts` still submitted to the endpoint being withdrawn. The decision is
    // the cheap half; the submit path is the half that keeps reels rendering. Keyed that way, the
    // ONLY surviving alarm was "the shutdown must not have passed", which fires the day after
    // production breaks. A decision is not a migration, and the tripwire now says so.
    //
    // 33.1-04 widened the SCOPE for the same reason (see `inScope`): a REPIN is not a migration
    // either, and keying on `PINNED_MODELS` alone let the repin disarm this.
    const RUNWAY_DAYS = 14;
    for (const e of FIXTURES.entries) {
      const succession = (
        e as {
          succession?: { status?: string; replacementWiredUp?: boolean };
        }
      ).succession;
      if (!e.vendor.shutdown || !inScope(e)) continue;
      // Only a WIRED replacement stands the tripwire down. `migrated` means the code moved;
      // anything else — undecided, or decided-but-unwired — still needs runway.
      if (succession?.status === "migrated" || succession?.replacementWiredUp === true) continue;
      expect(
        daysUntil(String(e.vendor.shutdown)),
        `${e.id} shuts down on ${e.vendor.shutdown} and the replacement is NOT WIRED UP ` +
          `(status: ${succession?.status ?? "none"}, replacementWiredUp: ` +
          `${String(succession?.replacementWiredUp)}). A written decision does not render a reel — ` +
          "land the submit path and the price row, then set succession.replacementWiredUp to true.",
      ).toBeGreaterThan(RUNWAY_DAYS);
    }
  });
  it("each number in a table is justified by the vendor's OWN string, or is marked MEDIUM", () => {
    for (const e of FIXTURES.entries) {
      const vendorText = String(e.vendor.pricingInfoOverride ?? "");
      const numbers = e.rates ? Object.values(e.rates) : [e.rate as number];
      for (const n of numbers) {
        const justified = vendorText.includes(`$${n}`) || vendorText.includes(`$${n.toFixed(2)}`);
        // flux/schnell publishes the ROUNDING RULE but no price string — MEDIUM until an invoice.
        if (!justified) expect((e as { confidence?: string }).confidence).toBe("MEDIUM");
      }
    }
  });
});

// --- 20.2 wave 7: the scene-kind price table ------------------------------------------------
const sceneUsd = (visual: VisualKind, seconds: number): number => {
  const r = sceneVisualSpec(visual, seconds);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value?.usd ?? 0;
};

describe("the scene-kind price table — §2.3, and why the cheap kinds are not a fallback", () => {
  const SCENE = FIXTURES.sceneKinds;

  it("every kind buys what the fixture says, at the price the fixture says", () => {
    for (const row of SCENE.perScene) {
      expect(SCENE_VISUAL_LINE[row.visual]).toBe(row.buys);
      expect(sceneUsd(row.visual, 4)).toBeCloseTo(row.usdAt4s, 10);
    }
    // …and no kind is quietly missing from the fixture, which is what would let a new one ship
    // unpriced and be discovered by an invoice.
    expect(SCENE.perScene.map((r) => r.visual).sort()).toEqual(
      Object.keys(SCENE_VISUAL_LINE).sort(),
    );
  });

  it("a free kind buys NOTHING at any length — null, not a zero-dollar provider line", () => {
    for (const visual of ["uploaded_video", "text_card"] as const) {
      for (const seconds of [2, 4, 7, 12.5]) {
        const r = sceneVisualSpec(visual, seconds);
        if (!r.ok) throw new Error(`refused: ${r.error.code}`);
        expect(r.value).toBeNull();
      }
    }
  });

  it("a still costs the same at 12 s as at 2 s — duration freedom IS the lever", () => {
    expect(sceneUsd("animated_image", 12)).toBe(sceneUsd("animated_image", 2));
    // 46.7x at 4 s ($0.28 / $0.006) — `140 / 3`, written as the arithmetic rather than as a
    // decimal so the numerator and denominator are both legible.
    //
    // THIS NUMBER HAS MOVED TWICE IN ONE DAY: 40x (a $0.40 clip over a GUESSED $0.01 still), then
    // 66.7x when 33.1-03 measured the still at $0.006, then 46.7x when 33.1-04 moved the clip to
    // grok's $0.07/s. That is precisely why nothing a user or a model reads may RESTATE it: since
    // 33.1-04 every sentence about the lever DERIVES it from this table (`mediaCanvasView.ts`'s
    // `CLIP_VS_STILL_RATIO`), so a price move updates the copy instead of contradicting it.
    expect(sceneUsd("generated_video", 4) / sceneUsd("animated_image", 4)).toBeCloseTo(140 / 3, 10);
  });

  it("a generated clip is priced at ITS OWN length, and the grid is WIDER — not absent", () => {
    // INVERTED on 2026-08-30 (33.1-04), not deleted. 5, 6, 10 and 15 were `illegal_duration` on
    // the sora-2 grid and are now ordinary lengths — that inversion IS the phase.
    for (const seconds of [5, 6, 7, 10, 15]) {
      expect(sceneUsd("generated_video", seconds)).toBeCloseTo(seconds * 0.07, 10);
    }
    expect(sceneUsd("generated_video", 8)).toBeCloseTo(0.56, 10);
    expect(sceneUsd("generated_video", 12)).toBeCloseTo(0.84, 10);
    // The grid is wider, not open. A scene the provider cannot make is still refused HERE, at the
    // free gate, rather than inside a sandbox that has already been bought.
    for (const seconds of [16, 0]) {
      const r = sceneVisualSpec("generated_video", seconds);
      expect(r.ok ? "ok" : r.error.code).toBe("illegal_duration");
    }
  });

  it("the §2.3 30-second reel costs what the ADR claims — AND is still buyable", () => {
    const pictures =
      3 * sceneUsd("generated_video", 4) +
      4 * sceneUsd("animated_image", 4) +
      sceneUsd("text_card", 2);
    expect(pictures).toBeCloseTo(SCENE.reel30s.mixed.pictureUsd, 10);
    // 33.1-04: the ADR's worked deck sits EXACTLY on `MEDIA_GENERATED_SECONDS_CAP` with zero
    // slack, and nothing checked that until this line. A one-second nudge to any of its three
    // generated scenes makes the deck the ADR is argued from illegal, which would be a silent
    // contradiction between the record and the rail. Asserted through `chooseMediaBatch` rather
    // than by comparing two numbers, so it is the shipped gate that answers.
    const generatedSeconds = SCENE.reel30s.mixed.generatedSeconds;
    const deck: MediaSpec[] = [
      ...Array.from({ length: generatedSeconds / 4 }, () => clip("720p", 4)),
      ...Array.from(
        { length: 4 },
        (): MediaSpec => ({
          kind: "image",
          model: MEDIA_DEFAULT_IMAGE.model,
          width: MEDIA_DEFAULT_IMAGE.width,
          height: MEDIA_DEFAULT_IMAGE.height,
        }),
      ),
      { kind: "render" },
    ];
    const bought = chooseMediaBatch(deck, MEDIA_JOB_CAP_USD);
    expect(bought.ok, bought.ok ? "" : `the ADR's own deck is refused: ${bought.error.code}`).toBe(
      true,
    );
    expect(generatedSeconds).toBe(3 * 4);
  });

  it("NOT ONE target duration is reachable with generated video alone", () => {
    // THE PROPERTY IS UNCHANGED; THE MECHANISM MOVED, on 2026-08-30 (33.1-04, ADR-027).
    //
    // It used to hold through TWO different mechanisms without saying so: 15 and 30 failed the
    // ARITHMETIC (every sora-2 clip length was a multiple of 4, so no sum of them was 15 or 30)
    // and 60 failed the JOB CAP ($6.00 > $3.50). On grok's 1..15 grid every target is composable,
    // and 15 s ($1.05) and 30 s ($2.10) are both under the job cap, so the arithmetic half is gone.
    //
    // What holds it now is `MEDIA_GENERATED_SECONDS_CAP` — a code-owned ceiling at the same money
    // boundary every other refusal passes through. All three targets are refused for ONE stated
    // reason, and the assertion is made through `chooseMediaBatch`'s own return value rather than
    // by arithmetic over a fixture array, so it reads the shipped check instead of restating it.
    // ADR-027 §"What the mitigation is not": a ceiling somebody can raise is not the same thing as
    // an impossibility, and that is a cost the Grok decision spends.
    for (const target of TARGET_DURATIONS) {
      // The whole target, bought as generated video however it is arranged — video is priced per
      // SECOND, so the arrangement never mattered, only the total.
      const allGenerated = Array.from({ length: Math.ceil(target / 15) }, (_, i) =>
        clip("720p", Math.min(15, target - i * 15)),
      );
      const r = chooseMediaBatch(allGenerated, MEDIA_JOB_CAP_USD);
      expect(r.ok, `an all-generated ${target}s reel must be refused`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("over_generated_seconds");
    }
    expect([...TARGET_DURATIONS]).toEqual(SCENE.targetsUnreachableByGeneratedVideoAlone);
    // THE ONE-LINE PROPERTY, which is what makes the loop above true for a target duration nobody
    // has added yet rather than only for these three.
    expect(MEDIA_GENERATED_SECONDS_CAP).toBeLessThan(Math.min(...TARGET_DURATIONS));
  });

  it("the boundary is INCLUSIVE — a deck spending exactly the cap is bought", () => {
    // Both decks the cap was sized against sit EXACTLY on it, with zero slack: the skill body's
    // VARIATION A spends 4 + 8 and `media.fixtures.json`'s reel30s.mixed spends 3 x 4. An
    // exclusive boundary would make both illegal without a word of warning anywhere.
    const atCap = [clip("720p", 4), clip("720p", 8)];
    const r = chooseMediaBatch(atCap, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.estUsd).toBeCloseTo(MEDIA_GENERATED_SECONDS_CAP * 0.07, 10);
    // ...and one second more is not.
    const over = chooseMediaBatch([clip("720p", 4), clip("720p", 9)], MEDIA_JOB_CAP_USD);
    expect(over.ok ? "ok" : over.error.code).toBe("over_generated_seconds");
  });

  it("a batch with NO video at all is untouched by the ceiling", () => {
    // A standalone image, and a whole deck of stills. The cap is about generated video; a ceiling
    // that refused a $0.006 still would be a bug wearing a guard's clothes.
    const image: MediaSpec = {
      kind: "image",
      model: MEDIA_DEFAULT_IMAGE.model,
      width: MEDIA_DEFAULT_IMAGE.width,
      height: MEDIA_DEFAULT_IMAGE.height,
    };
    expect(chooseMediaBatch([image], MEDIA_JOB_CAP_USD).ok).toBe(true);
    const stillsDeck: MediaSpec[] = [
      ...Array.from({ length: 8 }, () => image),
      { kind: "free" },
      { kind: "render" },
    ];
    expect(chooseMediaBatch(stillsDeck, MEDIA_JOB_CAP_USD).ok).toBe(true);
  });

  it("THE SKILL BODY'S OWN WORKED ANSWER STAYS LEGAL — the gap nothing checked", () => {
    // `media-director.md` teaches by example, and `seedSkills` publishes it straight to ACTIVE with
    // no eval gate in front of it (the body is not a GATED skill). So the only thing between "the
    // body teaches a deck the money boundary refuses" and a live dead end is a check like this.
    // VARIATION A spends 4 + 8 = 12 generated seconds — EXACTLY the cap, with zero slack, which is
    // why the cap is 12 and why this assertion ships in the same commit as the cap.
    //
    // Read off DISK by relative path, the way `storyboard.test.ts` reads the same file:
    // `@pikar/cost` does not depend on `@pikar/contracts` and must not start to.
    const body = read("../../contracts/skills/media-director.md");
    const v = parseVariations(body);
    expect(v.kind, `the body's worked answer did not parse: ${JSON.stringify(v)}`).toBe("two");
    if (v.kind !== "two") return;
    for (const [name, slice] of [
      ["A", v.a],
      ["B", v.b],
    ] as const) {
      const generatedSeconds = slice.deck.scenes
        .filter((sc) => sc.visual === "generated_video")
        .reduce((n, sc) => n + sc.durationMs / 1000, 0);
      expect(
        generatedSeconds,
        `the worked answer's VARIATION ${name} spends ${generatedSeconds}s of generated video, ` +
          `over MEDIA_GENERATED_SECONDS_CAP (${MEDIA_GENERATED_SECONDS_CAP}). The body teaches a ` +
          "deck the money boundary refuses - fix the body or the cap, not this assertion.",
      ).toBeLessThanOrEqual(MEDIA_GENERATED_SECONDS_CAP);
      // ...and the same deck is genuinely BUYABLE, not merely under one number.
      const specs = slice.deck.scenes.flatMap((sc) => {
        const line = sceneVisualSpec(sc.visual, sc.durationMs / 1000);
        if (!line.ok) throw new Error(`worked answer scene refused: ${line.error.code}`);
        return line.value === null ? [] : [line.value.spec];
      });
      expect(chooseMediaBatch([...specs, { kind: "render" }], MEDIA_JOB_CAP_USD).ok).toBe(true);
    }
  });

  it("THE BODY'S STATED COST MULTIPLE IS THE DERIVED ONE — the fourth rot of the same literal", () => {
    // This literal has now gone stale THREE times: `media.md` records it as "a tenth" until 33-06,
    // then "a fortieth", and 33.1-03's reprice made that wrong again while four surfaces kept
    // saying forty. The audit's fix was "derive, don't restate" — and 33.1-04 did exactly that for
    // the screen (`CLIP_VS_STILL_RATIO` is computed at render).
    //
    // A SKILL BODY CANNOT DERIVE ANYTHING. It is a static string handed to a model, so the number
    // has to be written out. What is available instead is this: state it in exactly ONE place, and
    // put a test over that place which computes what it must say. The prose still restates; the
    // restatement is no longer unfalsifiable.
    //
    // 33.1-06 reduced the body from FOUR numeric ratio claims to one for this reason. The other
    // three now say "a small fraction" / "dramatically cheaper" and point at this one — qualitative
    // prose cannot go stale, and a claim that cannot go stale needs no guard.
    const body = read("../../contracts/skills/media-director.md");
    const clip = sceneVisualSpec("generated_video", 4);
    const still = sceneVisualSpec("animated_image", 4);
    if (!clip.ok || !still.ok || clip.value === null || still.value === null) {
      throw new Error("the two kinds the body compares must both price");
    }
    const derived = Math.round(clip.value.usd / still.value.usd);

    // EXACTLY ONE numeric "N times" in the whole body. Not "at least one": a second numeric claim
    // is a second thing to rot, and the count is what stops one being added back silently. The
    // word-number forms elsewhere ("a hundred times before", "three times a week") are narration
    // and example prose, carry no cost claim, and are deliberately not matched.
    const stated = [...body.matchAll(/(\d+) times/g)].map((m) => Number(m[1]));
    expect(
      stated,
      "the body must state its cost multiple exactly once, as digits. Found: " +
        JSON.stringify(stated),
    ).toHaveLength(1);
    expect(
      stated[0],
      `media-director.md says a clip costs ${stated[0]}x a still; the price tables now say ` +
        `${derived}x. Fix the BODY (packages/contracts/skills/media-director.md, the SCENE DECK ` +
        "rules) and regenerate mediaDirector.ts — never this assertion.",
    ).toBe(derived);

    // The two historical spellings, named explicitly. This is a regression guard on the exact rot
    // that happened, not a blocklist over an open vocabulary — those cannot fail usefully.
    expect(body).not.toMatch(/fortieth|forty times/);
  });

  it("THE BODY TEACHES THE GENERATED-SECONDS CAP, and teaches the number the code enforces", () => {
    // Before 33.1-06 the body said "at most three or four `generated_video` scenes in a reel" and
    // said nothing about a seconds total. Under `MEDIA_GENERATED_SECONDS_CAP` that advice PRODUCES
    // REFUSED DECKS: four 4-second clips is 16 generated seconds, three 5-second clips is 15, and
    // both are rejected whole. A code-owned refusal the prose never learned about is this repo's
    // "a backend fix that never reaches the renderer", one layer up — the renderer here being the
    // model that reads the body.
    const body = read("../../contracts/skills/media-director.md");
    expect(
      body,
      `the body must state the ${MEDIA_GENERATED_SECONDS_CAP}-second generated total, or it ` +
        "teaches decks the reservation refuses",
    ).toContain(`at most ${MEDIA_GENERATED_SECONDS_CAP} seconds of \`generated_video\` IN TOTAL`);
    // And the old scene-COUNT advice must be gone, not merely supplemented: a body carrying both
    // gives the model two rules that disagree, and it will follow the one that is easier to satisfy.
    expect(body).not.toMatch(/at most three or four `generated_video` scenes/);
  });
});

describe("SC5 — the ceiling and its upgrade path exist in the source", () => {
  it("media.ts carries ponytail comments naming a ceiling AND an upgrade path", () => {
    expect(MEDIA_SRC).toMatch(/ponytail:/);
    expect(MEDIA_SRC.match(/[Uu]pgrade path/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it("the reconciliation procedure is runnable, not aspirational", () => {
    const playbook = read("../../../docs/playbooks/media.md");
    expect(playbook).toMatch(/^## Reconciliation$/m);
    // Split on the anchored HEADING, not on the bare string. The playbook legitimately REFERS to
    // `## Reconciliation` in prose four times above the section itself, and a bare split lands on
    // the first of those — so `[1]` was the header block, which has no command in it. Red at HEAD
    // since a foreign session added the registration note at the top; found by 20-07's full-suite
    // run and fixed here rather than worked around, because the guard's job is to prove the
    // SECTION is runnable.
    expect(playbook.split(/^## Reconciliation$/m)[1]).toMatch(/convex run/);
  });
  it("no time-stretch lever is reachable from the cost surface (delta pitfall 15)", () => {
    // Scoped deliberately: `\brate\b` would fire on `sample_rate_hertz`, which is a PINNED audio
    // sample size, not a playback lever. What must never appear is a KNOB — a field named speed or
    // rate, or an ffmpeg stretch filter.
    expect(MEDIA_SRC).not.toMatch(/\b(atempo|setpts)\b/i);
    expect(MEDIA_SRC).not.toMatch(/\b(speed|rate)\s*[:=]/i);
  });
  it("D4's superseded constants are GONE, not left as pullable aliases", () => {
    expect(MEDIA_SRC).not.toMatch(/MEDIA_BUDGET_USD_PER_REQUEST/);
    expect(MEDIA_SRC).not.toMatch(/over_batch_cap/);
  });
});

describe("the music bed — $0 is a PRICE, not an absence", () => {
  const bed = (over: Partial<{ model: string; mood: string }> = {}): MediaSpec => ({
    kind: "music",
    model: MEDIA_DEFAULT_MUSIC.model,
    mood: "calm",
    ...over,
  });

  it("prices every mood in the closed set at the flat per-track rate", () => {
    for (const mood of MUSIC_MOODS) {
      const priced = estimateMediaUsd(bed({ mood }));
      expect(priced.ok, `${mood} must be priceable`).toBe(true);
      expect(priced.ok && priced.value).toBe(MEDIA_MUSIC_PRICING[MEDIA_DEFAULT_MUSIC.model]);
    }
  });

  it("is a LINE — it reaches the batch and the batch still floors ONCE", () => {
    // The distinction the whole line exists for: $0 is a priced line that appears on the invoice,
    // not a thing that was skipped. Adding it must not change the reserved total by a cent.
    const withoutBed: MediaSpec[] = [{ kind: "render" }];
    const withBed: MediaSpec[] = [{ kind: "render" }, bed()];
    const a = chooseMediaBatch(withoutBed, MEDIA_JOB_CAP_USD);
    const b = chooseMediaBatch(withBed, MEDIA_JOB_CAP_USD);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && b.value.estCents).toBe(a.ok ? a.value.estCents : -1);
    expect(a.ok && b.ok && b.value.estUsd).toBe(a.ok ? a.value.estUsd : -1);
  });

  it("a mood outside the set is `unknown_model` — fail closed, never a fallback bed", () => {
    // The same posture as a missing resolution on a video row: nothing in the table prices this, so
    // it is refused rather than quietly served from some other row. "The caller already validated
    // it" is the assumption every pricing hole in this module was written to remove.
    for (const mood of ["lofi", "128bpm", "", "Bittersweet Symphony"]) {
      expect(estimateMediaUsd(bed({ mood }))).toEqual({
        ok: false,
        error: { code: "unknown_model" },
      });
    }
  });

  it("an unknown library version is `unknown_model` too", () => {
    expect(estimateMediaUsd(bed({ model: "library/v99" }))).toEqual({
      ok: false,
      error: { code: "unknown_model" },
    });
  });

  it("one unpriceable bed REFUSES the whole job rather than making it cheaper", () => {
    // estimateBatchUsd's own rule, asserted on the newest line to use it.
    expect(estimateBatchUsd([{ kind: "render" }, bed({ mood: "lofi" })])).toEqual({
      ok: false,
      error: { code: "unknown_model" },
    });
  });

  it("the table is keyed PER TRACK, which is what makes a generative vendor unreachable", () => {
    // Rule 1 of this module: the table is keyed by the unit the vendor actually bills on. A flat
    // per-track rate is pre-computable before the request exists; a per-generated-second or
    // per-compute-second one is not, and there is deliberately no seconds/duration term here to
    // multiply by. If a future edit adds one, this is where it has to argue with rule 3.
    const src = MEDIA_SRC.split("export const MEDIA_MUSIC_PRICING")[1]?.split("};")[0] ?? "";
    expect(src, "the music table must not gain a per-second term").not.toMatch(
      /perSecond|per_second|seconds/i,
    );
    expect(Object.values(MEDIA_MUSIC_PRICING).every((n) => n === 0)).toBe(true);
  });
});

describe("stock: a $0 line that still BUYS an asset", () => {
  const stockSpec = (media: "video" | "image", seconds = 6): MediaSpec => ({
    kind: "stock",
    model: MEDIA_DEFAULT_STOCK.model,
    media,
    seconds,
  });

  it("prices a stock clip and a stock still at exactly zero", () => {
    expect(estimateMediaUsd(stockSpec("video"))).toEqual({ ok: true, value: 0 });
    expect(estimateMediaUsd(stockSpec("image"))).toEqual({ ok: true, value: 0 });
  });

  it("refuses an unpriced library — fail closed, never a silent free pass", () => {
    const res = estimateMediaUsd({
      kind: "stock",
      model: "shutterstock/v9",
      media: "video",
      seconds: 6,
    });
    expect(res).toEqual({ ok: false, error: { code: "unknown_model" } });
  });

  it("refuses an unpriceable window rather than searching for a nonsense length", () => {
    for (const seconds of [Number.POSITIVE_INFINITY, Number.NaN, -4]) {
      expect(estimateMediaUsd(stockSpec("video", seconds))).toEqual({
        ok: false,
        error: { code: "illegal_duration" },
      });
    }
  });

  it("IS PRICED SEPARATELY FROM THE PAID VIDEO TABLE — the hole a shared table would open", () => {
    // If `pexels/v1` were a $0 row inside MEDIA_VIDEO_PRICING, a video spec naming it would price
    // a REAL generated clip at nothing. It must not resolve there at all.
    expect(MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_STOCK.model]).toBeUndefined();
    expect(MEDIA_IMAGE_PRICING[MEDIA_DEFAULT_STOCK.model]).toBeUndefined();
    expect(
      estimateMediaUsd({
        kind: "video",
        model: MEDIA_DEFAULT_STOCK.model,
        resolution: "720p",
        seconds: 4,
      }),
    ).toEqual({ ok: false, error: { code: "unknown_model" } });
    // ...and symmetrically, a paid model cannot be laundered through the stock table.
    expect(MEDIA_STOCK_PRICING[MEDIA_DEFAULT_VIDEO.model]).toBeUndefined();
  });

  it("the stock table has no per-second term — the rule-3 scan the music table gets", () => {
    const src = MEDIA_SRC.split("export const MEDIA_STOCK_PRICING")[1]?.split("};")[0] ?? "";
    expect(src.length, "the stock table must be found in source").toBeGreaterThan(0);
    expect(src, "the stock table must not gain a per-second term").not.toMatch(
      /perSecond|per_second|perCompute/i,
    );
    expect(Object.values(MEDIA_STOCK_PRICING).every((n) => n === 0)).toBe(true);
  });

  it("the deck kind decides the BYTES, and sceneVisualSpec carries the scene window through", () => {
    const clip = sceneVisualSpec("stock_video", 7);
    expect(clip.ok && clip.value?.spec).toEqual({
      kind: "stock",
      model: MEDIA_DEFAULT_STOCK.model,
      media: "video",
      seconds: 7,
    });
    const still = sceneVisualSpec("stock_image", 7);
    expect(still.ok && still.value?.spec).toEqual({
      kind: "stock",
      model: MEDIA_DEFAULT_STOCK.model,
      media: "image",
      seconds: 7,
    });
    expect(clip.ok && clip.value?.usd).toBe(0);
    expect(still.ok && still.value?.usd).toBe(0);
  });

  it("a stock scene is a LINE, not a null — `null` would mean no row, no fetch, no picture", () => {
    // The distinction the music bed does NOT share: music is a spec with no row, stock is a spec
    // WITH one. `null` here is what `uploaded_video` and `text_card` get, and it means the render
    // expects nothing to land. A stock scene must never be told that.
    expect(SCENE_VISUAL_LINE.stock_video).toBe("stock");
    expect(SCENE_VISUAL_LINE.stock_image).toBe("stock");
    expect(SCENE_VISUAL_LINE.uploaded_video).toBeNull();
    expect(SCENE_VISUAL_LINE.text_card).toBeNull();
  });

  it("a whole deck of stock still reserves — free pictures, and the render line is what is left", () => {
    const scenes: VisualKind[] = ["stock_video", "stock_image", "stock_video"];
    const specs = scenes.map((k) => {
      const line = sceneVisualSpec(k, 5);
      if (!line.ok || line.value === null) throw new Error("expected a stock line");
      return line.value.spec;
    });
    const batch = chooseMediaBatch([...specs, { kind: "render" }], MEDIA_JOB_CAP_USD);
    expect(batch.ok && batch.value.estUsd).toBe(MEDIA_SANDBOX_USD_PER_RENDER);
    // The cents floor happens ONCE on the total, so three free pictures add nothing at all —
    // they do not each floor to a cent. That is D12(a), and stock is where it pays off most.
    expect(batch.ok && batch.value.estCents).toBe(
      Math.max(1, Math.ceil(MEDIA_SANDBOX_USD_PER_RENDER * 100)),
    );
  });

  it("swapping a generated clip for stock is the whole cost lever, measured", () => {
    const generated = sceneVisualSpec("generated_video", 4);
    const stock = sceneVisualSpec("stock_video", 4);
    if (!generated.ok || generated.value === null) throw new Error("expected a video line");
    if (!stock.ok || stock.value === null) throw new Error("expected a stock line");
    expect(generated.value.usd).toBeGreaterThan(0);
    expect(stock.value.usd).toBe(0);
    // A SIXTY-SECOND reel is where the lever stops being an optimisation. All-generated it is 15
    // four-second clips — over the whole-job cap before a word is voiced — which is the
    // arithmetic `storyboard.ts` cites for why every legal reel mixes kinds. All-stock it is $0,
    // and the cap stops being the binding constraint on length at all.
    const allGeneratedAt60s = (generated.value.usd / 4) * 60;
    expect(allGeneratedAt60s).toBeGreaterThan(MEDIA_JOB_CAP_USD);
    expect((stock.value.usd / 4) * 60).toBe(0);
  });

  it("pins the two constants the ASSEMBLER depends on, not just the price", () => {
    // Both of these are things `assemble_final.sh` hard-fails or silently mis-renders on, so they
    // are pinned here rather than left as fetch-site defaults. See MEDIA_DEFAULT_STOCK.
    expect(MEDIA_DEFAULT_STOCK.orientation).toBe("portrait");
    expect(MEDIA_DEFAULT_STOCK.minDurationSlackSeconds).toBe(0.5);
  });
});
