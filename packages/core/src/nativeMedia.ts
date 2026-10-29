import { type MediaFinishing, parseMediaFinishing } from "./mediaFinishing";
import { GENERATED_CLIP_SECONDS, MAX_CHARS_PER_SECOND, MUSIC_MOODS } from "./storyboard";

/** Absence on existing plans means separate audio; new native plans opt in explicitly. */
export type MediaAudioMode = "native" | "separate";
export const NATIVE_TARGET_DURATIONS = [15, 30, 45, 60] as const;

type NativeScene = MediaFinishing & {
  index?: number;
  startMs?: number;
  durationMs: number;
  visual?: string;
  prompt?: string;
  narration?: string;
  overlay?: string;
  asset?: unknown;
};
export type NativeDeckRefusal =
  | "bad_target_duration"
  | "empty_deck"
  | "native_requires_generated_video"
  | "illegal_generated_duration"
  | "duration_mismatch"
  | "narration_too_long"
  | "bad_scene_timing"
  | "missing_prompt"
  | "bad_finishing";

/** Revalidates stored scenes before admission. Native speech must fit its own clip: another
 * silent scene cannot lend time to audio already generated inside a different provider clip. */
export function validateNativeSceneDeck(deck: {
  targetDurationSeconds: number;
  scenes: readonly NativeScene[];
}): { ok: true } | { ok: false; reason: NativeDeckRefusal; sceneIndex?: number } {
  if (!(NATIVE_TARGET_DURATIONS as readonly number[]).includes(deck.targetDurationSeconds)) {
    return { ok: false, reason: "bad_target_duration" };
  }
  if (deck.scenes.length === 0) return { ok: false, reason: "empty_deck" };
  if (deck.scenes.length > 15) return { ok: false, reason: "duration_mismatch" };
  let totalMs = 0;
  for (const [i, scene] of deck.scenes.entries()) {
    if (scene.visual !== "generated_video" || scene.asset !== undefined) {
      return { ok: false, reason: "native_requires_generated_video", sceneIndex: i };
    }
    const seconds = scene.durationMs / 1000;
    if (!(GENERATED_CLIP_SECONDS as readonly number[]).includes(seconds)) {
      return { ok: false, reason: "illegal_generated_duration", sceneIndex: i };
    }
    if (
      (scene.index !== undefined && scene.index !== i) ||
      (scene.startMs !== undefined && scene.startMs !== totalMs)
    ) {
      return { ok: false, reason: "bad_scene_timing", sceneIndex: i };
    }
    if (typeof scene.prompt !== "string" || !scene.prompt.trim())
      return { ok: false, reason: "missing_prompt", sceneIndex: i };
    if ((scene.narration ?? "").length > seconds * MAX_CHARS_PER_SECOND) {
      return { ok: false, reason: "narration_too_long", sceneIndex: i };
    }
    if (parseMediaFinishing(scene, scene.durationMs) === null)
      return { ok: false, reason: "bad_finishing", sceneIndex: i };
    totalMs += scene.durationMs;
  }
  return totalMs === deck.targetDurationSeconds * 1000
    ? { ok: true }
    : { ok: false, reason: "duration_mismatch" };
}

/** Canonical provider-prompt envelope, not an agent instruction. Hash this entire string for
 * review/submission: visual changes, exact spoken words, overlays and sound intent all bind.
 * This formatter does not discover references or grant permission to use any uploaded asset. */
export function buildNativeScenePrompt(
  scene: { prompt: string; narration?: string; overlay?: string },
  musicMood?: string,
): string {
  const mood = (MUSIC_MOODS as readonly string[]).includes(musicMood ?? "") ? musicMood : null;
  return [
    "Create this single reviewed audiovisual scene. Keep the product identity and stated facts consistent. Speak only the exact narration; if empty, add no speech. Generate the scene sound natively; do not add other dialogue or lyrics. Leave room for the separately rendered title; do not generate lettering or logos.",
    JSON.stringify({
      visual: scene.prompt,
      exactNarration: scene.narration ?? "",
      postProductionText: scene.overlay ?? "",
      sound: {
        musicMood: mood,
        ambience: "appropriate to the reviewed scene",
        dialogue: "exact narration only",
        lyrics: false,
      },
    }),
  ].join("\n");
}
