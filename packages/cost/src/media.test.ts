import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MUSIC_MOODS, TARGET_DURATIONS, type VisualKind } from "@pikar/core/storyboard";
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
  it("Sora 2 720p x 4 s = $0.40", () => expect(usd(clip())).toBeCloseTo(0.4, 10));
  it("an unpriced model → unknown_model (a Veo-class endpoint is not in the table)", () => {
    expect(codeOf({ kind: "video", model: "fal-ai/veo3", resolution: "720p", seconds: 4 })).toBe(
      "unknown_model",
    );
  });
  it("a resolution missing from the model's row → unknown_model, NEVER a tier fallback", () => {
    expect(codeOf(clip("4k" as VideoRes))).toBe("unknown_model");
  });
  it("a Sora duration outside {4,8,12} → illegal_duration", () => {
    for (const s of [3, 5, 10, 15, 0]) expect(codeOf(clip("720p", s))).toBe("illegal_duration");
    for (const s of [4, 8, 12]) expect(codeOf(clip("720p", s))).toBe("ok");
  });
  it("a non-finite duration is refused, never NaN dollars", () => {
    expect(codeOf(clip("480p", Number.NaN))).toBe("illegal_duration");
  });
});

describe("estimateMediaUsd — the billing units differ, and the tests sit side by side", () => {
  it("GPT Image 2 low portrait reserves one cent including prompt allowance", () => {
    const { model, width, height } = MEDIA_DEFAULT_IMAGE;
    expect(usd({ kind: "image", model, width, height })).toBeCloseTo(0.01, 10);
  });
  it("TTS does NOT round its thousands: 1,200 chars → $0.018 exactly", () => {
    expect(usd(voice(1200))).toBeCloseTo(0.018, 10);
  });
  it("…and 1 char is a fraction of a cent, not a whole thousand", () => {
    expect(usd(voice(1))).toBeCloseTo(0.000015, 12);
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

// The §4.1 job, as data. This is the reel the phase is budgeted around.
const JOB_4_1: MediaSpec[] = [
  ...Array.from({ length: 6 }, () => clip()), // 6 x 720p x 4 s = $2.400
  voice(1200), //                                voice            = $0.018
  voice(1200), //                                retry allowance  = $0.018
  { kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes: 1 }, // captions = $0.006
  { kind: "render" }, //     render, incl. the one auto-retry sandbox (33-04)  = $0.040
];

describe("estimateBatchUsd + the job cap", () => {
  it("the six-block Sora job totals $2.482 and PASSES the $3.50 cap", () => {
    const total = estimateBatchUsd(JOB_4_1);
    expect(total.ok).toBe(true);
    // 33-04: was 2.462 — the render line doubled at its source to reserve the one auto retry.
    if (total.ok) expect(total.value).toBeCloseTo(2.482, 10);
    const chosen = chooseMediaBatch(JOB_4_1, MEDIA_JOB_CAP_USD);
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.estCents).toBe(249);
  });
  it("9 Sora blocks at 720p ($3.60+) → over_job_cap", () => {
    const job = [...Array.from({ length: 9 }, () => clip()), { kind: "render" } as MediaSpec];
    const r = chooseMediaBatch(job, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_job_cap");
  });
  it("12 Sora blocks at 720p ($4.80+) → over_job_cap", () => {
    const r = chooseMediaBatch(
      Array.from({ length: 12 }, () => clip()),
      MEDIA_JOB_CAP_USD,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_job_cap");
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
    if (r.ok) expect(r.value).toBeCloseTo(0.4, 10);
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
  it("6 lines of $0.003 reserve 2 cents ($0.018 → ceil 1.8), NOT 6", () => {
    // NB: the plan wrote "1 cent, not 6". $0.012 is 1.2 cents, so the fail-closed ceiling is 2.
    // The number that matters is the CONTRAST: per-line flooring reserves 6 — 3x this, 5x the
    // true cost. Corrected here rather than asserted wrong.
    const six = Array.from({ length: 6 }, () => voice(200));
    const r = chooseMediaBatch(six, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.estUsd).toBeCloseTo(0.018, 10);
    expect(r.value.estCents).toBe(2);
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
    expect(r.value.estUsd).toBeCloseTo(0.018, 10);
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
    reel30s: { mixed: { pictureUsd: number } };
    targetsUnreachableByGeneratedVideoAlone: number[];
  };
};

describe("the price tables agree with the committed vendor fixture", () => {
  const byKind = (k: string) => {
    const e = FIXTURES.entries.find((x) => x.kind === k);
    if (!e) throw new Error(`no fixture entry for ${k}`);
    return e;
  };

  it("video rates match, per resolution", () => {
    const e = byKind("video");
    expect(MEDIA_VIDEO_PRICING[e.id]).toEqual(e.rates);
  });
  it("image, tts and stt rates match", () => {
    expect(MEDIA_IMAGE_PRICING[byKind("image").id]).toBe(byKind("image").rate);
    expect(MEDIA_TTS_PRICING[byKind("tts").id]).toBe(byKind("tts").rate);
    expect(MEDIA_STT_PRICING[byKind("stt").id]).toBe(byKind("stt").rate);
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
  const daysUntil = (iso: string): number =>
    Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.now()) / 86_400_000);

  it("A PINNED MODEL THAT IS DEPRECATED CARRIES A WRITTEN SUCCESSION DECISION", () => {
    // The point is that "we know" has to become "it is written down". A deprecation with nobody
    // named as its replacement is how a dependency dies quietly.
    for (const e of FIXTURES.entries) {
      if (!e.vendor.deprecated || !PINNED_MODELS.has(e.id)) continue;
      const succession = (e as { succession?: { status?: string; why?: string } }).succession;
      expect(
        succession,
        `${e.id} is deprecated and PINNED, but no \`succession\` is recorded in media.fixtures.json`,
      ).toBeDefined();
      expect(succession?.status).toMatch(/^(decision_pending|decided|migrated)$/);
      expect((succession?.why ?? "").length, `${e.id}: succession.why must say WHY`).toBeGreaterThan(
        40,
      );
    }
  });

  it("A PINNED MODEL IS NOT ALREADY PAST ITS SHUTDOWN DATE", () => {
    // The last line of defence. If this is red, the product is shipping requests to an endpoint the
    // vendor has withdrawn — every `generated_video` scene is failing right now.
    for (const e of FIXTURES.entries) {
      if (!e.vendor.shutdown || !PINNED_MODELS.has(e.id)) continue;
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
    const RUNWAY_DAYS = 14;
    for (const e of FIXTURES.entries) {
      const succession = (e as {
        succession?: { status?: string; replacementWiredUp?: boolean };
      }).succession;
      if (!e.vendor.shutdown || !PINNED_MODELS.has(e.id)) continue;
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
    // 40x, at 4 s. The block contract had no way to express this and bought a clip every time.
    expect(sceneUsd("generated_video", 4) / sceneUsd("animated_image", 4)).toBeCloseTo(40, 10);
  });

  it("a generated clip is priced at ITS OWN length, and one off the provider grid is refused", () => {
    expect(sceneUsd("generated_video", 8)).toBeCloseTo(0.8, 10);
    expect(sceneUsd("generated_video", 12)).toBeCloseTo(1.2, 10);
    for (const seconds of [5, 6, 10, 15]) {
      const r = sceneVisualSpec("generated_video", seconds);
      expect(r.ok ? "ok" : r.error.code).toBe("illegal_duration");
    }
  });

  it("the §2.3 30-second reel costs what the ADR claims", () => {
    const pictures =
      3 * sceneUsd("generated_video", 4) +
      4 * sceneUsd("animated_image", 4) +
      sceneUsd("text_card", 2);
    expect(pictures).toBeCloseTo(SCENE.reel30s.mixed.pictureUsd, 10);
  });

  it("NOT ONE target duration is reachable with generated video alone", () => {
    const grid = MEDIA_VIDEO_SECONDS[MEDIA_DEFAULT_VIDEO.model] ?? [];
    /** Can `t` seconds be filled EXACTLY with the pinned model's own clip lengths? */
    const fillable = (t: number): boolean => {
      const reached = Array.from({ length: t + 1 }, () => false);
      reached[0] = true;
      for (let i = 1; i <= t; i++) reached[i] = grid.some((g) => g <= i && reached[i - g]);
      return reached[t] ?? false;
    };
    const perSecond =
      MEDIA_VIDEO_PRICING[MEDIA_DEFAULT_VIDEO.model]?.[MEDIA_DEFAULT_VIDEO.resolution];
    for (const target of TARGET_DURATIONS) {
      // Video is priced per SECOND, so every composition of `target` costs the same — the cap check
      // needs the length, not the arrangement. 15 and 30 fail the arithmetic (every supported clip
      // length is a multiple of 4); 60 is composable and costs $6.00, over the $3.50 job cap.
      const usd = target * (perSecond ?? 0);
      expect(fillable(target) && usd <= MEDIA_JOB_CAP_USD).toBe(false);
    }
    expect([...TARGET_DURATIONS]).toEqual(SCENE.targetsUnreachableByGeneratedVideoAlone);
    expect(fillable(28)).toBe(true); // the grid itself works — 28 s is buildable, 30 s is not
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
    const res = estimateMediaUsd({ kind: "stock", model: "shutterstock/v9", media: "video", seconds: 6 });
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
