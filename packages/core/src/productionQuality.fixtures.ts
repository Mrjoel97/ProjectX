/** Frozen proposals, NOT generated media or passed quality reviews. No API caller imports this
 * file. Output estimates reproduce OpenAI's published calculator, checked 2026-10-21; they are
 * NOT provider exposure ceilings and exclude text/image inputs and streaming partial images. */
export const IMAGE_QUALITY_BENCHMARK = Object.freeze({
  id: "soko-editorial-v1",
  model: "openai/gpt-image-2",
  provider: "openai",
  prompt:
    "Editorial still life of three unbranded reusable bottles on a warm ivory shelf, one deep teal bottle and two terracotta bottles. Soft window light from camera left. Tactile matte surfaces, restrained warm shadows, believable proportions. One bottle foreground right, two behind at different heights. Keep the central upper third quiet for a separately rendered headline. No text, letters, logos, people, extra objects or watermarks. Photograph-like, deliberate product composition.",
  outputFormat: "png",
  n: 1,
  sizes: Object.freeze([
    Object.freeze({
      placement: "portrait",
      width: 1024,
      height: 1536,
      outputTokens: Object.freeze({ low: 158, medium: 1372, high: 5488 }),
    }),
    Object.freeze({
      placement: "square",
      width: 1024,
      height: 1024,
      outputTokens: Object.freeze({ low: 196, medium: 1756, high: 7024 }),
    }),
    Object.freeze({
      placement: "landscape",
      width: 1536,
      height: 1024,
      outputTokens: Object.freeze({ low: 158, medium: 1372, high: 5488 }),
    }),
  ]),
  outputUsdPerMillionTokens: 30,
  inputTextUsdPerMillionTokens: 5,
  fullExposureCeilingUsd: null,
  calculatorSource: "https://developers.openai.com/api/docs/guides/image-generation",
  endpointSource: "https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints",
} as const);

/** One approved synthetic fact sheet; no external factual/business-performance claims. Stock
 * is illustrative, never represented as the fictional brand's premises, staff or product. */
export const REEL_QUALITY_BENCHMARKS = Object.freeze([
  Object.freeze({
    id: "soko-30-v1",
    targetSeconds: 30 as const,
    brief:
      "Make a warm, precise vertical 30-second concept reel for fictional Soko Studio about an uncluttered refill station. Only the supplied synthetic facts: reusable bottles, a place for each item, and a reminder to refill. No environmental savings, certifications, prices, testimonials or real-business claims. Palette ivory, deep teal and terracotta. Six purposeful hard-cut scenes. One five-second generated motion opening, one five-second animated still, three different licensed illustrative B-roll clips (hands arranging bottles, pouring water, a tidy shelf), and a five-second closing card. Demonstrate a clear hook, process, detail, payoff and action. Style must stay consistent; stock is illustrative. Voice is calm; licensed instrumental bed stays below narration. Readable captions and CTA in the reviewed safe area. No generated lettering.",
    visuals: [
      "generated_video",
      "stock_video",
      "stock_video",
      "animated_image",
      "stock_video",
      "text_card",
    ] as const,
    narration: [
      "Give every bottle a place to come back to.",
      "Keep the things you reach for close at hand.",
      "Leave a little room for the refill ritual.",
      "A quiet shelf can make the next step clear.",
      "Return each bottle to its own simple spot.",
      "Make a place. Refill. Start again tomorrow.",
    ] as const,
  }),
  Object.freeze({
    id: "soko-60-v1",
    targetSeconds: 60 as const,
    brief:
      "Extend soko-30-v1 to a 60-second editorial concept, preserving the same synthetic facts, palette, lighting and bottle design. Twelve five-second scenes, not a stretched 30-second edit. Two generated clips total ten seconds; two animated stills; six distinct licensed illustrative B-roll clips with wide, medium and detail coverage; two readable cards including the closing action. Coverage: hands arranging, bottle detail, water pouring, shelf wide, returning bottle, quiet counter. No duplicate asset masquerading as new B-roll. Develop hook, context, process, demonstration, pause, payoff and action. Calm intelligible narration, intentional silent breathing room, consistent instrumental bed, synchronized captions. Stock is illustrative, never real Soko staff or premises. Hard cuts only; no unsupported transitions or native-1080p source promises.",
    visuals: [
      "generated_video",
      "stock_video",
      "stock_video",
      "animated_image",
      "stock_video",
      "text_card",
      "stock_video",
      "generated_video",
      "stock_video",
      "animated_image",
      "stock_video",
      "text_card",
    ] as const,
    narration: [
      "Give every bottle a place to come back to.",
      "Begin with the things you use every day.",
      "Keep the shapes simple and easy to find.",
      "Leave some space around each familiar object.",
      "A small refill can be a moment to pause.",
      "No elaborate system. Just a place to return.",
      "Move what you need within a comfortable reach.",
      "Let one clear action carry the whole moment.",
      "Then put each bottle back where it belongs.",
      "Keep the shelf quiet and the next step clear.",
      "Find a rhythm that fits your own routine.",
      "Make a place. Refill. Start again tomorrow.",
    ] as const,
  }),
] as const);
