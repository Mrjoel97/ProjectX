/** Matches the existing upload and rendered-media file policy; independent of PDF preview limits. */
export const ORIGINAL_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;

const imageSuffixes: Record<string, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/avif": ["avif"],
  "image/svg+xml": ["svg"],
};

/** Media titles can supply a PNG hint even when the original is another image format. */
export function originalFilename(filename: string, contentType: string | null): string {
  const suffix = /\.(png|jpe?g|webp|gif|avif|svg)$/i.exec(filename);
  const extension = suffix?.[1];
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  const formats = mime ? imageSuffixes[mime] : undefined;
  const canonical = formats?.[0];
  if (!suffix || !extension || !formats || !canonical) return filename;
  return formats.includes(extension.toLowerCase())
    ? filename
    : `${filename.slice(0, -suffix[0].length)}.${canonical}`;
}

export class OriginalDownloadError extends Error {
  constructor(public readonly code: "byte_limit" | "unavailable") {
    super(code);
  }
}

/** Shared admission for individual and batch originals; URLs must come from ownership queries. */
export async function streamOwnedOriginal(
  url: string,
  filename: string,
  signal: AbortSignal,
  onStart: (info: { filename: string; mimeType: string }) => void,
  onChunk: (chunk: Uint8Array) => void,
  maxBytes = ORIGINAL_DOWNLOAD_MAX_BYTES,
) {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > ORIGINAL_DOWNLOAD_MAX_BYTES)
    throw new OriginalDownloadError("byte_limit");
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (signal.aborted) {
    await response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new OriginalDownloadError("unavailable");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel();
    throw new OriginalDownloadError("byte_limit");
  }
  const reader = response.body.getReader();
  const info = {
    filename: originalFilename(filename, response.headers.get("content-type")),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream",
  };
  let size = 0;
  try {
    onStart(info);
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new OriginalDownloadError("byte_limit");
      }
      onChunk(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  return info;
}

/** Caller must obtain this exact selected-file URL through its existing ownership query. */
export async function downloadOwnedOriginal(url: string, filename: string, signal: AbortSignal) {
  const chunks: BlobPart[] = [];
  const info = await streamOwnedOriginal(
    url,
    filename,
    signal,
    () => {},
    (chunk) => chunks.push(chunk as BlobPart),
  );
  downloadOriginalBlob(new Blob(chunks, { type: info.mimeType }), info.filename, signal);
}

/** The same bounded lifetime is used for a single original and a completed archive. */
export function downloadOriginalBlob(blob: Blob, filename: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", release);
    URL.revokeObjectURL(objectUrl);
  };
  const anchor = document.createElement("a");
  try {
    signal.throwIfAborted();
    signal.addEventListener("abort", release, { once: true });
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    // Keep the URL alive while the browser accepts the download; never retain it indefinitely.
    timer = setTimeout(release, 60_000);
  } catch (error) {
    release();
    throw error;
  } finally {
    anchor.remove();
  }
}
