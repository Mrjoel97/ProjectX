export const PDF_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;
export const PDF_PREVIEW_MAX_CANVAS_PIXELS = 16_000_000;

export class PdfPreviewError extends Error {
  constructor(public readonly code: "byte_limit" | "load_failed") {
    super(code);
  }
}

/** Read only the selected owned original, with a cap enforced during streaming. */
export async function readPdfBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new PdfPreviewError("load_failed");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PDF_PREVIEW_MAX_BYTES) {
    await response.body?.cancel();
    throw new PdfPreviewError("byte_limit");
  }
  if (!response.body) throw new PdfPreviewError("load_failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > PDF_PREVIEW_MAX_BYTES) {
        await reader.cancel();
        throw new PdfPreviewError("byte_limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
