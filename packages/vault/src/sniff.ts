// Content-first format recognition (Phase 15.2, SC#1). Dep-free and V8-safe (no fflate, no
// node:*) — which is what lets the index barrel re-export it, unlike officeText.ts.
//
// ponytail: this is a magic-byte sniff, not a libmagic port. It knows the signatures below and
// nothing else. A format whose signature is absent falls back to the MIME/extension answer
// (extractionKindFor) and, failing that, fails HONESTLY as "unsupported" — which after plan
// 15.2-03 is a TERMINAL failed("unsupported_format"), never a silent pending_extraction row.
// Upgrade path: add a row to SIGNATURES, or port a real container parser if the table grows legs.
import { extractionKindFor } from "./extractKind";

export type Container = "pdf" | "zip" | "ole2" | "rtf" | "png" | "jpeg" | "gif" | "text" | "binary";

export type ExtractRail =
  | "pdf"
  | "image"
  | "zip"
  | "legacy_doc"
  | "legacy_ppt"
  | "legacy_xls"
  | "rtf"
  | "markup"
  | "text"
  | "unsupported";

/** Offset-0 byte prefixes. Order matters only in that the first match wins. */
const SIGNATURES: ReadonlyArray<readonly [Container, readonly number[]]> = [
  ["zip", [0x50, 0x4b, 0x03, 0x04]],
  ["zip", [0x50, 0x4b, 0x05, 0x06]], // empty archive
  ["zip", [0x50, 0x4b, 0x07, 0x08]], // spanned archive
  ["ole2", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ["rtf", [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31]], // {\rtf1
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["gif", [0x47, 0x49, 0x46, 0x38]],
];

const OLE2_PREFIX = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const; // %PDF
/** %PDF is legally preceded by junk; the window keeps a text file that MENTIONS it out. */
const PDF_SCAN_BYTES = 1024;
const TEXT_SCAN_BYTES = 4096;
const PRINTABLE_RATIO = 0.95;

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/** Plain subarray search — no decode, no regex, no allocation per position. */
const indexOfBytes = (haystack: Uint8Array, needle: readonly number[]): number => {
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
};

const isPrintable = (code: number): boolean =>
  code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f);

/** ≥95% printable over the first 4 KiB of valid UTF-8. Empty input is NOT text. */
const looksTextual = (bytes: Uint8Array): boolean => {
  if (bytes.length === 0) return false;
  let decoded: string;
  try {
    // stream:true holds back an incomplete trailing sequence, so a multi-byte char straddling
    // the window edge is not mistaken for invalid UTF-8.
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, TEXT_SCAN_BYTES), {
      stream: true,
    });
  } catch {
    return false; // not UTF-8 → binary
  }
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded; // strip the BOM
  if (text.length === 0) return false;
  let printable = 0;
  for (let i = 0; i < text.length; i++) {
    if (isPrintable(text.charCodeAt(i))) printable++;
  }
  return printable / text.length >= PRINTABLE_RATIO;
};

export function sniffContainer(bytes: Uint8Array): Container {
  for (const [container, prefix] of SIGNATURES) {
    if (startsWith(bytes, prefix)) return container;
  }
  if (indexOfBytes(bytes.subarray(0, PDF_SCAN_BYTES), PDF_MAGIC) !== -1) return "pdf";
  return looksTextual(bytes) ? "text" : "binary";
}

/** OLE2 directory entry names are UTF-16LE — interleave the ASCII bytes with 0x00. */
const utf16leNeedle = (name: string): number[] => [...name].flatMap((c) => [c.charCodeAt(0), 0]);

const OLE2_SCAN_BYTES = 8192;
// "Workbook" is checked before "Book" — the BIFF5 name is a suffix of the BIFF8 one.
const OLE2_STREAMS: ReadonlyArray<readonly ["doc" | "ppt" | "xls", number[]]> = [
  ["doc", utf16leNeedle("WordDocument")],
  ["ppt", utf16leNeedle("PowerPoint Document")],
  ["xls", utf16leNeedle("Workbook")],
  ["xls", utf16leNeedle("Book")],
];

/**
 * Which legacy Office format an OLE2 compound file is, read off its own directory stream names.
 * This is content-based on purpose: it is what tells a MIME-less .xls from a MIME-less .doc.
 *
 * ponytail: a needle scan over the first 8 KiB, not a real CFB directory walk. Upgrade path is
 * parsing the FAT/DIFAT if a real file ever hides its directory past 8 KiB.
 */
export function ole2Kind(bytes: Uint8Array): "doc" | "ppt" | "xls" | "unknown" {
  if (!startsWith(bytes, OLE2_PREFIX)) return "unknown";
  const window = bytes.subarray(0, OLE2_SCAN_BYTES);
  for (const [kind, needle] of OLE2_STREAMS) {
    if (indexOfBytes(window, needle) !== -1) return kind;
  }
  return "unknown";
}

const MARKUP_MIME: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "image/svg+xml",
]);
const MARKUP_EXT = /\.(html?|xhtml|xml|svg)$/i;

const LEGACY_RAIL = {
  doc: "legacy_doc",
  ppt: "legacy_ppt",
  xls: "legacy_xls",
} as const satisfies Record<"doc" | "ppt" | "xls", ExtractRail>;

/**
 * The extraction rail for an upload. CONTENT FIRST: the sniffed container is an OVERRIDE ahead
 * of the MIME/extension checks, which survive only as the fallback behind it. A wrong, renamed
 * or ABSENT MIME type therefore no longer decides anything on its own.
 */
export function resolveRail(bytes: Uint8Array, mimeType: string, filename?: string): ExtractRail {
  const container = sniffContainer(bytes);
  switch (container) {
    case "pdf":
      return "pdf";
    case "zip":
      return "zip";
    case "rtf":
      return "rtf";
    case "png":
    case "jpeg":
    case "gif":
      return "image";
    case "ole2": {
      const kind = ole2Kind(bytes);
      if (kind !== "unknown") return LEGACY_RAIL[kind];
      break; // an OLE2 we cannot name falls through to the MIME fallback
    }
    case "text":
      // ponytail: JSON / YAML / TSV / LOG all ride the "text" rail rather than being added to
      // the searchable MIME set — that set is DUPLICATED (packages/vault/src/categories.ts and
      // apps/web/.../Dropzone.tsx), and widening two allow-lists while this phase deletes a
      // third is the wrong direction. Same user-visible outcome (the document reads) at the cost
      // of one $0, no-model extraction action per upload. Upgrade path: widen both sets if that
      // round-trip ever shows up as latency the user notices.
      return MARKUP_MIME.has(mimeType) || (filename !== undefined && MARKUP_EXT.test(filename))
        ? "markup"
        : "text";
    default:
      break; // "binary" → the MIME fallback is the only thing left
  }

  // Rung 2: the MIME table already exists — reuse it, do not restate it.
  switch (extractionKindFor(mimeType, filename)) {
    case "pdf":
      return "pdf";
    case "image":
      return "image";
    case "office":
      return "zip";
    default:
      // "transcribe" included: media is routed by MIME at the SCHEDULING gate, before any
      // action runs. Anything reaching here as media already failed to be recognised as media.
      return "unsupported";
  }
}
