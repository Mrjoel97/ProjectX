import {
  downloadOriginalBlob,
  ORIGINAL_DOWNLOAD_MAX_BYTES,
  OriginalDownloadError,
  streamOwnedOriginal,
} from "./originalDownload";

export type BatchDownloadManifest = {
  title: string;
  total: number;
  entries: readonly {
    index: number;
    label: string;
    kind: "image" | "video";
    url: string;
    captioned: boolean;
    musicCredit?: string | null;
  }[];
  omitted: readonly { index: number; label: string; status: string; reason: string }[];
};

export type BatchDownloadProgress = { completed: number; total: number; bytes: number };

export class BatchDownloadError extends Error {
  constructor(public readonly code: "byte_limit" | "unavailable" | "invalid_manifest") {
    super(code);
  }
}

function validate(manifest: BatchDownloadManifest) {
  const rows = [...manifest.entries, ...manifest.omitted];
  if (
    !Number.isInteger(manifest.total) ||
    manifest.total < 1 ||
    manifest.total > 15 ||
    !manifest.entries.length ||
    rows.length !== manifest.total ||
    new Set(rows.map((row) => row.index)).size !== rows.length ||
    rows.some((row) => !Number.isInteger(row.index) || row.index < 0 || row.index >= manifest.total)
  )
    throw new BatchDownloadError("invalid_manifest");
  for (const entry of manifest.entries) {
    let protocol: string;
    try {
      protocol = new URL(entry.url).protocol;
    } catch {
      throw new BatchDownloadError("invalid_manifest");
    }
    if (!["http:", "https:"].includes(protocol) || !["image", "video"].includes(entry.kind))
      throw new BatchDownloadError("invalid_manifest");
  }
}

/** Click-only caller supplies a freshly authorized, exact campaign/thread snapshot. No URL proxy. */
export async function downloadOwnedBatch(
  manifest: BatchDownloadManifest,
  signal: AbortSignal,
  onProgress?: (progress: BatchDownloadProgress) => void,
) {
  signal.throwIfAborted();
  validate(manifest);
  // STORE preserves original media and avoids recompressing JPEG/PNG/MP4 on the UI thread.
  const { Zip, ZipPassThrough, strToU8 } = await import("@pikar/vault/archive");
  signal.throwIfAborted();
  const chunks: BlobPart[] = [];
  const names: string[] = [];
  let bytes = 0;
  let outputBytes = 0;
  let completed = 0;
  let finished = false;
  let archiveError: Error | undefined;
  const zip = new Zip((error, chunk, final) => {
    if (error) archiveError = error;
    if (archiveError) return;
    outputBytes += chunk.byteLength;
    if (outputBytes > ORIGINAL_DOWNLOAD_MAX_BYTES) {
      archiveError = new BatchDownloadError("byte_limit");
      return;
    }
    chunks.push(chunk as BlobPart);
    finished = final;
  });
  const check = () => {
    signal.throwIfAborted();
    if (archiveError) throw archiveError;
  };
  const abort = () => zip.terminate();
  signal.addEventListener("abort", abort, { once: true });
  try {
    onProgress?.({ completed, total: manifest.entries.length, bytes });
    for (const item of [...manifest.entries].sort((a, b) => a.index - b.index)) {
      check();
      let file: InstanceType<typeof ZipPassThrough> | undefined;
      const filename = `${String(item.index + 1).padStart(2, "0")}-${item.kind === "image" ? "image.png" : item.captioned ? "video-captioned.mp4" : "video.mp4"}`;
      const info = await streamOwnedOriginal(
        item.url,
        filename,
        signal,
        ({ filename: actualName }) => {
          file = new ZipPassThrough(actualName);
          zip.add(file);
          check();
        },
        (chunk) => {
          bytes += chunk.byteLength;
          file?.push(chunk, false);
          check();
          onProgress?.({ completed, total: manifest.entries.length, bytes });
        },
        ORIGINAL_DOWNLOAD_MAX_BYTES - bytes,
      );
      file?.push(new Uint8Array(), true);
      check();
      names.push(`${info.filename} — ${item.label}`);
      completed++;
      onProgress?.({ completed, total: manifest.entries.length, bytes });
    }
    const credits = [
      ...new Set(manifest.entries.flatMap((item) => (item.musicCredit ? [item.musicCredit] : []))),
    ];
    const readme = strToU8(
      [
        manifest.title,
        "",
        `Snapshot: ${manifest.entries.length} of ${manifest.total} outputs available when download started.`,
        "Original files are unchanged. Later completions are not included in this snapshot.",
        "",
        "Included files:",
        ...names,
        "",
        "Not included:",
        ...(manifest.omitted.length
          ? manifest.omitted.map(
              (item) =>
                `${item.index + 1}. ${item.label} — ${item.status.replaceAll("_", " ")} (${item.reason === "not_ready" ? "not ready when download started" : "original unavailable"})`,
            )
          : ["None."]),
        ...(credits.length ? ["", "Music credits:", ...credits] : []),
        "",
      ].join("\n"),
    );
    if (bytes + readme.byteLength > ORIGINAL_DOWNLOAD_MAX_BYTES)
      throw new BatchDownloadError("byte_limit");
    const note = new ZipPassThrough("README.txt");
    zip.add(note);
    note.push(readme, true);
    zip.end();
    check();
    if (!finished) throw new BatchDownloadError("unavailable");
    downloadOriginalBlob(new Blob(chunks, { type: "application/zip" }), "media-batch.zip", signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof BatchDownloadError) throw error;
    if (error instanceof OriginalDownloadError) throw new BatchDownloadError(error.code);
    throw new BatchDownloadError("unavailable");
  } finally {
    signal.removeEventListener("abort", abort);
    zip.terminate();
  }
}
