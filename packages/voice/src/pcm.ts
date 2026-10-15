/** Canonical transcription input. Duration comes from complete PCM samples, never
 * caller metadata or compressed container timestamps. No ancillary/chained chunks. */
export const PCM_SAMPLE_RATE = 16_000;
export const PCM_MAX_SECONDS = 600;
export function inspectPcmWav(bytes: Uint8Array): { seconds: number; samples: number } {
  const fail = (): never => {
    throw new Error("TRANSCRIPTION_REQUIRES_BOUNDED_PCM_WAV");
  };
  if (bytes.byteLength < 46 || bytes.byteLength > 44 + PCM_SAMPLE_RATE * PCM_MAX_SECONDS * 2)
    fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    tag(12) !== "fmt " ||
    tag(36) !== "data" ||
    view.getUint32(4, true) !== bytes.byteLength - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== PCM_SAMPLE_RATE ||
    view.getUint32(28, true) !== PCM_SAMPLE_RATE * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.byteLength - 44 ||
    (bytes.byteLength - 44) % 2 !== 0
  )
    fail();
  const samples = (bytes.byteLength - 44) / 2;
  return { samples, seconds: samples / PCM_SAMPLE_RATE };
}

/** Adapter supplies already resampled mono samples. Output is the only server-accepted format. */
export function encodePcmWav(samples: Float32Array): Uint8Array {
  if (!samples.length || samples.length > PCM_SAMPLE_RATE * PCM_MAX_SECONDS)
    throw new Error("TRANSCRIPTION_AUDIO_DURATION_LIMIT");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  tag(0, "RIFF");
  tag(8, "WAVE");
  tag(12, "fmt ");
  tag(36, "data");
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, PCM_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (value === undefined || !Number.isFinite(value))
      throw new Error("TRANSCRIPTION_AUDIO_INVALID_SAMPLE");
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)),
      true,
    );
  }
  return bytes;
}
