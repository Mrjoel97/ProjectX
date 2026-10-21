import { describe, expect, test } from "vitest";
import {
  chooseMediaBatch,
  MEDIA_DEFAULT_IMAGE,
  MEDIA_DEFAULT_STT,
  MEDIA_DEFAULT_VIDEO,
  MEDIA_DEFAULT_VOICE,
  type MediaSpec,
} from "../../cost/src/media";
import {
  type ProductionQualityReview,
  type ProductionSceneReview,
  reviewImageQualityProposal,
  reviewProductionQuality,
} from "./productionQuality";
import { IMAGE_QUALITY_BENCHMARK, REEL_QUALITY_BENCHMARKS } from "./productionQuality.fixtures";

const box = { x: 0.1, y: 0.65, width: 0.8, height: 0.1 };
const validReview = (targetSeconds: 30 | 60): ProductionQualityReview => {
  const fixture = REEL_QUALITY_BENCHMARKS[targetSeconds === 30 ? 0 : 1];
  return {
    targetSeconds,
    width: 1080,
    height: 1920,
    scenes: fixture.visuals.map((visual, index) => ({
      seconds: 5,
      visual,
      scale: ["wide", "detail", "medium", "graphic"][index % 4] as ProductionSceneReview["scale"],
      purpose: (index === 0
        ? "hook"
        : index === fixture.visuals.length - 1
          ? "cta"
          : ["process", "context", "proof", "payoff"][
              index % 4
            ]) as ProductionSceneReview["purpose"],
      coverageKey: `synthetic-coverage-${index}`,
      source: {
        kind: visual === "stock_video" ? "licensed" : visual === "text_card" ? "card" : "generated",
        ref: `synthetic-source-${index}`,
        licenseRef: "synthetic-license-only",
      },
      representsActualBusiness: false,
    })),
    captions: fixture.narration.map((text, index) => ({
      start: index * 5,
      end: index * 5 + 4,
      text,
      lines: 2,
      fontSizePx: 48,
      box,
    })),
    evidence: {
      renderedArtifactRef: "test-only-render",
      visualReviewRef: "test-only-visual",
      audioReviewRef: "test-only-audio",
      captionReviewRef: "test-only-captions",
      consistentStyle: true,
      narrationIntelligible: true,
      noAudioClipping: true,
      musicBelowNarration: true,
    },
  };
};
const codes = (review: ProductionQualityReview) =>
  reviewProductionQuality(review).map((issue) => issue.code);

describe("candidate production review policy", () => {
  test("candidate image profiles require an explicit supported quality and exact placement", () => {
    for (const size of IMAGE_QUALITY_BENCHMARK.sizes) {
      for (const quality of ["low", "medium", "high"]) {
        expect(
          reviewImageQualityProposal({ model: IMAGE_QUALITY_BENCHMARK.model, quality, ...size }),
        ).toEqual([]);
      }
    }
    expect(
      reviewImageQualityProposal({
        model: "auto",
        quality: "auto",
        placement: "portrait",
        width: 2048,
        height: 2048,
      }),
    ).toHaveLength(3);
  });
  test.each([
    30, 60,
  ] as const)("accepts a complete synthetic %is review without claiming real QA", (seconds) => {
    expect(reviewProductionQuality(validReview(seconds))).toEqual([]);
  });
  test("refuses off-aspect, invalid duration, NaN and generated-second overrun", () => {
    const review = validReview(30);
    review.width = 1536;
    review.scenes = review.scenes.map((scene) => ({ ...scene, seconds: Number.NaN }));
    expect(codes(review)).toEqual(
      expect.arrayContaining(["vertical_aspect", "timeline_total", "scene_pacing"]),
    );
    review.scenes = validReview(30).scenes.map((scene) => ({
      ...scene,
      visual: "generated_video",
      source: { kind: "generated", ref: "test" },
    }));
    expect(codes(review)).toContain("generated_seconds");
  });
  test("refuses generic repeated coverage and missing license or fabricated business proof", () => {
    const review = validReview(30);
    review.scenes = review.scenes.map((scene) => ({
      ...scene,
      scale: "medium",
      coverageKey: "same",
      purpose: "process",
      source: { ...scene.source, licenseRef: undefined },
      representsActualBusiness: true,
    }));
    expect(codes(review)).toEqual(
      expect.arrayContaining([
        "broll_coverage",
        "shot_scale_variety",
        "shot_purpose_variety",
        "repetitive_shot_scale",
        "missing_license_evidence",
        "illustration_as_business_proof",
      ]),
    );
  });
  test("requires review evidence and rejects unsafe, crowded, tiny or overlapping captions", () => {
    const review = validReview(30);
    review.evidence.audioReviewRef = "";
    review.evidence.consistentStyle = false;
    review.evidence.musicBelowNarration = false;
    review.captions = [
      {
        start: 0,
        end: 0.1,
        text: "This caption is far too dense to read.",
        lines: 3,
        fontSizePx: 12,
        box: { ...box, y: 0.9 },
      },
      ...review.captions,
    ];
    expect(codes(review)).toEqual(
      expect.arrayContaining([
        "caption_timeline",
        "caption_readability",
        "missing_review_evidence",
        "inconsistent_style",
        "audio_review_failed",
      ]),
    );
  });
  test("official output estimates are frozen, explicit and have no asserted full-exposure cap", () => {
    const expected = [
      [158, 1372, 5488],
      [196, 1756, 7024],
      [158, 1372, 5488],
    ];
    IMAGE_QUALITY_BENCHMARK.sizes.forEach((size, index) => {
      // Exact formula in OpenAI's published GPT Image 2 calculator, not older-model table.
      const observed = [16, 48, 96].map((longAxis) => {
        const axis =
          longAxis / (Math.max(size.width, size.height) / Math.min(size.width, size.height));
        const floor = Math.floor(axis);
        const shortAxis = axis - floor === 0.5 ? floor + (floor % 2) : Math.round(axis);
        return Math.ceil(
          (longAxis * shortAxis * (2_000_000 + size.width * size.height)) / 4_000_000,
        );
      });
      expect(observed).toEqual(expected[index]);
      expect(Object.values(size.outputTokens)).toEqual(expected[index]);
    });
    expect(IMAGE_QUALITY_BENCHMARK.fullExposureCeilingUsd).toBeNull();
  });
  test("frozen reel estimates reuse current shared prices, 2x voice allowance and ceil once per reel", () => {
    const reservations = REEL_QUALITY_BENCHMARKS.map((fixture) => {
      const specs: MediaSpec[] = fixture.visuals.flatMap((visual): MediaSpec[] =>
        visual === "generated_video"
          ? [{ kind: "video", ...MEDIA_DEFAULT_VIDEO, seconds: 5 }]
          : visual === "animated_image"
            ? [{ kind: "image", ...MEDIA_DEFAULT_IMAGE }]
            : visual === "stock_video"
              ? [{ kind: "stock", model: "pexels/v1", media: "video", seconds: 5 }]
              : [],
      );
      for (const narration of fixture.narration) {
        expect(narration.length).toBeLessThanOrEqual(5 * 14);
        specs.push({
          kind: "tts",
          model: MEDIA_DEFAULT_VOICE.model,
          characters: narration.length * 2,
        });
      }
      specs.push(
        { kind: "stt", model: MEDIA_DEFAULT_STT.model, audioMinutes: fixture.targetSeconds / 60 },
        { kind: "music", model: "library/v1", mood: "warm" },
        { kind: "render" },
      );
      return chooseMediaBatch(specs, 3.5);
    });
    expect(reservations.map((item) => (item.ok ? item.value.estCents : item.error))).toEqual([
      41, 77,
    ]);
  });
});
