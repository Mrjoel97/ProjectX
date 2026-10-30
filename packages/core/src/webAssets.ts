import type { WebDocument, WebNode } from "@pikar/contracts/webRuntime";
import { sha256Bytes } from "./webRuntime";

export function parseWebAssetRef(
  value: unknown,
): { assetId: string; digest: string; contentHash: string } | null {
  if (typeof value !== "string") return null;
  const match = /^webasset:([a-zA-Z0-9_-]{1,96}):([a-f0-9]{64})$/.exec(value);
  return match?.[1] && match[2]
    ? { assetId: match[1], digest: match[2], contentHash: `sha256:${match[2]}` }
    : null;
}

export function webAssetPath(ref: string, projectSlug: string): string | null {
  const asset = parseWebAssetRef(ref);
  if (!asset || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectSlug)) return null;
  return `/p/${projectSlug}/assets/${asset.assetId}/${asset.digest}`;
}

export function collectWebAssetRefs(document: WebDocument): string[] {
  const refs = new Set<string>();
  const add = (ref?: string) => {
    if (ref?.startsWith("webasset:") && !parseWebAssetRef(ref))
      throw new Error("WEB_ASSET_REF_INVALID");
    if (parseWebAssetRef(ref)) refs.add(ref as string);
  };
  add(document.brand.logo?.storageRef);
  const walk = (node: WebNode) => {
    if (node.kind === "media") add(node.storageRef);
    if (node.kind === "catalogue") for (const item of node.items) add(item.imageStorageRef);
    if (node.kind === "section") for (const child of node.children) walk(child);
  };
  for (const page of document.pages) for (const node of page.nodes) walk(node);
  if (refs.size > 8) throw new Error("WEB_ASSET_LIMIT");
  return [...refs].sort();
}

/** Inspect raster containers without executing a decoder or accepting active/vector formats.
 * The adapter still verifies owned storage, copies bytes and checks source metadata. */
export function inspectWebAssetBytes(bytes: Uint8Array, declaredMimeType: string) {
  const fail = (): never => {
    throw new Error("WEB_ASSET_INVALID");
  };
  if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, size: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + size));
  const crc32 = (start: number, end: number) => {
    let crc = 0xffffffff;
    for (let i = start; i < end; i++) {
      crc ^= bytes[i] ?? 0;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  let width = 0;
  let height = 0;
  let mimeType: "image/png" | "image/jpeg" | "image/webp";
  if (
    bytes[0] === 137 &&
    ascii(1, 3) === "PNG" &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  ) {
    mimeType = "image/png";
    let offset = 8;
    let imageData = false;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = ascii(offset + 4, 4);
      if (length > bytes.length - offset - 12) fail();
      if (crc32(offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)) fail();
      if (offset === 8 && (type !== "IHDR" || length !== 13)) fail();
      if (type === "IHDR") {
        if (offset !== 8) fail();
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        const depth = bytes[offset + 16],
          color = bytes[offset + 17];
        const depths: Record<number, number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        };
        if (
          color === undefined ||
          depth === undefined ||
          !depths[color]?.includes(depth) ||
          bytes[offset + 18] !== 0 ||
          bytes[offset + 19] !== 0 ||
          ![0, 1].includes(bytes[offset + 20] ?? -1)
        )
          fail();
      }
      if (type === "acTL") fail();
      if (type === "IDAT") imageData = true;
      offset += length + 12;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length) fail();
        ended = true;
        break;
      }
    }
    if (!ended || !imageData) fail();
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mimeType = "image/jpeg";
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail();
    let offset = 2;
    let scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) fail();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) break;
      if (marker === undefined || offset + 2 > bytes.length) fail();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) fail();
      if ([192, 193, 194].includes(marker as number)) {
        if (length < 8) fail();
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
      }
      if (marker === 218) {
        scan = true;
        break;
      }
      offset += length;
    }
    if (!scan) fail();
  } else if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    mimeType = "image/webp";
    if (view.getUint32(4, true) + 8 !== bytes.length) fail();
    let offset = 12;
    let imageData = false;
    while (offset + 8 <= bytes.length) {
      const type = ascii(offset, 4);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (length > bytes.length - start) fail();
      if (type === "ANIM" || type === "ANMF") fail();
      if (type === "VP8X") {
        if (length !== 10 || (bytes[start] ?? 0) & 2) fail();
        width =
          1 +
          (bytes[start + 4] ?? 0) +
          ((bytes[start + 5] ?? 0) << 8) +
          ((bytes[start + 6] ?? 0) << 16);
        height =
          1 +
          (bytes[start + 7] ?? 0) +
          ((bytes[start + 8] ?? 0) << 8) +
          ((bytes[start + 9] ?? 0) << 16);
      }
      if (type === "VP8 ") {
        if (length < 10 || ascii(start + 3, 3) !== "\x9d\x01\x2a") fail();
        const w = view.getUint16(start + 6, true) & 16383;
        const h = view.getUint16(start + 8, true) & 16383;
        if (width && (width !== w || height !== h)) fail();
        width = w;
        height = h;
        imageData = true;
      }
      if (type === "VP8L") {
        if (length < 5 || bytes[start] !== 47 || ((bytes[start + 4] ?? 0) & 224) !== 0) fail();
        const bits = view.getUint32(start + 1, true);
        const w = 1 + (bits & 16383);
        const h = 1 + ((bits >>> 14) & 16383);
        if (width && (width !== w || height !== h)) fail();
        width = w;
        height = h;
        imageData = true;
      }
      offset = start + length + (length % 2);
    }
    if (offset !== bytes.length || !imageData) fail();
  } else return fail();
  if (
    mimeType !== declaredMimeType ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 20_000_000
  )
    fail();
  return {
    mimeType,
    width,
    height,
    byteLength: bytes.length,
    contentHash: `sha256:${sha256Bytes(bytes)}`,
  };
}
