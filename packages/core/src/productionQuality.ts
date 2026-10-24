import { VISUAL_KINDS, type VisualKind } from "./storyboard";

/** Candidate request vocabulary only. Passing this review does not price or enable a profile. */
export const IMAGE_QUALITY_PROFILES = ["low", "medium", "high"] as const;
export const IMAGE_QUALITY_PLACEMENTS = Object.freeze({
  portrait: { width: 1024, height: 1536 },
  square: { width: 1024, height: 1024 },
  landscape: { width: 1536, height: 1024 },
});
export function reviewImageQualityProposal(input: {
  model: string;
  quality: string;
  placement: string;
  width: number;
  height: number;
}): string[] {
  const issues: string[] = [];
  if (input.model !== "openai/gpt-image-2") issues.push("unsupported_image_model");
  if (!(IMAGE_QUALITY_PROFILES as readonly string[]).includes(input.quality))
    issues.push("unsupported_image_quality");
  const size = Object.entries(IMAGE_QUALITY_PLACEMENTS).find(
    ([key]) => key === input.placement,
  )?.[1];
  if (!size || input.width !== size.width || input.height !== size.height)
    issues.push("unsupported_image_placement");
  return issues;
}

/** Candidate house policy for REVIEW RECORDS, not automated pixel/audio inspection or an
 * admission/pricing gate. Evidence refs must identify the actual rendered artifact reviewed.
 * Platform chrome varies: this conservative vertical placement still needs device review. */
export const PRODUCTION_QUALITY_POLICY = Object.freeze({
  minSceneSeconds: 2,
  maxSceneSeconds: 8,
  maxGeneratedSeconds: 12,
  safeBox: Object.freeze({ x: 0.08, y: 0.1, width: 0.84, height: 0.7 }),
  minFontWidthRatio: 0.04,
  maxCaptionCharactersPerSecond: 20,
});

export type ReviewBox = { x: number; y: number; width: number; height: number };
export type ProductionSceneReview = {
  seconds: number;
  visual: VisualKind;
  scale: "wide" | "medium" | "detail" | "graphic";
  purpose: "hook" | "context" | "process" | "proof" | "payoff" | "cta";
  coverageKey: string;
  source: {
    kind: "owned" | "licensed" | "generated" | "card";
    ref: string;
    licenseRef?: string;
  };
  /** Generated/illustrative footage must never be evidence of an actual business event. */
  representsActualBusiness: boolean;
  overlay?: { box: ReviewBox; fontSizePx: number; text: string };
};
export type ProductionQualityReview = {
  targetSeconds: 30 | 60;
  width: number;
  height: number;
  scenes: readonly ProductionSceneReview[];
  captions: readonly {
    start: number;
    end: number;
    text: string;
    lines: number;
    fontSizePx: number;
    box: ReviewBox;
  }[];
  evidence: {
    renderedArtifactRef: string;
    visualReviewRef: string;
    audioReviewRef: string;
    captionReviewRef: string;
    consistentStyle: boolean;
    narrationIntelligible: boolean;
    noAudioClipping: boolean;
    musicBelowNarration: boolean;
  };
};
export type ProductionQualityIssue = { code: string; scene?: number; caption?: number };

const nonempty = (value: string | undefined): boolean => Boolean(value?.trim());
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const insideSafeBox = (box: ReviewBox): boolean => {
  const safe = PRODUCTION_QUALITY_POLICY.safeBox;
  return (
    Object.values(box).every(Number.isFinite) &&
    box.width > 0 &&
    box.height > 0 &&
    box.x >= safe.x &&
    box.y >= safe.y &&
    box.x + box.width <= safe.x + safe.width + 1e-9 &&
    box.y + box.height <= safe.y + safe.height + 1e-9
  );
};

/** Empty issues means this supplied review meets the candidate house policy. It does not prove
 * the assertions true, verify licenses, inspect media bytes, or authorize provider spending. */
export function reviewProductionQuality(review: ProductionQualityReview): ProductionQualityIssue[] {
  const issues: ProductionQualityIssue[] = [];
  const add = (code: string, scene?: number, caption?: number) =>
    issues.push({ code, scene, caption });
  const policy = PRODUCTION_QUALITY_POLICY;
  if (![30, 60].includes(review.targetSeconds)) add("unsupported_duration");
  if (
    !finitePositive(review.width) ||
    !finitePositive(review.height) ||
    Math.abs(review.width / review.height - 9 / 16) > 0.002
  )
    add("vertical_aspect");
  if (review.scenes.reduce((n, scene) => n + scene.seconds, 0) !== review.targetSeconds)
    add("timeline_total");
  if (review.scenes.length < (review.targetSeconds === 30 ? 6 : 10))
    add("insufficient_editorial_beats");
  if (review.scenes[0]?.purpose !== "hook") add("missing_opening_hook");
  if (!["cta", "payoff"].includes(review.scenes.at(-1)?.purpose ?? "")) add("missing_ending");
  if (
    new Set(review.scenes.map((scene) => scene.scale)).size < 3 ||
    !review.scenes.some((scene) => scene.scale === "detail")
  )
    add("shot_scale_variety");
  if (new Set(review.scenes.map((scene) => scene.purpose)).size < 4) add("shot_purpose_variety");
  const broll = review.scenes.filter(
    (scene) =>
      ["stock_video", "uploaded_video"].includes(scene.visual) &&
      ["owned", "licensed"].includes(scene.source.kind),
  );
  if (broll.length < 2 || new Set(broll.map((scene) => scene.coverageKey.trim())).size < 2)
    add("broll_coverage");
  if (
    review.scenes.reduce(
      (n, scene) => n + (scene.visual === "generated_video" ? scene.seconds : 0),
      0,
    ) > policy.maxGeneratedSeconds
  )
    add("generated_seconds");
  review.scenes.forEach((scene, index) => {
    if (!VISUAL_KINDS.includes(scene.visual)) add("unsupported_visual", index);
    if (
      !Number.isInteger(scene.seconds) ||
      scene.seconds < policy.minSceneSeconds ||
      scene.seconds > policy.maxSceneSeconds
    )
      add("scene_pacing", index);
    if (!nonempty(scene.coverageKey) || !nonempty(scene.source.ref))
      add("missing_source_or_coverage", index);
    const expectedSource = scene.visual.startsWith("stock_")
      ? "licensed"
      : scene.visual === "uploaded_video"
        ? "owned"
        : scene.visual === "text_card"
          ? "card"
          : "generated";
    if (scene.source.kind !== expectedSource) add("source_kind_mismatch", index);
    if (scene.source.kind === "licensed" && !nonempty(scene.source.licenseRef))
      add("missing_license_evidence", index);
    if (scene.representsActualBusiness && !["owned", "card"].includes(scene.source.kind))
      add("illustration_as_business_proof", index);
    if (
      index > 1 &&
      scene.scale === review.scenes[index - 1]?.scale &&
      scene.scale === review.scenes[index - 2]?.scale
    )
      add("repetitive_shot_scale", index);
    if (
      scene.overlay &&
      (!nonempty(scene.overlay.text) ||
        !insideSafeBox(scene.overlay.box) ||
        !finitePositive(scene.overlay.fontSizePx) ||
        scene.overlay.fontSizePx / review.width < policy.minFontWidthRatio)
    )
      add("overlay_readability", index);
  });
  if (review.captions.length === 0) add("missing_captions");
  let previousEnd = 0;
  review.captions.forEach((cue, index) => {
    if (
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < previousEnd ||
      cue.end <= cue.start ||
      cue.end > review.targetSeconds ||
      cue.start < 0
    )
      add("caption_timeline", undefined, index);
    if (
      !nonempty(cue.text) ||
      !Number.isInteger(cue.lines) ||
      cue.lines < 1 ||
      cue.lines > 2 ||
      cue.text.length / (cue.end - cue.start) > policy.maxCaptionCharactersPerSecond ||
      !insideSafeBox(cue.box) ||
      !finitePositive(cue.fontSizePx) ||
      cue.fontSizePx / review.width < policy.minFontWidthRatio
    )
      add("caption_readability", undefined, index);
    previousEnd = cue.end;
  });
  const evidence = review.evidence;
  if (
    ![
      evidence.renderedArtifactRef,
      evidence.visualReviewRef,
      evidence.audioReviewRef,
      evidence.captionReviewRef,
    ].every(nonempty)
  )
    add("missing_review_evidence");
  if (!evidence.consistentStyle) add("inconsistent_style");
  if (!evidence.narrationIntelligible || !evidence.noAudioClipping || !evidence.musicBelowNarration)
    add("audio_review_failed");
  return issues;
}
