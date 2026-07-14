// Pure magic-byte + mime + extension classifier (CLAUDE.md §1 — no Convex/AI/OpenAI import).
// Order of trust: magic bytes (most reliable) -> mime type -> filename extension.
// Defense in depth: if bytes and mime disagree, the bytes win.

export type IntakeKind = "image" | "pdf" | "audio" | "document" | "unknown";

export interface ClassifyResult {
  kind: IntakeKind;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, str: string, offset: number): boolean {
  if (bytes.length < offset + str.length) return false;
  for (let i = 0; i < str.length; i++) {
    if (bytes[offset + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

function sniffBytes(bytes: Uint8Array): IntakeKind | null {
  // image
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image"; // PNG
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image"; // JPEG
  if (asciiAt(bytes, "GIF8", 0)) return "image"; // GIF
  if (asciiAt(bytes, "RIFF", 0) && asciiAt(bytes, "WEBP", 8)) return "image"; // WEBP

  // pdf
  if (asciiAt(bytes, "%PDF", 0)) return "pdf";

  // audio
  if (asciiAt(bytes, "RIFF", 0) && asciiAt(bytes, "WAVE", 8)) return "audio"; // WAV
  if (asciiAt(bytes, "ID3", 0)) return "audio"; // mp3 (ID3 tag)
  if (startsWith(bytes, [0xff, 0xfb])) return "audio"; // mp3 (frame sync)
  if (asciiAt(bytes, "OggS", 0)) return "audio"; // Ogg
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "audio"; // webm/matroska (MediaRecorder)
  if (asciiAt(bytes, "ftyp", 4)) return "audio"; // m4a (ISO base media "ftyp" box)

  // document
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "document"; // Office/zip (PK..)

  return null;
}

function sniffExtension(filename: string): IntakeKind | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return null;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["wav", "mp3", "ogg", "webm", "m4a"].includes(ext)) return "audio";
  if (["txt", "md", "docx", "doc"].includes(ext)) return "document";
  return null;
}

function sniffMime(mimeType: string): IntakeKind | null {
  if (!mimeType) return null;
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/")) return "document";
  return null;
}

/**
 * classify — decides which extraction path a file/blob takes.
 * Trust order: magic bytes first, then mime type, then filename extension.
 * Returns "unknown" (reject conversationally, no model call) when none match.
 */
export function classify(bytes: Uint8Array, mimeType: string, filename: string): ClassifyResult {
  const byBytes = sniffBytes(bytes);
  if (byBytes) return { kind: byBytes };

  const byMime = sniffMime(mimeType);
  if (byMime) return { kind: byMime };

  const byExt = sniffExtension(filename);
  if (byExt) return { kind: byExt };

  return { kind: "unknown" };
}
