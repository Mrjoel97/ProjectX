import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildNativeScenePrompt,
  NATIVE_TARGET_DURATIONS,
  validateNativeSceneDeck,
} from "./nativeMedia";
import { parseVariations } from "./storyboard";

const nativeScene = (index = 0, seconds = 5) => ({
  index,
  startMs: index * seconds * 1000,
  durationMs: seconds * 1000,
  visual: "generated_video",
  prompt: "The same supplied product, golden-hour side light, stable profile.",
  narration: "Meet the collection.",
});
const scenes = (count: number, seconds = 5) =>
  Array.from({ length: count }, (_, index) => nativeScene(index, seconds));
describe("native audiovisual deck admission", () => {
  it("admits exact 30,45,60 second generated decks", () => {
    expect(NATIVE_TARGET_DURATIONS).toEqual([30, 45, 60]);
    for (const seconds of NATIVE_TARGET_DURATIONS) {
      expect(
        validateNativeSceneDeck({ targetDurationSeconds: seconds, scenes: scenes(seconds / 5) }),
      ).toEqual({ ok: true });
    }
  });
  it("refuses wrong target, external assets, mixed scenes and malformed timing", () => {
    expect(validateNativeSceneDeck({ targetDurationSeconds: 15, scenes: scenes(3) })).toMatchObject(
      { ok: false, reason: "bad_target_duration" },
    );
    for (const visual of [
      "animated_image",
      "stock_video",
      "stock_image",
      "text_card",
      "uploaded_video",
    ]) {
      const deck = scenes(6);
      deck[0] = { ...nativeScene(), visual };
      expect(validateNativeSceneDeck({ targetDurationSeconds: 30, scenes: deck })).toMatchObject({
        ok: false,
        reason: "native_requires_generated_video",
      });
    }
    expect(
      validateNativeSceneDeck({
        targetDurationSeconds: 30,
        scenes: [{ ...nativeScene(), asset: { docId: "untrusted" } }, ...scenes(6).slice(1)],
      }),
    ).toMatchObject({ ok: false, reason: "native_requires_generated_video" });
    expect(
      validateNativeSceneDeck({
        targetDurationSeconds: 30,
        scenes: [{ ...nativeScene(), startMs: 1 }, ...scenes(6).slice(1)],
      }),
    ).toMatchObject({ ok: false, reason: "bad_scene_timing" });
  });
  it("refuses fractional/off-grid duration, blank prompt and wrong total", () => {
    for (const durationMs of [3000, 4500, 16000, Number.NaN]) {
      expect(
        validateNativeSceneDeck({
          targetDurationSeconds: 30,
          scenes: [{ ...nativeScene(), durationMs }, ...scenes(6).slice(1)],
        }),
      ).toMatchObject({ ok: false, reason: "illegal_generated_duration" });
    }
    expect(
      validateNativeSceneDeck({
        targetDurationSeconds: 30,
        scenes: [{ ...nativeScene(), prompt: " " }, ...scenes(6).slice(1)],
      }),
    ).toMatchObject({ ok: false, reason: "missing_prompt" });
    expect(validateNativeSceneDeck({ targetDurationSeconds: 30, scenes: scenes(5) })).toMatchObject(
      { ok: false, reason: "duration_mismatch" },
    );
  });
  it("native speech cannot borrow the following silent clip", () => {
    const deck = scenes(6);
    const first = deck[0],
      second = deck[1];
    if (!first || !second) throw new Error("native fixture missing scenes");
    first.narration = "x".repeat(71);
    second.narration = "";
    expect(validateNativeSceneDeck({ targetDurationSeconds: 30, scenes: deck })).toMatchObject({
      ok: false,
      reason: "narration_too_long",
      sceneIndex: 0,
    });
    first.narration = "x".repeat(70);
    expect(validateNativeSceneDeck({ targetDurationSeconds: 30, scenes: deck })).toEqual({
      ok: true,
    });
  });
  it("binds visual, exact narration, overlay and sound intent into one deterministic prompt", () => {
    const scene = {
      prompt: "The supplied bottle, same label.",
      narration: 'Say "hello".\nThen pause.',
      overlay: "Meet it",
    };
    const prompt = buildNativeScenePrompt(scene, "warm");
    expect(buildNativeScenePrompt(scene, "warm")).toBe(prompt);
    const data = JSON.parse(prompt.split("\n").at(-1) ?? "");
    expect(data.exactNarration).toBe(scene.narration);
    expect(data.sound.musicMood).toBe("warm");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    for (const changed of [
      buildNativeScenePrompt({ ...scene, prompt: "Another angle" }, "warm"),
      buildNativeScenePrompt({ ...scene, narration: "Different words" }, "warm"),
      buildNativeScenePrompt({ ...scene, overlay: "Other text" }, "warm"),
      buildNativeScenePrompt(scene, "calm"),
    ]) {
      expect(hash(changed)).not.toBe(hash(prompt));
    }
  });
  it("both registry-authored native examples survive the exact admission helper", () => {
    const body = readFileSync(
      fileURLToPath(new URL("../../contracts/skills/media-director.md", import.meta.url)),
      "utf8",
    );
    const variants = parseVariations(body);
    expect(variants.kind).toBe("two");
    if (variants.kind !== "two") throw new Error("native examples failed parsing");
    for (const variant of [variants.a, variants.b])
      expect(validateNativeSceneDeck(variant.deck)).toEqual({ ok: true });
    expect(body).toContain("golden-hour");
    expect(body).toContain("Never invent a feature");
  });
});
