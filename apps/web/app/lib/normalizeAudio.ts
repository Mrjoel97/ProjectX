import { encodePcmWav, PCM_MAX_SECONDS, PCM_SAMPLE_RATE } from "@pikar/voice/pcm";

/** Browser decoding is a compatibility adapter; the server independently verifies
 * the resulting PCM samples and duration before any paid transcription request. */
export async function normalizeAudio(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (
      !Number.isFinite(decoded.duration) ||
      decoded.duration <= 0 ||
      decoded.duration > PCM_MAX_SECONDS
    )
      throw new Error("Audio must be no longer than 10 minutes.");
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * PCM_SAMPLE_RATE),
      PCM_SAMPLE_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const wav = encodePcmWav(rendered.getChannelData(0));
    return new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
