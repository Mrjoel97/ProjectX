import type { api } from "@pikar/backend/api";
import type { FunctionArgs } from "convex/server";
import { normalizeAudio } from "./normalizeAudio";

/** Keep original media downloadable; only verified PCM is sent for transcription. */
export async function uploadTranscriptionAudio(
  original: Blob,
  mimeType: string,
  uploadUrl: () => Promise<string>,
  signal?: AbortSignal,
): Promise<FunctionArgs<typeof api.vault.vaultUpload>["transcriptionStorageId"]> {
  signal?.throwIfAborted();
  if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) return undefined;
  let audio: Blob;
  try {
    audio = await normalizeAudio(original);
  } catch {
    throw new Error(
      "We could not read this audio track. Use a supported recording of up to 10 minutes, or upload its transcript.",
    );
  }
  signal?.throwIfAborted();
  const url = await uploadUrl();
  signal?.throwIfAborted();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: audio,
    signal,
  });
  if (!response.ok) throw new Error("Audio preparation upload failed. Please retry.");
  const result = await response.json();
  if (typeof result.storageId !== "string")
    throw new Error("Audio preparation did not return a file reference.");
  return result.storageId;
}
