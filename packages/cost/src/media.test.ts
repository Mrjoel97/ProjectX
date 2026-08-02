import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chooseMediaBatch,
  estimateBatchUsd,
  estimateMediaUsd,
  MEDIA_DEFAULT_IMAGE,
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  MEDIA_IMAGE_PRICING,
  MEDIA_JOB_CAP_USD,
  MEDIA_SANDBOX_USD_PER_RENDER,
  MEDIA_STT_PRICING,
  MEDIA_TTS_PRICING,
  MEDIA_VIDEO_PRICING,
  type MediaSpec,
  type VideoRes,
} from "./media";

const WAN = MEDIA_DEFAULT_VIDEO.model;
const clip = (resolution: VideoRes = "480p", seconds = 10): MediaSpec => ({
  kind: "video",
  model: WAN,
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
  it("Wan 2.5 480p x 10 s = $0.50", () => expect(usd(clip())).toBeCloseTo(0.5, 10));
  it("720p is 2x and 1080p is 3x the 480p line", () => {
    expect(usd(clip("720p"))).toBeCloseTo(1.0, 10);
    expect(usd(clip("1080p"))).toBeCloseTo(1.5, 10);
  });
  it("an unpriced model → unknown_model (a Veo-class endpoint is not in the table)", () => {
    expect(codeOf({ kind: "video", model: "fal-ai/veo3", resolution: "480p", seconds: 10 })).toBe(
      "unknown_model",
    );
  });
  it("a resolution missing from the model's row → unknown_model, NEVER a tier fallback", () => {
    expect(codeOf(clip("4k" as VideoRes))).toBe("unknown_model");
  });
  it("a duration outside {5,10} → illegal_duration, a DISTINCT lever from unknown_model", () => {
    for (const s of [3, 7, 15, 0]) expect(codeOf(clip("480p", s))).toBe("illegal_duration");
    expect(codeOf(clip("480p", 5))).toBe("ok");
  });
  it("a non-finite duration is refused, never NaN dollars", () => {
    expect(codeOf(clip("480p", Number.NaN))).toBe("illegal_duration");
  });
});

describe("estimateMediaUsd — the billing units differ, and the tests sit side by side", () => {
  it("IMAGES round megapixels UP: 1080x1920 = 2.0736 MP bills as 3 MP → $0.009", () => {
    const { model, width, height } = MEDIA_DEFAULT_IMAGE;
    expect(usd({ kind: "image", model, width, height })).toBeCloseTo(0.009, 10);
  });
  it("TTS does NOT round its thousands: 1,200 chars → $0.012 exactly", () => {
    expect(usd(voice(1200))).toBeCloseTo(0.012, 10);
  });
  it("…and 1 char is a fraction of a cent, not a whole thousand", () => {
    expect(usd(voice(1))).toBeCloseTo(0.00001, 12);
  });
  it("STT bills whole INPUT audio minutes: 1 min → $0.008, 30 s still buys one", () => {
    const stt = (audioMinutes: number): MediaSpec => ({
      kind: "stt",
      model: MEDIA_DEFAULT_STT.model,
      audioMinutes,
    });
    expect(usd(stt(1))).toBeCloseTo(0.008, 10);
    expect(usd(stt(0.5))).toBeCloseTo(0.008, 10);
    expect(usd(stt(2))).toBeCloseTo(0.016, 10);
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
  ...Array.from({ length: 6 }, () => clip()), // 6 x 480p x 10 s = $3.000
  voice(1200), //                                voice            = $0.012
  voice(1200), //                                retry allowance  = $0.012
  { kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes: 1 }, // captions = $0.008
  { kind: "render" }, //                         render           = $0.020
];

describe("estimateBatchUsd + the job cap", () => {
  it("the §4.1 job totals $3.052 and PASSES the $3.50 cap with 12.8% headroom", () => {
    const total = estimateBatchUsd(JOB_4_1);
    expect(total.ok).toBe(true);
    if (total.ok) expect(total.value).toBeCloseTo(3.052, 10);
    const chosen = chooseMediaBatch(JOB_4_1, MEDIA_JOB_CAP_USD);
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.estCents).toBe(306);
  });
  it("6 blocks at 720p ($6.00+) → over_job_cap", () => {
    const job = [...Array.from({ length: 6 }, () => clip("720p")), { kind: "render" } as MediaSpec];
    const r = chooseMediaBatch(job, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_job_cap");
  });
  it("12 blocks at 480p ($6.00+) → over_job_cap", () => {
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
      { kind: "video", model: "fal-ai/veo3", resolution: "480p", seconds: 10 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown_model");
  });
  it("free line items contribute 0 and never make a job unknown_model", () => {
    const r = estimateBatchUsd([clip(), { kind: "free" }, { kind: "free" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(0.5, 10);
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
  it("6 lines of $0.002 reserve 2 cents ($0.012 → ceil 1.2), NOT 6", () => {
    // NB: the plan wrote "1 cent, not 6". $0.012 is 1.2 cents, so the fail-closed ceiling is 2.
    // The number that matters is the CONTRAST: per-line flooring reserves 6 — 3x this, 5x the
    // true cost. Corrected here rather than asserted wrong.
    const six = Array.from({ length: 6 }, () => voice(200));
    const r = chooseMediaBatch(six, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.estUsd).toBeCloseTo(0.012, 10);
    expect(r.value.estCents).toBe(2);
    // what per-line flooring would have reserved, spelled out so the regression is legible:
    expect(six.reduce((c, s) => c + Math.max(1, Math.ceil(usd(s) * 100)), 0)).toBe(6);
  });
  it("13 sub-cent lines reserve 1 cent, not 13", () => {
    const thirteen = Array.from({ length: 13 }, () => voice(50)); // $0.0005 each → $0.0065
    const r = chooseMediaBatch(thirteen, MEDIA_JOB_CAP_USD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.estCents).toBe(1);
  });
  it("estUsd stays FRACTIONAL — the row stores USD, only the reservation is cents", () => {
    const r = chooseMediaBatch([voice(1200)], MEDIA_JOB_CAP_USD);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.estUsd).toBeCloseTo(0.012, 10);
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
  it("every fixture entry records a live, non-deprecated endpoint", () => {
    for (const e of FIXTURES.entries) {
      expect(e.vendor.deprecated).toBe(false);
      expect(e.vendor.removed).toBe(false);
      expect(e.vendor.status).toBe("public");
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
