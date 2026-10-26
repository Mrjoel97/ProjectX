import { describe, expect, it } from "vitest";
import { parseMediaFinishing } from "./mediaFinishing";
import { parseSceneDeck } from "./storyboard";

describe("native finishing bounds", () => {
  it("keeps literal text and normalizes scene-relative timing", () => {
    expect(parseMediaFinishing({ overlay: "FORMA: 100%", transitionOut: "fade" }, 4000)).toEqual({
      overlay: "FORMA: 100%",
      overlayStartMs: 0,
      overlayEndMs: 4000,
      transitionOut: "fade",
    });
  });
  it("refuses unreadable and outside-scene overlays and unimplemented effects", () => {
    for (const cue of [
      { overlay: "a\nb" },
      { overlay: "a".repeat(81) },
      { overlay: "hello", overlayEndMs: 4500 },
      { overlay: "hello", overlayStartMs: 1000, overlayEndMs: 1200 },
      { overlayStartMs: 0 },
      { transitionOut: "morph" },
    ])
      expect(
        parseMediaFinishing(cue as Parameters<typeof parseMediaFinishing>[0], 4000),
      ).toBeNull();
  });
});

it("parses reviewed timing/transition columns and refuses unsupported effects", () => {
  const deck = [
    "SCENE DECK",
    "Target duration: 15",
    "| # | Visual | Seconds | Description | Narration | Text overlay | Overlay start ms | Overlay end ms | Transition out | Motion graphic |",
    "|---|---|---|---|---|---|---|---|---|---|",
    "| 1 | generated_video | 15 | Bottle rises | Meet Forma. | FORMA | 500 | 2500 | fade | orbit-ring |",
  ].join("\n");
  const parsed = parseSceneDeck(deck);
  expect(parsed.ok).toBe(true);
  if (parsed.ok)
    expect(parsed.scenes[0]).toMatchObject({
      overlay: "FORMA",
      overlayStartMs: 500,
      overlayEndMs: 2500,
      transitionOut: "fade",
      motionGraphic: "orbit-ring",
    });
  expect(parseSceneDeck(deck.replace("| fade |", "| morph |")).ok).toBe(false);
  expect(parseSceneDeck(deck.replace("| 2500 |", "| 15500 |")).ok).toBe(false);
  expect(parseSceneDeck(deck.replace("| orbit-ring |", "| arbitrary-model |")).ok).toBe(false);
});
