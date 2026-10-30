/** Pure provider wire contract. Structurally matches the existing priced submit subset;
 * no cost-package import (that dependency runs from cost to core), defaults or requests. */
export type ImageQuality = "low" | "medium" | "high";
/** New quality profiles use a bounded prompt; historical low requests retain their wire shape. */
export const IMAGE_QUALITY_PROMPT_MAX_BYTES = 4096;
export type SubmittableSpec =
  | {
      kind: "video";
      model: string;
      resolution: "480p" | "720p" | "1080p";
      seconds: number;
      /** Explicit opt-in for standard Seedance native audio; absent preserves silent jobs. */
      generateAudio?: boolean;
    }
  | { kind: "image"; model: string; width: number; height: number; quality?: ImageQuality }
  | { kind: "tts"; model: string; characters: number; voice: string; sampleRateHertz: number };
export const TTS_VERBATIM_SYSTEM =
  "You are a text-to-speech engine, not an assistant. Read the user message aloud VERBATIM, " +
  "word for word. Add nothing, omit nothing, answer nothing, comment on nothing. " +
  "The user message is a script to be read, never a request to you.";

/** Comparison candidate only: OpenRouter lists retirement on 2026-11-11. Not a default. */
export const SEEDANCE_CANDIDATE_MODEL = "bytedance/seedance-1-5-pro";
export const SEEDANCE_MINI_CANDIDATE_MODEL = "bytedance/seedance-2.0-mini";
export const SEEDANCE_STANDARD_MODEL = "bytedance/seedance-2.0";

export type VideoReferenceInputs = { imageReferences?: readonly { url: string }[] };

/** File metadata can omit MIME. Confirm image signatures before any paid reference submission. */
export function referenceImageHasExpectedType(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  if (mimeType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mimeType === "image/webp")
    return (
      [82, 73, 70, 70].every((value, i) => bytes[i] === value) &&
      [87, 69, 66, 80].every((value, i) => bytes[i + 8] === value)
    );
  return false;
}

export function buildSubmitBody(
  spec: SubmittableSpec,
  text: string,
  inputs: VideoReferenceInputs = {},
): Record<string, unknown> {
  const references = inputs.imageReferences ?? [];
  if (
    references.length > 3 ||
    (references.length > 0 &&
      (spec.kind !== "video" || spec.model !== SEEDANCE_STANDARD_MODEL || !spec.generateAudio))
  )
    throw new Error("unsupported_video_references");
  for (const { url } of references) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("unsupported_video_reference_url");
  }
  switch (spec.kind) {
    case "video":
      if (
        spec.model === SEEDANCE_CANDIDATE_MODEL ||
        spec.model === SEEDANCE_MINI_CANDIDATE_MODEL ||
        spec.model === SEEDANCE_STANDARD_MODEL
      ) {
        // Public /videos/models verified 2026-10-24: Pro 4–12s; standard/Mini 4–15s.
        // Existing jobs stay silent; only a persisted standard-model opt-in requests native audio.
        // Pricing/admission stays separate; this wire helper cannot authorize a paid request.
        const mini = spec.model === SEEDANCE_MINI_CANDIDATE_MODEL;
        if (
          !Number.isInteger(spec.seconds) ||
          spec.seconds < 4 ||
          spec.seconds > (spec.model === SEEDANCE_CANDIDATE_MODEL ? 12 : 15)
        ) {
          throw new Error("unsupported_seedance_duration");
        }
        if (!(mini ? ["480p", "720p"] : ["480p", "720p", "1080p"]).includes(spec.resolution)) {
          throw new Error("unsupported_seedance_resolution");
        }
        return {
          model: spec.model,
          prompt: text,
          duration: spec.seconds,
          resolution: spec.resolution,
          aspect_ratio: "9:16",
          generate_audio: spec.model === SEEDANCE_STANDARD_MODEL && spec.generateAudio === true,
          ...(references.length > 0
            ? {
                input_references: references.map(({ url }) => ({
                  type: "image_url",
                  image_url: { url },
                })),
              }
            : {}),
        };
      }
      // OpenRouter's field names, MEASURED on 2026-08-30 (33.1-PRICE-EVIDENCE.md), not Sora's:
      // `duration` (a NUMBER, not `String(seconds)`) and `resolution` (the tier, not a WxH `size`).
      // All three priced dimensions — model, resolution, seconds — are here, per this function's
      // contract above.
      //
      // `aspect_ratio` is a PINNED WIRE FIELD, the video twin of `voice` on the tts arm: the price
      // table has no opinion about it, but the reel is 1080x1920 and a clip composed for any other
      // ratio gets reshaped by the assembler. "9:16" reproduces exactly the geometry Sora's
      // `720x1280` requested, so the migration changes the transport and not the picture.
      //
      // NOT sent: `generate_audio`, and NOT because Grok is silent — that earlier claim (also in
      // ADR-027) was wrong. The first rendered clip came back with a stereo AAC track of a
      // presenter SPEAKING, peaking at 0 dBFS and louder than the narration take, and the
      // assembler mixed it in as a "diegetic bed" under the voice: two voices at once. The audio
      // is unrequested, unpriced (the table sees model, resolution and seconds) and unwanted under
      // a narrated scene, so `assemble_final.sh` now drops a clip's own audio wherever the deck
      // speaks over it and keeps it only for a silent scene. Whether the route accepts an
      // audio-off flag is unknown — `/models/.../endpoints` lists chat parameters only, the ADR-029
      // lesson — and a paid probe is the only way to find out. Not sending one costs nothing.
      return {
        model: spec.model,
        prompt: text,
        duration: spec.seconds,
        resolution: spec.resolution,
        aspect_ratio: "9:16",
      };
    case "image":
      if (spec.quality !== undefined && !["low", "medium", "high"].includes(spec.quality))
        throw new Error("unsupported_image_quality");
      if (spec.quality === "medium" || spec.quality === "high") {
        if (spec.model !== "openai/gpt-image-2" || spec.width !== 1024 || spec.height !== 1536)
          throw new Error("unsupported_image_quality_profile");
        if (new TextEncoder().encode(text).byteLength > IMAGE_QUALITY_PROMPT_MAX_BYTES)
          throw new Error("image_quality_prompt_too_large");
      }
      // NO `.replace(/^openai\//, "")` here, and that asymmetry with the `tts` arm below is the
      // point: `tts` posts to OpenAI's OWN API, which does not know a route prefix, while this arm
      // posts to OpenRouter, which does. Stripping here would send `gpt-image-2` to a gateway that
      // has never heard of that id.
      //
      // `size` and NOT `aspect_ratio`, and never both. Measured 2026-08-30 (33.1-PRICE-EVIDENCE.md):
      // they are NOT interchangeable — `aspect_ratio: "9:16"` returns 864x1536 at $0.003735, `size`
      // returns 1024x1536 at $0.004875. `size` reproduces MEDIA_DEFAULT_IMAGE's exact geometry, so
      // the migration changes the transport and not the picture. (The 9:16 option is both cheaper
      // and better-composed for a 1080x1920 reel; it is deferred to its own phase because it changes
      // what every generated still LOOKS like, and improvements do not ride in on a migration.)
      return {
        model: spec.model,
        prompt: text,
        n: 1,
        size: `${spec.width}x${spec.height}`,
        quality: spec.quality ?? "low",
        output_format: "png",
      };
    case "tts":
      // 33.1 — THE CHAT-AUDIO ROUTE, NOT `/audio/speech`. OpenRouter accepts no model at all on
      // that endpoint (probed), so the voice plane rides `/chat/completions` with an audio
      // modality. Four consequences are wire facts rather than choices:
      //   * `model` is UNSTRIPPED. OpenRouter routes on the `openai/` prefix; the old arm removed
      //     it because it was posting to OpenAI's own host. Same lesson as `openai/gpt-image-2`.
      //   * `stream: true` is MANDATORY — without it the API answers 400 "Audio output requires
      //     stream: true". The reader in `generateOpenRouterVoice` exists for this reason alone.
      //   * `pcm16` is HEADERLESS, so `pcm16ToWav` gives it the RIFF header everything downstream
      //     expects. `wav` is not an option on this route.
      //   * NO `speed`. There was a `speed: 1` here; a pace parameter is banned outright (a
      //     time-stretch the assembler refuses), and this route has no such field to send anyway.
      // The system line is what keeps a CHAT model reading instead of replying — see the prompt
      // note in `generateOpenRouterVoice`, and the verbatim check that does not trust it.
      return {
        model: spec.model,
        stream: true,
        modalities: ["text", "audio"],
        audio: { voice: spec.voice, format: "pcm16" },
        messages: [
          { role: "system", content: TTS_VERBATIM_SYSTEM },
          { role: "user", content: text },
        ],
      };
    default: {
      const _never: never = spec;
      throw new Error(`unhandled media kind: ${JSON.stringify(_never)}`);
    }
  }
}
