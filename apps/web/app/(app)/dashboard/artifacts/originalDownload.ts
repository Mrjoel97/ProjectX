/** Matches the existing upload and rendered-media file policy; independent of PDF preview limits. */
export const ORIGINAL_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;

export class OriginalDownloadError extends Error {
  constructor(public readonly code: "byte_limit" | "unavailable") {
    super(code);
  }
}

/** Caller must obtain this exact selected-file URL through its existing ownership query. */
export async function downloadOwnedOriginal(url: string, filename: string, signal: AbortSignal) {
  signal.throwIfAborted();
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
  if (Number.isFinite(declared) && declared > ORIGINAL_DOWNLOAD_MAX_BYTES) {
    await response.body.cancel();
    throw new OriginalDownloadError("byte_limit");
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > ORIGINAL_DOWNLOAD_MAX_BYTES) {
        await reader.cancel();
        throw new OriginalDownloadError("byte_limit");
      }
      chunks.push(part.value as BlobPart);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const blob = new Blob(chunks, {
    type: response.headers.get("content-type") ?? "application/octet-stream",
  });
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
