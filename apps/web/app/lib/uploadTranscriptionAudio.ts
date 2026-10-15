import type { api } from "@pikar/backend/api";
import type { FunctionArgs } from "convex/server";
import { normalizeAudio } from "./normalizeAudio";

/** Keep original media downloadable; only verified PCM is sent for transcription. */
export async function uploadTranscriptionAudio(
  original: Blob,
  mimeType: string,
  uploadUrl: () => Promise<string>,
): Promise<FunctionArgs<typeof api.vault.vaultUpload>["transcriptionStorageId"]> {
  if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) return undefined;
  let audio: Blob;
  try {
    audio = await normalizeAudio(original);
  } catch {
    throw new Error(
      "We could not read this audio track. Use a supported recording of up to 10 minutes, or upload its transcript.",
    );
  }
  const response = await fetch(await uploadUrl(), {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: audio,
  });
  if (!response.ok) throw new Error("Audio preparation upload failed. Please retry.");
  const result = await response.json();
  if (typeof result.storageId !== "string")
    throw new Error("Audio preparation did not return a file reference.");
  return result.storageId;
}
