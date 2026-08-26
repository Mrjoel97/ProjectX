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
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_IMAGE_PRICING,
  MEDIA_JOB_CAP_USD,
  MEDIA_MUSIC_PRICING,
  MEDIA_SANDBOX_USD_PER_RENDER,
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
